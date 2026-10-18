'use strict';
/*
 * 文件适配器 —— require fs / path 的地方。
 *
 * 核心说"在某个作用域下，对某个名字做点什么"，由这里翻成真实路径：
 *
 *   作用域 = { 存放地:'session', 会话ID:'A' }      → <根>/session/A
 *   作用域 = { 存放地:'gallery' }                  → <根>/gallery
 *   作用域 = { 存放地:'vision' }                   → <根>/vision
 *   作用域 = { 暂存:'.staging' }                   → <根>/.staging
 *   作用域 = { 暂存:'.deleting', 批次:'del_xxx' }  → <根>/.deleting/del_xxx
 *
 * 读返回三态：{ state:'ok' } / { state:'missing' } / { state:'unreadable', reason }。
 * 写先写临时文件再改名。
 */

const fs = require('fs');
const path = require('path');
const { reasonOf } = require('./port.js');

/*
 * 一段路径名的字符集：字母数字、点、下划线、连字符、汉字。
 * 分隔符不在字符集里；`.` 与 `..` 由整段比较拦掉。
 */
const SAFE_SEGMENT = /^[A-Za-z0-9._\u4e00-\u9fa5-]+$/;

/** 两个临时位置。 */
const TEMP_ROOTS = ['.staging', '.deleting'];

const 存放地们 = ['session', 'gallery', 'vision'];

/** 校验一段名字。 */
function 安全段(段, 说明) {
  const 文本 = String(段 == null ? '' : 段).trim();
  if (!文本 || 文本 === '.' || 文本 === '..' || !SAFE_SEGMENT.test(文本)) {
    return { ok: false, reason: `${说明}不是安全的一段路径：${JSON.stringify(段)}` };
  }
  return { ok: true, 值: 文本 };
}

/** 把作用域翻成相对根目录的一段路径。 */
function 作用域路径(作用域) {
  const s = 作用域 || {};
  if (s.暂存) {
    if (!TEMP_ROOTS.includes(s.暂存)) return { ok: false, reason: `不是临时位置：${s.暂存}` };
    if (!s.批次) return { ok: true, 值: s.暂存 };
    const 批 = 安全段(s.批次, '批次');
    return 批.ok ? { ok: true, 值: `${s.暂存}/${批.值}` } : 批;
  }
  if (!存放地们.includes(s.存放地)) return { ok: false, reason: `不是存放地：${s.存放地}` };
  if (s.存放地 === 'session') {
    if (!s.会话ID) return { ok: true, 值: 'session' };
    const 会 = 安全段(s.会话ID, '会话 ID');
    return 会.ok ? { ok: true, 值: `session/${会.值}` } : 会;
  }
  if (s.会话ID) return { ok: false, reason: `${s.存放地} 没有会话 ID 这一层` };
  return { ok: true, 值: s.存放地 };
}

/** 校验一段相对路径（可含多段）。 */
function 相对路径(名字) {
  const 文本 = String(名字 == null ? '' : 名字).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!文本) return { ok: false, reason: '名字不能为空' };
  const 段们 = 文本.split('/');
  for (const 段 of 段们) {
    const r = 安全段(段, '名字');
    if (!r.ok) return r;
  }
  return { ok: true, 值: 段们.join('/') };
}

