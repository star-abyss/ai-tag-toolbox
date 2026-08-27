'use strict';
/* ================= 统一对话工作台（生成Tag / 本地识图 / 识图并复刻 / ComfyUI迭代 / 助手对话） ================= */
var LS_TALK = 'dbt_talk_v2';
var TALK_ASSIST_SYS = `你是 AI 绘画 Tag 工具箱的助手（助手模式）。本模式不注入任何预设提示词与规则：请根据用户消息直接对话，保持简洁专业。
【附图引用约定】用户附图消息会附带"【附图组】"标注（图片1=第1张、图片2=第2张……含每张图的本地识图 Tag）。用户说"图片X/这张图"指最近一条附图消息里的第X张；"上一组/之前的图"指更早消息的附图组。涉及图片修改时先明确引用编号。`;
var TALK_INTRO = '上传 / 粘贴 / 拖入图片（自动编号 + 本地识图 Tag），然后选下方模式：✨ 生成Tag · 🔍 本地识图 · 🎯 识图并复刻 · 🎨 ComfyUI迭代 · 🤖 助手对话。';
var LS_TALK_SESS = 'dbt_talk_sessions_v1';
// 多会话（主流 AI 式）：每个会话含标题/时间/消息列表；talkHist = 当前会话的消息引用
var talkSessions = loadJSON(LS_TALK_SESS, null);
if (!Array.isArray(talkSessions) || !talkSessions.length) {
  const oldHist = loadJSON(LS_TALK, []).filter(m => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'rst' || m.role === 'err' || m.role === 'sys') && typeof m.text === 'string');
  const fuTitle = oldHist.find(m => m && m.role === 'user' && m.text && m.text.trim());
  talkSessions = [{ id: 's_' + Date.now(), title: fuTitle ? fuTitle.text.trim().slice(0, 20) : '新对话', ts: Date.now(), messages: oldHist }];
  saveJSON(LS_TALK_SESS, talkSessions);
}
var talkCur = (talkSessions[0] || {}).id;
var talkHist = (talkSessions.find(s => s.id === talkCur) || talkSessions[0]).messages;
function curSessionEl() { return talkSessions.find(s => s.id === talkCur) || talkSessions[0]; }
function titleOf(s) {
  if (s && s.title && s.title.trim() && s.title.trim() !== '新对话') return s.title.trim();
  const fu = (s && s.messages || []).find(m => m && m.role === 'user' && typeof m.text === 'string' && m.text.trim());
  return fu ? fu.text.trim().slice(0, 20) : '新对话';
}
function relTime(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 60e3) return '现在';
  if (d < 36e5) return Math.floor(d / 60e3) + '分前';
  if (d < 864e5) return Math.floor(d / 36e5) + '时前';
  const dt = new Date(ts); return (dt.getMonth() + 1) + '/' + dt.getDate();
}
var talkPendingImgs = [], talkImgMetas = [], talkBusy = false, talkAbort = null;
var talkMode = 'assist';
var talkConv = $('#talkConv'), talkStatus = $('#talkStatus'), talkIn = $('#talkIn'),
  talkImgBtn = $('#talkImgBtn'), talkImgFile = $('#talkImgFile'), talkImgRow = $('#talkImgRow'),
  talkIters = $('#talkIters'), talkSendBtn = $('#talkSendBtn'),
  talkClearBtn = $('#talkClearBtn'), talkNew = $('#talkNew'), talkSessionList = $('#talkSessionList'),
  tagPane = $('#tagPane'), tpImg = $('#tpImg'), tpModes = $('#tpModes'),
  tpPlaceholder = $('#tpPlaceholder');
