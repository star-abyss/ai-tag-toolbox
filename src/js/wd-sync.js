'use strict';
/* ================= 识图模型标签同步 =================
 * 把当前识图模型标签表里「库里还没有」的标签，按模型自带分类补充成独立模块，
 * 随模型切换自动刷新（角色名单独成「识图·角色」模块，出现新分类也自动补模块）。
 * 模型分类编码（WD Tagger 约定）：0 通用 / 1 画师 / 3 作品 / 4 角色 / 5 元标签 / 9 分级
 */
var WD_MODULE_META = [
  { cat: 0, id: 'wd_0', name: '识图·通用', icon: '🏷️', color: '#0EA5E9' },
  { cat: 1, id: 'wd_1', name: '识图·画师', icon: '🎨', color: '#F97316' },
  { cat: 3, id: 'wd_3', name: '识图·作品', icon: '📺', color: '#8B5CF6' },
  { cat: 4, id: 'wd_4', name: '识图·角色', icon: '👤', color: '#EC4899' },
  { cat: 5, id: 'wd_5', name: '识图·元标签', icon: 'ℹ️', color: '#64748B' },
  { cat: 9, id: 'wd_9', name: '识图·分级', icon: '⭐', color: '#F59E0B' }
];
var WD_MODULE_BY_CAT = new Map(WD_MODULE_META.map(m => [m.cat, m]));
var wdCats = [], wdTags = [], wdColorMap = new Map(), wdModelName = '', wdModelId = '';
function wdModuleOf(cat) {
  return WD_MODULE_BY_CAT.get(cat) || { cat, id: 'wd_' + cat, name: '识图·分类' + cat, icon: '🏷️', color: '#94A3B8' };
}
async function loadModelTags() {
  if (!window.aiTag) { wdCats = []; wdTags = []; wdColorMap = new Map(); wdModelName = ''; wdModelId = ''; rebuild(); return; }
  const model = wdModel();
  let res = null;
  try { res = await window.aiTag.tags(model); } catch (e) { res = null; }
  if (res && res.ok && Array.isArray(res.tags)) {
    const existing = new Set(BASE_TAG_KEYS);
    for (const c of customs) existing.add(normKey(c.en));
    const byCat = new Map();
    for (const t of res.tags) {
      const name = String(t.name || ''); if (!name) continue;
      if (existing.has(normKey(name))) continue; // 库里已有（含中文翻译）的不重复补充
      const cat = typeof t.category === 'number' ? t.category : 0;
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push({ name, count: t.count || 0 });
    }
    const newCats = [];
    for (const m of WD_MODULE_META) if (byCat.has(m.cat) && byCat.get(m.cat).length) newCats.push(m);
    for (const cat of byCat.keys()) if (!WD_MODULE_BY_CAT.has(cat)) newCats.push(wdModuleOf(cat));
    const shortName = 'EVA02 Canary';
    wdCats = newCats;
    wdColorMap = new Map(newCats.map(c => [c.id, c.color]));
    wdModelName = res.name || '';
    wdModelId = res.id || model;
    wdTags = [];
    for (const c of newCats) {
      const list = byCat.get(c.cat) || [];
      list.sort((a, b) => (b.count || 0) - (a.count || 0) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      for (const t of list) {
        wdTags.push({
          en: t.name, zh: '', al: [], cat: c.id, sub: shortName, nsfw: false, custom: false, count: t.count,
          hay: (t.name + '\n' + t.name.replace(/_/g, ' ')).toLowerCase()
        });
      }
    }
  } else {
    wdCats = []; wdTags = []; wdColorMap = new Map(); wdModelName = ''; wdModelId = '';
  }
  rebuild();
  render();
}

var categories = [], catMap = new Map(), tags = [], tagMap = new Map();
var customs = loadJSON(LS_CUSTOM, []);
function rebuild() {
  // 自定义分类（插入到成人标签之前）
  const customCats = [];
  for (const c of customs) {
    if (!BASE_CAT_MAP.has(c.cat) && !customCats.includes(c.cat)) customCats.push(c.cat);
  }
  categories = BASE_CATEGORIES.filter(c => c.id !== 'nsfw')
    .concat(customCats.map(id => ({ id, name: id, icon: '🏷️', custom: true })))
    .concat(wdCats.map(c => ({ id: c.id, name: c.name, icon: c.icon, wd: true })))
    .concat(BASE_CATEGORIES.filter(c => c.id === 'nsfw'));
  catMap = new Map(categories.map(c => [c.id, c]));

  // 子分类顺序（以内置数据出现顺序为准，自定义追加在后）
  const subOrder = new Map(); let n = 0;
  for (const t of BASE_TAGS) { const k = t.cat + '\u0001' + t.sub; if (!subOrder.has(k)) subOrder.set(k, n++); }
  for (const t of wdTags) { const k = t.cat + '\u0001' + t.sub; if (!subOrder.has(k)) subOrder.set(k, n++); }

  // 合并：自定义同名标签覆盖内置标签
  const customByKey = new Map();
  for (const c of customs) customByKey.set(normKey(c.en), c);
  const merged = [];
  for (const t of BASE_TAGS) { if (customByKey.has(normKey(t.en))) continue; merged.push(t); }
  for (const c of customs) {
    const en = String(c.en).trim(); if (!en) continue;
    const sub = (String(c.sub || '').trim() || '自定义');
    const al = String(c.al || '').trim().split(/\s+/).filter(Boolean);
    const entry = {
      en, zh: String(c.zh || '').trim(), al,
      cat: String(c.cat), sub, nsfw: String(c.cat) === 'nsfw', custom: true,
      hay: (en + '\n' + en.replace(/_/g, ' ') + '\n' + String(c.zh || '') + '\n' + String(c.al || '')).toLowerCase()
    };
    merged.push(entry);
    const k = entry.cat + '\u0001' + sub;
    if (!subOrder.has(k)) subOrder.set(k, n++);
  }
  for (const t of wdTags) merged.push(t);
  const catIndex = new Map(categories.map((c, i) => [c.id, i]));
  merged.sort((a, b) => {
    const ca = catIndex.has(a.cat) ? catIndex.get(a.cat) : 999, cb = catIndex.has(b.cat) ? catIndex.get(b.cat) : 999;
    if (ca !== cb) return ca - cb;
    const sa = subOrder.get(a.cat + '\u0001' + a.sub), sb = subOrder.get(b.cat + '\u0001' + b.sub);
    if (sa !== sb) return (sa === undefined ? 999 : sa) - (sb === undefined ? 999 : sb);
    // 识图模型标签按出现频率降序（库里自带标签 count 为 0，不受影响，仍按字母序）
    if ((b.count || 0) !== (a.count || 0)) return (b.count || 0) - (a.count || 0);
    return a.en.toLowerCase().localeCompare(b.en.toLowerCase());
  });
  tags = merged;
  tagMap = new Map();
  for (const t of tags) tagMap.set(t.en, t);
  _tagVer = (_tagVer || 0) + 1; // 标签库版本变更 → 使 matchTagsForText 缓存失效
}

var state = { cat: 'quality', q: '', sel: new Set(), favs: [], nsfwOn: false };
state.favs = loadJSON(LS_FAV, []);
for (const en of loadJSON(LS_SEL, [])) state.sel.add(en);
var sc = storageGet(LS_CAT, '');
if (sc) state.cat = sc;
state.nsfwOn = loadJSON(LS_NSFW, false);

var qEl = $('#q'), catListEl = $('#catList'), catTitle = $('#catTitle'), catCnt = $('#catCnt'),
  chipsEl = $('#chips'), selbox = $('#selbox'), previewEl = $('#preview'), selCount = $('#selCount'),
  toastEl = $('#toast'), drawer = $('#drawer'), scrimEl = $('#scrim'), favList = $('#favList'),
  favName = $('#favName'), helpModal = $('#helpModal'), sponsorModal = $('#sponsorModal'), clearQBtn = $('#clearQ'),
  nsfwBtn = $('#nsfwBtn'), sidebarEl = $('#sidebar'), themeBtn = $('#themeBtn'), themePop = $('#themePop'),
  addModal = $('#addModal'), nEn = $('#nEn'), nZh = $('#nZh'), nAl = $('#nAl'), nSub = $('#nSub'),
  nCat = $('#nCat'), nNewCatWrap = $('#nNewCatWrap'), nNewCat = $('#nNewCat'), customList = $('#customList');

var toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1700);
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function hl(text, terms) {
  if (!terms.length) return esc(text);
  const lower = text.toLowerCase(), ranges = [];
  for (const w of terms) { let i = 0; while ((i = lower.indexOf(w, i)) >= 0) { ranges.push([i, i + w.length]); i += w.length; } }
  if (!ranges.length) return esc(text);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r.slice()); }
  let out = '', p = 0;
  for (const [a, b] of merged) { out += esc(text.slice(p, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>'; p = b; }
  return out + esc(text.slice(p));
}
function termsOf() { return state.q.trim().toLowerCase().split(/\s+/).filter(Boolean); }
function visible(t) { return !t.nsfw || state.nsfwOn; }
function filtered() {
  const terms = termsOf();
  return tags.filter(t => visible(t) && (state.q ? true : (state.cat === 'all' || t.cat === state.cat)) && terms.every(w => t.hay.includes(w)));
}
function persist() {
  storageSet(LS_SEL, JSON.stringify([...state.sel]));
  saveJSON(LS_FAV, state.favs);
  storageSet(LS_CAT, state.cat);
  saveJSON(LS_NSFW, state.nsfwOn);
}
function persistCustoms() { saveJSON(LS_CUSTOM, customs); }
