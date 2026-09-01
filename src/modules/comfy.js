'use strict';

/**
 * ComfyUI 的小型连接器。
 *
 * 这里只处理 HTTP 和工作流，不知道 Assistant 的会话或页面状态。
 * 这样 ComfyUI 可以单独替换、测试，也不会把旧版的全局循环带回来。
 */

const fs = require('node:fs');

function asText(value, fallback = '') {
  const result = value == null ? '' : String(value).trim();
  return result || fallback;
}

function jsonClone(value) {
  if (Array.isArray(value)) return value.map(jsonClone);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = jsonClone(item);
    return out;
  }
  return value;
}

function sleep(ms, signal) {
  if (signal && signal.aborted) return Promise.reject(new Error('已停止'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', stop);
      resolve();
    }
    function stop() {
      clearTimeout(timer);
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', stop);
      reject(new Error('已停止'));
    }
    if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', stop, { once: true });
  });
}

function toDataUrl(bytes, contentType = 'image/png') {
  if (bytes == null) return '';
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return `data:${contentType || 'image/png'};base64,${buffer.toString('base64')}`;
}

function parseWorkflow(value) {
  let workflow = value;
  if (typeof workflow === 'string') {
    try { workflow = JSON.parse(workflow); }
    catch (error) {
      throw new Error(`ComfyUI 工作流 JSON 无效：${error.message || error}。请从 ComfyUI 导出“API 格式”工作流后重新上传或粘贴`);
    }
  }
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    throw new Error('ComfyUI 工作流必须是 API 格式节点对象，请从 ComfyUI 导出 API 格式后重新上传或粘贴');
  }
  return jsonClone(workflow);
}

function validateApiWorkflow(value) {
  try {
    const workflow = parseWorkflow(value);
    if (Array.isArray(workflow.nodes)) return { ready: false, error: '当前工作流是 ComfyUI 界面格式，请导出 API 格式工作流后再上传' };
    const nodes = Object.values(workflow).filter((node) => node && typeof node === 'object');
    if (!nodes.length || nodes.some((node) => !node.class_type || !node.inputs || typeof node.inputs !== 'object')) {
      return { ready: false, error: 'ComfyUI 工作流为空或不是 API 格式节点对象（每个节点需要 class_type 和 inputs），请重新导出 API 格式工作流' };
    }
    return { ready: true, workflow };
  } catch (error) {
    return { ready: false, error: error?.message || String(error) };
  }
}

function linkedNodeId(value) {
  return Array.isArray(value) && value.length ? String(value[0]) : null;
}

function findSampler(workflow) {
  const entries = Object.entries(workflow).filter(([, node]) => node && node.inputs);
  let selected = null;
  let bestScore = -1;
  for (const entry of entries) {
    const node = entry[1];
    if (!/^KSampler/i.test(String(node.class_type || ''))) continue;
    const inputs = node.inputs || {};
    const score = ['positive', 'negative', 'latent_image', 'steps', 'cfg']
      .reduce((total, key) => total + (inputs[key] !== undefined ? 1 : 0), 0);
    if (score > bestScore) {
      selected = entry;
      bestScore = score;
    }
  }
  return selected;
}

function findTextBinding(workflow, nodeId, visited = new Set()) {
  return findTextBindings(workflow, nodeId, visited)[0] || null;
}

function findTextBindings(workflow, nodeId, visited = new Set(), result = []) {
  if (nodeId == null || visited.has(String(nodeId))) return result;
  visited.add(String(nodeId));
  const node = workflow[nodeId];
  if (!node || !node.inputs || typeof node.inputs !== 'object') return result;
  // CLIPTextEncode variants use text/text_g/text_l; primitive string nodes
  // commonly expose value or prompt instead. Supporting all fields matters
  // for SDXL nodes, which carry both text_g and text_l conditioning values.
  const localBindings = [];
  for (const key of ['text', 'text_g', 'text_l', 'value', 'prompt', 'positive', 'negative']) {
    if (typeof node.inputs[key] === 'string') localBindings.push({ node, key, value: node.inputs[key] });
  }
  if (localBindings.length) {
    result.push(...localBindings);
    return result;
  }
  // Once a node owns a text input, its other links are usually clip/model
  // dependencies (for example a LoRA loader). Do not walk those links and
  // accidentally treat their auxiliary text as the sampler prompt.
  if (result.length) return result;
  for (const value of Object.values(node.inputs)) {
    const linked = linkedNodeId(value);
    if (linked != null) findTextBindings(workflow, linked, visited, result);
  }
  return result;
}

