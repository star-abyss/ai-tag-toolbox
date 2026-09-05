'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const modules = require('../src/modules');

test('fixed prompt bundle exports and imports four internal slots plus external text', () => {
  const prompts = modules.createPrompts({ dir: require('node:path').resolve('assets/提示词素材'), storage: modules.createStorage({ prefix: `prompt-contract-${Date.now()}` }) });
  prompts.set('primary', 'primary override');
  const external = prompts.createCustom({ name: 'Style notes', text: 'cinematic lighting' });
  prompts.setEnabled('translation', false);
  const bundle = prompts.exportBundle();
  assert.equal(bundle.format, 'ai-tag-prompts');
  assert.deepEqual(Object.keys(bundle.internal).sort(), ['generateTags', 'primary', 'translation', 'vision']);
  assert.equal(bundle.internal.primary.text, 'primary override');
  assert.equal(bundle.internal.translation.enabled, false);
  assert.equal(bundle.external[0].id, external.id);

  const restored = modules.createPrompts({ dir: require('node:path').resolve('assets/提示词素材'), storage: modules.createStorage({ prefix: `prompt-contract-restored-${Date.now()}` }) });
  restored.importBundle(bundle);
  assert.equal(restored.get('primary'), 'primary override');
  assert.equal(restored.enabled('translation'), false);
  assert.equal(restored.item(external.id).text, 'cinematic lighting');
});

console.log('prompts-contract: ok');
