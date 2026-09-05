'use strict';

const { callTable, getCallDefinition } = require('./call-table');

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value, fallback = '') { const result = value == null ? '' : String(value).trim(); return result || fallback; }
function clone(value) { if (Array.isArray(value)) return value.map(clone); if (object(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])); return value; }
function short(value, max = 160) { return text(value).slice(0, max); }

function parseObject(raw) {
  try { const parsed = JSON.parse(raw); return object(parsed) ? parsed : null; } catch { return null; }
}

function adaptLegacyCall(value) {
  if (Array.isArray(value)) return adaptLegacyCall(value[0] || {});
  if (!object(value)) return value;
  if (value.tool_calls) {
    const first = Array.isArray(value.tool_calls) ? value.tool_calls[0] : value.tool_calls;
    return adaptLegacyCall(first || {});
  }
  const fn = value.function || value.function_call || value.functionCall || (value.name && Object.prototype.hasOwnProperty.call(value, 'arguments') ? value : null);
  if (!fn) return value;
  let args = fn.arguments ?? fn.args ?? fn.input ?? fn.parameters ?? {};
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
  const name = fn.name || value.name || value.tool || value.call;
  const output = { ...(object(args) ? args : {}), call: name };
  if (/vision(?:[._-]processone)?$/i.test(String(name)) && output.image == null) output.image = output.imageId || output.tempId;
  if (/conversation[._-]?images[._-]?settitle/i.test(String(name)) && output.image == null) output.image = output.imageId || output.refId;
  return output;
}

function extractAssistantCalls(value) {
  const source = String(value || '');
  const calls = []; const errors = []; const ranges = [];
  const parsePayload = raw => {
    try { return JSON.parse(String(raw || '').trim()); } catch { return null; }
  };
  const marker = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let markerMatch;
  while ((markerMatch = marker.exec(source))) {
    const parsed = parseObject(markerMatch[1].trim());
    const adapted = adaptLegacyCall(parsed || {});
    if (adapted && adapted.call) calls.push(adapted); else errors.push('JSON 调用格式无效');
    ranges.push([markerMatch.index, marker.lastIndex]);
  }
  // Several native gateways emit one of these complete marker pairs instead
  // of the original <tool_call> spelling. Parse the payload through the same
  // legacy adapter, then remove the whole marker from user-visible text.
  const compatibilityMarkers = [
    /<function[_ -]?call\b[^>]*>\s*([\s\S]*?)\s*<\/\s*function[_ -]?call\s*>/gi,
    /<\|tool[_ -]?call\|>\s*([\s\S]*?)\s*<\|end[_ -]?tool[_ -]?call\|>/gi,
    /<｜tool▁call▁begin｜>\s*([\s\S]*?)\s*<｜tool▁call▁end｜>/g
  ];
  for (const pattern of compatibilityMarkers) {
    let match;
    while ((match = pattern.exec(source))) {
      const parsed = parsePayload(match[1]);
      const adapted = adaptLegacyCall(parsed);
      if (adapted && adapted.call) calls.push(adapted); else errors.push('JSON 调用格式无效');
      ranges.push([match.index, pattern.lastIndex]);
    }
  }
  const fence = /```json\s*\r?\n([\s\S]*?)\r?\n```/gi;
  let match;
  while ((match = fence.exec(source))) {
    const parsed = parseObject(match[1].trim());
    if (parsed && parsed.call != null) calls.push(parsed); else errors.push('JSON 调用格式无效');
    ranges.push([match.index, fence.lastIndex]);
  }
  // A provider can stop mid-marker or mid-fence. Treat the unfinished tail as
  // protocol data, remove it from visible text, and report a hard parse error
  // instead of letting the runner finish with an apparently empty success.
  const fenceOpen = /```json\b/gi;
  let fenceOpenMatch;
  while ((fenceOpenMatch = fenceOpen.exec(source))) {
    const closeIndex = source.indexOf('```', fenceOpen.lastIndex);
    if (closeIndex >= 0) continue;
    errors.push('JSON 调用格式无效');
    ranges.push([fenceOpenMatch.index, source.length]);
    break;
  }
  const markerOpens = /<(?:tool[_ -]?call|function[_ -]?call)\b[^>]*>/gi;
  let markerOpen;
  while ((markerOpen = markerOpens.exec(source))) {
    if (/<\/\s*(?:tool[_ -]?call|function[_ -]?call)\s*>/i.test(source.slice(markerOpen.index))) continue;
    errors.push('JSON 调用格式无效');
    ranges.push([markerOpen.index, source.length]);
    break;
  }
  const pipeMarkerOpens = /<\|tool[_ -]?call\|>/gi;
  let pipeMarkerOpen;
  while ((pipeMarkerOpen = pipeMarkerOpens.exec(source))) {
    if (/<\|end[_ -]?tool[_ -]?call\|>/i.test(source.slice(pipeMarkerOpen.index))) continue;
    errors.push('JSON 调用格式无效');
    ranges.push([pipeMarkerOpen.index, source.length]);
    break;
  }
  const chatMlOpen = /<｜tool▁call▁begin｜>/g;
  let chatMlMatch;
  while ((chatMlMatch = chatMlOpen.exec(source))) {
    if (source.indexOf('<｜tool▁call▁end｜>', chatMlOpen.lastIndex) >= 0) continue;
    errors.push('JSON 调用格式无效');
    ranges.push([chatMlMatch.index, source.length]);
    break;
  }
  const lines = source.split(/\r?\n/); let offset = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{') && trimmed.includes('"call"') && !ranges.some(([a, b]) => offset >= a && offset < b)) {
      const parsed = parseObject(trimmed);
      if (parsed && parsed.call != null && trimmed.endsWith('}')) { calls.push(parsed); ranges.push([offset, offset + line.length]); }
      else { errors.push('JSON 调用格式无效'); ranges.push([offset, offset + line.length]); }
    }
    offset += line.length + 1;
  }
  if (calls.length > 1) { errors.push('每轮只允许一个调用'); calls.splice(1); }
  let visibleText = source;
  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0])) visibleText = visibleText.slice(0, start) + visibleText.slice(end);
  return { visibleText: visibleText.replace(/\n{3,}/g, '\n\n').trim(), calls, errors };
}

