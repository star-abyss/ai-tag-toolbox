'use strict';
/*
 * 世界书模块 · 世界书。纯函数：不碰盘、不碰状态。
 *
 * 一份世界书：
 *   { name, entries: [ { id, label, text, always, keys, enabled, 落点, 深度?, 角色? } ] }
 *
 * 条目字段：
 *   id       世界书内唯一，由程序发
 *   label    显示名
 *   text     正文
 *   always   恒常：为真时每次参与，keys 不看；为假且 keys 为空时不参与
 *   keys     启用条件：一组关键词；没有恒常时，命中任一项即参与
 *   enabled  假则不参与
 *   落点     这条投进哪个槽，八种：前 / 后 / 顶部 / 底部 / 按深度 / 扩展顶部 / 扩展底部 / 出口
 *   深度     落点是 按深度 时才有：距对话末尾第几条
 *   角色     落点是 按深度 时才有：系统 / 用户 / 助手
 *
 * 读条目时两套字段名都认：我们自己的，以及酒馆的（position / depth / role）。
 *
 * 交出去的一条命中：{ 文本, 落点, 深度?, 角色? }。
 */

/** 条目 id 的字母前缀。 */
const 号前缀 = 'e';

/** 落点：中文名 → 酒馆的 position 数字。 */
const 落点名 = {
  前: 0,
  后: 1,
  顶部: 2,
  底部: 3,
  按深度: 4,
  扩展顶部: 5,
  扩展底部: 6,
  出口: 7,
};

/** 落点：酒馆的 position 数字 → 中文名。 */
const 落点号 = {
  0: '前',
  1: '后',
  2: '顶部',
  3: '底部',
  4: '按深度',
  5: '扩展顶部',
  6: '扩展底部',
  7: '出口',
};

/** 角色：中文名 → 酒馆的 role。 */
const 角色名 = { 系统: 'system', 用户: 'user', 助手: 'assistant' };

/** 角色：酒馆的 role → 中文名。 */
const 角色号 = { system: '系统', user: '用户', assistant: '助手' };

/** 没给落点时按这个算。 */
const 默认落点 = '前';

/** 落点是 按深度 时的缺省值。 */
const 默认深度 = 4;
const 默认角色 = '系统';

/** 深拷贝一份值。 */
function 拷贝(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(拷贝);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = 拷贝(item);
    return out;
  }
  return value;
}

const 文本 = (value) => (value == null ? '' : String(value));

/** 把正文里的回车换行收成换行。 */
const 正则正文 = (value) => 文本(value).replace(/\r\n/g, '\n');

/** 关键词列表归一化：字符串按逗号切，逐项 trim，去空去重，保序。 */
function 归一关键词(value) {
  let 原 = [];
  if (Array.isArray(value)) 原 = value;
  else if (typeof value === 'string') 原 = value.split(/[,，、;；\n]+/);
  else if (value == null) 原 = [];
  const 出 = [];
  for (const 一项 of 原) {
    const 词 = 文本(一项).trim();
    if (词 && !出.includes(词)) 出.push(词);
  }
  return 出;
}

/**
 * 落点归一化：认识中文名、也认识酒馆的数字；不认识的一律按缺省。
 * @returns {string} 落点中文名
 */
function 归一落点(value) {
  const 名 = 文本(value).trim();
  if (Object.prototype.hasOwnProperty.call(落点名, 名)) return 名;
  if (Object.prototype.hasOwnProperty.call(落点号, 名)) return 落点号[名];
  return 默认落点;
}

/** 角色归一化：认识中文名、也认识酒馆的英文名。 */
function 归一角色(value) {
  const 名 = 文本(value).trim();
  if (Object.prototype.hasOwnProperty.call(角色名, 名)) return 名;
  if (Object.prototype.hasOwnProperty.call(角色号, 名)) return 角色号[名];
  return 默认角色;
}

/** 深度归一化：认非负整数，其余按缺省。 */
function 归一深度(value) {
  const 数 = Number(value);
  if (!Number.isInteger(数) || 数 < 0) return 默认深度;
  return 数;
}

/** 发一个条目号：从 e<起点> 起顺着找第一个没被 占用 的号；占用 Set 由调用方拿着。 */
function 发号(占用, 起点 = 1) {
  let n = Number.isInteger(起点) && 起点 > 0 ? 起点 : 1;
  while (占用.has(`${号前缀}${n}`)) n += 1;
  占用.add(`${号前缀}${n}`);
  return `${号前缀}${n}`;
}

