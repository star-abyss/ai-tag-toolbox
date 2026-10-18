'use strict';
/*
 * 端到端实测：收藏 · 删除 · 隐藏 · 还原 · 注释，以及每一步之后"查库/认词"的效果。
 * 全程在**临时副本**上做，不碰真数据。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { createTagModule } = require(path.join(ROOT, 'index.js'));

const DATA = path.join(ROOT, 'data');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'));
fs.cpSync(DATA, dir, { recursive: true });

console.log('（在临时副本上跑：' + dir + '）\n');
const tags = createTagModule({ data: dir });

const 名 = (id) => { const r = tags.run('record.get', { 标识: id }); return r.ok ? String(r.data.名称).split(',')[0] : '（取不到）'; };
const 查得到 = (串) => tags.run('query', { 串 }).data.合计;
const 认 = (词) => tags.recognize(词);
const 找 = (串) => (tags.run('query', { 串, 上限: 5 }).data.候选[0] || {}).记录;

// ---------- 0. 现状 ----------
{
  const s = tags.run('status').data;
  console.log('【起点】主库 ' + s.记录.主库 + ' · 自建 ' + s.记录.自建库 + ' · 隐藏 ' + s.隐藏库 + ' · 修改 ' + s.修改库 + ' · 收藏页 ' + s.位置.收藏页);
  console.log('');
}

// ---------- 1. 收藏：新建页与类，把一个词摆进去 ----------
console.log('【一】收藏');
const 收藏 = tags.positions('收藏');
const 页 = 收藏.createPage({ 页名: '我的常用' });
if (!页 || !页.ID) { console.log('❌ 建页失败：', JSON.stringify(页)); process.exit(1); }
const 类 = 收藏.createClass(页.ID, { 类名: '角色' });
console.log('  建页「' + 页.页名 + '」ID=' + 页.ID + '，建类「' + 类.类名 + '」ID=' + 类.ID);
const 早苗 = 找('东风谷早苗').ID;
console.log('  把「东风谷早苗」(ID=' + 早苗 + ') 摆进去 →', JSON.stringify(收藏.attach(页.ID, 类.ID, 早苗)));
console.log('  再摆一个「初音未来」→', JSON.stringify(收藏.attach(页.ID, 类.ID, 找('hatsune_miku').ID)));
console.log('  这一类现在有：', 收藏.members(页.ID, 类.ID).map((id) => 名(id) + '(' + id + ')').join(', '));
console.log('  它在哪些类里：', JSON.stringify(收藏.whereIs(早苗)));
console.log('  收藏页数：', tags.run('position.list', { 位置: '收藏' }).data.length);
console.log('');

// ---------- 2. 注释：鼠标悬停读一次 ----------
console.log('【二】注释');
{
  const 文本 = '东风谷早苗 —— 守矢神社的巫女，绿发+青蛙发饰';
  console.log('  写注释 →', JSON.stringify(tags.run('note.set', { 标识: 早苗, 文本 })));
  console.log('  悬停读一次 note.get →', JSON.stringify(tags.run('note.get', { 标识: 早苗 }).data));
  console.log('  另一条没注释的 →', JSON.stringify(tags.run('note.get', { 标识: 1 }).data));
  console.log('  它参与检索吗：查库 "守矢神社" →', tags.run('query', { 串: '守矢神社' }).data.合计, '条（注释不参与检索）');
}
console.log('');

// ---------- 3. 隐藏：查库/认词/取一条 都该够不着 ----------
console.log('【三】隐藏「东风谷早苗」');
{
  const 隐前 = 查得到('东风谷早苗');
  console.log('  隐藏前：查库 ' + 隐前 + ' 条，认词 ' + JSON.stringify(认('东风谷早苗')) + '，取一条 ' + (tags.run('record.get', { 标识: 早苗 }).ok ? '拿得到' : '拿不到'));
  console.log('  hide →', JSON.stringify(tags.run('hidden.hide', { 标识: 早苗 })));
  const 隐后 = tags.run('query', { 串: '东风谷早苗' }).data;
  console.log('  隐藏后：查库 ' + 隐后.合计 + ' 条，认词 ' + JSON.stringify(认('东风谷早苗')) + '，取一条 ' + (tags.run('record.get', { 标识: 早苗 }).ok ? '拿得到 ❌' : '拿不到 ✅'));
  console.log('  隐藏库里：', tags.run('hidden.list').data.map((r) => String(r.名称).split(',')[0] + '(' + r.ID + ')').join(', '));
  console.log('  收藏里那个 ID 还在吗：', JSON.stringify(收藏.members(页.ID, 类.ID)));
  console.log('  注释还在吗：', JSON.stringify(tags.run('note.get', { 标识: 早苗 }).data));
}
console.log('');

// ---------- 4. 还原 ----------
console.log('【四】还原（扔回主库）');
{
  console.log('  unhide →', JSON.stringify(tags.run('hidden.unhide', { 标识: 早苗 })));
  console.log('  查库 ' + tags.run('query', { 串: '东风谷早苗' }).data.合计 + ' 条，第 ' + (tags.run('query', { 串: '东风谷早苗' }).data.候选[0] || {}).档 + ' 档，认词 ' + JSON.stringify(认('东风谷早苗')));
  console.log('  收藏里的位置自动复活：', 收藏.members(页.ID, 类.ID).map((id) => 名(id)).join(', '));
  console.log('  隐藏库：', tags.run('hidden.list').data.length, '条');
}
console.log('');

// ---------- 5. 修改 + 还原默认 ----------
console.log('【五】改一条原有的词 → 还原默认');
{
  const 改前 = tags.run('record.get', { 标识: 早苗 }).data;
  console.log('  改之前：名称 ' + 改前.名称 + ' · 中文名 ' + 改前.中文名);
  console.log('  edit →', JSON.stringify(tags.run('record.edit', { 标识: 早苗, 名称: 改前.名称, 中文名: '早苗酱,东风谷早苗' })));
  console.log('  改之后：中文名 ' + tags.run('record.get', { 标识: 早苗 }).data.中文名);
  console.log('  认词 "kochiya_sanae" →', JSON.stringify(认('kochiya_sanae')), '（中文名变了，认词跟着变）');
  console.log('  查库 "早苗酱" →', tags.run('query', { 串: '早苗酱' }).data.合计, '条');
  console.log('  修改库里：', tags.run('modified.list').data.map((r) => String(r.名称).split(',')[0] + ' 原文中文名=' + r.中文名).join(', '));
  console.log('  restore →', JSON.stringify(tags.run('modified.restore', { 标识: 早苗 })));
  console.log('  还原后：中文名 ' + tags.run('record.get', { 标识: 早苗 }).data.中文名 + ' · 认词 → ' + JSON.stringify(认('kochiya_sanae')));
  console.log('  修改库：', tags.run('modified.list').data.length, '条');
}
console.log('');

// ---------- 6. 删除：自建能删，原有的不能 ----------
console.log('【六】删除');
{
  const 自建 = tags.run('record.create', { 名称: 'my_test_oc', 中文名: '我的测试角色' }).data;  console.log('  新建一条自建：ID=' + 自建.ID + ' 「' + 自建.名称 + '」');
  console.log('  建完就能查：查库 ' + 查得到('my_test_oc') + ' 条，认词 ' + JSON.stringify(认('my_test_oc')));
  收藏.attach(页.ID, 类.ID, 自建.ID);
  console.log('  也摆进收藏：', 收藏.members(页.ID, 类.ID).map((id) => 名(id) + '(' + id + ')').join(', '));
  console.log('  删一个**原有**的词 →', JSON.stringify(tags.run('record.delete', { 标识: 早苗 })));
  console.log('  删**自建**的 →', JSON.stringify(tags.run('record.delete', { 标识: 自建.ID })));
  console.log('  删完：查库 ' + 查得到('my_test_oc') + ' 条，取一条 ' + (tags.run('record.get', { 标识: 自建.ID }).ok ? '拿得到 ❌' : '拿不到 ✅'));
  console.log('  收藏里那个 ID 还留着（悬空，渲染时跳过）：', JSON.stringify(收藏.members(页.ID, 类.ID)));
  console.log('  拿它去渲染会怎样：', 收藏.members(页.ID, 类.ID).map((id) => {
    const r = tags.run('record.get', { 标识: id });
    return r.ok ? String(r.data.名称).split(',')[0] : '⌈跳过 ID ' + id + '⌋';
  }).join(' | '));
}
console.log('');

// ---------- 7. 收尾：状态与真数据是否被动过 ----------
{
  const s = tags.run('status').data;
  console.log('【收尾】副本上：主库 ' + s.记录.主库 + ' · 自建 ' + s.记录.自建库 + ' · 隐藏 ' + s.隐藏库 + ' · 修改 ' + s.修改库 + ' · 野键 ' + s.野键.length + ' · 坏键 ' + s.坏的键.length);
  const 真 = createTagModule({ data: DATA });
  真.query('x');
  const t = 真.run('status').data;
  console.log('        真数据：主库 ' + t.记录.主库 + ' · 自建 ' + t.记录.自建库 + ' · 隐藏 ' + t.隐藏库 + ' · 修改 ' + t.修改库 + ' · 收藏页 ' + t.位置.收藏页);
}
fs.rmSync(dir, { recursive: true, force: true });
