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
  const form = assistant.setSettings({ key: '', temperature: 0, comfyCfg: 0, comfySeed: '', batchCount: 10, maxComfyCalls: 10, generationStrategy: 'fixed3', generationAutoSelect: false, visionInheritPrimary: false, visionBase: 'https://vision.test/v1', visionModel: 'vision-model', visionKey: '' });
  assert.equal(form.key, '');
  assert.equal(form.temperature, 0);
  assert.equal(form.comfyCfg, 0);
  assert.equal(form.comfySeed, null);
  assert.equal(form.batchCount, 10);
  assert.equal(form.imagesPerRound, 10);
  assert.equal(form.maxComfyCalls, 10);
  assert.equal(form.maxAutoRounds, 10);
  assert.equal(form.generationStrategy, 'fixed3');
  assert.equal(form.generationAutoSelect, false);
  assert.equal(form.visionBase, 'https://vision.test/v1');
  const persisted = storage.get('settings');
  assert.deepEqual(Object.keys(persisted).sort(), ['comfy', 'generateNegativeTags', 'generation', 'limits', 'primaryApi', 'visionApi'].sort());
  assert.equal(persisted.primaryApi.temperature, 0);
  assert.equal(persisted.comfy.batchCount, 10);
  assert.equal(persisted.generation.imagesPerRound, 10);
  assert.equal(persisted.limits.maxComfyCalls, 10);
  assert.equal(persisted.generation.maxAutoRounds, 10);
  assert.equal(persisted.generation.strategy, 'fixed3');
  assert.equal(persisted.generation.autoSelect, false);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'base'), false);
  const fromConversation = assistant.setSettings({ imagesPerRound: 7, maxAutoRounds: 6 });
  assert.equal(fromConversation.batchCount, 7);
  assert.equal(fromConversation.imagesPerRound, 7);
  assert.equal(fromConversation.maxComfyCalls, 6);
  assert.equal(fromConversation.maxAutoRounds, 6);
  const clamped = assistant.setSettings({ batchCount: 99, maxComfyCalls: 99 });
  assert.equal(clamped.batchCount, 10);
  assert.equal(clamped.imagesPerRound, 10);
  assert.equal(clamped.maxComfyCalls, 10);
  assert.equal(clamped.maxAutoRounds, 10);
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
  assert.equal(renderCount, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.selectedImageId, 'generated-1');
  assert.equal(result.stopReason, 'prompt_unchanged');
  assert.deepEqual(result.positiveTags, ['1girl', 'blue hair']);
  assert.equal(result.usage.toolRounds, 2);
  assert.equal(result.usage.comfyCalls, 1);
  const message = assistant.currentSession().messages.at(-1);
  assert.equal(message.result.candidates.length, 1);
  assert.equal(message.result.finalPrompt, undefined);
  const selected = assistant.chooseCandidate(message.id, 'candidate-1', 'user');
  assert.equal(selected.finalImageId, 'generated-1');
  assert.equal(selected.finalPrompt, '1girl, blue hair');
  const finalized = await assistant.selectGenerationFinal(message.id, 'candidate-1');
  assert.equal(finalized.finalCandidateId, 'candidate-1');
  assert.equal(finalized.finalImageId, 'generated-1');
  assistant.destroy();
}

async function testManualContinuationBypassesPrimaryAndReleasesConversation() {
  const calls = [];
  const candidate = { id: 'candidate-1', imageId: 'img-1', prompt: '1girl', negative: '', evaluation: { status: 'reviewed', score: 70 } };
  const generation = {
    resume: async input => { calls.push(input); return { status: 'awaiting_feedback', jobId: 'job-manual', candidates: [candidate], rounds: [{ roundId: 'round-2', candidateIds: ['candidate-1'], recommendedCandidateId: 'candidate-1' }], artifacts: [], imageIds: [], successfulRounds: 2 }; },
    get: () => null,
    selectAndFinish: async () => null
  };
  const assistant = modules.createAssistant({ storage: modules.createStorage({ prefix: `manual-continue-${Date.now()}` }), generation, primaryGateway: { complete: async () => ({ text: 'primary should not run' }) } });
  assistant.importSessions({ format: 'ai-tag-sessions', version: 1, currentId: 's1', sessions: [{ id: 's1', title: 'manual', messages: [{ id: 'a1', role: 'assistant', text: '', status: 'done', result: { status: 'awaiting_feedback', jobId: 'job-manual', candidates: [candidate] } }] }] }, true);
  const result = await assistant.continueGeneration('a1', 'candidate-1', '增强低视角');
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(calls[0], { jobId: 'job-manual', action: 'continue', baseCandidateId: 'candidate-1', feedback: '增强低视角' });
  const messages = assistant.currentSession().messages;
  assert.equal(messages.at(-2).role, 'user');
  assert.equal(messages.at(-2).text, '增强低视角');
  assert.equal(messages.at(-1).result.status, 'awaiting_feedback');
  const normal = await assistant.run({ text: '现在可以继续对话' });
  assert.equal(normal.ok, true);
  assistant.destroy();
}

