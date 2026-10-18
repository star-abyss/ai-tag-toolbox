'use strict';
/*
 * 归一化 · 深拷贝 —— 一组纯函数。
 *
 * 不拥有状态，不读文件，不查表，不抛错，不判断分词。
 * 归一化：多种输入 → 一种比对键（小写 + 下划线）。
 */

/**
 * 文本 → 比对键：NFKC、小写、空白与连接号折成下划线，保留其余字符。
 * 任何输入都返回字符串；没有可用字符时返回 ''。
 * @param {unknown} value
 * @returns {string}
 */
function toKey(value) {
  if (value === null || value === undefined) return '';
  let text = String(value).normalize('NFKC');
  text = text.toLowerCase();

  let out = '';
  for (const ch of text) {
    if (/\s/u.test(ch) || /[-‐‑‒–—]/u.test(ch)) out += '_';
    else out += ch;
  }
  return out.replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * 文本 → 连写键：比对键再去掉全部分隔符。
 *
 *   fu hua       → fu_hua       → fuhua
 *   toe-spread   → toe_spread   → toespread
 *
 * @param {unknown} value
 * @returns {string}
 */
function toFlatKey(value) {
  return toKey(value).replace(/[_\s]+/g, '');
}

/**
 * 比对键是不是只剩结构符号、一个实词字符都没有。
 * @param {string} key 已经过 toKey 的比对键
 * @returns {boolean}
 */
function isSymbolOnlyKey(key) {
  return !/[\p{L}\p{N}]/u.test(String(key || ''));
}

/**
 * 按逗号切多值，去空白与空项。
 * @param {unknown} value
 * @returns {string[]}
 */
function splitValues(value) {
  if (value === null || value === undefined) return [];
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * 多值列表拼回逗号分隔的字符串；按比对键去重，保留先出现的写法。
 * @param {string[]} values
 * @returns {string}
 */
function joinValues(values) {
  const seen = new Set();
  const kept = [];
  for (const value of values || []) {
    const text = String(value == null ? '' : value).trim();
    if (!text) continue;
    const key = toKey(text);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(text);
  }
  return kept.join(',');
}

/** 取第一个值。 */
function firstValue(value) {
  const parts = splitValues(value);
  return parts.length ? parts[0] : '';
}

/**
 * 比对键按分隔符切开的各段（去重）。
 * @param {unknown} value
 * @returns {string[]}
 */
function keySegments(value) {
  const key = toKey(value);
  if (!key) return [];
  const seen = new Set();
  const out = [];
  for (const part of key.split('_')) {
    if (part && !seen.has(part)) { seen.add(part); out.push(part); }
  }
  return out;
}

/**
 * 深拷贝一份值：对象与数组逐层复制，其余原样返回。
 * @param {unknown} value
 * @returns {unknown}
 */
function deepCopy(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(deepCopy);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = deepCopy(item);
    return out;
  }
  return value;
}

module.exports = {
  toKey,
  toFlatKey,
  isSymbolOnlyKey,
  splitValues,
  joinValues,
  firstValue,
  keySegments,
  deepCopy,
};
