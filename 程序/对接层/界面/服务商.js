// 界面层 · 服务商这一面。
//
// 链路表与两张"问回来的表"住个人数据目录下的 API 子目录。
// "这家有哪些模型""这个模型吃不吃图"都问服务商本人：`GET <地址>/models`
//      与一次带图的 `POST <地址>/chat/completions`
//
// 存档形状（两份 JSON）：
//
//   链路.json    { 链路: [ { id, 名字, 地址, 模型, 上下文窗口, 密钥 } ] }        ← 用户填的
//   模型表.json  { 表:   { <地址>: { 取回时间, 模型: [ { 名字, 声明能看图, 依据 } ] } },
//                 能力: { "<地址>|<模型>": { 能看图, 理由, 依据, 时间 } } }      ← 问回来的
//
// 能力的两个来源写进 `依据`：`探测`（真发过一张图）· `声明`（服务商自己说的）。
// 两个都没有时 `能看图` 是 null —— **"没声明"不等于"不能"**。
import fs from 'node:fs';
import path from 'node:path';
import { 默认数据目录, 读位置设置 } from '../位置.js';

/** 这一面的错误码。 */
export const ERR = Object.freeze({
  BAD_ASK: 'API_BAD_ASK',
  STORE_READ: 'API_STORE_READ',
  NO_ADDRESS: 'API_NO_ADDRESS',
  NO_MODEL: 'API_NO_MODEL',
  NO_SUCH_LINK: 'API_NO_SUCH_LINK',
  UNREACHABLE: 'API_UNREACHABLE',
  STATUS: 'API_STATUS',
  NOT_JSON: 'API_NOT_JSON',
  NO_MODELS: 'API_NO_MODELS',
  BAD_MESSAGES: 'API_BAD_MESSAGES',
  NO_ANSWER: 'API_NO_ANSWER',
});

/** 问服务商一次最多等多久。 */
const 问的时限毫秒 = 20000;

/** 探测"吃不吃图"用的那一张：1×1 的红点 PNG。 */
const 一小图 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

/** API 存档目录位于个人数据根目录下。 */
export function 默认存档目录() {
  return path.join(读位置设置().数据目录 || 默认数据目录(), 'API');
}

/** 地址归一：去掉尾上的斜杠。空的就是空的。 */
function 地址归一(值) {
  return String(值 || '').trim().replace(/\/+$/, '');
}

/** 从服务商的回应里挑一句人话。 */
function 说一句(回) {
  const 解 = 回 && 回.解;
  const 层 = 解 && typeof 解 === 'object' ? (解.error && typeof 解.error === 'object' ? 解.error : 解) : null;
  const 话 = 层 && (层.message || 层.msg || 层.detail || 层.error);
  if (typeof 话 === 'string' && 话.trim()) return 话.trim().slice(0, 300);
  const 原 = String((回 && 回.文) || '').trim();
  return 原 ? 原.slice(0, 300) : '';
}

/** 服务商的模型表：`data` / `models` / 裸数组三种都收，成员认 `id` / `name` / `model`。 */
function 取模型列(解) {
  const 列 = Array.isArray(解) ? 解
    : Array.isArray(解?.data) ? 解.data
      : Array.isArray(解?.models) ? 解.models
        : [];
  const 出 = [];
  for (const 一 of 列) {
    if (typeof 一 === 'string') { if (一.trim()) 出.push({ id: 一.trim() }); continue; }
    if (一 && typeof 一 === 'object') 出.push(一);
  }
  return 出;
}

/** 一条模型记录的名字。 */
function 取名字(条) {
  if (typeof 条 === 'string') return 条.trim();
  return String(条?.id || 条?.name || 条?.model || '').trim();
}

/**
 * 服务商自己声明的图片能力。
 *
 * 读这些位置：`architecture.input_modalities` · `architecture.modality` ·
 * `input_modalities` · `modalities` · `modalities.input` · `capabilities.vision` ·
 * `capabilities.image_input` · `supports_vision` · `vision`。
 *
 * @returns {[boolean|null, string]} 能看图与否（读不到给 null）+ 依据原文
 */
