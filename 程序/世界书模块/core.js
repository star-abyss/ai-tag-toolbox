'use strict';
const { randomUUID } = require('node:crypto');
/*
 * 世界书模块 · 核心。纯逻辑：不 require fs / path，不 require 别的模块。
 *
 * 两个状态：存档（端口里那份）· 草稿（内存里那份）。
 * 两种世界书：只读默认（住在默认目录里）· 用户那份（存在端口里）。
 *
 * 盘上的形状：
 *   {
 *     format: 'worldbook', version: 1,
 *     subs:  { <请求>: { 启用: [标识, …] } },
 *     books: { <标识>: { name, scope?, entries: [ … ] } }
 *   }
 *
 * 返回：成功 { ok:true, data }；失败 { ok:false, reason, code }。
 */

const {
  拷贝,
  文本,
  归一关键词,
  归一落点,
  归一角色,
  归一深度,
  归一条,
  归一,
  占用号,
  取名字,
  挑,
  默认深度,
  默认角色,
} = require('./worldbook.js');

/** 只读默认书的对外标识前缀。 */
const 默认前缀 = '$default:';

/** 用户那本书的号前缀。 */
const 书前缀 = 'wb';

/** 存档文件的格式标记。 */
const 格式 = 'worldbook';

/** 本模块的错误码。 */
const ERR = Object.freeze({
  NO_SUCH_BOOK: 'PROMPT_NO_SUCH_BOOK',
  READONLY_BOOK: 'PROMPT_READONLY_BOOK',
  NO_SUCH_ENTRY: 'PROMPT_NO_SUCH_ENTRY',
  BAD_WORLDBOOK: 'PROMPT_BAD_WORLDBOOK',
  STATE_UNREADABLE: 'PROMPT_STATE_UNREADABLE',
  SCOPE_MISMATCH: 'PROMPT_BOOK_SCOPE_MISMATCH',
  WRITE_FAILED: 'PROMPT_WRITE_FAILED',
  BAD_ARGUMENT: 'PROMPT_BAD_ARGUMENT',
});

const ok = (data) => ({ ok: true, data: data === undefined ? null : data });
const fail = (码, 话) => ({ ok: false, reason: `${码}: ${话}`, code: 码 });

/** 空存档。 */
function 空存档() {
  return { format: 格式, version: 1, subs: {}, books: {} };
}

/** 把端口里读到的值收成能用的存档。读不懂就给 null。 */
function 收存档(value) {
  if (value === null || value === undefined) return 空存档();
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.version !== 1) return null;

  const out = 空存档();

  const subs = value.subs && typeof value.subs === 'object' && !Array.isArray(value.subs) ? value.subs : {};
  for (const [请求, 一份] of Object.entries(subs)) {
    const 列 = 一份 && typeof 一份 === 'object' && Array.isArray(一份.启用) ? 一份.启用 : [];
    out.subs[请求] = { 启用: 列.map((x) => 文本(x).trim()).filter(Boolean) };
  }

  const books = value.books && typeof value.books === 'object' && !Array.isArray(value.books) ? value.books : {};
  for (const [标识, 书] of Object.entries(books)) {
    const 归一过 = 归一(书);
    if (归一过) {
      const scope = 文本(书 && 书.scope).trim();
      out.books[文本(标识)] = scope ? { ...归一过, scope } : 归一过;
    }
  }

  return out;
}

/** 用户书的行。 */
const 用户行 = (标识, 书) => ({
  标识,
  名字: 书.name,
  是本子: false,
  存在: true,
  条目数: 书.entries.length,
  ...(书.scope ? { 请求: 书.scope } : {}),
});

