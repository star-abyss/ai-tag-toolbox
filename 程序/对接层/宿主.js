// 宿主侧：把七个能力模块与主 AI 装起来，对外交出两份东西。
//
//   ① 调(模块, 动作, 参数)   —— 与登记工具那一条同一条路：失败给信封，成功给 data
//   ② 桌()                  —— 模块 · 动作 · 参数（名字 / 可选 / 说明 / 控件）
//
// 交付面上的每一个字都来自模块自己的 describe()：界面不写第二份动作表，
// "参数长什么样""界面上用什么控件"由这里补齐，界面只读、不猜。
//
// 装配的来源是它自己那份 cordis.patch.yml：位置从配置来，模块自己不找路径。
// 调试台（tools/动作浏览器/）与界面层（界面/）走的是同一个装配，
// 区别只在宿主造得比它重——它连带把两个只有界面要用的动作开出来（切分 · 够得着的字节）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import yaml from 'js-yaml';

import { 造模块清单, 主AI, 会话, 取参数类型, 取界面字段, 模型侧动作名 } from './模块清单.js';
import { 造会话图片 } from './会话图片.js';
import { 造会话执行 } from './会话执行.js';
import { 导出绘画工具表, 造绘画业务 } from './绘画业务.js';
import { 会话图片说明 } from './工具定义.js';
import { 显示消息, 组系统素材, 组工具素材 } from './发送素材.js';
import { 投影会话 } from './会话投影.js';
import { 读PNG元数据 } from '../识图模块/元数据.js';
import { 造本地模型 } from './模型可选.js';
import { 造存储 } from './位置.js';
import { 造翻译 } from './调度.js';
import { 造看图 } from './模型引擎/看图.js';
import { 造服务商面, 转消息 } from './界面/服务商.js';

const 本目录 = path.dirname(fileURLToPath(import.meta.url));

/** 本仓库根目录（对接层的上一层）。 */
export const 默认项目根 = path.resolve(本目录, '..');

/**
 * 读配置：cordis.patch.yml 里 toolbox 那一段，项目根换成本次那一个。
 * @param {string} 项目根
 */
export function 读配置(项目根) {
  const 原 = fs.readFileSync(path.join(本目录, 'cordis.patch.yml'), 'utf8');
  const 条目 = yaml.load(原);
  const 一段 = Array.isArray(条目)
    ? 条目.filter((x) => x && x.insert).flatMap((x) => x.insert).find((x) => x && x.id === 'toolbox')
    : null;
  return { ...((一段 && 一段.config) || {}), 项目根 };
}

/**
 * 把字节还原成 Buffer。
 *
 * 回执里的 Buffer 过一趟 JSON 会成为 `{ type:'Buffer', data:[…] }`，
 * 识图的打标引擎要的是真字节。
 * @param {*} 值
 */
export function 还原字节(值) {
  if (Buffer.isBuffer(值)) return 值;
  if (值 instanceof Uint8Array) return Buffer.from(值);
  if (Array.isArray(值)) return Buffer.from(值);
  if (值 && typeof 值 === 'object' && Array.isArray(值.data)) return Buffer.from(值.data);
  return 值;
}

/**
 * 一条动作交到界面上的样子。
 *
 * `动作` 是**模块自己那层的名字**（`门.run()` 认的就是它）；`模型侧` 是工具注册表用的那套
 * （`<模块键>_<动作名>` 的后半段，只含 ASCII 字母数字下划线连字符）。
 * 界面一律用 `动作`：它跟门面说话，而门面不认模型侧的名字。
 *
 * `参数` 是数组：`{ 名, 可选, 说明, 界面 }`。`可选` 由模块自己写的问号决定，
 * `说明` 是模块自己写的那句话，`界面` 是"用什么控件、对象里有哪些字段"。
 * 界面对参数一个字的判断都不做。
 *
 * @param {object} 对照 模块键 → 动作名对照（模块自己那层 → 模型侧）
 */
