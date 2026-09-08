'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCandidateEvaluator } = require('../src/modules/candidate-evaluator');

function image(id) {
  return { id, thumbnailDataUrl: `data:image/png;base64,${Buffer.from(id).toString('base64')}` };
}

test('compare sends every authorized candidate and normalizes a legal ranking', async () => {
  const calls = [];
  const evaluator = createCandidateEvaluator({
    prompts: { composeEvaluation: () => 'LIVE EVALUATION PROMPT' },
    resolveImage: async id => image(id),
    visionAI: { complete: async (messages, options) => {
      calls.push({ messages, options });
      return { ok: true, text: JSON.stringify({
        operation: 'compare',
        recommendedCandidateId: 'candidate-b',
        ranking: [
          { candidateId: 'candidate-b', score: 108, reason: '更符合蓝发要求' },
          { candidateId: 'candidate-a', score: 72.4, reason: '发色偏紫' }
        ],
        reason: '候选 B 的主体和颜色更准确',
        confidence: 0.88
      }) };
    } }
  });

  const result = await evaluator.run({
    operation: 'compare',
    mode: 'create',
    brief: { requirements: '蓝发女孩', mustHave: ['blue hair'] },
    candidateImageIds: ['candidate-a', 'candidate-b']
  });

  assert.equal(result.operation, 'compare');
  assert.equal(result.recommendedCandidateId, 'candidate-b');
  assert.deepEqual(result.ranking.map(row => row.candidateId), ['candidate-b', 'candidate-a']);
  assert.equal(result.ranking[0].score, 100);
  assert.equal(result.ranking[1].rank, 2);
  assert.equal(calls.length, 1);
  assert.match(calls[0].messages[0].content, /LIVE EVALUATION PROMPT/);
  const content = calls[0].messages[1].content;
  assert.equal(content.filter(part => part.type === 'image_url').length, 2);
  assert.match(content[0].text, /candidate-a.*candidate-b/s);
  assert.equal(calls[0].options.stream, false);
  assert.equal(calls[0].options.enable_thinking, false);
});

test('recreation review labels the source first and returns structured actionable issues', async () => {
  const resolved = [];
  let request;
  const evaluator = createCandidateEvaluator({
    resolveImage: async (id, context) => { resolved.push({ id, sessionId: context.sessionId }); return image(id); },
    visionAI: { complete: async messages => {
      request = messages;
      return { text: JSON.stringify({
        operation: 'review',
        evaluations: [{
          candidateId: 'candidate-1',
          score: 67,
          verdict: 'revise',
          confidence: 0.76,
          dimensions: { referenceSimilarity: 62, pose: 51, technicalQuality: 88 },
          hardErrors: [],
          issues: [{ expected: '侧身视角', observed: '正面视角', severity: 'major', suggestedChange: '加强 from side 与侧身姿势' }],
          strengths: ['服装颜色接近'],
          suggestedChanges: ['加强 from side'],
          summary: '主体接近，但姿势需要修订'
        }]
      }) };
    } }
  });

  const result = await evaluator.run({
    operation: 'review', mode: 'recreate', brief: { requirements: '复刻构图' },
    sourceImageId: 'source-1', candidateImageIds: ['candidate-1']
  }, { sessionId: 'session-1' });

  assert.deepEqual(resolved, [
    { id: 'source-1', sessionId: 'session-1' },
    { id: 'candidate-1', sessionId: 'session-1' }
  ]);
  const content = request[1].content;
  assert.match(content[1].text, /参考原图.*source-1/);
  assert.equal(content[2].type, 'image_url');
  assert.match(content[3].text, /候选图.*candidate-1/);
  assert.equal(result.evaluations[0].issues[0].severity, 'major');
  assert.equal(result.evaluations[0].dimensions.referenceSimilarity, 62);
});

