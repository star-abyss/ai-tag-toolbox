'use strict';

const assert = require('node:assert/strict');
const modules = require('../src/modules');

async function testSettingsPatch() {
  const assistant = modules.createAssistant({
    storage: modules.createStorage({ prefix: 'regression-settings-v194' }),
    primaryApi: { base: 'https://example.test/v1', model: 'old-model' }
  });
  const settings = assistant.setSettings({ base: 'https://changed.test/v1', model: 'new-model', comfyW: 1024, batchCount: 4, maxComfyCalls: 7 });
  assert.equal(settings.base, 'https://changed.test/v1');
  assert.equal(settings.model, 'new-model');
  assert.equal(settings.comfyW, 1024);
  assert.equal(settings.batchCount, 4);
  assert.equal(settings.maxComfyCalls, 7);
}

async function testConversationReplyPersists() {
  const assistant = modules.createAssistant({
    storage: modules.createStorage({ prefix: 'regression-session-v194' }),
    primaryApi: { base: 'https://example.test/v1', model: 'audit-model' },
    primaryGateway: { complete: async () => ({ ok: true, text: 'persisted reply' }) }
  });
  const result = await assistant.run({ text: 'hello' });
  const messages = assistant.currentSession().messages;
  assert.equal(result.ok, true);
  assert.equal(messages.at(-1).text, 'persisted reply');
  assert.equal(messages.at(-1).status, 'done');
}

async function testSubagentDoesNotCancelParent() {
  let turns = 0;
  let runtime;
  let tools;
  const subagents = { translation: { timeoutMs: 100, run: async () => ({ text: 'hello' }) } };
  const primaryClient = {
    complete: async () => ++turns === 1
      ? { ok: true, toolCalls: [{ name: 'translation.translate', arguments: { text: '你好' } }] }
      : { ok: true, text: 'translated' }
  };
  tools = { resolve: name => tools.primary?.resolve?.(name), list: () => tools.primary?.list?.() || [], openAiTools: () => tools.primary?.openAiTools?.() || [], call: (...args) => tools.primary?.call?.(...args), primary: null };
  runtime = modules.createAgentRuntime({ primaryClient, subagents, tools, getSettings: () => ({ limits: { primaryTimeoutMs: 500, maxToolRounds: 3 } }) });
  tools = modules.createPrimaryTools({ runtime });
  const primaryTools = tools;
  tools = { resolve: name => primaryTools.resolve(name), list: () => primaryTools.list(), openAiTools: () => primaryTools.openAiTools(), call: (...args) => primaryTools.call(...args), primary: primaryTools };
  const result = await runtime.runPrimary({ requestId: 'parent-v194', input: { text: 'translate' } });
  assert.equal(result.ok, true);
  assert.equal(result.data.text, 'translated');
}

async function testBatchCountReachesWorkflow() {
  const workflow = {
    '3': { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], seed: 1, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1 } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'audit.safetensors' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 1024, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'old positive', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative', clip: ['4', 1] } }
  };
  const result = modules.applyWorkflowOverrides(workflow, { prompt: '1girl', batchCount: 4 });
  assert.equal(result.workflow['5'].inputs.batch_size, 4);
}

(async () => {
  await testSettingsPatch();
  await testConversationReplyPersists();
  await testSubagentDoesNotCancelParent();
  await testBatchCountReachesWorkflow();
  console.log('regressions-v194: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
