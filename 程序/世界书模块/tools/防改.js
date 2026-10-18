'use strict';
/*
 * 防改测试：拿所有能碰到"只读默认"的入口挨个试一遍。
 *
 *   node tools/防改.js
 *
 * 用真文件适配器指向真 assets 目录；每一步之后比一次文件哈希。
 * 第五节那种绕开模块的直写，对着系统临时目录里的副本做。
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createWorldbookModule } = require('../index.js');
const { createFileAdapter } = require('../adapter-file.js');

const 默认目录 = path.join(__dirname, '..', 'assets', '世界书');
const 探子 = createFileAdapter({ root: os.tmpdir(), 默认目录 });
const 名字们 = 探子.listDefaults().items.map((x) => x.名字);
const 默认文件 = 名字们.map((名) => path.join(默认目录, `${名}.json`));

const 哈希 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 16);
const 开工前 = 默认文件.map(哈希);

const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
const 默认启用 = Object.fromEntries(名字们.map((名) => [名, [`$default:${名}`]]));
const 模块 = createWorldbookModule({ port: createFileAdapter({ root: 根, 默认目录 }), 默认启用 });

let 过 = 0;
const 失败 = [];

/** 试一条：应当被拦住（ok:false 且带期望的码）。 */
function 该拦(说明, 结果, 期望码) {
  const 拦住 = 结果 && 结果.ok === false;
  const 码对 = !期望码 || String(结果.reason || '').includes(期望码);
  if (拦住 && 码对) {
    过 += 1;
    console.log(`  ✓ 拦住  ${说明}`);
    console.log(`          ${结果.reason}`);
  } else {
    失败.push(说明);
    console.log(`  ✗ 没拦住 ${说明}`);
    console.log(`          结果：${JSON.stringify(结果)}`);
  }
}

const 靶子 = '$default:文生图';

console.log('# 一、冲着"只读默认"的写操作\n');

该拦('改名', 模块.run('书', { 动作: '改名', 标识: 靶子, 名字: '我改的' }), 'PROMPT_READONLY_BOOK');
该拦('删除', 模块.run('书', { 动作: '删', 标识: 靶子 }), 'PROMPT_READONLY_BOOK');
该拦('加条目', 模块.run('条目', { 动作: '加', 书: 靶子, 条目: { text: '塞进去' } }), 'PROMPT_READONLY_BOOK');
该拦('改条目正文', 模块.run('条目', { 动作: '改', 书: 靶子, 标识: 'e1', 条目: { text: '改掉' } }), 'PROMPT_READONLY_BOOK');
该拦('改条目落点', 模块.run('条目', { 动作: '改', 书: 靶子, 标识: 'e1', 条目: { 落点: '后' } }), 'PROMPT_READONLY_BOOK');
该拦('删条目', 模块.run('条目', { 动作: '删', 书: 靶子, 标识: 'e1' }), 'PROMPT_READONLY_BOOK');
该拦('移条目', 模块.run('条目', { 动作: '移', 书: 靶子, 标识: 'e1', 方向: '下' }), 'PROMPT_READONLY_BOOK');
该拦('每份默认各删一次', (() => {
  const 果 = 名字们.map((名) => 模块.run('书', { 动作: '删', 标识: `$default:${名}` }));
  return 果.every((x) => !x.ok) ? 果[0] : 果.find((x) => x.ok);
})(), 'PROMPT_READONLY_BOOK');

console.log('\n# 二、只读默认读得到、导得出、只有一份\n');

const 表 = 模块.表();
const 默认行 = 表.filter((x) => x.是本子);
console.log(`  表里默认：${默认行.length} 份`);
for (const 行 of 默认行) {
  console.log(`    ${行.标识}  「${行.名字}」  ${行.条目数} 条  存在=${行.存在}${行.读不懂 ? ' 读不懂' : ''}`);
}
if (默认行.length === 名字们.length && 默认行.every((x) => x.存在)) {
  过 += 1;
  console.log('  ✓ 每一份都在、都读得到');
} else {
  失败.push('默认在表里不完整');
  console.log('  ✗ 默认在表里不完整');
}

