'use strict';
/**
 * DSH 轨迹行的**原生 JS 实现** —— 逐行对照 `packages/client/ui-chat/src/client/chat/`。
 *
 * 源码：`github.com/deepseek-ai/deepseek-harness`（MIT）
 *
 *   ReasoningRow   ← ReasoningRow.tsx + ReasoningRow.module.css
 *   useDisclosure  ← use-disclosure.ts
 *
 * 依赖 `dsh-primitives.js`（`DisclosureRow` / `TextShimmer`）。
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ **前几轮我为什么一直没抄对**
 *
 * DSH 里**思考行与工具行都是 `DisclosureRow` 的实例**，区别只在 props 与
 * 自己的 CSS。而我是照 bundle 反推的 —— bundle 里 `DisclosureRow` 被编译成
 * `css_default.xxx` 调用，**抽象层消失了**，于是我以为是"两种结构"，
 * 自己发明了 `.agent-thought`（铺开、无箭头），从此到处对不上。
 */

/** `useDisclosure` 的等价实现：一个版本号 + 一个是否展开。 */
function createDisclosure() {
  let version = 0;
  let expandedVersion = null;
  return {
    /** 当前展开状态。 */
    expanded: () => expandedVersion === version,
    /** 显式设置（DSH 的 `setExpanded`）。 */
    setExpanded: open => { expandedVersion = open ? version : null; },
    /** 切换（DSH 的 `toggle`）。 */
    toggle: () => { expandedVersion = expandedVersion === version ? null : version; },
    /**
     * **推进版本号 = 收起**（DSH 的 `version` 变化语义）。
     * 对应"所属 Turn 收起时把所有行复位"。
     */
    bump: () => { version += 1; }
  };
}

/**
 * 思考行的**概要文本** —— 逐行对照 `ReasoningRow.tsx` 的两个函数。
 *
 * 这是"对外只显示概要"的唯一来源：
 *   · 跑完：`firstLine(text)` —— 首行
 *   · 流式：`latestCompletedParagraphFirstLine(text)` —— **最后一段已完成的首行**
 *     （避免正在写的那句在概要里跳来跳去）
 *   · 都做 `replaceAll('**', '')` 去掉 Markdown 加粗标记
 *
 * ⚠️ 我上一版自己加了"限 80 字加省略号" —— DSH 没有这个截断，
 * 概要靠 CSS 的 `text-overflow: ellipsis` 处理溢出。已按原样去掉。
 */
function firstLine(text) {
  const newline = text.indexOf('\n');
  return newline === -1 ? text : text.slice(0, newline);
}

function latestCompletedParagraphFirstLine(text) {
  let summary = '';
  let paragraphStart = 0;
  const separator = /\r?\n(?:[\t ]*\r?\n)+/g;
  for (;;) {
    const nextParagraph = separator.exec(text);
    const paragraphEnd = nextParagraph === null ? text.length
      : nextParagraph.index + nextParagraph[0].indexOf('\n');
    const newline = text.indexOf('\n', paragraphStart);
    if (newline !== -1 && newline <= paragraphEnd) {
      const candidate = text.slice(paragraphStart, newline).trim();
      if (candidate !== '') summary = candidate;
    }
    if (nextParagraph === null) return summary;
    paragraphStart = nextParagraph.index + nextParagraph[0].length;
  }
}

/** 思考行的概要（`running ? latestCompletedParagraphFirstLine : firstLine`，再去 `**`）。 */
function reasoningOutline(text, running) {
  const source = typeof text === 'string' ? text : '';
  const summaryText = running ? latestCompletedParagraphFirstLine(source) : firstLine(source);
  return summaryText.replaceAll('**', '');
}

/**
 * `ReasoningRow` —— 一段思考的折叠行。
 *
 * DOM（照 `ReasoningRow.tsx` + `ReasoningRow.module.css`）：
 *
 *   div.dsh-think                        data-variant="think" data-state data-expanded data-preview
 *     [span.dsh-a11y-hidden]             ← running 时给读屏软件的"正在思考"
 *     div.dsh-disclosure                 (DisclosureRow 的 root)
 *       div.dsh-disclosure-row.dsh-think-row   data-disclosure-row
 *         span/button.dsh-disclosure-leading.dsh-think-leading
 *         span.dsh-shimmer                (TextShimmer，active=running)
 *           span.dsh-shimmer-content
 *             span.dsh-disclosure-title.dsh-think-title   「思考」
 *             span.dsh-think-summary      ← collapsedContent
 *               TextShimmer(概要)
 *       div.dsh-disclosure-body
 *         div.dsh-think-body             ← 展开体（Markdown 或纯文本）
 *
 * @param {object}   options
 * @param {string}   options.text       完整或流式中的思考文字
 * @param {boolean}  [options.running]  是否是流式中的那一段
 * @param {object}   [options.disclosure] 由 `createDisclosure()` 传进来的展开状态
 * @param {object}   [options.css]      各类名（对应 DSH 的各 className prop）
 * @returns {{root, setText, setRunning, setExpanded, refresh}}
 */
