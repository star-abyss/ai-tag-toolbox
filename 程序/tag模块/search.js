'use strict';
/*
 * 检索 —— 两个入口。
 *
 *   查库(一个查询串) → 记录列表 + 有没有更多
 *   认词(一批词)     → 每个词一条：中文名 或 null
 */

const { toKey, toFlatKey, splitValues, firstValue, keySegments } = require('./normalize.js');

/** 常用词表最多取多少条。 */
const COMMON_LIMIT = 2000;

function createSearch(options) {
  const library = options.library;
  const store = options.port || options.store;
  const hidden = options.hidden;
  const COMMON_KEY = options.commonKey || '常用词';
  const positions = options.positions || null;

  let entries = null;       // 参与检索的记录
  let classEntries = null;  // 参与检索的类（页 + 类）
  let common = null;        // ID → 常用词名次
  let byKey = null;         // 比对键 → 记录
  let byFlat = null;        // 连写键 → 记录
  let segments = null;      // 切词（按 _ 切开的段）→ 记录
  let classByKey = null;    // 比对键 → 类
  let classByFlat = null;   // 连写键 → 类
  let classSegments = null; // 切词 → 类

  /**
   * 建类的索引。只索引 `类名`（页名不进检索）。
   * 页「角色组」底下那些作品类**要进**：搜作品时"那条 tag"与"那个类"是并列的两种候选。
   */
  function buildClasses() {
    classEntries = [];
    classByKey = new Map();
    classByFlat = new Map();
    classSegments = new Map();
    if (!positions) return;
    const 根 = positions.list('分类');
    if (!根 || !根.ok || !Array.isArray(根.pages)) return;
    for (const 页 of 根.pages) {
      const 页序 = 根.pages.indexOf(页);
      for (const 类 of 页.类列表 || []) {
        const 名 = toKey(String(类.类名 || ''));
        if (!名) continue;
        const entry = {
          标识: `${页.ID}.${类.ID}`,
          类ID: String(类.ID),
          类名: String(类.类名),
          页ID: String(页.ID),
          页名: 页.页名,
          键: 名,
          长度: 名.length,
          页序,
        };
        classEntries.push(entry);
        const add = (table, key) => {
          if (!key) return;
          let list = table.get(key);
          if (!list) { list = []; table.set(key, list); }
          list.push(entry);
        };
        add(classByKey, entry.键);
        add(classByFlat, toFlatKey(entry.键));
        for (const part of keySegments(entry.键)) add(classSegments, part, entry);
      }
    }
  }

  /** 建索引：等值、连写、切词三张表。 */
  function build() {
    const commonList = store.get(COMMON_KEY, []) || [];
    common = new Map();
    commonList.slice(0, COMMON_LIMIT).forEach((id, order) => common.set(String(id), order));

    const blocked = new Set((hidden.listHidden() || []).map((row) => String(row.ID)));
    entries = [];
    byKey = new Map();
    byFlat = new Map();
    segments = new Map();
    buildClasses();

    const add = (table, key, value) => {
      if (!key) return;
      let list = table.get(key);
      if (!list) { list = []; table.set(key, list); }
      list.push(value);
    };

    for (const record of library.all()) {
      const id = String(record.ID);
      if (blocked.has(id)) continue;      // 隐藏的不进索引
      if (record.回显 === false) continue; // 回显为 false 的不进索引

      const names = splitValues(record.名称);
      const chinese = splitValues(record.中文名);
      const nameValues = names.map((word) => ({ word, key: toKey(word) })).filter((item) => item.key);
      const chineseValues = chinese.map((word) => ({ word, key: toKey(word) })).filter((item) => item.key);
      const entry = {
        record,
        id,
        name: nameValues[0]?.key || '',
        nameAll: nameValues.map((item) => item.key),
        aliases: nameValues.slice(1).map((item) => item.key),
        nameValues,
        zh: chineseValues.map((item) => item.key),
        zhFirst: chineseValues[0]?.key || '',
        chineseValues,
        keyLength: 0,
        rank: 0,
      };
      // 排序用的代表长度：名称主值，没有就用中文名主值
      entry.keyLength = entry.name.length || entry.zhFirst.length || 999;
      const commonOrder = common.get(id);
      entry.rank = commonOrder === undefined ? Number.MAX_SAFE_INTEGER : commonOrder;
      entries.push(entry);

      for (const value of [entry.name, ...entry.nameAll, ...entry.zh]) add(byKey, value, entry);
      for (const value of [entry.name, ...entry.nameAll, ...entry.zh]) add(byFlat, toFlatKey(value), entry);
      for (const part of keySegments(entry.name)) add(segments, part, entry);
      for (const part of keySegments(entry.zhFirst)) add(segments, part, entry);
    }

    return { entries: entries.length, classes: classEntries.length };
  }

  /** 数据变了就把索引作废。 */
  function invalidate() { entries = null; }

  function ensure() {
    if (!entries) build();
  }

  function isOwn(id) { return library.isOwnId(id); }

  /** 同档内的名次：常用词 → 长度 → 主库优先 → ID。 */
  function rankCompare(a, b) {
    return (
      a.rank - b.rank
      || a.keyLength - b.keyLength
      || Number(isOwn(a.id)) - Number(isOwn(b.id))
      || String(a.id).localeCompare(String(b.id), 'en')
    );
  }

  function sortCandidates(rows) {
    return rows.sort((a, b) => a.tier - b.tier || rankCompare(a.entry, b.entry));
  }

  /**
   * 命中的这一段在词里的位置。
   *   0 = 词首（`miku_day` 里的 miku）
   *   1 = 词尾（`hatsune_miku` 里的 miku）
   *   2 = 夹在中间（`my_cat_ears` 里的 cat）
   *   3 = 整条就是这一段（`miku`）
   * @returns {number}
   */
  function segmentAt(name, key) {
    const parts = name.split('_');
    if (parts.length === 1) return 3;
    const at = parts.indexOf(key);
    if (at < 0) return 2;
    if (at === 0) return 0;
    return at === parts.length - 1 ? 1 : 2;
  }

  /**
   * 查库：一个查询串 → 最多 limit 条记录，按分档排序。
   * @param {string} needle
   * @param {{limit?:number}} [opts]
   * @returns {{items:Array, more:boolean, total:number}}
   */
  function query(needle, opts = {}) {
    ensure();
    const limit = Number.isFinite(opts.limit) ? opts.limit : 30;
    const key = toKey(needle);
    if (!key) return { items: [], more: false, total: 0 };
    const flat = toFlatKey(needle);

    const best = new Map(); // entry → { entry, tier, field }
    const offer = (entry, tier, field, priority = 9, hitType = '近似', hitWord = key) => {
      const seen = best.get(entry);
      if (seen && (seen.tier < tier || (seen.tier === tier && seen.priority <= priority))) return;
      best.set(entry, { entry, tier, field, priority, hitType, hitWord });
    };

    // 档 1：全等
    for (const entry of byKey.get(key) || []) {
      if (entry.name === key) offer(entry, 1, '名称', 0, '规范名', entry.nameValues[0].word);
      else if (entry.zhFirst === key) offer(entry, 1, '中文名', 1, '主中文名', entry.chineseValues[0].word);
      else if (entry.aliases.includes(key)) {
        const value = entry.nameValues.find((item, index) => index > 0 && item.key === key);
        offer(entry, 1, '别名', 2, '确认别名', value.word);
      } else if (entry.zh.includes(key)) {
        const value = entry.chineseValues.find((item, index) => index > 0 && item.key === key);
        offer(entry, 1, '中文名', 3, '其他检索写法', value.word);
      }
    }

    // 档 2 / 3：切词命中
    for (const entry of segments.get(key) || []) {
      const at = segmentAt(entry.name, key);
      if (at === 3) continue;
      const source = entry.nameValues.find((item) => keySegments(item.key).includes(key))
        || entry.chineseValues.find((item) => keySegments(item.key).includes(key));
      offer(entry, at === 0 ? 2 : 3, '名称', 9, '近似', source?.word || key);
    }

    // 档 4：连写相等
    if (flat) for (const entry of byFlat.get(flat) || []) {
      const source = [...entry.nameValues, ...entry.chineseValues]
        .find((item) => toFlatKey(item.key) === flat);
      offer(entry, 4, '名称', 9, '近似', source?.word || key);
    }

    // 档 5：兜底
    for (const entry of entries) {
      if (best.has(entry)) continue;
      const source = [...entry.nameValues, ...entry.chineseValues]
        .find((item) => item.key.includes(key));
      if (source) best.set(entry, {
        entry,
        tier: 5,
        field: entry.name.includes(key) ? '名称' : '中文名',
        priority: 9,
        hitType: '近似',
        hitWord: source.word,
      });
    }

    const sorted = [...best.values()].sort((a, b) => a.tier - b.tier
      || a.priority - b.priority || rankCompare(a.entry, b.entry));
    const page = sorted.slice(0, limit);
    return {
      items: page.map((row) => ({
        记录: row.entry.record,
        档: row.tier,
        命中: row.field,
        命中类型: row.hitType,
        命中词: row.hitWord,
      })),
      more: sorted.length > limit,
      total: sorted.length,
    };
  }

  /** 类的同一条排序口径：常用词不适用于类，用"名称短者优先 → 页序 → 类 ID"。 */
  function classCompare(a, b) {
    return a.长度 - b.长度 || a.页序 - b.页序 || String(a.类ID).localeCompare(String(b.类ID), 'en');
  }

  /**
   * 查类：与查库同一套 5 档，但只比 `类名`。
   * @param {string} needle
   * @returns {Array<{类:object, 档:number}>}
   */
  function queryClasses(needle) {
    if (!classEntries) buildClasses();
    const key = toKey(needle);
    if (!key) return [];
    const flat = toFlatKey(needle);
    const best = new Map();

    for (const entry of classByKey.get(key) || []) best.set(entry, { entry, tier: 1 });

    for (const entry of classSegments.get(key) || []) {
      const at = segmentAt(entry.键, key);
      if (at === 3) continue;
      const tier = at === 0 ? 2 : 3;
      const seen = best.get(entry);
      if (!seen || seen.tier > tier) best.set(entry, { entry, tier });
    }

    if (flat) for (const entry of classByFlat.get(flat) || []) {
      const seen = best.get(entry);
      if (!seen) best.set(entry, { entry, tier: 4 });
    }

    for (const entry of classEntries) {
      if (best.has(entry)) continue;
      if (entry.键.includes(key)) best.set(entry, { entry, tier: 5 });
    }

    return [...best.values()].sort((a, b) => a.tier - b.tier || classCompare(a.entry, b.entry));
  }

  /**
   * 查库带类：两种候选进同一个数组，每条带 `类型`（记录 / 类）。
   * 同档内记录排在类前面。
   */
  function queryWithClasses(needle, opts = {}) {
    const 记录结果 = query(needle, { limit: Number.MAX_SAFE_INTEGER });
    const 类结果 = queryClasses(needle);
    const 限制 = Number.isFinite(opts.limit) ? opts.limit : 30;
    const 候选 = 记录结果.items
      .map((row) => ({
        类型: '记录', 档: row.档, 记录: row.记录, 命中: row.命中,
        命中类型: row.命中类型, 命中词: row.命中词,
      }))
      .concat(类结果.map((row) => ({
        类型: '类',
        档: row.tier,
        类: { ID: row.entry.类ID, 类名: row.entry.类名, 页ID: row.entry.页ID, 页名: row.entry.页名 },
      })));
    候选.sort((a, b) => {
      if (a.档 !== b.档) return a.档 - b.档;
      if (a.类型 !== b.类型) return a.类型 === '记录' ? -1 : 1;
      return 0;
    });
    return {
      候选: 候选.slice(0, 限制),
      还有更多: 候选.length > 限制,
      合计: 候选.length,
    };
  }

  /** 一个规范写法或明确别名 → 唯一记录；近似与歧义返回 null。 */
  function findOne(word) {
    try {
      ensure();
      const key = toKey(word);
      if (!key) return null;
      const 唯一 = (匹配) => {
        const records = [...new Set(entries.filter(匹配).map((entry) => entry.record))];
        return records.length === 1 ? records[0] : null;
      };
      const 主名命中 = entries.filter((entry) => entry.name === key);
      const 主名 = 唯一((entry) => entry.name === key);
      if (主名 || 主名命中.length) return 主名;
      return 唯一((entry) => entry.aliases.includes(key) || entry.zhFirst === key);
    } catch (_) {
      return null;
    }
  }

  /**
   * 认词：一个词 → 中文名 或 null。
   * @param {string} word
   * @returns {string|null}
   */
  function recognizeOne(word) {
    try {
      const record = findOne(word);
      return record ? firstValue(record.中文名) || null : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * 认词：一批词 → 每个词一条。顺序与输入一一对应。
   * @param {string[]} words
   * @returns {Array<string|null>}
   */
  function recognize(words) {
    if (!Array.isArray(words)) return [];
    return words.map((word) => recognizeOne(word));
  }

  /** 索引条数。 */
  function stats() {
    ensure();
    return { indexed: entries.length };
  }

  return { build, invalidate, query, queryWithClasses, recognize, recognizeOne, findOne, stats };
}

module.exports = { createSearch };
