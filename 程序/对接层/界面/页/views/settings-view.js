'use strict';
/* 本视图负责每轮张数、最多生成轮数和自动迭代设置。 */
(function installSettingsView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.settings = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFactory() {
  const number = (value, fallback, min) => { const n = Number(value); if (!Number.isFinite(n)) return fallback; return Math.max(min, Math.floor(n)); };
  const fields = {
    imagesPerRound: ['#settingsImagesPerRound', 'value'], maxAutoRounds: ['#maxAutoRounds', 'value'], generationAutoRun: ['#generationAutoRun', 'checked']
  };
    const generationFields = ['imagesPerRound', 'maxAutoRounds', 'generationAutoRun'];
  function createSettingsView({ document, api, notify, onChange, autoBind = true } = {}) {
    const doc = document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
    const q = selector => doc?.querySelector?.(selector);
    const read = () => { try { return api?.getSettings?.() || {}; } catch { return {}; } };
    let writeQueue = Promise.resolve();
    let writeError = null;
    const write = patch => {
      const operation = writeQueue.catch(() => {}).then(async () => {
        try {
          if (typeof api?.setSettings !== 'function') throw new Error('设置保存不可用');
          const saved = await api.setSettings(patch);
          if (!saved || typeof saved !== 'object') throw new Error('设置保存失败');
          writeError = null;
          return saved;
        } catch (error) {
          writeError = error;
          throw error;
        }
      });
      writeQueue = operation;
      return operation;
    };
    async function flush() {
      let pending;
      do {
        pending = writeQueue;
        await pending.catch(() => {});
      } while (pending !== writeQueue);
      const error = writeError;
      if (error) throw error;
      return read();
    }
    function readField(key, current) {
      const config = fields[key]; const el = config && q(config[0]); if (!el) return current;
      if (config[1] === 'checked') return Boolean(el.checked);
      return el.value;
    }
    function render(snapshot = read(), force = false) {
      const value = snapshot || {};
      Object.entries(fields).forEach(([key, config]) => { const el = q(config[0]); if (!el || !force && doc.activeElement === el) return; if (config[1] === 'checked') el.checked = value[key] === true; else if (value[key] != null) el.value = String(value[key]); });
      return value;
    }
    function collect() {
      const current = read();
      return {
        imagesPerRound: number(readField('imagesPerRound', current.imagesPerRound), Number(current.imagesPerRound) || 1, 1),
        maxAutoRounds: number(readField('maxAutoRounds', current.maxAutoRounds), Number(current.maxAutoRounds) || 3, 1),
        generationAutoRun: Boolean(readField('generationAutoRun', current.generationAutoRun !== false))
      };
    }
    function scheduleSave() {
      const patch = collect();
      const operation = write(patch).then(value => { onChange?.(value); return value; }).catch(error => { notify?.(error.message || String(error)); throw error; });
      operation.catch(() => {});
      return operation;
    }
    function saveCurrent() { return scheduleSave(); }
    async function update(patch = collect()) {
      try {
        const value = await write(patch);
        onChange?.(value);
        return value;
      } catch (error) {
        notify?.(error.message || String(error));
        throw error;
      }
    }
    function bind() {
      generationFields.forEach(key => {
        const element = q(fields[key][0]); if (!element) return;
        element.addEventListener('change', scheduleSave);
        element.addEventListener('blur', scheduleSave);
      });
    }
    if (autoBind) bind();
    return { render, collect, update, bind, flush, save: saveCurrent, get: read, set: write, fields };
  }
  return { createSettingsView, fields };
});
