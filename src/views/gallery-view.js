'use strict';
/* Gallery view: image repository access stays behind the public repository API. */
(function installGalleryView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.gallery = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFactory() {
  const text = (value, fallback = '') => value == null || value === '' ? fallback : String(value);
  function createGalleryView({ document, repository, images, preferences, notify, onVision, onConversation, autoBind = true } = {}) {
    const doc = document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
    const state = { order: 'oldest', query: '', selected: new Set() };
    const q = selector => doc?.querySelector?.(selector);
    const read = (key, fallback) => { try { return preferences?.get?.(key, fallback) ?? fallback; } catch { return fallback; } };
    const write = (key, value) => { try { preferences?.set?.(key, value); } catch { /* optional */ } };
    const list = () => {
      try {
        const value = repository?.listGallery?.({ order: state.order, query: state.query });
        return Array.isArray(value) ? value : value?.items || [];
      } catch { return []; }
    };
    const sourceFor = item => {
      try {
        const value = images?.preview?.(item.imageId || item.id) || images?.get?.(item.imageId || item.id) || item;
        return value?.thumbnailDataUrl || value?.dataUrl || value?.viewUrl || value?.previewUrl || '';
      } catch { return ''; }
    };
    function render(options = {}) {
      if (options.order) state.order = options.order === 'newest' ? 'newest' : 'oldest';
      if (options.query != null) state.query = String(options.query || '').trim();
      const host = q('[data-gallery-view]') || q('#galleryGrid');
      if (!host) return { items: list(), selected: [...state.selected] };
      const rows = list();
      state.selected = new Set([...state.selected].filter(id => rows.some(item => text(item.imageId || item.id) === id)));
      host.replaceChildren();
      if (!rows.length) {
        const empty = doc.createElement('div'); empty.className = 'gallery-empty'; empty.textContent = '图片库为空'; host.appendChild(empty);
      }
      rows.forEach(item => {
        const id = text(item.imageId || item.id); const name = text(item.displayName || item.filename || id, '未命名图片');
        const card = doc.createElement('article'); card.className = `gallery-card${state.selected.has(id) ? ' is-selected' : ''}`; card.dataset.imageId = id;
        const title = doc.createElement('div'); title.className = 'gallery-name'; title.textContent = name; title.title = name;
        const wrap = doc.createElement('div'); wrap.className = 'gallery-thumb-wrap';
        const img = doc.createElement('img'); img.className = 'gallery-thumb'; img.loading = 'lazy'; img.alt = name; img.src = sourceFor(item); wrap.appendChild(img);
        const actions = doc.createElement('div'); actions.className = 'gallery-actions';
        [['vision', '识图'], ['conversation', '发送'], ['download', '下载'], ['rename', '重命名'], ['delete', '删除']].forEach(([action, label]) => { const button = doc.createElement('button'); button.type = 'button'; button.className = `gb gb-${action}`; button.dataset.action = action; button.textContent = label; actions.appendChild(button); });
        card.append(title, wrap, actions); host.appendChild(card);
      });
      const count = q('#galleryCount'); if (count) count.textContent = `${rows.length} 张`;
      const order = q('#galleryOrder'); if (order) order.value = state.order;
      const query = q('#galleryQuery'); if (query && query.value !== state.query) query.value = state.query;
      const send = q('#gallerySend'); if (send) send.disabled = !state.selected.size;
      const del = q('#galleryDelete'); if (del) del.disabled = !state.selected.size;
      const download = q('#galleryDownload'); if (download) download.disabled = !state.selected.size;
      return { items: rows, selected: [...state.selected] };
    }
    function selectedItems() { const ids = state.selected; return list().filter(item => ids.has(text(item.imageId || item.id))); }
    function select(id, value) { const key = text(id); if (value === false) state.selected.delete(key); else if (value === true) state.selected.add(key); else state.selected.has(key) ? state.selected.delete(key) : state.selected.add(key); render(); return [...state.selected]; }
    function sendSelected() {
      const rows = selectedItems(); let target = null;
      try { target = repository?.currentSession?.() || repository?.session?.() || null; } catch { target = null; }
      rows.forEach(item => { try { repository?.attachToConversation?.(target?.id, item.imageId || item.id, { source: 'gallery' }); } catch { /* optional */ } });
      onConversation?.(rows, target); state.selected.clear(); render(); return rows;
    }
    function removeSelected() { const rows = selectedItems(); rows.forEach(item => { try { repository?.removeFromGallery?.(item.imageId || item.id); } catch { /* optional */ } }); state.selected.clear(); render(); return rows; }
    function bind() {
      const host = q('[data-gallery-view]') || q('#galleryGrid');
      host?.addEventListener('click', event => { const card = event.target.closest?.('[data-image-id]'); if (!card) return; const id = card.dataset.imageId; const action = event.target.closest?.('[data-action]')?.dataset.action; if (!action) return select(id); const item = list().find(row => text(row.imageId || row.id) === id); if (action === 'vision') return onVision?.(item); if (action === 'conversation') { select(id, true); return sendSelected(); } if (action === 'delete') return removeSelected(); if (action === 'rename') { const value = doc.defaultView?.prompt?.('重命名', text(item?.displayName || item?.filename)); if (value?.trim()) { repository?.renameGalleryImage?.(id, value.trim()); render(); } } if (action === 'download') { const value = item?.dataUrl || sourceFor(item); if (value) { const link = doc.createElement('a'); link.href = value; link.download = text(item?.filename, `${id}.png`); link.click(); } } });
      q('#galleryOrder')?.addEventListener('change', event => { state.order = event.target.value === 'newest' ? 'newest' : 'oldest'; write('gallery.order', state.order); render(); });
      q('#galleryQuery')?.addEventListener('input', event => { state.query = String(event.target.value || '').trim(); render(); });
      q('#gallerySend')?.addEventListener('click', () => sendSelected());
      q('#galleryDelete')?.addEventListener('click', () => removeSelected());
      q('#galleryDownload')?.addEventListener('click', () => selectedItems().forEach(item => { const value = item?.dataUrl || sourceFor(item); if (!value) return; const link = doc.createElement('a'); link.href = value; link.download = text(item.filename, `${item.imageId || item.id}.png`); link.click(); }));
      state.order = read('gallery.order', 'oldest') === 'newest' ? 'newest' : 'oldest';
    }
    if (autoBind) bind();
    return { render, list, selectedItems, select, sendSelected, removeSelected, getState: () => ({ order: state.order, query: state.query, selected: [...state.selected] }) };
  }
  return { createGalleryView };
});
