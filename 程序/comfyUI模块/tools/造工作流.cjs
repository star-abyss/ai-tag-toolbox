'use strict';
/*
 * 造两张界面格式的工作流，给实测当素材。
 *
 *   node tools/造工作流.cjs <地址> [降噪]
 *
 * 出一张文生图、一张图生图，写在 tools/.工作流/ 下。
 * 模型名从那一台 ComfyUI 的节点定义里取；降噪默认 0.55，只写进图生图那张。
 */

const fs = require('node:fs');
const path = require('node:path');

const 地址 = String(process.argv[2] || '').replace(/\/+$/, '');
const 降噪 = Number(process.argv[3]) > 0 ? Number(process.argv[3]) : 0.55;
if (!地址) {
  console.log('用法：node tools/造工作流.cjs <地址> [降噪]');
  console.log('  地址   形如 http://127.0.0.1:8188');
  console.log('  降噪   图生图那张的降噪，默认 0.55');
  process.exit(1);
}

/** 那一台 ComfyUI 上第一个可用的底模名。 */
async function 取模型名() {
  const 答 = await fetch(`${地址}/object_info/CheckpointLoaderSimple`);
  if (!答.ok) throw new Error(`取节点定义失败：HTTP ${答.status}`);
  const 定义 = await 答.json();
  const 选项 = 定义.CheckpointLoaderSimple.input.required.ckpt_name[0];
  if (!Array.isArray(选项) || !选项.length) throw new Error('这一台 ComfyUI 上没有底模');
  return String(选项[0]);
}

function 节点(id, type, 控件, 连线 = [], 位置 = [0, 0]) {
  return {
    id,
    type,
    pos: 位置,
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
  };
}

function 挂输出(节点们, 表) {
  for (const n of 节点们) {
    n.outputs = (表[n.id] || []).map(([name, links], i) => ({ name, type: name, links, slot_index: i }));
  }
  return 节点们;
}

function 外壳(节点们, links) {
  return {
    id: require('node:crypto').randomUUID(),
    revision: 0,
    last_node_id: Math.max(...节点们.map((n) => n.id)),
    last_link_id: links.length,
    nodes: 节点们,
    links,
    groups: [],
    config: {},
    extra: { ds: { scale: 0.85, offset: [80, 40] } },
    version: 0.4,
  };
}

/** 文生图：标准七节点。 */
function 文生图(模型) {
  const 节点们 = 挂输出([
    节点(4, 'CheckpointLoaderSimple', [['ckpt_name', 模型]], [], [40, 60]),
    节点(6, 'CLIPTextEncode', [['text', '']], [['clip', 'CLIP', 1]], [420, 40]),
    节点(7, 'CLIPTextEncode', [['text', '']], [['clip', 'CLIP', 2]], [420, 240]),
    节点(5, 'EmptyLatentImage', [['width', 1216], ['height', 832], ['batch_size', 1]], [], [420, 440]),
    节点(3, 'KSampler', [
      ['seed', 1], ['steps', 28], ['cfg', 6],
      ['sampler_name', 'euler_ancestral'], ['scheduler', 'karras'], ['denoise', 1],
    ], [
      ['model', 'MODEL', 3], ['positive', 'CONDITIONING', 4],
      ['negative', 'CONDITIONING', 5], ['latent_image', 'LATENT', 6],
    ], [800, 40]),
    节点(8, 'VAEDecode', [], [['samples', 'LATENT', 7], ['vae', 'VAE', 8]], [1140, 40]),
    节点(9, 'SaveImage', [['filename_prefix', 'comfy-t2i']], [['images', 'IMAGE', 9]], [1140, 260]),
  ], {
    4: [['MODEL', [3]], ['CLIP', [1, 2]], ['VAE', [8]]],
    6: [['CONDITIONING', [4]]],
    7: [['CONDITIONING', [5]]],
    5: [['LATENT', [6]]],
    3: [['LATENT', [7]]],
    8: [['IMAGE', [9]]],
    9: [],
  });
  return 外壳(节点们, [
    [1, 4, 1, 6, 0, 'CLIP'],
    [2, 4, 1, 7, 0, 'CLIP'],
    [3, 4, 0, 3, 0, 'MODEL'],
    [4, 6, 0, 3, 1, 'CONDITIONING'],
    [5, 7, 0, 3, 2, 'CONDITIONING'],
    [6, 5, 0, 3, 3, 'LATENT'],
    [7, 3, 0, 8, 0, 'LATENT'],
    [8, 4, 2, 8, 1, 'VAE'],
    [9, 8, 0, 9, 0, 'IMAGE'],
  ]);
}

