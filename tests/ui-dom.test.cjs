'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('F:/codex/ai-tag-verification-tools/node_modules/jsdom');

const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, 'src', name), 'utf8');

function boot() {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'src/index.html'), 'utf8'), {
    url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only'
  });
  const { window } = dom;
  window.URL.createObjectURL = () => 'blob:ui-test';
  window.URL.revokeObjectURL = () => {};
  window.navigator.clipboard = { writeText: async () => {} };
  window.prompt = () => '新名称';
  window.confirm = () => true;

  const session = { id: 's1', title: '测试会话', messages: [] };
  const images = new Map([['img-1', { id: 'img-1', dataUrl: 'data:image/png;base64,AA==' }]]);
  const gallery = [{ imageId: 'img-1', filename: 'one.png', dataUrl: 'data:image/png;base64,AA==' }];
  let runCount = 0;
  const repository = {
    listGallery: () => ({ items: gallery.slice() }),
    get: id => images.get(id),
    getOriginalBytes: async () => new Uint8Array([1, 2]),
    referenceCount: () => ({ total: 0, conversations: 0, messages: 0 }),
    removeFromGallery: id => { const index = gallery.findIndex(item => item.imageId === id); if (index >= 0) gallery.splice(index, 1); },
    renameGalleryImage: (id, name) => { const item = gallery.find(row => row.imageId === id); if (item) item.displayName = name; },
    attachToConversation: () => ({ refId: 'r1' }),
    listConversation: () => ({ items: [] })
  };
  const assistant = {
    sessions: () => [session], currentSession: () => session, newSession: () => session,
    getSettings: () => ({ base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', key: '', comfyBase: 'http://127.0.0.1:8188', comfyW: 768, comfyH: 1024, comfySteps: 25, comfyCfg: 7, batchCount: 1, maxComfyCalls: 3 }),
    setSettings: () => {}, listModels: async () => ({ ok: true, models: ['gpt-4o-mini'] }), listVisionModels: async () => ({ ok: true, models: ['gpt-4o-mini'] }),
    refreshCapabilities: async () => ({ comfy: { enabled: false, connected: false }, vision: { local: false, ai: false } }),
    calls: { refreshCapabilities: async () => ({ comfy: { enabled: false, connected: false }, vision: { local: false, ai: false } }) },
    run: async input => { runCount += 1; session.messages.push({ id: `m${runCount}`, role: 'user', text: input.text, imageIds: input.imageIds || [], status: 'done' }); return { ok: true, text: '完成', requestId: input.requestId }; },
    cancel: () => true, imageRepository: repository
  };
  const promptKeys = ['primary', 'generateTags', 'artistQuality', 'vision', 'translation'];
  const promptSet = { id: 'prompt-set-default', name: '默认提示词', items: { primary: 'prompt text', generateTags: 'prompt text', artistQuality: 'prompt text', vision: 'prompt text', translation: 'prompt text' } };
  const extension = { id: 'ext-1', name: '扩展 1', text: 'ext text', enabled: true, activation: { mode: 'always', keywords: [] } };
  const prompts = {
    get: () => 'prompt text', getEffective: () => 'prompt text', set: () => 'prompt text', getDefault: () => 'default',
    item: key => ({ key, text: 'prompt text', defaultText: 'default', enabled: true, builtin: true }),
    items: () => promptKeys.map(key => ({ key, text: 'prompt text', defaultText: 'default', enabled: true, builtin: true })),
    keys: () => promptKeys.slice(),
    reset: () => ({}), resetItem: () => ({}),
    sets: () => [promptSet], activeSetId: () => promptSet.id, activeSet: () => promptSet,
    createSet: () => ({ id: 'prompt-set-2', name: '提示词组 2', items: {} }), deleteSet: () => true, renameSet: () => ({ name: '提示词组 2' }), setActive: () => true, resetSet: () => ({}),
    extensions: () => [extension], createExtension: () => ({ id: 'ext-2', name: '扩展 2', text: '', enabled: true, activation: { mode: 'always', keywords: [] } }),
    updateExtension: () => ({}), deleteExtension: () => true, matchExtensions: () => [],
    composePrimary: () => 'composed primary', composeGenerate: () => 'composed generate',
    snapshot: () => ({ version: 2, sets: [promptSet], activeSetId: promptSet.id, activeSet: promptSet, items: {}, extensions: [extension], defaults: {}, metadata: {} }),
    exportBundle: () => ({ format: 'ai-tag-prompts', version: 2, sets: [promptSet], extensions: [extension] }),
    importBundle: () => ({ sets: [promptSet], extensions: [extension] }),
    exportExtensions: () => ({ format: 'ai-tag-prompt-extensions', version: 1, extensions: [extension] }), importExtensions: () => ({ ok: true, count: 1 })
  };
  const tags = {
    stateSnapshot: () => ({ categories: [], categoryCounts: {}, selected: [], category: 'all', revision: 0 }), selected: () => [], page: () => ({ items: [], total: 0 }),
    restore: () => {}, setSearchPrecision: () => {}, setAdult: () => {}, setQuery: () => {}, size: () => 0, customTags: () => [], subcategories: () => [], getCategories: () => []
  };
  const modules = { assistant, prompts, tags, images: { get: id => images.get(id), preview: id => images.get(id) }, imageRepository: repository, preferences: { get: (_k, fallback) => fallback, set: () => {} }, translation: { findReferences: () => [] }, comfy: { setBase: () => {}, setWorkflow: () => {}, check: async () => false }, locales: { 'zh-CN': {} }, version: '1.4.194' };

  for (const file of ['views/conversation-view.js', 'views/gallery-view.js', 'views/settings-view.js', 'views/prompt-view.js', 'views/agent-status-view.js', 'app-view.js']) window.eval(source(file));
  const view = window.AppView.create(modules, window.document);
  view.start();
  return { dom, window, view, assistant, repository, gallery, getRunCount: () => runCount };
}

test('full DOM startup renders extracted views and conversation click uses assistant runtime', async () => {
  const app = boot();
  assert.ok(app.window.document.querySelector('#talkConv'));
  assert.ok(app.window.document.querySelector('#mainPromptSetCard'));
  assert.ok(app.window.document.querySelector('#extensionPromptsCard'));
  assert.equal(app.window.document.querySelectorAll('#extList .ext-row').length, 1);
  assert.equal(app.window.document.querySelector('#promptSetSel')?.options?.length, 1);
  app.window.document.querySelector('#talkIn').value = '生成一张图';
  app.window.document.querySelector('#talkSendBtn').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.getRunCount(), 1);
  assert.match(app.window.document.querySelector('#talkConv').textContent, /生成一张图/);
  app.dom.window.close();
});

test('gallery factory owns card action rendering and rename path', () => {
  const app = boot();
  app.view.route('gallery');
  const card = app.window.document.querySelector('.gallery-card');
  assert.ok(card);
  card.querySelector('[data-action="rename"]').click();
  assert.equal(app.gallery[0].displayName, '新名称');
  app.dom.window.close();
});
