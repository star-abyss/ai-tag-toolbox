'use strict';

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).replace(/^\uFEFF/, '').trim();
  return result || fallback;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(clone);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'function' || key === 'signal') continue;
    output[key] = clone(item);
  }
  return output;
}

function list(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function normaliseRole(value) {
  const role = text(value).toLowerCase();
  if (role === 'ai' || role === 'bot') return 'assistant';
  if (role === 'err' || role === 'error') return 'error';
  return ['system', 'user', 'assistant', 'tool', 'error'].includes(role) ? role : '';
}

function contentText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(contentText).join('');
  if (isObject(value)) {
    if (/^(?:tool_use|tool_call|function_call|function)$/i.test(text(value.type))) return '';
    if (value.type === 'output_text' && value.text != null) return String(value.text);
    if (value.text != null) return String(value.text);
    if (value.content != null) return contentText(value.content);
    if (value.delta != null) return contentText(value.delta);
  }
  return value == null ? '' : String(value);
}

function imageUrl(value) {
  if (typeof value === 'string') return value;
  if (!isObject(value)) return '';
  return text(value.dataUrl || value.url || value.src || value.previewUrl || value.viewUrl);
}

function safeRemoteImageUrl(value) {
  const source = text(value);
  if (!source) return '';
  if (/^data:image\/[a-z0-9.+-]+(?:;[a-z0-9._=-]+)*,/i.test(source)) return source;
  try {
    const parsed = new URL(source);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? source : '';
  } catch { return ''; }
}

function imageBytesDataUrl(value) {
  if (!isObject(value) || !value.bytes || typeof Buffer === 'undefined') return '';
  try {
    const mime = /^image\//i.test(text(value.mime || value.type)) ? text(value.mime || value.type) : 'image/png';
    return `data:${mime};base64,${Buffer.from(value.bytes).toString('base64')}`;
  } catch { return ''; }
}

function contentToolCalls(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(item => isObject(item) && /^(?:tool_use|tool_call|function_call|function)$/i.test(text(item.type)))
    .map((item, index) => normaliseToolCall({ ...item, function: item.function || { name: item.name, arguments: item.arguments ?? item.input ?? item.parameters ?? {} } }, index)).filter(Boolean);
}

function normaliseImages(value) {
  return list(value).map((item) => {
    if (typeof item === 'string') {
      const safe = safeRemoteImageUrl(item);
      return safe ? { dataUrl: safe } : null;
    }
    if (!isObject(item)) return null;
    const safe = [item.dataUrl, item.url, item.src, item.previewUrl, item.viewUrl]
      .map(safeRemoteImageUrl).find(Boolean) || '';
    if (safe) return { ...item, dataUrl: safe };
    const materialised = imageBytesDataUrl(item);
    return materialised ? { ...item, dataUrl: materialised } : null;
  }).filter(Boolean);
}

function strictToolCalls(value) {
  const rows = Array.isArray(value) ? value : value == null ? [] : [value];
  return rows.map((item, index) => {
    if (!isObject(item) || !text(item.id || item.call_id || item.callId)) return null;
    const call = normaliseToolCall(item, index);
    if (!call?.id || !call.function?.name) return null;
    try {
      if (!isObject(JSON.parse(call.function.arguments))) return null;
    } catch { return null; }
    return call;
  }).filter(Boolean);
}

/** OpenAI-compatible multimodal content. */
function contentParts(value, images) {
  const urls = normaliseImages(images).map(imageUrl).filter(Boolean);
  const body = text(value) || '【图片】请查看用户提供的图片并按任务要求回答。';
  if (!urls.length) return body;
  return [{ type: 'text', text: body }, ...urls.map((url) => ({ type: 'image_url', image_url: { url } }))];
}

function messageForApi(message) {
  if (!isObject(message) || !['system', 'user', 'assistant', 'tool'].includes(message.role)) return null;
  const output = { role: message.role };
  const content = message.content == null ? message.text : message.content;
  if (message.role === 'tool') {
    if (!text(message.tool_call_id)) return null;
    output.tool_call_id = text(message.tool_call_id);
    output.content = contentText(content);
    return output;
  }
  output.content = Array.isArray(content) ? content.map(part => {
    if (part?.type === 'image_url' && message.role === 'user') {
      const url = safeRemoteImageUrl(part.image_url?.url);
      return url ? { type: 'image_url', image_url: { url } } : null;
    }
    return part?.type === 'text' ? { type: 'text', text: contentText(part.text) } : null;
  }).filter(Boolean) : contentText(content);
  if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
    output.tool_calls = strictToolCalls(message.tool_calls);
    if (!output.tool_calls.length) delete output.tool_calls;
  }
  return output;
}

