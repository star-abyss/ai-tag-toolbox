'use strict';
const ERR = Object.freeze(
  Object.fromEntries(
    Object.entries({
      BAD_ACTION: 'BAD_ACTION',
      BAD_ARGUMENT: 'BAD_ARGUMENT',
      BAD_ID: 'BAD_ID',
      NO_SESSION: 'NO_SUCH_SESSION',
      NOT_READY: 'NOT_READY',
      CLOSED: 'CLOSED',
      BUSY: 'BUSY',
      NO_EXECUTOR: 'NO_EXECUTOR',
      EMPTY_INPUT: 'EMPTY_INPUT',
      UNREADABLE: 'STORE_UNREADABLE',
      WRITE_FAILED: 'WRITE_FAILED',
      REMOVE_FAILED: 'REMOVE_FAILED',
      BAD_UPDATE: 'BAD_UPDATE',
      EXECUTION_FAILED: 'EXECUTION_FAILED',
      STOPPED: 'STOPPED',
      INTERRUPTED: 'INTERRUPTED',
      IMAGE_MISSING: 'IMAGE_MISSING',
    }).map(([key, value]) => [key, 'SESSION_' + value]),
  ),
);
const ok = (data) => ({ ok: true, data });
const fail = (code, reason, details) => ({
  ok: false,
  code,
  reason: reason.startsWith(`${code}:`) ? reason : `${code}: ${reason}`,
  ...(details === undefined ? {} : { details }),
});
const copy = (value) => structuredClone(value);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value, prefix) =>
  typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9-]+$`).test(value);
const time = (value) => Number.isInteger(value) && value >= 0;
const keys = (value, expected) =>
  object(value) &&
  Object.keys(value).length === expected.length &&
  expected.every((k) => Object.hasOwn(value, k));
const missing = (value) =>
  keys(value, ['originalId', 'reason']) &&
  typeof value.originalId === 'string' &&
  typeof value.reason === 'string';
const image = (value) =>
  id(value.imageId, 'img') || (value.imageId === null && missing(value.missing));
function parts(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (p) =>
        object(p) &&
        (p.type === 'text'
          ? keys(p, ['type', 'text']) && typeof p.text === 'string'
          : p.type === 'image' &&
            image(p) &&
            keys(p, p.imageId === null ? ['type', 'imageId', 'missing'] : ['type', 'imageId'])),
    )
  );
}
function json(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(json);
  return (
    object(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    (!marker(value) || image(value)) &&
    Object.values(value).every(json)
  );
}
const marker = (value) =>
  object(value) &&
  value.type === 'session-image' &&
  (keys(value, ['type', 'imageId']) || keys(value, ['type', 'imageId', 'missing']));
function mapMarkers(value, fn) {
  if (marker(value)) return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapMarkers(v, fn));
  if (object(value))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapMarkers(v, fn)]));
  return value;
}
function references(s) {
  const ids = new Set();
  const take = (p) => {
    if (p.imageId !== null) ids.add(p.imageId);
    return p;
  };
  for (const p of [...s.draft, ...s.messages.flatMap((m) => m.parts)])
    if (p.type === 'image') take(p);
  for (const c of s.messages.flatMap((m) => m.toolCalls)) mapMarkers(c.result, take);
  return [...ids].sort();
}
const model = (value) =>
  value === null ||
  (keys(value, ['provider', 'model']) &&
    typeof value.provider === 'string' &&
    typeof value.model === 'string');
const content = (parts, reasoning, calls) =>
  parts.some((p) => p.type === 'image' || p.text.length > 0) ||
  reasoning.length > 0 ||
  calls.length > 0;
function validSession(s, filenameId = s?.id) {
  if (
    !keys(s, [
      'format',
      'version',
      'id',
      'title',
      'titleManual',
      'createdAt',
      'updatedAt',
      'messages',
      'turns',
      'draft',
    ]) ||
    s.format !== 'toolbox-session' ||
    s.version !== 1 ||
    !id(s.id, 's') ||
    s.id !== filenameId ||
    typeof s.title !== 'string' ||
    !s.title.trim() ||
    typeof s.titleManual !== 'boolean' ||
    !time(s.createdAt) ||
    !time(s.updatedAt) ||
    !parts(s.draft) ||
    !Array.isArray(s.messages) ||
    !Array.isArray(s.turns)
  )
    return false;
  const ms = new Set(),
    ts = new Map();
  for (const t of s.turns) {
    if (
      !keys(t, ['id', 'inputMessageId', 'status', 'startedAt', 'endedAt', 'error']) ||
      !id(t.id, 't') ||
      ts.has(t.id) ||
      !id(t.inputMessageId, 'm') ||
      !['running', 'complete', 'stopped', 'failed', 'interrupted'].includes(t.status) ||
      !time(t.startedAt)
    )
      return false;
    if (
      t.status === 'running'
        ? t.endedAt !== null || t.error !== null
        : !time(t.endedAt) ||
          (t.status === 'complete'
            ? t.error !== null
            : !keys(t.error, ['code', 'reason']) ||
              typeof t.error.code !== 'string' ||
              typeof t.error.reason !== 'string')
    )
      return false;
    ts.set(t.id, t);
  }
  for (const m of s.messages) {
    if (
      !keys(m, [
        'id',
        'turnId',
        'role',
        'parts',
        'reasoning',
        'context',
        'toolCalls',
        'createdAt',
        'model',
      ]) ||
      !id(m.id, 'm') ||
      ms.has(m.id) ||
      !ts.has(m.turnId) ||
      !['user', 'assistant'].includes(m.role) ||
      !parts(m.parts) ||
      typeof m.reasoning !== 'string' ||
      typeof m.context !== 'string' ||
      !time(m.createdAt) ||
      !model(m.model) ||
      !Array.isArray(m.toolCalls)
    )
      return false;
    if (
      m.role === 'user'
        ? m.toolCalls.length ||
          m.reasoning !== '' ||
          m.model !== null ||
          ts.get(m.turnId).inputMessageId !== m.id
        : m.context !== '' || !content(m.parts, m.reasoning, m.toolCalls)
    )
      return false;
    const calls = new Set();
    for (const c of m.toolCalls) {
      if (
        !keys(c, ['id', 'name', 'args', 'status', 'result']) ||
        typeof c.id !== 'string' ||
        !c.id ||
        calls.has(c.id) ||
        typeof c.name !== 'string' ||
        !c.name ||
        typeof c.args !== 'string' ||
        !['pending', 'running', 'complete', 'error', 'cancelled', 'interrupted'].includes(
          c.status,
        ) ||
        !json(c.result)
      )
        return false;
      if (
        ['pending', 'running'].includes(c.status) &&
        (c.result !== null || ts.get(m.turnId).status !== 'running')
      )
        return false;
      calls.add(c.id);
    }
    ms.add(m.id);
  }
  return s.turns.every(
    (t) => s.messages.filter((m) => m.turnId === t.id && m.role === 'user').length === 1,
  );
}
function finish(s, turn, status, error, now) {
  for (const message of s.messages.filter((m) => m.turnId === turn.id))
    for (const call of message.toolCalls) {
      if (call.status === 'pending') {
        call.status = 'cancelled';
        call.result = fail(ERR.STOPPED, '工具尚未开始，已取消');
      } else if (call.status === 'running') {
        call.status = 'interrupted';
        call.result = fail(ERR.INTERRUPTED, '工具已开始，结果未确认');
      }
    }
  turn.status = status;
  turn.endedAt = now;
  turn.error = error ? { code: error.code, reason: error.reason } : null;
  s.updatedAt = now;
}
function archive(text) {
  if (typeof text !== 'string') throw new Error('归档内容必须是 JSON 文本');
  const a = JSON.parse(text);
  if (
    !keys(a, ['format', 'version', 'sessions']) ||
    a.format !== 'toolbox-session-archive' ||
    a.version !== 2 ||
    !Array.isArray(a.sessions) ||
    !a.sessions.length
  )
    throw new Error('归档格式或版本错误');
  const sessions = new Set();
  for (const entry of a.sessions) {
    if (
      !keys(entry, ['session', 'images', 'missing', 'imageNumberHighWater']) ||
      !validSession(entry.session) ||
      sessions.has(entry.session.id) ||
      !Array.isArray(entry.images) ||
      !Array.isArray(entry.missing) ||
      !Number.isSafeInteger(entry.imageNumberHighWater) || entry.imageNumberHighWater < 0
    )
      throw new Error('会话字段或关联错误');
    sessions.add(entry.session.id);
    const ids = new Set(), numbers = new Set();
    for (const im of entry.images) {
      if (
        !keys(im, [
          'id',
          'number',
          'filename',
          'displayName',
          'mime',
          'width',
          'height',
          'metadata',
          'base64',
        ]) ||
        !id(im.id, 'img') ||
        ids.has(im.id) ||
        !Number.isSafeInteger(im.number) || im.number < 1 || numbers.has(im.number) ||
        !['filename', 'displayName', 'mime', 'base64'].every((k) => typeof im[k] === 'string') ||
        !im.base64 ||
        Buffer.from(im.base64, 'base64').toString('base64') !== im.base64 ||
        ![im.width, im.height].every(
          (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
        ) ||
        !object(im.metadata) ||
        !json(im.metadata)
      )
        throw new Error('图片结构或标准 base64 错误');
      ids.add(im.id);
      numbers.add(im.number);
    }
    if ([...numbers].some((number) => number > entry.imageNumberHighWater))
      throw new Error('图片图号超出高水位');
    for (const im of entry.missing) {
      if (
        !keys(im, ['id', 'reason']) ||
        !id(im.id, 'img') ||
        ids.has(im.id) ||
        typeof im.reason !== 'string'
      )
        throw new Error('缺图结构错误或映射重叠');
      ids.add(im.id);
    }
    if (references(entry.session).some((id) => !ids.has(id))) throw new Error('图片映射不完整');
  }
  return a;
}
function rebuild(source, newSessionId, imageIds, missingImages, alloc, now) {
  const s = copy(source),
    mids = new Map(s.messages.map((m) => [m.id, alloc('m')])),
    tids = new Map(s.turns.map((t) => [t.id, alloc('t')]));
  const replace = (p) =>
    p.imageId === null
      ? p
      : imageIds.has(p.imageId)
        ? { type: p.type, imageId: imageIds.get(p.imageId) }
        : {
            type: p.type,
            imageId: null,
            missing: { originalId: p.imageId, reason: missingImages.get(p.imageId) },
          };
  s.id = newSessionId;
  s.createdAt = now;
  s.updatedAt = now;
  s.draft = s.draft.map((p) => (p.type === 'image' ? replace(p) : p));
  for (const m of s.messages) {
    m.id = mids.get(m.id);
    m.turnId = tids.get(m.turnId);
    m.parts = m.parts.map((p) => (p.type === 'image' ? replace(p) : p));
    for (const c of m.toolCalls) {
      c.id = alloc('tc');
      c.result = mapMarkers(c.result, replace);
    }
  }
  for (const t of s.turns) {
    t.id = tids.get(t.id);
    t.inputMessageId = mids.get(t.inputMessageId);
    if (t.status === 'running')
      finish(
        s,
        t,
        'interrupted',
        fail(ERR.INTERRUPTED, '导入时发现中断，结束时间为本次发现时间'),
        now,
      );
  }
  return s;
}
module.exports = {
  ERR,
  ok,
  fail,
  copy,
  object,
  id,
  time,
  keys,
  missing,
  image,
  parts,
  json,
  model,
  content,
  validSession,
  finish,
  marker,
  mapMarkers,
  references,
  archive,
  rebuild,
};
