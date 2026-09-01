'use strict';

/**
 * Images 业务模块。
 *
 * 这里只管理图片对象、顺序和少量 PNG 元数据。真正的 WD Tagger/视觉模型
 * 通过 analyze() 注入，不在这个模块里塞入 Electron 或模型实现。
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).trim();
  return result || fallback;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isObject(value)) {
    const output = {};
    for (const [key, item] of Object.entries(value)) output[key] = clone(item);
    return output;
  }
  return value;
}

function makeId(sequence, source = '') {
  let hash = 2166136261;
  const input = `${sequence}|${source}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `img_${(hash >>> 0).toString(36)}`;
}

function isBuffer(value) {
  return typeof Buffer !== 'undefined' && Buffer.isBuffer(value);
}

function bytesFrom(value) {
  if (isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  return null;
}

function dataUrlBytes(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) return null;
  const comma = value.indexOf(',');
  if (comma < 0) return null;
  const header = value.slice(5, comma);
  const payload = value.slice(comma + 1);
  if (header.toLowerCase().includes(';base64')) return Buffer.from(payload, 'base64');
  return Buffer.from(decodeURIComponent(payload), 'utf8');
}

function mimeFromDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) return '';
  const comma = value.indexOf(',');
  return comma < 0 ? '' : value.slice(5, comma).split(';')[0];
}

function dataUrlFromBytes(bytes, mime = 'image/png') {
  if (!bytes) return '';
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

function decodeChunkText(bytes, encoding = 'utf8') {
  try {
    return Buffer.from(bytes).toString(encoding).replace(/\u0000+$/g, '');
  } catch {
    return '';
  }
}

function parseTextChunk(data, output) {
  const separator = data.indexOf(0);
  if (separator < 0) return;
  const keyword = decodeChunkText(data.subarray(0, separator), 'latin1').trim();
  if (!keyword) return;
  output[keyword] = decodeChunkText(data.subarray(separator + 1), 'latin1');
}

function parseInternationalTextChunk(data, output) {
  let cursor = data.indexOf(0);
  if (cursor < 0) return;
  const keyword = decodeChunkText(data.subarray(0, cursor), 'utf8').trim();
  cursor += 1;
  if (cursor + 2 > data.length) return;
  const compressed = data[cursor] === 1;
  cursor += 2; // compression flag + method
  const languageEnd = data.indexOf(0, cursor);
  if (languageEnd < 0) return;
  cursor = languageEnd + 1;
  const translatedEnd = data.indexOf(0, cursor);
  if (translatedEnd < 0) return;
  cursor = translatedEnd + 1;
  let value = data.subarray(cursor);
  if (compressed) {
    try {
      // zlib is optional here; compressed iTXt is simply skipped when it is
      // unavailable, while ordinary PNG text remains usable.
      const zlib = require('node:zlib');
      value = zlib.inflateSync(value);
    } catch {
      return;
    }
  }
  if (keyword) output[keyword] = decodeChunkText(value, 'utf8');
}

function parseCompressedTextChunk(data, output) {
  const separator = data.indexOf(0);
  if (separator < 0) return;
  const keyword = decodeChunkText(data.subarray(0, separator), 'latin1').trim();
  try {
    const zlib = require('node:zlib');
    output[keyword] = zlib.inflateSync(data.subarray(separator + 2)).toString('latin1');
  } catch {
    // zTXt is uncommon in generated images; leave it out if it cannot decode.
  }
}

function promptToTags(value) {
  const output = [];
  let buffer = '';
  let depth = 0;
  let quote = false;
  const push = raw => {
    let item = text(raw).replace(/^[-+*]\s*/, '').replace(/<lora:([^:>]+)(?::[^>]*)?>/gi, '$1');
    item = item.replace(/^[([{]+|[)\]}]+$/g, '').replace(/:\s*[-+]?\d+(?:\.\d+)?\s*$/, '').trim();
    if (item && !output.includes(item) && item.length < 180 && !/^BREAK$|^AND$/i.test(item)) output.push(item);
  };
  for (const char of String(value || '')) {
    if (char === '"') quote = !quote;
    if (!quote && '([{'.includes(char)) depth += 1;
    if (!quote && ')]}'.includes(char)) depth = Math.max(0, depth - 1);
    if (!quote && char === ',' && depth === 0) { push(buffer); buffer = ''; } else buffer += char;
  }
  push(buffer);
  return output;
}

