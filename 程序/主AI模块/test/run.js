'use strict';
/*
 * 功能自检 —— 主AI模块。
 *
 *   node test/run.js            全部
 *   node test/run.js 工具        只跑名字里含"工具"的
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createMainAiModule } = require('../index.js');
const { createMemoryAdapter } = require('../adapter-memory.js');
const { createFileAdapter } = require('../adapter-file.js');
const { 假业务工具, 假默认预设, 建假默认目录 } = require('./假模块.js');

const 过滤 = process.argv[2] || '';

/** 拿内存适配器开一个模块。 */
function 建内存(选项 = {}) {
  const port = createMemoryAdapter({
    默认: 选项.默认 === undefined ? { 主AI: 假默认预设() } : 选项.默认,
    业务工具: 选项.业务工具 === undefined ? 假业务工具() : 选项.业务工具,
  });
  return { 模块: createMainAiModule({ port }), port };
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

const 默认标识 = '$默认:主AI';

试('V-63 主AI预设只返回和保存配置，身份流程与世界书由世界书模块统一管理', () => {
  const 默认 = {
    name: '主AI', 身份: '旧身份正文', 流程: '旧流程正文', worldbook: ['$default:旧书'],
    model: { 走: '默认链路', 模型: 'model-a' },
  };
  const { 模块, port } = 建内存({ 默认: { 主AI: 默认 } });
  const 字段 = ['身份', '流程', '世界书', 'worldbook'];
  const 不含正文 = 值 => { for (const 键 of 字段) assert.equal(键 in 值, false, `不再暴露 ${键}`); };

  不含正文(模块.执行({ 请求: '主AI' }));
  不含正文(模块.读({ 预设: 默认标识 }).预设);
  const 默认导出 = JSON.parse(模块.预设({ 动作: '导出', 预设: 默认标识 }).内容);
  不含正文(默认导出);
  assert.deepStrictEqual(默认导出.model, 默认.model);

  const 预设参数 = 模块.describe().find(row => row.动作 === '预设').参数;
  for (const 键 of 字段) assert.equal(预设参数.includes(键), false, `预设动作不声明 ${键}`);
  const 新建 = 模块.预设({ 动作: '新建', 名字: '仅配置', 一套: { name: '仅配置', 身份: '不接收', 流程: '不接收', worldbook: ['不接收'], model: { 走: '用户链路', 模型: 'model-b' } } });
  模块.预设({ 动作: '改', 预设: 新建.标识, 身份: '不保存', 流程: '不保存', worldbook: ['不保存'] });
  模块.存();
  const 用户数据 = port.readState().value.presets[新建.标识];
  for (const 键 of 字段) assert.equal(键 in 用户数据, false, `用户存档不含 ${键}`);
  assert.deepStrictEqual(Object.keys(用户数据).sort(), ['model', 'name', 'runtime', 'tools', 'toolsOrder']);
  不含正文(模块.执行({ 预设: 新建.标识 }));
  不含正文(JSON.parse(模块.预设({ 动作: '导出', 预设: 新建.标识 }).内容));
});

// ================================================================ 一、请求与预设

试('V-1 表列出只读默认，按名字排序，每行标出是不是本子', () => {
  const { 模块 } = 建内存();
  const 表 = 模块.表();
  assert.strictEqual(表.length, 1);
  assert.strictEqual(表[0].标识, 默认标识);
  assert.strictEqual(表[0].名字, '主AI');
  assert.strictEqual(表[0].是本子, true);
  assert.strictEqual(表[0].存在, true);
});

试('V-2 名字是名字，与标识是两件事', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '我的' });
  const 行 = 模块.表().find((x) => x.标识 === 'ps1');
  assert.strictEqual(行.名字, '我的');
  assert.strictEqual(行.是本子, false);
});

试('V-3 一个请求没记录启用 ⇒ 不报错，交回空', () => {
  const { 模块 } = 建内存();
  const 出 = 模块.读({ 请求: '没这个名字' });
  assert.deepStrictEqual(出.启用, []);
  assert.deepStrictEqual(模块.执行({ 请求: '没这个名字' }).预设.标识, 默认标识, '没启用过就用默认那套');
});

试('V-4 换要给一串；给不认识的标识报 PRESET_NO_SUCH_PRESET 且不动状态', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 请求: '主AI', 名字: '甲' });
  const 前 = 模块.读({ 请求: '主AI' }).启用.map((x) => x.标识);
  const 错 = 模块.run('预设', { 动作: '换', 请求: '主AI', 启用: ['ps99'] });
  assert.strictEqual(错.ok, false);
  assert.ok(错.reason.includes('PRESET_NO_SUCH_PRESET'), 错.reason);
  assert.deepStrictEqual(模块.读({ 请求: '主AI' }).启用.map((x) => x.标识), 前);

  const 不是串 = 模块.run('预设', { 动作: '换', 请求: '主AI', 启用: 'ps1' });
  assert.strictEqual(不是串.ok, false);
  assert.ok(不是串.reason.includes('PRESET_BAD_ARGUMENT'), 不是串.reason);
});

试('V-5 启用列表去掉重复，次序照给的次序', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  模块.预设({ 动作: '新建', 名字: '乙' });
  模块.预设({ 动作: '换', 请求: '主AI', 启用: ['ps2', 'ps1', 'ps2'] });
  assert.deepStrictEqual(模块.读({ 请求: '主AI' }).启用.map((x) => x.标识), ['ps2', 'ps1']);
});

