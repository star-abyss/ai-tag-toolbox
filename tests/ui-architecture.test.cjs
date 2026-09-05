'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
test('view factories load as browser scripts before the app composer', () => {
  const context = vm.createContext({});
  for (const name of ['conversation', 'gallery', 'settings', 'prompt', 'agent-status']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'src/views', `${name}-view.js`), 'utf8'), context);
  }
  for (const name of ['conversation', 'gallery', 'settings', 'prompt', 'agentStatus']) assert.ok(context.AppViews[name]);
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
  assert.match(app, /viewFactories\.prompt/);
  assert.match(app, /viewFactories\.agentStatus/);
});
