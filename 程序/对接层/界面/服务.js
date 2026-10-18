// 界面层 · 宿主侧。一个本地 HTTP 服务：把八个模块的动作、原图字节、缩略图、长任务
// 一起开给浏览器里的界面。
//
//   node 界面/服务.js [--端口 8790] [--项目根 <路径>] [--数据目录 <路径>] [--开]
//
// 页面、动作、字节三条路都在这一份里；面板那一边只认识 /toolbox/* 这几个名字。
//
// 路由：
//   GET  /                 页面（令牌注在里面，同时下一次 Cookie）
//   GET  /页/*.js · *.css  前端那一堆（只有这几个名字服务，别的一律 404）
//   POST /toolbox/桌        模块 · 动作 · 参数（含控件形状）· 装不上 · 模型
//   POST /toolbox/调        { 模块, 动作, 参数 } → 该动作的回执
//   POST /toolbox/模型      看 / 换本地模型那一格
//   POST /toolbox/存储      读 / 设置个人数据目录
//   POST /toolbox/设置      读 / 写用户设置
//   POST /toolbox/链路      API 配置页那张链路表：{} 读 · { 存:[…] } 写
//   POST /toolbox/服务商    { 做什么:'列模型'|'探图'|'试一条', … } → 问服务商本人
//   POST /toolbox/任务      起一个长任务（出图这类）→ { id }
//   POST /toolbox/任务/看   { id, 从 } → 状态 + 新事件 + 回执
//   GET  /toolbox/任务/流   ?id=… SSE：模块报的状态一条条推
//   GET  /字节              ?条目ID=…&存放地=…&变体=… 原图字节
//   GET  /缩略图            ?条目ID=…&存放地=…&边长=… 现缩的缩略图
//   POST /存图              { 字节(dataUrl 或数字数组), 文件名, 存放地, … } → 引用
//   GET  /对话/流           SSE：会话门面的实例、版本与变化 ID
//
// 服务只绑 127.0.0.1。POST 要 `x-toolbox-token` 头；`<img>` 那两条 GET 靠
// 页面那次带下来的 HttpOnly Cookie（图片请求没法带头）。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { 造宿主 } from '../宿主.js';
import { 造字节路, 读引用, 洗文件名 } from './字节.js';
import { 造任务表 } from './任务.js';
import { 注令牌, 默认项目根 } from './配置.js';

const 本目录 = path.dirname(fileURLToPath(import.meta.url));
const 页目录 = path.join(本目录, '页');

/** 一次请求体最多多大。上传图那一趟是 base64 过的，所以给宽一点。 */
const 体上限 = { 默认: 8 * 1024 * 1024, 调: Infinity };

/** 令牌：这次启动现生成，页面一份、Cookie 一份。 */
const 令牌 = crypto.randomBytes(16).toString('hex');
const 令牌饼 = `tbx=${令牌}`;

/** 命令行：--端口 / --项目根 / --数据目录 / --开。 */
function 读命令行(argv) {
  const 出 = { 端口: 8790, 项目根: 默认项目根, 数据目录: '', 开: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--端口' && argv[i + 1]) 出.端口 = Number(argv[i + 1]) || 出.端口;
    if (argv[i] === '--项目根' && argv[i + 1]) 出.项目根 = path.resolve(argv[i + 1]);
    if (argv[i] === '--数据目录' && argv[i + 1]) 出.数据目录 = path.resolve(argv[i + 1]);
    if (argv[i] === '--开') 出.开 = true;
  }
  return 出;
}

/** 读整个请求体，超上限就掐。 */
function 读体(req, 上限) {
  return new Promise((接, 拒) => {
    const 块们 = [];
    let 长 = 0;
    req.on('data', (块) => {
      长 += 块.length;
      if (长 > 上限) {
        拒(new Error(`请求体超过 ${Math.round(上限 / 1024 / 1024)} MB`));
        req.destroy();
        return;
      }
      块们.push(块);
    });
    req.on('end', () => 接(Buffer.concat(块们).toString('utf8')));
    req.on('error', 拒);
  });
}

