'use strict';
/*
 * 图片模块 · 自检。
 *
 *   node test/run.js            跑全部
 *   node test/run.js 存         只跑名字里含"存"的
 *
 * 跑完打印 通过/失败，失败给可读的理由。
 * 数据落在 test/.data/ 下，每次跑之前整个删掉 —— 不留残留。
 *
 * 【读直接给结果，写返回 Promise】列 / 取详情 / 取内容 / 取地址 同步；存 / 改 / 删 / 清空 / 表 异步。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { createImageModule } = require('../index.js');
const { createFileAdapter } = require('../adapter-file.js');

const 数据根 = path.join(__dirname, '.data');
const 只跑 = process.argv[2] || '';

/** 造一张假图（PNG 头 + 噪声），够用来当字节。 */
function 假图(种子) {
  const 头 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const 身 = Buffer.alloc(64, 种子 === undefined ? 7 : 种子);
  return Buffer.concat([头, 身]);
}

/** 一个够用的处理器：把 preview / thumbnail 造成不同的字节。 */
function 假处理器(字节) {
  return {
    preview: { 字节: Buffer.concat([字节, Buffer.from('preview')]), mime: 'image/png' },
    thumbnail: { 字节: Buffer.concat([字节, Buffer.from('thumb')]), mime: 'image/png' },
  };
}

const 判据们 = [];
const 判 = (编号, 说明, 做) => 判据们.push({ 编号, 说明, 做 });

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

/** 每次都造一套干净的环境。 */
function 装置(选项 = {}) {
  if (fs.existsSync(数据根)) fs.rmSync(数据根, { recursive: true, force: true });
  fs.mkdirSync(数据根, { recursive: true });
  const 回收站 = [];
  const 模块 = createImageModule({
    根目录: 数据根,
    处理图片: 选项.处理图片 === undefined ? null : 选项.处理图片,
    交回收站: 选项.交回收站 === undefined ? ((p) => { 回收站.push(p); }) : 选项.交回收站,
    校验和: (字节) => `sha256:${crypto.createHash('sha256').update(字节).digest('hex')}`,
  });
  return { 模块, 根: 数据根, 回收站 };
}

let 种子 = 0;
const 下一张 = () => 假图(种子++ % 251);

// ---------------------------------------------------------------- 判据

判('V-0', '装配：没有根目录、或端口缺方法，一律抛错（装配阶段可以抛）', () => {
  let 抛了 = false;
  try { createImageModule({}); } catch (_) { 抛了 = true; }
  应当(抛了, '没有根目录也没有端口，应当抛错');
  抛了 = false;
  try { createImageModule({ port: { list: () => ({}) } }); } catch (_) { 抛了 = true; }
  应当(抛了, '端口缺方法，应当抛错');
});

判('V-1', '处理器缺省：存仍然成功；取派生变体报 IMAGE_VARIANT_MISSING', async () => {
  const { 模块 } = 装置({ 处理图片: null });
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png', mime: 'image/png' });
  应当(存, '存应当成功');
  应当(存.变体.original, '原图该在');
  应当(!存.变体.preview && !存.变体.thumbnail, '没有处理器就不该有派生变体');

  const 直 = await 模块.run('取内容', { 引用: 存.引用, 变体: 'thumbnail' });
  相等(直.ok, false, '没有派生变体应当失败');
  应当(直.reason.includes('IMAGE_VARIANT_MISSING'), `理由该带 IMAGE_VARIANT_MISSING：${直.reason}`);

  // 派生变体缺了，原图照样取得到
  const 原 = 模块.取内容({ 引用: 存.引用 });
  应当(原 && 原.字节.length, '原图照样取得到');
});

判('V-1b', '处理器报错：存报 IMAGE_PROCESSING_FAILED，且列看不到该条目', async () => {
  const { 模块 } = 装置({ 处理图片: () => { throw new Error('处理器炸了'); } });
  const 直 = await 模块.run('存', { 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });
  相等(直.ok, false, '存应当失败');
  应当(直.reason.includes('IMAGE_PROCESSING_FAILED'), `理由该带 IMAGE_PROCESSING_FAILED：${直.reason}`);
  相等(模块.列({ 作用域: { 存放地: 'gallery' } }).总数, 0, '失败的存不该留下条目');
});

