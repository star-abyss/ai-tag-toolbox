'use strict';
/*
 * 逐项实测：36 个动作挨个走一遍**成功路径**，并验证该有的行为。
 * 在临时副本上跑。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { createTagModule } = require(path.join(ROOT, 'index.js'));

const DATA = path.join(ROOT, 'data');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'all-'));
fs.cpSync(DATA, dir, { recursive: true });
const tags = createTagModule({ data: dir });

let 通过 = 0, 失败 = 0;
const 坏 = [];
function 验(名, fn) {
  try { fn(); 通过++; console.log('  ✓ ' + 名); }
  catch (e) { 失败++; 坏.push(名 + ' → ' + e.message); console.log('  ✗ ' + 名 + '  → ' + e.message); }
}
const eq = (a, b, 说明) => { if (a !== b) throw new Error((说明 || '') + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a)); };
const ok = (r, 说明) => { if (!r || r.ok !== true) throw new Error((说明 || '') + ' 失败了：' + JSON.stringify(r)); };
const 名 = (id) => String(tags.run('record.get', { 标识: id }).data.名称).split(',')[0];
let 自建组数 = 0;

console.log('=== 36 个动作逐项实测（临时副本）===\n');

console.log('— 检索 —');
验('query：给串出候选，带档位与命中字段', () => {
  const r = tags.run('query', { 串: 'hatsune_miku' });
  ok(r);
  eq(r.data.候选[0].档, 1, '第一条该是精确命中');
  eq(String(r.data.候选[0].记录.名称).split(',')[0], 'hatsune_miku');
  eq(r.data.候选[0].命中, '名称');
  eq(r.data.合计, 12, '带上 "hatsune_miku_(xxx)" 那些变体');
  if (!r.data.候选[0].记录.中文名) throw new Error('没带记录');
});
验('query：上限参数真的生效', () => {
  eq(tags.run('query', { 串: 'miku', 上限: 5 }).data.候选.length, 5);
  eq(tags.run('query', { 串: 'miku' }).data.候选.length, 30);
});
验('recognize：一个词回一条，一批词回一批', () => {
  eq(tags.recognize('hatsune_miku'), '初音未来');
  eq(JSON.stringify(tags.recognize(['hatsune_miku', 'zzz没有'])), '["初音未来",null]');
});

console.log('\n— 记录 —');
验('record.get：取到整条，含成员', () => {
  const r = tags.run('record.get', { 标识: 9547 });
  ok(r); eq(r.data.名称.split(',')[0], 'kochiya_sanae');
  if (!Array.isArray(r.data.成员) || r.data.成员.length !== 11) throw new Error('成员不对');
  // 库里 ID 一律存字符串
  if (typeof r.data.成员[0] !== 'string') throw new Error('成员 ID 不是字符串');
});
验('record.batch：一次取多条，取不到的跳过', () => {
  const r = tags.run('record.batch', { 标识列表: [1, 9547, 99999999, 'u999'] });
  ok(r); eq(r.data.length, 2, '应当只回 2 条');
});
验('record.batch：给空数组不报错', () => { ok(tags.run('record.batch', { 标识列表: [] })); eq(tags.run('record.batch', {}).data.length, 0); });
验('record.create：ID 自动分配、带 u 前缀、立刻可查可认', () => {
  const r = tags.run('record.create', { 名称: 'probe_one', 中文名: '探针一号' });
  ok(r); eq(r.data.ID, 'u1');
  eq(tags.recognize('probe_one'), '探针一号');
  eq(tags.run('query', { 串: 'probe_one' }).data.合计, 1);
});
验('record.create：能给成员（建一个组）', () => {
  const r = tags.run('record.create', { 名称: 'my_group', 中文名: '我的组', 成员: [146, 665, 995] });
  ok(r); eq(r.data.成员.length, 3);
  // 库里的 ID 一律存字符串（自建的带 u，是字符串；数字 ID 也存成字符串，省得两处类型不一样）
  eq(typeof r.data.成员[0], 'string', '成员 ID 存成字符串');
  eq(JSON.stringify(tags.run('record.get', { 标识: r.data.ID }).data.成员), '["146","665","995"]');
  自建组数 = 1; // 给下面数组用
});
验('record.delete：自建的能删', () => {
  const r = tags.run('record.delete', { 标识: 'u2' });
  ok(r); eq(tags.run('record.get', { 标识: 'u2' }).ok, false);
  自建组数 -= 1; // u2 就是刚建的那个自建组
});
验('record.groups：列出全部组，带"是不是角色组 / 是不是系列组"', () => {
  const r = tags.run('record.groups');
  ok(r);
  // 作品退回 tag 之后（决定 120），带 `成员` 的只剩角色
  eq(r.data.length, 34115 + 自建组数, '原有 34115 + 自建里带成员的');
  eq(r.data.filter((x) => x.是角色组).length, 34115);
  eq(r.data.filter((x) => x.是系列组).length, 0, '没有组该被读成系列组');
  eq(r.data.filter((x) => x.成员.length === 0).length, 517);
});
验('record.edit：整条覆盖，原文自动进修改库', () => {
  const r = tags.run('record.edit', { 标识: 1, 名称: 'cg', 中文名: '改过的' });
  ok(r); eq(tags.run('record.get', { 标识: 1 }).data.中文名, '改过的');
  eq(tags.run('modified.list').data.length, 1, '修改库');
});

console.log('\n— 隐藏 / 修改 —');
验('hidden.hide / hidden.list', () => {
  ok(tags.run('hidden.hide', { 标识: 2 }));
  eq(tags.run('hidden.list').data.length, 1);
  eq(tags.run('record.get', { 标识: 2 }).ok, false, '隐藏后还取得到');
});
验('hidden.unhide：ID 不变地扔回来', () => {
  ok(tags.run('hidden.unhide', { 标识: 2 }));
  eq(tags.run('hidden.list').data.length, 0);
  eq(tags.run('record.get', { 标识: 2 }).ok, true);
});
验('modified.list / modified.restore', () => {
  eq(tags.run('modified.list').data.length, 1);
  ok(tags.run('modified.restore', { 标识: 1 }));
  eq(tags.run('record.get', { 标识: 1 }).data.中文名, '计算机生成的动画,提高图片质量');
  eq(tags.run('modified.list').data.length, 0);
});

console.log('\n— 位置：分类（原有数据）—');
验('position.list：不给页就列全部页', () => {
  const r = tags.run('position.list', { 位置: '分类' });
  ok(r); eq(r.data.length, 27);
});
验('position.list：给页就列它底下的类', () => {
  const r = tags.run('position.list', { 位置: '分类', 页: 36 });
  ok(r); eq(r.data.页名, '头发'); eq(r.data.类列表.length, 9);
});
验('position.list：页不存在给理由', () => {
  const r = tags.run('position.list', { 位置: '分类', 页: 99999 });
  eq(r.ok, false); if (!r.reason.includes('页不存在')) throw new Error(r.reason);
});
验('position.list：位置根写错了给理由', () => {
  const r = tags.run('position.list', { 位置: '乱写' });
  eq(r.ok, false);
});

console.log('\n— 位置：收藏（新建的）—');
const 页 = tags.positions('收藏').createPage({ 页名: '实测页' });
const 类 = tags.positions('收藏').createClass(页.ID, { 类名: '实测类' });
验('position.createPage：ID 由字典计数器分配', () => { if (!页 || !页.ID) throw new Error('建页失败'); eq(页.页名, '实测页'); });
验('position.createClass：挂在指定页底下', () => { if (!类 || !类.ID) throw new Error('建类失败'); eq(类.类名, '实测类'); });
验('position.update：改页名（键名不动）', () => {
  const r = tags.run('position.update', { 位置: '收藏', 标识: 页.ID, 页名: '改过的页名' });
  ok(r); eq(r.data.页名, '改过的页名');
  eq(tags.run('position.list', { 位置: '收藏' }).data[0].页名, '改过的页名');
  eq(tags.run('position.list', { 位置: '收藏' }).data[0].ID, 页.ID, 'ID 不该变');
});
验('position.update：改类名与配色', () => {
  const r = tags.run('position.update', { 位置: '收藏', 标识: 类.ID, 类名: '改过的类名', 配色: { background: '#123456', foreground: '#ffffff' } });
  ok(r); eq(r.data.类名, '改过的类名'); eq(r.data.配色.background, '#123456');
});
验('position.members：空类给空数组', () => { eq(JSON.stringify(tags.positions('收藏').members(页.ID, 类.ID)), '[]'); });
验('position.attach：摆进去，重复摆不重复加', () => {
  eq(JSON.stringify(tags.positions('收藏').attach(页.ID, 类.ID, 9547)), '["9547"]');
  eq(JSON.stringify(tags.positions('收藏').attach(页.ID, 类.ID, 9547)), '["9547"]', '重复摆了');
});
验('position.attach：指定位置序', () => {
  tags.positions('收藏').attach(页.ID, 类.ID, 9539);
  const r = tags.positions('收藏').attach(页.ID, 类.ID, 146, 0);
  eq(JSON.stringify(r), '["146","9547","9539"]');
});
验('position.detach：拿掉', () => {
  eq(JSON.stringify(tags.positions('收藏').detach(页.ID, 类.ID, 146)), '["9547","9539"]');
});
验('position.reorder：整格重排', () => {
  eq(JSON.stringify(tags.positions('收藏').reorder(页.ID, 类.ID, [9539, 9547])), '["9539","9547"]');
  eq(JSON.stringify(tags.positions('收藏').members(页.ID, 类.ID)), '["9539","9547"]');
});
验('position.whereIs：它在哪些类里', () => {
  const r = tags.positions('收藏').whereIs(9547);
  eq(r.length, 1); eq(r[0].页名, '改过的页名'); eq(r[0].类名, '改过的类名');
});
验('position.delete：删类（只删那个格）', () => {
  const r = tags.run('position.delete', { 位置: '收藏', 标识: 类.ID });
  ok(r); eq(r.data.removed, '类');
  eq(tags.run('position.list', { 位置: '收藏' }).data[0].类列表.length, 0);
});
验('position.delete：删页（带走它底下的类）', () => {
  const p2 = tags.positions('收藏').createPage({ 页名: '待删页' });
  const c2 = tags.positions('收藏').createClass(p2.ID, { 类名: '待删类' });
  const r = tags.run('position.delete', { 位置: '收藏', 标识: p2.ID });
  ok(r); eq(r.data.带走类, 1);
  const 剩 = tags.run('position.list', { 位置: '收藏' }).data;
  if (剩.some((x) => x.ID === p2.ID)) throw new Error('页还在');
  if (剩.some((x) => x.类列表.some((c) => c.ID === c2.ID))) throw new Error('类还在');
});

console.log('\n— 注释 —');
验('note.set / note.get：一条记录一条', () => {
  ok(tags.run('note.set', { 标识: 3, 文本: '第一条' }));
  ok(tags.run('note.set', { 标识: 3, 文本: '第二条' }));
  eq(tags.run('note.get', { 标识: 3 }).data, '第二条', '应该只有一条，后被覆盖');
});
验('note.set：空文本 = 删除', () => {
  ok(tags.run('note.set', { 标识: 3, 文本: '   ' }));
  eq(tags.run('note.get', { 标识: 3 }).data, null);
});
验('注释不参与检索', () => {
  tags.run('note.set', { 标识: 4, 文本: '独一无二的注释词xyzzy' });
  eq(tags.run('query', { 串: 'xyzzy' }).data.合计, 0);
  eq(tags.recognize('xyzzy'), null);
});

console.log('\n— 身份 —');
验('identity.adults：整张表列出来', () => {
  const r = tags.run('identity.adults');
  ok(r); eq(r.data.length, 693);
});
验('identity.roles / identity.series：两张表都列得出来', () => {
  const roles = tags.run('identity.roles');
  ok(roles); eq(roles.data.length, 34115);
  const series = tags.run('identity.series');
  ok(series); eq(series.data.length, 4049);
  const 角色集 = new Set(roles.data.map(String));
  eq(series.data.filter((id) => 角色集.has(String(id))).length, 0, '两张表撞车了');
});
验('identity.isAdult / isRole / isSeries：答"是不是"', () => {
  eq(tags.run('identity.isAdult', { 标识: tags.run('identity.adults').data[0] }).data, true);
  eq(tags.run('identity.isAdult', { 标识: 1 }).data, false);
  eq(tags.run('identity.isRole', { 标识: tags.run('identity.roles').data[0] }).data, true);
  eq(tags.run('identity.isRole', { 标识: 9547 }).data, true, '初音未来是角色，该在角色表里');
  eq(tags.run('identity.isSeries', { 标识: 9547 }).data, false, '角色不该在系列表里');
  eq(tags.run('identity.isSeries', { 标识: tags.run('identity.series').data[0] }).data, true);
});

console.log('\n— 体检 / 重读 —');
验('status：规模 / 野键 / 坏键 / 临时文件', () => {
  const r = tags.run('status');
  ok(r); eq(r.data.记录.主库, 52240); eq(r.data.野键.length, 0); eq(r.data.坏的键.length, 0);
  eq(r.data.写剩的临时文件.length, 0);
});
验('reload：重读之后一切照常', () => {
  ok(tags.run('reload'));
  eq(tags.run('record.get', { 标识: 9547 }).data.名称.split(',')[0], 'kochiya_sanae');
  if (tags.run('query', { 串: 'hatsune_miku' }).data.合计 < 1) throw new Error('reload 之后搜不出来');
});

console.log('\n— 动作表的通用规矩 —');
验('每个动作名都在 actions 里，describe 给得出参数', () => {
  eq(tags.actions.length, 39);
  for (const d of tags.describe()) if (!d.动作 || !d.摘要 || !Array.isArray(d.参数)) throw new Error(d.动作 + ' 说明不全');
});
验('不存在的动作给理由，不抛错', () => {
  const r = tags.run('不存在的动作');
  eq(r.ok, false); if (!r.reason.includes('没有这个动作')) throw new Error(r.reason);
});
验('出口冻住、不漏内部件', () => {
  if (!Object.isFrozen(tags)) throw new Error('没冻住');
  for (const k of ['store', 'library', 'search', 'core', 'port']) if (k in tags) throw new Error('漏了 ' + k);
});

console.log('\n— 收尾 —');
const s = tags.run('status').data;
console.log('  副本：主库 ' + s.记录.主库 + ' · 自建 ' + s.记录.自建库 + ' · 隐藏 ' + s.隐藏库 + ' · 修改 ' + s.修改库 + ' · 收藏页 ' + s.位置.收藏页 + ' · 野键 ' + s.野键.length);
const 真 = createTagModule({ data: DATA });
真.query('x');
const t = 真.run('status').data;
console.log('  真数据：主库 ' + t.记录.主库 + ' · 自建 ' + t.记录.自建库 + ' · 隐藏 ' + t.隐藏库 + ' · 修改 ' + t.修改库 + ' · 收藏页 ' + t.位置.收藏页);

console.log('\n通过 ' + 通过 + ' · 失败 ' + 失败);
if (失败) { console.log('\n失败项：'); 坏.forEach((x) => console.log('  ' + x)); process.exitCode = 1; }
fs.rmSync(dir, { recursive: true, force: true });
