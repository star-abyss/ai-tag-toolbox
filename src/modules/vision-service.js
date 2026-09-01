'use strict';

/**
 * 独立的单图识图服务。
 *
 * Vision Service 只接受一个明确的 imageId，并把三种识图方式收敛到同一
 * 个入口。图片仓库、本地模型和视觉 API 都通过依赖注入提供，服务本身不
 * 读取页面集合，也不继承主 AI 会话历史。
 */

const { promptToTags } = require('./images');

const MODES = Object.freeze(['metadata', 'local', 'ai']);
const DEFAULT_AI_PROMPT = '请分析图片并输出适合绘图的英文 Tag。';
const DEFAULT_LOCAL_MODEL = 'eva02';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).replace(/^\uFEFF/, '').trim();
  return result || fallback;
}

function list(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function clone(value) {
  if (value == null || typeof value !== 'object') return value;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(clone);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'function' || key === 'signal') continue;
    output[key] = clone(item);
  }
  return output;
}

function tagName(value) {
  return typeof value === 'string'
    ? text(value)
    : text(value && (value.tag || value.en || value.name));
}

function normaliseTags(value, origin = '') {
  const seen = new Set();
  return list(value).map((item) => {
    const name = tagName(item);
    if (!name) return null;
    const key = name.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    if (typeof item === 'string') return { tag: name, name, ...(origin ? { origin } : {}) };
    return { ...clone(item), tag: name, name, ...(origin && !item.origin ? { origin } : {}) };
  }).filter(Boolean);
}

function imageUrl(value) {
  if (typeof value === 'string') return value;
  return text(value && (value.dataUrl || value.url || value.src || value.previewUrl || value.viewUrl));
}

function mimeFromDataUrl(value, fallback = 'image/png') {
  if (typeof value !== 'string' || !value.startsWith('data:')) return fallback;
  const comma = value.indexOf(',');
  if (comma < 0) return fallback;
  return text(value.slice(5, comma).split(';')[0], fallback);
}

