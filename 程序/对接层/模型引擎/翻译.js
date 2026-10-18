// 模型引擎 · 翻译。跑 Marian（opus-mt）的本地推理。
//
// 用 @huggingface/transformers 的 Node 版（`dist/transformers.node.cjs`，走 CJS）。
// 本地目录要 `env.useFS = true` 才会走文件系统。
//
// 造译端口按单元调用模型，并保留每个单元的标识。

import path from 'node:path';
import { createRequire } from 'node:module';

import { 要一次, 找一格 } from './目录.js';

const 要 = createRequire(import.meta.url);

/** 一格的模型与方向 → 一条 pipeline。 */
async function 取管线({ 模型目录, 格 = '', 方向 = 'en-zh' }) {
  const 一格 = 找一格(模型目录, 'translation', 格);
  if (!一格) throw new Error(`模型目录里没有翻译模型：${模型目录}`);
  if (!一格.装好了) throw new Error(`翻译模型「${一格.id}」没装好：${一格.缺什么.join('；')}`);

  const 子目录名 = 一格.文件.方向 && 一格.文件.方向[方向];
  if (!子目录名) throw new Error(`翻译模型「${一格.id}」没有「${方向}」这个方向`);
  const 子目录 = path.join(一格.目录, 子目录名);

  return 要一次(`管线:${子目录}`, async () => {
    const { pipeline, env } = 要('@huggingface/transformers');
    // 只认本地：不去 Hugging Face 找
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useFS = true;
    env.localModelPath = path.dirname(子目录);
    const 管线 = await pipeline('translation', path.basename(子目录), { dtype: 'q8' });
    return { 管线, 格: 一格.id, 名字: 一格.名字, 方向 };
  });
}

/** 跑一次，取回那一句译文。 */
async function 译一句(管线, 文本) {
  const 出 = await 管线(文本);
  const 头 = Array.isArray(出) ? 出[0] : 出;
  return 头 && typeof 头.translation_text === 'string' ? 头.translation_text : '';
}

function 按汉字切片(文本) {
  const 字们 = Array.from(文本);
  const 类型们 = 字们.map((字) => /\p{Script=Han}/u.test(字) ? true
    : /\p{Script=Latin}/u.test(字) ? false
      : null);
  for (let i = 0; i < 类型们.length; i += 1) {
    if (类型们[i] !== null) continue;
    let 前 = i - 1;
    while (前 >= 0 && 类型们[前] === null) 前 -= 1;
    let 后 = i + 1;
    while (后 < 类型们.length && 类型们[后] === null) 后 += 1;
    类型们[i] = 前 >= 0 ? 类型们[前] : 后 < 类型们.length ? 类型们[后] : false;
  }

  const 切片 = [];
  let 开始 = 0;
  let 当前含汉字 = 类型们[0];
  let 偏移 = 0;
  for (let i = 0; i < 字们.length; i += 1) {
    const 字 = 字们[i];
    const 含汉字 = 类型们[i];
    if (偏移 > 开始 && 含汉字 !== 当前含汉字) {
      切片.push({ text: 文本.slice(开始, 偏移), 含汉字: 当前含汉字 });
      开始 = 偏移;
      当前含汉字 = 含汉字;
    }
    偏移 += 字.length;
  }
  切片.push({ text: 文本.slice(开始), 含汉字: 当前含汉字 });
  return 切片;
}

async function 译混合单元(器, 方向, 文本, id) {
  const 含汉字 = /\p{Script=Han}/u.test(文本);
  const 含拉丁字母 = /\p{Script=Latin}/u.test(文本);
  if (!含汉字 || !含拉丁字母) return 器.译(文本);

  const 切片们 = 按汉字切片(文本);
  const 结果 = [];
  for (const 切片 of 切片们) {
    const 保留 = 方向 === 'en-zh' ? 切片.含汉字 : !切片.含汉字;
    if (保留) {
      结果.push(切片.text);
      continue;
    }
    const 前空白 = 切片.text.match(/^\s*/u)[0];
    const 后空白 = 切片.text.match(/\s*$/u)[0];
    const 内容 = 切片.text.slice(前空白.length, 切片.text.length - 后空白.length);
    if (!内容) {
      结果.push(切片.text);
      continue;
    }
    const 译文 = await 器.译(内容);
    if (!译文.trim()) throw new Error(`TRANSLATION_EMPTY: 单元「${id}」没有译文`);
    结果.push(`${前空白}${译文.trim()}${后空白}`);
  }
  return 结果.join('');
}

/**
 * 装一个翻译引擎（一格的模型 + 一个方向）。
 * @param {object} 参数
 *   模型目录  项目里的 `模型/` 那一层
 *   格        model id；不给就用第一格装好的
 *   方向      'en-zh' 或 'zh-en'
 */
export async function 造翻译器({ 模型目录, 格 = '', 方向 = 'en-zh' }) {
  const 一份 = await 取管线({ 模型目录, 格, 方向 });
  return {
    译: (文本) => 译一句(一份.管线, String(文本 === undefined || 文本 === null ? '' : 文本)),
    格: 一份.格,
    名字: 一份.名字,
    方向,
  };
}

/**
 * 造一个"翻译端口"：装配层递进翻译模块的那一支。
 * 报文形状见 翻译模块/port.js。
 *   - `模型` 给了就用那一格，没给用装配时定下的那一格
 *   - 每个单元按自己的 id 返回译文
 */
export function 造译端口({ 模型目录, 格 = '', 默认方向 = 'en-zh' }) {
  const 器们 = new Map();

  async function 取器(方向, 模型) {
    const 要的 = 方向 === 'zh-en' ? 'zh-en' : 'en-zh';
    const 哪格 = typeof 模型 === 'string' && 模型.trim() ? 模型.trim() : 格;
    const 键 = `${哪格}\u0000${要的}`;
    if (器们.has(键)) return 器们.get(键);
    const 器 = await 造翻译器({ 模型目录, 格: 哪格, 方向: 要的 });
    器们.set(键, 器);
    return 器;
  }

  return async function 译(报文) {
    const 单元们 = Array.isArray(报文 && 报文.units) ? 报文.units : [];
    if (!单元们.length) return { 模型: 格 || null, units: [] };
    const 方向 = 报文 && 报文.to === '英文' ? 'zh-en'
      : 报文 && 报文.to === '中文' ? 'en-zh'
        : 默认方向;
    const 器 = await 取器(方向, 报文 && 报文.模型);
    const units = [];
    for (const 单元 of 单元们) {
      const text = await 译混合单元(器, 方向, String(单元.text), 单元.id);
      if (!text.trim()) throw new Error(`TRANSLATION_EMPTY: 单元「${单元.id}」没有译文`);
      units.push({ id: 单元.id, text });
    }
    return { 模型: 器.格, units };
  };
}
