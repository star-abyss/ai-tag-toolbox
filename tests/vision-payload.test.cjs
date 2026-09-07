'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVisionPayload, compactVisionResult } = require('../src/modules/vision-payload');

test('parses fenced and nested Vision JSON into one structured blueprint', () => {
  const parsed = parseVisionPayload({
    text: '```json\n{"tags":["church","from below"],"description":"教堂中的低视角人物","pose":"sitting","viewpoint":"from below","mustPreserve":["pose","scene"]}\n```',
    metadata: { workflow: { huge: true } }
  });
  assert.deepEqual(parsed.tags, ['church', 'from below']);
  assert.equal(parsed.description, '教堂中的低视角人物');
  assert.equal(parsed.pose, 'sitting');
  assert.deepEqual(parsed.mustPreserve, ['pose', 'scene']);
  assert.doesNotMatch(parsed.description, /^\s*\{/);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'metadata'), false);
});

test('plain Vision text becomes a bounded description without JSON nesting', () => {
  const parsed = parseVisionPayload('low-angle portrait in a church');
  assert.equal(parsed.description, 'low-angle portrait in a church');
  assert.deepEqual(parsed.tags, []);
  assert.equal(parsed.parseMode, 'text');
});

test('compact public Vision result drops metadata, workflow and verbose analysis', () => {
  const compact = compactVisionResult({
    imageId: 'img-1', mode: 'ai', model: 'vision-model',
    text: '{"tags":["church"],"description":"church scene"}',
    metadata: { workflow: { nodes: 'x'.repeat(10000) }, prompt: 'large' },
    builtinTags: [{ tag: '1girl', confidence: 1 }],
    modelTags: [{ tag: 'church', confidence: 0.9 }],
    reasoning: 'hidden'
  });
  assert.deepEqual(compact, {
    imageId: 'img-1', mode: 'ai', model: 'vision-model', description: 'church scene',
    tags: ['church'], builtinTags: ['1girl'], hasBuiltinTags: true
  });
  assert(Buffer.byteLength(JSON.stringify(compact)) < 1000);
});

