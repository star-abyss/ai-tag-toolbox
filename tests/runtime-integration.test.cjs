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
const { createCallMonitor } = require('../src/modules/call-monitor');
const { createAiClient } = require('../src/modules/ai-client');
const { createUsageLimiter } = require('../src/modules/usage-limiter');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const baseSettings = { generateNegativeTags: false, comfy: { enabled: true, base: 'http://example.test:8188', workflow: {}, width: 640, height: 768, steps: 0, cfg: 0, seed: 0, sampler: 'euler', scheduler: 'normal', batchCount: 2, negativeTags: ['lowres'] }, limits: { maxComfyCalls: 2, maxToolRounds: 6, maxToolCalls: 16, primaryTimeoutMs: 1000 } };
function stack(options = {}) {
  let tools;
  const getSettings = options.getSettings || (() => baseSettings);
  const runtime = createAgentRuntime({ primaryClient: options.primaryClient, subagents: options.subagents || createFixedSubagents({ ...options, getSettings }), tools: () => tools, getSettings, getPrimaryPrompt: options.getPrimaryPrompt || (() => 'FIXED PRIMARY') });
  tools = createPrimaryTools({ ...options, runtime, getSettings: options.getSettings || (() => baseSettings) });
  return { runtime, tools };
}

test('primary yields character selection immediately without another model call or rewriting the job ID', async () => {
  let modelCalls = 0;
  const paused = { jobId: 'job_29813f0a-a73a-47a8-8b3d-2d95cece9a4a', status: 'needs_input', needsInput: { kind: 'character', query: 'Alice', message: '请选择角色', options: [{ id: 'alice-a', name: 'Alice A', series: 'Story' }] } };
  const { runtime } = stack({ generation: { execute: async () => paused }, primaryClient: { complete: async () => {
    modelCalls += 1;
    if (modelCalls > 1) throw new Error('主 AI 不应继续猜测角色或重写任务编号');
    return { toolCalls: [{ id: 'choose-role', name: 'generation_execute', arguments: { requirements: '画 Alice', characterQueries: ['Alice'] } }] };
  } } });
  const result = await runtime.runPrimary({ requestId: 'role-pause', input: { text: '画 Alice' } });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(modelCalls, 1);
  assert.equal(result.data.jobId, paused.jobId);
  assert.equal(result.data.needsInput.options[0].id, 'alice-a');
  assert.equal(result.data.transcript.at(-1).role, 'tool');
  assert.equal(JSON.parse(result.data.transcript.find(row => row.role === 'tool').content).jobId, paused.jobId);
});

