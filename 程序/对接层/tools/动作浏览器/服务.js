// 动作浏览器 · 宿主侧。一个本地 HTTP 服务：把八份动作表与所有动作开给浏览器页面。
//
//   node 对接层/tools/动作浏览器/服务.js [--端口 8791] [--项目根 <路径>]
//
// 装配走的是对接层自己的那一条：模块清单 + apply 的接线，与工具那一侧同一份。
// 本地模型（ONNX）照配置装上，第一次用到才加载；DSH 的模型调用不给，
// 所以「看图」与装订的 AI 翻译那两步不可用，其余动作全部真读写本机数据。
//
// 四条路由：
//   GET  /             → 页面本身（令牌注在里面）
//   GET  /页.js · /页.css
//   POST /toolbox/桌    → 八份 describe() 合起来的一张表
//   POST /toolbox/调    → { 模块, 动作, 参数 } → 该动作的回执
//   POST /toolbox/模型  → 看 / 换本地模型那一格
//
// 服务只绑 127.0.0.1，并且要一个令牌：令牌在这次启动时现生成，打一份在控制台上，
// 同时注入页面。三条 POST 都要 `x-toolbox-token` 头。

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import yaml from 'js-yaml';

import { 造模块清单, 主AI, 取参数类型 } from '../../模块清单.js';
import { 读PNG元数据 } from '../../../识图模块/元数据.js';
import { 造本地模型 } from './模型可选.js';
import { 造存储 } from '../../位置.js';

const 本目录 = path.dirname(fileURLToPath(import.meta.url));
const 页目录 = path.join(本目录, '页');
const 对接层目录 = path.resolve(本目录, '..', '..');
const 默认项目根 = path.resolve(对接层目录, '..');

/** 只服务这几个名字，别的一律 404。 */
const 页 = Object.freeze({
  '/': { 文件: 'index.html', 类型: 'text/html; charset=utf-8' },
  '/页.js': { 文件: '页.js', 类型: 'text/javascript; charset=utf-8' },
  '/页.css': { 文件: '页.css', 类型: 'text/css; charset=utf-8' },
});

/**
 * 把字节还原成 Buffer。
 *
 * 这一层与 DSH 那条路不同：页面走 HTTP，回执里的 Buffer 过一趟 JSON 就成了
 * `{ type:'Buffer', data:[…] }`，打标引擎要的是真字节。这里认那两种包法，也认数组。
 * @param {*} 值
 */
function 还原字节(值) {
  if (Buffer.isBuffer(值)) return 值;
  if (值 instanceof Uint8Array) return Buffer.from(值);
  if (Array.isArray(值)) return Buffer.from(值);
  if (值 && typeof 值 === 'object' && Array.isArray(值.data)) return Buffer.from(值.data);
  return 值;
}

/** 令牌：这次启动现生成，控制台一份、页面一份。 */
const 令牌 = crypto.randomBytes(16).toString('hex');

/** 命令行：--端口 / --项目根。 */
function 读命令行(argv) {
  const 出 = { 端口: 8791, 项目根: 默认项目根 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--端口' && argv[i + 1]) 出.端口 = Number(argv[i + 1]) || 出.端口;
    if (argv[i] === '--项目根' && argv[i + 1]) 出.项目根 = path.resolve(argv[i + 1]);
  }
  return 出;
}

/**
 * 读配置：cordis.patch.yml 里 toolbox 那一段，位置换成本次的项目根。
 * 与工具那一侧同一份配置，不另写一份。
 */
function 读配置(项目根) {
  const 原 = fs.readFileSync(path.join(对接层目录, 'cordis.patch.yml'), 'utf8');
  const 条目 = yaml.load(原);
  const 一段 = Array.isArray(条目)
    ? 条目.filter((x) => x && x.insert).flatMap((x) => x.insert).find((x) => x && x.id === 'toolbox')
    : null;
  return { ...((一段 && 一段.config) || {}), 项目根 };
}

/**
 * 装模块。走对接层那一套：清单给位置与函数，工厂造门面。
 * 缺哪一件都记下来，不抛。
 * @returns {{ 门面: object, 动作表: Array, 装不上: Array }}
 */
