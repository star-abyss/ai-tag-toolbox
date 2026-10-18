'use strict';
const ERR = Object.freeze({
  BUSY: 'TEXT_LOCAL_BUSY',
  NO_ENGINE: 'TEXT_LOCAL_NO_ENGINE',
  NO_SPLIT: 'TEXT_LOCAL_NO_SPLIT',
  ENGINE_FAILED: 'TEXT_LOCAL_FAILED',
  BAD_DIRECTION: 'TEXT_LOCAL_BAD_DIRECTION',
  BAD_ARGUMENT: 'TEXT_LOCAL_BAD_ARGUMENT',
});

const SAY = Object.freeze({
  [ERR.BUSY]: '上一次还没回来',
  [ERR.NO_ENGINE]: '没有本地翻译模型',
  [ERR.NO_SPLIT]: '没有切分函数',
  [ERR.ENGINE_FAILED]: '本地翻译引擎报错',
  [ERR.BAD_DIRECTION]: '方向只认 auto / en-zh / zh-en',
  [ERR.BAD_ARGUMENT]: '参数不对',
});

const ok = (data) => ({ ok: true, data: data === undefined ? null : data });
const fail = (码, 话, 原文) => ({
  ok: false,
  code: 码,
  reason: `${码}: ${话}`,
  ...(原文 === undefined ? {} : { 原文 }),
});


/** 切分端口的单元数组，出口提供独立范围副本。 */
function 收单元(result) {
  return result.单元.map(row => ({
    ...row, 原文范围: [...row.原文范围], 词范围: [...row.词范围],
  }));
}

function createCore(依赖) {
  const 文本处理 = 依赖.文本处理;
  const 查词 = 依赖.查词;
  const 译 = 依赖.译;
  let 在飞 = false;

  async function 本地译(value, 选项 = {}) {
    let 原文 = '';
    try { 原文 = value == null ? '' : String(value); }
    catch (error) { return fail(ERR.BAD_ARGUMENT, error.message, 原文); }
    if (在飞) return fail(ERR.BUSY, SAY[ERR.BUSY], 原文);
    const 要的 = 选项.方向 || 依赖.默认方向 || 'auto';
    if (!['auto', 'en-zh', 'zh-en'].includes(要的)) return fail(ERR.BAD_DIRECTION, SAY[ERR.BAD_DIRECTION], 原文);
    const 方向 = 要的 === 'auto' ? 文本处理.猜方向(原文) : 要的;
    在飞 = true;
    try {
      let 单元;
      try { 单元 = 收单元(文本处理.切分(原文)); }
      catch (error) { return fail(ERR.NO_SPLIT, error.message, 原文); }
      const 表 = 单元.map(row => ({
        ...row, 译文: row.词, 库译名: null, 模型译文: null, 出处: row.词 ? '原词' : '空',
      }));
      const 格们 = 表.filter(row => row.词);
      if (方向 === 'en-zh' && 查词 && 格们.length) {
        let names;
        try { names = 查词(格们.map(row => row.词)); }
        catch { names = []; }
        if (Array.isArray(names)) 格们.forEach((row, index) => {
          const name = names[index];
          if (typeof name === 'string' && name.trim()) {
            row.库译名 = name;
            row.译文 = name;
            row.出处 = '库';
          }
        });
      }
      const 待译 = 格们.filter(row => !row.库译名 && 文本处理.需翻译(row.词, 方向));
      let 模型 = null;
      if (待译.length) {
        if (!译) return fail(ERR.NO_ENGINE, SAY[ERR.NO_ENGINE], 原文);
        const 报文 = {
          source: 原文, units: 待译.map(row => ({ id: row.标识, text: row.词 })),
          from: 方向 === 'en-zh' ? '英文' : '中文', to: 方向 === 'en-zh' ? '中文' : '英文',
        };
        const 选中模型 = 选项.模型 || 依赖.默认模型;
        if (选中模型) 报文.模型 = 选中模型;
        let reply;
        try { reply = await 译(报文); }
        catch (error) { return fail(ERR.ENGINE_FAILED, error.message, 原文); }
        模型 = reply && reply.模型 || null;
        const rows = reply && Array.isArray(reply.units) ? reply.units : [];
        const translated = new Map(rows.map(row => [row.id, row.text]));
        for (const row of 待译) {
          const text = translated.get(row.标识);
          if (typeof text !== 'string' || !text.trim()) return fail(ERR.ENGINE_FAILED, '单元 ' + row.标识 + ' 没有译文', 原文);
          row.模型译文 = text;
          row.译文 = text;
          row.出处 = '模型';
        }
      }
      return ok({
        ...文本处理.拼装(原文, 表), 原文, 方向, 模型, 出处: '逐格',
        统计: {
          格: 表.length, 有内容: 格们.length,
          库里查到: 格们.filter(row => row.出处 === '库').length,
          模型译出: 待译.length,
          照抄原词: 格们.filter(row => row.出处 === '原词').length,
        },
      });
    } catch (error) { return fail(ERR.ENGINE_FAILED, error.message, 原文); }
    finally { 在飞 = false; }
  }

  function 看模型() {
    return ok({ 可用: Boolean(译), 缺: 译 ? [] : ['译'], 模型: 依赖.默认模型 || null, 有查词: Boolean(查词) });
  }
  return { 本地译, 看模型, 切分: 输入 => 文本处理.切分(输入.文本), 猜方向: 文本处理.猜方向 };
}
module.exports = { createCore, ERR, SAY, 收单元 };
