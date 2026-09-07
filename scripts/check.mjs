import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const modules = require(path.join(root, 'src', 'modules'));

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function ok(value, message) { assert.equal(Boolean(value), true, message); }

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(packageJson.version, '1.4.211', 'package version must be 1.4.211');
assert.match(fs.readFileSync(path.join(root, 'VERSION.txt'), 'utf8'), /V1\.4\.211/);
assert.match(fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8'), /V1\.4\.211/);

for (const name of ['createAgentRuntime', 'createRequestManager', 'createStatusManager', 'createCallMonitor', 'createFixedSubagents', 'createPrimaryTools']) {
  assert.equal(typeof modules[name], 'function', `${name} export missing`);
}

const settings = {
  primaryApi: { base: 'https://example.test/v1', model: 'check-model', key: '' },
  visionApi: { inheritPrimary: true },
  comfy: { enabled: true, workflow: '{}', width: 768, height: 1024, steps: 20, cfg: 6, batchCount: 2 },
  limits: { maxComfyCalls: 2, maxToolRounds: 4 }
};
const calls = [];
const tools = {
  list: () => [{ name: 'comfy.render' }, { name: 'tags.search' }],
  openAiTools: () => [{ type: 'function', function: { name: 'comfy.render' } }, { type: 'function', function: { name: 'tags.search' } }],
  resolve: name => ['comfy.render', 'tags.search'].includes(name) ? { name, handler: async args => ({ name, args }) } : null,
  call: async (name, args) => { calls.push({ name, args }); return { ok: true, data: { name, args } }; }
};
let primaryCount = 0;
const primaryClient = {
  async complete() {
    primaryCount += 1;
    if (primaryCount === 1) return { ok: true, toolCalls: [{ name: 'tags.search', arguments: { query: 'blue hair' } }] };
    return { ok: true, text: '完成', usage: { total_tokens: 3 } };
  }
};
const runtime = modules.createAgentRuntime({ primaryClient, tools, getSettings: () => settings });
const primary = await runtime.runPrimary({ input: { text: '查找蓝发' }, requestId: 'check-primary' });
ok(primary.ok && primary.data.text === '完成', 'primary runtime did not finish');
assert.equal(calls[0].name, 'tags.search');
assert.equal(runtime.getStatus('check-primary').status, 'completed');

const unknown = await runtime.callTool('files.read', {}, { requestId: 'check-unknown' });
assert.equal(unknown.ok, false);
assert.equal(unknown.error.code, 'TOOL_UNAVAILABLE');

const subagent = await runtime.runSubAgent('vision', { input: { imageId: 'img-1', mode: 'metadata' }, requestId: 'check-subagent' });
assert.equal(subagent.error?.code, 'SUBAGENT_UNAVAILABLE', 'missing registry should be explicit');

let neverResolve;
const timeoutRuntime = modules.createAgentRuntime({
  primaryClient: { complete: () => new Promise(resolve => { neverResolve = resolve; }) },
  tools,
  getSettings: () => ({ limits: { primaryTimeoutMs: 20 } })
});
const timed = await timeoutRuntime.runPrimary({ input: { text: 'timeout' }, requestId: 'check-timeout', timeoutMs: 20 });
assert.equal(timed.ok, false);
assert.equal(timed.error.code, 'TIMEOUT');
neverResolve?.({ ok: true, text: 'late' });

const cancelRuntime = modules.createAgentRuntime({
  primaryClient: { complete: () => new Promise(resolve => setTimeout(() => resolve({ ok: true, text: 'late' }), 100)) },
  tools,
  getSettings: () => ({ limits: { primaryTimeoutMs: 500 } })
});
const pending = cancelRuntime.runPrimary({ input: { text: 'cancel' }, requestId: 'check-cancel' });
await wait(5);
ok(cancelRuntime.cancel('check-cancel'), 'cancel should return true');
const cancelled = await pending;
assert.equal(cancelled.error.code, 'CANCELLED');

const visionCalls = [];
const subagents = modules.createFixedSubagents({
  vision: { processOne: async input => { visionCalls.push(input); return { ok: true, data: { text: 'blue hair', tags: ['blue hair'] } }; } },
  translation: { translate: async text => ({ ok: true, text: `translated:${text}`, direction: 'zh-en' }) },
  ai: { complete: async () => ({ ok: true, text: '{"positiveTags":["1girl"]}' }) },
  getSettings: () => settings
});
assert.deepEqual(subagents.names(), ['vision', 'translation', 'generateTags']);
const subRuntime = modules.createAgentRuntime({ primaryClient, subagents, tools, getSettings: () => settings });
const visionResult = await subRuntime.runSubAgent('vision', { input: { imageId: 'img-1', mode: 'metadata' }, requestId: 'check-vision' });
assert.equal(visionResult.ok, true);
assert.equal(visionResult.data.text, 'blue hair');
assert.equal(visionCalls[0].sessionId, undefined, 'subagent received session context');
const translationResult = await subRuntime.runSubAgent('translation', { input: { text: '蓝发', direction: 'zh-en' }, requestId: 'check-translation' });
assert.equal(translationResult.ok, true);
const tagsResult = await subRuntime.runSubAgent('generateTags', { input: { requirements: 'girl' }, requestId: 'check-tags' });
assert.deepEqual(tagsResult.data.positiveTags, ['1girl']);
ok(!Object.prototype.hasOwnProperty.call(tagsResult.data, 'negativeTags'), 'negative tags must be opt-in');

const comfyCalls = [];
const primaryTools = modules.createPrimaryTools({
  tags: { search: query => [{ en: query }] },
  imageRepository: { listConversation: () => ({ items: [] }), attachToConversation: async (_sessionId, imageId) => ({ refId: `ref-${imageId}`, imageId }) },
  images: { get: () => null, add: async value => ({ id: value.id || 'render-1', ...value }) },
  runtime: subRuntime,
  comfy: {
    status: async args => ({ connected: true, args }),
    workflowStatus: workflow => ({ ready: Boolean(workflow) }),
    render: async args => { comfyCalls.push(args); return { artifact: { id: 'render-1' } }; }
  },
  getSettings: () => settings
});
assert.deepEqual(primaryTools.names(), [
  'tags.search', 'characters.search', 'conversation.listImages', 'vision.processOne', 'translation.translate',
  'agent.generateTags', 'comfy.status', 'comfy.validateWorkflow', 'comfy.render'
]);
assert.equal(primaryTools.resolve('files.read'), null);
const render = await primaryTools.call('comfy.render', { positiveTags: ['1girl'], negativeTags: ['lowres'] }, { sessionId: 's1' });
assert.equal(render.ok, true);
assert.equal(comfyCalls[0].prompt, '1girl');
assert.equal(comfyCalls[0].batchCount, 2);
assert.equal(comfyCalls[0].maxComfyCalls, undefined);
assert.equal((await primaryTools.call('comfy.render', { prompt: 'raw workflow' })).ok, false, 'render must require positiveTags');

const appView = fs.readFileSync(path.join(root, 'src', 'app-view.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const assistantSource = fs.readFileSync(path.join(root, 'src', 'modules', 'assistant.js'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(root, 'src', 'modules', 'agent-runtime.js'), 'utf8');
const limiterSource = fs.readFileSync(path.join(root, 'src', 'modules', 'usage-limiter.js'), 'utf8');
assert.doesNotMatch(html, /data-mode="draw"/);
assert.doesNotMatch(appView, /input\.mode\s*=|input\.task\s*=/);
assert.match(assistantSource, /run:\s*runPrimaryWithRuntime/);
assert.doesNotMatch(assistantSource, /createAiRunner|runner\.run/);
assert.match(limiterSource, /COMFY_CALL_LIMIT/);
assert.doesNotMatch(fs.readFileSync(path.join(root, 'preload.js'), 'utf8'), /createCallServer|migrateLegacyData|agentWriteEnabled/);
assert.doesNotMatch(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), /migrateLegacyUserData|config-migration/);

console.log('check ok: unified runtime, 3 fixed subagents, 9 primary tools, local characters, timeout/cancel, Comfy parameter boundary');


