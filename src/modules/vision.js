'use strict';

/**
 * 本地识图模块。
 *
 * 这个模块只做三件事：把图片变成 WD Tagger 需要的像素、调用 ONNX、
 * 把输出对应回 tags-canary.json。没有 Electron IPC、Store 或旧版全局状态。
 * 运行环境没有模型/推理引擎时，analyze() 返回 unavailable，而不是抛出异常。
 */

const fs = require('node:fs');
const path = require('node:path');

const SIZE = 448;
const DEFAULT_MODEL = {
  id: 'eva02',
  name: 'WD EVA02 2026 Canary',
  onnx: 'wd-eva02-tagger-2026-canary.onnx',
  tags: 'tags-canary.json',
  threshold: 0.6094
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTypedArray(value) {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

function asBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  return null;
}

function dataUrlBytes(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) return null;
  const comma = value.indexOf(',');
  if (comma < 0) return null;
  const head = value.slice(5, comma).toLowerCase();
  const body = value.slice(comma + 1);
  try {
    return head.includes(';base64')
      ? Buffer.from(body, 'base64')
      : Buffer.from(decodeURIComponent(body), 'utf8');
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(item => path.resolve(String(item))))];
}

function optionalRequire(name) {
  try { return require(name); } catch { return null; }
}

function loadTagsFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (Array.isArray(raw)) return raw;
  if (!isObject(raw)) return [];
  return Object.keys(raw)
    .sort((a, b) => Number(a) - Number(b))
    .map(key => raw[key]);
}

function tagMeta(row, index) {
  if (Array.isArray(row)) {
    return {
      index,
      name: String(row[0] == null ? `#${index}` : row[0]),
      category: Number.isFinite(Number(row[1])) ? Number(row[1]) : 0,
      count: Number.isFinite(Number(row[2])) ? Number(row[2]) : 0
    };
  }
  if (isObject(row)) {
    return {
      index,
      name: String(row.name || row.tag || row.en || `#${index}`),
      category: Number.isFinite(Number(row.category ?? row.categoryCode)) ? Number(row.category ?? row.categoryCode) : 0,
      count: Number.isFinite(Number(row.count)) ? Number(row.count) : 0
    };
  }
  return { index, name: String(row == null ? `#${index}` : row), category: 0, count: 0 };
}

function readImageSource(input) {
  if (typeof input === 'string') {
    const data = dataUrlBytes(input);
    if (data) return data;
    try { return fs.readFileSync(input); } catch { return null; }
  }
  if (!isObject(input)) return asBytes(input);
  return asBytes(input.bytes || input.buffer)
    || dataUrlBytes(input.dataUrl || input.url)
    || (typeof input.path === 'string' ? (() => { try { return fs.readFileSync(input.path); } catch { return null; } })() : null)
    || (typeof input.filePath === 'string' ? (() => { try { return fs.readFileSync(input.filePath); } catch { return null; } })() : null);
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Number(value) || 0));
}

/** Convert RGB/RGBA/BGR raw pixels to a white-contained BGR image. */
function resizeRawPixels(source, width, height, channels, options = {}) {
  const target = Number(options.size) || SIZE;
  const input = source;
  const order = String(options.channelOrder || options.order || (channels === 4 ? 'rgba' : 'bgr')).toLowerCase();
  const normalized = options.normalized === true
    || (options.normalized == null && input.length > 0 && (() => {
      let max = 0;
      // Sampling keeps this cheap for large arrays.
      const step = Math.max(1, Math.floor(input.length / 4000));
      for (let i = 0; i < input.length; i += step) max = Math.max(max, Number(input[i]) || 0);
      return max <= 1.01;
    })());
  const out = new Uint8Array(target * target * 3);
  out.fill(255);
  const scale = Math.min(target / Math.max(1, width), target / Math.max(1, height));
  const drawWidth = Math.max(1, Math.round(width * scale));
  const drawHeight = Math.max(1, Math.round(height * scale));
  const x0 = Math.floor((target - drawWidth) / 2);
  const y0 = Math.floor((target - drawHeight) / 2);
  const get = (x, y, channel) => {
    const index = (y * width + x) * channels;
    let value;
    if (channels === 4) {
      const r = Number(input[index]) || 0;
      const g = Number(input[index + 1]) || 0;
      const b = Number(input[index + 2]) || 0;
      const a = (Number(input[index + 3]) || 0) / (normalized ? 1 : 255);
      const alpha = Math.max(0, Math.min(1, normalized ? a : a));
      value = channel === 0 ? b : channel === 1 ? g : r;
      // Composite transparent pixels on the white canvas.
      value = value * alpha + 255 * (1 - alpha);
    } else {
      const c0 = Number(input[index]) || 0;
      const c1 = Number(input[index + 1]) || 0;
      const c2 = Number(input[index + 2]) || 0;
      if (order === 'rgb') value = channel === 0 ? c2 : channel === 1 ? c1 : c0;
      else value = channel === 0 ? c0 : channel === 1 ? c1 : c2;
    }
    return normalized ? value * 255 : value;
  };
  for (let y = 0; y < drawHeight; y += 1) {
    const sy = Math.min(height - 1, Math.floor(y * height / drawHeight));
    for (let x = 0; x < drawWidth; x += 1) {
      const sx = Math.min(width - 1, Math.floor(x * width / drawWidth));
      const dst = ((y + y0) * target + x + x0) * 3;
      out[dst] = clampByte(get(sx, sy, 0));
      out[dst + 1] = clampByte(get(sx, sy, 1));
      out[dst + 2] = clampByte(get(sx, sy, 2));
    }
  }
  return out;
}

