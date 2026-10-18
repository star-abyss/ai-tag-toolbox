'use strict';
/*
 * 核对提交时带没带 client_id：出一张，再从 ComfyUI 的历史里读回来对。
 *
 *   node tools/验进度条.cjs [client_id]
 *
 * 地址与当前工作流从 tools/.实测/设置.json 读（先用 tools/联调.cjs 起 装一张）。
 * client_id 在 ComfyUI 页面控制台跑 sessionStorage.getItem('clientId') 拿。
 * 不给 client_id 就只出图，不核对。
 */

const fs = require('node:fs');
const path = require('node:path');
const { createComfyModule } = require('../index.js');

const 客户端 = process.argv[2] || '';
const 主目录 = path.join(__dirname, '.实测');
const 读 = (p, 默认) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return 默认; } };

const 设置 = 读(path.join(主目录, '设置.json'), null);
if (!设置 || !设置.地址 || !设置.当前) {
  console.log('还没有地址与当前工作流：先跑 node tools/联调.cjs 起 <地址> <工作流名>');
  process.exit(1);
}

const 档 = path.join(主目录, `工作流-${设置.当前}.json`);
if (!fs.existsSync(档)) {
  console.log(`还没有装工作流：node tools/联调.cjs 起 ${设置.地址} ${设置.当前}`);
  process.exit(1);
}

(async () => {
  if (客户端) console.log(`client_id = ${客户端}\n`);
  else console.log('没给 client_id —— 这次只出图，不核对进度条。\n');

  const comfy = createComfyModule({
    地址: 设置.地址,
    存档: { 读: () => 读(档, null), 写: (v) => { fs.writeFileSync(档, JSON.stringify(v, null, 2), 'utf8'); return true; }, 清: () => {} },
    clientId: 客户端,
  });

  await comfy.run('绘图开关', { 启用: true });
  const 跑 = await comfy.run('出图', {
    正向: 'hakurei reimu, touhou, 1girl, solo, shrine, cherry blossoms, masterpiece, best quality',
    负向: 'worst quality, low quality, bad hands',
  });
  if (!跑.ok) { console.log(`出图失败：${跑.reason}`); process.exit(1); }
  console.log(`出图成功：任务号 ${跑.data.任务号}`);
  console.log(`产出：${跑.data.产出.map((x) => x.文件名).join(', ')}`);

  if (!客户端) return;
  const 答 = await fetch(`${设置.地址}/history/${跑.data.任务号}`);
  const 史 = await 答.json();
  const 附 = Array.isArray(史[跑.data.任务号].prompt) ? 史[跑.data.任务号].prompt[3] : null;
  const 记下 = 附 && 附.client_id;
  console.log(`\nComfyUI 记下的 client_id = ${JSON.stringify(记下)}`);
  console.log(记下 === 客户端 ? '对上了。' : '对不上。');
})();