判('V-2', '上位失败：列看不到半成品，暂存也不残留', async () => {
  const { 模块, 根 } = 装置();
  void 模块;
  const 真 = createFileAdapter({ root: 根 });
  const 坏端口 = { ...真, rename: () => ({ ok: false, reason: '被占用' }) };
  const 坏模块 = createImageModule({ port: 坏端口 });
  const 直 = await 坏模块.run('存', { 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });
  相等(直.ok, false, '应当失败');
  相等(坏模块.列({ 作用域: { 存放地: 'gallery' } }).总数, 0, '列不该看到它');
  const 暂存 = fs.existsSync(path.join(根, '.staging')) ? fs.readdirSync(path.join(根, '.staging')) : [];
  相等(暂存.length, 0, `暂存应当被清干净：${暂存.join(',')}`);
});

判('V-2b', '装配参数只有一个名字：根目录 就是 根目录，没有别名', () => {
  const { 根 } = 装置();
  let 抛了 = '';
  try { createImageModule({ root: 根 }); } catch (错) { 抛了 = String(错 && 错.message); }
  应当(抛了.includes('IMAGE_ROOT_REQUIRED'), `root 不该被当成位置：${抛了}`);
  抛了 = '';
  try { createImageModule({ data: 根 }); } catch (错) { 抛了 = String(错 && 错.message); }
  应当(抛了.includes('IMAGE_ROOT_REQUIRED'), `data 不该被当成位置：${抛了}`);
  相等(createImageModule({ 根目录: 根 }).actions.length, 16, '根目录 这条路要通');
});

判('V-3', '删除：条目立刻移出可见范围；回收站没配时如实报可恢复位置', async () => {
  const { 模块, 根 } = 装置({ 交回收站: null });
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });
  相等(模块.列({ 作用域: { 存放地: 'gallery' } }).总数, 1, '存完应当有 1 条');

  const 删 = await 模块.run('删', { 引用: 存.引用 });
  应当(删.ok, '删本身应当成功（条目已移出可见范围）');
  相等(删.data.已删, 1, '应当报已删 1');
  相等(删.data.未回收, true, '没有回收站时应当标未回收');
  应当(String(删.data.reason).includes('IMAGE_TRASH_REQUIRED'), `理由该带 TRASH_REQUIRED：${删.data.reason}`);
  相等(模块.列({ 作用域: { 存放地: 'gallery' } }).总数, 0, '删完列应当看不到');
  const 待 = fs.readdirSync(path.join(根, '.deleting'));
  相等(待.length, 1, '待回收目录里该留着那一个批次');
});

判('V-4', '副档读不懂：报 IMAGE_METADATA_UNREADABLE，且原文件一个字不动', async () => {
  const { 模块, 根 } = 装置();
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });
  const 副档 = path.join(根, 'gallery', 存.标识, 'meta.json');
  fs.writeFileSync(副档, '{ 这不是 JSON', 'utf8');

  const 取 = await 模块.run('取详情', { 引用: 存.引用 });
  相等(取.ok, false, '读不懂应当失败');
  应当(取.reason.includes('IMAGE_METADATA_UNREADABLE'), `理由该带读不懂：${取.reason}`);

  const 改 = await 模块.run('改', { 引用: 存.引用, 显示名: '新名字' });
  相等(改.ok, false, '写应当被冻结');
  应当(改.reason.includes('IMAGE_METADATA_UNREADABLE'), `写被冻结的理由：${改.reason}`);
  相等(fs.readFileSync(副档, 'utf8'), '{ 这不是 JSON', '原文件一个字都不该动');
});

判('V-5', '取地址给绝对路径；工具参数里没有路径/URL 类字段', async () => {
  const { 模块 } = 装置();
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });
  const 地址 = 模块.取地址({ 引用: 存.引用 });
  应当(地址 && path.isAbsolute(地址.地址), `应当是绝对路径：${地址 && 地址.地址}`);

  const 清单 = 模块.describe();
  const 取地址 = 清单.find((x) => x.动作 === '取地址');
  应当(取地址, '取地址应当在清单里');
  同构(取地址.参数, ['引用', '变体?'], '取地址的参数里只有引用与变体');
  for (const 条 of 清单) {
    const 参数 = 条.参数.join(',');
    应当(!/path|url|地址|路径|文件路径/i.test(参数), `动作 ${条.动作} 的参数里有路径类字样：${参数}`);
  }
});

判('V-6', '作用域隔离：清空一个对话，不碰别的对话、图库、工作区', async () => {
  const { 模块 } = 装置();
  await 模块.存({ 作用域: { 存放地: 'session', 会话ID: 'A' }, 字节: 下一张(), 文件名: 'a.png' });
  await 模块.存({ 作用域: { 存放地: 'session', 会话ID: 'B' }, 字节: 下一张(), 文件名: 'b.png' });
  await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'c.png' });
  await 模块.存({ 作用域: { 存放地: 'vision' }, 字节: 下一张(), 文件名: 'd.png' });

  await 模块.清空({ 作用域: { 存放地: 'session', 会话ID: 'A' } });
  相等(模块.列({ 作用域: { 存放地: 'session', 会话ID: 'A' } }).总数, 0, 'A 应当空了');
  相等(模块.列({ 作用域: { 存放地: 'session', 会话ID: 'B' } }).总数, 1, 'B 不该被碰');
  相等(模块.列({ 作用域: { 存放地: 'gallery' } }).总数, 1, '图库不该被碰');
  相等(模块.列({ 作用域: { 存放地: 'vision' } }).总数, 1, '工作区不该被碰');
});

