'use strict';
/*
 * 标签模块 · 门面。对外只有这一个文件。
 *
 *   const tags = createTagModule({ data: '…/data' })
 *   const tags = createTagModule({ port })
 *
 *   tags.run(动作, 参数)        走一个动作
 *   tags.actions                全部动作名
 *   tags.describe()             动作清单（名字、摘要、参数、参数说明）
 *   tags.ERR                    错误码表 + 失败理由原文 → 码
 *   tags.query(串)              查库
 *   tags.recognize(词)          认词
 *   tags.positions(根)          位置：页与类
 *
 * 全部同步、不抛错：失败一律 { ok:false, reason, code }。
 *   reason 是理由原文；code 由 error.js 的理由表查出来（表里没有的落回 TAG_ACTION_FAILED）。
 */

const { createCore, KEYS, POSITION_ROOTS } = require('./core.js');
const { checkPort } = require('./port.js');
const { createFilePort } = require('./adapter-file.js');
const { ERR } = require('./error.js');

/** 成功与失败的两种返回。 */
const ok = (data) => ({ ok: true, data: data === undefined ? null : data });
const fail = (reason) => {
  const 话 = reason || '未知';
  return { ok: false, reason: 话, code: ERR.取码(话) };
};

/**
 * 动作表。每一行：名字 → { 摘要, 参数, 说明, 做 }
 *   摘要   一句话说明
 *   参数   调用方要填哪几项
 *   说明   每项的形状
 *   做     动作本体
 */
