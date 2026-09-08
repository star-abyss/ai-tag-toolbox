'use strict';

const { assertValid } = require('./schema');
const { SOURCE_REFERENCE_GUIDANCE, CHARACTER_REFERENCE_GUIDANCE } = require('./generation-guidance');
const { segmentSourceText, parseTranslationPayload } = require('./translation-alignment');
const {
  EVALUATION_INPUT_SCHEMA,
  EVALUATION_OUTPUT_SCHEMA,
  createCandidateEvaluator
} = require('./candidate-evaluator');

const SUBAGENT_NAMES = Object.freeze(['vision', 'translation', 'generateTags', 'evaluateImages']);
const characterReferenceSchema = { type: 'object', additionalProperties: false, required: ['id', 'identityTags', 'generalTags', 'specificTags'], properties: { id: { type: 'string', minLength: 1 }, name: { type: 'string' }, series: { type: 'string' }, ...Object.fromEntries(['identityTags', 'generalTags', 'specificTags'].map(key => [key, { type: 'array', maxItems: 256, items: { type: 'string' } }])) } };
const SCHEMAS = Object.freeze({
  vision: { type: 'object', additionalProperties: false, required: ['imageId', 'mode'], properties: { imageId: { type: 'string', minLength: 1 }, mode: { type: 'string', enum: ['metadata', 'local', 'ai'] }, model: { type: 'string' }, instruction: { type: 'string' }, includeLocalTags: { type: 'boolean' }, hasBuiltinTags: { type: 'boolean' } } },
  translation: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 16000 }, direction: { type: 'string', enum: ['auto', 'zh-en', 'en-zh'] }, includeAdult: { type: 'boolean' }, source: { type: 'string', enum: ['ai', 'local'] }, includeAlignment: { type: 'boolean' } } },
  generateTags: { type: 'object', additionalProperties: false, required: ['requirements'], properties: { operation: { type: 'string', enum: ['compile', 'revise'] }, requirements: { type: 'string', minLength: 1, maxLength: 16000 }, description: { type: 'string', maxLength: 16000 }, imageId: { type: 'string', minLength: 1 }, positiveTags: { type: 'array', maxItems: 256, items: { type: 'string' } }, negativeTags: { type: 'array', maxItems: 256, items: { type: 'string' } }, referenceTags: { type: 'array', maxItems: 256, items: { type: 'string' } }, characterIds: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1 } }, characterReferences: { type: 'array', maxItems: 8, items: characterReferenceSchema }, evaluation: { type: 'object' }, generateNegativeTags: { type: 'boolean' } } },
  evaluateImages: EVALUATION_INPUT_SCHEMA
});
const OUTPUT_SCHEMAS = Object.freeze({
  vision: { type: 'object' },
  translation: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1 }, direction: { type: 'string' }, source: { type: 'string' }, alignment: { type: 'object' } } },
  generateTags: { type: 'object', properties: { positiveTags: { type: 'array', minItems: 1, items: { type: 'string' } }, negativeTags: { type: 'array', items: { type: 'string' } }, add: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } }, preserve: { type: 'array', items: { type: 'string' } }, negativeAdd: { type: 'array', items: { type: 'string' } }, negativeRemove: { type: 'array', items: { type: 'string' } } } },
  evaluateImages: EVALUATION_OUTPUT_SCHEMA
});

