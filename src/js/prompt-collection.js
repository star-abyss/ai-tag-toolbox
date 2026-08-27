/* ================= 提示词集合（主模块 / 拓展模块统一模型 + 统一导出导入） ================= */
/* 概念：主提示词 与 拓展提示词(世界书) 都是"可导入导出、有条目、可设优先级"的集合；
   唯一差异：主模块=每条目选启用对象(mods)；拓展模块=整本选启用对象(call.mods)。 */
'use strict';
var PC_FORMAT = 'dbt-prompt-collections', PC_VERSION = 1;
var PC_MODULES = [['talk', 'ui.ai.talk'], ['gen', 'ui.ai.gen'], ['rk', 'ui.ai.rk'], ['comfy', 'ui.ai.comfy']];

// —— 构建：从当前状态生成 主集合 / 拓展集合（只读映射，不影响现有 UI 编辑）——
function buildMainCollection() {
  const mk = (special, name, mods, content, order) => ({ special, name, mods, content, order, position: 0, depth: 4 });
  return {
    type: 'main', name: '主提示词',
    entries: [
      mk('base',    '文生图主提示词', getSlotMods('text2img'), effectiveSys(), 1),
      mk('genTask', '生成Tag指令',   getSlotMods('text2img'), effectiveGenTask(), 2),
      mk('quality', '画师主提示词',   getSlotMods('quality'),  effectiveQp(), 3),
      mk('vision',  '识图提示词',     getSlotMods('vision'),   effectiveVision(), 4),
      mk('system',  '系统提示词',     getSlotMods('system'),   comfySys(), 5)
    ],
    presets: presetList()
  };
}
function buildExtCollections() {
  return worldList().map(w => ({
    type: 'ext', id: w.id, name: w.name || '拓展提示词', enabled: w.enabled !== false,
    call: { mods: Array.isArray(w.mods) ? w.mods.slice() : [] },   // 整本启用对象（空 = 全模块）
    entries: (w.entries || []).map(e => ({
      name: e.name || '未命名条目', keys: e.keys || '', content: e.content || '',
      constant: !!e.constant, enabled: e.enabled !== false, order: e.order || 0,
      position: e.position || 0, depth: e.depth || 4, mods: e.mods || []
    }))
  }));
}
// 拓展提示词「整本启用对象」：勾选 = 这本拓展提示词注入对应模块
function renderWbCallMods() {
  const el = document.getElementById('wbCallMods');
  if (!el) return;
  const w = activeWorld();
  el.replaceChildren();
  if (!w) { el.textContent = '（' + t('ui.common.none') + '）'; return; }
  const mods = Array.isArray(w.mods) && w.mods.length ? w.mods : PC_MODULES.map(x => x[0]);
  PC_MODULES.forEach(function (mm) {
    const ck = UI.el('label', 'pmod-chk');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = mods.indexOf(mm[0]) >= 0;
    input.addEventListener('change', function () {
      const set = new Set(mods);
      if (input.checked) set.add(mm[0]); else set.delete(mm[0]);
      w.mods = Array.from(set);
      saveJSON(LS_AI, aiCfg);
    });
    ck.appendChild(input);
    ck.appendChild(UI.el('span', null, t(mm[1])));
    el.appendChild(ck);
  });
}
(function () {
  const ws = document.getElementById('worldSel'), we = document.getElementById('worldEnabled');
  if (ws) ws.addEventListener('change', renderWbCallMods);
  if (we) we.addEventListener('change', renderWbCallMods);
  if (typeof activeWorld === 'function') renderWbCallMods();
})();
// 导入后刷新相关 UI（无则跳过）
function refreshPromptUI() {
  if (typeof aiSys !== 'undefined' && aiSys) aiSys.value = effectiveSys();
  if (typeof genTask !== 'undefined' && genTask) genTask.value = effectiveGenTask();
  if (typeof aiVision !== 'undefined' && aiVision) aiVision.value = effectiveVision();
  if (typeof qpText !== 'undefined' && qpText) qpText.value = effectiveQp();
  if (typeof renderPresetBar === 'function') renderPresetBar();
  if (typeof renderWorldSelector === 'function') renderWorldSelector();
  if (typeof renderPromptMods === 'function') renderPromptMods();
}
// —— 统一导出：主 / 拓展集合 + 预设，都放进一个文件 ——
function collectionsExport() {
  return { format: PC_FORMAT, version: PC_VERSION, name: 'AI绘画Tag工具箱·提示词集合',
    main: buildMainCollection(), ext: buildExtCollections() };
}
// —— 统一导入：解析集合文件，写回现有状态（主→4字段+勾选；拓展→worlds）——
function collectionsImport(text) {
  let d; try { d = JSON.parse(text); } catch (e) { return null; }
  if (!d || d.format !== PC_FORMAT) return null;
  const main = d.main, ext = d.ext;
  let mainSet = false;
  if (main && Array.isArray(main.entries) && main.entries.length) {
    const get = (sp) => { const e = main.entries.find(x => x.special === sp); return e ? String(e.content || '') : null; };
    const getMods = (sp) => { const e = main.entries.find(x => x.special === sp); return Array.isArray(e && e.mods) ? e.mods : []; };
    const base = get('base'), genTask = get('genTask'), quality = get('quality'), vision = get('vision'), system = get('system');
    if (base != null) aiCfg.sysPrompt = base === DEFAULT_BASE_PROMPT.trim() ? '' : base;
    if (genTask != null) aiCfg.genTask = genTask === GEN_TASK.trim() ? '' : genTask;
    if (quality != null) aiCfg.qualityPrefix = quality === DEFAULT_QP.trim() ? '' : quality;
    if (vision != null) aiCfg.visionPrompt = vision === DEFAULT_VISION_PROMPT.trim() ? '' : vision;
    // 勾选矩阵（取 base/quality/vision/system 的 mods；genTask 随 base）
    setSlotMods('text2img', getMods('base'));
    setSlotMods('quality', getMods('quality'));
    setSlotMods('vision', getMods('vision'));
    setSlotMods('system', getMods('system'));
    mainSet = true;
  }
  let extSet = false;
  if (Array.isArray(ext) && ext.length) {
    const worlds = [];
    for (const c of ext) {
      const entries = (c.entries || []).map(e => ({
        id: 'wb_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
        name: e.name || '未命名条目',
        keys: (Array.isArray(e.keys) ? e.keys.join(', ') : String(e.keys || '')).trim(),
        content: e.content || '', constant: !!e.constant, enabled: e.enabled !== false,
        mods: Array.isArray(e.mods) ? e.mods : []
      }));
      entries.sort((a, b) => (a.order || 0) - (b.order || 0));
      worlds.push({ id: 'ext_' + Date.now() + '_' + Math.floor(Math.random() * 1e4), name: c.name || '拓展提示词', enabled: c.enabled !== false, constant: false, entries });
    }
    aiCfg.worlds = worlds;
    aiCfg.worldSel = worlds[0].id;
    aiCfg.wb = worlds[0].entries;
    extSet = true;
  }
  if (mainSet && Array.isArray(main.presets) && main.presets.length) {
    aiCfg.presets = main.presets;
    aiCfg.presetSel = (main.presets[0] && main.presets[0].id) || '';
  }
  if (mainSet || extSet) { saveJSON(LS_AI, aiCfg); refreshPromptUI(); }
  return { main: mainSet, ext: extSet };
}
// 提示词页「导出集合 / 导入集合」入口
(function () {
  const pcolExport = document.getElementById('pcolExport'), pcolImport = document.getElementById('pcolImport'), pcolFile = document.getElementById('pcolFile');
  if (pcolExport) pcolExport.onclick = () => { if (typeof wbDownload === 'function') wbDownload(collectionsExport(), 'AI绘画Tag工具箱提示词集合.json'); };
  if (pcolImport) pcolImport.onclick = () => { if (pcolFile) pcolFile.click(); };
  if (pcolFile) pcolFile.addEventListener('change', () => {
    const f = pcolFile.files && pcolFile.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const res = collectionsImport(String(r.result));
      toast(res && (res.main || res.ext) ? '已导入提示词集合' : (typeof formatAppError === 'function' ? formatAppError('导入失败：格式不符（需为本工具导出的集合文件）', '导入提示词集合') : '导入失败：格式不符（需为本工具导出的集合文件）'));
      pcolFile.value = '';
    };
    r.readAsText(f);
  });
})();
