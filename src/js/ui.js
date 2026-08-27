/* ================= UI 组件模板库（统一调用，避免重复手写 DOM） ================= */
/* 用法：UI.button('文案', {cls:'pri', fn}); UI.tagModule('标题', tags); UI.bubble(role, text, opts); … 详见 COMPONENTS.md */
'use strict';
// Lucide 线性图标（内嵌 SVG path，离线可用，stroke 取 currentColor）
var ICONS = {
  copy:   '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  edit:   '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  refresh:'<path d="M3 2v6h6"/><path d="M21 12A9 9 0 0 0 6 5.3L3 8"/><path d="M21 22v-6h-6"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/>',
  send:   '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  image:  '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  stop:   '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  trash:  '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  user:   '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  bot:    '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/><path d="M2 14h2M20 14h2"/>',
  info:   '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  alert:  '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  settings:'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  file:   '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8M16 13H8M16 17H8"/>',
  robot:  '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>'
};
var UI = {
  // 基础元素
  el: function (tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  },
  // 线性 SVG 图标（Lucide 风格）
  ic: function (name, size) {
    size = size || 16;
    const p = ICONS[name];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    if (p) svg.innerHTML = p; else svg.textContent = '?';
    return svg;
  },
  // 圆形小头像（线性图标 + 柔和底）
  avatar: function (icon) {
    const a = UI.el('span', 'avatar');
    a.appendChild(UI.ic(icon, 16));
    return a;
  },
  // 通用按钮（abtn 体系；变体：pri 主色 / ghost 弱化 / danger 危险）
  button: function (label, opts) {
    opts = opts || {};
    const b = UI.el('button', 'abtn' + (opts.cls ? ' ' + opts.cls : ''), label);
    if (opts.title) b.title = opts.title;
    if (opts.fn) b.onclick = opts.fn;
    return b;
  },
  // 带图标按钮（可 emoji 或 svg 图标名）
  iconButton: function (label, iconName, opts) {
    opts = opts || {};
    const b = UI.el('button', 'abtn' + (opts.cls ? ' ' + opts.cls : ''));
    if (iconName) b.appendChild(UI.ic(iconName, 15));
    b.appendChild(UI.el('span', null, label));
    if (opts.title) b.title = opts.title;
    if (opts.fn) b.onclick = opts.fn;
    return b;
  },
  // 消息旁的小图标按钮
  iconBtn: function (icon, title, fn) {
    const b = UI.el('button', 'cico');
    if (ICONS[icon]) b.appendChild(UI.ic(icon, 15)); else b.textContent = icon;
    b.title = title || '';
    if (fn) b.onclick = (ev) => { ev.stopPropagation(); fn(); };
    return b;
  },
  // 提示说明块
  hint: function (html) { const d = UI.el('div', 'hint'); d.innerHTML = html || ''; return d; },
  // 标题条（左标题 + 右侧按钮组）
  clhead: function (text, buttons) {
    const d = UI.el('div', 'clhead', text);
    const sp = UI.el('span'); sp.style.flex = '1';
    d.appendChild(sp);
    (buttons || []).forEach(b => d.appendChild(b));
    return d;
  },
  // 状态点（小圆点 + 文字；cls: ok / err）
  statusDot: function (text, cls) {
    const d = UI.el('div', 'cstatus' + (cls ? ' ' + cls : ''));
    d.appendChild(UI.el('span', 'cdot'));
    d.appendChild(UI.el('span', null, text == null ? '' : text));
    return d;
  },
  // 页面标题条（返回按钮 + 标题 + 可选右侧按钮）
  pageHead: function (title, backFn, extras) {
    const d = UI.el('div', 'aitop slim2');
    if (backFn) d.appendChild(UI.button('← 返回 AI 对话', { cls: 'ghost', fn: backFn }));
    d.appendChild(UI.el('span', null, title));
    const sp = UI.el('span'); sp.style.flex = '1'; d.appendChild(sp);
    (extras || []).forEach(b => d.appendChild(b));
    return d;
  },
  // 分段模式切换条
  segTabs: function (items, active, onPick) {
    const bar = UI.el('div', 'tkmodebar');
    items.forEach(it => {
      const t = UI.el('div', 'tkmode' + (it.mode === active ? ' on' : ''), it.label);
      t.onclick = () => {
        if (onPick) onPick(it.mode);
        bar.querySelectorAll('.tkmode').forEach(x => x.classList.remove('on'));
        t.classList.add('on');
      };
      bar.appendChild(t);
    });
    return bar;
  },
  // Tag 芯片（可点击复制）
  tagChip: function (t, opts) {
    opts = opts || {};
    const s = UI.el('span', 'wdtag' + (t.category === 9 ? ' rating' : t.category === 4 ? ' character' : ''), t.tag);
    s.title = '置信度 ' + Math.round((t.prob || 0) * 100) + '% · 点击复制';
    s.onclick = () => (typeof copyText === 'function' ? copyText(t.tag, '已复制：' + t.tag) : 0);
    return s;
  },
  // Tag 模块（标题 + 芯片组；空时显示“（无）”）
  tagModule: function (title, tags) {
    const wrap = UI.el('div', 'tagmod');
    wrap.appendChild(UI.el('div', 'tagmod-title', title + (tags && tags.length ? '（' + tags.length + '）' : '')));
    const chips = UI.el('div', 'wdmsg-tags');
    (tags || []).slice(0, 80).forEach(t => chips.appendChild(UI.tagChip(t)));
    if (!tags || !tags.length) chips.appendChild(UI.el('div', 'tagmod-empty', '（无）'));
    wrap.appendChild(chips);
    return wrap;
  },
  // 会话列表项
  listItem: function (title, meta, opts) {
    opts = opts || {};
    const d = UI.el('div', 'tsession' + (opts.active ? ' active' : ''));
    d.appendChild(UI.el('span', 'ttitle', title));
    if (meta) d.appendChild(UI.el('span', 'ttime', meta));
    if (opts.delFn) {
      const x = UI.el('button', 'tdel'); x.title = '删除'; x.appendChild(UI.ic('trash', 13));
      x.onclick = (ev) => { ev.stopPropagation(); opts.delFn(); };
      d.appendChild(x);
    }
    if (opts.fn) d.onclick = opts.fn;
    return d;
  },
  // 折叠模块（标题 + 可选复制按钮固定，body 滚动；点击标题折叠/展开）
  foldModule: function (title, bodyEl, opts) {
    opts = opts || {};
    const m = UI.el('div', 'tp-mod');
    const head = UI.el('div', 'tpm-head');
    head.appendChild(UI.el('span', null, title));
    if (opts.copyFn) {
      const b = UI.el('button', 'tpm-copy');
      b.appendChild(UI.ic('copy', 13));
      b.appendChild(UI.el('span', null, '复制'));
      b.onclick = (ev) => { ev.stopPropagation(); opts.copyFn(); };
      head.appendChild(b);
    }
    m.appendChild(head);
    if (opts.key) m.dataset.foldKey = opts.key;
    const body = UI.el('div', 'tpm-body');
    if (bodyEl) body.appendChild(bodyEl);
    m.appendChild(body);
    if (opts.collapsed) m.classList.add('collapsed');
    head.onclick = (e) => {
      if (e.target && e.target.closest && e.target.closest('.tpm-copy')) return;
      m.classList.toggle('collapsed');
      if (typeof opts.onToggle === 'function') opts.onToggle(m.classList.contains('collapsed'));
    };
    return m;
  },
  // 可折叠卡片
  card: function (summary, sub, bodyEl, opts) {
    opts = opts || {};
    const det = UI.el('details', 'promptcard');
    if (opts.open) det.open = true;
    const sum = UI.el('summary', null, summary);
    sum.title = '点击折叠 / 展开';
    if (sub) sum.appendChild(UI.el('span', 'pcsub', sub));
    det.appendChild(sum);
    const body = UI.el('div', 'pcbody');
    body.appendChild(bodyEl);
    det.appendChild(body);
    return det;
  },
  // 消息气泡（cmsg；role: user/ai/sys/err/rst；opts：text/imgs/imgRef/wdTags/wdBuiltin/actions/mIdx）
  bubble: function (role, text, opts) {
    opts = opts || {};
    if (role === 'assistant') role = 'ai';   // 角色归一：历史消息 assistant == ai 气泡
    const d = UI.el('div', 'cmsg ' + role);
    const whoMeta = { user: { label: '', icon: 'user' }, ai: { label: 'AI', icon: 'bot' }, sys: { label: '系统', icon: 'info' }, err: { label: '错误', icon: 'alert' }, rst: { label: '结果', icon: 'image' } }[role] || null;
    if (whoMeta && role !== 'user') {   // 用户消息不显示头像（仅正文）
      const w = UI.el('div', 'who');
      w.appendChild(UI.avatar(whoMeta.icon));
      w.appendChild(UI.el('span', null, whoMeta.label));
      d.appendChild(w);
    }
    const body = UI.el('div', 'body');
    renderMessageText(body, text == null ? '' : text);
    d.appendChild(body);
    if (opts.imgs && opts.imgs.length) {
      const row = UI.el('div', 'imgs');
      opts.imgs.forEach((it, k) => {
        const a = UI.el('a'); a.href = it.viewUrl || it; a.target = '_blank'; a.title = (it.filename || '图片') + ' · 点击查看原图';
        const w2 = UI.el('span', 'giw'); w2.style.position = 'relative';
        const img = UI.el('img'); img.src = it.dataUrl || it; img.alt = '图片' + (k + 1);
        w2.append(img, UI.el('b', 'imgnum', '图' + (k + 1)));
        a.appendChild(w2); row.appendChild(a);
      });
      d.appendChild(row);
    }
    if (opts.imgRef) d.appendChild(UI.el('div', 'imgref', opts.imgRef));
    if (opts.wdBuiltin !== undefined) {
      d.appendChild(UI.tagModule('原图内置 Tag', opts.wdBuiltin));
      d.appendChild(UI.tagModule('模型识别 Tag', opts.wdTags || []));
    } else if (opts.wdTags && opts.wdTags.length) {
      const chips = UI.el('div', 'wdmsg-tags');
      opts.wdTags.slice(0, 12).forEach(t => chips.appendChild(UI.tagChip(t)));
      d.appendChild(chips);
    }
    if (opts.actions && opts.actions.length) {
      const acts = UI.el('div', 'gacts');
      for (const ac of opts.actions) {
        let b;
        if (ac.icon && ICONS[ac.icon]) b = UI.iconBtn(ac.icon, ac.title || ac.label, ac.fn);
        else { b = UI.el('button', 'fbtn', ac.label); b.onclick = ac.fn; }
        acts.appendChild(b);
      }
      d.appendChild(acts);
    }
    // 消息操作（置底）：复制 / 修改 / 重新生成 —— 悬停消息时显现
    if (role === 'user' || role === 'ai' || role === 'rst') {
      const acts = UI.el('div', 'cacts');
      const mk = (icon, title, fn) => { const b = UI.iconBtn(icon, title, fn); acts.appendChild(b); };
      mk('copy', '复制这条消息', () => copyText(body.dataset.raw != null ? body.dataset.raw : body.textContent, '已复制这条消息'));
      if (role === 'user' && opts.mIdx != null && opts.mIdx >= 0) mk('edit', '修改此条', () => talkEdit(opts.mIdx));
      if ((role === 'ai' || role === 'rst') && opts.mIdx != null && opts.mIdx >= 0) mk('refresh', '重新生成', () => talkRegen(opts.mIdx));
      d.appendChild(acts);
    }
    return { el: d, body };
  }
};

