'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGenerationOrchestrator } = require('../src/modules/generation-orchestrator');
const { createStorage } = require('../src/modules/storage');

function ok(data) { return { ok: true, data }; }
function error(code, message) { return Object.assign(new Error(message || code), { code }); }

function harness(options = {}) {
  const events = [];
  const renders = [];
  const subagentCalls = [];
  const renderPlan = (options.renderPlan || ['img-1', 'img-2', 'img-3']).slice();
  const reviewScores = (options.reviewScores || [70, 94, 82]).slice();
  const storage = options.storage || createStorage({ prefix: `generation-test-${Date.now()}-${Math.random()}` });
  let revision = 0;
  const runSubAgent = options.runSubAgent || (async (name, request) => {
    const input = request.input;
    subagentCalls.push({ name, input: structuredClone(input) });
    if (name === 'vision') return ok({ description: '侧身蓝发女孩，半身构图', tags: ['blue hair', 'from side'] });
    if (name === 'generateTags' && input.operation === 'revise') {
      revision += 1;
      return ok({ add: [`revision ${revision}`], remove: ['blue hair'], preserve: ['blue hair'] });
    }
    if (name === 'generateTags') return ok({ positiveTags: ['1girl', 'blue hair'], negativeTags: ['lowres'] });
    if (name === 'evaluateImages' && input.operation === 'review') {
      const score = reviewScores.shift() ?? 75;
      return ok({ operation: 'review', evaluations: [{
        candidateId: input.candidateImageIds[0], score,
        verdict: score >= 90 ? 'accept' : 'revise', confidence: 0.9,
        dimensions: { requirementMatch: score }, hardErrors: [], issues: score >= 90 ? [] : [{ expected: '更准确', observed: '仍有偏差', severity: 'major', suggestedChange: '加强要求' }],
        strengths: [], suggestedChanges: score >= 90 ? [] : ['加强要求'], summary: `评分 ${score}`
      }] });
    }
    if (name === 'evaluateImages' && input.operation === 'compare') {
      const selected = options.compareCandidateId || input.candidateImageIds[0];
      return ok({ operation: 'compare', recommendedCandidateId: selected, ranking: input.candidateImageIds.slice().reverse().map((candidateId, index) => ({ candidateId, rank: index + 1, score: 90 - index, reason: `排序 ${index + 1}` })), reason: '最后一张最符合要求', confidence: 0.85 });
    }
    throw error('SUBAGENT_UNAVAILABLE', name);
  });
  const renderCandidate = options.renderCandidate || (async (payload, context) => {
    renders.push(structuredClone(payload));
    const next = renderPlan.shift();
    if (next instanceof Error) throw next;
    const ids = Array.isArray(next) ? next : [next];
    return {
      artifacts: ids.map((imageId, index) => ({ imageId, width: 768, height: 1024, seed: payload.iteration * 100 + index })),
      imageIds: ids,
      parameters: { seed: payload.iteration * 100, steps: 24 },
      workflowProfileId: 'profile-1', workflowRevision: 'rev-1'
    };
  });
  const orchestrator = createGenerationOrchestrator({
    storage,
    runSubAgent,
    renderCandidate,
    cancelRender: options.cancelRender,
    preflight: options.preflight || (async () => ({ ready: true, connected: true, workflowProfileId: 'profile-1', workflowRevision: 'rev-1' })),
    listConversationImages: options.listConversationImages || (() => ({ items: [{ imageId: 'source-1', slotNo: 1 }] })),
    resolveCharacter: options.resolveCharacter,
    getSettings: () => ({ generation: { strategy: 'auto', autoSelect: true, maxSuccessfulRenders: 3, maxRenderAttempts: 5, acceptScore: 90, minImprovement: 3 }, ...(options.settings || {}) }),
    getPromptSnapshot: () => ({ activeSetId: 'prompt-set-default', revision: 7, items: { generateTags: { text: 'GEN' }, candidateEvaluation: { text: 'EVAL' } } })
  });
  const context = { sessionId: 'session-1', requestId: 'root-1', messageId: 'message-1', onEvent: event => events.push(event) };
  return { orchestrator, context, events, renders, subagentCalls, storage };
}