试('V-6 删掉一套用户预设，它从所有请求的启用列表里一起消失', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 请求: '主AI', 名字: '甲' });
  模块.预设({ 动作: '换', 请求: '翻译', 启用: ['ps1'] });
  模块.预设({ 动作: '删', 预设: 'ps1' });
  assert.deepStrictEqual(模块.读({ 请求: '主AI' }).启用.map((x) => x.标识), []);
  assert.deepStrictEqual(模块.读({ 请求: '翻译' }).启用.map((x) => x.标识), []);
});

试('V-7 用户预设之间撞名自动加号；与只读默认重名是允许的', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  模块.预设({ 动作: '新建', 名字: '甲' });
  assert.deepStrictEqual(模块.表().filter((x) => !x.是本子).map((x) => x.名字), ['甲', '甲 2']);
  模块.预设({ 动作: '新建', 名字: '主AI' });
  assert.strictEqual(模块.表().filter((x) => x.名字 === '主AI').length, 2);
});

// ================================================================ 二、只读默认

试('V-8 默认只读：改名 / 删 / 改 / 加工具 / 改工具 全被拦', () => {
  const { 模块 } = 建内存();
  const 逐个 = [
    { 动作: '改名', 预设: 默认标识, 名字: 'X' },
    { 动作: '删', 预设: 默认标识 },
    { 动作: '改', 预设: 默认标识, model: { 模型: 'X' } },
  ];
  for (const 一个 of 逐个) {
    const 出 = 模块.run('预设', 一个);
    assert.strictEqual(出.ok, false, 一个.动作);
    assert.ok(出.reason.includes('PRESET_READONLY_PRESET'), 出.reason);
  }
  for (const 一个 of [
    { 动作: '加', 预设: 默认标识, 名字: 'tag_query' },
    { 动作: '改', 预设: 默认标识, 名字: 'tag_query', 启用: false },
    { 动作: '删', 预设: 默认标识, 名字: 'tag_query' },
    { 动作: '重置', 预设: 默认标识 },
  ]) {
    const 出 = 模块.run('工具', 一个);
    assert.strictEqual(出.ok, false, 一个.动作);
    assert.ok(出.reason.includes('PRESET_READONLY_PRESET'), 出.reason);
  }
});

试('V-9 默认那套只导出得出来，导得出它的正文', () => {
  const { 模块 } = 建内存();
  const 出 = 模块.预设({ 动作: '导出', 预设: 默认标识 });
  assert.strictEqual(出.名字, '主AI');
  const 对象 = JSON.parse(出.内容);
  assert.deepStrictEqual(Object.keys(对象).sort(), ['model', 'name', 'tools', 'toolsOrder']);
});

试('V-10 默认那份的文件坏掉 ⇒ 报读不懂，不当成"没有"', () => {
  const 根 = 临时('主线-');
  fs.mkdirSync(根, { recursive: true });
  const 默认目录 = path.join(根, '默认');
  fs.mkdirSync(默认目录, { recursive: true });
  fs.writeFileSync(path.join(默认目录, '主AI.json'), '{ 坏掉的', 'utf8');
  const 模块 = createMainAiModule({ 根目录: path.join(根, '用户'), 默认目录, 业务工具: 假业务工具 });
  const 行 = 模块.表().find((x) => x.是本子);
  assert.strictEqual(行.存在, false);
  assert.strictEqual(行.读不懂, true);
});

试('V-11 默认目录空着 ⇒ 表里没有默认那套，但零套是缺省不是能力缺失', () => {
  const { 模块 } = 建内存({ 默认: {} });
  assert.deepStrictEqual(模块.表(), []);
  assert.strictEqual(模块.执行({ 请求: '主AI' }), null, '直呼：失败给 null');
  assert.ok(模块.run('执行', { 请求: '主AI' }).reason.includes('PRESET_NO_SUCH_PRESET'), 模块.run('执行', { 请求: '主AI' }).reason);
});

