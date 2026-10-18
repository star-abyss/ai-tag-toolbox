'use strict';
/*
 * 主AI模块 · 核心。纯逻辑：不 require fs / path，不 require 别的模块。
 *
 * 两个状态：存档（端口里那份）· 草稿（内存里那份）。
 * 两种预设：只读默认（住在默认目录里）· 用户那份（存在端口里）。
 *
 * 盘上的形状：
 *   {
 *     format: 'preset', version: 1,
 *     subs:    { <请求>: { 启用: [标识, …] } },
 *     presets: { <标识>: { name, tools, toolsOrder, model } }
 *   }
 *
 * 只读默认里没有 tools —— 业务工具表由端口现算，用户存档只保存差异。
 *
 * 返回：成功 { ok:true, data }；失败 { ok:false, reason, code }。
 */

const {
  文本,
  拷贝,
  一对象,
  归一预设,
} = require('./preset.js');

/** 只读默认预设的对外标识前缀。 */
const 默认前缀 = '$默认:';

/** 默认预设的名字。只读默认目录里就这一份。 */
const 默认名字 = '主AI';

/** 用户那套预设的号前缀。 */
const 预设前缀 = 'ps';

/** 存档文件的格式标记。 */
const 格式 = 'preset';

/** 本模块的错误码。 */
const ERR = Object.freeze({
  NO_SUCH_PRESET: 'PRESET_NO_SUCH_PRESET',
  READONLY_PRESET: 'PRESET_READONLY_PRESET',
  NO_SUCH_TOOL: 'PRESET_NO_SUCH_TOOL',
  BAD_PRESET: 'PRESET_BAD_PRESET',
  STATE_UNREADABLE: 'PRESET_STATE_UNREADABLE',
  WRITE_FAILED: 'PRESET_WRITE_FAILED',
  BAD_ARGUMENT: 'PRESET_BAD_ARGUMENT',
});

const ok = (data) => ({ ok: true, data: data === undefined ? null : data });
const fail = (码, 话) => ({ ok: false, reason: `${码}: ${话}`, code: 码 });

/** 空存档。 */
function 空存档() {
  return { format: 格式, version: 1, subs: {}, presets: {} };
}

/** 把端口里读到的值收成能用的存档。读不懂就给 null。 */
function 收存档(value, 业务表) {
  if (value === null || value === undefined) return 空存档();
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.version !== 1) return null;

  const out = 空存档();

  const subs = value.subs && typeof value.subs === 'object' && !Array.isArray(value.subs) ? value.subs : {};
  for (const [请求, 一份] of Object.entries(subs)) {
    const 列 = 一份 && typeof 一份 === 'object' && Array.isArray(一份.启用) ? 一份.启用 : [];
    out.subs[请求] = { 启用: 列.map((x) => 文本(x).trim()).filter(Boolean) };
  }

  const presets = value.presets && typeof value.presets === 'object' && !Array.isArray(value.presets) ? value.presets : {};
  for (const [标识, 一套] of Object.entries(presets)) {
    const 归一过 = 归一预设(一套);
    归一过.tools = 工具差异(归一过.tools, 业务表);
    const 有效名 = new Set((业务表 || []).map((一) => 一.名字));
    归一过.toolsOrder = 归一过.toolsOrder.filter((名) => 有效名.has(名));
    out.presets[文本(标识)] = 归一过;
  }

  return out;
}

/** 用户预设的行。 */
const 用户行 = (标识, 一套, 工具数) => ({
  标识,
  名字: 一套.name,
  是本子: false,
  存在: true,
  工具数,
});