function 声明能看图(条) {
  if (!条 || typeof 条 !== 'object') return [null, ''];
  const 架 = 条.architecture && typeof 条.architecture === 'object' ? 条.architecture : {};
  const 模态 = 架.input_modalities ?? 架.modality ?? 条.input_modalities
    ?? (条.modalities && typeof 条.modalities === 'object' ? 条.modalities.input : 条.modalities);
  if (typeof 模态 === 'string' && 模态.trim()) {
    return [/image|vision/i.test(模态), 模态.trim()];
  }
  if (Array.isArray(模态) && 模态.length) {
    const 文 = 模态.map((一) => String(一)).join('+');
    return [模态.some((一) => /image|vision/i.test(String(一))), 文];
  }
  const 能力 = 条.capabilities && typeof 条.capabilities === 'object' ? 条.capabilities : {};
  for (const [名, 值] of [['capabilities.vision', 能力.vision], ['capabilities.image_input', 能力.image_input],
    ['supports_vision', 条.supports_vision], ['vision', 条.vision]]) {
    if (typeof 值 === 'boolean') return [值, 名];
  }
  return [null, ''];
}

/** 服务商拒这张图时用的说法。 */
function 是拒绝看图的说法(句子) {
  return /image|vision|multimodal|modalit|图片|图像|不支持/i.test(String(句子 || ''));
}

/**
 * 造一份服务商面。
 *
 * @param {{目录?:string}} [选项] 目录默认 `%APPDATA%\工具箱\API`
 * @returns {{目录, 链路文件, 模型表文件, 读链路, 写链路, 读模型表, 问能力, 取密钥,
 *            列模型, 探图, 试一条}}
 */