function sanitiseApiMessages(messages) { return messages; }

function splitThink(value) {
  const source = text(value);
  const thinkMark = /(?:【思考过程】|\[思考过程\]|<thinking>|<think>)/i;
  const finalMark = /(?:【最终提示词】|\[最终提示词\]|<final>|<prompt>)/i;
  const ti = source.search(thinkMark);
  const fi = source.search(finalMark);
  let thinking = '';
  let rest = source;
  if (fi >= 0) {
    thinking = ti >= 0 && ti < fi ? source.slice(ti, fi) : source.slice(0, fi);
    rest = source.slice(fi);
    thinking = thinking.replace(/^\s*(?:【思考过程】|\[思考过程\]|<thinking>|<think>)\s*[:：]?/i, '').trim();
    rest = rest.replace(/^\s*(?:【最终提示词】|\[最终提示词\]|<final>|<prompt>)\s*[:：]?/i, '').trim();
  } else if (ti >= 0) {
    thinking = source.slice(ti).replace(/^\s*(?:【思考过程】|\[思考过程\]|<thinking>|<think>)\s*[:：]?/i, '').trim();
    rest = source.slice(0, ti).trim();
  }
  return { thinking, rest: stripCodeFence(rest) };
}

function splitNegative(value) {
  const source = text(value);
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex((line) => /(?:负面提示词|负面 Tag|negative prompt|negative tags?)/i.test(line));
  if (index < 0) return { prompt: source, negative: '' };
  const prompt = lines.slice(0, index).join('\n').trim();
  const negative = lines.slice(index).join('\n')
    .replace(/^\s*[【\[（(]?\s*(?:负面提示词|负面 Tag|negative prompt|negative tags?)\s*[】\]）)]?\s*[:：-]?\s*/i, '')
    .trim();
  return { prompt, negative };
}

function stripCodeFence(value) {
  return text(value).replace(/^```[\w-]*\s*/, '').replace(/\s*```$/, '').trim();
}

function parseReply(value) {
  const thought = splitThink(value);
  const result = splitNegative(thought.rest);
  const reply = {
    thinking: thought.thinking,
    prompt: result.prompt,
    negative: result.negative,
    text: text(value)
  };
  reply.think = reply.thinking;
  reply.pos = reply.prompt;
  reply.neg = reply.negative;
  return reply;
}

function normaliseToolCall(value, index = 0) {
  if (!isObject(value)) return null;
  const fn = isObject(value.function) ? value.function : (isObject(value.function_call) ? value.function_call : (isObject(value.functionCall) ? value.functionCall : {}));
  const name = text(fn.name || value.name || value.tool || value.tool_name).replace(/^(?:functions?|tools?)[.:]/i, '');
  if (!name) return null;
  let args = fn.arguments ?? fn.args ?? fn.input ?? value.arguments ?? value.args ?? value.input ?? value.parameters ?? {};
  if (typeof args !== 'string') {
    try { args = JSON.stringify(args || {}); } catch { args = '{}'; }
  }
  return {
    id: text(value.id || value.call_id || value.callId, `call_${index}`),
    type: text(value.type, 'function'),
    function: { name, arguments: text(args, '{}') }
  };
}

function normaliseToolCalls(value) {
  if (typeof value === 'string') {
    try { return normaliseToolCalls(JSON.parse(value)); } catch { return []; }
  }
  const rows = Array.isArray(value) ? value : value == null ? [] : [value];
  return rows.map((item, index) => normaliseToolCall(item, index)).filter(Boolean);
}

