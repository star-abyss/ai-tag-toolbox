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
const { createImageRepository } = require('./image-repository');
const { createVisionTempStore } = require('./vision-temp-store');

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

const TOOL_GUIDANCE = `【Compact JSON 调用规则】
需要查询 Tag、读取当前会话图片、识图、出图或设置会话图片标题时，只返回独立一行 JSON（或 json 代码块），根对象使用稳定的 call 字段：search、images、vision、render、title。只填写对应调用表声明的少量字段；不要返回原生 tool_calls/function_call，不要提交工作流、节点参数、本地路径、Data URL 或完整工具结果。
search 只传 query 和可选 precision；vision 的 image 必须是当前会话编号、候选编号、唯一标题或当前临时图，一次只读一张；render 只传 prompt、negative、iterations、seed；title 只修改当前会话关联。调用结果会以短摘要回注，图片和工具数据由程序按需读取。`;
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

function messageForApi(message, imageResolver) {
  if (!isObject(message)) return null;
  const role = normaliseRole(message.role);
  if (!['system', 'user', 'assistant', 'tool'].includes(role)) return null;
  if (role === 'tool') {
    const toolBody = message.content != null ? message.content : message.text;
    const toolCallId = text(message.tool_call_id || message.toolCallId);
    // OpenAI-compatible APIs reject an isolated role:tool message. Drop it at
    // the adapter boundary instead of forwarding an empty tool_call_id.
    if (!toolCallId) return null;
    return {
      role,
      tool_call_id: toolCallId,
      ...(text(message.name) ? { name: text(message.name) } : {}),
      content: Array.isArray(toolBody) ? sessionClone(toolBody, 'result') : redactHistoryString(contentText(toolBody))
    };
  }
  let body = message.content != null ? message.content : message.text;
  // Most OpenAI-compatible APIs only accept image parts on user messages.
  // Generated images are kept on assistant history entries for UI/candidate
  // rendering, but must not be sent back as assistant message content.
  const allowImages = role === 'user';
  const ref = text(message.imageReference || message.imageRef || message.imgRef);
  if (Array.isArray(body)) {
    body = body.map((part) => {
      if (!isObject(part)) return { type: 'text', text: contentText(part) };
      if (part.type === 'image_url' && part.image_url) {
        const url = safeRemoteImageUrl(imageUrl(part.image_url) || imageUrl(part));
        return url ? { type: 'image_url', image_url: { url } } : { type: 'text', text: '' };
      }
      if (part.type === 'text') return { type: 'text', text: contentText(part.text) };
      return { type: 'text', text: contentText(part) };
    }).filter((part) => (allowImages || (part.type !== 'image_url' && part.type !== 'image')) && (part.type !== 'text' || part.text));
    if (ref) body.unshift({ type: 'text', text: ref });
  } else if (ref) body = `${contentText(body)}\n\n${ref}`.trim();
  let images = allowImages ? normaliseImages(message.images || message.imgs) : [];
  if (allowImages && !images.length && imageResolver && message.imageIds) images = normaliseImages(list(message.imageIds).map(imageResolver));
  if (Array.isArray(body)) {
    if (allowImages && images.length && !body.some((part) => part.type === 'image_url')) body = [...body, ...normaliseImages(images).map((item) => ({ type: 'image_url', image_url: { url: imageUrl(item) } }))];
    return { role, content: body.length ? body : [{ type: 'text', text: '' }] };
  }
  const output = { role, content: images.length ? contentParts(body, images) : contentText(body) };
  // `toolCalls` (camelCase) is the persisted UI trace and contains results,
  // artifacts and candidates; it is not an OpenAI protocol `tool_calls`
  // array. Only an explicitly supplied snake_case array belongs in the API
  // payload, and normalize it to the required id/function shape.
  const calls = message.tool_calls;
  if (role === 'assistant' && Array.isArray(calls) && calls.length) {
    const protocolCalls = strictToolCalls(calls);
    if (protocolCalls.length) output.tool_calls = protocolCalls;
  }
  return output;
}