async function testCharacterChoiceResumesStoredJobWithoutPrimary() {
  let primaryCalls = 0;
  let release;
  const calls = [];
  const paused = { status: 'needs_input', jobId: 'job_29813f0a-a73a-47a8-8b3d-2d95cece9a4a', needsInput: { kind: 'character', query: '天子', options: [{ id: 'hinanawi_tenshi', name: '比那名居天子', series: 'touhou' }] }, candidates: [] };
  let current = structuredClone(paused);
  const generation = {
    get: () => structuredClone(current),
    resume: async input => {
      calls.push(input);
      await new Promise(resolve => { release = resolve; });
      current = { ...paused, status: 'awaiting_feedback', needsInput: null, successfulRounds: 1 };
      return current;
    }
  };
  const assistant = modules.createAssistant({ storage: modules.createStorage({ prefix: `character-choice-${Date.now()}` }), generation, primaryGateway: { complete: async () => { primaryCalls++; return { text: 'ok' }; } } });
  assistant.importSessions({ format: 'ai-tag-sessions', version: 1, sessions: [{ id: 's1', messages: [{ id: 'a1', role: 'assistant', text: '请确认角色', status: 'done', result: paused }] }] }, true);
  assert.equal(typeof assistant.selectGenerationCharacter, 'function');
  const pending = assistant.selectGenerationCharacter('a1', 'hinanawi_tenshi');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await assistant.selectGenerationCharacter('a1', 'hinanawi_tenshi')).error.code, 'BUSY');
  release();
  const result = await pending;
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(primaryCalls, 0);
  assert.deepEqual(calls, [{ jobId: 'job_29813f0a-a73a-47a8-8b3d-2d95cece9a4a', characterSelection: { query: '天子', characterId: 'hinanawi_tenshi' } }]);
  const messages = assistant.currentSession().messages;
  assert.match(messages.at(-2).text, /比那名居天子/);
  assert.equal(messages.at(-1).result.status, 'awaiting_feedback');
  assert.equal(messages[0].result.needsInput, null);
  const recorded = JSON.parse(messages.at(-1).transcript.find(item => item.role === 'tool').content);
  assert.equal(recorded.jobId, paused.jobId);
  assert.equal((await assistant.selectGenerationCharacter('a1', 'hinanawi_tenshi')).error.code, 'INPUT_EXPIRED');
  assert.equal(calls.length, 1);
  assert.equal(assistant.snapshot().busy, false);
  assistant.destroy();
}

async function testOriginalCharacterResumesStoredJobWithoutPrimary() {
  const calls = [];
  const paused = { status: 'needs_input', jobId: 'original-job', needsInput: { kind: 'character', query: '小星', options: [] }, candidates: [] };
  let current = structuredClone(paused);
  let primaryCalls = 0;
  const assistant = modules.createAssistant({
    storage: modules.createStorage(),
    generation: { get: () => structuredClone(current), resume: async input => { calls.push(input); current = { ...paused, status: 'awaiting_feedback', needsInput: null }; return current; } },
    primaryGateway: { complete: async () => { primaryCalls++; return { text: 'ok' }; } }
  });
  try {
    assistant.importSessions({ format: 'ai-tag-sessions', version: 1, sessions: [{ id: 's1', messages: [{ id: 'a1', role: 'assistant', text: '', status: 'done', result: paused }] }] }, true);
    const result = await assistant.selectGenerationCharacter('a1', '', { original: true });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.deepEqual(calls, [{ jobId: 'original-job', characterSelection: { query: '小星', original: true } }]);
    assert.equal(primaryCalls, 0);
    const messages = assistant.currentSession().messages;
    assert.match(messages.at(-2).text, /原创.*小星/);
    assert.equal(messages[0].result.needsInput, null);
    assert.deepEqual(messages[0].result.characterSelection, { query: '小星', original: true });
    assert.equal(messages.at(-1).result.status, 'awaiting_feedback');
    assert.equal((await assistant.selectGenerationCharacter('a1', '', { original: true })).error.code, 'INPUT_EXPIRED');
    assert.equal(calls.length, 1);
  } finally { assistant.destroy(); }
}

(async () => {
  await testConversationTranscriptAndImageScope();
  await testCancellationAndBusyGuard();
  await testSettingsCanonicalAndIndependentVision();
  await testGenerationSettingsMigration();
  await testSessionFormatAndImport();
  await testHighLevelGenerationPersistsCandidatesAndSelection();
  await testManualContinuationBypassesPrimaryAndReleasesConversation();
  await testCharacterChoiceResumesStoredJobWithoutPrimary();
  await testOriginalCharacterResumesStoredJobWithoutPrimary();
  console.log('assistant-flow: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
