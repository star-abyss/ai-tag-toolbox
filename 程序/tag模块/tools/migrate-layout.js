'use strict';
/*
 * 一次性转换：把 data/ 从"一个键一个文件"改成新布局。
 *
 *   记录/主库/NNN.jsonl       每片 1000 条，一行一条
 *   记录/自建库.jsonl  隐藏库.jsonl  修改库.jsonl
 *   位置/分类/<页ID>/页.json  位置/分类/<页ID>/<类ID>.json
 *   表/成人.json  角色.json  注释.json  常用词.json
 *   index.json
 *
 * 丢掉记录上的「子分类」字段（它只是重构时的中间变量，运行时无人读）。
 *
 * 用法：node tools/migrate-layout.js [--data <目录>] [--backup <目录>] [--dry]
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const 传参 = (名, 兜底) => (args.includes(名) ? args[args.indexOf(名) + 1] : 兜底);
const DATA = path.resolve(传参('--data', path.join(__dirname, '..', 'data')));
const DRY = args.includes('--dry');
const 每片 = 1000;

/** 记录里的字段顺序定死，diff 才稳。 */
const 字段序 = ['ID', '名称', '中文名', '成员', '成人', '回显'];
const 说 = (s) => console.log(s);

function 读(key, 兜底 = null) {
  const p = path.join(DATA, `${key}.json`);
  if (!fs.existsSync(p)) return 兜底;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
/** 按字段序排好再序列化：一行一条，字段顺序固定。 */
function 一行(记录) {
  const 干净 = {};
  for (const k of 字段序) if (记录[k] !== undefined) 干净[k] = 记录[k];
  for (const k of Object.keys(记录)) if (k !== '子分类' && !(k in 干净)) 干净[k] = 记录[k];
  return JSON.stringify(干净);
}
function 写JSON(目标, 值) {
  fs.mkdirSync(path.dirname(目标), { recursive: true });
  fs.writeFileSync(目标, JSON.stringify(值, null, 2) + '\n', 'utf8');
}
function 写JSONL(目标, 记录数组) {
  fs.mkdirSync(path.dirname(目标), { recursive: true });
  if (!记录数组.length) return;
  fs.writeFileSync(目标, 记录数组.map(一行).join('\n') + '\n', 'utf8');
}
function 目录字节(p) {
  let n = 0;
  if (!fs.existsSync(p)) return 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    n += e.isDirectory() ? 目录字节(f) : fs.statSync(f).size;
  }
  return n;
}
function 数文件(p) {
  let n = 0;
  if (!fs.existsSync(p)) return 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    n += e.isDirectory() ? 数文件(f) : 1;
  }
  return n;
}

// ============ 1. 读旧数据 ============
const 主库 = 读('主库');
if (!主库) { console.error('找不到 主库.json，数据目录不对：' + DATA); process.exit(1); }
const 自建库 = 读('自建库');
const 隐藏库 = 读('隐藏库');
const 修改库 = 读('修改库');
const 分类字典 = 读('分类字典');
const 收藏字典 = 读('收藏字典');

const 旧记录数 = 主库.记录列表.length;
const 子分类条数 = 主库.记录列表.filter((r) => r.子分类).length;
const 旧总字节 = fs.readdirSync(DATA).filter((f) => f.endsWith('.json'))
  .reduce((n, f) => n + fs.statSync(path.join(DATA, f)).size, 0);
const 旧文件数 = fs.readdirSync(DATA).filter((f) => f.endsWith('.json')).length;

/** 旧布局里某个根下，每个成员 ID 在格里出现多少次。 */
function 旧位置(字典, 根) {
  const 计数 = new Map();
  const 逐页 = new Map();
  let 格数 = 0;
  for (const 页 of 字典.页列表) {
    let 页计数 = 0;
    for (const 类 of 页.类列表) {
      const 格 = 读(`${根}.${页.ID}.${类.ID}`, []);
      if (格.length) 格数++;
      页计数 += 格.length;
      for (const id of 格) 计数.set(String(id), (计数.get(String(id)) || 0) + 1);
    }
    逐页.set(String(页.ID), 页计数);
  }
  let 总边 = 0;
  for (const v of 计数.values()) 总边 += v;
  return { 计数, 格数, 逐页, 总边 };
}
const 旧分类 = 旧位置(分类字典, '分类');
const 旧收藏 = 旧位置(收藏字典, '收藏');

