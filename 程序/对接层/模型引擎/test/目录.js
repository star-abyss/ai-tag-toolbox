import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { 列模型, 找一格 } from '../目录.js';
import { 造本地模型 } from '../../模型可选.js';

const 临时 = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-models-'));
const 模型目录 = path.join(临时, '模型');
const 识图目录 = path.join(模型目录, '识图', 'wd-eva02');
const 翻译目录 = path.join(模型目录, '翻译', 'opus-mt');
fs.mkdirSync(识图目录, { recursive: true });
fs.mkdirSync(翻译目录, { recursive: true });
fs.writeFileSync(path.join(识图目录, 'wd-eva02-tagger.onnx'), 'onnx');
fs.writeFileSync(path.join(识图目录, 'tags-canary.json'), '[]');
for (const dir of ['opus-mt-en-zh', 'opus-mt-zh-en']) {
  const d = path.join(翻译目录, dir);
  fs.mkdirSync(d);
  for (const f of ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'vocab.json']) {
    fs.writeFileSync(path.join(d, f), '{}');
  }
  fs.mkdirSync(path.join(d, 'onnx'));
  fs.writeFileSync(path.join(d, 'onnx', 'encoder_model_quantized.onnx'), 'weight');
  fs.writeFileSync(path.join(d, 'onnx', 'decoder_model_merged_quantized.onnx'), 'weight');
}

try {
  let listed = 列模型(模型目录);
  assert.deepEqual(listed.vision.map((x) => x.id), ['wd-eva02']);
  assert.equal(listed.vision[0].装好了, true, 'WD EVA02 ONNX 与 tags-canary.json 应自动识别');
  assert.equal(listed.vision[0].引擎, 'onnxruntime');
  assert.equal(listed.vision[0].文件.词表, 'tags-canary.json');
  assert.deepEqual(listed.translation.map((x) => x.id), ['opus-mt']);
  assert.equal(listed.translation[0].装好了, true, '双方向 Marian 文件包应自动识别');
  assert.deepEqual(listed.translation[0].文件.方向, { 'en-zh': 'opus-mt-en-zh', 'zh-en': 'opus-mt-zh-en' });

  fs.unlinkSync(path.join(翻译目录, 'opus-mt-zh-en', 'onnx', 'decoder_model_merged_quantized.onnx'));
  listed = 列模型(模型目录);
  assert.equal(listed.translation[0].装好了, false);
  assert.ok(listed.translation[0].缺什么.some((x) => x.includes('zh-en') && x.includes('模型权重')));
  fs.writeFileSync(path.join(翻译目录, 'opus-mt-zh-en', 'onnx', 'decoder_model_merged_quantized.onnx'), 'weight');

  const 配置 = { 模型目录, 识图模型: 'wd-eva02', 翻译模型: 'opus-mt' };
  const updates = [];
  const local = 造本地模型({ 项目根: 临时, 配置, onChange: async (category, id) => updates.push([category, id]) });
  assert.equal(local.列().目录, 模型目录);
  assert.equal(local.列().这次用.vision, 'wd-eva02');
  assert.equal(local.列().这次用.translation, 'opus-mt');
  assert.equal((await local.换('vision', '')).ok, true);
  assert.deepEqual(updates, [['vision', '']]);
  const withoutCallback = 造本地模型({ 项目根: 临时, 配置 });
  assert.equal((await withoutCallback.换('translation', '')).ok, true);
  assert.equal(配置.翻译模型, 'opus-mt', '无回调时不应写入配置');

  const rejectsSave = 造本地模型({ 项目根: 临时, 配置, onChange: async () => { throw new Error('write failed'); } });
  await assert.rejects(rejectsSave.换('vision', ''), /write failed/);
  assert.equal(rejectsSave.列().这次用.vision, 'wd-eva02', '持久化失败时选择不应先改变');

  const custom = path.join(模型目录, '识图', 'custom');
  fs.mkdirSync(custom);
  fs.writeFileSync(path.join(custom, '模型.json'), JSON.stringify({
    名字: '自定义', 引擎: 'onnxruntime', 文件: { 模型: 'm.onnx', 词表: 'tags.json' }, 参数: {},
  }));
  fs.writeFileSync(path.join(custom, 'm.onnx'), 'x');
  fs.writeFileSync(path.join(custom, 'tags.json'), '[]');
  assert.equal(找一格(模型目录, 'vision', 'custom').名字, '自定义');
  console.log('模型目录行为自检通过');
} finally {
  fs.rmSync(临时, { recursive: true, force: true });
}
