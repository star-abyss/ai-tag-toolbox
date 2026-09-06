'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createAgentRuntime } = require('../src/modules/agent-runtime');
const { createPrimaryTools } = require('../src/modules/primary-tools');
const { createFixedSubagents } = require('../src/modules/fixed-subagents');
const { createRequestManager } = require('../src/modules/request-manager');
const { createStatusManager } = require('../src/modules/status-manager');
const { createImages } = require('../src/modules/images');
const { createImageRepository } = require('../src/modules/image-repository');
const { createTranslation } = require('../src/modules/translation');
const { createVisionService } = require('../src/modules/vision-service');
const { createComfy } = require('../src/modules/comfy');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const baseSettings = { generateNegativeTags: false, comfy: { enabled: true, base: 'http://example.test:8188', workflow: {}, width: 640, height: 768, steps: 0, cfg: 0, seed: 0, sampler: 'euler', scheduler: 'normal', batchCount: 2, negativeTags: ['lowres'] }, limits: { maxComfyCalls: 2, maxToolRounds: 6, maxToolCalls: 16, primaryTimeoutMs: 1000 } };
function stack(options = {}) {
  let tools;
  const getSettings = options.getSettings || (() => baseSettings);
  const runtime = createAgentRuntime({ primaryClient: options.primaryClient, subagents: options.subagents || createFixedSubagents({ ...options, getSettings }), tools: () => tools, getSettings, getPrimaryPrompt: options.getPrimaryPrompt || (() => 'FIXED PRIMARY') });
  tools = createPrimaryTools({ ...options, runtime, getSettings: options.getSettings || (() => baseSettings) });
  return { runtime, tools };
}

