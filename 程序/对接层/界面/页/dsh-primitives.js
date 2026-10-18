'use strict';
/**
 * DSH 原子组件的**原生 JS 实现** —— 逐行对照 `@deepseek-ai/dsh-client-ui-primitives`。
 *
 * 源码：`github.com/deepseek-ai/deepseek-harness`（MIT）
 *       `packages/client/ui-primitives/src/`
 *
 * CSS 在 `dsh-ui.css` 里（同一来源，类名前缀加 `dsh-`）。
 * 这里只负责**建 DOM**：结构与 `data-*` 属性与 DSH 一一对应。
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ **两条移植约定**（每个组件都适用）
 *
 * **① 不卸载，只切 CSS 显示。**
 *    DSH 的展开体是 `{open && children}` —— React 靠"保留已建好的节点"来避免
 *    重绘与状态丢失（`ReasoningRow` 的注释明确写了
 *    "Mode changes toggle CSS display without unmounting"）。原生 JS 里对应做法是
 *    **始终保留 children**，用 `.dsh-disclosure-body[hidden]` 控制显示。
 *    所以 CSS 要配一条 `[hidden]{display:none}`（下面 `dsh-ui.css` 里已有）。
 *
 * **② React context 用参数替代。**
 *    `TextShimmer` 用 `DecorativeCopy` context 让嵌套实例共享"这一份是装饰副本"。
 *    原生 JS 里没有 context，改成显式参数 `decorative` —— 语义完全一致，
 *    嵌套调用处传 `true`。
 *
 * 来源映射：
 *   DisclosureRow  ← DisclosureRow.tsx + DisclosureRow.module.css
 *   TextShimmer    ← TextShimmer.tsx   + TextShimmer.module.css
 */

/** 建元素的小工具（对应 JSX 的 `<span className=...>`）。 */
function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * `TextShimmer` —— 文字活动动画。
 *
 * 做法（照抄）：真内容只渲染一次，**装饰副本**单独一层，用一层移动的 mask
 * 扫过去。两份内容用相反的 transform 保持字形对齐。
 *
 * ⚠️ **`layout: 'flex'` 的用处**（这是 `DisclosureRow` 的排版关键）：
 *
 * DSH 里 `DisclosureRow` 的内容是这样套的 ——
 *
 *     <TextShimmer>
 *       <TextShimmer className={css.title}>{title}</TextShimmer>
 *       {collapsedContent}          ← 里面的 .separator / .summary **直接成为
 *     </TextShimmer>                   TextShimmer content 的 flex 子项**
 *
 * 而 `TextShimmer.module.css` 的 `.content { display: flex }` —— 所以
 * 标题（`flex: none`）与概要（`flex: 1 1 auto`）是**同一行里的 flex 兄弟**，
 * 概要才能被挤窄、才会出现省略号。
 *
 * 原生版必须显式要求这件事：把 `layout: 'flex'` 传下去，content 层才带 flex。
 * 不传就是默认的 `inline-grid`（独立文字用）。
 *
 * @param {object}  options
 * @param {Node|string} options.content         真内容（字符串或节点）
 * @param {boolean} [options.active]            是否播放（由所属行的运行态决定）
 * @param {string}  [options.className]         外层附加类
 * @param {string}  [options.contentClassName]  内容层附加类
 * @param {'flex'|'inline'} [options.layout]    内容层排版：`flex` = 子项共享一行
 * @param {boolean} [options.decorative]        本实例是否是装饰副本（对应 DSH 的 context）
 * @returns {HTMLElement}
 */
