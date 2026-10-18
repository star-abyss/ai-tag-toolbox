'use strict';
(function install(root, factory) {
  const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {}; root.AppViews.favoritesTransfer = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function factory() {
  function createFavoritesTransferView({ document: doc, favorites, host, getIncludeAdult = () => true, beforeMutation = async () => true, onChanged = () => {}, notify = () => {} }) {
    const win = doc.defaultView, selected = new Set(); let root, panel, dialog, preview = null, busy = false, revision = null, operation = null, returnFocus = null, destroyed = false, page = 0, query = '', scope = '', snapshot = null;
    const operationId = () => `transfer:${win.crypto?.randomUUID?.() || `${Date.now()}:${Math.random()}`}`;
    const node = (tag, text) => { const item = doc.createElement(tag); if (text !== undefined) item.textContent = text; return item; };
    const control = (tag, key, text) => { const item = node(tag, text); item.dataset[key] = ''; return item; };
    const button = (action, text, icon) => { const item = node('button'); item.type = 'button'; item.dataset.transferAction = action; item.title = text; item.setAttribute('aria-label', text); if (icon) { const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = doc.createElementNS('http://www.w3.org/2000/svg', 'use'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('favorite-icon'); use.setAttribute('href', `../assets/icons/favorites.svg#${icon}`); svg.append(use); item.append(svg); } else item.textContent = text; return item; };
    const option = (value, text) => { const item = node('option', text); item.value = value; return item; };
    const select = (key, values) => { const item = control('select', key); values.forEach(([value, text]) => item.append(option(value, text))); return item; };
    const labeled = (text, input) => { const label = node('label', text); label.append(input); return label; };
    const $ = selector => root?.querySelector(selector);
    function message(value) { const status = $('[data-transfer-status]'); if (status) status.textContent = value || ''; }
    function setBusy(value) { busy = value; root?.querySelectorAll('button, input, select, textarea').forEach(item => { item.disabled = value; }); if (!value) updateCount(); }
    function build() {
      root = node('section'); root.className = 'favorite-transfer-tools'; root.setAttribute('aria-label', '收藏搜索和整理');
      const toolbar = node('div'); toolbar.className = 'favorite-transfer-toolbar';
      const search = control('input', 'transferSearch'); search.type = 'search'; search.placeholder = '搜索收藏'; search.setAttribute('aria-label', '搜索收藏'); search.value = query;
      const pages = select('transferScope', [['', '全部收藏页'], ...favorites.series().map(row => [row.id, row.name])]); pages.value = scope;
      toolbar.append(search, pages, button('manage', '批量整理', 'folder'), button('import', '导入 JSON / gzip', 'upload'), button('paste', '粘贴导入'), button('export-favorites', '导出收藏'), button('export-all', '导出全库'), button('report', '迁移报告'), button('undo', '撤销', 'undo-2'), button('redo', '重做', 'redo-2'));
      const file = control('input', 'transferFile'); file.type = 'file'; file.accept = '.json,.json.gz,application/json,application/gzip'; file.hidden = true; toolbar.append(file);
      panel = control('div', 'transferPanel'); panel.hidden = true; panel.className = 'favorite-transfer-panel';
      const batch = select('transferBatch', [['reference', '复制引用'], ['independent', '另存独立'], ['move', '移动'], ['unfavorite', '取消收藏'], ['show-search', '允许搜索'], ['hide-search', '禁止搜索'], ['adult', '标记成人'], ['general', '取消成人标记'], ['pin', '置顶'], ['unpin', '取消置顶'], ['color', '设置所在页颜色'], ['auto-color', '自动分配所在页颜色']]);
      const destination = select('transferDestination', []); const color = control('input', 'transferColor'); color.type = 'color'; color.value = '#287ea4';
      const count = control('span', 'transferCount'); const actions = node('div'); actions.className = 'favorite-transfer-batch';
      actions.append(button('select-all', '选择全部匹配结果'), button('clear', '清空选择'), count, labeled('操作', batch), labeled('目标位置', destination), labeled('颜色', color), button('batch', '应用'));
      panel.append(actions, control('div', 'transferResults'), button('previous', '上一页'), control('span', 'transferPage'), button('next', '下一页'));
      dialog = control('div', 'transferDialog'); dialog.className = 'favorite-dialog'; dialog.hidden = true; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', '收藏导入与迁移报告');
      const content = node('div'); content.className = 'favorite-dialog-panel favorite-transfer-dialog';
      const heading = control('h3', 'transferHeading', '导入预览'); const body = control('div', 'transferBody'); const previewNode = control('div', 'transferPreview'); const status = control('p', 'transferStatus'); status.setAttribute('role', 'status');
      const footer = node('div'); footer.className = 'favorite-dialog-actions'; footer.append(button('cancel', '取消'), button('apply', '确认导入'));
      content.append(heading, body, previewNode, status, footer); dialog.append(content);
      root.append(toolbar, panel, dialog); host.querySelector('[data-favorite-health]')?.before(root); if (!root.isConnected) host.prepend(root);
      root.addEventListener('click', click); root.addEventListener('input', input); root.addEventListener('change', change); root.addEventListener('keydown', keydown);
      refreshDestinations(); updateCount();
    }
    function refreshDestinations() {
      const target = $('[data-transfer-destination]'); if (!target) return; const previous = target.value; target.replaceChildren();
      for (const row of favorites.series()) for (const group of favorites.sections(row.id)) target.append(option(JSON.stringify([row.id, group.id]), `${row.name} / ${group.name}`));
      if ([...target.options].some(row => row.value === previous)) target.value = previous;
    }
    function refreshScopes() {
      const target = $('[data-transfer-scope]'); if (!target) return; const pages = favorites.series();
      if (scope && !pages.some(row => row.id === scope)) { scope = ''; page = 0; }
      target.replaceChildren(option('', '全部收藏页'), ...pages.map(row => option(row.id, row.name))); target.value = scope;
    }
    function settings(offset = 0) { return { ...(scope ? { seriesId: scope } : {}), includeAdult: getIncludeAdult() !== false, offset, limit: 100 }; }
    function resultPage(offset = 0, limit = 100) { return query.trim() ? favorites.search(query, { ...settings(offset), limit }) : favorites.list({ ...settings(offset), limit }); }
    function rowsToIds(row) {
      return row.favoriteLocations ? row.favoriteLocations.filter(location => !scope || location.pageId === scope).map(location => location.membershipId) : [row.id];
    }
    function renderResults() {
      const result = resultPage(page * 100), container = $('[data-transfer-results]'); if (!container) return;
      container.replaceChildren();
      for (const row of result.items) {
        const label = node('label'); label.className = 'favorite-transfer-result'; const box = node('input'); box.type = 'checkbox'; box.dataset.transferMembers = JSON.stringify(rowsToIds(row)); box.checked = rowsToIds(row).every(id => selected.has(id)); box.setAttribute('aria-label', `整理 ${row.title || row.rawText}`);
        const text = node('span', row.title || row.rawText); const location = node('small', row.favoriteLocations?.filter(item => !scope || item.pageId === scope).map(item => `${item.pageName}/${item.groupName}`).join('、') || `${favorites.series().find(item => item.id === row.seriesId)?.name || ''}/${favorites.sections(row.seriesId).find(item => item.id === row.sectionId)?.name || ''}`);
        label.append(box, text, location); container.append(label);
      }
      $('[data-transfer-page]').textContent = `${result.total} 条 · 第 ${page + 1} 页`;
      $('[data-transfer-action="previous"]').disabled = busy || page === 0; $('[data-transfer-action="next"]').disabled = busy || !result.hasMore;
      updateCount();
    }
    function updateCount() { const count = $('[data-transfer-count]'); if (count) count.textContent = `已冻结 ${selected.size} 个归属`; const apply = $('[data-transfer-action="batch"]'); if (apply) apply.disabled = busy || !selected.size; const history = favorites.historyState(); for (const key of ['undo', 'redo']) { const item = $(`[data-transfer-action="${key}"]`); if (item) item.disabled = busy || !history[key === 'undo' ? 'canUndo' : 'canRedo']; } }
    function freeze(ids) { if (!selected.size) { revision = favorites.revision(); operation = null; } ids.forEach(id => selected.add(id)); updateCount(); }
    function selectAll() { const all = []; let offset = 0, result; do { result = resultPage(offset, 2000); for (const row of result.items) all.push(...rowsToIds(row)); offset += result.items.length; } while (result.hasMore && result.items.length); freeze(all); renderResults(); }
    function clear() { selected.clear(); revision = null; operation = null; updateCount(); }
    function open(title) { if (busy) return; if (preview) favorites.cancelImportPreview(preview.id); preview = null; snapshot = null; returnFocus = doc.activeElement; dialog.hidden = false; $('[data-transfer-heading]').textContent = title; $('[data-transfer-body]').replaceChildren(); $('[data-transfer-preview]').replaceChildren(); message(''); $('[data-transfer-action="apply"]').hidden = true; $('[data-transfer-action="cancel"]').focus(); }
    function cancel() { if (busy) return false; if (preview) favorites.cancelImportPreview(preview.id); preview = null; snapshot = null; dialog.hidden = true; returnFocus?.isConnected && returnFocus.focus(); return true; }
    function showPreview(result) {
      if (!result?.ok) { message(result?.error?.message || '预览失败'); return; }
      preview = result.data; snapshot = { operationId: operationId(), expectedRevision: preview.basedOnRevision };
      const container = $('[data-transfer-preview]'); container.replaceChildren(node('p', `新增 ${preview.counts.added} · 复用 ${preview.counts.reused} · 冲突独立保留 ${preview.counts.conflicts} · 待处理 ${preview.counts.invalid}`));
      if (preview.details) container.append(node('p', `新增归属 ${preview.details.membershipsAdded} · 复用归属 ${preview.details.membershipsReused} · 保留外来关系 ${preview.details.relationsPreserved}`));
      const list = node('ul'); for (const text of preview.warnings) list.append(node('li', text)); container.append(list); $('[data-transfer-action="apply"]').hidden = false; message('');
    }
    function openPaste() {
      open('粘贴导入'); const body = $('[data-transfer-body]');
      const text = control('textarea', 'transferPasteText'); text.rows = 8; text.setAttribute('aria-label', '原始标签文本');
      const format = select('transferPasteFormat', [['lines', '逐行'], ['tsv', 'TSV']]), kind = select('transferPasteKind', [['tag', '单标签'], ['bundle', '组合']]);
      const target = select('transferPasteDestination', [...$('[data-transfer-destination]').options].map(row => [row.value, row.textContent]));
      body.append(labeled('内容', text), labeled('格式', format), labeled('类型', kind), labeled('位置', target), button('preview-paste', '预览')); text.focus();
    }
    async function importFile(file) {
      if (!file) return; if (file.size > 32 * 1024 * 1024) { notify('备份超过 32 MiB 文件限制'); return; }
      if (!await beforeMutation()) return; open('导入备份'); setBusy(true);
      try { const buffer = typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : await new Promise((resolve, reject) => { const reader = new win.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsArrayBuffer(file); }); if (!destroyed) showPreview(favorites.previewImportFile(new Uint8Array(buffer))); }
      catch { message('无法读取备份文件'); } finally { setBusy(false); }
    }
    function download(result) {
      if (!result?.ok) { notify(result?.error?.message || '导出失败'); return; }
      const { bytes, mimeType, filename } = result.data; const blob = new win.Blob([new Uint8Array(bytes)], { type: mimeType });
      if (!win.URL?.createObjectURL) { notify('当前环境不支持文件下载'); return; }
      const url = win.URL.createObjectURL(blob), anchor = node('a'); anchor.href = url; anchor.download = filename; doc.body.append(anchor); anchor.click(); anchor.remove(); win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
    }
    async function runBatch() {
      if (!selected.size || !await beforeMutation()) return;
      const ids = [...selected], mode = $('[data-transfer-batch]').value; let target = null;
      try { target = JSON.parse($('[data-transfer-destination]').value || 'null'); } catch { /* missing destination remains invalid */ }
      const command = { ids, mode, target, color: $('[data-transfer-color]').value };
      const signature = JSON.stringify(command); if (!operation || operation.signature !== signature) operation = { signature, options: { operationId: operationId(), expectedRevision: revision } };
      if (['reference', 'independent', 'move'].includes(mode) && !target) { notify('请选择目标收藏页和组'); return; }
      setBusy(true); let result;
      try {
        if (['reference', 'independent'].includes(mode)) result = await favorites.duplicateEntries({ ids, mode, seriesId: target[0], sectionId: target[1] }, operation.options);
        else if (mode === 'move') result = await favorites.applyBatch({ ids, patch: { seriesId: target[0], sectionId: target[1] } }, operation.options);
        else if (mode === 'unfavorite') result = await favorites.deleteEntries(ids, operation.options);
        else if (mode === 'color' || mode === 'auto-color') result = await favorites.setSeriesColors([...new Set(ids.map(id => favorites.getEntry(id)?.seriesId).filter(Boolean))], { mode: mode === 'color' ? 'custom' : 'auto', color: command.color }, operation.options);
        else result = await favorites.applyBatch({ ids, patch: mode === 'pin' || mode === 'unpin' ? { pinned: mode === 'pin' } : mode === 'adult' || mode === 'general' ? { adult: mode === 'adult' } : { searchable: mode === 'show-search' } }, operation.options);
        if (result?.ok) { clear(); onChanged(); } else notify(result?.error?.code === 'REVISION_CONFLICT' ? '库已改变，请清空并重新选择后重试' : result?.error?.message || '批量操作失败');
      } catch { notify('批量操作失败，未确认保存'); } finally { setBusy(false); renderResults(); }
    }
    function report() {
      open('迁移报告'); const data = favorites.getMigrationReport(); const body = $('[data-transfer-body]'); if (!data) return;
      body.append(node('p', `关联 ${data.counts.linked} · 独立保留 ${data.counts.independent} · 已保留档案 ${data.counts.archive} · 保留说明 ${data.counts.retained} · 需处理 ${data.counts.actionable}`));
      const list = node('dl'); for (const [reason, count] of Object.entries(data.reasons)) list.append(node('dt', reason), node('dd', String(count))); body.append(list, button('export-report', '导出全部原始记录'));
    }
    async function click(event) {
      const action = event.target.closest('[data-transfer-action]')?.dataset.transferAction; if (!action || busy) return; event.stopPropagation();
      if (action === 'manage') { panel.hidden = !panel.hidden; if (!panel.hidden) renderResults(); }
      else if (action === 'select-all') selectAll(); else if (action === 'clear') { clear(); renderResults(); }
      else if (action === 'previous' || action === 'next') { page = Math.max(0, page + (action === 'next' ? 1 : -1)); renderResults(); }
      else if (action === 'batch') await runBatch();
      else if (action === 'import') { if (await beforeMutation()) $('[data-transfer-file]').click(); }
      else if (action === 'paste') { if (await beforeMutation()) openPaste(); }
      else if (action === 'preview-paste') { let target; try { target = JSON.parse($('[data-transfer-paste-destination]').value); } catch { message('请选择已有收藏位置'); return; } showPreview(favorites.previewPaste($('[data-transfer-paste-text]').value, { format: $('[data-transfer-paste-format]').value, kind: $('[data-transfer-paste-kind]').value, seriesId: target[0], sectionId: target[1] })); }
      else if (action === 'cancel') cancel();
      else if (action === 'apply' && preview) { setBusy(true); try { const result = await favorites.importBundle(preview.id, snapshot); if (result.ok) { preview = null; setBusy(false); cancel(); onChanged(); } else message(result.error.message); } catch { message('导入保存失败，可重试'); } finally { setBusy(false); } }
      else if (action === 'export-favorites' || action === 'export-all') download(favorites.exportFile({ scope: action === 'export-all' ? 'all' : 'favorites' }));
      else if (action === 'report') report(); else if (action === 'export-report') download(favorites.exportMigrationFile());
      else if (action === 'undo' || action === 'redo') { if (!await beforeMutation()) return; setBusy(true); try { const result = await favorites[action](); if (!result?.ok) notify(result?.error?.message || '操作失败'); else { clear(); onChanged(); } } finally { setBusy(false); renderResults(); } }
    }
    function input(event) { if (event.target.matches('[data-transfer-search]')) { query = event.target.value; page = 0; panel.hidden = false; renderResults(); } else if (preview && event.target.closest('[data-transfer-body]')) { favorites.cancelImportPreview(preview.id); preview = null; $('[data-transfer-action="apply"]').hidden = true; $('[data-transfer-preview]').replaceChildren(); } }
    function change(event) {
      if (event.target.matches('[data-transfer-scope]')) { scope = event.target.value; page = 0; panel.hidden = false; renderResults(); }
      else if (event.target.matches('[data-transfer-members]')) { const ids = JSON.parse(event.target.dataset.transferMembers); if (event.target.checked) freeze(ids); else ids.forEach(id => selected.delete(id)); updateCount(); }
      else if (event.target.matches('[data-transfer-file]')) { void importFile(event.target.files?.[0]); event.target.value = ''; }
      else input(event);
    }
    function keydown(event) {
      if (dialog.hidden) return; event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); cancel(); }
      if (event.key === 'Tab') { const controls = [...dialog.querySelectorAll('button,input,textarea,select')].filter(item => !item.hidden && !item.disabled); const first = controls[0], last = controls.at(-1); if (event.shiftKey && doc.activeElement === first) { last?.focus(); event.preventDefault(); } else if (!event.shiftKey && doc.activeElement === last) { first?.focus(); event.preventDefault(); } }
    }
    function refresh() { if (destroyed) return; if (!root?.isConnected && root) { host.querySelector('[data-favorite-health]')?.before(root); if (!root.isConnected) host.prepend(root); } refreshDestinations(); refreshScopes(); updateCount(); if (!panel.hidden) renderResults(); }
    function destroy() { destroyed = true; if (preview) favorites.cancelImportPreview(preview.id); root?.remove(); }
    build();
    return { refresh, destroy, requestClose: () => busy ? false : cancel(), importFile };
  }
  return { createFavoritesTransferView };
});