function 装({ 项目根, 模型, 配置 }) {
  const 要 = createRequire(import.meta.url);
  const 清单 = 造模块清单({
    读元数据: 读PNG元数据,
    本地翻译引擎: 模型.译,
    本地识图引擎: 模型.打标,
    看图: null,
    AI翻译: null,
  });

  const 门面 = {};
  const 装不上 = [];
  for (const 一个 of 清单) {
    try {
      const 出 = 要(path.join(项目根, 一个.门面));
      const 工厂 = 出[一个.工厂];
      if (typeof 工厂 !== 'function') throw new Error(`${一个.门面} 里没有 ${一个.工厂}`);
      门面[一个.名字] = 工厂(一个.选项(项目根, 配置, 门面));
    } catch (错) {
      装不上.push({ 模块: 一个.名字, 理由: String((错 && 错.message) || 错) });
    }
  }

  try {
    const 出 = 要(path.join(项目根, 主AI.门面));
    const 工厂 = 出[主AI.工厂];
    if (typeof 工厂 !== 'function') throw new Error(`${主AI.门面} 里没有 ${主AI.工厂}`);
    门面.主AI = 工厂({
      根目录: path.resolve(项目根, 配置.用户目录),
      默认目录: path.resolve(项目根, 配置.默认目录),
      模块动作: () => 清单
        .filter((一) => 门面[一.名字])
        .map((一) => ({
          名字: 一.名字,
          动作: 门面[一.名字].describe().map((一条) => ({ ...一条 })),
        })),
    });
  } catch (错) {
    装不上.push({ 模块: '主AI', 理由: String((错 && 错.message) || 错) });
  }

  const 动作表 = [];
  for (const [模块, 门] of Object.entries(门面)) {
    for (const 一条 of 门.describe()) 动作表.push({ ...一条, 模块 });
  }

  return { 门面, 动作表, 装不上, 模型 };
}

/**
 * 调一个动作。回执的拆法与登记工具那一条相同：
 * 失败给回执本身；`{ ok:true, data }` 给 data；其余原样。
 */
async function 调({ 门面, 模块, 动作, 参数 }) {
  const 门 = 门面[模块];
  if (!门) return { ok: false, reason: `没有「${模块}」这个模块`, code: 'BROWSER_NO_SUCH_MODULE' };
  if (!门.actions.includes(动作)) return { ok: false, reason: `「${模块}」没有「${动作}」这个动作`, code: 'BROWSER_NO_SUCH_ACTION' };
  const 回 = await 门.run(动作, 参数 && typeof 参数 === 'object' ? 参数 : {});
  if (!回 || typeof 回 !== 'object') return 回 === undefined ? null : 回;
  if (回.ok === false) return 回;
  return 回.ok === true && 'data' in 回 ? 回.data : 回;
}

/** 读整个请求体。 */
function 读体(req) {
  return new Promise((接, 拒) => {
    const 块们 = [];
    req.on('data', (块) => 块们.push(块));
    req.on('end', () => 接(Buffer.concat(块们).toString('utf8')));
    req.on('error', 拒);
  });
}

