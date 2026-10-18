'use strict';
(function installDshMount() {
/** 会话列表、消息区、输入卡的挂载、状态投影与操作回调。 */

/** 需要用到的三个组件（浏览器全局；Node 断言里按相对路径 require）。 */
function chatOf() {
  return (typeof window !== 'undefined' && window.dshChat) || require('./dsh-chat.js');
}
function composerOf() {
  return (typeof window !== 'undefined' && window.dshComposer) || require('./dsh-composer.js');
}
function bridgeOf() {
  return (typeof window !== 'undefined' && window.dshViewBridge) || require('./view-bridge.js');
}
/**
 * **状态层**（`dsh-input-state.js`）—— 输入卡下面那一层，草稿的**唯一权威**。
 *
 * ⚠️ 必须在 `dsh-composer.js` **之前**加载（`index.html` 的顺序即依赖顺序）：
 * 本文件建输入卡时就要用它，而组件层本身不依赖它（组件只收投影）。
 */
function inputStateOf() {
  return (typeof window !== 'undefined' && window.dshInputState) || require('./dsh-input-state.js');
}

/** 建元素的小工具（`document` 是宿主注入的，不是模块级的）。 */
function el(doc, tag, className = '', text = '') {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * id 可能存在属性选择器里 —— 需要转义。
 * `CSS.escape` 缺席时退到最小实现（这两个字符是唯一会截断选择器的）。
 *
 * @param {*} value
 * @returns {string}
 */
function cssEscape(value) {
  const raw = String(value ?? '');
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(raw);
  return raw.replace(/["\\]/g, '\\$&');
}

/**
 * 新组件的**挂载点 id**（宿主 HTML 里没有这些 id，是本文件建出来的）。
 * 前缀 `dsh` + 语义名，避免与项目既有的 `talk*` id 撞。
 */
const NODE_IDS = Object.freeze({
  sidebarMount: 'dshSidebarMount',
  chatMount: 'dshChatMount',
  /** 旧输入卡整块的容器（搬节点、整体隐藏，见 `legacyTalkin` 的说明）。 */
  legacyTalkin: 'dshLegacyTalkin',
  composerMount: 'dshComposerMount',
  queueMount: 'dshQueueMount'
});

/** 宿主输入投影的隐藏属性与挂载样式表。 */
const MODE_STYLE_ID = 'dsh-mount-mode-style';
const LEGACY_HIDDEN_ATTR = 'data-dsh-legacy-hidden';

/**
 * 宿主补的那半边 UI 的样式（队列行的就地编辑器）。
 *
 * 这三条**必须在这里**：`QueueDock` 只有 `onEdit(id, text)` 这一个通知回调，
 * 编辑器的 DOM 是**宿主建的**（组件不管），所以它的样式也不在 `dsh-composer.css` 里
 * —— 不写就是裸 `textarea` + 两个裸按钮。
 *
 * ⚠️ **只用 `dsh-tokens.css` 里真的存在的 token**（逐个 grep 过）：
 * `--dsw-alias-label-primary-dimmed`（行文字色，与 `.dsh-queuedock-preview` 同源）、
 * `--dsw-alias-border-l2`、`--dsw-alias-bg-layer-2`、`--dsw-alias-brand-primary`、
 * `--dsw-font-xs-13`、`--dsw-radius-md`。凭空写一个不存在的 `--dsw-alias-text-3`
 * 会静默失效（CSS 自定义属性没有 fallback 时整条声明作废）。
 */
const HOST_STYLE_RULES = [
  '.dsh-queuedock-editor { display: flex; flex-direction: column; gap: 6px; width: 100%; padding: 4px 0 2px; }',
  '.dsh-queuedock-editor-input { box-sizing: border-box; width: 100%; min-height: 44px; max-height: 160px; padding: 6px 8px;'
  + ' border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 8px);'
  + ' background: var(--dsw-alias-bg-layer-2, transparent); color: inherit; font: inherit; resize: vertical; }',
  '.dsh-queuedock-editor-hint { margin: 0; color: var(--dsw-alias-label-primary-dimmed);'
  + ' font: var(--dsw-font-xs-13, 12px/1.4 inherit); }',
  '.dsh-queuedock-editor-actions { display: flex; gap: 8px; }',
  '.dsh-queuedock-editor-save, .dsh-queuedock-editor-cancel { padding: 3px 12px;'
  + ' border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 8px);'
  + ' background: transparent; color: var(--dsw-alias-label-primary-dimmed);'
  + ' font: var(--dsw-font-xs-13, 12px/1.4 inherit); cursor: pointer; }',
  '.dsh-queuedock-editor-save { border-color: transparent; background: var(--dsw-alias-brand-primary); color: #fff; }'
];

/** 挂载输入投影与队列编辑器的样式表。 */
function ensureModeStyle(doc) {
  if (doc.getElementById(MODE_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = MODE_STYLE_ID;
  style.textContent = [
    `[${LEGACY_HIDDEN_ATTR}] { display: none !important; }`,
    '.dsh-sidebar-mount[hidden], .dsh-chat-mount[hidden], .dsh-composer-mount[hidden], .dsh-queue-mount[hidden] { display: none !important; }'
  ].concat(HOST_STYLE_RULES).join('\n');
  (doc.head || doc.documentElement).appendChild(style);
}

/* ═══════════════════════════════════════════════════════════════════
 * 队列行的就地编辑器
 *
 * `dsh-composer.js` 的 `queueDock` 只有 `onEdit(id, text)` 这一个回调 —— 它通知
 * "用户点了编辑"，但**没有**"编辑结果"的回调（编辑 UI 在原版是宿主的 slot）。
 * 所以这里在它画好的行里补一个最小的就地编辑器：textarea + 保存 / 取消。
 * 这是**补宿主那一半**，不改组件、不改它的类名与结构。
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * 就地把一行队列铺成编辑态。
 *
 * @param {object} options
 * @param {HTMLElement} options.row `.dsh-queuedock-row`
 * @param {string} options.text 当前文本
 * @param {Function} options.onSave `(nextText) => void`
 * @param {Function} options.onCancel
 * @returns {void}
 */
function openQueueRowEditor({ row, text, onSave, onCancel }) {
  const doc = row.ownerDocument;
  /** 已经在编辑就别再铺一层（连点两下编辑钮）。 */
  if (row.querySelector('.dsh-queuedock-editor')) return;

  const host = el(doc, 'div', 'dsh-queuedock-editor');
  const area = el(doc, 'textarea', 'dsh-queuedock-editor-input');
  area.value = String(text ?? '');
  area.setAttribute('aria-label', '编辑排队消息');

  const actions = el(doc, 'div', 'dsh-queuedock-editor-actions');
  const save = el(doc, 'button', 'dsh-queuedock-editor-save');
  save.type = 'button';
  save.textContent = '保存';
  const cancel = el(doc, 'button', 'dsh-queuedock-editor-cancel');
  cancel.type = 'button';
  cancel.textContent = '取消';
  actions.append(save, cancel);

  /**
   * 提示里**必须**说清"图片不会被这一行改掉"。
   *
   * `QueueDock` 的行只显示文字（它没有图片位），但会话层的 edit 分支
   * （`turn.js:236-239`）落盘的是 `{...row, text: next}` —— `imageIds`
   * 原样保留。也就是说"编辑带图的排队消息"**改不到图**。这是服务的既有语义，
   * 界面照实说，不假装能改（也不加一个服务不实现的开关）。
   */
  const hint = el(doc, 'p', 'dsh-queuedock-editor-hint',
    '只改文字；这条排队消息带的图片不受影响（这一行不显示图片）。');
  host.append(area, hint, actions);

  /** 预览让位给编辑框（**不删**预览节点 —— 取消时还要它回来）。 */
  const preview = row.querySelector('.dsh-queuedock-preview');
  if (preview) preview.hidden = true;
  row.appendChild(host);
  area.focus();

  cancel.addEventListener('click', () => {
    host.remove();
    if (preview) preview.hidden = false;
    onCancel?.();
  });
  save.addEventListener('click', () => {
    const next = area.value.trim();
    if (!next) { area.focus(); return; }
    /** ⚠️ **只走 `content`**：它是 `turn.js` 的 edit 分支唯一读的键。
     *  另发一个 `text` 是死代码（服务会忽略），只会在代码里留下假接口。 */
    onSave?.(next);
  });
}

/* ═══════════════════════════════════════════════════════════════════
 * 挂载
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * 把三个 DSH 组件挂到真实界面上，并接好订阅与回调。
 *
 * **幂等**：同一个 `doc` 上重复调用返回同一个句柄，不会建第二套容器。
 *
 * @param {object} [options]
 * @param {Document} [options.document] 宿主文档（默认全局 `document`）
 * @param {object} [options.ctx] 真实数据与既有逻辑的入口（见下）
 * @param {object} [options.labels] 文案覆盖（`dsh-chat.js` 的 `DEFAULT_LABELS` 键名）
 * @returns {object|null} 句柄 `{ update, destroy, components }`；
 *   三个组件或挂载点缺失时返回 `null`。
 */
function mountDshViews(options = {}) {
  const doc = options.document || (typeof document !== 'undefined' ? document : null);
  if (!doc) return null;
  const ctx = options.ctx || {};
  const $ = selector => doc.querySelector(selector);

  const sidebarHost = $(ctx.selectors?.sidebar || '#talkSessionList');
  const chatHost = $(ctx.selectors?.chat || '#talkConv');
  const inputHost = $(ctx.selectors?.input || '#talkIn');
  if (!sidebarHost || !chatHost || !inputHost) return null;

  /** 组件自己取全局；这里只确认它们都在（缺一个就别挂，让调用方走旧路径）。 */
  const conversationApi = doc.defaultView.ConversationManagement;
  const chatApi = options.chat || chatOf();
  const composerApi = options.composer || composerOf();
  const bridge = options.bridge || bridgeOf();
  if (!conversationApi?.createConversationList || !chatApi?.chatView || !composerApi?.inputBar) return null;

  /** 幂等：已经在同一个宿主上挂过就复用。 */
  if (doc.body?.dataset.dshMounted === '1' && doc.__dshMountHandle) return doc.__dshMountHandle;

  /** 挂载宿主输入投影的隐藏样式。 */
  ensureModeStyle(doc);

  /** 隐藏的宿主输入节点保留正文和附件投影。 */
  const legacyTalkin = el(doc, 'div', 'dsh-legacy-talkin');
  legacyTalkin.id = NODE_IDS.legacyTalkin;
  const talkInParent = inputHost.parentElement;
  /** 搬走 `.talkin` 的**原有**子节点（此刻新卡片还没挂进去）。 */
  if (talkInParent) while (talkInParent.firstChild) legacyTalkin.appendChild(talkInParent.firstChild);
  const legacyQueue = $(ctx.selectors?.queue || '#talkQueue');
  /** 附件投影节点供草稿订阅读取。 */
  const legacyPendingStrip = $('#talkPendingStrip');
  /** 隐藏的宿主输入与附件投影。 */
  const legacyInputParts = [legacyTalkin];
  if (legacyPendingStrip) legacyInputParts.push(legacyPendingStrip);

  /** 会话列表与消息区各有一个挂载点。 */
  const sidebarMount = el(doc, 'div', 'dsh-sidebar-mount');
  sidebarMount.id = NODE_IDS.sidebarMount;
  const chatMount = el(doc, 'div', 'dsh-chat-mount');
  chatMount.id = NODE_IDS.chatMount;

  const composerMount = el(doc, 'div', 'dsh-composer-mount');
  composerMount.id = NODE_IDS.composerMount;
  const queueMount = el(doc, 'div', 'dsh-queue-mount');
  queueMount.id = NODE_IDS.queueMount;

  chatHost.setAttribute('data-conversation-scroll', '');
  chatHost.replaceChildren(chatMount);
  sidebarHost.replaceChildren(sidebarMount);
  /** 新输入卡插在旧输入卡**后面**（兄弟关系，不换父节点）。 */
  if (talkInParent) talkInParent.append(legacyTalkin, queueMount, composerMount);
  else chatHost.after(queueMount, composerMount);

  /* ── 1. 侧栏会话列表（`#talkSessionList` 位置） ─────────────────── */

  const browser = conversationApi.createConversationList({
    document: doc,
    onOpen: sessionId => { ctx.openSession?.(sessionId); },
    /** 会话操作由宿主回调执行。 */
    onRenameRequest: (sessionId, currentTitle) => { ctx.renameSession?.(sessionId, currentTitle); },
    onDeleteRequest: (sessionId, title) => { ctx.deleteSession?.(sessionId, title); }
  });
  sidebarMount.appendChild(browser.root);

  /* ── 2. 聊天区（`#talkConv` 位置） ──────────────────────────────── */

  const chat = chatApi.chatView({
    messages: bridge.chatMessagesFrom(ctx.currentSession?.() || null, { readImage: ctx.readImage, actions: ctx.toolActions?.() }),
    turns: bridge.chatTurnsFrom(ctx.currentSession?.() || null),
    sessionId: ctx.currentId?.() || '',
    processExpanded: turnId => ctx.processExpanded?.(ctx.currentId(), turnId),
    labels: options.labels,
    /**
     * 图片解析交给宿主的缓存解析器（`app-view.js` 的 `fullImageFor`）——
     * 组件只在建画廊时按块调一次，不进每帧路径（`dsh-chat.js` 约定 ③）。
     */
    images: bridge.imageResolver(ctx.resolveImage),
    onOpenImage: imageId => { ctx.openImage?.(imageId); },
    onReadImageMetadata: ctx.readImageMetadata,
    isRunning: () => ctx.isRunning?.() === true,
    onEditMessage: input => ctx.editMessage?.(input),
    onRegenerate: input => ctx.regenerate?.(input),
    onToggleGroup: (open, groupKey) => { ctx.onToggleGroup?.(open, groupKey); },
    onToggleTurnProcess: (open, turn) => { ctx.onToggleTurnProcess?.(open, turn); }
  });
  chatMount.appendChild(chat.root);

  /* ── 3. 输入卡（`#talkIn` 附近） ───────────────────────────────── */

  /* ═══════════════════════════════════════════════════════════════════
   * 3.0 **草稿状态层** —— 正文 + 附件的唯一权威
   *
   * 草稿（正文 + 附件）的事务边界只有一处：`SessionInputShell`。两套状态并存
   * 会互相覆盖，表现是：发完图图仍留在待发区 / 图文同发时文本丢失 /
   * 发送要等 1~2 秒才出现 / 第一次发完之后发不出去。
   *
   * 投影方向（**只有这两个方向，没有第三条**）：
   *   · 权威 → 视图：`shell.state.subscribe(...)` 把 `draft` / `attachmentIds`
   *     推给输入卡、附件轨、以及宿主的 `ui.sendDrafts`（`ctx.replaceDrafts`）。
   *   · 视图 → 权威：编辑器的 `input` 事件（用户敲键）与宿主草稿条的变化
   *     （`ctx.draftsRoot` 的 `MutationObserver`）各喂一次 `shell.setDraft` /
   *     `shell` 的附件动作。
   *
   * ⚠️ 界面上看到的**永远**是权威的投影；投影里没有任何"清"的动作。
   * ═══════════════════════════════════════════════════════════════════ */

  const inputState = inputStateOf();
  let restoringDraft = false, displayedSession = '', savedDraftKey = '', submissionParts = null;
  const shell = inputState.createDraftFacade({
    /**
     * 编辑器端口：状态层给的最小纯文本实现（Lexical 未移植，见它的 `UNPORTED`）。
     * 收 `{onUpdate, openReference, activeClaimToken, lexicon, resolveLexicon}`，
     * 这里逐字透传 —— 不自己补一套编辑器。
     */
    editorFactory: callbacks => inputState.createTextEditorPort(callbacks),
    /**
     * 普通消息的**唯一落点**：把（正文 + 附件 id 快照）交给既有发送链路。
     * `sendTalk()` 仍是那条链路的全部实现（排队判定、挂接、状态栏、收尾）。
     */
    defaultSink: (text, attachmentIds, mode, signal) => {
      const submittedSession = ctx.currentId?.();
      /**
       * 旧 `#talkIn` 仍然同步一份 —— 它别处还有读的地方（提问卡、旧工具栏）。
       * ⚠️ 这是**兼容副本**，不是草稿的另一份权威：写进去的值就是刚提交的快照。
       */
      const input = $(ctx.selectors?.input || '#talkIn');
      if (input) input.value = String(text ?? '');
      /**
       * 附件**不写回宿主的草稿投影**。
       *
       * ⚠️ 这里不能调 `ctx.replaceDrafts(attachmentIds)`：纯附件发送的路径上
       * （`submit()` 的 `commitSend` 分支）清空与投影都发生在同一个同步块里，
       * 而这次写回排在**清空之后** —— 刚被权威清掉的附件会被写回宿主，
       * 表现为"发完图，图还在待发区"。
       *
       * 附件 id 改由**参数**交给发送链路（`ctx.send(reply, attachmentIds)`）：
       * 宿主投影始终只是权威的镜像，只在投影时被改写。
       */
      const reply = { text: String(text ?? ''), attachmentIds: [...attachmentIds], ...(submissionParts ? {parts:structuredClone(submissionParts)} : {}) };
      if (mode === 'steer') reply.mode = 'steer';
      return Promise.resolve(ctx.send?.(reply, attachmentIds)).then(
        result => (ctx.currentId?.() !== submittedSession ? {kind:'success'} : result?.ok === false
          ? { kind: 'error', text: String(result?.error?.message || result?.text || '发送失败') }
          : { kind: 'success' }),
        error => ({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
      ).finally(() => {
        /** 宿主侧收尾（会话重绘等）—— 不在这里清任何草稿。 */
        ctx.afterSend?.();
      });
    },
    /**
     * 提交面状态快照（`submissionState`）—— 本项目没有 Session 投影面，
     * 给一个空对象：它只喂给 `reportMessageSubmission` 的分析埋点，
     * 而本项目**不统计用量**。不假装有值。
     */
    submissionState: () => Object.freeze({}),
    /**
     * ⚠️ **接不上的地方**（对照状态层 `UNPORTED`）：
     * `/` 指令 + `@` 引用的裁决管线（`ui-input-trigger`，27KB）本项目没有，
     * 所以不给 `inputTriggers` —— 按状态层自己的契约，`/` 开头的行就是一条
     * **普通消息**（`adjudicate` 无管线 → `outcome: undefined` → 落到 defaultSink）。
     * 这是照它的契约降级，不是自己补一套裁决。
     */
    ...(ctx.inputTriggers ? { inputTriggers: ctx.inputTriggers } : {}),
    /** 没有 claim 就不可能走到命令附件面；给足形状，路径不可达。 */
    commandAttachments: {
      serialize: async ids => ids.map(id => ({ type: 'image', id })),
      release: () => {},
      unsupportedNotice: token => `该指令不支持附件：${String(token ?? '').trim()}`,
    },
  });

  /**
   * 权威最后一次投影出去的附件 id。
   *
   * ⚠️ **它存在的唯一理由是"投影不能被自己的回声覆盖"**：
   *
   * `ctx.replaceDrafts` 改的是宿主的 `ui.sendDrafts`，而待发条的重绘会触发
   * `MutationObserver` —— 那是**微任务**，比当前同步块晚。纯附件发送的路径上，
   * `default-sink` 与 `commitSend` 都在同一个同步块里跑完（`ui.sendDrafts` 已空），
   * 但"清空之前"那次重绘排下的回调此刻才执行，它读到的仍是**旧**的
   * `ui.sendDrafts`（还有那张图）→ 会把刚被权威清掉的附件**又加回去**。
   *
   * 有了这份基线就能分清两件事：
   *   · 宿主列表与基线**一致** → 这是投影的回声，跳过；
   *   · 宿主列表与基线**不同** → 宿主真的动了草稿（选图 / 取消勾选），采纳。
   */
  let projectedAttachmentIds = [];

  /**
   * 把宿主的 `ui.sendDrafts` 与附件轨重建成权威的投影。
   *
   * ⚠️ 顺序固定：**先写宿主的那一份**（`ctx.replaceDrafts` 会重绘 `#talkImgRow`
   * 与图片仓库），再刷组件。反过来会让 `MutationObserver` 先看到一次旧状态。
   */
  function projectDrafts() {
    const ids = shell.snapshot.attachmentIds;
    /** 已经是最后一次投影出去的那份就不必再写（`replaceDrafts` 每次都重绘待发条）。 */
    if (!sameIds(ids, projectedAttachmentIds)) {
      ctx.replaceDrafts?.(ids);
      projectedAttachmentIds = [...ids];
    }
    const items = ids.map(id => ({ imageId: id, kind: 'image' }));
    bar?.setAttachments(items);
    attachments.update(items);
  }

  /** 两个 id 列表是否逐位相同（顺带比较长度）。 */
  function sameIds(a, b) {
    return a.length === b.length && a.every((id, index) => id === b[index]);
  }

  /** 首帧：宿主此刻已有的草稿图要**先喂进权威**，否则它们会被投影清掉。 */
  function adoptDrafts() {
    const ids = (ctx.resolveAttachments?.() || [])
      .map(item => String(item?.imageId || item?.id || ''))
      .filter(Boolean);
    const known = new Set(shell.snapshot.attachmentIds);
    const missing = ids.filter(id => !known.has(id));
    if (missing.length) shell.addAttachments(missing);
  }

  /**
   * 权威变化 → 视图。
   *
   * 正文只在**与输入框里那份不同**时才写回 —— `setText` 会整段重写 contenteditable
   * 并把 caret 拍到最后，敲一个键就写一次会让光标乱跳。内容一致就是同一份草稿，
   * 不需要写。
   */
  const unsubscribeDraftState = shell.state.subscribe(() => {
    const draft = shell.snapshot.draft;
    if (bar && bar.getText() !== draft) bar.setText(draft);
    projectDrafts();
    const sessionId = ctx.currentId?.();
    const key = JSON.stringify([sessionId, draft, shell.snapshot.attachmentIds]);
    if (!restoringDraft && sessionId && savedDraftKey !== key) {
      savedDraftKey = key;
      void ctx.saveDraft?.({ sessionId, text: draft, imageIds: [...shell.snapshot.attachmentIds] });
    }
  });

  /**
   * 视图 → 权威：用户在卡片里敲键。
   * 组件层不依赖状态层（它只收投影），所以这里用它的 `input` 事件把正文喂回去；
   * `input` listener 必须排在该 swap 之后 —— 读到的已经是新文本。
   */
  const onDraftInput = () => {
    const typed = bar.getText();
    if (typed !== shell.snapshot.draft) shell.setDraft(typed);
  };

  /* ── 3. 输入卡（`#talkIn` 附近） ───────────────────────────────── */

  /**
   * ⚠️ **用量计量环不挂载：本项目不统计用量。**
   *
   * 组件本身保留在 `dsh-composer.js` 里（照抄 DSH 的、有测试，将来要用随时
   * 能挂回来），这里只是**不建、不挂**。挂上它的后果是假读数：窗口未知时
   * `used / 0` 得 `Infinity`，再被 `Math.min(100, …)` 夹成 **100%**。
   *
   * `meter` 保留成 `null` 占位，`update` / `dispose` 处都做了判空，
   * 免得将来挂回来时忘改这两处。
   */
  const meter = null;
  /**
   * **卡片内的待发图片轨** —— 照抄 DSH `ui-attachment` 的 `ComposerAttachments`，
   * 挂在 `inputBar` 的 `slots.attachments`（原版是 `conversation.input.attachments` 槽）。
   *
   * 图片来源用项目自己的缩略图管道（`ctx.resolveImage`），
   * 删除走 `ctx.removeDraft`（`app-view.js` 里既有草稿链路）。
   */
  const attachments = composerApi.composerAttachments({
    /**
     * ⚠️⚠️ **这里必须走 `ctx`，不是 `deps`。**
     *
     * `mountDshViews(options)` 的形参叫 `options`，`deps` 只存在于另一层的
     * `createDshContext(deps)` 里。写 `deps.resolveImage` 就是**未定义变量**，
     * 而 `?.` 不报错、外层 `try/catch` 又吞掉异常 → 恒返回空串
     * → **附件轨里的缩略图永远不渲染**（发图后只看到一个模糊的灰方块）。
     * 这种失败**完全静默**：不报错、不警告，只是不出图。
     */
    resolve: imageId => {
      try {
        const asset = ctx.resolveImage?.(imageId, 'thumbnail') || '';
        /** `resolveImage` 回字符串或对象 —— 两种都认（项目里两种都存在）。 */
        return typeof asset === 'string' ? asset : String(asset?.thumbnailDataUrl || asset?.dataUrl || '');
      } catch { return ''; }
    },
    /**
     * 删除走**状态层**（`shell.removeAttachment`）—— 它是附件列表的权威。
     * 权威一变就投影回宿主，`ui.sendDrafts` 与待发条随之更新（见 `projectDrafts`）。
     */
    onRemove: imageId => { removeAttachment(imageId); },
    onOpen: imageId => { ctx.openImage?.(imageId); },
    labels: { pending: options.composerText?.attachmentsPending, remove: options.composerText?.attachmentsRemove },
    /** 附件轨的 items **来自状态层的附件快照**，不直接读 `ctx.resolveAttachments()`。 */
    items: shell.snapshot.attachmentIds.map(id => ({ imageId: id, kind: 'image' }))
  });
  const bar = composerApi.inputBar({
    variant: 'composer',
    session: Boolean(ctx.currentSession?.()),
    running: ctx.isRunning?.() === true,
    canSteerQueue: false,
    text: options.composerText,
    /**
     * `attachments` = 卡片内的待发图片轨。
     * `right` 槽是上下文计量环，本项目不挂载（见 `meter` 的说明）。
     */
    slots: { attachments: attachments.root },
    /**
     * **发送**：把提交**交给状态层**，这里没有任何事务代码。
     *
     * 组件给的 `text` 只是它自己那份投影；权威在 `shell` 里，所以先把它同步进
     * 权威（用户可能从没触发过 `input` 事件，例如程序化写入），再 `submit()`：
     *
     *   `shell.submit(mode, 'enter')`
     *     → 机器发 `[default-sink, commit-draft]`（顺序即契约）
     *       · `default-sink`  先捕获正文与附件 id 快照 → `deps.defaultSink` → `ctx.send`
     *       · `commit-draft`  **后**清正文（当场，不等网络往返）
     *     → 附件在 `sinkSerialized` 里当场清空
     *     → 订阅把（空）投影推回输入卡、附件轨、`ui.sendDrafts`
     *     → 失败则 `restoreAttachments` + `restoreFailedDrafts` 一起还原
     *
     * `mode:'steer'` 照旧透传（`sendTalk({ mode:'steer' })` 是项目里的插队入口）。
     */
    onSend: ({ text, mode }) => {
      if (typeof text === 'string' && text !== shell.snapshot.draft) shell.setDraft(text);
      const parts = ctx.currentSession?.()?.draft || [];
      const ids = [...new Set(parts.filter(p => p.type === 'image').map((p,i) => p.imageId === null ? 'missing:' + i : p.imageId))];
      submissionParts = parts.filter(p => p.type === 'text').map(p => p.text).join('\n') === shell.snapshot.draft && sameIds(ids,shell.snapshot.attachmentIds) ? structuredClone(parts) : null;
      shell.submit(mode === 'steer' ? 'steer' : 'queue', 'enter');
    },
    onStop: () => { ctx.stop?.(); },
    /**
     * **清空本次对话** —— 输入卡右下角的那个 ✕。
     *
     * 走 `ctx.clearConversation`（`app-view.js` 的 `confirmClearConversation`）：
     * 弹确认框、报"清空 N 条消息"、**明确保留对话图片**、
     * 然后调 `assistant.clearSession` 并重绘。
     */
    onClearConversation: () => { ctx.clearConversation?.(); },
    /**
     * **`+` 按钮** —— 接项目原有的文件选择器（`#talkImgFile`）。
     *
     * 组件自己的规则是"没给 `onToggleCommandMenu` 就 `disabled`"，
     * 所以不给的话按钮是灰的。本项目的 `+` 不做命令菜单（没有那套系统），
     * 就是**加图**。
     *
     * ⚠️ 文件进来之后**这里不登记附件**：选中的图经既有链路落进宿主草稿，
     * `ctx.draftsRoot` 的 `MutationObserver` 看到变化后再喂进权威（见 `syncDrafts`）。
     * 一个来源一处登记 —— 不在两个地方各写一遍。
     */
    onToggleCommandMenu: () => { ctx.onPickFiles?.(); },
    onPickFiles: () => { ctx.onPickFiles?.(); },
    /**
     * 附件门数据 —— **来自状态层的附件快照**（不是 `ctx.resolveAttachments()`）。
     * 输入卡用它算"空文本 + 无附件 = 不能发"，所以这份必须与权威一致。
     */
    resolveAttachments: () => shell.snapshot.attachmentIds.map(id => ({ id, kind: 'image' })),
    /** 移除一个附件 —— 同样驱动状态层，不直接改宿主的草稿数组。 */
    onRemoveAttachment: attachment => {
      const imageId = attachment?.imageId || attachment?.id;
      if (!imageId) return;
      removeAttachment(imageId);
    }
  });
  composerMount.appendChild(bar.root);

  /**
   * 用户敲键 → 权威。
   *
   * 组件层不依赖状态层（它只收投影），所以由这里补一个 `input` listener。
   * 必须挂在 `bar` 建好之后：`input` 在浏览器改完 DOM 才派发，读到的已是新文本。
   */
  bar.inputEl?.addEventListener('input', onDraftInput);

  /**
   * 移除一个附件：**先问权威**，再让投影把结果推回去。
   *
   * 只走 `shell.removeAttachment`（busy 相位它自己会拒绝）；宿主的 `ui.sendDrafts`
   * 由 `projectDrafts` 跟着重写 —— 没有第二条"自己 splice 再重绘"的路径。
   */
  function removeAttachment(imageId) {
    shell.removeAttachment(String(imageId));
  }

  const dock = composerApi.queueDock({
    items: bridge.queueItemsFrom(ctx.queue?.() || []),
    running: ctx.isRunning?.() === true,
    queueMutable: true,
    text: options.composerText,
    onEdit: (id, currentText) => {
      const row = dock.list.querySelector(`.dsh-queuedock-row[data-queue-item="${cssEscape(id)}"]`);
      if (!row) return;
      openQueueRowEditor({
        row,
        text: currentText,
        onSave: next => {
          ctx.updateQueue?.(id, { kind: 'edit', content: [{ type: 'text', text: next }] });
          update();
        },
        onCancel: () => { /* 取消就恢复预览，不需要重画 */ }
      });
    },
    onRemove: id => {
      ctx.updateQueue?.(id, { kind: 'remove' });
      update();
    },
    onSteer: id => {
      ctx.updateQueue?.(id, { kind: 'steer' });
      update();
    }
  });
  queueMount.appendChild(dock.root);

  /** 宿主输入节点只提供草稿投影。 */
  for (const node of legacyInputParts) node.setAttribute(LEGACY_HIDDEN_ATTR, '');
  legacyQueue?.setAttribute(LEGACY_HIDDEN_ATTR, '');

  /* ── 5. 订阅：收到变更就 `update()`，**不重建** ────────────────── */

  let lastSignature = null;

  /**
   * 把真实数据推给三个组件。
   *
   * 全部走各组件的 `update()` —— 节点引用保持不变（`dsh-chat.js` 的指纹复用、
   * `dsh-sidebar.js` 的 `signatureOf` 缓存都靠这一点）。
   *
   * @returns {void}
   */
  function update() {
    const sessions = ctx.sessions?.() || [];
    const session = ctx.currentSession?.() || null;
    const running = ctx.isRunning?.() === true;
    const currentId = ctx.currentId?.() || '';
    const serverText = session?.draft.filter(p => p.type === 'text').map(p => p.text).join('\n') || '';
    const serverImages = session?.draft.filter(p => p.type === 'image').map((p, i) => p.imageId === null ? 'missing:' + i : p.imageId) || [];
    if (session && (currentId !== displayedSession || serverText !== shell.snapshot.draft || !sameIds([...new Set(serverImages)], shell.snapshot.attachmentIds))) {
      restoringDraft = true;
      try {
        const parts = session.draft;
        const ids = parts.filter(p => p.type === 'image').map((p, i) => p.imageId === null ? 'missing:' + i : p.imageId);
        shell.setDraft(parts.filter(p => p.type === 'text').map(p => p.text).join('\n'));
        shell.pruneAttachments([]); shell.addAttachments(ids);
        displayedSession = currentId;
        savedDraftKey = JSON.stringify([currentId, shell.snapshot.draft, shell.snapshot.attachmentIds]);
        projectDrafts();
      } finally { restoringDraft = false; }
    }

    /** 会话记录、轮次和宿主动作声明投影到消息区。 */
    chat.update(bridge.chatMessagesFrom(session, {readImage: ctx.readImage, actions: ctx.toolActions?.()}), running, {
      turns: bridge.chatTurnsFrom(session),
      sessionId: currentId,
      isRunning: () => ctx.isRunning?.() === true,
    });
    browser.update({ sessions, currentId });

    const items = bridge.queueItemsFrom(ctx.queue?.() || []);
    dock.update(items);
    dock.setRunning(running);
    /** 队列投影节点记录是否有内容。 */
    if (legacyQueue) legacyQueue.dataset.dshHasItems = items.length ? '1' : '0';

    bar.setSession(Boolean(session));
    bar.setBusy(running);
    bar.setRunning(running);
    bar.setCanSteerQueue(false);

  /** 计量环没挂时不更新（判空保留，便于将来挂回来）。 */
  if (meter) meter.update(bridge.contextMeterDataFrom(ctx.meterSources?.() || {}) || {});

    lastSignature = signatureOf({ sessions, session, running, items });
  }

  /** 指纹只在调试与断言里用得到 —— 记录"最后一次推给组件的是什么"。 */
  function signatureOf({ sessions, session, running, items }) {
    return [
      running ? '1' : '0',
      session?.id || '',
      (session?.messages || []).length,
      sessions.length,
      items.length
    ].join('|');
  }

  /* ── 6. 会话事件订阅 ──────────────────────────────────────────── */

  let unsubscribe = null;
  if (typeof ctx.subscribe === 'function') unsubscribe = ctx.subscribe(() => { update(); });

  /* ── 7. 宿主草稿层变化 → 喂进权威（正文与附件都只有一个来源） ──────── */

  /**
   * 宿主的草稿图列表变了（`+` 选图、图片仓库卡片上的"待发"开关、切会话时清空）
   * —— 把它当作**输入**喂进状态层，然后由权威的投影刷回两处：
   *   · `bar.setAttachments(…)` —— 输入卡靠它算"附件门"（空文本 + 无附件 = 不能发）
   *   · `attachments.update(…)` —— 卡片内的缩略图批（照抄 `ComposerAttachments`）
   *
   * ⚠️ **这里不清任何草稿**：`shell.addAttachments` 是权威的**写入**动作，
   * 清空由提交事务（`commitSend` / `commit-draft`）负责。两件事不在一个地方做。
   *
   * `MutationObserver` 是**异步**的（微任务），所以提交那条路径不会与它打架：
   * 提交在同步块里就清完了正文与附件。但"清空**之前**那次重绘"排下的回调此刻
   * 才轮到执行，它读到的仍是旧的 `ui.sendDrafts` —— 所以第一句就是拿
   * `projectedAttachmentIds`（上一次投影出去的那份）做**回声判定**，
   * 一致就直接返回，绝不把权威刚清掉的附件又加回去。
   */
  const syncDrafts = () => {
    const ids = [...new Set((ctx.resolveAttachments?.() || [])
      .map(item => String(item?.imageId || item?.id || ''))
      .filter(Boolean))];
    /** 宿主列表 == 上一次投影 → 这是投影自己的回声，不是宿主动作。 */
    if (sameIds(ids, projectedAttachmentIds)) return;
    const known = new Set(shell.snapshot.attachmentIds);
    const kept = ids.filter(id => known.has(id));
    const missing = ids.filter(id => !known.has(id));
    /** 宿主删掉了权威里还有的图（例如图片仓库卡片上取消勾选）→ 让权威跟上。 */
    if (kept.length !== known.size) shell.pruneAttachments(kept);
    if (missing.length) shell.addAttachments(missing);
    /** 权威没动时（没有缺失、也没有被裁掉）也要刷一次视图，首帧靠这一句。 */
    projectDrafts();
  };

  const observer = typeof MutationObserver === 'function' && ctx.draftsRoot
    ? new MutationObserver(() => { syncDrafts(); })
    : null;
  observer?.observe(ctx.draftsRoot, { childList: true });

  /** 首帧：先采纳宿主已有的草稿图，再推一次投影。 */
  adoptDrafts();
  update();
  projectDrafts();

  const handle = {
    update,
    signature: () => lastSignature,
    destroy() {
      unsubscribe?.();
      unsubscribeDraftState?.();
      observer?.disconnect();
      /** 状态层按它自己的拆除轴释放（未结算 detach 发送的附件也一并交回）。 */
      shell.dispose();
      chat.destroy();
      bar.dispose();
      meter?.dispose();
      try { delete doc.body.dataset.dshMounted; } catch { /* 文档已销毁 */ }
      delete doc.__dshMountHandle;
    },
    /** 句柄暴露状态层门面：断言与调试用（生产路径只走组件）。 */
    components: { browser, chat, bar, meter, dock, shell, mounts: { sidebarMount, chatMount, composerMount, queueMount } }
  };

  try { doc.body.dataset.dshMounted = '1'; } catch { /* body 还没有 */ }
  doc.__dshMountHandle = handle;
  return handle;
}

/**
 * 从 `app-view.js` 的内部状态拼出 `mountDshViews` 要的 `ctx`。
 *
 * 这样 `app-view.js` 里只需要**一行**接线（取名字 → 交给挂载层），
 * 哪些真实来源对应哪个字段全部收在这个文件里。
 *
 * @param {object} deps 宿主注入的真实入口
 * @param {object} [overrides] 覆盖/补默认
 * @returns {object} `mountDshViews({ ctx })` 要的对象
 */
function createDshContext(deps = {}, overrides = {}) {
  const assistant = deps.assistant || null;
  const ctx = {
    selectors: {
      sidebar: '#talkSessionList',
      chat: '#talkConv',
      input: '#talkIn',
      queue: '#talkQueue'
    },
    sessions: () => { try { return assistant?.sessions?.() || []; } catch { return []; } },
    currentSession: () => { try { return assistant?.currentSession?.() || null; } catch { return null; } },
    currentId: () => { try { return assistant?.currentSession?.()?.id || ''; } catch { return ''; } },
    isRunning: () => { try { return assistant?.snapshot?.()?.busy === true; } catch { return false; } },
    saveDraft: input => assistant.saveDraft(input),
    readImage: imageId => assistant.resolveSessionImage({sessionId:ctx.currentId(),imageId}),
    queue: () => { try { return assistant?.queue?.() || []; } catch { return []; } },
    subscribe: cb => { try { return assistant?.subscribe?.(cb) || null; } catch { return null; } },
    /**
     * **用量来源**（计量环的数据）。
     *
     * ① **按轮次的用量存在 `message.usage`，不是 `message.result.usage`。**
     *    `turn.js` 收到运行时的 `ai.usage` 事件后写进 `live.usage`（那条消息自己的字段）。
     *    `result.usage` 是**别的东西**（任务结果里的用量，通常没有）。
     *    读错地方的表现就是"计量环永远隐藏"。
     *
     * ② **窗口大小必须一起给**。`contextMeter` 的硬规则是
     *    `usedTokens` 与 `windowTokens` **缺一个就 `hidden`** ——
     *    这是刻意的：未知就隐藏，不显示 0% 或 100% 那种假精确。
     *    窗口来自链路的 `contextWindow` 声明（宿主设置里填），不猜。
     *    本项目没有这个来源，`windowTokens` 恒为 0，计量环按契约保持隐藏。
     */
    meterSources: () => {
      const session = ctx.currentSession();
      const messages = Array.isArray(session?.messages) ? session.messages : [];
      let usage = null;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const row = messages[i];
        if (row?.usage && typeof row.usage === 'object') { usage = row.usage; break; }
        /** 兼容旧数据：`result.usage` 也认。 */
        if (row?.result?.usage && typeof row.result.usage === 'object') { usage = row.result.usage; break; }
      }
      const windowTokens = Number(ctx.contextWindow?.()) || 0;
      return { usage, windowTokens };
    },
    /**
     * **`+` 按钮**（DSH 里是"命令菜单"，本项目接成文件选择器）。
     *
     * DSH 那个 `+` 打开的是 `ui-input-trigger` 的菜单（`/` 指令 + `@` 引用 + 附件，
     * 控制器 27KB）。本项目没有那套命令系统，而 `+` 的实际用途就是**加图** ——
     * 所以接上项目**原有的** `<input type=file id="talkImgFile">`。
     * 走既有链路的好处：多选、去重、草稿条、发送时挂接全部照旧，一行都不用重写。
     */
    onPickFiles: () => {
      const picker = document.getElementById('talkImgFile');
      if (picker) picker.click();
    },
    resolveImage: deps.resolveImage,
    readImageMetadata: deps.readImageMetadata,
    openImage: deps.openImage,
    /**
     * 宿主那一份草稿图**只读投影**（`ui.sendDrafts`）。
     *
     * ⚠️ 它**不是**第二份权威：权威在状态层的 `shell` 里，这里读写它只是为了让
     * 既有链路（`sendTalk` 的挂接、图片仓库卡片的"待发"标记、旧草稿条）继续工作。
     * 挂载层从不自己改它，只在两处用它：**首帧采纳**已有的草稿图、
     * **提交时**把附件快照交给宿主。
     */
    resolveAttachments: deps.resolveAttachments,
    /**
     * 把宿主的草稿图列表**重建成**状态层给的 id 列表（顺序也照它）。
     *
     * `app-view.js` 的实现是"按 id 复原对象 + 重绘两条待发 UI"，**没有任何清空语义**：
     * 传进来的 id 就是权威当前的附件快照。
     */
    replaceDrafts: deps.replaceDrafts,
    /**
     * 一次发送走完既有链路之后的收尾（会话重绘等）。**不含任何草稿清理** ——
     * 那已经由状态层在提交当场做完了。
     */
    afterSend: deps.afterSend,
    draftsRoot: deps.draftsRoot || null,
    openSession: deps.openSession,
    send: deps.send,
    stop: deps.stop,
    updateQueue: (id, action) => { try { return assistant?.updateQueue?.(id, action); } catch { return null; } },
    onToggleGroup: deps.onToggleGroup,
    onToggleTurnProcess: deps.onToggleTurnProcess
  };
  return { ...ctx, ...overrides };
}

const dshMount = Object.freeze({
  mountDshViews,
  createDshContext,
  openQueueRowEditor,
  NODE_IDS
});

if (typeof window !== 'undefined') window.dshMount = dshMount;
if (typeof module !== 'undefined' && module.exports) module.exports = dshMount;
})();
