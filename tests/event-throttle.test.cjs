'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const modules = require('../src/modules');

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

test('streaming deltas are throttled in runtime events and excluded from message task events', async () => {
  // 运行时：300 个流式分片不能刷出 256 条 delta 任务事件。
  const runtime = modules.createAgentRuntime({
    primaryClient: {
      complete: async (_messages, config) => {
        for (let i = 0; i < 300; i += 1) {
          config?.onDelta?.('x', '');
          if (i % 25 === 0) await wait(1);
        }
        return { ok: true, text: '完成', usage: { total_tokens: 300 } };
      }
    },
    tools: {},
    getSettings: () => ({ limits: { primaryTimeoutMs: 8000 } })
  });
  const result = await runtime.runPrimary({ requestId: 'delta-flood', input: { text: 'hi' } });
  assert.equal(result.ok, true, JSON.stringify(result.error || ''));
  const deltaEvents = (result.data.events || []).filter(event => event.type === 'delta');
  assert(deltaEvents.length <= 20, `delta events should be throttled, got ${deltaEvents.length}`);
  assert(result.data.events.some(event => event.type === 'round.start'), 'round.start missing');
  assert(result.data.events.some(event => event.type === 'round.complete'), 'round.complete missing');

  // 会话消息：任务事件只保留关键信息，不包含 delta。
  const assistant = modules.createAssistant({
    storage: modules.createStorage({ prefix: 'event-throttle-' + Date.now() }),
    primaryApi: { base: 'https://example.test/v1', model: 'throttle-model' },
    primaryGateway: {
      stream: async (_messages, opts) => {
        for (let i = 0; i < 300; i += 1) {
          opts?.onDelta?.('x', '');
          if (i % 25 === 0) await wait(1);
        }
        return { ok: true, text: '完成' };
      }
    }
  });
  const reply = await assistant.run({ text: '你好' });
  assert.equal(reply.ok, true, JSON.stringify(reply.error || ''));
  const message = assistant.currentSession().messages.at(-1);
  assert.equal(message.status, 'done');
  assert(message.events.length <= 256, 'events capped');
  assert(message.events.every(event => event.type !== 'delta'), 'message.events must not contain delta noise');
  assert(message.events.some(event => event.type === 'round.start'), 'message task events should keep round.start');
});

test('render progress polling events are deduped and excluded from message task events', async () => {
  let first = true;
  const runtime = modules.createAgentRuntime({
    primaryClient: {
      complete: async () => {
        if (first) { first = false; return { ok: true, toolCalls: [{ id: 'p1', type: 'function', function: { name: 'comfy_render', arguments: '{"positiveTags":["1girl"]}' } }] }; }
        return { ok: true, text: '完成' };
      }
    },
    tools: {
      'comfy.render': {
        parameters: { type: 'object' },
        outputSchema: { type: 'object' },
        handler: async (_args, ctx) => {
          for (let i = 0; i < 80; i += 1) ctx.onEvent({ type: 'progress', tool: 'comfy.render', queue: 1 });
          return { artifacts: [] };
        }
      }
    },
    getSettings: () => ({ limits: { primaryTimeoutMs: 8000 } })
  });
  const result = await runtime.runPrimary({ requestId: 'progress-flood', input: { text: '画' } });
  assert.equal(result.ok, true, JSON.stringify(result.error || ''));
  const progressCount = (result.data.events || []).filter(event => event.type === 'progress').length;
  assert.equal(progressCount, 1, `identical queue progress should be deduped, got ${progressCount}`);
  assert(result.data.events.some(event => event.type === 'tool.start' && event.name === 'comfy.render'), 'tool.start missing');
  assert(result.data.events.some(event => event.type === 'tool.complete' && event.name === 'comfy.render'), 'tool.complete missing');
  assert((result.data.events || []).length < 40, 'events should stay compact');

  // 会话消息层面：progress 与 delta 一律不进入任务事件。
  let gatewayFirst = true;
  const assistant = modules.createAssistant({
    storage: modules.createStorage({ prefix: 'progress-flood-' + Date.now() }),
    primaryApi: { base: 'https://example.test/v1', model: 'm' },
    settings: { comfy: { enabled: true, base: 'http://127.0.0.1:8188', workflow: {}, width: 768, height: 768, steps: 20, cfg: 7, negativeTags: [] } },
    primaryGateway: {
      complete: async () => {
        if (gatewayFirst) { gatewayFirst = false; return { ok: true, toolCalls: [{ id: 'c1', type: 'function', function: { name: 'generation_execute', arguments: '{"requirements":"1girl","mode":"create","strategy":"quick"}' } }] }; }
        return { ok: true, text: '完成' };
      }
    },
    visionGateway: { complete: async messages => /operation="review"/.test(messages[0].content)
      ? { text: '{"operation":"review","evaluations":[{"candidateId":"render-1","score":90,"verdict":"accept","confidence":0.9,"dimensions":{},"hardErrors":[],"issues":[],"strengths":[],"suggestedChanges":[],"summary":"ok"}]}' }
      : { text: '{"positiveTags":["1girl"]}' } },
    comfy: {
      status: async () => ({ connected: true, workflowReady: true, render: true, error: '' }),
      render: async ({ onProgress }) => {
        for (let i = 0; i < 80; i += 1) onProgress?.(1);
        return { artifact: { id: 'render-1', imageId: 'render-1', dataUrl: 'data:image/png;base64,AA==' } };
      }
    },
    images: { get: () => null, add: async value => ({ id: value.id || value.imageId || 'img-1', imageId: value.imageId || value.id || 'img-1', ...value }) },
    imageRepository: { attachToConversation: async () => ({ refId: 'r1', imageId: 'render-1' }), markSent: () => {}, authorizeVisionReference: () => null }
  });
  const reply = await assistant.run({ text: '画一张' });
  assert.equal(reply.ok, true, JSON.stringify(reply.error || ''));
  const message = assistant.currentSession().messages.at(-1);
  assert.equal(message.status, 'done');
  assert(message.events.every(event => event.type !== 'progress' && event.type !== 'delta'), 'no progress/delta in task events');
  assert(message.events.some(event => event.type === 'tool.start' && event.name === 'comfy.render'), 'internal comfy tool.start should be recorded');
  assert(message.events.some(event => event.type === 'tool.complete' && event.name === 'comfy.render'), 'internal comfy tool.complete should be recorded');
});

