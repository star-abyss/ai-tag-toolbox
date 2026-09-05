'use strict';

function createConversationView({ document, api, notify } = {}) {
  return {
    render(snapshot = {}) {
      const host = document?.querySelector?.('[data-conversation-view]');
      if (host && snapshot.text != null) host.textContent = String(snapshot.text);
      return snapshot;
    },
    async send(input = {}) {
      if (!input.text && !input.imageIds?.length) return { ok: false, error: { code: 'EMPTY_INPUT', message: '请输入内容或添加图片' } };
      try { return await api?.runPrimary?.(input); } catch (error) { notify?.(error.message || String(error)); return { ok: false, error }; }
    },
    cancel(requestId) { return api?.cancel?.(requestId) || false; }
  };
}

module.exports = { createConversationView };
