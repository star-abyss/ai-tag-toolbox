'use strict';
/*
 * 翻译模块 · 门面。对外只有这一个文件。
 *
 *   const 翻译 = createTranslateModule({ 文本处理, 查词, 译, 默认方向, 默认模型 })
 *
 *   // 三个动作
 *   翻译.run('看模型')                   → { ok:true, data:{ 可用, 缺, 模型, 有查词 } }
 *   翻译.run('本地译', { 文本, 方向? })    → { ok:true, data:{ 译文, 原文, 方向, 表, 统计 } }
 *   翻译.run('切分', { 文本 })            → { ok:true, data: 单元列表 }
 *
 *   // 直呼式
 *   翻译.本地译(文本, { 方向? })           → 异步。回执本身（成功带 译文，失败带 code 与 原文）
 *   翻译.译文(文本, { 方向? })             → 只要译文；失败给 null
 *
 * 失败一律 { ok:false, reason, code }，reason 的写法是 `码: 人话`。
 */

const { createCore, ERR, SAY, 收单元 } = require('./core.js');
const { checkPort, PORT_FUNCS } = require('./port.js');

const ok = (data) => ({ ok: true, data: data === undefined ? null : data });
const fail = (码, 话) => ({ ok: false, reason: `${码}: ${话}`, code: 码 });

/**
 * 动作表。每一行：名字 → { 摘要, 参数, 说明, 做 }
 */
function 建动作表(core) {
  const 文本说明 = '要译的那段文本';
  const 方向说明 = '翻译方向：auto 自己判 | en-zh 英译中 | zh-en 中译英';

  return {
    '看模型': {
      摘要: '这一格能不能本地译（要的端口齐不齐）',
      参数: [],
      说明: {},
      做: () => core.看模型(),
    },

    '本地译': {
      摘要: '切分 → 查词 → 查不到的交给本地模型 → 拼回',
      参数: ['文本', '方向?', '模型?'],
      说明: { 文本: 文本说明, 方向: 方向说明, 模型: '用哪一格模型；不给就用装配层定的那一格' },
      做: ({ 文本, 方向, 模型 }) => core.本地译(文本, { 方向, 模型 }),
    },

    '切分': {
      摘要: '一段文本 → 单元列表（每段记 前 / 词 / 后）',
      参数: ['文本'],
      说明: { 文本: 文本说明 },
      做: ({ 文本 }) => {
        if (!core.切分) return fail(ERR.NO_SPLIT, SAY[ERR.NO_SPLIT]);
        const 切 = core.切分({ 文本 });
        if (!切) return fail(ERR.NO_SPLIT, SAY[ERR.NO_SPLIT]);
        return ok(收单元(切));
      },
    },
  };
}

/**
 * 装配。
 * @param {{文本处理:object, 查词?:Function, 译?:Function, 默认方向?:string, 默认模型?:string}} [选项]
 * @returns {object} 冻住的门面
 */
function createTranslateModule(选项 = {}) {
  const 门 = checkPort(选项);
  if (!门.ok) throw new Error(`端口不合格：${门.reason}`);

  const core = createCore({
    文本处理: 选项.文本处理,
    查词: 选项.查词 || null,
    译: 选项.译 || null,
    默认方向: 选项.默认方向,
    默认模型: 选项.默认模型,
  });
  const 动作表 = 建动作表(core);

  /**
   * 走一个动作。名字不在表里 ⇒ { ok:false, reason, code }。
   * @param {string} 名字
   * @param {object} [参数]
   * @returns {object|Promise<object>}
   */
  function run(名字, 参数 = {}) {
    const 动作 = 动作表[名字];
    if (!动作) return fail(ERR.BAD_ARGUMENT, `没有这个动作：${名字}`);
    try {
      return 动作.做(参数 || {});
    } catch (error) {
      return fail(ERR.BAD_ARGUMENT, (error && error.message) || SAY[ERR.BAD_ARGUMENT]);
    }
  }

  /**
   * 动作清单。
   * @returns {Array<{动作:string, 摘要:string, 参数:Array, 说明:object}>}
   */
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

    /** 直呼式：回执本身（异步）。 */
    本地译: (文本, 选项) => run('本地译', { 文本, ...(选项 || {}) }),

    /** 只要译文：成功给那一段文本，失败给 null。 */
    译文: async (文本, 选项) => {
      const 结果 = await run('本地译', { 文本, ...(选项 || {}) });
      return 结果 && 结果.ok ? 结果.data.译文 : null;
    },

    /** 猜方向：给一段文本，说它是 en-zh 还是 zh-en。 */
    猜方向: core.猜方向,

    ERR: Object.freeze({ ...ERR }),
    SAY: Object.freeze({ ...SAY }),
    端口: Object.freeze(PORT_FUNCS.map((x) => ({ ...x }))),
  };

  return Object.freeze(facade);
}

module.exports = { createTranslateModule };
