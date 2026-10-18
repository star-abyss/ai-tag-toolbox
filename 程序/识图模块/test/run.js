// 识图模块 · 自检
//
// 用法：node test/run.js [过滤词]
// 失败非零退出。

'use strict';

const assert = require('node:assert');

const { createVisionModule } = require('../index.js');
const { createFakeAdapter } = require('../adapter-fake.js');
const { createRealAdapter } = require('../adapter-real.js');
const { 读PNG元数据 } = require('../元数据.js');
const { 造PNG } = require('./造图.js');

const 图 = 造PNG({ 宽: 4, 高: 4 });
const 带文字的图 = 造PNG({
  宽: 8,
  高: 8,
  文字: {
    parameters: 'a cat, sitting\nNegative prompt: blurry, lowres\nSteps: 20, Sampler: Euler',
    workflow: '{"1":{"class_type":"KSampler"}}',
    Software: 'SomeTool',
  },
});

const 标签们 = [
  { 词: '1girl', 概率: 0.98, 分类: 0 },
  { 词: 'solo', 概率: 0.91, 分类: 0 },
  { 词: 'hatsune_miku', 概率: 0.72, 分类: 4 },
  { 词: 'long_hair', 概率: 0.61, 分类: 0 },
  { 词: 'unclear', 概率: 0.2, 分类: 0 },
];
const 词表 = { '1girl': '1个女孩', solo: '单人', hatsune_miku: '初音未来', long_hair: '长发' };

/** 装一个模块：图库里有两张图（不带文字的 / 带文字的）。 */
function 装(改 = {}) {
  const 端口 = createFakeAdapter({ 图们: { img_a: 图, img_b: 带文字的图 }, 标签们, 词表, ...改 });
  return createVisionModule({
    取图字节: 改.取图字节 || 端口.取图字节,
    查词: 改.查词 !== undefined ? 改.查词 : 端口.查词,
    tagger: 改.tagger !== undefined ? 改.tagger : 端口.tagger,
    看图: 改.看图 !== undefined ? 改.看图 : 端口.看图,
    读元数据: 改.读元数据 !== undefined ? 改.读元数据 : 端口.读元数据,
    引擎: 改.引擎 !== undefined ? 改.引擎 : 端口.引擎,
  });
}

// 对外的参数是扁平的：模型只能填字符串
const 引用 = { 存放地: 'gallery', 条目ID: 'img_a' };
const 引用B = { 存放地: 'gallery', 条目ID: 'img_b' };

/** 一次认图，要求成功，交回 data。 */
async function 认成功(模块, 参数) {
  const 回 = await 模块.run('认图', 参数);
  assert.ok(回 && 回.ok, `要成功：${JSON.stringify(回)}`);
  return 回.data;
}

const 条 = [];
const 试 = (标题, 做) => 条.push({ 标题, 做 });

// ---------- 一、装配与动作表 ----------

试('V-1 没给取图字节 ⇒ 构造就抛错', () => {
  assert.throws(() => createVisionModule({}), /取图字节/);
});

试('V-2 给了不是函数的端口 ⇒ 构造就抛错', () => {
  assert.throws(() => createVisionModule({ 取图字节: () => null, 查词: '不是函数' }), /查词/);
  assert.throws(() => createVisionModule({ 取图字节: () => null, tagger: {} }), /tagger/);
  assert.throws(() => createVisionModule({ 取图字节: () => null, 看图: 42 }), /看图/);
});

试('V-3 动作表四个动作，出口冻住，不递内部件', () => {
  const 模块 = 装();
  assert.deepStrictEqual([...模块.actions], ['看模型', '认图', '读元数据', '看图']);
  assert.ok(Object.isFrozen(模块));
  assert.strictEqual(模块.core, undefined);
  assert.strictEqual(模块.port, undefined);
});

