'use strict';

/**
 * Assistant
 * ----------
 *
 * 这是重写版唯一的 AI 业务入口。代码故意保持“一个模块、几个清楚的步骤”：
 * 组装 Prompt → 调用 AI → 解析结果 → 写入会话。它不复制旧版的全局变量、
 * Bridge、双重 Store 或页面事件，只给页面暴露少量直接可用的方法。
 */

const fs = require('node:fs');
const path = require('node:path');
const { createComfy } = require('./comfy');
const { createCalls } = require('./calls');
const { createAiRunner } = require('./ai-runner');
const { addCandidate, evaluateCandidate, markRecommended, selectCandidate, snapshot: candidateSnapshot, finalCandidate } = require('./draw-candidates');

const PROMPT_FILES = Object.freeze({
  main: '01-内部主提示词-MAIN_PROMPT.txt',
  generate: '02-生成Tag任务-GEN_TASK.txt',
  chat: '03-自由对话任务-CHAT_TASK.txt',
  vision: '04-识图描述提示词-DEFAULT_VISION_PROMPT.txt',
  comfy: '05-ComfyUI提示词协议.txt',
  quality: '06-默认质量前缀-DEFAULT_QP.txt',
  appendices: '07-默认附录提示词.txt'
});

// 旧会话只在恢复时做一次性映射；运行时只接受 assistant / draw 两种
// 用户模式。Generate、Recreate、ComfyIteration 仍可作为 draw 的任务上下文。
const LEGACY_MODE_MAP = Object.freeze({
  assistant: 'assistant',
  assist: 'assistant',
  conversation: 'assistant',
  chat: 'assistant',
  draw: 'draw',
  gen: 'draw',
  generate: 'draw',
  generation: 'draw',
  rk: 'draw',
  recreate: 'draw',
  vision: 'draw',
  comfy: 'draw',
  comfyiteration: 'draw'
});

const NSFW_ALLOW = '【内容政策】用户已允许成人向内容。请按用户要求专业输出相关绘图 Tag，不要加入无关说教。';
const NSFW_GUARD = '【内容政策】成人标签未开启；如果需求涉及成人内容，请提醒用户先开启成人标签。';
const PROMPT_MODULES = Object.freeze(['assistant', 'draw']);
const PROFILE_ALIASES = Object.freeze({ talk: 'assistant', chat: 'assistant', assist: 'assistant', assistant: 'assistant', gen: 'draw', generate: 'draw', generation: 'draw', rk: 'draw', recreate: 'draw', comfy: 'draw', comfyiteration: 'draw', draw: 'draw' });
const DEFAULT_PROMPT_MODS = Object.freeze({
  main: ['draw'],
  generate: ['draw'],
  quality: ['draw'],
  vision: ['assistant', 'draw'],
  comfy: ['draw']
});

const TOOL_GUIDANCE = `【可调用工具与硬性调用规则】
工具名称以函数 schema 中的 name 为准（界面显示名中的点号会转换为下划线，例如 tags.search=tags_search、comfy.render=comfy_render、vision.processOne=vision_processOne）。需要使用工具时，必须返回原生 tool_calls/function call，不要只在普通文字中说“我将调用工具”。
遇到不确定、可能不是标准的站内 Tag 时，先调用 tags_search（query 填待确认的 Tag）；查询结果只作辅助参考，用户明确给出的 Tag 优先。需要识图时必须调用 vision_processOne，并传入明确的单个 imageId 与 mode（metadata、local 或 ai）；不要传 imageIds 数组，也不要让工具猜图片。识图结果只提供常见绘图 Tag 辅助参考，可能漏掉细节、误判或识别过多，不能当作绝对事实。
调用工具时只传递完成当前任务所需的参数，不要伪造工具结果。`;
const VISION_MODEL_HINT = /vision|[-_]?vl(?:[-_]|$)|gpt-4o|gpt-4\.1|qwen.*vl|llava|moondream|internvl|minicpm[-_]?v|pixtral|gemma.*vision|gemini|claude-3|claude.*sonnet|glm-4v|qvq|deepseek.*(?:vision|vl)|kimi.*vision/i;
const TEXT_ONLY_MODEL_HINT = /deepseek-(?:chat|reasoner|v[23](?:\.\d+)?)(?:$|[-_:])|deepseek-v4-(?:flash|pro)(?![-_]vision)(?:$|[-_:])|gpt-3\.5|text-embedding|(?:^|\/)qwen(?:2(?:\.5)?|3)(?:$|[-_:])|(?:^|\/)llama3(?:$|[-_:])/i;

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

function activitySnapshot(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && typeof item === 'object').slice(-80).map(item => ({
    id: text(item.id),
    type: text(item.type, 'event'),
    name: text(item.name),
    round: Number(item.round) || 0,
    iteration: Number(item.iteration) || 0,
    status: text(item.status, 'done'),
    message: text(item.message),
    candidateId: text(item.candidateId),
    createdAt: Number(item.createdAt) || Date.now()
  }));
}

function modelLooksVision(value) {
  return VISION_MODEL_HINT.test(String(value || ''));
}

function modelClearlyTextOnly(value) {
  return !modelLooksVision(value) && TEXT_ONLY_MODEL_HINT.test(String(value || ''));
}

function messagesContainImage(messages) {
  return list(messages).some(message => {
    const content = message?.content;
    if (Array.isArray(content) && content.some(part => part?.type === 'image_url' || part?.type === 'image')) return true;
    return Array.isArray(message?.images) && message.images.length > 0;
  });
}

function normalisePromptMods(value) {
  const source = isObject(value) ? value : {};
  const result = {};
  Object.keys(DEFAULT_PROMPT_MODS).forEach((key) => {
    const raw = Array.isArray(source[key]) ? source[key] : DEFAULT_PROMPT_MODS[key];
    result[key] = [...new Set(raw.map(item => PROFILE_ALIASES[String(item).toLowerCase()] || String(item)).filter((item) => PROMPT_MODULES.includes(item)))];
  });
  return result;
}

function uid(prefix, sequence) {
  return `${prefix}_${Date.now().toString(36)}_${(++sequence.value).toString(36)}`;
}

function readPrompts(promptDir) {
  const dir = promptDir ? path.resolve(promptDir) : '';
  const values = {};
  for (const [key, filename] of Object.entries(PROMPT_FILES)) {
    try {
      values[key] = fs.readFileSync(path.join(dir, filename), 'utf8').replace(/^\uFEFF/, '').trim();
    } catch {
      values[key] = '';
    }
  }
  return values;
}

function promptValues(source, promptDir) {
  const values = readPrompts(promptDir);
  if (source && typeof source.snapshot === 'function') {
    try {
      const snapshot = source.snapshot();
      Object.assign(values, snapshot && (snapshot.values || snapshot));
    } catch { /* use files */ }
  } else if (source && typeof source.get === 'function') {
    for (const key of Object.keys(PROMPT_FILES)) {
      try { values[key] = text(source.get(key), values[key]); } catch { /* keep file */ }
    }
  } else if (isObject(source)) {
    Object.assign(values, source);
  }
  return values;
}

function normaliseMode(value) {
  const raw = text(value, 'assistant').toLowerCase();
  return raw === 'draw' ? 'draw' : 'assistant';
}

function migrateLegacyMode(value) {
  const raw = text(value, 'assistant').toLowerCase();
  return LEGACY_MODE_MAP[raw] || 'assistant';
}

function normaliseTask(value) {
  const raw = text(value).toLowerCase();
  if (raw === 'comfy' || raw === 'comfyiteration') return 'comfy';
  if (raw === 'draw' || raw === 'generate' || raw === 'generation' || raw === 'gen' || raw === 'recreate' || raw === 'rk' || raw === 'vision') return 'draw';
  return 'assistant';
}

