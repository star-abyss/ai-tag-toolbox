'use strict';

(function install(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.interaction = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFactory() {
  const text = (value, fallback = '') => value == null || value === '' ? fallback : String(value);
  function createInteractionView({ document: doc, broker, projection, assistant, sessionId, notify, onAnswer, autoBind = true } = {}) {
    const q = selector => doc?.querySelector?.(selector);
    const getSessionId = typeof sessionId === 'function' ? sessionId : () => sessionId || assistant?.currentSession?.()?.id || '';
    let bound = false;
    let answering = false;
    async function answer(interaction, value) {
      if (answering) return false;
      answering = true; render();
      try {
        const result = onAnswer ? await onAnswer(interaction, value) : await assistant?.answerInteraction?.(interaction.interactionId, value, { sessionId: getSessionId() });
        if (!result || result.ok === false) throw new Error(result?.error?.message || '回答无法提交，请重试');
        return true;
      } catch (error) { notify?.(error?.message || '回答已失效'); return false; }
      finally { answering = false; render(); }
    }
    function render() {
      const host = q('#agentInteractionPanel'); if (!host) return null;
      host.replaceChildren();
      const currentSessionId = getSessionId();
      const interaction = projection?.interactions?.(currentSessionId)?.[0] || broker?.current?.(currentSessionId);
      if (!interaction || interaction.status !== 'open') { host.hidden = true; return null; }
      host.hidden = false;
      const title = doc.createElement('strong'); title.textContent = interaction.question || '需要你的回答'; host.append(title);
      const body = doc.createElement('div'); body.className = 'agent-interaction-body';
      if (interaction.kind === 'choice' && interaction.options?.length) {
        for (const option of interaction.options || []) {
          const button = doc.createElement('button'); button.type = 'button'; button.className = 'btn btn-secondary'; button.dataset.interactionOption = option.id || option.label || option;
          button.textContent = option.label || option.name || option.id || String(option); button.addEventListener('click', () => answer(interaction, option)); body.append(button);
        }
      } else {
        const input = doc.createElement(interaction.kind === 'feedback' ? 'textarea' : 'input'); input.className = 'agent-interaction-input'; input.value = interaction.defaultValue || ''; input.placeholder = interaction.kind === 'feedback' ? '填写反馈' : '填写回答';
        const submit = doc.createElement('button'); submit.type = 'button'; submit.className = 'btn btn-primary'; submit.textContent = '提交'; submit.addEventListener('click', () => answer(interaction, input.value)); body.append(input, submit);
      }
      for (const control of body.querySelectorAll('button, input, textarea')) control.disabled = answering;
      host.append(body); return interaction;
    }
    function bind() { if (bound) return; bound = true; render(); }
    if (autoBind) bind();
    return { render, bind, answer };
  }
  return { createInteractionView };
});
