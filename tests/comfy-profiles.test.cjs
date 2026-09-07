'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createComfyProfiles } = require('../src/modules/comfy-profiles');

const workflow = { '42': { class_type: 'KSamplerAdvanced', inputs: { positive: ['6', 0], negative: ['7', 0] } } };

test('legacy workflow migrates into one profile with prompt-only defaults', () => {
  const profiles = createComfyProfiles({ initial: { comfy: { workflow } } });
  const current = profiles.active();
  assert.equal(profiles.list().length, 1);
  assert.equal(current.name, '默认工作流');
  assert.deepEqual(current.workflow, workflow);
  assert.equal(current.overrides.positive, true);
  assert.equal(current.overrides.negative, true);
  assert.equal(current.overrides.width, false);
  assert.equal(current.overrides.steps, false);
  assert.deepEqual(current.capabilities, { txt2img: true, img2img: false, controlImage: false, mask: false });
  assert.equal(current.bindings.sourceImage, null);
  assert.equal(current.bindings.denoise, null);
  assert.equal(current.bindings.controlStrength, null);
});

test('profiles save, activate and delete deterministically', () => {
  const profiles = createComfyProfiles({ initial: { comfy: { workflow } } });
  const saved = profiles.save({ id: 'upscale', name: '高清放大', workflow: { '1': { class_type: 'SaveImage', inputs: {} } } });
  assert.equal(saved.id, 'upscale');
  assert.equal(profiles.setActive('upscale').id, 'upscale');
  assert.equal(profiles.remove('upscale'), true);
  assert.equal(profiles.active().id, 'profile-default');
  assert.equal(profiles.remove('profile-default'), false);
});

test('persisted profiles win over legacy workflow and invalid entries are ignored', () => {
  const storage = new Map([['comfy_profiles', { version: 1, activeProfileId: 'saved', items: [{ id: 'saved', name: '已保存', workflow, overrides: { positive: true, negative: false } }, null] }]]);
  const profiles = createComfyProfiles({ storage: { get: (key, fallback) => storage.has(key) ? storage.get(key) : fallback, set: (key, value) => storage.set(key, value) }, initial: { comfy: { workflow: { stale: {} } } } });
  assert.equal(profiles.active().id, 'saved');
  assert.equal(profiles.active().overrides.negative, false);
  assert.equal(profiles.list().length, 1);
  assert.equal(profiles.snapshot().version, 2);
});

test('capabilities and reference bindings round-trip in profile v2', () => {
  const profiles = createComfyProfiles({ initial: { comfy: { workflow } } });
  const current = profiles.active();
  const saved = profiles.save({
    ...current,
    capabilities: { txt2img: true, img2img: true, controlImage: true, mask: false },
    bindings: {
      ...current.bindings,
      sourceImage: { nodeId: '12', input: 'image' },
      denoise: { nodeId: '42', input: 'denoise' },
      controlStrength: { nodeId: '13', input: 'strength' }
    }
  });
  assert.equal(saved.capabilities.img2img, true);
  assert.deepEqual(saved.bindings.sourceImage, { nodeId: '12', input: 'image' });
  assert.equal(profiles.snapshot().version, 2);
});
