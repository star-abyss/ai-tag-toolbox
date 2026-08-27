/* ================= 配置服务（单点读写 + effective 缓存） ================= */
/* readCfg：从 UI 表单同步到 aiCfg 并持久化（原散落在 ai-core 的定义收敛于此） */
'use strict';
var CONFIG = {
  _v: {},   // 字段版本缓存
  _c: {},   // effective 结果缓存
  _chg: function (k, v) { if (this._v[k] !== v) { this._v[k] = v; return true; } return false; }
};
var AI_KEY_STATE = { configured: false, available: false, write: Promise.resolve(), error: '' };
function renderAiKeyStatus() {
  const el = document.getElementById('aiKeyStatus');
  const input = document.getElementById('aiKey');
  if (!el) return;
  if (!AI_KEY_STATE.available) {
    el.textContent = '系统安全存储不可用：请重启应用后重试';
    el.className = 'secret-status error';
  } else if (AI_KEY_STATE.configured) {
    el.textContent = 'Key 已保存在系统安全存储中；输入新值可替换';
    el.className = 'secret-status ok';
  } else {
    el.textContent = '尚未保存 Key；本地 Ollama 可留空';
    el.className = 'secret-status';
  }
  if (input && !input.value) input.placeholder = AI_KEY_STATE.configured ? '已安全保存（重新输入可替换）' : '输入后安全保存（不会写入普通配置）';
}
function queueSecureAiKey(value) {
  const key = String(value == null ? '' : value).trim();
  if (!window.aiTag || !window.aiTag.ai || typeof window.aiTag.ai.keySet !== 'function') {
    AI_KEY_STATE.error = '当前运行环境不支持安全保存 API Key';
    return Promise.reject(new Error(AI_KEY_STATE.error));
  }
  AI_KEY_STATE.write = AI_KEY_STATE.write.then(async () => {
    const r = await window.aiTag.ai.keySet(key);
    if (!r || !r.ok) throw new Error((r && r.error) || 'API Key 保存失败');
    AI_KEY_STATE.configured = !!r.configured;
    AI_KEY_STATE.error = '';
    renderAiKeyStatus();
    return r;
  }).catch(e => { AI_KEY_STATE.error = typeof appErrorSummary === 'function' ? appErrorSummary(e, '保存 API Key') : String(e && e.message || e); throw e; });
  return AI_KEY_STATE.write;
}
async function initSecureAiKey() {
  if (!window.aiTag || !window.aiTag.ai || typeof window.aiTag.ai.keyStatus !== 'function') return;
  try {
    const status = await window.aiTag.ai.keyStatus();
    AI_KEY_STATE.available = !!(status && status.available);
    AI_KEY_STATE.configured = !!(status && status.configured);
    renderAiKeyStatus();
    if (legacyAiKey) {
      const migrated = await queueSecureAiKey(legacyAiKey);
      if (migrated && migrated.ok) {
        legacyAiKey = '';
        delete aiCfg.key;
        saveJSON(LS_AI, aiCfg);
      }
    } else if (Object.prototype.hasOwnProperty.call(aiCfg, 'key')) {
      delete aiCfg.key;
      saveJSON(LS_AI, aiCfg);
    }
    renderAiKeyStatus();
  } catch (e) {
    AI_KEY_STATE.error = typeof appErrorSummary === 'function' ? appErrorSummary(e, '读取 API Key 状态') : String(e && e.message || e);
    renderAiKeyStatus();
  }
}
function saveAiKeyFromInput() {
  const value = aiKey && aiKey.value ? aiKey.value.trim() : '';
  if (!value) return AI_KEY_STATE.write;
  const p = queueSecureAiKey(value);
  // readCfg 保持同步 API；提前挂上处理器避免用户只改配置、不发请求时出现未处理拒绝。
  p.catch(() => {});
  // 只有安全保存成功后才清空输入框；失败时保留输入，便于用户重试。
  p.then(() => {
    if (aiKey && aiKey.value.trim() === value) aiKey.value = '';
    renderAiKeyStatus();
  }).catch(() => {});
  renderAiKeyStatus();
  return p;
}
function readCfg() {
  aiCfg.base = aiBase.value.trim().replace(/\/+$/, '');
  saveAiKeyFromInput();
  delete aiCfg.key;
  aiCfg.model = modelVal();
  aiCfg.strict = aiStrict.checked;
  const sp = aiSys.value.trim();
  aiCfg.sysPrompt = sp === DEFAULT_BASE_PROMPT.trim() ? '' : sp;
  const qp = qpText.value.trim();
  aiCfg.qualityPrefix = qp === DEFAULT_QP.trim() ? '' : qp;
  const vp = aiVision.value.trim();
  aiCfg.visionPrompt = vp === DEFAULT_VISION_PROMPT.trim() ? '' : vp;
  const gt = genTask.value.trim();
  aiCfg.genTask = gt === GEN_TASK.trim() ? '' : gt;
  aiCfg.comfyBase = comfyBase.value.trim() || DEFAULT_CFG.comfyBase;
  aiCfg.comfyOn = comfyOn.checked;
  aiCfg.comfyIters = Math.max(1, parseInt(talkIters.value) || 3);
  aiCfg.comfyW = Math.max(64, parseInt(comfyW.value) || 768);
  aiCfg.comfyH = Math.max(64, parseInt(comfyH.value) || 1024);
  aiCfg.comfySteps = Math.max(1, parseInt(comfySteps.value) || 25);
  aiCfg.comfyCfg = parseFloat(comfyCfg.value) || 7;
  aiCfg.comfyPos = comfyPos.value;
  aiCfg.comfyNeg = comfyNeg.value;
  aiCfg.comfyWorkflow = comfyWf.value.trim();
  saveJSON(LS_AI, aiCfg);
}
// effective*：基于字段版本缓存，仅在对应字段变化时重建（主提示词/识图/质量词文本很长）
function effectiveSys() {
  if (CONFIG._chg('sp', aiCfg.sysPrompt || '')) CONFIG._c.sp = (aiCfg.sysPrompt && aiCfg.sysPrompt.trim()) || DEFAULT_BASE_PROMPT;
  return CONFIG._c.sp;
}
function effectiveQp() {
  if (CONFIG._chg('qp', aiCfg.qualityPrefix || '')) CONFIG._c.qp = (aiCfg.qualityPrefix && aiCfg.qualityPrefix.trim()) || DEFAULT_QP;
  return CONFIG._c.qp;
}
function effectiveVision() {
  if (CONFIG._chg('vp', aiCfg.visionPrompt || '')) CONFIG._c.vp = (aiCfg.visionPrompt && aiCfg.visionPrompt.trim()) || DEFAULT_VISION_PROMPT;
  return CONFIG._c.vp;
}
function effectiveGenTask() {
  if (CONFIG._chg('gt', aiCfg.genTask || '')) CONFIG._c.gt = (aiCfg.genTask && aiCfg.genTask.trim()) || GEN_TASK;
  return CONFIG._c.gt;
}
