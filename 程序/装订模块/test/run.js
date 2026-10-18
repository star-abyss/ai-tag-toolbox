'use strict';
/*
 * 功能自检 —— 装订模块。
 *
 *   node test/run.js            全部
 *   node test/run.js 关键词      只跑名字里含"关键词"的
 */

const assert = require('assert');

const { createBindingModule } = require('../index.js');
const { createFakeAdapter } = require('../adapter-fake.js');

const 过滤 = process.argv[2] || '';

/** 一个装好的模块；库和译文表按需要给。 */
function 建(选项 = {}) {
  const 端口 = createFakeAdapter({
    库: 选项.库 || {},
    译文: 选项.译文 || {},
    回成: 选项.回成,
    不发: 选项.不发,
    查词抛错: 选项.查词抛错,
    翻译抛错: 选项.翻译抛错,
    慢: 选项.慢,
  });
  const 模块 = createBindingModule(端口);
  return { 模块, 端口 };
}

/** 切分后每个单元的「词」。 */
const 词们 = (模块, 文本) => 模块.切分({ 文本 }).map((格) => 格.词);
const 旧形状 = 格 => ({ 前: 格.前, 词: 格.词, 后: 格.后 });

/** 切分后单元个数。 */
const 几个 = (模块, 文本) => 模块.切分({ 文本 }).length;

const 判据 = [];
const 试 = (名字, 做) => 判据.push({ 名字, 做 });

// ---------------------------------------------------------------- 切分四规则

试('V-1 按逗号切', () => {
  const { 模块 } = 建();
  assert.strictEqual(几个(模块, 'a, b'), 2);
});

试('V-2 括号深度内的逗号不算分隔符', () => {
  const { 模块 } = 建();
  assert.strictEqual(几个(模块, '(a, b), c'), 2);
});

试('V-3 转义逗号是字面量', () => {
  const { 模块 } = 建();
  const 格 = 模块.切分({ 文本: 'a\\,b, c' });
  assert.strictEqual(格.length, 2);
  assert.strictEqual(格[0].词, 'a\\,b');
});

试('V-4 反斜杠一次吃两个字符，后面的逗号仍算分隔符', () => {
  const { 模块 } = 建();
  assert.strictEqual(几个(模块, 'a\\\\,b'), 2);
  assert.strictEqual(几个(模块, 'a \\\\, b'), 2);
});

试('V-5 括号不平衡 ⇒ 整段一个单元', () => {
  const { 模块 } = 建();
  assert.strictEqual(几个(模块, '(a, b'), 1);
});

试('V-6 括号交错 ⇒ 整段一个单元', () => {
  const { 模块 } = 建();
  assert.strictEqual(几个(模块, 'a), (b'), 1);
});

试('V-7 转义括号整段是词，前后缀为空', () => {
  const { 模块 } = 建();
  const 格 = 模块.切分({ 文本: '\\(x\\)' });
  assert.strictEqual(格.length, 1);
  assert.deepStrictEqual(旧形状(格[0]), { 前: '', 词: '\\(x\\)', 后: '' });
});

试('V-8 括号加权重：前是括号，后是权重', () => {
  const { 模块 } = 建();
  const 格 = 模块.切分({ 文本: '(x:1.3)' });
  assert.strictEqual(格.length, 1);
  assert.deepStrictEqual(旧形状(格[0]), { 前: '(', 词: 'x', 后: ':1.3)' });
});

试('V-9 空单元保留，形状是三字段都空', () => {
  const { 模块 } = 建();
  const 格 = 模块.切分({ 文本: 'a, , b' });
  assert.strictEqual(格.length, 3);
  assert.deepStrictEqual(旧形状(格[1]), { 前: '', 词: '', 后: '' });
});

试('V-10 换行、顿号、全角分号、竖线都算分隔符', () => {
  const { 模块 } = 建();
  assert.strictEqual(几个(模块, 'a\nb'), 2);
  assert.strictEqual(几个(模块, 'a、b；c'), 3);
  assert.strictEqual(几个(模块, 'a｜b'), 2);
});

试('V-11 CRLF 与 LF 等价，\\r 不进单元', () => {
  const { 模块 } = 建();
  const 格 = 模块.切分({ 文本: 'a\r\nb' });
  assert.strictEqual(格.length, 2);
  assert.deepStrictEqual(词们(模块, 'a\r\nb'), ['a', 'b']);
});

