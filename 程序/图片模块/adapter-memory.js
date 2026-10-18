'use strict';
/*
 * 内存适配器 —— 不碰盘的端口实现，与 adapter-file.js 同契约。
 *
 * 与文件适配器的差别：
 *   - 名字是"作用域/名字"拼出来的字符串键，没有真目录
 *   - 改名是查表换键，一次做完
 *   - trash 交回一个键
 */

const { 作用域路径, 相对路径, TEMP_ROOTS } = require('./adapter-file.js');

/** 创建一个内存适配器。root 是一个固定串。 */
function createMemoryAdapter() {
  /** 键 → { 目录:true } 或 { 字节:Buffer } */
  const 表 = new Map();

  const 键 = (作用域, 名字) => {
    const 域 = 作用域路径(作用域);
    if (!域.ok) return 域;
    if (名字 === undefined || 名字 === null || 名字 === '') return { ok: true, 值: 域.值 };
    const 名 = 相对路径(名字);
    if (!名.ok) return 名;
    return { ok: true, 值: `${域.值}/${名.值}` };
  };

  const 是目录 = (k) => 表.get(k) && 表.get(k).目录 === true;
  const 前缀 = (k) => `${k}/`;

  function list(作用域, 名字) {
    const k = 键(作用域, 名字 === undefined ? '' : 名字);
    if (!k.ok) return { ok: false, reason: k.reason, dirs: [], files: [], 临时: [] };
    const 前 = 前缀(k.值);
    const dirs = [];
    const files = [];
    const 临时 = [];
    for (const 全 of 表.keys()) {
      if (!全.startsWith(前)) continue;
      const 剩 = 全.slice(前.length);
      if (剩.includes('/')) {
        const 头 = 剩.split('/')[0];
        if (!TEMP_ROOTS.includes(头) && !dirs.includes(头)) dirs.push(头);
      } else if (是目录(全)) {
        if (!TEMP_ROOTS.includes(剩) && !dirs.includes(剩)) dirs.push(剩);
      } else if (剩.startsWith('.tmp-')) {
        临时.push(剩);
      } else {
        files.push(剩);
      }
    }
    return { ok: true, dirs: dirs.sort(), files: files.sort(), 临时: 临时.sort() };
  }

  /** 删一个文件。 */
  function removeFile(作用域, 名字) {
    const k = 键(作用域, 名字);
    if (!k.ok) return { ok: false, reason: k.reason };
    表.delete(k.值);
    return { ok: true };
  }

  function stat(作用域, 名字) {
    const k = 键(作用域, 名字);
    if (!k.ok) return { state: 'missing', reason: k.reason };
    const 项 = 表.get(k.值);
    if (!项) return { state: 'missing' };
    return { state: 'ok', kind: 项.目录 ? 'dir' : 'file', mtime: 项.时间 || 0, size: 项.字节 ? 项.字节.length : 0 };
  }

  function readText(作用域, 名字) {
    const r = readBinary(作用域, 名字);
    if (r.state !== 'ok') return r;
    return { state: 'ok', value: r.value.toString('utf8') };
  }

  function readBinary(作用域, 名字) {
    const k = 键(作用域, 名字);
    if (!k.ok) return { state: 'missing' };
    const 项 = 表.get(k.值);
    if (!项 || 项.目录) return { state: 'missing' };
    return { state: 'ok', value: Buffer.from(项.字节) };
  }

  function writeBinary(作用域, 名字, 字节) {
    const k = 键(作用域, 名字);
    if (!k.ok) return { ok: false, reason: k.reason };
    表.set(k.值, { 字节: Buffer.from(字节), 时间: Date.now() });
    return { ok: true };
  }

  const writeText = (作用域, 名字, 文本) => writeBinary(作用域, 名字, Buffer.from(String(文本), 'utf8'));

  function mkdir(作用域, 名字) {
    const k = 键(作用域, 名字);
    if (!k.ok) return { ok: false, reason: k.reason };
    表.set(k.值, { 目录: true, 时间: Date.now() });
    return { ok: true };
  }

  /** 改名：查表换键。一个条目一棵子树，整棵搬过去。 */
  function rename(从作用域, 从名字, 到作用域, 到名字) {
    const 源 = 键(从作用域, 从名字);
    if (!源.ok) return { ok: false, reason: 源.reason };
    const 的 = 键(到作用域, 到名字);
    if (!的.ok) return { ok: false, reason: 的.reason };
    if (!表.has(源.值) && ![...表.keys()].some((x) => x.startsWith(前缀(源.值)))) {
      return { ok: false, reason: '不存在' };
    }
    for (const 全 of [...表.keys()]) {
      if (全 !== 源.值 && !全.startsWith(前缀(源.值))) continue;
      const 新键 = 全 === 源.值 ? 的.值 : `${的.值}${全.slice(源.值.length)}`;
      表.set(新键, 表.get(全));
      表.delete(全);
    }
    return { ok: true };
  }

  function removeDir(作用域, 名字) {
    const k = 键(作用域, 名字);
    if (!k.ok) return { ok: false, reason: k.reason };
    for (const 全 of [...表.keys()]) {
      if (全 === k.值 || 全.startsWith(前缀(k.值))) 表.delete(全);
    }
    return { ok: true };
  }

  /** 内存实现里"回收站"就是把键交回调用方。 */
  const trash = (作用域, 名字) => {
    const k = 键(作用域, 名字);
    return k.ok ? { ok: true, 路径: `mem://${k.值}`, 键: k.值 } : { ok: false, reason: k.reason };
  };

  return {
    root: 'mem://',
    list, stat, readText, writeText, readBinary, writeBinary, removeFile,
    mkdir, rename, removeDir, trash,
    全路径: (作用域, 名字) => {
      const k = 键(作用域, 名字);
      return k.ok ? { ok: true, 值: `mem://${k.值}` } : k;
    },
  };
}

module.exports = { createMemoryAdapter };
