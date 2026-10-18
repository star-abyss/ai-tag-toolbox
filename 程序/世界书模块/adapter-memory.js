'use strict';
/*
 * 世界书模块 · 内存适配器。与 adapter-file.js 同契约，不碰盘。
 *
 * 用户那份存在一个变量里；只读默认由构造参数给进来，键就是书的名字。
 *
 * 读的 state 只给 ok / missing 两种：内存里没有"读不懂"。
 */

/**
 * @param {{ 默认?: Record<string, object> }} [options]
 */
function createMemoryAdapter(options = {}) {
  const 默认 = new Map();
  for (const [名字, 书] of Object.entries(options.默认 || {})) 默认.set(名字, 书);

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
    const items = [];
    for (const [名字, 书] of 默认) {
      items.push({
        名字,
        条目数: Array.isArray(书 && 书.entries) ? 书.entries.length : 0,
      });
    }
    items.sort((a, b) => a.名字.localeCompare(b.名字, 'zh'));
    return { ok: true, items };
  }

  function readDefault(名字) {
    const 书 = 默认.get(String(名字));
    if (!书) return { state: 'missing' };
    return { state: 'ok', value: JSON.parse(JSON.stringify(书)) };
  }

  return {
    readState,
    writeState,
    listDefaults,
    readDefault,
  };
}

module.exports = { createMemoryAdapter };
