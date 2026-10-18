'use strict';
/*
 * 装订模块 · 真实适配器。把本模块的两个端口接到递进来的函数上。
 *
 *   createRealAdapter({ 认词, 取提示词, 发请求, 用途 })
 *
 *   认词     (词列表) → 中文名 或 null 的数组          查词用
 *   取提示词 (报文) → 那一段系统提示词                  AI 翻译用
 *   发请求   ({ 用途, system, user }) → 正文            AI 翻译用
 *   用途     用途名，默认 '翻译'
 *
 * 本适配器只 require 递进来的东西，不 require 别的模块。
 */

/**
 * 报文 → 交给模型的一段话。
 * @param {{source:string, words:string[], from:string, to:string}} 报文
 * @returns {string}
 */
function 报文成话(报文) {
  return JSON.stringify({
    source: 报文.source,
    words: 报文.words,
    from: 报文.from,
    to: 报文.to,
  }, null, 2);
}

/**
 * 造一对端口函数。
 * @param {{认词?:Function, 取提示词?:Function, 发请求?:Function, 用途?:string}} [选项]
 * @returns {{查词:Function, AI翻译:Function}}
 */
function createRealAdapter(选项 = {}) {
  const 认词 = 选项.认词;
  const 取提示词 = 选项.取提示词;
  const 发请求 = 选项.发请求;
  const 用途 = 选项.用途 ?? '翻译';

  /**
   * 查词：交给递来的认词函数。
   * @param {string[]} 词列表
   * @returns {Array<string|null>}
   */
  function 查词(词列表) {
    if (typeof 认词 !== 'function') throw new Error('没递认词函数');
    const 答 = 认词(词列表);
    return Array.isArray(答) ? 答 : [];
  }

  /**
   * AI 翻译：取提示词 → 发请求 → 原样交回正文。
   * @param {object} 报文
   * @returns {Promise<string>}
   */
  async function AI翻译(报文) {
    if (typeof 发请求 !== 'function') throw new Error('没递发请求');
    const 系统 = typeof 取提示词 === 'function' ? 取提示词(报文) : '';
    const 正文 = await 发请求({ 用途, system: 系统, user: 报文成话(报文) });
    return 正文;
  }

  return { 查词, AI翻译 };
}

module.exports = { createRealAdapter };