试('V-4 describe 每一项都有 动作 / 摘要 / 参数 / 说明', () => {
  const 单 = 装().describe();
  assert.strictEqual(单.length, 4);
  for (const 一 of 单) {
    assert.strictEqual(typeof 一.动作, 'string');
    assert.ok(一.摘要 && typeof 一.摘要 === 'string');
    assert.ok(Array.isArray(一.参数));
    assert.ok(一.说明 && typeof 一.说明 === 'object');
  }
  assert.deepStrictEqual(单.find((一) => 一.动作 === '认图').参数, ['存放地', '条目ID', '会话ID?', '阈值?', '上限?']);
  assert.deepStrictEqual(单.find((一) => 一.动作 === '读元数据').参数, ['存放地?', '条目ID?', '会话ID?', '字节?']);
  assert.deepStrictEqual(单.find((一) => 一.动作 === '看图').参数, ['存放地', '条目ID', '会话ID?', '提示?', '参考标签?']);
});

试('V-5 动作表里没有位置类参数名', () => {
  const 禁 = /路径|地址|目录|url|path|dir|models/i;
  for (const 一 of 装().describe()) {
    for (const 名 of 一.参数) assert.ok(!禁.test(名), `${一.动作} 的参数里有位置类名字：${名}`);
  }
});

试('V-6 没有这个动作 ⇒ BAD_ARGUMENT', () => {
  const 回 = 装().run('没有这个');
  assert.strictEqual(回.ok, false);
  assert.strictEqual(回.code, 'VISION_BAD_ARGUMENT');
});

// ---------- 二、看模型 ----------

试('V-7 看模型：端口齐 ⇒ 可用', () => {
  const 回 = 装().run('看模型');
  assert.strictEqual(回.ok, true);
  assert.strictEqual(回.data.可用, true);
  assert.deepStrictEqual(回.data.缺, []);
  assert.strictEqual(回.data.能本地打标, true);
  assert.strictEqual(回.data.能看图, true);
  assert.strictEqual(回.data.能读元数据, true);
  assert.strictEqual(回.data.模型.id, '假引擎');
});

试('V-8 只给最基本的：能读元数据 + 能在，本地打标与看图缺', () => {
  const 模块 = createVisionModule({ 取图字节: () => ({ 字节: 图 }), 读元数据: 读PNG元数据 });
  const 回 = 模块.run('看模型');
  assert.strictEqual(回.data.可用, false);
  assert.deepStrictEqual(回.data.缺, ['本地打标', '看图']);
  assert.strictEqual(回.data.能读元数据, true);
});

// ---------- 三、认图 ----------

试('V-9 认图：过阈值、按概率排、配中文名', async () => {
  const 出 = await 认成功(装(), { ...引用 });
  assert.deepStrictEqual(出.标签.map((一) => 一.词), ['1girl', 'solo', 'hatsune_miku', 'long_hair']);
  assert.strictEqual(出.标签[0].概率, 0.98);
  assert.strictEqual(出.标签[0].中文名, '1个女孩');
  assert.strictEqual(出.标签[2].中文名, '初音未来');
  assert.strictEqual(出.标签[0].分类, '普通');
  assert.strictEqual(出.标签[2].分类, '元数据');
  assert.strictEqual(出.总数, 4);
  assert.deepStrictEqual(出.尺寸, { 宽: 448, 高: 448 });
});

试('V-10 阈值用模型自带的（0.6094）：刚好把 0.61 留下、0.2 丢掉', async () => {
  const 出 = await 认成功(装(), { ...引用 });
  assert.strictEqual(出.阈值, 0.6094);
  assert.ok(!出.标签.some((一) => 一.词 === 'unclear'));
});

试('V-11 给了阈值就按给的筛', async () => {
  const 严 = await 认成功(装(), { ...引用, 阈值: 0.9 });
  assert.deepStrictEqual(严.标签.map((一) => 一.词), ['1girl', 'solo']);
  assert.strictEqual(严.阈值, 0.9);

  const 松 = await 认成功(装(), { ...引用, 阈值: 0.1 });
  assert.strictEqual(松.总数, 5);
});

试('V-12 阈值写得不对（0 / 负数 / 2 / 字符串）⇒ 退回模型自带的', async () => {
  for (const 坏 of [0, -1, 2, '很高']) {
    const 出 = await 认成功(装(), { ...引用, 阈值: 坏 });
    assert.strictEqual(出.阈值, 0.6094, `阈值 ${JSON.stringify(坏)} 该退回模型的`);
  }
});

