'use strict';

const assert = require('node:assert/strict');
const modules = require('../src/modules');

function setup(gateway, prefix = `assistant-flow-${Date.now()}`) {
  const storage = modules.createStorage({ prefix });
  const images = modules.createImages({ storage });
  return { storage, images, assistant: modules.createAssistant({ storage, images, primaryApi: { base: 'https://example.test/v1', model: 'test-model' }, primaryGateway: gateway }) };
}

async function testConversationTranscriptAndImageScope() {
  const seen = [];
  let turn = 0;
  const { images, assistant } = setup({
    complete: async (messages) => {
      seen.push(messages);
      turn += 1;
      if (turn === 1) return { ok: true, toolCalls: [{ id: 'call-native-1', function: { name: 'conversation.listImages', arguments: '{}' } }] };
      return { ok: true, text: 'stream finished' };
    }
  });
  const image = images.add({ dataUrl: 'data:image/png;base64,AA==', filename: 'attached.png', mime: 'image/png' });
  const result = await assistant.run({ text: 'inspect', imageIds: [image.id], onDelta: () => {} });
  assert.equal(result.ok, true);
  assert.equal(result.text, 'stream finished');
  const messages = assistant.currentSession().messages;
  assert.equal(messages.length, 2);
  assert.equal(messages[0].imageIds[0], image.id);
  assert.equal(messages[1].status, 'done');
  assert.equal(messages[1].transcript.some(item => item.role === 'tool' && item.tool_call_id === 'call-native-1'), true);
  assert.equal(messages[1].transcript.some(item => item.role === 'assistant' && item.tool_calls?.[0]?.id === 'call-native-1'), true);
  assert.equal(seen[1].some(item => item.role === 'tool' && item.tool_call_id === 'call-native-1'), true);
  assert.match(seen[0].find(item => item.role === 'user').content, new RegExp(image.id));
}

async function testCancellationAndBusyGuard() {
  let resolve;
  const { assistant } = setup({ complete: () => new Promise(done => { resolve = done; }) });
  const pending = assistant.run({ text: 'cancel me', requestId: 'cancel-me' });
  await new Promise(done => setTimeout(done, 5));
  const busy = await assistant.run({ text: 'busy' });
  assert.equal(busy.error.code, 'BUSY');
  assert.equal(assistant.cancel('cancel-me'), true);
  resolve({ ok: true, text: 'late' });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CANCELLED');
  assert.equal(assistant.currentSession().messages.at(-1).status, 'cancelled');
}

async function testSettingsCanonicalAndIndependentVision() {
  const { assistant, storage } = setup({ complete: async () => ({ ok: true, text: 'ok' }) }, `settings-flow-${Date.now()}`);
  const form = assistant.setSettings({ key: '', temperature: 0, comfyCfg: 0, comfySeed: '', batchCount: 4, maxComfyCalls: 0, generationStrategy: 'fixed3', generationAutoSelect: false, visionInheritPrimary: false, visionBase: 'https://vision.test/v1', visionModel: 'vision-model', visionKey: '' });
  assert.equal(form.key, '');
  assert.equal(form.temperature, 0);
  assert.equal(form.comfyCfg, 0);
  assert.equal(form.comfySeed, null);
  assert.equal(form.batchCount, 4);
  assert.equal(form.maxComfyCalls, 0);
  assert.equal(form.generationStrategy, 'fixed3');
  assert.equal(form.generationAutoSelect, false);
  assert.equal(form.visionBase, 'https://vision.test/v1');
  const persisted = storage.get('settings');
  assert.deepEqual(Object.keys(persisted).sort(), ['comfy', 'generateNegativeTags', 'generation', 'limits', 'primaryApi', 'visionApi'].sort());
  assert.equal(persisted.primaryApi.temperature, 0);
  assert.equal(persisted.comfy.batchCount, 4);
  assert.equal(persisted.limits.maxComfyCalls, 0);
  assert.equal(persisted.generation.strategy, 'fixed3');
  assert.equal(persisted.generation.autoSelect, false);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'base'), false);
}

async function testSessionFormatAndImport() {
  const { assistant } = setup({ complete: async () => ({ ok: true, text: 'ok' }) }, `session-format-${Date.now()}`);
  await assistant.run({ text: 'hello' });
  const bundle = JSON.parse(assistant.exportSessions());
  assert.equal(bundle.format, 'ai-tag-sessions');
  assert.equal(bundle.version, 1);
  assert.equal(assistant.importSessions([{ id: 'legacy', messages: [] }]), false);
  const imported = assistant.importSessions(bundle);
  assert.equal(Array.isArray(imported), true);
}

