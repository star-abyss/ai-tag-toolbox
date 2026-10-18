'use strict';
/*
 * 世界书模块 · 文件适配器。唯一 require fs / path 的地方。
 *
 * 两个位置：
 *   用户那份：<根目录>/世界书.json      可写；原子写（临时文件 + 改名）
 *   只读默认：<默认目录>/<名字>.json     只读，一本书一个文件
 *
 * 默认的文件名（去掉 .json）就是那本书的名字，也是它对外标识里那一段。
 *
 * 读返回三态：ok 有 / missing 确实没有 / unreadable 读不懂。
 */

const fs = require('fs');
const path = require('path');
const { reasonOf } = require('./port.js');

/** 用户那份的文件名。 */
const 状态文件名 = '世界书.json';

/** 文件名里不能有的字符：路径分隔符与控制字符。 */
const 非法名字 = /[\\/:*?"<>|\u0000-\u001f]/;

/** 一个名字能不能当文件名用。 */
function 名字可用(名) {
  const 一 = String(名 == null ? '' : 名).trim();
  if (!一 || 一 === '.' || 一 === '..') return false;
  return !非法名字.test(一);
}

/**
 * @param {{ root:string, 默认目录:string }} options
 */
function createFileAdapter(options = {}) {
  if (!options.root) throw new Error('文件适配器需要一个根目录：createFileAdapter({ root })');
  if (!options.默认目录) throw new Error('文件适配器需要默认世界书目录：createFileAdapter({ 默认目录 })');
  const root = path.resolve(options.root);
  if (root === path.parse(root).root) throw new Error('根目录不能是盘根');
  const 默认根 = path.resolve(options.默认目录);

  /** 原子写：临时文件与目标同目录，写完改名。 */
  function 原子写(目标, 文本) {
    fs.mkdirSync(path.dirname(目标), { recursive: true });
    const 临时 = path.join(path.dirname(目标), `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    try {
      fs.writeFileSync(临时, 文本, 'utf8');
      fs.renameSync(临时, 目标);
    } catch (error) {
      try { fs.unlinkSync(临时); } catch (_) { /* 临时文件没清掉 */ }
      throw error;
    }
  }

  /** 读一段文本并解析成对象。三态。 */
  function 读对象(目标) {
    let 文本;
    try {
      文本 = fs.readFileSync(目标, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return { state: 'missing' };
      return { state: 'unreadable', reason: reasonOf(error) };
    }
    try {
      return { state: 'ok', value: JSON.parse(文本) };
    } catch (_) {
      return { state: 'unreadable', reason: '读不懂' };
    }
  }

  function readState() {
    return 读对象(path.join(root, 状态文件名));
  }

  function writeState(value) {
    try {
      原子写(path.join(root, 状态文件名), JSON.stringify(value, null, 2));
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: reasonOf(error) };
    }
  }

  /** 只读默认目录下所有 <名字>.json。读不懂的也收进清单，标 state:'unreadable'。 */
  function listDefaults() {
    let 列;
    try {
      列 = fs.readdirSync(默认根, { withFileTypes: true });
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return { ok: true, items: [] };
      return { ok: false, reason: reasonOf(error) };
    }
    const items = [];
    for (const 项 of 列) {
      if (!项.isFile() || path.extname(项.name).toLowerCase() !== '.json') continue;
      if (项.name.startsWith('.tmp-')) continue;
      const 名字 = path.parse(项.name).name;
      if (!名字可用(名字)) continue;
      const 读 = 读对象(path.join(默认根, 项.name));
      if (读.state === 'ok') {
        items.push({
          名字,
          条目数: Array.isArray(读.value && 读.value.entries) ? 读.value.entries.length : 0,
        });
      } else {
        items.push({ 名字, 条目数: 0, state: 读.state });
      }
    }
    items.sort((a, b) => a.名字.localeCompare(b.名字, 'zh'));
    return { ok: true, items };
  }

  function readDefault(名字) {
    const 一 = String(名字 == null ? '' : 名字).trim();
    if (!名字可用(一)) return { state: 'missing' };
    return 读对象(path.join(默认根, `${一}.json`));
  }

  return {
    readState,
    writeState,
    listDefaults,
    readDefault,
  };
}

module.exports = { createFileAdapter };
