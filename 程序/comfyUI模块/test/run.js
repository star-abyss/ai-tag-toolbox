'use strict';
/*
 * comfyUI 模块 · 功能自检。自建数据、自清数据，失败非零退出。
 *
 *   node test/run.js            全部
 *   node test/run.js 出图       只跑名字里带这两个字的
 */

const G = require('../graph.js');
const { createCore } = require('../core.js');
const { createComfyModule } = require('../index.js');
const { createMemoryAdapter } = require('../adapter-memory.js');
const { createHttpAdapter } = require('../adapter-http.js');
const { checkPort, reasonOf } = require('../port.js');

let 过 = 0;
const 败 = [];
const 过滤 = process.argv[2] || '';

function 判(名, 真, 附言) {
  if (过滤 && !名.includes(过滤)) return;
  if (真) { 过 += 1; console.log(`  ✓ ${名}`); }
  else { 败.push(名); console.log(`  ✗ ${名}${附言 ? `  — ${附言}` : ''}`); }
}

function 段(标题) {
  if (过滤) return;
  console.log(`\n=== ${标题} ===`);
}

/* ---------------------------------------------------------- 造一张界面图 */

/** 一个节点：控件值按控件声明的顺序给。 */
function 节点(id, type, 控件, 连线输入 = []) {
  return {
    id,
    type,
    pos: [100 * id, 100],
    size: [270, 100],
    flags: {},
    order: id,
    mode: 0,
    inputs: [
      ...连线输入.map(([name, 类型, link]) => ({ name, type: 类型, link })),
      ...控件.map(([name, 值]) => ({ name, type: 'STRING', link: null, widget: { name } })),
    ],
    outputs: [],
    properties: { 'Node name for S&R': type },
    widgets_values: 控件.map(([, 值]) => 值),
  };
}

function 输出槽(节点们, 表) {
  for (const n of 节点们) {
    const 槽 = 表[n.id] || [];
    n.outputs = 槽.map(([name, links], i) => ({ name, type: name, links, slot_index: i }));
  }
  return 节点们;
}