试('V-12 整段是一对没过转义的圆括号 ⇒ 括号进前后缀', () => {
  const { 模块 } = 建();
  assert.deepStrictEqual(旧形状(模块.切分({ 文本: '(flat_breasts)' })[0]), { 前: '(', 词: 'flat_breasts', 后: ')' });
  assert.deepStrictEqual(旧形状(模块.切分({ 文本: '[short hair]' })[0]), { 前: '[', 词: 'short hair', 后: ']' });
});

试('V-13 剥完没内容 ⇒ 退，整段当词', () => {
  const { 模块 } = 建();
  assert.strictEqual(模块.切分({ 文本: '(a)(b)' })[0].词, '(a)(b)');
});

试('V-14 切分与拼回互为逆：每一格拼回去等于原格', () => {
  const { 模块 } = 建();
  const 样本 = [
    ['a, b', ['a', 'b']],
    ['(a, b), c', ['(a, b)', 'c']],
    ['a\\,b, c', ['a\\,b', 'c']],
    ['a,b', ['a', 'b']],
    ['a, , b', ['a', '', 'b']],
    ['a\nb', ['a', 'b']],
    ['a、b；c', ['a', 'b', 'c']],
    ['a｜b', ['a', 'b']],
    ['masterpiece, best quality, score_7', ['masterpiece', 'best quality', 'score_7']],
    // 词段与后缀段不许重叠
    ['(nsfw:1.2, 1girl)', ['(nsfw:1.2, 1girl)']],
    ['(a:1.3:2.0)', ['(a:1.3:2.0)']],
    ['(x:1.2 y)', ['(x:1.2 y)']],
    ['[a:1.2, b]', ['[a:1.2, b]']],
    // 括号不平衡：整段一格，前后都空
    ['1girl, (masterpiece:1.2', ['1girl, (masterpiece:1.2']],
  ];
  for (const [文, 期望格] of 样本) {
    const 格 = 模块.切分({ 文本: 文 });
    const 拼 = 格.map((x) => x.前 + x.词 + x.后);
    assert.deepStrictEqual(拼, 期望格, `逆不过去：${JSON.stringify(文)}`);
    for (const x of 格) assert.strictEqual(x.前 + x.词 + x.后, x.前 + x.词 + x.后);
  }
});

// ---------------------------------------------------------------- 13 条真数据

const 真数据 = {
  '例4 转义括号整段是词': ['masterpiece, hatsune miku, \\(rabbit hole\\), 1girl, nsfw', ['masterpiece', 'hatsune miku', '\\(rabbit hole\\)', '1girl', 'nsfw']],
  '例9 权重与退化': ['(profile:2), on side, (flat_breasts), ((smug, smug face):1.5)', ['profile', 'on side', 'flat_breasts', '((smug, smug face):1.5)']],
  '例10 词里的冒号不是权重': ['rem \\(re:zero\\), (pussy:1.2), (three quarter view:1.35)', ['rem \\(re:zero\\)', 'pussy', 'three quarter view']],
  '例12 转义括号带连字符': ['1girl, keqing \\(genshin impact\\), solo', ['1girl', 'keqing \\(genshin impact\\)', 'solo']],
  '例5 lora 方言按整词切': ['<lora:lingyin-huang-s2-anima-lora-nochekaiser:1>, lingyin huang', ['<lora:lingyin-huang-s2-anima-lora-nochekaiser:1>', 'lingyin huang']],
  '例6 粘在一起的括号权重不猜': ['colored skin, dark grey skin (dark grey skin:1.3),from below', ['colored skin', 'dark grey skin (dark grey skin:1.3)', 'from below']],
  '例2 空单元来自行首行尾': ['masterpiece, score_7\n@rororoANIMAstyle, \n, shiori novella, solo', ['masterpiece', 'score_7', '@rororoANIMAstyle', 'shiori novella', 'solo']],
};

for (const [名字, [文本, 期望]] of Object.entries(真数据)) {
  试(`V-15 ${名字}`, () => {
    const { 模块 } = 建();
    const 得 = 词们(模块, 文本).filter((x) => x !== '');
    assert.deepStrictEqual(得, 期望);
  });
}