function migrateLegacyTask(value) {
  const raw = text(value).toLowerCase();
  if (raw === 'comfy' || raw === 'comfyiteration') return 'comfy';
  if (raw === 'draw' || raw === 'generate' || raw === 'generation' || raw === 'gen' || raw === 'recreate' || raw === 'rk' || raw === 'vision') return 'draw';
  return 'assistant';
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

function contentToolCalls(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(item => isObject(item) && /^(?:tool_use|tool_call|function_call|function)$/i.test(text(item.type)))
    .map((item, index) => normaliseToolCall({ ...item, function: item.function || { name: item.name, arguments: item.arguments ?? item.input ?? item.parameters ?? {} } }, index)).filter(Boolean);
}

function normaliseImages(value) {
  return list(value).map((item) => {
    if (typeof item === 'string') return { dataUrl: item };
    return isObject(item) ? item : null;
  }).filter((item) => item && imageUrl(item));
}

/** OpenAI-compatible multimodal content. */
function contentParts(value, images) {
  const urls = normaliseImages(images).map(imageUrl).filter(Boolean);
  const body = text(value) || '【图片】请查看用户提供的图片并按任务要求回答。';
  if (!urls.length) return body;
  return [{ type: 'text', text: body }, ...urls.map((url) => ({ type: 'image_url', image_url: { url } }))];
}

function messageForApi(message, imageResolver) {
  if (!isObject(message)) return null;
  const role = normaliseRole(message.role);
  if (!['system', 'user', 'assistant', 'tool'].includes(role)) return null;
  if (role === 'tool') {
    const toolBody = message.content != null ? message.content : message.text;
    return {
      role,
      tool_call_id: text(message.tool_call_id || message.toolCallId),
      name: text(message.name),
      content: Array.isArray(toolBody) ? clone(toolBody) : contentText(toolBody)
    };
  }
  let body = message.content != null ? message.content : message.text;
  const ref = text(message.imageReference || message.imageRef || message.imgRef);
  if (Array.isArray(body)) {
    body = body.map((part) => {
      if (!isObject(part)) return { type: 'text', text: contentText(part) };
      if (part.type === 'image_url' && part.image_url) return { type: 'image_url', image_url: { url: imageUrl(part.image_url) || imageUrl(part) } };
      if (part.type === 'text') return { type: 'text', text: contentText(part.text) };
      return { type: 'text', text: contentText(part) };
    }).filter((part) => part.type !== 'text' || part.text);
    if (ref) body.unshift({ type: 'text', text: ref });
  } else if (ref) body = `${contentText(body)}\n\n${ref}`.trim();
  let images = normaliseImages(message.images || message.imgs);
  if (!images.length && imageResolver && message.imageIds) images = normaliseImages(list(message.imageIds).map(imageResolver));
  if (Array.isArray(body)) {
    if (images.length && !body.some((part) => part.type === 'image_url')) body = [...body, ...normaliseImages(images).map((item) => ({ type: 'image_url', image_url: { url: imageUrl(item) } }))];
    return { role, content: body.length ? body : [{ type: 'text', text: '' }] };
  }
  const output = { role, content: images.length ? contentParts(body, images) : contentText(body) };
  const calls = message.tool_calls || message.toolCalls;
  if (role === 'assistant' && Array.isArray(calls) && calls.length) output.tool_calls = clone(calls);
  return output;
}

function sessionClone(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sessionClone);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'bytes' || key === 'dataUrl') continue;
    output[key] = sessionClone(item);
  }
  return output;
}

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

function embeddedJsonObjects(value) {
  const source = String(value || '');
  const result = [];
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== '{') continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') { quoted = true; continue; }
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try { result.push(JSON.parse(source.slice(start, index + 1))); } catch { /* not a complete JSON object */ }
          start = index;
          break;
        }
      }
    }
  }
  return result;
}

