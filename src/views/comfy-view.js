'use strict';

/* The ComfyUI editor owns only its settings fields. API settings stay in the
 * API tab so changing one surface cannot overwrite the other tab's draft. */
(function installComfyView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.comfy = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFactory() {
  const text = (value, fallback = '') => value == null ? fallback : String(value);
  const number = (value, fallback, min, max) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
  };
  const fieldMap = {
    comfyBase: ['#comfyBase', 'value'], comfyOn: ['#comfyOn', 'checked'],
    comfyWorkflow: ['#comfyWf', 'value'], comfyPos: ['#comfyPos', 'value'], comfyNeg: ['#comfyNeg', 'value'],
    comfyW: ['#comfyW', 'value'], comfyH: ['#comfyH', 'value'], comfySteps: ['#comfySteps', 'value'],
    comfyCfg: ['#comfyCfg', 'value'], comfySeed: ['#comfySeed', 'value'], comfySampler: ['#comfySampler', 'value'],
    comfyScheduler: ['#comfyScheduler', 'value'], batchCount: ['#batchCount', 'value'], maxComfyCalls: ['#maxComfyCalls', 'value'],
    generateNegativeTags: ['#generateNegativeTags', 'checked']
  };
  const workflowText = value => {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    try { return JSON.stringify(value, null, 2); } catch { return ''; }
  };

  function createComfyView({ document, comfy, assistant, notify, openExternal, autoBind = true } = {}) {
    const doc = document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
    const q = selector => doc?.querySelector?.(selector);
    const read = () => { try { return assistant?.getSettings?.() || {}; } catch { return {}; } };
    let saveTimer = null;
    function collect(current = read()) {
      const value = key => q(fieldMap[key][0]);
      return {
        comfyBase: text(value('comfyBase')?.value, current.comfyBase || 'http://127.0.0.1:8188').replace(/\/+$/, ''),
        comfyOn: value('comfyOn') ? Boolean(value('comfyOn').checked) : current.comfyOn === true,
        comfyWorkflow: text(value('comfyWorkflow')?.value, workflowText(current.comfyWorkflow)),
        comfyPos: text(value('comfyPos')?.value, current.comfyPos), comfyNeg: text(value('comfyNeg')?.value, current.comfyNeg),
        comfyW: number(value('comfyW')?.value, Number(current.comfyW) || 768, 64, 8192),
        comfyH: number(value('comfyH')?.value, Number(current.comfyH) || 1024, 64, 8192),
        comfySteps: number(value('comfySteps')?.value, Number(current.comfySteps) || 25, 1, 200),
        comfyCfg: number(value('comfyCfg')?.value, Number(current.comfyCfg) || 7, 0, 30),
        comfySeed: value('comfySeed')?.value === '' ? undefined : number(value('comfySeed')?.value, current.comfySeed, 0, 2147483647),
        comfySampler: text(value('comfySampler')?.value, current.comfySampler || 'euler'),
        comfyScheduler: text(value('comfyScheduler')?.value, current.comfyScheduler || 'normal'),
        batchCount: number(value('batchCount')?.value, Number(current.batchCount) || 1, 1, 8),
        maxComfyCalls: number(value('maxComfyCalls')?.value, Number(current.maxComfyCalls) || 3, 1, 20),
        generateNegativeTags: value('generateNegativeTags') ? Boolean(value('generateNegativeTags').checked) : current.generateNegativeTags === true
      };
    }
    function save() {
      const patch = collect();
      assistant?.setSettings?.(patch);
      comfy?.setBase?.(patch.comfyBase);
      comfy?.setWorkflow?.(patch.comfyWorkflow);
      return patch;
    }
    function scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { saveTimer = null; save(); }, 240);
    }
    function flush() {
      if (!saveTimer) return null;
      clearTimeout(saveTimer); saveTimer = null;
      return save();
    }
    function render(snapshot = read()) {
      const value = snapshot || {};
      Object.entries(fieldMap).forEach(([key, config]) => {
        const el = q(config[0]); if (!el) return;
        if (config[1] === 'checked') el.checked = value[key] === true;
        else if (key === 'comfyWorkflow') el.value = workflowText(value[key]);
        else if (value[key] != null) el.value = String(value[key]);
      });
      if (q('#comfySeed')) q('#comfySeed').value = value.comfySeed ?? '';
      if (q('#comfySampler')) q('#comfySampler').value = value.comfySampler || 'euler';
      if (q('#comfyScheduler')) q('#comfyScheduler').value = value.comfyScheduler || 'normal';
      return value;
    }
    async function refresh() {
      const status = q('#comfyConfigStatus');
      if (!status) return null;
      try {
        const result = await (comfy?.status?.() || comfy?.check?.());
        const workflow = comfy?.workflowStatus?.(snapshot().comfyWorkflow);
        const connected = result === true || result?.connected === true || result?.ok === true;
        const ready = workflow?.ready === true;
        status.textContent = connected ? (ready ? 'ComfyUI 已连接，工作流已就绪' : 'ComfyUI 已连接，等待工作流') : 'ComfyUI 未连接';
        return { result, workflow };
      } catch (error) {
        status.textContent = error?.message || 'ComfyUI 状态不可用';
        return { ok: false, error };
      }
    }
    function snapshot() { return collect(); }
    function bind() {
      Object.values(fieldMap).forEach(([selector, kind]) => {
        const el = q(selector); if (!el) return;
        el.addEventListener('change', save);
        if (kind === 'value' && (el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'number')) el.addEventListener('input', scheduleSave);
      });
      q('#comfyWfOpen')?.addEventListener('click', () => openExternal?.(collect().comfyBase));
    }
    if (autoBind) bind();
    return { render, refresh, snapshot, collect, save, scheduleSave, flush, bind };
  }
  return { createComfyView, fieldMap };
});
