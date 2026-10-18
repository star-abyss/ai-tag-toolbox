'use strict';
/*
 * 布局 —— 逻辑键与盘上路径的对应关系。
 *
 *   记录/主库/000.jsonl        每片 1000 条，一行一条
 *   记录/主库/001.jsonl
 *   记录/自建库.jsonl  隐藏库.jsonl  修改库.jsonl
 *   位置/分类/<页ID>/页.json    页名、配色、类列表
 *   位置/分类/<页ID>/<类ID>.json  [成员 ID]
 *   表/成人.json  角色.json  系列.json  注释.json  常用词.json
 *   index.json
 *
 * 键的样子：
 *   主库 自建库 隐藏库 修改库     → 一个逻辑键 = 一个目录或一个文件
 *   成人 角色 系列 注释 常用词    → 表/ 下的一个文件
 *   分类字典 收藏字典             → 位置/ 下的一棵树
 *   分类.7.9 收藏.1.2              → 一个类格
 */

/** 记录上的字段顺序。 */
const 记录字段序 = ['ID', '名称', '中文名', '成员', '成人', '回显'];

const 记录键 = ['主库', '自建库', '隐藏库', '修改库'];
const 表键 = ['成人', '角色', '系列', '注释', '常用词'];
const 根 = ['分类', '收藏'];

/** 记录 → 一行紧凑 JSON，字段顺序固定。 */
function 记录行(记录) {
  const 干净 = {};
  for (const k of 记录字段序) if (记录[k] !== undefined) 干净[k] = 记录[k];
  for (const k of Object.keys(记录)) if (!(k in 干净)) 干净[k] = 记录[k];
  return JSON.stringify(干净);
}

function createLayout(分片 = 1000) {
  const 片号 = (id) => Math.floor(Number(id) / 分片);
  const 片名 = (n) => String(n).padStart(3, '0');

  /** 逻辑键 → 盘上路径。返回 null 表示不是布局里的键。 */
  function 路径(key, 上下文) {
    if (key === '索引') return 'index.json';
    if (表键.includes(key)) return `表/${key}.json`;
    if (记录键.includes(key)) {
      if (key === '主库') return '记录/主库';
      return `记录/${key}.jsonl`;
    }
    if (key === '分类字典') return '位置/分类';
    if (key === '收藏字典') return '位置/收藏';
    const 格 = /^(分类|收藏)\.(\d+)\.(\d+)$/.exec(key);
    if (格) return `位置/${格[1]}/${格[2]}/${格[3]}.json`;
    // 页级：分类.<页ID>
    const 页 = /^(分类|收藏)\.(\d+)$/.exec(key);
    if (页) return `位置/${页[1]}/${页[2]}`;
    // 单片：主库.<片号>
    const 片 = /^(主库)\.(\d+)$/.exec(key);
    if (片) return `记录/主库/${片名(Number(片[2]))}.jsonl`;
    return null;
  }

  /** 这个键在布局里吗。 */
  function 是布局键(key) {
    return 路径(key) !== null;
  }

  /** 一个页目录里的类 ID 列表。 */
  function 类们(io, 根名, 页ID) {
    const { files } = io.listDir(`位置/${根名}/${页ID}`);
    return files.filter((f) => f.endsWith('.json') && f !== '页.json')
      .map((f) => f.slice(0, -'.json'.length))
      .filter((s) => /^\d+$/.test(s));
  }

  /** 页 ID 列表。 */
  function 页们(io, 根名) {
    return io.listDir(`位置/${根名}`).dirs.filter((s) => /^\d+$/.test(s));
  }

  return { 分片, 片号, 片名, 路径, 是布局键, 类们, 页们, 记录行, 记录键, 表键, 根 };
}

module.exports = { createLayout, 记录行 };
