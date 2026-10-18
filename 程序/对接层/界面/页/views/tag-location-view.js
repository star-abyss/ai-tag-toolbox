'use strict';

(function install(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppViews = root.AppViews || {};
  root.AppViews.tagLocation = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function factory() {
  // Also mirrored in locales/*.json at ui.tagEditor / ui.tagLocation. Standalone
  // script-tag components work before the application locale service is wired.
  const messages = {
    tagEditor: {
      title: ['编辑标签', 'Edit tag'], create: ['新增标签', 'New tag'], kind: ['类型', 'Type'], tag: ['单个标签', 'Single tag'], bundle: ['组合 / Prompt', 'Bundle / Prompt'],
      content: ['内容', 'Content'], displayName: ['显示名称', 'Display name'], aliases: ['别名（每行一个，保留短语）', 'Aliases (one phrase per line)'], note: ['备注（纯文本）', 'Note (plain text)'], adult: ['成人内容', 'Adult content'], searchable: ['允许搜索发现', 'Discoverable in search'],
      save: ['保存', 'Save'], saving: ['正在保存…', 'Saving…'], close: ['取消 / 关闭', 'Cancel / Close'], saved: ['已保存', 'Saved'], restore: ['恢复默认', 'Restore defaults'],
      taxonomy: ['分类位置', 'Category location'], favorite: ['收藏位置', 'Favorite location'], location: ['选择位置', 'Choose location'], unclassified: ['未分类', 'Uncategorized'], membership: ['选择要编辑的收藏归属', 'Choose the favorite membership to edit'],
      shared: ['此标签被 {count} 处引用，保存会同步这些位置。', 'This tag is referenced in {count} places; saving updates them all.'],
      required: ['请输入内容', 'Enter content'], failed: ['保存失败，输入已保留，可重试。', 'Save failed. Your input is preserved; retry saving.'], conflict: ['标签已在其他位置修改，重新加载后再保存', 'The tag was changed elsewhere. Reload before saving.'], reload: ['重新加载', 'Reload'],
      duplicate: ['已有相同内容。请查看已有标签或明确保留独立版本。', 'This content already exists. Inspect the existing tag or explicitly keep an independent version.'], independent: ['另存为独立标签 / 保留独立版本', 'Save / keep an independent version'], inspect: ['查看已有标签', 'Inspect existing tag'], reference: ['收藏此已有标签（使用它的现有资料）', 'Favorite this existing tag (use its current metadata)'],
      invalid: ['字段或位置无效，请检查输入。', 'Check the fields and location.'], duplicateMembership: ['目标组已经收藏此标签，请选择其他位置。', 'This group already contains the tag. Choose another location.'], inUse: ['角色正在引用此标签，不能改为组合。', 'A character references this tag; it cannot become a bundle.'],
      unsaved: ['有未保存修改', 'Unsaved changes'], unsavedText: ['保存修改、放弃修改，还是留在这里？', 'Save changes, discard them, or stay here?'], discard: ['放弃修改', 'Discard changes'], stay: ['留在这里', 'Stay here']
    },
    tagLocation: {
      title: ['选择位置', 'Choose location'], category: ['分类', 'Category'], subcategory: ['子分类', 'Subcategory'], page: ['收藏页', 'Favorite page'], group: ['收藏组', 'Favorite group'],
      choose: ['请选择', 'Choose…'], create: ['新建…', 'Create…'], parentName: ['新父级名称', 'New parent name'], childName: ['新子级名称', 'New child name'], confirm: ['使用此位置', 'Use this location'], cancel: ['取消', 'Cancel'],
      required: ['请选择位置或填写新名称', 'Choose a location or enter a new name'], duplicate: ['已有同名项目：{name}，请选择已有项。', 'An item named {name} already exists; select it instead.']
    }
  };
  function translator(section, getLocale, localize) {
    return (key, values = {}) => {
      const fallback = messages[section][key]?.[getLocale?.() === 'en-US' ? 1 : 0] || key;
      const text = localize?.(`ui.${section}.${key}`, fallback) || fallback;
      return text.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
    };
  }
  let sequence = 0;
  const stacks = new WeakMap();
  function element(document, tag, text) { const node = document.createElement(tag); if (text != null) node.textContent = text; return node; }
  function button(document, text, attr, action) { const node = element(document, 'button', text); node.type = 'button'; if (attr) node.setAttribute(attr, ''); if (action) node.addEventListener('click', action); return node; }
  function createDialogTools(document, kind, onKey) {
    const overlay = element(document, 'div'); overlay.className = `tag-editor-overlay tag-${kind}-overlay`; overlay.setAttribute(`data-tag-${kind}-overlay`, ''); overlay.hidden = true;
    const panel = element(document, 'section'); panel.className = 'tag-editor-dialog'; panel.tabIndex = -1; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
    const title = element(document, 'h2'); title.id = `tag-dialog-title-${++sequence}`; panel.setAttribute('aria-labelledby', title.id); panel.append(title); overlay.append(panel); document.body.append(overlay);
    const stack = stacks.get(document) || []; stacks.set(document, stack); let origin = null; let focusing = false;
    const visible = node => !node.disabled && !node.closest('[hidden]');
    const focusables = () => [...panel.querySelectorAll('button,input,textarea,select,[tabindex="0"]')].filter(visible);
    const top = () => stack.at(-1) === api;
    function focus() { if (focusing) return; focusing = true; try { (focusables()[0] || panel).focus(); } finally { focusing = false; } }
    function keydown(event) {
      if (!top()) return;
      if (event.key === 'Tab') {
        const nodes = focusables(), first = nodes[0], last = nodes.at(-1);
        if (!first) { event.preventDefault(); panel.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
      onKey?.(event);
    }
    function focusin(event) { if (top() && !panel.contains(event.target)) focus(); }
    document.addEventListener('keydown', keydown, true); document.addEventListener('focusin', focusin, true);
    const restack = () => stack.forEach((entry, index) => { entry.overlay.style.zIndex = String(1000 + index); });
    const api = { overlay, panel, title, top, focus,
      open() { if (!overlay.hidden) return; origin = document.activeElement; stack.at(-1)?.panel.setAttribute('aria-hidden', 'true'); stack.push(api); restack(); overlay.hidden = false; panel.removeAttribute('aria-hidden'); focus(); },
      close() { if (overlay.hidden) return; const wasTop = top(); const index = stack.indexOf(api); if (index >= 0) stack.splice(index, 1); overlay.hidden = true; overlay.style.removeProperty('z-index'); restack(); panel.removeAttribute('aria-hidden'); if (wasTop) { stack.at(-1)?.panel.removeAttribute('aria-hidden'); if (origin?.isConnected) origin.focus(); else stack.at(-1)?.focus(); } },
      dispose() { api.close(); document.removeEventListener('keydown', keydown, true); document.removeEventListener('focusin', focusin, true); overlay.remove(); }
    };
    return api;
  }
  function createTagLocationView({ document, catalog, getLocale, localize } = {}) {
    const t = translator('tagLocation', getLocale, localize); let resolver = null, kind = 'taxonomy', membershipId, disposed = false;
    const dialog = createDialogTools(document, 'location', event => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopImmediatePropagation(); finish(null); } });
    const parent = element(document, 'select'), child = element(document, 'select'), parentName = element(document, 'input'), childName = element(document, 'input');
    const labels = {};
    for (const [key, node] of Object.entries({ parent, child, 'parent-name': parentName, 'child-name': childName })) { node.setAttribute(`data-location-${key}`, ''); const label = element(document, 'label'); const caption = element(document, 'span'); label.append(caption, node); dialog.panel.append(label); labels[key] = { label, caption }; }
    const error = element(document, 'p'); error.setAttribute('data-location-error', ''); error.setAttribute('role', 'alert'); dialog.panel.append(error);
    const confirm = button(document, '', 'data-location-confirm', submit), cancel = button(document, '', 'data-location-cancel', () => finish(null)); dialog.panel.append(confirm, cancel);
    function parents() { return kind === 'taxonomy' ? catalog.getCategories() : catalog.getFavoritePages(); }
    function children() { return !parent.value || parent.value === '__create__' ? [] : kind === 'taxonomy' ? catalog.getSubcategories(parent.value) : catalog.getFavoriteGroups(parent.value); }
    function options(node, rows, value) { node.replaceChildren(); for (const row of [{ id:'',name:t('choose') }, ...rows, { id:'__create__', name:t('create') }]) { const option=element(document,'option',row.name); option.value=row.id; node.append(option); } node.value=value || ''; }
    function visibility() { labels['parent-name'].label.hidden = parent.value !== '__create__'; labels['child-name'].label.hidden = child.value !== '__create__'; }
    parent.addEventListener('change', () => {
      if (parent.value === '__create__') {
        options(child, [], kind === 'favorite' ? '__create__' : '');
        childName.value='';
        error.textContent='';
        visibility();
        childName.focus();
        return;
      }
      options(child, children(), ''); childName.value=''; error.textContent=''; visibility();
    });
    child.addEventListener('change', () => { error.textContent=''; visibility(); });
    parentName.addEventListener('input', () => { if (parent.value === '__create__') { options(child, [], '__create__'); visibility(); } });
    function finish(value) { if (!resolver) return; const resolve = resolver; resolver = null; dialog.close(); resolve(value); }
    function choice(node, nameNode, rows) {
      if (node.value && node.value !== '__create__' && rows.some(row=>row.id===node.value)) return {id:node.value};
      const name = nameNode.value.trim();
      if (node.value !== '__create__' || !name) { error.textContent=t('required'); (node.value==='__create__'?nameNode:node).focus(); return null; }
      const duplicate=rows.find(row=>row.name.trim().toLocaleLowerCase('en-US')===name.toLocaleLowerCase('en-US'));
      if (duplicate) { error.textContent=t('duplicate',{name:duplicate.name}); nameNode.focus(); return null; }
      return {create:{name}};
    }
    function submit() { const p=choice(parent,parentName,parents()); if (!p) return; const c=choice(child,childName,children()); if (!c) return; finish(kind==='taxonomy'?{kind,category:p,subcategory:c}:{kind,page:p,group:c,...(membershipId?{membershipId}:{})}); }
    function choose(input = {}) {
      if (disposed) return Promise.resolve(null);
      if (!['taxonomy','favorite'].includes(input.kind)) return Promise.reject(new TypeError('Invalid placement kind'));
      finish(null); kind=input.kind; const selected=input.draft || input.current; const value=selected?.kind===kind?selected:{};
      membershipId=kind==='favorite'?value.membershipId:undefined;
      const p=kind==='taxonomy'?value.category:value.page, c=kind==='taxonomy'?value.subcategory:value.group;
      dialog.title.textContent=t('title'); labels.parent.caption.textContent=t(kind==='taxonomy'?'category':'page'); labels.child.caption.textContent=t(kind==='taxonomy'?'subcategory':'group'); labels['parent-name'].caption.textContent=t('parentName'); labels['child-name'].caption.textContent=t('childName'); confirm.textContent=t('confirm'); cancel.textContent=t('cancel');
      options(parent,parents(),p?.id || (p?.create?'__create__':'')); parentName.value=p?.create?.name || ''; options(child,children(),c?.id || (c?.create?'__create__':'')); childName.value=c?.create?.name || ''; error.textContent=''; visibility();
      const promise=new Promise(resolve=>{resolver=resolve;}); dialog.open(); return promise;
    }
    return {choose, dispose() { disposed=true; finish(null); dialog.dispose(); }};
  }
  return { createTagLocationView, createDialogTools, translator, element, button, messages };
});
