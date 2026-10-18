// 真模型实测：本地翻译 + 本地识图 + 读元数据，走装配层的工具接口。
//
//   node tools/真模型实测.mjs
//
// 要那两格模型在（项目根 `模型/翻译` · `模型/识图`）。图自己造一张存进图库，跑完删干净。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import yaml from 'js-yaml';
import { apply } from '../index.js';

const 包根 = path.resolve(process.cwd());
const 项目根 = path.dirname(包根);
const 条目 = yaml.load(fs.readFileSync(path.join(包根, 'cordis.patch.yml'), 'utf8'));
const 配置 = { ...条目.find((x) => x && x.insert).insert.find((x) => x && x.id === 'toolbox').config, 项目根 };

/** 造一张 512×512 的真 PNG（斜向渐变），给识图那条用。 */
function 造PNG(边 = 512) {
  const 块 = (类型, 数据) => {
    const 体 = Buffer.concat([Buffer.from(类型, 'latin1'), 数据]);
    const 长 = Buffer.alloc(4);
    长.writeUInt32BE(数据.length);
    const 和 = Buffer.alloc(4);
    和.writeUInt32BE(zlib.crc32(体));
    return Buffer.concat([长, 体, 和]);
  };
  const 头 = Buffer.alloc(13);
  头.writeUInt32BE(边, 0);
  头.writeUInt32BE(边, 4);
  头[8] = 8;
  头[9] = 2;
  const 行们 = [];
  for (let y = 0; y < 边; y += 1) {
    const 行 = Buffer.alloc(1 + 边 * 3);
    行[0] = 0;
    for (let x = 0; x < 边; x += 1) {
      const 位 = 1 + x * 3;
      行[位] = Math.round((x / (边 - 1)) * 255);
      行[位 + 1] = Math.round((y / (边 - 1)) * 255);
      行[位 + 2] = 160;
    }
    行们.push(行);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    块('IHDR', 头),
    块('IDAT', zlib.deflateSync(Buffer.concat(行们))),
    块('IEND', Buffer.alloc(0)),
  ]);
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

let 过 = 0; let 败 = 0;
const 步 = async (名, 做) => {
  try { const 说明 = await 做(); 过 += 1; console.log(`  ok   ${名}${说明 ? `  ${说明}` : ''}`); }
  catch (e) { 败 += 1; console.log(`  FAIL ${名}\n       ${(e && e.message) || e}`); }
};

console.log('=== 本地翻译（真模型，第一次会装模型）===');
await 步('translate_local（英译中）', async () => {
  const 起 = Date.now();
  const 回 = await 调('translate_local', { 文本: 'a serene mountain lake at sunrise, mist over the water, photorealistic', 方向: 'en-zh' });
  const 秒 = ((Date.now() - 起) / 1000).toFixed(1);
  if (!回 || !回.译文) throw new Error(JSON.stringify(回).slice(0, 200));
  return `「${回.译文}」 ${秒} 秒 · 出处 ${回.出处} · 模型 ${回.模型}`;
});

console.log('\n=== 本地识图与元数据（真模型，图自己造）===');
let 存的 = null;
try {
  const 位图 = 造PNG();
  const 存 = await 调('image_save', { 作用域: { 存放地: 'gallery' }, 字节: 位图, 文件名: '真模型实测.png' });
  if (!存 || !存.引用) throw new Error(`摆图失败：${JSON.stringify(存).slice(0, 200)}`);
  存的 = 存.引用;

  await 步(`vision_detect（${位图.length} 字节的真 PNG）`, async () => {
    const 回 = await 调('vision_detect', { ...存的.作用域, 条目ID: 存的.条目ID, 阈值: 0.35, 上限: 8 });
    if (!回 || !Array.isArray(回.标签)) throw new Error(JSON.stringify(回).slice(0, 200));
    return 回.标签.map((x) => `${x.词}${x.中文名 ? `(${x.中文名})` : ''}`).join(' · ') || '（一个标签都没到阈值）';
  });

  await 步('vision_metadata（这张图里没有元数据，要如实说没有）', async () => {
    const 回 = await 调('vision_metadata', { ...存的.作用域, 条目ID: 存的.条目ID });
    if (!回) throw new Error('没给回执');
    return `提示词 ${回.提示词 ? `「${String(回.提示词).slice(0, 40)}…」` : '（没有）'} · 尺寸 ${回.尺寸 ? `${回.尺寸.宽}×${回.尺寸.高}` : '（没读到）'}`;
  });
} catch (错) {
  败 += 1;
  console.log(`  FAIL 摆图\n       ${(错 && 错.message) || 错}`);
} finally {
  if (存的) await 调('image_remove', { 引用: 存的 }).catch(() => {});
}

console.log(`\n${过} 过 / ${败} 失败`);
process.exit(败 === 0 ? 0 : 1);
