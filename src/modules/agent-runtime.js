'use strict';

const { createRequestManager, errorShape } = require('./request-manager');
const { createStatusManager } = require('./status-manager');

function text(value, fallback = '') { const result = value == null ? '' : String(value).trim(); return result || fallback; }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  const output = {};
  for (const [key, item] of Object.entries(value)) if (typeof item !== 'function' && key !== 'signal') output[key] = clone(item);
  return output;
}
function resultOk(data, requestId, usage) { return { ok: true, data: data == null ? null : data, error: null, requestId, usage: usage || null }; }
function resultError(error, requestId, fallback = '请求失败') { return { ok: false, data: null, error: errorShape(error, fallback), requestId, usage: null }; }
function responseData(response) {
  if (!object(response)) return response;
  if (response.data !== undefined) return response.data;
  if (response.text !== undefined || response.reasoning !== undefined) return { text: response.text || '', reasoning: response.reasoning || '', toolCalls: response.toolCalls || response.tool_calls || [] };
  return response;
}
function toolCalls(response) {
  const rows = response?.toolCalls || response?.tool_calls || response?.calls || [];
  return Array.isArray(rows) ? rows : rows ? [rows] : [];
}
function callName(call) { return text(call?.name || call?.tool || call?.function?.name); }
function callArgs(call) {
  const raw = call?.arguments ?? call?.args ?? call?.function?.arguments ?? {};
  if (object(raw)) return raw;
  try { const parsed = JSON.parse(String(raw || '{}')); return object(parsed) ? parsed : {}; } catch { return {}; }
}
function raceWithSignal(value, signal) {
  if (!signal) return Promise.resolve(value);
  if (signal.aborted) return Promise.reject(Object.assign(new Error('请求已取消'), { code: 'CANCELLED' }));
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error('请求已取消'), { code: 'CANCELLED' }));
    };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(value).then(result => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      resolve(result);
    }, error => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      reject(error);
    });
  });
}

