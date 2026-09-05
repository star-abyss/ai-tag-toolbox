'use strict';

// Fixed subagents are deliberately small adapters around the existing domain
// services. They never receive conversation history or a tool registry.

const SUBAGENT_NAMES = Object.freeze(['vision', 'translation', 'generateTags']);

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).trim();
  return result || fallback;
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function list(value) {
  if (Array.isArray(value)) return value.map(item => text(item)).filter(Boolean);
  if (value == null || value === '') return [];
  return String(value).split(/[,，、;；|\n]+/).map(item => text(item)).filter(Boolean);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function error(code, message) {
  const result = new Error(message);
  result.code = code;
  return result;
}

function unwrap(result) {
  if (result && result.ok === true && Object.prototype.hasOwnProperty.call(result, 'data')) return result.data;
  return result;
}

function promptFor(prompts, key, fallback) {
  if (!prompts) return fallback;
  try {
    if (typeof prompts.get === 'function') return text(prompts.get(key), fallback);
    if (typeof prompts.read === 'function') return text(prompts.read(key), fallback);
    if (typeof prompts.item === 'function') return text(prompts.item(key)?.text, fallback);
    if (object(prompts) && prompts[key] != null) return text(prompts[key], fallback);
  } catch { /* a prompt override must not break a subagent */ }
  return fallback;
}

const SCHEMAS = Object.freeze({
  vision: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['imageId', 'mode'],
    properties: {
      imageId: { type: 'string', minLength: 1 },
      mode: { type: 'string', enum: ['metadata', 'local', 'ai'] },
      model: { type: 'string' },
      instruction: { type: 'string' },
      includeLocalTags: { type: 'boolean' },
      hasBuiltinTags: { type: 'boolean' }
    }
  }),
  translation: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: {
      text: { type: 'string', minLength: 1, maxLength: 16000 },
      direction: { type: 'string', enum: ['auto', 'zh-en', 'en-zh'] },
      includeAdult: { type: 'boolean' }
    }
  }),
  generateTags: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['requirements'],
    properties: {
      requirements: { type: 'string', minLength: 1, maxLength: 16000 },
      description: { type: 'string', maxLength: 16000 },
      imageId: { type: 'string' },
      positiveTags: { type: 'array', items: { type: 'string' }, maxItems: 256 },
      referenceTags: { type: 'array', items: { type: 'string' }, maxItems: 256 },
      generateNegativeTags: { type: 'boolean' }
    }
  })
});

function validateInput(schema, input) {
  const value = object(input) ? input : {};
  for (const key of schema.required || []) if (!text(value[key]) && !(Array.isArray(value[key]) && value[key].length)) {
    throw error('INVALID_INPUT', `缺少参数：${key}`);
  }
  for (const [key, rule] of Object.entries(schema.properties || {})) {
    if (value[key] == null) continue;
    if (rule.type === 'string' && typeof value[key] !== 'string') throw error('INVALID_INPUT', `参数 ${key} 必须是文本`);
    if (rule.type === 'array' && !Array.isArray(value[key])) throw error('INVALID_INPUT', `参数 ${key} 必须是数组`);
    if (rule.enum && !rule.enum.includes(value[key])) throw error('INVALID_INPUT', `参数 ${key} 的值无效`);
    if (rule.maxLength && String(value[key]).length > rule.maxLength) throw error('INVALID_INPUT', `参数 ${key} 超过长度限制`);
  }
  return value;
}

function normalizeTag(value) {
  return text(value).replace(/^(?:[-*]\s+|\d+[.)]\s+)/, '').replace(/^['"`]+|['"`]+$/g, '').trim();
}

function parseTags(value) {
  if (Array.isArray(value)) return value.flatMap(item => parseTags(item));
  if (object(value)) return parseTags(value.positiveTags || value.tags || value.text || value.content || '');
  if (typeof value === 'string' && /^\s*[{"[]/.test(value)) {
    try { return parseTags(JSON.parse(value)); } catch { /* parse as delimited text */ }
  }
  return String(value || '').split(/[,，、;；|\n]+/).map(normalizeTag).filter(Boolean);
}

function normalizeGeneratedTags(result, request, allowNegative) {
  const source = unwrap(result);
  let payload = source;
  if (object(source) && Array.isArray(source.choices)) {
    payload = source.choices[0]?.message?.content ?? source.choices[0]?.text ?? source;
  }
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload.replace(/^```(?:json)?\s*|\s*```$/gi, '')); } catch { /* parse as a tag list below */ }
  }
  payload = object(payload) ? payload : { positiveTags: parseTags(payload) };
  const positiveTags = [...new Set(parseTags(payload.positiveTags || payload.tags || payload.text))].slice(0, 256);
  const output = { positiveTags };
  if (allowNegative) output.negativeTags = [...new Set(parseTags(payload.negativeTags || payload.negative || ''))].slice(0, 256);
  if (payload.reasoning && typeof payload.reasoning === 'string') output.reasoning = '';
  return output;
}

