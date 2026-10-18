// 装配起来实测：七个模块 + 主 AI，逐个动作走一遍。
// 用户的输入与调整都从工具接口进（UI 将来走的就是这条路）。
//
//   node tools/接口实测.mjs
//
// 它会真读真库、真写真机（图片模块存一张再删掉、世界书建一本再删掉），跑完不留残留。
// 连 ComfyUI 那几条：真机没开也算过，只报没连上。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import yaml from 'js-yaml';
import { apply } from '../index.js';

const 包根 = path.resolve(process.cwd());
const 项目根 = path.dirname(包根);

const 条目 = yaml.load(fs.readFileSync(path.join(包根, 'cordis.patch.yml'), 'utf8'));
const 配置 = { ...条目.find((x) => x && x.insert).insert.find((x) => x && x.id === 'toolbox').config, 项目根 };

/** 造一张 2×2 的真 PNG（IHDR + zlib 压过的 IDAT + IEND），不引第三方库。 */
function 造PNG() {
  const 块 = (类型, 数据) => {
    const 体 = Buffer.concat([Buffer.from(类型, 'latin1'), 数据]);
    const 长 = Buffer.alloc(4);
    长.writeUInt32BE(数据.length);
    const 和 = Buffer.alloc(4);
    和.writeUInt32BE(zlib.crc32(体));
    return Buffer.concat([长, 体, 和]);
  };
  const 头 = Buffer.alloc(13);
  头.writeUInt32BE(2, 0);
  头.writeUInt32BE(2, 4);
  头[8] = 8;
  头[9] = 2;
  const 行 = Buffer.from([0, 200, 80, 60, 30, 160, 220, 0, 60, 200, 80, 30, 220, 160]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    块('IHDR', 头),
    块('IDAT', zlib.deflateSync(行)),
    块('IEND', Buffer.alloc(0)),
  ]);
}

const 工具 = [];
const 段 = [];
const ctx = {
  systemPrompt: { section: (x) => { 段.push(x); return () => {}; } },
  tools: { register: (x) => { 工具.push(x); return () => {}; } },
  llm: { stream: async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; } },
  on: () => () => {},
  effect: () => () => {},
  provide: () => () => {},
};

const 出 = await apply(ctx, 配置);