判('V-7', '识图工作区：能力组只给一个 清空；换图之后仍只有 1 张', async () => {
  const { 模块 } = 装置();
  const 能力 = 模块.工作区能力();
  同构(Object.keys(能力), ['清空'], '能力组只该有 清空 一个');

  await 模块.存({ 作用域: { 存放地: 'vision' }, 字节: 下一张(), 文件名: 'a.png' });
  相等(模块.列({ 作用域: { 存放地: 'vision' } }).总数, 1, '第一张');
  await 能力.清空();
  相等(模块.列({ 作用域: { 存放地: 'vision' } }).总数, 0, '清空之后是 0 张');
  await 模块.存({ 作用域: { 存放地: 'vision' }, 字节: 下一张(), 文件名: 'b.png' });
  相等(模块.列({ 作用域: { 存放地: 'vision' } }).总数, 1, '换一张之后仍只有 1 张');
});

判('V-8', '图库与工作区没有索引；会话目录只保存图号高水位', async () => {
  const { 模块, 根 } = 装置();
  await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });
  await 模块.存({ 作用域: { 存放地: 'session', 会话ID: 'A' }, 字节: 下一张(), 文件名: 'b.png' });
  await 模块.存({ 作用域: { 存放地: 'vision' }, 字节: 下一张(), 文件名: 'c.png' });

  const 顶层 = fs.readdirSync(根).sort();
  同构(顶层, ['.staging', 'gallery', 'session', 'vision'], '顶层形状');
  // 存放地里只有条目目录，没有任何清单/索引/计数器文件
  for (const 地 of ['gallery', 'vision']) {
    for (const 名 of fs.readdirSync(path.join(根, 地))) {
      应当(!/manifest|index|清单|索引/i.test(名), `不该有清单类文件：${地}/${名}`);
    }
  }
  for (const 名 of fs.readdirSync(path.join(根, 'session', 'A'))) {
    应当(!/manifest|index|清单|索引/i.test(名), `不该有清单类文件：session/A/${名}`);
  }
  const 状态 = JSON.parse(fs.readFileSync(path.join(根, 'session', 'A', 'scope.json'), 'utf8'));
  相等(状态.highWater, 1, '会话作用域状态只记录当前图号高水位');
});

判('V-9', '不去重：同样的字节存两次，得到两个独立条目', async () => {
  const { 模块 } = 装置();
  const 字节 = 假图(9);
  const a = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节, 文件名: 'a.png' });
  const b = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节, 文件名: 'a.png' });
  应当(a.标识 !== b.标识, '两个条目该有不同的 ID');
  相等(模块.列({ 作用域: { 存放地: 'gallery' } }).总数, 2, '该有两条');
  相等(a.校验和, b.校验和, '校验和相同（只是不去重）');
});

判('V-10', '变体名非法：报 INVALID_IMAGE_VARIANT，不静默回退', async () => {
  const { 模块 } = 装置();
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });
  const 直 = await 模块.run('取内容', { 引用: 存.引用, 变体: 'huge' });
  相等(直.ok, false, '应当失败');
  应当(直.reason.includes('INVALID_IMAGE_VARIANT'), `理由：${直.reason}`);
});

判('V-11', '残留：列不返回它，维护报出来，清理之后消失', async () => {
  const { 模块, 根 } = 装置();
  fs.mkdirSync(path.join(根, '.staging', 'img_orphan-1'), { recursive: true });
  fs.writeFileSync(path.join(根, '.staging', 'img_orphan-1', 'original.png'), 'x');
  相等(模块.列({ 作用域: { 存放地: 'gallery' } }).总数, 0, '列不该返回残留');

  const 报告 = await 模块.维护({ 动作: '报告' });
  相等(报告.暂存残留.length, 1, '报告该列出 1 处残留');
  应当(String(报告.reason).includes('IMAGE_RESIDUE_PRESENT'), `报告该带 RESIDUE：${报告.reason}`);

  const 清理 = await 模块.维护({ 动作: '清理' });
  相等(清理.已清理, 1, '该清理 1 处');
  相等(fs.readdirSync(path.join(根, '.staging')).length, 0, '清理后暂存应当空了');
});

