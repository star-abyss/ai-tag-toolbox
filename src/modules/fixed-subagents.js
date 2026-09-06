'use strict';

const { assertValid } = require('./schema');

const SUBAGENT_NAMES = Object.freeze(['vision', 'translation', 'generateTags']);
const SCHEMAS = Object.freeze({
  vision: { type: 'object', additionalProperties: false, required: ['imageId', 'mode'], properties: { imageId: { type: 'string', minLength: 1 }, mode: { type: 'string', enum: ['metadata', 'local', 'ai'] }, model: { type: 'string' }, instruction: { type: 'string' }, includeLocalTags: { type: 'boolean' }, hasBuiltinTags: { type: 'boolean' } } },
  translation: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 16000 }, direction: { type: 'string', enum: ['auto', 'zh-en', 'en-zh'] }, includeAdult: { type: 'boolean' }, source: { type: 'string', enum: ['ai', 'local'] } } },
  generateTags: { type: 'object', additionalProperties: false, required: ['requirements'], properties: { requirements: { type: 'string', minLength: 1, maxLength: 16000 }, description: { type: 'string', maxLength: 16000 }, imageId: { type: 'string', minLength: 1 }, positiveTags: { type: 'array', maxItems: 256, items: { type: 'string' } }, referenceTags: { type: 'array', maxItems: 256, items: { type: 'string' } }, generateNegativeTags: { type: 'boolean' } } }
});
const OUTPUT_SCHEMAS = Object.freeze({
  vision: { type: 'object' },
  translation: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1 }, direction: { type: 'string' }, source: { type: 'string' } } },
  generateTags: { type: 'object', required: ['positiveTags'], properties: { positiveTags: { type: 'array', minItems: 1, items: { type: 'string' } }, negativeTags: { type: 'array', items: { type: 'string' } } } }
});