// ============ 2. 备份 ============
const 备份 = path.resolve(传参('--backup', path.join(DATA, '..', 'data-旧布局备份')));
if (!DRY) {
  if (fs.existsSync(备份)) { console.error('备份目录已存在，先挪走：' + 备份); process.exit(1); }
  fs.mkdirSync(备份, { recursive: true });
  for (const f of fs.readdirSync(DATA)) {
    if (f.endsWith('.json')) fs.copyFileSync(path.join(DATA, f), path.join(备份, f));
  }
  说('备份完成：' + 备份 + '（' + fs.readdirSync(备份).length + ' 个文件）');
}

// ============ 3. 建新结构 ============
const 新根 = DRY ? path.join(require('os').tmpdir(), 'layout-dry-' + Date.now()) : DATA;
const 新 = (rel) => path.join(新根, rel);
fs.mkdirSync(新根, { recursive: true });

写JSON(新('index.json'), {
  格式: 'tag-module/索引',
  版本: 1,
  分片: 每片,
  计数器: { 主库: 主库.计数器 || 旧记录数, 自建库: 自建库 ? 自建库.计数器 : 0 },
});

const 主库记录 = [...主库.记录列表].sort((a, b) => Number(a.ID) - Number(b.ID));
let 片数 = 0;
for (let i = 0; i < 主库记录.length; i += 每片) {
  写JSONL(新(`记录/主库/${String(Math.floor(i / 每片)).padStart(3, '0')}.jsonl`), 主库记录.slice(i, i + 每片));
  片数++;
}
写JSONL(新('记录/自建库.jsonl'), 自建库 ? 自建库.记录列表 : []);
写JSONL(新('记录/隐藏库.jsonl'), 隐藏库 ? 隐藏库.记录列表 : []);
写JSONL(新('记录/修改库.jsonl'), 修改库 ? 修改库.记录列表 : []);

for (const [根, 字典] of [['分类', 分类字典], ['收藏', 收藏字典]]) {
  for (const 页 of 字典.页列表) {
    写JSON(新(`位置/${根}/${页.ID}/页.json`), {
      页名: 页.页名,
      配色: 页.配色,
      类列表: 页.类列表.map((c) => ({ ID: c.ID, 类名: c.类名, 配色: c.配色 })),
    });
    for (const 类 of 页.类列表) {
      const 成员 = 读(`${根}.${页.ID}.${类.ID}`, []).map(String);
      if (成员.length) 写JSON(新(`位置/${根}/${页.ID}/${类.ID}.json`), 成员);
    }
  }
}

for (const [旧名, 新名] of [['成人', '表/成人'], ['角色', '表/角色'], ['注释', '表/注释'], ['常用词', '表/常用词']]) {
  const v = 读(旧名, null);
  if (v === null) continue;
  const 空 = Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0;
  if (!空) 写JSON(新(`${新名}.json`), v);
}

// 重构报告是构建产物，不是运行时数据，原样搬过来当账本
const 报告 = 读('重构报告', null);
if (报告) 写JSON(新('重构报告.json'), 报告);

// ============ 4. 五项对账 ============
说('\n=== 转换对账 ===');
let 全过 = true;

// ① 记录条数
const 回读 = [];
const 片目录 = 新('记录/主库');
const 片文件 = fs.readdirSync(片目录).filter((f) => f.endsWith('.jsonl')).sort();
for (const f of 片文件) {
  for (const line of fs.readFileSync(path.join(片目录, f), 'utf8').split('\n')) if (line.trim()) 回读.push(JSON.parse(line));
}
const 条数对 = 旧记录数 === 回读.length;
全过 = 全过 && 条数对;
说(`① 记录条数 ${旧记录数} → ${回读.length}  ${条数对 ? '✅' : '❌'}`);

// ② 逐条内容（丢掉 子分类 之后应当完全一致）
const 回读表 = new Map(回读.map((r) => [String(r.ID), r]));
let 不一致 = 0, 首个 = '';
for (const r of 主库.记录列表) {
  const b = 回读表.get(String(r.ID));
  if (!b) { 不一致++; 首个 = 首个 || `缺 ID ${r.ID}`; continue; }
  if (一行(r) !== 一行(b)) { 不一致++; 首个 = 首个 || `ID ${r.ID} 内容不同`; }
}
const 内容对 = 不一致 === 0;
全过 = 全过 && 内容对;
说(`② 逐条内容（丢 子分类 后）不一致 ${不一致} 条  ${内容对 ? '✅' : '❌ ' + 首个}`);

