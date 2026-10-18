// 够小够用的假 DOM：只实现面板真正用到的那几样。
//
// 为什么不用 jsdom：本仓库运行时零依赖，不自带它。这一份不是"浏览器"，
// 是一张够让外壳与九块面板**真画一遍**的桌子——它要抓的是四样东西：
//   ① 语法错、名字打错、方法不存在
//   ② 画的时候抛异常（真起服务、真调模块，回执是真数据）
//   ③ 面板契约破了（没交 名/标题/画，或者动作名写错被宿主拒）
//   ④ 面板自造的类名（`用过的类名()` 供自检对着样式表核）
// 它**不断言长相**：长得对不对只能人看。
//
// 文本这一层按真 DOM 的算法来：`textContent` 是**孩子按顺序现算出来的**，不是存下来的。

/** 一个能当元素用的小东西。 */
class 假元素 {
  constructor(名 = 'div') {
    this.tagName = String(名).toUpperCase();
    this.children = [];
    this.childNodes = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.parentNode = null;
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.textContent = '';
    this.classList = {
      _s: new Set(),
      add: (...c) => { for (const x of c) this.classList._s.add(x); },
      remove: (...c) => { for (const x of c) this.classList._s.delete(x); },
      toggle: (c, on) => {
        const 要 = on === undefined ? !this.classList._s.has(c) : Boolean(on);
        if (要) this.classList._s.add(c); else this.classList._s.delete(c);
        return 要;
      },
      contains: (c) => this.classList._s.has(c),
    };
  }

  /**
   * className 与 classList 是**同一份**：真浏览器里写 `元.className = 'a b'`
   * 之后 `classList.contains('a')` 为真，这里照做。
   */
  get className() { return [...this.classList._s].join(' '); }
  set className(值) {
    this.classList._s = new Set(String(值 == null ? '' : 值).split(/\s+/).filter(Boolean));
  }

  /**
   * textContent 与真 DOM 一个算法：**它永远是从这棵树算出来的**，不是存下来的。
   *
   * 读：自己的孩子按顺序的文本拼起来（读的时候现算，所以孩子后加进来也算数）。
   * 写：把孩子全丢掉，只留下这段字（界面里 `清(容器)` 就是写空串）。
   */
  get textContent() {
    let 出 = this._字 || '';
    for (const 孩 of this.children) 出 += 孩.textContent;
    return 出;
  }
  set textContent(值) {
    this._字 = String(值 === undefined || 值 === null ? '' : 值);
    for (const 孩 of this.children) 孩._连着 = false;
    this.children = [];
    this.childNodes = [];
  }
  get firstElementChild() { return this.children[0] || null; }
  get isConnected() { return this._连着 === true; }
  get options() { return this.children.filter((c) => c.tagName === 'OPTION'); }
  get files() { return this._files || []; }
  set files(v) { this._files = v; }

  append(...孩子们) {
    for (const 孩 of 孩子们) {
      if (孩 === undefined || 孩 === null) continue;
      if (!(孩 instanceof 假元素)) {
        // 文本节点：当真 DOM 那样建一个只带字的节点。
        const 文 = new 假元素('#text');
        文._字 = String(孩);
        this.children.push(文);
        this.childNodes.push(文);
        continue;
      }
      孩.parentNode = this;
      孩._连着 = true;
      this.children.push(孩);
      this.childNodes.push(孩);
    }
  }
  before() {}
  after() {}
  remove() {
    if (this.parentNode) {
      const i = this.parentNode.children.indexOf(this);
      if (i >= 0) this.parentNode.children.splice(i, 1);
      this.parentNode = null;
    }
    this._连着 = false;
  }
  /**
   * 清空一个容器：与真浏览器里赋空 textContent 等价。
   * （界面里 `清(容器)` 优先叫这个方法，叫不到才走 textContent。）
   */
  清() { this.textContent = ''; }
  insertBefore(孩) { this.append(孩); }
  /** 深拷一份（回执模子靠它）。 */
  cloneNode() {
    const 新 = new 假元素(this.tagName.toLowerCase());
    新.className = this.className;
    新.textContent = this.textContent;
    for (const c of this.classList._s) 新.classList.add(c);
    for (const [k, v] of this.attributes) 新.attributes.set(k, v);
    Object.assign(新.dataset, this.dataset);
    for (const 孩 of this.children) 新.append(孩.cloneNode());
    return 新;
  }
  /** `<dialog>` 的那两个方法：这里不当真，只保证"有得调"。 */
  showModal() { this._开着 = true; }
  show() { this._开着 = true; }
  close() { this._开着 = false; }
  setAttribute(名, 值) { this.attributes.set(String(名), String(值)); }
  getAttribute(名) { return this.attributes.get(String(名)) ?? null; }
  removeAttribute(名) { this.attributes.delete(String(名)); }
  addEventListener(名, 做) {
    if (!this.listeners.has(名)) this.listeners.set(名, []);
    this.listeners.get(名).push(做);
  }
  removeEventListener() {}
  /** 假装点一下（自检用）。 */
  点() {
    for (const 做 of this.listeners.get('click') || []) 做({ currentTarget: this, stopPropagation() {}, preventDefault() {} });
  }
  querySelector(选) {
    // 认两种：`.类` 与 `标签.类`；只往底下找。
    const 找 = (根) => {
      for (const 孩 of 根.children) {
        if (命中(孩, 选)) return 孩;
        const 深 = 找(孩);
        if (深) return 深;
      }
      return null;
    };
    return 找(this);
  }
  querySelectorAll(选) {
    const 出 = [];
    const 找 = (根) => {
      for (const 孩 of 根.children) {
        if (命中(孩, 选)) 出.push(孩);
        找(孩);
      }
    };
    找(this);
    return 出;
  }
  /** 把这一棵子树摊成一行文本：每个元素只算自己那一段字（断言用）。 */
  文字() {
    let 出 = this._字 || '';
    for (const 孩 of this.children) 出 += ` ${孩.文字()}`;
    return 出.replace(/\s+/g, ' ').trim();
  }
}

