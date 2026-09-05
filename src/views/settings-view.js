'use strict';

function createSettingsView({ settings, onChange } = {}) {
  return {
    render() { return settings?.getSettings?.() || {}; },
    update(patch = {}) { const value = settings?.setSettings?.(patch) || {}; onChange?.(value); return value; },
    reset() { return this.update({}); }
  };
}

module.exports = { createSettingsView };
