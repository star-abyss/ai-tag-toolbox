'use strict';
/*
 * 世界书模块 · 端口。装配层与核心之间那一小块东西。
 *
 *   readState()           → { state:'ok'|'missing'|'unreadable', value?, reason? }
 *   writeState(value)     → { ok, reason? }
 *   listDefaults()        → { ok, items?: [{ 名字, 条目数, state? }], reason? }
 *   readDefault(名字)     → { state, value?, reason? }     value 是已解析的世界书对象
 *
 * 读的三种 state：ok 有 / missing 确实没有 / unreadable 读不懂（带 reason）。
 *
 * 两个位置：
 *   用户那份：readState / writeState      可写
 *   只读默认：listDefaults / readDefault  只读，一本书一个文件；名字就是文件名（不带 .json）
 *
 * 除装配阶段外不抛错；reason 取值：权限 / 磁盘满 / 被占用 / 读不懂 / 不存在 / 未知。
 */

/** 端口必须有的方法。 */
const PORT_METHODS = ['readState', 'writeState', 'listDefaults', 'readDefault'];

/**
 * 校验一个适配器是否具备端口的全部方法。
 * @param {object} adapter
 * @returns {{ok:boolean, reason?:string}}
 */
function checkPort(adapter) {
  if (!adapter || typeof adapter !== 'object') return { ok: false, reason: '端口必须是一个对象' };
  for (const name of PORT_METHODS) {
    if (typeof adapter[name] !== 'function') return { ok: false, reason: `端口缺方法：${name}` };
  }
  return { ok: true };
}

/** 把异常码收成端口能给的 reason。 */
function reasonOf(error) {
  const code = error && error.code;
  if (code === 'EACCES' || code === 'EPERM') return '权限';
  if (code === 'ENOSPC') return '磁盘满';
  if (code === 'EBUSY' || code === 'ENOTEMPTY') return '被占用';
  if (code === 'ENOENT') return '不存在';
  return '未知';
}

module.exports = { checkPort, reasonOf, PORT_METHODS };
