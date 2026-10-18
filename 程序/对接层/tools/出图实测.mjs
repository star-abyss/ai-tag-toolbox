// 真出一张图：存工作流 → 认口 → 出图 → 取图，走装配层的工具接口（UI 将来走的就是这条路）。
//
//   node tools/出图实测.mjs [地址]
//
// 要 ComfyUI 开着（默认 http://127.0.0.1:8188）。工作流自己造：底模名从那一台取，
// 出的图自己删掉，跑完不留残留。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { apply } from '../index.js';

const 包根 = path.resolve(process.cwd());
const 项目根 = path.dirname(包根);
const 条目 = yaml.load(fs.readFileSync(path.join(包根, 'cordis.patch.yml'), 'utf8'));
const 配置 = { ...条目.find((x) => x && x.insert).insert.find((x) => x && x.id === 'toolbox').config, 项目根 };
const 地址 = String(process.argv[2] || 配置.comfyUI地址 || '').replace(/\/+$/, '');

/** 那一台 ComfyUI 上第一个可用的底模名。 */
async function 取模型名() {
  const 答 = await fetch(`${地址}/object_info/CheckpointLoaderSimple`);
  if (!答.ok) throw new Error(`取节点定义失败：HTTP ${答.status}`);
  const 定义 = await 答.json();
  const 选项 = 定义.CheckpointLoaderSimple.input.required.ckpt_name[0];
  if (!Array.isArray(选项) || !选项.length) throw new Error('这一台 ComfyUI 上没有底模');
  return String(选项[0]);
}

/** 造一张界面格式的文生图工作流（七个节点）。 */
function 造文生图(模型) {
  const 节点 = (id, type, 控件, 连线) => ({
    id,
    type,
    pos: [0, 0],
    size: [280, 120],
    flags: {},
    order: id,
    mode: 0,
    inputs: [
      ...连线.map(([name, 类型, link]) => ({ name, type: 类型, link })),
      ...控件.map(([name, 值]) => ({ name, type: 'STRING', link: null, widget: { name } })),
    ],
    outputs: [],
    properties: { 'Node name for S&R': type },
    widgets_values: 控件.map(([, 值]) => 值),
  });
  const 节点们 = [
    节点(4, 'CheckpointLoaderSimple', [['ckpt_name', 模型]], []),
    节点(6, 'CLIPTextEncode', [['text', '']], [['clip', 'CLIP', 1]]),
    节点(7, 'CLIPTextEncode', [['text', '']], [['clip', 'CLIP', 2]]),
    节点(5, 'EmptyLatentImage', [['width', 512], ['height', 512], ['batch_size', 1]], []),
    节点(3, 'KSampler', [
      ['seed', 7], ['steps', 20], ['cfg', 6],
      ['sampler_name', 'euler_ancestral'], ['scheduler', 'karras'], ['denoise', 1],
    ], [
      ['model', 'MODEL', 3], ['positive', 'CONDITIONING', 4],
      ['negative', 'CONDITIONING', 5], ['latent_image', 'LATENT', 6],
    ]),
    节点(8, 'VAEDecode', [], [['samples', 'LATENT', 7], ['vae', 'VAE', 8]]),
    节点(9, 'SaveImage', [['filename_prefix', 'toolbox-实测']], [['images', 'IMAGE', 9]]),
  ];
  const 输出 = {
    4: [['MODEL', [3]], ['CLIP', [1, 2]], ['VAE', [8]]],
    6: [['CONDITIONING', [4]]],
    7: [['CONDITIONING', [5]]],
    5: [['LATENT', [6]]],
    3: [['LATENT', [7]]],
    8: [['IMAGE', [9]]],
    9: [],
  };
  for (const n of 节点们) n.outputs = (输出[n.id] || []).map(([name, links], i) => ({ name, type: name, links, slot_index: i }));
  return {
    id: crypto.randomUUID(),
    revision: 0,
    last_node_id: 9,
    last_link_id: 9,
    nodes: 节点们,
    links: [
      [1, 4, 1, 6, 0, 'CLIP'],
      [2, 4, 1, 7, 0, 'CLIP'],
      [3, 4, 0, 3, 0, 'MODEL'],
      [4, 6, 0, 3, 1, 'CONDITIONING'],
      [5, 7, 0, 3, 2, 'CONDITIONING'],
      [6, 5, 0, 3, 3, 'LATENT'],
      [7, 3, 0, 8, 0, 'LATENT'],
      [8, 4, 2, 8, 1, 'VAE'],
      [9, 8, 0, 9, 0, 'IMAGE'],
    ],
    groups: [],
    config: {},
    extra: {},
    version: 0.4,
  };
}

const 工具 = [];
const ctx = {
  systemPrompt: { section: () => () => {} },
  tools: { register: (x) => { 工具.push(x); return () => {}; } },
  llm: { stream: async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; } },
  on: () => () => {},
  effect: () => () => {},
  provide: () => () => {},
};
const 出 = await apply(ctx, 配置);
const 调 = async (名, 参数) => {
  const 一 = 工具.find((x) => x.name === 名);
  if (!一) throw new Error(`没有登记 ${名}`);
  return await 一.execute(参数 || {});
};

const 模型 = await 取模型名();
console.log(`地址 ${地址} · 底模 ${模型}`);

console.log('\n--- 存工作流 ---');
const 存 = await 调('comfy_setWorkflow', { 图: 造文生图(模型) });
console.log('认得的:', 存.口.认得的.join(' / '), '| 认不出的:', 存.口.认不出的.join(' / ') || '（无）');

console.log('\n--- 认口 ---');
const 认 = await 调('comfy_detect');
console.log('正向', 认.正向.length, '个口 · 负向', 认.负向.length, '个口 · 产出', 认.输出.length, '项');

console.log('\n--- 出图 ---');
await 调('comfy_drawing', { 启用: true });
const 跑 = await 调('comfy_generate', {
  正向: 'hakurei reimu, touhou, 1girl, solo, masterpiece, best quality',
  负向: 'worst quality, low quality',
});
console.log('任务号', 跑.任务号, '| 填了', JSON.stringify(跑.填了的), '| 产出', 跑.产出.map((x) => x.文件名).join(', '));

console.log('\n--- 取图 ---');
let 存的引用 = null;
try {
  const 取 = await 调('comfy_fetch', { 产出: 跑.产出[0] });
  console.log(取.字节.length, '字节', 取.mime);
  存的引用 = (await 调('image_save', { 作用域: { 存放地: 'gallery' }, 字节: 取.字节, 文件名: 跑.产出[0].文件名 })).引用;
  console.log('存进图库:', 存的引用.条目ID);
} catch (错) {
  const 话 = String((错 && 错.message) || 错);
  console.log(话.includes('TOOL_TOO_MANY_BYTES') ? `取图这一条被字节上限挡住（${话}）` : `取图失败：${话}`);
}

console.log('\n--- 存档里那张还在不在 ---');
const 档 = path.join(项目根, '工具箱数据/comfyUI/工作流.json');
console.log(fs.existsSync(档) ? `在：${fs.statSync(档).size} 字节` : '不在');
const 取回 = await 调('comfy_getWorkflow');
console.log('取工作流 →', 取回 && 取回.口 ? `认得 ${取回.口.认得的.length} 类` : '取不到');
await 调('comfy_clearWorkflow');
console.log('清工作流 →', fs.existsSync(档) ? '文件还在' : '文件已删');
if (存的引用) {
  await 调('image_remove', { 引用: 存的引用 });
  console.log('那张图 → 已从图库删掉');
}
