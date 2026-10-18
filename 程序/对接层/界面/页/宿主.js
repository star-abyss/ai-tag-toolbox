// 宿主接口 · 浏览器这一侧。
//
// 面板不直接 fetch。它只认识这个对象上的几个方法，所以将来把界面搬进别的壳里
// （比如挂在 DSH 的 Web 界面上、改成进程内直调），换的只是这一个文件。
//
// 三条规矩：
//   ① `调` 交回来的就是宿主给的东西，一个字不改（失败信封也原样）
//   ② 用时记在这里，精确到毫秒
//   ③ 字节与缩略图给的是**地址**，不是字节——让浏览器自己缓存、流式解码

const 令牌 = window.__令牌__;

/**
 * 面板真调过哪些动作 —— 一份模块级的总账。
 *
 * 记在模块上而不是每个宿主实例上：外壳起手会造一次宿主去探桌，拿到桌之后再造一次，
 * 记账跟着实例走就会被换掉，只留下最后一次的。
 */
const 总账 = [];

/** 把总账清空（自检每画一块面板之前叫一次）。 */
export function 清总账() {
  总账.length = 0;
}

/** 总账里现在有哪些（去重）。 */
export function 调过的() {
  return [...new Set(总账)];
}

/**
 * 发一次 POST。失败一律变成 `{ ok:false, code, reason }` 信封，不抛。
 * @param {string} 路
 * @param {object} 体
 */
async function 请(路, 体) {
  const 起 = performance.now();
  try {
    const 答 = await fetch(路, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 令牌 },
      body: JSON.stringify(体 || {}),
    });
    let 回;
    try { 回 = await 答.json(); } catch (_) {
      return { 回: { ok: false, code: 'PAGE_NOT_JSON', reason: `宿主回了 ${答.status}，不是 JSON` }, 耗时: performance.now() - 起 };
    }
    if (答.status === 403) return { 回: { ok: false, code: 'UI_TOKEN', reason: '令牌不对，刷新一下页面' }, 耗时: performance.now() - 起 };
    return { 回, 耗时: performance.now() - 起 };
  } catch (错) {
    return { 回: { ok: false, code: 'PAGE_FETCH', reason: `请求没发出去：${String((错 && 错.message) || 错)}` }, 耗时: performance.now() - 起 };
  }
}

/** 把参数拼进查询串。 */
function 带查询(路, 查) {
  const 串 = new URLSearchParams();
  for (const [名, 值] of Object.entries(查 || {})) {
    if (值 === undefined || 值 === null || 值 === '') continue;
    串.set(名, String(值));
  }
  const 尾巴 = 串.toString();
  return 尾巴 ? `${路}?${尾巴}` : 路;
}

/**
 * 造宿主接口。
 * @param {object} 桌 宿主交来的那一份（模块 · 动作 · 参数 · 装不上 · 模型）
 */
export function 造宿主(桌) {
  /** `模块/动作` → 那一条，省得每次在几百条里找。 */
  const 索引 = new Map();
  for (const 一 of 桌.动作表 || []) {
    索引.set(`${一.模块}/${一.动作}`, 一);
    // 模型侧那套名字（`tag_query` 拆出来的 `query`）也认：面板不该因为写哪一套而白跑一趟。
    if (一.模型侧) 索引.set(`${一.模块}/${一.模型侧}`, 一);
  }

  /** 这一次开页面以来，面板真调过的动作（自检拿它核对）。 */
  const 调过的 = [];

  /** 调一个动作。 */
  async function 调(模块, 动作, 参数) {
    调过的.push(`${模块}/${动作}`);
    总账.push(`${模块}/${动作}`);
    // 交付面上没有这一条就当场说清楚：面板写错了名字不该等到用户点下去才知道。
    if (!索引.has(`${模块}/${动作}`)) {
      const 像的 = [...索引.keys()].filter((k) => k.startsWith(`${模块}/`)).join(' · ') || '（这个模块一个动作都没有）';
      return {
        回: { ok: false, code: 'PAGE_NO_SUCH_ACTION', reason: `交付面上没有「${模块}/${动作}」。这个模块交出来的是：${像的}` },
        耗时: 0,
      };
    }
    const { 回, 耗时 } = await 请('/toolbox/调', { 模块, 动作, 参数: 参数 || {} });
    return { 回, 耗时 };
  }

  /** 一条动作的交付面。找不到就给 null——面板自己决定怎么报缺。 */
  const 一条 = (模块, 动作) => 索引.get(`${模块}/${动作}`) || null;

  return Object.freeze({
    桌,
    项目根: 桌.项目根 || '',
    装不上: 桌.装不上 || [],
    有模块: (键) => (桌.动作表 || []).some((一) => 一.模块 === 键),
    模块们: () => [...new Set((桌.动作表 || []).map((一) => 一.模块))],

    一条,
    /** 这个动作的摘要（按钮文案用它，界面不自己编）。 */
    摘要: (模块, 动作) => {
      const 一 = 索引.get(`${模块}/${动作}`);
      return 一 ? 一.摘要 : '';
    },
    /** 这个动作的某个参数（名字 / 可选 / 说明 / 控件）。 */
    参数: (模块, 动作, 名) => {
      const 一 = 索引.get(`${模块}/${动作}`);
      if (!一) return null;
      return (一.参数 || []).find((p) => p.名 === 名) || null;
    },
    /** 这个动作收哪几个参数。 */
    参数们: (模块, 动作) => {
      const 一 = 索引.get(`${模块}/${动作}`);
      return 一 ? (一.参数 || []) : [];
    },

    调,
    /** 这个实例真调过哪些动作。 */
    调过的: () => [...new Set(调过的)],

    /** 原图地址。 */
    图地址: (引用, 变体) => 带查询('/字节', {
      存放地: 引用 && 引用.作用域 && 引用.作用域.存放地,
      会话ID: 引用 && 引用.作用域 && 引用.作用域.会话ID,
      条目ID: 引用 && 引用.条目ID,
      变体,
    }),
    /** 缩略图地址（宿主现缩，缩不出来就给原图）。 */
    缩略图地址: (引用, 边长) => 带查询('/缩略图', {
      存放地: 引用 && 引用.作用域 && 引用.作用域.存放地,
      会话ID: 引用 && 引用.作用域 && 引用.作用域.会话ID,
      条目ID: 引用 && 引用.条目ID,
      边长: 边长 || 320,
    }),

    /** 存一张图（上传 / 出图取回 / 从别处复制）。字节给 dataUrl 或数字数组。 */
    async 存图(要的) {
      const { 回, 耗时 } = await 请('/存图', 要的);
      return { 回, 耗时 };
    },

    /** 换本地模型那一格。 */
    async 换模型(类别, id) {
      const { 回, 耗时 } = await 请('/toolbox/模型', { 换: { 类别, id } });
      return { 回, 耗时 };
    },

    /** 起一个长任务（现在只有出图）。交回任务 id。 */
    async 起任务(什么, 参数) {
      const { 回, 耗时 } = await 请('/toolbox/任务', { 什么, 参数 });
      return { 回, 耗时 };
    },
    /** 看一个任务。`从` = 我手上已经有几条事件了。 */
    async 看任务(id, 从) {
      const { 回, 耗时 } = await 请('/toolbox/任务/看', { id, 从 });
      return { 回, 耗时 };
    },
    /** 任务的流地址（SSE）。 */
    任务流地址: (id, 从) => 带查询('/toolbox/任务/流', { id, 从: 从 || 0 }),

    /** 重新要一次动作表。 */
    async 重取桌() {
      const { 回 } = await 请('/toolbox/桌', {});
      return 回;
    },
  });
}