试('V-12 程序里没有任何一处能写到默认目录', () => {
  /** 去掉注释，只看真代码——"默认目录"这四个字出现在注释里是允许的。 */
  const 去注释 = (源码) => 源码.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  // 核心不认识盘，连"默认目录"这个东西都不知道。
  const 核心 = 去注释(fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8'));
  assert.ok(!/默认目录|默认根/.test(核心), '核心不该认识默认目录这个东西');
  assert.ok(!/require\(['"](node:)?fs['"]\)/.test(核心), '核心不该 require fs');
  assert.strictEqual(核心.match(/rawPort\.writeState\(/g).length, 1, '核心写盘只有一条路：端口');

  // 适配器里只有一处原子写，它只被 writeState 用，而 writeState 只写 root 那一份。
  const 适配 = 去注释(fs.readFileSync(path.join(__dirname, '..', 'adapter-file.js'), 'utf8'));
  const 写调用 = 适配.match(/fs\.(writeFileSync|renameSync|mkdirSync|unlinkSync|rmSync|rmdirSync|appendFileSync|copyFileSync)\(/g) || [];
  assert.deepStrictEqual(写调用, ['fs.mkdirSync(', 'fs.writeFileSync(', 'fs.renameSync(', 'fs.unlinkSync('], '写调用只该出现在 原子写 里');
  assert.strictEqual(适配.match(/原子写\(/g).length, 2, '原子写：定义一处 + 被 writeState 调一处');
  assert.ok(/原子写\(path\.join\(root, 状态文件名\)/.test(适配), '原子写只写 root 那一份');
  assert.ok(!/原子写\([^)]*默认根/.test(适配), '不许有写到默认根的那条路');
});

// ================================================================ 三、工具表

试('V-13 默认工具表只来自递入的业务工具契约', () => {
  const { 模块 } = 建内存();
  const 动作数 = 假业务工具().length;
  const 出 = 模块.执行({});
  assert.strictEqual(出.工具表.length, 动作数);
});

试('V-14 工具名与摘要来自业务契约，不拆名路由', () => {
  const { 模块 } = 建内存({ 业务工具: [{ 名字: 'drawImage', 摘要: '生成一张图', 参数: {}, 说明: {} }] });
  const 名 = 模块.执行({}).工具表.map((x) => x.名字);
  assert.deepStrictEqual(名, ['drawImage']);
  assert.strictEqual(模块.执行({}).工具表[0].摘要, '生成一张图');
});

试('V-15 参数类型、必填与说明来自业务契约', () => {
  const { 模块 } = 建内存();
  const 一个 = 模块.执行({}).工具表.find((x) => x.名字 === 'tag_query');
  assert.deepStrictEqual(一个.参数, {
    词串: { type: 'string', description: '要查的词，逗号分隔', required: true },
    上限: { type: 'integer', description: '最多回几条' },
  });
  assert.deepStrictEqual(一个.说明, { 词串: '要查的词，逗号分隔', 上限: '最多回几条' });
});

试('V-16 没有参数的动作 ⇒ 参数是空对象，不是 undefined', () => {
  const { 模块 } = 建内存({
    业务工具: [{ 名字: 'empty_tool', 摘要: '无参数工具', 参数: {}, 说明: {} }],
  });
  const 出 = 模块.执行({});
  assert.deepStrictEqual(出.工具表[0].参数, {});
});

试('V-17 业务schema不落盘：默认预设导出时读取当前定义', () => {
  const 根 = 临时('主线-');
  const 模块 = createMainAiModule({ 根目录: 根, 默认目录: 建假默认目录(根), 业务工具: 假业务工具 });
  模块.存();
  const 盘 = JSON.parse(fs.readFileSync(path.join(根, '预设.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(盘).sort(), ['format', 'presets', 'subs', 'version']);
  assert.deepStrictEqual(盘.presets, {}, '默认那份压根没有被写进去');
  assert.strictEqual(模块.执行({}).工具表.length, 7, '但算得出来');

  // 导出时把它算出来带上（导出的东西要能直接改、直接再导入）
  const 导 = JSON.parse(模块.预设({ 动作: '导出', 预设: 默认标识 }).内容);
  assert.strictEqual(导.tools.length, 7);
});

试('V-18 出口给副本：改交回来的参数不影响下一次', () => {
  const { 模块 } = 建内存();
  const 一 = 模块.执行({});
  一.工具表[0].参数.词串.description = '被我改了';
  一.工具表[0].名字 = '被我改了';
  const 二 = 模块.执行({});
  assert.strictEqual(二.工具表[0].参数.词串.description, '要查的词，逗号分隔');
  assert.strictEqual(二.工具表[0].名字, 'tag_query');
});

试('V-19 停用的工具不进交出去的表，但留在预设里', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  模块.工具({ 动作: '改', 预设: 'ps1', 名字: 'tag_query', 启用: false });
  模块.存();
  const 出 = 模块.执行({ 预设: 'ps1' });
  assert.ok(!出.工具表.some((x) => x.名字 === 'tag_query'));
  assert.ok(模块.读({ 预设: 'ps1' }).预设.工具表.some((x) => x.名字 === 'tag_query'));
  assert.strictEqual(模块.读({ 预设: 'ps1' }).预设.工具表.find((x) => x.名字 === 'tag_query').启用, false);
});

试('V-20 tools空数组表示无覆盖，当前业务工具保持启用', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲', 一套: { name: '甲', 身份: '在', 流程: '说', worldbook: ['旧书'], tools: [] } });
  模块.存();
  const 出 = 模块.执行({ 预设: 'ps1' });
  assert.strictEqual(出.工具表.length, 7);
  assert.equal('身份' in 出, false, '旧身份字段在读取时忽略');
});

试('V-21 重置：把那套预设的工具表打回当时算出来的那一份', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  模块.工具({ 动作: '删', 预设: 'ps1', 名字: 'tag_query' });
  assert.strictEqual(模块.读({ 预设: 'ps1' }).预设.工具表.filter((x) => x.启用 !== false).length, 6);
  const 出 = 模块.工具({ 动作: '重置', 预设: 'ps1' });
  assert.strictEqual(出.工具数, 7);
  assert.deepStrictEqual(模块.读({ 预设: 'ps1' }).预设.工具表.map((x) => x.名字), 模块.执行({}).工具表.map((x) => x.名字));
});

试('V-22 不能把业务表之外的名字加入可调用工具', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  const 加 = 模块.run('工具', { 动作: '加', 预设: 'ps1', 名字: 'tag_不存在的动作', 参数: { 甲: { type: 'string' } } });
  assert.strictEqual(加.ok, false);
  assert.strictEqual(加.code, 'PRESET_NO_SUCH_TOOL');
});

试('V-23 重新启用业务定义中的工具，并保留规范schema', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  模块.工具({ 动作: '删', 预设: 'ps1', 名字: 'tag_query' });
  const 加 = 模块.工具({ 动作: '加', 预设: 'ps1', 名字: 'tag_query' });
  assert.strictEqual(加.算得出来, true);
  const 一条 = 模块.读({ 预设: 'ps1' }).预设.工具表.find((x) => x.名字 === 'tag_query');
  assert.deepStrictEqual(一条.参数, { 词串: { type: 'string', description: '要查的词，逗号分隔', required: true }, 上限: { type: 'integer', description: '最多回几条' } });
});

试('V-24 工具名不许重复', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  const 出 = 模块.run('工具', { 动作: '加', 预设: 'ps1', 名字: 'tag_query' });
  assert.strictEqual(出.ok, false);
  assert.ok(出.reason.includes('PRESET_BAD_ARGUMENT'), 出.reason);
});

试('V-25 工具上不认识的名字 ⇒ PRESET_NO_SUCH_TOOL', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  const 出 = 模块.run('工具', { 动作: '删', 预设: 'ps1', 名字: '没有这个' });
  assert.strictEqual(出.ok, false);
  assert.strictEqual(出.code, 'PRESET_NO_SUCH_TOOL');
});

试('V-26 预设只覆盖参数说明，不能改业务schema类型或字段', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  const 新参数 = { 词串: { type: 'number', description: '我自己写的' } };
  模块.工具({ 动作: '改', 预设: 'ps1', 名字: 'tag_query', 参数: 新参数 });
  模块.存();
  const 出 = 模块.执行({ 预设: 'ps1' });
  assert.deepStrictEqual(出.工具表.find((x) => x.名字 === 'tag_query').参数.词串, { type: 'string', description: '我自己写的', required: true });
});

试('自定义工具摘要与所有层级的参数说明可清空、保存、导出与执行', () => {
  const { 模块, port } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  const 参数 = {
    词串: { type: 'string', description: '', required: true },
    上限: { type: 'integer', description: '自定义上限说明' },
  };
  模块.工具({ 动作: '改', 预设: 'ps1', 名字: 'tag_query', 摘要: '', 参数 });
  模块.存();
  const 执行 = 模块.执行({ 预设: 'ps1' }).工具表.find(一 => 一.名字 === 'tag_query');
  assert.equal(执行.摘要, '');
  assert.equal(执行.参数.词串.description, '');
  assert.equal(执行.参数.上限.description, '自定义上限说明');
  const 定义 = require('../../对接层/工具定义.js');
  const 登记声明 = 定义.工具声明(执行);
  assert.equal(登记声明.parameters.properties.词串.description, '');
  const 模型声明 = 定义.模型工具(登记声明).function;
  assert.equal(模型声明.description, '上限：自定义上限说明');
  const 存档 = port.readState().value.presets.ps1.tools.find(一 => 一.名字 === 'tag_query');
  assert.equal(存档.摘要, '');
  assert.equal(模块.预设({ 动作: '导出', 预设: 'ps1' }).内容.includes('自定义上限说明'), true);
  模块.工具({ 动作: '改', 预设: 'ps1', 名字: 'tag_query', 摘要: '', 参数: { 上限: { description: '' } } });
  const 空描述 = 定义.模型工具(定义.工具声明(模块.测({ 预设: 'ps1' }).工具表.find(一 => 一.名字 === 'tag_query'))).function;
  assert.equal(空描述.description, '');
  const 再建 = 建内存({ 业务工具: [{ 名字: 'nested', 摘要: '基础', 参数: { 项: { type: 'object', properties: { 名: { type: 'string', description: '基础名', required: true } } } } }] });
  再建.模块.预设({ 动作: '新建', 名字: '嵌套' });
  再建.模块.工具({ 动作: '改', 预设: 'ps1', 名字: 'nested', 参数: { 项: { properties: { 名: { description: '' } } } } });
  assert.equal(再建.模块.测({ 预设: 'ps1' }).工具表[0].参数.项.properties.名.description, '');
});

试('稀疏工具差异重读后仍用业务默认摘要，显式空摘要仍能清空', () => {
  const { 模块, port } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  模块.工具({ 动作: '改', 预设: 'ps1', 名字: 'tag_query', 启用: false, 说明: { 词串: '自定义说明' } });
  模块.存();
  assert.equal(port.readState().value.presets.ps1.tools.find(一 => 一.名字 === 'tag_query').摘要, undefined);
  const 重开端口 = createMemoryAdapter({
    默认: { 主AI: 假默认预设() },
    业务工具: 假业务工具(),
  });
  重开端口.writeState(port.readState().value);
  const 重开 = createMainAiModule({ port: 重开端口 });
  assert.equal(重开.读({ 预设: 'ps1' }).预设.工具表.find(一 => 一.名字 === 'tag_query').摘要, '按词查询标签');
  模块.工具({ 动作: '改', 预设: 'ps1', 名字: 'tag_query', 摘要: '' });
  模块.存();
  const 再开端口 = createMemoryAdapter({ 默认: { 主AI: 假默认预设() }, 业务工具: 假业务工具() });
  再开端口.writeState(port.readState().value);
  const 再开 = createMainAiModule({ port: 再开端口 });
  assert.equal(再开.读({ 预设: 'ps1' }).预设.工具表.find(一 => 一.名字 === 'tag_query').摘要, '');
});

试('runtime只保存用户覆盖，快照和执行原样返回，默认值保持为空对象', () => {
  const { 模块, port } = 建内存();
  assert.deepStrictEqual(模块.执行({}).附加文本, {});
  const 新建 = 模块.预设({ 动作: '新建', 名字: '甲' });
  模块.预设({ 动作: '改', 预设: 新建.标识, runtime: { 图片标题: '', 新字段: '原样' } });
  assert.deepStrictEqual(模块.读({ 预设: 新建.标识 }).预设.runtime, { 图片标题: '', 新字段: '原样' });
  模块.存();
  assert.deepStrictEqual(port.readState().value.presets.ps1.runtime, { 图片标题: '', 新字段: '原样' });
  assert.deepStrictEqual(模块.测({ 预设: 新建.标识 }).附加文本, { 图片标题: '', 新字段: '原样' });
  const 导入 = 模块.预设({ 动作: '导入', 一套: JSON.parse(模块.预设({ 动作: '导出', 预设: 新建.标识 }).内容) });
  assert.deepStrictEqual(模块.测({ 预设: 导入.标识 }).附加文本, { 图片标题: '', 新字段: '原样' });
});

试('V-27 工具可以移：上 / 下 / 到序号，越界报得出来', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  模块.工具({ 动作: '移', 预设: 'ps1', 名字: 'tag_query', 到: 2 });
  assert.deepStrictEqual(模块.读({ 预设: 'ps1' }).预设.工具表.map((x) => x.名字).slice(0, 3), [
    'tag_recognize',
    'image_list',
    'tag_query',
  ]);
  const 上 = 模块.工具({ 动作: '移', 预设: 'ps1', 名字: 'tag_query', 方向: '上' });
  assert.strictEqual(上.名字, 'tag_query');
  const 越界 = 模块.run('工具', { 动作: '移', 预设: 'ps1', 名字: 'tag_query', 到: 99 });
  assert.strictEqual(越界.ok, false);
  assert.ok(越界.reason.includes('PRESET_BAD_ARGUMENT'), 越界.reason);
  const 没说方向 = 模块.run('工具', { 动作: '移', 预设: 'ps1', 名字: 'tag_query' });
  assert.strictEqual(没说方向.ok, false);
});

试('V-28 状态报出默认工具表几条，以及认不出的动作', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  assert.deepStrictEqual(模块.状态().认不出的动作, []);
  assert.strictEqual(模块.状态().默认工具数, 7);
});

试('V-29 端口没给业务工具 ⇒ 默认工具表是空的，不是崩溃', () => {
  const { 模块 } = 建内存({ 业务工具: [] });
  const 出 = 模块.执行({});
  assert.deepStrictEqual(出.工具表, []);
  assert.strictEqual(模块.状态().默认工具数, 0);
});

// ================================================================ 四、执行

试('V-30 执行只交回预设配置与工具表，不再返回身份流程或世界书', () => {
  const { 模块 } = 建内存();
  const 出 = 模块.执行({});
  assert.deepStrictEqual(Object.keys(出).sort(), ['工具表', '模型', '请求', '附加文本', '预设'].sort());
  assert.equal('身份' in 出, false);
  assert.equal('流程' in 出, false);
  assert.equal('世界书' in 出, false);
  assert.deepStrictEqual(出.预设, { 标识: 默认标识, 名字: '主AI' });
});

试('V-31 没给预设就用默认那套；给了指不到的明确失败，不回落', () => {
  const { 模块 } = 建内存();
  assert.strictEqual(模块.执行({}).预设.标识, 默认标识);
  const 出 = 模块.run('执行', { 预设: 'ps99' });
  assert.strictEqual(出.ok, false);
  assert.ok(出.reason.includes('PRESET_NO_SUCH_PRESET'), 出.reason);
});

试('V-32 给了请求就用它启用的第一套；这个请求没启用过就用默认那套', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 请求: '主AI', 名字: '甲', 一套: { name: '甲', model: { 模型: 'model-a' } } });
  模块.存();
  assert.deepStrictEqual(模块.执行({ 请求: '主AI' }).模型, { 模型: 'model-a' });
  assert.deepStrictEqual(模块.执行({ 请求: '翻译' }).模型, {});
});

