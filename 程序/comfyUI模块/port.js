'use strict';
/*
 * comfyUI 模块 · 端口。装配层与核心之间那一小块东西。
 *
 *   探活()                        → { 版本, 设备 }
 *   看队列()                      → { 运行中, 排队中 }
 *   看节点定义()                  → { 节点类名: { output_node, input } }
 *   提交(接口图, 附带)             → { 任务号 }
 *   看任务(任务号)                 → { 状态, 完成, 产出, 错误 }
 *   取结果文件(文件名, 位置)       → { 字节, mime }
 *   送图片(字节, 文件名, mime)     → { 文件名, 子目录, 类型 }
 *
 *   附带 = { clientId, 界面图 }   界面图会随 extra_data.extra_pnginfo.workflow 一起提交
 *   位置 = { 子目录, 类型 }
 *
 *   `取结果文件` 给的是裸字节。要过 JSON 的那几条路（工具回执、动作浏览器的 HTTP 面）
 *   各自在自己的边界上编成 base64；图片模块的「存」两种形状都收，可以直接递给它。
 *
 * 端口一律给结果对象，不抛错。reason 取值：连不上 / 超时 / 权限 / 未知
 */

/** 端口要有的方法。 */
const PORT_METHODS = Object.freeze([
  '探活', '看队列', '看节点定义', '提交', '看任务', '取结果文件', '送图片',
]);

/**
 * 校验一个适配器是否具备端口的全部方法。
 * @param {object} 适配器
 * @returns {{ok:boolean, reason?:string}}
 */
function checkPort(适配器) {
  if (!适配器 || typeof 适配器 !== 'object') return { ok: false, reason: '端口必须是一个对象' };
  for (const 名 of PORT_METHODS) {
    if (typeof 适配器[名] !== 'function') return { ok: false, reason: `端口缺方法：${名}` };
  }
  return { ok: true };
}

/** 把异常收成端口能给的 reason。取错误自身与 cause 链上的码。 */
function reasonOf(错误) {
  const 码们 = [];
  for (let e = 错误; e; e = e.cause) {
    if (e.code) 码们.push(String(e.code));
    if (e.name === 'AbortError' || e.name === 'TimeoutError') 码们.push('ABORT_ERR');
  }
  if (码们.includes('ECONNREFUSED') || 码们.includes('ENOTFOUND')
    || 码们.includes('EHOSTUNREACH') || 码们.includes('ENETUNREACH')
    || 码们.includes('ECONNRESET') || 码们.includes('EPIPE')) return '连不上';
  if (码们.includes('ETIMEDOUT') || 码们.includes('UND_ERR_CONNECT_TIMEOUT')
    || 码们.includes('ABORT_ERR') || 码们.includes('UND_ERR_HEADERS_TIMEOUT')) return '超时';
  if (码们.includes('EACCES') || 码们.includes('EPERM')) return '权限';
  return '未知';
}

/** 把异常收成一行话，给 reason 用。 */
function 说异常(错误) {
  if (!错误) return '';
  const 最里 = (() => { let e = 错误; while (e && e.cause) e = e.cause; return e; })();
  return String((最里 && (最里.message || 最里.code)) || 错误.message || 错误);
}

module.exports = { checkPort, reasonOf, 说异常, PORT_METHODS };
