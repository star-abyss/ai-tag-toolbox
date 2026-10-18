import assert from 'node:assert/strict';
import test from 'node:test';
import { 默认附加文本, 工具声明, 会话图片说明 } from '../工具定义.js';

test('绘画工具声明保留空摘要与空白摘要原文', () => {
  const 空 = 工具声明({ 名字: 'tool_empty', 摘要: '', 参数: {} });
  const 空白 = 工具声明({ 名字: 'tool_space', 摘要: '  ', 参数: {} });
  assert.equal(空.description, '');
  assert.equal(空白.description, '  ');
});

test('会话图片附加文本逐字段覆盖默认，空字符串有效', () => {
  assert.deepEqual(默认附加文本, {
    图片标题: '当前对话图片：',
    图片条目: '图{图号}：{名称}',
    无图片: '当前对话没有图片。',
  });
  assert.equal(Object.hasOwn(默认附加文本, '生成状态'), false);
  assert.equal(会话图片说明([{ number: 3, displayName: '示例.png' }], { 图片标题: '', 图片条目: '第{图号}项/{名称}' }), '第3项/示例.png');
  assert.equal(会话图片说明([], { 无图片: '' }), '');
});

test('生图工具声明不公开迭代次数或用户侧参数', async () => {
  const { 导出绘画工具表 } = await import('../绘画业务.js');
  const rows = 导出绘画工具表();
  const info = rows.find(row => row.名字 === 'drawing_info');
  const generate = rows.find(row => row.名字 === 'drawing_generate');
  assert.doesNotMatch(info.摘要, /每轮|额度|轮数|设置/);
  assert.doesNotMatch(generate.摘要, /每轮|最多|已用|剩余|自动迭代/);
  assert.deepEqual(Object.keys(generate.参数).sort(), ['参考图', '正向', '负向']);
});

test('系统素材只拼接世界书和图片说明，不接受生成状态段', async () => {
  const { 组系统素材 } = await import('../发送素材.js');
  const materials = 组系统素材({ 命中: [], 图片说明: '当前对话没有图片。', 生成说明: '最多 8 轮；每轮 4 张' });
  assert.equal(materials.系统消息, '当前对话没有图片。');
  assert.equal('生成状态说明' in materials, false);
});
