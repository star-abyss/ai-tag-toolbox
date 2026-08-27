'use strict';
/* ================= 国际化与语言包 =================
 * 语言包只作为 JSON 数据读取，永不执行其中的脚本。界面语言、Tag 标识和
 * AI 输出方向彼此独立；语言缺失时按当前语言 → English → 简体中文回退。
 */
var I18n = (function () {
  var builtin = {}, packs = {}, current = 'zh-CN', mode = 'auto', ready = false;
  var STORAGE_KEY = 'dbt_locale_v1';
  var FALLBACK = { 'ui.common.loading': '加载中…', 'ui.common.diagnostic': '诊断', 'ui.header.language': '文/A', 'ui.header.languageTitle': '切换界面语言' };
  function pathGet(obj, key) { return String(key || '').split('.').reduce((v, k) => v && v[k], obj); }
  function flatLookup(pack, key) { return pathGet(pack, key) == null ? pathGet(pack, 'ui.' + key) : pathGet(pack, key); }
  function interpolate(value, params) {
    return String(value == null ? '' : value).replace(/\{([\w.-]+)\}/g, (_, k) => params && params[k] != null ? String(params[k]) : '{' + k + '}');
  }
  function t(key, params) {
    var value = flatLookup(packs[current] || {}, key);
    if (value == null && current !== 'en-US') value = flatLookup(packs['en-US'] || {}, key);
    if (value == null && current !== 'zh-CN') value = flatLookup(packs['zh-CN'] || {}, key);
    if (value == null) value = FALLBACK[key];
    return interpolate(value == null ? key : value, params);
  }
  function localeId() { return current; }
  function available() { return Object.keys(packs).map(id => ({ id, name: packs[id].meta && packs[id].meta.name || id, nativeName: packs[id].meta && packs[id].meta.nativeName || id, builtin: !!builtin[id] })); }
  function detect() {
    var lang = '';
    try { lang = String(navigator.language || navigator.userLanguage || '').toLowerCase(); } catch (e) {}
    return lang.indexOf('zh') === 0 ? 'zh-CN' : lang.indexOf('en') === 0 ? 'en-US' : 'zh-CN';
  }
  function saveState() { try { storageSet(STORAGE_KEY, JSON.stringify({ mode, locale: current })); } catch (e) {} }
  function readState() { var s = loadJSON(STORAGE_KEY, null); if (s && typeof s === 'object') { mode = s.mode === 'manual' ? 'manual' : 'auto'; current = String(s.locale || current); } }
  function safePack(pack) {
    if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return null;
    var meta = pack.meta || {};
    if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(String(meta.id || ''))) return null;
    if (!/^\d+\.\d+\.\d+$/.test(String(meta.version || ''))) return null;
    if (JSON.stringify(pack).length > 2 * 1024 * 1024) return null;
    return pack;
  }
  function register(pack, isBuiltin) { var p = safePack(pack); if (!p) return false; packs[p.meta.id] = p; if (isBuiltin) builtin[p.meta.id] = true; return true; }
  function apply(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
    root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.getAttribute('data-i18n-title')); });
    root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
    document.documentElement.lang = current;
    var title = t('ui.document.title'); if (title !== 'ui.document.title') document.title = title;
  }
  function emit() { apply(document); window.dispatchEvent(new CustomEvent('localechange', { detail: { locale: current, mode, locales: available() } })); }
  async function init() {
    readState();
    var list = [];
    try { if (window.aiTag && window.aiTag.locale && window.aiTag.locale.list) list = await window.aiTag.locale.list(); } catch (e) {}
    for (const item of (list || [])) {
      try { var raw = await window.aiTag.locale.read(item.id); if (register(raw, !!item.builtin)) {} } catch (e) {}
    }
    // 无 preload / 网页预览时至少保留基础回退。
    if (!packs['zh-CN']) register({ meta: { id: 'zh-CN', name: '简体中文', nativeName: '简体中文', version: '1.0.0' }, ui: {}, categories: {}, errors: {} }, true);
    if (!packs['en-US']) register({ meta: { id: 'en-US', name: 'English', nativeName: 'English', version: '1.0.0' }, ui: {}, categories: {}, errors: {} }, true);
    if (mode === 'auto') current = detect();
    else if (!packs[current]) current = 'zh-CN';
    ready = true; emit(); return current;
  }
  async function setLocale(id, selectedMode) {
    id = String(id || ''); if (!packs[id]) return false;
    current = id; mode = selectedMode === 'auto' ? 'auto' : 'manual'; saveState(); emit(); return true;
  }
  function tagLabel(tag) {
    if (!tag) return '';
    var id = current, override = pathGet(packs[id], 'tags.' + tag.en);
    if (override && typeof override === 'object') return String(override.name || tag.en);
    if (id === 'en-US') return String(tag.en || '').replace(/_/g, ' ');
    return String(tag.zh || tag.en || '');
  }
  function tagAliases(tag) {
    if (!tag) return [];
    var override = pathGet(packs[current], 'tags.' + tag.en);
    if (override && Array.isArray(override.aliases)) return override.aliases.map(String);
    return Array.isArray(tag.al) ? tag.al.filter(x => /[\u3400-\u9fff]/.test(String(x || ''))).map(String) : [];
  }
  function categoryLabel(id) { return t('categories.' + id); }
  function errorText(code, field, fallback) {
    var value = pathGet(packs[current], 'errors.' + code + '.' + field);
    if (value == null && current !== 'en-US') value = pathGet(packs['en-US'], 'errors.' + code + '.' + field);
    if (value == null && current !== 'zh-CN') value = pathGet(packs['zh-CN'], 'errors.' + code + '.' + field);
    return value == null ? (fallback == null ? '' : String(fallback)) : String(value);
  }
  async function importPack(file) {
    var pack = file && typeof file === 'object' && file.meta ? file : null;
    if (!pack && typeof file === 'string') { try { pack = JSON.parse(file); } catch (e) { return { ok: false, code: 'LOCALE_INVALID_JSON' }; } }
    if (!safePack(pack)) return { ok: false, code: 'LOCALE_INVALID' };
    try { var r = await window.aiTag.locale.import(pack); if (!r || !r.ok) return { ok: false, code: 'LOCALE_INVALID' }; register(pack, false); return { ok: true, id: pack.meta.id }; } catch (e) { return { ok: false, code: 'LOCALE_INVALID' }; }
  }
  return { init, t, setLocale, localeId, available, apply, tagLabel, tagAliases, categoryLabel, errorText, importPack, isReady: () => ready, getMode: () => mode, diagnostics: () => ({ locale: current, mode, locales: available() }) };
})();

