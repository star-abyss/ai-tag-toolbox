import assert from 'node:assert/strict';
import test from 'node:test';
import { 登记工具 } from '../登记工具.js';
import { 工具声明, 模型工具 } from '../工具定义.js';

function ctx工具() {
  const registered = [];
  return {
    registered,
    ctx: { tools: { register: (definition) => { registered.push(definition); return () => {}; } } },
  };
}

test('业务schema的摘要、必填项和嵌套必填项进入模型定义', () => {
  const row = {
    名字: 'draw_image',
    摘要: '按提示词生成图片',
    参数: {
      prompt: { type: 'string', description: '正向提示词', required: true },
      options: {
        type: 'object',
        required: true,
        properties: {
          width: { type: 'integer', required: true },
          seed: { type: 'integer' },
        },
      },
    },
    说明: {},
  };
  const model = 模型工具(工具声明(row)).function;
  assert.equal(model.description.includes('按提示词生成图片'), true);
  assert.deepEqual(model.parameters.required, ['prompt', 'options']);
  assert.deepEqual(model.parameters.properties.options.required, ['width']);
  assert.equal(model.parameters.properties.options.properties.width.type, 'integer');
});

test('仅登记业务工具表，并按原工具名把调用交给业务执行器', async () => {
  const { ctx, registered } = ctx工具();
  const calls = [];
  const business = {
    工具表: [{
      名字: 'draw_image',
      摘要: '生成图片',
      参数: { prompt: { type: 'string', required: true } },
      说明: {},
    }],
    async 执行(name, args) { calls.push([name, args]); return { ok: true, data: { done: true } }; },
  };
  const result = 登记工具({ ctx, 业务: business, 处理回执: async (value) => value });
  assert.deepEqual(result.map((row) => row.名字), ['draw_image']);
  assert.equal(registered.length, 1);
  assert.deepEqual(await registered[0].execute({ prompt: 'cat' }), { done: true });
  assert.deepEqual(calls, [['draw_image', { prompt: 'cat' }]]);
});

test('失败回执的原文、原因和细节完整保留', async () => {
  const { ctx, registered } = ctx工具();
  const business = {
    工具表: [{ 名字: 'draw_image', 摘要: '生成', 参数: {}, 说明: {} }],
    async 执行() {
      return { ok: false, code: 'DRAW_FAILED', reason: '供应商拒绝', 原文: { status: 400 }, 原因: { request: 'bad' }, details: { retryable: false } };
    },
  };
  登记工具({ ctx, 业务: business, 处理回执: async (value) => value });
  await assert.rejects(registered[0].execute({}), (error) => {
    assert.equal(error.code, 'DRAW_FAILED');
    assert.equal(error.reason, '供应商拒绝');
    assert.deepEqual(error.原文, { status: 400 });
    assert.deepEqual(error.原因, { request: 'bad' });
    assert.deepEqual(error.details, { retryable: false });
    return true;
  });
});

test('没有业务工具时不登记任何工具', () => {
  const { ctx, registered } = ctx工具();
  assert.deepEqual(登记工具({ ctx, 业务: { 工具表: [], 执行: async () => null }, 处理回执: async (value) => value }), []);
  assert.deepEqual(registered, []);
});

test('并行执行使用各自的 DSH agent、session 与 signal，不串上下文', async () => {
  const { ctx, registered } = ctx工具();
  const observed = [];
  const business = {
    工具表: [{ 名字: 'draw_image', 摘要: '生成', 参数: {}, 说明: {} }],
    async 执行(name, args, context) {
      await new Promise((resolve) => setImmediate(resolve));
      observed.push({ name, request: args.request, agent: context.agent, signal: context.signal });
      return { ok: true, data: { request: args.request } };
    },
  };
  登记工具({ ctx, 业务: business, 处理回执: async (value) => value, 上下文: { injected: 'from-registration' } });

  const agent1 = { session: { id: 'session-1' } };
  const agent2 = { session: { id: 'session-2' } };
  const signal1 = new AbortController().signal;
  const signal2 = new AbortController().signal;
  await Promise.all([
    registered[0].execute({ request: 'one' }, { agent: agent1, signal: signal1 }),
    registered[0].execute({ request: 'two' }, { agent: agent2, signal: signal2 }),
  ]);
  assert.deepEqual(observed, [
    { name: 'draw_image', request: 'one', agent: agent1, signal: signal1 },
    { name: 'draw_image', request: 'two', agent: agent2, signal: signal2 },
  ]);
});

test('DSH 未提供调用上下文时使用明确注入的上下文', async () => {
  const { ctx, registered } = ctx工具();
  const injected = { agent: { session: { id: 'injected-session' } }, signal: 'injected-signal' };
  let received;
  const business = {
    工具表: [{ 名字: 'draw_image', 摘要: '生成', 参数: {}, 说明: {} }],
    async 执行(_name, _args, context) { received = context; return { ok: true, data: {} }; },
  };
  登记工具({ ctx, 业务: business, 处理回执: async (value) => value, 上下文: injected });
  await registered[0].execute({});
  assert.deepEqual(received, injected);
  assert.equal(received, injected, '未提供平台上下文时直接使用已注入上下文');
});
