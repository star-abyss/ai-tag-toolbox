'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'));
const normalize = value => String(value).trim().toLowerCase().replaceAll('_', ' ').replace(/\s+/g, ' ');

test('generated character catalogue keeps every featured source row and resolves every derived reference', () => {
  const characters = readJson('assets', '数据资产', '角色', 'characters.json');
  const general = readJson('assets', '数据资产', '标签', 'character-general-tags.json');
  const specific = readJson('assets', '数据资产', '角色', 'specific-tags.json');
  const manifest = readJson('assets', '数据资产', '角色', 'manifest.json');
  const decisions = readJson('assets', '数据资产', '角色', 'word-decisions.json');

  assert.equal(characters.length, 33599);
  assert.equal(new Set(characters.map(item => item.id)).size, characters.length);
  assert.equal(manifest.counts.characters, characters.length);
  assert.equal(manifest.counts.generalAdditions, general.length);
  assert.equal(manifest.counts.specificTerms, specific.length);
  assert.equal(manifest.counts.series, new Set(characters.map(item => item.seriesId).filter(Boolean)).size);
  assert.match(manifest.sourceSha256, /^[0-9a-f]{64}$/);
  assert.equal(manifest.source.kind, 'upstream-not-live-export');

  const generalIds = new Set(general.map(item => item.en.toLowerCase()));
  const specificIds = new Set(specific.map(item => item.id));
  assert.equal(generalIds.size, general.length);
  assert.equal(specificIds.size, specific.length);
  for (const character of characters) {
    assert.equal(Array.isArray(character.tagIds), true);
    assert.equal(Array.isArray(character.specificTagIds), true);
    assert.equal(new Set(character.tagIds).size, character.tagIds.length);
    assert.equal(new Set(character.specificTagIds).size, character.specificTagIds.length);
    assert(character.specificTagIds.every(id => specificIds.has(id)), `${character.id} has an unresolved specific tag`);
  }
  assert.equal(decisions.length, 1031);
  assert(decisions.every(item => item.decision === 'general' || item.decision === 'specific'));
  const miku = characters.find(item => item.id === 'hatsune_miku');
  assert(miku.tagIds.includes('long hair'));
  assert.equal(miku.tagIds.includes('long_hair'), false);
});

test('curation promotes common visual terms but keeps named and unsafe alias candidates hidden', () => {
  const general = readJson('assets', '数据资产', '标签', 'character-general-tags.json');
  const specific = readJson('assets', '数据资产', '角色', 'specific-tags.json');
  const decisions = readJson('assets', '数据资产', '角色', 'word-decisions.json');
  const generalByTerm = new Map(general.map(item => [normalize(item.en), item]));
  const specificTerms = new Set(specific.map(item => normalize(item.en)));
  const decisionByTerm = new Map(decisions.map(item => [normalize(item.en), item]));

  assert.equal(generalByTerm.get('light green hair').zh, '浅绿色头发');
  assert.equal(generalByTerm.get('braided sidelock').category, 'hair');
  for (const term of ['kibina high school uniform', 'team galactic', 'shield module', 'hands', 'head', 'oil']) {
    assert.equal(specificTerms.has(term), true, `${term} must stay out of the ordinary tag index`);
    assert.equal(decisionByTerm.get(term).decision, 'specific');
  }
  for (const term of ['hands', 'head', 'oil']) assert.equal(decisionByTerm.get(term).review, true);
});

test('generated files contain no image or browsing URL metadata', () => {
  for (const relative of [
    ['assets', '数据资产', '角色', 'characters.json'],
    ['assets', '数据资产', '角色', 'specific-tags.json'],
    ['assets', '数据资产', '标签', 'character-general-tags.json']
  ]) {
    const text = fs.readFileSync(path.join(root, ...relative), 'utf8');
    assert.doesNotMatch(text, /https?:\/\//i);
    assert.doesNotMatch(text, /"(?:image|thumbnail|url)"\s*:/i);
  }
});