试('V-33 旧默认世界书字段忽略；复制预设只复制配置', () => {
  const { 模块 } = 建内存({
    默认: { 主AI: { name: '主AI', 身份: '在', 流程: '说', worldbook: ['$default:识图'] } },
  });
  assert.equal('世界书' in 模块.执行({}), false);
  模块.预设({ 动作: '新建', 名字: '甲' });
  assert.equal('worldbook' in 模块.读({ 预设: 'ps1' }).预设, false, '复制时不保存旧世界书引用');
  模块.预设({ 动作: '改', 预设: 'ps1', worldbook: ['旧引用'], model: { 模型: 'model-b' } });
  模块.存();
  assert.deepStrictEqual(模块.执行({ 预设: 'ps1' }).模型, { 模型: 'model-b' });
  assert.equal('世界书' in 模块.执行({ 预设: 'ps1' }), false);
});

试('V-34 预设那套没写模型 ⇒ 模型是空对象（走 DSH 自己那套）；写了就用写的', () => {
  const { 模块 } = 建内存();
  assert.deepStrictEqual(模块.执行({}).模型, {});
  模块.预设({ 动作: '新建', 名字: '甲' });
  模块.存();
  assert.deepStrictEqual(模块.执行({ 预设: 'ps1' }).模型, {}, '快照时默认那套没有模型 ⇒ 新那套也没有');
  模块.预设({ 动作: '改', 预设: 'ps1', model: { 走: '本地', 模型: 'qwen-vl' } });
  模块.存();
  assert.deepStrictEqual(模块.执行({ 预设: 'ps1' }).模型, { 走: '本地', 模型: 'qwen-vl' });
});

