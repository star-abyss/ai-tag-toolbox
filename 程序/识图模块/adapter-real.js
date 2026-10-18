'use strict';
/*
 * 识图模块 · 真实适配器。把端口接到装配层递来的那些函数上。
 *
 *   const 端口 = createRealAdapter({ 取图字节, 查词, tagger, 看图, 读元数据, 引擎 })
 *
 * 本适配器只 require 递进来的东西，不 require 别的模块。
 */

/**
 * @param {object} [递]
 * @returns {{取图字节:Function|null, 查词:Function|null, tagger:object|null, 看图:Function|null, 读元数据:Function|null, 引擎:object|null}}
 */
function createRealAdapter(递 = {}) {
  if (typeof 递.取图字节 !== 'function' && typeof 递.读元数据 !== 'function') {
    throw new Error('真实适配器要一个 取图字节 或 读元数据 函数');
  }
  if (递.查词 !== undefined && 递.查词 !== null && typeof 递.查词 !== 'function') {
    throw new Error('查词 要么是函数，要么别给');
  }
  if (递.tagger !== undefined && 递.tagger !== null) {
    if (typeof 递.tagger !== 'object' || typeof 递.tagger.打标 !== 'function') {
      throw new Error('tagger 要么是带 打标() 的对象，要么别给');
    }
  }
  for (const 名 of ['看图', '读元数据']) {
    const 值 = 递[名];
    if (值 !== undefined && 值 !== null && typeof 值 !== 'function') {
      throw new Error(`${名} 要么是函数，要么别给`);
    }
  }

  return {
    取图字节: 递.取图字节 || null,
    查词: 递.查词 || null,
    tagger: 递.tagger || null,
    看图: 递.看图 || null,
    读元数据: 递.读元数据 || null,
    引擎: 递.引擎 || null,
  };
}

module.exports = { createRealAdapter };