function 命中(元, 选) {
  const 净 = String(选).replace(/^[a-z]+/i, '');
  const 类们 = 净.split('.').filter(Boolean);
  if (!类们.length) return false;
  return 类们.every((c) => 元.classList.contains(c));
}

/**
 * 源码里 `造('标签.类.类')` 用到的类名。
 *
 * 类名是长相的唯一来源（`页/页.css` 与 `页/组件.css`），面板里自造一个就等于把长相
 * 拆成九份。这一支把用法捞出来，供自检对着那两份文件的类名表核一遍。
 *
 * @param {string} 源 一份面板的源码
 * @returns {string[]} 去重后的类名
 */
export function 用过的类名(源) {
  const 出 = new Set();
  for (const m of String(源).matchAll(/造\(\s*'([a-zA-Z\u4e00-\u9fa5][^']*)'/g)) {
    const 类们 = m[1].split('.').slice(1);
    for (const 类 of 类们) 出.add(类);
  }
  return [...出];
}

/** 造一整套全局。 */
export function 造假DOM() {
  const 表 = new Map();
  const 按id = (id) => {
    if (!表.has(id)) 表.set(id, new 假元素('div'));
    return 表.get(id);
  };

  // 窗口级事件：外壳挂的是 hashchange，切面板这条真路要靠它响。
  const 窗口听众 = new Map();
  const 加窗口监听 = (名, 做) => {
    if (!窗口听众.has(名)) 窗口听众.set(名, []);
    窗口听众.get(名).push(做);
  };
  const 派给窗口 = (名) => {
    for (const 做 of 窗口听众.get(名) || []) {
      try { 做({ type: 名 }); } catch (错) { console.error('[假DOM] 听众抛了：', 错 && 错.message); }
    }
  };

  const 模子 = new 假元素('template');
  const 模子内容 = new 假元素('div');
  模子内容.classList.add('回执');
  for (const 类 of ['回执头', '判', '码', '伸', '折', '拷', '回执人话', '回执体']) {
    const 元 = new 假元素('div');
    元.classList.add(类);
    模子内容.append(元);
  }
  模子.content = { firstElementChild: 模子内容 };

  const 文档 = {
    getElementById: 按id,
    createElement: (名) => new 假元素(名),
    createTextNode: (字) => String(字),
    querySelector: (选) => (选 === '#回执模子' ? 模子 : null),
    querySelectorAll: () => [],
    addEventListener() {},
    body: new 假元素('body'),
    documentElement: new 假元素('html'),
    title: '',
  };
  按id('回执模子').content = 模子.content;

  const 地址 = { hash: '', href: 'http://127.0.0.1/', assign() {}, reload() {} };
  const 位置 = new Proxy(地址, {
    set(目标, 名, 值) {
      目标[名] = 值;
      // 真浏览器里改 hash 会发一条 hashchange；这里照做，不然"点导航切面板"这条真路跑不起来。
      if (名 === 'hash') setTimeout(() => 派给窗口('hashchange'), 0);
      return true;
    },
  });

  const 全局 = {
    document: 文档,
    location: 位置,
    navigator: { clipboard: { writeText: async () => {} } },
    performance: { now: () => Date.now() },
    alert: () => {},
    confirm: () => true,
    prompt: () => null,
    setTimeout: (做, 毫秒) => setTimeout(做, 毫秒),
    clearTimeout,
    setInterval: (做, 毫秒) => setInterval(做, 毫秒),
    clearInterval,
    addEventListener: 加窗口监听,
    URLSearchParams,
    URL,
    Blob: class { constructor(部) { this.部 = 部; } },
    FileReader: class {
      readAsDataURL() { this.onerror && this.onerror(new Error('假 DOM 不读文件')); }
      readAsText() { this.onerror && this.onerror(new Error('假 DOM 不读文件')); }
    },
    EventSource: class {
      constructor() { this.readyState = 1; }
      close() {}
    },
    fetch: (...参) => globalThis.fetch(...参),
  };

  return { 全局, 文档, 按id, 假元素, 派给窗口 };
}

/** 把那一套塞进 globalThis。 */
export function 装上假DOM() {
  const 一套 = 造假DOM();
  // `Node` 是浏览器里的基类：界面代码用 `instanceof Node` 分辨元素与文本。
  globalThis.Node = 一套.假元素;
  for (const [名, 值] of Object.entries(一套.全局)) {
    if (!(名 in globalThis)) globalThis[名] = 值;
  }
  globalThis.window = globalThis;
  return 一套;
}
