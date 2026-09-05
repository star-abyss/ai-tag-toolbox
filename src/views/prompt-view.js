'use strict';
/* Prompt editor for the four fixed slots plus user-created text entries. */
(function installPromptView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.prompt = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFactory() {
  const INTERNAL = ['primary', 'vision', 'translation', 'generateTags'];
  const LEGACY_IDS = { primary: '#aiSys', vision: '#aiVision', translation: '#translationPrompt', generateTags: '#genTask' };
  const labels = { primary: '主 AI', vision: '识图子代理', translation: '翻译子代理', generateTags: '文生图 Tag 子代理' };
  const text = (value, fallback = '') => value == null || value === '' ? fallback : String(value);
  function createPromptView({ document, prompts, notify, download, autoBind = true } = {}) {
    const doc = document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
    const q = selector => doc?.querySelector?.(selector);
    const slotKey = key => key === 'main' ? 'primary' : key === 'generate' ? 'generateTags' : key;
    const get = key => { const k = slotKey(key); try { return prompts?.get?.(k, '') || prompts?.getEffective?.(k) || prompts?.get?.(key, '') || ''; } catch { return ''; } };
    const item = key => { const k = slotKey(key); try { return prompts?.item?.(k) || {}; } catch { return {}; } };
    const set = (key, value) => { const k = slotKey(key); try { return prompts?.set?.(k, value) ?? prompts?.update?.(k, { text: value }) ?? value; } catch { return value; } };
    const snapshot = () => { try { return prompts?.snapshot?.() || {}; } catch { return {}; } };
    const customItems = () => { const snap = snapshot(); const rows = Array.isArray(snap) ? snap : snap?.custom || snap?.external || snap?.items || []; return rows.filter(row => row && !INTERNAL.includes(row.key || row.id)); };
    function ensureCustomHost() {
      let host = q('[data-custom-prompts]'); if (host) return host;
      const panel = q('#tabPrompt'); if (!panel) return null;
      host = doc.createElement('section'); host.className = 'promptcard custom-prompts'; host.dataset.customPrompts = 'true';
      const title = doc.createElement('h3'); title.textContent = '自定义提示词'; host.appendChild(title);
      const list = doc.createElement('div'); list.className = 'custom-prompt-list'; list.dataset.customPromptList = 'true'; host.appendChild(list);
      const add = doc.createElement('button'); add.type = 'button'; add.className = 'abtn btn btn-secondary'; add.dataset.action = 'prompt-add'; add.textContent = '新增提示词'; host.appendChild(add);
      panel.appendChild(host); return host;
    }
    function render(snapshot = snapshot()) {
      INTERNAL.forEach(key => { const config = LEGACY_IDS[key]; const el = config && q(config); if (el) el.value = get(key); const enabled = item(key)?.enabled !== false; const check = q(`${config}Enabled`); if (check) check.checked = enabled; });
      const host = ensureCustomHost(); const list = host?.querySelector?.('[data-custom-prompt-list]');
      if (list) {
        list.replaceChildren();
        customItems().forEach(row => {
          const id = text(row.id || row.key); const line = doc.createElement('div'); line.className = 'custom-prompt-row'; line.dataset.promptId = id;
          const name = doc.createElement('input'); name.value = text(row.name, id); name.dataset.field = 'name';
          const area = doc.createElement('textarea'); area.value = text(row.text || row.value); area.dataset.field = 'text';
          const save = doc.createElement('button'); save.type = 'button'; save.dataset.action = 'prompt-save'; save.textContent = '保存';
          const remove = doc.createElement('button'); remove.type = 'button'; remove.dataset.action = 'prompt-delete'; remove.textContent = '删除';
          line.append(name, area, save, remove); list.appendChild(line);
        });
      }
      return snapshot;
    }
    function saveInternal(key, value) { const result = set(key, value); render(); return result; }
    function exportBundle() {
      try { const value = prompts?.exportBundle?.() || JSON.stringify(snapshot(), null, 2); download?.('ai-tag-prompts.json', value); return value; } catch (error) { notify?.(error.message || String(error)); return ''; }
    }
    async function importBundle(value) {
      try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; const result = prompts?.importBundle?.(parsed); render(); return result; } catch (error) { notify?.(error.message || String(error)); return { ok: false, error: { code: 'PROMPT_IMPORT_FAILED', message: error.message || String(error) } }; }
    }
    function bind() {
      INTERNAL.forEach(key => { const el = q(LEGACY_IDS[key]); el?.addEventListener('change', () => saveInternal(key, el.value)); const check = q(`${LEGACY_IDS[key]}Enabled`); check?.addEventListener('change', () => { prompts?.setEnabled?.(key, check.checked); render(); }); });
      q('#promptModReset')?.addEventListener('click', () => { INTERNAL.forEach(key => prompts?.reset?.(key)); render(); });
      const host = ensureCustomHost();
      host?.addEventListener('click', event => {
        const action = event.target.closest?.('[data-action]')?.dataset.action;
        if (action === 'prompt-add') { const name = doc.defaultView?.prompt?.('提示词名称', '新提示词'); if (name?.trim()) { prompts?.createCustom?.({ name: name.trim(), text: '' }); render(); } }
        const row = event.target.closest?.('[data-prompt-id]'); if (!row) return; const id = row.dataset.promptId;
        if (action === 'prompt-save') prompts?.updateCustom?.(id, { name: row.querySelector('[data-field=name]')?.value, text: row.querySelector('[data-field=text]')?.value }) || prompts?.update?.(id, { name: row.querySelector('[data-field=name]')?.value, text: row.querySelector('[data-field=text]')?.value });
        if (action === 'prompt-delete') prompts?.deleteCustom?.(id);
        if (action === 'prompt-save' || action === 'prompt-delete') render();
      });
    }
    if (autoBind) bind();
    return { render, get, set, reset: key => prompts?.reset?.(slotKey(key)), keys: () => { try { return prompts?.keys?.() || INTERNAL; } catch { return INTERNAL.slice(); } }, snapshot, exportBundle, importBundle };
  }
  return { createPromptView, INTERNAL };
});
