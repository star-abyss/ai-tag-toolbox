'use strict';
/*
 * 收拾：作品 tag 不许出现在"页「作品」"以外的任何类里（决定 122）。
 *
 * 查的是每个类格的成员里有没有作品集里的 ID；有就从那一个格里摘掉，
 * 只在页「作品」那一格留着（那一格装的本来就是全部作品）。
 *
 * 用法：node tools/收拾-作品混进类里.js [--data <目录>] [--dry]
 *   跑完自带对账：摘掉的条数、剩下还有没有、每个格的文件是否还在。
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const 传参 = (名, 兜底) => (args.includes(名) ? args[args.indexOf(名) + 1] : 兜底);
const DATA = path.resolve(传参('--data', path.join(__dirname, '..', 'data')));
const DRY = args.includes('--dry');

const 说 = (s) => console.log(s);
const 分类 = path.join(DATA, '位置', '分类');
const 读json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const 写json = (p, 值) => fs.writeFileSync(p, JSON.stringify(值, null, 2) + '\n', 'utf8');

function 主() {
  const 作品集 = new Set(读json(path.join(DATA, '表', '系列.json')).map(String));
  const 页们 = fs.readdirSync(分类).filter((d) => /^\d+$/.test(d));
  const 名字 = new Map();
  for (const f of fs.readdirSync(path.join(DATA, '记录', '主库'))) {
    for (const l of fs.readFileSync(path.join(DATA, '记录', '主库', f), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      const r = JSON.parse(l);
      名字.set(String(r.ID), String(r.名称).split(',')[0]);
    }
  }

  const 要改 = [];
  for (const 页ID of 页们) {
    const 元 = 读json(path.join(分类, 页ID, '页.json'));
    for (const c of 元.类列表) {
      const p = path.join(分类, 页ID, String(c.ID) + '.json');
      if (!fs.existsSync(p)) continue;
      const 成员 = 读json(p).map(String);
      const 脏 = 成员.filter((m) => 作品集.has(m));
      if (!脏.length) continue;
      if (元.页名 === '作品') continue;   // 这一格装的本来就是作品
      要改.push({ 页ID, 页名: 元.页名, 类ID: c.ID, 类名: c.类名, p, 脏, 净: 成员.filter((m) => !作品集.has(m)), 原样: 成员 });
    }
  }

  说(`数据目录 ${DATA}`);
  说(`作品集 ${作品集.size} 个 · 页 ${页们.length} 个`);
  说(`混进了类里的作品：${要改.reduce((n, x) => n + x.脏.length, 0)} 条，落在 ${要改.length} 个格里`);
  for (const x of 要改) 说(`  ${x.页名} / ${x.类名}：${x.脏.map((m) => m + '「' + (名字.get(m) || '?') + '」').join(' , ')}`);

  if (!要改.length) {
    说('没有要收拾的');
    return;
  }
  if (DRY) {
    说('--dry：没有写盘');
    return;
  }

  for (const x of 要改) {
    if (x.净.length) 写json(x.p, x.净);
    else fs.rmSync(x.p, { force: true });   // 空类 = 不留文件（与端口的写法一致）
  }

  // 对账：重读一遍
  let 剩 = 0;
  for (const 页ID of 页们) {
    const 元 = 读json(path.join(分类, 页ID, '页.json'));
    if (元.页名 === '作品') continue;
    for (const c of 元.类列表) {
      const p = path.join(分类, 页ID, String(c.ID) + '.json');
      if (!fs.existsSync(p)) continue;
      for (const m of 读json(p).map(String)) if (作品集.has(m)) 剩++;
    }
  }
  说(`收拾完成：${要改.length} 个格改过，剩下还混着的 ${剩} 条`);
  if (剩) process.exit(1);
}

主();