async function decodeWithSharp(source, size) {
  const sharp = optionalRequire('sharp');
  if (!sharp) return null;
  const result = await sharp(source)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const info = result.info || {};
  const channels = Number(info.channels) || 3;
  return resizeRawPixels(result.data, Number(info.width) || size, Number(info.height) || size, channels, {
    size,
    channelOrder: 'rgb'
  });
}

function nativeImageModule() {
  try {
    // Electron is optional; requiring it outside Electron simply fails.
    return require('electron').nativeImage;
  } catch { return null; }
}

function decodeWithNativeImage(source, size) {
  const nativeImage = nativeImageModule();
  if (!nativeImage) return null;
  let image = source && typeof source.getBitmap === 'function' ? source : null;
  if (!image) image = Buffer.isBuffer(source) ? nativeImage.createFromBuffer(source) : null;
  if (!image || image.isEmpty()) return null;
  const original = image.getSize();
  if (!original.width || !original.height) return null;
  const scale = Math.min(size / original.width, size / original.height);
  const width = Math.max(1, Math.round(original.width * scale));
  const height = Math.max(1, Math.round(original.height * scale));
  const bitmap = image.resize({ width, height, quality: 'best' }).toBitmap();
  const out = new Uint8Array(size * size * 3);
  out.fill(255);
  const x0 = Math.floor((size - width) / 2);
  const y0 = Math.floor((size - height) / 2);
  // Electron's bitmap is BGRA on Windows/macOS/Linux.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const dst = ((y + y0) * size + x + x0) * 3;
      const alpha = (bitmap[src + 3] == null ? 255 : bitmap[src + 3]) / 255;
      out[dst] = clampByte(bitmap[src] * alpha + 255 * (1 - alpha));
      out[dst + 1] = clampByte(bitmap[src + 1] * alpha + 255 * (1 - alpha));
      out[dst + 2] = clampByte(bitmap[src + 2] * alpha + 255 * (1 - alpha));
    }
  }
  return out;
}

