'use strict';
/*
 * 一次性转换：角色与作品这一块（设计见 work/角色与作品_设计稿.md）。
 *
 *   甲   4049 条作品记录：删掉 `成员` 字段（作品是 tag，不是组）
 *   乙1  页 14「作品系列」→「作品」
 *   乙2  类 15「默认」→「作品」，成员校正为作品集（删 31 个非作品、补 4 个漏的）
 *   乙3  页 222「角色名」→「角色组」
 *   乙4  类 223「角色名」→ 删掉
 *   乙5  页「角色组」底下建 4049 个作品类，成员 = 成员第 0 位指向该作品的角色
 *   乙6  页「角色组」底下建 1 个类「未分类」，成员 = 没有作品的角色
 *
 * 真值两处，都从盘上读：
 *   data/表/系列.json   → 作品集（哪些 ID 是作品）
 *   data/表/角色.json   → 角色集（哪些 ID 是角色组）
 *
 * 用法：node tools/甲乙-角色与作品.js [--data <目录>] [--dry] [--备份 <目录>] [--回滚 <备份目录>]
 *   --dry      只报数、不写盘
 *   跑过之后再跑就是"只核对不写"，核对不过非零退出。
 *   正式跑之前自动整份备份（默认到 work/备份-甲乙-<时间戳>/）。
 */
const fs = require('fs');
const path = require('path');
const { createFilePort } = require('../adapter-file.js');
const { 记录行 } = require('../layout.js');

const args = process.argv.slice(2);
const 传参 = (名, 兜底) => (args.includes(名) ? args[args.indexOf(名) + 1] : 兜底);
const DATA = path.resolve(传参('--data', path.join(__dirname, '..', 'data')));
const DRY = args.includes('--dry');
const 回滚源 = 传参('--回滚', null);

const 说 = (s) => console.log(s);
const 标 = (k, v) => 说(String(k).padEnd(42) + ' ' + v);
const 页目录 = (根, 页ID) => path.join(DATA, '位置', 根, String(页ID));
const 格路径 = (根, 页ID, 类ID) => path.join(页目录(根, 页ID), `${类ID}.json`);

/** 新类用的默认配色：页 14 那一格现有类的那一组。 */
const 类配色 = { background: '#3a5560', foreground: '#eaf3f6' };
const 未分类配色 = { background: '#7a3f52', foreground: '#fdeef2' };

const 读json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const 读页 = (页ID) => 读json(path.join(页目录('分类', 页ID), '页.json'));

function 写json(p, 值) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(值, null, 2) + '\n', 'utf8');
}

/** 记录去掉 `成员` 字段，字段顺序按 layout.js 的 记录字段序。 */
function 去掉成员(记录) {
  const 新 = {};
  for (const k of ['ID', '名称', '中文名', '成人', '回显']) if (记录[k] !== undefined) 新[k] = 记录[k];
  for (const k of Object.keys(记录)) if (k !== '成员' && !(k in 新)) 新[k] = 记录[k];
  return 新;
}

// ─────────────────────────── 备份与回滚 ───────────────────────────

function 挑备份目录() {
  const 给定 = 传参('--备份', null);
  if (给定) return path.resolve(给定);
  const 时 = new Date();
  const 两位 = (n) => String(n).padStart(2, '0');
  const 戳 = `${时.getFullYear()}${两位(时.getMonth() + 1)}${两位(时.getDate())}`
    + `-${两位(时.getHours())}${两位(时.getMinutes())}${两位(时.getSeconds())}`;
  return path.join(path.resolve(__dirname, '..', '..', '..', '临时', 'work'), `备份-甲乙-${戳}`);
}

function 整份拷贝(从, 到) {
  fs.mkdirSync(到, { recursive: true });
  for (const e of fs.readdirSync(从, { withFileTypes: true })) {
    const a = path.join(从, e.name);
    const b = path.join(到, e.name);
    if (e.isDirectory()) 整份拷贝(a, b);
    else fs.copyFileSync(a, b);
  }
}