test('auto creates two candidates, revises Tags and selects the accepted candidate', async () => {
  const app = harness({ reviewScores: [72, 94] });
  const result = await app.orchestrator.execute({ requirements: '蓝发女孩', mode: 'create', strategy: 'auto' }, app.context);

  assert.equal(result.status, 'completed');
  assert.equal(result.candidates.length, 2);
  assert.equal(result.selectedCandidateId, 'candidate-2');
  assert.equal(result.selectedImageId, 'img-2');
  assert.equal(result.successfulRenders, 2);
  assert.equal(result.renderAttempts, 2);
  assert.equal(result.stopReason, 'accepted');
  assert.equal(result.outcome, 'accepted');
  assert.deepEqual(result.positiveTags, ['1girl', 'blue hair', 'revision 1']);
  assert.equal(result.candidates[1].prompt, app.renders[1].positiveTags.join(', '));
  assert(app.renders[1].positiveTags.includes('blue hair'), 'preserved Tag must not be removed by a revision patch');
  assert(app.subagentCalls.some(call => call.name === 'generateTags' && call.input.operation === 'revise'));
  for (const type of ['generation.started', 'prompt.compiled', 'candidate.rendering', 'candidate.ready', 'candidate.evaluated', 'prompt.revised', 'candidate.recommended', 'generation.completed']) {
    assert(app.events.some(event => event.type === type), `missing event ${type}`);
  }
});

test('failed renders consume attempts but not the successful-image budget', async () => {
  const app = harness({ renderPlan: [error('COMFY_FAILED', 'queue failed'), 'img-ok'], reviewScores: [80] });
  const result = await app.orchestrator.execute({ requirements: 'portrait', mode: 'create', strategy: 'quick' }, app.context);
  assert.equal(result.status, 'completed');
  assert.equal(result.renderAttempts, 2);
  assert.equal(result.successfulRenders, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.stopReason, 'quick');
  assert(app.events.some(event => event.type === 'candidate.failed' && event.attempt === 1));
});

test('legacy fixed3 maps to three successful rounds and caps each returned batch', async () => {
  const app = harness({ settings: { generation: { strategy: 'fixed3', imagesPerRound: 2, maxAutoRounds: 3, maxRenderAttempts: 5, acceptScore: 90, minImprovement: 3 } }, renderPlan: [['img-1', 'img-2', 'ignored-1'], ['img-3', 'img-4', 'ignored-2'], ['img-5', 'img-6', 'ignored-3']], reviewScores: [70, 72, 74, 76, 78, 80] });
  const result = await app.orchestrator.execute({ requirements: 'three variations', mode: 'create', strategy: 'fixed3' }, app.context);
  assert.equal(result.status, 'completed');
  assert.equal(result.successfulRounds, 3);
  assert.equal(result.successfulRenders, 6);
  assert.deepEqual(result.imageIds, ['img-1', 'img-2', 'img-3', 'img-4', 'img-5', 'img-6']);
  assert.equal(result.candidates.some(candidate => candidate.imageId.startsWith('ignored')), false);
  assert.equal(result.stopReason, 'max_auto_rounds');
});

test('recreate without a source pauses and resume inspects the supplied source', async () => {
  const app = harness({ reviewScores: [92] });
  const paused = await app.orchestrator.execute({ requirements: '复刻这张图', mode: 'recreate', strategy: 'quick' }, app.context);
  assert.equal(paused.status, 'needs_input');
  assert.equal(paused.needsInput.kind, 'source_image');
  assert.equal(app.renders.length, 0);

  const completed = await app.orchestrator.resume({ jobId: paused.jobId, sourceImageId: 'source-1' }, app.context);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.sourceImageId, 'source-1');
  assert.equal(completed.recreationMode, 'text_approximation');
  assert(app.subagentCalls.some(call => call.name === 'vision' && call.input.imageId === 'source-1'));
  const review = app.subagentCalls.find(call => call.name === 'evaluateImages' && call.input.operation === 'review');
  assert.equal(review.input.sourceImageId, 'source-1');
});

test('ambiguous character query pauses before compilation', async () => {
  const app = harness({ resolveCharacter: async (query, context) => context.mode === 'id'
    ? { id: query, name: 'Alice', identityTags: ['alice'] }
    : { items: [{ id: `${query}-a` }, { id: `${query}-b` }] } });
  const result = await app.orchestrator.execute({ requirements: '画这个角色', characterQueries: ['Alice'], mode: 'create' }, app.context);
  assert.equal(result.status, 'needs_input');
  assert.equal(result.needsInput.kind, 'character');
  assert.equal(result.needsInput.query, 'Alice');
  assert.equal(app.subagentCalls.length, 0);
  const resumed = await app.orchestrator.resume({ jobId: result.jobId, characterIds: ['alice-a'], strategy: 'quick' }, app.context);
  assert.equal(resumed.status, 'completed');
  const compile = app.subagentCalls.find(call => call.name === 'generateTags' && call.input.operation === 'compile');
  assert.equal(compile.input.characterReferences[0].id, 'alice-a');
});

