'use strict';

const { randomUUID } = require('node:crypto');
const { createComfy } = require('./comfy');
const { createComfyProfiles } = require('./comfy-profiles');
const { createImageRepository } = require('./image-repository');
const { parsePngMetadata } = require('./images');
const { createVisionTempStore } = require('./vision-temp-store');
const { createAgentRuntime, isNoiseEvent } = require('./agent-runtime');
const { createFixedSubagents } = require('./fixed-subagents');
const { createPrimaryTools } = require('./primary-tools');
const { createVisionService } = require('./vision-service');
const { createPrompts } = require('./prompts');
const { createSettings } = require('./settings');
const { createAiClient, parseReply } = require('./ai-client');
const { createPrimaryAgent, publicRequestConfig } = require('./primary-agent');
const { errorShape, resultError } = require('./error-manager');
const { createCallMonitor } = require('./call-monitor');
const { createGenerationOrchestrator } = require('./generation-orchestrator');

const SESSION_FORMAT = 'ai-tag-sessions';
const SESSION_VERSION = 1;
const VISION_MODEL_HINT = /vision|[-_]?vl(?:[-_]|$)|gpt-4o|gpt-4\.1|qwen.*vl|llava|moondream|internvl|minicpm[-_]?v|pixtral|gemma.*vision|gemini|claude-3|claude.*sonnet|glm-4v|qvq|deepseek.*(?:vision|vl)|kimi.*vision/i;
const TEXT_ONLY_MODEL_HINT = /deepseek-(?:chat|reasoner|v[23](?:\.\d+)?)(?:$|[-_:])|deepseek-v4-(?:flash|pro)(?![-_]vision)(?:$|[-_:])|gpt-3\.5|text-embedding|(?:^|\/)qwen(?:2(?:\.5)?|3)(?:$|[-_:])|(?:^|\/)llama3(?:$|[-_:])/i;
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value, fallback = '') { const output = value == null ? '' : String(value).trim(); return output || fallback; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function id(prefix) { return `${prefix}_${randomUUID()}`; }
function array(value) { return Array.isArray(value) ? value : []; }
function ids(value) { return [...new Set(array(value).filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))]; }
function observe(callback, ...values) { try { callback?.(...values); } catch { /* UI observers are optional. */ } }
function failure(code, message, requestId, sessionId) { return { ...resultError({ code, message }, requestId), status: code === 'CANCELLED' ? 'cancelled' : 'error', text: message, sessionId }; }
function transcript(value) {
  const result = [];
  for (const row of array(value)) {
    if (!object(row)) continue;
    if (row.role === 'assistant') {
      const item = { role: 'assistant', content: typeof row.content === 'string' ? row.content : '' };
      const calls = array(row.tool_calls).filter(call => text(call?.id) && text(call?.function?.name) && typeof call?.function?.arguments === 'string');
      if (calls.length) item.tool_calls = calls.map(call => ({ id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } }));
      if (item.content || item.tool_calls) result.push(item);
    } else if (row.role === 'tool' && text(row.tool_call_id)) result.push({ role: 'tool', tool_call_id: row.tool_call_id, content: typeof row.content === 'string' ? row.content : JSON.stringify(row.content ?? null) });
  }
  return result;
}

// 任务事件只记录关键信息（轮次、工具调用、子代理、候选结果等）；
// 噪音分类统一来自 agent-runtime.isNoiseEvent（单一来源），此处直接复用，避免多份逻辑漂移。