试('V-13 上限：只要前几个', async () => {
  const 出 = await 认成功(装(), { ...引用, 上限: 2 });
  assert.strictEqual(出.总数, 2);
  assert.deepStrictEqual(出.标签.map((一) => 一.词), ['1girl', 'solo']);
});

试('V-14 没给查词：中文名给 null，别的照旧', async () => {
  const 模块 = createVisionModule({
    取图字节: () => ({ 字节: 图 }),
    tagger: createFakeAdapter({ 标签们 }).tagger,
  });
  const 出 = await 认成功(模块, { ...引用 });
  assert.strictEqual(出.标签[0].词, '1girl');
  assert.strictEqual(出.标签[0].中文名, null);
});

试('V-15 查词给的数量对不上：对不上的给 null，不许串位', async () => {
  const 模块 = 装({ 查词: () => ['只有一个'] });
  const 出 = await 认成功(模块, { ...引用 });
  assert.strictEqual(出.标签[0].中文名, '只有一个');
  assert.strictEqual(出.标签[1].中文名, null);
  assert.strictEqual(出.标签[2].中文名, null);
});

试('V-16 查词抛错：不把整件事带崩，中文名全给 null', async () => {
  const 模块 = 装({
    查词: () => {
      throw new Error('标签库炸了');
    },
  });
  const 出 = await 认成功(模块, { ...引用 });
  assert.strictEqual(出.标签.length, 4);
  assert.strictEqual(出.标签[0].中文名, null);
});

试('V-17 引用不对 ⇒ BAD_REF', async () => {
  const 模块 = 装();
  for (const 坏 of [undefined, null, {}, { 条目ID: 'x' }, { 存放地: 'gallery' }, { 存放地: '别处', 条目ID: 'img_a' }, { 存放地: 'gallery', 条目ID: '  ' }]) {
    const 回 = await 模块.run('认图', 坏 || {});
    assert.strictEqual(回.ok, false, `引用 ${JSON.stringify(坏)} 该被拒`);
    assert.strictEqual(回.code, 'VISION_BAD_REF');
  }
});

试('V-18 图不在库里 ⇒ NO_BYTES', async () => {
  const 回 = await 装().run('认图', { 存放地: 'gallery', 条目ID: 'img_没有' });
  assert.strictEqual(回.ok, false);
  assert.strictEqual(回.code, 'VISION_NO_BYTES');
});

试('V-19 取图字节抛错 ⇒ NO_BYTES，理由带原话', async () => {
  const 模块 = 装({
    取图字节: () => {
      throw new Error('图库读不动');
    },
  });
  const 回 = await 模块.run('认图', { ...引用 });
  assert.strictEqual(回.code, 'VISION_NO_BYTES');
  assert.ok(回.reason.includes('图库读不动'));
});

试('V-20 没给本地打标 ⇒ NO_ENGINE', async () => {
  const 模块 = createVisionModule({ 取图字节: () => ({ 字节: 图 }) });
  const 回 = await 模块.run('认图', { ...引用 });
  assert.strictEqual(回.ok, false);
  assert.strictEqual(回.code, 'VISION_NO_ENGINE');
});

试('V-21 引擎抛错 ⇒ ENGINE_FAILED，理由带原话', async () => {
  const 模块 = 装({
    tagger: {
      打标: () => {
        throw new Error('模型加载失败');
      },
    },
  });
  const 回 = await 模块.run('认图', { ...引用 });
  assert.strictEqual(回.code, 'VISION_ENGINE_FAILED');
  assert.ok(回.reason.includes('模型加载失败'));
});

试('V-22 引擎给的标签缺字段也不崩，缺的给默认', async () => {
  const 模块 = 装({
    tagger: {
      打标: () => ({ 标签: [{ tag: 'a' }, { name: 'b', prob: 0.5 }, { 词: 'c', 概率: 0.7, 分类: 3 }, {}] }),
    },
  });
  const 出 = await 认成功(模块, { ...引用 });
  assert.deepStrictEqual(出.标签.map((一) => 一.词), ['a', 'b', 'c']);
  assert.strictEqual(出.标签[0].概率, null);
  assert.strictEqual(出.标签[2].分类, '角色');
});

