'use strict';
/**
 * 聊天视图：消息气泡、轮次过程、工具详情、Markdown 正文与图片。
 * 消息和轮次来自会话投影，展开选择通过宿主 preferences 读写。
 * 消息、图标和轨迹原子件源自 github.com/deepseek-ai/deepseek-harness（MIT）。
 */
(function installDshChat() {
/** 原子件：优先浏览器全局（`dsh-primitives.js` 的导出），否则按相对路径 require。 */
function primitivesOf() {
  return (typeof window !== 'undefined' && window.dshPrimitives) || require('./dsh-primitives.js');
}
/** 轨迹行：`dsh-rows.js` 导出 `reasoningRow` / `toolRow` / `createDisclosure`。 */
function rowsOf() {
  return (typeof window !== 'undefined' && window.dshRows) || require('./dsh-rows.js');
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ═══════════════════════════════════════════════════════════════════
 * 文案：**挂载点，不是词表**
 *
 * DSH 的每一句产品文案都在 locale 字典里（`locale.ts`），组件只拿 `t` 座位。
 * 本项目没有那一层，所以这里给一份**与 DSH 英文档一一对应**的默认文案，
 * 同时允许 `chatView({ labels })` 整包替换 —— 中文宿主传中文，语义不变。
 * 这些 key 与 `ui-chat/src/client/locale.ts` 的 key 同名，便于逐个核对。
 * ═══════════════════════════════════════════════════════════════════ */
const DEFAULT_LABELS = Object.freeze({
  /** 思考行的标题与读屏文案（`ReasoningRow` 自己的 labels）。 */
  reasoningTitle: 'Thinking',
  reasoningRunning: 'Thinking',
  /** 工具行展开体的两栏标注。 */
  toolInput: 'Input',
  toolOutput: 'Output',
  /** 工具行的读屏状态词。 */
  toolStatusRunning: 'Running tool',
  toolStatusDone: 'Tool finished',
  toolStatusError: 'Tool failed',
  toolStatusStopped: 'Tool stopped',
  /** 图标行：复制 / 已复制 / 分支。 */
  copy: 'Copy',
  copied: 'Copied',
  /** 正文里的中断标记（`message.stopped`）。 */
  stopped: 'Stopped',
  /** 未知块的标题（`message.unknownBlock`）。 */
  unknownBlock: 'Unknown block',
  /** 一轮跑完的过程头（`message.turnProcess.worked` / `.took` / `.failed`）。 */
  turnProcessWorked: 'Completed',
  turnProcessTook: 'Completed in ',
  turnProcessFailed: 'Failed',
  /** 过程分组头的标题；给字符串或 `(group) => string`。 */
  groupLabel: 'Process',
  /** 底部运行状态（`chat.deepDiving` / `chat.deepDivingFor`）。 */
  deepDiving: 'Deep diving',
  deepDivingFor: 'Deep diving for {duration} ···',
  /**
   * 时长的三个单位（`duration.hourUnit` / `.minuteUnit` / `.secondUnit`）。
   * ⚠️ 前导空格是**文案的一部分**（DSH 英文档就是 `' s'`）：段与段之间 `join('')`。
   * 换中文档时传 `'秒'` / `'分'` / `'小时'` 即可。
   */
  hourUnit: ' h',
  minuteUnit: ' m',
  secondUnit: ' s'
});

/* ═══════════════════════════════════════════════════════════════════
 * message-chrome.ts 的两个格式化函数（逐行照抄）
 * ═══════════════════════════════════════════════════════════════════ */

const pad2 = value => String(value).padStart(2, '0');

/**
 * `formatMessageClock` —— 图标行的时钟。同一天只给 `HH:mm`；同年给「月日 + 时刻」；
 * 跨年给「年月日 + 时刻」。纯函数，`now` 可注入。
 * @param {number} time epoch ms
 * @param {number} [now] 参照时刻，默认当前
 * @returns {string}
 */
function formatMessageClock(time, now = Date.now()) {
  const d = new Date(time);
  const n = new Date(now);
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) {
    return clock;
  }
  const date = `${d.getMonth() + 1}/${d.getDate()}`;
  return d.getFullYear() === n.getFullYear() ? `${date} ${clock}` : `${d.getFullYear()}/${date} ${clock}`;
}

/**
 * `hasAssistantReplyContent` —— 是否含**给用户看的回复**（纯推理/工具不算）。
 * @param {ReadonlyArray<object>} blocks
 * @returns {boolean}
 */
function hasAssistantReplyContent(blocks) {
  return blocks.some((block) => {
    if (block.kind === 'reasoning' || block.kind === 'tool-call') return false;
    if (block.kind === 'text') return block.text.trim() !== '';
    return true;
  });
}

/**
 * `blockIsVisible`（`conversation-nodes/assistant.ts`）—— 这一块值不值得占位。
 * 空文字块 / 空推理块 / 工具块都算不可见，只留零高节点、不参与间距。
 * @param {object|undefined} block
 * @returns {boolean}
 */
function blockIsVisible(block) {
  if (block === undefined) return false;
  if (block.kind === 'tool-call') return false;
  if (block.kind === 'text' || block.kind === 'reasoning') return String(block.text ?? '').trim() !== '';
  return true;
}

/* ═══════════════════════════════════════════════════════════════════
 * 小图标
 *
 * DSH 的这些图标来自 `ui-primitives` 的图标表（`IconCopyOutlineRegular` 等），
 * 不在本次"只抄这些文件"的范围内，所以按同样的 24×24 / currentColor / stroke
 * 口径手绘同形。**形状是我画的，不是原图**（见回复里的存疑清单）。
 * ═══════════════════════════════════════════════════════════════════ */

/** `IconCopyOutlineRegular` —— 两个错开的圆角矩形。 */
function copyIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const front = document.createElementNS(SVG_NS, 'rect');
  front.setAttribute('x', '9');
  front.setAttribute('y', '9');
  front.setAttribute('width', '11');
  front.setAttribute('height', '11');
  front.setAttribute('rx', '2.5');
  const back = document.createElementNS(SVG_NS, 'path');
  back.setAttribute('d', 'M15 5.5A2.5 2.5 0 0 0 12.5 3H6.5A2.5 2.5 0 0 0 4 5.5v6A2.5 2.5 0 0 0 6.5 14');
  svg.append(front, back);
  return svg;
}

/** `IconCheckOutlineRegular` —— 复制成功后的对勾。 */
function checkIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M5 12.5 10 17.5 19 7');
  svg.appendChild(path);
  return svg;
}

function pencilIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '../assets/icons/favorites.svg#pencil');
  svg.append(use);
  return svg;
}

/** `IconBranchOutlineRegular` —— 分支（竖线 + 两条岔路）。 */
function branchIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M7 4v10a3 3 0 0 0 3 3h4M7 4a1.6 1.6 0 1 0 .01 0M17 13.5a1.6 1.6 0 1 0 .01 0M14 17l3-3.5');
  svg.appendChild(path);
  return svg;
}

/** 工具行的业务图标占位（DSH 每种工具一个图标，这里一个通用「星」）。 */
function toolIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3 6.3 17.7');
  svg.appendChild(path);
  return svg;
}

/* ═══════════════════════════════════════════════════════════════════
 * MessageIconActions.tsx —— 图标行
 * ═══════════════════════════════════════════════════════════════════ */

/** `useId` 的等价物：每个图标行一个稳定 id（分支不可用时的读屏理由）。 */
let actionRowSeq = 0;

/**
 * 写剪贴板。DSH 用 `writeClipboard`（带降级）；这里同样两级。
 * @param {string} text
 * @returns {Promise<boolean>}
 */
function writeClipboard(text) {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  if (nav?.clipboard?.writeText) return nav.clipboard.writeText(text).then(() => true, () => false);
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return Promise.resolve(ok);
  } catch { return Promise.resolve(false); }
}

/**
 * `MessageIconActions` —— 复制 / 分支（/ 时钟）。`clock` 决定时钟在图标前还是后。
 *
 * ⚠️ 原版的 Tooltip 来自 `ui-primitives`（本次不在范围内）。这里把悬浮提示
 * 做成**可注入**的：给了 `p.tooltip(node, label)` 就交给它，没给就退到
 * `title` 属性 —— 不自己造一套浮层。
 *
 * @param {object} options
 * @param {string} options.text      复制的内容
 * @param {'start'|'end'} options.clock
 * @param {number} [options.time]
 * @param {Function} [options.onBranch]
 * @param {boolean} [options.branchUnavailable]
 * @param {string} [options.className] 父模块给的布局类
 * @param {object} options.p 原子件
 * @param {object} options.labels
 * @returns {HTMLElement}
 */
function messageIconActions({ text, clock, time, onBranch, branchUnavailable = false, className = '', p, labels, tooltip }) {
  const actions = p.el('div', `dsh-iconactions-actions${className ? ` ${className}` : ''}`);
  actions.dataset.clock = clock;

  const clockEl = time === undefined ? null : p.el('span', clock === 'start' ? 'dsh-iconactions-timeStart' : 'dsh-iconactions-timeEnd', formatMessageClock(time));
  if (clock === 'start' && clockEl) actions.appendChild(clockEl);

  /** 复制：成功后短暂换成对勾（与 CodeBlock 同款），窗口期内再点不重复写。 */
  let copied = false;
  let timer = null;
  const copyButton = p.el('button', 'dsh-iconactions-action');
  copyButton.type = 'button';
  copyButton.setAttribute('aria-label', labels.copy);
  copyButton.appendChild(copyIcon());
  if (typeof tooltip === 'function') tooltip(copyButton, labels.copy);
  else copyButton.title = labels.copy;
  copyButton.addEventListener('click', () => {
    if (copied) return;
    void writeClipboard(text).then((ok) => {
      /** 复制是异步的：这段时间里消息可能已经被删掉，节点不在文档里就别再动它。 */
      if (!ok || !copyButton.isConnected) return;
      copied = true;
      copyButton.replaceChildren(checkIcon());
      copyButton.setAttribute('aria-label', labels.copied);
      if (typeof tooltip === 'function') tooltip(copyButton, labels.copied);
      else copyButton.title = labels.copied;
      timer = setTimeout(() => {
        timer = null;
        copied = false;
        copyButton.replaceChildren(copyIcon());
        copyButton.setAttribute('aria-label', labels.copy);
        if (typeof tooltip === 'function') tooltip(copyButton, labels.copy);
        else copyButton.title = labels.copy;
      }, 1000);
    });
  });
  actions.appendChild(copyButton);

  /** 分支：`onBranch` 缺席时整个按钮不渲染（DSH 的 `onBranch !== undefined`）。 */
  if (typeof onBranch === 'function') {
    const branch = p.el('button', 'dsh-iconactions-action');
    branch.type = 'button';
    branch.setAttribute('aria-label', labels.branch || 'Branch');
    branch.appendChild(branchIcon());
    if (branchUnavailable) {
      branch.dataset.unavailable = '';
      branch.setAttribute('aria-disabled', 'true');
      /** 原生 disabled 按钮不给 Tooltip 送 hover/focus，所以只标 aria-disabled。 */
      const reason = p.el('span', 'dsh-iconactions-visuallyHidden', labels.branchUnavailable || '');
      reason.id = `dsh-iconactions-reason-${(actionRowSeq += 1)}`;
      branch.setAttribute('aria-describedby', reason.id);
      actions.appendChild(reason);
    } else {
      branch.addEventListener('click', () => onBranch());
    }
    actions.appendChild(branch);
  }

  if (clock === 'end' && clockEl) {
    const endInfo = p.el('span', 'dsh-iconactions-endInfo');
    endInfo.appendChild(clockEl);
    actions.appendChild(endInfo);
  }

  return actions;
}

