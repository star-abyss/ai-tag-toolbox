'use strict';
/*
 * 标签模块的测试 —— 用重构出来的真数据走一遍每个对外动作。
 *
 * 用法：node test/run.js [--data <数据目录>]
 * 它只读真数据，写操作全部落在一个临时副本上，跑完就删。
 *
 * 这里还守两条六边形的规矩：
 *   ① 出口不许漏内部件（面子上没有 store / library / search 这些口子）
 *   ② 同一个核心换一个适配器照跑（文件 → 内存）
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createTagModule, KEYS } = require('../index.js');
const { createFilePort } = require('../adapter-file.js');
const { createMemoryPort } = require('../adapter-memory.js');
const { toKey, keySegments } = require('../normalize.js');

const DATA = process.argv.includes('--data')
  ? process.argv[process.argv.indexOf('--data') + 1]
  : path.join(__dirname, '..', 'data');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  const started = Date.now();
  try {
    fn();
    passed += 1;
    process.stdout.write(`  ✓ ${name}  (${Date.now() - started}ms)\n`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    process.stdout.write(`  ✗ ${name}  → ${error && error.message}\n`);
  }
}

/** 把真数据抄一份到临时目录（含子目录），写操作都在副本上做。 */
function copyData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagmod-'));
  fs.cpSync(DATA, dir, { recursive: true });
  return dir;
}

const dir = copyData();
const port = createFilePort({ root: dir });          // 正规写法：装配层递端口
const tags = createTagModule({ port });

// ---- 测试里用的小包装：让每个动作失败时报得出是哪一条 ----
let where = '';
const 查 = (串) => { const r = tags.run('query', { 串 }); assert.ok(r.ok, `${where} 查库失败：${r.reason}`); return r.data; };
// 候选里现在混着"记录"与"类"（决定 121）：这一组用例问的是记录那条路
const 候选 = (串) => 查(串).候选.filter((c) => c.类型 !== '类');
/** 只要记录候选：截断发生在服务器那 30 条上，所以先截再滤。 */
const 候选记录 = (串, 上限) => tags.run('query', { 串, 上限 })
  .data.候选.slice(0, 上限 || 30).filter((c) => c.类型 !== '类');
const 认 = (词) => tags.recognize(词);
const 取 = (id) => { const r = tags.run('record.get', { 标识: id }); return r.ok ? r.data : null; };
const 找 = (串, 名字) => 候选(串).find((row) => String(row.记录.名称).split(',')[0] === 名字);
const 组 = () => { const r = tags.run('record.groups'); assert.ok(r.ok, r.reason); return r.data; };
const 隐 = () => { const r = tags.run('hidden.list'); assert.ok(r.ok, r.reason); return r.data; };
const 改过 = () => { const r = tags.run('modified.list'); assert.ok(r.ok, r.reason); return r.data; };
const 位 = (根) => ({
  list: () => { const r = tags.run('position.list', { 位置: 根 }); assert.ok(r.ok, r.reason); return r.data; },
});

process.stdout.write('标签模块测试\n');
process.stdout.write(`数据目录：${DATA}\n\n`);

