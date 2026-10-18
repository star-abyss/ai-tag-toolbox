// 对话桥：把 DSH 的会话与 Agent 开给工具箱页面的那一小块 HTTP。
//
// 它解决一件事：**页面上那个「助手页」要能真说话**。DSH 的会话、Agent、工具循环
// 都在 DSH 进程里，而页面在浏览器里、由界面服务（另一个 node 进程）送出，所以中间
// 需要一条本机 HTTP。这一份就是那条 HTTP 的宿主侧。
//
// 它只做四件事：
//   ① 把「现在有哪些对话、这条对话里有什么」整理成页面要的形状交出去
//   ② 把用户敲的一句话送进会话（`followup` / `steer`）
//   ③ 停（`cancel`）
//   ④ 有变化就通过 SSE 说一声「变了」
//
// 它**不**碰 DSH 的包：会话与 Agent 都从 `ctx` 上取（`ctx.agents` / `ctx.sessions`），
// 只读它们的公开形状。理由与决定 44 同源——插件目录里出现第二份 `@deepseek-ai/*`
// 会让 `Symbol()` 与单例错位。
//
// ─────────────────────────────────────────────────────────────────
// 地址与令牌
//
// 绑 `127.0.0.1` 上一个端口，**启动时现生成一个令牌**，并把两者写进
// 工具箱数据目录下的 `对话桥.json`。界面服务读那一份，用它代理页面的请求。
// 端口先按配置给的试，被占就顺延（同一台机器上可能有好几个 DSH 进程）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 本层的错误码。 */
export const ERR = Object.freeze({
  NO_BRIDGE: 'CHAT_NO_BRIDGE',
  BAD_TOKEN: 'CHAT_BAD_TOKEN',
  NO_SUCH_SESSION: 'CHAT_NO_SUCH_SESSION',
  NO_AGENT: 'CHAT_NO_AGENT',
  BAD_BODY: 'CHAT_BAD_BODY',
  NO_ROUTE: 'CHAT_NO_ROUTE',
  NO_TEXT: 'CHAT_NO_TEXT',
});

/** 一页消息最多装多少条（只影响交出去的那一份，不影响会话本身）。 */
const 消息上限 = 500;

/** 问候式取标题：第一条用户消息的首行。 */
function 取标题(消息们) {
  for (const 一 of 消息们) {
    if (一 && 一.role === 'user' && 一.text) {
      const 首行 = String(一.text).split(/\r?\n/)[0].trim();
      if (首行) return 首行.length > 40 ? `${首行.slice(0, 39)}…` : 首行;
    }
  }
  return '新对话';
}

/** DSH 的消息块 → 一段正文 / 一段推理。只认文本块，别的块原样跳过。 */
function 拼文本(块们) {
  const 出 = { text: '', reasoning: '' };
  for (const 块 of Array.isArray(块们) ? 块们 : []) {
    if (!块 || typeof 块 !== 'object') continue;
    if (块.type === 'text' && typeof 块.text === 'string') 出.text += 块.text;
    else if (块.type === 'reasoning' && typeof 块.text === 'string') 出.reasoning += 块.text;
  }
  return 出;
}

/** 一个工具调用块 → 页面那一层画轨迹行要的形状。 */
function 认工具块(块) {
  const 名 = String(块?.name || 块?.toolName || '工具');
  const 参 = 块?.arguments ?? 块?.input ?? null;
  return {
    id: String(块?.id || 块?.toolCallId || 名),
    name: 名,
    status: 'complete',
    args: 参 === null || 参 === undefined ? '' : (typeof 参 === 'string' ? 参 : JSON.stringify(参)),
    result: '',
  };
}

/**
 * 一个会话 → 页面那一层要的会话形状。
 *
 * `messages` 是 `session.deriveMessages()` 交出来的那一份（与模型看见的历史同源），
 * 只丢掉系统与开发者消息——它们不是"对话"。
 *
 * @param {object} 会话 DSH 的 `Session`
 * @param {object} [选项]
 * @param {boolean} [选项.在跑]
 * @param {number} [选项.建的]
 * @returns {object}
 */
