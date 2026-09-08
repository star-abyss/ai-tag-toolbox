'use strict';

(function install(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TranslationAlignment = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createAlignment() {
  const MAX_UNITS = 256;
  const MAX_SEGMENTS = 512;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' ? value : '';
  function trimmedSpan(input, start, end) {
    const raw = input.slice(start, end);
    const value = raw.trim();
    if (!value) return null;
    start += raw.length - raw.trimStart().length;
    return { text: value, start, end: start + value.length };
  }
  function tagSpans(input) {
    const result = [], stack = [];
    let start = 0, escaped = false, separated = false;
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if ('([<'.includes(char)) stack.push(char);
      else if (')]>'.includes(char) && stack.length) stack.pop();
      if (!stack.length && /[,，、;；|\r\n]/u.test(char)) {
        const span = trimmedSpan(input, start, i);
        if (span) result.push(span);
        start = i + 1; separated = true;
      }
    }
    const last = trimmedSpan(input, start, input.length);
    if (last) result.push(last);
    const short = result.every(row => row.text.length <= 100 && row.text.split(/\s+/).length <= 6 && !/[。！？]|[.!?](?:\s|$)/u.test(row.text));
    return (separated && short) || (result.length === 1 && /_|^\(|^\[|^<lora:/i.test(result[0].text)) ? result : null;
  }
  function languageSpans(input, granularity) {
    if (typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter(/[\u3400-\u9fff]/u.test(input) ? 'zh' : 'en', { granularity });
      return [...segmenter.segment(input)].filter(row => granularity === 'sentence' || row.isWordLike)
        .map(row => trimmedSpan(input, row.index, row.index + row.segment.length)).filter(Boolean);
    }
    const pattern = granularity === 'sentence' ? /[^.!?。！？\r\n]+[.!?。！？]*/gu : /[\p{L}\p{N}]+(?:[_'-][\p{L}\p{N}]+)*/gu;
    return [...input.matchAll(pattern)].map(row => trimmedSpan(input, row.index, row.index + row[0].length)).filter(Boolean);
  }
  function segmentSourceText(value) {
    const input = text(value);
    let rows = tagSpans(input);
    let granularity = rows ? 'tag' : 'word';
    if (!rows) rows = languageSpans(input, 'word');
    if (!rows.length && input.trim()) rows = [trimmedSpan(input, 0, input.length)];
    if (rows.length > MAX_UNITS) { rows = languageSpans(input, 'sentence'); granularity = 'sentence'; }
    if (rows.length > MAX_UNITS) {
      const size = Math.ceil(rows.length / MAX_UNITS), grouped = [];
      for (let i = 0; i < rows.length; i += size) grouped.push(trimmedSpan(input, rows[i].start, rows[Math.min(rows.length - 1, i + size - 1)].end));
      rows = grouped; granularity = 'block';
    }
    return { granularity, sourceUnits: rows.map((row, i) => ({ id: `s${i + 1}`, ...row })) };
  }
  const buildSourceUnits = value => segmentSourceText(value).sourceUnits;
  function normalizeAlignment(value, sourceUnits, targetText) {
    if (!object(value) || !Array.isArray(sourceUnits) || !sourceUnits.length || sourceUnits.length > MAX_UNITS) return null;
    const source = sourceUnits.map(row => ({ ...row }));
    const allowed = new Set(source.map(row => row.id));
    if (allowed.size !== source.length || source.some(row => !text(row.id) || !text(row.text))) return null;
    if (!Array.isArray(value.targetSegments) || !value.targetSegments.length || value.targetSegments.length > MAX_SEGMENTS) return null;
    const segments = [];
    for (const item of value.targetSegments) {
      if (!object(item) || typeof item.text !== 'string') return null;
      if (!item.text) continue;
      segments.push({ text: item.text, sourceIds: [...new Set((Array.isArray(item.sourceIds) ? item.sourceIds : []).slice(0, MAX_UNITS).filter(id => typeof id === 'string' && allowed.has(id)))] });
    }
    // Never drop text, change whitespace or guess positions to make a mapping fit.
    if (segments.map(row => row.text).join('') !== targetText || !segments.some(row => row.sourceIds.length)) return null;
    return { sourceUnits: source, targetSegments: segments };
  }
  function parseTranslationPayload(value, sourceUnits = []) {
    let payload = value;
    for (let i = 0; i < 5; i++) {
      if (payload?.ok === true && Object.prototype.hasOwnProperty.call(payload, 'data')) { payload = payload.data; continue; }
      if (payload?.choices?.[0]?.message) { payload = payload.choices[0].message.content; continue; }
      const raw = typeof payload === 'string' ? payload : payload?.text ?? payload?.output_text;
      if (typeof raw !== 'string') break;
      const candidate = raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gi, '').trim();
      if (candidate.startsWith('{')) {
        try {
          const parsed = JSON.parse(candidate);
          if (object(parsed) && [parsed.text, parsed.translation, parsed.translation_text].some(x => typeof x === 'string')) { payload = parsed; continue; }
        } catch { /* unstructured response remains usable as plain text */ }
      }
      if (typeof payload === 'string') payload = { text: raw };
      break;
    }
    const translated = text(payload?.text ?? payload?.translation ?? payload?.translation_text ?? payload?.output_text ?? payload?.output ?? payload?.generated_text ?? payload);
    return { text: translated, direction: text(payload?.direction), alignment: normalizeAlignment(payload?.alignment || payload, sourceUnits, translated) };
  }
  return { MAX_UNITS, MAX_SEGMENTS, segmentSourceText, buildSourceUnits, normalizeAlignment, parseTranslationPayload };
});
