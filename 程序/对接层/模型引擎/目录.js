// 模型引擎 · 公用那一小块：读模型目录、缓存已加载的模型。
//
// 目录形状（见 模型/说明.md）：
//   模型/识图/<id>/ 与 模型/翻译/<id>/ 各放一格模型
//   WD EVA02 与 Marian opus-mt 可按文件结构自动识别；模型.json 可声明自定义模型格式
//
// 本文件只做三件事：扫目录、读一格的说明、按路径缓存加载过的东西。
// 推理本身在 翻译.js 与 识图.js 里。

import fs from 'node:fs';
import path from 'node:path';

/** 两类：识图与翻译。 */
export const 类别们 = Object.freeze(['vision', 'translation']);
const 类目录名 = Object.freeze({ vision: '识图', translation: '翻译' });

/** 一格模型的说明文件叫什么。 */
const 说明文件 = '模型.json';

/** 已加载过的东西按路径缓存：同一个模型不重复加载。 */
const 缓存 = new Map();

/**
 * 拿一次缓存；没有就用 造 造一个放进去。
 * @param {string} 键
 * @param {Function} 造
 * @returns {Promise<any>}
 */
export async function 要一次(键, 造) {
  if (缓存.has(键)) return 缓存.get(键);
  const 值 = await 造();
  缓存.set(键, 值);
  return 值;
}

/**
 * 扫一遍模型目录，列出有哪些格。
 * @param {string} 模型目录 项目里的 `模型/` 那一层
 * @returns {{vision:Array, translation:Array}} 每格：{ 类别, id, 目录, 名字, 引擎, 文件, 参数, 装好了, 缺什么 }
 */
export function 列模型(模型目录) {
  const 出 = { vision: [], translation: [] };
  if (!模型目录) return 出;

  for (const 类 of 类别们) {
    const 类目录 = path.join(模型目录, 类目录名[类]);
    if (!fs.existsSync(类目录)) continue;
    for (const 一 of fs.readdirSync(类目录, { withFileTypes: true })) {
      if (!一.isDirectory()) continue;
      出[类].push(读一格(类, path.join(类目录, 一.name)));
    }
    出[类].sort((a, b) => a.id.localeCompare(b.id));
  }
  return 出;
}

/**
 * 读一格。说明文件缺了或读不懂 ⇒ `装好了:false`，`缺什么` 说清楚。
 * @param {string} 类别 vision / translation
 * @param {string} 格目录
 */
export function 读一格(类别, 格目录) {
  const id = path.basename(格目录);
  const 说明路径 = path.join(格目录, 说明文件);
  const 底 = { 类别, id, 目录: 格目录, 名字: id, 引擎: null, 文件: {}, 参数: {}, 装好了: false, 缺什么: [] };

  if (!fs.existsSync(说明路径)) return 自动识别(类别, 格目录, 底);
  let 说明 = null;
  try {
    说明 = JSON.parse(fs.readFileSync(说明路径, 'utf8'));
  } catch (error) {
    return { ...底, 缺什么: [`${说明文件} 读不懂：${(error && error.message) || error}`] };
  }
  if (!说明 || typeof 说明 !== 'object' || Array.isArray(说明)) {
    return { ...底, 缺什么: [`${说明文件} 不是一个对象`] };
  }

  const 一格 = {
    ...底,
    名字: typeof 说明.名字 === 'string' && 说明.名字 ? 说明.名字 : id,
    引擎: typeof 说明.引擎 === 'string' ? 说明.引擎 : null,
    文件: 说明.文件 && typeof 说明.文件 === 'object' ? 说明.文件 : {},
    参数: 说明.参数 && typeof 说明.参数 === 'object' ? 说明.参数 : {},
  };

  const 缺 = [];
  if (!一格.引擎) 缺.push('没写引擎');

  // 说明里点名的文件都得在。名字是相对的，也可能是"方向 → 子目录"那一层。
  for (const [键, 值] of Object.entries(一格.文件)) {
    if (typeof 值 === 'string') {
      if (!fs.existsSync(path.join(格目录, 值))) 缺.push(`少了 ${键}：${值}`);
      continue;
    }
    if (值 && typeof 值 === 'object') {
      for (const [子键, 子值] of Object.entries(值)) {
        if (typeof 子值 !== 'string') continue;
        if (!fs.existsSync(path.join(格目录, 子值))) 缺.push(`少了 ${键}.${子键}：${子值}`);
      }
      continue;
    }
    缺.push(`${键} 写的不对`);
  }

  return { ...一格, 装好了: 缺.length === 0, 缺什么: 缺 };
}

function 自动识别(类别, 格目录, 底) {
  const 存在 = (名) => fs.existsSync(path.join(格目录, 名));
  if (类别 === 'vision') {
    const 模型 = fs.readdirSync(格目录).find((名) => /^wd-eva02.*\.onnx$/i.test(名));
    const 词表 = 存在('tags-canary.json') ? 'tags-canary.json' : '';
    const 缺 = [];
    if (!模型) 缺.push('缺少 WD EVA02 ONNX 模型（wd-eva02*.onnx）');
    if (!词表) 缺.push('缺少标签词表：tags-canary.json');
    return {
      ...底, 名字: 'WD EVA02 Tagger', 引擎: 'onnxruntime',
      文件: { 模型: 模型 || 'wd-eva02-tagger.onnx', 词表: 词表 || 'tags-canary.json' },
      参数: { 阈值: 0.6094 }, 装好了: 缺.length === 0, 缺什么: 缺,
    };
  }
  if (类别 === 'translation') {
    const 方向 = { 'en-zh': 'opus-mt-en-zh', 'zh-en': 'opus-mt-zh-en' };
    const 缺 = [];
    for (const [向, 目录] of Object.entries(方向)) {
      const 有权重 = 存在(path.join(目录, 'onnx/encoder_model_quantized.onnx'))
        && 存在(path.join(目录, 'onnx/decoder_model_merged_quantized.onnx'));
      if (!有权重) 缺.push(`少了 ${向} 模型权重：${目录}/onnx/encoder_model_quantized.onnx 与 decoder_model_merged_quantized.onnx`);
      for (const 文件 of ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'vocab.json']) {
        if (!存在(path.join(目录, 文件))) 缺.push(`少了 ${向}.${文件}：${目录}/${文件}`);
      }
    }
    return {
      ...底, 名字: 'Opus-MT 英中互译', 引擎: 'transformers',
      文件: { 方向 }, 参数: {}, 装好了: 缺.length === 0, 缺什么: 缺,
    };
  }
  return { ...底, 缺什么: [`没有 ${说明文件}`] };
}

/** 按 id 找一格；没给 id 就给第一格装好的；找不到给 null。 */
export function 找一格(模型目录, 类别, id) {
  const 所有 = 列模型(模型目录)[类别] || [];
  if (!id) return 所有.find((一) => 一.装好了) || null;
  return 所有.find((一) => 一.id === id) || null;
}

/** 一格里的某个文件（可能嵌一层），给绝对路径。 */
export function 格里的文件(一格, 名) {
  const 值 = 一格 && 一格.文件 ? 一格.文件[名] : null;
  return typeof 值 === 'string' ? path.join(一格.目录, 值) : null;
}
