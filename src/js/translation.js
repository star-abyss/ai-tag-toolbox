'use strict';
/* ================= 主页面翻译模块 =================
 * 本地翻译走主进程 Transformers.js；AI 翻译使用本站标签库的多译名
 * 参考，并按方向执行「中文 → Tag」或「Tag → 中文」。
 */
var translationView = $('#translateView');
var tagLibraryView = $('#tagLibraryView');
var headerWorkspace = $('#headerWorkspace');
var translateInput = $('#translateInput');
var translateOutput = $('#translateOutput');
var translateStatus = $('#translateStatus');
var translateDirection = $('#translateDirection');
var translateTags = $('#translateTags');
var translateTagCount = $('#translateTagCount');
var translateInputCount = $('#translateInputCount');
var translateAiBtn = $('#translateAi');
var translateCopyBtn = $('#translateCopy');
var translateCopyTagsBtn = $('#translateCopyTags');
var translateTimer = null;
var translateRequestNo = 0;
var translationOpen = false;
var translateAiElapsedTimer = null;

function translationDirectionLabel(direction, kind) {
  if (kind === 'ai') return direction === 'zh-en' ? '中文 → Tag' : 'Tag → 中文';
  return direction === 'zh-en' ? '中文 → English' : 'English → 中文';
}

function trText(key, fallback, params) {
  return typeof t === 'function' ? t(key, params) : (fallback || key);
}

function translationDirectionFor(text) {
  const selected = translateDirection ? translateDirection.value : 'auto';
  if (selected === 'zh-en' || selected === 'en-zh') return selected;
  return /[\u3400-\u9fff]/.test(String(text || '')) ? 'zh-en' : 'en-zh';
}

function translationChineseNames(t) {
  const out = [];
  const seen = new Set();
  const add = value => {
    const s = String(value || '').trim();
    if (!s || !/[\u3400-\u9fff]/.test(s)) return;
    const k = s.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  };
  add(t && t.zh);
  if (t && Array.isArray(t.al)) t.al.forEach(add);
  return out;
}

function translationInputParts(text) {
  return String(text || '').split(/[\s,，、;；|/]+/).map(s => s.trim()).filter(s => s.length >= 2);
}

function translationTagParts(text) {
  return String(text || '').split(/[,，、;；|/\n]+/).map(s => String(s || '').trim()).filter(Boolean);
}

function normalizeTranslationTag(value) {
  return String(value || '').toLowerCase().trim()
    .replace(/^[(\[]+|[)\]]+$/g, '')
    .replace(/:\s*-?\d+(?:\.\d+)?\s*\)?$/g, '')
    .replace(/[()\[\]]/g, '')
    .replace(/[\s_]+/g, '_');
}

function translationExactTagReferences(text) {
  const parts = translationTagParts(text);
  if (!parts.length || typeof tags === 'undefined') return [];
  const out = [];
  const used = new Set();
  for (const part of parts) {
    const key = normalizeTranslationTag(part);
    if (!key) continue;
    let found = null;
    for (const t of tags) {
      if (!t || (typeof visible === 'function' && !visible(t))) continue;
      const forms = [t.en].concat(Array.isArray(t.al) ? t.al : []);
      if (forms.some(f => normalizeTranslationTag(f) === key)) { found = t; break; }
    }
    if (found && !used.has(found.en)) {
      used.add(found.en);
      out.push({ tag: found, matchedTerms: [part], matchType: '精确 Tag' });
    }
  }
  return out;
}

function translationMatchEvidence(text, tag) {
  const parts = translationTagParts(text).concat(translationInputParts(text));
  const kws = typeof keywordsOf === 'function' ? keywordsOf(text) : [];
  const hay = String(tag && tag.hay || '').toLowerCase();
  const en = String(tag && tag.en || '').toLowerCase();
  const terms = [...new Set(parts.concat(kws))];
  const exact = terms.filter(term => {
    const n = String(term).toLowerCase();
    const normalized = n.replace(/[\s_]+/g, '_');
    const tagNormalized = en.replace(/[\s_]+/g, '_');
    return normalized === tagNormalized || n === en.replace(/_/g, ' ') || (hay.includes(n) && n.length >= 3);
  });
  return exact.slice(0, 5);
}

