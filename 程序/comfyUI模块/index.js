'use strict';
/*
 * comfyUI 模块 · 门面。对外只有这一个文件。
 *
 *   const comfy = createComfyModule({ port, 存档 })
 *   const comfy = createComfyModule({ 地址, 存档 })      给了地址就自带 HTTP 适配器
 *
 *   // 直呼
 *   comfy.探活() · comfy.看队列() · comfy.看节点定义()
 *   comfy.工作流({ 图 }) · comfy.取工作流() · comfy.清工作流()
 *   comfy.认() · comfy.认图(图)
 *   comfy.出图({ 正向, 负向, 图片 }) · comfy.取图(产出项)
 *
 *   // 动作表与清单
 *   comfy.run(动作, 参数)
 *   comfy.actions
 *   comfy.describe()
 *
 * 十二个动作一律返回 Promise：
 *   直呼（comfy.认()）成功给数据，失败给 null；
 *   run(动作, 参数) 一律给 { ok:true, data } 或 { ok:false, reason, code }。
 *
 * 动作名与回执字段用中文；工作流与产出的形状用英文键。
 */

const { createCore, ERR } = require('./core.js');
const { checkPort, PORT_METHODS } = require('./port.js');
const { createHttpAdapter, ERR: HTTP_ERR } = require('./adapter-http.js');
const G = require('./graph.js');

const ok = (data) => ({ ok: true, data: data === undefined ? null : data });
const fail = (码, 话) => ({ ok: false, reason: `${码}: ${话 || 码}`, code: 码 });
const 是对象 = G.是对象;

/** 这个值本身就是一张工作流（而不是 { 图: 工作流 } 这种包了一层的参数）。 */
const 是图 = (值) => G.认形态(值).ok;

/**
 * 动作表。每一行：名字 → { 摘要, 参数, 说明, 做 }
 */
function 建动作表(core) {
  const 图说明 = '一张工作流：接口图（节点 id → { class_type, inputs }），或界面图（带 nodes / links）';
  /** 直呼时参数就是图本身，走动作表时参数是 { 图 }。 */
  const 取图参数 = (参数) => {
    if (是图(参数) || !是对象(参数)) return 参数;
    return 参数.图 === undefined ? 参数 : 参数.图;
  };

  return {
    '探活': {
      摘要: '看 ComfyUI 在不在、什么版本、什么设备',
      参数: [],
      说明: {},
      做: (_参数, 上下文) => core.探活(上下文.signal),
    },
    '看队列': {
      摘要: '看正在跑几个、排队几个',
      参数: [],
      说明: {},
      做: (_参数, 上下文) => core.看队列(上下文.signal),
    },
    '看节点定义': {
      摘要: '看这台 ComfyUI 装了哪些节点、每个节点要什么参数',
      参数: [],
      说明: {},
      做: (_参数, 上下文) => core.看节点定义(上下文.signal),
    },
    '存工作流': {
      摘要: '存一张工作流（界面图或接口图都收）',
      参数: ['图'],
      说明: { 图: 图说明 },
      做: (参数) => core.存工作流(取图参数(参数)),
    },
    '取工作流': {
      摘要: '取存着的那一张',
      参数: [],
      说明: {},
      做: () => core.取工作流(),
    },
    '清工作流': {
      摘要: '把存着的那一张清掉',
      参数: [],
      说明: {},
      做: () => core.清工作流(),
    },
    '绘图开关': {
      摘要: '读取或设置是否允许新出图请求',
      参数: ['启用?'],
      说明: { 启用: '布尔值；不传时只读取当前状态' },
      做: (参数) => core.绘图开关(是对象(参数) && '启用' in 参数 ? 参数.启用 : undefined),
    },
    '生成设置': {
      摘要: '读取或设置每轮张数、最多轮数与自动迭代状态',
      参数: ['每轮张数?', '最多轮数?', '自动迭代?'],
      说明: {
        每轮张数: '正整数；一次生成的张数',
        最多轮数: '正整数；包含首次生成的最多轮数',
        自动迭代: '布尔值；是否允许继续生成',
      },
      做: (参数) => core.生成设置(是对象(参数) && Object.keys(参数).length ? 参数 : undefined),
    },
    '参数': {
      摘要: '读取或编辑保存工作流里的实际节点参数',
      参数: ['节点?', '参数?', '值?'],
      说明: { 节点: '节点编号；不传时读取所有节点参数', 参数: '输入或控件名称；写入时与节点和值一起传', 值: '要保存的 JSON 值' },
      做: (输入) => core.参数(是对象(输入) && Object.keys(输入).length ? 输入 : undefined),
    },
    '认': {
      摘要: '读存着的那一张：正 / 负 / 图各接在哪',
      参数: [],
      说明: {},
      做: () => core.认(),
    },
    '认图': {
      摘要: '读给定的一张：正 / 负 / 图各接在哪',
      参数: ['图'],
      说明: { 图: 图说明 },
      做: (参数) => core.认(取图参数(参数)),
    },
    '出图': {
      摘要: '填三项、提交、盯到完成',
      参数: ['正向?', '负向?', '图片?', '张数?'],
      说明: {
        正向: '正向提示词，写进图上所有正向口',
        负向: '负向提示词；图上没有负向口时忽略',
        图片: '{ 字节, 文件名, mime }，送进 ComfyUI 输入区再写进图片口',
        张数: '正整数；覆盖主采样器上游可确认的批量输入',
      },
      做: (参数, 上下文) => core.出图({ ...(是对象(参数) ? 参数 : {}), 信号: 上下文.signal }),
    },
    '取图': {
      摘要: '取一个产出文件的字节',
      参数: ['产出'],
      说明: { 产出: '出图回执里 产出 数组的一项' },
      // 直呼时参数就是产出项本身，走动作表时参数是 { 产出 }
      做: (参数, 上下文) => core.取图(是对象(参数) && 是对象(参数.产出) && !('文件名' in 参数) ? 参数.产出 : 参数, 上下文.signal),
    },
  };
}