function workflowPromptText(value) {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return { prompt: parsed, negative: '' }; }
  }
  if (!parsed || typeof parsed !== 'object') return { prompt: '', negative: '' };
  if (typeof parsed.prompt === 'string' || typeof parsed.uc === 'string') return { prompt: text(parsed.prompt || parsed.description), negative: text(parsed.uc || parsed.negative_prompt || parsed.negativePrompt) };
  const negativeIds = new Set();
  for (const node of Object.values(parsed)) {
    const inputs = node?.inputs || {};
    for (const key of ['negative', 'negative_prompt']) if (Array.isArray(inputs[key])) negativeIds.add(String(inputs[key][0]));
  }
  const positive = [];
  const negative = [];
  for (const [id, node] of Object.entries(parsed)) {
    if (!/CLIPTextEncode/i.test(String(node?.class_type || ''))) continue;
    const valueText = node?.inputs?.text;
    if (typeof valueText !== 'string') continue;
    const title = String(node?._meta?.title || '').toLowerCase();
    if (negativeIds.has(String(id)) || /negative|负面/.test(title)) negative.push(valueText); else positive.push(valueText);
  }
  return { prompt: positive.join(', '), negative: negative.join(', ') };
}

/**
 * Read PNG tEXt/iTXt/zTXt chunks. Missing metadata is a normal result.
 * The return value intentionally keeps the raw text map for callers that need
 * a format-specific field later.
 */