test('confirmed character IDs take priority over redundant series queries and carry appearance into compilation', async () => {
  const role = { id: 'hinanawi_tenshi', nameZh: '比那名居天子', seriesName: 'touhou', identityTags: ['hinanawi_tenshi', 'touhou'], generalTags: [{ en: 'blue hair' }], specificTags: [{ en: 'tenshi hat' }] };
  const app = harness({ resolveCharacter: async (value, context) => context.mode === 'id' && value === role.id ? role : { items: [{ id: 'hakurei_reimu' }, { id: 'kirisame_marisa' }] } });
  const result = await app.orchestrator.execute({ originalRequirements: '把图1里面的角色换成东方里面的天子', mode: 'recreate', sourceImageId: 'source-1', characterIds: [role.id], characterQueries: ['比那名居天子', 'hinanawi_tenshi', 'touhou'], strategy: 'quick' }, app.context);
  assert.equal(result.status, 'completed');
  assert.equal(result.sourceImageId, 'source-1');
  const compile = app.subagentCalls.find(call => call.name === 'generateTags');
  assert.deepEqual(compile.input.characterReferences, [{ id: role.id, name: '比那名居天子', series: 'touhou', identityTags: ['hinanawi_tenshi', 'touhou'], generalTags: ['blue hair'], specificTags: ['tenshi hat'] }]);
});

test('invalid confirmed character IDs pause instead of silently generating without the character', async () => {
  const app = harness({ resolveCharacter: async value => value === 'valid' ? { id: 'valid', identityTags: ['valid'] } : null });
  const result = await app.orchestrator.execute({ requirements: '画天子', characterIds: ['missing'] }, app.context);
  assert.equal(result.status, 'needs_input');
  assert.equal(result.needsInput.kind, 'character');
  assert.equal(app.renders.length, 0);
  assert.equal(app.subagentCalls.length, 0);
  const resumed = await app.orchestrator.resume({ jobId: result.jobId, characterSelection: { query: 'missing', characterId: 'valid' } }, app.context);
  assert.equal(resumed.status, 'completed');
  assert.deepEqual(app.subagentCalls.find(call => call.name === 'generateTags').input.characterReferences.map(role => role.id), ['valid']);
});

test('a unique name match loads the full character appearance before compiling Tags', async () => {
  const app = harness({ resolveCharacter: async (value, context) => context.mode === 'id'
    ? { id: value, name: 'Tenshi', identityTags: ['hinanawi tenshi', 'touhou'], generalTags: [{ en: 'blue hair' }], specificTags: [{ en: 'peach hat' }] }
    : { items: [{ id: 'hinanawi_tenshi', name: 'Tenshi', seriesName: 'touhou' }] } });
  const result = await app.orchestrator.execute({ requirements: 'draw Tenshi', characterQueries: ['Tenshi'], strategy: 'quick' }, app.context);
  assert.equal(result.status, 'completed');
  const reference = app.subagentCalls.find(call => call.name === 'generateTags').input.characterReferences[0];
  assert.deepEqual(reference.generalTags, ['blue hair']);
  assert.deepEqual(reference.identityTags, ['hinanawi tenshi', 'touhou']);
});

test('character choices resume the original job across pauses and reject stale choices and foreign sessions', async () => {
  const roles = Object.fromEntries(['alice-a', 'alice-b', 'bob-a', 'bob-b'].map(id => [id, { id, name: id, identityTags: [id], generalTags: [{ en: 'blue hair' }] }]));
  const resolveCharacter = async (query, context) => context.mode === 'id' ? roles[query] : { items: Object.values(roles).filter(role => role.id.startsWith(query)) };
  const app = harness({ resolveCharacter });
  const paused = await app.orchestrator.execute({ requirements: '画 alice 与 bob', characterQueries: ['alice', 'bob'], strategy: 'quick' }, app.context);
  await assert.rejects(app.orchestrator.resume({ jobId: paused.jobId, characterSelection: { query: 'alice', characterId: 'alice-a' } }, { ...app.context, sessionId: 'other-session' }), { code: 'SESSION_UNAVAILABLE' });
  await assert.rejects(app.orchestrator.resume({ jobId: paused.jobId, characterSelection: { query: 'alice', characterId: 'missing' } }, app.context), { code: 'CHARACTER_NOT_FOUND' });
  const second = await app.orchestrator.resume({ jobId: paused.jobId, characterSelection: { query: 'alice', characterId: 'alice-b' } }, app.context);
  assert.equal(second.status, 'needs_input');
  assert.equal(second.needsInput.query, 'bob');
  assert.equal(app.renders.length, 0);
  await assert.rejects(app.orchestrator.resume({ jobId: paused.jobId, characterSelection: { query: 'alice', characterId: 'alice-a' } }, app.context), { code: 'INPUT_EXPIRED' });
  const reloaded = harness({ storage: app.storage, resolveCharacter });
  const result = await reloaded.orchestrator.resume({ jobId: paused.jobId, characterSelection: { query: 'bob', characterId: 'bob-a' } }, app.context);
  assert.equal(result.jobId, paused.jobId);
  assert.equal(result.status, 'completed');
  const compile = reloaded.subagentCalls.find(call => call.name === 'generateTags');
  assert.deepEqual(compile.input.characterReferences.map(role => role.id), ['alice-b', 'bob-a']);
});

