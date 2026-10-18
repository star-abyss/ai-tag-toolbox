'use strict';
/*
 * 实测验收 —— 按用户真实操作顺序走一遍，每一步断言结果。
 *
 *   node tools/验收.js
 *
 * 与 test/run.js 的区别：
 *   test/run.js   一条判据测一个不变量，互不相关
 *   本文件        一条工作流连着做完，模拟用户从上传到删除的完整过程
 *
 * 跑完不清理数据目录，并把盘上形状打印出来。
 * 数据落在 tools/.验收/ 下，下次跑之前先删。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createImageModule } = require('../index.js');

const 根 = path.join(__dirname, '.验收');
const 步骤 = [];
let 序号 = 0;

function 走(说明, 做) { 步骤.push({ 说明, 做 }); }

function 应当(条件, 话) {
  if (!条件) throw new Error(话 || '断言不成立');
}
function 相等(实际, 期望, 话) {
  if (实际 !== 期望) throw new Error(`${话 || '不相等'}：实际 ${JSON.stringify(实际)}，期望 ${JSON.stringify(期望)}`);
}
function 同构(实际, 期望, 话) {
  const a = JSON.stringify(实际);
  const b = JSON.stringify(期望);
  if (a !== b) throw new Error(`${话 || '不等'}：实际 ${a}，期望 ${b}`);
}

/** 一张假 PNG：文件头 + 填充。 */
const 图 = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(48, n)]);

// ---------------------------------------------------------------- 工作流

走('用户上传三张图到对话 A', async (ctx) => {
  const { 图库, 回收站 } = ctx;
  void 回收站;
  ctx.甲 = await 图库.存({ 作用域: { 存放地: 'session', 会话ID: 'A' }, 字节: 图(1), 文件名: '甲.png', mime: 'image/png', 来源: 'upload' });
  ctx.乙 = await 图库.存({ 作用域: { 存放地: 'session', 会话ID: 'A' }, 字节: 图(2), 文件名: '乙.png', mime: 'image/png', 来源: 'upload' });
  ctx.丙 = await 图库.存({ 作用域: { 存放地: 'session', 会话ID: 'A' }, 字节: 图(3), 文件名: '丙.png', mime: 'image/png', 来源: 'upload' });
  应当(ctx.甲 && ctx.乙 && ctx.丙, '三张都该存进去');
  const 过 = 图库.列({ 作用域: { 存放地: 'session', 会话ID: 'A' } });
  相等(过.总数, 3, '对话 A 里该有 3 张');
  应当(ctx.甲.标识.startsWith('img_'), '标识该是 img_ 开头');
  应当(ctx.甲.显示名 === '甲.png', '没给显示名时取文件名');
});

走('对话 A 的图不该出现在对话 B 里（作用域隔离）', async (ctx) => {
  相等(ctx.图库.列({ 作用域: { 存放地: 'session', 会话ID: 'B' } }).总数, 0, 'B 该是空的');
  相等(ctx.图库.列({ 作用域: { 存放地: 'gallery' } }).总数, 0, '图库该是空的');
  相等(ctx.图库.列({ 作用域: { 存放地: 'vision' } }).总数, 0, '工作区该是空的');
});

走('用户把对话 A 里的"甲"保存到图库（复制，原图还在对话里）', async (ctx) => {
  const 取 = ctx.图库.取内容({ 引用: ctx.甲.引用 });
  应当(取, '该取得到内容');
  ctx.图库里的甲 = await ctx.图库.存({
    作用域: { 存放地: 'gallery' },
    字节: 取.字节, 文件名: 取.文件名, mime: 取.mime, 来源: 'copy', 显示名: '甲（存图库）',
  });
  相等(ctx.图库.列({ 作用域: { 存放地: 'session', 会话ID: 'A' } }).总数, 3, '对话里那张还在');
  相等(ctx.图库.列({ 作用域: { 存放地: 'gallery' } }).总数, 1, '图库里多了一张');
  应当(ctx.图库里的甲.标识 !== ctx.甲.标识, '图库里那个是新的标识');
  应当(Buffer.compare(取.字节, 图(1)) === 0, '复制过来的字节该一模一样');
});

