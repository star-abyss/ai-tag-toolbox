'use strict';
/*
 * 功能自检 —— 世界书模块。
 *
 *   node test/run.js            全部
 *   node test/run.js 落点        只跑名字里含"落点"的
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const crypto = require('node:crypto');
let testBookId = 0;
const realRandomUUID = crypto.randomUUID;
crypto.randomUUID = () => String(++testBookId);
const { createWorldbookModule: createModule } = require('../index.js');
crypto.randomUUID = realRandomUUID;
function createWorldbookModule(options) {
  return createModule(options);
}
const { createMemoryAdapter } = require('../adapter-memory.js');
const { createFileAdapter } = require('../adapter-file.js');
const { 默认们 } = require('./默认们.js');

const 过滤 = process.argv[2] || '';

/** 拿内存默认开一个模块，并且把 翻译 请求启用 翻译 默认那本。 */
function 建内存() {
  const port = createMemoryAdapter({ 默认: 默认们() });
  return { 模块: createWorldbookModule({ port }), port };
}

function 建好用的() {
  const port = createMemoryAdapter({ 默认: 默认们() });
  const 建 = { 模块: createWorldbookModule({ port, 默认启用: { 翻译: ['$default:翻译'] } }), port };
  建.模块.书({ 动作: '换', 请求: '翻译', 启用: ['$default:翻译'] });
  return 建;
}

const 判据 = [];
const 试 = (名字, 做) => 判据.push({ 名字, 做 });

/** 建一个临时目录，跑完自己删。 */
const 临时目录们 = [];
function 临时(前缀) {
  const 一 = fs.mkdtempSync(path.join(os.tmpdir(), 前缀));
  临时目录们.push(一);
  return 一;
}
function 清临时() {
  while (临时目录们.length) fs.rmSync(临时目录们.pop(), { recursive: true, force: true });
}

试('V-63 请求书籍归属独立、可多选、同名分域且跨域引用失败', () => {
  const port = createMemoryAdapter({ 默认: 默认们() });
  const 默认启用 = { 主AI: ['$default:翻译'], 文生图: ['$default:文生图'], 翻译: ['$default:翻译'] };
  const 模块 = createWorldbookModule({ port, 默认启用 });
  const 主书 = 模块.书({ 动作: '新建', 请求: '主AI', 名字: '共用名字' });
  const 图书 = 模块.书({ 动作: '新建', 请求: '文生图', 名字: '共用名字' });
  const 翻译书 = 模块.书({ 动作: '导入', 请求: '翻译', 书: { name: '翻译书', entries: [] } });
  assert.equal(主书.名字, '共用名字');
  assert.equal(图书.名字, '共用名字');
  assert.deepEqual(模块.读({ 请求: '主AI' }).表.map((x) => x.标识).sort(), ['$default:翻译', 主书.标识].sort());
  assert.deepEqual(模块.表({ 请求: '文生图' }).map((x) => x.标识).sort(), ['$default:文生图', 图书.标识].sort());
  assert.equal(模块.读({ 请求: '翻译' }).启用.some((x) => x.标识 === 翻译书.标识), false, '归属不自动启用');
  assert.equal(模块.run('书', { 动作: '换', 请求: '主AI', 启用: [主书.标识, '$default:翻译'] }).ok, true);
  assert.equal(模块.run('书', { 动作: '换', 请求: '文生图', 启用: [图书.标识, '$default:文生图'] }).ok, true);
  assert.equal(模块.run('书', { 动作: '换', 请求: '主AI', 启用: [图书.标识] }).code, 'PROMPT_BOOK_SCOPE_MISMATCH');
  模块.存();
  assert.equal(模块.run('执行', { 请求: '主AI', 文本: '', 启用: [图书.标识] }).code, 'PROMPT_BOOK_SCOPE_MISMATCH');
  assert.equal(模块.run('测', { 请求: '主AI', 文本: '', 启用: [图书.标识] }).code, 'PROMPT_BOOK_SCOPE_MISMATCH');
  assert.equal(模块.读({ 书: 翻译书.标识 }).书.名字, '翻译书', '正文仍按标识读取');
  assert.equal(port.readState().value.books[主书.标识].scope, '主AI');
});

试('V-64 删除后的旧标识不会指向新书', () => {
  const { 模块 } = 建内存();
  const 旧书 = 模块.书({ 动作: '新建', 请求: '主AI', 名字: '旧书' });
  模块.书({ 动作: '删', 标识: 旧书.标识 });
  const 新书 = 模块.书({ 动作: '新建', 请求: '主AI', 名字: '新书' });
  assert.notEqual(新书.标识, 旧书.标识);
  const 旧引用 = 模块.run('书', { 动作: '换', 请求: '主AI', 启用: [旧书.标识] });
  assert.equal(旧引用.code, 'PROMPT_NO_SUCH_BOOK');
  assert.equal(模块.读({ 书: 新书.标识 }).书.名字, '新书');
});

试('V-65 显式空关键词且 always:false 保持不命中', () => {
  const { 模块 } = 建内存();
  const 新 = 模块.书({ 动作: '新建', 请求: '翻译', 名字: '条件书' });
  const 加 = 模块.条目({ 动作: '加', 书: 新.标识, 条目: { label: '暂未设置', text: '不应自动常驻', always: false, keys: [] } });
  assert.equal(加.条目.always, false);
  assert.deepEqual(加.条目.keys, []);
  模块.书({ 动作: '换', 请求: '翻译', 启用: [新.标识] });
  assert.deepEqual(模块.测({ 请求: '翻译', 文本: '' }).命中, []);
  模块.条目({ 动作: '改', 书: 新.标识, 标识: 加.条目.id, 条目: { always: false, keys: [] } });
  assert.equal(模块.读({ 书: 新.标识 }).书.条目[0].always, false, '同次给出 false 与空条件仍保持不命中');
  assert.deepEqual(模块.测({ 请求: '翻译', 文本: '' }).命中, []);
  模块.条目({ 动作: '改', 书: 新.标识, 标识: 加.条目.id, 条目: { keys: [] } });
  assert.equal(模块.读({ 书: 新.标识 }).书.条目[0].always, true, '仅在显式改为常驻时恢复常驻');
});

// ================================================================ 一、请求与书

试('V-1 表列出只读默认，按名字排序，每行标出是不是本子', () => {
  const { 模块 } = 建内存();
  const 表 = 模块.表();
  assert.strictEqual(表.length, 3);
  const 名字 = 表.map((x) => x.名字);
  assert.deepStrictEqual(名字, [...名字].sort((a, b) => a.localeCompare(b, 'zh')));
  for (const 一行 of 表) {
    assert.strictEqual(一行.是本子, true);
    assert.strictEqual(一行.存在, true);
  }
  assert.strictEqual(表.find((x) => x.标识 === '$default:翻译').条目数, 3);
});

试('V-2 名字是名字，与标识是两件事', () => {
  const { 模块 } = 建内存();
  const 一行 = 模块.表().find((x) => x.标识 === '$default:翻译');
  assert.strictEqual(一行.名字, '翻译');
  assert.strictEqual(一行.标识, '$default:翻译');
});

试('V-3 不认识的名字不回错，交回空；书的名字就是请求的名字，代码里没有清单', () => {
  const { 模块 } = 建内存();
  const 出 = 模块.run('执行', { 请求: '没这个名字', 文本: '随便什么' });
  assert.strictEqual(出.ok, true, 出.reason);
  assert.deepStrictEqual(出.data, { 请求: '没这个名字', 书: [], 命中: [] });
});

