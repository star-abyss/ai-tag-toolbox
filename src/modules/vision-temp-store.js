'use strict';

const crypto = require('node:crypto');

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).trim();
  return result || fallback;
}

function bytesFrom(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  return null;
}

function dataUrlBytes(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) return null;
  const comma = value.indexOf(',');
  if (comma < 0) return null;
  try {
    const body = value.slice(comma + 1);
    return value.slice(0, comma).toLowerCase().includes(';base64')
      ? Buffer.from(body, 'base64')
      : Buffer.from(decodeURIComponent(body), 'utf8');
  } catch { return null; }
}

function safeAddress(value) {
  const source = text(value);
  if (/^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(source)) return source;
  try {
    const parsed = new URL(source);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? source : '';
  } catch { return ''; }
}

function clone(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function createVisionTempStore(options = {}) {
  const images = options.images || null;
  const repository = options.imageRepository || options.repository || null;
  let authorizer = typeof options.authorizeReference === 'function'
    ? options.authorizeReference
    : typeof options.authorizeImage === 'function' ? options.authorizeImage : null;
  let active = null;
  let sequence = 0;

  function nextId() {
    sequence += 1;
    return `vision_tmp_${Date.now().toString(36)}_${sequence.toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  }

  function release(previous) {
    if (!previous) return;
    try { previous.controller?.abort?.(); } catch { /* ignore cancellation failures */ }
    try { options.onAbort?.(previous.tempId || previous.imageId || ''); } catch { /* optional observer */ }
    const url = text(previous.previewUrl || previous.objectUrl);
    if (url) {
      try { options.onReleasePreview?.(url); } catch { /* optional observer */ }
      try {
        if (typeof options.revokeObjectURL === 'function') options.revokeObjectURL(url);
        else if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
      } catch { /* optional browser adapter */ }
    }
    if (previous.kind === 'external-temp') {
      try { options.deleteTemp?.(previous); } catch { /* optional file adapter */ }
    }
  }

  function publicValue(value, includeBytes = false) {
    if (!value) return null;
    const output = { ...value };
    delete output.controller;
    // Paths and raw resolver handles are process-internal even when a caller
    // asks for the current UI value through preload.
    delete output.path;
    delete output.filePath;
    delete output.resolver;
    if (!includeBytes) delete output.bytes;
    else if (output.bytes) output.bytes = Buffer.from(output.bytes);
    return clone(output);
  }

  function setAuthorizer(value) {
    authorizer = typeof value === 'function' ? value : null;
    return Boolean(authorizer);
  }

  function repositoryReference(kind, id, details = {}) {
    if (kind === 'conversation') {
      const sessionId = text(details.sessionId);
      const refId = text(details.refId);
      if (!sessionId || !refId || typeof repository?.listConversation !== 'function') return null;
      let listed;
      try { listed = repository.listConversation(sessionId, { includePending: true, includeDeleted: false }); } catch { return null; }
      const rows = Array.isArray(listed) ? listed : (listed?.items || []);
      const row = rows.find(item => item && String(item.refId) === refId && String(item.imageId) === id && !item.deleted);
      if (!row) return null;
      return images?.get?.(id) || repository.getImage?.(id) || row;
    }
    if (kind === 'library' && typeof repository?.listGallery === 'function') {
      let listed;
      try { listed = repository.listGallery({ order: 'oldest' }); } catch { return null; }
      const rows = Array.isArray(listed) ? listed : (listed?.items || []);
      if (!rows.some(item => item && String(item.imageId || item.id) === id)) return null;
      return images?.get?.(id) || repository.getImage?.(id) || rows.find(item => String(item.imageId || item.id) === id) || null;
    }
    return null;
  }

  function authorisedReference(kind, id, details = {}) {
    if (!id) return null;
    const payload = { ...clone(details), kind, imageId: id };
    if (authorizer) {
      try {
        const result = authorizer(payload);
        if (result === false || result == null) return null;
        if (result === true) return images?.get?.(id) || payload;
        return result;
      } catch { return null; }
    }
    const scoped = repositoryReference(kind, id, details);
    if (scoped) return scoped;
    // A store created by a focused unit fixture may only have an Images-like
    // adapter. Explicitly registering a known asset is allowed in that case;
    // resolveForVision never uses this fallback for arbitrary IDs.
    if (kind !== 'conversation' && !repository && typeof images?.get === 'function') {
      try { return images.get(id) || null; } catch { return null; }
    }
    return null;
  }

  function reference(kind, imageId, extra = {}) {
    const id = text(imageId);
    if (!id) return null;
    const details = clone(extra);
    const item = authorisedReference(kind, id, details);
    if (!item) return null;
    if (details && typeof details === 'object') {
      delete details.kind;
      delete details.imageId;
    }
    return { ...details, kind, imageId: id, filename: item?.filename || item?.name || '', mime: item?.mime || '', assetRevision: item?.updatedAt || item?.revision || item?.version || item?.createdAt || '' };
  }

  function setLibraryReference(imageId, extra = {}) {
    if (imageId && typeof imageId === 'object') { extra = imageId; imageId = extra.imageId; }
    const next = reference('library', imageId, extra);
    if (!next) return null;
    release(active); active = next;
    return publicValue(active);
  }

  function setConversationReference(imageId, extra = {}) {
    if (imageId && typeof imageId === 'object') { extra = imageId; imageId = extra.imageId; }
    const next = reference('conversation', imageId, extra);
    if (!next) return null;
    release(active); active = next;
    return publicValue(active);
  }

  function replaceExternal(input = {}) {
    release(active);
    const source = input && typeof input === 'object' ? input : {};
    const sourceAddress = text(source.dataUrl || source.url);
    if (/^data:/i.test(sourceAddress) && !/^data:image\//i.test(sourceAddress)) { active = null; return null; }
    const bytes = bytesFrom(source.bytes || source.buffer || source.data) || dataUrlBytes(sourceAddress);
    const mime = text(source.mime || source.type, 'image/png');
    if (!bytes || !bytes.length || !/^image\//i.test(mime)) { active = null; return null; }
    if (source.tempId) sequence += 1;
    const controller = source.controller || new AbortController();
    active = {
      kind: 'external-temp',
      tempId: text(source.tempId, nextId()),
      assetRevision: `${Date.now().toString(36)}-${sequence.toString(36)}`,
      createdAt: new Date().toISOString(),
      bytes,
      dataUrl: safeAddress(source.dataUrl || source.url),
      thumbnailDataUrl: text(source.thumbnailDataUrl || source.thumbnail),
      previewUrl: text(source.previewUrl || source.objectUrl),
      filename: text(source.filename || source.name),
      mime,
      width: Number(source.width) || 0,
      height: Number(source.height) || 0,
      metadata: source.metadata ? clone(source.metadata) : null,
      controller
    };
    return publicValue(active);
  }

  function current() {
    if (active && active.kind !== 'external-temp' && !revalidateActive()) return null;
    return publicValue(active);
  }

  function requestedValue(value) {
    if (typeof value === 'string') return { value: text(value) };
    if (!value || typeof value !== 'object') return { value: '' };
    return {
      value: text(value.tempId || value.refId || value.imageId || value.id),
      sessionId: text(value.sessionId),
      refId: text(value.refId),
      imageId: text(value.imageId)
    };
  }

  function activeMatches(value) {
    const requested = requestedValue(value);
    if (!active || !requested.value) return false;
    if (active.kind === 'external-temp') return requested.value === active.tempId;
    if (active.kind === 'conversation') {
      // Conversation references are session-scoped. A renderer-bound request
      // carrying another session ID must never reuse this active slot.
      if (requested.sessionId && requested.sessionId !== text(active.sessionId)) return false;
      if (requested.refId && requested.refId !== text(active.refId)) return false;
      if (requested.imageId && requested.imageId !== text(active.imageId)) return false;
      return requested.value === active.refId || requested.value === active.imageId;
    }
    // Library references are explicitly authorized gallery assets and are not
    // owned by a conversation. Renderer calls commonly include the current
    // sessionId, which must not invalidate an otherwise valid library slot.
    return requested.value === active.imageId;
  }

  function revalidateActive() {
    if (!active || active.kind === 'external-temp') return Boolean(active);
    const item = authorisedReference(active.kind, active.imageId, active);
    if (!item) {
      release(active);
      active = null;
      return false;
    }
    return true;
  }

  function requestAuthorised(value) {
    if (activeMatches(value) && revalidateActive()) return { ...active };
    const requested = requestedValue(value);
    const sessionId = requested.sessionId || text(value?.sessionId);
    const imageId = requested.imageId || (typeof value === 'string' ? requested.value : '');
    // A direct Vision/call entry may carry a current session ID without first
    // opening the right-side drawer. Resolve that ID through the repository,
    // never through the global Images map.
    if (sessionId && imageId) {
      const item = authorisedReference('conversation', imageId, { sessionId, refId: requested.refId });
      if (item) return { kind: 'conversation', sessionId, refId: requested.refId, imageId, ...clone(item) };
    }
    return null;
  }

  function resolveForVision(value) {
    const authorised = requestAuthorised(value);
    if (!authorised) return null;
    if (authorised.kind === 'external-temp') return publicValue(active, true);
    const item = authorisedReference(authorised.kind, authorised.imageId, authorised);
    if (!item) return null;
    return { ...clone(item), ...publicValue(authorised), kind: authorised.kind, imageId: authorised.imageId };
  }

  function get(value) { return resolveForVision(value); }

  async function getBytes(value) {
    const authorised = requestAuthorised(value);
    if (!authorised) return null;
    const requested = authorised.kind === 'external-temp' ? authorised.tempId : authorised.imageId;
    if (authorised?.kind === 'external-temp' && requested === authorised.tempId) return Buffer.from(active.bytes);
    if (typeof options.getAuthorizedBytes === 'function') {
      try {
        const value = await options.getAuthorizedBytes({ ...authorised });
        if (value) return bytesFrom(value) || value;
      } catch { /* continue with the already-authorized image adapter */ }
    }
    if (typeof images?.getBytes === 'function') return images.getBytes(requested);
    if (typeof images?.getBlob === 'function') return images.getBlob(requested);
    return null;
  }

  function invalidateReference(value = {}) {
    if (!active || active.kind === 'external-temp') return false;
    const id = text(value.imageId || value.id);
    const refId = text(value.refId);
    const sessionId = text(value.sessionId);
    if ((id && id !== active.imageId) || (refId && refId !== active.refId) || (sessionId && sessionId !== active.sessionId)) return false;
    release(active); active = null; return true;
  }

  function clear() {
    const hadValue = Boolean(active);
    release(active); active = null;
    return { cleared: hadValue };
  }

  return { setLibraryReference, setConversationReference, replaceExternal, current, resolveForVision, clear, get, getBytes, setAuthorizer, invalidateReference };
}

module.exports = { createVisionTempStore };
