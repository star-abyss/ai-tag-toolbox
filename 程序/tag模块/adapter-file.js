'use strict';
/*
 * 适配器：文件。
 *
 * 位置由装配层递进来：createFilePort({ root: '…/data' })
 */

const { createLayoutPort } = require('./port.js');

/**
 * @param {{ root:string }} options
 * @returns {object} 一个端口
 */
function createFilePort(options = {}) {
  const port = createLayoutPort({ root: options.root });
  return {
    read: (key) => port.read(key),
    set: (key, value) => port.set(key, value),
    remove: (key) => port.remove(key),
    list: (prefix) => port.list(prefix),
    scan: () => port.scan(),
    status: (key) => port.status(key),
    // 端口六法之外的一条：忘记（丢缓存）
    忘记: () => port.忘记(),
  };
}

module.exports = { createFilePort };