判('V-12', '维护.清理 不碰 .deleting（那可能是唯一副本）', async () => {
  const { 模块, 根 } = 装置({ 交回收站: null });
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });
  await 模块.删({ 引用: 存.引用 });
  相等(fs.readdirSync(path.join(根, '.deleting')).length, 1, '待回收里该有 1 个批次');
  await 模块.维护({ 动作: '清理' });
  相等(fs.readdirSync(path.join(根, '.deleting')).length, 1, '清理不该动 .deleting');
});

判('V-13', '表不是权威：删光表之后图库照样能列、能取', async () => {
  const { 模块, 根 } = 装置();
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });
  const 加 = await 模块.表({ 表: '收藏', 动作: '加', 标识: 存.标识 });
  同构(加, [存.标识], '收藏里该有它');

  fs.rmSync(path.join(根, 'gallery', '收藏.json'), { force: true });
  fs.rmSync(path.join(根, 'gallery', '分类.json'), { force: true });
  相等(模块.列({ 作用域: { 存放地: 'gallery' } }).总数, 1, '表没了图库照样能列');
  应当(模块.取内容({ 引用: 存.引用 }), '表没了照样能取内容');
});

判('V-14', '悬空标识：收藏过的图删掉后，报告列出它而不是报错', async () => {
  const { 模块 } = 装置();
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });
  await 模块.表({ 表: '收藏', 动作: '加', 标识: 存.标识 });
  await 模块.删({ 引用: 存.引用 });
  const 报告 = await 模块.维护({ 动作: '报告' });
  相等(报告.悬空标识.length, 1, '该有 1 个悬空标识');
  相等(报告.悬空标识[0].标识, 存.标识, '悬空的正是那一个');
});

判('V-15', '列不读副档：把副档删掉，列照常返回；取详情才报不存在', async () => {
  const { 模块, 根 } = 装置();
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });
  fs.rmSync(path.join(根, 'gallery', 存.标识, 'meta.json'), { force: true });

  const 过 = 模块.列({ 作用域: { 存放地: 'gallery' } });
  相等(过.总数, 1, '列只看目录，副档没了也照样列出');
  相等(过.条目[0].标识, 存.标识, '列出来的正是它');

  const 详情 = await 模块.run('取详情', { 引用: 存.引用 });
  应当(详情.reason.includes('IMAGE_NOT_FOUND'), `缺副档该报不存在：${详情.reason}`);
});

判('V-16', '列的代价不随总数增长（200 条时仍在 150 ms 内）', async () => {
  const { 模块 } = 装置();
  for (let i = 0; i < 200; i++) {
    await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 假图(i % 251), 文件名: `f${i}.png` });
  }
  const t0 = Date.now();
  const 过 = 模块.列({ 作用域: { 存放地: 'gallery' } });
  const 耗时 = Date.now() - t0;
  相等(过.总数, 200, '200 条都在');
  应当(耗时 < 150, `列该在 150 ms 内（实测 ${耗时} ms）`);
  const 一 = 模块.取详情({ 引用: 过.条目[0].引用 });
  应当(一, '取详情该成功');
});

判('V-17', '新存的条目下一次列立刻看得见，中间没有失效步骤', async () => {
  const { 模块 } = 装置();
  相等(模块.列({ 作用域: { 存放地: 'gallery' } }).总数, 0, '起手是空的');
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });
  const 过 = 模块.列({ 作用域: { 存放地: 'gallery' } });
  相等(过.总数, 1, '存完立刻列就该看得见');
  相等(过.条目[0].标识, 存.标识, '就是刚存的那条');
});

判('V-18', '存返回完整描述符（含显示名），调用方不必再取详情', async () => {
  const { 模块 } = 装置();
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png', 显示名: '我的图' });
  相等(存.显示名, '我的图', '存该直接给显示名');
  相等(存.文件名, 'a.png', '也给文件名');
  应当(存.引用 && 存.引用.条目ID, '也给引用');
});