function buildTranslationReference(text, limit, direction) {
  const exact = direction === 'en-zh' ? translationExactTagReferences(text) : [];
  const exactSet = new Set(exact.map(x => x.tag.en));
  const fuzzy = typeof matchTagsForText === 'function' ? matchTagsForText(text) : [];
  const matched = exact.concat(fuzzy.filter(t => !exactSet.has(t.en)).map(t => ({ tag: t, matchedTerms: translationMatchEvidence(text, t), matchType: '相关匹配' })));
  const max = Math.max(1, Math.min(Number(limit) || 60, 100));
  return matched.slice(0, max).map((item, i) => {
    const t = item.tag;
    const zh = translationChineseNames(t);
    const enAliases = Array.isArray(t.al) ? t.al.filter(x => !/[\u3400-\u9fff]/.test(String(x || ''))).map(String) : [];
    return {
      rank: i + 1,
      en: String(t.en || ''),
      zhPrimary: zh[0] || '',
      zhAliases: zh.slice(1),
      enAliases: [...new Set(enAliases)].slice(0, 8),
      category: String(t.cat || ''),
      subcategory: String(t.sub || ''),
      matchedTerms: item.matchedTerms && item.matchedTerms.length ? item.matchedTerms : translationMatchEvidence(text, t),
      matchType: item.matchType || '相关匹配'
    };
  });
}

function translationReferenceLines(refs) {
  if (!refs.length) return '（本站标签库暂未匹配到相关 Tag）';
  return refs.map(r => {
    const zh = [r.zhPrimary].concat(r.zhAliases || []).filter(Boolean);
    const aliases = r.enAliases && r.enAliases.length ? '；英文别名：' + r.enAliases.join('、') : '';
    const hits = r.matchedTerms && r.matchedTerms.length ? '；命中：' + r.matchedTerms.join('、') : '';
    return '- ' + r.en + ' → ' + (zh.length ? zh.join(' / ') : '（暂无中文译名）') + (r.category ? '；分类：' + r.category : '') + aliases + hits;
  }).join('\n');
}

function translationUnmatchedParts(text, refs) {
  const matched = new Set();
  refs.forEach(r => (r.matchedTerms || []).forEach(x => matched.add(String(x).toLowerCase())));
  return translationInputParts(text).filter(x => !matched.has(x.toLowerCase())).slice(0, 30);
}

function buildTranslationPrompt(text, direction) {
  const refs = buildTranslationReference(text, 60, direction);
  const reference = translationReferenceLines(refs);
  const unknown = direction === 'en-zh' ? translationTagParts(text).filter(x => !refs.some(r => (r.matchedTerms || []).some(m => normalizeTranslationTag(m) === normalizeTranslationTag(x)))).slice(0, 30) : translationUnmatchedParts(text, refs);
  const base = [
    '用户输入：', String(text || ''), '',
    '本站标签库匹配参考（这是词义参考，不是必须全部采用的答案）：', reference,
    '', '未精确匹配的输入片段：', unknown.length ? unknown.join('、') : '（无）'
  ].join('\n');
  if (direction === 'zh-en') {
    return {
      direction, references: refs,
      system: [
        '你是 AI 绘画 Tag 标准化转换器。',
        '你的任务是把用户的中文画面描述转换为标准英文绘图 Tag，而不是翻译成普通英文句子。',
        '本站标签库参考提供了英文 Tag、中文主译名、中文别名和匹配词。请结合完整上下文判断。',
        '同义中文表达只输出一个标准 Tag；候选不准确时可以舍弃；用户明确表达且参考未覆盖时可以补充合理的标准 Tag。',
        '不要凭空添加用户没有表达的内容，不要输出解释、标题、Markdown 或中文。最终只输出逗号分隔的英文 Tag。'
      ].join('\n'),
      user: base + '\n\n请输出最终英文绘图 Tag：'
    };
  }
  return {
    direction, references: refs,
    system: [
      '你是 AI 绘画 Tag 中文翻译器。',
      '你的任务是把用户输入的英文绘图 Tag 翻译成自然、准确的中文，不是重新生成 Tag。',
      '本站标签库参考提供了每个 Tag 的中文主译名和多个中文别名。请优先参考这些词义，并结合上下文选择最自然的一种表达。',
      '不要把同一个 Tag 的多个别名全部重复输出；不要添加用户输入中不存在的画面内容；不要生成新的英文 Tag。',
      '未知 Tag 请保留原文或明确标记，不能随意猜测。只输出中文翻译结果，不要解释、标题或 Markdown。'
    ].join('\n'),
    user: base + '\n\n请输出自然、准确的中文翻译：'
  };
}

