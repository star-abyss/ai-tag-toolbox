'use strict';
/* ================= 渲染：左侧分类 ================= */
// 分类索引色（左栏色点 + 标签卡左侧色条）
var CAT_COLORS = {
  // 统一为中等明度、低饱和语义色；避免彩色边条在浅色背景上刺眼，
  // 也让成人标签与其余分类保持同一视觉重量。
  quality: '#4967D8', negative: '#C2413A', character: '#6E5ACB', body: '#258F83', expression: '#B9770E',
  eyes: '#1E8FA5', hair: '#8A5A9E', features: '#7A63B8', outfit: '#2A8C6F', footwear: '#2A8F88',
  accessory: '#B46A2C', pose: '#5564C7', scene: '#AF7413', camera: '#3C75B8', style: '#8B63A8',
  time_weather: '#3D8A5A', atmosphere: '#AD5D83', effects: '#B34A46', food: '#A27A16', animal: '#B76832',
  other: '#64748B', rating: '#9B7B1F', series: '#287EA4', nsfw: '#A23E72'
};
// 标签库可能包含上万条模型标签。首屏只渲染一小批，接近底部时再追加，
// 避免一次性创建几百/几千个 button 阻塞主线程；搜索与选择结果不变。
var CHIP_BATCH = 160, _chipVisibleCount = CHIP_BATCH;
function catColor(id) { return CAT_COLORS[id] || wdColorMap.get(id) || '#94A3B8'; }
// 中文主译名与中文别名统一展示，避免用户看不到刚扩充的多译名。
// 英文别名仍只参与搜索，不挤占标签卡片的中文显示空间。
function tagZhDisplay(t) {
  const names = [];
  const seen = new Set();
  const add = value => {
    const s = String(value || '').trim();
    if (!s || !/[\u3400-\u9fff]/.test(s)) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key); names.push(s);
  };
  add(t && t.zh);
  if (t && Array.isArray(t.al)) t.al.forEach(add);
  return names.join(' / ');
}
function renderSidebar() {
  const terms = termsOf();
  catListEl.replaceChildren();
  const mk = (id, icon, name, cls, n) => {
    const b = document.createElement('button');
    b.className = 'cat' + (state.cat === id ? ' on' : '') + (cls ? ' ' + cls : '');
    b.innerHTML = '<span class="cico" style="background:' + catColor(id) + '1f">' + icon + '</span><span>' + esc(name) + '</span><span class="n">' + n + '</span>';
    b.onclick = () => { state.cat = id; state.q = ''; qEl.value = ''; persist(); render(); };
    catListEl.appendChild(b);
  };
  const total = tags.filter(t => visible(t) && terms.every(w => t.hay.includes(w))).length;
  mk('all', '📦', '全部', '', total);
  for (const c of categories) {
    if (c.nsfw && !state.nsfwOn) continue;
    const n = tags.filter(t => t.cat === c.id && visible(t) && terms.every(w => t.hay.includes(w))).length;
    mk(c.id, c.icon, c.name, c.neg ? 'neg' : (c.nsfw ? 'nsfw' : ''), n);
  }
}

/* ================= 渲染：右侧分组标签 ================= */
function renderChips(keepPage) {
  if (!keepPage) _chipVisibleCount = CHIP_BATCH;
  const list = filtered(), terms = termsOf();
  const c = catMap.get(state.cat);
  catTitle.innerHTML = state.q ? '🔍 搜索：' + esc(state.q) : (c ? '<span class="tico" style="background:' + catColor(c.id) + '28">' + c.icon + '</span>' + esc(c.name) : '<span class="tico">📦</span>全部');
  catCnt.textContent = list.length + ' 个标签';
  clearQBtn.style.display = state.q ? '' : 'none';
  chipsEl.replaceChildren();
  if (!list.length) {
    chipsEl.innerHTML = '<div class="empty">😕 没有匹配的标签，换个关键词试试<br><span style="font-size:12px">支持英文、中文、别名搜索</span></div>';
    return;
  }
  const show = list.slice(0, Math.min(400, _chipVisibleCount));
  // 分组计数
  const counts = new Map();
  for (const t of show) { const k = t.cat + '\u0001' + t.sub; counts.set(k, (counts.get(k) || 0) + 1); }
  const frag = document.createDocumentFragment();
  let curKey = '', groupEl = null, wrap = null;
  for (const t of show) {
    const key = t.cat + '\u0001' + t.sub;
    if (key !== curKey) {
      curKey = key;
      groupEl = document.createElement('div');
      groupEl.className = 'group';
      const cat = catMap.get(t.cat);
      const label = (state.cat === 'all' || state.q) ? (cat ? cat.icon + ' ' + cat.name + ' · ' : '') : '';
      const h = document.createElement('div');
      h.className = 'group-head';
      h.innerHTML = '<span class="name">' + esc(label + t.sub) + '</span><span class="line"></span><span class="n">' + counts.get(key) + ' 个</span>';
      groupEl.appendChild(h);
      wrap = document.createElement('div');
      wrap.className = 'chips';
      groupEl.appendChild(wrap);
      frag.appendChild(groupEl);
    }
    const b = document.createElement('button');
    b.className = 'chip' + (state.sel.has(t.en) ? ' sel' : '') + (t.cat === 'negative' ? ' neg' : '') + (t.nsfw ? ' nsfw' : '');
    b.dataset.en = t.en;
    b.style.setProperty('--c', catColor(t.cat));
    const zhDisplay = tagZhDisplay(t);
    b.title = t.en + (zhDisplay ? '（' + zhDisplay + '）' : '') + ' · ' + (catMap.get(t.cat) ? catMap.get(t.cat).name : t.cat) + ' / ' + t.sub + (t.custom ? ' · 自定义标签' : '');
    b.innerHTML = '<span class="en">' + hl(t.en, terms) + '</span><span class="zh">' + hl(zhDisplay, terms) + '</span><span class="cp" title="仅复制（不选择）">仅复制</span>';
    b.onclick = () => {
      const wasSel = state.sel.has(t.en);
      toggle(t.en);
      copyTextSilent(t.en);
      if (!wasSel) chipToast(b, '已复制');
    };
    b.querySelector('.cp').onclick = ev => { ev.stopPropagation(); copyOne(t.en); };
    wrap.appendChild(b);
  }
  chipsEl.appendChild(frag);
  if (list.length > show.length) {
    const more = document.createElement('button');
    more.className = 'abtn ghost';
    more.style.cssText = 'display:block;margin:16px auto 4px;min-width:180px';
    more.textContent = '继续加载（已显示 ' + show.length + ' / ' + list.length + '）';
    more.onclick = () => { _chipVisibleCount += CHIP_BATCH; renderChips(true); };
    chipsEl.appendChild(more);
  }
}

