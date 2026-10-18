'use strict';
/**
 * DSH 输入区 **状态层** —— 输入状态机 + 草稿权威入口 + 提交策略 + 汇流，
 * **原生 JS 实现**，逐行对照 `packages/client/ui-conversation` 的源码。
 *
 * 源码：`github.com/deepseek-ai/deepseek-harness`（MIT）
 *   src/client/input/machine.ts              （243 行）
 *   src/client/input/facade.ts               （902 行）
 *   src/client/input/submission-policy.ts    （ 86 行）
 *   src/client/input/hub.ts                  （292 行）
 *   src/client/input/submission-analytics.ts （ 21 行）
 *   src/client/input/blocks.ts               （ 44 行）
 *   src/client/input/decorations.ts          （ 70 行）
 *   src/client/draft.ts                      （ 82 行）
 *   src/client/stores.ts                     （ 74 行，草稿持久化读入口）
 *   src/client/submission-settings.ts        （ 32 行，常量）
 *   src/client/contract/{input,draft-editor,composer-submission,composer-blocks}.ts（类型面）
 *
 * 本文件只有状态与提交逻辑；**不建任何 DOM、不碰任何 DOM**。组件层
 * （`dsh-composer.js`）与挂载层（`dsh-mount.js`）照旧，本文件是它们下面的那一层。
 *
 * ── 不变量（逐条对应源码里的契约） ───────────────────────────────────────────
 * ① **草稿只有一份权威**：`SessionInputShell` 持有编辑器投影（`clipboardText` /
 *    `occurrences`）与 `rev`；任何写入都经 `setDraft` / 编辑器编辑 →
 *    `onEditorUpdate` → `rev += 1` → 发布。外部**不得**另存一份草稿文本。
 * ② **提交是一个事务**：`enter` → 机器发 `default-sink` + `commit-draft` 两个 effect。
 *    effect 顺序不可交换 —— `default-sink` 先捕获 sink 输入（`attempt.draftSnapshot`
 *    与附件 id 快照），`commit-draft` 后清编辑器；反过来就把要发的内容清掉了。
 * ③ **乐观清 + 失败还原**：正文在 `commit-draft` 当场清；附件在 `sinkSerialized`
 *    当场清。失败（`sink-settled ok:false` / promise reject）走
 *    `settleDetachedFailure` → `restoreAttachments` + `restoreFailedDrafts`，
 *    正文与附件**一起回来**。成功路径不需要额外清理 —— 已经清过了。
 * ④ **`rev` 只在内容变化时递增**（`projectionContentChanged`）；纯光标移动不动
 *    `rev`、不发布状态。span 的 CAS 比较的就是这个值。
 * ⑤ **`seq` 是提交面唯一的 id 概念**：`mintAttempt` 自增，settlement 用 `seq`
 *    对号入座，对不上的一律丢弃（anti-backwash）。命令提交占唯一 in-flight 槽；
 *    普通消息在 Enter 处 detach，可并发多条。
 *
 * ⚠️ **未移植**（见文件末尾 `UNPORTED` 常量与每条代码前的 `⚠️ 未移植：` 注释）：
 * Lexical 编辑器及其 projection/span-map/keymap/view-binding、React hook、cordis
 * 作用域 fiber / slot / i18n 字典、zustand+immer 存储引擎内部、zod。
 * 这些地方在本文件里走**结构化端口**（调用方注入），不是照抄。
 *
 * ⚠️ 三条本文件的新增（非移植）代码，集中在两处：
 *   · `createTextEditorPort()` —— 编辑器端口的纯文本最小实现（源码里这一层是
 *     Lexical，本次不移植；没有它本文件无法在纯 JS 里跑起来）。
 *   · `createSnapshotStore()` / `produce()` / `deepFreeze()` ——
 *     `@deepseek-ai/dsh-client-store` 的本地等价子集（源码里是 zustand + immer）。
 */
(function installDshInputState() {

/* ══════════════════════════════════════════════════════════════════════════
 * 0. submission-settings.ts —— 常量与字段名（逐字照抄）
 * ══════════════════════════════════════════════════════════════════════════ */

/** 设置命名空间，由 conversation 插件拥有。 */
const CONVERSATION_SETTINGS_NAMESPACE = 'ui-conversation';
/** 承载「忙碌时 Enter 的投递模式」的字段名。 */
const BUSY_ENTER_FIELD = 'busyEnter';
/** 设置面与输入面都接受的忙碌 Enter 行为（顺序即设置面枚举顺序）。 */
const BUSY_ENTER_BEHAVIORS = Object.freeze(['queue', 'steer']);
/** 默认值：运行中的会话保持 Enter = 排队。 */
const DEFAULT_BUSY_ENTER_BEHAVIOR = 'queue';

/* ══════════════════════════════════════════════════════════════════════════
 * 1. @deepseek-ai/dsh-client-store 的本地等价子集
 *
 * 源码 packages/client/store/src/index.ts 是 zustand vanilla + immer +
 * subscribeWithSelector + rafFlush + dev freeze。这里保留**对外可观测语义**：
 *   · getSnapshot() 在 set/update 之间返回**同一引用**（订阅方的 uSES 依赖它）；
 *   · subscribe(fn) 每次写入都回调（无相等性过滤，zustand 的原语义）；
 *   · subscribe 返回退订函数；
 *   · flush 默认 'sync'（受控输入需要同 tick 回显），'raf' 把一帧内的多次写入
 *     合并成一次通知。
 * ⚠️ 未移植：zustand/immer 本体、`defineStore` 声明式外壳、localStorage 持久化
 *    中间件（`attachPersistence`）、`shallowEqual`。
 * ⚠️ 语义改动：`update(mutator)` 用**浅拷贝 produce**，不是 immer 的结构共享
 *    produce（嵌套对象是共享引用，原地写会串味）。本文件自身不调用 `update`，
 *    发布走 `set`。
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 逐个回调观察者；单个回调抛错不拖垮其余回调。
 * @param {Iterable<Function>} listeners 当前回调集合（派发前先拷贝）。
 * @param {string} label 诊断用归属前缀。
 * @param {...unknown} args 回调实参。
 */
function notifySubscribers(listeners, label, ...args) {
  for (const listener of [...listeners]) {
    try {
      listener(...args);
    } catch (error) {
      console.error(`${label} subscriber failed:`, error);
    }
  }
}

/**
 * 把一帧内的多次通知合并成一次；无 rAF 时退回微任务（两者都保持
 * 「一个 tick 内 N 次变化 = 1 次通知」的契约）。
 * @param {() => void} notify 实际派发函数。
 * @returns {() => void} 触发一次调度（已排期则忽略）。
 */
function rafBatch(notify) {
  const schedule = typeof requestAnimationFrame === 'function'
    ? (fn) => { requestAnimationFrame(() => { fn(); }); }
    : (fn) => { queueMicrotask(fn); };
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      notify();
    });
  };
}

/**
 * 递归冻结普通对象/数组（immer `freeze(value, true)` 的等价物）。
 * 已冻结的值直接返回，因此环与重复引用不会无限递归。
 * @param {unknown} value 待冻结值。
 * @returns {unknown} 同一个值。
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

/** 非生产环境下深冻结整体替换的状态（`set()` 绕过了 immer 的冻结）。 */
function devFreeze(value) {
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') return value;
  return deepFreeze(value);
}

/**
 * ⚠️ 语义改动：浅拷贝版 immer `produce`。mutator 返回非 undefined 时以返回值为准。
 * @param {unknown} base 当前状态。
 * @param {(draft: any) => unknown} mutator 草稿改写函数。
 * @returns {unknown} 下一状态。
 */
function produce(base, mutator) {
  if (base === null || typeof base !== 'object') {
    const result = mutator(base);
    return result === undefined ? base : result;
  }
  const copy = Array.isArray(base) ? base.slice() : { ...base };
  const result = mutator(copy);
  return result === undefined ? copy : result;
}

/**
 * 建一个快照存储。
 * @param {unknown} init 初始状态（原样持有，不做拷贝）。
 * @param {{flush?: 'raf'|'sync'}} [opts] flush 模式；默认 'sync'。
 * @returns {{getSnapshot: Function, subscribe: Function, update: Function, set: Function}}
 */
