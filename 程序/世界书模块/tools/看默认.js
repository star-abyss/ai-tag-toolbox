'use strict';
/*
 * 看几份默认世界书，并试几条文本看条件命中。
 *
 *   node tools/看默认.js
 *
 * 默认清单与内容都走适配器与核心，不手抄名字。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createWorldbookModule } = require('../index.js');
const { createFileAdapter } = require('../adapter-file.js');

const 默认目录 = path.join(__dirname, '..', 'assets', '世界书');
const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));

/** 一条条目的条件怎么写给人看。 */
const 条件 = (一条) => (一条.always ? '每次' : `触发 ${一条.keys.join(' / ')}`);
/** 一条条目的落点怎么写给人看。 */
const 落点 = (一条) =>
  (一条.落点 === '按深度' ? `@深度 ${一条.深度} · ${一条.角色}` : 一条.落点);

try {
  const 适配器 = createFileAdapter({ root: 根, 默认目录 });
  const 名字们 = 适配器.listDefaults().items.map((x) => x.名字);
  const 默认启用 = Object.fromEntries(名字们.map((名) => [名, [`$default:${名}`]]));
  const 模块 = createWorldbookModule({ port: 适配器, 默认启用 });

  console.log('# 默认世界书\n');
  for (const 名 of 名字们) {
    模块.书({ 动作: '换', 请求: 名, 启用: [`$default:${名}`] });
    const 书 = 模块.读({ 书: `$default:${名}` }).书;
    const 字数 = 书.条目.reduce((n, e) => n + e.text.length, 0);
    console.log(`${名} 「${书.名字}」 ${书.条目.length} 条 · ${字数} 字`);
    for (const 一条 of 书.条目) {
      console.log(`    ${一条.enabled ? '启用' : '停用'}  ${条件(一条).padEnd(30)} ${落点(一条).padEnd(12)} ${String(一条.text.length).padStart(5)} 字  ${一条.label}`);
    }
    console.log('');
  }

  console.log('# 文生图的文本命中\n');
  const 标签 = new Map(模块.读({ 书: '$default:文生图' }).书.条目.map((x) => [x.text, x.label]));
  const 试的 = [
    ['（不给文本）', null],
    ['帮我画一个女孩站在雨里', '帮我画一个女孩站在雨里'],
    ['要有强透视的冲击感', '要有强透视的冲击感'],
    ['画成分镜漫画，四格', '画成分镜漫画，四格'],
    ['用第一人称视角', '用第一人称视角'],
    ['storyboard, multiple views', 'storyboard, multiple views'],
    ['pov, from below', 'pov, from below'],
    ['要透视与第一人称', '要透视与第一人称'],
  ];
  for (const [说明, 文本] of 试的) {
    const 出 = 模块.测({ 请求: '文生图', 文本 });
    const 命中 = 出.命中.map((x) => 标签.get(x.文本) || '（认不出）');
    const 字数 = 出.命中.reduce((n, x) => n + x.文本.length, 0);
    console.log(`  ${说明.padEnd(26)} → ${String(出.命中.length).padStart(2)} 条 · ${String(字数).padStart(5)} 字  [${命中.join(' | ')}]`);
  }
} finally {
  fs.rmSync(根, { recursive: true, force: true });
}