function renderBar() {
  selCount.textContent = state.sel.size;
  selbox.replaceChildren();
  const seen = new Set();
  for (const en of state.sel) {
    const t = tagMap.get(en); if (!t || seen.has(en)) continue; seen.add(en);
    const s = document.createElement('span');
    s.className = 'schip' + (t.cat === 'negative' ? ' neg' : '');
    s.innerHTML = '<span>' + esc(en) + '</span><span class="x" title="移除">✕</span>';
    s.querySelector('.x').onclick = () => { state.sel.delete(en); persist(); render(); };
    selbox.appendChild(s);
  }
  if (!state.sel.size) selbox.innerHTML = '<span style="color:var(--muted);font-size:12px;padding:4px 0">点击上方标签即可选中，支持多选；点标签右下角 📋 可直接复制单个。</span>';
  previewEl.innerHTML = state.sel.size ? '<b>Prompt：</b>' + esc([...state.sel].join(', ')) : '';
  $('#copyAll').textContent = '📋 复制 Prompt' + (state.sel.size ? '（' + state.sel.size + '）' : '');
}

function renderFavs() {
  if (!state.favs.length) { favList.innerHTML = '<div class="empty" style="padding:26px 0">还没有收藏。先在下方选中一组标签，再点“⭐ 收藏当前组合”。</div>'; return; }
  favList.replaceChildren();
  for (const f of [...state.favs].reverse()) {
    const d = document.createElement('div');
    d.className = 'fav';
    d.innerHTML = '<div class="fname">⭐ ' + esc(f.name) + '</div>' +
      '<div class="fmeta">' + f.tags.length + ' 个标签 · ' + new Date(f.t).toLocaleString() + '</div>' +
      '<div class="fprev">' + esc(f.tags.slice(0, 6).join(', ')) + (f.tags.length > 6 ? ' …' : '') + '</div>' +
      '<div class="fact"><button class="fbtn load">载入</button><button class="fbtn add">＋追加</button><button class="fbtn del">删除</button></div>';
    d.querySelector('.fname').onclick = () => loadFav(f, false);
    d.querySelector('.load').onclick = () => loadFav(f, false);
    d.querySelector('.add').onclick = () => loadFav(f, true);
    d.querySelector('.del').onclick = () => { if (confirm('删除收藏「' + f.name + '」？')) { state.favs = state.favs.filter(x => x !== f); persist(); renderFavs(); } };
    favList.appendChild(d);
  }
}
function loadFav(f, append) {
  const valid = f.tags.filter(en => tagMap.has(en));
  if (!append) state.sel = new Set(valid); else valid.forEach(en => state.sel.add(en));
  persist(); render(); closeDrawer();
  toast('已' + (append ? '追加' : '载入') + '收藏「' + f.name + '」');
}
function render() {
  renderSidebar(); renderChips(); renderBar(); renderFavs();
  const bsub = $('#brandSub');
  if (bsub) bsub.textContent = 'V1.3.38 · 共 ' + tags.length + ' 个标签' + (wdModelName ? '（含识图模型同步 ' + wdTags.length + ' 个）' : '') + ' · 单击选择 · 一键复制';
}

function toggle(en) {
  state.sel.has(en) ? state.sel.delete(en) : state.sel.add(en);
  persist(); renderBar();
  chipsEl.querySelectorAll('.chip').forEach(b => b.classList.toggle('sel', state.sel.has(b.dataset.en)));
}
function copyOne(en) { copyText(en, '已复制：' + en); }
// 静默复制：不弹全局提示（配合标签上的“已复制”小气泡使用）
function copyTextSilent(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).catch(() => {}); return; }
  } catch (e) {}
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  ta.remove();
}
// 在标签上方弹出“已复制”小气泡（挂到 body 用视口定位，避免被标签的 overflow 裁剪在框内）
function chipToast(chip, msg) {
  const old = document.querySelector('.chip-toast');
  if (old) old.remove();
  const r = chip.getBoundingClientRect();
  const s = document.createElement('span');
  s.className = 'chip-toast';
  s.textContent = msg;
  const above = r.top > 36; // 贴近视口顶部时改为显示在标签下方
  s.style.left = (r.left + r.width / 2) + 'px';
  s.style.top = (above ? r.top - 8 : r.bottom + 8) + 'px';
  if (!above) s.style.transform = 'translate(-50%,0)';
  document.body.appendChild(s);
  setTimeout(() => s.remove(), 900);
}
async function copyText(text, msg) {
  let ok = false;
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
  }
  toast(ok ? (msg || '已复制') : (typeof formatAppError === 'function' ? formatAppError('复制到剪贴板失败', '复制') : '复制失败，请手动复制'));
}
