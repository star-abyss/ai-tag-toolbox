'use strict';
/*
 * 接口校验 —— 拿 接口.md 里写死的东西去问实现。
 *
 *   node test/接口.js
 *
 * 它不测功能（那是 test/run.js 的事），只测**形状**：
 *   ① 对外动作与接口契约一致，每个都能直呼
 *   ② 每个动作的返回字段名与契约完全一致
 *   ③ 对外参数里没有路径 / 地址 / URL 字段
 *   ④ 端口缺方法要抛错；核心与图不 require fs / path，也不 require 别的模块
 *   ⑤ 出口冻住，不递内部件
 *   ⑥ 失败一律 { ok:false, reason, code }，reason 以码开头
 *
 * 这里写死的字段名照 接口.md 抄。
 */

const fs = require('fs');
const path = require('path');

const { createComfyModule } = require('../index.js');
const { createMemoryAdapter } = require('../adapter-memory.js');
const { createHttpAdapter } = require('../adapter-http.js');
const { PORT_METHODS, checkPort } = require('../port.js');

const 失败 = [];
const 通过 = [];
async function 查(名字, 做) {
  try {
    const 问题 = await 做();
    if (问题) 失败.push(`${名字}：${问题}`);
    else 通过.push(名字);
  } catch (错误) {
    失败.push(`${名字}：抛了 ${(错误 && 错误.message) || 错误}`);
  }
}

/* --------------------------------------------------------------- 造一张图 */

