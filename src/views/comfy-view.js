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
      const active = comfy?.profiles?.active?.();
      const profileLabel = q('#comfyProfileSelector');
      if (profileLabel && active) {
        profileLabel.hidden = false;
        let select = profileLabel.querySelector('select');
        if (!select) { select = doc.createElement('select'); select.className = 'wbselect'; profileLabel.replaceChildren(select); select.addEventListener('change', () => { comfy?.profiles?.setActive?.(select.value); render(read()); }); }
        select.replaceChildren();
        for (const item of comfy?.profiles?.list?.() || [active]) { const option = doc.createElement('option'); option.value = item.id; option.textContent = item.name; option.selected = item.id === active.id; select.appendChild(option); }
      }
      const analysis = q('#comfyAnalysisSummary');
      if (analysis && active?.analysis) { analysis.hidden = false; analysis.textContent = `兼容等级：${active.analysis.level || 'manual'} · 节点 ${active.analysis.nodeCount || 0}`; }
      const overrides = q('#comfyOverrides');
      if (overrides && active?.overrides) {
        overrides.hidden = false; overrides.replaceChildren();
        const label = doc.createElement('strong'); label.textContent = '参数覆盖'; overrides.appendChild(label);
        const names = { positive: '正向提示词', negative: '负向提示词', width: '宽度', height: '高度', steps: '步数', cfg: 'CFG', seed: 'Seed', sampler: '采样器', scheduler: 'Scheduler', batchCount: '批量数量', ckpt: '模型' };
        for (const [key, name] of Object.entries(names)) { const item = doc.createElement('label'); item.className = 'opt'; const input = doc.createElement('input'); input.type = 'checkbox'; input.checked = active.overrides[key] === true; input.disabled = key === 'positive' || key === 'negative'; input.addEventListener('change', () => { const latest = comfy?.profiles?.active?.(); if (latest) comfy?.profiles?.save?.({ ...latest, overrides: { ...latest.overrides, [key]: input.checked } }); }); item.append(input, doc.createTextNode(` ${name}`)); overrides.appendChild(item); }
      }
      const bindings = q('#comfyBindings');
      if (bindings && active?.analysis) {
        bindings.hidden = false; bindings.replaceChildren();
        const heading = doc.createElement('strong'); heading.textContent = '节点绑定'; bindings.appendChild(heading);
        const samplerRows = active.analysis.samplerCandidates || [];
        if (samplerRows.length > 1) {
          const select = doc.createElement('select'); select.className = 'wbselect';
          for (const row of samplerRows) { const option = doc.createElement('option'); option.value = row.nodeId; option.textContent = `${row.title} · ${row.classType} · 节点 ${row.nodeId}`; option.selected = active.bindings?.samplerId === row.nodeId; select.appendChild(option); }
          select.addEventListener('change', () => { const report = comfy?.analyze?.(active.workflow, { samplerId: select.value }); if (report) comfy?.profiles?.save?.({ ...comfy.profiles.active(), analysis: report, bindings: report.suggestedBindings || active.bindings }); }); bindings.appendChild(select);
        } else if (samplerRows[0]) { const summary = doc.createElement('span'); summary.className = 'hint'; summary.textContent = `${samplerRows[0].title} · 节点 ${samplerRows[0].nodeId}`; bindings.appendChild(summary); }
        const suggested = active.bindings || {};
        const hint = doc.createElement('div'); hint.className = 'hint'; hint.textContent = `正向：${suggested.positive?.[0]?.nodeId || '未绑定'} · 负向：${suggested.negative?.[0]?.nodeId || '未绑定'} · 输出：${(suggested.outputs || []).join(', ') || '未选择'}`; bindings.appendChild(hint);
      }
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
