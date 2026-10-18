import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { 起, 这次启动的令牌 } from '../服务.js';
import { 临时项目 } from './会话装置.js';

const fixture = 临时项目();
const 数据目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-basic-prompts-'));
const requests = [];
const provider = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body);
  const user = body.messages.find((row) => row.role === 'user');
  const text = typeof user?.content === 'string'
    ? user.content
    : user?.content?.find((part) => part.type === 'text')?.text || '';
  const content = text.includes('看这张图')
    ? JSON.stringify({ tags: ['blue_sky', 'red_roof'], description: '蓝天下有一座红顶小屋。', hasBuiltinTags: false })
    : JSON.stringify({ opalunicorn: '宝石', testword: '测试词' });
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const server = 起({ 端口: 0, 项目根: fixture.root, 数据目录 });
await new Promise((resolve) => server.once('listening', resolve));
server.宿主.服务商.写链路([{
  id: 'fake', 名字: '假服务商', 地址: `http://127.0.0.1:${provider.address().port}/v1`, 模型: 'fake-vision',
}]);
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (模块, 动作, 参数 = {}) => (await fetch(base + '/toolbox/调', {
  method: 'POST',
  headers: { 'x-toolbox-token': 这次启动的令牌, 'Content-Type': 'application/json' },
  body: JSON.stringify({ 模块, 动作, 参数 }),
})).json();

try {
  const defaults = await post('worldbook', '执行', { 请求: '识图', 文本: '' });
  assert.deepEqual(defaults.书.map((row) => row.标识), ['$default:识图'], '识图请求默认挂载基础世界书');
  assert.ok(defaults.命中.some((row) => row.文本.includes('"tags"')), '默认识图格式正文已命中');

  const image = await post('image', '存', {
    作用域: { 存放地: 'gallery' },
    字节: { type: 'Buffer', data: [...Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')] },
    文件名: 'basic.png', mime: 'image/png',
  });
  assert.ok(image.引用, '图片已通过真实 image/存 动作保存');
  const vision = await post('vision', '看图', { 存放地: 'gallery', 条目ID: image.引用.条目ID });
  assert.deepEqual(vision.标签.map((row) => row.词), ['blue_sky', 'red_roof'], 'JSON tags 经识图模块成为标签字段');
  assert.equal(vision.描述, '蓝天下有一座红顶小屋。', 'JSON description 被引擎转成模块中文字段');
  const visionRequest = requests.at(-1);
  assert.ok(visionRequest.messages.find((row) => row.role === 'system')?.content.includes('"hasBuiltinTags":false'), '默认识图提示词进入真实副请求 system');

  const bound = await post('binding', '装订', { 文本: 'opalunicorn, testword' });
  assert.equal(bound.译文, '宝石, 测试词', '翻译 JSON 键值经现有装订链路按原词归位');
  const translateRequest = requests.at(-1);
  assert.ok(translateRequest.messages.find((row) => row.role === 'system')?.content.includes('翻译'), '默认翻译提示词进入真实副请求 system');

  const disabled = await post('worldbook', '书', { 动作: '换', 请求: '识图', 启用: [] });
  assert.deepEqual(disabled.启用, [], '显式停用识图默认书可保存');
  await post('worldbook', '存');
  const noBook = await post('worldbook', '执行', { 请求: '识图', 文本: '' });
  assert.deepEqual(noBook.书, [], '显式空启用列表仍然生效');
  await post('vision', '看图', { 存放地: 'gallery', 条目ID: image.引用.条目ID });
  assert.ok(!requests.at(-1).messages.find((row) => row.role === 'system')?.content.includes('固定的单图识图子代理'), '显式停用后识图默认正文不进入 system');
  await post('worldbook', '书', { 动作: '换', 请求: '识图', 启用: ['$default:识图'] });
  await post('worldbook', '存');
  await post('vision', '看图', { 存放地: 'gallery', 条目ID: image.引用.条目ID });
  assert.ok(requests.at(-1).messages.find((row) => row.role === 'system')?.content.includes('固定的单图识图子代理'), '重新启用后识图默认正文回到 system');
  console.log('基础识图提示词真实副请求集成通过');
} finally {
  await server.宿主.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  provider.closeAllConnections();
  await new Promise((resolve) => provider.close(resolve));
  fixture.cleanup();
  fs.rmSync(数据目录, { recursive: true, force: true });
}