function parseMarkedToolCalls(value) {
  const source = text(value);
  if (!source) return [];
  const result = [];
  const patterns = [
    /<\s*tool[_ -]?call\s*>\s*([\s\S]*?)\s*<\s*\/\s*tool[_ -]?call\s*>/gi,
    /<\s*function[_ -]?call\s*>\s*([\s\S]*?)\s*<\s*\/\s*function[_ -]?call\s*>/gi,
    /<\|tool[_ -]?call\|>\s*([\s\S]*?)(?:<\|end[_ -]?tool[_ -]?call\|>|$)/gi,
    /<｜tool▁call▁begin｜>([\s\S]*?)<｜tool▁call▁end｜>/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      let payload = match[1].trim();
      // Some providers wrap one or more calls in a surrounding JSON array.
      try {
        const parsed = JSON.parse(payload);
        result.push(...normaliseToolCalls(parsed));
        continue;
      } catch { /* try an embedded JSON object below */ }
      const object = payload.match(/\{[\s\S]*\}/);
      if (!object) continue;
      try { result.push(...normaliseToolCalls(JSON.parse(object[0]))); } catch { /* malformed provider marker */ }
    }
  }
  // A few local gateways omit XML markers and return a bare JSON function
  // call in the text stream. Only accept objects that clearly carry a tool
  // name/function, so ordinary JSON in a response is left untouched.
  for (const object of embeddedJsonObjects(source)) {
    if (object && (object.name || object.tool || object.function || object.function_call)
      && (object.arguments != null || object.args != null || object.input != null || object.parameters != null || object.function || object.function_call)) result.push(...normaliseToolCalls(object));
  }
  const seen = new Set();
  return result.filter(call => {
    const key = `${call.function.name}|${call.function.arguments}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normaliseCompletion(value) {
  if (typeof value === 'string') return { ok: true, text: value, reasoning: '', toolCalls: parseMarkedToolCalls(value), raw: value };
  if (!isObject(value)) { const output = contentText(value); return { ok: true, text: output, reasoning: '', toolCalls: parseMarkedToolCalls(output), raw: value }; }
  const nested = value.choices?.[0]?.message || value.choices?.[0]?.delta || value.message || value.delta || null;
  const source = nested && isObject(nested) ? { ...value, ...nested } : value;
  const embeddedCalls = [...contentToolCalls(source.content), ...contentToolCalls(source.text)];
  const responseCalls = source.output?.filter?.(item => item?.type === 'function_call' || item?.type === 'tool_call' || item?.type === 'tool_use');
  const directCalls = normaliseToolCalls(source.toolCalls || source.tool_calls || source.function_call || source.functionCall);
  const toolCalls = directCalls.length ? directCalls : (responseCalls?.length ? normaliseToolCalls(responseCalls) : embeddedCalls);
  const responseText = contentText(source.text != null ? source.text : source.content);
  const responseReasoning = contentText(source.reasoning != null ? source.reasoning : source.reasoning_content);
  const markedCalls = toolCalls.length ? toolCalls : parseMarkedToolCalls(`${responseText}\n${responseReasoning}`);
  return {
    ok: source.ok !== false,
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
  const toolCalls = rawToolCalls ? (Array.isArray(rawToolCalls) ? clone(rawToolCalls) : [clone(rawToolCalls)]) : parseMarkedToolCalls(content);
  return { content, reasoning, toolCalls, done: Boolean(event.done || kind === 'done' || kind === 'complete'), usage: event.usage || null, finishReason: event.finishReason || event.finish_reason || null, raw: event };
}

function createAiService(owner, initialConfig = {}, injectedGateway = null) {
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

  function modelsUrl(base) {
    const value = text(base).replace(/\/+$/, '');
    if (!value) return '';
    if (/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/v1)?$/i.test(value)) {
      return value.replace(/\/v1$/i, '') + '/api/tags';
    }
    return value + '/models';
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
    return { ...config, ...source, base: source.base || source.apiBase || config.base, model: source.model || config.model };
  }

  async function complete(messages, options = {}) {
    if (typeof messages === 'string') messages = [{ role: 'user', content: messages }];
    else if (isObject(messages) && !Array.isArray(messages)) messages = [{ role: 'user', content: text(messages.text || messages.prompt) }];
    const opts = mergedOptions(options);
    const apiMessages = list(messages).map((item) => messageForApi(item, owner && owner.resolveImage)).filter(Boolean);
    if (!apiMessages.length) apiMessages.push({ role: 'user', content: '' });
    if (gateway) {
      const startedAt = Date.now();
      const emit = (content, reasoning) => {
        if (typeof opts.onEvent === 'function') opts.onEvent({ content: contentText(content), reasoning: contentText(reasoning) });
        if (typeof opts.onDelta === 'function' && (content || reasoning)) opts.onDelta(contentText(content), contentText(reasoning));
      };
      const gatewayOptions = { ...opts, onDelta: emit, onEvent: emit };
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
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    let timer = null;
    const relayAbort = () => controller?.abort();
    if (externalSignal?.aborted) throw abortError('已停止', 'CANCELLED');
    if (externalSignal && controller && typeof externalSignal.addEventListener === 'function') externalSignal.addEventListener('abort', relayAbort, { once: true });
    if (controller && Number(opts.timeoutMs) > 0) timer = setTimeout(() => { timedOut = true; controller.abort(); }, Number(opts.timeoutMs));
    const startedAt = Date.now();
    const stream = opts.stream !== false || typeof opts.onDelta === 'function' || typeof opts.onEvent === 'function';
    const body = { model: opts.model, messages: apiMessages, stream, temperature: Number.isFinite(Number(opts.temperature)) ? Number(opts.temperature) : 0.7 };
    if (Array.isArray(opts.tools) && opts.tools.length) body.tools = clone(opts.tools);
    if (opts.tool_choice != null) body.tool_choice = opts.tool_choice;
    if (opts.maxTokens != null && Number(opts.maxTokens) > 0) body.max_tokens = Number(opts.maxTokens);
    try {
      const response = await fetch(requestUrl(opts.base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}) },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : externalSignal
      });
      if (!response.ok) {
        let detail = '';
        try { detail = (await response.text()).slice(0, 300); } catch { /* ignore */ }
        throw abortError(`AI 请求失败：HTTP ${response.status}${detail ? ` · ${detail}` : ''}`, 'HTTP_ERROR');
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
        if (typeof opts.onDelta === 'function' && result.text) opts.onDelta(result.text, result.reasoning || '');
        return result;
      }
      const result = await readStream(response.body, opts);
      result.elapsedMs = Date.now() - startedAt;
      return result;
    } catch (error) {
      if (timedOut) throw abortError(`AI 请求超时（${Number(opts.timeoutMs) || 0}ms）`, 'TIMEOUT');
      if (externalSignal?.aborted || controller?.signal.aborted) throw abortError('已停止', 'CANCELLED');
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      if (externalSignal && typeof externalSignal.removeEventListener === 'function') externalSignal.removeEventListener('abort', relayAbort);
    }
  }

  async function listModels(options = {}) {
    const opts = mergedOptions(options);
    const url = modelsUrl(opts.base);
    if (!url) return { ok: false, models: [], status: 'config', error: '请先填写 API 地址' };
    if (typeof fetch !== 'function') return { ok: false, models: [], status: 'unavailable', error: '当前环境没有 fetch' };
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort?.(), Number(options.timeoutMs) || 8000);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...(opts.key ? { Authorization: 'Bearer ' + opts.key } : {}) },
        signal: controller?.signal
      });
      if (!response.ok) throw new Error('模型列表请求失败：HTTP ' + response.status);
      const payload = await response.json();
      const models = [...new Set(modelNames(payload))];
      return { ok: true, models, url };
    } catch (error) {
      return { ok: false, models: [], status: 'error', error: text(error?.message, String(error || '模型列表请求失败')), url };
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
    const toolCalls = streamedToolCalls.length ? normaliseToolCalls(streamedToolCalls) : parseMarkedToolCalls(`${full}\n${reasoning}`);
    return { ok: true, text: full, reasoning, usage, finishReason, toolCalls, raw: null };
  }

  return { complete, stream: (messages, options) => complete(messages, { ...(options || {}), stream: true }), listModels, setConfig, configure: setConfig, getConfig, config: getConfig };
}

function parseAppendixText(value) {
  const source = text(value);
  if (!source) return [];
  const chunks = source.split(/^=====\s*附录\s*(\d+)\s*=====\s*$/m);
  const result = [];
  for (let i = 1; i < chunks.length; i += 2) {
    const index = Number(chunks[i]) || result.length + 1;
    const body = text(chunks[i + 1]);
    if (body) result.push({ id: `appendix-${index}`, index, text: body, title: `附录 ${index}`, enabled: false });
  }
  return result;
}

function createAssistant(options = {}) {
  const tags = options.tags || null;
  const images = options.images || null;
  const promptSource = options.promptSource || options.prompts || null;
  const prompts = promptValues(promptSource, options.promptDir);
  const sequence = { value: 0 };
  const state = {
    sessions: [], currentId: '', busy: false, status: 'idle', jobId: '', lastError: '', lastMode: '',
    config: { base: text(options.base || options.apiBase), model: text(options.model), temperature: Number(options.temperature) || 0.7, timeoutMs: Number(options.timeoutMs) || 120000 },
    settings: {}, presets: [], worlds: [], favorites: [], activePreset: '', activeWorld: ''
  };
  let activeJob = null;
  let ai = null;
  let visionAi = null;
  let calls = null;
  let visionService = options.visionService || null;
  let runner = null;
  const comfy = options.comfy && typeof options.comfy.render === 'function' ? options.comfy : createComfy(options.comfyOptions || {});
  if (options.comfyBase) comfy.setBase?.(options.comfyBase);
  if (options.comfyWorkflow) comfy.setWorkflow?.(options.comfyWorkflow);

  function storageRead() {
    const store = options.storage;
    try {
      if (store && typeof store.load === 'function') return store.load('sessions') || store.load();
      if (store && typeof store.get === 'function') return store.get('sessions');
    } catch { /* optional persistence */ }
    return null;
  }
  function readStored(key, fallback) {
    const store = options.storage;
    try {
      if (store && typeof store.get === 'function') return store.get(key, fallback);
      if (store && typeof store.load === 'function') return store.load(key, fallback);
    } catch { /* optional persistence */ }
    return fallback;
  }
  function writeStored(key, value) {
    const store = options.storage;
    try {
      if (store && typeof store.set === 'function') store.set(key, value);
      else if (store && typeof store.save === 'function') store.save(key, value);
    } catch { /* optional persistence */ }
    return clone(value);
  }
  function storageWrite() {
    const store = options.storage;
    const value = state.sessions.map((session) => sessionClone(session));
    try {
      if (store && typeof store.save === 'function') return store.save('sessions', value);
      if (store && typeof store.set === 'function') return store.set('sessions', value);
    } catch { /* optional persistence */ }
    return null;
  }
  function normalisePreset(value, index = 0) {
    const item = isObject(value) ? value : {};
    return { id: text(item.id, `preset_${Date.now()}_${index}`), name: text(item.name, '未命名预设'), main: text(item.main || item.sysPrompt), generate: text(item.generate || item.genTask), vision: text(item.vision || item.visionPrompt), quality: text(item.quality || item.qualityPrefix), comfy: text(item.comfy), mods: normalisePromptMods(item.mods || item.promptMods) };
  }
  function normaliseWorld(value, index = 0) {
    const item = isObject(value) ? value : {};
    const entries = Array.isArray(item.entries) ? item.entries : Object.values(item.entries || {});
    const normaliseProfiles = value => [...new Set(list(value).map(mod => PROFILE_ALIASES[String(mod).toLowerCase()] || String(mod)).filter(mod => PROMPT_MODULES.includes(mod)))];
    return { id: text(item.id, `world_${Date.now()}_${index}`), name: text(item.name, '未命名世界书'), enabled: item.enabled !== false, mods: normaliseProfiles(item.mods), entries: entries.filter(isObject).map((entry, ei) => ({ id: text(entry.id, `entry_${Date.now()}_${ei}`), name: text(entry.name, '条目'), keys: text(entry.keys || entry.key), content: text(entry.content || entry.text), enabled: entry.enabled !== false, constant: Boolean(entry.constant), mods: normaliseProfiles(entry.mods) })) };
  }
  function restoreBusinessState() {
    const defaults = {
      base: state.config.base, model: state.config.model, key: '', temperature: state.config.temperature, timeoutMs: state.config.timeoutMs,
      visionInheritPrimary: options.visionApi?.inheritPrimary === undefined ? !options.visionApi : Boolean(options.visionApi.inheritPrimary),
      visionBase: text(options.visionApi?.base || options.visionApi?.apiBase), visionModel: text(options.visionApi?.model), visionKey: text(options.visionApi?.key || options.visionApi?.apiKey), visionTemperature: Number(options.visionApi?.temperature) || 0.2, visionTimeoutMs: Number(options.visionApi?.timeoutMs) || 120000,
      strict: true, nsfwEnabled: false,
      agentWriteEnabled: false,
      comfyOn: false, comfyBase: 'http://127.0.0.1:8188', comfyWorkflow: '', comfyIters: 3,
      comfyW: 768, comfyH: 1024, comfySteps: 25, comfyCfg: 7, comfyNeg: '', comfySampler: '', comfyScheduler: ''
    };
    state.settings = { ...defaults, ...(isObject(readStored('rewrite_settings', {})) ? readStored('rewrite_settings', {}) : {}) };
    const presets = readStored('rewrite_presets', []); state.presets = (Array.isArray(presets) ? presets : []).map(normalisePreset);
    const worlds = readStored('rewrite_worlds', []); state.worlds = (Array.isArray(worlds) ? worlds : []).map(normaliseWorld);
    const favorites = readStored('rewrite_favorites', []); state.favorites = Array.isArray(favorites) ? favorites.map(clone) : [];
    state.activePreset = text(readStored('rewrite_active_preset', ''), state.presets[0]?.id || '');
    state.activeWorld = text(readStored('rewrite_active_world', ''), state.worlds[0]?.id || '');
  }
  function saveBusinessState() {
    writeStored('rewrite_settings', state.settings); writeStored('rewrite_presets', state.presets); writeStored('rewrite_worlds', state.worlds); writeStored('rewrite_favorites', state.favorites);
    writeStored('rewrite_active_preset', state.activePreset); writeStored('rewrite_active_world', state.activeWorld);
  }
  function newSession(title = '新对话') {
    const now = Date.now();
    const session = { id: uid('session', sequence), title: text(title, '新对话'), messages: [], createdAt: now, updatedAt: now };
    state.sessions.unshift(session); state.currentId = session.id; storageWrite(); return clone(session);
  }
  function restoreSessions(value) {
    if (!Array.isArray(value)) return false;
    state.sessions = value.filter(isObject).map((session) => ({
      id: text(session.id, uid('session', sequence)), title: text(session.title, '新对话'),
      messages: list(session.messages).filter(isObject).map((message) => ({
        id: text(message.id, uid('message', sequence)), role: normaliseRole(message.role) || 'user',
        text: contentText(message.text != null ? message.text : message.content), imageIds: list(message.imageIds).filter(Boolean),
        imageReference: text(message.imageReference || message.imageRef), mode: migrateLegacyMode(message.mode || message.profile), task: migrateLegacyTask(message.task || message.context || message.mode), result: clone(message.result),
        reasoning: text(message.reasoning), toolCalls: Array.isArray(message.toolCalls) ? clone(message.toolCalls) : [], candidates: candidateSnapshot(message.candidates), activity: activitySnapshot(message.activity), status: text(message.status, 'done'), createdAt: message.createdAt || Date.now()
      })), createdAt: session.createdAt || Date.now(), updatedAt: session.updatedAt || Date.now()
    }));
    state.currentId = text(state.currentId) || state.sessions[0]?.id || ''; return true;
  }
  function sessionById(id) { return state.sessions.find((session) => session.id === (id || state.currentId)); }
  function currentSession() {
    const existing = sessionById();
    if (existing) return existing;
    newSession();
    return sessionById();
  }
  function resolveImage(value) {
    if (!value) return null;
    if (images && typeof images.get === 'function') { try { return images.get(typeof value === 'string' ? value : value.id) || (isObject(value) ? value : null); } catch { /* fallback */ } }
    return isObject(value) ? value : null;
  }
  function resolveInputImages(input) {
    const source = input || {};
    let values = list(source.images || source.imgs); if (!values.length && source.imageIds) values = list(source.imageIds);
    const result = [];
    for (const value of values) {
      let item = resolveImage(value);
      if (!item && isObject(value) && imageUrl(value)) item = value;
      if (!item && typeof value === 'string' && imageUrl(value)) item = { dataUrl: value };
      if (item?.source === 'workflow') continue;
      if (item && imageUrl(item)) {
        if (!item.id && images && typeof images.add === 'function') { try { item = images.add(item) || item; } catch { /* transient */ } }
        result.push(item);
      }
    }
    return result;
  }
  function imageIds(items) { return items.map((item) => text(item && item.id)).filter(Boolean); }
  function imageReference(items, analysis) {
    if (!items.length) return '';
    if (analysis && text(analysis.referenceText)) return text(analysis.referenceText);
    const lines = [
      `【附图组 共${items.length}张】（按消息附件顺序编号）`,
      '【Vision 调用规则】“图片1”等只是显示编号；调用 vision_processOne 时，imageId 必须原样使用下方括号中的真实 ID。'
    ];
    items.forEach((item, index) => {
      let label = '';
      if (images && typeof images.reference === 'function' && item.id) { try { label = images.reference(item.id, index); } catch { /* fallback */ } }
      const imageId = text(item.id);
      lines.push(`${label || `图片${index + 1}`}：${item.filename || item.name || '用户附图'}${imageId ? `（imageId: ${imageId}）` : ''}`);
    });
    return lines.join('\n');
  }
  function tagName(value) { return typeof value === 'string' ? text(value) : text(value && (value.en || value.tag || value.name)); }
  function tagList(values) {
    const seen = new Set();
    return list(values).map((value) => { const en = tagName(value); if (!en || seen.has(en.toLowerCase())) return ''; seen.add(en.toLowerCase()); const zh = text(value && value.zh); return en + (zh ? `（${zh}）` : ''); }).filter(Boolean).join(', ');
  }
  function localTagsFor(analysis) {
    const result = [];
    for (const item of list(analysis && analysis.perImage)) result.push(...list(item.modelTags || item.model), ...list(item.builtinTags || item.builtin));
    if (!result.length && analysis && Array.isArray(analysis.tags)) result.push(...analysis.tags);
    const seen = new Set(); return result.filter((item) => { const key = tagName(item).toLowerCase(); if (!key || seen.has(key)) return false; seen.add(key); return true; });
  }
  function metadataTags(item) {
    const metadata = item && item.metadata; if (!metadata) return [];
    const raw = text(metadata.parameters || metadata.prompt || metadata.description); if (!raw) return [];
    const positive = raw.split(/\n\s*(?:Negative prompt|负面提示词)\s*[:：]/i)[0];
    return positive.split(/[,，\n]/).map((part) => text(part).replace(/^[-+*]\s*/, '')).filter((part) => part && part.length < 120).map((en) => ({ en, origin: 'builtin' }));
  }
  async function analyseImages(items, input, job) {
    const perImage = [];
    for (const item of items) {
      if (job?.signal?.aborted) throw abortError('已停止', 'CANCELLED');
      let current = item; let analysis = current.analysis || null;
      if (current.id && input.analyzeImages !== false) {
        try {
          if (visionService?.processOne) {
            const result = await visionService.processOne({ imageId: current.id, mode: 'local', model: input.model, signal: job?.signal });
            if (result?.ok) {
              const data = result.data || {};
              current = { ...current, metadata: data.metadata || current.metadata, analysis: data };
              analysis = data;
            } else if (!analysis) {
              analysis = { status: result?.code === 'LOCAL_VISION_UNAVAILABLE' ? 'unavailable' : 'error', error: text(result?.error, '识图失败'), tags: [] };
            }
          }
        } catch (error) { analysis = { status: 'error', error: text(error && error.message, '识图失败'), tags: [] }; }
      }
      const builtin = list(analysis?.builtinTags).length ? list(analysis.builtinTags) : metadataTags(current);
      const model = list(analysis?.modelTags || analysis?.tags).filter((tag) => tagName(tag));
      perImage.push({ imageId: current.id || '', metadata: clone(current.metadata), builtinTags: clone(builtin), modelTags: clone(model), status: analysis?.status || (builtin.length || model.length ? 'done' : 'idle'), error: text(analysis?.error) });
    }
    return { images: items.map(clone), perImage, referenceText: imageReference(items) };
  }
  function candidateTags(value, input) {
    if (Array.isArray(input.tagCandidates)) return input.tagCandidates;
    if (!tags || typeof tags.search !== 'function' || !text(value)) return [];
    try { return tags.search(value, { includeAdult: input.nsfwEnabled !== false, limit: Number(input.tagLimit) || 100 }); } catch { return []; }
  }
  function prompt(key) {
    if (promptSource && typeof promptSource.get === 'function') {
      try {
        const value = promptSource.get(key);
        return value == null ? text(prompts[key]) : String(value).replace(/^\uFEFF/, '').trim();
      } catch { /* use snapshot */ }
    }
    return text(prompts[key]);
  }
  function compose(mode, input = {}, extra = {}) {
    const profile = text(mode, 'draw').toLowerCase() === 'assistant' ? 'assistant' : 'draw';
    const parts = [];
    const overrides = isObject(input.promptOverrides) ? input.promptOverrides : {};
    const promptFor = key => {
      if (promptSource && typeof promptSource.enabled === 'function') {
        try { if (!promptSource.enabled(key)) return ''; } catch { /* use normal prompt path */ }
      }
      return text(overrides[key] || input[`${key}Prompt`] || input[key]) || prompt(key);
    };
    const promptMods = normalisePromptMods(input.promptMods || overrides.mods);
    const allows = key => Array.isArray(promptMods[key]) && promptMods[key].includes(profile);
    const addPrompt = (key, value) => { if (allows(key) && text(value)) parts.push(text(value)); };
    if (profile === 'draw') {
      addPrompt('main', promptFor('main'));
      addPrompt('generate', promptFor('generate'));
      const qualityEnabled = !promptSource || typeof promptSource.enabled !== 'function' || promptSource.enabled('quality') !== false;
      const quality = qualityEnabled ? text(input.qualityPrefix || input.quality || input.userQuality || prompt('quality')) : '';
      const artist = text(input.artistPrompt || input.artist || input.stylePrompt);
      if (quality && allows('quality')) parts.push(`【质量/画师前缀】\n${quality}${artist ? `, ${artist}` : ''}`);
      else if (artist && allows('quality')) parts.push(`【画师前缀】\n${artist}`);
    }
    const userText = text(input.text || input.description || '').toLowerCase();
    const worldMods = list(input.worldbookMods).map(value => PROFILE_ALIASES[String(value).toLowerCase()] || String(value)).filter(Boolean);
    const worldbook = list(input.worldbookEntries || input.worldbook || input.worldBook)
      .filter(entry => {
        if (!isObject(entry)) return true;
        if (entry.enabled === false) return false;
        if (worldMods.length && !worldMods.includes(profile)) return false;
        const entryMods = list(entry.mods).map(value => PROFILE_ALIASES[String(value).toLowerCase()] || String(value)).filter(Boolean);
        if (entryMods.length && !entryMods.includes(profile)) return false;
        if (entry.constant === true) return true;
        const keys = list(entry.keys || entry.key).flatMap(value => String(value).split(/[\s,，、;；]+/)).map(value => text(value).toLowerCase()).filter(Boolean);
        return !keys.length || keys.some(key => userText.includes(key));
      })
      .map(entry => text(entry && (entry.content || entry.text) || entry)).filter(Boolean);
    if (worldbook.length) parts.push(`【世界书】\n${worldbook.join('\n\n')}`);
    const candidates = candidateTags(input.text || input.description || '', input);
    if (candidates.length) parts.push(`【标签候选${input.strict ? '（严格优先使用）' : ''}】\n${tagList(candidates)}`);
    if (extra.localTags && extra.localTags.length) parts.push(`【本地识图 Tag】\n${tagList(extra.localTags)}`);
    if (text(extra.imageReference || input.imageReference || input.imageRef)) parts.push(text(extra.imageReference || input.imageReference || input.imageRef));
    if (input.nsfwEnabled === true) parts.push(NSFW_ALLOW); else if (input.nsfwEnabled === false) parts.push(NSFW_GUARD);
    if (input.extraSystem) parts.push(text(input.extraSystem));
    if (input.includeAppendices || input.appendices === true) {
      const appendices = parseAppendixText(prompt('appendices')); const selected = input.appendices === true ? appendices : appendices.filter(entry => list(input.appendices).some(value => String(value) === String(entry.index) || value === entry.id));
      if (selected.length) parts.push(`【附录】\n${selected.map(entry => entry.text).join('\n\n')}`);
    }
    return parts.filter(Boolean).join('\n\n');
  }
  function sessionMessages(session) { return list(session && session.messages).map((message) => messageForApi(message, resolveImage)).filter(Boolean); }
  function normaliseInput(value) {
    const input = isObject(value) ? { ...value } : { text: value }; input.text = text(input.text != null ? input.text : input.prompt); input.imageIds = list(input.imageIds).filter(Boolean); input.images = resolveInputImages(input); if (!input.imageIds.length) input.imageIds = imageIds(input.images); return input;
  }
  function currentUserMessage(input, body, imagesForMessage) {
    const content = text(body != null ? body : input.text); const reference = text(input.imageReference || input.imageRef); const full = [content, reference].filter(Boolean).join('\n\n');
    if (!full && !imagesForMessage.length) return null; return { role: 'user', content: imagesForMessage.length ? contentParts(full, imagesForMessage) : full };
  }
  function append(role, value, extra = {}, sessionId) {
    const session = sessionById(sessionId) || currentSession();
    const message = { id: uid('message', sequence), role: normaliseRole(role) || 'user', text: contentText(value), imageIds: list(extra.imageIds).filter(Boolean), imageReference: text(extra.imageReference || extra.imageRef), mode: normaliseMode(extra.mode), task: normaliseTask(extra.task || extra.context || extra.mode), result: clone(extra.result), reasoning: text(extra.reasoning), toolCalls: Array.isArray(extra.toolCalls) ? clone(extra.toolCalls) : [], candidates: candidateSnapshot(extra.candidates), activity: activitySnapshot(extra.activity), status: text(extra.status, 'done'), createdAt: Date.now() };
    session.messages.push(message); session.updatedAt = Date.now(); storageWrite(); return clone(message);
  }
  function messageLocation(value, sessionId) {
    const session = sessionById(sessionId) || currentSession();
    const index = typeof value === 'number' ? value : session.messages.findIndex((message) => message.id === text(value));
    return index >= 0 ? { session, index, message: session.messages[index] } : null;
  }
  function editMessage(value, nextText, sessionId) {
    const found = messageLocation(value, sessionId);
    if (!found) return null;
    found.message.text = contentText(nextText);
    found.message.updatedAt = Date.now();
    found.session.updatedAt = Date.now();
    storageWrite();
    return clone(found.message);
  }
  function deleteMessage(value, sessionId) {
    const found = messageLocation(value, sessionId);
    if (!found) return false;
    found.session.messages.splice(found.index, 1);
    found.session.updatedAt = Date.now();
    storageWrite();
    return true;
  }
  async function rerunFromMessage(value, inputPatch = {}, config = {}, sessionId) {
    const found = messageLocation(value, sessionId);
    if (!found) return { ok: false, status: 'empty', text: '没有找到要重新执行的消息' };
    let userIndex = found.message.role === 'user' ? found.index : -1;
    if (userIndex < 0) {
      for (let index = found.index - 1; index >= 0; index -= 1) {
        if (found.session.messages[index]?.role === 'user') { userIndex = index; break; }
      }
    }
    if (userIndex < 0) return { ok: false, status: 'empty', text: '没有找到对应的用户消息' };
    const previousMessages = found.session.messages.map(clone);
    const user = clone(found.session.messages[userIndex]);
    found.session.messages.splice(userIndex);
    found.session.updatedAt = Date.now();
    storageWrite();
    const input = {
      ...(isObject(inputPatch) ? inputPatch : {}),
      text: inputPatch?.text != null ? inputPatch.text : user.text,
      imageIds: Array.isArray(inputPatch?.imageIds) ? inputPatch.imageIds : user.imageIds,
      sessionId: found.session.id,
    };
    const mode = migrateLegacyMode(user.mode || 'assistant');
    const task = migrateLegacyTask(user.task || user.context || user.mode);
    let result;
    try {
      result = await runUnified({ ...input, mode, task }, config);
    } catch (error) {
      found.session.messages = previousMessages;
      found.session.updatedAt = Date.now();
      storageWrite();
      throw error;
    }
    if (!result || result.ok === false) {
      found.session.messages = previousMessages;
      found.session.updatedAt = Date.now();
      storageWrite();
    }
    return result;
  }
  async function withJob(mode, input, config, task) {
    if (state.busy) return { ok: false, status: 'busy', text: '正在处理中，请先停止', mode };
    const controller = typeof AbortController === 'function' ? new AbortController() : { signal: {}, abort() { this.signal.aborted = true; } }; const external = input && input.signal; const relay = () => controller.abort();
    if (external?.aborted) return { ok: false, status: 'cancelled', text: '已停止', mode }; if (external && typeof external.addEventListener === 'function') external.addEventListener('abort', relay, { once: true });
    const job = { id: uid('job', sequence), mode, controller, signal: controller.signal }; activeJob = job; state.busy = true; state.status = 'running'; state.jobId = job.id; state.lastMode = mode; state.lastError = '';
    try { return await task(job); }
    catch (error) { const cancelled = job.signal?.aborted || error?.code === 'CANCELLED'; const result = { ok: false, status: cancelled ? 'cancelled' : 'error', text: cancelled ? '已停止' : text(error && error.message, String(error)), error: error?.code || 'ERROR', mode }; state.lastError = cancelled ? '' : result.text; return result; }
    finally { if (external && typeof external.removeEventListener === 'function') external.removeEventListener('abort', relay); if (activeJob === job) activeJob = null; state.busy = false; state.status = state.lastError ? 'error' : 'idle'; state.jobId = ''; }
  }
  async function runUnified(value, config = {}) {
    const input = normaliseInput(value);
    const mode = normaliseMode(input.mode || input.profile);
    const task = normaliseTask(input.task || input.context || (mode === 'draw' ? input.mode : 'assistant'));
    return withJob(mode, input, config, async (job) => {
      if (!input.text && !input.images.length) return { ok: false, status: 'empty', text: mode === 'draw' ? '请输入画面描述或添加图片' : '请输入内容或添加图片', mode };
      const session = sessionById(input.sessionId) || currentSession();
      const historyMessages = sessionMessages(session);
      const analysis = input.images.length && input.autoLocalVision === true ? await analyseImages(input.images, input, job) : null;
      input.imageReference = input.imageReference || imageReference(input.images, analysis);
      input.comfyWorkflow = input.comfyWorkflow != null ? input.comfyWorkflow : (config.comfyWorkflow != null ? config.comfyWorkflow : state.settings.comfyWorkflow);
      input.maxIterations = Math.max(1, Math.min(10, Number(input.maxIterations || config.maxIterations || state.settings.comfyIters || 3)));
      if (task === 'comfy') {
        if (config.comfyBase || config.comfyUrl || config.url) comfy.setBase?.(config.comfyBase || config.comfyUrl || config.url);
        if (input.comfyWorkflow != null) comfy.setWorkflow?.(input.comfyWorkflow);
      }
      const local = localTagsFor(analysis);
      const systemParts = [];
      if (mode === 'draw') {
        systemParts.push(compose('generate', input, { localTags: local, imageReference: input.imageReference }));
        if (task === 'comfy') {
          const maxIterations = Math.max(1, Math.min(10, Number(config.maxIterations || input.maxIterations || state.settings.comfyIters || 3)));
          systemParts.push(`【ComfyUI 绘图任务（最多 ${maxIterations} 次渲染）】\n需要实际出图时调用 comfy_render；只传正向和负向 Tag，尺寸、步数、CFG、工作流等使用用户设置。每次返图都会成为一个候选结果，必须结合用户要求、参考图（如有）和返图质量判断是否继续。结束时如果已有候选，请在回复末尾写出唯一的“【最佳候选】candidate-N”（N 为实际生成轮次）；不要根据最后一张图片重新臆造提示词。返图后如需分析，调用 vision_processOne 并传入明确 imageId。`);
        }
      }
      systemParts.push(TOOL_GUIDANCE);
      const messages = [{ role: 'system', content: systemParts.filter(Boolean).join('\n\n') }, ...historyMessages];
      const primaryVision = input.primaryVision == null
        ? modelLooksVision(config.model || state.settings.model || '')
        : Boolean(input.primaryVision);
      const current = currentUserMessage(input, input.text || (mode === 'draw' ? '请生成绘图 Tag。' : '（附图）'), task === 'comfy' && !primaryVision ? [] : input.images);
      if (current) messages.push(current);
      append('user', input.text || '（附图）', { mode, task, imageIds: input.imageIds, imageReference: input.imageReference }, session.id);
      const live = append('assistant', '', { mode, status: 'streaming' }, session.id);
      const liveMessage = session.messages[session.messages.length - 1];
      let liveCandidates = candidateSnapshot(liveMessage.candidates);
      let liveActivity = activitySnapshot(liveMessage.activity);
      input.onStart?.({ user: session.messages[session.messages.length - 2], assistant: live });
      // Do not write the whole session file for every streamed token. The
      // session remains live in memory while the UI receives deltas and is
      // persisted once when the request finishes (or fails).
      const emit = (content, reasoning) => {
        // Draw replies are rendered from the parsed prompt below. Keeping the
        // raw protocol text in the message body makes the same thinking and
        // final prompt appear twice in the UI while the request is streaming.
        if (content && mode !== 'draw') liveMessage.text += String(content);
        if (reasoning) liveMessage.reasoning += String(reasoning);
        liveMessage.status = 'streaming';
        input.onDelta?.(content, reasoning, clone(liveMessage));
      };
      const onToolEvent = event => {
        const eventType = text(event?.type);
        if (['ai-start', 'ai-complete', 'start', 'complete', 'event', 'candidate-ready', 'candidate-evaluated', 'candidate-recommended', 'tool-required', 'tool-choice-fallback'].includes(eventType)) {
          if (eventType === 'ai-complete') {
            const current = [...liveActivity].reverse().find(item => item.type === 'thinking' && item.status === 'running' && (!event.round || item.round === Number(event.round)));
            if (current) {
              current.status = event.result?.ok === false ? 'error' : 'done';
              current.message = text(event.result?.error || event.result?.text);
            }
          } else if (eventType === 'candidate-evaluated' && event.candidateId) {
            liveCandidates = Array.isArray(event.candidates)
              ? candidateSnapshot(event.candidates)
              : evaluateCandidate(liveCandidates, event.candidateId, event.summary);
            liveMessage.candidates = candidateSnapshot(liveCandidates);
            liveMessage.result = { ...(liveMessage.result || {}), candidates: candidateSnapshot(liveCandidates) };
          } else if (eventType === 'complete') {
            const current = [...liveActivity].reverse().find(item => item.name === text(event.name) && item.status === 'running');
            if (current) {
              current.status = event.result?.ok === false ? 'error' : 'done';
              current.message = text(event.result?.error || event.result?.text);
            }
          } else if (eventType === 'event' && event.event?.type === 'progress') {
            const current = [...liveActivity].reverse().find(item => item.name === text(event.name) && item.status === 'running');
            if (current) current.message = `队列 ${Number(event.event.queue) || 0}`;
          } else if (eventType !== 'event') {
            const item = {
              id: `${eventType}-${Date.now()}-${liveActivity.length}`,
              type: eventType === 'ai-start' ? 'thinking' : eventType === 'candidate-ready' ? 'candidate' : eventType === 'candidate-evaluated' ? 'evaluation' : eventType === 'candidate-recommended' ? 'recommendation' : eventType === 'start' ? 'tool' : 'event',
              name: text(event.name),
              round: Number(event.round) || 0,
              iteration: Number(event.iteration || event.candidate?.iteration) || 0,
              status: eventType === 'start' ? 'running' : eventType === 'ai-start' ? 'running' : 'done',
              message: text(event.message || event.summary || event.error || event.result?.error),
              candidateId: text(event.candidateId || event.candidate?.id),
              createdAt: Date.now()
            };
            liveActivity = [...liveActivity, item].slice(-80);
          }
          liveMessage.activity = activitySnapshot(liveActivity);
          if (eventType === 'candidate-ready' || eventType === 'candidate-evaluated' || eventType === 'candidate-recommended' || eventType === 'complete') storageWrite();
        }
        if (event?.type === 'candidate-ready' && event.candidate) {
          liveCandidates = addCandidate(liveCandidates, event.candidate);
          liveMessage.candidates = candidateSnapshot(liveCandidates);
          liveMessage.imageIds = [...new Set(liveCandidates.map(item => text(item.imageId)).filter(Boolean))];
          liveMessage.result = { ...(liveMessage.result || {}), candidates: candidateSnapshot(liveCandidates) };
          // Candidate events are infrequent (once per render), so persist them
          // immediately even though streamed text is kept in memory.
          storageWrite();
        }
        if (event?.type === 'candidate-recommended' && event.candidateId) {
          liveCandidates = Array.isArray(event.candidates)
            ? candidateSnapshot(event.candidates)
            : markRecommended(liveCandidates, event.candidateId);
          liveMessage.candidates = candidateSnapshot(liveCandidates);
          liveMessage.result = { ...(liveMessage.result || {}), candidates: candidateSnapshot(liveCandidates) };
          storageWrite();
        }
        input.onToolEvent?.(event);
      };
      const runnerInput = { ...input, onToolEvent };
      let result;
      try {
        result = await runner.run({ messages, input: runnerInput, config, job, emit, task, profile: mode });
      } catch (error) {
        const failed = { ok: false, status: job.signal?.aborted ? 'cancelled' : 'error', text: job.signal?.aborted ? '已停止' : text(error?.message, String(error)), error: error?.code || 'ERROR', toolCallsUsed: [], aiTurns: 0, toolCalls: 0, renderCount: 0 };
        liveMessage.role = 'error';
        liveMessage.status = 'error';
        liveMessage.text = failed.text;
        liveMessage.candidates = candidateSnapshot(liveCandidates);
        liveMessage.imageIds = [...new Set(liveCandidates.map(item => text(item.imageId)).filter(Boolean))];
        liveMessage.result = { ...sessionClone(failed), candidates: candidateSnapshot(liveCandidates) };
        storageWrite();
        return { ...failed, mode, analysis, sessionId: session.id };
      }
      const renderedImageIds = [
        ...liveCandidates.map(item => item.imageId),
        ...(result.candidates || []).map(item => item.imageId),
        ...(result.toolCallsUsed || [])
        .filter(call => call.name === 'comfy.render' && call.result?.ok !== false)
        .map(call => text(call.result?.data?.artifact?.id))
      ].filter(Boolean);
      liveCandidates = candidateSnapshot(result.candidates?.length ? result.candidates : liveCandidates);
      liveMessage.candidates = candidateSnapshot(liveCandidates);
      liveMessage.activity = activitySnapshot(liveActivity);
      const selectedCandidate = finalCandidate(liveCandidates, liveMessage.result?.finalCandidateId);
      if (!result.ok) {
        liveMessage.role = 'error';
        liveMessage.status = 'error';
        liveMessage.text = result.text || result.error || 'AI 请求失败';
        liveMessage.reasoning = result.reasoning || liveMessage.reasoning;
        liveMessage.toolCalls = clone(result.toolCallsUsed || []);
        if (renderedImageIds.length) liveMessage.imageIds = [...new Set(renderedImageIds)];
        liveMessage.result = { ...sessionClone(result), candidates: candidateSnapshot(liveCandidates), ...(selectedCandidate || {}) };
        storageWrite();
        return { ...result, mode, analysis, sessionId: session.id };
      }
      const reply = mode === 'draw' ? parseReply(result.text) : null;
      const replyThinking = text(reply?.thinking);
      const displayReasoning = replyThinking || text(result.reasoning) || liveMessage.reasoning;
      // The draw panel has a dedicated final-prompt block. Store only the
      // canonical prompt for history; the UI hides this body when rendering
      // the dedicated block, so marked protocol text cannot appear twice.
      const hasCandidates = liveCandidates.length > 0;
      const canonicalDrawPrompt = selectedCandidate?.finalPrompt || (!hasCandidates ? reply?.prompt : '');
      const canonicalDrawNegative = selectedCandidate?.finalNegative || (!hasCandidates ? reply?.negative : '');
      const canonicalDrawText = mode === 'draw' && text(canonicalDrawPrompt)
        ? `${canonicalDrawPrompt}${canonicalDrawNegative ? `\n\n【负面提示词】\n${canonicalDrawNegative}` : ''}`
        : '';
      liveMessage.text = mode === 'draw' && hasCandidates
        ? canonicalDrawText
        : canonicalDrawText || result.text || liveMessage.text;
      liveMessage.reasoning = displayReasoning;
      liveMessage.toolCalls = clone(result.toolCallsUsed || []);
      if (renderedImageIds.length) liveMessage.imageIds = [...new Set(renderedImageIds)];
      liveMessage.result = {
        ...sessionClone(result),
        candidates: candidateSnapshot(liveCandidates),
        ...(hasCandidates && !selectedCandidate ? { selectionRequired: true } : {}),
        ...(selectedCandidate || {}),
        ...(reply ? { prompt: canonicalDrawPrompt, negative: canonicalDrawNegative } : {})
      };
      liveMessage.status = 'done';
      storageWrite();
      const effectiveReply = reply ? { ...reply, prompt: canonicalDrawPrompt, negative: canonicalDrawNegative } : null;
      return { ...result, mode, profile: mode, reply: effectiveReply, ...(effectiveReply ? { prompt: effectiveReply.prompt, negative: effectiveReply.negative } : {}), ...(hasCandidates && !selectedCandidate ? { selectionRequired: true } : {}), analysis, sessionId: session.id };
    });
  }
  function chooseCandidate(messageId, candidateId, source = 'user') {
    const found = messageLocation(messageId);
    if (!found) return null;
    const sourceCandidates = Array.isArray(found.message.candidates)
      ? found.message.candidates
      : found.message.result?.candidates;
    if (!Array.isArray(sourceCandidates)) return null;
    const candidates = selectCandidate(sourceCandidates, candidateId, source);
    const selected = finalCandidate(candidates, candidateId);
    if (!selected) return null;
    found.message.candidates = candidates;
    found.message.imageIds = [...new Set(candidates.map(item => text(item.imageId)).filter(Boolean))];
    found.message.result = {
      ...(found.message.result || {}),
      candidates,
      ...selected,
      // Keep the existing draw-message renderer/API compatible while binding
      // the displayed final prompt to the user's selected candidate.
      prompt: selected.finalPrompt,
      negative: selected.finalNegative
    };
    if (found.message.mode === 'draw') found.message.text = selected.finalPrompt;
    found.session.updatedAt = Date.now();
    storageWrite();
    return clone({ messageId: found.message.id, candidates, ...selected });
  }
  function visionProfile() {
    const settings = state.settings || {};
    const inherit = settings.visionInheritPrimary !== false;
    const primaryModel = text(settings.model);
    return {
      base: inherit ? settings.base : settings.visionBase,
      // Inherit means the complete primary API profile, including its model.
      // A previous independent visionModel must never shadow a newly selected
      // primary vision model; users who need a different model can turn off
      // inherit mode and use the independent profile below.
      model: inherit ? primaryModel : text(settings.visionModel),
      key: inherit ? settings.key : settings.visionKey,
      temperature: inherit ? settings.temperature : settings.visionTemperature,
      timeoutMs: inherit ? settings.timeoutMs : settings.visionTimeoutMs
    };
  }

  function visionClient() {
    return {
      complete: async (messages, config = {}) => {
        const profile = visionProfile();
        const effective = { ...profile, ...config };
        // Do not send a guaranteed text-only primary model a multimodal
        // request. Providers return an opaque HTTP 400 in this case; a
        // stable local error lets the UI ask for an independent vision model.
        if (messagesContainImage(messages) && modelClearlyTextOnly(effective.model)) {
          return { ok: false, code: 'VISION_MODEL_NOT_SUPPORTED', error: '当前识图模型不支持图片输入，请选择视觉模型或配置独立识图 API' };
        }
        return visionAi.complete(messages, effective);
      },
      stream: (messages, config = {}) => visionAi.stream(messages, { ...visionProfile(), ...config }),
      listModels: (config = {}) => visionAi.listModels({ ...visionProfile(), ...config }),
      setConfig: (config = {}) => visionAi.setConfig(config),
      getConfig: () => {
        const profile = visionProfile();
        const imageCapable = !modelClearlyTextOnly(profile.model);
        return {
          ...profile,
          configured: Boolean(profile.base && profile.model && imageCapable),
          imageCapable,
          error: !profile.base || !profile.model
            ? '请先配置识图 API 地址和模型'
            : !imageCapable
              ? '当前识图模型不支持图片输入，请选择视觉模型或配置独立识图 API'
              : ''
        };
      }
    };
  }

  const primaryConfig = options.primaryApi || options.ai || options.config || {};
  ai = createAiService({ resolveImage }, primaryConfig, options.primaryGateway);
  visionAi = createAiService({ resolveImage }, options.visionApi || {}, options.visionGateway);
  state.config = ai.getConfig();
  restoreBusinessState();
  ai.configure({ base: state.settings.base, model: state.settings.model, key: state.settings.key, temperature: state.settings.temperature, timeoutMs: state.settings.timeoutMs });
  visionAi.configure(visionProfile());
  calls = options.calls || createCalls({
    tags,
    images,
    visionService: options.visionService,
    localVision: options.localVision || options.vision,
    comfy,
    prompts: promptSource,
    primaryAI: ai,
    visionAI: visionClient(),
    getPrompt: (key, version = 'effective') => version === 'default' && promptSource?.getDefault ? promptSource.getDefault(key) : prompt(key),
    getSettings: () => state.settings,
    setSettings: value => {
      if (isObject(value)) state.settings = { ...state.settings, ...clone(value) };
      calls?.invalidateCapabilities?.();
      saveBusinessState();
      return clone(state.settings);
    }
  });
  visionService = calls?.visionService || visionService;
  runner = createAiRunner({
    ai,
    calls,
    getSettings: () => state.settings,
    toolNames: ['tags.search', 'vision.processOne', 'comfy.render']
  });
  const restored = storageRead(); if (!restoreSessions(restored)) newSession();
  const api = {
    state, ai, prompts: clone(prompts), prompt: (key) => prompt(key), compose, parseReply,
    run: runUnified,
    selectCandidate: chooseCandidate,
    chooseCandidate,
    getCapabilities: () => calls?.getCapabilities?.() || null,
    refreshCapabilities: options2 => calls?.refreshCapabilities?.(options2) || Promise.resolve(null),
    newSession,
    currentSession: () => clone(currentSession()), sessions: () => state.sessions.map(clone),
    getSettings: () => clone(state.settings), setSettings(value = {}) { if (isObject(value)) state.settings = { ...state.settings, ...clone(value) }; ai.configure?.({ base: state.settings.base, model: state.settings.model, key: state.settings.key, temperature: state.settings.temperature, timeoutMs: state.settings.timeoutMs }); visionAi.configure?.(visionProfile()); calls?.invalidateCapabilities?.(); saveBusinessState(); return clone(state.settings); }, updateSettings(value = {}) { return api.setSettings(value); },
    listPresets: () => state.presets.map(clone), getPresets: () => state.presets.map(clone), setPresets(value) { state.presets = (Array.isArray(value) ? value : []).map(normalisePreset); state.activePreset = state.presets.find(item => item.id === state.activePreset)?.id || state.presets[0]?.id || ''; saveBusinessState(); return api.listPresets(); },
    addPreset(value) { const item = normalisePreset(value, state.presets.length); state.presets.push(item); state.activePreset = item.id; saveBusinessState(); return clone(item); }, removePreset(id) { if (state.presets.length <= 1) return false; const index = state.presets.findIndex(item => item.id === text(id)); if (index < 0) return false; state.presets.splice(index, 1); state.activePreset = state.presets[0]?.id || ''; saveBusinessState(); return true; }, getActivePreset: () => clone(state.presets.find(item => item.id === state.activePreset) || state.presets[0] || null), selectPreset(id) { if (!state.presets.some(item => item.id === text(id))) return false; state.activePreset = text(id); saveBusinessState(); return true; },
    listWorlds: () => state.worlds.map(clone), getWorlds: () => state.worlds.map(clone), setWorlds(value) { state.worlds = (Array.isArray(value) ? value : []).map(normaliseWorld); state.activeWorld = state.worlds.find(item => item.id === state.activeWorld)?.id || state.worlds[0]?.id || ''; saveBusinessState(); return api.listWorlds(); },
    addWorld(value) { const item = normaliseWorld(value, state.worlds.length); state.worlds.push(item); state.activeWorld = item.id; saveBusinessState(); return clone(item); }, removeWorld(id) { if (state.worlds.length <= 1) return false; const index = state.worlds.findIndex(item => item.id === text(id)); if (index < 0) return false; state.worlds.splice(index, 1); state.activeWorld = state.worlds[0]?.id || ''; saveBusinessState(); return true; }, getActiveWorld: () => clone(state.worlds.find(item => item.id === state.activeWorld) || state.worlds[0] || null), selectWorld(id) { if (!state.worlds.some(item => item.id === text(id))) return false; state.activeWorld = text(id); saveBusinessState(); return true; },
    listFavorites: () => state.favorites.map(clone), getFavorites: () => state.favorites.map(clone), setFavorites(value) { state.favorites = Array.isArray(value) ? value.map(clone) : []; saveBusinessState(); return api.listFavorites(); }, addFavorite(value) { const item = isObject(value) ? clone(value) : { id: uid('favorite', sequence), name: text(value, '未命名收藏') }; item.id = text(item.id, uid('favorite', sequence)); state.favorites.push(item); saveBusinessState(); return clone(item); }, removeFavorite(id) { const index = state.favorites.findIndex(item => item.id === text(id)); if (index < 0) return false; state.favorites.splice(index, 1); saveBusinessState(); return true; },
    snapshot: () => ({ ...clone(state), sessions: state.sessions.map(clone), config: ai.getConfig(), visionConfig: visionClient().getConfig(), settings: clone(state.settings), presets: state.presets.map(clone), worlds: state.worlds.map(clone), favorites: state.favorites.map(clone) }),
    calls,
    visionService: calls?.visionService || null,
    visionAi: visionClient(),
    switchSession(id) { if (!sessionById(id)) return false; state.currentId = id; return true; },
    renameSession(id, title) { const session = sessionById(id); if (!session) return false; session.title = text(title, session.title); session.updatedAt = Date.now(); storageWrite(); return clone(session); },
    deleteSession(id) { const target = id || state.currentId; const index = state.sessions.findIndex((session) => session.id === target); if (index < 0) return false; state.sessions.splice(index, 1); state.currentId = state.sessions[0]?.id || ''; storageWrite(); return true; },
    clearSession(id) { const session = sessionById(id); if (!session) return false; session.messages = []; session.updatedAt = Date.now(); storageWrite(); return clone(session); },
    append: (role, value, extra, sessionId) => append(role, value, extra, sessionId),
    editMessage,
    deleteMessage,
    rerunFromMessage,
    regenerateMessage: rerunFromMessage,
    exportSessions: () => JSON.stringify(state.sessions.map(clone), null, 2),
    importSessions(value, replace = false) { let parsed = value; try { if (typeof value === 'string') parsed = JSON.parse(value); } catch { return false; } const incoming = Array.isArray(parsed) ? parsed : parsed?.sessions; if (!Array.isArray(incoming)) return false; if (replace) state.sessions = []; restoreSessions([...state.sessions, ...incoming]); if (!state.currentId) state.currentId = state.sessions[0]?.id || ''; storageWrite(); return api.sessions(); },
    cancel(jobId) { if (!activeJob || (jobId && activeJob.id !== jobId)) return false; activeJob.controller.abort(); state.status = 'cancelled'; return true; }, stop(jobId) { return api.cancel(jobId); },
    destroy() { api.cancel(); state.sessions.length = 0; }
  };
  return api;
}

module.exports = { PROMPT_FILES, createAssistant, readPrompts, parseReply, splitThink, splitNegative, contentParts, normaliseCompletion, createComfy };