// ③ 归属一个不丢：按根、按页逐个核对
function 新位置核对(根) {
  const 计数 = new Map();
  const 逐页 = new Map();
  let 格数 = 0, 总边 = 0;
  const 根目录 = 新(`位置/${根}`);
  if (!fs.existsSync(根目录)) return { 计数, 格数, 逐页, 总边 };
  for (const 页ID of fs.readdirSync(根目录)) {
    let 页计数 = 0;
    const d = path.join(根目录, 页ID);
    for (const f of fs.readdirSync(d)) {
      if (f === '页.json') continue;
      const 成员 = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
      格数++; 总边 += 成员.length; 页计数 += 成员.length;
      for (const id of 成员) 计数.set(String(id), (计数.get(String(id)) || 0) + 1);
    }
    逐页.set(页ID, 页计数);
  }
  return { 计数, 格数, 逐页, 总边 };
}
for (const [根, 旧] of [['分类', 旧分类], ['收藏', 旧收藏]]) {
  const 新的 = 新位置核对(根);
  const 成员同 = 旧.计数.size === 新的.计数.size && [...旧.计数].every(([k, v]) => 新的.计数.get(k) === v);
  const 页同 = 旧.逐页.size === 新的.逐页.size && [...旧.逐页].every(([k, v]) => 新的.逐页.get(k) === v);
  const 归属对 = 成员同 && 页同 && 旧.总边 === 新的.总边;
  全过 = 全过 && 归属对;
  说(`③ ${根} 归属：格 ${旧.格数}→${新的.格数} · 成员边 ${旧.总边}→${新的.总边}`
    + ` · 每个 ID 出现次数${成员同 ? '一致' : '不一致'} · 每页成员数${页同 ? '一致' : '不一致'}  ${归属对 ? '✅' : '❌'}`);
}

// ④ 四张表
let 表不一致 = 0;
for (const [旧名, 新名] of [['成人', '表/成人'], ['角色', '表/角色'], ['注释', '表/注释'], ['常用词', '表/常用词']]) {
  const a = 读(旧名, null);
  const p = 新(`${新名}.json`);
  const b = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : (Array.isArray(a) ? [] : {});
  if (JSON.stringify(a) !== JSON.stringify(b)) { 表不一致++; 说(`   ❌ ${旧名} 不一致`); }
}
全过 = 全过 && 表不一致 === 0;
说(`④ 四张表内容不一致 ${表不一致} 张  ${表不一致 === 0 ? '✅' : '❌'}`);

// ⑤ 体积与文件数
const 新总字节 = 目录字节(新根);
const 新文件数 = 数文件(新根);
说(`⑤ 体积 ${(旧总字节 / 1048576).toFixed(2)} MB / ${旧文件数} 个文件`
  + ` → ${(新总字节 / 1048576).toFixed(2)} MB / ${新文件数} 个文件`
  + `（主库 ${片数} 片，每片 ${每片} 条）`);
说(`   丢掉 子分类：${子分类条数} 条记录带它`);

说(`\n结果：${全过 ? '✅ 对账通过' : '❌ 有失败项，不要落地'}`);

if (DRY) {
  fs.rmSync(新根, { recursive: true, force: true });
  说('（--dry：临时目录已删）');
} else if (全过) {
  // 删旧布局的文件（index.json 与 重构报告.json 属于新布局，留着）
  let 删 = 0;
  for (const f of fs.readdirSync(DATA)) {
    if (f.endsWith('.json') && f !== 'index.json' && f !== '重构报告.json') { fs.rmSync(path.join(DATA, f)); 删++; }
  }
  if (!fs.existsSync(新('index.json'))) { console.error('❌ 索引文件不见了：' + 新('index.json')); process.exit(1); }
  说(`删除旧布局文件 ${删} 个 · 新布局索引在 ${新('index.json')}`);
} else {
  说('对账失败，已保留旧文件（备份也在：' + 备份 + '）');
}
process.exit(全过 ? 0 : 1);