async function testGenerationSettingsMigration() {
  const migrated = modules.normaliseSettings({ comfy: { enabled: false, batchCount: 4 }, generation: { strategy: 'quick' } });
  assert.equal(migrated.comfy.enabled, false);
  assert.equal(migrated.generation.autoRun, true);
  assert.equal(migrated.generation.imagesPerRound, 4);
  assert.equal(migrated.generation.maxAutoRounds, 1);
  const fresh = modules.normaliseSettings({});
  assert.equal(fresh.comfy.enabled, true);
  assert.equal(fresh.generation.autoRun, true);
  assert.equal(fresh.generation.imagesPerRound, 1);
  assert.equal(fresh.generation.maxAutoRounds, 3);
}

async function testHighLevelGenerationPersistsCandidatesAndSelection() {
  const storage = modules.createStorage({ prefix: `assistant-generation-${Date.now()}` });
  const images = modules.createImages({ storage });
  let primaryRound = 0;
  let renderCount = 0;
  let reviewCount = 0;
  const comfy = {
    setBase: () => {},
    status: async () => ({ connected: true, workflowReady: true, render: true, error: '' }),
    render: async input => {
      renderCount += 1;
      input.onSubmitted?.({ workflowHash: `hash-${renderCount}`, changedBindings: ['positive'], parameters: { seed: renderCount } });
      return { artifact: { id: `generated-${renderCount}`, dataUrl: `data:image/png;base64,${Buffer.from([renderCount]).toString('base64')}`, filename: `generated-${renderCount}.png`, mime: 'image/png' } };
    }
  };
  const assistant = modules.createAssistant({
    storage, images, comfy,
    settings: {
      comfy: { enabled: true, base: 'http://example.test:8188', workflow: { '1': { class_type: 'SaveImage', inputs: {} } }, batchCount: 1 },
      limits: { maxComfyCalls: 3, maxToolRounds: 4, maxToolCalls: 20, primaryTimeoutMs: 1000 },
      generation: { strategy: 'auto', autoSelect: true, maxSuccessfulRenders: 3, maxRenderAttempts: 5, acceptScore: 90, minImprovement: 3, jobTimeoutMs: 120000 }
    },
    primaryApi: { base: 'https://example.test/v1', model: 'primary-model' },
    primaryGateway: { complete: async (_messages, config) => {
      assert.equal(config.tools.length, 8);
      if (primaryRound++ === 0) return { toolCalls: [{ id: 'generate', name: 'generation_execute', arguments: { requirements: '蓝发女孩', mode: 'create', strategy: 'auto' } }] };
      return { text: '已完成并选择最佳候选。' };
    } },
    visionGateway: { complete: async messages => {
      const system = messages[0].content;
      const userText = Array.isArray(messages[1].content) ? messages[1].content[0]?.text || '' : '';
      if (/operation="compare"/.test(system)) {
        const ids = [...userText.matchAll(/generated-\d+/g)].map(match => match[0]);
        const unique = [...new Set(ids)];
        return { text: JSON.stringify({ operation: 'compare', recommendedCandidateId: unique[0], ranking: unique.map((candidateId, index) => ({ candidateId, score: 95 - index, reason: 'fixture' })), reason: '高分候选更符合要求', confidence: 0.9 }) };
      }
      if (/operation="review"/.test(system)) {
        const candidateId = userText.match(/generated-\d+/)?.[0];
        reviewCount += 1;
        const score = reviewCount === 1 ? 70 : 92;
        return { text: JSON.stringify({ operation: 'review', evaluations: [{ candidateId, score, verdict: score >= 90 ? 'accept' : 'revise', confidence: 0.9, dimensions: {}, hardErrors: [], issues: [], strengths: [], suggestedChanges: score >= 90 ? [] : ['improve'], summary: score >= 90 ? '符合要求' : '继续优化' }] }) };
      }
      if (/系统修订协议/.test(system)) return { text: '{"add":[],"remove":[],"preserve":[]}' };
      return { text: '{"positiveTags":["1girl","blue hair"]}' };
    } }
  });
  const result = await assistant.run({ text: '画一个蓝发女孩', requestId: 'assistant-generation-root' });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(renderCount, 2);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.selectedImageId, 'generated-2');
  assert.deepEqual(result.positiveTags, ['1girl', 'blue hair']);
  assert.equal(result.usage.toolRounds, 2);
  assert.equal(result.usage.comfyCalls, 2);
  const message = assistant.currentSession().messages.at(-1);
  assert.equal(message.result.candidates.length, 2);
  assert.equal(message.result.finalPrompt, undefined);
  const selected = assistant.chooseCandidate(message.id, 'candidate-1', 'user');
  assert.equal(selected.finalImageId, 'generated-1');
  assert.equal(selected.finalPrompt, '1girl, blue hair');
  assistant.destroy();
}

(async () => {
  await testConversationTranscriptAndImageScope();
  await testCancellationAndBusyGuard();
  await testSettingsCanonicalAndIndependentVision();
  await testGenerationSettingsMigration();
  await testSessionFormatAndImport();
  await testHighLevelGenerationPersistsCandidatesAndSelection();
  console.log('assistant-flow: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
