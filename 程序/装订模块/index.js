'use strict';
/*
 * 装订模块 · 门面。对外只有这一个文件。
 *
 *   const 装订 = createBindingModule({ 查词, AI翻译 })
 *
 *   // 两个动作
 *   装订.切分({ 文本 })      → 单元列表 [{ 前, 词, 后 }]
 *   装订.装订(文本)          → 异步。{ ok:true, 译文, 原文, 方向, 表, 统计 }
 *                                    / { ok:false, code, reason, 原文, 原因? }
 *
 *   // 直呼式
 *   装订.译文(文本)          → 译文串；失败给 null
 *   装订.有内容的格(单元)     → 只留可译的那些格
 *
 *   // 动作表与清单
 *   装订.run(动作, 参数)
 *   装订.actions
 *   装订.describe()
 *
 * 失败一律 { ok:false, reason, code }，reason 的写法是 `码: 人话`。
 */

const { createCore, 有内容的格, ERR, SAY, 文本处理 } = require('./core.js');
const { checkPort, PORT_FUNCS } = require('./port.js');

const ok = (data) => ({ ok: true, data: data === undefined ? null : data });
const fail = (码, 话) => ({ ok: false, reason: `${码}: ${话}`, code: 码 });

/**
 * 动作表。每一行：名字 → { 摘要, 参数, 说明, 做 }
 */
function 建动作表(core) {
  const 文本说明 = '要处理的那段文本';

  return {
    '切分': {
      摘要: '一段文本 → 单元列表（每段记 前 / 词 / 后）',
      参数: ['文本'],
      说明: { 文本: 文本说明 },
      做: ({ 文本 }) => ok(core.切分(文本).单元),
    },

    '装订': {
      摘要: '切分 → 查词 → 交给 AI → 拼回；译文或原文',
      参数: ['文本', '方向?'],
      说明: { 文本: 文本说明, 方向: 'auto / en-zh / zh-en；默认 en-zh' },
      做: ({ 文本, 方向 }) => core.装订(文本, { 方向 }),
    },
  };
}

/**
 * 装配。
 * @param {{查词?:Function, AI翻译?:Function}} [选项]
 * @returns {object} 冻住的门面
 */
function createBindingModule(选项 = {}) {
  const 门 = checkPort(选项);
  if (!门.ok) throw new Error(`端口不合格：${门.reason}`);

  const core = createCore({
    查词: 选项.查词 || null,
    AI翻译: 选项.AI翻译 || null,
  });
  const 动作表 = 建动作表(core);

  /**
   * 走一个动作。名字不在表里 ⇒ { ok:false, reason, code }；
   * 在表里 ⇒ 那个动作自己的出参（`切分` 是 { ok, data }，`装订` 是回执）。
   * @param {string} 名字
   * @param {object} [参数]
   * @returns {{ok:boolean, data?:*, 译文?:string, 原文?:string, reason?:string, code?:string}}
   */
  function run(名字, 参数 = {}) {
    const 动作 = 动作表[名字];
    if (!动作) return fail(ERR.BAD_ARGUMENT, `没有这个动作：${名字}`);
    try {
      return 动作.做(参数 || {});
    } catch (error) {
      return fail(ERR.FAILED, (error && error.message) || SAY[ERR.FAILED]);
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

  /** 直呼式：成功给数据，失败给 null。 */
  const 直呼 = (名字) => (参数) => {
    const 结果 = run(名字, 参数);
    return 结果 && 结果.ok ? 结果.data : null;
  };

  const facade = {
    run,
    actions: Object.freeze(Object.keys(动作表)),
    describe,

    切分: 直呼('切分'),
    装订: (文本, 选项) => run('装订', { 文本, ...选项 }),
    有内容的格,
    文本处理,

    /** 只要译文：成功给那一段文本，失败给 null。 */
    译文: async (文本, 选项) => {
      const 结果 = await run('装订', { 文本, ...选项 });
      return 结果 && 结果.ok ? 结果.译文 : null;
    },

    ERR: Object.freeze({ ...ERR }),
    SAY: Object.freeze({ ...SAY }),
    端口: Object.freeze(PORT_FUNCS.map((x) => ({ ...x }))),
  };

  return Object.freeze(facade);
}

module.exports = { createBindingModule };
