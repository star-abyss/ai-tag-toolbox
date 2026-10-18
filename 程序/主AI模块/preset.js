'use strict';
/*
 * 预设：字段归一化（纯函数）。
 *
 * 一套预设的形状：
 *   { name, tools: [工具], toolsOrder: [工具名], model: { 走?, 模型? }, runtime?: object }
 *
 * tools 保存业务工具的用户差异；参数schema由业务工具表提供。
 *
 * 只读需要的键：缺了就是缺功能，多了不管，坏了的那一部分不影响别的。
 */

/** 一段文本；不是串就给空串。 */
const 文本 = (值) => (typeof 值 === 'string' ? 值 : 值 === null || 值 === undefined ? '' : String(值));

/** 深拷贝一份 JSON 值。 */
function 拷贝(值) {
  return 值 === undefined ? undefined : JSON.parse(JSON.stringify(值));
}

/** 一串标识：去空、去重、保序。 */
function 一串标识(值) {
  if (!Array.isArray(值)) return [];
  const 出 = [];
  for (const 一 of 值) {
    const 名 = 文本(一).trim();
    if (名 && !出.includes(名)) 出.push(名);
  }
  return 出;
}

/** 一个对象；不是对象就给空对象。 */
function 一对象(值) {
  if (!值 || typeof 值 !== 'object' || Array.isArray(值)) return {};
  return 值;
}

/** 一个工具条目的形状。读不懂就给 null。 */
function 归一工具(源) {
  if (!源 || typeof 源 !== 'object' || Array.isArray(源)) return null;
  const 名字 = 文本(源.名字).trim();
  if (!名字) return null;
  return {
    名字,
    ...(typeof 源.摘要 === 'string' ? { 摘要: 源.摘要 } : {}),
    启用: 源.启用 !== false,
    参数: 拷贝(一对象(源.参数)),
    说明: 拷贝(一对象(源.说明)),
    文本覆盖: 拷贝(一对象(源.文本覆盖)),
  };
}

/** 一整套预设的形状。没有 keys 的东西一律按缺省算。 */
function 归一预设(源) {
  const 是 = 一对象(源);
  const tools = Array.isArray(是.tools) ? 是.tools.map(归一工具).filter(Boolean) : [];
  return {
    name: 文本(是.name),
    tools,
    toolsOrder: 一串标识(是.toolsOrder),
    model: 拷贝(一对象(是.model)),
    runtime: 拷贝(一对象(是.runtime)),
  };
}

module.exports = { 文本, 拷贝, 一串标识, 一对象, 归一工具, 归一预设 };
