import assert from 'node:assert/strict';
import test from 'node:test';
import { 造绘画业务 } from '../绘画业务.js';
import image from '../../图片模块/index.js';
import memory from '../../图片模块/adapter-memory.js';
import session from '../../会话模块/index.js';
import { 造会话图片 } from '../会话图片.js';
import { 造会话执行 } from '../会话执行.js';

function fixture(settings) {
  const calls = [];
  const images = image.createImageModule({ port: memory.createMemoryAdapter() });
  const 门面 = {
    image: images,
    comfy: {
      async run(action, args = {}) {
        if (action === '生成设置') return { ok: true, data: structuredClone(settings) };
        if (action === '认') return { ok: true, data: { 正向: [{}], 负向: [], 图片: [], 张数: [{}] } };
        if (action === '绘图开关') return { ok: true, data: { 启用: true } };
        if (action === '出图') {
          calls.push(args);
          args.onEvent?.({ 类型: '提交中' });
          return { ok: true, data: { 产出: Array.from({ length: args.张数 }, (_, n) => ({ 文件名: `图${n}.png`, 种类: 'image' })) } };
        }
        if (action === '取图') return { ok: true, data: { 字节: Buffer.from([1, 2, 3]), 文件名: args.产出.文件名, mime: 'image/png' } };
        throw new Error(`未实现 ${action}`);
      },
    },
  };
  return { 门面, calls, drawing: 造绘画业务({ 门面, sessionId: 'ses_generation', 生成设置: settings }) };
}

test('关闭自动迭代只允许首次生图，但模型回执不包含内部额度', async () => {
  const { drawing, calls } = fixture({ 每轮张数: 2, 最多轮数: 3, 自动迭代: false });
  const first = await drawing.执行('drawing_generate', { 正向: 'a red house' });
  assert.equal(first.ok, true);
  assert.equal(calls[0].张数, 2);
  assert.equal(first.data.图片.length, 2);
  assert.equal('生成状态' in first.data, false);
  const second = await drawing.执行('drawing_generate', { 正向: 'a blue house' });
  assert.equal(second.code, 'BUSINESS_GENERATION_LIMIT');
  assert.equal(calls.length, 1);
});

test('最多三轮包含首次，达到上限仍能读图，drawing_info不暴露额度', async () => {
  const { drawing, calls } = fixture({ 每轮张数: 2, 最多轮数: 3, 自动迭代: true });
  for (const prompt of ['red', 'blue', 'green']) assert.equal((await drawing.执行('drawing_generate', { 正向: prompt })).ok, true);
  assert.equal((await drawing.执行('drawing_generate', { 正向: 'fourth' })).code, 'BUSINESS_GENERATION_LIMIT');
  assert.equal(calls.length, 3);
  assert.equal((await drawing.执行('images_list')).data.图片.length, 6);
  const info = await drawing.执行('drawing_info');
  assert.equal('生成状态' in info.data, false);
  assert.equal(JSON.stringify(info).includes('最多轮数'), false);
});

test('提交前失败不消耗轮数，真正尝试提交后失败仍占一轮', async () => {
  const { drawing, 门面 } = fixture({ 每轮张数: 2, 最多轮数: 1, 自动迭代: true });
  const original = 门面.comfy.run;
  let submit = false;
  门面.comfy.run = async (action, args) => {
    if (action !== '出图') return original(action, args);
    if (submit) args.onEvent({ 类型: '提交中' });
    return { ok: false, code: 'COMFY_FAILED', reason: 'COMFY_FAILED: 提交失败' };
  };
  const before = await drawing.执行('drawing_generate', { 正向: 'red' });
  assert.equal('生成状态' in before, false);
  submit = true;
  const after = await drawing.执行('drawing_generate', { 正向: 'red' });
  assert.equal('生成状态' in after, false);
  assert.equal((await drawing.执行('drawing_generate', { 正向: 'retry' })).code, 'BUSINESS_GENERATION_LIMIT');
});

test('并发生成被闸门挡住，停止后不会发起下一次提交', async () => {
  const { 门面, calls } = fixture({ 每轮张数: 1, 最多轮数: 3, 自动迭代: true });
  const controller = new AbortController();
  const drawing = 造绘画业务({ 门面, sessionId: 'ses_stop', signal: controller.signal });
  const first = drawing.执行('drawing_generate', { 正向: 'red' });
  assert.equal((await drawing.执行('drawing_generate', { 正向: 'blue' })).code, 'BUSINESS_GENERATION_BUSY');
  assert.equal((await first).ok, true);
  controller.abort();
  assert.equal((await drawing.执行('drawing_generate', { 正向: 'green' })).code, 'SESSION_STOPPED');
  assert.equal(calls.length, 1);
});

