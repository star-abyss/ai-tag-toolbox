'use strict';

(function install(root, factory) {
  const api = factory(root.TranslationAlignment || (typeof require === 'function' ? require('../modules/translation-alignment') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.translation = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFactory(alignmentApi) {
  function createTranslationView({ document: doc, runtime, translation, notify, copy, onTagSelected, localized = (_key, fallback) => fallback } = {}) {
    const win = doc.defaultView;
    const q = selector => doc.querySelector(selector);
    const input = q('#translateInput'), output = q('#translateOutput');
    const mirror = q('#translateSourceMirror'), aligned = q('#translateAlignedOutput');
    const pane = q('#translateView'), hint = q('#translateAlignmentHint');
    let sequence = 0, job = null, timer, refsTimer, bound = false;
    let mapping = null, sourceSnapshot = '', hovered = null, pinned = null;
    let sourceElements = [], targetElements = [], targetRanges = [];
    const label = (key, fallback) => localized(`ui.translation.${key}`, fallback);
    const put = (selector, value) => { const node = q(selector); if (node) node.textContent = value; };
    const tick = fn => win.requestAnimationFrame ? win.requestAnimationFrame(fn) : win.setTimeout(fn, 0);

    function syncControls() {
      const busy = job?.useAi === true;
      const button = q('#translateAi');
      if (button) { button.disabled = busy || !input?.value.trim(); button.setAttribute('aria-busy', String(busy)); }
      put('#translateInputCount', `${input?.value.length || 0} ${label('charactersUnit', '字')}`);
    }
    function highlight() {
      const current = hovered || pinned;
      sourceElements.forEach((node, index) => {
        const active = Boolean(current?.sourceIds.has(mapping.sourceUnits[index].id));
        node.classList.toggle('active', active); node.classList.toggle('pinned', active && !hovered && Boolean(pinned));
      });
      targetElements.forEach((node, index) => {
        const active = Boolean(current?.targetIndexes.has(index));
        node.classList.toggle('active', active); node.classList.toggle('pinned', active && !hovered && Boolean(pinned));
        if (node.hasAttribute('role')) node.setAttribute('aria-pressed', String(active && !hovered && Boolean(pinned)));
      });
    }
    function fromSource(ids) {
      const sourceIds = new Set(ids), targetIndexes = new Set();
      mapping.targetSegments.forEach((segment, i) => { if (segment.sourceIds.some(id => sourceIds.has(id))) targetIndexes.add(i); });
      return { sourceIds, targetIndexes };
    }
    // Follow direct links only; shared phrases must not expand the selection.
    const fromTarget = indexes => {
      const targetIndexes = new Set(indexes), sourceIds = new Set();
      for (const index of targetIndexes) mapping.targetSegments[index]?.sourceIds.forEach(id => sourceIds.add(id));
      return { sourceIds, targetIndexes };
    };
    function pin(value, toggle = false) {
      const same = pinned && value.sourceIds.size === pinned.sourceIds.size && [...value.sourceIds].every(id => pinned.sourceIds.has(id));
      pinned = toggle && same ? null : value.targetIndexes.size ? value : null;
      hovered = null; highlight();
    }
    function clearHighlights() { hovered = null; pinned = null; highlight(); }
    function invalidateAlignment() {
      mapping = null; sourceSnapshot = ''; hovered = null; pinned = null;
      sourceElements = []; targetElements = []; targetRanges = [];
      mirror?.replaceChildren(); if (mirror) mirror.hidden = true;
      aligned?.replaceChildren(); if (aligned) aligned.hidden = true;
      if (output) output.hidden = false;
      if (hint) { hint.textContent = ''; hint.hidden = true; }
    }
    function syncMirror() {
      if (!mapping || !input || !mirror || mirror.hidden) return;
      const style = win.getComputedStyle(input);
      for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textIndent', 'textTransform', 'tabSize', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth', 'borderTopWidth', 'borderBottomWidth']) mirror.style[key] = style[key];
      // Exclude the native scrollbar so both layers wrap at the same column.
      if (input.clientWidth) mirror.style.width = `${input.clientWidth + parseFloat(style.borderLeftWidth || 0) + parseFloat(style.borderRightWidth || 0)}px`;
      if (input.clientHeight) mirror.style.height = `${input.clientHeight + parseFloat(style.borderTopWidth || 0) + parseFloat(style.borderBottomWidth || 0)}px`;
      mirror.scrollTop = input.scrollTop; mirror.scrollLeft = input.scrollLeft;
    }
    function sourceAtPoint(event) {
      if (!mapping || !mirror || !input) return null;
      const oldInput = input.style.pointerEvents, oldMirror = mirror.style.pointerEvents;
      try {
        input.style.pointerEvents = 'none'; mirror.style.pointerEvents = 'auto';
        const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
        const position = range ? null : doc.caretPositionFromPoint?.(event.clientX, event.clientY);
        const node = range?.startContainer || position?.offsetNode;
        const el = (node?.nodeType === 3 ? node.parentElement : node)?.closest?.('[data-source-id]');
        if (!el || !mirror.contains(el)) return null;
        const bounds = doc.createRange(); bounds.selectNodeContents(el);
        return [...bounds.getClientRects()].some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) ? el.dataset.sourceId : null;
      } finally { input.style.pointerEvents = oldInput; mirror.style.pointerEvents = oldMirror; }
    }
    function selectSource() {
      if (!mapping || input.value !== sourceSnapshot || input.selectionStart === input.selectionEnd) return false;
      pin(fromSource(mapping.sourceUnits.filter(unit => unit.start < input.selectionEnd && unit.end > input.selectionStart).map(unit => unit.id)));
      return true;
    }
    function targetSelection() {
      const selection = win.getSelection?.();
      if (!mapping || !selection?.rangeCount || selection.isCollapsed) return null;
      const range = selection.getRangeAt(0);
      if (!aligned.contains(range.startContainer) || !aligned.contains(range.endContainer)) return null;
      const prefix = doc.createRange(); prefix.selectNodeContents(aligned); prefix.setEnd(range.startContainer, range.startOffset);
      const start = prefix.toString().length;
      prefix.setEnd(range.endContainer, range.endOffset);
      const end = prefix.toString().length;
      return fromTarget(targetRanges.flatMap((span, i) => span.start < end && span.end > start ? [i] : []));
    }
    function renderResult(result, original, useAi) {
      invalidateAlignment();
      if (!output) return;
      output.value = result?.text || result?.error || '';
      if (!useAi || result?.ok === false) return;
      const source = alignmentApi?.segmentSourceText(original);
      const valid = source && alignmentApi.normalizeAlignment(result?.alignment, source.sourceUnits, output.value);
      if (!valid || !mirror || !aligned) {
        if (hint) { hint.hidden = false; hint.textContent = label('alignmentUnavailable', '译文已保留，本次没有可用的对照关系。'); }
        return;
      }
      mapping = valid; sourceSnapshot = original;
      let previous = 0;
      for (const unit of mapping.sourceUnits) {
        mirror.append(doc.createTextNode(original.slice(previous, unit.start)));
        const span = doc.createElement('span'); span.className = 'translation-alignment-token'; span.dataset.sourceId = unit.id; span.textContent = unit.text;
        mirror.append(span); sourceElements.push(span); previous = unit.end;
      }
      mirror.append(doc.createTextNode(original.slice(previous)), doc.createTextNode('\u200b'));
      let offset = 0;
      mapping.targetSegments.forEach((segment, index) => {
        const span = doc.createElement('span'); span.className = 'translation-alignment-segment'; span.dataset.sourceIds = segment.sourceIds.join(' '); span.dataset.segmentIndex = String(index); span.textContent = segment.text;
        targetRanges.push({ start: offset, end: offset + segment.text.length }); offset += segment.text.length;
        if (segment.sourceIds.length) {
          span.tabIndex = 0; span.setAttribute('role', 'button'); span.setAttribute('aria-pressed', 'false');
          span.addEventListener('mouseenter', () => { hovered = fromTarget([index]); highlight(); });
          span.addEventListener('mouseleave', () => { hovered = null; highlight(); });
          span.addEventListener('click', () => { const selected = targetSelection(); pin(selected || fromTarget([index]), !selected); });
          span.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pin(fromTarget([index]), true); } });
        }
        aligned.append(span); targetElements.push(span);
      });
      mirror.hidden = false; aligned.hidden = false; output.hidden = true;
      if (hint) { hint.hidden = false; hint.textContent = label(['sentence', 'block'].includes(source.granularity) ? 'alignmentCoarse' : 'alignmentReady', ['sentence', 'block'].includes(source.granularity) ? '分句对照已生成' : '对照已生成'); }
      tick(syncMirror);
    }
    function renderReferences() {
      const host = q('#translateTags'); if (!host) return;
      const refs = translation?.findReferences?.(input?.value || '', q('#translateDirection')?.value || 'auto') || [];
      host.replaceChildren(); put('#translateTagCount', `${refs.length} ${label('tagsUnit', '个')}`);
      refs.slice(0, 60).forEach(ref => {
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'translate-tag btn btn-chip';
        button.textContent = `${ref.en || ref.tag?.en || ''}${ref.zhPrimary ? ` · ${ref.zhPrimary}` : ''}`;
        if (ref.matchType) button.title = `匹配方式：${ref.matchType}`;
        button.onclick = () => onTagSelected?.(ref.tag?.id || ref.en);
        host.append(button);
      });
    }
    function cancel(invalidate = true) {
      win.clearTimeout(timer); win.clearTimeout(refsTimer); timer = null; sequence++;
      const previous = job; job = null;
      if (previous) { try { runtime?.cancel?.(previous.runtimeId); } catch { /* stale responses are still discarded */ } }
      if (invalidate) invalidateAlignment(); else clearHighlights();
      put('#translateStatus', input?.value.trim() ? label('waitingAction', '等待翻译') : label('statusIdle', '输入内容后自动本地翻译'));
      syncControls();
    }
    async function translate(useAi) {
      const original = input?.value || '';
      if (!original.trim()) { syncControls(); notify?.(label('enterText', '请输入要翻译的内容')); return; }
      if (job?.useAi) return;
      cancel();
      const current = { runtimeId: `translation-${useAi ? 'ai' : 'local'}-${sequence}`, useAi: Boolean(useAi) }; job = current;
      syncControls();
      const direction = q('#translateDirection')?.value || 'auto';
      put('#translateStatus', label(useAi ? 'aiWorking' : 'localWorking', useAi ? 'AI 翻译中…' : '本地翻译中…'));
      try {
        let result;
        try {
          if (typeof runtime?.runSubAgent !== 'function') throw new Error(label('serviceUnavailable', '翻译服务不可用，请重启应用'));
          const envelope = await runtime.runSubAgent('translation', {
            input: { text: original, direction, source: useAi ? 'ai' : 'local', ...(useAi ? { includeAlignment: true } : {}) }, requestId: current.runtimeId,
          });
          result = envelope?.ok === false ? { ok: false, error: envelope.error?.message || envelope.error || label('failed', '翻译失败') } : { ok: true, ...(envelope?.data || {}) };
        } catch (error) { result = { ok: false, error: error.message || String(error) }; }
        if (job !== current) return result;
        renderResult(result, original, useAi);
        put('#translateStatus', label(result.ok ? 'complete' : 'failed', result.ok ? '完成' : '翻译失败'));
        return result;
      } finally { if (job === current) { job = null; syncControls(); } }
    }
    function enter() { syncControls(); renderReferences(); tick(syncMirror); }
    function leave() { cancel(false); }
    function bind() {
      if (bound) return; bound = true;
      input?.addEventListener('input', () => { cancel(); refsTimer = win.setTimeout(renderReferences, 100); if (input.value.trim()) timer = win.setTimeout(() => translate(false), 500); });
      input?.addEventListener('scroll', syncMirror);
      input?.addEventListener('select', selectSource);
      input?.addEventListener('keyup', selectSource);
      input?.addEventListener('mousemove', event => { if (!mapping || event.buttons) return; const id = sourceAtPoint(event); hovered = id ? fromSource([id]) : null; highlight(); });
      input?.addEventListener('mouseleave', () => { hovered = null; highlight(); });
      input?.addEventListener('click', () => { if (!mapping || selectSource()) return; const unit = mapping.sourceUnits.find(unit => unit.start <= input.selectionStart && unit.end > input.selectionStart); if (unit) pin(fromSource([unit.id]), true); else clearHighlights(); });
      q('#translateDirection')?.addEventListener('change', () => { cancel(); if (input?.value.trim()) translate(false); refsTimer = win.setTimeout(renderReferences, 80); });
      q('#translateAi')?.addEventListener('click', () => translate(true));
      q('#translateClear')?.addEventListener('click', () => { if (input) input.value = ''; if (output) output.value = ''; cancel(); renderReferences(); });
      q('#translateCopy')?.addEventListener('click', () => copy?.(output?.value || ''));
      q('#translateCopyTags')?.addEventListener('click', () => copy?.([...q('#translateTags').querySelectorAll('.translate-tag')].map(node => node.textContent).join(', ')));
      doc.addEventListener('selectionchange', () => {
        if (!mapping || pane.hidden) return;
        // A drag selection in the rendered translation can leave focus on the
        // editable source textarea. Resolve the actual range first so target
        // selection always wins over stale textarea focus.
        const target = targetSelection();
        if (target) pin(target);
        else if (doc.activeElement === input) selectSource();
      });
      pane?.addEventListener('mousedown', event => { if (event.target !== input && !event.target.closest('.translation-alignment-segment')) clearHighlights(); });
      pane?.addEventListener('keydown', event => { if (event.key !== 'Escape' || !mapping) return; clearHighlights(); if (doc.activeElement === input) input.setSelectionRange(input.selectionEnd, input.selectionEnd); else if (targetSelection()) win.getSelection().removeAllRanges(); });
      aligned?.addEventListener('mouseup', () => { const selection = targetSelection(); if (selection) pin(selection); });
      win.addEventListener('resize', syncMirror);
      if (win.ResizeObserver && input) { const observer = new win.ResizeObserver(syncMirror); observer.observe(input); }
      syncControls();
    }
    return { bind, enter, leave, translate, renderReferences };
  }
  return { createTranslationView };
});