function t(key, params) { return I18n.t(key, params); }

(function wireLocaleUi() {
  function draw() {
    var pop = document.getElementById('localePop'); if (!pop) return;
    pop.replaceChildren();
    I18n.available().forEach(item => {
      var b = document.createElement('button'); b.className = 'popitem'; b.dataset.locale = item.id;
      b.textContent = (item.nativeName || item.name) + (item.builtin ? ' · ' + t('ui.settings.languageBuiltin') : '');
      b.onclick = () => I18n.setLocale(item.id, item.id === 'zh-CN' || item.id === 'en-US' ? 'manual' : 'manual');
      pop.appendChild(b);
    });
    var sep = document.createElement('div'); sep.className = 'locale-actions';
    var imp = document.createElement('button'); imp.className = 'popitem'; imp.textContent = t('ui.settings.languageImport');
    var input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true;
    imp.onclick = () => input.click(); input.onchange = () => { var f = input.files && input.files[0]; if (!f) return; var fr = new FileReader(); fr.onload = async () => { var r = await I18n.importPack(String(fr.result || '')); if (!r.ok) toast(typeof formatAppError === 'function' ? formatAppError(r.code, '导入语言包') : '语言包导入失败'); else { draw(); await I18n.setLocale(r.id, 'manual'); toast('语言包已导入'); } }; fr.readAsText(f); };
    sep.append(imp, input); pop.appendChild(sep);
  }
  function bind() {
    var btn = document.getElementById('localeBtn'), pop = document.getElementById('localePop'); if (!btn || !pop) return;
    btn.onclick = e => { e.stopPropagation(); draw(); pop.hidden = !pop.hidden; };
    document.addEventListener('click', e => { if (!e.target.closest('#localeWrap')) pop.hidden = true; });
    window.addEventListener('localechange', () => { draw(); btn.title = t('ui.header.languageTitle'); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