试('V-16 尖括号 / 花括号只挡 :数字：带 :数字 的整段是词，只带冒号的照常剥壳', () => {
  const { 模块 } = 建();
  const 剥 = (文) => 模块.切分({ 文本: 文 })[0];
  assert.deepStrictEqual(旧形状(剥('<lora:x:1>')), { 前: '', 词: '<lora:x:1>', 后: '' });
  assert.deepStrictEqual(旧形状(剥('{lora:abc:1}')), { 前: '', 词: '{lora:abc:1}', 后: '' });
  assert.deepStrictEqual(旧形状(剥('<lora:x>')), { 前: '<', 词: 'lora:x', 后: '>' });
  assert.deepStrictEqual(旧形状(剥('{lora:abc}')), { 前: '{', 词: 'lora:abc', 后: '}' });
});

// ---------------------------------------------------------------- 报文

试('V-20 报文只带原文与待译的词，不带值', async () => {
  const { 模块, 端口 } = 建({ 库: { 'hatsune miku': '初音未来' }, 译文: { 'blue eyes': '蓝眼' } });
  await 模块.装订('hatsune miku, blue eyes');
  const 报文 = 端口.记.发过的[0];
  assert.deepStrictEqual(Object.keys(报文).sort(), ['from', 'source', 'to', 'words']);
  assert.deepStrictEqual(报文.words, ['blue eyes']);
  assert.strictEqual(报文.source, 'hatsune miku, blue eyes');
  assert.strictEqual(报文.from, '英文');
  assert.strictEqual(报文.to, '中文');
});

试('V-21 库里有译名的词根本不发出去', async () => {
  const { 模块, 端口 } = 建({ 库: { a: '甲' }, 译文: { b: '乙' } });
  await 模块.装订('a, b');
  assert.deepStrictEqual(端口.记.发过的[0].words, ['b']);
});

试('V-22 没有要译的词时，一次都不发', async () => {
  const { 模块, 端口 } = 建({ 库: { a: '甲' } });
  const 果 = await 模块.装订('a');
  assert.strictEqual(果.ok, true);
  assert.strictEqual(果.译文, '甲');
  assert.strictEqual(端口.记.发过的.length, 0);
});

试('V-23 查词只拿到「词」，不带壳', async () => {
  const { 模块, 端口 } = 建({ 库: {} });
  await 模块.装订('(waist up:1.2), blue eyes');
  assert.deepStrictEqual(端口.记.查过的[0], ['waist up', 'blue eyes']);
});

// ---------------------------------------------------------------- 归位

试('V-30 库译名优先，模型碰都碰不到', async () => {
  const { 模块, 端口 } = 建({ 库: { a: '甲' }, 译文: { a: '模型版' } });
  const 果 = await 模块.装订('a');
  assert.strictEqual(果.译文, '甲');
  assert.strictEqual(端口.记.发过的.length, 0);
});

试('V-31 缺键的那一行退原词，其余照填', async () => {
  const { 模块 } = 建({ 库: {}, 译文: { a: '甲', b: '乙' }, 不发: ['b'] });
  const 果 = await 模块.装订('a, b, c');
  assert.strictEqual(果.ok, true);
  assert.strictEqual(果.译文, '甲, b, 〔c〕');
  // c 没在译文表里，假适配器给「〔c〕」；b 被故意不回，退原词
});

试('V-32 值不是字符串 ⇒ 那一行退原词', async () => {
  const { 模块 } = 建({ 译文: { a: 123, b: '乙' } });
  const 果 = await 模块.装订('a, b');
  assert.strictEqual(果.译文, 'a, 乙');
});

试('V-33 多出来的键丢掉，不影响别人', async () => {
  const { 模块 } = 建({ 译文: { a: '甲', 多出来的: '不该出现' } });
  const 果 = await 模块.装订('a, b');
  assert.strictEqual(果.译文, '甲, 〔b〕');
  assert.ok(!果.译文.includes('不该出现'));
});

试('V-34 重复的词落进每一格', async () => {
  const { 模块 } = 建({ 译文: { a: '甲' } });
  const 果 = await 模块.装订('a, b, a');
  assert.strictEqual(果.译文, '甲, 〔b〕, 甲');
});

试('V-35 壳原样跟回来', async () => {
  const { 模块 } = 建({ 译文: { 'waist up': '上半身' } });
  const 果 = await 模块.装订('(waist up:1.2)');
  assert.strictEqual(果.译文, '(上半身:1.2)');
});

// ---------------------------------------------------------------- 返回形状

试('V-40 直接是对象', async () => {
  const { 模块 } = 建({ 译文: { a: '甲' }, 回成: '对象' });
  assert.strictEqual((await 模块.装订('a')).译文, '甲');
});

