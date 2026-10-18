'use strict';
/*
 * 子代理联调用的命令行。两个子代理都通过它干活，谁也不直接碰模块源码。
 *
 *   node tools/联调.cjs 起 <地址> <工作流名>    把 tools/.工作流/<名>.json 装进模块，并记下地址
 *   node tools/联调.cjs 看                     看设置 / 状态 / 往来
 *   node tools/联调.cjs 问                     AI 看用户要什么
 *   node tools/联调.cjs 说 '<文字>'             用户提要求
 *   node tools/联调.cjs 交 '<json>'             AI 交回执
 *   node tools/联调.cjs 出图 '<json>'           出一张：{"正向":…,"负向":…,"图片":…}
 *   node tools/联调.cjs 取图 '<文件名>' [存成]    把产出取到本地，供下一轮当输入
 *
 * 说 / 交 / 出图 的参数写成 @文件 时，就从那个文件读（省得跟引号较劲）。
 *
 * 留下的文件都在 tools/.实测/ 下：
 *   设置.json          地址、当前用哪张工作流
 *   状态.json          跑到第几轮、最后一张图在哪、最后一次的正负提示词
 *   收件箱.json        用户与 AI 之间的往来
 *   工作流-<名>.json    模块的存档
 *   图片/              送进 ComfyUI 的输入图
 */

const fs = require('node:fs');
const path = require('node:path');
const { createComfyModule } = require('../index.js');

const 主目录 = path.join(__dirname, '.实测');
const 图片目录 = path.join(主目录, '图片');
const 工作流目录 = path.join(__dirname, '.工作流');
const 档 = {
  设置: path.join(主目录, '设置.json'),
  状态: path.join(主目录, '状态.json'),
  收件箱: path.join(主目录, '收件箱.json'),
};

function 读(p, 默认值) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return 默认值; }
}
function 写(p, 值) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(值, null, 2), 'utf8');
}
const 输出 = (...a) => console.log(...a);

/** 一个把档写在本地的存档端口。 */
function 造存档(名) {
  const p = path.join(主目录, `工作流-${名}.json`);
  return {
    读: () => 读(p, null),
    写: (v) => { 写(p, v); return true; },
    清: () => { try { fs.unlinkSync(p); } catch { /* 本来就没有 */ } },
  };
}

function 读设置() {
  const 设置 = 读(档.设置, null);
  if (!设置 || typeof 设置.地址 !== 'string' || !设置.地址) {
    输出('还没有地址：先跑 node tools/联调.cjs 起 <地址> <工作流名>');
    process.exit(1);
  }
  return 设置;
}

/** 按设置里的地址与当前工作流建模块；先把节点定义取回来。 */
async function 建模块() {
  const 设置 = 读设置();
  const comfy = createComfyModule({ 地址: 设置.地址, 存档: 造存档(设置.当前) });
  const 定义 = await comfy.看节点定义();
  if (!定义) { 输出(`连不上 ${设置.地址}`); process.exit(1); }
  return { 设置, comfy };
}

function 记往来(角色, 内容) {
  const 箱 = 读(档.收件箱, []);
  箱.push({ 时刻: new Date().toISOString(), 角色, 内容 });
  写(档.收件箱, 箱);
}

/** 参数以 @ 开头时，把它当文件路径读；否则原样用。 */
function 取参数(文本) {
  if (typeof 文本 === 'string' && 文本.startsWith('@')) return fs.readFileSync(文本.slice(1), 'utf8');
  return 文本;
}

