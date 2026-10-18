import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 起, 这次启动的令牌 } from '../服务.js';
import { 临时项目 } from './会话装置.js';

const fixture = 临时项目();
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-translation-http-'));
const server = 起({ 端口: 0, 项目根: fixture.root, 数据目录: data });
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const records = [];
async function translate(text, direction = 'en-zh') {
  const start = performance.now();
  const result = await (await fetch(base + '/toolbox/调', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 这次启动的令牌 },
    body: JSON.stringify({ 模块: 'translate', 动作: '本地译', 参数: { 文本: text, 方向: direction } }),
  })).json();
  assert.notEqual(result.ok, false, JSON.stringify(result));
  assert.equal(result.原文, text);
  const rows = result.表.filter(row => row.词);
  assert.equal(new Set(rows.map(row => row.标识)).size, rows.length);
  for (const row of rows) {
    assert.equal(text.slice(...row.原文范围), row.前 + row.词 + row.后);
    assert.equal(result.译文.slice(...row.译文范围), row.前 + row.译文 + row.后);
  }
  records.push({ input: text, direction, elapsedMs: Math.round(performance.now() - start), ...result });
  return result;
}
try {
  const tags = await translate('1girl, solo, long hair, blue eyes, smile');
  assert.equal(tags.译文, '1个女孩, 单人, 长发, 蓝眼, 微笑');
  assert.equal(tags.统计.模型译出, 0);
  assert.equal((await translate('(1girl:1.2), solo')).译文, '(1个女孩:1.2), 单人');
  assert.equal((await translate('  （1girl:1.2），\r\nsolo,,solo  ')).译文, '  （1个女孩:1.2），\r\n单人,,单人  ');
  const sentence = await translate('a cat sits on the mat');
  assert.match(sentence.译文, /猫/); assert.match(sentence.译文, /垫子/);
  assert.equal(sentence.表.filter(row => row.词).length, 1);
  assert.equal(sentence.统计.模型译出, 1);
  const phrase = await translate('a serene mountain lake at sunrise, mist over the water, photorealistic');
  assert.equal(phrase.统计.模型译出, 2);
  assert.equal(phrase.表[2].出处, '库');
  const mixed = await translate('girl with 红色头发');
  assert.equal(mixed.统计.模型译出, 1);
  assert.ok(mixed.译文.includes('红色头发'));
  assert.ok(mixed.译文.length < 100, '混合文本应正常结束，不生成重复长串');
  const english = await translate('猫坐在垫子上', 'zh-en');
  assert.match(english.译文, /cat/i); assert.match(english.译文, /mat/i);
  assert.equal(english.统计.模型译出, 1);
  const many = await translate(Array(270).fill('solo').join(', '));
  assert.equal(many.表.length, 270); assert.equal(many.统计.库里查到, 270);
  const missing = await (await fetch(base + '/toolbox/调', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 这次启动的令牌 },
    body: JSON.stringify({ 模块: 'translate', 动作: '本地译', 参数: { 文本: 'a cat sits on the mat', 模型: '__missing_translation_model__' } }),
  })).json();
  assert.equal(missing.ok, false); assert.equal(missing.code, 'TEXT_LOCAL_FAILED');
  assert.equal(missing.原文, 'a cat sits on the mat');
  assert.match(missing.reason, /模型/);
  records.push({ missingModel: missing });
  assert.match((await translate('a cat sits on the mat')).译文, /猫/);
  const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../临时/翻译修复');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, '本地链路结果.json'), JSON.stringify(records, null, 2));
  console.log('翻译真实 HTTP/词库/双向本地模型/格式范围集成通过');
} finally {
  await server.停止();
  fixture.cleanup();
  fs.rmSync(data, { recursive: true, force: true });
}
