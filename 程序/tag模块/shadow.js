'use strict';
/*
 * 注释 · 身份表 · 隐藏库 · 修改库
 *
 * 注释：一条记录一条，空文本等于删除，不参与检索。
 * 身份表：成人标签表、角色表、系列表，只读。
 * 隐藏库：被隐藏的整条记录。
 * 修改库：被改过的记录的原文。
 */

function createNotes(store, key = '注释') {
  function all() { return store.get(key, null) || {}; }
  function save(table) { return store.set(key, table); }

  function get(id) {
    const table = all();
    const text = table[String(id)];
    return typeof text === 'string' && text ? text : null;
  }

  /** 空文本等于删除。 */
  function put(id, text) {
    const table = { ...all() };
    const body = String(text == null ? '' : text);
    if (!body.trim()) delete table[String(id)];
    else table[String(id)] = body;
    const written = save(table);
    return written.ok ? { ok: true, text: get(id) } : { ok: false, reason: written.reason };
  }

  function remove(id) {
    const table = { ...all() };
    delete table[String(id)];
    const written = save(table);
    return written.ok ? { ok: true } : { ok: false, reason: written.reason };
  }

  return { get, put, remove, all };
}

function createFlags(store) {
  function ids(key) {
    const value = store.get(key, null);
    return Array.isArray(value) ? value.map(String) : [];
  }
  const adultSet = () => new Set(ids('成人'));
  const roleSet = () => new Set(ids('角色'));
  const seriesSet = () => new Set(ids('系列'));
  return {
    /** 成人标签表。 */
    isAdult: (id) => adultSet().has(String(id)),
    adults: () => ids('成人'),
    /** 角色表：哪些组是角色组。 */
    isRole: (id) => roleSet().has(String(id)),
    roles: () => ids('角色'),
    /** 系列表：哪些组是系列组。 */
    isSeries: (id) => seriesSet().has(String(id)),
    series: () => ids('系列'),
  };
}

/** 隐藏库与修改库。 */
function createShadow(store, library) {
  const HIDDEN = '隐藏库';
  const MODIFIED = '修改库';

  function shell(key, name) {
    const loaded = store.get(key, null);
    return loaded && Array.isArray(loaded.记录列表)
      ? loaded
      : { 格式: `tag-library/${name}`, 版本: 1, 记录列表: [] };
  }

  function listHidden() { return shell(HIDDEN, '隐藏库').记录列表; }

  function findHidden(id) {
    return listHidden().find((row) => String(row.ID) === String(id)) || null;
  }

  function listModified() { return shell(MODIFIED, '修改库').记录列表; }

  function findModified(id) {
    return listModified().find((row) => String(row.ID) === String(id)) || null;
  }

  // ---------- 隐藏 ----------

  /** 把一条记录从来源库移进隐藏库。 */
  function hide(id) {
    const key = String(id);
    const record = library.get(key);
    if (!record) return { ok: false, reason: '记录不存在' };
    if (findHidden(key)) return { ok: true, already: true };

    const own = library.isOwnId(key);
    const source = own ? library.own : library.main;
    const index = source.记录列表.findIndex((row) => String(row.ID) === key);
    if (index < 0) return { ok: false, reason: '记录不存在' };

    const hidden = shell(HIDDEN, '隐藏库');
    const [taken] = source.记录列表.splice(index, 1);
    hidden.记录列表.push(taken);

    const written = store.set(HIDDEN, hidden);
    if (!written.ok) { source.记录列表.splice(index, 0, taken); hidden.记录列表.pop(); return { ok: false, reason: written.reason }; }
    const back = store.set(own ? library.OWN : library.MAIN, source, { 删掉: [key] });
    if (!back.ok) {
      // 回滚：隐藏库那份收回，来源库那条放回
      hidden.记录列表.pop();
      store.set(HIDDEN, hidden);
      source.记录列表.splice(index, 0, taken);
      return { ok: false, reason: back.reason };
    }
    library.重读(own ? library.OWN : library.MAIN);
    return { ok: true, record: taken };
  }

  /** 把记录按 ID 前缀放回来源库。 */
  function unhide(id) {
    const key = String(id);
    const hidden = shell(HIDDEN, '隐藏库');
    const index = hidden.记录列表.findIndex((row) => String(row.ID) === key);
    if (index < 0) return { ok: false, reason: '它不在隐藏库里' };
    const record = hidden.记录列表[index];
    const own = library.isOwnId(key);
    const target = own ? library.own : library.main;
    if (target.记录列表.some((row) => String(row.ID) === key)) return { ok: false, reason: '来源库里已经有这个 ID 了' };

    hidden.记录列表.splice(index, 1);
    target.记录列表.push(record);

    const written = store.set(own ? library.OWN : library.MAIN, target, { 记录: [record] });
    if (!written.ok) { target.记录列表.pop(); hidden.记录列表.splice(index, 0, record); return { ok: false, reason: written.reason }; }
    const back = store.set(HIDDEN, hidden);
    if (!back.ok) {
      target.记录列表.pop();
      store.set(own ? library.OWN : library.MAIN, target);
      hidden.记录列表.splice(index, 0, record);
      return { ok: false, reason: back.reason };
    }
    library.重读(own ? library.OWN : library.MAIN);
    return { ok: true, record };
  }

  // ---------- 修改 ----------

  /** 把改动前的整条记录存进修改库；该 ID 已存过就不再存。 */
  function markOriginal(record) {
    const key = String(record.ID);
    if (findModified(key)) return { ok: true, already: true };
    const modified = shell(MODIFIED, '修改库');
    modified.记录列表.push(JSON.parse(JSON.stringify(record)));
    const written = store.set(MODIFIED, modified);
    if (!written.ok) { modified.记录列表.pop(); return { ok: false, reason: written.reason }; }
    return { ok: true };
  }

  /** 用修改库那份覆盖来源库，然后删掉那一份。 */
  function restore(id) {
    const key = String(id);
    const modified = shell(MODIFIED, '修改库');
    const index = modified.记录列表.findIndex((row) => String(row.ID) === key);
    if (index < 0) return { ok: false, reason: '它没有被改过' };
    const original = modified.记录列表[index];

    const result = library.update(key, original);
    if (!result.ok) return { ok: false, reason: result.reason };
    const [taken] = modified.记录列表.splice(index, 1);
    const written = store.set(MODIFIED, modified);
    if (!written.ok) {
      modified.记录列表.splice(index, 0, taken);
      return { ok: false, reason: `记录已还原，但修改库那份没删掉：${written.reason}` };
    }
    return { ok: true, record: original };
  }

  /** 从修改库里删掉某个 ID 的那一份。 */
  function forget(id) {
    const key = String(id);
    const modified = shell(MODIFIED, '修改库');
    const next = modified.记录列表.filter((row) => String(row.ID) !== key);
    if (next.length === modified.记录列表.length) return { ok: true };
    modified.记录列表 = next;
    return store.set(MODIFIED, modified);
  }

  return {
    listHidden, findHidden, hide, unhide, isHidden: (id) => Boolean(findHidden(id)),
    listModified, findModified, markOriginal, restore, forget,
  };
}

module.exports = { createNotes, createFlags, createShadow };
