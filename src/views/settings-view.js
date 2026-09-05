'use strict';
/* Settings view exposes only the flat public settings adapter. */
(function installSettingsView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.settings = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFactory() {
  const text = (value, fallback = '') => value == null || value === '' ? fallback : String(value);
  const number = (value, fallback, min, max) => { const n = Number(value); if (!Number.isFinite(n)) return fallback; return Math.max(min, Math.min(max, n)); };
  const fields = {
    base: ['#aiBase', 'value'], model: ['#aiModel', 'value'], key: ['#aiKey', 'value'],
    visionInheritPrimary: ['#visionInheritPrimary', 'checked'], visionBase: ['#visionBase', 'value'], visionModel: ['#visionModel', 'value'], visionKey: ['#visionKey', 'value'],
    comfyBase: ['#comfyBase', 'value'], comfyW: ['#comfyW', 'value'], comfyH: ['#comfyH', 'value'], comfySteps: ['#comfySteps', 'value'], comfyCfg: ['#comfyCfg', 'value'], comfySeed: ['#comfySeed', 'value'], comfySampler: ['#comfySampler', 'value'], comfyScheduler: ['#comfyScheduler', 'value'], comfyOn: ['#comfyOn', 'checked'], comfyWorkflow: ['#comfyWf', 'value'], comfyPos: ['#comfyPos', 'value'], comfyNeg: ['#comfyNeg', 'value'], batchCount: ['#batchCount', 'value'], maxComfyCalls: ['#maxComfyCalls', 'value'], generateNegativeTags: ['#generateNegativeTags', 'checked']
  };
  function createSettingsView({ document, api, runtime, comfy, notify, onChange, autoBind = true } = {}) {
    const doc = document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
    const q = selector => doc?.querySelector?.(selector);
    const read = () => { try { return api?.getSettings?.() || {}; } catch { return {}; } };
    const write = patch => { try { return api?.setSettings?.(patch) || patch; } catch (error) { notify?.(error.message || String(error)); return patch; } };
    function readField(key, current) {
      const config = fields[key]; const el = config && q(config[0]); if (!el) return current;
      if (config[1] === 'checked') return Boolean(el.checked);
      return el.value;
    }
    function render(snapshot = read()) {
      const value = snapshot || {};
      Object.entries(fields).forEach(([key, config]) => { const el = q(config[0]); if (!el) return; if (config[1] === 'checked') el.checked = value[key] === true; else if (value[key] != null) el.value = String(value[key]); });
      const seed = q('#comfySeed'); if (seed && value.seed != null && value.comfySeed == null) seed.value = String(value.seed);
      const sampler = q('#comfySampler'); if (sampler && value.sampler != null && value.comfySampler == null) sampler.value = String(value.sampler);
      const scheduler = q('#comfyScheduler'); if (scheduler && value.scheduler != null && value.comfyScheduler == null) scheduler.value = String(value.scheduler);
      return value;
    }
    function collect() {
      const current = read();
      const inherit = q('#visionInheritPrimary')?.checked ?? current.visionInheritPrimary !== false;
      return {
        base: text(readField('base', current.base), current.base || 'https://api.openai.com/v1').replace(/\/+$/, ''),
        model: text(readField('model', current.model), current.model || 'gpt-4o-mini'), key: text(readField('key', current.key), current.key),
        visionInheritPrimary: inherit, visionBase: text(readField('visionBase', current.visionBase), current.visionBase), visionModel: text(readField('visionModel', current.visionModel), current.visionModel), visionKey: text(readField('visionKey', current.visionKey), current.visionKey),
        comfyBase: text(readField('comfyBase', current.comfyBase), current.comfyBase || 'http://127.0.0.1:8188').replace(/\/+$/, ''), comfyW: number(readField('comfyW', current.comfyW), 768, 64, 8192), comfyH: number(readField('comfyH', current.comfyH), 1024, 64, 8192), comfySteps: number(readField('comfySteps', current.comfySteps), 25, 1, 200), comfyCfg: number(readField('comfyCfg', current.comfyCfg), 7, 0, 30),
        seed: readField('comfySeed', current.seed ?? current.comfySeed) === '' ? undefined : number(readField('comfySeed', current.seed ?? current.comfySeed), current.seed, 0, 2147483647), sampler: text(readField('comfySampler', current.sampler ?? current.comfySampler), current.sampler || 'euler'), scheduler: text(readField('comfyScheduler', current.scheduler ?? current.comfyScheduler), current.scheduler || 'normal'),
        comfyOn: Boolean(readField('comfyOn', current.comfyOn)), comfyWorkflow: readField('comfyWorkflow', current.comfyWorkflow) || '', comfyPos: readField('comfyPos', current.comfyPos) || '', comfyNeg: readField('comfyNeg', current.comfyNeg) || '', batchCount: number(readField('batchCount', current.batchCount), 1, 1, 16), maxComfyCalls: number(readField('maxComfyCalls', current.maxComfyCalls), 3, 1, 100), generateNegativeTags: Boolean(readField('generateNegativeTags', current.generateNegativeTags))
      };
    }
    function update(patch = collect()) { const value = write(patch); comfy?.setBase?.(value.comfyBase); comfy?.setWorkflow?.(value.comfyWorkflow); onChange?.(value); return value; }
    async function testConnection() {
      const value = update(collect());
      try {
        const result = await (api?.testConnection?.(value) || runtime?.callTool?.('comfy.status', {}, { caller: 'ui' }));
        if (result?.ok === false) throw new Error(result.error?.message || result.error || result.text || '连接失败');
        notify?.('连接成功'); return result || { ok: true };
      } catch (error) { notify?.(error.message || String(error)); return { ok: false, error: { code: 'CONNECTION_FAILED', message: error.message || String(error) } }; }
    }
    function bind() {
      Object.values(fields).forEach(config => { const el = q(config[0]); if (!el) return; el.addEventListener('change', () => update(collect())); if (config[1] === 'value' && (el.tagName === 'TEXTAREA' || el.type === 'text')) el.addEventListener('input', () => update(collect())); });
      q('#aiTest')?.addEventListener('click', () => testConnection());
      q('#comfyTest')?.addEventListener('click', () => testConnection());
    }
    if (autoBind) bind();
    return { render, collect, update, testConnection, bind, get: read, set: write, fields };
  }
  return { createSettingsView, fields };
});