/**
 * 装配。
 *   { port }                       端口由装配层递进来
 *   { 地址 }                        内部装 HTTP 适配器
 *   { clientId, 存档, 等待, 现在, 上限毫秒, 新UUID }   其余依赖由装配层递进来
 *   存档 = { 读(), 写(工作流), 清() }
 */
function createComfyModule(选项 = {}) {
  let port = 选项.port;
  if (port === undefined) {
    const 有固定地址 = typeof 选项.地址 === 'string';
    const 动态地址 = typeof 选项.取地址 === 'function';
    if (有固定地址 === 动态地址 || (有固定地址 && !选项.地址.trim())) {
      throw new Error(`${ERR.NO_PORT}: 要么递端口 createComfyModule({ port })，要么给 地址 或 取地址`);
    }
    port = createHttpAdapter({ ...(动态地址 ? { 取地址: 选项.取地址 } : { 地址: 选项.地址 }), 取回: 选项.取回, 超时毫秒: 选项.超时毫秒 });
  }
  const 门 = checkPort(port);
  if (!门.ok) throw new Error(`端口不合格：${门.reason}（要有 ${PORT_METHODS.join(' / ')}）`);

  const core = createCore({
    port,
    存档: 选项.存档 || null,
    clientId: 选项.clientId,
    等待: 选项.等待 || null,
    现在: 选项.现在 || null,
    上限毫秒: 选项.上限毫秒 || null,
    新UUID: 选项.新UUID || null,
  });

  const 动作表 = 建动作表(core);

  /**
   * 走一个动作。一律返回 Promise，一律给 { ok, data } 信封。
   */
  function run(名字, 参数 = {}, 上下文 = {}) {
    const 动作 = 动作表[名字];
    if (!动作) return Promise.resolve(fail(G.ERR.BAD_PARAM, `没有这个动作：${名字}`));
    let 结果;
    try {
      结果 = 动作.做(参数 || {}, 上下文);
    } catch (错误) {
      return Promise.resolve(fail(ERR.FAILED, (错误 && 错误.message) || '动作执行出错'));
    }
    if (结果 && typeof 结果.then === 'function') {
      return 结果.then(
        (x) => (x && typeof x === 'object' && 'ok' in x ? x : ok(x)),
        (错误) => fail(ERR.FAILED, (错误 && 错误.message) || '动作执行出错')
      );
    }
    if (!结果 || typeof 结果 !== 'object') return Promise.resolve(ok(结果));
    return Promise.resolve(结果);
  }

  function describe() {
    return Object.entries(动作表).map(([名字, 动作]) => ({
      动作: 名字,
      摘要: 动作.摘要,
      参数: 动作.参数,
      说明: 动作.说明,
    }));
  }

  /** 直呼式：成功给数据，失败给 null。一律 Promise。 */
  const 直呼 = (名字) => async (参数, 上下文 = {}) => {
    const r = await run(名字, 参数, 上下文);
    return r && r.ok ? r.data : null;
  };

  const facade = {
    run,
    actions: Object.freeze(Object.keys(动作表)),
    describe,

    探活: 直呼('探活'),
    看队列: 直呼('看队列'),
    看节点定义: 直呼('看节点定义'),
    工作流: 直呼('存工作流'),
    取工作流: 直呼('取工作流'),
    清工作流: 直呼('清工作流'),
    绘图开关: (启用) => 直呼('绘图开关')(启用 === undefined ? {} : { 启用 }),
    生成设置: (输入) => 直呼('生成设置')(输入 === undefined ? {} : 输入),
    参数: (输入) => 直呼('参数')(输入 === undefined ? {} : 输入),
    认: 直呼('认'),
    认图: 直呼('认图'),
    出图: 直呼('出图'),
    取图: 直呼('取图'),

    ERR: Object.freeze({ ...ERR, ...G.ERR, ...HTTP_ERR }),
    端口方法: PORT_METHODS,
    在跑吗: core.在跑吗,
  };

  return Object.freeze(facade);
}

module.exports = { createComfyModule };
