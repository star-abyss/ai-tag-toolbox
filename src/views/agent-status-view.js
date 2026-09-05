'use strict';

function createAgentStatusView({ document, api, notify } = {}) {
  return {
    render(snapshot = {}) {
      const host = document?.querySelector?.('[data-agent-status]');
      if (host) host.textContent = snapshot.status || api?.getStatus?.(snapshot.requestId)?.status || 'idle';
      return snapshot;
    },
    cancel(requestId) { return api?.cancel?.(requestId) || false; },
    report(message) { notify?.(message); }
  };
}

module.exports = { createAgentStatusView };
