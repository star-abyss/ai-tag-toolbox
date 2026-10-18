'use strict';
/*
 * comfyUI 模块 · 核心。纯逻辑：不 require fs / path，不直接发请求。
 *
 * 本模块做一件事：把一张 ComfyUI 工作流读进来，让它变成能填的参数，填完去跑，把图取回来。
 *
 * 一次出图：
 *   ① 认口    图 → 正 / 负 / 图 各接在哪
 *   ② 填口    正负 / 图片 / 可选张数 → 新的接口图
 *   ③ 提交    接口图（带界面图）→ 任务号
 *   ④ 盯       轮询到完成
 *   ⑤ 报产出  文件清单
 *
 * 返回：成功 { ok:true, data }；失败 { ok:false, reason, code }。
 */

const G = require('./graph.js');

const ERR = {
  NO_PORT: 'COMFY_PORT_REQUIRED',
  NO_STORE: 'COMFY_STORE_REQUIRED',
  NO_WORKFLOW: 'COMFY_NO_WORKFLOW',
  BUSY: 'COMFY_BUSY',
  BAD_ARGUMENT: 'INVALID_ARGUMENT',
  UNREACHABLE: 'COMFY_UNREACHABLE',
  FAILED: 'COMFY_FAILED',
  CANCELLED: 'COMFY_CANCELLED',
  TIMEOUT: 'COMFY_TIMEOUT',
  DISABLED: 'COMFY_DISABLED',
};

const ok = G.ok;
const fail = G.fail;
const 是对象 = G.是对象;
const 是数组 = G.是数组;

/** 端口给的 { ok, data } 解成裸值；失败原样传上去。 */
function 解(结果) {
  if (!是对象(结果)) return fail(ERR.UNREACHABLE, '端口没有给出结果');
  if (结果.ok === true) return ok(结果.data);
  return 结果;
}

/** 一次出图最多盯多久。 */
const 默认上限毫秒 = 30 * 60 * 1000;

/** 两次看任务之间等多久。 */
const 默认间隔毫秒 = 1200;

/**
 * @param {{port:object, 存档?:object, clientId?:string, 等待?:Function, 现在?:Function, 上限毫秒?:number, 新UUID?:Function}} 依赖
 */
