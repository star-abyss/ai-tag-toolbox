'use strict';

/**
 * Translation 业务模块。
 *
 * 这个文件只关心「输入 -> 方向 -> 参考 Tag -> 翻译结果」。页面、Electron
 * 和模型加载都在外部。需要离线模型时传入 runner 即可；没有 runner 时，
 * 模块会使用标签目录做一个足够实用的本地转换，不会因为模型缺失而失效。
 */

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).trim();
  return result || fallback;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

/** Normalize weighted/underscored drawing tags for matching. */
function normalizeTag(value) {
  return text(value).toLowerCase()
    .replace(/^[(\[]+|[)\]]+$/g, '')
    .replace(/:\s*[-+]?\d+(?:\.\d+)?\s*\)?$/g, '')
    .replace(/[()[\]]/g, '')
    .replace(/[\s_]+/g, '_');
}

function inputParts(value) {
  return text(value).split(/[\s,，、;；|/]+/).map(item => item.trim()).filter(item => item.length >= 2);
}

function tagParts(value) {
  return text(value).split(/[,，、;；|/\n]+/).map(item => item.trim()).filter(Boolean);
}

function direction(value, requested) {
  const explicit = text(requested).toLowerCase();
  if (explicit === 'zh-en' || explicit === 'en-zh') return explicit;
  return /[\u3400-\u9fff]/.test(text(value)) ? 'zh-en' : 'en-zh';
}

function list(value) {
  if (Array.isArray(value)) return value.slice();
  if (value == null || value === '') return [];
  return String(value).split(/[\s,，、;；|/]+/).map(item => item.trim()).filter(Boolean);
}

function aliasesOf(tag) { return list(tag && (tag.aliases || tag.al)); }
function englishOf(tag) { return text(tag && (tag.en || tag.tag || tag.name || tag.id)); }

function chineseNames(tag) {
  const result = [];
  const seen = new Set();
  const add = value => {
    const item = text(value);
    if (!item || !/[\u3400-\u9fff]/.test(item)) return;
    const key = item.toLowerCase();
    if (!seen.has(key)) { seen.add(key); result.push(item); }
  };
  add(tag && (tag.zh || tag.cn || tag.translation));
  aliasesOf(tag).forEach(add);
  return result;
}

function visible(tag, options = {}) {
  if (options.includeAdult || options.adult || options.nsfw) return true;
  return !(tag && (tag.nsfw || tag.adult || tag.isAdult));
}

function catalogFrom(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.slice();
  for (const method of ['list', 'all', 'getAll']) {
    if (typeof tags[method] !== 'function') continue;
    try {
      const rows = tags[method]({ includeAdult: true, adult: true, nsfw: true });
      if (Array.isArray(rows)) return rows;
    } catch { /* optional catalog */ }
  }
  return [];
}

