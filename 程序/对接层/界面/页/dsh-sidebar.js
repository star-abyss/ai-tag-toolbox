'use strict';
/**
 * ⚠️ **整个文件包在 IIFE 里** —— 本项目是"全局脚本、无构建"，而 `index.html` 现在
 * 同时加载 `dsh-sidebar.js` / `dsh-chat.js` / `dsh-composer.js` / `view-bridge.js` /
 * `dsh-mount.js`。经典脚本**共用同一个全局词法作用域**，所以两份顶层 `const` 会直接
 * 让后加载的那份整个文件报 `SyntaxError`（`dsh-chat.js` 与 `dsh-composer.js`
 * 都有 `const SVG_NS`，第二份整份加载失败、`window.dshChat` 永远挂不上）。
 *
 * 本文件顶层另有 `el` / `icon` / `stateDot` / `ICONS` / `DEFAULT_LABELS` 与其它
 * `dsh-*.js` 撞名 —— 函数声明虽然不报错，但会**按加载顺序互相覆盖**，比报错更难查。
 * 包一层 IIFE 后每个文件各自一份作用域，`window.dshXxx` 与 `module.exports` 照旧。
 * 这与项目既有的全局脚本写法一致（`app-view.js` / `app.js` / `tool-presentation.js` /
 * `view-loader.js` 都是 `(function install…(global) { … })(window)`）。
 */