/** 取源对象里先出现的那个键的值。都没有就给 undefined。 */
function 取(源, 键们) {
  for (const 键 of 键们) {
    if (源[键] !== undefined && 源[键] !== null) return 源[键];
  }
  return undefined;
}

/**
 * 归一一条。
 * @param {object} raw 来源条目，字段名可以是我们的、也可以是酒馆的
 * @param {Set<string>} 占用 这本书已经用掉的号
 */
function 归一条(raw, 占用) {
  const 源 = raw && typeof raw === 'object' ? raw : {};

  // 显式恒常值决定启用方式；省略时按条件是否为空确定。
  const 源恒常 = 取(源, ['always', 'constant']);
  const 有源条件 = 取(源, ['keys', 'key']) !== undefined;
  const keys = 有源条件 ? 归一关键词(取(源, ['keys', 'key'])) : [];
  const always = 源恒常 === true ? true : 源恒常 === false ? false : 有源条件 ? keys.length === 0 : true;

  // id 有就用它，没有才现发一个（发出来的不跟已有的撞）。
  const 已有 = 文本(源.id).trim();
  const id = 已有 && !占用.has(已有) ? 已有 : 发号(占用, 1);
  占用.add(id);

  const 落点 = 归一落点(取(源, ['落点', 'position']));
  const 一条 = {
    id,
    label: 文本(取(源, ['label', 'comment'])),
    text: 正则正文(取(源, ['text', 'content'])),
    always,
    keys,
    enabled: 取(源, ['enabled']) === undefined ? 取(源, ['disable']) !== true : 取(源, ['enabled']) !== false,
    落点,
  };
  if (落点 === '按深度') {
    一条.深度 = 归一深度(取(源, ['深度', 'depth']));
    一条.角色 = 归一角色(取(源, ['角色', 'role']));
  }
  return 一条;
}

/** 一份世界书里已经占用的条目号。 */
function 占用号(entries) {
  return new Set((Array.isArray(entries) ? entries : []).map((x) => 文本(x && x.id)).filter(Boolean));
}

/** 世界书的名字：顶层 name → originalData.name → 缺省"未命名世界书"。 */
function 取名字(raw) {
  const 源 = raw && typeof raw === 'object' ? raw : {};
  const 原 = 源.originalData && typeof 源.originalData === 'object' ? 源.originalData : {};
  return 文本(源.name).trim() || 文本(原.name).trim() || '未命名世界书';
}

/**
 * 把来源里的条目列成数组。entries 是对象（uid → 条目）时按 key 的先后排。
 * @returns {object[]|null} 既不是数组也不是对象就给 null
 */
function 条目列(raw) {
  const 源 = raw && typeof raw === 'object' ? raw : {};
  const entries = 源.entries;
  if (Array.isArray(entries)) return entries;
  if (entries && typeof entries === 'object') return Object.keys(entries).map((k) => entries[k]);
  return null;
}

/**
 * 把一份（已解析的）世界书归一成我们的形状。
 * 条目自己带 id 就用它；没带的按顺序现发。
 * @returns {object|null} 没有条目列就给 null
 */
function 归一(源) {
  const 列 = 条目列(源);
  if (列 === null) return null;
  const 占用 = new Set();
  return { name: 取名字(源), entries: 列.map((一条) => 归一条(一条, 占用)) };
}

/** 一条条目这次参不参与。 */
function 参与(条目, 文本_) {
  if (条目.enabled !== true) return false;
  if (!文本(条目.text).trim()) return false;
  if (条目.always === true) return true;
  const keys = Array.isArray(条目.keys) ? 条目.keys : [];
  if (!keys.length) return false;
  const 海 = 文本(文本_).toLowerCase();
  for (const 词 of keys) {
    if (海.includes(文本(词).toLowerCase())) return true;
  }
  return false;
}

/** 这次命中的条目（副本，顺序就是数组顺序）。 */
function 挑(世界书, 文本_) {
  const 列表 = Array.isArray(世界书 && 世界书.entries) ? 世界书.entries : [];
  return 列表.filter((一条) => 参与(一条, 文本_)).map((一条) => {
    const 出 = { 文本: 文本(一条.text), 落点: 一条.落点 };
    if (一条.落点 === '按深度') {
      出.深度 = 一条.深度;
      出.角色 = 一条.角色;
    }
    return 出;
  });
}

module.exports = {
  拷贝,
  文本,
  归一关键词,
  归一落点,
  归一角色,
  归一深度,
  归一条,
  归一,
  占用号,
  取名字,
  挑,
  默认深度,
  默认角色,
};
