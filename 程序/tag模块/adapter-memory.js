'use strict';
/*
 * 适配器：内存。
 *
 * 内存版的端口，给测试用。
 */

/** 读不懂的哨兵值。 */
const UNREADABLE_VALUE = Symbol('unreadable');

function createMemoryPort(initial = {}) {
  const data = new Map(Object.entries(initial));
  const frozen = new Set();

  function looksUnreadable(value) {
    return value === UNREADABLE_VALUE || typeof value === 'string';
  }

  return {
    read(key) {
      if (!data.has(key)) return { state: 'missing' };
      const value = data.get(key);
      if (looksUnreadable(value)) {
        frozen.add(key);
        return { state: 'unreadable', reason: 'parse' };
      }
      return { state: 'ok', value };
    },
    set(key, value) {
      if (frozen.has(key)) return { ok: false, reason: '读不懂' };
      data.set(key, value);
      return { ok: true };
    },
    remove(key) {
      if (frozen.has(key)) return { ok: false, reason: '读不懂' };
      const had = data.has(key);
      data.delete(key);
      return { ok: true, existed: had };
    },
    list(prefix = '') {
      return [...data.keys()].filter((key) => key.startsWith(prefix));
    },
    scan() {
      return { keys: [...data.keys()], temp: [], external: [] };
    },
    status(key) {
      const result = this.read(key);
      return { key, state: result.state, reason: result.reason, frozen: frozen.has(key) };
    },
    忘记() {},
    // 测试用具
    $dump: () => Object.fromEntries(data),
    $put: (key, value) => { data.set(key, value); return true; },
    $corrupt: (key) => { data.set(key, UNREADABLE_VALUE); return true; },
    $keys: () => [...data.keys()],
  };
}

module.exports = { createMemoryPort, UNREADABLE_VALUE };