function createAssistant(options = {}) {
  const storage = options.storage;
  const images = options.images || null;
  const tags = options.tags || null;
  const prompts = options.promptSource || options.prompts || createPrompts({ storage, dir: options.promptDir });
  const initialPrimary = options.primaryApi || options.ai?.config || options.ai || {};
  const settings = createSettings({ storage, initial: { primaryApi: publicRequestConfig(initialPrimary), visionApi: options.visionApi || {}, ...(object(options.settings) ? options.settings : {}) } });
  const comfyProfiles = createComfyProfiles({ storage, initial: settings.snapshot() });
  const state = { sessions: [], currentId: '', busy: false, status: 'idle', jobId: '', lastError: '' };
  let active = null;
  let runtime;
  let primaryTools;
  let generation;
  let imageRepository;
  let destroyed = false;
  function read(key, fallback) { try { return storage?.get ? storage.get(key, fallback) : storage?.load?.(key, fallback) ?? fallback; } catch { return fallback; } }
  function write(key, value) { if (storage?.set) storage.set(key, clone(value)); else storage?.save?.(key, clone(value)); }
  let favorites = array(read('rewrite_favorites', [])).map(clone);
  function sessionById(sessionId = state.currentId) { return state.sessions.find(session => session.id === sessionId) || null; }
  function sessionBundle() { return { format: SESSION_FORMAT, version: SESSION_VERSION, currentId: state.currentId, sessions: clone(state.sessions) }; }
  function persist() { write('sessions', sessionBundle()); }
  function normalizeSession(raw, usedSessions, usedMessages) {
    const unique = (value, prefix, used) => { let key = text(value, id(prefix)); while (used.has(key)) key = id(prefix); used.add(key); return key; };
    const sessionId = unique(raw.id, 'session', usedSessions);
    return {
      id: sessionId, title: text(raw.title, '新对话'), createdAt: Number(raw.createdAt) || Date.now(), updatedAt: Number(raw.updatedAt) || Date.now(),
      messages: array(raw.messages).filter(row => object(row) && ['user', 'assistant', 'error'].includes(row.role)).map(row => ({
        id: unique(row.id, 'message', usedMessages), role: row.role, text: typeof row.text === 'string' ? row.text : '',
        reasoning: typeof row.reasoning === 'string' ? row.reasoning : '', imageIds: ids(row.imageIds),
        toolCalls: clone(array(row.toolCalls)), transcript: transcript(row.transcript), artifacts: clone(array(row.artifacts)), events: clone(array(row.events)), activity: clone(array(row.events)),
        result: object(row.result) ? clone(row.result) : null, status: row.status === 'streaming' ? 'cancelled' : text(row.status, 'done'), createdAt: Number(row.createdAt) || Date.now()
      }))
    };
  }
  function incomingBundle(value) {
    let parsed = value;
    try { if (typeof parsed === 'string') parsed = JSON.parse(parsed); } catch { return null; }
    return object(parsed) && parsed.format === SESSION_FORMAT && parsed.version === SESSION_VERSION && Array.isArray(parsed.sessions) && parsed.sessions.every(object) ? parsed : null;
  }
  const saved = incomingBundle(read('sessions', null));
  if (saved) {
    const usedSessions = new Set(); const usedMessages = new Set();
    state.sessions = saved.sessions.map(row => normalizeSession(row, usedSessions, usedMessages));
    state.currentId = state.sessions.some(row => row.id === saved.currentId) ? saved.currentId : state.sessions[0]?.id || '';
  }
  const visionTempStore = options.visionTempStore || createVisionTempStore({ images, authorizeReference: reference => imageRepository?.authorizeVisionReference?.(reference) || null });
  imageRepository = options.imageRepository || createImageRepository({ images, storage, sessions: () => state.sessions, saveSessions: persist, currentSessionId: () => state.currentId, onReferenceRemoved: reference => visionTempStore.invalidateReference?.(reference) });
  visionTempStore.setAuthorizer?.(reference => imageRepository.authorizeVisionReference?.(reference) || null);
  function newSession(title = '新对话') {
    cancel();
    const session = { id: id('session'), title: text(title, '新对话'), messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    state.sessions.unshift(session); state.currentId = session.id; persist(); return clone(session);
  }
  function currentSession() { if (!sessionById()) newSession(); return sessionById(); }
  if (!state.sessions.length) newSession();

  const callMonitor = createCallMonitor({ filePath: options.callMonitorPath, getSecrets: () => [settings.primaryProfile().key, settings.visionProfile().key] });
  const ai = createAiClient(settings.primaryProfile(), options.primaryGateway || (options.ai?.complete || options.ai?.stream ? options.ai : null), callMonitor);
  const visionAi = createAiClient(settings.visionProfile(), options.visionGateway, callMonitor);
  function visionConfig() {
    const profile = settings.visionProfile();
    const imageCapable = VISION_MODEL_HINT.test(profile.model) || !TEXT_ONLY_MODEL_HINT.test(profile.model);
    return { ...profile, configured: Boolean(profile.base && profile.model && imageCapable), imageCapable, error: !profile.base || !profile.model ? '请先配置识图 API 地址和模型' : !imageCapable ? '当前识图模型不支持图片输入，请选择视觉模型或配置独立识图 API' : '' };
  }
  const visionClient = Object.freeze({
    async complete(messages, config = {}) {
      const profile = visionConfig();
      if (!profile.imageCapable && array(messages).some(message => array(message.content).some(part => part?.type === 'image_url'))) return failure('VISION_MODEL_NOT_SUPPORTED', profile.error);
      return visionAi.complete(messages, { ...profile, ...config });
    },
    getConfig: visionConfig
  });
  async function resolveImage(imageId, context = {}) {
    if (context.sessionId && context.sessionId !== state.currentId) return null;
    const reference = { imageId, sessionId: context.sessionId || state.currentId, ...(context.refId ? { refId: context.refId } : {}) };
    const image = visionTempStore.resolveForVision(reference);
    if (!image) return null;
    const url = [image.dataUrl, image.url].find(value => typeof value === 'string' && /^(?:data:image\/|https?:\/\/)/i.test(value));
    if (url) return { ...image, dataUrl: url };
    const bytes = await visionTempStore.getBytes(reference);
    if (!bytes || context.signal?.aborted) return null;
    const mime = /^image\//i.test(image.mime || '') ? image.mime : 'image/png';
    return { ...image, dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` };
  }
  const comfy = options.comfy && typeof options.comfy.render === 'function' ? options.comfy : createComfy({ ...(options.comfyOptions || {}), profiles: comfyProfiles });
  const visionService = options.visionService || createVisionService({ images, visionTempStore, localVision: options.localVision || options.vision, visionAI: visionClient, parseMetadata: parsePngMetadata, getPrompt: key => prompts.getEffective?.(key) || prompts.get?.(key) || '' });
  const primary = createPrimaryAgent({ client: ai, prompts, getSettings: settings.snapshot, charactersEnabled: Boolean(options.characters) });
  const subagents = createFixedSubagents({ vision: visionService, translation: options.translation, ai, visionAI: visionClient, prompts, resolveImage, getSettings: settings.snapshot });
  runtime = createAgentRuntime({ primaryClient: primary, subagents, tools: () => primaryTools, getSettings: settings.snapshot, getPrimaryPrompt: primary.getPrompt, monitor: callMonitor });
  primaryTools = createPrimaryTools({ tags, characters: options.characters, images, imageRepository, runtime, comfy, comfyProfiles, generation: () => generation, getSettings: settings.snapshot });
  const internalTool = async (name, args, context) => {
    const outcome = await runtime.callTool(name, args, { parentRequestId: context.requestId, signal: context.signal, sessionId: context.sessionId, messageId: context.messageId, onEvent: context.onEvent });
    if (outcome?.ok === false) throw Object.assign(new Error(outcome.error?.message || '内部工具调用失败'), { code: outcome.error?.code || 'TOOL_FAILED', retryable: outcome.error?.retryable === true });
    return outcome.data;
  };
  generation = options.generation || createGenerationOrchestrator({
    storage,
    runSubAgent: runtime.runSubAgent,
    renderCandidate: (input, context) => internalTool('comfy.render', {
      positiveTags: input.positiveTags,
      negativeTags: input.negativeTags,
      batchCount: input.batchCount,
      ...(input.sourceImageId ? { sourceImageId: input.sourceImageId } : {})
    }, context),
    preflight: async (input, context) => {
      const value = await internalTool('comfy.status', {}, context);
      const profile = comfyProfiles.active();
      const referenceReady = Boolean(profile?.bindings?.sourceImage && (profile?.capabilities?.img2img === true || profile?.capabilities?.controlImage === true));
      return { ready: value.render === true, connected: value.connected === true, error: value.error || '', workflowProfileId: profile?.id || '', workflowRevision: profile?.updatedAt ? String(profile.updatedAt) : '', recreationMode: input.mode === 'recreate' ? (referenceReady ? 'reference_image' : 'text_approximation') : '' };
    },
    listConversationImages: sessionId => imageRepository.listConversation(sessionId, { includePending: true, includeDeleted: false }),
    resolveCharacter: (value, context) => {
      if (!options.characters) return null;
      const includeAdult = tags?.stateSnapshot?.().includeAdult === true;
      if (context.mode === 'id') return options.characters.get?.(value, { includeAdult }) || null;
      return options.characters.page?.({ query: value, includeAdult, precision: 'standard', limit: 10 }) || null;
    },
    getSettings: settings.snapshot,
    getPromptSnapshot: prompts.snapshot
  });

  function append(role, value, extra = {}, sessionId = state.currentId) {
    const session = sessionById(sessionId); if (!session) return null;
    const message = { id: id('message'), role: ['user', 'assistant', 'error'].includes(role) ? role : 'user', text: typeof value === 'string' ? value : '', reasoning: '', imageIds: ids(extra.imageIds), toolCalls: [], transcript: [], artifacts: [], events: [], activity: [], result: null, status: text(extra.status, 'done'), createdAt: Date.now() };
    session.messages.push(message); session.updatedAt = Date.now(); persist(); return clone(message);
  }
  function writable(job) { return !destroyed && active === job && !job.invalidated && sessionById(job.sessionId) === job.session && job.session.messages.includes(job.live); }
  function cancelledPayload(job) { return { text: job.live.text, reasoning: job.live.reasoning, toolCalls: clone(job.live.toolCalls), transcript: clone(job.live.transcript), artifacts: clone(job.live.artifacts), imageIds: job.live.imageIds.slice(), events: clone(job.live.events) }; }
  function applyPayload(job, payload = {}) {
    const live = job.live;
    if (typeof payload.text === 'string') {
      // 保留各轮之间的进度汇报文本：live.text 已累积本轮全部流式增量，
      // 只有当最终文本未被包含在累积文本中时才追加，避免重复或覆盖掉过程汇报。
      if (!live.text) live.text = payload.text;
      else if (payload.text && live.text.trim() !== payload.text.trim() && !live.text.trim().endsWith(payload.text.trim())) live.text = live.text.trim() + '\n\n' + payload.text.trim();
    }
    if (typeof payload.reasoning === 'string') live.reasoning = payload.reasoning;
    if (Array.isArray(payload.toolCalls)) live.toolCalls = clone(payload.toolCalls);
    if (Array.isArray(payload.transcript)) live.transcript = transcript(payload.transcript);
    if (Array.isArray(payload.artifacts)) live.artifacts = clone(payload.artifacts);
    live.imageIds = ids([...live.imageIds, ...array(payload.imageIds), ...live.artifacts.map(item => item.imageId || item.id)]);
    if (Array.isArray(payload.events)) live.events = clone(payload.events).filter(event => !isNoiseEvent(event));
    live.activity = clone(live.events);
  }
  function cancel(requestId) {
    if (!active || (requestId && active.id !== requestId)) return false;
    const job = active;
    job.live.status = 'cancelled';
    job.live.result = { ok: false, error: { code: 'CANCELLED', message: '请求已取消' }, ...cancelledPayload(job) };
    job.session.updatedAt = Date.now(); persist();
    job.invalidated = true; active = null;
    state.busy = false; state.status = 'cancelled'; state.jobId = '';
    const reason = Object.assign(new Error('请求已取消'), { code: 'CANCELLED' });
    job.controller.abort(reason); runtime?.cancel?.(job.id);
    return true;
  }
  function history(session) {
    const result = [];
    for (const message of session.messages) {
      if (message.role === 'user') result.push({ role: 'user', content: [message.text, message.imageIds.length ? `Attached imageIds: ${message.imageIds.join(', ')}` : ''].filter(Boolean).join('\n\n') });
      else if (message.transcript?.length) result.push(...transcript(message.transcript));
      else if (message.role === 'assistant' && message.text && message.status === 'done') result.push({ role: 'assistant', content: message.text });
    }
    return result;
  }
  async function runPrimaryWithRuntime(value, config = {}) {
    const input = typeof value === 'string' ? { text: value } : object(value) ? value : {};
    if (destroyed) return failure('ASSISTANT_CLOSED', '会话服务已关闭');
    if (active) return failure('BUSY', '当前请求仍在处理中', active.id, active.sessionId);
    const session = input.sessionId ? sessionById(input.sessionId) : currentSession();
    if (!session || session.id !== state.currentId) return failure('SESSION_UNAVAILABLE', '当前会话不可用', input.requestId, input.sessionId);
    const body = typeof input.text === 'string' ? input.text.trim() : '';
    const imageIds = ids(input.imageIds);
    if (!body && !imageIds.length) return failure('EMPTY_INPUT', '请输入内容或添加图片', input.requestId, session.id);
    if (input.signal?.aborted) return failure('CANCELLED', '请求已取消', input.requestId, session.id);
    const requestId = text(input.requestId, id('primary'));
    const userId = id('message');
    const references = [];
    for (const imageId of imageIds) {
      const reference = imageRepository.attachToConversation(session.id, imageId, { source: 'upload', messageId: userId, sent: true, pending: false });
      if (!reference) return failure('IMAGE_NOT_FOUND', `无法读取附图：${imageId}`, requestId, session.id);
      references.push(reference);
    }
    if (references.length) imageRepository.markSent(session.id, references.map(row => row.refId));
    const previous = history(session);
    const user = { id: userId, role: 'user', text: body, imageIds, reasoning: '', toolCalls: [], transcript: [], artifacts: [], events: [], activity: [], result: null, status: 'done', createdAt: Date.now() };
    session.messages.push(user);
    const liveSnapshot = append('assistant', '', { status: 'streaming' }, session.id);
    const live = session.messages.find(message => message.id === liveSnapshot.id);
    const controller = new AbortController();
    const job = { id: requestId, sessionId: session.id, session, live, controller, invalidated: false };
    let lastDeltaPersistAt = 0;
    active = job; state.busy = true; state.status = 'running'; state.jobId = requestId; state.lastError = '';
    const callerAbort = () => cancel(requestId);
    input.signal?.addEventListener?.('abort', callerAbort, { once: true });
    const current = { role: 'user', content: [body || '请查看附图。', references.length ? `Attached imageIds: ${references.map(row => row.imageId).join(', ')}` : ''].filter(Boolean).join('\n\n') };
    observe(input.onStart, { user: clone(user), assistant: clone(live), requestId, sessionId: session.id });
    const onEvent = event => {
      if (!writable(job)) return;
      if (isNoiseEvent(event)) return; // 流式增量不写入任务事件，避免刷满 256 条上限。
      live.events.push(clone(event)); if (live.events.length > 256) live.events.shift(); live.activity = clone(live.events);
      if (event?.jobId && typeof generation?.get === 'function') {
        const generationState = generation.get(event.jobId);
        if (generationState) {
          live.result = { ...(object(live.result) ? live.result : {}), ...clone(generationState) };
          live.artifacts = clone(array(generationState.artifacts));
          live.imageIds = ids(generationState.imageIds);
        }
      }
      const output = event?.result?.data || event?.result;
      if (Array.isArray(output?.artifacts)) { for (const artifact of output.artifacts) if (!live.artifacts.some(item => item.imageId === artifact.imageId)) live.artifacts.push(clone(artifact)); live.imageIds = ids([...live.imageIds, ...live.artifacts.map(item => item.imageId)]); }
      persist(); observe(input.onEvent, clone(event)); observe(input.onToolEvent, clone(event));
    };
    try {
      const result = await runtime.runPrimary({ requestId, sessionId: session.id, messageId: live.id, messages: [...previous, current], config: publicRequestConfig(config), signal: controller.signal,
        onDelta: (delta, reasoning = '') => { if (!writable(job)) return; if (typeof delta === 'string') live.text += delta; if (typeof reasoning === 'string') live.reasoning += reasoning; const now = Date.now(); if (now - lastDeltaPersistAt >= 500) { lastDeltaPersistAt = now; persist(); } observe(input.onDelta, live.text, live.reasoning, clone(live)); },
        onEvent,
        onToolCall: traces => { if (!writable(job)) return; for (const trace of array(traces)) { const index = live.toolCalls.findIndex(row => row.id === trace.id); if (index < 0) live.toolCalls.push(clone(trace)); else live.toolCalls[index] = clone(trace); } persist(); }
      });
      if (!writable(job)) return { ...failure('CANCELLED', '请求已取消', requestId, session.id), data: cancelledPayload(job) };
      const payload = object(result.data) ? result.data : object(result.partial) ? result.partial : {};
      applyPayload(job, payload);
      const error = result.ok ? null : errorShape(result.error);
      live.status = result.ok ? 'done' : error.code === 'CANCELLED' ? 'cancelled' : error.code === 'TIMEOUT' ? 'timeout' : 'error';
      live.result = { ...clone(payload), ok: result.ok, error, usage: clone(result.usage) };
      if (!live.text && error) live.text = error.message;
      session.updatedAt = Date.now(); state.lastError = error?.message || ''; state.status = result.ok ? 'idle' : live.status; persist(); observe(input.onDelta, live.text, live.reasoning, clone(live));
      return { ...result, ...payload, ok: result.ok, error, data: clone(payload), text: live.text, status: live.status, requestId, sessionId: session.id };
    } catch (cause) {
      if (!writable(job)) return { ...failure('CANCELLED', '请求已取消', requestId, session.id), data: cancelledPayload(job) };
      const error = errorShape(cause); live.status = error.code === 'CANCELLED' ? 'cancelled' : 'error'; if (!live.text) live.text = error.message;
      live.result = { ...cancelledPayload(job), ok: false, error }; state.lastError = error.message; state.status = live.status; persist();
      return { ...failure(error.code, error.message, requestId, session.id), data: cancelledPayload(job) };
    } finally {
      input.signal?.removeEventListener?.('abort', callerAbort);
      if (active === job) { active = null; state.busy = false; state.jobId = ''; }
    }
  }
  function messageLocation(value, sessionId = state.currentId) { const session = sessionById(sessionId); if (!session) return null; const index = typeof value === 'number' ? value : session.messages.findIndex(row => row.id === value); return index >= 0 && session.messages[index] ? { session, index, message: session.messages[index] } : null; }
  function editMessage(value, nextText, sessionId) { const found = messageLocation(value, sessionId); if (!found) return null; if (active?.sessionId === found.session.id) cancel(); found.message.text = typeof nextText === 'string' ? nextText : ''; found.message.transcript = []; found.session.updatedAt = Date.now(); persist(); return clone(found.message); }
  function deleteMessage(value, sessionId) { const found = messageLocation(value, sessionId); if (!found) return false; if (active?.sessionId === found.session.id) cancel(); found.session.messages.splice(found.index, 1); found.session.updatedAt = Date.now(); persist(); return true; }
  function chooseCandidate(value, candidateId, source = 'user', sessionId = state.currentId) {
    const found = messageLocation(value, sessionId);
    const jobId = text(found?.message?.result?.jobId);
    if (!found || !jobId) return null;
    const selected = generation?.selectCandidate?.(jobId, candidateId, source);
    if (!selected) return null;
    found.message.result = {
      ...found.message.result,
      ...clone(selected),
      finalCandidateId: selected.selectedCandidateId,
      finalImageId: selected.selectedImageId,
      finalPrompt: selected.prompt,
      finalNegative: selected.negative
    };
    found.message.artifacts = clone(array(selected.artifacts));
    found.message.imageIds = ids(selected.imageIds);
    found.session.updatedAt = Date.now();
    persist();
    return clone(found.message.result);
  }
  async function rerunFromMessage(value, inputPatch = {}, config = {}, sessionId = state.currentId) {
    if (active) return failure('BUSY', '当前请求仍在处理中', active.id, active.sessionId);
    const found = messageLocation(value, sessionId); if (!found || found.session.id !== state.currentId) return failure('MESSAGE_NOT_FOUND', '没有找到要重新执行的消息');
    let index = found.index; while (index >= 0 && found.session.messages[index].role !== 'user') index -= 1; if (index < 0) return failure('MESSAGE_NOT_FOUND', '没有找到对应的用户消息');
    const user = clone(found.session.messages[index]); const body = inputPatch.text === undefined ? user.text : inputPatch.text; const imageIds = inputPatch.imageIds === undefined ? user.imageIds : ids(inputPatch.imageIds);
    if (!text(body) && !imageIds.length) return failure('EMPTY_INPUT', '请输入内容或添加图片');
    found.session.messages.splice(index); persist(); return runPrimaryWithRuntime({ ...inputPatch, text: body, imageIds, sessionId: found.session.id }, config);
  }
  let capabilities = { tags: Boolean(tags?.search), vision: visionService.available?.() || { metadata: Boolean(images?.get), local: false, ai: false }, comfy: { enabled: false, connected: false, workflowReady: false, render: false, error: '尚未检查 ComfyUI' } };
  async function refreshCapabilities() {
    const result = await primaryTools?.call?.('comfy.status', {}, { caller: 'ui', sessionId: state.currentId });
    const comfyState = result?.data || {};
    capabilities = { tags: Boolean(tags?.search), vision: visionService.available?.() || { metadata: Boolean(images?.get), local: false, ai: false }, comfy: { enabled: comfyState.enabled === true, connected: comfyState.connected === true, workflowReady: comfyState.workflowReady === true, render: comfyState.render === true, error: text(comfyState.error) } };
    return clone(capabilities);
  }
  function setSettings(value = {}) { const result = settings.setForm(value); ai.setConfig(settings.primaryProfile()); visionAi.setConfig(settings.visionProfile()); return result; }
  function resetSettings(group) { settings.reset(group); return settings.getForm(); }
  const api = {
    run: runPrimaryWithRuntime, runtime, primaryTools, generation, comfy, imageRepository, visionTempStore, visionService, parseReply,
    getSettings: settings.getForm, getCanonicalSettings: settings.snapshot, setSettings, updateSettings: setSettings, resetSettings, comfyProfiles,
    getPrimaryConfig: settings.primaryProfile, getVisionConfig: visionConfig,
    listModels: config => ai.listModels({ ...settings.primaryProfile(), ...publicRequestConfig(config) }), listVisionModels: config => visionAi.listModels({ ...settings.visionProfile(), ...publicRequestConfig(config) }),
    testConnection: config => runtime.runPrimary({ requestId: id('connection'), messages: [{ role: 'user', content: 'Please reply OK.' }], config: { ...publicRequestConfig(config), stream: false } }),
    getCapabilities: () => clone(capabilities), refreshCapabilities,
    newSession, currentSession: () => clone(currentSession()), sessions: () => clone(state.sessions), snapshot: () => ({ ...clone(state), settings: settings.getForm(), config: settings.primaryProfile(), visionConfig: visionConfig(), favorites: clone(favorites) }),
    switchSession(sessionId) { if (!sessionById(sessionId)) return false; if (sessionId !== state.currentId) cancel(); state.currentId = sessionId; persist(); return true; },
    renameSession(sessionId, title) { const session = sessionById(sessionId); if (!session) return false; session.title = text(title, session.title); session.updatedAt = Date.now(); persist(); return clone(session); },
    deleteSession(sessionId = state.currentId, value = {}) { if (!sessionById(sessionId)) return false; if (active?.sessionId === sessionId) cancel(); const result = imageRepository.deleteSession(sessionId, { retainImages: value.retainImages === true }); if (!sessionById()) state.currentId = state.sessions[0]?.id || ''; if (!state.sessions.length) newSession(); else persist(); return result; },
    clearSession(sessionId = state.currentId) { if (!sessionById(sessionId)) return false; if (active?.sessionId === sessionId) cancel(); imageRepository.clearSessionContent(sessionId); persist(); return clone(sessionById(sessionId)); },
    clearConversationImages(sessionId = state.currentId) { if (!sessionById(sessionId)) return false; if (active?.sessionId === sessionId) cancel(); const result = imageRepository.clearConversationImages(sessionId); persist(); return result; },
    append, editMessage, deleteMessage, chooseCandidate, selectCandidate: chooseCandidate, rerunFromMessage, regenerateMessage: rerunFromMessage,
    exportSessions: () => JSON.stringify(sessionBundle(), null, 2),
    importSessions(value, replace = false) { const incoming = incomingBundle(value); if (!incoming) return false; cancel(); const usedSessions = new Set(replace ? [] : state.sessions.map(row => row.id)); const usedMessages = new Set(replace ? [] : state.sessions.flatMap(row => row.messages.map(message => message.id))); const normalized = incoming.sessions.map(row => normalizeSession(row, usedSessions, usedMessages)); state.sessions = replace ? normalized : [...state.sessions, ...normalized]; if (replace || !sessionById()) state.currentId = state.sessions[0]?.id || ''; for (const session of normalized) imageRepository.reconcileSessionMessages(session.id); imageRepository.reconcileSessions(); if (!state.sessions.length) newSession(); else persist(); return clone(state.sessions); },
    listFavorites: () => clone(favorites), getFavorites: () => clone(favorites), setFavorites(value) { favorites = array(value).map(clone); write('rewrite_favorites', favorites); return clone(favorites); }, addFavorite(value) { const item = object(value) ? clone(value) : { name: text(value, '未命名收藏') }; item.id = text(item.id, id('favorite')); favorites.push(item); write('rewrite_favorites', favorites); return clone(item); }, removeFavorite(favoriteId) { const index = favorites.findIndex(row => row.id === favoriteId); if (index < 0) return false; favorites.splice(index, 1); write('rewrite_favorites', favorites); return true; },
    listCallRecords: () => runtime?.listCallRecords?.() || [],
    clearCallRecords: () => runtime?.clearCallRecords?.(),
    getCallMonitorInfo: callMonitor.info,
    flushCallRecords: callMonitor.flush,
    cancel, stop: cancel, destroy() { cancel(); destroyed = true; }
  };
  return Object.freeze(api);
}

module.exports = { SESSION_FORMAT, SESSION_VERSION, createAssistant };
