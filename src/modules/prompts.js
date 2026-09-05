'use strict';

/**
 * 提示词素材模块。
 *
 * 这里只做一件事：从 assets/提示词素材 读取文本，并提供一个很小的
 * 查询/组合接口。提示词的业务解释仍由 Assistant 或页面负责，避免把
 * 旧版 prompts.js 的全局状态和模式逻辑带进重写版。
 */

const fs = require('node:fs');
const path = require('node:path');

const PROMPT_FILES = Object.freeze({
  main: '01-内部主提示词-MAIN_PROMPT.txt',
  generate: '02-生成Tag任务-GEN_TASK.txt',
  chat: '03-自由对话任务-CHAT_TASK.txt',
  vision: '04-识图描述提示词-DEFAULT_VISION_PROMPT.txt',
  comfy: '05-ComfyUI提示词协议.txt',
  quality: '06-默认质量前缀-DEFAULT_QP.txt',
  appendices: '07-默认附录提示词.txt'
});

const PROMPT_ALIASES = Object.freeze({
  system: 'main',
  mainPrompt: 'main',
  gen: 'generate',
  generation: 'generate',
  generateTags: 'generate',
  task: 'generate',
  freeChat: 'chat',
  defaultVision: 'vision',
  image: 'vision',
  comfyui: 'comfy',
  qualityPrefix: 'quality',
  defaultQuality: 'quality',
  appendix: 'appendices'
});

const PROMPT_META = Object.freeze({
  main: { label: '内部主提示词', kind: 'system', role: 'system', mode: 'all', editable: true, editableOverride: true, deletable: false },
  generate: { label: '生成 Tag 任务', kind: 'task', role: 'system', mode: 'generate', editable: false, editableOverride: false, deletable: false },
  chat: { label: '自由对话任务', kind: 'task', role: 'system', mode: 'chat', editable: false, editableOverride: false, deletable: false },
  vision: { label: '识图描述提示词', kind: 'task', role: 'system', mode: 'vision', editable: true, editableOverride: true, deletable: false },
  comfy: { label: 'ComfyUI 提示词协议', kind: 'protocol', role: 'system', mode: 'comfy', editable: false, editableOverride: false, deletable: false },
  quality: { label: '默认质量前缀', kind: 'prefix', role: 'system', mode: 'generate', editable: true, editableOverride: true, deletable: false },
  appendices: { label: '默认附录提示词', kind: 'appendix-set', role: 'system', mode: 'optional', editable: false, editableOverride: false, deletable: false }
});

const INTERNAL_PROMPT_KEYS = Object.freeze(['main', 'generate', 'vision', 'comfy', 'quality']);
const EXTERNAL_PROMPT_KEYS = Object.freeze(['chat']);

const MODE_KEYS = Object.freeze({
  generate: ['main', 'generate', 'quality'],
  gen: ['main', 'generate', 'quality'],
  chat: ['main', 'chat'],
  vision: ['vision'],
  comfy: ['main', 'comfy', 'quality']
});

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).replace(/^\uFEFF/, '').trim();
  return result || fallback;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

function resolveKey(key) {
  const value = text(key);
  return PROMPT_FILES[value] ? value : (PROMPT_ALIASES[value] || value);
}

function defaultDir() {
  return path.resolve(__dirname, '..', '..', 'assets', '提示词素材');
}

function readFile(dir, file) {
  try {
    return text(fs.readFileSync(path.join(dir, file), 'utf8'));
  } catch {
    // 素材缺失时返回空文本，让页面仍然可以启动和继续开发。
    return '';
  }
}

/**
 * 把“===== 附录 N =====”文本拆成简单的可选条目。
 * 正文原样保留；enabled/trigger 只是 UI 可用的轻量元数据，不参与推理。
 */
function parseAppendices(value) {
  const source = text(value);
  if (!source) return [];
  const chunks = source.split(/^=====\s*附录\s*(\d+)\s*=====\s*$/m);
  const result = [];
  for (let index = 1; index < chunks.length; index += 2) {
    const number = Number(chunks[index]);
    const body = text(chunks[index + 1]);
    if (!body) continue;
    const heading = body.match(/^#\s*附录\s*\d+\s*[：:]\s*(.+)$/m);
    result.push({
      id: `appendix-${Number.isFinite(number) ? number : result.length + 1}`,
      index: Number.isFinite(number) ? number : result.length + 1,
      title: heading ? text(heading[1]) : `附录 ${number || result.length + 1}`,
      text: body,
      enabled: false,
      trigger: 'manual'
    });
  }
  return result;
}

function normalisePartList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/[+,]/).map(item => item.trim()).filter(Boolean);
  return [];
}

/**
 * 创建提示词目录实例。
 *
 * 示例：
 *   const prompts = createPrompts({ dir: pathToAssets });
 *   prompts.get('vision');
 *   prompts.compose('generate', { extra: '1girl, outdoors' });
 */
