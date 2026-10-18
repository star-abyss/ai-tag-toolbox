'use strict';
(function installConversationClient(global) {
  function createConversationClient({ request, createStream, preferences }) {
    let instance = '',
      generation = 0,
      selection = 0,
      currentId = preferences?.get('ai.currentSession', '') || '';
    let summaries = [],
      detail = null,
      listVersion = -1,
      noticeVersion = -1,
      stream,
      error = null;
    const detailVersions = new Map(),
      listeners = new Set(),
      chains = new Map(),
      drafts = new Map();
    let refreshFlight = null,
      createFlight = null,
      pendingList = false,
      emptyAttempted = false;
    const pendingDetails = new Set();
    let delivery = [],
      storage = null;
    const copy = (v) => structuredClone(v);
    const notify = (event) => {
      for (const callback of listeners) {
        try {
          callback(event);
        } catch {}
      }
    };
    async function invoke(action, parameters = {}) {
      const entry = delivery.find((row) => row.动作 === action);
      if (!entry)
        return {
          ok: false,
          code: 'SESSION_BAD_ACTION',
          reason: `SESSION_BAD_ACTION: 宿主未交付 ${action}`,
        };
      const value = await request('/toolbox/调', {
        模块: 'session',
        动作: entry.动作,
        参数: parameters,
      });
      return value?.ok === false ? value : { ok: true, data: value };
    }
    function changeInstance(value) {
      if (value === instance) return;
      instance = value;
      generation++;
      listVersion = noticeVersion = -1;
      detailVersions.clear();
      emptyAttempted = false;
      detail = null;
      summaries = [];
      notify();
    }
    function select(id) {
      if (id !== currentId) {
        currentId = id;
        selection++;
        detail = null;
        preferences?.set('ai.currentSession', id);
        notify();
      }
    }
    async function readCurrent() {
      const id = currentId,
        g = generation,
        s = selection;
      if (!id) return;
      const result = await invoke('读', { 会话: id });
      if (g !== generation || s !== selection || id !== currentId) return;
      if (!result.ok) {
        error = result;
        detail = null;
        notify();
        return;
      }
      const data = result.data;
      if (
        data.实例 !== instance ||
        data.会话.id !== id ||
        data.版本 < (detailVersions.get(id) ?? -1)
      )
        return;
      detailVersions.set(id, data.版本);
      detail = copy(data);
      error = null;
      notify();
    }
    async function ensureNew() {
      emptyAttempted = true;
      if (!createFlight)
        createFlight = invoke('新').finally(() => {
          createFlight = null;
        });
      const r = await createFlight;
      if (r.ok) select(r.data.会话.id);
      else error = r;
      return r;
    }
    function refresh(ids = []) {
      pendingList = true;
      for (const id of ids) pendingDetails.add(id);
      if (refreshFlight) return refreshFlight;
      refreshFlight = (async () => {
        while (pendingList) {
          pendingList = false;
          const touched = new Set(pendingDetails);
          pendingDetails.clear();
          const g = generation,
            s = selection;
          const result = await invoke('列');
          if (g !== generation || s !== selection) {
            pendingList = true;
            continue;
          }
          if (!result.ok) {
            error = result;
            notify();
            break;
          }
          const data = result.data;
          if (!instance) changeInstance(data.实例);
          if (data.实例 !== instance) continue;
          if (data.版本 >= listVersion) {
            listVersion = data.版本;
            summaries = copy(data.会话);
            if (summaries.length) {
              error = null;
              emptyAttempted = false;
            }
          }
          if (!summaries.some((row) => row.标识 === currentId)) {
            select(summaries[0]?.标识 || '');
            if (!summaries.length && !emptyAttempted) {
              const made = await ensureNew();
              if (!made.ok) {
                notify();
                break;
              }
              pendingList = true;
            }
          }
          notify();
          if (currentId && (!detail || touched.has(currentId))) await readCurrent();
        }
      })().finally(() => {
        refreshFlight = null;
        if (pendingList) void refresh();
      });
      return refreshFlight;
    }
    const 热 = (async () => {
      const desktop = await request('/toolbox/桌', {});
      storage = desktop.存储位置;
      delivery = (desktop.动作表 || []).filter((row) => row.模块 === 'session');
      await refresh();
      stream = createStream('/对话/流');
      stream.onmessage = (event) => {
        let value;
        try {
          value = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!value.实例 || typeof value.版本 !== 'number') return;
        if (value.实例 !== instance) {
          changeInstance(value.实例);
          void refresh(value.变更);
        } else if (value.版本 <= noticeVersion) return;
        noticeVersion = value.版本;
        if (Array.isArray(value.待答问题变更)) notify({ 待答问题变更: copy(value.待答问题变更) });
        void refresh(value.变更);
      };
    })();
    function serial(id, fn) {
      const p = (chains.get(id) || Promise.resolve()).then(fn),
        tail = p.catch(() => {});
      chains.set(id, tail);
      tail.then(() => {
        if (chains.get(id) === tail) chains.delete(id);
      });
      return p;
    }
    async function write(action, body) {
      await 热;
      const r = await invoke(action, body);
      await refresh(body.会话 ? [body.会话] : []);
      return r;
    }
    return Object.freeze({
      热,
      async 调(action, body = {}) {
        const captured = copy(body);
        await 热;
        if (action === '新') {
          emptyAttempted = true;
          const r = await invoke(action, captured);
          if (r.ok) select(r.data.会话.id);
          await refresh([currentId]);
          return r;
        }
        return write(action, captured);
      },
      async 切换(id) {
        await 热;
        select(id);
        await readCurrent();
        return error || { ok: true };
      },
      async 改消息({会话, 消息ID, 文本}) {
        const sessionId = String(会话 || ''), messageId = String(消息ID || '');
        await 热;
        if (!sessionId || !messageId) return {ok:false,code:'SESSION_BAD_ARGUMENT',reason:'SESSION_BAD_ARGUMENT: 会话与消息标识不能为空'};
        return write('改消息', {会话:sessionId, 消息ID:messageId, 文本:String(文本 ?? '')});
      },
      async 重新生成({会话, 轮次ID}) {
        const sessionId = String(会话 || ''), turnId = String(轮次ID || '');
        await 热;
        if (!sessionId || !turnId) return {ok:false,code:'SESSION_BAD_ARGUMENT',reason:'SESSION_BAD_ARGUMENT: 会话与轮次标识不能为空'};
        return write('重新生成', {会话:sessionId, 轮次ID:turnId});
      },
      async editMessage({sessionId, messageId, text}) {
        return this.改消息({会话:sessionId, 消息ID:messageId, 文本:text});
      },
      async regenerate({sessionId, turnId}) {
        return this.重新生成({会话:sessionId, 轮次ID:turnId});
      },
      草稿(id, content) {
        const parts = copy(content),
          token = {};
        drafts.set(id, { token, parts });
        notify();
        return serial(id, async () => {
          await 热;
          const r = await invoke('草稿', { 会话: id, 内容: parts });
          if (r.ok) await refresh([id]);
          if (drafts.get(id)?.token === token) {
            if (r.ok) drafts.delete(id);
            else error = r;
          }
          notify();
          return r;
        });
      },
      发送(id, content) {
        const parts = copy(content);
        return serial(id, () => write('发', { 会话: id, 内容: parts }));
      },
      保存(id) {
        return serial(id, () => write('存', { 会话: id }));
      },
      状态: () => ({
        当前: currentId,
        实例: instance,
        版本: listVersion,
        在跑: ['运行中', '停止中'].includes(detail?.运行状态),
        错误: copy(error),
      }),
      会话们: () =>
        summaries.map((s) => ({
          id: s.标识,
          title: s.标题,
          messageCount: s.消息数,
          updatedAt: s.更新时间,
          running: ['运行中', '停止中'].includes(s.运行状态),
          运行状态: s.运行状态,
          未保存: s.未保存,
          冻结: s.冻结,
          读不懂: s.读不懂,
        })),
      当前会话: () => {
        if (!detail) return null;
        const result = {
          ...copy(detail.会话),
          运行状态: detail.运行状态,
          未保存: detail.未保存,
          保存错误: copy(detail.保存错误),
        };
        if (drafts.has(currentId)) result.draft = copy(drafts.get(currentId).parts);
        return result;
      },
      格式说明: () =>
        delivery.find((a) => a.动作 === '发')?.参数.find((p) => p.名 === '内容')?.说明 || '',
      subscribe(callback) {
        // 观察者接收缓存变化。
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
      存储位置: () => copy(storage),
      close() {
        stream?.close();
        listeners.clear();
      },
    });
  }
  function createConversationList({ document: doc, onOpen, onRenameRequest, onDeleteRequest }) {
    const root = doc.createElement('div');
    root.className = 'conversation-list';
    root.setAttribute('role', 'list');
    const rows = new Map();
    const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    function createRow() {
      const row = doc.createElement('div');
      row.className = 'conversation-row';
      row.setAttribute('role', 'listitem');
      const title = doc.createElement('button');
      title.type = 'button';
      title.className = 'conversation-title';
      const meta = doc.createElement('span');
      meta.className = 'conversation-meta';
      const date = doc.createElement('time');
      date.className = 'conversation-date';
      const actions = doc.createElement('span');
      actions.className = 'conversation-actions';
      function action(name, text, label, callback) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.dataset.rowAction = name;
        button.textContent = text;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.onclick = () => callback(row.dataset.sessionId, title.textContent);
        actions.append(button);
      }
      title.onclick = () => onOpen(row.dataset.sessionId);
      title.ondblclick = () => onRenameRequest(row.dataset.sessionId, title.textContent);
      row.onclick = (event) => {
        if (!event.target.closest('button')) onOpen(row.dataset.sessionId);
      };
      action('rename', '✎', '重命名这条对话', onRenameRequest);
      action('delete', '×', '删除这条对话', onDeleteRequest);
      row.append(title, meta, date, actions);
      return { row, title, meta, date };
    }
    function update({ sessions, currentId }) {
      const ids = new Set(sessions.map((s) => s.id));
      for (const [id, entry] of rows)
        if (!ids.has(id)) {
          entry.row.remove();
          rows.delete(id);
        }
      sessions.forEach((s, index) => {
        let entry = rows.get(s.id);
        if (!entry) {
          entry = createRow();
          rows.set(s.id, entry);
        }
        entry.row.dataset.sessionId = s.id;
        entry.row.classList.toggle('selected', s.id === currentId);
        entry.title.textContent = s.title;
        entry.title.title = s.title;
        entry.title.setAttribute('aria-pressed', String(s.id === currentId));
        const updated = new Date(s.updatedAt);
        entry.date.textContent = Number.isFinite(updated.getTime()) ? dateFormat.format(updated) : '';
        entry.date.dateTime = Number.isFinite(updated.getTime()) ? updated.toISOString() : '';
        entry.meta.textContent = s.冻结
          ? s.读不懂
          : `${s.messageCount} 条${s.running ? ' · ' + s.运行状态 : ''}${s.未保存 ? ' · 未保存' : ''}`;
        if (root.children[index] !== entry.row)
          root.insertBefore(entry.row, root.children[index] || null);
      });
    }
    return Object.freeze({ root, update });
  }
  global.ConversationManagement = Object.freeze({
    createConversationClient,
    createConversationList,
  });
})(window);