var tkModes = Array.from(document.querySelectorAll('.tkmode'));
function talkSetStatus(s, cls) {
  if (!talkStatus) return;
  let c = cls || '';
  if (!c) {
    if (/✅/.test(s)) c = 'ok';
    else if (/❌|⚠️/.test(s)) c = 'err';
  }
  // 组件模板：状态点
  const st = UI.statusDot(s == null ? '' : s, c);
  talkStatus.className = st.className;
  talkStatus.replaceChildren(...st.childNodes);
}
talkConv.addEventListener('scroll', () => pinFollow(talkConv));
// 右侧识图面板：顶部固定（图片+按钮），Tag 区标题+复制按钮固定、内容滚动；
// 识图后「内置区」整体折叠，出现「识别区」（各自带独立复制按钮）
var tpBuiltinArr = [], tpModelArr = [], tpIdentified = false;
// 动态 Tag 模块重建时保留用户最后一次折叠状态；null 表示按当前阶段使用默认状态。
var tpFoldState = { builtin: null, model: null };
function buildChips(tags) {
  const chips = UI.el('div', 'wdmsg-tags');
  (tags || []).forEach(t => chips.appendChild(UI.tagChip(t)));
  return chips;
}
function showTagPane(url, builtin, model, identified) {
  tpBuiltinArr = builtin || []; tpModelArr = model || [];
  tpIdentified = !!identified;
  if (!tagPane) return;
  if (url) {
    tpImg.replaceChildren();
    const img = document.createElement('img'); img.className = 'tp-thumb'; img.src = url; img.alt = '当前图片';
    tpImg.appendChild(img);
  } else tpImg.innerHTML = '<div class="tp-empty">未上传图片</div>';
  // 用组件模板动态构建两个折叠模块（标题 + 复制按钮固定，Tag 区滚动）
  const mods = UI.el('div', 'tp-mods');
  const builtinFn = () => copyText(tpBuiltinArr.map(t => t.tag).join(', '), '已复制内置 Tag');
  const modelFn = () => copyText(tpModelArr.map(t => t.tag).join(', '), '已复制识别 Tag');
  if (identified) {
    if (tpBuiltinArr.length) {
      const bm = UI.foldModule('原图内置 Tag', buildChips(tpBuiltinArr), {
        copyFn: builtinFn,
        key: 'builtin',
        collapsed: tpFoldState.builtin == null ? true : tpFoldState.builtin,
        onToggle: v => { tpFoldState.builtin = v; }
      });
      mods.appendChild(bm);
    }
    if (tpModelArr.length) {
      mods.appendChild(UI.foldModule('模型识别 Tag', buildChips(tpModelArr), {
        copyFn: modelFn,
        key: 'model',
        collapsed: tpFoldState.model === true,
        onToggle: v => { tpFoldState.model = v; }
      }));
    }
  } else if (tpBuiltinArr.length) {
    mods.appendChild(UI.foldModule('原图内置 Tag', buildChips(tpBuiltinArr), {
      copyFn: builtinFn,
      key: 'builtin',
      collapsed: tpFoldState.builtin === true,
      onToggle: v => { tpFoldState.builtin = v; }
    }));
  }
  tpModes.replaceChildren(mods);
  tpPlaceholder.style.display = (identified && !tpBuiltinArr.length && !tpModelArr.length) || (!identified && !tpBuiltinArr.length) ? '' : 'none';
}
// 右上角「本地识图」：不发送给 AI，直接在面板里面识图
async function talkIdentify() {
  if (!talkPendingImgs.length) { toast('请先上传图片'); return; }
  if (talkBusy) return;
  const btn = $('#tpIdentify');
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = '识图中…'; }
  talkSetStatus('🔍 本地识图中…');
  const url = talkPendingImgs[talkPendingImgs.length - 1];
  const meta = talkImgMetas[talkImgMetas.length - 1];
  try {
    const ex = await tagExtract([url], [meta]);
    const item = ex[0] || {};
    const builtin = item.builtin || [];
    const model = item.model || [];
    showTagPane(url, builtin, model, true);
    if (item.error && !model.length) {
      talkSetStatus('⚠️ ' + item.error, 'err');
      toast(item.error);
    } else if (!builtin.length && !model.length) {
      talkSetStatus('⚠️ 未识别到 Tag', 'err');
      toast('本地识图未提取到 Tag');
    } else {
      talkSetStatus('✅ 本地识图完成（内置 ' + builtin.length + ' · 识别 ' + model.length + '）');
    }
  } catch (e) {
    const msg = typeof formatAppError === 'function' ? formatAppError(e, '本地识图') : ('本地识图失败：' + (e && e.message || e));
    talkSetStatus('❌ ' + msg, 'err');
    toast(msg);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || '本地识图'; }
  }
}
// 清除右侧面板的图片与识别结果
function tpClearImg() {
  talkPendingImgs = []; talkImgMetas = []; talkRefreshImgs();
  tpBuiltinArr = []; tpModelArr = [];
  tpFoldState = { builtin: null, model: null };
  showTagPane(null, [], [], false);
  talkSetStatus('已清除图片');
}
function talkPersist() {
  persistWithImageRefs(LS_TALK_SESS, talkSessions).then(function (ok) {
    if (!ok) talkPersistLegacyImages();
    renderTalkSidebar();
  }).catch(function () { talkPersistLegacyImages(); renderTalkSidebar(); });
  if (!hasImageData(talkSessions)) renderTalkSidebar();
  return;
  // IndexedDB 不可用时保留旧的配额降级方案。
  function talkPersistLegacyImages() {
    if (saveJSON(LS_TALK_SESS, talkSessions)) return;
    const moves = [];
    talkSessions.forEach((s, si) => (s.messages || []).forEach((m, mi) => {
      if (m && Array.isArray(m.imgs) && m.imgs.length) {
        moves.push(IDB.put('tkimgs_' + s.id + '_' + mi, m.imgs));
        m.imgsIdb = true;
        m.imgs = []; m.imgRef = '';
      }
    }));
    Promise.all(moves).then(() => { saveJSON(LS_TALK_SESS, talkSessions); }).catch(() => {});
  }
}
// 启动时从 IndexedDB 恢复会话图片
talkSessions.forEach((s, si) => (s.messages || []).forEach((m, mi) => {
  if (m && m.imgsIdb && (!m.imgs || !m.imgs.length)) {
    IDB.get('tkimgs_' + s.id + '_' + mi).then(imgs => { if (imgs && imgs.length) { m.imgs = imgs; m.imgsIdb = false; } }).catch(() => {});
  }
}));
restoreImageRefs(talkSessions, function () { talkRender(); persistWithImageRefs(LS_TALK_SESS, talkSessions); }).catch(function () {});
function talkAddMsg(role, text, opts) {
  opts = opts || {};
  const r = UI.bubble(role, text, opts);
  talkConv.appendChild(r.el);
  autoScroll(talkConv);
  if (opts.mIdx != null && opts.mIdx >= 0) talkBubbles[opts.mIdx] = { el: r.el, body: r.body };
  return r;
}
function talkRender() {
  talkBubbles = [];
  talkConv.replaceChildren();
  const d = document.createElement('div'); d.className = 'cmsg sys';
  const b = document.createElement('div'); b.className = 'body'; b.textContent = TALK_INTRO;
  d.appendChild(b); talkConv.appendChild(d);
  for (const m of talkHist) {
    const opts = { imgs: m.imgs, imgRef: m.imgRef, wdTags: m.wdTags, mIdx: talkHist.indexOf(m) };
    // 统一的「复制」操作已在消息底部（cacts），不再重复添加「复制最终提示词」按钮
    talkAddMsg(m.role, m.text, opts);
  }
}
function talkRefreshImgs() {
  renderImgRow(talkImgRow, talkPendingImgs, i => { talkPendingImgs.splice(i, 1); talkImgMetas.splice(i, 1); talkRefreshImgs(); });
}
var talkBubbles = [];
// 修改某条消息（用户 / AI 均可）
function talkEdit(idx) {
  const m = talkHist[idx];
  const bubble = talkBubbles[idx];
  if (!m || !bubble) return;
  const ta = document.createElement('textarea');
  ta.className = 'editarea'; ta.value = m.text || ''; ta.rows = Math.min(10, Math.max(4, String(m.text || '').split('\n').length));
  const bar = document.createElement('div'); bar.className = 'editbar';
  const ok = document.createElement('button'); ok.className = 'abtn pri'; ok.textContent = '✅ 保存';
  const no = document.createElement('button'); no.className = 'abtn ghost'; no.textContent = '取消';
  bar.append(ok, no);
  bubble.body.replaceChildren(ta, bar);
  const doSave = () => {
    m.text = ta.value;
    const s = curSessionEl();
    if (s && s.messages && s.messages[idx]) s.messages[idx] = m;
    // 增量更新：只恢复本条文本，不整页重绘（保留焦点/滚动/其余消息按钮）
    bubble.body.replaceChildren();
    bubble.body.textContent = m.text;
    talkPersist(); talkSetStatus('已修改');
  };
  ok.onclick = doSave;
  no.onclick = () => {
    bubble.body.replaceChildren();
    bubble.body.textContent = m.text;
  };
  ta.focus();
  ta.select();
}
// 重新生成该 AI 消息：回到它之前，用最后一条用户消息再跑一次
async function talkRegen(idx) {
  if (talkBusy) return toast('正在处理中，请先停止');
  const s = curSessionEl();
  if (!s) return;
  const kept = talkHist.slice(0, idx);
  s.messages = kept; talkHist = kept;
  const lastUser = [...kept].reverse().find(x => x && x.role === 'user');
  if (!lastUser) return toast('没有可重新生成的用户消息');
  const mode = lastUser.mode || 'assist';
  talkRender(); talkPersist();
  await runTalk(lastUser.text || '', lastUser.imgs || [], [], mode, true);
}
function addTalkImg(url, meta) {
  if (talkPendingImgs.length >= 3) return toast('一次最多 3 张图片');
  talkPendingImgs.push(url);
  talkImgMetas.push(meta || null);
  tpFoldState = { builtin: null, model: null };
  talkRefreshImgs();
  // 右上角：总是显示最后一张上传的图，并立即尝试提取其内置 Tag
  const last = talkPendingImgs[talkPendingImgs.length - 1];
  const builtin = (meta && meta.tags && meta.tags.length) ? metaToTags(meta) : [];
  showTagPane(last, builtin, [], false);
  talkSetStatus(builtin.length ? ('已解析图片内置 ' + builtin.length + ' 个 Tag') : '已上传图片 · 可点「本地识图」提取 Tag');
}
function talkClearAll() {
  uiConfirm('确定要清空当前对话吗？清空后不可恢复。', () => {
    const s = curSessionEl();
    if (s && Array.isArray(s.messages)) s.messages.length = 0;
    talkHist = s ? s.messages : [];
    talkPendingImgs = []; talkImgMetas = []; talkRefreshImgs(); talkIn.value = '';
    talkRender(); talkSetStatus('已清空当前对话'); talkPersist();
  });
}
function renderTalkSidebar() {
  if (!talkSessionList) return;
  talkSessionList.replaceChildren();
  for (const s of talkSessions) {
    // 组件模板：会话列表项
    const d = UI.listItem(titleOf(s), relTime(s.ts), {
      active: s.id === talkCur,
      delFn: () => talkDel(s.id),
      fn: () => talkSwitch(s.id)
    });
    talkSessionList.appendChild(d);
  }
}
function talkNewChat() {
  // 若已有一个空会话，直接复用，避免堆积空白会话
  const empty = talkSessions.find(s => s && (!s.messages || !s.messages.length));
  if (empty) {
    talkCur = empty.id;
    talkHist = empty.messages || (empty.messages = []);
    talkPendingImgs = []; talkImgMetas = []; talkRefreshImgs(); talkIn.value = '';
    talkSessions.splice(talkSessions.indexOf(empty), 1);
    talkSessions.unshift(empty);
    talkRender(); renderTalkSidebar(); talkPersist();
    talkSetStatus('就绪 · 选择下方模式开始');
    if (talkIn) talkIn.focus();
    return;
  }
  const s = { id: 's_' + Date.now(), title: '新对话', ts: Date.now(), messages: [] };
  talkSessions.unshift(s);
  talkCur = s.id;
  talkHist = s.messages;
  talkPendingImgs = []; talkImgMetas = []; talkRefreshImgs(); talkIn.value = '';
  talkRender(); renderTalkSidebar(); talkPersist();
  talkSetStatus('就绪 · 选择下方模式开始');
  if (talkIn) talkIn.focus();
}
function talkSwitch(id) {
  const i = talkSessions.findIndex(s => s.id === id);
  if (i < 0) return;
  talkCur = id;
  talkHist = talkSessions[i].messages || [];
  talkPendingImgs = []; talkImgMetas = []; talkRefreshImgs(); talkIn.value = '';
  talkRender(); renderTalkSidebar(); talkPersist();
}
function talkDel(id) {
  if (talkSessions.length <= 1) { toast('至少保留一个对话'); return; }
  uiConfirm('删除这个对话？删除后不可恢复。', () => {
    const i = talkSessions.findIndex(s => s.id === id);
    if (i < 0) return;
    talkSessions.splice(i, 1);
    if (talkCur === id) { const s = talkSessions[0]; talkCur = s.id; talkHist = s.messages; }
    talkRender(); renderTalkSidebar(); talkPersist();
  });
}
async function talkProbe() {
  readCfg();
  const parts = [];
  parts.push(aiCfg.model ? ('AI 模型：' + aiCfg.model) : '未配置 AI 模型');
  const ap = activePreset(); if (ap) parts.push('预设：' + (ap.name || '未命名'));
  const aw = activeWorld(); if (aw) parts.push('拓展提示词：' + (aw.name || '未命名'));
  if (aiCfg.comfyOn) {
    parts.push('ComfyUI：' + (aiCfg.comfyWorkflow ? '工作流已就绪' : '未上传工作流'));
    try { parts.push((await COMFY.check()) ? '已连接' : '连接失败'); } catch (e) { parts.push('连接失败'); }
  } else parts.push('ComfyUI 未启用');
  talkSetStatus(parts.join(' · '));
}
function talkHistMsgs(sysText) {
  const msgs = [{ role: 'system', content: sysText }];
  for (const m of talkHist) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    msgs.push({ role: m.role, content: contentParts((m.text || '') + (m.imgs && m.imgs.length ? '\n\n' + (m.imgRef || imgRefFallback(m.imgs)) : ''), m.imgs) });
  }
  return msgs;
}
async function talkAiReply(msgs, els) {
  const body = els && els.body ? els.body : els;
  const think = els && els.think ? els.think : null;
  let full = '', thinkBuf = '';
  const render = () => {
    if (think) {
      think.textContent = thinkBuf;
      const d = think.closest('details');
      if (d) {
        // 首次出现思考时展开一次，之后不干预（用户可随时折叠/展开，不再被流式更新强制顶开）
        if (thinkBuf && !d.dataset.talkOpened) { d.open = true; d.dataset.talkOpened = '1'; }
      }
    }
    body.textContent = full + (full ? '▌' : '');
    autoScroll(talkConv);
  };
  await chatComplete(msgs, { stream: true, signal: talkAbort ? talkAbort.signal : undefined, onDelta: (c, rc) => { if (rc) { thinkBuf += rc; if (think) render(); } if (c) { full += c; render(); } } });
  body.textContent = full;
  renderMessageText(body, full);   // 富文本：``` 代码块自动包裹（含复制按钮）
  if (think) {
    think.textContent = thinkBuf;
    // 模型没有返回思考过程时隐藏该区块
    const d2 = think.closest('details');
    if (d2 && !thinkBuf) d2.style.display = 'none';
  }
  return full;
}
// 创建一个 AI 气泡：含可折叠「思考过程」+ 正文
function startAiBubble(mIdx) {
  const b = talkAddMsg('ai', '', { mIdx: mIdx == null ? -1 : mIdx });
  const thinkWrap = document.createElement('details');
  thinkWrap.className = 'thinkb';
  const sum = document.createElement('summary'); sum.textContent = '💭 思考过程'; thinkWrap.appendChild(sum);
  const tb = document.createElement('div'); tb.className = 'thinkbody'; thinkWrap.appendChild(tb);
  const bodyEl = document.createElement('div'); bodyEl.className = 'chatbody';
  b.body.append(thinkWrap, bodyEl);
  return { bubble: b, think: tb, body: bodyEl };
}
async function talkRun(mode) {
  const txt = talkIn.value.trim();
  const imgs = talkPendingImgs.slice();
  const metas = talkImgMetas.slice();
  await runTalk(txt, imgs, metas, mode, false);
}
async function runTalk(txt, imgs, metas, mode, skipUser) {
  if (talkBusy) return toast('正在处理中，请先停止');
  if (!txt && !imgs.length) return toast('请输入内容或先附图');
  if (mode !== 'assist') { readCfg(); if (!aiCfg.model) return toast('请先在「⚙️ 设置」里填写模型名'); }
  if (mode === 'comfy') {
    readCfg();
    if (!aiCfg.comfyOn) return toast('请先在「⚙️ 设置 → ComfyUI」勾选「启用 ComfyUI 迭代」');
    if (!String(aiCfg.comfyWorkflow || '').trim()) return toast('请先上传工作流（JSON 或含工作流的 PNG）');
    try { if (!(await COMFY.check())) { const msg = typeof formatAppError === 'function' ? formatAppError('ComfyUI 连接失败', 'ComfyUI') : ('无法连接 ComfyUI：' + aiCfg.comfyBase); talkSetStatus('❌ ' + msg); return toast(msg); } } catch (e) { const msg = typeof formatAppError === 'function' ? formatAppError(e, 'ComfyUI') : ('无法连接 ComfyUI：' + aiCfg.comfyBase); talkSetStatus('❌ ' + msg); return toast(msg); }
  }
  if (!skipUser) { talkPendingImgs = []; talkImgMetas = []; talkRefreshImgs(); talkIn.value = ''; }
  // 附图：编号 + 本地识图（图片内置 Tag 直接解析，不二次识别）
  let imgRef = '', wdTags = [];
  if (imgs.length) {
    talkSetStatus('🔍 本地识图提取 Tag…');
    const r = await imgRefBlock(imgs, metas);
    imgRef = r.ref;
    wdTags = r.objs[0] || [];
  }
  if (!skipUser) {
    talkAddMsg('user', txt, { imgs, imgRef, wdTags, mIdx: talkHist.length });
    talkHist.push({ role: 'user', text: txt, imgs, imgRef, wdTags, mode, ts: Date.now() });
    const sc = curSessionEl();
    if (sc && (sc.title === '新对话' || !sc.title) && txt) sc.title = txt.slice(0, 20);
  }
  talkPersist();
  talkBusy = true; talkAbort = new AbortController();
  setSendBusy(true);
  try {
    if (mode === 'rk') {
      // 统一模板：标准 AI 气泡（含可折叠「思考过程」），与 对话/迭代 一致
      talkSetStatus('🖼 识图 AI 描述中…');
      const descText = (txt || '请分析这张图片，详细列出其中的所有元素并描述内容。') + (imgRef ? '\n\n' + imgRef : '') + '\n\n请以上述 Tag 为基础，补充它们无法表达的细节、相对位置关系与互动信息，输出完整描述。';
      const descB = startAiBubble(talkHist.length);
      const desc = await talkAiReply([{ role: 'system', content: composeSystem('rk', { text: txt, phase: 0 }) }, { role: 'user', content: contentParts(descText, imgs) }], descB);
      if (!desc) throw new Error('识图结果为空');
      talkHist.push({ role: 'assistant', text: desc, mode: 'rk-desc', ts: Date.now() });
      // ② 描述 + 原图 + 识图 Tag + 生图提示词 → 生图 AI 输出最终 Tag（同样走思考气泡）
      talkSetStatus('✍️ 生图 AI 生成 Tag…');
      const rkPool = wdTags.map(w => { const lib = tagMap.get(w.tag); return { en: w.tag, zh: lib ? lib.zh : '' }; });
      let sys2 = composeSystem('rk', { text: desc, tagPool: rkPool, strict: aiStrict.checked, phase: 1 });
      sys2 = injectSpecialAppendix(sys2, desc);
      const u2 = desc + (imgRef ? '\n\n' + imgRef : '') + '\n\n【任务】请严格依据上面的描述与识图 Tag，对照原图，生成最终的 Tag（Anima 提示词）。';
      const finB = startAiBubble(talkHist.length);
      const full = await talkAiReply([{ role: 'system', content: sys2 }, { role: 'user', content: contentParts(u2, imgs) }], finB);
      talkHist.push({ role: 'assistant', text: full, mode: 'rk', ts: Date.now() });
      talkSetStatus('✅ 识图并复刻完成');
    } else {
      // gen / assist / comfy
      let sys;
      if (mode === 'gen') sys = composeSystem('gen', { text: txt, strict: aiStrict.checked });
      else if (mode === 'assist') sys = composeSystem('assist');
      else sys = composeSystem('comfy');
      const msgs = talkHistMsgs(sys);
      const maxIters = mode === 'comfy' ? Math.max(1, parseInt(talkIters.value) || 3) : 1;
      for (let it = 1; it <= maxIters; it++) {
        talkSetStatus(mode === 'comfy' ? ('🎨 迭代 ' + it + '/' + maxIters + ' · AI 思考中…') : '🤖 AI 回复中…');
        const b = startAiBubble(talkHist.length);
        const full = await talkAiReply(msgs, b);
        msgs.push({ role: 'assistant', content: full });
        talkHist.push({ role: 'assistant', text: full, mode, ts: Date.now() });
        if (mode !== 'comfy') break;
        const cmds = comfyParseCommands(full);
        const renderCmd = cmds.find(c => /^render\b/i.test(c));
        if (!renderCmd) break;
        const p = comfyParseRender(renderCmd);
        if (!p.prompt && !aiCfg.comfyPos) {
          talkAddMsg('err', 'RENDER 指令缺少正向提示词（已忽略）。');
          msgs.push({ role: 'user', content: '你的 RENDER 指令缺少正向提示词，请重新输出格式正确的 RENDER 指令（或给出最终提示词并停止）。' });
          continue;
        }
        talkSetStatus('🎨 ComfyUI 渲染中（' + it + '/' + maxIters + '）…');
        let img = null, renderErr = '';
        try {
          img = await COMFY.render({
            prompt: p.prompt || aiCfg.comfyPos || '',
            negative: p.negative || aiCfg.comfyNeg || '',
            seed: p.seed != null && p.seed !== 0 ? p.seed : Math.floor(Math.random() * 1e9),
            w: p.size ? p.size.w : aiCfg.comfyW, h: p.size ? p.size.h : aiCfg.comfyH,
            steps: p.steps || aiCfg.comfySteps, cfg: p.cfg || aiCfg.comfyCfg,
            sampler: p.sampler, scheduler: p.scheduler,
            signal: talkAbort.signal
          });
        } catch (e) {
          renderErr = (e && e.message) || String(e);
          if (talkAbort.signal.aborted) throw e;
        }
        if (renderErr) {
          talkAddMsg('err', '渲染失败：' + renderErr);
          msgs.push({ role: 'user', content: 'ComfyUI 渲染失败：' + renderErr + '。请修正后重试（或给出文字结论，不要重复相同指令）。' });
          continue;
        }
        talkAddMsg('rst', '第 ' + it + ' 次渲染完成' + (p.seed ? ' · seed=' + p.seed : ''), { imgs: [img] });
        msgs.push({ role: 'user', content: contentParts('这是 ComfyUI 第 ' + it + ' 次渲染的图像（prompt：' + (p.prompt || '').slice(0, 400) + '）。请分析画面与目标的差距；如需改进请输出修改后的 RENDER 指令；若满意或已到判断上限，请输出【调试结论】与【最终提示词】并停止。', [img.dataUrl]) });
        if (it >= maxIters) {
          const b2 = startAiBubble(talkHist.length);
          const full2 = await talkAiReply(msgs, b2);
          msgs.push({ role: 'assistant', content: full2 });
          talkHist.push({ role: 'assistant', text: full2, mode, ts: Date.now() });
        }
      }
      talkSetStatus('✅ 完成');
    }
  } catch (e) {
    if (talkAbort && talkAbort.signal.aborted) { talkAddMsg('sys', '已停止。'); talkSetStatus('已停止'); }
    else { talkAddMsg('err', aiError(e)); talkSetStatus('⚠️ 出错'); }
  } finally {
    talkBusy = false; talkAbort = null;
    setSendBusy(false);
    talkPersist();
  }
}
talkImgBtn.onclick = () => talkImgFile.click();
talkImgFile.addEventListener('change', () => {
  for (const f of Array.from(talkImgFile.files || [])) {
    if (f.size > 10 * 1024 * 1024) { toast('图片过大（>10MB）已跳过'); continue; }
    fileToDataURL(f).then(async url => { if (url) addTalkImg(url, await pngMetaFromFile(f).catch(() => null)); });
  }
  talkImgFile.value = '';
});
// Enter 发送 / Shift+Enter 换行；点击对话区聚焦输入框
talkIn.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (talkBusy) { if (talkAbort) talkAbort.abort(); }
    else talkRun(talkMode);
  }
});
talkConv.addEventListener('click', (e) => {
  if (!talkIn) return;
  // 正在框选文本时不抢焦点（修复：选中高亮被点击聚焦清除）
  const sel = (window.getSelection && String(window.getSelection())) || '';
  if (sel) return;
  if (document.activeElement !== talkIn) talkIn.focus();
});
// 模式切换（输入框上方切换式 tab，带滑块动画）
function updateTkThumb() {
  const bar = document.querySelector('.tkmodebar'), thumb = document.getElementById('tkThumb');
  if (!bar || !thumb) return;
  const on = bar.querySelector('.tkmode.on');
  if (!on) { thumb.style.opacity = '0'; return; }
  thumb.style.opacity = '1';
  thumb.style.left = (on.offsetLeft - 3) + 'px';
  thumb.style.width = (on.offsetWidth) + 'px';
}
tkModes.forEach(m => m.addEventListener('click', () => {
  talkMode = m.dataset.mode;
  tkModes.forEach(x => x.classList.toggle('on', x === m));
  updateTkThumb();
}));
// 发送 / 停止：AI 思考中按钮变「停止」
function setSendBusy(b) {
  if (!talkSendBtn) return;
  if (b) { talkSendBtn.textContent = '■ 停止'; talkSendBtn.classList.add('danger'); }
  else { talkSendBtn.textContent = '📤 发送'; talkSendBtn.classList.remove('danger'); }
}
// 有样式的确认弹窗
var cfmModal = $('#cfmModal'), cfmText = $('#cfmText'), cfmYes = $('#cfmYes'), cfmNo = $('#cfmNo');
var cfmOk = null;
function uiConfirm(msg, onOk) {
  cfmText.textContent = msg;
  cfmOk = onOk;
  cfmModal.classList.add('show'); scrimEl.classList.add('show');
}
cfmYes.onclick = () => { cfmModal.classList.remove('show'); if (!aiModal.classList.contains('show')) scrimEl.classList.remove('show'); const f = cfmOk; cfmOk = null; if (f) f(); };
cfmNo.onclick = () => { cfmModal.classList.remove('show'); if (!aiModal.classList.contains('show')) scrimEl.classList.remove('show'); cfmOk = null; };
talkSendBtn.onclick = () => { if (talkBusy) { if (talkAbort) talkAbort.abort(); } else talkRun(talkMode); };
$('#tpIdentify').onclick = talkIdentify;
$('#tpClearImg').onclick = tpClearImg;
// 折叠模块的复制按钮已由 UI.foldModule 的 copyFn 提供（panel 内嵌模块动态构建）
talkClearBtn.onclick = talkClearAll;
talkNew.onclick = talkNewChat;
talkIters.addEventListener('change', () => {
  readCfg();
  aiCfg.comfyIters = Math.max(1, parseInt(talkIters.value) || 3);
  saveJSON(LS_AI, aiCfg);
});
// 输入区拖入图片 = 基准图
talkIn.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
talkIn.addEventListener('drop', e => {
  e.preventDefault(); e.stopPropagation();
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) return;
  for (const f of Array.from(files)) {
    if (String(f.type || '').indexOf('image/') === 0) {
      if (f.size > 10 * 1024 * 1024) { toast('图片过大（>10MB）已跳过'); continue; }
      fileToDataURL(f).then(async url => { if (url) addTalkImg(url, await pngMetaFromFile(f).catch(() => null)); });
    }
  }
});
comfyClearCfg.onclick = () => {
  comfyBase.value = DEFAULT_CFG.comfyBase; comfyOn.checked = false;
   comfyW.value = 768; comfyH.value = 1024; comfySteps.value = 25; comfyCfg.value = 7;
  comfyPos.value = ''; comfyNeg.value = ''; comfyWf.value = '';
  readCfg(); toast('已恢复默认');
  comfySetStatus('未开始 · ComfyUI 未连接');
};