function 回滚(从) {
  if (!fs.existsSync(path.join(从, 'index.json'))) {
    说(`备份目录里没有 index.json，不像一份完整的数据：${从}`);
    process.exit(1);
  }
  说(`回滚：${从} → ${DATA}`);
  fs.rmSync(DATA, { recursive: true, force: true });
  整份拷贝(从, DATA);
  说('回滚完成');
}

// ─────────────────────────── 主流程 ───────────────────────────

function 主() {
  if (回滚源) return 回滚(path.resolve(回滚源));

  const 系列 = 读json(path.join(DATA, '表', '系列.json')).map(String);
  const 角色表 = 读json(path.join(DATA, '表', '角色.json')).map(String);
  const 作品集 = new Set(系列);
  const 角色集 = new Set(角色表);

  const port = createFilePort({ root: DATA });
  const 主库 = port.read('主库');
  if (主库.state !== 'ok') {
    说(`主库读不出来：${主库.reason || 主库.state}`);
    process.exit(1);
  }
  const 记录们 = 主库.value.记录列表;
  const byId = new Map(记录们.map((r) => [String(r.ID), r]));
  const 页14 = 读页(14);
  const 页222 = 读页(222);
  const 旧格15 = 读json(格路径('分类', 14, 15)).map(String);
  const 旧边数 = 记录们.reduce((n, r) => n + (r.成员 || []).length, 0);

  // 角色 → 它的作品（成员第 0 位落在作品集里才算）
  const 角色的作品 = new Map();
  const 没作品 = [];
  for (const id of 角色表) {
    const r = byId.get(id);
    const 成 = (r && Array.isArray(r.成员) ? r.成员 : []).map(String);
    if (成.length && 作品集.has(成[0])) 角色的作品.set(id, 成[0]);
    else 没作品.push(id);
  }
  const 作品的角色 = new Map(系列.map((w) => [w, []]));
  for (const [角色, 作品] of 角色的作品) 作品的角色.get(作品).push(角色);

  const 作品还带成员 = 系列.filter((w) => Array.isArray((byId.get(w) || {}).成员));
  const 已做过 = 作品还带成员.length === 0
    && 页14.页名 === '作品' && 页222.页名 === '角色组'
    && 页222.类列表.length === 系列.length + 1;

  说(`数据目录 ${DATA}`);
  标('记录 / 作品集 / 角色集', `${记录们.length} / ${系列.length} / ${角色表.length}`);
  标('带 `成员` 的作品', 作品还带成员.length);
  标('页 14 的页名 / 类数', `${页14.页名} / ${页14.类列表.length}（格 ${旧格15.length} 个成员）`);
  标('页 222 的页名 / 类数', `${页222.页名} / ${页222.类列表.length}`);
  标('有作品的角色 / 没作品的角色', `${角色的作品.size} / ${没作品.length}`);
  标('作品类里有成员的作品', 系列.filter((w) => 作品的角色.get(w).length).length);
  说('');

  if (已做过) {
    说('看起来已经做过了 —— 只核对，不写盘');
    核对(port, { 系列, 角色表, 作品的角色, 没作品, 记录们, 旧页222类数: 1, 旧格15 });
    return;
  }

  // ---------- 目标：页 14 ----------
  const 格15新 = [...系列].sort((a, b) => Number(a) - Number(b));
  const 只在旧格 = 旧格15.filter((x) => !作品集.has(x));
  const 只在系列 = 系列.filter((x) => !new Set(旧格15).has(x));

  // ---------- 目标：页 222 ----------
  const 用过的ID = [];
  for (const d of fs.readdirSync(path.join(DATA, '位置', '分类'))) {
    if (!/^\d+$/.test(d)) continue;
    用过的ID.push(Number(d));
    for (const c of 读页(d).类列表) 用过的ID.push(Number(c.ID));
  }
  let 下一个 = Math.max(...用过的ID) + 1;
  const 新类 = [];
  for (const w of 系列) {
    const 名 = String((byId.get(w) || {}).名称 || '').split(',')[0].trim() || String(w);
    新类.push({ ID: 下一个++, 类名: 名, 配色: 类配色, 成员: 作品的角色.get(w) });
  }
  const 未分类 = { ID: 下一个++, 类名: '未分类', 配色: 未分类配色, 成员: 没作品 };

  if (DRY) {
    说('── --dry：没有写盘 ──');
    说('');
    标('甲：要删 `成员` 的作品', 作品还带成员.length);
    说(`乙2：类 15 成员 ${旧格15.length} → ${格15新.length}`);
    说(`      删掉非作品 ${只在旧格.length} 个：${只在旧格.slice(0, 6).map((x) => (byId.get(x) || {}).名称).join(' , ')}${只在旧格.length > 6 ? ' …' : ''}`);
    说(`      补进漏的 ${只在系列.length} 个：${只在系列.map((x) => (byId.get(x) || {}).名称).join(' , ')}`);
    说(`乙5：建作品类 ${新类.length} 个，成员 ${[...作品的角色.values()].reduce((n, a) => n + a.length, 0)} 个`);
    说(`乙6：建「未分类」，成员 ${未分类.成员.length} 个`);
    说(`新类 ID ${新类[0].ID} – ${未分类.ID}（现用掉 ${用过的ID.length} 个，最大 ${Math.max(...用过的ID)}）`);
    说('');
    说('对账目标（跑完拿盘上的数复核）：');
    标('  带 `成员` 的记录', `${记录们.filter((r) => Array.isArray(r.成员)).length} → ${角色表.length}`);
    标('  全库成员边', `${旧边数} → ${角色表.reduce((n, id) => n + ((byId.get(id) || {}).成员 || []).length, 0) + 角色的作品.size + 没作品.length}`);
    标('  页「作品」那一格', `${旧格15.length} → ${格15新.length}`);
    标('  页「角色组」的类数', `${页222.类列表.length} → ${新类.length + 1}`);
    标('  「未分类」的成员数', `— → ${没作品.length}`);
    return;
  }

  // ---------- 备份 ----------
  const 备份到 = 挑备份目录();
  if (fs.existsSync(备份到)) {
    说(`备份目录已经在了，换个名字或删掉它：${备份到}`);
    process.exit(1);
  }
  整份拷贝(DATA, 备份到);
  标('备份', 备份到);

  // ---------- 甲：作品删成员 ----------
  const 改的 = 系列.filter((w) => Array.isArray((byId.get(w) || {}).成员)).map((w) => 去掉成员(byId.get(w)));
  if (改的.length) {
    const 新列表 = 记录们.map((x) => (作品集.has(String(x.ID)) ? 去掉成员(x) : x));
    const 片号们 = new Set(改的.map((r) => Math.floor(Number(r.ID) / 1000)));
    说(`甲：改 ${改的.length} 条 · 落在 ${片号们.size} 片里 · 新列表 ${新列表.length} 条`
      + `（带成员 ${新列表.filter((x) => Array.isArray(x.成员)).length}）`);
    const r = port.set('主库', { ...主库.value, 记录列表: 新列表 }, { 记录: 改的 });
    if (!r.ok) {
      说(`写主库失败：${r.reason}`);
      process.exit(1);
    }
  }
  标('甲：删掉 `成员` 的作品', 改的.length);

  // ---------- 乙1 / 乙2：页 14 ----------
  写json(path.join(页目录('分类', 14), '页.json'), {
    页名: '作品',
    配色: 页14.配色,
    类列表: [{ ID: 15, 类名: '作品', 配色: 页14.类列表[0] ? 页14.类列表[0].配色 : 类配色 }],
  });
  写json(格路径('分类', 14, 15), 格15新);

  // ---------- 乙3 – 乙6：页 222 ----------
  写json(path.join(页目录('分类', 222), '页.json'), {
    页名: '角色组',
    配色: 页222.配色,
    类列表: 新类.map((c) => ({ ID: c.ID, 类名: c.类名, 配色: c.配色 }))
      .concat([{ ID: 未分类.ID, 类名: 未分类.类名, 配色: 未分类.配色 }]),
  });
  for (const c of 新类.concat([未分类])) 写json(格路径('分类', 222, c.ID), c.成员);
  fs.rmSync(格路径('分类', 222, 223), { force: true });

  标('乙：页 14 成员', `${旧格15.length} → ${格15新.length}`);
  标('乙：页 222 类数', `${页222.类列表.length} → ${新类.length + 1}`);
  说('');

  // ---------- 对账：拿盘上的数复核 ----------
  核对(createFilePort({ root: DATA }), {
    系列, 角色表, 作品的角色, 没作品, 记录们, 旧边数, 旧页222类数: 页222.类列表.length, 旧格15,
  });
}