function createPrompts(options = {}) {
  const dir = path.resolve(options.dir || defaultDir());
  const storage = options.storage || null;
  const storageKey = String(options.storageKey || 'rewrite_prompt_state');
  const values = {};
  const defaults = {};
  const state = { overrides: {}, enabled: {}, custom: {} };

  function readState() {
    try {
      const saved = storage?.get?.(storageKey, {});
      if (!saved || typeof saved !== 'object') return;
      if (saved.overrides && typeof saved.overrides === 'object') state.overrides = clone(saved.overrides);
      if (saved.enabled && typeof saved.enabled === 'object') state.enabled = clone(saved.enabled);
      if (saved.custom && typeof saved.custom === 'object') state.custom = clone(saved.custom);
    } catch { /* optional persistence */ }
  }

  function writeState() {
    try { storage?.set?.(storageKey, clone(state)); } catch { /* optional persistence */ }
  }

  function load() {
    for (const [key, file] of Object.entries(PROMPT_FILES)) {
      const value = readFile(dir, file);
      defaults[key] = value;
      values[key] = value;
    }
    readState();
    return api;
  }

  function get(key, fallback = '') {
    const resolved = resolveKey(key);
    if (Object.prototype.hasOwnProperty.call(state.custom, resolved)) {
      const custom = state.custom[resolved];
      return custom.enabled === false ? fallback : text(custom.text, fallback);
    }
    if (state.enabled[resolved] === false) return fallback;
    if (Object.prototype.hasOwnProperty.call(state.overrides, resolved) && PROMPT_META[resolved]?.editableOverride !== false) return text(state.overrides[resolved], fallback);
    return Object.prototype.hasOwnProperty.call(defaults, resolved) ? defaults[resolved] : fallback;
  }

  function set(key, value) {
    const resolved = resolveKey(key);
    if (PROMPT_META[resolved] && PROMPT_META[resolved].editableOverride === false) return get(resolved);
    state.overrides[resolved] = text(value);
    values[resolved] = state.overrides[resolved];
    writeState();
    return get(resolved);
  }

  function updateCustom(key, patch = {}) {
    const resolved = resolveKey(key);
    if (!Object.prototype.hasOwnProperty.call(state.custom, resolved)) return null;
    const current = state.custom[resolved];
    if (patch.name != null) current.name = text(patch.name, current.name);
    if (patch.text != null || patch.content != null) current.text = text(patch.text != null ? patch.text : patch.content, current.text);
    if (patch.enabled != null) current.enabled = patch.enabled !== false;
    writeState();
    return item(resolved);
  }

  function update(key, patch = {}) {
    const resolved = resolveKey(key);
    if (Object.prototype.hasOwnProperty.call(state.custom, resolved)) return updateCustom(resolved, patch);
    if (!Object.prototype.hasOwnProperty.call(defaults, resolved) || PROMPT_META[resolved]?.editableOverride === false) return null;
    if (patch.text != null || patch.content != null) set(resolved, patch.text != null ? patch.text : patch.content);
    if (patch.enabled != null) setEnabled(resolved, patch.enabled !== false);
    return item(resolved);
  }

  function getDefault(key, fallback = '') {
    const resolved = resolveKey(key);
    return Object.prototype.hasOwnProperty.call(defaults, resolved) ? defaults[resolved] : fallback;
  }

  function enabled(key) {
    const resolved = resolveKey(key);
    if (Object.prototype.hasOwnProperty.call(state.custom, resolved)) return state.custom[resolved].enabled !== false;
    return state.enabled[resolved] !== false;
  }

  function setEnabled(key, value) {
    const resolved = resolveKey(key);
    if (!Object.prototype.hasOwnProperty.call(defaults, resolved) && !Object.prototype.hasOwnProperty.call(state.custom, resolved)) return null;
    if (Object.prototype.hasOwnProperty.call(state.custom, resolved)) state.custom[resolved].enabled = Boolean(value);
    else state.enabled[resolved] = Boolean(value);
    writeState();
    return item(resolved);
  }

  function reset(key) {
    const resolved = resolveKey(key);
    if (!Object.prototype.hasOwnProperty.call(defaults, resolved)) return null;
    delete state.overrides[resolved];
    state.enabled[resolved] = true;
    writeState();
    return item(resolved);
  }

  function createCustom(input = {}) {
    const source = input && typeof input === 'object' ? input : { text: input };
    const base = text(source.id || source.name, `custom-${Date.now()}`).replace(/[^\w-]+/g, '-').toLowerCase();
    let id = base;
    let suffix = 1;
    while (Object.prototype.hasOwnProperty.call(state.custom, id) || Object.prototype.hasOwnProperty.call(defaults, id)) id = `${base}-${suffix++}`;
    state.custom[id] = { id, name: text(source.name, id), text: text(source.text || source.content), enabled: source.enabled !== false, kind: 'custom' };
    writeState();
    return item(id);
  }

  function deleteCustom(key) {
    const resolved = resolveKey(key);
    if (!Object.prototype.hasOwnProperty.call(state.custom, resolved)) return false;
    delete state.custom[resolved];
    writeState();
    return true;
  }

  function listByBlock(block) {
    const keysForBlock = block === 'internal' ? INTERNAL_PROMPT_KEYS : EXTERNAL_PROMPT_KEYS;
    return keysForBlock.map(item).filter(Boolean);
  }

  function resetBlock(block) {
    for (const key of (block === 'internal' ? INTERNAL_PROMPT_KEYS : EXTERNAL_PROMPT_KEYS)) reset(key);
    return listByBlock(block);
  }

  function exportBlock(block = 'internal') {
    const keysForBlock = block === 'internal' ? INTERNAL_PROMPT_KEYS : EXTERNAL_PROMPT_KEYS;
    return { format: 'ai-tag-prompts', version: 1, block, items: Object.fromEntries(keysForBlock.map(key => [key, get(key)])) };
  }

  function importBlock(payload, block = 'internal') {
    if (!payload || payload.format !== 'ai-tag-prompts' || !payload.items || typeof payload.items !== 'object') return { ok: false, code: 'INVALID_PROMPT_BUNDLE' };
    const keysForBlock = block === 'internal' ? INTERNAL_PROMPT_KEYS : EXTERNAL_PROMPT_KEYS;
    const unknown = Object.keys(payload.items).filter(key => !keysForBlock.includes(key));
    if (unknown.length || keysForBlock.some(key => payload.items[key] != null && typeof payload.items[key] !== 'string')) return { ok: false, code: 'PROMPT_SCHEMA_INVALID', unknown };
    for (const key of keysForBlock) if (typeof payload.items[key] === 'string') set(key, payload.items[key]);
    return { ok: true, items: listByBlock(block) };
  }

  function item(key) {
    const resolved = resolveKey(key);
    const metaValue = PROMPT_META[resolved] || { label: state.custom[resolved]?.name || resolved, kind: 'custom', editable: true, editableOverride: true, deletable: true };
    return {
      id: resolved,
      key: resolved,
      name: state.custom[resolved]?.name || metaValue.label || resolved,
      text: get(resolved),
      defaultText: getDefault(resolved),
      enabled: enabled(resolved),
      builtin: Object.prototype.hasOwnProperty.call(defaults, resolved),
      ...clone(metaValue)
    };
  }

  function keys() {
    return [...Object.keys(defaults), ...Object.keys(state.custom).filter(key => !Object.prototype.hasOwnProperty.call(defaults, key))];
  }

  function meta(key) {
    const resolved = resolveKey(key);
    const itemValue = PROMPT_META[resolved];
    return itemValue ? { key: resolved, ...clone(itemValue), builtin: true, enabled: enabled(resolved) } : { key: resolved, label: state.custom[resolved]?.name || resolved, kind: 'custom', editable: true, editableOverride: true, deletable: true, builtin: false, enabled: enabled(resolved) };
  }

  function appendices() {
    return parseAppendices(get('appendices'));
  }

  function compose(modeOrParts = 'generate', composeOptions = {}) {
    let parts;
    if (Array.isArray(modeOrParts)) parts = modeOrParts;
    else if (modeOrParts && typeof modeOrParts === 'object') {
      composeOptions = modeOrParts;
      parts = composeOptions.parts || MODE_KEYS[composeOptions.mode || 'generate'];
    } else {
      parts = MODE_KEYS[modeOrParts] || [modeOrParts];
    }
    const output = normalisePartList(parts).map(part => get(part)).filter(Boolean);
    const selected = composeOptions.appendices || composeOptions.appendix;
    if (selected != null) {
      const all = appendices();
      const wanted = selected === true ? all : normalisePartList(selected);
      const chosen = all.filter(item => wanted === all || wanted.some(value => String(value) === String(item.index) || value === item.id));
      output.push(...chosen.map(item => item.text).filter(Boolean));
    }
    if (composeOptions.extra) output.push(text(composeOptions.extra));
    return output.filter(Boolean).join('\n\n');
  }

  const api = {
    dir,
    files: clone(PROMPT_FILES),
    load,
    reload: load,
    get,
    // Vision Service consumes the explicit effective-value contract. Keep get
    // as the compact internal alias while making ownership obvious to callers.
    getEffective: get,
    set,
    getDefault,
    enabled,
    setEnabled,
    reset,
    createCustom,
    updateCustom,
    update,
    deleteCustom,
    item,
    keys,
    meta,
    metadata: meta,
    appendices,
    compose,
    snapshot: () => ({ values: Object.fromEntries(keys().map(key => [key, get(key)])), defaults: clone(defaults), state: clone(state), metadata: Object.fromEntries(keys().map(key => [key, meta(key)])), appendices: appendices() })
    ,listByBlock, resetBlock, exportBlock, importBlock, internalKeys: INTERNAL_PROMPT_KEYS, externalKeys: EXTERNAL_PROMPT_KEYS
  };

  load();
  return api;
}

module.exports = {
  PROMPT_FILES,
  PROMPT_ALIASES,
  PROMPT_META,
  MODE_KEYS,
  parseAppendices,
  createPrompts
};