/** JSON 回一声。 */
function 说JSON(res, 状态, 东西, 头 = {}) {
  const 体 = Buffer.from(JSON.stringify(东西 === undefined ? null : 东西), 'utf8');
  res.writeHead(状态, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': 体.length,
    'Cache-Control': 'no-store',
    ...头,
  });
  res.end(体);
}

/** 从 Cookie 里取令牌。`<img>` 那条路用它。 */
function 饼里令牌(req) {
  const 原 = String(req.headers.cookie || '');
  for (const 一段 of 原.split(';')) {
    const [名, ...余] = 一段.trim().split('=');
    if (名 === 'tbx') return 余.join('=');
  }
  return '';
}

/**
 * 字节那一类响应：带 ETag 与长缓存。
 *
 * 条目 ID 是每次存图新生成的，所以同一串地址的内容不会变；
 * 但缩略图是现缩的，内容只由（条目 · 变体 · 边长）决定，也一样稳定。
 * ETag 取（条目 · 变体 · 现缩与否 · 字节数）：它只在内容真的换了之后才换。
 */
function 说字节(req, res, 出, 引用 = {}) {
  const 条 = (引用 && 引用.条目ID) || 出.标识 || '';
  const etag = `"${条}-${出.变体}-${出.现缩的 ? 't' : 'o'}-${出.字节.length}"`;
  const 头 = {
    'Content-Type': 出.mime || 'application/octet-stream',
    'Content-Length': 出.字节.length,
    'Cache-Control': 'private, max-age=31536000, immutable',
    ETag: etag,
    'X-Thumb': 出.现缩的 ? '1' : '0',
  };
  if (出.文件名) 头['Content-Disposition'] = `inline; filename*=UTF-8''${encodeURIComponent(洗文件名(出.文件名))}`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': 头['Cache-Control'] });
    res.end();
    return;
  }
  res.writeHead(200, 头);
  res.end(出.字节);
}

/** 一条没有实体的错，用 JSON 说清。 */
const 说错 = (res, 状态, 码, 话) => 说JSON(res, 状态, { ok: false, code: 码, reason: 话 });

/**
 * 起服务。
 * @param {{端口:number, 项目根:string, 数据目录?:string}} 选项
 *   数据目录 = 全部个人数据根目录
 */
