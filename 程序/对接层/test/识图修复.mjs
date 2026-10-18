import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const 当前文件目录 = path.dirname(fileURLToPath(import.meta.url));
const 项目根 = path.resolve(process.argv[2] || path.join(当前文件目录, '../..'));
const 引擎目录 = path.join(项目根, '对接层', '模型引擎');
const { 列模型 } = await import(pathToFileURL(path.join(引擎目录, '目录.js')));
const { 造打标器 } = await import(pathToFileURL(path.join(引擎目录, '识图.js')));

const 模型目录 = path.resolve(项目根, '..', '模型');
const 可用模型 = 列模型(模型目录).vision.find((一) => 一.id === 'wd-eva02');
assert.ok(可用模型, '模型目录中没有 wd-eva02');
assert.equal(可用模型.装好了, true, `模型文件不齐：${可用模型.缺什么.join('；')}`);

const 图片路径 = path.join(当前文件目录, 'fixtures', 'wd-eva02-smoke.png');
const 图片字节 = fs.readFileSync(图片路径);
const 开始 = performance.now();
const 打标器 = await 造打标器({ 模型目录, 格: 可用模型.id });
const 加载完 = performance.now();
const 结果 = await 打标器.打标(图片字节, { 阈值: 0.2, 上限: 8 });
const 完成 = performance.now();

assert.equal(打标器.id, 'wd-eva02');
assert.ok(结果.标签.length > 0, '模型推理没有返回标签');
assert.deepEqual(结果.尺寸, { 宽: 448, 高: 448, 缩放到: 448, 通道: 3 });

console.log(JSON.stringify({
  项目根,
  图片字节: 图片字节.length,
  模型: 打标器.名字,
  标签: 结果.标签,
  尺寸: 结果.尺寸,
  模型加载毫秒: Math.round(加载完 - 开始),
  推理毫秒: Math.round(完成 - 加载完),
}));
