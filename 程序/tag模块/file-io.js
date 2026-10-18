'use strict';
/*
 * 文件 IO —— 只管怎么读写文件，不关心数据长什么样。
 *
 *   readJson(相对路径)   三态读一个 JSON 文件
 *   writeJson(相对路径, 值)
 *   readJsonl(相对路径)  一行一条，读成数组
 *   writeJsonl(相对路径, 数组)
 *   removeFile(相对路径)
 *   listDir(相对路径)    列出条目（文件与目录分开）
 *   残留临时(相对路径)   数据根下写剩的临时文件
 */

const fs = require('fs');
const path = require('path');

function createFileIO(root) {
  if (!root) throw new Error('文件层需要一个位置：createFileIO(root)');

  /** 读不懂的文件。 */
  const frozen = new Set();
  /** 进程内读过的值，按文件缓存。 */
  const cache = new Map();

  const 全路径 = (rel) => path.join(root, rel);

  function 建目录(rel) {
    fs.mkdirSync(path.dirname(全路径(rel)), { recursive: true });
  }

  /** 原子写：先写临时文件再改名。 */
  function 写文本(rel, text) {
    建目录(rel);
    const target = 全路径(rel);
    const temp = path.join(path.dirname(target), `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.writeFileSync(temp, text, 'utf8');
    fs.renameSync(temp, target);
  }

  /**
   * 读一个 JSON 文件。
   * @returns {{state:'ok'|'missing'|'unreadable', value?:any, reason?:string}}
   */
  function readJson(rel) {
    if (cache.has(rel)) return { state: 'ok', value: cache.get(rel) };
    let text;
    try {
      text = fs.readFileSync(全路径(rel), 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return { state: 'missing' };
      return { state: 'unreadable', reason: error && error.code ? error.code : 'unknown' };
    }
    try {
      const value = JSON.parse(text);
      cache.set(rel, value);
      return { state: 'ok', value };
    } catch (_) {
      frozen.add(rel);
      return { state: 'unreadable', reason: 'parse' };
    }
  }

  /** 一行一条 JSON。返回记录数组。 */
  function readJsonl(rel) {
    if (cache.has(rel)) return { state: 'ok', value: cache.get(rel) };
    let text;
    try {
      text = fs.readFileSync(全路径(rel), 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return { state: 'missing' };
      return { state: 'unreadable', reason: error && error.code ? error.code : 'unknown' };
    }
    const 行 = [];
    try {
      for (const line of text.split('\n')) {
        const s = line.trim();
        if (s) 行.push(JSON.parse(s));
      }
    } catch (_) {
      frozen.add(rel);
      return { state: 'unreadable', reason: 'parse' };
    }
    cache.set(rel, 行);
    return { state: 'ok', value: 行 };
  }

  /** 这个文件能不能写。 */
  function 可写(rel) {
    return frozen.has(rel) ? { ok: false, reason: '读不懂' } : { ok: true };
  }

  function writeJson(rel, value) {
    const gate = 可写(rel);
    if (!gate.ok) return gate;
    try {
      写文本(rel, JSON.stringify(value, null, 2) + '\n');
      cache.set(rel, value);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: classify(error) };
    }
  }

  /** 一行一条：每个元素一行紧凑 JSON。 */
  function writeJsonl(rel, 行数组) {
    const gate = 可写(rel);
    if (!gate.ok) return gate;
    try {
      const 文本 = 行数组.length ? 行数组.map((r) => JSON.stringify(r)).join('\n') + '\n' : '';
      写文本(rel, 文本);
      cache.set(rel, 行数组);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: classify(error) };
    }
  }

  function removeFile(rel) {
    const gate = 可写(rel);
    if (!gate.ok) return gate;
    try {
      fs.rmSync(全路径(rel), { force: true });
      cache.delete(rel);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: classify(error) };
    }
  }

  /**
   * 列一个目录。目录不存在时给空的。
   * @returns {{files:string[], dirs:string[]}}
   */
  function listDir(rel = '.') {
    try {
      const 条目 = fs.readdirSync(全路径(rel), { withFileTypes: true });
      return {
        files: 条目.filter((e) => e.isFile() && !e.name.includes('.tmp-')).map((e) => e.name).sort(),
        dirs: 条目.filter((e) => e.isDirectory()).map((e) => e.name).sort(),
      };
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return { files: [], dirs: [] };
      throw error;
    }
  }

  function 存在(rel) {
    return fs.existsSync(全路径(rel));
  }

  /** 目录空了就删掉它。不是空目录就什么都不做。 */
  function 删空目录(rel) {
    try {
      const p = 全路径(rel);
      if (!fs.existsSync(p)) return { ok: true };
      if (!fs.statSync(p).isDirectory()) return { ok: true };
      if (fs.readdirSync(p).length) return { ok: true };
      fs.rmdirSync(p);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: classify(error) };
    }
  }

  function 状态(rel) {
    if (cache.has(rel)) return { state: 'ok', frozen: frozen.has(rel) };
    let 文本;
    try {
      文本 = fs.readFileSync(全路径(rel), 'utf8');
    } catch (error) {
      return { state: error && error.code === 'ENOENT' ? 'missing' : 'unreadable', frozen: frozen.has(rel) };
    }
    try {
      JSON.parse(文本.trim() || 'null');
      return { state: 'ok', frozen: frozen.has(rel) };
    } catch (_) {
      return { state: 'unreadable', frozen: frozen.has(rel) };
    }
  }

  /** 数据根下写剩的临时文件（相对路径）。 */
  function 残留临时(rel = '.') {
    const 出 = [];
    const 走 = (当前) => {
      let 条目;
      try {
        条目 = fs.readdirSync(全路径(当前), { withFileTypes: true });
      } catch (_) {
        return;
      }
      for (const e of 条目) {
        const 子 = 当前 === '.' ? e.name : `${当前}/${e.name}`;
        if (e.isDirectory()) 走(子);
        else if (e.name.includes('.tmp-')) 出.push(子);
      }
    };
    走(rel);
    return 出.sort();
  }

  /** 错误码 → 可分辨的理由。 */
  function classify(error) {
    const code = error && error.code;
    if (code === 'EACCES' || code === 'EPERM') return '权限';
    if (code === 'ENOSPC') return '磁盘满';
    if (code === 'EBUSY') return '被占用';
    return '未知';
  }

  return {
    root, readJson, readJsonl, writeJson, writeJsonl, removeFile, listDir, 删空目录, 残留临时,
    exists: 存在, state: 状态,
  };
}

module.exports = { createFileIO };