async function pixelsFromInput(input, options = {}) {
  const target = Number(options.size) || SIZE;
  if (typeof options.decode === 'function') {
    try {
      const decoded = await options.decode(input, { size: target });
      if (decoded != null && decoded !== input) {
        const next = { ...options, decode: null };
        if (isObject(decoded)) {
          if (decoded.width != null) next.width = decoded.width;
          if (decoded.height != null) next.height = decoded.height;
          if (decoded.channels != null) next.channels = decoded.channels;
          if (decoded.channelOrder != null) next.channelOrder = decoded.channelOrder;
          if (decoded.layout != null) next.layout = decoded.layout;
          if (decoded.normalized != null) next.normalized = decoded.normalized;
          if (decoded.pixels != null) return pixelsFromInput(decoded.pixels, next);
          if (decoded.data != null) return pixelsFromInput(decoded.data, next);
        }
        return pixelsFromInput(decoded, next);
      }
    } catch (error) {
      return { error: `图片解码失败：${error && error.message || error}` };
    }
  }
  let value = input;
  if (isObject(input)) {
    options = {
      ...options,
      width: options.width || input.width,
      height: options.height || input.height,
      channels: options.channels || input.channels,
      channelOrder: options.channelOrder || input.channelOrder || input.order,
      layout: options.layout || input.layout,
      normalized: options.normalized ?? input.normalized
    };
    if (input.pixels != null) value = input.pixels;
    else if (input.imageData && input.imageData.data) {
      value = input.imageData;
      options = { ...options, width: input.imageData.width, height: input.imageData.height, channelOrder: 'rgba' };
    }
  }
  if (isObject(value) && value.data && isTypedArray(value.data)) {
    options = { ...options, width: value.width || options.width, height: value.height || options.height, channelOrder: options.channelOrder || 'rgba' };
    value = value.data;
  }
  if (isTypedArray(value) || Array.isArray(value)) {
    const data = value;
    const width = Number(options.width || (isObject(input) && input.width) || target);
    const height = Number(options.height || (isObject(input) && input.height) || target);
    const channels = Number(options.channels || (data.length === width * height * 4 ? 4 : 3));
    if (options.layout === 'nchw' && data.length >= target * target * 3) {
      const tensor = Float32Array.from(data.slice(0, target * target * 3), item => Number(item) || 0);
      return { tensor, nchw: true, size: target };
    }
    if (data.length < width * height * channels) return { error: '像素数据长度不足' };
    return { bgr: resizeRawPixels(data, width, height, channels, { ...options, size: target }), size: target };
  }
  const source = readImageSource(input);
  if (!source) return { error: '没有可读取的图片数据' };
  try {
    const sharpPixels = await decodeWithSharp(source, target);
    if (sharpPixels) return { bgr: sharpPixels, size: target };
  } catch (error) {
    // Try Electron's decoder next; it handles formats that sharp may not.
    if (options.throwDecodeErrors) return { error: `图片解码失败：${error.message || error}` };
  }
  try {
    const nativePixels = decodeWithNativeImage(source, target);
    if (nativePixels) return { bgr: nativePixels, size: target };
  } catch (error) {
    if (options.throwDecodeErrors) return { error: `图片解码失败：${error.message || error}` };
  }
  return { error: '当前环境没有可用的图片解码器（可传入 448×448 像素数据，或安装 sharp）' };
}

function toNchw(bgr, size, normalized = true) {
  const count = size * size;
  const result = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const divisor = normalized ? 255 : 1;
    result[i] = Number(bgr[i * 3] || 0) / divisor;
    result[count + i] = Number(bgr[i * 3 + 1] || 0) / divisor;
    result[count * 2 + i] = Number(bgr[i * 3 + 2] || 0) / divisor;
  }
  return result;
}

function unavailable(error) {
  return { ok: false, status: 'unavailable', tags: [], modelTags: [], error: String(error || '本地识图不可用') };
}

