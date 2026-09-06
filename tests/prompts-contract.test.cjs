'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const modules = require('../src/modules');
const assetDir = path.resolve('assets/提示词素材');
const fresh = () => modules.createPrompts({ dir: assetDir, storage: modules.createStorage({ prefix: 'prompt-contract-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) }) });

test('main prompt sets: fixed 5-item structure, batch switch, per-item editing', () => {
  const prompts = fresh();
  assert.deepEqual(prompts.keys(), ['primary', 'generateTags', 'artistQuality', 'vision', 'translation']);
  assert.equal(prompts.sets().length, 1);
  assert.equal(prompts.sets()[0].id, 'prompt-set-default');
  assert.equal(prompts.activeSetId(), 'prompt-set-default');
  assert.equal(prompts.item('generateTags').builtin, true);

  // 条目内容可以单独编辑，只影响当前提示词组。
  prompts.set('primary', 'primary override');
  assert.equal(prompts.get('primary'), 'primary override');
  assert.equal(prompts.getEffective('primary'), 'primary override');

  // 新建提示词组：自动创建 5 个空白条目，且不自动切换。
  const set = prompts.createSet({ name: '实验配置' });
  assert.equal(prompts.sets().length, 2);
  for (const key of prompts.keys()) assert.equal(set.items[key], '');
  assert.equal(prompts.activeSetId(), 'prompt-set-default');

  // 批量切换：5 个条目整体切换。
  prompts.setActive(set.id);
  assert.equal(prompts.get('primary'), '');
  prompts.set('primary', 'experiment primary');
  prompts.set('translation', 'experiment translation');
  prompts.setActive('prompt-set-default');
  assert.equal(prompts.get('primary'), 'primary override');
  assert.equal(prompts.get('translation'), prompts.getDefault('translation'));
  prompts.setActive(set.id);
  assert.equal(prompts.get('primary'), 'experiment primary');
  assert.equal(prompts.get('translation'), 'experiment translation');

  // 删除提示词组后回落到剩余第一组；最后一个提示词组不允许删除。
  assert.equal(prompts.deleteSet(set.id), true);
  assert.equal(prompts.sets().length, 1);
  assert.equal(prompts.activeSetId(), 'prompt-set-default');
  assert.equal(prompts.deleteSet('prompt-set-default'), false);
  assert.equal(prompts.sets().length, 1);
});

test('extension prompts: create/edit/delete, always and keyword matching, only into primary', () => {
  const prompts = fresh();
  const always = prompts.createExtension({ name: '个人画风偏好', text: '优先使用偏暖色调', activation: { mode: 'always' } });
  const keyword = prompts.createExtension({ name: '角色替换规则', text: '把角色 A 替换成 B', activation: { mode: 'keywords', keywords: ['角色替换', '换角色'] } });
  assert.equal(always.activation.mode, 'always');
  assert.equal(keyword.activation.mode, 'keywords');
  assert.deepEqual(keyword.activation.keywords, ['角色替换', '换角色']);

  // 系统匹配：常驻总是发送，关键词只有命中才发送。
  assert.deepEqual(prompts.matchExtensions('帮我生成一张图').map(row => row.id), [always.id]);
  assert.deepEqual(prompts.matchExtensions('做角色替换').map(row => row.id), [always.id, keyword.id]);
  assert.deepEqual(prompts.matchExtensions('换角色吧').map(row => row.id), [always.id, keyword.id]);
  assert.deepEqual(prompts.matchExtensions('画一只猫'), [].concat(prompts.matchExtensions('画一只猫')));

  const composed = prompts.composePrimary('做角色替换');
  assert(composed.includes('优先使用偏暖色调'));
  assert(composed.includes('把角色 A 替换成 B'));
  assert(composed.includes('【主 AI 提示词｜高优先级，始终优先】'));
  assert(composed.indexOf('优先使用偏暖色调') < composed.indexOf('主 AI 提示词'));
  assert(!prompts.composePrimary('纯绘图').includes('把角色 A 替换成 B'));

  // 停用后不再进入任何请求；删除后从列表移除。
  prompts.updateExtension(keyword.id, { enabled: false });
  assert.deepEqual(prompts.matchExtensions('做角色替换').map(row => row.id), [always.id]);
  assert.equal(prompts.deleteExtension(always.id), true);
  assert.equal(prompts.extensions().length, 1);

  // 文生图组合 = 文生图提示词 + 画师与品质词参考提示词。
  const generated = prompts.composeGenerate();
  assert(generated.includes(prompts.get('generateTags')));
  assert(generated.includes(prompts.get('artistQuality')));
});

test('bundle v2 round-trips all sets and extensions; single set import appends', () => {
  const prompts = fresh();
  prompts.set('primary', 'set 1 primary');
  const second = prompts.createSet({ name: '实验配置' });
  prompts.setActive(second.id);
  prompts.set('vision', 'set 2 vision');
  prompts.createExtension({ name: '规则', text: '规则文本', activation: { mode: 'keywords', keywords: ['规则'] } });
  const bundle = prompts.exportBundle();
  assert.equal(bundle.format, 'ai-tag-prompts');
  assert.equal(bundle.version, 2);
  assert.equal(bundle.sets.length, 2);

  const restored = fresh();
  const result = restored.importBundle(bundle);
  assert.equal(result.sets.length, 2);
  assert.equal(restored.activeSetId(), second.id);
  assert.equal(restored.sets().find(row => row.id === 'prompt-set-default').items.primary, 'set 1 primary');
  assert.equal(restored.get('vision'), 'set 2 vision');
  assert.equal(restored.sets().find(row => row.id === second.id).items.primary, '');
  assert.equal(restored.extensions().length, 1);
  assert.match(restored.composePrimary('规则来了'), /规则文本/);

  // 单组导入：追加为新提示词组。
  const before = restored.sets().length;
  restored.importBundle({ format: 'ai-tag-prompt-set', version: 1, name: '外部组', items: { primary: 'external primary', generateTags: '', artistQuality: '', vision: '', translation: '' } });
  assert.equal(restored.sets().length, before + 1);
  assert.equal(restored.sets().at(-1).name, '外部组');

  // 扩展提示词单独导入导出。
  const extBundle = restored.exportExtensions();
  assert.equal(extBundle.format, 'ai-tag-prompt-extensions');
  const target = fresh();
  const imported = target.importExtensions(extBundle);
  assert.equal(imported.ok, true);
  assert.equal(imported.count, 1);
});

test('v1 bundle and legacy persisted state migrate to default set plus always extensions', () => {
  const fromV1 = fresh();
  fromV1.importBundle({ format: 'ai-tag-prompts', version: 1, internal: { primary: { text: 'legacy primary' }, generateTags: { text: 'legacy gen' } }, external: [{ id: 'e1', name: '旧文本', text: 'old text', enabled: true }] });
  assert.equal(fromV1.get('primary'), 'legacy primary');
  assert.equal(fromV1.get('generateTags'), 'legacy gen');
  assert.equal(fromV1.get('artistQuality'), fromV1.getDefault('artistQuality'));
  assert.equal(fromV1.extensions().length, 1);
  assert.equal(fromV1.extensions()[0].activation.mode, 'always');

  const storage = modules.createStorage({ prefix: 'prompt-legacy-' + Date.now() });
  storage.set('rewrite_prompt_state', { overrides: { primary: 'override' }, enabled: { translation: false }, custom: { c1: { id: 'c1', name: 'cname', text: 'ctext', enabled: true } } });
  const migrated = modules.createPrompts({ dir: assetDir, storage });
  assert.equal(migrated.get('primary'), 'override');
  assert.equal(migrated.sets().length, 1);
  assert.equal(migrated.sets()[0].id, 'prompt-set-default');
  assert.equal(migrated.extensions().length, 1);
  assert.equal(migrated.extensions()[0].text, 'ctext');
  assert.match(migrated.composePrimary('x'), /ctext/);
});

console.log('prompts-contract: ok');