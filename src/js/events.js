'use strict';
/* ================= 事件 ================= */
qEl.addEventListener('input', () => { state.q = qEl.value; render(); });
$('#favBtn').onclick = openDrawer;
$('#saveFav').onclick = openDrawer;
$('#drawerClose').onclick = closeDrawer;
$('#favSave').onclick = saveFav;
favName.addEventListener('keydown', e => { if (e.key === 'Enter') saveFav(); });
$('#helpBtn').onclick = openHelp;
$('#sponsorBtn').onclick = () => { sponsorModal.classList.add('show'); scrimEl.classList.add('show'); };
$('#sponsorClose').onclick = closeAll;
$('#helpClose').onclick = closeAll;
$('#addTagBtn').onclick = openAdd;
$('#addClose').onclick = closeAll;
$('#nCancel').onclick = closeAll;
$('#nSave').onclick = saveCustom;
nCat.addEventListener('change', () => { nNewCatWrap.style.display = nCat.value === '__new__' ? '' : 'none'; });
nEn.addEventListener('keydown', e => { if (e.key === 'Enter') saveCustom(); });
scrimEl.onclick = closeAll;
$('#clearSel').onclick = () => { state.sel.clear(); persist(); render(); toast('已清空选择'); };
$('#copyAll').onclick = () => {
  if (!state.sel.size) return toast('还没有选中任何标签');
  copyText([...state.sel].join(', '), '已复制 ' + state.sel.size + ' 个标签');
};
$('#clearQ').onclick = () => { state.q = ''; qEl.value = ''; render(); qEl.focus(); };
$('#menuBtn').onclick = () => {
  sidebarEl.classList.toggle('show');
  scrimEl.classList.toggle('show', sidebarEl.classList.contains('show'));
};
catListEl.addEventListener('click', e => {
  if (e.target.closest('.cat') && sidebarEl.classList.contains('show')) {
    sidebarEl.classList.remove('show'); scrimEl.classList.remove('show');
  }
});
function setNsfw(on) {
  state.nsfwOn = on;
  if (!on && state.cat === 'nsfw') state.cat = 'quality';
  nsfwBtn.classList.toggle('on', on);
  nsfwBtn.innerHTML = '<span class="dot"></span>' + (on ? t('ui.header.adultOn') : t('ui.header.adult'));
  if (aiNsfwChk) aiNsfwChk.checked = on;
  persist(); render();
}
nsfwBtn.onclick = () => {
  setNsfw(!state.nsfwOn);
  toast(state.nsfwOn ? '已显示成人标签（含少量成人向内容），AI 将允许输出成人标签' : '已隐藏成人标签，AI 将拒绝成人向内容');
};
aiNsfwChk.addEventListener('change', () => {
  setNsfw(aiNsfwChk.checked);
  toast(state.nsfwOn ? '已允许 AI 输出成人内容' : '已禁止 AI 输出成人内容');
});

document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement ? document.activeElement.tagName : '');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); qEl.focus(); qEl.select(); }
  else if (e.key === '/' && !typing) { e.preventDefault(); qEl.focus(); }
  else if (e.key === 'Escape') {
    if (drawer.classList.contains('show') || helpModal.classList.contains('show') || addModal.classList.contains('show') || aiModal.classList.contains('show') || sponsorModal.classList.contains('show') || wbModal.classList.contains('show') || cfmModal.classList.contains('show') || !themePop.hidden || sidebarEl.classList.contains('show')) { closeAll(); return; }
    if (state.q) { state.q = ''; qEl.value = ''; render(); }
    qEl.blur();
  }
});