function createVision(options = {}) {
  const model = { ...DEFAULT_MODEL, ...(options.model || {}) };
  const size = Number(options.size) || SIZE;
  const dirs = unique([
    options.modelsDir,
    options.modelDir,
    path.resolve(__dirname, '../../assets/模型'),
    path.resolve(__dirname, '../../models'),
    typeof process !== 'undefined' && process.resourcesPath ? path.join(process.resourcesPath, 'models') : '',
    typeof process !== 'undefined' && process.execPath ? path.join(path.dirname(process.execPath), 'models') : '',
    typeof process !== 'undefined' ? path.join(process.cwd(), 'models') : ''
  ]);
  const runtimeOption = options.runtime || options.ort || null;
  let runtime = runtimeOption;
  let runtimeError = '';
  let sessionState = null;
  let tagsState = null;

  function modelPath(name) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    return '';
  }

  function loadRuntime() {
    if (runtime) return runtime;
    try { runtime = require('onnxruntime-node'); return runtime; } catch (first) {
      const candidates = [];
      if (typeof process !== 'undefined' && process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'onnxruntime-node'));
      }
      for (const candidate of candidates) {
        try { runtime = require(candidate); return runtime; } catch { /* keep looking */ }
      }
      runtimeError = first && first.message ? first.message : String(first);
      return null;
    }
  }

  function tags() {
    if (tagsState) return tagsState;
    const file = modelPath(model.tags);
    if (!file) return [];
    try {
      tagsState = loadTagsFile(file).map(tagMeta);
      return tagsState;
    } catch {
      return [];
    }
  }

  function available() {
    const ort = loadRuntime();
    const onnx = modelPath(model.onnx);
    const tagFile = modelPath(model.tags);
    if (!ort) return { available: false, reason: '本地推理引擎未安装', runtime: false, model: false, tags: !!tagFile, modelsDir: dirs[0], error: runtimeError };
    if (!onnx) return { available: false, reason: `未找到模型文件：${model.onnx}`, runtime: true, model: false, tags: !!tagFile, modelsDir: dirs[0] };
    if (!tagFile) return { available: false, reason: `未找到标签表：${model.tags}`, runtime: true, model: true, tags: false, modelsDir: dirs[0] };
    return { available: true, runtime: true, model: true, tags: true, id: model.id, name: model.name, modelPath: onnx, tagsPath: tagFile, threshold: model.threshold, size };
  }

  async function ensureSession() {
    const ort = loadRuntime();
    if (!ort) return unavailable('本地推理引擎未安装');
    const onnx = modelPath(model.onnx);
    const tagFile = modelPath(model.tags);
    if (!onnx) return unavailable(`未找到模型文件：${model.onnx}`);
    if (!tagFile) return unavailable(`未找到标签表：${model.tags}`);
    if (sessionState && sessionState.modelPath === onnx) return { ok: true, ...sessionState, ort };
    try {
      const session = await ort.InferenceSession.create(onnx, { executionProviders: ['cpu'] });
      tagsState = tags();
      sessionState = {
        session,
        modelPath: onnx,
        inputName: session.inputNames && session.inputNames[0] || 'input',
        outputName: session.outputNames && session.outputNames[0] || 'output',
        tagsMeta: tagsState
      };
      return { ok: true, ...sessionState, ort };
    } catch (error) {
      return unavailable(`模型加载失败：${error && error.message || error}`);
    }
  }

  async function analyze(input, dataOrOptions, maybeOptions) {
    let source = input;
    let analyzeOptions = maybeOptions || {};
    if (isTypedArray(dataOrOptions) || Array.isArray(dataOrOptions)) source = { ...(isObject(input) ? input : {}), pixels: dataOrOptions };
    else if (isObject(dataOrOptions) && maybeOptions == null) analyzeOptions = dataOrOptions;
    const prepared = await pixelsFromInput(source, { ...analyzeOptions, size });
    if (!prepared || prepared.error) return unavailable(prepared && prepared.error || '图片预处理失败');
    const ready = await ensureSession();
    if (!ready.ok) return ready;
    try {
      const pixels = prepared.nchw ? prepared.tensor : toNchw(prepared.bgr, prepared.size, true);
      const tensor = new ready.ort.Tensor('float32', Float32Array.from(pixels), [1, 3, prepared.size, prepared.size]);
      const output = await ready.session.run({ [ready.inputName]: tensor });
      const raw = output[ready.outputName] || Object.values(output)[0];
      const values = raw && raw.data ? raw.data : raw;
      if (!values || typeof values.length !== 'number') return { ok: false, status: 'error', tags: [], modelTags: [], error: '模型没有返回结果' };
      const threshold = Number.isFinite(Number(analyzeOptions.threshold)) ? Number(analyzeOptions.threshold) : Number(model.threshold);
      const result = [];
      for (let index = 0; index < values.length; index += 1) {
        let probability = Number(values[index]);
        if (!Number.isFinite(probability)) continue;
        // 兼容少数导出版本返回 logits 而不是概率的情况。
        if (probability < 0 || probability > 1) probability = 1 / (1 + Math.exp(-probability));
        if (probability < threshold) continue;
        const meta = ready.tagsMeta[index] || { name: `#${index}`, category: 0, count: 0 };
        const prob = Math.round(probability * 10000) / 10000;
        result.push({ tag: meta.name, name: meta.name, category: meta.category, categoryCode: meta.category, prob, probability: prob, count: meta.count });
      }
      result.sort((a, b) => b.prob - a.prob);
      const limit = Number(analyzeOptions.limit);
      const limited = Number.isFinite(limit) && limit > 0 ? result.slice(0, limit) : result;
      return { ok: true, status: 'done', tags: limited, modelTags: limited, model: model.id, threshold, count: limited.length };
    } catch (error) {
      return { ok: false, status: 'error', tags: [], modelTags: [], error: `推理失败：${error && error.message || error}` };
    }
  }

  return {
    available,
    analyze,
    run: analyze,
    tags: () => tags().map(item => ({ ...item })),
    ensureSession,
    model: { ...model },
    modelsDir: dirs[0]
  };
}

module.exports = {
  SIZE,
  DEFAULT_MODEL,
  createVision,
  loadTagsFile,
  resizeRawPixels,
  toNchw
};