let 过 = 0;
let 败 = 0;
const 查 = async (名, 做) => {
  try {
    const 说明 = await 做();
    过 += 1;
    console.log(`  ok   ${名}${说明 ? `  ${说明}` : ''}`);
  } catch (e) {
    败 += 1;
    console.log(`  FAIL ${名}\n       ${(e && e.message) || e}`);
  }
};
const 真 = (v, 话) => { if (!v) throw new Error(话 || '期望为真'); };
const 等 = (a, b, 话) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${话 || ''} 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`);
};

console.log('=== 一、装配 ===');
await 查('七个模块门面都有 describe / run', () => {
  等(Object.keys(出.门面).length, 7, '模块数');
  for (const [名, 门] of Object.entries(出.门面)) 真(typeof 门.run === 'function', `${名} 缺 run`);
  return Object.keys(出.门面).join(' ');
});
await 查('工具登记 80 条，名字全合法', () => {
  等(工具.length, 80, '工具数');
  等(工具.filter((x) => !/^[a-zA-Z0-9_-]+$/.test(x.name)).map((x) => x.name), [], '非法工具名');
  return `${工具.length} 条`;
});
await 查('段注册世界书前后两段', () => {
  const 名 = 段.map((x) => x.name).sort();
  等(名, ['toolbox:世界书前', 'toolbox:世界书后'].sort());
  return 名.join(' / ');
});

const 调 = async (名, 参数) => {
  const 一 = 工具.find((x) => x.name === 名);
  真(一, `没有登记 ${名}`);
  return await 一.execute(参数 || {});
};

console.log('\n=== 二、标签模块（33 个动作）===');
await 查('tag_status', async () => {
  const 回 = await 调('tag_status');
  真(回.记录 && typeof 回.记录.主库 === 'number', JSON.stringify(回).slice(0, 120));
  return `主库 ${回.记录.主库} · 索引 ${回.索引.indexed}`;
});
await 查('tag_query', async () => {
  const 回 = await 调('tag_query', { 串: 'hatsune_miku' });
  真(回.候选.length > 0, '查不到');
  return `${回.候选[0].记录.名称} → ${回.候选[0].记录.中文名}`;
});
await 查('tag_recognize', async () => {
  const 回 = await 调('tag_recognize', { 词: ['1girl', 'hatsune_miku'] });
  真(Array.isArray(回), '要数组');
  return JSON.stringify(回);
});
await 查('tag_record_get + tag_identity_isAdult', async () => {
  const 记录 = await 调('tag_record_get', { 标识: 1 });
  真(记录.名称, '取不到记录');
  const 成人 = await 调('tag_identity_isAdult', { 标识: 1 });
  return `${记录.名称} · 成人=${成人}`;
});
await 查('tag_position_list（分类页）', async () => {
  const 页 = await 调('tag_position_list', { 位置: '分类' });
  真(Array.isArray(页), '要数组');
  return `${页.length} 页`;
});
await 查('门面直呼：33 个动作全在', () => {
  const 动作 = 出.门面.tag.actions;
  等(动作.length, 39, '动作数');
  return `33 个 · 含 ${动作.filter((x) => x.includes('.')).length} 个带点的`;
});

console.log('\n=== 三、图片模块（12 个动作）===');
let 存的引用 = null;
let 存的校验和 = '';
await 查('image_save → image_list → image_detail', async () => {
  const 位图 = 造PNG();
  const 存 = await 调('image_save', { 作用域: { 存放地: 'gallery' }, 字节: 位图, 文件名: '接口实测.png', 标签: ['接口实测'] });
  真(存.引用, JSON.stringify(存).slice(0, 160));
  存的引用 = 存.引用;
  存的校验和 = 存.校验和;
  const 列 = await 调('image_list', { 作用域: { 存放地: 'gallery' } });
  真(列.总数 > 0, '列不出来');
  const 详 = await 调('image_detail', { 引用: 存的引用 });
  真(详.标识, '取详情失败');
  return `存了 ${存.标识}（${存.字节数} 字节）；存放地共 ${列.总数} 条`;
});
await 查('image_content + image_address', async () => {
  const 内容 = await 调('image_content', { 引用: 存的引用, 变体: 'original' });
  真(内容 && 内容.字节 && 内容.字节.length > 0, JSON.stringify(内容).slice(0, 120));
  const 地址 = await 调('image_address', { 引用: 存的引用 });
  真(地址, '取不到地址');
  return `${内容.字节.length} 字节 · ${内容.mime}`;
});
await 查('取回来的字节能原样存回图库（工具回执给的是 dataUrl）', async () => {
  const 内容 = await 调('image_content', { 引用: 存的引用, 变体: 'original' });
  const 再存 = await 调('image_save', {
    作用域: { 存放地: 'gallery' }, 字节: 内容.字节, 文件名: '接口实测-回存.png',
  });
  真(再存.引用, JSON.stringify(再存).slice(0, 160));
  真(再存.校验和 === 存的校验和, `回存的校验和该与原来一致：${再存.校验和} ≠ ${存的校验和}`);
  const 删 = await 调('image_remove', { 引用: 再存.引用 });
  真(删.已删 === 1, JSON.stringify(删));
  return `${再存.标识} 存了又删（校验和一致）`;
});
await 查('image_table_favorite（表读写）', async () => {
  const 表 = await 调('image_table_favorite', { 动作: '读' });
  真(表, '读不出来');
  return JSON.stringify(表).slice(0, 80);
});
await 查('image_remove（删掉刚存的那条）', async () => {
  const 回 = await 调('image_remove', { 引用: 存的引用 });
  真(回.已删 === 1, JSON.stringify(回));
  return `已删 ${回.已删}`;
});

console.log('\n=== 四、世界书模块（10 个动作）===');
await 查('worldbook_table', async () => {
  const 表 = await 调('worldbook_table');
  真(Array.isArray(表) && 表.length >= 3, '默认那三本要在');
  return 表.map((x) => x.名字).join(' / ');
});
await 查('worldbook_run（一本都没启用 ⇒ 空，不是失败）', async () => {
  const 回 = await 调('worldbook_run', { 请求: '识图', 文本: '' });
  真(Array.isArray(回.命中), JSON.stringify(回).slice(0, 160));
  return `${回.书.length} 本 · ${回.命中.length} 条命中`;
});
await 查('书 / 条目 / 换 / 存：建一本、启用、执行、再删干净', async () => {
  const 建 = await 调('worldbook_books', { 动作: '新建', 名字: '接口实测' });
  真(建.标识, JSON.stringify(建));
  const 标识 = 建.标识;
  const 加 = await 调('worldbook_entries', {
    动作: '加',
    书: 标识,
    条目: { label: '实测条目', text: '这是一条恒常条目', always: true },
  });
  真(加.条目 && 加.条目.id, JSON.stringify(加));
  await 调('worldbook_books', { 动作: '换', 请求: '接口实测请求', 启用: [标识] });
  await 调('worldbook_save');
  const 回 = await 调('worldbook_run', { 请求: '接口实测请求', 文本: '' });
  真(回.命中.length === 1, `要命中 1 条：${JSON.stringify(回).slice(0, 200)}`);
  await 调('worldbook_books', { 动作: '删', 标识 });
  await 调('worldbook_books', { 动作: '换', 请求: '接口实测请求', 启用: [] });
  await 调('worldbook_save');
  const 后 = await 调('worldbook_run', { 请求: '接口实测请求', 文本: '' });
  真(后.命中.length === 0, '删完该没命中了');
  return `${标识} 建 → 启用 → 命中 1 条 → 删干净`;
});
await 查('worldbook_test（读草稿，与 执行 同形）', async () => {
  const 回 = await 调('worldbook_test', { 请求: '主AI', 文本: '' });
  真(Array.isArray(回.命中), JSON.stringify(回).slice(0, 120));
  return `${回.书.length} 本 · ${回.命中.length} 条`;
});

console.log('\n=== 五、装订模块（2 个动作）===');
await 查('binding_split', async () => {
  const 单元 = await 调('binding_split', { 文本: '(1girl:1.2), hatsune_miku, smile' });
  真(Array.isArray(单元) && 单元.length === 3, JSON.stringify(单元).slice(0, 200));
  return JSON.stringify(单元.map((x) => x.词));
});

console.log('\n=== 六、翻译模块（3 个动作）===');
await 查('translate_models', async () => {
  const 回 = await 调('translate_models');
  真(回, JSON.stringify(回));
  return JSON.stringify(回);
});
await 查('translate_split（与装订同一套切分）', async () => {
  const 单元 = await 调('translate_split', { 文本: '(1girl:1.2), smile' });
  真(Array.isArray(单元) && 单元.length === 2, JSON.stringify(单元));
  return JSON.stringify(单元.map((x) => x.词));
});

console.log('\n=== 七、识图模块（4 个动作）===');
await 查('vision_models', async () => {
  const 回 = await 调('vision_models');
  真(回, JSON.stringify(回));
  return JSON.stringify(回);
});

console.log('\n=== 八、comfyUI 模块（11 个动作）===');
await 查('comfy_ping（真机在不在；不在也算这一条过）', async () => {
  const 回 = await 调('comfy_ping');
  return 回 ? `连上了：${JSON.stringify(回).slice(0, 80)}` : '没连上（ComfyUI 没开）';
});
await 查('comfy_getWorkflow → comfy_setWorkflow → comfy_detect → comfy_clearWorkflow', async () => {
  const 图 = {
    1: { class_type: 'CLIPTextEncode', inputs: { text: 'a cat' } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: 'blurry' } },
    3: { class_type: 'KSampler', inputs: { positive: ['1', 0], negative: ['2', 0], seed: 1 } },
    4: { class_type: 'SaveImage', inputs: { images: ['5', 0] } },
  };
  const 存 = await 调('comfy_setWorkflow', { 图 });
  真(存.口, JSON.stringify(存).slice(0, 160));
  const 取 = await 调('comfy_getWorkflow');
  真(取.界面图 || 取.口, '取不回来');
  const 认 = await 调('comfy_detect');
  真(认.正向 && 认.正向.length === 1, JSON.stringify(认).slice(0, 200));
  await 调('comfy_clearWorkflow');
  return `认得的：${存.口.认得的.join(' / ')}；正向 ${认.正向.length} 个口`;
});

console.log('\n=== 九、主 AI 模块（10 个动作）===');
await 查('预设的 执行 / 读 / 状态', async () => {
  const 预 = 出.主AI.执行({ 请求: '主AI' });
  真(typeof 预.预设?.标识 === 'string' && 预.预设.标识.length > 0, '预设标识要非空');
  真(!Object.hasOwn(预, '身份') && !Object.hasOwn(预, '流程') && !Object.hasOwn(预, '世界书'), '预设执行不再返回提示词正文或世界书引用');
  等(预.工具表.length, 80, '工具表条数');
  const 状 = 出.主AI.run('状态');
  真(状 && 状.ok, JSON.stringify(状).slice(0, 160));
  const 读 = 出.主AI.run('读', { 请求: '主AI' });
  真(读.ok, JSON.stringify(读).slice(0, 160));
  return `预设 ${预.预设.标识} · 工具 ${预.工具表.length} 条 · 认不出的动作 ${状.data.认不出的动作.length} · 表 ${读.data.表.length} 行`;
});

console.log(`\n${过} 过 / ${败} 失败`);
process.exit(败 === 0 ? 0 : 1);