/* ═══════════════════════════════════════════════════════════════════
 * AssistantMarkdown.tsx —— 正文与块分派
 *
 * ⚠️ 原版的 `labels`（`markdownLabels(t)`）与 `pathImages`
 * （`{ resolve: value => localPathMediaUrl(document.baseURI, value) }`）
 * 是 `useMemo` 的 —— 每次 render 新建对象会**重建整张 markdown 组件表**。
 * 原生版把这两件事锁在**一个由调用方持有的对象**上（`ctx.labels` / `ctx.images`），
 * 正文节点只在它们**换身份**时重建。这就是约定 ③。
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * `AssistantMarkdown` 的可见性判定（原文）：
 * "Tool-call heads render as tool rows in the chat view's grouping pass, so a
 *  node that is only those heads (or empty) would paint an empty root between
 *  tool groups — skip the shell unless something visible remains."
 * @param {ReadonlyArray<object>} blocks
 * @param {boolean} streaming
 * @param {boolean} interrupted
 * @returns {boolean}
 */
function assistantMarkdownVisible(blocks, streaming, interrupted) {
  return streaming || interrupted === true || blocks.some(block => block.kind !== 'tool-call');
}

/**
 * 未知块 / 多余块的兜底：DSH 用 `JsonBlock`（`ui-primitives`）。
 * 这里退到 `<pre>` + JSON 文本 —— 形状不同，语义相同（原 payload 一字不改地显示）。
 */
function jsonBlock(p, label, payload) {
  const wrap = p.el('div', 'dsh-md-json');
  wrap.appendChild(p.el('div', 'dsh-md-jsonLabel', label));
  wrap.appendChild(p.el('pre', 'dsh-md-jsonText', safeJson(payload)));
  return wrap;
}

function safeJson(value) {
  try {
    const text = JSON.stringify(value, null, 2);
    return text === undefined ? String(value) : text;
  } catch { return String(value); }
}

/** 正文 Markdown 节点，streaming 标记当前生成状态。 */
function textBlock(p, text, streaming) {
  const node = window.ChatMarkdown.render(text, { document });
  if (streaming) node.dataset.streaming = '';
  return node;
}

/**
 * 一组连续图片块渲染为预览按钮；图片地址和打开动作由宿主提供。
 * @param {object} p
 * @param {ReadonlyArray<object>} blocks
 * @param {'start'|'end'} align
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function imageGallery(p, blocks, align, ctx) {
  const gallery = p.el('div', 'dsh-md-images');
  gallery.dataset.align = align;
  for (const block of blocks) {
    const src = ctx.resolveImage(block);
    /** 解析不出 URL（或宿主没给 `images`）时只画状态壳，不挂一个 `src=""` 的 img。 */
    if (src === '') { gallery.appendChild(p.el('div', 'dsh-image-status', ctx.labels.imageFailed || '')); continue; }
    const frame = p.el('button', 'dsh-image-frame');
    frame.type = 'button';
    frame.dataset.imageId = String(block.imageId || '');
    frame.setAttribute('aria-label', ctx.labels.openImage || '查看大图');
    frame.title = ctx.labels.openImage || '查看大图';
    frame.addEventListener('click', () => ctx.openImage(block.imageId));
    const img = p.el('img', 'dsh-image');
    img.alt = String(block.name || block.alt || '');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('load', () => { img.dataset.ready = ''; }, { once: true });
    img.src = src;
    frame.appendChild(img);
    if (typeof ctx.readImageMetadata !== 'function') { gallery.appendChild(frame); continue; }
    const card = p.el('div', 'dsh-image-card');
    card.dataset.imageId = String(block.imageId || '');
    const tags = p.el('section', 'dsh-image-tags');
    tags.setAttribute('aria-label', '图片内置 Tag');
    tags.append(p.el('strong', 'dsh-image-tags-title', '内置 Tag'));
    const content = p.el('div', 'dsh-image-tags-content', '正在读取…');
    tags.append(content); card.append(frame, tags); gallery.append(card);
    Promise.resolve().then(() => ctx.readImageMetadata(block.imageId)).then(result => {
      if (result?.ok === false) throw new Error(result.error?.message || result.reason || '读取失败');
      const metadata = result?.data;
      content.replaceChildren();
      content.append(p.el('div', 'dsh-image-tags-text', metadata?.提示词 || '未找到内置 Tag'));
      if (metadata?.负向提示词) content.append(p.el('strong', 'dsh-image-tags-title', '负向 Tag'), p.el('div', 'dsh-image-tags-text', metadata.负向提示词));
    }).catch(error => { content.textContent = `内置 Tag 读取失败：${error.message}`; });
  }
  return gallery;
}

/**
 * `AssistantMarkdown` —— 一个 assistant 块的正文外壳。
 *
 * 渲染顺序**严格按 blocks 原序**：块分派只在 `groupPart` 过滤上生效
 * （`reasoning` 只留推理块，`response` 去掉推理块），其余一律保留原 index。
 *
 * @param {object} ctx 视图上下文（p / labels / disclosure / resolveImage / t）
 * @param {object} options
 * @param {ReadonlyArray<object>} options.blocks
 * @param {string} [options.groupPart]
 * @param {boolean} [options.streaming]
 * @param {boolean} [options.interrupted]
 * @param {boolean} [options.reasoningHidden]
 * @param {Function} [options.revealProcess]
 * @param {Function} [options.actions] 正文下方图标行的工厂
 * @returns {HTMLElement|null}
 */