function parsePngMetadata(input) {
  const bytes = bytesFrom(input) || dataUrlBytes(input);
  const empty = { format: 'unknown', text: {}, prompt: '', workflow: '', parameters: '', hasPrompt: false, builtinTags: [], builtinNegativeTags: [] };
  if (!bytes || bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return empty;

  const output = { format: 'png', text: {}, prompt: '', workflow: '', parameters: '', hasPrompt: false, builtinTags: [], builtinNegativeTags: [] };
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) break;
    const data = bytes.subarray(start, end);
    if (type === 'tEXt') parseTextChunk(data, output.text);
    else if (type === 'iTXt') parseInternationalTextChunk(data, output.text);
    else if (type === 'zTXt') parseCompressedTextChunk(data, output.text);
    offset = end + 4;
    if (type === 'IEND') break;
  }

  const textMap = output.text;
  output.parameters = text(textMap.parameters || textMap.Parameters);
  output.prompt = text(textMap.prompt || textMap.Prompt || textMap.description || textMap.Description);
  output.workflow = text(textMap.workflow || textMap.Workflow);
  // A1111/Forge commonly puts the complete prompt in `parameters`; NovelAI
  // often stores a JSON object in Comment/Description. Keep both the raw map
  // and a few normalized fields so callers do not need format-specific code.
  if (!output.parameters) output.parameters = text(textMap.comment || textMap.Comment);
  const jsonCandidates = [output.prompt, output.parameters, textMap.comment, textMap.Comment, textMap.description, textMap.Description];
  for (const candidate of jsonCandidates) {
    if (!candidate || typeof candidate !== 'string' || !/^[\[{]/.test(candidate.trim())) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (!output.promptJson && parsed && typeof parsed === 'object') output.promptJson = parsed;
      if (parsed && typeof parsed === 'object') {
        const positive = parsed.prompt || parsed.description || parsed.input?.prompt;
        const negative = parsed.uc || parsed.negative_prompt || parsed.negativePrompt || parsed.input?.negative;
        if (!output.prompt && typeof positive === 'string') output.prompt = positive;
        if (!output.negativePrompt && typeof negative === 'string') output.negativePrompt = negative;
      }
    } catch { /* ordinary A1111 text is not JSON */ }
  }
  const negativeLine = output.parameters.match(/(?:^|\n)\s*(?:Negative prompt|负面提示词)\s*[:：]\s*([\s\S]*)/i);
  if (!output.negativePrompt && negativeLine) output.negativePrompt = text(negativeLine[1]).split(/\n\s*(?:Steps|采样步数)\s*:/i)[0];
  if (!output.prompt && output.parameters) output.prompt = text(output.parameters.split(/\n\s*(?:Negative prompt|负面提示词)\s*[:：]/i)[0]);
  output.hasPrompt = Boolean(output.parameters || output.prompt || output.workflow || output.negativePrompt);

  // ComfyUI stores JSON in prompt/workflow fields. Keep parsed copies when
  // possible, without requiring callers to know which exporter wrote it.
  for (const key of ['prompt', 'workflow']) {
    const value = output[key];
    if (!value) continue;
    try { output[`${key}Json`] = JSON.parse(value); } catch { /* plain text is fine */ }
  }
  const workflowText = workflowPromptText(output.promptJson || output.workflowJson || output.prompt);
  const positiveText = text(output.prompt && !/^\s*[\[{]/.test(output.prompt) ? output.prompt : workflowText.prompt);
  const negativeText = text(output.negativePrompt || workflowText.negative);
  output.promptText = positiveText;
  output.negativePrompt = negativeText;
  output.builtinTags = promptToTags(positiveText).map(tag => ({ tag, name: tag, origin: 'metadata', category: 'metadata', categoryCode: 0, prob: 1, probability: 1 }));
  output.builtinNegativeTags = promptToTags(negativeText).map(tag => ({ tag, name: tag, origin: 'metadata', category: 'metadata', categoryCode: 0, prob: 1, probability: 1 }));
  return output;
}

function normaliseInput(input, meta = {}, sequence = 1) {
  const source = typeof input === 'string' ? { dataUrl: input } : (isObject(input) ? input : {});
  const rawBytes = bytesFrom(source.bytes || source.buffer || source.data) || dataUrlBytes(source.dataUrl || source.url);
  const mime = text(source.mime || source.type || mimeFromDataUrl(source.dataUrl || source.url), 'image/*');
  const dataUrl = text(source.dataUrl || source.url) || dataUrlFromBytes(rawBytes, mime === 'image/*' ? 'image/png' : mime);
  const filename = text(source.filename || source.fileName || meta.filename || meta.fileName);
  const id = text(source.id || source.imageId, makeId(sequence, `${filename}|${dataUrl.slice(0, 96)}`));
  return {
    id,
    dataUrl,
    thumbnailDataUrl: text(source.thumbnailDataUrl || source.thumbnail || meta.thumbnailDataUrl),
    filename,
    name: filename,
    mime,
    source: text(source.source || meta.source, 'unknown'),
    width: Number.isFinite(Number(source.width)) ? Math.max(0, Number(source.width)) : 0,
    height: Number.isFinite(Number(source.height)) ? Math.max(0, Number(source.height)) : 0,
    bytes: rawBytes,
    metadata: source.metadata ? clone(source.metadata) : null,
    analysis: source.analysis ? clone(source.analysis) : null,
    status: text(source.status, 'ready'),
    blobId: text(source.blobId),
    createdAt: source.createdAt || new Date().toISOString()
  };
}

function publicImage(item) {
  if (!item) return null;
  const output = { ...item };
  // Buffer is an implementation detail; the UI can use dataUrl or ask for it
  // through getBytes().
  delete output.bytes;
  return clone(output);
}

function createImages(options = {}) {
  const items = new Map();
  const collections = new Map();
  const analysisCache = new Map();
  let sequence = 0;
  let analyzer = typeof options.analyzer === 'function' ? options.analyzer : (typeof options.vision === 'function' ? options.vision : null);
  const blobStore = options.storage && typeof options.storage.putBlob === 'function' ? options.storage : null;
  const imageDir = options.imageDir ? require('node:path').resolve(String(options.imageDir)) : '';
  const indexStorage = options.storage && typeof options.storage.get === 'function' && typeof options.storage.set === 'function' ? options.storage : null;

  function indexValue() {
    return [...items.values()].map(item => ({
      id: item.id, filename: item.filename, name: item.name, mime: item.mime, source: item.source,
      width: item.width, height: item.height, metadata: clone(item.metadata), analysis: clone(item.analysis),
      status: item.status, blobId: item.blobId, createdAt: item.createdAt,
      collections: [...collections.entries()].filter(([, set]) => set.has(item.id)).map(([name]) => name),
      dataUrl: item.bytes ? '' : item.dataUrl,
      thumbnailDataUrl: item.thumbnailDataUrl || ''
    }));
  }
  function persistIndex() {
    try { indexStorage?.set?.('images_index', indexValue()); } catch { /* 图片索引只是辅助恢复 */ }
  }
  function filePath(id) { return imageDir ? require('node:path').join(imageDir, `${id}.bin`) : ''; }
  function persistBytes(item) {
    if (!imageDir || !item?.bytes) return;
    try { fs.mkdirSync(imageDir, { recursive: true }); fs.writeFileSync(filePath(item.id), item.bytes); } catch { /* 保留内存图片 */ }
  }
  function restorePersisted() {
    let rows = [];
    try { rows = indexStorage?.get?.('images_index', []) || []; } catch { rows = []; }
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!row || !row.id) continue;
      let bytes = null;
      try { if (imageDir && fs.existsSync(filePath(row.id))) bytes = fs.readFileSync(filePath(row.id)); } catch { bytes = null; }
      const item = normaliseInput({ ...row, bytes: bytes || undefined, dataUrl: bytes ? dataUrlFromBytes(bytes, row.mime || 'image/png') : row.dataUrl, thumbnailDataUrl: row.thumbnailDataUrl }, {}, ++sequence);
      item.id = String(row.id); item.metadata = row.metadata ? clone(row.metadata) : (bytes ? parsePngMetadata(bytes) : null); item.analysis = row.analysis ? clone(row.analysis) : null; item.status = text(row.status, 'ready'); item.blobId = text(row.blobId);
      items.set(item.id, item);
      if (item.analysis) analysisCache.set(item.id, new Map([['default', clone(item.analysis)]]));
      for (const name of Array.isArray(row.collections) ? row.collections : []) collectionSet(name).add(item.id);
    }
  }

  function add(input, meta = {}) {
    const item = normaliseInput(input, meta, ++sequence);
    if (!item.metadata && item.bytes) item.metadata = parsePngMetadata(item.bytes);
    if (!item.blobId && item.bytes && blobStore) {
      item.blobId = `image:${item.id}`;
      try { Promise.resolve(blobStore.putBlob(item.blobId, item.bytes, { type: item.mime, name: item.filename })).catch(() => {}); } catch { /* optional persistence */ }
    }
    persistBytes(item);
    items.set(item.id, item);
    const bucket = text(meta.collection || meta.bucket || sourceCollection(input));
    if (bucket) addTo(bucket, item.id);
    persistIndex();
    return publicImage(item);
  }

  function sourceCollection(input) {
    return isObject(input) ? text(input.collection || input.bucket) : '';
  }
  function collectionSet(name) {
    const key = text(name, 'default');
    if (!collections.has(key)) collections.set(key, new Set());
    return collections.get(key);
  }
  function addTo(name, value) {
    const item = typeof value === 'string' ? items.get(value) : value;
    const id = item && item.id ? item.id : (typeof value === 'string' ? value : '');
    if (!id || !items.has(id)) return false;
    collectionSet(name).add(id); persistIndex(); return publicImage(items.get(id));
  }
  function removeFrom(name, value) {
    const set = collections.get(text(name, 'default')); if (!set) return false;
    const id = typeof value === 'string' ? value : value && value.id; const changed = Boolean(id && set.delete(id)); if (changed) persistIndex(); return changed;
  }
  function collection(name = 'default') {
    const key = text(name, 'default');
    return {
      name: key,
      add: value => {
        const id = typeof value === 'string' ? value : value && value.id;
        if (id && items.has(id)) return addTo(key, id);
        return add(value, { collection: key });
      },
      remove: value => removeFrom(key, value),
      clear: () => { collectionSet(key).clear(); persistIndex(); return []; },
      ids: () => [...collectionSet(key)],
      list: () => [...collectionSet(key)].map(id => publicImage(items.get(id))).filter(Boolean),
      snapshot: () => ({ name: key, ids: [...collectionSet(key)] })
    };
  }

  async function addFile(filePath, meta = {}) {
    const bytes = await fsp.readFile(filePath);
    return add({ bytes, filename: meta.filename || String(filePath).split(/[\\/]/).pop(), mime: meta.mime || 'image/png', source: meta.source || 'file' }, meta);
  }

  async function addBlob(blob, meta = {}) {
    if (!blob || typeof blob.arrayBuffer !== 'function') return null;
    const bytes = Buffer.from(await blob.arrayBuffer());
    return add({ bytes, filename: meta.filename || blob.name, mime: meta.mime || blob.type || 'image/*', source: meta.source || 'blob' }, meta);
  }

  function get(value) {
    const id = typeof value === 'string' ? value : value && value.id;
    return publicImage(id ? items.get(id) : null);
  }

  // Return a UI-ready copy only when a caller explicitly needs to display the
  // image. Normal get()/list() keep byte-backed images lightweight across the
  // preload bridge; candidate cards and previews can opt in here.
  function preview(value) {
    const id = typeof value === 'string' ? value : value && value.id;
    const item = id ? items.get(id) : null;
    if (!item) return null;
    const output = publicImage(item);
    if (!output.dataUrl && item.bytes) output.dataUrl = dataUrlFromBytes(item.bytes, item.mime || 'image/png');
    return output;
  }

  function getBytes(value) {
    const id = typeof value === 'string' ? value : value && value.id;
    const item = id ? items.get(id) : null;
    return item && item.bytes ? Buffer.from(item.bytes) : null;
  }

  function list() {
    return [...items.values()].map(publicImage);
  }

  function update(value, patch = {}) {
    const id = typeof value === 'string' ? value : value && value.id;
    const item = id ? items.get(id) : null;
    if (!item) return null;
    Object.assign(item, clone(patch));
    analysisCache.delete(id);
    persistIndex();
    return publicImage(item);
  }

  function remove(value) {
    const id = typeof value === 'string' ? value : value && value.id;
    if (!id) return false;
    collections.forEach(set => set.delete(id));
    try { if (imageDir && fs.existsSync(filePath(id))) fs.unlinkSync(filePath(id)); } catch { /* ignore stale file */ }
    const removed = items.delete(id); analysisCache.delete(id); if (removed) persistIndex(); return removed;
  }

  function clear() {
    for (const id of items.keys()) { try { if (imageDir && fs.existsSync(filePath(id))) fs.unlinkSync(filePath(id)); } catch { /* ignore */ } }
    items.clear(); collections.forEach(set => set.clear()); analysisCache.clear(); persistIndex();
    return [];
  }

  function metadata(value) {
    const id = typeof value === 'string' ? value : value && value.id;
    const item = id ? items.get(id) : null;
    if (!item) return null;
    if (!item.metadata) item.metadata = parsePngMetadata(item.bytes || item.dataUrl);
    return clone(item.metadata);
  }

  function setAnalyzer(next) {
    analyzer = typeof next === 'function' ? next : null;
    return analyzer;
  }

  async function analyze(value, analyzeOptions = {}) {
    const id = typeof value === 'string' ? value : value && value.id;
    const item = id ? items.get(id) : null;
    if (!item) return null;
    const key = JSON.stringify({
      model: text(analyzeOptions.model || analyzeOptions.modelId),
      threshold: analyzeOptions.threshold == null ? '' : Number(analyzeOptions.threshold),
      limit: analyzeOptions.limit == null ? '' : Number(analyzeOptions.limit)
    });
    const defaultKey = JSON.stringify({ model: '', threshold: '', limit: '' });
    const cached = analysisCache.get(id)?.get(key) || (key === defaultKey ? analysisCache.get(id)?.get('default') : null);
    if (cached && analyzeOptions.force !== true) {
      item.analysis = clone(cached);
      return publicImage(item);
    }
    if (!analyzer) {
      item.analysis = { status: 'unavailable', tags: [], builtinTags: [], modelTags: [], error: '识图服务未接入' };
      if (!analysisCache.has(id)) analysisCache.set(id, new Map());
      analysisCache.get(id).set(key, clone(item.analysis));
      return publicImage(item);
    }
    try {
      const result = await analyzer(publicImage(item), analyzeOptions);
      item.analysis = result && typeof result === 'object' ? clone(result) : { status: 'done', tags: result || [] };
    } catch (error) {
      item.analysis = { status: 'error', tags: [], builtinTags: [], modelTags: [], error: text(error && error.message, String(error || '识图失败')) };
    }
    if (!analysisCache.has(id)) analysisCache.set(id, new Map());
    analysisCache.get(id).set(key, clone(item.analysis));
    persistIndex();
    return publicImage(item);
  }

  async function getBlob(value) {
    const id = typeof value === 'string' ? value : value && value.id;
    const item = id ? items.get(id) : null;
    if (item?.bytes) return Buffer.from(item.bytes);
    if (item?.blobId && blobStore && typeof blobStore.getBlob === 'function') {
      try { return await blobStore.getBlob(item.blobId); } catch { return null; }
    }
    return null;
  }

  function reference(value, index) {
    const id = typeof value === 'string' ? value : value && value.id;
    if (!id || !items.has(id)) return '';
    const ids = [...items.keys()];
    const position = Number.isInteger(index) ? index : ids.indexOf(id);
    return `图片${position + 1}`;
  }

  function buildReference(values) {
    const ids = Array.isArray(values) ? values : [values];
    return ids.map((value, index) => {
      const id = typeof value === 'string' ? value : value && value.id;
      const item = id ? items.get(id) : null;
      return { id: id || '', index: index + 1, label: `图片${index + 1}`, filename: item?.filename || '', exists: Boolean(item) };
    });
  }

  restorePersisted();
  const api = {
    add,
    addMany: inputs => (Array.isArray(inputs) ? inputs.map(item => add(item)) : []),
    addFile,
    addBlob,
    get,
    preview,
    getBytes,
    getBlob,
    list,
    update,
    remove,
    delete: remove,
    clear,
    collection,
    addTo,
    removeFrom,
    collectionIds: name => [...collectionSet(name)],
    collectionList: name => [...collectionSet(name)].map(id => publicImage(items.get(id))).filter(Boolean),
    clearCollection: name => { collectionSet(name).clear(); return []; },
    collections: () => [...collections.keys()],
    snapshot: () => ({ size: items.size, items: list(), collections: Object.fromEntries([...collections.entries()].map(([name, set]) => [name, [...set]])) }),
    metadata,
    readMetadata: metadata,
    setAnalyzer,
    analyze,
    analyzeImage: analyze,
    reference,
    buildReference,
    size: () => items.size
  };

  return api;
}

module.exports = {
  createImages,
  parsePngMetadata,
  promptToTags,
  workflowPromptText,
  dataUrlFromBytes,
  normaliseInput
};