判('V-19', '批量删除部分失败：如实报"已删几个 + 卡在哪个引用"', async () => {
  const { 模块, 根 } = 装置();
  await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 假图(1), 文件名: 'a.png' });
  await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 假图(2), 文件名: 'b.png' });
  await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 假图(3), 文件名: 'c.png' });

  const 真 = createFileAdapter({ root: 根 });
  let 第几次 = 0;
  const 坏端口 = {
    ...真,
    rename: (...参数) => {
      第几次++;
      if (第几次 === 2) return { ok: false, reason: '被占用' };
      return 真.rename(...参数);
    },
  };
  const 坏模块 = createImageModule({ port: 坏端口 });
  const 直 = await 坏模块.run('清空', { 作用域: { 存放地: 'gallery' } });
  相等(直.ok, false, '部分失败应当是失败');
  应当(直.reason.includes('IMAGE_REMOVE_FAILED'), `理由：${直.reason}`);
  同构(Object.keys(直.details).sort(), ['已删', '卡在', '批次'].sort(), 'details 的字段名照 接口.md');
  同构(Object.keys(直.details.卡在).sort(), ['作用域', '条目ID'], '卡在 该是一个引用');
  相等(直.details.已删, 1, '应当报已删 1');
  应当(typeof 直.details.批次 === 'string' && 直.details.批次.length > 0, '批次 该是一个串');
});

判('V-20', '改名只改副档里的显示名，磁盘上的文件名一个字不动', async () => {
  const { 模块, 根 } = 装置();
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: '原名.png' });
  const 条目目录 = path.join(根, 'gallery', 存.标识);
  const 改前 = fs.readdirSync(条目目录).sort();
  const 改 = await 模块.改({ 引用: 存.引用, 显示名: '新名字' });
  相等(改.显示名, '新名字', '显示名改了');
  相等(改.文件名, '原名.png', '文件名没动');
  同构(fs.readdirSync(条目目录).sort(), 改前, '磁盘上的文件名一个都没变');
});

判('V-21', '元数据是整袋替换，不是字段级合并', async () => {
  const { 模块 } = 装置();
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png', 元数据: { 甲: 1, 乙: 2 } });
  同构(存.元数据, { 甲: 1, 乙: 2 }, '存进去的原样');
  const 改 = await 模块.改({ 引用: 存.引用, 元数据: { 丙: 3 } });
  同构(改.元数据, { 丙: 3 }, '整袋替换，旧字段不该留下');
});

判('V-22', '路径安全：危险段一律拒绝，不存在的存放地也拒', async () => {
  const { 模块 } = 装置();
  const 甲 = await 模块.run('列', { 作用域: { 存放地: 'gallery', 会话ID: '../..' } });
  相等(甲.ok, false, '图库不该接受会话 ID');
  应当(甲.reason.includes('INVALID_SCOPE'), `理由：${甲.reason}`);

  const 乙 = await 模块.run('列', { 作用域: { 存放地: 'session', 会话ID: '..' } });
  相等(乙.ok, false, '.. 不该被接受');
  应当(乙.reason.includes('INVALID_IMAGE_PATH'), `理由：${乙.reason}`);

  const 丙 = await 模块.run('列', { 作用域: { 存放地: 'nope' } });
  相等(丙.ok, false, '不存在的存放地该被拒');
});

判('V-23', '对话作用域缺会话 ID 时落到固定占位段 `_`（单一规则）', async () => {
  const { 模块, 根 } = 装置();
  const 存 = await 模块.存({ 作用域: { 存放地: 'session' }, 字节: 下一张(), 文件名: 'a.png' });
  应当(存, '没有会话 ID 也该能存');
  应当(fs.existsSync(path.join(根, 'session', '_', 存.标识)), '该落到 session/_/ 下');
});

判('V-24', '分类只有一层，成员只能是条目 ID', async () => {
  const { 模块 } = 装置();
  const 类 = await 模块.表({ 表: '分类', 动作: '建类', 名: '人物' });
  同构(类.成员, [], '新类成员是空的');

  const 字典 = await 模块.表({ 表: '分类', 动作: '读' });
  const 类ID = Object.keys(字典)[0];
  应当(类ID, '读回来的字典里该有这个类');

  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });
  const 加 = await 模块.表({ 表: '分类', 动作: '加成员', 类: 类ID, 标识: 存.标识 });
  同构(加.成员, [存.标识], '成员就是那个标识');

  const 坏 = await 模块.表({ 表: '分类', 动作: '加成员', 类: 类ID, 标识: '../../etc/passwd' });
  相等(坏, null, '不是条目 ID 的一律拒绝（直呼式给 null）');
});

判('V-25', '删一个不存在的条目 = 未删除，不是失败（幂等）', async () => {
  const { 模块 } = 装置();
  const 直 = await 模块.run('删', { 引用: { 作用域: { 存放地: 'gallery' }, 条目ID: 'img_没有这个' } });
  应当(直.ok, '幂等：不该失败');
  相等(直.data.已删, 0, '未删除');
});

判('V-26', '条目尺寸不设上限：本模块不看内容、不判大小', async () => {
  const { 模块 } = 装置();
  const 大 = Buffer.alloc(3 * 1024 * 1024, 3);
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 大, 文件名: 'big.bin' });
  应当(存, '大文件照样能存');
  相等(存.字节数, 大.length, '字节数如实回报');
});

