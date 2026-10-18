'use strict';
/*
 * 我们这一层：把旧版界面要的 `window.AppModules` 袋子造出来，接到本项目的门面上。
 *
 * 旧版那份界面只跟 `window.AppModules` 说话（`app.js` 开篇就读它），所以这一份
 * 就是两边唯一的接缝：**上面是旧版的形状，下面是我们 `/toolbox/调` 那一条路**。
 *
 * 这一份是全局脚本（旧版整套都是经典脚本，没有 ES module），必须排在 `app.js` 之前。
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么有一门"同步通道"
 *
 * 旧版把整个标签库抱在内存里（原来在 preload 那个 Node 进程里），所以它有一批方法
 * 是**同步读**的：`tags.page()` / `catalog.getTag()` / `favorites.list()` …
 * 我们这一侧的库在服务里，只有 HTTP，而 HTTP 是异步的。
 *
 * 于是这一层分成两半：
 *   同步那一半 —— `同步调()` 走同步 XHR。本机往返约 1 毫秒，换来旧版一行不用改。
 *   异步那一半 —— `调()` 走 fetch：写操作、以及本来就 async 的那些。
 *
 * 加上两层内存缓存（记录、分类树），热路径上多数同步读连一次往返都不用。
 *
 * ─────────────────────────────────────────────────────────────────
 * 三层：
 *   ① 通道      `调()` / `同步调()` / `要桌()`
 *   ② 翻译      我们的记录形状 ↔ 旧版的 tag / 分类 / group 形状
 *   ③ 服务      tags · catalog · preferences，以及还没接的那些（记账，不静默）
 */
