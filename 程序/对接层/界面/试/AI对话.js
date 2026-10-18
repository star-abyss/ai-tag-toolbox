import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { 起, 这次启动的令牌 } from '../服务.js';
import { 造服务商面 } from '../服务商.js';
import { 临时项目 } from './会话装置.js';
const fixture = 临时项目(),
  项目根 = fixture.root,
  目录 = path.join(项目根, 'api');
const requests = [];
const provider = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body);
  const text = body.messages
    .filter((m) => m.role === 'user')
    .flatMap((m) =>
      typeof m.content === 'string'
        ? [m.content]
        : m.content.filter((p) => p.type === 'text').map((p) => p.text),
    )
    .at(-1);
  if (text === '暂停测试') await new Promise((r) => setTimeout(r, 500));
  const message =
    text === '查找标签候选' && !body.messages.some((m) => m.role === 'tool')
      ? {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call1', type: 'function', function: { name: 'tags_search', arguments: JSON.stringify({ 查询: 'blue hair', 数量: 5 }) } },
          ],
        }
      : { role: 'assistant', content: '工具调用完成' };
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
    }),
  );
});
await new Promise((r) => provider.listen(0, '127.0.0.1', r));
造服务商面({ 目录 }).写链路([
  {
    id: 'test',
    名字: '测试',
    地址: `http://127.0.0.1:${provider.address().port}/v1`,
    模型: 'test',
  },
]);
const server = 起({ 端口: 0, 项目根, 数据目录: 目录 });
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (module, action, parameters = {}) =>
  (
    await fetch(base + '/toolbox/调', {
      method: 'POST',
      headers: { 'x-toolbox-token': 这次启动的令牌, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 模块: module, 动作: action, 参数: parameters }),
    })
  ).json();
const call = (action, parameters) => post('session', action, parameters);
async function done(id) {
  for (let i = 0; i < 150; i++) {
    const r = await call('读', { 会话: id });
    if (r.运行状态 === '空闲') return r;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('轮次未结束');
}
try {
  const list = await call('列'),
    id = list.会话[0].标识;
  assert.ok(id);
  assert.equal(list.总数, 1);
  const desktop = server.宿主.桌();
  assert.equal(desktop.动作表.filter((a) => a.模块 === 'session').length, 17);
  assert.equal(server.宿主.清单.filter((m) => m.名字 === 'session').length, 1);
  const old = await fetch(base + '/对话/状态', { method: 'POST' });
  assert.equal(old.status, 404);
  const stream = await fetch(base + '/对话/流', { headers: { 'x-toolbox-token': 这次启动的令牌 } });
  const reader = stream.body.getReader();
  const event = JSON.parse(
    new TextDecoder()
      .decode((await reader.read()).value)
      .split('data: ')[1]
      .split('\n')[0],
  );
  assert.deepEqual(Object.keys(event), ['实例', '版本', '变更', '已删']);
  await reader.cancel();
  await call('发', { 会话: id, 内容: [{ type: 'text', text: '查找标签候选' }] });
  const completed = await done(id);
  assert.equal(completed.会话.messages.at(-1).parts[0].text, '工具调用完成');
  assert.equal(completed.会话.turns[0].status, 'complete');
  const receipt = requests[1].messages.find((m) => m.role === 'tool');
  assert.ok(Array.isArray(JSON.parse(receipt.content).候选));
  assert.ok(requests[0].tools.some((t) => t.function.name === 'tags_search'));
  assert.ok(!requests[0].tools.some((t) => t.function.name === 'tag_status' || t.function.name === 'tag_record_batch'));
  const image = await post('image', '存', {
    作用域: { 存放地: 'gallery' },
    字节: { type: 'Buffer', data: [137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3] },
    文件名: 'test.png',
    mime: 'image/png',
  });
  const original = await post('image', '取内容', { 引用: image.引用 });
  const copied = await post('image', '存', {
    作用域: { 存放地: 'session', 会话ID: id },
    字节: original.字节,
    文件名: 'test.png',
    mime: 'image/png',
    来源: 'copy',
  });
  await post('image', '删', { 引用: image.引用 });
  await call('发', {
    会话: id,
    内容: [
      { type: 'text', text: '带图' },
      { type: 'image', imageId: copied.标识 },
    ],
  });
  await done(id);
  const visual = requests
    .at(-1)
    .messages.at(-1)
    .content.find((p) => p.type === 'image_url');
  assert.ok(visual);
  assert.equal(visual.image_url.url, 'data:image/png;base64,iVBORw0KGgoBAgM=');
  await call('发', { 会话: id, 内容: [{ type: 'image', imageId: copied.标识 }] });
  await done(id);
  const imageOnlyContent = requests.at(-1).messages.at(-1).content;
  assert.ok(imageOnlyContent.some((part) => part.type === 'image_url'));
  assert.ok(imageOnlyContent.some((part) => part.type === 'text' && part.text === '图1'));
  const exp = await call('导出', { 会话列表: [id] });
  assert.equal(JSON.parse(exp.内容).sessions[0].images.length, 1);
  const imported = await call('导入', { 内容: exp.内容 });
  assert.equal(imported.已导入, 1);
  assert.notEqual(imported.会话ID列表[0], id);
  const deleted = await call('删', { 会话: imported.会话ID列表[0], 保留图片: true });
  assert.equal(deleted.已保留.length, 1);
  const competing = (await call('新')).会话.id;
  const removal = server.宿主.门面.session.run('删', { 会话: competing });
  const upload = server.宿主.门面.image.run('存', {
    作用域: { 存放地: 'session', 会话ID: competing },
    字节: Buffer.from('queued'),
    文件名: 'queued.png',
  });
  const rejected = await upload;
  assert.ok(['SESSION_BUSY', 'SESSION_NO_SUCH_SESSION'].includes(rejected.code));
  assert.equal((await removal).ok, true);
  assert.equal(
    server.宿主.门面.image.run('列', { 作用域: { 存放地: 'session', 会话ID: competing } }).data
      .总数,
    0,
  );
  console.log('H13 真实宿主接收规则与会话删除竞争通过');
  await call('发', { 会话: id, 内容: [{ type: 'text', text: '暂停测试' }] });
  assert.equal(
    (await call('发', { 会话: id, 内容: [{ type: 'text', text: '重复' }] })).code,
    'SESSION_BUSY',
  );
  await call('停', { 会话: id });
  assert.equal((await done(id)).会话.turns.at(-1).status, 'stopped');
  console.log('H01/H02/H03/H08/H10/H12 HTTP、通知、真标签门面、图文/纯图、归档保图、停止通过');
} finally {
  await server.宿主.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  provider.closeAllConnections();
  await new Promise((r) => provider.close(r));
  fixture.cleanup();
}