/** JSON 回一声。 */
function 说JSON(res, 状态, 东西) {
  const 体 = Buffer.from(JSON.stringify(东西), 'utf8');
  res.writeHead(状态, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': 体.length });
  res.end(体);
}

/**
 * 起服务。
 * @param {{端口:number, 项目根:string}} 选项
 */
export function 起({ 端口, 项目根 }) {
  const 原配置 = 读配置(项目根);
  const 存储 = 造存储({ 项目根, 数据目录: 原配置.数据目录 || '' });
  const 设置 = 存储.读设置();
  const 配置 = {
    ...原配置,
    ...存储.配置,
    识图模型: 设置.识图模型 ?? 原配置.识图模型,
    翻译模型: 设置.翻译模型 ?? 原配置.翻译模型,
  };
  const 模型 = 造本地模型({
    项目根,
    配置,
    onChange: (类别, id) => 存储.写设置({ [类别 === 'vision' ? '识图模型' : '翻译模型']: id }),
  });
  const { 门面, 动作表, 装不上 } = 装({ 项目根, 模型, 配置 });

  const 服务 = http.createServer(async (req, res) => {
    try {
      const 原路 = String(req.url || '/').split('?')[0];
      let 路 = 原路;
      try { 路 = decodeURIComponent(原路); } catch (_) { /* 解不开就按原文 */ }

      if (路 === '/' && req.method === 'GET') {
        const 文本 = fs.readFileSync(path.join(页目录, 页['/'].文件), 'utf8')
          .replace('/*令牌*/null', JSON.stringify(令牌));
        const 体 = Buffer.from(文本, 'utf8');
        res.writeHead(200, { 'Content-Type': 页['/'].类型, 'Content-Length': 体.length });
        res.end(体);
        return;
      }

      if (路 === '/页.js' || 路 === '/页.css') {
        const 体 = fs.readFileSync(path.join(页目录, 页[路].文件));
        res.writeHead(200, { 'Content-Type': 页[路].类型, 'Content-Length': 体.length });
        res.end(体);
        return;
      }

      if (路 === '/toolbox/桌' || 路 === '/toolbox/调' || 路 === '/toolbox/模型') {
        if (req.method !== 'POST') { 说JSON(res, 405, { ok: false, reason: '只收 POST', code: 'BROWSER_METHOD' }); return; }
        if (req.headers['x-toolbox-token'] !== 令牌) { 说JSON(res, 403, { ok: false, reason: '令牌不对', code: 'BROWSER_TOKEN' }); return; }

        let 体 = {};
        try {
          const 原 = await 读体(req);
          体 = 原 ? JSON.parse(原) : {};
        } catch (错) {
          说JSON(res, 400, { ok: false, reason: `请求体不是 JSON：${String((错 && 错.message) || 错)}`, code: 'BROWSER_BAD_BODY' });
          return;
        }

        if (路 === '/toolbox/桌') { 说JSON(res, 200, { 动作表, 装不上, 项目根, 模型: 模型.列() }); return; }

        if (路 === '/toolbox/模型') {
          // `换` 说用哪一格；不说就当"看一眼现在装着什么"。
          说JSON(res, 200, 体.换 ? await 模型.换(体.换.类别, 体.换.id) : { ok: true, data: 模型.列() });
          return;
        }

        let 回;
        try {
          回 = await 调({ 门面, 模块: String(体.模块 || ''), 动作: String(体.动作 || ''), 参数: 体.参数 });
        } catch (错) {
          回 = { ok: false, reason: String((错 && 错.message) || 错), code: 'BROWSER_CALL_THREW' };
        }
        说JSON(res, 200, 回 === undefined ? null : 回);
        return;
      }

      说JSON(res, 404, { ok: false, reason: `没有这条路：${路}`, code: 'BROWSER_NO_ROUTE' });
    } catch (错) {
      说JSON(res, 500, { ok: false, reason: String((错 && 错.message) || 错), code: 'BROWSER_SERVER' });
    }
  });

  服务.listen(端口, '127.0.0.1', () => {
    console.log('动作浏览器起来了。');
    console.log(`  页面    http://127.0.0.1:${端口}/`);
    console.log(`  令牌    ${令牌}`);
    console.log(`  项目根  ${项目根}`);
    console.log(`  动作    ${动作表.length} 条 · 模块 ${Object.keys(门面).length} 个`);
    if (装不上.length) for (const 一 of 装不上) console.log(`  装不上  ${一.模块}：${一.理由}`);
    const 装着的 = 模型.列();
    console.log(`  模型    识图 ${装着的.这次用.vision || '（没有）'} · 翻译 ${装着的.这次用.translation || '（没有）'}`);
    for (const 类 of ['vision', 'translation']) {
      for (const 一 of 装着的[类]) console.log(`          ${类}/${一.id}  ${一.名字}  ${一.装好了 ? '装好了' : '缺：' + 一.缺什么.join('；')}${一.这次用 ? '  ← 这次用这个' : ''}`);
    }
    console.log('DSH 的模型调用没接：识图的「看图」与装订的「装订」会如实报缺。');
    console.log('页面上能换模型（跑着换，不用重起）。');
  });

  return 服务;
}

起(读命令行(process.argv.slice(2)));
