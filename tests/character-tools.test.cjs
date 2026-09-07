'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTags } = require('../src/modules/tags');
const { createCharacters } = require('../src/modules/characters');
const { createPrimaryTools } = require('../src/modules/primary-tools');
const { createFixedSubagents } = require('../src/modules/fixed-subagents');
const { createPrimaryAgent } = require('../src/modules/primary-agent');

function setup() {
  const tags = createTags({ sources: { base: [['blue hair', '蓝发', '', 'hair', '颜色', 0], ['alice', '爱丽丝', '', 'character', '角色名', 0]] } });
  const characters = createCharacters({ tags, data: { characters: [{ id: 'alice', seriesId: 'story', tagIds: ['blue hair'], specificTagIds: ['specific:uniform'] }], specificTags: [{ id: 'specific:uniform', en: 'story academy uniform' }], manifest: {} } });
  return { tags, characters };
}

test('AI retrieves hidden words only through the character result with bounded schemas', async () => {
  const { tags, characters } = setup();
  const tools = createPrimaryTools({ tags, characters });
  const found = await tools.call('characters.search', { query: '爱丽丝' });
  assert.equal(found.ok, true, JSON.stringify(found));
  assert.equal(found.data.items[0].specificTags[0].en, 'story academy uniform');
  assert.equal((await tools.call('tags.search', { query: 'story academy uniform' })).data.items.length, 0);
  assert.equal(tools.names().some(name => /specific/.test(name)), false);
  assert.equal((await tools.call('characters.search', { query: 'a', limit: 11 })).error.code, 'INVALID_INPUT');
});

test('tag search reserves empty attached data and fills it for character matches', async () => {
  const { tags, characters } = setup();
  const tools = createPrimaryTools({ tags, characters });
  const ordinary = await tools.call('tags.search', { query: 'blue hair' });
  assert.deepEqual(ordinary.data.items[0].attachedData, {});

  const role = await tools.call('tags.search', { query: '爱丽丝', includeAdult: true });
  assert.equal(role.ok, true, JSON.stringify(role));
  assert.deepEqual(role.data.items[0].attachedData, {
    type: 'character',
    characterId: 'alice',
    series: 'story',
    identityTags: ['alice', 'story'],
    appearanceTags: ['blue hair', 'story academy uniform']
  });
});

test('role IDs resolve into attributed references before the generation subagent sees them', async () => {
  const { tags, characters } = setup();
  let messages;
  const subagents = createFixedSubagents({ visionAI: { complete: async input => { messages = input; return { positiveTags: ['alice', 'white dress'] }; } }, prompts: { generateTags: '既有规则' } });
  const tools = createPrimaryTools({ tags, characters, runtime: { runSubAgent: (name, { input }) => subagents.resolve(name).run(input) } });
  const result = await tools.call('agent.generateTags', { requirements: '爱丽丝穿白裙', characterIds: ['alice'] });
  assert.equal(result.ok, true, JSON.stringify(result));
  const text = messages[1].content[0].text;
  assert.match(text, /"id":"alice"/);
  assert.match(text, /story academy uniform/);
  assert.match(text, /blue hair/);
  assert.match(messages[0].content, /用户.*优先/);
  assert.equal((await tools.call('agent.generateTags', { requirements: 'x', characterIds: ['missing'] })).error.code, 'CHARACTER_NOT_FOUND');
  assert.equal((await tools.call('agent.generateTags', { requirements: 'x', characterReferences: [] })).error.code, 'INVALID_INPUT');
});

test('stored primary prompt receives the character contract without modifying the saved text', () => {
  const prompts = { composePrimary: () => '我的自定义提示词：请调用 comfy.render' };
  const primary = createPrimaryAgent({ prompts, charactersEnabled: true });
  assert.match(primary.getPrompt(), /characters.search/);
  assert.match(primary.getPrompt(), /characterIds/);
  assert.match(primary.getPrompt(), /不确定.*Tag.*tags.search/);
  assert.match(primary.getPrompt(), /attachedData/);
  assert.match(primary.getPrompt(), /generation\.execute/);
  assert.match(primary.getPrompt(), /优先于上方.*不要调用.*comfy\.render/s);
  assert.match(primary.getPrompt(), /绘图.*禁止.*vision\.processOne/s);
  assert.match(primary.getPrompt(), /用户原始要求.*原样/);
  assert(primary.getPrompt().lastIndexOf('generation.execute') > primary.getPrompt().indexOf('comfy.render'));
  assert.equal(prompts.composePrimary(), '我的自定义提示词：请调用 comfy.render');
});
