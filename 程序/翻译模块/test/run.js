'use strict';

const assert = require('node:assert/strict');
const { createTranslateModule } = require('../index.js');
const { createFakeAdapter } = require('../adapter-fake.js');
const { createRealAdapter } = require('../adapter-real.js');
const { createBindingModule } = require('../../装订模块/index.js');

const 文本处理 = createBindingModule().文本处理;
const 词表 = { '1girl': '1个女孩', hatsune_miku: '初音未来', a: '甲', b: '乙' };

function 装(改 = {}) {
  const 端口 = createFakeAdapter({
    文本处理,
    词表: 改.词表 === undefined ? 词表 : 改.词表,
    查词: 改.查词,
    译: 改.译,
  });
  return { 模块: createTranslateModule({ ...端口, 默认方向: 改.默认方向, 默认模型: 改.默认模型 }), 端口 };
}

async function 译成功(模块, 文本, 参数 = {}) {
  const 回 = await 模块.run('本地译', { 文本, ...参数 });
  assert.equal(回.ok, true, JSON.stringify(回));
  return 回.data;
}

const 条 = [];
const 试 = (标题, 做) => 条.push({ 标题, 做 });

试('装配采用文本处理对象与按标识返回的端口', () => {
  assert.throws(() => createTranslateModule({}), /文本处理/);
  assert.throws(() => createTranslateModule({ 文本处理, 查词: '错误' }), /查词/);
  assert.deepEqual([...装().模块.actions], ['看模型', '本地译', '切分']);
  assert.equal(Object.isFrozen(装().模块), true);
  assert.deepEqual(装().模块.端口.map(row => row.名), ['文本处理', '查词', '译']);
});

试('无本地模型时只在确有待译项时失败', async () => {
  const 模块 = createTranslateModule({ 文本处理, 查词: () => [null] });
  assert.deepEqual(模块.run('看模型').data.缺, ['译']);
  const 回 = await 模块.run('本地译', { 文本: 'smile' });
  assert.equal(回.ok, false);
  assert.equal(回.code, 'TEXT_LOCAL_NO_ENGINE');
  assert.equal(回.原文, 'smile');
});

试('纯词库命中只用词库并保持原输入格式', async () => {
  let 模型次数 = 0;
  const { 模块 } = 装({ 译: async () => { 模型次数++; return { units: [] }; } });
  const 出 = await 译成功(模块, '1girl, hatsune_miku');
  assert.equal(出.译文, '1个女孩, 初音未来');
  assert.equal(模型次数, 0);
  assert.equal(出.统计.库里查到, 2);
  assert.deepEqual(出.表.map(row => row.出处), ['库', '库']);
});

试('模型端口接收英文键单元并保留返回模型名', async () => {
  let payload;
  const { 模块 } = 装({ 译: async value => {
    payload = value;
    return { 模型: '测试模型', units: value.units.map(unit => ({ id: unit.id, text: `译:${unit.text}` })) };
  } });
  const 出 = await 译成功(模块, '1girl, smile', { 模型: 'selected-model' });
  assert.deepEqual(Object.keys(payload).sort(), ['from', 'source', 'to', 'units', '模型'].sort());
  assert.equal(payload.source, '1girl, smile');
  assert.deepEqual(payload.units, [{ id: 'u2', text: 'smile' }]);
  assert.equal(payload.from, '英文');
  assert.equal(payload.to, '中文');
  assert.equal(payload.模型, 'selected-model');
  assert.equal(出.模型, '测试模型');
  assert.equal(出.译文, '1个女孩, 译:smile');
  assert.equal(出.出处, '逐格');
});

试('默认模型进入端口，可由本次调用选择覆盖', async () => {
  const models = [];
  const { 模块 } = 装({ 默认模型: 'default-model', 译: async payload => {
    models.push(payload.模型);
    return { units: payload.units.map(unit => ({ id: unit.id, text: unit.text })) };
  } });
  await 译成功(模块, 'first');
  await 译成功(模块, 'second', { 模型: 'chosen-model' });
  assert.deepEqual(models, ['default-model', 'chosen-model']);
});

试('重复词有独立 id，乱序结果按 id 归位', async () => {
  let ids;
  const { 模块 } = 装({ 查词: words => words.map(() => null), 译: async payload => {
    ids = payload.units.map(unit => unit.id);
    return { units: [...payload.units].reverse().map(unit => ({ id: unit.id, text: `${unit.id}:${unit.text}` })) };
  } });
  const 出 = await 译成功(模块, 'smile, smile');
  assert.deepEqual(ids, ['u1', 'u2']);
  assert.deepEqual(出.表.map(row => row.标识), ['u1', 'u2']);
  assert.equal(出.译文, 'u1:smile, u2:smile');
  assert.notDeepEqual(出.表[0].原文范围, 出.表[1].原文范围);
});