判('V-27', '只有一条写队列：并发存 20 张，全部成功且互不覆盖', async () => {
  const { 模块 } = 装置();
  const 任务 = [];
  for (let i = 0; i < 20; i++) {
    任务.push(模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 假图(i), 文件名: `f${i}.png` }));
  }
  const 结果 = await Promise.all(任务);
  const 标识 = new Set(结果.map((x) => x && x.标识));
  应当(!标识.has(undefined), '每一张都该成功');
  相等(标识.size, 20, '20 个条目 ID 互不相同');
  相等(模块.列({ 作用域: { 存放地: 'gallery' } }).总数, 20, '都落盘了');
});

判('V-28', 'data: 形式与字节等价', async () => {
  const { 模块 } = 装置();
  const 字节 = 假图(5);
  const a = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节, 文件名: 'a.png' });
  const b = await 模块.存({ 作用域: { 存放地: 'gallery' }, dataUrl: `data:image/png;base64,${字节.toString('base64')}`, 文件名: 'b.png' });
  应当(a && b, '两种形式都该能存');
  相等(a.字节数, b.字节数, '字节数一致');
  相等(a.校验和, b.校验和, '字节一模一样');
});

判('V-29', '取内容给的字节与存进去的一模一样（原图不改一个字节）', async () => {
  const { 模块 } = 装置({ 处理图片: 假处理器 });
  const 字节 = 假图(11);
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节, 文件名: 'a.png', mime: 'image/png' });
  const 取 = 模块.取内容({ 引用: 存.引用, 变体: 'original' });
  应当(取, '原图该取得到');
  相等(Buffer.compare(取.字节, 字节), 0, '原图字节必须一模一样');
  const 缩 = 模块.取内容({ 引用: 存.引用, 变体: 'thumbnail' });
  应当(缩, '缩略图该取得到（有处理器）');
  应当(缩.字节.length > 字节.length, '缩略图是处理器给的，与原图不同');
});

判('V-30', '改 至少要给一项，空调用要拒', async () => {
  const { 模块 } = 装置();
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });
  const 直 = await 模块.run('改', { 引用: 存.引用 });
  相等(直.ok, false, '什么都不给应当失败');
  应当(直.reason.includes('INVALID_ARGUMENT'), `理由：${直.reason}`);
});

判('V-31', '端口封住了：同一套流程在内存适配器上跑出同样结果（核心不依赖盘）', async () => {
  const { createMemoryAdapter } = require('../adapter-memory.js');

  /** 一整套动作，跑在任意适配器上，返回可比对的结果。 */
  const 跑一套 = async (适配器, { 处理图片, 交回收站 }) => {
    const 模块 = createImageModule({
      port: 适配器,
      处理图片,
      交回收站,
      校验和: (b) => `sha256:${crypto.createHash('sha256').update(b).digest('hex')}`,
    });
    const 输出 = {};

    const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 假图(3), 文件名: 'a.png', mime: 'image/png', 元数据: { 甲: 1 } });
    输出.有标识 = typeof 存.标识 === 'string' && 存.标识.startsWith('img_');
    输出.变体 = Object.keys(存.变体).sort();
    输出.原图一致 = Buffer.compare(模块.取内容({ 引用: 存.引用 }).字节, 假图(3)) === 0;
    输出.地址非空 = String(模块.取地址({ 引用: 存.引用 }).地址).length > 0;

    输出.列总数 = 模块.列({ 作用域: { 存放地: 'gallery' } }).总数;
    输出.列字段 = Object.keys(模块.列({ 作用域: { 存放地: 'gallery' } }).条目[0]).sort();
    输出.详情显示名 = 模块.取详情({ 引用: 存.引用 }).显示名;

    const 改 = await 模块.改({ 引用: 存.引用, 显示名: '改过' });
    输出.改后显示名 = 改.显示名;

    const 缺 = await 模块.run('取内容', { 引用: 存.引用, 变体: 'huge' });
    输出.坏变体码 = 缺.code;

    const 坏域 = await 模块.run('列', { 作用域: { 存放地: 'session', 会话ID: '..' } });
    输出.坏作用域码 = 坏域.code;

    await 模块.表({ 表: '收藏', 动作: '加', 标识: 存.标识 });
    const 收藏 = await 模块.表({ 表: '收藏', 动作: '读' });
    // 条目 ID 是随机的，两边不可能相同；比形状与它是不是那条
    输出.收藏 = { 条数: 收藏.length, 就是那条: 收藏[0] === 存.标识 };

    const 删 = await 模块.run('删', { 引用: 存.引用 });
    输出.删除 = { 已删: 删.data.已删, 未回收: 删.data.未回收 };
    输出.删后总数 = 模块.列({ 作用域: { 存放地: 'gallery' } }).总数;

    const 报告 = await 模块.维护({ 动作: '报告' });
    输出.悬空 = 报告.悬空标识.length;
    return 输出;
  };

  const 选项 = { 处理图片: 假处理器, 交回收站: async () => {} };

  // ① 文件适配器。回收能力由装配层递进来 —— 适配器自己不知道怎么回收。
  const 根 = path.join(__dirname, '.data-mem');
  if (fs.existsSync(根)) fs.rmSync(根, { recursive: true, force: true });
  fs.mkdirSync(根, { recursive: true });
  const 文件结果 = await 跑一套(createFileAdapter({ root: 根, trashItem: 选项.交回收站 }), 选项);

  // ② 内存适配器。它自带回收（把键交回去），不需要外部能力。
  const 内存结果 = await 跑一套(createMemoryAdapter(), 选项);

  fs.rmSync(根, { recursive: true, force: true });

  /* 两边的结果该一模一样，只有"地址长什么样"不同：
     文件实现给物理路径，内存实现给 mem:// 键；核心把它当一个不透明的串。 */
  同构(内存结果, 文件结果, '内存实现与文件实现的结果该完全一致');
  应当(文件结果.有标识, '两边都该给出标识');
  应当(文件结果.列总数 === 1, '存完列该有 1 条');
  应当(文件结果.删后总数 === 0, '删完列该是空的');
  应当(文件结果.删除.已删 === 1 && 文件结果.删除.未回收 === false, '删除该成功且已回收');
  应当(文件结果.悬空 === 1 && 内存结果.悬空 === 1, '两边都该报出那个悬空标识');
});

