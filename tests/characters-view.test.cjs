'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('F:/codex/ai-tag-verification-tools/node_modules/jsdom');

const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, 'src', name), 'utf8');

function characterMarkup() {
  return `
    <section id="charactersView">
      <div class="characters-toolbar"><h2>角色库</h2><label for="characterSeriesQuery">搜索作品</label></div>
      <input id="characterSeriesQuery" placeholder="输入作品 / 来源"><select id="characterSeries"></select>
      <span id="characterCount"></span><div id="characterList"></div>
      <button id="characterPrev"></button><span id="characterPage"></span><button id="characterNext"></button>
      <div id="characterDetail"></div>
    </section>`;
}

function fixture(overrides = {}) {
  const dom = new JSDOM(`<!doctype html><body>${characterMarkup()}</body>`, { url: 'http://localhost/' });
  const calls = { page: [], series: [], get: [], select: [], copy: [] };
  const records = {
    miku: {
      id: 'miku', name: 'hatsune_miku', nameZh: '<img src=x onerror=alert(1)>', aliases: ['初音'],
      seriesId: 'vocaloid', seriesName: 'VOCALOID', identityTags: ['hatsune_miku_(vocaloid)', 'vocaloid'],
      generalTags: [{ id: 'teal_hair', en: 'teal hair', zh: '青绿色头发', category: 'hair', nsfw: false }],
      specificTags: [{ id: 'sekai_uniform', en: 'sekai uniform', zh: '世界计划制服', category: 'outfit', nsfw: false, review: true }],
      hasFeatures: true
    }
  };
  const characters = {
    page(options) {
      calls.page.push({ ...options });
      return { items: [{ id: 'miku', name: 'hatsune_miku', nameZh: '<b>初音未来</b>', seriesId: 'vocaloid', seriesName: 'VOCALOID', count: 3, hasFeatures: true }], total: 51, offset: options.offset, limit: options.limit, hasMore: options.offset === 0 };
    },
    series(options) { calls.series.push({ ...options }); return [{ id: 'vocaloid', name: 'VOCALOID', count: 40 }, { id: 'project_sekai', name: 'Project SEKAI', count: 11 }]; },
    get(id, options) { calls.get.push([id, { ...options }]); return records[id]; },
    select(id, options) { calls.select.push([id, { ...options }]); return { id, name: 'hatsune_miku', tags: ['hatsune_miku_(vocaloid)'] }; },
    ...overrides.characters
  };
  const api = require(path.join(root, 'src/views/characters-view.js'));
  let currentLocale = overrides.locale || 'zh-CN';
  const view = api.createCharactersView({
    document: dom.window.document,
    characters,
    onChange: () => { calls.changed = (calls.changed || 0) + 1; },
    copy: async value => { calls.copy.push(value); return true; },
    notify: value => { calls.notice = value; },
    getLocale: () => currentLocale
  });
  return { dom, document: dom.window.document, view, calls, setLocale: value => { currentLocale = value; } };
}

test('render requests a 50-row page and shows untrusted names as text', () => {
  const app = fixture();
  const result = app.view.render({ query: '初音', precision: 'exact', includeAdult: false });
  assert.deepEqual(app.calls.page[0], { query: '初音', seriesId: '', precision: 'exact', offset: 0, limit: 50, includeAdult: false });
  assert.equal(result.total, 51);
  assert.equal(app.document.querySelectorAll('.character-row').length, 1);
  assert.match(app.document.querySelector('.character-row').textContent, /<b>初音未来<\/b>/);
  assert.equal(app.document.querySelector('.character-row-names > span b'), null);
  assert.equal(app.document.querySelector('#characterNext').disabled, false);
  app.dom.window.close();
});

