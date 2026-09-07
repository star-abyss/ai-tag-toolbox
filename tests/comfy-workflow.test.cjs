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

test('analyzes and applies explicit reference-image bindings for complex workflows', () => {
  const complex = structuredClone(standard);
  complex['3'].inputs.denoise = 0.65;
  complex['10'] = { class_type: 'LoadImage', inputs: { image: 'old.png', upload: 'image' } };
  complex['11'] = { class_type: 'ControlNetApplyAdvanced', inputs: { positive: ['6', 0], negative: ['7', 0], control_net: ['12', 0], image: ['10', 0], strength: 0.7 } };
  const report = workflow.analyzeWorkflow(complex);
  assert.equal(report.sourceImageCandidates[0].nodeId, '10');
  assert.equal(report.sourceImageCandidates[0].input, 'image');
  assert.equal(report.referenceFieldCandidates.denoise[0].nodeId, '3');
  assert.equal(report.referenceFieldCandidates.controlStrength[0].nodeId, '11');
  assert.deepEqual(report.suggestedBindings.sourceImage, { nodeId: '10', input: 'image' });

  const bindings = {
    ...report.suggestedBindings,
    sourceImage: { nodeId: '10', input: 'image' },
    denoise: { nodeId: '3', input: 'denoise' },
    controlStrength: { nodeId: '11', input: 'strength' }
  };
  const built = workflow.applyExplicitBindings(complex, bindings, {
    positive: 'new positive', negative: '', sourceImage: 'uploaded/source.png', denoise: 0.42, controlStrength: 0.9
  }, workflow.DEFAULT_OVERRIDES);
  assert.equal(built['10'].inputs.image, 'uploaded/source.png');
  assert.equal(built['3'].inputs.denoise, 0.42);
  assert.equal(built['11'].inputs.strength, 0.9);
  assert.throws(() => workflow.applyExplicitBindings(complex, { ...bindings, sourceImage: { nodeId: 'missing', input: 'image' } }, { positive: 'x', sourceImage: 'new.png' }, workflow.DEFAULT_OVERRIDES), /绑定失效/);
});
