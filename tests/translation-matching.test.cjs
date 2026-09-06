'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTranslation, buildReference } = require('../src/modules/translation');

const catalog = [
  { id: 'hand', en: 'hand', zh: '手', aliases: [], category: 'body', nsfw: false },
  { id: 'handshake', en: 'handshake', zh: '握手', aliases: [], category: 'pose', nsfw: false },
  { id: 'blue_hair', en: 'blue_hair', zh: '蓝发', aliases: ['蓝色头发'], category: 'hair', nsfw: false },
  { id: 'blue_eyes', en: 'blue_eyes', zh: '蓝眼', aliases: [], category: 'eyes', nsfw: false }
];

test('translation references use exact dictionary entries and confirmed aliases only', () => {
  const exactChinese = buildReference('蓝色头发', { direction: 'zh-en', catalog });
  assert.deepEqual(exactChinese.map(row => row.en), ['blue_hair']);
  assert.equal(buildReference('手套', { direction: 'zh-en', catalog }).length, 0);
  assert.equal(buildReference('blue', { direction: 'en-zh', catalog }).length, 0);
  assert.deepEqual(buildReference('blue_hair', { direction: 'en-zh', catalog }).map(row => row.en), ['blue_hair']);
});

test('translation module keeps exact references and reports the match source', () => {
  const translation = createTranslation({ tags: catalog });
  const result = translation.buildReference('蓝发', { direction: 'zh-en' });
  assert.equal(result.length, 1);
  assert.equal(result[0].matchType, '中文精确 Tag');
  assert.deepEqual(translation.findReferences('手套', { direction: 'zh-en' }), []);
  assert.equal(translation.translateLocal('蓝发', 'zh-en').text, 'blue_hair');
});

test('translation reference buttons expose the conservative match source', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'app-view.js'), 'utf8');
  assert.match(source, /ref\.matchType/);
  assert.doesNotMatch(source, /中文命中/);
});