走('用户在图库里改了显示名', async (ctx) => {
  const 改 = await ctx.图库.改({ 引用: ctx.图库里的甲.引用, 显示名: '我的第一张图' });
  相等(改.显示名, '我的第一张图', '显示名该改掉');
  相等(改.文件名, '甲.png', '文件名不该动');
  const 详情 = ctx.图库.取详情({ 引用: ctx.图库里的甲.引用 });
  相等(详情.显示名, '我的第一张图', '再读回来还是新名字');
});

走('用户把图库那张发回对话 B（复制，图库那份留着）', async (ctx) => {
  const 取 = ctx.图库.取内容({ 引用: ctx.图库里的甲.引用 });
  ctx.对话B的甲 = await ctx.图库.存({ 作用域: { 存放地: 'session', 会话ID: 'B' }, 字节: 取.字节, 文件名: 取.文件名, 来源: 'copy' });
  相等(ctx.图库.列({ 作用域: { 存放地: 'gallery' } }).总数, 1, '图库那份还在');
  相等(ctx.图库.列({ 作用域: { 存放地: 'session', 会话ID: 'B' } }).总数, 1, '对话 B 里有了');
  // 删掉对话 B，图库那份不该受影响
  await ctx.图库.清空({ 作用域: { 存放地: 'session', 会话ID: 'B' } });
  相等(ctx.图库.列({ 作用域: { 存放地: 'gallery' } }).总数, 1, '删对话 B 之后图库那份仍在');
});

走('用户给图库那张加收藏、建分类并放进去', async (ctx) => {
  const 加 = await ctx.图库.表({ 表: '收藏', 动作: '加', 标识: ctx.图库里的甲.标识 });
  同构(加, [ctx.图库里的甲.标识], '收藏里该有它');
  const 类 = await ctx.图库.表({ 表: '分类', 动作: '建类', 名: '人物' });
  相等(类.名, '人物', '该建出这个类');
  const 字典 = await ctx.图库.表({ 表: '分类', 动作: '读' });
  const 类ID = Object.keys(字典)[0];
  const 放 = await ctx.图库.表({ 表: '分类', 动作: '加成员', 类: 类ID, 标识: ctx.图库里的甲.标识 });
  相等(放.成员.length, 1, '类里该有一个成员');
  ctx.类ID = 类ID;

});

走('用户拿图库那张去识图（复制进工作区，图库不受影响）', async (ctx) => {
  const 能力 = ctx.图库.工作区能力();
  const 取 = ctx.图库.取内容({ 引用: ctx.图库里的甲.引用 });
  ctx.工作区那张 = await ctx.图库.存({ 作用域: { 存放地: 'vision' }, 字节: 取.字节, 文件名: 取.文件名, 来源: 'vision-input' });
  相等(ctx.图库.列({ 作用域: { 存放地: 'vision' } }).总数, 1, '工作区里该有 1 张');
  相等(ctx.图库.列({ 作用域: { 存放地: 'gallery' } }).总数, 1, '图库不受影响');
  // 识图只认那个文件夹，它不拿引用、不拿地址
  const 工作区目录 = path.join(根, 'vision');
  const 条目们 = fs.readdirSync(工作区目录);
  相等(条目们.length, 1, '工作区目录下只有一个条目目录');
  const 文件们 = fs.readdirSync(path.join(工作区目录, 条目们[0])).sort();
  应当(文件们.includes('original.png'), '那个文件夹里该有原图');
  void 能力;
});

走('用户换一张去识图（清空工作区，再放新的）', async (ctx) => {
  const 能力 = ctx.图库.工作区能力();
  await 能力.清空();
  相等(ctx.图库.列({ 作用域: { 存放地: 'vision' } }).总数, 0, '清空之后是 0 张');
  await ctx.图库.存({ 作用域: { 存放地: 'vision' }, 字节: 图(9), 文件名: '换一张.png' });
  相等(ctx.图库.列({ 作用域: { 存放地: 'vision' } }).总数, 1, '换完之后仍只有 1 张');
  应当(ctx.图库.列({ 作用域: { 存放地: 'vision' } }).条目[0].标识 !== ctx.工作区那张.标识, '该是新的那个条目');
});