试('V-35 执行只读存档，测读草稿中的模型配置', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲', 一套: { name: '甲', model: { 模型: 'draft-model' } } });
  模块.预设({ 动作: '换', 请求: '主AI', 启用: ['ps1'] });
  assert.deepStrictEqual(模块.执行({ 请求: '主AI' }).模型, {}, '没存之前执行还是旧的');
  assert.deepStrictEqual(模块.测({ 请求: '主AI' }).模型, { 模型: 'draft-model' }, '测看得见草稿');
  模块.存();
  assert.deepStrictEqual(模块.执行({ 请求: '主AI' }).模型, { 模型: 'draft-model' });
});

// ================================================================ 五、快照

试('V-36 新建预设只保存模型设置，工具表仍由当前业务定义生成', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  const 一套 = 模块.读({ 预设: 'ps1' }).预设;
  assert.equal('身份' in 一套, false);
  assert.equal('流程' in 一套, false);
  assert.equal('worldbook' in 一套, false);
  assert.strictEqual(一套.工具表.length, 7);
  assert.ok(一套.工具表.every((x) => x.名字 && x.参数 && x.启用 === true));
});

试('V-37 新业务工具进入用户预设，旧偏好只按当前业务名继续应用', () => {
  const 业务工具 = 假业务工具();
  const { 模块 } = 建内存({ 业务工具 });
  模块.预设({ 动作: '新建', 名字: '甲' });
  模块.存();
  assert.strictEqual(模块.执行({ 预设: 'ps1' }).工具表.length, 7);
  // 业务表增加一项
  业务工具.push({ 名字: 'new_business_tool', 摘要: '后加的', 参数: {}, 说明: {} });
  assert.strictEqual(模块.执行({ 预设: 'ps1' }).工具表.length, 8, '用户预设随业务表更新');
  assert.strictEqual(模块.执行({}).工具表.length, 8, '默认表随业务表更新');
});