试('V-23 标签() 直呼式：成功给数组，失败给空数组', async () => {
  const 模块 = 装();
  const 好 = await 模块.标签({ ...引用 });
  assert.strictEqual(好.length, 4);
  const 坏 = await 模块.标签({ 存放地: 'gallery' });
  assert.deepStrictEqual(坏, []);
});

// ---------- 四、读元数据 ----------

试('V-24 读元数据：正负向与工作流都读出来，尺寸也对', async () => {
  const 回 = await 装().run('读元数据', { ...引用B });
  assert.strictEqual(回.ok, true);
  assert.strictEqual(回.data.尺寸.宽, 8);
  assert.strictEqual(回.data.尺寸.高, 8);
  assert.strictEqual(回.data.提示词, 'a cat, sitting');
  assert.strictEqual(回.data.负向提示词, 'blurry, lowres');
  assert.ok(回.data.工作流.includes('KSampler'));
  assert.ok(回.data.参数.includes('Steps: 20'));
  assert.strictEqual(回.data.全部.Software, 'SomeTool');
});

试('V-24a 直接给字节读元数据：只需解析端口，不取图、不存图', async () => {
  const 模块 = createVisionModule({ 读元数据: (字节) => 读PNG元数据(字节) });
  const 能力 = (await 模块.run('看模型', {})).data;
  assert.strictEqual(能力.能读元数据, true);
  assert.ok(能力.缺.includes('取图字节'));
  const 回 = await 模块.run('读元数据', { 字节: [...带文字的图] });
  assert.strictEqual(回.ok, true);
  assert.strictEqual(回.data.引用, null);
  assert.strictEqual(回.data.提示词, 'a cat, sitting');
  assert.ok(回.data.工作流.includes('KSampler'));

  const 没字节的引用 = await 模块.run('读元数据', { ...引用B });
  assert.strictEqual(没字节的引用.code, 'VISION_NO_BYTES');
});

试('V-25 没有文字块的图：有 = false，各项空串，尺寸还在', async () => {
  const 回 = await 装().run('读元数据', { ...引用 });
  assert.strictEqual(回.ok, true);
  assert.strictEqual(回.data.有, false);
  assert.strictEqual(回.data.提示词, '');
  assert.strictEqual(回.data.尺寸.宽, 4);
});

试('V-26 不是 PNG ⇒ BAD_METADATA', async () => {
  const 模块 = 装({ 取图字节: () => ({ 字节: Buffer.from('这不是图') }) });
  const 回 = await 模块.run('读元数据', { ...引用 });
  assert.strictEqual(回.ok, false);
  assert.strictEqual(回.code, 'VISION_BAD_METADATA');
});

试('V-27 没给读元数据这一支 ⇒ BAD_METADATA（不是崩）', async () => {
  const 模块 = createVisionModule({ 取图字节: () => ({ 字节: 带文字的图 }) });
  const 回 = await 模块.run('读元数据', { ...引用B });
  assert.strictEqual(回.ok, false);
  assert.strictEqual(回.code, 'VISION_BAD_METADATA');
});

试('V-28 元数据解析器本身：iTXt / 键名大小写 / 坏块都不崩', () => {
  const 甲 = 读PNG元数据(造PNG({ 文字: { Prompt: 'hello', 'Negative prompt': 'bad' } }));
  assert.strictEqual(甲.提示词, 'hello');
  assert.strictEqual(甲.负向提示词, 'bad');

  assert.strictEqual(读PNG元数据(Buffer.alloc(0)).有, false);
  assert.strictEqual(读PNG元数据(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9])).有, false);
  // 头对但中间截断
  const 半 = 带文字的图.slice(0, 40);
  const 读 = 读PNG元数据(半);
  assert.strictEqual(typeof 读.有, 'boolean');
});

试('V-28a ComfyUI prompt graph：按采样器分支与上游输出槽提取正负向', () => {
  const 图 = {
    sampler: { class_type: 'KSampler', inputs: { positive: ['join', 0], negative: ['loader', 5] } },
    join: { class_type: 'ConditioningConcat', inputs: { conditioning_to: ['encode', 0], conditioning_from: ['loader', 4] } },
    encode: { class_type: 'CLIPTextEncode', inputs: { text: 'clip extra', clip: ['loader', 3] } },
    loader: { class_type: 'easy fullLoader', inputs: { positive: 'loader positive', negative: 'loader negative' } },
  };
  const 回 = 读PNG元数据(造PNG({ 文字: { prompt: JSON.stringify(图) } }));
  assert.strictEqual(回.提示词, 'clip extra\nloader positive');
  assert.strictEqual(回.负向提示词, 'loader negative');
  assert.strictEqual(回.全部.prompt, JSON.stringify(图));
});

