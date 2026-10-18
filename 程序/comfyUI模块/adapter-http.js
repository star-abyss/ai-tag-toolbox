'use strict';
/*
 * comfyUI 模块 · HTTP 适配器。本模块唯一发请求的地方。
 *
 *   createHttpAdapter({ 地址 | 取地址, 取回 = fetch, 超时毫秒 = 30000 })
 *
 * 地址      形如 http://127.0.0.1:8188，不带尾斜杠
 * 取回      注入的取回函数，签名同 fetch；自检用它换掉真网络
 *
 * 每个端口方法给 { ok:true, data } 或 { ok:false, reason, code }。
 */

const { reasonOf, 说异常 } = require('./port.js');
const { randomUUID } = require('node:crypto');

const ERR = {
  BAD_ADDRESS: 'COMFY_ADDRESS_REQUIRED',
  EMPTY_GRAPH: 'COMFY_GRAPH_REQUIRED',
  BAD_TASK: 'COMFY_TASK_REQUIRED',
  BAD_PROMPT: 'COMFY_PROMPT_REJECTED',
  SUBMIT_UNKNOWN: 'COMFY_SUBMIT_UNKNOWN',
  NOT_JSON: 'COMFY_NOT_JSON',
  FILE_MISSING: 'COMFY_FILE_MISSING',
  NO_BYTES: 'COMFY_BYTES_REQUIRED',
  HTTP: 'COMFY_HTTP_ERROR',
  UNREACHABLE: 'COMFY_UNREACHABLE',
};

const ok = (data) => ({ ok: true, data: data === undefined ? null : data });
const fail = (码, 话, 细节) => ({
  ok: false,
  reason: `${码}: ${话 || 码}`,
  code: 码,
  ...(细节 === undefined ? {} : { details: 细节 }),
});

const 是对象 = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 把服务端的错误对象压成一行话。 */
function 说错误(体) {
  const 错误 = 体 && 体.error;
  if (!错误) return '';
  const 头 = [错误.type, 错误.message].filter(Boolean).join(' / ');
  const 细节 = 错误.details || (错误.extra_info && 错误.extra_info.exception_message) || '';
  return [头, 细节].filter(Boolean).join('：');
}

/** 把 node_errors 里每个节点的报错收成一句一条。 */
function 说节点错误(体) {
  const 表 = (体 && 体.node_errors) || {};
  const 出 = [];
  for (const [节点, 项] of Object.entries(表)) {
    for (const e of (项 && 项.errors) || []) {
      const 输入 = (e.extra_info && (e.extra_info.input_name || e.extra_info.exception_message)) || '';
      const 类名 = (项 && 项.class_type) || '';
      const 可选 = (e.extra_info && Array.isArray(e.extra_info.input_config) && Array.isArray(e.extra_info.input_config[0]))
        ? e.extra_info.input_config[0]
        : null;
      出.push([
        `节点 ${节点}${类名 ? `（${类名}）` : ''}`,
        e.message || e.type || '出错',
        e.details || 输入,
        可选 ? `可选值：${可选.slice(0, 12).join(' / ')}` : '',
      ].filter(Boolean).join(' · '));
    }
  }
  return 出;
}

/** /history 里那一条 → 本模块的任务形状。 */
function 读任务记录(记录) {
  if (!是对象(记录)) return { 状态: 'unknown', 完成: false, 产出: [], 错误: [] };
  const 状态 = (记录.status && 记录.status.status_str) || 'running';
  const 完成 = Boolean(记录.status && 记录.status.completed);
  const 产出 = [];
  for (const [节点, 输出] of Object.entries(记录.outputs || {})) {
    if (!是对象(输出)) continue;
    for (const [类, 项] of Object.entries(输出)) {
      if (!Array.isArray(项)) continue;
      for (const 文件 of 项) {
        if (!文件 || typeof 文件.filename !== 'string') continue;
        产出.push({
          节点,
          种类: 类 === 'images' ? 'image' : 类 === 'gifs' ? 'video' : 类,
          文件名: 文件.filename,
          子目录: 文件.subfolder || '',
          类型: 文件.type || 'output',
        });
      }
    }
  }
  const 错误 = [];
  for (const 报文 of (记录.status && 记录.status.messages) || []) {
    const 信息 = Array.isArray(报文) ? 报文[1] : 报文;
    if (!是对象(信息)) continue;
    const 话 = 信息.exception_message || 信息.message || 信息.error;
    if (话) 错误.push(String(话));
  }
  return { 状态, 完成, 产出, 错误 };
}

/**
 * @param {{地址:string, 取回?:Function, 超时毫秒?:number}} 选项
 * @returns {object} 端口
 */
