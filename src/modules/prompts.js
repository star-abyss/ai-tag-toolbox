'use strict';

/**
 * 提示词素材模块（V2：主提示词组 + 扩展提示词）。
 *
 * 主提示词组（Main Prompt Set）：
 *   - 固定包含 5 个条目：primary / generateTags / artistQuality / vision / translation；
 *   - 条目不允许单独增加或删除，只允许整组批量切换、批量导入导出；
 *   - 每个条目内容可以单独编辑，编辑只影响当前提示词组；
 *   - 允许多个提示词组，当前使用的提示词组是主 AI 与固定子代理的提示词来源；
 *   - 新建提示词组时自动创建 5 个空白条目。
 *
 * 扩展提示词（Extension Prompt）：
 *   - 独立列表，允许新增、删除、编辑、导入、导出、单独启用/停用；
 *   - 只对主 AI 生效，不发送给识图、翻译、文生图 Tag 子代理；
 *   - 两种启用方式：常驻（always）或关键词匹配（keywords，系统判断是否命中，
 *     AI 不参与判断）；匹配成功的扩展提示词才会进入主 AI 请求。
 *
 * 存储结构（storageKey 默认 rewrite_prompt_state）：
 *   { version: 2, sets: [{ id, name, items: { primary, generateTags,
 *     artistQuality, vision, translation } }], activeSetId, extensions: [
 *     { id, name, text, enabled, activation: { mode, keywords } } ] }
 *
 * 兼容旧版：旧版状态 { overrides, enabled, custom } 会在首次读取时自动迁移为
 * 一个「默认提示词」组和若干常驻扩展提示词。
 */

const fs = require('node:fs');
const path = require('node:path');

const PROMPT_ITEM_KEYS = Object.freeze(['primary', 'generateTags', 'artistQuality', 'vision', 'translation']);
const PROMPT_FILES = Object.freeze({
  primary: '10-主AI固定提示词-PRIMARY_AGENT.txt',
  generateTags: '09-固定生成Tag子代理-GENERATE_TAGS_AGENT.txt',
  artistQuality: '11-画师与品质词参考提示词-ARTIST_QUALITY.txt',
  vision: '04-识图描述提示词-DEFAULT_VISION_PROMPT.txt',
  translation: '08-固定翻译子代理-TRANSLATION_AGENT.txt'
});
const PROMPT_META = Object.freeze({
  primary: { label: '主 AI 提示词', kind: 'main' },
  generateTags: { label: '文生图提示词（主提示词）', kind: 'main' },
  artistQuality: { label: '文生图提示词的画师与品质词部分', kind: 'main' },
  vision: { label: '识图提示词', kind: 'main' },
  translation: { label: '翻译提示词', kind: 'main' }
});
const PROMPT_ALIASES = Object.freeze({
  main: 'primary',
  system: 'primary',
  mainPrompt: 'primary',
  gen: 'generateTags',
  generate: 'generateTags',
  generation: 'generateTags',
  task: 'generateTags',
  generateTagsPrompt: 'generateTags',
  artist: 'artistQuality',
  artistQualityPrompt: 'artistQuality',
  quality: 'artistQuality',
  defaultVision: 'vision',
  image: 'vision',
  visionPrompt: 'vision'
});

const BUNDLE_FORMAT = 'ai-tag-prompts';
const BUNDLE_VERSION = 2;
const SET_FORMAT = 'ai-tag-prompt-set';
const SET_VERSION = 1;
const EXT_FORMAT = 'ai-tag-prompt-extensions';
const EXT_VERSION = 1;

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).replace(/^\uFEFF/, '').trim();
  return result || fallback;
}
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}
function parseKeywords(value) {
  return String(value == null ? '' : value)
    .split(/[,，、;；\n]+/)
    .map(item => text(item))
    .filter(Boolean);
}
function slug(value) {
  return text(value).replace(/[^\w-]+/g, '-').toLowerCase().replace(/^-+|-+$/g, '');
}