试('V-38 复制：保留工具的启用差异，schema继续取当前业务定义', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  模块.工具({ 动作: '删', 预设: 'ps1', 名字: 'tag_query' });
  模块.存();
  const 出 = 模块.预设({ 动作: '复制', 预设: 'ps1' });
  assert.strictEqual(出.名字, '甲 副本');
  assert.strictEqual(模块.读({ 预设: 'ps2' }).预设.工具表.length, 7);
  assert.strictEqual(模块.读({ 预设: 'ps2' }).预设.工具表.find((x) => x.名字 === 'tag_query').启用, false);
  assert.deepStrictEqual(模块.读({ 预设: 'ps2' }).预设.工具表.map((x) => x.名字), 模块.读({ 预设: 'ps1' }).预设.工具表.map((x) => x.名字));
});

试('V-39 新建可以直接从某一套拷：给 源', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  模块.工具({ 动作: '改', 预设: 'ps1', 名字: 'tag_query', 启用: false });
  模块.预设({ 动作: '新建', 名字: '乙', 源: 'ps1' });
  assert.strictEqual(模块.读({ 预设: 'ps2' }).预设.工具表.find((x) => x.名字 === 'tag_query').启用, false);
});

试('V-40 源指不到 ⇒ 失败，且不动状态', () => {
  const { 模块 } = 建内存();
  const 出 = 模块.run('预设', { 动作: '新建', 名字: '甲', 源: 'ps99' });
  assert.strictEqual(出.ok, false);
  assert.ok(出.reason.includes('PRESET_NO_SUCH_PRESET'), 出.reason);
  assert.strictEqual(模块.表().length, 1);
});

试('V-41 导出一套再导入 ⇒ 逐项相同', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  模块.工具({ 动作: '改', 预设: 'ps1', 名字: 'tag_query', 启用: false });
  模块.预设({ 动作: '改', 预设: 'ps1', worldbook: ['wb1'], model: { 走: '本地' } });
  模块.存();
  const 导 = 模块.预设({ 动作: '导出', 预设: 'ps1' });
  const 入 = 模块.预设({ 动作: '导入', 内容: 导.内容 });
  assert.strictEqual(入.名字, '甲 2');
  const 甲 = 模块.读({ 预设: 'ps1' }).预设;
  const 乙 = 模块.读({ 预设: 入.标识 }).预设;
  assert.deepStrictEqual(乙.工具表, 甲.工具表);
  assert.deepStrictEqual(乙.model, 甲.model);
});

试('V-42 导入撞名加号，绝不覆盖', () => {
  const { 模块 } = 建内存();
  const 入一 = 模块.预设({ 动作: '导入', 一套: { name: '甲', model: { 模型: '第一份' } } });
  const 入二 = 模块.预设({ 动作: '导入', 一套: { name: '甲', model: { 模型: '第二份' } } });
  assert.strictEqual(入一.名字, '甲');
  assert.strictEqual(入二.名字, '甲 2');
  assert.deepStrictEqual(模块.读({ 预设: 入一.标识 }).预设.model, { 模型: '第一份' });
});

试('V-43 导入一份不是 JSON 的 ⇒ PRESET_BAD_PRESET，不动状态', () => {
  const { 模块 } = 建内存();
  const 出 = 模块.run('预设', { 动作: '导入', 内容: '{ 坏掉的' });
  assert.strictEqual(出.ok, false);
  assert.strictEqual(出.code, 'PRESET_BAD_PRESET');
  assert.strictEqual(模块.表().length, 1);
});

试('V-44 导入一份没有身份流程的对象：照收，缺了就是缺功能', () => {
  const { 模块 } = 建内存();
  const 出 = 模块.预设({ 动作: '导入', 一套: { name: '光杆' } });
  assert.strictEqual(出.名字, '光杆');
  const 一套 = 模块.读({ 预设: 出.标识 }).预设;
  assert.equal('身份' in 一套, false);
  assert.equal('流程' in 一套, false);
  assert.equal('worldbook' in 一套, false);
  assert.strictEqual(一套.工具表.length, 7);
});

试('V-45 导入时只接受当前业务工具名，不接受旧或任意工具名', () => {
  const { 模块 } = 建内存();
  const 出 = 模块.预设({
    动作: '导入',
    一套: {
      name: '外面来的',
      身份: '被忽略',
      tools: [{ 名字: '模块里没有的.动作', 参数: { 甲: { type: 'string' } }, 说明: { 甲: '随便' } }],
    },
  });
  assert.strictEqual(出.工具数, 7);
  const 工具名 = 模块.读({ 预设: 出.标识 }).预设.工具表.map((一) => 一.名字);
  assert.ok(!工具名.includes('模块里没有的.动作'));
  assert.deepStrictEqual(工具名, 假业务工具().map((一) => 一.名字));
});

