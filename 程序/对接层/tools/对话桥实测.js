// 对话桥的实测：真起 HTTP，真发请求，真读发现文件。
//
// 用法：node tools/对话桥实测.js [--端口 8791]
//
// 它拿一份**假的 DSH 上下文**（`{ agents, sessions }` 各几个方法）跑真桥，
// 验的是桥自己那一层：路名 · 令牌 · 形状 · 发现文件 · SSE。**不碰模型**，
// 所以不需要密钥，也不会花掉一次调用。
//
// 真跑一轮对话（模型真回话）是另一回事：那要一个装好本插件的 DSH profile，
// 见 `对接层/README.md` 的"对话桥怎么验"。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { 起对话桥, 读对话桥, 造一条会话 } from '../对话桥.js';

let 过了 = 0;
const 崩了 = [];
function 判(话, 条件, 说明 = '') {
  if (条件) { 过了 += 1; console.log(`  ✓ ${话}${说明 ? `（${说明}）` : ''}`); return true; }
  崩了.push(话 + (说明 ? `（${说明}）` : ''));
  console.log(`  ✗ ${话}${说明 ? `（${说明}）` : ''}`);
  return false;
}

/** 一条假会话：`deriveMessages()` 交回喂进去的那份。 */
function 假会话(id, 消息们 = []) {
  return { id, deriveMessages: () => 消息们 };
}

/** 一个假 Agent：记着被怎么驱动过。 */
function 假代理(会话) {
  return {
    id: 会话.id,
    session: 会话,
    status: 'idle',
    收到的: [],
    followup(消息) { this.收到的.push({ 怎么: 'followup', 消息 }); },
    steer(消息) { this.收到的.push({ 怎么: 'steer', 消息 }); },
    cancel(原因) { this.收到的.push({ 怎么: 'cancel', 原因 }); },
  };
}

/** 一份够用的假 DSH 上下文。 */
function 造假上下文() {
  const 会话们 = new Map();
  const 代理们 = new Map();
  const 新代理 = new Map();
  return {
    会话们,
    代理们,
    新代理,
    ctx: {
      sessions: { get: (id) => 会话们.get(id) },
      agents: {
        get: (id) => 代理们.get(id),
        roots: () => [...代理们.values()],
        create: async ({ sessionId }) => {
          const 会话 = 假会话(sessionId);
          会话们.set(sessionId, 会话);
          const 代理 = 假代理(会话);
          代理们.set(sessionId, 代理);
          新代理.set(sessionId, 代理);
          return { agent: 代理, dispose: async () => {} };
        },
        resume: async ({ resumeSessionId }) => {
          const 会话 = 会话们.get(resumeSessionId);
          if (!会话) throw new Error(`没有这条会话：${resumeSessionId}`);
          const 代理 = 假代理(会话);
          代理们.set(resumeSessionId, 代理);
          return { agent: 代理, dispose: async () => {} };
        },
      },
    },
  };
}

/** 请一次桥。 */
async function 请(基, 令牌, 路, { 方法 = 'POST', 体 } = {}) {
  const 回 = await fetch(`${基}${路}`, {
    method: 方法,
    headers: { 'x-toolbox-token': 令牌, ...(体 ? { 'Content-Type': 'application/json' } : {}) },
    ...(体 ? { body: JSON.stringify(体) } : {}),
  });
  const 文 = await 回.text();
  try { return { 状态: 回.status, 体: JSON.parse(文) }; } catch (_) { return { 状态: 回.status, 文 }; }
}

const 歇 = (毫秒) => new Promise((成) => setTimeout(成, 毫秒));

