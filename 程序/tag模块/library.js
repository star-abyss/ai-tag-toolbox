'use strict';
/*
 * 库 —— 记录住的地方。
 *
 *   主库    原有记录，ID 是数字
 *   自建库  用户新建的记录，ID 带 u 前缀
 *   隐藏库  被隐藏的记录
 *   修改库  被改过的记录的原文
 */

const { toKey, splitValues, joinValues } = require('./normalize.js');

const MAIN = '主库';
const OWN = '自建库';
const HIDDEN = '隐藏库';
const MODIFIED = '修改库';

/** 自建记录的 ID 前缀。 */
const OWN_PREFIX = 'u';

function isOwnId(id) { return String(id).startsWith(OWN_PREFIX); }

function createLibrary(store, options = {}) {
  let main = null;
  let own = null;

  /** 索引作废时挨个通知（检索那份缓存跟着它走）。 */
  const watchers = new Set();
  function onInvalidate(watcher) { watchers.add(watcher); }

  /** 读主库与自建库。 */
  function load() {
    main = normalizeShell(store.get(MAIN, null), MAIN);
    own = normalizeShell(store.get(OWN, null), OWN);
    return { main, own };
  }

  /** 从一个库重读 shell。 */
  function 重读(key) {
    if (key === MAIN) main = normalizeShell(store.get(MAIN, null), MAIN);
    else own = normalizeShell(store.get(OWN, null), OWN);
    invalidate();
    return key === MAIN ? main : own;
  }

  function normalizeShell(shell, name) {
    if (!shell || !Array.isArray(shell.记录列表)) {
      return { 格式: `tag-library/${name}`, 版本: 1, 计数器: 0, 记录列表: [] };
    }
    return shell;
  }

  /** ID → 记录。主库与自建库共用一张表（ID 空间不重叠）。 */
  let index = null;
  function byId() {
    if (index) return index;
    if (!main || !own) load();
    index = new Map();
    for (const record of main.记录列表) index.set(String(record.ID), record);
    for (const record of own.记录列表) index.set(String(record.ID), record);
    return index;
  }

  /** 索引作废，并通知那些跟着它走的人。 */
  function invalidate() {
    index = null;
    for (const watcher of watchers) watcher();
  }

  /** 取一条；取不到给 null。 */
  function get(id) {
    return byId().get(String(id)) || null;
  }

  function all() { return [...byId().values()]; }

  /** 两个库的条数与计数器。 */
  function stats() {
    if (!main || !own) load();
    return {
      主库: main.记录列表.length,
      自建库: own.记录列表.length,
      计数器: { 主库: main.计数器, 自建库: own.计数器 },
    };
  }

  /** 把输入整成一条记录的样子。 */
  function shape(input, id) {
    const body = joinValues(splitValues(input && (input.名称 ?? input.content)).map(toKey));
    return {
      ID: id,
      名称: body,
      中文名: joinValues([
        ...String((input && (input.中文名 ?? input.displayName)) || '').split(','),
      ]),
      成员: Array.isArray(input && input.成员) ? input.成员.map(String) : undefined,
    };
  }

  // ---------- 新建：进自建库，ID 由自建库的计数器分配 ----------

  function create(input) {
    if (!main || !own) load();
    const body = toKey(input && (input.名称 ?? input.content));
    if (!body) return { ok: false, reason: '名称不能为空' };

    const record = shape(input, null);
    if (input && Array.isArray(input.成员)) record.成员 = input.成员.map(String);
    else delete record.成员;

    own.计数器 += 1;
    record.ID = `${OWN_PREFIX}${own.计数器}`;
    own.记录列表.push(record);

    const written = store.set(OWN, own);
    if (!written.ok) {
      own.计数器 -= 1;
      own.记录列表.pop();
      return { ok: false, reason: written.reason };
    }
    重读(OWN);
    return { ok: true, record };
  }

  // ---------- 改一条 ----------

  /**
   * 整条覆盖。
   * @param {string|number} id
   * @param {object} input 新的整条记录
   * @param {(original:object)=>void} [onFirstEdit] 写盘之后回调，收到改动前的整条记录
   */
  function update(id, input, onFirstEdit) {
    if (!main || !own) load();
    const key = String(id);
    const current = get(key);
    if (!current) return { ok: false, reason: '记录不存在' };
    if (!toKey(input && (input.名称 ?? input.content))) return { ok: false, reason: '名称不能为空' };

    const before = { ...current };
    const next = { ...shape(input, current.ID) };
    if (Array.isArray(input && input.成员)) next.成员 = input.成员.map(String);
    else if (current.成员) next.成员 = [...current.成员];
    delete next.undefined;

    const shell = isOwnId(key) ? own : main;
    const position = shell.记录列表.findIndex((row) => String(row.ID) === key);
    if (position < 0) return { ok: false, reason: '记录不存在' };

    const snapshot = shell.记录列表[position];
    shell.记录列表[position] = next;
    const written = store.set(isOwnId(key) ? OWN : MAIN, shell, { 记录: [next] });
    if (!written.ok) {
      shell.记录列表[position] = snapshot;
      return { ok: false, reason: written.reason };
    }
    重读(isOwnId(key) ? OWN : MAIN);
    if (typeof onFirstEdit === 'function') onFirstEdit(before, next);
    return { ok: true, record: next, before };
  }

  // ---------- 删一条：限自建库 ----------

  function remove(id) {
    if (!main || !own) load();
    const key = String(id);
    if (!isOwnId(key)) return { ok: false, reason: '原有的记录不能删，只能隐藏' };
    const position = own.记录列表.findIndex((row) => String(row.ID) === key);
    if (position < 0) return { ok: false, reason: '记录不存在' };
    const [taken] = own.记录列表.splice(position, 1);
    const written = store.set(OWN, own);
    if (!written.ok) {
      own.记录列表.splice(position, 0, taken);
      return { ok: false, reason: written.reason };
    }
    重读(OWN);
    return { ok: true, record: taken };
  }

  return {
    MAIN, OWN,
    isOwnId,
    load, 重读, get, all, stats, invalidate, onInvalidate,
    create, update, remove,
    get main() { return main; },
    get own() { return own; },
  };
}

module.exports = { createLibrary };