function buildActions(core) {
  return {
    // ---------------- 查询 ----------------

    'query': {
      摘要: '查库：给一个查询串，出一组候选（记录与类并列）',
      参数: ['串', '上限?'],
      说明: {
        串: '用户敲进去的那一段',
        上限: '最多给几条，默认 30；超出的用 还有更多 标记，不分页',
      },
      做: ({ 串, 上限 }) => {
        const result = core.queryBoth(串, 上限 ? { limit: Number(上限) } : undefined);
        return ok({
          候选: result.候选,
          还有更多: result.还有更多,
          合计: result.合计,
        });
      },
    },

    'resolve': {
      摘要: '解析一个规范名称或明确别名；歧义与近似匹配返回 null',
      参数: ['词'],
      说明: { 词: '一个 tag 写法；只解析唯一规范名、名称字段里的别名或唯一主中文名' },
      做: ({ 词 }) => {
        const record = core.resolve(词);
        return ok(record ? { 标识: record.ID, 记录: record } : null);
      },
    },

    'recognize': {
      摘要: '认词：给一批词，每个词要一个中文名',
      参数: ['词'],
      说明: {
        词: '一个词，或一批词。给一批就回一一对应的一批',
      },
      做: ({ 词 }) => ok(core.recognize(词)),
    },

    // ---------------- 记录 ----------------

    'record.get': {
      摘要: '取一条记录',
      参数: ['标识'],
      说明: { 标识: '记录 ID' },
      做: ({ 标识 }) => {
        const record = core.get(标识);
        return record ? ok(record) : fail('记录不存在');
      },
    },

    'record.batch': {
      摘要: '一次取多条记录（列表渲染用，取不到的跳过）',
      参数: ['标识列表'],
      说明: { 标识列表: 'ID 数组；取不到的自动跳过，不报错' },
      做: ({ 标识列表 }) => {
        const rows = (Array.isArray(标识列表) ? 标识列表 : [])
          .map((id) => core.get(id))
          .filter(Boolean);
        return ok(rows);
      },
    },

    'record.create': {
      摘要: '新建一条（进自建库，ID 自动分配）',
      参数: ['名称', '中文名?', '成员?'],
      说明: {
        名称: '逗号分隔；第一个是规范写法',
        中文名: '逗号分隔；第一个是主名',
        成员: '组成员，ID 数组；空数组也行（空组也是组）',
      },
      做: ({ 名称, 中文名, 成员 }) => {
        const result = core.create({ 名称, 中文名, 成员 });
        return result.ok ? ok(result.记录) : fail(result.reason);
      },
    },

    'record.edit': {
      摘要: '改一条（直接改库；第一次改之前原文自动抄进修改库）',
      参数: ['标识', '名称', '中文名?', '成员?'],
      说明: { 标识: '记录 ID', 名称: '整条覆盖，不是逐字段合并' },
      做: ({ 标识, 名称, 中文名, 成员 }) => {
        const result = core.edit(标识, { 名称, 中文名, 成员 });
        return result.ok ? ok(result.记录) : fail(result.reason);
      },
    },

    'record.delete': {
      摘要: '删一条（只能删自建库里的）',
      参数: ['标识'],
      说明: { 标识: '记录 ID；原有记录只能隐藏，不能删' },
      做: ({ 标识 }) => {
        const result = core.remove(标识);
        return result.ok ? ok(result.记录) : fail(result.reason);
      },
    },

    'record.groups': {
      摘要: '列出全部组',
      参数: [],
      说明: {},
      做: () => ok(core.groups()),
    },

    // ---------------- 隐藏 / 恢复 / 还原 ----------------

    'hidden.hide': {
      摘要: '隐藏一条（整条剪进隐藏库，任何方式都查不到）',
      参数: ['标识'],
      说明: { 标识: '记录 ID；任何记录都能隐藏，含自建的' },
      做: ({ 标识 }) => {
        const result = core.hide(标识);
        return result.ok ? ok(result.record) : fail(result.reason);
      },
    },

    'hidden.unhide': {
      摘要: '恢复一条（扔回来源库，ID 不变）',
      参数: ['标识'],
      说明: { 标识: '记录 ID；位置与组引用会自动复活，不用动它们' },
      做: ({ 标识 }) => {
        const result = core.unhide(标识);
        return result.ok ? ok(result.record) : fail(result.reason);
      },
    },

    'hidden.list': {
      摘要: '列出隐藏库里的记录（给"隐藏库"那个界面用）',
      参数: [],
      说明: {},
      做: () => ok(core.hidden()),
    },

    'modified.list': {
      摘要: '列出改过原文的记录（给"改过哪些"那个界面用）',
      参数: [],
      说明: {},
      做: () => ok(core.modified()),
    },

    'modified.restore': {
      摘要: '还原默认（用修改库那份覆盖回来，那份随即删掉）',
      参数: ['标识'],
      说明: { 标识: '记录 ID；同一条只能还原一次，再改会重新抄一份' },
      做: ({ 标识 }) => {
        const result = core.restore(标识);
        return result.ok ? ok(result.record) : fail(result.reason);
      },
    },

    // ---------------- 位置：页与类 ----------------

    'position.list': {
      摘要: '列位置：给根列出全部页，给页列出它底下的类',
      参数: ['位置', '页?'],
      说明: {
        位置: `'${POSITION_ROOTS[0]}' 或 '${POSITION_ROOTS[1]}'`,
        页: '页 ID；不填就列全部页',
      },
      做: ({ 位置, 页 }) => {
        const result = core.positions.list(位置, 页);
        return result.ok ? ok(result.页 || result.页列表) : fail(result.reason);
      },
    },

    'position.createPage': {
      摘要: '新建一页',
      参数: ['位置', '页名', '配色?'],
      说明: { 位置: '分类 / 收藏', 页名: '可以重名，标识是 ID', 配色: '{ background, foreground }' },
      做: ({ 位置, 页名, 配色 }) => {
        const result = core.positions.createPage(位置, { 页名, 配色 });
        return result.ok ? ok(result.页) : fail(result.reason);
      },
    },

    'position.createClass': {
      摘要: '新建一个类',
      参数: ['位置', '页', '类名', '配色?'],
      说明: { 页: '挂在哪个页底下' },
      做: ({ 位置, 页, 类名, 配色 }) => {
        const result = core.positions.createClass(位置, 页, { 类名, 配色 });
        return result.ok ? ok(result.类) : fail(result.reason);
      },
    },

    'position.update': {
      摘要: '改页名 / 改类名 / 改配色',
      参数: ['位置', '标识', '页名?', '类名?', '配色?'],
      说明: { 标识: '页 ID 或类 ID；只改字典里那一条，键名不动' },
      做: ({ 位置, 标识, 页名, 类名, 配色 }) => {
        const result = core.positions.update(位置, 标识, { 页名, 类名, 配色 });
        return result.ok ? ok(result.页 || result.类) : fail(result.reason);
      },
    },

    'position.delete': {
      摘要: '删页或删类（删页带走它底下的所有类）',
      参数: ['位置', '标识'],
      说明: {},
      做: ({ 位置, 标识 }) => {
        const result = core.positions.remove(位置, 标识);
        if (!result.ok) return fail(result.reason);
        return ok({
          removed: result.removed,
          带走类: result.带走类 || 0,
          ...(result.还有格没删掉 ? { 还有格没删掉: result.还有格没删掉 } : {}),
        });
      },
    },

    'position.members': {
      摘要: '一个类里摆了哪些东西',
      参数: ['位置', '页', '类'],
      说明: {},
      做: ({ 位置, 页, 类 }) => ok(core.positions.members(位置, 页, 类)),
    },

    'position.attach': {
      摘要: '把一个 tag 或组摆进一个类',
      参数: ['位置', '页', '类', '成员', '位置序?'],
      说明: { 成员: '记录 ID', 位置序: '摆在第几个；不填就摆到最后' },
      做: ({ 位置, 页, 类, 成员, 位置序 }) => {
        const result = core.positions.attach(位置, 页, 类, 成员, 位置序);
        return result.ok ? ok(result.list) : fail(result.reason);
      },
    },

    'position.detach': {
      摘要: '把一个 tag 或组从一个类里拿掉',
      参数: ['位置', '页', '类', '成员'],
      说明: {},
      做: ({ 位置, 页, 类, 成员 }) => {
        const result = core.positions.detach(位置, 页, 类, 成员);
        return result.ok ? ok(result.list) : fail(result.reason);
      },
    },

    'position.reorder': {
      摘要: '整格重排（界面上拖完一次落一次）',
      参数: ['位置', '页', '类', '标识列表'],
      说明: { 标识列表: '这个类里成员的完整顺序' },
      做: ({ 位置, 页, 类, 标识列表 }) => {
        const result = core.positions.reorder(位置, 页, 类, 标识列表);
        return result.ok ? ok(result.list) : fail(result.reason);
      },
    },

    'position.whereIs': {
      摘要: '这个东西被摆在哪些类里',
      参数: ['位置', '成员'],
      说明: {},
      做: ({ 位置, 成员 }) => ok(core.positions.whereIs(位置, 成员)),
    },

    'position.classOf': {
      摘要: '这个东西在某一页底下落在哪个类里',
      参数: ['位置', '页', '成员'],
      说明: { 说明: '没摆给 null；一页底下类多的时候走这条，不要扫 whereIs' },
      做: ({ 位置, 页, 成员 }) => ok(core.positions.classOf(位置, 页, 成员)),
    },

    // ---------------- 渲染顺序 ----------------

    'render.pages': {
      摘要: '渲染页序（表一）：哪些页出词、按什么先后',
      参数: [],
      说明: { 说明: '不在这张表里的页一律不出词' },
      做: () => ok(core.render.pages()),
    },

    'render.sort': {
      摘要: '按渲染顺序排一批词（表一）',
      参数: ['词们'],
      说明: {
        词们: '自由文本或 {标识} 对象的数组；文本原样保留，只有明确标识按规范名称输出。库外与无页词排最后，重复的留着',
      },
      做: ({ 词们 }) => ok(core.render.sort(词们)),
    },

    'render.words': {
      摘要: '一个角色的三段（表二）：角色名 · 作品 · 特征',
      参数: ['标识'],
      说明: { 标识: '角色记录 ID；作品从"它在页「角色组」的哪个类里"读' },
      做: ({ 标识 }) => {
        const result = core.render.words(标识);
        return result.ok ? ok({
          角色名: result.角色名,
          作品: result.作品,
          块们: result.块们,
          没页的词: result.没页的词,
        }) : fail(result.reason);
      },
    },

    'render.whereIs': {
      摘要: '这条东西按渲染顺序落在哪一页哪一类',
      参数: ['标识'],
      说明: { 标识: '记录 ID；没页可归或不在表里的页给 null' },
      做: ({ 标识 }) => ok(core.render.位置(标识)),
    },

    'render.pageMap': {
      摘要: '某一页底下谁落在哪个类里（一次给全）',
      参数: ['页'],
      说明: { 页: '页 ID；页「角色组」有 4050 个类，走这一条，不要逐个类问成员' },
      做: ({ 页 }) => ok(core.render.一页归属(页)),
    },

    // ---------------- 注释 ----------------

    'note.get': {
      摘要: '读一条注释',
      参数: ['标识'],
      说明: {},
      做: ({ 标识 }) => ok(core.note(标识)),
    },

    'note.set': {
      摘要: '写一条注释（空文本 = 删掉）',
      参数: ['标识', '文本'],
      说明: { 文本: '一条记录一条' },
      做: ({ 标识, 文本 }) => {
        const result = core.setNote(标识, 文本);
        return result.ok ? ok(result.text) : fail(result.reason);
      },
    },

    // ---------------- 身份 ----------------

    'identity.adults': {
      摘要: '成人标签表：全部 ID',
      参数: [],
      说明: {},
      做: () => ok(core.adults()),
    },

    'identity.roles': {
      摘要: '角色表：全部角色组 ID',
      参数: [],
      说明: {},
      做: () => ok(core.roles()),
    },

    'identity.isAdult': {
      摘要: '这一条算不算成人标签',
      参数: ['标识'],
      说明: {},
      做: ({ 标识 }) => ok(core.isAdult(标识)),
    },

    'identity.isRole': {
      摘要: '这一条是不是角色组',
      参数: ['标识'],
      说明: {},
      做: ({ 标识 }) => ok(core.isRole(标识)),
    },

    'identity.series': {
      摘要: '系列表：全部系列组 ID',
      参数: [],
      说明: {},
      做: () => ok(core.series()),
    },

    'identity.isSeries': {
      摘要: '这一条是不是系列组',
      参数: ['标识'],
      说明: {},
      做: ({ 标识 }) => ok(core.isSeries(标识)),
    },

    // ---------------- 体检 / 重读 ----------------

    'status': {
      摘要: '体检：规模、野键、坏的键、写剩的临时文件',
      参数: [],
      说明: {},
      做: () => ok(core.status()),
    },

    'reload': {
      摘要: '重读库（数据被别人从外面改过之后调它）',
      参数: [],
      说明: {},
      做: () => {
        const result = core.rebuild();
        return result.ok ? ok(null) : fail(result.reason);
      },
    },
  };
}