function dataUrlFromBytes(bytes, mime = 'image/png') {
  if (!bytes) return '';
  const contentType = /^image\//i.test(String(mime || '')) && mime !== 'image/*' ? mime : 'image/png';
  try { return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`; } catch { return ''; }
}

function errorResult(imageId, mode, code, message, extra = {}) {
  return {
    ok: false,
    tool: 'vision.processOne',
    imageId: text(imageId),
    mode: text(mode),
    code: text(code, 'VISION_ERROR'),
    error: text(message, '识图失败'),
    ...clone(extra)
  };
}

function metadataData(metadata, image) {
  const source = isObject(metadata) ? clone(metadata) : {};
  const builtinTags = normaliseTags(source.builtinTags || source.tags, 'metadata');
  const builtinNegativeTags = normaliseTags(source.builtinNegativeTags || source.negativeTags, 'metadata');
  const prompt = text(source.promptText || source.prompt || source.positivePrompt);
  const negative = text(source.negativePrompt || source.negative || source.negativeText);
  const workflow = source.workflowJson || source.workflow || '';
  return {
    metadata: source,
    tags: builtinTags,
    modelTags: [],
    negativeTags: builtinNegativeTags,
    builtinTags,
    builtinNegativeTags,
    text: prompt,
    reasoning: '',
    model: '',
    prompt,
    negative,
    workflow: clone(workflow),
    parameters: text(source.parameters),
    filename: text(image && (image.filename || image.name))
  };
}

function analysisData(result, image) {
  const source = isObject(result) ? result : { tags: result };
  const tags = normaliseTags(source.tags || source.modelTags || source.items, 'local');
  const builtinTags = normaliseTags(source.builtinTags || source.builtin, 'metadata');
  const negativeTags = normaliseTags(source.builtinNegativeTags || source.negativeTags, 'metadata');
  return {
    metadata: clone(image && image.metadata) || {},
    tags,
    modelTags: tags,
    negativeTags,
    builtinTags,
    builtinNegativeTags: negativeTags,
    text: text(source.text || source.description),
    reasoning: text(source.reasoning),
    model: text(source.model || source.modelId),
    status: text(source.status, 'done'),
    threshold: source.threshold,
    count: Number.isFinite(Number(source.count)) ? Number(source.count) : tags.length,
    filename: text(image && (image.filename || image.name))
  };
}

function responseText(result) {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  if (result.text != null) return text(result.text);
  if (result.content != null) return text(Array.isArray(result.content) ? result.content.map(responseText).join('') : result.content);
  const choice = result.choices && result.choices[0];
  const content = choice?.message?.content;
  return text(Array.isArray(content) ? content.map(responseText).join('') : content || choice?.text || result.output_text);
}

function responseReasoning(result) {
  if (!result || typeof result !== 'object') return '';
  return text(result.reasoning || result.thinking || result.reasoning_content || result.choices?.[0]?.message?.reasoning || result.choices?.[0]?.message?.reasoning_content);
}

/**
 * @param {object} options
 * @param {object} options.images ImageStore-like object (`get`, `metadata`, ...)
 * @param {object} options.localVision WD EVA02 adapter (`analyze` or `run`)
 * @param {object} options.visionAI Independent vision client (`complete`)
 * @param {Function} options.getPrompt Prompt resolver, normally prompts.getEffective
 */
function createVisionService(options = {}) {
  const images = options.images || null;
  const localVision = options.localVision || options.vision || null;
  const visionAI = options.visionAI || options.visionAi || null;
  const getPrompt = typeof options.getPrompt === 'function'
    ? options.getPrompt
    : typeof options.prompts?.getEffective === 'function'
      ? options.prompts.getEffective.bind(options.prompts)
      : typeof options.prompts?.get === 'function'
        ? options.prompts.get.bind(options.prompts)
        : () => '';

  function getImage(imageId) {
    try { return images?.get?.(imageId) || null; } catch { return null; }
  }

  async function imageDataUrl(image, imageId) {
    const direct = imageUrl(image);
    if (direct) return direct;
    let bytes = null;
    try {
      if (typeof images?.getBytes === 'function') bytes = await images.getBytes(imageId);
      if (!bytes && typeof images?.getBlob === 'function') bytes = await images.getBlob(imageId);
    } catch { bytes = null; }
    return dataUrlFromBytes(bytes, text(image?.mime, mimeFromDataUrl(direct)));
  }

  function validate(input) {
    if (!isObject(input)) return { error: errorResult('', '', 'INVALID_INPUT', '识图参数必须是对象') };
    if (Object.prototype.hasOwnProperty.call(input, 'imageIds')) {
      return { error: errorResult('', text(input.mode), 'SINGLE_IMAGE_REQUIRED', 'Vision 每次只能处理一个 imageId，不接受 imageIds 数组') };
    }
    if (Object.prototype.hasOwnProperty.call(input, 'paths') || Object.prototype.hasOwnProperty.call(input, 'imagePaths')) {
      return { error: errorResult('', text(input.mode), 'SINGLE_IMAGE_REQUIRED', 'Vision 只接受明确的 imageId，不接受图片路径或路径数组') };
    }
    if (Array.isArray(input.imageId)) {
      return { error: errorResult('', text(input.mode), 'SINGLE_IMAGE_REQUIRED', 'Vision 每次只能处理一个 imageId') };
    }
    if (typeof input.imageId !== 'string') {
      return { error: errorResult('', text(input.mode), 'INVALID_IMAGE_ID', 'imageId 必须是单个字符串') };
    }
    const imageId = text(input.imageId);
    if (!imageId) return { error: errorResult('', text(input.mode), 'IMAGE_ID_REQUIRED', '缺少 imageId') };
    const mode = text(input.mode, 'metadata').toLowerCase();
    if (!MODES.includes(mode)) return { error: errorResult(imageId, mode, 'INVALID_MODE', `不支持的识图模式：${mode}`) };
    return { imageId, mode };
  }

  async function readMetadataMode(imageId, image) {
    let metadata = image?.metadata || null;
    try {
      if (typeof images?.metadata === 'function') metadata = await images.metadata(imageId);
    } catch (error) {
      return errorResult(imageId, 'metadata', 'METADATA_READ_FAILED', error?.message || String(error));
    }
    return { ok: true, tool: 'vision.processOne', imageId, mode: 'metadata', data: metadataData(metadata, image) };
  }

  async function saveAnalysis(imageId, result) {
    if (typeof images?.update !== 'function') return;
    try { images.update(imageId, { analysis: clone(result) }); } catch { /* 缓存保存失败不影响本次结果 */ }
  }

  async function localMode(imageId, image, input) {
    let result = null;
    try {
      let localInput = image;
      if (!imageUrl(image) && typeof images?.getBytes === 'function') {
        try {
          const bytes = await images.getBytes(imageId);
          if (bytes) localInput = { ...image, bytes };
        } catch { /* adapter 会返回清晰的解码错误 */ }
      }
      const localOptions = { ...input, imageId, model: text(input.model, DEFAULT_LOCAL_MODEL) };
      if (typeof localVision === 'function') result = await localVision(localInput, localOptions);
      else if (typeof localVision?.analyze === 'function') result = await localVision.analyze(localInput, localOptions);
      else if (typeof localVision?.run === 'function') result = await localVision.run(localInput, localOptions);
      else if (typeof images?.analyze === 'function') {
        const row = await images.analyze(imageId, { ...input });
        result = row?.analysis || row;
      }
    } catch (error) {
      return errorResult(imageId, 'local', error?.code || 'LOCAL_VISION_FAILED', error?.message || String(error));
    }
    if (!result) return errorResult(imageId, 'local', 'LOCAL_VISION_UNAVAILABLE', '本地识图模块不可用');
    const data = analysisData(result, image);
    if (result.ok === false) {
      return errorResult(imageId, 'local', result.code || (result.status === 'unavailable' ? 'LOCAL_VISION_UNAVAILABLE' : 'LOCAL_VISION_FAILED'), result.error || '本地识图失败', { data });
    }
    await saveAnalysis(imageId, { ...clone(result), ...data });
    return { ok: true, tool: 'vision.processOne', imageId, mode: 'local', data };
  }

  async function aiMode(imageId, image, input) {
    if (typeof visionAI?.complete !== 'function') return errorResult(imageId, 'ai', 'VISION_AI_UNAVAILABLE', '识图 API 未配置');
    const url = await imageDataUrl(image, imageId);
    if (!url) return errorResult(imageId, 'ai', 'IMAGE_DATA_UNAVAILABLE', '无法读取图片内容');
    let basePrompt = DEFAULT_AI_PROMPT;
    try { basePrompt = text(await getPrompt('vision'), DEFAULT_AI_PROMPT); } catch { /* 使用内置兜底 */ }
    const instruction = text(input.instruction);
    const localTags = input.includeLocalTags === true
      ? normaliseTags(image?.analysis?.modelTags || image?.analysis?.tags, 'local')
      : [];
    const localHint = localTags.length
      ? `【本地识图辅助 Tag】\n${localTags.map(item => item.tag).join(', ')}\n这些 Tag 可能不完整或有误，请以实际图片为准。`
      : '';
    const system = [
      basePrompt,
      instruction ? `【本次附加识图要求】\n${instruction}` : '',
      localHint
    ].filter(Boolean).join('\n\n');
    const messages = [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请查看附图并按识图主提示词完成任务。' },
          { type: 'image_url', image_url: { url } }
        ]
      }
    ];
    let result;
    try {
      result = await visionAI.complete(messages, {
        signal: input.signal,
        stream: input.stream !== false,
        onDelta: input.onDelta,
        onEvent: input.onEvent
      });
    } catch (error) {
      if (input.signal?.aborted || error?.code === 'CANCELLED') return errorResult(imageId, 'ai', 'CANCELLED', '识图请求已停止');
      if (/does not support image|image(?:s)?\s*(?:are\s*)?not supported|不支持图片|图片输入/i.test(String(error?.message || error))) {
        return errorResult(imageId, 'ai', 'VISION_MODEL_NOT_SUPPORTED', '当前识图模型不支持图片输入，请选择视觉模型或配置独立识图 API');
      }
      return errorResult(imageId, 'ai', error?.code || 'VISION_AI_FAILED', error?.message || String(error));
    }
    if (result?.ok === false) {
      const message = result.error || result.text || '识图 API 返回失败';
      if (/does not support image|image(?:s)?\s*(?:are\s*)?not supported|不支持图片|图片输入/i.test(String(message))) {
        return errorResult(imageId, 'ai', 'VISION_MODEL_NOT_SUPPORTED', '当前识图模型不支持图片输入，请选择视觉模型或配置独立识图 API');
      }
      return errorResult(imageId, 'ai', result.code || 'VISION_AI_FAILED', message, { data: clone(result.data) });
    }
    const output = responseText(result);
    const reasoning = responseReasoning(result);
    const tags = normaliseTags(promptToTags(output), 'ai');
    const model = text(result?.model || visionAI.getConfig?.().model);
    return {
      ok: true,
      tool: 'vision.processOne',
      imageId,
      mode: 'ai',
      data: {
        metadata: clone(image?.metadata) || {},
        tags,
        modelTags: tags,
        negativeTags: [],
        builtinTags: normaliseTags(image?.metadata?.builtinTags, 'metadata'),
        builtinNegativeTags: normaliseTags(image?.metadata?.builtinNegativeTags, 'metadata'),
        text: output,
        reasoning,
        model,
        instruction
      }
    };
  }

  async function processOne(input = {}) {
    const validated = validate(input);
    if (validated.error) return validated.error;
    const { imageId, mode } = validated;
    if (input.signal?.aborted) return errorResult(imageId, mode, 'CANCELLED', '识图请求已停止');
    const image = getImage(imageId);
    if (!image) {
      const aliasHint = /^(?:图片|图|image)\s*\d+$/i.test(imageId)
        ? '；这是显示编号，请传入当前消息提供的真实 imageId'
        : '';
      return errorResult(imageId, mode, 'IMAGE_NOT_FOUND', `未找到图片：${imageId}${aliasHint}`);
    }
    if (mode === 'metadata') return readMetadataMode(imageId, image);
    if (mode === 'local') return localMode(imageId, image, input);
    return aiMode(imageId, image, input);
  }

  function available() {
    let local = Boolean(typeof localVision === 'function' || localVision?.analyze || localVision?.run || images?.analyze);
    try {
      if (typeof localVision?.available === 'function') {
        const state = localVision.available();
        local = state?.available !== false;
      }
    } catch { local = false; }
    let ai = Boolean(visionAI?.complete);
    let aiError = '';
    try {
      const config = visionAI?.getConfig?.();
      if (config && (Object.prototype.hasOwnProperty.call(config, 'configured') || config.base != null || config.model != null)) {
        ai = Object.prototype.hasOwnProperty.call(config, 'configured')
          ? config.configured === true
          : config.imageCapable === false
            ? false
            : Boolean(config.base && config.model);
        aiError = text(config.error);
      }
    } catch { ai = false; }
    const result = {
      metadata: Boolean(images?.get),
      local,
      ai
    };
    if (aiError) result.aiError = aiError;
    return result;
  }

  return {
    modes: MODES,
    available,
    processOne
  };
}

module.exports = { MODES, DEFAULT_LOCAL_MODEL, createVisionService };
