// 界面里的顺手件：造元素 · 画回执 · 字节与时间的说法。
//
// 回执一律原样画：宿主给什么画什么，字段名不改、不加工。一处例外是为了看得见——
// 回执里带的原始字节画成图（JSON 里换成一句"多少字节"）。那条也是模块与门面
// 都认过的事（判据②），不是界面在替谁做判断。

/**
 * 造一个元素。
 * @param {string} 名 标签名，`div.a.b` 这种简写也认
 * @param {object|string} [属] 属性；给字符串就是文本
 * @param {...*} 孩子们
 */
export function 造(名, 属, ...孩子们) {
  const [标签, ...类们] = String(名).split('.');
  const 元 = document.createElement(标签 || 'div');
  if (类们.length) 元.className = 类们.join(' ');
  // 第二格是不是"属性"，看它**是不是一个节点**：是节点就归到孩子里去。
  // （只看"是不是对象"会把传进来的元素当成属性表——元素身上每个字段都成了属性名。）
  if (属 instanceof Node || typeof 属 === 'string' || typeof 属 === 'number') 孩子们.unshift(属);
  else if (属 && typeof 属 === 'object') {
    for (const [k, v] of Object.entries(属)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') 元.className = [元.className, v].filter(Boolean).join(' ');
      else if (k === 'text') 元.textContent = String(v);
      else if (k === 'html') 元.innerHTML = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(元.style, v);
      else if (k.startsWith('on') && typeof v === 'function') 元.addEventListener(k.slice(2), v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(元.dataset, v);
      else 元.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const 孩 of 孩子们.flat()) {
    if (孩 === undefined || 孩 === null || 孩 === false) continue;
    元.append(孩 instanceof Node ? 孩 : document.createTextNode(String(孩)));
  }
  return 元;
}

/** 清空一个容器并交回它。 */
export function 清(容器) {
  // 浏览器里赋空 textContent 就把孩子丢了；自检那份假 DOM 靠这个方法做同一件事。
  if (typeof 容器.清 === 'function') 容器.清();
  else 容器.textContent = '';
  return 容器;
}

/** 字节数写成人话。 */
export function 说字节(n) {
  const 数 = Number(n) || 0;
  if (数 < 1024) return `${数} 字节`;
  if (数 < 1024 * 1024) return `${(数 / 1024).toFixed(1)} KB`;
  return `${(数 / 1024 / 1024).toFixed(2)} MB`;
}

/** 秒数写成"1.2 秒"这种。 */
export function 说秒(毫秒) {
  const 毫 = Number(毫秒) || 0;
  if (毫 < 1000) return `${Math.round(毫)} 毫秒`;
  if (毫 < 60000) return `${(毫 / 1000).toFixed(2)} 秒`;
  return `${Math.floor(毫 / 60000)} 分 ${Math.round((毫 % 60000) / 1000)} 秒`;
}

/** 时间戳写成人话。 */
export function 说时间(值) {
  if (值 === undefined || 值 === null || 值 === '') return '';
  const 数 = typeof 值 === 'number' ? 值 : Date.parse(值);
  if (!Number.isFinite(数)) return String(值);
  const d = new Date(数);
  const 补 = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${补(d.getMonth() + 1)}-${补(d.getDate())} ${补(d.getHours())}:${补(d.getMinutes())}`;
}

/** 长短文本截断（画列表用，不改原文）。 */
export function 截(文本, 多少 = 60) {
  const 字 = String(文本 === undefined || 文本 === null ? '' : 文本);
  return 字.length > 多少 ? `${字.slice(0, 多少)}…` : 字;
}

/** 一个值是不是字节串（宿主是 Node，Buffer 过 JSON 成了 `{type:'Buffer',data:[…]}`）。 */
export function 是字节(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if ((v.type === 'Buffer' || v.type === 'Uint8Array') && Array.isArray(v.data)) return true;
  if (typeof v.length !== 'number' || typeof v.type !== 'string') return false;
  const 键 = Object.keys(v);
  if (!键.length || 键.length !== v.length) return false;
  return 键.every((k) => String(Number(k)) === k);
}

/** 字节串 → 能塞进 <img> 的地址。 */
export function 成地址(字节, mime) {
  const 源 = Array.isArray(字节.data) ? 字节.data : 字节;
  const 数组 = new Uint8Array(源.length);
  for (let i = 0; i < 源.length; i += 1) 数组[i] = 源[i];
  return URL.createObjectURL(new Blob([数组], { type: mime || 'image/png' }));
}

/** 把回执里的字节串换成一句人话，并把那些字节收进 见到。 */
function 摘字节(v, 见到, mime) {
  if (是字节(v)) { 见到.push({ 字节: v, mime }); return `<原始字节：${说字节((v.data || v).length)}>（已画在下面）`; }
  if (Array.isArray(v)) return v.map((一) => 摘字节(一, 见到, mime));
  if (v && typeof v === 'object') {
    const 这层mime = typeof v.mime === 'string' ? v.mime : mime;
    const 出 = {};
    for (const [k, 一] of Object.entries(v)) 出[k] = 摘字节(一, 见到, 这层mime);
    return 出;
  }
  return v;
}

/**
 * 画一份回执。宿主交回来的东西原样画，失败信封也一样。
 *
 * @param {object} 参数
 *   回     宿主给的（成功给 data 本身、失败给 `{ok:false,reason,code}`）
 *   耗时   毫秒
 *   模子   页面里那份 <template id="回执模子">
 *   收起   一开始就收起（列表里一次好几份时用）
 * @returns {HTMLElement}
 */
export function 画回执({ 回, 耗时, 模子, 收起 = false }) {
  const 盒 = 模子.content.firstElementChild.cloneNode(true);
  const 失败 = Boolean(回 && typeof 回 === 'object' && 回.ok === false);
  const 判 = 盒.querySelector('.判');
  判.textContent = 失败 ? '失败' : '成功';
  判.classList.add(失败 ? '坏' : '好');
  const 码 = 盒.querySelector('.码');
  码.textContent = 回 && 回.code ? 回.code : '';
  if (耗时 !== undefined && 耗时 !== null) {
    const 耗 = 造('span.耗时', `用时 ${说秒(耗时)}`);
    盒.querySelector('.回执头').insertBefore(耗, 盒.querySelector('.伸'));
  }

  if (失败) 盒.querySelector('.回执人话').textContent = 回.reason || '模块没给理由';

  // 字节先摘出来画成图，剩下的原样 JSON。
  const 字节们 = [];
  const 干净 = 摘字节(回, 字节们);
  const 体 = 盒.querySelector('.回执体');
  if (字节们.length) {
    const 块 = 造('div.竖排');
    for (const 一个 of 字节们) {
      const 图 = 造('img', { alt: '回执里的字节', src: 成地址(一个.字节, 一个.mime) });
      块.append(图);
    }
    体.append(块);
  }
  const pre = 造('pre');
  try { pre.textContent = JSON.stringify(干净 === undefined ? null : 干净, null, 2); } catch (_) { pre.textContent = String(干净); }
  体.append(pre);

  盒.querySelector('.拷').addEventListener('click', async (e) => {
    const 钮 = e.currentTarget;
    try {
      await navigator.clipboard.writeText(JSON.stringify(回, null, 2));
      钮.textContent = '复制好了';
    } catch (_) { 钮.textContent = '复制不了'; }
    setTimeout(() => { 钮.textContent = '复制回执'; }, 1200);
  });
  const 折 = 盒.querySelector('.折');
  折.addEventListener('click', () => {
    const 收着 = 盒.classList.toggle('fold');
    折.textContent = 收着 ? '展开' : '收起';
  });
  if (收起) {
    盒.classList.add('fold');
    折.textContent = '展开';
  }
  return 盒;
}

/**
 * 按交付面画一个输入控件。
 *
 * 控件种类由宿主给（`参数.界面.控件`）；这里只负责画。**不校验、不补默认值、
 * 不替用户拦**——留空就是不传，必填留空照传，拒绝是模块的事。
 *
 * @param {object} 一 交付面里那一条参数 `{ 名, 可选, 说明, 界面, 类型 }`
 * @param {object} 值 现成的值（从上下文来的）
 * @returns {{ 元:HTMLElement, 取值:() => any }}
 */
export function 画一个参数(一, 值) {
  const 控件 = (一.界面 && 一.界面.控件) || 'text';
  const 现成 = 值 !== undefined;
  let 读 = () => 值;

  if (控件 === 'context') {
    // 上下文给的：不给人填。画成一句说明 + 现值。
    const 元 = 造('div.字段');
    元.append(造('div.标', 一.名, 造('span.标签', '上下文')));
    if (一.说明) 元.append(造('p.说', 一.说明));
    let 文;
    if (现成) 文 = typeof 值 === 'string' ? 值 : JSON.stringify(值);
    else 文 = '（这一步还没从上下文里挑东西）';
    元.append(造('div.说', { style: { color: 'var(--字更淡)' } }, 文));
    if (一.界面 && 一.界面.字段) {
      元.append(造('div.说', `里面有：${一.界面.字段.map((f) => f.名).join(' · ')}`));
    }
    读 = () => 值;
    return { 元, 取值: () => 读() };
  }

  if (控件 === 'boolean') {
    const 框 = 造('input', { type: 'checkbox', checked: 值 === true });
    const 元 = 造('div.字段');
    const 标 = 造('label.标');
    标.append(框, ` ${一.名}`, 一.可选 ? 造('span.可选', '可选') : null);
    元.append(标);
    if (一.说明) 元.append(造('p.说', 一.说明));
    return { 元, 取值: () => (框.checked ? true : undefined) };
  }

  if (控件 === 'select') {
    const 选 = 造('select');
    if (一.可选) 选.append(造('option', { value: '' }, '（不传）'));
    for (const 项 of (一.界面 && 一.界面.选项) || []) 选.append(造('option', { value: 项 }, 项));
    if (现成 && typeof 值 === 'string') 选.value = 值;
    const 元 = 造('div.字段');
    元.append(造('div.标', 一.名, 一.可选 ? 造('span.可选', '可选') : null));
    if (一.说明) 元.append(造('p.说', 一.说明));
    元.append(选);
    return { 元, 取值: () => (选.value === '' ? undefined : 选.value) };
  }

  if (控件 === 'number') {
    const 框 = 造('input', { type: 'number', value: 现成 ? 值 : '' });
    const 元 = 造('div.字段');
    元.append(造('div.标', 一.名, 一.可选 ? 造('span.可选', '可选') : null));
    if (一.说明) 元.append(造('p.说', 一.说明));
    元.append(框);
    return {
      元,
      取值: () => {
        const 字 = 框.value.trim();
        if (字 === '') return undefined;
        const 数 = Number(字);
        return Number.isFinite(数) ? 数 : 字;
      },
    };
  }

  // text / textarea / ref 都是"写一串字"：ref 的那串字由调用方先挑好再填进来。
  const 初值 = 现成 ? (typeof 值 === 'object' ? JSON.stringify(值) : String(值)) : '';
  const 框 = 控件 === 'textarea' ? 造('textarea', { rows: 6 }) : 造('input', { type: 'text' });
  框.value = 初值;
  const 元 = 造('div.字段');
  const 标 = 造('div.标', 一.名);
  if (控件 === 'ref') 标.append(造('span.标签', '标识'));
  if (一.可选) 标.append(造('span.可选', '可选'));
  元.append(标);
  if (一.说明) 元.append(造('p.说', 一.说明));
  if (一.类型 && 一.类型.type === 'object') {
    元.append(造('p.说', `这个参数是对象：${一.界面 && 一.界面.字段 ? 一.界面.字段.map((f) => f.名).join(' · ') : '形状见模块的接口.md'}`));
  }
  元.append(框);
  return {
    元,
    取值: () => {
      const 字 = 框.value.trim();
      if (字 === '') return undefined;
      // 只有对象形状的参数才试着当 JSON 解；别的按原字走（界面上写什么就是什么）。
      if (一.类型 && (一.类型.type === 'object' || 一.类型.oneOf)) {
        try { return JSON.parse(字); } catch (_) { return 字; }
      }
      return 字;
    },
  };
}

/** 一个按钮：按下时禁用、跑着时显示耗时，跑完交回给 做。 */
export function 一个动作钮({ 话, 主, 做 }) {
  const 钮 = 造('button', { class: 主 ? '主' : '' }, 话);
  const 耗 = 造('span.耗时');
  let 跑着 = false;
  钮.addEventListener('click', async () => {
    if (跑着) return;
    跑着 = true;
    钮.disabled = true;
    const 原话 = 钮.textContent;
    钮.textContent = '跑着…';
    耗.textContent = '';
    const 起 = Date.now();
    const 滴 = setInterval(() => { 耗.textContent = 说秒(Date.now() - 起); }, 200);
    try {
      await 做();
    } finally {
      clearInterval(滴);
      耗.textContent = 说秒(Date.now() - 起);
      钮.disabled = false;
      钮.textContent = 原话;
      跑着 = false;
    }
  });
  return { 钮, 耗 };
}

/**
 * 分段控件：2–5 个互斥视图之间切。
 *
 * 选中态写在 `aria-selected` 上——读屏与样式读的是同一个来源。切的时候叫一次 切到(值)。
 *
 * @param {Array<{值:string, 话?:string, 数?:number}>} 段们 没给 `话` 就拿 `值` 当字
 * @param {string} 选 一开始选哪个
 * @param {(值:string) => void} 切到
 * @returns {{ 元:HTMLElement, 选(值:string):void }}
 */
export function 分段(段们, 选, 切到) {
  const 元 = 造('div.分段', { role: 'tablist' });
  const 表 = new Map();
  for (const 一 of 段们) {
    const 段 = 造('button.段', { type: 'button', role: 'tab', 'aria-selected': String(一.值 === 选) }, 一.话 || 一.值);
    if (一.数 !== undefined) 段.append(造('span.数', String(一.数)));
    段.addEventListener('click', () => { 定(一.值); 切到(一.值); });
    表.set(一.值, 段);
    元.append(段);
  }
  function 定(值) {
    for (const [值2, 段] of 表) 段.setAttribute('aria-selected', String(值2 === 值));
  }
  return { 元, 选: 定 };
}

/**
 * 弹一句话，过一会儿自己走。
 *
 * 用它替掉 `alert`：不遮整页、能连起来看、假 DOM 里也走得通。
 *
 * @param {string} 话
 * @param {'淡'|'成'|'错'|'警'} [味]
 * @param {number} [留毫秒] 默认 2600
 */
export function 吐司(话, 味 = '淡', 留毫秒 = 2600) {
  let 盒 = document.getElementById('吐司们');
  if (!盒) {
    盒 = 造('div.吐司们', { id: '吐司们' });
    (document.body || document.documentElement).append(盒);
  }
  const 条 = 造(`div.吐司${味 === '淡' ? '' : `.${味}`}`, 话);
  盒.append(条);
  setTimeout(() => {
    条.style.opacity = '0';
    setTimeout(() => 条.remove(), 240);
  }, 留毫秒);
}

/**
 * 要人填完了才能继续。
 *
 * 用它替掉 `confirm` 与 `prompt`：那两样遮整页、条数多起来读不出前后关系，
 * 而且假 DOM 里是空壳（自检走不到这条路）。
 *
 * 交回一个 Promise：按了确定给它按下的那个值，按了取消给 `undefined`。
 *
 * @param {object} 参数
 *   标题   对话框顶上那句话
 *   身     一个 DOM 子树（用 `.字段` 排）
 *   确定   确定钮写什么，默认「确定」
 *   危     确定钮用红的
 *   要     () => 按下确定时把值算出来
 * @returns {Promise<any>}
 */
export function 要人填({ 标题, 身, 确定 = '确定', 危 = false, 要 }) {
  return new Promise((成) => {
    const 框 = 造('dialog.对框');
    const 收 = (值) => {
      try { 框.close(); } catch (_) { /* 假 DOM 里没有 close：关不掉也不该拦住交回 */ }
      框.remove();
      成(值);
    };
    const 取 = 造('button.钮', { type: 'button', class: `主${危 ? ' 危' : ''}` }, 确定);
    取.addEventListener('click', () => 收(要 ? 要() : true));
    const 消 = 造('button.钮', { type: 'button' }, '取消');
    消.addEventListener('click', () => 收(undefined));
    框.append(
      造('div.对框头', 标题),
      造('div.对框身', 身),
      造('div.对框脚', 消, 取),
    );
    (document.body || document.documentElement).append(框);
    if (typeof 框.showModal === 'function') 框.showModal();
  });
}