function reasoningRow({
  text = '',
  running = false,
  disclosure = createDisclosure(),
  /** 展开体渲染器：默认纯文本；给了就交给它（DSH 用 `MarkdownText variant="compact"`）。 */
  bodyRenderer = null,
  labels = {}
} = {}) {
  const primitives = (typeof window !== 'undefined' && window.dshPrimitives) || require('./dsh-primitives.js');
  const { el, textShimmer, disclosureRow, thinkIcon } = primitives;

  let currentText = text;
  let currentRunning = Boolean(running);

  /** 概要：一个 `TextShimmer`，内容随状态更新（结构照 DSH 的 `collapsedContent`）。 */
  const summaryShimmerHost = el('span', 'dsh-think-summary');
  /** DSH 的 `.separator`：标题与概要之间那个 2×2 圆点。 */
  const separator = el('span', 'dsh-think-separator');
  separator.dataset.shimmerDecoration = '';
  separator.setAttribute('aria-hidden', 'true');
  /** `collapsedContent` 是「圆点 + 概要」两块（DSH 的 Fragment）。 */
  const collapsed = document.createDocumentFragment();
  collapsed.append(separator, summaryShimmerHost);

  const a11y = el('span', 'dsh-a11y-hidden', labels.running || '正在思考');

  /** 展开体：内容交给 `renderBody`（默认纯文本）。**始终保留**（移植约定 ①）。 */
  const body = el('div', 'dsh-think-body');

  const row = disclosureRow({
    icon: thinkIcon(),
    title: labels.title || '思考',
    expandable: true,
    expandOnRowClick: true,
    running: currentRunning,
    open: disclosure.expanded(),
    onToggle: () => { disclosure.toggle(); sync(); },
    collapsedContent: collapsed,
    children: body,
    className: { root: '', row: 'dsh-think-row', leading: 'dsh-think-leading', title: 'dsh-think-title' }
  });

  const root = el('div', 'dsh-think');
  root.dataset.variant = 'think';
  root.append(a11y, row.root);

  /** 把概要画出来：DSH 是 `summary !== '' && (running || policy.settledReasoningPreview)`。 */
  function renderSummary() {
    const outline = reasoningOutline(currentText, currentRunning);
    summaryShimmerHost.replaceChildren();
    if (outline === '') return;
    summaryShimmerHost.appendChild(textShimmer({ content: outline, active: currentRunning }));
  }

  /** 展开体：DSH 用 `MarkdownText`（`variant="compact"`）；这里可注入渲染器。 */
  function renderBody() {
    body.replaceChildren();
    if (!currentText) return;
    if (typeof bodyRenderer === 'function') body.appendChild(bodyRenderer(currentText, currentRunning));
    else body.appendChild(el('div', 'dsh-think-text', currentText));
  }

  /** 把状态落到 DOM 上 —— **一处落盘**，与 DSH 的 render 一致。 */
  function sync() {
    const open = disclosure.expanded();
    row.setOpen(open);
    row.setRunning(currentRunning);
    root.dataset.state = currentRunning ? 'running' : 'ok';
    if (open) root.dataset.expanded = '';
    else delete root.dataset.expanded;
    /** `data-preview`：有概要才显示分隔点与概要（DSH 的 `root:not([data-preview])` 规则）。 */
    if (reasoningOutline(currentText, currentRunning)) root.dataset.preview = '';
    else delete root.dataset.preview;
    a11y.hidden = !currentRunning;
    renderSummary();
    if (disclosure.expanded()) renderBody();
  }

  sync();

  return {
    root,
    /** 更新文字（流式时每帧调）。 */
    setText: value => { if (currentText !== value) { currentText = value; sync(); } },
    setRunning: value => { const next = Boolean(value); if (currentRunning !== next) { currentRunning = next; sync(); } },
    setExpanded: value => { disclosure.setExpanded(value); sync(); },
    expanded: () => disclosure.expanded(),
    refresh: sync
  };
}

/**
 * 工具展开体的文本：对象就按 JSON 缩进，字符串直接用。
 *
 * DSH 对应的是 `formatToolBody(variant, bodyRaw)` —— `bodyRaw` 本来就是
 * 原始参数 JSON 字符串。本项目的事件里 `arguments` 已经是对象，所以这里补一步序列化。
 */
function toolBodyText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

