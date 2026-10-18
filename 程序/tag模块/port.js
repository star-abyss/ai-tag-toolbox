'use strict';
/*
 * 端口 —— 装配层与核心之间那一小块东西。
 *
 *   read(key)          → { state, value?, reason? }
 *   set(key, value)    → { ok, reason? }
 *   remove(key)        → { ok, reason? }
 *   list(prefix?)      → [键名]
 *   scan()             → { keys, temp, external }
 *   status(key)        → { key, state, reason?, frozen }
 *
 * read 的三种 state：
 *   ok         有值
 *   missing    确实没有
 *   unreadable 读不懂（带 reason）
 *
 * set / remove 返回 { ok, reason? }，reason 取值：权限 / 磁盘满 / 被占用 / 读不懂 / 未知。
 *
 * 这个端口把逻辑键落到一套多文件布局上（见 layout.js）：
 *   一个键可能是一个文件、一个目录，或一组按 ID 分片的文件。
 */

const { createFileIO } = require('./file-io.js');
const { createLayout, 记录行 } = require('./layout.js');
const { deepCopy } = require('./normalize.js');

/** 端口必须有的方法。 */
const PORT_METHODS = ['read', 'set', 'remove', 'list', 'scan', 'status'];

/**
 * 校验一个适配器是否具备端口的全部方法。
 * @param {object} adapter
 * @returns {{ok:boolean, reason?:string}}
 */
function checkPort(adapter) {
  if (!adapter || typeof adapter !== 'object') return { ok: false, reason: '端口必须是一个对象' };
  for (const name of PORT_METHODS) {
    if (typeof adapter[name] !== 'function') return { ok: false, reason: `端口缺方法：${name}` };
  }
  return { ok: true };
}

