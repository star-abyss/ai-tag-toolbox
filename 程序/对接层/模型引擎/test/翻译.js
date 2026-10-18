import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 造译端口 } from '../翻译.js';

const 项目根 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const 模型目录 = path.join(项目根, '模型');
const 空翻译 = 造译端口({ 模型目录: path.join(项目根, '不存在的模型目录') });
assert.deepEqual(await 空翻译({ source: '', units: [], from: '英文', to: '中文' }), { 模型: null, units: [] });
const 翻译 = 造译端口({ 模型目录, 格: 'opus-mt' });

async function 实测(名, 报文) {
  const 开始 = performance.now();
  const 结果 = await 翻译(报文);
  const 毫秒 = Math.round(performance.now() - 开始);
  assert.equal(结果.模型, 'opus-mt');
  assert.equal(结果.units.length, 报文.units.length);
  assert.deepEqual(结果.units.map((一) => 一.id), 报文.units.map((一) => 一.id));
  assert.ok(结果.units.every((一) => typeof 一.text === 'string' && 一.text.trim()));
  console.log(JSON.stringify({ 名, 模型: 结果.模型, 毫秒, 输入: 报文.units.map((一) => ({ id: 一.id, text: 一.text })), 输出: 结果.units.map((一) => ({ id: 一.id, chars: 一.text.length, text: 一.text.slice(0, 80) })) }));
  return 结果;
}

const 报文 = {
  source: 'a cat sits on the mat; a cat sits on the mat',
  units: [
    { id: 'first', text: 'a cat sits on the mat' },
    { id: 'different', text: 'a blue dog is running' },
    { id: 'repeat', text: 'a cat sits on the mat' },
  ],
  from: '英文',
  to: '中文',
};
const 结果 = await 实测('重复句 en-zh', 报文);
assert.equal(结果.units[0].text, 结果.units[2].text);
assert.match(结果.units[0].text, /猫/);
assert.match(结果.units[1].text, /狗/);
assert.match(结果.units[0].text, /垫子/);

const 英中混合 = await 实测('混合文字 en-zh', {
  source: '  girl with 红色头发，  ',
  units: [{ id: 'mixed', text: '  girl with 红色头发，  ' }],
  from: '英文',
  to: '中文',
});
assert.ok(英中混合.units[0].text.includes(' 红色头发，  '), 'en-zh 应原样保留中文片段及其外围空白和标点');
assert.ok(英中混合.units[0].text.includes('女孩'), 'en-zh 应翻译混合单元中的英文短语');
assert.ok(英中混合.units[0].text.length < 100, 'en-zh 混合译文不应退化成重复长输出');
assert.equal(英中混合.units[0].id, 'mixed');
assert.ok(英中混合.units[0].text.startsWith('  '), 'en-zh 应保留单元前导空白');
assert.ok(英中混合.units[0].text.endsWith('  '), 'en-zh 应保留单元尾随空白');

const 中英混合 = await 实测('混合文字 zh-en', {
  source: '红色头发  with long hair',
  units: [{ id: 'mixed-reverse', text: '红色头发  with long hair' }],
  from: '中文',
  to: '英文',
});
assert.ok(/red hair/i.test(中英混合.units[0].text), 'zh-en 应翻译混合单元中的中文短语');
assert.ok(中英混合.units[0].text.includes('  with long hair'), 'zh-en 应原样保留英文片段及其外围空白');
assert.ok(中英混合.units[0].text.length < 100, 'zh-en 混合译文不应退化成重复长输出');
assert.equal(中英混合.units[0].id, 'mixed-reverse');

await 实测('句子 zh-en', {
  source: '猫坐在垫子上',
  units: [{ id: 'sentence', text: '猫坐在垫子上' }],
  from: '中文',
  to: '英文',
});

console.log('翻译引擎端口自检通过：en-zh、zh-en 与混合文字均返回非空逐单元结果');