function 节点(id, type, 控件, 连线输入 = []) {
  return {
    id,
    type,
    pos: [0, 0],
    size: [200, 100],
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

function 造图() {
  const 节点们 = [
    节点(4, 'CheckpointLoaderSimple', [['ckpt_name', 'test.safetensors']]),
    节点(6, 'CLIPTextEncode', [['text', 'a']], [['clip', 'CLIP', 1]]),
    节点(7, 'CLIPTextEncode', [['text', 'b']], [['clip', 'CLIP', 2]]),
    节点(5, 'EmptyLatentImage', [['width', 512], ['height', 512], ['batch_size', 1]]),
    节点(3, 'KSampler', [
      ['seed', 1], ['steps', 20], ['cfg', 7],
      ['sampler_name', 'euler'], ['scheduler', 'normal'], ['denoise', 1],
    ], [
      ['model', 'MODEL', 3], ['positive', 'CONDITIONING', 4],
      ['negative', 'CONDITIONING', 5], ['latent_image', 'LATENT', 6],
    ]),
    节点(8, 'VAEDecode', [], [['samples', 'LATENT', 7], ['vae', 'VAE', 8]]),
    节点(9, 'SaveImage', [['filename_prefix', 'x']], [['images', 'IMAGE', 9]]),
  ];
  节点们[0].outputs = [
    { name: 'MODEL', type: 'MODEL', links: [3], slot_index: 0 },
    { name: 'CLIP', type: 'CLIP', links: [1, 2], slot_index: 1 },
    { name: 'VAE', type: 'VAE', links: [8], slot_index: 2 },
  ];
  节点们[1].outputs = [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [4], slot_index: 0 }];
  节点们[2].outputs = [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [5], slot_index: 0 }];
  节点们[3].outputs = [{ name: 'LATENT', type: 'LATENT', links: [6], slot_index: 0 }];
  节点们[4].outputs = [{ name: 'LATENT', type: 'LATENT', links: [7], slot_index: 0 }];
  节点们[5].outputs = [{ name: 'IMAGE', type: 'IMAGE', links: [9], slot_index: 0 }];
  return {
    id: 'ded1e747-037e-475e-9fc5-292edb58a70c',
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

/* ---------------------------------------------------------------- 装配 */

let 档 = null;
const 端口 = createMemoryAdapter({ 文件: { 'memory_00001_.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]) } });
const 模块 = createComfyModule({
  port: 端口,
  存档: { 读: () => 档, 写: (v) => { 档 = v; return true; }, 清: () => { 档 = null; } },
  等待: async () => {},
});

/** 接口.md 里写死的动作名。 */
const 该有的动作 = [
  '探活', '看队列', '看节点定义', '存工作流', '取工作流',
  '清工作流', '绘图开关', '生成设置', '参数', '认', '认图', '出图', '取图',
];

/** 契约里写死的出参字段名。照 接口.md 抄。 */
const 该有的字段 = {
  探活: ['版本', '设备', '显存总量', '显存可用'],
  看队列: ['运行中', '排队中'],
  绘图开关: ['启用'],
  生成设置: ['每轮张数', '最多轮数', '自动迭代'],
  工作流: ['启用', 'format', '存于', '界面图', '口'],
  认: ['认得的', '认不出的', '正向', '负向', '图片', '张数', '输出', '节点数', '采样器', '采样器不唯一', '可填'],
  出图: ['任务号', '状态', '产出', '填了的'],
  取图: ['字节', 'mime'],
};

const 口的字段 = ['format', '节点数', '采样器们', '主采样器', '采样器不唯一', '正向', '负向', '图片', '张数', '输出', '认得的', '认不出的', '接口图'];
const 产出项的字段 = ['节点', '种类', '文件名', '子目录', '类型'];
const 填了的的字段 = ['正向', '负向', '图片', '张数'];
const 可填项的字段 = ['名', '要', '现在'];

function 查字段(名字, 值, 该有) {
  const 实 = Object.keys(值 || {});
  const 少 = 该有.filter((k) => !实.includes(k));
  if (少.length) return `${名字} 少了字段 ${少.join('、')}（实为 ${实.join('、')}）`;
  const 多 = 实.filter((k) => !该有.includes(k));
  if (多.length) return `${名字} 多了字段 ${多.join('、')}`;
  return '';
}

(async () => {
  /* ------------------------------------------------------------------ ① */

  await 查('① 动作清单恰好是契约里的十三个', () => {
    const 实 = [...模块.actions].sort();
    const 期 = [...该有的动作].sort();
    const 多 = 实.filter((x) => !期.includes(x));
    const 少 = 期.filter((x) => !实.includes(x));
    if (多.length) return `多了 ${多.join('、')}`;
    if (少.length) return `少了 ${少.join('、')}`;
    return '';
  });

  await 查('① 所有动作都能直呼（函数）', () => {
    const 缺 = [
      '探活', '看队列', '看节点定义', '工作流', '取工作流',
      '清工作流', '绘图开关', '生成设置', '参数', '认', '认图', '出图', '取图',
    ].filter((名) => typeof 模块[名] !== 'function');
    return 缺.length ? `这些不是函数：${缺.join('、')}` : '';
  });

  await 查('① 清单与 describe() 对得上', () => {
    const 表 = 模块.describe();
    if (表.length !== 该有的动作.length) return `describe 给了 ${表.length} 条`;
    const 名 = 表.map((x) => x.动作).sort();
    const 期 = [...该有的动作].sort();
    return 名.join('/') === 期.join('/') ? '' : `describe 的动作名是 ${名.join('、')}`;
  });

  await 查('① describe() 每项都有 摘要 / 参数 / 说明', () => {
    for (const 项 of 模块.describe()) {
      if (typeof 项.摘要 !== 'string' || !项.摘要) return `${项.动作} 没有摘要`;
      if (!Array.isArray(项.参数)) return `${项.动作} 的参数不是数组`;
      if (项.参数.some((x) => typeof x !== 'string')) return `${项.动作} 的参数名不是字符串`;
      if (!项.说明 || typeof 项.说明 !== 'object') return `${项.动作} 没有说明`;
      const 名 = 项.参数.map((x) => x.replace(/\?$/, ''));
      const 多 = Object.keys(项.说明).filter((k) => !名.includes(k));
      if (多.length) return `${项.动作} 的说明里有没列过的参数：${多.join('、')}`;
    }
    return '';
  });

  /* ------------------------------------------------------------------ ② */

  const 存 = await 模块.run('存工作流', { 图: 造图() });
  await 模块.run('绘图开关', { 启用: true });

  await 查('② 参数读取回工作流真实节点值', async () => {
    const 回 = await 模块.run('参数');
    const sampler = 回.data && 回.data.节点.find(x => x.编号 === '3');
    return 回.ok && sampler && sampler.参数.find(x => x.名称 === 'steps' && x.值 === 20) ? '' : '节点 3 缺少 steps=20';
  });

  await 查('② 探活给的字段与契约一致', async () => 查字段('探活', (await 模块.run('探活')).data, 该有的字段.探活));
  await 查('② 看队列给的字段与契约一致', async () => 查字段('看队列', (await 模块.run('看队列')).data, 该有的字段.看队列));
  await 查('② 绘图开关给的字段与契约一致', async () => 查字段('绘图开关', (await 模块.run('绘图开关')).data, 该有的字段.绘图开关));
  await 查('② 生成设置给的字段与契约一致', async () => 查字段('生成设置', (await 模块.run('生成设置')).data, 该有的字段.生成设置));
  await 查('② 看节点定义给的是节点表', async () => {
    const r = await 模块.run('看节点定义');
    return r.ok && typeof r.data === 'object' && r.data !== null ? '' : r.reason || '不是对象';
  });
  await 查('② 存工作流给的字段与契约一致', () => 查字段('存工作流', 存.data, 该有的字段.工作流));
  await 查('② 存下来的口字段与契约一致', () => 查字段('口', 存.data.口, 口的字段));
  await 查('② 取工作流给的字段与契约一致', async () => 查字段('取工作流', (await 模块.run('取工作流')).data, 该有的字段.工作流));
  await 查('② 认给的字段与契约一致', async () => 查字段('认', (await 模块.run('认')).data, 该有的字段.认));
  await 查('② 认可填三项，每项字段与契约一致', async () => {
    const 可填 = (await 模块.run('认')).data.可填;
    if (可填.length !== 3) return `可填给了 ${可填.length} 项`;
    for (const 项 of 可填) {
      const 差 = 查字段(`可填.${项.名}`, 项, 可填项的字段);
      if (差) return 差;
    }
    return '';
  });
  await 查('② 认图给的字段与契约一致', async () => 查字段('认图', (await 模块.run('认图', { 图: 造图() })).data, 该有的字段.认));
  await 查('② 出图给的字段与契约一致', async () => 查字段('出图', (await 模块.run('出图', { 正向: 'a' })).data, 该有的字段.出图));
  await 查('② 出图的产出项字段与契约一致', async () => {
    const 产出 = (await 模块.run('出图', { 正向: 'a' })).data.产出;
    if (!产出.length) return '没有产出';
    return 查字段('产出项', 产出[0], 产出项的字段);
  });
  await 查('② 出图的填了的字段与契约一致', async () => {
    const 填了 = (await 模块.run('出图', { 正向: 'a' })).data.填了的;
    return 查字段('填了的', 填了, 填了的的字段);
  });
  await 查('② 取图给的字段与契约一致', async () => {
    const 产出 = (await 模块.run('出图', { 正向: 'a' })).data.产出[0];
    const 回 = await 模块.run('取图', { 产出 });
    return 回.ok ? 查字段('取图', 回.data, [...产出项的字段, ...该有的字段.取图]) : `取图失败：${回.reason}`;
  });

  /* ------------------------------------------------------------------ ③ */

  await 查('③ describe() 的参数名里没有路径 / 地址 / URL', () => {
    const 忌 = /地址|路径|url|path|dir|目录|文件夹|file|文件/i;
    for (const 项 of 模块.describe()) {
      for (const 参数 of 项.参数) {
        if (忌.test(参数)) return `${项.动作} 的参数 ${参数} 像路径或地址`;
      }
    }
    return '';
  });

  /* ------------------------------------------------------------------ ④ */

  await 查('④ 端口缺方法时抛错并点名', () => {
    try {
      createComfyModule({ port: { 探活: () => {} } });
      return '没有抛错';
    } catch (错误) {
      return String(错误.message).includes('看队列') ? '' : `抛的话里没点名：${错误.message}`;
    }
  });

  await 查('④ 端口方法名与契约一致', () => {
    const 期 = ['探活', '看队列', '看节点定义', '提交', '看任务', '取结果文件', '送图片'].sort();
    const 实 = [...PORT_METHODS].sort();
    if (实.join('/') !== 期.join('/')) return `端口方法是 ${实.join('、')}`;
    if (!checkPort(createMemoryAdapter()).ok) return '内存适配器不合格';
    if (!checkPort(createHttpAdapter({ 地址: 'http://127.0.0.1:1' })).ok) return 'HTTP 适配器不合格';
    return '';
  });

  await 查('④ 核心与图不许 require fs / path', () => {
    for (const 文件 of ['core.js', 'graph.js']) {
      const 源 = fs.readFileSync(path.join(__dirname, '..', 文件), 'utf8');
      const 命中 = 源.match(/require\(\s*['"](node:)?(fs|path)['"]\s*\)/);
      if (命中) return `${文件} 里 require 了 ${命中[0]}`;
    }
    return '';
  });

  await 查('④ 不许 require 别的模块', () => {
    for (const 文件 of ['index.js', 'core.js', 'graph.js', 'port.js', 'adapter-http.js', 'adapter-memory.js']) {
      const 源 = fs.readFileSync(path.join(__dirname, '..', 文件), 'utf8');
      const 们 = [...源.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])
        .filter((x) => !x.startsWith('./') && !x.startsWith('node:'));
      if (们.length) return `${文件} require 了 ${们.join('、')}`;
    }
    return '';
  });

  /* ------------------------------------------------------------------ ⑤ */

  await 查('⑤ 出口冻住', () => (Object.isFrozen(模块) ? '' : '没冻住'));
  await 查('⑤ 错误码表冻住', () => (Object.isFrozen(模块.ERR) ? '' : '没冻住'));
  await 查('⑤ 不递内部件', () => {
    const 内部 = ['core', 'graph', 'port', 'adapter', 'adapterHttp', '适配器'];
    const 命中 = 内部.filter((k) => k in 模块);
    return 命中.length ? `出口带了 ${命中.join('、')}` : '';
  });
  await 查('⑤ 在跑吗 是函数', () => (typeof 模块.在跑吗 === 'function' ? '' : '不是函数'));

  /* ------------------------------------------------------------------ ⑥ */

  await 查('⑥ 没有这个动作时给失败信封', async () => {
    const r = await 模块.run('没有这个');
    if (r.ok !== false) return 'ok 不是 false';
    if (typeof r.reason !== 'string' || !r.reason.startsWith(`${r.code}: `)) return `reason 与码对不上：${r.reason}`;
    return '';
  });

  await 查('⑥ 失败信封的码都在 ERR 表里', async () => {
    const 表 = Object.values(模块.ERR);
    const 坏 = await 模块.run('没有这个');
    return 表.includes(坏.code) ? '' : `${坏.code} 不在 ERR 表里`;
  });

  await 查('⑥ 没存档时认口给失败信封', async () => {
    const 空 = createComfyModule({ port: createMemoryAdapter() });
    const r = await 空.run('认');
    if (r.ok !== false) return 'ok 不是 false';
    return r.code === 'COMFY_STORE_REQUIRED' ? '' : `码是 ${r.code}`;
  });

  await 查('⑥ 动作一律给 Promise', async () => {
    for (const 名 of 该有的动作) {
      const 回 = 模块.run(名, 名 === '存工作流' ? { 图: 造图() } : {});
      if (!回 || typeof 回.then !== 'function') return `${名} 没给 Promise`;
      await 回;
    }
    return '';
  });

  await 查('② 清工作流给 null', async () => ((await 模块.run('清工作流')).data === null ? '' : '不是 null'));

  /* ------------------------------------------------------------------ 收尾 */

  console.log('');
  for (const 名 of 通过) console.log(`  ✓ ${名}`);
  if (失败.length) {
    console.log('');
    for (const 名 of 失败) console.log(`  ✗ ${名}`);
    console.log(`\n失败 ${失败.length} 条，通过 ${通过.length} 条`);
    process.exit(1);
  }
  console.log(`\n全部通过：${通过.length} 条`);
})();
