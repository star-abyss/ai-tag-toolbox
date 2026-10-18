'use strict';

(function install(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TranslationWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createWorkspace() {
  function rangeOf(value) {
    return Array.isArray(value) && value.length === 2 && Number.isInteger(value[0]) && Number.isInteger(value[1])
      ? { start: value[0], end: value[1] } : null;
  }
  function adaptReceipt(receipt) {
    const value = receipt && typeof receipt === 'object' ? receipt : {};
    const sourceText = typeof value.原文 === 'string' ? value.原文 : '';
    const targetText = typeof value.译文 === 'string' ? value.译文 : '';
    const rows = (Array.isArray(value.表) ? value.表 : []).map(row => {
      const source = rangeOf(row?.原文范围), target = rangeOf(row?.译文范围);
      if (!source || !target || source.start < 0 || source.end <= source.start || source.end > sourceText.length || target.start < 0 || target.end <= target.start || target.end > targetText.length) return null;
      const id = String(row.标识 || '');
      if (!id) return null;
      return { id, source, target, sourceValue: sourceText.slice(source.start, source.end), targetValue: targetText.slice(target.start, target.end) };
    }).filter(Boolean).sort((a, b) => a.source.start - b.source.start || a.target.start - b.target.start);
    const sourceUnits = rows.map(row => ({ id: row.id, text: row.sourceValue, start: row.source.start, end: row.source.end }));
    const targetSegments = [];
    let cursor = 0;
    for (const row of rows) {
      if (row.target.start < cursor) continue;
      if (row.target.start > cursor) targetSegments.push({ text: targetText.slice(cursor, row.target.start), sourceIds: [] });
      targetSegments.push({ text: row.targetValue, sourceIds: [row.id] });
      cursor = row.target.end;
    }
    if (cursor < targetText.length) targetSegments.push({ text: targetText.slice(cursor), sourceIds: [] });
    return {
      ok: value.ok !== false, original: sourceText, text: targetText, direction: value.方向 || '', model: value.模型 || '',
      stats: value.统计 || {}, error: value.reason || '',
      alignment: sourceUnits.length ? { sourceUnits, targetSegments } : null,
    };
  }

  function createLatestScheduler(execute, { delay = 500, onResult = () => {}, onError = () => {}, onState = () => {} } = {}) {
    let revision = 0, timer = null, pending = null, flight = null, disposed = false;
    function state() { onState({ busy: Boolean(flight), waiting: Boolean(timer || pending), source: flight?.snapshot.source || pending?.snapshot.source || '' }); }
    async function drain() {
      if (disposed || flight || !pending) return;
      const current = pending; pending = null;
      const run = { revision: current.revision, snapshot: current.snapshot };
      flight = run; state();
      try {
        const result = await execute(run.snapshot);
        if (!disposed && run.revision === revision) onResult(result, run.snapshot);
      } catch (error) {
        if (!disposed && run.revision === revision) onError(error, run.snapshot);
      } finally {
        if (flight === run) flight = null;
        state();
        if (pending) void drain();
      }
    }
    function queue(snapshot) { pending = { revision, snapshot }; void drain(); }
    return {
      schedule(snapshot) {
        revision += 1; pending = null; if (timer !== null) clearTimeout(timer);
        const thisRevision = revision;
        timer = setTimeout(() => { timer = null; if (thisRevision === revision) queue(snapshot); }, delay);
        state();
      },
      replace(snapshot) {
        revision += 1; if (timer !== null) clearTimeout(timer); timer = null; queue(snapshot); state();
      },
      invalidate() { revision += 1; pending = null; if (timer !== null) clearTimeout(timer); timer = null; state(); },
      dispose() { disposed = true; revision += 1; pending = null; if (timer !== null) clearTimeout(timer); timer = null; state(); },
      status() { return { busy: Boolean(flight), waiting: Boolean(timer || pending), source: flight?.snapshot.source || pending?.snapshot.source || '' }; },
    };
  }
  return { adaptReceipt, createLatestScheduler };
});
