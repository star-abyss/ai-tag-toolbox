'use strict';
/*
 * 图片模块 · 核心。纯逻辑：不 require fs / path。
 *
 * 本模块做一件事：图片的存放与取回。
 *
 * 三个存放地，各是一个目录：
 *   session/<会话ID>/   对话图片
 *   gallery/            图库
 *   vision/             识图工作区
 *
 * 一个条目 = 一个目录，里面 original / preview / thumbnail / meta.json。
 * 存一条：写进 .staging/<条目ID>/，整目录改名到存放地。
 * 删一条：整目录改名进 .deleting/<批次>/，整批交回收站。
 *
 * 列：读一次目录，返回 { 引用, 标识, 修改时间 }。
 * 取详情：读一个条目的 meta.json。
 *
 * 返回：成功 { ok:true, data }；失败 { ok:false, reason, code }。
 */

const ENTRY_ID_RE = /^img_[A-Za-z0-9-]+$/;
const 暂存们 = ['.staging', '.deleting'];
const 存放地们 = ['session', 'gallery', 'vision'];
const 变体们 = ['original', 'preview', 'thumbnail'];
const 副档版本 = 1;
const 表名们 = ['收藏', '分类'];

/** 错误码表：键是码名，值是码串。 */
const ERR = {
  ROOT_REQUIRED: 'IMAGE_ROOT_REQUIRED',
  BAD_SCOPE: 'INVALID_SCOPE',
  BAD_PATH: 'INVALID_IMAGE_PATH',
  NOT_FOUND: 'IMAGE_NOT_FOUND',
  VARIANT_MISSING: 'IMAGE_VARIANT_MISSING',
  BAD_VARIANT: 'INVALID_IMAGE_VARIANT',
  BYTES_REQUIRED: 'IMAGE_BYTES_REQUIRED',
  METADATA_UNREADABLE: 'IMAGE_METADATA_UNREADABLE',
  WRITE_FAILED: 'IMAGE_WRITE_FAILED',
  TRASH_REQUIRED: 'IMAGE_TRASH_REQUIRED',
  REMOVE_FAILED: 'IMAGE_REMOVE_FAILED',
  RESIDUE_PRESENT: 'IMAGE_RESIDUE_PRESENT',
  PROCESSING_FAILED: 'IMAGE_PROCESSING_FAILED',
  BAD_TABLE: 'INVALID_TABLE',
  BAD_ARGUMENT: 'INVALID_ARGUMENT',
  SESSION_NUMBER_UNREADABLE: 'IMAGE_SESSION_NUMBER_UNREADABLE',
};

const ok = (data) => ({ ok: true, data: data === undefined ? null : data });
const fail = (码, 话, 细节) => ({
  ok: false,
  reason: `${码}: ${话 || 码}`,
  code: 码,
  ...(细节 === undefined ? {} : { details: 细节 }),
});

const 深拷贝 = (v) => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** 取文件名的最后一段，限长 180，空则用 image.png。 */
function 清理文件名(值) {
  const 文本 = String(值 == null ? '' : 值).split(/[\\/]/).pop().trim();
  return (文本 || 'image.png').slice(0, 180);
}

const MIME表 = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif',
};
const 反向MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/avif': 'avif' };

/** 由 mime 与文件名推一个扩展名串。 */
function 扩展名(名字, mime) {
  const m = 反向MIME[String(mime || '').toLowerCase()];
  if (m) return m;
  const 抓 = /\.([A-Za-z0-9]{1,8})$/.exec(String(名字 || ''));
  return 抓 ? 抓[1].toLowerCase() : 'bin';
}

/** 是不是一个条目目录名。 */
const 是条目名 = (名字) => ENTRY_ID_RE.test(String(名字 || ''));

/** 一个 Buffer 过一趟 JSON 之后的样子：`{ type:'Buffer', data:[…] }`。 */
function 是Buffer包(值) {
  return Boolean(值) && typeof 值 === 'object' && !Buffer.isBuffer(值)
    && (值.type === 'Buffer' || 值.type === 'Uint8Array') && Array.isArray(值.data);
}

/**
 * 把一次调用给的"内容"收成字节。给不出字节就给 null。
 *
 * 三种形状：Buffer / Uint8Array；`data:<mime>;base64,<…>`；或者一串光秃秃的 base64。
 * 还有 Buffer 过 JSON 之后的那层包。其余（比如盘上的路径、随手一串字）不算内容。
 * @param {*} 源 调用参数
 */
function 收字节(源) {
  const 给 = 源 || {};
  for (const 值 of [给.字节, 给.dataUrl]) {
    if (Buffer.isBuffer(值)) return 值;
    if (值 instanceof Uint8Array) return Buffer.from(值);
    if (是Buffer包(值)) return Buffer.from(值.data);
  }
  const 文本 = [给.dataUrl, 给.字节].find((x) => typeof x === 'string' && x.trim());
  if (!文本) return null;
  const 裸 = 文本.replace(/^data:[^;,]*;base64,/s, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(裸)) return null;
  return Buffer.from(裸, 'base64');
}

