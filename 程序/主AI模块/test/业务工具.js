'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createMainAiModule } = require('../index.js');
const { createMemoryAdapter } = require('../adapter-memory.js');

const 业务工具 = [
  {
    名字: 'draw_image',
    摘要: '按提示词生成图片',
    参数: {
      prompt: { type: 'string', description: '正向提示词', required: true },
      options: { type: 'object', description: '生成设置', properties: { steps: { type: 'integer', required: true } } },
    },
    说明: { prompt: '正向提示词', options: '生成设置' },
  },
  { 名字: 'query_tags', 摘要: '查询标签', 参数: { text: { type: 'string', required: true } }, 说明: { text: '搜索内容' } },
];

test('旧工具快照只保留匹配业务名的工具偏好与模型配置', () => {
  const port = createMemoryAdapter({ 默认: { 主AI: { name: '主AI', 身份: '默认身份', 流程: '默认流程' } }, 业务工具: () => 业务工具 });
  const legacy = {
    format: '主AI预设', version: 1,
    subs: { 主AI: { 启用: ['ps1'] } },
    presets: {
      ps1: {
        name: '用户设置', 身份: '我的身份', 流程: '我的流程',
        worldbook: ['书甲'], model: { 走: '自选链路', 模型: 'model-x' },
        tools: [
          { 名字: '旧comfy_node操作', 启用: true, 参数: { path: { type: 'string' } }, 说明: {} },
          { 名字: 'draw_image', 启用: true, 参数: { prompt: { type: 'integer', description: '用户用词' } }, 说明: {} },
          { 名字: 'query_tags', 启用: false, 参数: { text: { type: 'number', description: '自定义检索说明' } }, 说明: {} },
        ],
      },
    },
  };
  port.writeState(legacy);
  const ai = createMainAiModule({ port });
  const sent = ai.执行({ 请求: '主AI' });
  assert.deepEqual(sent.工具表.map((row) => row.名字), ['draw_image']);
  assert.equal(sent.工具表[0].摘要, '按提示词生成图片');
  assert.equal(sent.工具表[0].参数.prompt.type, 'string');
  assert.equal(sent.工具表[0].参数.prompt.required, true);
  assert.equal(sent.工具表[0].参数.prompt.description, '用户用词');
  assert.equal('身份' in sent, false);
  assert.equal('流程' in sent, false);
  assert.equal('世界书' in sent, false);
  assert.equal('worldbook' in sent, false);
  assert.deepEqual(sent.模型, { 走: '自选链路', 模型: 'model-x' });
  assert.equal(ai.读({ 预设: 'ps1' }).预设.工具表.some((row) => row.名字 === '旧comfy_node操作'), false);
  assert.equal(port.readState().value.presets.ps1.tools.length, 3, '读取不改用户原文件');

  ai.存();
  const saved = port.readState().value.presets.ps1;
  assert.deepEqual(Object.keys(saved).sort(), ['model', 'name', 'tools', 'toolsOrder'].sort());
  assert.deepEqual(saved.model, { 走: '自选链路', 模型: 'model-x' });
  assert.deepEqual(saved.tools, [
    { 名字: 'draw_image', 说明: { prompt: '用户用词' } },
    { 名字: 'query_tags', 启用: false, 说明: { text: '自定义检索说明' } },
  ]);
});

test('业务表为空时主AI不凭旧预设生成工具', () => {
  const port = createMemoryAdapter({ 默认: { 主AI: { name: '主AI' } }, 业务工具: [] });
  port.writeState({ version: 1, presets: { ps1: { name: '老预设', tools: [{ 名字: 'tag_delete', 启用: true }] } } });
  const ai = createMainAiModule({ port });
  assert.deepEqual(ai.执行({ 预设: 'ps1' }).工具表, []);
});