function findLinkedNode(workflow, nodeId, predicate, visited = new Set()) {
  if (nodeId == null || visited.has(String(nodeId))) return null;
  visited.add(String(nodeId));
  const node = workflow[nodeId];
  if (!node || !node.inputs || typeof node.inputs !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node.inputs)) {
    const linked = linkedNodeId(value);
    const found = linked == null ? null : findLinkedNode(workflow, linked, predicate, visited);
    if (found) return found;
  }
  return null;
}

function findInputBinding(node, key, workflow, options = {}) {
  if (!node?.inputs || !Object.prototype.hasOwnProperty.call(node.inputs, key)) return null;
  const value = node.inputs[key];
  if (typeof value !== 'object' || value == null) return { node, key, value };
  const linked = linkedNodeId(value);
  if (linked == null) return null;
  const scalarKeys = options.scalarKeys || ['value', key];
  return findScalarBinding(workflow, linked, scalarKeys);
}

function findScalarBinding(workflow, nodeId, keys, visited = new Set()) {
  if (nodeId == null || visited.has(String(nodeId))) return null;
  visited.add(String(nodeId));
  const node = workflow[nodeId];
  if (!node || !node.inputs || typeof node.inputs !== 'object') return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(node.inputs, key) && typeof node.inputs[key] !== 'object') {
      return { node, key, value: node.inputs[key] };
    }
  }
  for (const value of Object.values(node.inputs)) {
    const linked = linkedNodeId(value);
    const found = linked == null ? null : findScalarBinding(workflow, linked, keys, visited);
    if (found) return found;
  }
  return null;
}

function findDimensionBinding(workflow, nodeId, keys) {
  const latent = findLinkedNode(workflow, nodeId, node => {
    const inputs = node.inputs || {};
    return keys.some(key => Object.prototype.hasOwnProperty.call(inputs, key));
  });
  if (!latent) return null;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(latent.inputs, key)) continue;
    const value = latent.inputs[key];
    if (typeof value !== 'object' || value == null) return { node: latent, key, value };
    const linked = linkedNodeId(value);
    const scalar = linked == null ? null : findScalarBinding(workflow, linked, ['value', key]);
    if (scalar) return scalar;
  }
  return null;
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function provided(value) {
  return value !== undefined && value !== null;
}

function workflowParams(params = {}) {
  return {
    prompt: hasOwn(params, 'prompt') ? params.prompt : undefined,
    negative: hasOwn(params, 'negative') ? params.negative : undefined,
    seed: hasOwn(params, 'seed') ? params.seed : undefined,
    width: hasOwn(params, 'width') ? params.width : params.w,
    height: hasOwn(params, 'height') ? params.height : params.h,
    steps: hasOwn(params, 'steps') ? params.steps : undefined,
    cfg: hasOwn(params, 'cfg') ? params.cfg : undefined,
    sampler: hasOwn(params, 'sampler') ? params.sampler : undefined,
    scheduler: hasOwn(params, 'scheduler') ? params.scheduler : undefined,
    ckpt: hasOwn(params, 'ckpt') ? params.ckpt : hasOwn(params, 'model') ? params.model : undefined
  };
}

function placeholderParams(params = {}) {
  const values = workflowParams(params);
  return {
    ...values,
    prompt: values.prompt == null ? '' : values.prompt,
    negative: values.negative == null ? '' : values.negative,
    seed: values.seed == null ? Math.floor(Math.random() * 1e9) : values.seed,
    width: values.width == null ? 768 : values.width,
    height: values.height == null ? 1024 : values.height,
    steps: values.steps == null ? 25 : values.steps,
    cfg: values.cfg == null ? 7 : values.cfg,
    sampler: values.sampler || 'euler',
    scheduler: values.scheduler || 'normal',
    ckpt: values.ckpt == null ? '' : values.ckpt
  };
}