function createAgentRuntime(options = {}) {
  const primaryClient = options.primaryClient || options.ai || null;
  const tools = options.tools || {};
  const subagents = options.subagents || {};
  const allowedTools = Array.isArray(options.primaryToolNames || options.allowedTools)
    ? new Set((options.primaryToolNames || options.allowedTools).map(String))
    : null;
  const getSettings = typeof options.getSettings === 'function' ? options.getSettings : () => ({});
  const status = options.statusManager || createStatusManager({ onStatus: options.onStatus });
  const requests = options.requestManager || createRequestManager({ onChange: event => {
    const item = event.request;
    if (!item) return;
    if (item.status === 'running') status.start(item.requestId, item);
    else if (item.status === 'timeout') status.timeout(item.requestId, item);
    else if (item.status === 'cancelled') status.cancel(item.requestId, item);
    else if (item.status === 'error') status.fail(item.requestId, item.error, item);
    else if (item.status === 'completed') status.complete(item.requestId, item);
  }});
  const limit = () => Math.max(1, Math.min(100, Number(getSettings()?.limits?.maxComfyCalls ?? getSettings()?.maxComfyCalls) || Number(options.maxComfyCalls) || 3));
  const callCounts = new Map();

  function findTool(name) {
    if (tools && typeof tools.resolve === 'function') return tools.resolve(name);
    if (tools && typeof tools.get === 'function') return tools.get(name);
    return tools?.[name] || null;
  }
  function toolList() {
    if (typeof tools.list === 'function') return tools.list();
    if (typeof tools.openAiTools === 'function') return tools.openAiTools();
    return Object.entries(tools || {}).filter(([, value]) => typeof value === 'function' || value?.handler).map(([name, value]) => ({ name, ...(value?.definition || {}) }));
  }
  function toolSchemas() {
    const source = typeof tools.openAiTools === 'function' ? tools.openAiTools() : toolList();
    return allowedTools ? source.filter(item => {
      const name = String(item.name || item.function?.name || '');
      return allowedTools.has(name) || allowedTools.has(name.replace(/_/g, '.'));
    }) : source;
  }

  async function callTool(name, args = {}, context = {}) {
    const requestId = text(context.requestId, `tool_${Date.now().toString(36)}`);
    if (allowedTools && !allowedTools.has(String(name)) && !allowedTools.has(String(name).replace(/_/g, '.'))) {
      return resultError({ code: 'TOOL_UNAVAILABLE', message: `工具不可用：${text(name)}` }, requestId);
    }
    const definition = findTool(name);
    if (!definition) return resultError({ code: 'TOOL_UNAVAILABLE', message: `工具不可用：${text(name)}` }, requestId);
    if (context.signal?.aborted) return resultError({ code: 'CANCELLED', message: '请求已取消' }, requestId);
    if (name === 'comfy.render') {
      const used = Number(callCounts.get(requestId) || 0);
      if (used >= limit()) return resultError({ code: 'COMFY_CALL_LIMIT', message: `ComfyUI 调用次数超过限制（${limit()}）` }, requestId);
      callCounts.set(requestId, used + 1);
    }
    try {
      let value;
      if (typeof tools.call === 'function') value = await tools.call(name, clone(args), { ...context, requestId, signal: context.signal });
      else if (typeof definition === 'function') value = await definition(clone(args), { ...context, requestId, signal: context.signal });
      else if (typeof definition.handler === 'function') value = await definition.handler(clone(args), { ...context, requestId, signal: context.signal });
      else return resultError({ code: 'TOOL_UNAVAILABLE', message: `工具不可用：${text(name)}` }, requestId);
      if (value?.ok === false) return resultError(value.error || value, requestId);
      return resultOk(value?.data !== undefined ? value.data : value, requestId, value?.usage);
    } catch (error) { return resultError(error, requestId, '工具调用失败'); }
  }

  async function runSubAgent(name, request = {}) {
    const id = text(request.requestId, `sub_${String(name)}_${Date.now().toString(36)}`);
    const entry = subagents?.[name] || (typeof subagents.resolve === 'function' ? subagents.resolve(name) : null);
    if (!entry) return resultError({ code: 'SUBAGENT_UNAVAILABLE', message: `子代理不可用：${text(name)}` }, id);
    const handle = requests.begin(id, { kind: `subagent:${name}`, timeoutMs: request.timeoutMs || entry.timeoutMs, signal: request.signal });
    status.start(id, { kind: `subagent:${name}` });
    try {
      const input = clone(request.input !== undefined ? request.input : request);
      delete input.requestId; delete input.timeoutMs; delete input.signal; delete input.tools; delete input.messages;
      const run = typeof entry === 'function' ? entry : entry.run || entry.execute;
      if (typeof run !== 'function') throw Object.assign(new Error('子代理执行器不可用'), { code: 'SUBAGENT_UNAVAILABLE' });
      const value = await raceWithSignal(run(input, { requestId: id, signal: handle.signal, settings: clone(getSettings()) }), handle.signal);
      if (handle.signal.aborted) throw Object.assign(new Error('请求已取消'), { code: 'CANCELLED' });
      requests.complete(id); return resultOk(value?.data !== undefined ? value.data : value, id, value?.usage);
    } catch (error) {
      const requestState = requests.get(id);
      const failure = requestState?.status === 'timeout'
        ? { code: 'TIMEOUT', message: '请求超时', retryable: true }
        : requestState?.status === 'cancelled'
          ? { code: 'CANCELLED', message: '请求已取消', retryable: false }
          : errorShape(error, '子代理请求失败');
      requests.fail(id, failure); return resultError(failure, id, '子代理请求失败');
    }
  }

  async function runPrimary(request = {}) {
    const id = text(request.requestId, `primary_${Date.now().toString(36)}`);
    const handle = requests.begin(id, { kind: 'primary', timeoutMs: request.timeoutMs || getSettings()?.limits?.primaryTimeoutMs || options.timeoutMs, signal: request.signal });
    status.start(id, { kind: 'primary' });
    if (!primaryClient || typeof primaryClient.complete !== 'function') {
      const failure = resultError({ code: 'PRIMARY_UNAVAILABLE', message: '主 AI 服务不可用' }, id);
      requests.fail(id, failure.error); return failure;
    }
    const maxRounds = Math.max(1, Math.min(32, Number(request.maxRounds || getSettings()?.limits?.maxToolRounds) || 8));
    let comfyCalls = 0; let messages = Array.isArray(request.messages) ? request.messages.map(clone) : [];
    if (!messages.length && request.input?.text) messages = [{ role: 'user', content: String(request.input.text) }];
    try {
      for (let round = 0; round < maxRounds; round += 1) {
        if (handle.signal.aborted) throw Object.assign(new Error('请求已取消'), { code: 'CANCELLED' });
        const config = { ...(request.config || {}), signal: handle.signal, tools: toolSchemas(), tool_choice: request.toolChoice || undefined };
        const response = await raceWithSignal(primaryClient.complete(messages, config), handle.signal);
        if (response?.ok === false) throw response.error || response;
        const calls = toolCalls(response);
        if (!calls.length) { requests.complete(id); return resultOk(responseData(response), id, response?.usage); }
        const outputs = [];
        for (const call of calls.slice(0, 1)) {
          const name = callName(call);
          if (name === 'comfy.render' || name === 'comfy_render') {
            comfyCalls += 1;
          }
          const outcome = await callTool(name, callArgs(call), { requestId: id, signal: handle.signal, sessionId: request.sessionId, caller: 'primary' });
          if (!outcome.ok) throw outcome.error;
          outputs.push({ name, result: outcome.data });
          messages.push({ role: 'assistant', content: response.text || '', tool_calls: [clone(call)] });
          messages.push({ role: 'tool', name, content: JSON.stringify(outcome.data ?? {}) });
        }
        if (typeof request.onToolCall === 'function') request.onToolCall(outputs);
      }
      throw Object.assign(new Error('主 AI 工具回合超过限制'), { code: 'TOOL_ROUND_LIMIT' });
    } catch (error) {
      const requestState = requests.get(id);
      const normalizedError = requestState?.status === 'timeout'
        ? { code: 'TIMEOUT', message: '请求超时', retryable: true }
        : requestState?.status === 'cancelled'
          ? { code: 'CANCELLED', message: '请求已取消', retryable: false }
          : errorShape(error, '主 AI 请求失败');
      const failure = resultError(normalizedError, id, '主 AI 请求失败');
      requestState?.status === 'timeout' ? status.timeout(id, { error: failure.error }) : requestState?.status === 'cancelled' ? status.cancel(id, { error: failure.error }) : requests.fail(id, failure.error);
      if (!requests.get(id)?.endedAt) requests.fail(id, failure.error);
      return failure;
    }
  }

  return { runPrimary, runSubAgent, callTool, cancel: requestId => requests.cancel(requestId), getStatus: requestId => status.get(requestId) || requests.get(requestId), getRequest: requestId => requests.get(requestId), listTools: toolList, status, requests };
}

module.exports = { createAgentRuntime, resultOk, resultError };
