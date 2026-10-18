'use strict';
// 会话公开记录与 Summary 投影为 DSH 消息、轨迹和侧栏组件数据。

(function installViewBridge() {
  function text(value, fallback = '') {
    const result = value == null ? '' : String(value).trim();
    return result || fallback;
  }

  function strings(value) {
    return (Array.isArray(value) ? value : []).map((item) => text(item)).filter(Boolean);
  }

  function toolBlockFromTrace(trace, { actions = [] } = {}) {
    const name = trace.name,
      args = trace.args;
    const declaration = actions.find(action => `${action.模块}_${action.模型侧}` === name);
    let input = args;
    if (typeof args === 'string') {
      try { input = JSON.parse(args); } catch {}
    }
    const state = {
      pending: 'preparing',
      running: 'running',
      complete: 'ok',
      error: 'error',
      cancelled: 'stopped',
      interrupted: 'stopped',
    }[trace.status];
    return {
      kind: 'tool-call',
      callId: trace.id,
      name,
      title: declaration?.摘要 || name,
      variant: 'others',
      state,
      summary:
        state === 'error'
          ? text(trace.result?.reason, '调用失败')
          : input && typeof input === 'object'
            ? Object.entries(input).filter(([, value]) => typeof value === 'string' || typeof value === 'number').map(([key, value]) => `${key}：${value}`).join(' · ')
            : text(input),
      input,
      inputRaw: args,
      output: trace.result,
    };
  }

  function blocksFromMessage(message, { readImage, actions } = {}) {
    const row = message || {},
      blocks = [];
    function addImage(p) {
      const missing = p.imageId === null ? p.missing : null;
      const r = !missing && readImage ? readImage(p.imageId) : null;
      if (missing || r?.ok === false)
        blocks.push({
          kind: 'text',
          text:
            '图片 ' +
            (missing?.originalId || p.imageId) +
            ' 不可用：' +
            (missing?.reason || r.error?.message || r.reason),
        });
      else blocks.push({ kind: 'image', imageId: p.imageId, name: p.imageId });
    }
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      const k = Object.keys(value).sort().join(',');
      if (
        value.type === 'session-image' &&
        (k === 'imageId,type' || k === 'imageId,missing,type')
      ) {
        addImage(value);
        return;
      }
      for (const v of Object.values(value)) visit(v);
    }
    if (row.reasoning) blocks.push({ kind: 'reasoning', text: row.reasoning });
    for (const p of row.parts || []) {
      if (p.type === 'text' && p.text) blocks.push({ kind: 'text', text: p.text });
      else if (p.type === 'image') addImage(p);
    }
    for (const trace of row.toolCalls || []) {
      blocks.push(toolBlockFromTrace(trace, { actions }));
      visit(trace.result);
    }
    return blocks;
  }

  function chatMessageFrom(message, options = {}) {
    const row = message && typeof message === 'object' ? message : {};
    const role = row.role;
    return {
      id: text(row.id),
      turnId: row.turnId,
      role,
      time: Number.isFinite(row.createdAt) ? row.createdAt : undefined,
      streaming: row.status === 'streaming',
      blocks: blocksFromMessage(row, options),
    };
  }

  function chatMessagesFrom(session, options = {}) {
    const rows = Array.isArray(session?.messages) ? session.messages : [];
    const out = [];
    for (const row of rows) {
      const mapped = chatMessageFrom(row, options);
      if (mapped.blocks.length === 0) continue;
      out.push(mapped);
    }
    return out;
  }

  function chatTurnsFrom(session) {
    return (session?.turns || []).map(turn => {
      const messages = (session.messages || []).filter(message => message.turnId === turn.id && message.role === 'assistant');
      const final = messages.filter(message => !message.toolCalls.length && message.parts.some(part => part.type === 'text' && part.text.trim())).at(-1);
      const model = messages.filter(message => message.model).at(-1)?.model;
      return {
        id: turn.id,
        inputMessageId: turn.inputMessageId,
        messageIds: messages.map(message => message.id),
        finalMessageId: final?.id,
        status: turn.status === 'running' && session.运行状态 === '停止中' ? 'stopping' : turn.status,
        startedAt: turn.startedAt,
        endedAt: turn.endedAt,
        error: turn.error,
        model,
      };
    });
  }

  function sessionItemFrom(session, { currentId = '' } = {}) {
    const row = session && typeof session === 'object' ? session : {};
    const id = text(row.id);
    const count = row.messageCount;
    const selected = Boolean(id) && id === text(currentId);

    const subtitle = row.读不懂 || (row.未保存 ? '未保存' : '');
    return {
      id,
      title: text(row.title, '新对话'),
      subtitle: subtitle.length > 80 ? `${subtitle.slice(0, 79)}…` : subtitle,
      selected,
      updatedAt: Number.isFinite(row.updatedAt) ? row.updatedAt : 0,
      archived: false,
      pinned: false,
      blank: count === 0,
      running: row.running === true,
      completed: false,

      state: 'idle',
    };
  }

  function sectionsFromSessions(sessions, currentId) {
    const rows = Array.isArray(sessions) ? sessions : [];
    return {
      sections: [
        {
          id: 'sessions',
          title: '对话',
          expanded: true,
          items: rows.map((row) => sessionItemFrom(row, { currentId })),
        },
      ],
    };
  }

  function queueItemsFrom(raw) {
    const rows = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const item of rows) {
      if (!item || typeof item !== 'object') continue;
      const id = text(item.id);
      if (!id) continue;
      out.push({
        id,
        text: text(item.text),
        mode: item.mode === 'steer' ? 'steer' : 'queue',
      });
    }
    return out;
  }

  function tokenCountsFrom(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const prompt = Number(usage.prompt_tokens ?? usage.input_tokens) || 0;
    const completion = Number(usage.completion_tokens ?? usage.output_tokens) || 0;
    const total = Number(usage.total_tokens) || prompt + completion;
    if (prompt === 0 && completion === 0 && total === 0) return null;
    return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
  }

  function contextMeterDataFrom(sources = {}) {
    const counts = tokenCountsFrom(sources.usage);
    const windowTokens = Number.isFinite(sources.windowTokens) ? Number(sources.windowTokens) : NaN;
    const usedTokens = Number.isFinite(sources.usedTokens)
      ? Number(sources.usedTokens)
      : counts === null
        ? NaN
        : counts.totalTokens;

    if (!Number.isFinite(windowTokens) || !Number.isFinite(usedTokens)) return null;

    return {
      usedTokens,
      windowTokens,
      breakdown:
        sources.breakdown && typeof sources.breakdown === 'object' ? sources.breakdown : null,
    };
  }

  function imageResolver(resolveImage, variant = 'preview') {
    const resolve = typeof resolveImage === 'function' ? resolveImage : () => null;
    return {
      resolve(block) {
        const imageId = text(block?.imageId ?? block?.id ?? block);
        if (!imageId) return '';
        let found = null;
        try {
          found = resolve(imageId, variant);
        } catch {
          found = null;
        }
        return text(found?.dataUrl || found?.viewUrl);
      },
    };
  }

  const viewBridge = Object.freeze({
    text,
    strings,
    toolBlockFromTrace,
    blocksFromMessage,
    chatMessageFrom,
    chatMessagesFrom,
    chatTurnsFrom,
    sessionItemFrom,
    sectionsFromSessions,
    queueItemsFrom,
    tokenCountsFrom,
    contextMeterDataFrom,
    imageResolver,
  });

  if (typeof window !== 'undefined') window.dshViewBridge = viewBridge;
  if (typeof module !== 'undefined' && module.exports) module.exports = viewBridge;
})();
