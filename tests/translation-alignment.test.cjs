'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSourceUnits, segmentSourceText, normalizeAlignment, parseTranslationPayload } = require('../src/modules/translation-alignment');
const { createFixedSubagents } = require('../src/modules/fixed-subagents');
const { createAgentRuntime } = require('../src/modules/agent-runtime');
const { createAiClient } = require('../src/modules/ai-client');

test('translation HTTP requests disable thinking and do not relay provider reasoning to the page', async t => {
  let body;
  t.mock.method(globalThis, 'fetch', async (_url, request) => {
    body = JSON.parse(request.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"text":"蓝发"}', reasoning_content: 'provider reasoning' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const client = createAiClient({ base: 'https://example.test/v1', model: 'translation-test' });
  const events = [];
  const runtime = createAgentRuntime({ subagents: createFixedSubagents({ ai: client }) });
  const result = await runtime.runSubAgent('translation', { input: { text: 'blue_hair', source: 'ai' }, onEvent: event => events.push(event) });
  assert.equal(result.ok, true);
  assert.equal(result.data.text, '蓝发');
  assert.equal(body.stream, false);
  assert.equal(body.reasoning_effort, 'none');
  assert.equal(body.enable_thinking, false);
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(events.some(event => event.type === 'delta' || event.reasoning), false, 'translation should return results without streaming or reasoning events');
});

test('tag units preserve parentheses, weights, duplicate occurrences and UTF-16 positions', () => {
  const source = ' blue_hair, (red_eyes:1.2), blue_hair, (hat, bow:1.1)';
  const units = buildSourceUnits(source);
  assert.deepEqual(units.map(x => x.text), ['blue_hair', '(red_eyes:1.2)', 'blue_hair', '(hat, bow:1.1)']);
  assert.deepEqual(units.map(x => x.id), ['s1', 's2', 's3', 's4']);
  assert.equal(units[0].start, 1);
  assert.equal(units[2].start, 28);
  for (const unit of units) assert.equal(source.slice(unit.start, unit.end), unit.text);
  const mixed = '🙂 She has blue hair. 她有蓝色长发。';
  const words = buildSourceUnits(mixed);
  assert(words.length > 3);
  assert(words.some(x => x.text === 'She' && x.start === 3));
  for (const unit of words) assert.equal(mixed.slice(unit.start, unit.end), unit.text);
});

test('long text coarsens segmentation instead of truncating the last part', () => {
  const input = 'She has long blue hair. '.repeat(400) + 'Last sentence.';
  const value = segmentSourceText(input);
  assert(value.sourceUnits.length <= 256);
  assert(['sentence', 'block'].includes(value.granularity));
  assert(value.sourceUnits.at(-1).text.includes('Last sentence.'));
});

test('alignment supports reordered, repeated and many-to-many IDs without losing unlinked text', () => {
  const sourceUnits = buildSourceUnits('蓝发，长发，蓝发');
  const value = normalizeAlignment({ targetSegments: [
    { text: 'hair', sourceIds: ['s1', 's2'] },
    { text: ' blue', sourceIds: ['s3'] },
    { text: '.', sourceIds: ['invented'] }
  ] }, sourceUnits, 'hair blue.');
  assert.deepEqual(value.sourceUnits, sourceUnits);
  assert.deepEqual(value.targetSegments, [
    { text: 'hair', sourceIds: ['s1', 's2'] },
    { text: ' blue', sourceIds: ['s3'] },
    { text: '.', sourceIds: [] }
  ]);
  assert.equal(normalizeAlignment({ targetSegments: [{ text: 'different', sourceIds: ['s1'] }] }, sourceUnits, 'actual'), null);
  assert.equal(normalizeAlignment({ targetSegments: [{ text: 'a  b', sourceIds: ['s1'] }] }, sourceUnits, 'a b'), null);
});

test('alignment restores omitted separators as unlinked target segments', () => {
  const sourceUnits = buildSourceUnits('masterpiece, best quality, blue hair');
  const value = normalizeAlignment({ targetSegments: [
    { text: '杰作', sourceIds: ['s1'] },
    { text: '最高质量', sourceIds: ['s2'] },
    { text: '蓝发', sourceIds: ['s3'] }
  ] }, sourceUnits, '杰作，最高质量，蓝发');
  assert.ok(value, 'omitted commas should not discard the supplied word links');
  assert.deepEqual(value.targetSegments, [
    { text: '杰作', sourceIds: ['s1'] },
    { text: '，', sourceIds: [] },
    { text: '最高质量', sourceIds: ['s2'] },
    { text: '，', sourceIds: [] },
    { text: '蓝发', sourceIds: ['s3'] }
  ]);
  assert.deepEqual(normalizeAlignment(value, sourceUnits, '杰作，最高质量，蓝发'), value, 'normalizing again in the renderer keeps repaired mappings');
});

test('separator recovery keeps duplicate occurrences and reordered IDs without changing the translation', () => {
  const units = buildSourceUnits('blue_hair, long_hair, blue_hair');
  const translated = '「长发」； 蓝发\n蓝发。';
  const value = normalizeAlignment({ targetSegments: [
    { text: '长发', sourceIds: ['s2'] }, { text: '蓝发', sourceIds: ['s1'] }, { text: '蓝发', sourceIds: ['s3'] }
  ] }, units, translated);
  assert.ok(value);
  assert.equal(value.targetSegments.map(part => part.text).join(''), translated);
  assert.deepEqual(value.targetSegments.filter(part => part.sourceIds.length).map(part => part.sourceIds), [['s2'], ['s1'], ['s3']]);
});

test('separator recovery rejects omitted meaning, mismatched words and too many expanded segments', () => {
  const units = buildSourceUnits('blue_hair');
  for (const translated of ['no blue hair', 'blue hair and a hat', 'blue hair blue hair', 'blue eyes']) {
    assert.equal(normalizeAlignment({ targetSegments: [{ text: 'blue hair', sourceIds: ['s1'] }] }, units, translated), null);
  }
  const segments = Array.from({ length: 512 }, () => ({ text: 'a', sourceIds: ['s1'] }));
  assert.equal(normalizeAlignment({ targetSegments: segments }, units, segments.map(part => part.text).join(', ')), null, 'repaired results must still obey the shared segment limit');
});

test('provider envelopes and bad alignment preserve translation text exactly', () => {
  const units = buildSourceUnits('蓝发');
  const body = { text: 'blue hair\n', direction: 'zh-en', targetSegments: [{ text: 'blue hair\n', sourceIds: ['s1'] }] };
  for (const input of [body, JSON.stringify(body), { text: JSON.stringify(body) }, { choices: [{ message: { content: JSON.stringify(body) } }] }, { ok: true, data: { text: JSON.stringify(body) } }]) {
    const value = parseTranslationPayload(input, units);
    assert.equal(value.text, 'blue hair\n');
    assert.deepEqual(value.alignment.targetSegments[0].sourceIds, ['s1']);
  }
  for (const targetSegments of [null, 'invalid', [{ text: 123 }], [{ text: 'other', sourceIds: ['s1'] }], Array(513).fill({ text: 'a', sourceIds: ['s1'] })]) {
    const value = parseTranslationPayload({ text: 'blue hair', targetSegments }, units);
    assert.equal(value.text, 'blue hair'); assert.equal(value.alignment, null);
  }
  assert.equal(parseTranslationPayload('plain translation', units).text, 'plain translation');
});

test('AI translation request supplies source IDs and explicit direction; optional alignment survives the runtime', async () => {
  let request;
  const subagents = createFixedSubagents({ ai: { complete: async messages => {
    request = messages;
    return { text: '{"text":"蓝发，红眼","direction":"en-zh","targetSegments":[{"text":"蓝发","sourceIds":["s1"]},{"text":"，","sourceIds":[]},{"text":"红眼","sourceIds":["s2"]}]}', usage: { total_tokens: 10 } };
  } } });
  const runtime = createAgentRuntime({ subagents });
  const result = await runtime.runSubAgent('translation', { input: { text: 'blue_hair, red_eyes', direction: 'en-zh', source: 'ai', includeAlignment: true } });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const input = JSON.parse(request[1].content);
  assert.equal(input.direction, 'en-zh');
  assert.deepEqual(input.sourceUnits, [{ id: 's1', text: 'blue_hair' }, { id: 's2', text: 'red_eyes' }]);
  assert.equal(result.data.text, '蓝发，红眼');
  assert.equal(result.data.alignment.sourceUnits[1].start, 11);
  assert.equal(result.usage.total_tokens, 10);
});