/** 一张最小文生图：正 / 负两个文本口、没有图片口。 */
function 造图({ 种子 = 123, 步数 = 20 } = {}) {
  const 节点们 = 输出槽([
    节点(4, 'CheckpointLoaderSimple', [['ckpt_name', 'test-model.safetensors']]),
    节点(6, 'CLIPTextEncode', [['text', 'an old prompt']], [['clip', 'CLIP', 1]]),
    节点(7, 'CLIPTextEncode', [['text', 'an old negative']], [['clip', 'CLIP', 2]]),
    节点(5, 'EmptyLatentImage', [['width', 832], ['height', 1216], ['batch_size', 1]]),
    节点(3, 'KSampler', [
      ['seed', 种子], ['steps', 步数], ['cfg', 7],
      ['sampler_name', 'euler'], ['scheduler', 'normal'], ['denoise', 1],
    ], [
      ['model', 'MODEL', 3], ['positive', 'CONDITIONING', 4],
      ['negative', 'CONDITIONING', 5], ['latent_image', 'LATENT', 6],
    ]),
    节点(8, 'VAEDecode', [], [['samples', 'LATENT', 7], ['vae', 'VAE', 8]]),
    节点(9, 'SaveImage', [['filename_prefix', 'test']], [['images', 'IMAGE', 9]]),
  ], { 4: [['MODEL', [3]], ['CLIP', [1, 2]], ['VAE', [8]]], 6: [['CONDITIONING', [4]]], 7: [['CONDITIONING', [5]]], 5: [['LATENT', [6]]], 3: [['LATENT', [7]]], 8: [['IMAGE', [9]]], 9: [] });
  return {
    id: 'test-graph',
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

/** 带图片口的图：LoadImage → VAEEncode → 采样器。 */
function 造图生图() {
  const 图 = 造图();
  const 加 = 输出槽([
    节点(20, 'LoadImage', [['image', 'old.png']]),
    节点(21, 'VAEEncode', [], [['pixels', 'IMAGE', 10], ['vae', 'VAE', 8]]),
  ], { 20: [['IMAGE', [10]], ['MASK', []]], 21: [['LATENT', [11]]] });
  图.nodes.push(...加);
  图.links.push([10, 20, 0, 21, 0, 'IMAGE'], [11, 21, 0, 3, 3, 'LATENT']);
  // 采样器的 latent 改接编码器
  图.nodes.find((n) => n.id === 3).inputs.find((i) => i.name === 'latent_image').link = 11;
  图.last_node_id = 21;
  图.last_link_id = 11;
  return 图;
}

/** 正向分两路合流的图：CLIPTextEncode ×2 → ConditioningCombine → 采样器。 */
function 造合并图() {
  const 图 = 造图();
  const 加 = 输出槽([
    节点(12, 'ConditioningCombine', [], [['conditioning_1', 'CONDITIONING', 12], ['conditioning_2', 'CONDITIONING', 13]]),
    节点(30, 'CLIPTextEncode', [['text', 'second prompt']], [['clip', 'CLIP', 2]]),
  ], { 12: [['CONDITIONING', [14]]], 30: [['CONDITIONING', [13]]] });
  图.nodes.push(...加);
  图.links.push([12, 6, 0, 12, 0, 'CONDITIONING'], [13, 30, 0, 12, 1, 'CONDITIONING'], [14, 12, 0, 3, 1, 'CONDITIONING']);
  图.nodes.find((n) => n.id === 3).inputs.find((i) => i.name === 'positive').link = 14;
  图.last_node_id = 30;
  图.last_link_id = 14;
  return 图;
}

/** 一个内存存档。 */
function 造存档() {
  let 值 = null;
  return {
    读: () => 值,
    写: (v) => { 值 = v; return true; },
    清: () => { 值 = null; },
    看: () => 值,
  };
}

/* ------------------------------------------------------------ 图：两种形态 */

段('图 · 形态与转换');
{
  const 图 = 造图();
  const 认 = G.认形态(图);
  判('认得出界面图', 认.ok && 认.data.形态 === '界面图');

  const 转 = G.界面图转接口图(图);
  判('界面图转得成接口图', 转.ok, 转.reason);
  if (转.ok) {
    const k = 转.data['3'];
    判('KSampler 值按控件名归位（种子）', k.inputs.seed === 123, `实为 ${JSON.stringify(k.inputs.seed)}`);
    判('KSampler 值按控件名归位（步数）', k.inputs.steps === 20, `实为 ${JSON.stringify(k.inputs.steps)}`);
    判('KSampler 值按控件名归位（采样器）', k.inputs.sampler_name === 'euler');
    判('连线输入取源节点', Array.isArray(k.inputs.positive) && k.inputs.positive[0] === '6');
    判('连线输入不取控件值', k.inputs.model[0] === '4');
  }

  const 转2 = G.界面图转接口图(转.ok ? 转.data : {});
  判('接口图转接口图是原样复制', 转2.ok && 转2.data['3'].class_type === 'KSampler');
}

/* ------------------------------------------------------------ 图：认口与填口 */

段('图 · 认口');
{
  const 口 = G.读口(造图());
  判('认得出正向口', 口.ok && 口.data.正向.length === 1, 口.reason);
  判('正向口是那个文本节点', 口.ok && 口.data.正向[0].nodeId === '6' && 口.data.正向[0].input === 'text');
  判('认得出负向口', 口.ok && 口.data.负向.length === 1 && 口.data.负向[0].nodeId === '7');
  判('没有图片口时不硬凑', 口.ok && 口.data.图片.length === 0);
  判('认出主采样器上游的批量输入', 口.ok && 口.data.张数.length === 1
    && 口.data.张数[0].nodeId === '5' && 口.data.张数[0].input === 'batch_size');
  判('认得出输出节点', 口.ok && 口.data.输出.some((x) => x.nodeId === '9' && x.类型 === 'image'));
  判('认得的清单齐全', 口.ok && 口.data.认得的.join('/') === '正向提示词/负向提示词');

  const 图生图 = G.读口(造图生图());
  判('图生图认得出图片口', 图生图.ok && 图生图.data.图片.length === 1 && 图生图.data.图片[0].nodeId === '20');
  判('图生图认得出图片口的当前值', 图生图.ok && 图生图.data.图片[0].当前值 === 'old.png');
  const 图生批量 = G.读口(造图生图());
  判('图生图没有明确批量节点时不认张数口', 图生批量.ok && 图生批量.data.张数.length === 0);
  const 无批量 = G.填口(造图生图(), { 正向: 'A', 张数: 1 });
  判('明确请求张数但无批量入口时失败', !无批量.ok && 无批量.code === G.ERR.BAD_PARAM);
  const 批量填 = G.填口(造图(), { 正向: 'A', 张数: 4 });
  判('张数覆盖真实批量输入', 批量填.ok && 批量填.data.接口图['5'].inputs.batch_size === 4
    && 批量填.data.填了的.张数[0] === '5.batch_size');
  const 重复空latent = 造图();
  重复空latent.nodes.push(...输出槽([节点(22, 'RepeatLatentBatch', [['amount', 2]], [['samples', 'LATENT', 16]])], { 22: [['LATENT', [17]]] }));
  重复空latent.links.push([16, 5, 0, 22, 0, 'LATENT'], [17, 22, 0, 3, 3, 'LATENT']);
  重复空latent.nodes.find((n) => n.id === 3).inputs.find((i) => i.name === 'latent_image').link = 17;
  const 重复口 = G.读口(重复空latent);
  const 重复填 = G.填口(重复空latent, { 张数: 4 });
  判('重复 latent 同时归一上游空 latent 与重复量', 重复口.ok && 重复口.data.张数.length === 2
    && 重复填.ok && 重复填.data.接口图['5'].inputs.batch_size === 1 && 重复填.data.接口图['22'].inputs.amount === 4);
  const 图生重复 = 造图生图();
  图生重复.nodes.push(...输出槽([节点(22, 'RepeatLatentBatch', [['amount', 2]], [['samples', 'LATENT', 16]])], { 22: [['LATENT', [17]]] }));
  图生重复.links.push([16, 21, 0, 22, 0, 'LATENT'], [17, 22, 0, 3, 3, 'LATENT']);
  图生重复.nodes.find((n) => n.id === 3).inputs.find((i) => i.name === 'latent_image').link = 17;
  判('单图 VAEEncode 上游的重复 latent 可按绝对张数填写', G.读口(图生重复).data.张数.length === 1
    && G.读口(图生重复).data.张数[0].nodeId === '22');

  const 合并 = G.读口(造合并图());
  判('合流的两路文本都认成正向口', 合并.ok && 合并.data.正向.length === 2,
    合并.ok ? `实为 ${合并.data.正向.length}` : 合并.reason);
  判('正向口去重后没有重复节点', 合并.ok && new Set(合并.data.正向.map((x) => x.nodeId)).size === 合并.data.正向.length);

  const 两采样器 = 造图();
  两采样器.nodes.push(节点(40, 'KSampler', [['seed', 1], ['steps', 10], ['cfg', 5], ['sampler_name', 'euler'], ['scheduler', 'normal'], ['denoise', 1]], [['model', 'MODEL', 3], ['positive', 'CONDITIONING', 4], ['negative', 'CONDITIONING', 5], ['latent_image', 'LATENT', 6]]));
  判('两个采样器时报不唯一', G.读口(两采样器).data.采样器不唯一 === true);
  判('两个采样器时仍只认主采样器那一组口', G.读口(两采样器).data.正向.length === 1);

  // 一个节点同时带 positive / negative 两个文本字段：两边的口都要认得出
  const 双字段 = 造图();
  双字段.nodes = 双字段.nodes.filter((n) => ![6, 7].includes(n.id));
  双字段.links = 双字段.links.filter((l) => ![1, 2, 4, 5].includes(l[0]));
  双字段.nodes.find((n) => n.id === 3).inputs = 双字段.nodes.find((n) => n.id === 3).inputs
    .filter((i) => !['positive', 'negative'].includes(i.name));
  双字段.nodes.push(节点(50, 'easy fullLoader', [['positive', 'P'], ['negative', 'N']]));
  const 双 = G.读口(双字段);
  判('一个节点带正负两个字段时两边的口都认得出',
    双.ok && 双.data.正向.length === 1 && 双.data.负向.length === 1,
    双.ok ? `正向 ${JSON.stringify(双.data.正向.map((x) => x.input))} 负向 ${JSON.stringify(双.data.负向.map((x) => x.input))}` : 双.reason);
  判('两边的口落在同一个节点的两个字段上',
    双.ok && 双.data.正向[0].nodeId === '50' && 双.data.正向[0].input === 'positive'
      && 双.data.负向[0].nodeId === '50' && 双.data.负向[0].input === 'negative');
}

段('图 · 填口');
{
  const 填 = G.填口(造图(), { 正向: 'AAA', 负向: 'BBB' });
  判('填得进去', 填.ok, 填.reason);
  if (填.ok) {
    判('正向写到它那个口', 填.data.接口图['6'].inputs.text === 'AAA');
    判('负向写到它那个口', 填.data.接口图['7'].inputs.text === 'BBB');
    判('回执列出填了哪几处', 填.data.填了的.正向[0] === '6.text' && 填.data.填了的.负向[0] === '7.text');
  }

  const 原件 = 造图();
  const 原件文本 = 原件.nodes.find((n) => n.id === 6).widgets_values[0];
  G.填口(原件, { 正向: 'CCC' });
  判('填口不改入参', 原件.nodes.find((n) => n.id === 6).widgets_values[0] === 原件文本);

  const 只填正 = G.填口(造图(), { 正向: '只要正向' });
  判('只给正向时不动负向', 只填正.ok && 只填正.data.接口图['7'].inputs.text === 'an old negative');

  const 给图 = G.填口(造图生图(), { 正向: 'A', 图片: 'input-x.png' });
  判('图片写得进图片口', 给图.ok && 给图.data.接口图['20'].inputs.image === 'input-x.png');

  const 无图口 = G.填口(造图(), { 正向: 'A', 图片: 'x.png' });
  判('图上不收图片时报错', !无图口.ok && 无图口.code === G.ERR.BAD_PARAM);

  const 两处 = G.填口(造合并图(), { 正向: 'SAME' });
  判('正向接两处时两处都写', 两处.ok && 两处.data.填了的.正向.length === 2,
    两处.ok ? `实为 ${JSON.stringify(两处.data.填了的.正向)}` : 两处.reason);
}

段('图 · 静音 / 旁路 / 中转 / 控件转输入');
{
  // 静音（mode 2）的节点不执行
  const 静音 = 造图();
  静音.nodes.find((n) => n.id === 9).mode = 2;
  const 静图 = G.界面图转接口图(静音);
  判('静音节点不进接口图', 静图.ok && !静图.data['9'], 静图.ok ? Object.keys(静图.data).join(',') : 静图.reason);

  // 旁路（mode 4）：节点不执行，输出按类型接到上游
  const 旁路 = 造图();
  旁路.nodes.push({
    ...节点(25, 'ImageScale', [['upscale_method', 'nearest'], ['width', 512], ['height', 512]]),
    inputs: [{ name: 'image', type: 'IMAGE', link: 10 }, { name: 'upscale_method', type: 'STRING', link: null, widget: { name: 'upscale_method' } }],
    outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [11], slot_index: 0 }],
    mode: 4,
  });
  旁路.nodes.find((n) => n.id === 8).outputs[0].links = [10];
  旁路.nodes.find((n) => n.id === 9).inputs.find((i) => i.name === 'images').link = 11;
  旁路.links.push([10, 8, 0, 25, 0, 'IMAGE'], [11, 25, 0, 9, 0, 'IMAGE']);
  const 旁图 = G.界面图转接口图(旁路);
  判('旁路节点不进接口图', 旁图.ok && !旁图.data['25']);
  判('旁路的下游按类型接到上游', 旁图.ok && 旁图.data['9'].inputs.images[0] === '8' && 旁图.data['9'].inputs.images[1] === 0,
    旁图.ok ? JSON.stringify(旁图.data['9'].inputs.images) : 旁图.reason);

  // 中转（Reroute）：不进图，输出接到上游
  const 中转 = 造图();
  中转.nodes.push({
    id: 26,
    type: 'Reroute',
    pos: [0, 0],
    size: [20, 20],
    flags: {},
    order: 26,
    mode: 0,
    inputs: [{ name: '', type: 'IMAGE', link: 10 }],
    outputs: [{ name: '', type: 'IMAGE', links: [11], slot_index: 0 }],
    properties: {},
    widgets_values: [],
  });
  中转.nodes.find((n) => n.id === 8).outputs[0].links = [10];
  中转.nodes.find((n) => n.id === 9).inputs.find((i) => i.name === 'images').link = 11;
  中转.links.push([10, 8, 0, 26, 0, 'IMAGE'], [11, 26, 0, 9, 0, 'IMAGE']);
  const 转图 = G.界面图转接口图(中转);
  判('中转节点不进接口图', 转图.ok && !转图.data['26']);
  判('中转的下游接到上游', 转图.ok && 转图.data['9'].inputs.images[0] === '8');

  // 控件被转成输入（widgets_values 少了那个位），源头是 PrimitiveNode
  const 定义 = {
    KSampler: {
      input: {
        required: {
          model: ['MODEL'],
          seed: ['INT', { control_after_generate: true }],
          steps: ['INT'], cfg: ['FLOAT'],
          sampler_name: [['euler', 'dpmpp_2m']], scheduler: [['normal', 'karras']],
          positive: ['CONDITIONING'], negative: ['CONDITIONING'], latent_image: ['LATENT'], denoise: ['FLOAT'],
        },
      },
    },
  };
  const 原图 = 造图();
  const 采样器 = 原图.nodes.find((n) => n.id === 3);
  采样器.widgets_values = [20, 7, 'euler', 'normal', 1];
  采样器.inputs.find((i) => i.name === 'seed').link = 12;
  原图.nodes.push({
    id: 27,
    type: 'PrimitiveNode',
    pos: [0, 0],
    size: [20, 20],
    flags: {},
    order: 27,
    mode: 0,
    inputs: [],
    outputs: [{ name: 'INT', type: 'INT', links: [12], slot_index: 0 }],
    properties: {},
    widgets_values: [999],
  });
  原图.links.push([12, 27, 0, 3, 0, 'INT']);
  const 原转 = G.界面图转接口图(原图, 定义);
  判('PrimitiveNode 的值写进那一格', 原转.ok && 原转.data['3'].inputs.seed === 999,
    原转.ok ? JSON.stringify(原转.data['3'].inputs.seed) : 原转.reason);
  判('控件转输入后后面的控件不错位',
    原转.ok && 原转.data['3'].inputs.steps === 20 && 原转.data['3'].inputs.cfg === 7
      && 原转.data['3'].inputs.sampler_name === 'euler' && 原转.data['3'].inputs.scheduler === 'normal',
    原转.ok ? JSON.stringify(原转.data['3'].inputs) : 原转.reason);

  // 类名像图片节点，但没有装文件名的键
  const 掩码 = 造图();
  掩码.nodes.push(节点(20, 'LoadImageMask', [['channel', 'alpha']]));
  判('图片类节点没有装文件名的键时不算口', G.读口(掩码).data.图片.length === 0);

  // 图片口已经连着线
  const 连图 = 造图生图();
  连图.nodes.find((n) => n.id === 20).inputs.find((i) => i.name === 'image').link = 10;
  const 连填 = G.填口(连图, { 图片: 'x.png' });
  判('图片口是连线时填口报错', !连填.ok && 连填.code === G.ERR.BAD_PARAM, 连填.reason);
}