const PRIVATE_HISTORY_KEYS = new Set([
  'bytes', 'dataUrl', 'path', 'filePath', 'workflow', 'viewUrl', 'url',
  'src', 'previewUrl', 'objectUrl', 'thumbnailUrl', 'blob', 'blobId',
  'data_url', 'file_path', 'view_url', 'preview_url', 'object_url', 'image_url', 'imageUrl'
]);

function redactHistoryString(value) {
  return String(value || '')
    .replace(/data:[^\s,)]+/gi, '[image]')
    .replace(/(?:file|blob):[^\s,)]+/gi, '[url]')
    .replace(/https?:\/\/[^\s,)]+/gi, '[url]')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s,)]+/g, '[path]');
}

function sessionClone(value, context = '') {
  if (value == null || typeof value !== 'object') {
    return context === 'result' || context === 'toolCalls' || context === 'artifact' || context === 'raw'
      ? (typeof value === 'string' ? redactHistoryString(value) : value)
      : value;
  }
  if (Array.isArray(value)) return value.map(item => sessionClone(item, context)).filter(item => item !== undefined);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    const lowerKey = String(key).toLowerCase();
    if (PRIVATE_HISTORY_KEYS.has(key) || /^(?:bytes|dataurl|data_url|path|filepath|file_path|workflow|viewurl|view_url|url|src|previewurl|preview_url|objecturl|object_url|thumbnailurl|image_url|imageurl|blob|blobid)$/.test(lowerKey)) continue;
    if (['result', 'toolcalls', 'artifact', 'raw', 'resolved'].includes(String(context).toLowerCase())
      && /^(?:imageid|refid|artifactid|promptid|finalimageid|imageids|refids)$/.test(lowerKey)) continue;
    const nextContext = /^(?:result|toolCalls|artifact|raw|resolved)$/i.test(key) || context === 'toolCalls' ? key : context;
    if (typeof item === 'string' && (context === 'toolCalls' || context === 'result' || context === 'artifact' || context === 'raw' || key === 'arguments')) {
      // Native tool arguments are often JSON strings; sanitize both the JSON
      // fields and any plain provider text before it reaches session storage.
      let parsed = null;
      try { parsed = JSON.parse(item); } catch { /* plain text */ }
      output[key] = parsed && typeof parsed === 'object'
        ? sessionClone(parsed, 'result')
        : redactHistoryString(item);
      continue;
    }
    output[key] = sessionClone(item, nextContext);
  }
  return output;
}