test('stream chunks with empty toolCalls array do not become provider.event task events', async () => {
  // 复现用户问题：OpenAI 兼容流式解析的每个分片带 toolCalls: []，空数组被误判为"有调用"，
  // 导致每段流式文本都变成一条 provider.event 任务事件。
  const runtime = modules.createAgentRuntime({
    primaryClient: {
      complete: async (_messages, config) => {
        // 正文/推理分片：空 toolCalls 数组。
        for (let i = 0; i < 60; i += 1) config?.onEvent?.({ content: '叙述中', reasoning: '', toolCalls: [] });
        // 工具调用参数碎片：非空 toolCalls（真实模型把参数拆成几十上百个小分片流式下发）。
        for (let i = 0; i < 60; i += 1) config?.onEvent?.({ content: '', reasoning: '', toolCalls: [{ index: 0, type: 'function', function: { name: 'agent_generateTags', arguments: '{"requ' } }] });
        return { ok: true, text: '完成' };
      }
    },
    tools: {},
    getSettings: () => ({ limits: { primaryTimeoutMs: 8000 } })
  });
  const result = await runtime.runPrimary({ requestId: 'provider-flood', input: { text: 'hi' } });
  assert.equal(result.ok, true, JSON.stringify(result.error || ''));
  const providerEvents = (result.data.events || []).filter(event => event.type === 'provider.event' || event.type === 'event');
  assert.equal(providerEvents.length, 0, `empty-toolCalls chunks must not become provider events, got ${providerEvents.length}`);
  assert(result.data.events.some(event => event.type === 'round.start'));
  assert(result.data.events.some(event => event.type === 'round.complete'));

  // 会话消息层面：即使出现带名称的 provider 事件，也保留关键信息而不显示成"任务事件"。
  const assistant = modules.createAssistant({
    storage: modules.createStorage({ prefix: 'provider-flood-' + Date.now() }),
    primaryApi: { base: 'https://example.test/v1', model: 'm' },
    primaryGateway: {
      stream: async (_messages, opts) => {
        for (let i = 0; i < 60; i += 1) opts?.onDelta?.('叙述', '');
        return { ok: true, text: '完成' };
      }
    }
  });
  const reply = await assistant.run({ text: '你好' });
  assert.equal(reply.ok, true, JSON.stringify(reply.error || ''));
  const message = assistant.currentSession().messages.at(-1);
  assert.equal(message.status, 'done');
  assert(message.events.every(event => event.type !== 'provider.event' && event.type !== 'event' && event.type !== 'delta' && event.type !== 'progress'), 'no task-event noise');
  assert(message.events.some(event => event.type === 'round.start'), 'round.start should be recorded');
});

console.log('event-throttle: ok');
