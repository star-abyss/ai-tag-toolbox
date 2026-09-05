'use strict';

const { createVisionService } = require('../vision-service');

const TOOL_NAMES = Object.freeze([
  'tags.search', 'conversation.listImages', 'vision.processOne', 'translation.translate',
  'agent.generateTags', 'comfy.status', 'comfy.validateWorkflow', 'comfy.render'
]);

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).trim();
  return result || fallback;
}
function clone(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}
function artifact(value, options = {}) {
  if (!value || typeof value !== 'object') return null;
  const output = { id: text(value.id || value.imageId || value.artifactId || value.promptId), filename: text(value.filename || value.name), mime: text(value.mime || value.contentType, 'image/png'), width: Number(value.width) || 0, height: Number(value.height) || 0 };
  if (options.includeMedia === true) {
    const viewUrl = text(value.viewUrl || value.url);
    if (/^https?:\/\//i.test(viewUrl)) output.viewUrl = viewUrl.slice(0, 600);
    if (/^data:image\//i.test(text(value.dataUrl))) output.dataUrl = text(value.dataUrl);
  }
  return output;
}

function createCalls(options = {}) {
  const tags = options.tags || null;
  const images = options.images || null;
  const comfy = options.comfy || null;
  const prompts = options.prompts || null;
  const visionTempStore = options.visionTempStore || null;
  const getSettings = typeof options.getSettings === 'function' ? options.getSettings : () => ({});
  const getCurrentSessionId = typeof options.getCurrentSessionId === 'function' ? options.getCurrentSessionId : () => '';
  const getRuntime = typeof options.getRuntime === 'function' ? options.getRuntime : () => options.runtime || null;
  const getPrimaryTools = typeof options.getPrimaryTools === 'function' ? options.getPrimaryTools : () => options.primaryTools || null;
  const getPrompt = typeof options.getPrompt === 'function' ? options.getPrompt : key => prompts?.getEffective?.(key) || prompts?.get?.(key, '') || '';
  const visionService = options.visionService || createVisionService({ images, visionTempStore, localVision: options.localVision || options.vision, visionAI: options.visionAI || options.visionAi, parseMetadata: options.parseMetadata, getPrompt });
  let capabilityState = { tags: Boolean(tags?.search), vision: visionService?.available?.() || { metadata: Boolean(images?.get), local: false, ai: false }, comfy: { enabled: false, connected: false, workflowReady: false, render: false, error: '尚未检查 ComfyUI' } };
  let capabilityPromise = null;
  let capabilityCheckedAt = 0;
  function settingsSnapshot() {
    const source = getSettings() || {};
    const value = source.comfy && typeof source.comfy === 'object' ? source.comfy : source;
    return { enabled: value.enabled ?? value.comfyOn ?? false, base: text(value.base || value.comfyBase, 'http://127.0.0.1:8188'), workflow: value.workflow ?? value.comfyWorkflow ?? '' };
  }
  function getCapabilities() { return clone(capabilityState); }
  function invalidateCapabilities() { capabilityCheckedAt = 0; capabilityPromise = null; return getCapabilities(); }
  async function refreshCapabilities(refreshOptions = {}) {
    if (!refreshOptions.force && capabilityPromise) return capabilityPromise;
    if (!refreshOptions.force && capabilityCheckedAt && Date.now() - capabilityCheckedAt < 1500) return getCapabilities();
    capabilityPromise = (async () => {
      const selected = settingsSnapshot();
      try { comfy?.setBase?.(selected.base); comfy?.setWorkflow?.(selected.workflow); } catch { /* status reports the failure */ }
      let workflow = { ready: false, error: selected.workflow ? '' : '尚未设置 ComfyUI 工作流' };
      try { workflow = comfy?.workflowStatus?.(selected.workflow) || workflow; } catch (error) { workflow = { ready: false, error: error?.message || String(error) }; }
      let connected = false;
      try { connected = comfy ? Boolean((await comfy.status({ enabled: selected.enabled === true, workflow: selected.workflow }))?.connected) : false; } catch { connected = false; }
      capabilityState = { tags: Boolean(tags?.search), vision: visionService?.available?.() || { metadata: Boolean(images?.get), local: false, ai: false }, comfy: { enabled: selected.enabled === true, connected, workflowReady: Boolean(workflow.ready), render: selected.enabled === true && connected && Boolean(workflow.ready), error: text(workflow.error) } };
      capabilityCheckedAt = Date.now(); capabilityPromise = null; return getCapabilities();
    })();
    return capabilityPromise;
  }
  async function call(name, args = {}, context = {}) {
    const scoped = { ...context, sessionId: context.sessionId || getCurrentSessionId() };
    const runtime = getRuntime();
    if (runtime?.callTool) return runtime.callTool(name, args, scoped);
    const tools = getPrimaryTools();
    if (tools?.call) return tools.call(name, args, scoped);
    return { ok: false, error: { code: 'RUNTIME_UNAVAILABLE', message: '统一 Agent Runtime 不可用', retryable: false } };
  }
  function list() { return getPrimaryTools()?.list?.() || []; }
  function schemas() { return getPrimaryTools()?.schemas?.() || list(); }
  function openAiTools() { return getPrimaryTools()?.openAiTools?.() || []; }
  return { visionService, call, list, listAvailable: list, schemas, schemasAvailable: schemas, openAiTools, openAiToolsAvailable: openAiTools, getCapabilities, refreshCapabilities, invalidateCapabilities, runtimeToolNames: TOOL_NAMES, agentRuntimeToolNames: TOOL_NAMES, describe: () => ({ version: '2.0', tools: list(), capabilities: getCapabilities() }) };
}

module.exports = { TOOL_NAMES, RUNTIME_TOOL_NAMES: TOOL_NAMES, AGENT_RUNTIME_TOOL_NAMES: TOOL_NAMES, createCalls, artifact };