function 工具差异(原列, 业务表) {
  const 定义 = new Map((业务表 || []).map((一) => [一.名字, 一]));
  const 差异 = [];
  for (const 原 of 原列 || []) {
    const 基准 = 定义.get(原.名字);
    if (!基准) continue;
    const 行 = { 名字: 原.名字 };
    if (原.启用 === false) 行.启用 = false;
    if (typeof 原.摘要 === 'string' && 原.摘要 !== (typeof 基准.摘要 === 'string' ? 基准.摘要 : '')) 行.摘要 = 原.摘要;
    const 说明 = {};
    for (const [键, 话] of Object.entries(原.文本覆盖 || {})) {
      if (typeof 话 === 'string') 说明[键] = 话;
    }
    const 原参数 = 原.参数 || {};
    const 基参数 = 基准.参数 || {};
    function 收description(原schema, 基schema, 路径) {
      if (!原schema || typeof 原schema !== 'object') return;
      if (typeof 原schema.description === 'string' && 原schema.description !== (typeof 基schema?.description === 'string' ? 基schema.description : '')) 说明[路径] = 原schema.description;
      for (const 键 of ['properties', 'patternProperties', '$defs', 'definitions']) {
        for (const [名, 子] of Object.entries(原schema[键] || {})) 收description(子, 基schema?.[键]?.[名], `${路径}/${键}/${名}`);
      }
      if (原schema.items && typeof 原schema.items === 'object') 收description(原schema.items, 基schema?.items, `${路径}/items`);
      for (const 键 of ['oneOf', 'anyOf', 'allOf']) {
        (原schema[键] || []).forEach((子, 序) => 收description(子, 基schema?.[键]?.[序], `${路径}/${键}/${序}`));
      }
      if (原schema.additionalProperties && typeof 原schema.additionalProperties === 'object') 收description(原schema.additionalProperties, 基schema?.additionalProperties, `${路径}/additionalProperties`);
    }
    for (const [名, 项] of Object.entries(原参数)) 收description(项, 基参数[名], `/${名}`);
    for (const 名 of Object.keys(基准.参数 || {})) {
      const 原说 = typeof 原.说明?.[名] === 'string' ? 原.说明[名] : 原.参数?.[名]?.description;
      const 基说 = 基准.参数[名]?.description;
      if (typeof 原说 === 'string' && 原说 !== (typeof 基说 === 'string' ? 基说 : '')) 说明[`/${名}`] = 原说;
    }
    for (const [名, 话] of Object.entries(说明)) {
      if (typeof 话 === 'string') 行.文本覆盖 = { ...(行.文本覆盖 || {}), [名]: 话 };
    }
    if (行.启用 === false || 行.摘要 !== undefined || Object.keys(说明).length) 差异.push(行);
  }
  return 差异;
}

function 工具顺序差异(工具列, 业务表) {
  const 当前 = (工具列 || []).map((一) => 一.名字).filter((名) => (业务表 || []).some((一) => 一.名字 === 名));
  const 默认 = (业务表 || []).map((一) => 一.名字);
  return 当前.length === 默认.length && 当前.every((名, 序) => 名 === 默认[序]) ? [] : 当前;
}

function 展开工具(差异列, 业务表, 顺序 = []) {
  const 差异 = new Map((差异列 || []).map((一) => [一.名字, 一]));
  const 出 = (业务表 || []).map((基准) => {
    const 覆盖 = 差异.get(基准.名字);
    const 参数 = 拷贝(基准.参数 || {});
    const 说明 = 拷贝(基准.说明 || {});
    function 应用description(schema, 路径) {
      const 话 = 覆盖?.文本覆盖?.[路径];
      if (typeof 话 === 'string') schema.description = 话;
      for (const 键 of ['properties', 'patternProperties', '$defs', 'definitions']) {
        for (const [名, 子] of Object.entries(schema[键] || {})) 应用description(子, `${路径}/${键}/${名}`);
      }
      if (schema.items && typeof schema.items === 'object') 应用description(schema.items, `${路径}/items`);
      for (const 键 of ['oneOf', 'anyOf', 'allOf']) (schema[键] || []).forEach((子, 序) => 应用description(子, `${路径}/${键}/${序}`));
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') 应用description(schema.additionalProperties, `${路径}/additionalProperties`);
    }
    for (const [名, schema] of Object.entries(参数)) 应用description(schema, `/${名}`);
    for (const [键, 话] of Object.entries(覆盖?.文本覆盖 || {})) {
      if (typeof 话 !== 'string' || !键.startsWith('/')) continue;
      const 路径 = 键.split('/').slice(1);
      if (路径.length === 1) 说明[路径[0]] = 话;
    }
    return {
      名字: 基准.名字,
      摘要: typeof 覆盖?.摘要 === 'string' ? 覆盖.摘要 : 基准.摘要 || '',
      启用: 覆盖?.启用 !== false,
      参数,
      说明,
    };
  });
  if (!Array.isArray(顺序) || !顺序.length) return 出;
  const 次序 = new Map(顺序.map((名, 序) => [名, 序]));
  return 出.sort((甲, 乙) => (次序.get(甲.名字) ?? Number.MAX_SAFE_INTEGER) - (次序.get(乙.名字) ?? Number.MAX_SAFE_INTEGER));
}

