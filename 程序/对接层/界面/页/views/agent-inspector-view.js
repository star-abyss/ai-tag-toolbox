'use strict';

(function install(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.agentInspector = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFactory() {
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const text = (value, fallback = '') => value == null || value === '' ? fallback : String(value);
  function createAgentInspectorView({ document: doc, assistant, notify, download, autoBind = true } = {}) {
    const win = doc?.defaultView;
    const q = selector => doc?.querySelector?.(selector);
    let selected = '';
    let records = [];
    let returnFocus = null;
    let bound = false;
    function element(tag, className, value = '') {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (value !== undefined && value !== null) node.textContent = String(value);
      return node;
    }
    function json(value) { return JSON.stringify(value ?? null, null, 2); }
    function source() { return Array.isArray(assistant?.listAgentRuns?.()) ? assistant.listAgentRuns() : []; }
    function record() { return records.find(item => item.requestId === selected) || records[0] || null; }
    function addJson(host, title, value) {
      const details = element('details', 'agent-inspector-section'); details.open = true;
      details.append(element('summary', '', title));
      details.append(element('pre', 'agent-inspector-pre', json(value)));
      host.append(details);
    }
    function detail(row) {
      const host = element('div', 'agent-inspector-detail');
      const plan = row?.plan || {};
      const sections = Array.isArray(plan.sections) ? plan.sections : [];
      const sectionBox = element('section', 'agent-inspector-section');
      sectionBox.append(element('h4', '', '有效提示词 sections'));
      if (!sections.length) sectionBox.append(element('p', 'hint', '本次记录没有提示词 sections。'));
      for (const section of sections) {
        const item = element('article', 'agent-inspector-prompt');
        item.append(element('strong', '', `${text(section.key, '未命名')} · ${text(section.source, 'unknown')}`));
        if (section.editable && section.key !== 'request.system') {
          item.append(element('pre', 'agent-inspector-pre', text(section.text)));
          item.append(element('p', 'hint', '编辑当前提示词（仅影响后续请求）'));
          const editor = doc.createElement('textarea'); editor.className = 'agent-inspector-editor'; editor.value = text(assistant?.promptRegistry?.get?.(section.key)?.text ?? section.text); editor.dataset.promptKey = section.key;
          const save = element('button', 'abtn btn btn-secondary agent-inspector-save', '保存这段提示词'); save.type = 'button'; save.dataset.promptKey = section.key;
          item.append(editor, save);
        } else item.append(element('pre', 'agent-inspector-pre', text(section.text)));
        sectionBox.append(item);
      }
      host.append(sectionBox);
      addJson(host, '最终 messages', plan.messages || []);
      addJson(host, '可见 tools', plan.tools || []);
      addJson(host, '运行上下文', plan.runtimeContext || {});
      addJson(host, 'Provider 配置（已脱敏）', plan.providerConfig || {});
      addJson(host, '模型响应', row.response || null);
      if (row.error) addJson(host, '错误', row.error);
      const events = element('section', 'agent-inspector-section');
      events.append(element('h4', '', '调度时间线'));
      for (const event of Array.isArray(row.events) ? row.events : []) {
        const item = element('article', 'agent-inspector-event');
        item.append(element('strong', '', `${event.seq ?? ''} · ${text(event.type, 'event')}`));
        item.append(element('pre', 'agent-inspector-pre', json(event.payload || event)));
        events.append(item);
      }
      host.append(events);
      return host;
    }
    function render(value = source()) {
      records = Array.isArray(value) ? value : [];
      const select = q('#agentInspectorRun');
      if (select) {
        select.replaceChildren();
        for (const row of records) {
          const option = element('option', '', `${row.requestId} · ${row.status || 'unknown'}`);
          option.value = row.requestId; select.append(option);
        }
        if (selected && records.some(row => row.requestId === selected)) select.value = selected;
        else { selected = records[0]?.requestId || ''; select.value = selected; }
      }
      const row = record();
      const host = q('#agentInspectorList');
      if (host) { host.replaceChildren(); if (row) host.append(detail(row)); else host.append(element('p', 'agent-inspector-empty', '暂无完整 Agent 运行记录。')); }
      const count = q('#agentInspectorCount'); if (count) count.textContent = `${records.length} 条完整记录`;
      return row ? clone(row) : null;
    }
    function refresh() { return render(); }
    function open(requestId = '') {
      returnFocus = doc.activeElement;
      selected = requestId || selected;
      const modal = q('#agentInspectorModal'); modal?.classList.add('show'); modal?.setAttribute('aria-hidden', 'false');
      refresh(); q('#agentInspectorClose')?.focus();
    }
    function close() {
      const modal = q('#agentInspectorModal'); modal?.classList.remove('show'); modal?.setAttribute('aria-hidden', 'true'); returnFocus?.focus?.();
    }
    function exportJson() {
      const row = record();
      if (row && download) download(`agent-run-${row.requestId}.json`, row);
      return clone(row);
    }
    function resetPrompts() {
      const result = assistant?.promptRegistry?.resetAll?.();
      notify?.('提示词已恢复默认');
      refresh();
      return result;
    }
    function savePrompt(key, value) {
      const result = assistant?.promptRegistry?.set?.(key, String(value ?? ''));
      notify?.(`已保存提示词：${key}`);
      refresh();
      return result;
    }
    function bind() {
      if (bound) return; bound = true;
      q('#openAgentInspector')?.addEventListener('click', () => open());
      q('#agentInspectorClose')?.addEventListener('click', close);
      q('#agentInspectorExport')?.addEventListener('click', exportJson);
      q('#agentInspectorReset')?.addEventListener('click', resetPrompts);
      q('#agentInspectorList')?.addEventListener('click', event => {
        const button = event.target.closest?.('.agent-inspector-save');
        if (!button) return;
        const editor = [...(q('#agentInspectorList')?.querySelectorAll('textarea[data-prompt-key]') || [])].find(item => item.dataset.promptKey === button.dataset.promptKey);
        savePrompt(button.dataset.promptKey, editor?.value || '');
      });
      q('#agentInspectorRun')?.addEventListener('change', event => { selected = event.target.value; render(records); });
      const modal = q('#agentInspectorModal');
      modal?.addEventListener('click', event => { if (event.target === modal) close(); });
      modal?.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
    }
    if (autoBind) bind();
    return { render, refresh, open, close, exportJson, resetPrompts, savePrompt, bind };
  }
  return { createAgentInspectorView };
});
