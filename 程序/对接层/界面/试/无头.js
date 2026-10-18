// 界面层自检 · 无头那一份。
//
//   node 对接层/界面/试/无头.js [--端口 8798]
//
// **真起服务**（真装配、真模块、真数据），把外壳与九块面板在一个够小的假 DOM 上
// 真画一遍。它抓三样：
//   ① 语法错、名字打错、方法不存在（一画就露）
//   ② 画的时候抛异常（回执是真数据，不是造的）
//   ③ 面板契约破了：没交 名/标题/画，或者声明的动作宿主给不出来
//
// 它**不断言长相**：长得对不对只能人看。这一份跑完不留残留：起的服务会关掉。
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { 装上假DOM, 用过的类名 } from './假DOM.js';

const 本目录 = path.dirname(fileURLToPath(import.meta.url));
const 界面目录 = path.resolve(本目录, '..');

let 过了 = 0;
let 崩了 = 0;
const 失败们 = [];

function 判(话, 真, 额外 = '') {
  if (真) { 过了 += 1; console.log(`  ✓ ${话}`); return true; }
  崩了 += 1;
  失败们.push(`${话}${额外 ? ` —— ${额外}` : ''}`);
  console.log(`  ✗ ${话}${额外 ? ` —— ${额外}` : ''}`);
  return false;
}

/** 命令行：--端口。 */
function 端口() {
  const i = process.argv.indexOf('--端口');
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : 8798;
}

/** 等一件事做完：给个毫秒数，或者给个"等到它真"的条件。 */
const 歇 = (毫秒) => new Promise((成) => setTimeout(成, 毫秒));
async function 等到(条件, 上限毫秒 = 30000) {
  const 死线 = Date.now() + 上限毫秒;
  while (Date.now() < 死线) {
    try { if (await 条件()) return true; } catch (_) { /* 还没好 */ }
    await 歇(120);
  }
  return false;
}

