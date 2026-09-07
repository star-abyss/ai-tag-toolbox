'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('F:/codex/ai-tag-verification-tools/node_modules/jsdom');

const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, 'src', name), 'utf8');

function boot(options = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'src/index.html'), 'utf8'), {
    url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only'
  });
  const { window } = dom;
  const downloadBlobs = [];
  window.URL.createObjectURL = blob => { downloadBlobs.push(blob); return 'blob:ui-test'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function click() {};
  window.navigator.clipboard = { writeText: async () => {} };
  window.prompt = () => '新名称';
  window.confirm = () => true;

  const session = { id: 's1', title: '测试会话', messages: [] };
  const images = new Map([['img-1', { id: 'img-1', dataUrl: 'data:image/png;base64,AA==' }]]);
  const gallery = [{ imageId: 'img-1', filename: 'one.png', dataUrl: 'data:image/png;base64,AA==' }];
  let runCount = 0;
  let conversationItems = options.conversationItems ? options.conversationItems.slice() : [];
  const repository = {
    listGallery: () => ({ items: gallery.slice() }),
    get: id => images.get(id),
    getOriginalBytes: async () => new Uint8Array([1, 2]),
    referenceCount: () => ({ total: 0, conversations: 0, messages: 0 }),
    removeFromGallery: id => { const index = gallery.findIndex(item => item.imageId === id); if (index >= 0) gallery.splice(index, 1); },
    renameGalleryImage: (id, name) => { const item = gallery.find(row => row.imageId === id); if (item) item.displayName = name; },
    attachToConversation: () => ({ refId: 'r1' }),
    listConversation: () => ({ items: conversationItems.slice() }),
    clearConversationImages: sessionId => { options.clearConversationImages?.(sessionId); conversationItems = []; return { removed: 1, deletedImages: 1 }; }
  };
  let settings = { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', key: '', comfyBase: 'http://127.0.0.1:8188', comfyW: 768, comfyH: 1024, comfySteps: 25, comfyCfg: 7, batchCount: 1, maxComfyCalls: 3 };
  const assistant = {
    sessions: () => [session], currentSession: () => session, newSession: () => session,
    getSettings: () => settings,
    setSettings: patch => { settings = { ...settings, ...patch }; return settings; }, listModels: async () => ({ ok: true, models: ['gpt-4o-mini'] }), listVisionModels: async () => ({ ok: true, models: ['gpt-4o-mini'] }),
    refreshCapabilities: async () => ({ comfy: { enabled: false, connected: false }, vision: { local: false, ai: false } }),
    calls: { refreshCapabilities: async () => ({ comfy: { enabled: false, connected: false }, vision: { local: false, ai: false } }) },
    run: async input => {
      runCount += 1;
      session.messages.push({ id: `m${runCount}`, role: 'user', text: input.text, imageIds: input.imageIds || [], status: 'done' });
      const result = options.runResult || { ok: true, text: '完成', requestId: input.requestId };
      if (options.runResult) session.messages.push({ id: `a${runCount}`, role: 'assistant', text: result.text, status: 'error' });
      return result;
    },
    cancel: () => true,
    clearConversationImages: sessionId => repository.clearConversationImages?.(sessionId),
    deleteSession: (sessionId, value) => { options.deleteSession?.(sessionId, value); return true; },
    imageRepository: repository
  };
  const callRecords = options.callRecords ? options.callRecords.slice() : [];
  assistant.listCallRecords = () => callRecords.slice();
  assistant.clearCallRecords = () => { callRecords.length = 0; };
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
  const modules = { assistant, runtime: { listCallRecords: assistant.listCallRecords, clearCallRecords: assistant.clearCallRecords }, prompts, tags, images: { get: id => images.get(id), preview: id => images.get(id) }, imageRepository: repository, preferences: { get: (_k, fallback) => fallback, set: () => {} }, translation: { findReferences: () => [] }, comfy: { setBase: () => {}, setWorkflow: () => {}, check: async () => false }, locales: { 'zh-CN': {} }, version: '1.4.194' };

  for (const file of ['views/conversation-view.js', 'views/gallery-view.js', 'views/settings-view.js', 'views/comfy-view.js', 'views/prompt-view.js', 'views/agent-status-view.js', 'views/call-monitor-view.js', 'app-view.js']) window.eval(source(file));
  const view = window.AppView.create(modules, window.document);
  view.start();
  return { dom, window, view, assistant, repository, gallery, downloadBlobs, getRunCount: () => runCount };
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

test('ComfyUI gets a dedicated AI tab and the conversation debug button opens it', () => {
  const app = boot();
  app.view.route('ai');
  app.view.showAi('comfy');
  assert.equal(app.window.document.querySelector('#tabComfy')?.style.display, '');
  assert.equal(app.window.document.querySelector('#tabApi')?.style.display, 'none');
  assert.equal(app.window.document.querySelector('#tabApi #comfyBase'), null);
  assert.equal(app.window.document.querySelector('#tabApi #comfyWf'), null);
  const workflow = app.window.document.querySelector('#comfyWf');
  workflow.value = '{"3":{"class_type":"KSampler"}}';
  workflow.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  app.window.document.querySelector('#comfySeed').value = '1234';
  app.window.document.querySelector('#comfySeed').dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(app.assistant.getSettings().comfySeed, 1234);
  app.view.showAi('api');
  app.window.document.querySelector('#aiClearCfg').click();
  assert.equal(app.assistant.getSettings().comfyWorkflow, '{"3":{"class_type":"KSampler"}}');
  app.view.showAi('comfy');
  assert.equal(app.window.document.querySelector('#comfyWf').value, '{"3":{"class_type":"KSampler"}}');
  app.window.document.querySelector('#talkComfyDebug').click();
  assert.equal(app.window.document.querySelector('#tabComfy')?.style.display, '');
  app.dom.window.close();
});

test('ComfyUI workflow action buttons have localized labels', () => {
  const zh = JSON.parse(fs.readFileSync(path.join(root, 'locales', 'zh-CN.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(root, 'locales', 'en-US.json'), 'utf8'));
  assert.match(zh.ui.settings.workflowClear, /清空/);
  assert.match(zh.ui.settings.comfyRestoreDefault, /默认/);
  assert.match(en.ui.settings.workflowClear, /Clear/i);
  assert.match(en.ui.settings.comfyRestoreDefault, /default/i);
});

test('conversation image clear button confirms and clears only current conversation images', () => {
  let clearedSession = '';
  const app = boot({ conversationItems: [{ refId: 'r1', imageId: 'img-1', slotNo: 1, source: 'upload', sent: true }], clearConversationImages: sessionId => { clearedSession = sessionId; } });
  const button = app.window.document.querySelector('#talkClearImagesBtn');
  assert.ok(button);
  button.click();
  assert.equal(app.window.document.querySelector('#cfmModal').classList.contains('show'), true);
  app.window.document.querySelector('#cfmYes').click();
  assert.equal(clearedSession, 's1');
  assert.match(app.window.document.querySelector('#talkImageRepository').textContent, /No conversation images|没有对话图片/);
  app.dom.window.close();
});

test('deleting a conversation defaults to removing images unless gallery retention is checked', () => {
  let deleted;
  const app = boot({ deleteSession: (sessionId, value) => { deleted = { sessionId, value }; } });
  app.window.document.querySelector('#talkManage').click();
  app.window.document.querySelector('#mgrChatList .del, #mgrGenList .del, .fav .del')?.click();
  assert.equal(app.window.document.querySelector('#cfmRetainImages').checked, false);
  app.window.document.querySelector('#cfmYes').click();
  assert.equal(deleted.sessionId, 's1');
  assert.equal(deleted.value.retainImages, false);
  app.dom.window.close();
});

test('external call monitor opens with redacted IO and exports its records', async () => {
  const app = boot({ callRecords: [{
    requestId: 'primary-1', rootRequestId: 'primary-1', parentRequestId: '', kind: 'primary', status: 'completed',
    startedAt: 1, endedAt: 2, input: { messages: [{ role: 'user', content: '查找角色' }] },
    output: { text: '完成', key: '[REDACTED]' }, events: [], usage: { total_tokens: 4 }
  }, {
    requestId: 'tool-2', rootRequestId: 'primary-2', parentRequestId: 'primary-2', kind: 'tool:tags.search', status: 'completed',
    startedAt: 3, endedAt: 5, input: { args: { query: 'blue hair' } }, output: { items: [] }, events: [], usage: {}
  }] });
  app.window.document.querySelector('#openCallMonitor').click();
  const modal = app.window.document.querySelector('#callMonitorModal');
  assert.equal(modal.parentElement, app.window.document.body);
  assert.equal(modal.classList.contains('show'), true);
  assert.equal(modal.getAttribute('aria-hidden'), 'false');
  assert.match(app.window.document.querySelector('#callMonitorList').textContent, /primary-1/);
  assert.match(app.window.document.querySelector('#callMonitorList').textContent, /查找角色/);
  assert.match(app.window.document.querySelector('#callMonitorList').textContent, /REDACTED/);
  const filter = app.window.document.querySelector('#callMonitorFilter');
  filter.value = 'primary-2';
  filter.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  const exported = app.view.views.callMonitor.exportJson();
  assert.equal(exported.records.length, 1);
  assert.equal(exported.records[0].requestId, 'tool-2');
  app.window.document.querySelector('#callMonitorExport').click();
  const exportedText = await new Promise(resolve => {
    const reader = new app.window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(app.downloadBlobs.at(-1));
  });
  assert.equal(JSON.parse(exportedText).records[0].requestId, 'tool-2');
  assert.equal(app.window.document.querySelector('#callMonitorModal').classList.contains('show'), true);
  app.window.document.querySelector('#callMonitorClear').click();
  assert.equal(app.assistant.listCallRecords().length, 2);
  app.window.document.querySelector('#cfmYes').click();
  assert.equal(app.assistant.listCallRecords().length, 0);
  app.window.document.querySelector('#callMonitorClose').click();
  assert.equal(modal.getAttribute('aria-hidden'), 'true');
  app.dom.window.close();
});

test('failed replies keep progress in messages without copying it into the ComfyUI toolbar', async () => {
  const progress = '【进度 步骤1/5】正在处理：确认当前会话中的图片引用，查询角色。'.repeat(20);
  const app = boot({ runResult: { ok: false, text: progress, error: { code: 'OUTPUT_INVALID', message: 'Tag 子代理返回格式无效' } } });
  try {
    const doc = app.window.document;
    doc.querySelector('#talkIn').value = '继续任务';
    doc.querySelector('#talkSendBtn').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(doc.querySelector('#talkStatus').textContent, '输出格式无效');
    assert.doesNotMatch(doc.querySelector('.tk-statusline').textContent, /进度|步骤1/);
    assert.match(doc.querySelector('#talkConv').textContent, /进度 步骤1/);
    assert.equal(doc.querySelector('#talkComfyDebug').textContent, '调试');
  } finally { app.dom.window.close(); }
});
