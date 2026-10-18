'use strict';
(function (root) {
  function createPromptView({ document: doc = root.document, notify, download, confirm } = {}) {
    const host = root.AppModules;
    const formatting = import('/页/工具定义.js');
    let request = '主AI', selected = '', book = '', epoch = 0, built = false, dirty = false;
    let preset, state, books, effective, enabledBusy = false, mode = 'book', pendingWrites = 0, loading = false;
    let readonlyReminderTimer;
    const workspaces = new Map(), drafts = new Map();
    const openSections = new Set(['model']);
    const viewedRequests = new Set();
    const q = selector => doc.querySelector(selector);
    function el(tag, text, props = {}) { const node = doc.createElement(tag); if (text) node.textContent = text; Object.assign(node, props); return node; }
    function button(text, action, disabled = false, id = '') {
      const node = el('button', text, { type: 'button', className: 'btn btn-secondary', disabled, id });
      node.onclick = async () => {
        if (pendingWrites || enabledBusy || loading) return;
        node.disabled = true;
        try { await action(); } catch (error) { status(error.message, true); } finally { node.disabled = disabled; }
      }; return node;
    }
    function status(text, error = false) { q('#promptStatus').textContent = text; q('#promptStatus').dataset.error = String(error); if (error) notify?.(text); }
    async function call(module, action, params = {}) {
      const result = await host.调(module, action, params);
      if (result?.ok === false) throw new Error(result.reason);
      return result;
    }
    function syncNavigation() {
      for (const node of doc.querySelectorAll('#promptLibrary button, #promptQuickActions button, #promptBookSelect, #promptPresetSelect, #promptEditPreset')) node.disabled = pendingWrites > 0 || enabledBusy || loading;
    }
    async function write(module, action, params) {
      pendingWrites++; syncNavigation();
      try { const result = await call(module, action, params); await call(module, '存'); return result; }
      finally { pendingWrites--; syncNavigation(); }
    }
    const draftKey = () => `${request}/${mode}/${mode === 'book' ? book : selected}`;
    function rememberEditor() {
      const editor = q('#promptEditor'); if (!editor) return;
      const inputs = [...editor.querySelectorAll('[data-draft-key]')].filter(node => node.dataset.unsaved === 'true');
      const values = inputs.filter(node => !node.closest('[data-tool-name]')).map(node => [node.dataset.draftKey, node.value]);
      const opened = [...editor.querySelectorAll('details[data-entry-id]')].filter(node => node.open).map(node => node.dataset.entryId);
      drafts.set(draftKey(), { values, opened });
      if (request === '主AI' && editor.querySelector('[data-tool-name]')) drafts.set('tools/' + selected, {
        values: inputs.filter(node => node.closest('[data-tool-name]')).map(node => [node.dataset.draftKey, node.value]),
        opened: [...editor.querySelectorAll('details[data-tool-name][open]')].map(node => node.dataset.toolName),
      });
    }
    function restoreEditor() {
      const draft = drafts.get(draftKey()), toolDraft = request === '主AI' ? drafts.get('tools/' + selected) : undefined; dirty = false;
      for (const [key, value] of [...(draft?.values || []), ...(toolDraft?.values || [])]) {
        const node = [...q('#promptEditor').querySelectorAll('[data-draft-key]')].find(node => node.dataset.draftKey === key);
        if (!node || node.readOnly) continue;
        node.value = value; node.dataset.unsaved = 'true'; node.oninput?.(); dirty = true;
      }
      if (draft) for (const row of q('#promptEditor').querySelectorAll('details[data-entry-id]')) row.open = draft.opened.includes(row.dataset.entryId);
      if (toolDraft) for (const row of q('#promptEditor').querySelectorAll('details[data-tool-name]')) row.open = toolDraft.opened.includes(row.dataset.toolName);
      syncBookExpand();
      if (dirty) status('有未保存的编辑 · 已保留本模块草稿');
    }
    function syncBookExpand() {
      const control = q('#promptBookExpand'), list = q('#promptBookEditor');
      if (!control || !list) return;
      const rows = [...list.querySelectorAll(':scope > details')].filter(row => !row.hidden);
      const expanded = rows.length > 0 && rows.every(row => row.open);
      control.textContent = expanded ? '全部收起' : '全部展开';
      control.dataset.expanded = String(expanded);
    }
    function clearDraft(container = q('#promptEditor')) {
      for (const node of container.querySelectorAll('[data-draft-key]')) delete node.dataset.unsaved;
      drafts.delete(draftKey()); drafts.delete('tools/' + selected); dirty = !!q('#promptEditor').querySelector('[data-unsaved="true"]');
    }
    async function switchRequest(next) {
      if (pendingWrites || enabledBusy || loading || next === request) return;
      rememberEditor(); workspaces.set(request, { selected, book, mode });
      request = next; const previous = workspaces.get(next);
      selected = previous?.selected || ''; book = previous?.book || ''; mode = previous?.mode || 'book'; dirty = false;
      await refresh(false, !previous);
    }
    async function editBook(id) { if (pendingWrites || enabledBusy || loading) return; rememberEditor(); book = id; mode = 'book'; dirty = false; await refresh(false); }
    async function editPreset(section) {
      if (pendingWrites || enabledBusy || loading) return;
      rememberEditor(); mode = 'preset'; dirty = false;
      if (section) openSections.add(section);
      await refresh(false);
      if (section) q(`[data-prompt-section="${section}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    function area(id, label, value, readonly, rows = 6, hint = '') {
      const box = el('label', '', { className: 'prompt-field' }); box.append(el('span', label)); if (hint) box.append(el('small', hint));
      const input = el('textarea', '', { id, rows, value: value || '', readOnly: readonly });
      if (id) input.dataset.draftKey = id;
      if (!readonly) input.oninput = () => { input.dataset.unsaved = 'true'; dirty = true; status('有未保存的编辑'); };
      box.append(input); return box;
    }
    function fold(title, note = '', open = false) {
      const item = el('details', '', { className: 'prompt-entry', open });
      const summary = el('summary', '', { className: 'prompt-entry-header' });
      summary.append(el('span', '', { className: 'prompt-chevron', ariaHidden: 'true' }), el('span', title, { className: 'prompt-entry-title', title }), el('span', note, { className: 'prompt-entry-note', title: note }));
      const body = el('div', '', { className: 'prompt-entry-body' }); item.append(summary, body);
      return { item, summary, body };
    }
    function listToolbar(list, { searchId = '', placeholder = '', expandId = '', collapseId = '' } = {}) {
      const bar = el('div', '', { className: 'prompt-list-toolbar' });
      const count = el('span', '', { className: 'prompt-list-count', role: 'status' });
      const rows = () => [...list.querySelectorAll(':scope > details')];
      const update = () => { const all = rows(); count.textContent = `${all.filter(row => !row.hidden).length} / ${all.length} 条`; };
      if (searchId) {
        const search = el('input', '', { id: searchId, type: 'search', placeholder, ariaLabel: placeholder });
        search.oninput = () => { const term = search.value.trim().toLocaleLowerCase(); for (const row of rows()) row.hidden = !row.dataset.search.includes(term); update(); syncBookExpand(); };
        bar.append(search);
      }
      if (collapseId) {
        bar.append(button('全部展开', () => { for (const row of rows()) if (!row.hidden) row.open = true; }, false, expandId), button('全部收起', () => { for (const row of rows()) if (!row.hidden) row.open = false; }, false, collapseId));
      } else {
        const expand = button('全部展开', () => {
          const opening = rows().some(row => !row.hidden && !row.open);
          for (const row of rows()) if (!row.hidden) row.open = opening;
          syncBookExpand();
        }, false, expandId);
        for (const row of rows()) row.addEventListener('toggle', syncBookExpand);
        bar.append(expand);
      }
      bar.append(count);
      update(); return bar;
    }
    function toggle(item, summary, enabled, readonly, label, save, changed) {
      const input = el('input', '', { type: 'checkbox', className: 'prompt-toggle', checked: enabled, disabled: readonly, role: 'switch', ariaLabel: label, title: label });
      item.dataset.enabled = String(enabled);
      input.onclick = event => event.stopPropagation();
      input.onchange = async () => {
        if (pendingWrites || enabledBusy) { input.checked = enabled; return; }
        const version = epoch, next = input.checked; input.disabled = true;
        try {
          await save(next); enabled = next; item.dataset.enabled = String(next); changed?.(next);
          if (version === epoch) status(`${label}已${next ? '启用' : '停用'}${dirty ? '；正文编辑尚未保存' : ''}`);
        } catch (error) { input.checked = enabled; if (version === epoch) status(error.message, true); }
        finally { input.disabled = readonly; }
      };
      summary.insertBefore(input, summary.children[1]); return input;
    }
    function enabledFor() { return new Set(books.启用.map(row => row.标识)); }
    async function changeEnabled(scope, id, active) {
      if (enabledBusy || pendingWrites || loading || !id) return;
      const version = epoch;
      const next = enabledFor();
      if (active) next.add(id); else next.delete(id);
      enabledBusy = true; renderEnabledBooks(); syncNavigation();
      try {
        await write('worldbook', '书', { 动作: '换', 请求: scope, 启用: [...next] });
        books.启用 = [...next].map(标识 => ({ 标识 }));
        if (version === epoch) status('世界书启用列表已保存 · 「' + scope + '」已' + (active ? '启用' : '停用') + bookName(id) + (dirty ? '；正文编辑尚未保存' : ''));
      } catch (error) { if (version === epoch) status(error.message, true); }
      finally { enabledBusy = false; renderEnabledBooks(); syncNavigation(); }
    }
    function bookLabel(row) { return row.是本子 ? `内置${row.名字}世界书（只读）` : row.名字; }
    function bookName(id) { const row = books.表.find(row => row.标识 === id); return row ? bookLabel(row) : id; }
    function remindReadonlyBook() {
      const message = '内置世界书为只读，不能直接修改。请点击“复制并新建”，或新建、导入自己的世界书后编辑。';
      status(message); notify?.(message);
      const copy = q('#promptBookCopy'); if (!copy) return;
      copy.scrollIntoView({ block: 'nearest' });
      clearTimeout(readonlyReminderTimer); copy.classList.remove('prompt-copy-attention');
      void copy.offsetWidth; copy.classList.add('prompt-copy-attention');
      readonlyReminderTimer = setTimeout(() => copy.classList.remove('prompt-copy-attention'), 1800);
    }
    function readonlyBookField(node) {
      node.dataset.readonlyBookField = ''; node.tabIndex = 0;
      node.onclick = event => { event.stopPropagation(); if (node.classList.contains('prompt-readonly-control')) event.preventDefault(); remindReadonlyBook(); };
      node.onkeydown = event => {
        if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(event.key))) {
          event.preventDefault(); remindReadonlyBook();
        }
      };
      node.onbeforeinput = node.onpaste = node.ondrop = event => { event.preventDefault(); remindReadonlyBook(); };
      return node;
    }
    function renderEnabledBooks() {
      const open = q('#promptBookPicker')?.open || false;
      const container = q('#promptEnabledBooks'); container.replaceChildren(); container.append(el('label', '选择启用书 · ' + request));
      const ids = enabledFor();
      const chips = el('div', '', { className: 'prompt-enabled-chips' }); chips.dataset.enabledRequest = request;
      for (const id of ids) {
        const chip = el('span', '', { className: 'prompt-enabled-chip' }); chip.dataset.enabledBook = id;
        const remove = button('×', () => changeEnabled(request, id, false), enabledBusy); remove.dataset.removeBook = id; remove.setAttribute('aria-label', '从「' + request + '」移除' + bookName(id));
        chip.append(remove, el('span', bookName(id))); chips.append(chip);
      }
      if (!ids.size) chips.append(el('span', '本模块未启用世界书', { className: 'prompt-enabled-empty' }));
      const picker = el('details', '', { id: 'promptBookPicker', className: 'prompt-book-picker', open });
      const summary = el('summary', '选择启用书', { title: '选择启用的世界书', ariaLabel: '选择启用的世界书' }); summary.dataset.openBookPicker = ''; picker.append(summary);
      const choices = el('div', '', { id: 'promptEnableChoices', className: 'prompt-enable-choices' });
      choices.append(el('strong', '用于「' + request + '」请求 · 可多选'));
      for (const row of books.表) {
        const label = el('label', '', { className: 'prompt-enable-choice' }); label.dataset.bookChoice = row.标识;
        const input = el('input', '', { type: 'checkbox', checked: ids.has(row.标识), disabled: enabledBusy }); input.dataset.bookChoice = row.标识;
        const scope = request; input.onchange = () => changeEnabled(scope, row.标识, input.checked); label.append(input, el('span', bookLabel(row))); choices.append(label);
      }
      if (!books.表.length) choices.append(el('small', '本模块还没有世界书，请先新建或导入。'));
      picker.append(choices); chips.append(picker); container.append(chips);
    }
    function renderBookSelection() {
      const container = q('#promptBookSelection'); container.replaceChildren();
      const label = el('label', '当前编辑世界书', { htmlFor: 'promptBookSelect' });
      const select = el('select', '', { id: 'promptBookSelect' });
      select.append(el('option', '选择本模块的世界书', { value: '' }));
      for (const row of books.表) select.append(el('option', bookLabel(row), { value: row.标识 }));
      select.value = book; select.onchange = () => editBook(select.value).catch(error => status(error.message, true));
      container.append(label, select, el('div', '', { id: 'promptBookActions', className: 'prompt-book-actions' }));
    }
    function renderLibrary() {
      const left = q('#promptLibrary'); left.replaceChildren(); left.append(el('h3', '模块世界书'));
      for (const name of new Set(['主AI', ...Object.keys(books.默认启用)])) {
        const item = button(name === '主AI' ? '主 AI' : name, () => switchRequest(name)); item.dataset.promptRequest = name;
        item.classList.add('prompt-module'); item.setAttribute('aria-pressed', String(request === name));
        left.append(item);
      }
      left.append(el('p', '每个模块分别管理书籍与启用状态。', { className: 'prompt-library-note' }));
    }
    function build() {
      if (built) return; built = true;
      const container = q('#tabPrompt'); container.replaceChildren(); container.classList.add('prompt-workspace');
      const header = el('div', '', { className: 'prompt-toolbar prompt-page-heading' }); header.append(el('h2', '世界 / 提示词'), el('span', '', { id: 'promptStatus', role: 'status' }));
      const layout = el('div', '', { className: 'prompt-layout' }), right = el('div', '', { id: 'promptWorkspace', className: 'prompt-module-workspace' });
      const heading = el('div', '', { className: 'prompt-module-heading' }); heading.append(el('h3', '', { id: 'promptModuleTitle' }), el('span', '', { id: 'promptEffective', className: 'prompt-effective' }), el('div', '', { id: 'promptQuickActions', className: 'prompt-toolbar' }));
      const activation = el('div', '', { className: 'prompt-activation-row' }); activation.append(el('section', '', { id: 'promptEnabledBooks', className: 'prompt-enabled-books' }));
      right.append(heading, activation, el('div', '', { id: 'promptBookSelection', className: 'prompt-book-selection' }), el('div', '', { id: 'promptSettingsShell' }), el('section', '', { id: 'promptEditor' }));
      layout.append(el('nav', '', { id: 'promptLibrary', ariaLabel: '模块世界书' }), right); container.append(header, layout);
      doc.addEventListener('click', event => { for (const id of ['promptBookPicker', 'promptActivationSettings', 'promptBookManage']) { const popup = q('#' + id); if (popup?.open && !popup.contains(event.target)) popup.open = false; } });
    }
    async function refresh(remember = true, initial = false) {
      build(); if (remember) rememberEditor(); const version = ++epoch;
      loading = true; syncNavigation(); q('#promptWorkspace').inert = true; q('#promptWorkspace').setAttribute('aria-busy', 'true');
      try { await loadWorkspace(version, initial); }
      catch (error) {
        if (version === epoch) {
          for (const id of ['promptEnabledBooks', 'promptBookSelection', 'promptSettingsShell']) q('#' + id).replaceChildren();
          q('#promptModuleTitle').textContent = request + ' · 读取失败';
          q('#promptEditor').replaceChildren(el('p', error.message, { className: 'prompt-empty' }), button('重新读取本模块', () => refresh(false)));
        }
        throw error;
      }
      finally { if (version === epoch) { loading = false; q('#promptWorkspace').inert = false; q('#promptWorkspace').setAttribute('aria-busy', 'false'); syncNavigation(); } }
    }
    async function loadWorkspace(version, initial) {
      const scope = request;
      const [next, world, active] = await Promise.all([call('主AI', '读', { 请求: scope }), call('worldbook', '读', { 请求: scope }), call('主AI', '执行', { 请求: scope })]);
      if (version !== epoch) return;
      state = next; books = world; effective = active;
      if (initial || !viewedRequests.has(scope)) { book = world.默认启用[scope]?.[0] || ''; viewedRequests.add(scope); }
      if (book && !books.表.some(row => row.标识 === book)) book = '';
      if (!selected || !state.表.some(row => row.标识 === selected)) selected = effective.预设.标识;
      const details = await call('主AI', '读', { 请求: request, 预设: selected });
      if (version !== epoch) return;
      preset = details.预设;
      q('#promptEffective').textContent = request + ' · 当前设置：' + effective.预设.名字;
      q('#promptModuleTitle').textContent = request === '主AI' ? '主 AI · 世界书' : request + ' · 世界书';
      renderLibrary(); renderEnabledBooks(); renderBookSelection(); renderSettings(); renderBookActions(); syncNavigation();
      if (mode === 'preset') await renderPreset();
      else if (book) await renderBook();
      else {
        q('#promptEditor').replaceChildren(el('p', '本模块尚未选择世界书。可以新建、导入，或从上方选择一本进行编辑。', { className: 'prompt-empty' }));
        const toolEditor = el('div', '', { id: 'promptBookEditor' }); renderBookTools(toolEditor, await formatting); q('#promptEditor').append(toolEditor);
        const preview = fold('发送预览', '按本模块实际使用的存档生成'); renderPreview(preview.body); q('#promptEditor').append(preview.item);
      }
      if (version !== epoch) return;
      restoreEditor(); syncNavigation();
    }
    function renderSettings() {
      const quick = q('#promptQuickActions'); quick.replaceChildren();
      if (request === '主AI') quick.append(
        button('程序附加', () => editPreset('runtime'), false, 'promptRuntimeEntry'),
        button('完整发送预览', () => editPreset('preview'), false, 'promptPreviewEntry'));
      const shell = q('#promptSettingsShell'), open = q('#promptActivationSettings')?.open || false; shell.replaceChildren();
      const settings = el('details', '', { id: 'promptActivationSettings', className: 'prompt-activation-settings', open }); settings.append(el('summary', request === '主AI' ? '主 AI 设置 · 模型与工具' : '本模块模型设置'));
      const left = el('div', '', { className: 'prompt-settings-body' }); settings.append(left); shell.append(settings);
      const presetSelect = el('select', '', { id: 'promptPresetSelect' });
      for (const row of state.表) presetSelect.append(el('option', row.名字 + (row.标识 === effective.预设.标识 ? ' · 使用中' : ''), { value: row.标识 })); presetSelect.value = selected;
      presetSelect.onchange = () => { rememberEditor(); selected = presetSelect.value; mode = 'preset'; dirty = false; refresh(false).catch(error => status(error.message, true)); };
      left.append(el('label', '查看设置', { htmlFor: 'promptPresetSelect' }), presetSelect, button(request === '主AI' ? '编辑模型与工具设置' : '编辑模型设置', editPreset, false, 'promptEditPreset'));
      const create = el('details', '', { className: 'prompt-create' }); create.append(el('summary', '＋ 新建 / 导入设置'), el('input', '', { id: 'promptName', placeholder: '设置名称', className: 'wbselect' }));
      create.append(button('新建设置', async () => {
        rememberEditor(); const result = await write('主AI', '预设', { 动作: '新建', 名字: q('#promptName').value || undefined });
        await write('主AI', '预设', { 动作: '换', 请求: request, 启用: [result.标识] });
        selected = result.标识; mode = 'preset'; dirty = false; await refresh(false); status('已新建并启用用户设置');
      }, false, 'promptSetAdd'));
      const importFile = el('input', '', { type: 'file', accept: '.json,application/json', hidden: true });
      importFile.onchange = async () => {
        try { const file = importFile.files[0]; if (!file) return; rememberEditor(); const result = await write('主AI', '预设', { 动作: '导入', 内容: await file.text() }); selected = result.标识; mode = 'preset'; dirty = false; await refresh(false); status('设置已导入，按「设为当前」后生效'); } catch (error) { status(error.message, true); }
      };
      create.append(button('导入设置', () => importFile.click()), importFile); left.append(create);
    }
    async function renderPreset() {
      const id = selected, version = epoch;
      const result = await call('主AI', '读', { 请求: request, 预设: id });
      const format = await formatting;
      if (version !== epoch || mode !== 'preset' || id !== selected) return;
      preset = result.预设;
      const readonly = preset.是本子; const right = q('#promptEditor'); right.replaceChildren();
      function runtimeOverrides() {
        const values = { ...preset.runtime };
        for (const input of q('#promptEditor').querySelectorAll('[data-runtime-key]')) {
          const key = input.dataset.runtimeKey;
          if (input.value === format.默认附加文本[key]) delete values[key];
          else values[key] = input.value;
        }
        return values;
      }
      const heading = el('div', '', { className: 'prompt-editor-heading' });
      const title = el('div'); title.append(el('h3', preset.名字), el('small', `${readonly ? '默认设置 · 只读' : '用户设置'}${effective.预设.标识 === selected ? ' · 使用中' : ' · 仅查看'}`, { className: 'prompt-heading-note' })); heading.append(title);
      const toolbar = el('div', '', { className: 'prompt-toolbar' });
      toolbar.append(button('返回世界书', () => editBook(book), false, 'promptBackToBook'));
      const save = button('保存', async () => {
        await write('主AI', '预设', { 动作: '改', 预设: selected, model: { ...preset.model, 走: q('#promptModelLink').value.trim(), 模型: q('#promptModelName').value.trim() }, ...(request === '主AI' ? { runtime: runtimeOverrides() } : {}) });
        clearDraft(q('[data-prompt-section="model"]').parentElement); if (q('#promptRuntime')) clearDraft(q('#promptRuntime'));
        await refresh(); status('设置已保存');
      }, readonly, 'promptSave'); save.hidden = readonly; save.classList.add('prompt-primary'); toolbar.append(save);
      const use = button('设为当前', async () => {
        await write('主AI', '预设', { 动作: '换', 请求: request, 启用: [selected] }); await refresh(); status('当前请求已切换设置');
      }, effective.预设.标识 === selected, 'promptUse'); use.hidden = effective.预设.标识 === selected; toolbar.append(use);
      const copy = button(readonly ? '复制并编辑' : '复制', async () => {
        const result = await write('主AI', '预设', { 动作: '复制', 源: selected }); rememberEditor(); selected = result.标识; await refresh(false); status('设置已复制，按「设为当前」后生效');
      }); if (readonly) copy.classList.add('prompt-primary'); toolbar.append(copy);
      const manage = el('details', '', { className: 'prompt-manage' }); manage.append(el('summary', '更多 ···'));
      const menu = el('div', '', { className: 'prompt-manage-menu' }); manage.append(menu);
      menu.append(button('导出模型与工具设置', async () => { const result = await call('主AI', '预设', { 动作: '导出', 预设: selected }); download?.(`${preset.名字}.json`, result.内容); }));
      menu.append(button('放弃编辑', async () => { clearDraft(); await refresh(); status('已重新读取存档'); }), el('input', '', { placeholder: '新名称', className: 'promptRename', disabled: readonly }), button('改名', async () => {
        await write('主AI', '预设', { 动作: '改名', 预设: selected, 名字: q('.promptRename').value }); await refresh(); status('设置已改名');
      }, readonly), button('删除设置', () => new Promise(resolve => {
        confirm(`删除设置「${preset.名字}」？`, async () => {
          try { await write('主AI', '预设', { 动作: '删', 预设: selected }); selected = ''; dirty = false; await refresh(); status('设置已删除'); } catch (error) { status(error.message, true); } finally { resolve(); }
        });
      }), readonly));
      toolbar.append(manage); heading.append(toolbar); right.append(heading);
      const sections = el('div', '', { className: 'prompt-section-list' });
      function addSection(key, title, note = '') {
        const { item, summary, body } = fold(title, note, openSections.has(key)); item.classList.add('prompt-section');
        summary.dataset.promptSection = key;
        item.ontoggle = () => { if (item.open) openSections.add(key); else openSections.delete(key); };
        sections.append(item); return body;
      }
      const model = addSection('model', '模型', preset.model.模型 || '跟随 API 页');
      model.append(el('p', '留空时使用 API 页第一条链路的模型。'));
      for (const [id, label, key] of [['promptModelLink', 'API 链路标识', '走'], ['promptModelName', '模型型号', '模型']]) {
        const field = el('label', '', { className: 'prompt-field' }); const input = el('input', '', { id, value: preset.model[key] || '', disabled: readonly, placeholder: '跟随 API 页' }); input.dataset.draftKey = id;
        input.oninput = () => { input.dataset.unsaved = 'true'; dirty = true; status('有未保存的编辑'); }; field.append(el('span', label), input); model.append(field);
      }
      if (request === '主AI') {
      const tools = addSection('tools', '工具注册表', `${preset.工具表.length} 个工具`); tools.classList.add('prompt-tool-list');
      tools.previousElementSibling.id = 'promptToolsEntry';
      renderTools(tools, id, readonly, format);
      const runtime = addSection('runtime', '程序附加'); runtime.id = 'promptRuntime';
      runtime.append(el('p', '随图片附带的说明文本。{图号}、{名称} 对应图片。文本可以修改或清空，保存设置后生效。'));
      for (const [key, value] of Object.entries(format.默认附加文本)) {
        const field = area('', key, Object.hasOwn(preset.runtime || {}, key) ? preset.runtime[key] : value, readonly, 2);
        const input = field.querySelector('textarea'); input.dataset.runtimeKey = key; input.dataset.draftKey = 'runtime/' + key; runtime.append(field);
      }
      const runtimeSave = button('保存程序附加', async () => {
        await write('主AI', '预设', { 动作: '改', 预设: selected, runtime: runtimeOverrides() }); clearDraft(runtime); await refresh(); status('程序附加已保存');
      }, readonly, 'promptRuntimeSave'); runtimeSave.hidden = readonly; runtime.append(runtimeSave);
      }
      renderPreview(addSection('preview', '发送预览'));
      right.append(sections);
    }
    function renderBookTools(editor, format) {
      if (request !== '主AI') return;
      const { item, summary, body } = fold('工具注册表', preset.工具表.length + ' 个工具 · ' + preset.名字, openSections.has('tools'));
      summary.id = 'promptToolsEntry'; summary.dataset.promptSection = 'tools';
      item.dataset.search = ('工具注册表 ' + preset.名字 + ' ' + JSON.stringify(preset.工具表)).toLocaleLowerCase();
      item.ontoggle = () => { if (item.open) openSections.add('tools'); else openSections.delete('tools'); };
      body.append(el('p', '工具设置：' + preset.名字 + (preset.是本子 ? ' · 默认只读' : ' · 用户设置') + (selected === effective.预设.标识 ? ' · 使用中' : ' · 仅查看')));
      const actions = el('div', '', { className: 'prompt-toolbar' });
      if (preset.是本子) actions.append(button('复制工具设置并编辑', async () => {
        const result = await write('主AI', '预设', { 动作: '复制', 源: selected }); rememberEditor(); selected = result.标识; await refresh(false); status('工具设置已复制，按「设为当前」后生效');
      }));
      if (selected !== effective.预设.标识) actions.append(button('设为当前', async () => {
        await write('主AI', '预设', { 动作: '换', 请求: request, 启用: [selected] }); await refresh(); status('当前请求已切换设置');
      }));
      actions.append(button('管理工具与模型设置', () => editPreset('tools'))); body.append(actions);
      renderTools(body, selected, preset.是本子, format); editor.append(item);
    }
    function renderTools(tools, id, readonly, format) {
      const toolCount = el('h3');
      const updateToolCount = () => { toolCount.textContent = `${preset.工具表.filter(row => row.启用 !== false).length} 个启用 / ${preset.工具表.length} 个工具`; };
      updateToolCount();
      tools.append(toolCount, el('p', readonly ? '默认工具表由宿主的业务定义生成。展开可查看标题、参数说明和完整注册定义；复制设置后可修改。' : '开关立即保存。标题与各级参数说明可以自由修改或清空，按「保存工具」生效。'));
      const toolRows = el('div');
      for (const row of preset.工具表) {
        const { item, summary, body } = fold(row.摘要 || '（标题为空）', row.名字); item.dataset.toolName = row.名字; item.dataset.search = `${row.名字} ${row.摘要} ${JSON.stringify(row.参数)}`.toLocaleLowerCase();
        const active = toggle(item, summary, row.启用 !== false, readonly, `工具 ${row.名字}`, next => write('主AI', '工具', { 动作: '改', 预设: id, 名字: row.名字, 启用: next }), next => { row.启用 = next; updateToolCount(); });
        body.append(el('p', `调用标识：${row.名字}`));
        const title = area('', '工具标题与说明', row.摘要, readonly, 4);
        const titleInput = title.querySelector('textarea'); titleInput.dataset.toolSummary = ''; titleInput.dataset.draftKey = row.名字 + '/summary';
        body.append(title);
        const parameterFields = [];
        function parameterField(schema, path, label) {
          if (!schema || typeof schema !== 'object') return;
          const field = area('', '参数说明 · ' + label, schema.description || '', readonly, 2);
          const input = field.querySelector('textarea'); input.dataset.parameterPath = path.join('.'); input.dataset.draftKey = row.名字 + '/parameter/' + JSON.stringify(path);
          parameterFields.push({ path, input }); body.append(field);
          for (const key of ['properties', 'patternProperties', '$defs', 'definitions']) for (const [name, child] of Object.entries(schema[key] || {})) parameterField(child, [...path, key, name], label + ' / ' + name);
          if (schema.items) parameterField(schema.items, [...path, 'items'], label + '[]');
          for (const key of ['oneOf', 'anyOf', 'allOf']) for (const [index, child] of (schema[key] || []).entries()) parameterField(child, [...path, key, index], `${label} / ${key} ${index + 1}`);
          if (schema.additionalProperties && typeof schema.additionalProperties === 'object') parameterField(schema.additionalProperties, [...path, 'additionalProperties'], label + ' / 其他字段');
        }
        for (const [name, schema] of Object.entries(row.参数)) parameterField(schema, [name], name);
        const definition = el('details'); definition.append(el('summary', '实际注册定义（JSON）'), area('', '工具名、完整说明与参数结构', JSON.stringify(format.模型工具(format.工具声明(row)), null, 2), true, 12));
        body.append(button('保存工具', async () => {
          const parameters = structuredClone(row.参数);
          for (const { path, input } of parameterFields) {
            let schema = parameters; for (const key of path) schema = schema[key]; schema.description = input.value;
          }
          const descriptions = Object.fromEntries(Object.entries(parameters).filter(([, schema]) => typeof schema.description === 'string').map(([name, schema]) => [name, schema.description]));
          await write('主AI', '工具', { 动作: '改', 预设: selected, 名字: row.名字, 启用: active.checked, 摘要: titleInput.value, 参数: parameters, 说明: descriptions }); clearDraft(body); await refresh(); status('工具已保存');
        }, readonly), definition); toolRows.append(item);
      }
      tools.append(listToolbar(toolRows, { searchId: 'promptToolSearch', placeholder: '搜索工具名称、用途或参数' }), toolRows);
      tools.append(button('恢复默认工具文本与开关', async () => { await write('主AI', '工具', { 动作: '重置', 预设: selected }); clearDraft(tools); await refresh(); status('工具表已保存'); }, readonly));
    }
    function renderPreview(right) {
      const preview = el('section', '', { className: 'prompt-preview' }); preview.append(el('h3', '发送素材预览'), el('p', `按「${request}」实际使用的存档生成，与正在查看的设置分别标明。${request === '主AI' ? '展示系统正文、全部工具注册定义、聊天历史、本轮输入及工具回执中的文字；图片字节用占位表示。未保存的编辑不参与预览。' : '副请求使用本请求的世界书和模型设置。调用方还会提供当次任务的输入及格式要求。'} 世界书的前、后进入系统消息，按深度作为 user 内容追加；其余落点尚未装配。`));
      const input = el('textarea', '', { id: 'promptTestInput', rows: 3, placeholder: '本轮输入，用来测试世界书命中' });
      preview.append(input, button('按存档生成预览', async () => {
        const version = epoch, previewRequest = request;
        if (previewRequest === '主AI') {
          const material = await call('prompt', '预览', { 会话: host.assistant.currentId(), 文本: input.value });
          if (version !== epoch) return;
          q('#promptSystemPreview').value = material.系统消息;
          q('#promptDepthPreview').value = material.按深度追加.map(row => row.文本).join('\n\n');
          q('#promptToolsPreview').value = JSON.stringify(material.工具定义, null, 2);
          q('#promptMessagesPreview').value = JSON.stringify(material.消息, null, 2);
          q('#promptPreviewPreset').textContent = `实际使用：${material.使用预设.名字} · ${material.工具表.length} 个工具`;
          q('#psPrimaryPreview').value = JSON.stringify({ 请求: previewRequest, ...material }, null, 2);
          return;
        }
        const compiled = await call('主AI', '执行', { 请求: previewRequest });
        const hit = await call('worldbook', '执行', { 请求: previewRequest, 文本: input.value });
        const sections = [];
        for (const position of ['前', '后']) for (const row of hit.命中.filter(row => row.落点 === position)) sections.push({ 名称: `世界书 · ${row.书} · ${position}`, 正文: row.文本 });
        if (version !== epoch) return;
        const system = sections.map(row => row.正文).filter(Boolean).join('\n\n');
        q('#promptSystemPreview').value = system;
        q('#promptDepthPreview').value = hit.命中.filter(row => row.落点 === '按深度').map(row => row.文本).join('\n\n');
        q('#promptPreviewPreset').textContent = `实际使用：${compiled.预设.名字} · 不发送主 AI 工具`;
        q('#psPrimaryPreview').value = JSON.stringify({ 请求: previewRequest, 使用预设: compiled.预设, 系统消息: system, 系统分段: sections, 按深度追加: hit.命中.filter(row => row.落点 === '按深度'), 世界书命中: hit.命中, 模型: compiled.模型 }, null, 2);
      }), el('p', '', { id: 'promptPreviewPreset' }), area('promptSystemPreview', request === '主AI' ? '完整系统消息' : '本请求世界书贡献的系统内容', '', true, 18), area('promptDepthPreview', '按深度追加的内容', '', true, 5));
      if (request === '主AI') preview.append(area('promptToolsPreview', '全部工具注册定义 · tools', '', true, 14), area('promptMessagesPreview', '聊天历史、本轮输入与工具回执 · messages', '', true, 14));
      const raw = el('details'); raw.append(el('summary', '查看全部分段与工具定义 JSON'), area('psPrimaryPreview', '完整素材', '', true, 18)); preview.append(raw); right.append(preview);
    }
    function renderBookActions() {
      const id = book, current = books.表.find(row => row.标识 === id), readonly = !current || current.是本子, isDefault = current?.是本子 === true;
      const toolbar = q('#promptBookActions'); toolbar.replaceChildren();
      const menu = el('details', '', { id: 'promptBookManage', className: 'prompt-book-manage' });
      menu.append(el('summary', '书籍管理'));
      const actions = el('div', '', { className: 'prompt-book-manage-menu' }); menu.append(actions);
      const action = (label, run, disabled = false, actionId = '') => button(label, run, disabled, actionId);
      actions.append(action('新建世界书', async () => {
        const result = await write('worldbook', '书', { 动作: '新建', 请求: request, 名字: '新世界书' });
        await editBook(result.标识); status('世界书已新建，当前编辑新书；尚未启用');
      }, false, 'promptBookAdd'));
      const importFile = el('input', '', { type: 'file', accept: '.json,application/json', hidden: true }); importFile.dataset.bookImportFile = '';
      importFile.onchange = async () => {
        if (pendingWrites || enabledBusy || loading) return;
        const scope = request; let importedId; pendingWrites++; syncNavigation();
        try {
          const file = importFile.files[0]; if (!file) return;
          const result = await write('worldbook', '书', { 动作: '导入', 请求: scope, 内容: await file.text() });
          importedId = result.标识;
        } catch (error) { status(error.message, true); }
        finally { pendingWrites--; syncNavigation(); importFile.value = ''; }
        if (importedId) { await editBook(importedId); status('世界书已导入本模块，当前编辑导入书；尚未启用'); }
      };
      actions.append(action('导入世界书', () => importFile.click(), false, 'promptBookImport'), importFile);
      if (!readonly) actions.append(action('复制世界书', async () => {
          const exported = await call('worldbook', '书', { 动作: '导出', 标识: id });
          const imported = await write('worldbook', '书', { 动作: '导入', 请求: request, 内容: exported.内容 });
          await editBook(imported.标识); status('世界书副本已创建，当前编辑副本；可在顶部启用');
      }, false, 'promptBookCopy'));
      actions.append(action('导出当前世界书', async () => { const exported = await call('worldbook', '书', { 动作: '导出', 标识: id }); download?.(current.名字 + '.json', exported.内容); }, !current, 'promptBookExport'));
      if (!readonly) actions.append(action('改名', async () => {
        const name = root.prompt('世界书名称', current.名字); if (name === null) return;
        await write('worldbook', '书', { 动作: '改名', 标识: id, 名字: name }); await refresh(); status('世界书已改名');
      }, false, 'promptBookRename'));
      if (!readonly) actions.append(action('删除当前世界书', () => {
        confirm('删除世界书「' + current.名字 + '」？', async () => {
          try { await write('worldbook', '书', { 动作: '删', 标识: id }); clearDraft(); book = ''; mode = 'book'; await refresh(false); status('世界书已删除'); }
          catch (error) { status(error.message, true); }
        });
      }, false, 'promptBookDelete'));
      if (!readonly) actions.append(action('放弃未保存修改并重读', async () => { clearDraft(); await refresh(false); status('已放弃未保存修改并重读存档'); }, false, 'promptBookRefresh'));
      if (isDefault) {
        const copy = action('复制并新建', async () => {
          const exported = await call('worldbook', '书', { 动作: '导出', 标识: id });
          const imported = await write('worldbook', '书', { 动作: '导入', 请求: request, 内容: exported.内容 });
          await editBook(imported.标识); status('世界书副本已创建，当前编辑副本；可在顶部启用');
        }, false, 'promptBookCopy');
        copy.classList.add('prompt-primary'); toolbar.append(copy);
      }
      toolbar.append(menu);
    }
    async function renderBook() {
      const id = book, version = epoch;
      const result = await call('worldbook', '读', { 书: id, 请求: request });
      if (version !== epoch || id !== book) return;
      const format = await formatting;
      if (version !== epoch || id !== book) return;
      const current = result.书, readonly = current.是本子;
      const right = q('#promptEditor'); right.replaceChildren();
      const heading = el('div', '', { className: 'prompt-editor-heading' });
      const title = el('div'); title.append(el('h3', bookLabel(current)), el('small', readonly ? '内置参考内容 · 只读' : '用户世界书 · 条目修改后显式保存', { className: 'prompt-heading-note' }));
      heading.append(title);
      const copy = q('#promptBookCopy');
      right.append(heading);
      if (readonly) {
        const notice = el('aside', '', { id: 'promptBookReadonly', className: 'prompt-readonly-notice', ariaLabel: '内置世界书只读说明' });
        const text = el('div'); text.append(el('strong', '这是内置只读世界书。请新建或导入你自己的世界书后再编辑。'), el('p', '点击“复制并新建”，即可将本书导入为可编辑副本；使用时请在上方选择启用。'));
        notice.append(text); if (copy) notice.append(copy); right.append(notice);
      }
      const editor = el('div', '', { id: 'promptBookEditor' });
      const fields = host.桌().动作表.find(row => row.模块 === 'worldbook' && row.动作 === '条目').参数.find(row => row.名 === '条目').界面.字段;
      const positionField = fields.find(row => row.名 === '落点');
      const positionOptions = positionField.选项 || [];
      const positionLabel = value => positionField.选项显示名?.[value] || value;
      const conditionLabel = value => value ? '一直启用' : '条件启用';
      const placementLabel = value => positionOptions.includes(value) ? positionLabel(value) : `当前不参与发送 · 原落点：${value}`;
      for (const entry of current.条目) {
        const { item: card, summary, body } = fold(entry.label || entry.id, placementLabel(entry.落点)); card.dataset.entryId = entry.id;
        card.dataset.search = `${entry.label} ${entry.id} ${entry.text} ${(entry.keys || []).join(' ')} ${entry.落点}`.toLocaleLowerCase();
        const active = toggle(card, summary, entry.enabled !== false, readonly, `条目 ${entry.label || entry.id}`, next => write('worldbook', '条目', { 动作: '改', 书: id, 标识: entry.id, 条目: { enabled: next } }));
        const strategy = el('select', '', { ariaLabel: '启用方式', disabled: readonly, className: 'prompt-entry-strategy' }); strategy.dataset.entryStrategy = ''; strategy.dataset.draftKey = entry.id + '/strategy';
        strategy.append(el('option', '🔵 一直启用', { value: 'true' }), el('option', '🟢 条件启用', { value: 'false' })); strategy.value = String(entry.always);
        strategy.title = conditionLabel(entry.always); strategy.onclick = event => event.stopPropagation();
        summary.insertBefore(strategy, summary.querySelector('.prompt-entry-note'));
        if (readonly) {
          for (const [control, label] of [[strategy, '启用方式'], [active, '启用开关']]) {
            const wrapper = readonlyBookField(el('span', '', { className: 'prompt-readonly-control', role: 'button', ariaLabel: label + '（只读，点击了解编辑方式）' }));
            control.replaceWith(wrapper); wrapper.append(control);
          }
          const label = el('span', entry.label || entry.id, { className: 'prompt-entry-title' }); label.dataset.entryLabel = '';
          summary.querySelector('.prompt-entry-title').replaceWith(label);
          body.append(readonlyBookField(el('div', `插入位置：${placementLabel(entry.落点)}`, { className: 'prompt-readable' })));
          const condition = area('', '启用条件 · 关键词', (entry.keys || []).join('\n'), true, 2, entry.always ? '一直启用，不检查关键词条件。' : '命中任意一个关键词即启用。');
          const keysInput = readonlyBookField(condition.querySelector('textarea')); keysInput.dataset.entryKeys = ''; keysInput.setAttribute('aria-label', '启用条件 · 关键词（只读）'); body.append(condition);
          const bodyText = readonlyBookField(el('div', entry.text, { className: 'prompt-readable', role: 'textbox', ariaReadOnly: 'true', ariaMultiLine: 'true', ariaLabel: '正文（只读）' })); bodyText.dataset.entryText = ''; body.append(bodyText);
          editor.append(card);
          continue;
        }

        const titleInput = el('input', '', { value: entry.label, ariaLabel: '标题（备注）', placeholder: entry.id, className: 'prompt-entry-title' }); titleInput.dataset.entryLabel = ''; titleInput.dataset.draftKey = entry.id + '/label';
        const position = el('select', '', { ariaLabel: '插入位置' }); position.dataset.entryPosition = ''; position.dataset.draftKey = entry.id + '/position';
        if (!positionOptions.includes(entry.落点)) position.append(el('option', `当前不参与发送 · 原落点：${entry.落点}`, { value: entry.落点, disabled: true }));
        for (const value of positionOptions) position.append(el('option', positionLabel(value), { value })); position.value = entry.落点;
        const titleField = el('label', '', { className: 'prompt-field' }); titleField.append(el('span', '标题（备注）'), titleInput); body.append(titleField);
        const positionField = el('label', '', { className: 'prompt-field' }); positionField.append(el('span', '插入位置'), position); body.append(positionField);
        const meta = area('', '启用条件 · 关键词', (entry.keys || []).join('\n'), false, 2);
        const conditionHint = el('small'); meta.insertBefore(conditionHint, meta.querySelector('textarea'));
        const content = area('', '正文', entry.text, false, 12);
        const textInput = content.querySelector('textarea'), metaInput = meta.querySelector('textarea');
        textInput.dataset.entryText = ''; textInput.dataset.draftKey = entry.id + '/text';
        metaInput.dataset.entryKeys = ''; metaInput.dataset.draftKey = entry.id + '/keys';
        const updateSummary = () => {
          summary.querySelector('.prompt-entry-title').textContent = titleInput.value || entry.id;
          summary.querySelector('.prompt-entry-note').textContent = placementLabel(position.value);
          strategy.title = conditionLabel(strategy.value === 'true');
          card.dataset.search = `${titleInput.value} ${entry.id} ${textInput.value} ${metaInput.value} ${position.value}`.toLocaleLowerCase();
        };
        const markDraft = control => { const node = control?.currentTarget || control; if (!node?.dataset) return; node.dataset.unsaved = 'true'; dirty = true; status('有未保存的条目编辑'); updateSummary(); };
        function updateCondition() { conditionHint.textContent = strategy.value === 'true' ? '一直启用，不检查关键词条件；填写的条件会保留。' : '每行一个关键词，也可用逗号分隔；命中任意一个即启用。'; }
        for (const control of [titleInput, strategy, position, metaInput, textInput]) { control.oninput = () => markDraft(control); control.onchange = () => markDraft(control); }
        strategy.oninput = () => { markDraft(strategy); updateCondition(); };
        strategy.onchange = () => { markDraft(strategy); updateCondition(); card.open = true; if (strategy.value === 'false') metaInput.focus(); };
        updateCondition();
        const save = button('保存条目', async () => {
          const keys = metaInput.value.split(/[,，、;；\n]+/).map(value => value.trim()).filter(Boolean);
          await write('worldbook', '条目', { 动作: '改', 书: id, 标识: entry.id, 条目: { keys, label: titleInput.value, always: strategy.value === 'true', 落点: position.value, text: textInput.value } });
          clearDraft(card); await refresh(); status('条目已保存');
        }); save.dataset.saveEntry = ''; body.append(meta, content, save);
        const remove = button('删除条目', () => {
          confirm(`删除条目「${titleInput.value || entry.id}」？`, async () => {
            try { await write('worldbook', '条目', { 动作: '删', 书: id, 标识: entry.id }); clearDraft(card); await refresh(); status('条目已删除'); }
            catch (error) { status(error.message, true); }
          });
        }); remove.dataset.deleteEntry = ''; body.append(remove); editor.append(card);
      }
      renderBookTools(editor, format);
      if (!current.条目.length) editor.append(el('p', '这本世界书还没有条目。', { className: 'prompt-empty' }));
      const controls = listToolbar(editor, { searchId: 'promptBookSearch', placeholder: '搜索条目标题、正文或关键词', expandId: 'promptBookExpand' });
      if (!readonly) controls.prepend(button('添加条目', async () => { await write('worldbook', '条目', { 动作: '加', 书: id, 条目: { label: '新条目', text: '' } }); await refresh(); status('条目已添加'); }, false, 'promptEntryAdd'));
      editor.prepend(controls);
      const preview = fold('发送预览', '按实际使用的存档生成'); renderPreview(preview.body);
      right.append(editor, preview.item);
    }
    function render() { if (!dirty && !loading) refresh().catch(error => status(error.message, true)); return {}; }
    return { render, bind() { build(); }, snapshot() { return { 请求: request, 预设: selected, 书: book }; } };
  }
  root.AppViews = root.AppViews || {}; root.AppViews.prompt = { createPromptView };
})(typeof globalThis !== 'undefined' ? globalThis : window);
