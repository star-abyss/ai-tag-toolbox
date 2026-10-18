'use strict';

// Only requested pages and their declared dependencies are loaded. Successful
// scripts are reused; a failed read can be retried on the next visit.
(function installViewLoader(global) {
  const doc = global.document;
  const pending = new Map();
  function sourceFor(name) {
    return doc?.querySelector?.(`script[data-lazy-view="${name}"]`);
  }
  function load(name) {
    if (pending.has(name)) return pending.get(name);
    const source = sourceFor(name);
    if (!source) return Promise.reject(new Error(`找不到页面模块：${name}`));
    const dependencies = (source.dataset.depends || '').split(/\s+/).filter(Boolean);
    const task = Promise.all(dependencies.map(load)).then(() => new Promise((resolve, reject) => {
      const script = doc.createElement('script');
      script.src = source.dataset.src;
      script.onload = () => resolve(true);
      script.onerror = () => { script.remove(); reject(new Error(`无法加载页面模块：${name}，请重试`)); };
      doc.head.appendChild(script);
    })).catch(error => {
      pending.delete(name);
      throw error;
    });
    pending.set(name, task);
    return task;
  }
  global.AppViewLoader = Object.freeze({ load });
})(typeof globalThis !== 'undefined' ? globalThis : window);