段('图 · 拒收读不懂的图');
{
  const 坏 = G.界面图转接口图({ garbage: true });
  判('不是图就拒', !坏.ok);

  const 没控件名 = 造图();
  const k = 没控件名.nodes.find((n) => n.id === 3);
  k.inputs = k.inputs.filter((i) => !i.widget).map((i) => ({ name: i.name, type: i.type, link: i.link }));
  判('控件声明被抹掉时按位置兜底', G.界面图转接口图(没控件名).ok);

  const 空 = G.界面图转接口图({ nodes: [], links: [] });
  判('空图拒收', !空.ok && 空.code === G.ERR.NO_GRAPH);

  // 界面图的 id 是 UUID 形状
  const U = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const 怪id = { ...造图(), id: 'not-a-uuid' };
  判('id 不是 UUID 时补一个', U.test(G.补图id(怪id).id));
  判('id 已经是 UUID 时不动', G.补图id({ ...怪id, id: 'ded1e747-037e-475e-9fc5-292edb58a70c' }).id === 'ded1e747-037e-475e-9fc5-292edb58a70c');
  判('没有 id 时补一个', U.test(G.补图id({ ...怪id, id: undefined }).id));
  判('补 id 不改入参', 怪id.id === 'not-a-uuid');

  // 定义里带开关位的参数（seed 后面跟一个 control_after_generate）按两位走
  const 带开关 = 造图();
  const k2 = 带开关.nodes.find((n) => n.id === 3);
  k2.widgets_values = [123, 'fixed', 20, 7, 'euler', 'normal', 1];
  k2.inputs = k2.inputs.filter((i) => !i.widget);
  const 定 = { KSampler: { input: { required: { seed: ['INT', { control_after_generate: true }], steps: ['INT'], cfg: ['FLOAT'] } } } };
  const 开关转 = G.界面图转接口图(带开关, 定);
  判('定义说 seed 带开关位时按两位走', 开关转.ok && 开关转.data['3'].inputs.steps === 20 && 开关转.data['3'].inputs.cfg === 7,
    开关转.ok ? JSON.stringify(开关转.data['3'].inputs) : 开关转.reason);
}

/* ------------------------------------------------------------------ 端口 */

段('端口');
{
  判('端口齐全时通过', checkPort(createMemoryAdapter()).ok);
  判('HTTP 适配器的七个方法齐全', checkPort(createHttpAdapter({ 地址: 'http://comfy.test' })).ok);
  判('固定地址与动态地址不可同时传入', (() => { try { createHttpAdapter({ 地址: 'http://a', 取地址: () => 'http://b' }); return false; } catch { return true; } })());
  判('端口缺方法时点名', (() => {
    const r = checkPort({ 探活: () => {} });
    return !r.ok && r.reason.includes('看队列');
  })());
  判('连不上归到连不上', reasonOf({ code: 'ECONNREFUSED' }) === '连不上');
  判('cause 里的码也认', reasonOf({ message: 'fetch failed', cause: { code: 'ECONNREFUSED' } }) === '连不上');
  判('超时归到超时', reasonOf({ name: 'AbortError' }) === '超时');
  判('缺地址时抛错', (() => {
    try { createHttpAdapter({}); return false; } catch { return true; }
  })());
}

/* ------------------------------------------------------- HTTP 适配器（假取回） */

