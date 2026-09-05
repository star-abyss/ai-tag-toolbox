'use strict';

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).trim();
  return result || fallback;
}

function errorShape(error, fallback = '请求失败', code = 'REQUEST_FAILED') {
  if (error && typeof error === 'object' && error.code && error.message) {
    return { code: text(error.code, code), message: text(error.message, fallback), retryable: error.retryable === true };
  }
  const aborted = error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
  return {
    code: aborted ? 'CANCELLED' : text(error?.code, code),
    message: text(error?.message || error, aborted ? '请求已取消' : fallback),
    retryable: !aborted && error?.retryable === true
  };
}

function createRequestManager(options = {}) {
  const requests = new Map();
  const defaultTimeoutMs = Math.max(0, Number(options.timeoutMs) || 0);
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};

  function emit(record, event = 'changed') {
    try { onChange({ event, request: snapshot(record) }); } catch { /* status listeners are optional */ }
  }

  function snapshot(record) {
    if (!record) return null;
    return {
      requestId: record.requestId,
      kind: record.kind,
      status: record.status,
      startedAt: record.startedAt,
      endedAt: record.endedAt || 0,
      timeoutMs: record.timeoutMs,
      error: record.error || null
    };
  }

  function begin(requestId, config = {}) {
    const id = text(requestId, `request_${Date.now().toString(36)}`);
    cancel(id, 'REQUEST_REPLACED');
    const controller = new AbortController();
    const external = config.signal;
    const record = {
      requestId: id,
      kind: text(config.kind, 'request'),
      status: 'running',
      controller,
      signal: controller.signal,
      timeoutMs: Math.max(0, Number(config.timeoutMs) || defaultTimeoutMs),
      startedAt: Date.now(),
      endedAt: 0,
      error: null,
      timer: null,
      externalAbort: null
    };
    if (external?.aborted) controller.abort();
    else if (external?.addEventListener) {
      record.externalAbort = () => controller.abort();
      external.addEventListener('abort', record.externalAbort, { once: true });
    }
    if (record.timeoutMs > 0) {
      record.timer = setTimeout(() => finish(id, 'timeout', { code: 'TIMEOUT', message: '请求超时', retryable: true }), record.timeoutMs);
    }
    requests.set(id, record);
    emit(record, 'started');
    if (record.signal.aborted) finish(id, 'cancelled', { code: 'CANCELLED', message: '请求已取消' });
    return { requestId: id, signal: record.signal, controller, status: snapshot(record) };
  }

  function finish(requestId, status = 'completed', error = null) {
    const record = requests.get(text(requestId));
    if (!record || record.endedAt) return snapshot(record);
    if (record.timer) clearTimeout(record.timer);
    record.timer = null;
    record.endedAt = Date.now();
    record.status = status;
    record.error = error ? errorShape(error) : null;
    if (status === 'cancelled' || status === 'timeout') record.controller.abort();
    emit(record, status);
    return snapshot(record);
  }

  function cancel(requestId, reason = 'CANCELLED') {
    const record = requests.get(text(requestId));
    if (!record || record.endedAt) return false;
    const code = text(reason, 'CANCELLED');
    finish(record.requestId, code === 'TIMEOUT' ? 'timeout' : 'cancelled', { code, message: code === 'TIMEOUT' ? '请求超时' : '请求已取消' });
    return true;
  }

  function get(requestId) { return snapshot(requests.get(text(requestId))); }
  function getRecord(requestId) { return requests.get(text(requestId)) || null; }
  function remove(requestId) { const record = requests.get(text(requestId)); if (!record) return false; if (!record.endedAt) cancel(requestId); requests.delete(text(requestId)); return true; }
  function clear() { for (const id of requests.keys()) cancel(id); requests.clear(); }

  return { begin, start: begin, finish, complete: id => finish(id, 'completed'), fail: (id, error) => finish(id, 'error', error), cancel, get, getRecord, remove, clear, snapshot };
}

module.exports = { createRequestManager, errorShape };