test('同一消息的多个生图共用额度，发送快照不受运行中改设置影响', async () => {
  const settings = { 每轮张数: 2, 最多轮数: 3, 自动迭代: false };
  const { 门面, calls } = fixture(settings);
  门面.主AI = { run: () => ({ ok: true, data: { 工具表: [{ 名字: 'drawing_generate' }], 模型: {}, 附加文本: {} } }) };
  门面.worldbook = { run: () => ({ ok: true, data: { 命中: [] } }) };
  const received = [], states = [];
  const 服务商 = { 固定请求: () => async request => {
    received.push(request);
    if (received.length === 1) {
      settings.每轮张数 = 7;
      settings.自动迭代 = true;
      return { 正文: '', 消息: { tool_calls: ['first', 'second'].map(id => ({ id, function: { name: 'drawing_generate', arguments: '{"正向":"red house"}' } })) }, 用的谁: null };
    }
    return { 正文: '完成', 消息: {}, 用的谁: null };
  } };
  const sessions = session.createSessionModule({
    port: session.createMemoryAdapter(), 图片: 造会话图片({ 图片门面: 门面.image }),
    执行: 造会话执行({ 门面, 服务商, onGenerationState: (_id, state) => states.push(state) }),
  });
  try {
    await sessions.ready;
    const id = (await sessions.run('新')).data.会话.id;
    await sessions.run('发', { 会话: id, 内容: [{ type: 'text', text: '画一个房子' }] });
    let final;
    for (let n = 0; n < 100; n++) {
      final = sessions.run('读', { 会话: id }).data;
      if (final.运行状态 === '空闲') break;
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    assert.equal(final.会话.turns[0].status, 'complete');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].张数, 2);
    assert.doesNotMatch(received[0].system, /每轮|自动迭代|最多\s*\d+轮|已用\s*\d+轮|剩余\s*\d+轮/);
    assert.doesNotMatch(received[1].system, /每轮|自动迭代|最多\s*\d+轮|已用\s*\d+轮|剩余\s*\d+轮/);
    const tools = final.会话.messages.flatMap(message => message.toolCalls);
    assert.equal(tools[0].status, 'complete');
    assert.equal(JSON.stringify(tools[0].result).includes('生成状态'), false);
    assert.equal(tools[1].result.code, 'BUSINESS_GENERATION_LIMIT');
    assert.equal(tools[1].result.reason, 'BUSINESS_GENERATION_LIMIT: 当前无法继续生成；可继续查看图片和回复');
    assert.equal(final.会话.messages.at(-1).parts[0].text, '完成');
    assert.ok(states.some(state => state?.剩余轮数 === 0));
  } finally { await sessions.close(); }
});

test('长任务提交后立即通知额度变化，不必等工具完成', async () => {
  const { 门面 } = fixture({ 每轮张数: 1, 最多轮数: 3, 自动迭代: true });
  门面.主AI = { run: () => ({ ok: true, data: { 工具表: [{ 名字: 'drawing_generate' }], 模型: {} } }) };
  门面.worldbook = { run: () => ({ ok: true, data: { 命中: [] } }) };
  let release, submitted, requests = 0, currentState;
  const wait = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { submitted = resolve; });
  const original = 门面.comfy.run;
  门面.comfy.run = async (...args) => {
    const result = await original(...args);
    if (args[0] === '出图') { submitted(); await wait; }
    return result;
  };
  const seen = [];
  const sessions = session.createSessionModule({
    port: session.createMemoryAdapter(), 图片: 造会话图片({ 图片门面: 门面.image }),
    执行: 造会话执行({ 门面, onGenerationState: (_id, state) => { currentState = state; },
      服务商: { 固定请求: () => async () => ++requests === 1
        ? { 正文: '', 消息: { tool_calls: [{ id: 'draw', function: { name: 'drawing_generate', arguments: '{"正向":"red"}' } }] }, 用的谁: null }
        : { 正文: '完成', 消息: {}, 用的谁: null } },
    }),
  });
  try {
    await sessions.ready;
    const id = (await sessions.run('新')).data.会话.id;
    sessions.subscribe(event => { if (event.变更.includes(id)) seen.push(structuredClone(currentState)); });
    await sessions.run('发', { 会话: id, 内容: [{ type: 'text', text: '生成' }] });
    await entered;
    assert.equal(sessions.run('读', { 会话: id }).data.运行状态, '运行中');
    assert.ok(seen.some(state => state?.已用轮数 === 1 && state?.剩余轮数 === 2), '实际提交时订阅者即可读取新的生成状态');
  } finally { release(); await sessions.close(); }
});