/**
 * 装配。
 *   { port }            端口由装配层递进来
 *   { data: '…/data' }  内部装文件适配器
 */
function createTagModule(options = {}) {
  let port = options.port;
  if (!port) {
    if (typeof options.data !== 'string' || !options.data.trim()) {
      throw new Error('要么递端口 createTagModule({ port })，要么给位置 createTagModule({ data })');
    }
    port = createFilePort({ root: options.data });
  }
  const gate = checkPort(port);
  if (!gate.ok) throw new Error(`端口不合格：${gate.reason}`);

  const core = createCore({ port });
  const actions = buildActions(core);

  /**
   * 走一个动作。
   * @param {string} name
   * @param {object} [payload]
   * @returns {{ok:boolean, data?:any, reason?:string}}
   */
  function run(name, payload = {}) {
    const action = actions[name];
    if (!action) return fail(`没有这个动作：${name}`);
    try {
      const result = action.做(payload || {});
      if (!result || typeof result !== 'object') return ok(result);
      return result;
    } catch (error) {
      // 兜住异常
      return fail(error && error.message ? error.message : '动作执行出错');
    }
  }

  /** 动作清单：名字 + 摘要 + 参数 + 参数说明。 */
  function describe() {
    return Object.entries(actions).map(([name, action]) => ({
      动作: name,
      摘要: action.摘要,
      参数: action.参数,
      说明: action.说明,
    }));
  }

  const facade = {
    // 动作表
    run,
    actions: Object.freeze(Object.keys(actions)),
    describe,

    // 直呼式：成功给数据，失败给 null
    query: (串, 选项) => unwrap(run('query', { 串, ...(选项 || {}) })),
    recognize: (词) => unwrap(run('recognize', { 词 })),
    resolve: (词) => unwrap(run('resolve', { 词 })),

    // 位置直呼
    positions: (root) => ({
      list: (页) => unwrap(run('position.list', { 位置: root, 页 })),
      createPage: (input) => unwrap(run('position.createPage', { 位置: root, ...(input || {}) })),
      createClass: (页, input) => unwrap(run('position.createClass', { 位置: root, 页, ...(input || {}) })),
      update: (标识, patch) => unwrap(run('position.update', { 位置: root, 标识, ...(patch || {}) })),
      remove: (标识) => unwrap(run('position.delete', { 位置: root, 标识 })),
      members: (页, 类) => unwrap(run('position.members', { 位置: root, 页, 类 })),
      attach: (页, 类, 成员, 位置序) => unwrap(run('position.attach', { 位置: root, 页, 类, 成员, 位置序 })),
      detach: (页, 类, 成员) => unwrap(run('position.detach', { 位置: root, 页, 类, 成员 })),
      reorder: (页, 类, 标识列表) => unwrap(run('position.reorder', { 位置: root, 页, 类, 标识列表 })),
      whereIs: (成员) => unwrap(run('position.whereIs', { 位置: root, 成员 })),
    }),

    // 键名
    KEYS,

    ERR,
  };

  return Object.freeze(facade);
}

/** 直呼式：成功给数据，失败给 null。 */
function unwrap(result) {
  return result && result.ok ? result.data : null;
}

module.exports = { createTagModule, KEYS };
