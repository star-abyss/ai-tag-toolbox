import assert from 'node:assert/strict';
import test from 'node:test';
import { 造绘画业务, 导出绘画工具表 } from '../绘画业务.js';
import image from '../../图片模块/index.js';
import memory from '../../图片模块/adapter-memory.js';
import vision from '../../识图模块/index.js';
import metadata from '../../识图模块/元数据.js';

function pngWithPrompt() {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const body = Buffer.concat([Buffer.from('tEXt'), Buffer.from('parameters\0blue house\nNegative prompt: blurry\nSteps: 20')]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(body.length - 4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([png.subarray(0, -12), length, body, checksum, png.subarray(-12)]);
}

async function imageFixture() {
  const images = image.createImageModule({ port: memory.createMemoryAdapter() });
  const stored = await images.run('存', { 作用域: { 存放地: 'session', 会话ID: 'ses_prompt' }, 字节: pngWithPrompt(), 文件名: 'source.png', mime: 'image/png' });
  assert.equal(stored.ok, true);
  const recognizer = vision.createVisionModule({
    取图字节: ref => images.run('取内容', { 引用: ref, 变体: 'original' }).data,
    读元数据: metadata.读PNG元数据,
  });
  return { image: images, vision: recognizer };
}

test('文生图工具独立调用配置请求，原样转交素材并返回完整正文', async () => {
  const requests = [];
  const controller = new AbortController();
  const drawing = 造绘画业务({
    门面: {}, sessionId: 'ses_prompt', signal: controller.signal,
    模型调用: async request => {
      requests.push(request);
      return { 正文: '  a blue house\n', 用的谁: { model: 'drawing-model' } };
    },
  });
  const result = await drawing.执行('drawing_prompt', { 要求: '只改变背景', 素材: '原始标签：house, blue；来源：PNG' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.提示词, '  a blue house\n');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].请求, '文生图');
  assert.equal(requests[0].信号, controller.signal);
  assert.deepEqual(JSON.parse(requests[0].messages[0].content[0].text), { 要求: '只改变背景', 素材: '原始标签：house, blue；来源：PNG' });
  assert.deepEqual(Object.keys(导出绘画工具表().find(row => row.名字 === 'drawing_prompt').参数), ['要求', '素材', '参考图']);
});

test('图片元数据工具经已有识图门面返回原始正负向，参考图原字节进入文生图请求', async () => {
  const 门面 = await imageFixture();
  const calls = [];
  const drawing = 造绘画业务({ 门面, sessionId: 'ses_prompt', 模型调用: async args => { calls.push(args); return { 正文: 'blue house' }; } });
  const result = await drawing.执行('images_metadata', { 图号: 1 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.提示词, 'blue house');
  assert.equal(result.data.负向提示词, 'blurry');
  assert.equal(result.data.图号, 1);
  assert.equal('引用' in result.data, false);
  assert.equal(calls.length, 0);
  assert.equal((await drawing.执行('drawing_prompt', { 要求: '改背景', 参考图: 1 })).ok, true);
  const part = calls[0].messages[0].content[1];
  assert.equal(part.type, 'image');
  assert.equal(part.mimeType, 'image/png');
  assert.deepEqual(Buffer.from(part.data, 'base64'), pngWithPrompt());
  assert.equal((await drawing.执行('images_metadata', { 图号: 2 })).code, 'SESSION_IMAGE_MISSING');
});

test('文生图失败保留服务商回执，停止时不交回成功提示词', async () => {
  const failure = { ok: false, code: 'PROVIDER_REJECTED', reason: 'PROVIDER_REJECTED: 请求未接收', details: { status: 400 } };
  const failed = 造绘画业务({ 门面: {}, 模型调用: async () => failure });
  assert.deepEqual(await failed.执行('drawing_prompt', { 要求: 'test' }), failure);
  const throwing = 造绘画业务({ 门面: {}, 模型调用: async () => { throw Object.assign(new Error('PROVIDER_ERROR: provider failed'), { code: 'PROVIDER_ERROR', reason: 'PROVIDER_ERROR: provider failed' }); } });
  assert.equal((await throwing.执行('drawing_prompt', { 要求: 'test' })).reason, 'PROVIDER_ERROR: provider failed');
  const controller = new AbortController();
  const stopped = 造绘画业务({ 门面: {}, signal: controller.signal, 模型调用: async () => { controller.abort(); return { 正文: 'discarded' }; } });
  assert.equal((await stopped.执行('drawing_prompt', { 要求: 'test' })).code, 'SESSION_STOPPED');
  const images = await imageFixture();
  let called = false;
  const drawing = 造绘画业务({ 门面: images, sessionId: 'ses_prompt', 模型调用: async () => { called = true; return { 正文: 'unexpected' }; } });
  assert.equal((await drawing.执行('drawing_prompt', { 要求: 'test', 参考图: 2 })).code, 'SESSION_IMAGE_MISSING');
  assert.equal(called, false);
});