function resolveWorkflowPlaceholders(value, params = {}, resolvedValues = null) {
  const values = resolvedValues || placeholderParams(params);
  if (Array.isArray(value)) return value.map(item => resolveWorkflowPlaceholders(item, params, values));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = resolveWorkflowPlaceholders(item, params, values);
    return out;
  }
  if (typeof value !== 'string') return value;
  const exact = value.match(/^\{\{([a-zA-Z][\w]*)\}\}$/);
  if (exact && Object.prototype.hasOwnProperty.call(values, exact[1])) return jsonClone(values[exact[1]]);
  return value.replace(/\{\{([a-zA-Z][\w]*)\}\}/g, (token, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : token
  ));
}

function setBinding(binding, value) {
  if (!binding?.node?.inputs || !binding.key) return false;
  binding.node.inputs[binding.key] = value;
  return true;
}

function numericOverride(value, name) {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`ComfyUI 工作流参数 ${name} 必须是数字`);
  return result;
}

/**
 * Override the nodes connected to the workflow's sampler. This is deliberately
 * structural instead of placeholder-only: an imported workflow may contain
 * literal values, and silently returning ok while retaining those values is
 * worse than rejecting the render with an actionable error.
 */
function applyWorkflowOverrides(workflow, params = {}) {
  const values = workflowParams(params);
  const samplerEntry = findSampler(workflow);
  if (!samplerEntry) throw new Error('ComfyUI 工作流无法覆盖绘图参数：未找到 KSampler 或 KSamplerAdvanced 节点，请检查并重新导出 API 格式工作流');
  const sampler = samplerEntry[1];
  const inputs = sampler.inputs || {};
  const changed = [];

  if (provided(values.prompt)) {
    const bindings = typeof inputs.positive === 'string'
      ? [{ node: sampler, key: 'positive' }]
      : findTextBindings(workflow, linkedNodeId(inputs.positive));
    if (!bindings.length) throw new Error('ComfyUI 工作流无法覆盖正向提示词：未找到与采样器 positive 输入连接的文本节点，请连接 CLIPTextEncode 后重试');
    bindings.forEach(binding => setBinding(binding, String(values.prompt)));
    changed.push('prompt');
  }

  // Negative prompt is optional in the Calls schema. If a branch exists, clear
  // stale literal text even when the current setting is empty; a workflow that
  // has no negative branch remains usable when the value is empty.
  if (provided(values.negative)) {
    const bindings = typeof inputs.negative === 'string'
      ? [{ node: sampler, key: 'negative' }]
      : findTextBindings(workflow, linkedNodeId(inputs.negative));
    if (!bindings.length && String(values.negative).trim() !== '') throw new Error('ComfyUI 工作流无法覆盖负向提示词：未找到与采样器 negative 输入连接的文本节点，请连接负面 CLIPTextEncode 后重试');
    bindings.forEach(binding => setBinding(binding, String(values.negative)));
    if (bindings.length) changed.push('negative');
  }

  if (provided(values.width) || provided(values.height)) {
    const latentId = linkedNodeId(inputs.latent_image) || linkedNodeId(inputs.latent) || linkedNodeId(inputs.samples);
    if (!latentId) throw new Error('ComfyUI 工作流无法覆盖尺寸：采样器没有连接 latent_image 节点，请使用包含 EmptyLatentImage 的 API 工作流');
    if (provided(values.width)) {
      const binding = findDimensionBinding(workflow, latentId, ['width', 'empty_latent_width', 'empty_latent_w']);
      if (!binding) throw new Error('ComfyUI 工作流无法覆盖宽度：未找到与采样器连接的 latent width 输入');
      setBinding(binding, numericOverride(values.width, 'width'));
      changed.push('width');
    }
    if (provided(values.height)) {
      const binding = findDimensionBinding(workflow, latentId, ['height', 'empty_latent_height', 'empty_latent_h']);
      if (!binding) throw new Error('ComfyUI 工作流无法覆盖高度：未找到与采样器连接的 latent height 输入');
      setBinding(binding, numericOverride(values.height, 'height'));
      changed.push('height');
    }
  }

  for (const field of ['steps', 'cfg']) {
    if (!provided(values[field])) continue;
    const binding = findInputBinding(sampler, field, workflow, { scalarKeys: ['value', field] });
    if (!binding) throw new Error(`ComfyUI 工作流无法覆盖 ${field}：KSampler 节点缺少可写的 ${field} 输入`);
    setBinding(binding, numericOverride(values[field], field));
    changed.push(field);
  }

  if (provided(values.seed)) {
    const seedField = inputs.seed !== undefined ? 'seed' : inputs.noise_seed !== undefined ? 'noise_seed' : '';
    if (!seedField) throw new Error('ComfyUI 工作流无法覆盖 seed：KSampler 节点缺少 seed 或 noise_seed 输入');
    const binding = findInputBinding(sampler, seedField, workflow, { scalarKeys: ['value', seedField, 'seed', 'noise_seed'] });
    if (!binding) throw new Error(`ComfyUI 工作流无法覆盖 ${seedField}：采样器输入不可写`);
    setBinding(binding, numericOverride(values.seed, seedField));
    changed.push(seedField);
  }

  for (const field of ['sampler', 'scheduler']) {
    if (!provided(values[field]) || String(values[field]).trim() === '') continue;
    const inputKey = field === 'sampler' ? 'sampler_name' : 'scheduler';
    const binding = findInputBinding(sampler, inputKey, workflow, { scalarKeys: ['value', inputKey] });
    if (!binding) throw new Error(`ComfyUI 工作流无法覆盖 ${field}：KSampler 节点缺少可写的 ${inputKey} 输入`);
    setBinding(binding, String(values[field]).trim());
    changed.push(field);
  }

  if (provided(values.ckpt) && String(values.ckpt).trim() !== '') {
    const modelId = linkedNodeId(inputs.model);
    const binding = modelId == null ? null : findScalarBinding(workflow, modelId, ['ckpt_name', 'checkpoint_name', 'unet_name', 'model_name', 'value']);
    if (!binding) throw new Error('ComfyUI 工作流无法覆盖模型：未找到与采样器 model 输入连接的模型加载节点');
    setBinding(binding, String(values.ckpt).trim());
    changed.push('ckpt');
  }

  return { workflow, samplerId: String(samplerEntry[0]), changed };
}

