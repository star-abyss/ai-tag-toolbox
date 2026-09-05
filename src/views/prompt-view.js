'use strict';

function createPromptView({ prompts } = {}) {
  return {
    render() { return prompts?.snapshot?.() || {}; },
    get(key) { return prompts?.get?.(key, '') || ''; },
    set(key, value) { return prompts?.set?.(key, value) || ''; },
    reset(key) { return prompts?.reset?.(key); }
  };
}

module.exports = { createPromptView };