(function installDshSidebar() {
/**
 * DSH 左侧栏的**原生 JS 实现** —— 逐行对照 `packages/client/` 下的 React 源码。
 *
 * 源码：`github.com/deepseek-ai/deepseek-harness`（MIT）
 *
 *   SidebarRoot       ← ui-sidebar/src/client/SidebarRoot.tsx
 *   WorkspaceBrowser  ← ui-workspace/src/client/rows/WorkspaceBrowser.tsx
 *   ProjectRowItem    ← ui-workspace/src/client/rows/Rows.tsx  (219-329)
 *   SearchResultItem  ← ui-workspace/src/client/rows/Rows.tsx  (471-522)
 *   SessionNodeItem   ← ui-workspace/src/client/rows/Rows.tsx  (544-703)
 *   AnimatedRows      ← ui-workspace/src/client/rows/AnimatedRows.tsx
 *   deriveGroups 等   ← ui-workspace/src/client/tree.ts（纯派生层）
 *   AppFrame 左列/栅格 ← ui-layout/src/client/AppFrame.tsx
 *
 * CSS 在 `dsh-layout.css`（同一来源，类名前缀加 `dsh-`）。
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ **三条移植约定**（每处都在代码里标了出处）
 *
 * **① 不卸载，只切显示。**
 *    React 用 `{cond && …}` 或 `hidden` 属性藏东西；这里**节点一律保留**，
 *    用 `node.hidden` / `data-*` 切。原因：`dsh-layout.css` 里有大量
 *    `:not([hidden])` 兄弟选择器（`.dsh-browser-flat-list > * + *`、
 *    `.dsh-browser-group-section > * + *`）与 `:has()` 规则
 *    （`.dsh-sidebar-new-session-label-mask:has(+ …-shortcut)`）——
 *    删节点会让间距/遮罩算错。
 *    链式 slot 的 fallback 用 `display: contents / none` 切换（原版如此，
 *    `ui-renderer/src/client/scoped-slots.tsx:1258`）。
 *
 * **② 选中 / 悬停靠 class，不靠 `data-*`。**
 *    `.dsh-session-row.dsh-selected` / `.dsh-menu-open` / `.dsh-archived`
 *    是 class；`data-*` 只做行为钩子（`data-row-key`、`data-scrolled`、
 *    `data-clipped`、`data-state`、`data-row-gap`）。
 *
 * **③ `useMemo` 的引用相等是语义，不是优化。**
 *    `WorkspaceBrowser.tsx:920-927` 的 `orderState` → `rowState` 注释写明
 *    "每次新建对象会让整个分组树重算"。这里的 `deriveGroups` 带**输入缓存**：
 *    内容没真变就返回**上一次的同一个数组引用**，见 {@link deriveGroups}。
 *
 * ─────────────────────────────────────────────────────────────
 * 数据形状（最简版，**不读目标项目任何真实数据源**）：
 *
 *   {
 *     sections: [
 *       { id, title, expanded: true,
 *         items: [ { id, title, subtitle, selected, updatedAt,
 *                    archived, pinned, blank, state: 'idle'|'ongoing'|'done'|'warning'|'error' } ] }
 *     ]
 *   }
 *
 * 每个组件返回 `{ root, update(data) }`；`update` 只改变化的部分（不重建节点）。
 */

/* ══════════════════════════════════════════════════════════════════════════
 * 0. 小工具
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 建元素的小工具（对应 JSX 的 `<span className=…>`）。
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** class 名常量（与 `dsh-layout.css` 一一对应，不在这里拼字符串散落各处）。 */
const C = Object.freeze({
  // ── SidebarRoot.module.css
  sidebarRoot: 'dsh-sidebar-root',
  sidebarCollapsed: 'dsh-sidebar-collapsed',
  sidebarRailIn: 'dsh-sidebar-rail-in',
  sidebarFading: 'dsh-sidebar-fading',
  sidebarQuietBars: 'dsh-sidebar-quiet-bars',
  sidebarWide: 'dsh-sidebar-wide',
  topStrip: 'dsh-sidebar-top-strip',
  logoRow: 'dsh-sidebar-logo-row',
  brand: 'dsh-sidebar-brand',
  brandIdentity: 'dsh-sidebar-brand-identity',
  brandMark: 'dsh-sidebar-brand-mark',
  brandName: 'dsh-sidebar-brand-name',
  fallbackBrandName: 'dsh-sidebar-fallback-brand-name',
  localBuildBrand: 'dsh-sidebar-local-build-brand',
  localBuildTitle: 'dsh-sidebar-local-build-title',
  buildVersion: 'dsh-sidebar-build-version',
  sidebarIconButton: 'dsh-sidebar-icon-button',
  toggle: 'dsh-sidebar-toggle',
  panelIcon: 'dsh-sidebar-panel-icon',
  railMark: 'dsh-sidebar-rail-mark',
  newSession: 'dsh-sidebar-new-session',
  newSessionLabelMask: 'dsh-sidebar-new-session-label-mask',
  newSessionContent: 'dsh-sidebar-new-session-content',
  newSessionLabel: 'dsh-sidebar-new-session-label',
  newSessionShortcut: 'dsh-sidebar-new-session-shortcut',
  panelList: 'dsh-sidebar-panel-list',
  panelRow: 'dsh-sidebar-panel-row',
  panelActive: 'dsh-sidebar-panel-active',
  panelGlyph: 'dsh-sidebar-panel-glyph',
  panelTitle: 'dsh-sidebar-panel-title',
  regionArea: 'dsh-sidebar-region-area',
  footArea: 'dsh-sidebar-foot-area',
  footerActions: 'dsh-sidebar-footer-actions',
  settingsArea: 'dsh-sidebar-settings-area',
  // ── WorkspaceBrowser.module.css
  browserRoot: 'dsh-browser-root',
  browserRail: 'dsh-browser-rail',
  browserIconButton: 'dsh-browser-icon-button',
  browserViewOptionsMenu: 'dsh-browser-view-options-menu',
  sectionHeader: 'dsh-browser-section-header',
  sectionLabel: 'dsh-browser-section-label',
  sectionLabelHidden: 'dsh-browser-section-label-hidden',
  searchSlot: 'dsh-browser-search-slot',
  searchSlotExpanded: 'dsh-browser-search-slot-expanded',
  headerActions: 'dsh-browser-header-actions',
  headerActionsHidden: 'dsh-browser-header-actions-hidden',
  browserSearch: 'dsh-browser-search',
  searchExpanded: 'dsh-browser-search-expanded',
  searchButton: 'dsh-browser-search-button',
  searchInput: 'dsh-browser-search-input',
  clearButton: 'dsh-browser-clear-button',
  listArea: 'dsh-browser-list-area',
  treeBody: 'dsh-browser-tree-body',
  browserWide: 'dsh-browser-wide',
  fade: 'dsh-browser-fade',
  list: 'dsh-browser-list',
  flatList: 'dsh-browser-flat-list',
  searchTree: 'dsh-browser-search-tree',
  groupSection: 'dsh-browser-group-section',
  workspaceDropBefore: 'dsh-browser-workspace-drop-before',
  workspaceDropAfter: 'dsh-browser-workspace-drop-after',
  listTopDropIndicator: 'dsh-browser-list-top-drop-indicator',
  listTopDropActive: 'dsh-browser-list-top-drop-active',
  sessionOverflowButton: 'dsh-browser-session-overflow-button',
  searchStatus: 'dsh-browser-search-status',
  skeletonRow: 'dsh-browser-skeleton-row',
  skeletonDot: 'dsh-browser-skeleton-dot',
  skeletonBars: 'dsh-browser-skeleton-bars',
  skeletonBar: 'dsh-browser-skeleton-bar',
  skeletonBarWide: 'dsh-browser-skeleton-bar-wide',
  browserEmpty: 'dsh-browser-empty',
  emptyState: 'dsh-browser-empty-state',
  emptyAction: 'dsh-browser-empty-action',
  // ── Rows.module.css
  projectRow: 'dsh-project-row',
  sessionRow: 'dsh-session-row',
  searchResultRow: 'dsh-search-result-row',
  searchResultHeading: 'dsh-search-result-heading',
  searchResultTitle: 'dsh-search-result-title',
  searchResultMeta: 'dsh-search-result-meta',
  searchResultWorkspace: 'dsh-search-result-workspace',
  searchResultSnippet: 'dsh-search-result-snippet',
  selected: 'dsh-selected',
  archived: 'dsh-archived',
  menuOpen: 'dsh-menu-open',
  dropBefore: 'dsh-drop-before',
  dropAfter: 'dsh-drop-after',
  slot: 'dsh-slot',
  folder: 'dsh-folder',
  folderActive: 'dsh-folder-active',
  chevron: 'dsh-chevron',
  arrow: 'dsh-arrow',
  arrowOpen: 'dsh-arrow-open',
  projectText: 'dsh-project-text',
  title: 'dsh-title',
  time: 'dsh-time',
  pinIndicator: 'dsh-pin-indicator',
  rowActions: 'dsh-row-actions',
  rowIconButton: 'dsh-row-icon-button',
  hoverContent: 'dsh-hover-content',
  hoverTitle: 'dsh-hover-title',
  hoverPath: 'dsh-hover-path',
  hoverTime: 'dsh-hover-time',
  hoverStatus: 'dsh-hover-status',
  hoverArchived: 'dsh-hover-archived',
  visuallyHidden: 'dsh-visually-hidden',
  // ── AnimatedRows.module.css
  exits: 'dsh-rows-exits',
  // ── StateDot.module.css
  stateDot: 'dsh-state-dot',
  stateSpinner: 'dsh-state-spinner',
  stateSpinnerMotion: 'dsh-state-spinner-motion',
  stateSpinnerTrack: 'dsh-state-spinner-track',
  stateSpinnerArc: 'dsh-state-spinner-arc',
});

/** `States` 形状 → 行为钩子值（`AnimatedRows` 的 `ready` 用）。 */
const DEFAULTS = Object.freeze({
  archiveOutline: 'IconArchiveOutlineRegular',
  queueOutline: 'IconQueueOutlineRegular',
});

/**
 * `Mark` —— 锚点占位（对应渲染器的 `SlotOutlet`，`scoped-slots.tsx:1088`）。
 * `style="display:contents"` 是**契约**：包裹层永远不进布局。
 * @param {string} slotKey
 * @returns {HTMLElement}
 */
function slotMark(slotKey) {
  const node = el('div');
  node.dataset.slot = slotKey;
  node.style.display = 'contents';
  return node;
}

/**
 * `ChainFallback` —— 链式 slot 的 **fallback 座**。
 *
 * 渲染器原文（`ui-renderer/src/client/scoped-slots.tsx:1258-1272`）：
 * ```jsx
 * // 注册项当选时，fallback 的**显示**交给这个包裹层，节点本身留在原位
 * <div data-chain-overlay-fallback={slotKey}
 *      style={{ display: elected === null ? 'contents' : 'none' }}>
 *   {fallback}
 * </div>
 * ```
 * 所以：
 *   · `display: contents` 的座**就是** `data-chain-overlay-fallback` 元素本身
 *     （不是它的父级）—— 否则 `.brandName > span`、`.brandMark > span`
 *     这类后代选择器挂不到 fallback 上；
 *   · 约定 ①：takeover 当选时**不卸载**，只 `display:none`。
 * @param {string} slotKey
 * @returns {{root: HTMLElement, setElected(elected: boolean): void}}
 */
function chainFallback(slotKey) {
  const root = el('div');
  root.dataset.chainOverlayFallback = slotKey;
  const setElected = elected => { root.style.display = elected ? 'none' : 'contents'; };
  setElected(false);
  return { root, setElected };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. 图标 —— 逐字取自 `ui-primitives/src/icons/index.tsx`
 *
 *    这些 `<svg>` 字符串是用 `work/extract-dsh-icons.cjs` 从源码里
 *    **机械提取**的（保留原始 viewBox / d / fill / stroke 属性），
 *    不是手抄，也不是自己画的。少数几处宽高/描边宽度按源码的
 *    `WeightedIconProps` 语义在运行时改写：
 *      · `size`          → width/height（源码 `size = 16 | 14` 默认值）
 *      · `strokeWidth`   → 源码 `ICON_REGULAR_STROKE = 1` / `ICON_MEDIUM_STROKE = 1.3`
 * ══════════════════════════════════════════════════════════════════════════ */

/** `ICON_REGULAR_STROKE`（`icons/index.tsx:22`）。 */
const ICON_REGULAR_STROKE = 1;

/** 唯一需要运行时 id 的图标：`IconArchiveOffOutlineArtwork` 用 `<mask id={maskId}>`。 */
let maskSeq = 0;

const ICONS = Object.freeze({
    FishLogoOutlineRegular: "<svg viewBox=\"0 0 23.16 17.04\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\"><path d=\"M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z\" fill=\"currentColor\" /></svg>",
IconNewChatOutlineRegular: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M2.37091 11.2501C1.58745 9.89288 1.32067 8.29835 1.61969 6.76006C1.91872 5.22177 2.76342 3.8433 3.99826 2.87846C5.2331 1.91362 6.77494 1.42737 8.33988 1.50925C9.90482 1.59113 11.3875 2.23562 12.5149 3.32406C13.6425 4.41269 14.3387 5.87206 14.4754 7.4334C14.612 8.99474 14.18 10.5529 13.2587 11.8209C12.3375 13.0888 10.9891 13.9813 9.46194 14.3337C8.18691 14.628 6.85895 14.5294 5.64989 14.0605C5.1712 13.8748 4.76962 13.4932 4.26534 13.3967C3.67413 13.2835 2.95257 13.5598 2.03794 14.3337" stroke="currentColor" /> <path d="M8 5V11" stroke="currentColor" /> <path d="M5 8H11" stroke="currentColor" /> </svg>',
  IconNewChatOutlineMedium: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M2.37091 11.2501C1.58745 9.89288 1.32067 8.29835 1.61969 6.76006C1.91872 5.22177 2.76342 3.8433 3.99826 2.87846C5.2331 1.91362 6.77494 1.42737 8.33988 1.50925C9.90482 1.59113 11.3875 2.23562 12.5149 3.32406C13.6425 4.41269 14.3387 5.87206 14.4754 7.4334C14.612 8.99474 14.18 10.5529 13.2587 11.8209C12.3375 13.0888 10.9891 13.9813 9.46194 14.3337C8.18691 14.628 6.85895 14.5294 5.64989 14.0605C5.1712 13.8748 4.76962 13.4932 4.26534 13.3967C3.67413 13.2835 2.95257 13.5598 2.03794 14.3337" stroke="currentColor" /> <path d="M8 5V11" stroke="currentColor" /> <path d="M5 8H11" stroke="currentColor" /> </svg>',
  IconSearchOutlineRegular: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z" stroke="currentColor" /> <path d="M10.2991 10.3933L14.7783 14.8725" stroke="currentColor" /> </svg>',
  IconPanelLeftOutlineRegular: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M13.5 1.5H2.5C1.94772 1.5 1.5 1.94772 1.5 2.5V13.5C1.5 14.0523 1.94772 14.5 2.5 14.5H13.5C14.0523 14.5 14.5 14.0523 14.5 13.5V2.5C14.5 1.94772 14.0523 1.5 13.5 1.5Z" stroke="currentColor" /> <path d="M5.5 1.5V14.5" stroke="currentColor" /> </svg>',
  IconEllipsisOutlineRegular: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M3 9C3.55228 9 4 8.55228 4 8C4 7.44772 3.55228 7 3 7C2.44772 7 2 7.44772 2 8C2 8.55228 2.44772 9 3 9Z" fill="currentColor" /> <path d="M8 9C8.55228 9 9 8.55228 9 8C9 7.44772 8.55228 7 8 7C7.44772 7 7 7.44772 7 8C7 8.55228 7.44772 9 8 9Z" fill="currentColor" /> <path d="M13 9C13.5523 9 14 8.55228 14 8C14 7.44772 13.5523 7 13 7C12.4477 7 12 7.44772 12 8C12 8.55228 12.4477 9 13 9Z" fill="currentColor" /> </svg>',
  IconTriangleRightFillRegular: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M5.5 4.5C5.5 4.40714 5.52586 4.31612 5.57467 4.23713C5.62349 4.15815 5.69334 4.09431 5.77639 4.05279C5.85945 4.01126 5.95242 3.99368 6.0449 4.00202C6.13738 4.01036 6.22572 4.04429 6.3 4.1L10.967 7.6C11.0291 7.64657 11.0795 7.70697 11.1142 7.77639C11.1489 7.84582 11.167 7.92238 11.167 8C11.167 8.07762 11.1489 8.15418 11.1142 8.22361C11.0795 8.29303 11.0291 8.35343 10.967 8.4L6.3 11.9C6.22572 11.9557 6.13738 11.9896 6.0449 11.998C5.95242 12.0063 5.85945 11.9887 5.77639 11.9472C5.69334 11.9057 5.62349 11.8419 5.57467 11.7629C5.52586 11.6839 5.5 11.5929 5.5 11.5V4.5Z" fill="currentColor" /> </svg>',
  IconCloseFillRegular: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M3.5 3.5L12.5 12.5" stroke="currentColor" /> <path d="M12.5 3.5L3.5 12.5" stroke="currentColor" /> </svg>',
  IconEditOutlineRegular: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M8.85596 2.69971H4.19971C3.37141 2.69971 2.69992 3.37146 2.69971 4.19971V11.8003C2.69992 12.6285 3.37141 13.3003 4.19971 13.3003H11.8003C12.6283 13.2999 13.3001 12.6283 13.3003 11.8003V7.89893H14.3003V11.8003C14.3001 13.1806 13.1806 14.2999 11.8003 14.3003H4.19971C2.81913 14.3003 1.69992 13.1808 1.69971 11.8003V4.19971C1.69992 2.81918 2.81913 1.69971 4.19971 1.69971H8.85596V2.69971Z" fill="currentColor" /> <path d="M7.7849 8.23878L13.888 2.13574" stroke="currentColor" /> </svg>',
  IconTrashOutlineRegular: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M1.28149 3.88831H14.7187" stroke="currentColor" /> <path d="M5.41602 3.88833V2.47962C5.41602 2.29282 5.52492 2.11366 5.71876 1.98157C5.9126 1.84948 6.17551 1.77527 6.44964 1.77527H9.55053C9.82466 1.77527 10.0876 1.84948 10.2814 1.98157C10.4753 2.11366 10.5842 2.29282 10.5842 2.47962V3.88833" stroke="currentColor" /> <path d="M2.57349 3.88831L3.19366 13.2943C3.21937 13.5502 3.33952 13.7872 3.53065 13.9593C3.72178 14.1313 3.97016 14.2259 4.22729 14.2246H11.7728C12.0299 14.2259 12.2783 14.1313 12.4694 13.9593C12.6605 13.7872 12.7807 13.5502 12.8064 13.2943L13.4266 3.88831" stroke="currentColor" /> <path d="M6.44946 6.98926V11.1238" stroke="currentColor" /> <path d="M9.55054 6.98926V11.1238" stroke="currentColor" /> </svg>',
  IconProjectAddOutlineRegular: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M5.54492 2.06738C5.91034 2.06754 6.26318 2.20149 6.53711 2.44336L7.94043 3.68164V4.7998C7.71462 4.74105 7.50367 4.63139 7.32617 4.47461L5.87598 3.19238C5.78477 3.11185 5.66658 3.06754 5.54492 3.06738H2.94922C2.67322 3.06738 2.44946 3.29145 2.44922 3.56738V12.4326C2.44927 12.7087 2.67311 12.9326 2.94922 12.9326H12.9326C13.2086 12.9325 13.4326 12.7086 13.4326 12.4326V8.53613H14.4326V12.4326C14.4326 13.2609 13.7609 13.9325 12.9326 13.9326H2.94922C2.12083 13.9326 1.44927 13.261 1.44922 12.4326V3.56738C1.44946 2.73916 2.12094 2.06738 2.94922 2.06738H5.54492Z" fill="currentColor" /> <path d="M9.75977 4.50208H14.5509" stroke="currentColor" /> <path d="M12.1492 6.89758L12.1492 2.10642" stroke="currentColor" /> </svg>',
  IconFolderOpenRegular: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M2.55912 7.93683C2.67584 7.49906 3.0723 7.19446 3.52536 7.19446H13.6491C14.3061 7.19446 14.7846 7.81725 14.6153 8.45209L13.4411 12.856C13.3244 13.2938 12.9279 13.5984 12.4748 13.5984H2.35113C1.69411 13.5984 1.21562 12.9756 1.38489 12.3407L2.55912 7.93683Z" fill="currentColor" opacity="0.16" /> <path d="M13.6491 6.69446C14.6346 6.69453 15.3522 7.62895 15.0983 8.58118L13.9245 12.9845C13.7494 13.6412 13.1539 14.0988 12.4743 14.0988H2.35126C1.36574 14.0988 0.648153 13.1643 0.902044 12.212L2.07587 7.80774C2.25102 7.15128 2.84567 6.69455 3.52509 6.69446H13.6491ZM3.52509 7.69446C3.29865 7.69455 3.10004 7.84674 3.04169 8.06555L1.86786 12.4698C1.78345 12.7872 2.02285 13.0988 2.35126 13.0988H12.4743C12.7007 13.0988 12.8992 12.9463 12.9577 12.7277L14.1325 8.32336C14.2171 8.00598 13.9776 7.69453 13.6491 7.69446H3.52509Z" fill="currentColor" /> <path d="M4.7666 1.90137C5.13227 1.90144 5.48571 2.03525 5.75977 2.27734L7.27246 3.61328C7.36379 3.69382 7.48174 3.73828 7.60352 3.73828H12.3994C13.2276 3.73841 13.8993 4.41005 13.8994 5.23828V6.7168C13.8183 6.70327 13.735 6.69436 13.6494 6.69434H12.8994V5.23828C12.8993 4.96233 12.6754 4.73841 12.3994 4.73828H7.60352C7.23781 4.73828 6.88446 4.60438 6.61035 4.3623L5.09766 3.02637C5.00636 2.94576 4.88838 2.90144 4.7666 2.90137H2.0498C1.77366 2.90137 1.5498 3.12523 1.5498 3.40137V9.78223L0.902344 12.2119C0.648452 13.1642 1.36604 14.0986 2.35156 14.0986H2.0498C1.2214 14.0986 0.549838 13.427 0.549805 12.5986V3.40137C0.549805 2.57294 1.22138 1.90137 2.0498 1.90137H4.7666Z" fill="currentColor" /> </svg>',
  IconFolderCloseRegular: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z" stroke="currentColor" /> <path d="M3.63501 7.66614H12.3647" stroke="currentColor" /> </svg>',
  IconClockOutlineRegular: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14Z" stroke="currentColor" /> <path d="M8 4.31V8.46L11 10.08" stroke="currentColor" /> </svg>',
  IconQueueOutlineRegular: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M5 6.75H11" stroke="currentColor" /> <path d="M5 9H8" stroke="currentColor" /> <path d="M2.37067 11.2497C1.5872 9.89252 1.32042 8.29798 1.61945 6.7597C1.91847 5.22141 2.76317 3.84293 3.99801 2.87809C5.23285 1.91325 6.7747 1.427 8.33964 1.50888C9.90458 1.59076 11.3873 2.23526 12.5147 3.32369C13.6422 4.41232 14.3384 5.8717 14.4751 7.43304C14.6118 8.99438 14.1797 10.5525 13.2585 11.8205C12.3372 13.0885 10.9889 13.9809 9.4617 14.3334C8.18666 14.6277 6.8587 14.529 5.64964 14.0601C5.17095 13.8745 4.76937 13.4929 4.26509 13.3963C3.67389 13.2832 2.95232 13.5595 2.0377 14.3334" stroke="currentColor" /> </svg>',
  IconArchiveOutlineRegular: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M13.5 2.5H2.5C1.94772 2.5 1.5 2.94772 1.5 3.5V4.5C1.5 5.05228 1.94772 5.5 2.5 5.5H13.5C14.0523 5.5 14.5 5.05228 14.5 4.5V3.5C14.5 2.94772 14.0523 2.5 13.5 2.5Z" stroke="currentColor" /> <path d="M2.5 5.5V13.5C2.5 13.7652 2.60536 14.0196 2.79289 14.2071C2.98043 14.3946 3.23478 14.5 3.5 14.5H12.5C12.7652 14.5 13.0196 14.3946 13.2071 14.2071C13.3946 14.0196 13.5 13.7652 13.5 13.5V5.5" stroke="currentColor" /> <path d="M6.5 9.5H9.5" stroke="currentColor" /> </svg>',
  IconUnarchiveOutlineRegular: '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path fill-rule="evenodd" clip-rule="evenodd" d="M15.8659 2.05975C17.2603 2.05995 18.3913 3.19096 18.3914 4.58527V5.4874C18.3914 6.02747 18.2192 6.52672 17.9303 6.93735C17.9336 6.96524 17.9388 6.99318 17.9388 7.02195V12.8884C17.9388 13.6345 17.9395 14.2379 17.8996 14.7254C17.8642 15.1593 17.7936 15.5499 17.6373 15.9141L17.5654 16.0685C17.278 16.6328 16.8405 17.1046 16.3038 17.434L16.0679 17.5661C15.66 17.7739 15.2196 17.8598 14.7237 17.9003C14.2362 17.9401 13.6327 17.9405 12.8867 17.9405H7.11122C6.36511 17.9405 5.76171 17.9401 5.27418 17.9003C4.84051 17.8649 4.44949 17.7952 4.08545 17.6391L3.93104 17.5661C3.36673 17.2785 2.89392 16.8414 2.56465 16.3044L2.43245 16.0685C2.22473 15.6608 2.13878 15.2211 2.09825 14.7254C2.05841 14.2379 2.05912 13.6345 2.05912 12.8884V7.02195C2.05912 6.99284 2.06422 6.96449 2.06758 6.93629C1.77931 6.52592 1.60858 6.02687 1.60858 5.4874V4.58527C1.60876 3.19084 2.73962 2.05975 4.1341 2.05975H15.8659ZM16.4984 7.92936C16.296 7.98169 16.0847 8.01288 15.8659 8.01291H4.1341C3.91478 8.01291 3.70246 7.98194 3.49955 7.92936V12.8884C3.49955 13.6582 3.50053 14.1927 3.53445 14.608C3.56769 15.0146 3.62923 15.244 3.71635 15.415L3.7925 15.5514C3.98339 15.8627 4.25749 16.1165 4.58464 16.2833L4.72529 16.3435C4.88095 16.3993 5.08638 16.4402 5.39158 16.4651C5.80685 16.4991 6.34138 16.5001 7.11122 16.5001H12.8867C13.6564 16.5001 14.1911 16.499 14.6063 16.4651C15.0128 16.432 15.2423 16.3703 15.4133 16.2833L15.5508 16.2061C15.8618 16.0152 16.116 15.7419 16.2827 15.415L16.3429 15.2732C16.3985 15.1177 16.4396 14.9128 16.4645 14.608C16.4985 14.1927 16.4984 13.6583 16.4984 12.8884V7.92936ZM4.1341 3.50019C3.53511 3.50019 3.0492 3.98631 3.04902 4.58527V5.4874C3.04902 6.08649 3.535 6.57248 4.1341 6.57248H15.8659C16.4648 6.57228 16.951 6.08638 16.951 5.4874V4.58527C16.9509 3.98644 16.4647 3.50038 15.8659 3.50019H4.1341Z" fill="currentColor" /> <path d="M10 14.1V10.1M7.85 12.05L10 9.9L12.15 12.05" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" /> </svg>',
  IconPinFillRegular: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <path d="M9.96976 1.70572L13.1554 3.93629L10.9019 8.12317L11.5158 11.605L10.7192 12.7427L2.52767 7.00693L3.3243 5.86922L6.80612 5.25528L9.96976 1.70572Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round" /> <path d="M6.05285 9.47511C6.27284 9.16094 6.70586 9.08458 7.02003 9.30457C7.3342 9.52455 7.41055 9.95757 7.19057 10.2717L3.98587 14.4708L3.21223 13.9291L6.05285 9.47511Z" fill="currentColor" /> </svg>',
  IconFlatListOutlineRegular: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"> <path d="M6 3.5h7.5M6 8h7.5M6 12.5h7.5" /> <path d="M2.6 3.5h.01M2.6 8h.01M2.6 12.5h.01" /> </svg>',
  IconWorkspaceTreeOutlineRegular: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"> <path d="M14 12.05c0 .8-.65 1.45-1.46 1.45H3.46C2.65 13.5 2 12.85 2 12.05v-8.1c0-.8.65-1.45 1.46-1.45h2.4c.49 0 .94.24 1.21.65l.5.73c.27.4.73.65 1.21.65h3.76c.8 0 1.46.65 1.46 1.45v6.02Z" /> <path d="M8.7 8.1v3M11.2 8.1v3" /> </svg>',
  IconChevronsUpDownOutlineRegular: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"> <path d="m5.1 6 2.9-2.9L10.9 6" /> <path d="m5.1 10 2.9 2.9 2.9-2.9" /> </svg>',
  IconArchiveOffOutlineRegular: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"> <mask id="__MASK_ID__" maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16"> <rect x="0" y="0" width="16" height="16" fill="white" stroke="none" /> <path d="m2.2 1.3 11.6 12.8" stroke="black" /> </mask> <g mask="url(#__MASK_ID__)"> <rect x="1.9" y="2.1" width="12.2" height="3.4" rx="1.1" /> <path d="M2.95 5.7v4.8a2.9 2.9 0 0 0 2.9 2.9h4.3a2.9 2.9 0 0 0 2.9-2.9V5.7" /> </g> <path d="m2.2 1.3 11.6 12.8" /> </svg>',
  IconArchiveCheckOutlineRegular: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"> <rect x="1.9" y="2.1" width="12.2" height="3.4" rx="1.1" /> <path d="M2.95 5.7v4.8a2.9 2.9 0 0 0 2.9 2.9h4.3a2.9 2.9 0 0 0 2.9-2.9V5.7" /> <path d="m6 9.35 1.4 1.4 2.6-2.6" /> </svg>',
  IconSlidersTwoOutlineRegular: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"> <path d="M2.3 5h5.85M12.05 5h1.65" /> <circle cx="9.95" cy="5" r="1.45" /> <path d="M2.3 11h1.65M7.85 11h5.85" /> <circle cx="5.75" cy="11" r="1.45" /> </svg>',
});

/**
 * 按源码的 `size` / `strokeWidth` prop 语义渲染一个图标。
 * @param {string} name - 图标名（`ICONS` 的键，如 `IconSearchOutlineRegular`）
 * @param {{size?: number, strokeWidth?: number, className?: string}} [options]
 * @returns {HTMLElement} 已设定 `width`/`height`，有 `className` 时附加类名
 */
function icon(name, { size = 16, strokeWidth = ICON_REGULAR_STROKE, className = '' } = {}) {
  let markup = ICONS[name];
  if (markup === undefined) throw new Error(`dsh-sidebar: unknown icon ${name}`);
  if (markup.includes('__MASK_ID__')) {
    maskSeq += 1;
    markup = markup.replaceAll('__MASK_ID__', `dsh-mask-${maskSeq}`);
  }
  const host = el('span');
  host.innerHTML = markup;
  const svg = host.firstElementChild;
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  if (strokeWidth !== ICON_REGULAR_STROKE) svg.setAttribute('stroke-width', String(strokeWidth));
  if (className) svg.setAttribute('class', className);
  return svg;
}

/**
 * `StateDot`（`ui-primitives/src/StateDot.tsx:44`）。
 * ongoing 是唯一的非圆点态：一个旋转的环 + 呼吸的弧。
 * @param {'done'|'warning'|'ongoing'|'error'|'idle'} state
 * @param {number} [size] 直径；默认 ongoing 14，其余 10
 * @returns {HTMLElement}
 */
function stateDot(state, size) {
  const edge = size ?? (state === 'ongoing' ? 14 : 10);
  if (state === 'ongoing') return stateSpinner(edge);
  const node = el('span', C.stateDot);
  node.dataset.state = state;
  node.style.width = `${edge}px`;
  node.style.height = `${edge}px`;
  return node;
}

/** `StateDot` 的 ongoing 分支（内联 SVG，源码同形）。 */
function stateSpinner(edge) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', C.stateSpinner);
  svg.dataset.state = 'ongoing';
  svg.setAttribute('width', String(edge));
  svg.setAttribute('height', String(edge));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', C.stateSpinnerMotion);
  for (const cls of [C.stateSpinnerTrack, C.stateSpinnerArc]) {
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('class', cls);
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '9.5');
    g.appendChild(circle);
  }
  svg.appendChild(g);
  return svg;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. 纯派生层 —— 逐行对照 `ui-workspace/src/client/tree.ts`
 *    （只有 `sessionVisible` 的一处 switch 与 `deriveGroups` 的缓存是新写的，
 *      都在注释里标了理由）
 * ══════════════════════════════════════════════════════════════════════════ */

/** Group key for Sessions outside every Workspace（`tree.ts:18`）。 */
const UNGROUPED_KEY = '';

/** `tree.ts:131-135` `workspaceLabel`。 */
function workspaceLabel(cwd) {
  if (cwd === undefined || cwd === '') return '';
  const base = workspaceTitleOf(cwd);
  return base !== '' ? base : cwd;
}

/** `tree.ts:624-627` `folderPath`（Windows 盘符/UNC 归一化，其余大小写敏感）。 */
function folderPath(path) {
  const windows = /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\');
  return (windows ? path.replaceAll('\\', '/') : path).replace(/\/+$/, '');
}

/** `tree.ts:636-647` `owningParentFolder`。 */
function owningParentFolder(path, parents) {
  const child = folderPath(path);
  let owner;
  let length = -1;
  for (const parent of parents) {
    const root = folderPath(parent);
    if (root.length > length && child !== root && child.startsWith(`${root}/`)) {
      owner = parent;
      length = root.length;
    }
  }
  return owner;
}

/** `tree.ts:143-157` `orderByRecency`：`updatedAt` 降序，并列按 id 字典序。 */
function orderByRecency(sessionIds, summaries) {
  return sessionIds
    .flatMap((id) => {
      const summary = summaries[id];
      if (summary === undefined) return [];
      return [{ id, rank: summary.updatedAt }];
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) return b.rank - a.rank;
      return a.id < b.id ? -1 : 1;
    })
    .map(member => member.id);
}

/** `tree.ts:168-209` `reconcileManualOrder`。 */
function reconcileManualOrder(memberIds, savedOrder, summaries, rowState) {
  const members = new Map(memberIds.map(id => [id, id]));
  const included = new Set();
  const ordered = [];
  for (const key of savedOrder ?? []) {
    const id = members.get(key);
    if (id === undefined || included.has(key)) continue;
    ordered.push(id);
    included.add(key);
  }
  const archived = new Set(rowState?.archivedSessionIds);
  const pins = [];
  for (const sessionId of rowState?.pinnedSessionIds ?? []) {
    const id = members.get(sessionId);
    if (id === undefined || included.has(id) || archived.has(id) || summaries[id] === undefined) continue;
    pins.push(id);
    included.add(id);
  }
  const ordinary = [];
  const archives = [];
  for (const id of orderByRecency([...members.values()].filter(id => !included.has(id)), summaries)) {
    if (archived.has(id)) archives.push(id);
    else ordinary.push(id);
  }
  const result = [...pins, ...ordered, ...ordinary, ...archives];
  const pending = new Set(ordinary);
  const placeFork = id => {
    if (!pending.delete(id)) return;
    const parentId = summaries[id]?.parentId;
    if (parentId === undefined || parentId === id || !result.includes(parentId)) return;
    placeFork(parentId);
    result.splice(result.indexOf(id), 1);
    result.splice(result.indexOf(parentId), 0, id);
  };
  for (const id of [...ordinary].reverse()) placeFork(id);
  return result;
}

/** `tree.ts:217-223` `pinCurrentBlank`。 */
function pinCurrentBlank(order, currentBlank) {
  if (currentBlank === undefined) return [...order];
  return [currentBlank, ...order.filter(id => id !== currentBlank)];
}

/**
 * `tree.ts:238-257` `sessionVisible`。
 *
 * ⚠️ 源码用的是 TypeScript 的可辨识联合 + `assertNever` 兜底。纯 JS 里没有
 * 静态收窄，所以这里保留同样的三个分支，并且**显式落到 default**
 * （源码的 `default: return assertNever(...)` 在 JS 里等价于"无此分支"，
 * 这里返回 `false` = 不可见，是唯一安全的收敛方向）。
 */
function sessionVisible(session, current, archived, archivedFilter) {
  if (session.origin === 'subagent') return false;
  if (session.blank && session.id !== current) return false;
  switch (archivedFilter) {
    case 'default':
      return !archived.has(session.id);
    case 'show':
      return true;
    case 'only':
      return archived.has(session.id);
    default:
      return false;
  }
}

/** `tree.ts:295-297` `sessionTitle`。 */
function sessionTitle(session) {
  return session.blank ? '' : (session.title?.trim() ?? '');
}

/** `tree.ts:273-287` `sectionMembers`。 */
function sectionMembers(members, pinned, archived) {
  const placeholders = [];
  const leading = [];
  const rest = [];
  for (const member of members) {
    if (member.blank) placeholders.push(member);
    else if (!archived.has(member.id) && pinned.has(member.id)) leading.push(member);
    else rest.push(member);
  }
  return [...placeholders, ...leading, ...rest];
}

/** `tree.ts:38-41` `mainSessionId`。 */
function mainSessionId(list) {
  return Object.values(list.byId).find(session => (session.retainedBy?.mainView ?? 0) > 0)?.id;
}

/** `tree.ts:26-32` `owningGroupKey`。 */
function owningGroupKey(workspaces, sessionId) {
  return workspaces.find(workspace => workspace.sessionIds.includes(sessionId))?.workspaceId ?? UNGROUPED_KEY;
}

/** `tree.ts:379-388` `visiblePendingKind`。 */
function visiblePendingKind(kind) {
  switch (kind) {
    case 'approval':
    case 'plan-review':
    case 'question':
      return kind;
    default:
      return undefined;
  }
}

/** `tree.ts:390-395` `runningChildCount`。 */
function runningChildCount(list, parentId, statuses) {
  return list.projectionsBySession?.[parentId]?.values?.subagentCatalog?.reduce(
    (count, child) => count + (((statuses.get(child.id)?.running ?? list.byId[child.id]?.running) === true) ? 1 : 0),
    0,
  ) ?? 0;
}

/** `tree.ts:397-418` `sessionNode`。 */
function sessionNode(s, list, statuses, pinned, archived) {
  const status = statuses.get(s.id);
  const pendingInteraction = visiblePendingKind(status?.pendingInteraction?.kind);
  return {
    id: s.id,
    title: sessionTitle(s),
    blank: s.blank,
    running: status?.running ?? s.running,
    runningSubagentCount: runningChildCount(list, s.id, statuses),
    completed: status?.completionUnread === true,
    pinned: !archived.has(s.id) && pinned.has(s.id),
    archived: archived.has(s.id),
    updatedAt: s.updatedAt,
    ...(pendingInteraction === undefined ? {} : { pendingInteraction }),
  };
}

/** `tree.ts:311-326` `orderedUngrouped`。 */
function orderedUngrouped(members, stored, summaries) {
  const byId = new Map(members.map(session => [session.id, session]));
  const ids = stored === undefined
    ? orderByRecency(members.map(session => session.id), summaries)
    : reconcileManualOrder(members.map(session => session.id), stored, summaries);
  return ids.flatMap((id) => {
    const session = byId.get(id);
    return session === undefined ? [] : [session];
  });
}

/** `tree.ts:334-376` `groupByWorkspace`。 */
function groupByWorkspace(list, workspaces, archived, archivedFilter, ungroupedOrder) {
  const current = mainSessionId(list);
  const groups = [];
  const accounted = new Set();
  for (const workspace of workspaces) {
    const members = [];
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id];
      if (summary === undefined) continue;
      accounted.add(id);
      if (!sessionVisible(summary, current, archived, archivedFilter)) continue;
      members.push(summary);
    }
    // The archived-only view lists archives, not the Workspace inventory, so
    // a Workspace without archived Sessions contributes no group.
    if (archivedFilter === 'only' && members.length === 0) continue;
    groups.push({
      key: workspace.workspaceId,
      workspaceId: workspace.workspaceId,
      cwd: workspace.path,
      createdAt: Date.parse(workspace.createdAt),
      label: workspace.title,
      sessions: [...members],
    });
  }
  const stray = list.ids
    .map(id => list.byId[id])
    .filter(s => s !== undefined && !accounted.has(s.id)
      && sessionVisible(s, current, archived, archivedFilter));
  if (stray.length > 0) {
    groups.push({
      key: UNGROUPED_KEY,
      workspaceId: undefined,
      cwd: undefined,
      createdAt: undefined,
      label: '',
      sessions: orderedUngrouped(stray, ungroupedOrder, list.byId),
    });
  }
  return groups;
}