test('replacement evaluation receives authoritative target references without requiring every appearance tag', async () => {
  let request;
  const evaluator = createCandidateEvaluator({
    resolveImage: async id => image(id),
    visionAI: { complete: async messages => {
      request = messages;
      return { text: JSON.stringify({ operation: 'review', evaluations: [{ candidateId: 'candidate-1', score: 90, verdict: 'accept', confidence: 0.9, dimensions: {}, hardErrors: [], issues: [], strengths: [], suggestedChanges: [], summary: '目标角色正确' }] }) };
    } }
  });
  const characterReferences = [{ id: 'hinanawi_tenshi', name: '比那名居天子', series: 'touhou', identityTags: ['hinanawi tenshi', 'touhou'], generalTags: ['blue hair', 'red eyes', 'boots'], specificTags: [] }];
  await evaluator.run({
    operation: 'review', mode: 'recreate', sourceImageId: 'source-1', candidateImageIds: ['candidate-1'],
    brief: { requirements: '替换为天子，上半身构图', characterReferences, sourceReferenceRole: 'observations_before_requested_changes', characterReferencePolicy: 'adaptive_by_count_and_visible_crop', visualBlueprint: { pose: ['sitting'], scene: ['church'] } }
  });
  assert.match(request[0].content, /用户原始要求.*优先于角色资料/s);
  assert.match(request[0].content, /人数.*景别.*可见范围/s);
  assert.match(request[0].content, /外貌.*可选参考/s);
  assert.match(request[0].content, /不得用原图人物的外貌重新解释目标角色/);
  assert.match(request[1].content[0].text, /hinanawi_tenshi.*blue hair.*red eyes.*boots/s);
});

test('malformed JSON retries once with a repair instruction', async () => {
  const calls = [];
  const evaluator = createCandidateEvaluator({
    resolveImage: async id => image(id),
    visionAI: { complete: async messages => {
      calls.push(messages);
      if (calls.length === 1) return { text: '不是 JSON' };
      return { text: JSON.stringify({
        operation: 'review',
        evaluations: [{ candidateId: 'candidate-1', score: 91, verdict: 'accept', confidence: 0.9, dimensions: {}, hardErrors: [], issues: [], strengths: [], suggestedChanges: [], summary: '符合要求' }]
      }) };
    } }
  });

  const result = await evaluator.run({ operation: 'review', mode: 'create', brief: { requirements: 'portrait' }, candidateImageIds: ['candidate-1'] });
  assert.equal(result.evaluations[0].verdict, 'accept');
  assert.equal(calls.length, 2);
  assert.match(calls[1].at(-1).content, /上一次输出无效.*JSON/s);
});

test('invalid image scope and illegal output candidate IDs fail explicitly', async () => {
  const missing = createCandidateEvaluator({ resolveImage: async () => null, visionAI: { complete: async () => ({ text: '{}' }) } });
  await assert.rejects(
    missing.run({ operation: 'review', mode: 'create', brief: {}, candidateImageIds: ['candidate-1'] }),
    error => error.code === 'IMAGE_NOT_FOUND'
  );

  let calls = 0;
  const illegal = createCandidateEvaluator({
    resolveImage: async id => image(id),
    visionAI: { complete: async () => {
      calls += 1;
      return { text: JSON.stringify({ operation: 'compare', recommendedCandidateId: 'invented', ranking: [
        { candidateId: 'invented', score: 99, reason: '不存在' },
        { candidateId: 'candidate-a', score: 80, reason: '存在' }
      ], reason: 'bad' }) };
    } }
  });
  await assert.rejects(
    illegal.run({ operation: 'compare', mode: 'create', brief: {}, candidateImageIds: ['candidate-a', 'candidate-b'] }),
    error => error.code === 'OUTPUT_INVALID'
  );
  assert.equal(calls, 2);
});

test('operation-specific candidate counts and recreate source are validated', async () => {
  const evaluator = createCandidateEvaluator({ resolveImage: async id => image(id), visionAI: { complete: async () => ({ text: '{}' }) } });
  await assert.rejects(
    evaluator.run({ operation: 'review', mode: 'create', brief: {}, candidateImageIds: ['a', 'b'] }),
    error => error.code === 'INVALID_INPUT'
  );
  await assert.rejects(
    evaluator.run({ operation: 'compare', mode: 'create', brief: {}, candidateImageIds: ['a'] }),
    error => error.code === 'INVALID_INPUT'
  );
  await assert.rejects(
    evaluator.run({ operation: 'review', mode: 'recreate', brief: {}, candidateImageIds: ['a'] }),
    error => error.code === 'SOURCE_IMAGE_REQUIRED'
  );
});