function createHttpAdapter(选项 = {}) {
  const 有固定地址 = typeof 选项.地址 === 'string';
  const 取地址 = typeof 选项.取地址 === 'function' ? 选项.取地址 : null;
  const 地址 = 有固定地址 ? String(选项.地址 || '').replace(/\/+$/, '') : '';
  const 取回 = typeof 选项.取回 === 'function' ? 选项.取回 : globalThis.fetch;
  const 超时毫秒 = Number(选项.超时毫秒) > 0 ? Number(选项.超时毫秒) : 30000;
  const 客户端标识 = randomUUID();

  if (有固定地址 === Boolean(取地址) || (有固定地址 && !地址)) throw new Error(`${ERR.BAD_ADDRESS}: 固定地址与取地址只能提供一个`);

  function 当前地址() {
    const 值 = 有固定地址 ? 地址 : String(取地址() || '').replace(/\/+$/, '');
    if (!值) throw new Error(`${ERR.BAD_ADDRESS}: 要一个 ComfyUI 地址`);
    return 值;
  }

  /** 发一次请求。给 { ok, 状态, 答, 体 | 字节 }。 */
  async function 请求(路径, { 方法 = 'GET', 体, 原始体 } = {}, 信号) {
    const 控 = new AbortController();
    const 计时 = setTimeout(() => 控.abort(), 超时毫秒);
    const 挂 = () => 控.abort();
    if (信号) {
      if (信号.aborted) 控.abort();
      else 信号.addEventListener('abort', 挂, { once: true });
    }
    try {
      const 答 = await 取回(当前地址() + 路径, {
        method: 方法,
        ...(原始体 !== undefined ? { body: 原始体 } : 体 !== undefined ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(体),
        } : {}),
        signal: 控.signal,
      });
      const 类型 = (答.headers && 答.headers.get && 答.headers.get('content-type')) || '';
      const 是二进制 = /^(image|video|audio|application\/octet)/i.test(类型);
      const 内容 = 是二进制
        ? { 字节: Buffer.from(await 答.arrayBuffer()) }
        : { 体: await 答.text() };
      return { ok: true, 状态: 答.status, 答, ...内容 };
    } catch (错误) {
      return { ok: false, reason: reasonOf(错误), 原因: 说异常(错误) };
    } finally {
      clearTimeout(计时);
      if (信号) 信号.removeEventListener('abort', 挂);
    }
  }

  /** 请求 + 解 JSON。给 { ok, 状态, data }。 */
  async function 要JSON(路径, 选项2 = {}, 信号) {
    const r = await 请求(路径, 选项2, 信号);
    if (!r.ok) return fail(ERR.UNREACHABLE, `连不上 ComfyUI：${r.reason}${r.原因 ? `（${r.原因}）` : ''}`, { reason: r.reason });
    let 解析;
    try {
      解析 = JSON.parse(r.体);
    } catch {
      return fail(ERR.NOT_JSON, `ComfyUI 返回的不是 JSON（HTTP ${r.状态}）`);
    }
    return { ok: true, 状态: r.状态, data: 解析 };
  }

  /** 探活。给 { 版本, 设备, 显存总量, 显存可用 }。 */
  async function 探活(信号) {
    const r = await 要JSON('/system_stats', {}, 信号);
    if (!r.ok) return r;
    const 系统 = r.data && r.data.system;
    if (!是对象(系统)) return fail(ERR.NOT_JSON, '这个地址返回的内容不是 ComfyUI 的服务信息');
    const 设备 = Array.isArray(r.data.devices) && r.data.devices[0] ? r.data.devices[0] : {};
    return ok({
      版本: String(系统.comfyui_version || ''),
      设备: String(设备.name || ''),
      显存总量: Number(设备.vram_total) || 0,
      显存可用: Number(设备.vram_free) || 0,
    });
  }

  /** 看队列。给 { 运行中, 排队中 }。 */
  async function 看队列(信号) {
    const r = await 要JSON('/queue', {}, 信号);
    if (!r.ok) return r;
    const 跑 = Array.isArray(r.data.queue_running) ? r.data.queue_running.length : 0;
    const 排 = Array.isArray(r.data.queue_pending) ? r.data.queue_pending.length : 0;
    return ok({ 运行中: 跑, 排队中: 排 });
  }

  /** 看节点定义。给 /object_info 的那张节点表。 */
  async function 看节点定义(信号) {
    const r = await 要JSON('/object_info', {}, 信号);
    if (!r.ok) return r;
    return ok(r.data);
  }

  /**
   * 提交一张接口图。
   * @param {object} 接口图
   * @param {{clientId?:string, 界面图?:object}} [附带] 界面图放进 extra_data.extra_pnginfo.workflow
   */
  async function 提交(接口图, 附带 = {}, 信号) {
    if (!是对象(接口图) || !Object.keys(接口图).length) return fail(ERR.EMPTY_GRAPH, '没有要提交的图');
    const 体 = {
      prompt: 接口图,
      client_id: 附带.clientId || 客户端标识,
    };
    if (是对象(附带.界面图)) 体.extra_data = { extra_pnginfo: { workflow: 附带.界面图 } };

    const r = await 要JSON('/prompt', { 方法: 'POST', 体 }, 信号);
    if (!r.ok) return r;
    if (r.状态 >= 400) {
      const 节点错 = 说节点错误(r.data);
      const 话 = [说错误(r.data), ...节点错].filter(Boolean).join('；') || `HTTP ${r.状态}`;
      // 5xx：提交结果未知，队列里可能已经有这张图
      const 未知 = r.状态 >= 500;
      return fail(未知 ? ERR.SUBMIT_UNKNOWN : ERR.BAD_PROMPT, 话, { 状态码: r.状态, 节点错误: 节点错 });
    }
    const 任务号 = r.data && r.data.prompt_id;
    if (!任务号) return fail(ERR.SUBMIT_UNKNOWN, 'ComfyUI 没有给任务号，请检查队列');
    return ok({ 任务号: String(任务号) });
  }

  /** 看任务。给 { 状态, 完成, 产出, 错误 }。 */
  async function 看任务(任务号, 信号) {
    const 号 = String(任务号 || '');
    if (!号) return fail(ERR.BAD_TASK, '要一个任务号');
    const r = await 要JSON(`/history/${encodeURIComponent(号)}`, {}, 信号);
    if (!r.ok) return r;
    if (r.状态 === 404) return ok({ 状态: 'unknown', 完成: false, 产出: [], 错误: [] });
    return ok(读任务记录(r.data && r.data[号]));
  }

  /** 取结果文件。给 { 字节, mime }。 */
  async function 取结果文件(文件名, 位置 = {}, 信号) {
    const 名 = String(文件名 || '');
    if (!名) return fail(ERR.FILE_MISSING, '要一个文件名');
    const 查询 = new URLSearchParams({
      filename: 名,
      subfolder: String(位置.子目录 || ''),
      type: String(位置.类型 || 'output'),
    });
    const r = await 请求(`/view?${查询}`, {}, 信号);
    if (!r.ok) return fail(ERR.UNREACHABLE, `取文件失败（${r.reason}）`, { reason: r.reason });
    if (r.状态 === 404) return fail(ERR.FILE_MISSING, `ComfyUI 上没有这个文件：${名}`);
    if (r.状态 >= 400) return fail(ERR.HTTP, `取文件失败（HTTP ${r.状态}）`, { 状态码: r.状态 });
    if (!r.字节 || !r.字节.length) return fail(ERR.FILE_MISSING, `取到的文件是空的：${名}`);
    return ok({ 字节: r.字节, mime: (r.答.headers.get('content-type') || 'image/png') });
  }

  /** 送图片进 ComfyUI 的输入区。给 { 文件名, 子目录, 类型 }。 */
  async function 送图片(字节, 文件名, mime, 信号) {
    const 数据 = Buffer.isBuffer(字节) ? 字节
      : 字节 instanceof Uint8Array ? Buffer.from(字节)
        : 字节 instanceof ArrayBuffer ? Buffer.from(new Uint8Array(字节))
          : null;
    if (!数据 || !数据.length) return fail(ERR.NO_BYTES, '没有要送的图片内容');
    const 名 = String(文件名 || `comfy-input-${Date.now()}.png`).split(/[\\/]/).pop();
    const 类型 = /^image\//i.test(String(mime || '')) ? String(mime) : 'image/png';

    const 表单 = new FormData();
    表单.append('image', new Blob([数据], { type: 类型 }), 名);
    表单.append('type', 'input');
    表单.append('overwrite', 'true');

    const r = await 要JSON('/upload/image', { 方法: 'POST', 原始体: 表单 }, 信号);
    if (!r.ok) return r;
    if (r.状态 >= 400) return fail(ERR.HTTP, `送图片失败（HTTP ${r.状态}）`, { 状态码: r.状态 });
    const 回名 = String((r.data && (r.data.name || r.data.filename)) || 名);
    return ok({
      文件名: 回名,
      子目录: String((r.data && r.data.subfolder) || ''),
      类型: String((r.data && r.data.type) || 'input'),
    });
  }

  return Object.freeze({ 探活, 看队列, 看节点定义, 提交, 看任务, 取结果文件, 送图片 });
}

module.exports = { createHttpAdapter, ERR };