function createPrompts(options = {}) {
  const dir = path.resolve(options.dir || defaultDir());
  const storage = options.storage || null;
  const storageKey = String(options.storageKey || 'rewrite_prompt_state');
  const defaults = {};
  let loaded = false;
  // 当前状态：V2 结构。
  let state = { version: 2, sets: [], activeSetId: '', extensions: [] };

  function defaultDir() {
    return path.resolve(__dirname, '..', '..', 'assets', '提示词素材');
  }
  function readFile(file) {
    try {
      return text(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      // 素材缺失时返回空文本，页面仍然可以启动和继续开发。
      return '';
    }
  }
  function loadDefaults() {
    for (const [key, file] of Object.entries(PROMPT_FILES)) defaults[key] = readFile(file);
    loaded = true;
  }
  function writeState() {
    try { storage?.set?.(storageKey, clone(state)); } catch { /* optional persistence */ }
  }

  function defaultSet() {
    const items = {};
    for (const key of PROMPT_ITEM_KEYS) items[key] = defaults[key] || '';
    return { id: 'prompt-set-default', name: '默认提示词', items };
  }
  function blankSet(name) {
    const items = {};
    for (const key of PROMPT_ITEM_KEYS) items[key] = '';
    const id = uniqueSetId('prompt-set');
    return { id, name: text(name, '提示词组 ' + (state.sets.length + 1)), items };
  }
  function uniqueSetId(base) {
    let id = text(base, 'prompt-set');
    let index = 1;
    while (state.sets.some(set => set.id === id)) id = base + '-' + (++index);
    return id;
  }
  function normalizeActivation(value) {
    const mode = isObject(value) && (value.mode === 'always' || value.mode === 'keywords') ? value.mode : 'always';
    const keywords = isObject(value) ? parseKeywords(Array.isArray(value.keywords) ? value.keywords.join(',') : value.keywords) : [];
    return { mode, keywords };
  }
  function normalizeExtension(entry) {
    const item = isObject(entry) ? entry : {};
    if (!item.id && item.name) item.id = item.name;
    const id = text(item.id) || 'ext-' + Date.now().toString(36);
    return {
      id: slug(id) || id.replace(/[^\w-]+/g, '-').toLowerCase(),
      name: text(item.name, id),
      text: text(item.text || item.content),
      enabled: item.enabled !== false,
      activation: normalizeActivation(item.activation)
    };
  }
  function normalizeSet(entry, useDefaults) {
    const item = isObject(entry) ? entry : {};
    const sourceItems = isObject(item.items) ? item.items : {};
    const items = {};
    for (const key of PROMPT_ITEM_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(sourceItems, key)) {
        // 缺失的键用素材默认补齐；显式写成空字符串的条目保持空白。
        items[key] = useDefaults ? (defaults[key] || '') : '';
      } else {
        items[key] = text(sourceItems[key]);
      }
    }
    return { id: text(item.id) || 'prompt-set-imported', name: text(item.name, '导入的提示词组'), items };
  }

  function freshState() {
    const set = defaultSet();
    return { version: 2, sets: [set], activeSetId: set.id, extensions: [] };
  }
  function parseV2(saved) {
    const sets = saved.sets.map(entry => normalizeSet(entry, true));
    let activeSetId = text(saved.activeSetId);
    if (!sets.some(set => set.id === activeSetId)) activeSetId = sets[0].id;
    const extensions = Array.isArray(saved.extensions) ? saved.extensions.map(normalizeExtension) : [];
    return { version: 2, sets, activeSetId, extensions };
  }
  function migrateLegacy(saved) {
    const set = defaultSet();
    const overrides = isObject(saved.overrides) ? saved.overrides : {};
    // 旧版无 artistQuality 单独条目，保持素材默认值。
    for (const key of ['primary', 'generateTags', 'vision', 'translation']) {
      if (overrides[key] != null && String(overrides[key]).trim()) set.items[key] = text(overrides[key]);
    }
    const custom = isObject(saved.custom) ? Object.values(saved.custom) : [];
    const extensions = custom.filter(isObject).map(entry => {
      const normalized = normalizeExtension(entry);
      normalized.activation = { mode: 'always', keywords: [] };
      return normalized;
    });
    return { version: 2, sets: [set], activeSetId: set.id, extensions };
  }
  function readState() {
    if (!loaded) loadDefaults();
    let saved = null;
    try { saved = storage?.get?.(storageKey, null); } catch { saved = null; }
    if (!saved || typeof saved !== 'object') { state = freshState(); writeState(); return; }
    if (Array.isArray(saved.sets) && saved.sets.length) { state = parseV2(saved); writeState(); return; }
    if (isObject(saved.overrides) || isObject(saved.custom) || isObject(saved.enabled)) { state = migrateLegacy(saved); writeState(); return; }
    state = freshState(); writeState();
  }
  function activeSet() {
    return state.sets.find(set => set.id === state.activeSetId) || state.sets[0] || null;
  }
  function resolveKey(key) {
    const value = text(key);
    return PROMPT_ITEM_KEYS.includes(value) ? value : (PROMPT_ALIASES[value] || value);
  }
  function get(key, fallback = '') {
    const resolved = resolveKey(key);
    const set = activeSet();
    return set && Object.prototype.hasOwnProperty.call(set.items, resolved) ? text(set.items[resolved], fallback) : fallback;
  }
  function set(key, value) {
    const resolved = resolveKey(key);
    const set = activeSet();
    if (!set || !Object.prototype.hasOwnProperty.call(set.items, resolved)) return get(resolved);
    set.items[resolved] = text(value);
    writeState();
    return get(resolved);
  }
  function getDefault(key, fallback = '') {
    const resolved = resolveKey(key);
    return Object.prototype.hasOwnProperty.call(defaults, resolved) ? defaults[resolved] : fallback;
  }
  function item(key) {
    const resolved = resolveKey(key);
    const metaValue = PROMPT_META[resolved] || { label: resolved, kind: 'main' };
    return {
      id: resolved,
      key: resolved,
      name: metaValue.label || resolved,
      text: get(resolved),
      defaultText: getDefault(resolved),
      enabled: true,
      builtin: true,
      ...clone(metaValue)
    };
  }
  function items() {
    return PROMPT_ITEM_KEYS.map(item);
  }
  function keys() {
    return PROMPT_ITEM_KEYS.slice();
  }
  function meta(key) {
    const resolved = resolveKey(key);
    const metaValue = PROMPT_META[resolved] || { label: resolved, kind: 'main' };
    return { key: resolved, ...clone(metaValue), builtin: true, enabled: true };
  }

  function sets() {
    return clone(state.sets);
  }
  function activeSetId() {
    return state.activeSetId || state.sets[0]?.id || '';
  }
  function activeSetInfo() {
    return clone(activeSet() || null);
  }
  function createSet(input = {}) {
    const source = isObject(input) ? input : { name: input };
    const set = blankSet(text(source.name));
    state.sets.push(set);
    writeState();
    return clone(set);
  }
  function deleteSet(id) {
    const target = text(id);
    if (state.sets.length <= 1 || !state.sets.some(set => set.id === target)) return false;
    state.sets = state.sets.filter(set => set.id !== target);
    if (state.activeSetId === target) state.activeSetId = state.sets[0].id;
    writeState();
    return true;
  }
  function renameSet(id, name) {
    const set = state.sets.find(entry => entry.id === text(id));
    if (!set) return null;
    set.name = text(name, set.name);
    writeState();
    return clone(set);
  }
  function setActive(id) {
    const target = text(id);
    if (!state.sets.some(set => set.id === target)) return false;
    state.activeSetId = target;
    writeState();
    return true;
  }
  function resetSet(id, options = {}) {
    const set = state.sets.find(entry => entry.id === text(id));
    if (!set) return null;
    for (const key of PROMPT_ITEM_KEYS) set.items[key] = options.blank === true ? '' : (defaults[key] || '');
    writeState();
    return clone(set);
  }
  function resetItem(key, options = {}) {
    const resolved = resolveKey(key);
    const set = activeSet();
    if (!set || !Object.prototype.hasOwnProperty.call(set.items, resolved)) return null;
    set.items[resolved] = options.blank === true ? '' : (defaults[resolved] || '');
    writeState();
    return item(resolved);
  }

  function extensions() {
    return clone(state.extensions);
  }
  function createExtension(input = {}) {
    const source = isObject(input) ? input : { text: input };
    const entry = normalizeExtension({ ...source, id: source.id || 'ext-' + Date.now().toString(36) });
    let out = entry;
    let index = 1;
    while (state.extensions.some(item => item.id === out.id)) out = { ...entry, id: entry.id + '-' + (++index) };
    state.extensions.push(out);
    writeState();
    return clone(out);
  }
  function updateExtension(id, patch = {}) {
    const target = text(id);
    const entry = state.extensions.find(item => item.id === target);
    if (!entry) return null;
    if (patch.name != null) entry.name = text(patch.name, entry.name);
    if (patch.text != null || patch.content != null) entry.text = text(patch.text != null ? patch.text : patch.content);
    if (patch.enabled != null) entry.enabled = patch.enabled !== false;
    if (patch.activation != null) entry.activation = normalizeActivation(patch.activation);
    if (patch.mode != null || patch.keywords != null) {
      entry.activation = normalizeActivation({
        mode: patch.mode != null ? patch.mode : entry.activation.mode,
        keywords: patch.keywords != null ? patch.keywords : entry.activation.keywords
      });
    }
    writeState();
    return clone(entry);
  }
  function deleteExtension(id) {
    const target = text(id);
    const index = state.extensions.findIndex(item => item.id === target);
    if (index < 0) return false;
    state.extensions.splice(index, 1);
    writeState();
    return true;
  }

  /**
   * 系统判断哪些扩展提示词生效：启用 + （常驻 或 关键词命中用户输入）。
   * 返回 [{ id, name, text }]，AI 不参与任何判断。
   */
  function matchExtensions(userText = '') {
    const source = text(userText).toLowerCase();
    return state.extensions
      .filter(entry => entry.enabled === true && text(entry.text))
      .map(entry => ({ entry, activation: normalizeActivation(entry.activation) }))
      .filter(({ entry, activation }) => activation.mode === 'always' || activation.keywords.some(keyword => keyword && source.includes(keyword.toLowerCase())))
      .map(({ entry }) => ({ id: entry.id, name: text(entry.name, entry.id), text: text(entry.text) }));
  }

  function composePrimary(userText = '') {
    const matched = matchExtensions(userText);
    const primary = get('primary');
    const parts = [];
    if (matched.length) parts.push('【扩展提示词｜系统匹配｜低优先级】\n' + matched.map(entry => entry.text).join('\n\n'));
    if (primary) parts.push('【主 AI 提示词｜高优先级，始终优先】\n' + primary);
    return parts.join('\n\n');
  }
  function composeGenerate() {
    return [get('generateTags'), get('artistQuality')].filter(Boolean).join('\n\n');
  }

  function exportBundle() {
    return { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, activeSetId: activeSetId(), sets: clone(state.sets), extensions: clone(state.extensions) };
  }
  function exportSet(id) {
    const set = state.sets.find(entry => entry.id === text(id));
    if (!set) return null;
    return { format: SET_FORMAT, version: SET_VERSION, id: set.id, name: set.name, items: clone(set.items) };
  }
  function normalizeSetList(list) {
    const used = new Set();
    const result = [];
    for (const entry of Array.isArray(list) ? list : []) {
      const set = normalizeSet(entry, true);
      if (!set.id || used.has(set.id)) set.id = uniqueSetId((set.id || 'prompt-set') + '-imported');
      used.add(set.id);
      result.push(set);
    }
    return result;
  }
  function importBundle(value) {
    const source = typeof value === 'string' ? JSON.parse(value) : value;
    if (!source || typeof source !== 'object') throw new Error('提示词包无效');
    if (source.format === BUNDLE_FORMAT) {
      if (source.version === BUNDLE_VERSION) {
        if (!Array.isArray(source.sets) || !source.sets.length) throw new Error('提示词包中没有提示词组');
        state = parseV2({ ...source, sets: normalizeSetList(source.sets) });
        writeState();
        return snapshot();
      }
      if (source.version === 1) {
        // 旧版 v1 包：internal 4 条 → 默认组，external → 常驻扩展。
        const internal = isObject(source.internal) ? source.internal : {};
        const set = defaultSet();
        for (const key of ['primary', 'generateTags', 'vision', 'translation']) {
          const entry = internal[key];
          if (entry && isObject(entry) && entry.text != null) set.items[key] = entry.text;
        }
        const custom = Array.isArray(source.external) ? source.external : [];
        const extensions = custom.filter(isObject).map(entry => {
          const normalized = normalizeExtension(entry);
          normalized.activation = { mode: 'always', keywords: [] };
          return normalized;
        });
        state = { version: 2, sets: [set], activeSetId: set.id, extensions };
        writeState();
        return snapshot();
      }
      throw new Error('提示词包版本不受支持');
    }
    if (source.format === SET_FORMAT) {
      const set = normalizeSet(source, false);
      set.id = uniqueSetId(text(source.id) || 'prompt-set-imported');
      state.sets.push(set);
      writeState();
      return snapshot();
    }
    throw new Error('提示词包格式无效');
  }
  function exportExtensions() {
    return { format: EXT_FORMAT, version: EXT_VERSION, extensions: clone(state.extensions) };
  }
  function importExtensions(value) {
    const source = typeof value === 'string' ? JSON.parse(value) : value;
    if (!source || typeof source !== 'object') throw new Error('扩展提示词包无效');
    const list = source.format === EXT_FORMAT && source.version === EXT_VERSION && Array.isArray(source.extensions)
      ? source.extensions
      : (source.format === BUNDLE_FORMAT && source.version === BUNDLE_VERSION && Array.isArray(source.extensions)) ? source.extensions : null;
    if (!list) throw new Error('扩展提示词包格式无效');
    let count = 0;
    for (const entry of list) {
      if (!isObject(entry)) continue;
      const next = createExtension(entry);
      if (next) count += 1;
    }
    return { ok: true, count };
  }

  function snapshot() {
    const result = {
      version: 2,
      sets: clone(state.sets),
      activeSetId: activeSetId(),
      activeSet: activeSetInfo(),
      items: {},
      extensions: clone(state.extensions),
      defaults: clone(defaults),
      metadata: {},
      keywordIds: PROMPT_ITEM_KEYS
    };
    for (const key of PROMPT_ITEM_KEYS) { result.items[key] = item(key); result.metadata[key] = meta(key); }
    return result;
  }

  function load() {
    loadDefaults();
    readState();
    return api;
  }

  const api = {
    dir,
    files: clone(PROMPT_FILES),
    load,
    reload: () => { loadDefaults(); return api; },
    get,
    getEffective: get,
    set,
    getDefault,
    item,
    items,
    keys,
    meta,
    metadata: meta,
    // 主提示词组。
    sets,
    activeSetId,
    activeSet: activeSetInfo,
    createSet,
    deleteSet,
    renameSet,
    setActive,
    resetSet,
    resetItem,
    reset: resetItem,
    // 扩展提示词。
    extensions,
    createExtension,
    updateExtension,
    deleteExtension,
    matchExtensions,
    // 组合。
    composePrimary,
    composeGenerate,
    // 包导入导出。
    exportBundle,
    exportSet,
    importBundle,
    exportExtensions,
    importExtensions,
    snapshot
  };

  load();
  return api;
}

module.exports = {
  PROMPT_ITEM_KEYS,
  PROMPT_FILES,
  PROMPT_ALIASES,
  PROMPT_META,
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  SET_FORMAT,
  EXT_FORMAT,
  parseKeywords,
  createPrompts
};