试('V-4 一本书都不启用 ⇒ 交回空，不是失败', () => {
  const { 模块 } = 建内存();
  const 出 = 模块.run('执行', { 请求: '翻译', 文本: '中文', 启用: [] });
  assert.strictEqual(出.ok, true, 出.reason);
  assert.deepStrictEqual(出.data.书, []);
  assert.deepStrictEqual(出.data.命中, []);
});

试('V-5 启用可以几本：主副同构，只是列表里有几个元素', () => {
  const port = createMemoryAdapter({ 默认: 默认们() });
  const 模块 = createWorldbookModule({ port, 默认启用: { 翻译: ['$default:翻译'] } });
  模块.书({ 动作: '新建', 请求: '翻译', 名字: '自建' });
  模块.书({ 动作: '换', 请求: '翻译', 启用: ['$default:翻译', 'wb1'] });
  模块.存();
  const 出 = 模块.执行({ 请求: '翻译', 文本: '' });
  assert.deepStrictEqual(出.书.map((x) => x.标识), ['$default:翻译', 'wb1']);
  assert.deepStrictEqual(出.书.map((x) => x.名字), ['翻译', '自建']);
});

试('V-6 换要给一串；給不认识的标识报 PROMPT_NO_SUCH_BOOK 且不动状态', () => {
  const 建 = 建好用的();
  const 前 = 建.模块.读({ 请求: '翻译' }).启用.map((x) => x.标识);
  const 错 = 建.模块.run('书', { 动作: '换', 请求: '翻译', 启用: ['wb99'] });
  assert.strictEqual(错.ok, false);
  assert.ok(错.reason.includes('PROMPT_NO_SUCH_BOOK'), 错.reason);
  assert.deepStrictEqual(建.模块.读({ 请求: '翻译' }).启用.map((x) => x.标识), 前);

  const 不是串 = 建.模块.run('书', { 动作: '换', 请求: '翻译', 启用: 'wb1' });
  assert.strictEqual(不是串.ok, false);
  assert.ok(不是串.reason.includes('PROMPT_BAD_ARGUMENT'), 不是串.reason);
});

试('V-7 启用列表去掉重复，次序照给的次序', () => {
  const port = createMemoryAdapter({ 默认: 默认们() });
  const 模块 = createWorldbookModule({ port, 默认启用: { 翻译: ['$default:识图', '$default:翻译'] } });
  模块.书({ 动作: '换', 请求: '翻译', 启用: ['$default:识图', '$default:翻译', '$default:识图'] });
  assert.deepStrictEqual(模块.读({ 请求: '翻译' }).启用.map((x) => x.标识), ['$default:识图', '$default:翻译']);
});

试('V-8 用户书不能跨请求启用；删除会从所属请求的启用列表里消失', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '新建', 请求: '翻译', 名字: '甲' });
  assert.equal(模块.run('书', { 动作: '换', 请求: '识图', 启用: ['wb1'] }).code, 'PROMPT_BOOK_SCOPE_MISMATCH');
  模块.书({ 动作: '换', 请求: '翻译', 启用: ['wb1'] });
  模块.书({ 动作: '删', 标识: 'wb1' });
  assert.deepStrictEqual(模块.读({ 请求: '翻译' }).启用, []);
  assert.deepStrictEqual(模块.读({ 请求: '识图' }).启用, []);
  assert.strictEqual(模块.表().some((x) => x.标识 === 'wb1'), false);
});

// ================================================================ 二、条目

试('V-9 加：条目自己带的 id 照用（不撞号）；没带才由程序发', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '新建', 请求: '翻译', 名字: '甲' });
  const 甲 = 模块.run('条目', { 动作: '加', 书: 'wb1', 条目: { id: 'e9', label: '一', text: '1' } });
  const 乙 = 模块.run('条目', { 动作: '加', 书: 'wb1', 条目: { id: 'e1', label: '二', text: '2' } });
  assert.strictEqual(甲.data.条目.id, 'e9', '带进来的号照用');
  assert.strictEqual(乙.data.条目.id, 'e1', '带进来的号照用');
  const 丙 = 模块.run('条目', { 动作: '加', 书: 'wb1', 条目: { label: '三', text: '3' } });
  assert.strictEqual(丙.data.条目.id, 'e2', '没带号就发一个没被占的');
  assert.deepStrictEqual(模块.读({ 书: 'wb1' }).书.条目.map((x) => x.id), ['e9', 'e1', 'e2']);
});

试('V-10 改：只改给进来的那几项，id 改不动', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '新建', 请求: '翻译', 名字: '甲' });
  模块.条目({ 动作: '加', 书: 'wb1', 条目: { label: '一', text: '1' } });
  模块.条目({ 动作: '改', 书: 'wb1', 标识: 'e1', 条目: { id: 'e99', label: '改过', text: '2' } });
  const 一条 = 模块.读({ 书: 'wb1' }).书.条目[0];
  assert.strictEqual(一条.id, 'e1');
  assert.strictEqual(一条.label, '改过');
  assert.strictEqual(一条.text, '2');
  assert.strictEqual(一条.always, true);
});

试('V-11 恒常忽略条件，切换方式保留已填写关键词', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '新建', 请求: '翻译', 名字: '甲' });
  模块.条目({ 动作: '加', 书: 'wb1', 条目: { label: '一', text: '1', keys: ['龙'] } });
  const 读一条 = () => 模块.读({ 书: 'wb1' }).书.条目[0];

  assert.strictEqual(读一条().always, false);
  assert.deepStrictEqual(读一条().keys, ['龙']);

  // 恒常模式保留条件。
  模块.条目({ 动作: '改', 书: 'wb1', 标识: 'e1', 条目: { always: true } });
  assert.strictEqual(读一条().always, true);
  assert.deepStrictEqual(读一条().keys, ['龙']);
  模块.存(); 模块.重读();
  assert.deepStrictEqual(读一条().keys, ['龙']);
  assert.equal(读一条().always, true);

  // 给词 ⇒ 按词空不空定恒常
  模块.条目({ 动作: '改', 书: 'wb1', 标识: 'e1', 条目: { keys: '龙, dragon' } });
  assert.strictEqual(读一条().always, false);
  assert.deepStrictEqual(读一条().keys, ['龙', 'dragon']);

  // 词清空 ⇒ 回到恒常
  模块.条目({ 动作: '改', 书: 'wb1', 标识: 'e1', 条目: { keys: [] } });
  assert.strictEqual(读一条().always, true);
  assert.deepStrictEqual(读一条().keys, []);

  // 只说不恒常、不给词 ⇒ 不恒常又没词
  模块.条目({ 动作: '改', 书: 'wb1', 标识: 'e1', 条目: { always: false } });
  assert.strictEqual(读一条().always, false);
  assert.deepStrictEqual(读一条().keys, []);
});

试('V-12 停用的条目留在书里，但不参与', () => {
  const 建 = 建好用的();
  建.模块.存();
  assert.strictEqual(建.模块.执行({ 请求: '翻译', 文本: '' }).命中.length, 1);
  建.模块.条目({ 动作: '改', 书: '$default:翻译', 标识: 'e1', 条目: { enabled: false } });
  assert.strictEqual(建.模块.读({ 书: '$default:翻译' }).书.条目.length, 3);
});