/** 造一个应答。 */
function 造应答(状态, 体, 类型 = 'application/json') {
  const 是二进制 = 类型.startsWith('image/');
  return {
    status: 状态,
    headers: { get: (名) => (名.toLowerCase() === 'content-type' ? 类型 : null) },
    text: async () => (typeof 体 === 'string' ? 体 : JSON.stringify(体)),
    arrayBuffer: async () => {
      const b = Buffer.isBuffer(体) ? 体 : Buffer.from(是二进制 ? 体 : String(体));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  };
}

/** 造一个取回函数：路由表是 路径 → 处理函数。 */
function 造取回(路由) {
  const 去过 = [];
  const 取回 = async (url, init = {}) => {
    const 路径 = String(url).replace('http://comfy.test', '');
    去过.push({ 路径, 方法: init.method || 'GET', init });
    const 处理 = 路由[路径];
    if (!处理) throw Object.assign(new Error(`没有这条路由：${路径}`), { code: 'ECONNREFUSED' });
    return 处理(init, 路径);
  };
  return { 取回, 去过 };
}

段('HTTP 适配器');
(async () => {
  const 好路由 = {
    '/system_stats': () => 造应答(200, { system: { comfyui_version: '9.9.9' }, devices: [{ name: '假卡', vram_total: 100, vram_free: 50 }] }),
    '/queue': () => 造应答(200, { queue_running: [1, 2], queue_pending: [3] }),
    '/object_info': () => 造应答(200, { KSampler: { output_node: false } }),
    '/prompt': () => 造应答(200, { prompt_id: 'p-1' }),
    '/history/p-1': () => 造应答(200, {
      'p-1': {
        status: { status_str: 'success', completed: true },
        outputs: { 9: { images: [{ filename: 'a_00001_.png', subfolder: '', type: 'output' }] } },
      },
    }),
    '/view?filename=a_00001_.png&subfolder=&type=output': () => 造应答(200, Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png'),
    '/upload/image': () => 造应答(200, { name: 'sent.png', subfolder: '', type: 'input' }),
  };
  const { 取回, 去过 } = 造取回(好路由);
  const 适配器 = createHttpAdapter({ 地址: 'http://comfy.test/', 取回 });

  const 活 = await 适配器.探活();
  判('探活给版本与设备', 活.ok && 活.data.版本 === '9.9.9' && 活.data.设备 === '假卡' && 活.data.显存可用 === 50, 活.reason);

  let dynamicAddress = 'http://first.test';
  const dynamicSeen = [];
  const 动态适配器 = createHttpAdapter({ 取地址: () => dynamicAddress, 取回: async url => {
    dynamicSeen.push(url);
    return 造应答(200, { system: { comfyui_version: 'x' }, devices: [] });
  } });
  await 动态适配器.探活();
  dynamicAddress = 'http://second.test';
  await 动态适配器.探活();
  判('请求开始时读取当前地址', dynamicSeen[0] === 'http://first.test/system_stats' && dynamicSeen[1] === 'http://second.test/system_stats');
  判('固定地址与动态地址不可同时传入', (() => { try { createHttpAdapter({ 地址: 'http://a', 取地址: () => 'http://b' }); return false; } catch { return true; } })());

  const 队列 = await 适配器.看队列();
  判('看队列数两个数', 队列.ok && 队列.data.运行中 === 2 && 队列.data.排队中 === 1);

  const 定义 = await 适配器.看节点定义();
  判('看节点定义给节点表', 定义.ok && Boolean(定义.data.KSampler));

  const 提交 = await 适配器.提交({ 3: { class_type: 'KSampler', inputs: {} } }, { clientId: 'c-1', 界面图: { nodes: [], links: [] } });
  判('提交给任务号', 提交.ok && 提交.data.任务号 === 'p-1', 提交.reason);
  const 提交体 = JSON.parse(去过.find((x) => x.路径 === '/prompt').init.body);
  判('提交带 client_id', 提交体.client_id === 'c-1');
  判('提交带界面图', Boolean(提交体.extra_data.extra_pnginfo.workflow.nodes));
  判('提交把接口图放在 prompt 下', Boolean(提交体.prompt['3'].class_type));

  const 任务 = await 适配器.看任务('p-1');
  判('看任务给完成与产出', 任务.ok && 任务.data.完成 === true && 任务.data.产出[0].文件名 === 'a_00001_.png', 任务.reason);
  判('产出的种类归到 image', 任务.ok && 任务.data.产出[0].种类 === 'image');

  const 取回文件 = await 适配器.取结果文件('a_00001_.png', { 子目录: '', 类型: 'output' });
  判('取结果文件给字节', 取回文件.ok && 取回文件.data.字节.length === 4 && 取回文件.data.mime === 'image/png', 取回文件.reason);

  const 送 = await 适配器.送图片(Buffer.from([1, 2, 3]), 'ref.png', 'image/png');
  判('送图片给回来的文件名', 送.ok && 送.data.文件名 === 'sent.png' && 送.data.类型 === 'input', 送.reason);
  判('送图片走的是表单', 去过.some((x) => x.路径 === '/upload/image' && typeof x.init.body.append === 'function'));

  // 失败路径
  const 空 = await 适配器.送图片(null, 'ref.png');
  判('没有字节时不发请求', !空.ok && 空.code === 'COMFY_BYTES_REQUIRED');

  const 非JSON = createHttpAdapter({ 地址: 'http://comfy.test', 取回: 造取回({ '/system_stats': () => 造应答(200, '<html>', 'text/html') }).取回 });
  判('返回的不是 JSON 时报出来', (await 非JSON.探活()).code === 'COMFY_NOT_JSON');

  const 连不上 = createHttpAdapter({ 地址: 'http://comfy.test', 取回: 造取回({}).取回 });
  const 断 = await 连不上.探活();
  判('连不上时归到连不上', !断.ok && 断.code === 'COMFY_UNREACHABLE' && 断.details.reason === '连不上', 断.reason);

  const 拒收 = createHttpAdapter({
    地址: 'http://comfy.test',
    取回: 造取回({
      '/prompt': () => 造应答(400, {
        error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation' },
        node_errors: { 3: { class_type: 'KSampler', errors: [{ message: 'Value not in list', extra_info: { input_name: 'sampler_name', input_config: [['euler', 'dpmpp_2m']] } }] } },
      }),
    }).取回,
  });
  const 被拒 = await 拒收.提交({ 3: { class_type: 'KSampler', inputs: {} } });
  判('400 时报参数被拒', !被拒.ok && 被拒.code === 'COMFY_PROMPT_REJECTED', 被拒.reason);
  判('400 时带上节点报错原文', !被拒.ok && 被拒.reason.includes('sampler_name') && 被拒.reason.includes('euler'), 被拒.reason);

  const 服务端错 = createHttpAdapter({ 地址: 'http://comfy.test', 取回: 造取回({ '/prompt': () => 造应答(500, { error: { message: '内部错' } }) }).取回 });
  const 未知 = await 服务端错.提交({ 3: { class_type: 'KSampler', inputs: {} } });
  判('5xx 时报提交结果未知', !未知.ok && 未知.code === 'COMFY_SUBMIT_UNKNOWN', 未知.reason);

  const 没号 = createHttpAdapter({ 地址: 'http://comfy.test', 取回: 造取回({ '/prompt': () => 造应答(200, {}) }).取回 });
  判('没给任务号时报未知', (await 没号.提交({ 3: { class_type: 'KSampler', inputs: {} } })).code === 'COMFY_SUBMIT_UNKNOWN');

  const 没有这任务 = createHttpAdapter({ 地址: 'http://comfy.test', 取回: 造取回({ '/history/x': () => 造应答(404, {}) }).取回 });
  const 无历史 = await 没有这任务.看任务('x');
  判('历史里没有这条时给 unknown', 无历史.ok && 无历史.data.状态 === 'unknown' && 无历史.data.完成 === false);

  const 没有这文件 = createHttpAdapter({ 地址: 'http://comfy.test', 取回: 造取回({ '/view?filename=x.png&subfolder=&type=output': () => 造应答(404, '') }).取回 });
  判('文件不在时报文件不在', (await 没有这文件.取结果文件('x.png')).code === 'COMFY_FILE_MISSING');

  判('看任务不给任务号时报错', (await 适配器.看任务('')).code === 'COMFY_TASK_REQUIRED');

  /* ------------------------------------------------------------------ 核心 */

  段('核心 · 连接与存档');
  const 存档 = 造存档();
  const 核心适配器 = createMemoryAdapter();
  const core = createCore({ port: 核心适配器, 存档, 等待: async () => {} });

  const 关机端口 = createMemoryAdapter();
  const 计数 = { 节点: 0, 图片: 0, 提交: 0 };
  const 关机核心 = createCore({ port: {
    ...关机端口,
    看节点定义: async (...a) => { 计数.节点 += 1; return 关机端口.看节点定义(...a); },
    送图片: async (...a) => { 计数.图片 += 1; return 关机端口.送图片(...a); },
    提交: async (...a) => { 计数.提交 += 1; return 关机端口.提交(...a); },
  }, 存档: 造存档(), 等待: async () => {} });
  关机核心.存工作流(造图生图());
  const 关闭出图 = await 关机核心.出图({ 正向: 'A', 图片: { 字节: Buffer.from([1]) } });
  判('默认关闭时出图返回明确错误', !关闭出图.ok && 关闭出图.code === 'COMFY_DISABLED'
    && 关闭出图.reason === 'COMFY_DISABLED: 绘图已关闭，请先勾选“启用绘图”');
  判('关闭时不请求节点定义、不上传图片、不提交',计数.节点 === 0 && 计数.图片 === 0 && 计数.提交 === 0);

  let 解除节点定义;
  let 已开始取定义;
  const 定义开始 = new Promise((完成) => { 已开始取定义 = 完成; });
  const 定义等待 = new Promise((完成) => { 解除节点定义 = 完成; });
  const 并发端口原 = createMemoryAdapter();
  let 并发提交数 = 0;
  const 并发核心 = createCore({ port: {
    ...并发端口原,
    看节点定义: () => { 已开始取定义(); return 定义等待; },
    提交: async (...a) => { 并发提交数 += 1; return 并发端口原.提交(...a); },
  }, 存档: 造存档(), 等待: async () => {} });
  并发核心.存工作流(造图());
  并发核心.绘图开关(true);
  const 并发出图 = 并发核心.出图({ 正向: 'A' });
  await 定义开始;
  并发核心.绘图开关(false);
  解除节点定义({ ok: true, data: (await createMemoryAdapter().看节点定义()).data });
  const 并发回执 = await 并发出图;
  判('节点定义等待期间关闭后提交前拒绝', !并发回执.ok && 并发回执.code === 'COMFY_DISABLED');
  判('提交前复查开关后不提交任务', 并发提交数 === 0);

  let 解除图片上传;
  let 已开始上传;
  const 上传开始 = new Promise((完成) => { 已开始上传 = 完成; });
  const 上传等待 = new Promise((完成) => { 解除图片上传 = 完成; });
  const 上传端口原 = createMemoryAdapter();
  let 上传竞态提交数 = 0;
  const 上传竞态核心 = createCore({ port: {
    ...上传端口原,
    送图片: () => { 已开始上传(); return 上传等待; },
    提交: async (...a) => { 上传竞态提交数 += 1; return 上传端口原.提交(...a); },
  }, 存档: 造存档(), 等待: async () => {} });
  上传竞态核心.存工作流(造图生图());
  上传竞态核心.绘图开关(true);
  const 上传竞态出图 = 上传竞态核心.出图({ 正向: 'A', 图片: { 字节: Buffer.from([1]) } });
  await 上传开始;
  上传竞态核心.绘图开关(false);
  解除图片上传({ ok: true, data: { 文件名: 'input.png', 子目录: '', 类型: 'input' } });
  const 上传竞态回执 = await 上传竞态出图;
  判('图片上传等待期间关闭后提交前拒绝', !上传竞态回执.ok && 上传竞态回执.code === 'COMFY_DISABLED');
  判('图片上传完成后再次复查并阻止提交', 上传竞态提交数 === 0);

  const 核心活 = await core.探活();
  判('探活给版本', 核心活.ok && 核心活.data.版本 === 'memory-0.0.1');

  const 核心队列 = await core.看队列();
  判('看队列给两个数', 核心队列.ok && 核心队列.data.运行中 === 0 && 核心队列.data.排队中 === 0);

  const 核心定义 = await core.看节点定义();
  判('核心看节点定义给节点表（并缓存）', 核心定义.ok && Boolean(核心定义.data.KSampler));

  判('没工作流时取工作流报错', !core.取工作流().ok);
  判('没工作流时认口报错', !core.认().ok);
  判('无工作流时开关缺省关闭', core.绘图开关().ok && core.绘图开关().data.启用 === false);
  判('无工作流时可以单独打开开关', core.绘图开关(true).ok && core.绘图开关().data.启用 === true);
  判('只有开关记录时仍然没有工作流', core.取工作流().code === 'COMFY_NO_WORKFLOW');

  const 存 = core.存工作流(造图());
  core.绘图开关(true);
  判('存得下', 存.ok, 存.reason);
  判('存的是界面图', 存.ok && Boolean(存.data.界面图.nodes));
  判('存档里带了认口结果', 存.ok && 存.data.口.正向.length === 1);
  判('存工作流保留启用状态', 存.ok && 存.data.启用 === true);

  判('生成设置缺省为每轮1张最多3轮并自动迭代', core.生成设置().ok
    && JSON.stringify(core.生成设置().data) === JSON.stringify({ 每轮张数: 1, 最多轮数: 3, 自动迭代: true }));
  判('生成设置写入存档并读出固定字段副本', core.生成设置({ 每轮张数: 2, 最多轮数: 5, 自动迭代: false, 附加项: 9 }).ok
    && JSON.stringify(core.生成设置().data) === JSON.stringify({ 每轮张数: 2, 最多轮数: 5, 自动迭代: false }));
  判('生成设置出口是副本', (() => { const x = core.生成设置(); x.data.每轮张数 = 99; return core.生成设置().data.每轮张数 === 2; })());
  判('写生成设置时不覆盖工作流', core.取工作流().ok && core.生成设置().data.每轮张数 === 2);

  const 认 = core.认();
  判('认得回可填三项', 认.ok && 认.data.可填.length === 3);
  判('可填里正向后带当前值', 认.ok && 认.data.可填[0].现在.includes('an old prompt'));
  判('认可看到采样器唯不唯一', 认.ok && 认.data.采样器不唯一 === false && 认.data.采样器 === '3');

  const 多采样器 = createCore({ port: createMemoryAdapter(), 存档: 造存档(), 等待: async () => {} });
  const 两张采样器 = 造图();
  两张采样器.nodes.push(节点(40, 'KSampler', [['seed', 2], ['steps', 8], ['cfg', 4], ['sampler_name', 'euler'], ['scheduler', 'normal'], ['denoise', 1]], [['model', 'MODEL', 3], ['positive', 'CONDITIONING', 4], ['negative', 'CONDITIONING', 5], ['latent_image', 'LATENT', 6]]));
  多采样器.存工作流(两张采样器);
  多采样器.绘图开关(true);
  判('两个采样器时认回报不唯一', 多采样器.认().data.采样器不唯一 === true);

  const 清 = core.清工作流();
  判('清得掉', 清.ok && core.取工作流().ok === false);
  判('清工作流保留启用状态', core.绘图开关().data.启用 === true);
  判('清工作流保留生成设置', core.生成设置().data.每轮张数 === 2);

  段('核心 · 出图');
  const 存档2 = 造存档();
  const 记图 = createMemoryAdapter({
    状态序列: ['running', 'running', 'success'],
    文件: { 'memory_00001_.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  });
  const core2 = createCore({ port: 记图, 存档: 存档2, 等待: async () => {}, 现在: () => 0 });
  core2.存工作流(造图());
  core2.绘图开关(true);

  const 事件 = [];
  const 跑 = await core2.出图({ 正向: 'hakurei reimu, eating apple', 负向: 'low quality', onEvent: (e) => 事件.push(e.类型) });
  判('出图跑通', 跑.ok, 跑.reason);
  判('给了任务号', 跑.ok && 跑.data.任务号 === 'mem-1');
  判('给了产出清单', 跑.ok && 跑.data.产出.length === 1 && 跑.data.产出[0].文件名 === 'memory_00001_.png');
  判('提交前发提交中事件', 事件[0] === '提交中');
  判('事件按顺序报出来', 事件.join('/') === '提交中/已提交/状态/状态/完成', 事件.join('/'));

  const 提交的 = 记图.记.提交过的[0];
  判('提交的是接口图', Boolean(提交的.接口图['3'].class_type));
  判('提交带了界面图', Boolean(提交的.附带.界面图 && 提交的.附带.界面图.nodes));
  判('正向真写进了图', 提交的.接口图['6'].inputs.text === 'hakurei reimu, eating apple');
  判('负向真写进了图', 提交的.接口图['7'].inputs.text === 'low quality');

  const 取 = await core2.取图(跑.data.产出[0]);
  判('取图给字节', 取.ok && 取.data.字节.length === 4, 取.reason);

  const 指定张数适配器 = createMemoryAdapter();
  const 指定张数核心 = createCore({ port: 指定张数适配器, 存档: 造存档(), 等待: async () => {} });
  指定张数核心.存工作流(造图());
  指定张数核心.绘图开关(true);
  const 指定张数回执 = await 指定张数核心.出图({ 正向: 'A', 张数: 4 });
  判('出图把显式张数写进工作流批量入口', 指定张数回执.ok
    && 指定张数适配器.记.提交过的[0].接口图['5'].inputs.batch_size === 4);

  const 无张数口适配器 = createMemoryAdapter();
  const 无张数口核心 = createCore({ port: 无张数口适配器, 存档: 造存档(), 等待: async () => {} });
  无张数口核心.存工作流(造图生图());
  无张数口核心.绘图开关(true);
  const 无张数口回执 = await 无张数口核心.出图({ 正向: 'A', 张数: 1 });
  判('显式张数但图上无可确认入口时不提交', !无张数口回执.ok
    && 无张数口回执.code === 'INVALID_ARGUMENT' && 无张数口适配器.记.提交过的.length === 0);

  let 取消提交数 = 0;
  const 已取消 = new AbortController();
  已取消.abort();
  const 取消提交端口 = createMemoryAdapter();
  const 取消提交核心 = createCore({ port: {
    ...取消提交端口,
    提交: async (...a) => { 取消提交数 += 1; return 取消提交端口.提交(...a); },
  }, 存档: 造存档(), 等待: async () => {} });
  取消提交核心.存工作流(造图());
  取消提交核心.绘图开关(true);
  const 取消提交回执 = await 取消提交核心.出图({ 正向: 'A', 信号: 已取消.signal });
  判('提交前取消时不调用端口提交', !取消提交回执.ok && 取消提交回执.code === 'COMFY_CANCELLED' && 取消提交数 === 0);

  const 事件取消控制器 = new AbortController();
  let 事件取消提交数 = 0;
  const 事件取消端口 = createMemoryAdapter();
  const 事件取消核心 = createCore({ port: {
    ...事件取消端口,
    提交: async (...a) => { 事件取消提交数 += 1; return 事件取消端口.提交(...a); },
  }, 存档: 造存档(), 等待: async () => {} });
  事件取消核心.存工作流(造图());
  事件取消核心.绘图开关(true);
  const 事件取消回执 = await 事件取消核心.出图({ 正向: 'A', 信号: 事件取消控制器.signal,
    onEvent: (事件) => { if (事件.类型 === '提交中') 事件取消控制器.abort(); } });
  判('提交中回调取消时仍不调用端口提交', !事件取消回执.ok
    && 事件取消回执.code === 'COMFY_CANCELLED' && 事件取消提交数 === 0);

  段('核心 · 出图的失败路径');
  // 第一次卡在 running：等待函数给一个不结束的 Promise
  const 永不 = () => new Promise(() => {});
  const 忙 = createCore({ port: createMemoryAdapter({ 状态序列: ['running'] }), 存档: 造存档(), 等待: 永不 });
  忙.存工作流(造图());
  忙.绘图开关(true);
  const 第一 = 忙.出图({ 正向: 'A' });
  await new Promise((好) => setTimeout(好, 10));
  判('在跑吗为真', 忙.在跑吗() === true);
  const 第二 = await 忙.出图({ 正向: 'B' });
  判('同时只允许一次', !第二.ok && 第二.code === 'COMFY_BUSY', 第二.reason);
  await 忙.绘图开关(false);
  判('关闭开关不取消在飞任务', 忙.在跑吗() === true);
  void 第一;

  const 提交失败 = createCore({ port: createMemoryAdapter({ 提交失败: '节点 3 的 steps 超范围' }), 存档: 造存档(), 等待: async () => {} });
  提交失败.存工作流(造图());
  提交失败.绘图开关(true);
  const 败1 = await 提交失败.出图({ 正向: 'A' });
  判('提交失败如实报', !败1.ok && 败1.reason.includes('超范围'));

  const 执行失败 = createCore({ port: createMemoryAdapter({ 状态序列: ['error'], 执行失败话: 'CUDA out of memory' }), 存档: 造存档(), 等待: async () => {} });
  执行失败.存工作流(造图());
  执行失败.绘图开关(true);
  const 败2 = await 执行失败.出图({ 正向: 'A' });
  判('执行失败带原文', !败2.ok && 败2.reason.includes('CUDA out of memory'));

  const 超时 = createCore({ port: createMemoryAdapter({ 状态序列: ['running'] }), 存档: 造存档(), 等待: async () => {}, 现在: (() => { let t = 0; return () => (t += 60000); })() });
  超时.存工作流(造图());
  超时.绘图开关(true);
  const 败6 = await 超时.出图({ 正向: 'A' });
  判('盯太久就报超时', !败6.ok && 败6.code === 'COMFY_TIMEOUT', 败6.reason);

  // 采样器的 positive 断了，但图上还有文本节点 → 兜底认出它
  const 断线 = createCore({ port: createMemoryAdapter(), 存档: 造存档(), 等待: async () => {} });
  const 只有文本 = 造图();
  只有文本.links = 只有文本.links.filter((l) => l[0] !== 4);
  只有文本.nodes.find((n) => n.id === 3).inputs = 只有文本.nodes.find((n) => n.id === 3).inputs.filter((i) => i.name !== 'positive');
  断线.存工作流(只有文本);
  断线.绘图开关(true);
  const 兜底 = 断线.认();
  判('采样器没挂正但图上有文本节点时兜底认出', 兜底.ok && 兜底.data.正向.length === 1, 兜底.ok ? '' : 兜底.reason);

  // 采样器上没有任何条件输入，但图里还有两个空的文本节点 → 照样认得出两个口
  const 空图 = createCore({ port: createMemoryAdapter(), 存档: 造存档(), 等待: async () => {} });
  const 两个空口 = 造图();
  两个空口.nodes.find((n) => n.id === 6).widgets_values[0] = '';
  两个空口.nodes.find((n) => n.id === 7).widgets_values[0] = '';
  两个空口.links = 两个空口.links.filter((l) => ![4, 5].includes(l[0]));
  两个空口.nodes.find((n) => n.id === 3).inputs = 两个空口.nodes.find((n) => n.id === 3).inputs
    .filter((i) => !['positive', 'negative'].includes(i.name));
  空图.存工作流(两个空口);
  空图.绘图开关(true);
  const 空口认 = 空图.认();
  判('空文本节点也算口', 空口认.ok && 空口认.data.正向.length === 1 && 空口认.data.负向.length === 1, 空口认.ok ? '' : 空口认.reason);
  判('正负口不落在同一个节点', 空口认.ok && 空口认.data.正向[0].nodeId !== 空口认.data.负向[0].nodeId);

  // 图上一个文本节点都没有 → 认不出就是认不出
  const 无正 = createCore({ port: createMemoryAdapter(), 存档: 造存档(), 等待: async () => {} });
  const 光杆 = 造图();
  光杆.nodes = 光杆.nodes.filter((n) => ![6, 7].includes(n.id));
  光杆.links = 光杆.links.filter((l) => ![1, 2, 4, 5].includes(l[0]));
  光杆.nodes.find((n) => n.id === 3).inputs = 光杆.nodes.find((n) => n.id === 3).inputs
    .filter((i) => !['positive', 'negative'].includes(i.name));
  无正.存工作流(光杆);
  无正.绘图开关(true);
  const 败3 = await 无正.出图({ 正向: 'A' });
  判('图上没有文本节点时报错', !败3.ok && 败3.code === G.ERR.NO_PROMPT, 败3.reason);

  const 取消 = new AbortController();
  取消.abort();
  const 有取消 = createCore({ port: createMemoryAdapter({ 状态序列: ['running'] }), 存档: 造存档(), 等待: async () => {} });
  有取消.存工作流(造图());
  有取消.绘图开关(true);
  const 败5 = await 有取消.出图({ 正向: 'A', 信号: 取消.signal });
  判('取消时如实报取消', !败5.ok && 败5.code === 'COMFY_CANCELLED');

  const 送不出去 = createCore({ port: createMemoryAdapter({ 状态序列: ['running'] }), 存档: 造存档(), 等待: async () => {} });
  送不出去.存工作流(造图());
  送不出去.绘图开关(true);
  const 败7 = await 送不出去.出图({ 正向: 'A', 图片: { 字节: Buffer.from([1]) } });
  判('图上没有图片口时拒收图片', !败7.ok && 败7.code === 'INVALID_ARGUMENT', 败7.reason);

  段('核心 · 送图片');
  const 记送 = createMemoryAdapter();
  const 带图 = createCore({ port: 记送, 存档: 造存档(), 等待: async () => {} });
  带图.存工作流(造图生图());
  带图.绘图开关(true);
  const 跑图 = await 带图.出图({ 正向: 'A', 图片: { 字节: Buffer.from([1, 2, 3]), 文件名: 'ref.png', mime: 'image/png' } });
  判('送图片跑通', 跑图.ok, 跑图.reason);
  判('字节送到了端口', 记送.记.送过的[0].字节数 === 3);
  判('图片名写进了图', 记送.记.提交过的[0].接口图['20'].inputs.image === 'input-ref.png');
  判('送图片的事件在前', 跑图.ok && 跑图.data.填了的.图片[0] === '20.image');

  const 子目录端口 = createMemoryAdapter();
  const 带子目录 = createCore({
    port: { ...子目录端口, 送图片: async () => ({ ok: true, data: { 文件名: 'x.png', 子目录: 'sub', 类型: 'input' } }) },
    存档: 造存档(),
    等待: async () => {},
  });
  带子目录.存工作流(造图生图());
  带子目录.绘图开关(true);
  const 跑子目录 = await 带子目录.出图({ 正向: 'A', 图片: { 字节: Buffer.from([1]) } });
  判('图片有子目录时拼成 子目录/文件名 写进图',
    跑子目录.ok && 子目录端口.记.提交过的[0].接口图['20'].inputs.image === 'sub/x.png',
    跑子目录.ok ? JSON.stringify(子目录端口.记.提交过的[0].接口图['20'].inputs.image) : 跑子目录.reason);

  段('核心 · 端口不守约时');
  const 空提交 = createCore({
    port: { ...createMemoryAdapter(), 提交: async () => ({ ok: true }) },
    存档: 造存档(),
    等待: async () => {},
  });
  空提交.存工作流(造图());
  空提交.绘图开关(true);
  const 败8 = await 空提交.出图({ 正向: 'A' });
  判('端口提交没给任务号时报错不抛错', !败8.ok && 败8.code === 'COMFY_UNREACHABLE', 败8.reason);

  const 空送图 = createCore({
    port: { ...createMemoryAdapter(), 送图片: async () => ({ ok: true, data: null }) },
    存档: 造存档(),
    等待: async () => {},
  });
  空送图.存工作流(造图生图());
  空送图.绘图开关(true);
  const 败9 = await 空送图.出图({ 正向: 'A', 图片: { 字节: Buffer.from([1]) } });
  判('端口送图片没给文件名时报错', !败9.ok && 败9.code === 'COMFY_UNREACHABLE', 败9.reason);

  const 空取件 = createCore({
    port: { ...createMemoryAdapter(), 取结果文件: async () => ({ ok: true, data: {} }) },
    存档: 造存档(),
    等待: async () => {},
  });
  const 败10 = await 空取件.取图({ 文件名: 'x.png' });
  判('端口取文件没给字节时报错', !败10.ok && 败10.code === 'COMFY_UNREACHABLE', 败10.reason);

  /* ---------------------------------------------------------------- 门面 */

  段('门面');
  const comfy = createComfyModule({ port: createMemoryAdapter(), 存档: 造存档(), 等待: async () => {} });
  判('动作表齐全', comfy.actions.length === 13, comfy.actions.join(' '));
  判('describe 每项都有摘要与参数', comfy.describe().every((x) => x.动作 && x.摘要 && Array.isArray(x.参数)));
  判('直呼成功给数据', (await comfy.工作流(造图())) !== null);
  判('直呼失败给 null', (await comfy.认图({ 不是图: 1 })) === null);
  判('run 走动作名', (await comfy.run('认')).ok);
  判('run 给不存在的动作时报错', (await comfy.run('没有这个')).code === G.ERR.BAD_PARAM);
  段('工作流参数');
  {
    const 定义 = {
      KSampler: { input: { required: { seed: ['INT', { min: 0, max: 999, step: 1 }], steps: ['INT', { min: 1, max: 100 }], cfg: ['FLOAT', { min: 0 }], sampler_name: [['euler', 'dpmpp_2m']], scheduler: [['normal', 'karras']] } } },
      EmptyLatentImage: { input: { required: { width: ['INT'], height: ['INT'], batch_size: ['INT'] } } },
      CLIPTextEncode: { input: { required: { text: ['STRING'], clip: ['CLIP'] } } },
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [['model.safetensors']] } } },
      SaveImage: { input: { required: { filename_prefix: ['STRING'] } } },
    };
    const fake = createMemoryAdapter({ 节点定义: 定义 });
    let graph;
    const editable = createComfyModule({ port: fake, 存档: { 读: () => graph, 写: v => { graph = structuredClone(v); return true; }, 清() {} }, 等待: async () => {} });
    await editable.看节点定义();
    await editable.工作流(造图());
    const all = await editable.run('参数');
    判('参数返回实际控件与定义选项', all.ok && all.data.节点.some(n => n.编号 === '3' && n.参数.some(p => p.名称 === 'sampler_name' && p.选项.includes('dpmpp_2m'))));
    const write = await editable.run('参数', { 节点: '3', 参数: 'steps', 值: 31 });
    判('参数写入源工作流并影响提交图', write.ok && graph.界面图.nodes.find(n => n.id === 3).widgets_values[1] === 31);
    await editable.绘图开关(true);
    await editable.run('出图', { 正向: 'test prompt' });
    判('编辑值进入 ComfyUI 提交图', fake.记.提交过的[0].接口图['3'].inputs.steps === 31);
    const connected = await editable.run('参数', { 节点: '3' });
    判('接线输入以只读形式列出', connected.ok && connected.data.节点[0].参数.some(p => p.名称 === 'model' && p.只读));
    const seeded = 造图();
    seeded.nodes.find(n => n.id === 3).widgets_values.splice(1, 0, 'randomize');
    await editable.工作流(seeded);
    const seedParams = await editable.run('参数', { 节点: '3' });
    判('seed 的 control_after_generate 被识别为独立控件', seedParams.ok && seedParams.data.节点[0].参数.some(p => p.名称 === 'seed_control_after_generate' && p.值 === 'randomize'));
    const seedWrite = await editable.run('参数', { 节点: '3', 参数: 'steps', 值: 29 });
    判('编辑 seed 后的参数不覆盖 control_after_generate', seedWrite.ok && graph.界面图.nodes.find(n => n.id === 3).widgets_values[1] === 'randomize' && graph.界面图.nodes.find(n => n.id === 3).widgets_values[2] === 29);
    const custom = 造图();
    custom.nodes.push({ id: 30, type: 'LoraStackEditor', title: 'LoRA 堆栈', inputs: [{ name: 'loras', widget: { name: 'loras' }, link: null }], properties: { __lm_widget_ids: ['loras'] }, widgets_values: [{ name: 'soft-light', strength: 0.7 }] });
    await editable.看节点定义();
    await editable.工作流(custom);
    const objectRead = await editable.run('参数', { 节点: '30' });
    判('LoraManager 对象控件作为只读 JSON 原对象读取', objectRead.ok && objectRead.data.节点[0].参数.some(p => p.名称 === 'loras' && p.类型 === 'JSON' && p.只读 && p.说明.includes('高级工作流 JSON') && p.值.name === 'soft-light'));
    const objectWrite = await editable.run('参数', { 节点: '30', 参数: 'loras', 值: { name: 'soft-light', strength: 0.9 } });
    判('对象控件写回同一映射字段', objectWrite.ok && graph.界面图.nodes.find(n => n.id === 30).widgets_values[0].strength === 0.9);
    const mapped = structuredClone(custom);
    const lm = mapped.nodes.find(n => n.id === 30);
    lm.inputs.push({ name: 'text', widget: { name: 'text' }, link: null });
    lm.properties.__lm_widget_ids = ['text', 'loras'];
    lm.widgets_values = [{ meta: true }, 'the actual text', { name: 'soft-light', strength: 0.7 }];
    const mappedModule = createComfyModule({ port: createMemoryAdapter({ 节点定义: { LoraStackEditor: { input: { required: { text: ['STRING'], loras: ['LORA_STACK'] } } } } }), 存档: { 读: () => graph, 写: v => { graph = structuredClone(v); return true; }, 清() {} }, 等待: async () => {} });
    await mappedModule.看节点定义();
    await mappedModule.工作流(mapped);
    const mappedRead = await mappedModule.run('参数', { 节点: '30' });
    判('LoraManager 对象控件读值位置与 widgets 映射一致', mappedRead.ok && mappedRead.data.节点.find(n => n.编号 === '30').参数.find(p => p.名称 === 'loras').值.name === 'soft-light');
    const mappedWrite = await mappedModule.run('参数', { 节点: '30', 参数: 'loras', 值: { name: 'warm-light', strength: 0.8 } });
    判('LoraManager 对象控件写回映射的对象位置', mappedWrite.ok && graph.界面图.nodes.find(n => n.id === 30).widgets_values[2].name === 'warm-light');
    const unknown = structuredClone(造图());
    unknown.nodes.push({ id: 50, type: 'UnknownCustomNode', title: '未知自定义节点', inputs: [], widgets_values: [12, 'abc', { a: 1 }] });
    await editable.工作流(unknown);
    const unknownRead = await editable.run('参数', { 节点: '50' });
    判('未知节点数组控件展示为只读原始值', unknownRead.ok && unknownRead.data.节点.find(n => n.编号 === '50').参数.some(p => p.名称 === 'widgets_values' && p.只读 && p.说明.includes('高级工作流 JSON') && p.值[2].a === 1));

    let releaseFirstDefinition;
    let definitionCalls = 0;
    const concurrentPort = createMemoryAdapter({ 节点定义: 定义 });
    const concurrentBase = concurrentPort.看节点定义;
    const concurrentModulePort = { ...concurrentPort, 看节点定义: () => {
      definitionCalls += 1;
      if (definitionCalls === 1) return new Promise(resolve => { releaseFirstDefinition = () => concurrentBase().then(resolve); });
      return concurrentBase();
    } };
    let concurrentStore;
    const concurrentModule = createComfyModule({ port: concurrentModulePort, 存档: { 读: () => concurrentStore, 写: v => { concurrentStore = structuredClone(v); return true; }, 清() {} }, 等待: async () => {} });
    await concurrentModule.工作流(造图());
    const delayedWrite = concurrentModule.run('参数', { 节点: '3', 参数: 'steps', 值: 41 });
    while (!releaseFirstDefinition) await new Promise(resolve => setImmediate(resolve));
    const timelyWrite = await concurrentModule.run('参数', { 节点: '3', 参数: 'cfg', 值: 9 });
    releaseFirstDefinition();
    const delayedResult = await delayedWrite;
    const savedSampler = concurrentStore.界面图.nodes.find(n => n.id === 3);
    判('参数定义等待期间的并发写入不会覆盖其他更新', timelyWrite.ok && delayedResult.ok && savedSampler.widgets_values[1] === 41 && savedSampler.widgets_values[2] === 9);
  }
  判('出口冻住了', Object.isFrozen(comfy));
  判('错误码表带上了 HTTP 适配器那几个', comfy.ERR.NOT_JSON === 'COMFY_NOT_JSON' && comfy.ERR.BAD_GRAPH === 'GRAPH_INVALID');
  判('没给端口也没给地址时抛错', (() => {
    try { createComfyModule({}); return false; } catch { return true; }
  })());

  const 门面跑 = createComfyModule({ port: createMemoryAdapter({ 状态序列: ['running', 'success'] }), 存档: 造存档(), 等待: async () => {} });
  await 门面跑.工作流(造图());
  await 门面跑.绘图开关(true);
  const 门面事件 = [];
  const 门面出 = await 门面跑.run('出图', { 正向: 'A', onEvent: (e) => 门面事件.push(e.类型) });
  判('门面能把 onEvent 递到核心', 门面出.ok && 门面事件.includes('完成'), 门面事件.join('/'));

  段('装配');
  {
    const 抛 = (() => {
      try { createComfyModule({ port: { 探活: () => {} } }); return null; } catch (e) { return e.message; }
    })();
    判('端口不合格时抛错并点名', Boolean(抛 && 抛.includes('看队列')), String(抛));
    const 内存 = createComfyModule({ port: createMemoryAdapter() });
    判('给端口就能建', Boolean(内存.actions));
    判('没存档时存取都报错', (await 内存.取工作流()) === null && (await 内存.run('存工作流', { 图: 造图() })).code === 'COMFY_STORE_REQUIRED');
  }

  /* ---------------------------------------------------------------- client_id */

  段('client_id');
  {
    const 记带 = createMemoryAdapter();
    const 带id = createCore({ port: 记带, 存档: 造存档(), 等待: async () => {}, clientId: 'browser-abc-123' });
    带id.存工作流(造图());
  带id.绘图开关(true);
    await 带id.出图({ 正向: 'A' });
    判('配了 clientId 时提交带上它', 记带.记.提交过的[0].附带.clientId === 'browser-abc-123');

    const 记不带 = createMemoryAdapter();
    const 无id = createCore({ port: 记不带, 存档: 造存档(), 等待: async () => {} });
    无id.存工作流(造图());
  无id.绘图开关(true);
    await 无id.出图({ 正向: 'A' });
    判('核心未指定 clientId 时由端口提供默认标识', !记不带.记.提交过的[0].附带.clientId);

    const 单次 = createMemoryAdapter();
    const 一次一个 = createCore({ port: 单次, 存档: 造存档(), 等待: async () => {}, clientId: 'a' });
    一次一个.存工作流(造图());
  一次一个.绘图开关(true);
    await 一次一个.出图({ 正向: 'A', clientId: 'b' });
    判('出图时给的 clientId 优先', 单次.记.提交过的[0].附带.clientId === 'b');
  }

  /* ---------------------------------------------------------------- 收尾 */

  console.log('');
  if (败.length) {
    console.log(`失败 ${败.length} 条：`);
    for (const 名 of 败) console.log(`  · ${名}`);
    console.log(`通过 ${过} 条`);
    process.exit(1);
  }
  console.log(`全部通过：${过} 条`);
})();