test('cancel aborts an active job and preserves a cancelled snapshot', async () => {
  let rendering;
  const started = new Promise(resolve => { rendering = resolve; });
  const app = harness({ renderCandidate: (_payload, context) => new Promise((_resolve, reject) => {
    rendering();
    context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true });
  }) });
  const pending = app.orchestrator.execute({ requirements: 'long render', mode: 'create' }, app.context);
  await started;
  const jobId = app.orchestrator.list()[0].jobId;
  assert.equal(app.orchestrator.cancel(jobId), true);
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.outcome, 'cancelled');
  assert.equal(app.orchestrator.get(jobId).status, 'cancelled');
  assert(app.events.some(event => event.type === 'generation.cancelled'));
});

test('restored running jobs become interrupted and manual selection controls exact final fields', async () => {
  const storage = createStorage({ prefix: `generation-restore-${Date.now()}-${Math.random()}` });
  storage.set('generation_jobs', [{
    jobId: 'job-old', sessionId: 'session-1', mode: 'create', status: 'rendering', requirements: 'old',
    policy: { strategy: 'auto', autoSelect: true, maxSuccessfulRenders: 3, maxRenderAttempts: 5, acceptScore: 90, minImprovement: 3 },
    candidates: [], renderAttempts: 1, successfulRenders: 0, createdAt: 1, updatedAt: 2
  }]);
  const restored = harness({ storage });
  assert.equal(restored.orchestrator.get('job-old').status, 'interrupted');
  assert.equal(storage.get('generation_jobs')[0].status, 'interrupted');

  const app = harness({ settings: { generation: { strategy: 'auto', autoSelect: false, maxSuccessfulRenders: 3, maxRenderAttempts: 5, acceptScore: 90, minImprovement: 3 } }, reviewScores: [70, 94] });
  const result = await app.orchestrator.execute({ requirements: 'manual choice', strategy: 'auto', autoSelect: false }, app.context);
  assert.equal(result.selectedCandidateId, '');
  const chosen = app.orchestrator.selectCandidate(result.jobId, 'candidate-1', 'user');
  assert.equal(chosen.selectedCandidateId, 'candidate-1');
  assert.equal(chosen.selectedImageId, 'img-1');
  assert.equal(chosen.positiveTags.join(', '), chosen.candidates[0].prompt);
  assert.equal(chosen.candidates[0].selectionSource, 'user');
});

test('recreate keeps original user wording and parses Vision JSON before Tag compilation', async () => {
  const calls = [];
  const app = harness({ runSubAgent: async (name, request) => {
    calls.push({ name, input: structuredClone(request.input) });
    if (name === 'vision') return ok({ text: '{"tags":["church","from below"],"description":"教堂低视角构图","scene":"church","pose":"sitting"}', metadata: { workflow: { huge: true } } });
    if (name === 'generateTags') return request.input.operation === 'revise' ? ok({ add: [], remove: [], preserve: [] }) : ok({ positiveTags: ['1girl', 'church'] });
    if (name === 'evaluateImages' && request.input.operation === 'review') return ok({ operation: 'review', evaluations: [{ candidateId: request.input.candidateImageIds[0], score: 95, verdict: 'accept', hardErrors: [], issues: [], summary: 'ok' }] });
    if (name === 'evaluateImages') return ok({ operation: 'compare', recommendedCandidateId: request.input.candidateImageIds[0], ranking: request.input.candidateImageIds.map((candidateId, index) => ({ candidateId, rank: index + 1, score: 95 - index, reason: 'ok' })), reason: 'ok' });
    throw new Error(name);
  }, reviewScores: [95] });
  const original = '只替换角色，保持原图姿势、构图与教堂场景不变';
  const result = await app.orchestrator.execute({ originalRequirements: original, mode: 'recreate', sourceImageId: 'source-1', strategy: 'quick' }, app.context);
  assert.equal(result.status, 'completed');
  assert.equal(result.originalRequirements, original);
  const compile = calls.find(call => call.name === 'generateTags' && call.input.operation === 'compile');
  assert.equal(compile.input.requirements, original);
  assert.deepEqual(JSON.parse(compile.input.description), { description: '教堂低视角构图', tags: ['church', 'from below'], pose: 'sitting', scene: 'church', parseMode: 'json' });
});

