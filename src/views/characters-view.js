'use strict';

(function installCharactersView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.characters = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFactory() {
  const PAGE_SIZE = 50;
  const text = (value, fallback = '') => value == null || value === '' ? fallback : String(value);
  const escapePrompt = value => text(value).replace(/\\([()])/g, '$1').replace(/[()]/g, '\\$&');

  const translations = {
    'zh-CN': {
      library: '角色库', searchSeries: '搜索作品', seriesPlaceholder: '输入作品 / 来源',
      allSeries: '全部作品', noMatch: '没有匹配的角色', loadError: '角色资料加载失败',
      page: ({ current, total }) => `第 ${current} / ${total} 页`, prev: '上一页', next: '下一页',
      choose: '未选择角色', aliases: '别名', identity: '身份触发词', work: '作品 / 来源',
      includeWork: '加入作品词', general: '通用特征', specific: '角色专用特征', noFeatures: '该角色暂无参考特征',
      review: '待复核', addIdentity: '加入角色', addFeatures: '加入角色与所选特征', copyIdentity: '复制角色词',
      copyFeatures: '复制角色与所选特征', copied: '已复制角色词', copyFailed: '复制失败，请检查剪贴板权限', added: '已加入角色'
    },
    'en-US': {
      library: 'Character library', searchSeries: 'Search works', seriesPlaceholder: 'Type a work or source',
      allSeries: 'All works', noMatch: 'No matching characters', loadError: 'Failed to load character data',
      page: ({ current, total }) => `Page ${current} of ${total}`, prev: 'Previous page', next: 'Next page',
      choose: 'No character selected', aliases: 'Aliases', identity: 'Identity tags', work: 'Work / source',
      includeWork: 'Include work tag', general: 'General traits', specific: 'Character-specific traits', noFeatures: 'No reference traits for this character',
      review: 'Needs review', addIdentity: 'Add character', addFeatures: 'Add character with selected traits', copyIdentity: 'Copy character tags',
      copyFeatures: 'Copy character with selected traits', copied: 'Character tags copied', copyFailed: 'Clipboard access failed', added: 'Character added'
    }
  };
  const categoryLabels = {
    'zh-CN': { quality: '质量词', negative: '负面提示词', character: '人物与角色', character_names: '角色名', series: '作品系列', body: '身材与身体', expression: '表情', eyes: '眼睛', hair: '头发', features: '角色特征', outfit: '服装', footwear: '鞋袜', accessory: '道具与装饰', pose: '动作与姿势', scene: '场景与环境', camera: '视角与镜头', style: '画风与风格', time_weather: '时间与天气', atmosphere: '氛围与光影', effects: '特效与魔法', food: '食物与饮料', animal: '动物', other: '其他', rating: '内容分级', nsfw: '成人标签', character_specific: '角色专用特征' },
    'en-US': { quality: 'Quality', negative: 'Negative prompt', character: 'Character', character_names: 'Character names', series: 'Series', body: 'Body', expression: 'Expression', eyes: 'Eyes', hair: 'Hair', features: 'Features', outfit: 'Outfit', footwear: 'Footwear', accessory: 'Accessories', pose: 'Pose', scene: 'Scene', camera: 'Camera', style: 'Style', time_weather: 'Time & weather', atmosphere: 'Atmosphere & light', effects: 'Effects & magic', food: 'Food & drinks', animal: 'Animals', other: 'Other', rating: 'Rating', nsfw: 'Adult', character_specific: 'Character-specific traits' }
  };

  function createCharactersView({ document, characters, onChange, copy, notify, getLocale } = {}) {
    const doc = document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
    const state = { query: '', precision: 'standard', includeAdult: false, seriesId: '', seriesQuery: '', offset: 0, detail: null, locale: '', bound: false };
    const q = selector => doc?.querySelector?.(selector);
    const locale = () => getLocale?.() === 'en-US' ? 'en-US' : 'zh-CN';
    const label = (key, values) => {
      const value = translations[locale()][key] ?? translations['zh-CN'][key] ?? key;
      return typeof value === 'function' ? value(values || {}) : value;
    };
    const categoryLabel = id => categoryLabels[locale()][text(id)] || categoryLabels[locale()].other;
    const element = (tag, className, value) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (value != null) node.textContent = text(value);
      return node;
    };

    function renderChrome() {
      const heading = q('.characters-toolbar h2'); if (heading) heading.textContent = label('library');
      const seriesLabel = q('label[for="characterSeriesQuery"]'); if (seriesLabel) seriesLabel.textContent = label('searchSeries');
      const seriesQuery = q('#characterSeriesQuery'); if (seriesQuery) seriesQuery.placeholder = label('seriesPlaceholder');
      const view = q('#charactersView'); if (view) view.setAttribute('aria-label', label('library'));
    }

    function renderSeries() {
      const select = q('#characterSeries');
      if (!select) return [];
      let rows = [];
      try { rows = characters?.series?.({ query: state.seriesQuery, limit: 100 }) || []; } catch { rows = []; }
      select.replaceChildren();
      const all = element('option', '', label('allSeries'));
      all.value = '';
      select.appendChild(all);
      rows.forEach(item => {
        const option = element('option', '', `${text(item.name, item.id)} (${Number(item.count) || 0})`);
        option.value = text(item.id);
        select.appendChild(option);
      });
      if ([...select.options].some(option => option.value === state.seriesId)) select.value = state.seriesId;
      else if (state.seriesId) {
        const selected = element('option', '', state.seriesId);
        selected.value = state.seriesId;
        select.appendChild(selected);
        select.value = state.seriesId;
      }
      return rows;
    }

    function selectedTraitIds(kind) {
      return [...(q('#characterDetail')?.querySelectorAll?.(`input[data-trait-kind="${kind}"][data-tag-id]:checked`) || [])]
        .map(input => input.dataset.tagId)
        .filter(Boolean);
    }

    function selectionOptions(withFeatures) {
      return {
        generalTagIds: withFeatures ? selectedTraitIds('general') : [],
        specificTagIds: withFeatures ? selectedTraitIds('specific') : [],
        includeSeries: q('[data-include-series]')?.checked !== false,
        includeAdult: state.includeAdult
      };
    }

    function copyText(withFeatures) {
      if (!state.detail) return '';
      const options = selectionOptions(withFeatures);
      const general = new Set(options.generalTagIds);
      const specific = new Set(options.specificTagIds);
      const identityTags = state.detail.identityTags || [];
      const values = options.includeSeries ? [...identityTags] : identityTags.slice(0, 1);
      if (withFeatures) {
        (state.detail.generalTags || []).forEach(item => { if (general.has(text(item.id))) values.push(text(item.en || item.id)); });
        (state.detail.specificTags || []).forEach(item => { if (specific.has(text(item.id))) values.push(text(item.en || item.id)); });
      }
      return values.filter(Boolean).map(escapePrompt).join(', ');
    }

    function appendValueList(host, values, emptyText = '') {
      const row = element('div', 'character-tag-values');
      (values || []).forEach(value => row.appendChild(element('span', 'character-tag-value', value)));
      if (!row.childElementCount && emptyText) row.appendChild(element('span', 'character-muted', emptyText));
      host.appendChild(row);
    }

    function traitSection(title, items, kind) {
      const section = element('section', 'character-trait-section');
      section.appendChild(element('h4', '', title));
      const groups = new Map();
      (items || []).forEach(item => {
        const key = categoryLabel(item.category);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      });
      groups.forEach((rows, category) => {
        const group = element('div', 'character-trait-group');
        group.appendChild(element('div', 'character-trait-category', category));
        rows.forEach(item => {
          const line = element('label', 'character-trait');
          const input = doc.createElement('input');
          input.type = 'checkbox';
          input.dataset.tagId = text(item.id || item.en);
          input.dataset.traitKind = kind;
          const words = element('span', 'character-trait-text');
          words.appendChild(element('b', '', text(item.en || item.id)));
          if (item.zh) words.appendChild(element('span', '', item.zh));
          if (item.review) words.appendChild(element('small', 'character-review', label('review')));
          line.append(input, words);
          group.appendChild(line);
        });
        section.appendChild(group);
      });
      return section;
    }

    function renderDetail(record) {
      const host = q('#characterDetail');
      if (!host) return;
      host.replaceChildren();
      state.detail = record || null;
      if (!record) {
        host.appendChild(element('div', 'character-detail-empty', label('choose')));
        return;
      }
      const heading = element('div', 'character-detail-head');
      const titleWrap = element('div', 'character-detail-title');
      titleWrap.appendChild(element('h3', '', text(record.name, record.id)));
      if (record.nameZh) titleWrap.appendChild(element('div', 'character-name-zh', record.nameZh));
      heading.appendChild(titleWrap);
      host.appendChild(heading);

      const meta = element('div', 'character-meta');
      const seriesLabel = element('label', 'character-series-option');
      const includeSeries = doc.createElement('input');
      includeSeries.type = 'checkbox';
      includeSeries.checked = true;
      includeSeries.dataset.includeSeries = 'true';
      seriesLabel.append(includeSeries, element('span', '', `${label('includeWork')}: ${text(record.seriesName, '-')}`));
      meta.appendChild(seriesLabel);
      if ((record.aliases || []).length) {
        const aliases = element('div', 'character-meta-row');
        aliases.append(element('b', '', label('aliases')), element('span', '', record.aliases.join(' / ')));
        meta.appendChild(aliases);
      }
      host.appendChild(meta);

      const identity = element('section', 'character-identity');
      identity.appendChild(element('h4', '', label('identity')));
      appendValueList(identity, record.identityTags || []);
      host.appendChild(identity);

      const general = record.generalTags || [];
      const specific = record.specificTags || [];
      if (general.length) host.appendChild(traitSection(label('general'), general, 'general'));
      if (specific.length) host.appendChild(traitSection(label('specific'), specific, 'specific'));
      if (!general.length && !specific.length) host.appendChild(element('div', 'character-no-features', label('noFeatures')));

      const actions = element('div', 'character-actions');
      const actionSpecs = [
        ['identity', label('addIdentity'), 'abtn pri btn btn-primary'],
        ['features', label('addFeatures'), 'abtn btn btn-secondary']
      ];
      actionSpecs.forEach(([action, value, className]) => {
        const button = element('button', className, value);
        button.type = 'button';
        button.dataset.characterAction = action;
        button.onclick = () => {
          characters?.select?.(record.id, selectionOptions(action === 'features'));
          onChange?.();
          notify?.(label('added'));
        };
        actions.appendChild(button);
      });
      [['identity', label('copyIdentity')], ['features', label('copyFeatures')]].forEach(([mode, value]) => {
        const button = element('button', 'abtn ghost btn btn-ghost', value);
        button.type = 'button';
        button.dataset.characterCopy = mode;
        button.onclick = async () => {
          const ok = await copy?.(copyText(mode === 'features'));
          notify?.(ok === false ? label('copyFailed') : label('copied'));
        };
        actions.appendChild(button);
      });
      host.appendChild(actions);
    }

    function openCharacter(id) {
      try {
        const record = characters?.get?.(id, { includeAdult: state.includeAdult });
        renderDetail(record);
        return record;
      } catch (error) {
        renderDetail(null);
        const host = q('#characterDetail');
        host?.replaceChildren(element('div', 'character-error', `${label('loadError')}: ${text(error?.message || error)}`));
        return null;
      }
    }

    function render(options = {}) {
      const nextLocale = locale();
      const localeChanged = Boolean(state.locale && state.locale !== nextLocale);
      const preservedSelection = localeChanged && state.detail ? selectionOptions(true) : null;
      const searchChanged = options.query != null && text(options.query).trim() !== state.query;
      const precisionChanged = options.precision != null && text(options.precision, 'standard') !== state.precision;
      const adultChanged = options.includeAdult != null && Boolean(options.includeAdult) !== state.includeAdult;
      if (options.query != null) state.query = text(options.query).trim();
      if (options.precision != null) state.precision = ['exact', 'broad'].includes(options.precision) ? options.precision : 'standard';
      if (options.includeAdult != null) state.includeAdult = Boolean(options.includeAdult);
      state.locale = nextLocale;
      if (searchChanged || precisionChanged || adultChanged) state.offset = 0;
      const openDetailId = adultChanged || localeChanged ? state.detail?.id : '';
      renderChrome();
      renderSeries();
      const host = q('#characterList');
      let page;
      try {
        page = characters?.page?.({ query: state.query, seriesId: state.seriesId, precision: state.precision, offset: state.offset, limit: PAGE_SIZE, includeAdult: state.includeAdult }) || { items: [], total: 0, offset: state.offset, limit: PAGE_SIZE, hasMore: false };
      } catch (error) {
        const message = text(error?.message || error, label('loadError'));
        host?.replaceChildren(element('div', 'character-error', `${label('loadError')}: ${message}`));
        const count = q('#characterCount'); if (count) count.textContent = '0';
        updatePaging({ total: 0, hasMore: false });
        return { items: [], total: 0, error: message };
      }
      const rows = page.items || [];
      host?.replaceChildren();
      if (!rows.length) host?.appendChild(element('div', 'character-empty', label('noMatch')));
      rows.forEach(item => {
        const button = element('button', `character-row${state.detail?.id === item.id ? ' on' : ''}`);
        button.type = 'button';
        button.dataset.characterId = text(item.id);
        const names = element('span', 'character-row-names');
        names.appendChild(element('b', '', text(item.name, item.id)));
        if (item.nameZh) names.appendChild(element('span', '', item.nameZh));
        const info = element('span', 'character-row-meta');
        info.appendChild(element('span', '', text(item.seriesName, '-')));
        info.appendChild(element('small', '', String(Number(item.count) || 0)));
        button.append(names, info);
        button.onclick = () => {
          openCharacter(item.id);
          host?.querySelectorAll?.('.character-row').forEach(row => row.classList.toggle('on', row === button));
        };
        host?.appendChild(button);
      });
      const count = q('#characterCount'); if (count) count.textContent = String(Number(page.total) || 0);
      updatePaging(page);
      if (openDetailId) {
        openCharacter(openDetailId);
        if (preservedSelection && !adultChanged) {
          const general = new Set(preservedSelection.generalTagIds);
          const specific = new Set(preservedSelection.specificTagIds);
          const seriesToggle = q('[data-include-series]');
          if (seriesToggle) seriesToggle.checked = preservedSelection.includeSeries;
          q('#characterDetail')?.querySelectorAll?.('input[data-tag-id]').forEach(input => {
            input.checked = (input.dataset.traitKind === 'general' ? general : specific).has(input.dataset.tagId);
          });
        }
      }
      return page;
    }

    function updatePaging(page) {
      const total = Math.max(0, Number(page.total) || 0);
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const current = Math.min(pages, Math.floor(state.offset / PAGE_SIZE) + 1);
      const status = q('#characterPage'); if (status) status.textContent = label('page', { current, total: pages });
      const prev = q('#characterPrev'); if (prev) { prev.textContent = label('prev'); prev.disabled = state.offset <= 0; }
      const next = q('#characterNext'); if (next) { next.textContent = label('next'); next.disabled = !page.hasMore; }
    }

    function bind() {
      if (state.bound) return;
      state.bound = true;
      q('#characterSeriesQuery')?.addEventListener('input', event => { state.seriesQuery = text(event.target.value).trim(); renderSeries(); });
      q('#characterSeries')?.addEventListener('change', event => { state.seriesId = text(event.target.value); state.offset = 0; render(); });
      q('#characterPrev')?.addEventListener('click', () => { if (state.offset <= 0) return; state.offset = Math.max(0, state.offset - PAGE_SIZE); render(); });
      q('#characterNext')?.addEventListener('click', () => { state.offset += PAGE_SIZE; render(); });
    }

    function resetSearch() {
      state.query = '';
      state.offset = 0;
      return render();
    }

    bind();
    renderDetail(null);
    return { render, refresh: () => render(), resetSearch, openCharacter, getState: () => ({ ...state, detail: state.detail?.id || null }) };
  }

  return { createCharactersView };
});