function normaliseCompletion(value) {
  if (typeof value === 'string') return { ok: true, text: value, reasoning: '', toolCalls: [], raw: value };
  if (!isObject(value)) { const output = contentText(value); return { ok: true, text: output, reasoning: '', toolCalls: [], raw: value }; }
  const nested = value.choices?.[0]?.message || value.choices?.[0]?.delta || value.message || value.delta || null;
  const source = nested && isObject(nested) ? { ...value, ...nested } : value;
  const embeddedCalls = [...contentToolCalls(source.content), ...contentToolCalls(source.text)];
  const responseCalls = source.output?.filter?.(item => item?.type === 'function_call' || item?.type === 'tool_call' || item?.type === 'tool_use');
  const directCalls = normaliseToolCalls(source.toolCalls || source.tool_calls || source.function_call || source.functionCall);
  const toolCalls = directCalls.length ? directCalls : (responseCalls?.length ? normaliseToolCalls(responseCalls) : embeddedCalls);
  const responseText = contentText(source.text != null ? source.text : source.content);
  const responseReasoning = contentText(source.reasoning != null ? source.reasoning : source.reasoning_content);
  const markedCalls = toolCalls;
  return {
    ok: source.ok !== false,
    ...(source.ok === false ? { code: source.code, error: source.error || source.text || 'AI request failed' } : {}),
    text: responseText,
    reasoning: responseReasoning,
    usage: source.usage || null,
    finishReason: source.finishReason || source.finish_reason || value.choices?.[0]?.finish_reason || null,
    toolCalls: clone(markedCalls),
    raw: value.raw || value
  };
}

function abortError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function responseChunk(data) {
  if (!isObject(data)) return { content: '', reasoning: '', done: false };
  const choice = data.choices && data.choices[0];
  const delta = choice && (choice.delta || choice.message || choice);
  const content = contentText(delta && (delta.content != null ? delta.content : delta.text));
  const reasoning = contentText(delta && (delta.reasoning_content != null ? delta.reasoning_content : delta.reasoning));
  let rawToolCalls = delta?.tool_calls || delta?.toolCalls || delta?.tool_call;
  if (typeof rawToolCalls === 'string') {
    try { rawToolCalls = JSON.parse(rawToolCalls); } catch { rawToolCalls = null; }
  }
  const toolCalls = (Array.isArray(rawToolCalls) ? clone(rawToolCalls) : rawToolCalls ? [clone(rawToolCalls)] : []);
  toolCalls.push(...contentToolCalls(delta?.content));
  const legacyFunctionCall = delta?.function_call || delta?.functionCall;
  if (legacyFunctionCall && isObject(legacyFunctionCall)) toolCalls.push({ index: 0, type: 'function', function: clone(legacyFunctionCall) });
  return {
    content,
    reasoning,
    done: data.done === true || choice?.finish_reason != null,
    finishReason: choice?.finish_reason || null,
    toolCalls,
    usage: data.usage || null,
    raw: data
  };
}

function eventParts(event) {
  if (typeof event === 'string') return { content: event, reasoning: '', done: false };
  if (!isObject(event)) return { content: '', reasoning: '', done: false };
  if (Array.isArray(event.choices)) {
    const part = responseChunk(event);
    return { ...part, raw: event };
  }
  const kind = text(event.type).toLowerCase();
  const content = kind === 'reasoning' || kind === 'thought' ? '' : contentText(event.content ?? event.delta ?? event.text);
  const reasoning = contentText(event.reasoning ?? event.reasoning_content) || (kind === 'reasoning' || kind === 'thought' ? contentText(event.content ?? event.delta ?? event.text) : '');
  const rawToolCalls = event.toolCalls || event.tool_calls || event.function_call || event.functionCall;
  const toolCalls = rawToolCalls ? (Array.isArray(rawToolCalls) ? clone(rawToolCalls) : [clone(rawToolCalls)]) : [];
  return { content, reasoning, toolCalls, done: Boolean(event.done || kind === 'done' || kind === 'complete'), usage: event.usage || null, finishReason: event.finishReason || event.finish_reason || null, raw: event };
}

