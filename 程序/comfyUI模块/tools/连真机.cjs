'use strict';
/*
 * 对真 ComfyUI 走一遍：端口的七个方法 + 存工作流 + 认口 + 出一张 + 盯到完成 + 取图。
 *
 *   node tools/连真机.cjs <地址> [工作流.json]
 *
 * 不给工作流文件就用 tools/.工作流/文生图.json（先跑 node tools/造工作流.cjs <地址>）。
 */

const fs = require('node:fs');
const path = require('node:path');
const { createComfyModule } = require('../index.js');
const { createHttpAdapter } = require('../adapter-http.js');
const { checkPort } = require('../port.js');

const 地址 = String(process.argv[2] || '').replace(/\/+$/, '');
const 素材 = process.argv[3] || path.join(__dirname, '.工作流', '文生图.json');
if (!地址) {
  console.log('用法：node tools/连真机.cjs <地址> [工作流.json]');
  process.exit(1);
}

(async () => {
  const 适配器 = createHttpAdapter({ 地址 });
  const 门 = checkPort(适配器);
  console.log('端口齐全:', 门.ok, 门.reason || '');

  console.log('\n--- 探活 ---');
  console.log(JSON.stringify(await 适配器.探活()));

  console.log('\n--- 看队列 ---');
  console.log(JSON.stringify(await 适配器.看队列()));

  console.log('\n--- 看节点定义 ---');
  const 定义 = await 适配器.看节点定义();
  if (!定义.ok) { console.log(定义.reason); return; }
  const 名 = Object.keys(定义.data);
  console.log('节点类数:', 名.length);
  for (const k of ['KSampler', 'CLIPTextEncode', 'CheckpointLoaderSimple', 'LoadImage', 'VAEEncode', 'SaveImage']) {
    console.log(`  ${k}: ${定义.data[k] ? '有' : '没有'}`);
  }

  if (!fs.existsSync(素材)) {
    console.log(`\n没有素材工作流：${素材}`);
    console.log(`先跑：node tools/造工作流.cjs ${地址}`);
    return;
  }

  console.log('\n--- 提交一张并盯到完成 ---');
  const 图 = JSON.parse(fs.readFileSync(素材, 'utf8'));
  let 档 = null;
  const 存档 = { 读: () => 档, 写: (x) => { 档 = x; return true; }, 清: () => { 档 = null; } };
  const comfy = createComfyModule({ 地址, 存档 });
  await comfy.看节点定义();

  const 存 = await comfy.run('存工作流', { 图 });
  if (!存.ok) { console.log(`导入失败：${存.reason}`); return; }
  console.log('认得:', 存.data.口.认得的.join(' / '));
  console.log('认不出:', 存.data.口.认不出的.join(' / ') || '（无）');

  await comfy.run('绘图开关', { 启用: true });
  const 跑 = await comfy.run('出图', {
    正向: 'hakurei reimu, touhou, 1girl, solo, masterpiece, best quality',
    负向: 'worst quality, low quality',
    onEvent: (e) => { if (e.类型 === '状态') console.log(`  … ${e.状态}`); },
  });
  if (!跑.ok) { console.log(`出图失败：${跑.reason}`); return; }
  console.log(`出图成功：任务号 ${跑.data.任务号}`);
  console.log(`  填了：${JSON.stringify(跑.data.填了的)}`);
  console.log(`  产出：${跑.data.产出.map((x) => x.文件名).join(', ')}`);

  if (跑.data.产出.length) {
    const 取 = await comfy.run('取图', { 产出: 跑.data.产出[0] });
    console.log(`  取图：${取.ok ? `${取.data.字节.length} 字节 ${取.data.mime}` : 取.reason}`);
  }
})();