function 一条动作(对照, 模块键, 一条) {
  const 模型侧 = 模型侧动作名({ 动作名: 对照[模块键] }, 一条.动作);
  const 说明 = 一条.说明 || {};
  const 参数 = (一条.参数 || []).map((写出来的) => {
    const 名 = String(写出来的);
    const 可选 = 名.endsWith('?');
    const 清 = 可选 ? 名.slice(0, -1) : 名;
    return {
      名: 清,
      可选,
      说明: 说明[清] || '',
      // 界面的两张表按**模型侧**的名字编：模型侧那一套不含中文，编起来不会两套混着。
      界面: 取界面字段(模块键, 模型侧, 清),
      类型: 取参数类型(模块键, 模型侧, 清),
    };
  });
  return { 模块: 模块键, 动作: 一条.动作, 模型侧, 摘要: 一条.摘要 || '', 参数 };
}

/**
 * 装模块。走模块清单那一套：清单给位置与工厂，工厂造门面。
 * 缺哪一件都记下来，不抛——装不上的模块如实报缺，别的照常可用。
 *
 * @param {object} 参数
 *   项目根    七个模块与主 AI 都在它下面
 *   配置      读配置() 交出来的那一份
 *   模型      造本地模型() 交出来的那一份（译 / 打标）
 *   模型调用  发一次模型请求：形状与 `对接层/调度.js` 的 `请求` 相同。
 *             给了它就造 `看图` 与 `AI翻译` 两个端口；不给就照旧递 null（模块如实报缺）
 * @returns {{ 门面: object, 动作表: Array, 装不上: Array, 清单: Array }}
 */
