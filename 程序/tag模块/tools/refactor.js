'use strict';
/*
 * 重构程序 —— 把源数据按本模块的键空间重新编排一份。
 *
 * 用法：
 *   node tools/refactor.js --src <unified-tag-base.json> [--out <输出目录>]
 *   输出目录默认是本模块的 data/。
 *
 * 它做五件事，全是"编排"，不含任何运行时的判断：
 *   ① 筛          折键折不出"词"的（;)、>_< 这种纯符号表情）回收掉
 *   ② 合          比对键相同的合成一条：多写法进「名称」，多中文名进「中文名」
 *   ③ 分配 ID     主库数字自增；组接在记录后面，同一个计数器
 *   ④ 编位置      旧分类 → 页，旧子分类 → 类，格里只放 ID
 *   ⑤ 编身份      成人标签表 · 角色表 · 系列表
 *                 角色组 = 那个角色的特征标签；系列组 = 该系列的角色
 *
 * 输出目录结构 = 本模块的键空间：
 *   主库.json  自建库.json  隐藏库.json  修改库.json
 *   成人.json  角色.json  系列.json  注释.json  常用词.json
 *   分类字典.json  分类.<页ID>.<类ID>.json  收藏字典.json
 *   重构报告.json
 *
 * ⚠️ 它生成的是**旧形状**：作品还带着 `成员`、页还叫「作品系列」与「角色名」。
 * 要得到现在这份数据（作品退回 tag · 页「作品」+ 页「角色组」拆成 4049 个作品类 + 未分类），
 * 生成之后跟上 `tools/甲乙-角色与作品.js`（决定 120–122）。
 */

const fs = require('fs');
const path = require('path');

/** 源数据由 --src 给；输出目录默认是本模块的 data/。 */
const DEFAULT_OUT = path.resolve(__dirname, '..', 'data');

const { toKey, joinValues, splitValues } = require('../normalize.js');

/** 页与类的配色：底色 + 文字色。 */
const PALETTE = [
  { background: '#2b2f36', foreground: '#e8e8ea' },
  { background: '#287ea4', foreground: '#f2f8fb' },
  { background: '#5a4a84', foreground: '#f0ecfa' },
  { background: '#3f6b4a', foreground: '#eef7f0' },
  { background: '#8a5a2b', foreground: '#fdf3e7' },
  { background: '#7a3f52', foreground: '#fdeef2' },
  { background: '#3a5560', foreground: '#eaf3f6' },
  { background: '#5c5c2e', foreground: '#f7f7e8' },
];

function parseArgs(argv) {
  const args = { src: '', out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--src') args.src = argv[i + 1];
    else if (argv[i] === '--out') args.out = argv[i + 1];
  }
  if (!args.src) {
    console.log('用法：node tools/refactor.js --src <unified-tag-base.json> [--out <输出目录>]');
    console.log(`  --src   源数据文件（必给）`);
    console.log(`  --out   输出目录，默认 ${DEFAULT_OUT}`);
    process.exit(1);
  }
  return args;
}

const writeJson = (target, value) => fs.writeFileSync(target, JSON.stringify(value), 'utf8');