export function 起({ 端口, 项目根, 数据目录 = '', 开 = false }) {
  const 宿主 = 造宿主({ 项目根, 数据目录 });
  const 字节路 = 造字节路(宿主);
  const 任务表 = 造任务表();
  const 服务商面 = 宿主.服务商;
  let 停机任务 = null;
  let 宿主关闭任务 = null;

  function 关宿主() {
    if (!宿主关闭任务) 宿主关闭任务 = 宿主.close();
    return 宿主关闭任务;
  }

  async function 停止() {
    if (停机任务) return 停机任务;
    停机任务 = (async () => {
      await 关宿主();
      if (服务.listening) {
        const 已关 = new Promise((完成) => 服务.close(完成));
        服务.closeAllConnections();
        await 已关;
      }
    })();
    return 停机任务;
  }

  const 服务 = http.createServer(async (req, res) => {
    const 原路 = String(req.url || '/').split('?')[0];
    let 路 = 原路;
    try { 路 = decodeURIComponent(原路); } catch (_) { /* 解不开就按原文 */ }
    const 查 = new URL(String(req.url || '/'), 'http://127.0.0.1');

    try {
      // ---------- 令牌：页面第一个脚本就问它要 ----------
      // 走同源脚本而不是内联，因为旧版那份页面自带 `script-src 'self'` 的 CSP。
      if (req.method === 'GET' && 路 === '/我们的令牌.js') {
        const 体 = Buffer.from(`window.__令牌__ = ${JSON.stringify(令牌)};\nwindow.__版本__ = ${JSON.stringify(宿主.版本)};\n`, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Content-Length': 体.length,
          'Cache-Control': 'no-cache',
        });
        res.end(体);
        return;
      }

      // ---------- 页面 ----------
      if (req.method === 'GET' && (路 === '/页/工具定义.js' || 路 === '/工具定义.js')) {
        const 体 = fs.readFileSync(path.join(本目录, '../工具定义.js'));
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': 体.length, 'Cache-Control': 'no-cache' });
        res.end(体); return;
      }
      if (req.method === 'GET' && !路.startsWith('/toolbox/') && !路.startsWith('/对话/') && 路 !== '/字节' && 路 !== '/缩略图') {
        // 两种写法都认：`/页/foo.js`（我们那份页面的绝对地址）与 `/foo.js`
        // （旧版那套裸相对地址）。路名一律当"页目录底下的相对路径"来解。
        const 相对 = (路 === '/' ? 'index.html' : 路.replace(/^\/页\//, '')).replace(/^\/+/, '');
        // 只服务页目录底下的东西：解出来的绝对路径必须真落在 页目录 里面。
        const 全 = path.resolve(页目录, 相对);
        if (全 !== 页目录 && !全.startsWith(页目录 + path.sep)) {
          说错(res, 404, 'UI_NO_ROUTE', `没有这条路：${路}`);
          return;
        }
        if (!fs.existsSync(全) || !fs.statSync(全).isFile()) {
          说错(res, 404, 'UI_NO_ROUTE', `没有这个文件：${路}`);
          return;
        }
        const 型 = 相对.endsWith('.css') ? 'text/css; charset=utf-8'
          : 相对.endsWith('.js') ? 'text/javascript; charset=utf-8'
            : 相对.endsWith('.json') ? 'application/json; charset=utf-8'
              : 相对.endsWith('.svg') ? 'image/svg+xml'
                : 'text/html; charset=utf-8';
        let 体 = fs.readFileSync(全);
        if (型.startsWith('text/html') || 型.startsWith('text/javascript')) {
          体 = Buffer.from(注令牌(体.toString('utf8'), 令牌), 'utf8');
        }
        res.writeHead(200, {
          'Content-Type': 型,
          'Content-Length': 体.length,
          // 前端那几份改动频繁，别让浏览器拿着旧的。
          'Cache-Control': 'no-cache',
          ...(相对.endsWith('.html') ? { 'Set-Cookie': `${令牌饼}; HttpOnly; SameSite=Strict; Path=/` } : {}),
        });
        res.end(体);
        return;
      }

      // ---------- 原图与缩略图：靠 Cookie 认令牌 ----------
      if (req.method === 'GET' && (路 === '/字节' || 路 === '/缩略图')) {
        if (饼里令牌(req) !== 令牌 && req.headers['x-toolbox-token'] !== 令牌) {
          说错(res, 403, 'UI_TOKEN', '令牌不对（图片这条路靠页面下的 Cookie）');
          return;
        }
        // `查` 是 URL，不是 URLSearchParams —— 参数要从 searchParams 上读。
        const 引用 = 读引用(查.searchParams);
        const 出 = 路 === '/字节'
          ? await 字节路.取字节(引用, 查.searchParams.get('变体'))
          : await 字节路.取缩略图(引用, 查.searchParams.get('边长'));
        if (!出.ok) { 说JSON(res, 200, 出); return; }
        说字节(req, res, 出, 引用);
        return;
      }

      // ---------- 存图：收 dataUrl / 数字数组，落进图片模块 ----------
      if (req.method === 'POST' && 路 === '/存图') {
        if (req.headers['x-toolbox-token'] !== 令牌) { 说错(res, 403, 'UI_TOKEN', '令牌不对'); return; }
        let 体 = {};
        try { 体 = JSON.parse(await 读体(req, 体上限.调)); } catch (错) {
          说错(res, 400, 'UI_BAD_BODY', `请求体不是 JSON：${String((错 && 错.message) || 错)}`);
          return;
        }
        const 字节 = 认输入字节(体.字节);
        if (!字节) { 说错(res, 400, 'UI_NO_BYTES', '这一趟没带字节'); return; }
        const 回 = await 宿主.调({
          模块: 'image',
          动作: '存',
          参数: {
            作用域: 体.作用域 || { 存放地: 体.存放地 || 'gallery' },
            字节,
            文件名: String(体.文件名 || '上传.png'),
            ...(体.mime ? { mime: String(体.mime) } : {}),
            ...(体.来源 ? { 来源: String(体.来源) } : {}),
            ...(体.显示名 ? { 显示名: String(体.显示名) } : {}),
          },
        });
        说JSON(res, 200, 回);
        return;
      }

      // 会话变化通知。
      if (路.startsWith('/对话/')) {
        if (req.method === 'GET' && 路 === '/对话/流') {
          if (饼里令牌(req) !== 令牌 && req.headers['x-toolbox-token'] !== 令牌) {
            说错(res, 403, 'UI_TOKEN', '令牌不对');
            return;
          }
          if (!宿主.门面.session) { 说错(res, 503, 'HOST_NO_SUCH_MODULE', '会话模块装不上'); return; }
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          const write = event => res.write(`data: ${JSON.stringify(event)}\n\n`);
          const off = 宿主.门面.session.subscribe(write);
          const list = 宿主.门面.session.run('列');
          if (list.ok) write({ 实例: list.data.实例, 版本: list.data.版本, 变更: list.data.会话.map(row => row.标识), 已删: [] });
          else write(list);
          const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
          res.once('close', () => { clearInterval(heartbeat); off(); });
          return;
        }
        说错(res, 404, 'UI_NO_ROUTE', `没有这条路：${路}`);
        return;
      }

      // ---------- /toolbox/* ----------
      if (路.startsWith('/toolbox/')) {
        if (req.method === 'GET' && 路 === '/toolbox/任务/流') {
          if (饼里令牌(req) !== 令牌 && req.headers['x-toolbox-token'] !== 令牌) {
            说错(res, 403, 'UI_TOKEN', '令牌不对');
            return;
          }
          开流(req, res, 查, 任务表);
          return;
        }
        if (req.method !== 'POST') { 说错(res, 405, 'UI_METHOD', '只收 POST'); return; }
        if (req.headers['x-toolbox-token'] !== 令牌) { 说错(res, 403, 'UI_TOKEN', '令牌不对'); return; }

        let 体 = {};
         try {
          const 原 = await 读体(req, 路 === '/toolbox/调' ? 体上限.调 : 体上限.默认);
          体 = 原 ? JSON.parse(原) : {};
        } catch (错) {
          说错(res, 400, 'UI_BAD_BODY', `请求体读不动：${String((错 && 错.message) || 错)}`);
          return;
        }

        if (路 === '/toolbox/桌') { 说JSON(res, 200, 宿主.桌()); return; }
        if (路 === '/toolbox/模型') {
          说JSON(res, 200, 体.换 ? await 宿主.换模型(体.换.类别, 体.换.id) : { ok: true, data: 宿主.列() });
          return;
        }
        if (路 === '/toolbox/存储') {
          const data = 体.数据目录 !== undefined ? await 宿主.存储.设置数据目录(体.数据目录) : 宿主.存储.读位置();
          说JSON(res, 200, { ok: true, data });
          return;
        }
        if (路 === '/toolbox/设置') {
          const data = 体.存 !== undefined ? await 宿主.写设置(体.存) : 宿主.读设置();
          说JSON(res, 200, { ok: true, data });
          return;
        }
        // ---------- 链路表：API 配置页填的那一份（密钥只进不出） ----------
        if (路 === '/toolbox/链路') {
          const 出 = 体.存 !== undefined ? 服务商面.写链路(体.存) : 服务商面.读链路();
          说JSON(res, 200, { ok: true, data: { 目录: 服务商面.目录, 状态: 服务商面.取链路状态(), ...页面上的链路(服务商面, 出) } });
          return;
        }
        // ---------- 服务商：模型清单 · 吃不吃图 · 通不通 ----------
        if (路 === '/toolbox/服务商') {
          const 做什么 = String(体.做什么 || '');
          const 地址 = String(体.地址 || '');
          const 密钥 = 服务商面.取密钥({ id: 体.id, 密钥: 体.密钥, 地址 });
          const 模型 = String(体.模型 || '');
          if (做什么 === '列模型') { 说JSON(res, 200, await 服务商面.列模型({ 地址, 密钥 })); return; }
          if (做什么 === '探图') { 说JSON(res, 200, await 服务商面.探图({ 地址, 密钥, 模型 })); return; }
          if (做什么 === '试一条') { 说JSON(res, 200, await 服务商面.试一条({ 地址, 密钥, 模型 })); return; }
          说错(res, 400, 'UI_BAD_ASK', `认不出的做法：${做什么}（列模型 / 探图 / 试一条）`);
          return;
        }
        if (路 === '/toolbox/调') {
          说JSON(res, 200, await 宿主.调({
            模块: String(体.模块 || ''),
            动作: String(体.动作 || ''),
            参数: 体.参数,
          }));
          return;
        }
        if (路 === '/toolbox/任务') {
          if (体.什么 !== '出图') { 说错(res, 400, 'UI_BAD_TASK', `认不出的任务：${体.什么}`); return; }
          // 出图是唯一那种能跑半小时的活：事件由模块报，任务表记着，页面随时回来看。
          const 一 = 任务表.起({
            什么: '出图',
            参数: 体.参数 || {},
            做: (报) => 宿主.调({
              模块: 'comfy',
              动作: '出图',
              参数: { ...(体.参数 || {}), onEvent: (事件) => 报(事件) },
            }),
          });
          说JSON(res, 200, { ok: true, id: 一.id });
          return;
        }
        if (路 === '/toolbox/任务/看') { 说JSON(res, 200, 任务表.看(String(体.id || ''), 体.从)); return; }
        if (路 === '/toolbox/任务/列') { 说JSON(res, 200, { ok: true, data: 任务表.列() }); return; }

        说错(res, 404, 'UI_NO_ROUTE', `没有这条路：${路}`);
        return;
      }

      说错(res, 404, 'UI_NO_ROUTE', `没有这条路：${路}`);
    } catch (错) {
      说JSON(res, 500, { ok: false, code: 'UI_SERVER', reason: String((错 && 错.message) || 错), 栈: String((错 && 错.stack) || '') });
    }
  });

  // 出图能跑半小时，别让 Node 的连接超时先把这条流掐了。
  服务.timeout = 0;
  服务.requestTimeout = 0;
  服务.headersTimeout = 0;
  服务.keepAliveTimeout = 65 * 1000;
  服务.once('close', () => {
    void 关宿主().catch(错 => console.error(`关闭宿主失败：${String((错 && 错.message) || 错)}`));
  });
  服务.宿主 = 宿主;
  服务.停止 = 停止;

  // 端口被占、没有权限绑：说清是哪一种，然后干净退出（不留一份半死的服务）。
  服务.on('error', (错) => {
    if (错 && 错.code === 'EADDRINUSE') {
      console.error(`端口 ${端口} 已经有一个在用了：这一台机器上多半已经跑着一份工具箱界面。`);
      console.error('  直接开那个地址就行；要再起一份就换一个端口：--端口 8791');
    } else {
      console.error(`起不来：${String((错 && 错.message) || 错)}`);
    }
    process.exit(1);
  });

  宿主.ready.then(() => 服务.listen(端口, '127.0.0.1', () => {
    const 桌 = 宿主.桌();
    console.log('工具箱界面起来了。');
    console.log(`  版本    V${宿主.版本}`);
    console.log(`  页面    http://127.0.0.1:${端口}/`);
    console.log(`  项目根  ${宿主.项目根}`);
    console.log(`  动作    ${桌.动作表.length} 条 · 模块 ${Object.keys(宿主.门面).length} 个`);
    console.log(`  存档    ${服务商面.目录}`);
    console.log('  退出    关闭此控制台窗口。');
    if (桌.装不上.length) for (const 一 of 桌.装不上) console.log(`  装不上  ${一.模块}：${一.理由}`);
    const 装着的 = 桌.模型;
    console.log(`  模型    识图 ${装着的.这次用.vision || '（没有）'} · 翻译 ${装着的.这次用.translation || '（没有）'}`);
    console.log('  助手    直接使用 API 链路表 · 预设工具表 · 世界书');
    if (开) {
      const 地址 = `http://127.0.0.1:${端口}/`;
      console.log(`  浏览器  ${地址}`);
      execFile('cmd.exe', ['/d', '/c', 'start', '', 地址], { windowsHide: true }, (错) => {
        if (错) console.error(`打开系统浏览器失败：${错.message}`);
      });
    }
    // 标签库第一次查库要建索引（半秒上下），起来先点一次。
    宿主.预热点().then(() => console.log('  标签库  索引已热')).catch(() => {});
  }));

  return 服务;
}

/**
 * 链路表 → 页面要的那一份。
 *
 * **密钥只进不出**：交出去的是"存没存过"，不是密钥本身。
 * 每一行另外带上"这个模型能不能看图"（问服务商问回来的，见 服务商.js）。
 *
 * @param {object} 服务商面 造服务商面() 交出来的那一份
 * @param {Array} 链路们 存档里那张表
 * @returns `{ 链路: [ { id, 名字, 地址, 模型, 上下文窗口, 密钥已存, 能看图, 理由, 依据 } ] }`
 */
function 页面上的链路(服务商面, 链路们) {
  return {
    链路: (Array.isArray(链路们) ? 链路们 : []).map((一) => {
      const 能力 = 服务商面.问能力(一.地址, 一.模型);
      return {
        id: 一.id,
        名字: 一.名字,
        地址: 一.地址,
        模型: 一.模型,
        上下文窗口: 一.上下文窗口,
        密钥已存: Boolean(一.密钥),
        能看图: 能力.能看图,
        理由: 能力.理由,
        依据: 能力.依据,
      };
    }),
  };
}

/** 输入字节：认 dataUrl、认 `{ type:'Buffer', data:[…] }`、认数组、认 base64 串。 */
function 认输入字节(值) {
  if (Buffer.isBuffer(值)) return 值;
  if (值 instanceof Uint8Array) return Buffer.from(值);
  if (Array.isArray(值)) return Buffer.from(值);
  if (值 && typeof 值 === 'object' && Array.isArray(值.data)) return Buffer.from(值.data);
  if (typeof 值 === 'string') {
    const 逗 = 值.indexOf(',');
    const 头 = 逗 >= 0 ? 值.slice(0, 逗) : '';
    const 正文 = 逗 >= 0 && /^data:/.test(头) ? 值.slice(逗 + 1) : 值;
    try { return Buffer.from(正文, 'base64'); } catch (_) { return null; }
  }
  return null;
}

/**
 * 任务的 SSE 流：先把手上已有的状态与事件补齐，之后模块报一条推一条。
 * 页面自己记着"我已经收到几条"，断线重连时用 `?从=` 接着要。
 */
function 开流(req, res, 查, 任务表) {
  const id = String(查.get('id') || '');
  const 从 = Math.max(0, Number(查.get('从')) || 0);
  const 现看 = 任务表.看(id, 从);
  if (!现看.ok) { 说错(res, 404, 现看.code, 现看.reason); return; }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const 写 = (东西) => { try { res.write(`data: ${JSON.stringify(东西)}\n\n`); } catch (_) { /* 对面走了 */ } };
  写({ 类型: '看一眼', ...现看.data });

  let 已收 = 现看.data.共几条事件;
  const 摘 = 任务表.挂(id, (记) => {
    if (记.完了) { 写({ 类型: '完了', ...任务表.看(id, 已收).data }); return; }
    已收 += 1;
    写({ 类型: '事件', 事件: 记 });
  });

  // 心跳：别让浏览器或系统把闲着的流当死连接掐掉。
  const 滴 = setInterval(() => { 写({ 类型: '心跳', 时间: Date.now() }); }, 15000);
  const 收 = () => { clearInterval(滴); 摘(); try { res.end(); } catch (_) { /* 已经断了 */ } };
  req.on('close', 收);
  req.on('error', 收);

  // 起流时那条任务可能已经做完了（页面来晚了），补一条。
  const 再看 = 任务表.看(id, 已收);
  if (再看.ok && 再看.data.状态 !== '跑着') 写({ 类型: '完了', ...再看.data });
}

// 直接跑这一份才起服务；被 import（自检、诊断脚本）时只交出 起 / 读命令行。
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const 选项 = 读命令行(process.argv.slice(2));
  const 服务 = 起(选项);
  const 退出 = async () => { await 服务.停止(); process.exit(0); };
  process.once('SIGINT', 退出);
  process.once('SIGTERM', 退出);
  process.once('SIGHUP', 退出);
}

export { 读命令行, 令牌 as 这次启动的令牌 };