export function 装模块({ 项目根, 配置, 模型, 模型调用 = null, 服务商 }) {
  const 要 = createRequire(import.meta.url);
  const 门面 = {};
  const 运行生成状态 = new Map();
  function 读生成状态(session) {
    return structuredClone(运行生成状态.get(session.id) || null);
  }
  const 清单 = 造模块清单({
    读元数据: 读PNG元数据,
    本地翻译引擎: 模型.译,
    本地识图引擎: 模型.打标,
    看图: 模型调用 ? 造看图({ 调度: { 请求: 模型调用 } }) : null,
    AI翻译: 模型调用 ? 造翻译({ 调度: { 请求: 模型调用 } }) : null,
    接收作用域: scope => {
      if (scope.存放地 !== 'session') return { ok: true };
      const list = 门面.session.run('列'); if (!list.ok) return list;
      const row = list.data.会话.find(row => row.标识 === scope.会话ID);
      if (!row) return { ok: false, code: 'SESSION_NO_SUCH_SESSION', reason: 'SESSION_NO_SUCH_SESSION: 目标会话不存在' };
      if (row.冻结) return { ok: false, code: 'SESSION_STORE_UNREADABLE', reason: row.读不懂 };
      if (row.运行状态 === '删除中') return { ok: false, code: 'SESSION_BUSY', reason: 'SESSION_BUSY: 目标会话正在删除' };
      return { ok: true };
    },
  });
  const 对照 = {};
  for (const 一个 of 清单) 对照[一个.名字] = 一个.动作名 || {};

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
      业务工具: () => 导出绘画工具表(),
    });
  } catch (错) {
    装不上.push({ 模块: '主AI', 理由: String((错 && 错.message) || 错) });
  }

  try {
    if (typeof 配置.会话目录 !== 'string' || !配置.会话目录.trim()) throw new Error('对接层配置里缺「会话目录」');
    const 出 = 要(path.join(项目根, 会话.门面));
    门面.session = 出.createSessionModule({
      port: 出.createFileAdapter({ 根目录: path.resolve(项目根, 配置.会话目录) }),
      图片: 造会话图片({ 图片门面: 门面.image }),
      执行: 造会话执行({ 门面, 清单, 服务商, onGenerationState(sessionId, state) {
        if (state) 运行生成状态.set(sessionId, state);
      } }),
    });
    对照.session = 会话.动作名;
  } catch (错) { 装不上.push({ 模块: 'session', 理由: String(错.message || 错) }); }

  门面.drawing = Object.freeze({
    actions: ['生成', '状态'],
    describe: () => [
      { 动作: '生成', 摘要: '按当前每轮张数生成图片并取回当前会话，与模型生图使用同一绘画业务', 参数: ['会话', '正向', '负向?', '参考图?'], 说明: { 会话: '目标会话标识', 正向: '完整正向提示词', 负向: '完整负向提示词', 参考图: '目标会话中的图号' } },
      { 动作: '状态', 摘要: '读取当前会话最近一轮的生成设置快照及已用、剩余轮数', 参数: ['会话'], 说明: { 会话: '目标会话标识' } },
    ],
    async run(动作, 参数 = {}, 上下文 = {}) {
      if (!this.actions.includes(动作)) return { ok: false, code: 'BUSINESS_NO_TOOL', reason: 'BUSINESS_NO_TOOL: 没有这个绘画操作' };
      const sessions = 门面.session.run('列');
      if (!sessions.ok) return sessions;
      if (!sessions.data.会话.some(row => row.标识 === 参数.会话))
        return { ok: false, code: 'SESSION_NO_SUCH_SESSION', reason: 'SESSION_NO_SUCH_SESSION: 目标会话不存在' };
      if (动作 === '状态') {
        const session = 门面.session.run('读', { 会话: 参数.会话 });
        if (!session.ok) return session;
        return { ok: true, data: { 运行中: session.data.运行状态 !== '空闲', 生成状态: 读生成状态(session.data.会话) } };
      }
      return await 造绘画业务({ 门面, sessionId: 参数.会话, signal: 上下文.signal }).执行('drawing_generate', 参数);
    },
  });

  const 可用业务工具 = 导出绘画工具表();
  门面.prompt = Object.freeze({
    actions: ['预览'],
    describe: () => [{
      动作: '预览',
      摘要: '查看当前会话使用的系统消息、工具定义、世界书命中与消息投影',
      参数: ['会话', '文本?'],
      说明: { 会话: '当前会话标识', 文本: '给定时模拟下一条用户输入；空字符串也会模拟' },
    }],
    async run(动作, 参数 = {}) {
      if (动作 !== '预览') return { ok: false, code: 'PROMPT_NO_ACTION', reason: 'PROMPT_NO_ACTION: 没有这个提示词动作' };
      const sessionId = String(参数.会话 || '');
      const sessionResult = await 门面.session.run('读', { 会话: sessionId });
      if (!sessionResult.ok) return sessionResult;
      const 当前会话 = sessionResult.data.会话;
      const 模拟输入 = Object.hasOwn(参数, '文本');
      const 输入文本 = 模拟输入
        ? (typeof 参数.文本 === 'string' ? 参数.文本 : String(参数.文本 ?? ''))
        : (() => {
            const 轮次 = 当前会话.turns.at(-1);
            const 输入 = 当前会话.messages.find(message => message.id === 轮次?.inputMessageId)
              || [...当前会话.messages].reverse().find(message => message.role === 'user');
            return (输入?.parts || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
          })();
      const presetResult = 门面.主AI.run('执行', { 请求: '主AI' });
      if (!presetResult.ok) return presetResult;
      const preset = presetResult.data;
      const worldResult = await 门面.worldbook.run('执行', { 请求: '主AI', 文本: 输入文本 });
      if (!worldResult.ok) return worldResult;
      const hits = worldResult.data.命中;
      const drawing = 造绘画业务({ 门面, sessionId });
      const toolMaterials = 组工具素材(preset.工具表, drawing.工具表);
      if (!toolMaterials.ok) return toolMaterials;
      const imagePort = 造会话图片({ 图片门面: 门面.image });
      const imagesResult = await imagePort.listNumbered(sessionId);
      if (!imagesResult.ok) return imagesResult;
      const imageInfo = 会话图片说明(imagesResult.data.images, preset.附加文本);
      const systemMaterials = 组系统素材({ 命中: hits, 图片说明: imageInfo });
      const 投影 = structuredClone(当前会话);
      if (模拟输入) 投影.messages.push({
        role: 'user',
        context: systemMaterials.深度消息,
        parts: [{ type: 'text', text: 输入文本 }],
        toolCalls: [],
      });
      const messages = await 投影会话(投影, imagePort.read, {
        业务工具名: new Set(可用业务工具.map(tool => tool.名字)),
        图片清单: { ok: true, data: { images: imagesResult.data.images } },
      });
      return { ok: true, data: {
        系统消息: systemMaterials.系统消息,
        系统分段: systemMaterials.系统分段,
        按深度追加: systemMaterials.按深度追加,
        工具表: toolMaterials.工具表,
        工具定义: toolMaterials.工具定义,
        世界书命中: structuredClone(hits),
        使用预设: structuredClone(preset.预设),
        附加文本: structuredClone(preset.附加文本),
        消息: 显示消息(转消息(messages)),
      } };
    },
  });

  const 动作表 = [];
  for (const [模块键, 门] of Object.entries(门面)) {
    for (const 一条 of 门.describe()) 动作表.push(一条动作(对照, 模块键, 一条));
  }

  // 模型侧名字 → 模块侧名字。门面只认模块自己那层的名字，而模型那套名字
  // （`tag_query` 拆出来的 `query`）在 HTTP 这一面上也常被手敲，所以两种都收。
  const 反查 = {};
  for (const 一条 of 动作表) {
    反查[`${一条.模块}/${一条.模型侧}`] = 一条.动作;
  }

  return { 门面, 动作表, 装不上, 清单: [...清单, 会话], 反查 };
}