function createAiClient(initialConfig = {}, injectedGateway = null, monitor = null) {
  const gateway = injectedGateway && (typeof injectedGateway.complete === 'function' || typeof injectedGateway.stream === 'function')
    ? injectedGateway
    : (initialConfig && (typeof initialConfig.complete === 'function' || typeof initialConfig.stream === 'function') ? initialConfig : null);
  const configSource = gateway && isObject(initialConfig.config) ? initialConfig.config : initialConfig;
  const config = {
    base: text(configSource.base || configSource.apiBase),
    model: text(configSource.model),
    key: text(configSource.key || configSource.apiKey),
    temperature: Number.isFinite(Number(configSource.temperature)) ? Number(configSource.temperature) : 0.7,
    timeoutMs: Number(configSource.timeoutMs) || 120000,
    maxTokens: configSource.maxTokens
  };

  function setConfig(next = {}) {
    if (!isObject(next)) return clone(config);
    for (const key of ['base', 'model', 'key', 'temperature', 'timeoutMs', 'maxTokens', 'visionModel']) {
      if (next[key] !== undefined) config[key] = next[key];
    }
    return clone(config);
  }

  function getConfig() { return clone(config); }

  function modelsUrls(base) {
    const value = text(base).replace(/\/+$/, '');
    if (!value) return [];
    if (/\/models$/i.test(value)) return [value];
    if (/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/v1)?$/i.test(value)) {
      const origin = value.replace(/\/v1$/i, '');
      return [`${origin}/v1/models`, `${origin}/api/tags`];
    }
    return [value + '/models'];
  }

  function modelNames(payload) {
    const rows = Array.isArray(payload) ? payload : payload?.data || payload?.models || payload?.items || [];
    return rows.map(item => typeof item === 'string' ? item : text(item?.id || item?.name || item?.model)).filter(Boolean);
  }

  function requestUrl(base) {
    const value = text(base).replace(/\/+$/, '');
    if (!value) return '';
    if (/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(value)) return value + '/v1/chat/completions';
    return /\/chat\/completions$/i.test(value) ? value : `${value}/chat/completions`;
  }

  function mergedOptions(options = {}) {
    const source = isObject(options) ? options : {};
    return { ...config, ...source, base: source.base ?? config.base, model: source.model ?? config.model };
  }

  async function complete(messages, options = {}) {
    if (!monitor) return completeRequest(messages, options);
    let handle = null;
    let partialText = '', partialReasoning = '';
    const signal = options.signal;
    const observe = action => { try { return action(); } catch { return null; } };
    const finish = (result, error) => observe(() => monitor.endExchange(handle, result, error));
    const aborted = () => finish({ text: partialText, reasoning: partialReasoning, partial: true }, signal.reason || { code: 'CANCELLED', message: '请求已取消' });
    signal?.addEventListener('abort', aborted, { once: true });
    try {
      const result = await completeRequest(messages, {
        ...options,
        captureRequest: (request, key) => { handle = observe(() => monitor.beginExchange(request, [key])); },
        onDelta: (delta, reasoning) => {
          if (partialText.length < 128 * 1024) partialText += contentText(delta);
          if (partialReasoning.length < 128 * 1024) partialReasoning += contentText(reasoning);
          options.onDelta?.(delta, reasoning);
        }
      });
      finish(result, null); return result;
    } catch (error) {
      finish({ text: partialText, reasoning: partialReasoning, partial: true }, error); throw error;
    } finally { signal?.removeEventListener('abort', aborted); }
  }
  async function completeRequest(messages, options = {}) {
    if (typeof messages === 'string') messages = [{ role: 'user', content: messages }];
    else if (isObject(messages) && !Array.isArray(messages)) messages = [{ role: 'user', content: text(messages.text || messages.prompt) }];
    const opts = mergedOptions(options);
    const apiMessages = sanitiseApiMessages(list(messages).map((item) => messageForApi(item)).filter(Boolean));
    if (!apiMessages.length) apiMessages.push({ role: 'user', content: '' });
    const stream = opts.stream !== false;
    const body = { model: opts.model, messages: apiMessages, stream, temperature: Number.isFinite(Number(opts.temperature)) ? Number(opts.temperature) : 0.7 };
    if (Array.isArray(opts.tools) && opts.tools.length) body.tools = clone(opts.tools);
    if (opts.tool_choice != null) body.tool_choice = opts.tool_choice;
    if (opts.maxTokens != null && Number(opts.maxTokens) > 0) body.max_tokens = Number(opts.maxTokens);
    if (opts.reasoning_effort != null) body.reasoning_effort = opts.reasoning_effort;
    if (opts.enable_thinking != null) body.enable_thinking = opts.enable_thinking;
    if (opts.thinking != null) body.thinking = clone(opts.thinking);
    let endpoint = '';
    try { const url = new URL(requestUrl(opts.base)); endpoint = url.origin + url.pathname; } catch { /* incomplete config */ }
    opts.captureRequest?.({ transport: gateway ? 'gateway' : 'http', endpoint, body, headers: opts.key ? { Authorization: `Bearer ${opts.key}` } : {} }, opts.key);
    if (gateway) {
      const startedAt = Date.now();
      const emit = (content, reasoning) => {
        if (typeof opts.onEvent === 'function') opts.onEvent({ content: contentText(content), reasoning: contentText(reasoning) });
        if (typeof opts.onDelta === 'function' && (content || reasoning)) opts.onDelta(contentText(content), contentText(reasoning));
      };
      const gatewayOptions = { ...opts, onDelta: emit, onEvent: emit };
      delete gatewayOptions.captureRequest;
      let value;
      if (opts.stream !== false && typeof gateway.stream === 'function') value = await gateway.stream(apiMessages, gatewayOptions);
      else if (typeof gateway.complete === 'function') value = await gateway.complete(apiMessages, gatewayOptions);
      else value = await gateway.stream(apiMessages, gatewayOptions);
      if (value && typeof value !== 'string' && (typeof value[Symbol.asyncIterator] === 'function' || typeof value[Symbol.iterator] === 'function')) {
        let full = ''; let reasoning = ''; let usage = null; const toolCalls = [];
        for await (const event of value) { const part = eventParts(event); full += part.content || ''; reasoning += part.reasoning || ''; usage = part.usage || usage; if (part.toolCalls?.length) toolCalls.push(...part.toolCalls); emit(part.content, part.reasoning); }
        return { ok: true, text: full, reasoning, usage, toolCalls: normaliseToolCalls(toolCalls), elapsedMs: Date.now() - startedAt, raw: null };
      }
      const result = normaliseCompletion(value); result.elapsedMs = Date.now() - startedAt; return result;
    }
    if (!opts.base || !opts.model) return { ok: false, text: '请先填写 API 地址和模型名', reasoning: '', status: 'config' };
    if (typeof fetch !== 'function') throw abortError('当前环境没有 fetch', 'FETCH_UNAVAILABLE');

    const externalSignal = opts.signal;
    if (externalSignal?.aborted) throw externalSignal.reason || abortError('已停止', 'CANCELLED');
    const startedAt = Date.now();
    try {
      const response = await fetch(requestUrl(opts.base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}) },
        body: JSON.stringify(body),
        signal: externalSignal
      });
      if (!response.ok) {
        let detail = '';
        try { detail = (await response.text()).slice(0, 300); } catch { /* ignore */ }
        const statusHint = response.status === 401 || response.status === 403
          ? '（API Key 认证失败，请检查「API 设置 → API Key / 识图 API Key」是否正确）'
          : response.status === 404
            ? '（接口或模型不存在，请检查「API 地址」与「模型名」）'
            : response.status === 429
              ? '（请求过于频繁或额度不足，请稍后再试）'
              : '';
        const redacted = String(detail).replace(/(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, '$1****')
          .replace(/(Authorization['":\s]+Bearer\s+)[A-Za-z0-9_-]+/gi, '$1****');
        throw abortError(`AI 请求失败：HTTP ${response.status}${redacted ? ` · ${redacted}` : ''}${statusHint}`, response.status === 401 || response.status === 403 ? 'AUTH_FAILED' : 'HTTP_ERROR');
      }
      if (!stream || !response.body || (typeof response.body.getReader !== 'function' && typeof response.body[Symbol.asyncIterator] !== 'function')) {
        const data = await response.json();
        const message = data?.choices?.[0]?.message || data?.choices?.[0]?.delta || data?.message || data?.delta || data;
        const result = normaliseCompletion({
          ok: true,
          text: message?.content != null ? message.content : data?.output_text,
          reasoning: message?.reasoning_content != null ? message.reasoning_content : message?.reasoning,
          toolCalls: message?.tool_calls || message?.toolCalls || message?.function_call || message?.functionCall || data?.tool_calls || data?.toolCalls || data?.function_call || data?.functionCall,
          usage: data?.usage,
          raw: data
        });
        result.elapsedMs = Date.now() - startedAt;
        result.httpStatus = response.status;
        if (typeof opts.onDelta === 'function' && result.text) opts.onDelta(result.text, result.reasoning || '');
        return result;
      }
      const result = await readStream(response.body, opts);
      result.elapsedMs = Date.now() - startedAt;
      result.httpStatus = response.status;
      result.responseFormat = 'assembled-stream';
      return result;
    } catch (error) {
      if (externalSignal?.aborted) throw externalSignal.reason || abortError('已停止', 'CANCELLED');
      throw error;
    }
  }

  async function listModels(options = {}) {
    const opts = mergedOptions(options);
    const urls = modelsUrls(opts.base);
    if (!urls.length) return { ok: false, models: [], status: 'config', error: '请先填写 API 地址' };
    if (typeof fetch !== 'function') return { ok: false, models: [], status: 'unavailable', error: '当前环境没有 fetch' };
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort?.(), Number(options.timeoutMs) || 8000);
    let lastError = null;
    try {
      for (const url of urls) {
        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json', ...(opts.key ? { Authorization: 'Bearer ' + opts.key } : {}) },
            signal: controller?.signal
          });
          if (!response.ok) throw new Error('模型列表请求失败：HTTP ' + response.status);
          const payload = await response.json();
          const models = [...new Set(modelNames(payload))];
          if (models.length || urls.length === 1) return { ok: true, models, url };
          lastError = new Error('模型列表为空');
        } catch (error) {
          lastError = error;
        }
      }
      return { ok: false, models: [], status: 'error', error: text(lastError?.message, '模型列表请求失败'), url: urls[0] };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function readStream(body, opts) {
    let full = '';
    let reasoning = '';
    let usage = null;
    let finishReason = null;
    const toolCallParts = new Map();
    let pending = '';
    const decoder = typeof TextDecoder === 'function' ? new TextDecoder() : null;
    const consume = (line) => {
      const value = String(line || '').trim();
      if (!value || value.startsWith(':')) return;
      const payload = value.startsWith('data:') ? value.slice(5).trim() : value;
      if (!payload || payload === '[DONE]') return;
      let data;
      try { data = JSON.parse(payload); } catch { return; }
      const part = responseChunk(data);
      if (part.content) full += part.content;
      if (part.reasoning) reasoning += part.reasoning;
      if (part.usage) usage = part.usage;
      if (part.finishReason) finishReason = part.finishReason;
      for (const item of part.toolCalls || []) {
        const knownIndex = item.id ? [...toolCallParts.entries()].find(([, current]) => current.id && current.id === String(item.id))?.[0] : undefined;
        const index = Number.isFinite(Number(item.index)) ? Number(item.index) : (knownIndex == null ? (item.id && toolCallParts.size ? toolCallParts.size : 0) : knownIndex);
        const current = toolCallParts.get(index) || { index, id: '', type: 'function', function: { name: '', arguments: '' } };
        if (item.id && !current.id) current.id = String(item.id);
        if (item.type) current.type = item.type;
        if (item.function?.name) {
          const name = String(item.function.name);
          current.function.name = !current.function.name
            ? name
            : name === current.function.name || name.startsWith(current.function.name)
              ? name
              : current.function.name.endsWith(name)
                ? current.function.name
                : current.function.name + name;
        }
        if (item.function?.arguments) {
          const fragment = String(item.function.arguments);
          const previous = current.function.arguments || '';
          current.function.arguments = fragment.startsWith(previous) ? fragment : previous.endsWith(fragment) ? previous : previous + fragment;
        }
        toolCallParts.set(index, current);
      }
      if (typeof opts.onEvent === 'function') opts.onEvent({ ...part });
      if ((part.content || part.reasoning) && typeof opts.onDelta === 'function') opts.onDelta(part.content, part.reasoning);
    };
    const consumeBytes = (chunk) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      pending += decoder ? decoder.decode(bytes, { stream: true }) : Buffer.from(bytes).toString('utf8');
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      lines.forEach(consume);
    };
    if (typeof body.getReader === 'function') {
      const reader = body.getReader();
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        consumeBytes(part.value);
      }
    } else {
      for await (const chunk of body) consumeBytes(chunk);
    }
    if (decoder) pending += decoder.decode();
    if (pending) consume(pending);
    const streamedToolCalls = [...toolCallParts.values()].sort((a, b) => a.index - b.index).map(item => ({
      id: item.id || `call_${item.index}`,
      type: item.type || 'function',
      function: {
        name: item.function?.name || '',
        arguments: item.function?.arguments || '{}'
      }
    }));
    const toolCalls = streamedToolCalls.length ? normaliseToolCalls(streamedToolCalls) : [];
    return { ok: true, text: full, reasoning, usage, finishReason, toolCalls, raw: null };
  }

  return { complete, stream: (messages, options) => complete(messages, { ...(options || {}), stream: true }), listModels, setConfig, configure: setConfig, getConfig, config: getConfig };
}


module.exports = { createAiClient, normaliseCompletion, contentParts, parseReply, splitThink, splitNegative };

