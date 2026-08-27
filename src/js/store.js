'use strict';
/* ================= 状态与动态数据 ================= */
var $ = s => document.querySelector(s);
var LS_SEL = 'dbt_selected_v2', LS_FAV = 'dbt_favs_v2', LS_CAT = 'dbt_cat_v2',
  LS_NSFW = 'dbt_nsfw_v2', LS_CUSTOM = 'dbt_custom_v2', LS_THEME = 'dbt_theme_v2', LS_AI = 'dbt_ai_v2',
  LS_GENCONV = 'dbt_gen_conv_v2', LS_CHAT = 'dbt_chat_v2', LS_GENCONVS = 'dbt_gen_convs_v2';
// loadJSON / saveJSON / IDB 已收敛到 storage.js
function normKey(en) { return en.toLowerCase().replace(/_+/g, ' ').replace(/\s+/g, ' ').trim(); }

function synonymAliasesFor(en) {
  const out = [];
  if (typeof SYNONYMS_BY_EN !== 'undefined' && Array.isArray(SYNONYMS_BY_EN[en])) out.push(...SYNONYMS_BY_EN[en]);
  if (typeof SYNONYM_ALIASES !== 'undefined' && Array.isArray(SYNONYM_ALIASES[en])) out.push(...SYNONYM_ALIASES[en]);
  return [...new Set(out.map(x => String(x || '').trim()).filter(Boolean))];
}
var BASE_TAGS = [...TAGS, ...(typeof EXTRA_TAGS !== 'undefined' ? EXTRA_TAGS : [])].map(r => {
  const aliases = [...new Set([...(r[2] || '').trim().split(/\s+/).filter(Boolean), ...synonymAliasesFor(String(r[0] || ''))])];
  return {
    en: r[0], zh: r[1], al: aliases,
    cat: r[3], sub: r[4] || '默认', nsfw: !!r[5],
    hay: ([r[0], r[0].replace(/_/g, ' '), r[1], ...aliases].filter(Boolean).join('\n')).toLowerCase()
  };
});
var BASE_TAG_KEYS = new Set(BASE_TAGS.map(t => normKey(t.en)));
