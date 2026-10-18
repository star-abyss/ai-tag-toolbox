'use strict';
/**
 * ⚠️ **整个文件包在 IIFE 里** —— 理由见 `dsh-sidebar.js` 顶部那段：
 * 本文件顶层有 `const SVG_NS` / `const ICONS`，而 `dsh-chat.js` 也有一个
 * `SVG_NS`、`dsh-sidebar.js` 也有一个 `ICONS` —— 经典脚本共用全局词法作用域时，
 * 后加载的那份会整份 `SyntaxError`（`Identifier 'SVG_NS' has already been declared`），
 * `window.dshComposer` 就永远挂不上。`el` / `icon` / `stateDot` 也撞名。
 */
(function installDshComposer() {
/**
 * DSH 输入卡片 + 底部信息条 —— **原生 JS 实现**，逐行对照 `ui-conversation` 的 React 源码。
 *
 * 源码：`github.com/deepseek-ai/deepseek-harness`（MIT）
 *       `packages/client/ui-conversation/src/client/`
 *
 * CSS 在 `dsh-composer.css` 里（同一来源，类名统一 `dsh-` 前缀）。
 * 这里只负责**建 DOM**：结构与 `data-*` 属性与 DSH 一一对应。
 *
 * 来源映射：
 *   inputBar()     ← skeleton/InputBar.tsx (507 行) + input/editor/DraftEditor.tsx
 *                    + input/editor/ComposerContentEditable.tsx
 *   contextMeter() ← skeleton/ContextMeter.tsx (180 行) + context-occupancy.ts
 *   todoPanel()    ← skeleton/TodoPanel.tsx (119 行)
 *   queueDock()    ← queue/QueueDock.tsx (411 行)
 *   observeHeight()← skeleton/ConversationContent.tsx:52-67（seatResizeRef）
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ **三条硬性约定**（对应任务书，逐条落到代码）
 *
 * **① 不卸载，只切显示。**
 *    · `activity` 切换 = `.dsh-inputbar-tools[hidden]` /
 *      `.dsh-inputbar-standard-controls[hidden]` 与 `.dsh-inputbar-activity` ↔
 *      `.dsh-inputbar-activity-expanded` 的**类名互换**（InputBar.tsx:419,451,457）。
 *      节点不动，`:has()` 与兄弟选择器才不算错，草稿与焦点也不丢。
 *    · 链式 slot 的 fallback 用 `display: contents / none` —— 见 `setSlotFallback()`，
 *      对应 `scoped-slots.tsx:1258` 的 `display: elected === null ? 'contents' : 'none'`。
 *    · 队列/待办面板折叠 = `hidden` 属性（`.list` 保留在树上），不是重建。
 *
 * **② 输入框是同一个 `contenteditable`，走两个状态。**
 *    原版 `ComposerContentEditable` 在无 session 时只是变 inert（`contentEditable`
 *    置假、`aria-disabled`），**不换树**（ComposerContentEditable.tsx:1-8,26-49）。
 *    这里 `#input` 元素**只建一次**，`setSession(false)` 只改属性。
 *
 * **③ `--dsh-composer-height` 由 ResizeObserver 写到滚动宿主上。**
 *    原版 `ConversationContent` 观察 `composerSeat` 后写入 scroller 的行内样式
 *    （ConversationContent.tsx:53-67），ui-chat 的"回到底部"按钮靠它定位
 *    （ChatView.module.css:243-250）。见 `observeHeight()`。
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ **为跑在纯 JS / jsdom 里做的语义改动**（逐条）
 *
 * 1. **没有 Lexical，也就没有 shell 借来的 editor。** 原版把 shell 持有的
 *    LexicalEditor 绑到这个 div（`editor.setRootElement`），文本模型在 Lexical 里。
 *    原生版**没有第二个文本模型**：DOM 就是唯一真相，`<p>` 承载各行
 *    （`InputBar.module.css:189` 的 `.input p { margin: 0 }` 正是为 Lexical 的
 *    `<p>` 段落写的，这里同样成立）。
 * 2. **`revealDraftSelection`**（view-binding.ts:28-46）用
 *    `Range.getBoundingClientRect()` 算 caret 盒。jsdom 没有这个方法，所以加了
 *    能力判断：拿不到 rect 就整段跳过——浏览器里行为与原版一致。
 * 3. **`keepDraftFocus`**（view-binding.ts:152-155）：原版 `preventDefault()` 后
 *    调 `editor.getRootElement().focus()`。原生版直接 `preventDefault()` +
 *    `focus({preventScroll:true})`。
 * 4. **`installDraftWheel`**（view-binding.ts:65-79）逐字照搬，只把
 *    `RefObject` 换成元素本身。
 * 5. **`contextMeter` 的面板定位**：原版走 `useAnchoredPosition`（依赖 ui-primitives
 *    的浮层测量）。这里用 `getBoundingClientRect()` 做同一件事（side:'top',
 *    gap:8, margin:12）；测不到尺寸时**保留原版那条 fallback 行内样式**
 *    `{visibility:'hidden', left:0, top:0}`（ContextMeter.tsx:137）。
 * 6. **`aria-label` / 文案**：原版全部走 locale 字典（`locales.ts`）。这里收成
 *    `text` 选项，默认值**逐字取自 `locales.ts` 的 zh 字典**（含
 *    `context.aria` / `todo.progress.*` / `queue.*` 的全部 key），并保留
 *    `context.aria` 的 `\u0000` 读音槽切分逻辑（ContextMeter.tsx:26,92-94）。
 * 7. **`projectUserText`**（ui-primitives/user-text.tsx:58-156）：原版返回 ReactNode，
 *    这里返回 DOM 片段。它做的是"投影"——`@[label](dsh-session:…)` 这种 wire 形态
 *    折成 label、`@name` / `/name` token 加引用样式。原生版**实现其中纯文本折叠
 *    那一段**（不带 ReferenceIconRegular 图标、不做 openFile/openSkill 跳转，因为
 *    已发的排队行原版也传 `slashNames: []`，`references` 在队列里恒为 undefined）。
 * 8. **`Activity` slot**：原版 `renderSlot('conversation.input.activity', {...})`
 *    由外部插件填，`onActiveChange` 回调把 `activity` 提到 InputBar 的 state。
 *    这里 `opts.slots.activity` 可由调用方挂节点，`setActivity(bool)` 显式暴露
 *    （供外部喂 `onActiveChange`）。
 * 9. **`disabled` 的合取**：原版 `disabled = removed || inert || !live || blocked !== undefined
 *    || parentOffline`（InputBar.tsx:139），其中 `live` 由机器面是否齐备决定。
 *    原生版把它收成 `setSession(bool)` + `setDisabled(bool)` 两个入参；
 *    `blocked` 可以传字符串（进入只读、草稿仍可见），与原版
 *    "adjudicating and submitting render read-only so the draft stays visible" 一致。
 */

/* ═══════════════════════════════════════════════════════════════════
 * 文案默认值 —— 逐字取自 `ui-conversation/src/client/locales.ts` 的 zh 字典
 * ═══════════════════════════════════════════════════════════════════ */
const ZH = Object.freeze({
  'input.commands': '添加文件或调用指令',
  'input.file': '文件',
  /**
   * **清空本次对话**（应用特有动作，DSH 的 `InputBar` 里没有）。
   * 文案里点明"图片保留" —— 从按钮上看不出图片会不会被一起清掉。
   */
  'input.clearConversation': '清空本次对话（对话图片保留）',
  'input.stop': '停止生成',
  'input.send': '发送消息',
  'input.send.queue': '排队发送',
  'input.send.steer': '插话发送',
  'input.stop.tip': '停止',
  /**
   * 占位符文案。
   *
   * ⚠️ **不提 `@` 引用文件与 `/` 调用指令** —— 本项目没有那两套功能，
   * 写了等于指向一个不存在的东西。这里只说本工具真正支持的输入方式。
   */
  'placeholder.default': '描述你想画的角色、场景或画风…',
  'placeholder.unavailable': '当前会话不可输入',
  'placeholder.parentOffline': '父会话离线，无法输入',
  'placeholder.plan': '描述要执行的任务',
  'placeholder.steerQueue': '按 Enter 把排队消息插进当前回合',
  'hero.chooseWorkspace': '选择工作区',
  'context.aria': '上下文已用 {percent}',
  'context.used': '上下文已用',
  'context.system': '系统提示词',
  'context.tools': '工具定义',
  'context.messages': '对话消息',
  'number.thousand': '{value}K',
  'number.million': '{value}M',
  'todo.title': '任务',
  'todo.progress.done': '{done} 已完成',
  'todo.progress.active': '{active} 进行中',
  'todo.progress.pending': '{pending} 待处理',
  'todo.status.completed': '已完成',
  'todo.status.inProgress': '进行中',
  'todo.status.pending': '待处理',
  'queue.count': '{n} 条排队消息',
  'queue.sending': '发送中…',
  'queue.image': '排队消息图片',
  'queue.file': '排队文件 {name}',
  'queue.edit': '编辑排队消息',
  'queue.edit.unsupported': '包含非文本内容，暂不支持编辑',
  'queue.save': '保存排队消息',
  'queue.cancelEdit': '取消编辑',
  'queue.remove': '删除排队消息',
  'queue.steer': '插话发送',
  'queue.steer.unavailable': '仅运行中可插话发送',
});

/**
 * 文案取用：`{name}` 占位符替换（对应 locale 的 `t(key, params)`）。
 * @param {string} key       `locales.ts` 里的 key
 * @param {object} [params]  占位符值
 * @param {object} [dict]     覆盖字典（默认 zh）
 * @returns {string}
 */
function t(key, params = undefined, dict = undefined) {
  /**
   * ⚠️ **覆盖表要"合并"到默认表上，不能整个替换。**
   *
   * `const table = dict || ZH` 这种写法下，`dict` 只要是个对象
   * （**哪怕是 `{}`**）就是真值，`ZH` 会被整个跳过 —— 字典里没有的 key
   * 直接**回落成 key 本身**，界面上就出现 `placeholder.default`
   * 这种没翻译的字符串。
   *
   * 所以：默认表打底、覆盖表盖在上面。只给部分 key 也不会把其余打回原形。
   */
  const table = dict && typeof dict === 'object' ? { ...ZH, ...dict } : ZH;
  let text = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
  if (params) {
    for (const name of Object.keys(params)) {
      text = text.split(`{${name}}`).join(String(params[name]));
    }
  }
  return text;
}

/**
 * 紧凑 token 计数 —— 逐字照抄 `ContextMeter.tsx:41-48` 的 `formatTokens`。
 * @param {number} value
 * @param {object} [dict]
 * @returns {string}
 */
function formatTokens(value, dict = undefined) {
  /** @param {number} candidate */
  const scaled = candidate => candidate >= 100
    ? String(Math.round(candidate))
    : String(Math.round(candidate * 10) / 10);
  if (value < 1000) return String(value);
  if (value < 1000000) return t('number.thousand', { value: scaled(value / 1000) }, dict);
  return t('number.million', { value: scaled(value / 1000000) }, dict);
}

/**
 * 上下文占用 —— 逐字照抄 `context-occupancy.ts:15-25`。
 *
 * 提供方**必须同时**给出 usedTokens 与 windowTokens 才返回非 null；
 * 否则 `contextMeter` 什么都不渲染（ContextMeter.tsx:89）。
 * @param {{usedTokens?:number, windowTokens?:number, percent?:number}} data
 * @returns {{percent:number, usedTokens:number, windowTokens:number}|null}
 */
function contextOccupancy(data) {
  const usedTokens = data && data.usedTokens;
  const windowTokens = data && data.windowTokens;
  if (usedTokens === undefined || windowTokens === undefined) return null;
  /**
   * ⚠️ **`windowTokens` 为 0 或负也要返回 `null`。**
   *
   * 只判 `undefined` 的话 `0` 会漏过去：`used / windowTokens` 得 `Infinity`，
   * 再被 `Math.min(100, …)` 夹成 **100%** —— 界面上出现"上下文用了 100%"
   * 的假读数。
   *
   * 窗口未知时**整个隐藏**（与 DSH 的硬规则一致）：不显示 0%、也不显示 100%。
   */
  if (!(Number(windowTokens) > 0)) return null;
  return {
    percent: data.percent !== undefined
      ? Math.min(100, Math.round(data.percent))
      : Math.min(100, Math.round(usedTokens / windowTokens * 100)),
    usedTokens,
    windowTokens,
  };
}

/** 环形几何（ContextMeter.tsx:17-19）：14px viewBox，2px 描边。 */
const RING_RADIUS = 5.5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** 本地化占用句的读音槽标记（ContextMeter.tsx:26）。 */
const READING_SLOT = '\u0000';

/** 分解面板图例行，顺序与色条一致（ContextMeter.tsx:29-33）。 */
const BREAKDOWN_ROWS = Object.freeze([
  Object.freeze({ key: 'systemTokens', label: 'context.system', color: 'dsh-ctxmeter-color-system' }),
  Object.freeze({ key: 'toolsTokens', label: 'context.tools', color: 'dsh-ctxmeter-color-tools' }),
  Object.freeze({ key: 'messageTokens', label: 'context.messages', color: 'dsh-ctxmeter-color-messages' }),
]);

/** SVG 命名空间。 */
const SVG_NS = 'http://www.w3.org/2000/svg';

/* ═══════════════════════════════════════════════════════════════════
 * 建 DOM 的小工具
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * 建元素（对应 JSX 的 `<span className=…>`）。
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

/** `clsx` 的等价物：只做"真值才留"的拼接。 */
function clsx(...parts) {
  return parts.filter(Boolean).join(' ');
}

/**
 * 建 SVG 元素。
 * @param {string} tag
 * @param {object} [attrs]
 * @returns {SVGElement}
 */
function svgEl(tag, attrs = undefined) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const name of Object.keys(attrs)) node.setAttribute(name, String(attrs[name]));
  }
  return node;
}

