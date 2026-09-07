'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
test('view factories load as browser scripts before the app composer', () => {
  const context = vm.createContext({});
  for (const name of ['conversation', 'gallery', 'settings', 'comfy', 'prompt', 'agent-status', 'call-monitor']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'src/views', `${name}-view.js`), 'utf8'), context);
  }
  for (const name of ['conversation', 'gallery', 'settings', 'comfy', 'prompt', 'agentStatus', 'callMonitor']) assert.ok(context.AppViews[name]);
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  assert.ok(html.indexOf('views/conversation-view.js') < html.indexOf('src="app-view.js"'));
});
test('the app composes views and has no old prompt modes or renderer persistence access', () => {
  const app = fs.readFileSync(path.join(root, 'src/app-view.js'), 'utf8');
  const entry = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
  assert.doesNotMatch(app + entry, /modules\.storage|talkMode|tkDraw/);
  assert.match(app, /viewFactories\.conversation/);
  assert.match(app, /viewFactories\.gallery/);
  assert.match(app, /viewFactories\.settings/);
  assert.match(app, /viewFactories\.comfy/);
  assert.match(app, /viewFactories\.prompt/);
  assert.match(app, /viewFactories\.agentStatus/);
});

test('medium desktop header centers every navigation row on one axis', () => {
  const css = fs.readFileSync(path.join(root, 'src', 'app.css'), 'utf8');
  const marker = '/* V1.4.210：非最大化窗口导航居中。';
  const start = css.lastIndexOf(marker);
  assert.ok(start >= 0, 'the non-maximized navigation override should be present');
  const override = css.slice(start);
  assert.match(override, /@media\s*\(min-width:861px\)\s*and\s*\(max-width:1500px\)\s*\{[\s\S]*?header\s*\{[\s\S]*?grid-template-columns\s*:\s*minmax\(0,1fr\)/);
  assert.match(override, /\.header-side-left\s*\{[\s\S]*?justify-content\s*:\s*center/);
  assert.match(override, /\.header-trailing\s*\{[\s\S]*?justify-content\s*:\s*center/);
  assert.match(override, /header\s+\.header-workspace\s*\{[\s\S]*?grid-row\s*:\s*2[\s\S]*?justify-self\s*:\s*center/);
  assert.match(override, /header\s+\.header-workspace\s+#aiCfgBtns\s*\{[\s\S]*?justify-content\s*:\s*center/);
  assert.match(override, /\.header-left\s*\{[\s\S]*?position\s*:\s*absolute[\s\S]*?left\s*:\s*0/);
  assert.match(override, /\.header-leading\s*\{[\s\S]*?margin-inline\s*:\s*auto/);
  assert.match(css, /@media\s*\(min-width:1501px\)/, 'wide desktop rules should remain separate');
});