function imageRows(context = {}) {
  const repo = context.imageRepository || context.repository;
  const listed = repo?.listConversation?.(context.sessionId, { includePending: true }) || { items: [] };
  return Array.isArray(listed) ? listed : (listed.items || []);
}

function galleryRows(context = {}) {
  const repo = context.imageRepository || context.repository;
  const listed = repo?.listGallery?.({ order: 'oldest' }) || { items: [] };
  return Array.isArray(listed) ? listed : (listed.items || []);
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeManifestText(value, max = 80) {
  return short(String(value || '')
    .replace(/data:[^\s,)]+/gi, '[image]')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s,)]+/g, '[path]')
    .replace(/https?:\/\/[^\s,)]+/gi, '[url]'), max);
}

function rowLabel(row) {
  const slot = Number(row?.slotNo);
  return Number.isInteger(slot) && slot > 0 ? `图${slot}` : '图片';
}

function quotedMention(source, label) {
  const escaped = escapeRegExp(label);
  return new RegExp(`["'“‘「『]\\s*${escaped}\\s*["'”’」』]`, 'iu').test(source);
}

function boundaryMention(source, label) {
  const escaped = escapeRegExp(label);
  // Treat letters/numbers/CJK as word characters on both sides. This avoids
  // matching a short title such as "cat" inside "concatenate".
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(source);
}

function titleMention(source, label) {
  const value = text(label);
  if (!value) return false;
  if (quotedMention(source, value)) return true;
  // Very short/common labels must be explicitly quoted. Longer labels still
  // require complete token boundaries instead of an arbitrary substring.
  if ([...value].length < 4) return false;
  if ([...value].length <= 5 && !/(?:看|查看|识图|识别|分析|参考|这张|该图|图片|inspect|look\s+at|image|picture)/iu.test(source)) return false;
  return boundaryMention(source, value);
}

