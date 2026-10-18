'use strict';
/*
 * 识图模块 · 端口。装配层与核心之间那一小块东西。
 *
 *   取图字节(引用)   → { 字节, mime? }          —— 位图从哪来；引用是 { 作用域, 条目ID }
 *   查词(词列表)     → 中文名 或 null 的数组    —— 与别的模块共用同一个（标签模块的 认词）
 *   tagger          本地打标引擎：{ 打标(字节, {阈值, 上限}) → { 标签, 尺寸? } }
 *   看图            交给模型看图：({ 字节, mime, 提示, 参考标签 }) → { 标签, 描述, 模型?, 用量? }
 *   读元数据(字节)   可选：把 PNG 里的文字块读出来
 *   引擎            可选：{ id, 名字, 阈值 }，只用于"认图默认阈值"与"看模型"那一问
 *
 * 端口里**没有路径**：引用是标识，字节由装配层取。
 */

/** 端口各项的名字、形状与必不必给。 */
const PORT_FUNCS = Object.freeze([
  { 名: '取图字节', 形状: '(引用) → { 字节, mime? }', 必给: false },
  { 名: '查词', 形状: '(词列表) → 中文名 或 null 的数组', 必给: false },
  { 名: 'tagger', 形状: '{ 打标(字节, 选项) → { 标签, 尺寸? } }', 必给: false, 是对象: true },
  { 名: '看图', 形状: '({ 字节, mime, 提示, 参考标签 }) → { 标签, 描述 }', 必给: false },
  { 名: '读元数据', 形状: '(字节) → { 提示词, 负向提示词, 工作流, 参数, 尺寸 }', 必给: false },
]);

/**
 * 校验装配参数。
 * @param {object} [选项]
 * @returns {{ok:boolean, reason?:string}}
 */
function checkPort(选项 = {}) {
  if (!选项 || typeof 选项 !== 'object') return { ok: false, reason: '装配参数必须是对象' };
  for (const { 名, 必给, 是对象 } of PORT_FUNCS) {
    const 值 = 选项[名];
    if (值 === undefined || 值 === null) {
      if (必给) return { ok: false, reason: `${名}必须给` };
      continue;
    }
    if (是对象) {
      if (typeof 值 !== 'object' || typeof 值.打标 !== 'function') {
        return { ok: false, reason: `${名}要是一个带 打标() 的对象，或干脆别给` };
      }
      continue;
    }
    if (typeof 值 !== 'function') return { ok: false, reason: `${名}必须是一个函数，或干脆别给` };
  }
  if (typeof 选项.取图字节 !== 'function' && typeof 选项.读元数据 !== 'function') {
    return { ok: false, reason: '取图字节或读元数据必须给' };
  }
  if (选项.引擎 !== undefined && 选项.引擎 !== null && typeof 选项.引擎 !== 'object') {
    return { ok: false, reason: '引擎要是一个对象，或干脆别给' };
  }
  return { ok: true };
}

module.exports = { checkPort, PORT_FUNCS };
