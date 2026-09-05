'use strict';

/**
 * Tags 业务模块
 *
 * 这是一个刻意保持小而直接的标签目录。它只负责标签数据和标签状态，
 * 不知道 DOM、Electron、localStorage，也不依赖旧版全局变量。
 *
 * 数据行兼容素材仓库里的格式：
 *   [英文 Tag, 中文名, 别名(空格分隔), 分类, 子分类, 是否成人]
 * 也接受等价的对象格式。
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DEFAULT_CATEGORIES = [
  { id: 'quality', name: '质量词', icon: '⭐' },
  { id: 'negative', name: '负面提示词', icon: '🚫', neg: true },
  { id: 'character', name: '人物与角色', icon: '👥' },
  { id: 'series', name: '作品系列', icon: '📺' },
  { id: 'body', name: '身材与身体', icon: '🧍' },
  { id: 'expression', name: '表情', icon: '😊' },
  { id: 'eyes', name: '眼睛', icon: '👁️' },
  { id: 'hair', name: '头发', icon: '💇' },
  { id: 'features', name: '角色特征', icon: '🦊' },
  { id: 'outfit', name: '服装', icon: '👗' },
  { id: 'footwear', name: '鞋袜', icon: '🧦' },
  { id: 'accessory', name: '道具与装饰', icon: '🎀' },
  { id: 'pose', name: '动作与姿势', icon: '🤸' },
  { id: 'scene', name: '场景与环境', icon: '🏞️' },
  { id: 'camera', name: '视角与镜头', icon: '🎥' },
  { id: 'style', name: '画风与风格', icon: '🖌️' },
  { id: 'time_weather', name: '时间与天气', icon: '🌤️' },
  { id: 'atmosphere', name: '氛围与光影', icon: '✨' },
  { id: 'effects', name: '特效与魔法', icon: '🔥' },
  { id: 'food', name: '食物与饮料', icon: '🍰' },
  { id: 'animal', name: '动物', icon: '🐾' },
  { id: 'other', name: '其他', icon: '🏷️' },
  { id: 'rating', name: '内容分级', icon: '🅰️' },
  { id: 'nsfw', name: '成人标签', icon: '🔞', nsfw: true },
  { id: 'character_names', name: '角色名', icon: '🏷️' }
];

const CHARACTER_NAMES_CATEGORY = 'character_names';

// WD 标签文件中的 category 数字只用于识图结果。给它们一个稳定、
// 易读的分类名即可，详细 UI 分类仍以标签目录中的分类为准。
const MODEL_CATEGORY_NAMES = {
  0: 'wd_general',
  1: 'wd_sensitive',
  2: 'wd_questionable',
  3: 'wd_explicit',
  4: 'character',
  5: 'wd_artist',
  6: 'wd_copyright',
  7: 'wd_character',
  8: 'wd_meta',
  9: 'rating'
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).trim();
  return result || fallback;
}

function asList(value) {
  if (Array.isArray(value)) return value.slice();
  if (value == null || value === '') return [];
  return String(value)
    .split(/[\s,，、;；]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function bool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'yes', 'on', 'adult', 'nsfw'].includes(String(value || '').toLowerCase());
}

function tagKey(value) {
  return text(value).toLocaleLowerCase();
}

/** Convert user search input to a comparable phrase. */
function searchKey(value) {
  return text(value)
    .normalize('NFKC')
    // A weighted prompt token such as (blue_hair:1.2) is still blue_hair.
    .replace(/:\s*[-+]?\d+(?:\.\d+)?\s*[)]/g, ')')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[ _-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

const SEARCH_PRECISIONS = Object.freeze(["exact", "standard", "broad"]);

function normaliseSearchPrecision(value) {
  const raw = text(value, "standard").toLowerCase();
  if (["exact", "strict", "high", "2", "精确", "高"].includes(raw)) return "exact";
  if (["broad", "loose", "fuzzy", "low", "0", "宽松", "低"].includes(raw)) return "broad";
  return "standard";
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

function normaliseTag(row, source = 'base', index = 0) {
  if (typeof row === 'string') row = { en: row };
  if (Array.isArray(row)) {
    row = {
      en: row[0],
      zh: row[1],
      aliases: row[2],
      category: row[3],
      subcategory: row[4],
      nsfw: row[5]
    };
  }
  if (!isObject(row)) return null;

  const en = text(row.en ?? row.tag ?? row.name ?? row.id);
  if (!en) return null;
  const id = tagKey(row.id || en);
  const categoryCode = Number.isInteger(Number(row.categoryCode))
    ? Number(row.categoryCode)
    : Number.isInteger(Number(row.category))
      ? Number(row.category)
      : null;
  const category = text(
    row.categoryId ?? row.categoryName ?? (categoryCode == null ? row.category ?? row.cat : MODEL_CATEGORY_NAMES[categoryCode]),
    source === 'model' && categoryCode != null ? MODEL_CATEGORY_NAMES[categoryCode] || `wd_${categoryCode}` : 'other'
  );
  const subcategory = text(row.subcategory ?? row.sub ?? row.group, '默认');
  const normalizedCategory = category === 'character' && subcategory === '角色名'
    ? CHARACTER_NAMES_CATEGORY
    : category;
  const aliases = asList(row.aliases ?? row.alias ?? row.al);
  const adult = bool(row.nsfw ?? row.adult ?? row.isAdult) || category === 'nsfw' || categoryCode === 3;
  return {
    id,
    en,
    zh: text(row.zh ?? row.cn ?? row.translation),
    aliases: [...new Set(aliases.map(text).filter(Boolean))],
    category: normalizedCategory,
    subcategory,
    nsfw: adult,
    categoryCode,
    count: Number.isFinite(Number(row.count ?? row.hits)) ? Number(row.count ?? row.hits) : null,
    confidence: Number.isFinite(Number(row.confidence ?? row.prob)) ? Number(row.confidence ?? row.prob) : null,
    source,
    custom: source === 'custom'
  };
}

function modelRows(value) {
  if (Array.isArray(value)) return value;
  if (!isObject(value)) return [];
  return Object.entries(value).map(([index, row]) => {
    if (Array.isArray(row)) return { en: row[0], categoryCode: row[1], count: row[2], modelIndex: Number(index) };
    if (isObject(row)) return { ...row, modelIndex: Number(index) };
    return null;
  }).filter(Boolean);
}

/**
 * Evaluate one of the trusted, local data asset files from the material store.
 * The files intentionally remain plain JS so they can still be edited by hand.
 */
function readScriptData(filePath, names = []) {
  const source = fs.readFileSync(path.resolve(filePath), 'utf8');
  const context = {};
  const wanted = names.length ? names : ['TAGS', 'EXTRA_TAGS', 'SYNONYMS', 'SYNONYMS_BY_EN', 'SYNONYM_ALIASES', 'BASE_CATEGORIES'];
  const assignment = `\n;globalThis.__tagAssets = {${wanted.map(name => `${name}: typeof ${name} !== 'undefined' ? ${name} : undefined`).join(',')}};`;
  vm.runInNewContext(`${source}${assignment}`, context, { filename: filePath });
  return context.__tagAssets || {};
}

function readDataSource(source, names) {
  if (source == null) return {};
  if (typeof source === 'string') {
    const resolved = path.resolve(source);
    if (resolved.toLowerCase().endsWith('.json')) return JSON.parse(fs.readFileSync(resolved, 'utf8'));
    return readScriptData(resolved, names);
  }
  return source;
}

/** Load the three tag files (and optional model file) from 素材仓库. */
function loadTagFiles(options = {}) {
  const assetDir = options.assetDir || 'C:/Users/admin/Desktop/素材仓库';
  const tagDir = options.tagDir || path.join(assetDir, '数据资产', '标签');
  const modelFile = options.model || path.join(assetDir, '模型', 'tags-canary.json');
  const base = readDataSource(options.base || options.baseFile || path.join(tagDir, 'data-tags.js'), ['TAGS', 'BASE_CATEGORIES']);
  const extra = readDataSource(options.extra || options.extraFile || path.join(tagDir, 'extra-tags.js'), ['EXTRA_TAGS']);
  const synonyms = readDataSource(options.synonyms || options.synonymsFile || path.join(tagDir, 'synonyms.js'), ['SYNONYMS', 'SYNONYMS_BY_EN', 'SYNONYM_ALIASES']);
  const keywordSource = options.keywords || options.keywordFile;
  const keywordPath = typeof keywordSource === 'string'
    ? keywordSource
    : path.join(tagDir, 'search-keywords.js');
  const keywords = isObject(keywordSource)
    ? keywordSource
    : keywordPath && fs.existsSync(path.resolve(keywordPath))
      ? readDataSource(keywordPath, ['SEARCH_KEYWORDS', 'TAG_KEYWORDS'])
      : {};
  const model = options.includeModel === false || !modelFile ? null : readDataSource(modelFile, []);
  return {
    categories: base.BASE_CATEGORIES || base.categories,
    base: base.TAGS || base.tags || base,
    extra: extra.EXTRA_TAGS || extra.tags || extra,
    model: model && (model.tags || model),
    synonyms: {
      reverse: synonyms.SYNONYMS || synonyms.reverse,
      byEn: synonyms.SYNONYMS_BY_EN || synonyms.byEn,
      aliases: synonyms.SYNONYM_ALIASES || synonyms.aliases
    },
    keywords: keywords.SEARCH_KEYWORDS || keywords.TAG_KEYWORDS || keywords.keywords || keywords
  };
}

function normaliseSynonyms(value) {
  if (!isObject(value)) return { byEn: {}, aliases: {}, reverse: {} };
  // Allow callers to pass the raw SYNONYMS object as a convenience.
  if (!value.byEn && !value.aliases && !value.reverse) return { byEn: value, aliases: {}, reverse: {} };
  return {
    byEn: isObject(value.byEn) ? value.byEn : {},
    aliases: isObject(value.aliases) ? value.aliases : {},
    reverse: isObject(value.reverse) ? value.reverse : {}
  };
}

/** Convert the editable keyword asset into a normalized tag -> terms map. */
function normaliseKeywords(value) {
  if (!isObject(value)) return new Map();
  const result = new Map();
  for (const [key, terms] of Object.entries(value)) {
    const ids = [...new Set([tagKey(key), searchKey(key)].filter(Boolean))];
    const list = [...new Set(asList(terms).map(text).filter(Boolean))];
    ids.forEach(id => {
      if (list.length) result.set(id, [...new Set([...(result.get(id) || []), ...list])]);
    });
  }
  return result;
}

function createTags(options = {}) {
  const storage = options.storage && typeof options.storage.get === 'function' && typeof options.storage.set === 'function' ? options.storage : null;
  const state = {
    categories: DEFAULT_CATEGORIES.map(clone),
    originals: new Map(),
    custom: new Map(),
    tags: new Map(),
    selected: new Set(),
    loaded: false,
    synonyms: { byEn: {}, aliases: {}, reverse: {} },
    keywords: new Map(),
    searchPrecision: "standard",
    revision: 0,
    searchRows: [],
    searchCache: new Map(),
    countCache: new Map()
  };

  function stored(key, fallback) {
    try { return storage ? storage.get(key, fallback) : fallback; } catch { return fallback; }
  }
  function persist(key, value) {
    try { if (storage) storage.set(key, value); } catch { /* 存储失败不阻塞标签操作 */ }
  }
  function persistUserState() {
    persist('rewrite_selected', [...state.selected]);
    persist('rewrite_custom_tags', [...state.custom.values()].map(clone));
    persist('rewrite_adult', Boolean(state.includeAdult));
  }

  function restoreUserState() {
    const customs = stored('rewrite_custom_tags', []);
    if (Array.isArray(customs)) customs.forEach(item => { const tag = normaliseTag({ ...(isObject(item) ? item : { en: item }), custom: true }, 'custom'); if (tag) state.custom.set(tag.id, tag); });
    rebuild();
    const selected = stored('rewrite_selected', []);
    if (Array.isArray(selected)) selected.map(tagKey).filter(id => state.tags.has(id)).forEach(id => state.selected.add(id));
    state.includeAdult = Boolean(stored('rewrite_adult', state.includeAdult || false));
    state.searchPrecision = normaliseSearchPrecision(stored('app.searchPrecision', state.searchPrecision));
  }

  function categoryRows(input) {
    if (!Array.isArray(input)) return [];
    return input.map(item => {
      if (typeof item === 'string') return { id: tagKey(item), name: item };
      if (Array.isArray(item)) return { id: tagKey(item[0]), name: text(item[1], item[0]) };
      return { id: tagKey(item.id || item.code), name: text(item.name, item.id), ...item };
    }).filter(item => item.id);
  }

  function rebuild() {
    state.tags = new Map(state.originals);
    for (const [id, tag] of state.custom) {
      const base = state.tags.get(id);
      state.tags.set(id, base ? { ...base, ...tag, aliases: [...new Set([...(base.aliases || []), ...(tag.aliases || [])])] } : tag);
    }
    for (const id of [...state.selected]) if (!state.tags.has(id)) state.selected.delete(id);
    state.searchRows = [...state.tags.values()].map(tag => {
      const fields = [tag.en, tag.zh, ...tagAliases(tag)].map(searchKey).filter(Boolean);
      // 宽松模式的分类/子分类字段和紧凑索引按首次使用时建立，
      // 避免启动时为近两万条标签做不必要的额外归一化。
      return { tag, fields };
    });
    state.searchCache.clear();
    state.countCache.clear();
    state.revision += 1;
  }

  function addRows(rows, source) {
    for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
      const tag = normaliseTag(row, source, index);
      if (!tag) continue;
      const id = tag.id;
      const existing = state.originals.get(id);
      // Extra/model rows fill missing data but do not erase the hand-curated base row.
      if (!existing) state.originals.set(id, tag);
      else state.originals.set(id, {
        ...existing,
        zh: existing.zh || tag.zh,
        aliases: [...new Set([...(existing.aliases || []), ...(tag.aliases || [])])],
        category: existing.category === 'other' ? tag.category : existing.category,
        subcategory: existing.subcategory === '默认' ? tag.subcategory : existing.subcategory,
        nsfw: existing.nsfw || tag.nsfw,
        categoryCode: existing.categoryCode ?? tag.categoryCode,
        count: existing.count ?? tag.count
      });
    }
  }

  function load(sources = {}) {
    const input = sources || {};
    state.originals.clear();
    state.custom.clear();
    state.synonyms = normaliseSynonyms(input.synonyms || {});
    state.keywords = normaliseKeywords(input.keywords || input.searchKeywords || {});
    const categories = categoryRows(input.categories || input.categoryDefinitions || input.baseCategories);
    if (categories.length) state.categories = categories;
    if (!state.categories.some(item => item.id === CHARACTER_NAMES_CATEGORY)) {
      state.categories.push({ id: CHARACTER_NAMES_CATEGORY, name: '角色名', icon: '🏷️' });
    }
    addRows(input.base || input.builtin || input.tags, 'base');
    addRows(input.extra || input.extensions, 'extra');
    addRows(modelRows(input.model || input.modelTags || input.wdTags), 'model');
    rebuild();
    // 数据源就绪后恢复用户自己的标签状态；旧数据不存在时保持空状态。
    restoreUserState();
    state.loaded = true;
    return api;
  }

  function tagAliases(tag) {
    const byEn = state.synonyms.byEn[tag.en] || state.synonyms.byEn[tag.id] || [];
    const aliases = state.synonyms.aliases[tag.en] || state.synonyms.aliases[tag.id] || [];
    return [...new Set([...(tag.aliases || []), ...asList(byEn), ...asList(aliases)])];
  }

  function tagKeywords(tag) {
    const keys = [tag.id, tag.en].flatMap(value => [tagKey(value), searchKey(value)]).filter(Boolean);
    return [...new Set(keys.flatMap(key => state.keywords.get(key) || []))];
  }

  function compactSearchKey(value) {
    return searchKey(value).replace(/[\s._-]+/g, '');
  }

  function ensureBroadIndex(row) {
    if (row.broadFields && row.compactFields && row.keywordFields) return row;
    const category = state.categories.find(item => item.id === row.tag.category);
    row.keywordFields = [...tagKeywords(row.tag), row.tag.category, category?.name, row.tag.subcategory]
      .map(searchKey)
      .filter(Boolean);
    row.broadFields = [...row.fields, ...row.keywordFields]
      .map(searchKey)
      .filter(Boolean);
    row.compactFields = row.broadFields.map(compactSearchKey).filter(Boolean);
    return row;
  }

  function view(tag) {
    if (!tag) return null;
    return { ...clone(tag), aliases: tagAliases(tag), keywords: tagKeywords(tag), selected: state.selected.has(tag.id) };
  }

  function visible(tag, includeAdult) {
    return includeAdult || !tag.nsfw;
  }

  function list(listOptions = {}) {
    const includeAdult = Boolean(listOptions.includeAdult || listOptions.adult || listOptions.nsfw);
    const category = text(listOptions.category || listOptions.categoryId);
    const result = [];
    for (const tag of state.tags.values()) {
      if (!visible(tag, includeAdult)) continue;
      if (category && tag.category !== category) continue;
      result.push(view(tag));
    }
    return result;
  }

  function countByCategory(includeAdult = false) {
    const key = includeAdult ? 'adult' : 'safe';
    if (state.countCache.has(key)) return { ...state.countCache.get(key) };
    const counts = { all: 0 };
    for (const tag of state.tags.values()) {
      if (!visible(tag, includeAdult)) continue;
      counts.all += 1;
      counts[tag.category] = (counts[tag.category] || 0) + 1;
    }
    state.countCache.set(key, counts);
    return { ...counts };
  }

  function subcategories(categoryValue, options = {}) {
    const includeAdult = Boolean(options.includeAdult || options.adult || options.nsfw);
    const category = text(categoryValue || options.category || options.categoryId);
    const counts = new Map();
    for (const tag of state.tags.values()) {
      if (!visible(tag, includeAdult)) continue;
      if (category && category !== 'all' && tag.category !== category) continue;
      const name = text(tag.subcategory, '默认');
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count }));
  }

  function searchIds(query, searchOptions = {}) {
    const needle = searchKey(query);
    const includeAdult = Boolean(searchOptions.includeAdult || searchOptions.adult || searchOptions.nsfw);
    const precision = normaliseSearchPrecision(searchOptions.precision || searchOptions.searchPrecision || state.searchPrecision);
    const categoryValue = text(searchOptions.category || searchOptions.categoryId);
    const category = categoryValue === 'all' ? '' : categoryValue;
    const subcategoryValue = text(searchOptions.subcategory || searchOptions.sub || searchOptions.group);
    const subcategory = subcategoryValue === 'all' ? '' : subcategoryValue;
    const cacheKey = [needle, includeAdult ? "adult" : "safe", category, subcategory, precision].join("|");
    if (state.searchCache.has(cacheKey)) return state.searchCache.get(cacheKey).slice();
    if (!needle) {
      const ids = state.searchRows.filter(row => visible(row.tag, includeAdult)
        && (!category || row.tag.category === category)
        && (!subcategory || row.tag.subcategory === subcategory)).map(row => row.tag.id);
      state.searchCache.set(cacheKey, ids);
      return ids.slice();
    }
    const terms = needle.split(' ').filter(Boolean);
    const compactNeedle = compactSearchKey(needle);
    const compactTerms = terms.map(compactSearchKey).filter(Boolean);
    const result = [];
    for (const row of state.searchRows) {
      const tag = row.tag;
      if (!visible(tag, includeAdult)
        || (category && tag.category !== category)
        || (subcategory && tag.subcategory !== subcategory)) continue;
      if (precision === "exact") {
        if (!row.fields.some(field => field === needle)) continue;
        result.push({ id: tag.id, score: 100, en: tag.en });
        continue;
      }
      const indexedRow = precision === "broad" ? ensureBroadIndex(row) : row;
      const fields = precision === "broad" ? indexedRow.broadFields : row.fields;
      const termsMatch = terms.every(term => fields.some(field => field.includes(term)));
      if (!termsMatch) {
        if (precision !== "broad") continue;
        const compactMatch = compactTerms.every(term => indexedRow.compactFields.some(field => field.includes(term)));
        if (!compactMatch) continue;
      }
      let score = 40;
      for (const field of fields) {
        if (field === needle) score = Math.max(score, 100);
        else if (field.startsWith(needle)) score = Math.max(score, 76);
        else if (field.includes(needle)) score = Math.max(score, 54);
      }
      if (precision === "broad") {
        if (compactNeedle && indexedRow.compactFields.some(field => field === compactNeedle)) score = Math.max(score, 68);
        else if (compactNeedle && indexedRow.compactFields.some(field => field.includes(compactNeedle))) score = Math.max(score, 58);
        if (indexedRow.keywordFields.some(field => field.includes(needle))) score = Math.max(score, 52);
      }
      if (terms.length > 1) score += terms.filter(term => fields.some(field => field.startsWith(term))).length;
      result.push({ id: tag.id, score, en: tag.en });
    }
    result.sort((left, right) => right.score - left.score || left.en.localeCompare(right.en));
    const ids = result.map(item => item.id);
    state.searchCache.set(cacheKey, ids);
    return ids.slice();
  }

  function page(pageOptions = {}) {
    const query = pageOptions.query == null ? state.query || '' : text(pageOptions.query);
    const includeAdult = pageOptions.includeAdult == null ? Boolean(state.includeAdult) : Boolean(pageOptions.includeAdult);
    const category = text(pageOptions.category || pageOptions.categoryId);
    const subcategory = text(pageOptions.subcategory || pageOptions.sub || pageOptions.group);
    const ids = searchIds(query, {
      includeAdult,
      category: query ? '' : category,
      subcategory: query ? '' : subcategory,
      precision: pageOptions.precision || pageOptions.searchPrecision || state.searchPrecision
    });
    const offset = Math.max(0, Number(pageOptions.offset) || 0);
    const requested = Number(pageOptions.limit);
    const requestedLimit = Number.isFinite(requested) && requested > 0 ? requested : 200;
    // “全部”和搜索结果、角色名是高数量入口，仍保留 1000 条展示上限；
    // 其他主分类允许按页面层的批次继续加载到该分类的完整结果。
    const maxDisplay = !category || category === 'all' || category === CHARACTER_NAMES_CATEGORY ? 1000 : Number.POSITIVE_INFINITY;
    const total = ids.length;
    const displayTotal = Math.min(total, maxDisplay);
    const limit = Math.max(1, Math.min(maxDisplay, requestedLimit));
    const items = ids.slice(offset, Math.min(offset + limit, displayTotal)).map(id => view(state.tags.get(id))).filter(Boolean);
    return { items, total, displayTotal, offset, limit, maxDisplay, hasMore: offset + items.length < displayTotal, categoryCounts: countByCategory(includeAdult), query, category, subcategory, includeAdult };
  }

  function search(query, searchOptions = {}) {
    const ids = searchIds(query, searchOptions);
    const limit = Number(searchOptions.limit);
    const chosen = Number.isFinite(limit) && limit > 0 ? ids.slice(0, limit) : ids;
    return chosen.map(id => view(state.tags.get(id))).filter(Boolean);
  }

  // 页面层只保存查询条件，实际标签状态仍由模块持有。
  function setQuery(query) {
    state.query = text(query);
    const filters = { ...(state.filters || {}) };
    // 有搜索词时跨分类检索；清空后再恢复当前分类。
    if (state.query) delete filters.category;
    else if (state.category && state.category !== 'all') filters.category = state.category;
    state.filters = filters;
    return search(state.query, filters);
  }
  function setSearchPrecision(value, options = {}) {
    state.searchPrecision = normaliseSearchPrecision(value);
    state.filters = { ...(state.filters || {}), precision: state.searchPrecision };
    if (options.persist !== false) persist('app.searchPrecision', state.searchPrecision);
    return state.searchPrecision;
  }
  function setCategory(category) {
    state.category = text(category, 'all');
    const filters = { ...(state.filters || {}) };
    if (state.category === 'all') delete filters.category; else filters.category = state.category;
    state.filters = filters;
    return search(state.query || '', filters);
  }
  function setAdult(enabled) { state.includeAdult = Boolean(enabled); state.filters = { ...(state.filters || {}), includeAdult: state.includeAdult }; persistUserState(); return search(state.query || '', state.filters); }

  function resolve(value) {
    const id = tagKey(typeof value === 'string' ? value : value && (value.id || value.en || value.tag));
    return id ? state.tags.get(id) : null;
  }

  function select(value, selected = true) {
    const tag = resolve(value);
    if (!tag) return false;
    if (selected) state.selected.add(tag.id); else state.selected.delete(tag.id);
    persistUserState();
    return view(tag);
  }

  function addCustom(value) {
    const tag = normaliseTag({ ...(isObject(value) ? value : { en: value }), custom: true }, 'custom');
    if (!tag) return null;
    const original = state.originals.get(tag.id);
    if (original) {
      tag.en = original.en;
      tag.category = tag.category === 'other' ? original.category : tag.category;
      tag.subcategory = tag.subcategory === '默认' ? original.subcategory : tag.subcategory;
      tag.zh = tag.zh || original.zh;
    }
    state.custom.set(tag.id, tag);
    rebuild();
    return view(state.tags.get(tag.id));
  }

  function removeCustom(value) {
    const id = tagKey(typeof value === 'string' ? value : value && (value.id || value.en));
    if (!id || !state.custom.has(id)) return false;
    state.custom.delete(id);
    rebuild();
    return true;
  }

  const api = {
    load,
    loadFiles: fileOptions => load(loadTagFiles(fileOptions)),
    list,
    all: list,
    allTags: list,
    getAll: list,
    search,
    setQuery,
    setCategory,
    setAdult,
    setSearchPrecision,
    searchPrecisions: () => SEARCH_PRECISIONS.slice(),
    page,
    categoryCounts: countByCategory,
    subcategories,
    getSubcategories: subcategories,
    stateSnapshot: () => ({ query: state.query || '', category: state.category || '', includeAdult: Boolean(state.includeAdult), searchPrecision: state.searchPrecision, revision: state.revision, selected: [...state.selected], categories: state.categories.map(clone), categoryCounts: countByCategory(Boolean(state.includeAdult)) }),
    customTags: () => [...state.custom.values()].map(view),
    get: value => view(resolve(value)),
    categories: () => state.categories.map(clone),
    getCategories: () => state.categories.map(clone),
    select,
    toggleSelected: value => {
      const current = resolve(value);
      return current ? select(current, !state.selected.has(current.id)) : false;
    },
    selected: () => [...state.selected].map(id => view(state.tags.get(id))).filter(Boolean),
    selectedText: (separator = ', ') => [...state.selected].map(id => state.tags.get(id)?.en).filter(Boolean).join(separator),
    clearSelection: () => { state.selected.clear(); persistUserState(); return []; },
    addCustom(value) { const result = addCustom(value); persistUserState(); return result; },
    removeCustom(value) { const result = removeCustom(value); persistUserState(); return result; },
    restore: () => { restoreUserState(); return api.snapshot(); },
    has: value => Boolean(resolve(value)),
    size: () => state.tags.size,
    isLoaded: () => state.loaded,
    snapshot: () => ({
      size: state.tags.size,
      allTags: list({ includeAdult: true }),
      categories: state.categories.map(clone),
      query: state.query || '',
      category: state.category || '',
      includeAdult: Boolean(state.includeAdult),
      searchPrecision: state.searchPrecision,
      revision: state.revision,
      selected: [...state.selected],
      custom: [...state.custom.keys()]
    })
  };

  if (options.sources) load(options.sources);
  else if (options.files) api.loadFiles(options.files);
  return api;
}

module.exports = {
  DEFAULT_CATEGORIES,
  MODEL_CATEGORY_NAMES,
  createTags,
  loadTagFiles,
  normaliseTag,
  searchKey,
  SEARCH_PRECISIONS,
  normaliseSearchPrecision,
  normaliseKeywords,
  readScriptData
};
