'use strict';

/* Browser-safe conversation view. Assistant/Runtime owns data and persistence;
 * this module only renders sessions/messages and translates DOM actions into
 * public calls. It works as both a CommonJS module and a browser script. */
(function installConversationView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.conversation = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFactory() {
  const text = (value, fallback = '') => value == null || value === '' ? fallback : String(value);
  const safeError = error => {
    if (!error) return { code: 'UNKNOWN', message: '请求失败' };
    if (typeof error === 'string') return { code: 'REQUEST_FAILED', message: error };
    return { code: text(error.code, 'REQUEST_FAILED'), message: text(error.message, text(error.error, '请求失败')) };
  };
  function createConversationView({ document, api, runtime, notify, preferences, onRoute, autoBind = true } = {}) {
    const doc = document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
    const state = { requestId: '', pending: false, columns: 'two' };
    const q = selector => doc?.querySelector?.(selector);
    const sessions = () => {
      try { return typeof api?.sessions === 'function' ? api.sessions() || [] : Array.isArray(api?.sessions) ? api.sessions : []; } catch { return []; }
    };
    const current = () => {
      try { return api?.currentSession?.() || sessions()[0] || null; } catch { return sessions()[0] || null; }
    };
    const getSettings = () => { try { return api?.getSettings?.() || {}; } catch { return {}; } };
    const savePreference = (key, value) => { try { preferences?.set?.(key, value); } catch { /* optional */ } };
    const readPreference = (key, fallback) => { try { return preferences?.get?.(key, fallback) ?? fallback; } catch { return fallback; } };
    function renderSessions() {
      const host = q('[data-session-list]') || q('#talkSessionList');
      if (!host) return;
      host.replaceChildren();
      const active = current();
      sessions().forEach(session => {
        const row = doc.createElement('div');
        row.className = `tsession${active?.id === session.id ? ' active' : ''}`;
        row.dataset.sessionId = text(session.id);
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        const title = doc.createElement('span');
        title.className = 'ttitle';
        title.textContent = text(session.title, '新对话');
        const del = doc.createElement('button');
        del.type = 'button'; del.className = 'tdel btn btn-icon btn-danger';
        del.dataset.action = 'delete-session'; del.textContent = '🗑️'; del.title = '删除这条对话';
        row.append(title, del); host.appendChild(row);
      });
    }
    function renderMessages(snapshot = {}) {
      const host = q('[data-conversation-view]') || q('#talkConv');
      if (!host) return;
      const session = current();
      host.replaceChildren();
      if (!session?.messages?.length) {
        const empty = doc.createElement('div'); empty.className = 'cmsg sys';
        const body = doc.createElement('div'); body.className = 'body';
        body.textContent = '输入内容后发送；图片会自动编号并交给 Images 模块。';
        empty.appendChild(body); host.appendChild(empty); return;
      }
      session.messages.forEach(message => {
        const row = doc.createElement('article');
        row.className = `cmsg ${message.role === 'assistant' ? 'ai' : message.role === 'error' ? 'err' : message.role === 'system' ? 'sys' : 'user'}`;
        row.dataset.messageId = text(message.id);
        const body = doc.createElement('div'); body.className = 'body';
        body.textContent = text(message.text, message.status === 'streaming' ? '🤔 AI 正在思考…' : '');
        row.appendChild(body);
        if (message.error || message.status === 'error') {
          const error = doc.createElement('small'); error.className = 'message-error';
          error.textContent = safeError(message.error).message; row.appendChild(error);
        }
        if (Array.isArray(message.toolCalls) && message.toolCalls.length) {
          const trace = doc.createElement('details'); trace.className = 'tooltrace';
          const summary = doc.createElement('summary'); summary.textContent = `🔧 工具调用（${message.toolCalls.length}）`;
          const list = doc.createElement('ul');
          message.toolCalls.forEach(call => { const item = doc.createElement('li'); item.textContent = `${text(call.name, 'tool')} · ${call.result?.ok === false ? '失败' : '完成'}`; list.appendChild(item); });
          trace.append(summary, list); row.appendChild(trace);
        }
        if (message.role === 'user' || message.role === 'assistant') {
          const actions = doc.createElement('div'); actions.className = 'cacts cmsg-actions-row';
          const copy = doc.createElement('button'); copy.type = 'button'; copy.dataset.action = 'copy-message'; copy.textContent = '复制';
          const edit = doc.createElement('button'); edit.type = 'button'; edit.dataset.action = 'edit-message'; edit.textContent = '编辑';
          actions.append(copy, edit);
          if (message.role === 'assistant' && message.status !== 'streaming') { const retry = doc.createElement('button'); retry.type = 'button'; retry.dataset.action = 'retry-message'; retry.textContent = '重试'; actions.appendChild(retry); }
          row.appendChild(actions);
        }
        host.appendChild(row);
      });
      if (state.pending || snapshot.pending) host.scrollTop = host.scrollHeight;
    }
    function render(snapshot = {}) {
      if (snapshot.requestId) state.requestId = snapshot.requestId;
      state.pending = Boolean(snapshot.pending ?? state.pending);
      renderMessages(snapshot); renderSessions();
      const status = q('[data-agent-status]') || q('#talkStatus');
      if (status && snapshot.status) status.textContent = text(snapshot.status);
      return { session: current(), sessions: sessions(), pending: state.pending, ...snapshot };
    }
    async function send(input = {}, config = {}) {
      const payload = typeof input === 'string' ? { text: input } : { ...input };
      const value = text(payload.text).trim();
      const imageIds = Array.isArray(payload.imageIds) ? payload.imageIds.filter(Boolean) : [];
      if (!value && !imageIds.length) return { ok: false, error: { code: 'EMPTY_INPUT', message: '请输入内容或添加图片' } };
      const requestId = text(payload.requestId, `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      state.requestId = requestId; state.pending = true;
      const callbacks = {
        ...config, requestId,
        onStart: event => { state.pending = true; render({ requestId, status: '处理中…', pending: true }); config.onStart?.(event); },
        onDelta: (value, reasoning, event) => { render({ requestId, status: '处理中…', pending: true }); config.onDelta?.(value, reasoning, event); },
        onToolEvent: event => { render({ requestId, status: `调用 ${text(event?.name, '工具')}…`, pending: true }); config.onToolEvent?.(event); }
      };
      render({ requestId, status: '处理中…', pending: true });
      try {
        const runner = api?.run || api?.runPrimary || runtime?.runPrimary;
        if (typeof runner !== 'function') throw new Error('统一 Agent Runtime 不可用');
        const result = await runner.call(api, { ...payload, text: value, imageIds, requestId, ...callbacks }, config);
        state.pending = false;
        render({ requestId, status: result?.ok === false ? safeError(result.error).message : '完成', pending: false });
        return result?.ok === false && !result.error ? { ...result, error: safeError(result) } : result;
      } catch (error) {
        state.pending = false;
        const normalized = { ok: false, requestId, error: safeError(error) };
        render({ requestId, status: normalized.error.message, pending: false });
        notify?.(normalized.error.message); return normalized;
      }
    }
    function cancel(requestId = state.requestId) {
      state.pending = false;
      const result = api?.cancel?.(requestId) ?? runtime?.cancel?.(requestId) ?? false;
      render({ requestId, status: '已取消', pending: false }); return result;
    }
    function bind() {
      const host = q('[data-conversation-view]') || q('#talkConv');
      host?.addEventListener('click', async event => {
        const target = event.target.closest?.('[data-action]');
        const action = target?.dataset.action;
        if (!action) {
          const sessionRow = event.target.closest?.('[data-session-id]');
          if (sessionRow) { api?.switchSession?.(sessionRow.dataset.sessionId); render(); onRoute?.('conversation'); }
          return;
        }
        const sessionRow = event.target.closest?.('[data-session-id]');
        if (action === 'delete-session') { api?.deleteSession?.(sessionRow?.dataset.sessionId); render(); return; }
        const row = event.target.closest?.('[data-message-id]');
        const message = row && current()?.messages?.find(item => text(item.id) === text(row.dataset.messageId));
        if (!message) return;
        if (action === 'copy-message') { try { await doc.defaultView?.navigator?.clipboard?.writeText?.(text(message.text)); notify?.('已复制'); } catch { notify?.('复制失败'); } }
        if (action === 'edit-message') { const value = doc.defaultView?.prompt?.('编辑消息', text(message.text)); if (value?.trim()) { api?.editMessage?.(message.id, value.trim()); render(); } }
        if (action === 'retry-message') { const previous = current()?.messages?.slice(0, current().messages.indexOf(message)).reverse().find(item => item.role === 'user'); if (previous) await send({ text: previous.text, imageIds: previous.imageIds || [] }, getSettings()); }
      });
      const input = q('#talkIn'); const button = q('#talkSendBtn'); const stop = q('#talkStopBtn');
      button?.addEventListener('click', () => send({ text: input?.value || '', imageIds: [] }, getSettings()));
      stop?.addEventListener('click', () => cancel());
      input?.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send({ text: input.value, imageIds: [] }, getSettings()); input.value = ''; } });
      q('#talkNew')?.addEventListener('click', () => { api?.newSession?.(); render(); });
      q('#talkRepositoryColumns')?.addEventListener('change', event => { state.columns = event.target.value === 'single' ? 'single' : 'two'; savePreference('gallery.conversationColumns', state.columns); });
      state.columns = readPreference('gallery.conversationColumns', 'two') === 'single' ? 'single' : 'two';
    }
    if (autoBind) bind();
    return { render, send, cancel, bind, current, sessions, getState: () => ({ ...state }) };
  }
  return { createConversationView };
});