function renderTranslationTags(text) {
  if (!translateTags || !translateTagCount) return [];
  const direction = translationDirectionFor(text);
  const refs = buildTranslationReference(text, 80, direction);
  const matched = refs.map(r => ({ en: r.en, zh: r.zhPrimary, al: r.zhAliases, ref: r }));
  const list = matched.slice(0, 80);
  translateTags.replaceChildren();
  translateTagCount.textContent = list.length + ' 个';
  if (!list.length) {
    const empty = document.createElement('span');
    empty.className = 'translate-empty';
    empty.textContent = text ? '暂未匹配到站内 Tag' : '输入内容后会在这里显示相关 Tag';
    translateTags.appendChild(empty);
    return list;
  }
  const frag = document.createDocumentFragment();
  list.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'translate-tag';
    b.title = '点击复制英文 Tag';
    const en = document.createElement('span');
    en.className = 'translate-tag-en';
    en.textContent = t.en || '';
    const zh = document.createElement('span');
    zh.className = 'translate-tag-zh';
    zh.textContent = [t.zh].concat(t.al || []).filter(Boolean).join(' / ');
    if (t.ref && t.ref.matchedTerms && t.ref.matchedTerms.length) b.dataset.matchedTerms = t.ref.matchedTerms.join('、');
    b.append(en, zh);
    b.onclick = () => copyText(t.en || '', '已复制：' + (t.en || ''));
    frag.appendChild(b);
  });
  translateTags.appendChild(frag);
  return list;
}

function setTranslationStatus(text, kind) {
  if (!translateStatus) return;
  translateStatus.textContent = text;
  translateStatus.classList.toggle('ok', kind === 'ok');
  translateStatus.classList.toggle('error', kind === 'error');
}

function clearTranslation() {
  translateRequestNo++;
  if (translateTimer) { clearTimeout(translateTimer); translateTimer = null; }
  if (translateInput) translateInput.value = '';
  if (translateOutput) translateOutput.value = '';
  if (translateInputCount) translateInputCount.textContent = '0 字';
  renderTranslationTags('');
  setTranslationStatus(trText('ui.translation.statusIdle', '输入内容后自动匹配 Tag 并翻译'));
  if (translateAiBtn) translateAiBtn.disabled = true;
}

async function runLocalTranslation(text, requestNo) {
  if (!window.aiTag || !window.aiTag.translation || typeof window.aiTag.translation.run !== 'function') {
    setTranslationStatus('当前版本未安装本地翻译引擎', 'error');
    return;
  }
  const direction = translationDirectionFor(text);
  setTranslationStatus(trText('ui.translation.statusLoading', '正在加载本地模型并翻译（首次使用较慢）…'));
  try {
    const r = await window.aiTag.translation.run(text, direction);
    if (requestNo !== translateRequestNo) return;
    if (!r || !r.ok) {
      setTranslationStatus(typeof formatAppError === 'function' ? formatAppError((r && r.error) || '本地翻译失败', '本地翻译') : ((r && r.error) || '本地翻译失败'), 'error');
      return;
    }
    translateOutput.value = r.text || '';
    setTranslationStatus('本地翻译 · ' + translationDirectionLabel(r.direction || direction, 'local'), 'ok');
  } catch (e) {
    if (requestNo !== translateRequestNo) return;
    setTranslationStatus(typeof formatAppError === 'function' ? formatAppError(e, '本地翻译') : ('本地翻译失败：' + ((e && e.message) || e)), 'error');
  }
}