/**
 * `deriveGroups`（`tree.ts:436-469`）—— 纯函数，不带缓存。
 *
 * ⚠️ 约定 ③（`useMemo` 的引用相等是语义）**不能**靠一个模块级共用缓存来补：
 * 那会在有多个消费者时互相踩（A 的分组树被 B 的输入覆盖）。
 * 正确做法是**每个消费者各持一个缓存**，见 {@link createMemoizedDeriveGroups}。
 *
 * @param {object} list - `{ ids, byId, projectionsBySession }`
 * @param {Array} workspaces - `[{ workspaceId, path, title, createdAt, sessionIds }]`
 * @param {object} rowState - `{ pinnedSessionIds, archivedSessionIds, archivedFilter }`
 * @param {Map} statuses - sessionId → `{ running, pendingInteraction, completionUnread }`
 * @param {object} view - `{ expandedGroups, ungroupedOrder }`
 * @returns {Array} `GroupNode[]`
 */
function deriveGroups(list, workspaces, rowState, statuses, view) {
  const archived = new Set(rowState.archivedSessionIds);
  const pinned = new Set(rowState.pinnedSessionIds);
  const expandedGroups = new Set(view.expandedGroups);
  const current = mainSessionId(list);
  const currentGroup = current === undefined ? undefined : owningGroupKey(workspaces, current);
  const groups = [];
  for (const g of groupByWorkspace(list, workspaces, archived, rowState.archivedFilter, view.ungroupedOrder)) {
    const expanded = expandedGroups.has(g.key);
    groups.push({
      key: g.key,
      workspaceId: g.workspaceId,
      cwd: g.cwd,
      createdAt: g.createdAt,
      label: g.label,
      sessionCount: g.sessions.length,
      expanded,
      containsCurrent: g.key === currentGroup,
      sessions: expanded
        ? sectionMembers(g.sessions, pinned, archived)
          .map(session => sessionNode(session, list, statuses, pinned, archived))
        : [],
    });
  }
  return groups;
}

/**
 * 造一个**每个消费者各持一份**的 `deriveGroups` 记忆器 —— 这是 React 那边
 * `useMemo(() => deriveGroups(...), [list, workspaces, rowState, statuses, expandedGroups, ungroupedSessionIds])`
 * 的等价物。
 *
 * `WorkspaceBrowser.tsx:920-927` 的注释写明：**每次新建 `rowState` 对象会让
 * 整个分组树重算**。所以这里的 `memo(state)` 按**内容**比依赖
 * （`list` / `workspaces` / `statuses` 引用比，`rowState` / `view` 内容比）：
 * 内容没变就返回**上一次那个数组**（引用相等），
 * 于是渲染层判"没变"，一行 DOM 都不会碰。
 *
 * @param {(cache: object|undefined, args: object) => boolean} [equal] 输入相等判定（默认 {@link sameDeriveInputs}）
 * @returns {(list: object, workspaces: Array, rowState: object, statuses: Map, view: object) => Array}
 */
function createMemoizedDeriveGroups(equal) {
  const same = equal ?? sameDeriveInputs;
  let cache;
  return function memoizedDeriveGroups(list, workspaces, rowState, statuses, view) {
    if (cache !== undefined && same(cache, { list, workspaces, rowState, statuses, view })) {
      return cache.groups;
    }
    const groups = deriveGroups(list, workspaces, rowState, statuses, view);
    cache = { list, workspaces, rowState, statuses, view, groups };
    return groups;
  };
}

/**
 * `useMemo` 依赖数组的等价判定。
 *
 * 逐项复刻 `WorkspaceBrowser.tsx:331-342` 的依赖列表：
 *   `[list, workspaces, rowState, statuses, expandedGroups, ungroupedSessionIds]`
 * `list` / `workspaces` / `statuses` 按**引用**比（源码就是引用比）；
 * `rowState` 按三个字段的**内容**比（源码的 `orderState` memo 已经保证
 * `pinnedSessionIds` / `archivedSessionIds` 数组引用稳定，这里再退一步按内容比，
 * 效果等价：内容没变就不重算）；`view` 拆成 `expandedGroups` 内容 + `ungroupedOrder` 引用。
 * @param {object} cache 上一次的 `{ list, workspaces, rowState, statuses, view, groups }`
 * @param {object} next 本次的 `{ list, workspaces, rowState, statuses, view }`
 * @returns {boolean} true 表示可以复用上一次的分组树
 */
