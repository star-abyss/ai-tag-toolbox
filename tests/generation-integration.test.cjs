'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const modules = require('../src/modules');

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

test('assistant create/recreate workflows iterate, compare, upload source and preserve exact prompts', async () => {
  const storage = modules.createStorage({ prefix: `generation-integration-${Date.now()}` });
  const images = modules.createImages({ storage });
  const workflow = {
    '3': { class_type: 'KSampler', inputs: { positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], denoise: 0.7 } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 1024, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    '10': { class_type: 'LoadImage', inputs: { image: 'old.png', upload: 'image' } },
    '11': { class_type: 'SaveImage', inputs: { images: ['3', 0] } }
  };
  storage.set('comfy_profiles', { version: 2, activeProfileId: 'reference', items: [{
    id: 'reference', name: '参考图工作流', base: 'http://fixture.test:8188', workflow,
    capabilities: { txt2img: true, img2img: true, controlImage: false, mask: false },
    bindings: { positive: [{ nodeId: '6', input: 'text' }], negative: [{ nodeId: '7', input: 'text' }], sourceImage: { nodeId: '10', input: 'image' }, denoise: { nodeId: '3', input: 'denoise' }, controlStrength: null, outputs: ['11'] },
    overrides: { positive: true, negative: true }, updatedAt: 10
  }] });

  const submitted = [];
  const uploads = [];
  let renderSequence = 0;
  let hangNext = false;
  let renderStarted;
  const comfy = {
    setBase: () => {},
    status: async () => ({ connected: true, workflowReady: true, render: true, error: '' }),
    uploadImage: async input => { uploads.push({ size: input.bytes.length, filename: input.filename }); return { name: 'source.png', subfolder: 'aitag', type: 'input' }; },
    render: async input => {
      if (hangNext) {
        renderStarted?.();
        return new Promise((_resolve, reject) => input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }));
      }
      renderSequence += 1;
      submitted.push({ prompt: input.prompt, negative: input.negative, sourceImage: input.sourceImage || null });
      input.onSubmitted?.({ workflowHash: `hash-${renderSequence}`, changedBindings: input.sourceImage ? ['positive', 'sourceImage'] : ['positive'], parameters: { seed: renderSequence } });
      return { artifact: { id: `generated-${renderSequence}`, filename: `generated-${renderSequence}.png`, mime: 'image/png', dataUrl: `data:image/png;base64,${Buffer.from([renderSequence]).toString('base64')}` } };
    }
  };

  let currentIntent = 'create';
  const reviewCounts = { create: 0, recreate: 0, cancel: 0 };
  const primaryGateway = { complete: async messages => {
    const last = messages.at(-1);
    if (last?.role === 'tool') return { text: '已完成候选比较并返回实际提示词。' };
    const currentUser = [...messages].reverse().find(message => message.role === 'user')?.content || '';
    currentIntent = /复刻/.test(currentUser) ? 'recreate' : /取消/.test(currentUser) ? 'cancel' : 'create';
    const source = currentIntent === 'recreate' ? sourceImage.id : undefined;
    return { toolCalls: [{ id: `generation-${currentIntent}-${Date.now()}`, name: 'generation_execute', arguments: { requirements: currentUser, mode: currentIntent === 'recreate' ? 'recreate' : 'create', ...(source ? { sourceImageId: source } : {}), strategy: currentIntent === 'cancel' ? 'quick' : 'auto' } }] };
  } };
  const visionGateway = { complete: async messages => {
    const system = messages[0]?.content || '';
    const content = Array.isArray(messages[1]?.content) ? messages[1].content[0]?.text || '' : '';
    if (/operation="review"/.test(system)) {
      reviewCounts[currentIntent] += 1;
      const candidateId = content.match(/generated-\d+/)?.[0];
      const score = reviewCounts[currentIntent] === 1 ? 72 : 94;
      return { text: JSON.stringify({ operation: 'review', evaluations: [{ candidateId, score, verdict: score >= 90 ? 'accept' : 'revise', confidence: 0.92, dimensions: { requirementMatch: score }, hardErrors: [], issues: score >= 90 ? [] : [{ expected: '侧身构图', observed: '视角偏正面', severity: 'major', suggestedChange: '增加 from side' }], strengths: ['主体清晰'], suggestedChanges: score >= 90 ? [] : ['增加 from side'], summary: score >= 90 ? '符合要求' : '需要调整视角' }] }) };
    }
    if (/operation="compare"/.test(system)) {
      const ids = [...new Set([...content.matchAll(/generated-\d+/g)].map(match => match[0]))];
      return { text: JSON.stringify({ operation: 'compare', recommendedCandidateId: ids.at(-1), ranking: ids.slice().reverse().map((candidateId, index) => ({ candidateId, score: 95 - index, reason: 'fixture ranking' })), reason: '后一张更符合要求', confidence: 0.9 }) };
    }
    if (/系统修订协议/.test(system)) return { text: '{"add":["from side"],"remove":[],"preserve":["blue hair"]}' };
    if (/系统输出协议/.test(system)) return { text: '{"positiveTags":["1girl","blue hair"],"negativeTags":["lowres"]}' };
    return { text: '侧身蓝发女孩，半身构图，冷色光照' };
  } };

  const sourceImage = images.add({ id: 'source-image', filename: 'source.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AQID' });
  const assistant = modules.createAssistant({
    storage, images, comfy, primaryGateway, visionGateway,
    primaryApi: { base: 'http://fixture.test/v1', model: 'fixture-vision' },
    settings: {
      comfy: { enabled: true, base: 'http://fixture.test:8188', workflow, width: 768, height: 1024, steps: 20, cfg: 7, batchCount: 1 },
      limits: { maxComfyCalls: 3, maxToolRounds: 4, maxToolCalls: 24, primaryTimeoutMs: 2000 },
      generation: { strategy: 'auto', autoSelect: true, maxSuccessfulRenders: 3, maxRenderAttempts: 5, acceptScore: 90, minImprovement: 3, jobTimeoutMs: 10000 },
      generateNegativeTags: true
    }
  });

  const created = await assistant.run({ text: '创建蓝发女孩', requestId: 'integration-create' });
  assert.equal(created.ok, true, JSON.stringify(created.error));
  assert.equal(created.candidates.length, 2);
  assert.equal(created.selectedImageId, 'generated-2');
  assert.equal(created.candidates[1].prompt, submitted[1].prompt);
  assert.match(created.candidates[1].prompt, /from side/);
  assert.equal(created.usage.comfyCalls, 2);

  const recreated = await assistant.run({ text: '复刻这张图片', imageIds: [sourceImage.id], requestId: 'integration-recreate' });
  assert.equal(recreated.ok, true, JSON.stringify(recreated.error));
  assert.equal(recreated.mode, 'recreate');
  assert.equal(recreated.recreationMode, 'reference_image');
  assert.equal(recreated.candidates.length, 2);
  assert.equal(uploads.length, 2, 'each successful recreation render uploads the authorized source');
  assert(submitted.slice(2).every(call => call.sourceImage?.name === 'source.png'));
  assert.equal(recreated.candidates[1].prompt, submitted.at(-1).prompt);

  const records = assistant.listCallRecords();
  assert(records.some(row => row.kind === 'tool:generation.execute'));
  assert(records.some(row => row.kind === 'subagent:evaluateImages'));
  assert(records.some(row => row.kind === 'tool:comfy.render' && row.output.recreationMode === 'reference_image'));
  assert.doesNotMatch(JSON.stringify(records), /data:image|base64|AQID/);

  hangNext = true;
  const started = new Promise(resolve => { renderStarted = resolve; });
  const cancelling = assistant.run({ text: '取消测试绘图', requestId: 'integration-cancel' });
  await started;
  assert.equal(assistant.cancel('integration-cancel'), true);
  const cancelled = await cancelling;
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.error.code, 'CANCELLED');
  await wait(1);
  const cancelledJob = assistant.generation.list().find(job => job.requirements.includes('取消测试'));
  assert.equal(cancelledJob.status, 'cancelled');
  assistant.destroy();
});