function findStringBinding(workflow, nodeId, keys, visited = new Set()) {
  if (nodeId == null || visited.has(String(nodeId))) return null;
  visited.add(String(nodeId));
  const node = workflow[nodeId];
  if (!node || !node.inputs || typeof node.inputs !== 'object') return null;
  for (const key of keys) {
    if (typeof node.inputs[key] === 'string') return { node, key, value: node.inputs[key] };
  }
  for (const value of Object.values(node.inputs)) {
    const linked = linkedNodeId(value);
    const found = linked == null ? null : findStringBinding(workflow, linked, keys, visited);
    if (found) return found;
  }
  return null;
}

function setTextPlaceholder(binding, placeholder) {
  if (!binding?.node?.inputs || typeof binding.node.inputs[binding.key] !== 'string') return '';
  const original = binding.node.inputs[binding.key];
  binding.node.inputs[binding.key] = `{{${placeholder}}}`;
  return original;
}

/**
 * Import a ComfyUI API workflow and expose its editable values.
 *
 * This mirrors the V1.4.2 import behavior: prompt nodes and sampler values are
 * replaced with placeholders so later renders can inject the current form/AI
 * values instead of silently reusing the PNG's original prompt.
 */
function importApiWorkflow(value) {
  const workflow = parseWorkflow(value);
  const sampler = findSampler(workflow);
  let prompt = '';
  let negative = '';
  let width = '';
  let height = '';
  let steps = '';
  let cfg = '';
  let seed = '';
  let found = false;

  if (sampler) {
    const [, node] = sampler;
    const positiveBinding = findTextBinding(workflow, linkedNodeId(node.inputs.positive));
    const negativeTextBinding = findTextBinding(workflow, linkedNodeId(node.inputs.negative));
    const negativeBinding = negativeTextBinding || findStringBinding(workflow, linkedNodeId(node.inputs.negative), ['negative', 'negative_prompt', 'negativePrompt']);
    prompt = setTextPlaceholder(positiveBinding, 'prompt') || prompt;
    negative = setTextPlaceholder(negativeBinding, 'negative') || negative;
    for (const field of ['steps', 'cfg']) {
      if (node.inputs[field] === undefined) continue;
      const original = node.inputs[field];
      if (field === 'steps') steps = Number.parseInt(original, 10) || 25;
      else cfg = Number.parseFloat(original) || 7;
      node.inputs[field] = `{{${field}}}`;
      found = true;
    }
    const seedField = node.inputs.seed !== undefined ? 'seed' : node.inputs.noise_seed !== undefined ? 'noise_seed' : '';
    if (seedField) {
      seed = String(node.inputs[seedField]);
      node.inputs[seedField] = '{{seed}}';
      found = true;
    }
    const latent = workflow[linkedNodeId(node.inputs.latent_image)];
    if (latent?.inputs) {
      const widthKey = ['width', 'empty_latent_width', 'empty_latent_w'].find(key => latent.inputs[key] !== undefined);
      const heightKey = ['height', 'empty_latent_height', 'empty_latent_h'].find(key => latent.inputs[key] !== undefined);
      if (widthKey) {
        width = latent.inputs[widthKey];
        latent.inputs[widthKey] = '{{width}}';
        found = true;
      }
      if (heightKey) {
        height = latent.inputs[heightKey];
        latent.inputs[heightKey] = '{{height}}';
        found = true;
      }
    }
    if (prompt || negative) found = true;
  }

  return {
    workflow,
    text: JSON.stringify(workflow, null, 2),
    prompt,
    negative,
    width,
    height,
    steps,
    cfg,
    seed,
    found
  };
}