/**
 * 标记一个 slot 包裹层 —— 对应原版 `div[data-slot]`。
 *
 * 原版那层的 CSS 是 **`display: contents`**（`scoped-slots.tsx:1064,1088`）：
 * 包裹层对排版透明。原生 JS 的容器也照此标记，CSS 桥接层给
 * `[data-composer-slot]` 同一条规则，否则多出来的 `<div>` 会成为父级 flex 的
 * 额外子项，多一个 `gap`、把控件挤开。
 * @param {HTMLElement} node
 * @returns {HTMLElement}
 */
function markSlot(node) {
  node.dataset.composerSlot = '';
  return node;
}

/**
 * 建一个 DSH 图标（`ui-primitives/src/icons/index.tsx` 的 artwork 逐条照抄）。
 * @param {string} name  见下面的 ICONS 表
 * @param {number} [size] 覆盖 artwork 的默认尺寸
 * @returns {SVGElement}
 */
function icon(name, size = undefined) {
  const art = ICONS[name];
  /* istanbul ignore next -- 内部调用常量名，未知名字属编程错误 */
  if (!art) throw new Error(`dsh-composer: unknown icon "${name}"`);
  const svg = svgEl('svg', {
    width: size === undefined ? art.size : size,
    height: size === undefined ? art.size : size,
    viewBox: '0 0 16 16',
    fill: 'none',
    xmlns: SVG_NS,
    'aria-hidden': 'true',
    'stroke-width': art.stroke,
  });
  for (const path of art.paths) {
    svg.appendChild(svgEl('path', { d: path.d, ...(path.fill ? { fill: 'currentColor' } : { stroke: 'currentColor' }) }));
  }
  return svg;
}

/**
 * 图标表 —— 每条都是 `ui-primitives/src/icons/index.tsx` 里同名 artwork 的
 * 原样 `d`，`stroke` 取 `ICON_REGULAR_STROKE = 1` / `ICON_MEDIUM_STROKE = 1.3`。
 */
const ICONS = Object.freeze({
  /* index.tsx:116-133 —— IconPlusOutlineMedium（stroke 1.3，size 16）。 */
  plusMedium: Object.freeze({
    size: 16, stroke: 1.3,
    paths: Object.freeze([{ d: 'M8 2V14' }, { d: 'M2 8H14' }]),
  }),
  /* index.tsx:168-176 —— IconChevronDownOutlineRegular（size 14）。 */
  chevronDown: Object.freeze({
    size: 14, stroke: 1,
    paths: Object.freeze([{ d: 'M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6' }]),
  }),
  /* index.tsx:232-240 —— IconChevronUpOutlineRegular（size 14）。 */
  chevronUp: Object.freeze({
    size: 14, stroke: 1,
    paths: Object.freeze([{ d: 'M12 10L8.70711 6.70711C8.31658 6.31658 7.68342 6.31658 7.29289 6.70711L4 10' }]),
  }),
  /* index.tsx:1118-1128 —— IconQueueOutlineRegular（size 14）。 */
  queue: Object.freeze({
    size: 14, stroke: 1,
    paths: Object.freeze([{ d: 'M4.9375 5.90295H11.0625' }, { d: 'M4.9375 9.02991H8.27841' }]),
  }),
  /* index.tsx:434-444 —— IconEditOutlineRegular（size 16）。
     ⚠️ 原 artwork 的第一条是那个"带缺角的方框"主体，且**是 fill 而非 stroke**；
     这里照抄它的 `d`（用 stroke 画轮廓）——纯 JS 版不做 fill-rule 细分。 */
  edit: Object.freeze({
    size: 16, stroke: 1,
    paths: Object.freeze([
      { d: 'M2.2 4.2C2.2 3.1 3.1 2.2 4.2 2.2H8.9M2.2 4.2V11.8C2.2 12.9 3.1 13.8 4.2 13.8H11.8C12.9 13.8 13.8 12.9 13.8 11.8V7.9' },
      { d: 'M7.7849 8.23878L13.888 2.13574' },
    ]),
  }),
  /* index.tsx:570-584 —— IconTrashOutlineRegular（size 16）。 */
  trash: Object.freeze({
    size: 16, stroke: 1,
    paths: Object.freeze([
      { d: 'M1.28149 3.88831H14.7187' },
      { d: 'M5.41602 3.88833V2.47962C5.41602 2.29282 5.52492 2.11366 5.71876 1.98157C5.9126 1.84948 6.17551 1.77527 6.44964 1.77527H9.55053C9.82466 1.77527 10.0876 1.84948 10.2814 1.98157C10.4753 2.11366 10.5842 2.29282 10.5842 2.47962V3.88833' },
      { d: 'M2.57349 3.88831L3.19366 13.2943C3.21937 13.5502 3.33952 13.7872 3.53065 13.9593C3.72178 14.1313 3.97016 14.2259 4.22729 14.2246H11.7728C12.0299 14.2259 12.2783 14.1313 12.4694 13.9593C12.6605 13.7872 12.7807 13.5502 12.8064 13.2943L13.4266 3.88831' },
      { d: 'M6.44946 6.98926V11.1238' },
      { d: 'M9.55054 6.98926V11.1238' },
    ]),
  }),
  /* index.tsx:1096-1110 —— IconSendOutlineRegular（size 14；第一条为填充笔画）。 */
  send: Object.freeze({
    size: 14, stroke: 1,
    paths: Object.freeze([
      { d: 'M6.97211 1.94476C7.55785 1.35914 8.50767 1.35919 9.09343 1.94476L13.921 6.77228L13.2138 7.47939L8.38632 2.65187C8.19108 2.45682 7.87443 2.45677 7.67922 2.65187L2.74397 7.58711L2.03687 6.88L6.97211 1.94476Z', fill: true },
      { d: 'M7.97571 14.5732L8.02421 2.34139' },
    ]),
  }),
  /* index.tsx:249-261 —— IconCloseOutlineRegular（size 16）。 */
  close: Object.freeze({
    size: 16, stroke: 1,
    paths: Object.freeze([{ d: 'M2.5 2.5L13.5 13.5' }, { d: 'M13.5 2.5L2.5 13.5' }]),
  }),
  /* index.tsx:134-146 —— IconCheckOutlineRegular（size 16）。 */
  check: Object.freeze({
    size: 16, stroke: 1,
    paths: Object.freeze([{ d: 'M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4' }]),
  }),
  /* index.tsx:1122-1138 —— IconChecklistOutlineRegular（size 14）。 */
  checklist: Object.freeze({
    size: 14, stroke: 1,
    paths: Object.freeze([
      { d: 'M3.75 6.25C4.7165 6.25 5.5 5.4665 5.5 4.5C5.5 3.5335 4.7165 2.75 3.75 2.75C2.7835 2.75 2 3.5335 2 4.5C2 5.4665 2.7835 6.25 3.75 6.25Z' },
      { d: 'M7.5 4.5H13.5' },
      { d: 'M3.75 13.25C4.7165 13.25 5.5 12.4665 5.5 11.5C5.5 10.5335 4.7165 9.75 3.75 9.75C2.7835 9.75 2 10.5335 2 11.5C2 12.4665 2.7835 13.25 3.75 13.25Z' },
      { d: 'M7.5 11.5H13.5' },
    ]),
  }),
});

/**
 * `StateDot`（`ui-primitives/src/StateDot.tsx:44-77`）。
 *
 * 类名沿用本项目已有的 `dsh-ui.css` 那一套（`.dsh-dot` / `.dsh-spinner*`，
 * 逐字来自 `StateDot.module.css`），不重复定义样式。
 * @param {'done'|'warning'|'ongoing'|'error'|'idle'} state
 * @returns {HTMLElement|SVGElement}
 */
function stateDot(state) {
  if (state === 'ongoing') {
    const svg = svgEl('svg', { class: 'dsh-spinner', 'data-state': 'ongoing', width: 14, height: 14, viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    const group = svgEl('g', { class: 'dsh-spinner-motion' });
    group.appendChild(svgEl('circle', { class: 'dsh-spinner-track', cx: 12, cy: 12, r: 9.5 }));
    group.appendChild(svgEl('circle', { class: 'dsh-spinner-arc', cx: 12, cy: 12, r: 9.5 }));
    svg.appendChild(group);
    return svg;
  }
  const dot = el('span', 'dsh-dot');
  dot.dataset.state = state;
  dot.setAttribute('aria-hidden', 'true');
  dot.style.width = '10px';
  dot.style.height = '10px';
  return dot;
}

/** Todo 生命周期 → StateDot 状态（TodoPanel.tsx:30-38）。 */
const TODO_DOT = Object.freeze({ completed: 'done', in_progress: 'ongoing', pending: 'idle' });

/** Todo 生命周期 → 读屏状态文案 key（TodoPanel.tsx:41-49）。 */
const TODO_STATUS_KEY = Object.freeze({
  completed: 'todo.status.completed',
  in_progress: 'todo.status.inProgress',
  pending: 'todo.status.pending',
});

/* ═══════════════════════════════════════════════════════════════════
 * 用户文本投影 —— `ui-primitives/src/user-text.tsx:58-156` 的纯文本折叠段
 * ═══════════════════════════════════════════════════════════════════ */

/** wire 形态的会话 chip（user-text.tsx:24）。 */
const SESSION_WIRE_RE = /@\[([^\]\n]+)\]\(dsh-session:[^)\s]+\)/gu;
/** 裸 `@name` 可以带上的句末标点（user-text.tsx:27）。 */
const TRAILING_PUNCTUATION_RE = /[.,;:!?，。；：！？]+$/u;