function assistantMarkdown(ctx, { blocks, groupPart, streaming = false, interrupted = false, reasoningHidden = false, revealProcess, actions }) {
  const p = ctx.p;
  if (!assistantMarkdownVisible(blocks, streaming, interrupted)) return null;

  const root = p.el('div', 'dsh-md-root');
  if (streaming) root.dataset.streaming = '';
  const body = p.el('div', 'dsh-md-body');
  root.appendChild(body);

  const last = blocks.length - 1;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block === undefined) continue;
    if (groupPart === 'reasoning' && block.kind !== 'reasoning') continue;
    if (groupPart === 'response' && block.kind === 'reasoning') continue;
    switch (block.kind) {
      case 'text':
        body.appendChild(textBlock(p, String(block.text ?? ''), streaming));
        break;
      case 'reasoning': {
        /** `ProcessReasoning`：被轮次过程隐藏时用 `hidden` 保留零高节点。 */
        const holder = p.el('div');
        holder.dataset.turnProcessInline = '';
        const row = ctx.rows.reasoningRow({
          text: String(block.text ?? ''),
          running: streaming && i === last,
          disclosure: ctx.disclosure(),
          bodyRenderer: text => window.ChatMarkdown.render(text, { document, compact: true }),
          labels: { title: ctx.labels.reasoningTitle, running: ctx.labels.reasoningRunning }
        });
        holder.appendChild(row.root);
        if (reasoningHidden) {
          holder.hidden = true;
          holder.setAttribute('hidden', 'until-found');
          if (typeof revealProcess === 'function') holder.addEventListener('beforematch', () => revealProcess(), { once: true });
        } else {
          delete holder.dataset.turnProcessInline;
        }
        body.appendChild(holder);
        break;
      }
      case 'image': {
        /**
         * 连续图片块合成一个画廊，key 用**首块 index** —— 流式追加时只长 `images`，
         * 不会因为 key 位移而重建画廊（原版注释）。
         */
        const group = [block];
        while (i + 1 < blocks.length && blocks[i + 1] !== undefined && blocks[i + 1].kind === 'image') {
          group.push(blocks[i + 1]);
          i += 1;
        }
        body.appendChild(imageGallery(p, group, 'start', ctx));
        break;
      }
      /** 工具块由分组过程切成自己的 flowItem，正文里不画（原版同）。 */
      case 'tool-call':
        break;
      default:
        body.appendChild(jsonBlock(p, ctx.labels.unknownBlock, block.block !== undefined ? block.block : block));
    }
  }

  if (interrupted
    && (groupPart === undefined || groupPart === 'response'
      || !blocks.some(block => block.kind !== 'reasoning' && block.kind !== 'tool-call'))) {
    body.appendChild(p.el('span', 'dsh-md-stopped', ctx.labels.stopped));
  }

  if (typeof actions === 'function') root.appendChild(actions());
  return root;
}

/* ═══════════════════════════════════════════════════════════════════
 * MessageItem.tsx —— user 气泡
 * ═══════════════════════════════════════════════════════════════════ */

/** `fileExtension`（`ui-primitives`）：取最后一个点之后的部分。 */
function fileExtension(name) {
  const dot = String(name).lastIndexOf('.');
  return dot <= 0 ? '' : String(name).slice(dot + 1);
}

/** `fileSizeText`（`ui-primitives`）：十进制单位，一位小数。 */
function fileSizeText(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 1000) return `${value} B`;
  if (value < 1000 * 1000) return `${Math.round(value / 100) / 10} KB`;
  if (value < 1000 * 1000 * 1000) return `${Math.round(value / 100000) / 10} MB`;
  return `${Math.round(value / 100000000) / 10} GB`;
}

/** 用户附件的文件卡（`.dsh-msg-fileCard`）。 */
function fileCard(p, file) {
  const card = p.el('span', 'dsh-msg-fileCard');
  card.title = String(file.name || '');
  const icon = p.el('span', 'dsh-msg-fileIcon');
  /** `FileTypeIcon` 来自 `ui-primitives`（不在范围内）：留一个等尺寸占位，不改布局。 */
  card.appendChild(icon);
  const content = p.el('span', 'dsh-msg-fileContent');
  content.appendChild(p.el('span', 'dsh-msg-fileName', String(file.name || '')));
  content.appendChild(p.el('span', 'dsh-msg-fileMeta',
    [fileExtension(file.name || '').toUpperCase().slice(0, 8), fileSizeText(file.bytes)].filter(Boolean).join(' ')));
  card.appendChild(content);
  return card;
}

/**
 * `UserStyleBubble` —— user / steering 共用的右对齐气泡。
 *
 * DOM 照抄：`.userRow`（列 + 图标行）> `.userStack`（附件行 + 气泡 + 引用摘要）。
 * 附件行**在气泡之前**，且只在有附件时才建（原版 `attachments.length > 0 && …`）。
 *
 * @param {object} ctx
 * @param {object} options
 * @param {ReadonlyArray<object>} options.blocks 归一化后的块
 * @param {number} [options.time]
 * @param {boolean} [options.pending] 待承认的 steering 投影
 * @param {Function} [options.onBranch]
 * @returns {HTMLElement}
 */
function userStyleBubble(ctx, { blocks, time, pending = false, onBranch }) {
  const p = ctx.p;
  const texts = [];
  const attachments = [];
  const rest = [];
  for (const block of blocks) {
    if (block.kind === 'text' && typeof block.text === 'string') texts.push(block.text);
    else if (block.kind === 'image' || block.kind === 'file') attachments.push(block);
    else rest.push(block);
  }
  const text = texts.join('');
  const compactImages = attachments.length > 1;

  const row = p.el('div', 'dsh-msg-userRow');
  if (pending) row.dataset.pendingSteering = '';
  const stack = p.el('div', 'dsh-msg-userStack');

  if (attachments.length > 0) {
    const attachmentRow = p.el('div', 'dsh-msg-attachmentRow');
    attachmentRow.dataset.messageAttachments = '';
    for (const attachment of attachments) {
      if (attachment.kind === 'image') {
        attachmentRow.appendChild(imageGallery(p, [attachment], 'end', ctx));
      } else {
        attachmentRow.appendChild(fileCard(p, attachment));
      }
    }
    void compactImages;
    stack.appendChild(attachmentRow);
  }

  const showBubble = text !== '' || rest.length > 0;
  if (showBubble) {
    const bubble = p.el('div', 'dsh-msg-bubble');
    /**
     * ⚠️ 原版这里是 `projectUserText(text, referenceLabels, skillNames, 'skill', references)` ——
     * 它把 `@路径` / `/技能` 切成可点链接。原生版只画纯文本（`textContent`），
     * 引用摘要那一行也就没有 labels 可显示（见存疑清单）。
     */
    if (text !== '') bubble.appendChild(document.createTextNode(text));
    for (const block of rest) bubble.appendChild(jsonBlock(p, ctx.labels.unknownBlock, block.block !== undefined ? block.block : block));
    stack.appendChild(bubble);
  }

  row.appendChild(stack);
  row.appendChild(messageIconActions({
    text,
    clock: 'end',
    time,
    onBranch,
    className: 'dsh-md-actions',
    p,
    labels: ctx.labels,
    tooltip: ctx.tooltip
  }));
  return row;
}

