'use strict';
/* ================= 启动 ================= */
rebuild();
if (!catMap.has(state.cat)) state.cat = 'quality';
nsfwBtn.innerHTML = '<span class="dot"></span>' + (state.nsfwOn ? t('ui.header.adultOn') : t('ui.header.adult'));
nsfwBtn.classList.toggle('on', state.nsfwOn);
aiNsfwChk.checked = state.nsfwOn;
aiBase.value = aiCfg.base || DEFAULT_CFG.base;
aiKey.value = '';
aiKey.placeholder = '输入后安全保存（不会写入普通配置）';
setModelVal(aiCfg.model || DEFAULT_CFG.model);
aiStrict.checked = aiCfg.strict !== false;
if (aiTimeoutEnabled) aiTimeoutEnabled.checked = aiCfg.timeoutEnabled === true;
if (aiTimeoutSec) aiTimeoutSec.value = String(Math.max(300, Math.min(3600, parseInt(aiCfg.timeoutSec, 10) || 300)));
if (aiTimeoutSec) aiTimeoutSec.disabled = !(aiTimeoutEnabled && aiTimeoutEnabled.checked);
aiSys.value = effectiveSys();
qpText.value = effectiveQp();
aiVision.value = effectiveVision();
genTask.value = effectiveGenTask();
comfyBase.value = aiCfg.comfyBase || DEFAULT_CFG.comfyBase;
comfyOn.checked = !!aiCfg.comfyOn;
talkIters.value = String(aiCfg.comfyIters || 3);
comfyW.value = aiCfg.comfyW || 768;
comfyH.value = aiCfg.comfyH || 1024;
comfySteps.value = aiCfg.comfySteps || 25;
comfyCfg.value = aiCfg.comfyCfg || 7;
comfyPos.value = aiCfg.comfyPos || '';
comfyNeg.value = aiCfg.comfyNeg || '';
comfyWf.value = aiCfg.comfyWorkflow || '';
renderWb();
renderWbMatch();
renderPresetBar();
renderWorldSelector();
renderWorldCards();
renderWbTitle();
{
  const o = [...aiPreset.options].find(x => x.value === aiCfg.base);
  aiPreset.value = o ? o.value : '';
}
applyTheme();
render();
initWdModelSelect();
loadModelTags();
talkRender();
renderTalkSidebar();
talkProbe();
showAiPanel('talk');
if (talkIn) talkIn.focus();
initSecureAiKey();
// 测试钩子：桌面版端到端测试用（真实图片 → canvas 预处理）
window.__wdPreprocess = preprocessForWD;
window.__matchTagsForText = matchTagsForText;
window.__keywordsOf = keywordsOf;
window.__extractUserTags = extractUserTags;
window.__synonymStats = typeof SYNONYM_STATS !== 'undefined' ? SYNONYM_STATS : null;
window.__tagZhDisplay = tagZhDisplay;
window.__buildSys = buildSys;
window.__composeSystem = composeSystem;
window.__promptCompile = (mode, ctx) => PromptCompiler.inspect(mode, ctx);
window.__comfyParseCommands = comfyParseCommands;
window.__comfyParseRender = comfyParseRender;
window.__COMFY = COMFY;
window.__comfySys = comfySys;
window.__wfImportApi = wfImportApi;
window.__wfSubstituted = wfSubstituted;
window.__addComfyImg = addComfyImg;
window.__addGenImg = addGenImg;
window.__addChatImg = addChatImg;
window.__addTalkImg = addTalkImg;
window.__talkHist = () => talkHist;
window.__talkRun = talkRun;
window.__talkPersist = talkPersist;
window.__talkRender = talkRender;
window.__talkAddMsg = talkAddMsg;
window.__showTagPane = showTagPane;
window.__startAiBubble = startAiBubble;
window.__talkIdentify = talkIdentify;
window.__talkMode = () => talkMode;
window.__talkSessions = () => talkSessions;
window.__talkRenderSidebar = renderTalkSidebar;
window.__talkNewChat = talkNewChat;
window.__wbParseEntries = wbParseEntries;
window.__wbNormalizeEntry = normalizeWorldEntry;
window.__wbEntrySchemaVersion = WB_ENTRY_SCHEMA_VERSION;
window.__wbOpenImportModal = wbOpenImportModal;
window.__wbDoImport = wbDoImport;
window.__wbCfg = () => aiCfg;
window.__wbWorlds = () => aiCfg.worlds;
window.__wbActive = activeWorld;
window.__setActiveWorld = setActiveWorld;
window.__wbBuildSingle = wbBuildSingleWorld;
window.__wbBuildAll = wbBuildAllWorlds;
window.__presetList = () => aiCfg.presets;
window.__activePreset = activePreset;
window.__mainPromptPreview = mainPromptPreview;
window.__worldBookPreview = worldBookPreview;
window.__readCfg = readCfg;
window.__saveWb = saveWb;
window.__storageUsage = storageUsage;
window.__storageDiagnostics = storageDiagnostics;
window.__appErrorDiagnostics = typeof appErrorDiagnostics === 'function' ? appErrorDiagnostics : function () { return null; };
window.__i18nLocale = function () { return typeof I18n !== 'undefined' ? I18n.localeId() : 'zh-CN'; };
window.__i18nT = function (key, params) { return typeof I18n !== 'undefined' ? I18n.t(key, params) : key; };
window.__i18nSetLocale = function (id, mode) { return typeof I18n !== 'undefined' ? I18n.setLocale(id, mode) : Promise.resolve(false); };
window.__i18nAvailable = function () { return typeof I18n !== 'undefined' ? I18n.available() : []; };
window.__i18nImportPack = function (pack) { return typeof I18n !== 'undefined' ? I18n.importPack(pack) : Promise.resolve({ ok: false, code: 'LOCALE_INVALID' }); };
window.__i18nDiagnostics = function () { return typeof I18n !== 'undefined' ? I18n.diagnostics() : null; };
window.addEventListener('localechange', function () {
  try { if (typeof nsfwBtn !== 'undefined' && nsfwBtn) nsfwBtn.innerHTML = '<span class="dot"></span>' + (state.nsfwOn ? t('ui.header.adultOn') : t('ui.header.adult')); } catch (e) {}
  try { if (typeof setAppMode === 'function') setAppMode(appMode || 'tag'); } catch (e) {}
  try { if (typeof render === 'function') render(); } catch (e) {}
  try { if (typeof renderCustomList === 'function') renderCustomList(); } catch (e) {}
  try { if (typeof renderCatOptions === 'function') renderCatOptions(); } catch (e) {}
  try { if (typeof renderMgr === 'function') renderMgr(); } catch (e) {}
  try { if (typeof renderTalkSidebar === 'function') renderTalkSidebar(); } catch (e) {}
  try { if (typeof renderWorldSelector === 'function') renderWorldSelector(); } catch (e) {}
  try { if (typeof renderWorldCards === 'function') renderWorldCards(); } catch (e) {}
  try { if (typeof renderWbTitle === 'function') renderWbTitle(); } catch (e) {}
  try { if (typeof renderTranslationTags === 'function' && translateInput && translateInput.value) renderTranslationTags(translateInput.value); } catch (e) {}
  try { if (typeof applyTheme === 'function') applyTheme(); } catch (e) {}
});
if (typeof I18n !== 'undefined' && I18n.init) I18n.init().catch(function () {});
window.__imageStore = ImageStore;
window.__idb = IDB;
window.__persistWithImageRefs = persistWithImageRefs;
window.__restoreImageRefs = restoreImageRefs;
window.__genConvData = () => genConvData;
window.__aiJobs = () => AIJobController.active();

// 模式滑块初始定位 + 窗口缩放适配
setTimeout(function () { if (typeof updateTkThumb === 'function') updateTkThumb(); }, 60);
window.addEventListener('resize', function () { if (typeof updateTkThumb === 'function') updateTkThumb(); });