/**
 * 把一段已发用户文本投影成 DOM：`@[label](dsh-session:…)` 折成 label，
 * `@name` / `/name` token 套引用样式，其余是普通文本。
 *
 * ⚠️ 与原版的两点差别（都是"纯 JS 里没有的东西"）：
 *   · 不带 `ReferenceIconRegular` 图标（ui-primitives 的图标组件）；
 *   · `slashNames` 恒为空 —— 已发的排队行原版也传空数组
 *     （QueueDock.tsx:234,348 `projectUserText(…, [])`），所以队列行的
 *     `/name` token 在原版里同样是普通文本。
 * @param {string} text
 * @param {string} [plainClassName] 普通文本 run 的类名（原版 `<span>` 不带类）
 * @returns {DocumentFragment}
 */
function projectUserText(text, plainClassName = '') {
  const fragment = document.createDocumentFragment();
  /** @type {Array<{start:number,end:number,label:string,display?:string}>} */
  const ranges = [];
  SESSION_WIRE_RE.lastIndex = 0;
  let wire;
  while ((wire = SESSION_WIRE_RE.exec(text)) !== null) {
    ranges.push({ start: wire.index, end: wire.index + wire[0].length, label: wire[0], display: wire[1] });
  }
  const re = /(^|\s)(\/[\w-]+(?=\s|$)|@"[^"\n]+"|@[^\s]+)/gu;
  let m;
  while ((m = re.exec(text)) !== null) {
    const tokenStart = m.index + m[1].length;
    const rawLabel = m[2];
    const label = rawLabel.startsWith('@"') ? rawLabel : rawLabel.replace(TRAILING_PUNCTUATION_RE, '');
    if (label.length <= 1) continue;
    if (label.startsWith('/')) continue; // slashNames 恒空
    ranges.push({ start: tokenStart, end: tokenStart + label.length, label });
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const pushPlain = (from, to) => {
    const run = el('span', plainClassName, text.slice(from, to));
    fragment.appendChild(run);
  };
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) pushPlain(cursor, range.start);
    const chip = el('span', 'dsh-composerref-reference', range.display === undefined ? range.label : range.display);
    chip.dataset.refChip = range.display === undefined ? 'mention' : 'session';
    chip.title = range.label;
    fragment.appendChild(chip);
    cursor = range.end;
  }
  if (cursor < text.length) pushPlain(cursor, text.length);
  if (!fragment.childNodes.length) pushPlain(0, text.length);
  return fragment;
}

/* ═══════════════════════════════════════════════════════════════════
 * 约定 ① —— 链式 slot 的 fallback 切换（`scoped-slots.tsx:1258`）
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * 链式 slot 包裹层的 fallback 显隐：`display: contents` ↔ `none`。
 *
 * 原版在 takeover 当选时把 fallback 那一段设成 `display: none`——**输入框不卸载**，
 * 只隐藏（`scoped-slots.tsx:1258`：`display: elected === null ? 'contents' : 'none'`）。
 * 这里的 `display: contents` 就是原版 `[data-slot]` 的常态
 * （`scoped-slots.tsx:1064,1088`：`[data-slot]` 永远是 `display: contents`）。
 * @param {HTMLElement} node
 * @param {boolean} elected  是否已有当选内容
 * @returns {HTMLElement} 传回的 node，便于链式调用
 */
function setSlotFallback(node, elected) {
  node.style.display = elected ? 'none' : 'contents';
  return node;
}

/* ═══════════════════════════════════════════════════════════════════
 * 约定 ③ —— `--dsh-composer-height`（ConversationContent.tsx:52-67）
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * 观察 composer 座的高度，把它写进滚动宿主的 `--dsh-composer-height`。
 *
 * 原版：`ConversationContent.tsx:53-67` 观察 `composerSeat`，同时观察 scroller，
 * 回调里写 `--dsh-composer-height`（座高）与 `--dsh-conversation-viewport-height`
 * （滚动口高）；ui-chat 的"回到底部"按钮靠前者定位
 * （`ChatView.module.css:243-250`，`bottom: calc(var(--dsh-composer-height, 152px) + 16px)`）。
 *
 * ⚠️ 本环境（jsdom）**没有 ResizeObserver**，所以：
 *   · 有 ResizeObserver → 用它，并在建立时立刻测一次；
 *   · 没有 → 退回 `measure()`，由调用方在布局变化后手动调（返回的 `measure`）。
 * 两种情况都会先写一次首值，避免"首帧回到底部按钮压在输入卡上"。
 * @param {HTMLElement} seat      the `.dsh-composer-seat`
 * @param {HTMLElement} [scroller] 默认取 `seat.parentElement`（同原版）
 * @returns {{measure:()=>void, disconnect:()=>void, height:()=>number}}
 */
function observeHeight(seat, scroller = undefined) {
  const host = scroller !== undefined ? scroller : seat.parentElement;
  const measure = () => {
    if (!host) return 0;
    const height = seat.offsetHeight;
    host.style.setProperty('--dsh-composer-height', `${height}px`);
    host.style.setProperty('--dsh-conversation-viewport-height', `${host.clientHeight}px`);
    return height;
  };
  measure();
  const RO = typeof ResizeObserver === 'function' ? ResizeObserver : null;
  if (RO === null || !host) {
    return { measure, disconnect() {}, height: () => seat.offsetHeight };
  }
  const observer = new RO(measure);
  observer.observe(seat);
  observer.observe(host);
  return {
    measure,
    disconnect: () => { observer.disconnect(); },
    height: () => seat.offsetHeight,
  };
}

/* ═══════════════════════════════════════════════════════════════════
 * 输入卡片 —— InputBar.tsx + DraftEditor.tsx + ComposerContentEditable.tsx
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * 从 contenteditable 里读纯文本（= 原版 `input.draft`）。
 *
 * ⚠️⚠️ **不能只认 `<p>`。**
 *
 * 原版是 Lexical 托管的编辑器，段落节点固定是 `<p>`；这里换成浏览器原生
 * contenteditable 之后，**插什么标签由浏览器决定**：
 *   · Chromium/Electron 在 Windows 上按 Enter 默认插 `<div>`（`defaultParagraphSeparator`
 *     是 `div`），不是 `<p>`；
 *   · 只有一行时可能是一个裸文本节点，或者是 `<div>文字</div>`。
 *
 * 原来只查 `<p>`，且在没有 `<p>` 时回落成 `inputEl.textContent` —— 那个回落
 * 遇到 `<div>` 会把多行**连成一行**（丢换行），遇到 `<br>` 更是直接丢内容。
 * 实测后果：带附件的发送里正文恒为空串（会话记录里连续三条
 * `text=""` 而 `imageIds` 有值），用户的原话是「我说的话却没有被发送」。
 *
 * 这里改成**按块级子节点遍历**：`<p>` / `<div>` 各算一行，`<br>` 算一个换行，
 * 其余内联内容并入当前行。这样不依赖浏览器选了哪个段落标签。
 *
 * @param {HTMLElement} inputEl
 * @returns {string}
 */