function sameDeriveInputs(cache, next) {
  if (cache.list !== next.list || cache.workspaces !== next.workspaces || cache.statuses !== next.statuses) return false;
  const prevRow = cache.rowState;
  const rowState = next.rowState;
  if (prevRow.archivedFilter !== rowState.archivedFilter) return false;
  if (!sameStrings(prevRow.pinnedSessionIds, rowState.pinnedSessionIds)) return false;
  if (!sameStrings(prevRow.archivedSessionIds, rowState.archivedSessionIds)) return false;
  const prevView = cache.view;
  const view = next.view;
  if (prevView.ungroupedOrder !== view.ungroupedOrder) return false;
  if (!sameStrings(prevView.expandedGroups, view.expandedGroups)) return false;
  return true;
}

/** 数组内容逐项相等（顺序敏感，与 React 依赖数组的语义一致）。 */
function sameStrings(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** `tree.ts:476-478` `sessionMemberIds` → `visibleSessionIds`。 */
function sessionMemberIds(list) {
  return visibleSessionIds(list, [], 'show');
}

/** `tree.ts:487-498` `visibleSessionIds`。 */
function visibleSessionIds(list, archivedSessionIds, archivedFilter) {
  const archived = new Set(archivedSessionIds);
  const current = mainSessionId(list);
  return list.ids.filter((id) => {
    const s = list.byId[id];
    return s !== undefined && sessionVisible(s, current, archived, archivedFilter);
  });
}

/** `tree.ts:509-526` `deriveFlat`。 */
function deriveFlat(list, sessionIds, rowState, statuses) {
  const archived = new Set(rowState.archivedSessionIds);
  const pinned = new Set(rowState.pinnedSessionIds);
  const current = mainSessionId(list);
  const members = sessionIds.flatMap((id) => {
    const session = list.byId[id];
    return session !== undefined && sessionVisible(session, current, archived, rowState.archivedFilter)
      ? [session]
      : [];
  });
  return sectionMembers(members, pinned, archived)
    .map(session => sessionNode(session, list, statuses, pinned, archived));
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. 文案 —— 对应 `ui-workspace/src/client/locales.ts` / `ui-sidebar/.../locales.ts`
 *    ⚠️ 源码里所有产品文案都走 `t(key)` typed dictionary（见 client/AGENTS.md
 *    "locale-owned client UI copy"）。纯 JS 版没有 locale 座位，所以这里
 *    **只给一份英文默认值**，全部可被调用方覆盖：`createXXX({ labels })`。
 *    本文件不硬编码任何中文产品文案 —— 中文只在注释里。
 * ══════════════════════════════════════════════════════════════════════════ */

const DEFAULT_LABELS = Object.freeze({
  'section.sessions': 'Sessions',
  'section.workspaces': 'Workspaces',
  'session.new': 'New session',
  'session.new.label': 'New session',
  'session.untitled': 'Untitled',
  'group.ungrouped': 'Ungrouped',
  'empty.none': 'No sessions yet',
  'empty.noneArchived': 'No archived sessions',
  'empty.viewOthers': 'View all sessions',
  'sessions.collapse': 'Show fewer',
  'sessions.expand': 'Show {n} more',
  'row.pinned': 'Pinned',
  'row.archived': 'Archived',
  'search.sessions.aria': 'Search sessions',
  'search.placeholder': 'Search sessions',
  'search.clear': 'Clear search',
  'search.results.aria': 'Search results',
  'search.pending': 'Searching',
  'search.noMatches': 'No matches',
  'search.hasMore': 'Showing the first {n} results',
  'actions.session.aria': 'Actions for {name}',
  'actions.workspace.aria': 'Actions for {name}',
  'actions.newSession': 'New session in this workspace',
  'actions.newSession.aria': 'New session in {name}',
  'actions.unarchive': 'Unarchive',
  'menu.unarchiveSession': 'Unarchive session',
  'status.running': 'Running',
  'status.completed': 'Finished',
  'status.idle': 'Idle',
  'status.waitingApproval': 'Waiting for approval',
  'status.planReview': 'Plan ready for review',
  'status.waitingAnswer': 'Waiting for your answer',
  'status.compact.approval': 'Approval',
  'status.compact.planReview': 'Plan',
  'status.compact.answer': 'Question',
  'status.subagentsRunning.one': '1 subagent running',
  'status.subagentsRunning.other': '{n} subagents running',
  'toast.archivedNotOpenable': 'Archived sessions cannot be opened',
  'time.now': 'now',
  'time.minutes': '{n}min',
  'time.hours': '{n}h',
  'time.days': '{n}d',
  'time.months': '{n}mo',
  'time.years': '{n}y',
  'time.ago': '{t} ago',
  'date.ymd': '{y}-{m}-{d}',
  'hover.created': 'Created {time}',
  'copy': 'Copy',
  'hover.copied': 'Copied',
  'rename': 'Rename',
  'delete.workspace': 'Delete workspace',
  'brand.localBuild': 'DeepSeek Harness',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
  'panels.label': 'Panels',
});

/**
 * 把 `{name}` 占位替换掉（源码用 typed dictionary 的插值）。
 * @param {string} template
 * @param {object} [vars]
 * @returns {string}
 */
function fill(template, vars) {
  if (vars === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  ));
}

/**
 * 造一个 `t` 座位：查 `labels`，查不到回落到英文默认值，再查不到回 key 本身。
 * @param {object} [labels] 调用方覆盖的文案
 * @returns {(key: string, vars?: object) => string}
 */
function makeT(labels = {}) {
  return (key, vars) => {
    const template = labels[key] ?? DEFAULT_LABELS[key] ?? key;
    return fill(template, vars);
  };
}

/** `relativeTime`（`ui-primitives/src/relative-time.ts:25`）。 */
function relativeTime(at, now) {
  const MIN = 60000;
  const HOUR = 3600000;
  const DAY = 86400000;
  const diff = Math.max(0, now - at);
  if (diff < MIN) return { unit: 'now', n: 0 };
  if (diff < HOUR) return { unit: 'minutes', n: Math.floor(diff / MIN) };
  if (diff < DAY) return { unit: 'hours', n: Math.floor(diff / HOUR) };
  if (diff < 30 * DAY) return { unit: 'days', n: Math.floor(diff / DAY) };
  if (diff < 365 * DAY) return { unit: 'months', n: Math.floor(diff / (30 * DAY)) };
  return { unit: 'years', n: Math.floor(diff / (365 * DAY)) };
}

/** `Rows.tsx:137-140` `timeLabel`。 */
function timeLabel(updatedAt, now, t) {
  const { unit, n } = relativeTime(updatedAt, now);
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n });
}

/** `Rows.tsx:143-146` `hoverTimeLabel`。 */
function hoverTimeLabel(updatedAt, now, t) {
  const { unit, n } = relativeTime(updatedAt, now);
  return unit === 'now' ? t('time.now') : t('time.ago', { t: t(`time.${unit}`, { n }) });
}

/** `Rows.tsx:153-158` `createdLabel`。 */
function createdLabel(createdAt, t) {
  const d = new Date(createdAt);
  const pad2 = v => String(v).padStart(2, '0');
  const date = t('date.ymd', { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });
  return t('hover.created', { time: `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` });
}

/** `Rows.tsx:48-50` `displayTitle`。 */
function displayTitle(node, t) {
  return node.blank ? t('session.new') : (node.title || t('session.untitled'));
}

/** `Rows.tsx:347-397` `sessionStatuses`（优先级：pending > running > subagents > completed > idle）。 */
function sessionStatuses(node, t) {
  const subagents = node.runningSubagentCount === 0
    ? undefined
    : {
      state: 'ongoing',
      label: t(
        node.runningSubagentCount === 1 ? 'status.subagentsRunning.one' : 'status.subagentsRunning.other',
        { n: node.runningSubagentCount },
      ),
    };
  let pending;
  switch (node.pendingInteraction) {
    case 'approval':
      pending = { state: 'warning', label: t('status.waitingApproval'), trailingLabel: t('status.compact.approval') };
      break;
    case 'plan-review':
      pending = { state: 'warning', label: t('status.planReview'), trailingLabel: t('status.compact.planReview') };
      break;
    case 'question':
      pending = { state: 'warning', label: t('status.waitingAnswer'), trailingLabel: t('status.compact.answer') };
      break;
    default:
      break;
  }
  if (pending !== undefined) return subagents === undefined ? [pending] : [pending, subagents];
  if (node.running) {
    const primary = { state: 'ongoing', label: t('status.running') };
    return subagents === undefined ? [primary] : [primary, subagents];
  }
  if (subagents !== undefined) return [subagents];
  if (node.completed) return [{ state: 'done', label: t('status.completed') }];
  return [{ state: 'idle', label: t('status.idle') }];
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. 行组件 —— 对照 `Rows.tsx`
 * ══════════════════════════════════════════════════════════════════════════ */

const MIN_TITLE_REVEAL_PX = 8;
const TITLE_MARQUEE_PX_PER_MS = 0.03;

/** `Rows.tsx:67-76` `placeTitle`：写滚动位 + 发布 `data-scrolled` / `data-clipped`。 */
function placeTitle(title, left, range) {
  if (typeof title.scrollTo === 'function') title.scrollTo({ left, behavior: 'instant' });
  else title.scrollLeft = left;
  if (left > 0) title.dataset.scrolled = '';
  else delete title.dataset.scrolled;
  if (left < range) title.dataset.clipped = '';
  else delete title.dataset.clipped;
}

/** `Rows.tsx:83-88` `restTitle`。 */
function restTitle(title) {
  if (typeof title.scrollTo === 'function') title.scrollTo({ left: 0, behavior: 'instant' });
  else title.scrollLeft = 0;
  delete title.dataset.scrolled;
  delete title.dataset.clipped;
}

/**
 * `useTitleMarquee`（`Rows.tsx:102-134`）的等价物：一个可复用的跑马灯。
 * @param {HTMLElement} title - 行的可裁切标题元素
 * @returns {{enter(): void, leave(): void, dispose(): void}}
 */
function createTitleMarquee(title) {
  let frame = 0;
  const cancel = () => {
    if (frame !== 0) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      frame = 0;
    }
  };
  return {
    enter() {
      const range = title.scrollWidth - title.clientWidth;
      if (range <= MIN_TITLE_REVEAL_PX) return;
      const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced || typeof requestAnimationFrame !== 'function') {
        placeTitle(title, range, range);
        return;
      }
      cancel();
      let previous;
      let position = 0;
      const step = now => {
        position += previous === undefined ? 0 : (now - previous) * TITLE_MARQUEE_PX_PER_MS;
        previous = now;
        placeTitle(title, Math.min(position, range), range);
        if (position < range) frame = requestAnimationFrame(step);
        else frame = 0;
      };
      frame = requestAnimationFrame(step);
    },
    leave() {
      cancel();
      restTitle(title);
    },
    dispose: cancel,
  };
}

/**
 * 建一个**会话行**（`SessionNodeItem`，`Rows.tsx:544-703`）。
 *
 * DOM：
 * ```
 * div.dsh-session-row[data-row-key="session:{id}"][role="treeitem"]
 *     [aria-selected][aria-description?]（.dsh-selected .dsh-menu-open
 *      .dsh-archived .dsh-drop-before .dsh-drop-after）
 * ├─ span.dsh-slot            ← 状态点，或 `sidebar.session.row.leading` 槽
 * ├─ span.dsh-title[data-scrolled][data-clipped]
 * ├─ span.dsh-time[aria-hidden]
 * ├─ span.dsh-pin-indicator[role="img"]
 * └─ span.dsh-row-actions
 *     ├─ button.dsh-row-icon-button   ← 菜单锚点
 *     └─ div[data-slot="sidebar.workspaces.session.row.action"]
 * ```
 *
 * ⚠️ HoverCard：源码把整行包在 `<HoverCard anchor={ownRow}>` 里。这里 HoverCard
 * 本身没抄（那是一个 portal + 计时器的交互原语，不属于你列出的抄录范围），
 * 所以没有包裹层 —— 行就是根节点。见回复"存疑清单"第 3 条。
 *
 * @param {object} [options]
 * @param {object} [options.node] 初始 `SessionNode`
 * @param {string} [options.currentId] 当前选中会话 id
 * @param {number} [options.now] 相对时间的基准时刻
 * @param {object} [options.labels] 文案覆盖
 * @param {Function} [options.onOpen]
 * @param {Function} [options.onRenameRequest]
 * @returns {{root: HTMLElement, update(data: object): void, ...}}
 */
function createSessionRow(options = {}) {
  const {
    node: initialNode = { id: '', title: '', blank: false, running: false, runningSubagentCount: 0, completed: false, pinned: false, archived: false, updatedAt: 0 },
    currentId,
    now: initialNow = Date.now(),
    labels,
    onOpen = () => {},
    onRenameRequest = () => {},
    onDeleteRequest = () => {},
  } = options;
  const t = makeT(labels);

  let node = initialNode;
  let current = currentId;
  let now = initialNow;
  let menuOpen = false;
  let drag = null;

  const root = el('div', C.sessionRow);
  root.setAttribute('role', 'treeitem');

  const slot = el('span', C.slot);
  const title = el('span', C.title);
  const time = el('span', C.time);
  const pin = el('span', C.pinIndicator);
  pin.setAttribute('role', 'img');

  const actions = el('span', C.rowActions);
  const menuButton = el('button', C.rowIconButton);
  menuButton.type = 'button';
  const actionSlot = slotMark('sidebar.workspaces.session.row.action');
  /**
   * **重命名 / 删除** —— 填进 DSH 留的那个空动作槽。
   *
   * 原版这一格留给 `sidebar.workspaces.session.row.action` 槽的占用方；
   * 本项目没有插件体系，所以直接在这里放两个按钮（沿用原版同一个
   * `dsh-row-icon-button`，同样只在悬停/聚焦时显形）。
   *
   * ⚠️ **这两个不是 DSH 的归档** —— 会话管理只做改名与删除，
   * **没有归档这一层**。
   */
  const renameButton = el('button', `${C.rowIconButton} dsh-row-action`);
  renameButton.type = 'button';
  renameButton.dataset.rowAction = 'rename';
  renameButton.textContent = '✎';
  const deleteButton = el('button', `${C.rowIconButton} dsh-row-action`);
  deleteButton.type = 'button';
  deleteButton.dataset.rowAction = 'delete';
  deleteButton.textContent = '🗑';
  renameButton.addEventListener('click', event => {
    event.stopPropagation();
    onRenameRequest(node.id, node.title);
  });
  deleteButton.addEventListener('click', event => {
    event.stopPropagation();
    onDeleteRequest(node.id, node.title);
  });

  actions.append(menuButton, renameButton, deleteButton, actionSlot);
  root.append(slot, title, time, pin, actions);

  const marquee = createTitleMarquee(title);

  root.addEventListener('click', () => { onOpen(node.id); });
  root.addEventListener('pointerenter', () => { marquee.enter(); });
  root.addEventListener('pointerleave', () => { marquee.leave(); });
  title.addEventListener('dblclick', (event) => {
    if (node.blank) return;
    event.stopPropagation();
    onRenameRequest(node.id, node.title);
  });
  menuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    setMenuOpen(!menuOpen);
  });
  actions.addEventListener('click', (event) => { event.stopPropagation(); });

  /** 前导格：归档行留空；非空白且状态非 idle 时画状态点，否则让位给 leading 槽。 */
  function renderLeading() {
    slot.replaceChildren();
    if (node.archived || node.blank) return;
    const statuses = sessionStatuses(node, t);
    if (statuses[0].state !== 'idle') {
      slot.appendChild(stateDot(statuses[0].state));
      for (const status of statuses) slot.appendChild(el('span', C.visuallyHidden, status.label));
      return;
    }
    // 约定 ①：leading 槽始终在位（这里没有注册项，所以只留锚点）。
    slot.appendChild(slotMark('sidebar.session.row.leading'));
  }

  /** 一处落盘（对应 React 的一次 render）。 */
  function sync() {
    const selected = node.id === current;
    root.dataset.rowKey = `session:${node.id}`;
    root.classList.toggle(C.selected, selected);
    root.classList.toggle(C.menuOpen, menuOpen);
    root.classList.toggle(C.archived, Boolean(node.archived));
    root.classList.toggle(C.dropBefore, drag?.marker === 'before');
    root.classList.toggle(C.dropAfter, drag?.marker === 'after');
    root.setAttribute('aria-selected', String(selected));
    if (node.archived) root.setAttribute('aria-description', t('toast.archivedNotOpenable'));
    else root.removeAttribute('aria-description');

    title.textContent = displayTitle(node, t);

    const statuses = sessionStatuses(node, t);
    const primary = statuses[0];
    // A blank New Session row is a provisional placeholder: nothing has
    // happened in it yet, so a "now" timestamp and the row verbs
    // (rename/fork/archive) would all act on content that does not exist —
    // both trailing cells stay off until the first prompt.
    time.hidden = Boolean(node.blank);
    time.textContent = primary.trailingLabel ?? timeLabel(node.updatedAt, now, t);
    if (primary.trailingLabel === undefined) time.removeAttribute('aria-hidden');
    else time.setAttribute('aria-hidden', 'true');

    pin.hidden = !(node.pinned && !node.archived);
    if (!pin.hidden) {
      pin.setAttribute('aria-label', t('row.pinned'));
      pin.title = t('row.pinned');
      pin.replaceChildren(icon('IconPinFillRegular', { size: 14 }));
    }

    actions.hidden = Boolean(node.blank);
    menuButton.setAttribute('aria-label', t('actions.session.aria', { name: displayTitle(node, t) }));

    renderLeading();
  }

  function setMenuOpen(value) {
    const next = Boolean(value);
    if (menuOpen === next) return;
    menuOpen = next;
    sync();
  }

  sync();

  return {
    root,
    /**
     * 只改变化的部分。
     * @param {object} data `{ node, currentId, now, menuOpen, drag }`（都可选）
     */
    update(data = {}) {
      if (data.node !== undefined) node = data.node;
      if (data.currentId !== undefined) current = data.currentId;
      if (data.now !== undefined) now = data.now;
      if (data.drag !== undefined) drag = data.drag;
      if (data.menuOpen !== undefined) menuOpen = Boolean(data.menuOpen);
      sync();
    },
    /** 外部读当前节点（`AnimatedRows` 之类需要 id）。 */
    node: () => node,
    menuOpen: () => menuOpen,
    setMenuOpen,
    /** 跑马灯的 enter/leave（`onPointerEnter/Leave` 用）。 */
    marquee,
    dispose() { marquee.dispose(); },
  };
}