function scheduleLocalTranslation() {
  const text = String(translateInput && translateInput.value || '').trim();
  translateRequestNo++;
  const requestNo = translateRequestNo;
  if (translateInputCount) translateInputCount.textContent = String((translateInput && translateInput.value || '').length) + ' 字';
  renderTranslationTags(text);
  if (translateAiBtn) translateAiBtn.disabled = !text;
  if (translateTimer) clearTimeout(translateTimer);
  if (!text) {
    if (translateOutput) translateOutput.value = '';
    setTranslationStatus(trText('ui.translation.statusIdle', '输入内容后自动匹配 Tag 并翻译'));
    return;
  }
  setTranslationStatus(trText('ui.translation.statusWaiting', '已匹配 Tag，等待本地翻译…'));
  translateTimer = setTimeout(() => runLocalTranslation(text, requestNo), 450);
}

async function runAiTranslation() {
  const text = String(translateInput && translateInput.value || '').trim();
  if (!text) return toast('请先输入要翻译的内容');
  if (translateAiBtn) translateAiBtn.disabled = true;
  const direction = translationDirectionFor(text);
  const refs = buildTranslationReference(text, 60, direction);
  const aiStartedAt = Date.now();
  const updateAiElapsed = () => setTranslationStatus(trText('ui.translation.aiStatus', '正在调用 AI 翻译（已提供 ' + refs.length + ' 个本站 Tag 对照）…', { count: refs.length }) + ' · 已用时 ' + aiElapsedLabel(Date.now() - aiStartedAt));
  updateAiElapsed();
  if (translateAiElapsedTimer) clearInterval(translateAiElapsedTimer);
  translateAiElapsedTimer = setInterval(updateAiElapsed, 1000);
  try {
    const prompt = buildTranslationPrompt(text, direction);
    const result = await chatComplete([
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ], { stream: false });
    translateOutput.value = String(result || '').trim();
    const aiDir = direction === 'zh-en' ? trText('ui.translation.aiDirectionZhToTag', '中文 → Tag') : trText('ui.translation.aiDirectionTagToZh', 'Tag → 中文');
    setTranslationStatus(trText('ui.translation.aiDone', 'AI 翻译 · ' + aiDir + ' · 参考 ' + refs.length + ' 个 Tag', { direction: aiDir, count: refs.length }), 'ok');
  } catch (e) {
    setTranslationStatus(typeof formatAppError === 'function' ? formatAppError(e, 'AI 翻译') : ('AI 翻译失败：' + ((e && e.message) || e)), 'error');
  } finally {
    if (translateAiElapsedTimer) { clearInterval(translateAiElapsedTimer); translateAiElapsedTimer = null; }
    if (translateAiBtn) translateAiBtn.disabled = !String(translateInput && translateInput.value || '').trim();
  }
}