判('V-32', '维护.清理 把悬空标识从表里摘掉', async () => {
  const { 模块 } = 装置();
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });
  await 模块.表({ 表: '收藏', 动作: '加', 标识: 存.标识 });
  await 模块.删({ 引用: 存.引用 });          // 图没了，收藏表里留下悬空标识

  相等((await 模块.维护({ 动作: '报告' })).悬空标识.length, 1, '报告该列出它');
  同构(await 模块.表({ 表: '收藏', 动作: '读' }), [存.标识], '摘之前它还在表里');

  const 清理 = await 模块.维护({ 动作: '清理' });
  应当(清理.已清理 >= 1, '该摘掉至少一个');
  同构(await 模块.表({ 表: '收藏', 动作: '读' }), [], '摘之后收藏表空了');
  相等((await 模块.维护({ 动作: '报告' })).悬空标识.length, 0, '再报告就没有悬空了');
});

判('V-33', '维护.清理 清掉适配器留下的临时文件（报告能看见它）', async () => {
  const { 模块, 根 } = 装置();
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });
  const 脏 = path.join(根, 'gallery', 存.标识, '.tmp-1-2-abcd');
  fs.writeFileSync(脏, 'x');

  const 报告 = await 模块.维护({ 动作: '报告' });
  相等(报告.临时文件.length, 1, '报告该看见临时文件');
  应当(String(报告.reason).includes('IMAGE_RESIDUE_PRESENT'), `该带 RESIDUE：${报告.reason}`);
  相等(模块.列({ 作用域: { 存放地: 'gallery' } }).总数, 1, '列照常只返回 1 条，不含临时文件');

  await 模块.维护({ 动作: '清理' });
  应当(!fs.existsSync(脏), '清理之后临时文件该没了');
  相等((await 模块.维护({ 动作: '报告' })).临时文件.length, 0, '再报告就没有临时文件了');
});

判('V-34', '端口契约照 port.js：缺 全路径 装配就抛错；没有 exists 也能装配，取地址 照常给位置串', async () => {
  const { 根 } = 装置();
  const 真 = createFileAdapter({ root: 根 });

  const 缺全路径 = { ...真 };
  delete 缺全路径.全路径;
  let 抛了 = false;
  try { createImageModule({ port: 缺全路径 }); } catch (_) { 抛了 = true; }
  应当(抛了, '端口缺 全路径 该抛错');

  const 没有exists = { ...真 };
  delete 没有exists.exists;
  const 模块 = createImageModule({ port: 没有exists });
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });
  应当(存, '没有 exists 的端口该能存');
  const 地址 = 模块.取地址({ 引用: 存.引用 });
  应当(地址 && path.isAbsolute(地址.地址), `取地址 该给绝对路径：${地址 && 地址.地址}`);
});

