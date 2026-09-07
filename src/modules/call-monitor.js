'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const REDACTED = '[REDACTED]';
const TRUNCATED = '[TRUNCATED]';
const clone = value => JSON.parse(JSON.stringify(value));
const size = value => Buffer.byteLength(JSON.stringify(value));

// Runs only on diagnostic copies. Provider requests and conversation history
// must never be changed by log redaction or retention limits.
function sanitize(value, secrets = [], budget = 512 * 1024) {
  const seen = new WeakSet();
  let remaining = budget;
  let truncated = false;
  const cut = () => { truncated = true; return TRUNCATED; };
  function visit(item, key = '', depth = 0) {
    if (remaining <= 0 || depth > 28) return cut();
    const name = key.replace(/[_-]/g, '').toLowerCase();
    if (/^(?:key|apikey|visionkey|primarykey|authorization|password|secret|token|accesstoken|refreshtoken|cookie|setcookie|credential)$/.test(name)) return REDACTED;
    if (/^(?:dataurl|thumbnaildataurl|previewurl|viewurl|base64|bytes|imageurl|filepath|path|filename|modelpath|modelsdir|tagsfile|tagspath|src|url)$/.test(name)) return REDACTED;
    if (typeof item === 'function' || typeof item === 'symbol' || item === undefined) return null;
    if (item === null || typeof item === 'number' || typeof item === 'boolean') return item;
    if (typeof item === 'bigint') return String(item);
    if (typeof item === 'string') {
      let str = item;
      for (const secret of secrets) if (typeof secret === 'string' && secret) str = str.split(secret).join(REDACTED);
      // Tool messages and raw replies can themselves contain serialized JSON.
      if (depth < 20 && str.length < budget && /^[\s]*[\[{]/.test(str)) {
        try {
          const parsed = JSON.parse(str);
          const captured = visit(parsed, '', depth + 1);
          return JSON.stringify(captured) === JSON.stringify(parsed) ? str : JSON.stringify(captured);
        } catch { /* plain output */ }
      }
      str = str.replace(/data:[^\s"'<>]+/gi, REDACTED)
        .replace(/\b(?:blob:|file:\/\/)[^\s"'<>]+/gi, REDACTED)
        .replace(/\bBearer\s+[^\s,"'<>]+/gi, 'Bearer ' + REDACTED)
        .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED)
        .replace(/\b((?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*)[^\s,"'<>]+/gi, '$1' + REDACTED)
        .replace(/([?&](?:api[_-]?key|key|token|access_token)=)[^&\s"'<>]+/gi, '$1' + REDACTED)
        .replace(/\b[A-Za-z]:[\\/][^\r\n"'<>]*/g, REDACTED)
        .replace(/(?:\\\\|\/)(?:Users|home|private|tmp|var|mnt)[\\/][^\r\n"'<>]*/gi, REDACTED);
      const limit = Math.min(remaining, 128 * 1024);
      const bytes = Buffer.from(str);
      if (bytes.length > limit) { str = bytes.subarray(0, Math.max(0, limit)).toString('utf8') + cut(); }
      remaining -= Buffer.byteLength(str);
      return str;
    }
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) return REDACTED;
    if (item instanceof Error) return visit({ code: item.code, message: item.message }, '', depth + 1);
    if (seen.has(item)) return cut();
    seen.add(item);
    let result;
    if (Array.isArray(item)) {
      result = [];
      for (const child of item.slice(0, 512)) { if (remaining <= 0) { result.push(cut()); break; } result.push(visit(child, '', depth + 1)); remaining -= 8; }
      if (item.length > 512) result.push(cut());
    } else {
      result = {};
      for (const [name, child] of Object.entries(item).slice(0, 512)) {
        if (['signal', 'controller'].includes(name) || typeof child === 'function') continue;
        if (remaining <= 0) { result._truncated = cut(); break; }
        Object.defineProperty(result, name, { value: visit(child, name, depth + 1), enumerable: true, writable: true });
        remaining -= name.length + 8;
      }
    }
    seen.delete(item);
    return result;
  }
  return { value: visit(value), truncated };
}

function createCallMonitor(options = {}) {
  const scope = new AsyncLocalStorage();
  const records = new Map();
  const maxRecords = Math.max(1, Math.min(500, Number(options.maxRecords) || 200));
  const maxRecordBytes = Math.max(4096, Number(options.maxRecordBytes) || 1024 * 1024);
  const maxBytes = Math.max(maxRecordBytes, Number(options.maxBytes) || 12 * 1024 * 1024);
  const filePath = options.filePath || '';
  let revision = 0, dropped = 0, timer = null, writing = Promise.resolve(), persistenceError = '';
  const knownSecrets = new Set();
  const safe = value => {
    let configured = [];
    try { configured = options.getSecrets?.() || []; } catch { /* optional */ }
    return sanitize(value, [...knownSecrets, ...configured], maxRecordBytes / 3);
  };
  function compact(row) {
    if (size(row) > maxRecordBytes) {
      row.truncated = true;
      while (row.exchanges.length > 1 && size(row) > maxRecordBytes) row.exchanges.shift();
      while (row.events.length && size(row) > maxRecordBytes) row.events.shift();
      if (size(row) > maxRecordBytes) {
        row.input = TRUNCATED;
        if (size(row) > maxRecordBytes) row.output = TRUNCATED;
        if (size(row) > maxRecordBytes) row.exchanges = [];
      }
    }
    row._bytes = size(row);
    let total = [...records.values()].reduce((n, r) => n + r._bytes, 0);
    for (const [id, old] of records) {
      if (records.size <= maxRecords && total <= maxBytes) break;
      total -= old._bytes; records.delete(id); dropped++;
    }
  }
  function list() { return [...records.values()].map(row => { const value = clone(row); delete value._bytes; return value; }); }
  function bundle() { return { format: 'ai-tag-call-monitor', version: 1, exportedAt: new Date().toISOString(), dropped, limits: { maxRecords, maxBytes, maxRecordBytes }, records: list() }; }
  function flush() {
    clearTimeout(timer); timer = null;
    if (!filePath) return Promise.resolve();
    const payload = JSON.stringify(bundle());
    writing = writing.then(async () => {
      try {
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        const temporary = filePath + '.tmp';
        await fs.promises.writeFile(temporary, payload, 'utf8');
        await fs.promises.rename(temporary, filePath);
        persistenceError = '';
      } catch { persistenceError = '本地日志保存失败，仍可复制或导出当前记录'; }
    });
    return writing;
  }
  function changed(row) {
    if (row) compact(row);
    revision++;
    if (filePath && !timer) { timer = setTimeout(flush, 250); timer.unref?.(); }
  }
  function begin(meta) {
    const value = safe(meta);
    const row = { ...value.value, requestId: String(meta.requestId), rootRequestId: String(meta.rootRequestId || meta.requestId), status: 'running', startedAt: Date.now(), endedAt: null, input: value.value.input || {}, output: null, exchanges: [], events: [], truncated: value.truncated, _bytes: 0 };
    records.set(row.requestId, row); changed(row);
    return row.requestId;
  }
  function update(id, patch) {
    const row = records.get(id); if (!row || row.status !== 'running') return;
    const value = safe(patch); Object.assign(row, value.value); row.truncated ||= value.truncated; changed(row);
  }
  function finish(id, patch) {
    const row = records.get(id); if (!row || row.status !== 'running') return;
    const value = safe(patch); Object.assign(row, value.value, { endedAt: Date.now() });
    row.truncated ||= value.truncated;
    for (const exchange of row.exchanges) if (exchange.status === 'running') { exchange.status = row.status; exchange.endedAt = row.endedAt; exchange.error = row.error || null; }
    changed(row);
    try { options.onCallRecord?.(list().find(item => item.requestId === id)); } catch { /* logging is optional */ }
  }
  function event(id, event) {
    const row = records.get(id); if (!row || row.status !== 'running') return;
    const value = safe(event); row.events.push(value.value); row.truncated ||= value.truncated;
    if (row.events.length > 128) { row.events.shift(); row.truncated = true; }
    changed(row);
  }
  function beginExchange(request, credentials = []) {
    for (const secret of credentials) if (typeof secret === 'string' && secret) knownSecrets.add(secret);
    const contextId = scope.getStore();
    const requestId = contextId || begin({ requestId: 'api_' + randomUUID(), kind: 'api', input: {} });
    const row = records.get(requestId);
    if (!row || row.status !== 'running') return null;
    const safeRequest = safe(request);
    const exchange = { id: randomUUID(), startedAt: Date.now(), endedAt: null, status: 'running', request: safeRequest.value, response: null, usage: null };
    row.exchanges.push(exchange); row.truncated ||= safeRequest.truncated; changed(row);
    return { requestId, id: exchange.id, standalone: !contextId };
  }
  function endExchange(handle, response, error) {
    const row = records.get(handle?.requestId); if (!row || row.status !== 'running') return;
    const exchange = row.exchanges.find(item => item.id === handle.id); if (!exchange || exchange.status !== 'running') return;
    const captured = safe({ response, error: error || null, usage: response?.usage || null });
    Object.assign(exchange, captured.value, { endedAt: Date.now(), status: error || response?.ok === false ? 'error' : 'completed' });
    row.truncated ||= captured.truncated; changed(row);
    if (handle.standalone) finish(handle.requestId, { status: exchange.status, output: error ? null : response, error: error || null, usage: response?.usage || null });
  }
  if (filePath) {
    try {
      if (fs.statSync(filePath).size <= maxBytes * 2) {
        const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (saved.format === 'ai-tag-call-monitor' && saved.version === 1 && Array.isArray(saved.records)) {
          for (const item of saved.records.slice(-maxRecords)) {
            if (!item?.requestId) continue;
            const captured = sanitize(item, [], maxRecordBytes);
            const row = captured.value;
            row.truncated ||= captured.truncated;
            row.exchanges = Array.isArray(row.exchanges) ? row.exchanges : [];
            row.events = Array.isArray(row.events) ? row.events : [];
            if (row.status === 'running') { row.status = 'interrupted'; row.endedAt = Date.now(); }
            for (const exchange of row.exchanges) if (exchange.status === 'running') exchange.status = 'interrupted';
            records.set(row.requestId, row); compact(row);
          }
        }
      }
    } catch { /* no previous log or invalid log: start clean */ }
  }
  return {
    begin, update, finish, event, beginExchange, endExchange, list, flush, bundle,
    run: (id, action) => scope.run(id, action),
    clear() { records.clear(); dropped = 0; changed(); return true; },
    info: () => ({ revision, count: records.size, dropped, persistent: Boolean(filePath), persistenceError, maxRecords, maxBytes })
  };
}

module.exports = { createCallMonitor };