试('V-28b ComfyUI 未知图：保留 JSON 元数据但不把它当提示词', () => {
  const 原文 = JSON.stringify({ node: { class_type: 'UnknownNode', inputs: { text: 'maybe prompt' } } });
  const 回 = 读PNG元数据(造PNG({ 文字: { prompt: 原文 } }));
  assert.strictEqual(回.提示词, '');
  assert.strictEqual(回.负向提示词, '');
  assert.strictEqual(回.全部.prompt, 原文);
});

试('V-28b1 未知 JSON 数组不作为提示词，原始字段保留', () => {
  const 原文 = '["unknown graph", {"text":"not prompt"}]';
  const 回 = 读PNG元数据(造PNG({ 文字: { prompt: 原文 } }));
  assert.strictEqual(回.提示词, '');
  assert.strictEqual(回.全部.prompt, 原文);
});

试('V-28c ComfyUI workflow：按连线与 easy fullLoader 输出槽提取正负向', () => {
  const 图 = {
    nodes: [
      { id: 1, type: 'KSampler', inputs: [{ name: 'positive', link: 10 }, { name: 'negative', link: 11 }] },
      { id: 2, type: 'CLIPTextEncode', inputs: [], widgets_values: ['workflow clip'] },
      { id: 3, type: 'ConditioningConcat', inputs: [{ name: 'conditioning_to', link: 12 }, { name: 'conditioning_from', link: 13 }] },
      { id: 4, type: 'easy fullLoader', inputs: [], widgets_values: ['', '', '', '', '', '', '', '', '', '', 'workflow positive', '', '', 'workflow negative'] },
      { id: 5, type: 'ControlNetApplyAdvanced', inputs: [{ name: 'positive', link: 14 }, { name: 'negative', link: 15 }] },
      { id: 6, type: 'Reroute', inputs: [{ name: '', link: 16 }] },
    ],
    links: [
      [10, 5, 0, 1, 1, 'CONDITIONING'],
      [11, 5, 1, 1, 2, 'CONDITIONING'],
      [12, 2, 0, 3, 0, 'CONDITIONING'],
      [13, 4, 4, 3, 1, 'CONDITIONING'],
      [14, 6, 0, 5, 0, 'CONDITIONING'],
      [15, 4, 5, 5, 1, 'CONDITIONING'],
      [16, 3, 0, 6, 0, 'CONDITIONING'],
    ],
  };
  const 回 = 读PNG元数据(造PNG({ 文字: { workflow: JSON.stringify(图) } }));
  assert.strictEqual(回.提示词, 'workflow clip\nworkflow positive');
  assert.strictEqual(回.负向提示词, 'workflow negative');
  assert.strictEqual(回.工作流, JSON.stringify(图));
});

// ---------- 五、看图 ----------

试('V-29 看图：把提示与参考标签带过去，交回标签与描述', async () => {
  let 见过 = null;
  const 模块 = 装({
    看图: async (输入) => {
      见过 = 输入;
      return { 标签: [{ 词: 'cat', 概率: 0.9 }], 描述: '一只猫', 模型: '看图模型' };
    },
  });
  const 回 = await 模块.run('看图', { ...引用, 提示: '看什么动物', 参考标签: ['1girl', 'solo'] });
  assert.strictEqual(回.ok, true);
  assert.strictEqual(回.data.描述, '一只猫');
  assert.strictEqual(回.data.标签[0].词, 'cat');
  assert.strictEqual(回.data.模型, '看图模型');
  assert.strictEqual(见过.提示, '看什么动物');
  assert.deepStrictEqual(见过.参考标签, ['1girl', 'solo']);
  assert.ok(Buffer.isBuffer(见过.字节) || 见过.字节 instanceof Uint8Array, '字节要带过去');
});