试('V-13 删与移；越界报 PROMPT_BAD_ARGUMENT', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '新建', 请求: '翻译', 名字: '甲' });
  for (const 名 of ['一', '二', '三']) 模块.条目({ 动作: '加', 书: 'wb1', 条目: { label: 名, text: 名 } });

  模块.条目({ 动作: '移', 书: 'wb1', 标识: 'e3', 方向: '上' });
  assert.deepStrictEqual(模块.读({ 书: 'wb1' }).书.条目.map((x) => x.label), ['一', '三', '二']);

  模块.条目({ 动作: '移', 书: 'wb1', 标识: 'e1', 到: 2 });
  assert.deepStrictEqual(模块.读({ 书: 'wb1' }).书.条目.map((x) => x.label), ['三', '二', '一']);

  const 越界 = 模块.run('条目', { 动作: '移', 书: 'wb1', 标识: 'e1', 到: 9 });
  assert.strictEqual(越界.ok, false);
  assert.ok(越界.reason.includes('PROMPT_BAD_ARGUMENT'), 越界.reason);

  const 删 = 模块.run('条目', { 动作: '删', 书: 'wb1', 标识: 'e2' });
  assert.strictEqual(删.data.删了, 'e2');
  assert.deepStrictEqual(模块.读({ 书: 'wb1' }).书.条目.map((x) => x.id), ['e3', 'e1']);
});

试('V-14 错的条目 / 错的动作 / 缺参数都报得出来', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '新建', 请求: '翻译', 名字: '甲' });
  模块.条目({ 动作: '加', 书: 'wb1', 条目: { text: '在' } });
  for (const [参数, 码] of [
    [{ 动作: '改', 书: 'wb1', 标识: 'e99', 条目: { text: 'x' } }, 'PROMPT_NO_SUCH_ENTRY'],
    [{ 动作: '没有这个动作', 书: 'wb1' }, 'PROMPT_BAD_ARGUMENT'],
    [{ 动作: '加', 书: 'wb99' }, 'PROMPT_NO_SUCH_BOOK'],
    [{ 动作: '移', 书: 'wb1', 标识: 'e1' }, 'PROMPT_BAD_ARGUMENT'],
  ]) {
    const 出 = 模块.run('条目', 参数);
    assert.strictEqual(出.ok, false, JSON.stringify(参数));
    assert.ok(出.reason.includes(码), `${JSON.stringify(参数)} → ${出.reason}`);
  }
  assert.deepStrictEqual(模块.读({ 书: 'wb1' }).书.条目.map((x) => x.text), ['在']);
});

试('V-15 条目上没有参数那类字段：温度 / 惩罚 / 上限一个都不留', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '新建', 请求: '翻译', 名字: '甲' });
  模块.条目({ 动作: '加', 书: 'wb1', 条目: { label: '一', text: '1', temperature: 0.9, top_p: 0.5, max_tokens: 100 } });
  const 一条 = 模块.读({ 书: 'wb1' }).书.条目[0];
  assert.deepStrictEqual(
    Object.keys(一条).sort(),
    ['always', 'enabled', 'id', 'keys', 'label', 'text', '落点'].sort(),
  );
});

// ================================================================ 三、落点

试('V-16 五种落点都存得下，原样交出去', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '新建', 请求: '翻译', 名字: '甲' });
  const 落点们 = ['前', '后', '顶部', '底部', '按深度'];
  for (const 落点 of 落点们) 模块.条目({ 动作: '加', 书: 'wb1', 条目: { label: 落点, text: 落点, 落点 } });
  assert.deepStrictEqual(模块.读({ 书: 'wb1' }).书.条目.map((x) => x.落点), 落点们);
  模块.书({ 动作: '换', 请求: '翻译', 启用: ['wb1'] });
  模块.存();
  assert.deepStrictEqual(模块.执行({ 请求: '翻译', 文本: '' }).命中.map((x) => x.落点), 落点们);
});

试('V-17 落点缺省是 前；不认识的值按缺省算', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '新建', 请求: '翻译', 名字: '甲' });
  模块.条目({ 动作: '加', 书: 'wb1', 条目: { label: '不说', text: '1' } });
  模块.条目({ 动作: '加', 书: 'wb1', 条目: { label: '瞎说', text: '2', 落点: '不存在的槽' } });
  assert.deepStrictEqual(模块.读({ 书: 'wb1' }).书.条目.map((x) => x.落点), ['前', '前']);
});

试('V-18 深度与角色只在落点是 按深度 时才进存放形状', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '新建', 请求: '翻译', 名字: '甲' });
  const 前 = 模块.条目({ 动作: '加', 书: 'wb1', 条目: { label: '前', text: '1', 落点: '前', 深度: 3, 角色: '用户' } }).条目;
  assert.strictEqual('深度' in 前, false);
  assert.strictEqual('角色' in 前, false);

  const 深 = 模块.条目({ 动作: '加', 书: 'wb1', 条目: { label: '深', text: '2', 落点: '按深度', 深度: 3, 角色: '用户' } }).条目;
  assert.strictEqual(深.深度, 3);
  assert.strictEqual(深.角色, '用户');
});

试('V-19 落点是 按深度 时，深度缺省 4、角色缺省 系统', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '新建', 请求: '翻译', 名字: '甲' });
  const 一条 = 模块.条目({ 动作: '加', 书: 'wb1', 条目: { text: '1', 落点: '按深度' } }).条目;
  assert.strictEqual(一条.深度, 4);
  assert.strictEqual(一条.角色, '系统');
});

试('V-20 改落点：换到 按深度 才带上那两项，换回去就丢掉', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '新建', 请求: '翻译', 名字: '甲' });
  模块.条目({ 动作: '加', 书: 'wb1', 条目: { text: '1' } });
  模块.条目({ 动作: '改', 书: 'wb1', 标识: 'e1', 条目: { 落点: '按深度' } });
  let 一条 = 模块.读({ 书: 'wb1' }).书.条目[0];
  assert.strictEqual(一条.深度, 4);
  assert.strictEqual(一条.角色, '系统');

  模块.条目({ 动作: '改', 书: 'wb1', 标识: 'e1', 条目: { 落点: '后' } });
  一条 = 模块.读({ 书: 'wb1' }).书.条目[0];
  assert.strictEqual('深度' in 一条, false);
  assert.strictEqual('角色' in 一条, false);
});

试('V-21 交出去的那一条：落点是 按深度 才带 深度 与 角色，别的落点不带', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '新建', 请求: '翻译', 名字: '甲' });
  模块.条目({ 动作: '加', 书: 'wb1', 条目: { text: 'A', 落点: '前' } });
  模块.条目({ 动作: '加', 书: 'wb1', 条目: { text: 'B', 落点: '按深度', 深度: 1, 角色: '助手' } });
  模块.书({ 动作: '换', 请求: '翻译', 启用: ['wb1'] });
  模块.存();
  const [甲, 乙] = 模块.执行({ 请求: '翻译', 文本: '' }).命中;
  assert.deepStrictEqual(Object.keys(甲).sort(), ['书', '文本', '落点'].sort());
  assert.deepStrictEqual(Object.keys(乙).sort(), ['书', '文本', '落点', '深度', '角色'].sort());
  assert.strictEqual(乙.深度, 1);
  assert.strictEqual(乙.角色, '助手');
});