test('native tools run a real translation child without cancelling the primary and keep the native call id', async () => {
  const translation = createTranslation({ dictionary: { 'zh-en': { '蓝发': 'blue hair' } } });
  const requests = []; let count = 0;
  const { runtime, tools } = stack({ translation, primaryClient: { complete: async (messages, config) => {
    requests.push(structuredClone(messages));
    assert.equal(config.tools.length, 8);
    assert(config.tools.every(item => /^[A-Za-z0-9_-]+$/.test(item.function.name)));
    if (!count++) return { text: '', usage: { total_tokens: 3 }, toolCalls: [{ id: 'provider-call-1', type: 'function', function: { name: 'translation_translate', arguments: '{"text":"蓝发","direction":"zh-en","source":"local"}' } }] };
    return { text: '完成', usage: { total_tokens: 4 } };
  } } });
  assert.equal(tools.has('translation_translate'), true);
  const result = await runtime.runPrimary({ requestId: 'parent', sessionId: 'session', messages: [{ role: 'system', content: 'OVERRIDE' }, { role: 'user', content: 'translate' }] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.text, '完成');
  assert.equal(result.usage.total_tokens, 7);
  assert.equal(result.usage.toolCalls, 1);
  assert.equal(result.usage.subAgentCalls, 1);
  assert.equal(runtime.usage.size(), 0);
  assert.equal(runtime.getStatus('parent').status, 'completed');
  assert.equal(requests[1][0].content, 'FIXED PRIMARY');
  const native = requests[1].find(item => item.role === 'assistant');
  const tool = requests[1].find(item => item.role === 'tool');
  assert.equal(tool.tool_call_id, native.tool_calls[0].id);
  assert.equal(JSON.parse(tool.content).text, 'blue hair');
  assert(result.data.events.some(item => item.type === 'tool.start'));
  assert(result.data.events.some(item => item.type === 'tool.complete'));
  const children = runtime.requests.list().filter(item => item.parentRequestId);
  assert.equal(children.length, 2);
  assert(children.every(item => item.requestId !== 'parent' && item.status === 'completed'));
});

test('tools ignoring abort still return a hard timeout and clean request listeners', async () => {
  const controller = new AbortController(); let resolveTool;
  const runtime = createAgentRuntime({ tools: { 'tags.search': { parameters: { type: 'object' }, handler: () => new Promise(resolve => { resolveTool = resolve; }) } } });
  const result = await runtime.callTool('tags.search', {}, { requestId: 'timeout-tool', timeoutMs: 15, signal: controller.signal });
  assert.equal(result.error.code, 'TIMEOUT');
  assert.equal(runtime.getStatus('timeout-tool').status, 'timeout');
  assert.equal(runtime.requests.getRecord('timeout-tool').externalSignal, null);
  resolveTool({ items: [] }); await wait(1);
  assert.equal(runtime.getStatus('timeout-tool').status, 'timeout');
  assert.equal(runtime.usage.size(), 0);
});

test('primary cancel propagates to tools and children without allowing late completion', async () => {
  let called; const ready = new Promise(resolve => { called = resolve; });
  const { runtime } = stack({ subagents: { translation: { inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, run: async (_input, context) => { called(context); return new Promise(() => {}); } } }, primaryClient: { complete: async () => ({ toolCalls: [{ id: 'c1', name: 'translation_translate', arguments: { text: 'hello' } }] }) } });
  const promise = runtime.runPrimary({ requestId: 'cancel-parent', input: { text: 'hello' } }); const child = await ready;
  assert.equal(runtime.cancel('cancel-parent'), true);
  const result = await promise; await wait(1);
  assert.equal(result.error.code, 'CANCELLED'); assert.equal(child.signal.aborted, true);
  assert(runtime.requests.list().every(item => item.status === 'cancelled'));
  assert.equal(runtime.cancel('cancel-parent'), false); assert.equal(runtime.usage.size(), 0);
});

test('generated tags use Vision AI, live prompt and controlled image and never enable negatives when disabled', async () => {
  let prompt = 'FIRST'; const messagesSeen = []; const resolved = [];
  const { runtime } = stack({ prompts: { get: () => prompt }, resolveImage: (id, context) => { resolved.push({ id, sessionId: context.sessionId }); return { dataUrl: 'data:image/png;base64,AQ==' }; }, visionAI: { complete: async (messages, config) => { messagesSeen.push(messages); assert.equal(config.stream, false); assert.equal(config.enable_thinking, false); assert.equal(config.tools, undefined); return { ok: true, text: '{"positiveTags":["1girl","2girls"],"negativeTags":["lowres"]}' }; } } });
  const input = { requirements: 'girl', imageId: 'img', generateNegativeTags: true };
  const first = await runtime.runSubAgent('generateTags', { input, sessionId: 's1' });
  assert.equal(first.ok, true, JSON.stringify(first)); assert.deepEqual(first.data.positiveTags, ['1girl', '2girls']); assert.equal(first.data.negativeTags, undefined);
  baseSettings.generateNegativeTags = true;
  const enabled = await runtime.runSubAgent('generateTags', { input: { ...input, generateNegativeTags: false }, sessionId: 's1' });
  assert.deepEqual(enabled.data.negativeTags, ['lowres']);
  baseSettings.generateNegativeTags = false;
  prompt = 'SECOND'; const second = await runtime.runSubAgent('generateTags', { input, sessionId: 's1' }); assert.equal(second.ok, true);
  assert.match(messagesSeen[2][0].content, /^SECOND\n/); assert.match(messagesSeen[2][0].content, /系统输出协议/); assert.equal(messagesSeen[2].length, 2);
  assert.equal(messagesSeen[2][1].content[1].image_url.url, 'data:image/png;base64,AQ=='); assert.equal(resolved[0].sessionId, 's1');
});

test('schema rejects extra input fields and malformed/empty child outputs', async () => {
  const { runtime, tools } = stack({ visionAI: { complete: async () => ({ text: 'not json' }) } });
  for (const args of [{ positiveTags: ['girl'], width: 1 }, { positiveTags: [42] }, { positiveTags: [] }, { positiveTags: ['girl'], seed: 0 }]) assert.equal((await tools.call('comfy.render', args)).error.code, 'INVALID_INPUT');
  assert.equal((await runtime.runSubAgent('generateTags', { input: { requirements: 'girl' } })).error.code, 'OUTPUT_INVALID');
  assert.equal((await runtime.runSubAgent('generateTags', { input: { requirements: 'girl', tools: [] } })).error.code, 'INVALID_INPUT');
  const invalid = createAgentRuntime({ subagents: { translation: { inputSchema: { type: 'object' }, outputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } }, run: async () => ({ text: 9 }) } } });
  assert.equal((await invalid.runSubAgent('translation', { input: {} })).error.code, 'OUTPUT_INVALID');
});

test('records remain bounded and duplicate caller IDs do not cancel existing requests', async () => {
  const manager = createRequestManager({ maxRecords: 2 }); const status = createStatusManager({ maxRecords: 2 });
  const first = manager.begin('same'); const second = manager.begin('same'); assert.notEqual(first.requestId, second.requestId); assert.equal(first.signal.aborted, false); manager.complete(first.requestId); manager.complete(second.requestId);
  for (let index = 0; index < 6; index++) { const handle = manager.begin(); manager.complete(handle.requestId); status.complete(handle.requestId); }
  assert.equal(manager.size(), 2); assert.equal(status.list().length, 2); manager.clear();
});
