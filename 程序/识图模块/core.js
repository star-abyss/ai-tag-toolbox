'use strict';
/*
 * 识图模块 · 核心。纯逻辑：不 require fs / path，不 require 别的模块。
 *
 * 四个动作：
 *   认图    本地模型打标：图 → 一批标签（过阈值、按概率排）
 *   读元数据  AI 画的图里藏着的提示词 / 工作流 / 参数，直接读出来
 *   看图    把图交给模型看（离线那台或远端那台），要标签与描述
 *   看模型   这一格备齐了没有（本地引擎、带不带看图的链路、模型装没装）
 *
 * 端口（都由装配层递进来，模块自己不找路径、不认别的模块）：
 *   取图字节(引用) → { 字节, mime? }
 *   查词(词列表)   → 中文名 或 null 的数组
 *   tagger        本地打标引擎：{ 打标(字节, 选项) → { 标签:[{词,概率,分类}], 尺寸, 阈值 } }
 *   看图          交给模型看图的函数：({ 图, 提示, 参考标签 }) → { 标签, 描述 }
 *
 * 返回：成功 { ok:true, data }；失败 { ok:false, code, reason }。
 */

const ERR = Object.freeze({
  NO_ENGINE: 'VISION_NO_ENGINE',
  NO_VIEWER: 'VISION_NO_VIEWER',
  NO_BYTES: 'VISION_NO_BYTES',
  BAD_REF: 'VISION_BAD_REF',
  ENGINE_FAILED: 'VISION_ENGINE_FAILED',
  VIEW_FAILED: 'VISION_VIEW_FAILED',
  BAD_ARGUMENT: 'VISION_BAD_ARGUMENT',
  BAD_METADATA: 'VISION_BAD_METADATA',
});

const SAY = Object.freeze({
  [ERR.NO_ENGINE]: '没有本地打标模型',
  [ERR.NO_VIEWER]: '没有看图的链路',
  [ERR.NO_BYTES]: '取不到图的字节',
  [ERR.BAD_REF]: '图引用不对',
  [ERR.ENGINE_FAILED]: '本地打标失败',
  [ERR.VIEW_FAILED]: '看图那条链路失败',
  [ERR.BAD_ARGUMENT]: '参数不对',
  [ERR.BAD_METADATA]: '不是能读的 PNG',
});

const ok = (data) => ({ ok: true, data: data === undefined ? null : data });
const fail = (码, 话) => ({ ok: false, code: 码, reason: `${码}: ${话}` });

/** 分类号 → 人话。WD 系模型的老规矩。 */
const 分类名 = Object.freeze({
  0: '普通',
  1: '画师',
  2: '作品',
  3: '角色',
  4: '元数据',
  9: '分级',
});

/**
 * 图引用收成 `{ 作用域, 条目ID }`。
 * 对外的参数是**扁平的**（模型只能填字符串，填不了对象）：存放地 / 条目ID / 会话ID。
 * 也认已经收好的 `{ 作用域, 条目ID }`（界面与别的模块这么给）。
 * @param {object} 输入
 * @returns {{作用域:object, 条目ID:string}|null}
 */
function 收引用(输入 = {}) {
  const 条目ID = String(输入.条目ID || '').trim();
  if (!条目ID) return null;

  // 已经收好的那一份
  if (输入.作用域 && typeof 输入.作用域 === 'object' && !Array.isArray(输入.作用域)) {
    return { 作用域: 输入.作用域, 条目ID };
  }

  const 存放地 = String(输入.存放地 || '').trim();
  if (!存放地) return null;
  if (!['session', 'gallery', 'vision'].includes(存放地)) return null;
  if (存放地 === 'session') {
    const 会话ID = String(输入.会话ID || '').trim();
    return { 作用域: { 存放地, 会话ID: 会话ID || '_' }, 条目ID };
  }
  return { 作用域: { 存放地 }, 条目ID };
}

/** 阈值：给了就用给的，没给用模型的，再没有给 0.35。 */
function 收阈值(给, 模型的) {
  const 值 = Number(给);
  if (Number.isFinite(值) && 值 > 0 && 值 <= 1) return 值;
  const 模型值 = Number(模型的);
  if (Number.isFinite(模型值) && 模型值 > 0 && 模型值 <= 1) return 模型值;
  return 0.35;
}