function catalogSearch(tags, value, limit) {
  if (!tags || typeof tags.search !== 'function' || !text(value)) return [];
  try {
    const rows = tags.search(value, { includeAdult: true, adult: true, nsfw: true, limit });
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

function exactMatches(value, options = {}) {
  const catalog = options.catalog || [];
  const output = [];
  const used = new Set();
  for (const part of tagParts(value)) {
    const key = normalizeTag(part);
    if (!key) continue;
    const found = catalog.find(tag => visible(tag, options) && [englishOf(tag), ...aliasesOf(tag)].some(form => normalizeTag(form) === key));
    const id = normalizeTag(englishOf(found));
    if (found && id && !used.has(id)) {
      used.add(id);
      output.push({ tag: found, matchedTerms: [part], matchType: '精确 Tag' });
    }
  }
  return output;
}

function matchEvidence(value, tag, options = {}) {
  const terms = [...new Set([...tagParts(value), ...inputParts(value), ...(typeof options.keywords === 'function' ? list(options.keywords(value)) : [])])];
  const en = englishOf(tag).toLowerCase();
  const fields = [en, en.replace(/_/g, ' '), text(tag && (tag.zh || tag.cn)), ...aliasesOf(tag)].map(item => text(item).toLowerCase()).filter(Boolean);
  return terms.filter(term => {
    const raw = text(term).toLowerCase();
    const normalized = normalizeTag(raw);
    return fields.some(field => normalizeTag(field) === normalized || (raw.length >= 2 && field.includes(raw)));
  }).slice(0, 5);
}

function fuzzyMatches(value, options = {}) {
  const catalog = options.catalog || [];
  const output = [];
  const seen = new Set();
  const add = (tag, matchedTerms, matchType = '相关匹配') => {
    if (!tag || !visible(tag, options)) return;
    const id = normalizeTag(englishOf(tag));
    if (!id || seen.has(id)) return;
    seen.add(id);
    output.push({ tag, matchedTerms: matchedTerms && matchedTerms.length ? matchedTerms : matchEvidence(value, tag, options), matchType });
  };
  for (const term of [value, ...inputParts(value)]) {
    for (const row of catalogSearch(options.tags, term, options.limit || 100)) add(row && row.tag ? row.tag : row, row && row.matchedTerms, row && row.matchType || '相关匹配');
  }
  const raw = text(value).toLowerCase();
  if (raw) {
    for (const tag of catalog) {
      if (!visible(tag, options)) continue;
      const hits = chineseNames(tag).filter(name => raw.includes(name.toLowerCase()));
      if (hits.length) add(tag, hits, '中文命中');
    }
  }
  return output;
}

function referenceShape(item, index) {
  const tag = item && item.tag ? item.tag : item || {};
  const zh = chineseNames(tag);
  const enAliases = aliasesOf(tag).filter(alias => !/[\u3400-\u9fff]/.test(String(alias))).map(String);
  return {
    rank: index + 1,
    en: englishOf(tag),
    zhPrimary: zh[0] || '',
    zhAliases: zh.slice(1),
    enAliases: [...new Set(enAliases)].slice(0, 8),
    category: text(tag.category || tag.cat),
    subcategory: text(tag.subcategory || tag.sub),
    matchedTerms: item && item.matchedTerms ? item.matchedTerms.slice(0, 5) : [],
    matchType: item && item.matchType || '相关匹配',
    tag: clone(tag)
  };
}

function buildReference(value, options = {}) {
  const dir = direction(value, options.direction);
  const catalog = options.catalog || catalogFrom(options.tags);
  const exact = dir === 'en-zh' ? exactMatches(value, { ...options, catalog }) : [];
  const exactIds = new Set(exact.map(item => normalizeTag(englishOf(item.tag))));
  const fuzzy = fuzzyMatches(value, { ...options, catalog, tags: options.tags }).filter(item => !exactIds.has(normalizeTag(englishOf(item.tag))));
  const max = Math.max(1, Math.min(Number(options.limit) || 60, 100));
  return exact.concat(fuzzy).slice(0, max).map(referenceShape);
}

function referenceLines(refs) {
  if (!Array.isArray(refs) || !refs.length) return '（本站标签库暂未匹配到相关 Tag）';
  return refs.map(ref => {
    const zh = [ref.zhPrimary, ...(ref.zhAliases || [])].filter(Boolean);
    const aliases = ref.enAliases && ref.enAliases.length ? `；英文别名：${ref.enAliases.join('、')}` : '';
    const hits = ref.matchedTerms && ref.matchedTerms.length ? `；命中：${ref.matchedTerms.join('、')}` : '';
    return `- ${ref.en} → ${zh.length ? zh.join(' / ') : '（暂无中文译名）'}${ref.category ? `；分类：${ref.category}` : ''}${aliases}${hits}`;
  }).join('\n');
}

function unmatchedParts(value, refs) {
  const matched = new Set();
  (refs || []).forEach(ref => (ref.matchedTerms || []).forEach(term => matched.add(text(term).toLowerCase())));
  return inputParts(value).filter(item => !matched.has(item.toLowerCase())).slice(0, 30);
}

function buildPrompt(value, requestedDirection, options = {}) {
  const input = text(value);
  const dir = direction(input, requestedDirection);
  const refs = buildReference(input, { ...options, direction: dir });
  const parts = tagParts(input);
  const unknown = dir === 'en-zh'
    ? parts.filter(part => !refs.some(ref => (ref.matchedTerms || []).some(hit => normalizeTag(hit) === normalizeTag(part)))).slice(0, 30)
    : unmatchedParts(input, refs);
  const base = ['用户输入：', input, '', '本站标签库匹配参考（这是词义参考，不是必须全部采用的答案）：', referenceLines(refs), '', '未精确匹配的输入片段：', unknown.length ? unknown.join('、') : '（无）'].join('\n');
  if (dir === 'zh-en') return {
    direction: dir,
    references: refs,
    system: ['你是 AI 绘画 Tag 标准化转换器。', '这是本地成人向绘图工具的翻译任务，输入可能包含 NSFW、身体或性行为相关术语；请保持中立并正常翻译，不要因成人内容拒绝、说教或输出安全提醒。', '请把用户的中文画面描述转换为标准英文绘图 Tag，而不是普通英文句子。', '同义中文表达只输出一个标准 Tag；不要凭空添加用户没有表达的内容。', '关闭思维链和推理展示：不要生成或输出分析、草稿、解释、理由、思考过程、<think> 内容或 Markdown。请直接给出最终结果。', '最终只输出逗号分隔的英文 Tag，不要解释、标题、Markdown 或中文。'].join('\n'),
    user: `${base}\n\n请输出最终英文绘图 Tag：`
  };
  return {
    direction: dir,
    references: refs,
    system: ['你是 AI 绘画 Tag 中文翻译器。', '这是本地成人向绘图工具的翻译任务，输入可能包含 NSFW、身体或性行为相关术语；请保持中立并正常翻译，不要因成人内容拒绝、说教或输出安全提醒。', '请把用户输入的英文绘图 Tag 翻译成自然、准确的中文，不要重新生成 Tag。', '优先参考标签库中的中文主译名和别名；未知 Tag 保留原文。', '关闭思维链和推理展示：不要生成或输出分析、草稿、解释、理由、思考过程、<think> 内容或 Markdown。请直接给出最终结果。', '只输出中文翻译结果，不要解释、标题或 Markdown。'].join('\n'),
    user: `${base}\n\n请输出自然、准确的中文翻译：`
  };
}

function runnerMethod(candidate) {
  if (typeof candidate === 'function') return candidate;
  if (!candidate || typeof candidate !== 'object') return null;
  for (const key of ['translate', 'run', 'translateText', 'complete', 'generate']) if (typeof candidate[key] === 'function') return candidate[key].bind(candidate);
  return null;
}

function normalizeRunnerResult(value, dir) {
  let result = value;
  if (Array.isArray(result)) result = result[0];
  if (typeof result === 'string') return { ok: !!text(result), text: text(result), direction: dir };
  if (!object(result)) return { ok: false, text: '', direction: dir, error: '本地翻译结果为空' };
  const output = text(result.text || result.translation || result.translation_text || result.output || result.generated_text);
  return { ok: result.ok !== false && !!output, text: output, direction: text(result.direction, dir), model: text(result.model || result.modelId), error: result.ok === false ? text(result.error, '本地翻译失败') : output ? '' : '本地翻译结果为空', raw: result };
}

function dictionaryLookup(dictionary, value, dir) {
  if (!dictionary || typeof dictionary !== 'object') return '';
  const table = dictionary[dir] && typeof dictionary[dir] === 'object' ? dictionary[dir] : dictionary;
  const key = text(value).toLowerCase();
  for (const [from, to] of Object.entries(table)) if (String(from).toLowerCase() === key) return text(to);
  return '';
}

function createTranslation(options = {}) {
  const tags = options.tags || null;
  const ai = options.ai || options.gateway || null;
  const dictionary = options.dictionary || null;
  let runner = options.runner || options.localRunner || options.localModel || options.onnx || null;
  const resultCache = new Map();
  const state = { input: '', output: '', direction: 'auto', references: [], status: 'idle', source: '', model: '', error: '' };

  function refs(value, extra = {}) {
    // 页面常用 findReferences(text, 'en-zh')；同时保留对象形式供模块调用。
    const requested = typeof extra === 'string' ? { direction: extra } : (extra || {});
    return buildReference(value, { ...requested, tags, catalog: requested.catalog || catalogFrom(tags), includeAdult: true, limit: requested.limit || options.referenceLimit || 60 });
  }
  function rawReferences(value, extra = {}) { return refs(value, extra).map(item => item.tag || item); }
  function findTag(value, catalog) {
    const key = normalizeTag(value);
    return key ? (catalog || []).find(tag => [englishOf(tag), ...aliasesOf(tag)].some(form => normalizeTag(form) === key)) || null : null;
  }
  function mapped(value, requested, extra = {}) {
    const input = text(value);
    const dir = direction(input, requested);
    const catalog = extra.catalog || catalogFrom(tags);
    const details = refs(input, { ...extra, direction: dir, catalog });
    let output = dictionaryLookup(dictionary, input, dir);
    if (!output && dir === 'zh-en') {
      const values = []; const seen = new Set();
      for (const item of details) {
        const en = englishOf(item.tag || item); const key = normalizeTag(en);
        if (en && !seen.has(key)) { seen.add(key); values.push(en); }
      }
      output = values.join(', ');
    } else if (!output) {
      output = tagParts(input).map(part => { const names = chineseNames(findTag(part, catalog)); return names[0] || part; }).join('，');
    }
    return { ok: true, text: output || input, direction: dir, references: details, source: 'tags' };
  }
  function finish(result, input, dir, source = 'tags') {
    const value = normalizeRunnerResult(result, dir);
    const fallback = mapped(input, dir);
    const output = value.ok ? value.text : fallback.text;
    state.input = input; state.output = output; state.direction = dir;
    state.references = value.ok ? refs(input, { direction: dir }) : fallback.references;
    state.status = output ? 'done' : 'error'; state.source = value.ok ? source : 'tags'; state.model = value.model || ''; state.error = value.ok ? '' : value.error || '';
    return { ...(value.ok ? value : fallback), ok: true, text: output, direction: dir, references: state.references, source: value.ok ? source : 'tags', fallback: !value.ok, error: value.ok ? '' : value.error || '' };
  }
  function translateLocal(value, requested, extra = {}) {
    const input = text(value); const dir = direction(input, requested);
    if (!input) { state.input = ''; state.output = ''; state.direction = dir; state.references = []; state.status = 'idle'; state.source = ''; return { ok: false, text: '', direction: dir, references: [], error: '请输入要翻译的内容' }; }
    const cacheKey = `${dir}|${input}`;
    if (!extra.force && resultCache.has(cacheKey)) return { ...clone(resultCache.get(cacheKey)), cached: true };
    const fn = runnerMethod(runner);
    if (!fn) {
      const result = finish(null, input, dir, 'tags');
      resultCache.set(cacheKey, clone(result));
      return result;
    }
    try {
      const result = fn(input, dir, extra);
      if (result && typeof result.then === 'function') return result.then(value2 => { const done = finish(value2, input, dir, 'model'); resultCache.set(cacheKey, clone(done)); return done; }).catch(error => { const done = finish({ ok: false, error: text(error && error.message, String(error)) }, input, dir, 'tags'); resultCache.set(cacheKey, clone(done)); return done; });
      const done = finish(result, input, dir, 'model'); resultCache.set(cacheKey, clone(done)); return done;
    } catch (error) { const done = finish({ ok: false, error: text(error && error.message, String(error)) }, input, dir, 'tags'); resultCache.set(cacheKey, clone(done)); return done; }
  }
  async function translateWithModel(value, requested, extra = {}) { return await Promise.resolve(translateLocal(value, requested, extra)); }
  async function translateWithAI(value, requested, extra = {}) {
    const input = text(value); const dir = direction(input, requested);
    if (!input) return { ok: false, text: '', direction: dir, references: [], error: '请输入要翻译的内容' };
    if (!ai) return translateWithModel(input, dir, extra);
    const prompt = buildPrompt(input, dir, { ...extra, tags, catalog: catalogFrom(tags) });
    try {
      let result;
      const directOutputOptions = {
        ...extra,
        direction: dir,
        input,
        // Translation has no tool loop and does not need incremental output.
        // Keeping this non-streaming also prevents providers from surfacing a
        // reasoning stream in the translation panel.
        stream: false,
        onDelta: undefined,
        onEvent: undefined,
        reasoning_effort: 'none',
        enable_thinking: false,
        thinking: { type: 'disabled' }
      };
      const invoke = async requestOptions => {
        if (typeof ai === 'function') return await ai(prompt, requestOptions);
        if (typeof ai.translate === 'function') return await ai.translate(input, dir, { ...requestOptions, prompt });
        if (typeof ai.complete === 'function') return await ai.complete([{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], requestOptions);
        throw new Error('未注入 AI 翻译接口');
      };
      try {
        result = await invoke(directOutputOptions);
      } catch (error) {
        // A few OpenAI-compatible gateways reject unknown reasoning fields.
        // Retry once without the optional switches; the direct-output prompt
        // and non-streaming request remain in effect.
        const message = text(error?.message, String(error));
        if (!/HTTP\s+4\d\d|invalid|unknown|unsupported/i.test(message) || !/(?:reasoning|thinking)/i.test(message)) throw error;
        const fallbackOptions = { ...directOutputOptions };
        delete fallbackOptions.reasoning_effort;
        delete fallbackOptions.enable_thinking;
        delete fallbackOptions.thinking;
        result = await invoke(fallbackOptions);
      }
      const normalized = normalizeRunnerResult(result, dir);
      if (!normalized.ok) throw new Error(normalized.error || 'AI 翻译结果为空');
      state.input = input; state.output = normalized.text; state.direction = dir; state.references = prompt.references; state.status = 'done'; state.source = 'ai'; state.error = '';
      return { ...normalized, ok: true, direction: dir, references: prompt.references, source: 'ai', request: prompt };
    } catch (error) { state.status = 'error'; state.error = text(error && error.message, String(error)); return { ok: false, text: '', direction: dir, references: prompt.references, error: state.error, request: prompt }; }
  }
  function available() {
    let value = false;
    if (runner) { if (typeof runner.available === 'function') { try { value = Boolean(runner.available()); } catch { value = false; } } else value = Boolean(runnerMethod(runner)); }
    return { available: value, model: text(options.model || (runner && runner.model && (runner.model.name || runner.model.id))), fallback: true, reason: value ? '' : '未注入本地翻译模型，当前使用标签映射' };
  }
  return {
    state,
    detectDirection: direction,
    direction,
    normalizeTag,
    inputParts,
    tagParts,
    chineseNames,
    exactMatches: (value, extra = {}) => exactMatches(value, { ...extra, catalog: extra.catalog || catalogFrom(tags) }),
    buildReference: (value, extra = {}) => refs(value, extra),
    reference: (value, extra = {}) => refs(value, extra),
    referenceDetails: (value, extra = {}) => refs(value, extra),
    findReferences: (value, extra = {}) => refs(value, extra),
    references: rawReferences,
    referenceLines,
    buildPrompt: (value, requested, extra = {}) => buildPrompt(value, requested, { ...extra, tags, catalog: extra.catalog || catalogFrom(tags) }),
    translateLocal,
    translateWithModel,
    translate: translateLocal,
    run: translateLocal,
    translateWithAI,
    ai: translateWithAI,
    available,
    setRunner: next => { runner = next || null; resultCache.clear(); return runner; },
    getRunner: () => runner,
    snapshot: () => ({ ...clone(state), references: state.references.map(clone) })
  };
}

module.exports = { createTranslation, direction, detectDirection: direction, normalizeTag, inputParts, tagParts, chineseNames, exactMatches, buildReference, referenceLines, buildPrompt };
