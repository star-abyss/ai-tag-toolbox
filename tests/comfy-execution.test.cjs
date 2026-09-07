'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createComfyProfiles } = require('../src/modules/comfy-profiles');
const { createComfy } = require('../src/modules/comfy');

const workflow = {
  '3': { class_type: 'KSampler', inputs: { positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], steps: 20, cfg: 7, seed: 1, sampler_name: 'euler', scheduler: 'normal', model: ['4', 0] } },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'base.safetensors' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 1024, batch_size: 1 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'old positive', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative', clip: ['4', 1] } },
  '8': { class_type: 'SaveImage', inputs: { images: ['9', 0] } },
  '9': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } }
};

function setup(overrides = {}) {
  const profiles = createComfyProfiles({ initial: { comfy: { workflow } } });
  const active = profiles.active();
  profiles.save({ ...active, bindings: { positive: [{ nodeId: '6', input: 'text' }], negative: [{ nodeId: '7', input: 'text' }], width: [{ nodeId: '5', input: 'width' }], outputs: ['8'] }, overrides: { ...active.overrides, ...overrides } });
  const comfy = createComfy({ profiles, base: 'http://example.test', fetch: async () => ({ ok: true, json: async () => ({ prompt_id: 'p1' }), arrayBuffer: async () => new Uint8Array([1]), headers: { get: () => 'image/png' } }) });
  return { profiles, comfy };
}

test('render build changes only prompt bindings by default', () => {
  const { comfy } = setup();
  const built = comfy.buildWorkflow({ prompt: 'new positive', negative: 'new negative', width: 640, steps: 40 });
  assert.equal(built['6'].inputs.text, 'new positive');
  assert.equal(built['7'].inputs.text, 'new negative');
  assert.equal(built['5'].inputs.width, 768);
  assert.equal(built['3'].inputs.steps, 20);
});

test('enabled explicit override changes only its bound field', () => {
  const { comfy } = setup({ width: true });
  const built = comfy.buildWorkflow({ prompt: 'p', negative: '', width: 640 });
  assert.equal(built['5'].inputs.width, 640);
  assert.equal(built['3'].inputs.steps, 20);
});

test('stale profile bindings fail before submission', () => {
  const { profiles, comfy } = setup();
  const active = profiles.active();
  profiles.save({ ...active, bindings: { positive: [{ nodeId: 'missing', input: 'text' }] } });
  assert.throws(() => comfy.buildWorkflow({ prompt: 'p' }), /绑定失效/);
});
