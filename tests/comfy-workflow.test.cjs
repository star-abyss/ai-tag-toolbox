'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const workflow = require('../src/modules/comfy-workflow');

const standard = {
  '3': { class_type: 'KSamplerAdvanced', inputs: { positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], steps: 20, cfg: 7, noise_seed: 1, sampler_name: 'euler', scheduler: 'normal' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 1024, batch_size: 1 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'old positive', clip: ['2', 0] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative', clip: ['2', 0] } },
  '8': { class_type: 'SaveImage', inputs: { images: ['9', 0] } },
  '9': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 0] } }
};

test('analyzes standard workflow and suggests unique bindings', () => {
  const report = workflow.analyzeWorkflow(standard);
  assert.equal(report.ready, true);
  assert.equal(report.level, 'standard');
  assert.equal(report.samplerCandidates[0].nodeId, '3');
  assert.equal(report.suggestedBindings.positive[0].nodeId, '6');
  assert.equal(report.suggestedBindings.negative[0].nodeId, '7');
  assert.deepEqual(report.suggestedBindings.outputs, ['8']);
});

test('multiple samplers require explicit selection and UI workflow JSON is rejected', () => {
  const multi = { ...standard, '10': { class_type: 'KSampler', inputs: { positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], steps: 10, cfg: 5 } } };
  const report = workflow.analyzeWorkflow(multi);
  assert.equal(report.level, 'manual');
  assert.equal(report.suggestedBindings, null);
  assert.match(workflow.validateApiWorkflow({ nodes: [], links: [] }).error, /界面格式/);
});

test('explicit bindings only change enabled overrides and reject stale paths', () => {
  const bindings = { positive: [{ nodeId: '6', input: 'text' }], negative: [{ nodeId: '7', input: 'text' }], width: [{ nodeId: '5', input: 'width' }] };
  const overrides = { ...workflow.DEFAULT_OVERRIDES, width: false };
  const built = workflow.applyExplicitBindings(standard, bindings, { positive: 'new positive', negative: 'new negative', width: 640 }, overrides);
  assert.equal(built['6'].inputs.text, 'new positive');
  assert.equal(built['7'].inputs.text, 'new negative');
  assert.equal(built['5'].inputs.width, 768);
  assert.throws(() => workflow.applyExplicitBindings(standard, { positive: [{ nodeId: 'missing', input: 'text' }] }, { positive: 'x' }, overrides), /绑定失效/);
});