// ---------------- 六边形：出口与端口 ----------------
process.stdout.write('六边形\n');
test('库里存的名称都是规范写法（小写 + 下划线），没有漏折的', () => {
  // 全库扫一遍：用端口读，不走出口（出口不给"整库倒出来"这种口子）
  const shell = port.read(KEYS.主库).value;
  let 不合规 = 0;
  const 样本 = [];
  for (const 记 of shell.记录列表) {
    const 首 = String(记.名称).split(',')[0];
    if (首 !== toKey(首)) { 不合规 += 1; if (样本.length < 5) 样本.push(JSON.stringify(记.名称)); }
  }
  assert.strictEqual(不合规, 0, `有 ${不合规} 条名称不是规范写法：${样本.join(' ')}`);
  // 抽查：原来带空格的写法，现在应该带下划线，而且搜得到
  assert.ok(候选('best_quality').some((row) => String(row.记录.名称).split(',')[0] === 'best_quality'), 'best_quality 搜不到');
});
test('改页名 / 改类名：ID 不动，改的是字典里那一条', () => {
  const root = tags.positions('收藏');
  const 页 = root.createPage({ 页名: '壳' });
  assert.ok(页 && 页.ID, '建页失败');
  const 类 = root.createClass(页.ID, { 类名: '壳类' });
  assert.ok(类 && 类.ID, '建类失败');
  const 改页 = root.update(页.ID, { 页名: '改过的页' });
  assert.ok(改页 && 改页.页名 === '改过的页', `改页返回不对：${JSON.stringify(改页)}`);
  assert.strictEqual(改页.ID, 页.ID, 'ID 不该变');
  const 改类 = root.update(类.ID, { 类名: '改过的类', 配色: { background: '#111111', foreground: '#ffffff' } });
  assert.ok(改类 && 改类.类名 === '改过的类', `改类返回不对：${JSON.stringify(改类)}`);
  assert.strictEqual(改类.配色.background, '#111111');
  // 改完还能用（键名没动）
  assert.deepStrictEqual(root.attach(页.ID, 类.ID, 9539), ['9539'], '改名之后位置不能坏');
  root.remove(页.ID); // 收拾干净：别让这个类留到后面的用例里去
});
test('出口不漏内部件：没有 store / library / search / core 这些口子', () => {
  for (const leaked of ['store', 'library', 'search', 'core', 'port', 'positions内部']) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(tags, leaked), false, `出口漏了 ${leaked}`);
  }
  assert.ok(Object.isFrozen(tags), '出口应当冻住，免得被人往上挂东西');
});
test('递出来的是副本：界面改了它，库里的那份一个字都不动', () => {
  const a = tags.run('record.get', { 标识: 1 }).data;
  const 原名 = a.名称;
  const 原中文名 = a.中文名;
  a.中文名 = '【界面偷偷改的】';
  const b = tags.run('record.get', { 标识: 1 }).data;
  assert.strictEqual(b.中文名, 原中文名, '库里那份被改到了');
  assert.notStrictEqual(a, b, '两次取到的是同一个对象');
  // 查库返回的记录同样是副本
  const 一条候选 = tags.query('cg').候选.find((row) => String(row.记录.ID) === '1').记录;
  一条候选.名称 = '被改了';
  assert.strictEqual(tags.run('record.get', { 标识: 1 }).data.名称, 原名, '查库返回的记录是活对象');
  // 组的成员数组也是副本
  const 一个组 = 组().find((row) => row.成员.length > 0);
  const 成员数 = 一个组.成员.length;
  一个组.成员.push('999999');
  assert.strictEqual(取(一个组.ID).成员.length, 成员数, '成员数组被改到了');
});
test('改动真的落盘了：不信内存，直接读分片文件', () => {
  const 片路径 = (id) => path.join(dir, '记录', '主库', String(Math.floor(Number(id) / 1000)).padStart(3, '0') + '.jsonl');
  const 读片 = (id) => {
    const p = 片路径(id);
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  const 原样 = 取(9539);
  try {
    // 改一条 → 盘上那一片要有新值
    tags.run('record.edit', { 标识: 9539, 名称: 'hatsune_miku', 中文名: '落盘验证' });
    assert.strictEqual(读片(9539).find((r) => String(r.ID) === '9539').中文名, '落盘验证', '改了但没落盘');
    // 隐藏 → 那一片要少一条，别的片不受影响
    const 别的片条数 = 读片(1).length;
    tags.run('hidden.hide', { 标识: 9539 });
    assert.ok(!读片(9539).some((r) => String(r.ID) === '9539'), '隐藏了但主库里还在');
    assert.strictEqual(读片(1).length, 别的片条数, '隐藏一条却动了别的片');
    // 恢复 → 要回来，而且别的记录一条不丢
    tags.run('hidden.unhide', { 标识: 9539 });
    assert.ok(读片(9539).some((r) => String(r.ID) === '9539'), '恢复了但主库里没有');
    let 总条数 = 0;
    for (const f of fs.readdirSync(path.join(dir, '记录', '主库'))) {
      if (f.endsWith('.jsonl')) 总条数 += fs.readFileSync(path.join(dir, '记录', '主库', f), 'utf8').split('\n').filter(Boolean).length;
    }
    assert.strictEqual(总条数, 52240, `隐藏再恢复之后主库条数不对：${总条数}`);
  } finally {
    // 收拾干净：后面的用例还要用这条记录
    tags.run('record.edit', { 标识: 9539, 名称: 原样.名称, 中文名: 原样.中文名, 成员: 原样.成员 });
    tags.run('modified.restore', { 标识: 9539 });
  }
});
test('一片读不懂：能读的照读、查询照常，但那个库拒绝写', () => {
  const 临时 = fs.mkdtempSync(path.join(os.tmpdir(), 'tagmod-bad-'));
  fs.cpSync(DATA, 临时, { recursive: true });
  try {
    fs.writeFileSync(path.join(临时, '记录', '主库', '009.jsonl'), '{这不是 JSON', 'utf8');
    const 坏tags = createTagModule({ port: createFilePort({ root: 临时 }) });
    // 能读的照读（坏的那片读不出来，所以总数少一些）
    const 查 = 坏tags.run('query', { 串: 'miku' });
    assert.ok(查.ok && 查.data.合计 > 0, '一片坏了就整库查不到，太脆');
    // 但写要挡住 —— 写下去会把读不出来的那片盖掉
    const 写 = 坏tags.run('record.edit', { 标识: 9539, 名称: 'hatsune_miku' });
    assert.strictEqual(写.ok, false, '读不懂的库不该允许写');
  } finally {
    fs.rmSync(临时, { recursive: true, force: true });
  }
});
test('一套动作表：界面和功能都从它进', () => {
  assert.ok(Array.isArray(tags.actions) && tags.actions.length > 0);
  const 清单 = tags.describe();
  assert.strictEqual(清单.length, tags.actions.length);
  for (const row of 清单) {
    assert.ok(row.动作 && row.摘要 && Array.isArray(row.参数), `动作 ${row.动作} 的说明不全`);
  }
  const 不存在 = tags.run('没有这个动作');
  assert.strictEqual(不存在.ok, false);
  assert.ok(不存在.reason.includes('没有这个动作'), `理由不对：${不存在.reason}`);
});
test('两种查询都在动作表里，而且是【两种】不是两种说法', () => {
  const names = tags.actions;
  assert.ok(names.includes('query'), '缺 query');
  assert.ok(names.includes('recognize'), '缺 recognize');
  // 查库的入口只有 query 一个，不许有别名
  const 查库动作 = names.filter((name) => name === 'query' || name === 'search' || name === 'suggest');
  assert.deepStrictEqual(查库动作, ['query']);
  const 认词动作 = names.filter((name) => name.startsWith('recognize'));
  assert.deepStrictEqual(认词动作, ['recognize']);
});
test('每个动作都收 {ok, data|reason}，不抛错', () => {
  for (const name of tags.actions) {
    const result = tags.run(name, {});
    assert.ok(result && typeof result === 'object', `${name} 没返回对象`);
    assert.strictEqual(typeof result.ok, 'boolean', `${name} 的 ok 不是布尔`);
    if (!result.ok) assert.ok(typeof result.reason === 'string' && result.reason, `${name} 失败却没给理由`);
  }
});
test('失败信封有两个字段：reason 是原文，code 是码；码都在 ERR 里', () => {
  const 全部码 = Object.values(tags.ERR).filter((x) => typeof x === 'string');
  const 拿失败 = (动作, 参数) => {
    const r = tags.run(动作, 参数);
    assert.strictEqual(r.ok, false, `${动作} 本该失败`);
    assert.ok(全部码.includes(r.code), `${动作} 的码不在 ERR 里：${r.code}`);
    return r;
  };
  拿失败('record.get', { 标识: '不存在' });
  拿失败('record.delete', { 标识: 9539 });
  拿失败('hidden.unhide', { 标识: 9539 });
  拿失败('modified.restore', { 标识: 9539 });
  拿失败('position.createPage', { 位置: '分类', 页名: '' });
  拿失败('position.update', { 位置: '分类', 标识: '没这页', 页名: 'x' });
  拿失败('position.reorder', { 位置: '分类', 页: '没这页', 类: '没这类', 标识列表: ['1'] });
  // 拿掉一个不存在的东西算成功（与"删一个不存在的条目"同一条规矩），不是失败
  const 空拿 = tags.run('position.detach', { 位置: '分类', 页: '没这页', 类: '没这类', 成员: '1' });
  assert.strictEqual(空拿.ok, true, `拿掉不存在的东西该算成功：${空拿.reason}`);
  assert.deepStrictEqual(空拿.data, [], `空拿该给空表：${JSON.stringify(空拿.data)}`);
  // 动作名不对、动作自己抛错：门面自己产的码
  assert.strictEqual(tags.run('没有这个动作').code, tags.ERR.NO_SUCH_ACTION);
  assert.strictEqual(tags.run('position.list', { 位置: '没有这个位置' }).code, tags.ERR.BAD_POSITION_ROOT);
});test('码表与理由一一对得上：表里的理由都得是真理由，同一个码不许配两句', () => {
  const 表 = tags.ERR.理由;
  const 码集 = new Set(Object.values(tags.ERR).filter((x) => typeof x === 'string'));
  const 见过的码 = new Map();
  for (const [话, 码] of Object.entries(表)) {
    assert.ok(话 && typeof 话 === 'string', '理由表里有一句空的');
    assert.ok(码集.has(码), `理由「${话}」配的码不在 ERR 里：${码}`);
    assert.ok(!见过的码.has(码), `码 ${码} 同时配了「${见过的码.get(码)}」与「${话}」`);
    见过的码.set(码, 话);
    assert.strictEqual(tags.ERR.取码(话), 码, `取码认不出「${话}」`);
  }
  // 表外的理由落回 ACTION_FAILED，不许抛
  assert.strictEqual(tags.ERR.取码('磁盘满'), tags.ERR.ACTION_FAILED);
  assert.strictEqual(tags.ERR.取码(undefined), tags.ERR.ACTION_FAILED);
});
test('端口不合格就挡在门口，不放进来', () => {
  assert.throws(() => createTagModule({ port: {} }), /端口不合格/);
  assert.throws(() => createTagModule({ port: { read: () => ({}) } }), /端口不合格/);
  assert.throws(() => createTagModule({}), /递端口|给位置/);
});
test('装配参数只有一个名字：data 就是 data，没有别名', () => {
  assert.throws(() => createTagModule({ root: DATA }), /递端口|给位置/, 'root 不该被当成位置');
  assert.throws(() => createTagModule({ data: '' }), /递端口|给位置/, '空位置要挡在门口');
  assert.ok(createTagModule({ data: DATA }).actions.length > 0, 'data 这条路要通');
});
test('换适配器：同一个核心，换成内存端口照跑', () => {
  const memory = createMemoryPort({
    [KEYS.主库]: {
      格式: 'tag-library/主库', 版本: 1, 计数器: 2,
      记录列表: [
        { ID: 1, 名称: 'hatsune_miku,hatsune miku,hm', 中文名: '初音未来,初音' },
        { ID: 2, 名称: 'vocaloid', 中文名: '', 成员: [1] },
      ],
    },
    [KEYS.自建库]: { 格式: 'tag-library/自建库', 版本: 1, 计数器: 0, 记录列表: [] },
    [KEYS.隐藏库]: { 格式: 'tag-library/隐藏库', 版本: 1, 记录列表: [] },
    [KEYS.修改库]: { 格式: 'tag-library/修改库', 版本: 1, 记录列表: [] },
    [KEYS.成人]: [], [KEYS.角色]: [2], [KEYS.注释]: {}, [KEYS.常用词]: [],
    [KEYS.分类字典]: { 格式: 'tag-library/位置', 版本: 1, 计数器: 0, 页列表: [] },
  });
  const mini = createTagModule({ port: memory });
  assert.strictEqual(mini.recognize('hatsune_miku'), '初音未来');
  assert.strictEqual(mini.recognize('hm'), '初音未来', '别名没认出来');
  assert.strictEqual(mini.query('miku').候选[0].记录.ID, 1);
  const 新 = mini.run('record.create', { 名称: 'memory_only', 中文名: '只在内存里的' });
  assert.ok(新.ok, 新.reason);
  assert.strictEqual(mini.recognize('memory_only'), '只在内存里的');
});
test('改中文名后保留英文别名', () => {
  const memory = createMemoryPort({
    [KEYS.主库]: { 格式: 'tag-library/主库', 版本: 1, 计数器: 1, 记录列表: [{ ID: 1, 名称: 'fixture_name,fixture alias', 中文名: '样例名,旧译' }] },
    [KEYS.自建库]: { 格式: 'tag-library/自建库', 版本: 1, 计数器: 0, 记录列表: [] },
  });
  const mini = createTagModule({ port: memory });
  const original = mini.run('record.get', { 标识: 1 }).data;
  const result = mini.run('record.edit', { 标识: 1, 名称: original.名称, 中文名: '新译,旧译' });
  assert.ok(result.ok, result.reason);
  assert.strictEqual(mini.run('record.get', { 标识: 1 }).data.名称, 'fixture_name,fixture_alias');
  assert.strictEqual(mini.recognize('fixture alias'), '新译');
  assert.strictEqual(mini.query('fixture alias').候选[0].记录.ID, 1);
});
test('三态读：塞一个读不懂的值进去，那一格被冻结、写被拒', () => {
  const memory = createMemoryPort({
    [KEYS.主库]: '这不是 JSON',
    [KEYS.自建库]: { 格式: 'tag-library/自建库', 版本: 1, 计数器: 0, 记录列表: [] },
  });
  const mini = createTagModule({ port: memory });
  // 读不懂 → 当成"没有"给出去，但那一格的写已经被冻住
  const 写 = memory.set(KEYS.主库, { 记录列表: [] });
  assert.strictEqual(写.ok, false, '读不懂的格居然让写了');
  assert.strictEqual(写.reason, '读不懂');
  assert.strictEqual(mini.run('status').data.坏的键.length, 1, '体检没看出坏键');
});

// ---------------- 归一化 ----------------
process.stdout.write('\n归一化\n');
test('大小写与空白折成小写加下划线', () => {
  assert.strictEqual(toKey('Hatsune Miku'), 'hatsune_miku');
  assert.strictEqual(toKey('bad feet'), 'bad_feet');
});
test('符号是词的一部分，不许折掉（否则 blood+ 与 blood 会撞）', () => {
  assert.strictEqual(toKey('blood+'), 'blood+');
  assert.strictEqual(toKey('#compass'), '#compass');
  assert.notStrictEqual(toKey('blood+'), toKey('blood'));
  assert.notStrictEqual(toKey(':3'), toKey('<3'));
  assert.strictEqual(toKey(':3'), ':3');
  assert.strictEqual(toKey('<3'), '<3');
});
test('限定词括号保留', () => {
  assert.strictEqual(toKey('ayla (pgr)'), 'ayla_(pgr)');
  assert.strictEqual(toKey('hatsune_miku_(vocaloid)'), 'hatsune_miku_(vocaloid)');
});
test('标点构成的 tag 仍保留为独立比对键', () => {
  assert.strictEqual(toKey('>_<'), '>_<');
  assert.strictEqual(toKey(';)'), ';)');
});
test('切词：按 _ 切开，给检索做切词匹配（搜 miku 能出 hatsune_miku）', () => {
  assert.deepStrictEqual(keySegments('hatsune_miku'), ['hatsune', 'miku']);
  assert.deepStrictEqual(keySegments('miku'), ['miku']);
  assert.deepStrictEqual(keySegments('ayla_(pgr)'), ['ayla', '(pgr)']);
});

// ---------------- 检索：查库 ----------------
process.stdout.write('\n查库\n');
test('搜作品出两种候选：那条 tag 与那个类，并列在同一个数组里（决定 121）', () => {
  const r = tags.run('query', { 串: 'touhou' });
  assert.ok(r.ok, r.reason);
  const 记录候选 = r.data.候选.filter((c) => c.类型 === '记录');
  const 类候选 = r.data.候选.filter((c) => c.类型 === '类');
  assert.ok(记录候选.some((c) => String(c.记录.名称).split(',')[0] === 'touhou'), '没有 touhou 那条 tag');
  const 类 = 类候选.find((c) => c.类.类名 === 'touhou');
  assert.ok(类, `没有「touhou」这个类。类候选：${类候选.slice(0, 5).map((c) => c.类.类名).join(' | ')}`);
  assert.strictEqual(类.类.页名, '角色组', `touhou 类挂错了页：${类.类.页名}`);
  assert.strictEqual(类.档, 1, `全等的类应当第 1 档，实际 ${类.档}`);
  // 点开那个类 = 它的成员角色
  const 成员 = tags.positions('分类').members(类.类.页ID, 类.类.ID);
  assert.ok(成员.length > 50, `类里的成员太少：${成员.length}`);
});
test('查 miku：切词命中的 hatsune_miku 必须在前 30 条里', () => {
  where = '查 miku';
  const rows = 候选('miku');
  assert.ok(rows.length > 0, '查不到东西');
  assert.ok(rows.length <= 30, '超过 30 条了');
  const hit = rows.find((row) => String(row.记录.名称).split(',')[0] === 'hatsune_miku');
  assert.ok(hit, `hatsune_miku 没被搜到。前 5 条：${rows.slice(0, 5).map((r) => r.记录.名称).join(' | ')}`);
  // miku 是 hatsune_miku 的**最后一个词** → 第 3 档（词尾），且必须挤进前 30
  assert.strictEqual(hit.档, 3, `hatsune_miku 应当落在第 3 档（切词命中，贴在词尾），实际第 ${hit.档} 档`);
  assert.ok(rows.indexOf(hit) < 10, `hatsune_miku 应当排在前 10，实际第 ${rows.indexOf(hit) + 1} 位`);
});
test('切词命中按位置分档：词首　>　词尾 / 夹中间', () => {
  // miku_ 开头 → 第 2 档
  const 词首 = 候选('miku').find((row) => String(row.记录.名称).startsWith('miku_'));
  assert.ok(词首, '没有以 miku_ 开头的');
  assert.strictEqual(词首.档, 2, `词首那一段应当第 2 档，实际 ${词首.档}`);
  // _miku 结尾 → 第 3 档
  const 词尾 = 候选('miku').find((row) => String(row.记录.名称).endsWith('_miku'));
  assert.ok(词尾, '没有以 _miku 结尾的');
  assert.strictEqual(词尾.档, 3, `词尾那一段应当第 3 档，实际 ${词尾.档}`);
  // 夹在中间 → 也第 3 档（真数据里找一条 my_cat_ears 那种）
  const 夹中 = 候选记录('cat', 400)
    .find((row) => /_cat_/.test(String(row.记录.名称).split(',')[0]));
  assert.ok(夹中, '没有夹在中间的');
  assert.strictEqual(夹中.档, 3, `夹在中间那一段应当第 3 档，实际 ${夹中.档}`);
  // 词首那档必须排在最前
  assert.strictEqual(候选('miku')[0].档, 2, '第一条该是词首命中');
});
test('同档内常用词优先于长度：hatsune_miku 是常用词表第 0 名，不能被短名字挤走', () => {
  const rows = 候选('miku');
  const 初音 = rows.find((row) => String(row.记录.名称).split(',')[0] === 'hatsune_miku');
  assert.ok(初音, 'hatsune_miku 没进前 30');
  // 同档（第 3 档）里比它靠前的，只能是常用词名次更高的
  const 前 = rows.slice(0, rows.indexOf(初音)).filter((row) => row.档 === 3);
  assert.strictEqual(前.length, 0, `第 3 档里不该有排在 hatsune_miku 前面的，实际有 ${前.length} 条`);
});
test('全等 > 切词 > 连写 > 兜底：四类的先后固定', () => {
  // 全等（第 1 档）：cat 那条自己
  const 全等 = 候选记录('cat', 400)[0];
  assert.strictEqual(全等.档, 1, `第一条该是全等，实际第 ${全等.档} 档`);
  assert.strictEqual(String(全等.记录.名称).split(',')[0], 'cat');
  // 连写（第 4 档）：hatsunemiku → hatsune_miku
  const 连写 = tags.run('query', { 串: 'hatsunemiku' }).data.候选[0];
  assert.strictEqual(连写.档, 4, `连写相等应当第 4 档，实际第 ${连写.档} 档`);
  assert.strictEqual(String(连写.记录.名称).split(',')[0], 'hatsune_miku');
});
test('切词命中排在兜底之前（前缀与"陷在词里"都算兜底）', () => {
  const rows = 候选记录('cat', 400);
  const 切词 = rows.find((row) => String(row.记录.名称).split(',')[0] === 'cat_ears');
  assert.ok(切词, 'cat_ears 没搜到');
  assert.strictEqual(切词.档, 2, `cat_ears 是切词命中，应当第 2 档，实际第 ${切词.档} 档`);
  // 兜底档（catapult / bobcat 那些）只要出现，就必须排在全部切词命中之后
  const 兜底 = rows.filter((row) => row.档 === 5);
  if (兜底.length) {
    const 最后一个切词 = rows.map((row) => row.档).lastIndexOf(2);
    const 第一个兜底 = rows.findIndex((row) => row.档 === 5);
    assert.ok(第一个兜底 > 最后一个切词, '兜底档排到切词命中前面了');
  }
  // catapult 是"前缀但词尾陷在词里" → 兜底档；它可能挤不进前 400，不强制它在
  const 陷里 = rows.find((row) => String(row.记录.名称).split(',')[0] === 'catapult');
  if (陷里) assert.strictEqual(陷里.档, 5, `catapult 应当落兜底档，实际第 ${陷里.档} 档`);
});
test('只有 5 档：1全等 2贴词边 3夹中间 4连写 5兜底', () => {
  for (const row of 候选('miku')) {
    assert.ok(row.档 >= 1 && row.档 <= 5, `档位超出 1–5：第 ${row.档} 档（${row.记录.名称}）`);
    const 名称 = String(row.记录.名称).split(',')[0];
    assert.ok(名称.split('_').includes('miku') || keySegments(String(row.记录.中文名)).includes('miku'),
      `这条不是整段命中：${row.记录.名称}`);
  }
  // 兜底档只能在前面几档凑不够 30 条时才出现
  // （截断发生在服务器那 30 条上：这里放开到 60 条看档位，记录那一侧够 30 条就不该有兜底）
  const 挤满 = 候选记录('miku', 60);
  assert.ok(挤满.length >= 30, `miku 的记录候选只有 ${挤满.length} 条`);
  assert.strictEqual(挤满.filter((row) => row.档 <= 3).length >= 30, true,
    `miku 有条数够，前 30 条里不该出现兜底档：${挤满.map((r) => r.档).join(',')}`);
});
test('符号 tag 与相似符号不折叠成同一个键', () => {
  // 符号键由独立的内存词条覆盖，磁盘数据不能恢复已被归一化抹掉的原始写法。
  const memory = createMemoryPort({
    [KEYS.主库]: { 格式: 'tag-library/主库', 版本: 1, 计数器: 2, 记录列表: [
      { ID: 1, 名称: ':3', 中文名: '嘟嘴' },
      { ID: 2, 名称: '<3', 中文名: '心' },
    ] },
    [KEYS.自建库]: { 格式: 'tag-library/自建库', 版本: 1, 计数器: 0, 记录列表: [] },
  });
  const mini = createTagModule({ port: memory });
  assert.strictEqual(mini.run('query', { 串: ':3' }).data.候选[0].记录.ID, 1);
  assert.strictEqual(mini.run('query', { 串: '<3' }).data.候选[0].记录.ID, 2);
  assert.strictEqual(mini.recognize(':3'), '嘟嘴');
  assert.strictEqual(mini.recognize('<3'), '心');
  assert.ok(tags.run('query', { 串: 'blood+' }).data.合计 > 0, 'blood+ 被误挡了');
  assert.strictEqual(tags.run('query', { 串: '>_<' }).ok, true, '>_< 不该抛错');
});
test('查带空格的写法：归一化后与带下划线的是同一条', () => {
  assert.strictEqual(候选('Hatsune Miku')[0].记录.名称, 候选('hatsune_miku')[0].记录.名称);
});
test('查中文：中文名首值优先', () => {
  const rows = 候选('初音');
  assert.ok(rows.length > 0, '查不到');
  const first = rows[0];
  assert.ok(String(first.记录.中文名).includes('初音'), `第一条不是中文名命中的：${JSON.stringify(first.记录)}`);
});
test('精确命中次级中文写法时标为其他检索写法并提供原命中词', () => {
  const row = 候选('black_earrings').find((item) => item.记录.ID === 1551);
  assert.ok(row, '黑色耳环检索应保留相关候选');
  assert.strictEqual(row.命中, '中文名', '保留既有 UI 字段');
  assert.strictEqual(row.命中类型, '其他检索写法');
  assert.strictEqual(row.命中词, 'black_earrings');
});
test('空查询给零结果，不倒 30 条出来', () => {
  assert.strictEqual(候选('   ').length, 0);
});
test('最多 30 条，多的用"还有更多"表示', () => {
  const result = 查('a');
  assert.ok(result.候选.length <= 30);
  if (result.合计 > 30) assert.strictEqual(result.还有更多, true);
});
test('返回的是记录本身，不是 ID', () => {
  const first = 候选('hatsune_miku')[0];
  assert.ok(first.记录.名称, '返回里没有记录');
  assert.ok(first.记录.ID !== undefined, '记录里应当有 ID');
});

// ---------------- 检索：认词 ----------------
process.stdout.write('\n认词\n');
test('一批词一次问完，顺序一一对应', () => {
  const result = 认(['hatsune_miku', 'hakurei_reimu', 'zzz_这个词不存在_zzz']);
  assert.strictEqual(result.length, 3);
  assert.strictEqual(result[0], '初音未来');
  assert.strictEqual(result[1], '博丽灵梦');
  assert.strictEqual(result[2], null);
});
test('一个字都不许崩：给垃圾也不抛错', () => {
  for (const word of [null, undefined, 123, {}, [], '', '   ', '>_<', '\u0000', 'a'.repeat(5000)]) {
    const value = 认(word);
    const 合格 = value === null || (typeof value === 'string' && value.length > 0);
    assert.ok(合格, `输入 ${JSON.stringify(word)} 返回了 ${JSON.stringify(value)}`);
  }
  const 走动作 = tags.run('recognize', { 词: null });
  assert.ok(走动作.ok, '走动作表也应该不崩');
  assert.strictEqual(走动作.data, null, '垃圾输入不该认出一个词来');
});
test('查不到就是 null，不是异常', () => {
  assert.strictEqual(认('绝对不存在的词_abcdefg'), null);
});

// ---------------- 取 ----------------
process.stdout.write('\n取一条\n');
test('取一条给整条记录', () => {
  const record = 取(1);
  assert.ok(record, '取不到 ID=1');
  assert.strictEqual(record.ID, 1);
  assert.ok(record.名称);
});
test('取不到就报"记录不存在"，不抛错', () => {
  assert.strictEqual(取(99999999), null);
  assert.strictEqual(取('不存在'), null);
  assert.strictEqual(tags.run('record.get', { 标识: 99999999 }).reason, '记录不存在');
});
test('一次取多条：取不到的跳过', () => {
  const result = tags.run('record.batch', { 标识列表: [1, 2, 99999999] });
  assert.ok(result.ok);
  assert.strictEqual(result.data.length, 2);
});

// ---------------- 位置 ----------------
process.stdout.write('\n位置\n');
test('分类有 27 页 4250 类（重构产物 + 角色与作品那一批）', () => {
  const 页列表 = 位('分类').list();
  assert.strictEqual(页列表.length, 27);
  // 页「角色组」底下 4050 个（4049 个作品类 + 未分类），其余 26 页共 200 个
  const 角色页 = 页列表.find((p) => p.页名 === '角色组');
  assert.ok(角色页, '页「角色组」不见了');
  assert.strictEqual(角色页.类列表.length, 4050, `页「角色组」类数不对：${角色页.类列表.length}`);
  assert.strictEqual(页列表.reduce((n, page) => n + page.类列表.length, 0), 4250);
});
test('类里有成员，成员是 ID', () => {
  const 收藏 = tags.positions('收藏');
  let found = null;
  for (const page of 位('分类').list()) {
    for (const row of page.类列表) {
      const members = tags.positions('分类').members(page.ID, row.ID);
      if (members && members.length) { found = { page, row, members }; break; }
    }
    if (found) break;
  }
  assert.ok(found, '所有类都是空的？');
  assert.ok(取(found.members[0]), '成员 ID 在库里取不到记录');
});
test('挂上 / 卸下 / 查它在哪', () => {
  const root = tags.positions('收藏');
  const made = root.createPage({ 页名: '测试页' });
  assert.ok(made && made.ID, '建页失败');
  const cls = root.createClass(made.ID, { 类名: '测试类' });
  assert.ok(cls && cls.ID, '建类失败');
  assert.deepStrictEqual(root.members(made.ID, cls.ID), []);
  assert.deepStrictEqual(root.attach(made.ID, cls.ID, 1), ['1'], '挂上失败');
  assert.deepStrictEqual(root.attach(made.ID, cls.ID, 'u1'), ['1', 'u1'], '挂上失败');
  assert.deepStrictEqual(root.members(made.ID, cls.ID), ['1', 'u1']);
  const places = root.whereIs(1);
  assert.strictEqual(places.length, 1);
  assert.strictEqual(places[0].页名, '测试页');
  assert.deepStrictEqual(root.detach(made.ID, cls.ID, 1), ['u1'], '卸下失败');
  assert.deepStrictEqual(root.members(made.ID, cls.ID), ['u1']);
});
test('删页带走它底下的类（类格也删干净）', () => {
  const root = tags.positions('收藏');
  const made = root.createPage({ 页名: '待删页' });
  const cls = root.createClass(made.ID, { 类名: '待删类' });
  const removed = root.remove(made.ID);
  assert.ok(removed && removed.removed === '页', `删页失败：${JSON.stringify(removed)}`);
  assert.strictEqual(removed.带走类, 1);
  const 页列表 = root.list();
  assert.ok(!页列表.some((page) => page.ID === made.ID), '页还在');
  assert.ok(!页列表.some((page) => page.类列表.some((row) => row.ID === cls.ID)), '类还在');
});
test('页名可以重名：标识是 ID', () => {
  const root = tags.positions('收藏');
  const a = root.createPage({ 页名: '同名页' });
  const b = root.createPage({ 页名: '同名页' });
  assert.ok(a && b);
  assert.notStrictEqual(a.ID, b.ID);
});

// ---------------- 新建 / 改 / 删 ----------------
process.stdout.write('\n新建 · 改 · 删\n');
test('新建进自建库，ID 带 u 前缀且自增', () => {
  const first = tags.run('record.create', { 名称: 'my_oc', 中文名: '我的原创角色' });
  assert.ok(first.ok, first.reason);
  assert.strictEqual(first.data.ID, 'u1');
  const second = tags.run('record.create', { 名称: 'another_oc' });
  assert.ok(second.ok);
  assert.strictEqual(second.data.ID, 'u2');
  assert.strictEqual(取('u1').中文名, '我的原创角色');
});
test('自建的记录马上能搜到（索引跟着作废）', () => {
  const rows = 候选('my_oc');
  assert.ok(rows.length > 0, '新建的记录搜不到');
  assert.strictEqual(rows[0].记录.ID, 'u1');
});
test('自建的记录能认词', () => {
  assert.strictEqual(认('my_oc'), '我的原创角色');
});
test('改一条：直接改库，第一次改之前把原文抄进修改库', () => {
  const before = 取(1);
  const result = tags.run('record.edit', { 标识: 1, 名称: before.名称, 中文名: '改过的中文名' });
  assert.ok(result.ok, result.reason);
  assert.strictEqual(取(1).中文名, '改过的中文名');
  assert.strictEqual(tags.run('modified.list').data.length, 1, '修改库里没有原文');
  assert.strictEqual(改过()[0].中文名, before.中文名, '修改库存的不是改之前那份');
});
test('改第二遍不会把原文覆盖掉', () => {
  const original = 改过()[0].中文名;
  tags.run('record.edit', { 标识: 1, 名称: 取(1).名称, 中文名: '又改了一次' });
  assert.strictEqual(改过().length, 1, '修改库里多了一份');
  assert.strictEqual(改过()[0].中文名, original, '原文被覆盖了');
});
test('还原默认：覆盖回去，并且把修改库那份删掉（只能还原一次）', () => {
  const original = 改过()[0].中文名;
  const result = tags.run('modified.restore', { 标识: 1 });
  assert.ok(result.ok, result.reason);
  assert.strictEqual(取(1).中文名, original);
  assert.strictEqual(改过().length, 0, '修改库那份没删掉');
  assert.strictEqual(tags.run('modified.restore', { 标识: 1 }).ok, false, '还原了第二次');
});
test('原有的记录不能删，只能隐藏', () => {
  const result = tags.run('record.delete', { 标识: 1 });
  assert.strictEqual(result.ok, false);
  assert.ok(result.reason.includes('隐藏'), `理由不对：${result.reason}`);
});
test('自建的记录能删，并且连带清掉修改库那份', () => {
  const created = tags.run('record.create', { 名称: 'to_be_deleted', 中文名: '待删' });
  assert.ok(created.ok, created.reason);
  const made = created.data;
  tags.run('record.edit', { 标识: made.ID, 名称: 'to_be_deleted', 中文名: '改过再删' });
  assert.strictEqual(改过().length, 1);
  const result = tags.run('record.delete', { 标识: made.ID });
  assert.ok(result.ok, result.reason);
  assert.strictEqual(取(made.ID), null);
  assert.strictEqual(改过().length, 0, '修改库里还留着');
  assert.strictEqual(候选('to_be_deleted').length, 0);
});

// ---------------- 隐藏 / 恢复 ----------------
process.stdout.write('\n隐藏 · 恢复\n');
test('隐藏 = 任何方式都查不到（别的东西还能查到，但它自己一条都不剩）', () => {
  const target = 找('hatsune_miku', 'hatsune_miku').记录;
  const result = tags.run('hidden.hide', { 标识: target.ID });
  assert.ok(result.ok, result.reason);
  assert.strictEqual(取(target.ID), null, '取一条还能取到');
  assert.strictEqual(认('hatsune_miku'), null, '认词还能认到');
  assert.ok(!候选('hatsune_miku').some((row) => String(row.记录.ID) === String(target.ID)), '查库里还有它');
  assert.strictEqual(隐().length, 1);
});
test('恢复 = 扔回来源库，ID 不变', () => {
  const back = 隐()[0];
  const result = tags.run('hidden.unhide', { 标识: back.ID });
  assert.ok(result.ok, result.reason);
  assert.strictEqual(取(back.ID).名称, back.名称);
  assert.strictEqual(隐().length, 0);
  assert.strictEqual(认('hatsune_miku'), '初音未来');
});
test('组的规模：34115 个（全是角色组，作品已经不是组了）', () => {
  const all = 组();
  assert.strictEqual(all.length, 34115, `组数不对：${all.length}`);
  const roles = all.filter((row) => row.是角色组);
  assert.strictEqual(roles.length, 34115, `角色表数量不对：${roles.length}`);
  assert.strictEqual(all.filter((row) => row.是系列组).length, 0, '还有组被读成系列组');
  assert.strictEqual(all.filter((row) => row.成员.length === 0).length, 517, '空成员组数量不对');
});
test('角色组：角色那条 tag 自己带着成员，作品排第一（ID 与名字都不动）', () => {
  const hit = 找('hatsune_miku', 'hatsune_miku');
  assert.ok(hit, '找不到 hatsune_miku');
  const record = 取(hit.记录.ID);
  assert.ok(Array.isArray(record.成员), '角色身上没有成员');
  assert.strictEqual(record.成员.length, 9, `成员数不对：${record.成员.length}`);
  const members = record.成员.map((id) => String(取(id).名称).split(',')[0]);
  // 第 0 位是作品：角色与作品的关系记在这一条上，出词时靠它住的页排在最前
  assert.strictEqual(members[0], 'vocaloid', `成员第 0 位不是作品：${members[0]}`);
  for (const name of ['1girl', 'aqua_eyes', 'blue_eyes', 'very_long_hair', 'twintails']) {
    assert.ok(members.includes(name), `成员里少了 ${name}；实际 ${members.join(', ')}`);
  }
  // 库里存的规范写法就是小写加下划线：不带下划线的那种写法不该出现在名称主值里
  for (const 名 of members) {
    assert.strictEqual(名, toKey(名), `成员名不是规范写法：${名}`);
  }
  assert.strictEqual(tags.run('identity.isRole', { 标识: record.ID }).data, true, 'hatsune_miku 不在角色表里');
  assert.strictEqual(tags.run('identity.isSeries', { 标识: record.ID }).data, false, '角色不该在系列表里');
});
test('角色的成员里只有一条作品，且排在第 0 位', () => {
  const roles = 组().filter((row) => row.是角色组 && row.成员.length);
  const seriesIds = new Set(tags.run('identity.series', {}).data.map(String));
  let 没有作品 = 0, 作品跑位 = 0, 多条作品 = 0;
  for (const row of roles) {
    const 位 = row.成员.map(String).map((id, i) => (seriesIds.has(id) ? i : -1)).filter((i) => i >= 0);
    if (!位.length) { 没有作品 += 1; continue; }
    if (位[0] !== 0) 作品跑位 += 1;
    if (位.length > 1) 多条作品 += 1;
  }
  assert.strictEqual(作品跑位, 0, `作品不在第 0 位的角色：${作品跑位}`);
  assert.strictEqual(多条作品, 0, `挂了多条作品的角色：${多条作品}`);
  assert.strictEqual(没有作品, 9, `没有作品但有特征的角色：${没有作品}`);
});
test('角色的成员里不嵌组（决定 91）', () => {
  const roles = 组().filter((row) => row.是角色组);
  const 角色ID = new Set(roles.map((row) => String(row.ID)));
  const 坏 = [];
  for (const row of roles) {
    for (const m of row.成员) if (角色ID.has(String(m))) 坏.push(`${row.名称}→${取(m).名称}`);
  }
  assert.strictEqual(坏.length, 0, `成员里嵌了角色组：${坏.slice(0, 5).join(', ')}`);
});
test('作品是 tag，不是组（决定 120）', () => {
  const hit = 找('vocaloid', 'vocaloid');
  assert.ok(hit, '找不到 vocaloid');
  const record = 取(hit.记录.ID);
  assert.strictEqual(record.成员, undefined, 'vocaloid 还带着成员字段（作品不许是组）');
  assert.strictEqual(tags.run('identity.isRole', { 标识: record.ID }).data, false, '作品不该在角色表里');
  assert.strictEqual(tags.run('identity.isSeries', { 标识: record.ID }).data, true, 'vocaloid 不在作品表里');
});
test('作品搜角色走类：页「作品」装全部作品，页「角色组」一个作品一个类（决定 121/122）', () => {
  const 作品表 = tags.run('identity.series', {}).data.map(String);
  const 页 = 位('分类').list();
  const 作品页 = 页.find((p) => p.页名 === '作品');
  const 角色页 = 页.find((p) => p.页名 === '角色组');
  assert.ok(作品页 && 角色页, '页「作品」或页「角色组」不见了');
  assert.strictEqual(作品页.类列表.length, 1, '页「作品」底下不只一个类');
  const 装的作品 = tags.positions('分类').members(作品页.ID, 作品页.类列表[0].ID).map(String);
  assert.strictEqual(装的作品.length, 作品表.length, `页「作品」装了 ${装的作品.length} 个，作品表 ${作品表.length} 个`);
  assert.ok(装的作品.every((id) => 作品表.includes(id)), '页「作品」里混进了不是作品的东西');
  // 一个作品一个类，类名就是作品名；成员是角色
  assert.strictEqual(角色页.类列表.length, 作品表.length + 1, `页「角色组」类数不对：${角色页.类列表.length}`);
  const 类名们 = new Set(角色页.类列表.map((c) => c.类名));
  assert.ok(类名们.has('未分类'), '没有「未分类」这个类');
  assert.ok(类名们.has('vocaloid'), '没有 vocaloid 这个作品类');
  const vocaloid = 角色页.类列表.find((c) => c.类名 === 'vocaloid');
  const 成员 = tags.positions('分类').members(角色页.ID, vocaloid.ID).map(String);
  assert.ok(成员.length > 50, `vocaloid 类里成员太少：${成员.length}`);
  const 名们 = 成员.map((id) => String(取(id).名称).split(',')[0]);
  assert.ok(名们.includes('hatsune_miku'), 'vocaloid 类里没有 hatsune_miku');
});
test('空成员的角色组也建出来了，一个角色都不丢', () => {
  const empty = 组().filter((row) => row.成员.length === 0);
  assert.strictEqual(empty.length, 517, `空成员组数量不对：${empty.length}`);
  const one = 找('okamisty', 'okamisty');
  assert.ok(one, 'okamisty 这条角色不见了');
  assert.ok(Array.isArray(取(one.记录.ID).成员), '它不是组');
  assert.strictEqual(取(one.记录.ID).成员.length, 0);
});
test('组里不许嵌组：角色的成员里没有别的组（决定 91）', () => {
  const all = 组();
  const characterIds = new Set(all.filter((row) => row.是角色组).map((row) => String(row.ID)));
  for (const group of all) {
    for (const memberId of group.成员) {
      assert.ok(!characterIds.has(String(memberId)), `角色组 ${group.名称} 里嵌了另一个角色组：${memberId}`);
    }
  }
});
test('作品 tag 不许出现在任何类的成员里（决定 122）', () => {
  const 作品集 = new Set(tags.run('identity.series', {}).data.map(String));
  const 坏 = [];
  for (const page of 位('分类').list()) {
    for (const row of page.类列表) {
      for (const m of tags.positions('分类').members(page.ID, row.ID)) {
        if (作品集.has(String(m)) && !(page.页名 === '作品')) 坏.push(`${page.页名}/${row.类名} 里有 ${m}`);
      }
    }
  }
  assert.strictEqual(坏.length, 0, `作品跑进了类成员里：${坏.slice(0, 5).join(' · ')}`);
});
test('隐藏组：只搬组本身，成员不动', () => {
  const anyGroup = 组().find((row) => row.成员.length > 0);
  assert.ok(anyGroup, '找不到带成员的组');
  const membersBefore = [...anyGroup.成员];
  const result = tags.run('hidden.hide', { 标识: anyGroup.ID });
  assert.ok(result.ok, result.reason);
  const stored = 隐().find((row) => String(row.ID) === String(anyGroup.ID));
  assert.deepStrictEqual(stored.成员, membersBefore, '成员被动过了');
  for (const memberId of membersBefore.slice(0, 3)) assert.ok(取(memberId), '成员被连带隐藏了');
  assert.ok(tags.run('hidden.unhide', { 标识: anyGroup.ID }).ok);
  assert.strictEqual(隐().length, 0);
});
test('隐藏自建的记录也能恢复，回来的还是自建', () => {
  const made = tags.run('record.create', { 名称: 'hidden_oc', 中文名: '会被藏起来的' }).data;
  assert.ok(tags.run('hidden.hide', { 标识: made.ID }).ok);
  assert.ok(隐().some((row) => String(row.ID) === String(made.ID)));
  assert.ok(tags.run('hidden.unhide', { 标识: made.ID }).ok);
  assert.ok(候选('hidden_oc').some((row) => String(row.记录.ID) === String(made.ID)), '回来后搜不到');
});
test('删掉记录以后，位置里的那个 ID 还在（悬空留给渲染时跳过）', () => {
  const root = tags.positions('收藏');
  const page = root.createPage({ 页名: '悬空测试' });
  const cls = root.createClass(page.ID, { 类名: '类' });
  const made = tags.run('record.create', { 名称: 'ghost_oc' }).data;
  root.attach(page.ID, cls.ID, made.ID);
  tags.run('record.delete', { 标识: made.ID });
  assert.deepStrictEqual(root.members(page.ID, cls.ID), [made.ID], '位置被动了');
  assert.strictEqual(取(made.ID), null);
});

// ---------------- 渲染顺序 ----------------
process.stdout.write('\n渲染顺序\n');
test('页序表（表一）：在表里的页按页序给，角色那一页与负向那些不在表里', () => {
  const r = tags.run('render.pages', {});
  assert.ok(r.ok, r.reason);
  const 页们 = r.data;
  assert.ok(页们.length > 15, `页序太短：${页们.length}`);
  const 名们 = 页们.map((p) => p.页名);
  assert.strictEqual(名们[0], '作品', `第一页不是作品：${名们[0]}`);
  assert.strictEqual(名们[1], '头发', `第二页不是头发：${名们[1]}`);
  assert.ok(!名们.includes('角色组'), '角色组不该进渲染表');
  assert.ok(!名们.includes('负面提示词'), '负面提示词不该进渲染表');
  // 页序是连续的 0..n-1
  页们.forEach((p, i) => assert.strictEqual(p.页序, i));
});
test('按渲染顺序排（表一）：作品 → 头发 → 眼睛 → 人物 → 服装 → 道具；库外的排最后', () => {
  const r = tags.run('render.sort', { 词们: ['red_bow', 'brown_eyes', 'detached_sleeves', '1girl', 'hair_bow', 'touhou', '库外词'] });
  assert.ok(r.ok, r.reason);
  const 名们 = r.data.map((x) => x.词);
  assert.deepStrictEqual(名们, ['touhou', 'brown_eyes', '1girl', 'detached_sleeves', 'hair_bow', 'red_bow', '库外词']);
  const 末 = r.data[r.data.length - 1];
  assert.strictEqual(末.在库里, false);
  assert.strictEqual(末.页名, null);
});
test('自由文本排序保留原文；规范名称与别名解析不擅自改写词义', () => {
  const memory = createMemoryPort({
    [KEYS.主库]: { 格式: 'tag-library/主库', 版本: 1, 计数器: 8, 记录列表: [
      { ID: 1, 名称: 'earrings', 中文名: '耳环,black_earrings,red_earrings' },
      { ID: 2, 名称: 'hair_intakes', 中文名: '额角发束' },
      { ID: 3, 名称: 'hair_in_takes', 中文名: '收拢' },
      { ID: 4, 名称: 'demon', 中文名: '魔鬼,devil' },
      { ID: 5, 名称: 'devil', 中文名: '恶魔' },
      { ID: 6, 名称: 'wristband,wrist_band', 中文名: '腕带' },
      { ID: 7, 名称: 'phantom', 中文名: 'shared_name' },
      { ID: 8, 名称: 'specter,shared_name', 中文名: '幽影' },
    ] },
    [KEYS.自建库]: { 格式: 'tag-library/自建库', 版本: 1, 计数器: 0, 记录列表: [] },
  });
  const mini = createTagModule({ port: memory });
  const r = mini.run('render.sort', { 词们: ['black_earrings', 'red_earrings', 'hairintakes', 'devil'] });
  assert.ok(r.ok, r.reason);
  assert.deepStrictEqual(r.data.map((x) => x.词), ['black_earrings', 'red_earrings', 'hairintakes', 'devil']);
  assert.strictEqual(mini.recognize('black_earrings'), null, '混杂中文字段的关联词不能成为自动改写别名');
  assert.strictEqual(mini.recognize('hairintakes'), null, '连写多候选不应选第一条');
  assert.strictEqual(mini.recognize('devil'), '恶魔', '规范名称优先于其他记录混杂的别名');
  assert.strictEqual(mini.query('devil').候选[0].记录.ID, 5, '查询中的规范名精确命中优先');
  assert.strictEqual(mini.recognize('wrist_band'), '腕带', '名称字段中明确保存的别名仍可认词');
  const exactName = mini.query('earrings').候选.find((item) => item.记录.ID === 1);
  assert.deepStrictEqual([exactName.命中类型, exactName.命中词], ['规范名', 'earrings']);
  const confirmedAlias = mini.query('wrist_band').候选.find((item) => item.记录.ID === 6);
  assert.deepStrictEqual([confirmedAlias.命中类型, confirmedAlias.命中词], ['确认别名', 'wrist_band']);
  const primaryChinese = mini.query('腕带').候选.find((item) => item.记录.ID === 6);
  assert.deepStrictEqual([primaryChinese.命中类型, primaryChinese.命中词], ['主中文名', '腕带']);
  const approximate = mini.query('hairintakes').候选.filter((item) => [2, 3].includes(item.记录.ID));
  assert.ok(approximate.every((item) => item.命中类型 === '近似' && typeof item.命中词 === 'string'));
  const idRender = mini.run('render.sort', { 词们: [{ 标识: 1 }] });
  assert.strictEqual(idRender.data[0].词, 'earrings', '明确 ID 输出规范词');
  const unresolved = mini.run('resolve', { 词: 'hairintakes' });
  assert.strictEqual(unresolved.data, null, '近似多候选解析返回 null');
  assert.strictEqual(mini.run('resolve', { 词: 'wrist_band' }).data.标识, 6, '明确别名返回规范记录 ID');
  assert.strictEqual(mini.resolve('shared_name'), null, '跨记录别名歧义不选择');
  assert.strictEqual(mini.recognize('shared_name'), null, '认词与唯一解析遵守相同歧义结果');
});
test('同页内是类说了算：发色排在默认之后（页 36 的类序）', () => {
  const r = tags.run('render.sort', { 词们: ['brown_hair', 'long_hair', 'hair_tubes', 'black_hair'] });
  assert.deepStrictEqual(r.data.map((x) => x.词), ['long_hair', 'hair_tubes', 'black_hair', 'brown_hair']);
  assert.deepStrictEqual(r.data.map((x) => x.类名), ['长度', '默认', '发色', '发色']);
});
test('重复的留着，不改词本身', () => {
  const r = tags.run('render.sort', { 词们: ['1girl', '1girl'] });
  assert.strictEqual(r.data.length, 2);
  assert.deepStrictEqual(r.data.map((x) => x.词), ['1girl', '1girl']);
});
test('一个角色的三段（表二）：角色名 · 作品 · 特征按页分块', () => {  const r = tags.run('render.words', { 标识: 9540 });
  assert.ok(r.ok, r.reason);
  assert.strictEqual(r.data.角色名, 'hakurei_reimu');
  assert.strictEqual(r.data.作品, 'touhou', '作品不是从类里读出来的');
  const 页名们 = r.data.块们.map((b) => b.页名);
  assert.deepStrictEqual(页名们, ['头发', '眼睛', '人物与角色', '服装', '道具与装饰']);
  assert.deepStrictEqual(r.data.块们[0].词们, ['long_hair', 'hair_tubes', 'black_hair', 'brown_hair']);
  assert.deepStrictEqual(r.data.块们[4].词们, ['hair_bow', 'red_bow']);
  // 特征里不许出现作品那条 tag（它由"作品"那一段承担）
  const 全部词 = r.data.块们.flatMap((b) => b.词们);
  assert.ok(!全部词.includes('touhou'), '特征里带上了作品');
});
test('作品从类读：改作品类，出词跟着变（角色记录一个字不动）', () => {
  const 页 = 位('分类').list().find((p) => p.页名 === '角色组');
  const vocaloid = 页.类列表.find((c) => c.类名 === 'vocaloid');
  const miku = 找('hatsune_miku', 'hatsune_miku');
  tags.positions('分类').detach(页.ID, vocaloid.ID, String(miku.记录.ID));
  const 没作品 = tags.run('render.words', { 标识: miku.记录.ID });
  assert.strictEqual(没作品.data.作品, null, '从类里拿掉了还读得出作品');
  // 放回去
  tags.positions('分类').attach(页.ID, vocaloid.ID, String(miku.记录.ID));
  assert.strictEqual(tags.run('render.words', { 标识: miku.记录.ID }).data.作品, 'vocaloid');
});
test('落在「未分类」的角色：作品那一段是空的，特征照出', () => {
  const 页 = 位('分类').list().find((p) => p.页名 === '角色组');
  const 未分类 = 页.类列表.find((c) => c.类名 === '未分类');
  const 成员 = tags.positions('分类').members(页.ID, 未分类.ID);
  assert.strictEqual(成员.length, 526, `「未分类」成员数不对：${成员.length}`);
  const r = tags.run('render.words', { 标识: 成员[0] });
  assert.ok(r.ok, r.reason);
  assert.strictEqual(r.data.作品, null);
});

// ---------------- 注释 ----------------
process.stdout.write('\n注释\n');
test('一条记录一条注释；空文本 = 删除', () => {
  assert.strictEqual(tags.run('note.get', { 标识: 2 }).data, null);
  assert.ok(tags.run('note.set', { 标识: 2, 文本: '这是一条注释' }).ok);
  assert.strictEqual(tags.run('note.get', { 标识: 2 }).data, '这是一条注释');
  assert.ok(tags.run('note.set', { 标识: 2, 文本: '   ' }).ok);
  assert.strictEqual(tags.run('note.get', { 标识: 2 }).data, null, '空文本没删掉');
});

// ---------------- 身份 ----------------
process.stdout.write('\n身份表\n');
test('成人标签表答"是不是"，也能整张列出来', () => {
  const adults = tags.run('identity.adults');
  assert.ok(adults.ok);
  assert.strictEqual(adults.data.length, 693, `成人标签数不对：${adults.data.length}`);
  const one = adults.data[0];
  assert.strictEqual(tags.run('identity.isAdult', { 标识: one }).data, true);
  assert.strictEqual(tags.run('identity.isAdult', { 标识: 99999999 }).data, false);
});
test('角色表与系列表各答各的"是不是"', () => {
  const roles = tags.run('identity.roles');
  assert.ok(roles.ok);
  assert.strictEqual(roles.data.length, 34115, `角色表数量不对：${roles.data.length}`);
  assert.strictEqual(tags.run('identity.isRole', { 标识: roles.data[0] }).data, true);
  assert.strictEqual(tags.run('identity.isRole', { 标识: 1 }).data, false);

  const series = tags.run('identity.series');
  assert.ok(series.ok);
  assert.strictEqual(series.data.length, 4049, `系列表数量不对：${series.data.length}`);
  assert.strictEqual(tags.run('identity.isSeries', { 标识: series.data[0] }).data, true);
  assert.strictEqual(tags.run('identity.isSeries', { 标识: 1 }).data, false);

  // 两张表不许有交集：一个组要么是角色组，要么是系列组
  const 角色集 = new Set(roles.data.map(String));
  assert.strictEqual(series.data.filter((id) => 角色集.has(String(id))).length, 0, '同一个 ID 进了两张表');
});

// ---------------- 重读 ----------------
process.stdout.write('\n重读\n');
test('reload：重读端口上的库，自建库与位置都不动', () => {
  const made = tags.run('record.create', { 名称: 'survives_reload' }).data;
  const 页数前 = 位('分类').list().length;
  const result = tags.run('reload');
  assert.ok(result.ok, result.reason);
  assert.ok(取(made.ID), 'reload 把自建库也清了');
  assert.ok(取(1), 'reload 之后主库读不出来了');
  assert.strictEqual(位('分类').list().length, 页数前, 'reload 把位置弄丢了');
  assert.ok(候选('hatsune_miku').length > 0, 'reload 之后搜不出来了');
});

// ---------------- 体检 ----------------
process.stdout.write('\n体检\n');
test('体检报告规模、野键、坏键', () => {
  const status = tags.run('status');
  assert.ok(status.ok, status.reason);
  const s = status.data;
  assert.ok(s.记录.主库 > 50000, `主库只有 ${s.记录.主库} 条`);
  assert.ok(s.记录.自建库 > 0);
  assert.strictEqual(s.位置.分类页, 27);
  assert.ok(s.位置.收藏页 >= 1, `收藏页数不对：${s.位置.收藏页}`);
  assert.deepStrictEqual(s.坏的键, []);
  assert.deepStrictEqual(s.野键, [], `有野键：${s.野键.join(', ')}`);
  assert.deepStrictEqual(s.写剩的临时文件, [], `有写剩的临时文件：${s.写剩的临时文件.join(', ')}`);
  process.stdout.write(`     主库 ${s.记录.主库} 条 · 自建 ${s.记录.自建库} 条 · 索引 ${s.索引.indexed} 条 · 磁盘键 ${s.磁盘上的键} 个 · 野键 ${s.野键.length} 个\n`);
});

// ---------------- 收尾 ----------------
fs.rmSync(dir, { recursive: true, force: true });

process.stdout.write(`\n通过 ${passed} · 失败 ${failed}\n`);
if (failed) {
  for (const row of failures) {
    process.stdout.write(`\n✗ ${row.name}\n  ${row.error && row.error.stack ? row.error.stack.split('\n').slice(0, 4).join('\n  ') : row.error}\n`);
  }
  process.exitCode = 1;
}

