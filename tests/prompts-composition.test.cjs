'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const modules = require('../src/modules');
const assetDir = path.resolve('assets/提示词素材');

test('primary request composes only matched extensions; generateTags composes artist quality reference', async () => {
  const storage = modules.createStorage({ prefix: 'prompt-compose-' + Date.now() });
  const prompts = modules.createPrompts({ dir: assetDir, storage });
  prompts.createExtension({ name: '角色替换规则', text: 'EXT-角色替换规则文本', activation: { mode: 'keywords', keywords: ['角色替换'] } });
  prompts.createExtension({ name: '常驻画风', text: 'EXT-常驻画风文本', activation: { mode: 'always' } });

  const systems = [];
  const assistant = modules.createAssistant({
    storage,
    promptSource: prompts,
    primaryGateway: { complete: async messages => { systems.push(messages[0].content); return { ok: true, text: 'done' }; } }
  });
  const first = await assistant.run({ text: '帮我做角色替换' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.match(systems.at(-1), /EXT-角色替换规则文本/);
  assert.match(systems.at(-1), /EXT-常驻画风文本/);
  assert.match(systems.at(-1), /【主 AI 提示词｜高优先级，始终优先】/);
  await assistant.run({ text: '画一只猫' });
  assert.doesNotMatch(systems.at(-1), /EXT-角色替换规则文本/);
  assert.match(systems.at(-1), /EXT-常驻画风文本/);

  let genSystem = '';
  const subagents = modules.createFixedSubagents({
    prompts,
    visionAI: { complete: async messages => { genSystem = messages[0].content; return { ok: true, text: '{\"positiveTags\":[\"1girl\"]}' }; } },
    getSettings: () => ({ generateNegativeTags: false })
  });
  const runtime = modules.createAgentRuntime({ primaryClient: { complete: async () => ({ ok: true, text: 'x' }) }, subagents });
  const tags = await runtime.runSubAgent('generateTags', { input: { requirements: 'girl' }, requestId: 'compose-gen' });
  assert.equal(tags.ok, true, JSON.stringify(tags));
  assert.deepEqual(tags.data.positiveTags, ['1girl']);
  assert(genSystem.includes(prompts.get('generateTags')), '文生图主提示词缺失');
  assert(genSystem.includes(prompts.get('artistQuality')), '画师与品质词参考缺失');
  assert(genSystem.includes('系统输出协议'), '输出协议缺失');

  // 切换提示词组后，子代理与主 AI 使用新组的条目。
  const second = prompts.createSet({ name: '实验配置' });
  prompts.setActive(second.id);
  prompts.set('primary', 'EXPERIMENT PRIMARY');
  prompts.set('generateTags', 'EXPERIMENT GEN');
  prompts.set('artistQuality', 'EXPERIMENT QUALITY');
  await assistant.run({ text: '再画一张' });
  assert.match(systems.at(-1), /EXPERIMENT PRIMARY/);
  assert.doesNotMatch(systems.at(-1), /你是 AI 绘画 Tag 工具箱的主 AI。你负责理解用户要求/);
  genSystem = '';
  const next = await runtime.runSubAgent('generateTags', { input: { requirements: 'girl' }, requestId: 'compose-gen-2' });
  assert.equal(next.ok, true);
  assert(genSystem.includes('EXPERIMENT GEN'));
  assert(genSystem.includes('EXPERIMENT QUALITY'));
});

console.log('prompts-composition: ok');