// ================================================================ 四、筛选

试('V-22 恒常条目不看文本也进', () => {
  const 建 = 建好用的();
  建.模块.存();
  assert.deepStrictEqual(建.模块.执行({ 请求: '翻译', 文本: '' }).命中.map((x) => x.文本), ['翻译常驻段']);
  assert.deepStrictEqual(建.模块.执行({ 请求: '翻译', 文本: '随便' }).命中.map((x) => x.文本), ['翻译常驻段']);
});

试('V-23 带条件的条目按文本进出，不分大小写，子串命中', () => {
  const 建 = 建好用的();
  建.模块.存();
  assert.deepStrictEqual(建.模块.执行({ 请求: '翻译', 文本: '这是中文' }).命中.map((x) => x.文本), ['翻译常驻段', '中文方向段']);
  assert.deepStrictEqual(建.模块.执行({ 请求: '翻译', 文本: 'ZH 大写' }).命中.map((x) => x.文本), ['翻译常驻段', '中文方向段']);
  assert.deepStrictEqual(建.模块.执行({ 请求: '翻译', 文本: 'english only' }).命中.map((x) => x.文本), ['翻译常驻段']);
});

试('V-24 停用与空正文都不参与', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '新建', 请求: '翻译', 名字: '甲' });
  模块.条目({ 动作: '加', 书: 'wb1', 条目: { text: '在', 落点: '前' } });
  模块.条目({ 动作: '加', 书: 'wb1', 条目: { text: '停用的', enabled: false } });
  模块.条目({ 动作: '加', 书: 'wb1', 条目: { text: '   ' } });
  模块.条目({ 动作: '加', 书: 'wb1', 条目: { text: '' } });
  模块.书({ 动作: '换', 请求: '翻译', 启用: ['wb1'] });
  模块.存();
  assert.deepStrictEqual(模块.执行({ 请求: '翻译', 文本: '' }).命中.map((x) => x.文本), ['在']);
});

试('V-25 一本书都不命中 ⇒ 空，不是失败；空书也是空', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '新建', 请求: '翻译', 名字: '空的' });
  模块.书({ 动作: '换', 请求: '翻译', 启用: ['wb1'] });
  模块.存();
  const 出 = 模块.run('执行', { 请求: '翻译', 文本: '' });
  assert.strictEqual(出.ok, true, 出.reason);
  assert.deepStrictEqual(出.data.命中, []);
});

试('V-26 交出去的那一条带它来自哪本书', () => {
  const port = createMemoryAdapter({ 默认: 默认们() });
  const 模块 = createWorldbookModule({ port, 默认启用: { 翻译: ['$default:翻译', '$default:识图'] } });
  模块.书({ 动作: '换', 请求: '翻译', 启用: ['$default:翻译', '$default:识图'] });
  模块.存();
  const 出 = 模块.执行({ 请求: '翻译', 文本: '' });
  assert.deepStrictEqual(出.命中.map((x) => x.书), ['$default:翻译', '$default:识图']);
});

试('V-27 命中按书的启用次序、每本之内按数组顺序', () => {
  const port = createMemoryAdapter({ 默认: 默认们() });
  const 模块 = createWorldbookModule({ port, 默认启用: { 翻译: ['$default:识图'] } });
  模块.书({ 动作: '新建', 请求: '翻译', 名字: '乙' });
  模块.条目({ 动作: '加', 书: 'wb1', 条目: { text: '乙一' } });
  模块.条目({ 动作: '加', 书: 'wb1', 条目: { text: '乙二' } });
  模块.书({ 动作: '换', 请求: '翻译', 启用: ['wb1', '$default:识图'] });
  模块.存();
  assert.deepStrictEqual(模块.执行({ 请求: '翻译', 文本: '' }).命中.map((x) => x.文本), ['乙一', '乙二', '识图常驻段']);
});

// ================================================================ 五、导入

试('V-28 导入酒馆形状：读顺序、启用位、条件、落点、深度、角色', () => {
  const { 模块 } = 建内存();
  const 酒馆 = {
    name: '某本世界书',
    entries: {
      0: { uid: 0, key: ['龙', 'dragon'], comment: '龙的设定', content: '龙的内容', constant: false, disable: false, position: 4, depth: 2, role: 'user' },
      1: { uid: 1, key: [], comment: '总则', content: '总则内容', constant: true, disable: true, position: 1 },
    },
  };
  const 进 = 模块.run('书', { 动作: '导入', 请求: '翻译', 书: 酒馆 });
  assert.strictEqual(进.ok, true, 进.reason);
  assert.strictEqual(进.data.标识, 'wb1');
  assert.strictEqual(进.data.名字, '某本世界书');

  const 条目们 = 模块.读({ 书: 'wb1' }).书.条目;
  assert.deepStrictEqual(条目们.map((x) => x.id), ['e1', 'e2']);
  assert.deepStrictEqual(条目们[0], {
    id: 'e1', label: '龙的设定', text: '龙的内容', always: false, keys: ['龙', 'dragon'], enabled: true,
    落点: '按深度', 深度: 2, 角色: '用户',
  });
  assert.strictEqual(条目们[1].always, true);
  assert.deepStrictEqual(条目们[1].keys, []);
  assert.strictEqual(条目们[1].enabled, false);
  assert.strictEqual(条目们[1].落点, '后');
});

试('V-29 酒馆的 position 2 / 3 / 5 / 6 / 7 都搬进来，往返认得出', () => {
  const { 模块 } = 建内存();
  const 酒馆 = {
    name: '位置',
    entries: [0, 1, 2, 3, 4, 5, 6, 7].map((position) => ({ position, content: `p${position}` })),
  };
  模块.书({ 动作: '导入', 请求: '翻译', 书: 酒馆 });
  assert.deepStrictEqual(
    模块.读({ 书: 'wb1' }).书.条目.map((x) => x.落点),
    ['前', '后', '顶部', '底部', '按深度', '扩展顶部', '扩展底部', '出口'],
  );
});

试('V-30 导入：名字缺省用书自己的名字；顶层没有就看 originalData', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '导入', 请求: '翻译', 书: { entries: [], originalData: { name: '原名在这' } } });
  assert.strictEqual(模块.读({ 书: 'wb1' }).书.名字, '原名在这');
  模块.书({ 动作: '导入', 请求: '翻译', 书: { entries: [] } });
  assert.strictEqual(模块.读({ 书: 'wb2' }).书.名字, '未命名世界书');
});

试('V-31 导入：JSON 坏 / 没有 entries 都报 PROMPT_BAD_WORLDBOOK，且不动状态', () => {
  const { 模块 } = 建内存();
  const 前 = 模块.表().length;
  for (const 内容 of ['{这不是 json', '{"name":"甲"}', '[1,2,3]']) {
    const 出 = 模块.run('书', { 动作: '导入', 请求: '翻译', 内容 });
    assert.strictEqual(出.ok, false, 内容);
    assert.ok(出.reason.includes('PROMPT_BAD_WORLDBOOK'), 出.reason);
  }
  assert.strictEqual(模块.表().length, 前);
  assert.deepStrictEqual(模块.读({ 请求: '翻译' }).启用, []);
});

