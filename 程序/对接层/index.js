// 工具箱 · 对接层。它是本项目的装配层，同时是 DSH 的一个 Host 插件。
//
// 它做五件事：
//   ① 按配置装模块（位置从配置来；工具参数里不出现地址）
//   ② 按预设的工具表登记工具
//   ③ 注册提示词段：世界书前（5110）· 世界书后（5120）
//   ④ 挂插手点：agent/inbox/claimed · agent/inbox/inserted · agent/pre-step · 段 provider · 调度
//   ⑤ 起对话桥：把会话与 Agent 开给页面上的「助手页」（见 ./对话桥.js）
//
// 计划模式那段正文归 DSH 的 `plan-mode` 配置，写在 cordis.patch.yml 里，不由本插件注册。
//
// 本包装的是七个模块与主 AI 模块，都是 CommonJS；用 createRequire 按路径取它们的门面
// （模块位置住配置里，见 cordis.patch.yml 的 项目根）。
//
// 它不解析模块内部结构，不改 DSH 的包，不接管会话与循环。

import path from 'node:path';
import { createRequire } from 'node:module';

import { 造模块清单, 主AI } from './模块清单.js';
import { 登记工具 } from './登记工具.js';
import { 导出绘画工具表, 造绘画业务 } from './绘画业务.js';
import { createDispatcher, 造翻译 } from './调度.js';
import { 造本轮文本 } from './本轮文本.js';
import { 取命中, 有用户的话 } from './世界书.js';
import { 起对话桥 } from './对话桥.js';
import { 造本地模型 } from './模型可选.js';
import { 造存储 } from './位置.js';
import { 造看图 } from './模型引擎/index.js';
import { 读PNG元数据 } from '../识图模块/元数据.js';
import { 清理模型绘画回执 } from './会话投影.js';

/** 段的顺序：与 上层设计 §5.2 对得上。 */
const 世界书前顺序 = 5110;
const 世界书后顺序 = 5120;

/** 本插件在 profile 里的名字。 */
export const name = 'toolbox';

/**
 * 要用到的服务。
 *
 * `agents` 与 `sessions` 是对话桥要的：桥把会话与 Agent 开给页面上的「助手页」，
 * 而这两样在 DSH 里是**服务**（cordis 的规矩：没在那张名单上的服务，读它当场报错）。
 * 这也是本插件与 DSH 会话子系统之间唯一的耦合——只读它们的公开形状。
 */
export const inject = ['systemPrompt', 'tools', 'llm', 'agents', 'sessions'];

/**
 * 装配。
 * @param {object} ctx DSH 的上下文
 * @param {object} config 见 cordis.patch.yml
 * @returns {object} 装出来的东西：主AI 门面 · 七个模块门面 · 预设 · 工具名清单 · 调度 · 本轮文本
 */