function createCore(options = {}) {
  const rawPort = options.port;
  if (!rawPort) throw new Error('核心需要一个端口：createCore({ port })');

  // ---------- 只读默认 ----------

  /** 只读默认的缓存：名字 → { state, value?, reason? }。 */
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
    return 归一预设(读.value);
  }

  /** 默认那一份的文件状态：ok / missing / unreadable。 */
  function 默认状态(名字) {
    const 读 = 默认们().get(名字);
    if (!读) return 'missing';
    return 读.state;
  }

  /** 一份只读默认的对外标识。 */
  const 默认标识 = (名字) => `${默认前缀}${名字}`;

  /** 对外标识 → 默认的名字；不是默认标识就给 null。 */
  const 拆默认 = (标识) => (标识.startsWith(默认前缀) ? 标识.slice(默认前缀.length) : null);

  // ---------- 业务工具 ----------

  function 默认工具表() {
    const 读 = rawPort.businessTools();
    if (!读?.ok || !Array.isArray(读.工具表)) return [];
    return 拷贝(读.工具表)
      .filter((一) => 一 && typeof 一.名字 === 'string' && 一.名字)
      .map((一) => {
        const 说明 = 一.说明 && typeof 一.说明 === 'object' ? 一.说明 : {};
        const 参数 = 一.参数 && typeof 一.参数 === 'object' ? 一.参数 : {};
        for (const [名, 话] of Object.entries(说明)) {
          if (typeof 话 === 'string' && 参数[名] && typeof 参数[名] === 'object' && !参数[名].description) {
            参数[名].description = 话;
          }
        }
        return { ...一, 参数, 说明 };
      });
  }

  /** 默认那套预设的完整形状（含算出来的工具表）。盘上读不懂时只剩工具表。 */
  function 默认预设() {
    const 底 = 取默认(默认名字) || 归一预设({});
    return 加工具表(底);
  }

  /** 给一套预设补上算出来的工具表。只读默认都走这里。 */
  function 加工具表(一套) {
    return { ...一套, tools: 默认工具表() };
  }

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
      const 收 = 收存档(读.value, 默认工具表());
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

  /** 全部预设：只读默认 + 用户那份，按名字排序、不分组。 */
  function 表() {
    const 行 = [];
    for (const 名字 of [...默认们().keys()].sort((a, b) => a.localeCompare(b, 'zh'))) {
      const 一套 = 取默认(名字);
      const 行一 = {
        标识: 默认标识(名字),
        名字: 一套 ? 一套.name : 名字,
        是本子: true,
        存在: 一套 !== null,
        工具数: 一套 ? 默认工具表().length : 0,
      };
      if (默认状态(名字) === 'unreadable') 行一.读不懂 = true;
      行.push(行一);
    }
    for (const [标识, 一套] of Object.entries(草稿.presets)) 行.push(用户行(标识, 一套, 默认工具表().length));
    行.sort((a, b) => a.名字.localeCompare(b.名字, 'zh'));
    return 行;
  }

  /** 一个请求这次启用了哪些标识（副本）。没有记录就是空。 */
  function 启用列(请求) {
    const 份 = 草稿.subs[请求];
    return 份 && Array.isArray(份.启用) ? [...份.启用] : [];
  }

  /** 这个标识指的东西在不在。读不懂的只读默认也算在（"读不懂"不是"没有"）。 */
  function 在不在(标识) {
    const 名 = 文本(标识).trim();
    if (!名) return false;
    const 默认名 = 拆默认(名);
    if (默认名 !== null) return 默认们().has(默认名);
    return Boolean(草稿.presets[名]);
  }

  /**
   * 某个标识的归属。读哪一份由 哪份 决定：草稿给界面，存档给上层。
   * 只读默认的工具表是算出来的，不在盘上，所以两种情形都现算补上。
   * 只读默认读不懂时 `读得懂` 为假，正文按空算，名字照旧。
   */
  function 定位(标识, 哪份) {
    const 名 = 文本(标识).trim();
    if (!名) return null;
    const 默认名 = 拆默认(名);
    if (默认名 !== null) {
      const 读 = 默认们().get(默认名);
      if (!读) return null;
      const 读得懂 = 读.state === 'ok';
      const 一套 = 读得懂 ? 归一预设(读.value) : 归一预设({});
      const 名字 = 读得懂 && 一套.name ? 一套.name : 默认名;
      return { 标识: 名, 是默认: true, 读得懂, 名字, 一套, 工具表: 默认工具表() };
    }
    const 找 = (哪份 || 草稿).presets[名];
    if (!找) return null;
    return { 标识: 名, 是默认: false, 读得懂: true, 名字: 找.name, 一套: 找, 工具表: 展开工具(找.tools, 默认工具表(), 找.toolsOrder) };
  }

  /** 默认那套的对外标识。 */
  const 默认那一个 = () => 默认标识(默认名字);

  /** 这个请求这次该用哪一套：给了 预设 就用它，否则用它启用的第一套，一套都没启用就用默认那套。 */
  function 挑一个(哪份, 请求, 给了) {
    if (给了) return 给了;
    const 启用 = 请求 ? (哪份.subs[请求] && Array.isArray(哪份.subs[请求].启用) ? 哪份.subs[请求].启用 : []) : [];
    return 启用.length ? 启用[0] : 默认那一个();
  }

  /** 新用户预设的标识：从 ps1 起顺着找第一个没被占用的。 */
  function 新标识() {
    let n = 1;
    while (Object.prototype.hasOwnProperty.call(草稿.presets, `${预设前缀}${n}`)) n += 1;
    return `${预设前缀}${n}`;
  }

  /** 用户预设之间不撞名；与只读默认重名是允许的。 */
  function 不撞名(名字) {
    const 用过 = new Set(Object.values(草稿.presets).map((一套) => 一套.name));
    if (!用过.has(名字)) return 名字;
    let n = 2;
    while (用过.has(`${名字} ${n}`)) n += 1;
    return `${名字} ${n}`;
  }

  // ---------- 读 ----------

  /** 一套预设的对外快照。 */
  function 快照(找) {
    const 一套 = 找.一套;
    return {
      标识: 找.标识,
      名字: 找.名字,
      是本子: 找.是默认,
      存在: true,
      读得懂: 找.读得懂,
      工具表: 找.工具表.map((一) => ({
        摘要: 一.摘要,
        名字: 一.名字,
        启用: 一.启用,
        参数: 拷贝(一.参数),
        说明: 拷贝(一.说明),
        算得出来: true,
      })),
      model: 拷贝(一套.model),
      ...(一套.runtime && Object.keys(一套.runtime).length ? { runtime: 拷贝(一套.runtime) } : {}),
    };
  }

  /** 一份快照：表 + 某个请求启用了哪几套 + 预设配置 + 草稿状态。 */
  function 读(输入) {
    const 给 = 输入 || {};
    const 请求 = 文本(给.请求).trim();
    const 标识 = 文本(给.预设).trim();

    const 出 = { 表: 表(), 脏: 脏() };

    if (请求) {
      const 启用 = 启用列(请求);
      出.请求 = 请求;
      出.启用 = 启用.map((一) => {
        const 找 = 定位(一);
        const 默认名 = 拆默认(一);
        return {
          标识: 一,
          名字: 找 ? 找.名字 : 默认名 !== null ? 默认名 : 一,
          是本子: 找 ? 找.是默认 : 默认名 !== null,
          存在: 找 !== null || (默认名 !== null && 默认们().has(默认名)),
          读得懂: 找 ? 找.读得懂 : false,
        };
      });
    }

    if (标识) {
      const 找 = 定位(标识);
      if (!找) return fail(ERR.NO_SUCH_PRESET, `没有这套预设：${标识}`);
      出.预设 = 快照(找);
    }

    if (冻结()) 出.冻结 = 读不懂;
    return ok(出);
  }

  // ---------- 执行 ----------

  /**
   * 一套预设这次拿去用的样子：工具表与模型配置。
   * 只读默认那套的工具表是现算的；用户那套的是它盘上那份。
   */
  function 拼一套(找, 名字) {
    const 一套 = 找.一套;
    return {
      请求: '',
      预设: { 标识: 找.标识, 名字: 名字 || 一套.name },
      工具表: 找.工具表
        .filter((一) => 一.启用 !== false)
        .map((一) => ({ 名字: 一.名字, 摘要: 一.摘要, 参数: 拷贝(一.参数), 说明: 拷贝(一.说明) })),
      模型: 拷贝(一对象(一套.model)),
      附加文本: 拷贝(一对象(一套.runtime)),
      ...(一套.runtime && Object.keys(一套.runtime).length ? { runtime: 拷贝(一套.runtime) } : {}),
    };
  }

  /**
   * 上层要的那一个：交回这次预设的配置与工具表。**读存档。**
   * 给了一个不存在的标识就明确失败（不回落）。
   */
  function 执行(输入) {
    const 给 = 输入 || {};
    const 请求 = 文本(给.请求).trim();
    const 标识 = 挑一个(存档, 请求, 文本(给.预设).trim());

    const 找 = 定位(标识, 存档);
    if (!找) return fail(ERR.NO_SUCH_PRESET, `没有这套预设：${标识}`);

    return ok({ ...拼一套(找), 请求 });
  }

  /** 界面预览用的那一个：读草稿，与 执行 同形。 */
  function 测(输入) {
    const 给 = 输入 || {};
    const 请求 = 文本(给.请求).trim();
    const 标识 = 挑一个(草稿, 请求, 文本(给.预设).trim());

    const 找 = 定位(标识, 草稿);
    if (!找) return fail(ERR.NO_SUCH_PRESET, `没有这套预设：${标识}`);
    return ok({ ...拼一套(找), 请求 });
  }

  // ---------- 预设上的动作 ----------

  /** 一本书的正文：标识 → { 标识, 是默认, 一套 }。 */
  function 要预设(标识) {
    const 找 = 定位(文本(标识).trim());
    if (!找) return fail(ERR.NO_SUCH_PRESET, `没有这套预设：${标识 || '（空）'}`);
    return 找;
  }

  /** 要把这套预设写坏时用的那一关。 */
  function 要用户预设(标识) {
    const 找 = 要预设(标识);
    if (找.code) return 找;
    if (找.是默认) return fail(ERR.READONLY_PRESET, `默认预设只读：${找.标识}`);
    return 找;
  }

  /** 把一套新预设放进草稿；给了 请求 就顺带进那个请求的启用列表。 */
  function 收预设(一套, 名字, 请求) {
    const 标识 = 新标识();
    草稿.presets[标识] = {
      ...一套,
      name: 名字,
      tools: 工具差异(一套.tools, 默认工具表()),
      toolsOrder: 工具顺序差异(一套.tools, 默认工具表()),
      ...(一套.runtime && Object.keys(一套.runtime).length ? { runtime: 拷贝(一套.runtime) } : {}),
    };
    if (请求) 草稿.subs[请求] = { 启用: [...启用列(请求), 标识] };
    return { 标识, 名字 };
  }

  /** 取一份源（读草稿：改动都作用在它上面，拷贝那份也得是看得见的那份）。 */
  function 取源(输入) {
    const 标识 = 文本(输入.源).trim();
    if (标识) {
      const 找 = 定位(标识, 草稿);
      if (!找) return fail(ERR.NO_SUCH_PRESET, `没有这套预设：${标识}`);
      return { 一套: { ...拷贝(找.一套), tools: 拷贝(找.工具表) } };
    }
    if (输入.一套 && typeof 输入.一套 === 'object') {
      return { 一套: 加缺省(归一预设(输入.一套), 输入.一套) };
    }
    return { 一套: 默认预设() };
  }

  /**
   * 新建一份快照时，盘上会缺的那几格从默认那套抄过来。
   * 给了就是给了（空数组 = 明说不要），没给才抄。
   */
  function 加缺省(一套, 原文) {
    const 默认那套 = 默认预设();
    if (!Array.isArray(原文.tools)) 一套.tools = 默认工具表();
    if (原文.model === undefined) 一套.model = 拷贝(默认那套.model);
    return 一套;
  }

  function 预设动作(输入 = {}) {
    const 动作 = 文本(输入.动作).trim();

    if (动作 === '导出') {
      const 找 = 要预设(输入.预设);
      if (找.code) return 找;
      return ok({
        名字: 找.一套.name,
        内容: JSON.stringify(
          {
            name: 找.一套.name,
            tools: 找.工具表,
            toolsOrder: [...找.一套.toolsOrder],
            model: 找.一套.model,
            ...(找.一套.runtime && Object.keys(找.一套.runtime).length ? { runtime: 找.一套.runtime } : {}),
          },
          null,
          2,
        ),
      });
    }

    const 拦 = 可写();
    if (拦) return 拦;

    if (动作 === '换') {
      const 请求 = 文本(输入.请求).trim();
      if (!请求) return fail(ERR.BAD_ARGUMENT, '换要给 请求');
      const 列 = 输入.启用;
      if (!Array.isArray(列)) return fail(ERR.BAD_ARGUMENT, '换要给 启用（一串标识；一套都不启用就给空数组）');
      const 归 = [];
      for (const 一 of 列) {
        const 标识 = 文本(一).trim();
        if (!标识) continue;
        // 用户那份要在草稿里，只读默认那份要在默认目录里；两边都不在就是不认识。
        const 认默认 = 拆默认(标识);
        const 在 = 定位(标识) !== null || (认默认 !== null && 默认们().has(认默认));
        if (!在) return fail(ERR.NO_SUCH_PRESET, `没有这套预设：${标识}`);
        if (!归.includes(标识)) 归.push(标识);
      }
      草稿.subs[请求] = { 启用: 归 };
      return ok({ 请求, 启用: [...归] });
    }

    if (动作 === '新建' || 动作 === '复制') {
      // 复制：源就是被复制的那一套；新建：源另给，不给就从只读默认抄一份快照。
      const 源入 = 动作 === '复制' ? { ...输入, 源: 文本(输入.源).trim() || 文本(输入.预设).trim() } : 输入;
      const 源 = 取源(源入);
      if (源.code) return 源;
      const 名字 = 不撞名(文本(输入.名字).trim() || (动作 === '复制' ? `${源.一套.name} 副本` : '新预设'));
      const 收 = 收预设(拷贝(源.一套), 名字, 文本(输入.请求).trim());
      return ok({ 标识: 收.标识, 名字: 收.名字 });
    }

    if (动作 === '导入') {
      const 原文 = typeof 输入.内容 === 'string' ? 输入.内容 : null;
      const 对象 = 原文 === null && 输入.一套 && typeof 输入.一套 === 'object' ? 输入.一套 : null;
      if (原文 === null && 对象 === null) return fail(ERR.BAD_ARGUMENT, '导入要递 内容（JSON 文本）或 一套（对象）');
      let 解析 = 对象;
      if (原文 !== null) {
        try {
          解析 = JSON.parse(原文);
        } catch (_) {
          return fail(ERR.BAD_PRESET, '不是合法的 JSON');
        }
      }
      if (!解析 || typeof 解析 !== 'object' || Array.isArray(解析)) return fail(ERR.BAD_PRESET, '这不是一套预设');
      const 归一过 = 归一预设(解析);
      const 名字 = 不撞名(文本(输入.名字).trim() || 归一过.name || '导入的预设');
      const 收 = 收预设(归一过, 名字, 文本(输入.请求).trim());
      return ok({ 标识: 收.标识, 名字: 收.名字, 工具数: 默认工具表().length });
    }

    if (动作 === '改名') {
      const 找 = 要用户预设(输入.预设);
      if (找.code) return 找;
      const 名字 = 文本(输入.名字).trim();
      if (!名字) return fail(ERR.BAD_ARGUMENT, '新名字不能为空');
      找.一套.name = 名字;
      return ok({ 标识: 找.标识, 名字 });
    }

    if (动作 === '删') {
      const 找 = 要用户预设(输入.预设);
      if (找.code) return 找;
      delete 草稿.presets[找.标识];
      for (const [请求, 份] of Object.entries(草稿.subs)) {
        const 剩 = 份.启用.filter((一) => 一 !== 找.标识);
        if (剩.length !== 份.启用.length) 草稿.subs[请求] = { 启用: 剩 };
      }
      return ok({ 删了: 找.标识 });
    }

    if (动作 === '改') {
      const 找 = 要用户预设(输入.预设);
      if (找.code) return 找;
      const 套 = 找.一套;
      if (输入.model !== undefined) 套.model = 拷贝(一对象(输入.model));
      if (输入.runtime !== undefined) 套.runtime = 拷贝(一对象(输入.runtime));
      return ok({ 标识: 找.标识, 改了: [...(输入.model === undefined ? [] : ['model']), ...(输入.runtime === undefined ? [] : ['runtime'])] });
    }

    return fail(ERR.BAD_ARGUMENT, `没有这个动作：${动作 || '（空）'}`);
  }

  // ---------- 工具上的动作 ----------

  function 工具动作(输入 = {}) {
    const 拦 = 可写();
    if (拦) return 拦;
    const 动作 = 文本(输入.动作).trim();
    if (!['加', '改', '删', '重置', '移'].includes(动作)) return fail(ERR.BAD_ARGUMENT, `没有这个动作：${动作 || '（空）'}`);
    const 目标 = 要用户预设(输入.预设);
    if (目标.code) return 目标;
    const 工具列 = 目标.工具表;

    if (动作 === '重置') {
      目标.一套.tools = [];
      目标.一套.toolsOrder = [];
      return ok({ 预设: 目标.标识, 工具数: 默认工具表().length });
    }

    if (动作 === '加') {
      const 名字 = 文本(输入.名字).trim();
      if (!名字) return fail(ERR.BAD_ARGUMENT, '加要给 名字');
      const 从 = 工具列.find((一) => 一.名字 === 名字);
      if (!从) return fail(ERR.NO_SUCH_TOOL, '当前业务工具表里没有：' + 名字);
      if (从.启用 !== false) return fail(ERR.BAD_ARGUMENT, '工具已启用：' + 名字);
      从.启用 = true;
      目标.一套.tools = 工具差异(工具列, 默认工具表());
      return ok({ 加了: 名字, 算得出来: true });
    }

    const 名字 = 文本(输入.名字).trim();
    const 序 = 工具列.findIndex((一) => 一.名字 === 名字);
    if (序 < 0) return fail(ERR.NO_SUCH_TOOL, `这套预设里没有这个工具：${名字 || '（空）'}`);

    if (动作 === '改') {
      const 旧 = 工具列[序];
      if (输入.启用 !== undefined) 旧.启用 = 输入.启用 !== false;
      if (typeof 输入.摘要 === 'string') 旧.摘要 = 输入.摘要;
      const 描述 = { ...旧.说明, ...一对象(输入.说明) };
      for (const [键, 项] of Object.entries(一对象(输入.参数))) {
        if (typeof 项?.description === 'string') 描述[键] = 项.description;
      }
      for (const [键, 话] of Object.entries(描述)) {
        if (typeof 话 !== 'string' || !旧.参数[键]) continue;
        旧.参数[键].description = 话;
        旧.文本覆盖 = { ...(旧.文本覆盖 || {}), [`/${键}`]: 话 };
      }
      function 收参数覆盖(传入, 当前, 路径) {
        if (!传入 || typeof 传入 !== 'object') return;
        if (typeof 传入.description === 'string') {
          旧.文本覆盖 = { ...(旧.文本覆盖 || {}), [路径]: 传入.description };
          if (路径.startsWith('/') && 路径.split('/').length === 2) 旧.说明[路径.slice(1)] = 传入.description;
        }
        for (const 集合 of ['properties', 'patternProperties', '$defs', 'definitions']) for (const [子名, 子] of Object.entries(传入[集合] || {})) 收参数覆盖(子, 当前?.[集合]?.[子名], `${路径}/${集合}/${子名}`);
        if (传入.items && typeof 传入.items === 'object') 收参数覆盖(传入.items, 当前?.items, `${路径}/items`);
        for (const 集合 of ['oneOf', 'anyOf', 'allOf']) (传入[集合] || []).forEach((子, 序) => 收参数覆盖(子, 当前?.[集合]?.[序], `${路径}/${集合}/${序}`));
        if (传入.additionalProperties && typeof 传入.additionalProperties === 'object') 收参数覆盖(传入.additionalProperties, 当前?.additionalProperties, `${路径}/additionalProperties`);
      }
      for (const [键, 项] of Object.entries(一对象(输入.参数))) 收参数覆盖(项, 旧.参数[键], `/${键}`);
      旧.说明 = 描述;
      目标.一套.tools = 工具差异(工具列, 默认工具表());
      return ok({ 工具: 拷贝(旧) });
    }

    if (动作 === '删') {
      const 去掉 = 工具列[序];
      去掉.启用 = false;
      目标.一套.tools = 工具差异(工具列, 默认工具表());
      return ok({ 删了: 去掉.名字 });
    }

    if (动作 === '移') {
      let 到;
      if (输入.到 !== undefined && 输入.到 !== null) 到 = Number(输入.到);
      else if (输入.方向 === '上') 到 = 序 - 1;
      else if (输入.方向 === '下') 到 = 序 + 1;
      else return fail(ERR.BAD_ARGUMENT, '移要给 方向（上/下）或 到（序号）');
      if (!Number.isInteger(到) || 到 < 0 || 到 >= 工具列.length) {
        return fail(ERR.BAD_ARGUMENT, `移不到那个位置：${输入.到 !== undefined ? 输入.到 : 输入.方向}`);
      }
      const [一条] = 工具列.splice(序, 1);
      工具列.splice(到, 0, 一条);
      目标.一套.toolsOrder = 工具顺序差异(工具列, 默认工具表());
      return ok({ 名字: 一条.名字, 到 });
    }

    return fail(ERR.BAD_ARGUMENT, `没有这个动作：${动作 || '（空）'}`);
  }

  // ---------- 存取 ----------

  /** 草稿写进端口。 */
  function 存() {
    const 拦 = 可写();
    if (拦) return 拦;
    const 写 = rawPort.writeState(拷贝(草稿));
    if (!写.ok) return fail(ERR.WRITE_FAILED, `写不进去：${写.reason || '未知'}`);
    const 读 = rawPort.readState();
    if (读.state === 'ok') {
      const 收 = 收存档(读.value, 默认工具表());
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
    return ok({ 冻结: 冻结(), 脏: 脏(), 工具数: 默认工具表().length });
  }

  /** 体检。 */
  function 状态查() {
    const 算的 = 默认工具表();
    return ok({
      默认: 表().filter((x) => x.是本子).length,
      用户预设: Object.keys(草稿.presets).length,
      请求: Object.keys(草稿.subs).length,
      默认工具数: 算的.length,
      认不出的动作: [],
      存档: 冻结() ? { 冻结: true, reason: 读不懂 } : { 冻结: false },
      脏: 脏(),
    });
  }

  载入();

  return {
    ERR,
    读,
    表,
    预设: 预设动作,
    工具: 工具动作,
    执行,
    测,
    存,
    丢,
    重读,
    状态: 状态查,
  };
}

module.exports = { createCore, ERR, 默认名字 };