export function 造服务商面({ 目录 = 默认存档目录() } = {}) {
  const 根 = path.resolve(目录);
  const 链路文件 = path.join(根, '链路.json');
  const 模型表文件 = path.join(根, '模型表.json');
  let 链路状态 = { ok: true, code: '', reason: '' };

  /** 读一份 JSON；没有、读不动都给兜底。 */
  function 读JSON(文件, 兜底) {
    try {
      const 原 = JSON.parse(fs.readFileSync(文件, 'utf8'));
      return 原 && typeof 原 === 'object' ? 原 : 兜底;
    } catch (_) {
      return 兜底;
    }
  }

  /** 写一份 JSON；目录不在就现建。 */
  function 写JSON(文件, 东西) {
    fs.mkdirSync(path.dirname(文件), { recursive: true });
    fs.writeFileSync(文件, `${JSON.stringify(东西, null, 2)}\n`, 'utf8');
  }

  /** 一行链路：缺的补空，多的不要。 */
  function 归一链路(行) {
    return {
      id: String(行?.id || ''),
      名字: String(行?.名字 || ''),
      地址: 地址归一(行?.地址),
      模型: String(行?.模型 || '').trim(),
      上下文窗口: Math.max(0, Math.round(Number(行?.上下文窗口) || 0)),
      密钥: String(行?.密钥 || ''),
    };
  }

  /** 存着的那张链路表（含密钥）。 */
  function 读链路() {
    try {
      const 原 = JSON.parse(fs.readFileSync(链路文件, 'utf8'));
      if (!原 || typeof 原 !== 'object' || !Array.isArray(原.链路)) {
        链路状态 = {
          ok: false,
          code: ERR.STORE_READ,
          reason: '链路存档格式不正确，需要包含链路数组',
        };
        return [];
      }
      链路状态 = { ok: true, code: '', reason: '' };
      return 原.链路.map(归一链路).filter((一) => 一.id);
    } catch (错) {
      if (错 && 错.code === 'ENOENT') {
        链路状态 = { ok: true, code: '', reason: '' };
        return [];
      }
      const 是JSON错 = 错 instanceof SyntaxError;
      const 系统码 = String(错 && 错.code || '');
      链路状态 = {
        ok: false,
        code: ERR.STORE_READ,
        reason: 是JSON错
          ? '链路存档 JSON 无法解析'
          : `链路存档读取失败${系统码 ? `（${系统码}）` : ''}`,
      };
      return [];
    }
  }

  /** 链路存档状态；不包含链路字段或密钥。 */
  function 取链路状态() { return { ...链路状态 }; }

  /**
   * 存一张链路表。
   *
   * 数组的成员 = 存完还剩哪几行（不在里头的 id 连同它的密钥一起没了）；数组的顺序 = 优先级。
   * 每行的 `密钥` 只在给了非空值时改写，`清密钥: true` 是显式抹掉。
   *
   * @param {Array} 来的 页面交上来的那串
   */
  function 写链路(来的) {
    const 已有 = 读链路();
    if (!链路状态.ok) {
      const reason = `${ERR.STORE_READ}: ${链路状态.reason}`;
      throw Object.assign(new Error(reason), { code: ERR.STORE_READ, reason });
    }
    const 旧的 = new Map(已有.map((一) => [一.id, 一]));
    const 出 = [];
    for (const 一 of Array.isArray(来的) ? 来的 : []) {
      const id = String(一?.id || '');
      if (!id) continue;
      const 前 = 旧的.get(id);
      const 密钥 = 一?.清密钥 === true ? '' : (String(一?.密钥 || '') || (前 ? 前.密钥 : ''));
      出.push(归一链路({ id, 名字: 一?.名字, 地址: 一?.地址, 模型: 一?.模型, 上下文窗口: 一?.上下文窗口, 密钥 }));
    }
    写JSON(链路文件, { 链路: 出 });
    return 出;
  }

  /** 两张"问回来的表"：`表` 按地址记服务商给的模型清单，`能力` 按（地址 · 模型）记结论。 */
  function 读模型表() {
    const 原 = 读JSON(模型表文件, {});
    return {
      表: 原.表 && typeof 原.表 === 'object' ? 原.表 : {},
      能力: 原.能力 && typeof 原.能力 === 'object' ? 原.能力 : {},
    };
  }

  /** 记下这次取回的模型清单（同地址整份替换 = 服务商现在提供哪些就是哪些）。 */
  function 记模型表(地址, 模型们) {
    const 原 = 读模型表();
    原.表[地址] = { 取回时间: Date.now(), 模型: 模型们 };
    写JSON(模型表文件, 原);
  }

  /** 记下一条能力结论。 */
  function 记能力(地址, 模型, 能看图, 理由, 依据) {
    const 原 = 读模型表();
    原.能力[`${地址}|${模型}`] = { 能看图, 理由, 依据, 时间: Date.now() };
    写JSON(模型表文件, 原);
  }

  /**
   * 一个模型的图片能力：探测结论优先，其次服务商的声明，都没有给 null。
   * @returns {{能看图: boolean|null, 理由: string, 依据: string}}
   */
  function 问能力(地址, 模型) {
    const 点 = 地址归一(地址);
    const 名 = String(模型 || '').trim();
    if (!点 || !名) return { 能看图: null, 理由: '', 依据: '' };
    const 表 = 读模型表();
    const 探 = 表.能力[`${点}|${名}`];
    if (探) {
      return {
        能看图: typeof 探.能看图 === 'boolean' ? 探.能看图 : null,
        理由: String(探.理由 || ''),
        依据: String(探.依据 || ''),
      };
    }
    const 声 = (表.表[点]?.模型 || []).find((一) => 一 && 一.名字 === 名);
    if (声 && typeof 声.声明能看图 === 'boolean') {
      return { 能看图: 声.声明能看图, 理由: String(声.依据 || ''), 依据: '声明' };
    }
    return { 能看图: null, 理由: '', 依据: '' };
  }

  /**
   * 这一趟用哪把钥匙：页面现敲的优先（给了空串就是"这条链路不用钥匙"）；
   * 没给就按 id 取这条链路存着的那把。
   */
  function 取密钥({ id, 密钥, 地址 }) {
    if (typeof 密钥 === 'string') return 密钥;
    const 行 = 读链路().find((一) => 一.id === String(id || ''));
    if (!行) return '';
    const 点 = 地址归一(地址);
    if (点 && 行.地址 && 行.地址 !== 点) return '';
    return 行.密钥;
  }

  /** 发一次请求，把状态与 JSON 一起交回来。 */
  async function 发一次(地址, { 密钥 = '', 方法 = 'GET', 体, 信号 } = {}) {
    const 头 = { Accept: 'application/json' };
    // HTTP 头只收 Latin-1：密钥里有中文之类的字符时，直接说清楚，别让它变成一个读不懂的
    // `Cannot convert argument to a ByteString`。
    if (密钥) {
      if (!/^[\x20-\x7e]*$/.test(密钥)) {
        return { ok: false, code: ERR.BAD_ASK, reason: '密钥里有非 ASCII 字符（HTTP 头只收 Latin-1）：重新复制一次，别把中文标点带进去' };
      }
      头.Authorization = `Bearer ${密钥}`;
    }
    if (体 !== undefined) 头['Content-Type'] = 'application/json';
    let 回;
    try {
      回 = await fetch(地址, {
        method: 方法,
        headers: 头,
        body: 体 === undefined ? undefined : JSON.stringify(体),
        signal: 信号 || AbortSignal.timeout(问的时限毫秒),
      });
    } catch (错) {
      return { ok: false, code: ERR.UNREACHABLE, reason: `连不上 ${地址}：${String((错 && 错.message) || 错)}` };
    }
    const 文 = await 回.text().catch(() => '');
    let 解 = null;
    try { 解 = 文 ? JSON.parse(文) : null; } catch (_) { 解 = null; }
    return { ok: true, 状态: 回.status, 解, 文 };
  }

  /**
   * 这家有哪些模型：`GET <地址>/models`，取回来的清单连同声明记进模型表。
   * @returns `{ ok:true, data:{ 地址, 取回时间, 模型:[{ 名字, 能看图, 说明 }] } }`
   */
  async function 列模型({ 地址, 密钥 = '' }) {
    const 点 = 地址归一(地址);
    if (!点) return { ok: false, code: ERR.NO_ADDRESS, reason: '这条链路还没填地址' };
    const 回 = await 发一次(`${点}/models`, { 密钥 });
    if (!回.ok) return 回;
    if (回.状态 < 200 || 回.状态 >= 300) {
      return { ok: false, code: ERR.STATUS, reason: `服务商回了 HTTP ${回.状态}${说一句(回) ? `：${说一句(回)}` : ''}` };
    }
    if (!回.解) return { ok: false, code: ERR.NOT_JSON, reason: `${点}/models 的回应不是 JSON` };
    const 列 = 取模型列(回.解);
    if (!列.length) return { ok: false, code: ERR.NO_MODELS, reason: '服务商的回应里没有模型清单' };
    const 认过的 = new Set();
    const 模型们 = [];
    for (const 条 of 列) {
      const 名字 = 取名字(条);
      if (!名字 || 认过的.has(名字)) continue;
      认过的.add(名字);
      const [能, 依据] = 声明能看图(条);
      模型们.push({ 名字, 声明能看图: 能, 依据 });
    }
    记模型表(点, 模型们);
    return {
      ok: true,
      data: {
        地址: 点,
        取回时间: Date.now(),
        模型: 模型们.map((一) => {
          const 能力 = 问能力(点, 一.名字);
          return {
            名字: 一.名字,
            能看图: 能力.能看图,
            说明: 能力.依据 === '探测' ? `探测过：${能力.理由}` : 能力.依据 === '声明' ? `服务商声明：${能力.理由}` : '',
          };
        }),
      },
    };
  }

  /**
   * 这个模型吃不吃图：真发一张 1×1 的图问一次，结论记进模型表。
   *
   * 收下了 → `能看图: true`；被明确拒掉 → `false`；其余（连不上、钥匙不对、
   * 没这个模型）→ `null`，**不写进表**。
   *
   * @returns `{ ok:true, data:{ 能看图, 理由, 依据 } }`
   */
  async function 探图({ 地址, 密钥 = '', 模型 }) {
    const 点 = 地址归一(地址);
    const 名 = String(模型 || '').trim();
    if (!点) return { ok: false, code: ERR.NO_ADDRESS, reason: '这条链路还没填地址' };
    if (!名) return { ok: false, code: ERR.NO_MODEL, reason: '这条链路还没填模型' };
    const 回 = await 发一次(`${点}/chat/completions`, {
      密钥,
      方法: 'POST',
      体: {
        model: 名,
        max_tokens: 1,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '这张图是什么颜色？只回两个字。' },
            { type: 'image_url', image_url: { url: 一小图 } },
          ],
        }],
      },
    });
    if (!回.ok) return 回;
    const 句子 = 说一句(回);
    const 收下了 = 回.状态 >= 200 && 回.状态 < 300;
    const 能看图 = 收下了 ? true : (是拒绝看图的说法(句子) ? false : null);
    const 理由 = 收下了 ? '服务商收下了这张 1×1 的图' : (句子 || `HTTP ${回.状态}`);
    if (能看图 === null) return { ok: true, data: { 能看图: null, 理由, 依据: '' } };
    记能力(点, 名, 能看图, 理由, '探测');
    return { ok: true, data: { 能看图, 理由, 依据: '探测' } };
  }

  /**
   * 这条链路通不通：发一次最小的纯文字请求。
   * @returns `{ ok:true, data:{ 话说 } }`；不通给 `{ ok:false, code, reason }`
   */
  async function 试一条({ 地址, 密钥 = '', 模型 }) {
    const 点 = 地址归一(地址);
    const 名 = String(模型 || '').trim();
    if (!点) return { ok: false, code: ERR.NO_ADDRESS, reason: '这条链路还没填地址' };
    if (!名) return { ok: false, code: ERR.NO_MODEL, reason: '这条链路还没填模型' };
    const 回 = await 发一次(`${点}/chat/completions`, {
      密钥,
      方法: 'POST',
      体: { model: 名, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] },
    });
    if (!回.ok) return 回;
    if (回.状态 < 200 || 回.状态 >= 300) {
      return { ok: false, code: ERR.STATUS, reason: `服务商回了 HTTP ${回.状态}${说一句(回) ? `：${说一句(回)}` : ''}` };
    }
    return { ok: true, data: { 话说: `服务商收下了这次请求（HTTP ${回.状态}）` } };
  }

  /**
   * 这一趟用哪条链路。
   *
   * `请求` 给链路 id（或名字）。省略用表里第一条，指定但不存在返回错误。
   * 链路的地址、模型与密钥来自当前存档。
   *
   * @returns `{ 链路 }` 或 `{ 错 }`
   */
  function 选链路(请求) {
    const 表 = 读链路();
    if (!链路状态.ok) return { 错: { ok: false, code: ERR.STORE_READ, reason: 链路状态.reason } };
    if (!表.length) return { 错: { ok: false, code: ERR.NO_SUCH_LINK, reason: '链路表是空的：到「API 设置」加一条（地址 + 模型）' } };
    const 名 = String(请求 || '').trim();
    if (!名) return { 链路: 表[0] };
    const 链路 = 表.find((一) => 一.id === 名 || 一.名字 === 名);
    return 链路 ? { 链路 } : { 错: { ok: false, code: ERR.NO_SUCH_LINK, reason: `没有链路「${名}」` } };
  }

  /**
   * 一次模型调用：DSH 那条路是 `调度.请求`，独立服务这条路是它。
   * 入参与回执形状与 `对接层/调度.js` 的 `请求` 相同。
   *
   * @param {object} 报文
   *   请求      走哪条链路（链路 id）；不写用表里第一条
   *   messages  `[{ role, content }]`；content 是 `[{type:'text',text}]`
   *             / `[{type:'image',data,mimeType}]`，或直接一段字符串
   *   system    系统提示词，不写就不带
   *   温度 · 上限
   * @returns `{ 正文, 用量, 用的谁, 停在哪 }`
   */
  const 请求错误 = (code, text) => Object.assign(new Error(`${code}: ${text}`), { code, reason: `${code}: ${text}` });
  function 固定请求({ 请求: 请求名, 模型 } = {}) {
    const 选 = 选链路(请求名);
    if (选.错) throw 请求错误(选.错.code, 选.错.reason);
    const 行 = structuredClone(选.链路);
    return parameters => 请求链路(行, { ...parameters, 模型 });
  }
  async function 请求(parameters = {}) { return 固定请求(parameters)(parameters); }
  async function 请求链路(行, { messages, system, 温度, 上限, 工具, 信号, 模型 }) {
    if (!行.地址) throw 请求错误(ERR.NO_ADDRESS, `链路「${行.名字 || 行.id}」还没填地址`);
    if (!行.模型) throw 请求错误(ERR.NO_MODEL, `链路「${行.名字 || 行.id}」还没填模型`);
    const 说的 = 转消息(messages);
    if (!说的.length) throw 请求错误(ERR.BAD_MESSAGES, '这一趟没有可发的消息');

    const 体 = { model: 模型 || 行.模型, messages: 说的 };
    if (工具?.length) 体.tools = 工具;
    if (typeof system === 'string' && system) 体.messages = [{ role: 'system', content: system }, ...说的];
    if (温度 !== undefined) 体.temperature = 温度;
    if (上限 !== undefined) 体.max_tokens = 上限;

    const 回 = await 发一次(`${行.地址}/chat/completions`, { 密钥: 行.密钥, 方法: 'POST', 体, 信号 });
    if (!回.ok) throw 请求错误(回.code, 回.reason);
    if (回.状态 < 200 || 回.状态 >= 300) {
      throw 请求错误(ERR.STATUS, `服务商回了 HTTP ${回.状态}${说一句(回) ? `：${说一句(回)}` : ''}`);
    }
    const 正文 = 取正文(回.解);
    const 消息 = 回.解?.choices?.[0]?.message;
    if (!正文.trim() && !消息?.tool_calls?.length && !消息?.reasoning_content) throw 请求错误(ERR.NO_ANSWER, '服务商没回正文、推理或工具');
    return {
      正文,
      消息,
      用量: (回.解 && 回.解.usage) || null,
      用的谁: { provider: 行.名字 || 行.id, model: 体.model },
      停在哪: (回.解 && 回.解.choices && 回.解.choices[0] && 回.解.choices[0].finish_reason) || null,
    };
  }

  return { 目录: 根, 链路文件, 模型表文件, 读链路, 取链路状态, 写链路, 读模型表, 问能力, 取密钥, 列模型, 探图, 试一条, 请求, 固定请求 };
}

