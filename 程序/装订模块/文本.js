'use strict';

const 半角 = { '，': ',', '；': ';', '｜': '|', '（': '(', '）': ')', '［': '[', '］': ']', '｛': '{', '｝': '}' };
const 开 = { '(': ')', '[': ']', '{': '}', '<': '>' };
const 闭 = { ')': '(', ']': '[', '}': '{', '>': '<' };
const 分隔 = new Set([',', '、', ';', '|', '\r', '\n']);
const 实词 = /[a-z0-9\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/i;
const 语法文 = value => value.replace(/[，；｜（）［］｛｝]/g, char => 半角[char]);

function 字面位置(text) {
  const positions = new Set();
  for (let i = 0; i < text.length; i++) if (text[i] === '\\') { positions.add(i + 1); i++; }
  return positions;
}

/** 单元内的词范围，坐标相对于去掉外围空白的原始片段。 */
function 剥壳范围(raw) {
  const text = 语法文(raw), escaped = 字面位置(text);
  let head = 0;
  while (head < text.length && 开[text[head]] && !escaped.has(head)) head++;
  const trimRange = (start, end) => {
    const value = text.slice(start, end);
    return [start + value.length - value.trimStart().length, end - (value.length - value.trimEnd().length)];
  };
  const weighted = (start, end) => {
    const match = /:([0-9]+(\.[0-9]+)?)$/.exec(text.slice(start, end));
    return trimRange(start, match ? start + match.index : end);
  };
  if (head) {
    const closing = 开[text[0]];
    const pattern = closing === ')' || closing === ']'
      ? new RegExp('^([^()\\[\\]{}<>]*)((?:\\' + closing + '[0-9]*(?:\\.[0-9]+)?)+)$')
      : new RegExp('^([^()\\[\\]{}<>]*)((?:\\' + closing + ')+)$');
    const match = pattern.exec(text.slice(head));
    if (match && head === match[2].length && [...text.slice(0, head)].every((char, index) => 开[char] === match[2][match[2].length - index - 1])) {
      if ((closing === '>' || closing === '}') && /:[0-9]/.test(match[1])) return [0, raw.length];
      const [start, end] = weighted(...trimRange(head, head + match[1].length));
      if (实词.test(text.slice(start, end))) return [start, end];
    }
  }
  const range = weighted(0, raw.length);
  return 实词.test(text.slice(...range)) ? range : [0, raw.length];
}

/** 原文 → 带 UTF-16 原始范围的单元；分隔符和外围空白留在原文。 */
function 切分(value) {
  const text = value == null ? '' : String(value), syntax = 语法文(text);
  const escaped = 字面位置(syntax), parts = [], stack = [];
  let start = 0, degraded = false;
  for (let i = 0; i < syntax.length; i++) {
    if (escaped.has(i)) continue;
    const char = syntax[i];
    if (开[char]) stack.push(char);
    else if (闭[char]) {
      if (stack.pop() !== 闭[char]) { degraded = true; break; }
    } else if (!stack.length && 分隔.has(char)) {
      parts.push([start, i]);
      if (char === '\r' && syntax[i + 1] === '\n') i++;
      start = i + 1;
    }
  }
  degraded ||= stack.length > 0;
  if (degraded) { parts.length = 0; parts.push([0, text.length]); }
  else parts.push([start, text.length]);
  const units = parts.map(([from, to], index) => {
    const part = text.slice(from, to), raw = part.trim();
    const begin = from + part.length - part.trimStart().length;
    const [wordStart, wordEnd] = degraded ? [0, raw.length] : 剥壳范围(raw);
    return {
      标识: `u${index + 1}`, 前: raw.slice(0, wordStart), 词: raw.slice(wordStart, wordEnd), 后: raw.slice(wordEnd),
      原文范围: [begin, begin + raw.length], 词范围: [begin + wordStart, begin + wordEnd],
    };
  });
  return { 文本: text, 单元: units, 退化: degraded };
}

/** 单元表替换原始词范围，生成最终文本及对应范围。 */
function 拼装(source, rows) {
  let output = '', cursor = 0;
  const table = rows.map(row => {
    const [start, end] = row.原文范围;
    output += source.slice(cursor, start);
    const targetStart = output.length;
    output += source.slice(start, row.词范围[0]) + (row.译文 ?? row.词) + source.slice(row.词范围[1], end);
    cursor = end;
    return { ...row, 原文范围: [...row.原文范围], 词范围: [...row.词范围], 译文范围: [targetStart, output.length] };
  });
  output += source.slice(cursor);
  return { 译文: output, 表: table };
}

function 猜方向(value) {
  const text = String(value || '');
  return (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length > (text.match(/[a-z]/gi) || []).length ? 'zh-en' : 'en-zh';
}

function 需翻译(word, direction) {
  return direction === 'zh-en' ? /[\u3400-\u9fff\uf900-\ufaff]/.test(word) : /[a-z]/i.test(word);
}

module.exports = Object.freeze({ 切分, 拼装, 猜方向, 需翻译 });