试('V-41 ```json 围栏能剥掉', async () => {
  const { 模块 } = 建({ 译文: { a: '甲' }, 回成: '围栏' });
  assert.strictEqual((await 模块.装订('a')).译文, '甲');
});

试('V-42 前后有废话能剥掉', async () => {
  const { 模块 } = 建({ 译文: { a: '甲' }, 回成: '废话' });
  assert.strictEqual((await 模块.装订('a')).译文, '甲');
});

试('V-43 从第一个 { 截到最后一个 }', async () => {
  const { 模块 } = 建({ 译文: { a: '甲' }, 回成: '截取' });
  assert.strictEqual((await 模块.装订('a')).译文, '甲');
});

试('V-44 数组不是键值对 ⇒ 整次失败退原文', async () => {
  const { 模块 } = 建({ 译文: { a: '甲' }, 回成: '数组' });
  const 果 = await 模块.装订('a, b');
  assert.strictEqual(果.ok, false);
  assert.strictEqual(果.code, 'TEXT_BAD_ANSWER');
  assert.strictEqual(果.译文, undefined);
  assert.strictEqual(果.原文, 'a, b');
});

试('V-45 整段废话解析不出 ⇒ 整次失败退原文', async () => {
  const { 模块 } = 建({ 译文: { a: '甲' }, 回成: '乱码' });
  const 果 = await 模块.装订('a');
  assert.strictEqual(果.ok, false);
  assert.strictEqual(果.code, 'TEXT_BAD_ANSWER');
  assert.strictEqual(果.原文, 'a');
});

试('V-46 前 40 个 { 都不是 JSON，第 41 个才是 ⇒ 仍解析得出', async () => {
  const 前言 = Array.from({ length: 40 }, (_, i) => `{${i} 不是 JSON`).join(' ') + ' ';
  const 模块 = createBindingModule({ AI翻译: async () => 前言 + JSON.stringify({ a: '甲' }) });
  const 果 = await 模块.装订('a');
  assert.strictEqual(果.ok, true);
  assert.strictEqual(果.译文, '甲');
});

// ---------------------------------------------------------------- 空单元

试('V-50 空单元不查、不发，原始空项仍保留', async () => {
  const { 模块, 端口 } = 建({ 译文: { a: '甲', b: '乙' } });
  const 果 = await 模块.装订('a, , b');
  assert.strictEqual(果.ok, true);
  assert.strictEqual(果.译文, '甲, , 乙');
  assert.deepStrictEqual(端口.记.查过的[0], ['a', 'b']);
  assert.deepStrictEqual(端口.记.发过的[0].words, ['a', 'b']);
});

试('V-51 原文首尾的空单元与所有分隔符保留', async () => {
  const { 模块 } = 建({ 译文: { a: '甲', b: '乙' } });
  assert.strictEqual((await 模块.装订(', a, , b,')).译文, ', 甲, , 乙,');
  assert.strictEqual((await 模块.装订('a,,,b')).译文, '甲,,,乙');
});

试('V-52 只有分隔符和空格时原样保留', async () => {
  const { 模块 } = 建();
  const 果 = await 模块.装订(', ,');
  assert.strictEqual(果.ok, true);
  assert.strictEqual(果.译文, ', ,');
});

试('V-53 原文与译文各切一遍、两边都过 有内容的格 ⇒ 格数与序号一一对应', async () => {
  const { 模块 } = 建({ 库: { 'hatsune miku': '初音未来' }, 译文: { 'blue eyes': '蓝眼', 'shiina mahiru': '椎名真昼' } });
  const 原文 = '(red hair:1.3), blue eyes, hatsune miku, , shiina mahiru';
  const 果 = await 模块.装订(原文);
  assert.strictEqual(果.ok, true);
  assert.strictEqual(果.译文, '(〔red hair〕:1.3), 蓝眼, 初音未来, , 椎名真昼');

  const 原文格 = 模块.有内容的格(模块.切分({ 文本: 果.原文 }));
  const 译文格 = 模块.有内容的格(模块.切分({ 文本: 果.译文 }));

  assert.strictEqual(原文格.length, 译文格.length, '两边格数不等，高亮会错位');
  assert.strictEqual(原文格.length, 4);
  assert.deepStrictEqual(原文格.map((x) => x.词), ['red hair', 'blue eyes', 'hatsune miku', 'shiina mahiru']);
  assert.deepStrictEqual(译文格.map((x) => x.词), ['〔red hair〕', '蓝眼', '初音未来', '椎名真昼']);
});