function createFileAdapter(options = {}) {
  if (!options.root) throw new Error('文件适配器需要一个根目录：createFileAdapter({ root })');
  const root = path.resolve(options.root);
  if (root === path.parse(root).root) throw new Error('根目录不能是盘根');

  /** 作用域 + 名字 → 绝对路径。 */
  function 全路径(作用域, 名字) {
    const 域 = 作用域路径(作用域);
    if (!域.ok) return 域;
    const 完整 = path.join(root, 域.值);
    if (名字 === undefined || 名字 === null || 名字 === '') return { ok: true, 值: 完整, 域: 域.值 };
    const 名 = 相对路径(名字);
    if (!名.ok) return 名;
    const 目标 = path.join(root, 域.值, 名.值);
    const 相对 = path.relative(root, 目标);
    if (相对.startsWith('..') || path.isAbsolute(相对)) return { ok: false, reason: '越出根目录' };
    return { ok: true, 值: 目标, 域: 域.值, 名: 名.值 };
  }

  function 建父目录(目标) {
    fs.mkdirSync(path.dirname(目标), { recursive: true });
  }

  /** 原子写：临时文件与目标同目录，写完改名。 */
  function 原子写文本(目标, 文本) {
    建父目录(目标);
    const 临时 = path.join(path.dirname(目标), `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    try {
      fs.writeFileSync(临时, 文本, 'utf8');
      fs.renameSync(临时, 目标);
    } catch (error) {
      try { fs.unlinkSync(临时); } catch (_) { /* 忽略 */ }
      throw error;
    }
  }

  function 读字节(目标) {
    try {
      return { state: 'ok', value: fs.readFileSync(目标) };
    } catch (error) {
      if (error && error.code === 'ENOENT') return { state: 'missing' };
      return { state: 'unreadable', reason: reasonOf(error) };
    }
  }

  // ---------------- 端口方法 ----------------

  /** 列一个作用域目录。名字可给子目录。临时文件单独给，不进 files。 */
  function list(作用域, 名字) {
    const 域 = 全路径(作用域, 名字 === undefined ? '' : 名字);
    if (!域.ok) return 域;
    try {
      const 条目 = fs.readdirSync(域.值, { withFileTypes: true });
      return {
        ok: true,
        dirs: 条目
          .filter((e) => e.isDirectory() && !TEMP_ROOTS.includes(e.name) && !e.name.startsWith('.tmp-'))
          .map((e) => e.name).sort(),
        files: 条目
          .filter((e) => e.isFile() && !e.name.startsWith('.tmp-'))
          .map((e) => e.name).sort(),
        // 原子写留下的临时文件。不进 files，只给维护用。
        临时: 条目
          .filter((e) => e.name.startsWith('.tmp-'))
          .map((e) => e.name).sort(),
      };
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return { ok: true, dirs: [], files: [], 临时: [] };
      return { ok: false, reason: reasonOf(error), dirs: [], files: [], 临时: [] };
    }
  }

  /** 删一个文件。 */
  function removeFile(作用域, 名字) {
    const 目标 = 全路径(作用域, 名字);
    if (!目标.ok) return { ok: false, reason: 目标.reason };
    try {
      fs.rmSync(目标.值, { force: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: reasonOf(error) };
    }
  }

  /** 一个名字是什么。三态。 */
  function stat(作用域, 名字) {
    const 目标 = 全路径(作用域, 名字);
    if (!目标.ok) return { state: 'missing', reason: 目标.reason };
    try {
      const s = fs.statSync(目标.值);
      return {
        state: 'ok',
        kind: s.isDirectory() ? 'dir' : 'file',
        mtime: s.mtimeMs,
        size: s.size,
      };
    } catch (error) {
      if (error && error.code === 'ENOENT') return { state: 'missing' };
      return { state: 'unreadable', reason: reasonOf(error) };
    }
  }

  function readText(作用域, 名字) {
    const 目标 = 全路径(作用域, 名字);
    if (!目标.ok) return { state: 'missing' };
    try {
      return { state: 'ok', value: fs.readFileSync(目标.值, 'utf8') };
    } catch (error) {
      if (error && error.code === 'ENOENT') return { state: 'missing' };
      return { state: 'unreadable', reason: reasonOf(error) };
    }
  }

  function writeText(作用域, 名字, 文本) {
    const 目标 = 全路径(作用域, 名字);
    if (!目标.ok) return { ok: false, reason: 目标.reason };
    try {
      原子写文本(目标.值, 文本);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: reasonOf(error) };
    }
  }

  function readBinary(作用域, 名字) {
    const 目标 = 全路径(作用域, 名字);
    if (!目标.ok) return { state: 'missing' };
    return 读字节(目标.值);
  }

  /** 原子写字节。图片是二进制，走这个口。 */
  function writeBinary(作用域, 名字, 字节) {
    const 目标 = 全路径(作用域, 名字);
    if (!目标.ok) return { ok: false, reason: 目标.reason };
    建父目录(目标.值);
    const 临时 = path.join(path.dirname(目标.值), `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    try {
      fs.writeFileSync(临时, 字节);
      fs.renameSync(临时, 目标.值);
      return { ok: true };
    } catch (error) {
      try { fs.unlinkSync(临时); } catch (_) { /* 忽略 */ }
      return { ok: false, reason: reasonOf(error) };
    }
  }

  function mkdir(作用域, 名字) {
    const 目标 = 全路径(作用域, 名字);
    if (!目标.ok) return { ok: false, reason: 目标.reason };
    try {
      fs.mkdirSync(目标.值, { recursive: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: reasonOf(error) };
    }
  }

  /** 原子改名：把「从」位置的整棵子树搬到「到」位置。跨目录可用。 */
  function rename(从作用域, 从名字, 到作用域, 到名字) {
    const 源 = 全路径(从作用域, 从名字);
    if (!源.ok) return { ok: false, reason: 源.reason };
    const 的 = 全路径(到作用域, 到名字);
    if (!的.ok) return { ok: false, reason: 的.reason };
    try {
      建父目录(的.值);
      fs.renameSync(源.值, 的.值);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: reasonOf(error), code: error && error.code };
    }
  }

  function removeDir(作用域, 名字) {
    const 目标 = 全路径(作用域, 名字);
    if (!目标.ok) return { ok: false, reason: 目标.reason };
    try {
      fs.rmSync(目标.值, { recursive: true, force: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: reasonOf(error) };
    }
  }

  /** 交系统回收站：给 { ok, 交给, 路径 } 或 { ok:false, reason }。 */
  function trash(作用域, 名字) {
    const 目标 = 全路径(作用域, 名字);
    if (!目标.ok) return { ok: false, reason: 目标.reason };
    if (typeof options.trashItem !== 'function') return { ok: false, reason: '回收站未配置' };
    return { ok: true, 交给: options.trashItem, 路径: 目标.值 };
  }

  return {
    root,
    list, stat, readText, writeText, readBinary, writeBinary, removeFile,
    mkdir, rename, removeDir, trash,
    // 把作用域 + 名字翻成绝对路径
    全路径: (作用域, 名字) => 全路径(作用域, 名字),
  };
}

module.exports = { createFileAdapter, 作用域路径, 相对路径, 安全段, TEMP_ROOTS };