// 导入一本与默认同名的，看两本在不在
const 导入果 = 模块.run('书', { 动作: '导入', 请求: '文生图', 内容: 模块.run('书', { 动作: '导出', 标识: 靶子 }).data.内容 });
console.log(`  导入一本同名「文生图」：${导入果.ok ? `成了，标识 ${导入果.data.标识}` : 导入果.reason}`);
const 表二 = 模块.表();
const 同名 = 表二.filter((x) => x.名字 === '文生图');
console.log(`  现在叫「文生图」的有 ${同名.length} 本：${同名.map((x) => `${x.标识}(${x.是本子 ? '默认' : '用户'})`).join(' · ')}`);
if (同名.length === 2 && 同名.some((x) => x.是本子) && 同名.some((x) => !x.是本子)) {
  过 += 1;
  console.log('  ✓ 同名的两本并存，默认那本没有被顶掉');
} else {
  失败.push('同名的两本没有并存');
  console.log('  ✗ 同名的两本没有并存');
}

console.log('\n# 三、读它、用它、启用它 —— 都该正常\n');

for (const 名 of 名字们) {
  const 读 = 模块.run('读', { 书: `$default:${名}` });
  const 换 = 模块.run('书', { 动作: '换', 请求: 名, 启用: [`$default:${名}`] });
  const 导 = 模块.run('书', { 动作: '导出', 标识: `$default:${名}` });
  const 条目数 = 读.ok ? 读.data.书.条目.length : 0;
  const 好 = 读.ok && 换.ok && 导.ok;
  console.log(`  ${好 ? '✓' : '✗'} ${名}：读 ${条目数} 条 · 启用 ${换.ok} · 导出 ${导.ok ? `${导.data.内容.length} 字` : 导.reason}`);
  if (好) 过 += 1;
  else 失败.push(`${名} 的读 / 启用 / 导出`);
}

console.log('\n# 四、文件本身有没有被动过\n');

const 收工后 = 默认文件.map(哈希);
默认文件.forEach((f, i) => {
  const 同 = 开工前[i] === 收工后[i];
  console.log(`  ${同 ? '✓' : '✗'} ${path.basename(f)}  ${开工前[i]} → ${收工后[i]}`);
  if (同) 过 += 1;
  else 失败.push(`${path.basename(f)} 被改了`);
});

console.log('\n# 五、绕开模块，直接用文件系统动那些文件（对着临时目录里的副本）\n');

const 副本目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
const 副本 = path.join(副本目录, path.basename(默认文件[0]));
fs.copyFileSync(默认文件[0], 副本);

let 直写 = null;
try {
  fs.writeFileSync(副本, `${fs.readFileSync(副本, 'utf8')}\n`, 'utf8');
  直写 = '写进去了';
} catch (e) {
  直写 = `被拒绝：${e.code}`;
}
console.log(`  直接 writeFileSync 到副本：${直写}`);

let 直删 = null;
try {
  fs.unlinkSync(副本);
  直删 = '删掉了';
} catch (e) {
  直删 = `被拒绝：${e.code}`;
}
console.log(`  直接 unlink 副本：${直删}`);
console.log('  → 模块只挡住"通过它自己"的写；进程里直接用 fs 能改副本。这一层靠约定，不靠机制。');
console.log('  → 真 assets 目录没有被碰过，所以下面那些哈希必然还是原值。');

fs.rmSync(副本目录, { recursive: true, force: true });

const 还原后 = 默认文件.map(哈希);
console.log(`  还原检查：${还原后.every((h, i) => h === 开工前[i]) ? '✓ 哈希都回到原值' : '✗ 有文件没还原'}`);

console.log('\n# 六、用户那份没被牵连\n');

const 用户文件 = path.join(根, '世界书.json');
console.log(`  用户那份：${fs.existsSync(用户文件) ? '已建' : '还没有'}（上面那些被拦的写操作不该在它里面留下痕迹）`);
const 存 = 模块.run('存');
console.log(`  存：${存.ok ? '✓ 只动用户那份' : `✗ ${存.reason}`}`);
if (存.ok) 过 += 1;
else 失败.push('存');

fs.rmSync(根, { recursive: true, force: true });

console.log(`\n${过} 过 / ${失败.length} 失败`);
if (失败.length) {
  console.log('失败项：');
  for (const f of 失败) console.log(`  · ${f}`);
}
process.exit(失败.length ? 1 : 0);
