'use strict';

const KNOWN_SAMPLERS = /^(?:KSampler(?:Advanced)?|SamplerCustom(?:Advanced)?|.*Sampler.*)$/i;
const KNOWN_OUTPUTS = /^(?:SaveImage|PreviewImage|SaveAnimated|SaveVideo|SaveAudio|SaveGLB|Save3D|SaveGaussian|SavePointCloud)/i;
const FIELD_KEYS = Object.freeze({ width: ['width', 'empty_latent_width', 'empty_latent_w'], height: ['height', 'empty_latent_height', 'empty_latent_h'], batchCount: ['batch_size', 'batchCount'], steps: ['steps'], cfg: ['cfg'], seed: ['seed', 'noise_seed'], sampler: ['sampler_name'], scheduler: ['scheduler'], ckpt: ['ckpt_name', 'checkpoint_name', 'unet_name', 'model_name'] });
const DEFAULT_OVERRIDES = Object.freeze({ positive: true, negative: true, width: false, height: false, steps: false, cfg: false, seed: false, sampler: false, scheduler: false, batchCount: false, ckpt: false });
const REFERENCE_FIELD_KEYS = Object.freeze({ denoise: ['denoise'], controlStrength: ['strength', 'control_strength', 'conditioning_scale', 'control_weight', 'weight'] });
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function text(value, fallback = '') { const out = value == null ? '' : String(value).trim(); return out || fallback; }
function title(node, id) { return text(node?._meta?.title || node?.title || node?.display_name || node?.class_type, `节点 ${id}`); }
function linked(value) { return Array.isArray(value) && value.length >= 1 && (typeof value[0] === 'string' || typeof value[0] === 'number') ? String(value[0]) : null; }
function parseWorkflow(value) {
  let source = value;
  if (typeof source === 'string') { try { source = JSON.parse(source); } catch (error) { throw new Error(`ComfyUI 工作流 JSON 无效：${error.message || error}`); } }
  if (!object(source)) throw new Error('ComfyUI 工作流必须是 API 格式节点对象');
  if (Array.isArray(source.nodes) || Array.isArray(source.links)) throw new Error('当前工作流是 ComfyUI 界面格式，请导出 API 格式');
  return clone(source);
}
function validateApiWorkflow(value) {
  try { const workflow = parseWorkflow(value); const entries = Object.entries(workflow); if (!entries.length) return { ready: false, error: '工作流为空' }; const bad = entries.find(([id, node]) => !object(node) || !text(node.class_type) || !object(node.inputs)); if (bad) return { ready: false, error: `节点 ${bad[0]} 缺少 class_type 或 inputs` }; return { ready: true, workflow }; }
  catch (error) { return { ready: false, error: error.message || String(error) }; }
}
function nodeRow(workflow, id) { const node = workflow[id]; return node ? { nodeId: String(id), classType: text(node.class_type), title: title(node, id), inputKeys: Object.keys(node.inputs || {}) } : null; }
function semanticTextBindings(workflow, nodeId, role, visited = new Set(), result = []) {
  if (nodeId == null || visited.has(String(nodeId))) return result; visited.add(String(nodeId)); const node = workflow[nodeId]; if (!node || !object(node.inputs)) return result;
  const preferred = role === 'positive' ? ['positive', 'text', 'text_g', 'text_l', 'prompt', 'value'] : ['negative', 'text', 'text_g', 'text_l', 'prompt', 'value'];
  for (const key of preferred) if (typeof node.inputs[key] === 'string') result.push({ nodeId: String(nodeId), input: key, title: title(node, nodeId), classType: text(node.class_type), value: node.inputs[key] });
  const linkKeys = Object.entries(node.inputs).filter(([key, value]) => linked(value) && /text|prompt|positive|negative|conditioning|wildcard|input|from|to/i.test(key));
  for (const [, value] of linkKeys) semanticTextBindings(workflow, linked(value), role, visited, result);
  return result;
}
function samplerCandidates(workflow, objectInfo = {}) { return Object.entries(workflow).filter(([, node]) => KNOWN_SAMPLERS.test(text(node.class_type)) || objectInfo?.[node.class_type]?.output_node === true && Object.keys(node.inputs || {}).some(key => /positive|negative|latent|sampler|steps|cfg/i.test(key))).map(([id, node]) => ({ ...nodeRow(workflow, id), score: ['positive', 'negative', 'latent_image', 'steps', 'cfg', 'sampler_name'].reduce((n, key) => n + (Object.prototype.hasOwnProperty.call(node.inputs || {}, key) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId)); }
function scalarCandidate(workflow, nodeId, keys, visited = new Set()) {
  if (nodeId == null || visited.has(String(nodeId))) return null; visited.add(String(nodeId)); const node = workflow[nodeId]; if (!node || !object(node.inputs)) return null;
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(node.inputs, key) && typeof node.inputs[key] !== 'object') return { nodeId: String(nodeId), input: key, title: title(node, nodeId), classType: text(node.class_type), value: node.inputs[key] };
  for (const value of Object.values(node.inputs)) { const id = linked(value); const found = id ? scalarCandidate(workflow, id, keys, visited) : null; if (found) return found; }
  return null;
}
function fieldCandidates(workflow, sampler) {
  const result = Object.fromEntries(Object.keys(FIELD_KEYS).map(key => [key, []])); if (!sampler) return result; const node = workflow[sampler.nodeId];
  for (const key of ['steps', 'cfg', 'seed', 'sampler', 'scheduler']) { const input = FIELD_KEYS[key].find(name => Object.prototype.hasOwnProperty.call(node.inputs || {}, name)); if (input) result[key].push({ nodeId: sampler.nodeId, input, title: title(node, sampler.nodeId), classType: text(node.class_type), value: node.inputs[input] }); }
  const latentId = linked(node.inputs?.latent_image) || linked(node.inputs?.latent) || linked(node.inputs?.samples);
  if (latentId) for (const key of ['width', 'height', 'batchCount']) { const found = scalarCandidate(workflow, latentId, FIELD_KEYS[key]); if (found) result[key].push(found); }
  if (linked(node.inputs?.model)) { const found = scalarCandidate(workflow, linked(node.inputs.model), FIELD_KEYS.ckpt); if (found) result.ckpt.push(found); }
  return result;
}
function collectOutputCandidates(workflow, objectInfo = {}) { return Object.entries(workflow).filter(([, node]) => KNOWN_OUTPUTS.test(text(node.class_type)) || objectInfo?.[node.class_type]?.output_node === true).map(([id, node]) => ({ ...nodeRow(workflow, id), outputType: /audio/i.test(node.class_type) ? 'audio' : /video|animated/i.test(node.class_type) ? 'video' : /3d|glb|point|gaussian/i.test(node.class_type) ? '3d' : 'image' })); }
function collectSourceImageCandidates(workflow) {
  const rows = [];
  for (const [id, node] of Object.entries(workflow)) {
    if (!/LoadImage|ImageLoader/i.test(text(node?.class_type)) || !object(node?.inputs)) continue;
    for (const key of Object.keys(node.inputs)) {
      if (!/^(?:image|image_name|filename|file)$/i.test(key) || linked(node.inputs[key])) continue;
      rows.push({ ...nodeRow(workflow, id), input: key, value: clone(node.inputs[key]) });
    }
  }
  return rows;
}
function collectReferenceFieldCandidates(workflow) {
  const result = { denoise: [], controlStrength: [] };
  for (const [id, node] of Object.entries(workflow)) {
    if (!object(node?.inputs)) continue;
    for (const [field, keys] of Object.entries(REFERENCE_FIELD_KEYS)) {
      if (field === 'controlStrength' && !/ControlNet|Control|IPAdapter|Reference/i.test(text(node.class_type))) continue;
      for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(node.inputs, key) || object(node.inputs[key]) || linked(node.inputs[key])) continue;
        result[field].push({ ...nodeRow(workflow, id), input: key, value: clone(node.inputs[key]) });
      }
    }
  }
  return result;
}
function analyzeWorkflow(value, options = {}) {
  const validation = validateApiWorkflow(value); if (!validation.ready) return { ready: false, level: 'manual', error: validation.error, nodeCount: 0, nodes: [], samplerCandidates: [], outputCandidates: [], promptCandidates: { positive: [], negative: [] }, fieldCandidates: {}, sourceImageCandidates: [], referenceFieldCandidates: { denoise: [], controlStrength: [] }, suggestedBindings: null, missingClasses: [], errors: [validation.error], warnings: [] };
  const workflow = validation.workflow; const entries = Object.entries(workflow); const objectInfo = options.objectInfo || {}; const samplers = samplerCandidates(workflow, objectInfo); const selected = options.samplerId ? samplers.find(row => row.nodeId === String(options.samplerId)) : samplers[0];
  const positive = selected ? semanticTextBindings(workflow, linked(workflow[selected.nodeId].inputs?.positive), 'positive') : []; const negative = selected ? semanticTextBindings(workflow, linked(workflow[selected.nodeId].inputs?.negative), 'negative') : [];
  const fields = fieldCandidates(workflow, selected); const outputs = collectOutputCandidates(workflow, objectInfo); const sourceImages = collectSourceImageCandidates(workflow); const referenceFields = collectReferenceFieldCandidates(workflow); const ambiguous = samplers.length > 1 && !options.samplerId;
  const suggestedBindings = ambiguous ? null : { samplerId: selected?.nodeId || '', positive: positive.length === 1 ? positive : [], negative: negative.length <= 1 ? negative : [], ...Object.fromEntries(Object.entries(fields).map(([key, rows]) => [key, rows.length === 1 ? rows : []])), sourceImage: sourceImages.length === 1 ? { nodeId: sourceImages[0].nodeId, input: sourceImages[0].input } : null, denoise: referenceFields.denoise.length === 1 ? { nodeId: referenceFields.denoise[0].nodeId, input: referenceFields.denoise[0].input } : null, controlStrength: referenceFields.controlStrength.length === 1 ? { nodeId: referenceFields.controlStrength[0].nodeId, input: referenceFields.controlStrength[0].input } : null, outputs: outputs.length === 1 ? [outputs[0].nodeId] : [] };
  const missingClasses = objectInfo && Object.keys(objectInfo).length ? [...new Set(entries.map(([, node]) => node.class_type).filter(name => !objectInfo[name]))] : [];
  return { ready: true, level: ambiguous || !selected || !positive.length || !outputs.length ? 'manual' : samplers.length === 1 ? 'standard' : 'advanced', nodeCount: entries.length, nodes: entries.map(([id]) => nodeRow(workflow, id)), samplerCandidates: samplers, outputCandidates: outputs, promptCandidates: { positive, negative }, fieldCandidates: fields, sourceImageCandidates: sourceImages, referenceFieldCandidates: referenceFields, suggestedBindings, missingClasses, errors: [], warnings: ambiguous ? ['发现多个采样器，请选择主采样器'] : [] };
}
function bindingValue(workflow, binding) { const node = workflow?.[String(binding?.nodeId)]; return node && Object.prototype.hasOwnProperty.call(node.inputs || {}, binding.input) ? node.inputs[binding.input] : undefined; }
function hasWritableDimensionBindings(workflowValue, bindings = {}, overrides = DEFAULT_OVERRIDES) {
  if (overrides?.width !== true || overrides?.height !== true) return false;
  const validation = validateApiWorkflow(workflowValue);
  if (!validation.ready) return false;
  for (const field of ['width', 'height']) {
    const rows = Array.isArray(bindings[field]) ? bindings[field] : bindings[field] ? [bindings[field]] : [];
    if (!rows.length || rows.some(row => bindingValue(validation.workflow, row) === undefined)) return false;
  }
  return true;
}
function validateBindings(workflowValue, bindings = {}, overrides = DEFAULT_OVERRIDES, options = {}) {
  const validation = validateApiWorkflow(workflowValue); if (!validation.ready) return { ready: false, errors: [validation.error] }; const workflow = validation.workflow; const errors = []; const seen = new Map();
  const check = (field, value) => { if (!overrides[field]) return; const rows = Array.isArray(value) ? value : value ? [value] : []; if (!rows.length && field !== 'negative') errors.push(`未绑定 ${field}`); for (const row of rows) { if (bindingValue(workflow, row) === undefined) errors.push(`${options.profileName || '工作流'} 绑定失效：节点 ${row.nodeId} 输入 ${row.input}`); const key = `${row.nodeId}.${row.input}`; if (seen.has(key) && seen.get(key) !== field) errors.push(`绑定冲突：${key} 同时用于 ${seen.get(key)} 和 ${field}`); seen.set(key, field); } };
  for (const field of Object.keys(DEFAULT_OVERRIDES)) check(field, bindings[field]);
  const values = object(options.values) ? options.values : {};
  for (const field of ['sourceImage', 'denoise', 'controlStrength']) {
    if (values[field] === undefined) continue;
    const row = bindings[field];
    if (!row) { errors.push(`未绑定 ${field}`); continue; }
    if (bindingValue(workflow, row) === undefined) errors.push(`${options.profileName || '工作流'} 绑定失效：节点 ${row.nodeId} 输入 ${row.input}`);
    const key = `${row.nodeId}.${row.input}`;
    if (seen.has(key) && seen.get(key) !== field) errors.push(`绑定冲突：${key} 同时用于 ${seen.get(key)} 和 ${field}`);
    seen.set(key, field);
  }
  return { ready: errors.length === 0, errors };
}
function applyExplicitBindings(workflowValue, bindings = {}, values = {}, overrides = DEFAULT_OVERRIDES, options = {}) {
  const validation = validateBindings(workflowValue, bindings, overrides, { ...options, values }); if (!validation.ready) throw new Error(validation.errors.join('；')); const workflow = parseWorkflow(workflowValue); const source = { ...values, negative: values.negative ?? '' };
  const set = (field, value) => { if (!overrides[field] || value === undefined) return; const rows = Array.isArray(bindings[field]) ? bindings[field] : bindings[field] ? [bindings[field]] : []; for (const row of rows) workflow[String(row.nodeId)].inputs[row.input] = clone(value); };
  for (const field of Object.keys(DEFAULT_OVERRIDES)) set(field, source[field]);
  for (const field of ['sourceImage', 'denoise', 'controlStrength']) {
    if (source[field] === undefined) continue;
    const row = bindings[field];
    const value = field === 'sourceImage' && object(source[field])
      ? [text(source[field].subfolder), text(source[field].name || source[field].filename)].filter(Boolean).join('/')
      : source[field];
    workflow[String(row.nodeId)].inputs[row.input] = clone(value);
  }
  return workflow;
}
module.exports = { DEFAULT_OVERRIDES, REFERENCE_FIELD_KEYS, parseWorkflow, validateApiWorkflow, analyzeWorkflow, collectOutputCandidates, collectSourceImageCandidates, collectReferenceFieldCandidates, validateBindings, applyExplicitBindings, hasWritableDimensionBindings };