试('未问过的 id 忽略，缺失或空结果让整次翻译失败', async () => {
  const 忽略 = 装({ 查词: () => [null], 译: async payload => ({ units: [
    ...payload.units.map(unit => ({ id: unit.id, text: '确译' })), { id: 'never-asked', text: '乱入' },
  ] }) });
  assert.equal((await 译成功(忽略.模块, 'smile')).译文, '确译');
  for (const response of [{ units: [] }, { units: [{ id: 'u1', text: '  ' }] }]) {
    const { 模块 } = 装({ 查词: () => [null], 译: async () => response });
    const 回 = await 模块.run('本地译', { 文本: 'smile' });
    assert.equal(回.ok, false);
    assert.equal(回.code, 'TEXT_LOCAL_FAILED');
    assert.equal(回.原文, 'smile');
  }
});

试('括号权重壳与空项、空格、换行、全角标点从原文保留', async () => {
  const { 模块 } = 装({ 查词: words => words.map(word => ({ smile: '微笑', solo: '单人' }[word] || null)) });
  const source = '  (smile:1.2)，，solo\r\n';
  const 出 = await 译成功(模块, source);
  assert.equal(出.译文, '  (微笑:1.2)，，单人\r\n');
  assert.equal(出.表.length, 4);
  assert.equal(出.表[0].标识, 'u1');
  assert.equal(出.表[1].词, '');
  assert.equal(出.表[2].标识, 'u3');
  assert.equal(出.表[3].词, '');
});

试('结果范围包含完整 tag 壳，按 UTF-16 坐标切出实际片段', async () => {
  const { 模块 } = 装({ 查词: words => words.map(word => ({ smile: '微笑', solo: '单人' }[word] || null)) });
  const source = '😀, (smile:1.2), solo';
  const 出 = await 译成功(模块, source);
  assert.equal(出.译文, '😀, (微笑:1.2), 单人');
  assert.deepEqual(出.表.map(row => row.原文范围), [[0, 2], [4, 15], [17, 21]]);
  assert.deepEqual(出.表.map(row => row.词范围), [[0, 2], [5, 10], [17, 21]]);
  assert.deepEqual(出.表.map(row => row.译文范围), [[0, 2], [4, 12], [14, 16]]);
  for (const row of 出.表) {
    assert.equal(source.slice(...row.原文范围), row.前 + row.词 + row.后);
    assert.equal(出.译文.slice(...row.译文范围), row.前 + row.译文 + row.后);
  }
});

试('英中方向混合中英单元仍交给模型，auto 与显式方向可用', async () => {
  const seen = [];
  const { 模块 } = 装({ 查词: () => [null], 译: async payload => {
    seen.push(payload);
    return { units: payload.units.map(unit => ({ id: unit.id, text: '红色头发' })) };
  } });
  const 出 = await 译成功(模块, 'girl with 红色头发', { 方向: 'en-zh' });
  assert.equal(出.方向, 'en-zh');
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].units, [{ id: 'u1', text: 'girl with 红色头发' }]);
  assert.equal(出.译文, '红色头发');
  const auto = await 译成功(模块, 'girl with 红色头发');
  assert.equal(auto.方向, 'en-zh');
  assert.equal(auto.译文, '红色头发');
  assert.equal(seen.length, 2);
  assert.equal(模块.猜方向('smile'), 'en-zh');
  assert.equal(模块.猜方向('猫坐着'), 'zh-en');
});

试('zh-en 不查中文名库，并把中文单元送中英模型', async () => {
  let lookup = 0, payload;
  const { 模块 } = 装({ 查词: () => { lookup++; return ['库中文']; }, 译: async value => {
    payload = value;
    return { units: value.units.map(unit => ({ id: unit.id, text: 'the cat sits' })) };
  } });
  const 出 = await 译成功(模块, '猫坐在垫子上', { 方向: 'zh-en' });
  assert.equal(lookup, 0);
  assert.equal(payload.from, '中文');
  assert.equal(payload.to, '英文');
  assert.equal(出.译文, 'the cat sits');
});

试('目标语言文字与数字标点保留，不调用模型', async () => {
  let calls = 0;
  const { 模块 } = 装({ 查词: () => [null], 译: async () => { calls++; return { units: [] }; } });
  const zh = await 译成功(模块, '微笑 123!', { 方向: 'en-zh' });
  const en = await 译成功(模块, 'smile 123!', { 方向: 'zh-en' });
  assert.equal(zh.译文, '微笑 123!');
  assert.equal(en.译文, 'smile 123!');
  assert.equal(calls, 0);
  assert.equal(zh.统计.照抄原词, 1);
  assert.equal(en.统计.照抄原词, 1);
});