function safeManifestItem(item) {
  const output = {
    label: rowLabel(item),
    title: safeManifestText(item?.displayTitle || item?.displayName),
    source: safeManifestText(item?.source),
    pending: item?.pending === true,
    final: item?.final === true
  };
  const candidateId = safeManifestText(item?.candidateId);
  if (candidateId) output.candidateId = candidateId;
  // Keep an internal, non-enumerable alias for trusted in-process adapters and
  // older fixture callers. JSON serialization (the AI-facing boundary) cannot
  // observe these properties.
  for (const key of ['refId', 'imageId', 'slotNo']) {
    if (item?.[key] == null) continue;
    Object.defineProperty(output, key, { value: item[key], enumerable: false, configurable: false, writable: false });
  }
  return output;
}

function resolveImage(value, context = {}) {
  const requested = object(value) ? value : { image: value };
  const rows = imageRows(context).filter(item => item && item.sessionId && context.sessionId && item.sessionId === context.sessionId);
  const wanted = text(requested.refId || requested.imageId || requested.slotNo || requested.candidateId || requested.title || requested.image);
  const slotWanted = wanted.match(/^(?:图片|图|image)\s*(\d+)$/i)?.[1] || wanted;
  const temp = context.visionTempStore?.current?.() || context.tempStore?.current?.();
  if (!wanted) {
    if (temp?.kind === 'external-temp') return { kind: 'temp', tempId: temp.tempId, assetRevision: temp.createdAt || temp.requestId, label: safeManifestText(temp.filename || '临时图') };
    if (temp?.kind && (temp.imageId || temp.tempId)) return { kind: temp.kind, imageId: temp.imageId, refId: temp.refId, tempId: temp.tempId, assetRevision: temp.createdAt || temp.updatedAt || temp.requestId, label: safeManifestText(temp.filename || temp.displayTitle || '临时图') };
    return { error: '缺少图片引用' };
  }
  if (/^(?:data:|https?:\/\/|file:|[A-Za-z]:[\\/]|[\\/])/.test(wanted)) return { error: '图片引用必须使用当前会话编号' };
  if (['临时图', 'current', 'vision_current'].includes(wanted)) {
    if (!temp?.kind) return { error: '当前没有活动临时图' };
    if (temp.kind === 'external-temp') return { kind: 'temp', tempId: temp.tempId, assetRevision: temp.createdAt || temp.requestId, label: safeManifestText(temp.filename || '临时图') };
    return { kind: temp.kind, imageId: temp.imageId, refId: temp.refId, tempId: temp.tempId, assetRevision: temp.createdAt || temp.updatedAt || temp.requestId, label: safeManifestText(temp.filename || temp.displayTitle || '临时图') };
  }
  const explicitKey = ['refId', 'imageId', 'slotNo', 'candidateId'].find(key => Object.prototype.hasOwnProperty.call(requested, key));
  const keys = explicitKey ? [explicitKey] : ['refId', 'imageId', 'slotNo', 'candidateId'];
  let matches = [];
  for (const key of keys) {
    matches = rows.filter(item => String(item[key] ?? '').toLowerCase() === slotWanted.toLowerCase());
    if (matches.length) break;
  }
  if (!matches.length) matches = rows.filter(item => [item.displayTitle, item.displayName].filter(Boolean).some(label => String(label).toLowerCase() === wanted.toLowerCase()));
  if (matches.length > 1) return { error: `图片引用不唯一：${matches.map(item => text(item.displayTitle || item.displayName || item.imageId)).slice(0, 4).join('、')}` };
  if (matches.length) return { kind: 'conversation', refId: matches[0].refId, imageId: matches[0].imageId, slotNo: matches[0].slotNo, candidateId: matches[0].candidateId, assetRevision: matches[0].updatedAt || matches[0].revision || matches[0].version || matches[0].createdAt, label: safeManifestText(matches[0].displayTitle || matches[0].displayName || rowLabel(matches[0])) };
  if (temp?.kind && [temp.tempId, temp.imageId, temp.refId].filter(Boolean).map(String).some(item => item.toLowerCase() === wanted.toLowerCase())) {
    return temp.kind === 'external-temp'
      ? { kind: 'temp', tempId: temp.tempId, assetRevision: temp.createdAt || temp.requestId, label: safeManifestText(temp.filename || '临时图') }
      : { kind: temp.kind, imageId: temp.imageId, refId: temp.refId, tempId: temp.tempId, assetRevision: temp.createdAt || temp.updatedAt || temp.requestId, label: safeManifestText(temp.filename || temp.displayTitle || '临时图') };
  }
  return { error: '图片不在当前会话中' };
}

