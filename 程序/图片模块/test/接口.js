'use strict';
/*
 * 接口校验 —— 拿 接口.md 里写死的东西去问实现。
 *
 *   node test/接口.js
 *
 * 它不测功能（那是 test/run.js 的事），只测**形状**：
 *   ① 对外只交八个操作 + 四个内部动作，一个不多一个不少
 *   ② 每个操作的返回字段名与契约完全一致
 *   ③ 对外参数里没有路径 / URL 字段
 *   ④ 端口缺方法要抛错；核心不 require fs / path
 *   ⑤ 出口冻住，不递内部件
 *
 * 这里写死的字段名照 接口.md 抄。
 */

const fs = require('fs');
const path = require('path');

const { createImageModule, createMemoryAdapter } = (() => {
  const m = require('../index.js');
  return { ...m, createMemoryAdapter: require('../adapter-memory.js').createMemoryAdapter };
})();
const { PORT_METHODS } = require('../port.js');

const 失败 = [];
const 通过 = [];
function 查(名字, 做) {
  try {
    const 问题 = 做();
    if (问题) 失败.push(`${名字}：${问题}`);
    else 通过.push(名字);
  } catch (error) {
    失败.push(`${名字}：抛了 ${(error && error.message) || error}`);
  }
}

const 模块 = createImageModule({ port: createMemoryAdapter() });

// ---------------------------------------------------------------- ① 动作清单

/** 接口.md 里写死的那 12 个动作名。 */
const 该有的动作 = [
  '列', '列会话图', '按图号取详情', '导入会话图', '恢复会话图号', '取详情', '取内容', '取地址', '存', '改', '删', '清空',
  '维护.报告', '维护.清理', '表.收藏', '表.分类',
];

查('① 动作清单恰好是契约里的 16 个', () => {
  const 实 = [...模块.actions].sort();
  const 期 = [...该有的动作].sort();
  const 多 = 实.filter((x) => !期.includes(x));
  const 少 = 期.filter((x) => !实.includes(x));
  if (多.length) return `多了 ${多.join('、')}`;
  if (少.length) return `少了 ${少.join('、')}`;
  return '';
});

查('① 图片公开操作都能直呼（函数）', () => {
  const 缺 = ['列', '列会话图', '按图号取详情', '导入会话图', '恢复会话图号', '取详情', '取内容', '取地址', '存', '改', '删', '清空']
    .filter((名) => typeof 模块[名] !== 'function');
  return 缺.length ? `这些不是函数：${缺.join('、')}` : '';
});

// ---------------------------------------------------------------- ② 返回字段

/** 契约里写死的出参字段名。照 接口.md 抄。 */
const 该有的字段 = {
  列: ['条目', '总数', '作用域'],
  条目: ['引用', '标识', '修改时间', '完整'],
  引用: ['作用域', '条目ID'],
  取详情: ['引用', '标识', '文件名', '显示名', 'mime', '宽', '高', '字节数', '校验和', '来源', '元数据', '变体', '创建时间', '更新时间'],
  取内容: ['引用', '变体', '字节', 'mime', '文件名'],
  取地址: ['引用', '变体', '地址', 'mime', '文件名'],
  删: ['已删', '已删除', '批次', '未回收'],
  清空: ['已删', '已删除', '批次', '未回收'],
  维护报告: ['暂存残留', '待回收残留', '临时文件', '不完整条目', '读不懂的副档', '悬空标识'],
};

function 差(实际, 期望, 名字) {
  const 多 = Object.keys(实际).filter((k) => !期望.includes(k));
  const 少 = 期望.filter((k) => !Object.keys(实际).includes(k));
  // reason 是失败时附加的，不算契约外的字段
  const 多真 = 多.filter((k) => k !== 'reason' && k !== 'code' && k !== 'details');
  if (多真.length) return `${名字} 多了字段 ${多真.join('、')}`;
  if (少.length) return `${名字} 少了字段 ${少.join('、')}`;
  return '';
}

