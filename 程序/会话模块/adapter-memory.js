'use strict';
const { copy } = require('./data.js');
function createMemoryAdapter({ sessions = [] } = {}) {
  if (!Array.isArray(sessions)) throw new Error('sessions 必须是数组');
  const values = new Map(sessions.map((s) => [s.id, copy(s)]));
  return Object.freeze({
    list: () => ({ ok: true, ids: [...values.keys()] }),
    read: (id) =>
      values.has(id) ? { state: 'ok', value: copy(values.get(id)) } : { state: 'missing' },
    write: async (id, value) => {
      values.set(id, copy(value));
      return { ok: true };
    },
    remove: async (id) => {
      values.delete(id);
      return { ok: true };
    },
  });
}
module.exports = { createMemoryAdapter };
