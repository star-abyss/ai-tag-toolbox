'use strict';
/* 把每个动作的返回形状打出来，看有没有没统一成 {ok, data} 的。 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const { createTagModule } = require(path.join(ROOT, 'index.js'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shape-'));
fs.cpSync(path.join(ROOT, 'data'), dir, { recursive: true });
const tags = createTagModule({ data: dir });

const 参数 = {
  'query': { 串: 'miku' },
  'recognize': { 词: ['hatsune_miku'] },
  'record.get': { 标识: 1 },
  'record.batch': { 标识列表: [1, 2] },
  'record.create': { 名称: 'shape_probe' },
  'record.edit': { 标识: 1, 名称: 'CG', 中文名: '计算机生成的动画' },
  'record.delete': { 标识: 'u1' },
  'record.groups': {},
  'hidden.hide': { 标识: 3 },
  'hidden.unhide': { 标识: 3 },
  'hidden.list': {},
  'modified.list': {},
  'modified.restore': { 标识: 1 },
  'position.list': { 位置: '分类' },
  'position.createPage': { 位置: '收藏', 页名: '形状页' },
  'position.createClass': { 位置: '收藏', 页: 1, 类名: '形状类' },
  'position.update': { 位置: '分类', 标识: 1, 页名: '质量词' },
  'position.delete': { 位置: '收藏', 标识: 1 },
  'position.members': { 位置: '分类', 页: 1, 类: 1 },
  'position.attach': { 位置: '分类', 页: 1, 类: 1, 成员: 1 },
  'position.detach': { 位置: '分类', 页: 1, 类: 1, 成员: 1 },
  'position.reorder': { 位置: '分类', 页: 1, 类: 1, 标识列表: [1] },
  'position.whereIs': { 位置: '分类', 成员: 1 },
  'note.get': { 标识: 1 },
  'note.set': { 标识: 1, 文本: '探针' },
  'identity.adults': {},
  'identity.roles': {},
  'identity.isAdult': { 标识: 1 },
  'identity.isRole': { 标识: 1 },
  'identity.series': {},
  'identity.isSeries': { 标识: 1 },
  'status': {},
  'reload': {},
};

let 不齐 = 0;
for (const name of tags.actions) {
  const r = tags.run(name, 参数[name] || {});
  const 有data = Object.prototype.hasOwnProperty.call(r, 'data');
  const 齐 = r.ok === true ? 有data : typeof r.reason === 'string';
  if (!齐) 不齐 += 1;
  const 形状 = r.ok
    ? (有data ? `data:${Array.isArray(r.data) ? '数组' : r.data === null ? 'null' : typeof r.data}` : '❌ 缺 data')
    : `reason:${r.reason}`;
  process.stdout.write(`${齐 ? '  ✓' : '  ✗'} ${name.padEnd(22)} ${形状}${齐 ? '' : '   ← 形状不齐'}\n`);
}
process.stdout.write(`\n不齐的：${不齐} 个\n`);
fs.rmSync(dir, { recursive: true, force: true });
