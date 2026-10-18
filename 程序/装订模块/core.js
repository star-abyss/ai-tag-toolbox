'use strict';
/*
 * 装订模块 · 核心。纯逻辑。
 *
 * 六步：
 *   ① 切分      文本 → 表（行 = 格）
 *   ② 查词      表.词 → 表.库译名
 *   ③ 投影      表 → 报文 { source, words, from, to }
 *   ④ 发送      报文 → 键值对          （由 index.js 调递进来的函数）
 *   ⑤ 归位      键值对 → 表.AI译文
 *   ⑥ 拼回      表 → 译文
 */

const 文本处理 = require('./文本.js');

/** 错误码。 */
const ERR = Object.freeze({
  BAD_ARGUMENT: 'BIND_BAD_ARGUMENT',
  FAILED: 'BIND_FAILED',
  BUSY: 'TEXT_BUSY',
  NO_TRANSLATOR: 'TEXT_NO_TRANSLATOR',
  TRANSLATOR_FAILED: 'TEXT_TRANSLATOR_FAILED',
  BAD_ANSWER: 'TEXT_BAD_ANSWER',
  LOOKUP_FAILED: 'TEXT_LOOKUP_FAILED',
});

/** 每个码配一句人话。 */
const SAY = Object.freeze({
  [ERR.BAD_ARGUMENT]: '参数不对，或没有这个动作',
  [ERR.FAILED]: '动作执行出错',
  [ERR.BUSY]: '上一次翻译还没回来',
  [ERR.NO_TRANSLATOR]: '没递 AI 翻译进来',
  [ERR.TRANSLATOR_FAILED]: 'AI 翻译发不出去',
  [ERR.BAD_ANSWER]: 'AI 返回的不是键值对',
  [ERR.LOOKUP_FAILED]: '查词出错',
});

/** 只留词非空的单元。 */
const 有内容 = 行 => Boolean(行 && 行.词);
const 有内容的格 = 单元 => (单元 || []).filter(有内容);

/**
 * 解析 AI 的返回：直接解 → 扒围栏 → 从最外层的每个 { 起找配平的那一段。
 * @param {unknown} 返回
 * @returns {object|null}
 */
function 解析返回(返回) {
  const 是对象 = (值) => 值 !== null && typeof 值 === 'object' && !Array.isArray(值);
  if (是对象(返回)) return 返回;
  if (typeof 返回 !== 'string') return null;

  const 试 = (文) => {
    try {
      const 值 = JSON.parse(文);
      return 是对象(值) ? 值 : null;
    } catch (_) {
      return null;
    }
  };

  const 直 = 试(返回);
  if (直) return 直;

  const 文 = 返回.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
  const 剥 = 试(文.trim());
  if (剥) return 剥;

  let 深 = 0;
  let 在串 = false;
  for (let i = 0; i < 文.length; i += 1) {
    const 字 = 文[i];
    if (在串) {
      if (字 === '\\') { i += 1; continue; }
      if (字 === '"') 在串 = false;
      continue;
    }
    if (字 === '"') { 在串 = true; continue; }
    if (字 === '[') { 深 += 1; continue; }
    if (字 === ']') { 深 -= 1; continue; }
    if (字 !== '{' || 深 !== 0) continue;
    let 层 = 0;
    let 尾 = -1;
    let 串 = false;
    for (let k = i; k < 文.length; k += 1) {
      const c = 文[k];
      if (串) {
        if (c === '\\') { k += 1; continue; }
        if (c === '"') 串 = false;
        continue;
      }
      if (c === '"') { 串 = true; continue; }
      if (c === '{') 层 += 1;
      else if (c === '}') {
        层 -= 1;
        if (层 === 0) { 尾 = k; break; }
      }
    }
    if (尾 > i) {
      const 得 = 试(文.slice(i, 尾 + 1));
      if (得) return 得;
    }
  }
  return null;
}

/**
 * 造一次装订要用的三件东西。表是这次调用的局部变量；进行中的那一次占住闸门。
 * @param {{查词:Function|null, AI翻译:Function|null}} 依赖
 * @returns {{切分:Function, 有内容的格:Function, 装订:Function}}
 */
function createCore(依赖 = {}) {
  const 查词 = 依赖.查词 || null;
  const AI翻译 = 依赖.AI翻译 || null;
  let 进行中 = false;

  async function 装订(文本, 选项 = {}) {
    let 原文 = '';
    const 坏 = (码, 原因) => ({ ok: false, code: 码, reason: `${码}: ${SAY[码]}`, 原文, 原因: 原因 || null });
    try { 原文 = 文本 == null ? '' : String(文本); }
    catch (error) { return 坏(ERR.BAD_ARGUMENT, error.message); }
    if (进行中) return 坏(ERR.BUSY);
    const 给的方向 = 选项.方向 || 'en-zh';
    if (!['auto', 'en-zh', 'zh-en'].includes(给的方向)) return 坏(ERR.BAD_ARGUMENT, '方向只认 auto / en-zh / zh-en');
    const 方向 = 给的方向 === 'auto' ? 文本处理.猜方向(原文) : 给的方向;
    进行中 = true;
    try {
      const 表 = 文本处理.切分(原文).单元.map(格 => ({
        ...格, 译文: 格.词, 库译名: null, AI译文: null, 出处: 格.词 ? '原词' : '空',
      }));
      const 格们 = 表.filter(有内容);
      if (格们.length && 查词 && 方向 === 'en-zh') {
        let 答;
        try { 答 = await 查词(格们.map(行 => 行.词)); }
        catch (error) { return 坏(ERR.LOOKUP_FAILED, error.message); }
        格们.forEach((行, i) => {
          const 名 = Array.isArray(答) ? 答[i] : null;
          if (typeof 名 === 'string' && 名.trim()) {
            行.库译名 = 名;
            行.译文 = 名;
            行.出处 = '库';
          }
        });
      }
      const 待译 = 格们.filter(行 => !行.库译名 && 文本处理.需翻译(行.词, 方向));
      if (待译.length) {
        if (!AI翻译) return 坏(ERR.NO_TRANSLATOR);
        let 答;
        try {
          答 = await AI翻译({
            source: 原文, words: 待译.map(行 => 行.词),
            from: 方向 === 'zh-en' ? '中文' : '英文', to: 方向 === 'zh-en' ? '英文' : '中文',
          });
        } catch (error) { return 坏(ERR.TRANSLATOR_FAILED, error.message); }
        const 键值 = 解析返回(答);
        if (!键值) return 坏(ERR.BAD_ANSWER);
        for (const 行 of 待译) {
          const 值 = 键值[行.词];
          if (typeof 值 === 'string' && 值.trim()) {
            行.AI译文 = 值;
            行.译文 = 值;
            行.出处 = '模型';
          }
        }
      }
      return {
        ok: true, 原文, 方向, ...文本处理.拼装(原文, 表),
        统计: {
          格: 表.length, 有内容: 格们.length,
          库里查到: 格们.filter(行 => 行.出处 === '库').length,
          模型译出: 格们.filter(行 => 行.出处 === '模型').length,
          照抄原词: 格们.filter(行 => 行.出处 === '原词').length,
        },
      };
    } catch (error) { return 坏(ERR.FAILED, error.message); }
    finally { 进行中 = false; }
  }
  return { 切分: 文本处理.切分, 有内容的格, 装订 };
}
module.exports = { createCore, 有内容的格, ERR, SAY, 文本处理 };