试('空输入成功，非字符串数字保留为原文', async () => {
  const { 模块 } = 装();
  const 空 = await 译成功(模块, '');
  const 数字 = await 译成功(模块, 1);
  assert.equal(空.译文, '');
  assert.equal(数字.原文, '1');
  assert.equal(数字.译文, '1');
});

试('方向只认 auto / en-zh / zh-en', async () => {
  const { 模块 } = 装();
  const 回 = await 模块.run('本地译', { 文本: 'smile', 方向: '中译英' });
  assert.equal(回.ok, false);
  assert.equal(回.code, 'TEXT_LOCAL_BAD_DIRECTION');
  assert.equal(回.原文, 'smile');
  assert.equal((await 译成功(模块, 'smile', { 方向: 'en-zh' })).方向, 'en-zh');
  assert.equal((await 译成功(模块, '猫', { 方向: 'zh-en' })).方向, 'zh-en');
});

试('模型异常失败后释放闸门，重试可成功', async () => {
  let calls = 0;
  const { 模块 } = 装({ 查词: () => [null], 译: async payload => {
    calls++;
    if (calls === 1) throw new Error('模型故障');
    return { units: payload.units.map(unit => ({ id: unit.id, text: '恢复' })) };
  } });
  const failed = await 模块.run('本地译', { 文本: 'smile' });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'TEXT_LOCAL_FAILED');
  assert.match(failed.reason, /模型故障/);
  assert.equal(failed.原文, 'smile');
  assert.equal((await 译成功(模块, 'smile')).译文, '恢复');
});

试('翻译闸门在模型等待期间只放行一次', async () => {
  let release;
  const { 模块 } = 装({ 查词: () => [null], 译: () => new Promise(resolve => { release = resolve; }) });
  const first = 模块.run('本地译', { 文本: 'smile' });
  await new Promise(resolve => setImmediate(resolve));
  const second = await 模块.run('本地译', { 文本: 'smile' });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'TEXT_LOCAL_BUSY');
  release({ units: [{ id: 'u1', text: '微笑' }] });
  assert.equal((await first).data.译文, '微笑');
});

试('单次真实范围覆盖超过 256 项，不丢尾项', async () => {
  const words = Array.from({ length: 300 }, (_, index) => `tag_${index}`);
  const { 模块 } = 装({ 查词: list => list.map(() => null), 译: async payload => ({
    units: payload.units.map(unit => ({ id: unit.id, text: `t${unit.id.slice(1)}` })),
  }) });
  const 出 = await 译成功(模块, words.join(', '));
  assert.equal(出.表.length, 300);
  assert.equal(出.表[299].标识, 'u300');
  assert.equal(出.译文.endsWith('t300'), true);
  assert.equal(出.译文.slice(...出.表[299].译文范围), 't300');
});

试('假适配器只使用调用方传入的共用文本处理', async () => {
  const adapter = createFakeAdapter({ 文本处理, 词表: { smile: '微笑' } });
  assert.equal(adapter.文本处理, 文本处理);
  assert.throws(() => createFakeAdapter({}), /文本处理/);
  assert.equal((await 译成功(createTranslateModule(adapter), 'smile')).译文, '微笑');
});

试('真实适配器递交统一对象并检查端口形状', () => {
  const lookup = () => [];
  const translate = async () => ({ units: [] });
  const adapter = createRealAdapter({ 文本处理, 查词: lookup, 译: translate });
  assert.equal(adapter.文本处理, 文本处理);
  assert.equal(adapter.查词, lookup);
  assert.equal(adapter.译, translate);
  assert.deepEqual(createRealAdapter({ 文本处理 }), { 文本处理, 查词: null, 译: null });
  assert.throws(() => createRealAdapter({}), /文本处理/);
  assert.throws(() => createRealAdapter({ 文本处理, 译: 'bad' }), /译/);
});

试('切分动作返回共用切分器的数据与位置字段', () => {
  const { 模块 } = 装();
  const 回 = 模块.run('切分', { 文本: '(smile:1.2), solo' });
  assert.equal(回.ok, true);
  assert.deepEqual(回.data.map(row => row.标识), ['u1', 'u2']);
  assert.deepEqual(回.data[0].词范围, [1, 6]);
});

(async () => {
  const filter = process.argv[2] || '';
  let passed = 0, failed = 0;
  for (const test of 条) {
    if (filter && !test.标题.includes(filter)) continue;
    try {
      await test.做();
      passed++;
      console.log(`  ok   ${test.标题}`);
    } catch (error) {
      failed++;
      console.log(`  FAIL ${test.标题}`);
      console.log(`       ${(error && error.message) || error}`);
    }
  }
  console.log(`\n${passed} 过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
})();