/** DSH 那套消息形状 → OpenAI 那套。认不出的块跳过。 */
export function 转消息(消息们) {
  const 出 = [];
  for (const 一 of Array.isArray(消息们) ? 消息们 : []) {
    if (!一 || typeof 一 !== 'object') continue;
    const 角色 = ['system', 'user', 'assistant', 'tool'].includes(一.role) ? 一.role : 'user';
    if (一.tool_calls || 一.tool_call_id) { 出.push({ ...一, role: 角色 }); continue; }
    if (typeof 一.content === 'string') { 出.push({ role: 角色, content: 一.content }); continue; }
    const 块们 = [];
    for (const 块 of Array.isArray(一.content) ? 一.content : []) {
      if (!块 || typeof 块 !== 'object') continue;
      if (块.type === 'text' && typeof 块.text === 'string') 块们.push({ type: 'text', text: 块.text });
      else if (块.type === 'image' && 块.data) {
        const 类型 = typeof 块.mimeType === 'string' && 块.mimeType ? 块.mimeType : 'image/png';
        块们.push({ type: 'image_url', image_url: { url: `data:${类型};base64,${String(块.data)}` } });
      }
    }
    if (块们.length) 出.push({ role: 角色, content: 块们 });
  }
  return 出;
}

/** 回执里的正文：`choices[0].message.content`，有的服务商拆成数组。 */
function 取正文(解) {
  const 条 = 解 && Array.isArray(解.choices) ? 解.choices[0] : null;
  const 内 = 条 && 条.message ? 条.message.content : null;
  if (typeof 内 === 'string') return 内;
  if (Array.isArray(内)) return 内.map((一) => (一 && typeof 一.text === 'string' ? 一.text : '')).join('');
  return '';
}