function normaliseCall(call, context = {}) {
  call = adaptLegacyCall(call);
  if (!object(call)) return { ok: false, code: 'INVALID_CALL', error: '调用必须是 JSON 对象' };
  const definition = getCallDefinition(call.call || call.name || call.tool);
  if (!definition) return { ok: false, code: 'UNKNOWN_CALL', error: '未知调用' };
  const used = Number(context.callCounts?.[definition.name] || context.callsUsed?.[definition.name] || 0);
  if (used >= definition.maxPerRound) return { ok: false, code: 'CALL_LIMIT', error: `本轮 ${definition.name} 调用次数已达上限` };
  const variables = {};
  const defaults = { ...definition.defaults };
  if (definition.name === 'render' && context.settings?.comfyIters != null) defaults.iterations = Number(context.settings.comfyIters);
  for (const [key, spec] of Object.entries(definition.aiInput)) {
    let value = call[key];
    const providedByAi = value != null;
    if (!providedByAi && spec.type === 'enum') {
      const settingValue = context.settings?.[key] || context.settings?.tagPrecision || context.settings?.searchPrecision;
      if (spec.values.includes(settingValue)) value = settingValue;
    }
    if (value == null && Object.prototype.hasOwnProperty.call(defaults, key)) value = defaults[key];
    if (spec.type === 'string' && value != null) {
      value = text(value);
      if (spec.maxLength && value.length > spec.maxLength) return { ok: false, code: 'INVALID_ARGUMENT', error: `${key} 超出长度限制` };
    }
    if (spec.type === 'enum' && !spec.values.includes(value)) value = definition.defaults[key] || spec.values[0];
    if (spec.type === 'integer' && value != null) { value = Number(value); if (!Number.isInteger(value)) value = defaults[key]; if (!Number.isInteger(value)) value = null; if (value != null) value = Math.min(spec.max, Math.max(spec.min, value)); }
    if (spec.type === 'boolean') value = value === true;
    if (spec.required && !text(value)) return { ok: false, code: 'INVALID_ARGUMENT', error: `缺少 ${key}` };
    if (value != null && !(value === '' && !spec.required)) variables[key] = value;
  }
  if (definition.name === 'vision') Object.assign(variables, { mode: text(context.settings?.visionMode, 'ai'), includeLocalTags: context.settings?.includeLocalTags !== false });
  if (definition.name === 'search') Object.assign(variables, {
    includeAdult: context.settings?.includeAdult === true || context.settings?.allowAdult === true || context.settings?.nsfwEnabled === true,
    limit: Math.min(200, Math.max(1, Number(context.settings?.tagLimit || 50))),
    category: text(context.settings?.category || context.currentCategory)
  });
  let resolved = null;
  if (definition.name === 'vision' || definition.name === 'title') {
    resolved = resolveImage(call.image, context);
    if (resolved.error) return { ok: false, code: 'IMAGE_SCOPE', error: resolved.error };
    if (definition.name === 'vision') variables.imageId = resolved.imageId; else variables.imageRef = resolved;
  }
  return { ok: true, id: `${definition.name}_${Date.now().toString(36)}`, call: definition.name, variables, resolved: resolved ? { kind: resolved.kind, refId: resolved.refId, imageId: resolved.imageId, tempId: resolved.tempId, assetRevision: resolved.assetRevision, label: resolved.label } : undefined, resolvedSummary: resolved ? { image: resolved.label } : undefined, definition };
}