试('V-32 导入：条目带的 id 照用；没带的才发一个，同书之内不撞号', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '导入', 请求: '翻译', 书: { name: '甲', entries: [{ id: 'e9', text: 'A' }, { text: 'B' }, { id: 'e9', text: 'C' }] } });
  assert.deepStrictEqual(模块.读({ 书: 'wb1' }).书.条目.map((x) => x.id), ['e9', 'e1', 'e2']);
});

试('V-33 导入与新建撞名自动加号，绝不覆盖', () => {
  const { 模块 } = 建内存();
  const 一 = 模块.书({ 动作: '导入', 请求: '翻译', 书: { name: '甲', entries: [{ text: 'A' }] } });
  const 二 = 模块.书({ 动作: '导入', 请求: '翻译', 书: { name: '甲', entries: [{ text: 'B' }] } });
  const 三 = 模块.书({ 动作: '导入', 请求: '翻译', 书: { name: '甲', entries: [{ text: 'C' }] } });
  assert.deepStrictEqual([一.名字, 二.名字, 三.名字], ['甲', '甲 2', '甲 3']);
  assert.deepStrictEqual([一.标识, 二.标识, 三.标识], ['wb1', 'wb2', 'wb3']);
  assert.strictEqual(模块.读({ 书: 'wb1' }).书.条目[0].text, 'A');
  assert.strictEqual(模块.读({ 书: 'wb2' }).书.条目[0].text, 'B');
  assert.strictEqual(模块.表().length, 3 + 3);
});

试('V-34 导入 / 新建给请求只设置归属，不自动启用', () => {
  const { 模块 } = 建内存();
  模块.书({ 动作: '导入', 请求: '翻译', 书: { name: '甲', entries: [] } });
  模块.书({ 动作: '新建', 名字: '无人认领' });
  assert.deepStrictEqual(模块.读({ 请求: '翻译' }).启用, []);
  assert.equal(模块.读({ 请求: '翻译' }).表.find((x) => x.标识 === 'wb1').请求, '翻译');
  assert.deepStrictEqual(模块.读({ 请求: '识图' }).启用, []);
  assert.strictEqual(模块.表().some((x) => x.名字 === '无人认领'), true);
});

// ================================================================ 六、往返

试('V-35 导出：给标识，交回 名字 与 内容；内容是一份能再导入的世界书', () => {
  const { 模块 } = 建内存();
  const 出 = 模块.run('书', { 动作: '导出', 标识: '$default:翻译' });
  assert.strictEqual(出.ok, true, 出.reason);
  assert.strictEqual(出.data.名字, '翻译');
  const 解析 = JSON.parse(出.data.内容);
  assert.deepStrictEqual(Object.keys(解析).sort(), ['entries', 'name']);
  assert.strictEqual(解析.entries.length, 3);
  assert.strictEqual(解析.entries[0].落点, '前');
  assert.strictEqual(解析.entries[0].id, 'e1');
});

试('V-36 默认可以导出；导出不改动默认（一个字段都没动）', () => {
  const { 模块 } = 建内存();
  const 前 = 模块.读({ 书: '$default:翻译' }).书.条目;
  模块.书({ 动作: '导出', 标识: '$default:翻译' });
  assert.deepStrictEqual(模块.读({ 书: '$default:翻译' }).书.条目, 前);
});

试('V-37 导出 → 导入 → 语义相同（条目逐项对得上）', () => {
  const { 模块 } = 建内存();
  const 导 = 模块.书({ 动作: '导出', 标识: '$default:文生图' });
  const 进 = 模块.书({ 动作: '导入', 请求: '翻译', 内容: 导.内容 });
  assert.strictEqual(进.名字, '文生图');
  const 原 = 模块.读({ 书: '$default:文生图' }).书.条目;
  const 新 = 模块.读({ 书: 进.标识 }).书.条目;
  assert.deepStrictEqual(新, 原);
  assert.strictEqual(JSON.stringify(新), JSON.stringify(原));
});

试('V-38 导出 → 导入 之后再导出：两次的内容逐字相同', () => {
  const { 模块 } = 建内存();
  const 一 = 模块.书({ 动作: '导出', 标识: '$default:文生图' }).内容;
  const 进 = 模块.书({ 动作: '导入', 请求: '翻译', 内容: 一 });
  const 二 = 模块.书({ 动作: '导出', 标识: 进.标识 }).内容;
  assert.strictEqual(二, 一);
});

试('V-39 用户书与默认重名是允许的：两个标识不同，界面上分得开', () => {
  const 建 = 建内存();
  const 进 = 建.模块.书({ 动作: '导入', 请求: '翻译', 内容: 建.模块.书({ 动作: '导出', 标识: '$default:翻译' }).内容 });
  assert.strictEqual(进.名字, '翻译');
  assert.strictEqual(建.模块.读({ 书: 进.标识 }).书.是本子, false);
  assert.strictEqual(建.模块.读({ 书: 进.标识 }).书.名字, '翻译');
  assert.strictEqual(建.模块.读({ 书: '$default:翻译' }).书.是本子, true);

  // 同名两本并列在表里
  const 同名 = 建.模块.表().filter((x) => x.名字 === '翻译');
  assert.strictEqual(同名.length, 2);
  assert.deepStrictEqual(同名.map((x) => x.是本子).sort(), [false, true]);

  // 存下去再打开，两本都还在
  建.模块.存();
  const 再开 = createWorldbookModule({ port: 建.port });
  assert.strictEqual(再开.表().filter((x) => x.名字 === '翻译').length, 2);
  assert.strictEqual(再开.读({ 书: '$default:翻译' }).书.是本子, true);
  assert.strictEqual(再开.读({ 书: 'wb1' }).书.是本子, false);
});

试('V-40 导入进来的那份算用户的：能改名、能改条目、能删', () => {
  const { 模块 } = 建内存();
  const 进 = 模块.书({ 动作: '导入', 请求: '翻译', 内容: 模块.书({ 动作: '导出', 标识: '$default:翻译' }).内容 });
  const 条目数 = 模块.读({ 书: 进.标识 }).书.条目.length;
  assert.strictEqual(条目数, 3);

  模块.书({ 动作: '改名', 标识: 进.标识, 名字: '我的翻译' });
  assert.strictEqual(模块.读({ 书: 进.标识 }).书.名字, '我的翻译');

  模块.条目({ 动作: '加', 书: 进.标识, 条目: { text: '自己加的' } });
  assert.strictEqual(模块.读({ 书: 进.标识 }).书.条目.length, 条目数 + 1);

  模块.书({ 动作: '删', 标识: 进.标识 });
  assert.strictEqual(模块.表().some((x) => x.标识 === 进.标识), false);
  assert.deepStrictEqual(模块.读({ 请求: '翻译' }).启用, []);
});

// ================================================================ 七、装配

试('V-41 端口缺方法即抛，并说出缺哪个', () => {
  assert.throws(() => createWorldbookModule({ port: { readState: () => ({ state: 'missing' }) } }), /writeState/);
  assert.throws(() => createWorldbookModule({ port: {} }), /端口不合格/);
});

