'use strict';
/*
 * 端口 —— 装配层与核心之间那一小块东西。
 *
 *   list(作用域)               → { dirs, files }                    目录里有什么
 *   stat(作用域, 名字)         → { state, kind?, mtime?, size? }     一个名字是什么
 *   readText(作用域, 名字)     → { state, value?, reason? }          读一小份文本
 *   writeText(作用域, 名字, t) → { ok, reason? }                     原子写一小份文本
 *   readBinary(作用域, 名字)   → { state, value?, reason? }          读字节
 *   mkdir(作用域, 名字)        → { ok, reason? }
 *   rename(作用域, 从, 到)     → { ok, reason? }                     原子改名（跨目录可用）
 *   removeDir(作用域, 名字)    → { ok, reason? }
 *   trash(作用域, 名字)        → { ok, 路径?, 交给?, reason? }        交系统回收站
 *   全路径(作用域, 名字)       → { ok, 值, reason? }                  这个名字的实际位置串
 *
 * 【作用域】路径一律用"作用域 + 名字"表达，**核心不拼路径**：
 *   作用域 = { 存放地:'session'|'gallery'|'vision', 会话ID? , 暂存?:'.staging'|'.deleting' }
 *   名字   = 相对该作用域的一段相对路径，用 '/' 分隔，例如 'img_xxx/original.png'
 *
 *   例：{ 存放地:'gallery', 名字:'img_x/meta.json' }        → <根>/gallery/img_x/meta.json
 *       { 存放地:'session', 会话ID:'A', 名字:'img_x' }      → <根>/session/A/img_x
 *       { 暂存:'.staging', 名字:'img_x/meta.json' }         → <根>/.staging/img_x/meta.json
 *
 * 【读的三态】readText / readBinary / stat 一律给三种 state：
 *   ok         有
 *   missing    确实没有
 *   unreadable 读不懂（带 reason）
 *
 * 【不抛错】除了装配阶段的参数错误，端口一律返回结果对象，reason 取值：
 *   权限 / 磁盘满 / 被占用 / 读不懂 / 不存在 / 未知
 */

/** 端口要有的方法。 */
const PORT_METHODS = [
  'list', 'stat', 'readText', 'writeText', 'readBinary', 'writeBinary', 'removeFile',
  'mkdir', 'rename', 'removeDir', 'trash', '全路径',
];

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

/** 把任意异常收成端口能给的 reason。 */
function reasonOf(error) {
  const code = error && error.code;
  if (code === 'EACCES' || code === 'EPERM') return '权限';
  if (code === 'ENOSPC') return '磁盘满';
  if (code === 'EBUSY' || code === 'ENOTEMPTY') return '被占用';
  if (code === 'ENOENT') return '不存在';
  return '未知';
}

module.exports = { checkPort, reasonOf, PORT_METHODS };
