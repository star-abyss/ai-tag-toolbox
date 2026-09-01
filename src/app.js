'use strict';

/* App 入口只负责组装模块、保存页面级路由状态和启动视图。 */
(function boot(global) {
  const modules = global.AppModules || {};
  const storage = modules.storage;
  const app = {
    route: 'tags',
    theme: storage?.get?.('app.theme', storage?.get?.('rewrite_theme', 'light')) || 'light',
    locale: storage?.get?.('app.locale', storage?.get?.('rewrite_locale', 'zh-CN')) || 'zh-CN'
  };
  const view = global.AppView?.create?.(modules);
  if (!view) return;
  global.App = { modules, state: app, route: value => { app.route = value; view.route(value); } };
  view.start();
})(window);