走('用户点开图库看列表（列表只读目录，不读副档）', async (ctx) => {
  const 过 = ctx.图库.列({ 作用域: { 存放地: 'gallery' } });
  相等(过.总数, 1, '图库里 1 张');
  const 一 = 过.条目[0];
  应当(一.标识 && 一.引用, '列表项该给标识与引用');
  应当(!('显示名' in 一), '列表项不该带显示名（那要去读副档）');
  应当(typeof 一.修改时间 === 'number', '该给修改时间，供排序');
  const 详情 = ctx.图库.取详情({ 引用: 一.引用 });
  相等(详情.显示名, '我的第一张图', '取详情才给显示名');
});

走('用户删除对话 A（不保留图片）', async (ctx) => {
  const 前 = ctx.图库.列({ 作用域: { 存放地: 'session', 会话ID: 'A' } }).总数;
  相等(前, 3, '删之前有 3 张');
  const 结果 = await ctx.图库.清空({ 作用域: { 存放地: 'session', 会话ID: 'A' } });
  相等(结果.已删, 3, '该删掉 3 张');
  相等(ctx.图库.列({ 作用域: { 存放地: 'session', 会话ID: 'A' } }).总数, 0, '对话 A 空了');
  相等(ctx.图库.列({ 作用域: { 存放地: 'gallery' } }).总数, 1, '图库不受影响');
  相等(ctx.图库.列({ 作用域: { 存放地: 'vision' } }).总数, 1, '工作区不受影响');
  应当(结果.批次 === null || typeof 结果.批次 === 'string', '该报出批次');
  应当(fs.existsSync(path.join(根, 'session', 'A')), '会话目录还在');
});

走('用户删除对话 B 但保留图片（先转存图库，再删对话）', async (ctx) => {
  await ctx.图库.存({ 作用域: { 存放地: 'session', 会话ID: 'B' }, 字节: 图(7), 文件名: '要保留的.png', mime: 'image/png' });
  await ctx.图库.存({ 作用域: { 存放地: 'session', 会话ID: 'B' }, 字节: 图(8), 文件名: '也保留.png', mime: 'image/png' });
  const 前 = ctx.图库.列({ 作用域: { 存放地: 'session', 会话ID: 'B' } });
  相等(前.总数, 2, '对话 B 里有 2 张');
  for (const 一条 of 前.条目) {
    const 取 = ctx.图库.取内容({ 引用: 一条.引用 });
    await ctx.图库.存({ 作用域: { 存放地: 'gallery' }, 字节: 取.字节, 文件名: 取.文件名, mime: 取.mime, 来源: 'copy' });
  }
  await ctx.图库.清空({ 作用域: { 存放地: 'session', 会话ID: 'B' } });
  相等(ctx.图库.列({ 作用域: { 存放地: 'session', 会话ID: 'B' } }).总数, 0, '对话 B 空了');
  相等(ctx.图库.列({ 作用域: { 存放地: 'gallery' } }).总数, 3, '图库涨到 3 张');
});

走('用户从图库删一张（进系统回收站）', async (ctx) => {
  const 全部 = ctx.图库.列({ 作用域: { 存放地: 'gallery' } }).条目;
  const 要删 = 全部[全部.length - 1];
  const 删 = await ctx.图库.run('删', { 引用: 要删.引用 });
  应当(删.ok, '删该成功');
  相等(删.data.已删, 1, '该报已删 1');
  相等(删.data.未回收, false, '回收站配了，该已回收');
  相等(ctx.图库.列({ 作用域: { 存放地: 'gallery' } }).总数, 2, '图库剩 2 张');
  应当(ctx.回收站.length >= 1, '回收站该被调用过');
});

走('用户按分类看图库（先读类里的成员，再逐条取详情）', async (ctx) => {
  const 类 = await ctx.图库.表({ 表: '分类', 动作: '读', 类: ctx.类ID });
  应当(类 && 类.成员, '该读得到这个类');
  const 成员 = 类.成员;
  应当(成员.length >= 1, '类里该有成员');
  const 还在 = [];
  for (const 标识 of 成员) {
    const 详情 = ctx.图库.run('取详情', { 引用: { 作用域: { 存放地: 'gallery' }, 条目ID: 标识 } });
    if (详情.ok) 还在.push(详情.data.显示名);
  }
  应当(还在.length >= 1, '类里至少该有一条能取到');
});