test('invalid revision patch is repaired once before the next render', async () => {
  let revisions = 0;
  const calls = [];
  const app = harness({ reviewScores: [70, 95], runSubAgent: async (name, request) => {
    calls.push({ name, input: structuredClone(request.input) });
    if (name === 'generateTags' && request.input.operation === 'compile') return ok({ positiveTags: ['1girl', 'from above'] });
    if (name === 'generateTags') {
      revisions += 1;
      return revisions === 1
        ? ok({ add: ['from below'], remove: [], preserve: [] })
        : ok({ add: ['from below'], remove: ['from above'], preserve: [] });
    }
    if (name === 'evaluateImages' && request.input.operation === 'review') {
      const score = request.input.candidateImageIds[0] === 'img-1' ? 70 : 95;
      return ok({ operation: 'review', evaluations: [{ candidateId: request.input.candidateImageIds[0], score, verdict: score > 90 ? 'accept' : 'revise', hardErrors: [], issues: [], suggestedChanges: ['use from below'], summary: 'change view' }] });
    }
    if (name === 'evaluateImages') return ok({ operation: 'compare', recommendedCandidateId: 'img-2', ranking: [{ candidateId: 'img-2', score: 95, reason: 'ok' }, { candidateId: 'img-1', score: 70, reason: 'old' }], reason: 'ok' });
    throw new Error(name);
  } });
  const result = await app.orchestrator.execute({ requirements: 'portrait', strategy: 'auto' }, app.context);
  assert.equal(result.status, 'completed');
  assert.equal(revisions, 2);
  assert(app.renders[1].positiveTags.includes('from below'));
  assert(!app.renders[1].positiveTags.includes('from above'));
  const repair = calls.filter(call => call.name === 'generateTags' && call.input.operation === 'revise')[1];
  assert.match(JSON.stringify(repair.input.evaluation), /patchValidation/);
});

test('invalid repair patch stops before submitting the same prompt again', async () => {
  let revisionCalls = 0;
  const app = harness({
    settings: { generation: { autoRun: true, imagesPerRound: 1, maxAutoRounds: 3, maxRenderAttempts: 5, acceptScore: 90, minImprovement: 3 } },
    runSubAgent: async (name, request) => {
      if (name === 'generateTags' && request.input.operation === 'compile') return ok({ positiveTags: ['1girl', 'hand holding bottle'] });
      if (name === 'generateTags') { revisionCalls += 1; return ok({ add: ['hand holding bottle'], remove: ['hand holding bottle'], preserve: ['1girl'] }); }
      if (name === 'evaluateImages' && request.input.operation === 'review') return ok({ operation: 'review', evaluations: [{ candidateId: request.input.candidateImageIds[0], score: 45, verdict: 'revise', hardErrors: [], issues: [], summary: '需要修正' }] });
      if (name === 'evaluateImages') return ok({ operation: 'compare', recommendedCandidateId: request.input.candidateImageIds[0], ranking: request.input.candidateImageIds.map((candidateId, index) => ({ candidateId, rank: index + 1, score: 45 - index, reason: 'same prompt' })), reason: 'same prompt' });
      throw new Error(name);
    }
  });
  const result = await app.orchestrator.execute({ originalRequirements: '修正手部', mode: 'create' }, app.context);
  assert.equal(revisionCalls, 2, 'one invalid patch and one repair attempt are allowed');
  assert.equal(app.renders.length, 1);
  assert.equal(result.successfulRounds, 1);
  assert.equal(result.stopReason, 'revision_failed');
});

