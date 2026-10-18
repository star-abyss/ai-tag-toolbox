'use strict';
/*
 * 收拾：一个角色只该在页「角色组」的类里出现一次。
 *
 * 乙那一批把角色摆进作品类时，有 5 条本来被摆在别的页里（`spider_girl` 在「人物与角色/角色」、
 * `chocobo` 在「动物/幻想生物」…），于是同一个 ID 出现了两次。这一步把"非页「角色组」"的那一处摘掉。
 *
 * 产物：页「角色组」底下的类成员一个不少；别的页里不再有角色组的 ID。
 *
 * 用法：node tools/收拾-角色在别页.js [--data <目录>] [--dry]
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const 传参 = (名, 兜底) => (args.includes(名) ? args[args.indexOf(名) + 1] : 兜底);
const DATA = path.resolve(传参('--data', path.join(__dirname, '..', 'data')));
const DRY = args.includes('--dry');

const 说 = (s) => console.log(s);
const 分类 = path.join(DATA, '位置', '分类');
const 角色页名 = '角色组';
const 读json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const 写json = (p, 值) => fs.writeFileSync(p, JSON.stringify(值, null, 2) + '\n', 'utf8');

function 主() {
  const 角色表 = new Set(读json(path.join(DATA, '表', '角色.json')).map(String));
  const 名字 = new Map();
  for (const f of fs.readdirSync(path.join(DATA, '记录', '主库'))) {
    for (const l of fs.readFileSync(path.join(DATA, '记录', '主库', f), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      const r = JSON.parse(l);
      名字.set(String(r.ID), String(r.名称).split(',')[0]);
    }
  }

  const 要改 = [];
  for (const 页ID of fs.readdirSync(分类).filter((d) => /^\d+$/.test(d))) {
    const 元 = 读json(path.join(分类, 页ID, '页.json'));
    if (元.页名 === 角色页名) continue;
    for (const c of 元.类列表) {
      const p = path.join(分类, 页ID, String(c.ID) + '.json');
      if (!fs.existsSync(p)) continue;
      const 成员 = 读json(p).map(String);
      const 脏 = 成员.filter((m) => 角色表.has(m));
      if (!脏.length) continue;
      要改.push({
        页ID, 页名: 元.页名, 类ID: c.ID, 类名: c.类名, p, 脏,
        净: 成员.filter((m) => !角色表.has(m)),
      });
    }
  }

  说(`数据目录 ${DATA}`);
  说(`角色表 ${角色表.size} 个 · 角色跑进别的页的：${要改.reduce((n, x) => n + x.脏.length, 0)} 条，落在 ${要改.length} 个格里`);
  for (const x of 要改) 说(`  ${x.页名} / ${x.类名}：${x.脏.map((m) => m + '「' + (名字.get(m) || '?') + '」').join(' , ')}`);

  if (!要改.length) { 说('没有要收拾的'); return; }
  if (DRY) { 说('--dry：没有写盘'); return; }

  for (const x of 要改) {
    if (x.净.length) 写json(x.p, x.净);
    else fs.rmSync(x.p, { force: true });
  }

  // 对账：重读一遍，别页里不该再有角色
  let 剩 = 0;
  for (const 页ID of fs.readdirSync(分类).filter((d) => /^\d+$/.test(d))) {
    const 元 = 读json(path.join(分类, 页ID, '页.json'));
    if (元.页名 === 角色页名) continue;
    for (const c of 元.类列表) {
      const p = path.join(分类, 页ID, String(c.ID) + '.json');
      if (!fs.existsSync(p)) continue;
      for (const m of 读json(p).map(String)) if (角色表.has(m)) 剩++;
    }
  }
  说(`收拾完成：${要改.length} 个格改过，别页里还剩 ${剩} 条角色`);
  if (剩) process.exit(1);
}

主();