判('V-35', '表：读与写走同一条队列 —— 没等写落盘就读，读到的是新表', async () => {
  const { 模块 } = 装置();
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: 下一张(), 文件名: 'a.png' });

  const 写 = 模块.表({ 表: '收藏', 动作: '加', 标识: 存.标识 });
  const 读 = await 模块.表({ 表: '收藏', 动作: '读' });
  同构(读, [存.标识], '读排在写之后，该给新表');

  await 写;
  同构(await 模块.表({ 表: '收藏', 动作: '读' }), [存.标识], '写完之后还是它');
});

判('V-36', '空删除不留目录：删不存在的条目、清空空作用域，根目录下都不出现 .deleting', async () => {
  const { 模块, 根 } = 装置();
  const 直 = await 模块.run('删', { 引用: { 作用域: { 存放地: 'gallery' }, 条目ID: 'img_没有这个' } });
  应当(直.ok, '删不该失败');
  相等(直.data.已删, 0, '没删到东西');
  相等(直.data.批次, null, '没批次');
  应当(!fs.existsSync(path.join(根, '.deleting')), '不该留下 .deleting');

  const 空 = await 模块.run('清空', { 作用域: { 存放地: 'gallery' } });
  应当(空.ok, '清空不该失败');
  相等(空.data.已删, 0, '空作用域没删到东西');
  应当(!fs.existsSync(path.join(根, '.deleting')), '空清空也不该留下 .deleting');
});

判('V-37', '同毫秒连建两个类：两个都建出来，类 ID 不撞', async () => {
  const { 模块 } = 装置();
  const 真的现在 = Date.now;
  Date.now = () => 1750000000000;
  try {
    const 甲 = await 模块.表({ 表: '分类', 动作: '建类', 名: '甲' });
    const 乙 = await 模块.表({ 表: '分类', 动作: '建类', 名: '乙' });
    应当(甲 && 乙, '两个类都该建出来');
    const 字典 = await 模块.表({ 表: '分类', 动作: '读' });
    相等(Object.keys(字典).length, 2, '字典里该有两个类');
    应当(Object.keys(字典)[0] !== Object.keys(字典)[1], '两个类 ID 该不同');
  } finally {
    Date.now = 真的现在;
  }
});

判('V-38', '字节的四种形状都能存：Buffer / Uint8Array / dataUrl / 过了 JSON 的 Buffer；不像内容的文本要拒', async () => {
  const { 模块 } = 装置();
  const 字节 = 假图(12);
  const 域 = { 存放地: 'gallery' };
  const 形状们 = {
    Buffer: 字节,
    Uint8Array: new Uint8Array(字节),
    dataUrl: `data:image/png;base64,${字节.toString('base64')}`,
    光秃秃的base64: 字节.toString('base64'),
    过了JSON的Buffer: JSON.parse(JSON.stringify({ 字节 })).字节,
  };
  for (const [名, 值] of Object.entries(形状们)) {
    const 存 = await 模块.存({ 作用域: 域, 字节: 值, 文件名: `${名}.png` });
    应当(存, `${名} 该能存`);
    应当(存.校验和, `${名} 该给出校验和`);
    相等(Buffer.compare(模块.取内容({ 引用: 存.引用 }).字节, 字节), 0, `${名} 存进去的字节该一模一样`);
  }
  const 路径 = await 模块.run('存', { 作用域: 域, 字节: 'C:/某处/一张.png', 文件名: 'x.png' });
  相等(路径.ok, false, '路径不是内容，该拒');
  应当(路径.reason.includes('IMAGE_BYTES_REQUIRED'), `理由：${路径.reason}`);
  const 空 = await 模块.run('存', { 作用域: 域, 文件名: 'x.png' });
  相等(空.ok, false, '什么都不给该拒');
});

// ---------------------------------------------------------------- 跑
(async () => {
  let 过 = 0;
  const 失败 = [];
  for (const 项 of 判据们) {
    if (只跑 && !(`${项.编号} ${项.说明}`).includes(只跑)) continue;
    try {
      await 项.做();
      过++;
      console.log(`  通过  ${项.编号}  ${项.说明}`);
    } catch (error) {
      失败.push({ ...项, 错: error && error.message });
      console.log(`  失败  ${项.编号}  ${项.说明}`);
      console.log(`        → ${(error && error.message) || error}`);
    }
  }
  console.log('');
  console.log(`合计 ${过 + 失败.length} 条：通过 ${过}，失败 ${失败.length}`);

  // 收尾：测试自己造的数据自己删
  for (const 脏 of [path.join(__dirname, '.data'), path.join(__dirname, '.data-mem')]) {
    if (fs.existsSync(脏)) fs.rmSync(脏, { recursive: true, force: true });
  }

  if (失败.length) process.exitCode = 1;
})();