export function 造一条会话(会话, { 在跑 = false, 建的 = 0 } = {}) {
  const 原始 = typeof 会话?.deriveMessages === 'function' ? 会话.deriveMessages() : [];
  const 消息 = [];
  const 工具账 = new Map();
  for (const 一 of Array.isArray(原始) ? 原始 : []) {
    const 角色 = String(一?.role || '');
    if (角色 === 'system' || 角色 === 'developer') continue;
    if (角色 === 'tool') {
      const 条 = 工具账.get(String(一.toolCallId || ''));
      if (条) 条.result = String(拼文本(一.content).text || (一.isError ? '（失败）' : ''));
      continue;
    }
    const { text, reasoning } = 拼文本(一?.content);
    const 工具们 = [];
    for (const 块 of Array.isArray(一?.content) ? 一.content : []) {
      if (块 && typeof 块 === 'object' && (块.type === 'tool-call' || 块.type === 'tool_call')) {
        const 工具 = 认工具块(块);
        工具账.set(工具.id, 工具);
        工具们.push(工具);
      }
    }
    const 图 = [];
    for (const 块 of Array.isArray(一?.content) ? 一.content : []) {
      if (块 && typeof 块 === 'object' && 块.type === 'image' && 块.imageId) 图.push(String(块.imageId));
    }
    if (!text && !reasoning && !工具们.length && !图.length) continue;
    消息.push({
      id: String(一?.id || `m${消息.length}`),
      role: 角色 === 'user' ? 'user' : 'assistant',
      text,
      reasoning,
      status: 'complete',
      toolCalls: 工具们,
      imageIds: 图,
      createdAt: 0,
    });
  }
  const 尾 = 消息[消息.length - 1];
  if (尾 && 在跑 && 尾.role === 'assistant') 尾.status = 'streaming';
  const 切 = 消息.length > 消息上限 ? 消息.slice(消息.length - 消息上限) : 消息;
  return {
    id: String(会话?.id || ''),
    title: 取标题(切),
    messages: 切,
    updatedAt: 建的,
    running: 在跑,
  };
}

/**
 * 起一条对话桥。
 *
 * @param {object} 选项
 * @param {object} 选项.ctx DSH 的上下文（要用 `ctx.agents` 与 `ctx.sessions`）
 * @param {number} 选项.端口 想绑的端口；被占就顺延
 * @param {string} 选项.存档 发现文件写到哪（界面服务读它）
 * @param {string} [选项.模型] 这次对话用哪个模型（不写 = 用 DSH 的 agent 默认）
 * @param {string} [选项.provider] 这次对话走哪条 provider 路由（同上）
 * @param {boolean} [选项.挂住] 起了桥之后不许进程退出（只给实测用：DSH 跑完一轮就退，
 *   而实测要趁它活着的时候从桥那一侧说话）
 * @returns {Promise<object>} `{ 端口, 令牌, 停 }`
 */
