'use strict';
/*
 * 世界书模块 · 门面。对外只有这一个文件。
 *
 *   const 世界书 = createWorldbookModule({ port, 默认启用? })
 *   const 世界书 = createWorldbookModule({ 根目录, 默认目录, 默认启用? })
 *
 *   // 上层要的那一个
 *   世界书.执行({ 请求, 文本 })        → { 请求, 书, 命中 }
 *
 *   // 读
 *   世界书.读({ 请求?, 书? })          → { 表(按请求过滤), 启用?, 书?, 脏, 冻结? }
 *   世界书.表({ 请求? })              → [ { 标识, 名字, 是本子, 请求?, 存在, 条目数, 读不懂? } ]
 *   世界书.测({ 请求, 文本 })          → { 请求, 书, 命中 }
 *   世界书.状态()                     → 体检
 *
 *   // 改（都作用在草稿上；落下要按 存）
 *   世界书.书({ 动作:'换'|'导入'|'新建'|'改名'|'删'|'导出', … })
 *   世界书.条目({ 动作:'加'|'改'|'删'|'移', … })
 *   世界书.存()  ·  世界书.丢()  ·  世界书.重读()
 *
 *   // 动作表与清单
 *   世界书.run(动作, 参数)
 *   世界书.actions
 *   世界书.describe()
 *
 * 读直接给结果；改与存直接给结果（端口是同步的）。
 * 失败一律 { ok:false, reason, code }。
 */
const { createCore, ERR } = require('./core.js');
const { checkPort, PORT_METHODS } = require('./port.js');
const { createFileAdapter } = require('./adapter-file.js');

const ok = (data) => ({ ok: true, data: data === undefined ? null : data });
const fail = (码, 话) => ({ ok: false, reason: `${码}: ${话}`, code: 码 });

/** 动作表。每一行：名字 → { 摘要, 参数, 说明, 做 }。 */
function 建动作表(core) {
  const 书说明 = '书标识：用户那份是 wb<UUID>，只读默认是 $default:翻译';
  const 请求说明 = '请求名，如 主AI / 翻译 / 识图；由调用方定，本模块不建对照表';

  return {
    '执行': {
      摘要: '一个请求这次命中的条目（只读存档）',
      参数: ['请求', '文本', '启用?'],
      说明: { 请求: 请求说明, 文本: '这次调用的内容，只用来筛条目', 启用: '本次使用的书标识列表；省略读取请求的存档列表，空数组表示不挂书' },
      做: ({ 请求, 文本, 启用 }) => core.执行({ 请求, 文本, 启用 }),
    },

    '读': {
      摘要: '按请求过滤的书表 + 某个请求启用了哪几本 + 正文 + 草稿状态',
      参数: ['请求?', '书?'],
      说明: { 请求: 请求说明, 书: 书说明 },
      做: ({ 请求, 书 }) => core.读({ 请求, 书 }),
    },

    '表': {
      摘要: '全部世界书；给请求时按归属过滤，按名字排序',
      参数: ['请求?'],
      说明: { 请求: `${请求说明}；给出时仅列该请求归属的书` },
      做: ({ 请求 }) => ok(core.表(请求)),
    },

    '测': {
      摘要: '这次会命中哪些条目（读草稿，与 执行 同形）',
      参数: ['请求', '文本', '启用?'],
      说明: { 请求: 请求说明, 文本: '同 执行', 启用: '同 执行' },
      做: ({ 请求, 文本, 启用 }) => core.测({ 请求, 文本, 启用 }),
    },

    '书': {
      摘要: '世界书：换 / 导入 / 新建 / 改名 / 删 / 导出',
      参数: ['动作', '请求?', '标识?', '启用?', '名字?', '内容?', '书?'],
      说明: {
        动作: '换 | 导入 | 新建 | 改名 | 删 | 导出',
        请求: `换 / 导入 / 新建 用；导入与新建只设置书籍归属。${请求说明}`,
        标识: 书说明,
        启用: '换用：一串书标识；一本都不启用就给空数组',
        名字: '导入 / 新建 / 改名 用；导入与新建撞名时自动加号',
        内容: '导入用：世界书文件的文本',
        书: '导入用：已解析的对象（与 内容 二选一）',
      },
      做: (参数) => core.书(参数),
    },

    '条目': {
      摘要: '条目：加 / 改 / 删 / 移',
      参数: ['动作', '书', '标识?', '条目?', '方向?', '到?'],
      说明: {
        动作: '加 | 改 | 删 | 移',
        标识: '条目的 id',
        条目: '{ label, text, always, keys, enabled, 落点, 深度, 角色 } 的任意几项',
        方向: '移用：上 | 下',
        到: '移用：目标序号',
      },
      做: (参数) => core.条目(参数),
    },

    '存': { 摘要: '草稿写进端口', 参数: [], 说明: {}, 做: () => core.存() },
    '丢': { 摘要: '草稿丢回存档', 参数: [], 说明: {}, 做: () => core.丢() },
    '重读': { 摘要: '重读端口', 参数: [], 说明: {}, 做: () => core.重读() },
    '状态': { 摘要: '体检', 参数: [], 说明: {}, 做: () => core.状态() },
  };
}