/* ---------- AI 原图内置 Tag 解析（PNG tEXt/iTXt 元数据：A1111 / NovelAI / ComfyUI） ---------- */
// 从 dataURL 解析 PNG 文本块（参考 https://github.com/GChenSi-2/ai-metadata-viewer 的格式）
function parsePngTextChunks(dataUrl) {
  try {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const b64 = dataUrl.slice(comma + 1);
    const bin = atob(b64);
    if (bin.length < 8) return null;
    const sig = bin.charCodeAt(0) === 0x89 && bin.charCodeAt(1) === 0x50 && bin.charCodeAt(2) === 0x4e && bin.charCodeAt(3) === 0x47 &&
      bin.charCodeAt(4) === 0x0d && bin.charCodeAt(5) === 0x0a && bin.charCodeAt(6) === 0x1a && bin.charCodeAt(7) === 0x0a;
    if (!sig) return null;
    const texts = {};
    let off = 8;
    while (off + 8 <= bin.length) {
      const len = ((bin.charCodeAt(off) << 24) | (bin.charCodeAt(off + 1) << 16) | (bin.charCodeAt(off + 2) << 8) | bin.charCodeAt(off + 3)) >>> 0;
      const type = bin.slice(off + 4, off + 8);
      const dataStart = off + 8;
      const dataEnd = dataStart + len;
      if (dataEnd > bin.length) break;
      if (type === 'tEXt') {
        const z = bin.indexOf('\u0000', dataStart);
        if (z > dataStart && z < dataEnd) {
          texts[bin.slice(dataStart, z)] = bin.slice(z + 1, dataEnd);
        }
      } else if (type === 'iTXt') {
        // keyword\0 flag method lang\0 translated\0 text（仅处理未压缩）
        let p = bin.indexOf('\u0000', dataStart);
        if (p > dataStart && p + 3 < dataEnd) {
          const key = bin.slice(dataStart, p);
          const flag = bin.charCodeAt(p + 1);
          p = p + 3;
          const langEnd = bin.indexOf('\u0000', p);
          if (langEnd >= 0 && langEnd < dataEnd) {
            p = bin.indexOf('\u0000', langEnd + 1);
            if (p >= 0 && p < dataEnd) {
              const payload = bin.slice(p + 1, dataEnd);
              if (flag === 0) {
                try { texts[key] = decodeURIComponent(escape(payload)); } catch (e) { texts[key] = payload; }
              }
            }
          }
        }
      }
      if (type === 'IEND') break;
      off = dataEnd + 4;
    }
    return texts;
  } catch (e) { return null; }
}
// 顶层逗号切分提示词 → Tag 列表（忽略括号/引号内逗号，清洗权重语法）
function promptToTags(text) {
  const out = [];
  const pushTok = (s0) => {
    let s = s0.trim();
    if (!s) return;
    s = s.replace(/<lora:([^:>]+)(?::[^>]*)?>/gi, '$1');
    s = s.replace(/^[\(\[\{]+/, '').replace(/[\)\]\}]+$/, '');
    s = s.replace(/:\s*-?[\d.]+$/, '');
    s = s.trim();
    if (!s || /^BREAK$/i.test(s) || s === 'AND' || s === '|') return;
    if (!out.includes(s)) out.push(s);
  };
  let depth = 0, inQ = false, buf = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i - 1] !== '\\') inQ = !inQ;
    else if (!inQ) {
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
    }
    if (c === ',' && !inQ && depth === 0) { pushTok(buf); buf = ''; }
    else buf += c;
  }
  pushTok(buf);
  return out;
}
// 解析 AI 原图元数据 → {source, prompt, negative, tags}
function pngMetaFromDataUrl(dataUrl) {
  const texts = parsePngTextChunks(dataUrl);
  if (!texts) return null;
  let source = '', prompt = '', negative = '';
  // NovelAI：Software=NovelAI，Description=提示词，Comment=JSON(uc=负向)
  if (/novelai/i.test(texts['Software'] || '')) {
    source = 'NovelAI';
    prompt = texts['Description'] || '';
    try {
      const obj = JSON.parse(texts['Comment'] || '{}');
      if (typeof obj.uc === 'string') negative = obj.uc;
    } catch (e) {}
  } else if (/Steps\s*:/i.test(texts['parameters'] || '')) {
    // A1111 / Forge：parameters = "prompt\nNegative prompt: ...\nSteps: ..."
    source = 'Stable Diffusion';
    const p = texts['parameters'];
    const parts = p.split(/Negative prompt\s*:/i);
    prompt = (parts[0] || '').replace(/^Prompt\s*:\s*/i, '').trim();
    negative = (parts[1] || '').split(/\nSteps\s*:/i)[0].trim();
  } else if (texts['prompt'] && texts['prompt'].trim().startsWith('{')) {
    // ComfyUI：prompt / workflow 为 JSON，遍历 CLIPTextEncode 节点取正/负向
    source = 'ComfyUI';
    try {
      const obj = JSON.parse(texts['prompt']);
      let pos = '', neg = '';
      for (const n of Object.values(obj)) {
        if (n && n.class_type === 'CLIPTextEncode' && typeof n.inputs === 'object' && n.inputs.text) {
          const title = (n._meta && n._meta.title || '').toLowerCase();
          if (title.indexOf('neg') >= 0 || title.indexOf('负') >= 0) neg += (neg ? ', ' : '') + n.inputs.text;
          else pos += (pos ? ', ' : '') + n.inputs.text;
        }
      }
      prompt = pos; negative = neg;
    } catch (e) {}
  } else if (texts['Description'] || texts['prompt']) {
    source = '图片内置';
    prompt = (texts['Description'] || texts['prompt'] || '').trim();
  }
  if (!prompt) return null;
  const tags = promptToTags(prompt);
  if (!tags.length) return null;
  return { source, prompt, negative, tags };
}
// 从 File 读取并解析元数据（独立于压缩流程，压缩会丢失 PNG 元数据）
function pngMetaFromFile(file) {
  return new Promise(resolve => {
    if (!file || !/\.png$/i.test(file.name || '') && !(file.type === 'image/png')) return resolve(null);
    const fr = new FileReader();
    fr.onerror = () => resolve(null);
    fr.onload = () => resolve(pngMetaFromDataUrl(String(fr.result || '')));
    fr.readAsDataURL(file);
  });
}

