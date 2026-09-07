'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createComfy } = require('../src/modules/comfy');

test('ComfyUI diagnostics cache object info and expose version and queue counts', async () => {
  let calls = 0;
  const fetch = async (url) => {
    calls += 1;
    if (url.endsWith('/object_info')) return { ok: true, json: async () => ({ KSampler: { output_node: false } }) };
    if (url.endsWith('/system_stats')) return { ok: true, json: async () => ({ system: { comfyui_version: '0.34.0' }, devices: [{ name: 'RTX test' }] }) };
    if (url.endsWith('/queue')) return { ok: true, json: async () => ({ queue_running: [{ prompt_id: 'r' }], queue_pending: [{ prompt_id: 'p' }, { prompt_id: 'p2' }] }) };
    return { ok: true, json: async () => ({}) };
  };
  const comfy = createComfy({ base: 'http://test', fetch });
  const first = await comfy.objectInfo(); const second = await comfy.objectInfo();
  assert.deepEqual(first.classes, ['KSampler']);
  assert.deepEqual(second.classes, ['KSampler']);
  assert.equal(calls, 1);
  const status = await comfy.status({ enabled: true, workflow: { '1': { class_type: 'KSampler', inputs: {} } } });
  assert.equal(status.version, '0.34.0');
  assert.deepEqual(status.queue, { running: 1, pending: 2 });
});
