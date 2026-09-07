'use strict';

(function install(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.callMonitor = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFactory() {
  const pretty = value => JSON.stringify(value ?? null, null, 2);
  const names = { primary: '主 AI', api: '独立 API 请求', 'subagent:vision': '识图子代理', 'subagent:translation': '翻译子代理', 'subagent:generateTags': '文生图 Tag 子代理' };
  const statuses = { running: '进行中', completed: '完成', error: '失败', timeout: '超时', cancelled: '已取消', interrupted: '已中断' };
  function createCallMonitorView({ document: doc, assistant, runtime, notify, download, confirm, autoBind = true } = {}) {
    const win = doc.defaultView;
    const q = selector => doc.querySelector(selector);
    const service = assistant?.listCallRecords ? assistant : runtime;
    let records = [], selected = '', filter = '', revision = -1, bound = false, timer, returnFocus;
    const source = () => service?.listCallRecords?.() || [];
    const filtered = () => records.filter(row => !filter || row.rootRequestId === filter);
    const label = row => names[row.kind] || String(row.kind || '调用').replace(/^tool:/, '工具 · ');
    function element(tag, className, text) {
      const el = doc.createElement(tag); el.className = className;
      if (text != null) el.textContent = String(text);
      return el;
    }
    function detail(row) {
      const box = element('div', 'call-record-detail');
      box.append(element('div', 'call-record-meta', `请求：${row.requestId} · 上级：${row.parentRequestId || '无'} · 会话：${row.sessionId || '独立调用'}`));
      if (row.truncated) box.append(element('p', 'hint', '这条记录超过容量限制，部分内容已截断。'));
      function section(title, payload, open = false) {
        const fold = element('details', 'call-record-section'); fold.open = open;
        fold.append(element('summary', '', title), element('pre', '', pretty(payload)));
        box.append(fold);
      }
      section('调用输入', row.input);
      section('处理后的输出', row.output, true);
      if (row.error) section('错误', row.error, true);
      for (const [index, exchange] of (row.exchanges || []).entries()) {
        const ms = Math.max(0, (exchange.endedAt || Date.now()) - exchange.startedAt);
        const tokens = exchange.usage?.total_tokens;
        box.append(element('h4', '', `API 第 ${index + 1} 次 · ${exchange.request?.body?.model || '未指定模型'} · ${statuses[exchange.status] || exchange.status} · ${ms} ms · Token ${tokens == null ? '未返回' : tokens}`));
        section('实际请求（系统提示词、消息与参数）', exchange.request);
        section('接口原始返回（含解析前文本）', exchange.response);
        if (exchange.error) section('接口错误', exchange.error, true);
      }
      section('运行事件', row.events);
      return box;
    }
    function render(value = source()) {
      records = Array.isArray(value) ? value : [];
      const info = service?.getCallMonitorInfo?.() || {};
      revision = info.revision ?? revision;
      const roots = [...new Set(records.map(row => row.rootRequestId || row.requestId))].reverse();
      if (filter && !roots.includes(filter)) filter = '';
      const select = q('#callMonitorFilter');
      if (select) {
        select.replaceChildren();
        const all = element('option', '', '全部请求'); all.value = ''; select.append(all);
        for (const id of roots) { const option = element('option', '', id); option.value = id; select.append(option); }
        select.value = filter;
      }
      const rows = filtered().slice().reverse();
      q('#callMonitorCount').textContent = `${rows.length} / ${records.length} 条调用`;
      q('#callMonitorRetention').textContent = info.persistenceError || `自动刷新；最多保留 200 条调用 / 12 MB，过长记录会标记截断。${info.dropped ? ` 已淘汰 ${info.dropped} 条。` : ''}复制和导出采用当前筛选。`;
      const host = q('#callMonitorList');
      const scroll = host.scrollTop;
      const previous = q('.call-record-detail');
      const openSections = previous ? [...previous.querySelectorAll('details')].map(node => node.open) : [];
      host.replaceChildren();
      if (!rows.length) { host.append(element('p', 'call-monitor-empty', '暂无记录。发送 AI 消息后可在此检查调用内容。')); return records; }
      if (!rows.some(row => row.requestId === selected)) selected = (rows.find(row => row.kind === 'primary') || rows[0]).requestId;
      for (const row of rows) {
        const article = element('article', 'call-record');
        const button = element('button', 'call-record-heading'); button.type = 'button'; button.dataset.requestId = row.requestId;
        button.setAttribute('aria-expanded', String(row.requestId === selected));
        const elapsed = Math.max(0, (row.endedAt || Date.now()) - row.startedAt);
        button.append(element('strong', '', label(row)), element('span', 'call-record-status', statuses[row.status] || row.status), element('code', '', row.requestId), element('span', 'call-record-duration', `${elapsed} ms`));
        article.append(button);
        if (row.requestId === selected) {
          const content = detail(row);
          content.querySelectorAll('details').forEach((node, i) => { if (openSections[i] !== undefined) node.open = openSections[i]; });
          article.append(content);
        }
        host.append(article);
      }
      host.scrollTop = scroll;
      return records;
    }
    function refresh() { try { render(); } catch { notify?.('读取调用记录失败'); } }
    function tick() {
      if (!q('#callMonitorModal').classList.contains('show')) { timer = null; return; }
      const next = service?.getCallMonitorInfo?.()?.revision;
      if (next == null || next !== revision) refresh();
      timer = win.setTimeout(tick, 750);
    }
    function open() {
      returnFocus = doc.activeElement;
      const modal = q('#callMonitorModal'); modal.classList.add('show'); modal.setAttribute('aria-hidden', 'false');
      refresh(); q('#callMonitorClose')?.focus(); win.clearTimeout(timer); tick();
    }
    function close() {
      q('#callMonitorModal').classList.remove('show'); q('#callMonitorModal').setAttribute('aria-hidden', 'true');
      win.clearTimeout(timer); timer = null; returnFocus?.focus?.();
    }
    function clear() {
      const action = () => { service?.clearCallRecords?.(); selected = ''; refresh(); notify?.('调用日志已清空'); };
      if (confirm) confirm('确定清空全部调用日志？对话和图片会保留。', action);
      else if (win.confirm('确定清空全部调用日志？')) action();
    }
    function payload() {
      const rows = source().filter(row => !filter || row.rootRequestId === filter);
      return { format: 'ai-tag-call-monitor', version: 1, exportedAt: new Date().toISOString(), filter: filter || null, info: service?.getCallMonitorInfo?.() || {}, records: rows };
    }
    function exportJson() { const data = payload(); if (download) download(`ai-call-monitor-${Date.now()}.json`, data); return data; }
    async function copyJson() {
      try {
        if (!win.navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
        await win.navigator.clipboard.writeText(pretty(payload())); notify?.('调试日志已复制'); return true;
      } catch { notify?.('复制失败，请使用导出日志'); return false; }
    }
    function bind() {
      if (bound) return; bound = true;
      q('#openCallMonitor')?.addEventListener('click', open);
      q('#talkCallMonitor')?.addEventListener('click', open);
      q('#callMonitorClose')?.addEventListener('click', close);
      q('#callMonitorRefresh')?.addEventListener('click', refresh);
      q('#callMonitorCopy')?.addEventListener('click', copyJson);
      q('#callMonitorExport')?.addEventListener('click', exportJson);
      q('#callMonitorClear')?.addEventListener('click', clear);
      q('#callMonitorFilter')?.addEventListener('change', event => { filter = event.target.value; selected = ''; refresh(); });
      q('#callMonitorList')?.addEventListener('click', event => {
        const id = event.target.closest('[data-request-id]')?.dataset.requestId;
        if (id) { selected = id; q('.call-record-detail')?.remove(); render(records); }
      });
      const modal = q('#callMonitorModal');
      modal?.addEventListener('click', event => { if (event.target === modal) close(); });
      modal?.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === 'Tab') {
          const items = [...modal.querySelectorAll('button, select, summary')].filter(node => !node.disabled);
          if (event.shiftKey && doc.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
          else if (!event.shiftKey && doc.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
        }
      });
    }
    if (autoBind) bind();
    return { render, refresh, open, close, clear, exportJson, copyJson, bind };
  }
  return { createCallMonitorView };
});
