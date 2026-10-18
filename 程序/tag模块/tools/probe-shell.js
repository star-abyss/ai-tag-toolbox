'use strict';
/*
 * 壳体一致性探针：核心转发出来的字段名 vs 门面动作读的字段名。
 * 对不上时读出来是 undefined，不报错。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { createCore } = require(path.join(ROOT, 'core.js'));
const { createFilePort } = require(path.join(ROOT, 'adapter-file.js'));

const DATA = path.join(ROOT, 'data');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-'));
fs.cpSync(DATA, dir, { recursive: true });
const core = createCore({ port: createFilePort({ root: dir }) });

let 坏 = 0;
const 看 = (名, 值, 期望字段) => {
  if (!值 || typeof 值 !== 'object') { console.log('  ? ' + 名 + ' → ' + JSON.stringify(值)); 坏++; return; }
  const 有 = Object.keys(值);
  const 缺 = 期望字段.filter((f) => !有.includes(f));
  if (值.ok !== true) { console.log('  · ' + 名 + ' → 失败(' + 值.reason + ')'); return; }
  if (缺.length) { console.log('  ✗ ' + 名 + ' 缺字段 ' + 缺.join(',') + '  实际有: ' + 有.join(',')); 坏++; }
  else console.log('  ✓ ' + 名 + ' → ' + 有.filter((f) => f !== 'ok').join(','));
};

// 先造点东西出来
const p = core.positions.createPage('收藏', { 页名: '壳体探针' });
const c = core.positions.createClass('收藏', p.页.ID, { 类名: '壳体类' });

console.log('core.positions 转发出来的字段（门面按这些名字读）：');
看('list(根)', core.positions.list('分类'), ['页列表']);
看('list(根,页)', core.positions.list('分类', 36), ['页']);
看('createPage', core.positions.createPage('收藏', { 页名: '又一个' }), ['页']);
看('createClass', core.positions.createClass('收藏', p.页.ID, { 类名: '又一个类' }), ['类']);
看('update(页)', core.positions.update('收藏', p.页.ID, { 页名: '改过的' }), ['页']);
看('update(类)', core.positions.update('收藏', c.类.ID, { 类名: '改过的类' }), ['类']);
看('remove(页)', core.positions.remove('收藏', p.页.ID), ['removed']);
看('members', { ok: true, data: core.positions.members('收藏', 1, 2) }, ['data']);
看('attach', core.positions.attach('收藏', p.页.ID, c.类.ID, 1), ['list']);
看('detach', core.positions.detach('收藏', p.页.ID, c.类.ID, 1), ['list']);
看('reorder', core.positions.reorder('收藏', p.页.ID, c.类.ID, [1]), ['list']);
看('whereIs', { ok: true, data: core.positions.whereIs('收藏', 1) }, ['data']);

console.log('\ncore 里其它动作的转发：');
看('get', { ok: true, data: core.get(1) }, ['data']);
const 新 = core.create({ 名称: 'shell_probe' });
看('create', 新, ['记录']);
看('edit', core.edit(1, { 名称: 'cg' }), ['记录']);
看('remove', core.remove(新.记录.ID), ['记录']);
看('hide', core.hide(2), ['record']);
看('unhide', core.unhide(2), ['record']);
看('restore', (() => { core.edit(2, { 名称: 'unity' }); return core.restore(2); })(), ['record']);

console.log('\n结论：' + (坏 ? '有 ' + 坏 + ' 处字段名对不上' : '字段名全对得上'));
fs.rmSync(dir, { recursive: true, force: true });
if (坏) process.exitCode = 1;
