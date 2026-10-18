'use strict';

(function installCharactersView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.characters = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFactory() {
  const PAGE_SIZE = 50;
  const text = (value, fallback = '') => value == null || value === '' ? fallback : String(value);

  const translations = {
    'zh-CN': {
      library: '角色库', searchSeries: '搜索作品', seriesPlaceholder: '输入作品 / 来源',
      allSeries: '全部作品', noMatch: '没有匹配的角色', loading: '正在加载角色资料…', loadError: '角色资料加载失败',
      page: ({ current, total }) => `第 ${current} / ${total} 页`, prev: '上一页', next: '下一页',
      choose: '未选择角色', aliases: '别名', identity: '身份触发词', work: '作品 / 来源',
      includeWork: '加入作品词', general: '通用特征', specific: '角色专用特征', noFeatures: '该角色暂无参考特征',
      review: '待复核', addIdentity: '加入角色', addFeatures: '加入角色与所选特征', copyIdentity: '仅复制角色名',
      copyAppearance: '复制角色与外貌词', copyFeatures: '复制角色与所选词', copied: '已复制角色词', copyFailed: '复制失败，请检查剪贴板权限', added: '已加入角色', edit: '编辑角色', editTag: '编辑 Tag', favorite: '收藏', saveEdit: '保存修改', cancelEdit: '取消', restore: '恢复默认', modified: '已修改'
    },
    'en-US': {
      library: 'Character library', searchSeries: 'Search works', seriesPlaceholder: 'Type a work or source',
      allSeries: 'All works', noMatch: 'No matching characters', loading: 'Loading character data…', loadError: 'Failed to load character data',
      page: ({ current, total }) => `Page ${current} of ${total}`, prev: 'Previous', next: 'Next',
      choose: 'No character selected', aliases: 'Aliases', identity: 'Identity tags', work: 'Work / source',
      includeWork: 'Include work tag', general: 'General traits', specific: 'Character-specific traits', noFeatures: 'No reference traits for this character',
      review: 'Needs review', addIdentity: 'Add character', addFeatures: 'Add character with selected traits', copyIdentity: 'Copy character name only',
      copyAppearance: 'Copy character with appearance', copyFeatures: 'Copy character with selected tags', copied: 'Character tags copied', copyFailed: 'Clipboard access failed', added: 'Character added', edit: 'Edit character', editTag: 'Edit Tag', favorite: 'Favorite', saveEdit: 'Save changes', cancelEdit: 'Cancel', restore: 'Restore default', modified: 'Modified'
    }
  };
  const categoryLabels = {
    'zh-CN': { quality: '质量词', negative: '负面提示词', character: '人物与角色', character_names: '角色名', series: '作品系列', body: '身材与身体', expression: '表情', eyes: '眼睛', hair: '头发', features: '角色特征', outfit: '服装', footwear: '鞋袜', accessory: '道具与装饰', pose: '动作与姿势', scene: '场景与环境', camera: '视角与镜头', style: '画风与风格', time_weather: '时间与天气', atmosphere: '氛围与光影', effects: '特效与魔法', food: '食物与饮料', animal: '动物', other: '其他', rating: '内容分级', nsfw: '成人标签', character_specific: '角色专用特征' },
    'en-US': { quality: 'Quality', negative: 'Negative prompt', character: 'Character', character_names: 'Character names', series: 'Series', body: 'Body', expression: 'Expression', eyes: 'Eyes', hair: 'Hair', features: 'Features', outfit: 'Outfit', footwear: 'Footwear', accessory: 'Accessories', pose: 'Pose', scene: 'Scene', camera: 'Camera', style: 'Style', time_weather: 'Time & weather', atmosphere: 'Atmosphere & light', effects: 'Effects & magic', food: 'Food & drinks', animal: 'Animals', other: 'Other', rating: 'Rating', nsfw: 'Adult', character_specific: 'Character-specific traits' }
  };


  // Shared presentation for the character and Tag Group browsers; no catalog state.
  function collectionNode(document, tag, className, value) {
    const node = document.createElement(tag); node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }
  function createCollectionRow(document, { title, subtitle = '', meta = '', count = 0, active = false }) {
    const row = collectionNode(document, 'button', 'character-row' + (active ? ' on' : '')); row.type = 'button';
    const names = collectionNode(document, 'span', 'character-row-names');
    names.append(collectionNode(document, 'b', '', title));
    if (subtitle) names.append(collectionNode(document, 'span', '', subtitle));
    const info = collectionNode(document, 'span', 'character-row-meta');
    info.append(collectionNode(document, 'span', '', meta), collectionNode(document, 'small', '', count));
    row.append(names, info); return row;
  }
  function createCollectionHeading(document, { title, subtitle = '', actions = [] }) {
    const heading = collectionNode(document, 'div', 'character-detail-head tag-actions-parent');
    const names = collectionNode(document, 'div', 'character-detail-title');
    names.append(collectionNode(document, 'h3', '', title));
    if (subtitle) names.append(collectionNode(document, 'div', 'character-name-zh', subtitle));
    const buttons = collectionNode(document, 'div', 'tag-actions'); buttons.append(...actions);
    heading.append(names, buttons); return heading;
  }
  function createCollectionMember(document, { title, subtitle = '', checked = true, selectionLabel, copyLabel, onCopy, actions = [] }) {
    const row = collectionNode(document, 'div', 'character-trait tag-actions-parent');
    const choice = collectionNode(document, 'label', 'character-trait-choice');
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked;
    input.setAttribute('aria-label', selectionLabel || title); choice.append(input);
    const words = collectionNode(document, onCopy ? 'button' : 'span', 'character-trait-text');
    words.append(collectionNode(document, 'b', '', title));
    if (subtitle) words.append(collectionNode(document, 'span', '', subtitle));
    if (onCopy) {
      words.type = 'button'; words.title = copyLabel || title;
      words.onclick = event => { event.preventDefault(); event.stopPropagation(); onCopy(); };
      row.append(choice, words);
    } else { choice.append(words); row.append(choice); }
    const buttons = collectionNode(document, 'span', 'tag-actions'); buttons.append(...actions); row.append(buttons);
    return { row, input, words, actions: buttons };
  }

  function createCharactersView({ document, characters, tags, catalog, tagEditor, createTagReferenceButton, favoriteTag, favoriteBundle, onChange, copy, notify, getLocale } = {}) {
    const doc = document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
    let relationshipDirty = false, relationshipBusy = false;
    let loading = false, disposed = false;
    const listeners = [];
    const state = { query: '', includeAdult: false, seriesId: '', seriesQuery: '', offset: 0, detail: null, locale: '', bound: false };
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
      const heading = q('#charactersView .characters-toolbar h2'); if (heading) heading.textContent = label('library');
      const seriesLabel = q('label[for="characterSeriesQuery"]'); if (seriesLabel) seriesLabel.textContent = label('searchSeries');
      const seriesQuery = q('#characterSeriesQuery'); if (seriesQuery) seriesQuery.placeholder = label('seriesPlaceholder');
      const view = q('#charactersView'); if (view) view.setAttribute('aria-label', label('library'));
    }

    function renderSeries() {
      const select = q('#characterSeries');
      if (!select) return [];
      let rows = [];
      try { rows = characters?.series?.({ query: state.seriesQuery, includeAdult: state.includeAdult, limit: 100 }) || []; } catch { rows = []; }
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
      if (!withFeatures) options.includeSeries = false;
      return characters.copyText(state.detail.id, options);
    }

    function appendValueList(host, values, emptyText = '') {
      const row = element('div', 'character-tag-values');
      (values || []).forEach(value => {
        const tag = element('span', 'character-tag-value', value);
        if (createTagReferenceButton) tag.append(createTagReferenceButton(value));
        row.appendChild(tag);
      });
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
          const edit = element('button', 'tag-action-button'); edit.type = 'button'; edit.dataset.characterTagEdit = text(item.id || item.en); edit.title = label('editTag'); edit.setAttribute('aria-label', edit.title);
          edit.innerHTML = '<svg class="workspace-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="../assets/icons/favorites.svg#pencil"></use></svg>';
          edit.onclick = event => { event.preventDefault(); showTagEditor(item); };
          const actions = [edit];
          if (createTagReferenceButton) actions.push(createTagReferenceButton(item.content || item.en || item.id));
          const member = createCollectionMember(doc, { title: text(item.en || item.id), subtitle: item.zh, actions });
          const { row: line, input, words } = member;
          input.dataset.tagId = text(item.id || item.en); input.dataset.traitKind = kind;
          if (item.review) words.appendChild(element('small', 'character-review', label('review')));
          group.appendChild(line);
        });
        section.appendChild(group);
      });
      return section;
    }

    function removeEditPanel() { q('[data-character-edit-panel]')?.remove(); relationshipDirty = false; }
    function requestClose() {
      if (relationshipBusy || relationshipDirty) { notify?.(locale() === 'en-US' ? 'Save or cancel the relationship changes first' : '请先保存或取消角色关系修改'); return false; }
      removeEditPanel(); return true;
    }
    async function showTagEditor(item) {
      if (!await requestClose()) return false;
      return tagEditor?.open({ tagId: item.id });
    }
    function showCharacterEditor(record) {
      if (relationshipDirty || relationshipBusy) return;
      removeEditPanel();
      const host = q('#characterDetail'); if (!host || !catalog) return;
      const links = catalog.getCharacterLinks(record.id), draft = {};
      const panel = element('form', 'character-edit-panel'); panel.dataset.characterEditPanel = 'relationships';
      panel.appendChild(element('h4', '', locale() === 'en-US' ? 'Character relationships' : '角色关系'));
      const identity = element('button', 'btn btn-secondary', label('identity')); identity.type = 'button'; identity.dataset.characterIdentityEdit = record.identityTagId;
      identity.onclick = () => showTagEditor({ id: record.identityTagId }); panel.append(identity);
      for (const [field, title] of [['seriesTagIds', label('work')], ['generalTagIds', label('general')], ['specificTagIds', label('specific')]]) {
        draft[field] = new Set(links[field]);
        const section = element('section', 'character-relation-field'); section.dataset.characterRelation = field;
        const heading = element('h5', '', title), search = element('input'); search.type = 'search'; search.placeholder = title; search.setAttribute('aria-label', title);
        const selected = element('div'), choices = element('div'); section.append(heading, search, selected, choices); panel.append(section);
        function renderSelected() {
          selected.replaceChildren();
          for (const id of draft[field]) {
            const tag = catalog.getTag(id);
            const button = element('button', 'btn btn-secondary', tag?.displayName || tag?.content || id); button.type = 'button'; button.dataset.relationRemove = id;
            button.onclick = () => { draft[field].delete(id); relationshipDirty = true; renderSelected(); renderChoices(); }; selected.append(button);
          }
        }
        function renderChoices() {
          choices.replaceChildren();
          const rows = catalog.search(search.value, { scope: 'all', includeAdult: state.includeAdult, limit: 40 }).items;
          for (const tag of rows.filter(row => row.kind === 'tag' && !draft[field].has(row.id))) {
            const button = element('button', 'btn btn-secondary', tag.displayName || tag.content); button.type = 'button'; button.dataset.relationAdd = tag.id;
            button.title = tag.content;
            button.onclick = () => { draft[field].add(tag.id); relationshipDirty = true; renderSelected(); renderChoices(); }; choices.append(button);
          }
        }
        search.oninput = renderChoices; renderSelected(); renderChoices();
      }
      const status = element('p'); status.setAttribute('role', 'alert'); const save = element('button', 'btn btn-primary', label('saveEdit')); save.type = 'submit';
      const cancel = element('button', 'btn btn-secondary', label('cancelEdit')); cancel.type = 'button'; cancel.dataset.characterRelationCancel = ''; cancel.onclick = () => { if (!relationshipBusy) removeEditPanel(); };
      panel.append(status, save, cancel);
      panel.onsubmit = async event => {
        event.preventDefault(); if (relationshipBusy) return; relationshipBusy = true;
        panel.querySelectorAll('button,input').forEach(node => { node.disabled = true; });
        let result; try { result = await characters.edit(record.id, { links: { ...links, ...Object.fromEntries(Object.entries(draft).map(([key, values]) => [key, [...values]])) } }); } catch { result = { ok: false }; }
        relationshipBusy = false;
        if (result?.ok) { removeEditPanel(); openCharacter(record.id); render(); }
        else { status.textContent = result?.error?.message || '保存失败'; panel.querySelectorAll('button,input').forEach(node => { node.disabled = false; }); }
      };
      host.append(panel); panel.querySelector('input')?.focus();
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
      const editButton = element('button', 'character-detail-edit tag-action-button'); editButton.type = 'button'; editButton.dataset.characterEdit = record.id; editButton.title = label('edit'); editButton.onclick = () => showCharacterEditor(record);
      editButton.setAttribute('aria-label', label('edit'));
      editButton.innerHTML = '<svg class="workspace-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="../assets/icons/favorites.svg#pencil"></use></svg>';
      const isFavorite = Boolean(catalog?.getTag?.(record.identityTagId)?.favorite);
      const favoriteButton = element('button', 'character-detail-favorite favorite-toggle tag-action-button'); favoriteButton.type = 'button';
      const star = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); star.classList.add('workspace-icon'); star.setAttribute('aria-hidden', 'true'); star.setAttribute('viewBox', '0 0 24 24');
      const use = doc.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '../assets/icons/workspace.svg#star'); star.append(use); favoriteButton.append(star);
      favoriteButton.classList.toggle('is-favorite', isFavorite); favoriteButton.setAttribute('aria-pressed', String(isFavorite));
      favoriteButton.title = isFavorite ? (locale() === 'en-US' ? 'Remove favorite' : '取消收藏') : label('favorite'); favoriteButton.setAttribute('aria-label', favoriteButton.title);
      favoriteButton.onclick = async () => {
        if (!requestClose()) return;
        const withTraits = selectedTraitIds('general').length || selectedTraitIds('specific').length;
        const result = withTraits && !catalog?.getTag?.(record.identityTagId)?.favorite ? await favoriteBundle?.(copyText(true), record.nameZh || record.name) : await favoriteTag?.(record.identityTagId);
        if (result !== false) notify?.(label('favorite'));
      };
      const heading = createCollectionHeading(doc, { title: text(record.name, record.id), subtitle: record.nameZh, actions: [editButton, favoriteButton] });
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
      const copySpecs = [
        ['identity', label('copyIdentity'), () => copyText(false)],
        ['features', label('copyFeatures'), () => copyText(true)]
      ];
      copySpecs.forEach(([mode, value, getValue]) => {
        const button = element('button', `abtn character-copy-action character-copy-${mode} btn btn-secondary`, value);
        button.type = 'button';
        button.dataset.characterCopy = mode;
        button.onclick = async () => {
          const ok = await copy?.(getValue());
          notify?.(ok === false ? label('copyFailed') : label('copied'));
        };
        actions.appendChild(button);
      });
      host.appendChild(actions);
    }

    function openCharacter(id) {
      if (relationshipBusy || relationshipDirty) return null;
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
      const preservedSelection = state.detail ? selectionOptions(true) : null;
      const searchChanged = options.query != null && text(options.query).trim() !== state.query;
      const adultChanged = options.includeAdult != null && Boolean(options.includeAdult) !== state.includeAdult;
      if (options.query != null) state.query = text(options.query).trim();
      if (options.includeAdult != null) state.includeAdult = Boolean(options.includeAdult);
      state.locale = nextLocale;
      if (searchChanged || adultChanged) state.offset = 0;
      const openDetailId = state.detail?.id;
      renderChrome();
      const host = q('#characterList');
      const status = characters?.status?.();
      if (status && !status.ready) {
        host?.replaceChildren(element('div', status.error ? 'character-error' : 'character-empty',
          status.error ? `${label('loadError')}: ${status.error}` : label('loading')));
        if (!loading && !status.error) {
          loading = true;
          Promise.resolve(characters.ready()).then(() => {
            if (!disposed) render();
          }).catch(error => {
            if (!disposed) host?.replaceChildren(element('div', 'character-error', `${label('loadError')}: ${text(error?.message || error)}`));
          }).finally(() => { loading = false; });
        }
        return { items: [], total: 0, loading: !status.error, error: status.error };
      }
      renderSeries();
      let page;
      try {
        page = characters?.page?.({ query: state.query, seriesId: state.seriesId, offset: state.offset, limit: PAGE_SIZE, includeAdult: state.includeAdult }) || { items: [], total: 0, offset: state.offset, limit: PAGE_SIZE, hasMore: false };
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
        const wrap = element('div', 'character-row-wrap');
        const button = createCollectionRow(doc, { title: text(item.name, item.id), subtitle: item.nameZh, meta: text(item.seriesName, '-'), count: Number(item.count) || 0, active: state.detail?.id === item.id });
        button.dataset.characterId = text(item.id);
        button.onclick = () => {
          if (!requestClose()) return;
          openCharacter(item.id);
          host?.querySelectorAll?.('.character-row').forEach(row => row.classList.toggle('on', row === button));
        };
        wrap.appendChild(button); host?.appendChild(wrap);
      });
      const count = q('#characterCount'); if (count) count.textContent = String(Number(page.total) || 0);
      updatePaging(page);
      if (openDetailId && !q('[data-character-edit-panel]')) {
        openCharacter(openDetailId);
        if (preservedSelection) {
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

    function listen(selector, type, handler) {
      const node = q(selector); node?.addEventListener(type, handler); listeners.push(() => node?.removeEventListener(type, handler));
    }
    function bind() {
      if (state.bound) return;
      state.bound = true;
      listen('#characterSeriesQuery', 'input', event => { state.seriesQuery = text(event.target.value).trim(); renderSeries(); });
      listen('#characterSeries', 'change', event => { state.seriesId = text(event.target.value); state.offset = 0; render(); });
      listen('#characterPrev', 'click', () => { if (state.offset <= 0) return; state.offset = Math.max(0, state.offset - PAGE_SIZE); render(); });
      listen('#characterNext', 'click', () => { state.offset += PAGE_SIZE; render(); });
    }

    function resetSearch() {
      state.query = '';
      state.offset = 0;
      return render();
    }

    bind();
    renderDetail(null);
    return { requestClose, dispose() { disposed = true; listeners.splice(0).forEach(remove => remove()); removeEditPanel(); }, render, refresh: () => render(), resetSearch, openCharacter, getState: () => ({ ...state, detail: state.detail?.id || null }) };
  }

  return { createCharactersView, createCollectionRow, createCollectionHeading, createCollectionMember };
});
