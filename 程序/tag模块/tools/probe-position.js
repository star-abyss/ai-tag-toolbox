'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { createTagModule } = require(path.join(ROOT, 'index.js'));
const tags = createTagModule({ data: path.join(ROOT, 'data') });
tags.query('x');

const 页列表 = tags.run('position.list', { 位置: '分类' }).data;
console.log('=== 分类字典：' + 页列表.length + ' 页 · 共 ' + 页列表.reduce((n, p) => n + p.类列表.length, 0) + ' 类 ===\n');
console.log('页ID  页名            类数   类名（前几个）');
for (const 页 of 页列表) {
  const 类名 = 页.类列表.map((c) => c.类名).join(' / ');
  console.log('  ' + String(页.ID).padStart(3) + '  ' + String(页.页名).padEnd(14) + String(页.类列表.length).padStart(4) + '   ' + (类名.length > 60 ? 类名.slice(0, 60) + '…' : 类名));
}

// 挑一个页，把它每个类的成员数列出来
const 样例 = 页列表.find((p) => p.页名 === '头发') || 页列表.find((p) => p.类列表.length > 1);
console.log('\n=== 拿一页展开：「' + 样例.页名 + '」（页ID ' + 样例.ID + '）===');
for (const 类 of 样例.类列表) {
  const 成员 = tags.run('position.members', { 位置: '分类', 页: 样例.ID, 类: 类.ID }).data;
  console.log('  类ID ' + String(类.ID).padStart(3) + '  ' + String(类.类名).padEnd(10) + ' 成员 ' + String(成员.length).padStart(5) + ' 个'
    + (成员.length ? '   前几个: ' + 成员.slice(0, 5).map((id) => String(tags.run('record.get', { 标识: id }).data.名称).split(',')[0]).join(', ') : ''));
}

// 磁盘上真的是"一格一个类"吗
function 数格(p) {
  let n = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    if (e.isDirectory()) n += 数格(f);
    else if (e.name !== '页.json' && e.name.endsWith('.json')) n++;
  }
  return n;
}
const 格数 = 数格(path.join(ROOT, 'data', '位置'));
console.log('\n=== 磁盘上：位置/<根>/<页ID>/<类ID>.json 一共 ' + 格数 + ' 个格 ===');
const 有成员的类 = 页列表.reduce((n, p) => n + p.类列表.length, 0);
console.log('   字典里登记 ' + 有成员的类 + ' 个类，磁盘上有 ' + 格数 + ' 个格');
console.log('   （差的那些是空类：字典里有、格还没建）');

// 收藏那边
const 收藏 = tags.run('position.list', { 位置: '收藏' }).data;
console.log('\n=== 收藏 ===');
console.log('   页数:', 收藏.length, '（源数据没有收藏数据，是空的）');
