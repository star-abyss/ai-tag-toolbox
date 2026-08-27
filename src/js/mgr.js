'use strict';
/* ================= 对话管理 ================= */
// 历史生成对话存档（不含当前对话）：{id,title,ts,msgs}
var genArchive = (function () {
  let arr = loadJSON(LS_GENCONVS, []);
  if (!Array.isArray(arr)) arr = [];
  return arr.filter(c => c && c.id && Array.isArray(c.msgs)).slice(0, 30);
})();
restoreImageRefs(genArchive, function () { renderMgr(); persistWithImageRefs(LS_GENCONVS, genArchive); }).catch(function () {});
function persistArchive() {
  persistWithImageRefs(LS_GENCONVS, genArchive).then(function (ok) { if (!ok) persistArchiveLegacy(); }).catch(function () { persistArchiveLegacy(); });
  if (!hasImageData(genArchive)) return;
  return;
  function persistArchiveLegacy() {
    try { if (saveJSON(LS_GENCONVS, genArchive)) return; } catch (e) {}
    let n = 0;
    genArchive.forEach(c => c && c.msgs && c.msgs.forEach(m => { if (m && Array.isArray(m.imgs) && m.imgs.length) { m.imgs = []; n++; } }));
    try {
      saveJSON(LS_GENCONVS, genArchive);
      if (n) toast('本地空间不足：已移除 ' + n + ' 张历史图片');
    } catch (e2) {}
  }
}
function convTitle(msgs) {
  const u = (msgs || []).find(m => m.kind === 'user');
  const t = (u && String(u.text) || '').replace(/\s+/g, ' ').trim();
  return t ? (t.length > 22 ? t.slice(0, 22) + '…' : t) : '（空对话）';
}
function convLastTs(msgs) {
  let t = 0;
  for (const m of (msgs || [])) if (m && m.ts > t) t = m.ts;
  return t || Date.now();
}
function genConvToText(msgs) {
  const out = ['【生成 Tag 对话】' + convTitle(msgs)];
  for (const m of msgs) {
    if (m.kind === 'user') {
      out.push('', '—— 用户 ——');
      if (m.imgs && m.imgs.length) out.push('［图片 × ' + m.imgs.length + '，未随文本导出］');
      out.push(String(m.text || ''));
    } else {
      out.push('', '—— AI ——');
      if (m.status === 'err' && m.error) out.push('⚠️ ' + m.error);
      if (m.status === 'stopped') out.push('（已停止）');
      if (m.desc) out.push('【识图分析】\n' + m.desc);
      if (m.think) out.push('【思考过程】' + (m.think.startsWith('\n') ? m.think : '\n' + m.think));
      if (m.final) out.push('【最终提示词】\n' + m.final);
      if (m.neg) out.push('【负面提示词】\n' + m.neg);
    }
  }
  return out.join('\n');
}
function chatToText() {
  const out = ['【自由问答对话】'];
  for (const m of chatHist) {
    out.push('', m.role === 'user' ? '—— 用户 ——' : '—— AI ——');
    if (m.role === 'user' && m.imgs && m.imgs.length) out.push('［图片 × ' + m.imgs.length + '，未随文本导出］');
    out.push(String(m.content || ''));
  }
  return out.join('\n');
}
// 生成对话里"进行中"的消息不参与存档
function archivableMsgs(msgs) {
  return (msgs || []).filter(m => m.kind === 'user' || (m.kind === 'ai' && m.status !== 'run'));
}
function archiveCurrentGen(silent) {
  const msgs = archivableMsgs(genConvData);
  if (msgs.length) {
    genArchive.unshift({ id: 'gc_' + Date.now() + '_' + Math.floor(Math.random() * 1e4), title: convTitle(msgs), ts: convLastTs(msgs), msgs: msgs.slice() });
    if (genArchive.length > 30) genArchive.length = 30;
    persistArchive();
  }
  genConvData = [];
  genPendingImgs = [];
  refreshGenImgs();
  persistGenConv(); renderGenConv(); renderMgr();
  toast(msgs.length ? '已保留当前对话到历史，并开启新对话' : '已开启新对话');
}
function loadArchiveConv(id) {
  if (genBusy) return toast('AI 正在生成，请先等待完成或点击「■ 停止」再载入');
  const c = genArchive.find(x => x.id === id);
  if (!c) return;
  const cur = archivableMsgs(genConvData);
  if (cur.length) {
    genArchive.unshift({ id: 'gc_' + Date.now() + '_' + Math.floor(Math.random() * 1e4), title: convTitle(cur), ts: convLastTs(cur), msgs: cur.slice() });
  }
  genArchive = genArchive.filter(x => x.id !== id);
  genConvData = c.msgs.slice();
  persistArchive(); persistGenConv(); renderGenConv(); renderMgr();
  toast('已载入历史对话');
}
function delArchiveConv(id) {
  const c = genArchive.find(x => x.id === id);
  if (!c || !confirm('删除历史对话「' + c.title + '」？')) return;
  genArchive = genArchive.filter(x => x.id !== id);
  persistArchive(); renderMgr();
  toast('已删除');
}
function mgrBtn(label, fn) {
  const b = document.createElement('button');
  b.className = 'abtn';
  b.textContent = label;
  b.onclick = fn;
  return b;
}
function mgrCard(hl, title, meta, btns) {
  const card = document.createElement('div');
  card.className = 'mgrcard' + (hl ? ' hl' : '');
  const tt = document.createElement('span'); tt.className = 'mgrtitle'; tt.textContent = title;
  const mt = document.createElement('span'); mt.className = 'mgrmeta'; mt.textContent = meta;
  const bb = document.createElement('div'); bb.className = 'mgrbtns';
  for (const [label, fn] of btns) bb.appendChild(mgrBtn(label, fn));
  card.append(tt, mt, bb);
  return card;
}
function fmtTime(t) { return new Date(t).toLocaleString(); }
function renderMgr() {
  // 当前生成对话
  mgrGenCur.replaceChildren();
  if (genConvData.length) {
    mgrGenCur.appendChild(mgrCard(true, convTitle(genConvData), genConvData.length + ' 条 · ' + fmtTime(convLastTs(genConvData)), [
      ['🔄 存档并新对话', () => archiveCurrentGen(false)],
      ['📋 导出', () => copyText(genConvToText(genConvData), '已复制当前对话')]
    ]));
  } else {
    mgrGenCur.innerHTML = '<div class="gempty" style="padding:10px 0">当前没有对话。到“✨ 生成 Tag”页描述画面，点“✨ 生成”开始。</div>';
  }
  // 历史生成对话
  mgrGenList.replaceChildren();
  if (!genArchive.length) {
    mgrGenList.innerHTML = '<div class="gempty" style="padding:10px 0">暂无历史对话。点“🔄 新对话”后，当前对话会自动存档到这里。</div>';
  } else {
    for (const c of genArchive) {
      mgrGenList.appendChild(mgrCard(false, c.title, c.msgs.length + ' 条 · ' + fmtTime(c.ts), [
        ['⬆ 载入', () => loadArchiveConv(c.id)],
        ['🗑️ 删除', () => delArchiveConv(c.id)]
      ]));
    }
  }
  // 自由问答对话
  mgrChatCur.replaceChildren();
  if (chatHist.length) {
    mgrChatCur.appendChild(mgrCard(true, '自由问答', '共 ' + chatHist.length + ' 条', [
      ['📋 导出', () => copyText(chatToText(), '已复制问答对话')],
      ['🗑️ 清空对话', () => { if (confirm('清空问答对话？')) { chatReset(); renderMgr(); toast('问答对话已清空'); } }]
    ]));
  } else {
    mgrChatCur.innerHTML = '<div class="gempty" style="padding:10px 0">暂无问答对话。</div>';
  }
}