function main() {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const report = {
    源: args.src,
    输出: args.out,
    计数: {},
    筛掉: {},
    合并: {},
    合并样例: [],
    合并里跨分类的: [],
    备注: [],
  };

  const raw = JSON.parse(fs.readFileSync(args.src, 'utf8'));
  const sourceTags = raw.tags || [];
  const sourceCategories = (raw.categories || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const sourceSubs = raw.subcategories || [];
  const links = raw.characterLinks || [];
  const characterInfo = raw.characterInfo || {};

  report.计数.源记录 = sourceTags.length;
  report.计数.源分类 = sourceCategories.length;
  report.计数.源子分类 = sourceSubs.length;

  // ---------- ①② 筛 + 合 ----------
  // 同一个比对键 = 同一个词，合成一条：多写法进「名称」，多中文名进「中文名」。
  const groups = new Map();   // 比对键 → { 写法[], 中文名[], 源[] }
  const dropped = [];         // 折键折不出"词"的
  const redirect = new Map(); // 旧 ID → 比对键（落定后才知道新 ID）

  /**
   * 折出来的东西像不像"词"，不像的给回收原因。
   *   ">_<"、"^_^"  → 折出来是空的
   *   ":3"、";d"、">:)" → 折出来只剩一个字符 3 / d / )
   * 长度 ≥ 2 的照留（"3d"、"4k"、"8k"）。
   * @returns {string} '' 表示留，否则是回收原因
   */
  function whyNotAWord(key, content) {
    if (!key) return '折键折不出词（纯符号表情）';
    if (key.length < 2) return `折键只剩一个字符（"${content}" → "${key}"）`;
    return '';
  }

  for (const tag of sourceTags) {
    const key = toKey(tag.content);
    const reason = whyNotAWord(key, tag.content);
    if (reason) { dropped.push({ 旧ID: tag.id, 内容: tag.content, 键: key, 原因: reason }); continue; }
    if (!groups.has(key)) groups.set(key, { 写法: [], 中文名: [], 源: [] });
    const group = groups.get(key);
    const display = String(tag.displayName || '').trim();
    if (display && toKey(display) !== key) group.中文名.push(display);
    for (const alias of tag.aliases || []) {
      const text = String(alias).trim();
      if (text) group.中文名.push(text);
    }
    group.写法.push(String(tag.content));
    group.源.push({ 旧ID: tag.id, 子分类: tag.subcategoryId || '', 成人: tag.adult === true, 回显: tag.searchable !== false });
    redirect.set(tag.id, key);
  }

  const merged = new Map(); // 比对键 → 记录（ID 待分配）
  const variantsMerged = [];
  const crossCategory = [];
  let 名称被折过 = 0;
  for (const [key, group] of groups) {
    const first = group.源[0];
    // 规范写法就是比对键：小写 + 下划线。
    // 存进去的、显示的、输出的是同一个写法 —— 不折的话 "best quality" 这种会一直在库里，
    // 而要搜它就得先归一化，等于库里存了一份"非规范"的东西。
    名称被折过 += group.写法.filter((写) => 写 !== toKey(写)).length;
    const 规范写法 = joinValues([key, ...group.写法]);
    const record = {
      键: key,
      名称: 规范写法,
      中文名: joinValues(group.中文名),
      子分类: first.子分类,
      成人: group.源.some((row) => row.成人),
      回显: group.源.every((row) => row.回显),
      词频: Math.max(0, ...group.源.map((row) => {
        const meta = characterInfo[row.旧ID];
        return meta && Number.isFinite(meta.count) ? meta.count : 0;
      })),
      源IDs: group.源.map((row) => row.旧ID),
    };
    if (record.回显) delete record.回显;
    merged.set(key, record);

    if (group.写法.length > 1) {
      variantsMerged.push({ 键: key, 写法: record.名称, 中文名: record.中文名, 条数: group.写法.length });
      const classes = new Set(group.源.map((row) => row.子分类));
      if (classes.size > 1) crossCategory.push({ 键: key, 名称: record.名称, 分类: [...classes] });
    }
  }

  report.计数.记录 = merged.size;
  report.计数.名称被折成规范写法的 = 名称被折过;
  report.筛掉.折不出词 = dropped.length;
  report.筛掉.折不出词清单 = dropped.slice(0, 40);
  report.筛掉.折不出词的旧ID = dropped.map((row) => row.旧ID);
  report.合并.合并掉的条数 = sourceTags.length - dropped.length - merged.size;
  report.合并.变体名组数 = variantsMerged.length;
  report.合并样例 = variantsMerged.slice(0, 20);
  report.合并里跨分类的 = crossCategory;

  // ---------- ③ 分配 ID ----------
  const records = [];
  const byKey = new Map();
  const popularity = [];
  let id = 0;
  for (const [key, record] of merged) {
    id += 1;
    byKey.set(key, id);
    const row = { ID: id, 名称: record.名称, 中文名: record.中文名, 子分类: record.子分类 };
    if (record.成人) row.成人 = true;
    if (record.回显 === false) row.回显 = false;
    records.push(row);
    if (record.词频 > 0) popularity.push([id, record.词频]);
  }
  const newIdOfOld = new Map();
  for (const [oldId, key] of redirect) newIdOfOld.set(oldId, byKey.get(key) || null);

  // ---------- ⑤ 组：角色组 + 系列组 ----------
  // 两种组都建在角色那条记录自己身上：
  //   角色组  成员 = 这个角色的特征标签
  //   系列组  成员 = 这个系列里的角色
  const linkByCharacter = new Map();
  for (const link of links) linkByCharacter.set(link.identityTagId, link);

  // 哪些记录是角色：用来摘掉"角色组里嵌角色组"的成员边
  const characterRecordIds = new Set();
  for (const characterId of linkByCharacter.keys()) {
    const recordId = newIdOfOld.get(characterId);
    if (recordId) characterRecordIds.add(recordId);
  }

  let characterGroups = 0;
  let emptyCharacterGroups = 0;
  let memberEdges = 0;
  let memberMissing = 0;
  let nestedPruned = 0;
  let sameRecordTwice = 0;
  const characterIds = []; // 角色组的 ID，写进 角色.json
  const promisedGroups = new Set(); // 已经承诺"带成员"的记录，用来看会不会被覆盖

  for (const [characterId, link] of linkByCharacter) {
    const selfId = newIdOfOld.get(characterId);
    if (!selfId) continue; // 这个名字没进库（被回收或没这条记录）
    const record = records[selfId - 1];
    if (!record || record.ID !== selfId) continue;
    if (promisedGroups.has(selfId)) {
      // 两个不同的旧名字在"合"那一步落成了同一条记录（归一化后同键）。
      // 同一条记录只当一次组，成员并起来，不数两遍。
      sameRecordTwice += 1;
      continue;
    }
    const members = [];
    const seen = new Set();
    for (const oldMemberId of [...(link.generalTagIds || []), ...(link.specificTagIds || [])]) {
      const memberId = newIdOfOld.get(oldMemberId);
      if (!memberId) { memberMissing += 1; continue; }
      if (memberId === selfId || seen.has(memberId)) continue;
      if (characterRecordIds.has(memberId)) { nestedPruned += 1; continue; } // 组不许嵌组
      seen.add(memberId);
      members.push(memberId);
    }
    // 空组也得建：成员列表为空是合法的，"组 = tag + 成员 ID"里成员可以是空的。
    // 角色一个都不能丢 —— 它就是这一条记录，成员只是挂在它身上的东西。
    record.成员 = members;
    characterIds.push(selfId);
    characterGroups += 1;
    if (!members.length) emptyCharacterGroups += 1;
    memberEdges += members.length;
    promisedGroups.add(selfId);
  }

  let untouched = 0;   // 角色身上没有系列，或被回收了 —— 这些角色不会让任何系列组点到他

  const seriesMembers = new Map();
  for (const link of links) {
    const selfId = newIdOfOld.get(link.identityTagId);
    if (!selfId) { untouched += 1; continue; }
    if (!(link.seriesTagIds || []).length) { untouched += 1; continue; }
    for (const seriesId of link.seriesTagIds || []) {
      if (!seriesMembers.has(seriesId)) seriesMembers.set(seriesId, []);
      seriesMembers.get(seriesId).push(selfId);
    }
  }

  const groupRows = [];
  const seriesIds = [];
  const seriesConflicts = [];
  const emptySeries = [];
  let seriesMissing = 0;
  let seriesDropped = 0;
  let overwritten = 0; // 角色组的位置被系列组顶掉的条数
  for (const seriesId of [...seriesMembers.keys()].sort()) {
    const seriesKey = redirect.get(seriesId);
    if (!seriesKey) {
      // 系列自己的词被回收了（全是单字符或纯符号），那它没法当组名 —— 数出来报给开发者
      if (dropped.some((row) => row.旧ID === seriesId)) seriesDropped += 1;
      else seriesMissing += 1;
      continue;
    }
    const members = [];
    const seen = new Set();
    for (const memberId of seriesMembers.get(seriesId)) {
      if (!memberId || seen.has(memberId)) continue;
      seen.add(memberId);
      members.push(memberId);
    }
    if (!members.length) emptySeries.push(seriesId); // 空组也建，理由同角色组

    const existingId = byKey.get(seriesKey);
    if (existingId) {
      // 系列那条 tag 本来就存在：把成员挂到它自己身上，不再另起一条 —— 一处一份数据
      const record = records[existingId - 1];
      if (promisedGroups.has(existingId)) {
        // 同一条记录先当了角色组、又得当系列组：一条记录只有一串成员，后者盖前者。
        // 这种撞车要报出来，不许悄悄吞掉。
        overwritten += 1;
        seriesConflicts.push({ 记录: record.名称, ID: existingId, 角色组成员数: record.成员.length, 系列组成员数: members.length });
      }
      record.成员 = members;
      promisedGroups.add(existingId);
      seriesIds.push(existingId);
      continue;
    }
    id += 1;
    const source = merged.get(seriesKey);
    groupRows.push({
      ID: id,
      名称: source ? source.名称 : seriesKey,
      中文名: source && source.中文名 && toKey(source.中文名) !== seriesKey ? source.中文名 : '',
      成员: members,
    });
    promisedGroups.add(id);
    seriesIds.push(id);
  }

  // 组数按"最后真正带成员的记录"数，一条只算一次
  let groupTotal = 0;
  for (const recordId of promisedGroups) if (records[recordId - 1]) groupTotal += 1;

  report.计数.系列组 = seriesIds.length;
  report.计数.组 = groupTotal;
  report.计数.空成员的组 = emptySeries.length; // 角色组那边的空组数以「对账」为准（合并会改）
  report.计数.没挂上系列的角色 = untouched;
  report.计数.两个旧名字落成同一条记录的 = sameRecordTwice;
  report.计数.系列表 = seriesIds.length;
  report.计数.成员边 = memberEdges + seriesMembers.size;
  report.筛掉.成员找不到 = memberMissing;
  report.筛掉.组里嵌组的成员边 = nestedPruned;
  report.筛掉.系列找不到 = seriesMissing;
  report.筛掉.系列词被回收 = seriesDropped;
  report.角色组与系列组撞车 = seriesConflicts;

  // 计数器必须在两种组都建完之后落定
  const mainCounter = id;

  // ---------- ④ 位置：旧分类 → 页，旧子分类 → 类 ----------
  let positionId = 0;
  const classIdBySub = new Map();
  const pages = [];
  for (const category of sourceCategories) {
    positionId += 1;
    const page = {
      ID: positionId,
      页名: String(category.name || category.id || ''),
      配色: PALETTE[(positionId - 1) % PALETTE.length],
      类列表: [],
    };
    const subs = sourceSubs
      .filter((sub) => sub.categoryId === category.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    for (const sub of subs) {
      positionId += 1;
      page.类列表.push({
        ID: positionId,
        类名: String(sub.name || '默认'),
        配色: PALETTE[(positionId - 1) % PALETTE.length],
      });
      classIdBySub.set(sub.id, { pageId: page.ID, classId: positionId });
    }
    pages.push(page);
  }
  report.计数.页 = pages.length;
  report.计数.类 = classIdBySub.size;

  const cells = new Map();
  let homeless = 0;
  for (const record of records) {
    const place = classIdBySub.get(record.子分类);
    if (!place) { homeless += 1; continue; }
    const key = `分类.${place.pageId}.${place.classId}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(record.ID);
  }
  report.筛掉.没有落进任何类的 = homeless;

  // ---------- 落盘 ----------
  fs.mkdirSync(args.out, { recursive: true });

  writeJson(path.join(args.out, '主库.json'), {
    格式: 'tag-library/主库',
    版本: 1,
    计数器: mainCounter,
    记录列表: records.concat(groupRows),
  });
  writeJson(path.join(args.out, '自建库.json'), { 格式: 'tag-library/自建库', 版本: 1, 计数器: 0, 记录列表: [] });
  writeJson(path.join(args.out, '隐藏库.json'), { 格式: 'tag-library/隐藏库', 版本: 1, 记录列表: [] });
  writeJson(path.join(args.out, '修改库.json'), { 格式: 'tag-library/修改库', 版本: 1, 记录列表: [] });

  const positionShell = { 格式: 'tag-library/位置', 版本: 1, 计数器: positionId, 页列表: pages };
  writeJson(path.join(args.out, '分类字典.json'), positionShell);
  writeJson(path.join(args.out, '收藏字典.json'), { ...positionShell, 计数器: 0, 页列表: [] });
  for (const [key, members] of cells) writeJson(path.join(args.out, `${key}.json`), members);

  const adultIds = records.filter((row) => row.成人 === true).map((row) => row.ID);
  const seriesSet = new Set(seriesIds.map(String));
  // 同一条记录先当了角色组、又得当系列组时，它只算系列组（成员是后者盖上去的）
  const roleIds = characterIds.filter((id) => !seriesSet.has(String(id)));
  writeJson(path.join(args.out, '成人.json'), adultIds);
  writeJson(path.join(args.out, '角色.json'), roleIds);
  writeJson(path.join(args.out, '系列.json'), seriesIds);
  writeJson(path.join(args.out, '注释.json'), {});
  writeJson(path.join(args.out, '常用词.json'), buildCommonWords(popularity));

  // ---------- 对账：拿最后写下去的那份数据自己数一遍 ----------
  const written = records.concat(groupRows);
  const grouped = written.filter((row) => Array.isArray(row.成员));
  const asCharacter = grouped.filter((row) => !seriesSet.has(String(row.ID)));
  const asSeries = grouped.filter((row) => seriesSet.has(String(row.ID)));
  const emptyGroups = grouped.filter((row) => row.成员.length === 0);
  report.对账 = {
    主库条数: written.length,
    计数器: mainCounter,
    ID最大: Math.max(...written.map((row) => row.ID)),
    组: grouped.length,
    角色组: asCharacter.length,
    系列组: asSeries.length,
    空成员的组: emptyGroups.length,
    角色名被回收的: dropped.filter((row) => linkByCharacter.has(row.旧ID)).length,
    角色表对得上: roleIds.length === asCharacter.length,
    系列表对得上: seriesIds.length === asSeries.length,
    与过程计数一致: grouped.length === groupTotal && asSeries.length === seriesIds.length,
  };
  report.计数.角色组 = asCharacter.length;
  report.计数.角色表 = roleIds.length;
  if (!report.对账.与过程计数一致) {
    report.备注.push('过程计数与产物对不上 —— 以「对账」那一节为准');
  }
  report.备注.push('角色组比旧库的 34122 少的那几个，是纯符号角色名被「筛」那一步回收了，见对账里的「角色名被回收的」');

  report.计数.成人 = adultIds.length;
  report.计数.不参与检索 = records.filter((row) => row.回显 === false).length;
  report.计数.位置格 = cells.size;
  report.备注.push('自建库 / 隐藏库 / 修改库 / 收藏 全是空的：旧库没有这些数据');
  report.备注.push('注释表是空的：旧库的 note 字段只导入了空串');
  report.备注.push('两种组：角色组（成员 = 那个角色的特征标签）+ 系列组（成员 = 该系列的角色）');
  report.备注.push('角色组就在角色那条 tag 自己身上（ID 与名字都不动，只多了一串成员）；系列组同理');
  report.耗时ms = Date.now() - started;

  writeJson(path.join(args.out, '重构报告.json'), report);
  process.stdout.write(
    `重构完成：${report.计数.记录} 条记录（合并吃掉 ${report.合并.合并掉的条数} 条重复 / 回收 ${report.筛掉.折不出词} 条表情符号）`
    + ` · 组 ${report.计数.组} 个（角色组 ${report.计数.角色组} + 系列组 ${report.计数.系列组}）`
    + ` · 位置 ${report.计数.页} 页 ${report.计数.类} 类 · 用时 ${report.耗时ms}ms\n`,
  );
}

/**
 * 常用词表：按"出图次数"排一批最常见的词，做成常量数据。
 * 它只影响"同一档内谁排前面"，不承担正确性。
 */
function buildCommonWords(popularity) {
  return popularity
    .slice()
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 2000)
    .map(([recordId]) => recordId);
}

main();