// ===== 消息富文本渲染：```代码块自动包裹（DeepSeek 风格：顶部语言栏 + 复制按钮） =====
function buildCodeBlock(lang, code) {
  const w = UI.el('div', 'codeblock');
  const bar = UI.el('div', 'codebar');
  bar.appendChild(UI.el('span', 'codelang', (lang || 'text').trim() || 'text'));
  const cp = UI.el('button', 'codebtn');
  cp.appendChild(UI.ic('copy', 13));
  cp.appendChild(UI.el('span', null, '复制'));
  cp.onclick = (e) => { e.stopPropagation(); copyText(code, '已复制代码'); };
  bar.appendChild(cp);
  const pre = UI.el('pre', 'codepre');
  pre.textContent = code;
  w.append(bar, pre);
  return w;
}
function renderMessageText(el, text) {
  el.replaceChildren();
  const raw = String(text == null ? '' : text);
  el.dataset.raw = raw;
  const parts = raw.split('```');
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (i % 2 === 0) {
      if (seg) el.appendChild(UI.el('div', 'msg-text', seg));
    } else {
      const nl = seg.indexOf('\n');
      const lang = nl >= 0 ? seg.slice(0, nl).trim() : '';
      const code = nl >= 0 ? seg.slice(nl + 1) : seg;
      el.appendChild(buildCodeBlock(lang, code));
    }
  }
}
