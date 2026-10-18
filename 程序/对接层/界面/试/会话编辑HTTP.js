import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { 会话, 模型侧动作名, 取界面字段 } from '../../模块清单.js';
import { 起, 这次启动的令牌 } from '../服务.js';
import { 造服务商面 } from '../服务商.js';
import { 临时项目 } from './会话装置.js';

assert.equal(模型侧动作名(会话, '改消息'), 'editMessage');
assert.equal(模型侧动作名(会话, '重新生成'), 'regenerate');
assert.equal(取界面字段('session', 'editMessage', '消息ID').控件, 'context');
assert.equal(取界面字段('session', 'regenerate', '轮次ID').控件, 'context');

const fixture = 临时项目();
const requests = [];
let rejectRequest = false;
const provider = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body);
  res.setHeader('Content-Type', 'application/json');
  if (rejectRequest) { res.statusCode = 503; res.end(JSON.stringify({ error: { message: 'regeneration unavailable' } })); return; }
  const user = body.messages.filter(row => row.role === 'user').at(-1);
  const text = typeof user.content === 'string' ? user.content : user.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '答复：' + text }, finish_reason: 'stop' }] }));
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
const dataDir = path.join(fixture.packageRoot, 'data');
const api = path.join(dataDir, 'API');
造服务商面({ 目录: api }).写链路([{ id: 'test', 名字: '测试', 地址: `http://127.0.0.1:${provider.address().port}/v1`, 模型: 'test' }]);
let server, base;
async function start() {
  server = 起({ 端口: 0, 项目根: fixture.root, 数据目录: dataDir });
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}
async function call(action, parameters = {}, module = 'session') {
  return (await fetch(base + '/toolbox/调', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 这次启动的令牌 },
    body: JSON.stringify({ 模块: module, 动作: action, 参数: parameters }),
  })).json();
}
async function done(id) {
  for (let i = 0; i < 200; i++) {
    const state = await call('读', { 会话: id });
    if (state.运行状态 === '空闲') return state.会话;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('会话执行没有结束');
}
try {
  await start();
  const book = await call('书', { 动作: '导入', 请求: '主AI', 书: { name: '编辑重生成参考', entries: [
    { label: '旧参考', text: '旧输入参考', always: false, keys: ['第一轮原文'], 落点: '按深度' },
    { label: '新参考', text: '改后输入参考', always: false, keys: ['第一轮改后'], 落点: '按深度' },
  ] } }, 'worldbook');
  assert.ok(book.标识);
  await call('书', { 动作: '换', 请求: '主AI', 启用: [book.标识] }, 'worldbook');
  await call('存', {}, 'worldbook');
  const id = (await call('列')).会话[0].标识;
  const first = await call('发', { 会话: id, 内容: [{ type: 'text', text: '第一轮原文' }] });
  let session = await done(id);
  assert.equal(session.messages.at(-1).parts[0].text, '答复：第一轮原文');
  assert.ok(session.messages[0].context.includes('旧输入参考'), '原轮次保存世界书参考');
  await call('发', { 会话: id, 内容: [{ type: 'text', text: '第二轮保留' }] });
  session = await done(id);
  const secondAnswer = session.messages.at(-1).id;
  const beforeRequests = requests.length;
  assert.equal((await call('改消息', { 会话: id, 消息ID: first.消息ID, 文本: '第一轮改后\n保留换行' })).消息ID, first.消息ID);
  assert.equal((await call('改消息', { 会话: id, 消息ID: secondAnswer, 文本: '手工修改的 AI 文本' })).消息ID, secondAnswer);
  assert.equal(requests.length, beforeRequests, '编辑只保存，不调用模型');
  await call('发', { 会话: id, 内容: [{ type: 'text', text: '第三轮检查上下文' }] });
  session = await done(id);
  const sent = JSON.stringify(requests.at(-1).messages);
  assert.ok(sent.includes('第一轮改后\\n保留换行') && sent.includes('手工修改的 AI 文本'), '后续调用使用编辑后的用户与 AI 文本');
  const laterMessages = structuredClone(session.messages.filter(row => row.turnId !== first.轮次ID));
  const laterTurns = structuredClone(session.turns.filter(row => row.id !== first.轮次ID));
  const originalReply = session.messages.find(row => row.turnId === first.轮次ID && row.role === 'assistant').id;
  const regenerated = await call('重新生成', { 会话: id, 轮次ID: first.轮次ID });
  assert.equal(regenerated.消息ID, first.消息ID, '重新生成沿用原用户消息');
  session = await done(id);
  const regenerationMessages = JSON.stringify(requests.at(-1).messages);
  assert.ok(regenerationMessages.includes('第一轮改后\\n保留换行'));
  assert.ok(session.messages[0].context.includes('改后输入参考') && !session.messages[0].context.includes('旧输入参考'), '编辑后重生成重新计算世界书参考');
  assert.ok(regenerationMessages.includes('改后输入参考') && !regenerationMessages.includes('旧输入参考'), '重生成实际请求使用重算的世界书参考');
  assert.ok(!regenerationMessages.includes('第二轮保留') && !regenerationMessages.includes('第三轮检查上下文') && !regenerationMessages.includes('答复：第一轮原文'), '较早轮次不读取后续消息或原回复');
  assert.deepEqual(session.messages.filter(row => row.turnId !== first.轮次ID), laterMessages, '后续消息逐项保留');
  assert.deepEqual(session.turns.filter(row => row.id !== first.轮次ID), laterTurns, '后续轮次逐项保留');
  assert.equal(session.messages.filter(row => row.id === first.消息ID).length, 1);
  assert.equal(session.messages[1].parts[0].text, '答复：第一轮改后\n保留换行');
  assert.notEqual(session.messages[1].id, originalReply);
  const savedReply = structuredClone(session.messages[1]);
  rejectRequest = true;
  await call('重新生成', { 会话: id, 轮次ID: first.轮次ID });
  session = await done(id);
  assert.deepEqual(session.messages[1], savedReply, '重新生成首次模型请求失败保留原回复');
  assert.deepEqual(session.messages.filter(row => row.turnId !== first.轮次ID), laterMessages);
  await server.停止();
  await start();
  session = await done(id);
  assert.deepEqual(session.messages[1], savedReply, '编辑和重生成写盘，重启后保持');
  assert.equal(session.messages.find(row => row.id === secondAnswer).parts[0].text, '手工修改的 AI 文本');
  console.log('通过：统一 HTTP 门面编辑双向文本、后续请求上下文、较早轮次重生成与后续保留、失败保留和服务重启');
} finally {
  await server?.停止();
  provider.closeAllConnections();
  await new Promise(resolve => provider.close(resolve));
  fixture.cleanup();
}
