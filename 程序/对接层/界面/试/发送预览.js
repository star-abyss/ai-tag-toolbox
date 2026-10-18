import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { 起, 这次启动的令牌 } from '../服务.js';
import { 造服务商面 } from '../服务商.js';
import { 临时项目 } from './会话装置.js';

const fixture = 临时项目();
const 项目根 = fixture.root;
const 目录 = path.join(项目根, 'api');
const 请求们 = [];
const provider = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  请求们.push(body);
  const userText = body.messages
    .filter(message => message.role === 'user')
    .flatMap(message => typeof message.content === 'string'
      ? [message.content]
      : message.content.filter(part => part.type === 'text').map(part => part.text))
    .at(-1);
  const message = 请求们.length === 1
    ? { role: 'assistant', content: null, reasoning_content: '工具调用思路', tool_calls: [{ id: 'call_tags', type: 'function', function: { name: 'tags_search', arguments: JSON.stringify({ 查询: 'blue hair', 数量: 1 }) } }] }
    : { role: 'assistant', content: `收到：${userText}`, reasoning_content: '历史推理内容' };
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
});

await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
造服务商面({ 目录: path.join(目录, 'API') }).写链路([{
  id: 'preview-test', 名字: '预览测试',
  地址: `http://127.0.0.1:${provider.address().port}/v1`, 模型: 'preview-test',
}]);
const server = 起({ 端口: 0, 项目根, 数据目录: 目录 });
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (模块, 动作, 参数 = {}) => (await fetch(`${base}/toolbox/调`, {
  method: 'POST',
  headers: { 'x-toolbox-token': 这次启动的令牌, 'Content-Type': 'application/json' },
  body: JSON.stringify({ 模块, 动作, 参数 }),
})).json();
const call = (动作, 参数 = {}) => post('session', 动作, 参数);
const 文本段 = content => typeof content === 'string' ? [content]
  : (content || []).filter(part => part.type === 'text').map(part => part.text);
async function 等待空闲(会话, 请求数) {
  for (let index = 0; index < 200; index++) {
    const 状态 = await call('读', { 会话 });
    if (请求们.length >= 请求数 && 状态.运行状态 === '空闲') return 状态;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`会话未完成：请求 ${请求们.length}/${请求数}`);
}

