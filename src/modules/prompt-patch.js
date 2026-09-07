'use strict';

const DEFAULT_ALLOWED_NEGATIONS = Object.freeze(['no humans']);
const CONFLICT_GROUPS = Object.freeze([
  ['from above', 'from below', 'eye level'],
  ['standing', 'sitting', 'lying'],
  ['looking at viewer', 'looking away']
]);

function text(value) { return value == null ? '' : String(value).trim(); }
function key(value) { return text(value).toLowerCase().replace(/[_\s]+/g, ' '); }
function values(value) {
  const rows = Array.isArray(value) ? value : value == null ? [] : String(value).split(/[,，、;；|\n]+/);
  const seen = new Set();
  return rows.map(text).filter(item => { const id = key(item); if (!id || seen.has(id)) return false; seen.add(id); return true; }).slice(0, 256);
}
function mapByKey(rows) { return new Map(values(rows).map(item => [key(item), item])); }
function negation(value, allowed) {
  const id = key(value);
  if (allowed.has(id)) return null;
  const match = id.match(/^(?:remove|delete|exclude|without|do not draw|do not|don't|not|no)\s+(.+)$/);
  return match ? match[1].trim() : null;
}
function alternativesFor(options, target) {
  const source = options.positiveAlternatives || {};
  return values(source[target] || source[key(target)]);
}
function semanticConflicts(rows) {
  const present = new Set(values(rows).map(key));
  const result = [];
  for (const group of CONFLICT_GROUPS) {
    const found = group.filter(item => present.has(key(item)));
    if (found.length > 1) result.push(found);
  }
  return result;
}

function applyPromptPatch(current = {}, patch = {}, options = {}) {
  const positive = mapByKey(current.positiveTags);
  const negative = mapByKey(current.negativeTags);
  const lockedTags = values(current.lockedTags);
  const locked = new Set(lockedTags.map(key));
  const preserve = new Set(values(patch.preserve || patch.preserveTags).map(key));
  const add = values(patch.add || patch.addTags);
  const remove = values(patch.remove || patch.removeTags);
  const negativeAdd = values(patch.negativeAdd || patch.addNegativeTags);
  const negativeRemove = values(patch.negativeRemove || patch.removeNegativeTags);
  const allowed = new Set([...DEFAULT_ALLOWED_NEGATIONS, ...values(options.allowedPositiveNegations)].map(key));
  const rejected = [];
  const warnings = [];

  const addKeys = new Set(add.map(key));
  for (const item of remove) {
    const id = key(item);
    if (addKeys.has(id)) rejected.push({ code: 'ADD_REMOVE_CONFLICT', tag: item, message: `同一补丁同时新增和删除 ${item}` });
  }

  for (const item of remove) {
    const id = key(item);
    if (!positive.has(id)) { warnings.push({ code: 'REMOVE_MISSING', tag: item, message: `待删除 Tag 不在当前提示词中：${item}` }); continue; }
    if (locked.has(id)) { warnings.push({ code: 'LOCKED_TAG', tag: item, message: `用户硬约束 Tag 不允许删除：${item}` }); continue; }
    if (preserve.has(id)) { warnings.push({ code: 'PATCH_PRESERVED', tag: item, message: `当前补丁要求保留 ${item}` }); continue; }
    positive.delete(id);
  }

  for (const item of add) {
    const target = negation(item, allowed);
    if (!target) { positive.set(key(item), item); continue; }
    if (options.negativeEnabled === true) {
      negative.set(key(target), target);
      warnings.push({ code: 'NEGATION_TO_NEGATIVE', tag: item, message: `已将正向否定命令转为负面 Tag：${target}` });
      continue;
    }
    const alternatives = alternativesFor(options, target);
    if (alternatives.length) {
      for (const alternative of alternatives) positive.set(key(alternative), alternative);
      warnings.push({ code: 'NEGATION_TO_POSITIVE_ALTERNATIVE', tag: item, message: `已用正向表达替代否定命令：${alternatives.join(', ')}` });
    } else rejected.push({ code: 'POSITIVE_NEGATION', tag: item, message: `正向提示词禁止自然语言否定命令：${item}` });
  }

  for (const item of negativeRemove) negative.delete(key(item));
  if (options.negativeEnabled === true) for (const item of negativeAdd) negative.set(key(item), item);

  const conflicts = semanticConflicts([...positive.values()]);
  for (const group of conflicts) rejected.push({ code: 'SEMANTIC_CONFLICT', tags: group, message: `提示词包含互斥 Tag：${group.join(' / ')}` });

  if (rejected.length) {
    return { ok: false, positiveTags: values(current.positiveTags), negativeTags: values(current.negativeTags), lockedTags, rejected, warnings };
  }
  return { ok: true, positiveTags: [...positive.values()], negativeTags: [...negative.values()], lockedTags, rejected, warnings };
}

module.exports = { DEFAULT_ALLOWED_NEGATIONS, CONFLICT_GROUPS, applyPromptPatch };