/* ---------- 本地识图（桌面版内置 WD Tagger，①初步 Tag 提取） ---------- */
// 与 WD v3 Tagger 官方预处理一致：白底补方 → 448×448 → RGB→BGR → float32(0-255)
function preprocessForWD(dataUrl) {
  return new Promise((resolve, reject) => {
    try {
      const c0 = document.createElement('canvas');
      if (!c0 || !c0.getContext) return reject(new Error('当前环境不支持本地识图'));
    } catch (e) { return reject(new Error('当前环境不支持本地识图')); }
    const img = new Image();
    img.onload = () => {
      try {
        const T = 448;
        const w = img.naturalWidth || 1, h = img.naturalHeight || 1;
        const maxDim = Math.max(w, h);
        const canvas = document.createElement('canvas');
        canvas.width = T; canvas.height = T;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return reject(new Error('当前环境不支持本地识图'));
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, T, T);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const scale = T / maxDim;
        const dw = Math.round(w * scale), dh = Math.round(h * scale);
        const dx = (T - dw) >> 1, dy = (T - dh) >> 1;
        ctx.drawImage(img, dx, dy, dw, dh);
        const id = ctx.getImageData(0, 0, T, T).data;
        const out = new Float32Array(T * T * 3);
        for (let i = 0; i < T * T; i++) {
          out[i * 3] = id[i * 4 + 2];     // B
          out[i * 3 + 1] = id[i * 4 + 1]; // G
          out[i * 3 + 2] = id[i * 4];     // R
        }
        resolve(out);
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = dataUrl;
  });
}
// 本地识图：只保留大模型（EVA02 Canary；小模型已移除）
var WD_MODEL_KEY = 'dbt_wd_model';
function wdModel() { return 'eva02'; }
function setWdModel(id) { storageSet(WD_MODEL_KEY, 'eva02'); }
// 根据主进程可用模型刷新选择器（文件缺失的模型置灰），并同步持久化选择
async function initWdModelSelect() {
  if (!visWdModel || !window.aiTag) return;
  let info = null;
  try { info = await window.aiTag.available(); } catch (e) {}
  if (!info || !Array.isArray(info.models)) return;
  const byId = {};
  for (const m of info.models) byId[m.id] = m;
  for (const opt of visWdModel.options) {
    const m = byId[opt.value];
    opt.disabled = !(m && m.available);
    if (!opt.disabled && !opt.dataset.named) {
      opt.textContent = (m && m.name) ? m.name : opt.textContent;
      opt.dataset.named = '1';
    }
  }
  const cur = wdModel();
  const curOpt = visWdModel.querySelector('option[value="' + cur + '"]');
  if (curOpt && curOpt.disabled) {
    const first = Array.prototype.find.call(visWdModel.options, o => !o.disabled);
    if (first) { visWdModel.value = first.value; setWdModel(first.value); }
    else { visWdModel.value = cur; }
  } else {
    visWdModel.value = cur;
  }
}
// 调用主进程 onnxruntime 推理，返回 [{tag, category, prob}]（已按置信度降序）
async function runLocalTag(dataUrl) {
  if (!window.aiTag) throw new Error('本地识图仅在桌面版可用');
  let avail;
  try { avail = await window.aiTag.available(); }
  catch (e) { throw new Error('本地识图引擎连接失败：' + (e && e.message || e)); }
  if (!avail || !avail.available) throw new Error((avail && avail.reason) || '未找到本地识图模型，请检查 models 文件夹');
  const model = wdModel();
  const pixels = await preprocessForWD(dataUrl);
  const res = await window.aiTag.run(pixels, 448, undefined, model);
  if (res && res.ok && Array.isArray(res.tags)) return res.tags;
  throw new Error(res && res.error ? res.error : '本地识图失败');
}
// 把本地 Tag 整理成给 ②识图 / ③生成 用的文本（分 rating / character / general 三组）
function wdTagsText(tags) {
  if (!tags || !tags.length) return '';
  const groups = { rating: [], character: [], general: [] };
  for (const t of tags) {
    if (t.category === 9) groups.rating.push(t.tag);
    else if (t.category === 4) groups.character.push(t.tag);
    else groups.general.push(t.tag);
  }
  const parts = [];
  if (groups.rating.length) parts.push('rating: ' + groups.rating.join(', '));
  if (groups.character.length) parts.push('character: ' + groups.character.join(', '));
  if (groups.general.length) parts.push('general: ' + groups.general.join(', '));
  return parts.join('\n');
}

/* ---------- 独立识图模块（🖼 识图 Tab：本地识图 Tag / AI 描述） ---------- */
var visPendingImgs = [];
var visBusy = false, visAbort = null;
var visWdTags = [];
var visWdSrc = '';
function refreshVisImgs() {
  renderImgRow(visImgRow, visPendingImgs, i => { visPendingImgs.splice(i, 1); visImgMetas.splice(i, 1); refreshVisImgs(); });
}
// 内置 Tag → ① 标签格式（置信度 0.99）
function metaToTags(meta) {
  return (meta && meta.tags && meta.tags.length)
    ? meta.tags.map(t => ({ tag: t, category: 0, prob: 0.99 }))
    : [];
}
function addVisImg(url, meta) {
  if (visPendingImgs.length >= MAX_IMGS) return toast('一次最多 ' + MAX_IMGS + ' 张图片');
  visPendingImgs.push(url);
  visImgMetas.push(meta || null);
  refreshVisImgs();
  // AI 原图：内置 Tag 直接解析显示
  if (meta && meta.tags && meta.tags.length) {
    visWdTags = metaToTags(meta);
    visWdSrc = '来源：图片内置（' + (meta.source || 'AI 原图') + '）';
    renderVisTags();
    toast('已解析图片内置 ' + meta.tags.length + ' 个 Tag（' + (meta.source || 'AI 原图') + '）');
  }
}
function renderVisTags() {
  visTags.replaceChildren();
  visTagCount.textContent = visWdTags.length;
  visTagSrc.textContent = visWdSrc || '';
  for (const t of visWdTags) {
    const b = document.createElement('button');
    b.className = 'tchip ok';
    b.innerHTML = '<span>' + esc(t.tag) + '</span><span class="wp">' + Math.round(t.prob * 100) + '%</span>';
    b.title = t.tag + ' · 置信度 ' + Math.round(t.prob * 100) + '% · 点击复制';
    b.onclick = () => copyText(t.tag, '已复制：' + t.tag);
    visTags.appendChild(b);
  }
  visOut.style.display = (visWdTags.length || visDesc.textContent) ? '' : 'none';
}
function visClearAll() {
  visPendingImgs = [];
  visImgMetas = [];
  visWdTags = [];
  visWdSrc = '';
  visDesc.textContent = '';
  refreshVisImgs();
  renderVisTags();
  toast('已清理');
}
async function visRunLocalTag() {
  if (visBusy) return toast('请等待当前任务完成');
  if (!visPendingImgs.length) return toast('请先添加图片');
  if (!window.aiTag) return toast('本地识图仅在桌面版可用');
  let avail;
  try { avail = await window.aiTag.available(); }
  catch (e) { return toast(typeof formatAppError === 'function' ? formatAppError(e, '本地识图引擎') : '无法连接本地识图引擎'); }
  if (!avail || !avail.available) return toast(typeof formatAppError === 'function' ? formatAppError((avail && avail.reason) || '本地识图模型不可用', '本地识图') : (avail && avail.reason ? avail.reason : '本地识图仅在桌面版可用'));
  visBusy = true;
  if (visTagBtn) visTagBtn.disabled = true;
  if (visDescBtn) visDescBtn.disabled = true;
  toast('🔍 正在本地识图…');
  try {
    const tags = await runLocalTag(visPendingImgs[0]);
    if (tags && tags.length) {
      visWdTags = tags;
      visWdSrc = '来源：WD Tagger（' + (visWdModel && visWdModel.selectedOptions && visWdModel.selectedOptions[0] ? visWdModel.selectedOptions[0].textContent : wdModel()) + '）';
      renderVisTags();
      toast('识图完成：提取到 ' + tags.length + ' 个 Tag');
    } else {
      toast(typeof formatAppError === 'function' ? formatAppError('本地识图未返回任何 Tag', '本地识图') : '本地识图失败');
    }
  } catch (e) {
    toast(typeof formatAppError === 'function' ? formatAppError(e, '本地识图') : ('本地识图失败：' + (e && e.message || e)));
  } finally {
    visBusy = false;
    if (visTagBtn) visTagBtn.disabled = false;
    if (visDescBtn) visDescBtn.disabled = false;
  }
}
// AI 描述：视觉 LLM + 识图提示词
async function visAiDescribe() {
  if (visBusy) return toast('请等待当前任务完成');
  if (!visPendingImgs.length) return toast('请先添加图片');
  readCfg();
  if (!aiCfg.model) { toast('请先在「⚙️ API 设置」里填写模型名'); aiSetEl.open = true; return; }
  visBusy = true; visTagBtn.disabled = visDescBtn.disabled = true; visStop.style.display = '';
  visAbort = new AbortController();
  visDesc.textContent = '🤔 正在识图…';
  visOut.style.display = '';
  const descMsgs = [{ role: 'system', content: effectiveVision() },
    { role: 'user', content: contentParts('请分析这张图片，详细列出其中的所有元素并描述内容。', visPendingImgs) }];
  let full = '';
  try {
    try {
      await chatComplete(descMsgs, { stream: true, signal: visAbort.signal, onDelta: (d, rc) => { if (rc) full += rc; if (d) { if (full.startsWith('🤔')) full = ''; full += d; } visDesc.textContent = full + '▌'; } });
    } catch (e) {
      if (visAbort.signal.aborted) throw e;
      if (/Failed to fetch|NetworkError|fetch|CORS/i.test(String((e && e.message) || e))) throw e;
      full = await chatComplete(descMsgs, { stream: false, signal: visAbort.signal });
    }
    if (!full) throw new Error('识图结果为空');
    visDesc.textContent = full;
    toast('AI 描述完成');
  } catch (e) {
    if (visAbort.signal.aborted) { visDesc.textContent = (full && !full.startsWith('🤔') ? full : '') + '（已停止）'; toast('已停止'); }
    else { const msg = aiError(e); visDesc.textContent = '⚠️ ' + msg; toast(msg); }
  } finally {
    visBusy = false; visTagBtn.disabled = visDescBtn.disabled = false; visStop.style.display = 'none';
    renderVisTags();
  }
}
visImgBtn.onclick = () => {
  if (visBusy) return toast('请等待当前任务完成');
  const remain = MAX_IMGS - visPendingImgs.length;
  if (remain <= 0) return toast('一次最多 ' + MAX_IMGS + ' 张图片');
  pickImages(visImgFile, remain, addVisImg);
};
visTagBtn.onclick = visRunLocalTag;
if (visWdModel) visWdModel.onchange = () => { setWdModel(visWdModel.value); loadModelTags(); };
visDescBtn.onclick = visAiDescribe;
visStop.onclick = () => { if (visAbort) visAbort.abort(); };
visClearBtn.onclick = visClearAll;
visFold.onclick = () => {
  const folded = visTags.style.display === 'none';
  visTags.style.display = folded ? '' : 'none';
  visFold.textContent = folded ? '▾ 折叠' : '▸ 展开';
};
visCopyTags.onclick = () => { if (visWdTags.length) copyText(wdTagsText(visWdTags), '已复制本地识别 Tag'); };
visCopyDesc.onclick = () => { if (visDesc.textContent) copyText(visDesc.textContent, '已复制 AI 描述'); };

/* ---------- 生成 Tag（对话式） ---------- */
// 页面重载后，把上次中断的"生成中"消息标记为已停止（避免出现永远"正在思考"的气泡）
var genConvData = loadJSON(LS_GENCONV, []).filter(m => m && (m.kind === 'user' || m.kind === 'ai')).map(m => {
  if (m.kind === 'ai' && m.status === 'run') m.status = 'stopped';
  return m;
}).slice(-24);
restoreImageRefs(genConvData, function () { renderGenConv(); persistWithImageRefs(LS_GENCONV, genConvData); }).catch(function () {});
var genBusy = false, genAbort = null, genElapsed = 0, genTimer = null, activeGenUpdater = null;
// 持久化（含图片的对话体积较大：若超出 localStorage 配额，则移除图片再保存）
function persistGenConv() {
  persistWithImageRefs(LS_GENCONV, genConvData).then(function (ok) { if (!ok) persistGenConvLegacy(); }).catch(function () { persistGenConvLegacy(); });
  if (!hasImageData(genConvData)) return;
  return;
  function persistGenConvLegacy() {
    try { if (saveJSON(LS_GENCONV, genConvData)) return; } catch (e) {}
    let n = 0;
    genConvData.forEach(m => { if (m && Array.isArray(m.imgs) && m.imgs.length) { m.imgs = []; n++; } });
    try {
      saveJSON(LS_GENCONV, genConvData);
      if (n) toast('本地空间不足：已移除 ' + n + ' 张图片以保存对话');
    } catch (e2) { toast(typeof formatAppError === 'function' ? formatAppError(e2, '保存生成对话') : '本地保存失败：对话文字未能保存'); }
  }
}

// 智能跟随滚动：记住用户的滚动意图——在底部时自动跟随，一旦上翻立即停止跟随，
// 直到用户自己滚回底部才恢复（解决快速流式输出时滚动条被频繁拽回的问题）
var pinState = new WeakMap();
function pinOf(el) {
  let st = pinState.get(el);
  if (!st) { st = { pinned: true, lastH: 0 }; pinState.set(el, st); }
  return st;
}
// BUG 修复 V1.7：自动跟随改为"实时校验 + 内容高度比对"，不再只信一个可能过期的 pinned 标志。
// 旧写法在流式输出时，autoScroll 每次把视图拽到底会立即触发 scroll 事件把 pinned 重新置真，
// 且识别不到"用户已上翻"的竞态，导致滚轮被一直锁死在底部、无法向上查看历史。
function autoScroll(el) {
  const st = pinOf(el);
  if (!st.pinned) return; // 用户已上翻：绝不跟随
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
  const grew = el.scrollHeight !== st.lastH; // 内容高度是否增长（流式追加）
  if (atBottom || grew) {
    el.scrollTop = el.scrollHeight;
    st.lastH = el.scrollHeight;
  } else {
    // 既不在底部、内容也没增长：说明用户已上翻（scroll 事件尚未到达），停止跟随
    st.pinned = false;
  }
}
function pinFollow(el) {
  const st = pinOf(el);
  st.lastH = el.scrollHeight;
  st.pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
}
genConv.addEventListener('scroll', () => pinFollow(genConv));
chatBoxEl.addEventListener('scroll', () => pinFollow(chatBoxEl));

function renderGenConv() {
  genConv.replaceChildren();
  if (!genConvData.length) {
    genConv.innerHTML = '<div class="gempty">还没有对话。在下方描述画面，点“✨ 生成”开始。<br><span style="font-size:12px">生成结果会保存在这里，可 ✏️ 修改描述后重新生成。</span></div>';
    return;
  }
  for (let i = 0; i < genConvData.length; i++) {
    const m = genConvData[i];
    genConv.appendChild(m.kind === 'user' ? userEl(m, i) : aiEl(m, i));
  }
  autoScroll(genConv); // 智能跟随：不动用户已上翻的位置
}
function userEl(m, i) {
  const d = document.createElement('div');
  d.className = 'gmsg user';
  d.dataset.idx = i;
  const imgsHtml = (m.imgs && m.imgs.length)
    ? '<div class="gimgs">' + m.imgs.map((u, k) => '<span class="giw"><img src="' + esc(u) + '" alt="图片' + (k + 1) + '"><b class="imgnum">图' + (k + 1) + '</b></span>').join('') + '</div>' +
      (m.imgRef ? '<div class="imgref">' + esc(m.imgRef) + '</div>' : '')
    : '';
  const wdHtml = (m.wdTags && m.wdTags.length)
    ? '<div class="wdmsg-tags" data-role="wdtags">' + m.wdTags.map((t, j) => {
        const cls = (t.category === 9 ? 'rating' : t.category === 4 ? 'character' : '') + (j >= 8 ? ' wdhide' : '');
        return '<span class="wdtag ' + cls + '" title="置信度 ' + Math.round(t.prob * 100) + '%">' + esc(t.tag) + '</span>';
      }).join('') + (m.wdTags.length > 8 ? '<span class="wdtag wdmore" data-role="wdmore">▸ 展开 ' + (m.wdTags.length - 8) + ' 个</span>' : '') + '</div>'
    : '';
  const txt = (m.text && m.text.trim()) ? m.text : ((m.imgs && m.imgs.length) ? '📷 已发送图片' : '');
  d.innerHTML = imgsHtml + wdHtml + '<span class="gt">' + esc(txt) + '</span><button class="gedit" title="修改描述并重新生成">✏️</button>';
  // 本地识图 Tag 折叠 / 展开
  const wdMore = d.querySelector('[data-role="wdmore"]');
  if (wdMore) {
    wdMore.onclick = () => {
      const wrap = d.querySelector('[data-role="wdtags"]');
      const tags = wrap.querySelectorAll('.wdtag:not(.wdmore)');
      if (wdMore.textContent.indexOf('展开') >= 0) {
        tags.forEach(x => x.classList.remove('wdhide'));
        wdMore.textContent = '▾ 收起';
      } else {
        tags.forEach((x, k) => { if (k >= 8) x.classList.add('wdhide'); });
        wdMore.textContent = '▸ 展开 ' + (tags.length - 8) + ' 个';
      }
    };
  }
  d.querySelector('.gedit').onclick = () => {
    const ta = document.createElement('textarea');
    ta.value = m.text;
    d.classList.add('editing');
    d.replaceChildren(ta);
    const acts = document.createElement('div');
    acts.className = 'geditacts';
    const save = document.createElement('button'); save.textContent = '保存并重新生成';
    const cancel = document.createElement('button'); cancel.textContent = '取消';
    acts.append(save, cancel);
    d.appendChild(acts);
    ta.focus();
    cancel.onclick = () => renderGenConv();
    save.onclick = () => {
      if (genBusy) return toast('AI 正在生成，请等它完成或点击「■ 停止」后再保存修改');
      const t = ta.value.trim();
      if (!t) return toast('内容不能为空');
      m.text = t;
      genConvData = genConvData.slice(0, i + 1);
      persistGenConv(); renderGenConv();
      genRun(i, m.mode || 'gen');
    };
  };
  return d;
}
function aiEl(m, i) {
  const d = document.createElement('div');
  d.className = 'gmsg ai';
  d.dataset.idx = i;
  const parts = [];
  const mode = m.mode === 'desc' ? 'desc' : (m.mode === 'rk' ? 'rk' : 'gen');
  if (m.status === 'run') {
    parts.push('<div class="gstatus" data-role="status">' + (mode === 'desc' || mode === 'rk' ? '🖼 正在识图…' : '🤔 正在思考…') + '</div>');
    if (mode === 'desc' || mode === 'rk') {
      parts.push('<details class="gthink" open data-role="rkdesc"><summary>🖼 识图分析</summary><pre data-role="rkdescpre">' + esc(m.desc || '') + '</pre></details>');
    }
    if (mode !== 'desc') {
      parts.push('<details class="gthink" open data-role="think"><summary>💭 思考过程</summary><pre data-role="thinkpre">' + esc(m.think || '') + '</pre></details>');
      parts.push('<div class="gfinal"><pre data-role="finalpre">' + esc(m.final || '') + '</pre></div>');
      parts.push('<details class="gneg" data-role="neg" style="display:none"><summary>🚫 负面提示词</summary><pre data-role="negpre"></pre></details>');
    }
    d.innerHTML = parts.join('');
    return d;
  }
  if (m.status === 'err') parts.push('<div class="gstatus">⚠️ ' + esc(m.error || '生成失败') + '</div>');
  else if (m.status === 'stopped') parts.push('<div class="gstatus">⏹ 已停止</div>');
  else if (m.status === 'ok') parts.push('<div class="gstatus">✅ ' + (mode === 'desc' ? '识图完成' : mode === 'rk' ? '复刻完成' : '完成') + ' · ' + new Date(m.ts || Date.now()).toLocaleTimeString() + '</div>');
  if (mode === 'desc' || mode === 'rk') {
    if (m.desc) parts.push('<details class="gthink"' + (mode === 'rk' ? '' : ' open') + '><summary>🖼 识图分析</summary><pre>' + esc(m.desc) + '</pre></details>');
  }
  if (mode !== 'desc') {
    if (m.think) parts.push('<details class="gthink"><summary>💭 思考过程</summary><pre>' + esc(m.think) + '</pre></details>');
    if (m.final) parts.push('<div class="gfinal"><pre>' + esc(m.final) + '</pre></div>');
    if (m.neg) parts.push('<details class="gneg"><summary>🚫 负面提示词</summary><pre>' + esc(m.neg) + '</pre></details>');
    parts.push('<div class="gacts"></div>');
    parts.push('<div class="tagchips"></div>');
  }
  d.innerHTML = parts.join('');
  const acts = d.querySelector('.gacts');
  if (acts) {
    const mkBtn = (label, fn) => { const b = document.createElement('button'); b.className = 'fbtn'; b.textContent = label; b.onclick = fn; acts.appendChild(b); };
    if (m.final) {
      mkBtn('📋 复制Tag', () => copyText(m.final + (m.neg ? '\n\n【负面提示词】' + m.neg : ''), '已复制生成结果'));
    }
    if (mode === 'rk' && m.desc) mkBtn('📋 复制识图描述', () => copyText(m.desc, '已复制识图描述'));
    // 复制对应的本地识别 Tag（①初步提取结果）
    if ((mode === 'desc' || mode === 'rk') && i > 0 && genConvData[i - 1] && genConvData[i - 1].kind === 'user' &&
        genConvData[i - 1].wdTags && genConvData[i - 1].wdTags.length) {
      mkBtn('🏷 复制识别Tag', () => copyText(wdTagsText(genConvData[i - 1].wdTags), '已复制本地识别 Tag'));
    }
    if (m.final) {
      mkBtn('📷 图片反馈', genImgFeedback);
    }
    const chips = m.final ? parseTags(m.final) : [];
    const known = chips.filter(c => c.t);
    if (known.length) {
      mkBtn('＋ 加入已选（' + known.length + '）', () => {
        known.forEach(c => state.sel.add(c.t.en));
        persist(); render();
        toast('已把 ' + known.length + ' 个库内标签加入已选');
      });
    }
    const wrap = d.querySelector('.tagchips');
    for (const c of chips) {
      const knownT = !!c.t;
      const b = document.createElement('button');
      const on = knownT && state.sel.has(c.raw);
      b.className = 'tchip ' + (knownT ? 'ok' : 'bad') + (on ? ' ons' : '');
      b.textContent = c.raw + (knownT ? ' ✓' : ' ⚠');
      b.title = knownT ? c.t.en + '（' + c.t.zh + '）· 库内标签 · 点击加入/移出已选' : c.raw + ' · 库外标签 · 点击复制';
      b.onclick = () => {
        if (knownT) {
          toggle(c.raw);
          b.classList.toggle('ons', state.sel.has(c.raw));
        } else {
          copyText(c.raw, '已复制：' + c.raw);
        }
      };
      wrap.appendChild(b);
    }
  } else if (mode === 'desc' && m.desc) {
    const a2 = document.createElement('div'); a2.className = 'gacts';
    const b = document.createElement('button'); b.className = 'fbtn'; b.textContent = '📋 复制识图描述';
    b.onclick = () => copyText(m.desc, '已复制识图描述');
    a2.appendChild(b);
    if (i > 0 && genConvData[i - 1] && genConvData[i - 1].kind === 'user' &&
        genConvData[i - 1].wdTags && genConvData[i - 1].wdTags.length) {
      const bt = document.createElement('button'); bt.className = 'fbtn'; bt.textContent = '🏷 复制识别Tag';
      bt.onclick = () => copyText(wdTagsText(genConvData[i - 1].wdTags), '已复制本地识别 Tag');
      a2.appendChild(bt);
    }
    d.appendChild(a2);
  }
  return d;
}
function genApiMsgs(upto) {
  const msgs = [{ role: 'system', content: composeSystem('gen', { text: genConvData[upto] ? genConvData[upto].text : '', strict: aiStrict.checked }) }];
  for (let i = 0; i <= upto; i++) {
    const m = genConvData[i];
    if (!m) continue;
    if (m.kind === 'user') {
      const txt = m.text + (i === upto && genNegChk.checked ? '。请同时输出【负面提示词】。' : '');
      if (m.imgs && m.imgs.length) {
        const ref = m.imgRef || imgRefFallback(m.imgs); // 历史数据兜底：至少给出编号
        msgs.push({ role: 'user', content: contentParts(txt + '\n\n' + ref, m.imgs) });
      } else {
        msgs.push({ role: 'user', content: txt });
      }
    } else if (m.kind === 'ai' && m.final) {
      msgs.push({ role: 'assistant', content: '【最终提示词】\n' + m.final });
    }
  }
  return msgs;
}
// 在已完成生成的 AI 结果下方上传图片，一键发起"图片反馈"（识图并复刻）：先用识图提示词分析图片，
// 再把识图结果作为提示词送入 Tag 生成指令，重新输出 Tag（对话上下文保留）
function genImgFeedback() {
  if (genBusy) return toast('AI 正在生成，请等它完成后再反馈图片');
  pickImages(genImgFile, 1, async (url, meta) => {
    if (genBusy) { toast('AI 正在生成，图片已放到输入框，稍后可点「🎯 识图并复刻」'); addGenImg(url, meta); return; }
    // ① 初步 Tag：图片内置直接解析，否则 WD Tagger
    let wdTags = [], wdSource = '';
    if (meta && meta.tags && meta.tags.length) {
      wdTags = metaToTags(meta);
      wdSource = '图片内置（' + (meta.source || 'AI 原图') + '）';
    } else if (window.aiTag) {
      try {
        toast('🔍 本地识图提取初步 Tag…');
        const tags = await runLocalTag(url);
        if (tags && tags.length) { wdTags = tags; wdSource = 'WD Tagger'; }
      } catch (e) { toast(typeof formatAppError === 'function' ? formatAppError(e, '本地识图') : ('本地识图失败：' + (e && e.message || e))); }
    }
    genConvData.push({ kind: 'user', text: '', imgs: [url], metas: [meta || null], mode: 'rk', wdTags, wdSource,
      imgRef: '【附图组 共1张】（编号规则：图片1=第1张、图片顺序与消息内附件一致）\n图片1：' + wdTagsText(wdTags),
      imgTags: [wdTagsText(wdTags)], ts: Date.now() });
    persistGenConv(); renderGenConv();
    toast('已发送图片反馈');
    genRun(genConvData.length - 1, 'rk');
  });
}
// mode: 'gen'（默认=绘图指令）/ 'desc'（识图指令）/ 'rk'（识图 → 绘图，两次调用）
async function genRun(idx, mode) {
  mode = mode || 'gen';
  if (genBusy) return;
  readCfg();
  if (!aiCfg.model) { toast('请先在「⚙️ API 设置」里填写模型名'); aiSetEl.open = true; return; }
  const userMsg = genConvData[idx];
  if (!userMsg || userMsg.kind !== 'user') return;
  if ((mode === 'desc' || mode === 'rk') && !(userMsg.imgs && userMsg.imgs.length)) return toast('识图 / 复刻需要先添加图片');
  genConvData = genConvData.slice(0, idx + 1);
  const aiMsg = { kind: 'ai', mode, status: 'run', desc: '', think: '', final: '', neg: '', ts: Date.now() };
  genConvData.push(aiMsg);
  persistGenConv(); renderGenConv();
  const aiIdx = genConvData.length - 1;
  // 流式更新每次实时从 DOM 重新查询节点，避免重渲染后写入旧节点
  const qEl = sel => genConv.querySelector('.gmsg.ai[data-idx="' + aiIdx + '"] ' + sel);
  genBusy = true; genGoBtn.disabled = genRkGo.disabled = true; genStopBtn.style.display = '';
  genAbort = new AbortController();
  let full = '', reason = '';
  let startedAt = Date.now();
  clearInterval(genTimer);
  genTimer = setInterval(() => {
    genElapsed = Math.round((Date.now() - startedAt) / 1000);
    const st = qEl('[data-role="status"]');
    if (!st) return;
    if (mode === 'desc' || mode === 'rk') st.textContent = '🖼 正在识图… ' + genElapsed + 's';
    else st.textContent = (full || reason ? '✍️ 正在生成… ' : '🤔 正在思考… ') + genElapsed + 's';
  }, 1000);
  function updateRkDesc(desc) {
    const pre = qEl('[data-role="rkdescpre"]');
    if (pre) pre.textContent = desc;
    aiMsg.desc = desc;
    autoScroll(genConv);
  }
  function updateGenPanes() {
    if (!full && !reason) return;
    const thinkBox = qEl('[data-role="think"]');
    if (!thinkBox) return;
    const thinkPre = qEl('[data-role="thinkpre"]'), finalPre = qEl('[data-role="finalpre"]'),
      negBox = qEl('[data-role="neg"]'), negPre = qEl('[data-role="negpre"]');
    const sp = splitThink(full);
    const th = sp.think ? (sp.think + (reason ? '\n\n【模型思维链】\n' + reason : '')) : reason;
    if (th) { aiMsg.think = th; thinkBox.style.display = ''; thinkPre.textContent = th; }
    const sp2 = splitNeg(sp.rest);
    aiMsg.final = sp2.pos;
    finalPre.textContent = sp2.pos;
    if (sp2.neg) { aiMsg.neg = sp2.neg; negBox.style.display = ''; negPre.textContent = sp2.neg; }
    autoScroll(genConv);
  }
  try {
    let msgs;
    if (mode === 'desc' || mode === 'rk') {
      // ---------- 第一阶段：识图指令（输入 = ①本地Tag + 原图） ----------
      let desc = '';
      let descText = userMsg.text || '请分析这张图片，详细列出其中的所有元素并描述内容。';
      if (userMsg.wdTags && userMsg.wdTags.length) {
        descText += '\n\n【本地识图初步Tag（WD Tagger，供参考）】\n' + wdTagsText(userMsg.wdTags) +
          '\n\n请以上述初步 Tag 为基础，补充它们无法表达的细节、相对位置关系与互动信息，输出完整描述。';
      }
      const descMsgs = [{ role: 'system', content: effectiveVision() },
        { role: 'user', content: contentParts(descText, userMsg.imgs) }];
      try {
        await chatComplete(descMsgs, { stream: true, signal: genAbort.signal, onDelta: (dd, rc) => { if (rc) desc += rc; if (dd) desc += dd; updateRkDesc(desc); } });
      } catch (e) {
        if (genAbort.signal.aborted) throw e;
        if (/Failed to fetch|NetworkError|fetch|CORS/i.test(String((e && e.message) || e))) throw e;
        desc = await chatComplete(descMsgs, { stream: false, signal: genAbort.signal });
        updateRkDesc(desc);
      }
      if (!desc) throw new Error('识图结果为空');
      aiMsg.desc = desc;
      if (mode === 'desc') {
        aiMsg.status = 'ok';
        persistGenConv(); renderGenConv();
        toast('识图完成');
        return;
      }
      // ---------- 第二阶段：识图描述 → 绘图指令（②描述 + 原图 + ①Tag 一并发送） ----------
      full = ''; reason = ''; startedAt = Date.now();
      // 改动3：检测识图描述中的特殊构图关键词（第一人称视角/分镜/极端透视），自动注入对应附录
      // 识图复刻：标签池只发本地识图得到的 Tag（不带整个标签库）
      const rkPool = (userMsg.wdTags || []).map(w => {
        const lib = tagMap.get(w.tag);
        return { en: w.tag, zh: lib ? lib.zh : '' };
      });
      let rkSys = composeSystem('rk', { text: desc, tagPool: rkPool, strict: aiStrict.checked, phase: 1 });
      rkSys = injectSpecialAppendix(rkSys, desc);
      let rkUserText = desc;
      if (userMsg.wdTags && userMsg.wdTags.length) {
        rkUserText += '\n\n【本地识图初步Tag（WD Tagger）】\n' + wdTagsText(userMsg.wdTags);
      }
      if (userMsg.imgRef) {
        rkUserText += '\n\n' + userMsg.imgRef + '\n（编号对应上方附图顺序，修改需求请按 图片1..N 引用）';
      }
      rkUserText += '\n\n【任务】请严格依据上面这段对图片的描述与初步 Tag，对照原图，生成最终的 Tag（Anima 提示词）。';
      msgs = [
        { role: 'system', content: rkSys },
        { role: 'user', content: contentParts(rkUserText, userMsg.imgs) }
      ];
    } else {
      msgs = genApiMsgs(idx);
    }
    // ---------- 绘图调用（gen / rk 第二阶段）----------
    try {
      await chatComplete(msgs, { stream: true, signal: genAbort.signal, onDelta: (d, rc) => { if (rc) reason += rc; if (d) full += d; updateGenPanes(); } });
    } catch (e) {
      if (genAbort.signal.aborted) throw e;
      if (/Failed to fetch|NetworkError|fetch|CORS/i.test(String((e && e.message) || e))) throw e; // 网络错误不降级
      full = await chatComplete(msgs, { stream: false, signal: genAbort.signal });
      updateGenPanes();
    }
    const sp = splitThink(full);
    aiMsg.think = sp.think ? (sp.think + (reason ? '\n\n【模型思维链】\n' + reason : '')) : reason;
    const sp2 = splitNeg(sp.rest);
    aiMsg.final = sp2.pos; aiMsg.neg = sp2.neg;
    if (!aiMsg.final) throw new Error('模型返回内容为空或缺少【最终提示词】');
    aiMsg.status = 'ok';
    persistGenConv(); renderGenConv();
    toast((mode === 'rk' ? '复刻完成 · 用时 ' : '生成完成 · 用时 ') + genElapsed + 's');
  } catch (e) {
    if (genAbort.signal.aborted) {
      const sp = splitThink(full);
      aiMsg.think = sp.think ? (sp.think + (reason ? '\n\n【模型思维链】\n' + reason : '')) : reason;
      aiMsg.final = splitNeg(sp.rest).pos;
      aiMsg.status = 'stopped';
      toast('已停止');
    } else {
      aiMsg.error = aiError(e);
      aiMsg.status = 'err';
      toast(mode === 'desc' ? '识图失败' : mode === 'rk' ? '复刻失败' : '生成失败');
    }
    persistGenConv(); renderGenConv();
  } finally {
    clearInterval(genTimer);
    genBusy = false; genGoBtn.disabled = genRkGo.disabled = false; genStopBtn.style.display = 'none';
  }
}

/* ---------- 测试连接 ---------- */
async function aiTest() {
  readCfg();
  if (!aiCfg.model) return toast('请先填写模型名');
  aiTestBtn.innerHTML = '<span class="spin"></span> 测试中…'; aiTestBtn.disabled = true;
  try {
    await chatComplete([{ role: 'user', content: 'ping' }], { stream: false, maxTokens: 5 });
    toast('连接成功 ✓');
  } catch (e) {
    toast(typeof formatAppError === 'function' ? formatAppError(e, 'AI 连接测试') : ('连接失败：' + aiError(e).slice(0, 140)));
  } finally {
    aiTestBtn.innerHTML = '🔌 测试连接'; aiTestBtn.disabled = false;
  }
}

/* ---------- 世界书（World Info） ---------- */
function matchedNames(text) {
  const wb = wbEntriesFor(text);
  return wb.length ? '📖 将注入条目：' + wb.map(e => e.name || '未命名').join('、') : '';
}
function renderWbMatch() {
  genWbMatch.textContent = genDesc.value.trim() ? matchedNames(genDesc.value) : '';
  chatWbMatch.textContent = chatIn.value.trim() ? matchedNames(chatIn.value) : '';
}
function persistAI() { saveJSON(LS_AI, aiCfg); }
function saveWb() {
  const w = activeWorld();
  if (w) {
    w.entries = getActiveEntries();
    aiCfg.wb = w.entries; // 兼容旧配置/旧导出，业务读取不再依赖该字段
  }
  persistAI();
  renderWbMatch();
}
function renderWb() {
  wbList.replaceChildren();
  const entries = getActiveEntries();
  if (!entries.length) {
    wbList.innerHTML = '<div class="empty" style="padding:16px 0">还没有条目，点“＋ 新建条目”创建一个。<br><span style="font-size:12px">例如：关键词“泳池 beach” → 自动注入“此类场景使用 swimsuit、pool 等标签”。</span></div>';
    return;
  }
  entries.forEach((e, i) => {
    const d = document.createElement('div');
    d.className = 'wbitem' + (e.enabled ? '' : ' off') + (e.collapsed ? ' collapsed' : '');
    d.innerHTML =
      '<div class="wbhead">' +
        '<button class="wbmv wbfold" title="折叠 / 展开">' + (e.collapsed ? '▸' : '▾') + '</button>' +
        '<input class="wbname" placeholder="条目名称" value="' + esc(e.name || '') + '">' +
        '<label class="opt"><input type="checkbox" class="wbconst"' + (e.constant ? ' checked' : '') + '> 常驻</label>' +
        '<label class="opt"><input type="checkbox" class="wben"' + (e.enabled ? ' checked' : '') + '> 启用</label>' +
        '<span style="flex:1"></span>' +
        '<button class="wbmv" title="上移">↑</button><button class="wbmv" title="下移">↓</button>' +
        '<button class="wbdel" title="删除条目">✕</button>' +
      '</div>' +
      '<input class="wbkeys" placeholder="触发关键词（空格/逗号分隔，如：泳池 beach 夏天；常驻条目可留空）" value="' + esc(e.keys || '') + '">' +
      '<textarea class="wbcontent" rows="3" placeholder="条目内容（注入提示词的正文，如：此类场景使用 swimsuit、pool、wet skin 等标签）">' + esc(e.content || '') + '</textarea>';
    const nameEl = d.querySelector('.wbname'), keysEl = d.querySelector('.wbkeys'), contentEl = d.querySelector('.wbcontent'),
      constEl = d.querySelector('.wbconst'), enEl = d.querySelector('.wben');
    const upd = () => {
      e.name = nameEl.value.trim();
      e.keys = keysEl.value;
      e.content = contentEl.value;
      e.constant = constEl.checked;
      e.enabled = enEl.checked;
      d.classList.toggle('off', !e.enabled);
      saveWb();
    };
    nameEl.addEventListener('input', upd);
    keysEl.addEventListener('input', upd);
    contentEl.addEventListener('input', upd);
    constEl.addEventListener('change', upd);
    enEl.addEventListener('change', upd);
    const mvBtns = d.querySelectorAll('.wbmv');
    mvBtns[0].onclick = () => {
      const j = i - 1;
      if (j < 0) return;
      const arr = getActiveEntries();
      [arr[i], arr[j]] = [arr[j], arr[i]];
      saveWb(); renderWb();
    };
    mvBtns[1].onclick = () => {
      const j = i + 1;
      const arr = getActiveEntries();
      if (j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      saveWb(); renderWb();
    };
    d.querySelector('.wbdel').onclick = () => {
      if (confirm('删除条目「' + (e.name || '未命名') + '」？')) {
        getActiveEntries().splice(i, 1);
        saveWb(); renderWb();
      }
    };
    const foldBtn = d.querySelector('.wbfold');
    foldBtn.onclick = () => {
      e.collapsed = !e.collapsed;
      d.classList.toggle('collapsed', e.collapsed);
      foldBtn.textContent = e.collapsed ? '▸' : '▾';
      saveWb();
    };
    wbList.appendChild(d);
  });
}

/* -------- 世界书列表 / 选择 / 启停 -------- */
function renderWorldSelector() {
  if (!worldSel) return;
  worldSel.replaceChildren();
  for (const w of worldList()) {
    const o = document.createElement('option');
    o.value = w.id;
    o.textContent = (w.enabled === false ? '（停用）' : '') + (w.name || '未命名');
    worldSel.appendChild(o);
  }
  const cur = activeWorld();
  if (cur) worldSel.value = cur.id;
}
function renderWorldCards() {
  if (!worldCards) return;
  worldCards.replaceChildren();
  const cur = activeWorld();
  for (const w of worldList()) {
    const isCur = cur && w.id === cur.id;
    const d = document.createElement('div');
    d.className = 'wbcard' + (isCur ? ' active' : '');
    const name = document.createElement('span'); name.className = 'wc-name'; name.textContent = w.name || '未命名';
    d.appendChild(name);
    if (isCur) { const b = document.createElement('span'); b.className = 'wc-badge'; b.textContent = '当前'; d.appendChild(b); }
    const cnt = document.createElement('span'); cnt.className = 'wc-count'; cnt.textContent = ((w.entries || []).length) + ' 条'; d.appendChild(cnt);
    const toggle = document.createElement('label'); toggle.className = 'opt';
    const ck = document.createElement('input'); ck.type = 'checkbox'; ck.checked = w.enabled !== false;
    ck.onchange = () => { w.enabled = ck.checked; persistAI(); renderWorldSelector(); renderWorldCards(); renderWbTitle(); renderWbMatch(); };
    toggle.append(ck, ' 启用'); d.appendChild(toggle);
    const del = document.createElement('button'); del.className = 'wbmv'; del.textContent = '删除';
    del.onclick = () => deleteWorld(w.id);
    d.appendChild(del);
    worldCards.appendChild(d);
  }
  renderWbTitle();
}
function renderWbTitle() {
  const cur = activeWorld();
  if (wbListTitle) wbListTitle.textContent = '📖 「' + (cur ? cur.name : '') + '」的条目' + (cur && cur.enabled === false ? '（已停用）' : '');
}
function setActiveWorld(id) {
  const src = worldList().find(x => x.id === id);
  if (!src) return;
  const cur = activeWorld();
  if (cur) cur.entries = getActiveEntries();
  aiCfg.worldSel = id;
  if (!Array.isArray(src.entries)) src.entries = [];
  aiCfg.wb = src.entries; // 兼容旧配置/旧导出
  persistAI();
  renderWorldSelector(); renderWorldCards(); renderWbTitle();
  renderWb(); renderWbMatch();
}
function addWorld() {
  const name = prompt('拓展提示词名称', '新拓展提示词');
  if (!name) return;
  const w = { id: 'world_' + Date.now(), name, enabled: true, constant: false, entries: [] };
  aiCfg.worlds.push(w);
  setActiveWorld(w.id);
  toast('已新建世界书「' + name + '」（在下方“＋ 新建条目”添加内容）');
}
function deleteWorld(id) {
  const ws = worldList();
  if (ws.length <= 1) { toast('至少保留一本世界书'); return; }
  const w = ws.find(x => x.id === id);
  if (!w) return;
  if (!confirm('删除世界书「' + (w.name || '') + '」及其全部条目？')) return;
  ws.splice(ws.indexOf(w), 1);
  if (aiCfg.worldSel === id) setActiveWorld(ws[0].id);
  else { persistAI(); renderWorldSelector(); renderWorldCards(); renderWbTitle(); }
  toast('已删除世界书');
}
function wbImportWorld(entries, name) {
  const w = { id: 'world_' + Date.now(), name: name || '导入的世界书', enabled: true, constant: false, entries: entries.map(worldEntry) };
  aiCfg.worlds.push(w);
  setActiveWorld(w.id);
}

/* -------- 预览：主提示词 / 世界书提示词 -------- */
function mainPromptPreview() {
  let s = effectiveSys();
  s += '\n\n【质量词与画师（默认前缀，提示词开头使用）】\n' + effectiveQp();
  s += '\n\n【识图指令（识图并复刻时替代绘图指令）】\n' + effectiveVision();
  s += '\n\n【生成Tag指令】\n' + effectiveGenTask();
  s += '\n\n' + (state.nsfwOn ? NSFW_ALLOW : NSFW_GUARD);
  return s;
}
function worldBookPreview(input) {
  const w = activeWorld();
  if (!w || w.enabled === false) return '（当前世界书已停用，不注入）';
  const cnst = (w.entries || []).filter(e => e && e.enabled !== false && e.constant);
  const kw = (w.entries || []).filter(e => e && e.enabled !== false && !e.constant && String(e.keys || '').trim());
  let s = '【世界书：' + (w.name || '') + '】\n';
  s += cnst.length ? '\n常驻（始终注入）：\n' + wbBlock(cnst) : '\n（无常驻条目）';
  if (input) {
    const hit = wbEntriesFor(input).filter(e => !e.constant);
    s += hit.length ? '\n\n当前输入命中的关键词条目：\n' + wbBlock(hit) : '';
  }
  s += '\n\n关键词条目（' + kw.length + ' 个，按输入命中注入）：' + (kw.length ? kw.map(e => e.name || '未命名').join('、') : '无');
  return s;
}

/* -------- 预设（主提示词）选择 / 保存 / 导入导出 -------- */
function renderPresetBar() {
  if (!presetSel) return;
  presetSel.replaceChildren();
  for (const p of presetList()) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name || '未命名预设';
    presetSel.appendChild(o);
  }
  const cur = activePreset();
  if (cur) presetSel.value = cur.id;
}
function applyPreset(id) {
  const p = presetList().find(x => x.id === id);
  if (!p) return;
  aiCfg.presetSel = id;
  aiCfg.sysPrompt = p.sysPrompt || '';
  aiCfg.genTask = p.genTask || '';
  aiCfg.visionPrompt = p.visionPrompt || '';
  aiCfg.qualityPrefix = p.quality || '';
  persistAI();
  aiSys.value = effectiveSys();
  genTask.value = effectiveGenTask();
  aiVision.value = effectiveVision();
  qpText.value = effectiveQp();
  renderPresetBar();
  toast('已应用预设「' + (p.name || '') + '」');
}
function saveAsPreset() {
  const name = prompt('预设名称', '我的主提示词');
  if (!name) return;
  const p = { id: 'preset_' + Date.now(), name,
    sysPrompt: aiSys.value.trim() === DEFAULT_BASE_PROMPT.trim() ? '' : aiSys.value.trim(),
    genTask: genTask.value.trim() === GEN_TASK.trim() ? '' : genTask.value.trim(),
    visionPrompt: aiVision.value.trim() === DEFAULT_VISION_PROMPT.trim() ? '' : aiVision.value.trim(),
    quality: qpText.value.trim() === DEFAULT_QP.trim() ? '' : qpText.value.trim() };
  aiCfg.presets.push(p);
  aiCfg.presetSel = p.id;
  persistAI();
  renderPresetBar();
  toast('已存为预设「' + name + '」');
}
function deletePreset() {
  const ps = presetList();
  if (ps.length <= 1) { toast('至少保留一个主提示词预设'); return; }
  const p = activePreset();
  if (!p) return;
  if (!confirm('删除预设「' + (p.name || '') + '」？')) return;
  ps.splice(ps.indexOf(p), 1);
  aiCfg.presetSel = ps[0].id;
  persistAI();
  renderPresetBar();
  toast('已删除预设');
}
function presetExportData() {
  const cur = activePreset();
  return { format: 'dbt-presets', version: 1, active: cur ? cur.id : '', name: 'AI绘画Tag工具箱·主提示词预设', presets: presetList() };
}
function presetImportData(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { return null; }
  if (!d || !Array.isArray(d.presets) || !d.presets.length) return null;
  return d;
}

/* ---------- 世界书（World Info）：导入 / 导出 / 打包 / 选择性导入 ---------- */
// SillyTavern 兼容格式：{ name, entries: { "0": { key[], comment, content, constant, disable, ... } } }
var WB_SPECIAL = [
  { id: 'base', name: '基础提示词' },
  { id: 'vision', name: '识图提示词' },
  { id: 'qp', name: '质量词与画师' }
];
function wbEntryToST(e, i) {
  return {
    uid: i + 1,
    key: String(e.keys || '').split(/[\s,，、]+/).map(s => s.trim()).filter(Boolean),
    keysecondary: [],
    comment: e.name || ('条目 ' + (i + 1)),
    content: e.content || '',
    constant: !!e.constant,
    selective: false,
    order: 100 + i,
    position: 0,
    disable: e.enabled === false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    probability: 100,
    useProbability: true,
    depth: 4,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: false,
    automationId: '',
    role: 'system',
    vectorized: false,
    sticky: null,
    cooldown: null,
    delay: null,
    displayIndex: i
  };
}
function wbWorldToST(w) {
  const entries = {};
  (w.entries || []).forEach((e, i) => { entries[String(i)] = wbEntryToST(e, i); });
  return { name: (w.name || '拓展提示词'), description: 'AI绘画Tag工具箱导出的世界书（SillyTavern World Info 兼容）。', entries };
}
function wbBuildSingleWorld(w) { return wbWorldToST(w); }
function wbBuildAllWorlds() {
  return { format: 'dbt-worldbooks', version: 1, name: 'AI绘画Tag工具箱·世界书合集', description: '多本世界书的合集（酒馆式，可整本导入）。', worlds: worldList().map(w => wbWorldToST(w)) };
}
function wbDownload(data, fname) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('已导出：' + fname);
}
var WB_ENTRY_SCHEMA_VERSION = 1;
function normalizeWorldEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = String(raw.comment || raw.name || '').trim() || '未命名条目';
  const content = String(raw.content == null ? '' : raw.content).trim();
  if (!content) return null;
  const rawKeys = Array.isArray(raw.key) ? raw.key : Array.isArray(raw.keys) ? raw.keys : [raw.key || raw.keys || ''];
  const keys = rawKeys.flatMap(v => String(v == null ? '' : v).split(/[\s,，、]+/)).map(s => s.trim()).filter(Boolean);
  const special = (WB_SPECIAL.find(s => s.name === name) || {}).id || null;
  return {
    name: name.slice(0, 80),
    keys: [...new Set(keys)].slice(0, 60).map(s => s.slice(0, 120)),
    content: content.slice(0, 24000),
    constant: raw.constant === true || raw.constant === 1 || raw.constant === 'true',
    enabled: !(raw.disable === true || raw.disable === 1 || raw.disable === 'true') && raw.enabled !== false,
    special
  };
}
function wbParseEntries(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return null; }
  const out = [];
  const push = (raw) => { const entry = normalizeWorldEntry(raw); if (entry) out.push(entry); };
  if (data && typeof data === 'object') {
    if (data.entries && typeof data.entries === 'object') {
      const list = Array.isArray(data.entries) ? data.entries : Object.values(data.entries);
      for (const e of list) push(e);
    } else if (Array.isArray(data)) {
      for (const e of data) push(e);
    }
  }
  return out.length ? out : null;
}
var wbImportPending = [];
function wbOpenImportModal(parsed, fname) {
  wbImportPending = parsed;
  wbModalHint.textContent = '文件：' + fname + ' · ' + parsed.length + ' 个条目。勾选后将以一本新世界书导入（不会覆盖现有世界书）。';
  wbImportList.replaceChildren();
  parsed.forEach(e => {
    const lab = document.createElement('label');
    lab.className = 'wbimp';
    const body = document.createElement('div');
    body.className = 'wi-body';
    const nameEl = document.createElement('div');
    nameEl.className = 'wi-name';
    nameEl.textContent = e.name;
    if (e.constant) {
      const t = document.createElement('span'); t.className = 'wi-tag const'; t.textContent = '常驻'; nameEl.appendChild(t);
    }
    if (!e.enabled) {
      const t = document.createElement('span'); t.className = 'wi-tag'; t.textContent = '原文件已禁用'; nameEl.appendChild(t);
    }
    const prev = document.createElement('div');
    prev.className = 'wi-prev';
    prev.textContent = e.content.slice(0, 140);
    const keys = document.createElement('div');
    keys.className = 'wi-keys';
    keys.textContent = e.keys.length ? '关键词：' + e.keys.join('、') : '无触发关键词（仅常驻时生效）';
    body.append(nameEl, prev, keys);
    const ck = document.createElement('input');
    ck.type = 'checkbox';
    ck.checked = true;
    lab.append(ck, body);
    wbImportList.appendChild(lab);
  });
  wbModal.classList.add('show');
  scrimEl.classList.add('show');
}
function wbCloseImportModal() {
  wbModal.classList.remove('show');
  if (!aiModal.classList.contains('show') && !helpModal.classList.contains('show') && !addModal.classList.contains('show') && !sponsorModal.classList.contains('show')) scrimEl.classList.remove('show');
}
function wbDoImport() {
  const checks = Array.from(wbImportList.querySelectorAll('.wbimp input'));
  const chosen = [];
  checks.forEach((ck, i) => { if (ck.checked) chosen.push(wbImportPending[i]); });
  wbCloseImportModal();
  if (!chosen.length) { toast('未勾选任何条目'); return; }
  wbImportWorld(chosen, wbImportName || '导入的世界书');
  renderWorldSelector(); renderWorldCards(); renderWbTitle();
  toast('已导入拓展提示词（' + chosen.length + ' 条），并设为当前');
}
var wbImportName = '导入的世界书';
function parseWorldFile(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { return null; }
  if (d && d.format === 'dbt-worldbooks' && Array.isArray(d.worlds)) {
    const worlds = [];
    for (const w of d.worlds) {
      const entries = wbParseEntries(JSON.stringify(w));
      if (entries) worlds.push({ name: String(w.name || '拓展提示词'), entries });
    }
    return worlds.length ? { kind: 'multi', worlds } : null;
  }
  const entries = wbParseEntries(text);
  if (!entries) return null;
  return { kind: 'single', name: String((d && d.name) || '导入的世界书'), entries };
}
wbImport.onclick = () => wbImportFile.click();
wbImportFile.addEventListener('change', () => {
  const f = wbImportFile.files && wbImportFile.files[0];
  wbImportFile.value = '';
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    const info = parseWorldFile(String(fr.result || ''));
    if (!info) { toast(typeof formatAppError === 'function' ? formatAppError('解析失败：不是有效的拓展提示词 JSON', '导入世界书') : '解析失败：不是有效的拓展提示词 JSON'); return; }
    if (info.kind === 'multi') {
      let first = null;
      for (const wd of info.worlds) {
        wbImportWorld(wd.entries, wd.name);
        if (!first) first = aiCfg.worlds[aiCfg.worlds.length - 1];
      }
      if (first) { aiCfg.worldSel = first.id; aiCfg.wb = getActiveEntries(); persistAI(); }
      renderWorldSelector(); renderWorldCards(); renderWbTitle(); renderWb(); renderWbMatch();
      toast('已导入 ' + info.worlds.length + ' 本世界书');
    } else {
      wbImportName = info.name;
      wbOpenImportModal(info.entries, f.name);
    }
  };
  fr.readAsText(f);
});
wbExport.onclick = () => {
  saveWb();
  const w = activeWorld();
  if (!w) return;
  wbDownload(wbBuildSingleWorld(w), (w.name || '拓展提示词') + '.json');
};
wbBundle.onclick = () => {
  saveWb();
  const d = new Date();
  const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  wbDownload(wbBuildAllWorlds(), 'AI绘画Tag工具箱世界书合集_' + stamp + '.json');
};
wbSelAll.onclick = () => wbImportList.querySelectorAll('.wbimp input').forEach(ck => ck.checked = true);
wbSelNone.onclick = () => wbImportList.querySelectorAll('.wbimp input').forEach(ck => ck.checked = false);
wbImportGo.onclick = wbDoImport;
wbImportCancel.onclick = wbCloseImportModal;
wbModalClose.onclick = wbCloseImportModal;

