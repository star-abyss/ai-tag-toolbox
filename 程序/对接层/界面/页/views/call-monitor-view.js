'use strict';

(function install(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.callMonitor = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFactory() {
  const pretty = value => JSON.stringify(value ?? null, null, 2);
  const names = { primary: '主 AI', api: '独立 API 请求', 'ai:vision': '副 AI・识图', 'ai:translation': '副 AI・翻译', 'ai:generateTags': '副 AI・文生图 Tag' };
  const statuses = { running: '进行中', completed: '完成', error: '失败', timeout: '超时', cancelled: '已取消', interrupted: '已中断' };
  function createCallMonitorView({ document: doc, assistant, notify, download, confirm, autoBind = true } = {}) {
    const win = doc.defaultView;
    const q = selector => doc.querySelector(selector);
    const service = assistant;
    let records = [], selected = '', filter = '', revision = -1, bound = false, timer, returnFocus;
    const source = () => service?.listCallRecords?.() || [];
    const filtered = () => records.filter(row => !filter || row.rootRequestId === filter);
    const label = row => names[row.kind] || String(row.kind || '调用').replace(/^tool:/, '工具 · ');
    function element(tag, className, text) {
      const el = doc.createElement(tag); el.className = className;
      if (text != null) el.textContent = String(text);
      return el;
    }
    function duration(row) {
      const value = Number(row?.durationMs);
      if (Number.isFinite(value) && value >= 0) return Math.round(value);
      const started = Number(row?.startedAt);
      const ended = row?.endedAt == null ? Date.now() : Number(row.endedAt);
      return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.round(ended - started)) : 0;
    }
    function usageLabel(usage) {
      if (!usage || typeof usage !== 'object') return 'Token 未返回';
      if (usage.total_tokens != null) return `Token ${usage.total_tokens}`;
      const prompt = usage.prompt_tokens;
      const completion = usage.completion_tokens;
      if (prompt != null || completion != null) return `Token ${prompt ?? 0} + ${completion ?? 0}`;
      return 'Token 未返回';
    }
    function detail(row) {
      const box = element('div', 'call-record-detail');
      box.append(element('div', 'call-record-meta', `请求：${row.requestId || '未知'} · 根请求：${row.rootRequestId || row.requestId || '未知'} · 上级：${row.parentRequestId || '无'} · 会话：${row.sessionId || '独立调用'}`));
      const grid = element('dl', 'call-record-summary');
      const fields = [
        ['调用类型', label(row)],
        ['工具', row.tool || row.kind || '未指定'],
        ['状态', statuses[row.status] || row.status || '未知'],
        ['耗时', `${duration(row)} ms`],
        ['模型', row.model || '未指定'],
        ['API 调用', row.apiCalls == null ? '0' : row.apiCalls],
        ['HTTP', row.httpStatus == null ? '未返回' : row.httpStatus],
        ['用量', usageLabel(row.usage)],
        ['会话消息', row.messageId || '无'],
        ['生成任务', row.jobId || '无']
      ];
      for (const [name, value] of fields) {
        grid.append(element('dt', '', name), element('dd', '', value));
      }
      box.append(grid);
      if (row.usageScope) box.append(element('p', 'hint', `用量范围：${row.usageScope}`));
      if (row.error) {
        const error = typeof row.error === 'object' ? [row.error.code, row.error.message].filter(Boolean).join('：') : String(row.error);
        box.append(element('p', 'call-record-error', `错误：${error || '调用失败'}`));
      }
      if (row.truncated) box.append(element('p', 'hint', '这条摘要超过容量限制，部分字段已截断。'));
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
      q('#callMonitorRetention').textContent = info.persistenceError || `自动刷新；最多保留 ${info.maxRecords || 200} 条摘要 / ${Math.round((info.maxBytes || 512 * 1024) / 1024)} KiB。${info.dropped ? ` 已淘汰 ${info.dropped} 条。` : ''}复制和导出采用当前筛选。`;
      const host = q('#callMonitorList');
      const scroll = host.scrollTop;
      const previous = q('.call-record-detail');
      const openSections = previous ? [...previous.querySelectorAll('details')].map(node => node.open) : [];
      host.replaceChildren();
      if (!rows.length) { host.append(element('p', 'call-monitor-empty', '暂无记录。发送 AI 消息后可在此查看调用摘要。')); return records; }
      if (!rows.some(row => row.requestId === selected)) selected = (rows.find(row => row.kind === 'primary') || rows[0]).requestId;
      for (const row of rows) {
        const article = element('article', 'call-record');
        const button = element('button', 'call-record-heading'); button.type = 'button'; button.dataset.requestId = row.requestId;
        button.setAttribute('aria-expanded', String(row.requestId === selected));
        const elapsed = duration(row);
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
      return { format: 'ai-tag-call-monitor', version: 2, exportedAt: new Date().toISOString(), filter: filter || null, info: service?.getCallMonitorInfo?.() || {}, records: rows };
    }
    function exportJson() { const data = payload(); if (download) download(`ai-call-summary-${Date.now()}.json`, data); return data; }
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
