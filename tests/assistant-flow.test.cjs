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
  const form = assistant.setSettings({ key: '', temperature: 0, comfyCfg: 0, comfySeed: '', batchCount: 4, maxComfyCalls: 0, visionInheritPrimary: false, visionBase: 'https://vision.test/v1', visionModel: 'vision-model', visionKey: '' });
  assert.equal(form.key, '');
  assert.equal(form.temperature, 0);
  assert.equal(form.comfyCfg, 0);
  assert.equal(form.comfySeed, null);
  assert.equal(form.batchCount, 4);
  assert.equal(form.maxComfyCalls, 0);
  assert.equal(form.visionBase, 'https://vision.test/v1');
  const persisted = storage.get('settings');
  assert.deepEqual(Object.keys(persisted).sort(), ['comfy', 'generateNegativeTags', 'limits', 'primaryApi', 'visionApi'].sort());
  assert.equal(persisted.primaryApi.temperature, 0);
  assert.equal(persisted.comfy.batchCount, 4);
  assert.equal(persisted.limits.maxComfyCalls, 0);
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

(async () => {
  await testConversationTranscriptAndImageScope();
  await testCancellationAndBusyGuard();
  await testSettingsCanonicalAndIndependentVision();
  await testSessionFormatAndImport();
  console.log('assistant-flow: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