试('V-46 新建 / 复制 / 导入 都能顺手进某个请求的启用列表', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 请求: '主AI', 名字: '甲' });
  assert.deepStrictEqual(模块.读({ 请求: '主AI' }).启用.map((x) => x.标识), ['ps1']);
  模块.预设({ 动作: '复制', 请求: '主AI', 预设: 'ps1' });
  assert.deepStrictEqual(模块.读({ 请求: '主AI' }).启用.map((x) => x.标识), ['ps1', 'ps2']);
});

试('V-47 改只改给的那几格，没给的照旧', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  模块.预设({ 动作: '改', 预设: 'ps1', model: { 模型: 'new' } });
  const 一套 = 模块.读({ 预设: 'ps1' }).预设;
  assert.deepStrictEqual(一套.model, { 模型: 'new' });
  assert.equal('流程' in 一套, false);
  assert.equal('身份' in 一套, false);
  assert.strictEqual(一套.工具表.length, 7);
});

// ================================================================ 六、草稿 / 存档 / 写盘

试('V-48 改了不存：执行拿到的还是旧的，测看得见', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  模块.存();
  模块.预设({ 动作: '改', 预设: 'ps1', model: { 模型: '后来' } });
  assert.deepStrictEqual(模块.执行({ 预设: 'ps1' }).模型, {});
  assert.deepStrictEqual(模块.测({ 预设: 'ps1' }).模型, { 模型: '后来' });
  assert.strictEqual(模块.读().脏, true);
});

试('V-49 丢：草稿丢回存档，脏变回假', () => {
  const { 模块 } = 建内存();
  模块.预设({ 动作: '新建', 名字: '甲' });
  assert.strictEqual(模块.读().脏, true);
  模块.丢();
  assert.strictEqual(模块.读().脏, false);
  assert.strictEqual(模块.表().length, 1);
});

试('V-50 存之后再开一个模块，读到的是同一份', () => {
  const 根 = 临时('主线-');
  const 默认目录 = 建假默认目录(根);
  const 一 = createMainAiModule({ 根目录: 根, 默认目录, 业务工具: 假业务工具 });
  一.预设({ 动作: '新建', 请求: '主AI', 名字: '甲' });
  一.预设({ 动作: '改', 预设: 'ps1', model: { 模型: '存过的' } });
  assert.strictEqual(一.存().脏, false);

  const 二 = createMainAiModule({ 根目录: 根, 默认目录, 业务工具: 假业务工具 });
  assert.deepStrictEqual(二.读({ 预设: 'ps1' }).预设.model, { 模型: '存过的' });
  assert.deepStrictEqual(二.读({ 请求: '主AI' }).启用.map((x) => x.标识), ['ps1']);
  assert.strictEqual(二.表().length, 2);
  assert.deepStrictEqual(二.执行({ 预设: 'ps1' }).模型, { 模型: '存过的' });
});

试('V-51 盘上的形状：format / version / subs / presets，文件名 预设.json', () => {
  const 根 = 临时('主线-');
  const 模块 = createMainAiModule({ 根目录: 根, 默认目录: 建假默认目录(根), 业务工具: 假业务工具 });
  模块.预设({ 动作: '新建', 请求: '主AI', 名字: '甲' });
  模块.存();
  const 盘 = JSON.parse(fs.readFileSync(path.join(根, '预设.json'), 'utf8'));
  assert.strictEqual(盘.format, 'preset');
  assert.strictEqual(盘.version, 1);
  assert.deepStrictEqual(盘.subs, { 主AI: { 启用: ['ps1'] } });
  assert.strictEqual(盘.presets.ps1.name, '甲');
  assert.ok(Array.isArray(盘.presets.ps1.tools));
});

试('V-52 存档读不懂 ⇒ 冻结写，但只读默认照常可用', () => {
  const 根 = 临时('主线-');
  fs.mkdirSync(根, { recursive: true });
  fs.writeFileSync(path.join(根, '预设.json'), JSON.stringify({ version: 99 }), 'utf8');
  const 模块 = createMainAiModule({ 根目录: 根, 默认目录: 建假默认目录(根), 业务工具: 假业务工具 });

  const 快照 = 模块.读();
  assert.ok(快照.冻结, '要报出冻结');
  assert.equal(模块.执行({}).工具表.length, 7, '默认工具表照常可用');

  for (const 一个 of [
    ['预设', { 动作: '新建', 名字: '甲' }],
    ['预设', { 动作: '换', 请求: '主AI', 启用: [] }],
    ['工具', { 动作: '重置', 预设: 'ps1' }],
    ['存', {}],
  ]) {
    const 出 = 模块.run(一个[0], 一个[1]);
    assert.strictEqual(出.ok, false, 一个[0]);
    assert.ok(出.reason.includes('PRESET_STATE_UNREADABLE'), 出.reason);
  }
});

试('V-53 版本不是 1 ⇒ 当成读不懂；空文件 / 数组 ⇒ 也读不懂', () => {
  for (const 坏 of [{ version: 2 }, [], '不是对象']) {
    const 根 = 临时('主线-');
    fs.mkdirSync(根, { recursive: true });
    fs.writeFileSync(path.join(根, '预设.json'), JSON.stringify(坏), 'utf8');
    const 模块 = createMainAiModule({ 根目录: 根, 默认目录: 建假默认目录(根), 业务工具: 假业务工具 });
    assert.ok(模块.读().冻结, JSON.stringify(坏));
  }
});