async function 主() {
  const 号 = 端口();
  const 基 = `http://127.0.0.1:${号}`;

  console.log('一、起服务（真装配）');
  const { 起, 这次启动的令牌 } = await import('../服务.js');
  const 服务 = 起({ 端口: 号, 项目根: path.resolve(界面目录, '..', '..') });
  await new Promise((成) => 服务.once('listening', 成));
  const 令牌 = 这次启动的令牌;
  判('服务起来了', 服务.listening === true);

  // 令牌那两条路。`/` 现在是旧版那层皮，它自带 `script-src 'self'` 的 CSP，
  // 所以令牌走同源脚本；我们原来那份页面走内联标记，两条都得注进去。
  const 皮 = await (await fetch(`${基}/`)).text();
  判('皮的令牌标记没留在页面上', !皮.includes('/*令牌*/null'));
  const 令牌脚本 = await (await fetch(`${基}/我们的令牌.js`)).text();
  判('页面把令牌注进去了', 令牌脚本.includes(`window.__令牌__ = "${令牌}"`));
  const 我们那份 = await (await fetch(`${基}/页/我们的页.html`)).text();
  判('我们那份页面的令牌也注进去了', 我们那份.includes(`window.__令牌__ = "${令牌}"`)
    && !我们那份.includes('/*令牌*/null'));

  console.log('二、装假 DOM（够画一遍就行）');
  // 页面会在最前面注入令牌；这里照做。
  globalThis.window = globalThis;
  globalThis.__令牌__ = 令牌;
  const 一套 = 装上假DOM();
  // fetch 的相对地址：浏览器按页面地址解，这里照同一个规矩补上。
  const 真fetch = globalThis.fetch;
  globalThis.fetch = (路, 选) => 真fetch(String(路).startsWith('http') ? 路 : 基 + 路, 选);
  判('假 DOM 装上了', Boolean(globalThis.document));

  console.log('三、导外壳（它一导入就去要动作表、画导航）');
  const 壳 = await import('../页/壳.js').then(() => true).catch((错) => String((错 && 错.stack) || 错));
  判('壳.js 导入不抛', 壳 === true, 壳 === true ? '' : 壳);

  const 导航 = 一套.按id('导航');
  const 身 = 一套.按id('身');
  // 外壳是异步起手的：它要先要到动作表才画导航，这里等它一下。
  const 导航好了 = await 等到(() => 导航.children.length > 0, 15000);
  判('导航画出来了', 导航好了 && 导航.children.length >= 12, `实际 ${导航.children.length} 项`);
  const 名们 = 导航.children.map((一) => 一.文字());
 	for (const 要的 of ['标签', '收藏', '标签组', '角色库', '图片', '识图', '装订 / 翻译', '翻译', '世界书', 'comfyUI', '主 AI', '全部动作']) {
    判(`导航里有「${要的}」`, 名们.some((n) => n.includes(要的)), `实际：${名们.join(' / ')}`);
  }

  console.log('四、逐块面板真画一遍（回执是真数据）');
  // 交付面要先拿到：下面每画一块都要拿它核对该块调过的动作名。
  const 桌 = await (await fetch(`${基}/toolbox/桌`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 令牌 },
    body: '{}',
  })).json();
  // 面板清单从壳里那份导航拿；切面板靠 hash + 那个 hashchange 监听，
  // 这里直接改 hash 再叫一次……监听在假 DOM 里不会自己响，所以直接调壳的切法：
  // 壳把 切 藏在闭包里，于是这里走"点导航项"那条真路。
  const 面板名们 = ['tag', 'image', 'vision', 'binding', 'translate', 'worldbook', 'comfy', '主AI', '面板'];
  const 交付面 = new Set((桌.动作表 || []).map((一) => `${一.模块}/${一.动作}`));
  for (let i = 0; i < 导航.children.length; i += 1) {
    const 项 = 导航.children[i];
    // 导航项的文字是"名字 + 缺不缺"两截，取第一截当标题。
    const 标题 = 项.文字().split(/\s+/)[0] || `第 ${i + 1} 块`;
    if (typeof globalThis.__清总账__ === 'function') globalThis.__清总账__();
    项.点();
    // 每块面板起手都会自己去要数据——**有四块不用**：标签 · 装订 · 翻译 · 全部动作在画的时候
    // 不调任何动作（前三块等用户按按钮，"全部动作"那块是调试台，等用户挑一个再执行）。
    // 所以"等它调到东西"只对会自己取数的那些成立。
    const 自己取数 = !['标签', '装订', '翻译', '全部动作'].includes(标题);
    const 成了 = await 等到(() => {
      const 字 = 身.文字();
      if (/is not a function|is not defined|Cannot read|Cannot set/.test(字)) return true;
      if (!自己取数) return 字.length > 40;
      const 调过 = typeof globalThis.__调过的__ === 'function' ? globalThis.__调过的__() : [];
      return 调过.length > 0;
    }, 15000);
    await 歇(150);
    const 字 = 身.文字();
    // 只认"真异常"与"动作名不存在"这两种说法；界面自己那句"画不出来：…"由上面一条判。
    const 坏 = /is not a function|is not defined|Cannot read|Cannot set|ReferenceError|SyntaxError|PAGE_NO_SUCH_ACTION|HOST_NO_SUCH_ACTION|没有「.+」这个动作/.exec(字);
    判(`「${标题}」画出了东西`, 成了 && !字.includes('这块面板画不出来') && !坏, `正文长度 ${字.length}`);
    判(`「${标题}」调的动作名都在交付面上`, !/PAGE_NO_SUCH_ACTION|HOST_NO_SUCH_ACTION|没有「.+」这个动作/.test(字),
      (字.match(/(交付面上没有[^。]*。|没有「[^」]+」这个动作)/) || [''])[0]);
    判(`「${标题}」画的时候没抛异常`, !坏 || !/is not a function|is not defined|Cannot read|Cannot set|ReferenceError|SyntaxError/.test(字), 坏 ? 坏[0] : '');
    // 这一块这一遍真调过的动作，逐笔对交付面（写错名字在这里就会露）。
    const 这一块调过 = typeof globalThis.__调过的__ === 'function' ? globalThis.__调过的__() : [];
    const 错的 = 这一块调过.filter((一) => !交付面.has(一));
    判(`「${标题}」这一遍调的 ${这一块调过.length} 个动作名都对得上`, 错的.length === 0, 错的.join(' · '));
  }

  /** 直接调一次，看看记账到底进没进那一份。 */
  async function 宿主探一次() {
    await fetch(`${基}/toolbox/调`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 令牌 },
      body: JSON.stringify({ 模块: 'tag', 动作: 'status', 参数: {} }),
    });
  }

  console.log('五、面板契约：声明的动作宿主给不出来吗');
  const 有 = new Set((桌.动作表 || []).map((一) => `${一.模块}/${一.动作}`));
  const 模块名们 = [...new Set((桌.动作表 || []).map((一) => 一.模块))].sort();
  const 公开模块名们 = ['binding', 'comfy', 'drawing', 'image', 'prompt', 'session', 'tag', 'translate', 'vision', 'worldbook', '主AI'].sort();
  判('宿主交付公开模块名清单', JSON.stringify(模块名们) === JSON.stringify(公开模块名们),
    `实际 ${模块名们.join(' · ')}`);
  // 交付面上每个动作都要有：模块 · 动作 · 摘要 · 参数（参数要带名字与控件）
  const 缺件 = (桌.动作表 || []).filter((一) => !一.模块 || !一.动作 || !一.摘要
    || !Array.isArray(一.参数) || 一.参数.some((p) => !p.名 || !p.界面 || !p.界面.控件));
  判('每条动作都带齐 模块/动作/摘要/参数/控件', 缺件.length === 0,
    缺件.slice(0, 3).map((一) => `${一.模块}/${一.动作}`).join(' '));

  console.log('六、字节那两条路的令牌规矩');
  const 无饼 = await fetch(`${基}/字节?条目ID=img_x`);
  判('不带令牌取字节被挡', 无饼.status === 403, `实际 ${无饼.status}`);
  const 页响应 = await fetch(`${基}/`);
  const 饼 = (页响应.headers.get('set-cookie') || '').split(';')[0];
  const 带饼 = await fetch(`${基}/字节?条目ID=img_x`, { headers: { cookie: 饼 } });
  const 带饼体 = await 带饼.json();
  判('带令牌取不存在的条目 → 如实说码', 带饼体 && 带饼体.code === 'IMAGE_NOT_FOUND',
    JSON.stringify(带饼体).slice(0, 120));

  console.log('七、任务表');
  const 起任务 = await (await fetch(`${基}/toolbox/任务`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 令牌 },
    body: JSON.stringify({ 什么: '不认识的活' }),
  })).json();
  判('认不出的任务被拒', 起任务 && 起任务.ok === false && 起任务.code === 'UI_BAD_TASK', JSON.stringify(起任务));

  console.log('八、越界那条路');
  const 越 = await fetch(`${基}/页/../../cordis.patch.yml`);
  判('页面那条路走不出页目录', 越.status === 404, `实际 ${越.status}`);
  const 没路 = await fetch(`${基}/tools/nothing.js`);
  判('没这条路就 404', 没路.status === 404, `实际 ${没路.status}`);

  console.log('九、面板真调过的动作名，交付面上有没有');
  {
    // 面板里模块与动作两段几乎都是变量（`宿主.调(模块, 动作, 参数)`），源码级扫不出来，
    // 所以走运行时：宿主每调一次就记进一张模块级总账，画一遍九块面板，然后逐笔对交付面。
    // 这一条堵的是一个真出过的毛病：面板里写死模型侧的名字（`detect`），
    // 而交付面交的是模块自己那层的名字（`认图`）——名字错了不会当场炸，
    // 要等用户点下去才报 HOST_NO_SUCH_ACTION。
    判('外壳把记账摆出来了', typeof globalThis.__调过的__ === 'function' && typeof globalThis.__清总账__ === 'function');
    const 有 = new Set((桌.动作表 || []).map((一) => `${一.模块}/${一.动作}`));

    // 再回「识图」那块，点它那几个按钮：把"只有点了才会走"的那几条路也真跑一遍。
    // 那三个按钮都要"手上有图"才肯走（没图时面板自己拦一句），所以先清空那一格、种一张真图进去。
    // 识图工作区是单张槽位，写之前先清空是写入方的事（图片模块 R-F-12）。
    const { 造PNG } = await import('../../../识图模块/test/造图.js');
    await fetch(`${基}/toolbox/调`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 令牌 },
      body: JSON.stringify({ 模块: 'image', 动作: '清空', 参数: { 作用域: { 存放地: 'vision' } } }),
    });
    const 种 = await (await fetch(`${基}/存图`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 令牌 },
      body: JSON.stringify({
        作用域: { 存放地: 'vision' },
        字节: Array.from(造PNG({ 宽: 64, 高: 64 })),
        文件名: '界面自检种图.png',
        mime: 'image/png',
        来源: 'upload',
      }),
    })).json();
    判('先种一张图进识图工作区（那三个按钮要有图才肯走）', Boolean(种 && 种.引用), JSON.stringify(种).slice(0, 120));
    globalThis.__清总账__();
    // 按名字找「识图」那一项：面板清单会加东西，下标不能写死。
    const 识图项 = [...导航.children].find((一) => 一.文字().includes('识图'));
    判('导航里找得到「识图」', Boolean(识图项));
    if (识图项) 识图项.点();
    // 等它把两处列完、并且真把工作区那张挑上（`image/列` 一进去就记账了，那一刻挑的还没落）。
    const 挑上了 = await 等到(() => (globalThis.__调过的__() || []).length > 0
      && 身.dataset.画好了 === 'vision'
      && 身.文字().includes('现在这一张'), 15000);
    判('面板自己把工作区里那张挑上了', 挑上了, `正文长度 ${身.文字().length}`);
    const 点得到 = (选) => {
      const 找 = (元) => {
        for (const 孩 of 元.children || []) {
          if (孩.tagName === 'BUTTON' && String(孩.textContent || '').includes(选)) return 孩;
          const 深 = 找(孩);
          if (深) return 深;
        }
        return null;
      };
      return 找(身);
    };
    const 点过 = [];
    const 点出来的 = new Set();
    for (const 名 of ['认图', '读元数据', 'AI 识图']) {
      const 钮 = 点得到(名);
      if (!钮) continue;
      globalThis.__清总账__();
      钮.点();
      await 歇(1200);
      for (const 一 of globalThis.__调过的__()) 点出来的.add(一);
      点过.push(名);
    }
    const 记过 = [...点出来的];
    判(`点过 ${点过.length} 个按钮（${点过.join(' · ')}）`, 点过.length >= 3, `只点到 ${点过.join(' · ')}`);
    // 按下去必须真调到模块（不是弹一句话、也不是名字写错被挡在交付面外）。
    const 该到的 = ['vision/认图', 'vision/读元数据', 'vision/看图'];
    const 没到 = 该到的.filter((一) => !记过.includes(一));
    判(`三个按钮都真调到了模块（${记过.join(' · ')}）`, 没到.length === 0, `这几个没调到：${没到.join(' · ')}`);
    判('点出来的动作名都在交付面上', 记过.every((一) => 有.has(一)), 记过.filter((一) => !有.has(一)).join(' · '));

    // 种的那张用完删掉：自检不留残留。
    if (种 && 种.引用) {
      const 删 = await (await fetch(`${基}/toolbox/调`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 令牌 },
        body: JSON.stringify({ 模块: 'image', 动作: '删', 参数: { 引用: 种.引用 } }),
      })).json();
      判('种的那张图删掉了（不留残留）', Boolean(删 && 删.ok !== false), JSON.stringify(删).slice(0, 120));
    }
  }

  console.log('十、真造一张图，从界面那一路打标（端到端）');
  {
    // 真正走一遍：清空那一格 → 造一张真 PNG → /存图 落进识图工作区 →
    // 列回来确认它在 → 从界面那一层调「认图」→ 看回执里有没有真标签。
    const { 造PNG } = await import('../../../识图模块/test/造图.js');
    const 字节 = 造PNG({ 宽: 64, 高: 64 });
    await fetch(`${基}/toolbox/调`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 令牌 },
      body: JSON.stringify({ 模块: 'image', 动作: '清空', 参数: { 作用域: { 存放地: 'vision' } } }),
    });
    const 存 = await (await fetch(`${基}/存图`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 令牌 },
      body: JSON.stringify({ 作用域: { 存放地: 'vision' }, 字节: Array.from(字节), 文件名: '界面自检.png', mime: 'image/png', 来源: 'upload' }),
    })).json();
    判('造的那张图落进了识图工作区', Boolean(存 && 存.引用), JSON.stringify(存).slice(0, 120));
    if (存 && 存.引用) {
      const 引用 = 存.引用;
      const 列 = await (await fetch(`${基}/toolbox/调`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 令牌 },
        body: JSON.stringify({ 模块: 'image', 动作: '列', 参数: { 作用域: { 存放地: 'vision' } } }),
      })).json();
      判('工作区里看得见它', Array.isArray(列 && 列.条目) && 列.条目.some((一) => 一.标识 === 引用.条目ID),
        `工作区里有 ${(列 && 列.条目 && 列.条目.length) || 0} 条`);
      判('写了这一张之后，工作区仍是单张（清空 + 存这一对没漏）', (列 && 列.条目 && 列.条目.length) === 1,
        `工作区里有 ${(列 && 列.条目 && 列.条目.length) || 0} 条`);

      // 打标那一条直接从界面那一层调（面板的"认图"就是把扁平的引用递进模块）
      const 打 = await (await fetch(`${基}/toolbox/调`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 令牌 },
        body: JSON.stringify({
          模块: 'vision', 动作: '认图',
          参数: { 存放地: 引用.作用域.存放地, 条目ID: 引用.条目ID },
        }),
      })).json();
      const 标签数 = 打 && Array.isArray(打.标签) ? 打.标签.length : -1;
      判(`「认图」真打出了标签（${标签数} 个 · 阈值 ${打 && 打.阈值}）`, 标签数 >= 1, JSON.stringify(打).slice(0, 200));
      if (标签数 >= 1) {
        const 头 = 打.标签[0];
        判('标签带中文名（标签模块那一侧查出来的）', Boolean(头.中文名 || 头.词), JSON.stringify(头).slice(0, 120));
        console.log(`    [实测] 打出：${打.标签.slice(0, 5).map((一) => `${一.词}(${(Number(一.概率) * 100).toFixed(0)}%)`).join(' · ')}`);
      }
      // 读完就删干净，不留残留
      const 删 = await (await fetch(`${基}/toolbox/调`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 令牌 },
        body: JSON.stringify({ 模块: 'image', 动作: '删', 参数: { 引用 } }),
      })).json();
      判('自检造的那张图删掉了（不留残留）', Boolean(删 && 删.ok !== false), JSON.stringify(删).slice(0, 120));
    }
  }

  /** 找第一个 tagName 与话都对得上的元素（深处也算）。 */
  function 找元素(根, tagName, 话) {
    for (const 孩 of 根.children || []) {
      if (孩.tagName === tagName && (!话 || String(孩.textContent || '').includes(话))) return 孩;
      const 深 = 找元素(孩, tagName, 话);
      if (深) return 深;
    }
    return null;
  }

  /** 找第一个带这个类名、且正文里有这段字的元素（比"只认标签+文字"准，不会抓到外层容器）。 */
  function 找带类(根, 类, 话) {
    for (const 孩 of 根.children || []) {
      if (孩.classList.contains(类) && (!话 || String(孩.textContent || '').includes(话))) return 孩;
      const 深 = 找带类(孩, 类, 话);
      if (深) return 深;
    }
    return null;
  }

  /** 从导航点进一块面板，等它真画好。 */
  async function 进面板(名, 上限 = 25000) {
    const 项 = [...导航.children].find((一) => 一.文字().includes(名));
    if (!项) return false;
    if (typeof globalThis.__清总账__ === 'function') globalThis.__清总账__();
    项.点();
    return 等到(() => 身.dataset.画好了 === 目标名(名), 上限);
  }

  /** 导航上那行字 → 面板的 `名`。 */
  function 目标名(名) {
    return { 标签: 'tag', 收藏: 'favs', 标签组: 'groups', 角色库: 'chars', 图片: 'image',
      识图: 'vision', 装订: 'binding', 翻译: 'translate', 世界书: 'worldbook',
      comfyUI: 'comfy', 主: '主AI', 全部动作: '面板' }[名] || 名;
  }

  {
    console.log('十一、标签面板（一个选择器：分类栏 + 卡片墙 + 已选栏）');
    const 找标签项 = [...导航.children].find((一) => 一.文字().includes('标签'));
    if (判('导航里有「标签」这一项', Boolean(找标签项))) {
      if (typeof globalThis.__清总账__ === 'function') globalThis.__清总账__();
      找标签项.点();

      // 点导航到真画上是异步的：先等外壳把面板换成「标签」，再等它把卡片铺出来。
      // 起手那一趟：读分类 → 挖第一页第一类（质量词 / 默认，两条：cg · unity）→ 取回来铺卡片
      const 画好了 = await 等到(() => 身.dataset.画好了 === 'tag' && Boolean(找元素(身, 'DIV', 'cg')), 25000);
      const 字 = 身.文字();
      判('卡片墙铺出来了（真记录名在）', 画好了);
      判('分类项是按钮那一套（点得进去）', Boolean(找元素(身, 'BUTTON', '质量词')));
      判('分类栏读出来了（模块给的页名在）', 字.includes('质量词') && 字.includes('负面提示词'), 字.slice(0, 200));

      const 调过 = typeof globalThis.__调过的__ === 'function' ? globalThis.__调过的__() : [];
      for (const 要的 of ['tag/position.list', 'tag/position.members', 'tag/record.batch']) {
        判(`走了一趟 ${要的}`, 调过.includes(要的), `实际走过：${调过.join(' · ') || '一个都没有'}`);
      }
      判('这一趟调的动作名都在交付面上', 调过.every((一) => 交付面.has(一)),
        调过.filter((一) => !交付面.has(一)).join(' · '));

      // 已选栏：点卡片 → 选中 → 再点 → 取消
      const 卡片 = 找带类(身, '卡片', 'cg');
      if (判('拿到一张卡片拿来点', Boolean(卡片))) {
        卡片.点();
        判('点一张卡片，已选栏跟着说', 身.文字().includes('已选 1 个'),
          (身.文字().match(/已选 \d+ 个|一个都没选/) || [''])[0]);
        卡片.点();
        判('再点一下取消', 身.文字().includes('一个都没选'));
      }

      // 换一路：查库
      const 查库段 = 找元素(身, 'BUTTON', '查库');
      if (判('分段里有「查库」这一路', Boolean(查库段))) {
        if (typeof globalThis.__清总账__ === 'function') globalThis.__清总账__();
        查库段.点();
        const 框 = 找元素(身, 'INPUT');
        if (判('查库那一路给了搜索框', Boolean(框))) {
          框.value = 'miku';
          框.listeners.get('keydown')[0]({ key: 'Enter' });
          const 查出 = await 等到(() => (globalThis.__调过的__() || []).includes('tag/query'), 15000);
          判('按 Enter 真调了 query', 查出, `实际走过：${(globalThis.__调过的__() || []).join(' · ')}`);
          await 等到(() => 身.文字().includes('命中'), 8000);
          判('查库的结果铺成了卡片（带档与命中）', /档 \d+ · /.test(身.文字()), 身.文字().slice(0, 160));
          判('查库这一趟的动作名都在交付面上', (globalThis.__调过的__() || []).every((一) => 交付面.has(一)));
        }
      }

      // 清场：回到「全部」，免得影响后面的面板
      const 全部段 = 找元素(身, 'BUTTON', '全部');
      if (全部段) 全部段.点();
    }
  }
  console.log('十二、收藏 · 标签组 · 角色库（三块新增的面板）');
  {
    // 收藏：模块里一格都没有，所以界面上该是"空"那种如实说法，而不是画崩。
    if (判('进得去「收藏」', await 进面板('收藏'))) {
      const 字 = 身.文字();
      判('收藏栏读了（页或空的说法都在）', 字.includes('收藏栏') && (字.includes('一页都没有') || /页/.test(字)),
        字.slice(0, 160));
      判('建页建类那一段在（分段切得过去）', Boolean(找元素(身, 'BUTTON', '建页建类')));
      判('底栏说清了"一个都没选"', 字.includes('一个都没选'));
      判('收藏这一趟的动作名都在交付面上', (globalThis.__调过的__() || []).every((一) => 交付面.has(一)),
        (globalThis.__调过的__() || []).filter((一) => !交付面.has(一)).join(' · '));
    }

    // 标签组：只画**用户自己建的**组。库里那两种组（角色组 34120 · 系列组 4049）
    // 各有各的去处，所以刚装好时这一块该是空的 —— 空的也要如实说出来。
    if (判('进得去「标签组」', await 进面板('标签组'))) {
      判('三档都在左栏', ['小组', '中组', '大组'].every((一) => 身.文字().includes(一)), 身.文字().slice(0, 200));
      判('报的是"自建组"的数，不是全量组数', /共 \d+ 个自建组/.test(身.文字()), (身.文字().match(/共 \d+ 个自建组[^ ]*/) || [''])[0]);
      判('库里那两种组不计进来（记录 0 个自建组）', /共 0 个自建组/.test(身.文字()), 身.文字().slice(0, 160));
      判('空的时候说清了为什么空', 身.文字().includes('一个自建组都没有'), 身.文字().slice(0, 200));
      判('标签组这一趟的动作名都在交付面上', (globalThis.__调过的__() || []).every((一) => 交付面.has(一)));
    }

    // 角色库：作品是页「角色组」底下的类（一个作品一个类），左栏读类的清单与计数。
    if (判('进得去「角色库」', await 进面板('角色库'))) {
      判('类数与页名报出来了', /页「角色组」\d+ 个类/.test(身.文字()), (身.文字().match(/页「角色组」\d+ 个类/) || [''])[0]);
      判('左栏是按作品分的（"全部角色"那一条在）', 身.文字().includes('全部角色'));
      判('左栏里有真作品名（touhou）', 身.文字().includes('touhou'), 身.文字().slice(0, 200));
      // 点一个作品 → 那一类的角色铺出来（假 DOM 的"点一下"叫 点()）
      const 作品项 = 找元素(身, 'BUTTON', 'touhou');
      if (判('左栏里有「touhou」这一项可以点', Boolean(作品项))) {
        作品项.点();
        await new Promise((r) => setTimeout(r, 600));
        判('点一个作品，卡片铺出来了（真角色名在）', Boolean(找带类(身, '卡片')), `卡片数 ${身.querySelectorAll('.卡片').length}`);
      }
      判('底栏两个复制钮在', Boolean(找元素(身, 'BUTTON', '复制角色词')) && Boolean(找元素(身, 'BUTTON', '复制角色词与特征')));
      判('角色库这一趟的动作名都在交付面上', (globalThis.__调过的__() || []).every((一) => 交付面.has(一)));
    }
  }

  console.log('十三、面板与零件：面板只准用模板里列过的类名');
  {
    // 类名是长相的唯一来源（`页/页.css` 与 `页/组件.css`）。面板里自造一个就等于把长相
    // 拆成九份——写错一个字母在真页面上是"没样式"，画得出、不报错，谁也不会发现。
    // 所以这里走源码级：把每份面板 `造()` 用到的类名捞出来，对那两份文件的类名表核一遍。
    const 页目录 = path.resolve(界面目录, '页');
    const 样式 = ['页.css', '组件.css']
      .map((f) => fs.readFileSync(path.join(页目录, f), 'utf8')).join('\n');
    const 有 = new Set([...样式.matchAll(/\.([^\s.,:>+~()\[\]{}'"#]+)/g)].map((m) => m[1]));
    判('两份样式表里读得出类名表', 有.size > 50, `读到 ${有.size} 个`);

    const 面板名们 = fs.readdirSync(path.join(页目录, '面板')).filter((f) => f.endsWith('.js'));
    const 自造 = [];
    let 查过 = 0;
    for (const f of ['壳.js', '顺手.js', ...面板名们.map((一) => `面板/${一}`)]) {
      const 源 = fs.readFileSync(path.join(页目录, f), 'utf8');
      for (const 类 of 用过的类名(源)) {
        查过 += 1;
        if (!有.has(类)) 自造.push(`${f} 的 .${类}`);
      }
    }
    判(`面板与零件用到的 ${查过} 个类名，都在模板里`, 自造.length === 0,
      自造.length ? `这些没在样式表里：${自造.slice(0, 6).join(' · ')}${自造.length > 6 ? ' …' : ''}` : '');
  }

  服务.close();
   await 歇(200);

  console.log('');
  console.log(`过了 ${过了} 条 · 崩了 ${崩了} 条`);
  if (失败们.length) {
    console.log('失败清单：');
    for (const 一 of 失败们) console.log(`  · ${一}`);
  }
  process.exit(崩了 ? 1 : 0);
}
主().catch((错) => {
  console.error('自检自己炸了：', 错);
  process.exit(1);
});
