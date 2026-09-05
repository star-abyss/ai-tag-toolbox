'use strict';

/**
 * Relationship store for the global image assets.
 *
 * Images owns bytes and the physical index. This module only owns the
 * gallery/conversation references and the lifecycle rules around them.
 */

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).trim();
  return result || fallback;
}

function now() {
  return new Date().toISOString();
}

function read(storage, key, fallback) {
  try {
    if (storage && typeof storage.get === 'function') return storage.get(key, fallback);
    if (storage && typeof storage.load === 'function') return storage.load(key, fallback);
  } catch { /* corrupted optional state is treated as empty */ }
  return fallback;
}

function write(storage, key, value) {
  try {
    if (storage && typeof storage.set === 'function') return storage.set(key, value);
    if (storage && typeof storage.save === 'function') return storage.save(key, value);
  } catch { /* persistence is best effort, as in Images */ }
  return value;
}

function createImageRepository(options = {}) {
  const images = options.images || null;
  const storage = options.storage || null;
  const getSessions = typeof options.sessions === 'function'
    ? options.sessions
    : () => (Array.isArray(options.sessions) ? options.sessions : []);
  const saveSessions = typeof options.saveSessions === 'function'
    ? options.saveSessions
    : () => undefined;
  const gallery = new Map();
  const conversations = new Map();
  const counters = object(read(storage, 'conversation_image_slot_counters', {}))
    ? { ...read(storage, 'conversation_image_slot_counters', {}) }
    : {};
  const legacyCollectionState = object(read(storage, 'legacy_collection_image_state', {}))
    ? { ...read(storage, 'legacy_collection_image_state', {}) }
    : {};
  const explicitlyRemoved = new Set(Array.isArray(read(storage, 'removed_conversation_image_refs', []))
    ? read(storage, 'removed_conversation_image_refs', []).map(text)
    : []);
  let refSequence = 0;

  function image(imageId) {
    const id = text(imageId);
    if (!id || typeof images?.get !== 'function') return null;
    return images.get(id);
  }

  function imageAsset(imageId) {
    const value = image(imageId);
    if (!value) return null;
    return {
      ...clone(value),
      imageId: text(value.imageId || value.id),
      displayName: text(value.displayName || value.name || value.filename, value.id),
      dataRef: text(value.dataRef || value.blobId || `rewrite-images/${value.id}.bin`)
    };
  }

  // Single-slot Vision authorization is deliberately explicit. Callers must
  // identify either a gallery reference or a conversation reference belonging
  // to the supplied session; the global Images map is never an authorization
  // source by itself.
  function authorizeVisionReference(reference = {}) {
    const kind = text(reference.kind).toLowerCase();
    const imageId = text(reference.imageId || reference.id);
    if (!imageId) return null;
    if (kind === 'conversation') {
      const sid = text(reference.sessionId);
      const rid = text(reference.refId);
      if (!sid) return null;
      const candidates = [...conversations.values()].filter(row => row.sessionId === sid && row.imageId === imageId && !row.deleted && (!rid || row.refId === rid));
      // An image ID is sufficient only when it resolves to one current-session
      // reference. Repeated references stay ambiguous until the caller gives
      // the exact refId.
      const item = candidates.length === 1 ? candidates[0] : null;
      return item && image(imageId) ? image(imageId) : null;
    }
    if (kind === 'library') {
      return gallery.has(imageId) && image(imageId) ? image(imageId) : null;
    }
    return null;
  }

  function normaliseGallery(value, index = 0) {
    const item = object(value) ? value : {};
    return {
      galleryId: text(item.galleryId, 'gallery_main'),
      imageId: text(item.imageId || item.id),
      displayName: text(item.displayName),
      displayOrder: Number.isFinite(Number(item.displayOrder)) ? Number(item.displayOrder) : index + 1,
      pinned: item.pinned === true,
      createdAt: text(item.createdAt, now())
    };
  }

  function normaliseConversation(value, index = 0) {
    const item = object(value) ? value : {};
    const sessionId = text(item.sessionId);
    const slotNo = Number.isFinite(Number(item.slotNo)) ? Number(item.slotNo) : index + 1;
    return {
      refId: text(item.refId, `conv_img_${Date.now().toString(36)}_${++refSequence}`),
      sessionId,
      imageId: text(item.imageId || item.id),
      slotNo,
      displayTitle: text(item.displayTitle),
      titleSource: text(item.titleSource, 'system'),
      source: text(item.source, 'upload'),
      ownership: item.ownership === 'shared-gallery' ? 'shared-gallery' : 'conversation-owned',
      messageId: text(item.messageId),
      candidateId: text(item.candidateId),
      pending: item.pending === true,
      sent: item.sent === true,
      selected: item.selected === true,
      final: item.final === true,
      createdAt: text(item.createdAt, now()),
      updatedAt: text(item.updatedAt, now())
    };
  }

  for (const [index, value] of (Array.isArray(read(storage, 'gallery_refs', [])) ? read(storage, 'gallery_refs', []) : []).entries()) {
    const item = normaliseGallery(value, index);
    if (item.imageId && image(item.imageId)) gallery.set(item.imageId, item);
  }
  for (const [index, value] of (Array.isArray(read(storage, 'conversation_image_refs', [])) ? read(storage, 'conversation_image_refs', []) : []).entries()) {
    const item = normaliseConversation(value, index);
    if (!item.sessionId || !item.imageId || !image(item.imageId)) continue;
    conversations.set(item.refId, item);
    counters[item.sessionId] = Math.max(Number(counters[item.sessionId]) || 0, item.slotNo);
  }

  function persist() {
    write(storage, 'gallery_refs', [...gallery.values()].map(clone));
    write(storage, 'conversation_image_refs', [...conversations.values()].map(clone));
    write(storage, 'conversation_image_slot_counters', clone(counters));
    write(storage, 'legacy_collection_image_state', clone(legacyCollectionState));
    write(storage, 'removed_conversation_image_refs', [...explicitlyRemoved]);
  }

  function session(sessionId) {
    return getSessions().find(item => item && text(item.id) === text(sessionId)) || null;
  }

  function allocateSlot(sessionId) {
    const id = text(sessionId);
    counters[id] = Math.max(Number(counters[id]) || 0, ...[...conversations.values()].filter(item => item.sessionId === id).map(item => item.slotNo), 0) + 1;
    return counters[id];
  }

  function listGallery(options2 = {}) {
    const order = text(options2.order, 'oldest').toLowerCase();
    const query = text(options2.query).toLowerCase();
    const selected = new Set(Array.isArray(options2.selectedIds) ? options2.selectedIds.map(text) : []);
    const rows = [...gallery.values()].filter(ref => {
      const asset = imageAsset(ref.imageId);
      if (!asset) return false;
      if (query && ![asset.imageId, asset.filename, asset.displayName, ref.displayName].some(value => text(value).toLowerCase().includes(query))) return false;
      return !selected.size || selected.has(ref.imageId);
    }).sort((a, b) => {
      const direction = order === 'newest' ? -1 : 1;
      return direction * ((a.displayOrder - b.displayOrder) || String(a.createdAt).localeCompare(String(b.createdAt)) || a.imageId.localeCompare(b.imageId));
    });
    return { items: rows.map(ref => ({ ...imageAsset(ref.imageId), displayName: text(ref.displayName, imageAsset(ref.imageId)?.displayName), galleryId: ref.galleryId, displayOrder: ref.displayOrder, pinned: ref.pinned, galleryCreatedAt: ref.createdAt })), total: rows.length };
  }

  function listConversation(sessionId, options2 = {}) {
    const id = text(sessionId);
    const rows = [...conversations.values()].filter(item => item.sessionId === id && (options2.includeDeleted || !item.deleted) && (options2.includePending !== false || !item.pending)).sort((a, b) => a.slotNo - b.slotNo || a.createdAt.localeCompare(b.createdAt));
    return { items: rows.map(clone), pendingIds: rows.filter(item => item.pending).map(item => item.refId) };
  }

  function attachToConversation(sessionId, imageId, meta = {}) {
    const sid = text(sessionId);
    const iid = text(imageId);
    if (!sid || !image(iid)) return null;
    const existing = [...conversations.values()].find(item => item.sessionId === sid && item.imageId === iid && !item.deleted);
    if (existing) return clone(existing);
    const timestamp = now();
    const item = normaliseConversation({
      refId: `conv_img_${Date.now().toString(36)}_${++refSequence}`,
      sessionId: sid,
      imageId: iid,
      slotNo: allocateSlot(sid),
      source: text(meta.source, 'upload'),
      ownership: text(meta.source).toLowerCase() === 'gallery' || meta.ownership === 'shared-gallery' || gallery.has(iid) && meta.source !== 'upload' ? 'shared-gallery' : 'conversation-owned',
      messageId: meta.messageId,
      candidateId: meta.candidateId,
      pending: meta.pending === true,
      sent: meta.sent === true,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    conversations.set(item.refId, item);
    // A later explicit attach is a new user-authorized relationship; clear a
    // prior remove tombstone so message reconciliation can see it again.
    explicitlyRemoved.delete(`${sid}|${iid}`);
    persist();
    return clone(item);
  }

  function referenceCount(imageId) {
    const id = text(imageId);
    const galleryCount = [...gallery.values()].filter(item => item.imageId === id).length;
    const conversationCount = [...conversations.values()].filter(item => item.imageId === id && !item.deleted).length;
    const messages = getSessions().flatMap(item => Array.isArray(item?.messages) ? item.messages : []).reduce((count, item) => count + (Array.isArray(item?.imageIds) ? item.imageIds.filter(value => text(value) === id).length : 0), 0);
    return { gallery: galleryCount, conversations: conversationCount, messages, total: galleryCount + conversationCount + messages };
  }

  function removePhysicalIfOrphaned(imageId) {
    if (referenceCount(imageId).total !== 0 || typeof images?.remove !== 'function') return false;
    return Boolean(images.remove(imageId));
  }

  function removeIfOrphaned(imageId) {
    const id = text(imageId);
    const references = referenceCount(id);
    if (!id || references.total !== 0 || !image(id)) return { removed: false, references };
    const removed = removePhysicalIfOrphaned(id);
    if (removed) {
      try { options.onReferenceRemoved?.({ kind: 'asset', imageId: id }); } catch { /* optional Vision adapter */ }
    }
    return { removed, references: referenceCount(id) };
  }

  function setPending(sessionId, refId, pending) {
    const item = conversations.get(text(refId));
    if (!item || item.sessionId !== text(sessionId)) return null;
    item.pending = pending === true;
    item.updatedAt = now();
    persist();
    return clone(item);
  }

  // Session titles belong to the conversation reference, never to the shared
  // ImageAsset/gallery record. Compact AI calls use this narrow adapter so a
  // title update cannot rename an image in another session or in the gallery.
  function setConversationTitle(sessionId, refId, displayTitle) {
    const sid = text(sessionId);
    const wanted = text(refId);
    if (!sid || !wanted) return { ok: false, code: 'IMAGE_SCOPE', error: '缺少当前会话图片引用' };
    const matches = [...conversations.values()].filter(item => item.sessionId === sid && !item.deleted && (
      item.refId === wanted || item.imageId === wanted || String(item.slotNo) === wanted || item.candidateId === wanted
    ));
    if (!matches.length) return { ok: false, code: 'IMAGE_SCOPE', error: '图片不在当前会话中' };
    if (matches.length > 1) return { ok: false, code: 'IMAGE_SCOPE', error: `图片引用不唯一：${matches.map(item => item.displayTitle || item.imageId).slice(0, 4).join('、')}` };
    const item = matches[0];
    item.displayTitle = text(displayTitle).slice(0, 40);
    item.titleSource = 'ai';
    item.updatedAt = now();
    persist();
    return clone(item);
  }

  function pendingConversationReferences(sessionId) {
    const id = text(sessionId);
    return [...conversations.values()]
      .filter(item => item.sessionId === id && !item.deleted && item.pending)
      .sort((a, b) => a.slotNo - b.slotNo || a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  function markSent(sessionId, refIds = []) {
    const id = text(sessionId);
    const wanted = Array.isArray(refIds) && refIds.length
      ? new Set(refIds.map(text))
      : new Set(pendingConversationReferences(id).map(item => item.refId));
    let updated = 0;
    for (const item of conversations.values()) {
      if (item.sessionId !== id || !wanted.has(item.refId) || item.deleted) continue;
      item.pending = false;
      item.sent = true;
      item.updatedAt = now();
      updated += 1;
    }
    if (updated) persist();
    return { updated, refs: pendingConversationReferences(id) };
  }

  function resetPending(sessionId) {
    const id = text(sessionId);
    let reset = 0;
    for (const item of conversations.values()) {
      if (item.sessionId !== id || item.deleted || !item.pending) continue;
      item.pending = false;
      item.updatedAt = now();
      reset += 1;
    }
    if (reset) persist();
    return { reset, refs: pendingConversationReferences(id) };
  }

  function removeFromConversation(sessionId, refId) {
    const id = text(refId);
    const item = conversations.get(id);
    if (!item || item.sessionId !== text(sessionId)) return { removed: false, imageStillReferenced: false };
    conversations.delete(id);
    explicitlyRemoved.add(`${item.sessionId}|${item.imageId}`);
    try { options.onReferenceRemoved?.({ kind: 'conversation', sessionId: item.sessionId, refId: item.refId, imageId: item.imageId }); } catch { /* optional Vision adapter */ }
    if (legacyCollectionState[item.imageId] === 'attached') legacyCollectionState[item.imageId] = 'removed';
    persist();
    const imageStillReferenced = referenceCount(item.imageId).total > 0;
    removePhysicalIfOrphaned(item.imageId);
    return { removed: true, imageStillReferenced };
  }

  function clearSessionContent(sessionId) {
    const target = session(sessionId);
    // Legacy/imported sessions may still carry imageIds only in messages.
    // Materialise those relationships before clearing the message body so the
    // user-visible conversation gallery remains reachable.
    reconcileSessionMessages(sessionId);
    const removedMessages = Array.isArray(target?.messages) ? target.messages.length : 0;
    if (target) {
      target.messages = [];
      target.updatedAt = Date.now();
      saveSessions(getSessions());
    }
    let resetPending = 0;
    let retainedImages = 0;
    for (const item of conversations.values()) {
      if (item.sessionId !== text(sessionId)) continue;
      retainedImages += 1;
      if (item.pending) resetPending += 1;
      item.pending = false;
      item.updatedAt = now();
    }
    persist();
    return { removedMessages, retainedImages, resetPending };
  }

  function promoteConversationImages(sessionId, refIds) {
    const wanted = Array.isArray(refIds) && refIds.length ? new Set(refIds.map(text)) : new Set([...conversations.values()].filter(item => item.sessionId === text(sessionId)).map(item => item.refId));
    const promoted = [];
    const skippedShared = [];
    for (const item of conversations.values()) {
      if (item.sessionId !== text(sessionId) || !wanted.has(item.refId)) continue;
      if (item.ownership === 'shared-gallery') { skippedShared.push(item.imageId); continue; }
      if (!gallery.has(item.imageId)) {
        const displayOrder = Math.max(0, ...[...gallery.values()].map(ref => Number(ref.displayOrder) || 0)) + 1;
        gallery.set(item.imageId, { galleryId: 'gallery_main', imageId: item.imageId, displayOrder, pinned: false, createdAt: now() });
      }
      item.ownership = 'shared-gallery';
      if (legacyCollectionState[item.imageId]) legacyCollectionState[item.imageId] = 'promoted';
      item.updatedAt = now();
      promoted.push(item.imageId);
    }
    persist();
    return { promoted: [...new Set(promoted)], skippedShared: [...new Set(skippedShared)] };
  }

  function deleteSession(sessionId, options2 = {}) {
    const sid = text(sessionId);
    const target = session(sid);
    if (!target) return { deletedMessages: 0, deletedImages: 0, promotedImages: 0 };
    reconcileSessionMessages(sid);
    const refs = [...conversations.values()].filter(item => item.sessionId === sid);
    const deletedMessages = Array.isArray(target.messages) ? target.messages.length : 0;
    const uniqueReferenced = [...new Map(refs.map(item => [item.imageId, item])).values()];
    let promotedImages = 0;
    if (options2.retainImages) promotedImages = promoteConversationImages(sid, refs.map(item => item.refId)).promoted.length;
    for (const item of refs) {
      conversations.delete(item.refId);
      try { options.onReferenceRemoved?.({ kind: 'conversation', sessionId: item.sessionId, refId: item.refId, imageId: item.imageId }); } catch { /* optional Vision adapter */ }
    }
    const allSessions = getSessions();
    if (Array.isArray(allSessions)) {
      const index = allSessions.indexOf(target);
      if (index >= 0) allSessions.splice(index, 1);
    }
    saveSessions(allSessions);
    if (!options2.retainImages) for (const item of refs) {
      if (legacyCollectionState[item.imageId] !== 'attached') continue;
      if (![...conversations.values()].some(ref => ref.imageId === item.imageId)) legacyCollectionState[item.imageId] = 'removed';
    }
    let deletedImages = 0;
    if (!options2.retainImages) for (const item of uniqueReferenced) if (removePhysicalIfOrphaned(item.imageId)) deletedImages += 1;
    persist();
    return { deletedMessages, deletedImages, promotedImages };
  }

  function renameGalleryImage(imageId, displayName) {
    const id = text(imageId);
    if (!gallery.has(id) || !image(id)) return null;
    const ref = gallery.get(id);
    ref.displayName = text(displayName, imageAsset(id)?.displayName || id);
    ref.updatedAt = now();
    persist();
    return { ...imageAsset(id), displayName: ref.displayName, imageId: id };
  }

  function addToGallery(imageId, meta = {}) {
    const id = text(imageId);
    if (!image(id)) return null;
    if (!gallery.has(id)) {
      const requestedOrder = Number(meta.displayOrder);
      const displayOrder = Number.isFinite(requestedOrder) && requestedOrder > 0
        ? requestedOrder
        : Math.max(0, ...[...gallery.values()].map(ref => Number(ref.displayOrder) || 0)) + 1;
      gallery.set(id, { galleryId: text(meta.galleryId, 'gallery_main'), imageId: id, displayName: text(meta.displayName), displayOrder, pinned: meta.pinned === true, createdAt: text(meta.createdAt, now()) });
    }
    persist();
    return imageAsset(id);
  }

  function removeFromGallery(imageId, options2 = {}) {
    const id = text(imageId);
    if (!gallery.delete(id)) return { removed: false, imageStillReferenced: referenceCount(id).total > 0 };
    try { options.onReferenceRemoved?.({ kind: 'library', imageId: id }); } catch { /* optional Vision adapter */ }
    persist();
    const references = referenceCount(id);
    const imageStillReferenced = references.total > 0;
    const purgeRequested = options2.purge === true;
    const purgeAllowed = purgeRequested && references.total === 0;
    if (purgeAllowed) removePhysicalIfOrphaned(id);
    else if (!purgeRequested && options2.retain !== true) removePhysicalIfOrphaned(id);
    return { removed: true, imageStillReferenced, references, purgeRequested, purgeAllowed, purged: purgeAllowed };
  }

  async function exportGalleryManifest() {
    const rows = listGallery({ order: 'oldest' }).items;
    const files = {};
    const items = [];
    const failed = [];
    for (const item of rows) {
      let bytes = await getOriginalBytes(item.imageId);
      if (!bytes && /^data:[^,]+,/.test(item.dataUrl || '')) {
        const payload = String(item.dataUrl).split(',')[1] || '';
        try { bytes = /;base64/i.test(String(item.dataUrl).split(',')[0]) ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload)); } catch { bytes = null; }
      }
      if (!bytes || !Buffer.from(bytes).length) { failed.push({ imageId: item.imageId, reason: 'missing-original-data' }); continue; }
      const fileName = `${item.imageId}.bin`;
      files[fileName] = Buffer.from(bytes).toString('base64');
      files[item.imageId] = files[fileName];
      items.push({
        imageId: item.imageId,
        filename: item.filename,
        displayName: item.displayName,
        mime: item.mime,
        source: item.source,
        width: item.width,
        height: item.height,
        metadata: clone(item.metadata),
        analysis: clone(item.analysis),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        displayOrder: item.displayOrder,
        galleryCreatedAt: item.galleryCreatedAt,
        pinned: item.pinned,
        dataFile: fileName,
        thumbnailDataUrl: item.thumbnailDataUrl || ''
      });
    }
    return {
      format: 'ai-tag-gallery',
      version: 1,
      exportedAt: now(),
      items,
      files,
      failed
    };
  }

  function importGalleryManifest(manifest) {
    const incoming = Array.isArray(manifest) ? manifest : manifest?.manifest?.items || manifest?.items;
    const files = manifest?.files || manifest?.manifest?.files || {};
    if (!Array.isArray(incoming)) return { imported: [], mapping: {}, collisions: [] };
    const imported = [];
    const mapping = {};
    const collisions = [];
    const failed = [];
    for (const raw of incoming) {
      if (!object(raw)) continue;
      const oldId = text(raw.imageId || raw.id);
      if (!oldId) continue;
      let nextId = oldId;
      if (image(nextId)) {
        let suffix = 1;
        while (image(`${oldId}-import-${suffix}`)) suffix += 1;
        nextId = `${oldId}-import-${suffix}`;
        collisions.push(oldId);
      }
      let dataUrl = text(raw.dataUrl);
      let bytes = null;
      const encoded = files[raw.dataFile || `${oldId}.bin`] || files[oldId];
      if (encoded) {
        try { bytes = Buffer.from(String(encoded), 'base64'); } catch { bytes = null; }
      }
      if (!bytes?.length && !dataUrl) { failed.push({ imageId: oldId, reason: 'missing-image-data' }); continue; }
      const asset = images?.add?.({
        id: nextId,
        filename: text(raw.filename, `${nextId}.png`),
        displayName: text(raw.displayName, raw.filename),
        mime: text(raw.mime, 'image/*'),
        source: text(raw.source, 'import'),
        width: raw.width,
        height: raw.height,
        metadata: clone(raw.metadata),
        analysis: clone(raw.analysis),
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        dataUrl,
        bytes,
        thumbnailDataUrl: text(raw.thumbnailDataUrl)
      });
      if (!asset) continue;
      addToGallery(nextId, { displayOrder: raw.displayOrder, createdAt: raw.galleryCreatedAt, pinned: raw.pinned, displayName: raw.displayName });
      mapping[oldId] = nextId;
      imported.push(nextId);
    }
    return { imported, mapping, collisions, failed };
  }

  async function getOriginalBytes(imageId) {
    const normalize = async value => {
      if (!value) return null;
      if (typeof value.arrayBuffer === 'function') {
        try { return Buffer.from(await value.arrayBuffer()); } catch { return null; }
      }
      try { return Buffer.from(value); } catch { return null; }
    };
    if (typeof images?.getBytes === 'function') {
      const bytes = await normalize(await images.getBytes(imageId));
      if (bytes) return bytes;
    }
    if (typeof images?.getBlob === 'function') return normalize(await images.getBlob(imageId));
    return null;
  }

  function migrateLegacy(options2 = {}) {
    const sessions = getSessions();
    if (!Array.isArray(sessions) || typeof images?.collectionIds !== 'function') return;
    const configuredCurrent = typeof options.currentSessionId === 'function' ? options.currentSessionId() : options.currentSessionId;
    const requestedCurrent = text(configuredCurrent || read(storage, 'current_session_id', ''));
    const defaultSession = sessions.some(item => text(item?.id) === requestedCurrent) ? requestedCurrent : text(sessions[0]?.id);
    const checkpoint = read(storage, 'image_repository_migrated_v1', false) === true;
    const sessionImportPending = read(storage, 'rewrite_migrated_v142', false) === true && read(storage, 'rewrite_sessions_migrated', false) !== true;
    const legacyCollectionIds = new Set([...(images.collectionIds('talk') || []), ...(images.collectionIds('comfy') || [])].map(text));
    if (checkpoint && !sessionImportPending) {
      const legacyIds = new Set([...(images.collectionIds('talk') || []), ...(images.collectionIds('comfy') || [])].map(text));
      for (const id of legacyIds) {
        if (legacyCollectionState[id]) continue;
        if (gallery.has(id)) legacyCollectionState[id] = 'promoted';
        else if ([...conversations.values()].some(ref => ref.imageId === id)) legacyCollectionState[id] = 'attached';
        else legacyCollectionState[id] = 'removed';
      }
    }
    const collectionEligible = id => {
      if (!image(id) || gallery.has(id)) {
        if (gallery.has(id)) legacyCollectionState[id] = 'promoted';
        return false;
      }
      return !checkpoint || !legacyCollectionState[id] || legacyCollectionState[id] === 'orphaned';
    };
    if (options2.collections !== false && defaultSession) for (const id of images.collectionIds('talk') || []) {
      if (!collectionEligible(id)) continue;
      const ref = attachToConversation(defaultSession, id, { source: 'upload' });
      if (ref) legacyCollectionState[id] = 'attached';
    }
    const messageSessionByImage = new Map();
    for (const item of sessions) for (const message of Array.isArray(item?.messages) ? item.messages : []) for (const id of Array.isArray(message?.imageIds) ? message.imageIds : []) if (!messageSessionByImage.has(text(id))) messageSessionByImage.set(text(id), { sessionId: text(item.id), message });
    for (const [id, match] of messageSessionByImage) {
      const ref = attachToConversation(match.sessionId, id, { source: 'message', messageId: match.message.id });
      if (ref && sessionImportPending && legacyCollectionIds.has(id) && !legacyCollectionState[id]) legacyCollectionState[id] = 'attached';
    }
    if (options2.collections !== false && defaultSession) {
      for (const id of images.collectionIds('comfy') || []) {
        if (!collectionEligible(id)) continue;
        const match = messageSessionByImage.get(text(id));
        if (match) {
          const ref = attachToConversation(match.sessionId, id, { source: 'comfy', messageId: match.message.id });
          if (ref) legacyCollectionState[id] = 'attached';
        } else if (addToGallery(id)) legacyCollectionState[id] = 'promoted';
      }
      if (!checkpoint) write(storage, 'image_repository_migrated_v1', true);
    }
    persist();
  }

  function reconcileSessions() {
    const validIds = new Set(getSessions().map(item => text(item?.id)).filter(Boolean));
    let removed = 0;
    const removedItems = [];
    for (const [refId, item] of conversations) {
      if (validIds.has(item.sessionId)) continue;
      conversations.delete(refId);
      removedItems.push(item);
      removed += 1;
    }
    for (const item of removedItems) {
      if (legacyCollectionState[item.imageId] !== 'attached') continue;
      if (gallery.has(item.imageId)) legacyCollectionState[item.imageId] = 'promoted';
      else if (![...conversations.values()].some(ref => ref.imageId === item.imageId)) legacyCollectionState[item.imageId] = 'orphaned';
    }
    for (const item of removedItems) {
      if (legacyCollectionState[item.imageId] === 'orphaned') continue;
      removePhysicalIfOrphaned(item.imageId);
    }
    if (removed) persist();
    return removed;
  }

  function reconcileSessionMessages(sessionId) {
    const target = session(sessionId);
    if (!target) return 0;
    let attached = 0;
    for (const message of Array.isArray(target.messages) ? target.messages : []) {
      for (const imageId of Array.isArray(message?.imageIds) ? message.imageIds : []) {
        const id = text(imageId);
        if (!id || !image(id)) continue;
        const exists = [...conversations.values()].some(item => item.sessionId === text(sessionId) && item.imageId === id && !item.deleted);
        if (explicitlyRemoved.has(`${text(sessionId)}|${id}`)) continue;
        if (exists) continue;
        if (attachToConversation(sessionId, id, { source: 'message', messageId: message.id })) attached += 1;
      }
    }
    return attached;
  }

  function finalizeMigration() {
    reconcileSessions();
    migrateLegacy({ collections: true });
    return { collectionsMigrated: read(storage, 'image_repository_migrated_v1', false) === true };
  }

  migrateLegacy({ collections: options.deferCollectionMigration !== true });

  return {
    listGallery,
    listConversation,
    attachToConversation,
    setPending,
    setConversationTitle,
    pendingConversationReferences,
    markSent,
    resetPending,
    removeFromConversation,
    clearSessionContent,
    deleteSession,
    renameGalleryImage,
    promoteConversationImages,
    referenceCount,
    removeIfOrphaned,
    addToGallery,
    removeFromGallery,
    authorizeVisionReference,
    exportGalleryManifest,
    importGalleryManifest,
    getOriginalBytes,
    migrateLegacy,
    reconcileSessions,
    reconcileSessionMessages,
    finalizeMigration
  };
}

module.exports = { createImageRepository };
