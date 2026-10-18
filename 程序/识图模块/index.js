'use strict';
/*
 * 识图模块 · 门面。对外只有这一个文件。
 *
 *   const 识图 = createVisionModule({ 取图字节, 查词, tagger, 看图, 读元数据, 引擎 })
 *
 *   // 四个动作
 *   识图.run('看模型')                       → { ok:true, data:{ 可用, 缺, 能本地打标, 能看图, 模型 } }
 *   识图.run('认图',     { 存放地, 条目ID, 会话ID?, 阈值?, 上限? }) → { ok:true, data:{ 引用, 标签, 总数, 阈值, 尺寸, 模型 } }
 *   识图.run('读元数据', { 存放地?, 条目ID?, 会话ID?, 字节? })    → { ok:true, data:{ 提示词, 负向提示词, 工作流, 参数, 尺寸 } }
 *   识图.run('看图',     { 存放地, 条目ID, 会话ID?, 提示?, 参考标签? }) → { ok:true, data:{ 标签, 描述, 模型, 用量 } }
 *
 *   // 直呼式
 *   识图.认图({ 存放地, 条目ID, 阈值? })                 → 异步。回执本身
 *   识图.标签({ 存放地, 条目ID, 阈值? })                 → 只留标签（每项 { 词, 中文名, 概率, 分类 }）；失败给 []
 *
 * 失败一律 { ok:false, reason, code }，reason 的写法是 `码: 人话`。
 */

const { createCore, ERR, SAY, 分类名 } = require('./core.js');
const { checkPort, PORT_FUNCS } = require('./port.js');

const fail = (码, 话) => ({ ok: false, reason: `${码}: ${话}`, code: 码 });

/** 四个动作的说明。 */
function 建动作表(core) {
  const 引用说明 = '图在哪个存放地：session / gallery / vision';
  const 条目说明 = '条目 ID（img_…），从上一步列出来的那张图拿';
  const 会话说明 = '只在 存放地 是 session 时给；不给算占位段 _';
  return {
    '看模型': {
      摘要: '这一格备齐了没有（本地打标 / 读元数据 / 看图）',
      参数: [],
      说明: {},
      做: () => core.看模型(),
    },
    '认图': {
      摘要: '本地模型打标：图 → 一批标签（过阈值、按概率排）',
      参数: ['存放地', '条目ID', '会话ID?', '阈值?', '上限?'],
      说明: { 存放地: 引用说明, 条目ID: 条目说明, 会话ID: 会话说明, 阈值: '过这一条线才算；不给就用模型自带的那个', 上限: '最多要几个；不给就是全要' },
      做: (参数) => core.认图(参数),
    },
    '读元数据': {
      摘要: 'AI 画的图里藏着的提示词 / 工作流 / 参数',
      参数: ['存放地?', '条目ID?', '会话ID?', '字节?'],
      说明: { 存放地: 引用说明, 条目ID: 条目说明, 会话ID: 会话说明, 字节: '原始 PNG 字节；给出时不需要图引用' },
      做: (参数) => core.读元数据(参数),
    },
    '看图': {
      摘要: '把图交给模型看，要标签与描述',
      参数: ['存放地', '条目ID', '会话ID?', '提示?', '参考标签?'],
      说明: { 存放地: 引用说明, 条目ID: 条目说明, 会话ID: 会话说明, 提示: '想让它着重看什么', 参考标签: '本地打标出来的那批，给它当参考' },
      做: (参数) => core.看图(参数),
    },
  };
}

/**
 * 装配。
 * @param {{取图字节:Function, 查词?:Function, tagger?:object, 看图?:Function, 读元数据?:Function, 引擎?:object}} [选项]
 * @returns {object} 冻住的门面
 */
function createVisionModule(选项 = {}) {
  const 门 = checkPort(选项);
  if (!门.ok) throw new Error(`端口不合格：${门.reason}`);

  const core = createCore({
    取图字节: 选项.取图字节,
    查词: 选项.查词 || null,
    tagger: 选项.tagger || null,
    看图: 选项.看图 || null,
    读元数据: 选项.读元数据 || null,
    引擎: 选项.引擎 || null,
  });
  const 动作表 = 建动作表(core);

  /** 走一个动作。 */
  function run(名字, 参数 = {}) {
    const 动作 = 动作表[名字];
    if (!动作) return fail(ERR.BAD_ARGUMENT, `没有这个动作：${名字}`);
    try {
      return 动作.做(参数 || {});
    } catch (error) {
      return fail(ERR.BAD_ARGUMENT, (error && error.message) || SAY[ERR.BAD_ARGUMENT]);
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

  const facade = {
    run,
    actions: Object.freeze(Object.keys(动作表)),
    describe,

    认图: (参数) => run('认图', 参数),
    读元数据: (参数) => run('读元数据', 参数),
    看图: (参数) => run('看图', 参数),

    /** 只要标签：成功给数组，失败给空数组。 */
    标签: async (参数) => {
      const 回 = await run('认图', 参数);
      return 回 && 回.ok ? 回.data.标签 : [];
    },

    ERR: Object.freeze({ ...ERR }),
    SAY: Object.freeze({ ...SAY }),
    分类名: Object.freeze({ ...分类名 }),
    端口: Object.freeze(PORT_FUNCS.map((x) => ({ ...x }))),
  };

  return Object.freeze(facade);
}

module.exports = { createVisionModule };
