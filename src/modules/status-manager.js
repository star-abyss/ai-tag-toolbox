'use strict';

function clone(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  const output = {};
  for (const [key, item] of Object.entries(value)) if (typeof item !== 'function') output[key] = clone(item);
  return output;
}

function createStatusManager(options = {}) {
  const statuses = new Map();
  const listeners = new Set();
  if (typeof options.onStatus === 'function') listeners.add(options.onStatus);

  function emit(value) { const snapshot = clone(value); for (const listener of listeners) { try { listener(snapshot); } catch { /* listeners cannot break runtime */ } } return snapshot; }
  function update(requestId, patch = {}) {
    const id = String(requestId || '');
    if (!id) return null;
    const previous = statuses.get(id) || { requestId: id, status: 'idle', updatedAt: Date.now() };
    const next = { ...previous, ...clone(patch), requestId: id, updatedAt: Date.now() };
    statuses.set(id, next);
    return emit(next);
  }
  function start(requestId, patch = {}) { return update(requestId, { ...patch, status: 'running', startedAt: patch.startedAt || Date.now() }); }
  function complete(requestId, patch = {}) { return update(requestId, { ...patch, status: 'completed', endedAt: patch.endedAt || Date.now() }); }
  function fail(requestId, error, patch = {}) { return update(requestId, { ...patch, status: 'error', error: clone(error), endedAt: Date.now() }); }
  function cancel(requestId, patch = {}) { return update(requestId, { ...patch, status: 'cancelled', endedAt: Date.now() }); }
  function timeout(requestId, patch = {}) { return update(requestId, { ...patch, status: 'timeout', endedAt: Date.now() }); }
  function get(requestId) { return clone(statuses.get(String(requestId || '')) || null); }
  function list() { return [...statuses.values()].map(clone); }
  function subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => listeners.delete(listener); }
  function clear(requestId) { if (requestId == null) statuses.clear(); else statuses.delete(String(requestId)); }

  return { update, start, complete, fail, cancel, timeout, get, list, subscribe, clear };
}

module.exports = { createStatusManager };
