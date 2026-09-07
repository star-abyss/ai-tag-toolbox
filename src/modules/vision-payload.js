'use strict';

const BLUEPRINT_FIELDS = Object.freeze(['people', 'characters', 'appearance', 'pose', 'viewpoint', 'composition', 'clothing', 'scene', 'lighting', 'style', 'mustPreserve']);

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value, fallback = '') { const result = value == null ? '' : String(value).trim(); return result || fallback; }
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (object(value)) return Object.fromEntries(Object.entries(value).filter(([key, item]) => !['metadata', 'workflow', 'bytes', 'dataUrl', 'reasoning', 'analysis'].includes(key) && typeof item !== 'function').map(([key, item]) => [key, clone(item)]));
  return value;
}
function tagText(value) { return text(object(value) ? value.tag || value.en || value.name : value); }
function list(value, limit = 256) {
  const rows = Array.isArray(value) ? value : value == null || value === '' ? [] : String(value).split(/[,，、;；|\n]+/);
  return [...new Set(rows.map(tagText).filter(Boolean))].slice(0, limit);
}
function responseText(value) {
  if (typeof value === 'string') return value.trim();
  if (!object(value)) return '';
  if (value.ok === true && Object.prototype.hasOwnProperty.call(value, 'data')) return responseText(value.data);
  if (typeof value.text === 'string') return value.text.trim();
  const content = value.choices?.[0]?.message?.content ?? value.output_text ?? value.content;
  return Array.isArray(content) ? content.map(responseText).join('') : text(content);
}
function parseJsonText(value) {
  const source = text(value).replace(/^\s*```(?:json)?\s*|\s*```\s*$/gi, '').trim();
  if (!source || !/^[{[]/.test(source)) return null;
  try { const parsed = JSON.parse(source); return object(parsed) ? parsed : null; } catch { return null; }
}
function parseVisionPayload(value) {
  const unwrapped = value?.ok === true && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value;
  let source = object(unwrapped) ? clone(unwrapped) : {};
  const raw = responseText(unwrapped);
  const parsed = parseJsonText(raw);
  if (parsed) source = { ...source, ...clone(parsed) };
  const nested = parseJsonText(source.description);
  if (nested) source = { ...source, ...clone(nested) };
  const description = text(source.description || source.summary || (!parsed && raw ? raw : '')).slice(0, 12000);
  const result = { description, tags: list(source.tags || source.modelTags), parseMode: source.parseMode === 'json' || parsed || nested ? 'json' : 'text' };
  for (const key of BLUEPRINT_FIELDS) {
    if (source[key] === undefined) continue;
    result[key] = Array.isArray(source[key]) ? list(source[key], 64) : text(source[key]).slice(0, 3000);
  }
  return result;
}
function compactVisionResult(value) {
  const source = value?.ok === true && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value;
  const parsed = parseVisionPayload(source);
  const builtinTags = list(source?.builtinTags || source?.metadata?.builtinTags);
  return {
    imageId: text(source?.imageId),
    mode: text(source?.mode),
    model: text(source?.model),
    description: parsed.description,
    tags: parsed.tags,
    builtinTags,
    hasBuiltinTags: builtinTags.length > 0
  };
}

module.exports = { BLUEPRINT_FIELDS, parseVisionPayload, compactVisionResult };
