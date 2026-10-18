'use strict';
/*
 * 一次性转换：把身份表拆成两张。
 *
 *   data/表/角色.json   ← 角色组的 ID（带 `成员` 的那些记录，去掉系列组）
 *   data/表/系列.json   ← 系列组的 ID
 *
 * 转换前 `表/角色.json` 装的是系列组的 ID（`refactor.js` 的 307 / 378 两行写进去的
 * 是 `seriesIds`），角色组的 ID 从来没有落过盘。存量库里能分清两边的依据只有这一条：
 * 转换前那份 `表/角色.json` 就是系列组，**它是唯一的真值**，所以这个脚本要在拆之前跑。
 *
 * 用法：node tools/拆两张表.js [--data <目录>] [--dry] [--回滚]
 *   拆过之后再跑就是"只核对不写"，核对不过非零退出。
 */
const fs = require('fs');
const path = require('path');
const { createFilePort } = require('../adapter-file.js');

const args = process.argv.slice(2);
const 传参 = (名, 兜底) => (args.includes(名) ? args[args.indexOf(名) + 1] : 兜底);
const DATA = path.resolve(传参('--data', path.join(__dirname, '..', 'data')));
const DRY = args.includes('--dry');
const 回滚 = args.includes('--回滚');

const 说 = (s) => console.log(s);
const 表路径 = (名) => path.join(DATA, '表', `${名}.json`);

function 读表(名) {
  const p = 表路径(名);
  if (!fs.existsSync(p)) return null;
  const 值 = JSON.parse(fs.readFileSync(p, 'utf8'));
  return Array.isArray(值) ? 值.map(String) : null;
}

function 写表(名, 值) {
  fs.mkdirSync(path.dirname(表路径(名)), { recursive: true });
  fs.writeFileSync(表路径(名), JSON.stringify(值, null, 2) + '\n', 'utf8');
}

function 主() {
  const port = createFilePort({ root: DATA });
  const 主库 = port.read('主库');
  if (主库.state !== 'ok') {
    说(`主库读不出来：${主库.reason || 主库.state}`);
    process.exit(1);
  }

  // 组 = 带 `成员` 的记录；成员是数组，空数组也算
  const 组们 = 主库.value.记录列表.filter((行) => Array.isArray(行.成员));
  const 全组 = 组们.map((行) => String(行.ID));
  const 空组 = 组们.filter((行) => 行.成员.length === 0).length;

  const 表里角色 = 读表('角色');
  const 表里系列 = 读表('系列');
  if (!表里角色) {
    说('表/角色.json 不见了或读不出来 —— 先确认数据在不在');
    process.exit(1);
  }
  说(`数据目录 ${DATA}`);

  // ---------- 拆过之后：只核对，不写 ----------
  if (表里系列 && !回滚) {
    const 角 = new Set(表里角色);
    const 系 = new Set(表里系列);
    const 撞车 = [...角].filter((id) => 系.has(id));
    const 漏 = 全组.filter((id) => !角.has(id) && !系.has(id));
    说(`组 ${全组.length} 个 · 空成员组 ${空组} 个 · 角色表 ${角.size} 个 · 系列表 ${系.size} 个`);
    if (撞车.length || 漏.length) {
      说(`核对不过：两张表撞车 ${撞车.length} 个 · 没进任何一张表的组 ${漏.length} 个`);
      process.exit(1);
    }
    说('已经拆过了，核对通过');
    return;
  }

  // ---------- 拆之前：那份 `表/角色.json` 装的是系列组 ----------
  const 旧表 = new Set(表里角色);
  const 系列 = 全组.filter((id) => 旧表.has(id));
  const 角色 = 全组.filter((id) => !旧表.has(id));
  说(`组 ${全组.length} 个 · 空成员组 ${空组} 个 · 角色组 ${角色.length} 个 · 系列组 ${系列.length} 个`);

  if (DRY) {
    说('--dry：没有写盘');
    return;
  }

  if (回滚) {
    // 回到拆之前：系列表那份收回角色表，系列表删掉
    写表('角色', 系列);
    fs.rmSync(表路径('系列'), { force: true });
    说(`回滚完成：角色表 ${系列.length} 个（系列组），系列表已删`);
    return;
  }

  写表('系列', 系列);
  写表('角色', 角色);

  // 对账：拿写下去的两份再数一遍
  const 新角色 = new Set(读表('角色'));
  const 新系列 = new Set(读表('系列'));
  const 全集 = new Set(全组);
  const 漏 = [...全集].filter((id) => !新角色.has(id) && !新系列.has(id));
  const 重 = [...新角色].filter((id) => 新系列.has(id));
  const 多 = [...新角色, ...新系列].filter((id) => !全集.has(id));
  说(`写下去：角色表 ${新角色.size} 个 · 系列表 ${新系列.size} 个`);
  说(`漏 ${漏.length} · 重复 ${重.length} · 不是组的 ${多.length}`);
  if (漏.length || 重.length || 多.length) process.exit(1);
}

主();