async function 主() {
  console.log('一、起桥');
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), '对话桥-'));
  const 存档 = path.join(目录, '对话桥.json');
  const { ctx, 会话们, 代理们, 新代理 } = 造假上下文();
  const 端口 = Number(process.argv[process.argv.indexOf('--端口') + 1]) || 8891;
  const 桥 = await 起对话桥({ ctx, 端口, 存档 });
  const 基 = `http://127.0.0.1:${桥.端口}`;
  判('桥起来了', typeof 桥.端口 === 'number' && 桥.端口 > 0, `端口 ${桥.端口}`);

  console.log('\n二、发现文件');
  const 读到的 = 读对话桥(存档);
  判('发现文件写出来了', fs.existsSync(存档));
  判('读得到端口与令牌', 读到的 && 读到的.端口 === 桥.端口 && 读到的.令牌 === 桥.令牌);
  判('读不到时给 null', 读对话桥(path.join(目录, '不存在.json')) === null);

  console.log('\n三、令牌');
  const 没令牌 = await fetch(`${基}/对话/状态`, { method: 'POST' });
  判('没有令牌进不来', 没令牌.status === 403, `HTTP ${没令牌.status}`);
  const 错令牌 = await 请(基, 'wrong-token', '/对话/状态');
  判('令牌不对进不来', 错令牌.状态 === 403 && 错令牌.体.code === 'CHAT_BAD_TOKEN');

  console.log('\n四、空着的时候');
  const 空 = await 请(基, 桥.令牌, '/对话/状态');
  console.log(`  · 空状态原样：${JSON.stringify(空)}`);
  判('空状态也有一份形状', 空.体.ok === true && Array.isArray(空.体.会话) && 空.体.会话.length === 0);
  判('空着时没有当前', 空.体.当前 === '' && 空.体.在跑 === false);

  console.log('\n五、新对话');
  const 新 = await 请(基, 桥.令牌, '/对话/新');
  判('开出一条新对话', 新.体.ok === true && 新.体.会话.length === 1, `id ${String(新.体.当前).slice(0, 8)}…`);
  判('当前就是新的那条', 新.体.当前 === 新.体.会话[0].id);
  判('新会话没有消息', 新.体.会话[0].messages.length === 0);
  判('新会话标题是「新对话」', 新.体.会话[0].title === '新对话');
  判('DSH 那边真建了 Agent', 新代理.has(新.体.当前));

  console.log('\n六、发一句话');
  const 会话id = 新.体.当前;
  const 空话 = await 请(基, 桥.令牌, '/对话/发', { 体: { 话: '   ' } });
  判('空话不进会话', 空话.体.ok === false && 空话.体.code === 'CHAT_NO_TEXT');
  const 发了 = await 请(基, 桥.令牌, '/对话/发', { 体: { 会话: 会话id, 话: '你好' } });
  判('发出去了', 发了.体.ok === true, `会话 ${String(发了.体.会话).slice(0, 8)}…`);
  const 代理 = 代理们.get(会话id);
  判('走的是 followup', 代理.收到的[0]?.怎么 === 'followup');
  判('消息形状是 UserMessage', 代理.收到的[0]?.消息.role === 'user'
    && 代理.收到的[0]?.消息.content[0].text === '你好'
    && 代理.收到的[0]?.消息.source.kind === 'user');

  console.log('\n七、插队与停');
  await 请(基, 桥.令牌, '/对话/发', { 体: { 会话: 会话id, 话: '插一句', 方式: 'steer' } });
  判('steer 走的是 steer', 代理.收到的.some((一) => 一.怎么 === 'steer'));
  const 停了 = await 请(基, 桥.令牌, '/对话/停', { 体: { 会话: 会话id } });
  判('停得掉', 停了.体.ok === true && 代理.收到的.some((一) => 一.怎么 === 'cancel'));

  console.log('\n八、没有说话时也发得出去（自动开一条）');
  const 直接发 = await 请(基, 桥.令牌, '/对话/发', { 体: { 会话: '', 话: '第一句' } });
  判('没会话时自己开一条', 直接发.体.ok === true && 直接发.体.会话);
  判('那条会话真被建了', 会话们.has(直接发.体.会话));

  console.log('\n九、把会话画成页面要的形状');
  const 画 = 造一条会话(假会话('x', [
    { id: 'm1', role: 'system', content: [{ type: 'text', text: '系统提示词' }] },
    { id: 'm2', role: 'user', content: [{ type: 'text', text: '帮我画一只猫' }] },
    { id: 'm3', role: 'assistant', content: [
      { type: 'reasoning', text: '先想一下' },
      { type: 'tool-call', id: 't1', name: 'tag_query', arguments: { 串: 'cat' } },
      { type: 'text', text: '好' },
    ] },
    { id: 'm4', role: 'tool', toolCallId: 't1', content: [{ type: 'text', text: '{"候选":[]}' }] },
  ]), { 在跑: true, 建的: 123 });
  判('丢掉系统消息', !画.messages.some((一) => 一.text === '系统提示词'));
  判('标题取第一条用户消息', 画.title === '帮我画一只猫', 画.title);
  判('推理与正文分开带', 画.messages[1].reasoning === '先想一下' && 画.messages[1].text === '好');
  判('工具调用带参数', 画.messages[1].toolCalls[0]?.name === 'tag_query'
    && String(画.messages[1].toolCalls[0]?.args).includes('cat'));
  判('工具回执挂回那一条轨迹上', 画.messages[1].toolCalls[0]?.result === '{"候选":[]}');
  判('工具回执不单独算一条消息', 画.messages.length === 2);
  判('在跑时最后一条 assistant 标成流式', 画.messages[1].status === 'streaming');

  console.log('\n十、变更会推给事件流');
  const 收到 = [];
  const 控 = new AbortController();
  const 流 = await fetch(`${基}/对话/流?当前=${encodeURIComponent(会话id)}`, {
    headers: { 'x-toolbox-token': 桥.令牌 },
    signal: 控.signal,
  }).then((回) => {
    判('流是事件流', String(回.headers.get('content-type')).startsWith('text/event-stream'));
    const 读 = 回.body.getReader();
    const 解 = new TextDecoder();
    (async () => {
      try {
        for (;;) {
          const { done, value } = await 读.read();
          if (done) break;
          for (const 段 of 解.decode(value).split('\n\n')) {
            const 行 = 段.split('\n').find((一) => 一.startsWith('data: '));
            if (行) 收到.push(JSON.parse(行.slice(6)));
          }
        }
      } catch (_) { /* 收摊了 */ }
    })();
    return 回;
  });
  await 歇(300);
  判('开流先给一份现状', 收到.length >= 1 && 收到[0].ok === true);
  const 推了几次 = 收到.length;
  await 请(基, 桥.令牌, '/对话/停', { 体: { 会话: 会话id } });
  await 歇(400);
  判('有变化就推一份', 收到.length > 推了几次, `推了 ${收到.length} 份`);
  const 版本们 = 收到.map((一) => 一.版本);
  判('版本号是递增的', 版本们.every((一, i) => i === 0 || 一 >= 版本们[i - 1]), 版本们.join(' → '));
  控.abort();

  console.log('\n十一、没有这条路');
  const 乱路 = await 请(基, 桥.令牌, '/对话/没有这个');
  判('乱路给 404 与码', 乱路.状态 === 404 && 乱路.体.code === 'CHAT_NO_ROUTE');

  console.log('\n十二、收摊');
  桥.停();
  await 歇(200);
  判('收摊后发现文件没了', !fs.existsSync(存档));
  let 连不上了 = false;
  try { await 请(基, 桥.令牌, '/对话/状态'); } catch (_) { 连不上了 = true; }
  判('收摊后服务关了', 连不上了);
  try { fs.rmSync(目录, { recursive: true, force: true }); } catch (_) { /* 删不掉就算了 */ }
  判('收摊后临时目录也清了', !fs.existsSync(目录));

  console.log('');
  console.log(`过了 ${过了} 条 · 崩了 ${崩了.length} 条`);
  if (崩了.length) {
    console.log('失败清单：');
    for (const 一 of 崩了) console.log(`  · ${一}`);
  }
  process.exit(崩了.length ? 1 : 0);
}

主().catch((错) => { console.error('跑不下去：', 错); process.exit(1); });