/**
 * `ToolRow` —— 一次工具调用的折叠行。
 *
 * DOM（照 `ToolRow.tsx` + `ToolRow.module.css`）：
 *
 *   div.dsh-tool-root                     data-variant data-tool data-state
 *     span.dsh-tool-visually-hidden       ← 状态读屏文案
 *     div.dsh-disclosure                  (DisclosureRow 的 root)
 *       div.dsh-disclosure-row.dsh-tool-row   data-disclosure-row
 *         span/button.dsh-disclosure-leading.dsh-tool-leading
 *         span.dsh-shimmer
 *           span.dsh-shimmer-content
 *             span.dsh-disclosure-title.dsh-tool-title
 *             span.dsh-tool-sep             ← 2×2 圆点
 *             span.dsh-tool-summary         ← 概要（错误/中断时换色）
 *             span.dsh-tool-summary-suffix  ← 可选尾巴（计数等）
 *       div.dsh-disclosure-body
 *         div.dsh-tool-body-wrap
 *           div.dsh-tool-io-card           ← 通用「输入 / 输出」
 *             div.dsh-tool-io-section
 *               span.dsh-tool-io-label  输入
 *               span.dsh-tool-io-text
 *             span.dsh-tool-io-divider
 *             div.dsh-tool-io-section
 *               span.dsh-tool-io-label  输出
 *               span.dsh-tool-io-text
 *
 * **与思考行的唯一结构差异**：`keepContentWhenOpen` —— 展开后概要仍然显示
 * （DSH 原文 `keepContentWhenOpen` prop）。工具行展开后要能同时看到
 * "调了什么"和"返回了什么"，思考行则不需要。
 *
 * @param {object}   options
 * @param {string}   options.toolName    注册名（进 `data-tool`，也是排查依据）
 * @param {string}   [options.variant]   行为分类（DSH 的 `ToolRowVariant`）
 * @param {string}   options.title       显示名
 * @param {Node}     options.icon        业务图标
 * @param {string}   [options.summary]   概要（参数摘要 / 结果摘要）
 * @param {string}   [options.suffix]    概要尾巴
 * @param {string}   [options.state]     `preparing` / `running` / `ok` / `error` / `stopped`
 * @param {string}   [options.statusText] 读屏用的状态词
 * @param {object}   [options.input]     展开体「输入」（对象或字符串）
 * @param {object}   [options.output]    展开体「输出」
 * @param {Node}     [options.body]      自定义展开体（给了就不用 IN/OUT 卡片）
 * @param {object}   [options.disclosure]
 * @param {object}   [options.labels]
 * @returns {{root, row, setSummary, setState, setBody, setExpanded}}
 */