试('V-42 端口或位置都不给即抛；根目录只认这一个名字，没有 root / data 之类的别名', () => {
  assert.throws(() => createWorldbookModule({}), /PROMPT_BAD_ARGUMENT/);
  assert.throws(() => createWorldbookModule({ 根目录: '', 默认目录: 'x' }), /PROMPT_BAD_ARGUMENT/);
  assert.throws(() => createWorldbookModule({ 根目录: 'x', 默认目录: '' }), /PROMPT_BAD_ARGUMENT/);
  const 根 = 临时('wb-');
  for (const 别名 of ['root', 'data', '位置']) {
    assert.throws(() => createWorldbookModule({ [别名]: 根, 默认目录: path.join(__dirname, '../assets/世界书') }), /PROMPT_BAD_ARGUMENT/);
  }
});

试('V-43 文件适配器：读的三态分得开', () => {
  const 根 = 临时('wb-根-');
  const 默认目录 = 临时('wb-默认-');
  fs.writeFileSync(path.join(默认目录, '翻译.json'), '{这不是 json', 'utf8');
  fs.writeFileSync(path.join(默认目录, '坏的.json'), JSON.stringify({ name: '坏' }), 'utf8');
  const 口 = createFileAdapter({ root: 根, 默认目录 });

  assert.deepStrictEqual(口.readState(), { state: 'missing' });
  const 列 = 口.listDefaults();
  assert.deepStrictEqual([...列.items.map((x) => x.名字)].sort(), ['坏的', '翻译'].sort());
  assert.strictEqual(列.items.find((x) => x.名字 === '翻译').state, 'unreadable');
  assert.strictEqual(列.items.find((x) => x.名字 === '坏的').条目数, 0);
  assert.strictEqual(口.readDefault('翻译').state, 'unreadable');
  assert.strictEqual(口.readDefault('没有这份').state, 'missing');
  assert.strictEqual(口.readDefault('../跑出去').state, 'missing');
  assert.strictEqual(口.readDefault('').state, 'missing');
});

试('V-44 文件适配器：写进去读得回来，一个文件装全部', () => {
  const 根 = 临时('wb-根-');
  const 默认目录 = path.join(__dirname, '../assets/世界书');
  const 一 = createWorldbookModule({ 根目录: 根, 默认目录 });
  一.书({ 动作: '导入', 请求: '翻译', 书: { name: '甲', entries: [{ text: 'A', 落点: '后' }] } });
  一.书({ 动作: '新建', 请求: '识图', 名字: '乙' });
  assert.deepStrictEqual(一.存(), { 脏: false });
  const 二 = createWorldbookModule({ 根目录: 根, 默认目录 });
  assert.deepStrictEqual(二.读({ 请求: '翻译' }).启用, []);
  assert.deepStrictEqual(二.读({ 请求: '识图' }).启用, []);
  assert.deepStrictEqual(二.读({ 请求: '翻译' }).表.map((x) => x.标识), ['wb1']);
  assert.deepStrictEqual(二.读({ 请求: '识图' }).表.map((x) => x.标识), ['wb2']);
  assert.strictEqual(二.读({ 书: 'wb1' }).书.条目[0].落点, '后');
  assert.deepStrictEqual(fs.readdirSync(根), ['世界书.json']);
});

试('V-45 只读默认一个字节都不会被本模块改动', () => {
  const 目录 = path.join(__dirname, '../assets/世界书');
  const 前 = fs.readdirSync(目录).sort().map((名) => [名, fs.readFileSync(path.join(目录, 名), 'utf8')]);
  const { 模块 } = 建内存();
  模块.书({ 动作: '导出', 标识: '$default:翻译' });
  for (const 参数 of [
    { 动作: '改名', 标识: '$default:翻译', 名字: '改' },
    { 动作: '删', 标识: '$default:翻译' },
    { 动作: '导入', 内容: '{"entries":[]}' },
    { 动作: '新建', 名字: '甲' },
  ]) 模块.书(参数);
  for (const 动作 of ['加', '改', '删', '移']) 模块.条目({ 动作, 书: '$default:翻译', 标识: 'e1', 条目: { text: 'x' } });
  const 后 = fs.readdirSync(目录).sort().map((名) => [名, fs.readFileSync(path.join(目录, 名), 'utf8')]);
  assert.deepStrictEqual(后, 前);
});

// ================================================================ 八、草稿

试('V-46 改书名即时生效在草稿上；执行拿的是存过的那一份', () => {
  const { 模块 } = 建内存();
  const 进 = 模块.书({ 动作: '导入', 请求: '翻译', 内容: 模块.书({ 动作: '导出', 标识: '$default:翻译' }).内容 });
  assert.strictEqual(模块.读({ 请求: '翻译' }).脏, true);

  模块.书({ 动作: '改名', 标识: 进.标识, 名字: '草稿里改的' });
  assert.strictEqual(模块.读({ 书: 进.标识 }).书.名字, '草稿里改的');
  assert.deepStrictEqual(模块.执行({ 请求: '翻译', 文本: '', 启用: [] }).命中, []);

  模块.存();
  assert.strictEqual(模块.读({ 请求: '翻译' }).脏, false);
  assert.strictEqual(模块.读({ 书: 进.标识 }).书.名字, '草稿里改的');
});

试('V-47 测 与 执行 同形、不同份：测 看草稿，执行 看存档', () => {
  const { 模块 } = 建内存();
  const 进 = 模块.书({ 动作: '导入', 请求: '翻译', 书: { name: '甲', entries: [{ text: '甲一' }] } });
  模块.书({ 动作: '换', 请求: '翻译', 启用: [进.标识] });
  模块.存();

  模块.条目({ 动作: '加', 书: 进.标识, 条目: { text: '还没存的', 落点: '后' } });
  const 测 = 模块.测({ 请求: '翻译', 文本: '' });
  const 执 = 模块.执行({ 请求: '翻译', 文本: '' });
  assert.deepStrictEqual(测.命中.map((x) => x.文本), ['甲一', '还没存的']);
  assert.deepStrictEqual(执.命中.map((x) => x.文本), ['甲一']);
  assert.deepStrictEqual(Object.keys(测).sort(), Object.keys(执).sort());
  assert.deepStrictEqual(Object.keys(测.命中[0]).sort(), Object.keys(执.命中[0]).sort());
});

试('V-48 脏的判定：改动即脏，存了就干净，丢了也干净', () => {
  const 建 = 建好用的();
  assert.strictEqual(建.模块.读().脏, true);
  assert.deepStrictEqual(建.模块.存(), { 脏: false });
  assert.strictEqual(建.模块.读().脏, false);
  建.模块.书({ 动作: '新建', 请求: '翻译', 名字: '甲' });
  assert.strictEqual(建.模块.读().脏, true);
  assert.deepStrictEqual(建.模块.丢(), { 脏: false });
  assert.strictEqual(建.模块.表().some((x) => x.名字 === '甲'), false);
});

试('V-49 重读：端口变了，重读之后看得见', () => {
  const 根 = 临时('wb-根-');
  const 默认目录 = path.join(__dirname, '../assets/世界书');
  const 一 = createWorldbookModule({ 根目录: 根, 默认目录 });
  一.书({ 动作: '新建', 请求: '翻译', 名字: '甲' });
  一.存();

  const 二 = createWorldbookModule({ 根目录: 根, 默认目录 });
  二.书({ 动作: '新建', 请求: '翻译', 名字: '乙' });
  二.存();
  assert.strictEqual(二.读().表.some((x) => x.名字 === '甲'), true);

  // 一 那边看不见 乙，重读之后看得见
  assert.strictEqual(一.读().表.some((x) => x.名字 === '乙'), false);
  一.重读();
  assert.strictEqual(一.读().表.some((x) => x.名字 === '乙'), true);
});

