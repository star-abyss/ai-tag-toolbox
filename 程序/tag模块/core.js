'use strict';
/*
 * 核心 —— 记录 / 检索 / 隐藏 / 位置 / 注释 / 体检。
 *
 * 装配时收一个端口：createCore({ port })。
 * 对外不抛错：失败一律返回 { ok:false, reason }。
 */

const { createLibrary } = require('./library.js');
const { createSearch } = require('./search.js');
const { createPositions, POSITION_ROOTS } = require('./position.js');
const { createNotes, createFlags, createShadow } = require('./shadow.js');
const { createRender } = require('./render-order.js');
const { deepCopy } = require('./normalize.js');

/** 本模块占用的键。 */
const KEYS = {
  主库: '主库',
  自建库: '自建库',
  隐藏库: '隐藏库',
  修改库: '修改库',
  成人: '成人',
  角色: '角色',
  系列: '系列',
  注释: '注释',
  常用词: '常用词',
  分类字典: '分类字典',
  收藏字典: '收藏字典',
  索引: '索引',
};

function createCore(options = {}) {
  const rawPort = options.port;
  if (!rawPort) throw new Error('核心需要一个端口：createCore({ port })');

  /** 端口 + 一个取法：get(键, 默认)。 */
  const port = {
    ...rawPort,
    get: (key, fallback = null) => {
      const result = rawPort.read(key);
      return result.state === 'ok' ? result.value : fallback;
    },
  };

  const library = createLibrary(port);
  library.load();

  const hidden = createShadow(port, library);
  // 检索要位置树：搜作品时"那条 tag"与"那个类"是并列的两种候选
  const positions = createPositions(port);
  const search = createSearch({ library, port, hidden, commonKey: KEYS.常用词, positions });

  // 索引那份缓存跟着库的索引走：库一作废，检索也作废。
  library.onInvalidate(() => search.invalidate());

  const notes = createNotes(port, KEYS.注释);
  const flags = createFlags(port);

  // ---------- 记录 ----------

  /** 取一条（返回副本）。 */
  const get = (id) => deepCopy(library.get(id));

  // 渲染顺序：页序是常量，另外两序从位置树现读。位置一改，它的索引要作废。
  const render = createRender({ positions, get, 查词: (词) => search.findOne(词) });
  render.设作品判据((id) => flags.isSeries(id));

  /** 位置一改：渲染顺序的索引与检索里的类索引都要作废。 */
  function 位置改过了() {
    render.invalidate();
    search.invalidate();
  }

  function create(input) {
    const made = library.create(deepCopy(input));
    return made.ok ? { ok: true, 记录: deepCopy(made.record) } : made;
  }

  /** 改一条；第一次改之前把原文存进修改库。 */
  function edit(id, input) {
    const result = library.update(id, deepCopy(input), (before) => hidden.markOriginal(before));
    if (!result.ok) return { ok: false, reason: result.reason };
    return { ok: true, 记录: deepCopy(result.record) };
  }

  /** 删一条（限自建库），连带删修改库那份与注释。 */
  function remove(id) {
    const result = library.remove(id);
    if (!result.ok) return result;
    hidden.forget(id);
    notes.remove(id);
    return { ok: true, 记录: deepCopy(result.record) };
  }

  function groups() {
    const roles = new Set(flags.roles());
    const series = new Set(flags.series());
    return library.all()
      .filter((row) => Array.isArray(row.成员))
      .map((row) => ({
        ...deepCopy(row),
        是角色组: roles.has(String(row.ID)),
        是系列组: series.has(String(row.ID)),
      }));
  }

  // ---------- 检索 ----------

  /** 查库（候选里的记录是副本）。 */
  function query(needle, opts) {
    const result = search.query(needle, opts);
    return { ...result, items: result.items.map((row) => ({ ...row, 记录: deepCopy(row.记录) })) };
  }

  /** 查库带类：两种候选进同一个数组，每条带 `类型`。 */
  function queryBoth(needle, opts) {
    const result = search.queryWithClasses(needle, opts);
    return {
      ...result,
      候选: result.候选.map((row) => (row.记录 ? { ...row, 记录: deepCopy(row.记录) } : row)),
    };
  }

  /** 一个词或一批词：给一个词回一条，给一批回一批。 */
  function recognize(input) {
    if (Array.isArray(input)) {
      if (!input.length) return null;
      return search.recognize(input);
    }
    return search.recognizeOne(input);
  }

  function resolve(word) {
    const record = search.findOne(word);
    return record ? deepCopy(record) : null;
  }

  // ---------- 隐藏 / 还原 ----------

  function hide(id) {
    const result = hidden.hide(id);
    if (!result.ok) return result;
    search.invalidate();
    return { ...result, record: deepCopy(result.record) };
  }

  function unhide(id) {
    const result = hidden.unhide(id);
    if (!result.ok) return result;
    search.invalidate();
    return { ...result, record: deepCopy(result.record) };
  }

  /** 重读库并作废索引。 */
  function rebuild() {
    if (typeof port.忘记 === 'function') port.忘记();
    library.load();
    search.invalidate();
    positions.invalidate();
    位置改过了();
    return { ok: true };
  }

  // ---------- 体检 ----------

  function status() {
    const scanned = port.scan();
    const known = new Set(Object.values(KEYS));
    const wild = scanned.keys.filter((key) => {
      if (known.has(key)) return false;
      // 位置的内容格：分类.<页>.<类> / 收藏.<页>.<类>
      return !/^(分类|收藏)\.\d+\.\d+$/.test(key);
    });
    const broken = scanned.keys
      .map((key) => port.status(key))
      .filter((row) => row.state === 'unreadable' || row.frozen);
    return {
      记录: library.stats(),
      隐藏库: hidden.listHidden().length,
      修改库: hidden.listModified().length,
      位置: {
        分类页: positions.list('分类').pages.length,
        收藏页: positions.list('收藏').pages.length,
      },
      索引: search.stats(),
      磁盘上的键: scanned.keys.length,
      外置大值: scanned.external.length,
      写剩的临时文件: scanned.temp,
      野键: wild,
      坏的键: broken,
    };
  }

  return {
    // 记录
    get, create, edit, remove, groups,
    // 检索
    query, queryBoth, recognize, resolve,
    // 隐藏 / 还原
    hide, unhide,
    hidden: () => deepCopy(hidden.listHidden()),
    restore: (id) => {
      const result = hidden.restore(id);
      return result.ok ? { ...result, record: deepCopy(result.record) } : result;
    },
    modified: () => deepCopy(hidden.listModified()),
    // 位置：底层的 page / pages / 类 转成对外的 页 / 类 / 页列表
    POSITION_ROOTS,
    positions: {
      list: (root, pageId) => {
        const result = positions.list(root, pageId);
        if (!result.ok) return result;
        return result.page ? { ok: true, 页: result.page } : { ok: true, 页列表: result.pages };
      },
      createPage: (root, input) => {
        const result = positions.createPage(root, input);
        位置改过了();
        return result.ok ? { ok: true, 页: result.page } : result;
      },
      createClass: (root, pageId, input) => {
        const result = positions.createClass(root, pageId, input);
        位置改过了();
        return result.ok ? { ok: true, 类: result.类 } : result;
      },
      update: (root, id, patch) => {
        const result = positions.update(root, id, patch);
        位置改过了();
        if (!result.ok) return result;
        return result.page ? { ok: true, 页: result.page } : { ok: true, 类: result.类 };
      },
      remove: (root, id) => {
        const result = positions.remove(root, id);
        位置改过了();
        return result;
      },
      members: (root, pageId, classId) => deepCopy(positions.members(root, pageId, classId)),
      attach: (root, pageId, classId, memberId, at) => {
        const result = positions.attach(root, pageId, classId, memberId, at);
        位置改过了();
        return result;
      },
      detach: (root, pageId, classId, memberId) => {
        const result = positions.detach(root, pageId, classId, memberId);
        位置改过了();
        return result;
      },
      reorder: (root, pageId, classId, ids) => {
        const result = positions.reorder(root, pageId, classId, ids);
        位置改过了();
        return result;
      },
      whereIs: (root, memberId) => positions.whereIs(root, memberId),
      classOf: (root, pageId, memberId) => positions.classOf(root, pageId, memberId),
    },
    // 渲染顺序：一份页序（表一）· 一个角色的三段（表二）
    render: {
      pages: () => render.pages(),
      sort: (词们) => render.sort(词们),
      words: (标识) => render.words(标识),
      位置: (标识) => render.找位置(标识),
      一页归属: (页ID) => render.一页归属(页ID),
    },
    // 注释
    note: (id) => notes.get(id),
    setNote: (id, text) => notes.put(id, text),
    // 身份
    isAdult: (id) => flags.isAdult(id),
    isRole: (id) => flags.isRole(id),
    isSeries: (id) => flags.isSeries(id),
    adults: () => flags.adults(),
    roles: () => flags.roles(),
    series: () => flags.series(),
    // 体检 / 重读
    status, rebuild,
    KEYS,
  };
}

module.exports = { createCore, KEYS, POSITION_ROOTS };
