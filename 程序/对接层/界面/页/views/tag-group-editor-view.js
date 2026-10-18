'use strict';

(function install(root, factory) {
  const helpers = root.AppViews?.tagLocation;
  const api = factory(helpers);
  root.AppViews = root.AppViews || {};
  root.AppViews.tagGroupEditor = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function factory(helpers) {
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function createTagGroupEditorView({ document, catalog, notify = () => {}, onChange = () => {} } = {}) {
    const { createDialogTools, element, button } = helpers;
    let disposed = false, opened = false, pending = null, groupId = '', draft = null, baseline = null, revision = 0, sequence = 0;
    const dialog = createDialogTools(document, 'group', event => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopImmediatePropagation(); close(); } });
    const header = element(document, 'div'); header.className = 'tag-editor-header'; dialog.panel.insertBefore(header, dialog.title); header.append(dialog.title);
    const deleteButton = button(document, '', 'data-tag-group-delete', () => askDelete()); deleteButton.className = 'tag-editor-delete btn btn-icon btn-danger'; deleteButton.hidden = true; deleteButton.title = '删除标签组'; deleteButton.setAttribute('aria-label', deleteButton.title);
    const trash = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); trash.classList.add('tag-editor-delete-icon'); trash.setAttribute('viewBox', '0 0 24 24'); trash.setAttribute('aria-hidden', 'true');
    for (const d of ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6']) { const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); trash.append(path); }
    deleteButton.append(trash); header.append(deleteButton);
    const form = element(document, 'form'); form.className = 'tag-editor-form'; dialog.panel.append(form);
    const identity = element(document, 'section'); identity.className = 'tag-editor-section tag-editor-section--identity'; identity.append(element(document, 'h3', '基本信息'));
    const metadata = element(document, 'section'); metadata.className = 'tag-editor-section tag-editor-section--metadata'; metadata.append(element(document, 'h3', '显示与说明'));
    const members = element(document, 'section'); members.className = 'tag-editor-section tag-editor-section--group'; members.append(element(document, 'h3', '组成员'));
    form.append(identity, metadata, members);
    const fields = {};
    function field(section, name, tag = 'input') {
      const label = element(document, 'label'); label.className = 'tag-editor-field'; label.dataset.tagGroupFieldWrap = name;
      const caption = element(document, 'span'); caption.textContent = ({ content: '组名称', displayName: '显示名称', aliases: '别名（每行一个）', note: '备注（纯文本）', memberTagIds: '成员 Tag ID（每行一个）' })[name];
      const node = element(document, tag); node.dataset.tagGroupField = name; node.name = name; label.append(caption, node); section.append(label); fields[name] = node;
      node.addEventListener('input', () => { draft[name] = name === 'aliases' || name === 'memberTagIds' ? node.value.split(/[\r\n,]+/).map(value => value.trim()).filter(Boolean) : node.value; clearError(); });
    }
    field(identity, 'content'); field(identity, 'displayName'); field(metadata, 'aliases', 'textarea'); field(metadata, 'note', 'textarea'); field(members, 'memberTagIds', 'textarea');
    const error = element(document, 'p'); error.dataset.tagGroupError = ''; error.setAttribute('role', 'alert'); form.append(error);
    const actions = element(document, 'div'); actions.className = 'tag-editor-actions'; form.append(actions);
    const saveButton = button(document, '保存', 'data-tag-group-save', () => save()); const closeButton = button(document, '取消 / 关闭', 'data-tag-group-close', () => close()); actions.append(saveButton, closeButton);
    const deleteDialog = createDialogTools(document, 'group-delete', event => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopImmediatePropagation(); deleteDialog.close(); } });
    deleteDialog.title.textContent = '确认删除标签组'; const deleteText = element(document, 'p', '确定删除这个标签组吗？'); deleteDialog.panel.append(deleteText);
    const deleteCancel = button(document, '取消', 'data-tag-group-delete-cancel', () => deleteDialog.close()); const deleteConfirm = button(document, '删除', 'data-tag-group-delete-confirm', () => confirmDelete()); deleteDialog.panel.append(deleteCancel, deleteConfirm);
    form.addEventListener('submit', event => { event.preventDefault(); save(); });
    function clearError() { error.textContent = ''; }
    function freeze(value) { form.querySelectorAll('input,textarea,button').forEach(node => { node.disabled = value; }); }
    function render() {
      dialog.title.textContent = groupId ? '编辑标签组' : '新建标签组'; deleteButton.hidden = !groupId;
      fields.content.value = draft.content; fields.displayName.value = draft.displayName; fields.aliases.value = draft.aliases.join('\n'); fields.note.value = draft.note; fields.memberTagIds.value = draft.memberTagIds.join('\n');
      clearError(); freeze(false);
    }
    function close() { if (!opened) return; opened = false; pending = null; dialog.close(); }
    function operation(command) { return `tag-group-editor:${Date.now()}:${++sequence}:${JSON.stringify(command)}`; }
    function commit(command) {
      if (pending) return pending;
      freeze(true); const token = operation(command);
      pending = Promise.resolve(catalog.execute(command, { operationId: token, expectedRevision: revision })).catch(() => ({ ok: false, error: { code: 'STORAGE_WRITE_FAILED', message: '保存失败' } })).then(result => {
        pending = null; if (disposed) return result; freeze(false);
        if (result.ok) { notify(groupId ? '标签组已保存' : '标签组已创建'); close(); try { onChange(result.data); } catch {} }
        else error.textContent = result.error?.message || '保存失败';
        return result;
      });
      return pending;
    }
    function save() {
      if (!opened || disposed || pending) return pending || Promise.resolve({ ok: false, error: { code: 'BUSY' } });
      if (!draft.content.trim()) { error.textContent = '请输入组名称'; fields.content.focus(); return Promise.resolve({ ok: false, error: { code: 'INVALID_FIELD' } }); }
      if (!draft.memberTagIds.length) { error.textContent = '请至少填写一个成员 Tag ID'; fields.memberTagIds.focus(); return Promise.resolve({ ok: false, error: { code: 'INVALID_FIELD' } }); }
      const patch = { name: draft.content.trim(), displayName: draft.displayName, aliases: clone(draft.aliases), note: draft.note, memberTagIds: clone(draft.memberTagIds) };
      return commit({ type: 'saveTagGroup', ...(groupId ? { groupId } : {}), patch });
    }
    function askDelete() { if (!groupId || pending) return; deleteDialog.open(); }
    function confirmDelete() {
      deleteDialog.close(); if (!groupId || pending) return;
      commit({ type: 'deleteTagGroup', groupId });
    }
    async function open(input = {}) {
      if (disposed || pending) return false;
      groupId = input.groupId || '';
      const source = groupId ? catalog.getTagGroup?.(groupId) : null;
      if (groupId && !source) { notify('标签组不存在'); return false; }
      const initial = input.initialValues || {};
      draft = { content: source?.name || initial.content || initial.name || '', displayName: source?.displayName || initial.displayName || '', aliases: clone(source?.aliases || initial.aliases || []), note: source?.note || initial.note || '', memberTagIds: clone(source?.memberTagIds || initial.memberTagIds || []) };
      baseline = clone(draft); revision = catalog.revision?.() || 0; opened = true; render(); dialog.open(); fields.content.focus(); return true;
    }
    return { open, requestClose: async () => { close(); return true; }, isDirty: () => opened && !equal(draft, baseline), dispose() { disposed = true; dialog.dispose(); deleteDialog.dispose(); } };
  }
  return { createTagGroupEditorView };
});