试('V-50 存档读不懂 ⇒ 冻结写；丢与重读不写盘，照常可用；默认照常可用', () => {
  const 根 = 临时('wb-根-');
  fs.writeFileSync(path.join(根, '世界书.json'), '{"version":2,"subs":{},"books":{}}', 'utf8');
  const 模块 = createWorldbookModule({ 根目录: 根, 默认目录: path.join(__dirname, '../assets/世界书') });

  const 看 = 模块.读();
  assert.ok(看.冻结, '应当报冻结');
  assert.strictEqual(模块.表().length, 4);          // 默认照常列出来
  assert.strictEqual(模块.执行({ 请求: '翻译', 文本: '' }).命中.length, 0);

  for (const [动作, 参数] of [
    ['书', { 动作: '新建', 请求: '翻译', 名字: '甲' }],
    ['书', { 动作: '换', 请求: '翻译', 启用: ['$default:翻译'] }],
    ['条目', { 动作: '加', 书: 'wb1', 条目: { text: 'x' } }],
  ]) {
    const 出 = 模块.run(动作, 参数);
    assert.strictEqual(出.ok, false, JSON.stringify(参数));
    assert.ok(出.reason.includes('PROMPT_STATE_UNREADABLE'), 出.reason);
  }
  assert.strictEqual(模块.run('存').reason.includes('PROMPT_STATE_UNREADABLE'), true);
  assert.strictEqual(模块.run('丢').ok, true);
  assert.strictEqual(模块.run('重读').ok, true);
  // 端口里那份原样没动
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(根, '世界书.json'), 'utf8')).version, 2);
});

试('V-51 只读默认读不懂 ⇒ 报读不懂，不当成"没有这份"；确实没有的报"没有"', () => {
  const 根 = 临时('wb-根-');
  const 默认目录 = 临时('wb-默认-');
  fs.writeFileSync(path.join(默认目录, '翻译.json'), '{坏掉', 'utf8');
  const 模块 = createWorldbookModule({ 根目录: 根, 默认目录, 默认启用: { 翻译: ['$default:翻译'], 识图: ['$default:识图'] } });

  const 行 = 模块.表().find((x) => x.标识 === '$default:翻译');
  assert.strictEqual(行.读不懂, true);
  assert.strictEqual(行.存在, false);
  assert.strictEqual(行.条目数, 0);

  模块.书({ 动作: '换', 请求: '翻译', 启用: ['$default:翻译'] });
  模块.存();
  // 读不懂 ≠ 没有：存得下、启用得了，读它才报读不懂
  assert.strictEqual(模块.读({ 请求: '翻译' }).启用[0].存在, false);
  assert.strictEqual(模块.读({ 请求: '翻译' }).启用[0].读得懂, false);
  assert.strictEqual(模块.读({ 请求: '翻译' }).启用[0].名字, '翻译');

  const 出 = 模块.run('执行', { 请求: '翻译', 文本: '' });
  assert.strictEqual(出.ok, false);
  assert.ok(出.reason.includes('PROMPT_STATE_UNREADABLE'), 出.reason);
  assert.strictEqual(出.reason.includes('PROMPT_NO_SUCH_BOOK'), false, 出.reason);

  // 确实没有的那份：表里没有这一行，启用它会被当成不存在的书
  const 没 = 模块.run('书', { 动作: '换', 请求: '识图', 启用: ['$default:识图'] });
  assert.strictEqual(没.ok, false);
  assert.ok(没.reason.includes('PROMPT_NO_SUCH_BOOK'), 没.reason);
});

试('V-52 内存适配器跑得通同一套：核心不依赖盘', () => {
  const port = createMemoryAdapter({ 默认: 默认们() });
  const 模块 = createWorldbookModule({ port, 默认启用: { 翻译: ['$default:翻译'] } });
  模块.书({ 动作: '导入', 请求: '翻译', 内容: JSON.stringify({ name: '甲', entries: [{ text: 'A', 落点: '按深度', 深度: 1 }] }) });
  模块.书({ 动作: '换', 请求: '翻译', 启用: ['wb1'] });
  模块.存();
  assert.deepStrictEqual(模块.执行({ 请求: '翻译', 文本: '' }).命中, [
    { 文本: 'A', 落点: '按深度', 深度: 1, 角色: '系统', 书: 'wb1' },
  ]);
  assert.strictEqual(fs.existsSync('世界书.json'), false);
});

// ================================================================ 九、门面

试('V-53 动作表就是那十个，没有路径 / 地址这类参数', () => {
  const { 模块 } = 建内存();
  assert.deepStrictEqual(
    [...模块.actions].sort(),
    ['书', '丢', '存', '执行', '状态', '条目', '测', '读', '重读', '表'].sort(),
  );
  for (const 一条 of 模块.describe()) {
    for (const 参数 of 一条.参数) {
      assert.strictEqual(/路径|目录|地址|url|path/i.test(参数), false, `${一条.动作} 的参数里有路径：${参数}`);
    }
  }
});

试('V-54 出口冻住，不递内部件', () => {
  const { 模块 } = 建内存();
  assert.strictEqual(Object.isFrozen(模块), true);
  assert.strictEqual(Object.isFrozen(模块.actions), true);
  assert.strictEqual(Object.isFrozen(模块.ERR), true);
  for (const 名字 of ['core', 'port', 'adapter', 'worldbook', 'createCore', '空存档']) {
    assert.strictEqual(名字 in 模块, false, `不该递出 ${名字}`);
  }
});

试('V-55 run 给信封，直呼给数据或 null；理由写成 码: 人话', () => {
  const { 模块 } = 建内存();
  assert.strictEqual(模块.读({ 书: 'wb99' }), null);
  const 信封 = 模块.run('读', { 书: 'wb99' });
  assert.strictEqual(信封.ok, false);
  assert.strictEqual(信封.code, 'PROMPT_NO_SUCH_BOOK');
  assert.strictEqual(信封.reason, `PROMPT_NO_SUCH_BOOK: 没有这本书：wb99`);
  assert.strictEqual(模块.run('没有这个动作').code, 'PROMPT_BAD_ARGUMENT');
});

试('V-56 回执里没有 文本 这个字段；交回的是带落点的条目', () => {
  const 建 = 建好用的();
  建.模块.存();
  const 出 = 建.模块.执行({ 请求: '翻译', 文本: '中文' });
  assert.deepStrictEqual(Object.keys(出).sort(), ['书', '命中', '请求'].sort());
  assert.strictEqual(typeof 出.命中[0].文本, 'string');
  assert.strictEqual(typeof 出.命中[0].落点, 'string');
});

试('V-57 不给 请求 就报得出来（执行与测都不许闷着走）', () => {
  const { 模块 } = 建内存();
  for (const 动作 of ['执行', '测']) {
    const 出 = 模块.run(动作, { 文本: '随便' });
    assert.strictEqual(出.ok, false, 动作);
    assert.ok(出.reason.includes('PROMPT_BAD_ARGUMENT'), 出.reason);
  }
});