function createFixedSubagents(options = {}) {
  const visionOption = options.vision || options.visionService || null;
  const vision = typeof visionOption === 'function' ? { processOne: visionOption } : visionOption;
  const translationOption = options.translation || null;
  const translation = typeof translationOption === 'function' ? { translate: translationOption } : translationOption;
  const aiOption = options.ai || options.visionAI || options.primaryClient || null;
  const ai = typeof aiOption === 'function' ? { complete: aiOption } : aiOption;
  const prompts = options.prompts || null;
  const getSettings = typeof options.getSettings === 'function' ? options.getSettings : () => ({});

  const visionEntry = {
    name: 'vision',
    description: '固定单图识图子代理，不带会话上下文。',
    systemPrompt: promptFor(prompts, 'vision', '你是单图识图子代理，只根据一张图片输出可见内容和绘图 Tag。'),
    inputSchema: SCHEMAS.vision,
    outputSchema: { type: 'object' },
    timeoutMs: 120000,
    options: Object.freeze({ stream: false, reasoning_effort: 'none', enable_thinking: false, thinking: { type: 'disabled' } }),
    async run(input, context = {}) {
      const request = validateInput(SCHEMAS.vision, input);
      if (!vision || typeof vision.processOne !== 'function') throw error('SUBAGENT_UNAVAILABLE', 'Vision 子代理不可用');
      const result = await vision.processOne({ ...clone(request), signal: context.signal, sessionId: undefined, refId: undefined, onDelta: undefined, onEvent: undefined, stream: false });
      if (result?.ok === false) throw Object.assign(new Error(result.error || '识图失败'), { code: result.code || 'VISION_FAILED' });
      return unwrap(result);
    }
  };

  const translationEntry = {
    name: 'translation',
    description: '固定文本翻译子代理，不带会话上下文。',
    systemPrompt: promptFor(prompts, 'translation', '你是固定翻译子代理，只返回翻译结果和方向。'),
    inputSchema: SCHEMAS.translation,
    outputSchema: { type: 'object', required: ['text'] },
    timeoutMs: 60000,
    options: Object.freeze({ stream: false, reasoning_effort: 'none', enable_thinking: false, thinking: { type: 'disabled' } }),
    async run(input, context = {}) {
      const request = validateInput(SCHEMAS.translation, input);
      if (!translation) throw error('SUBAGENT_UNAVAILABLE', '翻译子代理不可用');
      const extra = { signal: context.signal, includeAdult: request.includeAdult === true, ...translationEntry.options };
      const method = typeof translation.translateWithAI === 'function' && (translation.ai || ai)
        ? translation.translateWithAI
        : typeof translation.translateWithModel === 'function'
          ? translation.translateWithModel
          : translation.translate || translation.run;
      if (typeof method !== 'function') throw error('SUBAGENT_UNAVAILABLE', '翻译接口不可用');
      const result = await method.call(translation, request.text, request.direction, extra);
      if (result?.ok === false) throw Object.assign(new Error(result.error || '翻译失败'), { code: result.code || 'TRANSLATION_FAILED' });
      const output = unwrap(result) || {};
      return { text: text(output.text, text(output.translation, '')), direction: text(output.direction, request.direction || 'auto'), references: Array.isArray(output.references) ? clone(output.references) : [], source: text(output.source, 'model') };
    }
  };

  const generateTagsEntry = {
    name: 'generateTags',
    description: '固定文生图 Tag 子代理，只返回结构化正向 Tag。',
    systemPrompt: promptFor(prompts, 'generateTags', '你是文生图 Tag 子代理。根据要求生成精炼、可直接用于绘图的英文正向 Tag。只返回 JSON：{"positiveTags": string[], "negativeTags"?: string[]}。'),
    inputSchema: SCHEMAS.generateTags,
    outputSchema: { type: 'object', required: ['positiveTags'], properties: { positiveTags: { type: 'array', items: { type: 'string' } }, negativeTags: { type: 'array', items: { type: 'string' } } } },
    timeoutMs: 120000,
    options: Object.freeze({ stream: false, reasoning_effort: 'none', enable_thinking: false, thinking: { type: 'disabled' } }),
    async run(input, context = {}) {
      const request = validateInput(SCHEMAS.generateTags, input);
      const settings = getSettings() || {};
      const allowNegative = request.generateNegativeTags === true || settings.generateNegativeTags === true || settings.limits?.generateNegativeTags === true;
      const prompt = [generateTagsEntry.systemPrompt, `要求：${request.requirements}`, request.description ? `图片描述：${request.description}` : '', request.positiveTags?.length ? `已有正向 Tag：${request.positiveTags.join(', ')}` : '', request.referenceTags?.length ? `参考 Tag：${request.referenceTags.join(', ')}` : '', allowNegative ? '可额外返回 negativeTags。' : '不要返回 negativeTags。'].filter(Boolean).join('\n');
      let result;
      if (ai && typeof ai.complete === 'function') {
        result = await ai.complete([{ role: 'system', content: generateTagsEntry.systemPrompt }, { role: 'user', content: prompt }], { ...generateTagsEntry.options, signal: context.signal });
      } else if (ai && typeof ai.generateTags === 'function') {
        result = await ai.generateTags({ ...request, prompt, signal: context.signal, ...generateTagsEntry.options });
      } else {
        // A deterministic fallback keeps the tool useful when no model is configured.
        result = { positiveTags: [...list(request.positiveTags), ...list(request.referenceTags), ...parseTags(request.requirements)].slice(0, 256) };
      }
      if (result?.ok === false) throw Object.assign(new Error(result.error || 'Tag 生成失败'), { code: result.code || 'GENERATE_TAGS_FAILED' });
      let payload = unwrap(result);
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload.replace(/^```(?:json)?\s*|\s*```$/gi, '')); } catch { /* parse as a tag list below */ }
      }
      return normalizeGeneratedTags(payload, request, allowNegative);
    }
  };

  return Object.freeze({ vision: visionEntry, translation: translationEntry, generateTags: generateTagsEntry, names: () => SUBAGENT_NAMES.slice(), resolve: name => Object.prototype.hasOwnProperty.call({ vision: visionEntry, translation: translationEntry, generateTags: generateTagsEntry }, name) ? ({ vision: visionEntry, translation: translationEntry, generateTags: generateTagsEntry })[name] : null });
}

module.exports = { SUBAGENT_NAMES, SCHEMAS, createFixedSubagents };
