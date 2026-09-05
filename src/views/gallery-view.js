'use strict';

function createGalleryView({ repository, document } = {}) {
  return {
    render(options = {}) {
      const data = repository?.listGallery?.(options) || { items: [] };
      const host = document?.querySelector?.('[data-gallery-view]');
      if (host) host.dataset.count = String(data.items?.length || data.length || 0);
      return data;
    },
    listConversation(sessionId, options = {}) { return repository?.listConversation?.(sessionId, options) || { items: [] }; }
  };
}

module.exports = { createGalleryView };