试('V-54 装订回执范围使用 UTF-16，包含完整 tag 壳并落在实际译文上', async () => {
  const { 模块 } = 建({ 库: { a: '甲', b: '乙' } });
  const 原文 = '😀, (a:1.2), b';
  const 果 = await 模块.装订(原文);
  assert.strictEqual(果.译文, '😀, (甲:1.2), 乙');
  assert.deepStrictEqual(果.表.map(row => row.原文范围), [[0, 2], [4, 11], [13, 14]]);
  assert.deepStrictEqual(果.表.map(row => row.词范围), [[0, 2], [5, 6], [13, 14]]);
  assert.deepStrictEqual(果.表.map(row => row.译文范围), [[0, 2], [4, 11], [13, 14]]);
  for (const row of 果.表) {
    assert.strictEqual(原文.slice(...row.原文范围), row.前 + row.词 + row.后);
    assert.strictEqual(果.译文.slice(...row.译文范围), row.前 + row.译文 + row.后);
  }
});

// ---------------------------------------------------------------- 鲁棒性

试('V-60 表随一次装订生灭：两次调用互不影响', async () => {
  const { 模块 } = 建({ 译文: { a: '甲', b: '乙' } });
  const 一 = await 模块.装订('a');
  const 二 = await 模块.装订('b');
  assert.strictEqual(一.译文, '甲');
  assert.strictEqual(二.译文, '乙');
});

试('V-61 上一次没回来时再点 ⇒ 拒绝，报 TEXT_BUSY', async () => {
  const { 模块 } = 建({ 译文: { a: '甲' }, 慢: 30 });
  const 在飞 = 模块.装订('a');
  const 第二次 = await 模块.装订('a');
  assert.strictEqual(第二次.ok, false);
  assert.strictEqual(第二次.code, 'TEXT_BUSY');
  assert.strictEqual(第二次.原文, 'a');
  assert.strictEqual((await 在飞).译文, '甲');
});

试('V-62 拒绝之后闸门还会开：下一次照常能用', async () => {
  const { 模块 } = 建({ 译文: { a: '甲' }, 慢: 20 });
  const 在飞 = 模块.装订('a');
  await 模块.装订('a');
  await 在飞;
  assert.strictEqual((await 模块.装订('a')).译文, '甲');
});

试('V-63 执行器抛错 ⇒ 整次失败退原文，且闸门开着', async () => {
  const { 模块 } = 建({ 翻译抛错: true });
  const 果 = await 模块.装订('a, b');
  assert.strictEqual(果.ok, false);
  assert.strictEqual(果.code, 'TEXT_TRANSLATOR_FAILED');
  assert.strictEqual(果.原文, 'a, b');
  const 再 = await 模块.装订('a, b');
  assert.notStrictEqual(再.code, 'TEXT_BUSY', '抛错之后闸门该是开着的');
});

试('V-64 查词抛错 ⇒ 整次失败退原文', async () => {
  const { 模块 } = 建({ 查词抛错: true, 译文: { a: '甲' } });
  const 果 = await 模块.装订('a');
  assert.strictEqual(果.ok, false);
  assert.strictEqual(果.code, 'TEXT_LOOKUP_FAILED');
  assert.strictEqual(果.原文, 'a');
});

试('V-65 没递 AI 翻译 ⇒ 用到它时失败退原文', async () => {
  const 模块 = createBindingModule({ 查词: (词们) => 词们.map(() => null) });
  const 果 = await 模块.装订('a, b');
  assert.strictEqual(果.ok, false);
  assert.strictEqual(果.code, 'TEXT_NO_TRANSLATOR');
  assert.strictEqual(果.原文, 'a, b');
});

试('V-66 没递查词 ⇒ 不是失败，所有词都交给 AI', async () => {
  const 端口 = createFakeAdapter({ 译文: { a: '甲', b: '乙' } });
  const 模块 = createBindingModule({ AI翻译: 端口.AI翻译 });
  const 果 = await 模块.装订('a, b');
  assert.strictEqual(果.ok, true);
  assert.strictEqual(果.译文, '甲, 乙');
});