function textShimmer({ content, active = false, className = '', contentClassName = '', layout = 'inline', decorative = false } = {}) {
  const contentClass = `dsh-shimmer-content${layout === 'flex' ? ' dsh-shimmer-content-flex' : ''}${contentClassName ? ` ${contentClassName}` : ''}`;
  /** 装饰副本里只放一层文字，不再嵌套（`TextContent` 的分支）。 */
  if (decorative) {
    const text = el('span', `dsh-shimmer-text${className ? ` ${className}` : ''}`);
    /** 字符串交给 `::after` 渲染，避免读屏软件读两遍（DSH 用 `data-shimmer-text`）。 */
    if (typeof content === 'string') text.dataset.shimmerText = content;
    else if (content) text.appendChild(content);
    return text;
  }

  const root = el('span', `dsh-shimmer${className ? ` ${className}` : ''}`);
  if (active) root.dataset.shimmer = '1';

  const contentWrap = el('span', contentClass);
  contentWrap.appendChild(typeof content === 'string' ? el('span', 'dsh-shimmer-text', content) : content);
  root.appendChild(contentWrap);

  if (active) {
    const decoration = el('span', 'dsh-shimmer-decoration');
    decoration.setAttribute('aria-hidden', 'true');
    /** `inert` 让装饰层不可聚焦、不可选中（React 里传空串，布尔会被丢掉）。 */
    decoration.setAttribute('inert', '');
    const sweep = el('span', 'dsh-shimmer-sweep');
    const inner = el('span', `${contentClass} dsh-shimmer-highlight`);
    inner.appendChild(textShimmer({ content, decorative: true, contentClassName }));
    sweep.appendChild(inner);
    decoration.appendChild(sweep);
    root.appendChild(decoration);
  }
  return root;
}

/**
 * `DisclosureRow` —— 共享的 24px 过程行。
 *
 * DSH 原文：*"Shared 24px process row: tertiary text and icons, secondary on hover."*
 *
 * 思考行与工具行**都是它的实例** —— 这是前几轮我一直没对上的地方：
 * 我以为它们是两种结构，于是自己发明了 `.agent-thought`，导致到处对不上。
 *
 * @param {object}   options
 * @param {Node}     options.icon             前导图标（收起时显示；悬停换成箭头）
 * @param {string}   options.title            标题（如「思考」「工具调用」）
 * @param {boolean}  options.open             是否展开
 * @param {boolean}  options.expandable       是否可展开
 * @param {Function} options.onToggle         切换回调
 * @param {boolean}  [options.running]        整行跑动动画（`TextShimmer` 的 active）
 * @param {boolean}  [options.expandOnRowClick] 整行都是展开热区
 * @param {boolean}  [options.previewChevron] 收起时悬停把图标换成箭头（默认 = expandable）
 * @param {boolean}  [options.keepContentWhenOpen] 展开后仍保留 `collapsedContent`
 * @param {Node}     [options.collapsedContent] 收起时显示的概要（如「· 参数摘要」）
 * @param {Node}     [options.children]       展开体
 * @param {object}   [options.className]      各类名（对应 DSH 的各个 className prop）
 * @returns {{root: HTMLElement, row: HTMLElement, setOpen: Function, setRunning: Function}}
 */
