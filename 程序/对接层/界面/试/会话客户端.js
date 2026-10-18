import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import session from '../../../会话模块/index.js';
import fake from '../../../会话模块/test/假端口.js';
const window = {};
vm.runInNewContext(fs.readFileSync(new URL('../页/对话管理.js', import.meta.url), 'utf8'), {
  window,
  structuredClone,
});
const parts = (text) => [{ type: 'text', text }];
async function setup() {
  const port = session.createMemoryAdapter(),
    图片 = fake.images();
  let executions = 0;
  let backend = session.createSessionModule({
    port,
    图片,
    执行: async () => {
      executions++;
      return { ok: true };
    },
  });
  await backend.ready;
  const a = (await backend.run('新')).data.会话.id,
    b = (await backend.run('新')).data.会话.id;
  let delayRead = null,
    delaySend = null,
    stream;
  const preferences = new Map([['ai.currentSession', a]]);
  const client = window.ConversationManagement.createConversationClient({
    preferences: { get: (key) => preferences.get(key), set: (k, v) => preferences.set(k, v) },
    createStream() {
      stream = { close() {} };
      return stream;
    },
    async request(route, body) {
      if (route === '/toolbox/桌')
        return {
          动作表: backend.describe().map((d) => ({
            ...d,
            模块: 'session',
            参数: d.参数.map((p) => ({
              名: p.replace(/\?$/, ''),
              说明: d.说明[p.replace(/\?$/, '')],
            })),
          })),
        };
      const { 动作, 参数 } = body;
      if (动作 === '发' && delaySend) {
        const g = delaySend;
        delaySend = null;
        await g.promise;
      }
      const result = await backend.run(动作, 参数);
      if (动作 === '读' && delayRead && 参数.会话 === delayRead.id) {
        const g = delayRead;
        delayRead = null;
        g.entered.resolve();
        await g.gate.promise;
      }
      return result.ok ? result.data : result;
    },
  });
  await client.热;
  return {
    client,
    a,
    b,
    port,
    get backend() {
      return backend;
    },
    executions: () => executions,
    delayRead(id) {
      const g = { id, entered: fake.deferred(), gate: fake.deferred() };
      delayRead = g;
      return g;
    },
    delaySend() {
      const g = fake.deferred();
      delaySend = g;
      return g;
    },
    async restart() {
      await backend.close();
      backend = session.createSessionModule({ port, 图片 });
      await backend.ready;
      const d = backend.run('列').data;
      stream.onmessage({
        data: JSON.stringify({ 实例: d.实例, 版本: d.版本, 变更: [a, b], 已删: [] }),
      });
    },
    notify() {
      const d = backend.run('列').data;
      stream.onmessage({
        data: JSON.stringify({ 实例: d.实例, 版本: d.版本, 变更: [a, b], 已删: [] }),
      });
    },
  };
}
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('缓存没有达到预期');
}
test('H06 迟到详情不覆盖新选择；刷新中通知不丢失', async () => {
  const f = await setup();
  const delayed = f.delayRead(f.a),
    opening = f.client.切换(f.a);
  await delayed.entered.promise;
  await f.client.切换(f.b);
  delayed.gate.resolve();
  await opening;
  assert.equal(f.client.当前会话().id, f.b);
  const reading = f.delayRead(f.b);
  f.notify();
  await reading.entered.promise;
  await f.backend.run('改名', { 会话: f.b, 标题: '最新B' });
  f.notify();
  reading.gate.resolve();
  await until(() => f.client.当前会话()?.title === '最新B');
  assert.equal(f.client.会话们().find((s) => s.id === f.b).title, '最新B');
  await f.backend.close();
});
test('H07 新实例较小版本覆盖旧缓存，读取不会自动发', async () => {
  const f = await setup();
  await f.client.草稿(f.a, parts('已保存草稿'));
  const before = f.client.状态().实例;
  await f.restart();
  await until(
    () => f.client.状态().实例 !== before && f.client.当前会话()?.draft[0]?.text === '已保存草稿',
  );
  assert.equal(f.executions(), 0);
  await f.backend.close();
});
test('H17 草稿和受理串行，受理期间的新编辑保留为下一份', async () => {
  const f = await setup();
  const gate = f.delaySend();
  const old = f.client.草稿(f.a, parts('本次'));
  const sent = f.client.发送(f.a, parts('本次'));
  const newer = f.client.草稿(f.a, parts('下一次'));
  await old;
  gate.resolve();
  assert.equal((await sent).ok, true);
  await newer;
  const s = f.backend.run('读', { 会话: f.a }).data.会话;
  assert.deepEqual(s.draft, parts('下一次'));
  assert.deepEqual(s.messages[0].parts, parts('本次'));
  assert.equal(s.messages.filter((m) => m.role === 'user').length, 1);
  await f.backend.close();
});
test('空库自动新建失败后报告错误，不自动重试', async () => {
  const port = session.createMemoryAdapter();
  const backend = session.createSessionModule({
    port: { ...port, write: async () => ({ ok: false, reason: '不可写' }) },
    图片: fake.images(),
  });
  await backend.ready;
  let creates = 0;
  const client = window.ConversationManagement.createConversationClient({
    createStream: () => ({ close() {} }),
    request: async (route, body) => {
      if (route === '/toolbox/桌')
        return { 动作表: backend.describe().map((d) => ({ ...d, 模块: 'session' })) };
      if (body.动作 === '新' && ++creates > 1) throw new Error('发生了自动重试');
      const r = await backend.run(body.动作, body.参数);
      return r.ok ? r.data : r;
    },
  });
  await client.热;
  assert.equal(creates, 1);
  assert.equal(client.状态().错误.code, 'SESSION_WRITE_FAILED');
  await backend.close();
});