走('用户体检图库（看有没有悬空、残留、读不懂）', async (ctx) => {
  const d = await ctx.图库.维护({ 动作: '报告' });
  应当(d && d.悬空标识, '体检该能跑');
  应当(Array.isArray(d.悬空标识), '该给悬空标识');
  应当(Array.isArray(d.暂存残留), '该给暂存残留');
  应当(Array.isArray(d.不完整条目), '该给不完整条目');
  应当(Array.isArray(d.读不懂的副档), '该给读不懂的副档');
  ctx.体检 = d;
});

走('用户手动把一张图的副档删掉（外部破坏），看系统怎么报', async (ctx) => {
  const 全部 = ctx.图库.列({ 作用域: { 存放地: 'gallery' } }).条目;
  const 目标 = 全部[0];
  const 副档 = path.join(根, 'gallery', 目标.标识, 'meta.json');
  fs.rmSync(副档, { force: true });

  相等(ctx.图库.列({ 作用域: { 存放地: 'gallery' } }).总数, 2, '列表照常返回');
  const 详情 = ctx.图库.run('取详情', { 引用: 目标.引用 });
  相等(详情.ok, false, '取详情该失败');
  应当(详情.reason.includes('IMAGE_NOT_FOUND'), `该报不存在：${详情.reason}`);
  // 体检把它列进"不完整条目"
  const 报告 = await ctx.图库.维护({ 动作: '报告' });
  应当(报告.不完整条目.some((x) => x.引用.条目ID === 目标.标识), '体检该把它列成不完整');
});

走('用户再存一张，确认前面那些破坏没有影响正常使用', async (ctx) => {
  const 新 = await ctx.图库.存({ 作用域: { 存放地: 'gallery' }, 字节: 图(11), 文件名: '新的.png' });
  应当(新, '该能继续存');
  相等(ctx.图库.列({ 作用域: { 存放地: 'gallery' } }).总数, 3, '图库涨到 3 张');
  const 取 = ctx.图库.取内容({ 引用: 新.引用 });
  应当(Buffer.compare(取.字节, 图(11)) === 0, '取回来的字节该和存进去的一样');
});

// ---------------------------------------------------------------- 跑

(async () => {
  if (fs.existsSync(根)) fs.rmSync(根, { recursive: true, force: true });
  fs.mkdirSync(根, { recursive: true });

  const 回收站 = [];
  const ctx = {
    回收站,
    图库: createImageModule({
      根目录: 根,
      处理图片: (字节) => ({
        preview: { 字节: Buffer.concat([字节, Buffer.from('P')]), mime: 'image/png' },
        thumbnail: { 字节: Buffer.concat([字节, Buffer.from('T')]), mime: 'image/png' },
      }),
      交回收站: async (p) => { 回收站.push(p); },
      校验和: (b) => `sha256:${crypto.createHash('sha256').update(b).digest('hex')}`,
    }),
  };

  let 过 = 0;
  const 失败 = [];
  for (const 项 of 步骤) {
    序号++;
    try {
      await 项.做(ctx);
      过++;
      console.log(`  ${String(序号).padStart(2)} 通过  ${项.说明}`);
    } catch (error) {
      失败.push(项.说明);
      console.log(`  ${String(序号).padStart(2)} 失败  ${项.说明}`);
      console.log(`        → ${(error && error.message) || error}`);
    }
  }

  console.log('');
  console.log(`验收 ${过 + 失败.length} 步：通过 ${过}，失败 ${失败.length}`);

  console.log('');
  console.log('盘上最终形状：');
  const 走树 = (目录, 缩进) => {
    for (const 名 of fs.readdirSync(目录).sort()) {
      const 全 = path.join(目录, 名);
      const 是目录 = fs.statSync(全).isDirectory();
      const 大小 = 是目录 ? '' : `  ${fs.statSync(全).size} B`;
      console.log(`${缩进}${名}${是目录 ? '/' : ''}${大小}`);
      if (是目录) 走树(全, `${缩进}  `);
    }
  };
  console.log('tools/.验收/');
  走树(根, '  ');

  console.log('');
  console.log(`回收站被调用 ${回收站.length} 次；每次拿到的是一整批目录`);
  if (失败.length) process.exitCode = 1;
})();