function toolRow({
  toolName = '',
  variant = 'others',
  title = '',
  icon = null,
  summary = '',
  suffix = '',
  state = 'ok',
  statusText = '',
  input = null,
  output = null,
  body = null,
  disclosure = createDisclosure(),
  labels = {}
} = {}) {
  const primitives = (typeof window !== 'undefined' && window.dshPrimitives) || require('./dsh-primitives.js');
  const { el, textShimmer, disclosureRow } = primitives;

  let currentState = state;
  let currentSummary = String(summary || '');
  let currentSuffix = String(suffix || '');
  let customBody = body;

  const a11y = el('span', 'dsh-tool-visually-hidden');

  /** 概要区：圆点 + 概要文字（+ 可选尾巴）。收起与展开都要显示。 */
  const sep = el('span', 'dsh-tool-sep');
  const summaryHost = el('span', 'dsh-tool-summary');
  const suffixHost = el('span', 'dsh-tool-summary-suffix');
  const collapsed = el('span', 'dsh-tool-summary-wrap');
  collapsed.append(sep, summaryHost, suffixHost);

  const bodyWrap = el('div', 'dsh-tool-body-wrap');

  const row = disclosureRow({
    icon,
    title,
    expandable: true,
    expandOnRowClick: true,
    /** ⚠️ 与思考行的关键差异：展开后概要**仍然显示**。 */
    keepContentWhenOpen: true,
    open: disclosure.expanded(),
    onToggle: () => {
      if (currentState === 'preparing' || (customBody === null && input === null && output === null)) return;
      disclosure.toggle(); sync();
    },
    collapsedContent: collapsed,
    children: bodyWrap,
    className: { row: 'dsh-tool-row', leading: 'dsh-tool-leading', title: 'dsh-tool-title' }
  });

  const root = el('div', 'dsh-tool-root');
  root.dataset.variant = variant;
  root.dataset.tool = toolName;
  root.dataset.state = currentState;
  root.append(a11y, row.root);

  /** 通用「输入 / 输出」卡片（DSH 的 `ioCard`）。 */
  function renderIoCard() {
    const card = el('div', 'dsh-tool-io-card');
    const inText = toolBodyText(input);
    const outText = toolBodyText(output);
    if (inText !== '') {
      const section = el('div', 'dsh-tool-io-section');
      section.append(el('span', 'dsh-tool-io-label', labels.input || '输入'), el('span', 'dsh-tool-io-text', inText));
      card.appendChild(section);
    }
    if (inText !== '' && outText !== '') card.appendChild(el('span', 'dsh-tool-io-divider'));
    if (outText !== '') {
      const section = el('div', 'dsh-tool-io-section');
      const text = el('span', 'dsh-tool-io-text', outText);
      if (currentState === 'error') text.dataset.error = '';
      section.append(el('span', 'dsh-tool-io-label', labels.output || '输出'), text);
      card.appendChild(section);
    }
    return card.childElementCount ? card : null;
  }

  /** 展开体：自定义优先，否则 IN/OUT 卡片；两者都没有就不给展开。 */
  function renderBody() {
    bodyWrap.replaceChildren();
    if (customBody) { bodyWrap.appendChild(customBody); return; }
    const card = renderIoCard();
    if (card) bodyWrap.appendChild(card);
  }

  /** 一处落盘。 */
  function sync() {
    row.setOpen(disclosure.expanded());
    row.setRunning(currentState === 'running' || currentState === 'preparing');
    root.dataset.state = currentState;

    /** 概要用 `TextShimmer` 包着（DSH 同款）；文字为空时整块（含圆点）不显示。 */
    const isRunning = currentState === 'running' || currentState === 'preparing';
    summaryHost.replaceChildren();
    if (currentSummary !== '') {
      summaryHost.appendChild(textShimmer({ content: currentSummary, active: isRunning }));
      /** 失败 / 中断时概要换色（DSH 的 `errorSummary` / `stoppedSummary`）。 */
      summaryHost.classList.toggle('dsh-tool-summary-error', currentState === 'error');
      summaryHost.classList.toggle('dsh-tool-summary-stopped', currentState === 'stopped');
      collapsed.hidden = false;
    } else {
      summaryHost.classList.remove('dsh-tool-summary-error', 'dsh-tool-summary-stopped');
      /** 没有概要就整块不显示 —— 只留标题的行不该拖一个孤零零的圆点。 */
      collapsed.hidden = true;
    }
    suffixHost.textContent = currentSuffix;

    /**
     * 可展开性（DSH：`state !== 'preparing' && (inputRaw || outputText || card)`）。
     * ⚠️ DSH 用 `open = expanded && expandable` —— 不可展开时即使内部状态是"展开"
     * 也不显示内容。这里同理：不可展开就强制收起。
     */
    const expandable = currentState !== 'preparing' && (customBody !== null || input !== null || output !== null);
    row.row.dataset.expandable = expandable ? '' : undefined;
    if (!expandable) delete row.row.dataset.expandable;
    else row.row.dataset.expandable = '';
    if (!expandable && disclosure.expanded()) { disclosure.setExpanded(false); row.setOpen(false); }
    row.row.tabIndex = expandable ? 0 : -1;
    if (expandable) row.row.setAttribute('role', 'button');
    else { row.row.removeAttribute('role'); row.row.removeAttribute('aria-expanded'); }

    a11y.textContent = statusText || '';
    if (disclosure.expanded()) renderBody();
  }

  sync();

  return {
    root,
    /** 更新概要（流式时每帧可能变）。 */
    setSummary: value => { const next = String(value ?? ''); if (currentSummary !== next) { currentSummary = next; sync(); } },
    setState: value => { const next = String(value || 'ok'); if (currentState !== next) { currentState = next; sync(); } },
    /** 结果到达后补上展开体（首次建行时 output 还是 null）。 */
    setResult: ({ input: nextInput, output: nextOutput } = {}) => {
      let changed = false;
      if (nextInput !== undefined && input === null) { input = nextInput; changed = true; }
      if (nextOutput !== undefined && output === null) { output = nextOutput; changed = true; }
      if (changed) sync();
    },
    setBody: node => { if (customBody !== node) { customBody = node; sync(); } },
    setExpanded: value => { disclosure.setExpanded(value); sync(); },
    expanded: () => disclosure.expanded(),
    refresh: sync
  };
}

const dshRows = Object.freeze({
  createDisclosure, reasoningRow, toolRow, reasoningOutline, firstLine, latestCompletedParagraphFirstLine, toolBodyText
});
if (typeof window !== 'undefined') window.dshRows = dshRows;
if (typeof module !== 'undefined' && module.exports) module.exports = dshRows;
