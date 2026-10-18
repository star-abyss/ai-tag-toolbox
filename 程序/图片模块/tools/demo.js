'use strict';
/* 端到端演示：装配 → 三条真实路径 → 打印盘上结果。用完自己清干净。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createImageModule } = require('../index.js');

const 根 = path.join(__dirname, '.demo');
if (fs.existsSync(根)) fs.rmSync(根, { recursive: true, force: true });

const 回收站 = [];
const 图片 = createImageModule({
  根目录: 根,
  处理图片: (字节, 限长) => ({
    preview: { 字节: Buffer.concat([字节, Buffer.from('P')]), mime: 'image/png' },
    thumbnail: { 字节: Buffer.concat([字节, Buffer.from('T')]), mime: 'image/png' },
  }),
  交回收站: async (p) => { 回收站.push(p); },
  校验和: (b) => `sha256:${crypto.createHash('sha256').update(b).digest('hex')}`,
});

const 图 = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(32, n)]);

(async () => {
  console.log('=== ① 存三张，落到三个存放地 ===');
  const 会A = await 图片.存({ 作用域: { 存放地: 'session', 会话ID: 'A' }, 字节: 图(1), 文件名: '对话图.png', mime: 'image/png' });
  const 库图 = await 图片.存({ 作用域: { 存放地: 'gallery' }, 字节: 图(2), 文件名: '图库图.png', mime: 'image/png' });
  const 工图 = await 图片.存({ 作用域: { 存放地: 'vision' }, 字节: 图(3), 文件名: '识图图.png', mime: 'image/png' });
  console.log('  对话 A →', 会A.标识, '变体', Object.keys(会A.变体).join('/'));
  console.log('  图库   →', 库图.标识);
  console.log('  工作区 →', 工图.标识);

  console.log('\n=== ② 列：只读目录，不读副档 ===');
  const 过 = 图片.列({ 作用域: { 存放地: 'gallery' } });
  console.log('  图库', 过.总数, '条 →', JSON.stringify(过.条目[0]));

  console.log('\n=== ③ 图库 → 对话 A（复制，不是搬）===');
  const 取 = 图片.取内容({ 引用: 库图.引用 });
  await 图片.存({ 作用域: { 存放地: 'session', 会话ID: 'A' }, 字节: 取.字节, 文件名: 取.文件名, 来源: 'copy' });
  console.log('  对话 A 现在', 图片.列({ 作用域: { 存放地: 'session', 会话ID: 'A' } }).总数, '条；图库仍有', 图片.列({ 作用域: { 存放地: 'gallery' } }).总数, '条');

  console.log('\n=== ④ 识图换图：能力组只有 清空 ===');
  const 工作区 = 图片.工作区能力();
  console.log('  能力组 =', JSON.stringify(Object.keys(工作区)));
  await 工作区.清空();
  await 图片.存({ 作用域: { 存放地: 'vision' }, 字节: 图(4), 文件名: '换一张.png' });
  console.log('  换图之后工作区仍是', 图片.列({ 作用域: { 存放地: 'vision' } }).总数, '张');

  console.log('\n=== ⑤ 图库的表：收藏 + 分类（只装 ID）===');
  await 图片.表({ 表: '收藏', 动作: '加', 标识: 库图.标识 });
  const 类 = await 图片.表({ 表: '分类', 动作: '建类', 名: '人物' });
  const 类ID = Object.keys(await 图片.表({ 表: '分类', 动作: '读' }))[0];
  await 图片.表({ 表: '分类', 动作: '加成员', 类: 类ID, 标识: 库图.标识 });
  console.log('  收藏 =', JSON.stringify(await 图片.表({ 表: '收藏', 动作: '读' })));
  console.log('  分类 =', JSON.stringify(await 图片.表({ 表: '分类', 动作: '读' })));

  console.log('\n=== ⑥ 删对话但保留图片 ===');
  for (const 一条 of 图片.列({ 作用域: { 存放地: 'session', 会话ID: 'A' } }).条目) {
    const 字节 = 图片.取内容({ 引用: 一条.引用 }).字节;
    await 图片.存({ 作用域: { 存放地: 'gallery' }, 字节, 文件名: '保留下来的.png', 来源: 'copy' });
  }
  await 图片.清空({ 作用域: { 存放地: 'session', 会话ID: 'A' } });
  console.log('  对话 A 剩', 图片.列({ 作用域: { 存放地: 'session', 会话ID: 'A' } }).总数, '条；图库有', 图片.列({ 作用域: { 存放地: 'gallery' } }).总数, '条');
  console.log('  交回收站', 回收站.length, '次（整批一次）');

  console.log('\n=== 盘上长这样 ===');
  const 走 = (目录, 缩进) => {
    for (const 名 of fs.readdirSync(目录).sort()) {
      const 全 = path.join(目录, 名);
      const 是目录 = fs.statSync(全).isDirectory();
      console.log(`${缩进}${名}${是目录 ? '/' : ''}`);
      if (是目录) 走(全, `${缩进}  `);
    }
  };
  console.log(path.basename(根) + '/');
  走(根, '  ');

  fs.rmSync(根, { recursive: true, force: true });
})();