function createSnapshotStore(init, opts) {
  let state = init;
  const listeners = new Set();
  let notify;
  if (opts && opts.flush === 'raf') {
    const pending = new Set();
    const batch = rafBatch(() => {
      const snapshot = [...pending];
      pending.clear();
      notifySubscribers(snapshot, '[client-store]');
    });
    notify = () => {
      for (const fn of listeners) pending.add(fn);
      batch();
    };
  } else {
    notify = () => { notifySubscribers(listeners, '[client-store]'); };
  }
  return {
    getSnapshot: () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    update: (mutator) => {
      state = produce(state, mutator);
      notify();
    },
    set: (next) => {
      state = devFreeze(next);
      notify();
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. draft.ts —— 语义草稿快照（解析 / 拷贝 / 快照 / 持久化解码）
 * ⚠️ 未移植：zod（`referenceSchema` / `snapshotSchema`）。
 *    这里手写等价校验，并保持 zod 的**默认非严格**行为：未声明字段被剥掉，
 *    输出只含下列字段。判定顺序与 refine 一致。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 引用外观枚举（zod `z.enum(['session','file','folder'])`）。 */
const REFERENCE_APPEARANCES = Object.freeze(['session', 'file', 'folder']);

/** 复制一条引用，去掉编辑器本地身份（occurrenceId 不在契约里）。 */
function copyReference(reference) {
  return {
    source: reference.source,
    ref: reference.ref,
    offset: reference.offset,
    length: reference.length,
    label: reference.label,
    clipboardText: reference.clipboardText,
    ...(reference.appearance === undefined ? {} : { appearance: reference.appearance }),
    ...(reference.invalid === undefined ? {} : { invalid: reference.invalid }),
  };
}

/**
 * 把输入收进语义草稿表示（不携带编辑器运行时身份）。
 * @param {string|{text: string, references: Array}} input 纯文本或调用方持有的结构化内容。
 * @returns {{text: string, references: Array}}
 */
function resolveDraftInput(input) {
  if (typeof input === 'string') return { text: input, references: [] };
  return { text: input.text, references: input.references.map(copyReference) };
}

/**
 * 导出引用身份（丢弃编辑器本地 occurrenceId）。
 * @param {string} text 当前 clipboard 投影。
 * @param {Array} occurrences 同一文档修订的引用投影。
 * @returns {{text: string, references: Array}}
 */
function snapshotDraft(text, occurrences) {
  return { text, references: occurrences.map(copyReference) };
}

/** 整数判定（zod `z.number().int()`）。 */
function isInteger(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

/** 单条引用校验 + 字段收窄（zod referenceSchema 的等价最小实现）。 */
function parseReference(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (typeof value.source !== 'string') return undefined;
  if (typeof value.ref !== 'string') return undefined;
  if (!isInteger(value.offset) || value.offset < 0) return undefined;
  if (!isInteger(value.length) || value.length <= 0) return undefined;
  if (typeof value.label !== 'string') return undefined;
  if (value.appearance !== undefined && REFERENCE_APPEARANCES.indexOf(value.appearance) < 0) return undefined;
  if (typeof value.clipboardText !== 'string') return undefined;
  if (value.invalid !== undefined && typeof value.invalid !== 'boolean') return undefined;
  return {
    source: value.source,
    ref: value.ref,
    offset: value.offset,
    length: value.length,
    label: value.label,
    clipboardText: value.clipboardText,
    ...(value.appearance === undefined ? {} : { appearance: value.appearance }),
    ...(value.invalid === undefined ? {} : { invalid: value.invalid }),
  };
}

/**
 * 解码持久化草稿，兼容早期的纯字符串表示。
 * @param {unknown} value 从浏览器存储读出的 JSON 值。
 * @returns {{text: string, references: Array}|undefined} 非法数据返回 undefined。
 */
function parseStoredDraft(value) {
  if (typeof value === 'string') return resolveDraftInput(value);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (typeof value.text !== 'string' || !Array.isArray(value.references)) return undefined;
  const references = [];
  for (const raw of value.references) {
    const reference = parseReference(raw);
    if (reference === undefined) return undefined;
    references.push(reference);
  }
  // refine：引用必须是有序、互不重叠、长度等于 clipboardText 长度、且文本对得上
  let end = 0;
  for (const reference of references) {
    if (reference.offset < end || reference.length !== reference.clipboardText.length) return undefined;
    end = reference.offset + reference.length;
    if (end > value.text.length || value.text.slice(reference.offset, end) !== reference.clipboardText) return undefined;
  }
  return { text: value.text, references };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. machine.ts —— SubmitMachine（纯每会话提交面状态机）
 *
 * 事件进、effect 出；零 React / DOM / cordis。被认领的命令占**唯一冻结的
 * in-flight 槽**；普通消息在 Enter 处 detach，因此编辑器可以立刻清空并接受
 * 下一条消息，而上一条的准入仍在飞。
 * ⚠️ 语义改动：TS `private` 字段在 JS 里是普通属性（无 `#` 私有字段，便于与
 *    源码逐行比对）。除此以外逐行一致。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 闭合 InputEvent 联合的兜底（判无遗漏）。 */
function unreachable(value) {
  throw new Error(`unreachable input event: ${JSON.stringify(value)}`);
}

/**
 * 从被认领命令的提交期草稿里剥掉命令 token。
 * 三段判定，顺序固定：完整 token 前缀 → 去尾空格的 token 前缀（吃掉一个分隔空白）
 * → 都不匹配返回空串。
 * @param {string} draft 提交期草稿。
 * @param {string} token 认领 token（含参数分隔符）。
 * @returns {string} 参数文本。
 */
function argsAfter(draft, token) {
  const s = draft.trimStart();
  if (s.startsWith(token)) return s.slice(token.length);
  const base = token.trimEnd();
  if (s.startsWith(base)) {
    const rest = s.slice(base.length);
    return /^\s/.test(rest) ? rest.slice(1) : rest;
  }
  return '';
}

/**
 * 认领名可以单独存在；带参数则要求 token 的分隔符。
 * @param {string} draft 当前草稿。
 * @param {string} token 认领 token。
 * @returns {boolean} 是否仍持有该认领。
 */
function retainsClaim(draft, token) {
  return draft.startsWith(token) || draft === token.trimEnd();
}

/** 一个会话来输入的状态机：phase / claim / attempt 的全部所有权。 */
class SubmitMachine {
  constructor() {
    this.phase = 'plain';
    this.claim = undefined;
    this.seq = 0;
    this.inflight = undefined;
    /** 已从编辑器 detach 的普通发送，保留用于结算校验与取消。 */
    this.detached = new Map();
  }

  /** 提交面状态的只读快照。 */
  get state() {
    const c = this.claim;
    return {
      phase: this.phase,
      ...(c
        ? {
          claim: {
            name: c.name,
            token: c.token,
            ...(c.hint !== undefined ? { hint: c.hint } : {}),
            ...(c.attachments === true ? { attachments: true } : {}),
          },
        }
        : {}),
    };
  }

  /**
   * 喂一个事件过机器。
   * @param {{type: string}} ev 提交面事件。
   * @returns {ReadonlyArray<object>} 给 shell 的 effect，按执行顺序。
   */
  dispatch(ev) {
    switch (ev.type) {
      case 'draft-changed': return this.onDraftChanged(ev.draft);
      case 'claim': return this.onClaim(ev.claim);
      case 'enter': return this.onEnter(ev.mode, ev.draft, ev.submission);
      case 'adjudicated': return this.onAdjudicated(ev.attempt, ev.outcome);
      case 'adjudication-failed': return this.onAdjudicationFailed(ev.attempt, ev.message);
      case 'submit-settled': return this.onSubmitSettled(ev);
      case 'sink-settled': return this.onSinkSettled(ev);
      case 'send-committed': return this.onSendCommitted();
      case 'release': return this.onRelease();
      default: return unreachable(ev);
    }
  }

  /** 完整命令名带不带参数分隔符都保持认领。 */
  onDraftChanged(draft) {
    if (this.phase === 'claimed' && this.claim !== undefined && !retainsClaim(draft, this.claim.token)) {
      this.phase = 'plain';
      this.claim = undefined;
    }
    return [];
  }

  /** 编辑器已应用 claim-token 替换；busy 相位拒绝再次认领。 */
  onClaim(claim) {
    if (this.phase !== 'plain' && this.phase !== 'claimed') return [];
    this.claim = claim;
    this.phase = 'claimed';
    return [];
  }

  /** 铸造一个 attempt 及其 controller，暂不指定生命周期归属。 */
  mintAttempt(mode, draft, submission) {
    const controller = new AbortController();
    this.seq += 1;
    return {
      attempt: {
        seq: this.seq,
        signal: controller.signal,
        draftSnapshot: draft,
        mode,
        ...(submission === undefined ? {} : { submission }),
      },
      controller,
    };
  }

  /** 铸造冻结的命令/裁决 attempt（占唯一 in-flight 槽）。 */
  beginAttempt(mode, draft, submission) {
    const flight = this.mintAttempt(mode, draft, submission);
    this.inflight = flight;
    return flight.attempt;
  }

  /** 铸造一条离开 phase 的普通发送（phase 留在 plain）。 */
  beginDetached(mode, draft, submission) {
    const flight = this.mintAttempt(mode, draft, submission);
    this.detached.set(flight.attempt.seq, flight.controller);
    this.claim = undefined;
    this.phase = 'plain';
    return flight.attempt;
  }

  /**
   * 默认发送的 effect 组合。**顺序不可交换**：`default-sink` 在编辑器提交之前
   * 捕获 sink 输入（`attempt.draftSnapshot` / `attempt.mode`），`commit-draft`
   * 随后才清正文并保留编辑期内新敲的后缀。
   */
  detachedEffects(attempt) {
    return [
      { type: 'default-sink', attempt, draft: attempt.draftSnapshot, mode: attempt.mode },
      { type: 'commit-draft', retainSuffixOf: attempt.draftSnapshot },
    ];
  }

  onEnter(mode, draft, submission) {
    if (this.phase === 'adjudicating' || this.phase === 'submitting') return [];
    if (this.phase === 'claimed' && this.claim !== undefined) {
      const attempt = this.beginAttempt(mode, draft, submission);
      this.phase = 'submitting';
      return [{ type: 'begin-submit', attempt, claim: this.claim, args: argsAfter(draft, this.claim.token) }];
    }
    const trimmed = draft.trim();
    if (trimmed === '') return [];
    if (trimmed.startsWith('/')) {
      const attempt = this.beginAttempt(mode, draft, submission);
      this.phase = 'adjudicating';
      return [{ type: 'adjudicate', attempt, draft }];
    }
    return this.detachedEffects(this.beginDetached(mode, draft, submission));
  }

  onAdjudicated(attempt, outcome) {
    const flight = this.inflight;
    if (this.phase !== 'adjudicating' || flight === undefined || flight.attempt.seq !== attempt.seq) return [];
    // ⚠️ 语义改动：源码靠 TS 联合静态排除 `'handled'` 之外的字符串；
    // JS 里 `'claim' in <string>` 会抛 TypeError，因此显式加 typeof 判定。
    if (outcome !== undefined && outcome !== 'handled'
      && typeof outcome === 'object' && outcome !== null && 'claim' in outcome) {
      this.claim = outcome.claim;
      this.phase = 'submitting';
      return [{
        type: 'begin-submit',
        attempt,
        claim: outcome.claim,
        args: argsAfter(attempt.draftSnapshot, outcome.claim.token),
      }];
    }
    this.inflight = undefined;
    this.phase = 'plain';
    // outcome 存在（insert / text / 'handled'）：管线已消化这一行，草稿留给编辑器。
    if (outcome !== undefined) return [];
    // outcome 为 undefined：没有管线挂载，'/' 行就是普通消息。
    this.detached.set(attempt.seq, flight.controller);
    return this.detachedEffects(attempt);
  }

  onAdjudicationFailed(attempt, message) {
    if (this.phase !== 'adjudicating' || this.inflight?.attempt.seq !== attempt.seq) return [];
    this.inflight = undefined;
    this.phase = 'plain';
    return [{ type: 'notice', level: 'error', text: message }];
  }

  /** 认领命令的结算保持冻结的事务语义。 */
  onSubmitSettled(ev) {
    const flight = this.inflight;
    if (this.phase !== 'submitting' || flight === undefined || flight.attempt.seq !== ev.attempt.seq) return [];
    this.inflight = undefined;
    if (ev.ok) {
      this.phase = 'plain';
      this.claim = undefined;
      const effects = [{ type: 'commit-draft', retainSuffixOf: flight.attempt.draftSnapshot }];
      if (ev.outcome?.text !== undefined) {
        effects.push({ type: 'notice', level: ev.outcome.kind === 'error' ? 'error' : 'info', text: ev.outcome.text });
      }
      return effects;
    }
    const text = ev.message ?? ev.outcome?.text;
    if (ev.draft === flight.attempt.draftSnapshot
      && this.claim !== undefined && retainsClaim(ev.draft, this.claim.token)) {
      this.phase = 'claimed';
      return text === undefined ? [] : [{ type: 'notice', level: 'error', text }];
    }
    this.phase = 'plain';
    this.claim = undefined;
    return text === undefined ? [] : [{ type: 'notice', level: 'error', text }];
  }

  /** 一条普通发送独立结算，与当前相位及其它 detach 发送无关。 */
  onSinkSettled(ev) {
    if (!this.detached.delete(ev.attempt.seq)) return [];
    const text = ev.message ?? ev.outcome?.text;
    if (text === undefined) return [];
    return [{ type: 'notice', level: ev.ok && ev.outcome?.kind !== 'error' ? 'info' : 'error', text }];
  }

  /** 纯附件发送被接受后清空；它没有正文后缀需要保留。 */
  onSendCommitted() {
    if (this.phase !== 'plain') return [];
    this.claim = undefined;
    return [{ type: 'commit-draft', retainSuffixOf: null }];
  }

  onRelease() {
    if (this.inflight !== undefined) {
      this.inflight.controller.abort();
      this.inflight = undefined;
    }
    for (const controller of this.detached.values()) controller.abort();
    this.detached.clear();
    this.phase = 'plain';
    this.claim = undefined;
    return [];
  }
}

/** 源码类名即 `SubmitMachine`；工厂别名便于全局面使用。 */
function createInputMachine() {
  return new SubmitMachine();
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. submission-policy.ts —— resolveSubmitMode + 忙碌 Enter 偏好
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 把一次提交手势解析成 queue/steer 投递模式。
 *
 * **判定顺序固定**（交换次序行为就不同）：
 *   ① `!running || !steeringAvailable` → 'queue'（`!running` 先短路）
 *   ② `gesture === 'enter'` → preferred（普通 Enter 与主发送按钮同一个手势）
 *   ③ `preferred === 'queue'` → 'steer'
 *   ④ 其余 → 'queue'
 *
 * @param {'queue'|'steer'} preferred 实时忙碌 Enter 偏好。
 * @param {boolean} running 被寻址 agent 是否报告忙碌。
 * @param {'enter'|'accelerated'} gesture 普通 Enter（或发送按钮）还是 Cmd/Ctrl 加速键。
 * @param {boolean} steeringAvailable 该会话传输是否支持插话。
 * @returns {'queue'|'steer'} 投递模式。
 */
function resolveSubmitMode(preferred, running, gesture, steeringAvailable) {
  if (!running || !steeringAvailable) return 'queue';
  if (gesture === 'enter') return preferred;
  return preferred === 'queue' ? 'steer' : 'queue';
}

/**
 * 忙碌 Enter 偏好：一个实时 store，被提交手势与 Settings 行共享。
 * ⚠️ 未移植：cordis `ConfigForm` 宿主文档订阅（`host` 换成本文件的结构化端口
 *    `{ getSnapshot(), subscribe(fn), set(field, value) }`；缺省即浏览器本地默认）。
 */
class ComposerSubmissionPolicy {
  /**
   * @param {{getSnapshot: Function, subscribe: Function, set: Function}} [host] 共享配置表单。
   */
  constructor(host) {
    /** 组件条与 Settings 行共读的响应式偏好源。 */
    this.busyEnter = createSnapshotStore(DEFAULT_BUSY_ENTER_BEHAVIOR);
    this.host = host;
    this.unsubscribe = undefined;
    if (host !== undefined) {
      this.unsubscribe = host.subscribe(() => { this.adopt(host); });
      this.adopt(host);
    }
  }

  /** 释放偏好订阅。 */
  dispose() {
    if (this.unsubscribe !== undefined) this.unsubscribe();
  }

  /**
   * 改忙碌态提交行为；实时值先于持久化写入发布。
   * @param {'queue'|'steer'} behavior Queue 或 Steer。
   */
  setBusyEnter(behavior) {
    if (this.busyEnter.getSnapshot() === behavior) return;
    this.busyEnter.set(behavior);
    if (this.host !== undefined) void this.host.set(BUSY_ENTER_FIELD, behavior);
  }

  /** 采纳作用域已确认的持久化行为，不回写。 */
  adopt(host) {
    const section = host.getSnapshot().value;
    if (section === undefined || this.busyEnter.getSnapshot() === section.busyEnter) return;
    this.busyEnter.set(section.busyEnter);
  }
}

function createComposerSubmissionPolicy(host) {
  return new ComposerSubmissionPolicy(host);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5. facade.ts —— SessionInputShell：草稿读写与提交的唯一权威入口
 *
 * 源码里这个 shell 还持有**每会话的 Lexical 编辑器**（文本 + chip 真相）；
 * 本文件把编辑器抽成端口 `deps.editorFactory`（调用签名与源码里
 * `new DraftEditorRuntime({...})` 一致），其余逐行照抄：
 * 投影与 InputState 发布、scoped event 应用动词、提交事务管道
 * （adjudicate / claim.submit / default sink）、notice 通道、草稿持久化镜像。
 * ⚠️ 未移植：`LexicalEditor` 实体（`editor` getter 返回端口给的值，纯文本端口为 null）。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 由机器相位导出的守卫层级。 */
function guardOf(phase) {
  switch (phase) {
    case 'plain': return 'plain';
    case 'claimed': return 'claimed';
    default: return 'frozen'; // adjudicating / submitting
  }
}

/** 两个投影是否内容有变（选区与光标不计）。 */
function projectionContentChanged(prev, next) {
  if (prev.clipboardText !== next.clipboardText || prev.detectText !== next.detectText) return true;
  if (prev.occurrences.length !== next.occurrences.length) return true;
  return next.occurrences.some((occ, i) => {
    const old = prev.occurrences[i];
    return old === undefined || old.occurrenceId !== occ.occurrenceId || old.invalid !== occ.invalid;
  });
}

/** Inbox 空投影常量。 */
const EMPTY_QUEUE = Object.freeze([]);

/** 不可用目录里没有任何具名文本引用。 */
const EMPTY_LEXICON = new Map();

/** 每会话输入门面：编辑投影 + 提交面状态 + 队列叠加（InputZone 通货）。 */
class SessionInputShell {
  /**
   * @param {object} deps 构造依赖（见 `createDraftFacade` 的文档）。
   */
  constructor(deps) {
    this.deps = deps;
    this.core = new SubmitMachine();
    /** 最新通知（清除后为 null）。 */
    this.notices = createSnapshotStore(null);
    this.rev = 0;
    this.noticeSeq = 0;
    this.lastPublishedDraft = undefined;
    this.draftSnapshotCache = undefined;
    this.attachmentIds = [];
    this.disposed = false;
    this.persistDraft = undefined;
    this.filePicker = undefined;
    /** 未结算的 detach 发送，保留到准入结算或作用域释放其附件。 */
    this.detachedDrafts = new Map();
    /** 失败待还原的 detach 发送，按提交顺序一起重建。 */
    this.failedDetached = new Map();
    /** 最近一次自动失败还原的 rev。 */
    this.failedRestoreRev = undefined;
    this.restoringFailures = false;
    this.attachmentFlightSeq = 0;
    /** 纯附件发送，保留到准入结算或作用域释放其附件。 */
    this.attachmentFlights = new Map();
    this.unsubscribeInbox = undefined;

    /** 公开的 provide 通道动作面（每会话一个稳定身份）。 */
    this.actions = {
      captureInsertion: () => ({ ...this.caretSpan(), draftRev: this.rev }),
      insertText: (text, span) => {
        if (this.snapshot.phase === 'adjudicating' || this.snapshot.phase === 'submitting' || this.disposed) return false;
        if (span.draftRev !== this.rev) return false;
        return this.draftEditor.insertAsyncText(span, text);
      },
      setDraft: (text) => { this.setDraft(text); },
      persistDraft: () => { this.persistCurrentDraft(); },
      addAttachments: ids => this.addAttachments(ids),
      removeAttachment: (id) => { this.removeAttachment(id); },
      pruneAttachments: (ids) => { this.pruneAttachments(ids); },
      submit: () => { this.submit('queue'); },
    };

    /**
     * 热纯文本引用目录源（装饰扫描用）。稳定身份；没有管线时快照是空 Map，
     * 订阅方永不触发。
     */
    this.lexicon = {
      getSnapshot: () => this.deps.inputTriggers?.()?.lexicon.getSnapshot() ?? EMPTY_LEXICON,
      subscribe: fn => this.deps.inputTriggers?.()?.lexicon.subscribe(fn) ?? (() => {}),
    };

    // 源码：this.draftEditor = new DraftEditorRuntime({ onUpdate, openReference,
    // activeClaimToken, lexicon, resolveLexicon })；本文件只把构造器换成端口工厂。
    this.draftEditor = this.deps.editorFactory({
      onUpdate: () => { this.onEditorUpdate(); },
      openReference: (source, reference) =>
        this.deps.inputTriggers?.()?.openReference(source, reference) ?? false,
      activeClaimToken: () => this.activeClaimToken(),
      lexicon: () => this.lexicon.getSnapshot(),
      resolveLexicon: () => this.deps.inputTriggers?.()?.lexicon,
    });
    this.unregister = this.draftEditor.register();
    this.state = createSnapshotStore(this.compose());
    this.unsubscribeInbox = deps.inbox?.subscribe(() => { this.publish(); });
  }

  /** 端口持有的编辑器（纯文本端口为 null；Lexical 实体未移植）。 */
  get editor() {
    return this.draftEditor.editor;
  }

  /** 当前编辑器投影。 */
  get projection() {
    return this.draftEditor.projection;
  }

  /** 读实时输入状态（守卫派生读这里）。 */
  get snapshot() {
    return this.state.getSnapshot();
  }

  // ---- 编辑器管道 ----

  /**
   * 每次编辑器提交后：重投影、跑认领完整性检查、发布、喂触发跟踪。
   * 纯选区提交既不推进 rev 也不发布状态：菜单仍旧跟踪光标，而 draftRev 只在
   * 内容变化时前进，因此快照构造的 span（draftRev CAS）在光标移动间保持有效，
   * 订阅方也不会因光标移动重渲染。
   */
  onEditorUpdate() {
    const prev = this.draftEditor.refreshProjection();
    if (projectionContentChanged(prev, this.projection)) {
      this.rev += 1;
      if (!this.restoringFailures && this.failedRestoreRev !== undefined) {
        this.failedDetached.clear();
        this.failedRestoreRev = undefined;
      }
      this.dispatchRun({ type: 'draft-changed', draft: this.projection.clipboardText });
    }
    const caret = this.projection.caret;
    if (caret !== null) {
      this.deps.inputTriggers?.()?.track(
        this.projection.detectText, caret, { tier: guardOf(this.core.state.phase) }, this.rev,
      );
    }
  }

  // ---- 门面动作 ----

  /**
   * 整体替换草稿（持久化草稿种子与程序化写入）。占位符已净化；换行切段；
   * 光标落到末尾。
   * @param {string|{text: string, references: Array}} text 纯文本或完整语义文档。
   */
  setDraft(text) {
    const draft = resolveDraftInput(text);
    if (draft.references.length === 0) this.draftEditor.setDraft(draft.text);
    else this.draftEditor.restoreDraft(draft.text, draft.references);
  }

  /** 不等待下一次编辑，重连可选目录通知。 */
  refreshLexiconSubscription() {
    if (!this.disposed) this.draftEditor.refreshLexiconSubscription();
  }

  /** 当前语义文档；内容修订不变时引用不变。 */
  get draftSnapshot() {
    if (this.draftSnapshotCache?.revision === this.rev) return this.draftSnapshotCache.value;
    const value = snapshotDraft(this.projection.clipboardText, this.projection.occurrences);
    this.draftSnapshotCache = { revision: this.rev, value };
    return value;
  }

  /** 不改编辑器、不绑定写入者，只持久化最新文档。 */
  persistCurrentDraft() {
    this.persistDraft?.(this.draftSnapshot);
  }

  /**
   * 把一次新任务请求应用到已初始化的输入模型上。
   * @param {{prompt?: string, clearPreviousDraft?: boolean}} options 替换内容与显式清空许可。
   * @returns {'applied'|'preserved'|'blocked'} 请求文本被采纳即 applied（即便没变）；
   *   保留当前草稿为 preserved；已释放或提交在飞为 blocked。
   */
  requestDraftInitialization(options) {
    if (this.draftInitializationBlocked()) return 'blocked';
    if (options.prompt === undefined && options.clearPreviousDraft !== true) return 'preserved';
    if (options.clearPreviousDraft !== true && (this.snapshot.draft !== '' || this.attachmentIds.length > 0)) {
      return 'preserved';
    }
    this.setDraft(options.prompt ?? '');
    return 'applied';
  }

  draftInitializationBlocked() {
    const { phase } = this.core.state;
    return this.disposed || phase === 'adjudicating' || phase === 'submitting'
      || this.detachedDrafts.size > 0 || this.attachmentFlights.size > 0;
  }

  /**
   * 追加有序附件 id；准入事务锁定时拒绝。
   * @param {ReadonlyArray<string>} ids 附件 id。
   * @returns {boolean} 是否接受。
   */
  addAttachments(ids) {
    if (this.snapshot.phase === 'adjudicating' || this.snapshot.phase === 'submitting') return false;
    if (ids.length === 0) return true;
    this.attachmentIds = [...this.attachmentIds, ...ids];
    this.publish();
    return true;
  }

  /**
   * 在准入可编辑期间加入已校验的文件引用与附件 id。
   * ⚠️ 未移植：chip 节点插入（`DraftEditorRuntime.insertFileReferences`）。
   * @param {ReadonlyArray<object>} references 源顺序的引用 chip。
   * @param {ReadonlyArray<string>} ids 新分配的附件 id。
   * @returns {boolean} 准入锁定或编辑器拒绝插入时为 false。
   */
  addFiles(references, ids) {
    if (this.snapshot.phase === 'adjudicating' || this.snapshot.phase === 'submitting') return false;
    if (!this.draftEditor.insertFileReferences(references)) return false;
    this.attachmentIds = [...this.attachmentIds, ...ids];
    this.publish();
    return true;
  }

  /**
   * 从草稿里移除一个附件 id。busy 准入相位拒绝，与 `addAttachments` 一致：
   * 落在命令提交序列化期间的移除，否则会从轨道上消失却仍随在飞的发送走。
   * @param {string} id 附件 id。
   * @returns {boolean} 是否移除了。
   */
  removeAttachment(id) {
    if (this.snapshot.phase === 'adjudicating' || this.snapshot.phase === 'submitting') return false;
    const next = this.attachmentIds.filter(candidate => candidate !== id);
    if (next.length === this.attachmentIds.length) return false;
    this.attachmentIds = next;
    this.publish();
    return true;
  }

  /**
   * 只保留仍能在浏览器附件注册表里解析的 id。
   * @param {ReadonlyArray<string>} available 活的注册表 id。
   */
  pruneAttachments(available) {
    const keep = new Set(available);
    const next = this.attachmentIds.filter(id => keep.has(id));
    if (next.length === this.attachmentIds.length) return;
    this.attachmentIds = next;
    this.publish();
  }

  /**
   * 作为成功发送的提交清空草稿：编辑器清空（不留下一个 undo 单元）并切断
   * undo 历史，因此 Ctrl/Cmd-Z 不能把已发内容退回编辑器（命令路径由 submit-settled
   * 得到同样的纪律）。
   * @param {ReadonlyArray<string>} attachmentIds 已被受理、要从本草稿移除的附件 id。
   */
  commitSend(attachmentIds) {
    const submitted = new Set(attachmentIds);
    this.attachmentIds = this.attachmentIds.filter(id => !submitted.has(id));
    this.dispatchRun({ type: 'send-committed' });
  }

  /**
   * 在当前编辑器选区上插入粘贴的纯文本（占位符净化）。粘贴事件自身的默认行为
   * 由调用方抑制。
   * @param {string} text 粘贴的纯文本。
   */
  paste(text) {
    this.draftEditor.paste(text);
  }

  /**
   * 进入裁决 + 提交事务 + 默认 sink。effect 由机器扇出，本方法只喂事件。
   * 锁进入（adjudicating/submitting）强制关闭瞬时层：popup 关、菜单跟踪冻结。
   * @param {'queue'|'steer'} [mode] 投递意图。
   * @param {'click'|'enter'} [source] 手势来源。
   */
  submit(mode = 'queue', source) {
    if (this.disposed) return;
    const timestamp = Date.now();
    let state;
    if (this.snapshot.phase === 'plain' && (this.snapshot.draft.trim() !== '' || this.attachmentIds.length > 0)) {
      try { state = this.deps.submissionState?.(); }
      catch (_error) { /* 可选的 Session 观测不得打断提交 */ }
    }
    const submission = Object.freeze({
      timestamp,
      mode,
      ...(source === undefined ? {} : { source }),
      ...(state === undefined ? {} : { state }),
    });
    if (this.snapshot.draft.trim() === '' && this.attachmentIds.length > 0) {
      if (this.snapshot.phase === 'plain') {
        const attachmentIds = [...this.attachmentIds];
        const controller = new AbortController();
        this.attachmentFlightSeq += 1;
        const flight = this.attachmentFlightSeq;
        this.attachmentFlights.set(flight, { controller, attachmentIds });
        this.commitSend(attachmentIds);
        this.notifySubmission(submission);
        void this.deps.defaultSink('', attachmentIds, mode, controller.signal).then((outcome) => {
          if (this.disposed || !this.attachmentFlights.delete(flight)) return;
          if (outcome.kind === 'success') return;
          this.restoreAttachments(attachmentIds);
          if (outcome.text !== undefined) this.notify('error', outcome.text);
        }, (error) => {
          if (this.disposed || !this.attachmentFlights.delete(flight)) return;
          this.restoreAttachments(attachmentIds);
          this.notify('error', error instanceof Error ? error.message : String(error));
        });
      }
      return;
    }
    // 认领前置门：声明不接受附件的认领，带附件时永不提交 —— 一条通知，全部保留。
    // Enter 期裁决对命令源内部未认领的行施加同一策略。
    const before = this.snapshot;
    if (before.phase === 'claimed' && this.attachmentIds.length > 0 && before.claim?.attachments !== true) {
      this.notify('error', this.deps.commandAttachments.unsupportedNotice(before.claim?.token ?? before.draft));
      return;
    }
    this.dispatchRun({ type: 'enter', mode, draft: this.projection.clipboardText, submission });
    const phase = this.snapshot.phase;
    if (phase === 'adjudicating' || phase === 'submitting') {
      this.deps.popup?.()?.dismiss();
      this.deps.inputTriggers?.()?.track(this.projection.detectText, 0, { tier: 'frozen' }, this.rev);
    }
  }

  /**
   * 菜单打开时的键盘裁决。
   * @param {'up'|'down'|'enter'|'escape'|'tab'|'tabBack'} key 被拦截的键。
   * @param {boolean} composing IME 组合守卫状态。
   * @returns {'consumed'|'pick-highlighted'|'pass'} 没有管线挂载时为 'pass'。
   */
  arbitrate(key, composing) {
    return this.deps.inputTriggers?.()?.arbitrate(key, composing) ?? 'pass';
  }

  /**
   * 把所有仍在排队的消息插进运行中的回合（空草稿加速 Enter 手势）。执行归
   * hub 的队列编排；缺依赖时退回机器的空草稿 no-op。
   */
  steerQueue() {
    this.deps.steerQueue?.();
  }

  /**
   * 在控制器的热状态上做空格裁决。
   * @returns {boolean} true = 应用了认领/插入，调用方 preventDefault。
   */
  space() {
    const inputTriggers = this.deps.inputTriggers?.();
    if (inputTriggers === undefined) return false;
    return inputTriggers.onSpace();
  }

  /** 关闭 popupSelect 外壳（框外任意交互）。 */
  dismissPopup() {
    this.deps.popup?.()?.dismiss();
  }

  /**
   * 实时选区作为 detect 坐标 span（菜单启动器的合成命中在 pick 时替换它）；
   * 无选区时回答文档末尾的折叠 span。
   * @returns {{start: number, end: number}} detect 坐标下的 [start, end)。
   */
  caretSpan() {
    return this.draftEditor.caretSpan();
  }

  // ---- scoped event 应用动词 ----

  /**
   * 应用一条命令认领：编辑器把 [0, span.end) 替换成 claim token，然后机器进入
   * claimed。
   * @param {object} claim pick 路径来的命令认领。
   * @param {{start: number, end: number, draftRev: number}} span pick 时刻的 span 快照。
   * @returns {boolean} 编辑是否应用（相位、span CAS、前导守卫都通过才算）。
   */
  beginCommand(claim, span) {
    const phase = this.core.state.phase;
    if (phase !== 'plain' && phase !== 'claimed') return false;
    if (span.draftRev !== this.rev) return false;
    // 前导触发契约：span 之前只允许空白；空白前缀被丢弃，认领完整性检查
    // （startsWith）才成立。
    if (this.projection.detectText.slice(0, span.start).trim() !== '') return false;
    const applied = this.draftEditor.replaceText({ start: 0, end: span.end }, claim.token);
    if (!applied) return false;
    this.dispatchRun({ type: 'claim', claim });
    return true;
  }

  /**
   * 应用一次引用插入：编辑器把 span 替换成一个 chip 节点，后面再跟一个分隔空格，
   * 除非下一个字符已经是空格。
   * ⚠️ 未移植：chip 节点（`editor/chip-node.tsx`）。纯文本端口恒返回 false。
   * @param {object} ref pick 路径来的引用插入。
   * @param {{start: number, end: number, draftRev: number}} span pick 时刻的 span 快照。
   * @returns {boolean} 编辑是否应用。
   */
  insertReference(ref, span) {
    const phase = this.core.state.phase;
    if (phase !== 'plain' && phase !== 'claimed') return false;
    if (span.draftRev !== this.rev) return false;
    const tail = this.projection.detectText.slice(span.end, span.end + 1);
    return this.draftEditor.insertReference(span, ref, tail);
  }

  /**
   * 业务成功后消费一个命令 token。span 守卫：修订 CAS 后 splice；裸 token 守卫：
   * 去空白草稿相等才清空。
   * @param {{kind: 'span', span: object}|{kind: 'bare-token', token: string}} guard 精确 span 或裸 token 守卫。
   * @returns {boolean} 是否消费了 token。
   */
  consumeToken(guard) {
    if (guard.kind === 'span') {
      if (guard.span.draftRev !== this.rev || guard.span.start === guard.span.end) return false;
      return this.draftEditor.replaceText(guard.span, '');
    }
    if (guard.token === '' || this.projection.clipboardText.trim() !== guard.token) return false;
    this.setDraft('');
    return true;
  }

  /**
   * 在 pick 时刻的 span 上插入纯引用文本（纯文本引用路径）。编辑器得到的是普通
   * 字符 —— 没有 chip 节点；chip 外观是扫描派生的装饰，永远不是状态。
   * @param {string} text 要 splice 进去的纯引用文本（例如 `/name `）。
   * @param {{start: number, end: number, draftRev: number}} span pick 时刻的 span 快照。
   * @param {boolean} [keepCompleting] 契约乘客；此处补全重开是自动的。
   * @returns {boolean} 文本是否应用。
   */
  insertText(text, span, keepCompleting = false) {
    void keepCompleting;
    if (span.draftRev !== this.rev) return false;
    return this.draftEditor.replaceText(span, text);
  }

  /**
   * 从机器之外浮出一条通知（detach 的命令结果）。
   * @param {'info'|'error'} level 严重层级。
   * @param {string} text 通知正文。
   */
  notify(level, text) {
    this.noticeSeq += 1;
    this.notices.set({ level, text, seq: this.noticeSeq });
  }

  /** 把键盘交回输入框，带上它上次持有的光标。 */
  focus() {
    this.draftEditor.focus?.();
  }

  // ---- 接线层附加（不在冻结的 SessionInput 面上） ----

  /**
   * 拆掉 shell，并返回草稿或未结算 detach 发送仍持有的全部浏览器附件。
   * @returns {ReadonlyArray<string>} 作用域释放方需要释放的附件 id。
   */
  dispose() {
    if (this.disposed) return [];
    const retained = new Set(this.attachmentIds);
    for (const record of this.detachedDrafts.values()) {
      for (const attachmentId of record.attachmentIds) retained.add(attachmentId);
    }
    for (const flight of this.attachmentFlights.values()) {
      for (const attachmentId of flight.attachmentIds) retained.add(attachmentId);
      flight.controller.abort();
    }
    this.disposed = true;
    this.dispatchRun({ type: 'release' });
    this.unsubscribeInbox?.();
    this.unregister();
    this.detachedDrafts.clear();
    this.failedDetached.clear();
    this.attachmentFlights.clear();
    return [...retained];
  }

  /**
   * 绑定 Conversation store 写入者，不导入也不保存内容。
   * @param {(draft: {text: string, references: Array}) => void} write 语义草稿写入者。
   * @returns {() => void} 解绑函数。
   */
  bindDraftPersistence(write) {
    this.persistDraft = write;
    return () => {
      if (this.persistDraft === write) this.persistDraft = undefined;
    };
  }

  /**
   * 绑定已挂载输入框的文件动作与实时接收可用性。
   * @param {{available: () => boolean, open: () => void}} picker 可用性查询与文件对话框打开器。
   * @returns {() => void} 解绑函数。
   */
  bindFilePicker(picker) {
    this.filePicker = picker;
    return () => {
      if (this.filePicker === picker) this.filePicker = undefined;
    };
  }

  /**
   * 读已挂载输入框的实时文件接收可用性。
   * @returns {boolean} 没有接受文件的输入框时为 false。
   */
  canPickFiles() {
    return this.filePicker?.available() === true;
  }

  /**
   * 已挂载输入框接受文件时打开原生文件对话框。
   * @returns {boolean} 打开器是否被调用。
   */
  pickFiles() {
    if (this.filePicker === undefined || !this.filePicker.available()) return false;
    this.filePicker.open();
    return true;
  }

  // ---- effect 执行器 ----

  /** 装饰变换要描边的认领 token；未认领时为 null。 */
  activeClaimToken() {
    const core = this.core.state;
    return (core.phase === 'claimed' || core.phase === 'submitting') && core.claim !== undefined
      ? core.claim.token
      : null;
  }

  /** 派发 + 执行，被描边 token 翻转时刷新认领装饰。 */
  dispatchRun(ev) {
    const beforeToken = this.activeClaimToken();
    const effects = this.core.dispatch(ev);
    this.run(effects);
    if (this.activeClaimToken() !== beforeToken) this.draftEditor.refreshClaimDecoration();
  }

  run(effects) {
    for (const fx of effects) this.execute(fx);
    this.publish();
  }

  execute(fx) {
    switch (fx.type) {
      case 'notice': {
        this.noticeSeq += 1;
        this.notices.set({ level: fx.level, text: fx.text, seq: this.noticeSeq });
        return;
      }
      case 'adjudicate': {
        this.adjudicate(fx.attempt, fx.draft);
        return;
      }
      case 'begin-submit': {
        this.beginSubmit(fx.attempt, fx.claim, fx.args);
        return;
      }
      case 'default-sink': {
        this.sinkSerialized(fx.attempt, fx.draft, fx.mode);
        return;
      }
      case 'commit-draft': {
        this.commitDraft(fx.retainSuffixOf);
        return;
      }
      // ⚠️ 语义改动：源码靠 TS 穷尽性，没有 default 分支；这里补一个兜底是
      // 仓库约定（闭合联合以 assertNever 收尾）。可达输入下行为不变。
      default: return unreachable(fx);
    }
  }

  /**
   * 执行 commit-draft effect：清掉已提交内容（快照允许时保留在飞期间纯敲进去的
   * 后缀），并切断 undo 历史，让已发内容不能退回编辑器。
   * @param {string|null} retainSuffixOf 要保留后缀所基于的草稿快照；null = 无条件清空。
   */
  commitDraft(retainSuffixOf) {
    this.draftEditor.clearCommittedDraft((clip) => {
      if (retainSuffixOf !== null && clip !== retainSuffixOf && clip.startsWith(retainSuffixOf)) {
        return retainSuffixOf.length;
      }
      return null;
    });
    this.draftEditor.clearHistory();
  }

  /**
   * sink 之前的提示词序列化：通过会话控制器的编解码路由把每个 chip occurrence
   * 展开成模型形态。owner 缺失或序列化失败会拒绝这条 detach 发送，并还原它的
   * 编辑器快照。无 chip 的草稿跳过异步绕行。
   *
   * 附件在这里**当场清空**（`this.attachmentIds = []`）——正文的清理在
   * `commit-draft`，附件在 `sinkSerialized`。失败时由
   * `settleDetachedFailure` 一起还原。
   */
  sinkSerialized(attempt, draft, mode) {
    this.notifySubmission(attempt.submission);
    const attachmentIds = [...this.attachmentIds];
    this.attachmentIds = [];
    const occurrences = this.projection.occurrences;
    const record = { draft, occurrences, attachmentIds };
    this.detachedDrafts.set(attempt.seq, record);
    if (this.failedRestoreRev === this.rev) {
      this.failedDetached.clear();
      this.failedRestoreRev = undefined;
    }
    if (occurrences.length === 0) {
      this.settleSink(attempt, this.deps.defaultSink(draft.trim(), attachmentIds, mode, attempt.signal));
      return;
    }
    const inputTriggers = this.deps.inputTriggers?.();
    void Promise.all(occurrences.map(async (o) => {
      if (inputTriggers === undefined) throw new Error(`no serializer for reference source "${o.source}"`);
      return {
        offset: o.offset,
        length: o.length,
        text: await inputTriggers.serializeReference(o.source, o.ref, attempt.signal),
      };
    })).then(
      (parts) => {
        if (this.disposed) return;
        // 把模型形态 splice 回它们的 clipboard 区间（offset 是 clipboard 投影
        // 坐标；parts 按 offset 有序，因为 chip 按文档顺序走）。
        let out = '';
        let cursor = 0;
        for (const part of parts) {
          out += draft.slice(cursor, part.offset) + part.text;
          cursor = part.offset + part.length;
        }
        out += draft.slice(cursor);
        this.settleSink(attempt, this.deps.defaultSink(out.trim(), attachmentIds, mode, attempt.signal));
      },
      (error) => {
        if (this.dead(attempt)) return;
        const message = error instanceof Error ? error.message : String(error);
        this.settleDetachedFailure(attempt, message);
      },
    );
  }

  notifySubmission(submission) {
    if (submission === undefined) return;
    try { this.deps.messageSubmitted?.(submission); }
    catch (_error) { /* 通知消费者不得打断提交 */ }
  }

  /** 一条 detach 默认发送独立结算，与其它发送无关。 */
  settleSink(attempt, pending) {
    pending.then(
      (outcome) => {
        if (this.dead(attempt)) return;
        if (outcome.kind !== 'success') {
          this.settleDetachedFailure(attempt, outcome.text);
          return;
        }
        this.detachedDrafts.delete(attempt.seq);
        this.dispatchRun({ type: 'sink-settled', attempt, ok: true, outcome });
      },
      (error) => {
        if (this.dead(attempt)) return;
        this.settleDetachedFailure(attempt, error instanceof Error ? error.message : String(error));
      },
    );
  }

  /** 还原一条失败的 detach 发送，且不覆盖还原之后敲进去的文本。 */
  settleDetachedFailure(attempt, message) {
    const record = this.detachedDrafts.get(attempt.seq);
    if (record === undefined) return;
    this.detachedDrafts.delete(attempt.seq);
    this.restoreAttachments(record.attachmentIds);
    this.failedDetached.set(attempt.seq, record);
    if (this.projection.clipboardText === '' || this.failedRestoreRev === this.rev) {
      this.restoreFailedDrafts();
    }
    this.dispatchRun({
      type: 'sink-settled', attempt, ok: false,
      ...(message === undefined ? {} : { message }),
    });
  }

  /** 按提交顺序重建当前全部失败快照（分隔符为两个换行）。 */
  restoreFailedDrafts() {
    const records = [...this.failedDetached.entries()].sort(([a], [b]) => a - b).map(([, record]) => record);
    if (records.length === 0) return;
    const separator = '\n\n';
    let draft = '';
    const occurrences = [];
    for (const record of records) {
      const base = draft.length + (draft === '' ? 0 : separator.length);
      if (draft !== '') draft += separator;
      draft += record.draft;
      for (const occurrence of record.occurrences) {
        occurrences.push({ ...occurrence, offset: base + occurrence.offset });
      }
    }
    this.restoringFailures = true;
    try {
      this.draftEditor.restoreDraft(draft, occurrences);
      this.draftEditor.clearHistory();
      this.failedRestoreRev = this.rev;
    } finally {
      this.restoringFailures = false;
    }
  }

  /** 把失败发送的附件放回轨道头部；只有成功之后才释放。 */
  restoreAttachments(attachmentIds) {
    if (attachmentIds.length === 0) return;
    const current = new Set(this.attachmentIds);
    const restored = attachmentIds.filter(id => !current.has(id));
    if (restored.length === 0) return;
    this.attachmentIds = [...restored, ...this.attachmentIds];
    this.publish();
  }

  /** 进入裁决：轮询会话控制器；失败 = 通知 + 保留草稿（永不静默降级）。 */
  adjudicate(attempt, draft) {
    const inputTriggers = this.deps.inputTriggers?.();
    if (inputTriggers === undefined) {
      // 没有挂载管线：'/' 行就是一条普通消息。
      this.dispatchRun({ type: 'adjudicated', attempt, outcome: undefined });
      return;
    }
    inputTriggers.adjudicate(draft.trim(), attempt.signal, { attachments: this.attachmentIds.length }).then(
      (outcome) => {
        if (this.dead(attempt)) return;
        this.dispatchRun({ type: 'adjudicated', attempt, outcome });
      },
      (error) => {
        if (this.dead(attempt)) return;
        const message = error instanceof Error ? error.message : String(error);
        this.dispatchRun({ type: 'adjudication-failed', attempt, message });
      },
    );
  }

  /**
   * 提交事务：对会话作用域调 claim.submit；ok 由 outcome.kind 映射。
   * 接受附件的认领会拿到序列化后的草稿附件，它们**只在成功结果下**才被清掉并
   * 释放；失败（序列化、传输或处理器错误）保留草稿与附件供修正。
   */
  beginSubmit(attempt, claim, args) {
    const attachmentIds = claim.attachments === true ? [...this.attachmentIds] : [];
    Promise.resolve()
      .then(async () => {
        const attachments = attachmentIds.length > 0 ? await this.deps.commandAttachments.serialize(attachmentIds) : [];
        // 序列化可能比 attempt 活得久（大文件、会话拆除）；已死的 attempt
        // 不得到达 Host 执行器。
        if (this.dead(attempt)) return undefined;
        return claim.submit(args, this.deps.actx, attachments);
      })
      .then(
        (outcome) => {
          if (outcome === undefined || this.dead(attempt)) return;
          if (outcome.kind === 'success' && attachmentIds.length > 0) {
            const submitted = new Set(attachmentIds);
            this.attachmentIds = this.attachmentIds.filter(id => !submitted.has(id));
            this.deps.commandAttachments.release(attachmentIds);
          }
          this.dispatchRun({
            type: 'submit-settled', attempt, ok: outcome.kind === 'success',
            draft: this.projection.clipboardText, outcome,
            ...(outcome.kind === 'error' && outcome.text === undefined ? { message: 'command failed' } : {}),
          });
        },
        (error) => {
          if (this.dead(attempt)) return;
          const message = error instanceof Error ? error.message : String(error);
          this.dispatchRun({
            type: 'submit-settled', attempt, ok: false,
            draft: this.projection.clipboardText, message,
          });
        },
      );
  }

  /** 迟到结算守卫：被顶替的 attempt 与已释放的门面静默丢弃。 */
  dead(attempt) {
    return this.disposed || attempt.signal.aborted;
  }

  compose() {
    const core = this.core.state;
    return {
      draft: this.projection.clipboardText,
      attachmentIds: this.attachmentIds,
      draftRev: this.rev,
      phase: core.phase,
      ...(core.claim !== undefined ? { claim: core.claim } : {}),
      occurrences: this.projection.occurrences,
      queue: this.deps.inbox?.getSnapshot()?.['next-turn'] ?? EMPTY_QUEUE,
    };
  }

  publish() {
    const next = this.compose();
    this.state.set(next);
    const draft = this.draftSnapshot;
    if (draft !== this.lastPublishedDraft) {
      this.lastPublishedDraft = draft;
      this.persistDraft?.(draft);
    }
  }
}

/**
 * 建一个每会话输入门面（SessionInputShell 的工厂别名）。
 * @param {object} deps 依赖面。
 * @param {(callbacks: object) => object} deps.editorFactory 编辑器端口工厂；收
 *   `{onUpdate, openReference, activeClaimToken, lexicon, resolveLexicon}`，
 *   返回带 `projection`（getter）/`register`/`refreshProjection`/`setDraft`/
 *   `restoreDraft`/`replaceText`/`insertAsyncText`/`insertReference`/
 *   `insertFileReferences`/`paste`/`caretSpan`/`clearCommittedDraft`/`clearHistory`/
 *   `refreshClaimDecoration`/`refreshLexiconSubscription` 的端口对象。
 * @param {() => object} [deps.submissionState] 在异步命令裁决之前快照 Session 事实。
 * @param {(submission: object) => void} [deps.messageSubmitted] 在引用序列化前通知一次普通消息尝试。
 * @param {() => object|undefined} [deps.inputTriggers] Enter 裁决面解析器；缺省/返回
 *   undefined 时每条 '/' 行都落到默认 sink。
 * @param {() => object|undefined} [deps.popup] popupSelect 外壳面（提交锁与 escape 时关闭）。
 * @param {{getSnapshot: Function, subscribe: Function}} [deps.inbox] Agent Inbox 投影；
 *   它的 next-turn 列表叠加到 InputState.queue。
 * @param {() => void} [deps.steerQueue] 把所有仍排队的消息按 FIFO 插进运行中的回合。
 * @param {(text: string, attachmentIds: ReadonlyArray<string>, mode: string, signal: AbortSignal) => Promise<object>} deps.defaultSink 普通消息落点。
 * @param {object} deps.commandAttachments 命令面附件管道 `{serialize, release, unsupportedNotice}`。
 * @param {unknown} [deps.actx] 交给 claim.submit 事务的会话作用域（结构化透传）。
 * @returns {SessionInputShell}
 */
function createDraftFacade(deps) {
  return new SessionInputShell(deps);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6. 编辑器端口 —— ⚠️ **新增（非移植）**
 *
 * 源码里这一层是 Lexical：`DraftEditorRuntime`（runtime.ts 351 行）+
 * `$projectComposer`/`$composerLayout`（projection.ts 230 行）+
 * `$replaceDetectSpanWith*`（span-map.ts 119 行）。本次**明确不移植**。
 *
 * 为了让状态层能在纯 JS / node 里跑起来，这里给出端口的最小实现：**纯文本**。
 * 逐条列出它与 Lexical 端的差异：
 *   ① `detectText === clipboardText`（没有任何 chip），`occurrences` 恒为空数组；
 *      `restoreDraft(text, references)` 在 references 非空时抛错。
 *   ② `insertReference` 恒返回 false（chip 节点是编辑器层的，未移植）。
 *   ③ 没有 undo 历史：`clearHistory()` 是 no-op。
 *   ④ 没有装饰扫描：`refreshLexiconSubscription()` / `refreshClaimDecoration()`
 *      是 no-op。
 *   ⑤ `editor` 为 null（没有 LexicalEditor 实体）。
 *   ⑥ `setSelection()` 是端口的附加控制面，用于表达「纯光标移动提交」。
 *
 * 占位符净化规则、`setDraft` 的短路条件、`caretSpan()` 的回落、
 * `clearCommittedDraft` 的两种分支都按 `runtime.ts` 逐行照抄。
 * ══════════════════════════════════════════════════════════════════════════ */

/** detect 投影与旧版引用占位符：任何外部文本进入文档前都剥掉（runtime.ts:39）。 */
const REFERENCE_PLACEHOLDER_RE = /[\uE100-\uE11D\uFFFC]/gu;

/** 空投影（detect/clipboard 同文本，无 chip，无选区）。 */
const EMPTY_PROJECTION = Object.freeze({
  detectText: '', clipboardText: '', occurrences: Object.freeze([]), selection: null, caret: null,
});

/**
 * 建一个纯文本编辑器端口（见本节的差异清单）。
 * @param {{onUpdate: () => void}} deps 端口回调（与源码 `DraftEditorRuntimeDeps` 的前一项同名）。
 * @returns {object} 编辑器端口。
 */
function createTextEditorPort(deps) {
  let text = '';
  let occurrences = EMPTY_PROJECTION.occurrences;
  let selection = null;
  let caret = null;
  let projected = EMPTY_PROJECTION;
  let registered = false;

  const build = () => ({ detectText: text, clipboardText: text, occurrences, selection, caret });

  /** 应用一次编辑并触发更新监听（等价于 Lexical 的 update → updateListener）。 */
  const commit = () => { deps.onUpdate(); };

  const placeCaret = (at) => {
    selection = { start: at, end: at };
    caret = at;
  };

  return {
    /** 端口持有的编辑器实体；纯文本端口没有。 */
    editor: null,

    get projection() { return projected; },

    register() {
      registered = true;
      projected = build();
      return () => { registered = false; };
    },

    /** 重投影，返回上一次读取的投影（runtime.ts:147-152）。 */
    refreshProjection() {
      const prev = projected;
      projected = build();
      return prev;
    },

    /**
     * 整体替换草稿。占位符已净化；换行即文本；光标落到末尾。
     * 短路条件与 runtime.ts:170 一致：文本没变且没有 chip 时**不触发**更新。
     */
    setDraft(next) {
      if (!registered) throw new Error('text editor port: setDraft before register');
      const clean = next.replace(REFERENCE_PLACEHOLDER_RE, '');
      if (clean === projected.clipboardText && projected.occurrences.length === 0) return;
      text = clean;
      occurrences = EMPTY_PROJECTION.occurrences;
      placeCaret(clean.length);
      commit();
    },

    /**
     * 导入语义内容。
     * ⚠️ chip 节点未移植：references 非空时抛错（不做静默降级）。
     */
    restoreDraft(draft, references) {
      if (references.length > 0) {
        throw new Error('text editor port: reference chips are not ported (editor/chip-node.tsx)');
      }
      text = draft.replace(REFERENCE_PLACEHOLDER_RE, '');
      occurrences = EMPTY_PROJECTION.occurrences;
      placeCaret(text.length);
      commit();
    },

    /** 在当前选区（缺省 = 文档末尾）插入粘贴文本。 */
    paste(pasted) {
      const clean = pasted.replace(REFERENCE_PLACEHOLDER_RE, '');
      if (clean === '') return;
      const at = selection === null ? text.length : selection.end;
      text = text.slice(0, at) + clean + text.slice(at);
      placeCaret(at + clean.length);
      commit();
    },

    /** 替换 detect 坐标下的一个 span（空文本 = 删除）。范围非法时返回 false。 */
    replaceText(span, next) {
      if (span.start < 0 || span.start > span.end || span.end > text.length) return false;
      text = text.slice(0, span.start) + next + text.slice(span.end);
      placeCaret(span.start + next.length);
      commit();
      return true;
    },

    /** 异步文本结果插入为一次独立编辑（与 paste 同样的净化规则）。 */
    insertAsyncText(span, next) {
      return this.replaceText(span, next.replace(REFERENCE_PLACEHOLDER_RE, ''));
    },

    /** ⚠️ chip 未移植：恒返回 false。 */
    insertReference() { return false; },

    /** ⚠️ chip 未移植：空批量返回 true（与 runtime.ts:270 一致），否则 false。 */
    insertFileReferences(references) { return references.length === 0; },

    /** 实时选区作为 detect 坐标 span；无选区时回答文档末尾的折叠 span。 */
    caretSpan() {
      if (projected.selection !== null) return projected.selection;
      const at = projected.detectText.length;
      return { start: at, end: at };
    },

    /**
     * 用模型给出的后缀决定清掉已提交内容。
     * @param {(clipboardText: string) => number|null} prefixLength 返回要移除的
     *   clipboard 前缀长度，或 null 表示整树清空。
     */
    clearCommittedDraft(prefixLength) {
      const length = prefixLength(projected.clipboardText);
      if (length !== null) {
        text = text.slice(length);
        placeCaret(0);
      } else {
        text = '';
        occurrences = EMPTY_PROJECTION.occurrences;
        placeCaret(0);
      }
      commit();
    },

    /** ⚠️ 没有 undo 历史（未移植 @lexical/history）：no-op。 */
    clearHistory() {},

    /** ⚠️ 装饰层未移植：no-op。 */
    refreshClaimDecoration() {},

    /** ⚠️ 装饰层未移植：no-op。 */
    refreshLexiconSubscription() {},

    /** ⚠️ 未移植 `SessionInputShell.focus()` 的 Lexical 焦点恢复。 */
    focus() {},

    /** 附加控制面：只移动选区/光标，不改内容也不推进 rev。 */
    setSelection(next) {
      if (next === null) {
        selection = null;
        caret = null;
      } else {
        const start = Math.min(next.start, next.end);
        const end = Math.max(next.start, next.end);
        selection = { start, end };
        caret = start === end ? start : null;
      }
      commit();
    },

    /** 附加控制面：读端口内部文本（测试与调试用；权威仍是 projection）。 */
    peekText() { return text; },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7. blocks.ts —— 一个会话的输入封禁注册表
 *
 * 组件读不到那些知道原因的插件（依赖方向是 ui-model-selection → ui-conversation，
 * 从不反向），所以封禁方推到这里，卡片读自己会话的 store。封禁带它自己的本地化
 * 理由文案（提出它的插件拥有那份文案）；输入框只知道如何渲染一个惰性文本域。
 * 这是可供性，不是强制：无法路由的提示词 Host 一律拒绝。
 * ══════════════════════════════════════════════════════════════════════════ */

class ComposerBlockRegistry {
  constructor() {
    /** @type {Map<string, object>} 每会话一个封禁 store。 */
    this.stores = new Map();
  }

  /**
   * 抬起或清除该会话的封禁。
   * @param {string} sessionId 受影响的 Session。
   * @param {{reason: string}|undefined} block 要抬起的封禁，undefined 表示清除。
   */
  set(sessionId, block) {
    const store = this.storeFor(sessionId);
    const current = store.getSnapshot();
    if (current?.reason === block?.reason) return;
    store.set(block);
  }

  /**
   * 解析一个 Session 的可观察封禁状态。
   * @param {string} sessionId 要观察的 Session。
   * @returns {object} 身份稳定的封禁 store。
   */
  storeFor(sessionId) {
    const existing = this.stores.get(sessionId);
    if (existing !== undefined) return existing;
    const created = createSnapshotStore(undefined);
    this.stores.set(sessionId, created);
    return created;
  }

  /**
   * 丢弃一个 Session 的 store。
   * @param {string} sessionId 正在释放的 Session。
   */
  forget(sessionId) {
    this.stores.delete(sessionId);
  }
}

function createComposerBlockRegistry() {
  return new ComposerBlockRegistry();
}

/* ══════════════════════════════════════════════════════════════════════════
 * 8. decorations.ts —— 纯文本引用扫描
 *
 * `/name` 或 `@name` token，名字在触发的词表上；外加语法可识别的 `@dir/`
 * 目录 token。纯派生 —— 编辑器把文本改出匹配形态，下一次扫描自然丢掉该区间。
 * ══════════════════════════════════════════════════════════════════════════ */

/** token 匹配器：行首或空白后的触发字符，然后一个词状名字（永不跨 \n）。 */
const TEXT_REF_RE = /(^|\s)([/@])([\w-]+)/g;
const FOLDER_REF_RE = /(^|\s)(@(?:"[^"\n]*\/|[^\s"]+\/))/g;
/**
 * `/name` token 之后允许出现什么：空白或草稿末尾。这是 host skill 手势
 * （`dsh-tool-skill`）要求的边界，因此 `/nfs-hg/xxx`、`/plan.md`、`/plan。`
 * 都是散文，永远不是引用。
 */
const SLASH_TOKEN_END_RE = /^(?:\s|$)/;

/**
 * 对着热词表扫描草稿里的纯文本引用 token。
 * 词边界纪律：触发字符必须在草稿开头或空白之后（'x/name' 永不匹配）；
 * 名字必须是词表的精确成员；`/name` token 必须在空白或草稿末尾结束
 * （'/name/x' 是路径，'/name。' 是散文）。
 * @param {string} draft 草稿文本。
 * @param {Map<'/'|'@', ReadonlyArray<string>>} lexicon 每触发的名字列表；缺失目录不匹配任何具名 token。
 * @returns {Array<{start: number, end: number, trigger: '/'|'@'}>} 草稿顺序的匹配区间。
 */
function scanTextRefs(draft, lexicon) {
  if (draft === '') return [];
  const out = [];
  TEXT_REF_RE.lastIndex = 0;
  let m;
  while ((m = TEXT_REF_RE.exec(draft)) !== null) {
    const trigger = m[2];
    const name = m[3] ?? '';
    if (trigger === '/' && !SLASH_TOKEN_END_RE.test(draft.slice(m.index + m[0].length))) continue;
    if (lexicon.get(trigger)?.includes(name)) {
      const start = m.index + (m[1]?.length ?? 0);
      out.push({ start, end: start + 1 + name.length, trigger });
    }
  }
  FOLDER_REF_RE.lastIndex = 0;
  let folder;
  while ((folder = FOLDER_REF_RE.exec(draft)) !== null) {
    const token = folder[2] ?? '';
    const start = folder.index + (folder[1]?.length ?? 0);
    const end = start + token.length;
    if (!out.some(range => range.start < end && range.end > start)) {
      out.push({ start, end, trigger: '@' });
    }
  }
  return out.sort((left, right) => left.start - right.start);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 9. submission-analytics.ts —— 普通消息出现到 Desktop 产品事件
 * ⚠️ 未移植：cordis 上下文（换成结构化 `{get(name)}` 端口）。
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 上报原始消息出现，不读取更新的 Session 事实。
 * @param {{get: (name: string) => any}} ctx 客户端上下文。
 * @param {{state?: object, timestamp: number, mode: string}} submission 原始出现与 Session 快照。
 */
function reportMessageSubmission(ctx, submission) {
  const { state, timestamp, mode } = submission;
  if (state === undefined) return;
  const model = state.model;
  ctx.get('productAnalytics')?.track('send_button_click', {
    ...(state.sessionId === undefined ? {} : { session_id: state.sessionId }),
    ...(model === undefined
      ? {}
      : {
        model_name: `${model.provider}/${model.name}`,
        ...(model.effort === undefined ? {} : { thinking_effort: model.effort }),
      }),
    run_mode: state.runMode,
    msg_type: state.running ? mode : 'default',
  }, timestamp);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 10. hub.ts —— 会话绑定的输入注册表与默认发送路由
 *
 * 每个被保留的 Session 绑定拥有一个 shell、它的输入监听器与目录订阅。保存的
 * 草稿在第一次查找返回之前就进入模型；会话作用域释放会释放 shell 及其资源。
 *
 * ⚠️ 未移植（cordis 基础设施，全部走结构化端口）：
 *   · `actx.effect(body, label)` — 作用域 fiber 的生命周期钩子。端口有则用；
 *     没有则把 teardown 存进 `manualTeardowns`，由 `release(binding)` 显式调用。
 *   · `actx.on(event, listener)` — scoped input 事件（bail 模式）。端口有则注册。
 *   · `actx.inject(['inputTriggers'], cb)` — 注入生命周期。端口有则调用。
 *   · `rootCtx.get(name)` — 服务定位。端口是 `{get(name)}`。
 *   · `t` — conversation 命名空间的翻译 thunk。
 *   · 编辑器端口由 hub 持有并交给每个 shell（源码里 shell 自己
 *     `new DraftEditorRuntime`；编辑器层本次不移植，所以在这里注入一次）。
 * ══════════════════════════════════════════════════════════════════════════ */

class InputHub {
  /**
   * @param {{get: (name: string) => any}} rootCtx 客户端根上下文。
   * @param {(key: string, params?: object) => string} t conversation 命名空间翻译 thunk。
   * @param {(callbacks: object) => object} editorFactory 编辑器端口工厂（见 `createDraftFacade`）。
   */
  constructor(rootCtx, t, editorFactory) {
    this.rootCtx = rootCtx;
    this.t = t;
    this.editorFactory = editorFactory;
    this.shells = new WeakMap();
    /** ⚠️ 未移植 cordis fiber 时的显式释放入口（binding → teardown）。 */
    this.manualTeardowns = new WeakMap();
  }

  /**
   * 解析一个会话作用域的输入门面（SessionInputResolver 面）。
   * @param {object} actx 会话作用域上下文。
   * @returns {SessionInputShell} 常驻的每会话门面。
   */
  for(actx) {
    const sessions = this.sessions();
    const session = sessions.sessionOf(actx);
    const binding = session === undefined ? undefined : sessions.binding(session.sessionId);
    if (binding === undefined || binding.session !== session) {
      throw new Error('conversation.input.for requires a retained Session scope');
    }
    return this.shellFor(binding);
  }

  /**
   * @param {object} binding 目标 Session 代际。
   * @param {{prompt?: string, clearPreviousDraft?: boolean}} options 要采纳的内容与显式替换许可。
   * @returns {'applied'|'preserved'|'blocked'}
   */
  requestDraftInitialization(binding, options) {
    if (this.sessions().binding(binding.sessionId) !== binding) {
      throw new Error('conversation.input.requestDraftInitialization requires a retained Session binding');
    }
    return this.shellFor(binding).requestDraftInitialization(options);
  }

  /**
   * 为一个已被保留、可寻址的 Session 绑定解析常驻 shell。草稿导入在返回前完成。
   * @param {object} binding 会话装配句柄。
   * @returns {SessionInputShell}
   */
  shellFor(binding) {
    const existing = this.shells.get(binding);
    if (existing !== undefined) return existing;
    const { session, ctx: actx } = binding;
    const shell = new SessionInputShell({
      actx,
      submissionState: () => {
        const state = session.getSnapshot();
        const model = session.projections.faceOf('modelSelection').getSnapshot();
        const plan = session.projections.faceOf('plan').getSnapshot();
        const goal = session.projections.faceOf('goal').getSnapshot();
        const selection = model?.next ?? model?.lastUsed;
        return Object.freeze({
          ...(state.blank ? {} : { sessionId: state.sessionId }),
          ...(selection == null ? {} : {
            model: Object.freeze({
              provider: selection.provider,
              name: selection.model,
              ...(selection.reasoningEffort === undefined ? {} : { effort: selection.reasoningEffort }),
            }),
          }),
          // 判定顺序：plan → goal → default。
          runMode: plan?.active ? 'plan' : goal?.goal.phase === 'active' ? 'goal' : 'default',
          running: state.running,
        });
      },
      messageSubmitted: (submission) => { reportMessageSubmission(this.rootCtx, submission); },
      inputTriggers: () => this.controller(actx),
      popup: () => this.popup(actx),
      inbox: session.projections.faceOf('inbox'),
      defaultSink: (text, attachmentIds, mode, signal) => this.sink(session, text, attachmentIds, mode, signal),
      steerQueue: () => { void this.steerQueue(session, shell); },
      commandAttachments: {
        serialize: async (ids) => {
          const result = await this.conversation().serializeDraftAttachments(ids);
          return result.attachments;
        },
        // 与 serialize 刻意不对称：release 在提交 RPC **之后**结算，那时会话
        // 拆除可能已经卸掉 conversation 服务；泄漏的预览 URL 随文档一起死。
        release: (ids) => {
          const conversation = this.rootCtx.get('conversation');
          for (const attachmentId of ids) conversation?.releaseDraftAttachment(attachmentId);
        },
        unsupportedNotice: token => this.t('command.attachmentsUnsupported', {
          command: token.trim().replace(/^\//u, ''),
        }),
      },
      // 编辑器端口：源码在这里 new DraftEditorRuntime；本文件要求调用方注入。
      editorFactory: (callbacks) => {
        if (typeof this.editorFactory !== 'function') {
          throw new Error('conversation.input: InputHub.editorFactory is not installed');
        }
        return this.editorFactory(callbacks);
      },
    });
    this.shells.set(binding, shell);
    // 唯一一条拆除轴：监听器、shell、映射条目都随作用域走（这里没有任何东西
    // 活得比作用域更久）。
    const offs = [];
    const teardown = () => {
      for (const off of offs) off();
      const drafts = shell.dispose();
      this.shells.delete(binding);
      const conversation = this.rootCtx.get('conversation');
      for (const attachmentId of drafts) conversation?.releaseDraftAttachment(attachmentId);
    };
    if (typeof actx?.on === 'function') {
      offs.push(actx.on('slash/input-begin-command', req =>
        shell.beginCommand(req.claim, req.span) ? true : undefined));
      offs.push(actx.on('slash/input-insert-reference', req =>
        shell.insertReference(req.reference, req.span) ? true : undefined));
      offs.push(actx.on('slash/input-consume-token', req =>
        shell.consumeToken(req.guard) ? true : undefined));
      offs.push(actx.on('slash/input-insert-text', req =>
        shell.insertText(req.text, req.span, req.continue === true) ? true : undefined));
    }
    if (typeof actx?.effect === 'function') {
      actx.effect(teardown, 'conversation.input: session shell');
    } else {
      this.manualTeardowns.set(binding, teardown);
    }
    if (typeof actx?.inject === 'function') {
      actx.inject(['inputTriggers'], (scope) => {
        scope.effect(() => {
          shell.refreshLexiconSubscription();
          return () => { shell.refreshLexiconSubscription(); };
        }, 'conversation.input: reference catalogs');
      });
    }
    shell.setDraft(readConversationDraft(binding.sessionId));
    return shell;
  }

  /**
   * ⚠️ 新增（非移植）：没有 cordis fiber 时的显式释放入口，等价于源码里
   * `actx.effect` 注册的那段 teardown。
   * @param {object} binding 会话装配句柄。
   * @returns {boolean} 是否释放了一个常驻 shell。
   */
  release(binding) {
    const teardown = this.manualTeardowns.get(binding);
    if (teardown === undefined) return false;
    this.manualTeardowns.delete(binding);
    teardown();
    return true;
  }

  /**
   * 按会话 id 解析常驻 shell（服务面路径）。
   * @param {string} id 会话 id。
   * @returns {SessionInputShell}
   */
  shell(id) {
    const binding = this.sessions().binding(id);
    if (binding === undefined) throw new Error(`conversation.input: session "${id}" resolved no binding`);
    return this.shellFor(binding);
  }

  /**
   * InputBar 专属键盘命令面：shell 在结构上满足它。
   * @param {string} id 会话 id。
   * @returns {SessionInputShell}
   */
  keyboard(id) {
    return this.shell(id);
  }

  /**
   * 不创建 Session 输入地查询文件接收能力。
   * @param {string} id 目标 Session。
   * @returns {boolean} 它已挂载的输入框当前是否接受文件。
   */
  canPickFiles(id) {
    const binding = this.sessions().binding(id);
    return binding !== undefined && this.shells.get(binding)?.canPickFiles() === true;
  }

  /**
   * 在实时接收策略下打开目标输入框的文件对话框。
   * @param {string} id 目标 Session。
   */
  pickFiles(id) {
    const binding = this.sessions().binding(id);
    if (binding !== undefined) this.shells.get(binding)?.pickFiles();
  }

  /**
   * 为想在不敲触发字符的情况下拉起共享候选菜单的输入框 chrome，解析可选的
   * slash 控制器。
   * @param {string} id 会话 id。
   * @returns {object|undefined} 常驻控制器；没有安装触发提供方时为 undefined。
   */
  inputTriggers(id) {
    const binding = this.sessions().binding(id);
    return binding === undefined ? undefined : this.controller(binding.ctx);
  }

  /**
   * 默认 sink：乐观清空 + 提示。会话永远是真实的 host 实体，因此只有一条路径；
   * 首次提示失败就是普通的提示失败。
   * @param {object} session 目标主机会话。
   * @param {string} text 文本。
   * @param {ReadonlyArray<string>} attachmentIds 附件 id。
   * @param {'queue'|'steer'} mode 投递模式。
   * @param {AbortSignal} signal 取消信号。
   * @returns {Promise<{kind: string, text?: string}>}
   */
  sink(session, text, attachmentIds, mode, signal) {
    if (text === '' && attachmentIds.length === 0) return Promise.resolve({ kind: 'success' });
    return this.conversation().sendSession(session, text, attachmentIds, mode, signal);
  }

  /**
   * 把所有仍排队的消息按 FIFO 请求顺序通过 QueueDock Steer 提交。
   * Agent 在命令前停下（`session/steer-unavailable`）或某行已被 agent 认领
   * （`session/queue-item-not-found`）都静默收敛，真正的失败浮出一条输入框通知。
   * 重复触发依赖 `session/queue-item-not-found` 收敛：快照可能仍列出主机已经
   * steer 过的行，而重复 Steer 是静默 no-op。
   * @param {object} session 目标主机会话。
   * @param {SessionInputShell} shell 常驻 shell（通知出口）。
   * @returns {Promise<void>}
   */
  async steerQueue(session, shell) {
    const inbox = session.projections.faceOf('inbox').getSnapshot();
    const queued = inbox?.['next-turn'] ?? [];
    if (queued.length === 0) return;
    for (const item of queued) {
      const result = await session.updateQueue(item.id, { kind: 'steer' });
      if (result.ok) continue;
      if (result.error.code === 'session/steer-unavailable' || result.error.code === 'session/queue-item-not-found') return;
      shell.notify('error', this.t('queue.steerFailed'));
      return;
    }
  }

  controller(actx) {
    if (this.sessions().sessionOf(actx) === undefined) return undefined;
    const inputTriggers = this.rootCtx.get('inputTriggers');
    return inputTriggers?.sessionOf(actx);
  }

  popup(actx) {
    if (this.sessions().sessionOf(actx) === undefined) return undefined;
    const command = this.rootCtx.get('commandUi');
    return command?.popupFor(actx);
  }

  sessions() {
    const sessions = this.rootCtx.get('sessions');
    if (sessions === undefined) throw new Error('conversation.input: sessions service unavailable');
    return sessions;
  }

  conversation() {
    const conversation = this.rootCtx.get('conversation');
    if (conversation === undefined) throw new Error('conversation.input: conversation service unavailable');
    return conversation;
  }
}

function createInputHub(rootCtx, t, editorFactory) {
  return new InputHub(rootCtx, t, editorFactory);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 11. stores.ts —— 每会话 Conversation store 的草稿读入口
 * ⚠️ 未移植：`defineStore` 引擎 store 外壳与它的持久化中间件。这里只保留
 *    「在输入源发布给 UI 之前读出已存草稿」这条读路径。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 每会话 Conversation store 的 localStorage 键前缀。 */
const CONVERSATION_STORE_KEY = 'dsh.conversation';

/**
 * 在输入源发布给 UI 之前读一个 Session 的草稿。
 * @param {string} sessionId 会话作用域的持久化后缀。
 * @returns {{text: string, references: Array}} 保存的语义内容；存储缺失或非法时为空文档。
 */
function readConversationDraft(sessionId) {
  const empty = { text: '', references: [] };
  if (typeof localStorage === 'undefined') return empty;
  try {
    const raw = localStorage.getItem(`${CONVERSATION_STORE_KEY}.${sessionId}`);
    if (raw === null) return empty;
    const stored = JSON.parse(raw);
    if (typeof stored !== 'object' || stored === null || !('draft' in stored)) return empty;
    return parseStoredDraft(stored.draft) ?? empty;
  } catch (_error) {
    // 浏览器存储不可用或 JSON 损坏时没有可用的已存草稿。
    return empty;
  }
}

/**
 * 在 Slot store 被物化之前读持久化的 View 偏好。
 * @param {string} sessionId 会话作用域的持久化后缀。
 * @returns {string|null} 偏好 View id；存储没有可用值时为空。
 */
function readConversationViewPreference(sessionId) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${CONVERSATION_STORE_KEY}.${sessionId}`);
    if (raw === null) return null;
    const stored = JSON.parse(raw);
    if (typeof stored !== 'object' || stored === null || !('view' in stored)) return null;
    return typeof stored.view === 'string' ? stored.view : null;
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 12. 未移植清单（机读副本；与各处的 `⚠️ 未移植：` 注释一一对应）
 * ══════════════════════════════════════════════════════════════════════════ */

const UNPORTED = Object.freeze([
  'editor/runtime.ts: LexicalEditor 实体、registerPlainText、@lexical/history（HISTORY_MERGE_DELAY_MS=1000 的 undo 合并窗口）、ROOT/DOM 选区保持、REFERENCE_PLACEHOLDER 净化之外的节点操作',
  'editor/projection.ts: $composerLayout/$projectComposer/detectOffsetOfClipboardOffset、ATOMIC_CHAR=U+FFFC 的 chip 原子化、gap 段落换行段',
  'editor/span-map.ts: detect 坐标 → Lexical Point 的映射与 $replaceDetectSpanWithNodes',
  'editor/chip-node.tsx / ReferenceChip.tsx / DecoratorPortals.tsx: 引用 chip 节点与其 portal 渲染',
  'editor/claim-decor.ts / text-ref.ts: 认领 token 描边与文本引用装饰扫描',
  'editor/keymap.ts: IME 组合守卫（isComposing / keyCode 229 / compositionend +10ms）、Enter/Space/Tab/Escape/方向键裁决、PASTE_COMMAND 文件与文本分流',
  'editor/view-binding.ts: revealDraftSelection / focusDraftEditor / installDraftWheel / installDraftFilePicker / installDraftKeymap / keepDraftFocus',
  'editor/DraftEditor.tsx / ComposerContentEditable.tsx: React 呈现层与 contenteditable 绑定',
  'contract/*.ts: 全部为类型面（InputState/InputEvent/InputEffect/SubmitAttempt/SessionInput/InputActions/ComposerKeyboard/TokenSpan/Occurrence/DraftSnapshot…），JS 里没有运行时表示',
  "React hook / slot / i18n: useInput 一类的 uSES 桥、conversation.input.* slot 注册、locales.ts 打字字典（本文件把 t 与文案留给调用方）",
  'cordis: actx.effect/on/inject 的作用域 fiber 语义（本文件走结构化端口；无 fiber 时用 InputHub.release 显式释放）',
  '@deepseek-ai/dsh-client-store: zustand vanilla + immer + subscribeWithSelector + rafFlush + attachPersistence + defineStore + shallowEqual（本文件只保留 createSnapshotStore 的可观测语义子集）',
  'zod: referenceSchema/snapshotSchema（本文件手写等价校验，含非严格剥离与 refine 的判定顺序）',
]);

/* ══════════════════════════════════════════════════════════════════════════
 * 导出
 * ══════════════════════════════════════════════════════════════════════════ */

const dshInputState = Object.freeze({
  /* submission-settings.ts */
  CONVERSATION_SETTINGS_NAMESPACE,
  BUSY_ENTER_FIELD,
  BUSY_ENTER_BEHAVIORS,
  DEFAULT_BUSY_ENTER_BEHAVIOR,

  /* @deepseek-ai/dsh-client-store（本地子集） */
  createSnapshotStore,
  notifySubscribers,
  produce,
  deepFreeze,

  /* draft.ts */
  resolveDraftInput,
  snapshotDraft,
  copyReference,
  parseStoredDraft,
  REFERENCE_APPEARANCES,

  /* machine.ts */
  SubmitMachine,
  createInputMachine,
  unreachable,
  argsAfter,
  retainsClaim,

  /* submission-policy.ts */
  resolveSubmitMode,
  ComposerSubmissionPolicy,
  createComposerSubmissionPolicy,

  /* facade.ts */
  SessionInputShell,
  createDraftFacade,
  guardOf,
  projectionContentChanged,
  EMPTY_QUEUE,
  EMPTY_LEXICON,

  /* 编辑器端口（新增，非移植） */
  createTextEditorPort,
  EMPTY_PROJECTION,
  REFERENCE_PLACEHOLDER_RE,

  /* blocks.ts */
  ComposerBlockRegistry,
  createComposerBlockRegistry,

  /* decorations.ts */
  scanTextRefs,
  TEXT_REF_RE,
  FOLDER_REF_RE,
  SLASH_TOKEN_END_RE,

  /* submission-analytics.ts */
  reportMessageSubmission,

  /* hub.ts */
  InputHub,
  createInputHub,

  /* stores.ts */
  CONVERSATION_STORE_KEY,
  readConversationDraft,
  readConversationViewPreference,

  /* 未移植清单 */
  UNPORTED,
});

if (typeof window !== 'undefined') window.dshInputState = dshInputState;
if (typeof module !== 'undefined' && module.exports) module.exports = dshInputState;
})();
