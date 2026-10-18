'use strict';
(function installComfyView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.comfy = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFactory() {
  const json = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  function createComfyView({ document, comfy, assistant, notify, openExternal, onChange, onGenerated, autoBind = true } = {}) {
    const doc = document || globalThis.document;
    const q = selector => doc?.querySelector?.(selector);
    let saveTimer = null, parameterQueue = Promise.resolve(), saving = Promise.resolve();
    let dirtyWorkflow = false, dirtyBase = false, workflowRevision = 0, baseRevision = 0, workflowDraft = '', baseDraft = '';
    const fail = error => notify?.(error?.message || String(error));
    const current = () => assistant?.getSettings?.() || {};
    function readDrafts() {
      if (q('#comfyWf')) workflowDraft = q('#comfyWf').value;
      if (q('#comfyBase')) baseDraft = q('#comfyBase').value;
    }
    function renderParameters(groups) {
      const host = q('#comfyParameters'); if (!host) return;
      if (doc.activeElement?.closest?.('#comfyParameters')) return;
      host.replaceChildren();
      if (!Array.isArray(groups) || !groups.length) { const p = doc.createElement('p'); p.className = 'hint'; p.textContent = '导入工作流后，这里会按节点显示可编辑参数。'; host.appendChild(p); return; }
      for (const group of groups) {
        const section = doc.createElement('details'); section.className = 'comfy-node-parameters'; section.open = true;
        const summary = doc.createElement('summary'); summary.textContent = `${group.名称 || group.类型 || '节点'} · ${group.类型 || ''} · ${group.编号}`; section.appendChild(summary);
        for (const parameter of group.参数 || []) {
          const row = doc.createElement('label'); row.className = 'comfy-parameter'; row.dataset.comfyNode = String(group.编号); row.dataset.comfyParam = parameter.名称;
          const caption = doc.createElement('span'); caption.textContent = parameter.名称;
          let control;
          if (parameter.只读 === true && parameter.连接) {
            control = doc.createElement('input'); control.type = 'text'; control.value = `来自节点${parameter.连接.节点} 输出${parameter.连接.输出 ?? ''}`;
          } else if (Array.isArray(parameter.选项) && parameter.选项.length) {
            control = doc.createElement('select');
            for (const choice of parameter.选项) { const option = doc.createElement('option'); option.value = String(choice); option.textContent = String(choice); control.appendChild(option); }
            const currentValue = parameter.值 == null ? '' : String(parameter.值);
            if (![...control.options].some(option => option.value === currentValue)) { const option = doc.createElement('option'); option.value = currentValue; option.textContent = currentValue; control.appendChild(option); }
            control.value = currentValue;
          } else if (typeof parameter.值 === 'boolean') { control = doc.createElement('input'); control.type = 'checkbox'; control.checked = parameter.值; }
          else if (parameter.值 && typeof parameter.值 === 'object') { control = doc.createElement('textarea'); control.value = JSON.stringify(parameter.值, null, 2); control.rows = 4; }
          else { control = doc.createElement('input'); control.type = typeof parameter.值 === 'number' || /number|int|float/i.test(parameter.类型 || '') ? 'number' : 'text'; if (control.type === 'number') { control.step = parameter.步长 ?? (Number.isInteger(parameter.值) ? '1' : 'any'); if (parameter.最小值 != null) control.min = parameter.最小值; if (parameter.最大值 != null) control.max = parameter.最大值; } control.value = parameter.值 == null ? '' : String(parameter.值); }
          control.disabled = parameter.只读 === true;
          if (parameter.说明) control.title = parameter.说明;
          control.addEventListener('change', () => {
            let value;
            try { value = control.type === 'checkbox' ? control.checked : control.type === 'number' ? Number(control.value) : control.tagName === 'TEXTAREA' ? JSON.parse(control.value) : control.value; }
            catch (error) { fail(error instanceof SyntaxError ? new Error('参数必须是有效 JSON') : error); return; }
            if (control.type === 'number' && (!control.value.trim() || !Number.isFinite(value))) { fail(new Error('请输入有效数字')); return; }
            const patch = { 节点: String(group.编号), 参数: parameter.名称, 值: value };
          parameterQueue = parameterQueue.catch(() => {}).then(async () => {
              const reply = await comfy.parameters(patch);
              if (reply?.ok === false) throw new Error(reply.reason || '节点参数保存失败');
            if (!dirtyWorkflow && q('#comfyWf')) { workflowDraft = json(await comfy.getWorkflow()); q('#comfyWf').value = workflowDraft; }
            await loadParameters();
            });
            parameterQueue.catch(fail);
          });
          row.append(caption, control); section.appendChild(row);
        }
        host.appendChild(section);
      }
    }
    async function loadParameters() {
      const host = q('#comfyParameters'); if (!host || !comfy?.parameters) return;
      try { const result = await comfy.parameters(); renderParameters(result?.节点 || result || []); }
      catch (error) { host.replaceChildren(); const note = doc.createElement('p'); note.className = 'hint'; note.textContent = '节点参数暂不可读取，可在高级工作流 JSON 中查看与编辑。'; host.appendChild(note); return null; }
    }
    async function persistDrafts(notifyChange = true) {
      clearTimeout(saveTimer); saveTimer = null;
      readDrafts();
      const baseToSave = dirtyBase ? { value: baseDraft.trim(), revision: baseRevision } : null;
      saving = saving.catch(() => {}).then(async () => {
        if (baseToSave) {
          await comfy.setBase(baseToSave.value);
          if (baseRevision === baseToSave.revision) dirtyBase = false;
        }
        if (notifyChange) onChange?.(current());
      });
      return saving;
    }
    async function saveWorkflow() {
      readDrafts();
      const draft = workflowDraft.trim(), revision = workflowRevision;
      if (!draft) await comfy.clearWorkflow();
      else { let graph; try { graph = JSON.parse(draft); } catch { throw new Error('工作流 JSON 格式无效，尚未保存'); } await comfy.setWorkflow(graph); }
      if (workflowRevision === revision) dirtyWorkflow = false;
      await loadParameters();
      onChange?.(current());
    }
    function scheduleSave(kind) {
      if (kind === 'base') { dirtyBase = true; baseRevision += 1; clearTimeout(saveTimer); saveTimer = setTimeout(() => persistDrafts().catch(fail), 400); }
      else { dirtyWorkflow = true; workflowRevision += 1; }
    }
    async function refresh() {
      const status = q('#comfyConfigStatus');
      try { const result = await comfy?.status?.(); const connected = result?.connected === true || result?.ok === true; const ready = result?.workflowReady === true; const queue = result?.queue ? ` · 队列 ${result.queue.running + result.queue.pending}` : ''; if (status) status.textContent = connected ? ready ? `ComfyUI 已连接 · 工作流已就绪${result.version ? ' · ' + result.version : ''}${queue}` : `ComfyUI 已连接 · 尚未导入工作流${result.version ? ' · ' + result.version : ''}${queue}` : 'ComfyUI 未连接'; return result; }
      catch (error) { if (status) status.textContent = error?.message || 'ComfyUI 状态不可用'; return { ok: false, error }; }
    }
    async function render(snapshot = current(), force = false) {
      if (force) { dirtyWorkflow = false; dirtyBase = false; workflowRevision += 1; baseRevision += 1; clearTimeout(saveTimer); }
      if (q('#comfyOn') && doc.activeElement !== q('#comfyOn')) q('#comfyOn').checked = snapshot.comfyOn === true;
      if (!dirtyBase && q('#comfyBase')) { baseDraft = await comfy?.getBase?.() || ''; q('#comfyBase').value = baseDraft; }
      if (!dirtyWorkflow && q('#comfyWf')) { workflowDraft = json(await comfy?.getWorkflow?.()); q('#comfyWf').value = workflowDraft; }
      await loadParameters();
      return snapshot;
    }
    function snapshot() { return { ...current(), comfyBase: q('#comfyBase')?.value || '', comfyWorkflow: q('#comfyWf')?.value || '' }; }
    async function save() { await persistDrafts(false); if (dirtyWorkflow) await saveWorkflow(); return snapshot(); }
    async function flush() { clearTimeout(saveTimer); await persistDrafts(false); await parameterQueue; return snapshot(); }
    function bind() {
      q('#comfyBase')?.addEventListener('input', () => scheduleSave('base'));
      q('#comfyWf')?.addEventListener('input', () => { readDrafts(); scheduleSave('workflow'); });
      q('#comfyOn')?.addEventListener('change', async event => {
        const key = 'comfyOn';
        const control = event.currentTarget, requested = control.checked;
        try { const saved = await assistant?.setSettings?.({ [key]: requested }); if (!saved || saved[key] !== requested) throw new Error('设置保存失败'); onChange?.(saved); }
        catch (error) { control.checked = current()[key] === true; fail(error); }
      });
      q('#comfyWfOpen')?.addEventListener('click', async () => { try { await flush(); openExternal?.(await comfy.getBase()); } catch (error) { fail(error); } });
      q('#comfyWfCopy')?.addEventListener('click', async () => { try { await flush(); await navigator.clipboard?.writeText(json(await comfy.getWorkflow()) || ''); notify?.('工作流 JSON 已复制'); } catch (error) { fail(error); } });
      q('#comfyWfExport')?.addEventListener('click', async () => {
        try {
          await flush();
          const text = json(await comfy.getWorkflow());
          if (!text) { notify?.('当前没有可导出的工作流'); return; }
          const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
          const link = doc.createElement('a'); link.href = url; link.download = 'comfy-workflow.json'; link.click(); URL.revokeObjectURL(url);
        } catch (error) { fail(error); }
      });
      q('#comfyWfSave')?.addEventListener('click', async () => { try { await persistDrafts(); await saveWorkflow(); notify?.('工作流已保存'); } catch (error) { fail(error); } });
      q('#comfyWfClear')?.addEventListener('click', async () => { try { clearTimeout(saveTimer); dirtyWorkflow = false; workflowDraft = ''; workflowRevision += 1; await comfy.clearWorkflow(); await render(undefined, true); onChange?.(current()); } catch (error) { fail(error); } });
      q('#comfyTest')?.addEventListener('click', async () => { try { await flush(); const result = await comfy.check(); notify?.(result ? 'ComfyUI 已连接 · 地址可访问' : 'ComfyUI 未连接'); await refresh(); } catch (error) { fail(error); } });
      if (autoBind) void render().then(refresh).catch(fail);
    }
    return { render, refresh, snapshot, collect: snapshot, save, scheduleSave, flush, bind, loadParameters };
  }
  return { createComfyView };
});