/** 造一条真数据，用来问形状。 */
async function 造一条() {
  const 存 = await 模块.存({ 作用域: { 存放地: 'gallery' }, 字节: Buffer.from('x'), 文件名: 'a.png', mime: 'image/png' });
  return 存;
}

(async () => {
  const 存 = await 造一条();

  const 列 = 模块.列({ 作用域: { 存放地: 'gallery' } });
  查('② 列 的出参字段', () => 差(列, 该有的字段.列, '列'));
  查('② 列 里条目描述符的字段', () => 差(列.条目[0], 该有的字段.条目, '条目'));
  查('② 引用 的字段', () => 差(列.条目[0].引用, 该有的字段.引用, '引用'));
  查('② 引用.作用域 的字段', () => {
    const 期 = ['存放地', '会话ID'];
    const 多 = Object.keys(列.条目[0].引用.作用域).filter((k) => !期.includes(k));
    return 多.length ? `作用域多了字段 ${多.join('、')}` : '';
  });

  查('② 取详情 的出参字段', () => 差(模块.取详情({ 引用: 存.引用 }), 该有的字段.取详情, '取详情'));
  查('② 取内容 的出参字段', () => 差(模块.取内容({ 引用: 存.引用 }), 该有的字段.取内容, '取内容'));
  查('② 取地址 的出参字段', () => 差(模块.取地址({ 引用: 存.引用 }), 该有的字段.取地址, '取地址'));
  查('② 存 的出参与 取详情 同形', () => 差(存, 该有的字段.取详情, '存'));
  const 改 = await 模块.改({ 引用: 存.引用, 显示名: 'x' });
  查('② 改 的出参字段', () => 差(改, 该有的字段.取详情, '改'));
  const 体检 = await 模块.维护({ 动作: '报告' });
  查('② 维护.报告 的出参字段', () => 差(体检, 该有的字段.维护报告, '维护报告'));

  const 会话作用域 = { 存放地: 'session', 会话ID: 'apiNumber' };
  const 会话存 = await 模块.存({ 作用域: 会话作用域, 字节: Buffer.from('session'), 文件名: 'session.png' });
  查('② 会话存返回稳定图号', () => 会话存.图号 === 1 ? '' : `图号实际 ${会话存.图号}`);
  const 会话列 = await 模块.run('列会话图', { 作用域: 会话作用域 });
  查('② 列会话图的条目字段', () => 差(会话列.data.条目[0], ['引用', '标识', '修改时间', '完整', '图号', '文件名', '显示名', '宽', '高'], '列会话图条目'));
  const 按号 = await 模块.run('按图号取详情', { 作用域: 会话作用域, 图号: 1 });
  查('② 按图号查询返回图号', () => 按号.data.图号 === 1 ? '' : `图号实际 ${按号.data.图号}`);

  // ---------------------------------------------------------------- ③ 参数里不许有路径

 查('③ 对外参数里没有路径 / URL / 地址字段', () => {
    const 坏 = [];
    for (const 条 of 模块.describe()) {
      for (const 参 of 条.参数) {
        // 「取地址」这个动作名本身含"地址"，但它的**参数**里不许有
        if (/path|url|地址|路径|file/i.test(参)) 坏.push(`${条.动作}.${参}`);
      }
    }
    return 坏.length ? `这些参数名不该出现：${坏.join('、')}` : '';
  });

 查('③ 八个操作里没有"复制 / 移动"这类搬运动作', () => {
    const 禁 = /复制|移动|搬运|copy|move/i;
    const 坏 = 模块.actions.filter((x) => 禁.test(x));
    return 坏.length ? `不该有：${坏.join('、')}` : '';
  });

  // ---------------------------------------------------------------- ④ 端口与边界

  查('④ 端口缺方法就抛错', () => {
    let 抛了 = false;
    try { createImageModule({ port: { list: () => ({}) } }); } catch (_) { 抛了 = true; }
    return 抛了 ? '' : '少了方法却构造成功';
  });

  查('④ 既没根目录也没端口就抛错', () => {
    let 抛了 = false;
    try { createImageModule({}); } catch (_) { 抛了 = true; }
    return 抛了 ? '' : '什么都没给却构造成功';
  });

  查('④ core.js 不 require fs / path（核心不依赖盘）', () => {
    const 源 = fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8');
    const 命中 = /require\(\s*['"](?:node:)?(?:fs|path)['"]\s*\)/.exec(源);
    return 命中 ? `core.js 里出现了 ${命中[0]}` : '';
  });

  查('④ 只有适配器碰 fs / path（其余源文件都不碰）', () => {
    const 目录 = path.join(__dirname, '..');
    const 允许 = new Set(['adapter-file.js', 'adapter-memory.js']);
    const 坏 = [];
    for (const 名 of fs.readdirSync(目录)) {
      if (!名.endsWith('.js')) continue;
      if (允许.has(名)) continue;
      const 源 = fs.readFileSync(path.join(目录, 名), 'utf8');
      if (/require\(\s*['"](?:node:)?(?:fs|path)['"]\s*\)/.test(源)) 坏.push(名);
    }
    return 坏.length ? `这些文件碰了 fs/path：${坏.join('、')}` : '';
  });

  查(`④ 端口契约里那 ${PORT_METHODS.length} 个方法，内存实现与文件实现都有`, () => {
    const 两个 = { 内存: createMemoryAdapter(), 文件: require('../adapter-file.js').createFileAdapter({ root: path.join(require('os').tmpdir(), 'img-iface-probe') }) };
    const 坏 = [];
    for (const [名字, 实] of Object.entries(两个)) {
      for (const 方法 of PORT_METHODS) if (typeof 实[方法] !== 'function') 坏.push(`${名字}.${方法}`);
    }
    return 坏.length ? `缺方法：${坏.join('、')}` : '';
  });

  // ---------------------------------------------------------------- ⑤ 出口

  查('⑤ 出口冻住', () => {
    return Object.isFrozen(模块) ? '' : '模块出口没有 Object.freeze';
  });

  查('⑤ 不递内部件（没有 core / port / adapter 这些键）', () => {
    const 禁 = ['core', 'port', 'adapter', 'adapterFile', 'createCore', 'createFileAdapter'];
    const 坏 = 禁.filter((k) => k in 模块);
    return 坏.length ? `不该导出：${坏.join('、')}` : '';
  });

  查('⑤ 工作区能力只有一个 清空', () => {
    const 键 = Object.keys(模块.工作区能力());
    return 键.length === 1 && 键[0] === '清空' ? '' : `实际给了 ${键.join('、')}`;
  });

  // ---------------------------------------------------------------- ⑥ 删除形状（放最后，会真删）

  const 删 = await 模块.run('删', { 引用: 存.引用 });
  查('② 删 的出参字段', () => 差(删.data, 该有的字段.删, '删'));
  await 造一条();
  await 造一条();
  const 空 = await 模块.run('清空', { 作用域: { 存放地: 'gallery' } });
  查('② 清空 的出参字段（先造两条，再清掉两条）', () => {
    if (空.data.已删 !== 2) return `该清掉 2 条，实际 ${空.data.已删}`;
    return 差(空.data, 该有的字段.清空, '清空');
  });

  // ---------------------------------------------------------------- 汇总

  console.log('');
  for (const 名 of 通过) console.log(`  通过  ${名}`);
  for (const 名 of 失败) console.log(`  失败  ${名}`);
  console.log('');
  console.log(`接口校验 ${通过.length + 失败.length} 条：通过 ${通过.length}，失败 ${失败.length}`);
  if (失败.length) process.exitCode = 1;
})();