function createLayoutPort(options = {}) {
  const io = createFileIO(options.root);
  // 分片大小是盘上那份数据的形状：索引里记着就用它，新库才用装配层给的
  const 索引 = io.readJson('index.json');
  const 盘上分片 = 索引.state === 'ok' && 索引.value && Number(索引.value.分片) > 0 ? Number(索引.value.分片) : null;
  const 布局 = createLayout(盘上分片 || options.分片 || 1000);
  const 记录缓存 = new Map();   // 逻辑键 → shell
  const 位置缓存 = new Map();   // 根 → { 页列表 }
  /** 读不全的库：能读，但不许写。 */
  const 只读 = new Map();

  /** 这个键能不能写。 */
  function 可写(key) {
    if (只读.has(key)) return { ok: false, reason: `读不懂：${只读.get(key)}` };
    return { ok: true };
  }

  // ---------- 记录 ----------

  /**
   * 读一个记录库。
   * @returns {{state:string, value?:object, reason?:string}}
   */
  function 读记录(key) {
    if (记录缓存.has(key)) return { state: 'ok', value: deepCopy(记录缓存.get(key)) };
    if (key === '主库') {
      const shell = { 格式: 'tag-library/主库', 版本: 1, 计数器: 0, 记录列表: [] };
      let 坏 = 0;
      for (const f of io.listDir('记录/主库').files) {
        if (!f.endsWith('.jsonl')) continue;
        const r = io.readJsonl(`记录/主库/${f}`);
        if (r.state === 'ok') shell.记录列表.push(...r.value);
        else if (r.state === 'unreadable') 坏++;
      }
      // 坏片读不出来，但**能读的照读**：查询照常，只把这个库标成只读、拒绝写入。
      // 若整库都读不出来，那就是没有。
      if (坏) {
        只读.set(key, `有 ${坏} 片读不懂`);
        if (!shell.记录列表.length) return { state: 'unreadable', reason: 'parse' };
      }
      shell.记录列表.sort((a, b) => Number(a.ID) - Number(b.ID));
      const idx = io.readJson('index.json');
      if (idx.state === 'ok' && idx.value && idx.value.计数器) shell.计数器 = idx.value.计数器.主库 || 0;
      记录缓存.set(key, shell);
      return { state: 'ok', value: deepCopy(shell) };
    }
    const r = io.readJsonl(布局.路径(key));
    if (r.state === 'missing') return { state: 'missing' };
    if (r.state === 'unreadable') {
      只读.set(key, '读不懂');
      return { state: 'unreadable', reason: r.reason };
    }
    const shell = { 格式: `tag-library/${key}`, 版本: 1, 计数器: 0, 记录列表: r.value };
    if (key === '自建库') {
      const idx = io.readJson('index.json');
      const 数 = idx.state === 'ok' && idx.value && idx.value.计数器 ? idx.value.计数器.自建库 : null;
      if (typeof 数 === 'number') shell.计数器 = 数;
      // 计数器只从索引来：没有它就不许分配新 ID（不拿记录条数顶，那会重新发号）
      else 只读.set(key, '索引里没有自建库计数器，不能分配新 ID');
    }
    记录缓存.set(key, shell);
    return { state: 'ok', value: deepCopy(shell) };
  }

  /** 计数器落盘：读现成的，只改要改的那一项。 */
  function 记计数器(key, 值) {
    const idx = io.readJson('index.json');
    const 现在 = idx.state === 'ok' && idx.value ? idx.value : {};
    return io.writeJson('index.json', {
      ...现在,
      格式: 'tag-module/索引',
      版本: 1,
      分片: 布局.分片,
      计数器: { ...(现在.计数器 || {}), [key]: 值 },
    });
  }

  /**
   * 一道闸：这一片里不许有 ID 不在本片区间内的记录。
   * 片号由 ID 算出来（`floor(ID ÷ 分片大小)`），所以片里出现别的区间的 ID 就是写错了。
   * @returns {{ok:boolean, reason?:string}}
   */
  function 查片(片号, 片) {
    const 起 = 片号 * 布局.分片;
    const 止 = 起 + 布局.分片 - 1;
    const 越界 = 片.filter((r) => !(Number(r.ID) >= 起 && Number(r.ID) <= 止));
    if (!越界.length) return { ok: true };
    return {
      ok: false,
      reason: `第 ${片号} 片混进了 ${越界.length} 条不属于它的记录（`
        + `该片是 ${起} – ${止}，例如 ${越界[0].ID}）`,
    };
  }

  /**
   * @param {Array} 记录数组 新增或改动后的记录
   * @param {string[]} 删掉 要移除的记录 ID
   */
  function 改主库(记录数组, 删掉) {
    const 门 = 可写('主库');
    if (!门.ok) return 门;
    const 片集 = new Set();
    for (const r of 记录数组) 片集.add(布局.片号(r.ID));
    for (const id of 删掉) 片集.add(布局.片号(id));
    for (const 片号 of 片集) {
      const rel = `记录/主库/${布局.片名(片号)}.jsonl`;
      // 只并"属于这一片"的那几条：片号由 ID 算出来，拿整批改动去并会把别片的记录推进来
      const 本片 = 记录数组.filter((rec) => 布局.片号(rec.ID) === 片号);
      const r = io.readJsonl(rel);
      const 片 = r.state === 'ok' ? [...r.value] : [];
      for (const id of 删掉) {
        const at = 片.findIndex((x) => String(x.ID) === String(id));
        if (at >= 0) 片.splice(at, 1);
      }
      for (const rec of 本片) {
        const at = 片.findIndex((x) => String(x.ID) === String(rec.ID));
        if (at >= 0) 片[at] = deepCopy(rec); else 片.push(deepCopy(rec));
      }
      片.sort((a, b) => Number(a.ID) - Number(b.ID));
      const 查 = 查片(片号, 片);
      if (!查.ok) return 查;
      const w = 片.length ? io.writeJsonl(rel, 片) : io.removeFile(rel);
      if (!w.ok) return w;
    }
    // 缓存里的整库已经旧了，丢掉
    记录缓存.delete('主库');
    return { ok: true };
  }

  /** 非分片库（自建 / 隐藏 / 修改）：整份写一个文件。主库不走这里。 */
  function 写记录(key, shell) {
    const 门 = 可写(key);
    if (!门.ok) return 门;
    const 列表 = shell.记录列表 || [];
    const rel = 布局.路径(key);
    const w = 列表.length ? io.writeJsonl(rel, 列表) : io.removeFile(rel);
    if (!w.ok) return w;
    if (key === '自建库') {
      const w2 = 记计数器('自建库', shell.计数器);
      if (!w2.ok) return w2;
    }
    记录缓存.set(key, deepCopy(shell));
    return { ok: true };
  }

  // ---------- 位置 ----------

  function 读位置(根名) {
    if (位置缓存.has(根名)) return 位置缓存.get(根名);
    const shell = { 格式: 'tag-library/位置', 版本: 1, 计数器: 0, 页列表: [] };
    for (const 页ID of 布局.页们(io, 根名)) {
      const m = io.readJson(`位置/${根名}/${页ID}/页.json`);
      if (m.state !== 'ok') continue;
      const 页 = { ID: Number(页ID), ...deepCopy(m.value) };
      if (!Array.isArray(页.类列表)) 页.类列表 = [];
      shell.页列表.push(页);
      shell.计数器 = Math.max(shell.计数器, 页.ID, ...页.类列表.map((c) => Number(c.ID) || 0));
    }
    shell.页列表.sort((a, b) => a.ID - b.ID);
    位置缓存.set(根名, shell);
    return shell;
  }

  const 根名 = (key) => (key === '分类字典' ? '分类' : '收藏');

  /** 写一棵位置树：按文件比对，只写变了的。 */
  function 写位置(key, shell) {
    const 名 = 根名(key);
    const 盘上页 = new Set(布局.页们(io, 名));
    const 盘上格 = new Map();
    for (const 页ID of 盘上页) 盘上格.set(页ID, new Set(布局.类们(io, 名, 页ID)));

    for (const 页 of shell.页列表 || []) {
      const 页ID = String(页.ID);
      盘上页.delete(页ID);
      const rel = `位置/${名}/${页ID}/页.json`;
      const 新元 = { 页名: 页.页名, 配色: 页.配色, 类列表: (页.类列表 || []).map((c) => ({ ID: c.ID, 类名: c.类名, 配色: c.配色 })) };
      const 旧元 = io.readJson(rel);
      if (!(旧元.state === 'ok' && JSON.stringify(旧元.value) === JSON.stringify(新元))) {
        const w = io.writeJson(rel, 新元);
        if (!w.ok) return w;
      }
      const 剩 = 盘上格.get(页ID) || new Set();
      for (const 类 of 页.类列表 || []) {
        const 类ID = String(类.ID);
        剩.delete(类ID);
        const 成员 = io.readJson(`位置/${名}/${页ID}/${类ID}.json`);
        if (成员.state === 'missing') continue;   // 空格不建文件
      }
      for (const 多余 of 剩) io.removeFile(`位置/${名}/${页ID}/${多余}.json`);
      io.删空目录(`位置/${名}/${页ID}`);
    }
    for (const 多余页 of 盘上页) {
      for (const f of io.listDir(`位置/${名}/${多余页}`).files) io.removeFile(`位置/${名}/${多余页}/${f}`);
      io.删空目录(`位置/${名}/${多余页}`);
    }
    位置缓存.set(名, deepCopy(shell));
    return { ok: true };
  }

  // ---------- 键的登记 ----------

  /** 盘上现有的逻辑键。 */
  function 现有键() {
    const keys = [];
    if (io.exists('index.json')) keys.push('索引');
    for (const f of io.listDir('表').files) {
      if (f.endsWith('.json')) keys.push(f.slice(0, -5));
    }
    if (io.exists('记录/主库')) keys.push('主库');
    for (const f of io.listDir('记录').files) {
      if (!f.endsWith('.jsonl')) continue;
      const k = f.slice(0, -6);
      if (k !== '主库') keys.push(k);
    }
    for (const 名 of 布局.根) {
      for (const 页ID of 布局.页们(io, 名)) {
        for (const 类ID of 布局.类们(io, 名, 页ID)) keys.push(`${名}.${页ID}.${类ID}`);
      }
    }
    return keys;
  }

  // ---------- 端口 ----------

  function read(key) {
    if (布局.是布局键(key)) {
      if (key === '索引') {
        const r = io.readJson('index.json');
        return r.state === 'ok' ? { state: 'ok', value: r.value } : { state: r.state, reason: r.reason };
      }
      if (布局.表键.includes(key)) {
        const r = io.readJson(布局.路径(key));
        return r.state === 'ok' ? { state: 'ok', value: r.value } : { state: r.state, reason: r.reason };
      }
      if (布局.记录键.includes(key)) return 读记录(key);
      if (key === '分类字典' || key === '收藏字典') {
        return { state: 'ok', value: 读位置(根名(key)) };
      }
      const 格 = /^(分类|收藏)\.(\d+)\.(\d+)$/.exec(key);
      if (格) {
        const r = io.readJson(布局.路径(key));
        return r.state === 'ok' ? { state: 'ok', value: r.value } : { state: r.state, reason: r.reason };
      }
      const 片 = /^主库\.(\d+)$/.exec(key);
      if (片) {
        const r = io.readJsonl(布局.路径(key));
        return r.state === 'ok' ? { state: 'ok', value: r.value } : { state: r.state, reason: r.reason };
      }
    }
    // 页级读：分类.<页ID>
    const 页 = /^(分类|收藏)\.(\d+)$/.exec(key);
    if (页) {
      const shell = 读位置(页[1]);
      const 找到 = shell.页列表.find((p) => String(p.ID) === 页[2]);
      return 找到 ? { state: 'ok', value: 找到 } : { state: 'missing' };
    }
    return { state: 'missing' };
  }

  function set(key, value, 提示) {
    if (!布局.是布局键(key)) return { ok: false, reason: `布局里没有这个键：${key}` };
    if (布局.表键.includes(key)) return io.writeJson(布局.路径(key), value);
    if (布局.记录键.includes(key)) {
      // 主库：只按 ID 改动（记录 / 删掉）
      if (key === '主库') {
        const 改的 = (提示 && 提示.记录) || [];
        const 删的 = (提示 && 提示.删掉) || [];
        // 没给提示时，拿缓存比出到底改了哪几条
        if (!改的.length && !删的.length && 记录缓存.has('主库')) {
          const 旧的 = 记录缓存.get('主库').记录列表 || [];
          const 新的 = (value.记录列表) || [];
          const 旧表 = new Map(旧的.map((r) => [String(r.ID), 记录行(r)]));
          const 新表 = new Map(新的.map((r) => [String(r.ID), 记录行(r)]));
          for (const [id, 行] of 新表) if (旧表.get(id) !== 行) 改的.push(新的.find((r) => String(r.ID) === id));
          for (const id of 旧表.keys()) if (!新表.has(id)) 删的.push(id);
        }
        return 改主库(改的.filter(Boolean), 删的);
      }
      return 写记录(key, value);
    }
    if (key === '分类字典' || key === '收藏字典') return 写位置(key, value);
    const 格 = /^(分类|收藏)\.(\d+)\.(\d+)$/.exec(key);
    if (格) {
      const 成员 = Array.isArray(value) ? value.map(String) : [];
      const 结果 = 成员.length ? io.writeJson(布局.路径(key), 成员) : io.removeFile(布局.路径(key));
      if (结果.ok) 位置缓存.delete(格[1]);
      return 结果;
    }
    if (key === '索引') return io.writeJson('index.json', value);
    return { ok: false, reason: `布局里没有这个键：${key}` };
  }

  function remove(key) {
    if (布局.表键.includes(key)) return io.removeFile(布局.路径(key));
    const 格 = /^(分类|收藏)\.(\d+)\.(\d+)$/.exec(key);
    if (格) return io.removeFile(布局.路径(key));
    return { ok: false, reason: `这个键不能单独删：${key}` };
  }

  function list(prefixText = '') {
    return 现有键().filter((k) => k.startsWith(prefixText));
  }

  function scan() {
    return { keys: 现有键(), temp: io.残留临时(), external: [] };
  }

  function status(key) {
    const r = read(key);
    const 冻结 = r.state === 'unreadable';
    return { key, state: r.state, reason: r.reason, frozen: 冻结 };
  }

  /** 数据变了之后丢掉缓存（外面改了文件时用）。 */
  function 忘记() {
    记录缓存.clear();
    位置缓存.clear();
    只读.clear();
  }

  return { read, set, remove, list, scan, status, 忘记 };
}

module.exports = { createLayoutPort, checkPort };