试('V-54 重读：外部改过盘上的那份，重读看得见', () => {
  const 根 = 临时('主线-');
  const 默认目录 = 建假默认目录(根);
  const 一 = createMainAiModule({ 根目录: 根, 默认目录, 业务工具: 假业务工具 });
  一.预设({ 动作: '新建', 名字: '甲' });
  一.存();

  const 二 = createMainAiModule({ 根目录: 根, 默认目录, 业务工具: 假业务工具 });
  const 盘 = JSON.parse(fs.readFileSync(path.join(根, '预设.json'), 'utf8'));
  盘.presets.ps1.model = { 模型: '外面改的' };
  fs.writeFileSync(path.join(根, '预设.json'), JSON.stringify(盘), 'utf8');
  assert.deepStrictEqual(二.读({ 预设: 'ps1' }).预设.model, {});
  二.重读();
  assert.deepStrictEqual(二.读({ 预设: 'ps1' }).预设.model, { 模型: '外面改的' });
});

// ================================================================ 七、核心不依赖盘

试('V-55 同一流程在内存适配器上结果一致（核心不依赖盘）', () => {
  const 走 = (模块) => {
    模块.预设({ 动作: '新建', 请求: '主AI', 名字: '甲' });
    模块.预设({ 动作: '改', 预设: 'ps1', 身份: '在', 流程: '说', worldbook: ['wb1'] });
    模块.工具({ 动作: '改', 预设: 'ps1', 名字: 'tag_query', 启用: false });
    const 出 = 模块.执行({ 请求: '主AI' });
    return JSON.stringify(出);
  };

  const 根 = 临时('主线-');
  const 盘 = createMainAiModule({ 根目录: 根, 默认目录: 建假默认目录(根), 业务工具: 假业务工具 });
  const { 模块: 内存 } = 建内存();
  const 甲 = 走(盘);
  盘.存();
  assert.strictEqual(走(内存), 甲);
});

试('V-56 核心与纯函数里不出现 fs / path', () => {
  for (const 文件 of ['core.js', 'preset.js']) {
    const 源码 = fs.readFileSync(path.join(__dirname, '..', 文件), 'utf8');
    assert.ok(!/require\(['"](node:)?fs['"]\)/.test(源码), `${文件} 不该 require fs`);
    assert.ok(!/require\(['"](node:)?path['"]\)/.test(源码), `${文件} 不该 require path`);
  }
});

// ================================================================ 八、门面与失败

试('V-57 run 给信封，直呼给数据或 null；理由写成 码: 人话', () => {
  const { 模块 } = 建内存();
  assert.strictEqual(模块.读({ 预设: 'ps99' }), null);
  const 信封 = 模块.run('读', { 预设: 'ps99' });
  assert.strictEqual(信封.ok, false);
  assert.strictEqual(信封.code, 'PRESET_NO_SUCH_PRESET');
  assert.strictEqual(信封.reason, 'PRESET_NO_SUCH_PRESET: 没有这套预设：ps99');
  assert.strictEqual(模块.run('没有这个动作').code, 'PRESET_BAD_ARGUMENT');
});

试('V-58 动作表十条，每条都有摘要与参数', () => {
  const { 模块 } = 建内存();
  assert.deepStrictEqual(模块.actions, ['执行', '读', '表', '测', '预设', '工具', '存', '丢', '重读', '状态']);
  for (const 一 of 模块.describe()) {
    assert.ok(一.动作 && 一.摘要 && Array.isArray(一.参数), JSON.stringify(一));
  }
});

试('V-59 出口冻住，内部件一个都不递', () => {
  const { 模块 } = 建内存();
  assert.ok(Object.isFrozen(模块));
  for (const 名字 of ['createCore', 'createFileAdapter', 'createMemoryAdapter', '算工具表', '归一预设', 'PORT_METHODS']) {
    assert.strictEqual(名字 in 模块, false, `不该递出 ${名字}`);
  }
});

试('V-60 动作表里没有路径 / 地址这类参数', () => {
  const { 模块 } = 建内存();
  for (const 一 of 模块.describe()) {
    for (const 名 of 一.参数) {
      assert.ok(!/路径|地址|目录|根目录|url|path/i.test(名), `${一.动作} 的参数 ${名} 像是一个位置`);
    }
  }
});

试('V-61 装配：要么递端口，要么给两个位置；缺了装配时抛错', () => {
  assert.throws(() => createMainAiModule({}), /PRESET_BAD_ARGUMENT/);
  assert.throws(() => createMainAiModule({ 根目录: '', 默认目录: 'x' }), /PRESET_BAD_ARGUMENT/);
  assert.throws(() => createMainAiModule({ 根目录: 'x', 默认目录: '' }), /PRESET_BAD_ARGUMENT/);
  assert.throws(() => createMainAiModule({ port: {} }), /端口不合格/);
  assert.throws(() => createMainAiModule({ port: { readState: () => ({}) } }), /writeState/);
  for (const 别名 of ['root', 'data', '目录']) {
    assert.throws(() => createMainAiModule({ [别名]: 'x', 默认目录: 'y' }), /PRESET_BAD_ARGUMENT/, 别名);
  }
});

试('V-62 默认预设只保存名字，身份与工作方式住在世界书', () => {
  const 文件 = path.join(__dirname, '..', 'assets', '预设', '主AI.json');
  const 盘 = JSON.parse(fs.readFileSync(文件, 'utf8'));
  assert.strictEqual(盘.name, '主AI');
  assert.deepStrictEqual(Object.keys(盘), ['name']);
  assert.ok(!('tools' in 盘), '默认工具表不落盘');
  const 书 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '世界书模块', 'assets', '世界书', '主AI.json'), 'utf8'));
  assert.deepStrictEqual(书.entries.map((x) => x.label), ['身份', '工作方式']);
  assert.ok(书.entries.every((x) => x.always && x.enabled));
});

// ================================================================ 跑

function main() {
  let 过 = 0;
  const 失败 = [];
  for (const 一条 of 判据) {
    if (过滤 && !一条.名字.includes(过滤)) continue;
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