test('valid no-op patch does not spend another automatic or manual render', async () => {
  const makeApp = autoRun => harness({
    settings: { generation: { autoRun, imagesPerRound: 1, maxAutoRounds: 3, maxRenderAttempts: 5, acceptScore: 90, minImprovement: 3 } },
    runSubAgent: async (name, request) => {
      if (name === 'generateTags' && request.input.operation === 'compile') return ok({ positiveTags: ['1girl', 'blue hair'] });
      if (name === 'generateTags') return ok({ add: [], remove: [], preserve: ['1girl', 'blue hair'] });
      if (name === 'evaluateImages' && request.input.operation === 'review') return ok({ operation: 'review', evaluations: [{ candidateId: request.input.candidateImageIds[0], score: 70, verdict: 'revise', hardErrors: [], issues: [], summary: '需要调整' }] });
      if (name === 'evaluateImages') return ok({ operation: 'compare', recommendedCandidateId: request.input.candidateImageIds[0], ranking: request.input.candidateImageIds.map((candidateId, index) => ({ candidateId, rank: index + 1, score: 70 - index, reason: 'same prompt' })), reason: 'same prompt' });
      throw new Error(name);
    }
  });
  const automatic = makeApp(true);
  const automaticResult = await automatic.orchestrator.execute({ originalRequirements: 'blue-haired portrait' }, automatic.context);
  assert.equal(automatic.renders.length, 1);
  assert.equal(automaticResult.stopReason, 'prompt_unchanged');
  assert(automatic.events.some(event => event.type === 'prompt.revision_unchanged'));

  const manual = makeApp(false);
  const paused = await manual.orchestrator.execute({ originalRequirements: 'blue-haired portrait', autoRun: false }, manual.context);
  const continued = await manual.orchestrator.resume({ jobId: paused.jobId, action: 'continue', baseCandidateId: 'candidate-1', feedback: '更准确一些' }, manual.context);
  assert.equal(manual.renders.length, 1);
  assert.equal(continued.status, 'awaiting_feedback');
  assert.equal(continued.stopReason, 'prompt_unchanged');
});

test('restored job blocks a duplicate prompt before ComfyUI submission', async () => {
  const storage = createStorage({ prefix: `generation-duplicate-${Date.now()}-${Math.random()}` });
  storage.set('generation_jobs', [{
    jobId: 'job-duplicate', sessionId: 'session-1', mode: 'create', status: 'interrupted', originalRequirements: 'portrait',
    policy: { autoRun: true, imagesPerRound: 1, maxAutoRounds: 2, maxRenderAttempts: 3, acceptScore: 90, minImprovement: 3 },
    positiveTags: ['1girl'], negativeTags: [],
    candidates: [{ id: 'candidate-1', imageId: 'img-1', iteration: 1, roundId: 'round-1', roundIndex: 1, positiveTags: ['1girl'], negativeTags: [], prompt: '1girl', evaluation: { status: 'reviewed', score: 70, verdict: 'revise', hardErrors: [], issues: [] } }],
    rounds: [{ roundId: 'round-1', roundIndex: 1, candidateIds: ['candidate-1'], recommendedCandidateId: 'candidate-1', prompt: '1girl', negative: '' }],
    successfulRounds: 1, successfulRenders: 1, renderAttempts: 1, createdAt: 1, updatedAt: 2
  }]);
  const app = harness({ storage });
  const result = await app.orchestrator.resume({ jobId: 'job-duplicate' }, app.context);
  assert.equal(app.renders.length, 0);
  assert.equal(result.status, 'completed');
  assert.equal(result.stopReason, 'prompt_unchanged');
  assert(app.events.some(event => event.type === 'candidate.duplicate_blocked'));
});

test('automatic multi-image rounds revise from the round winner only', async () => {
  const app = harness({ settings: { generation: { autoRun: true, imagesPerRound: 2, maxAutoRounds: 2, maxRenderAttempts: 4, acceptScore: 90, minImprovement: 3 } }, renderPlan: [['img-1', 'img-2'], ['img-3', 'img-4']], reviewScores: [60, 78, 82, 94] });
  const result = await app.orchestrator.execute({ originalRequirements: 'two-image rounds', mode: 'create' }, app.context);
  assert.equal(result.status, 'completed');
  assert.equal(result.successfulRounds, 2);
  assert.equal(result.candidates.length, 4);
  assert.equal(result.rounds.length, 2);
  assert.deepEqual(result.rounds.map(round => round.candidateIds.length), [2, 2]);
  assert.equal(result.rounds[0].recommendedCandidateId, 'candidate-2');
  const revision = app.subagentCalls.find(call => call.name === 'generateTags' && call.input.operation === 'revise');
  assert.equal(revision.input.evaluation.candidateId, 'img-2');
  assert.equal(result.selectedCandidateId, 'candidate-4');
});

