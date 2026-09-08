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
const { applyPromptPatch } = require('./prompt-patch');

const JOB_STATES = Object.freeze([
  'preparing', 'compiling', 'rendering', 'evaluating', 'revising', 'selecting',
  'needs_input', 'awaiting_feedback', 'finishing', 'completed', 'failed', 'cancelled', 'interrupted'
]);
const RUNNING_STATES = new Set(['preparing', 'compiling', 'rendering', 'evaluating', 'revising', 'selecting', 'finishing']);
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const GENERATION_STRATEGIES = Object.freeze(['quick', 'auto', 'fixed3']);
const GENERATION_OUTCOMES = Object.freeze(['', 'accepted', 'best_available', 'user_selected', 'user_selected_with_issues', 'cancelled', 'failed']);
const DEFAULT_GENERATION_POLICY = Object.freeze({
  autoRun: true,
  imagesPerRound: 1,
  maxAutoRounds: 3,
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
  const overrides = Object.fromEntries(Object.entries(object(value) ? value : {}).filter(([, item]) => item !== undefined));
  const source = { ...DEFAULT_GENERATION_POLICY, ...configured, ...overrides };
  const strategy = GENERATION_STRATEGIES.includes(source.strategy) ? source.strategy : GENERATION_STRATEGIES.includes(source.legacyStrategy) ? source.legacyStrategy : '';
  const autoRun = source.autoRun !== false;
  const explicitMaxRounds = overrides.maxAutoRounds ?? configured.maxAutoRounds;
  const maxAutoRounds = Math.round(number(explicitMaxRounds, strategy === 'quick' ? 1 : 3, 1, 10));
  return {
    autoRun,
    autoSelect: source.autoSelect !== false,
    imagesPerRound: Math.round(number(source.imagesPerRound ?? settings?.comfy?.batchCount, 1, 1, 10)),
    maxAutoRounds,
    forceMaxRounds: source.forceMaxRounds === true || strategy === 'fixed3',
    legacyStrategy: strategy,
    maxRenderAttempts: Math.max(maxAutoRounds, Math.round(number(source.maxRenderAttempts, 5, 1, 10))),
    acceptScore: number(source.acceptScore, 90, 0, 100),
    minImprovement: number(source.minImprovement, 3, 0, 100)
  };
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
function activeCandidate(job, id) {
  return job.candidates.find(candidate => candidate.id === id || candidate.imageId === id) || null;
}
function reviewed(candidate) { return candidate?.evaluation?.status === 'reviewed'; }
function hardErrorCount(candidate) { return Array.isArray(candidate?.evaluation?.hardErrors) ? candidate.evaluation.hardErrors.length : 0; }
function score(candidate) { return reviewed(candidate) ? number(candidate.evaluation.score, 0, 0, 100) : -1; }
function residualIssues(candidate, limit = 6) {
  const rows = [...(Array.isArray(candidate?.evaluation?.hardErrors) ? candidate.evaluation.hardErrors : []), ...(Array.isArray(candidate?.evaluation?.issues) ? candidate.evaluation.issues : [])];
  const seen = new Set();
  const output = [];
  for (const value of rows) {
    const issue = object(value) ? {
      expected: text(value.expected), observed: text(value.observed), severity: text(value.severity, 'major'), suggestedChange: text(value.suggestedChange)
    } : { expected: '', observed: text(value), severity: 'major', suggestedChange: '' };
    const key = `${issue.expected}|${issue.observed}|${issue.suggestedChange}`;
    if (!issue.observed && !issue.expected || seen.has(key)) continue;
    seen.add(key);
    output.push(issue);
    if (output.length >= limit) break;
  }
  return output;
}
function classifyOutcome(candidate, source = 'program', acceptScore = 90) {
  if (source === 'user') return hardErrorCount(candidate) > 0 ? 'user_selected_with_issues' : 'user_selected';
  return reviewed(candidate) && hardErrorCount(candidate) === 0 && candidate.evaluation?.verdict === 'accept' && score(candidate) >= acceptScore
    ? 'accepted'
    : 'best_available';
}
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
  const cancelRender = typeof options.cancelRender === 'function' ? options.cancelRender : async () => null;
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
    let rounds = Array.isArray(source.rounds) ? source.rounds.filter(object).map((round, index) => ({
      roundId: text(round.roundId, `round-${index + 1}`),
      roundIndex: Math.max(1, Number(round.roundIndex) || index + 1),
      candidateIds: strings(round.candidateIds, 8),
      recommendedCandidateId: text(round.recommendedCandidateId),
      prompt: text(round.prompt),
      negative: text(round.negative),
      createdAt: Number(round.createdAt) || Date.now()
    })) : [];
    if (!rounds.length && candidates.length) rounds = candidates.map((candidate, index) => ({ roundId: candidate.roundId || `round-${index + 1}`, roundIndex: candidate.roundIndex || index + 1, candidateIds: [candidate.id], recommendedCandidateId: candidate.evaluation?.recommended ? candidate.id : '', prompt: candidate.prompt, negative: candidate.negative, createdAt: candidate.createdAt }));
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
      lockedTags: strings(source.lockedTags),
      candidates,
      rounds,
      selectedCandidateId: text(source.selectedCandidateId),
      outcome: GENERATION_OUTCOMES.includes(source.outcome) ? source.outcome : '',
      residualIssues: Array.isArray(source.residualIssues) ? clone(source.residualIssues).slice(0, 6) : [],
      recreationMode: text(source.recreationMode),
      aspectRatioMode: text(source.aspectRatioMode),
      selectionReason: text(source.selectionReason),
      renderAttempts: Math.max(0, Number(source.renderAttempts) || 0),
      successfulRenders: candidates.length,
      successfulRounds: Math.max(rounds.length, Number(source.successfulRounds) || 0),
      stopReason: text(source.stopReason),
      events: Array.isArray(source.events) ? clone(source.events).slice(-96) : [],
      errors: Array.isArray(source.errors) ? clone(source.errors).slice(-32) : [],
      patchWarnings: Array.isArray(source.patchWarnings) ? clone(source.patchWarnings).slice(-32) : [],
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
      aspectRatioMode: job.aspectRatioMode || '',
      outcome: job.outcome || '',
      residualIssues: clone(job.residualIssues || []),
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
      successfulRounds: job.successfulRounds,
      rounds: clone(job.rounds),
      stopReason: job.stopReason,
      comparison: job.comparison || null,
      error: job.error || null
    });
  }
  function uiSnapshot(jobId) {
    const job = object(jobId) ? jobId : jobs.get(text(jobId));
    return job ? result(job) : null;
  }
  function publicResult(jobId) {
    const job = object(jobId) ? jobId : jobs.get(text(jobId));
    if (!job) return null;
    const candidates = candidateSnapshot(job.candidates);
    const selected = activeCandidate(job, job.selectedCandidateId) || candidates.find(candidate => candidate.evaluation?.recommended) || null;
    const compactIssue = issue => ({
      expected: text(issue?.expected).slice(0, 240),
      observed: text(issue?.observed).slice(0, 240),
      severity: text(issue?.severity, 'major').slice(0, 16),
      suggestedChange: text(issue?.suggestedChange).slice(0, 240)
    });
    const nextAction = job.status === 'needs_input' ? 'provide_input' : job.status === 'awaiting_feedback' ? 'provide_feedback_or_select' : '';
    return clone({
      jobId: job.jobId,
      status: job.status,
      outcome: job.outcome || '',
      mode: job.mode,
      recreationMode: job.recreationMode || '',
      aspectRatioMode: job.aspectRatioMode || '',
      selected: selected ? {
        candidateId: selected.id,
        imageId: selected.imageId,
        prompt: selected.prompt,
        negative: selected.negative,
        positiveTags: selected.positiveTags,
        negativeTags: selected.negativeTags,
        parameters: selected.parameters || {}
      } : null,
      selectedCandidateId: job.selectedCandidateId || '',
      candidates: candidates.map(candidate => ({
        candidateId: candidate.id,
        imageId: candidate.imageId,
        roundIndex: candidate.roundIndex,
        score: reviewed(candidate) ? score(candidate) : null,
        verdict: text(candidate.evaluation?.verdict),
        hardErrorCount: hardErrorCount(candidate),
        summary: text(candidate.evaluation?.summary).slice(0, 240)
      })),
      residualIssues: (job.residualIssues || []).slice(0, 6).map(compactIssue),
      needsInput: job.needsInput ? clone(job.needsInput) : null,
      stopReason: job.stopReason,
      successfulRounds: job.successfulRounds,
      renderAttempts: job.renderAttempts,
      error: job.error || null,
      nextAction
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
    if (job.stopReason === 'user_selected' || job.status === 'finishing') throw failure('USER_SELECTED', '用户已选择最终候选');
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
  function stoppingReason(job, winner) {
    if (!job.policy.autoRun) return '';
    if (!job.policy.forceMaxRounds && winner && hardErrorCount(winner) === 0 && score(winner) >= job.policy.acceptScore && winner.evaluation?.verdict === 'accept') return 'accepted';
    const winners = job.rounds.map(round => activeCandidate(job, round.recommendedCandidateId)).filter(reviewed);
    if (!job.policy.forceMaxRounds && winners.length >= 2) {
      const latest = winners.at(-1);
      const previousBest = Math.max(...winners.slice(0, -1).map(score));
      if (score(latest) < previousBest + job.policy.minImprovement) return 'no_improvement';
    }
    if (job.successfulRounds >= job.policy.maxAutoRounds) return job.policy.legacyStrategy === 'quick' ? 'quick' : 'max_auto_rounds';
    return '';
  }
  async function revise(job, evaluation, context, force = false) {
    if (!evaluation || evaluation.status !== 'reviewed' || (!force && evaluation.verdict === 'accept')) return false;
    transition(job, 'revising');
    try {
      let patch = await callAgent(job, context, 'generateTags', {
        operation: 'revise',
        requirements: job.originalRequirements,
        description: blueprintText(job.visualBlueprint),
        positiveTags: job.positiveTags,
        negativeTags: job.negativeTags,
        evaluation: clone(evaluation),
        ...(job.characterReferences.length ? { characterReferences: job.characterReferences } : {})
      }, 'prompt_revision');
      const patchOptions = { negativeEnabled: getSettings()?.generateNegativeTags === true, allowedPositiveNegations: ['no humans'] };
      let next = applyPromptPatch(job, patch, patchOptions);
      if (!next.ok) {
        patch = await callAgent(job, context, 'generateTags', {
          operation: 'revise',
          requirements: job.originalRequirements,
          description: blueprintText(job.visualBlueprint),
          positiveTags: job.positiveTags,
          negativeTags: job.negativeTags,
          evaluation: { ...clone(evaluation), patchValidation: { rejected: next.rejected, warnings: next.warnings } },
          ...(job.characterReferences.length ? { characterReferences: job.characterReferences } : {})
        }, 'prompt_patch_repair', false);
        next = applyPromptPatch(job, patch, patchOptions);
      }
      if (!next.ok) throw failure('OUTPUT_INVALID', next.rejected.map(item => item.message).join('；') || 'Tag 修订补丁无效');
      job.positiveTags = next.positiveTags;
      job.negativeTags = next.negativeTags;
      job.lockedTags = next.lockedTags;
      job.patchWarnings = [...(job.patchWarnings || []), ...next.warnings].slice(-32);
      emit(job, context, 'prompt.revised', { positiveTagCount: job.positiveTags.length, negativeTagCount: job.negativeTags.length, warningCount: next.warnings.length });
      return true;
    } catch (error) {
      if (context.signal.aborted || error?.code === 'CANCELLED') throw error;
      job.errors.push({ stage: 'prompt_revision', ...errorValue(error), at: Date.now() });
      emit(job, context, 'prompt.revision_failed', { error: errorValue(error) });
      return false;
    }
  }
  async function compareCandidates(job, candidates, context, stage) {
    const ranked = programRanking(candidates);
    if (!ranked.length) return { candidate: null, comparison: null, reason: '' };
    if (ranked.length === 1) return { candidate: ranked[0], comparison: null, reason: '仅有一个成功候选' };
    const finalists = ranked.slice(0, 3);
    try {
      const comparison = await callAgent(job, context, 'evaluateImages', {
        operation: 'compare', mode: job.mode, brief: job.brief,
        ...(job.sourceImageId ? { sourceImageId: job.sourceImageId } : {}),
        candidateImageIds: finalists.map(candidate => candidate.imageId),
        previousEvaluations: finalists.filter(reviewed).map(candidate => candidate.evaluation)
      }, stage, false);
      const proposed = activeCandidate(job, comparison?.recommendedCandidateId);
      const cleanExists = ranked.some(candidate => reviewed(candidate) && hardErrorCount(candidate) === 0);
      const legal = proposed && finalists.some(candidate => candidate.id === proposed.id) && !(cleanExists && hardErrorCount(proposed) > 0);
      return { candidate: legal ? proposed : ranked[0], comparison: clone(comparison), reason: legal ? text(comparison.reason, '候选图横向比较结果') : '评估推荐不满足硬约束，已按硬约束和单图评分回退' };
    } catch (error) {
      if (context.signal.aborted || error?.code === 'CANCELLED') throw error;
      return { candidate: ranked.some(reviewed) ? ranked[0] : null, comparison: { status: 'evaluation_unavailable', error: errorValue(error) }, reason: ranked.some(reviewed) ? '横向比较不可用，已按单图硬约束和评分排序' : '' };
    }
  }
  async function renderRound(job, context) {
    if (!renderCandidate) throw failure('COMFY_UNAVAILABLE', 'ComfyUI 渲染器不可用');
    while (job.renderAttempts < job.policy.maxRenderAttempts) {
      guard(job, context);
      transition(job, 'rendering');
      job.renderAttempts += 1;
      const roundIndex = job.successfulRounds + 1;
      const roundId = `round-${roundIndex}`;
      emit(job, context, 'candidate.rendering', { roundId, roundIndex, iteration: job.candidates.length + 1, attempt: job.renderAttempts, imagesPerRound: job.policy.imagesPerRound });
      let rendered;
      try {
        rendered = await renderCandidate({
          jobId: job.jobId,
          iteration: roundIndex,
          roundId,
          roundIndex,
          batchCount: job.policy.imagesPerRound,
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
      const artifacts = normalizeArtifactRows(rendered).slice(0, job.policy.imagesPerRound);
      if (!artifacts.length) {
        const value = errorValue(failure('OUTPUT_INVALID', 'ComfyUI 未返回图片'));
        job.errors.push({ stage: 'render', attempt: job.renderAttempts, ...value, at: Date.now() });
        emit(job, context, 'candidate.failed', { attempt: job.renderAttempts, error: value });
        continue;
      }
      const candidateIds = [];
      if (job.mode === 'recreate') {
        job.recreationMode = text(rendered?.recreationMode, job.recreationMode || 'text_approximation');
        job.aspectRatioMode = text(rendered?.aspectRatioMode, job.aspectRatioMode || 'workflow_fixed');
      }
      job.successfulRounds += 1;
      for (const [indexInRound, artifact] of artifacts.entries()) {
        job.successfulRenders += 1;
        const candidateId = `candidate-${job.successfulRenders}`;
        candidateIds.push(candidateId);
        job.candidates = addCandidate(job.candidates, {
          id: candidateId,
          iteration: job.successfulRenders,
          roundId,
          roundIndex,
          indexInRound: indexInRound + 1,
          imageId: artifact.imageId,
          artifact,
          positiveTags: job.positiveTags,
          negativeTags: job.negativeTags,
          prompt: job.positiveTags.join(', '),
          negative: job.negativeTags.join(', '),
          parameters: object(rendered?.parameters) ? rendered.parameters : object(artifact.parameters) ? artifact.parameters : {},
          workflowProfileId: text(rendered?.workflowProfileId, job.workflowProfileId),
          workflowRevision: text(rendered?.workflowRevision, job.workflowRevision),
          recreationMode: text(rendered?.recreationMode, job.recreationMode),
          aspectRatioMode: text(rendered?.aspectRatioMode, job.aspectRatioMode)
        });
        emit(job, context, 'candidate.ready', { candidateId, imageId: artifact.imageId, iteration: job.successfulRenders, roundId, roundIndex, indexInRound: indexInRound + 1 });
        await evaluateOne(job, activeCandidate(job, candidateId), context);
      }
      const roundCandidates = candidateIds.map(id => activeCandidate(job, id)).filter(Boolean);
      const recommendation = await compareCandidates(job, roundCandidates, context, 'round_compare');
      if (recommendation.candidate) {
        job.candidates = job.candidates.map(candidate => ({ ...candidate, roundRecommended: candidate.id === recommendation.candidate.id }));
      }
      const round = { roundId, roundIndex, candidateIds, recommendedCandidateId: recommendation.candidate?.id || '', prompt: job.positiveTags.join(', '), negative: job.negativeTags.join(', '), comparison: recommendation.comparison, createdAt: Date.now() };
      job.rounds.push(round);
      emit(job, context, 'round.completed', { roundId, roundIndex, candidateCount: candidateIds.length, recommendedCandidateId: round.recommendedCandidateId });
      persist(job);
      return { round, winner: recommendation.candidate };
    }
    return null;
  }
  async function renderLoop(job, context) {
    const roundsThisRun = job.policy.autoRun ? Math.max(0, job.policy.maxAutoRounds - job.successfulRounds) : 1;
    for (let index = 0; index < roundsThisRun && job.renderAttempts < job.policy.maxRenderAttempts; index += 1) {
      const rendered = await renderRound(job, context);
      if (!rendered) break;
      if (!job.policy.autoRun) {
        job.status = 'awaiting_feedback';
        job.stopReason = 'awaiting_feedback';
        emit(job, context, 'generation.awaiting_feedback', { roundId: rendered.round.roundId, recommendedCandidateId: rendered.round.recommendedCandidateId });
        return;
      }
      job.stopReason = stoppingReason(job, rendered.winner);
      persist(job);
      if (job.stopReason) break;
      await revise(job, rendered.winner?.evaluation, context);
    }
    if (!job.stopReason) job.stopReason = job.renderAttempts >= job.policy.maxRenderAttempts ? 'render_attempts_exhausted' : 'max_auto_rounds';
    persist(job);
  }
  async function chooseRecommendation(job, context) {
    transition(job, 'selecting');
    const finalists = job.rounds.map(round => activeCandidate(job, round.recommendedCandidateId)).filter(Boolean);
    const recommendation = await compareCandidates(job, finalists.length ? finalists : job.candidates, context, 'candidate_compare');
    const recommended = recommendation.candidate?.id || '';
    const reason = recommendation.reason;
    job.comparison = recommendation.comparison;
    if (recommended) {
      job.candidates = markRecommended(job.candidates, recommended);
      job.selectionReason = reason;
      emit(job, context, 'candidate.recommended', { candidateId: recommended, imageId: activeCandidate(job, recommended)?.imageId, reason });
      if (job.policy.autoSelect !== false) {
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
      emit(job, context, 'generation.started', { mode: job.mode, autoRun: job.policy.autoRun, imagesPerRound: job.policy.imagesPerRound, maxAutoRounds: job.policy.maxAutoRounds });
      const prepared = await prepare(job, context);
      if (prepared !== true) return prepared;
      await compile(job, context);
      const ready = await checkPreflight(job, context);
      if (ready !== true) return ready;
      if (job.pendingFeedback) {
        const base = activeCandidate(job, job.pendingFeedback.baseCandidateId);
        if (!base) throw failure('CANDIDATE_NOT_FOUND', '没有找到要继续优化的候选图');
        job.positiveTags = base.positiveTags.slice();
        job.negativeTags = base.negativeTags.slice();
        await revise(job, { ...(base.evaluation || {}), status: 'reviewed', candidateId: base.imageId, userFeedback: job.pendingFeedback.feedback }, context, true);
        job.feedbackHistory = [...(job.feedbackHistory || []), { baseCandidateId: base.id, feedback: job.pendingFeedback.feedback, at: Date.now() }].slice(-32);
        job.pendingFeedback = null;
        persist(job);
      }
      await renderLoop(job, context);
      guard(job, context);
      if (!job.candidates.length) throw failure('NO_CANDIDATE', '在允许的尝试次数内没有生成可用图片');
      if (job.status === 'awaiting_feedback') return result(job);
      await chooseRecommendation(job, context);
      const delivery = activeCandidate(job, job.selectedCandidateId) || job.candidates.find(candidate => candidate.evaluation?.recommended) || programRanking(job.candidates)[0];
      job.outcome = classifyOutcome(delivery, 'program', job.policy.acceptScore);
      job.residualIssues = residualIssues(delivery);
      transition(job, 'completed');
      emit(job, context, 'generation.completed', { candidateCount: job.candidates.length, selectedCandidateId: job.selectedCandidateId, stopReason: job.stopReason });
      return result(job);
    } catch (error) {
      if (job.stopReason === 'user_selected' || error?.code === 'USER_SELECTED') {
        job.status = 'completed';
        persist(job);
        return result(job);
      }
      if (job.status === 'cancelled' || context.signal.aborted || error?.code === 'CANCELLED') {
        job.status = 'cancelled';
        job.stopReason = 'cancelled';
        job.outcome = 'cancelled';
        persist(job);
        emit(job, context, 'generation.cancelled', { candidateCount: job.candidates.length });
        return result(job);
      }
      job.error = errorValue(error);
      job.status = 'failed';
      job.stopReason = job.stopReason || 'failed';
      job.outcome = 'failed';
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
    const policy = policyFrom({ strategy: input.strategy, autoSelect: input.autoSelect, autoRun: input.autoRun, imagesPerRound: input.imagesPerRound, maxAutoRounds: input.maxAutoRounds }, getSettings());
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
    if (job.status === 'awaiting_feedback') {
      if (input.action !== 'continue') throw failure('INVALID_INPUT', '手动任务需要明确的 continue 操作');
      const feedback = text(input.feedback);
      const baseCandidateId = text(input.baseCandidateId);
      if (!feedback || !baseCandidateId) throw failure('INVALID_INPUT', '继续优化需要基础候选和用户反馈');
      job.pendingFeedback = { baseCandidateId, feedback };
    }
    if (input.sourceImageId !== undefined) job.sourceImageId = text(input.sourceImageId);
    if (input.characterIds !== undefined) {
      job.characterIds = strings(input.characterIds, 8);
      job.characterQueries = [];
      job.characterReferences = [];
    }
    if (input.workflowProfileId !== undefined) job.workflowProfileId = text(input.workflowProfileId);
    job.policy = policyFrom({ strategy: input.strategy ?? job.policy.legacyStrategy, autoSelect: input.autoSelect ?? job.policy.autoSelect, autoRun: input.autoRun ?? job.policy.autoRun, imagesPerRound: input.imagesPerRound ?? job.policy.imagesPerRound, maxAutoRounds: input.maxAutoRounds ?? job.policy.maxAutoRounds }, { generation: job.policy });
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
    job.outcome = 'cancelled';
    persist(job);
    const running = active.get(job.jobId);
    if (running && !running.controller.signal.aborted) running.controller.abort(failure('CANCELLED', '生成任务已取消'));
    return true;
  }
  function get(jobId) {
    return uiSnapshot(jobId);
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
    job.outcome = classifyOutcome(candidate, source === 'user' ? 'user' : 'program', job.policy.acceptScore);
    job.residualIssues = residualIssues(candidate);
    persist(job);
    return result(job);
  }

  async function selectAndFinish(jobId, candidateId, source = 'user') {
    const job = jobs.get(text(jobId));
    if (!job || ['failed', 'cancelled'].includes(job.status)) return null;
    const candidate = activeCandidate(job, text(candidateId));
    if (!candidate) return null;
    job.candidates = selectCandidateRows(job.candidates, candidate.id, source);
    job.selectedCandidateId = candidate.id;
    job.selectionReason = source === 'user' ? '用户选择最终候选' : text(source, '程序选择最终候选');
    job.stopReason = 'user_selected';
    job.outcome = classifyOutcome(candidate, source === 'user' ? 'user' : 'program', job.policy.acceptScore);
    job.residualIssues = residualIssues(candidate);
    job.status = 'finishing';
    const running = active.get(job.jobId);
    emit(job, running?.context || {}, 'generation.user_selected', { candidateId: candidate.id, imageId: candidate.imageId, source });
    if (running && !running.controller.signal.aborted) running.controller.abort(failure('USER_SELECTED', '用户已选择最终候选'));
    if (running) {
      try { await cancelRender({ jobId: job.jobId, candidateId: candidate.id, imageId: candidate.imageId }); } catch { /* selection remains authoritative */ }
    }
    job.status = 'completed';
    persist(job);
    emit(job, running?.context || {}, 'generation.completed', { candidateCount: job.candidates.length, selectedCandidateId: candidate.id, stopReason: job.stopReason });
    return result(job);
  }

  return Object.freeze({ execute, resume, cancel, get, list, uiSnapshot, publicResult, selectCandidate, selectAndFinish });
}

module.exports = {
  JOB_STATES,
  GENERATION_STRATEGIES,
  GENERATION_OUTCOMES,
  DEFAULT_GENERATION_POLICY,
  createGenerationOrchestrator,
  policyFrom
};