/**
 * 建一个**工作区分组头行**（`ProjectRowItem`，`Rows.tsx:219-329`）。
 *
 * ```
 * div.dsh-project-row[data-row-key="workspace:{key}"][role="treeitem"]
 *     [aria-expanded][draggable]（.dsh-menu-open .dsh-workspace-drop-*）
 * ├─ span.dsh-slot.dsh-folder（.dsh-folder-active）
 * ├─ span.dsh-slot.dsh-chevron > svg.dsh-arrow（.dsh-arrow-open）
 * ├─ span.dsh-project-text > span.dsh-title
 * └─ span.dsh-row-actions
 *     ├─ button.dsh-row-icon-button   ← 菜单锚点
 *     └─ button.dsh-row-icon-button   ← 在此工作区新建会话
 * ```
 *
 * @param {object} [options]
 * @param {object} [options.group] 初始 `GroupNode`
 * @param {boolean} [options.containsCurrentDescendant]
 * @param {object} [options.labels]
 * @param {Function} [options.onToggle]
 * @param {Function} [options.onCreate]
 * @returns {{root: HTMLElement, update(data: object): void}}
 */
function createProjectRow(options = {}) {
  const {
    group: initialGroup = { key: '', workspaceId: undefined, label: '', expanded: true, containsCurrent: false, createdAt: undefined, cwd: undefined, sessionCount: 0, sessions: [] },
    containsCurrentDescendant: initialAncestor = false,
    labels,
    onToggle = () => {},
    onCreate = () => {},
  } = options;
  const t = makeT(labels);

  let group = initialGroup;
  let ancestor = Boolean(initialAncestor);
  let menuOpen = false;
  let drag = null;

  const root = el('div', C.projectRow);
  root.setAttribute('role', 'treeitem');

  const folder = el('span', `${C.slot} ${C.folder}`);
  const chevron = el('span', `${C.slot} ${C.chevron}`);
  const projectText = el('span', C.projectText);
  const title = el('span', C.title);
  projectText.appendChild(title);

  // ⚠️ 工作区行的 `...` 菜单（`Rows.tsx:270-295`）走 `Menu` 原语 + portal，
  //    本项目没有 Menu 原语，**所以这里只保留菜单锚点按钮，没有下拉内容**。
  //    见回复"存疑清单"第 2 条。菜单开关状态通过 `menuOpen()` 读出去。
  const actions = el('span', C.rowActions);
  const menuButton = el('button', C.rowIconButton);
  menuButton.type = 'button';
  const createButton = el('button', C.rowIconButton);
  createButton.type = 'button';
  createButton.appendChild(icon('IconNewChatOutlineRegular'));
  actions.append(menuButton, createButton);

  root.append(folder, chevron, projectText, actions);
  root.addEventListener('click', () => { onToggle(); });
  menuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    setMenuOpen(!menuOpen);
  });
  createButton.addEventListener('click', (event) => {
    event.stopPropagation();
    onCreate();
  });
  root.addEventListener('dragstart', (event) => {
    if (drag === null) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', group.key);
    drag.start();
  });
  root.addEventListener('dragend', () => { drag?.end(); });

  function sync() {
    // The ungrouped bucket has no workspace title: its label is dictionary copy.
    const label = group.workspaceId === undefined ? t('group.ungrouped') : group.label;
    const active = ancestor || (group.expanded && group.containsCurrent);

    root.dataset.rowKey = `workspace:${group.key}`;
    root.classList.toggle(C.menuOpen, menuOpen);
    root.classList.toggle(C.workspaceDropBefore, drag?.marker === 'before');
    root.classList.toggle(C.workspaceDropAfter, drag?.marker === 'after');
    root.setAttribute('aria-expanded', String(Boolean(group.expanded)));
    if (drag !== null) root.setAttribute('draggable', 'true');
    else root.removeAttribute('draggable');

    folder.classList.toggle(C.folderActive, active);
    folder.replaceChildren(icon(group.expanded ? 'IconFolderOpenRegular' : 'IconFolderCloseRegular'));
    chevron.replaceChildren(icon('IconTriangleRightFillRegular', {
      className: group.expanded ? `${C.arrow} ${C.arrowOpen}` : C.arrow,
    }));
    title.textContent = label;

    menuButton.setAttribute('aria-label', t('actions.workspace.aria', { name: label }));
    createButton.setAttribute('aria-label', t('actions.newSession.aria', { name: label }));
    createButton.title = t('actions.newSession');
  }

  function setMenuOpen(value) {
    const next = Boolean(value);
    if (menuOpen === next) return;
    menuOpen = next;
    sync();
  }

  sync();

  return {
    root,
    /** @param {object} data `{ group, containsCurrentDescendant, menuOpen, drag }` */
    update(data = {}) {
      if (data.group !== undefined) group = data.group;
      if (data.containsCurrentDescendant !== undefined) ancestor = Boolean(data.containsCurrentDescendant);
      if (data.menuOpen !== undefined) menuOpen = Boolean(data.menuOpen);
      if (data.drag !== undefined) drag = data.drag;
      sync();
    },
    group: () => group,
    menuOpen: () => menuOpen,
    setMenuOpen,
  };
}

/**
 * 建一个**搜索结果行**（`SearchResultItem`，`Rows.tsx:471-522`）。
 *
 * ```
 * div.dsh-search-result-row[role="treeitem"][aria-selected][aria-description?]
 *     （.dsh-selected .dsh-archived）
 * ├─ span.dsh-search-result-heading
 * │   ├─ span.dsh-slot            ← (!archived && state!=='idle') 时画状态点
 * │   ├─ span.dsh-search-result-title
 * │   └─ span.dsh-row-actions     ← 仅归档行：取消归档按钮
 * └─ span.dsh-search-result-meta
 *     ├─ span.dsh-search-result-workspace
 *     └─ span.dsh-search-result-snippet
 * ```
 *
 * @param {object} [options]
 * @param {object} [options.result] `SearchResultNode`
 * @param {string} [options.currentId]
 * @param {object} [options.labels]
 * @param {Function} [options.onOpen]
 * @param {Function} [options.onUnarchive]
 * @returns {{root: HTMLElement, update(data: object): void}}
 */
function createSearchResultRow(options = {}) {
  const {
    result: initialResult = { id: '', title: '', workspace: '', running: false, runningSubagentCount: 0, completed: false, archived: false },
    currentId,
    labels,
    onOpen = () => {},
    onUnarchive = () => {},
  } = options;
  const t = makeT(labels);

  let result = initialResult;
  let current = currentId;

  const root = el('div', C.searchResultRow);
  root.setAttribute('role', 'treeitem');

  const heading = el('span', C.searchResultHeading);
  const slot = el('span', C.slot);
  const title = el('span', C.searchResultTitle);
  const actions = el('span', C.rowActions);
  const unarchiveButton = el('button', C.rowIconButton);
  unarchiveButton.type = 'button';
  unarchiveButton.appendChild(icon('IconUnarchiveOutlineRegular', { size: 14 }));
  actions.appendChild(unarchiveButton);
  heading.append(slot, title, actions);

  const meta = el('span', C.searchResultMeta);
  const workspace = el('span', C.searchResultWorkspace);
  const snippet = el('span', C.searchResultSnippet);
  meta.append(workspace, snippet);

  root.append(heading, meta);

  root.addEventListener('click', () => { onOpen(result.id); });
  unarchiveButton.addEventListener('click', (event) => {
    event.stopPropagation();
    onUnarchive(result.id);
  });

  function sync() {
    const selected = result.id === current;
    root.classList.toggle(C.selected, selected);
    root.classList.toggle(C.archived, Boolean(result.archived));
    root.setAttribute('aria-selected', String(selected));
    if (result.archived) root.setAttribute('aria-description', t('toast.archivedNotOpenable'));
    else root.removeAttribute('aria-description');

    // Like session rows, the leading slot owns every row marker; on
    // archived rows it stays blank — the grayed row carries the
    // archived look.
    const statuses = sessionStatuses(result, t);
    slot.replaceChildren();
    if (!result.archived && statuses[0].state !== 'idle') {
      slot.appendChild(statuses[0].state === 'ongoing' ? stateSpinner(14) : stateDot(statuses[0].state));
      for (const status of statuses) slot.appendChild(el('span', C.visuallyHidden, status.label));
    }

    title.textContent = result.title || t('session.untitled');
    workspace.textContent = result.workspace || t('group.ungrouped');
    snippet.textContent = result.snippet ?? '';

    actions.hidden = !result.archived;
    unarchiveButton.setAttribute('aria-label', t('menu.unarchiveSession'));
    unarchiveButton.title = t('actions.unarchive');
  }

  sync();

  return {
    root,
    /** @param {object} data `{ result, currentId }` */
    update(data = {}) {
      if (data.result !== undefined) result = data.result;
      if (data.currentId !== undefined) current = data.currentId;
      sync();
    },
    result: () => result,
  };
}

/**
 * 建**空列表占位**（`EmptySessions`，`WorkspaceBrowser.tsx:264-278`）。
 * @returns {{root: HTMLElement, update(data: object): void}}
 */