/**
 * 起一份宿主。
 *
 * @param {{项目根?:string, 数据目录?:string}} 选项
 *   数据目录  个人数据根目录；未指定时读取固定位置设置。
 * @returns {{ 项目根, 版本, 配置, 门面, 动作表, 装不上, 清单, 调, 桌, 列, 预热点 }}
 */
export function 造宿主({ 项目根 = 默认项目根, 数据目录 = '' } = {}) {
  const 根 = path.resolve(项目根);
  const 版本 = JSON.parse(fs.readFileSync(path.join(根, 'version.json'), 'utf8')).version;
  const 存储 = 造存储({ 项目根: 根, 数据目录 });
  const 设置 = 存储.读设置();
  const 配置 = { ...读配置(根), ...存储.配置,
    识图模型: 设置.识图模型 ?? '', 翻译模型: 设置.翻译模型 ?? '' };
  if (设置.comfyUI地址 !== undefined) 配置.comfyUI地址 = 设置.comfyUI地址;
  const 模型 = 造本地模型({ 项目根: 根, 配置,
    onChange: (类别, id) => 存储.写设置({ [类别 === 'vision' ? '识图模型' : '翻译模型']: id }) });
  // 模型调用走界面那一侧的链路表：它里面就有地址、模型与密钥。
  // 请求名选预设与世界书；预设的模型字段给出链路标识和模型名。
  const 服务商 = 造服务商面({ 目录: 存储.读位置().API });
  let 已装门面;
  const 模型调用 = async ({ 请求: 请求名 = '翻译', system = '', ...报文 }) => {
    const 预设 = 已装门面.主AI.执行({ 请求: 请求名 });
    if (!预设) throw new Error('PRESET_NO_SUCH_PRESET: 读不到模型预设');
    const 文本 = (报文.messages || []).flatMap(row => typeof row.content === 'string' ? [row.content] : (row.content || []).filter(item => item.type === 'text').map(item => item.text)).join('\n');
    const 世界书 = 已装门面.worldbook.run('执行', { 请求: 请求名, 文本 });
    if (!世界书.ok) throw new Error(世界书.reason);
    const 命中 = 世界书.data.命中;
    const 系统 = [system, ...命中.filter(row => row.落点 === '前').map(row => row.文本), ...命中.filter(row => row.落点 === '后').map(row => row.文本)].filter(Boolean).join('\n\n');
    const 深度 = 命中.filter(row => row.落点 === '按深度').map(row => row.文本).join('\n\n');
    return 服务商.请求({ ...报文, messages: 深度 ? [{ role: 'user', content: 深度 }, ...报文.messages] : 报文.messages, system: 系统, 请求: 预设.模型?.走, 模型: 预设.模型?.模型 });
  };
  const { 门面, 动作表, 装不上, 清单, 反查 } = 装模块({
    项目根: 根, 配置, 模型, 模型调用, 服务商,
  });
  已装门面 = 门面;

  const 读设置 = () => ({ ...存储.读设置(), comfyUI地址: 配置.comfyUI地址 });
  async function 写设置(patch) {
    const next = { ...patch };
    if (Object.hasOwn(next, 'comfyUI地址')) {
      let url;
      try { url = new URL(next.comfyUI地址); } catch { throw new Error('COMFY_ADDRESS_REQUIRED: 请输入有效的 ComfyUI HTTP 地址'); }
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('COMFY_ADDRESS_REQUIRED: ComfyUI 地址需要使用 http 或 https');
      next.comfyUI地址 = String(next.comfyUI地址).trim().replace(/\/+$/, '');
      if (next.comfyUI地址 !== 配置.comfyUI地址 && 门面.comfy?.在跑吗()) throw new Error('COMFY_BUSY: 出图进行中，请完成后再修改连接地址');
    }
    const saved = await 存储.写设置(next);
    if (Object.hasOwn(next, 'comfyUI地址')) 配置.comfyUI地址 = next.comfyUI地址;
    return { ...saved, comfyUI地址: 配置.comfyUI地址 };
  }

  /**
   * 调一个动作。回执的拆法与登记工具那一条相同：
   * 失败给回执本身；`{ ok:true, data }` 给 data；其余原样。
   *
   * 动作名收两种：模块自己那层的中文名，以及模型侧的名字（`tag_query` 那个 `query`）。
   * 两种都不是就说清楚这个模块交出来的是哪几个。
   */
  async function 调({ 模块, 动作, 参数 }) {
    const 门 = 门面[模块];
    if (!门) return { ok: false, reason: `没有「${模块}」这个模块`, code: 'HOST_NO_SUCH_MODULE' };
    const 名 = 门.actions.includes(动作) ? 动作 : 反查[`${模块}/${动作}`];
    if (!名) {
      return {
        ok: false,
        reason: `「${模块}」没有「${动作}」这个动作；它交出来的是：${门.actions.join(' · ')}`,
        code: 'HOST_NO_SUCH_ACTION',
      };
    }
    const 输入 = 参数 && typeof 参数 === 'object' ? 参数 : {};
    const 回 = await 门.run(名, 输入);
    if (!回 || typeof 回 !== 'object') return 回 === undefined ? null : 回;
    if (回.ok === false) return 回;
    return 回.ok === true && 'data' in 回 ? 回.data : 回;
  }

  return {
    项目根: 根,
    版本,
    配置,
    存储,
    读设置,
    写设置,
    门面,
    动作表,
    装不上,
    清单,
    服务商,
    ready: 门面.session ? 门面.session.ready.then(async result => { if (result.ok && 门面.session.run('列').data.总数 === 0) return await 门面.session.run('新'); return result; }) : Promise.resolve({ ok: false, code: 'HOST_NO_SUCH_MODULE', reason: 'HOST_NO_SUCH_MODULE: 会话模块装不上' }),
    close: () => 门面.session?.close(),
    调,
    /** 交付面：模块 · 动作 · 参数 · 装不上的。 */
    桌: () => ({ 项目根: 根, 版本, 动作表, 装不上, 模型: 模型.列(), 存储位置: 存储.读位置() }),
    列: () => 模型.列(),
    换模型: (类别, id) => 模型.换(类别, id),
    预热点: async () => {
      // 标签库第一次查库或体检要建索引（半秒上下），起来就先点一次，别让用户等在第一查上。
      if (!门面.tag) return;
      try { await 门面.tag.run('status', {}); } catch (_) { /* 热点失败不该拦住服务 */ }
    },
  };
}
