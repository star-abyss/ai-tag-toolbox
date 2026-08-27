'use strict';
/* ================= 标签搜索纯逻辑模块 =================
 * 只依赖运行时提供的 tags / visible / _tagVer，全程不触碰 DOM。
 * 这样搜索、翻译候选词和 AI 提示词编译可以共享同一套可测试逻辑，后续
 * 可以在 Worker 中复用，而不需要把页面状态复制过去。
 */
var _mtfKey = '', _mtfResult = null, _tagVer = 0;

// 从文本提取搜索关键词：英文单词 + 中文 2~4 字滑动片段（按片段长度优先）
function keywordsOf(text) {
  const t = String(text || '').toLowerCase();
  const out = [];
  const en = t.match(/[a-z0-9][a-z0-9_'\-]*/g) || [];
  for (const w of en) {
    const c = w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    if (c.length >= 2) out.push(c);
  }
  const zhRuns = t.match(/[\u4e00-\u9fff]+/g) || [];
  for (const run of zhRuns) {
    for (let len = 4; len >= 2; len--) {
      for (let i = 0; i + len <= run.length; i++) out.push(run.slice(i, i + len));
    }
  }
  // 去重；长片段优先；限 120 个控制耗时
  return [...new Set(out)].sort((a, b) => b.length - a.length).slice(0, 120);
}

// 按关键词匹配标签库（含中文），返回按相关度排序的标签列表（最多 300 个）
// 相关度 = 关键词长度加权 × IDF（越罕见的关键词权重越高）+ 精确命中加分
function matchTagsForText(text) {
  const key = String(text || '') + '|' + _tagVer;
  if (key === _mtfKey && _mtfResult) return _mtfResult;
  const kws = keywordsOf(text);
  if (!kws.length) { _mtfKey = key; _mtfResult = []; return []; }
  const re = new RegExp(kws.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
  const counts = new Map();
  const matchedTags = [];
  for (const t of tags) {
    if (!visible(t) || !re.test(t.hay)) continue;
    const matched = kws.filter(k => t.hay.includes(k));
    if (!matched.length) continue;
    for (const k of matched) counts.set(k, (counts.get(k) || 0) + 1);
    matchedTags.push({ t, matched });
  }
  const weightOf = k => {
    const n = counts.get(k) || 1;
    const lenW = k.length >= 4 ? 6 : k.length === 3 ? 3 : 1;
    return lenW * (1 + Math.log(1 + 18000 / n));
  };
  const scored = [];
  for (const x of matchedTags) {
    let score = 0;
    for (const k of x.matched) score += weightOf(k);
    // 精确命中：关键词等于英文名或完整中文名（不含标签原文符号）
    for (const k of kws) {
      if (k.length < 2) continue;
      if (x.t.en.toLowerCase() === k) score += 40;
      else if (x.t.zh && x.t.zh.replace(/[（）()··：:、\s]/g, '').includes(k) && k.length >= 3) score += 10;
      else if (x.t.zh && x.t.zh.includes(k) && k.length >= 2) score += 2;
    }
    scored.push({ t: x.t, score });
  }
  scored.sort((a, b) => b.score - a.score);
  _mtfKey = key; _mtfResult = scored.slice(0, 300).map(x => x.t);
  return _mtfResult;
}

// 从用户输入中识别「明确写出的库内 Tag」：英文按词边界匹配，中文按完整词匹配。
function extractUserTags(text) {
  const t0 = String(text || '').toLowerCase().trim();
  if (!t0) return [];
  const norm = s => ' ' + String(s).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const zhClean = s => String(s || '').replace(/[（）()·\s、，,：:！!？?]/g, '');
  const textNorm = norm(t0);
  const matched = [];
  for (const tag of tags) {
    if (!visible(tag)) continue;
    if (textNorm.includes(norm(tag.en))) { matched.push(tag); continue; }
    const z = zhClean(tag.zh);
    if (z.length >= 2 && textNorm.includes(z)) matched.push(tag);
  }
  // 去掉被更具体命中覆盖的短标签
  const kept = matched.filter(t => !matched.some(o => o !== t &&
    ((o.en.length > t.en.length && norm(o.en).includes(norm(t.en))) ||
     (o.zh && t.zh && zhClean(o.zh).length > zhClean(t.zh).length && zhClean(o.zh).includes(zhClean(t.zh))))));
  kept.sort((a, b) => b.en.length - a.en.length);
  return kept;
}
