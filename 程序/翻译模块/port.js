'use strict';
/** 文本处理提供原始范围和拼装；译接收并返回带 id 的单元列表。 */

/** 端口三项的名字、形状与必不必给。 */
const PORT_FUNCS = Object.freeze([
  { 名: '文本处理', 形状: '{切分,拼装,猜方向,需翻译}', 必给: true },
  { 名: '查词', 形状: '(词列表) → 中文名 或 null 的数组', 必给: false },
  { 名: '译', 形状: '({source,units:[{id,text}],from,to,模型?}) → {模型?,units:[{id,text}]}', 必给: false },
]);

/**
 * 校验装配参数：给了的必须是函数。
 * @param {{文本处理:object, 查词?:Function, 译?:Function}} [选项]
 * @returns {{ok:boolean, reason?:string}}
 */
function checkPort(选项 = {}) {
  if (!选项 || typeof 选项 !== 'object') return { ok: false, reason: '装配参数必须是对象' };
  const 文本处理 = 选项.文本处理;
  if (!文本处理 || ['切分', '拼装', '猜方向', '需翻译'].some(名 => typeof 文本处理[名] !== 'function')) {
    return { ok: false, reason: '文本处理必须提供切分、拼装、猜方向、需翻译' };
  }
  for (const 名 of ['查词', '译']) {
    if (选项[名] != null && typeof 选项[名] !== 'function') return { ok: false, reason: `${名}必须是函数` };
  }
  return { ok: true };
}

module.exports = { checkPort, PORT_FUNCS };