function readInputText(inputEl) {
  /** 与行内空白无关，只把不换行空格归一成普通空格。 */
  const plain = value => String(value || '').replace(/\u00a0/g, ' ');
  const BLOCK = new Set(['P', 'DIV', 'LI', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  const lines = [];
  let current = '';
  /**
   * 深度优先遍历子节点。
   * @param {Node} node 当前节点
   */
  const walk = node => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { current += plain(child.nodeValue); continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (tag === 'BR') { lines.push(current); current = ''; continue; }
      if (BLOCK.has(tag)) {
        /** 块开始前先把已累积的那行收掉（首个块时 current 为空，收出空行要丢掉）。 */
        if (current !== '' || lines.length === 0) lines.push(current);
        current = '';
        walk(child);
        lines.push(current);
        current = '';
        continue;
      }
      walk(child);
    }
  };
  walk(inputEl);
  if (current !== '') lines.push(current);
  /** 去掉首尾空行，中间的空行保留（那是用户按出来的空行）。 */
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/**
 * 写纯文本进 contenteditable —— 每个换行一个 `<p>`，空文本留**一个空 `<p>`**。
 *
 * 为什么留空 `<p>`：`.input p:last-child::after` 就是 claim 幽灵提示的挂载点
 * （InputBar.module.css:196-199），没有最后一个 `<p>` 提示就出不来。
 *
 * ⚠️ **写完要派发一次 `input`**（内容真的变了才派）。
 *
 * 用户敲键时浏览器自己会派发 `input`，而这是**程序化**写入 —— 不派发的话，
 * 挂在同一个 contenteditable 上的消费者（挂载层把它同步给输入状态层）就
 * **完全不知道草稿变了**：`bar.setText('x')` 之后状态层里还是空的。
 *
 * 派发是安全的：`input` 是 `bubbles` 的普通事件，与 `focus` / `blur` 一样
 * 在两种写入路径下产生同一份可观测事实。消费方的同步函数按"内容相同就不写"
 * 短路，所以不存在来回震荡。
 *
 * @param {HTMLElement} inputEl
 * @param {string} text
 */
function writeInputText(inputEl, text) {
  const previous = readInputText(inputEl);
  inputEl.textContent = '';
  const lines = String(text).split('\n');
  for (const line of lines) {
    const p = document.createElement('p');
    if (line) p.textContent = line;
    inputEl.appendChild(p);
  }
  const next = String(text ?? '');
  if (previous === next) return;
  const EventCtor = inputEl.ownerDocument?.defaultView?.Event
    || (typeof Event !== 'undefined' ? Event : null);
  if (EventCtor) inputEl.dispatchEvent(new EventCtor('input', { bubbles: true }));
}

/**
 * caret 落到草稿末尾（对应原版"解锁时焦点回输入框"的效果）。
 * @param {HTMLElement} inputEl
 */
function caretToEnd(inputEl) {
  const selection = window.getSelection && window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const last = inputEl.lastChild;
  if (last) range.setStart(last, last.childNodes.length);
  else range.setStart(inputEl, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * 把 caret 滚进草稿自己的滚动口 —— 照抄 `view-binding.ts:28-46`。
 *
 * ⚠️ jsdom 没有 `Range.getBoundingClientRect`，所以加了能力判断；
 * 浏览器里行为与原版一致。
 * @param {HTMLElement} scrollEl
 */
function revealDraftSelection(scrollEl) {
  if (!scrollEl || scrollEl.scrollHeight <= scrollEl.clientHeight) return;
  const selection = window.getSelection && window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (typeof range.getBoundingClientRect !== 'function') return;
  let rect = range.getBoundingClientRect();
  if (rect.height === 0 && rect.width === 0) {
    const anchor = selection.anchorNode;
    const node = anchor instanceof HTMLElement ? anchor : anchor && anchor.parentElement;
    if (!node || typeof node.getBoundingClientRect !== 'function') return;
    rect = node.getBoundingClientRect();
  }
  const box = scrollEl.getBoundingClientRect();
  if (rect.bottom > box.bottom) scrollEl.scrollTop += rect.bottom - box.bottom;
  else if (rect.top < box.top) scrollEl.scrollTop -= box.top - rect.top;
}

/**
 * 草稿口上的 wheel 链 —— 照抄 `view-binding.ts:65-79`。
 * @param {HTMLElement} scrollEl
 * @returns {() => void} 解绑
 */
function installDraftWheel(scrollEl) {
  /** @param {WheelEvent} e */
  const onWheel = e => {
    const host = scrollEl.closest('[data-conversation-scroll]');
    if (!(host instanceof HTMLElement) || e.deltaY === 0) return;
    const atTop = scrollEl.scrollTop <= 0;
    const atEnd = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 1;
    if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atEnd)) return;
    e.preventDefault();
    host.scrollTop += e.deltaY;
  };
  scrollEl.addEventListener('wheel', onWheel, { passive: false });
  return () => { scrollEl.removeEventListener('wheel', onWheel); };
}

/** 提交模式解析 —— `submission-policy.ts` 的 `resolveSubmitMode`（默认 busyEnter 分支）。 */
function resolveSubmitMode(running, acceleratable, steeringAvailable) {
  if (acceleratable && steeringAvailable) return 'steer';
  return running ? 'queue' : 'submit';
}

/**
 * 输入卡片。结构 = `InputBar.tsx` 的 `.root > (.card > .row)` + DraftEditor 的
 * `.scroll > .grow > (.input + .placeholder)`，外加上 `conversation.input.*`
 * 各 slot 的**常驻**容器。
 *
 * @param {object} [options]
 * @param {string}   [options.placeholder]        占位符（owner prop，压过状态推导）
 * @param {boolean}  [options.disabled]           是否禁用（对应 `inert` / `locked`）
 * @param {string}   [options.blocked]            有值则进入只读但**草稿仍可见**（原版 owner block）
 * @param {boolean}  [options.session]            是否有会话（决定 contenteditable 的 inert 态）
 * @param {'composer'|'hero'} [options.variant]   `composer`（停靠）/ `hero`（居中空态）
 * @param {boolean}  [options.workspaceTrigger]   无会话时整张卡是工作区选择触发器
 * @param {boolean}  [options.workspacePickerOpen]
 * @param {boolean}  [options.running]            会话是否在跑（决定排队/插话措辞与停止钮）
 * @param {boolean}  [options.canSteerQueue]      空草稿时加速 Enter 是否可插话全队列
 * @param {string}   [options.initialText]        初始草稿
 * @param {object}   [options.text]               覆盖文案（`locales.ts` 的 key → 文本）
 * @param {object}   [options.slots]              `{ overlay, accessory, attachments, permission, plan,
 *                                                    left, right, model, activity, composerDock }`
 *                                                每个值是节点、节点数组或 null；`model` 收到 `{locked}`
 * @param {Function} [options.onSend]             `({ text, mode }) => void`
 * @param {Function} [options.onStop]
 * @param {Function} [options.onRequestWorkspace]
 * @param {Function} [options.onToggleCommandMenu]`({ caretSpan }) => void`
 * @param {Function} [options.onPickFiles]        `<input type=file>` 的 FileList
 * @param {Function} [options.onRemoveAttachment] `(id) => void`
 * @param {Function} [options.onRetryFile]        `(id) => void`
 * @param {Function} [options.resolveAttachments] `() => Array<{id, kind}>`（原版 `resolveDraftAttachments`）
 * @returns {{root:HTMLElement, card:HTMLElement, inputEl:HTMLElement, row:HTMLElement, dock:HTMLElement,
 *            fileInput:HTMLInputElement, sendButton:HTMLButtonElement, stopButton:HTMLButtonElement|null,
 *            setBusy:(v:boolean)=>void, setText:(s:string)=>void, getText:()=>string,
 *            setDisabled:(v:boolean)=>void, setSession:(v:boolean)=>void, setActivity:(v:boolean)=>void,
 *            setNotice:(level:string|null, text?:string)=>void, variant:string, compact:()=>void,
 *            dispose:()=>void}}
 */
function inputBar(options = {}) {
  const opts = options;
  const variant = opts.variant === 'hero' ? 'hero' : 'composer';
  const runningFlags = { running: opts.running === true, canSteerQueue: opts.canSteerQueue === true };
  const attachmentsFn = opts.resolveAttachments;
  /** @type {Array<{id:string, kind?:string}>} 原版 `resolveDraftAttachments(input.attachmentIds)` 的结果 */
  let attachments = [];
  let busy = false;
  let disabled = opts.disabled === true;
  let hasSession = opts.session !== false;
  const workspaceTrigger = opts.workspaceTrigger === true;
  const blocked = opts.blocked;
  let activity = false;

  /* ── 骨架：`.root` ───────────────────────────────────────────── */
  const root = el('div', clsx('dsh-inputbar-root', variant === 'hero' && 'dsh-inputbar-hero'));

  /* ── toast 槽（原版 `{toast !== null && <Toast …/>}` 是**常驻**容器里换内容） ── */
  const toastHost = el('div', 'dsh-inputbar-toast-host');
  toastHost.hidden = true;
  /* toast 是绝对定位的浮层宿主（原版 `<Toast anchor={cardRef.current}>`），
     不是 flex 子项，所以这里**不**标 `data-composer-slot`。 */
  root.appendChild(toastHost);

  /* ── notice（`notice.level === 'info'` 时出现的 `role="status"` 条） ── */
  const noticeEl = el('div', 'dsh-inputbar-notice');
  noticeEl.setAttribute('role', 'status');
  noticeEl.hidden = true;
  root.appendChild(noticeEl);

  /* ── `.card` ─────────────────────────────────────────────────── */
  const card = el('div', clsx('dsh-inputbar-card', workspaceTrigger && 'dsh-inputbar-card-workspace-trigger'));
  card.dataset.composerCard = '';
  if (workspaceTrigger) {
    card.addEventListener('click', () => { if (opts.onRequestWorkspace) opts.onRequestWorkspace(); });
    /* 原版：pointerdown 在卡片里止住，避免 Menu 的外部关闭与点击重开抢跑。 */
    card.addEventListener('pointerdown', e => { e.stopPropagation(); });
  }

  /* `conversation.input.overlay` —— 浮层锚点，**只有有会话时挂**（InputBar.tsx:382）。
     它是 `position: absolute` 的定位上下文（`.dsh-inputbar-overlay-anchor`），
     不是 flex 子项，所以**不**标 `data-composer-slot`。 */
  const overlayAnchor = el('div', 'dsh-inputbar-overlay-anchor');
  if (hasSession) card.appendChild(overlayAnchor);

  /* `accessory`（owner prop） —— 原版也是"有则挂"；这里用显隐不用卸载。 */
  const accessory = el('div', 'dsh-inputbar-accessory');
  accessory.hidden = true;
  card.appendChild(accessory);

  /* `conversation.input.attachments` —— 常驻容器（原版无条件 renderSlot）。 */
  const attachmentsHost = el('div', 'dsh-inputbar-attachments-host');
  markSlot(attachmentsHost);
  card.appendChild(attachmentsHost);

  /* ── DraftEditor：`.scroll > .grow > (.input + .placeholder)` ── */
  const scroll = el('div', 'dsh-inputbar-scroll');
  scroll.dataset.inputScroll = '';
  const grow = el('div', 'dsh-inputbar-grow');

  /* ⚠️ 硬性约定 ②：**这一个** contenteditable 走两个状态，永不重建。 */
  const inputEl = el('div', 'dsh-inputbar-input');
  inputEl.setAttribute('contenteditable', 'true');
  inputEl.setAttribute('role', 'textbox');
  inputEl.setAttribute('aria-multiline', 'true');
  inputEl.dataset.composerInput = '';
  /* 原版 `tabIndex={workspaceTrigger ? 0 : undefined}`：有会话时**没有** tabindex。 */
  if (hasSession && !workspaceTrigger) inputEl.setAttribute('tabindex', '0');
  if (workspaceTrigger) {
    inputEl.setAttribute('tabindex', '0');
    inputEl.setAttribute('aria-haspopup', 'menu');
    inputEl.setAttribute('aria-expanded', String(opts.workspacePickerOpen === true));
  }
  /* 原版把占位符同时当可访问名（`aria-label={ariaLabel}`）与 `data-placeholder`。 */
  const placeholderEl = el('div', 'dsh-inputbar-placeholder');
  placeholderEl.setAttribute('aria-hidden', 'true');
  placeholderEl.dataset.composerPlaceholder = '';

  /* 中文 IME 组合期：原版靠 `data-composer-composing` 让 `::after` 与占位符让位。 */
  inputEl.addEventListener('compositionstart', () => { inputEl.dataset.composerComposing = ''; });
  inputEl.addEventListener('compositionend', () => { delete inputEl.dataset.composerComposing; });

  grow.appendChild(inputEl);
  /**
   * ⚠️⚠️ **占位符靠挂载/卸载控制显隐，不能用 `hidden` 属性。**
   *
   * `[hidden]` 在 CSS 里只是一条 **UA 规则**（`display: none`），优先级低于任何作者样式。
   * 而 hero 变体有一条 `.dsh-inputbar-hero .dsh-inputbar-placeholder { display: -webkit-box }`
   * （用来做两行截断，照抄自原版）—— 它把 `[hidden]` 压掉，于是**占位符永远可见**，
   * 与用户输入的文字叠在同一行上。
   *
   * 原版是 React 条件渲染（`{showPlaceholder && <div …/>}`），DOM 里根本没有这个节点，
   * 所以不存在这个问题。这里用同样的语义：**该显示时才挂上去**。
   */
  scroll.appendChild(grow);
  card.appendChild(scroll);

  /**
   * **点卡片任意空白处都聚焦输入面。**
   *
   * 不加这个的话，卡片里那块**不属于任何子元素**的空白（内容区上下的内边距、
   * 内容与工具行之间的间隙）点下去什么都不会发生。卡片 98px 高，可编辑面
   * 只有 36px，两者之间的区域点下去命中的是 `.card` 本身，而它上面没有聚焦逻辑。
   *
   * ⚠️ 三条边界：
   *   · **在 `pointerdown` 上做**（`click` 太晚，会与按钮的默认行为打架）；
   *   · **交互元素上不抢**（按钮 / 输入框 / 可编辑区自己会处理；抢了会破坏
   *     按钮的 `keepFocus` 与附件轨的删除钮）；
   *   · **不 `preventDefault()`** —— 让原生选区行为（点已选中的文字、拖选）
   *     照常工作，只在目标不是交互元素时补一次 `focus()`。
   */
  card.addEventListener('pointerdown', event => {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    if (target.closest('button, input, select, textarea, a, [contenteditable]')) return;
    inputEl.focus({ preventScroll: true });
  });

  /* ── `.row` ──────────────────────────────────────────────────── */
  const row = el('div', 'dsh-inputbar-row');

  /* `.tools[hidden={activity}]` */
  const tools = el('div', 'dsh-inputbar-tools');
  const addBtn = el('button', 'dsh-inputbar-add');
  addBtn.type = 'button';
  addBtn.setAttribute('aria-haspopup', 'listbox');
  addBtn.setAttribute('aria-expanded', 'false');
  addBtn.appendChild(icon('plusMedium'));
  addBtn.addEventListener('mousedown', keepFocus);
  addBtn.addEventListener('click', () => {
    if (opts.onToggleCommandMenu) opts.onToggleCommandMenu({ caretSpan: caretSpan() });
  });
  tools.appendChild(addBtn);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.hidden = true;
  fileInput.addEventListener('change', () => {
    const picked = fileInput.files === null ? [] : Array.from(fileInput.files);
    /* Reset so picking the same file again re-fires the change event. */
    fileInput.value = '';
    if (picked.length > 0 && opts.onPickFiles) opts.onPickFiles(picked);
  });
  tools.appendChild(fileInput);

  const modes = el('div', 'dsh-inputbar-modes');
  tools.appendChild(modes);
  const leftSlot = el('div', 'dsh-inputbar-left-slot');
  markSlot(leftSlot);
  tools.appendChild(leftSlot);

  row.appendChild(tools);

  /* `.trailing` —— `activity` 时换成 `.trailingActive`。 */
  const trailing = el('div', 'dsh-inputbar-trailing');

  /* `.standardControls[hidden={activity}]` */
  const standardControls = el('div', 'dsh-inputbar-standard-controls');
  const rightSlot = el('div', 'dsh-inputbar-right-slot');
  const modelSlot = el('div', 'dsh-inputbar-model-slot');
  markSlot(rightSlot);
  markSlot(modelSlot);
  /** 建立清空当前对话的按钮；对话图片由回调保留。 */
  let clearButton = null;
  if (typeof opts.onClearConversation === 'function') {
    clearButton = el('button', 'dsh-inputbar-clear');
    clearButton.type = 'button';
    clearButton.appendChild(icon('trash'));
    const clearLabel = t('input.clearConversation', undefined, opts.text);
    clearButton.setAttribute('aria-label', clearLabel);
    clearButton.title = clearLabel;
    clearButton.addEventListener('mousedown', keepFocus);
    clearButton.addEventListener('click', () => { opts.onClearConversation(); });
    standardControls.appendChild(clearButton);
  }
  standardControls.appendChild(rightSlot);
  standardControls.appendChild(modelSlot);
  trailing.appendChild(standardControls);

  /* `.activity` ↔ `.activityExpanded`，外层容器常驻。 */
  const activityHost = el('div', 'dsh-inputbar-activity');
  activityHost.dataset.composerActivity = '';
  trailing.appendChild(activityHost);
  const activitySlot = el('div', 'dsh-inputbar-activity-slot');
  markSlot(activitySlot);
  activityHost.appendChild(activitySlot);

  /* 可中断子代理（continuable）的独立停止钮：原版 `interruptible && <Tooltip><button.primary>`。 */
  let interruptButton = null;
  if (opts.interruptible === true) {
    interruptButton = el('button', 'dsh-inputbar-primary');
    interruptButton.type = 'button';
    stopSquare(interruptButton);
    interruptButton.setAttribute('aria-label', t('input.stop', undefined, opts.text));
    interruptButton.disabled = opts.onStop === undefined;
    interruptButton.addEventListener('mousedown', keepFocus);
    interruptButton.addEventListener('click', () => { if (opts.onStop) opts.onStop(); });
    trailing.appendChild(interruptButton);
  }

  /* 主钮：发送箭头 / 停止方块 —— **同一个节点**换内容，不换树。 */
  const sendButton = el('button', 'dsh-inputbar-primary');
  sendButton.type = 'button';
  trailing.appendChild(sendButton);
  sendButton.addEventListener('mousedown', keepFocus);
  /**
   * ⚠️⚠️ **主钮不能用 `disabled` 属性。**
   *
   * 浏览器规范：**禁用的表单控件不接收任何鼠标事件**（`pointerdown` /
   * `mousedown` / `click` 都不派发），所以空草稿时点它**完全没反应**，
   * 连"你还没输入内容"这个提示都给不出来。
   *
   * 所以这里照 DSH 处理分支按钮（`MessageIconActions` 的 branch）的同一套做法：
   *   · **不设 `disabled`** —— 按钮始终可点、可聚焦、能收到事件；
   *   · 用 **`aria-disabled`** 表达语义上的不可用（读屏软件照常播报）；
   *   · 用 **`data-inactive`** 驱动视觉（样式表里换成 40% 透明 + 默认光标）；
   *   · 该不该发**在点击时判断** —— 发不出去就把光标送进输入框。
   */
  sendButton.addEventListener('click', () => {
    if (primaryStops()) { if (opts.onStop) opts.onStop(); return; }
    /** 空草稿 / 无会话 / 忙 / 附件还在传：不发，但把光标给用户。 */
    if (sendButton.dataset.inactive !== undefined) { inputEl.focus({ preventScroll: true }); return; }
    if (opts.onSend) opts.onSend({ text: readInputText(inputEl), mode: submitMode() });
  });

  row.appendChild(trailing);
  card.appendChild(row);
  root.appendChild(card);

  /* ── `.dock`：底部信息条本体（原版放 ContextMeter，**本项目不统计用量**） ── */
  const dock = el('div', 'dsh-inputbar-dock');
  dock.dataset.composerDock = '';
  const composerDockSlot = el('div', 'dsh-inputbar-composer-dock-slot');
  markSlot(composerDockSlot);
  dock.appendChild(composerDockSlot);
  /**
   * ⚠️ **不建 `meterHost`：本项目不统计用量。**
   *
   * `.dsh-inputbar-meter-host` 在计量环缺席时就是个死节点（只在 `render()` 里
   * 被写 `style.display`），留着会让人以为那儿还该有东西。
   *
   * `.dock` 本身保留（它是原版的结构，且 `composerDockSlot` 是将来挂
   * 统计胶囊的位置），只是**没有内容时整个隐掉**，不占视觉。
   */
  root.appendChild(dock);

  /* ── 状态推导（逐条对照 InputBar.tsx:139-155, 303-322） ────────── */

  /** `InputBar.tsx:139` —— `locked = disabled`。 */
  function locked() {
    return disabled || blocked !== undefined;
  }

  /**
   * `InputBar.tsx:152` —— `editorDisabled = removed || (locked && !workspaceTrigger)`。
   *
   * 无会话且**不是**工作区触发器时编辑器同样是禁用的（原版 `!live` 进 `locked`）；
   * 只有当整张卡变成工作区选择触发器时，那个常驻 `div` 才反过来**可聚焦**。
   */
  function editorDisabled() {
    if (workspaceTrigger) return false;
    return locked() || !hasSession;
  }

  /** `InputBar.tsx:80` —— 空 = 草稿 trim 后为空**且**没有附件。 */
  function isEmpty() {
    return readInputText(inputEl).trim() === '' && attachments.length === 0;
  }

  /** `InputBar.tsx:303` —— 普通运行中的空草稿（或被 block）时，主钮变成停止。 */
  function primaryStops() {
    return busy && runningFlags.running;
  }

  /** `InputBar.tsx:307` —— 主钮措辞与提交模式。 */
  function submitMode() {
    return resolveSubmitMode(runningFlags.running, runningFlags.canSteerQueue, true);
  }

  /** `InputBar.tsx:309-313` —— 主钮 `aria-label`。 */
  function primaryLabel() {
    if (primaryStops()) return t('input.stop', undefined, opts.text);
    const draft = readInputText(inputEl);
    const plainMessageDraft = draft.trim() !== '' && !draft.trimStart().startsWith('/');
    if (runningFlags.running && !locked() && plainMessageDraft) {
      return t(submitMode() === 'steer' ? 'input.send.steer' : 'input.send.queue', undefined, opts.text);
    }
    return t('input.send', undefined, opts.text);
  }

  /** `InputBar.tsx:343-352` —— 占位符（owner prop 压过一切）。 */
  function placeholderText() {
    if (opts.placeholder !== undefined) return opts.placeholder;
    if (disabled) return t('placeholder.unavailable', undefined, opts.text);
    if (runningFlags.canSteerQueue) return t('placeholder.steerQueue', undefined, opts.text);
    return t('placeholder.default', undefined, opts.text);
  }

  /** 草稿末尾的 caret span（原版 `keyboard.caretSpan()`）。 */
  function caretSpan() {
    const text = readInputText(inputEl);
    return { start: text.length, end: text.length };
  }

  /** 按钮按下不抢焦点 —— 照抄 `view-binding.ts:152-155`。 */
  function keepFocus(e) {
    e.preventDefault();
    inputEl.focus({ preventScroll: true });
  }

  /** `.primary` 里的停止方块（16×16，rect 3..13 rx 3）。 */
  function stopSquare(button) {
    button.textContent = '';
    const svg = svgEl('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true' });
    svg.appendChild(svgEl('rect', { x: 3, y: 3, width: 10, height: 10, rx: 3, fill: 'currentColor' }));
    button.appendChild(svg);
  }

  /** `.primary` 里的发送箭头（原版那条 path，逐字）。 */
  function sendArrow(button) {
    button.textContent = '';
    const svg = svgEl('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true' });
    svg.appendChild(svgEl('path', {
      d: 'M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z',
      fill: 'currentColor',
    }));
    button.appendChild(svg);
  }

  /** 重画所有由状态决定的东西（**只改属性/类名/子节点内容，不换树**）。 */
  function render() {
    /* activity：类名互换 + `hidden` 属性 —— 约定 ①。 */
    trailing.className = clsx('dsh-inputbar-trailing', activity && 'dsh-inputbar-trailing-active');
    tools.hidden = activity;
    standardControls.hidden = activity;
    activityHost.className = activity ? 'dsh-inputbar-activity-expanded' : 'dsh-inputbar-activity';

    /* 编辑器 disabled 态：`aria-disabled` + 类名（原版两条都写）。 */
    const inertEditor = editorDisabled();
    inputEl.setAttribute('contenteditable', inertEditor ? 'false' : 'true');
    inputEl.className = clsx('dsh-inputbar-input', inertEditor && 'dsh-inputbar-input-disabled');
    if (inertEditor) inputEl.setAttribute('aria-disabled', 'true');
    else inputEl.removeAttribute('aria-disabled');
    inputEl.dataset.phase = opts.session === false ? 'inert' : 'plain';

    /* 占位符：`showPlaceholder = draft === '' && attachments.length === 0 && !claimActive`。 */
    const text = placeholderText();
    inputEl.dataset.placeholder = text;
    inputEl.setAttribute('aria-label', workspaceTrigger
      ? t('hero.chooseWorkspace', undefined, opts.text)
      : text);
    placeholderEl.textContent = text;
    /**
     * 显隐用**挂载/卸载**（原版 `{showPlaceholder && <div/>}` 的等价语义）——
     * 不能用 `hidden`：hero 变体的 `display: -webkit-box` 会把它压掉（见占位符建节点处）。
     */
    const showPlaceholder = readInputText(inputEl) === '' && attachments.length === 0;
    if (showPlaceholder && placeholderEl.parentNode !== grow) grow.appendChild(placeholderEl);
    else if (!showPlaceholder && placeholderEl.parentNode === grow) grow.removeChild(placeholderEl);

    /* 附件门：原版 `send` 要等所有文件就绪（这里用同一条 `uploadsPending` 语义）。 */
    const uploadsPending = attachments.some(a => a.kind === 'file' && a.status !== undefined && a.status !== 'ready');

    /* 主钮：停止态 vs 发送态。 */
    const stops = primaryStops();
    const label = primaryLabel();
    sendButton.setAttribute('aria-label', label);
    sendButton.dataset.action = stops ? 'stop' : 'send';
    /**
     * ⚠️ **不用 `disabled`**（理由见按钮上那段注释：禁用元素收不到鼠标事件，
     * 点它会"死"）。这里改用 `aria-disabled` + `data-inactive`：
     * 语义与视觉都表达"不可用"，但事件照收，点击时再判断。
     */
    const inactive = stops
      ? opts.onStop === undefined
      : (isEmpty() || locked() || busy || uploadsPending);
    if (inactive) {
      sendButton.setAttribute('aria-disabled', 'true');
      sendButton.dataset.inactive = '';
    } else {
      sendButton.removeAttribute('aria-disabled');
      delete sendButton.dataset.inactive;
    }
    if (stops) {
      stopSquare(sendButton);
    } else {
      sendArrow(sendButton);
    }
    sendButton.title = label;

    /* `+` 与 file input。 */
    addBtn.disabled = locked() || opts.onToggleCommandMenu === undefined;
    addBtn.setAttribute('aria-label', t('input.commands', undefined, opts.text));
    addBtn.title = addBtn.getAttribute('aria-label');
    fileInput.disabled = false;
    fileInput.setAttribute('aria-label', t('input.file', undefined, opts.text));

    /* 停靠栏：`composer` + 有会话才挂 composer dock；activity 展开时整块 ContextMeter 不渲染。
       ⚠️ 两条都写**行内 `display`** 而不是 `hidden` 属性 —— 包裹层是
       `display: contents`，`hidden` 的 UA 规则会被压掉（与原版 scoped-slots
       直接写行内 `display: contents / none` 一致）。 */
    composerDockSlot.style.display = variant === 'composer' && hasSession ? 'contents' : 'none';

    row.dataset.composerRow = '';
  }

  /* 首次渲染 + 初始草稿。 */
  if (opts.initialText) writeInputText(inputEl, opts.initialText);
  else writeInputText(inputEl, '');
  render();

  /* slot 内容注入（常驻容器，值换节点不换容器）。 */
  mountSlot(overlayAnchor, opts.slots && opts.slots.overlay);
  mountSlot(accessory, opts.slots && opts.slots.accessory, { hideWhenEmpty: true });
  mountSlot(attachmentsHost, opts.slots && opts.slots.attachments);
  mountSlot(modes, [
    hasSession ? opts.slots && opts.slots.permission : null,
    hasSession ? opts.slots && opts.slots.plan : null,
  ]);
  mountSlot(leftSlot, hasSession ? opts.slots && opts.slots.left : null);
  mountSlot(rightSlot, hasSession ? opts.slots && opts.slots.right : null);
  mountSlot(modelSlot, hasSession ? opts.slots && opts.slots.model : null);
  mountSlot(activitySlot, hasSession ? opts.slots && opts.slots.activity : null);
  mountSlot(composerDockSlot, opts.slots && opts.slots.composerDock);

  /* 草稿口的 wheel 链（InputBar.tsx:201-203，一次生命周期）。 */
  const disposeWheel = installDraftWheel(scroll);

  /** 草稿变了：占位符与主钮状态跟着走（原版是 re-render）。 */
  function onDraftChanged() {
    if (readInputText(inputEl) === '' && inputEl.querySelectorAll('p').length === 0) {
      writeInputText(inputEl, '');
    }
    render();
  }
  inputEl.addEventListener('input', onDraftChanged);
  inputEl.addEventListener('keyup', () => { revealDraftSelection(scroll); });

  /** Enter 提交 / 加速 Enter 插话全队列（keymap.ts 的 Enter 分支语义）。 */
  inputEl.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    if (locked() || busy) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if (opts.onSteerQueue) { opts.onSteerQueue(); return; }
    }
    if (isEmpty()) return;
    if (opts.onSend) opts.onSend({ text: readInputText(inputEl), mode: submitMode() });
  });

  /* 无会话触发器：Enter / 空格请求工作区（InputBar.tsx:286-292）。 */
  inputEl.addEventListener('keydown', e => {
    if (!workspaceTrigger) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (opts.onRequestWorkspace) opts.onRequestWorkspace();
    }
  });

  return {
    root,
    card,
    row,
    inputEl,
    dock,
    fileInput,
    sendButton,
    stopButton: sendButton,
    variant,
    /** `setBusy(true)` → 运行中：主钮变停止方块、发送态失能（`machineBusy`/`running` 的合成）。 */
    setBusy(value) {
      busy = Boolean(value);
      runningFlags.running = Boolean(value);
      render();
    },
    /** 写草稿（**同一个 contenteditable**）。 */
    setText(value) {
      writeInputText(inputEl, String(value === undefined || value === null ? '' : value));
      render();
    },
    getText() { return readInputText(inputEl); },
    setDisabled(value) { disabled = Boolean(value); render(); },
    /** 有无会话：只改 inert 态，**不换树** —— 约定 ②。 */
    setSession(value) {
      hasSession = Boolean(value);
      opts.session = hasSession;
      render();
    },
    /** 对应原版 `onActiveChange`：activity 胶囊展开时工具行与标准控件只隐藏不卸载。 */
    setActivity(value) { activity = Boolean(value); render(); },
    /** info notice 条。 */
    setNotice(level, text = '') {
      if (!level) { noticeEl.hidden = true; noticeEl.textContent = ''; return; }
      noticeEl.hidden = level !== 'info';
      noticeEl.textContent = text;
    },
    /** toast 槽（原版由 Toast 组件自己挂；这里只给容器与显隐）。 */
    setToast(text = '') {
      toastHost.hidden = text === '';
      toastHost.textContent = text;
    },
    /** 附件门数据（原版 `resolveDraftAttachments(input.attachmentIds)` 的等价物）。 */
    setAttachments(next) { attachments = Array.isArray(next) ? next : []; render(); },
    /** 窄卡片：`data-model-compact`（原版由 `observeControlRow` 写）。 */
    compact(value = true) {
      if (value) row.dataset.modelCompact = '';
      else delete row.dataset.modelCompact;
    },
    /** 把焦点送回草稿并把 caret 放到末尾。 */
    focus() { inputEl.focus({ preventScroll: true }); caretToEnd(inputEl); revealDraftSelection(scroll); },
    /** 外部接管时用：链式 slot 的 fallback 显隐（约定 ①）。 */
    setFallback(elected) { setSlotFallback(root, elected); },
    /** 观察座高并写 `--dsh-composer-height`（约定 ③，`observeHeight` 的便捷入口）。 */
    observeHeight: () => {
      const seat = root.closest('.dsh-composer-seat');
      if (!seat) return { measure() { return 0; }, disconnect() {}, height: () => 0 };
      return observeHeight(seat);
    },
    /** 导出投影函数，供调用方渲染已发/排队的用户文本。 */
    projectUserText,
    get attachments() { return attachments.slice(); },
    get locked() { return locked(); },
    get busy() { return busy; },
    setRunning(value) { runningFlags.running = Boolean(value); render(); },
    setCanSteerQueue(value) { runningFlags.canSteerQueue = Boolean(value); render(); },
    setPlaceholder(value) { opts.placeholder = value; render(); },
    dispose() { disposeWheel(); },
    __render: render,
  };

  /**
   * 把 slot 值挂进常驻容器（值可以是节点、节点数组、或 null）。
   *
   * 与原版的差别：React 里 `renderSlot` 每次渲染都产出新内容、按 key 调和；
   * 原生 JS 这里只在**建卡时**挂一次，重复调用会先清空再挂
   * （对应 `scoped-slots.tsx` 里 `[data-slot]` 包裹层的内容替换）。
   * `hideWhenEmpty` 管的是"空则整层不占位"，用行内 `display` 而不是 `hidden`
   * —— 因为包裹层本身可能已经是 `display: contents`（见 CSS 桥接层）。
   * @param {HTMLElement} host
   * @param {Node|Node[]|null|undefined} value
   * @param {{hideWhenEmpty?:boolean}} [options]
   */
  function mountSlot(host, value, { hideWhenEmpty = false } = {}) {
    if (host.dataset.composerSlot === undefined && host !== toastHost && host !== overlayAnchor) markSlot(host);
    host.textContent = '';
    const nodes = (value === null || value === undefined ? [] : Array.isArray(value) ? value : [value])
      .filter(Boolean);
    for (const node of nodes) host.appendChild(node);
    if (hideWhenEmpty) host.hidden = nodes.length === 0;
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * 上下文占用环 + 分解面板 —— ContextMeter.tsx
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * 底部信息条本体：环 + 百分比 + 点开的分解面板。
 *
 * ⚠️ 原版 `if (context === null) return null` —— `usedTokens` 与 `windowTokens`
 * 缺一个就**什么都不渲染**（ContextMeter.tsx:89）。这里同样：`root.hidden = true`
 * 且不进任何内容（节点仍在树上，符合"不卸载"的总体风格）。
 *
 * @param {object} [options]
 * @param {number}  [options.percent]      覆盖率（缺省按 usedTokens/windowTokens 算）
 * @param {number}  [options.usedTokens]
 * @param {number}  [options.windowTokens]
 * @param {{systemTokens:number, toolsTokens:number, messageTokens:number}|null} [options.breakdown]
 * @param {boolean} [options.open]         初始是否展开面板
 * @param {object}  [options.text]         覆盖文案
 * @param {HTMLElement} [options.portalHost] 面板挂载点，默认 `document.body`（原版 createPortal）
 * @returns {{root:HTMLElement, trigger:HTMLButtonElement, fill:SVGCircleElement,
 *            panel:HTMLElement|null, update:(data:object)=>void, setOpen:(v:boolean)=>void,
 *            isOpen:()=>boolean, dispose:()=>void}}
 */
function contextMeter(options = {}) {
  const opts = options;
  let open = opts.open === true;
  /** @type {{percent:number,usedTokens:number,windowTokens:number}|null} */
  let context = null;
  let breakdown = opts.breakdown === undefined ? null : opts.breakdown;
  let panel = null;

  const root = el('span', 'dsh-ctxmeter-root');

  const trigger = el('button', 'dsh-ctxmeter-trigger');
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'dialog');

  const svg = svgEl('svg', { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': 'true' });
  svg.appendChild(svgEl('circle', { class: 'dsh-ctxmeter-track', cx: 7, cy: 7, r: RING_RADIUS }));
  const fill = svgEl('circle', { class: 'dsh-ctxmeter-fill', cx: 7, cy: 7, r: RING_RADIUS, transform: 'rotate(-90 7 7)' });
  svg.appendChild(fill);
  trigger.appendChild(svg);
  const readingEl = el('span');
  trigger.appendChild(readingEl);
  root.appendChild(trigger);

  /* `useDismissOnOutsidePointer(rootRef, open && available, setOpen, panelRef)`。 */
  const onPointerDown = e => {
    if (!open) return;
    if (root.contains(e.target)) return;
    if (panel && panel.contains(e.target)) return;
    setOpen(false);
  };
  /* `useEffect(… Escape …)`。 */
  const onKeyDown = e => { if (e.key === 'Escape') setOpen(false); };
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown);

  /**
   * 重画：环描边长度、百分比文本、面板（**面板节点复用，不每次重建**）。
   * @param {object} data
   */
  function update(data = {}) {
    context = contextOccupancy({
      usedTokens: data.usedTokens === undefined ? opts.usedTokens : data.usedTokens,
      windowTokens: data.windowTokens === undefined ? opts.windowTokens : data.windowTokens,
      percent: data.percent === undefined ? opts.percent : data.percent,
    });
    if (data.breakdown !== undefined) breakdown = data.breakdown;
    if (data.open !== undefined) open = data.open;

    if (context === null) {
      root.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      destroyPanel();
      return;
    }
    root.hidden = false;

    const percent = context.percent;
    const reading = `${percent}%`;
    /* `CIRCUMFERENCE * percent / 100` + 整周长 —— ContextMeter.tsx:126。 */
    fill.setAttribute('stroke-dasharray', `${RING_CIRCUMFERENCE * percent / 100} ${RING_CIRCUMFERENCE}`);
    readingEl.textContent = reading;

    const aria = t('context.aria', { percent: reading }, opts.text);
    trigger.setAttribute('aria-label', aria);
    trigger.title = aria;
    trigger.setAttribute('aria-expanded', String(open));

    if (!open) { destroyPanel(); return; }
    ensurePanel(percent, reading);
  }

  /** 面板：`role="dialog"` + `style` 定位，`position ?? {visibility:'hidden',left:0,top:0}`。 */
  function ensurePanel(percent, reading) {
    const host = opts.portalHost || document.body;
    if (!panel) {
      panel = el('div', 'dsh-ctxmeter-panel');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', t('context.used', undefined, opts.text));
      panel.dataset.composerMeterPanel = '';
      host.appendChild(panel);
    }
    panel.textContent = '';

    /* 本地化占用句按读音槽切分（ContextMeter.tsx:92-94）。 */
    const parts = t('context.aria', { percent: READING_SLOT }, opts.text).split(READING_SLOT).map(s => s.trim());
    const headBefore = parts[0] === undefined ? '' : parts[0];
    const headAfter = parts[1] === undefined ? '' : parts[1];

    const header = el('div', 'dsh-ctxmeter-header');
    header.appendChild(el('span', 'dsh-ctxmeter-headline', headBefore));
    header.appendChild(el('span', 'dsh-ctxmeter-percent', reading));
    header.appendChild(el('span', 'dsh-ctxmeter-headline', headAfter));
    /* `~`：usedTokens 优先取 projectedTokens，其表面差值是启发式重估的。 */
    header.appendChild(el('span', 'dsh-ctxmeter-figures',
      `~${formatTokens(context.usedTokens, opts.text)} / ${formatTokens(context.windowTokens, opts.text)}`));
    panel.appendChild(header);

    /* 色条：整长保持提供方给的精确百分比，启发式分解只决定各色段的比例。 */
    const bar = el('div', 'dsh-ctxmeter-bar');
    const total = breakdown === null || breakdown === undefined
      ? 0
      : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens;
    const partsOfBar = breakdown === null || breakdown === undefined || total === 0
      ? [{ color: null, width: percent }]
      : BREAKDOWN_ROWS.map(row => ({ color: row.color, width: percent * breakdown[row.key] / total }));
    for (const segment of partsOfBar.filter(s => s.width > 0)) {
      const node = el('div', clsx('dsh-ctxmeter-segment', segment.color));
      node.style.width = `${segment.width}%`;
      bar.appendChild(node);
    }
    panel.appendChild(bar);

    if (breakdown !== null && breakdown !== undefined) {
      const rows = el('dl', 'dsh-ctxmeter-rows');
      for (const row of BREAKDOWN_ROWS) {
        const rowEl = el('div', 'dsh-ctxmeter-row');
        const dt = el('dt');
        const swatch = el('span', clsx('dsh-ctxmeter-swatch', row.color));
        swatch.setAttribute('aria-hidden', 'true');
        dt.appendChild(swatch);
        dt.appendChild(document.createTextNode(t(row.label, undefined, opts.text)));
        rowEl.appendChild(dt);
        rowEl.appendChild(el('dd', '', `~${formatTokens(breakdown[row.key], opts.text)}`));
        rows.appendChild(rowEl);
      }
      panel.appendChild(rows);
    }

    positionPanel();
  }

  /**
   * 面板定位 —— 原版 `useAnchoredPosition({ side:'top', gap:8, margin:12 })`。
   * 量不到尺寸时保留原版那条 fallback 行内样式。
   */
  function positionPanel() {
    if (!panel) return;
    const box = root.getBoundingClientRect ? root.getBoundingClientRect() : null;
    if (!box || (box.width === 0 && box.height === 0 && box.top === 0)) {
      panel.style.visibility = 'hidden';
      panel.style.left = '0px';
      panel.style.top = '0px';
      return;
    }
    const width = panel.offsetWidth || 264;
    const height = panel.offsetHeight || 0;
    const margin = 12;
    const gap = 8;
    const viewportWidth = window.innerWidth || 0;
    const left = Math.max(margin, Math.min(box.left, Math.max(margin, viewportWidth - width - margin)));
    const top = Math.max(margin, box.top - gap - height);
    panel.style.visibility = 'visible';
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function destroyPanel() {
    if (!panel) return;
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
  }

  /** 原版 `onClick={() => { setOpen(!open) }}`。 */
  function setOpen(value) {
    const next = Boolean(value);
    if (next === open) { update({}); return; }
    open = next;
    update({});
    if (open) ensurePanel(context === null ? 0 : context.percent, `${context === null ? 0 : context.percent}%`);
  }

  trigger.addEventListener('click', () => { setOpen(!open); });
  window.addEventListener('resize', positionPanel);

  update({});

  return {
    root,
    trigger,
    fill,
    get panel() { return panel; },
    update,
    setOpen,
    isOpen: () => open,
    /** 关闭面板并摘掉两个全局监听。 */
    dispose() {
      destroyPanel();
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', positionPanel);
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════
 * 待办面板 —— TodoPanel.tsx
 * ═══════════════════════════════════════════════════════════════════ */

/** 头部概要：`·` 连接的各状态计数（空段省略），`·` 两侧是 en space（U+2002）。 */
function todoProgressLabel(todos, dict) {
  const done = todos.filter(item => item.status === 'completed').length;
  const active = todos.filter(item => item.status === 'in_progress').length;
  const pending = todos.length - done - active;
  return [
    ...done > 0 ? [t('todo.progress.done', { done }, dict)] : [],
    ...active > 0 ? [t('todo.progress.active', { active }, dict)] : [],
    ...pending > 0 ? [t('todo.progress.pending', { pending }, dict)] : [],
  ].join('\u2002·\u2002');
}

/**
 * 待办面板（`conversation.input.dock` 里 id='todo', order=0 那个条目）。
 *
 * 折叠默认 `true`（TodoPanel.tsx:66）。列表**不卸载**，靠 `hidden` 切换
 * —— 与全项目的"只切显示"一致。
 * @param {object} [options]
 * @param {Array<{content:string,status:'completed'|'in_progress'|'pending'}>} [options.todos]
 * @param {boolean} [options.collapsed]
 * @param {object}  [options.text]
 * @returns {{root:HTMLElement, body:HTMLElement, list:HTMLElement, update:(todos:Array)=>void,
 *            setCollapsed:(v:boolean)=>void, isCollapsed:()=>boolean}}
 */
function todoPanel(options = {}) {
  const opts = options;
  let todos = Array.isArray(opts.todos) ? opts.todos.slice() : [];
  let collapsed = opts.collapsed !== false;

  const root = el('section', 'dsh-todopanel-root');
  root.dataset.testid = 'todo-panel';
  const body = el('div', 'dsh-todopanel-body');

  const header = el('button', 'dsh-todopanel-header');
  header.type = 'button';
  const lead = el('span', 'dsh-todopanel-lead');
  lead.setAttribute('aria-hidden', 'true');
  lead.appendChild(icon('checklist'));
  header.appendChild(lead);
  header.appendChild(el('span', 'dsh-todopanel-title', t('todo.title', undefined, opts.text)));
  const progress = el('span', 'dsh-todopanel-progress');
  header.appendChild(progress);
  const chevron = el('span', 'dsh-todopanel-chevron');
  chevron.setAttribute('aria-hidden', 'true');
  header.appendChild(chevron);
  header.addEventListener('click', () => { setCollapsed(!collapsed); });
  body.appendChild(header);

  const list = el('ul', 'dsh-todopanel-list');
  list.hidden = true;
  body.appendChild(list);
  root.appendChild(body);

  /** 折叠切换：只换 `hidden` 与 chevron 图标。 */
  function setCollapsed(value) {
    collapsed = Boolean(value);
    header.setAttribute('aria-expanded', String(!collapsed));
    list.hidden = collapsed;
    chevron.textContent = '';
    chevron.appendChild(icon(collapsed ? 'chevronUp' : 'chevronDown'));
  }

  /** 重画列表（内容全换，节点结构与行数按数据来）。 */
  function update(next) {
    if (next !== undefined) todos = Array.isArray(next) ? next.slice() : [];
    /* `if (todos.length === 0) return null` —— 空清单整块不渲染。 */
    root.hidden = todos.length === 0;
    root.setAttribute('aria-label', t('todo.title', undefined, opts.text));
    progress.textContent = todoProgressLabel(todos, opts.text);
    list.textContent = '';
    for (const item of todos) {
      const row = el('li', 'dsh-todopanel-item');
      row.dataset.status = item.status;
      const glyph = el('span', 'dsh-todopanel-glyph');
      glyph.setAttribute('role', 'img');
      glyph.setAttribute('aria-label', t(TODO_STATUS_KEY[item.status] || 'todo.status.pending', undefined, opts.text));
      glyph.appendChild(stateDot(TODO_DOT[item.status] || 'idle'));
      row.appendChild(glyph);
      row.appendChild(el('span', 'dsh-todopanel-content', item.content));
      list.appendChild(row);
    }
    setCollapsed(collapsed);
  }

  update(todos);

  return {
    root,
    body,
    list,
    header,
    update,
    setCollapsed,
    isCollapsed: () => collapsed,
  };
}

/* ═══════════════════════════════════════════════════════════════════
 * 待发队列停靠栏 —— QueueDock.tsx
 * ═══════════════════════════════════════════════════════════════════ */

/** 预览截断长度（QueueDock.tsx:18 `QUEUE_PREVIEW_CHARS`）。 */
const QUEUE_PREVIEW_CHARS = 200;

/**
 * 队列行的预览文本（QueueDock.tsx:20-27 `previewOf` 的纯文本等价物）。
 * @param {string} text
 * @returns {string}
 */
function queuePreview(text) {
  const flat = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > QUEUE_PREVIEW_CHARS ? `${chars.slice(0, QUEUE_PREVIEW_CHARS).join('')}…` : flat;
}

/**
 * 待发队列停靠栏（`conversation.input.dock` 里 id='queue', order=20 那个条目）。
 *
 * 行数语义逐条对照 QueueDock.tsx：
 *   · 空队列**不渲染**（`if (rowCount === 0) return null`，:140）；
 *   · 单条直接展开、无计数头（`listVisible = rowCount === 1 || expanded`，:144）；
 *   · 多条默认折叠到计数头（`collapsed` 初值 `true`，:132）。
 *
 * @param {object} [options]
 * @param {Array<{id:string, text:string, mode:'queue'|'steer'}>} [options.items]
 * @param {Function} [options.onEdit]    `(id, currentText) => void`
 * @param {Function} [options.onRemove]  `(id) => void`
 * @param {Function} [options.onSteer]   `(id) => void`
 * @param {boolean}  [options.running]   决定"插话发送"是否可用（QueueDock.tsx:300-306）
 * @param {boolean}  [options.queueMutable] 原版 `subagent === null || continuable`
 * @param {boolean}  [options.collapsed]
 * @param {object}   [options.text]
 * @returns {{root:HTMLElement, panel:HTMLElement, list:HTMLElement,
 *            update:(items:Array)=>void, setCollapsed:(v:boolean)=>void,
 *            setRunning:(v:boolean)=>void, count:()=>number, isCollapsed:()=>boolean}}
 */
function queueDock(options = {}) {
  const opts = options;
  let items = Array.isArray(opts.items) ? opts.items.slice() : [];
  let collapsed = opts.collapsed !== false;
  let running = opts.running === true;
  let queueMutable = opts.queueMutable !== false;
  /** 正在提交的行 id（原版 `busy`）。 */
  let busyId = null;
  let listId = 0;

  const root = el('div', 'dsh-queuedock-dock');
  root.dataset.queueDock = '';
  const panel = el('div', 'dsh-queuedock-panel');

  const header = el('button', 'dsh-queuedock-header');
  header.type = 'button';
  const lead = el('span', 'dsh-queuedock-lead');
  lead.setAttribute('aria-hidden', 'true');
  lead.appendChild(icon('queue'));
  header.appendChild(lead);
  const countEl = el('span', 'dsh-queuedock-count');
  header.appendChild(countEl);
  const statusEl = el('span', 'dsh-queuedock-status');
  statusEl.setAttribute('role', 'status');
  statusEl.hidden = true;
  header.appendChild(statusEl);
  const chevron = el('span', 'dsh-queuedock-chevron');
  chevron.setAttribute('aria-hidden', 'true');
  header.appendChild(chevron);
  header.addEventListener('click', () => { setCollapsed(!collapsed); });
  panel.appendChild(header);

  const list = el('ul', 'dsh-queuedock-list');
  panel.appendChild(list);
  root.appendChild(panel);

  const interactionActive = () => queueMutable && busyId !== null;
  const expanded = () => !collapsed || interactionActive();
  const listVisible = () => items.length === 1 || expanded();

  /** 单条时行首那个队列图标（`rowCount === 1 && <span.lead>`）。 */
  function rowLead() {
    const node = el('span', 'dsh-queuedock-lead');
    node.setAttribute('aria-hidden', 'true');
    node.appendChild(icon('queue'));
    return node;
  }

  /** 行内三个动作钮：编辑 / 删除 / 插话（顺序与 QueueDock.tsx:266-317 一致）。 */
  function rowActions(item) {
    const actions = el('div', 'dsh-queuedock-actions');

    const editBtn = actionButton('edit', t('queue.edit', undefined, opts.text));
    editBtn.disabled = busyId !== null;
    editBtn.addEventListener('click', () => { if (opts.onEdit) opts.onEdit(item.id, item.text); });

    const removeBtn = actionButton('trash', t('queue.remove', undefined, opts.text));
    removeBtn.disabled = busyId !== null;
    removeBtn.addEventListener('click', () => {
      busyId = item.id;
      render();
      if (opts.onRemove) opts.onRemove(item.id);
      busyId = null;
      render();
    });

    const steerBtn = actionButton('send', t('queue.steer', undefined, opts.text));
    steerBtn.disabled = busyId !== null || !running;
    if (!running) steerBtn.title = t('queue.steer.unavailable', undefined, opts.text);
    steerBtn.addEventListener('click', () => {
      busyId = item.id;
      render();
      if (opts.onSteer) opts.onSteer(item.id);
      busyId = null;
      render();
    });

    actions.appendChild(editBtn);
    actions.appendChild(removeBtn);
    actions.appendChild(steerBtn);
    return actions;
  }

  function actionButton(iconName, label) {
    const button = el('button', 'dsh-queuedock-action');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.appendChild(icon(iconName, 14));
    return button;
  }

  /**
   * 完整重画。**面板与列表节点始终复用**，只有行按数据重建
   * （原版 React 也是按 key 重建 `<li>`）。
   */
  function render() {
    const rowCount = items.length;
    /* `if (rowCount === 0) return null` —— 空队列整块不渲染（保留节点，切 hidden）。 */
    root.hidden = rowCount === 0;
    if (rowCount === 0) return;

    header.hidden = rowCount <= 1;    header.setAttribute('aria-controls', `dsh-queuedock-list-${listId}`);
    header.setAttribute('aria-expanded', String(expanded()));
    header.disabled = interactionActive();
    countEl.textContent = t('queue.count', { n: rowCount }, opts.text);
    statusEl.hidden = listVisible();
    statusEl.textContent = t('queue.sending', undefined, opts.text);
    chevron.textContent = '';
    chevron.appendChild(icon(expanded() ? 'chevronDown' : 'chevronUp'));

    list.id = `dsh-queuedock-list-${listId}`;
    list.hidden = !listVisible();
    list.textContent = '';

    for (const item of items) {
      const row = el('li', 'dsh-queuedock-row');
      row.dataset.queueItem = item.id;
      row.dataset.queueMode = item.mode || 'queue';
      if (rowCount === 1) row.appendChild(rowLead());
      const preview = el('span', 'dsh-queuedock-preview');
      preview.appendChild(projectUserText(queuePreview(item.text)));
      row.appendChild(preview);
      if (queueMutable) row.appendChild(rowActions(item));
      list.appendChild(row);
    }
  }

  /** 折叠切换（`interactionActive` 时头钮禁用，与原版一致）。 */
  function setCollapsed(value) {
    collapsed = Boolean(value);
    render();
  }

  render();

  return {
    root,
    panel,
    list,
    header,
    update(next) {
      if (next !== undefined) items = Array.isArray(next) ? next.slice() : [];
      render();
    },
    setCollapsed,
    setRunning(value) { running = Boolean(value); render(); },
    setQueueMutable(value) { queueMutable = Boolean(value); render(); },
    setBusyId(value) { busyId = value === undefined ? null : value; render(); },
    count: () => items.length,
    isCollapsed: () => collapsed,
    items: () => items.slice(),
  };
}

/* ═══════════════════════════════════════════════════════════════════
 * composer 座/栈 —— ConversationRoot 的那两段（堆栈 gap 与座变量）
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * 建 composer 座：`.dsh-composer-seat > .dsh-composer-stack`。
 *
 * 座是 `--dsh-composer-text-max-height` 与（active 相位下）sticky/mask 的宿主；
 * 栈提供 `--dsh-composer-stack-gap` 并让各停靠卡共用一条节奏。
 * @param {object} [options]
 * @param {'hero'|'composer'} [options.phase]
 * @returns {{root:HTMLElement, seat:HTMLElement, stack:HTMLElement,
 *            setPhase:(p:string)=>void, observeHeight:(scroller?:HTMLElement)=>object}}
 */
function composerSeat(options = {}) {
  const opts = options;
  const seat = el('div', 'dsh-composer-seat');
  seat.dataset.composerSeat = '';
  seat.dataset.conversationRegion = 'composer';
  const stack = el('div', 'dsh-composer-stack');
  seat.appendChild(stack);

  /** 相位：`active`（停靠）/ `hero`（居中）/ `settling`（保留挂载但不可见）。 */
  function setPhase(phase) {
    seat.dataset.phase = phase;
    stack.className = clsx('dsh-composer-stack', phase === 'hero' && 'dsh-composer-hero');
  }
  setPhase(opts.phase === 'hero' ? 'hero' : 'composer');

  return {
    root: seat,
    seat,
    stack,
    setPhase,
    observeHeight(scroller) { return observeHeight(seat, scroller); },
    /** 链式 slot：fallback 与当选内容互斥时的显隐（约定 ①）。 */
    setFallback(elected) { setSlotFallback(seat, elected); },
  };
}

/**
 * 会话滚动宿主 + 座：`.dsh-convroot-scroll-body`（`--dsh-composer-height` 的落点）。
 * @param {object} [options]
 * @param {'active'|'hero'|'settling'} [options.phase]
 * @returns {{root:HTMLElement, scroller:HTMLElement, seat:object, dispose:()=>void}}
 */
function conversationScroll(options = {}) {
  const opts = options;
  const scroller = el('div', 'dsh-convroot-scroll-body');
  scroller.dataset.conversationScroll = '';
  const seat = composerSeat({ phase: opts.phase === 'hero' ? 'hero' : 'composer' });
  scroller.appendChild(seat.root);
  const height = observeHeight(seat.seat, scroller);
  return {
    root: scroller,
    scroller,
    seat,
    /** 内容尺寸变化后手动补一次测量（无 ResizeObserver 的环境用）。 */
    measure: height.measure,
    dispose: height.disconnect,
  };
}

/* ═══════════════════════════════════════════════════════════════════
 * 导出
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * **输入卡片内的待发图片轨** —— 照抄 DSH `ui-attachment` 的 `ComposerAttachments`。
 *
 * DSH 里它注册在 `conversation.input.attachments` 槽上；本项目的槽是
 * `inputBar` 的 `slots.attachments`（同一位置）。结构照原版：
 *
 *     div.rail
 *       div.imageItem
 *         button.thumbnail > img
 *         button.remove
 *
 * ⚠️ **图片来源是本项目自己的**：DSH 用 `attachment.previewUrl`，
 * 本项目用 `resolve(imageId)` 拿缩略图（`app-view.js` 的缩略图管道）。
 * 渲染结果一致，数据来源不同。
 *
 * @param {object} options
 * @param {Function} options.resolve      `(imageId) => url`（缩略图；空串则不画 img）
 * @param {Function} [options.onRemove]   `(imageId) => void`
 * @param {Function} [options.onOpen]     `(imageId) => void`（点缩略图）
 * @param {object}   [options.labels]     `{ pending, remove }` 文案
 * @returns {{root: HTMLElement, update: Function}}
 */
function composerAttachments(options = {}) {
  const labels = options.labels || {};
  const resolve = typeof options.resolve === 'function' ? options.resolve : () => '';
  const root = el('div', 'dsh-attr-rail');
  /** 节点表按 imageId 复用 —— 重复 update 不重建（约定 ①/③）。 */
  const mounted = new Map();

  function update(items) {
    const list = Array.isArray(items) ? items : [];
    const wanted = new Set();
    const order = [];
    for (const item of list) {
      const imageId = String(item?.imageId || item?.id || '');
      if (!imageId) continue;
      wanted.add(imageId);
      let node = mounted.get(imageId);
      if (node === undefined) {
        node = renderItem({ imageId, url: resolve(imageId) });
        mounted.set(imageId, node);
      }
      order.push(node);
    }
    /** 消失的图**移除**（数据里确实没有了，不是隐藏）。 */
    for (const [imageId, node] of mounted) {
      if (wanted.has(imageId)) continue;
      node.remove();
      mounted.delete(imageId);
    }
    /** 顺序整体重写 —— 用户可能调整过顺序，只 append 会错位。 */
    root.replaceChildren(...order);
  }

  function renderItem({ imageId, url }) {
    const item = el('div', 'dsh-attr-image-item');
    item.dataset.imageId = imageId;

    const thumbnail = el('button', 'dsh-attr-thumbnail');
    thumbnail.type = 'button';
    thumbnail.setAttribute('aria-label', labels.pending || '待发送的图片');
    if (url) {
      const img = el('img');
      img.src = url;
      img.alt = labels.pending || '待发送的图片';
      img.loading = 'lazy';
      img.decoding = 'async';
      thumbnail.appendChild(img);
    }
    thumbnail.addEventListener('click', () => { options.onOpen?.(imageId); });

    const remove = el('button', 'dsh-attr-remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', labels.remove || '移除这张图片');
    remove.appendChild(icon('close', 12));
    remove.addEventListener('click', event => {
      event.stopPropagation();
      options.onRemove?.(imageId);
    });

    item.append(thumbnail, remove);
    return item;
  }

  update(options.items);
  return { root, update };
}

const dshComposer = Object.freeze({
  /* 组件 */
  inputBar,
  contextMeter,
  todoPanel,
  queueDock,
  composerSeat,
  conversationScroll,
  composerAttachments,
  /* 约定 ③ */
  observeHeight,
  setSlotFallback,
  /* 纯函数（方便调用方复用同一套舍入/文案） */
  contextOccupancy,
  formatTokens,
  projectUserText,
  stateDot,
  icon,
  /* 几何常量（测试与调用方都可能要） */
  RING_RADIUS,
  RING_CIRCUMFERENCE,
  READING_SLOT,
  /** 文案表（zh，逐字取自 locales.ts）。 */
  text: ZH,
  t,
});

if (typeof window !== 'undefined') window.dshComposer = dshComposer;
if (typeof module !== 'undefined' && module.exports) module.exports = dshComposer;
})();
