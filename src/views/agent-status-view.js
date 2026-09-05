'use strict';
/* Unified request status surface. */
(function installAgentStatusView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.agentStatus = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFactory() {
  const text = (value, fallback = '') => value == null || value === '' ? fallback : String(value);
  function createAgentStatusView({ document, runtime, api, notify, autoBind = true } = {}) {
    const doc = document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
    const q = selector => doc?.querySelector?.(selector);
    const state = { requestId: '', status: 'idle', error: null, tool: '', startedAt: 0 };
    function normalize(status = {}) { const error = status.error; return { ...status, status: text(status.status, status.pending ? 'running' : 'idle'), error: error ? (typeof error === 'string' ? { code: 'REQUEST_FAILED', message: error } : error) : null }; }
    function render(snapshot = {}) {
      Object.assign(state, normalize(snapshot));
      const host = q('[data-agent-status]') || q('#agentStatus') || q('#talkStatus');
      if (host) { host.textContent = state.error?.message || (state.tool ? `${state.status} · ${state.tool}` : state.status); host.dataset.status = state.status; host.classList.toggle('is-error', Boolean(state.error)); }
      const stop = q('[data-agent-cancel]') || q('#talkStopBtn'); if (stop) stop.hidden = !['running', 'pending', 'streaming'].includes(state.status);
      return { ...state };
    }
    function status(requestId = state.requestId) { try { return normalize(runtime?.getStatus?.(requestId) || api?.getStatus?.(requestId) || state); } catch { return { ...state }; } }
    function cancel(requestId = state.requestId) { const result = runtime?.cancel?.(requestId) ?? api?.cancel?.(requestId) ?? false; render({ requestId, status: 'cancelled' }); notify?.('已取消'); return result; }
    function bind() { (q('[data-agent-cancel]') || q('#talkStopBtn'))?.addEventListener('click', () => cancel()); }
    if (autoBind) bind();
    return { render, status, cancel, bind, getState: () => ({ ...state }) };
  }
  return { createAgentStatusView };
});