/* ---------- 预设（主提示词）与世界书控件接线 ---------- */
presetSel.addEventListener('change', () => { if (presetSel.value) applyPreset(presetSel.value); });
presetSave.onclick = () => { readCfg(); saveAsPreset(); };
presetDelete.onclick = deletePreset;
presetExport.onclick = () => {
  saveWb();
  wbDownload(presetExportData(), 'AI绘画Tag工具箱主提示词预设.json');
};
var presetImportFile = document.createElement('input');
presetImportFile.type = 'file';
presetImportFile.accept = '.json,application/json';
presetImportFile.hidden = true;
document.body.appendChild(presetImportFile);
presetImport.onclick = () => presetImportFile.click();
presetImportFile.addEventListener('change', () => {
  const f = presetImportFile.files && presetImportFile.files[0];
  presetImportFile.value = '';
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    const d = presetImportData(String(fr.result || ''));
    if (!d) { toast(typeof formatAppError === 'function' ? formatAppError('解析失败：不是有效的主提示词预设 JSON', '导入主提示词预设') : '解析失败：不是有效的主提示词预设 JSON'); return; }
    let added = 0;
    for (const p of d.presets) {
      if (!p || !p.name) continue;
      const np = { id: 'preset_' + Date.now() + '_' + added, name: p.name, sysPrompt: p.sysPrompt || '', genTask: p.genTask || '', visionPrompt: p.visionPrompt || '', quality: p.quality || '' };
      aiCfg.presets.push(np); added++;
    }
    if (added) { aiCfg.presetSel = aiCfg.presets[aiCfg.presets.length - added].id; persistAI(); renderPresetBar(); applyPreset(aiCfg.presetSel); toast('已导入 ' + added + ' 个预设'); }
    else toast('文件中没有可导入的预设');
  };
  fr.readAsText(f);
});
genTaskReset.onclick = () => { genTask.value = GEN_TASK; readCfg(); toast('已重置为默认生成Tag指令'); };
worldSel.addEventListener('change', () => { if (worldSel.value) setActiveWorld(worldSel.value); });
worldEnabled.addEventListener('change', () => {
  const w = activeWorld();
  if (!w) return;
  w.enabled = worldEnabled.checked;
  persistAI(); renderWorldSelector(); renderWorldCards(); renderWbTitle(); renderWbMatch();
  toast(w.enabled ? '拓展提示词已启用' : '拓展提示词已停用（不再注入提示词）');
});
worldAdd.onclick = addWorld;
previewWorld.onclick = () => { const t = worldBookPreview(genDesc.value.trim()); toast('已复制拓展提示词'); copyText(t, '已复制拓展提示词'); };

