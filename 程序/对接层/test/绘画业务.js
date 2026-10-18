import assert from 'node:assert/strict';
import test from 'node:test';
import { 造宿主 } from '../宿主.js';
import { 造绘画业务 } from '../绘画业务.js';
import image from '../../图片模块/index.js';
import memory from '../../图片模块/adapter-memory.js';

test('宿主预设只生成绘画业务工具，不向模型生成模块维护动作', () => {
  const host = 造宿主();
  const preset = host.门面.主AI.run('执行', { 请求: '主AI' });
  assert.equal(preset.ok, true);
  const names = preset.data.工具表.map(row => row.名字);
  assert.ok(names.includes('drawing_generate'), '缺少生图业务');
  assert.ok(names.includes('ask_user'), '缺少角色歧义交互');
  assert.equal(names.some(name => /objectInfo|record_create|position_|image_|setWorkflow/.test(name)), false);
});

test('生成文件缺少mime时仍取回会话图片，保存实际图号与像素尺寸', async () => {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const images = image.createImageModule({ port: memory.createMemoryAdapter() });
  const drawing = 造绘画业务({ sessionId: 'ses_test', 门面: {
    image: images,
    comfy: { run: async (action, args) => {
      if (action === '生成设置') return { ok: true, data: { 每轮张数: 1, 最多轮数: 3, 自动迭代: true } };
      if (action === '出图') { args.onEvent?.({ 类型: '提交中' }); return { ok: true, data: { 产出: [{ 文件名: 'result.png', 种类: 'image' }] } }; }
      return { ok: true, data: { 字节: bytes, 文件名: 'result.png' } };
    } },
  } });
  const generated = await drawing.执行('drawing_generate', { 正向: 'a red house' });
  assert.equal(generated.ok, true);
  assert.equal(generated.data.图片.length, 1);
  assert.equal(generated.data.图片[0].图号, 1);
  const listed = await drawing.执行('images_list');
  assert.deepEqual(listed.data.图片.map(row => [row.图号, row.宽, row.高]), [[1, 1, 1]]);
  const viewed = await drawing.执行('images_view', { 图号: 1 });
  assert.equal(viewed.data.图片.type, 'session-image');
  assert.equal(JSON.stringify(generated).includes('base64'), false);
});