function createCore(依赖 = {}) {
  const port = 依赖.port;
  /** 图片处理器：(字节, 限长) → { preview:{字节,mime}, thumbnail:{字节,mime} } */
  const 处理图片 = 依赖.处理图片 || null;
  /** 交回收站：(位置串) → Promise */
  const 交回收站 = 依赖.交回收站 || null;
  const 新标识 = 依赖.新标识 || (() => `img_${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  const 校验和 = 依赖.校验和 || null;
  const 现在 = 依赖.现在 || (() => new Date().toISOString());

  /* 写操作串行：一条队列，按调用顺序执行。 */
  let 队尾 = Promise.resolve();
  function 排队(做) {
    const 结果 = 队尾.then(() => {
      try {
        return 做();
      } catch (error) {
        return fail(ERR.WRITE_FAILED, (error && error.message) || '写操作出错');
      }
    });
    队尾 = 结果.then(() => undefined, () => undefined);
    return 结果;
  }

  // ------------------------------------------------------------ 作用域

  /**
   * 把输入规范成作用域。
   * 对话作用域没给会话 ID 时用 `_`。
   */
  function 作用域(输入) {
    const s = 输入 || {};
    if (s.暂存) {
      if (!暂存们.includes(s.暂存)) return fail(ERR.BAD_SCOPE, `不是临时位置：${s.暂存}`);
      if (s.批次) {
        const 批 = String(s.批次);
        if (!/^[A-Za-z0-9._-]+$/.test(批) || 批 === '.' || 批 === '..') {
          return fail(ERR.BAD_PATH, `批次不是安全的一段：${批}`);
        }
        return ok({ 暂存: s.暂存, 批次: 批 });
      }
      return ok({ 暂存: s.暂存 });
    }
    if (!存放地们.includes(s.存放地)) return fail(ERR.BAD_SCOPE, `不是存放地：${s.存放地}`);
    if (s.存放地 === 'session') {
      const 会 = String(s.会话ID == null ? '' : s.会话ID).trim() || '_';
      if (!/^[A-Za-z0-9._-]+$/.test(会) || 会 === '.' || 会 === '..') {
        return fail(ERR.BAD_PATH, `会话 ID 不是安全的一段：${s.会话ID}`);
      }
      return ok({ 存放地: 'session', 会话ID: 会 });
    }
    if (s.会话ID) return fail(ERR.BAD_SCOPE, `${s.存放地} 没有会话 ID 这一层`);
    return ok({ 存放地: s.存放地 });
  }

  const 作用域描述 = (域) => (域.暂存
    ? { 暂存: 域.暂存, ...(域.批次 ? { 批次: 域.批次 } : {}) }
    : { 存放地: 域.存放地, ...(域.会话ID ? { 会话ID: 域.会话ID } : {}) });

  const 引用描述 = (域, 条目ID) => ({ 作用域: 作用域描述(域), 条目ID });

  // ------------------------------------------------------------ 副档

  /** 读副档。返回 { state, value?, reason? }。 */
  function 读副档(域, 条目ID) {
    const r = port.readText(域, `${条目ID}/meta.json`);
    if (r.state === 'missing') return { state: 'missing' };
    if (r.state === 'unreadable') return { state: 'unreadable', reason: r.reason };
    let 值;
    try {
      值 = JSON.parse(r.value);
    } catch (_) {
      return { state: 'unreadable', reason: 'parse' };
    }
    if (!值 || typeof 值 !== 'object') return { state: 'unreadable', reason: 'shape' };
    if (Number(值.format) !== 副档版本) return { state: 'unreadable', reason: `format=${值.format}` };
    return { state: 'ok', value: 值 };
  }

  const 写副档 = (域, 条目ID, 值) => port.writeText(域, `${条目ID}/meta.json`, `${JSON.stringify(值, null, 2)}\n`);

  /** 条目对外的字段。 */
  const 描述 = (域, 值) => ({
    引用: 引用描述(域, 值.entryId),
    标识: 值.entryId,
    文件名: 值.filename,
    显示名: 值.displayName || 值.filename,
    mime: 值.mime,
    宽: 值.width || 0,
    高: 值.height || 0,
    字节数: 值.fileSize || 0,
    校验和: 值.checksum || '',
    来源: 值.source || '',
    元数据: 深拷贝(值.metadata || {}),
    变体: 深拷贝(值.variants || {}),
    创建时间: 值.createdAt,
    更新时间: 值.updatedAt,
    ...(域.存放地 === 'session' && Number.isSafeInteger(值.sessionNumber) ? { 图号: 值.sessionNumber } : {}),
  });

  // ------------------------------------------------------------ 定位

  /** 定位一个条目：查目录，不读副档。 */
  function 定位(输入) {
    const 源 = 输入 || {};
    const 引用 = 源.引用 || 源;
    const 域 = 作用域(引用.作用域 || { 存放地: 源.存放地, 会话ID: 源.会话ID });
    if (!域.ok) return 域;
    const 条目ID = String(引用.条目ID || 源.条目ID || 源.标识 || '');
    if (!是条目名(条目ID)) return fail(ERR.NOT_FOUND, `不是合法的条目 ID：${条目ID || '(空)'}`);
    if (port.stat(域.data, 条目ID).state !== 'ok') {
      return fail(ERR.NOT_FOUND, `条目不存在：${条目ID}`, { 引用: 引用描述(域.data, 条目ID) });
    }
    return ok({ 域: 域.data, 条目ID });
  }

  /** 定位并读副档。 */
  function 找条目(输入) {
    const 找 = 定位(输入);
    if (!找.ok) return 找;
    const 档 = 读副档(找.data.域, 找.data.条目ID);
    if (档.state === 'missing') return fail(ERR.NOT_FOUND, `副档不见了：${找.data.条目ID}`, { 引用: 引用描述(找.data.域, 找.data.条目ID) });
    if (档.state === 'unreadable') return fail(ERR.METADATA_UNREADABLE, `副档读不懂（${档.reason}），本条目的写已冻结：${找.data.条目ID}`, { 引用: 引用描述(找.data.域, 找.data.条目ID) });
    return ok({ 域: 找.data.域, 条目ID: 找.data.条目ID, 档: 档.value });
  }

  /** 定位到某个变体的文件。 */
  function 取文件(输入) {
    const 找 = 找条目(输入);
    if (!找.ok) return 找;
    const 变体 = String((输入 && 输入.变体) || 'original');
    if (!变体们.includes(变体)) return fail(ERR.BAD_VARIANT, `没有这个变体：${变体}`, { 变体们 });
    const 文件名 = (找.data.档.variants || {})[变体];
    if (!文件名) return fail(ERR.VARIANT_MISSING, `这个条目的 ${变体} 不存在`, { 变体, 有的变体: Object.keys(找.data.档.variants || {}) });
    const 相对 = `${找.data.条目ID}/${文件名}`;
    if (port.stat(找.data.域, 相对).state !== 'ok') return fail(ERR.VARIANT_MISSING, `${变体} 文件不在了：${相对}`);
    return ok({ ...找.data, 变体, 相对, mime: 找.data.档.mime, 文件名: 找.data.档.filename });
  }

  // ------------------------------------------------------------ 取内容 / 取地址

  /** 取内容：返回字节。 */
  function 取内容(输入) {
    const 找 = 取文件(输入);
    if (!找.ok) return 找;
    const r = port.readBinary(找.data.域, 找.data.相对);
    if (r.state === 'missing') return fail(ERR.VARIANT_MISSING, `文件不在了：${找.data.相对}`);
    if (r.state === 'unreadable') return fail(ERR.WRITE_FAILED, `读不出来（${r.reason}）：${找.data.相对}`);
    return ok({
      引用: 引用描述(找.data.域, 找.data.条目ID),
      变体: 找.data.变体,
      字节: r.value,
      mime: 找.data.mime,
      文件名: 找.data.文件名,
    });
  }

  /** 取地址：返回位置串。 */
  function 取地址(输入) {
    const 找 = 取文件(输入);
    if (!找.ok) return 找;
    const 路径 = port.全路径(找.data.域, 找.data.相对);
    if (!路径.ok) return fail(ERR.BAD_PATH, 路径.reason);
    return ok({
      引用: 引用描述(找.data.域, 找.data.条目ID),
      变体: 找.data.变体,
      地址: 路径.值,
      mime: 找.data.mime,
      文件名: 找.data.文件名,
    });
  }

  // ------------------------------------------------------------ 列 / 取详情

  /** 目录里有没有原图（只看目录名，不读文件内容）。 */
  function 有原图(域, 条目ID) {
    const 目录 = port.list(域, 条目ID);
    return (目录.files || []).some((f) => /^original\.[A-Za-z0-9]+$/.test(f));
  }

  /** 条目完整吗：meta.json 与原图都在。只 stat，不读内容。 */
  function 完整吗(域, 条目ID) {
    if (port.stat(域, `${条目ID}/meta.json`).state !== 'ok') return false;
    return 有原图(域, 条目ID);
  }

  /** 列：读一次目录，逐条 stat，给 { 条目, 总数, 作用域 }。 */
  function 列(输入) {
    const 域 = 作用域((输入 && 输入.作用域) || {});
    if (!域.ok) return 域;
    const 目录 = port.list(域.data);
    if (!目录.ok) return fail(ERR.BAD_SCOPE, 目录.reason);
    const 条目 = [];
    for (const 名 of 目录.dirs) {
      if (!是条目名(名)) continue;
      const s = port.stat(域.data, 名);
      if (s.state !== 'ok') continue;
      条目.push({
        引用: 引用描述(域.data, 名),
        标识: 名,
        修改时间: s.mtime || 0,
        完整: 完整吗(域.data, 名),
      });
    }
    // 按修改时间升序，同一时间按标识排
    条目.sort((a, b) => (a.修改时间 - b.修改时间) || a.标识.localeCompare(b.标识));
    return ok({ 条目, 总数: 条目.length, 作用域: 作用域描述(域.data) });
  }

  const 会话图号版本 = 1;
  function 读图号状态(域) {
    const r = port.readText(域, 'scope.json');
    if (r.state === 'missing') return { state: 'missing', highWater: 0 };
    if (r.state !== 'ok') return { state: 'unreadable', reason: r.reason || 'read' };
    try {
      const 值 = JSON.parse(r.value);
      if (!值 || 值.format !== 会话图号版本 || !Number.isSafeInteger(值.highWater) || 值.highWater < 0) {
        return { state: 'unreadable', reason: 'shape' };
      }
      return { state: 'ok', highWater: 值.highWater };
    } catch (_) {
      return { state: 'unreadable', reason: 'parse' };
    }
  }

  function 写图号状态(域, highWater) {
    const r = port.writeText(域, 'scope.json', `${JSON.stringify({ format: 会话图号版本, highWater }, null, 2)}\n`);
    return r.ok ? ok() : fail(ERR.WRITE_FAILED, `写会话图号状态失败：${r.reason}`);
  }

  /** 首次列会话图时，为既有会话素材补齐图号；编号事实保存在条目副档与会话高水位。 */
  function 确保会话图号(域) {
    const 列过 = 列({ 作用域: 作用域描述(域) });
    if (!列过.ok) return 列过;
    const 有号 = new Set();
    const 需补 = [];
    let 已见最大 = 0;
    for (const 条 of 列过.data.条目) {
      const 档 = 读副档(域, 条.标识);
      if (档.state === 'missing') return fail(ERR.NOT_FOUND, `副档不见了：${条.标识}`);
      if (档.state === 'unreadable') return fail(ERR.METADATA_UNREADABLE, `副档读不懂（${档.reason}）：${条.标识}`);
      const n = 档.value.sessionNumber;
      if (n === undefined || n === null) { 需补.push({ 条, 值: 档.value }); continue; }
      if (!Number.isSafeInteger(n) || n < 1 || 有号.has(n)) {
        return fail(ERR.SESSION_NUMBER_UNREADABLE, `会话图号重复或无效：${条.标识} / ${n}`);
      }
      有号.add(n);
      已见最大 = Math.max(已见最大, n);
    }
    const 状态 = 读图号状态(域);
    if (状态.state === 'unreadable') return fail(ERR.SESSION_NUMBER_UNREADABLE, `会话图号状态读不懂：${状态.reason}`);
    let highWater = Math.max(状态.highWater, 已见最大);
    if (状态.state === 'missing' || highWater !== 状态.highWater) {
      const 写 = 写图号状态(域, highWater);
      if (!写.ok) return 写;
    }
    for (const 项 of 需补) {
      highWater++;
      if (!Number.isSafeInteger(highWater)) return fail(ERR.SESSION_NUMBER_UNREADABLE, '会话图号超出安全整数范围');
      const 写状态 = 写图号状态(域, highWater);
      if (!写状态.ok) return 写状态;
      const 更新 = { ...项.值, sessionNumber: highWater };
      const 写档 = 写副档(域, 项.条.标识, 更新);
      if (!写档.ok) return fail(ERR.WRITE_FAILED, `写图号副档失败：${写档.reason}`);
    }
    const 条目 = 列过.data.条目.map((条) => {
      const 详情 = 读副档(域, 条.标识);
      return {
        ...条,
        图号: 详情.value.sessionNumber,
        文件名: 详情.value.filename,
        显示名: 详情.value.displayName || 详情.value.filename,
        宽: Number(详情.value.width) || 0,
        高: Number(详情.value.height) || 0,
      };
    }).sort((a, b) => a.图号 - b.图号);
    const 最新状态 = 读图号状态(域);
    if (最新状态.state === 'unreadable') return fail(ERR.SESSION_NUMBER_UNREADABLE, `会话图号状态读不懂：${最新状态.reason}`);
    return ok({ 条目, 总数: 条目.length, 作用域: 作用域描述(域), 高水位: 最新状态.highWater });
  }

  function 列会话图(输入) {
    const 域 = 作用域((输入 && 输入.作用域) || {});
    if (!域.ok) return Promise.resolve(域);
    if (域.data.存放地 !== 'session') return Promise.resolve(fail(ERR.BAD_SCOPE, '图号只属于会话作用域'));
    return 排队(() => 确保会话图号(域.data));
  }

  function 按图号取详情(输入) {
    const 域 = 作用域((输入 && 输入.作用域) || {});
    if (!域.ok) return Promise.resolve(域);
    if (域.data.存放地 !== 'session') return Promise.resolve(fail(ERR.BAD_SCOPE, '图号只属于会话作用域'));
    const 图号 = Number(输入 && 输入.图号);
    if (!Number.isSafeInteger(图号) || 图号 < 1) return Promise.resolve(fail(ERR.BAD_ARGUMENT, '图号必须是正整数'));
    return 排队(() => {
      const 列过 = 确保会话图号(域.data);
      if (!列过.ok) return 列过;
      const 条 = 列过.data.条目.find((x) => x.图号 === 图号);
      return 条 ? 取详情({ 引用: 条.引用 }) : fail(ERR.NOT_FOUND, `图 ${图号} 不存在`);
    });
  }

  function 恢复会话图号(输入) {
    const 域 = 作用域((输入 && 输入.作用域) || {});
    if (!域.ok) return Promise.resolve(域);
    if (域.data.存放地 !== 'session') return Promise.resolve(fail(ERR.BAD_SCOPE, '图号只属于会话作用域'));
    const 给定 = Number(输入 && 输入.高水位);
    if (!Number.isSafeInteger(给定) || 给定 < 0) return Promise.resolve(fail(ERR.BAD_ARGUMENT, '高水位必须是非负整数'));
    return 排队(() => {
      const 已有 = 确保会话图号(域.data);
      if (!已有.ok) return 已有;
      const 状态 = 读图号状态(域.data);
      if (状态.state === 'unreadable') return fail(ERR.SESSION_NUMBER_UNREADABLE, `会话图号状态读不懂：${状态.reason}`);
      const highWater = Math.max(状态.highWater, 给定);
      const 写 = 写图号状态(域.data, highWater);
      return 写.ok ? ok({ 高水位: highWater }) : 写;
    });
  }

  /** 取详情：读那一个副档，给完整描述符。 */
  function 取详情(输入) {
    const 找 = 找条目(输入);
    if (!找.ok) return 找;
    if (!有原图(找.data.域, 找.data.条目ID)) {
      return fail(ERR.VARIANT_MISSING, `条目不完整：缺原图`, { 引用: 引用描述(找.data.域, 找.data.条目ID) });
    }
    return ok(描述(找.data.域, 找.data.档));
  }

  // ------------------------------------------------------------ 存

  /** 调处理器生成派生变体。 */
  function 派生变体(字节) {
    if (typeof 处理图片 !== 'function') return ok({});
    let 结果;
    try {
      结果 = 处理图片(字节, { preview: 1600, thumbnail: 320 });
    } catch (error) {
      return fail(ERR.PROCESSING_FAILED, (error && error.message) || '处理器出错');
    }
    if (!结果 || typeof 结果 !== 'object') return fail(ERR.PROCESSING_FAILED, '处理器没给出结果');
    return ok(结果);
  }

  /**
   * 存一张。
   * 顺序：建暂存目录 → 写原图 → 写派生变体 → 写副档 → 整目录改名到存放地。
   */
  function 存(输入) {
    const 源 = 输入 || {};
    const 域 = 作用域(源.作用域 || {});
    if (!域.ok) return 域;

    // 字节从 `字节` 或 `dataUrl` 两处来，形状见 收字节。
    // 名字对不上时按形状认：`字节` 位上给了一串 `data:` 开头的字，就是 dataUrl。
    const 字节 = 收字节(源);
    if (!字节 || !字节.length) return fail(ERR.BYTES_REQUIRED, '没有可存的内容：给字节，或给 dataUrl');

    const 文件名 = 清理文件名(源.文件名);
    const mime = String(源.mime || '').trim() || MIME表[扩展名(文件名)] || 'application/octet-stream';
    const ext = 扩展名(文件名, mime);
    const 条目ID = String(新标识());
    if (!是条目名(条目ID)) return fail(ERR.BAD_PATH, `生成的条目 ID 不合法：${条目ID}`);

    return 排队(() => {
      if (依赖.接收作用域) { const 接收 = 依赖.接收作用域(深拷贝(域.data)); if (!接收.ok) return 接收; }
      let 图号;
      const 暂存 = { 暂存: '.staging' };
      const 建 = port.mkdir(暂存, 条目ID);
      if (!建.ok) return fail(ERR.WRITE_FAILED, `建暂存目录失败：${建.reason}`);

      const 收拾 = (话, 码) => {
        port.removeDir(暂存, 条目ID);
        return fail(码 || ERR.WRITE_FAILED, 话);
      };

      const 变体文件 = { original: `original.${ext}` };
      const 写原图 = port.writeBinary(暂存, `${条目ID}/${变体文件.original}`, 字节);
      if (!写原图.ok) return 收拾(`写原图失败：${写原图.reason}`);

      const 派生 = 派生变体(字节);
      if (!派生.ok) return 收拾(派生.reason, ERR.PROCESSING_FAILED);
      for (const 名 of ['preview', 'thumbnail']) {
        const 图 = 派生.data[名];
        if (!图 || !图.字节) continue;
        const 存名 = `${名}.${扩展名('', 图.mime || mime)}`;
        const w = port.writeBinary(暂存, `${条目ID}/${存名}`, 图.字节);
        if (!w.ok) return 收拾(`写 ${名} 失败：${w.reason}`);
        变体文件[名] = 存名;
      }

      if (域.data.存放地 === 'session') {
        const 已有 = 确保会话图号(域.data);
        if (!已有.ok) return 收拾(已有.reason, 已有.code);
        const 状态 = 读图号状态(域.data);
        if (状态.state === 'unreadable') return 收拾(`会话图号状态读不懂：${状态.reason}`, ERR.SESSION_NUMBER_UNREADABLE);
        if (Number.isSafeInteger(源._导入图号) && 源._导入图号 > 0) {
          图号 = 源._导入图号;
          if (图号 <= 状态.highWater || 已有.data.条目.some((条) => 条.图号 === 图号)) {
            return 收拾(`会话图号不能复用或倒序导入：${图号} / ${状态.highWater}`, ERR.BAD_ARGUMENT);
          }
        } else {
          图号 = 状态.highWater + 1;
        }
        if (!Number.isSafeInteger(图号)) return 收拾('会话图号超出安全整数范围', ERR.SESSION_NUMBER_UNREADABLE);
        const 写状态 = 写图号状态(域.data, Math.max(状态.highWater, 图号));
        if (!写状态.ok) return 收拾(写状态.reason, 写状态.code);
      }

      const 时间 = 现在();
      const 值 = {
        format: 副档版本,
        entryId: 条目ID,
        filename: 文件名,
        displayName: String(源.显示名 || '').trim().slice(0, 180) || 文件名,
        mime,
        extension: ext,
        width: Number(源.宽) || 0,
        height: Number(源.高) || 0,
        fileSize: 字节.length,
        checksum: typeof 校验和 === 'function' ? 校验和(字节) : '',
        source: String(源.来源 || '').trim() || 'unknown',
        metadata: 源.元数据 && typeof 源.元数据 === 'object' && !Array.isArray(源.元数据) ? 深拷贝(源.元数据) : {},
        variants: 变体文件,
        ...(图号 === undefined ? {} : { sessionNumber: 图号 }),
        createdAt: 时间,
        updatedAt: 时间,
      };
      const 副 = 写副档(暂存, 条目ID, 值);
      if (!副.ok) return 收拾(`写副档失败：${副.reason}`);

      const 上 = port.rename(暂存, 条目ID, 域.data, 条目ID);
      if (!上.ok) return 收拾(`上位失败：${上.reason}`);

      return ok(描述(域.data, 值));
    });
  }

  function 导入会话图(输入) {
    const 源 = 输入 || {};
    const 域 = 作用域(源.作用域 || {});
    if (!域.ok) return Promise.resolve(域);
    if (域.data.存放地 !== 'session') return Promise.resolve(fail(ERR.BAD_SCOPE, '导入图号只属于会话作用域'));
    const 图号 = Number(源.图号);
    if (!Number.isSafeInteger(图号) || 图号 < 1) return Promise.resolve(fail(ERR.BAD_ARGUMENT, '图号必须是正整数'));
    return 存({ ...源, 来源: 源.来源 || 'import', _导入图号: 图号 });
  }

  // ------------------------------------------------------------ 改

  /** 改：只改副档里的显示名与元数据。 */
  function 改(输入) {    const 源 = 输入 || {};
    if (源.显示名 === undefined && 源.元数据 === undefined) {
      return fail(ERR.BAD_ARGUMENT, '显示名与元数据至少要给一项');
    }
    return 排队(() => {
      const 找 = 找条目(源);
      if (!找.ok) return 找;
      const 新值 = { ...找.data.档 };

      if (源.显示名 !== undefined && 源.显示名 !== null) {
        const 名 = String(源.显示名).trim().slice(0, 180);
        if (!名) return fail(ERR.BAD_ARGUMENT, '显示名不能是空的');
        新值.displayName = 名;
      }
      // 元数据整袋替换
      if (源.元数据 !== undefined) {
        if (源.元数据 !== null && (typeof 源.元数据 !== 'object' || Array.isArray(源.元数据))) {
          return fail(ERR.BAD_ARGUMENT, '元数据必须是一个对象（整袋替换）');
        }
        新值.metadata = 源.元数据 === null ? {} : 深拷贝(源.元数据);
      }
      新值.updatedAt = 现在();

      const w = 写副档(找.data.域, 找.data.条目ID, 新值);
      if (!w.ok) return fail(ERR.WRITE_FAILED, `写副档失败：${w.reason}`);
      return ok(描述(找.data.域, 新值));
    });
  }

  // ------------------------------------------------------------ 删 / 清空

  /** 生成一个批次名。 */
  const 新批次 = () => `del_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  /** 删一批：改名进 .deleting/<批次>/，然后整批交回收站。 */
  async function 删一批(列表) {
    const 批次 = 新批次();
    const 待搬 = [];
    for (const 一项 of 列表) {
      const 找 = 定位(一项);
      if (!找.ok && 找.code === ERR.NOT_FOUND) continue;
      if (!找.ok) return fail(找.code, 找.reason, { 已删: 0, 卡在: 一项, 批次 });
      待搬.push(找.data);
    }

    if (!待搬.length) return ok({ 已删: 0, 已删除: [], 批次: null, 未回收: false });

    const 暂存 = { 暂存: '.deleting', 批次 };
    const 建 = port.mkdir(暂存, '');
    if (!建.ok) return fail(ERR.REMOVE_FAILED, `建待回收目录失败：${建.reason}`);

    const 已删 = [];
    for (const 找 of 待搬) {
      const 名 = 找.条目ID;
      const 移 = port.rename(找.域, 名, 暂存, 名);
      if (!移.ok) {
        return fail(ERR.REMOVE_FAILED, `改名失败：${移.reason}`, { 已删: 已删.length, 卡在: 引用描述(找.域, 名), 批次 });
      }
      已删.push(引用描述(找.域, 名));
    }

    const 交 = port.trash(暂存, '');
    const 没回收 = (为什么, 码) => ok({
      已删: 已删.length, 已删除: 已删, 批次, 未回收: true,
      reason: `${码}: ${为什么}`,
    });
    if (typeof 交回收站 !== 'function') return 没回收(`系统回收站未配置；文件在 .deleting/${批次}/ 里，可恢复`, ERR.TRASH_REQUIRED);
    if (!交.ok) return 没回收(`${交.reason}；文件在 .deleting/${批次}/ 里，可恢复`, ERR.TRASH_REQUIRED);
    try {
      await 交回收站(交.路径);
    } catch (error) {
      return 没回收(`${(error && error.message) || '回收失败'}；文件在 ${交.路径}，可恢复`, ERR.REMOVE_FAILED);
    }
    return ok({ 已删: 已删.length, 已删除: 已删, 批次, 未回收: false });
  }

  /** 删一个条目。 */
  function 删(输入) {
    return 排队(() => 删一批([输入 || {}]));
  }

  /** 清空一个作用域下的全部条目。 */
  function 清空(输入) {
    const 域 = 作用域((输入 && 输入.作用域) || {});
    if (!域.ok) return 域;
    return 排队(() => {
      const 列过 = 列({ 作用域: 域.data });
      if (!列过.ok) return 列过;
      return 删一批(列过.data.条目.map((x) => ({ 引用: x.引用 })));
    });
  }

  // ------------------------------------------------------------ 维护（内部）

  function 扫残留(报告) {
    for (const 暂存 of 暂存们) {
      const 目录 = port.list({ 暂存 });
      for (const 子 of 目录.dirs) {
        const 里 = port.list({ 暂存, 批次: 子 });
        const 项 = { 位置: `${暂存}/${子}`, 里面: [...(里.dirs || []), ...(里.files || [])] };
        if (暂存 === '.staging') 报告.暂存残留.push(项); else 报告.待回收残留.push(项);
      }
    }
  }

  function 扫条目(报告) {
    for (const 地 of 存放地们) {
      const 会话们 = 地 === 'session' ? port.list({ 存放地: 'session' }).dirs : [null];
      for (const 会 of 会话们) {
        const 域 = 地 === 'session' ? { 存放地: 'session', 会话ID: 会 } : { 存放地: 地 };
        for (const 名 of port.list(域).dirs) {
          if (!是条目名(名)) continue;
          const 档 = 读副档(域, 名);
          const 引用 = 引用描述(域, 名);
          if (档.state === 'missing') { 报告.不完整条目.push({ 引用, 缺: 'meta.json' }); continue; }
          if (档.state === 'unreadable') { 报告.读不懂的副档.push({ 引用, 为什么: 档.reason }); continue; }
          const 原 = (档.value.variants || {}).original;
          if (!原 || port.stat(域, `${名}/${原}`).state !== 'ok') 报告.不完整条目.push({ 引用, 缺: '原图' });
        }
      }
    }
  }

  /** 收集适配器留下的临时文件，逐条 push { 作用域, 名字 } 进报告。 */
  function 扫临时文件(报告) {
    const 找一处 = (域, 子) => {
      for (const f of port.list(域, 子).临时 || []) {
        报告.临时文件.push({ 作用域: 作用域描述(域), 名字: 子 === undefined ? f : `${子}/${f}` });
      }
    };
    for (const 地 of 存放地们) {
      const 会话们 = 地 === 'session' ? port.list({ 存放地: 'session' }).dirs : [null];
      for (const 会 of 会话们) {
        const 域 = 地 === 'session' ? { 存放地: 'session', 会话ID: 会 } : { 存放地: 地 };
        找一处(域);
        for (const 名 of port.list(域).dirs) {
          if (!是条目名(名)) continue;
          找一处(域, 名);
        }
      }
    }
  }

  /** 表里的悬空标识：表里有这个 ID，图库里没有这个条目。 */
  function 悬空的们() {
    const 在库 = new Set((列({ 作用域: { 存放地: 'gallery' } }).data || { 条目: [] }).条目.map((x) => x.标识));
    const 出 = [];
    const 收藏 = 读表({ 表: '收藏' });
    if (收藏.ok && Array.isArray(收藏.data)) {
      for (const id of 收藏.data) if (!在库.has(id)) 出.push({ 表: '收藏', 标识: id });
    }
    const 分类 = 读表({ 表: '分类' });
    if (分类.ok && 分类.data && typeof 分类.data === 'object' && !Array.isArray(分类.data)) {
      for (const [类ID, 类] of Object.entries(分类.data)) {
        for (const id of (类 && 类.成员) || []) if (!在库.has(id)) 出.push({ 表: '分类', 类: 类ID, 标识: id });
      }
    }
    return 出;
  }

  function 扫表(报告) {
    报告.悬空标识.push(...悬空的们());
  }

  /**
   * 体检 / 清理。
   * `报告` 给 { 暂存残留, 待回收残留, 临时文件, 不完整条目, 读不懂的副档, 悬空标识 }，不改文件。
   * `清理` 删 .staging 残留、删适配器临时文件、摘表里的悬空标识，给 { 已清理, 报告 }。
   * 两个动作**一律返回 Promise**。
   */
  function 维护(输入 = {}) {
    const 动作 = String(输入.动作 || '报告');
    if (!['报告', '清理'].includes(动作)) return Promise.resolve(fail(ERR.BAD_ARGUMENT, `没有这个动作：${动作}`));
    const 报告 = { 暂存残留: [], 待回收残留: [], 临时文件: [], 不完整条目: [], 读不懂的副档: [], 悬空标识: [] };
    扫残留(报告);
    扫临时文件(报告);
    扫条目(报告);
    扫表(报告);
    if (动作 === '报告') {
      const 有残留 = 报告.暂存残留.length > 0 || 报告.临时文件.length > 0;
      return Promise.resolve(ok({ ...报告, ...(有残留 ? { reason: `${ERR.RESIDUE_PRESENT}: 有未完成操作的残留` } : {}) }));
    }
    return 排队(() => 清理报告(报告));
  }

  /** 按报告清理：删 .staging 残留、删临时文件、摘悬空标识。 */
  function 清理报告(报告) {
    let 已清理 = 0;
    for (const 项 of 报告.暂存残留) {
      if (port.removeDir({ 暂存: '.staging' }, 项.位置.split('/')[1]).ok) 已清理++;
    }
    for (const 项 of 报告.临时文件) {
      const 域 = 项.作用域.暂存 ? { 暂存: 项.作用域.暂存 } : { ...项.作用域 };
      if (port.removeFile(域, 项.名字).ok) 已清理++;
    }
    已清理 += 摘悬空标识();
    return ok({ 已清理, 报告 });
  }

  /** 把悬空标识从表里摘掉。返回摘掉几个。 */
  function 摘悬空标识() {
    const 悬空 = 悬空的们();
    if (!悬空.length) return 0;
    let 摘了 = 0;
    const 收藏的 = 悬空.filter((x) => x.表 === '收藏').map((x) => x.标识);
    if (收藏的.length) {
      const 现在 = 读表({ 表: '收藏' });
      if (现在.ok && Array.isArray(现在.data)) {
        const 去 = 现在.data.filter((x) => !收藏的.includes(x));
        摘了 += 现在.data.length - 去.length;
        if (!写表('收藏', 去).ok) 摘了 -= 现在.data.length - 去.length;
      }
    }
    const 分类的 = 悬空.filter((x) => x.表 === '分类');
    if (分类的.length) {
      const 现在 = 读表({ 表: '分类' });
      if (现在.ok && 现在.data && typeof 现在.data === 'object' && !Array.isArray(现在.data)) {
        const 下 = { ...现在.data };
        for (const [类ID, 类] of Object.entries(下)) {
          const 该摘 = 分类的.filter((x) => x.类 === 类ID).map((x) => x.标识);
          if (!该摘.length || !Array.isArray(类.成员)) continue;
          const 去 = 类.成员.filter((x) => !该摘.includes(x));
          摘了 += 类.成员.length - 去.length;
          下[类ID] = { ...类, 成员: 去 };
        }
        if (!写表('分类', 下).ok) 摘了 = 0;
      }
    }
    return 摘了;
  }

  // ------------------------------------------------------------ 表（只给图库）

  const 表文件 = (表) => (表名们.includes(表) ? ok(`${表}.json`) : fail(ERR.BAD_TABLE, `没有这个表：${表}`));

  /** 读表。文件不存在时给空表。 */
  function 读表(输入) {
    const 表 = String((输入 && 输入.表) || '');
    const f = 表文件(表);
    if (!f.ok) return f;
    const r = port.readText({ 存放地: 'gallery' }, f.data);
    if (r.state === 'missing') return ok(表 === '收藏' ? [] : {});
    if (r.state === 'unreadable') return fail(ERR.METADATA_UNREADABLE, `表读不懂（${r.reason}）：${表}`);
    try {
      return ok(JSON.parse(r.value));
    } catch (_) {
      return fail(ERR.METADATA_UNREADABLE, `表读不懂（parse）：${表}`);
    }
  }

  function 写表(表, 值) {
    const f = 表文件(表);
    if (!f.ok) return f;
    const w = port.writeText({ 存放地: 'gallery' }, f.data, `${JSON.stringify(值, null, 2)}\n`);
    return w.ok ? ok(值) : fail(ERR.WRITE_FAILED, `写表失败：${w.reason}`);
  }

  /**
   * 表操作：读与写都走同一条写队列，一律返回 Promise。
   * 入 { 表, 动作, 类?, 标识?, 名?, 配色? }；出收藏给条目 ID 数组，分类给字典或一个类。
   */
  function 表操作(输入 = {}) {
    const 表 = String(输入.表 || '收藏');
    if (!表名们.includes(表)) return Promise.resolve(fail(ERR.BAD_TABLE, `没有这个表：${表}`));
    if (String(输入.动作 || '') === '读') return 排队(() => 表操作读(输入));
    return 排队(() => 表操作写(输入));
  }

  /** 表的读。 */
  function 表操作读(输入 = {}) {
    const 表 = String(输入.表 || '收藏');
    const 类ID = 输入.类 === undefined || 输入.类 === null ? '' : String(输入.类);
    if (表 === '收藏') return 读表({ 表: '收藏' });
    const 现在 = 读表({ 表: '分类' });
    if (!现在.ok) return 现在;
    const 字典 = 现在.data && typeof 现在.data === 'object' && !Array.isArray(现在.data) ? 现在.data : {};
    if (!类ID) return ok(字典);
    return 字典[类ID] ? ok(字典[类ID]) : fail(ERR.NOT_FOUND, `没有这个类：${类ID}`);
  }

  /** 表的写。 */
  function 表操作写(输入 = {}) {
    const 动作 = String(输入.动作 || '');
    const 表 = String(输入.表 || '收藏');
    if (!表名们.includes(表)) return fail(ERR.BAD_TABLE, `没有这个表：${表}`);
    const 标识 = 输入.标识 ? String(输入.标识) : '';
    const 类ID = 输入.类 === undefined || 输入.类 === null ? '' : String(输入.类);

    if (表 === '收藏') {
      const 现在 = 读表({ 表: '收藏' });
      if (!现在.ok) return 现在;
      const 集合 = Array.isArray(现在.data) ? 现在.data : [];
      if (动作 === '加' || 动作 === '去') {
        if (!是条目名(标识)) return fail(ERR.BAD_ARGUMENT, '收藏要一个条目 ID');
        const 下 = 动作 === '加'
          ? (集合.includes(标识) ? 集合 : [...集合, 标识])
          : 集合.filter((x) => x !== 标识);
        const w = 写表('收藏', 下);
        return w.ok ? ok(下) : w;
      }
      return fail(ERR.BAD_ARGUMENT, `收藏没有这个动作：${动作}`);
    }

    // 分类：{ 类ID: { 名, 配色?, 成员: [条目ID] } }
    const 现在 = 读表({ 表: '分类' });
    if (!现在.ok) return 现在;
    const 字典 = 现在.data && typeof 现在.data === 'object' && !Array.isArray(现在.data) ? 现在.data : {};

    if (动作 === '建类') {
      const 名 = String(输入.名 || '').trim();
      if (!名) return fail(ERR.BAD_ARGUMENT, '类要有名字');
      const id = 类ID || `c${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      if (字典[id]) return fail(ERR.BAD_ARGUMENT, `这个类已经有了：${id}`);
      const 新类 = { 名: 名.slice(0, 60), ...(输入.配色 ? { 配色: 输入.配色 } : {}), 成员: [] };
      const w = 写表('分类', { ...字典, [id]: 新类 });
      return w.ok ? ok(新类) : w;
    }
    if (动作 === '删类') {
      if (!字典[类ID]) return fail(ERR.NOT_FOUND, `没有这个类：${类ID}`);
      const 下 = { ...字典 };
      delete 下[类ID];
      const w = 写表('分类', 下);
      return w.ok ? ok(下) : w;
    }
    if (动作 === '加成员' || 动作 === '去成员') {
      const 类 = 字典[类ID];
      if (!类) return fail(ERR.NOT_FOUND, `没有这个类：${类ID}`);
      if (!是条目名(标识)) return fail(ERR.BAD_ARGUMENT, '成员要一个条目 ID');
      const 成员 = Array.isArray(类.成员) ? 类.成员 : [];
      const 下成员 = 动作 === '加成员'
        ? (成员.includes(标识) ? 成员 : [...成员, 标识])
        : 成员.filter((x) => x !== 标识);
      const 下 = { ...字典, [类ID]: { ...类, 成员: 下成员 } };
      const w = 写表('分类', 下);
      return w.ok ? ok(下[类ID]) : w;
    }
    return fail(ERR.BAD_ARGUMENT, `分类没有这个动作：${动作}`);
  }

  // ------------------------------------------------------------ 出口

  return {
    ERR,
    列, 列会话图, 按图号取详情, 导入会话图, 恢复会话图号, 取详情, 取内容, 取地址,
    存, 改, 删, 清空,
    维护,
    读表, 表操作,
  };
}

module.exports = { createCore, ERR };
