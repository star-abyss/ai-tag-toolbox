'use strict';
const { randomUUID } = require('node:crypto');
const D = require('./data.js');
const { ERR, ok, fail, copy } = D;
function createCore({ port, 图片, 执行, 新标识 = randomUUID, 现在 = Date.now }) {
  const sessions = new Map(),
    frozen = new Map(),
    dirty = new Map(),
    queues = new Map(),
    runs = new Map(),
    managing = new Map(),
    listeners = new Set(),
    questions = new Map(),
    creating = new Set();
  const instance = randomUUID();
  let version = 0,
    readyDone = false,
    closed = false,
    initError = null;
  const notify = (changed = [], deleted = [], questionChanges = []) => {
    version++;
    const event = {
      实例: instance,
      版本: version,
      变更: [...new Set(changed)],
      已删: [...new Set(deleted)],
      ...(questionChanges.length ? { 待答问题变更: copy(questionChanges) } : {}),
    };
    for (const fn of listeners) {
      try {
        fn(copy(event));
      } catch {}
    }
  };
  const state = (id) =>
    managing.get(id) ||
    (runs.has(id) ? (runs.get(id).controller.signal.aborted ? '停止中' : '运行中') : '空闲');
  const flags = () => ({ 实例: instance, 版本: version, 就绪: readyDone });
  const problems = () => [
    ...[...frozen].map(([id, reason]) => ({ 会话ID: id, code: ERR.UNREADABLE, reason })),
    ...[...dirty].map(([id, error]) => ({ 会话ID: id, code: error.code, reason: error.reason })),
  ];
  function target(id, writing = false) {
    if (writing) {
      if (closed) return fail(ERR.CLOSED, '门面已关闭');
      if (!readyDone) return fail(ERR.NOT_READY, '初始化未结束');
    }
    if (initError) return copy(initError);
    if (!D.id(id, 's')) return fail(ERR.BAD_ARGUMENT, '会话标识不合法');
    if (frozen.has(id)) return fail(ERR.UNREADABLE, frozen.get(id));
    if (!sessions.has(id)) return fail(ERR.NO_SESSION, '没有这个会话');
    if (writing && managing.has(id)) return fail(ERR.BUSY, state(id));
    return null;
  }
  function newId(prefix, used) {
    let seed;
    try {
      seed = 新标识();
    } catch (e) {
      throw fail(ERR.BAD_ID, e.message || '标识生成器失败');
    }
    const value = prefix + '_' + seed;
    if (!D.id(value, prefix) || used.has(value)) throw fail(ERR.BAD_ID, '生成的标识不合法或重名');
    return value;
  }
  function enqueue(id, fn) {
    const p = (queues.get(id) || Promise.resolve()).then(fn);
    const tail = p.catch(() => {});
    queues.set(id, tail);
    tail.then(() => {
      if (queues.get(id) === tail) queues.delete(id);
    });
    return p;
  }
  async function write(id, value, fact = false) {
    let r;
    try {
      r = await port.write(id, copy(value));
    } catch (e) {
      r = { ok: false, reason: e.message };
    }
    if (!r.ok) {
      const error = fail(ERR.WRITE_FAILED, String(r.reason));
      if (fact) {
        sessions.set(id, value);
        dirty.set(id, error);
        notify([id]);
      }
      return error;
    }
    sessions.set(id, value);
    dirty.delete(id);
    notify([id]);
    return ok(null);
  }
  function empty(id, title = '新对话') {
    const now = 现在();
    return {
      format: 'toolbox-session',
      version: 1,
      id,
      title,
      titleManual: false,
      createdAt: now,
      updatedAt: now,
      messages: [],
      turns: [],
      draft: [],
    };
  }
  const loaded = port.list();
  if (!loaded.ok) initError = fail(ERR.UNREADABLE, loaded.reason);
  else
    for (const id of loaded.ids) {
      const r = port.read(id);
      if (r.state === 'missing') continue;
      if (r.state !== 'ok' || !D.validSession(r.value, id))
        frozen.set(id, `${ERR.UNREADABLE}: ${r.reason || '文件字段或版本不符合会话格式'}`);
      else sessions.set(id, copy(r.value));
    }
  const ready = Promise.resolve().then(async () => {
    for (const [id, original] of sessions) {
      if (!original.turns.some((t) => t.status === 'running')) continue;
      const s = copy(original);
      for (const t of s.turns.filter((t) => t.status === 'running'))
        D.finish(
          s,
          t,
          'interrupted',
          fail(ERR.INTERRUPTED, '启动时发现中断，结束时间为本次发现时间'),
          现在(),
        );
      await write(id, s, true);
    }
    readyDone = true;
    return initError || { ok: true, 问题: problems() };
  });
  function commit(id, run, event) {
    const input = copy(event);
    return enqueue(id, async () => {
      if (runs.get(id) !== run || run.finishing) return fail(ERR.BAD_UPDATE, '本轮已结束');
      if (run.failure) return copy(run.failure);
      const s = copy(sessions.get(id));
      let data, replacementCommit = false;
      if (input.kind === 'context') {
        const m = s.messages.find((m) => m.id === run.inputMessageId);
        if (
          typeof input.text !== 'string' ||
          !input.text ||
          m.context ||
          s.messages.some((m) => m.turnId === run.turnId && m.role === 'assistant' && !run.replaceIds?.includes(m.id))
        )
          return fail(ERR.BAD_UPDATE, '参考正文只允许在助手消息前写一次');
        m.context = input.text;
        data = { 消息ID: m.id };
      } else if (input.kind === 'message') {
        if (
          !D.parts(input.parts) ||
          typeof input.reasoning !== 'string' ||
          !D.model(input.model) ||
          !Array.isArray(input.toolCalls) ||
          !D.content(input.parts, input.reasoning, input.toolCalls)
        )
          return fail(ERR.BAD_UPDATE, '助手消息形状错误');
        const seen = new Set();
        for (const c of input.toolCalls) {
          if (
            !D.keys(c, ['id', 'name', 'args']) ||
            typeof c.id !== 'string' ||
            !c.id ||
            seen.has(c.id) ||
            typeof c.name !== 'string' ||
            !c.name ||
            typeof c.args !== 'string'
          )
            return fail(ERR.BAD_UPDATE, '工具声明形状错误');
          seen.add(c.id);
        }
        let mid;
        try {
          mid = newId('m', new Set(s.messages.map((m) => m.id)));
        } catch (e) {
          return e;
        }
        const message = {
          id: mid,
          turnId: run.turnId,
          role: 'assistant',
          parts: input.parts,
          reasoning: input.reasoning,
          context: '',
          toolCalls: input.toolCalls.map((c) => ({ ...c, status: 'pending', result: null })),
          createdAt: 现在(),
          model: input.model,
        };
        replacementCommit = !!run.replaceIds?.length;
        if (replacementCommit) {
          s.messages = s.messages.filter((m) => !run.replaceIds.includes(m.id));
          run.replaceIds = [];
        }
        const userIndex = s.messages.findIndex((m) => m.id === run.inputMessageId);
        const lastTurnIndex = s.messages.reduce(
          (last, m, i) => (m.turnId === run.turnId ? i : last),
          userIndex,
        );
        s.messages.splice(lastTurnIndex + 1, 0, message);
        data = { 消息ID: mid };
      } else if (input.kind === 'tool') {
        const m = s.messages.find(
            (m) => m.id === input.messageId && m.turnId === run.turnId && m.role === 'assistant',
          ),
          c = m?.toolCalls.find((c) => c.id === input.callId);
        if (
          !c ||
          !(
            (c.status === 'pending' &&
              input.status === 'running' &&
              !Object.hasOwn(input, 'result')) ||
            (c.status === 'running' &&
              ['complete', 'error'].includes(input.status) &&
              Object.hasOwn(input, 'result') &&
              D.json(input.result))
          )
        )
          return fail(ERR.BAD_UPDATE, '工具目标或状态推进错误');
        c.status = input.status;
        if (Object.hasOwn(input, 'result')) c.result = input.result;
        data = { 消息ID: m.id, 调用ID: c.id };
      } else return fail(ERR.BAD_UPDATE, '不支持的本轮提交');
      s.updatedAt = 现在();
      const r = await write(id, s, !replacementCommit);
      if (!r.ok) {
        run.failure = r;
        run.controller.abort();
        return r;
      }
      return ok(data);
    });
  }
  function questionView(id) {
    const entry = questions.get(id);
    return entry ? { 问题ID: entry.id, 问题: entry.prompt.问题, 选项: copy(entry.prompt.选项) } : null;
  }
  function finishQuestion(id, entry, result) {
    if (questions.get(id) !== entry) return false;
    questions.delete(id);
    entry.signal?.removeEventListener('abort', entry.abort);
    entry.resolve(result);
    notify([id], [], [{ 会话ID: id, 问题: questionView(id) }]);
    return true;
  }
  function askQuestion(id, prompt, signal) {
    if (signal?.aborted) return Promise.resolve({ ok: false, code: 'BUSINESS_CANCELLED', reason: 'BUSINESS_CANCELLED: 会话已停止' });
    if (questions.has(id)) return Promise.resolve({ ok: false, code: 'BUSINESS_QUESTION_PENDING', reason: 'BUSINESS_QUESTION_PENDING: 当前会话已有待答问题' });
    if (!prompt || typeof prompt.问题 !== 'string' || !prompt.问题 || !Array.isArray(prompt.选项))
      return Promise.resolve({ ok: false, code: 'BUSINESS_BAD_QUESTION', reason: 'BUSINESS_BAD_QUESTION: 问题形状错误' });
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    const entry = { id: randomUUID(), prompt: copy(prompt), resolve, signal, abort: null };
    entry.abort = () => finishQuestion(id, entry, { ok: false, code: 'BUSINESS_CANCELLED', reason: 'BUSINESS_CANCELLED: 会话已停止' });
    questions.set(id, entry);
    signal?.addEventListener('abort', entry.abort, { once: true });
    notify([id], [], [{ 会话ID: id, 问题: questionView(id) }]);
    return promise;
  }
  async function execute(id, run) {
    let result;
    try {
      result = await 执行({
        sessionId: id,
        turnId: run.turnId,
        inputMessageId: run.inputMessageId,
        signal: run.controller.signal,
        read: () => {
          const s = copy(sessions.get(id));
          if (!run.replaceMode) return s;
          const userIndex = s.messages.findIndex((m) => m.id === run.inputMessageId);
          s.messages = s.messages.filter((m, i) => i <= userIndex || (m.turnId === run.turnId && !run.replaceIds.includes(m.id)));
          s.turns = s.turns.slice(0, s.turns.findIndex((t) => t.id === run.turnId) + 1);
          return s;
        },
        commit: (event) => commit(id, run, event),
        notify: () => { if (runs.get(id) === run && !run.finishing) notify([id]); },
        提问: { ask: (prompt, signal) => askQuestion(id, prompt, signal), read: () => questionView(id) },
      });
    } catch (e) {
      result =
        e?.code && e?.reason
          ? e
          : run.controller.signal.aborted && !run.failure
            ? fail(ERR.STOPPED, '执行已停止')
            : fail(ERR.EXECUTION_FAILED, e?.message || String(e));
    } finally {
      run.finishing = true;
      await enqueue(id, async () => {
        const s = copy(sessions.get(id)),
          t = s.turns.find((t) => t.id === run.turnId);
        let error = run.failure || (result?.ok === false ? result : null);
        if (
          !error &&
          !run.controller.signal.aborted &&
          (result?.ok !== true ||
            s.messages
              .filter((m) => m.turnId === t.id)
              .some((m) => m.toolCalls.some((c) => ['pending', 'running'].includes(c.status))))
        )
          error = fail(ERR.EXECUTION_FAILED, '执行端口返回无效结果或遗留未完成工具');
        const stopped = run.controller.signal.aborted;
        const status =
          error && error.code !== ERR.STOPPED
            ? 'failed'
            : stopped || error?.code === ERR.STOPPED
              ? 'stopped'
              : 'complete';
        D.finish(
          s,
          t,
          status,
          status === 'stopped' ? fail(ERR.STOPPED, '用户或宿主请求停止') : error,
          现在(),
        );
        try {
          const saved = await write(id, s, true);
          if (!saved.ok) {
            D.finish(s, t, 'failed', saved, 现在());
            sessions.set(id, s);
          }
        } finally {
          runs.delete(id);
          notify([id]);
        }
      });
    }
  }
  const methods = {
    列() {
      if (initError) return copy(initError);
      const rows = [...sessions].map(([id, s]) => ({
        标识: id,
        标题: s.title,
        消息数: s.messages.length,
        更新时间: s.updatedAt,
        运行状态: state(id),
        未保存: dirty.has(id),
        冻结: false,
        读不懂: null,
      }));
      for (const [id, reason] of frozen)
        rows.push({
          标识: id,
          标题: id,
          消息数: null,
          更新时间: null,
          运行状态: state(id),
          未保存: false,
          冻结: true,
          读不懂: reason,
        });
      rows.sort((a, b) => (b.更新时间 || 0) - (a.更新时间 || 0) || a.标识.localeCompare(b.标识));
      return ok({ 会话: rows, 总数: rows.length, ...flags(), 问题: problems() });
    },
    读({ 会话: id }) {
      const e = target(id);
      return (
        e ||
        ok({
          会话: copy(sessions.get(id)),
          待答问题: questionView(id),
          运行状态: state(id),
          未保存: dirty.has(id),
          保存错误: copy(dirty.get(id) || null),
          ...flags(),
        })
      );
    },
    待答问题({ 会话: id }) {
      const e = target(id);
      return e || ok({ 会话ID: id, 问题: questionView(id) });
    },
    回答问题({ 会话: id, 问题ID, 答案 }) {
      const e = target(id, true);
      if (e) return Promise.resolve(e);
      const entry = questions.get(id);
      if (!entry || entry.id !== 问题ID) return Promise.resolve(fail('SESSION_NO_PENDING_QUESTION', '没有这个待答问题'));
      if (typeof 答案 !== 'string' || !答案.trim()) return Promise.resolve(fail('SESSION_BAD_ANSWER', '答案必须是非空文字'));
      finishQuestion(id, entry, { ok: true, data: { 答案 } });
      return Promise.resolve(ok({ 会话ID: id, 问题ID, 已回答: true }));
    },
    取消问题({ 会话: id, 问题ID }) {
      const e = target(id, true);
      if (e) return Promise.resolve(e);
      const entry = questions.get(id);
      if (!entry || entry.id !== 问题ID) return Promise.resolve(fail('SESSION_NO_PENDING_QUESTION', '没有这个待答问题'));
      finishQuestion(id, entry, { ok: false, code: 'BUSINESS_CANCELLED', reason: 'BUSINESS_CANCELLED: 用户取消问题' });
      return Promise.resolve(ok({ 会话ID: id, 问题ID, 已取消: true }));
    },
    async 新() {
      if (closed) return fail(ERR.CLOSED, '门面已关闭');
      if (!readyDone) return fail(ERR.NOT_READY, '初始化未结束');
      if (initError) return copy(initError);
      try {
        const id = newId(
          's',
          new Set([...sessions.keys(), ...frozen.keys(), ...managing.keys(), ...creating]),
        );
        creating.add(id);
        try {
          const s = empty(id);
          const r = await enqueue(id, () => write(id, s));
          return r.ok ? ok({ 会话: copy(s) }) : r;
        } finally {
          creating.delete(id);
        }
      } catch (e) {
        return e;
      }
    },
    async 改名({ 会话: id, 标题 }) {
      const e = target(id, true);
      if (e) return e;
      if (typeof 标题 !== 'string' || !标题.trim())
        return fail(ERR.BAD_ARGUMENT, '标题须有非空白内容');
      return enqueue(id, async () => {
        const s = copy(sessions.get(id));
        s.title = 标题.trim();
        s.titleManual = true;
        s.updatedAt = 现在();
        const r = await write(id, s);
        return r.ok ? ok({ 会话ID: id, 标题: s.title }) : r;
      });
    },
    async 草稿({ 会话: id, 内容 }) {
      const e = target(id, true);
      if (e) return e;
      if (!D.parts(内容)) return fail(ERR.BAD_ARGUMENT, '内容须为 Part 数组');
      return enqueue(id, async () => {
        const s = copy(sessions.get(id));
        s.draft = copy(内容);
        const r = await write(id, s);
        return r.ok ? ok({ 会话ID: id, 草稿: copy(内容) }) : r;
      });
    },
    async 改消息({ 会话: id, 消息ID, 文本 }) {
      const e = target(id, true);
      if (e) return e;
      if (runs.has(id)) return fail(ERR.BUSY, '本会话有一轮在执行');
      if (typeof 文本 !== 'string') return fail(ERR.BAD_ARGUMENT, '文本必须是字符串');
      return enqueue(id, async () => {
        const s = copy(sessions.get(id)), m = s.messages.find((item) => item.id === 消息ID);
        if (!m) return fail(ERR.BAD_ARGUMENT, '没有这条消息');
        const first = m.parts.findIndex((part) => part.type === 'text');
        if (first < 0) m.parts.push({ type: 'text', text: 文本 });
        else {
          let inserted = false;
          m.parts = m.parts.flatMap((part) => {
            if (part.type !== 'text') return [part];
            if (!inserted) { inserted = true; return [{ type: 'text', text: 文本 }]; }
            return [];
          });
        }
        if (m.role === 'assistant' && !D.content(m.parts, m.reasoning, m.toolCalls))
          return fail(ERR.BAD_ARGUMENT, '空助手消息不能单独保存');
        s.updatedAt = 现在();
        const r = await write(id, s);
        return r.ok ? ok({ 会话ID: id, 消息ID }) : r;
      });
    },
    async 重新生成({ 会话: id, 轮次ID }) {
      const e = target(id, true);
      if (e) return e;
      if (runs.has(id)) return fail(ERR.BUSY, '本会话有一轮在执行');
      if (!执行) return fail(ERR.NO_EXECUTOR, '没有传入执行函数');
      const before = sessions.get(id), turn = before.turns.find((t) => t.id === 轮次ID);
      if (!turn || turn.status === 'running') return fail(ERR.BAD_ARGUMENT, '目标轮次不存在或仍在执行');
      const replaceIds = before.messages.filter((m) => m.turnId === turn.id && m.role === 'assistant').map((m) => m.id);
      const run = { controller: new AbortController(), turnId: turn.id, inputMessageId: turn.inputMessageId,
        replaceIds, replaceMode: true, finishing: false, failure: null };
      runs.set(id, run);
      let accepted;
      try {
        accepted = await enqueue(id, async () => {
          const s = copy(sessions.get(id)), t = s.turns.find((item) => item.id === turn.id);
          if (!t || t.status === 'running' || !s.messages.some((m) => m.id === t.inputMessageId && m.role === 'user'))
            return fail(ERR.BAD_ARGUMENT, '目标轮次已不存在或正在执行');
          run.replaceIds = s.messages.filter((m) => m.turnId === t.id && m.role === 'assistant').map((m) => m.id);
          const user = s.messages.find((m) => m.id === t.inputMessageId);
          user.context = '';
          const now = 现在();
          t.status = 'running'; t.startedAt = now; t.endedAt = null; t.error = null; s.updatedAt = now;
          return write(id, s);
        });
      } catch (error) {
        accepted = fail(ERR.WRITE_FAILED, error?.message || '重新生成受理失败');
      } finally {
        if (!accepted?.ok && runs.get(id) === run) runs.delete(id);
      }
      if (!accepted.ok) return accepted;
      run.promise = Promise.resolve().then(() => execute(id, run));
      return ok({ 会话ID: id, 轮次ID: run.turnId, 消息ID: run.inputMessageId });
    },
    async 发({ 会话: id, 内容 }) {
      const e = target(id, true);
      if (e) return e;
      if (runs.has(id)) return fail(ERR.BUSY, '已有一轮在执行');
      if (!执行) return fail(ERR.NO_EXECUTOR, '没有传入执行函数');
      if (!D.parts(内容)) return fail(ERR.BAD_ARGUMENT, '内容须为 Part 数组');
      if (内容.some((p) => p.type === 'image' && p.imageId === null))
        return fail(ERR.IMAGE_MISSING, '待发内容包含历史缺图');
      if (!内容.some((p) => p.type === 'image' || p.text.trim()))
        return fail(ERR.EMPTY_INPUT, '本次没有图文内容');
      for (const p of 内容.filter((p) => p.type === 'image')) {
        const r = 图片.read(id, p.imageId);
        if (!r.ok) return copy(r);
      }
      const before = sessions.get(id);
      let run;
      try {
        run = {
          controller: new AbortController(),
          turnId: newId('t', new Set(before.turns.map((t) => t.id))),
          inputMessageId: newId('m', new Set(before.messages.map((m) => m.id))),
          finishing: false,
          failure: null,
        };
      } catch (e) {
        return e;
      }
      runs.set(id, run);
      const r = await enqueue(id, async () => {
        const s = copy(sessions.get(id)),
          now = 现在();
        s.messages.push({
          id: run.inputMessageId,
          turnId: run.turnId,
          role: 'user',
          parts: copy(内容),
          reasoning: '',
          context: '',
          toolCalls: [],
          createdAt: now,
          model: null,
        });
        s.turns.push({
          id: run.turnId,
          inputMessageId: run.inputMessageId,
          status: 'running',
          startedAt: now,
          endedAt: null,
          error: null,
        });
        s.updatedAt = now;
        if (JSON.stringify(s.draft) === JSON.stringify(内容)) s.draft = [];
        if (s.title === '新对话' && !s.titleManual)
          s.title =
            内容
              .find((p) => p.type === 'text' && p.text.trim())
              ?.text.trim()
              .split(/\r?\n/)[0]
              .trim() || '图片对话';
        return write(id, s);
      });
      if (!r.ok) {
        runs.delete(id);
        return r;
      }
      run.promise = Promise.resolve().then(() => execute(id, run));
      return ok({ 会话ID: id, 轮次ID: run.turnId, 消息ID: run.inputMessageId });
    },
    async 停({ 会话: id }) {
      const e = target(id, true);
      if (e) return e;
      const run = runs.get(id);
      if (run && !run.controller.signal.aborted) {
        run.controller.abort();
        notify([id]);
      }
      return ok({ 会话ID: id, 已请求: !!run });
    },
    async 存({ 会话: id }) {
      const e = target(id, true);
      if (e) return e;
      return enqueue(id, async () => {
        const r = await write(id, copy(sessions.get(id)));
        return r.ok ? ok({ 会话ID: id, 已保存: true }) : r;
      });
    },
    async 清空({ 会话: id }) {
      const e = target(id, true);
      if (e) return e;
      if (runs.has(id)) return fail(ERR.BUSY, '本轮还未结束');
      return enqueue(id, async () => {
        const s = copy(sessions.get(id)),
          count = s.messages.length;
        s.messages = [];
        s.turns = [];
        s.draft = [];
        s.updatedAt = 现在();
        const r = await write(id, s);
        return r.ok ? ok({ 会话ID: id, 已清空: count }) : r;
      });
    },
    async 删({ 会话: id, 保留图片 = false }) {
      const e = target(id, true);
      if (e && !(e.code === ERR.UNREADABLE && frozen.has(id))) return e;
      if (typeof 保留图片 !== 'boolean') return fail(ERR.BAD_ARGUMENT, '保留图片必须是布尔');
      if (runs.has(id) || managing.has(id)) return fail(ERR.BUSY, '目标正在执行或管理');
      managing.set(id, '删除中');
      notify([id]);
      return enqueue(id, async () => {
        const kept = [];
        let imageReceipt = null;
        const failed = (r, phase) => ({
          ...copy(r),
          details: {
            阶段: phase,
            会话ID: id,
            已保留: copy(kept),
            图片回执: copy(imageReceipt),
            ...(r.details === undefined ? {} : { 来源详情: copy(r.details) }),
          },
        });
        try {
          const listed = 图片.list(id);
          if (!listed.ok) return failed(listed, '列图片');
          if (保留图片)
            for (const imageId of listed.data.ids) {
              const r = await 图片.copyToGallery(id, imageId);
              if (!r.ok) return failed(r, '保图');
              kept.push(copy(r.data));
            }
          const cleared = await 图片.clear(id);
          imageReceipt = cleared.ok ? cleared.data : cleared;
          if (!cleared.ok) return failed(cleared, '清图');
          let r;
          try {
            r = await port.remove(id);
          } catch (e) {
            r = { ok: false, reason: e.message };
          }
          if (!r.ok) return failed(fail(ERR.REMOVE_FAILED, r.reason), '删记录');
          sessions.delete(id);
          frozen.delete(id);
          dirty.delete(id);
          notify([], [id]);
          return ok({ 会话ID: id, 已删: true, 已保留: copy(kept), 图片回执: copy(imageReceipt) });
        } finally {
          managing.delete(id);
          if (sessions.has(id) || frozen.has(id)) notify([id]);
        }
      });
    },
    async 导出({ 会话列表: ids }) {
      if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
        return fail(ERR.BAD_ARGUMENT, '会话列表必须非空且不重复');
      const entries = [];
      let imageCount = 0;
      for (const id of ids) {
        const e = target(id);
        if (e) return e;
        if (managing.has(id)) return fail(ERR.BUSY, state(id));
        const s = copy(sessions.get(id)),
          listed = await 图片.listNumbered(id);
        if (!listed.ok) return copy(listed);
        const images = [],
          existing = new Set(listed.data.images.map((image) => image.id)),
          missing = [];
        for (const item of listed.data.images) {
          const imageId = item.id;
          const r = 图片.read(id, imageId);
          if (!r.ok) return copy(r);
          const { bytes, number, ...fields } = r.data;
          images.push({
            id: imageId,
            number: item.number,
            ...copy(fields),
            base64: Buffer.from(bytes).toString('base64'),
          });
          imageCount++;
        }
        for (const imageId of D.references(s))
          if (!existing.has(imageId)) {
            const r = 图片.read(id, imageId);
            if (r.ok) return fail(ERR.BAD_ARGUMENT, '图片清单与读取结果不一致');
            missing.push({ id: imageId, reason: r.reason });
          }
        entries.push({ session: s, imageNumberHighWater: listed.data.highWater, images, missing });
      }
      return ok({
        内容: JSON.stringify({ format: 'toolbox-session-archive', version: 2, sessions: entries }),
        会话数: entries.length,
        图片数: imageCount,
      });
    },
    async 导入({ 内容 }) {
      if (closed) return fail(ERR.CLOSED, '门面已关闭');
      if (!readyDone) return fail(ERR.NOT_READY, '初始化未结束');
      if (initError) return copy(initError);
      let archive;
      try {
        archive = D.archive(内容);
      } catch (e) {
        return fail(ERR.BAD_ARGUMENT, e.message);
      }
      const imported = [];
      for (const entry of archive.sessions) {
        let id = null,
          phase = '新建';
        const stored = [];
        const failed = (r) => ({
          ...copy(r),
          details: {
            阶段: phase,
            已导入: copy(imported),
            部分会话: sessions.has(id) ? id : null,
            已存图片: copy(stored),
            来源会话: entry.session.id,
            ...(r.details === undefined ? {} : { 来源详情: copy(r.details) }),
          },
        });
        try {
          id = newId(
            's',
            new Set([
              ...sessions.keys(),
              ...frozen.keys(),
              ...managing.keys(),
              ...creating,
              ...archive.sessions.map((e) => e.session.id),
            ]),
          );
          managing.set(id, '导入中');
          const provisional = empty(id, '导入未完成：' + entry.session.title);
          const made = await enqueue(id, () => write(id, provisional));
          if (!made.ok) return failed(made);
          phase = '图片';
          const map = new Map();
          for (const im of [...entry.images].sort((a, b) => a.number - b.number)) {
            const { id: original, number, base64, ...fields } = im;
            const r = await 图片.write(id, {
              ...copy(fields),
              bytes: Uint8Array.from(Buffer.from(base64, 'base64')),
              number,
            });
            if (!r.ok) return failed(r);
            map.set(original, r.data.id);
            stored.push(r.data.id);
          }
          const numbering = await 图片.restoreNumbering(id, { highWater: entry.imageNumberHighWater });
          if (!numbering.ok) return failed(numbering);
          phase = '记录';
          const used = new Set([
            ...entry.session.messages.map((m) => m.id),
            ...entry.session.turns.map((t) => t.id),
            ...entry.session.messages.flatMap((m) => m.toolCalls.map((c) => c.id)),
          ]);
          const alloc = (prefix) => {
            const id = newId(prefix, used);
            used.add(id);
            return id;
          };
          const completed = D.rebuild(
            entry.session,
            id,
            map,
            new Map(entry.missing.map((im) => [im.id, im.reason])),
            alloc,
            现在(),
          );
          const saved = await enqueue(id, () => write(id, completed));
          if (!saved.ok) return failed(saved);
          imported.push(id);
        } catch (e) {
          return failed(e?.ok === false ? e : fail(ERR.BAD_ARGUMENT, e.message || String(e)));
        } finally {
          if (id) {
            managing.delete(id);
            if (sessions.has(id)) notify([id]);
          }
        }
      }
      return ok({ 会话ID列表: imported, 已导入: imported.length });
    },
  };
  return {
    methods,
    ready,
    subscribe: (fn) => {
      if (typeof fn !== 'function') throw new Error('观察者必须是函数');
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close: async () => {
      closed = true;
      await ready;
      for (const [id, run] of runs) {
        run.controller.abort();
        notify([id]);
      }
      await Promise.all(
        [...runs].map(([id, run]) => enqueue(id, async () => {}).then(() => run.promise)),
      );
      await Promise.all([...queues.values()]);
    },
  };
}
module.exports = { createCore };
