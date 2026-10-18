'use strict';
/*
 * 装订模块 · 假适配器。自包含：不 require 任何别的模块。
 *
 *   createFakeAdapter({
 *     库:        { 'hatsune miku': '初音未来', … }   查词用；表里没有的词给 null
 *     译文:      { 'blue eyes': '蓝眼', … }          AI 翻译用
 *     回成:      '对象' | '围栏' | '废话' | '截取' | '数组' | '乱码'    默认 '对象'
 *     不发:      ['某个词']                          这些词故意不回
 *     查词抛错:  真伪
 *     翻译抛错:  真伪
 *     慢:        毫秒数
 *   })
 *
 * 返回值：{ 查词, AI翻译, 记 }。记.查过的 / 记.发过的 攒下每次调用的入参。
 */

/**
 * 把一张对应表按给定形状吐出去。
 * @param {string} 回成
 * @param {object} 译文
 * @returns {string|object}
 */
function 造返回(回成, 译文) {
  if (回成 === '围栏') return '```json\n' + JSON.stringify(译文) + '\n```';
  if (回成 === '废话') return '好的，我来翻译：\n' + JSON.stringify(译文) + '\n以上就是译文。';
  if (回成 === '截取') return '前言 { 不是 JSON } 后语 ' + JSON.stringify(译文);
  if (回成 === '数组') return JSON.stringify(Object.entries(译文).map(([k, v]) => ({ [k]: v })));
  if (回成 === '乱码') return '我拒绝翻译这段内容。';
  return 译文;
}

/**
 * 造一对端口函数。
 * @param {object} [选项]
 * @returns {{查词:Function, AI翻译:Function, 记:object}}
 */
function createFakeAdapter(选项 = {}) {
  const 库 = 选项.库 || {};
  const 译文 = 选项.译文 || {};
  const 回成 = 选项.回成 || '对象';
  const 不发 = new Set(选项.不发 || []);
  const 记 = { 查过的: [], 发过的: [] };

  /**
   * 查词：按词列表给一一对应的中文名或 null。
   * @param {string[]} 词列表
   * @returns {Array<string|null>}
   */
  function 查词(词列表) {
    if (选项.查词抛错) throw new Error('库读不出来');
    记.查过的.push([...词列表]);
    return 词列表.map((词) => (Object.prototype.hasOwnProperty.call(库, 词) ? 库[词] : null));
  }

  /**
   * AI 翻译：按报文里的词给出键值对。
   * @param {{words:string[]}} 报文
   * @returns {Promise<object|string>}
   */
  async function AI翻译(报文) {
    if (选项.翻译抛错) throw new Error('网关 502');
    记.发过的.push(报文);
    if (选项.慢) await new Promise((好) => setTimeout(好, 选项.慢));
    const 给 = {};
    for (const 词 of 报文.words || []) {
      if (不发.has(词)) continue;
      给[词] = Object.prototype.hasOwnProperty.call(译文, 词) ? 译文[词] : `〔${词}〕`;
    }
    return 造返回(回成, 给);
  }

  return { 查词, AI翻译, 记 };
}

module.exports = { createFakeAdapter };