// ─────────────────────────── 对账 ───────────────────────────

function 核对(port, 上下文) {
  const { 系列, 角色表, 作品的角色, 没作品 } = 上下文;
  const 主库 = port.read('主库');
  if (主库.state !== 'ok') {
    说('主库读不出来');
    process.exit(1);
  }
  const 记录们 = 主库.value.记录列表;
  const byId = new Map(记录们.map((r) => [String(r.ID), r]));
  const 作品集 = new Set(系列);
  const 页222 = 读页(222);
  const 页14 = 读页(14);
  const 格15 = fs.existsSync(格路径('分类', 14, 15)) ? 读json(格路径('分类', 14, 15)).map(String) : [];

  const 项 = [];
  const 判 = (名, 通过, 实际) => 项.push({ 名, 通过, 实际 });

  const 带成员的 = 记录们.filter((r) => Array.isArray(r.成员));
  const 记录边 = 记录们.reduce((n, r) => n + (r.成员 || []).length, 0);
  const 角色边 = 角色表.reduce((n, id) => n + ((byId.get(id) || {}).成员 || []).length, 0);
  const 类边 = 角色的作品边() + 没作品.length;
  const 应边 = 角色边 + 类边;
  if (process.env.TAG_DEBUG) {
    说(`[调试] 角色边 ${角色边} · 作品边 ${角色的作品边()} · 未分类 ${没作品.length} · 类边 ${类边} · 应边 ${应边} · 记录边 ${记录边}`);
  }

  判('带 `成员` 的作品 0 条',
    系列.every((w) => !Array.isArray((byId.get(w) || {}).成员)),
    `${系列.filter((w) => Array.isArray((byId.get(w) || {}).成员)).length} 条还带着`);
  判('带 `成员` 的记录只剩角色',
    带成员的.length === 角色表.length && 带成员的.every((r) => 角色表.includes(String(r.ID))),
    `${带成员的.length}（角色表 ${角色表.length}）`);
  判('记录上的成员边 = 角色边',
    记录边 === 角色边,
    `${记录边}（应 ${角色边}${上下文.旧边数 != null ? ` · 旧 ${上下文.旧边数}` : ''} · 作品边已退场）`);
  判('页「作品」的类成员 = 作品集',
    格15.length === 系列.length && 格15.every((x) => 作品集.has(x)),
    `${格15.length} / ${系列.length}`);
  判('页「作品」页名与类名',
    页14.页名 === '作品' && 页14.类列表.length === 1 && 页14.类列表[0].类名 === '作品',
    `${页14.页名} / ${页14.类列表.map((c) => c.类名).join(',')}`);
  判('页「角色组」页名', 页222.页名 === '角色组', 页222.页名);
  判('页「角色组」类数 = 作品数 + 1',
    页222.类列表.length === 系列.length + 1,
    `${页222.类列表.length}（应 ${系列.length + 1}${上下文.旧页222类数 != null ? ` · 旧 ${上下文.旧页222类数}` : ''}）`);
  判('旧类 223 的格已删',
    !fs.existsSync(格路径('分类', 222, 223)),
    fs.existsSync(格路径('分类', 222, 223)) ? '还在' : '已删');

  let 类成员合计 = 0;
  const 空类 = [];
  const 类名到成员 = new Map();
  for (const c of 页222.类列表) {
    const p = 格路径('分类', 222, c.ID);
    const 成员 = fs.existsSync(p) ? 读json(p).map(String) : [];
    类名到成员.set(c.类名, 成员);
    类成员合计 += 成员.length;
    if (!成员.length) 空类.push(c.类名);
  }
  判('作品类 + 未分类 的成员合计 = 角色表',
    类成员合计 === 角色表.length,
    `${类成员合计} / ${角色表.length}`);
  判('类里的成员边 = 作品边 + 未分类',
    类成员合计 === 类边,
    `${类成员合计}（应 ${类边}）`);
  判('记录边 + 类边 = 509706（改动前的全库成员边）',
    记录边 + 类成员合计 === 509706,
    `${记录边} + ${类成员合计} = ${记录边 + 类成员合计}`);
  判('没有空类', 空类.length === 0, 空类.length ? `${空类.length} 个：${空类.slice(0, 5).join(',')}` : '0 个');
  判('「未分类」成员数 = 没作品的角色',
    (类名到成员.get('未分类') || []).length === 没作品.length,
    `${(类名到成员.get('未分类') || []).length} / ${没作品.length}`);

  const 出现 = new Map();
  for (const [, 成员] of 类名到成员) for (const id of 成员) 出现.set(id, (出现.get(id) || 0) + 1);
  判('每个角色各出现一次',
    出现.size === 角色表.length && [...出现.values()].every((n) => n === 1),
    `出现过 ${出现.size} 个 · 重复 ${[...出现.values()].filter((n) => n > 1).length} 个`);

  let 对不上 = 0;
  const 名到ID = new Map();
  for (const w of 系列) 名到ID.set(String((byId.get(w) || {}).名称 || '').split(',')[0].trim(), w);
  for (const [类名, 成员] of 类名到成员) {
    if (类名 === '未分类') continue;
    const w = 名到ID.get(类名);
    if (!w) { 对不上++; continue; }
    const 应有 = (作品的角色.get(w) || []).slice().sort();
    if (应有.join() !== 成员.slice().sort().join()) 对不上++;
  }
  判('作品类的成员 = 成员第 0 位算出来的', 对不上 === 0, `${对不上} 个类对不上`);

  // 记录逐条：只有作品少了 `成员`，别的记录一个字不动
  // （只在刚写过那一次才比得出"少了什么"；重跑时盘上已经是终态，那两项就报"已是终态"）
  const { 记录行 } = require('../layout.js');
  const 旧 = 上下文.记录们 || [];
  let 变了 = 0;
  let 乱变 = 0;
  for (const r of 旧) {
    const 新 = byId.get(String(r.ID));
    if (记录行(r) === 记录行(新)) continue;
    变了++;
    if (!(作品集.has(String(r.ID)) && 记录行(去掉成员(r)) === 记录行(新))) 乱变++;
  }
  const 刚写过 = 上下文.旧边数 != null;
  if (刚写过) {
    判('记录条数没变', 记录们.length === 旧.length, `${记录们.length} / ${旧.length}`);
    判('变的记录只有作品，且只少了 `成员`',
      变了 === 系列.length && 乱变 === 0,
      `变了 ${变了} 条（作品 ${系列.length}）· 乱变 ${乱变} 条`);
  } else {
    判('记录的成员边就是这个形状（重跑，已是终态）', 记录边 + 类成员合计 === 509706,
      `${记录边} + ${类成员合计} = ${记录边 + 类成员合计}（改动前 509180 + 526）`);
    判('重跑没有改动任何记录', 变了 === 0, `变了 ${变了} 条`);
  }

  说('── 对账 ──');
  let 坏 = 0;
  for (const x of 项) {
    if (!x.通过) 坏++;
    说(`${x.通过 ? '✅' : '❌'} ${x.名}  ${x.实际}`);
  }
  说('');
  if (坏) {
    说(`对账不过：${坏} 项`);
    process.exit(1);
  }
  说('对账全部通过');

  function 角色的作品边() {
    return [...作品的角色.values()].reduce((n, a) => n + a.length, 0);
  }
}

主();