function replaceWorkflowPlaceholders(value, params) {
  let source = String(value || '');
  const entries = placeholderParams(params);
  for (const [key, item] of Object.entries(entries)) {
    // JSON workflows are commonly written with either a string placeholder or
    // a numeric placeholder. Replacing the token as text handles both forms.
    const valueText = String(item == null ? '' : item)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n');
    source = source.split(`{{${key}}}`).join(valueText);
  }
  return source;
}

function defaultWorkflow(params = {}) {
  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: Number.isFinite(Number(params.seed)) ? Number(params.seed) : Math.floor(Math.random() * 1e9),
        steps: Number(params.steps) || 25,
        cfg: Number(params.cfg) || 7,
        sampler_name: params.sampler || 'euler',
        scheduler: params.scheduler || 'normal',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0]
      }
    },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: params.ckpt || '' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: Number(params.w) || 768, height: Number(params.h) || 1024, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: params.prompt || '', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: params.negative || '', clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'aitag', images: ['8', 0] } }
  };
}

function createComfy(options = {}) {
  let base = asText(options.baseUrl || options.base, 'http://127.0.0.1:8188').replace(/\/+$/, '');
  const fetchImpl = options.fetch || globalThis.fetch;
  const clientId = asText(options.clientId, `aitag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  let workflow = options.workflow || '';

  function setBase(value) {
    base = asText(value, base).replace(/\/+$/, '');
    return base;
  }
  function setWorkflow(value) {
    workflow = typeof value === 'string' ? value.trim() : value || '';
    return workflow;
  }
  function url(pathname) {
    return `${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  }
  function buildWorkflow(params = {}) {
    // A render call may provide a one-off workflow (useful for the current
    // session) without changing the connector's default workflow.
    const selectedWorkflow = params.workflow || workflow;
    if (!selectedWorkflow) return defaultWorkflow(params);
    let parsed;
    try {
      // Parse first so exact placeholders can retain their intended number
      // type (e.g. steps/cfg/width) instead of becoming quoted strings.
      parsed = parseWorkflow(selectedWorkflow);
    } catch (error) {
      // Older exports occasionally contain unquoted placeholders. Keep a
      // compatibility fallback for those while still applying structural
      // overrides below.
      if (typeof selectedWorkflow !== 'string') throw error;
      parsed = parseWorkflow(replaceWorkflowPlaceholders(selectedWorkflow, params));
    }
    parsed = resolveWorkflowPlaceholders(parsed, params);
    const validation = validateApiWorkflow(parsed);
    if (!validation.ready) throw new Error(validation.error);
    return applyWorkflowOverrides(validation.workflow, params).workflow;
  }
  function workflowStatus(value = workflow) {
    if (value == null || value === '') return { ready: false, error: '尚未设置 ComfyUI 工作流，请到「API 设置 → ComfyUI」上传或粘贴 API 格式工作流' };
    const result = validateApiWorkflow(value);
    return { ready: result.ready, error: result.error || '', workflow: result.ready ? result.workflow : null };
  }
  function workflowReady(value = workflow) { return workflowStatus(value).ready; }
  async function request(pathname, init = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('当前环境没有 fetch，无法连接 ComfyUI，请重启应用或检查运行环境');
    let response;
    try {
      response = await fetchImpl(url(pathname), init);
    } catch (error) {
      // Abort is handled by wait()/the caller so a user stop remains concise.
      if (init.signal?.aborted) throw error;
      const detail = asText(error?.message || error);
      throw new Error(`ComfyUI 连接失败${detail ? `：${detail}` : ''}。请确认 ComfyUI 已启动，并检查「API 设置 → ComfyUI 地址」`);
    }
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.text()).slice(0, 300); } catch { /* ignore */ }
      detail = detail.replace(/<[^>]*>/g, ' ').replace(/&#x20;|&#32;/gi, ' ').replace(/\s+/g, ' ').trim();
      const hint = response.status === 404
        ? '请检查「API 设置 → ComfyUI 地址」是否正确，并确认 ComfyUI 服务已启动'
        : response.status >= 500
          ? '请查看 ComfyUI 控制台日志，确认服务和模型没有报错'
          : '请检查 ComfyUI 工作流、节点和参数后重试';
      throw new Error(`ComfyUI 请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}。${hint}`);
    }
    return response;
  }
  async function check() {
    try { await request('/system_stats', { signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined }); return true; }
    catch { return false; }
  }
  async function status(options2 = {}) {
    const enabled = options2.enabled !== false;
    const selectedWorkflow = options2.workflow !== undefined ? options2.workflow : workflow;
    const workflowInfo = workflowStatus(selectedWorkflow);
    let connected = false;
    if (typeof fetchImpl === 'function') connected = await check();
    return {
      enabled,
      connected,
      workflowReady: Boolean(workflowInfo.ready),
      render: Boolean(enabled && connected && workflowInfo.ready),
      workflow: workflowInfo.workflow || null,
      error: !connected
        ? 'ComfyUI 未连接 · 请确认 ComfyUI 已启动，并检查「API 设置 → ComfyUI 地址」'
        : !workflowInfo.ready
          ? (workflowInfo.error || 'ComfyUI 未就绪 · 请到「API 设置 → ComfyUI」上传或粘贴 API 格式工作流')
          : !enabled
            ? 'ComfyUI 已停用 · 请在绘图模式左上角打开“ComfyUI 出图”'
            : ''
    };
  }
  async function list(limit = 20, signal) {
    const response = await request(`/history?max_items=${Math.max(1, Number(limit) || 20)}`, { signal });
    return response.json();
  }
  function viewUrl(image) {
    const item = image || {};
    return url(`/view?filename=${encodeURIComponent(item.filename || '')}&subfolder=${encodeURIComponent(item.subfolder || '')}&type=${encodeURIComponent(item.type || 'output')}`);
  }
  async function fetchImage(image, signal) {
    const response = await request(`/view?filename=${encodeURIComponent(image?.filename || '')}&subfolder=${encodeURIComponent(image?.subfolder || '')}&type=${encodeURIComponent(image?.type || 'output')}`, { signal });
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers?.get?.('content-type') || 'image/png';
    return { ...jsonClone(image), dataUrl: toDataUrl(bytes, contentType), viewUrl: viewUrl(image) };
  }
  async function wait(promptId, options2 = {}) {
    const deadline = Date.now() + (Number(options2.timeoutMs) || 10 * 60 * 1000);
    while (Date.now() < deadline) {
      if (options2.signal?.aborted) throw new Error('已停止');
      try {
        const response = await request(`/history/${encodeURIComponent(promptId)}`, { signal: options2.signal });
        const history = await response.json();
        const record = history && history[promptId];
        if (record?.status?.status_str === 'error' || record?.status?.completed === false && record?.status?.messages?.some?.(item => String(item).toLowerCase().includes('error'))) {
          const details = [];
          for (const message of record?.status?.messages || []) {
            const info = Array.isArray(message) ? message[1] : message;
            if (!info || typeof info !== 'object') continue;
            const text = info.exception_message || info.message || info.error;
            if (text) {
              const node = [info.node_id && `node ${info.node_id}`, info.node_type].filter(Boolean).join(' / ');
              details.push(node ? `${node}: ${text}` : String(text));
            }
          }
          throw new Error(`ComfyUI 工作流执行失败${details.length ? `：${details.join('；')}` : ''}。请检查工作流节点、模型文件和参数后重试`);
        }
        if (record?.outputs) {
          for (const output of Object.values(record.outputs)) {
            const images = output?.images;
            if (Array.isArray(images) && images.length) {
              const image = await fetchImage(images[0], options2.signal);
              return { ...image, promptId };
            }
          }
        }
      } catch (error) {
        if (options2.signal?.aborted) throw new Error('已停止');
        // History can briefly return 404 while the queue is starting; retry only
        // that transient condition. Execution and other HTTP errors must reach
        // the caller immediately instead of turning into a long timeout.
        if (!/ComfyUI 请求失败（HTTP 404）/.test(String(error?.message || error))) throw error;
      }
      if (typeof options2.onProgress === 'function') {
        try {
          const queue = await (await request('/queue', { signal: options2.signal })).json();
          options2.onProgress((queue?.queue_running || []).length + (queue?.queue_pending || []).length);
        } catch { /* progress is optional */ }
      }
      await sleep(Number(options2.intervalMs) || 1200, options2.signal);
    }
    throw new Error('ComfyUI 生成超时，请检查队列和模型加载状态；必要时减少步数或迭代次数后重试');
  }
  async function render(params = {}) {
    if (!params.workflow && !workflow) throw new Error('尚未设置 ComfyUI 工作流，请到「API 设置 → ComfyUI」上传或粘贴 API 格式工作流');
    const built = buildWorkflow(params);
    const response = await request('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ prompt: built, client_id: clientId }),
      signal: params.signal
    });
    const result = await response.json();
    if (result?.error) throw new Error(`ComfyUI 错误：${JSON.stringify(result.error).slice(0, 300)}。请检查工作流节点、模型文件和参数后重试`);
    if (!result?.prompt_id) throw new Error('ComfyUI 没有返回任务编号，请查看 ComfyUI 控制台日志并确认服务正常');
    return wait(result.prompt_id, params);
  }

  /** 提交任意 API 格式工作流，只返回任务编号（外部 Agent 入口）。 */
  async function submitPrompt(promptWorkflow, signal) {
    const built = typeof promptWorkflow === 'string' ? parseWorkflow(promptWorkflow) : jsonClone(promptWorkflow);
    const validation = validateApiWorkflow(built);
    if (!validation.ready) throw new Error(validation.error || '工作流不是有效的 ComfyUI API 格式');
    const response = await request('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ prompt: built, client_id: clientId }),
      signal
    });
    const result = await response.json();
    if (result?.error) throw new Error(`ComfyUI 错误：${JSON.stringify(result.error).slice(0, 300)}。请检查工作流节点、模型文件和参数后重试`);
    if (!result?.prompt_id) throw new Error('ComfyUI 没有返回任务编号，请查看 ComfyUI 控制台日志并确认服务正常');
    return result.prompt_id;
  }

  /** 查询/等待任务结果，返回状态和输出文件清单（不下载图片内容）。 */
  async function result(promptId, options2 = {}) {
    const id = asText(promptId);
    if (!id) throw new Error('缺少 ComfyUI 任务编号 promptId');
    const deadline = Date.now() + (Number(options2.timeoutMs) || 10 * 60 * 1000);
    const poll = async () => {
      const response = await request(`/history/${encodeURIComponent(id)}`, { signal: options2.signal });
      const history = await response.json();
      const record = history && history[id];
      if (!record) return { status: 'unknown', complete: false, promptId: id };
      const status = record?.status?.status_str || 'running';
      const outputs = [];
      for (const [nodeId, output] of Object.entries(record?.outputs || {})) {
        const files = [];
        for (const image of output?.images || []) {
          files.push({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output', viewUrl: viewUrl(image) });
        }
        outputs.push({ nodeId, nodeType: output?.node_type || output?.class_type || '', files });
      }
      let errorText = '';
      for (const message of record?.status?.messages || []) {
        const info = Array.isArray(message) ? message[1] : message;
        if (!info || typeof info !== 'object') continue;
        const detail = info.exception_message || info.message || info.error;
        if (detail) errorText = errorText ? `${errorText}；${detail}` : String(detail);
      }
      return { promptId: id, status, complete: Boolean(record?.status?.completed), error: errorText || undefined, outputs };
    };
    let current = await poll();
    if (current.complete || options2.wait !== true) return current;
    while (Date.now() < deadline) {
      if (options2.signal?.aborted) throw new Error('已停止');
      if (current.status === 'error' || /error/i.test(current.status)) return current;
      await sleep(Number(options2.intervalMs) || 1200, options2.signal);
      current = await poll();
      if (current.complete || current.status === 'error' || /error/i.test(current.status)) return current;
    }
    return { ...current, status: 'timeout' };
  }

  /** 读取 ComfyUI 节点定义；classPattern 为可选正则片段过滤。 */
  async function objectInfo(classPattern = '', signal) {
    const response = await request('/object_info', { signal });
    const info = await response.json();
    const pattern = asText(classPattern);
    if (!pattern) return { classes: Object.keys(info || {}), nodes: info || {} };
    let regex;
    try { regex = new RegExp(pattern, 'i'); }
    catch (error) { throw new Error(`节点类筛选表达式无效：${error.message || error}`); }
    const filtered = {};
    for (const [key, value] of Object.entries(info || {})) if (regex.test(key)) filtered[key] = value;
    return { classes: Object.keys(filtered), nodes: filtered };
  }

  /** 中断当前任务，或同时清空待执行队列。 */
  async function cancel(mode = 'current', signal) {
    const result2 = { interrupted: false, clearedCount: 0, note: '' };
    try {
      const response = await request('/interrupt', { method: 'POST', signal });
      result2.interrupted = response.status >= 200 && response.status < 300;
    } catch { /* 没有正在执行的任务时可能返回错误 */ }
    if (mode !== 'queue') return result2;
    try {
      const queueResponse = await request('/queue', { signal });
      const queue = await queueResponse.json();
      const pending = Array.isArray(queue?.queue_pending) ? queue.queue_pending : [];
      let kept = false;
      for (const item of pending) {
        const id = item?.prompt_id;
        if (!id) continue;
        try {
          await request(`/queue?delete=${encodeURIComponent(id)}`, { method: 'DELETE', signal });
          result2.clearedCount += 1;
        } catch { kept = true; }
      }
      result2.note = kept ? '部分队列项无法删除，请稍后重试' : '';
    } catch (error) { result2.note = `队列清理失败：${error?.message || error}`; }
    return result2;
  }

  return {
    get base() { return base; },
    get workflow() { return workflow; },
    clientId,
    setBase,
    setWorkflow,
    workflowStatus,
    workflowReady,
    url,
    check,
    status,
    list,
    viewUrl,
    fetchImage,
    wait,
    render,
    submitPrompt,
    result,
    objectInfo,
    cancel,
    buildWorkflow,
    parseWorkflow,
    importApiWorkflow
  };
}

module.exports = {
  createComfy,
  parseWorkflow,
  validateApiWorkflow,
  importApiWorkflow,
  defaultWorkflow,
  replaceWorkflowPlaceholders,
  applyWorkflowOverrides
};