试('V-58 条目号过一趟盘不变：存了再读回来还是那些号，存完就干净', () => {
  const 根 = 临时('wb-号-');
  const 默认目录 = path.join(__dirname, '../assets/世界书');
  const 一 = createWorldbookModule({ 根目录: 根, 默认目录 });
  一.书({ 动作: '新建', 请求: '翻译', 名字: '甲' });
  一.条目({ 动作: '加', 书: 'wb1', 条目: { label: '一', text: 'A' } });
  一.条目({ 动作: '加', 书: 'wb1', 条目: { label: '二', text: 'B' } });
  一.条目({ 动作: '加', 书: 'wb1', 条目: { label: '三', text: 'C' } });
  一.条目({ 动作: '删', 书: 'wb1', 标识: 'e1' });
  assert.deepStrictEqual(一.读({ 书: 'wb1' }).书.条目.map((x) => x.id), ['e2', 'e3']);
  assert.deepStrictEqual(一.存(), { 脏: false }, '存完就该是干净的');

  const 二 = createWorldbookModule({ 根目录: 根, 默认目录 });
  const 条目 = 二.读({ 书: 'wb1' }).书.条目;
  assert.deepStrictEqual(条目.map((x) => x.id), ['e2', 'e3'], '过一趟盘，号不许重发');
  assert.strictEqual(二.读().脏, false);

  // 号还是原来的号：拿 e2 去改，改到的是第一条不是第二条（直呼式：成功给数据，失败给 null）
  const 改成 = 二.run('条目', { 动作: '改', 书: 'wb1', 标识: 'e2', 条目: { label: '改了' } });
  assert.ok(改成.ok, 改成.reason);
  const 结果 = 二.读({ 书: 'wb1' }).书.条目;
  assert.deepStrictEqual(结果.map((x) => x.id), ['e2', 'e3']);
  assert.strictEqual(结果[0].label, '改了');
  assert.strictEqual(结果[1].label, '三');
});

试('V-59 执行只认存档：草稿里删掉一本，不存就不影响执行', () => {
  const 建 = 建好用的();
  建.模块.存();
  const 前 = 建.模块.执行({ 请求: '翻译', 文本: '' });
  assert.ok(前.书.length > 0, '存档里那本要用上');

  // 只在草稿里删掉，不存
  建.模块.书({ 动作: '删', 标识: 前.书[0].标识 });
  const 后 = 建.模块.执行({ 请求: '翻译', 文本: '' });
  assert.deepStrictEqual(后.书, 前.书, '草稿动了，执行交出来的还是存过的那一份');
  assert.deepStrictEqual(后.命中, 前.命中);
});

试('V-60 注入的请求默认书用于读、测、执行，并以副本回执', () => {
  const port = createMemoryAdapter({ 默认: 默认们() });
  const 默认启用 = { '图像任务': ['$default:文生图'], '语言任务': ['$default:翻译'], '自定义请求': ['$default:识图'] };
  const 模块 = createWorldbookModule({ port, 默认启用 });

  const 全量 = 模块.读();
  assert.deepStrictEqual(全量.默认启用, 默认启用);
  assert.deepStrictEqual(模块.读({ 请求: '图像任务' }).默认启用, 默认启用, '请求读回也包含完整默认映射');
  全量.默认启用['图像任务'].pop();
  assert.deepStrictEqual(模块.读().默认启用, 默认启用, '回执修改不影响模块里的注入配置');
  assert.deepStrictEqual(模块.读({ 请求: '图像任务' }).启用.map((x) => x.标识), ['$default:文生图']);
  assert.deepStrictEqual(模块.测({ 请求: '图像任务', 文本: '' }).书.map((x) => x.标识), ['$default:文生图']);
  assert.deepStrictEqual(模块.执行({ 请求: '图像任务', 文本: '' }).命中.map((x) => x.文本), ['文生图常驻段', '深度段']);
  assert.deepStrictEqual(模块.执行({ 请求: '图像任务', 文本: '', 启用: [] }), { 请求: '图像任务', 书: [], 命中: [] }, '本次显式空数组覆盖请求默认');
  assert.deepStrictEqual(模块.读({ 请求: '语言任务' }).启用.map((x) => x.标识), ['$default:翻译']);
});

试('V-61 明确存空列表后重启仍停用，且不影响其他请求默认', () => {
  const 根 = 临时('wb-default-subs-');
  const 默认目录 = path.join(__dirname, '../assets/世界书');
  const 默认启用 = { '图像任务': ['$default:文生图'], '语言任务': ['$default:翻译'] };
  const 一 = createWorldbookModule({ port: createFileAdapter({ root: 根, 默认目录 }), 默认启用 });

  assert.strictEqual(fs.existsSync(path.join(根, '世界书.json')), false, '构造不会把注入默认写进存档');
  一.书({ 动作: '换', 请求: '图像任务', 启用: [] });
  一.存();
  const 存档 = JSON.parse(fs.readFileSync(path.join(根, '世界书.json'), 'utf8'));
  assert.deepStrictEqual(存档.subs['图像任务'].启用, []);
  assert.deepStrictEqual(存档.subs['语言任务'], undefined, '未修改的请求默认不写入存档');

  const 二 = createWorldbookModule({ port: createFileAdapter({ root: 根, 默认目录 }), 默认启用 });
  assert.deepStrictEqual(二.读({ 请求: '图像任务' }).启用, []);
  assert.deepStrictEqual(二.执行({ 请求: '图像任务', 文本: '' }), { 请求: '图像任务', 书: [], 命中: [] });
  assert.deepStrictEqual(二.读({ 请求: '语言任务' }).启用.map((x) => x.标识), ['$default:翻译']);
});

试('V-62 草稿选择覆盖注入默认但不影响执行；丢草稿恢复注入默认', () => {
  const port = createMemoryAdapter({ 默认: 默认们() });
  const 默认启用 = { '自定义请求': ['$default:文生图', '$default:识图'] };
  const 模块 = createWorldbookModule({ port, 默认启用 });

  模块.书({ 动作: '换', 请求: '自定义请求', 启用: ['$default:识图'] });
  assert.deepStrictEqual(模块.测({ 请求: '自定义请求', 文本: '' }).书.map((x) => x.标识), ['$default:识图']);
  assert.deepStrictEqual(模块.执行({ 请求: '自定义请求', 文本: '' }).书.map((x) => x.标识), ['$default:文生图', '$default:识图']);
  模块.丢();
  assert.deepStrictEqual(模块.读({ 请求: '自定义请求' }).启用.map((x) => x.标识), ['$default:文生图', '$default:识图']);
  assert.deepStrictEqual(模块.测({ 请求: '自定义请求', 文本: '' }).书.map((x) => x.标识), ['$default:文生图', '$default:识图']);
});

// ================================================================ 跑

function main() {
  let 过 = 0;
  const 失败 = [];
  for (const 一条 of 判据) {
    if (过滤 && !一条.名字.includes(过滤)) continue;
    testBookId = 0;
    try {
      一条.做();
      过 += 1;
      process.stdout.write(`  ok   ${一条.名字}\n`);
    } catch (error) {
      失败.push({ 名字: 一条.名字, 错误: error });
      process.stdout.write(`  FAIL ${一条.名字}\n`);
    }
  }
  清临时();
  process.stdout.write(`\n${过} 过 / ${失败.length} 失败\n`);
  for (const 一条 of 失败) {
    process.stdout.write(`\n--- ${一条.名字}\n${一条.错误 && 一条.错误.stack ? 一条.错误.stack : 一条.错误}\n`);
  }
  process.exit(失败.length ? 1 : 0);
}

main();