export async function 起对话桥({ ctx, 端口 = 8791, 存档, 模型 = '', provider = '', 挂住 = false }) {
  const 令牌 = crypto.randomBytes(16).toString('hex');
  /** 每个会话建的时间（DSH 的会话头不带这个，页面要拿它排序）。 */
  const 建的时间 = new Map();
  /** 本进程建出来的 Agent 句柄：`dispose()` 要按会话收。 */
  const 我建的 = new Map();
  let 版本 = 1;
  const 订阅者 = new Set();

  const 会话库 = ctx.sessions;
  const 代理 = ctx.agents;

  /** 会话是不是在跑。 */
  const 在跑吗 = (id) => {
    try { return 代理.get(id)?.status === 'running'; } catch { return false; }
  };

  /** 这个会话的 Agent；没有就从盘上恢复。 */
  async function 要代理(id) {
    const 现成 = 代理.get(id);
    if (现成) return 现成;
    const 会话 = 会话库.get(id);
    if (!会话) return null;
    const 句柄 = await 代理.resume({
      resumeSessionId: id,
      ...(provider || 模型 ? { agentOptions: { ...(provider ? { provider } : {}), ...(模型 ? { model: 模型 } : {}) } } : {}),
    });
    我建的.set(id, 句柄);
    if (!建的时间.has(id)) 建的时间.set(id, Date.now());
    return 句柄.agent;
  }

  /** 现在有哪些对话（活的 Agent 都在里头）。 */
  function 列() {
    const 出 = [];
    for (const 代理一 of 代理.roots()) {
      const 会话 = 代理一?.session;
      if (!会话) continue;
      const id = String(会话.id || '');
      if (!建的时间.has(id)) 建的时间.set(id, Date.now());
      出.push(造一条会话(会话, { 在跑: 代理一.status === 'running', 建的: 建的时间.get(id) }));
    }
    return 出;
  }

  /** 一份完整状态：页面每次拿到的就是它。 */
  function 状态(当前) {
    const 会话们 = 列();
    const id = 当前 && 会话们.some((一) => 一.id === 当前) ? 当前 : (会话们[0]?.id || '');
    return {
      ok: true,
      版本,
      当前: id,
      会话: 会话们,
      在跑: Boolean(id) && 在跑吗(id),
    };
  }

  /** 有变化：版本加一，叫醒每一条 SSE。 */
  function 变了() {
    版本 += 1;
    for (const 写 of 订阅者) { try { 写(); } catch (_) { /* 对面走了 */ } }
  }

  // ---------- HTTP ----------

  const 说JSON = (res, 状态码, 东西, 头 = {}) => {
    const 体 = Buffer.from(JSON.stringify(东西 === undefined ? null : 东西), 'utf8');
    res.writeHead(状态码, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': 体.length,
      'Cache-Control': 'no-store',
      ...头,
    });
    res.end(体);
  };
  const 说错 = (res, 状态码, 码, 话) => 说JSON(res, 状态码, { ok: false, code: 码, reason: 话 });

  function 读体(req) {
    return new Promise((接, 拒) => {
      const 块们 = [];
      let 长 = 0;
      req.on('data', (块) => {
        长 += 块.length;
        if (长 > 8 * 1024 * 1024) { 拒(new Error('请求体太大')); req.destroy(); return; }
        块们.push(块);
      });
      req.on('end', () => 接(Buffer.concat(块们).toString('utf8')));
      req.on('error', 拒);
    });
  }

  const 服务 = http.createServer(async (req, res) => {
    const 查 = new URL(String(req.url || '/'), 'http://127.0.0.1');
    // 路名里带中文，浏览器发出来的是百分号编码的：先解回来再比。
    const 原路 = 查.pathname;
    let 路 = 原路;
    try { 路 = decodeURIComponent(原路); } catch (_) { /* 解不开就按原文 */ }
    try {
      if (req.headers['x-toolbox-token'] !== 令牌) { 说错(res, 403, ERR.BAD_TOKEN, '令牌不对'); return; }

      // ---- 状态 ----
      if (req.method === 'POST' && 路 === '/对话/状态') {
        let 体 = {};
        try { 体 = JSON.parse((await 读体(req)) || '{}'); } catch (_) { 体 = {}; }
        说JSON(res, 200, 状态(String(查.searchParams.get('当前') || 体.当前 || '')));
        return;
      }

      // ---- 新对话 ----
      if (req.method === 'POST' && 路 === '/对话/新') {
        const id = crypto.randomUUID();
        建的时间.set(id, Date.now());
        const 句柄 = await 代理.create({
          sessionId: id,
          ...(provider || 模型 ? { agentOptions: { ...(provider ? { provider } : {}), ...(模型 ? { model: 模型 } : {}) } } : {}),
        });
        我建的.set(id, 句柄);
        变了();
        说JSON(res, 200, 状态(id));
        return;
      }

      // ---- 发一句话 ----
      if (req.method === 'POST' && 路 === '/对话/发') {
        let 体 = {};
        try { 体 = JSON.parse((await 读体(req)) || '{}'); } catch (错) {
          说错(res, 400, ERR.BAD_BODY, `请求体不是 JSON：${String(错 && 错.message)}`);
          return;
        }
        const 话 = String(体.话 || '').trim();
        if (!话) { 说错(res, 400, ERR.NO_TEXT, '这一趟没带话'); return; }
        // 会话：请求体说用哪条，其次看"我现在在看哪一条"；都没有就先开一条
        // ——页面上的第一次发送不需要先点「新对话」。
        let id = String(体.会话 || 查.searchParams.get('当前') || '');
        if (!id) {
          id = crypto.randomUUID();
          建的时间.set(id, Date.now());
          我建的.set(id, await 代理.create({
            sessionId: id,
            ...(provider || 模型 ? { agentOptions: { ...(provider ? { provider } : {}), ...(模型 ? { model: 模型 } : {}) } } : {}),
          }));
        }
        const 代理一 = await 要代理(id);
        if (!代理一) { 说错(res, 404, ERR.NO_SUCH_SESSION, `没有这条对话：${id}`); return; }
        // 消息形状照 DSH 的 `UserMessage`：内容块 + 来源。`id` 由 DSH 自己发。
        const 消息 = { role: 'user', content: [{ type: 'text', text: 话 }], source: { kind: 'user', plugin: 'toolbox' } };
        if (体.方式 === 'steer') 代理一.steer(消息); else 代理一.followup(消息);
        变了();
        说JSON(res, 200, { ok: true, 会话: id });
        return;
      }

      // ---- 停 ----
      if (req.method === 'POST' && 路 === '/对话/停') {
        let 体 = {};
        try { 体 = JSON.parse((await 读体(req)) || '{}'); } catch (_) { 体 = {}; }
        const 代理一 = 代理.get(String(体.会话 || ''));
        if (代理一) 代理一.cancel({ kind: 'user' });
        变了();
        说JSON(res, 200, { ok: true });
        return;
      }

      // ---- 删 ----
      // 名字不单独存：一条对话的标题就是它第一条用户消息（见 `取标题`）。
      if (req.method === 'POST' && 路 === '/对话/删') {
        let 体 = {};
        try { 体 = JSON.parse((await 读体(req)) || '{}'); } catch (_) { 体 = {}; }
        const id = String(体.会话 || '');
        const 句柄 = 我建的.get(id);
        我建的.delete(id);
        建的时间.delete(id);
        if (句柄) await 句柄.dispose();
        变了();
        说JSON(res, 200, { ok: true });
        return;
      }

      // ---- 事件流：只报「变了」，页面回来取状态 ----
      if (req.method === 'GET' && 路 === '/对话/流') {
        const 当前 = String(查.searchParams.get('当前') || '');
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        let 上次 = 0;
        const 写 = () => {
          if (版本 === 上次) return;
          上次 = 版本;
          try { res.write(`data: ${JSON.stringify(状态(当前))}\n\n`); } catch (_) { /* 对面走了 */ }
        };
        订阅者.add(写);
        写();
        // 心跳：闲着的流别被系统当死连接掐掉。
        const 滴 = setInterval(() => { try { res.write(': 心跳\n\n'); } catch (_) { /* 对面走了 */ } }, 15000);
        const 收 = () => { clearInterval(滴); 订阅者.delete(写); try { res.end(); } catch (_) { /* 已经断了 */ } };
        req.on('close', 收);
        req.on('error', 收);
        return;
      }

      说错(res, 404, ERR.NO_ROUTE, `没有这条路：${路}`);
    } catch (错) {
      说JSON(res, 500, { ok: false, code: 'CHAT_SERVER', reason: String((错 && 错.message) || 错) });
    }
  });

  // 会话能跑很久，别让 Node 的连接超时先把那条流掐了。
  服务.timeout = 0;
  服务.requestTimeout = 0;
  服务.headersTimeout = 0;
  服务.keepAliveTimeout = 65 * 1000;

  /** 绑端口：被占就顺延，最多试十次。 */
  const 绑上 = (想) => new Promise((接, 拒) => {
    let 试 = 0;
    const 一次 = () => {
      服务.once('error', (错) => {
        if (错 && 错.code === 'EADDRINUSE' && 试 < 10) { 试 += 1; 一次(); return; }
        拒(错);
      });
      服务.listen(想 + 试, '127.0.0.1', () => 接(想 + 试));
    };
    一次();
  });
  const 绑到的 = await 绑上(Math.max(1, Number(端口) || 8791));

  // 发现文件：界面服务读它才知道桥在哪、令牌是什么。
  if (存档) {
    const 目录 = path.dirname(存档);
    try { fs.mkdirSync(目录, { recursive: true }); } catch (_) { /* 目录已经在 */ }
    fs.writeFileSync(存档, `${JSON.stringify({ 端口: 绑到的, 令牌, 进程: process.pid }, null, 2)}\n`, 'utf8');
  }

  /** 收摊：关流、收 Agent、删发现文件。 */
  function 停() {
    for (const 句柄 of 我建的.values()) { try { 句柄.dispose(); } catch (_) { /* 已经收了 */ } }
    我建的.clear();
    for (const 写 of 订阅者) { try { 写(); } catch (_) { /* 对面走了 */ } }
    订阅者.clear();
    try { 服务.close(); } catch (_) { /* 已经关了 */ }
    if (存档) { try { fs.unlinkSync(存档); } catch (_) { /* 已经不在了 */ } }
  }

  /**
   * 挂住：只给实测用的一条 —— DSH 的活干完就退，而实测要趁桥还活着的时候说话。
   * 这条定时器不给它变量名，也没有清除路径：进程一退它自然没了。
   */
  if (挂住) setInterval(() => {}, 1 << 30);

  return { 端口: 绑到的, 令牌, 停, 状态, 变了 };
}

/** 界面服务那一侧：读发现文件。读不到就是"这一台机器上没有 DSH 在跑工具箱"。 */
export function 读对话桥(存档) {
  try {
    const 原 = JSON.parse(fs.readFileSync(存档, 'utf8'));
    if (!原 || !原.端口 || !原.令牌) return null;
    return { 端口: Number(原.端口), 令牌: String(原.令牌) };
  } catch (_) {
    return null;
  }
}