/* ═══════════════════════════════════════════════════════════════════
 * 归一化：把宿主给的 message 变成渲染用的计划
 *
 * ⚠️ "块 → part" 的切分照 `conversation-nodes/process-groups.ts` 的规则：
 *    · 含非空推理块        → 一个 `reasoning` part（`.dsh-flowItem[data-chat-group-part="reasoning"]`）
 *    · 含用户可见回复      → `response` part（gap 12px）
 *    · 工具块              → `tool` part（gap 6px，与推理行同档）
 *    · 不可见的块（空文字 / 空推理）→ 该 part 照样建，但**整体 hidden**
 *      （DSH 的 `visibility: 'hidden'`：零高、不参与间距，节点保留）
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * 把一条宿主消息归一化成 `{ id, role, kind, parts, time, streaming, interrupted }`。
 * @param {object} message
 * @returns {object}
 */
function normalizeMessage(message) {
  const rawBlocks = Array.isArray(message.blocks) ? message.blocks : [];
  const blocks = rawBlocks.map((block) => {
    if (block === null || typeof block !== 'object') return { kind: 'text', text: String(block ?? '') };
    if (block.kind !== undefined) return block;
    /** 兼容 DSH 的 `type` 口径（`{type:'text', text}`）—— 只做字段名映射，不改语义。 */
    if (block.type !== undefined) return { ...block, kind: block.type };
    return { kind: 'unknown', block };
  });
  const role = message.role === undefined ? (message.kind === 'user' ? 'user' : 'assistant') : message.role;
  const isUser = role === 'user' || role === 'steering';
  const parts = [];
  if (isUser) {
    parts.push({ part: undefined, blocks });
  } else {
    /**
     * **按块的源码顺序切段**（不是固定的 `tool → reasoning → response`）。
     *
     * 依据 DSH `conversation-nodes/process-groups.ts`：`groupPart` **只有**
     * `reasoning` 与 `response` 两个取值（`:172` / `:175`），工具节点是
     * `groupPart: undefined` 的**独立节点**，按 `rebuild()` 的发射顺序落在两者之间。
     * 而 `blocks` 数组本身就是流式到达顺序（推理 → 工具 → 正文），
     * 所以**直接按原序扫描**才是 DSH 的行为。
     *
     * 固定顺序会把"模型先说了半句、调完工具再继续说"这种真实形态排错，
     * 也让"数据没变却因顺序不同而重建"凭空发生。
     *
     * 扫描 → 相邻同 part 合并成一段 → 按可见性丢段。
     */
    const partOf = block => {
      if (!block || typeof block !== 'object') return 'response';
      if (block.kind === 'tool-call') return 'tool';
      if (block.kind === 'reasoning') return 'reasoning';
      return 'response';
    };
    for (const block of blocks) {
      const part = partOf(block);
      const last = parts[parts.length - 1];
      if (last && last.part === part) last.blocks.push(block);
      else parts.push({ part, blocks: [block] });
    }
    /** 可见性过滤：工具段恒留（它通常是唯一的可见占位）；其余按内容判定。 */
    const visible = parts.filter(row => {
      if (row.part === 'tool') return true;
      if (row.part === 'reasoning') return row.blocks.some(block => String(block?.text ?? '').trim() !== '');
      return hasAssistantReplyContent(row.blocks);
    });
    parts.length = 0;
    parts.push(...visible);
    /** 一个 part 都不成立时留一个零高节点（对应 DSH 的 hidden 座位）。 */
    if (parts.length === 0) parts.push({ part: undefined, blocks });
  }
  /**
   * `visibility`（`assistant.ts` 的 `chatNode(..., { visibility })`）：
   * 一个可见块都没有 → 整条消息的座位 hidden。工具块算占位（理由见 `buildEntry`）。
   */
  const visible = blocks.some(block => blockIsVisible(block) || block.kind === 'tool-call');
  return {
    id: String(message.id ?? message.key ?? ''),
    role,
    isUser,
    kind: isUser ? role : 'assistant-step',
    time: message.time,
    streaming: message.streaming === true,
    interrupted: message.interrupted === true,
    onBranch: message.onBranch,
    blocks,
    parts,
    hidden: !visible
  };
}

