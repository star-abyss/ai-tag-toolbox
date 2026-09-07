'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createComfyProfiles } = require('../src/modules/comfy-profiles');
const { createComfy } = require('../src/modules/comfy');
const { createPrimaryTools } = require('../src/modules/primary-tools');

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

test('uploads an authorized source image through the ComfyUI multipart endpoint', async () => {
  const requests = [];
  const comfy = createComfy({ base: 'http://example.test:8188', fetch: async (url, init = {}) => {
    requests.push({ url: new URL(url), init });
    return { ok: true, json: async () => ({ name: 'source.png', subfolder: 'aitag', type: 'input' }) };
  } });
  const uploaded = await comfy.uploadImage({ bytes: Buffer.from([1, 2, 3]), filename: 'source.png', type: 'image/png' });
  assert.equal(requests[0].url.pathname, '/upload/image');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.body.get('type'), 'input');
  assert.equal(requests[0].init.body.get('overwrite'), 'true');
  assert.equal(uploaded.name, 'source.png');
  assert.equal(uploaded.subfolder, 'aitag');
});

test('render submits the uploaded source name only to its configured LoadImage node', async () => {
  const referenceWorkflow = structuredClone(workflow);
  referenceWorkflow['3'].inputs.denoise = 0.7;
  referenceWorkflow['10'] = { class_type: 'LoadImage', inputs: { image: 'old.png', upload: 'image' } };
  const profiles = createComfyProfiles({ initial: { comfy: { workflow: referenceWorkflow } } });
  const current = profiles.active();
  profiles.save({
    ...current,
    capabilities: { ...current.capabilities, img2img: true },
    bindings: {
      positive: [{ nodeId: '6', input: 'text' }], negative: [{ nodeId: '7', input: 'text' }], outputs: ['8'],
      sourceImage: { nodeId: '10', input: 'image' }, denoise: { nodeId: '3', input: 'denoise' }, controlStrength: null
    }
  });
  let submittedWorkflow;
  let submittedSummary;
  const comfy = createComfy({ profiles, base: 'http://example.test:8188', fetch: async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/prompt') { submittedWorkflow = JSON.parse(init.body).prompt; return { ok: true, json: async () => ({ prompt_id: 'p1' }) }; }
    if (pathname === '/history/p1') return { ok: true, json: async () => ({ p1: { status: { completed: true }, outputs: { '8': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } } }) };
    if (pathname === '/view') return { ok: true, arrayBuffer: async () => new Uint8Array([1]), headers: { get: () => 'image/png' } };
    throw new Error(`unexpected request ${pathname}`);
  } });
  const output = await comfy.render({ prompt: 'new positive', negative: '', sourceImage: { name: 'source.png', subfolder: 'aitag' }, denoise: 0.42, onSubmitted: summary => { submittedSummary = summary; } });
  assert.equal(submittedWorkflow['10'].inputs.image, 'aitag/source.png');
  assert.equal(submittedWorkflow['3'].inputs.denoise, 0.42);
  assert.equal(output.promptId, 'p1');
  assert.match(submittedSummary.workflowHash, /^[a-f0-9]{64}$/);
  assert(submittedSummary.changedBindings.includes('sourceImage'));
  assert.equal(Object.prototype.hasOwnProperty.call(submittedSummary, 'workflow'), false);
});

test('internal render uploads and binds a current-session source or reports text approximation', async () => {
  const source = { imageId: 'source-1', refId: 'source-ref', slotNo: 1 };
  const images = {
    get: id => id === 'render-1' ? { id: 'render-1' } : null,
    add: value => ({ id: value.id || value.imageId || 'render-1' })
  };
  const references = [];
  const repository = {
    listConversation: () => ({ items: [source] }),
    getOriginalBytes: async id => id === source.imageId ? Buffer.from([1, 2, 3]) : null,
    attachToConversation: (_sessionId, imageId) => { const row = { imageId, refId: `ref-${imageId}` }; references.push(row); return row; }
  };
  const calls = [];
  const profile = {
    id: 'profile-reference', updatedAt: 123,
    capabilities: { txt2img: true, img2img: true, controlImage: false, mask: false },
    bindings: { sourceImage: { nodeId: '10', input: 'image' } }
  };
  const comfy = {
    profiles: { active: () => profile },
    uploadImage: async input => { calls.push({ type: 'upload', input }); return { name: 'source.png', subfolder: 'aitag', type: 'input' }; },
    render: async input => { calls.push({ type: 'render', input }); input.onSubmitted?.({ workflowHash: 'hash-1', changedBindings: ['positive', 'sourceImage'], parameters: { denoise: 0.5 } }); return { artifact: { id: 'render-1' }, workflowHash: 'hash-1' }; }
  };
  const settings = { comfy: { enabled: true, workflow: workflow, negativeTags: [], width: 768, height: 1024, steps: 20, cfg: 7, seed: 1, sampler: 'euler', scheduler: 'normal', batchCount: 1 } };
  const tools = createPrimaryTools({ images, imageRepository: repository, comfy, getSettings: () => settings });
  const events = [];
  const rendered = await tools.call('comfy.render', { positiveTags: ['1girl'], sourceImageId: 'source-1', denoise: 0.5 }, { sessionId: 'session-1', onEvent: event => events.push(event) });
  assert.equal(rendered.ok, true, JSON.stringify(rendered.error));
  assert.equal(calls[0].type, 'upload');
  assert.equal(calls[1].input.sourceImage.name, 'source.png');
  assert.equal(rendered.data.recreationMode, 'reference_image');
  assert.equal(rendered.data.prompt, '1girl');
  assert.equal(rendered.data.workflowProfileId, 'profile-reference');
  assert(events.some(event => event.type === 'comfy.submitted' && event.workflowHash === 'hash-1'));

  profile.bindings = {};
  const approximate = await tools.call('comfy.render', { positiveTags: ['1girl'], sourceImageId: 'source-1' }, { sessionId: 'session-1' });
  assert.equal(approximate.ok, true, JSON.stringify(approximate.error));
  assert.equal(approximate.data.recreationMode, 'text_approximation');
  assert.equal(calls.filter(call => call.type === 'upload').length, 1);
});