function summary(type, result, call) {
  type = ({ compactSearchResult: 'search', compactImageManifest: 'images', compactVisionResult: 'vision', compactRenderResult: 'render', compactTitleResult: 'title' })[type] || type;
  const data = result?.data || result || {};
  if (type === 'search') return { ok: result?.ok !== false, items: (data.items || []).slice(0, 20).map(item => ({ en: short(item.en || item.tag), zh: short(item.zh || item.name), category: short(item.category) })) };
  if (type === 'images') return { ok: result?.ok !== false, items: (data.items || []).map(safeManifestItem) };
  if (type === 'vision') return { ok: result?.ok !== false, label: safeManifestText(call.resolved?.label || call.resolvedSummary?.image || '图片'), status: result?.ok === false ? 'error' : 'done', text: short(data.text || data.description), tags: (data.tags || data.modelTags || []).slice(0, 20).map(item => short(item.tag || item.name || item)) };
  if (type === 'render') { const artifact = data.artifact || data; return { ok: result?.ok !== false, status: data.status || (result?.ok === false ? 'error' : 'done'), candidateId: safeManifestText(artifact.candidateId), prompt: short(call.variables.prompt) }; }
  return { ok: result?.ok !== false, status: result?.ok === false ? 'error' : 'done', label: safeManifestText(call.resolved?.label || '图片'), title: short(call.variables.text) };
}

async function execute(call, context = {}) {
  if (call && call.ok !== true && (call.call || call.name || call.tool || call.function || call.function_call)) call = normaliseCall(call, context);
  if (!call?.ok) return call;
  const def = call.definition || callTable[call.call];
  if (def.name === 'render' && context.settings?.autoRender === false && context.confirmRender !== true) return { ok: true, call: call.call, status: 'confirmation_required', summary: { status: 'confirmation_required', prompt: short(call.variables.prompt) } };
  if ((def.permission === 'write' || def.permission === 'conversation-metadata-write') && context.allowWrite !== true && context.permissions?.write !== true) return { ok: false, code: 'PERMISSION_DENIED', error: '当前权限不可修改会话' };
  if (def.permission === 'external-effect' && (context.allowRender === false || context.permissions?.render === false)) return { ok: false, code: 'PERMISSION_DENIED', error: '当前权限不可执行渲染' };
  const args = { ...call.variables };
  if (def.name === 'render') {
    args.workflow = context.settings?.comfyWorkflow;
    if (!args.negative) args.negative = text(context.settings?.comfyNeg);
  }
  if (def.name === 'vision' && call.resolved?.kind === 'temp') { delete args.imageId; args.tempId = call.resolved.tempId; }
  if (def.name === 'title') { args.imageId = call.resolved?.imageId; args.refId = call.resolved?.refId; args.sessionId = context.sessionId; delete args.imageRef; }
  let result;
  try {
    const routedExecutorAvailable = typeof context.calls?.call === 'function'
      && (typeof context.calls.has !== 'function' || context.calls.has(def.executor));
    if (def.name === 'images' && context.imageRepository?.listConversation && !routedExecutorAvailable) result = context.imageRepository.listConversation(context.sessionId, { includePending: true });
    else if (def.name === 'title' && context.imageRepository?.setConversationTitle && !routedExecutorAvailable) result = context.imageRepository.setConversationTitle(context.sessionId, args.refId || args.imageId, args.text);
    else if (typeof context.executor === 'function') result = await context.executor(def.executor, args, context);
    else if (context.calls?.call) result = await context.calls.call(def.executor, args, { ...context, caller: context.caller || 'compact-ai', allowWrite: context.allowWrite === true });
    else result = { ok: false, code: 'EXECUTOR_UNAVAILABLE', error: '调用执行器不可用' };
  } catch (error) { result = { ok: false, code: error?.code || 'CALL_FAILED', error: text(error?.message, '调用失败') }; }
  const formatted = summary(def.resultFormatter, result, call);
  return { ok: result?.ok !== false, call: call.call, status: result?.ok === false ? 'error' : 'done', ...(result?.ok === false ? { code: result.code || 'CALL_FAILED', error: short(result.error) } : {}), result: formatted, summary: formatted };
}

