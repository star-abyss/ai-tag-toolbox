'use strict';

/* App entry point only composes public modules and the route view. */
(function boot(global) {
  const modules = global.AppModules || {};
  const preferences = modules.preferences || null;
  const get = (key, fallback) => { try { return preferences?.get?.(key, fallback) ?? fallback; } catch { return fallback; } };
  const app = {
    route: 'tags',
    theme: get('theme', get('app.theme', 'light')) || 'light',
    locale: get('locale', get('app.locale', 'zh-CN')) || 'zh-CN'
  };
  const view = global.AppView?.create?.(modules, global.document);
  if (!view) return;
  global.App = {
    modules,
    state: app,
    route(value) { app.route = value; view.route?.(value); },
    views: view.views || {}
  };
  view.start?.();
})(typeof globalThis !== 'undefined' ? globalThis : window);