function sanitiseApiMessages(messages) {
  const rows = list(messages).filter(Boolean);
  const assistantCallIds = new Set();
  const toolCallIds = new Set();
  for (const message of rows) {
    if (message.role === 'assistant') for (const call of message.tool_calls || []) if (call?.id) assistantCallIds.add(String(call.id));
    if (message.role === 'tool' && message.tool_call_id) toolCallIds.add(String(message.tool_call_id));
  }
  return rows.map(message => {
    if (message.role === 'tool') return assistantCallIds.has(String(message.tool_call_id)) ? message : null;
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) return message;
    const paired = message.tool_calls.filter(call => call?.id && toolCallIds.has(String(call.id)));
    if (paired.length) return { ...message, tool_calls: paired };
    const output = { ...message };
    delete output.tool_calls;
    return output;
  }).filter(Boolean);
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
    return { ...config, ...source, base: source.base || source.apiBase || config.base, model: source.model || config.model };
  }

  async function complete(messages, options = {}) {
    if (typeof messages === 'string') messages = [{ role: 'user', content: messages }];
    else if (isObject(messages) && !Array.isArray(messages)) messages = [{ role: 'user', content: text(messages.text || messages.prompt) }];
    const opts = mergedOptions(options);
    const apiMessages = sanitiseApiMessages(list(messages).map((item) => messageForApi(item, owner && owner.resolveImage)).filter(Boolean));
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
    // Some OpenAI-compatible providers expose a standard switch for their
    // reasoning budget. Keep it opt-in so ordinary chat requests remain
    // unchanged; translation passes `none` to request direct output.
    if (opts.reasoning_effort != null) body.reasoning_effort = opts.reasoning_effort;
    if (opts.enable_thinking != null) body.enable_thinking = opts.enable_thinking;
    if (opts.thinking != null) body.thinking = clone(opts.thinking);
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
  // The repository is created after the AI/call adapters. Keep a late-bound
  // reference so the Vision temp store can still enforce conversation scope
  // without exposing a global Images fallback during startup.
  let imageRepository = null;
  const compactCallCache = new Map();
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
      comfyOn: false, comfyBase: 'http://127.0.0.1:8188', comfyWorkflow: '', comfyIters: 3, batchCount: 1, maxComfyCalls: 3, generateNegativeTags: false,
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
  function newSession(title = '新对话', options2 = {}) {
    if (activeJob && options2.cancelActive !== false) {
      try { activeJob.controller?.abort?.(); } catch { /* best effort */ }
    }
    const now = Date.now();
    const used = new Set(state.sessions.map(item => text(item.id)).filter(Boolean));
    let id = uid('session', sequence);
    let suffix = 1;
    while (used.has(id)) id = `${id}-new-${suffix++}`;
    const session = { id, title: text(title, '新对话'), messages: [], createdAt: now, updatedAt: now };
    state.sessions.unshift(session); state.currentId = session.id; storageWrite(); return clone(session);
  }
  function normaliseSessionList(value, usedSessionIds = new Set(), usedMessageIds = new Set()) {
    const sessions = [];
    const mapping = [];
    if (!Array.isArray(value)) return { sessions, mapping };
    for (const raw of value.filter(isObject)) {
      const originalId = text(raw.id);
      const baseId = originalId || uid('session', sequence);
      let id = baseId;
      let suffix = 1;
      while (usedSessionIds.has(id)) id = `${baseId}-import-${suffix++}`;
      usedSessionIds.add(id);
      if (originalId) mapping.push({ from: originalId, to: id });
      const messages = list(raw.messages).filter(isObject).map(message => {
        const originalMessageId = text(message.id);
        const baseMessageId = originalMessageId || uid('message', sequence);
        let messageId = baseMessageId;
        let messageSuffix = 1;
        while (usedMessageIds.has(messageId)) messageId = `${baseMessageId}-import-${messageSuffix++}`;
        usedMessageIds.add(messageId);
        return {
          id: messageId, role: normaliseRole(message.role) || 'user',
          text: contentText(message.text != null ? message.text : message.content), imageIds: list(message.imageIds).filter(Boolean),
          imageReference: text(message.imageReference || message.imageRef), mode: migrateLegacyMode(message.mode || message.profile), task: migrateLegacyTask(message.task || message.context || message.mode), result: sessionClone(message.result, 'result'),
          reasoning: text(message.reasoning), toolCalls: Array.isArray(message.toolCalls) ? sessionClone(message.toolCalls, 'toolCalls') : [], candidates: candidateSnapshot(message.candidates), activity: activitySnapshot(message.activity), status: text(message.status, 'done'), createdAt: message.createdAt || Date.now()
        };
      });
      sessions.push({ id, title: text(raw.title, '新对话'), messages, createdAt: raw.createdAt || Date.now(), updatedAt: raw.updatedAt || Date.now() });
    }
    return { sessions, mapping };
  }
  function restoreSessions(value, options2 = {}) {
    if (!Array.isArray(value)) return false;
    const normalised = normaliseSessionList(value, options2.usedSessionIds || new Set(), options2.usedMessageIds || new Set());
    state.sessions = normalised.sessions;
    state.currentId = text(state.currentId) || state.sessions[0]?.id || ''; return true;
  }
  function sessionById(id) { return state.sessions.find((session) => session.id === (id || state.currentId)); }
  function currentSession() {
    const existing = sessionById();
    if (existing) { imageRepository?.finalizeMigration?.(); return existing; }
    newSession('新对话', { cancelActive: false });
    imageRepository?.finalizeMigration?.();
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
  function safeImageReference(value) {
    return text(value)
      .replace(/data:[^\s,)]+/gi, '[image]')
      .replace(/(?:file|blob):[^\s,)]+/gi, '[url]')
      .replace(/https?:\/\/[^\s,)]+/gi, '[url]')
      .replace(/(?:imageId|refId)\s*[:=]\s*[^\s,;)]+/gi, '')
      .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s,)]+/g, '[path]')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }
  function imageReference(items, analysis) {
    if (!items.length) return '';
    if (analysis && text(analysis.referenceText)) return safeImageReference(analysis.referenceText);
    const lines = [
      `【附图组 共${items.length}张】（按消息附件顺序编号）`,
      '【Vision 调用规则】请使用“图N”、候选编号或明确标题引用图片；内部图片标识由程序在会话范围内解析。'
    ];
    items.forEach((item, index) => {
      const title = safeImageReference(text(item.displayTitle || item.displayName || item.filename || item.name, '用户附图')).slice(0, 120);
      lines.push(`图${index + 1}：${title}`);
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
  function sessionMessages(session) { return sanitiseApiMessages(list(session && session.messages).map((message) => messageForApi(message, resolveImage)).filter(Boolean)); }
  function normaliseInput(value) {
    const input = isObject(value) ? { ...value } : { text: value };
    input.text = text(input.text != null ? input.text : input.prompt);
    input.imageIds = list(input.imageIds).filter(Boolean);
    input.pendingRefIds = list(input.pendingRefIds || input.pendingRefs).filter(Boolean);
    input.explicitImageRefs = list(input.explicitImageRefs || input.imageRefs).filter(Boolean);
    input.images = resolveInputImages(input);
    if (!input.imageIds.length) input.imageIds = imageIds(input.images);
    return input;
  }
  function currentUserMessage(input, body, imagesForMessage) {
    const content = text(body != null ? body : input.text); const reference = safeImageReference(input.imageReference || input.imageRef); const full = [content, reference].filter(Boolean).join('\n\n');
    if (!full && !imagesForMessage.length) return null; return { role: 'user', content: imagesForMessage.length ? contentParts(full, imagesForMessage) : full };
  }
  function append(role, value, extra = {}, sessionId) {
    const session = sessionById(sessionId) || currentSession();
    const message = { id: uid('message', sequence), role: normaliseRole(role) || 'user', text: contentText(value), imageIds: list(extra.imageIds).filter(Boolean), imageReference: text(extra.imageReference || extra.imageRef), mode: normaliseMode(extra.mode), task: normaliseTask(extra.task || extra.context || extra.mode), result: clone(extra.result), reasoning: text(extra.reasoning), toolCalls: Array.isArray(extra.toolCalls) ? clone(extra.toolCalls) : [], candidates: candidateSnapshot(extra.candidates), activity: activitySnapshot(extra.activity), status: text(extra.status, 'done'), createdAt: Date.now() };
    session.messages.push(message); session.updatedAt = Date.now(); storageWrite(); return sessionClone(message);
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
      const session = sessionById(input.sessionId) || currentSession();
      const repository = imageRepository;
      const pendingRefs = input.pendingRefIds.length
        ? input.pendingRefIds
        : (repository?.pendingConversationReferences?.(session.id) || []).map(item => item.refId);
      input.pendingRefIds = [...new Set(pendingRefs.map(String).filter(Boolean))];
      input.imageRepository = repository;
      input.visionTempStore = visionTempStore;
      input.requestId = job.id;
      input.sessionId = session.id;
      // The only compact write exposed to the main Assistant is a
      // conversation-scoped temporary title. Keep it enabled by default while
      // still honoring an explicit false from callers; gallery/global writes
      // remain unavailable through this adapter.
      input.allowToolWrite = input.allowToolWrite !== false;
      input.isCurrent = () => state.currentId === session.id && activeJob === job && !job.signal?.aborted;
      input.resolveImage = input.resolveImage || (id => {
        const resolved = resolveImage(id);
        if (resolved && imageUrl(resolved)) return resolved;
        try { return images?.preview?.(id) || resolved; } catch { return resolved; }
      });
      // The UI normally sends pending image IDs, but programmatic callers and
      // restored sessions may provide only repository refs. Materialise just
      // those refs for the current request; historical conversation images
      // remain lightweight IDs and are not implicitly re-attached.
      let conversationRows = [];
      try {
        const listed = repository?.listConversation?.(session.id, { includePending: true });
        conversationRows = Array.isArray(listed) ? listed : (listed?.items || []);
      } catch { /* optional repository */ }
      // Programmatic callers may pass an explicit imageId before creating a
      // ConversationImageRef. If it resolves through the controlled Images
      // store, establish that relationship here; arbitrary paths/URLs never
      // reach this branch. Gallery-owned assets remain shared references.
      if (repository?.attachToConversation && input.imageIds.length) {
        let galleryIds = new Set();
        try {
          const listedGallery = repository.listGallery?.({ order: 'oldest' });
          const galleryRows = Array.isArray(listedGallery) ? listedGallery : (listedGallery?.items || []);
          galleryIds = new Set(galleryRows.map(item => String(item.imageId || item.id)).filter(Boolean));
        } catch { /* optional gallery adapter */ }
        for (const value of input.imageIds) {
          const id = text(value);
          if (!id || conversationRows.some(row => String(row.imageId) === id || String(row.refId) === id)) continue;
          const resolved = input.resolveImage(id);
          if (!resolved || resolved.source === 'workflow') continue;
          try {
            const attached = repository.attachToConversation(session.id, id, { source: galleryIds.has(id) ? 'gallery' : 'upload', pending: true });
            if (attached) conversationRows.push(attached);
          } catch { /* malformed/unknown IDs remain rejected by the Runner */ }
        }
      }
      const requestedRefs = new Set(input.pendingRefIds);
      if (input.imageIds.length) for (const id of input.imageIds) {
        const row = conversationRows.find(item => String(item.imageId) === String(id) || String(item.refId) === String(id));
        if (row?.refId) requestedRefs.add(String(row.refId));
      }
      if (!input.imageIds.length) input.imageIds = conversationRows.filter(item => requestedRefs.has(String(item.refId))).map(item => item.imageId).filter(Boolean);
      const materialised = input.imageIds.map(id => input.resolveImage(id)).filter(item => item && item.source !== 'workflow');
      if (materialised.length) {
        input.images = materialised;
        input.imageIds = materialised.map(item => item.id || item.imageId).filter(Boolean);
      } else if (input.imageIds.length) {
        input.imageIds = [];
      }
      if (!input.text && !input.images.length) return { ok: false, status: 'empty', text: mode === 'draw' ? '请输入画面描述或添加图片' : '请输入内容或添加图片', mode };
      const historyMessages = sessionMessages(session);
      const analysis = input.images.length && input.autoLocalVision === true ? await analyseImages(input.images, input, job) : null;
      input.imageReference = input.imageReference || imageReference(input.images, analysis);
      input.comfyWorkflow = input.comfyWorkflow != null ? input.comfyWorkflow : (config.comfyWorkflow != null ? config.comfyWorkflow : state.settings.comfyWorkflow);
      input.maxIterations = Math.max(1, Math.min(10, Number(input.maxIterations || config.maxIterations || state.settings.comfyIters || 3)));
      // Bind Vision cache entries to the effective prompt text. This catches
      // prompt-source edits even when callers do not provide an explicit
      // numeric prompt version.
      input.promptVersion = text(input.promptVersion || input.promptOverrides?.vision || prompt('vision'));
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
          systemParts.push(`【ComfyUI 绘图任务（最多 ${maxIterations} 次渲染）】\n需要实际出图时返回独立 JSON：{"call":"render","prompt":"正向 Tag","negative":"可选负向 Tag"}；尺寸、步数、CFG、工作流等使用用户设置。每次返图都会成为一个候选结果，必须结合用户要求、参考图（如有）和返图质量判断是否继续。结束时如果已有候选，请在回复末尾写出唯一的“【最佳候选】candidate-N”（N 为实际生成轮次）；不要根据最后一张图片重新臆造提示词。返图后如需分析，返回 {"call":"vision","image":"candidate-N"}。`);
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
      input.messageId = liveMessage.id;
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
        if (input.isCurrent && !input.isCurrent()) return;
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
          const generatedImageId = text(event.candidate.imageId);
          if (generatedImageId && event.repositoryAttached !== true) imageRepository?.attachToConversation?.(session.id, generatedImageId, {
            source: 'comfy',
            messageId: liveMessage.id,
            candidateId: text(event.candidate.id)
          });
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
      if (result?.ok !== false && input.pendingRefIds.length && (!input.isCurrent || input.isCurrent())) {
        try { imageRepository?.markSent?.(session.id, input.pendingRefIds); } catch { /* persistence is best effort */ }
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
  const visionTempStore = options.visionTempStore || createVisionTempStore({
    images,
    authorizeReference: reference => imageRepository?.authorizeVisionReference?.(reference) || null
  });
  calls = options.calls || createCalls({
    tags,
    images,
    visionTempStore,
    visionService: options.visionService,
    localVision: options.localVision || options.vision,
    comfy,
    prompts: promptSource,
    primaryAI: ai,
    visionAI: visionClient(),
    getImageRepository: () => imageRepository,
    generateTags: async input => {
      const systemPrompt = prompt('generateTags') || '只返回 JSON：{"positiveTags":[]}。不要解释、建议或思维过程。';
      const content = [input.requirements || input.description || '', Array.isArray(input.positiveTags) ? `已有Tag：${input.positiveTags.join(', ')}` : '', Array.isArray(input.referenceTags) ? `参考Tag：${input.referenceTags.join(', ')}` : ''].filter(Boolean).join('\n');
      const image = input.imageId ? images?.get?.(String(input.imageId)) : null;
      const userContent = image?.dataUrl
        ? [{ type: 'text', text: content }, { type: 'image_url', image_url: { url: image.dataUrl } }]
        : content;
      const result = await visionClient().complete([{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }], { stream: false });
      if (!result?.ok) return { ok: false, error: result?.error || 'Tag 子代理请求失败' };
      try { const parsed = JSON.parse(String(result.text || '').match(/\{[\s\S]*\}/)?.[0] || '{}'); return { ok: true, positiveTags: Array.isArray(parsed.positiveTags) ? parsed.positiveTags : [], ...(input.allowNegativeTags && Array.isArray(parsed.negativeTags) ? { negativeTags: parsed.negativeTags } : {}) }; } catch { return { ok: false, error: 'Tag 子代理返回格式无效' }; }
    },
    getPrompt: (key, version = 'effective') => version === 'default' && promptSource?.getDefault ? promptSource.getDefault(key) : prompt(key),
    getSettings: () => state.settings,
    getCurrentSessionId: () => state.currentId,
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
    toolNames: ['tags.search', 'vision.processOne', 'comfy.render'],
    // The main Assistant speaks compact JSON. Legacy/native tool calls remain
    // accepted by the runner's adapter and are only selected explicitly by
    // compatibility callers.
    compact: options.compact !== false,
    callCache: compactCallCache,
    visionCache: compactCallCache,
    isCurrent: ({ sessionId, job }) => state.currentId === sessionId && (!activeJob || activeJob === job)
  });
  const restored = storageRead(); const restoredSessions = restoreSessions(restored); if (!restoredSessions) newSession();
  const legacySessionImportPending = readStored('rewrite_migrated_v142', false) === true && readStored('rewrite_sessions_migrated', false) !== true;
  imageRepository = createImageRepository({
    images,
    storage: options.storage,
    sessions: () => state.sessions,
    saveSessions: storageWrite,
    currentSessionId: () => state.currentId,
    deferCollectionMigration: !restoredSessions || legacySessionImportPending,
    onReferenceRemoved: reference => visionTempStore?.invalidateReference?.(reference)
  });
  visionTempStore?.setAuthorizer?.(reference => imageRepository?.authorizeVisionReference?.(reference) || null);
  const api = {
    state, ai, prompts: clone(prompts), prompt: (key) => prompt(key), compose, parseReply,
    run: runUnified,
    selectCandidate: chooseCandidate,
    chooseCandidate,
    getCapabilities: () => calls?.getCapabilities?.() || null,
    refreshCapabilities: options2 => calls?.refreshCapabilities?.(options2) || Promise.resolve(null),
    newSession,
    currentSession: () => sessionClone(currentSession()), sessions: () => state.sessions.map(sessionClone),
    getSettings: () => clone(state.settings), setSettings(value = {}) { if (isObject(value)) state.settings = { ...state.settings, ...clone(value) }; ai.configure?.({ base: state.settings.base, model: state.settings.model, key: state.settings.key, temperature: state.settings.temperature, timeoutMs: state.settings.timeoutMs }); visionAi.configure?.(visionProfile()); calls?.invalidateCapabilities?.(); saveBusinessState(); return clone(state.settings); }, updateSettings(value = {}) { return api.setSettings(value); },
    listPresets: () => state.presets.map(clone), getPresets: () => state.presets.map(clone), setPresets(value) { state.presets = (Array.isArray(value) ? value : []).map(normalisePreset); state.activePreset = state.presets.find(item => item.id === state.activePreset)?.id || state.presets[0]?.id || ''; saveBusinessState(); return api.listPresets(); },
    addPreset(value) { const item = normalisePreset(value, state.presets.length); state.presets.push(item); state.activePreset = item.id; saveBusinessState(); return clone(item); }, removePreset(id) { if (state.presets.length <= 1) return false; const index = state.presets.findIndex(item => item.id === text(id)); if (index < 0) return false; state.presets.splice(index, 1); state.activePreset = state.presets[0]?.id || ''; saveBusinessState(); return true; }, getActivePreset: () => clone(state.presets.find(item => item.id === state.activePreset) || state.presets[0] || null), selectPreset(id) { if (!state.presets.some(item => item.id === text(id))) return false; state.activePreset = text(id); saveBusinessState(); return true; },
    listWorlds: () => state.worlds.map(clone), getWorlds: () => state.worlds.map(clone), setWorlds(value) { state.worlds = (Array.isArray(value) ? value : []).map(normaliseWorld); state.activeWorld = state.worlds.find(item => item.id === state.activeWorld)?.id || state.worlds[0]?.id || ''; saveBusinessState(); return api.listWorlds(); },
    addWorld(value) { const item = normaliseWorld(value, state.worlds.length); state.worlds.push(item); state.activeWorld = item.id; saveBusinessState(); return clone(item); }, removeWorld(id) { if (state.worlds.length <= 1) return false; const index = state.worlds.findIndex(item => item.id === text(id)); if (index < 0) return false; state.worlds.splice(index, 1); state.activeWorld = state.worlds[0]?.id || ''; saveBusinessState(); return true; }, getActiveWorld: () => clone(state.worlds.find(item => item.id === state.activeWorld) || state.worlds[0] || null), selectWorld(id) { if (!state.worlds.some(item => item.id === text(id))) return false; state.activeWorld = text(id); saveBusinessState(); return true; },
    listFavorites: () => state.favorites.map(clone), getFavorites: () => state.favorites.map(clone), setFavorites(value) { state.favorites = Array.isArray(value) ? value.map(clone) : []; saveBusinessState(); return api.listFavorites(); }, addFavorite(value) { const item = isObject(value) ? clone(value) : { id: uid('favorite', sequence), name: text(value, '未命名收藏') }; item.id = text(item.id, uid('favorite', sequence)); state.favorites.push(item); saveBusinessState(); return clone(item); }, removeFavorite(id) { const index = state.favorites.findIndex(item => item.id === text(id)); if (index < 0) return false; state.favorites.splice(index, 1); saveBusinessState(); return true; },
    snapshot: () => ({ ...clone(state), sessions: state.sessions.map(sessionClone), config: ai.getConfig(), visionConfig: visionClient().getConfig(), settings: clone(state.settings), presets: state.presets.map(clone), worlds: state.worlds.map(clone), favorites: state.favorites.map(clone) }),
    calls,
    visionService: calls?.visionService || null,
    visionAi: visionClient(),
     switchSession(id) {
       if (!sessionById(id)) return false;
       if (activeJob) {
         try { activeJob.controller?.abort?.(); } catch { /* best effort */ }
         state.status = 'cancelled';
       }
       state.currentId = id;
       return true;
     },
    renameSession(id, title) { const session = sessionById(id); if (!session) return false; session.title = text(title, session.title); session.updatedAt = Date.now(); storageWrite(); return clone(session); },
    imageRepository,
    visionTempStore,
    deleteSession(id, options = {}) { const target = id || state.currentId; if (!sessionById(target)) return false; const result = imageRepository.deleteSession(target, { retainImages: options.retainImages === true }); state.currentId = state.sessions[0]?.id || ''; storageWrite(); return result; },
    clearSession(id) { const target = id || state.currentId; if (!sessionById(target)) return false; imageRepository.clearSessionContent(target); return clone(sessionById(target)); },
    append: (role, value, extra, sessionId) => append(role, value, extra, sessionId),
    editMessage,
    deleteMessage,
    rerunFromMessage,
    regenerateMessage: rerunFromMessage,
    exportSessions: () => JSON.stringify(state.sessions.map(sessionClone), null, 2),
    importSessions(value, replace = false) {
      let parsed = value;
      try { if (typeof value === 'string') parsed = JSON.parse(value); } catch { return false; }
      const incoming = Array.isArray(parsed) ? parsed : parsed?.sessions;
      if (!Array.isArray(incoming)) return false;
      if (replace) { state.sessions = []; state.currentId = ''; }
      const usedSessionIds = new Set(state.sessions.map(item => text(item.id)).filter(Boolean));
      const usedMessageIds = new Set(state.sessions.flatMap(item => list(item.messages).map(message => text(message?.id)).filter(Boolean)));
      const normalised = normaliseSessionList(incoming, usedSessionIds, usedMessageIds);
      state.sessions.push(...normalised.sessions);
      if (!state.currentId) state.currentId = state.sessions[0]?.id || '';
      imageRepository.finalizeMigration();
      storageWrite();
      return api.sessions();
    },
    cancel(jobId) { if (!activeJob || (jobId && activeJob.id !== jobId)) return false; activeJob.controller.abort(); state.status = 'cancelled'; return true; }, stop(jobId) { return api.cancel(jobId); },
    destroy() { api.cancel(); state.sessions.length = 0; }
  };
  return api;
}

module.exports = { PROMPT_FILES, createAssistant, readPrompts, parseReply, splitThink, splitNegative, contentParts, normaliseCompletion, createComfy };
