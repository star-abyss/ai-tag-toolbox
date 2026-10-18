'use strict';
/*
 * 装订模块 · 端口。装配层与核心之间那一小块东西。
 *
 *   查词(词列表)   → 中文名 或 null 的数组（与词列表一一对应）
 *   AI翻译(报文)   → 键值对；同步给对象，或异步给文本/对象
 *
 *   报文 = {
 *     source  必串    完整原文
 *     words   必数组  要它译的词，按出现顺序；不带值
 *     from    必串    来源语言：英文
 *     to      必串    目标语言：中文
 *   }
 *
 * 本模块没有盘，端口就是这两个函数。
 */

/** 端口两项的名字与形状。 */
const PORT_FUNCS = Object.freeze([
  { 名: '查词', 形状: '(词列表) → 中文名 或 null 的数组' },
  { 名: 'AI翻译', 形状: '(报文) → 键值对' },
]);

/**
 * 校验装配参数：给了的必须是函数。
 * @param {{查词?:Function, AI翻译?:Function}} [选项]
 * @returns {{ok:boolean, reason?:string}}
 */
function checkPort(选项 = {}) {
  if (!选项 || typeof 选项 !== 'object') return { ok: false, reason: '装配参数必须是对象' };
  for (const { 名 } of PORT_FUNCS) {
    const 值 = 选项[名];
    if (值 !== undefined && 值 !== null && typeof 值 !== 'function') {
      return { ok: false, reason: `${名}必须是一个函数，或干脆别给` };
    }
  }
  return { ok: true };
}

module.exports = { checkPort, PORT_FUNCS };