(function 造我们的模块(global) {
  const 令牌 = global.__令牌__ || '';

  /* ══════════════════════════════════════════════════════════════
   * 一、通道
   * ══════════════════════════════════════════════════════════════ */

  /**
   * 同步请一条本服务的路。
   *
   * 旧版有一批方法是同步读的，这条通道就是为它们开的；两条 POST 都走它：
   * `/toolbox/调`（模块动作）与 `/toolbox/链路`（API 配置页那张链路表）。
   *
   * @param {string} 路
   * @param {object} [体]
   */
  function 同步要(路, 体) {
    const 器 = new XMLHttpRequest();
    器.open('POST', 路, false);
    器.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
    器.setRequestHeader('x-toolbox-token', 令牌);
    器.send(JSON.stringify(体 || {}));
    try { return JSON.parse(器.responseText); } catch (_) {
      return { ok: false, code: 'PAGE_NOT_JSON', reason: '回执不是 JSON' };
    }
  }

  /**
   * 同步调一条模块动作。
   * @param {string} 模块
   * @param {string} 动作
   * @param {object} [参数]
   */
  function 同步调(模块, 动作, 参数) {
    return 同步要('/toolbox/调', { 模块, 动作, 参数: 参数 || {} });
  }

  /** 异步请一条本服务的路。界面这一侧只有两条：`/toolbox/调` 与 `/存图`。 */
  async function 请(路, 体) {
    try {
      const 回 = await fetch(路, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 令牌 },
        body: JSON.stringify(体 || {}),
      });
      return await 回.json();
    } catch (错) {
      return { ok: false, code: 'PAGE_FETCH', reason: String((错 && 错.message) || 错) };
    }
  }

  /** 异步调一条模块动作。 */
  async function 调(模块, 动作, 参数) {
    return 请('/toolbox/调', { 模块, 动作, 参数: 参数 || {} });
  }

  async function 取Comfy状态() {
    const [探活, 开关] = await Promise.all([
      调('comfy', '探活', {}),
      调('comfy', '绘图开关', {}),
    ]);
    const connected = Boolean(探活 && 探活.ok !== false && (探活.设备 || 探活.版本));
    let 认口 = null;
    let error = 探活?.reason || '';
    if (connected) {
      const 定义 = await 调('comfy', '看节点定义', {});
      if (!定义 || 定义.ok === false) error = 定义?.reason || 'ComfyUI 节点定义不可用';
      else {
        认口 = await 调('comfy', '认', {});
        if (!认口 || 认口.ok === false) error = 认口?.reason || 'ComfyUI 工作流识别失败';
      }
    }
    return {
      connected,
      enabled: 开关?.ok !== false && 开关?.启用 === true,
      workflowReady: Array.isArray(认口?.正向) && 认口.正向.length > 0,
      batchSupported: Array.isArray(认口?.张数) && 认口.张数.length > 0,
      error,
      version: (探活 && 探活.版本) || '',
      device: (探活 && 探活.设备) || '',
    };
  }

  /** 要桌面：动作表 · 装不上 · 模型。 */
  async function 要桌() {
    return 请('/toolbox/桌', {});
  }

  /**
   * 门面回执 → 旧版那套 `{ok:false,error:{code,message}}`。
   * 模块的失败信封是 `{ok:false,reason,code}`，名字不一样，翻一层。
   */
  function 翻(回) {
    if (回 && 回.ok === false) {
      return { ok: false, error: { code: 回.code || 'MODULE_FAILED', message: 回.reason || '模块没给理由', details: 回.details } };
    }
    return { ok: true, data: 回 };
  }

  /** 走一条动作并把回执翻成旧版的信封。 */
  const 走 = (模块, 动作, 参数) => 翻(同步调(模块, 动作, 参数));
  const 走异步 = async (模块, 动作, 参数) => 翻(await 调(模块, 动作, 参数));

  /* ══════════════════════════════════════════════════════════════
   * 二、账本：还没接的方法一条都不许静默
   * ══════════════════════════════════════════════════════════════ */

  const 账本 = [];
  const 已记 = new Set();

  function 记(服务, 方法, 参数) {
    const 键 = `${服务}.${方法}`;
    if (已记.has(键)) return;
    已记.add(键);
    let 样子 = '';
    try { 样子 = JSON.stringify(参数); } catch (_) { 样子 = String(参数); }
    账本.push(`${键}  ${(样子 || '').slice(0, 140)}`);
    画账本();
  }

  function 画账本() {
    try {
      const 文档 = global.document;
      if (!文档 || !文档.body) return;
      let 盒 = 文档.getElementById('我们的账本');
      if (!盒) {
        盒 = 文档.createElement('pre');
        盒.id = '我们的账本';
        盒.style.cssText = 'position:fixed;left:-99999px;top:0;margin:0;';
        文档.body.append(盒);
      }
      盒.textContent = 账本.join('\n');
    } catch (_) { /* 账本画不出来不该影响界面 */ }
  }

  /* ══════════════════════════════════════════════════════════════
   * 三、翻译：我们的记录形状 ↔ 旧版要的形状
   * ══════════════════════════════════════════════════════════════ */

  /**
   * 我们的分类页名 → 旧版认的那套分类 id。
   *
   * 两边的分类本来就是同一份 Danbooru 分组，所以是一一对应的；对上之后旧版的
   * 配色表与图标表（`app-view.js` 的 `categoryColors` / `categoryIcons`）就都生效了。
   */
  const 页名到旧版 = Object.freeze({
    质量词: 'quality',
    负面提示词: 'negative',
    人物与角色: 'character',
    作品系列: 'series',
    身材与身体: 'body',
    表情: 'expression',
    眼睛: 'eyes',
    头发: 'hair',
    角色特征: 'features',
    服装: 'outfit',
    鞋袜: 'footwear',
    道具与装饰: 'accessory',
    动作与姿势: 'pose',
    场景与环境: 'scene',
    视角与镜头: 'camera',
    画风与风格: 'style',
    时间与天气: 'time_weather',
    氛围与光影: 'atmosphere',
    特效与魔法: 'effects',
    食物与饮料: 'food',
    动物: 'animal',
    其他: 'other',
    内容分级: 'rating',
    成人标签: 'nsfw',
    角色名: 'character_names',
    角色专属词: 'character_specific',
    wd_general: 'wd_general',
  });

  /** 旧版分类 id → 我们那一页（反向表，登一次）。 */
  const 旧版到页名 = Object.freeze(
    Object.fromEntries(Object.entries(页名到旧版).map(([页, 旧]) => [旧, 页])),
  );

  /**
   * 我们的一条记录 → 旧版的一条 tag。
   *
   * 我们：`{ID, 名称, 中文名, 成员?, 隐藏?, 改过?}`
   * 旧版：`{id, en, zh, content, displayName, aliases, kind, memberTagIds, …}`
   *
   * @param {object} 记 我们的记录
   * @param {string} [分类] 它所在的分类 id（浏览那条路知道；查库那条路不知道）
   * @param {string} [子类] 它所在的子类
   */
  function 翻记录(记, 分类, 子类) {
    if (!记 || 记.ID === undefined) return null;
    const 名 = 名主值(记.名称);
    const 中文名们 = String(记.中文名 || '').split(/[,，]/).map(一 => 一.trim()).filter(Boolean);
    const 中 = 中文名们[0] || '';
    const 成员 = Array.isArray(记.成员) ? 记.成员.map(String) : undefined;
    const 位置 = 分类 ? 找(分类, 子类) : { 页: null, 类: null };
    return {
      id: String(记.ID),
      en: 名,
      zh: 中,
      content: 名,
      displayName: 中 || 名,
      aliases: [...String(记.名称 || '').split(/[,，]/).map(一 => 一.trim()).filter(Boolean).slice(1), ...中文名们.slice(1)],
      kind: 成员 ? 'bundle' : 'tag',
      memberTagIds: 成员,
      categoryId: 位置.页 ? String(位置.页.ID) : undefined,
      subcategoryId: 位置.类 ? String(位置.类.ID) : undefined,
      note: null,
      source: { kind: String(记.ID).startsWith('u') ? 'custom' : 'bundled' },
      revision: 状态.版本,
      category: 分类 || 'other',
      subcategory: 子类 || '默认',
      nsfw: false,
      adult: false,
      favorite: 是收藏标识(记.ID),
      custom: false,
      edited: Boolean(记.改过),
      hidden: Boolean(记.隐藏),
      searchable: true,
    };
  }

  /** 名称的第一个写法（逗号分隔，第一个是规范写法）。 */
  function 名主值(名) {
    return String(名 == null ? '' : 名).split(/[,，]/)[0].trim();
  }

  /**
   * 我们的一条记录 → 旧版"当前组合里的那一条"。
   *
   * 我们：`{ID, 名称, 中文名}`
   * 旧版：`{key, kind, tagIds, content, displayName, adult}`
   *
   * `key` 是 `<种类>:<标识>`，底栏那颗 ✕ 把它拆回 `{ kind, tagId }` 再发回来（见 `选中()`）。
   */
  function 翻选中(记) {
    const id = String(记.ID);
    const 名 = 名主值(记.名称) || id;
    const 中 = 名主值(记.中文名);
    return {
      ...翻记录(记),
      key: `tag:${id}`,
      kind: 'tag',
      tagIds: [id],
      content: 名,
      displayName: 中 || 名,
      adult: 记.成人 === true,
    };
  }

  /** 一条 tag（或一个词）→ 拼进提示词里的那一段：名称那一个词。 */
  function 出词(一) {
    if (typeof 一 === 'string') return 名主值(一);
    if (!一 || typeof 一 !== 'object') return '';
    return 名主值(一.en || 一.content || 一.名称);
  }

  /* ══════════════════════════════════════════════════════════════
   * 四、缓存与状态
   * ══════════════════════════════════════════════════════════════ */

  /** 记录缓存：`record.batch` / `query` 的产物。同步读先看这里。 */
  const 记录缓存 = new Map();

  /** 分类树缓存：`position.list` 的产物。 */
  let 分类树 = null;
  let 分类树脏 = true;

  /** 成员缓存：`页ID|类ID` → 标识数组。 */
  const 成员缓存 = new Map();

  /** 台账：`status` 的产物，用来回答"一共有多少条"。 */
  let 台账 = null;

  /** 界面这一侧的状态。旧版把这几个也放在服务里，我们照放。 */
  const 状态 = {
    串: '',
    分类: 'all',
    子类: '',
    成人: false,
    版本: 1,
    选中: new Map(),
  };

  /** 把一批记录收进缓存。 */
  function 收记录(们) {
    for (const 一 of 们 || []) {
      if (一 && 一.ID !== undefined) 记录缓存.set(String(一.ID), 一);
    }
  }

  /** 取分类树（脏了就重取）。 */
  function 要分类树() {
    if (!分类树脏 && 分类树) return 分类树;
    const 回 = 同步调('tag', 'position.list', { 位置: '分类' });
    if (回 && 回.ok === false) { 记('tag', 'position.list', 回.reason); return 分类树 || []; }
    const 页们 = Array.isArray(回) ? 回 : (Array.isArray(回?.data) ? 回.data : []);
    分类树 = 页们;
    分类树脏 = false;
    成员缓存.clear();
    return 分类树;
  }

  /** 找一页 / 一类。`分类` 收旧版 id，`子类` 收我们的类 ID 或类名。 */
  function 找(分类, 子类) {
    const 树 = 要分类树();
    const 页名 = 旧版到页名[分类] || 分类;
    const 页 = 树.find((一) => 一.页名 === 页名 || String(一.ID) === String(分类));
    if (!页) return { 页: null, 类: null };
    const 类们 = 页.类列表 || [];
    const 类 = 子类
      ? 类们.find((一) => String(一.ID) === String(子类) || 一.类名 === 子类)
      : 类们[0];
    return { 页, 类: 类 || null };
  }

  /** 一页底下的全部成员（所有类合起来）。 */
  function 一页全体(页) {
    const 键 = `${页.ID}|*`;
    if (成员缓存.has(键)) return 成员缓存.get(键);
    const 回 = 同步调('tag', 'render.pageMap', { 页: 页.ID });
    if (回 && 回.ok === false) { 记('tag', 'render.pageMap', 回.reason); return []; }
    const 归属 = Array.isArray(回) ? 回 : [];
    const 出 = [];
    for (const 类 of 页.类列表 || []) 成员缓存.set(`${页.ID}|${类.ID}`, []);
    for (const 一 of 归属) {
      const id = String(一.成员);
      出.push(id);
      成员缓存.get(`${页.ID}|${一.类ID}`).push(id);
    }
    成员缓存.set(键, 出);
    return 出;
  }

  /** 一类的成员标识。 */
  function 一类的成员(页, 类) {
    const 键 = `${页.ID}|${类.ID}`;
    if (成员缓存.has(键)) return 成员缓存.get(键);
    const 回 = 同步调('tag', 'position.members', { 位置: '分类', 页: 页.ID, 类: 类.ID });
    const 出 = Array.isArray(回) ? 回.map(String) : [];
    成员缓存.set(键, 出);
    return 出;
  }

  /** 一批标识 → 记录（先查缓存，缺的才问模块）。 */
  function 要记录(标识们) {
    const 出 = [];
    const 缺 = [];
    for (const id of 标识们) {
      const 有 = 记录缓存.get(String(id));
      if (有) 出.push(有); else 缺.push(String(id));
    }
    if (缺.length) {
      const 回 = 同步调('tag', 'record.batch', { 标识列表: 缺 });
      const 记们 = Array.isArray(回) ? 回 : (Array.isArray(回?.data) ? 回.data : []);
      收记录(记们);
      for (const 一 of 记们) 出.push(一);
    }
    return 出;
  }

  /** 挑一页：把标识切片再翻成记录。 */
  function 分一页(标识们, 偏移, 上限, 分类, 子类) {
    const 片 = 标识们.slice(偏移, 偏移 + 上限);
    const 记们 = 要记录(片);
    return {
      items: 记们.map((一) => 翻记录(一, 分类, 子类)).filter(Boolean),
      total: 标识们.length,
      hasMore: 偏移 + 上限 < 标识们.length,
    };
  }

  /* ══════════════════════════════════════════════════════════════
   * 五、tags —— 旧版最大的一块
   * ══════════════════════════════════════════════════════════════ */

  const 标签服务 = {
    /**
     * 分页取标签。**同步**。
     *
     * 两条路：
     *   有查询串 → `tag/query`（给一组候选，带"还有更多"）
     *   没查询串 → 按分类浏览：`position.members` 拿标识，`record.batch` 拿记录
     *
     * 旧版把它当游标用（`while (page.hasMore) tags.page({...offset})`），所以
     * 每次调用都要按 `offset` 现切，不能只缓存首页。
     */
    page(选项) {
      const 选 = 选项 || {};
      const 偏移 = Number(选.offset) || 0;
      const 上限 = Math.max(1, Number(选.limit) || 400);
      const 串 = String(选.query || 状态.串 || '').trim();

      if (串) {
        const 回 = 同步调('tag', 'query', { 串, 上限: 偏移 + 上限 });
        if (回 && 回.ok === false) {
          return { items: [], total: 0, hasMore: false, error: { code: 回.code, message: 回.reason } };
        }
        const 候选 = Array.isArray(回?.候选) ? 回.候选 : [];
        收记录(候选.map((一) => 一.记录));
        const 片 = 候选.slice(偏移);
        return {
          items: 片.map((一) => {
            const 记 = 翻记录(一.记录, 'other', '默认');
            if (记) { 记.命中 = 一.档; 记.matchType = 一.命中; }
            return 记;
          }).filter(Boolean),
          total: Number(回?.合计) || 候选.length,
          hasMore: Boolean(回?.还有更多) && 片.length >= 上限,
        };
      }

      const 分类 = 选.category && 选.category !== 'all' ? 选.category : '';
      const 子类 = 选.subcategory || '';

      // 「全部标签」：把每一页的成员排起来。
      if (!分类) {
        const 树 = 要分类树();
        const 全体 = [];
        for (const 页 of 树) for (const id of 一页全体(页)) 全体.push({ id, 页 });
        const 片 = 全体.slice(偏移, 偏移 + 上限);
        const 记录 = new Map(要记录(片.map(一 => 一.id)).map(一 => [String(一.ID), 一]));
        return {
          items: 片.map(一 => 翻记录(记录.get(一.id), 页名到旧版[一.页.页名] || String(一.页.ID), 一.页.页名)).filter(Boolean),
          total: 全体.length,
          hasMore: 偏移 + 上限 < 全体.length,
        };
      }

      const { 页, 类 } = 找(分类, 子类);
      if (!页) return { items: [], total: 0, hasMore: false };
      const 标识们 = 类 ? 一类的成员(页, 类) : 一页全体(页);
      return 分一页(标识们, 偏移, 上限, 分类, 类 ? 类.类名 : '');
    },

    /** 旧版的状态快照。**同步**，每次重画都读。 */
    stateSnapshot() {
      const 树 = 要分类树();
      const 分类们 = 树.map((页) => ({
        id: 页名到旧版[页.页名] || String(页.ID),
        name: 页.页名,
      }));
      const 计数 = {};
      let 全体数 = 0;
      for (const 页 of 树) {
        const id = 页名到旧版[页.页名] || String(页.ID);
        const 数 = 一页全体(页).length;
        计数[id] = 数;
        全体数 += 数;
      }
      计数.all = 全体数;
      return {
        categories: 分类们,
        categoryCounts: 计数,
        query: 状态.串,
        category: 状态.分类,
        includeAdult: 状态.成人,
        revision: 状态.版本,
        selected: this.selected(),
      };
    },

    getCategories() { return this.stateSnapshot().categories; },

    /** 旧版没有 `searchContract` 就走 `page()` 那条路（本实现只接那条）。 */
    size() {
      if (!台账) {
        const 回 = 同步调('tag', 'status', {});
        台账 = (回 && 回.ok === false) ? {} : 回;
      }
      return Number(台账?.记录?.主库) || 0;
    },

    setQuery(串) { 状态.串 = String(串 || ''); 状态.版本 += 1; },
    setCategory(id) { 状态.分类 = String(id || 'all'); 状态.子类 = ''; 状态.版本 += 1; },
    setAdult(开) { 状态.成人 = Boolean(开); 状态.版本 += 1; },
    restoreUserState() { /* 状态住内存，没有要还原的 */ },
    warmSearchIndex() { /* 服务那一侧已经热了 */ },
    revision() { return 状态.版本; },

    /** 子类：旧版要 `[{id,name,count,custom}]`。 */
    subcategories(分类) {
      const { 页 } = 找(分类, '');
      if (!页) return [];
      return (页.类列表 || []).map((类) => ({
        id: String(类.ID),
        name: 类.类名,
        count: 一类的成员(页, 类).length,
        custom: false,
      }));
    },

    /** 选中的那些。**同步**，每次重画都读。旧版要的形状见 `翻选中()`。 */
    selected() {
      return [...状态.选中.values()].map((一) => 翻选中(一.记录)).filter(Boolean);
    },

    async resolveText(词) {
      const 回 = await 调('tag', 'resolve', { 词: String(词 || '') });
      if (!回 || 回.ok === false) return '';
      return String(回.标识 ?? 回.记录?.ID ?? '');
    },

    select(id, 开) {
      const 键 = String(id);
      if (开 === false) 状态.选中.delete(键);
      else {
        const 已有 = 记录缓存.get(键);
        if (已有) 状态.选中.set(键, { 记录: 已有 });
        else {
          const 回 = 同步调('tag', 'record.get', { 标识: 键 });
          if (回 && 回.ok === false) return { ok: false, error: { code: 回.code, message: 回.reason } };
          const 记 = Array.isArray(回) ? 回[0] : 回;
          收记录([记]);
          状态.选中.set(键, { 记录: 记 });
        }
      }
      状态.版本 += 1;
      return { ok: true, data: this.selected() };
    },

    async toggleSelected(id) { return this.select(id); },
    clearSelection() { 状态.选中.clear(); 状态.版本 += 1; return { ok: true, data: [] }; },

    /** 复制用的文本：一行一个标签名。**同步**，失败给空串。 */
    copyText(ids) {
      const 列 = Array.isArray(ids) ? ids : (ids === undefined ? [...状态.选中.keys()] : [ids]);
      const 名们 = [];
      for (const id of 列) {
        const 记 = 记录缓存.get(String(id));
        if (记) 名们.push(记.名称);
      }
      return 名们.join(', ');
    },

    get(id) {
      const 记 = 记录缓存.get(String(id));
      return 记 ? 翻记录(记) : undefined;
    },

    /** 识图打出来的词 → 旧版要的展示行。四个字段名两套写法都认（我们那套是中文键）。 */
    describe(行们) {
      const 分类表 = this.stateSnapshot().categories;
      return (Array.isArray(行们) ? 行们 : []).map((一) => {
        const 名 = String(一?.rawText || 一?.tag || 一?.词 || 一?.name || 一?.en || 一 || '');
        const 概率 = typeof 一?.probability === 'number' ? 一.probability
          : (typeof 一?.概率 === 'number' ? 一.概率 : undefined);
        return {
          rawText: 名,
          displayName: 名主值(一?.displayName || 一?.中文名 || 一?.zh || ''),
          categoryId: String(一?.categoryId || 一?.分类 || 'other'),
          probability: 概率,
          categories: 分类表,
        };
      });
    },

    /**
     * 标签组：**用户自己建的那些组**。
     *
     * 库里的角色组归角色库那一屏，系列组是角色库左栏的作品，两张身份表都不认的组才是
     * 用户自己组起来的（自建的组不在任何一张表里）。取数读后台那一份缓存（`拉组()`），
     * 不走同步通道 —— 那份回执 4.64 MB / 3 秒。
     */
    searchGroups(串) {
      拉组();
      const 净 = String(串 || '').trim().toLowerCase();
      const 组们 = (组账.全 || []).filter((一) => 一 && !一.是角色组 && !一.是系列组);
      const 滤 = 净
        ? 组们.filter((一) => `${一.名称 || ''} ${一.中文名 || ''}`.toLowerCase().includes(净))
        : 组们;
      return 滤.map((一) => ({ ...翻记录(一), custom: String(一.ID).startsWith('u') }));
    },
    listGroups() { return this.searchGroups(''); },

    expandGroup(id) {
      const 记 = 记录缓存.get(String(id));
      const 成员 = 记 && Array.isArray(记.成员) ? 记.成员 : [];
      return 要记录(成员).map((一) => 翻记录(一));
    },

    setQueryRaw(串) { 状态.串 = String(串 || ''); },
  };

  /* ══════════════════════════════════════════════════════════════
   * 六、catalog —— "标签库准备好了没有"那道闸 + 选中的权威
   * ══════════════════════════════════════════════════════════════ */

  /** 目录变化的听众。旧版 `catalog.subscribe` 那条：写命令回来之后它重画底栏。 */
  const 目录听众 = new Set();

  /** 报一次"目录变了"。字段形状照旧版要的：`{ changedTagIds, structureChanged }`。 */
  function 目录变了(命令) {
    const 型 = 命令?.type;
    const id = 命令?.tagId;
    const ids = 型 === 'unfavorite'
      ? (Array.isArray(命令.membershipIds) ? 命令.membershipIds : []).map(value => String(value && typeof value === 'object' ? value.tagId ?? value.id ?? value.membershipId : value)).filter(Boolean)
      : id === undefined || id === null ? [] : [String(id)];
    const 改位置 = ['favoriteTag', 'unfavorite', 'saveTag', 'deleteTag', 'hideTag', 'unhideTag', 'restoreTag'].includes(型);
    const 报 = { changedTagIds: [...new Set(ids)], structureChanged: 改位置 };
    for (const 听 of 目录听众) { try { 听(报); } catch (_) { /* 一个听众出错不该拦住别的 */ } }
  }

  const 目录服务 = {
    async ready() {
      const 回 = await 桌好了;
      if (!回 || 回.ok === false) {
        return { ok: false, error: { code: 回?.code || 'NO_DESK', message: 回?.reason || '拿不到动作表' } };
      }
      // 顺手把分类树与台账热一次，免得首屏同步读时冷启。
      try { 要分类树(); 标签服务.size(); } catch (_) { /* 热不起来也不该挡住 } */ }
      return { ok: true, data: {} };
    },
    async status() {
      const 回 = await 桌好了;
      return { ready: Boolean(回 && 回.ok !== false), writable: true, revision: 状态.版本 };
    },
    async listHiddenTags() {
      const 回 = await 调('tag', 'hidden.list', {});
      if (回 && 回.ok === false) return 翻(回);
      return { ok: true, data: (Array.isArray(回) ? 回 : []).map(record => ({
        id: String(record.ID),
        content: 名主值(record.名称),
        displayName: 名主值(record.中文名),
      })) };
    },
    async retryInitialization() { return this.ready(); },
    async recoverBackup() {
      return { ok: false, error: { code: 'NOT_OURS', message: '我们这一侧没有"恢复备份"这回事' } };
    },
    async flush() { return true; },
    /** 订阅：注册进来的听众在写命令成功之后各叫一次（旧版靠它重画底栏）。 */
    subscribe(听) {
      if (typeof 听 === 'function') 目录听众.add(听);
      return () => 目录听众.delete(听);
    },
    revision() { return 状态.版本; },

    /** 选中的权威来源。旧版有 catalog 时走这一条。 */
    selected() { return 标签服务.selected(); },

    /** 一条记录的权威形状。**同步**。收藏落点一起带上（旧版靠它判"收没收藏过"）。 */
    getTag(id) {
      const 键 = String(id);
      let 记 = 记录缓存.get(键);
      if (!记) {
        const 回 = 同步调('tag', 'record.get', { 标识: 键 });
        if (回 && 回.ok === false) return undefined;
        const 一 = Array.isArray(回) ? 回[0] : 回;
        收记录([一]);
        记 = 一;
      }
      if (!记) return undefined;
      const 出 = 翻记录(记);
      if (!出) return undefined;
      出.favoriteLocations = 收藏落点们(键);
      出.favorite = 出.favoriteLocations.length > 0;
      出.note = 同步调('tag', 'note.get', { 标识: 键 });
      出.categoryId = undefined;
      出.subcategoryId = undefined;
      const taxonomy = 同步调('tag', 'position.whereIs', { 位置: '分类', 成员: 键 });
      const location = Array.isArray(taxonomy) ? taxonomy[0] : null;
      if (location) {
        出.categoryId = String(location.页);
        出.subcategoryId = String(location.类);
      }
      return 出;
    },

    getCategories() {
      return 要分类树().map(page => ({ id: String(page.ID), name: page.页名 }));
    },
    getSubcategories(分类) {
      const page = 要分类树().find(row => String(row.ID) === String(分类));
      return page ? (page.类列表 || []).map(group => ({
        id: String(group.ID), name: group.类名,
        count: 一类的成员(page, group).length, custom: false,
      })) : [];
    },
    /** 收藏那一格：页（旧版叫 series）。 */
    getFavoritePages() { return 收藏服务.series(); },
    /** 收藏那一格：某一页底下的类（旧版叫 group）。 */
    getFavoriteGroups(页ID) { return 收藏服务.sections(页ID); },
    getCharacterLinks() { return { seriesTagIds: [], generalTagIds: [], specificTagIds: [] }; },
    getTagGroup(id) { return this.getTag(id); },
    references() { return []; },

    search(串, 选项) {
      const 页 = 标签服务.page({ query: 串, offset: 选项?.offset || 0, limit: 选项?.limit || 40 });
      return { items: 页.items || [], total: 页.total || 0 };
    },

    /**
     * 写命令：旧版把选中 / 清空选中 / 收藏 / 取消收藏都从这一条走。
     * 写完报一次"目录变了" —— 底栏那颗 ✕ 就是靠这一报重画的（它自己不再画一次）。
     */
    async execute(命令) {
      const 回 = await this._走命令(命令);
      if (回 && 回.ok !== false) 目录变了(命令);
      return 回;
    },

    async _走命令(命令) {
      const 型 = 命令 && 命令.type;
      if (型 === 'select') {
        // 底栏那颗 ✕：`value = { kind:'tag', tagId }`，`selected:false` 表示从组合里拿掉
        const 值 = 命令.value && typeof 命令.value === 'object' ? 命令.value : {};
        const 标识 = 值.tagId === undefined ? 值.id : 值.tagId;
        if (标识 === undefined || 标识 === null || 标识 === '') return { ok: true, data: 标签服务.selected() };
        return 标签服务.select(标识, 命令.selected !== false);
      }
      if (型 === 'clearSelection') return 标签服务.clearSelection();
      if (型 === 'favoriteTag') return this._收藏一个(命令.tagId, 命令.placement);
      if (型 === 'unfavorite') return this._取消收藏(命令.membershipIds);
      if (型 === 'saveTag') return this._保存标签(命令);
      if (型 === 'deleteTag') return this._标签动作('record.delete', { 标识: 命令.tagId });
      if (型 === 'hideTag') return this._标签动作('hidden.hide', { 标识: 命令.tagId });
      if (型 === 'restoreTag') return this._标签动作('modified.restore', { 标识: 命令.tagId });
      if (型 === 'unhideTag') return this._标签动作('hidden.unhide', { 标识: 命令.tagId });
      记('catalog.execute', 型);
      return { ok: false, error: { code: 'NOT_OURS', message: `我们这一侧还没接这个命令：${型}` } };
    },

    async _标签动作(动作, 参数) {
      const 回 = await 调('tag', 动作, 参数);
      if (回 && 回.ok === false) return 翻(回);
      记录缓存.delete(String(参数.标识));
      收藏改了();
      分类树脏 = true;
      成员缓存.clear();
      return { ok: true, data: 回 };
    },

    async _位置标识(位置, 摆位) {
      const parent = 摆位?.[位置 === '收藏' ? 'page' : 'category'] || {};
      const child = 摆位?.[位置 === '收藏' ? 'group' : 'subcategory'] || {};
      let pageId = parent.id;
      if (!pageId && parent.create?.name) {
        const made = await 调('tag', 'position.createPage', { 位置, 页名: parent.create.name });
        if (made && made.ok === false) return 翻(made);
        pageId = made?.ID;
      }
      if (!pageId) return { ok: false, error: { code: 'INVALID_PARENT', message: '页位置不完整' } };
      let groupId = child.id;
      if (!groupId && child.create?.name) {
        const made = await 调('tag', 'position.createClass', { 位置, 页: Number(pageId), 类名: child.create.name });
        if (made && made.ok === false) return 翻(made);
        groupId = made?.ID;
      }
      if (!groupId) return { ok: false, error: { code: 'INVALID_PARENT', message: '类位置不完整' } };
      return { ok: true, pageId: String(pageId), groupId: String(groupId) };
    },

    async _保存标签(命令) {
      const id = String(命令.tagId || '');
      const patch = 命令.patch || {};
      const placement = 命令.placement || {};
      if (placement.kind === 'favorite') {
        if (Object.keys(patch).length) return { ok: false, error: { code: 'INVALID_FIELD', message: '收藏页只调整收藏位置' } };
        if (!placement.membershipId) return { ok: false, error: { code: 'INVALID_PARENT', message: '收藏位置不完整' } };
        const target = await this._位置标识('收藏', placement);
        if (!target.ok) return target;
        const current = 收藏落点们(id).find(row => row.membershipId === String(placement.membershipId)
          && (!placement.originalPlacement || (row.pageId === String(placement.originalPlacement.page?.id)
            && row.groupId === String(placement.originalPlacement.group?.id))));
        if (!current) return { ok: false, error: { code: 'INVALID_PARENT', message: '收藏位置已不存在' } };
        if (current.pageId === target.pageId && current.groupId === target.groupId) return { ok: true, data: {} };
        const moved = await 调('tag', 'position.attach', { 位置: 收藏位置, 页: Number(target.pageId), 类: Number(target.groupId), 成员: id });
        if (moved && moved.ok === false) return 翻(moved);
        const old = await 调('tag', 'position.detach', { 位置: 收藏位置, 页: Number(current.pageId), 类: Number(current.groupId), 成员: id });
        if (old && old.ok === false) return 翻(old);
        收藏改了();
        return { ok: true, data: {} };
      }
      const got = await 调('tag', 'record.get', { 标识: id });
      if (got && got.ok === false) return 翻(got);
      const record = Array.isArray(got) ? got[0] : got;
      const 名称 = Object.hasOwn(patch, 'content') ? patch.content : record?.名称;
      const 中文名 = Object.hasOwn(patch, 'displayName') ? patch.displayName : record?.中文名;
      const editsRecord = ['content', 'displayName', 'memberTagIds'].some(key => Object.hasOwn(patch, key));
      let edit = record;
      if (editsRecord) {
        edit = await 调('tag', 'record.edit', {
          标识: id,
          名称,
          中文名,
          ...(Object.hasOwn(patch, 'memberTagIds') ? { 成员: patch.memberTagIds } : Array.isArray(record?.成员) ? { 成员: record.成员 } : {}),
        });
        if (edit && edit.ok === false) return 翻(edit);
      }
      if (Object.hasOwn(patch, 'note')) {
        const note = await 调('tag', 'note.set', { 标识: id, 文本: patch.note });
        if (note && note.ok === false) return 翻(note);
      }
      if (placement.kind === 'taxonomy') {
        const target = await this._位置标识('分类', placement);
        if (!target.ok) return target;
        const locations = await 调('tag', 'position.whereIs', { 位置: '分类', 成员: id });
        if (locations && locations.ok === false) return 翻(locations);
        const original = placement.originalPlacement;
        const current = (Array.isArray(locations) ? locations : []).find(row => original
          ? String(row.页) === String(original.category?.id) && String(row.类) === String(original.subcategory?.id)
          : true);
        const same = current && String(current.页) === target.pageId && String(current.类) === target.groupId;
        if (same) {
          记录缓存.delete(id);
          return { ok: true, data: edit };
        }
        const attached = await 调('tag', 'position.attach', { 位置: '分类', 页: Number(target.pageId), 类: Number(target.groupId), 成员: id });
        if (attached && attached.ok === false) return 翻(attached);
        if (current) {
          const detached = await 调('tag', 'position.detach', { 位置: '分类', 页: Number(current.页), 类: Number(current.类), 成员: id });
          if (detached && detached.ok === false) return 翻(detached);
        }
        分类树脏 = true;
        成员缓存.clear();
      }
      记录缓存.delete(id);
      return { ok: true, data: edit };
    },

    /**
     * 把一个词收进收藏。
     *
     * 旧版交上来的 `placement` 是 `{ page, group }`，每一项要么 `{id}`（挑现成的），
     * 要么 `{create:{name}}`（当场新建）。所以这里按需先建页 / 再建类，最后摆进去。
     */
    async _收藏一个(标识, 摆位) {
      const 位 = 摆位 || {};
      let 页ID = 位.page && 位.page.id;
      if (!页ID) {
        const 名 = (位.page && 位.page.create && 位.page.create.name) || '';
        if (!名) return { ok: false, error: { code: 'NO_PAGE', message: '没说收进哪一页' } };
        const 建 = await 收藏服务.saveSeries({ name: 名 });
        if (!建.ok) return 建;
        页ID = 建.data.id;
      }
      let 类ID = 位.group && 位.group.id;
      if (!类ID) {
        const 名 = (位.group && 位.group.create && 位.group.create.name) || '';
        if (!名) return { ok: false, error: { code: 'NO_GROUP', message: '没说收进哪一类' } };
        const 建 = await 收藏服务.saveSection({ name: 名, seriesId: 页ID });
        if (!建.ok) return 建;
        类ID = 建.data.id;
      }
      const 回 = await 调('tag', 'position.attach', { 位置: 收藏位置, 页: Number(页ID), 类: Number(类ID), 成员: String(标识) });
      if (回 && 回.ok === false) return 翻(回);
      收藏改了();
      return { ok: true, data: { pageId: String(页ID), groupId: String(类ID) } };
    },

    /** 从一个或多个摆位里摘掉。 */
    async _取消收藏(摆位们) {
      const 列 = Array.isArray(摆位们) ? 摆位们 : [];
      for (const 摆位 of 列) {
        const 落 = typeof 摆位 === 'object' && 摆位
          ? { 页ID: 摆位.pageId, 类ID: 摆位.groupId, 标识: 摆位.membershipId }
          : { 标识: 摆位, ...(收藏落点(摆位) || {}) };
        if (!落.页ID || !落.类ID || !落.标识) continue;
        const 回 = await 调('tag', 'position.detach', { 位置: 收藏位置, 页: Number(落.页ID), 类: Number(落.类ID), 成员: String(落.标识) });
        if (回 && 回.ok === false) return 翻(回);
      }
      收藏改了();
      return { ok: true, data: {} };
    },
  };

  /* ══════════════════════════════════════════════════════════════
   * 七、首选项
   * ══════════════════════════════════════════════════════════════ */

  let 首选项错误 = null;
  const 首选项监听 = new Set();
  function 首选项失败(回) {
    首选项错误 = 回.reason || '首选项保存失败';
    for (const 听 of 首选项监听) 听({ message: 首选项错误 });
  }
  function 读首选项() {
    const 回 = 同步要('/toolbox/设置', {});
    if (!回 || 回.ok === false) { 首选项失败(回 || {}); return {}; }
    return 回.data.界面 || {};
  }
  const 首选项 = {
    get(键, 默认) {
      const 值 = 读首选项();
      if (Object.hasOwn(值, 键)) return 值[键];
      // 旧版预设是浅色；这一套界面沿用本项目的深色。
      if (键 === 'theme' || 键 === 'app.theme') return 'dark';
      return 默认;
    },
    set(键, 值) {
      const 回 = 同步要('/toolbox/设置', { 存: { 界面: { ...读首选项(), [键]: 值 } } });
      if (!回 || 回.ok === false) 首选项失败(回 || {});
      else 首选项错误 = null;
      return 值;
    },
    remove(键) {
      const 值 = 读首选项(); delete 值[键];
      const 回 = 同步要('/toolbox/设置', { 存: { 界面: 值 } });
      if (!回 || 回.ok === false) 首选项失败(回 || {});
      else 首选项错误 = null;
    },
    onPersistenceError(听) { 首选项监听.add(听); return () => 首选项监听.delete(听); },
    persistenceStatus() { return 首选项错误 ? { ok: false, message: 首选项错误 } : { ok: true }; },
  };

  /* ══════════════════════════════════════════════════════════════
   * 八、翻译，以及界面借它跑 AI 的那条口子
   * ══════════════════════════════════════════════════════════════ */

  /** 要一份译文。走异步那条：本地模型可能要一两百毫秒，不能挡手。 */
  async function 要译文(文本, 方向) {
    const 参 = { 文本 };
    if (方向 && 方向 !== 'auto') 参.方向 = 方向;
    return 调('translate', '本地译', 参);
  }

  /** 刮掉权重括号与 lora 写法，留下一串纯词给查库用。 */
  function 洁(一) {
    return String(一 || '')
      .replace(/^[\s([{]+/, '')
      .replace(/[\s)\]}>]+$/, '')
      .replace(/^<lora:[^>]*>$/i, '')
      .trim();
  }

  const 翻译服务 = {
    /** 本地模型那一格备齐了没有。 */
    available() {
      const 回 = 同步调('translate', '看模型', {});
      return Boolean(回 && 回.ok !== false && 回.可用);
    },

    /** 按文本猜方向。旧版的下拉只给 auto / zh-en / en-zh 三个值。 */
    direction(文本) {
      return /[\u3400-\u9fff]/.test(String(文本 || '')) ? 'zh-en' : 'en-zh';
    },

    /**
     * 命中的标签词。**同步**，输入时每次都调 —— 所以走 `tag/recognize`
     * （纯查库，约 36 毫秒），**不走翻译模型**（那一条可能要几百毫秒，会挡手）。
     */
    findReferences(文本, 方向) {
      const 词们 = String(文本 || '')
        .split(/[,\n，、]/)
        .map(洁)
        .filter(Boolean);
      if (!词们.length) return [];
      const 回 = 同步调('tag', 'recognize', { 词: 词们 });
      if (!Array.isArray(回)) return [];
      const 出 = [];
      for (let i = 0; i < 词们.length; i += 1) {
        const 中文 = 回[i];
        if (!中文) continue;
        出.push({ en: 词们[i], zhPrimary: 中文, matchType: '库', tag: { id: '', en: 词们[i] } });
      }
      return 出;
    },

    async translate(文本, 方向) { return 要译文(文本, 方向); },
    dispose() { /* 没有要收的东西 */ },
  };

  /**
   * `runtime` —— 旧版所有"跑一个 AI 任务"都从这一条走。
   * 我们这一侧只认翻译那条（本地模型）；要 DSH 的那几条如实报缺。
   */
  const 运行时 = {
    async runAiTask(任务, 报文) {
      if (任务 !== 'translation') {
        记('runtime.runAiTask', 任务);
        return { ok: false, error: { code: 'NOT_OURS', message: `我们这一侧还没有这个 AI 任务：${任务}` } };
      }
      const 输 = (报文 && 报文.input) || {};
      const 文本 = String(输.text || '');
      if (输.source === 'ai') {
        // 「交给 AI」这条路使用装订模块生成的翻译回执。
        const 回 = await 调('binding', '装订', { 文本, 方向: 输.direction || 'auto' });
        if (回 && 回.ok === false) return 翻(回);
        return { ok: true, data: 回 };
      }
      const 回 = await 要译文(文本, 输.direction);
      if (回 && 回.ok === false) return 翻(回);
      return { ok: true, data: 回 };
    },

    async callTool(名, 输入) {
      记('runtime.callTool', 名);
      return { ok: false, error: { code: 'NOT_OURS', message: `我们这一侧还没有这个工具：${名}` } };
    },

    cancel() { return false; },
    getStatus() { return null; },
    async runPrimary() {
      记('runtime.runPrimary');
      return { ok: false, error: { code: 'NOT_OURS', message: '这一侧没有主 AI 那条路' } };
    },
    listTools() { return []; },
  };

  /* ══════════════════════════════════════════════════════════════
   * 九、图片与识图
   * ══════════════════════════════════════════════════════════════ */

  /** 旧版那三个存放地的英文键 → 我们模块认的那个。 */
  const 存放地键 = Object.freeze({ main: 'gallery', gallery: 'gallery', session: 'session', vision: 'vision' });
  const 作用域 = (地) => ({ 存放地: 存放地键[地] || 'gallery' });

  /** 条目详情的缓存。`列` 交回来的是**瘦列表**（只有引用 / 标识 / 修改时间），详情要另外问。 */
  const 图详情 = new Map();

  /**
   * 我们的引用 → 递给旧版的那一份。
   *
   * 图片模块的引用是 `{ 作用域, 条目ID }`，旧版认的是 `ref.entryId`（它在
   * `processSelectedVision` 里拿 `current.ref.entryId !== input.imageId` 判"这张图还在不在"）。
   * 所以出口处补一个别名 —— 少这一个，识图那三个钮就会一直说"原图片已不可用"。
   */
  function 翻引用(引用) {
    if (!引用) return null;
    return { ...引用, entryId: 引用.条目ID, container: { type: (引用.作用域 && 引用.作用域.存放地) || 'gallery' } };
  }

  /** 一个引用 → 能在 `<img>` 里用的地址。
   *
   * 图片模块的 `取地址` 交的是**盘上路径**，浏览器用不了；所以这里拼的是本服务那两条
   * GET（`/字节` 原图、`/缩略图` 现缩），与面板走的是同一条路。
   */
  function 图地址(引用, 变体) {
    const 域 = (引用 && 引用.作用域) || {};
    const 存 = 域.存放地 || 'gallery';
    const id = (引用 && 引用.条目ID) || '';
    if (!id) return '';
    const 会话 = 域.会话ID ? `&会话ID=${encodeURIComponent(域.会话ID)}` : '';
    if (变体 === 'original') {
      return `/字节?存放地=${encodeURIComponent(存)}&条目ID=${encodeURIComponent(id)}${会话}&变体=original`;
    }
    const 边长 = 变体 === 'preview' ? 768 : 160;
    return `/缩略图?存放地=${encodeURIComponent(存)}&条目ID=${encodeURIComponent(id)}${会话}&边长=${边长}`;
  }

  /** 模块交回来的字节（Buffer 过 JSON 成了 `{type,data}`）→ Uint8Array。 */
  function 成字节(值) {
    if (!值) return new Uint8Array(0);
    if (值 instanceof Uint8Array) return 值;
    const 源 = Array.isArray(值.data) ? 值.data : (Array.isArray(值) ? 值 : null);
    if (!源) return new Uint8Array(0);
    const 出 = new Uint8Array(源.length);
    for (let i = 0; i < 源.length; i += 1) 出[i] = 源[i];
    return 出;
  }

  /** 把一条详情补进缓存。 */
  function 收详情(详) {
    if (详 && 详.标识) 图详情.set(详.标识, 详);
    return 详;
  }

  /** 瘦列表条目 + 详情 → 旧版要的那一行。 */
  function 翻图条目(瘦) {
    const id = 瘦.标识 || (瘦.引用 && 瘦.引用.条目ID) || '';
    const 详 = 图详情.get(id) || {};
    const 引用 = 瘦.引用 || 详.引用;
    return {
      ...详,
      ref: 翻引用(引用),
      imageId: id,
      filename: 详.文件名 || id,
      displayName: 详.显示名 || 详.文件名 || id,
      mime: 详.mime || '',
      width: 详.宽,
      height: 详.高,
      bytes: 详.字节数,
      createdAt: 详.创建时间,
      updatedAt: 详.更新时间,
    };
  }

  /** 收一张 dataUrl 进某个存放地。走 `/存图`（与面板上传同一条路）。 */
  async function 存一张(存放地, { dataUrl, filename, mime, source }) {
    const 回 = await 请('/存图', {
      作用域: 作用域(存放地),
      字节: dataUrl,
      文件名: filename || '未命名.png',
      mime: mime || undefined,
      来源: source || 'upload',
    });
    if (回 && 回.ok === false) return 翻(回);
    收详情(回);
    return { ok: true, data: { ...翻图条目({ 引用: 回.引用, 标识: 回.标识 }), imageId: 回.标识 } };
  }

  const 图片服务 = {
    /**
     * 图片库那一列。**同步** —— 旧版 `galleryRows()` 不 await。
     *
     * `列` 交回来的是瘦列表，而卡片要显示文件名；所以这里顺手把前 60 条详情补齐
     * （够一屏用），补过的进缓存，重画不再问。
     */
    listGallery(选项) {
      const 选 = 选项 || {};
      const 回 = 同步调('image', '列', { 作用域: 作用域(选.galleryId || 'main') });
      if (回 && 回.ok === false) return { ok: false, error: { code: 回.code, message: 回.reason } };
      const 瘦们 = Array.isArray(回 && 回.条目) ? 回.条目 : [];
      let 补过 = 0;
      for (const 瘦 of 瘦们) {
        const id = 瘦.标识;
        if (!id || 图详情.has(id) || 补过 >= 60) continue;
        补过 += 1;
        收详情(同步调('image', '取详情', { 引用: 瘦.引用 }));
      }
      let 行 = 瘦们.map(翻图条目);
      const 串 = String(选.query || '').trim();
      if (串) {
        行 = 行.filter((一) => String(一.displayName || '').includes(串) || String(一.filename || '').includes(串));
      }
      if (选.order === 'newest') 行 = [...行].reverse();
      return { ok: true, data: { items: 行 } };
    },

    get({ ref } = {}) {
      const 回 = 同步调('image', '取详情', { 引用: ref });
      if (回 && 回.ok === false) return { ok: false, error: { code: 回.code, message: 回.reason } };
      收详情(回);
      return { ok: true, data: 翻图条目({ 引用: 回.引用, 标识: 回.标识 }) };
    },

    /** 给 `<img>` 的地址。**同步**。 */
    preview({ ref, variant } = {}) {
      const url = 图地址(ref, variant);
      return url ? { ok: true, data: { url } } : { ok: false, error: { code: 'NO_REF', message: '没有引用' } };
    },

    async read({ ref, variant } = {}) {
      const 回 = await 调('image', '取内容', { 引用: ref, 变体: variant || 'original' });
      if (回 && 回.ok === false) return 翻(回);
      return {
        ok: true,
        data: { bytes: 成字节(回 && (回.字节 || 回.数据)), mime: (回 && 回.mime) || '', filename: (回 && 回.文件名) || '' },
      };
    },

    async rename({ ref, displayName } = {}) {
      const 回 = await 调('image', '改', { 引用: ref, 显示名: displayName });
      if (回 && 回.ok === false) return 翻(回);
      图详情.delete((ref && ref.条目ID) || '');
      return { ok: true, data: 回 };
    },

    async remove({ ref } = {}) {
      const 回 = await 调('image', '删', { 引用: ref });
      if (回 && 回.ok === false) return 翻(回);
      图详情.delete((ref && ref.条目ID) || '');
      return { ok: true, data: 回 };
    },

    uploadToGallery(输入) { return 存一张('gallery', { ...(输入 || {}), source: 'upload' }); },

    /** 识图工作区是**单张槽位**（图片模块 R-F-12）：写入方先把上一张清掉，再存这一张。 */
    async replaceVisionImage(输入) {
      const 清 = await 调('image', '清空', { 作用域: 作用域('vision') });
      if (清 && 清.ok === false) return 翻(清);
      return 存一张('vision', { ...(输入 || {}), source: (输入 && 输入.source) || 'vision-input' });
    },

    async exportContainer() {
      记('imageApp.exportContainer');
      return { ok: false, error: { code: 'NOT_OURS', message: '我们这一侧还没有"导出整个存放地"' } };
    },
    async importContainer() {
      记('imageApp.importContainer');
      return { ok: false, error: { code: 'NOT_OURS', message: '我们这一侧还没有"导入存放地"' } };
    },
  };

  /**
   * `visionTempStore` —— 识图工作区那一格。
   * 旧版拿它记"现在手上这张图 + 上一次的结果"，我们这边那一格就在图片模块的 `vision` 存放地里。
   */
  const 识图格 = {
    _现在: null,
    current() {
      const 这 = structuredClone(this._现在);
      if (!这) return null;
      return { ...这, ref: 翻引用(这.ref), imageId: (这.ref && 这.ref.条目ID) || '' };
    },
    get(id) {
      const 这 = structuredClone(this._现在);
      return 这 && 这.ref && 这.ref.条目ID === id ? { ...这, ref: 翻引用(这.ref) } : undefined;
    },
    async setReference({ ref } = {}) {
      this._现在 = { ref: ref && ref.条目ID ? ref : { 作用域: ref && ref.作用域, 条目ID: (ref && ref.entryId) || '' } };
      return { ok: true, data: { ref: 翻引用(this._现在.ref) } };
    },
    async clear() {
      this._现在 = null;
      const 回 = await 调('image', '清空', { 作用域: 作用域('vision') });
      return 翻(回);
    },
    setLibraryReference(imageId) {
      this._现在 = { ref: { 作用域: 作用域('vision'), 条目ID: String(imageId || '') } };
      return Boolean(imageId);
    },
    setConversationReference(id) {
      this._现在 = { ref: { 作用域: 作用域('vision'), 条目ID: String(id || '') } };
      return Boolean(id);
    },
    /** 外面递进来的一张：先清空这一格，再把它存进 `vision` 存放地，最后把它设为手上这张。 */
    async replaceExternal({ dataUrl, filename, mime } = {}) {
      const 清 = await this.clear();
      if (清 && 清.ok === false) return null;
      const 存 = await 存一张('vision', { dataUrl, filename, mime, source: 'vision-input' });
      if (!存 || 存.ok === false) return null;
      const 引用 = { ...存.data.ref, entryId: 存.data.ref.条目ID };
      await this.setReference({ ref: 引用 });
      return { ref: 引用, imageId: 引用.条目ID, filename: 存.data.filename, mime: 存.data.mime };
    },
  };

  /** 我们那一侧的标签形状 → 旧版画那一行要的字段。 */
  function 翻识图标签(标签们) {
    return (Array.isArray(标签们) ? 标签们 : []).map((一) => ({
      rawText: 一.词,
      tag: 一.词,
      en: 一.词,
      displayName: 名主值(一.中文名) || 一.词,
      zh: 名主值(一.中文名),
      categoryId: 一.分类 || 'other',
      category: 一.分类 || 'other',
      probability: 一.概率,
      score: 一.概率,
    }));
  }

  function 记识图结果(ref, 字段) {
    const 当前 = 识图格._现在?.ref;
    if (当前?.条目ID === ref.条目ID && 当前.作用域.存放地 === ref.作用域.存放地 && 当前.作用域.会话ID === ref.作用域.会话ID) {
      识图格._现在 = { ...识图格._现在, ...字段 };
    }
  }

  /** 按标签模块的记录补中文名与页分类，输入顺序由调用方保留。 */
  async function 补识图标签(行们) {
    const 行 = Array.isArray(行们) ? 行们 : [];
    if (!行.length) return [];
    const 纯词 = 行.map(一 => String(一.词 || '')).filter(Boolean);
    const 排序回执 = await 调('tag', 'render.sort', { 词们: 纯词 });
    const 排序行 = Array.isArray(排序回执) ? 排序回执 : [];
    const 按词 = new Map(排序行.map(一 => [String(一.词 || ''), 一]));
    const 页表 = 标签服务.getCategories();
    return 行.map(一 => {
      const 命中 = 按词.get(String(一.词 || ''));
      const 在库 = Boolean(命中 && 命中.在库里);
      const 页 = 在库 && 命中.页名 ? 页表.find(二 => 二.name === 命中.页名) : null;
      return {
        ...一,
        displayName: 在库 && 命中.中文名 ? 名主值(命中.中文名) : '',
        categoryId: 页 ? 页.id : (一.categoryId || 'unclassified'),
      };
    });
  }

  /**
   * 识图那三个动作。旧版从 `assistant.visionService.processOne` 走，
   * 模式由 `input.mode` 定：`metadata` 读元数据 · `local` 本地打标 · `ai` 交给模型看图。
   */
  const 识图服务 = {
    async processOne(输入) {
      const 入 = 输入 || {};
      const ref = 入.ref;
      if (!ref) return { ok: false, error: { code: 'NO_REF', message: '原图片已不可用' } };
      const 域 = ref.作用域 || {};
      const 参 = { 存放地: 域.存放地 || 'vision', 条目ID: ref.条目ID };
      if (域.会话ID) 参.会话ID = 域.会话ID;

      if (入.mode === 'metadata') {
        const 回 = await 调('vision', '读元数据', 参);
        if (回 && 回.ok === false) return 翻(回);
        const 单元 = 回.提示词 ? await 调('binding', '切分', { 文本: 回.提示词 }) : [];
        if (单元?.ok === false) return 翻(单元);
        const 内置词 = 单元.filter(一 => 一.词.trim()).map(一 => ({ 词: 一.词, rawText: 一.前 + 一.词 + 一.后 }));
        const builtinTags = await 补识图标签(内置词);
        const metadata = { ...回, text: 回.提示词, builtinTags };
        记识图结果(ref, { metadata });
        return { ok: true, data: metadata };
      }

      if (入.mode === 'ai') {
        const 回 = await 调('vision', '看图', 参);
        if (回 && 回.ok === false) return 翻(回);
        return { ok: true, data: { ...回, text: 回.描述 || 回.文本 || '' } };
      }

      // 本地打标那条
      if (入.阈值 !== undefined) 参.阈值 = 入.阈值;
      if (入.上限 !== undefined) 参.上限 = 入.上限;
      const 回 = await 调('vision', '认图', 参);
      if (回 && 回.ok === false) return 翻(回);
      const 标签 = await 补识图标签(翻识图标签(回 && 回.标签).map(一 => ({ ...一, 词: 一.rawText })));
      const 结果 = { ...回, tags: 标签, modelTags: 标签, analysis: { tags: 标签, metadata: 回 && 回.尺寸 } };
      记识图结果(ref, { analysis: 结果.analysis });
      return { ok: true, data: 结果 };
    },

    cancel() { return false; },

    available() {
      const 回 = 同步调('vision', '看模型', {});
      return Boolean(回 && 回.ok !== false && (回.能本地打标 || 回.能看图));
    },
  };

  const 对话 = global.ConversationManagement.createConversationClient({
    request: 请,
    createStream: url => new global.EventSource(url),
    preferences: 首选项,
  });

  /**
   * `assistant` —— 旧版要的那些名字都在这儿。
   *
   * 说话那几条（`run` / `cancel` / `newSession` / `switchSession` / `deleteSession`）
   * 接在 `对话` 上；不做的那些照旧记账，别让界面以为"没这回事"。
   */
  const 受理中 = new Set();
  let 设置队列 = Promise.resolve();
  let 生成设置缓存 = null;
  async function 等待设置队列() {
    let 等待;
    do {
      等待 = 设置队列;
      await 等待;
    } while (等待 !== 设置队列);
  }
  function 排队保存Comfy(动作, 参数) {
    const 操作 = 设置队列.catch(() => {}).then(async () => {
      const 回 = await 调('comfy', 动作, 参数);
      if (!回 || 回.ok === false) throw new Error((回 && 回.reason) || `ComfyUI ${动作} 保存失败`);
      return 回;
    });
    设置队列 = 操作;
    return 操作.catch(错误 => {
      if (设置队列 === 操作) 设置队列 = Promise.resolve();
      throw 错误;
    });
  }
  const 翻结果 = r => r.ok ? {ok:true,data:r.data} : 翻(r);
  function 组内容(text, ids, sessionId) {
    const draft = 对话.当前会话()?.id === sessionId ? 对话.当前会话().draft : [];
    const imageParts = draft.filter(p => p.type === 'image');
    const imageKey = (p, i) => p.imageId === null ? 'missing:' + i : p.imageId;
    const originalIds = imageParts.map(imageKey);
    const originalText = draft.filter(p => p.type === 'text').map(p => p.text).join('\n');
    if (text === originalText && JSON.stringify(ids) === JSON.stringify([...new Set(originalIds)])) return structuredClone(draft);
    return [...(text ? [{type:'text',text}] : []), ...ids.flatMap(id => {
      const existing = imageParts.filter((p,i) => imageKey(p,i) === id);
      return existing.length ? structuredClone(existing) : [{type:'image',imageId:id}];
    })];
  }
  const 助手 = {
    visionService: 识图服务,
    visionTempStore: 识图格,
    imageRepository: null,
    promptRegistry: null,
    agentProjection: null,
    interactions: null,

    /** 订阅：桥那边一有变化就叫一声（返回退订）。 */
    subscribe(回话) {
      return 对话.subscribe(回话);
    },

    async pendingQuestion(sessionId) {
      const 回 = await 对话.调('待答问题', { 会话: String(sessionId || '') });
      return 翻结果(回);
    },
    async answerQuestion(sessionId, questionId, answer) {
      return 翻结果(await 对话.调('回答问题', { 会话: String(sessionId || ''), 问题ID: String(questionId || ''), 答案: answer }));
    },
    async cancelQuestion(sessionId, questionId) {
      return 翻结果(await 对话.调('取消问题', { 会话: String(sessionId || ''), 问题ID: String(questionId || '') }));
    },

    sessions() { return 对话.会话们(); },
    currentSession() { return 对话.当前会话(); },
    currentId() { return 对话.状态().当前 || ''; },
    snapshot() { return { busy: 对话.状态().在跑 === true, submitting: 受理中.has(对话.状态().当前), error: 对话.状态().错误 }; },
    generationStatus() {
      const 回 = 同步调('drawing', '状态', { 会话: this.currentId() });
      if (!回 || 回.ok === false) return null;
      return 回;
    },
    /** 待发队列：DSH 那边的收件箱这一版没开出来，交空。 */
    queue() { return []; },

    格式说明: () => `会话存储：${对话.存储位置()?.会话 || ''}；图片存储：${对话.存储位置()?.图片 || ''}。${对话.格式说明()}`,
    getDraft() { return 对话.当前会话()?.draft || []; },
    saveDraft({sessionId, text, imageIds}) { return 对话.草稿(sessionId, 组内容(text, imageIds, sessionId)); },
    async run(input = {}) {
      const id = input.sessionId || 对话.状态().当前;
      if (受理中.has(id)) return {ok:false,error:{code:'SESSION_BUSY',message:'SESSION_BUSY: 正在受理发送'}};
      受理中.add(id);
      try {
        await 等待设置队列();
        const result = await 对话.发送(id, Array.isArray(input.parts) ? input.parts : 组内容(String(input.text ?? ''), input.imageIds || [], id));
        return result.ok ? {ok:true,data:{sessionId:result.data.会话ID,turnId:result.data.轮次ID}} : 翻(result);
      } finally { 受理中.delete(id); }
    },
    async editMessage({sessionId, messageId, text}) {
      const id = String(sessionId || '');
      if (受理中.has(id)) return {ok:false,error:{code:'SESSION_BUSY',message:'SESSION_BUSY: 正在受理发送'}};
      return 翻结果(await 对话.editMessage({sessionId:id, messageId:String(messageId || ''), text:String(text ?? '')}));
    },
    async regenerate({sessionId, turnId}) {
      const id = String(sessionId || '');
      if (受理中.has(id) || 对话.会话们().some(session => session.id === id && session.running)) return {ok:false,error:{code:'SESSION_BUSY',message:'SESSION_BUSY: 正在受理发送'}};
      受理中.add(id);
      try { await 等待设置队列(); return 翻结果(await 对话.regenerate({sessionId:id, turnId:String(turnId || '')})); }
      finally { 受理中.delete(id); }
    },
    async cancel() { const id = 对话.状态().当前; return 翻结果(await 对话.调('停', {会话:id})); },
    async newSession() { const r = await 对话.调('新'); return r.ok ? {ok:true,data:{id:r.data.会话.id}} : 翻(r); },
    async switchSession(id) { return 翻结果(await 对话.切换(String(id))); },
    async renameSession(id, title) { return 翻结果(await 对话.调('改名', {会话:String(id),标题:title})); },
    async clearSession(id) { return 翻结果(await 对话.调('清空', {会话:String(id)})); },
    async exportSessions() { const r = await 对话.调('导出', {会话列表:对话.会话们().map(s => s.id)}); return r.ok ? r.data.内容 : 翻(r); },
    async importSessions(value) { return 翻结果(await 对话.调('导入', {内容:value})); },
    async deleteSession(id, {retainImages = false} = {}) { return 翻结果(await 对话.调('删', {会话:String(id),保留图片:retainImages})); },

    getSettings() {
      if (typeof this.comfy开关缓存 !== 'boolean') {
        const 回 = 同步调('comfy', '绘图开关', {});
        this.comfy开关缓存 = Boolean(回 && 回.ok !== false && 回.启用 === true);
      }
      if (!生成设置缓存) {
        const 回 = 同步调('comfy', '生成设置', {});
        if (回 && 回.ok !== false) 生成设置缓存 = 回;
      }
      return {
        links: 要链路表().map(翻链路), api存档: 链路目录, api存档状态: { ...链路存档状态 }, comfyOn: this.comfy开关缓存,
        imagesPerRound: 生成设置缓存?.每轮张数,
        maxAutoRounds: 生成设置缓存?.最多轮数,
        generationAutoRun: 生成设置缓存?.自动迭代,
      };
    },
    /**
     * `getSettings()` 返回 `links`、`comfyOn` 与生成设置；`setSettings()` 按传入字段保存。
     * 链路表同步保存，ComfyUI 设置通过模块动作异步保存。
     */
    setSettings(设置) {
      if (!设置 || typeof 设置 !== 'object') return undefined;
      let 结果 = {};
      if (Array.isArray(设置.links)) {
        const 回 = 存链路表(设置.links.map(翻链路回));
        if (!回 || 回.ok !== true) return undefined;
        结果.links = 要链路表().map(翻链路);
      }
      const 生成参数 = {};
      if (设置.imagesPerRound != null) 生成参数.每轮张数 = 设置.imagesPerRound;
      if (设置.maxAutoRounds != null) 生成参数.最多轮数 = 设置.maxAutoRounds;
      if (typeof 设置.generationAutoRun === 'boolean') 生成参数.自动迭代 = 设置.generationAutoRun;
      const 有生成设置 = Object.keys(生成参数).length > 0;
      if (typeof 设置.comfyOn === 'boolean' || 有生成设置) {
        const 写入版 = this.comfy开关版 = (this.comfy开关版 || 0) + 1;
        return (async () => {
          if (有生成设置) {
            const 回 = await 排队保存Comfy('生成设置', 生成参数);
            生成设置缓存 = 回;
            结果.imagesPerRound = 回.每轮张数;
            结果.maxAutoRounds = 回.最多轮数;
            结果.generationAutoRun = 回.自动迭代;
          }
          if (typeof 设置.comfyOn === 'boolean') {
            const 回 = await 排队保存Comfy('绘图开关', { 启用: 设置.comfyOn });
            结果.comfyOn = 回.启用 === true;
            if (this.comfy开关版 === 写入版) {
              this.comfy开关缓存 = 结果.comfyOn;
              if (this.能力缓存?.comfy) this.能力缓存.comfy = { ...this.能力缓存.comfy, enabled: 结果.comfyOn };
            }
          }
          return 结果;
        })();
      }
      return 结果;
    },
    能力缓存: null,
    getCapabilities() {
      // 能力由模块自己报：`看模型` 说这一侧能不能本地打标、能不能把图交给模型看。
      const 识图 = 同步调('vision', '看模型', {}) || {};
      const 链路 = 要链路表();
      const 填全的 = 链路.filter((一) => 一.地址 && 一.模型);
      const 能看图 = 识图.ok !== false && 识图.能看图 === true;
      return {
        comfy: this.能力缓存?.comfy || { connected: false, enabled: this.getSettings().comfyOn, workflowReady: false },
        vision: {
          local: 识图.ok !== false && 识图.能本地打标 === true,
          ai: 能看图,
          aiError: 能看图
            ? ''
            : (填全的.length
              ? `「看图」这一支没装起来：${(识图.缺 || []).join(' · ') || '模块没报原因'}`
              : '链路列表里还没有填全的链路（地址 + 模型），请到「API 设置」补一条'),
        },
      };
    },
    async refreshCapabilities() {
      const 开关版 = this.comfy开关版 || 0;
      const state = await 取Comfy状态();
      const enabled = this.comfy开关版 !== 开关版 ? this.getSettings().comfyOn : state.enabled;
      const comfy = { ...state, enabled };
      if (this.comfy开关版 === 开关版) this.comfy开关缓存 = enabled;
      this.能力缓存 = { ...this.getCapabilities(), comfy };
      return this.能力缓存;
    },
    /** 每一行现在的图片能力结论（`images` 三态：true / false / null 未知）。 */
    linkInfo() { return 要链路表().map(翻链路能力); },
    /** 现去服务商那边取这家有哪些模型。参数：`{ id, base, key? }`。 */
    async listModels(参数 = {}) {
      const 体 = { id: String(参数.id || ''), 地址: String(参数.base || '') };
      if (typeof 参数.key === 'string') 体.密钥 = 参数.key;
      const 回 = await 问服务商('列模型', 体);
      if (!回 || 回.ok !== true || !回.data || !Array.isArray(回.data.模型)) {
        return { ok: false, error: { code: (回 && 回.code) || 'API_FAILED', message: (回 && 回.reason) || '列不出模型' } };
      }
      链路脏();
      return {
        ok: true,
        rows: 回.data.模型.map((一) => ({
          name: String(一.名字 || ''),
          images: typeof 一.能看图 === 'boolean' ? 一.能看图 : null,
          note: String(一.说明 || ''),
        })),
      };
    },
    /** 真发一张 1×1 的图问服务商：这个模型吃不吃图。参数：`{ id, base, model }`。 */
    async probeImages(参数 = {}) {
      const 回 = await 问服务商('探图', { id: String(参数.id || ''), 地址: String(参数.base || ''), 模型: String(参数.model || '') });
      if (!回 || 回.ok !== true) {
        return { ok: false, error: { code: (回 && 回.code) || 'API_FAILED', message: (回 && 回.reason) || '探测没成功' } };
      }
      链路脏();
      const 能 = 回.data ? 回.data.能看图 : null;
      return { ok: true, images: typeof 能 === 'boolean' ? 能 : null, reason: String((回.data && 回.data.理由) || '') };
    },
    /** 「测试连接」：链路表从上到下各发一次最小请求，第一条通的算数。 */
    async testConnection() {
      const 表 = 要链路表();
      if (!表.length) return { ok: false, error: { code: 'API_NO_LINK', message: '链路表是空的' } };
      const 错 = [];
      for (const 一 of 表) {
        if (!一.地址 || !一.模型) { 错.push(`${一.名字 || 一.id}：地址或模型没填`); continue; }
        const 回 = await 问服务商('试一条', { id: 一.id, 地址: 一.地址, 模型: 一.模型 });
        if (回 && 回.ok === true) {
          return { ok: true, data: { link: { id: 一.id, label: 一.名字, base: 一.地址, model: 一.模型 } } };
        }
        错.push(`${一.模型}：${(回 && 回.reason) || '不通'}`);
      }
      return { ok: false, error: { code: 'API_ALL_FAILED', message: 错.join(' · ') } };
    },
    async listSessionImages({sessionId} = {}) {
      const r = await 调('image','列会话图',{作用域:{存放地:'session',会话ID:sessionId}}); if(r.ok === false) return 翻(r);
      for(const item of r.条目 || []) 收详情(await 调('image','取详情',{引用:item.引用}));
      const session = 对话.当前会话(); const sent = new Set(session?.id === sessionId ? session.messages.flatMap(m => m.parts.filter(p => p.type === 'image').map(p => p.imageId)) : []);
      return {ok:true,data:{items:(r.条目 || []).map(item => ({...翻图条目(item),slotNo:item.图号,sent:sent.has(item.标识)}))}};
    },
    resolveSessionImage({sessionId,imageId} = {}) {
      const ref = {作用域:{存放地:'session',会话ID:sessionId},条目ID:imageId};
      const r = 同步调('image','取详情',{引用:ref}); if(r.ok === false) return 翻(r); 收详情(r);
      return {ok:true,data:{...翻图条目({引用:ref,标识:imageId}),dataUrl:图地址(ref,'original'),thumbnailDataUrl:图地址(ref,'thumbnail'),viewUrl:图地址(ref,'original')}};
    },
    async readSessionImageMetadata({sessionId,imageId} = {}) {
      const result = await 调('vision', '读元数据', { 存放地: 'session', 会话ID: sessionId, 条目ID: imageId });
      return result?.ok === false ? 翻(result) : { ok: true, data: result };
    },
    async uploadSessionImage({sessionId,dataUrl,filename,mime,galleryRef} = {}) {
      let fields = {字节:dataUrl,文件名:filename,mime,来源:'upload'};
      if(galleryRef) {
        const source = galleryRef.作用域 ? galleryRef : {作用域:galleryRef.container?.type === 'session' ? {存放地:'session',会话ID:galleryRef.container.sessionId} : {存放地:galleryRef.container?.type === 'vision' ? 'vision' : 'gallery'},条目ID:galleryRef.imageId || galleryRef.id || galleryRef.entryId}, d = await 调('image','取详情',{引用:source}); if(d.ok === false) return 翻(d);
        const r = await 调('image','取内容',{引用:source,变体:'original'}); if(r.ok === false) return 翻(r);
        fields = {字节:r.字节,文件名:d.文件名,mime:d.mime,显示名:d.显示名,宽:d.宽,高:d.高,元数据:d.元数据,来源:'copy'};
      }
      const r = await 调('image','存',{作用域:{存放地:'session',会话ID:sessionId},...fields}); if(r.ok === false) return 翻(r); 收详情(r);
      return {ok:true,data:翻图条目({引用:r.引用,标识:r.标识})};
    },
    async removeSessionImage({sessionId,imageId} = {}) { 图详情.delete(imageId); return 走异步('image','删',{引用:{作用域:{存放地:'session',会话ID:sessionId},条目ID:imageId}}); },
    async clearConversationImages({sessionId} = {}) { return 走异步('image','清空',{作用域:{存放地:'session',会话ID:sessionId}}); },
    async flushPersistence() { const id = 对话.状态().当前; return 翻结果(await 对话.保存(id)); },
    parseReply(文本) { return { text: String(文本 || '') }; },
  };

  /* ══════════════════════════════════════════════════════════════
   * 十、API 配置：链路表 · 模型列表 · 视觉能力
   *
   * 链路表住本机存档（`%APPDATA%\工具箱\API`，宿主那一侧），页面这一侧只留一份缓存：
   * `getSettings()` / `linkInfo()` 是同步调的，缓存让它们不必每次往返。
   *
   * 密钥只在用户现敲的那一次经过这里；存下来之后界面拿不到它（宿主只回"存没存过"）。
   *
   * "这家有哪些模型""这个模型吃不吃图"两条都问服务商本人，走 `/toolbox/服务商`。
   * ══════════════════════════════════════════════════════════════ */

  /** 宿主问回来的那张链路表（不含密钥）。null = 该重取了。 */
  let 链路们 = null;
  /** 这份存档住在哪（宿主报的绝对路径，界面上如实写出来）。 */
  let 链路目录 = '';
  /** 链路存档读取状态；只含状态码与说明，不含配置内容。 */
  let 链路存档状态 = { ok: true, code: '', reason: '' };

  /** 让缓存作废：写完之后、以及任何一次问过服务商之后。 */
  function 链路脏() { 链路们 = null; }

  /** 现在这张链路表（头一次要会同步取一次）。 */
  function 要链路表() {
    if (链路们) return 链路们;
    const 回 = 同步要('/toolbox/链路', {});
    const 数 = 回 && 回.ok === true && 回.data ? 回.data : {};
    链路目录 = String(数.目录 || 链路目录);
    链路存档状态 = 数.状态 && typeof 数.状态 === 'object' ? 数.状态 : { ok: false, code: 'API_STORE_STATUS', reason: 'API_STORE_STATUS: 没有读取到链路存档状态' };
    链路们 = Array.isArray(数.链路) ? 数.链路 : [];
    return 链路们;
  }

  /** 整表写回（成员 = 还剩哪几行，顺序 = 优先级）。 */
  function 存链路表(来的) {
    const 回 = 同步要('/toolbox/链路', { 存: Array.isArray(来的) ? 来的 : [] });
    const 数 = 回 && 回.ok === true && 回.data ? 回.data : null;
    if (数) {
      链路目录 = String(数.目录 || 链路目录);
      链路存档状态 = 数.状态 && typeof 数.状态 === 'object' ? 数.状态 : 链路存档状态;
      链路们 = Array.isArray(数.链路) ? 数.链路 : 链路们;
    }
    return 回;
  }

  /** 我们那一份 → 旧版要的一行。`images` 三态：true / false / null（还没结论）。 */
  const 翻链路 = (一) => ({
    id: String(一.id || ''),
    label: String(一.名字 || ''),
    base: String(一.地址 || ''),
    model: String(一.模型 || ''),
    contextWindow: Math.max(0, Math.round(Number(一.上下文窗口) || 0)),
    keyConfigured: 一.密钥已存 === true,
    images: typeof 一.能看图 === 'boolean' ? 一.能看图 : null,
    imagesReason: String(一.理由 || ''),
    imagesSource: String(一.依据 || ''),
  });

  /** 旧版那一行 → 我们那一份。`key` 只在现敲时出现；`clearKey` 是显式抹掉。 */
  function 翻链路回(一) {
    const 出 = {
      id: String((一 && 一.id) || ''),
      名字: String((一 && 一.label) || ''),
      地址: String((一 && 一.base) || ''),
      模型: String((一 && 一.model) || ''),
      上下文窗口: Math.max(0, Math.round(Number(一 && 一.contextWindow) || 0)),
    };
    const 敲的 = String((一 && 一.key) || '');
    if (敲的) 出.密钥 = 敲的;
    else if (一 && 一.clearKey === true) 出.清密钥 = true;
    return 出;
  }

  /** 一行 → `linkInfo()` 要的那一条（`imagesReason` 是服务商的原话或它的声明）。 */
  const 翻链路能力 = (一) => ({
    id: String(一.id || ''),
    base: String(一.地址 || ''),
    model: String(一.模型 || ''),
    images: typeof 一.能看图 === 'boolean' ? 一.能看图 : null,
    imagesReason: String(一.理由 || ''),
    imagesSource: String(一.依据 || ''),
  });

  /**
   * 问一次服务商。
   * @param {'列模型'|'探图'|'试一条'} 做什么
   * @param {{id?:string, 地址?:string, 模型?:string, 密钥?:string}} 体
   */
  async function 问服务商(做什么, 体) {
    return 请('/toolbox/服务商', { 做什么, ...(体 || {}) });
  }

  /* ══════════════════════════════════════════════════════════════
   * 十二、收藏栏
   *
   * 我们那一侧：收藏是 tag 模块的一个**位置**，底下是 页 → 类 → 成员（`position.*`）。
   * 旧版那一侧：series → section → entry。
   *   series  = 我们的页
   *   section = 我们的类
   *   entry   = 我们的一个记录摆在某一页某一类上
   *
   * **一个 tag 只当一个 entry**：旧版的 entry id 是"摆位 id"，我们这边只有记录 id。
   * 同一个词摆进两处时，这里只认头一处（`whereIs` 交回的第一条）。
   * ══════════════════════════════════════════════════════════════ */

  const 收藏位置 = '收藏';
  let 收藏树 = null;
  let 收藏脏 = true;
  let 收藏版本 = 1;
  let 收藏标识缓存 = null;

  /** 收藏栏里选中的那几条。和标签那一格一样，住在内存里。 */
  const 收藏选中 = new Map();

  /** 让收藏那一格的缓存作废（写完就调）。 */
  function 收藏改了() {
    收藏脏 = true;
    收藏版本 += 1;
    落点缓存.clear();
    收藏标识缓存 = null;
  }

  /** 收藏那一格的页与类（脏了重取）。 */
  function 要收藏树() {
    if (!收藏脏 && 收藏树) return 收藏树;
    const 回 = 同步调('tag', 'position.list', { 位置: 收藏位置 });
    if (回 && 回.ok === false) return 收藏树 || [];
    收藏树 = Array.isArray(回) ? 回 : [];
    收藏脏 = false;
    return 收藏树;
  }

  function 找收藏页(页ID) {
    return 要收藏树().find((一) => String(一.ID) === String(页ID)) || null;
  }

  function 找收藏类(页, 类ID) {
    if (!页) return null;
    return (页.类列表 || []).find((一) => String(一.ID) === String(类ID)) || null;
  }

  /** 一类的成员标识。 */
  function 收藏一类的成员(页, 类) {
    const 回 = 同步调('tag', 'position.members', { 位置: 收藏位置, 页: 页.ID, 类: 类.ID });
    return Array.isArray(回) ? 回.map(String) : [];
  }

  /**
   * 收哪些成员。三档：给页给类 → 这一类；只给页 → 这一页全部的类；都不给 → 全部页。
   * 每一项带上是哪一页哪一类摆的（entry 要报落点）。
   */
  function 收藏条目们(页ID, 类ID) {
    const 出 = [];
    const 树 = 要收藏树();
    for (const 页 of 树) {
      if (页ID && String(页.ID) !== String(页ID)) continue;
      for (const 类 of 页.类列表 || []) {
        if (类ID && String(类.ID) !== String(类ID)) continue;
        for (const 标识 of 收藏一类的成员(页, 类)) {
          出.push({ 标识, 页, 类 });
        }
      }
    }
    return 出;
  }

  /**
   * 一个标识在收藏里的全部摆位。旧版 `favoriteLocations` 要的是数组，
   * 而且它拿 `membershipId` 去取消收藏 —— 我们这一侧那串就是记录标识。
   *
   * 每次重画都会问，所以按标识记一层；写操作把整层清掉。
   */
  const 落点缓存 = new Map();

  function 是收藏标识(标识) {
    if (!收藏标识缓存) {
      收藏标识缓存 = new Set();
      for (const 页 of 要收藏树()) {
        for (const 类 of 页.类列表 || []) {
          const 成员 = 同步调('tag', 'position.members', { 位置: 收藏位置, 页: 页.ID, 类: 类.ID });
          if (Array.isArray(成员)) for (const id of 成员) 收藏标识缓存.add(String(id));
        }
      }
    }
    return 收藏标识缓存.has(String(标识));
  }

  function 收藏落点们(标识) {
    const 键 = String(标识);
    if (落点缓存.has(键)) return 落点缓存.get(键);
    const 回 = 同步调('tag', 'position.whereIs', { 位置: 收藏位置, 成员: 键 });
    const 出 = Array.isArray(回) ? 回.map((一) => ({
      membershipId: 键,
      pageId: String(一.页),
      groupId: String(一.类),
      pageName: 一.页名,
      groupName: 一.类名,
    })) : [];
    落点缓存.set(键, 出);
    return 出;
  }

  /** 一个标识摆在哪（头一处）。 */
  function 收藏落点(标识) {
    const 们 = 收藏落点们(标识);
    return 们.length ? { 页ID: 们[0].pageId, 类ID: 们[0].groupId } : null;
  }

  /** 我们的记录 + 摆位 → 旧版的一条 entry。 */
  function 翻收藏条目(记, 页, 类) {
    if (!记 || 记.ID === undefined) return null;
    const id = String(记.ID);
    const 名 = 名主值(记.名称);
    const 中 = 名主值(记.中文名);
    return {
      id,
      entryId: id,
      tagId: id,
      rawText: 名,
      title: 中 || 名,
      zh: 中,
      displayName: 中 || 名,
      seriesId: String(页.ID),
      sectionId: String(类.ID),
      seriesName: 页.页名,
      sectionName: 类.类名,
      color: (类.配色 && 类.配色.background) || '',
      nsfw: false,
      pinned: false,
      note: '',
      legacyInvalid: false,
      isTagGroup: Array.isArray(记.成员) && 记.成员.length > 0,
      favoriteLocations: [{ pageId: String(页.ID), groupId: String(类.ID), membershipId: id, pageName: 页.页名, groupName: 类.类名 }],
    };
  }

  const 收藏服务 = {
    /* ── 读：全是同步的，旧版不 await ── */

    series() {
      return 要收藏树().map((页) => ({
        id: String(页.ID),
        name: 页.页名,
        color: (页.配色 && 页.配色.background) || '',
      }));
    },

    sections(系列ID) {
      const 页 = 找收藏页(系列ID);
      if (!页) return [];
      return (页.类列表 || []).map((类) => ({
        id: String(类.ID),
        name: 类.类名,
        seriesId: String(页.ID),
        color: (类.配色 && 类.配色.background) || '',
      }));
    },

    list(选项) {
      const 选 = 选项 || {};
      const 条们 = 收藏条目们(选.seriesId, 选.sectionId);
      const 偏移 = Math.max(0, Number(选.offset) || 0);
      const 上限 = Math.max(1, Number(选.limit) || 500);
      const 片 = 条们.slice(偏移, 偏移 + 上限);
      const 记们 = 要记录(片.map((一) => 一.标识));
      const 按标识 = new Map(记们.map((一) => [String(一.ID), 一]));
      const items = 片
        .map((一) => 翻收藏条目(按标识.get(一.标识), 一.页, 一.类))
        .filter(Boolean);
      return { items, total: 条们.length, hasMore: 偏移 + 上限 < 条们.length };
    },

    search(串, 选项) {
      const 要 = String(串 || '').trim().toLowerCase();
      if (!要) return { items: [], total: 0 };
      const 全 = this.list({ ...(选项 || {}), offset: 0, limit: 100000 });
      const items = 全.items.filter((一) =>
        String(一.rawText || '').toLowerCase().includes(要) || String(一.zh || '').toLowerCase().includes(要));
      return { items, total: items.length };
    },

    getEntry(id) {
      const 标识 = String(id || '');
      const 落 = 收藏落点(标识);
      if (!落) return undefined;
      const 页 = 找收藏页(落.页ID);
      const 类 = 找收藏类(页, 落.类ID);
      if (!页 || !类) return undefined;
      const 记 = 要记录([标识])[0];
      return 翻收藏条目(记, 页, 类);
    },

    selected() {
      return [...收藏选中.values()].map((一) => 一);
    },

    copyText(ids) {
      const 列 = Array.isArray(ids) ? ids : (ids === undefined ? [...收藏选中.keys()] : [ids]);
      const 名们 = [];
      for (const id of 列) {
        const 有 = 收藏选中.get(String(id));
        if (有) 名们.push(有.rawText);
        else {
          const 记 = 记录缓存.get(String(id));
          if (记) 名们.push(记.名称);
        }
      }
      return 名们.join(', ');
    },

    health() { return {}; },
    snapshot() { return { loadError: null, revision: 收藏版本, migrationReport: null }; },
    historyState() { return { canUndo: false, canRedo: false }; },
    revision() { return 收藏版本; },
    subscribe() { return () => {}; },

    /* ── 写：异步 ── */

    async setSelected(id, 开) {
      const 键 = String(id);
      if (开 === false) 收藏选中.delete(键);
      else {
        const 条 = this.getEntry(键);
        if (!条) return { ok: false, error: { code: 'NO_ENTRY', message: '这一条不在收藏里' } };
        收藏选中.set(键, 条);
      }
      return { ok: true, data: this.selected() };
    },

    async clearSelected() { 收藏选中.clear(); return { ok: true, data: [] }; },

    async markCopied() { return { ok: true }; },

    /** 存一页。给了 id 就是改名，没给就是新建。 */
    async saveSeries(补丁) {
      const 入 = 补丁 || {};
      if (入.id) {
        const 回 = await 调('tag', 'position.update', { 位置: 收藏位置, 标识: Number(入.id), 页名: 入.name });
        if (回 && 回.ok === false) return 翻(回);
        收藏改了();
        return { ok: true, data: { id: String(入.id) } };
      }
      const 回 = await 调('tag', 'position.createPage', { 位置: 收藏位置, 页名: 入.name });
      if (回 && 回.ok === false) return 翻(回);
      收藏改了();
      return { ok: true, data: { id: String(回 && 回.ID) } };
    },

    /** 存一个类。`seriesId` 说的是哪一页。 */
    async saveSection(补丁) {
      const 入 = 补丁 || {};
      if (入.id) {
        const 回 = await 调('tag', 'position.update', { 位置: 收藏位置, 标识: Number(入.id), 类名: 入.name });
        if (回 && 回.ok === false) return 翻(回);
        收藏改了();
        return { ok: true, data: { id: String(入.id) } };
      }
      const 回 = await 调('tag', 'position.createClass', { 位置: 收藏位置, 页: Number(入.seriesId), 类名: 入.name });
      if (回 && 回.ok === false) return 翻(回);
      收藏改了();
      return { ok: true, data: { id: String(回 && 回.ID) } };
    },

    async deleteSeries(id) {
      const 回 = await 调('tag', 'position.delete', { 位置: 收藏位置, 标识: Number(id) });
      if (回 && 回.ok === false) return 翻(回);
      收藏改了();
      return { ok: true, data: 回 };
    },

    async deleteSection(id) {
      const 回 = await 调('tag', 'position.delete', { 位置: 收藏位置, 标识: Number(id) });
      if (回 && 回.ok === false) return 翻(回);
      收藏改了();
      return { ok: true, data: 回 };
    },

    /** 把若干条从收藏里摘掉（摘的是摆位，不是记录本身）。 */
    async deleteEntries(ids) {
      const 列 = Array.isArray(ids) ? ids : [ids];
      for (const id of 列) {
        const 落 = 收藏落点(id);
        if (!落) continue;
        const 回 = await 调('tag', 'position.detach', { 位置: 收藏位置, 页: Number(落.页ID), 类: Number(落.类ID), 成员: String(id) });
        if (回 && 回.ok === false) return 翻(回);
        收藏选中.delete(String(id));
      }
      收藏改了();
      return { ok: true, data: { 已删: 列.length } };
    },

    async reorder({ kind, ids } = {}) {
      if (kind !== 'entry') {
        记('favorites.reorder', kind);
        return { ok: false, error: { code: 'NOT_OURS', message: `我们这一侧不支持给「${kind}」排序` } };
      }
      const 列 = Array.isArray(ids) ? ids.map(String) : [];
      if (!列.length) return { ok: true };
      const 落 = 收藏落点(列[0]);
      if (!落) return { ok: false, error: { code: 'NO_ENTRY', message: '这一条不在收藏里' } };
      const 回 = await 调('tag', 'position.reorder', { 位置: 收藏位置, 页: Number(落.页ID), 类: Number(落.类ID), 标识列表: 列 });
      if (回 && 回.ok === false) return 翻(回);
      收藏改了();
      return { ok: true, data: 回 };
    },

    /** 我们这一侧写一条就落一条，没有要冲的缓冲。 */
    async flush() { return true; },

    async undo() { return { ok: false, error: { code: 'NOT_OURS', message: '我们这一侧没有撤销' } }; },
    async redo() { return { ok: false, error: { code: 'NOT_OURS', message: '我们这一侧没有重做' } }; },
  };

  /* ══════════════════════════════════════════════════════════════
   * 十三、角色库
   *
   * **这一块不能走同步通道**：三万多个角色那条回执太大，而旧版那一屏的 `series()` /
   * `page()` 是同步调的。所以后台拉一次、拉完留着，同步方法读那份缓存（没拉到就交空值）。
   *
   * 口径与**我们自己那份角色库面板**一致（界面设计决定 38）：
   *   角色 = `是角色组` 的那些；
   *   作品 = **页「角色组」底下的类名**（一个作品一个类），一个角色属于哪个作品，
   *          由 `render.pageMap` 一趟问出来（落在「未分类」的归"（没写作品）"）。
   *   作品是 tag、不是组 —— 不再从"系列组"反查（tag 模块设计决定 120–121）。
   * ══════════════════════════════════════════════════════════════ */

  const 没写作品 = '（没写作品）';
  const 未分类名 = '未分类';
  const 角色页名 = '角色组';
  const 组账 = { 状态: 'idle', 角色: null, 作品们: null, 按作品: new Map(), 错: '', 听众: new Set() };

  /** 角色 ID → 作品名。由 `render.pageMap` 一趟填满。 */
  const 角色到作品 = new Map();

  /** 一个角色属于哪个作品。 */
  const 作品 = (id) => 角色到作品.get(String(id)) || 没写作品;

  /** 按作品整理成员标识，再分批取角色记录。 */
  function 拉组() {
    if (组账.状态 !== 'idle') return;
    组账.状态 = 'loading';
    (async () => {
      const 取 = (回) => (Array.isArray(回) ? 回 : (Array.isArray(回 && 回.data) ? 回.data : []));
      const 角色页 = 要分类树().find((一) => 一 && 一.页名 === 角色页名);
      if (!角色页) throw new Error(`位置里没有「${角色页名}」这一页`);
      const 名单 = 一页全体(角色页);
      const 按作品 = new Map();
      for (const 类 of 角色页.类列表 || []) {
        const 作 = 类.类名 === 未分类名 ? 没写作品 : 类.类名;
        const 成员 = 一类的成员(角色页, 类);
        if (!成员.length) continue;
        if (!按作品.has(作)) 按作品.set(作, []);
        for (const id of 成员) {
          按作品.get(作).push(id);
          if (作 !== 没写作品) 角色到作品.set(id, 作);
        }
      }
      const 作品们 = [...按作品.entries()]
        .map(([作, 成员]) => ({ id: 作, name: 作, count: 成员.length }))
        .sort((甲, 乙) => (甲.name === 没写作品) - (乙.name === 没写作品) || 乙.count - 甲.count);
      const 缺 = 名单.filter((id) => !记录缓存.has(id));
      for (let i = 0; i < 缺.length; i += 500) {
        const 批 = 缺.slice(i, i + 500);
        const 拿 = 取(await 调('tag', 'record.batch', { 标识列表: 批 }));
        for (const 一 of 拿) 记录缓存.set(String(一.ID), 一);
      }
      组账.角色 = 名单.map((id) => 记录缓存.get(id)).filter(Boolean);
      组账.作品们 = 作品们;
      组账.按作品 = new Map(作品们.map((一) => [一.id, 按作品.get(一.id)]));
      组账.状态 = 'ready';
    })().catch((错) => {
      组账.状态 = 'failed';
      组账.错 = String((错 && 错.message) || 错);
    }).finally(() => {
      for (const 一 of 组账.听众) { try { 一(); } catch (_) { /* 一个听众出错不该拦住别的 */ } }
      组账.听众.clear();
    });
  }

  /** 角色库那一格里选中的那几个。 */
  const 角色选中 = new Map();

  const 角色服务 = {
    /** 旧版拿它当"这一块准备好了没有"。 */
    ready() {
      拉组();
      if (组账.状态 === 'ready' || 组账.状态 === 'failed') return Promise.resolve({ ok: 组账.状态 === 'ready' });
      return new Promise((成) => { 组账.听众.add(() => 成({ ok: 组账.状态 === 'ready' })); });
    },
    status() { return { ready: 组账.状态 === 'ready', loading: 组账.状态 === 'loading', error: 组账.错 }; },
    subscribe(听) { if (typeof 听 === 'function') 组账.听众.add(听); return () => 组账.听众.delete(听); },

    count() { 拉组(); return 组账.角色 ? 组账.角色.length : 0; },
    size() { return this.count(); },

    /** 左栏：作品与它底下有几个角色。没写作品的那些排最后。 */
    series(选项) {
      拉组();
      const 串 = String((选项 && 选项.query) || '').trim().toLowerCase();
      const 出 = (组账.作品们 || []).filter((一) => !串 || 一.name.toLowerCase().includes(串));
      return 出.map((一) => ({ id: 一.id, name: 一.name, count: 一.count }));
    },

    /** 主体：角色卡片。 */
    page(选项) {
      拉组();
      const 选 = 选项 || {};
      const 串 = String(选.query || '').trim().toLowerCase();
      let 组们;
      if (选.seriesId) 组们 = 组账.按作品.get(String(选.seriesId)) || [];
      else { 组们 = []; for (const 一 of 组账.按作品.values()) for (const id of 一) 组们.push(id); }
      let 记们 = 组们.map((id) => 记录缓存.get(String(id))).filter(Boolean);
      if (串) 记们 = 记们.filter((一) => String(一.名称 || '').toLowerCase().includes(串) || String(一.中文名 || '').toLowerCase().includes(串));
      const 偏移 = Math.max(0, Number(选.offset) || 0);
      const 上限 = Math.max(1, Number(选.limit) || 50);
      const 片 = 记们.slice(偏移, 偏移 + 上限);
      return {
        items: 片.map((一) => ({
          id: String(一.ID),
          name: 名主值(一.名称),
          nameZh: 名主值(一.中文名),
          seriesName: 作品(一.ID),
          series: 作品(一.ID),
          count: Array.isArray(一.成员) ? 一.成员.length : 0,
        })),
        total: 记们.length,
        offset: 偏移,
        limit: 上限,
        hasMore: 偏移 + 上限 < 记们.length,
      };
    },

    /** 一个角色的全貌：身份词 + 它身上的特征词。 */
    get(id) {
      const 键 = String(id);
      const 记 = 记录缓存.get(键);
      if (!记) return undefined;
      const 成员们 = Array.isArray(记.成员) ? 记.成员.map(String) : [];
      const 记们 = 成员们.length ? 要记录(成员们) : [];
      const 特征 = 记们.map((一) => ({
        id: String(一.ID),
        en: 名主值(一.名称),
        content: 名主值(一.名称),
        zh: 名主值(一.中文名),
        displayName: 名主值(一.中文名) || 一.名称,
        category: 'other',
      }));
      return {
        id: 键,
        name: 名主值(记.名称),
        nameZh: 名主值(记.中文名),
        aliases: String(记.中文名 || '').split(/[,，]/).map(一 => 一.trim()).filter(Boolean).slice(1),
        identityTagId: 键,
        identityTags: [键],
        generalTags: 特征,
        specificTags: [],
        seriesName: 作品(键),
        series: 作品(键),
        count: 特征.length,
      };
    },

    /** 复制：给了要哪几个特征词就复制那几个，没给就复制角色词本身。 */
    copyText(id, 选项) {
      const 人 = this.get(id);
      if (!人) return '';
      const 选 = 选项 || {};
      const 要的 = [...(Array.isArray(选.generalTagIds) ? 选.generalTagIds : []),
        ...(Array.isArray(选.specificTagIds) ? 选.specificTagIds : [])];
      const 名们 = [名主值(人.name)];
      if (选.includeSeries && 人.seriesName) 名们.push(人.seriesName);
      for (const 一 of 要记录(要的.map(String))) 名们.push(名主值(一.名称));
      return [...new Set(名们.filter(Boolean))].join(', ');
    },

    selected() { return [...角色选中.values()].map((一) => this.get(一) || { id: 一 }); },
    select(id, 开) {
      const 键 = String(id);
      if (开 === false) 角色选中.delete(键); else 角色选中.set(键, true);
      return { ok: true, data: this.selected() };
    },
    removeSelection(id) { 角色选中.delete(String(id)); return { ok: true, data: this.selected() }; },
    clearSelection() { 角色选中.clear(); return { ok: true, data: [] }; },

    async edit() {
      记('characters.edit');
      return { ok: false, error: { code: 'NOT_OURS', message: '我们这一侧还没有"改角色关联"这条路' } };
    },
    async restore() { return { ok: true }; },
    async flush() { return true; },
    dispose() { 组账.听众.clear(); },
    historyState() { return { canUndo: false, canRedo: false }; },
    manifest() { return { count: this.count() }; },
  };

  /* 用户侧 ComfyUI 配置与当前工作流。 */
  function comfy结果(reply) {
    if (reply?.ok === false) throw new Error(reply.reason || 'ComfyUI 操作失败');
    return reply;
  }
  const comfy服务 = {
    getBase() { return comfy结果(同步要('/toolbox/设置', {})).data.comfyUI地址; },
    async setBase(value) { return comfy结果(await 请('/toolbox/设置', {存:{comfyUI地址:value}})).data.comfyUI地址; },
    getWorkflow() {
      const reply = 同步调('comfy','取工作流',{});
      if (reply?.code === 'COMFY_NO_WORKFLOW') return null;
      return comfy结果(reply)?.界面图 || null;
    },
    async setWorkflow(value) { return comfy结果(await 调('comfy','存工作流',{图:typeof value==='string'?JSON.parse(value):value})); },
    async clearWorkflow() { return comfy结果(await 调('comfy','清工作流',{})); },
    async parameters(patch={}) {
      const reply=await 调('comfy','参数',patch);
      if(!Object.keys(patch).length && reply?.code==='COMFY_NO_WORKFLOW')return {节点:[]};
      return comfy结果(reply);
    },
    async check() { const reply=await 调('comfy','探活',{}); return Boolean(reply&&reply.ok!==false&&(reply.设备||reply.版本)); },
    async status() {
      const state=await 取Comfy状态(); if(!state.connected)return state;
      const reply=await 调('comfy','看队列',{});
      return {...state,queue:{running:reply?.运行中||0,pending:reply?.排队中||0}};
    },
    async importWorkflow(value) {
      const graph=value&&typeof value==='object'&&!Array.isArray(value)?(value.workflowJson||value.promptJson||value):value;
      await this.setWorkflow(graph); return {ok:true};
    },
    async parsePngMetadata(dataUrl) {
      const raw=global.atob(dataUrl.slice(dataUrl.indexOf(',')+1));
      const reply=comfy结果(await 调('vision','读元数据',{字节:Array.from(raw,c=>c.charCodeAt(0))}));
      return {...reply,promptJson:reply?.全部?.prompt||'',workflowJson:reply?.全部?.workflow||reply?.工作流||''};
    },
  };

  /* ══════════════════════════════════════════════════════════════
   * 十五、袋子
   * ══════════════════════════════════════════════════════════════ */

  /**
   * 语言包。旧版整份界面上的字都从 `modules.locales[locale]` 取（`data-i18n` 那些），
   * 缺了就是一片空白按钮 —— 所以页面一起来就同步取一次。
   * 两份 JSON 住在 `页/locales/`，与旧版那两份逐字相同。
   */
  const 语言包 = (() => {
    const 出 = {};
    for (const 号 of ['zh-CN', 'en-US']) {
      try {
        const 器 = new XMLHttpRequest();
        器.open('GET', `locales/${号}.json`, false);
        器.send();
        出[号] = JSON.parse(器.responseText);
      } catch (_) { 出[号] = {}; }
    }
    return 出;
  })();

  let 桌 = null;
  const 桌好了 = (async () => { 桌 = await 要桌(); return 桌; })();

  const 袋子 = {
    catalog: 目录服务,
    tags: 标签服务,
    characters: 角色服务,
    favorites: 收藏服务,
    imageApp: 图片服务,
    translation: 翻译服务,
    comfy: comfy服务,
    preferences: 首选项,
    assistant: 助手,
    runtime: 运行时,
    primaryTools: null,
    visionTempStore: 识图格,
    version: global.__版本__,
    locales: 语言包,
    updates: null,
    openTagReference: (一) => {
      const 词 = 出词(一);
      if (!词 || /[,，\r\n]/.test(词)) {
        return Promise.resolve({ ok: false, error: '请选择单个有效的英文 Tag 查看参考图' });
      }
      try {
        global.open(`https://danbooru.donmai.us/posts?tags=${encodeURIComponent(词)}`, '_blank', 'noopener');
      } catch (_) { return Promise.resolve({ ok: false, error: '打不开参考图窗口' }); }
      return Promise.resolve({ ok: true });
    },
    parsePngMetadata: comfy服务.parsePngMetadata,
    joinFavoriteBlocks: null,
    /** 一条 tag → 拼进提示词的那一段（旧版 `combinedSelectionText` 用它）。 */
    formatTagOutput: 出词,
    async prepareClose() { return true; },
    账本,
    桌: () => 桌,
    调,
    同步调,
    走,
    走异步,
    状态,
    记录缓存,
  };

  global.AppModules = Object.freeze(袋子);
  global.__我们的账本__ = 账本;
})(typeof globalThis !== 'undefined' ? globalThis : window);