function planImageContext({ sessionId, userText = '', pendingRefIds = [], imageRepository, repository } = {}) {
  const repo = imageRepository || repository;
  const rows = (repo?.listConversation?.(sessionId, { includePending: true })?.items || []).filter(item => item?.sessionId === sessionId);
  const errors = [];
  const explicit = [];
  const ambiguous = new Set();
  const source = String(userText || '');
  for (const match of source.matchAll(/(?:图|图片|image)\s*#?\s*(\d+)(?![\p{L}\p{N}_])/giu)) {
    const wanted = String(match[1]);
    const matches = rows.filter(item => String(item.slotNo) === wanted);
    if (matches.length > 1) errors.push(`图片${wanted}引用不唯一`);
    else if (matches.length) explicit.push(matches[0].refId);
    else errors.push(`图片${wanted}不在当前会话中`);
  }
  const titleRows = rows.filter(row => [row.displayTitle, row.displayName].some(label => titleMention(source, label)));
  for (const row of titleRows) {
    const labels = [row.displayTitle, row.displayName].filter(Boolean).map(String);
    const related = rows.filter(candidate => {
      const candidateLabels = [candidate.displayTitle, candidate.displayName].filter(Boolean).map(String);
      return labels.some(label => candidateLabels.some(other => {
        const a = label.toLowerCase(); const b = other.toLowerCase();
        return a === b || a.includes(b) || b.includes(a);
      }));
    });
    if (related.length > 1) {
      errors.push(`图片标题“${labels[0]}”引用不唯一`);
      related.forEach(item => ambiguous.add(item.refId));
    } else explicit.push(row.refId);
  }
  // Candidate references are explicit aliases, never arbitrary ID substrings.
  for (const match of source.matchAll(/(?:候选(?:图)?|candidate)\s*[-#]?\s*(\d+)(?![\p{L}\p{N}_])/giu)) {
    const wanted = String(match[1]);
    const matches = rows.filter(item => String(item.candidateId || '').match(new RegExp(`(?:^|[-_])${wanted}$`, 'i')));
    if (matches.length > 1) { errors.push(`候选图${wanted}引用不唯一`); matches.forEach(item => ambiguous.add(item.refId)); }
    else if (matches.length) explicit.push(matches[0].refId);
    else errors.push(`候选图${wanted}不在当前会话中`);
  }
  const explicitRefs = [...new Set(explicit)].filter(ref => !ambiguous.has(ref));
  const attachRefs = [...new Set(pendingRefIds.map(String))].filter(ref => {
    const exists = rows.some(row => String(row.refId) === ref);
    if (!exists) errors.push(`图片引用 ${ref} 不在当前会话中`);
    return exists;
  });
  const toolReadableRefs = [...new Set([...attachRefs, ...explicitRefs])];
  // Keep the complete current-session manifest lightweight so the model can
  // choose a stable reference. Media payloads are resolved separately from
  // toolReadableRefs and never live in this manifest.
  const manifest = rows.map(safeManifestItem);
  const aliases = new Map(rows.map(item => [rowLabel(item), { refId: item.refId, imageId: item.imageId, slotNo: item.slotNo, candidateId: item.candidateId }]));
  return { manifest, explicitRefs, attachRefs, toolReadableRefs: [...new Set([...attachRefs, ...explicitRefs])], aliases, errors: [...new Set(errors)] };
}

module.exports = { extractAssistantCalls, normaliseCall, adaptLegacyCall, execute, planImageContext, resolveImage, resolveImageReference: resolveImage, formatSummary: summary, parseCallObject: parseObject, callTable };