试('V-30 看图默认：不给提示与参考标签也能走', async () => {
  const 回 = await 装().run('看图', { ...引用 });
  assert.strictEqual(回.ok, true);
  assert.ok(回.data.描述.includes('假描述'));
});

试('V-31 没给看图这一支 ⇒ NO_VIEWER', async () => {
  const 模块 = createVisionModule({ 取图字节: () => ({ 字节: 图 }) });
  const 回 = await 模块.run('看图', { ...引用 });
  assert.strictEqual(回.ok, false);
  assert.strictEqual(回.code, 'VISION_NO_VIEWER');
});

试('V-32 看图那条链路抛错 ⇒ VIEW_FAILED，理由带原话', async () => {
  const 模块 = 装({
    看图: async () => {
      throw new Error('模型拒了这张图');
    },
  });
  const 回 = await 模块.run('看图', { ...引用 });
  assert.strictEqual(回.code, 'VISION_VIEW_FAILED');
  assert.ok(回.reason.includes('模型拒了这张图'));
});

试('V-33 看图回来的标签也配中文名', async () => {
  const 模块 = 装({ 看图: async () => ({ 标签: [{ 词: '1girl', 概率: 0.8 }], 描述: 'x' }) });
  const 回 = await 模块.run('看图', { ...引用 });
  assert.strictEqual(回.data.标签[0].中文名, '1个女孩');
});

// ---------- 六、适配器与端口 ----------

试('V-34 真实适配器：递什么给什么，缺的给 null', () => {
  const 端口 = createRealAdapter({ 取图字节: () => null });
  assert.strictEqual(typeof 端口.取图字节, 'function');
  assert.strictEqual(端口.查词, null);
  assert.strictEqual(端口.tagger, null);
  assert.strictEqual(端口.看图, null);
  assert.strictEqual(端口.读元数据, null);
  assert.throws(() => createRealAdapter({}), /取图字节/);
  assert.throws(() => createRealAdapter({ 取图字节: () => null, tagger: {} }), /tagger/);
});

试('V-34a 真实适配器：只给元数据解析端口也能读直接字节', () => {
  const 端口 = createRealAdapter({ 读元数据: (字节) => ({ 字节 }) });
  assert.strictEqual(端口.取图字节, null);
  assert.strictEqual(端口.读元数据(Buffer.from([1])).字节[0], 1);
});

试('V-35 端口清单五项，名字与形状都在', () => {
  const 模块 = 装();
  assert.deepStrictEqual(模块.端口.map((一) => 一.名), ['取图字节', '查词', 'tagger', '看图', '读元数据']);
  for (const 一 of 模块.端口) assert.ok(一.形状 && typeof 一.形状 === 'string');
});

试('V-36 分类号 → 人话：0 普通 / 1 画师 / 3 角色 / 4 元数据 / 9 分级 / 别的当普通', () => {
  const 模块 = 装();
  assert.strictEqual(模块.分类名[0], '普通');
  assert.strictEqual(模块.分类名[1], '画师');
  assert.strictEqual(模块.分类名[3], '角色');
  assert.strictEqual(模块.分类名[4], '元数据');
  assert.strictEqual(模块.分类名[9], '分级');
  assert.strictEqual(模块.分类名[77], undefined);
});

试('V-37 造图工具自己是对的：造出来的 PNG 头对、IHDR 尺寸对', () => {
  const 图2 = 造PNG({ 宽: 8, 高: 8 });
  assert.deepStrictEqual([...图2.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const 读 = 读PNG元数据(图2);
  assert.strictEqual(读.尺寸.宽, 8);
  assert.strictEqual(读.尺寸.高, 8);
});

// ---------- 跑 ----------

(async () => {
  const 过滤 = process.argv[2] || '';
  let 过 = 0;
  let 败 = 0;
  for (const 一 of 条) {
    if (过滤 && !一.标题.includes(过滤)) continue;
    try {
      await 一.做();
      过++;
      console.log(`  ok   ${一.标题}`);
    } catch (error) {
      败++;
      console.log(`  FAIL ${一.标题}`);
      console.log(`       ${(error && error.message) || error}`);
    }
  }
  console.log(`\n${过} 过 / ${败} 失败`);
  process.exit(败 === 0 ? 0 : 1);
})();