function createCore(依赖 = {}) {
  const port = 依赖.port;
  if (!是对象(port)) throw new Error(`${ERR.NO_PORT}: 要一个端口`);
  const 存档 = 依赖.存档 || null;
  const 等待 = typeof 依赖.等待 === 'function' ? 依赖.等待 : (毫秒) => new Promise((好) => setTimeout(好, 毫秒));
  const 现在 = typeof 依赖.现在 === 'function' ? 依赖.现在 : (() => Date.now());
  const 上限毫秒 = Number(依赖.上限毫秒) > 0 ? Number(依赖.上限毫秒) : 默认上限毫秒;
  const 新UUID = typeof 依赖.新UUID === 'function' ? 依赖.新UUID : null;
  /** 提交时带的 client_id：ComfyUI 前端按它认出这个任务是哪个页面发的。 */
  const 客户端标识 = typeof 依赖.clientId === 'string' ? 依赖.clientId : '';

  /** 正在跑的那一次；同时只有一个。 */
  let 在飞 = null;
  /** 节点定义缓存。 */
  let 定义缓存 = null;

  // ---------------------------------------------------------------- 连接

  async function 探活(信号) {
    return 解(await port.探活(信号));
  }

  async function 看队列(信号) {
    return 解(await port.看队列(信号));
  }

  async function 看节点定义(信号) {
    const r = 解(await port.看节点定义(信号));
    if (!r.ok) return r;
    // 适配器可能给 { nodes }，也可能直接给节点表
    const 表 = 是对象(r.data) && 是对象(r.data.nodes) ? r.data.nodes : r.data;
    定义缓存 = 是对象(表) ? 表 : null;
    return ok(G.深拷贝(定义缓存));
  }

  /** 要用定义时先确保有。 */
  async function 要定义() {
    if (定义缓存) return ok(定义缓存);
    const r = await 看节点定义();
    if (!r.ok) return r;
    return ok(定义缓存 || {});
  }

  // ---------------------------------------------------------------- 存档

  function 要存档() {
    if (!存档) return fail(ERR.NO_STORE, '这个模块没有存档能力');
    return ok(存档);
  }

  const 工作流回执 = (值) => ({
    ...(值 && '启用' in 值 ? { 启用: 值.启用 === true } : {}),
    format: 值.format,
    存于: 值.存于,
    界面图: G.深拷贝(值.界面图),
    口: G.深拷贝(值.口),
  });

  /** 存档 = { 读(), 写(记录), 清() }。 */
  function 取工作流() {
    const 有 = 要存档();
    if (!有.ok) return 有;
    const 值 = 存档.读();
    if (!值 || !值.界面图) return fail(ERR.NO_WORKFLOW, '还没有工作流');
    return ok(工作流回执(值));
  }

  /** 读写存档记录中的绘图开关。 */
  function 绘图开关(启用) {
    const 有 = 要存档();
    if (!有.ok) return 有;
    const 当前 = 存档.读() || {};
    if (启用 === undefined) return ok({ 启用: 当前.启用 === true });
    if (typeof 启用 !== 'boolean') return fail(ERR.BAD_ARGUMENT, '启用要是布尔值');
    const 值 = { ...当前, 启用 };
    const 写 = 存档.写(值);
    if (写 !== true && !(是对象(写) && 写.ok)) return fail(ERR.BAD_ARGUMENT, '存档没写进去');
    return ok({ 启用 });
  }

  const 默认生成设置 = Object.freeze({ 每轮张数: 1, 最多轮数: 3, 自动迭代: true });

  function 生成设置(输入) {
    const 有 = 要存档();
    if (!有.ok) return 有;
    const 当前 = 存档.读() || {};
    const 保存 = 是对象(当前.生成设置) ? 当前.生成设置 : {};
    const 值 = {
      每轮张数: Number.isInteger(保存.每轮张数) && 保存.每轮张数 > 0 ? 保存.每轮张数 : 默认生成设置.每轮张数,
      最多轮数: Number.isInteger(保存.最多轮数) && 保存.最多轮数 > 0 ? 保存.最多轮数 : 默认生成设置.最多轮数,
      自动迭代: typeof 保存.自动迭代 === 'boolean' ? 保存.自动迭代 : 默认生成设置.自动迭代,
    };
    if (输入 === undefined) return ok({ ...值 });
    if (!是对象(输入)) return fail(ERR.BAD_ARGUMENT, '生成设置要是对象');
    for (const 键 of ['每轮张数', '最多轮数']) {
      if (键 in 输入 && (!Number.isInteger(输入[键]) || 输入[键] < 1)) {
        return fail(ERR.BAD_ARGUMENT, `${键}要是正整数`);
      }
    }
    if ('自动迭代' in 输入 && typeof 输入.自动迭代 !== 'boolean') {
      return fail(ERR.BAD_ARGUMENT, '自动迭代要是布尔值');
    }
    const 新值 = {
      每轮张数: '每轮张数' in 输入 ? 输入.每轮张数 : 值.每轮张数,
      最多轮数: '最多轮数' in 输入 ? 输入.最多轮数 : 值.最多轮数,
      自动迭代: '自动迭代' in 输入 ? 输入.自动迭代 : 值.自动迭代,
    };
    const 写 = 存档.写({ ...当前, 生成设置: 新值 });
    if (写 !== true && !(是对象(写) && 写.ok)) return fail(ERR.BAD_ARGUMENT, '存档没写进去');
    return ok({ ...新值 });
  }

  async function 参数(输入) {
    const 有 = 要存档();
    if (!有.ok) return 有;
    const 起始 = 存档.读();
    if (!起始 || !起始.界面图) return fail(ERR.NO_WORKFLOW, '还没有工作流');
    if (输入 === undefined || !('节点' in 输入 && '参数' in 输入 && '值' in 输入)) {
      const 定义 = await 看节点定义();
      if (!定义.ok) return 定义;
      const 当前 = 存档.读();
      if (!当前 || !当前.界面图) return fail(ERR.NO_WORKFLOW, '还没有工作流');
      const 所有 = G.列工作流参数(当前.界面图, 定义.data);
      if (!所有.ok) return 所有;
      if (输入 && 输入.节点 !== undefined) return ok({ 节点: 所有.data.节点.filter(x => x.编号 === String(输入.节点)) });
      return 所有;
    }
    const 定义 = await 看节点定义();
    if (!定义.ok) return 定义;
    const 当前 = 存档.读();
    if (!当前 || !当前.界面图) return fail(ERR.NO_WORKFLOW, '还没有工作流');
    const 更新 = G.写工作流参数(当前.界面图, 输入.节点, 输入.参数, 输入.值, 定义.data);
    if (!更新.ok) return 更新;
    const 口 = G.读口(更新.data, { 节点定义: 定义.data });
    if (!口.ok) return 口;
    const 保存 = { ...当前, format: G.图版本, 存于: 现在(), 界面图: 更新.data, 口: 口.data };
    const 写 = 存档.写(保存);
    if (写 !== true && !(是对象(写) && 写.ok)) return fail(ERR.BAD_ARGUMENT, '存档没写进去');
    return ok({ 节点: G.列工作流参数(更新.data, 定义.data).data.节点 });
  }

  function 存工作流(界面图) {
    const 有 = 要存档();
    if (!有.ok) return 有;
    const 图 = 是对象(界面图) && 是数组(界面图.nodes) ? G.补图id(界面图, 新UUID) : 界面图;
    const 口 = G.读口(图, { 节点定义: 定义缓存 || {} });
    if (!口.ok) return 口;
    const 当前 = 存档.读() || {};
    const 工作流记录 = {
      启用: 当前.启用 === true,
      format: G.图版本,
      存于: 现在(),
      界面图: G.深拷贝(图),
      口: 口.data,
    };
    const 值 = {
      ...工作流记录,
      ...(当前.生成设置 ? { 生成设置: G.深拷贝(当前.生成设置) } : {}),
    };
    const 写 = 存档.写(值);
    if (写 !== true && !(是对象(写) && 写.ok)) return fail(ERR.BAD_ARGUMENT, '存档没写进去');
    return ok(工作流回执(工作流记录));
  }

  function 清工作流() {
    const 有 = 要存档();
    if (!有.ok) return 有;
    const 当前 = 存档.读() || {};
    const 写 = 存档.写({
      启用: 当前.启用 === true,
      ...(当前.生成设置 ? { 生成设置: G.深拷贝(当前.生成设置) } : {}),
    });
    if (写 !== true && !(是对象(写) && 写.ok)) return fail(ERR.BAD_ARGUMENT, '存档没写进去');
    return ok(null);
  }

  // ---------------------------------------------------------------- 认口

  /** 认出正 / 负 / 图各接在哪。 */
  function 认(工作流) {
    const 源 = 工作流 === undefined ? 取工作流() : ok(工作流);
    if (!源.ok) return 源;
    const 值 = 源.data;
    const 图 = 是对象(值) && 值.界面图 ? 值.界面图 : 值;
    const 口 = G.读口(图, { 节点定义: 定义缓存 || {} });
    if (!口.ok) return 口;
    return ok({
      认得的: 口.data.认得的,
      认不出的: 口.data.认不出的,
      正向: 口.data.正向,
      负向: 口.data.负向,
      图片: 口.data.图片,
      张数: 口.data.张数,
      输出: 口.data.输出,
      节点数: 口.data.节点数,
      采样器: 口.data.主采样器,
      采样器不唯一: 口.data.采样器不唯一,
      可填: [
        { 名: '正向提示词', 要: true, 现在: 口.data.正向.map((x) => x.文本).join(' ') },
        { 名: '负向提示词', 要: false, 现在: 口.data.负向.map((x) => x.文本).join(' ') },
        { 名: '图片', 要: false, 现在: 口.data.图片.map((x) => x.当前值).join(' ') },
      ],
    });
  }

  // ---------------------------------------------------------------- 出图

  /**
   * 出一次图。
   * @param {{正向?:string, 负向?:string, 图片?:object, 信号?:AbortSignal, onEvent?:Function, 间隔毫秒?:number}} 输入
   */
  function 出图(输入 = {}) {
    if (在飞) return Promise.resolve(fail(ERR.BUSY, '上一次出图还没结束'));
    const 起 = () => 走出图(输入);
    let 做完;
    try {
      做完 = 起();
    } catch (错误) {
      return Promise.resolve(fail(ERR.FAILED, (错误 && 错误.message) || '出图出错'));
    }
    在飞 = 做完;
    return 做完.finally(() => { 在飞 = null; });
  }

  async function 走出图(输入) {
    const 开关 = 绘图开关();
    if (!开关.ok) return 开关;
    if (!开关.data.启用) return fail(ERR.DISABLED, '绘图已关闭，请先勾选“启用绘图”');
    const 信号 = 输入.信号;
    const 报 = (事件) => { try { 输入.onEvent && 输入.onEvent(事件); } catch { /* 观察者出错不影响出图 */ } };
    const 取消 = (任务号) => (信号 && 信号.aborted
      ? fail(ERR.CANCELLED, '这次出图已取消', 任务号 === undefined ? undefined : { 任务号 })
      : null);

    const 工作流 = 取工作流();
    if (!工作流.ok) return 工作流;
    const 界面图 = 工作流.data.界面图;

    const 定义 = await 要定义();
    if (!定义.ok) return 定义;

    const 口 = G.读口(界面图, { 节点定义: 定义.data });
    if (!口.ok) return 口;
    if (!口.data.正向.length) {
      return fail(G.ERR.NO_PROMPT, '这张图上认不出正向提示词的口，请在 ComfyUI 里确认后重新导入');
    }

    // 图片先送进 ComfyUI 的输入区，再把回来的文件名写进图
    let 图片名 = '';
    if (输入.图片 !== undefined && 输入.图片 !== null) {
      if (!口.data.图片.length) return fail(ERR.BAD_ARGUMENT, '这张图不收图片');
      const 字节 = 输入.图片.字节 || 输入.图片;
      const 送 = 解(await port.送图片(字节, 输入.图片.文件名, 输入.图片.mime, 信号));
      if (!送.ok) return 取消() || 送;
      if (!是对象(送.data) || typeof 送.data.文件名 !== 'string') {
        return fail(ERR.UNREACHABLE, '端口送图片没给文件名');
      }
      图片名 = 送.data.子目录 ? `${送.data.子目录}/${送.data.文件名}` : 送.data.文件名;
      报({ 类型: '已送图片', 文件名: 图片名 });
    }

    const 填 = G.填口(界面图, {
      口: 口,
      节点定义: 定义.data,
      ...(输入.正向 !== undefined ? { 正向: 输入.正向 } : {}),
      ...(输入.负向 !== undefined ? { 负向: 输入.负向 } : {}),
      ...(图片名 ? { 图片: 图片名 } : {}),
      ...(输入.张数 !== undefined ? { 张数: 输入.张数 } : {}),
    });
    if (!填.ok) return 填;

    const 提交开关 = 绘图开关();
    if (!提交开关.ok) return 提交开关;
    if (!提交开关.data.启用) return fail(ERR.DISABLED, '绘图已关闭，请先勾选“启用绘图”');
    const 提交前取消 = 取消();
    if (提交前取消) return 提交前取消;
    报({ 类型: '提交中', 填了的: 填.data.填了的 });
    const 事件后取消 = 取消();
    if (事件后取消) return 事件后取消;

    const 交 = 解(await port.提交(填.data.接口图, {
      clientId: 输入.clientId || 客户端标识,
      界面图,
    }, 信号));
    if (!交.ok) return 取消() || 交;
    if (!是对象(交.data) || !交.data.任务号) return fail(ERR.UNREACHABLE, '端口提交没给任务号');
    const 任务号 = 交.data.任务号;
    报({ 类型: '已提交', 任务号, 填了的: 填.data.填了的 });

    // 盯到完成
    const 开始 = 现在();
    let 上次状态 = '';
    for (;;) {
      const 已取消 = 取消(任务号);
      if (已取消) {
        报({ 类型: '已取消', 任务号 });
        return 已取消;
      }
      const t = 解(await port.看任务(任务号, 信号));
      if (!t.ok) return 取消(任务号) || t;
      const 状态 = t.data.状态;
      if (状态 !== 上次状态) {
        上次状态 = 状态;
        报({ 类型: '状态', 任务号, 状态 });
      }
      const 错误 = 是数组(t.data.错误) ? t.data.错误 : [];
      if (/error/i.test(状态)) {
        return fail(ERR.FAILED, 错误.join('；') || 'ComfyUI 报告执行失败', { 任务号, 错误 });
      }
      if (t.data.完成) {
        const 出 = { 任务号, 状态, 产出: t.data.产出, 填了的: 填.data.填了的 };
        报({ 类型: '完成', ...出 });
        return ok(出);
      }
      if (现在() - 开始 > 上限毫秒) {
        return fail(ERR.TIMEOUT, `等了 ${Math.round(上限毫秒 / 1000)} 秒还没跑完`, { 任务号 });
      }
      await 等待(输入.间隔毫秒 || 默认间隔毫秒, 信号);
    }
  }

  /** 取产出文件的字节。 */
  async function 取图(文件, 信号) {
    if (!是对象(文件)) return fail(ERR.BAD_ARGUMENT, '要一个产出文件');
    const r = 解(await port.取结果文件(文件.文件名, { 子目录: 文件.子目录, 类型: 文件.类型 }, 信号));
    if (!r.ok) return r;
    if (!是对象(r.data) || !r.data.字节) return fail(ERR.UNREACHABLE, '端口没给文件字节');
    return ok({ ...文件, 字节: r.data.字节, mime: r.data.mime });
  }

  /** 现在在跑吗。 */
  const 在跑吗 = () => Boolean(在飞);

  return {
    ERR,
    探活, 看队列, 看节点定义,
    取工作流, 存工作流, 清工作流, 绘图开关,
    生成设置, 参数,
    认,
    出图, 取图, 在跑吗,
  };
}

module.exports = { createCore, ERR };
