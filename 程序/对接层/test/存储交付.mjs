import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const program = process.argv[2] ? path.resolve(process.argv[2]) : source;
const { 造宿主 } = await import(pathToFileURL(path.join(program, '对接层/宿主.js')));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-delivery-'));
let host;
try {
  host = 造宿主({ 项目根: program, 数据目录: temporary });
  await host.ready;
  assert.deepEqual(host.装不上, []);
  assert.equal(host.列().目录, path.resolve(program, '../模型'));
  assert.deepEqual(host.列().这次用, { vision: 'wd-eva02', translation: 'opus-mt' });
  assert.equal(host.服务商.目录, path.join(temporary, 'API'));
  assert.equal((await host.调({ 模块: 'tag', 动作: 'status' })).记录.主库, 52240);
  const bytes = fs.readFileSync(path.join(program, '对接层/test/fixtures/wd-eva02-smoke.png'));
  const image = await host.调({ 模块: 'image', 动作: '存', 参数: { 作用域: { 存放地: 'gallery' }, 字节: bytes, 文件名: 'delivery-check.png' } });
  assert.ok(image.引用, JSON.stringify(image));
  const detected = await host.调({ 模块: 'vision', 动作: '认图', 参数: { ...image.引用.作用域, 条目ID: image.引用.条目ID, 阈值: 0.35, 上限: 8 } });
  assert.ok(Array.isArray(detected.标签) && detected.标签.length > 0, JSON.stringify(detected));
  console.log(`PASS: 本地打标，返回 ${detected.标签.length} 个标签`);
  const translated = await host.调({ 模块: 'translate', 动作: '本地译', 参数: { 文本: 'The weather is nice today.', 方向: 'en-zh' } });
  assert.match(translated.译文, /天气/);
  console.log(`PASS: 本地翻译 ${translated.译文}`);
  const graph = { id: '11111111-1111-4111-8111-111111111111', nodes: [{ id: 1, type: 'CLIPTextEncode', widgets_values: ['delivery-check'] }], links: [] };
  const saved = await host.调({ 模块: 'comfy', 动作: '存工作流', 参数: { 图: graph } });
  assert.notEqual(saved.ok, false, JSON.stringify(saved));
  await host.存储.写设置({ 界面: { 'app.theme': 'light' } });
  await host.close();
  host = 造宿主({ 项目根: program, 数据目录: temporary });
  await host.ready;
  assert.equal(host.存储.读设置().界面['app.theme'], 'light');
  assert.deepEqual((await host.调({ 模块: 'comfy', 动作: '取工作流' })).界面图, graph);
  assert.notEqual((await host.调({ 模块: 'image', 动作: '取详情', 参数: { 引用: image.引用 } })).ok, false);
  console.log(JSON.stringify({ 程序目录: program, 版本: host.版本, 模型: host.列().这次用, 重启保留: ['设置', '图库', '工作流'], 结果: 'PASS' }));
} finally {
  await host?.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