test('series search and pagination preserve the character query', () => {
  const app = fixture();
  app.view.render({ query: 'miku', precision: 'standard', includeAdult: true });
  const filter = app.document.querySelector('#characterSeriesQuery');
  filter.value = 'sekai';
  filter.dispatchEvent(new app.dom.window.Event('input', { bubbles: true }));
  assert.equal(app.calls.series.at(-1).query, 'sekai');
  const series = app.document.querySelector('#characterSeries');
  series.value = 'project_sekai';
  series.dispatchEvent(new app.dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(app.calls.page.at(-1), { query: 'miku', seriesId: 'project_sekai', precision: 'standard', offset: 0, limit: 50, includeAdult: true });
  app.document.querySelector('#characterNext').click();
  assert.equal(app.calls.page.at(-1).offset, 50);
  assert.equal(app.calls.page.at(-1).query, 'miku');
  assert.equal(app.calls.page.at(-1).seriesId, 'project_sekai');
  app.dom.window.close();
});

test('detail starts optional traits unchecked and sends explicit selection modes', async () => {
  const app = fixture();
  app.view.render({ query: '', precision: 'standard', includeAdult: false });
  app.document.querySelector('[data-character-id="miku"]').click();
  assert.equal(app.document.querySelectorAll('#characterDetail input[data-tag-id]:checked').length, 0);
  assert.equal(app.document.querySelector('[data-include-series]').checked, true);
  assert.equal(app.document.querySelector('#characterDetail img'), null);

  app.document.querySelector('[data-character-copy="identity"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.calls.copy.at(-1), 'hatsune_miku_\\(vocaloid\\), vocaloid');

  app.document.querySelector('[data-character-action="identity"]').click();
  assert.deepEqual(app.calls.select[0], ['miku', { generalTagIds: [], specificTagIds: [], includeSeries: true, includeAdult: false }]);

  app.document.querySelector('[data-tag-id="teal_hair"]').checked = true;
  app.document.querySelector('[data-tag-id="sekai_uniform"]').checked = true;
  app.document.querySelector('[data-include-series]').checked = false;
  app.document.querySelector('[data-character-action="features"]').click();
  assert.deepEqual(app.calls.select[1], ['miku', { generalTagIds: ['teal_hair'], specificTagIds: ['sekai_uniform'], includeSeries: false, includeAdult: false }]);
  assert.equal(app.calls.changed, 2);

  app.document.querySelector('[data-character-copy="features"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.calls.copy.at(-1), 'hatsune_miku_\\(vocaloid\\), teal hair, sekai uniform');
  app.dom.window.close();
});

test('detail copies identity with all general appearance traits without hidden specific traits', async () => {
  const app = fixture();
  app.view.render({ query: '', precision: 'standard', includeAdult: false });
  app.document.querySelector('[data-character-id="miku"]').click();
  assert.equal(app.document.querySelectorAll('[data-character-copy]').length, 3);
  assert.ok(app.document.querySelector('[data-character-copy="appearance"]'), 'new appearance copy button is missing');
  assert.deepEqual([...app.document.querySelectorAll('.character-actions button')].map(button => button.dataset.characterCopy || button.dataset.characterAction), ['identity', 'appearance', 'features', 'identity', 'features']);
  assert.match(app.document.querySelector('[data-character-copy="appearance"]').className, /character-copy-action/);
  app.document.querySelector('[data-character-copy="appearance"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.calls.copy.at(-1), 'hatsune_miku_\\(vocaloid\\), vocaloid, teal hair');
  app.dom.window.close();
});

test('empty, loading error, and English labels remain usable', () => {
  const empty = fixture({ locale: 'en-US', characters: { page: options => ({ items: [], total: 0, offset: options.offset, limit: options.limit, hasMore: false }) } });
  empty.view.render({ query: 'missing', precision: 'broad', includeAdult: false });
  assert.match(empty.document.querySelector('#characterList').textContent, /No matching characters/);
  assert.match(empty.document.querySelector('#characterPage').textContent, /Page 1/);
  assert.equal(empty.document.querySelector('.characters-toolbar h2').textContent, 'Character library');
  assert.equal(empty.document.querySelector('label[for="characterSeriesQuery"]').textContent, 'Search works');
  assert.equal(empty.document.querySelector('#characterSeriesQuery').placeholder, 'Type a work or source');
  empty.dom.window.close();

  const failed = fixture({ characters: { page: () => { throw new Error('broken data'); } } });
  const result = failed.view.render({ query: '', precision: 'standard', includeAdult: false });
  assert.match(failed.document.querySelector('#characterList').textContent, /broken data/);
  assert.equal(result.error, 'broken data');
  failed.dom.window.close();
});

test('changing the adult setting reloads an open detail with the new visibility', () => {
  let includeAdult = null;
  const app = fixture({ characters: {
    get(id, options) {
      includeAdult = options.includeAdult;
      return { id, name: 'test', aliases: [], identityTags: ['test'], generalTags: [], specificTags: options.includeAdult ? [{ id: 'adult', en: 'adult trait', category: 'other', nsfw: true }] : [], hasFeatures: options.includeAdult };
    }
  } });
  app.view.render({ query: '', precision: 'standard', includeAdult: true });
  app.document.querySelector('[data-character-id="miku"]').click();
  assert.match(app.document.querySelector('#characterDetail').textContent, /adult trait/);
  app.view.render({ query: '', precision: 'standard', includeAdult: false });
  assert.equal(includeAdult, false);
  assert.doesNotMatch(app.document.querySelector('#characterDetail').textContent, /adult trait/);
  app.dom.window.close();
});

test('locale refresh redraws an open detail and preserves checked traits', () => {
  const app = fixture();
  app.view.render({ query: '', precision: 'standard', includeAdult: false });
  app.document.querySelector('[data-character-id="miku"]').click();
  app.document.querySelector('[data-tag-id="teal_hair"]').checked = true;
  assert.equal(app.document.querySelector('.character-trait-category').textContent, '头发');

  app.setLocale('en-US');
  app.view.render({ query: '', precision: 'standard', includeAdult: false });
  assert.match(app.document.querySelector('#characterDetail').textContent, /General traits/);
  assert.equal(app.document.querySelector('.character-trait-category').textContent, 'Hair');
  assert.equal(app.document.querySelector('[data-tag-id="teal_hair"]').checked, true);
  app.dom.window.close();
});

function appFixture(options = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'src/index.html'), 'utf8'), { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  const copied = [];
  window.navigator.clipboard = { writeText: async value => { copied.push(value); } };
  const tagState = { query: 'ordinary draft', category: 'all', precision: 'standard', includeAdult: options.includeAdult === true };
  const normalSelected = options.duplicateIdentity
    ? [{ id: 'blue_hair', en: 'blue_hair', category: 'hair' }, { id: 'rem_(re:zero)', en: 'rem_(re:zero)', category: 'character_names' }]
    : [{ id: 'blue_hair', en: 'blue_hair', category: 'hair' }];
  const tags = {
    restore() {}, setSearchPrecision(value) { tagState.precision = value; }, setAdult(value) { tagState.includeAdult = value; }, setQuery(value) { tagState.query = value; }, setCategory(value) { tagState.category = value; },
    stateSnapshot: () => ({ categories: [{ id: 'character', name: '人物与角色', icon: '👥' }, { id: 'character_names', name: '角色名', icon: '🏷️' }, { id: 'body', name: '身体', icon: '🧍' }], categoryCounts: { all: 2, character: 1, character_names: 1, body: 1 }, selected: normalSelected, query: tagState.query, category: tagState.category, search: tagState.precision, searchPrecision: tagState.precision, includeAdult: tagState.includeAdult, revision: 1 }),
    selected: () => normalSelected, selectedText: () => normalSelected.map(item => item.en).join(', '), page: () => options.roleSearch ? ({ items: [options.roleSearch], total: 1 }) : ({ items: [], total: 0 }), size: () => 2, subcategories: () => [], customTags: () => [], clearSelection() {}, select() {}
  };
  let characterSelected = [{ id: 'miku', name: 'hatsune_miku', tags: options.duplicateIdentity ? ['blue hair', 'rem_\\(re:zero\\)'] : ['blue hair', 'hatsune_miku_\\(vocaloid\\)', ...(tagState.includeAdult ? ['adult trait'] : [])] }];
  const characters = {
    page: options => ({ items: [], total: 0, offset: options.offset, limit: options.limit, hasMore: false }), series: () => [], get: () => null, select: () => {},
    selected: ({ includeAdult } = {}) => characterSelected.map(item => ({ ...item, tags: includeAdult ? item.tags : item.tags.filter(tag => tag !== 'adult trait') })), count: () => 34122, size: () => characterSelected.length, selectionText: () => 'blue hair, hatsune_miku_\\(vocaloid\\)',
    removeSelection: id => { characterSelected = characterSelected.filter(item => item.id !== id); }, clearSelection: () => { characterSelected = []; },
    ...options.characters
  };
  const preferences = { get: (_key, fallback) => fallback, set() {} };
  const modules = { tags, characters: options.withoutCharacters ? null : characters, preferences, locales: { 'zh-CN': {}, 'en-US': {} }, version: '1.4.198', assistant: { getSettings: () => ({}), refreshCapabilities: async () => ({}) }, prompts: {}, images: {}, translation: {}, comfy: {} };
  for (const file of ['views/characters-view.js', 'app-view.js']) window.eval(source(file));
  const view = window.AppView.create(modules, window.document);
  view.start();
  return { dom, window, document: window.document, view, copied, tagState };
}

test('app sidebar replaces character names with an indented character library route', () => {
  const app = appFixture();
  const categories = [...app.document.querySelectorAll('#catList > button')];
  const characterIndex = categories.findIndex(node => node.dataset.cat === 'character');
  assert.equal(categories[1].dataset.characters, 'true');
  assert.match(categories[1].textContent, /角色库/);
  assert.equal(categories[1].querySelector('.n')?.textContent, '34122');
  assert.equal(app.document.querySelector('[data-cat="character_names"]'), null);
  categories[1].click();
  assert.equal(app.document.querySelectorAll('#catList > .on').length, 1);
  assert.equal(app.document.querySelector('#charactersView').hidden, false);
  assert.equal(app.document.querySelector('#tagLibraryView').style.display, 'none');
  app.dom.window.close();
});

test('ordinary search result for a character exposes a shortcut to the character library', () => {
  const app = appFixture({ roleSearch: { id: 'hatsune_miku', en: 'hatsune_miku', zh: '初音未来', category: 'character_names', subcategory: '角色名' }, characters: { get: id => ({ id, name: 'hatsune_miku', nameZh: '初音未来', aliases: [], identityTags: ['hatsune miku', 'vocaloid'], generalTags: [], specificTags: [] }) } });
  app.view.route('tags');
  app.document.querySelector('#q').value = '初音未来';
  app.document.querySelector('#searchBtn').click();
  const jump = app.document.querySelector('[data-character-jump]');
  assert.ok(jump);
  assert.equal(jump.dataset.characterJump, 'hatsune_miku');
  jump.click();
  assert.equal(app.document.querySelector('#charactersView').hidden, false);
  assert.equal(app.document.querySelector('#q').value, 'hatsune_miku');
  assert.equal(app.view.views.characters.getState().detail, 'hatsune_miku');
  assert.match(app.document.querySelector('#characterDetail').textContent, /初音未来/);
  app.dom.window.close();
});

test('app keeps the legacy character names category when the character module is unavailable', () => {
  const app = appFixture({ withoutCharacters: true });
  assert.ok(app.document.querySelector('[data-cat="character_names"]'));
  assert.equal(app.document.querySelector('[data-characters]'), null);
  app.dom.window.close();
});

test('character route scopes header search and combines independent selections', async () => {
  const app = appFixture();
  app.document.querySelector('[data-characters]').click();
  const input = app.document.querySelector('#q');
  input.value = 'miku';
  input.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(app.tagState.query, 'ordinary draft');

  assert.equal(app.document.querySelector('#selCount').textContent, '2');
  assert.equal(app.document.querySelectorAll('[data-remove-character]').length, 1);
  app.document.querySelector('#copyAll').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.copied.at(-1), 'blue_hair, hatsune_miku_\\(vocaloid\\)');

  app.document.querySelector('[data-remove-character="miku"]').click();
  assert.equal(app.document.querySelectorAll('[data-remove-character]').length, 0);
  app.dom.window.close();
});

test('pending role search cannot overwrite ordinary search when switching through AI', async () => {
  const app = appFixture();
  app.document.querySelector('[data-characters]').click();
  const input = app.document.querySelector('#q');
  input.value = 'miku';
  input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  app.view.route('ai');
  await new Promise(resolve => setTimeout(resolve, 160));
  assert.equal(app.tagState.query, 'ordinary draft');
  app.view.route('tags');
  assert.equal(input.value, 'ordinary draft');
  app.view.route('characters');
  assert.equal(input.value, 'miku');
  app.dom.window.close();
});

test('ordinary tag typing keeps the sidebar DOM stable instead of rebuilding categories', async () => {
  const app = appFixture();
  app.view.route('tags');
  const firstCategory = app.document.querySelector('#catList > button');
  const input = app.document.querySelector('#q');
  input.value = 'blue';
  input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 160));
  assert.equal(app.document.querySelector('#catList > button'), firstCategory);
  app.dom.window.close();
});

test('adult toggle immediately removes hidden character traits from the bottom preview', () => {
  const app = appFixture({ includeAdult: true });
  assert.match(app.document.querySelector('#preview').textContent, /adult trait/);
  app.document.querySelector('#nsfwBtn').click();
  assert.equal(app.tagState.includeAdult, false);
  assert.doesNotMatch(app.document.querySelector('#preview').textContent, /adult trait/);
  app.dom.window.close();
});

test('combined copy deduplicates literal qualifier parentheses and keeps the escaped role form', async () => {
  const app = appFixture({ duplicateIdentity: true });
  app.document.querySelector('#copyAll').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.copied.at(-1), 'blue_hair, rem_\\(re:zero\\)');
  app.dom.window.close();
});
