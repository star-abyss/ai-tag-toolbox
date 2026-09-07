'use strict';

/**
 * 绘图候选结果的轻量数据层。
 *
 * 这里不调用 AI、ComfyUI 或页面，只记录“哪一轮生成了哪张图、实际用了
 * 哪组 Tag，以及当前选择了哪一张”。这样最终提示词可以始终和候选图绑定，
 * 不会因为最后一轮 AI 文本变化而漂移。
 */

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).trim();
  return result || fallback;
}

function clone(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    // Image bytes/data URLs belong to Images, not to the session result.
    if (key === 'bytes' || key === 'dataUrl') continue;
    output[key] = clone(item);
  }
  return output;
}

function tags(value) {
  const rows = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[,，\n]+/);
  return [...new Set(rows.map(item => text(item)).filter(Boolean))].slice(0, 256);
}

function normaliseCandidate(value = {}, index = 0) {
  const source = value && typeof value === 'object' ? value : {};
  const iteration = Math.max(1, Number(source.iteration) || index + 1);
  const id = text(source.id, `candidate-${iteration}`);
  const artifact = source.artifact && typeof source.artifact === 'object'
    ? clone(source.artifact)
    : null;
  const positiveTags = tags(source.positiveTags || source.prompt);
  const negativeTags = tags(source.negativeTags || source.negative);
  return {
    id,
    iteration,
    imageId: text(source.imageId || artifact?.id),
    prompt: text(source.prompt, positiveTags.join(', ')),
    negative: text(source.negative, negativeTags.join(', ')),
    positiveTags,
    negativeTags,
    parameters: source.parameters && typeof source.parameters === 'object' ? clone(source.parameters) : {},
    workflowProfileId: text(source.workflowProfileId),
    workflowRevision: text(source.workflowRevision),
    recreationMode: text(source.recreationMode),
    previewUrl: text(source.previewUrl),
    artifact,
    evaluation: source.evaluation && typeof source.evaluation === 'object'
      ? clone(source.evaluation)
      : { status: 'pending', summary: '', recommended: false },
    selected: source.selected === true,
    selectionSource: text(source.selectionSource),
    createdAt: Number(source.createdAt) || Date.now()
  };
}

function addCandidate(list, value) {
  const rows = Array.isArray(list) ? list.map((item, index) => normaliseCandidate(item, index)) : [];
  const candidate = normaliseCandidate(value, rows.length);
  const existing = rows.findIndex(item => item.id === candidate.id || (candidate.imageId && item.imageId === candidate.imageId));
  if (existing >= 0) rows[existing] = { ...rows[existing], ...candidate };
  else rows.push(candidate);
  return rows;
}

function markRecommended(list, candidateId) {
  const rows = Array.isArray(list) ? list.map((item, index) => normaliseCandidate(item, index)) : [];
  const id = text(candidateId);
  return rows.map(item => ({
    ...item,
    evaluation: { ...(item.evaluation || {}), recommended: Boolean(id && (item.id === id || item.imageId === id)) }
  }));
}

function evaluateCandidate(list, candidateId, summary, status = 'reviewed') {
  const rows = Array.isArray(list) ? list.map((item, index) => normaliseCandidate(item, index)) : [];
  const id = text(candidateId);
  const note = text(summary);
  return rows.map(item => item.id === id || item.imageId === id
    ? { ...item, evaluation: { ...(item.evaluation || {}), status: note ? status : (item.evaluation?.status || 'pending'), summary: note || item.evaluation?.summary || '' } }
    : item);
}

function setCandidateEvaluation(list, candidateId, evaluation = {}) {
  const rows = Array.isArray(list) ? list.map((item, index) => normaliseCandidate(item, index)) : [];
  const id = text(candidateId);
  return rows.map(item => item.id === id || item.imageId === id
    ? { ...item, evaluation: { ...clone(evaluation), status: text(evaluation.status, 'reviewed'), recommended: evaluation.recommended === true } }
    : item);
}

function recommendedId(value) {
  const match = String(value || '').match(/(?:【最佳候选】|\[best\s*candidate\]|<best_candidate>)\s*[:：]?\s*(candidate[-_]?\d+)/i);
  return match ? match[1].replace('_', '-') : '';
}

function stripRecommendation(value) {
  return String(value || '')
    .replace(/\s*(?:【最佳候选】|\[best\s*candidate\]|<best_candidate>)\s*[:：]?\s*candidate[-_]?\d+\s*(?:<\/best_candidate>)?\s*/ig, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function selectCandidate(list, candidateId, source = 'user') {
  const rows = Array.isArray(list) ? list.map((item, index) => normaliseCandidate(item, index)) : [];
  const id = text(candidateId);
  return rows.map(item => ({
    ...item,
    selected: Boolean(id && (item.id === id || item.imageId === id)),
    selectionSource: id && (item.id === id || item.imageId === id) ? text(source, 'user') : ''
  }));
}

function finalCandidate(list, selectedId = '') {
  const rows = Array.isArray(list) ? list.map((item, index) => normaliseCandidate(item, index)) : [];
  const explicit = rows.find(item => item.id === text(selectedId) || item.imageId === text(selectedId));
  const selected = explicit || rows.find(item => item.selected) || rows.find(item => item.evaluation?.recommended);
  if (!selected) return null;
  return {
    finalCandidateId: selected.id,
    finalImageId: selected.imageId,
    finalPrompt: selected.prompt,
    finalNegative: selected.negative,
    positiveTags: selected.positiveTags.slice(),
    negativeTags: selected.negativeTags.slice(),
    parameters: clone(selected.parameters),
    workflowProfileId: selected.workflowProfileId,
    workflowRevision: selected.workflowRevision,
    recreationMode: selected.recreationMode,
    selectionSource: text(selected.selectionSource, selected.evaluation?.recommended ? 'ai' : 'user')
  };
}

function snapshot(list) {
  return (Array.isArray(list) ? list : []).map((item, index) => {
    const candidate = normaliseCandidate(item, index);
    delete candidate.previewUrl;
    return candidate;
  });
}

module.exports = { normaliseCandidate, addCandidate, markRecommended, evaluateCandidate, setCandidateEvaluation, recommendedId, stripRecommendation, selectCandidate, finalCandidate, snapshot };
