'use strict';
/* Prompt editor: main prompt sets (fixed 5-item structure, batch switch) plus extension prompts (main-AI only). */
(function installPromptView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.prompt = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFactory() {
  const ITEM_KEYS = ['primary', 'generateTags', 'artistQuality', 'vision', 'translation'];
  const ITEM_IDS = { primary: 'psPrimary', generateTags: 'psGenerateTags', artistQuality: 'psArtistQuality', vision: 'psVision', translation: 'psTranslation' };
  const ITEM_RESET_IDS = { primary: 'psPrimaryReset', generateTags: 'psGenerateTagsReset', artistQuality: 'psArtistQualityReset', vision: 'psVisionReset', translation: 'psTranslationReset' };
  const text = (value, fallback = '') => value == null || value === '' ? fallback : String(value);

  function createPromptView({ document, prompts, notify, download, autoBind = true } = {}) {
    const doc = document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
    const q = selector => doc?.querySelector?.(selector);
    const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
    const snapshot = () => safe(() => prompts?.snapshot?.() || {}, {});
    const setList = () => safe(() => prompts?.sets?.() || [], []);
    const activeId = () => safe(() => prompts?.activeSetId?.() || '', '');
    const get = key => safe(() => prompts?.get?.(key, '') || '', '');
    const activeName = () => { const id = activeId(); const found = setList().find(row => row.id === id); return text(found?.name, '默认提示词'); };

    function renderSetSelector() {
      const select = q('#promptSetSel');
      if (!select) return;
      const current = activeId();
      select.replaceChildren();
      for (const row of setList()) {
        const option = doc.createElement('option');
        option.value = row.id;
        option.textContent = text(row.name, row.id);
        if (row.id === current) option.selected = true;
        select.appendChild(option);
      }
      const badge = q('#promptSetBadge');
      if (badge) badge.textContent = text(current, '未选择');
    }
    function renderItems() {
      for (const key of ITEM_KEYS) {
        const area = q('#' + ITEM_IDS[key]);
        if (area) area.value = get(key);
      }
      const info = q('#promptSetInfo');
      if (info) info.textContent = '当前提示词组：「' + activeName() + '」—— 切换提示词组时 5 个条目一起切换；单独修改条目内容会保存在当前提示词组中。';
    }
    function iconForMode(mode) {
      return mode === 'keywords' ? '关键词' : '常驻';
    }
    function renderExtensions() {
      const host = q('#extList');
      if (!host) return;
      host.replaceChildren();
      const rows = safe(() => prompts?.extensions?.() || [], []);
      rows.forEach(row => {
        const id = text(row.id);
        const activation = row.activation && typeof row.activation === 'object' ? row.activation : { mode: 'always', keywords: [] };
        const mode = activation.mode === 'keywords' ? 'keywords' : 'always';
        const card = doc.createElement('div');
        card.className = 'ext-row';
        card.dataset.extId = id;
        const head = doc.createElement('div');
        head.className = 'ext-head';
        const nameInput = doc.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'ext-name';
        nameInput.dataset.field = 'name';
        nameInput.value = text(row.name, id);
        nameInput.placeholder = '扩展提示词名称';
        const enabledLabel = doc.createElement('label');
        enabledLabel.className = 'opt prompt-enabled';
        const enabledInput = doc.createElement('input');
        enabledInput.type = 'checkbox';
        enabledInput.dataset.field = 'enabled';
        enabledInput.checked = row.enabled !== false;
        const enabledWord = doc.createElement('span');
        enabledWord.textContent = '启用';
        enabledLabel.append(enabledInput, enabledWord);
        const modeSelect = doc.createElement('select');
        modeSelect.className = 'ext-mode';
        modeSelect.dataset.field = 'mode';
        const alwaysOpt = doc.createElement('option');
        alwaysOpt.value = 'always';
        alwaysOpt.textContent = '常驻';
        const keywordOpt = doc.createElement('option');
        keywordOpt.value = 'keywords';
        keywordOpt.textContent = '关键词匹配';
        modeSelect.append(alwaysOpt, keywordOpt);
        modeSelect.value = mode;
        const keywordInput = doc.createElement('input');
        keywordInput.type = 'text';
        keywordInput.className = 'ext-keywords';
        keywordInput.dataset.field = 'keywords';
        keywordInput.placeholder = '关键词，逗号分隔（如：角色替换, 换角色）';
        keywordInput.value = Array.isArray(activation.keywords) ? activation.keywords.join(', ') : '';
        keywordInput.hidden = mode !== 'keywords';
        const save = doc.createElement('button');
        save.type = 'button';
        save.className = 'abtn btn btn-secondary';
        save.dataset.action = 'ext-save';
        save.textContent = '保存';
        const remove = doc.createElement('button');
        remove.type = 'button';
        remove.className = 'abtn ghost danger btn btn-danger';
        remove.dataset.action = 'ext-delete';
        remove.textContent = '删除';
        head.append(nameInput, enabledLabel, modeSelect, keywordInput, save, remove);
        const body = doc.createElement('textarea');
        body.className = 'ext-text';
        body.dataset.field = 'text';
        body.rows = 4;
        body.value = text(row.text);
        body.placeholder = '扩展提示词内容（只发送给主 AI）';
        card.append(head, body);
        host.appendChild(card);
      });
      const empty = q('#extEmpty');
      if (empty) empty.hidden = rows.length > 0;
    }
    function render(nextSnapshot) {
      renderSetSelector();
      renderItems();
      renderExtensions();
      return nextSnapshot || snapshot();
    }

    function saveExtension(rowNode) {
      const id = rowNode.dataset.extId;
      const field = name => rowNode.querySelector('[data-field=' + name + ']')?.value ?? '';
      const enabled = rowNode.querySelector('[data-field=enabled]')?.checked !== false;
      const mode = rowNode.querySelector('[data-field=mode]')?.value === 'keywords' ? 'keywords' : 'always';
      const keywords = String(field('keywords')).split(/[,，、;；\n]+/).map(item => item.trim()).filter(Boolean);
      const result = safe(() => prompts?.updateExtension?.(id, { name: field('name'), text: field('text'), enabled, activation: { mode, keywords } }), null);
      render();
      return result;
    }
    function exportBundle(filename) {
      try {
        const value = prompts?.exportBundle?.() || snapshot();
        const serialized = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        const name = text(filename, 'ai-tag-prompts.json');
        if (download) download(name, serialized);
        else {
          const link = doc.createElement('a');
          link.href = URL.createObjectURL(new Blob([serialized], { type: 'application/json' }));
          link.download = name;
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 500);
        }
        return value;
      } catch (error) {
        notify?.(error.message || String(error));
        return '';
      }
    }
    function exportExtensions(filename) {
      try {
        const value = prompts?.exportExtensions?.() || { format: 'ai-tag-prompt-extensions', version: 1, extensions: [] };
        const serialized = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        const name = text(filename, 'ai-tag-prompt-extensions.json');
        if (download) download(name, serialized);
        else {
          const link = doc.createElement('a');
          link.href = URL.createObjectURL(new Blob([serialized], { type: 'application/json' }));
          link.download = name;
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 500);
        }
        return value;
      } catch (error) {
        notify?.(error.message || String(error));
        return '';
      }
    }
    function importFile(input, apply) {
      const file = input?.files?.[0];
      if (!file) return;
      file.text().then(async raw => {
        try {
          const parsed = JSON.parse(raw);
          const result = await apply(parsed);
          const setsCount = Array.isArray(result?.sets) ? result.sets.length : 0;
          const extCount = result?.count != null ? result.count : Array.isArray(result?.extensions) ? result.extensions.length : 0;
          notify?.(`导入完成：提示词组 ${setsCount} 个 / 扩展提示词 ${extCount} 条`);
        } catch (error) {
          notify?.(error.message || String(error));
        } finally {
          input.value = '';
        }
      }).catch(error => notify?.(error.message || String(error)));
    }
    function bind() {
      // 主提示词组：批量切换。
      q('#promptSetSel')?.addEventListener('change', event => {
        const id = event.target.value;
        const switched = safe(() => prompts?.setActive?.(id), false);
        if (switched === true) { render(); notify?.('已切换提示词组'); }
      });
      q('#promptSetAdd')?.addEventListener('click', () => {
        const name = doc.defaultView?.prompt?.('新提示词组名称', '提示词组 ' + (setList().length + 1));
        if (!name?.trim()) return;
        const created = safe(() => prompts?.createSet?.({ name: name.trim() }), null);
        render();
        notify?.(`已创建提示词组「${created?.name || name.trim()}」（5 个空白条目，选中后才生效）`);
      });
      q('#promptSetRename')?.addEventListener('click', () => {
        const current = activeName();
        const name = doc.defaultView?.prompt?.('提示词组名称', current);
        if (!name?.trim() || name.trim() === current) return;
        const renamed = safe(() => prompts?.renameSet?.(activeId(), name.trim()), null);
        render();
        notify?.(`已重命名为「${renamed?.name || name.trim()}」`);
      });
      q('#promptSetDelete')?.addEventListener('click', () => {
        const current = activeId();
        if (setList().length <= 1) { notify?.('至少保留一个提示词组'); return; }
        const answer = doc.defaultView?.confirm?.(`删除提示词组「${activeName()}」？其 5 个条目内容将一并删除，且不可恢复。`);
        if (answer !== true) return;
        const removed = safe(() => prompts?.deleteSet?.(current), false);
        render();
        if (removed === true) notify?.('提示词组已删除');
      });
      q('#promptSetReset')?.addEventListener('click', () => {
        const answer = doc.defaultView?.confirm?.('将当前提示词组的 5 个条目恢复为素材默认内容？');
        if (answer !== true) return;
        const reset = safe(() => prompts?.resetSet?.(activeId()), null);
        render();
        if (reset) notify?.('当前提示词组已恢复为默认内容');
      });
      // 主提示词组：5 个条目内容编辑（条目结构不允许增删）。
      ITEM_KEYS.forEach(key => {
        const area = q('#' + ITEM_IDS[key]);
        area?.addEventListener('change', () => { safe(() => prompts?.set?.(key, area.value), null); });
        q('#' + ITEM_RESET_IDS[key])?.addEventListener('click', () => { safe(() => prompts?.resetItem?.(key), null); renderItems(); });
      });
      // 批量导入导出。
      q('#pcolExport')?.addEventListener('click', () => exportBundle('ai-tag-prompts.json'));
      q('#pcolImport')?.addEventListener('click', () => q('#pcolFile')?.click());
      q('#pcolFile')?.addEventListener('change', event => importFile(event.target, parsed => safe(() => prompts?.importBundle?.(parsed), null)));
      // 扩展提示词。
      q('#extAdd')?.addEventListener('click', () => {
        const created = safe(() => prompts?.createExtension?.({ name: '扩展提示词', text: '', enabled: true, activation: { mode: 'always', keywords: [] } }), null);
        render();
        if (created?.id) notify?.(`已新增扩展提示词「${created.name}」`);
      });
      q('#extExport')?.addEventListener('click', () => exportExtensions('ai-tag-prompt-extensions.json'));
      q('#extImport')?.addEventListener('click', () => q('#extFile')?.click());
      q('#extFile')?.addEventListener('change', event => importFile(event.target, parsed => safe(() => prompts?.importExtensions?.(parsed), null)));
      q('#extList')?.addEventListener('click', event => {
        const action = event.target.closest?.('[data-action]')?.dataset.action;
        const row = event.target.closest?.('[data-ext-id]');
        if (!row) return;
        if (action === 'ext-save') { const saved = saveExtension(row); if (saved) notify?.(`已保存扩展提示词「${saved.name}」`); else notify?.('保存失败'); }
        if (action === 'ext-delete') {
          const answer = doc.defaultView?.confirm?.('删除这条扩展提示词？');
          if (answer !== true) return;
          const removed = safe(() => prompts?.deleteExtension?.(row.dataset.extId), false);
          render();
          if (removed === true) notify?.('扩展提示词已删除');
        }
      });
      q('#extList')?.addEventListener('change', event => {
        const mode = event.target.closest?.('[data-field=mode]');
        if (mode) {
          const row = event.target.closest?.('[data-ext-id]');
          const keywords = row?.querySelector?.('[data-field=keywords]');
          if (keywords) keywords.hidden = mode.value !== 'keywords';
        }
      });
    }
    if (autoBind) bind();
    return {
      render,
      bind,
      get,
      set: (key, value) => safe(() => prompts?.set?.(key, value), value),
      reset: key => safe(() => prompts?.resetItem?.(key), null),
      keys: () => ITEM_KEYS.slice(),
      snapshot,
      exportBundle,
      exportExtensions,
      importBundle: value => safe(() => prompts?.importBundle?.(value), null)
    };
  }
  return { createPromptView, ITEM_KEYS };
});