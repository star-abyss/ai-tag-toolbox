'use strict';
/*
 * 位置 —— 页与类。
 *
 *   分类字典 = { 计数器, 页列表 }        页 = { ID, 页名, 配色, 类 ID 列表 }
 *   分类.<页ID>.<类ID> = [ 成员 ID ]
 *
 * 收藏用同一套，键的根从「分类」换成「收藏」。
 */

const POSITION_ROOTS = ['分类', '收藏'];

function createPositions(store) {
  const shells = new Map();

  function dictionaryKey(root) { return `${root}字典`; }
  function cellKey(root, pageId, classId) { return `${root}.${pageId}.${classId}`; }

  function shell(root) {
    if (!shells.has(root)) {
      const loaded = store.get(dictionaryKey(root), null);
      shells.set(root, loaded && Array.isArray(loaded.页列表)
        ? loaded
        : { 格式: 'tag-library/位置', 版本: 1, 计数器: 0, 页列表: [] });
    }
    return shells.get(root);
  }

  function save(root) {
    const written = store.set(dictionaryKey(root), shell(root));
    if (!written.ok) return { ok: false, reason: written.reason };
    return { ok: true };
  }

  function checkRoot(root) {
    return POSITION_ROOTS.includes(root) ? null : `位置只有这两种：${POSITION_ROOTS.join(' / ')}`;
  }

  /** 列出全部页，或某一页底下的类。 */
  function list(root, pageId) {
    const bad = checkRoot(root);
    if (bad) return { ok: false, reason: bad };
    const rows = shell(root).页列表;
    if (pageId === undefined || pageId === null) return { ok: true, pages: rows };
    const page = rows.find((row) => String(row.ID) === String(pageId));
    return page ? { ok: true, page } : { ok: false, reason: '页不存在' };
  }

  function findPage(root, pageId) {
    return shell(root).页列表.find((row) => String(row.ID) === String(pageId)) || null;
  }

  function findClass(root, classId) {
    for (const page of shell(root).页列表) {
      const found = page.类列表.find((row) => String(row.ID) === String(classId));
      if (found) return { page, 类: found };
    }
    return null;
  }

  // ---------- 建 / 改 / 删 ----------

  function createPage(root, input = {}) {
    const bad = checkRoot(root);
    if (bad) return { ok: false, reason: bad };
    const name = String(input.页名 ?? input.name ?? '').trim();
    if (!name) return { ok: false, reason: '页名不能为空' };
    const current = shell(root);
    const page = {
      ID: current.计数器 + 1,
      页名: name,
      配色: input.配色 || { background: '#2b2f36', foreground: '#e8e8ea' },
      类列表: [],
    };
    current.计数器 += 1;
    current.页列表.push(page);
    const written = save(root);
    if (!written.ok) {
      current.页列表.pop();
      current.计数器 -= 1;
      return { ok: false, reason: written.reason };
    }
    return { ok: true, page };
  }

  function createClass(root, pageId, input = {}) {
    const bad = checkRoot(root);
    if (bad) return { ok: false, reason: bad };
    const page = findPage(root, pageId);
    if (!page) return { ok: false, reason: '页不存在' };
    const name = String(input.类名 ?? input.name ?? '').trim();
    if (!name) return { ok: false, reason: '类名不能为空' };
    const current = shell(root);
    const row = {
      ID: current.计数器 + 1,
      类名: name,
      配色: input.配色 || { background: '#287ea4', foreground: '#f2f8fb' },
    };
    current.计数器 += 1;
    page.类列表.push(row);
    const written = save(root);
    if (!written.ok) {
      page.类列表.pop();
      current.计数器 -= 1;
      return { ok: false, reason: written.reason };
    }
    return { ok: true, 类: row };
  }

  /** 改页名/类名或配色。 */
  function update(root, id, patch = {}) {
    const bad = checkRoot(root);
    if (bad) return { ok: false, reason: bad };
    const page = findPage(root, id);
    if (page) {
      if (patch.页名 !== undefined || patch.name !== undefined) page.页名 = String(patch.页名 ?? patch.name);
      if (patch.配色) page.配色 = patch.配色;
      const written = save(root);
      return written.ok ? { ok: true, page } : { ok: false, reason: written.reason };
    }
    const found = findClass(root, id);
    if (!found) return { ok: false, reason: '页或类不存在' };
    if (patch.类名 !== undefined || patch.name !== undefined) found.类.类名 = String(patch.类名 ?? patch.name);
    if (patch.配色) found.类.配色 = patch.配色;
    const written = save(root);
    return written.ok ? { ok: true, 类: found.类 } : { ok: false, reason: written.reason };
  }

  /** 删页（连同它底下的类格）或删类。 */
  function remove(root, id) {
    const bad = checkRoot(root);
    if (bad) return { ok: false, reason: bad };
    const current = shell(root);
    const pageIndex = current.页列表.findIndex((row) => String(row.ID) === String(id));
    if (pageIndex >= 0) {
      const taken = current.页列表[pageIndex];
      current.页列表.splice(pageIndex, 1);
      const written = save(root);
      if (!written.ok) { current.页列表.splice(pageIndex, 0, taken); return { ok: false, reason: written.reason }; }
      // 没删掉的格，形如 "<页ID>.<类ID>（理由）"
      const 没删掉 = [];
      for (const row of taken.类列表) {
        const gone = store.remove(cellKey(root, taken.ID, row.ID));
        if (!gone.ok) 没删掉.push(`${taken.ID}.${row.ID}（${gone.reason}）`);
      }
      if (没删掉.length) return { ok: true, removed: '页', 带走类: taken.类列表.length, 还有格没删掉: 没删掉 };
      return { ok: true, removed: '页', 带走类: taken.类列表.length };
    }
    for (const page of current.页列表) {
      const index = page.类列表.findIndex((row) => String(row.ID) === String(id));
      if (index < 0) continue;
      const taken = page.类列表[index];
      page.类列表.splice(index, 1);
      const written = save(root);
      if (!written.ok) { page.类列表.splice(index, 0, taken); return { ok: false, reason: written.reason }; }
      const gone = store.remove(cellKey(root, page.ID, taken.ID));
      if (!gone.ok) return { ok: true, removed: '类', 还有格没删掉: [`${page.ID}.${taken.ID}（${gone.reason}）`] };
      return { ok: true, removed: '类' };
    }
    return { ok: false, reason: '页或类不存在' };
  }

  // ---------- 成员 ----------

  function members(root, pageId, classId) {
    return store.get(cellKey(root, pageId, classId), null) || [];
  }

  /** 把一个成员放进类里；已在其中且未指定位置时不动。 */
  function attach(root, pageId, classId, memberId, position) {
    const found = findClass(root, classId);
    if (!found) return { ok: false, reason: '类不存在' };
    if (String(found.page.ID) !== String(pageId)) return { ok: false, reason: '这个类不在这页底下' };
    const list = members(root, pageId, classId).slice();
    const key = String(memberId);
    const at = list.findIndex((value) => String(value) === key);
    if (at >= 0) {
      if (position === undefined) return { ok: true, list };
      list.splice(at, 1);
    }
    if (position === undefined || position === null || position >= list.length) list.push(key);
    else list.splice(Math.max(0, position), 0, key);
    const written = store.set(cellKey(root, pageId, classId), list);
    return written.ok ? { ok: true, list } : { ok: false, reason: written.reason };
  }

  /** 把一个成员从类里拿掉。 */
  function detach(root, pageId, classId, memberId) {
    const list = members(root, pageId, classId);
    const next = list.filter((value) => String(value) !== String(memberId));
    if (next.length === list.length) return { ok: true, list };
    const written = store.set(cellKey(root, pageId, classId), next);
    return written.ok ? { ok: true, list: next } : { ok: false, reason: written.reason };
  }

  /** 整格重排。 */
  function reorder(root, pageId, classId, ids) {
    if (!Array.isArray(ids)) return { ok: false, reason: '要一个 ID 列表' };
    const found = findClass(root, classId);
    if (!found) return { ok: false, reason: '类不存在' };
    if (String(found.page.ID) !== String(pageId)) return { ok: false, reason: '这个类不在这页底下' };
    const written = store.set(cellKey(root, pageId, classId), ids.map(String));
    return written.ok ? { ok: true, list: ids.map(String) } : { ok: false, reason: written.reason };
  }

  /** 这个成员被摆在哪些页与类里。 */
  function whereIs(root, memberId) {
    const found = [];
    for (const page of shell(root).页列表) {
      for (const row of page.类列表) {
        const list = members(root, page.ID, row.ID);
        if (list.some((value) => String(value) === String(memberId))) {
          found.push({ 页: page.ID, 页名: page.页名, 类: row.ID, 类名: row.类名 });
        }
      }
    }
    return found;
  }

  /**
   * 这个成员在某一页底下落在哪个类里（先读到的那一个）。没摆给 null。
   * 一页底下的类可能上千个（页「角色组」有 4050 个），所以不走 whereIs 那一趟全扫。
   */
  function classOf(root, pageId, memberId) {
    const page = findPage(root, pageId);
    if (!page) return null;
    for (const row of page.类列表) {
      const list = members(root, pageId, row.ID);
      if (list.some((value) => String(value) === String(memberId))) {
        return { 页: page.ID, 页名: page.页名, 类: row.ID, 类名: row.类名 };
      }
    }
    return null;
  }

  function invalidate(root) {
    if (root) shells.delete(root); else shells.clear();
  }

  return {
    list, createPage, createClass, update, remove,
    members, attach, detach, reorder, whereIs, classOf, invalidate,
    findPage, findClass,
  };
}

module.exports = { createPositions, POSITION_ROOTS };
