'use strict';
/*
 * 把图库里的条目全删掉。
 *
 * 用法：node tools/清实测图.js [图片模块根目录]
 *   不给根目录就用 `工具箱数据/图片`（相对项目根）。
 * 删之前先把条目列出来，删完再列一次。
 */

const path = require('node:path');
const { createRequire } = require('node:module');

const 这里 = __dirname;
const 项目根 = path.resolve(这里, '..', '..');
const 要 = createRequire(path.join(项目根, '对接层', 'x.js'));

const { createImageModule } = 要(path.join(项目根, '图片模块', 'index.js'));

const 根目录 = process.argv[2] ? path.resolve(process.argv[2]) : path.join(项目根, '工具箱数据', '图片');
const 图片 = createImageModule({ 根目录 });
const 作用域 = { 存放地: 'gallery' };

const 列 = 图片.run('列', { 作用域 });
if (!列 || !列.ok) {
  console.error('列不出来：', JSON.stringify(列));
  process.exit(1);
}

const 条目们 = 列.data.条目 || [];
console.log(`图库：${根目录}`);
console.log(`条目：${列.data.总数} 个`);

let 删了 = 0;
for (const 一 of 条目们) {
  const 回 = 图片.run('删', { 引用: 一.引用 });
  if (回 && 回.ok) {
    删了 += 1;
  } else {
    console.log(`  删不掉 ${一.标识}：${(回 && 回.reason) || '没给理由'}`);
  }
}

const 再列 = 图片.run('列', { 作用域 });
console.log(`删了 ${删了} 个；剩下 ${再列 && 再列.ok ? 再列.data.总数 : '（列不出来）'} 个`);