try {
  const list = await call('列');
  const 会话 = list.会话[0].标识;
  const cloned = await post('主AI', '预设', { 动作: '复制', 请求: '主AI', 源: '$默认:主AI', 名字: '发送预览回归' });
  assert.ok(cloned.标识, JSON.stringify(cloned));
  assert.equal((await post('主AI', '预设', { 动作: '换', 请求: '主AI', 启用: [cloned.标识] })).请求, '主AI');
  await post('主AI', '工具', { 动作: '改', 预设: cloned.标识, 名字: 'tags_search', 摘要: '', 参数: { 查询: { description: '' }, 数量: { description: '' } } });
  await post('主AI', '预设', { 动作: '改', 预设: cloned.标识, runtime: { 图片标题: '', 图片条目: '图片{图号} {名称}', 无图片: '' } });
  await post('主AI', '存');

  const book = await post('worldbook', '书', { 动作: '导入', 请求: '主AI', 书: { name: '发送预览回归', entries: [
    { label: '前', text: '可见系统前文', always: true, 落点: '前' },
    { label: '后', text: '可见系统后文', always: true, 落点: '后' },
    { label: '深度', text: '可见按深度文本', always: true, 落点: '按深度', 深度: 3, 角色: '助手' },
    { label: '关键词', text: '关键词命中文本', always: false, keys: ['blue hair'], 落点: '前' },
  ] } });
  assert.ok(book.标识, JSON.stringify(book));
  await post('worldbook', '书', { 动作: '换', 请求: '主AI', 启用: [book.标识] });
  await post('worldbook', '存');

  const image = await post('image', '存', {
    作用域: { 存放地: 'session', 会话ID: 会话 },
    字节: { type: 'Buffer', data: [137, 80, 78, 71, 1, 2, 3] },
    文件名: 'tiny.png', 显示名: '小图', mime: 'image/png',
  });
  assert.ok(image.标识, JSON.stringify(image));

  const before = await call('读', { 会话 });
  const simulated = await post('prompt', '预览', { 会话, 文本: 'blue hair' });
  assert.ok(simulated.系统消息, JSON.stringify(simulated));
  assert.doesNotMatch(simulated.系统消息, /每轮\s*\d+张|最多\s*\d+轮|自动迭代|剩余\s*\d+轮/);
  assert.equal(simulated.世界书命中.length, 4);
  assert.ok(simulated.系统消息.includes('关键词命中文本'));
  assert.deepEqual(simulated.按深度追加.map(row => row.文本), ['可见按深度文本']);
  assert.equal(simulated.系统消息.includes('可见按深度文本'), false);
  assert.equal(simulated.使用预设.标识, cloned.标识);
  assert.deepEqual(simulated.附加文本, { 图片标题: '', 图片条目: '图片{图号} {名称}', 无图片: '' });
  assert.equal(simulated.工具表.find(row => row.名字 === 'tags_search').摘要, '');
  const toolDefinition = simulated.工具定义.find(row => row.function.name === 'tags_search');
  assert.ok(toolDefinition, JSON.stringify(simulated.工具定义));
  assert.equal(toolDefinition.function.description, '');
  assert.equal(toolDefinition.function.parameters.properties.查询.description, '');
  assert.ok(simulated.消息.some(message => message.role === 'user' && Array.isArray(message.content) && message.content.some(part => part.type === 'text' && part.text === 'blue hair')));
  const 模拟用户文本 = simulated.消息.filter(message => message.role === 'user')
    .flatMap(message => 文本段(message.content));
  assert.deepEqual(模拟用户文本.slice(-2), ['可见按深度文本', 'blue hair']);
  assert.equal(JSON.stringify(simulated).includes('iVBOR'), false);
  assert.equal((await call('读', { 会话 })).会话.messages.length, before.会话.messages.length, '模拟输入不得写入会话');
  const emptySimulation = await post('prompt', '预览', { 会话, 文本: '' });
  assert.ok(emptySimulation.消息.some(message => message.role === 'user' && Array.isArray(message.content) && message.content.some(part => part.type === 'text' && part.text === '')));

  await call('发', { 会话, 内容: [{ type: 'text', text: 'blue hair' }, { type: 'image', imageId: image.标识 }] });
  await 等待空闲(会话, 2);
  assert.equal(请求们.length, 2, '模型应收到工具调用和工具结果后的两次请求');
  const systemOf = request => request.messages.find(message => message.role === 'system')?.content || '';
  assert.equal(simulated.系统消息, systemOf(请求们[0]));
  assert.deepEqual(simulated.工具定义, 请求们[0].tools);
  assert.equal(simulated.工具定义.some(tool => tool.function.name === '参数'), false);
  assert.doesNotMatch(JSON.stringify(请求们[0]), /每轮\s*\d+张|最多\s*\d+轮|自动迭代|剩余\s*\d+轮|node_errors|sampler_name/);
  const firstSentText = 请求们[0].messages.filter(message => message.role === 'user')
    .flatMap(message => 文本段(message.content)).find(text => text === 'blue hair');
  const firstPreviewText = simulated.消息.filter(message => message.role === 'user')
    .flatMap(message => 文本段(message.content)).find(text => text === 'blue hair');
  assert.equal(firstPreviewText, firstSentText);
  const sent = await post('prompt', '预览', { 会话 });
  assert.equal(sent.系统消息, systemOf(请求们[1]));
  assert.equal(sent.世界书命中.length, 4, '未传文本时按当前会话最新输入计算世界书命中');
  assert.ok(sent.世界书命中.some(row => row.文本 === '关键词命中文本'));
  assert.deepEqual(sent.工具定义, 请求们[1].tools);
  const providerMessages = 请求们[1].messages.filter(message => message.role !== 'system').map(message => ({
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map(part => part.type === 'image_url'
        ? { type: 'text', text: `[图片内容占位：image/png，7 字节]` }
        : part)
      : message.content,
  }));
  assert.deepEqual(sent.消息.slice(0, providerMessages.length), providerMessages);
  assert.ok(sent.消息.some(message => message.role === 'tool' && message.tool_call_id === 'call_tags'));
  assert.equal(sent.消息.find(message => message.role === 'assistant' && message.content.startsWith('收到：'))?.reasoning_content, undefined, '服务商转换会丢弃无工具调用的历史推理字段');
  assert.equal(JSON.stringify(sent).includes('base64'), false);
  const countBeforeReadOnlyPreview = (await call('读', { 会话 })).会话.messages.length;
  assert.equal((await call('读', { 会话 })).会话.messages.length, countBeforeReadOnlyPreview, '无文本预览不得追加会话消息');

  const next = await post('prompt', '预览', { 会话, 文本: '下一轮输入' });
  assert.equal(next.世界书命中.length, 3, '模拟文本替代当前输入计算关键词命中');
  assert.equal(next.消息.find(message => message.role === 'assistant' && message.content.startsWith('收到：'))?.reasoning_content, undefined);
  await call('发', { 会话, 内容: [{ type: 'text', text: '下一轮输入' }] });
  await 等待空闲(会话, 3);
  assert.equal(请求们.length, 3, '第二轮请求也要到达本地服务商');
  assert.equal(next.系统消息, systemOf(请求们[2]));
  assert.deepEqual(next.工具定义, 请求们[2].tools);
  const thirdProviderMessages = 请求们[2].messages.filter(message => message.role !== 'system').map(message => ({
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map(part => part.type === 'image_url'
        ? { type: 'text', text: '[图片内容占位：image/png，7 字节]' }
        : part)
      : message.content,
  }));
  assert.deepEqual(next.消息, thirdProviderMessages);
} finally {
  await server.停止();
  provider.closeAllConnections();
  await new Promise(resolve => provider.close(resolve));
  fixture.cleanup();
}
