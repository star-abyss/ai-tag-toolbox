'use strict';

const { randomUUID } = require('node:crypto');
const {
  addCandidate,
  markRecommended,
  selectCandidate: selectCandidateRows,
  setCandidateEvaluation,
  finalCandidate,
  snapshot: candidateSnapshot
} = require('./draw-candidates');
const { parseVisionPayload } = require('./vision-payload');

const JOB_STATES = Object.freeze([
  'preparing', 'compiling', 'rendering', 'evaluating', 'revising', 'selecting',
  'needs_input', 'completed', 'failed', 'cancelled', 'interrupted'
]);
const RUNNING_STATES = new Set(['preparing', 'compiling', 'rendering', 'evaluating', 'revising', 'selecting']);
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const GENERATION_STRATEGIES = Object.freeze(['quick', 'auto', 'fixed3']);
const DEFAULT_GENERATION_POLICY = Object.freeze({
  strategy: 'auto',
  autoSelect: true,
  maxSuccessfulRenders: 3,
  maxRenderAttempts: 5,
  acceptScore: 90,
  minImprovement: 3
});

function text(value, fallback = '') {
  const output = value == null ? '' : String(value).trim();
  return output || fallback;
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function number(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(parsed) ? parsed : fallback));
}
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (object(value)) {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (['bytes', 'dataUrl', 'thumbnailDataUrl', 'previewUrl', 'viewUrl', 'workflow', 'metadata', 'analysis', 'signal', 'controller'].includes(key) || typeof item === 'function') continue;
      output[key] = clone(item);
    }
    return output;
  }
  return value;
}
function strings(value, limit = 256) {
  const rows = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[,，、;；|\n]+/);
  return [...new Set(rows.map(item => text(item)).filter(Boolean))].slice(0, limit);
}
function failure(code, message) { return Object.assign(new Error(message), { code }); }
function errorValue(error) {
  if (error?.error && typeof error.error === 'object') return errorValue(error.error);
  return { code: text(error?.code, 'GENERATION_FAILED'), message: text(error?.message || error?.error, '生成任务失败'), retryable: error?.retryable === true };
}
function unwrap(value) {
  if (value?.ok === false) throw failure(value.error?.code || value.code || 'GENERATION_FAILED', value.error?.message || value.error || value.text || '生成阶段失败');
  return value?.ok === true && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value;
}
function policyFrom(value = {}, settings = {}) {
  const configured = object(settings?.generation) ? settings.generation : object(settings) ? settings : {};
  const source = { ...DEFAULT_GENERATION_POLICY, ...configured, ...value };
  const strategy = GENERATION_STRATEGIES.includes(source.strategy) ? source.strategy : DEFAULT_GENERATION_POLICY.strategy;
  const maxSuccessfulRenders = Math.round(number(source.maxSuccessfulRenders, 3, 1, 3));
  return {
    strategy,
    autoSelect: source.autoSelect !== false,
    maxSuccessfulRenders,
    maxRenderAttempts: Math.max(maxSuccessfulRenders, Math.round(number(source.maxRenderAttempts, 5, 1, 10))),
    acceptScore: number(source.acceptScore, 90, 0, 100),
    minImprovement: number(source.minImprovement, 3, 0, 100)
  };
}
function candidateLimit(policy) {
  return policy.strategy === 'quick' ? 1 : policy.maxSuccessfulRenders;
}
function minimumCandidates(policy) {
  if (policy.strategy === 'quick') return 1;
  if (policy.strategy === 'fixed3') return candidateLimit(policy);
  return Math.min(2, candidateLimit(policy));
}
function promptSnapshot(value) {
  const source = object(value) ? value : {};
  const items = object(source.items) ? Object.fromEntries(Object.entries(source.items).map(([key, item]) => [key, text(object(item) ? item.text : item)])) : {};
  return { setId: text(source.setId || source.activeSetId), revision: Number(source.revision) || 0, items };
}
function compactBlueprint(value) {
  return parseVisionPayload(value);
}
function blueprintText(value) {
  if (!object(value) || !Object.keys(value).length) return '';
  return JSON.stringify(value);
}
function normalizeArtifactRows(value) {
  const source = unwrap(value) || {};
  const rows = Array.isArray(source) ? source : Array.isArray(source.artifacts) ? source.artifacts : Array.isArray(source.images) ? source.images : source.artifact ? [source.artifact] : [];
  const imageIds = Array.isArray(source.imageIds) ? source.imageIds : [];
  if (!rows.length && imageIds.length) return imageIds.map(imageId => ({ imageId }));
  return rows.map((row, index) => ({ ...(object(row) ? clone(row) : {}), imageId: text(row?.imageId || row?.id || imageIds[index]) })).filter(row => row.imageId);
}
function applyPromptPatch(current, patch) {
  const source = object(patch) ? patch : {};
  if (Array.isArray(source.positiveTags)) {
    const preserveTags = strings([...(current.preserveTags || []), ...(source.preserve || source.preserveTags || [])]);
    return {
      positiveTags: strings([...source.positiveTags, ...preserveTags]),
      negativeTags: Array.isArray(source.negativeTags) ? strings(source.negativeTags) : strings(current.negativeTags),
      preserveTags
    };
  }
  const preserveTags = strings([...(current.preserveTags || []), ...(source.preserve || source.preserveTags || [])]);
  const preserve = new Set(preserveTags.map(item => item.toLowerCase()));
  const remove = new Set(strings(source.remove || source.removeTags).map(item => item.toLowerCase()).filter(item => !preserve.has(item)));
  const negativeRemove = new Set(strings(source.negativeRemove || source.removeNegativeTags).map(item => item.toLowerCase()));
  return {
    positiveTags: strings([...strings(current.positiveTags).filter(item => !remove.has(item.toLowerCase())), ...strings(source.add || source.addTags)]),
    negativeTags: strings([...strings(current.negativeTags).filter(item => !negativeRemove.has(item.toLowerCase())), ...strings(source.negativeAdd || source.addNegativeTags)]),
    preserveTags
  };
}
function activeCandidate(job, id) {
  return job.candidates.find(candidate => candidate.id === id || candidate.imageId === id) || null;
}
function reviewed(candidate) { return candidate?.evaluation?.status === 'reviewed'; }
function hardErrorCount(candidate) { return Array.isArray(candidate?.evaluation?.hardErrors) ? candidate.evaluation.hardErrors.length : 0; }
function score(candidate) { return reviewed(candidate) ? number(candidate.evaluation.score, 0, 0, 100) : -1; }
function programRanking(candidates) {
  const rows = candidates.slice();
  const hasClean = rows.some(candidate => reviewed(candidate) && hardErrorCount(candidate) === 0);
  return rows.sort((a, b) => {
    const aBlocked = hasClean && hardErrorCount(a) > 0 ? 1 : 0;
    const bBlocked = hasClean && hardErrorCount(b) > 0 ? 1 : 0;
    return aBlocked - bBlocked || score(b) - score(a) || a.iteration - b.iteration;
  });
}

