/* ================= 提示词组装器（4 提示词槽 + 模块相位 + 勾选矩阵，提示词自由组合） ================= */
'use strict';
// 4 个提示词槽：kind(gen/vision/sys) + 默认注入模块(mods)。get() 返回该槽当前文本。
var PROMPT_SLOTS = [
  { id: 'text2img', label: '文生图主提示词（基础提示词 + 生成Tag指令）', kind: 'gen',    mods: ['gen', 'rk'],  get: function () { return effectiveSys() + '\n\n' + effectiveGenTask(); } },
  { id: 'quality',  label: '画师主提示词（质量词与画师）',               kind: 'gen',    mods: ['gen', 'rk'],  get: function () { return effectiveQp(); } },
  { id: 'vision',   label: '识图提示词（识图指令）',                     kind: 'vision', mods: ['rk'],         get: function () { return effectiveVision(); } },
  { id: 'system',   label: '系统提示词（ComfyUI 调用与迭代）',           kind: 'sys',    mods: ['comfy'],       get: function () { return comfySys(); } }
];
// 模块相位：每模块由若干「相位」组成，每相位声明取哪些主集合条目(special)
// 识图复刻 = 先识图后生成（天然撤下识图提示词）；迭代 = 仅系统提示词；助手 = 空白画布
var MODE_PHASES = {
  talk:  [],
  // 自由问答仍需要沿用生成类的基础规则，但任务指令改用 CHAT_TASK。
  chat:  [['base', 'quality']],
  gen:   [['base', 'quality', 'genTask']],
  rk:    [['vision'], ['base', 'quality', 'genTask']],
  comfy: [['system']]
};
var PMOD_KEY = 'dbt_prompt_mods_v1';
function promptMods() { return loadJSON(PMOD_KEY, {}) || {}; }
function getSlotMods(id) {
  const m = promptMods();
  if (Array.isArray(m[id])) return m[id].slice();
  const d = PROMPT_SLOTS.find(s => s.id === id);
  return (d && d.mods) ? d.mods.slice() : [];
}
function setSlotMods(id, mods) {
  const m = promptMods(); m[id] = (mods || []).slice(); saveJSON(PMOD_KEY, m);
}
function resetPromptMods() {
  const m = {}; PROMPT_SLOTS.forEach(s => { m[s.id] = s.mods.slice(); }); saveJSON(PMOD_KEY, m);
}
// 严格库内：生成类阶段的标签池（用户明确 Tag + 候选 / 识图得到的 Tag）
function strictTagPoolBlock(ctx) {
  ctx = ctx || {};
  if (ctx.strict === undefined ? !aiStrict.checked : !ctx.strict) return '';
  let s = '';
  if (ctx.tagPool !== undefined) {
    if (ctx.tagPool.length) s += '\n\n【本地识图得到的 Tag（供参考，请结合图片与描述选用、修正、补充，勿照单全收）】\n' +
      ctx.tagPool.map(t => t.en + (t.zh ? '（' + t.zh + '）' : '')).join(', ');
    else s += '\n\n（本次未提取到本地识图 Tag，可自由使用常见 Danbooru 标签。）';
  } else {
    const userTags = extractUserTags(ctx.text || '');
    const pool = matchTagsForText(ctx.text || '');
    const userEn = new Set(userTags.map(t => t.en));
    const cand = pool.filter(t => !userEn.has(t.en));
    if (userTags.length) s += '\n\n【用户明确写出的 Tag（必须原样保留并优先使用；若用户对其有否定/排除/替换表述，请按用户意图处理）】\n' + userTags.map(t => t.en + (t.zh ? '（' + t.zh + '）' : '')).join(', ');
    if (cand.length) s += '\n\n【关键词匹配到的候选 Tag（供参考，仅选用与用户描述相关的；"严格库内"已开启：除用户明确写出的 Tag 外，其余 Tag 应优先从候选列表选取，库中没有的概念用简短"名词+关系"自然语言描述）】\n' + cand.map(t => t.en + (t.zh ? '（' + t.zh + '）' : '')).join(', ');
    if (!userTags.length && !cand.length) s += '\n\n（"严格库内"已开启）本次未匹配到相关标签，可选用常见 Danbooru 标签并注明"（库外）"。';
  }
  return s;
}
// 组装：按 模式 → 相位 → 从「主集合(条目级启用对象)」收集；gen 类加 拓展集合(整本级) + 政策 + 严格库
function composeSystemInternal(mode, ctx) {
  ctx = ctx || {};
  if (mode === 'assist') return TALK_ASSIST_SYS;         // 助手：空白画布/纯对话基线
  // ComfyUI 的系统提示词包含工具协议和迭代循环，保持唯一实现；集合页仍可通过该入口取到同一份文本。
  if (mode === 'comfy') return comfySys();
  const moduleMode = mode === 'chat' ? 'gen' : mode;
  const phases = MODE_PHASES[mode] || [];
  const kinds = phases[ctx.phase || 0] || [];
  const main = buildMainCollection();
  let s = '';
  let taskText = '';
  for (const sp of kinds) {
    const e = main.entries.find(x => x.special === sp);
    if (!e || !e.content) continue;
    if (!Array.isArray(e.mods) || e.mods.indexOf(moduleMode) < 0) continue;
    if (sp === 'genTask') { taskText = e.content; continue; }  // 任务指令放固定层之后
    s += (s ? '\n\n' : '') + e.content;
  }
  // gen 类：拓展集合（整本级启用对象）+ 内容政策 + 严格库 + 生成任务指令
  if (kinds.indexOf('base') >= 0 || kinds.indexOf('quality') >= 0) {
    const wb = [];
    for (const c of buildExtCollections()) {
      if (c.enabled === false) continue;
      if (Array.isArray(c.call.mods) && c.call.mods.length && c.call.mods.indexOf(moduleMode) < 0) continue;
      const t = String(ctx.text || ctx.desc || '').toLowerCase();
      for (const e of c.entries || []) {
        if (e.enabled === false) continue;
        if (Array.isArray(e.mods) && e.mods.length && e.mods.indexOf(moduleMode) < 0) continue;
        if (e.constant) { wb.push(e); continue; }
        const keys = String(e.keys || '').split(/[\s,，、]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
        if (keys.length && t && keys.some(k => t.includes(k))) wb.push(e);
      }
    }
    if (wb.length) {
      wb.sort((a, b) => (a.order || 0) - (b.order || 0));   // 优先级排序
      s += '\n\n【拓展提示词（补充规则，优先级高于基础提示词中冲突的部分）】' + wbBlock(wb);
    }
    s += '\n\n' + (state.nsfwOn ? NSFW_ALLOW : NSFW_GUARD);
    s += strictTagPoolBlock(ctx);
  }
  if (mode === 'chat') s += '\n\n' + CHAT_TASK;
  else if (taskText) s += '\n\n' + taskText;
  return s;
}
// 统一提示词编译入口。所有业务模式都先经过同一份上下文归一化，
// 保留 composeSystem 兼容函数名，避免旧导入 / 测试钩子失效。
var PromptCompiler = {
  normalize: function (mode, ctx) {
    ctx = ctx || {};
    const phase = Number.isFinite(Number(ctx.phase)) ? Math.max(0, Math.floor(Number(ctx.phase))) : 0;
    const tagPool = Array.isArray(ctx.tagPool) ? ctx.tagPool.map(function (t) {
      return typeof t === 'string' ? { en: t, zh: '' } : { en: String(t && (t.en || t.tag) || ''), zh: String(t && t.zh || '') };
    }).filter(function (t) { return t.en; }) : undefined;
    return {
      mode: mode || 'gen', phase,
      text: String(ctx.text == null ? (ctx.desc == null ? '' : ctx.desc) : ctx.text),
      desc: String(ctx.desc == null ? '' : ctx.desc),
      strict: ctx.strict === undefined ? undefined : !!ctx.strict,
      tagPool
    };
  },
  compile: function (mode, ctx) {
    const c = this.normalize(mode, ctx);
    return composeSystemInternal(c.mode, c);
  },
  inspect: function (mode, ctx) {
    const c = this.normalize(mode, ctx);
    return { mode: c.mode, phase: c.phase, text: c.text, system: composeSystemInternal(c.mode, c) };
  }
};
function composeSystem(mode, ctx) { return PromptCompiler.compile(mode, ctx); }
// 主提示词条目级「启用对象」：勾选 = 该条提示词注入对应模块（渲染在每条 pmod-lead 内）
var PMOD_MODULES = [['talk', '助手'], ['gen', '生成Tag'], ['rk', '复刻'], ['comfy', '迭代']];
function renderPromptMods() {
  document.querySelectorAll('.pmod-mods').forEach(function (el) {
    const special = el.parentElement.getAttribute('data-special') || '';
    const slot = special === 'base' || special === 'genTask' ? 'text2img' : special;
    el.replaceChildren();
    el.appendChild(UI.el('span', 'pmod-mods-label', '启用对象：'));
    PMOD_MODULES.forEach(function (mm) {
      const mod = mm[0], name = mm[1];
      const ck = UI.el('label', 'pmod-chk');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = getSlotMods(slot).indexOf(mod) >= 0;
      input.addEventListener('change', function () {
        const set = new Set(getSlotMods(slot));
        if (input.checked) set.add(mod); else set.delete(mod);
        setSlotMods(slot, Array.from(set));
      });
      ck.appendChild(input);
      ck.appendChild(UI.el('span', null, name));
      el.appendChild(ck);
    });
  });
}
(function () {
  const resetBtn = document.getElementById('promptModReset');
  if (resetBtn) resetBtn.onclick = function () { resetPromptMods(); renderPromptMods(); toast('已恢复默认启用对象'); };
  renderPromptMods();
})();