test('native tools run a real translation child without cancelling the primary and keep the native call id', async () => {
  const translation = createTranslation({ dictionary: { 'zh-en': { '蓝发': 'blue hair' } } });
  const requests = []; let count = 0;
  const { runtime, tools } = stack({ translation, primaryClient: { complete: async (messages, config) => {
    requests.push(structuredClone(messages));
    assert.equal(config.tools.length, 8);
    assert(config.tools.every(item => /^[A-Za-z0-9_-]+$/.test(item.function.name)));
    assert(config.tools.some(item => item.function.name === 'characters_search'));
    assert(config.tools.some(item => item.function.name === 'generation_execute'));
    assert(!config.tools.some(item => ['agent_generateTags', 'comfy_validateWorkflow', 'comfy_render'].includes(item.function.name)));
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
  assert.equal(enabled.data.negativeTags, undefined);
  baseSettings.generateNegativeTags = false;
  prompt = 'SECOND'; const second = await runtime.runSubAgent('generateTags', { input, sessionId: 's1' }); assert.equal(second.ok, true);
  assert.match(messagesSeen[2][0].content, /^SECOND\n/); assert.match(messagesSeen[2][0].content, /系统输出协议/); assert.equal(messagesSeen[2].length, 2);
  assert.equal(messagesSeen[2][1].content[1].image_url.url, 'data:image/png;base64,AQ=='); assert.equal(resolved[0].sessionId, 's1');
});

test('generateTags compile returns full Tags and revise returns a bounded patch', async () => {
  const messagesSeen = [];
  const replies = [
    '{"positiveTags":["1girl","blue hair"],"negativeTags":["lowres"]}',
    '{"add":["from side"],"remove":["front view"],"preserve":["blue hair"],"negativeAdd":["bad anatomy"],"negativeRemove":[]}'
  ];
  const { runtime } = stack({
    getSettings: () => ({ ...baseSettings, generateNegativeTags: true }),
    visionAI: { complete: async messages => { messagesSeen.push(messages); return { text: replies.shift() }; } }
  });
  const compiled = await runtime.runSubAgent('generateTags', { input: { operation: 'compile', requirements: 'blue-haired girl' } });
  assert.deepEqual(compiled.data.positiveTags, ['1girl', 'blue hair']);
  assert.deepEqual(compiled.data.negativeTags, ['lowres']);
  const revised = await runtime.runSubAgent('generateTags', { input: {
    operation: 'revise', requirements: 'blue-haired girl', positiveTags: compiled.data.positiveTags,
    negativeTags: compiled.data.negativeTags, evaluation: { score: 70, suggestedChanges: ['侧身'] }
  } });
  assert.deepEqual(revised.data, { add: ['from side'], remove: ['front view'], preserve: ['blue hair'], negativeAdd: ['bad anatomy'], negativeRemove: [] });
  assert.match(messagesSeen[1][0].content, /add.*remove.*preserve/s);
  assert.match(messagesSeen[1][1].content[0].text, /上一版正向 Tag.*blue hair/s);
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

test('call monitor records primary, tool and subagent IO with sensitive payloads redacted', async () => {
  let count = 0;
  const translation = createTranslation({ dictionary: { 'zh-en': { '你好': 'hello' } } });
  const { runtime } = stack({
    translation,
    getSettings: () => ({ ...baseSettings, primaryApi: { base: 'https://example.test/v1', model: 'test-model', key: 'secret-key' } }),
    primaryClient: { complete: async () => count++ === 0
      ? { toolCalls: [{ id: 'monitor-call', name: 'translation_translate', arguments: { text: '你好', direction: 'zh-en', source: 'local' } }] }
      : { text: 'done', usage: { total_tokens: 5 } } }
  });
  const result = await runtime.runPrimary({ requestId: 'monitor-parent', input: { text: 'translate' }, config: { key: 'request-secret' } });
  assert.equal(result.ok, true);
  const records = runtime.listCallRecords();
  assert(records.some(row => row.kind === 'primary' && row.input.messages.some(message => message.content === 'translate')));
  assert(records.some(row => row.kind === 'tool:translation.translate' && row.input.args.text === '你好' && row.output.text === 'hello'));
  assert(records.some(row => row.kind === 'subagent:translation' && row.input.text === '你好' && row.output.text === 'hello'));
  const json = JSON.stringify(records);
  assert.doesNotMatch(json, /secret-key|request-secret|data:image|base64,AQ==/);
  assert.match(json, /\[REDACTED\]/);
  runtime.clearCallRecords();
  assert.deepEqual(runtime.listCallRecords(), []);
});

test('generateTags monitor record includes the actual prompt and raw provider output', async () => {
  const app = require('../src/modules/assistant').createAssistant({
    promptSource: { composeGenerate: () => 'GENERATOR SYSTEM PROMPT', get: () => '' },
    visionGateway: { complete: async () => ({ ok: true, text: '{"positiveTags":["blue hair"]}', raw: { provider: 'raw-response' } }) }
  });
  const result = await app.runtime.runSubAgent('generateTags', { input: { requirements: 'blue-haired character' } });
  assert.equal(result.ok, true);
  const record = app.listCallRecords().find(row => row.kind === 'subagent:generateTags');
  assert.match(record.exchanges[0].request.body.messages[0].content, /GENERATOR SYSTEM PROMPT/);
  assert.equal(record.exchanges[0].request.body.messages[1].content[0].text, '当前要求：blue-haired character');
  assert.equal(record.exchanges[0].response.raw.provider, 'raw-response');
  assert.deepEqual(record.output.positiveTags, ['blue hair']);
  app.destroy();
});

test('evaluateImages shares the Vision client and monitor redacts all image payloads', async () => {
  const monitor = createCallMonitor();
  let providerMessages;
  const visionClient = createAiClient({ model: 'vision-fixture' }, { complete: async messages => {
    providerMessages = messages;
    return { text: JSON.stringify({
      operation: 'compare',
      recommendedCandidateId: 'candidate-2',
      ranking: [
        { candidateId: 'candidate-2', score: 93, reason: '更符合要求' },
        { candidateId: 'candidate-1', score: 81, reason: '构图稍弱' }
      ],
      reason: '候选 2 更准确',
      confidence: 0.91
    }) };
  } }, monitor);
  const subagents = createFixedSubagents({
    prompts: { composeEvaluation: () => 'EVALUATION SYSTEM' },
    visionAI: visionClient,
    resolveImage: async id => ({ thumbnailDataUrl: `data:image/png;base64,${Buffer.from(id).toString('base64')}` })
  });
  assert.deepEqual(subagents.names(), ['vision', 'translation', 'generateTags', 'evaluateImages']);
  const runtime = createAgentRuntime({ subagents, monitor });
  const result = await runtime.runSubAgent('evaluateImages', {
    requestId: 'evaluation-runtime',
    sessionId: 'session-1',
    input: { operation: 'compare', mode: 'create', brief: { requirements: '蓝发女孩' }, candidateImageIds: ['candidate-1', 'candidate-2'] }
  });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.data.recommendedCandidateId, 'candidate-2');
  assert.equal(providerMessages[1].content.filter(part => part.type === 'image_url').length, 2);
  const record = monitor.list().find(row => row.kind === 'subagent:evaluateImages');
  assert.equal(record.input.candidateImageIds[0], 'candidate-1');
  assert.equal(record.exchanges[0].request.body.messages[1].content[2].image_url, '[REDACTED]');
  assert.doesNotMatch(JSON.stringify(monitor.list()), /data:image|base64/);
});

test('primary uses one high-level generation tool and rejects hidden low-level calls', async () => {
  let round = 0;
  const generationCalls = [];
  const primaryMessages = [];
  const fullGeneration = { status: 'completed', jobId: 'job-1', selectedCandidateId: 'candidate-2', selectedImageId: 'img-2', positiveTags: ['1girl'], negativeTags: [], candidates: [{ id: 'candidate-2', imageId: 'img-2', prompt: '1girl', evaluation: { summary: 'full local review' } }], artifacts: [{ imageId: 'img-2' }], imageIds: ['img-2'] };
  const compactGeneration = { status: 'completed', jobId: 'job-1', outcome: 'accepted', recreationMode: '', selected: { candidateId: 'candidate-2', imageId: 'img-2', prompt: '1girl', negative: '', positiveTags: ['1girl'], negativeTags: [], parameters: {} }, candidates: [{ candidateId: 'candidate-2', imageId: 'img-2', score: 94, verdict: 'accept', hardErrorCount: 0, summary: 'ok' }], residualIssues: [], nextAction: '' };
  const { runtime, tools } = stack({
    generation: {
      execute: async (input, context) => { generationCalls.push({ input, requestId: context.requestId }); return fullGeneration; },
      resume: async () => fullGeneration,
      publicResult: () => compactGeneration,
      uiSnapshot: () => fullGeneration
    },
    primaryClient: { complete: async (messages, config) => {
      primaryMessages.push(structuredClone(messages));
      const names = config.tools.map(item => item.function.name);
      assert(names.includes('generation_execute'));
      assert(names.includes('generation_resume'));
      assert(!names.includes('comfy_render'));
      if (round++ === 0) return { toolCalls: [{ id: 'generate-once', name: 'generation_execute', arguments: { requirements: '蓝发女孩', mode: 'create' } }] };
      return { text: '已选择候选 2，提示词为 1girl' };
    } }
  });
  assert(tools.names().includes('comfy.render'), 'internal tool must remain registered');
  const result = await runtime.runPrimary({ requestId: 'high-level-root', input: { text: '画蓝发女孩' } });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(generationCalls.length, 1);
  assert.equal(result.data.selected.imageId, 'img-2');
  const publicToolPayload = JSON.parse(primaryMessages[1].find(message => message.role === 'tool').content);
  assert.deepEqual(publicToolPayload, compactGeneration);
  assert.equal(publicToolPayload.artifacts, undefined);
  assert.equal(result.usage.toolCalls, 1);

  const hidden = stack({ primaryClient: { complete: async () => ({ toolCalls: [{ id: 'hidden', name: 'comfy_render', arguments: { positiveTags: ['1girl'] } }] }) } });
  const rejected = await hidden.runtime.runPrimary({ requestId: 'hidden-root', input: { text: '绕过高层工具' } });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'TOOL_UNAVAILABLE');
});

test('failed evaluation provider responses still count toward root usage', async () => {
  const subagents = createFixedSubagents({
    visionAI: { complete: async () => ({ ok: false, code: 'VISION_FAILED', error: 'provider rejected request', usage: { total_tokens: 12 } }) },
    resolveImage: async id => ({ id, dataUrl: 'data:image/png;base64,AA==' })
  });
  const runtime = createAgentRuntime({ subagents });
  const result = await runtime.runSubAgent('evaluateImages', { input: { operation: 'review', mode: 'create', brief: {}, candidateImageIds: ['img-1'] } });
  assert.equal(result.ok, false);
  assert.equal(result.usage.total_tokens, 12);
  assert.deepEqual(result.usage.byKind, { evaluateImages: 12 });
});

test('request deadline extension and successful-only Comfy accounting are deterministic', async () => {
  const manager = createRequestManager({ timeoutMs: 15 });
  const handle = manager.begin('extended', { timeoutMs: 15 });
  assert.equal(manager.extend('extended', 100).timeoutMs >= 100, true);
  await wait(30);
  assert.equal(manager.get('extended').status, 'running');
  manager.complete('extended');
  assert.equal(handle.signal.aborted, false);

  const limiter = createUsageLimiter();
  limiter.begin('root', { maxComfyCalls: 1, maxToolCalls: 3 });
  limiter.check('root', 'comfy');
  limiter.check('root', 'comfy');
  assert.equal(limiter.snapshot('root').comfyCalls, 0);
  limiter.complete('root', 'comfy');
  assert.equal(limiter.snapshot('root').comfyCalls, 1);
  assert.throws(() => limiter.check('root', 'comfy'), error => error.code === 'COMFY_CALL_LIMIT');
});

test('runtime leaves comfyCalls unchanged when the internal render fails', async () => {
  let attempt = 0;
  let tools;
  const settings = { ...baseSettings, limits: { ...baseSettings.limits, maxComfyCalls: 1 } };
  const runtime = createAgentRuntime({ tools: () => tools, getSettings: () => settings });
  const stored = new Map();
  tools = createPrimaryTools({
    getSettings: () => settings,
    images: { get: id => stored.get(id) || null, add: value => { const item = { ...value, id: value.id || 'render-ok' }; stored.set(item.id, item); return item; } },
    imageRepository: { attachToConversation: (_sessionId, imageId) => ({ refId: `ref-${imageId}`, imageId }) },
    comfy: { render: async () => { attempt += 1; if (attempt === 1) throw Object.assign(new Error('first submission failed'), { code: 'COMFY_FAILED' }); return { artifact: { id: 'render-ok', dataUrl: 'data:image/png;base64,AA==' } }; } }
  });
  const failed = await runtime.callTool('comfy.render', { positiveTags: ['1girl'] }, { requestId: 'failed-render', sessionId: 's1' });
  assert.equal(failed.ok, false);
  assert.equal(failed.usage.comfyCalls, 0);
  const succeeded = await runtime.callTool('comfy.render', { positiveTags: ['1girl'] }, { requestId: 'successful-render', sessionId: 's1' });
  assert.equal(succeeded.ok, true, JSON.stringify(succeeded.error));
  assert.equal(succeeded.usage.comfyCalls, 1);
});

test('primary Vision tool returns a compact result without metadata', async () => {
  let tools;
  const runtime = createAgentRuntime({ tools: () => tools });
  tools = createPrimaryTools({ runtime: { runSubAgent: async () => ({ ok: true, data: { imageId: 'img-1', mode: 'ai', model: 'vision', text: '{"tags":["church"],"description":"church scene"}', metadata: { workflow: { huge: 'x'.repeat(20000) } }, builtinTags: [{ tag: '1girl' }] } }) } });
  const result = await tools.call('vision.processOne', { imageId: 'img-1', mode: 'ai' }, { sessionId: 's1' });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.data.description, 'church scene');
  assert.equal(result.data.metadata, undefined);
  assert.equal(result.data.workflow, undefined);
  assert(Buffer.byteLength(JSON.stringify(result.data)) < 1000);
});

test('generation resume schema accepts manual feedback and a base candidate', async () => {
  const calls = [];
  const tools = createPrimaryTools({ generation: { resume: async input => { calls.push(input); return { status: 'awaiting_feedback', jobId: input.jobId }; } } });
  const result = await tools.call('generation.resume', { jobId: 'job-1', action: 'continue', baseCandidateId: 'candidate-2', feedback: '加强低视角' });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(calls[0].feedback, '加强低视角');
});