试('V-67 库里有答案就不用 AI：一个都不发', async () => {
  const 端口 = createFakeAdapter({ 库: { a: '甲', b: '乙' } });
  const 模块 = createBindingModule({ 查词: 端口.查词, AI翻译: 端口.AI翻译 });
  const 果 = await 模块.装订('a, b');
  assert.strictEqual(果.ok, true);
  assert.strictEqual(果.译文, '甲, 乙');
  assert.strictEqual(端口.记.发过的.length, 0);
});

试('V-68 空文本：不炸，给空串', async () => {
  const { 模块 } = 建();
  const 果 = await 模块.装订('');
  assert.strictEqual(果.ok, true);
  assert.strictEqual(果.译文, '');
});

试('V-69 非字符串进得来也不炸', async () => {
  const { 模块 } = 建({ 译文: { 1: '一' } });
  const 果 = await 模块.装订(1);
  assert.strictEqual(果.ok, true);
  assert.strictEqual(果.译文, '1');
});

// ---------------------------------------------------------------- 门面与端口

试('V-80 两个动作，出口冻住，不递内部件', () => {
  const { 模块 } = 建();
  assert.deepStrictEqual([...模块.actions].sort(), ['切分', '装订']);
  assert.strictEqual(Object.isFrozen(模块), true);
  assert.strictEqual(模块.core, undefined);
  assert.strictEqual(模块.port, undefined);
});

试('V-81 describe() 给的参数名里没有路径 / 地址', () => {
  const { 模块 } = 建();
  for (const 一条 of 模块.describe()) {
    for (const 名 of 一条.参数) {
      assert.ok(!/路径|地址|path|url/i.test(名), `参数名不该出现路径：${名}`);
    }
  }
});

试('V-82 直呼式：成功给数据，失败给 null', async () => {
  const { 模块 } = 建({ 译文: { a: '甲' } });
  assert.strictEqual(模块.切分({ 文本: 'a, b' }).length, 2);
  assert.strictEqual(await 模块.译文('a'), '甲');
});

试('V-83 没有这个动作 ⇒ 可分辨的失败', () => {
  const { 模块 } = 建();
  const 果 = 模块.run('不存在的动作', {});
  assert.strictEqual(果.ok, false);
  assert.strictEqual(果.code, 'BIND_BAD_ARGUMENT');
});

试('V-84 端口给了不是函数的 ⇒ 装配即抛错', () => {
  assert.throws(() => createBindingModule({ 查词: '不是函数' }), /查词/);
});

试('V-85 「上一次还没回来」这句人话在回执里', async () => {
  const { 模块 } = 建({ 译文: { a: '甲' }, 慢: 20 });
  const 在飞 = 模块.装订('a');
  const 第二次 = await 模块.装订('a');
  assert.strictEqual(第二次.reason, 'TEXT_BUSY: 上一次翻译还没回来');
  await 在飞;
});

试('V-86 装订保留原文既有分隔符格式', async () => {
  const 端口 = createFakeAdapter({ 译文: { a: '甲', b: '乙' } });
  const 模块 = createBindingModule({ ...端口 });
  assert.strictEqual((await 模块.装订('a,b')).译文, '甲,乙');
  assert.strictEqual((await 模块.装订('a, b')).译文, '甲, 乙');
  assert.strictEqual((await 模块.装订('a\nb')).译文, '甲\n乙');
});

试('V-87 输入转换抛错 ⇒ 明确失败回执', async () => {
  const 坏 = { toString() { throw new Error('转不出字符串'); } };
  const { 模块 } = 建();
  const 果 = await 模块.装订(坏);
  assert.strictEqual(果.ok, false);
  assert.strictEqual(果.code, 'BIND_BAD_ARGUMENT');
  assert.strictEqual(果.原文, '');
  assert.strictEqual(果.原因, '转不出字符串');
});

// ---------------------------------------------------------------- 跑

let 过 = 0;
let 败 = 0;
const 失败 = [];

(async () => {
  for (const { 名字, 做 } of 判据) {
    if (过滤 && !名字.includes(过滤)) continue;
    try {
      await 做();
      process.stdout.write('.');
      过 += 1;
    } catch (error) {
      process.stdout.write('x');
      败 += 1;
      失败.push({ 名字, 消息: (error && error.message) || String(error) });
    }
  }

  process.stdout.write('\n\n');
  for (const { 名字, 消息 } of 失败) process.stdout.write(`✗ ${名字}\n    ${消息}\n`);
  process.stdout.write(`\n${过} 通过 / ${败} 失败\n`);
  process.exit(败 ? 1 : 0);
})();