function disclosureRow({
  icon,
  title,
  open = false,
  expandable = false,
  onToggle = () => {},
  running = false,
  expandOnRowClick = false,
  previewChevron = expandable,
  keepContentWhenOpen = false,
  collapsedContent = null,
  children = null,
  className = {}
} = {}) {
  const cls = {
    root: '', row: '', leading: '', chevron: '', title: '', content: '', contentLayout: '',
    ...className
  };
  const join = value => (value ? ` ${value}` : '');

  /** 收起时的前导：图标 + 一个绝对定位的箭头（悬停时互换透明度）。 */
  const collapsedLeading = () => {
    if (!previewChevron) return icon;
    const wrap = el('span');
    const idle = el('span', `dsh-disclosure-icon${join(cls.leading)}`);
    idle.appendChild(icon);
    const chevron = el('span', `dsh-disclosure-chevron${join(cls.chevron)}`);
    chevron.appendChild(chevronIcon('down'));
    wrap.append(idle, chevron);
    return wrap;
  };

  const root = el('div', `dsh-disclosure${join(cls.root)}`);
  const row = el('div', `dsh-disclosure-row${join(cls.row)}`);
  row.dataset.disclosureRow = '';
  const rowExpands = expandable && expandOnRowClick;
  if (rowExpands) {
    row.dataset.expandable = '';
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.addEventListener('click', () => onToggle());
    row.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onToggle();
    });
  }

  /**
   * 前导元素：可展开但**不是整行热区**时用 `<button>`（键盘能到）；
   * 否则是普通 `<span>`。与 DSH 的 `expandable && !rowExpands` 一致。
   */
  const leadingTag = expandable && !rowExpands ? 'button' : 'span';
  const leading = el(leadingTag, `dsh-disclosure-leading${join(cls.leading)}`);
  if (leadingTag === 'button') {
    leading.type = 'button';
    leading.setAttribute('aria-label', title);
    leading.addEventListener('click', event => { event.stopPropagation(); onToggle(); });
  }

  /**
   * 内容层：**标题与概要必须是同一行的 flex 兄弟**（见 `textShimmer` 的说明）。
   *
   * ⚠️ 这里不能自己套 `TextShimmer` —— DSH 的套法是
   * `TextShimmer(active=running) > [TextShimmer(title), collapsedContent]`：
   * **外层负责运行态高光，内层负责标题排版**。两层的 `content` 都是 `display:flex`，
   * 所以标题与概要在同一行里按 flex 分配宽度（标题 `flex:none`、概要 `flex:1 1 auto`），
   * 概要才会被挤窄并出现省略号。
   *
   * 调用方要的是"结构"而不是"两个 shimmer 包在一起"，所以这里直接暴露
   * 这个 flex 内容层，由调用方决定往里放什么。
   */
  const contentWrap = el('span', `dsh-shimmer dsh-shimmer-content dsh-shimmer-content-flex${cls.content ? ` ${cls.content}` : ''}`);
  contentWrap.appendChild(el('span', `dsh-disclosure-title${join(cls.title)}`, title));

  row.append(leading, contentWrap);
  root.appendChild(row);

  /** 收起时显示的概要：由调用方给（DSH 的 `collapsedContent`）。 */
  const collapsedHost = el('span', 'dsh-disclosure-collapsed');
  if (collapsedContent) collapsedHost.appendChild(collapsedContent);
  contentWrap.appendChild(collapsedHost);

  /** 展开体：**始终保留**，只切显示 —— 见文件头的移植约定 ①。 */
  const body = el('div', 'dsh-disclosure-body');
  if (children) body.appendChild(children);
  root.appendChild(body);

  /** 内部状态：只记录"当前是否展开"，DOM 由 `render()` 一处落盘。 */
  let isOpen = Boolean(open);
  const render = () => {
    root.dataset.open = isOpen ? '' : undefined;
    if (!isOpen) delete root.dataset.open;
    else root.dataset.open = '';
    body.hidden = !isOpen;
    /** 前导：展开时换成向上的箭头（DSH：`open ? <ChevronUp/> : collapsedLeading`）。 */
    leading.replaceChildren();
    if (isOpen) leading.appendChild(chevronIcon('up'));
    else leading.appendChild(collapsedLeading());
    if (leadingTag === 'button') leading.setAttribute('aria-expanded', String(isOpen));
    if (rowExpands) row.setAttribute('aria-expanded', String(isOpen));
    /** 概要在展开后按 `keepContentWhenOpen` 决定留不留（默认隐藏）。 */
    if (collapsedHost) collapsedHost.hidden = isOpen && !keepContentWhenOpen;
  };

  /** 运行态：给整行套 `TextShimmer` 的高光。 */
  const setRunning = value => {
    const on = Boolean(value);
    row.querySelectorAll('.dsh-shimmer').forEach(node => {
      if (on) node.dataset.shimmer = '1';
      else delete node.dataset.shimmer;
    });
  };

  const setOpen = value => { isOpen = Boolean(value); render(); };

  render();
  if (running) setRunning(true);

  return { root, row, leading, body, contentWrap, collapsedHost, setOpen, setRunning, isOpen: () => isOpen };
}

/** DSH 的箭头图标（`IconChevronDownOutlineRegular` / `Up`）。 */
function chevronIcon(direction) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', direction === 'up' ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6');
  svg.appendChild(path);
  return svg;
}

/** DSH 的思考图标（`IconThinkOutlineRegular`，14px）。 */
function thinkIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  /** 一朵云的轮廓 —— 与 DSH 的 think 图标同形（圆角思考气泡）。 */
  path.setAttribute('d', 'M7 16h9a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 6.1 9.2 3.9 3.9 0 0 0 7 16Z');
  svg.appendChild(path);
  return svg;
}

/** 导出到全局（本项目无构建步骤，`app.js` 之外直接用全局）。 */
const dshPrimitives = Object.freeze({ el, textShimmer, disclosureRow, chevronIcon, thinkIcon });
if (typeof window !== 'undefined') window.dshPrimitives = dshPrimitives;
if (typeof module !== 'undefined' && module.exports) module.exports = dshPrimitives;
