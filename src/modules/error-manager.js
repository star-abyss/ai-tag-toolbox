'use strict';

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).trim();
  return result || fallback;
}

function errorShape(error, fallback = '请求失败', code = 'REQUEST_FAILED') {
  if (error && typeof error === 'object') {
    if (error.error && typeof error.error === 'object') return errorShape(error.error, fallback, error.code || code);
    const aborted = error.name === 'AbortError' || error.code === 'ABORT_ERR';
    const rawCode = aborted ? 'CANCELLED' : text(error.code, code);
    const rawMessage = text(error.message || error.error || error.reason, aborted ? '请求已取消' : fallback);
    return { code: rawCode, message: rawMessage, retryable: rawCode === 'TIMEOUT' || error.retryable === true };
  }
  const message = text(error, fallback);
  return { code, message, retryable: false };
}

function resultOk(data, requestId, usage = null) {
  return { ok: true, data: data == null ? null : data, error: null, requestId: text(requestId), usage: usage || null };
}

function resultError(error, requestId, fallback = '请求失败') {
  return { ok: false, data: null, error: errorShape(error, fallback), requestId: text(requestId), usage: null };
}

module.exports = { errorShape, resultOk, resultError };
