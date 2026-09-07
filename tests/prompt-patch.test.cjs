'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyPromptPatch } = require('../src/modules/prompt-patch');

test('patch preserve is scoped to one patch while locked tags remain permanent', () => {
  const first = applyPromptPatch({ positiveTags: ['blue hair', 'hand on own knee'], negativeTags: [], lockedTags: ['blue hair'] }, {
    remove: ['blue hair', 'hand on own knee'], preserve: ['hand on own knee'], add: []
  });
  assert.equal(first.ok, true);
  assert.deepEqual(first.positiveTags, ['blue hair', 'hand on own knee']);
  const second = applyPromptPatch(first, { remove: ['hand on own knee'], add: ['both hands holding bottle'], preserve: [] });
  assert.equal(second.ok, true);
  assert.deepEqual(second.positiveTags, ['blue hair', 'both hands holding bottle']);
  assert.deepEqual(second.lockedTags, ['blue hair']);
});

test('same-patch and semantic conflicts are rejected before submission', () => {
  const same = applyPromptPatch({ positiveTags: ['sitting'] }, { add: ['standing'], remove: ['standing'] });
  assert.equal(same.ok, false);
  assert(same.rejected.some(item => item.code === 'ADD_REMOVE_CONFLICT'));
  const semantic = applyPromptPatch({ positiveTags: ['from above'] }, { add: ['from below'], remove: [] });
  assert.equal(semantic.ok, false);
  assert(same.positiveTags.includes('sitting'));
  assert(semantic.rejected.some(item => item.code === 'SEMANTIC_CONFLICT'));
});

test('natural-language negative commands never enter positive tags', () => {
  const negative = applyPromptPatch({ positiveTags: ['indoors'], negativeTags: [] }, { add: ['remove wooden furniture'] }, { negativeEnabled: true });
  assert.equal(negative.ok, true);
  assert.deepEqual(negative.positiveTags, ['indoors']);
  assert.deepEqual(negative.negativeTags, ['wooden furniture']);
  const alternative = applyPromptPatch({ positiveTags: ['indoors'], negativeTags: [] }, { add: ['no wooden furniture'] }, { negativeEnabled: false, positiveAlternatives: { 'wooden furniture': ['empty tiled interior', 'clean background'] } });
  assert.deepEqual(alternative.positiveTags, ['indoors', 'empty tiled interior', 'clean background']);
  const rejected = applyPromptPatch({ positiveTags: ['indoors'] }, { add: ['do not draw furniture'] }, { negativeEnabled: false });
  assert.equal(rejected.ok, false);
  assert(rejected.rejected.some(item => item.code === 'POSITIVE_NEGATION'));
});

test('confirmed no-prefix dictionary tags remain valid and invalid removals are warnings', () => {
  const result = applyPromptPatch({ positiveTags: ['scenery'], negativeTags: [] }, { add: ['no humans'], remove: ['missing tag'] }, { allowedPositiveNegations: ['no humans'] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.positiveTags, ['scenery', 'no humans']);
  assert(result.warnings.some(item => item.code === 'REMOVE_MISSING'));
});

