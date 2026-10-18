'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { images, payload, deferred } = require('./假端口.js');
const { createSessionModule, createMemoryAdapter, createFileAdapter } = require('../index.js');
const text = (value) => [{ type: 'text', text: value }];
const read = (m, id) => m.run('读', { 会话: id }).data;
async function idle(m, id) {
  for (let n = 0; n < 200; n++) {
    if (read(m, id).运行状态 === '空闲') return;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('执行未收口');
}
async function create(options = {}) {
  const m = createSessionModule({ port: createMemoryAdapter(), 图片: images(), ...options });
  await m.ready;
  return m;
}
async function fresh(m) {
  const r = await m.run('新');
  assert.equal(r.ok, true);
  return r.data.会话.id;
}
test('M01 必需端口缺项是明确装配错误', () => {
  assert.throws(() => createSessionModule({ port: {}, 图片: images() }), /list/);
  assert.throws(() => createSessionModule({ port: createMemoryAdapter(), 图片: {} }), /list/);
});
test('改消息只替换正文并保留非文本块，支持零文本消息', async () => {
  const m = await create({
    执行: async ({ commit }) => commit({ kind: 'message', parts: [{ type: 'text', text: '旧答' }], reasoning: '', toolCalls: [], model: null }),
  });
  const id = await fresh(m);
  await m.run('发', { 会话: id, 内容: text('用户') });
  await idle(m, id);
  let s = read(m, id).会话, user = s.messages[0], assistant = s.messages[1];
  user.parts = [{ type: 'image', imageId: 'img_kept' }, { type: 'text', text: 'a' }, { type: 'text', text: 'b' }];
  assistant.parts = [{ type: 'text', text: '旧' }, { type: 'image', imageId: 'img_kept' }, { type: 'text', text: '尾' }];
  const store = createMemoryAdapter({ sessions: [s] });
  const n = await create({ port: store });
  assert.equal((await n.run('改消息', { 会话: id, 消息ID: user.id, 文本: '  修改  ' })).ok, true);
  assert.deepEqual(read(n, id).会话.messages[0].parts, [{ type: 'image', imageId: 'img_kept' }, { type: 'text', text: '  修改  ' }]);
  assert.equal((await n.run('改消息', { 会话: id, 消息ID: assistant.id, 文本: '' })).ok, true);
  assert.deepEqual(read(n, id).会话.messages[1].parts, [{ type: 'text', text: '' }, { type: 'image', imageId: 'img_kept' }]);
  assert.equal((await n.run('改消息', { 会话: id, 消息ID: assistant.id, 文本: '再次编辑' })).ok, true);
});
test('重新生成读取历史投影并原位替换回复，保留后续与持久重载', async () => {
  const port = createMemoryAdapter();
  let calls = 0, seen;
  const m = await create({ port, 执行: async ({ read: project, commit }) => {
    calls++;
    seen = project();
    return commit({ kind: 'message', parts: text('新回复'), reasoning: '', toolCalls: [], model: null });
  }});
  const id = await fresh(m);
  await m.run('发', { 会话: id, 内容: text('第一轮') }); await idle(m, id);
  await m.run('发', { 会话: id, 内容: text('第二轮') }); await idle(m, id);
  let s = read(m, id).会话;
  const firstTurn = s.turns[0], oldAssistant = s.messages[1].id, laterIds = s.messages.slice(2).map(x => x.id);
  assert.equal((await m.run('改消息', { 会话: id, 消息ID: firstTurn.inputMessageId, 文本: '已编辑' })).ok, true);
  const accepted = await m.run('重新生成', { 会话: id, 轮次ID: firstTurn.id });
  assert.deepEqual(Object.keys(accepted.data).sort(), ['会话ID','轮次ID','消息ID'].sort());
  await idle(m, id);
  assert.equal(calls, 3);
  assert.deepEqual(seen.messages.map(x => [x.role, x.parts]), [['user', text('已编辑')]]);
  s = read(m, id).会话;
  assert.equal(s.turns[0].status, 'complete');
  assert.equal(s.messages.some(x => x.id === oldAssistant), false);
  assert.deepEqual(s.messages.slice(2).map(x => x.id), laterIds);
  assert.equal(s.messages[1].parts[0].text, '新回复');
  const loaded = await create({ port });
  assert.deepEqual(read(loaded, id).会话.messages, s.messages);
});
test('重新生成首条助手保存失败保留旧回复，重入与停止沿用原轮次闸门', async () => {
  const store = createMemoryAdapter(); let rejectMessage = false, oldId, entered;
  const baseWrite = store.write;
  const port = { ...store, write: async (id, value) => {
    if (rejectMessage && value.messages.some(m => m.role === 'assistant' && m.id !== oldId)) {
      rejectMessage = false; return { ok: false, reason: '新回复保存失败' };
    }
    return baseWrite(id, value);
  }};
  const m = await create({ port, 执行: async ({ commit, signal }) => {
    if (!oldId) return commit({ kind: 'message', parts: text('旧回复'), reasoning: '', toolCalls: [], model: null });
    if (rejectMessage) return commit({ kind: 'message', parts: text('新回复'), reasoning: '', toolCalls: [], model: null });
    entered?.resolve();
    if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    if (signal.aborted) return { ok: false, code: 'SESSION_STOPPED', reason: 'SESSION_STOPPED: 已停' };
    return commit({ kind: 'message', parts: text('新回复'), reasoning: '', toolCalls: [], model: null });
  }});
  const id = await fresh(m);
  await m.run('发', { 会话: id, 内容: text('用户') }); await idle(m, id);
  oldId = read(m, id).会话.messages[1].id;
  rejectMessage = true;
  await m.run('重新生成', { 会话: id, 轮次ID: read(m, id).会话.turns[0].id }); await idle(m, id);
  assert.equal(read(m, id).会话.messages[1].id, oldId);
  entered = deferred();
  const tid = read(m, id).会话.turns[0].id;
  await m.run('重新生成', { 会话: id, 轮次ID: tid }); await entered.promise;
  assert.equal((await m.run('重新生成', { 会话: id, 轮次ID: tid })).code, 'SESSION_BUSY');
  assert.equal((await m.run('改消息', { 会话: id, 消息ID: oldId, 文本: '被挡住' })).code, 'SESSION_BUSY');
  assert.equal((await m.run('停', { 会话: id })).data.已请求, true);
  await idle(m, id);
  assert.equal(read(m, id).会话.messages.some(m => m.id === oldId), true);
  assert.equal(read(m, id).会话.turns[0].status, 'stopped');
});
test('重新生成清空旧context后允许重新提交参考正文', async () => {
  let count = 0, projected;
  const m = await create({ 执行: async ({ read: project, commit }) => {
    count++;
    projected = project();
    const context = await commit({ kind: 'context', text: `参考${count}` });
    if (!context.ok) return context;
    return commit({ kind: 'message', parts: text(`答${count}`), reasoning: '', toolCalls: [], model: null });
  }});
  const id = await fresh(m);
  await m.run('发', { 会话: id, 内容: text('问题') }); await idle(m, id);
  const turn = read(m, id).会话.turns[0];
  assert.equal(read(m, id).会话.messages[0].context, '参考1');
  assert.equal((await m.run('重新生成', { 会话: id, 轮次ID: turn.id })).ok, true);
  await idle(m, id);
  assert.equal(projected.messages[0].context, '');
  assert.equal(read(m, id).会话.messages[0].context, '参考2');
  assert.equal(read(m, id).会话.messages[1].parts[0].text, '答2');
});
test('清空已排队时重新生成落点重查目标轮并释放运行位', async () => {
  const store = createMemoryAdapter(), gate = deferred(), entered = deferred();
  const baseWrite = store.write;
  let hold = false, executions = 0;
  const port = { ...store, write: async (id, value) => {
    if (hold && value.messages.length === 0) { entered.resolve(); await gate.promise; hold = false; }
    return baseWrite(id, value);
  }};
  const m = await create({ port, 执行: async ({ commit }) => {
    executions++;
    return commit({ kind: 'message', parts: text('回答'), reasoning: '', toolCalls: [], model: null });
  }});
  const id = await fresh(m);
  await m.run('发', { 会话: id, 内容: text('问题') }); await idle(m, id);
  const turnId = read(m, id).会话.turns[0].id;
  hold = true;
  const clearing = m.run('清空', { 会话: id });
  await entered.promise;
  const regenerating = m.run('重新生成', { 会话: id, 轮次ID: turnId });
  gate.resolve();
  assert.equal((await clearing).ok, true);
  assert.equal((await regenerating).code, 'SESSION_BAD_ARGUMENT');
  assert.equal(read(m, id).会话.messages.length, 0);
  assert.equal((await m.run('发', { 会话: id, 内容: text('新问题') })).ok, true);
  await idle(m, id);
  assert.equal(executions, 2);
});
test('无助手输出的失败轮次可重新生成且后续对话与用户消息保留', async () => {
  let executions = 0, projected;
  const m = await create({ 执行: async ({ read: project, commit }) => {
    executions++;
    if (executions === 1) throw new Error('provider断开');
    projected = project();
    return commit({ kind: 'message', parts: text('补出的回复'), reasoning: '', toolCalls: [], model: null });
  }});
  const id = await fresh(m);
  await m.run('发', { 会话: id, 内容: text('第一问') }); await idle(m, id);
  const firstTurn = read(m, id).会话.turns[0];
  assert.equal(firstTurn.status, 'failed');
  assert.equal(read(m, id).会话.messages.filter(x => x.turnId === firstTurn.id && x.role === 'assistant').length, 0);
  await m.run('发', { 会话: id, 内容: text('后续问题') }); await idle(m, id);
  let s = read(m, id).会话;
  const laterIds = s.messages.filter(x => x.turnId !== firstTurn.id).map(x => x.id);
  const r = await m.run('重新生成', { 会话: id, 轮次ID: firstTurn.id });
  assert.equal(r.ok, true);
  await idle(m, id);
  s = read(m, id).会话;
  assert.deepEqual(projected.messages.map(x => x.parts), [text('第一问')]);
  assert.equal(s.messages.filter(x => x.turnId === firstTurn.id && x.role === 'user').length, 1);
  assert.equal(s.messages.filter(x => x.turnId === firstTurn.id && x.role === 'assistant').length, 1);
  assert.deepEqual(s.messages.filter(x => x.turnId !== firstTurn.id).map(x => x.id), laterIds);
  assert.equal(s.messages[1].parts[0].text, '补出的回复');
});
test('M06/M07/M14 图文原序受理、纯图有效、只发送本次素材、正常结束', async () => {
  const img = images();
  const m = await create({
    图片: img,
    执行: async ({ commit }) =>
      commit({
        kind: 'message',
        parts: text('回答'),
        reasoning: '',
        toolCalls: [],
        model: { provider: 'demo', model: 'one' },
      }),
  });
  const id = await fresh(m);
  const ids = [];
  for (let i = 0; i < 10; i++) ids.push((await img.write(id, payload())).data.id);
  assert.equal((await m.run('发', { 会话: id, 内容: text(' \n ') })).code, 'SESSION_EMPTY_INPUT');
  const content = [
    ...text(' 第一句\n下一行 '),
    { type: 'image', imageId: ids[0] },
    { type: 'image', imageId: ids[1] },
  ];
  const sent = await m.run('发', { 会话: id, 内容: content });
  assert.equal(sent.ok, true);
  await idle(m, id);
  const s = read(m, id).会话;
  assert.deepEqual(s.messages[0].parts, content);
  assert.equal(s.title, '第一句');
  assert.equal(s.turns[0].status, 'complete');
  assert.equal(s.messages[1].parts[0].text, '回答');
  assert.equal(img.list(id).data.ids.length, 10);
  assert.equal(
    (await m.run('发', { 会话: id, 内容: [{ type: 'image', imageId: ids[2] }] })).ok,
    true,
  );
  await idle(m, id);
});
for (const kind of ['memory', 'file'])
  test(`M02 ${kind} 新建与改名可重新加载且其他会话保持`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-test-'));
    try {
      const port = kind === 'file' ? createFileAdapter({ 根目录: dir }) : createMemoryAdapter();
      const m = await create({ port });
      const a = await fresh(m),
        b = await fresh(m);
      assert.equal((await m.run('改名', { 会话: a, 标题: '  全文标题  ' })).ok, true);
      const next = await create({ port });
      assert.equal(read(next, a).会话.title, '全文标题');
      assert.equal(read(next, b).会话.title, '新对话');
      assert.equal(next.run('列').data.总数, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
test('M03 读取与动作说明交副本', async () => {
  const m = await create(),
    id = await fresh(m);
  read(m, id).会话.title = '污染';
  const description = m.describe();
  description[0].摘要 = '污染';
  description[1].参数.push('污染');
  assert.equal(read(m, id).会话.title, '新对话');
  assert.equal(m.describe()[1].参数.length, 1);
});
for (const kind of ['memory', 'file'])
  test(`M05 ${kind} 草稿顺序恢复且不改变历史与更新时间`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-draft-'));
    try {
      const port = kind === 'file' ? createFileAdapter({ 根目录: dir }) : createMemoryAdapter();
      const m = await create({ port }),
        id = await fresh(m);
      const content = [...text(' 原文\n'), { type: 'image', imageId: 'img_a' }, ...text('尾部')];
      const before = read(m, id).会话.updatedAt;
      assert.equal((await m.run('草稿', { 会话: id, 内容: content })).ok, true);
      content[0].text = '改';
      const next = await create({ port });
      assert.deepEqual(read(next, id).会话.draft, [
        ...text(' 原文\n'),
        { type: 'image', imageId: 'img_a' },
        ...text('尾部'),
      ]);
      assert.deepEqual(read(next, id).会话.messages, []);
      assert.equal(read(next, id).会话.updatedAt, before);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
test('M08 首次写失败不调用执行器且保留草稿', async () => {
  const store = createMemoryAdapter();
  let bad = false,
    executions = 0;
  const m = await create({
    port: {
      ...store,
      write: (id, s) =>
        bad ? Promise.resolve({ ok: false, reason: '盘不可写' }) : store.write(id, s),
    },
    执行: async () => {
      executions++;
      return { ok: true };
    },
  });
  const id = await fresh(m);
  await m.run('草稿', { 会话: id, 内容: text('待发') });
  bad = true;
  assert.equal((await m.run('发', { 会话: id, 内容: text('待发') })).code, 'SESSION_WRITE_FAILED');
  assert.equal(executions, 0);
  assert.deepEqual(read(m, id).会话.draft, text('待发'));
  assert.deepEqual(read(m, id).会话.messages, []);
  assert.equal(read(m, id).运行状态, '空闲');
});
test('M09/M10/M11 并发会话独立，停立即传达但到收口前仍busy，同文可再发', async () => {
  const gate = deferred(),
    entered = deferred();
  let signal;
  const m = await create({
    执行: async (input) => {
      signal = input.signal;
      entered.resolve();
      await gate.promise;
      return { ok: true };
    },
  });
  const a = await fresh(m),
    b = await fresh(m);
  const first = m.run('发', { 会话: a, 内容: text('同文') });
  assert.equal((await m.run('发', { 会话: a, 内容: text('同文') })).code, 'SESSION_BUSY');
  assert.equal((await first).ok, true);
  await entered.promise;
  assert.equal((await m.run('改名', { 会话: b, 标题: 'B' })).ok, true);
  assert.equal((await m.run('停', { 会话: a })).data.已请求, true);
  assert.equal(signal.aborted, true);
  assert.equal(read(m, a).运行状态, '停止中');
  assert.equal((await m.run('发', { 会话: a, 内容: text('同文') })).code, 'SESSION_BUSY');
  gate.resolve();
  await idle(m, a);
  assert.equal(read(m, a).会话.turns[0].status, 'stopped');
  assert.equal((await m.run('发', { 会话: a, 内容: text('同文') })).ok, true);
  await idle(m, a);
  assert.equal(read(m, a).会话.messages.length, 2);
});
test('M12/M13 事实保存失败阻止后续副作用，真实结果保留内存，可重试存', async () => {
  for (const phase of ['message', 'result']) {
    const store = createMemoryAdapter();
    let bad = false,
      effects = 0;
    const m = await create({
      port: {
        ...store,
        write: (id, s) =>
          bad ? Promise.resolve({ ok: false, reason: '断盘' }) : store.write(id, s),
      },
      执行: async ({ commit }) => {
        if (phase === 'message') bad = true;
        const decl = await commit({
          kind: 'message',
          parts: [],
          reasoning: '',
          toolCalls: [
            { id: 'one', name: 'tag_query', args: '{}' },
            { id: 'two', name: 'tag_query', args: '{}' },
          ],
          model: null,
        });
        if (!decl.ok) return decl;
        const running = await commit({
          kind: 'tool',
          messageId: decl.data.消息ID,
          callId: 'one',
          status: 'running',
        });
        if (!running.ok) return running;
        effects++;
        bad = true;
        const result = await commit({
          kind: 'tool',
          messageId: decl.data.消息ID,
          callId: 'one',
          status: 'complete',
          result: { 实际: 123 },
        });
        if (!result.ok) return result;
        effects++;
        return { ok: true };
      },
    });
    const id = await fresh(m);
    await m.run('发', { 会话: id, 内容: text('发') });
    await idle(m, id);
    assert.equal(effects, phase === 'message' ? 0 : 1);
    const state = read(m, id);
    assert.equal(state.未保存, true);
    assert.equal(state.会话.turns[0].status, 'failed');
    if (phase === 'result') {
      assert.deepEqual(state.会话.messages[1].toolCalls[0].result, { 实际: 123 });
      assert.equal(state.会话.messages[1].toolCalls[1].status, 'cancelled');
    }
    bad = false;
    assert.equal((await m.run('存', { 会话: id })).ok, true);
    assert.equal(read(m, id).未保存, false);
  }
});
test('M15 迟到和错误消息工具提交不会改变既有事实', async () => {
  let late, wrong;
  const m = await create({
    执行: async ({ commit }) => {
      late = commit;
      const r = await commit({
        kind: 'message',
        parts: text('调用'),
        reasoning: '',
        toolCalls: [{ id: 'one', name: 'tag_query', args: '{}' }],
        model: null,
      });
      wrong = await commit({
        kind: 'tool',
        messageId: 'm_other',
        callId: 'one',
        status: 'running',
      });
      await commit({ kind: 'tool', messageId: r.data.消息ID, callId: 'one', status: 'running' });
      await commit({
        kind: 'tool',
        messageId: r.data.消息ID,
        callId: 'one',
        status: 'complete',
        result: { ok: true },
      });
      return { ok: true };
    },
  });
  const id = await fresh(m);
  await m.run('发', { 会话: id, 内容: text('发') });
  await idle(m, id);
  assert.equal(wrong.code, 'SESSION_BAD_UPDATE');
  const before = read(m, id).会话;
  assert.equal((await late({ kind: 'context', text: '迟到' })).code, 'SESSION_BAD_UPDATE');
  assert.deepEqual(read(m, id).会话, before);
});
async function runningSnapshot() {
  const gate = deferred(),
    submitted = deferred();
  const m = await create({
    执行: async ({ commit }) => {
      const r = await commit({
        kind: 'message',
        parts: [],
        reasoning: '',
        toolCalls: ['p', 'r', 'c'].map((id) => ({ id, name: 'tag_query', args: '{}' })),
        model: null,
      });
      for (const callId of ['r', 'c'])
        await commit({ kind: 'tool', messageId: r.data.消息ID, callId, status: 'running' });
      await commit({
        kind: 'tool',
        messageId: r.data.消息ID,
        callId: 'c',
        status: 'complete',
        result: { 真实: true },
      });
      submitted.resolve();
      await gate.promise;
      return { ok: true };
    },
  });
  const id = await fresh(m);
  await m.run('发', { 会话: id, 内容: text('发') });
  await submitted.promise;
  const s = read(m, id).会话;
  gate.resolve();
  await m.close();
  return s;
}
test('M16/M17 恢复只收口中断，不执行；恢复保存失败明确未保存', async () => {
  const s = await runningSnapshot();
  let executions = 0;
  const store = createMemoryAdapter({ sessions: [s] });
  const m = await create({
    port: { ...store, write: async () => ({ ok: false, reason: '恢复不可写' }) },
    执行: async () => {
      executions++;
    },
  });
  const state = read(m, s.id);
  assert.equal(state.会话.turns[0].status, 'interrupted');
  assert.equal(state.未保存, true);
  assert.equal(executions, 0);
  assert.deepEqual(
    state.会话.messages[1].toolCalls.map((c) => c.status),
    ['cancelled', 'interrupted', 'complete'],
  );
  assert.deepEqual(state.会话.messages[1].toolCalls[2].result, { 真实: true });
});
test('M30 close拒绝外部写，取消执行并保存最终状态', async () => {
  const entered = deferred();
  const m = await create({
    执行: async ({ signal }) => {
      entered.resolve();
      await new Promise((r) => signal.addEventListener('abort', r, { once: true }));
      return { ok: true };
    },
  });
  const id = await fresh(m);
  await m.run('发', { 会话: id, 内容: text('发') });
  await entered.promise;
  await m.close();
  assert.equal((await m.run('草稿', { 会话: id, 内容: [] })).code, 'SESSION_CLOSED');
  assert.equal(read(m, id).会话.turns[0].status, 'stopped');
  assert.equal(read(m, id).未保存, false);
});
test('M18/M19/M20 清空留素材，删除仅操作目标；保图逐字节复制', async () => {
  for (const keep of [false, true]) {
    const img = images(),
      m = await create({ 图片: img, 执行: async () => ({ ok: true }) });
    const a = await fresh(m),
      b = await fresh(m);
    await img.write(a, payload());
    await img.write(b, payload());
    await m.run('发', { 会话: a, 内容: text('标题') });
    await idle(m, a);
    await m.run('草稿', { 会话: a, 内容: text('草稿') });
    assert.equal((await m.run('清空', { 会话: a })).data.已清空, 1);
    assert.equal(read(m, a).会话.title, '标题');
    assert.deepEqual(read(m, a).会话.draft, []);
    assert.equal(img.list(a).data.ids.length, 1);
    const r = await m.run('删', { 会话: a, 保留图片: keep });
    assert.equal(r.ok, true);
    assert.equal(m.run('读', { 会话: a }).code, 'SESSION_NO_SUCH_SESSION');
    assert.equal(img.list(a).data.ids.length, 0);
    assert.equal(img.list(b).data.ids.length, 1);
    assert.equal(img.gallery.size, keep ? 1 : 0);
    if (keep) assert.deepEqual([...img.gallery.values()][0].bytes, payload().bytes);
  }
});
test('M24/M25/M28 自包含归档保留未发送图和缺图，只重写明确引用', async () => {
  const img = images();
  let marker;
  const m = await create({
    图片: img,
    执行: async ({ commit }) => {
      const r = await commit({
        kind: 'message',
        parts: text('原文 img_old'),
        reasoning: '',
        toolCalls: [{ id: 'orig', name: 'tag_query', args: '{"原文":"img_old"}' }],
        model: null,
      });
      await commit({ kind: 'tool', messageId: r.data.消息ID, callId: 'orig', status: 'running' });
      await commit({
        kind: 'tool',
        messageId: r.data.消息ID,
        callId: 'orig',
        status: 'complete',
        result: { nested: [marker], ordinary: 'img_old' },
      });
      return { ok: true };
    },
  });
  const id = await fresh(m);
  const sent = (await img.write(id, payload())).data.id,
    unused = (await img.write(id, payload())).data.id;
  marker = { type: 'session-image', imageId: sent };
  await m.run('发', { 会话: id, 内容: [{ type: 'image', imageId: sent }] });
  await idle(m, id);
  await m.run('草稿', { 会话: id, 内容: [{ type: 'image', imageId: 'img_missing' }] });
  const exp = await m.run('导出', { 会话列表: [id] });
  assert.equal(exp.ok, true);
  const archive = JSON.parse(exp.data.内容);
  assert.equal(archive.sessions[0].images.length, 2);
  assert.equal(archive.sessions[0].images[1].id, unused);
  assert.deepEqual(archive.sessions[0].missing, [
    { id: 'img_missing', reason: 'IMAGE_NOT_FOUND: 图片已删除' },
  ]);
  const imp = await m.run('导入', { 内容: exp.data.内容 });
  assert.equal(imp.ok, true);
  const newId = imp.data.会话ID列表[0];
  assert.notEqual(newId, id);
  await m.run('删', { 会话: id });
  const s = read(m, newId).会话;
  const newImage = s.messages[0].parts[0].imageId;
  assert.notEqual(newImage, sent);
  assert.deepEqual(img.read(newId, newImage).data.bytes, payload().bytes);
  assert.notEqual(s.messages[1].toolCalls[0].id, 'orig');
  assert.equal(s.messages[1].parts[0].text, '原文 img_old');
  assert.equal(s.messages[1].toolCalls[0].args, '{"原文":"img_old"}');
  assert.equal(s.messages[1].toolCalls[0].result.nested[0].imageId, newImage);
  assert.equal(s.messages[1].toolCalls[0].result.ordinary, 'img_old');
  assert.deepEqual(s.draft[0], {
    type: 'image',
    imageId: null,
    missing: { originalId: 'img_missing', reason: 'IMAGE_NOT_FOUND: 图片已删除' },
  });
});
test('M04 坏文件独立冻结，好会话可写，坏文件可删；根不可读不是空库', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-bad-'));
  try {
    fs.writeFileSync(path.join(dir, 's_bad.json'), '{');
    const port = createFileAdapter({ 根目录: dir });
    const m = await create({ port });
    const id = await fresh(m);
    assert.equal(m.run('列').data.总数, 2);
    assert.equal(m.run('列').data.会话.find((s) => s.标识 === 's_bad').冻结, true);
    assert.equal(
      (await m.run('草稿', { 会话: 's_bad', 内容: [] })).code,
      'SESSION_STORE_UNREADABLE',
    );
    assert.equal((await m.run('改名', { 会话: id, 标题: '可用' })).ok, true);
    assert.equal((await m.run('删', { 会话: 's_bad' })).ok, true);
    assert.equal(m.run('列').data.总数, 1);
    const bad = await create({
      port: { ...port, list: () => ({ ok: false, reason: '拒绝读取' }) },
    });
    assert.equal(bad.run('列').code, 'SESSION_STORE_UNREADABLE');
    assert.equal((await bad.run('新')).code, 'SESSION_STORE_UNREADABLE');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('M21 保图第二张失败保留源会话与素材并返回第一张图库引用', async () => {
  const img = images();
  let count = 0;
  const m = await create({
    图片: {
      ...img,
      copyToGallery: (sid, iid) =>
        ++count === 2
          ? { ok: false, code: 'IMAGE_WRITE_FAILED', reason: 'IMAGE_WRITE_FAILED: 盘满' }
          : img.copyToGallery(sid, iid),
    },
  });
  const id = await fresh(m);
  await img.write(id, payload());
  await img.write(id, payload());
  const r = await m.run('删', { 会话: id, 保留图片: true });
  assert.equal(r.code, 'IMAGE_WRITE_FAILED');
  assert.equal(r.details.阶段, '保图');
  assert.equal(r.details.已保留.length, 1);
  assert.equal(img.list(id).data.ids.length, 2);
  assert.equal(m.run('读', { 会话: id }).ok, true);
});
test('M22 清图部分失败与删文件失败入口保留，M23 未回收警告原样返回', async () => {
  for (const phase of ['clear', 'remove', 'warning']) {
    const img = images(),
      store = createMemoryAdapter();
    const m = await create({
      port: {
        ...store,
        remove: phase === 'remove' ? async () => ({ ok: false, reason: '不可删' }) : store.remove,
      },
      图片: {
        ...img,
        clear: async (id) => {
          await img.clear(id);
          return phase === 'clear'
            ? {
                ok: false,
                code: 'IMAGE_DELETE_FAILED',
                reason: 'IMAGE_DELETE_FAILED: 部分失败',
                details: { 已删: 1 },
              }
            : { ok: true, data: { 已删: 1, 未回收: true } };
        },
      },
    });
    const id = await fresh(m);
    await img.write(id, payload());
    const r = await m.run('删', { 会话: id });
    if (phase === 'warning') {
      assert.equal(r.ok, true);
      assert.equal(r.data.图片回执.未回收, true);
    } else {
      assert.equal(r.ok, false);
      assert.equal(r.details.阶段, phase === 'clear' ? '清图' : '删记录');
      assert.equal(m.run('读', { 会话: id }).ok, true);
      assert.equal(read(m, id).运行状态, '空闲');
    }
  }
});
test('M26 坏结构、非法base64、图片映射漏项在任何副作用之前拒绝', async () => {
  const img = images(),
    m = await create({ 图片: img });
  const id = await fresh(m),
    iid = (await img.write(id, payload())).data.id;
  await m.run('草稿', { 会话: id, 内容: [{ type: 'image', imageId: iid }] });
  const archive = JSON.parse((await m.run('导出', { 会话列表: [id] })).data.内容);
  for (const mutate of [
    (a) => {
      a.version = 1;
    },
    (a) => {
      a.sessions[0].images[0].base64 = 'AQID\n';
    },
    (a) => {
      a.sessions[0].images = [];
    },
  ]) {
    const a = structuredClone(archive);
    mutate(a);
    assert.equal((await m.run('导入', { 内容: JSON.stringify(a) })).code, 'SESSION_BAD_ARGUMENT');
    assert.equal(m.run('列').data.总数, 1);
  }
});
test('M27 多项导入写图失败，已完成项及当前未完成会话可见', async () => {
  const img = images(),
    m = await create({ 图片: img });
  const a = await fresh(m),
    b = await fresh(m);
  await img.write(a, payload());
  await img.write(b, payload());
  const text = (await m.run('导出', { 会话列表: [a, b] })).data.内容;
  let writes = 0;
  const targetImg = images(),
    target = await create({
      图片: {
        ...targetImg,
        write: (id, p) =>
          ++writes === 2
            ? { ok: false, code: 'IMAGE_WRITE_FAILED', reason: 'IMAGE_WRITE_FAILED: 导入失败' }
            : targetImg.write(id, p),
      },
    });
  const r = await target.run('导入', { 内容: text });
  assert.equal(r.code, 'IMAGE_WRITE_FAILED');
  assert.equal(r.details.已导入.length, 1);
  assert.equal(target.run('列').data.总数, 2);
  assert.equal(read(target, r.details.部分会话).会话.title, '导入未完成：新对话');
});
test('M29 运行快照导入只中断不执行，工具协议闭合', async () => {
  const snapshot = await runningSnapshot();
  const port = createMemoryAdapter({ sessions: [snapshot] });
  const gate = deferred(),
    m = await create({
      执行: async () => {
        await gate.promise;
        return { ok: true };
      },
    });
  const id = await fresh(m);
  await m.run('发', { 会话: id, 内容: text('运行快照') });
  const runningArchive = await m.run('导出', { 会话列表: [id] });
  let calls = 0;
  const target = await create({
    执行: async () => {
      calls++;
    },
  });
  const r = await target.run('导入', { 内容: runningArchive.data.内容 });
  assert.equal(r.ok, true);
  assert.equal(read(target, r.data.会话ID列表[0]).会话.turns[0].status, 'interrupted');
  assert.equal(calls, 0);
  gate.resolve();
  await m.close();
  const recovered = await create({ port });
  assert.deepEqual(
    read(recovered, snapshot.id).会话.messages[1].toolCalls.map((c) => c.status),
    ['cancelled', 'interrupted', 'complete'],
  );
});
test('最终保存失败把轮次记为failed并保留未保存事实', async () => {
  const store = createMemoryAdapter();
  let bad = false;
  const m = await create({
    port: {
      ...store,
      write: (id, s) => (bad ? { ok: false, reason: '终态盘满' } : store.write(id, s)),
    },
    执行: async () => {
      bad = true;
      return { ok: true };
    },
  });
  const id = await fresh(m);
  await m.run('发', { 会话: id, 内容: text('内容') });
  await idle(m, id);
  assert.equal(read(m, id).会话.turns[0].status, 'failed');
  assert.equal(read(m, id).会话.turns[0].error.code, 'SESSION_WRITE_FAILED');
  assert.equal(read(m, id).未保存, true);
});
test('已结束工具保存真实JSON null结果，重建后协议仍闭合', async () => {
  const port = createMemoryAdapter();
  const m = await create({
    port,
    执行: async ({ commit }) => {
      const r = await commit({
        kind: 'message',
        parts: [],
        reasoning: '',
        toolCalls: [{ id: 'clear', name: 'comfy_clearWorkflow', args: '{}' }],
        model: null,
      });
      await commit({ kind: 'tool', messageId: r.data.消息ID, callId: 'clear', status: 'running' });
      const result = await commit({
        kind: 'tool',
        messageId: r.data.消息ID,
        callId: 'clear',
        status: 'complete',
        result: null,
      });
      assert.equal(result.ok, true);
      return { ok: true };
    },
  });
  const id = await fresh(m);
  await m.run('发', { 会话: id, 内容: text('清工作流') });
  await idle(m, id);
  const next = await create({ port });
  const s = read(next, id).会话;
  assert.equal(s.turns[0].status, 'complete');
  assert.equal(s.messages[1].toolCalls[0].status, 'complete');
  assert.equal(s.messages[1].toolCalls[0].result, null);
});
test('M10 A/B同时执行，改名与不同轮次结果各归明确ID', async () => {
  const gates = new Map(),
    entered = deferred();
  const m = await create({
    执行: async ({ sessionId, commit }) => {
      const gate = deferred();
      gates.set(sessionId, gate);
      if (gates.size === 2) entered.resolve();
      await gate.promise;
      return commit({
        kind: 'message',
        parts: text(sessionId),
        reasoning: '',
        toolCalls: [],
        model: null,
      });
    },
  });
  const a = await fresh(m),
    b = await fresh(m);
  await m.run('发', { 会话: a, 内容: text('A') });
  await m.run('发', { 会话: b, 内容: text('B') });
  await entered.promise;
  assert.equal(read(m, a).运行状态, '运行中');
  assert.equal(read(m, b).运行状态, '运行中');
  await m.run('改名', { 会话: b, 标题: '独立B' });
  gates.get(b).resolve();
  await idle(m, b);
  assert.equal(read(m, a).运行状态, '运行中');
  gates.get(a).resolve();
  await idle(m, a);
  assert.equal(read(m, a).会话.messages[1].parts[0].text, a);
  assert.equal(read(m, b).会话.messages[1].parts[0].text, b);
  assert.equal(read(m, b).会话.title, '独立B');
});

test('会话提问等待显式回答；按会话隔离，回答与取消都收口到各自轮次', async () => {
  const m = await create({
    执行: async ({ 提问 }) => {
      const answer = await 提问.ask({ 问题: '选择角色', 选项: ['A', 'B'] });
      if (!answer.ok) return { ok: false, code: 'SESSION_STOPPED', reason: 'SESSION_STOPPED: 用户取消提问' };
      return { ok: true };
    },
  });
  const events = [];
  m.subscribe((event) => events.push(event));
  const a = await fresh(m), b = await fresh(m);
  await m.run('发', { 会话: a, 内容: text('角色 A') });
  await m.run('发', { 会话: b, 内容: text('角色 B') });
  for (let n = 0; n < 100; n++) {
    if (read(m, a).待答问题 && read(m, b).待答问题) break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const questionA = m.run('待答问题', { 会话: a }).data.问题;
  const questionB = m.run('待答问题', { 会话: b }).data.问题;
  assert.ok(questionA && questionB);
  assert.notEqual(questionA.问题ID, questionB.问题ID);
  assert.equal((await m.run('回答问题', { 会话: a, 问题ID: questionA.问题ID, 答案: 'A' })).ok, true);
  assert.equal((await m.run('取消问题', { 会话: b, 问题ID: questionB.问题ID })).ok, true);
  await idle(m, a);
  await idle(m, b);
  assert.equal(read(m, a).会话.turns[0].status, 'complete');
  assert.equal(read(m, b).会话.turns[0].status, 'stopped');
  assert.equal(read(m, a).待答问题, null);
  assert.equal(read(m, b).待答问题, null);
  assert.ok(events.some((event) => event.待答问题变更?.some((change) => change.会话ID === a && change.问题?.问题ID === questionA.问题ID)));
  assert.ok(events.some((event) => event.待答问题变更?.some((change) => change.会话ID === b && change.问题 === null)));
});
