'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createComfyModule } = require('../index.js');
const { createMemoryAdapter } = require('../adapter-memory.js');

const customType = 'Lora Loader (LoraManager)';
const customText = '<lora:sample:0.85>';
function fixture() {
  const node = (id, type, inputs = [], widgets_values = []) => ({ id, type, inputs, widgets_values });
  return {
    nodes: [
      node(1, 'CheckpointLoaderSimple'),
      node(2, 'CLIPLoader'),
      { ...node(65, customType, [
        { name: 'model', type: 'MODEL', link: 106 },
        { name: 'clip', type: 'CLIP', link: 107 },
        { name: 'lora_stack', type: 'LORA_STACK', link: null },
      ], [{ version: 1, textWidgetName: 'text' }, customText, [{ name: 'sample', strength: '0.85' }]]),
      properties: { __lm_widget_ids: ['__lm_autocomplete_meta_text', 'text', 'loras'] } },
      node(6, 'CLIPTextEncode', [{ name: 'clip', type: 'CLIP', link: 109 }], ['original positive']),
      node(7, 'CLIPTextEncode', [], ['original negative']),
      node(3, 'KSampler', [
        { name: 'model', type: 'MODEL', link: 108 },
        { name: 'positive', type: 'CONDITIONING', link: 110 },
        { name: 'negative', type: 'CONDITIONING', link: 111 },
      ]),
      node(9, 'SaveImage', [{ name: 'images', type: 'IMAGE', link: 112 }]),
    ],
    links: [
      [106, 1, 0, 65, 0, 'MODEL'], [107, 2, 0, 65, 1, 'CLIP'],
      [108, 65, 0, 3, 0, 'MODEL'], [109, 65, 1, 6, 0, 'CLIP'],
      [110, 6, 0, 3, 1, 'CONDITIONING'], [111, 7, 0, 3, 2, 'CONDITIONING'],
      [112, 3, 0, 9, 0, 'IMAGE'],
    ],
  };
}
function createModule() {
  const port = createMemoryAdapter({ 节点定义: {
    [customType]: { input: { required: { model: ['MODEL'], text: ['AUTOCOMPLETE_TEXT_LORAS', { placeholder: 'Search LoRAs to add...' }] }, optional: {} } },
    CLIPTextEncode: { input: { required: { text: ['STRING'], clip: ['CLIP'] } } },
    SaveImage: { output_node: true },
  } });
  let stored;
  const module = createComfyModule({ port, 存档: { 读: () => stored, 写: value => { stored = structuredClone(value); return true; }, 清: () => { stored = null; return true; } }, 等待: async () => {} });
  return { module, port };
}

test('自定义控件按保存名称进入提交图，元数据不成为输入，填提示词不改LoRA配置', async () => {
  const { module, port } = createModule();
  const original = fixture();
  const before = structuredClone(original);
  await module.run('看节点定义');
  const result = await module.run('认图', { 图: original });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.data.正向.map(input => input.nodeId), ['6']);
  assert.deepEqual(original, before);
  assert.equal((await module.run('存工作流', { 图: original })).ok, true);
  await module.run('绘图开关', { 启用: true });
  const generated = await module.run('出图', { 正向: 'a mountain landscape' });
  assert.equal(generated.ok, true, generated.reason);
  assert.equal(port.记.提交过的.length, 1);
  const prompt = port.记.提交过的[0].接口图;
  assert.deepEqual(prompt['65'].inputs, { model: ['1', 0], clip: ['2', 0], text: customText });
  assert.equal(prompt['6'].inputs.text, 'a mountain landscape');
  assert.equal(prompt['7'].inputs.text, 'original negative');
});

test('保存的自定义文本为空时保留空串，缺少对应值时不拿元数据补值', async () => {
  for (const value of ['', undefined]) {
    const { module, port } = createModule();
    const graph = fixture();
    const lora = graph.nodes.find(node => node.id === 65);
    if (value === undefined) lora.widgets_values = [lora.widgets_values[0]];
    else lora.widgets_values[1] = value;
    await module.run('存工作流', { 图: graph });
    await module.run('绘图开关', { 启用: true });
    const result = await module.run('出图', { 正向: 'a mountain landscape' });
    assert.equal(result.ok, true, result.reason);
    const inputs = port.记.提交过的[0].接口图['65'].inputs;
    if (value === undefined) assert.equal(Object.hasOwn(inputs, 'text'), false);
    else assert.equal(inputs.text, '');
    assert.equal(Object.hasOwn(inputs, '__lm_autocomplete_meta_text'), false);
    assert.equal(Object.hasOwn(inputs, 'loras'), false);
  }
});

test('自定义控件已经接线时保留连线值，不用保存的控件值覆盖', async () => {
  const { module, port } = createModule();
  const graph = fixture();
  graph.nodes.push({ id: 10, type: 'PrimitiveNode', widgets_values: ['linked control text'] });
  graph.nodes.find(node => node.id === 65).inputs.push({ name: 'text', type: 'STRING', link: 113 });
  graph.links.push([113, 10, 0, 65, 3, 'STRING']);
  await module.run('存工作流', { 图: graph });
  await module.run('绘图开关', { 启用: true });
  const result = await module.run('出图', { 正向: 'a mountain landscape' });
  assert.equal(result.ok, true, result.reason);
  assert.equal(port.记.提交过的[0].接口图['65'].inputs.text, 'linked control text');
});