export function apply(ctx, config = {}) {
  const 项目根 = config.项目根;
  if (typeof 项目根 !== 'string' || !项目根.trim()) throw new Error('对接层要一个 项目根（配置里的那个位置）');
  const 存储 = 造存储({ 项目根, 数据目录: config.数据目录 || '' });
  const 已保存设置 = 存储.读设置();
  config = {
    ...config,
    ...存储.配置,
    识图模型: 已保存设置.识图模型 ?? config.识图模型,
    翻译模型: 已保存设置.翻译模型 ?? config.翻译模型,
  };
  const 配置 = config;

  // 五个模块与主 AI 模块都是 CommonJS：按路径 require 它们的门面。
  const 要 = createRequire(import.meta.url);
  const 用户提问 = typeof config.用户提问 === 'function' ? config.用户提问 : null;
  const 当前业务表 = () => 导出绘画工具表().filter(row => row.名字 !== 'ask_user' || 用户提问 !== null);

  const 请求名 = config.请求 || '主AI';
  const 调度 = createDispatcher({
    ctx,
    池: config.池 || {},
    路由: config.路由 || {},
    主AI请求: 请求名,
  });

  // ---------- 模型：装了哪几格，这次用哪一格 ----------
  const 模型 = 造本地模型({
    项目根,
    配置,
    onChange: (类别, id) => 存储.写设置({ [类别 === 'vision' ? '识图模型' : '翻译模型']: id }),
  });
  const 有哪几格 = 模型.列();
  const 翻译格 = 有哪几格.这次用.translation;
  const 识图格 = 有哪几格.这次用.vision;
  const 递 = {
    本地翻译引擎: 翻译格 ? 模型.译 : null,
    本地识图引擎: 识图格 ? 模型.打标 : null,
  };
  ctx.provide('toolboxModels', {
    目录: 有哪几格.目录,
    装着: 有哪几格,
    这次用: { 翻译: 翻译格 || null, 识图: 识图格 || null },
  });

  // ---------- ① 装模块 ----------
  // 递给模块的只有两样：位置（从配置来）与函数（本层造的）。
  const 装订请求 = config.装订请求 || 请求名;
  const 模块清单 = 造模块清单({
    AI翻译: 造翻译({ 调度, 请求名: 装订请求 }),
    ...递,
    读元数据: 读PNG元数据,
    // 看图那条链路。它的系统提示词是识图那本世界书的命中（落点《前》那一段），
    // 每次调用现取：世界书模块要等七个模块都装好才在门面里。
    看图: 造看图({ 调度, 请求名: '识图', 提示词: () => 识图提示词() }),
  });
  const 门面 = {};
  for (const 一个 of 模块清单) {
    const 出 = 要(path.resolve(项目根, 一个.门面));
    const 造 = 出[一个.工厂];
    if (typeof 造 !== 'function') throw new Error(`${一个.门面} 里没有 ${一个.工厂}`);
    门面[一个.名字] = 造(一个.选项(项目根, config, 门面));
  }

  // ---------- 装主 AI 模块（预设的家） ----------
  const 主AI出口 = 要(path.resolve(项目根, 主AI.门面));
  const 主AI门 = 主AI出口[主AI.工厂]({
    根目录: path.resolve(项目根, config.用户目录),
    默认目录: path.resolve(项目根, config.默认目录),
    业务工具: 当前业务表,
  });

  /** 这次这套预设。段 provider 每步都读一次，改了预设、存过之后下一次组装就跟着变。 */
  const 读预设 = () => {
    const 出 = 主AI门.执行({ 请求: 请求名 });
    if (!出) throw new Error(`读不出预设「${请求名}」：${主AI门.run('执行', { 请求: 请求名 }).reason}`);
    return 出;
  };

  const 预设 = 读预设();

  // ---------- ② 登记工具 ----------
  const 本轮业务 = new WeakMap();
  const 本轮设置 = new WeakMap();
  const 业务 = {
    工具表: 预设.工具表,
    执行: async (名字, 参数, 运行上下文) => {
      const agent = 运行上下文?.agent;
      const sessionId = 运行上下文?.agent?.session?.id;
      const create = 生成设置 => 造绘画业务({
        门面, sessionId, signal: 运行上下文?.signal,
        ...(生成设置 === undefined ? {} : { 生成设置 }),
        提问: 用户提问 ? (问题, signal) => 用户提问({ 会话: sessionId, ...问题, signal }) : undefined,
      });
      if (!agent || (名字 !== 'drawing_generate' && 名字 !== 'drawing_info')) {
        const result = await create().执行(名字, 参数);
        return 清理模型绘画回执(名字, result);
      }
      if (!本轮业务.has(agent)) {
        const settings = 本轮设置.has(agent) ? 本轮设置.get(agent) : 门面.comfy.run('生成设置');
        本轮业务.set(agent, Promise.resolve(settings).then(result => result.ok ? { ok: true, business: create(result.data) } : result));
      }
      const current = await 本轮业务.get(agent);
      const result = current.ok ? await current.business.执行(名字, 参数) : current;
      return 清理模型绘画回执(名字, result);
    },
  };
  const 工具 = 登记工具({ ctx, 业务, 处理回执: async 值 => 值 });
  ctx.effect(() => () => { for (const 一 of 工具) 一.卸下(); });

  // ---------- ③ 插手点 ----------
  const 本轮文本 = 造本轮文本(ctx);
  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (!agent || !有用户的话(message)) return;
    本轮业务.delete(agent);
    本轮设置.set(agent, 门面.comfy.run('生成设置'));
  });

  // 世界书那点用法收在一处；下面两处都从这里读。
  // 门面收在 ctx 上：诊断脚本与自检要能换掉它，注入点只有这一个。
  ctx.provide('toolbox', { 门面, 预设 });

  /** 这一次的命中，按落点分堆。 */
  const 这次命中 = (agent) => 取命中({ ctx, 请求: 请求名, 文本: 本轮文本(agent) });

  /** 识图那条链路的系统提示词：请求 `识图` 那本世界书里落点《前》的命中。 */
  const 识图提示词 = () => 取命中({ ctx, 请求: '识图', 文本: '' }).前;

  // ---------- ④ 注册世界书前后段 ----------
  ctx.systemPrompt.section({
    name: 'toolbox:世界书前',
    order: 世界书前顺序,
    interpolate: false,
    text: (context) => 这次命中(context && context.agent).前,
  });
  ctx.systemPrompt.section({
    name: 'toolbox:世界书后',
    order: 世界书后顺序,
    interpolate: false,
    text: (context) => 这次命中(context && context.agent).后,
  });

  // ---------- ④ 续：世界书《按深度》——每轮一条 user 消息，紧贴这次输入之前 ----------
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const 决定 = await next();
    if (!决定 || 决定.kind === 'reject') return 决定;
    const 添 = 这次命中(agent).按深度;
    if (!添) return 决定;

    const 这批 = Array.isArray(messages) ? messages : [];
    // 贴在这批里最后一条"用户自己说的话"之前；工具回执那些步不重复贴。
    let 紧贴 = -1;
    for (let i = 决定.messages.length - 1; i >= 0; i--) {
      const 一 = 决定.messages[i];
      if (这批.includes(一) && 有用户的话(一)) { 紧贴 = i; break; }
    }
    if (紧贴 < 0) return 决定;

    const 出 = [...决定.messages];
    出.splice(紧贴, 0, { role: 'user', content: [{ type: 'text', text: 添 }] });
    return { ...决定, messages: 出 };
  });

  // ---------- ⑤ 对话桥：把会话与 Agent 开给页面上的「助手页」 ----------
  // 地址与令牌写进工具箱数据目录，界面服务读那一份（页面那一侧只认识自己那个源）。
  // 起不来只记一条：桥是"页面能说话"那一条路，装不上不该拖垮工具与提示词。
  if (config.对话桥 !== false) {
    const 桥的存档 = config.对话桥存档
      ? path.resolve(项目根, config.对话桥存档)
      : path.join(path.resolve(项目根, config.用户目录), '对话桥.json');
    const 挂住标志 = config.对话桥挂住 === true || config.对话桥挂住 === 'true';
    起对话桥({
      ctx,
      端口: config.对话桥端口 || 8791,
      存档: 桥的存档,
      模型: config.对话模型 || '',
      provider: config.对话路由 || '',
      挂住: 挂住标志,
    }).then((桥) => {
      ctx.effect(() => () => 桥.停());
      console.log(`对话桥  http://127.0.0.1:${桥.端口}/ （页面上的「助手页」用它说话）`);
    }).catch((错) => {
      console.error(`对话桥起不来：${String((错 && 错.message) || 错)}`);
    });
  }

  return {
    主AI: 主AI门,
    门面,
    预设,
    工具: 工具.map((一) => 一.名字),
    调度,
    本轮文本,
    模块清单,
    模型: {
      目录: 有哪几格.目录,
      装着: 有哪几格,
      这次用: { 翻译: 翻译格 || null, 识图: 识图格 || null },
    },
  };
}