async function openTranslation() {
  if (typeof setAppMode === 'function' && document.body.classList.contains('aiview')) setAppMode('tag');
  translationOpen = true;
  document.body.classList.add('translation-mode');
  if (tagLibraryView) tagLibraryView.hidden = true;
  if (translationView) translationView.hidden = false;
  if (typeof sidebarEl !== 'undefined' && sidebarEl) sidebarEl.style.display = 'none';
  if (typeof addTagBtn !== 'undefined' && addTagBtn) addTagBtn.style.display = 'none';
  const bar = document.querySelector('.bar');
  if (bar) bar.style.display = 'none';
  // 搜索框在翻译页不参与交互，但必须保留其布局占位。
  // 直接 display:none 会让 header 的 flex 空间重新分配，导致翻译按钮
  // 以及右侧的样式 / AI / 收藏等按钮整体跳动。
  if (searchWrap) {
    searchWrap.style.visibility = 'hidden';
    searchWrap.style.pointerEvents = 'none';
    searchWrap.setAttribute('aria-hidden', 'true');
  }
  if (headerWorkspace) {
    headerWorkspace.style.visibility = 'visible';
    headerWorkspace.style.display = '';
  }
  if (translateInput) translateInput.focus();
  if (window.aiTag && window.aiTag.translation && typeof window.aiTag.translation.available === 'function') {
    try {
      const r = await window.aiTag.translation.available();
      if (r && r.available) setTranslationStatus(trText('ui.translation.statusLocalReady', '本地模型就绪 · 输入内容后自动翻译'), 'ok');
      else setTranslationStatus(typeof formatAppError === 'function' ? formatAppError('未找到本地翻译模型，请检查 models/translation', '本地翻译') : trText('ui.translation.localUnavailable', '未找到本地翻译模型，请检查 models/translation'), 'error');
    } catch (e) {
      setTranslationStatus(typeof formatAppError === 'function' ? formatAppError(e, '本地翻译模型检查') : '本地模型状态读取失败', 'error');
    }
  }
}

function closeTranslation() {
  translationOpen = false;
  document.body.classList.remove('translation-mode');
  if (tagLibraryView) tagLibraryView.hidden = false;
  if (translationView) translationView.hidden = true;
  if (typeof sidebarEl !== 'undefined' && sidebarEl) sidebarEl.style.display = '';
  if (typeof addTagBtn !== 'undefined' && addTagBtn) addTagBtn.style.display = '';
  const bar = document.querySelector('.bar');
  if (bar) bar.style.display = '';
  if (searchWrap) {
    searchWrap.style.visibility = '';
    searchWrap.style.pointerEvents = '';
    searchWrap.removeAttribute('aria-hidden');
    searchWrap.style.display = '';
  }
  if (headerWorkspace) {
    headerWorkspace.style.visibility = '';
    headerWorkspace.style.display = '';
  }
}

if ($('#translateBtn')) $('#translateBtn').onclick = () => translationOpen ? closeTranslation() : openTranslation();
if ($('#translateBack')) $('#translateBack').onclick = closeTranslation;
if ($('#translateClear')) $('#translateClear').onclick = clearTranslation;
if (translateInput) translateInput.addEventListener('input', scheduleLocalTranslation);
if (translateDirection) translateDirection.addEventListener('change', () => {
  const text = String(translateInput && translateInput.value || '').trim();
  if (text) scheduleLocalTranslation();
});
if (translateAiBtn) translateAiBtn.onclick = runAiTranslation;
if (translateCopyBtn) translateCopyBtn.onclick = () => {
  const text = String(translateOutput && translateOutput.value || '').trim();
  if (text) copyText(text, '已复制翻译结果'); else toast('暂无翻译结果');
};
if (translateCopyTagsBtn) translateCopyTagsBtn.onclick = () => {
  const values = Array.from(translateTags ? translateTags.querySelectorAll('.translate-tag-en') : []).map(x => x.textContent).filter(Boolean);
  if (values.length) copyText(values.join(', '), '已复制 ' + values.length + ' 个 Tag'); else toast('暂无匹配 Tag');
};

window.__translationOpen = openTranslation;
window.__translationClose = closeTranslation;
window.__translationRun = runLocalTranslation;
window.__translationTags = () => Array.from(translateTags ? translateTags.querySelectorAll('.translate-tag-en') : []).map(x => x.textContent);
window.__translationReference = buildTranslationReference;
window.__translationPrompt = buildTranslationPrompt;
window.__translationAi = runAiTranslation;
