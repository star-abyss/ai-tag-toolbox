'use strict';
/*
 * 拿一批工作流扫一遍：认得出正 / 负 / 图口的有几个。
 *
 *   node tools/扫真实工作流.js <工作流目录> [节点定义.json]
 *
 * 目录由参数给。节点定义可选；不给就只按文件自带的声明认。
 * 节点定义怎么拿：对着 ComfyUI 请求 /object_info，把响应存成文件。
 */

const fs = require('node:fs');
const path = require('node:path');
const G = require('../graph.js');

const 目录 = process.argv[2];
const 定义路径 = process.argv[3] || '';

if (!目录) {
  console.log('用法：node tools/扫真实工作流.js <工作流目录> [节点定义.json]');
  console.log('');
  console.log('  工作流目录      装了 ComfyUI 工作流 JSON 的目录');
  console.log('  节点定义.json   可选；/object_info 的响应，用来补回界面图里被删掉的参数名');
  process.exit(1);
}
if (!fs.existsSync(目录)) { console.log(`没有这个目录：${目录}`); process.exit(1); }

/** /object_info 的节点部分；找不到就空着。 */
function 读定义() {
  if (!定义路径) return {};
  try {
    const 值 = JSON.parse(fs.readFileSync(定义路径, 'utf8').replace(/^\uFEFF/, ''));
    if (值.nodes && typeof 值.nodes === 'object') return 值.nodes;
    return 值;
  } catch {
    return {};
  }
}

const 定义 = 读定义();
let 有正 = 0;
let 没正 = 0;
const 明细 = [];

for (const f of fs.readdirSync(目录).filter((x) => x.endsWith('.json') && !x.startsWith('.'))) {
  let 图;
  try {
    图 = JSON.parse(fs.readFileSync(path.join(目录, f), 'utf8').replace(/^\uFEFF/, ''));
  } catch { continue; }
  if (!Array.isArray(图.nodes) || !图.nodes.length) continue;

  const r = G.读口(图, { 节点定义: 定义 });
  if (r.ok && r.data.正向.length) {
    有正 += 1;
    明细.push([f, r.data.认得的.join(' / ')]);
  } else {
    没正 += 1;
    明细.push([f, r.ok ? '转换成功，但没有正向口' : `转换失败 ${r.code}`]);
  }
}

console.log(`节点定义：${Object.keys(定义).length ? `${Object.keys(定义).length} 个类` : '没有（只按文件自带的声明认）'}`);
console.log(`扫了 ${有正 + 没正} 张：有正向口 ${有正}，没有 ${没正}\n`);
for (const [文件, 结果] of 明细) console.log(`  ${文件.padEnd(38)} ${结果}`);