function createGenerationOrchestrator(options = {}) {
  const storage = options.storage || null;
  const storageKey = text(options.storageKey, 'generation_jobs');
  const runSubAgent = typeof options.runSubAgent === 'function' ? options.runSubAgent : null;
  const renderCandidate = typeof options.renderCandidate === 'function' ? options.renderCandidate : null;
  const preflight = typeof options.preflight === 'function' ? options.preflight : async () => ({ ready: true });
  const listConversationImages = typeof options.listConversationImages === 'function' ? options.listConversationImages : async () => ({ items: [] });
  const resolveCharacter = typeof options.resolveCharacter === 'function' ? options.resolveCharacter : null;
  const getSettings = typeof options.getSettings === 'function' ? options.getSettings : () => ({});
  const getPromptSnapshot = typeof options.getPromptSnapshot === 'function' ? options.getPromptSnapshot : () => ({});
  const jobs = new Map();
  const active = new Map();

  function readJobs() {
    try {
      const value = storage?.get?.(storageKey, []);
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }
  function writeJobs() {
    try { storage?.set?.(storageKey, [...jobs.values()].map(clone)); } catch { /* persistence is best effort */ }
  }
  function normalizeJob(value) {
    const source = object(value) ? clone(value) : {};
    const status = JOB_STATES.includes(source.status) ? source.status : 'interrupted';
    const candidates = candidateSnapshot(source.candidates || []);
    return {
      ...source,
      jobId: text(source.jobId, `job_${randomUUID()}`),
      sessionId: text(source.sessionId),
      mode: source.mode === 'recreate' ? 'recreate' : 'create',
      status,
      originalRequirements: text(source.originalRequirements || source.requirements),
      requirements: text(source.originalRequirements || source.requirements),
      sourceImageId: text(source.sourceImageId),
      sourceSlot: Number.isInteger(source.sourceSlot) ? source.sourceSlot : null,
      characterQueries: strings(source.characterQueries, 8),
      characterIds: strings(source.characterIds, 8),
      characterReferences: Array.isArray(source.characterReferences) ? clone(source.characterReferences).slice(0, 8) : [],
      brief: object(source.brief) ? clone(source.brief) : {},
      policy: policyFrom(source.policy),
      promptSnapshot: promptSnapshot(source.promptSnapshot),
      positiveTags: strings(source.positiveTags),
      negativeTags: strings(source.negativeTags),
      preserveTags: strings(source.preserveTags),
      candidates,
      selectedCandidateId: text(source.selectedCandidateId),
      selectionReason: text(source.selectionReason),
      renderAttempts: Math.max(0, Number(source.renderAttempts) || 0),
      successfulRenders: candidates.length,
      stopReason: text(source.stopReason),
      events: Array.isArray(source.events) ? clone(source.events).slice(-96) : [],
      errors: Array.isArray(source.errors) ? clone(source.errors).slice(-32) : [],
      createdAt: Number(source.createdAt) || Date.now(),
      updatedAt: Number(source.updatedAt) || Date.now()
    };
  }
  for (const raw of readJobs()) {
    const job = normalizeJob(raw);
    if (RUNNING_STATES.has(job.status)) {
      job.status = 'interrupted';
      job.stopReason = 'application_restarted';
      job.updatedAt = Date.now();
    }
    jobs.set(job.jobId, job);
  }
  if (jobs.size) writeJobs();

  function persist(job) {
    job.updatedAt = Date.now();
    jobs.set(job.jobId, job);
    writeJobs();
    return job;
  }
  function emit(job, context, type, payload = {}) {
    const event = { type, jobId: job.jobId, ...clone(payload), at: Date.now() };
    job.events.push(event);
    if (job.events.length > 96) job.events.shift();
    persist(job);
    try { context.onEvent?.(clone(event)); } catch { /* observers are optional */ }
    return event;
  }
  function transition(job, status) {
    job.status = status;
    return persist(job);
  }
  function result(job) {
    const candidates = candidateSnapshot(job.candidates);
    const final = job.selectedCandidateId ? finalCandidate(candidates, job.selectedCandidateId) : null;
    const selected = final ? candidates.find(candidate => candidate.id === final.finalCandidateId || candidate.imageId === final.finalCandidateId) : null;
    const artifacts = candidates.map(candidate => candidate.artifact || { imageId: candidate.imageId }).filter(item => item?.imageId || item?.id);
    return clone({
      status: job.status,
      jobId: job.jobId,
      sessionId: job.sessionId,
      mode: job.mode,
      requirements: job.originalRequirements,
      originalRequirements: job.originalRequirements,
      sourceImageId: job.sourceImageId,
      recreationMode: job.recreationMode || '',
      needsInput: job.needsInput || null,
      selectedCandidateId: final?.finalCandidateId || '',
      selectedImageId: final?.finalImageId || '',
      selectionReason: job.selectionReason,
      positiveTags: final?.positiveTags || selected?.positiveTags || job.positiveTags,
      negativeTags: final?.negativeTags || selected?.negativeTags || job.negativeTags,
      prompt: final?.finalPrompt || selected?.prompt || job.positiveTags.join(', '),
      negative: final?.finalNegative || selected?.negative || job.negativeTags.join(', '),
      parameters: final?.parameters || selected?.parameters || {},
      workflowProfileId: final?.workflowProfileId || selected?.workflowProfileId || job.workflowProfileId || '',
      workflowRevision: final?.workflowRevision || selected?.workflowRevision || job.workflowRevision || '',
      candidates,
      artifacts,
      imageIds: candidates.map(candidate => candidate.imageId).filter(Boolean),
      renderAttempts: job.renderAttempts,
      successfulRenders: job.successfulRenders,
      stopReason: job.stopReason,
      comparison: job.comparison || null,
      error: job.error || null
    });
  }
  function needsInput(job, context, value) {
    job.needsInput = clone(value);
    transition(job, 'needs_input');
    emit(job, context, 'generation.needs_input', { needsInput: job.needsInput });
    return result(job);
  }
  function runContext(job, source = {}) {
    const controller = new AbortController();
    const external = source.signal;
    const abort = () => { if (!controller.signal.aborted) controller.abort(external.reason || failure('CANCELLED', '请求已取消')); };
    if (external?.aborted) abort(); else external?.addEventListener?.('abort', abort, { once: true });
    const context = { ...source, sessionId: job.sessionId || source.sessionId, signal: controller.signal };
    active.set(job.jobId, { controller, context, external, abort });
    return context;
  }
  function releaseRun(jobId) {
    const value = active.get(jobId);
    value?.external?.removeEventListener?.('abort', value.abort);
    active.delete(jobId);
  }
  function guard(job, context) {
    if (job.status === 'cancelled' || context.signal?.aborted) throw context.signal?.reason || failure('CANCELLED', '请求已取消');
  }
  async function callAgent(job, context, name, input, stage, retry = true) {
    if (!runSubAgent) throw failure('SUBAGENT_UNAVAILABLE', `子代理不可用：${name}`);
    let lastError;
    const attempts = retry ? 2 : 1;
    for (let index = 0; index < attempts; index += 1) {
      guard(job, context);
      try {
        return unwrap(await runSubAgent(name, {
          input: clone(input),
          parentRequestId: context.requestId,
          signal: context.signal,
          sessionId: context.sessionId,
          messageId: context.messageId,
          onEvent: context.onEvent
        }));
      } catch (error) {
        lastError = error;
        if (context.signal.aborted || error?.code === 'CANCELLED') throw error;
        if (index + 1 < attempts) emit(job, context, 'generation.stage_retry', { stage, attempt: index + 2, error: errorValue(error) });
      }
    }
    throw lastError;
  }
  async function conversationImages(job, context) {
    const value = unwrap(await listConversationImages(context.sessionId, context));
    return Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
  }
  async function resolveSource(job, context) {
    if (job.mode !== 'recreate') return true;
    const rows = await conversationImages(job, context);
    if (!job.sourceImageId && Number.isInteger(job.sourceSlot)) {
      job.sourceImageId = text(rows.find(item => Number(item?.slotNo) === job.sourceSlot)?.imageId);
    }
    if (!job.sourceImageId) return needsInput(job, context, { kind: 'source_image', message: '请选择当前会话中的参考原图', availableImages: rows.map(item => ({ imageId: text(item?.imageId || item?.id), slotNo: Number(item?.slotNo) || 0 })).filter(item => item.imageId) });
    if (!rows.some(item => text(item?.imageId || item?.id) === job.sourceImageId)) {
      return needsInput(job, context, { kind: 'source_image', message: '参考原图不在当前会话中', requestedImageId: job.sourceImageId, availableImages: rows.map(item => ({ imageId: text(item?.imageId || item?.id), slotNo: Number(item?.slotNo) || 0 })).filter(item => item.imageId) });
    }
    persist(job);
    return true;
  }
  function characterRows(value) {
    const source = unwrap(value);
    if (Array.isArray(source)) return source;
    if (Array.isArray(source?.items)) return source.items;
    return object(source) && source.id ? [source] : [];
  }
  async function resolveCharacters(job, context) {
    if (!resolveCharacter) return true;
    const selected = [];
    for (const query of job.characterQueries) {
      guard(job, context);
      const rows = characterRows(await resolveCharacter(query, { ...context, mode: 'query' }));
      if (rows.length !== 1) return needsInput(job, context, { kind: 'character', query, message: rows.length ? '角色名称有多个匹配项，请选择具体角色' : '没有找到角色，请补充名称或直接选择角色', options: rows.slice(0, 10).map(item => ({ id: text(item?.id), name: text(item?.nameZh || item?.name), series: text(item?.seriesName || item?.series) })) });
      selected.push(rows[0]);
    }
    for (const characterId of job.characterIds) {
      if (selected.some(item => text(item?.id) === characterId)) continue;
      const rows = characterRows(await resolveCharacter(characterId, { ...context, mode: 'id' }));
      if (rows.length === 1) selected.push(rows[0]);
    }
    job.characterReferences = selected.slice(0, 8).map(item => ({
      id: text(item?.id), name: text(item?.nameZh || item?.name), series: text(item?.seriesName || item?.series),
      identityTags: strings(item?.identityTags),
      generalTags: strings((item?.generalTags || []).map(tag => tag?.en || tag)),
      specificTags: strings((item?.specificTags || []).map(tag => tag?.en || tag))
    })).filter(item => item.id);
    job.characterIds = strings([...job.characterIds, ...job.characterReferences.map(item => item.id)], 8);
    persist(job);
    return true;
  }
  async function prepare(job, context) {
    transition(job, 'preparing');
    const source = await resolveSource(job, context);
    if (source !== true) return source;
    const characters = await resolveCharacters(job, context);
    if (characters !== true) return characters;
    if (job.mode === 'recreate' && !object(job.visualBlueprint)) {
      const value = await callAgent(job, context, 'vision', { imageId: job.sourceImageId, mode: 'ai', instruction: '生成用于图片复刻的紧凑视觉蓝图，涵盖人物、外貌、姿势、视角、构图、服装、场景、光照、风格和必须保留项。' }, 'source_inspection');
      job.visualBlueprint = compactBlueprint(value);
      emit(job, context, 'source.inspected', { sourceImageId: job.sourceImageId });
    }
    job.brief = {
      mode: job.mode,
      requirements: job.originalRequirements,
      sourceImageId: job.sourceImageId,
      characterIds: job.characterIds.slice(),
      visualBlueprint: clone(job.visualBlueprint || {})
    };
    persist(job);
    return true;
  }
  async function compile(job, context) {
    if (job.positiveTags.length) return true;
    transition(job, 'compiling');
    const value = await callAgent(job, context, 'generateTags', {
      operation: 'compile',
      requirements: job.requirements,
      description: blueprintText(job.visualBlueprint),
      ...(job.sourceImageId ? { imageId: job.sourceImageId } : {}),
      ...(job.characterReferences.length ? { characterReferences: job.characterReferences } : {})
    }, 'prompt_compile');
    job.positiveTags = strings(value?.positiveTags || value?.tags);
    job.negativeTags = strings(value?.negativeTags);
    if (!job.positiveTags.length) throw failure('OUTPUT_INVALID', '文生图 Tag 子代理未返回正向 Tag');
    emit(job, context, 'prompt.compiled', { positiveTagCount: job.positiveTags.length, negativeTagCount: job.negativeTags.length });
    return true;
  }
  async function checkPreflight(job, context) {
    const value = unwrap(await preflight(clone({ mode: job.mode, sourceImageId: job.sourceImageId, workflowProfileId: job.workflowProfileId }), context));
    if (value?.ready === false || value?.connected === false) return needsInput(job, context, { kind: 'workflow', message: text(value?.error, value?.connected === false ? 'ComfyUI 未连接' : '当前工作流不可用'), workflowProfileId: text(value?.workflowProfileId) });
    job.workflowProfileId = text(value?.workflowProfileId, job.workflowProfileId);
    job.workflowRevision = text(value?.workflowRevision, job.workflowRevision);
    job.recreationMode = job.mode === 'recreate' ? text(value?.recreationMode, 'text_approximation') : '';
    persist(job);
    return true;
  }
  async function evaluateOne(job, candidate, context) {
    transition(job, 'evaluating');
    try {
      const value = await callAgent(job, context, 'evaluateImages', {
        operation: 'review', mode: job.mode, brief: job.brief,
        ...(job.sourceImageId ? { sourceImageId: job.sourceImageId } : {}),
        candidateImageIds: [candidate.imageId],
        previousEvaluations: job.candidates.filter(item => item.id !== candidate.id && reviewed(item)).map(item => item.evaluation).slice(-2)
      }, 'candidate_review', false);
      const evaluation = value?.evaluations?.find(item => item.candidateId === candidate.imageId || item.candidateId === candidate.id) || value?.evaluations?.[0];
      if (!evaluation) throw failure('OUTPUT_INVALID', '候选图评估结果为空');
      job.candidates = setCandidateEvaluation(job.candidates, candidate.id, { ...clone(evaluation), status: 'reviewed', recommended: false });
      emit(job, context, 'candidate.evaluated', { candidateId: candidate.id, imageId: candidate.imageId, score: number(evaluation.score, 0, 0, 100), verdict: text(evaluation.verdict, 'revise'), hardErrorCount: Array.isArray(evaluation.hardErrors) ? evaluation.hardErrors.length : 0 });
      return activeCandidate(job, candidate.id)?.evaluation || null;
    } catch (error) {
      if (context.signal.aborted || error?.code === 'CANCELLED') throw error;
      const unavailable = { status: 'evaluation_unavailable', summary: '候选图评价暂不可用', error: errorValue(error), hardErrors: [], issues: [], suggestedChanges: [], recommended: false };
      job.candidates = setCandidateEvaluation(job.candidates, candidate.id, unavailable);
      emit(job, context, 'candidate.evaluated', { candidateId: candidate.id, imageId: candidate.imageId, status: 'evaluation_unavailable', error: unavailable.error });
      return unavailable;
    }
  }
  function stoppingReason(job) {
    const minimum = minimumCandidates(job.policy);
    if (job.successfulRenders < minimum) return '';
    if (job.policy.strategy === 'quick') return 'quick';
    if (job.policy.strategy === 'fixed3') return job.successfulRenders >= candidateLimit(job.policy) ? 'max_successful_renders' : '';
    const reviewedRows = job.candidates.filter(reviewed);
    if (reviewedRows.some(candidate => hardErrorCount(candidate) === 0 && score(candidate) >= job.policy.acceptScore && candidate.evaluation.verdict === 'accept')) return 'accepted';
    if (reviewedRows.length >= 2) {
      const latest = reviewedRows.at(-1);
      const previousBest = Math.max(...reviewedRows.slice(0, -1).map(score));
      if (score(latest) < previousBest + job.policy.minImprovement) return 'no_improvement';
    }
    if (job.successfulRenders >= candidateLimit(job.policy)) return 'max_successful_renders';
    return '';
  }
  async function revise(job, evaluation, context) {
    if (!evaluation || evaluation.status !== 'reviewed' || evaluation.verdict === 'accept') return false;
    transition(job, 'revising');
    try {
      const patch = await callAgent(job, context, 'generateTags', {
        operation: 'revise',
        requirements: job.originalRequirements,
        description: blueprintText(job.visualBlueprint),
        positiveTags: job.positiveTags,
        negativeTags: job.negativeTags,
        evaluation: clone(evaluation),
        ...(job.characterReferences.length ? { characterReferences: job.characterReferences } : {})
      }, 'prompt_revision');
      const next = applyPromptPatch(job, patch);
      job.positiveTags = next.positiveTags;
      job.negativeTags = next.negativeTags;
      job.preserveTags = next.preserveTags;
      emit(job, context, 'prompt.revised', { positiveTagCount: job.positiveTags.length, negativeTagCount: job.negativeTags.length });
      return true;
    } catch (error) {
      if (context.signal.aborted || error?.code === 'CANCELLED') throw error;
      job.errors.push({ stage: 'prompt_revision', ...errorValue(error), at: Date.now() });
      emit(job, context, 'prompt.revision_failed', { error: errorValue(error) });
      return false;
    }
  }
  async function renderLoop(job, context) {
    if (!renderCandidate) throw failure('COMFY_UNAVAILABLE', 'ComfyUI 渲染器不可用');
    const limit = candidateLimit(job.policy);
    while (job.successfulRenders < limit && job.renderAttempts < job.policy.maxRenderAttempts) {
      guard(job, context);
      transition(job, 'rendering');
      job.renderAttempts += 1;
      const iteration = job.successfulRenders + 1;
      emit(job, context, 'candidate.rendering', { iteration, attempt: job.renderAttempts });
      let rendered;
      try {
        rendered = await renderCandidate({
          jobId: job.jobId,
          iteration,
          mode: job.mode,
          sourceImageId: job.sourceImageId,
          positiveTags: job.positiveTags.slice(),
          negativeTags: job.negativeTags.slice(),
          workflowProfileId: job.workflowProfileId,
          recreationMode: job.recreationMode
        }, context);
        guard(job, context);
      } catch (error) {
        if (context.signal.aborted || error?.code === 'CANCELLED') throw error;
        const value = errorValue(error);
        job.errors.push({ stage: 'render', attempt: job.renderAttempts, ...value, at: Date.now() });
        emit(job, context, 'candidate.failed', { attempt: job.renderAttempts, error: value });
        continue;
      }
      const artifacts = normalizeArtifactRows(rendered);
      if (!artifacts.length) {
        const value = errorValue(failure('OUTPUT_INVALID', 'ComfyUI 未返回图片'));
        job.errors.push({ stage: 'render', attempt: job.renderAttempts, ...value, at: Date.now() });
        emit(job, context, 'candidate.failed', { attempt: job.renderAttempts, error: value });
        continue;
      }
      let latestEvaluation = null;
      for (const artifact of artifacts) {
        if (job.successfulRenders >= limit) break;
        job.successfulRenders += 1;
        const candidateId = `candidate-${job.successfulRenders}`;
        job.candidates = addCandidate(job.candidates, {
          id: candidateId,
          iteration: job.successfulRenders,
          imageId: artifact.imageId,
          artifact,
          positiveTags: job.positiveTags,
          negativeTags: job.negativeTags,
          prompt: job.positiveTags.join(', '),
          negative: job.negativeTags.join(', '),
          parameters: object(rendered?.parameters) ? rendered.parameters : object(artifact.parameters) ? artifact.parameters : {},
          workflowProfileId: text(rendered?.workflowProfileId, job.workflowProfileId),
          workflowRevision: text(rendered?.workflowRevision, job.workflowRevision),
          recreationMode: text(rendered?.recreationMode, job.recreationMode)
        });
        emit(job, context, 'candidate.ready', { candidateId, imageId: artifact.imageId, iteration: job.successfulRenders });
        latestEvaluation = await evaluateOne(job, activeCandidate(job, candidateId), context);
      }
      job.stopReason = stoppingReason(job);
      persist(job);
      if (job.stopReason) break;
      await revise(job, latestEvaluation, context);
    }
    if (!job.stopReason) {
      if (job.successfulRenders >= limit) job.stopReason = job.policy.strategy === 'quick' ? 'quick' : 'max_successful_renders';
      else if (job.renderAttempts >= job.policy.maxRenderAttempts) job.stopReason = 'render_attempts_exhausted';
    }
    persist(job);
  }
  async function chooseRecommendation(job, context) {
    transition(job, 'selecting');
    const ranked = programRanking(job.candidates);
    let recommended = '';
    let reason = '';
    if (job.candidates.length === 1) {
      recommended = job.candidates[0].id;
      reason = '仅有一个成功候选';
    } else if (job.candidates.length >= 2) {
      try {
        const comparison = await callAgent(job, context, 'evaluateImages', {
          operation: 'compare', mode: job.mode, brief: job.brief,
          ...(job.sourceImageId ? { sourceImageId: job.sourceImageId } : {}),
          candidateImageIds: job.candidates.map(candidate => candidate.imageId),
          previousEvaluations: job.candidates.filter(reviewed).map(candidate => candidate.evaluation)
        }, 'candidate_compare', false);
        job.comparison = clone(comparison);
        const proposed = activeCandidate(job, comparison?.recommendedCandidateId);
        const cleanExists = ranked.some(candidate => reviewed(candidate) && hardErrorCount(candidate) === 0);
        const legal = proposed && !(cleanExists && hardErrorCount(proposed) > 0);
        recommended = legal ? proposed.id : ranked[0]?.id || '';
        reason = legal ? text(comparison.reason, '候选图横向比较结果') : '评估推荐不满足硬约束，已按硬约束和单图评分回退';
      } catch (error) {
        if (context.signal.aborted || error?.code === 'CANCELLED') throw error;
        job.comparison = { status: 'evaluation_unavailable', error: errorValue(error) };
        if (ranked.some(reviewed)) {
          recommended = ranked[0]?.id || '';
          reason = '横向比较不可用，已按单图硬约束和评分排序';
        }
      }
    }
    if (recommended) {
      job.candidates = markRecommended(job.candidates, recommended);
      job.selectionReason = reason;
      emit(job, context, 'candidate.recommended', { candidateId: recommended, imageId: activeCandidate(job, recommended)?.imageId, reason });
      if (job.policy.autoSelect) {
        job.candidates = selectCandidateRows(job.candidates, recommended, 'ai');
        job.selectedCandidateId = recommended;
      }
    }
    persist(job);
  }
  async function runJob(job, sourceContext) {
    const context = runContext(job, sourceContext);
    job.needsInput = null;
    job.error = null;
    try {
      emit(job, context, 'generation.started', { mode: job.mode, strategy: job.policy.strategy });
      const prepared = await prepare(job, context);
      if (prepared !== true) return prepared;
      await compile(job, context);
      const ready = await checkPreflight(job, context);
      if (ready !== true) return ready;
      await renderLoop(job, context);
      guard(job, context);
      if (!job.candidates.length) throw failure('NO_CANDIDATE', '在允许的尝试次数内没有生成可用图片');
      await chooseRecommendation(job, context);
      transition(job, 'completed');
      emit(job, context, 'generation.completed', { candidateCount: job.candidates.length, selectedCandidateId: job.selectedCandidateId, stopReason: job.stopReason });
      return result(job);
    } catch (error) {
      if (job.status === 'cancelled' || context.signal.aborted || error?.code === 'CANCELLED') {
        job.status = 'cancelled';
        job.stopReason = 'cancelled';
        persist(job);
        emit(job, context, 'generation.cancelled', { candidateCount: job.candidates.length });
        return result(job);
      }
      job.error = errorValue(error);
      job.status = 'failed';
      job.stopReason = job.stopReason || 'failed';
      persist(job);
      emit(job, context, 'generation.failed', { error: job.error, candidateCount: job.candidates.length });
      return result(job);
    } finally {
      releaseRun(job.jobId);
    }
  }
  async function execute(input = {}, context = {}) {
    const originalRequirements = text(input.originalRequirements || input.requirements);
    if (!originalRequirements) throw failure('INVALID_INPUT', '生成任务缺少 originalRequirements');
    let mode = ['create', 'recreate'].includes(input.mode) ? input.mode : 'auto';
    if (mode === 'auto') mode = input.sourceImageId || Number.isInteger(input.sourceSlot) ? 'recreate' : 'create';
    const policy = policyFrom({ strategy: input.strategy, autoSelect: input.autoSelect }, getSettings());
    const now = Date.now();
    const job = normalizeJob({
      jobId: `job_${randomUUID()}`,
      sessionId: text(context.sessionId),
      mode,
      status: 'preparing',
      originalRequirements,
      requirements: originalRequirements,
      sourceImageId: text(input.sourceImageId),
      sourceSlot: Number.isInteger(input.sourceSlot) ? input.sourceSlot : null,
      characterQueries: strings(input.characterQueries, 8),
      characterIds: strings(input.characterIds, 8),
      workflowProfileId: text(input.workflowProfileId),
      policy,
      promptSnapshot: promptSnapshot(getPromptSnapshot()),
      candidates: [],
      renderAttempts: 0,
      successfulRenders: 0,
      createdAt: now,
      updatedAt: now
    });
    persist(job);
    return runJob(job, context);
  }
  async function resume(input = {}, context = {}) {
    const job = jobs.get(text(input.jobId));
    if (!job) throw failure('JOB_NOT_FOUND', '没有找到生成任务');
    if (TERMINAL_STATES.has(job.status)) return result(job);
    if (active.has(job.jobId)) throw failure('JOB_BUSY', '生成任务仍在执行中');
    if (input.sourceImageId !== undefined) job.sourceImageId = text(input.sourceImageId);
    if (input.characterIds !== undefined) {
      job.characterIds = strings(input.characterIds, 8);
      job.characterQueries = [];
      job.characterReferences = [];
    }
    if (input.workflowProfileId !== undefined) job.workflowProfileId = text(input.workflowProfileId);
    job.policy = policyFrom({ strategy: input.strategy ?? job.policy.strategy, autoSelect: input.autoSelect ?? job.policy.autoSelect }, { generation: job.policy });
    job.sessionId = text(context.sessionId, job.sessionId);
    job.status = 'preparing';
    persist(job);
    return runJob(job, context);
  }
  function cancel(jobId) {
    const job = jobs.get(text(jobId));
    if (!job || TERMINAL_STATES.has(job.status)) return false;
    job.status = 'cancelled';
    job.stopReason = 'cancelled';
    persist(job);
    const running = active.get(job.jobId);
    if (running && !running.controller.signal.aborted) running.controller.abort(failure('CANCELLED', '生成任务已取消'));
    return true;
  }
  function get(jobId) {
    const job = jobs.get(text(jobId));
    return job ? result(job) : null;
  }
  function list() {
    return [...jobs.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(result);
  }
  function selectCandidate(jobId, candidateId, source = 'user') {
    const job = jobs.get(text(jobId));
    if (!job) return null;
    const candidate = activeCandidate(job, text(candidateId));
    if (!candidate) return null;
    job.candidates = selectCandidateRows(job.candidates, candidate.id, source);
    job.selectedCandidateId = candidate.id;
    job.selectionReason = source === 'user' ? '用户手动选择' : job.selectionReason;
    persist(job);
    return result(job);
  }

  return Object.freeze({ execute, resume, cancel, get, list, selectCandidate });
}

module.exports = {
  JOB_STATES,
  GENERATION_STRATEGIES,
  DEFAULT_GENERATION_POLICY,
  createGenerationOrchestrator,
  applyPromptPatch,
  policyFrom
};
