'use strict';
/* ================= AI 助手事件 ================= */
var aiView = $('#aiView'), wrapEl = $('#wrapEl'), mainEl = document.querySelector('main.main'), searchWrap = $('#searchWrap'),
  aiCfgBtns = $('#aiCfgBtns'), catList = $('#catList'), addTagBtn = $('#addTagBtn'),
  sideAi = $('#sideAi'), aiModuleTabs = Array.from(document.querySelectorAll('.ai-module-tab')),
  aiModuleThumb = aiCfgBtns ? aiCfgBtns.querySelector('.ai-module-thumb') : null,
  barEl = document.querySelector('.bar');
wrapEl.appendChild(aiView); // AI 视图嵌入主区
var appMode = 'tag';
// 单壳双模式：标签库 ↔ AI（顶导航 + 左侧分类/对话管理 + 主区）
function setAppMode(m) {
  if (m === 'ai' && typeof closeTranslation === 'function' && typeof translationOpen !== 'undefined' && translationOpen) closeTranslation();
  appMode = m;
  const ai = m === 'ai';
  document.body.classList.toggle('aiview', ai);
  mainEl.style.display = ai ? 'none' : '';
  aiView.style.display = ai ? '' : 'none';
  searchWrap.style.display = ai ? 'none' : '';
  aiCfgBtns.style.display = ai ? '' : 'none';
  catList.style.display = ai ? 'none' : '';
  addTagBtn.style.display = ai ? 'none' : '';
  sideAi.style.display = ai ? '' : 'none';
  if (barEl) barEl.style.display = ai ? 'none' : '';
  // 顶部导航保持同一组控件：搜索槽位由 AI 模块切换器接管，
  // AI 按钮本身只改变文案和动作，避免进入 AI 后其它按钮整体位移。
  const aiBtn = $('#aiBtn');
  if (aiBtn) {
    aiBtn.textContent = ai ? t('ui.header.backHome') : t('ui.header.aiAssistant');
    aiBtn.title = ai ? t('ui.header.backHome') : t('ui.header.aiAssistant');
    aiBtn.setAttribute('aria-label', ai ? t('ui.header.backHome') : t('ui.header.aiAssistant'));
  }
  // 翻译入口在两种主模式下都保留，确保导航位置稳定；进入翻译页时
  // 翻译模块自身会接管页面内容并提供返回标签库按钮。
  const translateBtn = $('#translateBtn');
  if (translateBtn) translateBtn.style.display = '';
  if (ai) {
    talkProbe();
    renderTalkSidebar();
    requestAnimationFrame(updateAiModuleThumb);
    // AI 视图此前处于 display:none，启动阶段计算出的模式滑块宽度为 0。
    // 等视图显示后重新定位，并确保无效状态回到默认的助手模式。
    requestAnimationFrame(() => {
      if (typeof talkMode !== 'string' || !['assist', 'gen', 'rk', 'comfy'].includes(talkMode)) talkMode = 'assist';
      if (typeof tkModes !== 'undefined') tkModes.forEach(x => x.classList.toggle('on', x.dataset.mode === talkMode));
      if (typeof updateTkThumb === 'function') updateTkThumb();
    });
    if (talkIn) talkIn.focus();
  }
  else render();
}
$('#aiBtn').onclick = () => setAppMode(appMode === 'ai' ? 'tag' : 'ai');
$('#aiClose').onclick = () => setAppMode('tag');
// AI 视图内面板：对话 / 提示词（世界书） / API与ComfyUI 配置
var aiPanel = 'talk';
function showAiPanel(p) {
  if (!['api', 'prompt', 'talk'].includes(p)) p = 'talk';
  aiPanel = p;
  $('#tabTalk').style.display = p === 'talk' ? '' : 'none';
  $('#tabPrompt').style.display = p === 'prompt' ? '' : 'none';
  $('#tabApi').style.display = p === 'api' ? '' : 'none';
  aiModuleTabs.forEach(b => {
    const active = b.dataset.panel === p;
    b.classList.toggle('on', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  updateAiModuleThumb();
  if (p === 'talk') talkProbe();
}
function updateAiModuleThumb() {
  if (!aiCfgBtns || !aiModuleThumb) return;
  const active = aiModuleTabs.find(b => b.dataset.panel === aiPanel);
  if (!active) return;
  aiModuleThumb.style.left = active.offsetLeft + 'px';
  aiModuleThumb.style.width = active.offsetWidth + 'px';
}
aiModuleTabs.forEach(b => {
  b.onclick = () => {
    if (appMode !== 'ai') setAppMode('ai');
    showAiPanel(b.dataset.panel);
  };
});
$('#apiBack').onclick = () => showAiPanel('talk');
$('#promptBack').onclick = () => showAiPanel('talk');
function switchAiTab(t) { showAiPanel(t); }
document.querySelectorAll('.aitab').forEach(b => { b.onclick = () => switchAiTab(b.dataset.tab); });
window.addEventListener('resize', updateAiModuleThumb);
aiPreset.addEventListener('change', () => {
  if (aiPreset.value) aiBase.value = aiPreset.value;
  // 切换服务商后，模型下拉只显示该家的模型，并自动选中第一家
  renderModelSelect(aiBase.value.trim().replace(/\/+$/, ''));
  aiModelCustom.style.display = 'none';
  aiModelCustom.value = '';
});
if (aiTimeoutEnabled && aiTimeoutSec) aiTimeoutEnabled.addEventListener('change', () => {
  aiTimeoutSec.disabled = !aiTimeoutEnabled.checked;
  readCfg();
});
if (aiTimeoutSec) aiTimeoutSec.addEventListener('change', () => {
  aiTimeoutSec.value = String(Math.max(300, Math.min(3600, parseInt(aiTimeoutSec.value, 10) || 300)));
  readCfg();
});
$('#aiClearCfg').onclick = () => {
  aiCfg.base = DEFAULT_CFG.base; aiCfg.model = DEFAULT_CFG.model; aiCfg.strict = true;
  aiCfg.timeoutEnabled = DEFAULT_CFG.timeoutEnabled; aiCfg.timeoutSec = DEFAULT_CFG.timeoutSec;
  aiCfg.comfyBase = DEFAULT_CFG.comfyBase; aiCfg.comfyOn = false; aiCfg.comfyIters = 3;
  aiCfg.comfyW = 768; aiCfg.comfyH = 1024; aiCfg.comfySteps = 25; aiCfg.comfyCfg = 7; aiCfg.comfyWorkflow = ''; aiCfg.comfyPos = ''; aiCfg.comfyNeg = '';
  saveJSON(LS_AI, aiCfg);
  if (window.aiTag && window.aiTag.ai && typeof window.aiTag.ai.keyClear === 'function') {
    AI_KEY_STATE.write = AI_KEY_STATE.write.catch(() => {}).then(() => window.aiTag.ai.keyClear()).then(() => { AI_KEY_STATE.configured = false; renderAiKeyStatus(); }).catch(() => {});
  }
  aiBase.value = DEFAULT_CFG.base; aiKey.value = ''; aiKey.placeholder = '输入后安全保存（不会写入普通配置）'; setModelVal(DEFAULT_CFG.model);
  aiStrict.checked = true;
  if (aiTimeoutEnabled) aiTimeoutEnabled.checked = DEFAULT_CFG.timeoutEnabled;
  if (aiTimeoutSec) aiTimeoutSec.value = String(DEFAULT_CFG.timeoutSec);
  comfyBase.value = DEFAULT_CFG.comfyBase; comfyOn.checked = false;
   comfyW.value = 768; comfyH.value = 1024; comfySteps.value = 25; comfyCfg.value = 7;
  comfyPos.value = ''; comfyNeg.value = ''; comfyWf.value = '';
  const o = [...aiPreset.options].find(x => x.value === DEFAULT_CFG.base);
  aiPreset.value = o ? o.value : '';
  toast('已恢复默认 API 设置（提示词与世界书不受影响）');
};
if (aiKeyClear) aiKeyClear.onclick = async () => {
  if (!window.aiTag || !window.aiTag.ai || typeof window.aiTag.ai.keyClear !== 'function') return toast('当前环境不支持安全 Key 管理');
  aiKeyClear.disabled = true;
  try {
    await (AI_KEY_STATE.write || Promise.resolve());
    const r = await window.aiTag.ai.keyClear();
    if (!r || !r.ok) throw new Error((r && r.error) || '清除失败');
    AI_KEY_STATE.configured = false;
    aiKey.value = '';
    renderAiKeyStatus();
    toast('已清除系统安全存储中的 API Key');
  } catch (e) {
    toast(typeof formatAppError === 'function' ? formatAppError(e, '清除 API Key') : ('清除 API Key 失败：' + (e && e.message || e)));
  } finally { aiKeyClear.disabled = false; }
};
aiSysReset.onclick = () => {
  aiSys.value = DEFAULT_BASE_PROMPT;
  aiCfg.sysPrompt = '';
  saveJSON(LS_AI, aiCfg);
  toast('已重置为默认提示词');
};
qpReset.onclick = () => {
  qpText.value = DEFAULT_QP;
  aiCfg.qualityPrefix = '';
  saveJSON(LS_AI, aiCfg);
  toast('已重置质量词与画师');
};
aiVisionReset.onclick = () => {
  aiVision.value = DEFAULT_VISION_PROMPT;
  aiCfg.visionPrompt = '';
  saveJSON(LS_AI, aiCfg);
  toast('已重置为默认识图提示词');
};
// 生成页动作：gen（默认=绘图指令）/ rk（识图→绘图，两次调用）
async function genSend(mode) {
  const t = genDesc.value.trim();
  if (!t && !genPendingImgs.length) return toast('请描述想画的画面，或先添加图片');
  if (mode === 'rk' && !genPendingImgs.length) return toast('识图并复刻需要先添加图片');
  genDesc.value = '';
  const imgs = genPendingImgs.slice();
  const metas = genImgMetas.slice();
  genPendingImgs = [];
  genImgMetas = [];
  refreshGenImgs();
  // ① 附图编号 + 每张图识图 Tag（带图即生成：gen / desc / rk 通用，供 AI 稳定引用"图片X"）
  let imgRef = '', imgTags = [];
  let wdTags = [];
  let wdSource = '';
  if (imgs.length) {
    const r = await imgRefBlock(imgs, metas);
    imgRef = r.ref; imgTags = r.per;
  }
  if (mode === 'rk' && imgs.length) {
    const meta = metas[0];
    if (meta && meta.tags && meta.tags.length) {
      wdTags = metaToTags(meta);
      wdSource = '图片内置（' + (meta.source || 'AI 原图') + '）';
      toast('已解析图片内置 ' + meta.tags.length + ' 个 Tag');
    } else if (window.aiTag) {
      toast('🔍 本地识图提取初步 Tag…');
      try {
        const tags = await runLocalTag(imgs[0]);
        if (tags && tags.length) { wdTags = tags; wdSource = 'WD Tagger'; }
      } catch (e) { toast(typeof formatAppError === 'function' ? formatAppError(e, '本地识图') : ('本地识图失败：' + (e && e.message || e))); }
    }
  }
  genConvData.push({ kind: 'user', text: t, imgs, metas, mode, wdTags, wdSource, imgRef, imgTags, ts: Date.now() });
  persistGenConv(); renderGenConv();
  genRun(genConvData.length - 1, mode);
}
genGoBtn.onclick = () => genSend('gen');
genRkGo.onclick = () => genSend('rk');
genStopBtn.onclick = () => { if (genAbort) genAbort.abort(); };
// 重新生成（roll）：对最近一条用户消息重新执行
genRedo.onclick = () => {
  if (genBusy) return toast('AI 正在生成，请等待完成');
  let lastIdx = -1;
  for (let i = genConvData.length - 1; i >= 0; i--) {
    if (genConvData[i] && genConvData[i].kind === 'user') { lastIdx = i; break; }
  }
  if (lastIdx < 0) return toast('还没有可重新生成的对话');
  genRun(lastIdx, genConvData[lastIdx].mode || 'gen');
};
genImgBtn.onclick = () => {
  if (genBusy) return toast('AI 正在生成，请等待完成');
  const remain = MAX_IMGS - genPendingImgs.length;
  if (remain <= 0) return toast('一次最多 ' + MAX_IMGS + ' 张图片');
  pickImages(genImgFile, remain, addGenImg);
};
chatImgBtn.onclick = () => {
  if (chatBusy) return toast('AI 正在回复，请等待完成');
  const remain = MAX_IMGS - chatPendingImgs.length;
  if (remain <= 0) return toast('一次最多 ' + MAX_IMGS + ' 张图片');
  pickImages(chatImgFile, remain, addChatImg);
};
// 在 AI 模式里直接 Ctrl+V 粘贴图片（归入统一对话附图，自动解析 AI 原图内置 Tag）
document.addEventListener('paste', e => {
  const cd = e.clipboardData;
  if (!cd || !cd.items) return;
  const files = [];
  for (const it of Array.from(cd.items)) {
    if (it.kind === 'file' && it.type && String(it.type).indexOf('image/') === 0 && typeof it.getAsFile === 'function') {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (!files.length) return;
  if (appMode !== 'ai') return; // 仅在 AI 模式接收粘贴图片
  e.preventDefault();
  for (const f of files) {
    if (f.size > 10 * 1024 * 1024) { toast('图片过大（>10MB）已跳过'); continue; }
    fileToDataURL(f).then(async url => {
      if (!url) return;
      const meta = await pngMetaFromFile(f);
      addTalkImg(url, meta);
    });
  }
});
// 拖入图片：识图模块放置区（高亮 + 接收）
function bindDropZone(el, maxN, addFn) {
  el.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('dragging'); });
  el.addEventListener('dragleave', e => { if (e.target === el) el.classList.remove('dragging'); });
  el.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation(); // 放置区内自行处理，避免冒泡到全局 drop 重复添加
    el.classList.remove('dragging');
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter(f => f.type && String(f.type).indexOf('image/') === 0);
    if (!files.length) return;
    if (files.length > maxN) toast('一次最多 ' + maxN + ' 张图片，多余部分已忽略');
    for (const f of files.slice(0, maxN)) {
      if (f.size > 10 * 1024 * 1024) { toast('图片过大（>10MB）已跳过：' + (f.name || '')); continue; }
      fileToDataURL(f).then(async url => {
        if (!url) return;
        const meta = await pngMetaFromFile(f);
        addFn(url, meta);
      });
    }
  });
}
bindDropZone(visDrop, MAX_IMGS, addVisImg);
// 放置区点击：引导用户粘贴 / 拖入（上传请用下方「上传图片」按钮）
visDrop.addEventListener('click', () => {
  toast('直接 Ctrl+V 粘贴图片，或把图片拖入此区域；上传请点下方「上传图片」按钮');
});
// 全局拖拽：图片拖到 AI 弹窗任意位置都能放入（按当前页签路由到对应模块）
var dragHlEl = null;
function dropTargetEl() {
  if ($('#tabChat').style.display !== 'none') return chatBoxEl;
  if ($('#tabVis').style.display !== 'none') return visDrop;
  if ($('#tabTalk').style.display !== 'none') return talkConv;
  return genConv;
}
document.addEventListener('dragover', e => {
  if (appMode !== 'ai') return;
  if (!(e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  if (!dragHlEl) {
    const el = dropTargetEl();
    if (el && el !== visDrop) { el.classList.add('dragging'); dragHlEl = el; }
  }
});
document.addEventListener('dragleave', e => {
  if (!e.relatedTarget && dragHlEl) { dragHlEl.classList.remove('dragging'); dragHlEl = null; }
});
document.addEventListener('drop', e => {
  if (dragHlEl) { dragHlEl.classList.remove('dragging'); dragHlEl = null; }
  if (appMode !== 'ai') return;
  if (visDrop.contains(e.target)) return; // 放置区已自行处理
  const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter(f => f.type && String(f.type).indexOf('image/') === 0);
  if (!files.length) return;
  e.preventDefault();
  for (const f of files) {
    if (f.size > 10 * 1024 * 1024) { toast('图片过大（>10MB）已跳过'); continue; }
    fileToDataURL(f).then(async url => {
      if (!url) return;
      const meta = await pngMetaFromFile(f);
      addTalkImg(url, meta);
    });
  }
});
// 新对话：弹出两个选择——保留存档 / 删除重开
genNewBtn.onclick = () => { genNewMenu.hidden = !genNewMenu.hidden; };
genNewKeep.onclick = () => {
  genNewMenu.hidden = true;
  if (genBusy && genAbort) genAbort.abort();
  archiveCurrentGen(false);
};
genNewDrop.onclick = () => {
  genNewMenu.hidden = true;
  if (genBusy && genAbort) genAbort.abort();
  genConvData = [];
  genPendingImgs = [];
  refreshGenImgs();
  persistGenConv(); renderGenConv(); renderMgr();
  toast('已删除当前对话并开启新对话');
};
document.addEventListener('click', e => {
  if (!e.target.closest('.gennew-wrap')) genNewMenu.hidden = true;
});
aiTestBtn.onclick = aiTest;
chatSendBtn.onclick = chatSend;
chatIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSend(); } });
chatIn.addEventListener('input', () => { renderWbMatch(); autoGrowChatIn(); });
chatClearBtn.onclick = () => { chatReset(); toast('对话已清空'); };
genDesc.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); genGoBtn.click(); } });
genDesc.addEventListener('input', renderWbMatch);
wbAdd.onclick = () => {
  getActiveEntries().push({ id: 'wb_' + Date.now(), name: '新条目', keys: '', content: '', constant: false, enabled: true });
  saveWb(); renderWb();
  toast('已新建规则条目');
};
wbFoldAll.onclick = () => {
  const entries = getActiveEntries();
  const anyOpen = entries.some(e => !e.collapsed);
  entries.forEach(e => { e.collapsed = anyOpen; });
  saveWb(); renderWb();
  wbFoldAll.textContent = anyOpen ? '全部展开' : '全部折叠';
};