function 解JSON(文本, 名) {
  try { return JSON.parse(取参数(文本)); } catch {
    输出(`${名} 要 JSON，或 @一个装着 JSON 的文件`);
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ 动作 */

const 动作 = {
  /** 装一张工作流，并记下地址。 */
  async 起(地址, 名) {
    if (!地址 || !名) { 输出('用法：node tools/联调.cjs 起 <地址> <工作流名>'); process.exit(1); }
    const p = path.join(工作流目录, `${名}.json`);
    if (!fs.existsSync(p)) {
      输出(`没有这张：${p}`);
      输出(`先造：node tools/造工作流.cjs ${地址}`);
      process.exit(1);
    }
    写(档.设置, { 地址, 当前: 名, 导入于: new Date().toISOString() });
    const comfy = createComfyModule({ 地址, 存档: 造存档(名) });
    const 定义 = await comfy.看节点定义();
    if (!定义) { 输出(`连不上 ${地址}`); process.exit(1); }
    const 存 = await comfy.run('存工作流', { 图: JSON.parse(fs.readFileSync(p, 'utf8')) });
    if (!存.ok) { 输出(`导入失败：${存.reason}`); process.exit(1); }
    const 口 = 存.data.口;
    记往来('系统', `导入工作流「${名}」`);
    输出(`导入「${名}」成功。认得的：${口.认得的.join(' / ')}`);
    输出(`  认不出：${口.认不出的.join(' / ') || '（无）'}`);
  },

  /** 看现状。 */
  看() {
    const 设置 = 读(档.设置, null);
    const 状态 = 读(档.状态, null);
    const 箱 = 读(档.收件箱, []);
    输出('设置:', JSON.stringify(设置));
    输出('状态:', JSON.stringify(状态));
    输出(`往来 ${箱.length} 条：`);
    for (const x of 箱.slice(-6)) 输出(`  [${x.角色}] ${typeof x.内容 === 'string' ? x.内容 : JSON.stringify(x.内容)}`);
  },

  /** AI 看用户要什么。 */
  问() {
    const 箱 = 读(档.收件箱, []);
    const 待办 = 箱.filter((x) => x.角色 === '用户' && !x.已答);
    if (!待办.length) { 输出('没有待办。'); return; }
    for (const x of 待办) 输出(typeof x.内容 === 'string' ? x.内容 : JSON.stringify(x.内容, null, 2));
  },

  /** 用户提要求。 */
  说(文本) {
    const 话 = 取参数(文本);
    if (!话) { 输出('要一句话'); process.exit(1); }
    记往来('用户', 话.trim());
    输出('已记录。');
  },

  /** AI 交回执。 */
  交(文本) {
    if (!文本) { 输出('要一个 JSON 或一句话'); process.exit(1); }
    const 源 = 取参数(文本);
    let 内容; try { 内容 = JSON.parse(源); } catch { 内容 = 源; }
    const 箱 = 读(档.收件箱, []);
    for (let i = 箱.length - 1; i >= 0; i -= 1) {
      if (箱[i].角色 === '用户' && !箱[i].已答) { 箱[i].已答 = true; break; }
    }
    箱.push({ 时刻: new Date().toISOString(), 角色: 'AI', 内容 });
    写(档.收件箱, 箱);
    输出('已交回执。');
  },

  /** 出一张。 */
  async 出图(文本) {
    const 参数 = 解JSON(文本, '出图参数');
    const { 设置, comfy } = await 建模块();

    let 图片;
    if (参数.图片) {
      const p = path.join(图片目录, 参数.图片);
      if (!fs.existsSync(p)) { 输出(`没有这张图：${p}`); process.exit(1); }
      图片 = { 字节: fs.readFileSync(p), 文件名: 参数.图片, mime: 'image/png' };
      输出(`送图：${参数.图片}（${图片.字节.length} 字节）`);
    }

    await comfy.run('绘图开关', { 启用: true });
    const 回 = await comfy.run('出图', {
      正向: 参数.正向,
      负向: 参数.负向,
      图片,
      onEvent: (e) => { if (e.类型 === '状态') 输出(`  … ${e.状态}`); },
    });
    if (!回.ok) { 输出(`出图失败：${回.reason}`); process.exit(1); }

    输出(`出图成功：任务号 ${回.data.任务号}`);
    输出(`  填了：${JSON.stringify(回.data.填了的)}`);
    输出(`  产出 ${回.data.产出.length} 个：`);
    for (const f of 回.data.产出) 输出(`    ${f.文件名}  (节点 ${f.节点} · ${f.种类})`);

    const 状态 = 读(档.状态, { 轮次: 0 });
    状态.轮次 = (状态.轮次 || 0) + 1;
    状态.任务号 = 回.data.任务号;
    状态.最后产出 = 回.data.产出;
    状态.最后工作流 = 设置.当前;
    if (参数.正向) 状态.最后正向 = 参数.正向;
    if (参数.负向) 状态.最后负向 = 参数.负向;
    写(档.状态, 状态);
    记往来('系统', `第 ${状态.轮次} 轮出图（${设置.当前}）：${回.data.产出.map((x) => x.文件名).join(', ')}`);
  },

  /** 把产出取到本地，供下一轮当输入。 */
  async 取图(文件名, 存成) {
    if (!文件名) { 输出('用法：node tools/联调.cjs 取图 <文件名> [存成]'); process.exit(1); }
    const { comfy } = await 建模块();
    const 状态 = 读(档.状态, {});
    const 项 = (状态.最后产出 || []).find((x) => x.文件名 === 文件名)
      || { 文件名, 子目录: '', 类型: 'output' };
    const 回 = await comfy.run('取图', { 产出: 项 });
    if (!回.ok) { 输出(`取图失败：${回.reason}`); process.exit(1); }
    const 名 = 存成 || 文件名;
    fs.mkdirSync(图片目录, { recursive: true });
    fs.writeFileSync(path.join(图片目录, 名), 回.data.字节);
    输出(`取回 ${回.data.字节.length} 字节（${回.data.mime}）→ tools/.实测/图片/${名}`);
  },
};

const [动作名, ...其余] = process.argv.slice(2);
if (!动作名 || !动作[动作名]) {
  输出('用法：node tools/联调.cjs 起|看|问|说|交|出图|取图 [参数]');
  process.exit(1);
}
Promise.resolve(动作[动作名](...其余)).catch((错误) => {
  输出('出错了：' + ((错误 && 错误.message) || 错误));
  process.exit(1);
});