function text(value, fallback = '') { const result = value == null ? '' : String(value).trim(); return result || fallback; }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { if (value == null || typeof value !== 'object') return value; if (Array.isArray(value)) return value.map(clone); const output = {}; for (const [key, item] of Object.entries(value)) if (typeof item !== 'function' && key !== 'signal') output[key] = clone(item); return output; }
function unwrap(value) { return value && value.ok === true && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value; }
function failure(code, message) { const error = new Error(message); error.code = code; return error; }
function promptFor(prompts, key, fallback) { try { if (typeof prompts === 'function') return text(prompts(key), fallback); if (prompts?.getEffective) return text(prompts.getEffective(key), fallback); if (prompts?.get) return text(prompts.get(key), fallback); if (prompts?.read) return text(prompts.read(key), fallback); if (prompts && prompts[key] != null) return text(prompts[key], fallback); } catch { /* use fallback */ } return fallback; }
function composeGeneratePrompt(prompts, fallback) {
  try {
    if (typeof prompts?.composeGenerate === 'function') {
      const value = text(prompts.composeGenerate());
      if (value) return value;
    }
  } catch { /* fall through */ }
  return [promptFor(prompts, 'generateTags', fallback), promptFor(prompts, 'artistQuality', '')].filter(Boolean).join('\n\n');
}
function responseText(value) { if (typeof value === 'string') return value.trim(); if (!value || typeof value !== 'object') return ''; if (value.text != null) return text(value.text); const choice = value.choices?.[0]; const content = choice?.message?.content ?? choice?.text ?? value.output_text; return Array.isArray(content) ? content.map(item => item?.text || item?.content || '').join('') : text(content); }
function parseList(value) { if (Array.isArray(value)) return value.flatMap(parseList); return String(value == null ? '' : value).split(/[,，、;；|\n]+/).map(item => item.trim().replace(/^(?:[-*]\s+|\d+[.)]\s+)/, '').replace(/^['"`]+|['"`]+$/g, '')).filter(Boolean); }
function parseTags(value, allowNegative) {
  let payload = unwrap(value);
  if (object(payload) && Array.isArray(payload.choices)) return parseTags(responseText(payload), allowNegative);
  if (object(payload) && payload.positiveTags === undefined && payload.tags === undefined && typeof payload.text === 'string') return parseTags(payload.text, allowNegative);
  if (typeof payload === 'string') { const source = payload.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gi, '').trim(); if (!source) throw failure('OUTPUT_INVALID', 'Tag 子代理返回为空'); try { payload = JSON.parse(source); } catch { throw failure('OUTPUT_INVALID', 'Tag 子代理必须返回有效 JSON'); } }
  if (!object(payload)) throw failure('OUTPUT_INVALID', 'Tag 子代理返回格式无效');
  const positiveTags = [...new Set(parseList(payload.positiveTags ?? payload.tags))].slice(0, 256); if (!positiveTags.length) throw failure('OUTPUT_INVALID', 'Tag 子代理未返回正向 Tag');
  const result = { positiveTags }; if (allowNegative && payload.negativeTags !== undefined) result.negativeTags = [...new Set(parseList(payload.negativeTags))].slice(0, 256); return result;
}

function createFixedSubagents(options = {}) {
  const vision = typeof options.vision === 'function' ? { processOne: options.vision } : options.vision || options.visionService || null;
  const translation = typeof options.translation === 'function' ? { translate: options.translation } : options.translation || null;
  const primaryAI = typeof options.primaryClient === 'function' ? { complete: options.primaryClient } : options.primaryClient || options.ai || null;
  const visionAI = typeof options.visionAI === 'function' ? { complete: options.visionAI } : options.visionAI || options.ai || null;
  const prompts = options.prompts || null;
  const getSettings = typeof options.getSettings === 'function' ? options.getSettings : () => ({});
  const resolveImage = typeof options.resolveImage === 'function' ? options.resolveImage : null;
  const noThinking = Object.freeze({ stream: false, reasoning_effort: 'none', enable_thinking: false, thinking: { type: 'disabled' } });
  const entries = {};
  entries.vision = { name: 'vision', description: '固定单图识图子代理，不带会话上下文。', getSystemPrompt: () => promptFor(prompts, 'vision', '你是单图识图子代理，只根据一张图片输出可见内容和绘图 Tag。'), systemPrompt: promptFor(prompts, 'vision', '你是单图识图子代理，只根据一张图片输出可见内容和绘图 Tag。'), inputSchema: SCHEMAS.vision, outputSchema: { type: 'object' }, timeoutMs: 120000, options: noThinking, async run(input, context = {}) { assertValid(SCHEMAS.vision, input); if (!vision?.processOne) throw failure('SUBAGENT_UNAVAILABLE', 'Vision 子代理不可用'); const result = await vision.processOne({ ...clone(input), signal: context.signal, sessionId: context.sessionId, onDelta: undefined, onEvent: undefined, stream: false }); if (result?.ok === false) throw failure(result.code || 'VISION_FAILED', result.error || '识图失败'); return unwrap(result); } };
  entries.translation = { name: 'translation', description: '固定文本翻译子代理，不带会话上下文。', getSystemPrompt: () => promptFor(prompts, 'translation', '你是固定翻译子代理，只返回翻译结果和方向。'), systemPrompt: promptFor(prompts, 'translation', '你是固定翻译子代理，只返回翻译结果和方向。'), inputSchema: SCHEMAS.translation, outputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, direction: { type: 'string' }, source: { type: 'string' } } }, timeoutMs: 60000, options: noThinking, async run(input, context = {}) { assertValid(SCHEMAS.translation, input); const system = promptFor(prompts, 'translation', '你是固定翻译子代理，只返回翻译结果和方向。'); const local = input.source === 'local' || (!input.source && Boolean(translation?.translateLocal || translation?.translateWithModel || translation?.translate)); let result; let source; if (local && translation) { const method = translation.translateLocal || translation.translateWithModel || translation.translate || translation.run; if (typeof method === 'function') { result = await method.call(translation, input.text, input.direction, { signal: context.signal, includeAdult: input.includeAdult === true, ...noThinking }); source = 'local'; } } if (result == null) { if (!primaryAI?.complete) throw failure('SUBAGENT_UNAVAILABLE', '翻译 AI 不可用'); result = await primaryAI.complete([{ role: 'system', content: system }, { role: 'user', content: input.text }], { ...noThinking, signal: context.signal, onDelta: (delta, reasoning) => context.onEvent?.({ type: 'delta', text: typeof delta === 'string' ? delta : '', reasoning: typeof reasoning === 'string' ? reasoning : '' }) }); source = 'ai'; } if (result?.ok === false) throw failure(result.code || 'TRANSLATION_FAILED', result.error || '翻译失败'); const value = unwrap(result); let translated = text(value?.text || value?.translation || responseText(value)); if (/^\s*\{/.test(translated)) { try { const parsed = JSON.parse(translated); if (parsed && typeof parsed === 'object') { translated = text(parsed.text || parsed.translation || translated); if (parsed.direction) input.direction = parsed.direction; } } catch { /* keep plain provider output */ } } if (!translated) throw failure('OUTPUT_INVALID', '翻译子代理返回为空'); return { text: translated, direction: text(value?.direction || input.direction, 'auto'), source, references: Array.isArray(value?.references) ? clone(value.references).map(item => ({ en: text(item?.en), zh: text(item?.zh || item?.zhPrimary), category: text(item?.category) })) : [] }; } };
  entries.generateTags = { name: 'generateTags', description: '固定文生图 Tag 子代理，只返回结构化正向 Tag。', getSystemPrompt: () => composeGeneratePrompt(prompts, '你是文生图 Tag 子代理。只返回 JSON。'), systemPrompt: composeGeneratePrompt(prompts, '你是文生图 Tag 子代理。只返回 JSON。'), inputSchema: SCHEMAS.generateTags, outputSchema: { type: 'object', required: ['positiveTags'], properties: { positiveTags: { type: 'array' }, negativeTags: { type: 'array' } } }, timeoutMs: 120000, options: noThinking, async run(input, context = {}) { assertValid(SCHEMAS.generateTags, input); const settings = getSettings() || {}; const allowNegative = settings.generateNegativeTags === true; const basePrompt = composeGeneratePrompt(prompts, '你是文生图 Tag 子代理。只返回 JSON。'); const outputProtocol = ['系统输出协议：完成上面的 Anima 编译规则后，最终只返回一个有效 JSON 对象。', 'JSON 必须包含 positiveTags 字符串数组。', allowNegative ? '用户设置允许负面 Tag，可选返回 negativeTags 字符串数组。' : '用户设置关闭负面 Tag，禁止输出 negativeTags 字段。', '禁止输出代码块、解释、建议、标题、思考过程或 JSON 以外的文字。'].join('\n'); const system = `${basePrompt}\n\n${outputProtocol}`; const content = [{ type: 'text', text: ['当前要求：' + input.requirements, input.description ? '图片描述：' + input.description : '', input.positiveTags?.length ? '已有正向 Tag：' + input.positiveTags.join(', ') : '', input.referenceTags?.length ? '参考 Tag：' + input.referenceTags.join(', ') : ''].filter(Boolean).join('\n') }]; if (input.imageId) { if (!resolveImage) throw failure('IMAGE_RESOLVER_UNAVAILABLE', '未配置受控图片解析器'); const image = await resolveImage(input.imageId, context); if (!image) throw failure('IMAGE_NOT_FOUND', '未找到图片：' + input.imageId); const url = text(image.dataUrl || image.url || image.src || image.previewUrl || image.viewUrl); if (!url) throw failure('IMAGE_DATA_UNAVAILABLE', '无法读取图片：' + input.imageId); content.push({ type: 'image_url', image_url: { url } }); } if (!visionAI?.complete) throw failure('SUBAGENT_UNAVAILABLE', 'Vision AI 不可用'); const result = await visionAI.complete([{ role: 'system', content: system }, { role: 'user', content }], { ...noThinking, signal: context.signal }); if (result?.ok === false) throw failure(result.code || 'GENERATE_TAGS_FAILED', result.error || 'Tag 生成失败'); return parseTags(result, allowNegative); } };
  return Object.freeze({ ...entries, names: () => SUBAGENT_NAMES.slice(), resolve: name => entries[name] || null, list: () => SUBAGENT_NAMES.map(name => entries[name]) });
}

module.exports = { SUBAGENT_NAMES, SCHEMAS, OUTPUT_SCHEMAS, createFixedSubagents };