function createEmptySessions(options = {}) {
  const { rowState = { archivedFilter: 'default' }, labels, onLeaveArchivedOnly = () => {} } = options;
  const t = makeT(labels);
  let state = rowState;
  let filter = state.archivedFilter;

  const root = el('div', C.emptyState);
  root.dataset.rowKey = 'empty';
  const glyph = el('span');
  const text = el('div');
  const action = el('button', C.emptyAction);
  action.type = 'button';
  root.append(glyph, text, action);
  action.addEventListener('click', () => { onLeaveArchivedOnly(); });

  function sync() {
    const archivedOnly = filter === 'only';
    glyph.replaceChildren(icon(archivedOnly ? 'IconArchiveOutlineRegular' : 'IconQueueOutlineRegular', { size: 24 }));
    text.textContent = archivedOnly ? t('empty.noneArchived') : t('empty.none');
    action.hidden = !archivedOnly;
    action.textContent = t('empty.viewOthers');
  }

  sync();

  return {
    root,
    /** @param {object} data `{ rowState }` */
    update(data = {}) {
      if (data.rowState !== undefined) state = data.rowState;
      filter = state.archivedFilter;
      sync();
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5. AnimatedRows —— 对照 `AnimatedRows.tsx`
 *    源码是**唯一的 class 组件**：`getSnapshotBeforeUpdate` 记位置，
 *    `componentDidUpdate` 做 FLIP + 进出淡出，`componentWillUnmount` 清场。
 *    这里把同样的四步暴露成 `capture()` / `commit()` / `clear()`。
 *
 *    ⚠️ `list.animate` 在 jsdom 里不存在 —— 源码也显式判了
 *    `typeof list.animate !== 'function'` 并直接返回 null（`AnimatedRows.tsx:56`），
 *    原生版沿用同一判断，所以 jsdom 下**不会**产生动画，但 DOM 结构完全一致。
 * ══════════════════════════════════════════════════════════════════════════ */

const ROW_FADE_MS = 100;
const ROW_GLIDE_MS = 200;

/**
 * `AnimatedRows`（`AnimatedRows.tsx:45-183`）。
 *
 * DOM：`div.dsh-browser-list`（`role="tree"`）+ `div.dsh-rows-exits[aria-hidden]`
 * 作为兄弟节点 —— 退出克隆的覆盖层靠**父级定位**（`.dsh-browser-tree-body`
 * 是 `position: relative`），所以两个节点必须是同一个 positioned 父级的子节点。
 *
 * @param {object} [options]
 * @param {string} [options.className] list 的附加类（`css.list` / `css.list.flatList`）
 * @param {string} [options.label] `aria-label`
 * @param {boolean} [options.ready] `list.phase === 'ready' && workspaceReady && !nativeDragActive`
 * @param {string} [options.resetKey] 视图替换 / 展开隐藏行时立即落定
 * @returns {{list: HTMLElement, overlay: HTMLElement, setRowKeys(keys: string[]): void, capture(): object|null, commit(snapshot: object|null): void, clear(): void, arm(): void}}
 */
function createAnimatedRows(options = {}) {
  const {
    className = C.list,
    label = '',
    ready: initialReady = true,
    resetKey: initialResetKey = '',
  } = options;

  let armed = false;
  let ready = initialReady;
  let resetKey = initialResetKey;
  let rowKeys = [];
  const movements = new Map();
  const exits = new Map();

  const list = el('div', className);
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', label);
  const overlay = el('div', C.exits);
  overlay.setAttribute('aria-hidden', 'true');

  list.addEventListener('pointerdown', () => { armed = true; }, true);
  list.addEventListener('keydown', () => { armed = true; }, true);

  /** `AnimatedRows.tsx:30-33` `sameRows`。 */
  function sameRows(previousKeys, nextKeys) {
    return previousKeys.length === nextKeys.length && previousKeys.every((key, i) => key === nextKeys[i]);
  }

  /** `AnimatedRows.tsx:130-138` `readPositions`。 */
  function readPositions() {
    const positions = new Map();
    for (const element of list.querySelectorAll('[data-row-key]')) {
      positions.set(element.dataset.rowKey, {
        element,
        rect: element.getBoundingClientRect(),
        opacity: movements.has(element) ? Number(getComputedStyle(element).opacity) : 1,
      });
    }
    return positions;
  }

  /** `AnimatedRows.tsx:154-161` `removeExit`。 */
  function removeExit(key) {
    const exit = exits.get(key);
    if (exit === undefined) return;
    exit.animation.onfinish = null;
    exit.animation.cancel();
    exit.element.remove();
    exits.delete(key);
  }

  /** `AnimatedRows.tsx:146-152` `cancelMovements`。 */
  function cancelMovements() {
    for (const animation of movements.values()) {
      animation.onfinish = null;
      animation.cancel();
    }
    movements.clear();
  }

  /** `AnimatedRows.tsx:163-166` `clear`。 */
  function clear() {
    cancelMovements();
    for (const key of [...exits.keys()]) removeExit(key);
  }

  /** `AnimatedRows.tsx:140-144` `move`。 */
  function move(element, keyframes, duration) {
    const animation = element.animate(keyframes, { duration, easing: 'ease-out' });
    movements.set(element, animation);
    animation.onfinish = () => { movements.delete(element); animation.cancel(); };
  }

  return {
    list,
    overlay,
    /** 记录下这一步要渲染的 key 序列（对应 `rowKeys` prop）。 */
    setRowKeys(keys, nextResetKey) {
      rowKeys = [...keys];
      if (nextResetKey !== undefined) resetKey = nextResetKey;
    },
    get rowKeys() { return rowKeys; },
    /** `onPointerDownCapture` / `onKeyDownCapture` 的等价物。 */
    arm() { armed = true; },
    /** `getSnapshotBeforeUpdate`（`AnimatedRows.tsx:52-74`）。 */
    capture() {
      if (!armed || !ready || list === null
        || typeof list.animate !== 'function'
        || (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return null;
      const viewport = list.getBoundingClientRect();
      const positions = readPositions();
      const nextKeys = new Set(rowKeys);
      const removed = new Map();
      for (const [key, row] of positions) {
        if (nextKeys.has(key) || !intersects(row.rect, viewport)) continue;
        const clone = row.element.cloneNode(true);
        clone.removeAttribute('data-row-key');
        if ('inert' in clone) clone.inert = true;
        clone.style.setProperty(
          '--dsh-workspace-indent',
          getComputedStyle(row.element).getPropertyValue('--dsh-workspace-indent'),
        );
        removed.set(key, { ...row, element: clone });
      }
      return { positions, removed, rowKeys: [...rowKeys], resetKey, ready };
    },
    /**
     * `componentDidUpdate`（`AnimatedRows.tsx:76-124`）。
     * @param {object|null} snapshot `capture()` 的返回值
     * @param {{rowKeys: string[], resetKey?: string, ready?: boolean}} next 本次渲染后的状态
     */
    commit(snapshot, next = {}) {
      const nextKeys = next.rowKeys ?? rowKeys;
      const nextReset = next.resetKey ?? resetKey;
      const nextReady = next.ready ?? ready;
      const changed = !sameRows(snapshot?.rowKeys ?? [], nextKeys)
        || (snapshot?.resetKey ?? '') !== nextReset || (snapshot?.ready ?? true) !== nextReady;
      if (snapshot === null) {
        if (changed) clear();
        ready = nextReady;
        return;
      }
      cancelMovements();
      const viewport = list.getBoundingClientRect();
      const origin = overlay.getBoundingClientRect();
      const positions = readPositions();

      for (const [key, row] of positions) {
        removeExit(key);
        const previousRow = snapshot.positions.get(key);
        if (!intersects(row.rect, viewport)
          && (previousRow === undefined || !intersects(previousRow.rect, viewport))) continue;
        if (previousRow === undefined) {
          move(row.element, [{ opacity: 0 }, { opacity: 1 }], ROW_FADE_MS);
          continue;
        }
        const dx = previousRow.rect.left - row.rect.left;
        const dy = previousRow.rect.top - row.rect.top;
        if (dx === 0 && dy === 0 && previousRow.opacity === 1) continue;
        move(row.element, [
          { transform: `translate(${String(dx)}px, ${String(dy)}px)`, opacity: previousRow.opacity },
          { transform: 'translate(0, 0)', opacity: 1 },
        ], ROW_GLIDE_MS);
      }

      for (const [key, row] of snapshot.removed) {
        const { element } = row;
        removeExit(key);
        Object.assign(element.style, {
          position: 'absolute', margin: '0', transform: 'none', boxSizing: 'border-box',
          left: `${String(row.rect.left - origin.left)}px`,
          top: `${String(row.rect.top - origin.top)}px`,
          width: `${String(row.rect.width)}px`, height: `${String(row.rect.height)}px`,
        });
        overlay.append(element);
        const animation = element.animate([{ opacity: row.opacity }, { opacity: 0 }], {
          duration: ROW_FADE_MS, easing: 'ease-out', fill: 'forwards',
        });
        exits.set(key, { element, animation });
        animation.onfinish = () => { removeExit(key); };
      }
      ready = nextReady;
      resetKey = nextReset;
      rowKeys = [...nextKeys];
    },
    clear,
  };
}

/** `AnimatedRows.tsx:35-38` `intersects`。 */
function intersects(row, viewport) {
  return row.bottom > viewport.top && row.top < viewport.bottom
    && row.right > viewport.left && row.left < viewport.right;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6. WorkspaceBrowser —— 对照 `WorkspaceBrowser.tsx`
 * ══════════════════════════════════════════════════════════════════════════ */

/** `WorkspaceBrowser.tsx:55` `COLLAPSED_SESSION_LIMIT`。 */
const COLLAPSED_SESSION_LIMIT = 5;

/** `WorkspaceBrowser.tsx:58-70` `collapsedSessionRows`。 */
function collapsedSessionRows(sessions, limit = COLLAPSED_SESSION_LIMIT) {
  let idleCount = 0;
  const rows = sessions.filter((session) => {
    if (session.blank || session.running || session.runningSubagentCount > 0) return true;
    if (idleCount >= limit) return false;
    idleCount += 1;
    return true;
  });
  return { rows, hiddenCount: sessions.length - rows.length };
}

/** `WorkspaceBrowser.tsx:53` `SEARCH_QUERY_MAX_CODE_UNITS`。 */
const SEARCH_QUERY_MAX_CODE_UNITS = 500;

/** `WorkspaceBrowser.tsx:73-81` `sanitizeSearchQuery`。 */
function sanitizeSearchQuery(value) {
  const withoutNul = value.replaceAll('\0', '');
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul;
  let end = SEARCH_QUERY_MAX_CODE_UNITS;
  const last = withoutNul.charCodeAt(end - 1);
  const next = withoutNul.charCodeAt(end);
  if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end -= 1;
  return withoutNul.slice(0, end);
}

/**
 * 建**左侧历史会话区**（`WorkspaceBrowser`，`WorkspaceBrowser.tsx:836-1487`）。
 *
 * DOM（宽态 · 分组树模式）：
 * ```
 * div.dsh-browser-root(.dsh-browser-rail)
 * ├─ div.dsh-browser-section-header
 * │   ├─ span.dsh-browser-section-label(.dsh-browser-wide .…-hidden)
 * │   ├─ div.dsh-browser-search-slot(.…-expanded)
 * │   │   └─ div.dsh-browser-search(.…-expanded)
 * │   │       ├─ button.dsh-browser-search-button[aria-label][aria-expanded]
 * │   │       ├─ input.dsh-browser-search-input[type=text][maxlength=500]
 * │   │       └─ button.dsh-browser-clear-button   ← 约定 ①：常驻，靠 hidden 切
 * │   ├─ div.dsh-browser-header-actions(.…-hidden)
 * │   │   ├─ button.dsh-browser-icon-button (IconSlidersTwoOutlineRegular)
 * │   │   └─ button.dsh-browser-icon-button (IconProjectAddOutlineRegular)
 * │   └─ div[data-slot="sidebar.workspaces.directoryFlow"]
 * ├─ div.dsh-browser-search   ← rail 态：独立的 36px 搜索按钮
 * ├─ div.dsh-browser-list-area
 * │   └─ div.dsh-browser-tree-body(.dsh-browser-wide)
 * │       ├─ span.dsh-browser-list-top-drop-indicator[aria-hidden]
 * │       ├─ div.dsh-browser-list[role="tree"]        ← AnimatedRows.list
 * │       ├─ div.dsh-rows-exits[aria-hidden="true"]   ← AnimatedRows.overlay
 * │       └─ span.dsh-browser-fade
 * └─ (脚部 slot 座)
 * ```
 *
 * @param {object} [options]
 * @param {object} [options.data] 见文件头的数据形状
 * @param {boolean} [options.wide]
 * @param {object} [options.labels]
 * @returns {{root: HTMLElement, update(data: object): void, ...}}
 */
function createWorkspaceBrowser(options = {}) {
  const {
    data: initialData = [],
    wide: initialWide = true,
    labels,
    onOpen = () => {},
    onRenameRequest = () => {},
    onDeleteRequest = () => {},
  } = options;
  const t = makeT(labels);

  let wide = Boolean(initialWide);
  let sections = normalizeSections(initialData);
  let query = '';
  let searchExpanded = false;
  /** 每个分组的「已展开多少条 idle 行」（`sessionLimits`，默认 5）。 */
  const sessionLimits = new Map();
  /**
   * 展开态是**浏览器本地状态**（源码在 store 里）。这里放在组件内部：
   * 重渲染不能丢展开态 —— 与 `useStore(s => s.groupExpansion)` 等价。
   */
  const groupExpanded = new Map();

  const root = el('div', C.browserRoot);
  if (!wide) root.classList.add(C.browserRail);

  /* ── section header ────────────────────────────────────────────────── */
  const sectionHeader = el('div', C.sectionHeader);
  const sectionLabel = el('span', `${C.sectionLabel} ${C.browserWide}`);

  const searchSlot = el('div', C.searchSlot);
  const search = el('div', C.browserSearch);
  const searchButton = el('button', C.searchButton);
  searchButton.type = 'button';
  searchButton.setAttribute('aria-expanded', 'false');
  const searchIcon = icon('IconSearchOutlineRegular', { size: 14 });
  searchButton.appendChild(searchIcon);
  const searchInput = el('input', C.searchInput);
  searchInput.type = 'text';
  searchInput.maxLength = SEARCH_QUERY_MAX_CODE_UNITS;
  searchInput.placeholder = t('search.placeholder');
  searchInput.tabIndex = -1;
  const clearButton = el('button', C.clearButton);
  clearButton.type = 'button';
  clearButton.hidden = true;
  clearButton.setAttribute('aria-label', t('search.clear'));
  clearButton.appendChild(icon('IconCloseFillRegular'));
  search.append(searchButton, searchInput, clearButton);
  searchSlot.appendChild(search);

  const headerActions = el('div', C.headerActions);
  const viewOptionsButton = el('button', C.browserIconButton);
  viewOptionsButton.type = 'button';
  viewOptionsButton.appendChild(icon('IconSlidersTwoOutlineRegular'));
  const addWorkspaceButton = el('button', C.browserIconButton);
  addWorkspaceButton.type = 'button';
  addWorkspaceButton.appendChild(icon('IconProjectAddOutlineRegular'));
  headerActions.append(viewOptionsButton, addWorkspaceButton);

  const directoryFlowSlot = slotMark('sidebar.workspaces.directoryFlow');

  sectionHeader.append(sectionLabel, searchSlot, headerActions, directoryFlowSlot);

  /* ── rail 态的独立搜索按钮 ─────────────────────────────────────────── */
  const railSearch = el('div', C.browserSearch);
  const railSearchButton = el('button', C.searchButton);
  railSearchButton.type = 'button';
  railSearchButton.appendChild(icon('IconSearchOutlineRegular', { size: 18 }));
  railSearch.appendChild(railSearchButton);
  railSearch.hidden = true;

  /* ── list area ─────────────────────────────────────────────────────── */
  const listArea = el('div', C.listArea);
  const treeBody = el('div', `${C.treeBody} ${C.browserWide}`);
  const topDropIndicator = el('span', C.listTopDropIndicator);
  topDropIndicator.setAttribute('aria-hidden', 'true');
  topDropIndicator.hidden = true;

  const animated = createAnimatedRows({ className: C.list });

  const fade = el('span', C.fade);
  treeBody.append(topDropIndicator, animated.list, animated.overlay, fade);
  listArea.appendChild(treeBody);

  /* ── 脚部（`sidebar.settings` / `sidebar.footer.action` 的座） ───────── */
  const footerActions = el('div', C.footerActions);
  const settingsArea = el('div', C.settingsArea);
  const footerSlot = slotMark('sidebar.footer.action');
  const settingsSlot = slotMark('sidebar.settings');
  footerActions.appendChild(footerSlot);
  settingsArea.appendChild(settingsSlot);

  root.append(sectionHeader, railSearch, listArea, footerActions, settingsArea);

  /* ── 行的池子：key → handle（**不重建节点**的唯一机制**） ─────────── */
  const projectRows = new Map();
  const sessionRows = new Map();
  const overflowButtons = new Map();
  const groupSections = new Map();
  let emptyHandle = null;

  /** 分组行的 `drag` 句柄（拖拽行为本身没抄，见存疑清单第 4 条）。 */
  const noDrag = null;

  /**
   * `div.dsh-browser-group-section[style="--dsh-workspace-indent: {depth*12}px"]`
   * （`WorkspaceBrowser.tsx:456-495`）。这个外框**必须**存在：
   *   · `.dsh-browser-group-section + .dsh-browser-group-section { margin-top: 4px }`
   *     —— 组间距靠它，删了组之间就贴在一起；
   *   · `.dsh-browser-workspace-drop-before::before` 的绝对定位参照它。
   * @param {object} group
   * @param {number} depth
   * @returns {{root: HTMLElement, header: HTMLElement, children: HTMLElement|null, sessionsHost: HTMLElement}}
   */
  function handleGroupSection(group, depth) {
    let entry = groupSections.get(group.key);
    if (entry === undefined) {
      const root = el('div', C.groupSection);
      const headerHost = el('div');
      headerHost.style.display = 'contents';
      // 子工作区座（`{childRows.length > 0 && <div role="group">}`）——
      // ⚠️ 约定 ①：节点常驻，用 hidden 切显示（`role="group"` 是 ARIA 契约，
      //    删了会让读屏软件把子工作区读成父级的兄弟）。
      const children = el('div');
      children.setAttribute('role', 'group');
      const sessionsHost = el('div');
      sessionsHost.style.display = 'contents';
      root.append(headerHost, children, sessionsHost);
      entry = { root, header: headerHost, children, sessionsHost };
      groupSections.set(group.key, entry);
    }
    // `style={{ '--dsh-workspace-indent': `${depth * 12}px` }}`（WorkspaceBrowser.tsx:462）
    entry.root.style.setProperty('--dsh-workspace-indent', `${depth * 12}px`);
    entry.root.classList.toggle(C.workspaceDropBefore, group.marker === 'before');
    entry.root.classList.toggle(C.workspaceDropAfter, group.marker === 'after');
    return entry;
  }

  function handleProjectRow(group, ancestor) {
    let handle = projectRows.get(group.key);
    if (handle === undefined) {
      handle = createProjectRow({
        group,
        containsCurrentDescendant: ancestor,
        labels,
        onToggle: () => {
          groupExpanded.set(group.key, !(groupExpanded.get(group.key) ?? group.expanded));
          render();
        },
        onCreate: () => {},
      });
      projectRows.set(group.key, handle);
    } else {
      handle.update({ group, containsCurrentDescendant: ancestor, drag: noDrag });
    }
    return handle.root;
  }

  function handleSessionRow(node) {
    let handle = sessionRows.get(node.id);
    if (handle === undefined) {
      handle = createSessionRow({ node, currentId: currentId(), now: Date.now(), labels, onOpen, onRenameRequest, onDeleteRequest });
      sessionRows.set(node.id, handle);
    } else {
      handle.update({ node, currentId: currentId(), now: Date.now() });
    }
    return handle.root;
  }

  function handleOverflowButton(group, visible, collapsed) {
    let handle = overflowButtons.get(group.key);
    if (handle === undefined) {
      const button = el('button', C.sessionOverflowButton);
      button.type = 'button';
      button.dataset.rowKey = `overflow:${group.key}`;
      button.dataset.rowGap = 'overflow';
      button.addEventListener('click', () => {
        const sessionsExpanded = collapsedSessionRows(group.sessions, sessionLimits.get(group.key)).hiddenCount === 0;
        sessionLimits.set(group.key, sessionsExpanded
          ? COLLAPSED_SESSION_LIMIT
          : visible.hiddenCount <= COLLAPSED_SESSION_LIMIT
            ? Infinity
            : (sessionLimits.get(group.key) ?? COLLAPSED_SESSION_LIMIT) + COLLAPSED_SESSION_LIMIT);
        render();
      });
      handle = { root: button };
      overflowButtons.set(group.key, handle);
    }
    const sessionsExpanded = visible.hiddenCount === 0;
    handle.root.setAttribute('aria-expanded', String(sessionsExpanded));
    handle.root.textContent = sessionsExpanded
      ? t('sessions.collapse')
      : t('sessions.expand', { n: visible.hiddenCount });
    return handle.root;
  }

  function handleEmpty(rowState) {
    if (emptyHandle === null) {
      emptyHandle = createEmptySessions({
        rowState,
        labels,
        onLeaveArchivedOnly: () => {},
      });
    } else {
      emptyHandle.update({ rowState });
    }
    return emptyHandle.root;
  }

  /**
   * `WorkspaceBrowser.tsx:911-915`：当前会话 id = `mainView` 的占用者。
   * 这里对应数据里的 `item.selected`。
   */
  function currentId() {
    for (const section of sections) {
      for (const item of section.items) if (item.selected) return item.id;
    }
    return undefined;
  }

  /** 一个分组是否展开（用户的 toggle 优先于数据里的 `expanded`）。 */
  function isExpanded(section) {
    const local = groupExpanded.get(section.id);
    if (local !== undefined) return local;
    return section.expanded !== false;
  }

  /**
   * **推进一次渲染**。只动变化的部分：
   * 行节点按 `data-row-key` 复用（`sessionRows` / `projectRows` 池），
   * 只更新 `textContent` / class / 属性，绝不整段 `replaceChildren`。
   */
  function render() {
    // 1. 壳状态
    root.classList.toggle(C.browserRail, !wide);
    sectionHeader.hidden = !wide;
    sectionLabel.hidden = !wide;
    searchSlot.hidden = !wide;
    clearButton.hidden = !searchExpanded;
    searchSlot.classList.toggle(C.searchSlotExpanded, searchExpanded);
    search.classList.toggle(C.searchExpanded, searchExpanded);
    searchButton.setAttribute('aria-expanded', String(searchExpanded));
    headerActions.hidden = !wide;
    headerActions.classList.toggle(C.headerActionsHidden, wide && searchExpanded);
    sectionLabel.classList.toggle(C.sectionLabelHidden, searchExpanded);
    sectionLabel.textContent = t('section.sessions');
    railSearch.hidden = wide;
    searchInput.tabIndex = searchExpanded ? 0 : -1;

    // 2. 派生（走的是 tree.ts 的那套规则，不是这里另写一遍）
    const { groups, rowState } = derive();

    // 3. 行 + 行键（每组的 children 是 `div.dsh-browser-group-section`）
    const rowKeys = [];
    const built = [];
    /** 这一轮真正在 DOM 里的行（分组段内部的也算）—— 见下面的 retire。 */
    const liveRows = new Set();
    if (groups.length === 0) {
      const empty = handleEmpty(rowState);
      empty.dataset.rowGap = 'empty';
      built.push(empty);
      liveRows.add(empty);
      rowKeys.push('empty');
    }
    for (const group of groups) {
      const section = handleGroupSection(group, 0);
      // 分组头装进 `header` 座（`{headerHost}`）—— 源里 header 是 section 的
      // 直接子节点；这里多一层 `display: contents` 的座，好让"头 / 子工作区 /
      // 会话行"三段的顺序像源里那样固定，而不用每次重排。
      const groupRows = [];
      const headerRow = handleProjectRow(group, currentAncestors.has(group.key));
      section.header.replaceChildren(headerRow);
      liveRows.add(headerRow);
      rowKeys.push(`workspace:${group.key}`);

      // `{childRows.length > 0 && <div role="group">{childRows}</div>}` ——
      // 这里没有嵌套工作区（`nestWorkspaces === false`），组常驻且 hidden。
      section.children.hidden = true;

      const collapsed = collapsedSessionRows(group.sessions);
      const visible = collapsedSessionRows(group.sessions, sessionLimits.get(group.key));
      for (const node of visible.rows) {
        groupRows.push(handleSessionRow(node));
        rowKeys.push(`session:${node.id}`);
      }
      if (collapsed.hiddenCount > 0) {
        groupRows.push(handleOverflowButton(group, visible, collapsed));
        rowKeys.push(`overflow:${group.key}`);
      }
      // 组内顺序恒定（没有拖拽），只在长度变化时动一次。
      if (section.sessionsHost.childNodes.length !== groupRows.length
        || groupRows.some((node, i) => section.sessionsHost.childNodes[i] !== node)) {
        reconcileChildren(section.sessionsHost, groupRows);
      }
      for (const row of groupRows) liveRows.add(row);
      built.push(section.root);
    }

    // 4. 顺序对齐 —— 用 insertBefore 复用已有节点，不整段重挂。
    const resetKey = JSON.stringify([query, [...sessionLimits]]);
    animated.setRowKeys(rowKeys, resetKey);
    const snapshot = animated.capture();
    reconcileChildren(animated.list, built);
    animated.commit(snapshot, { rowKeys, resetKey });

    // 5. 这一轮没出现的组 / 行从池子里退休（对应 React 的 key 淘汰）。
    //    ⚠️ 存活的判定要连**嵌套在分组段里的行**一起算 —— 只比 `built`
    //    会把每一行都当成"这轮没出现"，于是刚建好就被 remove 掉。
    const live = new Set([...built, ...liveRows]);
    for (const [key, entry] of [...groupSections]) {
      if (built.includes(entry.root)) continue;
      entry.root.remove();
      groupSections.delete(key);
    }
    retire(projectRows, live, handle => handle.root);
    retire(sessionRows, live, handle => handle.root);
    retire(overflowButtons, live, handle => handle.root);
  }

  /** 当前展开的祖先集合（`WorkspaceBrowser.tsx:324-330` 的 `currentAncestors`；这里没有嵌套，恒为空）。 */
  const currentAncestors = new Set();

  /**
   * 走一遍真实派生：`normalizeSections` → `list` / `workspaces` / `rowState`
   * → `deriveGroups`。缓存命中时 `deriveGroups` 返回上一次的**同一个数组**。
   */
  function derive() {
    const signature = signatureOf(sections);
    if (cache.signature !== signature) {
      cache.signature = signature;
      cache.sections = sections;
      cache.list = buildList(sections);
      cache.rowState = buildRowState(sections);
      cache.statuses = new Map();
      // `currentBlank`（`WorkspaceBrowser.tsx:911-915`）：当前主视图里的那个
      // 空白会话 = 数据里的 `item.selected && item.blank`。
      cache.currentBlank = currentBlankId(sections);
      // ⚠️ 顺序投影必须在 `deriveGroups` 之前（见 {@link projectSessionOrder}）。
      cache.workspaces = projectSessionOrder(buildWorkspaces(sections), cache.list, {
        orderBy: 'updated',
        rowState: cache.rowState,
        currentBlank: cache.currentBlank,
      });
    }
    const expandedGroups = sections.filter(isExpanded).map(section => section.id);
    const view = { expandedGroups, ungroupedOrder: undefined };
    // ⚠️ `view` 每次新建，但记忆器按**内容**比依赖（见 sameDeriveInputs），
    //    所以内容没变时返回引用相等的那棵树 —— 这正是 React `useMemo` 的效果。
    const groups = memoizedDeriveGroups(cache.list, cache.workspaces, cache.rowState, cache.statuses, view);
    return { groups, rowState: cache.rowState };
  }

  const cache = { signature: undefined };
  /** 本实例独占的 `deriveGroups` 记忆器（约定 ③）。 */
  const memoizedDeriveGroups = createMemoizedDeriveGroups();

  /** 把 `built` 顺序对齐到 list 的子节点上，复用已有节点。 */
  function reconcileChildren(parent, nodes) {
    let index = 0;
    for (const node of nodes) {
      const current = parent.childNodes[index];
      if (current !== node) parent.insertBefore(node, current ?? null);
      index += 1;
    }
    while (parent.childNodes.length > nodes.length) parent.removeChild(parent.lastChild);
  }

  /** 把这一轮没出现的行移出 DOM 并丢掉句柄（对应 React 的 key 淘汰）。 */
  function retire(pool, live, pick) {
    for (const [key, handle] of [...pool]) {
      if (live.has(pick(handle))) continue;
      handle.root.remove();
      if (typeof handle.dispose === 'function') handle.dispose();
      pool.delete(key);
    }
  }

  render();

  return {
    root,
    /**
     * 只改变化的部分。
     * @param {object} data `{ sections, wide, query }`（都可选）
     */
    update(data = {}) {
      if (data.sections !== undefined) sections = normalizeSections(data);
      if (data.wide !== undefined) wide = Boolean(data.wide);
      if (data.query !== undefined) searchInput.value = sanitizeSearchQuery(data.query);
      query = searchInput.value;
      render();
    },
    /**
     * 当前派生出的分组树。⚠️ 引用相等就代表"依赖没变、没重算"——
     * 这是约定 ③ 的可观测面，测试会直接断言它。
     * @returns {Array}
     */
    groups() {
      return derive().groups;
    },
    sections: () => sections,
    list: () => animated.list,
    overlay: () => animated.overlay,
    rowKeys: () => [...animated.rowKeys],
    currentId,
    setSearchExpanded(value) {
      searchExpanded = Boolean(value);
      render();
    },
    searchInput: () => searchInput,
    /** 找一行的根节点（测试 / 接线用）。 */
    row(key) {
      return animated.list.querySelector(`[data-row-key="${key}"]`);
    },
  };
}

/**
 * 把 `{ sections }` 归一化成内部的分组数组（不读任何外部数据源）。
 *
 * ⚠️ 入参既可以是 `{ sections: [...] }`（`update()` 的形式），也可以是
 * 裸数组（构造时 `browserOptions` 的形式）—— 两种都接受，避免把
 * `{ sections: { sections: [...] } }` 这种一层套一层的写法带进来。
 * @param {object|Array} data
 * @returns {Array}
 */
function normalizeSections(data) {
  const raw = Array.isArray(data) ? data : (Array.isArray(data?.sections) ? data.sections : []);
  return raw.map((section, index) => ({
    id: section.id ?? String(index),
    title: section.title ?? '',
    path: section.path,
    createdAt: section.createdAt,
    expanded: section.expanded !== false,
    items: Array.isArray(section.items) ? section.items.map(item => ({ ...item })) : [],
  }));
}

/**
 * 内容指纹 —— 判断"这次 `update(data)` 的数据是不是真变了"。
 *
 * ⚠️ 约定 ③ 的第一道闸：`update()` 每次都会经 `normalizeSections` 造一批
 * **全新对象**；如果直接把这些对象喂给 `deriveGroups` 的依赖比较，
 * 每次都会判"变了"→ 整棵分组树重算 → 所有行对象重建。
 * 所以这里先按**内容**算指纹，指纹没变就复用上一批 `list` / `workspaces` /
 * `rowState`（它们引用稳定 → `deriveGroups` 的缓存命中 → 返回同一棵树）。
 * @param {Array} sections
 * @returns {string}
 */
function signatureOf(sections) {
  const parts = [];
  for (const section of sections) {
    parts.push(`${section.id}\u0001${section.title}\u0001${section.path ?? ''}\u0001${section.createdAt ?? ''}\u0001${section.expanded ? 1 : 0}`);
    for (const item of section.items) {
      parts.push([
        item.id, item.title ?? '', item.subtitle ?? '',
        item.updatedAt ?? 0, item.blank ? 1 : 0, item.running ? 1 : 0,
        item.runningSubagentCount ?? 0, item.completed ? 1 : 0,
        item.pinned ? 1 : 0, item.archived ? 1 : 0,
        item.selected ? 1 : 0, item.pendingInteraction ?? '',
      ].join('\u0002'));
    }
  }
  return parts.join('\u0003');
}

/**
 * 当前选中的空白会话 id（`WorkspaceBrowser.tsx:911-915` 的 `currentBlank`）。
 *
 * 源码里 `currentBlank` 取 `retainedBy.mainView > 0` 且 `blank === true` 的那个；
 * 这里对应数据里的 `item.selected && item.blank`。
 * @param {Array} sections
 * @returns {string|undefined}
 */
function currentBlankId(sections) {
  for (const section of sections) {
    for (const item of section.items) if (item.selected && item.blank) return item.id;
  }
  return undefined;
}

/**
 * 内部 session 摘要（`SessionListState` 的最简形：`{ ids, byId, projectionsBySession }`）。
 */
function buildList(sections) {
  const ids = [];
  const byId = {};
  for (const section of sections) {
    for (const item of section.items) {
      ids.push(item.id);
      byId[item.id] = {
        id: item.id,
        title: item.title ?? '',
        blank: Boolean(item.blank),
        running: Boolean(item.running),
        updatedAt: item.updatedAt ?? 0,
        // `retainedBy.mainView` 的占用者 = 当前选中行。
        retainedBy: { mainView: item.selected ? 1 : 0 },
      };
    }
  }
  return { ids, byId, projectionsBySession: {} };
}

/**
 * `orderedWorkspaces`（`WorkspaceBrowser.tsx:929-941`）：把每个工作区的
 * `sessionIds` 换成"账号内顺序"—— 近因降序，或手动顺序对账，
 * 再把当前空白会话提到最前。
 *
 * ⚠️ 这一步**必须**在 `deriveGroups` 之前做：`tree.ts:273-287` 的
 * `sectionMembers` 两个分区内部都"保持调用方传入的顺序不变"，
 * 不先排序的话组内顺序就永远是原始 sessionIds 顺序。
 * @param {Array} workspaces - `[{ workspaceId, sessionIds, ... }]`
 * @param {object} list - `{ byId }`
 * @param {object} options - `{ orderBy, sessionOrderByAccount, rowState, currentBlank }`
 * @returns {Array} 新数组（工作区对象是浅拷贝，不改入参）
 */
function projectSessionOrder(workspaces, list, { orderBy = 'updated', sessionOrderByAccount = {}, rowState, currentBlank } = {}) {
  return workspaces.map((workspace) => {
    const memberIds = workspace.sessionIds;
    const baseOrder = orderBy === 'updated'
      ? orderByRecency(memberIds, list.byId)
      : reconcileManualOrder(memberIds, sessionOrderByAccount[workspace.workspaceId], list.byId, rowState);
    return {
      ...workspace,
      sessionIds: pinCurrentBlank(
        baseOrder,
        currentBlank !== undefined && memberIds.includes(currentBlank) ? currentBlank : undefined,
      ),
    };
  });
}

/**
 * 散落会话（不在任何工作区里）的账号内顺序
 * （`WorkspaceBrowser.tsx:942-950` 的 `orderedUngroupedSessionIds`）。
 * @param {Array} memberIds - `list.ids` 里没有被任何工作区认领的那些
 * @param {object} list - `{ byId }`
 * @param {object} options 同 {@link projectSessionOrder}
 * @returns {Array}
 */
function projectUngroupedOrder(memberIds, list, { orderBy = 'updated', sessionOrderByAccount = {}, rowState, currentBlank } = {}) {
  const baseOrder = orderBy === 'updated'
    ? orderByRecency(memberIds, list.byId)
    : reconcileManualOrder(memberIds, sessionOrderByAccount[UNGROUPED_KEY], list.byId, rowState);
  return pinCurrentBlank(
    baseOrder,
    currentBlank !== undefined && memberIds.includes(currentBlank) ? currentBlank : undefined,
  );
}

/** 内部 `WorkspaceView` 投影：每个 section 就是一个工作区。 */
function buildWorkspaces(sections) {
  return sections.map(section => ({
    workspaceId: section.id,
    path: section.path ?? section.id,
    title: section.title ?? '',
    createdAt: section.createdAt ?? new Date(0).toISOString(),
    sessionIds: section.items.map(item => item.id),
  }));
}

/**
 * `rowState`（`{ pinnedSessionIds, archivedSessionIds, archivedFilter }`）。
 *
 * ⚠️ `archivedFilter` 这里固定用 `'show'`（= 视图选项里的 "All sessions"）：
 * 目标项目的数据源里就有归档行，而 `'default'` 会把它们整批藏掉，
 * 看不出抄得对不对。这是**接线时该由调用方决定的一项**，见回复"语义改动"第 6 条。
 * @param {Array} sections
 * @returns {object}
 */
function buildRowState(sections) {
  const pinnedSessionIds = [];
  const archivedSessionIds = [];
  for (const section of sections) {
    for (const item of section.items) {
      if (item.pinned) pinnedSessionIds.push(item.id);
      if (item.archived) archivedSessionIds.push(item.id);
    }
  }
  return { pinnedSessionIds, archivedSessionIds, archivedFilter: 'show' };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7. SidebarRoot —— 对照 `SidebarRoot.tsx`
 * ══════════════════════════════════════════════════════════════════════════ */

/** `SidebarRoot.tsx:31` `COLLAPSE_SETTLE_MS`。 */
const COLLAPSE_SETTLE_MS = 150;

/**
 * 建**侧栏外壳**（`SidebarRoot`，`SidebarRoot.tsx:88-315`）。
 *
 * @param {object} [options]
 * @param {boolean} [options.collapsed]
 * @param {Array} [options.panels] `[{ id, label }]` 全局面板行
 * @param {object} [options.labels]
 * @param {object} [options.browserOptions] 透传给 `createWorkspaceBrowser`
 * @param {Function} [options.onToggleSidebar]
 * @param {Function} [options.onStartSession]
 * @param {Function} [options.onSelectPanel]
 * @returns {{root: HTMLElement, update(data: object): void, browser: object, ...}}
 */
function createSidebarRoot(options = {}) {
  const {
    collapsed: initialCollapsed = false,
    panels: initialPanels = [],
    labels,
    browserOptions = {},
    onToggleSidebar = () => {},
    onStartSession = () => {},
    onSelectPanel = () => {},
  } = options;
  const t = makeT(labels);

  let collapsed = Boolean(initialCollapsed);
  let panels = [...initialPanels];
  /** Rail-in only crossfades a live collapse（`SidebarRoot.tsx:126`）。 */
  let everWide = !collapsed;
  let settled = collapsed;
  let settleTimer = null;
  let pointerInside = false;

  const root = el('div', C.sidebarRoot);

  /* ── top strip + logo row ──────────────────────────────────────────── */
  // macOS hiddenInset titlebar：条带与红绿灯同行（`SidebarRoot.tsx:215`）。
  // ⚠️ 约定 ①：**节点常驻**，用 `hidden` 切 —— 删了会让
  // `.dsh-sidebar-top-strip + .dsh-sidebar-logo-row { margin-top: -12px }`
  // 这条相邻兄弟规则失效，品牌行位置就错了。
  const topStrip = el('div', C.topStrip);
  topStrip.setAttribute('data-window-drag', '');
  const darwinDesktop = typeof document !== 'undefined'
    && document.documentElement.dataset.platform === 'darwin';
  topStrip.hidden = !darwinDesktop;

  const logoRow = el('div', C.logoRow);
  logoRow.setAttribute('data-window-drag', '');

  const toggle = el('button', `${C.sidebarIconButton} ${C.toggle}`);
  toggle.type = 'button';
  // Rail resting state is the whale mark; hovering swaps in the panel icon
  // （`SidebarRoot.tsx:178-197`）。⚠️ 这里只用**结构等价**的写法：源里
  // `{!wide && !windowsTitlebar && <span className={css.railMark}>…}` 在宽态是
  // 卸载的，但 CSS 在宽态**没有**隐藏 `.railMark`（只有 `.collapsed .toggle
  // .panelIcon { display: none }`），照搬"常驻 + hidden"会让 rail 图标在宽态
  // 的 toggle 里露出来。所以这一个节点保持源里的条件挂载语义。
  const railMark = el('span', C.railMark);
  railMark.setAttribute('aria-hidden', 'true');
  const brandMarkSlot = slotMark('sidebar.brand.mark');
  const brandMarkFallback = chainFallback('sidebar.brand.mark');
  /** 品牌标 = DSH 的 FishLogo（源码 `FishLogo.tsx` 的 path，原样取，未改一笔）。 */
  brandMarkFallback.root.appendChild(icon('FishLogoOutlineRegular', { size: 24 }));
  brandMarkSlot.appendChild(brandMarkFallback.root);
  railMark.appendChild(brandMarkSlot);
  const panelIcon = icon('IconPanelLeftOutlineRegular', { size: 16, className: C.panelIcon });
  const toggleBadgeSlot = slotMark('sidebar.toggle.badge');
  toggle.append(panelIcon, toggleBadgeSlot);
  toggle.addEventListener('click', () => { onToggleSidebar(); });

  topStrip.appendChild(toggle);

  const brand = el('button', `${C.brand} ${C.sidebarWide}`);
  brand.type = 'button';
  const brandIdentity = el('span', C.brandIdentity);
  brandIdentity.setAttribute('aria-hidden', 'true');
  const brandMark = el('span', C.brandMark);
  const brandMarkSlot2 = slotMark('sidebar.brand.mark');
  const brandMarkFallback2 = chainFallback('sidebar.brand.mark');
  brandMarkFallback2.root.appendChild(icon('IconNewChatOutlineRegular', { size: 24 }));
  brandMarkSlot2.appendChild(brandMarkFallback2.root);
  brandMark.appendChild(brandMarkSlot2);
  const brandName = el('span', C.brandName);
  const brandNameSlot = slotMark('sidebar.brand.name');
  const brandNameFallback = chainFallback('sidebar.brand.name');
  brandNameFallback.root.appendChild(el('span', C.fallbackBrandName, t('brand.localBuild')));
  brandNameSlot.appendChild(brandNameFallback.root);
  brandName.appendChild(brandNameSlot);
  brandIdentity.append(brandMark, brandName);
  brand.appendChild(brandIdentity);
  brand.addEventListener('click', () => { onStartSession(); });

  logoRow.append(brand, toggle);

  /* ── New Session ───────────────────────────────────────────────────── */
  const newSession = el('button', C.newSession);
  newSession.type = 'button';
  const labelMask = el('span', C.newSessionLabelMask);
  const content = el('span', C.newSessionContent);
  const newSessionGlyph = icon('IconNewChatOutlineMedium', { size: 14 });
  const newSessionLabel = el('span', `${C.newSessionLabel} ${C.sidebarWide}`, t('session.new'));
  content.append(newSessionGlyph, newSessionLabel);
  labelMask.appendChild(content);
  // 约定 ①：快捷键提示**常驻**，靠 `hidden` 切显示 ——
  // `.dsh-sidebar-new-session-label-mask:has(+ .dsh-sidebar-new-session-shortcut)`
  // 这条 `:has()` 规则依赖它在 DOM 里，删了遮罩就不生效。
  const shortcut = el('span', C.newSessionShortcut);
  shortcut.setAttribute('aria-hidden', 'true');
  newSession.append(labelMask, shortcut);
  newSession.addEventListener('click', () => { onStartSession(); });

  /* ── panel list ────────────────────────────────────────────────────── */
  const panelList = el('nav', C.panelList);
  panelList.setAttribute('aria-label', t('panels.label'));
  const panelRows = new Map();

  function handlePanelRow(panel) {
    let entry = panelRows.get(panel.id);
    if (entry === undefined) {
      const button = el('button', C.panelRow);
      button.type = 'button';
      const glyph = el('span', C.panelGlyph);
      glyph.setAttribute('aria-hidden', 'true');
      const glyphSlot = slotMark('sidebar.panellist');
      glyph.appendChild(glyphSlot);
      const label = el('span', `${C.panelTitle} ${C.sidebarWide}`, panel.label);
      button.append(glyph, label);
      button.addEventListener('click', () => { onSelectPanel(panel.id); });
      entry = { root: button, label, glyphSlot };
      panelRows.set(panel.id, entry);
    }
    entry.root.setAttribute('aria-label', panel.label);
    entry.label.textContent = panel.label;
    entry.glyphSlot.dataset.only = panel.id;
    return entry.root;
  }

  /* ── region / foot ─────────────────────────────────────────────────── */
  const regionArea = el('div', C.regionArea);
  const browser = createWorkspaceBrowser({ ...browserOptions, labels, wide: !collapsed });
  const regionSlot = slotMark('sidebar.workspaces');
  regionSlot.appendChild(browser.root);
  regionArea.appendChild(regionSlot);

  const footArea = el('div', C.footArea);
  const footerActions = el('div', C.footerActions);
  const footerSlot = slotMark('sidebar.footer.action');
  footerActions.appendChild(footerSlot);
  const settingsArea = el('div', C.settingsArea);
  const settingsSlot = slotMark('sidebar.settings');
  settingsArea.appendChild(settingsSlot);
  footArea.append(footerActions, settingsArea);

  root.append(topStrip, logoRow, newSession, panelList, regionArea, footArea);

  root.addEventListener('pointerenter', () => { pointerInside = true; cancelSettle(); sync(); });
  root.addEventListener('pointerleave', () => { pointerInside = false; sync(); });

  function cancelSettle() {
    if (settleTimer === null) return;
    if (typeof clearTimeout === 'function') clearTimeout(settleTimer);
    settleTimer = null;
  }

  /** `SidebarRoot.tsx:106-111`：收起后 150ms 才切到 rail 布局。 */
  function armSettle() {
    cancelSettle();
    if (!collapsed) { settled = false; return; }
    if (typeof setTimeout !== 'function') { settled = true; return; }
    settleTimer = setTimeout(() => {
      settleTimer = null;
      settled = true;
      sync();
    }, COLLAPSE_SETTLE_MS);
    if (typeof settleTimer === 'object' && settleTimer !== null && 'unref' in settleTimer) settleTimer.unref();
  }

  /** `SidebarRoot.tsx:112-113`：Windows 标题栏下宽内容不参与折叠淡出。 */
  const windowsTitlebar = typeof document !== 'undefined'
    && document.documentElement.hasAttribute('data-windows-titlebar');

  /** 一处落盘。 */
  function sync() {
    const wide = windowsTitlebar ? !collapsed : (!collapsed || !settled);
    root.classList.toggle(C.sidebarCollapsed, !wide);
    root.classList.toggle(C.sidebarRailIn, !wide && everWide);
    root.classList.toggle(C.sidebarFading, collapsed && wide);
    root.classList.toggle(C.sidebarQuietBars, !pointerInside);

    toggle.setAttribute('aria-label', collapsed ? t('toggle.open') : t('toggle.collapse'));
    toggle.title = toggleLabel();
    // `SidebarRoot.tsx:187-191`：rail 的鲸鱼标只在 `!wide && !windowsTitlebar` 时挂。
    if (!wide && !windowsTitlebar) {
      if (railMark.parentNode !== toggle) toggle.insertBefore(railMark, toggle.firstChild);
      panelIcon.setAttribute('width', '18');
      panelIcon.setAttribute('height', '18');
    } else {
      railMark.remove();
      panelIcon.setAttribute('width', '16');
      panelIcon.setAttribute('height', '16');
      toggleBadgeSlot.remove();
    }
    if (!wide && toggleBadgeSlot.parentNode !== toggle) toggle.appendChild(toggleBadgeSlot);
    toggleBadgeSlot.hidden = wide;
    brandName.hidden = !wide;
    brand.hidden = !wide;
    newSessionLabel.hidden = !wide;
    shortcut.hidden = !wide;
    panelList.hidden = panels.length === 0;

    // ⚠️ `wide` 是 `sidebar.workspaces` 这个 slot 的 owner prop
    //    （`SidebarRoot.tsx:298-301`），只传这一位；分组数据由
    //    `root.update({ sections })` 单独推。
    browser.update({ wide });
  }

  function toggleLabel() {
    return collapsed ? t('toggle.open') : t('toggle.collapse');
  }

  /** 落定一次折叠态。 */
  function setCollapsed(value) {
    const next = Boolean(value);
    if (next === collapsed) return;
    collapsed = next;
    if (!collapsed) {
      everWide = true;
      settled = false;
      cancelSettle();
    } else {
      armSettle();
    }
    sync();
  }

  panelList.replaceChildren(...panels.map(panel => handlePanelRow(panel)));
  armSettle();
  sync();

  return {
    root,
    browser,
    /**
     * 只改变化的部分。
     * @param {object} data `{ collapsed, panels, sections }`（都可选）
     */
    update(data = {}) {
      if (data.panels !== undefined) {
        panels = [...data.panels];
        panelList.replaceChildren(...panels.map(panel => handlePanelRow(panel)));
      }
      if (data.sections !== undefined) browser.update({ sections: data.sections });
      if (data.collapsed !== undefined) setCollapsed(data.collapsed);
      sync();
    },
    /** 内部状态读数（测试 / 调试用）。 */
    state: () => ({ collapsed, everWide, settled, windowsTitlebar }),
    /** 折叠 / 展开（等价于点那个 toggle）。 */
    toggle: () => { setCollapsed(!collapsed); },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 8. 导出
 * ══════════════════════════════════════════════════════════════════════════ */

const dshSidebar = Object.freeze({
  // 组件
  createSidebarRoot,
  createWorkspaceBrowser,
  createSessionRow,
  createProjectRow,
  createSearchResultRow,
  createEmptySessions,
  createAnimatedRows,
  // 纯派生层（逐行对照 tree.ts）
  deriveGroups,
  createMemoizedDeriveGroups,
  projectSessionOrder,
  projectUngroupedOrder,
  deriveFlat,
  visibleSessionIds,
  sessionMemberIds,
  owningGroupKey,
  owningParentFolder,
  orderByRecency,
  reconcileManualOrder,
  pinCurrentBlank,
  sectionMembers,
  sessionVisible,
  workspaceLabel,
  // 行级派生
  displayTitle,
  sessionStatuses,
  timeLabel,
  hoverTimeLabel,
  createdLabel,
  relativeTime,
  collapsedSessionRows,
  sanitizeSearchQuery,
  // 原语
  icon,
  stateDot,
  stateSpinner,
  slotMark,
  chainFallback,
  makeT,
  el,
  // 常量
  UNGROUPED_KEY,
  COLLAPSED_SESSION_LIMIT,
  SEARCH_QUERY_MAX_CODE_UNITS,
  ICON_REGULAR_STROKE,
  C,
  ICONS,
  DEFAULT_LABELS,
});

if (typeof window !== 'undefined') window.dshSidebar = dshSidebar;
if (typeof module !== 'undefined' && module.exports) module.exports = dshSidebar;
})();
