'use strict';
/*
 * 对账：默认世界书交出来的东西，必须与文件里的一个字不差。
 *
 *   node tools/对账默认.js
 *
 * 查四件事：
 *   ① 不给文本时：交出的命中 = 恒常条目，正文与文件里的 text 逐字相同
 *   ② 那些命中的落点与文件里的落点对得上
 *   ③ 逐条验进出：恒常条不给文本也在；条件条要给它自己的关键词才在
 *   ④ 正文里的转义（`\(`）原样带出来
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createWorldbookModule } = require('../index.js');
const { createFileAdapter } = require('../adapter-file.js');

const 默认目录 = path.join(__dirname, '..', 'assets', '世界书');
const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));

/** 文件里那些条目：只留启用且正文非空的。 */
const 有效条 = (文件) =>
  (Array.isArray(文件.entries) ? 文件.entries : []).filter((e) => e.enabled !== false && String(e.text || '').trim());

/** 交出来的那一摞命中，按 "\n" 连起来。 */
const 连起来 = (命中) => 命中.map((x) => x.文本).join('\n');

let 坏 = 0;
let 带转义 = 0;
try {
  const 适配器 = createFileAdapter({ root: 根, 默认目录 });
  const 名字们 = 适配器.listDefaults().items.map((x) => x.名字);
  const 默认启用 = Object.fromEntries(名字们.map((名) => [名, [`$default:${名}`]]));
  const 模块 = createWorldbookModule({ port: 适配器, 默认启用 });

  for (const 名 of 名字们) {
    const 文件 = JSON.parse(fs.readFileSync(path.join(默认目录, `${名}.json`), 'utf8'));
    const 有效 = 有效条(文件);
    模块.书({ 动作: '换', 请求: 名, 启用: [`$default:${名}`] });
    模块.存();

    // ① 不给文本：命中的就是恒常那几条，正文逐字相同。
    const 出 = 模块.执行({ 请求: 名, 文本: '' });
    const 恒常 = 有效.filter((e) => e.always === true);
    const 实得 = 出.命中.map((x) => x.文本);
    const 期望 = 恒常.map((e) => String(e.text));
    const 对 = 连起来(实得) === 连起来(期望);
    console.log(`${名} 「${文件.name}」 ${对 ? '✓ 逐字相同' : '✗ 不一致'}（${实得.length} 条命中；文件里 ${有效.length} 条有效）`);
    if (!对) {
      坏 += 1;
      console.log(`    期望 ${期望.length} 条，实得 ${实得.length} 条`);
    }
    for (const 一条 of 实得) if (一条.includes('\\(')) 带转义 += 1;

    // ② 落点也对得上
    const 落点期望 = 恒常.map((e) => e.落点 || '前');
    const 落点实得 = 出.命中.map((x) => x.落点);
    if (JSON.stringify(落点实得) !== JSON.stringify(落点期望)) {
      坏 += 1;
      console.log(`    ✗ 落点对不上：${JSON.stringify(落点实得)} ≠ ${JSON.stringify(落点期望)}`);
    }

    // ③ 逐条验进出
    const 读回 = 模块.run('读', { 书: `$default:${名}` });
    if (!读回.ok) {
      console.log(`    ✗ 读不回来：${读回.reason}`);
      坏 += 1;
      continue;
    }
    for (const [i, 书里这条] of 读回.data.书.条目.entries()) {
      const 一条 = 有效[i];
      if (!一条) continue;
      const 不给文本在 = 模块.执行({ 请求: 名, 文本: '' }).命中.some((x) => x.文本 === 书里这条.text);
      const 该在 = 一条.always === true;
      if (不给文本在 !== 该在) {
        console.log(`    ✗ ${书里这条.id}（${书里这条.label}）不给文本时：在=${不给文本在}，应当是 ${该在}`);
        坏 += 1;
      }
      const 关键词 = Array.isArray(一条.keys) ? 一条.keys.filter((k) => k) : [];
      if (!该在 && 关键词.length) {
        const 命中 = 模块.执行({ 请求: 名, 文本: 关键词[0] }).命中.some((x) => x.文本 === 书里这条.text);
        const 不命中 = 模块.执行({ 请求: 名, 文本: 'zzz-不相干的输入-zzz' }).命中.some((x) => x.文本 === 书里这条.text);
        if (!命中 || 不命中) {
          console.log(`    ✗ ${书里这条.id} 给「${关键词[0]}」时在=${命中}（应当 true）· 给不相干文本时在=${不命中}（应当 false）`);
          坏 += 1;
        }
      }
    }
  }
} finally {
  fs.rmSync(根, { recursive: true, force: true });
}

// ④ 转义原样
console.log(`\n正文里的转义原样带出来：${带转义 > 0 ? `✓ ${带转义} 条带 \\( 转义，一条都没被改` : '✗ 没有一条带转义'}`);
if (!带转义) 坏 += 1;

console.log(坏 ? `\n${坏} 处对不上` : '\n各份默认正文都对得上，条件条目逐条进出也对');
process.exit(坏 ? 1 : 0);