/** 图生图：LoadImage → VAEEncode → 采样 → 解码。 */
function 图生图(模型, 降噪值) {
  const 节点们 = 挂输出([
    节点(4, 'CheckpointLoaderSimple', [['ckpt_name', 模型]], [], [40, 60]),
    节点(20, 'LoadImage', [['image', '']], [], [40, 340]),
    节点(21, 'VAEEncode', [], [['pixels', 'IMAGE', 10], ['vae', 'VAE', 8]], [420, 340]),
    节点(6, 'CLIPTextEncode', [['text', '']], [['clip', 'CLIP', 1]], [420, 40]),
    节点(7, 'CLIPTextEncode', [['text', '']], [['clip', 'CLIP', 2]], [420, 180]),
    节点(3, 'KSampler', [
      ['seed', 419], ['steps', 32], ['cfg', 5.5],
      ['sampler_name', 'dpmpp_2m'], ['scheduler', 'karras'], ['denoise', 降噪值],
    ], [
      ['model', 'MODEL', 3], ['positive', 'CONDITIONING', 4],
      ['negative', 'CONDITIONING', 5], ['latent_image', 'LATENT', 11],
    ], [800, 40]),
    节点(8, 'VAEDecode', [], [['samples', 'LATENT', 7], ['vae', 'VAE', 8]], [1140, 40]),
    节点(9, 'SaveImage', [['filename_prefix', 'comfy-i2i']], [['images', 'IMAGE', 9]], [1140, 260]),
  ], {
    4: [['MODEL', [3]], ['CLIP', [1, 2]], ['VAE', [8]]],
    20: [['IMAGE', [10]], ['MASK', []]],
    21: [['LATENT', [11]]],
    6: [['CONDITIONING', [4]]],
    7: [['CONDITIONING', [5]]],
    3: [['LATENT', [7]]],
    8: [['IMAGE', [9]]],
    9: [],
  });
  return 外壳(节点们, [
    [1, 4, 1, 6, 0, 'CLIP'],
    [2, 4, 1, 7, 0, 'CLIP'],
    [3, 4, 0, 3, 0, 'MODEL'],
    [4, 6, 0, 3, 1, 'CONDITIONING'],
    [5, 7, 0, 3, 2, 'CONDITIONING'],
    [7, 3, 0, 8, 0, 'LATENT'],
    [8, 4, 2, 8, 1, 'VAE'],
    [9, 8, 0, 9, 0, 'IMAGE'],
    [10, 20, 0, 21, 0, 'IMAGE'],
    [11, 21, 0, 3, 3, 'LATENT'],
  ]);
}

(async () => {
  const 模型 = await 取模型名();
  const 目录 = path.join(__dirname, '.工作流');
  fs.mkdirSync(目录, { recursive: true });
  fs.writeFileSync(path.join(目录, '文生图.json'), JSON.stringify(文生图(模型), null, 2), 'utf8');
  fs.writeFileSync(path.join(目录, '图生图.json'), JSON.stringify(图生图(模型, 降噪), null, 2), 'utf8');
  console.log(`模型：${模型}`);
  console.log(`图生图的降噪：${降噪}`);
  console.log('写好两张：');
  console.log(`  ${path.join(目录, '文生图.json')}`);
  console.log(`  ${path.join(目录, '图生图.json')}`);
})().catch((错误) => {
  console.log('出错：' + ((错误 && 错误.message) || 错误));
  process.exit(1);
});
