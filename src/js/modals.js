'use strict';
/* ================= 抽屉 / 弹层 ================= */
function openDrawer() { drawer.classList.add('show'); scrimEl.classList.add('show'); setTimeout(() => favName.focus(), 250); }
function closeDrawer() { drawer.classList.remove('show'); scrimEl.classList.remove('show'); }
function openHelp() { helpModal.classList.add('show'); scrimEl.classList.add('show'); }
function closeAll() {
  closeDrawer();
  helpModal.classList.remove('show'); addModal.classList.remove('show'); aiModal.classList.remove('show');
  sponsorModal.classList.remove('show'); wbModal.classList.remove('show'); cfmModal.classList.remove('show');
  themePop.hidden = true;
  sidebarEl.classList.remove('show');
  scrimEl.classList.remove('show');
}
function saveFav() {
  const name = favName.value.trim();
  if (!name) return toast('请先给组合起个名字');
  if (!state.sel.size) return toast('当前没有已选标签');
  const old = state.favs.find(f => f.name === name);
  const fav = { name, tags: [...state.sel], t: Date.now() };
  state.favs = old ? state.favs.map(f => f === old ? fav : f) : [...state.favs, fav];
  persist(); renderFavs(); favName.value = '';
  toast(old ? '已更新收藏「' + name + '」' : '已收藏「' + name + '」');
}

