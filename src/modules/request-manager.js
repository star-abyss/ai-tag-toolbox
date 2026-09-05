'use strict';

const { errorShape } = require('./error-manager');
let sequence = 0;
function newRequestId(prefix = 'request') { return `${prefix}_${Date.now().toString(36)}_${(++sequence).toString(36)}`; }

function createRequestManager(options = {}) {
  const records = new Map();
  const maxRecords = Math.max(1, Number(options.maxRecords) || 256);
  const defaultTimeoutMs = Math.max(1, Number(options.timeoutMs) || 120000);
  const listeners = new Set(typeof options.onChange === 'function' ? [options.onChange] : []);
  function snapshot(row) {
    return row ? { requestId: row.requestId, parentRequestId: row.parentRequestId, rootRequestId: row.rootRequestId, kind: row.kind, status: row.status, timeoutMs: row.timeoutMs, startedAt: row.startedAt, endedAt: row.endedAt, error: row.error && { ...row.error } } : null;
  }
  function emit(row, event) { for (const listener of listeners) { try { listener({ event, request: snapshot(row) }); } catch { /* observers do not affect execution */ } } }
  function prune() { for (const [id, row] of records) { if (records.size <= maxRecords) break; if (row.endedAt) records.delete(id); } }
  function finish(id, state = 'completed', error = null) {
    const row = records.get(String(id));
    if (!row || row.endedAt) return snapshot(row);
    clearTimeout(row.timer); row.timer = null;
    row.externalSignal?.removeEventListener('abort', row.externalAbort);
    row.externalSignal = null; row.externalAbort = null;
    row.endedAt = Date.now(); row.status = state; row.error = error ? errorShape(error) : null;
    if (state === 'cancelled' || state === 'timeout') row.controller.abort(row.error);
    emit(row, state); prune(); return snapshot(row);
  }
  function begin(requestId, config = {}) {
    const requested = String(requestId || '').trim();
    const id = requested && !records.has(requested) ? requested : newRequestId(String(config.kind || 'request').replace(/[^a-z0-9_-]/gi, '_'));
    const controller = new AbortController();
    const row = { requestId: id, parentRequestId: String(config.parentRequestId || ''), rootRequestId: String(config.rootRequestId || id), kind: config.kind || 'request', status: 'running', timeoutMs: Math.max(1, Number(config.timeoutMs) || defaultTimeoutMs), startedAt: Date.now(), endedAt: 0, error: null, timer: null, externalSignal: config.signal || null, externalAbort: null, controller, signal: controller.signal };
    records.set(id, row);
    row.externalAbort = () => finish(id, 'cancelled', { code: 'CANCELLED', message: '请求已取消', retryable: false });
    if (!row.externalSignal?.aborted) row.externalSignal?.addEventListener('abort', row.externalAbort, { once: true });
    row.timer = setTimeout(() => finish(id, 'timeout', { code: 'TIMEOUT', message: '请求超时', retryable: true }), row.timeoutMs);
    emit(row, 'started');
    if (row.externalSignal?.aborted) row.externalAbort();
    prune();
    return { requestId: id, signal: row.signal, controller, status: snapshot(row) };
  }
  function cancel(id, reason = 'CANCELLED') {
    const row = records.get(String(id)); if (!row || row.endedAt) return false;
    const timeout = reason === 'TIMEOUT'; finish(id, timeout ? 'timeout' : 'cancelled', { code: timeout ? 'TIMEOUT' : 'CANCELLED', message: timeout ? '请求超时' : '请求已取消', retryable: timeout }); return true;
  }
  function remove(id) { const key = String(id); if (!records.has(key)) return false; cancel(key); return records.delete(key); }
  function clear() { for (const id of [...records.keys()]) remove(id); }
  return { begin, start: begin, finish, complete: id => finish(id), fail: (id, error) => finish(id, 'error', error), cancel, get: id => snapshot(records.get(String(id))), getRecord: id => records.get(String(id)) || null, list: () => [...records.values()].map(snapshot), remove, clear, snapshot, size: () => records.size, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}

module.exports = { createRequestManager, newRequestId, errorShape };
