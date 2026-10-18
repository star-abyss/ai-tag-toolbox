'use strict';

function createRealAdapter(dependencies = {}) {
  const { 文本处理, 查词 = null, 译 = null } = dependencies;
  if (!文本处理 || ['切分', '拼装', '猜方向', '需翻译'].some(name => typeof 文本处理[name] !== 'function')) {
    throw new Error('真实适配器要由装配层传入 文本处理');
  }
  if (查词 !== null && typeof 查词 !== 'function') throw new Error('查词 要么是函数，要么别给');
  if (译 !== null && typeof 译 !== 'function') throw new Error('译 要么是函数，要么别给');
  return { 文本处理, 查词, 译 };
}

module.exports = { createRealAdapter };
