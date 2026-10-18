'use strict';
/*
 * 主AI模块 · 内存适配器。与 adapter-file.js 同契约，不碰盘。
 *
 * 用户那份存在一个变量里；只读默认由构造参数给进来，键就是预设的名字；
 * 业务工具表由构造参数给进来（默认工具表的来源）。
 *
 * 读的 state 只给 ok / missing 两种：内存里没有"读不懂"。
 */

/**
 * @param {{ 默认?: Record<string, object>, 业务工具?: Array|Function }} [options]
 */
function createMemoryAdapter(options = {}) {
  const 默认 = new Map();
  for (const [名字, 一套] of Object.entries(options.默认 || {})) 默认.set(名字, 一套);
  const 业务工具 = options.业务工具;

  /** 用户那份。null = 还没有。 */
  let 存档 = null;

  function readState() {
    if (存档 === null) return { state: 'missing' };
    return { state: 'ok', value: 存档 };
  }

  function writeState(value) {
    try {
      存档 = JSON.parse(JSON.stringify(value));
    } catch (_) {
      return { ok: false, reason: '未知' };
    }
    return { ok: true };
  }

  function listDefaults() {
    const items = [...默认.keys()].sort((a, b) => a.localeCompare(b, 'zh')).map((名字) => ({ 名字 }));
    return { ok: true, items };
  }

  function readDefault(名字) {
    const 一套 = 默认.get(String(名字));
    if (!一套) return { state: 'missing' };
    return { state: 'ok', value: JSON.parse(JSON.stringify(一套)) };
  }

  function businessTools() {
    const 出 = typeof 业务工具 === 'function' ? 业务工具() : 业务工具;
    return { ok: true, 工具表: Array.isArray(出) ? JSON.parse(JSON.stringify(出)) : [] };
  }

  return {
    readState,
    writeState,
    listDefaults,
    readDefault,
    businessTools,
  };
}

module.exports = { createMemoryAdapter };