/* ---------- 自由问答 ---------- */
// V1.1：问答历史持久化到 localStorage，关闭浏览器后再次打开仍在
var chatHist = loadJSON(LS_CHAT, []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-60);
restoreImageRefs(chatHist, function () { renderChat(); persistWithImageRefs(LS_CHAT, chatHist); }).catch(function () {});
var chatBusy = false, chatAbort = null;
// 持久化（含图片时可能超出 localStorage 配额：超限则移除图片再保存）
function persistChat() {
  persistWithImageRefs(LS_CHAT, chatHist).then(function (ok) { if (!ok) persistChatLegacy(); }).catch(function () { persistChatLegacy(); });
  if (!hasImageData(chatHist)) return;
  return;
  function persistChatLegacy() {
    try { if (saveJSON(LS_CHAT, chatHist)) return; } catch (e) {}
    let n = 0;
    chatHist.forEach(m => { if (m && Array.isArray(m.imgs) && m.imgs.length) { m.imgs = []; n++; } });
    try {
      saveJSON(LS_CHAT, chatHist);
      if (n) toast('本地空间不足：已移除 ' + n + ' 张图片以保存问答');
    } catch (e2) { toast(typeof formatAppError === 'function' ? formatAppError(e2, '保存问答对话') : '本地保存失败：问答未能保存'); }
  }
}
function chatWelcomeText() {
  return '你好！我是 Tag 挑选助手，已了解 Anima 模型写作规则' + (aiStrict.checked ? '和本站标签库。' : '。') + '描述你想画的画面，或直接问我推荐哪些 Tag。';
}
function chatReset() {
  chatHist = [];
  chatPendingImgs = [];
  refreshChatImgs();
  persistChat();
  chatBoxEl.replaceChildren();
  addMsg('ai', chatWelcomeText(), { noBtns: true });
}
function renderChat() {
  chatBoxEl.replaceChildren();
  if (!chatHist.length) { addMsg('ai', chatWelcomeText(), { noBtns: true }); return; }
  chatHist.forEach((m, i) => {
    if (m.role === 'assistant') {
      appendAssistantMsg(m.content, m, '');
    } else {
      const b = addMsg(m.role, m.content, { imgs: m.imgs });
      b.dataset.idx = i;
    }
  });
}
function addMsg(role, text, opts) {
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  const t = document.createElement('div');
  t.className = 'msgtext';
  t.textContent = (text && text.trim()) ? text : ((opts && opts.imgs && opts.imgs.length) ? '📷 图片' : '');
  d.appendChild(t);
  if (opts && opts.imgs && opts.imgs.length) {
    const g = document.createElement('div');
    g.className = 'gimgs';
    opts.imgs.forEach((u, k) => {
      const w = document.createElement('span');
      w.className = 'giw';
      const im = document.createElement('img');
      im.src = u; im.alt = '图片' + (k + 1);
      const num = document.createElement('b');
      num.className = 'imgnum'; num.textContent = '图' + (k + 1);
      w.append(im, num);
      g.appendChild(w);
    });
    d.appendChild(g);
    if (opts.imgRef) {
      const ref = document.createElement('div');
      ref.className = 'imgref';
      ref.textContent = opts.imgRef;
      d.appendChild(ref);
    }
  }
  if (!opts || !opts.noBtns) {
    const btns = document.createElement('div');
    btns.className = 'mbtns';
    if (role === 'user') {
      const eb = document.createElement('button');
      eb.className = 'mbtn';
      eb.textContent = '✏️';
      eb.title = '修改这条消息后自动重新发送';
      eb.onclick = () => editUserMsg(d);
      btns.appendChild(eb);
    }
    d.appendChild(btns);
  }
  chatBoxEl.appendChild(d);
  autoScroll(chatBoxEl); // 智能跟随：不动用户已上翻的位置
  return d;
}
function delMsg(d) {
  if (chatBusy) { toast('AI 正在回复，请稍候再删除'); return; }
  const i = Number(d.dataset.idx);
  if (!(i >= 0 && i < chatHist.length)) return;
  if (!confirm('删除这条消息？')) return;
  chatHist.splice(i, 1);
  persistChat();
  renderChat();
}
function editUserMsg(d) {
  if (chatBusy) { toast('AI 正在回复，请稍候再编辑'); return; }
  const i = Number(d.dataset.idx);
  if (!(i >= 0 && i < chatHist.length) || chatHist[i].role !== 'user') return;
  const ta = document.createElement('textarea');
  ta.value = chatHist[i].content;
  d.classList.add('editing');
  d.replaceChildren(ta);
  const acts = document.createElement('div');
  acts.className = 'mbtns';
  const save = document.createElement('button');
  save.className = 'mbtn msave';
  save.textContent = '保存并发送';
  const cancel = document.createElement('button');
  cancel.className = 'mbtn';
  cancel.textContent = '取消';
  acts.append(save, cancel);
  d.appendChild(acts);
  ta.focus();
  cancel.onclick = () => renderChat();
  save.onclick = () => {
    const t = ta.value.trim();
    if (!t && !(chatHist[i].imgs && chatHist[i].imgs.length)) return toast('内容不能为空');
    const imgs = chatHist[i].imgs ? chatHist[i].imgs.slice() : [];
    chatHist = chatHist.slice(0, i);
    renderChat();
    chatSend(t, imgs);
  };
}
// 把 AI 回复按 ``` 代码块拆段：代码块 = 提示词（加粗 + 复制按钮），其余为普通文字
function splitReply(text) {
  const segs = [];
  const re = /```(?:text|txt|markdown)?\s*\n?([\s\S]*?)(?:```|$)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    const pre = text.slice(last, m.index).trim();
    if (pre) segs.push({ type: 'text', content: pre });
    segs.push({ type: 'code', content: m[1].trim() });
    last = m.index + m[0].length;
  }
  const post = text.slice(last).trim();
  if (post) segs.push({ type: 'text', content: post });
  return segs.length ? segs : [{ type: 'text', content: text }];
}
// 渲染一条 AI 回复：每条提示词代码块单独成气泡（加粗 + 复制按钮），其余文字照常，互不混合
function appendAssistantMsg(content, msg, reasonHTML) {
  const idx = chatHist.indexOf(msg);
  const st = {
    idx: idx,
    msg: msg,
    weights: (msg && msg.weights) || (msg ? (msg.weights = {}) : {}),
    sel: (msg && msg.wsel) || null,
    bubbles: [],
    promptBubbles: [],
    chips: [],
    rawOn: false
  };
  const segs = splitReply(content);
  if (!segs.some(s => s.type === 'code')) {
    const b = addMsg('ai', content);
    b.dataset.idx = idx;
    b.__rawText = content;
    st.bubbles.push(b);
  } else {
    for (const s of segs) {
      const b = addMsg('ai', s.content);
      b.dataset.idx = idx;
      b.__rawText = s.content;
      if (s.type === 'code') {
        b.classList.add('prompt');
        b.querySelector('.msgtext').classList.add('ptext');
        const cp = document.createElement('button');
        cp.className = 'mbtn cp';
        cp.textContent = '📋 复制提示词';
        cp.title = '复制这段提示词（包含已设置的权重）';
        cp.onclick = () => copyText(b.querySelector('.msgtext').textContent, '提示词已复制');
        b.querySelector('.mbtns').insertBefore(cp, b.querySelector('.mbtns').firstChild);
        st.promptBubbles.push(b);
      }
      st.bubbles.push(b);
    }
  }
  // 思维链放在气泡外（紧贴首气泡之前），查看原始消息时仍保持可见
  if (reasonHTML) st.bubbles[0].insertAdjacentHTML('beforebegin', reasonHTML);
  // 原始消息 / 删除按钮只放在“复制提示词”所在气泡上，避免一条消息里重复出现
  const actionB = st.promptBubbles.length ? st.promptBubbles[st.promptBubbles.length - 1] : st.bubbles[st.bubbles.length - 1];
  // 「查看原始消息」：点击后本条消息变为白色原文框（隐藏分段气泡与下方标签），下方出现「恢复显示」
  const rawWrap = document.createElement('div');
  rawWrap.className = 'mraw';
  rawWrap.hidden = true;
  const rp = document.createElement('pre');
  rp.textContent = content;
  rawWrap.appendChild(rp);
  chatBoxEl.appendChild(rawWrap);
  st.rawWrap = rawWrap;
  const restRow = document.createElement('div');
  restRow.className = 'mbtns mrest';
  restRow.style.display = 'none';
  const rest = document.createElement('button');
  rest.className = 'mbtn';
  rest.textContent = '↩ 恢复显示';
  rest.title = '恢复分段气泡与标签显示';
  restRow.appendChild(rest);
  chatBoxEl.appendChild(restRow);
  const rawBtn = document.createElement('button');
  rawBtn.className = 'mbtn raw';
  rawBtn.textContent = '📄 原始消息';
  rawBtn.title = '查看 AI 发送的完整原文（不含思考过程）';
  const delBtn = document.createElement('button');
  delBtn.className = 'mbtn del';
  delBtn.textContent = '🗑️';
  delBtn.title = '删除这条消息';
  delBtn.dataset.idx = idx;
  delBtn.onclick = () => delMsg(delBtn);
  const toggleRaw = () => {
    st.rawOn = !st.rawOn;
    rawWrap.hidden = !st.rawOn;
    restRow.style.display = st.rawOn ? 'flex' : 'none';
    st.bubbles.forEach(x => { x.style.display = st.rawOn ? 'none' : ''; });
    rawBtn.classList.toggle('on', st.rawOn);
    if (st.rawOn) {
      const rr = rawWrap.getBoundingClientRect();
      const br = chatBoxEl.getBoundingClientRect();
      chatBoxEl.scrollTop += rr.top - br.top - 6;
    } else {
      autoScroll(chatBoxEl);
    }
  };
  rawBtn.onclick = toggleRaw;
  rest.onclick = toggleRaw;
  actionB.querySelector('.mbtns').append(rawBtn, delBtn);
  attachChips(st, st.promptBubbles.map(b => b.__rawText).join('\n'));
  return st;
}
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
var fmtW = v => String(Math.round((v || 0) * 10) / 10);
// 长按连续触发
function holdBtn(btn, fn) {
  let timer = null, iv = null;
  const stop = () => { clearTimeout(timer); clearInterval(iv); timer = iv = null; };
  const start = e => { e.preventDefault(); fn(); timer = setTimeout(() => { iv = setInterval(fn, 90); }, 420); };
  btn.addEventListener('mousedown', start);
  btn.addEventListener('touchstart', start, { passive: false });
  btn.addEventListener('mouseup', stop);
  btn.addEventListener('mouseleave', stop);
  btn.addEventListener('touchend', stop);
  btn.addEventListener('touchcancel', stop);
}
function refreshChips(st) {
  st.chips.forEach(c => {
    const on = c.en === st.sel;
    const w = st.weights[c.en] || 0;
    c.chip.classList.toggle('ons', on);
    c.wctl.hidden = !on;
    c.val.value = fmtW(w);
    let badge = c.chip.querySelector('.wbadge');
    if (!on && w) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'wbadge'; c.chip.appendChild(badge); }
      badge.textContent = fmtW(w);
    } else if (badge) { badge.remove(); }
  });
}
function selectWeight(st, en) {
  if (st.sel === en) {
    st.sel = null;
    if (st.msg) st.msg.wsel = null;
  } else {
    st.sel = en;
    if (st.msg) st.msg.wsel = en;
  }
  refreshChips(st);
  renderMsgBubbles(st);
}
// 只把权重与选中高亮应用到“正式提示词”气泡上，其余文字保持不变
function renderMsgBubbles(st) {
  const active = Object.keys(st.weights).filter(w => st.weights[w]).sort((a, b) => b.length - a.length);
  st.promptBubbles.forEach(b => {
    const textEl = b.querySelector('.msgtext');
    if (!textEl) return;
    let html = esc(b.__rawText);
    if (active.length) {
      const re = new RegExp('\\(\\s*(?:' + active.map(escRe).join('|') + ')\\s*:\\s*[\\d.]+(?:,[\\d.]+)?\\s*\\)|\\b(?:' + active.map(escRe).join('|') + ')\\b', 'gi');
      html = html.replace(re, m => {
        const isWrap = m.charAt(0) === '(';
        const body = m.replace(/^\(\s*/, '').replace(/\s*:.*$/, '').trim();
        const w = active.find(x => x.toLowerCase() === body.toLowerCase());
        const v = w ? st.weights[w] : 0;
        return isWrap ? '(' + body + ':' + fmtW(v) + ')' : '(' + m + ':' + fmtW(v) + ')';
      });
    }
    if (st.sel) {
      html = html.replace(new RegExp('\\b(' + escRe(st.sel) + ')\\b', 'gi'), '<mark class="whl">$1</mark>');
    }
    textEl.innerHTML = html;
  });
}
function attachChips(st, text) {
  const found = detectTagsInText(text).slice(0, 30);
  if (!found.length) return;
  const lastB = st.promptBubbles.length ? st.promptBubbles[st.promptBubbles.length - 1] : st.bubbles[st.bubbles.length - 1];
  const wrap = document.createElement('div');
  wrap.className = 'tagchips';
  st.chips = [];
  for (const t of found) {
    const en = t.en;
    const chip = document.createElement('button');
    chip.className = 'tchip ok';
    chip.textContent = t.zh;
    chip.title = en + '（' + t.zh + '）· 点选后用 ▲▼ 调节权重（±0.1，长按连续），数值可直接输入';
    const wctl = document.createElement('span');
    wctl.className = 'wctl';
    wctl.hidden = true;
    const up = document.createElement('button');
    up.className = 'wbtn';
    up.textContent = '▲';
    up.title = '权重 +0.1（长按连续增加）';
    const val = document.createElement('input');
    val.className = 'wval';
    val.type = 'text';
    val.inputMode = 'decimal';
    val.value = '0';
    val.title = '直接输入权重（回车确认）';
    const dn = document.createElement('button');
    dn.className = 'wbtn';
    dn.textContent = '▼';
    dn.title = '权重 -0.1（长按连续减少）';
    wctl.append(up, val, dn);
    chip.onclick = () => selectWeight(st, en);
    val.addEventListener('change', () => {
      let v = parseFloat(val.value);
      if (isNaN(v)) v = 0;
      v = Math.max(-10, Math.min(10, Math.round(v * 10) / 10));
      st.weights[en] = v;
      val.value = fmtW(v);
      renderMsgBubbles(st);
    });
    val.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); val.blur(); } });
    holdBtn(up, () => {
      const v = Math.max(-10, Math.min(10, Math.round(((st.weights[en] || 0) + 0.1) * 10) / 10));
      st.weights[en] = v;
      val.value = fmtW(v);
      renderMsgBubbles(st);
    });
    holdBtn(dn, () => {
      const v = Math.max(-10, Math.min(10, Math.round(((st.weights[en] || 0) - 0.1) * 10) / 10));
      st.weights[en] = v;
      val.value = fmtW(v);
      renderMsgBubbles(st);
    });
    wrap.append(chip, wctl);
    st.chips.push({ en, chip, wctl, val });
  }
  lastB.appendChild(wrap);
  refreshChips(st);
  renderMsgBubbles(st);
}
function autoGrowChatIn() {
  chatIn.style.height = 'auto';
  chatIn.style.height = Math.min(chatIn.scrollHeight, 140) + 'px';
}
async function chatSend(text, imgs) {
  if (chatBusy) return;
  const txt = (typeof text === 'string' ? text : chatIn.value.trim());
  const imgList = Array.isArray(imgs) ? imgs : chatPendingImgs.slice();
  const imgMetas = chatImgMetas.slice();
  if (!txt && !imgList.length) return;
  readCfg();
  if (!aiCfg.model) { toast('请先在「⚙️ API 设置」里填写模型名'); aiSetEl.open = true; return; }
  chatPendingImgs = [];
  chatImgMetas = [];
  refreshChatImgs();
  chatIn.value = '';
  autoGrowChatIn();
  // 附图编号 + 每张图识图 Tag（供 AI 稳定引用"图片X"，多组附图不混淆）
  let imgRef = '';
  if (imgList.length) {
    const r = await imgRefBlock(imgList, imgMetas);
    imgRef = r.ref;
  }
  const ud = addMsg('user', txt, { imgs: imgList, imgRef });
  chatHist.push({ role: 'user', content: txt, imgs: imgList, imgRef });
  persistChat();
  ud.dataset.idx = chatHist.length - 1;
  const bubble = addMsg('ai', '🤔 思考中…');
  const textEl = bubble.querySelector('.msgtext');
  let reason = '', reasonBox = null, firstToken = false;
  chatBusy = true; chatSendBtn.disabled = true;
  chatAbort = new AbortController();
  let full = '';
  const msgs = [{ role: 'system', content: composeSystem('chat', { text: txt, strict: aiStrict.checked }) },
    ...chatHist.map(m => ({ role: m.role, content: contentParts(m.content + (m.imgs && m.imgs.length ? '\n\n' + (m.imgRef || imgRefFallback(m.imgs)) : ''), m.imgs) }))];
  const onDelta = (d, rc) => {
    if (rc) {
      reason += rc;
      if (!reasonBox) {
        reasonBox = document.createElement('details');
        reasonBox.className = 'mthink';
        reasonBox.innerHTML = '<summary>💭 思考过程</summary><pre></pre>';
        bubble.insertBefore(reasonBox, textEl);
      }
      reasonBox.querySelector('pre').textContent = reason;
    }
    if (d) {
      if (!firstToken) { firstToken = true; textEl.textContent = ''; }
      full += d;
      textEl.textContent = full + '▌';
      autoScroll(chatBoxEl);
    }
  };
  try {
    try {
      await chatComplete(msgs, { stream: true, signal: chatAbort.signal, onDelta });
    } catch (e) {
      if (chatAbort.signal.aborted) throw e;
      if (/Failed to fetch|NetworkError|fetch|CORS/i.test(String((e && e.message) || e))) throw e; // 网络错误不降级
      full = await chatComplete(msgs, { stream: false, signal: chatAbort.signal });
    }
    if (!full) throw new Error('模型返回内容为空');
    chatHist.push({ role: 'assistant', content: full });
    persistChat();
    if (reasonBox) reasonBox.open = false;
    const reasonHTML = reasonBox ? reasonBox.outerHTML : '';
    bubble.remove();
    appendAssistantMsg(full, chatHist[chatHist.length - 1], reasonHTML);
  } catch (e) {
    if (!chatAbort.signal.aborted) {
      const err = '⚠️ ' + aiError(e);
      textEl.textContent = (full ? full + '\n\n' : '') + err;
      chatHist.push({ role: 'assistant', content: err });
    } else {
      textEl.textContent = (full ? full : '（未输出内容）') + '（已停止）';
      chatHist.push({ role: 'assistant', content: full });
    }
    persistChat();
  } finally {
    chatBusy = false; chatSendBtn.disabled = false;
    bubble.dataset.idx = chatHist.length - 1;
  }
}