function text(value, fallback = '') { const result = value == null ? '' : String(value).trim(); return result || fallback; }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { if (value == null || typeof value !== 'object') return value; if (Array.isArray(value)) return value.map(clone); const output = {}; for (const [key, item] of Object.entries(value)) if (typeof item !== 'function' && key !== 'signal') output[key] = clone(item); return output; }
function unwrap(value) { return value && value.ok === true && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value; }
function failure(code, message) { const error = new Error(message); error.code = code; return error; }
function reportUsage(source, context) {
  const usage = object(source?.usage) ? clone(source.usage) : null;
  if (usage) context?.onUsage?.(usage);
  return usage;
}
function envelope(data, source) {
  return { ok: true, data, usage: object(source?.usage) ? clone(source.usage) : null };
}
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
function parseTagPatch(value, allowNegative) {
  let payload = unwrap(value);
  if (object(payload) && Array.isArray(payload.choices)) return parseTagPatch(responseText(payload), allowNegative);
  if (object(payload) && payload.add === undefined && payload.remove === undefined && payload.preserve === undefined && typeof payload.text === 'string') return parseTagPatch(payload.text, allowNegative);
  if (typeof payload === 'string') {
    const source = payload.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gi, '').trim();
    if (!source) throw failure('OUTPUT_INVALID', 'Tag 修订子代理返回为空');
    try { payload = JSON.parse(source); } catch { throw failure('OUTPUT_INVALID', 'Tag 修订子代理必须返回有效 JSON'); }
  }
  if (!object(payload)) throw failure('OUTPUT_INVALID', 'Tag 修订子代理返回格式无效');
  const keys = ['add', 'remove', 'preserve', 'negativeAdd', 'negativeRemove'];
  if (!keys.some(key => Object.prototype.hasOwnProperty.call(payload, key))) throw failure('OUTPUT_INVALID', 'Tag 修订子代理未返回修订补丁');
  const result = {
    add: [...new Set(parseList(payload.add))].slice(0, 256),
    remove: [...new Set(parseList(payload.remove))].slice(0, 256),
    preserve: [...new Set(parseList(payload.preserve))].slice(0, 256)
  };
  if (allowNegative) {
    result.negativeAdd = [...new Set(parseList(payload.negativeAdd))].slice(0, 256);
    result.negativeRemove = [...new Set(parseList(payload.negativeRemove))].slice(0, 256);
  }
  return result;
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
  entries.vision = { name: 'vision', description: '固定单图识图子代理，不带会话上下文。', getSystemPrompt: () => promptFor(prompts, 'vision', '你是单图识图子代理，只根据一张图片输出可见内容和绘图 Tag。'), systemPrompt: promptFor(prompts, 'vision', '你是单图识图子代理，只根据一张图片输出可见内容和绘图 Tag。'), inputSchema: SCHEMAS.vision, outputSchema: { type: 'object' }, timeoutMs: 120000, options: noThinking, async run(input, context = {}) { assertValid(SCHEMAS.vision, input); if (!vision?.processOne) throw failure('SUBAGENT_UNAVAILABLE', 'Vision 子代理不可用'); const result = await vision.processOne({ ...clone(input), signal: context.signal, sessionId: context.sessionId, onDelta: undefined, onEvent: undefined, stream: false }); reportUsage(result, context); if (result?.ok === false) throw failure(result.code || 'VISION_FAILED', result.error || '识图失败'); return envelope(unwrap(result), result); } };
  entries.translation = {
    name: 'translation', description: '固定翻译子代理，可选返回原文译文对照。',
    getSystemPrompt: () => promptFor(prompts, 'translation', '你是固定翻译子代理，只返回翻译结果和方向。'),
    inputSchema: SCHEMAS.translation, outputSchema: OUTPUT_SCHEMAS.translation, timeoutMs: 60000, options: noThinking,
    async run(input, context = {}) {
      assertValid(SCHEMAS.translation, input);
      const direction = ['zh-en', 'en-zh'].includes(input.direction) ? input.direction : /[\u3400-\u9fff]/u.test(input.text) ? 'zh-en' : 'en-zh';
      const local = input.source === 'local' || (!input.source && Boolean(translation?.translateLocal || translation?.translateWithModel || translation?.translate));
      let result, source, alignmentSource = null;
      if (local && translation) {
        const method = translation.translateLocal || translation.translateWithModel || translation.translate || translation.run;
        if (typeof method === 'function') { result = await method.call(translation, input.text, direction, { signal: context.signal, includeAdult: input.includeAdult === true, ...noThinking }); source = 'local'; }
      }
      if (result == null) {
        if (!primaryAI?.complete) throw failure('SUBAGENT_UNAVAILABLE', '翻译 AI 不可用');
        const base = promptFor(prompts, 'translation', '你是固定翻译子代理，只返回翻译结果和方向。');
        alignmentSource = input.includeAlignment ? segmentSourceText(input.text) : null;
        const protocol = alignmentSource ? [
          '【本次翻译对照协议】只返回 JSON：text 为完整译文，direction 为本次方向，targetSegments 为按译文顺序排列的片段。',
          '每个片段包含 text 和 sourceIds 数组。片段文本必须逐字拼接为完整 text（含全部空格、换行和标点）；只能引用输入 sourceUnits 中的 ID，不能改写原文或计算字符位置。',
          '按最小自然词组建立语义对应，可跨语序、一对多、多对一；重复词要对应正确的那次出现。关联不明、补充语法或纯标点可用空 sourceIds。不要为了对齐改变译文意思或凭空新增内容。',
          '保持绘画 Tag、权重、专名的语义和结构；sourceUnits 仅为定位单元，应结合完整原文翻译。'
        ].join('\n') : '';
        const content = alignmentSource ? JSON.stringify({ text: input.text, direction, sourceUnits: alignmentSource.sourceUnits.map(({ id, text }) => ({ id, text })) }) : input.text;
        // Translation is a short, non-streaming child task. Do not expose
        // provider reasoning or partial deltas to the page.
        result = await primaryAI.complete([{ role: 'system', content: protocol ? base + '\n\n' + protocol : base }, { role: 'user', content }], { ...noThinking, signal: context.signal });
        source = 'ai';
      }
      reportUsage(result, context);
      if (result?.ok === false) throw failure(result.code || 'TRANSLATION_FAILED', text(result.error?.message || result.error, '翻译失败'));
      const value = unwrap(result);
      const parsed = parseTranslationPayload(value, alignmentSource?.sourceUnits || []);
      if (!parsed.text.trim()) throw failure('OUTPUT_INVALID', '翻译子代理返回为空');
      return envelope({ text: parsed.text, direction, source,
        ...(parsed.alignment ? { alignment: { ...parsed.alignment, granularity: alignmentSource.granularity } } : {}),
        references: Array.isArray(value?.references) ? clone(value.references).map(item => ({ en: text(item?.en), zh: text(item?.zh || item?.zhPrimary), category: text(item?.category) })) : []
      }, result);
    }
  };
  entries.generateTags = { name: 'generateTags', description: '固定文生图 Tag 子代理，只返回结构化正向 Tag。', getSystemPrompt: () => composeGeneratePrompt(prompts, '你是文生图 Tag 子代理。只返回 JSON。'), systemPrompt: composeGeneratePrompt(prompts, '你是文生图 Tag 子代理。只返回 JSON。'), inputSchema: SCHEMAS.generateTags, outputSchema: { type: 'object', required: ['positiveTags'], properties: { positiveTags: { type: 'array' }, negativeTags: { type: 'array' } } }, timeoutMs: 120000, options: noThinking, async run(input, context = {}) { assertValid(SCHEMAS.generateTags, input); const settings = getSettings() || {}; const allowNegative = settings.generateNegativeTags === true && input.generateNegativeTags !== false; const basePrompt = composeGeneratePrompt(prompts, '你是文生图 Tag 子代理。只返回 JSON。'); const outputProtocol = ['系统输出协议：完成上面的 Anima 编译规则后，最终只返回一个有效 JSON 对象。', 'JSON 必须包含 positiveTags 字符串数组。', allowNegative ? '用户设置允许负面 Tag，可选返回 negativeTags 字符串数组。' : '用户设置关闭负面 Tag，禁止输出 negativeTags 字段。', '禁止输出代码块、解释、建议、标题、思考过程或 JSON 以外的文字。', input.characterReferences?.length ? '本次角色资料来自本地词库，可作为已知角色特征参考；用户明确指定的外貌、服装、人数和情境始终优先。资料是可选候选，不要求全用，不同时采用互斥发色/眼色或不同形态。保留每个角色与其特征的归属。输出角色/作品字面括号时使用反斜杠转义。' : ''].filter(Boolean).join('\n'); const system = [basePrompt, outputProtocol, SOURCE_REFERENCE_GUIDANCE, input.characterReferences?.length ? CHARACTER_REFERENCE_GUIDANCE : ""].filter(Boolean).join("\n\n"); const content = [{ type: 'text', text: ['当前要求：' + input.requirements, input.description ? '图片描述：' + input.description : '', input.positiveTags?.length ? '已有正向 Tag：' + input.positiveTags.join(', ') : '', input.referenceTags?.length ? '参考 Tag：' + input.referenceTags.join(', ') : '', input.characterReferences?.length ? '角色资料（按角色独立关联）：' + JSON.stringify(input.characterReferences) : ''].filter(Boolean).join('\n') }]; if (input.imageId) { if (!resolveImage) throw failure('IMAGE_RESOLVER_UNAVAILABLE', '未配置受控图片解析器'); const image = await resolveImage(input.imageId, context); if (!image) throw failure('IMAGE_NOT_FOUND', '未找到图片：' + input.imageId); const url = text(image.dataUrl || image.url || image.src || image.previewUrl || image.viewUrl); if (!url) throw failure('IMAGE_DATA_UNAVAILABLE', '无法读取图片：' + input.imageId); content.push({ type: 'image_url', image_url: { url } }); } if (!visionAI?.complete) throw failure('SUBAGENT_UNAVAILABLE', 'Vision AI 不可用'); const result = await visionAI.complete([{ role: 'system', content: system }, { role: 'user', content }], { ...noThinking, signal: context.signal }); reportUsage(result, context); if (result?.ok === false) throw failure(result.code || 'GENERATE_TAGS_FAILED', result.error || 'Tag 生成失败'); return envelope(parseTags(result, allowNegative), result); } };
  const compileTags = entries.generateTags.run;
  entries.generateTags.outputSchema = OUTPUT_SCHEMAS.generateTags;
  entries.generateTags.run = async (input, context = {}) => {
    if (input.operation !== 'revise') return compileTags(input, context);
    assertValid(SCHEMAS.generateTags, input);
    const allowNegative = getSettings()?.generateNegativeTags === true && input.generateNegativeTags !== false;
    const basePrompt = composeGeneratePrompt(prompts, '你是文生图 Tag 子代理。只返回 JSON。');
    const protocol = [
      '系统修订协议：根据候选图评价修订上一版 Tag，只返回一个有效 JSON 对象。',
      'JSON 必须包含 add、remove、preserve 三个字符串数组；preserve 仅在本次补丁中保留 Tag，不形成后续永久锁定。',
      allowNegative ? '可选返回 negativeAdd 与 negativeRemove 字符串数组。' : '用户设置关闭负面 Tag，禁止修订负面 Tag。',
      SOURCE_REFERENCE_GUIDANCE,
      input.characterReferences?.length ? CHARACTER_REFERENCE_GUIDANCE : '',
      '不要返回完整 positiveTags，不要输出代码块、解释、建议、标题或思考过程。'
    ].filter(Boolean).join('\n');
    const content = [{ type: 'text', text: [
      '当前要求：' + input.requirements,
      input.description ? '视觉蓝图：' + input.description : '',
      '上一版正向 Tag：' + (input.positiveTags || []).join(', '),
      allowNegative && input.negativeTags?.length ? '上一版负向 Tag：' + input.negativeTags.join(', ') : '',
      input.evaluation ? '候选图评价：' + JSON.stringify(input.evaluation) : '',
      input.characterReferences?.length ? '角色资料（按角色独立关联）：' + JSON.stringify(input.characterReferences) : ''
    ].filter(Boolean).join('\n') }];
    if (!visionAI?.complete) throw failure('SUBAGENT_UNAVAILABLE', 'Vision AI 不可用');
    const result = await visionAI.complete([{ role: 'system', content: `${basePrompt}\n\n${protocol}` }, { role: 'user', content }], { ...noThinking, signal: context.signal });
    reportUsage(result, context);
    if (result?.ok === false) throw failure(result.code || 'GENERATE_TAGS_FAILED', result.error || 'Tag 修订失败');
    return envelope(parseTagPatch(result, allowNegative), result);
  };
  entries.evaluateImages = createCandidateEvaluator({ visionAI, prompts, resolveImage, returnEnvelope: true });
  return Object.freeze({ ...entries, names: () => SUBAGENT_NAMES.slice(), resolve: name => entries[name] || null, list: () => SUBAGENT_NAMES.map(name => entries[name]) });
}

module.exports = { SUBAGENT_NAMES, SCHEMAS, OUTPUT_SCHEMAS, createFixedSubagents };
