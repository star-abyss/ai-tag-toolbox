'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTags } = require('../src/modules/tags');
const { createCharacters } = require('../src/modules/characters');

function fixture() {
  const tags = createTags({ sources: { base: [
    ['blue hair', '蓝发', '', 'hair', '颜色', 0],
    ['adult_test', '分级测试', '', 'nsfw', '其他', 1],
    ['alice_(story)', '爱丽丝', '小爱', 'character', '角色名', 0],
    ['legacy_hero', '旧角色', '', 'character', '角色名', 0]
  ] } });
  const state = new Map();
  const storage = { get: (k, d) => state.get(k) ?? d, set: (k, v) => state.set(k, structuredClone(v)) };
  const data = {
    manifest: { source: { kind: 'upstream-not-live-export' } },
    characters: [{ id: 'alice_(story)', seriesId: 'story', trigger: 'alice (story), story', count: 9, tagIds: ['blue hair', 'adult_test'], specificTagIds: ['specific:academy', 'specific:adult'] },
      { id: 'alice_(other)', seriesId: 'other', trigger: 'alice (other), other', tagIds: [], specificTagIds: [], count: 1 }],
    specificTags: [{ id: 'specific:academy', en: 'story academy uniform', zh: '', nsfw: false }, { id: 'specific:adult', en: 'adult reference', nsfw: true }]
  };
  return { tags, storage, data, chars: createCharacters({ tags, storage, data }) };
}

test('character query resolves names and hidden references without adding them to ordinary tags', () => {
  const { chars, tags } = fixture();
  assert.equal(chars.page({ query: '爱丽丝', precision: 'exact' }).items[0].id, 'alice_(story)');
  assert.equal(chars.page({ query: '小爱' }).total, 1);
  assert.equal(chars.page({ query: 'alice' }).total, 2);
  assert.equal(chars.page({ query: 'alice', seriesId: 'story' }).total, 1);
  assert.equal(chars.page({ query: 'story academy uniform' }).total, 0);
  assert.deepEqual(chars.get('alice_(story)').generalTags.map(t => t.en), ['blue hair']);
  assert.deepEqual(chars.get('alice_(story)').specificTags.map(t => t.en), ['story academy uniform']);
  assert.equal(chars.get('alice_(story)', { includeAdult: true }).generalTags.length, 2);
  assert.equal(tags.search('story academy uniform', { includeAdult: true }).length, 0);
  assert.equal(chars.get('legacy_hero').hasFeatures, false);
  assert.equal(chars.get('unknown'), null);
});

test('character selections restore separately and obey adult visibility without changing manual tags', () => {
  const { chars, tags, storage, data } = fixture();
  tags.select('blue hair');
  chars.select('alice_(story)', { generalTagIds: ['blue hair', 'not real', 'adult_test'], specificTagIds: ['specific:academy', 'specific:adult'], includeSeries: true });
  assert.deepEqual(chars.selected()[0].tags, ['alice \\(story\\)', 'story', 'blue hair', 'story academy uniform']);
  const restored = createCharacters({ tags, storage, data });
  assert.deepEqual(restored.selected(), chars.selected());
  chars.removeSelection('alice_(story)');
  assert.deepEqual(tags.selected().map(t => t.id), ['blue hair']);
  chars.select('alice_(story)', { generalTagIds: ['adult_test'], includeAdult: true, includeSeries: false });
  assert.equal(chars.selectionText().includes('adult_test'), false);
  assert.equal(chars.selectionText({ includeAdult: true }).includes('adult_test'), true);
  chars.clearSelection();
  assert.equal(chars.selected().length, 0);
});

test('all role pages are reachable and scoped searches do not drop the series filter', () => {
  const { tags } = fixture();
  const characters = Array.from({ length: 1203 }, (_, i) => ({ id: 'hero_' + i, seriesId: 'a', trigger: 'hero ' + i + ', a', tagIds: [], specificTagIds: [] }));
  const chars = createCharacters({ tags, data: { characters, specificTags: [], manifest: {} } });
  const page = chars.page({ query: 'hero', seriesId: 'a', offset: 1200, limit: 50 });
  assert.equal(page.total, 1203);
  assert.equal(page.items.length, 3);
  assert.equal(page.hasMore, false);
  assert.equal(chars.page({ query: 'hero', seriesId: 'absent' }).total, 0);
  assert.equal(chars.series({ query: 'a' }).find(s => s.id === 'a').count, 1203);
});

test('character data is loaded on demand and fails without silently returning an empty library', () => {
  const { tags } = fixture();
  const chars = createCharacters({ tags, dataDir: '/not-a-real-role-directory' });
  assert.throws(() => chars.page({}), /角色资料|character/i);
});