function createCore(options = {}) {
  const rawPort = options.port;
  if (!rawPort) throw new Error('核心需要一个端口：createCore({ port })');
  const 默认启用 = Object.fromEntries(
    Object.entries(options.默认启用 || {}).map(([请求, 列表]) => [请求, [...列表]]),
  );
  const 默认启用副本 = () => Object.fromEntries(
    Object.entries(默认启用).map(([请求, 列表]) => [请求, [...列表]]),
  );

  // ---------- 只读默认 ----------

  /** 只读默认书的缓存：名字 → { state, value?, reason? }。 */
  let 默认缓存 = null;

  function 默认们() {
    if (!默认缓存) {
      默认缓存 = new Map();
      const 列 = rawPort.listDefaults();
      if (列.ok) {
        for (const 一项 of 列.items) 默认缓存.set(文本(一项.名字), rawPort.readDefault(一项.名字));
      }
    }
    return 默认缓存;
  }

  /** 取一份只读默认（副本）。没有／读不懂都给 null。 */
  function 取默认(名字) {
    const 读 = 默认们().get(名字);
    if (!读 || 读.state !== 'ok') return null;
    return 归一(读.value);
  }

  /** 默认那一份的文件状态：ok / missing / unreadable。 */
  function 默认状态(名字) {
    const 读 = 默认们().get(名字);
    if (!读) return 'missing';
    return 读.state;
  }

  /** 一份只读默认书的对外标识。 */
  const 默认标识 = (名字) => `${默认前缀}${名字}`;

  /** 对外标识 → 默认书的名字；不是默认标识就给 null。 */
  const 拆默认 = (标识) =>
    标识.startsWith(默认前缀) ? 标识.slice(默认前缀.length) : null;

  // ---------- 存档 / 草稿 ----------

  let 存档 = null;
  let 草稿 = null;
  let 读不懂 = null;

  function 载入() {
    const 读 = rawPort.readState();
    if (读.state === 'unreadable') {
      存档 = 空存档();
      读不懂 = 读.reason || '读不懂';
    } else if (读.state === 'missing') {
      存档 = 空存档();
      读不懂 = null;
    } else {
      const 收 = 收存档(读.value);
      if (收 === null) {
        存档 = 空存档();
        读不懂 = '版本不认或形状不对';
      } else {
        存档 = 收;
        读不懂 = null;
      }
    }
    草稿 = 拷贝(存档);
    默认缓存 = null;
  }

  const 冻结 = () => 读不懂 !== null;
  const 脏 = () => JSON.stringify(草稿) !== JSON.stringify(存档);

  /** 冻结时拒绝写盘的那些入口。 */
  const 可写 = () => (冻结() ? fail(ERR.STATE_UNREADABLE, `存档读不懂（${读不懂}），已冻结写入`) : null);

  // ---------- 表 ----------

  /** 世界书表：按请求过滤后按名字排序。 */
  function 表(请求 = '') {
    const 行 = [];
    const 默认范围 = 请求 ? new Set(默认启用[请求] || []) : null;
    for (const 名字 of [...默认们().keys()].sort((a, b) => a.localeCompare(b, 'zh'))) {
      if (默认范围 && !默认范围.has(默认标识(名字))) continue;
      const 书 = 取默认(名字);
      const 行一 = {
        标识: 默认标识(名字),
        名字: 书 ? 书.name : 名字,
        是本子: true,
        存在: 书 !== null,
        条目数: 书 ? 书.entries.length : 0,
      };
      if (默认状态(名字) === 'unreadable') 行一.读不懂 = true;
      行.push(行一);
    }
    for (const [标识, 书] of Object.entries(草稿.books)) {
      if (!请求 || 书.scope === 请求) 行.push(用户行(标识, 书));
    }
    行.sort((a, b) => a.名字.localeCompare(b.名字, 'zh'));
    return 行;
  }

  /** 一个请求这次启用了哪些标识（副本）。没有存档记录时使用装配层默认。 */
  function 启用列(请求, 哪份 = 草稿) {
    if (Object.prototype.hasOwnProperty.call(哪份.subs, 请求)) {
      const 份 = 哪份.subs[请求];
      return 份 && Array.isArray(份.启用) ? [...份.启用] : [];
    }
    const 列表 = 默认启用[请求];
    return Array.isArray(列表) ? [...列表] : [];
  }

  /** 某个标识的归属。 */
  function 定位(标识) {
    const 名 = 文本(标识).trim();
    if (!名) return null;
    const 默认名 = 拆默认(名);
    if (默认名 !== null) {
      const 书 = 取默认(默认名);
      if (!书) return null;
      return { 标识: 名, 是默认: true, 书 };
    }
    const 找 = 草稿.books[名];
    if (!找) return null;
    return { 标识: 名, 是默认: false, 书: 找 };
  }

  function 属于请求(标识, 请求, 哪份 = 草稿) {
    if (拆默认(标识) !== null) return (默认启用[请求] || []).includes(标识);
    const 书 = 哪份.books[标识];
    return !!书 && 书.scope === 请求;
  }

  function 存在于(标识, 哪份) {
    if (拆默认(标识) !== null) return 默认们().has(拆默认(标识));
    return Object.prototype.hasOwnProperty.call(哪份.books, 标识);
  }

  /** 这个标识指的东西在不在。读不懂的只读默认也算在（"读不懂"不是"没有"）。 */
  function 在不在(标识) {
    if (定位(标识)) return true;
    const 默认名 = 拆默认(标识);
    return 默认名 !== null && 默认们().has(默认名);
  }

  /** 新用户书的标识。 */
  function 新标识() {
    return `${书前缀}${randomUUID()}`;
  }

  /** 用户书之间不撞名；与只读默认重名是允许的。 */
  function 不撞名(名字, 请求 = '') {
    const 用过 = new Set(Object.values(草稿.books).filter((书) => (书.scope || '') === 请求).map((书) => 书.name));
    if (!用过.has(名字)) return 名字;
    let n = 2;
    while (用过.has(`${名字} ${n}`)) n += 1;
    return `${名字} ${n}`;
  }

  // ---------- 读 ----------

  /** 一份快照：表 + 某个请求启用了哪几本 + 那本书的正文 + 草稿状态。 */
  function 读(输入 = {}) {
    const 请求 = 文本(输入.请求).trim();
    const 书标识 = 文本(输入.书).trim();

    const 快照 = { 表: 表(请求), 默认启用: 默认启用副本(), 脏: 脏() };

    if (请求) {
      const 启用 = 启用列(请求);
      快照.请求 = 请求;
      快照.启用 = 启用.map((一) => {
        const 找 = 定位(一);
        const 默认名 = 拆默认(一);
        return {
          标识: 一,
          名字: 找 ? 找.书.name : 默认名 !== null ? 默认名 : 一,
          是本子: 找 ? 找.是默认 : 默认名 !== null,
          存在: 找 !== null,
          读得懂: 找 !== null,
        };
      });
    }

    if (书标识) {
      const 找 = 定位(书标识);
      if (!找) return fail(ERR.NO_SUCH_BOOK, `没有这本书：${书标识}`);
      快照.书 = {
        标识: 找.标识,
        名字: 找.书.name,
        是本子: 找.是默认,
        条目: 找.书.entries.map(拷贝),
      };
    }

    if (冻结()) 快照.冻结 = 读不懂;
    return ok(快照);
  }

  // ---------- 书上的动作 ----------

  /** 一本书的正文：标识 → { 标识, 是默认, 书 }。 */
  function 要书(标识) {
    const 找 = 定位(文本(标识).trim());
    if (!找) return fail(ERR.NO_SUCH_BOOK, `没有这本书：${标识 || '（空）'}`);
    return 找;
  }

  /** 书动作里，要把这本书写坏时用的那一关。 */
  function 要用户书(标识) {
    const 找 = 要书(标识);
    if (找.code) return 找;
    if (找.是默认) return fail(ERR.READONLY_BOOK, `默认世界书只读：${找.标识}`);
    return 找;
  }

  /** 把一本新书放进草稿并记录可选归属。 */
  function 收书(书, 名字, 请求) {
    const 标识 = 新标识();
    草稿.books[标识] = { name: 名字, entries: 书.entries, ...(请求 ? { scope: 请求 } : {}) };
    return { 标识, 名字 };
  }

  function 书动作(输入 = {}) {
    const 动作 = 文本(输入.动作).trim();

    if (动作 === '导出') {
      const 找 = 要书(输入.标识);
      if (找.code) return 找;
      return ok({
        名字: 找.书.name,
        内容: JSON.stringify({ name: 找.书.name, entries: 找.书.entries }, null, 2),
      });
    }

    const 拦 = 可写();
    if (拦) return 拦;

    if (动作 === '换') {
      const 请求 = 文本(输入.请求).trim();
      if (!请求) return fail(ERR.BAD_ARGUMENT, '换要给 请求');
      const 列 = 输入.启用;
      if (!Array.isArray(列)) return fail(ERR.BAD_ARGUMENT, '换要给 启用（一串标识；一本都不启用就给空数组）');
      const 归 = [];
      for (const 一 of 列) {
        const 标识 = 文本(一).trim();
        if (!标识) continue;
        if (!在不在(标识)) return fail(ERR.NO_SUCH_BOOK, `没有这本书：${标识}`);
        if (!属于请求(标识, 请求)) return fail(ERR.SCOPE_MISMATCH, `这本书不属于请求 ${请求}：${标识}`);
        if (!归.includes(标识)) 归.push(标识);
      }
      草稿.subs[请求] = { 启用: 归 };
      return ok({ 请求, 启用: [...归] });
    }

    if (动作 === '导入') {
      const 原文 = typeof 输入.内容 === 'string' ? 输入.内容 : null;
      const 对象 = 原文 === null && 输入.书 && typeof 输入.书 === 'object' ? 输入.书 : null;
      if (原文 === null && 对象 === null) return fail(ERR.BAD_ARGUMENT, '导入要递 内容（JSON 文本）或 书（对象）');
      let 解析 = 对象;
      if (原文 !== null) {
        try {
          解析 = JSON.parse(原文);
        } catch (_) {
          return fail(ERR.BAD_WORLDBOOK, '不是合法的 JSON');
        }
      }
      const 归一过 = 归一(解析);
      if (归一过 === null) return fail(ERR.BAD_WORLDBOOK, '没有 entries —— 这不是一份世界书');
      const 请求 = 文本(输入.请求).trim();
      const 名字 = 不撞名(文本(输入.名字).trim() || 归一过.name, 请求);
      const 收 = 收书(归一过, 名字, 请求);
      return ok({ 标识: 收.标识, 名字: 收.名字 });
    }

    if (动作 === '新建') {
      const 请求 = 文本(输入.请求).trim();
      const 名字 = 不撞名(文本(输入.名字).trim() || '新世界书', 请求);
      const 收 = 收书({ name: 名字, entries: [] }, 名字, 请求);
      return ok({ 标识: 收.标识, 名字: 收.名字 });
    }

    if (动作 === '改名') {
      const 找 = 要用户书(输入.标识);
      if (找.code) return 找;
      const 名字 = 文本(输入.名字).trim();
      if (!名字) return fail(ERR.BAD_ARGUMENT, '新名字不能为空');
      找.书.name = 名字;
      return ok({ 标识: 找.标识, 名字 });
    }

    if (动作 === '删') {
      const 找 = 要用户书(输入.标识);
      if (找.code) return 找;
      delete 草稿.books[找.标识];
      for (const [请求, 份] of Object.entries(草稿.subs)) {
        const 剩 = 份.启用.filter((一) => 一 !== 找.标识);
        if (剩.length !== 份.启用.length) 草稿.subs[请求] = { 启用: 剩 };
      }
      return ok({ 删了: 找.标识 });
    }

    return fail(ERR.BAD_ARGUMENT, `没有这个动作：${动作 || '（空）'}`);
  }

  // ---------- 条目上的动作 ----------

  function 条目动作(输入 = {}) {
    const 拦 = 可写();
    if (拦) return 拦;
    const 动作 = 文本(输入.动作).trim();
    if (!['加', '改', '删', '移'].includes(动作)) return fail(ERR.BAD_ARGUMENT, `没有这个动作：${动作 || '（空）'}`);
    const 目标 = 要用户书(输入.书);
    if (目标.code) return 目标;
    const 书 = 目标.书;

    if (动作 === '加') {
      const 源 = 输入.条目 && typeof 输入.条目 === 'object' ? 输入.条目 : {};
      const 新 = 归一条(源, 占用号(书.entries));
      书.entries.push(新);
      return ok({ 条目: 拷贝(新) });
    }

    const 标识 = 文本(输入.标识).trim();
    const 序 = 书.entries.findIndex((x) => x.id === 标识);
    if (序 < 0) return fail(ERR.NO_SUCH_ENTRY, `这本书里没有这个条目：${标识 || '（空）'}`);

    if (动作 === '改') {
      const 源 = 输入.条目 && typeof 输入.条目 === 'object' ? 输入.条目 : {};
      const 旧 = 书.entries[序];
      if (源.label !== undefined) 旧.label = 文本(源.label);
      if (源.text !== undefined) 旧.text = 文本(源.text).replace(/\r\n/g, '\n');
      if (源.enabled !== undefined) 旧.enabled = 源.enabled !== false;

      // 显式启用方式优先，关键词独立保存。
      if (源.always === true) {
        旧.always = true;
        if (源.keys !== undefined) 旧.keys = 归一关键词(源.keys);
      } else if (源.always === false) {
        旧.always = false;
        if (源.keys !== undefined) 旧.keys = 归一关键词(源.keys);
      } else if (源.keys !== undefined) {
        旧.keys = 归一关键词(源.keys);
        旧.always = 旧.keys.length === 0;
      }

      if (源.落点 !== undefined) 旧.落点 = 归一落点(源.落点);
      if (旧.落点 === '按深度') {
        旧.深度 = 源.深度 === undefined ? (旧.深度 === undefined ? 默认深度 : 旧.深度) : 归一深度(源.深度);
        旧.角色 = 源.角色 === undefined ? (旧.角色 === undefined ? 默认角色 : 旧.角色) : 归一角色(源.角色);
      } else {
        delete 旧.深度;
        delete 旧.角色;
      }
      return ok({ 条目: 拷贝(旧) });
    }

    if (动作 === '删') {
      const [去掉] = 书.entries.splice(序, 1);
      return ok({ 删了: 去掉.id });
    }

    if (动作 === '移') {
      let 到;
      if (输入.到 !== undefined && 输入.到 !== null) 到 = Number(输入.到);
      else if (输入.方向 === '上') 到 = 序 - 1;
      else if (输入.方向 === '下') 到 = 序 + 1;
      else return fail(ERR.BAD_ARGUMENT, '移要给 方向（上/下）或 到（序号）');
      if (!Number.isInteger(到) || 到 < 0 || 到 >= 书.entries.length) {
        return fail(ERR.BAD_ARGUMENT, `移不到那个位置：${输入.到 !== undefined ? 输入.到 : 输入.方向}`);
      }
      const [一条] = 书.entries.splice(序, 1);
      书.entries.splice(到, 0, 一条);
      return ok({ 标识: 一条.id, 到 });
    }

    return fail(ERR.BAD_ARGUMENT, `没有这个动作：${动作 || '（空）'}`);
  }

  // ---------- 筛选与执行 ----------

  /**
   * 按请求挑条目：读哪一份由 哪份 决定。
   * @param {object} 输入 { 请求, 文本 }
   * @param {object} 哪份 存档 或 草稿
   */
  function 挑一份(输入, 哪份) {
    const 请求 = 文本(输入.请求).trim();
    if (!请求) return fail(ERR.BAD_ARGUMENT, '执行要给 请求');
    const 列 = Array.isArray(输入.启用) ? 输入.启用 : 启用列(请求, 哪份);

    const 书 = [];
    const 命中 = [];
    for (const 标识 of 列) {
      if (!存在于(标识, 哪份)) return fail(ERR.NO_SUCH_BOOK, `没有这本书：${标识}`);
      if (!属于请求(标识, 请求, 哪份)) return fail(ERR.SCOPE_MISMATCH, `这本书不属于请求 ${请求}：${标识}`);
      const 默认名 = 拆默认(标识);
      // 这一本在不在，按**这一份**看：给的是存档就只认存档里那几本。
      const 一本 = 默认名 !== null
        ? 取默认(默认名)
        : 哪份.books[标识] || null;
      if (!一本) {
        // 只读默认读不懂单独报出来；用户那本不在就照"不在这份里"算。
        if (默认名 !== null && 默认们().has(默认名)) {
          return fail(ERR.STATE_UNREADABLE, `默认世界书读不懂：${默认名}`);
        }
        书.push({ 标识, 名字: 标识 });
        continue;
      }
      书.push({ 标识, 名字: 一本.name });
      for (const 一条 of 挑(一本, 输入.文本)) {
        一条.书 = 标识;
        命中.push(一条);
      }
    }

    return ok({ 请求, 书, 命中 });
  }

  /** 上层要的那一个：只读存档，不读草稿。 */
  const 执行 = (输入 = {}) => 挑一份(输入, 存档);

  /** 界面预览用的那一个：读草稿。 */
  const 测 = (输入 = {}) => 挑一份(输入, 草稿);

  // ---------- 存取 ----------

  /** 草稿写进端口。 */
  function 存() {
    const 拦 = 可写();
    if (拦) return 拦;
    const 写 = rawPort.writeState(拷贝(草稿));
    if (!写.ok) return fail(ERR.WRITE_FAILED, `写不进去：${写.reason || '未知'}`);
    const 读 = rawPort.readState();
    if (读.state === 'ok') {
      const 收 = 收存档(读.value);
      if (收 !== null) 存档 = 收;
    } else {
      存档 = 拷贝(草稿);
    }
    return ok({ 脏: 脏() });
  }

  /** 草稿丢回存档。 */
  function 丢() {
    草稿 = 拷贝(存档);
    return ok({ 脏: false });
  }

  /** 重读端口。 */
  function 重读() {
    载入();
    return ok({ 冻结: 冻结(), 脏: 脏() });
  }

  /** 体检。 */
  function 状态查() {
    const 行 = 表();
    return ok({
      默认: 行.filter((x) => x.是本子).length,
      用户书: Object.keys(草稿.books).length,
      请求: Object.keys(草稿.subs).length,
      存档: 冻结() ? { 冻结: true, reason: 读不懂 } : { 冻结: false },
      脏: 脏(),
    });
  }

  载入();

  return {
    ERR,
    读,
    表,
    书: 书动作,
    条目: 条目动作,
    存,
    丢,
    重读,
    执行,
    测,
    状态: 状态查,
  };
}

module.exports = { createCore, ERR };