/** 由消息、轮次和会话标识构建聊天视图；update 接收同样的完整投影。 */
function chatView(options = {}) {
  const p = primitivesOf(), rows = rowsOf();
  const labels = { ...DEFAULT_LABELS, ...(options.labels || {}) };
  const images = options.images || { resolve: () => '' };
  const disclosures = new Map(), mounted = new Map(), turnNodes = new Map();
  const editState = new Map();
  const objectIds = new WeakMap();
  let nextObjectId = 0;
  const objectId = value => {
    if (!value || typeof value !== 'object') return 0;
    if (!objectIds.has(value)) objectIds.set(value, ++nextObjectId);
    return objectIds.get(value);
  };
  const sameSignature = (left, right) => left?.length === right.length && left.every((value, index) => value === right[index]);
  const disclosureFor = key => {
    if (!disclosures.has(key)) disclosures.set(key, rows.createDisclosure());
    return disclosures.get(key);
  };
  const ctx = {
    p, rows, labels, images, tooltip: options.tooltip,
    disclosure: () => rows.createDisclosure(),
    resolveImage: block => String(images.resolve(block) || ''),
    openImage: imageId => options.onOpenImage?.(imageId),
    readImageMetadata: options.onReadImageMetadata,
  };
  const root = p.el('div', 'dsh-chat-frame agent-chat');
  const inner = p.el('div', 'dsh-chat-root');
  inner.dataset.chatFollowingTail = '';
  const scroll = p.el('div', 'dsh-chat-scroll');
  const column = p.el('div', 'dsh-chat-column');
  column.dataset.chatFlow = '';
  scroll.append(column); inner.append(scroll); root.append(inner);
  let sessionId = options.sessionId;

  function reconcile(parent, children) {
    const wanted = new Set(children);
    for (const child of [...parent.childNodes]) if (!wanted.has(child)) child.remove();
    children.forEach((child, index) => {
      if (parent.childNodes[index] !== child) parent.insertBefore(child, parent.childNodes[index] || null);
    });
  }

  function copyButton(value, label = '复制') {
    const button = p.el('button', 'agent-detail-copy', label);
    button.type = 'button';
    button.addEventListener('click', async () => {
      const text = typeof value === 'function' ? value() : value;
      button.textContent = await writeClipboard(text) ? '已复制' : '复制失败';
    });
    return button;
  }

  function lazyValue(kind, count, build) {
    const details = p.el('details', 'agent-data-node');
    details.dataset.valueKind = kind;
    details.dataset.itemCount = String(count);
    const summary = p.el('summary', 'agent-data-summary', `${kind} · ${count} 项`);
    const children = p.el('div', 'agent-data-children');
    let built = false;
    details.addEventListener('toggle', () => {
      if (!details.open || built) return;
      built = true;
      children.append(build());
    });
    details.append(summary, children);
    return details;
  }

  function valueView(value) {
    if (Array.isArray(value)) {
      if (!value.length) return p.el('code', '', '[]');
      return lazyValue('数组', value.length, () => {
        const objects = value.every(item => item && typeof item === 'object' && !Array.isArray(item));
        if (objects) {
          const wrap = p.el('div', 'agent-data-scroll');
          const table = p.el('table', 'agent-data-table'), head = p.el('thead'), body = p.el('tbody');
          const keys = [...new Set(value.flatMap(item => Object.keys(item)))];
          const titles = p.el('tr');
          for (const key of keys) titles.append(p.el('th', '', key));
          head.append(titles);
          for (const item of value) {
            const row = p.el('tr');
            for (const key of keys) {
              const cell = p.el('td');
              if (Object.hasOwn(item, key)) cell.append(valueView(item[key]));
              row.append(cell);
            }
            body.append(row);
          }
          table.append(head, body); wrap.append(table); return wrap;
        }
        const list = p.el('ol', 'agent-data-list');
        for (const item of value) { const li = p.el('li'); li.append(valueView(item)); list.append(li); }
        return list;
      });
    }
    if (value && typeof value === 'object') {
      const keys = Object.keys(value);
      if (!keys.length) return p.el('code', '', '{}');
      return lazyValue('对象', keys.length, () => {
        const list = p.el('dl', 'agent-data-fields');
        for (const key of keys) {
          const content = p.el('dd'); content.append(valueView(value[key]));
          list.append(p.el('dt', '', key), content);
        }
        return list;
      });
    }
    return p.el('span', 'agent-data-value', value === null ? 'null' : String(value));
  }

  function toolDetails(block) {
    const root = p.el('div', 'agent-tool-details');
    root.append(p.el('code', 'agent-tool-name', block.name));
    for (const [label, key] of [['参数', 'input'], ['回执', 'output']]) {
      if (block[key] === undefined) continue;
      const section = p.el('section', 'agent-tool-' + key);
      const heading = p.el('div', 'agent-detail-heading', label);
      const literal = key === 'input' && typeof block.inputRaw === 'string'
        ? block.inputRaw
        : typeof block[key] === 'string' ? block[key] : null;
      const rawText = () => literal === null ? safeJson(block[key]) : literal;
      heading.append(copyButton(rawText));
      section.append(heading, valueView(block[key]));
      const raw = p.el('details', 'agent-tool-raw');
      raw.append(p.el('summary', '', '原始内容'));
      let rawBuilt = false;
      raw.addEventListener('toggle', () => {
        if (!raw.open || rawBuilt) return;
        rawBuilt = true;
        raw.append(p.el('pre', '', rawText()));
      });
      section.append(raw); root.append(section);
    }
    return root;
  }

  function buildTool(block, messageId) {
    const stateLabels = { preparing: '等待调用', running: '执行中', ok: '已完成', error: '失败', stopped: '已停止' };
    const disclosure = disclosureFor(JSON.stringify([messageId, block.callId]));
    const body = p.el('div');
    const view = rows.toolRow({
      toolName: block.name,
      title: block.title || block.name,
      icon: toolIcon(),
      state: block.state,
      summary: block.summary || block.name,
      suffix: ' · ' + stateLabels[block.state],
      statusText: stateLabels[block.state],
      body,
      disclosure,
    });
    const fill = () => {
      if (disclosure.expanded() && !body.childElementCount) body.append(toolDetails(block));
    };
    view.root.addEventListener('click', fill);
    view.root.addEventListener('keydown', fill);
    fill();
    return view.root;
  }

  function messageRecord(message, isFinal) {
    const key = [String(message.id ?? message.key ?? ''), isFinal, message.role, message.time, message.streaming, message.interrupted, message.onBranch];
    const old = mounted.get(message.id);
    const normalized = normalizeMessage(message);
    const entries = normalized.parts.map((part, index) => {
      const partKey = key.slice();
      partKey.push(part.part, options.sessionId, objectId(options.onEditMessage), objectId(options.onRegenerate), options.isRunning?.() === true,
        editState.has(message.id), editState.get(message.id)?.saving === true, editState.get(message.id)?.error || '');
      for (const block of part.blocks) {
        const kind = block?.kind;
        partKey.push(kind, block?.type, block?.name, block?.title, block?.state, block?.summary,
          block?.text, block?.callId, block?.inputRaw);
        if (kind === 'image') partKey.push(block?.imageId, block?.alt);
        else if (kind === 'file') partKey.push(block?.imageId, block?.bytes);
        else if (kind === 'tool-call') partKey.push(objectId(block?.input), objectId(block?.output));
        else if (kind !== 'text' && kind !== 'reasoning') partKey.push(objectId(block?.block ?? block));
      }
      const cached = old?.entries[index];
      if (cached && sameSignature(cached.key, partKey)) {
        const area = cached.node.querySelector('.dsh-message-edit-input');
        if (area && editState.has(message.id)) editState.get(message.id).text = area.value;
        return cached;
      }
      const node = p.el('div', 'dsh-flowItem');
      node.dataset.chatNodeKey = message.id;
      node.dataset.chatFlowKind = normalized.isUser ? 'user' : 'assistant-step';
      if (part.part) node.dataset.chatGroupPart = part.part;
      const partContext = { ...ctx, disclosure: () => disclosureFor(JSON.stringify([message.id, index])) };
      if (normalized.isUser) node.append(userStyleBubble(ctx, { blocks: part.blocks, time: message.time }));
      else if (part.part === 'tool') {
        const list = p.el('div', 'dsh-chat-toolList');
        for (const block of part.blocks) list.append(buildTool(block, message.id));
        node.append(list);
      } else {
        const content = assistantMarkdown(partContext, {
          blocks: part.blocks,
          groupPart: part.part,
          streaming: normalized.streaming,
          actions: isFinal && part.part === 'response' ? () => messageIconActions({
            text: part.blocks.filter(block => block.kind === 'text').map(block => block.text).join('\n\n'),
            clock: 'end', time: message.time, className: 'dsh-md-actions', p, labels, tooltip: ctx.tooltip,
          }) : undefined,
        });
        if (content) node.append(content);
      }
      const firstTextResponse = part.part === 'response' && part.blocks.some(block => block.kind === 'text') &&
        normalized.parts.findIndex(row => row.part === 'response' && row.blocks.some(block => block.kind === 'text')) === index;
      const editable = (normalized.isUser || firstTextResponse) &&
        !normalized.streaming && message.id && options.onEditMessage;
      if (editable) {
        const text = normalized.blocks.filter(block => block.kind === 'text').map(block => block.text).join('\n\n');
        const host = p.el('div', 'dsh-message-edit');
        const state = editState.get(message.id);
        if (state) {
          const area = p.el('textarea', 'dsh-message-edit-input');
          area.value = state.text;
          area.addEventListener('input', () => { state.text = area.value; });
          area.setAttribute('aria-label', '编辑消息文本');
          const hint = p.el('p', 'dsh-message-edit-hint', '只修改文本；图片、推理和工具记录保持原样。');
          if (state.error) host.append(p.el('p', 'dsh-message-edit-error', state.error));
          const actions = p.el('div', 'dsh-message-edit-actions');
          const save = p.el('button', 'dsh-message-edit-save', '保存'); save.type = 'button';
          const cancel = p.el('button', 'dsh-message-edit-cancel', '取消'); cancel.type = 'button';
          const busy = options.isRunning?.() === true || state.saving === true;
          for (const button of [save, cancel]) { button.disabled = busy; if (busy) button.title = '对话运行中，暂时不能修改'; }
          if (busy) host.dataset.busy = 'true';
          save.addEventListener('click', async () => {
            if (options.isRunning?.() || state.saving) return;
            const captured = { sessionId: options.sessionId, messageId: message.id };
            state.saving = true; save.disabled = true;
            try {
              state.error = '';
              const result = await options.onEditMessage({ ...captured, text: area.value });
              if (result?.ok === false) throw new Error(result.error?.message || result.reason || '保存失败');
              editState.delete(message.id);
              render();
            } catch (error) {
              state.saving = false; state.error = error.message || String(error);
              render();
              column.querySelector(`[data-chat-node-key="${String(message.id).replace(/["\\]/g, '\\$&')}"] .dsh-message-edit-input`)?.focus();
              return;
            }
          });
          cancel.addEventListener('click', () => { editState.delete(message.id); render(); });
          actions.append(save, cancel); host.append(area, hint, actions);
        } else {
          const edit = p.el('button', 'dsh-iconactions-action dsh-message-edit-open'); edit.type = 'button';
          edit.append(pencilIcon());
          edit.setAttribute('aria-label', '编辑这条消息');
          edit.title = '编辑这条消息';
          edit.addEventListener('click', () => { editState.set(message.id, { text }); render(); column.querySelector(`[data-chat-node-key="${String(message.id).replace(/["\\]/g, '\\$&')}"] .dsh-message-edit-input`)?.focus(); });
          const busy = options.isRunning?.() === true || editState.get(message.id)?.saving === true;
          edit.disabled = busy;
          if (busy) {
            edit.title = '对话运行中，暂时不能修改';
            const hint = p.el('span', 'dsh-message-edit-hint', '对话运行中，暂时不能编辑');
            host.append(hint);
          }
          let actionRow = node.querySelector('.dsh-iconactions-actions');
          if (!actionRow) {
            actionRow = messageIconActions({ text, clock: 'end', time: message.time, className: 'dsh-md-actions', p, labels, tooltip: ctx.tooltip });
            node.append(actionRow);
          }
          actionRow.querySelector('.dsh-iconactions-action').after(edit);
        }
        if (host.childNodes.length) node.append(host);
      }
      return { key: partKey, node, part: part.part, blocks: part.blocks };
    });
    const record = { key, entries };
    mounted.set(message.id, record); return record;
  }

  function createTurn(turn) {
    const root = p.el('article', 'agent-turn');
    root.dataset.turnId = turn.id;
    const process = p.el('details', 'agent-turn-process');
    const summary = p.el('summary', 'agent-turn-summary');
    const body = p.el('div', 'agent-turn-body');
    const result = p.el('div', 'agent-turn-result');
    const error = p.el('div', 'agent-turn-error');
    error.setAttribute('role', 'status');
    const model = p.el('div', 'agent-turn-model');
    const actions = p.el('div', 'agent-turn-actions');
    process.append(summary, body); root.append(process, error, result, actions, model);
    const record = { root, process, summary, body, result, error, model, actions, userOpen: options.processExpanded?.(turn.id) };
    summary.addEventListener('click', event => {
      event.preventDefault();
      if (!body.childElementCount) return;
      record.userOpen = !process.open;
      process.open = record.userOpen;
      options.onToggleTurnProcess?.(record.userOpen, turn.id);
    });
    return record;
  }

  function renderTurn(turn, byId) {
    let record = turnNodes.get(turn.id);
    if (!record) { record = createTurn(turn); turnNodes.set(turn.id, record); }
    record.root.dataset.inputMessageId = turn.inputMessageId || '';
    const process = [], results = [], tools = [];
    for (const id of turn.messageIds) {
      const message = byId.get(id);
      if (!message) continue;
      const final = id === turn.finalMessageId;
      for (const entry of messageRecord(message, final).entries) {
        const isResult = entry.part === 'response' && (final || entry.blocks.some(block => block.kind === 'image'));
        (isResult ? results : process).push(entry.node);
      }
      tools.push(...message.blocks.filter(block => block.kind === 'tool-call'));
    }
    reconcile(record.body, process); reconcile(record.result, results);
    const active = ['running', 'stopping'].includes(turn.status);
    const latestTool = tools.filter(tool => ['running', 'preparing'].includes(tool.state)).at(-1);
    const states = { running: latestTool ? '正在调用：' + latestTool.title : 'AI 处理中', stopping: '停止中', complete: '已完成', failed: '处理失败', stopped: '已停止', interrupted: '已中断' };
    const failedTools = tools.filter(tool => tool.state === 'error').length;
    const elapsed = Math.max(0, ((turn.endedAt ?? Date.now()) - turn.startedAt) / 1000);
    const duration = elapsed < 60 ? `${elapsed.toFixed(1)} 秒` : `${Math.floor(elapsed / 60)} 分 ${Math.floor(elapsed % 60)} 秒`;
    record.summary.textContent = [states[turn.status], tools.length ? `${tools.length} 次工具调用` : '', failedTools ? `${failedTools} 次失败` : '', duration].filter(Boolean).join(' · ');
    record.root.dataset.status = turn.status;
    record.process.dataset.empty = String(process.length === 0);
    record.process.open = process.length > 0 && (record.userOpen ?? active);
    record.error.textContent = turn.error?.reason || '';
    record.error.hidden = !turn.error;
    record.result.hidden = results.length === 0;
    record.model.textContent = turn.model ? [turn.model.provider, turn.model.model].filter(Boolean).join(' · ') : '';
    record.model.hidden = !record.model.textContent;
    if (options.onRegenerate && turn.inputMessageId) {
      const button = p.el('button', 'dsh-iconactions-action dsh-message-regenerate', '↻'); button.type = 'button';
      button.title = '仅替换这一轮回复，后续对话保留';
      button.setAttribute('aria-label', '重新生成这一轮回复，保留后续对话');
      const busy = options.isRunning?.() === true || active;
      button.disabled = busy;
      if (busy) button.title = '对话运行中，暂时不能重新生成';
      button.addEventListener('click', () => {
        const captured = { sessionId: options.sessionId, turnId: turn.id };
        if (!options.isRunning?.()) {
          button.disabled = true;
          Promise.resolve().then(() => options.onRegenerate(captured)).then(result => {
            if (result?.ok === false) throw new Error(result.error?.message || result.reason || '重新生成失败');
            record.error.hidden = true;
          }).catch(error => {
            record.error.textContent = error.message || String(error);
            record.error.hidden = false;
            button.disabled = false;
          });
        }
      });
      const control = record.root.querySelector('.dsh-message-regenerate') || button;
      control.dataset.turnId = turn.id;
      control.disabled = busy;
      control.title = busy ? '对话运行中，暂时不能重新生成' : '仅替换这一轮回复，后续对话保留';
      const actionRow = [...record.result.querySelectorAll('.dsh-iconactions-actions')].at(-1);
      if (actionRow) {
        (actionRow.querySelector('.dsh-message-edit-open') || actionRow.querySelector('.dsh-iconactions-action')).after(control);
        record.actions.replaceChildren();
      } else record.actions.replaceChildren(control);
      if (busy) record.actions.append(p.el('span', 'dsh-message-edit-hint', '对话运行中，暂时不能重新生成'));
    } else {
      record.actions.replaceChildren();
    }
    return record.root;
  }

  function render() {
    if (sessionId !== options.sessionId) {
      sessionId = options.sessionId;
      mounted.clear(); turnNodes.clear(); disclosures.clear();
      editState.clear();
    }
    const messages = Array.isArray(options.messages) ? options.messages : [];
    const turns = Array.isArray(options.turns) ? options.turns : [];
    const byId = new Map(messages.map(message => [message.id, message]));
    const byTurn = new Map(turns.map(turn => [turn.id, turn]));
    const order = [], shownTurns = new Set();
    for (const message of messages) {
      const turn = byTurn.get(message.turnId);
      if (message.role === 'user' || !turn) {
        for (const entry of messageRecord(message, message.role === 'assistant').entries) order.push(entry.node);
      }
      if (turn && !shownTurns.has(turn.id)) {
        order.push(renderTurn(turn, byId)); shownTurns.add(turn.id);
      }
    }
    for (const turn of turns) if (!shownTurns.has(turn.id)) order.push(renderTurn(turn, byId));
    reconcile(column, order);
    for (const id of mounted.keys()) if (!byId.has(id)) mounted.delete(id);
    for (const id of turnNodes.keys()) if (!byTurn.has(id)) turnNodes.delete(id);
  }
  render();
  const timer = setInterval(() => {
    if ((options.turns || []).some(turn => ['running', 'stopping'].includes(turn.status))) render();
  }, 1000);
  return {
    root, el: p, labels, images,
    update(messages, running, extra = {}) { Object.assign(options, extra, { messages, running }); render(); },
    setRunning(value) { options.running = value; render(); },
    invalidate() { mounted.clear(); render(); },
    destroy() { clearInterval(timer); mounted.clear(); turnNodes.clear(); disclosures.clear(); root.replaceChildren(); },
  };
}


const dshChat = Object.freeze({
  chatView,
  assistantMarkdown,
  assistantMarkdownVisible,
  userStyleBubble,
  messageIconActions,
  formatMessageClock,
  hasAssistantReplyContent,
  blockIsVisible,
  fileSizeText,
  fileExtension,
  DEFAULT_LABELS
});

if (typeof window !== 'undefined') window.dshChat = dshChat;
if (typeof module !== 'undefined' && module.exports) module.exports = dshChat;
})();