test('manual mode pauses after one round and resumes only with explicit feedback', async () => {
  const app = harness({ settings: { generation: { autoRun: false, imagesPerRound: 2, maxAutoRounds: 3, maxRenderAttempts: 5, acceptScore: 90, minImprovement: 3 } }, renderPlan: [['img-1', 'img-2'], ['img-3', 'img-4']], reviewScores: [65, 75, 85, 88] });
  const paused = await app.orchestrator.execute({ originalRequirements: 'manual portrait', mode: 'create' }, app.context);
  assert.equal(paused.status, 'awaiting_feedback');
  assert.equal(paused.successfulRounds, 1);
  assert.equal(paused.candidates.length, 2);
  assert.equal(app.subagentCalls.filter(call => call.name === 'generateTags' && call.input.operation === 'revise').length, 0);
  const continued = await app.orchestrator.resume({ jobId: paused.jobId, action: 'continue', baseCandidateId: 'candidate-2', feedback: '保留人物，改成更强的低视角' }, app.context);
  assert.equal(continued.status, 'awaiting_feedback');
  assert.equal(continued.successfulRounds, 2);
  assert.equal(continued.candidates.length, 4);
  const revision = app.subagentCalls.find(call => call.name === 'generateTags' && call.input.operation === 'revise');
  assert.equal(revision.input.evaluation.userFeedback, '保留人物，改成更强的低视角');
  assert.equal(revision.input.evaluation.candidateId, 'img-2');
});

test('final selection preempts an active render and discards its late artifact', async () => {
  let secondStarted;
  let resolveSecond;
  let renderCount = 0;
  let interrupts = 0;
  const started = new Promise(resolve => { secondStarted = resolve; });
  const app = harness({
    settings: { generation: { autoRun: true, imagesPerRound: 1, maxAutoRounds: 3, maxRenderAttempts: 5, acceptScore: 99, minImprovement: 0 } },
    renderCandidate: async payload => {
      renderCount += 1;
      if (renderCount === 1) return { artifacts: [{ imageId: 'img-1' }], parameters: { seed: 1 } };
      secondStarted();
      return new Promise(resolve => { resolveSecond = () => resolve({ artifacts: [{ imageId: 'late-image' }], parameters: { seed: 2 } }); });
    },
    reviewScores: [70],
    cancelRender: async () => { interrupts += 1; }
  });
  const pending = app.orchestrator.execute({ originalRequirements: 'long auto task' }, app.context);
  await started;
  const jobId = app.orchestrator.list()[0].jobId;
  const selected = await app.orchestrator.selectAndFinish(jobId, 'candidate-1', 'user');
  assert.equal(selected.status, 'completed');
  assert.equal(selected.selectedCandidateId, 'candidate-1');
  assert.equal(selected.stopReason, 'user_selected');
  assert.equal(interrupts, 1);
  resolveSecond();
  const completed = await pending;
  assert.equal(completed.status, 'completed');
  assert.equal(completed.selectedImageId, 'img-1');
  assert.deepEqual(completed.imageIds, ['img-1']);
  assert.equal(completed.candidates.some(candidate => candidate.imageId === 'late-image'), false);
  assert(app.events.some(event => event.type === 'generation.user_selected'));
});

test('selecting while awaiting manual feedback completes without another render', async () => {
  const app = harness({ settings: { generation: { autoRun: false, imagesPerRound: 1, maxAutoRounds: 3, maxRenderAttempts: 5 } }, reviewScores: [70] });
  const paused = await app.orchestrator.execute({ originalRequirements: 'manual' }, app.context);
  const selected = await app.orchestrator.selectAndFinish(paused.jobId, 'candidate-1', 'user');
  assert.equal(selected.status, 'completed');
  assert.equal(selected.selectedCandidateId, 'candidate-1');
  assert.equal(selected.successfulRounds, 1);
});