/** 上限：给了就用给的，没给就是全要。 */
function 收上限(给) {
  const 值 = Number(给);
  return Number.isInteger(值) && 值 > 0 ? 值 : 0;
}

/**
 * @param {object} 依赖
 *   取图字节  必 (引用) → { 字节, mime? } 或 Promise
 *   查词      选 (词列表) → 中文名 或 null 的数组
 *   tagger    选 本地打标引擎
 *   看图      选 交给模型看图
 *   引擎      选 引擎说明（哪一格模型），只用于"看模型"那一问
 *   默认阈值   选
 */
function createCore(依赖 = {}) {
  const 取图字节 = typeof 依赖.取图字节 === 'function' ? 依赖.取图字节 : null;
  const 查词函数 = typeof 依赖.查词 === 'function' ? 依赖.查词 : null;
  const tagger = 依赖.tagger && typeof 依赖.tagger.打标 === 'function' ? 依赖.tagger : null;
  const 看图函数 = typeof 依赖.看图 === 'function' ? 依赖.看图 : null;
  const 引擎说明 = 依赖.引擎 && typeof 依赖.引擎 === 'object' ? 依赖.引擎 : null;

  /** 把英文标签换成中文名；没给查词就一律 null（形状稳定，JSON 里不会缺字段）。 */
  function 配中文(标签们) {
    if (!查词函数 || !标签们.length) return 标签们.map((一) => ({ ...一, 中文名: 一.中文名 ?? null }));
    let 中文们 = [];
    try {
      中文们 = 查词函数(标签们.map((一) => 一.词)) || [];
    } catch (_) {
      中文们 = [];
    }
    return 标签们.map((一, i) => {
      const 名 = Array.isArray(中文们) ? 中文们[i] : null;
      return { ...一, 中文名: typeof 名 === 'string' && 名.trim() ? 名.trim() : null };
    });
  }

  /** 把引擎交回来的标签收成我们的形状。一项可以是词本身，也可以是带字段的一条。 */
  function 收标签(标签们) {
    const 列 = Array.isArray(标签们) ? 标签们 : [];
    return 列.map((一) => {
      if (typeof 一 === 'string') return { 词: 一.trim(), 概率: null, 分类号: 0, 分类: '普通' };
      const 词 = String((一 && (一.词 || 一.tag || 一.name)) || '').trim();
      const 概率 = Number(一 && (一.概率 === undefined ? 一.prob : 一.概率));
      const 分类 = 一 && 一.分类 !== undefined ? 一.分类 : 一 && 一.category;
      return {
        词,
        概率: Number.isFinite(概率) ? Math.round(概率 * 10000) / 10000 : null,
        分类号: Number.isFinite(Number(分类)) ? Number(分类) : 0,
        分类: 分类名[Number(分类)] || '普通',
      };
    }).filter((一) => 一.词);
  }

  /** 拿一次图字节。 */
  async function 要字节(引用) {
    const 出 = await 取图字节(引用);
    if (!出) return null;
    const 字节 = 出.字节 || 出.bytes || 出.data || null;
    if (!字节) return null;
    return { 字节, mime: typeof 出.mime === 'string' ? 出.mime : '' };
  }

  /** 认图：本地打标。 */
  async function 认图(输入 = {}) {
    const 引用 = 收引用(输入);
    if (!引用) return fail(ERR.BAD_REF, `${SAY[ERR.BAD_REF]}：要 存放地 与 条目ID`);
    if (!tagger) return fail(ERR.NO_ENGINE, SAY[ERR.NO_ENGINE]);
    if (!取图字节) return fail(ERR.NO_BYTES, '没有取图字节的端口');

    let 一份 = null;
    try {
      一份 = await 要字节(引用);
    } catch (error) {
      return fail(ERR.NO_BYTES, `取图失败：${(error && error.message) || error}`);
    }
    if (!一份) return fail(ERR.NO_BYTES, SAY[ERR.NO_BYTES]);

    const 阈值 = 收阈值(输入.阈值, 引擎说明 && 引擎说明.阈值);
    let 出 = null;
    try {
      出 = await tagger.打标(一份.字节, { 阈值, 上限: 收上限(输入.上限) });
    } catch (error) {
      return fail(ERR.ENGINE_FAILED, `${SAY[ERR.ENGINE_FAILED]}：${(error && error.message) || error}`);
    }
    const 标签 = 配中文(收标签(出 && 出.标签));
    return ok({
      引用,
      标签,
      总数: 标签.length,
      阈值,
      尺寸: (出 && 出.尺寸) || null,
      模型: (引擎说明 && 引擎说明.名字) || (出 && 出.模型) || null,
    });
  }

  /** 读元数据：把图里的提示词 / 工作流读出来。 */
  async function 读元数据(输入 = {}) {
    const 直接给字节 = 输入.字节 !== undefined;
    const 引用 = 直接给字节 ? null : 收引用(输入);
    if (!直接给字节 && !引用) return fail(ERR.BAD_REF, `${SAY[ERR.BAD_REF]}：要 存放地 与 条目ID`);
    let 一份 = null;
    if (!直接给字节) {
      if (!取图字节) return fail(ERR.NO_BYTES, '没有取图字节的端口');
      try {
        一份 = await 要字节(引用);
      } catch (error) {
        return fail(ERR.NO_BYTES, `取图失败：${(error && error.message) || error}`);
      }
      if (!一份 || 一份.字节 == null) return fail(ERR.NO_BYTES, SAY[ERR.NO_BYTES]);
    }
    const 字节 = 直接给字节 ? 输入.字节 : 一份.字节;
    if (字节 == null) return fail(ERR.NO_BYTES, SAY[ERR.NO_BYTES]);

    if (typeof 依赖.读元数据 === 'function') {
      let 读 = null;
      try {
        读 = 依赖.读元数据(字节);
      } catch (error) {
        return fail(ERR.BAD_METADATA, `${SAY[ERR.BAD_METADATA]}：${(error && error.message) || error}`);
      }
      if (!读 || 读.说明) return fail(ERR.BAD_METADATA, (读 && 读.说明) || SAY[ERR.BAD_METADATA]);
      return ok({ 引用, ...读 });
    }
    return fail(ERR.BAD_METADATA, '没有读元数据的端口');
  }

  /** 看图：交给模型。 */
  async function 看图(输入 = {}) {
    const 引用 = 收引用(输入);
    if (!引用) return fail(ERR.BAD_REF, `${SAY[ERR.BAD_REF]}：要 存放地 与 条目ID`);
    if (!看图函数) return fail(ERR.NO_VIEWER, SAY[ERR.NO_VIEWER]);
    if (!取图字节) return fail(ERR.NO_BYTES, '没有取图字节的端口');

    let 一份 = null;
    try {
      一份 = await 要字节(引用);
    } catch (error) {
      return fail(ERR.NO_BYTES, `取图失败：${(error && error.message) || error}`);
    }
    if (!一份) return fail(ERR.NO_BYTES, SAY[ERR.NO_BYTES]);

    let 回 = null;
    try {
      回 = await 看图函数({
        引用,
        字节: 一份.字节,
        mime: 一份.mime,
        提示: typeof 输入.提示 === 'string' ? 输入.提示 : '',
        参考标签: Array.isArray(输入.参考标签) ? 输入.参考标签.map((一) => String(一)) : [],
      });
    } catch (error) {
      return fail(ERR.VIEW_FAILED, `${SAY[ERR.VIEW_FAILED]}：${(error && error.message) || error}`);
    }
    const 标签 = 配中文(收标签(回 && 回.标签));
    return ok({
      引用,
      标签,
      描述: String((回 && (回.描述 || 回.说明 || 回.text)) || ''),
      模型: (回 && 回.模型) || null,
      用量: (回 && 回.用量) || null,
    });
  }

  /** 看模型：这一格备齐了没有。 */
  function 看模型() {
    const 缺 = [];
    if (!取图字节) 缺.push('取图字节');
    if (!tagger) 缺.push('本地打标');
    if (!看图函数) 缺.push('看图');
    return ok({
      可用: 缺.length === 0,
      缺,
      能本地打标: Boolean(tagger),
      能读元数据: typeof 依赖.读元数据 === 'function',
      能看图: Boolean(看图函数),
      有查词: Boolean(查词函数),
      模型: 引擎说明 ? { id: 引擎说明.id || null, 名字: 引擎说明.名字 || null } : null,
    });
  }

  return { 认图, 读元数据, 看图, 看模型, ERR, SAY };
}

module.exports = { createCore, ERR, SAY, 分类名 };