/**
 * 装配。
 *   { port, 默认启用? }                 端口与请求默认书由装配层递进来
 *   { 根目录, 默认目录, 默认启用? }       内部装文件适配器
 */
function createWorldbookModule(选项 = {}) {
  let port = 选项.port;
  if (!port) {
    const 根目录 = 选项.根目录;
    const 默认目录 = 选项.默认目录;
    if (typeof 根目录 !== 'string' || !根目录.trim() || typeof 默认目录 !== 'string' || !默认目录.trim()) {
      throw new Error(`${ERR.BAD_ARGUMENT}: 要么递端口 createWorldbookModule({ port })，要么给位置 createWorldbookModule({ 根目录, 默认目录 })`);
    }
    port = createFileAdapter({ root: 根目录, 默认目录 });
  }
  const 门 = checkPort(port);
  if (!门.ok) throw new Error(`端口不合格：${门.reason}（要有 ${PORT_METHODS.join(' / ')}）`);

  const core = createCore({ port, 默认启用: 选项.默认启用 });
  const 动作表 = 建动作表(core);

  /** 走一个动作。 */
  function run(名字, 参数 = {}) {
    const 动作 = 动作表[名字];
    if (!动作) return fail(ERR.BAD_ARGUMENT, `没有这个动作：${名字}`);
    try {
      const 结果 = 动作.做(参数 || {});
      if (!结果 || typeof 结果 !== 'object') return ok(结果);
      return 结果;
    } catch (error) {
      return fail(ERR.WRITE_FAILED, (error && error.message) || '动作执行出错');
    }
  }

  /** 动作清单。 */
  function describe() {
    return Object.entries(动作表).map(([名字, 动作]) => ({
      动作: 名字,
      摘要: 动作.摘要,
      参数: 动作.参数,
      说明: 动作.说明,
    }));
  }

  /** 直呼式：成功给数据，失败给 null。 */
  const 直呼 = (名字) => (参数) => {
    const 结果 = run(名字, 参数);
    return 结果 && 结果.ok ? 结果.data : null;
  };

  const facade = {
    run,
    actions: Object.freeze(Object.keys(动作表)),
    describe,

    执行: 直呼('执行'),
    读: 直呼('读'),
    表: 直呼('表'),
    测: 直呼('测'),
    书: 直呼('书'),
    条目: 直呼('条目'),
    存: 直呼('存'),
    丢: 直呼('丢'),
    重读: 直呼('重读'),
    状态: 直呼('状态'),

    ERR: Object.freeze({ ...ERR }),
  };

  return Object.freeze(facade);
}

module.exports = { createWorldbookModule };