test('limit completion is best available and exposes bounded residual issues', async () => {
  const reviewRows = [
    { score: 72, observed: '姿势偏差', suggestedChange: '加强原图姿势' },
    { score: 68, observed: '背景缺失', suggestedChange: '恢复教堂背景' },
    { score: 78, observed: '视角不符', suggestedChange: '改成低视角' }
  ];
  const app = harness({
    settings: { generation: { strategy: 'fixed3', autoRun: true, maxAutoRounds: 3, maxRenderAttempts: 5, acceptScore: 90 } },
    runSubAgent: async (name, request) => {
      if (name === 'generateTags' && request.input.operation === 'compile') return ok({ positiveTags: ['1girl', 'church'] });
      if (name === 'generateTags') return ok({ add: [`revision ${4 - reviewRows.length}`], remove: [], preserve: [] });
      if (name === 'evaluateImages' && request.input.operation === 'review') {
        const row = reviewRows.shift();
        const issue = { expected: '匹配原图', observed: row.observed, severity: 'hard', suggestedChange: row.suggestedChange };
        return ok({ operation: 'review', evaluations: [{ candidateId: request.input.candidateImageIds[0], score: row.score, verdict: 'revise', hardErrors: [issue], issues: [issue], summary: row.observed }] });
      }
      if (name === 'evaluateImages') {
        const candidateId = request.input.candidateImageIds.includes('img-3') ? 'img-3' : request.input.candidateImageIds[0];
        return ok({ operation: 'compare', recommendedCandidateId: candidateId, ranking: request.input.candidateImageIds.map((id, index) => ({ candidateId: id, rank: index + 1, score: 70 + index, reason: 'best effort' })), reason: '达到上限后的最佳项' });
      }
      throw new Error(name);
    }
  });
  const result = await app.orchestrator.execute({ originalRequirements: '复刻构图', mode: 'create', strategy: 'fixed3' }, app.context);
  assert.equal(result.status, 'completed');
  assert.equal(result.outcome, 'best_available');
  assert.equal(result.selectedCandidateId, 'candidate-3');
  assert.equal(result.residualIssues.length, 1);
  assert.equal(result.residualIssues[0].observed, '视角不符');
  assert.equal(result.residualIssues[0].severity, 'hard');
});

test('user selection with hard errors has an explicit delivery outcome', async () => {
  const issue = { expected: '双手完整', observed: '手部畸形', severity: 'hard', suggestedChange: '修复手部' };
  const app = harness({
    settings: { generation: { autoRun: false, imagesPerRound: 1, maxAutoRounds: 3 } },
    runSubAgent: async (name, request) => {
      if (name === 'generateTags') return ok({ positiveTags: ['1girl'] });
      if (name === 'evaluateImages' && request.input.operation === 'review') return ok({ operation: 'review', evaluations: [{ candidateId: request.input.candidateImageIds[0], score: 66, verdict: 'reject', hardErrors: [issue], issues: [], summary: '手部需要修复' }] });
      throw new Error(name);
    }
  });
  const paused = await app.orchestrator.execute({ originalRequirements: 'portrait', mode: 'create', autoRun: false }, app.context);
  const selected = await app.orchestrator.selectAndFinish(paused.jobId, 'candidate-1', 'user');
  assert.equal(selected.outcome, 'user_selected_with_issues');
  assert.equal(selected.residualIssues[0].observed, '手部畸形');
});

test('exhausting render attempts exposes a failed outcome', async () => {
  const app = harness({
    settings: { generation: { autoRun: true, maxAutoRounds: 1, maxRenderAttempts: 2 } },
    renderPlan: [error('COMFY_FAILED', 'first failure'), error('COMFY_FAILED', 'second failure')]
  });
  const result = await app.orchestrator.execute({ originalRequirements: 'portrait', mode: 'create' }, app.context);
  assert.equal(result.status, 'failed');
  assert.equal(result.outcome, 'failed');
});

test('public generation result is compact while the UI snapshot retains full evaluations', async () => {
  const longText = '详细评价'.repeat(1800);
  const app = harness({
    settings: { generation: { autoRun: true, maxAutoRounds: 1, maxRenderAttempts: 2, acceptScore: 90 } },
    runSubAgent: async (name, request) => {
      if (name === 'generateTags') return ok({ positiveTags: ['1girl', 'blue hair'], negativeTags: ['lowres'] });
      if (name === 'evaluateImages') return ok({ operation: 'review', evaluations: [{ candidateId: request.input.candidateImageIds[0], score: 92, verdict: 'accept', hardErrors: [], issues: [], summary: longText }] });
      throw new Error(name);
    }
  });
  const completed = await app.orchestrator.execute({ originalRequirements: 'blue-haired portrait', mode: 'create' }, app.context);
  const local = app.orchestrator.uiSnapshot(completed.jobId);
  const compact = app.orchestrator.publicResult(completed.jobId);
  assert.equal(local.candidates[0].evaluation.summary, longText);
  assert.equal(compact.selected.prompt, '1girl, blue hair');
  assert.equal(compact.selected.negative, 'lowres');
  assert.equal(compact.candidates[0].evaluation, undefined);
  assert.equal(compact.comparison, undefined);
  assert.equal(compact.artifacts, undefined);
  assert(Buffer.byteLength(JSON.stringify(compact)) < 5000);
});
