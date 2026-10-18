import { 临时项目 } from './会话装置.js';
// 皮（旧版那一层界面）的实测：起真服务 · 开真浏览器 · 点真按钮。
//
// 用法：node 试/皮实测.js [--端口 8791] [--启动]
//
// 它跟 无头.js 是两回事：那一份拿假 DOM 画我们自己的十二块面板，这一份走真
// Chromium（CDP），验的是"旧版这层皮接上我们的模块之后，交互还通不通"。
//
// 判据都落在**数据从哪里来**上：搜出来的候选、点出来的已选、侧栏的计数，
// 必须与直接调 `/toolbox/调` 拿到的对得上，不是"画出来了就算过"。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const 本目录 = path.dirname(fileURLToPath(import.meta.url));
const 界面目录 = path.resolve(本目录, '..');
const 项目根 = path.resolve(界面目录, '..', '..');

/** 找一只 Chromium。 */
function 找浏览器() {
  const 候选 = [
    process.env.PIEL_EDGE,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  for (const 一 of 候选) if (fs.existsSync(一)) return 一;
  throw new Error('找不到 Edge / Chrome；用 PIEL_EDGE 指一个');
}

/** 要一个空端口。 */
function 空端口() {
  return new Promise((成, 败) => {
    const 探 = net.createServer();
    探.once('error', 败);
    探.listen(0, '127.0.0.1', () => {
      const 号 = 探.address().port;
      探.close(() => 成(号));
    });
  });
}

const 歇 = (毫秒) => new Promise((成) => setTimeout(成, 毫秒));

let 过了 = 0;
const 崩了 = [];
function 判(话, 条件, 说明 = '') {
  if (条件) { 过了 += 1; console.log(`  ✓ ${话}${说明 ? `（${说明}）` : ''}`); return true; }
  崩了.push(话 + (说明 ? `（${说明}）` : ''));
  console.log(`  ✗ ${话}${说明 ? `（${说明}）` : ''}`);
  return false;
}

/** 一条 CDP 连接。 */
class 连接 {
  constructor(地址) {
    this.号 = 0;
    this.等着 = new Map();
    this.套 = new WebSocket(地址);
    this.动作请求 = [];
    /** 页面弹 `prompt()` 时装进去的那句话（提示词页「新增提示词组」会问名字）。 */
    this.对话框回话 = '自检提示词组';
  }
  async 开() {
    await new Promise((成, 败) => {
      this.套.addEventListener('open', 成, { once: true });
      this.套.addEventListener('error', 败, { once: true });
    });
    this.套.addEventListener('message', (事) => {
      let 包;
      try { 包 = JSON.parse(事.data); } catch (_) { return; }
      if (包.method === 'Network.requestWillBeSent') {
        try {
          const 请求 = JSON.parse(包.params.request.postData);
          if (请求.模块) this.动作请求.push(请求);
        } catch (_) { /* 静态文件请求没有动作体 */ }
        return;
      }
      /** 原生对话框：CDP 里没人接就会把页面卡在那儿，所以一律当场接下来。 */
      if (包.method === 'Page.javascriptDialogOpening') {
        this.发('Page.handleJavaScriptDialog', { accept: true, promptText: this.对话框回话 }).catch(() => { /* 关掉了就算了 */ });
        return;
      }
      const 等 = this.等着.get(包.id);
      if (!等) return;
      this.等着.delete(包.id);
      if (包.error) 等.败(new Error(包.error.message)); else 等.成(包.result);
    });
    return this;
  }
  发(方法, 参数 = {}) {
    const id = ++this.号;
    return new Promise((成, 败) => {
      this.等着.set(id, { 成, 败 });
      this.套.send(JSON.stringify({ id, method: 方法, params: 参数 }));
    });
  }
  /** 在页面里跑一段表达式，交回它的值。 */
  async 算(式子, { 等承诺 = true } = {}) {
    const 回 = await this.发('Runtime.evaluate', {
      expression: 式子, awaitPromise: 等承诺, returnByValue: true,
    });
    if (回.exceptionDetails) {
      throw new Error(回.exceptionDetails.exception?.description || 回.exceptionDetails.text);
    }
    return 回.result?.value;
  }
  关() { try { this.套.close(); } catch (_) { /* 关不掉就算了 */ } }
}

/** 等一个条件在页面里成立。 */
async function 等到(连, 式子, 毫秒 = 20000) {
  const 止 = Date.now() + 毫秒;
  while (Date.now() < 止) {
    try { if (await 连.算(式子)) return true; } catch (_) { /* 还没准备好 */ }
    await 歇(200);
  }
  return false;
}

/**
 * 一个假服务商，只做这一份自检用：`GET /v1/models` 交四个模型，
 * `POST /v1/chat/completions` 对"带图的请求"分两种回答。
 *
 * 四个模型各覆盖一条判据：
 *   看图声明的模型   → 声明里写了 image：候选上直接带 👁
 *   纯文字声明的模型 → 声明里只有 text：候选上直接带 🚫
 *   没声明的模型     → 声明里什么也没说：探测一次（收下了 → 👁）
 *   拒绝看图的模型   → 带图的请求被 400 打回：探测一次（🚫）
 */
function 起假服务商() {
  const 列 = [
    { id: '看图声明的模型', architecture: { input_modalities: ['text', 'image'] } },
    { id: '纯文字声明的模型', architecture: { input_modalities: ['text'] } },
    { id: '没声明的模型' },
    { id: '拒绝看图的模型' },
  ];
  const 服务 = http.createServer((req, res) => {
    let 体 = '';
    req.on('data', (块) => { 体 += 块; });
    req.on('end', () => {
      const 路 = String(req.url || '').split('?')[0];
      res.setHeader('Content-Type', 'application/json');
      if (路 === '/v1/models') { res.end(JSON.stringify({ object: 'list', data: 列 })); return; }
      if (路 === '/v1/chat/completions') {
        let 解 = {};
        try { 解 = JSON.parse(体 || '{}'); } catch (_) { 解 = {}; }
        const 带图 = JSON.stringify(解.messages || []).includes('image_url');
        if (带图 && 解.model === '拒绝看图的模型') {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { message: 'This model does not support image input' } }));
          return;
        }
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '好' } }] }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: '没有这条路' } }));
    });
  });
  return new Promise((成) => {
    服务.listen(0, '127.0.0.1', () => 成({ 服务, 地址: `http://127.0.0.1:${服务.address().port}/v1` }));
  });
}

async function 主() {
  const 端口 = Number(process.argv[process.argv.indexOf('--端口') + 1]) || 8791;
  const 基 = `http://127.0.0.1:${端口}`;
  /** 链路表住哪：自检自己造一个临时目录，跑完删干净（不碰用户那份存档）。 */
  const 数据目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'piel-api-'));

  console.log('一、起服务（真装配）');
  const { 起, 这次启动的令牌 } = await import('../服务.js');
  const fixture = 临时项目();
  const 服务 = 起({ 端口, 项目根: fixture.root, 数据目录 });
  await new Promise((成) => 服务.once('listening', 成));
  判('服务起来了', 服务.listening === true);
  判('存档落在临时目录里', fs.existsSync(数据目录) && !数据目录.startsWith(项目根), 数据目录);

  const 调试口 = await 空端口();
  const 浏览器 = spawn(找浏览器(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${调试口}`,
    `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'piel-'))}`,
    '--window-size=1600,1000',
    'about:blank',
  ], { stdio: 'ignore' });

  let 连 = null;

  /** 留一张图。长相自检罩不住，只能人看。 */
  async function 留图(名字) {
    const 图 = await 连.发('Page.captureScreenshot', { format: 'png' });
    const 存到 = path.join(path.dirname(项目根), '临时', '截图', 名字);
    fs.mkdirSync(path.dirname(存到), { recursive: true });
    fs.writeFileSync(存到, Buffer.from(图.data, 'base64'));
    return 存到;
  }

  try {
    console.log('二、开真浏览器');
    let 目标 = null;
    for (let i = 0; i < 60 && !目标; i += 1) {
      await 歇(250);
      try {
        const 列 = await (await fetch(`http://127.0.0.1:${调试口}/json/list`)).json();
        目标 = 列.find((一) => 一.type === 'page');
      } catch (_) { /* 还没起来 */ }
    }
    if (!目标) throw new Error('浏览器没起来');
    连 = await new 连接(目标.webSocketDebuggerUrl).开();
    await 连.发('Runtime.enable');
    await 连.发('Page.enable');
    await 连.发('Network.enable');
    判('连上浏览器了', true);

    console.log('三、皮起来了没有');
    await 连.发('Page.navigate', { url: `${基}/` });
    const 令牌到位 = await 等到(连, 'typeof window.__令牌__ === "string" && window.__令牌__.length > 0');
    判('页面拿到令牌了', 令牌到位);
    const 袋子在 = await 等到(连, 'Boolean(window.AppModules && window.AppModules.tags)');
    判('我们的模块袋子挂上了', 袋子在);
    const 起来了 = await 等到(连, 'Boolean(document.querySelector(".cat"))');
    判('侧栏分类画出来了', 起来了);
    await 等到(连, `window.App.catalogStatus() === 'ready'`);
    await 歇(800);
    const 启动请求 = 连.动作请求.filter((一) => 一.模块 === 'tag');
    const 分页请求 = 启动请求.filter((一) => 一.动作 === 'render.pageMap');
    const 首屏 = await 连.算(`({ 分类数: AppModules.tags.stateSnapshot().categories.length, 缓存数: AppModules.记录缓存.size, 角色: AppModules.characters.status(), 耗时: performance.getEntriesByName('catalog-ready')[0]?.startTime })`);
    判('启动按页批量取成员，没有逐类同步请求', 分页请求.length === 首屏.分类数 && !启动请求.some((一) => 一.动作 === 'position.members' && 一.参数?.位置 === '分类'), `${分页请求.length} 次 / ${首屏.分类数} 页`);
    判('首屏只取一屏记录', 启动请求.filter((一) => 一.动作 === 'record.batch').length === 1 && 首屏.缓存数 === 400, `缓存 ${首屏.缓存数} 条 · 就绪 ${Math.round(首屏.耗时)} ms`);
    判('没有打开角色库时不加载角色记录', !首屏.角色.ready && !首屏.角色.loading);
    if (process.argv.includes('--启动')) {
      const 分类对账 = await 连.算(`(async () => {
        const 模 = AppModules;
        const 页们 = await 模.调('tag', 'position.list', { 位置: '分类' });
        const 数 = 模.tags.stateSnapshot().categoryCounts;
        const 类数 = new Map(模.tags.stateSnapshot().categories.map(一 => [一.name, 数[一.id]]));
        const 错 = [];
        let 全部 = 0;
        for (const 页 of 页们) {
          const 归属 = await 模.调('tag', 'render.pageMap', { 页: 页.ID });
          全部 += 归属.length;
          if (类数.get(页.页名) !== 归属.length) 错.push(页.页名);
        }
        return { 错, 全部, 页面全部: 数.all };
      })()`);
      判('批量加载后各分类与全部计数都与模块一致', !分类对账.错.length && 分类对账.全部 === 分类对账.页面全部, `${分类对账.全部} 个落点`);
      await 连.算(`document.querySelector('[data-tag-mode="characters"]')?.click()`);
      判('首次进入角色库完成按需加载', await 等到(连, `AppModules.characters.status().ready === true`));
      判('首次进入后卡片自动显示', await 等到(连, `document.querySelectorAll('#characterList [data-character-id]').length === 50`));
      const 角色分页 = await 连.算(`(() => {
        const 模 = AppModules.characters;
        const 第一页 = 模.page({ offset: 0, limit: 50 });
        const 第二页 = 模.page({ offset: 50, limit: 50 });
        const 第一页ID = new Set(第一页.items.map(一 => 一.id));
        return { 总数: 第一页.total, 作品总数: 模.series().reduce((数, 一) => 数 + 一.count, 0), 翻页数: 第二页.items.length, 重复数: 第二页.items.filter(一 => 第一页ID.has(一.id)).length };
      })()`);
      判('角色总数与作品计数相符，翻页取得另一批记录', 角色分页.总数 === 角色分页.作品总数 && 角色分页.翻页数 === 50 && 角色分页.重复数 === 0, `${角色分页.总数} 个角色`);
      console.log(`启动回归：过了 ${过了} 条 · 崩了 ${崩了.length} 条`);
      process.exitCode = 崩了.length ? 1 : 0;
      return;
    }

    console.log('四、数据是不是从我们模块来的');
    const 总数 = await 连.算(`(() => {
      const 文 = String(document.querySelector('#catCnt')?.textContent || '');
      return (文.match(/(\\d[\\d,]*)/) || ['', ''])[1].replace(/,/g, '');
    })()`);
    判('页面报出了主库条数', /^\d+$/.test(总数) && Number(总数) > 1000, `实际 ${总数}`);

    const 侧栏 = await 连.算(`(() => {
      const 出 = {};
      for (const 钮 of document.querySelectorAll('.cat[data-cat]')) {
        出[钮.dataset.cat] = String(钮.querySelector('.n')?.textContent || '');
      }
      return 出;
    })()`);
    const 分类数 = Object.keys(侧栏).length;
    判('侧栏列了我们的分类页', 分类数 >= 20, `实际 ${分类数} 项`);
    判('「全部标签」有计数', Number(侧栏.all) > 1000, `实际 ${侧栏.all}`);
    判('分类计数不是空壳', Number(侧栏.quality) > 0 || Number(侧栏.series) > 0,
      `质量词 ${侧栏.quality} · 作品系列 ${侧栏.series}`);

    // 分类页的渲染成员数，与侧栏的全部落点数对账。
    const 真值 = await 连.算(`(async () => {
      const 页们 = await window.AppModules.调('tag', 'position.list', {位置:'分类'});
      let 数 = 0;
      for (const 页 of 页们) 数 += (await window.AppModules.调('tag', 'render.pageMap', {页:页.ID})).length;
      return [String(数)];
    })()`);
    判('页面报的条数与模块一致', 真值.map(String).includes(String(总数)),
      `页面 ${总数} · 模块 ${(真值 || []).join(' / ')}`);

    console.log('五、卡片墙是不是真记录');
    const 卡片 = await 连.算(`(() => {
      const 全部 = [...document.querySelectorAll('#content .chip')];
      const 名 = 全部.map(一 => 一.querySelector('.en')?.textContent?.trim()).filter(Boolean);
      return { 数: 全部.length, 头几个: 名.slice(0, 6) };
    })()`);
    判('卡片墙铺出来了', 卡片.数 > 50, `实际 ${卡片.数} 张：${卡片.头几个.join(' · ')}`);

    console.log('六、搜索：真打到 tag/query');
    const 搜 = await 连.算(`(async () => {
      const 框 = document.querySelector('#q');
      if (!框) return { 错: '没有搜索框' };
      框.value = 'miku';
      框.dispatchEvent(new Event('input', { bubbles: true }));
      return { 好: true };
    })()`);
    判('搜索框找得到', 搜?.好 === true, 搜?.错 || '');

    const 搜出 = await 等到(连, `String(document.body.textContent).includes('miku')`, 8000);
    判('搜完页面里有 miku', 搜出);

    const 命中 = await 连.算(`(async () => {
      const 回 = await window.AppModules.调('tag', 'query', { 串: 'miku', 上限: 5 });
      return (回?.候选 || []).map(一 => 一.记录?.名称).filter(Boolean);
    })()`);
    判('我们的 query 能出候选', Array.isArray(命中) && 命中.length > 0, 命中.join(' · '));

    console.log('七、选中：点一张卡片，底下跟着说');
    // 点的是**搜索出来的那批**里的第一张：清掉搜索词会把这张卡片从列表里拿掉，
    // 那样"卡片上的选中态"就无从看起了（列表已经换成默认那一批）。
    const 点了 = await 连.算(`(() => {
      const 卡 = document.querySelector('#content .chip');
      if (!卡) return null;
      const id = String(卡.dataset.en || '');
      卡.click();
      return { id };
    })()`);
    判('找得到一张卡片可点', Boolean(点了 && 点了.id), 点了?.id || '');
    await 歇(800);
    const 选中数 = await 连.算(`(window.AppModules.catalog.selected({ includeAdult: true }) || []).length`);
    判('点了之后选中真的进了服务', Number(选中数) > 0, `实际 ${选中数} 条`);
    const 底栏 = await 连.算(`String(document.querySelector('.bar')?.textContent || '').replace(/\\s+/g,' ').trim()`);
    判('底栏跟着说已选', /已选\s*1/.test(底栏), 底栏.slice(0, 80));

    // 底栏那一条得**看得见是哪个词**：名字、预览、卡片上的选中态，三样都要对得上模块。
    const 底栏条 = await 连.算(`(() => {
      const 条 = document.querySelector('#selbox .schip');
      return {
        条数: document.querySelectorAll('#selbox .schip').length,
        名字: String(条?.querySelector('span')?.textContent || ''),
        预览: String(document.querySelector('#preview')?.textContent || ''),
        选中态: document.querySelectorAll('#chips [data-en].sel').length,
      };
    })()`);
    判('底栏那一条写着词，不是空白也不是 undefined',
      (底栏条?.名字 || '').length > 0 && 底栏条.名字 !== 'undefined', `「${底栏条?.名字}」`);
    const 真身 = await 连.算(`(async () => {
      const 回 = await window.AppModules.调('tag', 'record.get', { 标识: ${JSON.stringify(String(点了?.id || ''))} });
      return { 名: String(回?.名称 || ''), 中: String(回?.中文名 || '').split(/[,，]/)[0] };
    })()`);
    判('底栏那一条写的是模块给的展示名', 底栏条?.名字 === 真身?.中, `页面「${底栏条?.名字}」· 模块「${真身?.中}」`);
    判('底栏的预览拼的是那个词的规范写法', 底栏条?.预览 === 真身?.名, `预览「${底栏条?.预览}」· 模块「${真身?.名}」`);
    判('卡片上认得出选中的是它', Number(底栏条?.选中态) === 1, `带 sel 的卡片 ${底栏条?.选中态} 张`);

    const 拿掉 = await 连.算(`(() => {
      const 叉 = document.querySelector('#selbox [data-selection-key]');
      if (!叉) return null;
      const key = String(叉.dataset.selectionKey || '');
      叉.click();
      return { key };
    })()`);
    判('底栏那一条带着 `<种类>:<标识>` 的键', /^tag:\d+$/.test(拿掉?.key || ''), 拿掉?.key || '（没有 ✕）');
    await 歇(600);
    const 拿掉后 = await 连.算(`({
      条数: document.querySelectorAll('#selbox .schip').length,
      选中数: (window.AppModules.catalog.selected({ includeAdult: true }) || []).length,
    })`);
    判('那颗 ✕ 真把这个词从组合里拿掉了', Number(拿掉后?.选中数) === 0 && Number(拿掉后?.条数) === 0,
      `剩 ${拿掉后?.条数} 条 · 选中 ${拿掉后?.选中数} 个`);

    // 后面几屏要看默认那批卡片，最后把搜索词收掉
    await 连.算(`(() => {
      const 框 = document.querySelector('#q');
      if (框) { 框.value = ''; 框.dispatchEvent(new Event('input', { bubbles: true })); }
      return true;
    })()`);
    await 歇(600);

    console.log('八、翻译那一屏：真打到 translate/本地译');
    const 进翻译 = await 连.算(`(() => {
      const 钮 = document.querySelector('#translateBtn');
      if (!钮) return false;
      钮.click();
      return true;
    })()`);
    判('顶栏有「翻译」那个入口', 进翻译);
    const 翻译屏出来了 = await 等到(连, `Boolean(document.querySelector('#translateView') && !document.querySelector('#translateView').hidden)`, 15000);
    判('翻译那一屏打开了', 翻译屏出来了);

    const 贴了 = await 连.算(`(() => {
      const 框 = document.querySelector('#translateInput');
      if (!框) return false;
      框.value = '1girl, solo, long hair, blue eyes, smile';
      框.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    判('翻译输入框找得到', 贴了);

    const 出译文 = await 等到(连, `String(document.querySelector('#translateOutput')?.value || '').includes('女孩')`, 15000);
    const 译文 = await 连.算(`String(document.querySelector('#translateOutput')?.value || '')`);
    判('本地模型真译出来了', 出译文, 译文);

    // 本地模型的逐格翻译表也应该生成原文↔译文映射，供鼠标悬停高亮。
    const 对照 = await 连.算(`document.querySelectorAll('#translateAlignedOutput .translation-alignment-segment').length`);
    判('本地译文显示逐格对照映射', 对照 > 0, `实际 ${对照} 段`);
    const 悬停对照 = await 连.算(`(() => { const target=document.querySelector('#translateAlignedOutput .translation-alignment-segment[data-source-ids]'); if(!target)return false; target.dispatchEvent(new MouseEvent('mouseenter')); const ids=(target.dataset.sourceIds||'').split(/\\s+/); return target.classList.contains('active') && ids.some(id=>document.querySelector('#translateSourceMirror [data-source-id="'+CSS.escape(id)+'"]')?.classList.contains('active')); })()`);
    判('鼠标悬停译文时原文对应词同步高亮', 悬停对照, true);

    const 词chips = await 连.算(`[...document.querySelectorAll('#translateTags .translate-tag')].map(一 => 一.textContent.trim())`);
    判('「命中的词」那一行出来了', Array.isArray(词chips) && 词chips.length > 0,
      (词chips || []).slice(0, 4).join(' · '));
    const 选中前 = await 连.算(`window.AppModules.tags.selected().map(item => item.en)`);
    await 连.算(`document.querySelector('#translateTags .translate-tag')?.click()`);
    await 等到(连, `window.AppModules.tags.selected().length === ${JSON.stringify((选中前 || []).length + 1)}`);
    const 翻译选中后 = await 连.算(`window.AppModules.tags.selected().map(item => item.en)`);
    判('翻译命中的站内 Tag 能加入底部候选框', 翻译选中后.length === (选中前 || []).length + 1, (翻译选中后 || []).slice(-3).join(' · '));

    // 与模块对账：页面上的译文必须是模块真给的那一句
    const 真译文 = await 连.算(`(async () => {
      const 回 = await window.AppModules.调('translate', '本地译', { 文本: '1girl, solo, long hair, blue eyes, smile' });
      return String(回?.译文 || '');
    })()`);
    判('页面上的译文与模块一致', 译文 === 真译文, `页面「${译文}」· 模块「${真译文}」`);

    console.log('九、图片库与识图：真存一张图进去走一遍');
    // 在页面里画一张真 PNG，交给适配器存进图库（走的是界面自己那条上传路）。
    const 存进去 = await 连.算(`(async () => {
      const 布 = document.createElement('canvas');
      布.width = 96; 布.height = 96;
      const 笔 = 布.getContext('2d');
      笔.fillStyle = '#f0e6d2'; 笔.fillRect(0, 0, 96, 96);
      笔.fillStyle = '#8b4513'; 笔.beginPath(); 笔.arc(48, 48, 28, 0, 7); 笔.fill();
      const 回 = await window.AppModules.imageApp.uploadToGallery({
        dataUrl: 布.toDataURL('image/png'), filename: '实测图.png', mime: 'image/png',
      });
      return { ok: 回 && 回.ok !== false, id: (回 && 回.data && 回.data.imageId) || '', 错: 回 && 回.error && 回.error.message };
    })()`);
    判('真图存进了图库', 存进去?.ok === true, 存进去?.id || 存进去?.错 || '');
    const 图条目 = 存进去?.id || '';

    const 进图库 = await 连.算(`(() => { const 钮 = document.querySelector('#galleryBtn'); if (!钮) return false; 钮.click(); return true; })()`);
    判('顶栏有「图片库」那个入口', 进图库);
    const 图库出来 = await 等到(连, `document.querySelectorAll('#galleryGrid .gallery-card').length > 0`, 15000);
    const 图卡片 = await 连.算(`(() => {
      const 全部 = [...document.querySelectorAll('#galleryGrid .gallery-card')];
      return { 数: 全部.length, 名: 全部.map(一 => 一.querySelector('.gallery-name')?.textContent || ''), 有图: 全部.filter(一 => (一.querySelector('img')?.getAttribute('src') || '').includes('/缩略图')).length };
    })()`);
    判('图片库列出来了', 图库出来 && 图卡片.数 > 0, `${图卡片?.数} 张：${(图卡片?.名 || []).join(' · ')}`);
    判('缩略图走的是 /缩略图 那条 GET', (图卡片?.有图 || 0) > 0, `${图卡片?.有图} 张带图`);

    // 从图库卡片上那个「识图」小钮把图交给识图面板
    const 交给识图 = await 连.算(`(() => {
      const 卡 = document.querySelector('#galleryGrid .gallery-card');
      const 钮 = 卡 && 卡.querySelector('[data-action="vision"]');
      if (!钮) return false;
      钮.click();
      return true;
    })()`);
    判('图库卡片上有「识图」那个钮', 交给识图);
    const 面板开 = await 等到(连, `document.body.classList.contains('vision-open')`, 10000);
    判('识图面板跟着打开了', 面板开);

    const 打标前 = await 连.算(`String(document.querySelector('#tpModes')?.textContent || '').length`);
    const 点了认图 = await 连.算(`(() => { const 钮 = document.querySelector('#tpIdentify'); if (!钮) return false; 钮.click(); return true; })()`);
    判('有「本地识图」那个钮', 点了认图);
    const 打出标签 = await 等到(连, `String(document.querySelector('#tpModes')?.textContent || '').length > ${打标前} + 10`, 60000);
    const 标签文 = await 连.算(`String(document.querySelector('#tpModes')?.textContent || '').replace(/\\s+/g, ' ').trim()`);
    // 出不来时要说清是哪一环断的：当前那张图在不在 · 直调识图服务通不通
    const 诊断 = await 连.算(`(async () => {
      const 现 = window.AppModules.visionTempStore.current();
      let 直 = null; let 错 = '';
      try { 直 = await window.AppModules.assistant.visionService.processOne({ mode: 'local', ref: 现 && 现.ref }); }
      catch (e) { 错 = String((e && e.message) || e); }
      return { 现: (现 && 现.ref && 现.ref.条目ID) || null, 通: Boolean(直 && 直.ok !== false), 标签数: ((直 && 直.data && 直.data.标签) || []).length, 错 };
    })()`);
    判('本地模型真打出了标签', 打出标签,
      `面板文「${标签文.slice(0, 60)}」· 当前图 ${诊断?.现} · 直调 ${诊断?.通 ? '通' : '不通'} · 模块给 ${诊断?.标签数} 个 ${诊断?.错 || ''}`);

    // 与模块对账：面板上那几个词必须是 vision/认图 真给的那几个。
    // 注意识图那一格指的是**图库里的那张**（面板没把它复制到识图区），所以按当前引用去问。
    const 真标签 = await 连.算(`(async () => {
      const 现 = window.AppModules.visionTempStore.current();
      const 域 = (现 && 现.ref && 现.ref.作用域) || {};
      const 回 = await window.AppModules.调('vision', '认图', {
        存放地: 域.存放地 || 'gallery', 条目ID: (现 && 现.ref && 现.ref.条目ID) || '', 阈值: 0.5, 上限: 8,
      });
      return (回?.标签 || []).map(一 => 一.词);
    })()`);
    const 页面上 = (真标签 || []).filter((词) => 标签文.includes(词));
    判('面板上的词与模块给的是一批', 页面上.length > 0, `${页面上.length}/${(真标签 || []).length} 个对得上：${页面上.slice(0, 4).join(' · ')}`);

    // 收摊：这两格都得回到进来时的样子，别在用户盘上留东西。
    const 清干净 = await 连.算(`(async () => {
      const 图库 = await window.AppModules.调('image', '列', { 作用域: { 存放地: 'gallery' } });
      const 识图 = await window.AppModules.调('image', '列', { 作用域: { 存放地: 'vision' } });
      const 全部 = [...((图库 && 图库.条目) || []), ...((识图 && 识图.条目) || [])];
      for (const 一 of 全部) await window.AppModules.调('image', '删', { 引用: 一.引用 });
      const 再看 = await window.AppModules.调('image', '列', { 作用域: { 存放地: 'gallery' } });
      const 再看识图 = await window.AppModules.调('image', '列', { 作用域: { 存放地: 'vision' } });
      return { 删了: 全部.length, 图库剩: (再看 && 再看.总数) || 0, 识图剩: (再看识图 && 再看识图.总数) || 0 };
    })()`);
    判('实测造的那两张图已删净', 清干净?.图库剩 === 0 && 清干净?.识图剩 === 0,
      `删了 ${清干净?.删了} 条 · 图库剩 ${清干净?.图库剩} · 识图剩 ${清干净?.识图剩}`);

    console.log('十、收藏栏：自建一页一类、收两个词进去、看完删掉');
    // 收藏那一格本机是空的，所以这一节自己造数据 —— 跑完删干净。
    const 收藏基线页数 = await 连.算(`window.AppModules.favorites.series().length`);
    const 建好 = await 连.算(`(async () => {
      const 模 = window.AppModules;
      const 页 = await 模.favorites.saveSeries({ name: '实测收藏页' });
      if (!页.ok) return { 错: 页.error && 页.error.message };
      const 类 = await 模.favorites.saveSection({ name: '实测收藏类', seriesId: 页.data.id });
      if (!类.ok) return { 错: 类.error && 类.error.message };
      const 另一类 = await 模.favorites.saveSection({ name: '实测收藏目标类', seriesId: 页.data.id });
      if (!另一类.ok) return { 错: 另一类.error && 另一类.error.message };
      return { 页: 页.data.id, 类: 类.data.id, 另一类: 另一类.data.id };
    })()`);
    判('建得出一页一类', Boolean(建好?.页 && 建好?.类), 建好?.错 || `页 ${建好?.页} · 类 ${建好?.类}`);

    const 收进去 = await 连.算(`(async () => {
      const 模 = window.AppModules;
      const 一 = await 模.catalog.execute({ type: 'favoriteTag', tagId: '1', placement: { page: { id: ${JSON.stringify(建好?.页)} }, group: { id: ${JSON.stringify(建好?.类)} } } });
      const 二 = await 模.catalog.execute({ type: 'favoriteTag', tagId: '2', placement: { page: { id: ${JSON.stringify(建好?.页)} }, group: { id: ${JSON.stringify(建好?.类)} } } });
      return { 一: 一 && 一.ok, 二: 二 && 二.ok, 错: (一 && 一.error && 一.error.message) || (二 && 二.error && 二.error.message) };
    })()`);
    判('两个词收进了收藏', 收进去?.一 === true && 收进去?.二 === true, 收进去?.错 || '');

    const 服务那侧 = await 连.算(`(() => {
      const 模 = window.AppModules;
      const 页们 = 模.favorites.series();
      const 类们 = 模.favorites.sections(${JSON.stringify(建好?.页)});
      const 列 = 模.favorites.list({ seriesId: ${JSON.stringify(建好?.页)}, offset: 0, limit: 50 });
      const 一 = 模.favorites.getEntry('1');
      return {
        页数: 页们.length, 页名: 页们.map(一 => 一.name), 类名: 类们.map(一 => 一.name),
        条数: 列.items.length, 文本: 列.items.map(一 => 一.rawText),
        首条: 一 && { raw: 一.rawText, zh: 一.zh, 页: 一.seriesName, 类: 一.sectionName },
      };
    })()`);
    判('收藏服务交得出页 / 类 / 条目', 服务那侧?.条数 === 2,
      `${服务那侧?.页名} / ${服务那侧?.类名} · ${(服务那侧?.文本 || []).join(' · ')}`);
    判('条目带上了落点', 服务那侧?.首条?.页 === '实测收藏页' && 服务那侧?.首条?.类 === '实测收藏类',
      JSON.stringify(服务那侧?.首条));

    const 进收藏 = await 连.算(`(() => { const 钮 = document.querySelector('#favBtn'); if (!钮) return false; 钮.click(); return true; })()`);
    判('顶栏有「快捷收藏」那个入口', 进收藏);
    const 实测页按钮出现 = await 等到(连, `Boolean(document.querySelector('[data-favorite-action="select-series"][data-series-id="${建好?.页}"]'))`);
    const 选中实测页 = await 连.算(`(() => { const button=document.querySelector('[data-favorite-action="select-series"][data-series-id="${建好?.页}"]'); if(!button)return false; button.click(); return true; })()`);
    const 收藏屏出来 = await 等到(连, `Boolean(document.querySelector('[data-favorite-series="${建好?.页}"] [data-favorite-entry="1"]'))`, 15000);
    const 收藏屏文 = await 连.算(`String(document.querySelector('#favoritesView')?.textContent || '').replace(/\\s+/g, ' ').trim()`);
    判('收藏栏画出了我们那一页', 收藏屏出来 && 收藏屏文.includes('实测收藏页'), 收藏屏文.slice(0, 100));
    判('收藏栏里看得见收进去的词', 实测页按钮出现 && 选中实测页 && 收藏屏出来 && (收藏屏文.includes('cg') || 收藏屏文.includes('unity')), 收藏屏文.slice(0, 140));
    const favoriteEditor = await 连.算(`(() => { document.querySelector('#favoritesView [data-favorite-edit]')?.click(); const dialog=document.querySelector('[data-tag-save]')?.closest('[role="dialog"]'); const placement=dialog?.querySelector('.tag-editor-section--placement')?.textContent || ''; return Boolean(dialog && dialog.querySelector('[data-tag-location]') && dialog.querySelector('[data-tag-delete]')?.hidden && dialog.querySelector('[data-tag-restore]')?.hidden && dialog.querySelector('.tag-editor-section--identity')?.hidden && dialog.querySelector('.tag-editor-section--metadata')?.hidden && placement.includes('收藏位置')); })()`);
    判('收藏编辑器只显示收藏位置与保存/关闭', favoriteEditor);
    const 收藏原位置 = await 连.算(`window.AppModules.调('tag','position.whereIs',{位置:'收藏',成员:'1'})`);
    const 主页原位置 = await 连.算(`window.AppModules.调('tag','position.whereIs',{位置:'分类',成员:'1'})`);
    const 收藏移动目标 = await 连.算(`(() => { document.querySelector('[data-tag-location]')?.click(); const page=document.querySelector('[data-location-parent]'); const group=document.querySelector('[data-location-child]'); return { page: page?.value, groups:[...(group?.options||[])].map(option=>({id:option.value,name:option.textContent})) }; })()`);
    const 目标类 = String(建好?.另一类);
    const 选择目标 = await 连.算(`(() => { const group=document.querySelector('[data-location-child]'); if(!group||![...group.options].some(option=>option.value==='${目标类}'))return false; group.value='${目标类}'; group.dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('[data-location-confirm]')?.click(); return true; })()`);
    const 位置弹窗已关 = await 等到(连, `document.querySelector('[data-tag-location-overlay]')?.hidden === true`);
    await 连.算(`document.querySelector('[data-tag-save]')?.click()`);
    const 收藏位置已保存 = await 等到(连, `document.querySelector('[data-tag-editor-overlay]')?.hidden === true`);
    const 收藏新位置 = await 连.算(`window.AppModules.调('tag','position.whereIs',{位置:'收藏',成员:'1'})`);
    const 主页仍原位 = await 连.算(`window.AppModules.调('tag','position.whereIs',{位置:'分类',成员:'1'})`);
    const movedOnlySource = Array.isArray(收藏原位置) && Array.isArray(收藏新位置)
      && 收藏原位置.some(row => String(row.类) === String(建好?.类))
      && 收藏新位置.some(row => String(row.类) === 目标类)
      && !收藏新位置.some(row => String(row.类) === String(建好?.类))
      && JSON.stringify(主页原位置) === JSON.stringify(主页仍原位);
    判('收藏编辑改到所选页类，原收藏与主页分类状态如约变化', Boolean(选择目标 && 位置弹窗已关 && 收藏位置已保存 && movedOnlySource), `原页类 ${JSON.stringify(收藏原位置)} · 新页类 ${JSON.stringify(收藏新位置)} · 页面 ${收藏移动目标?.page}`);
    await 连.算(`document.querySelector('[data-tag-close]')?.click()`);
    await 留图('皮-收藏栏.png');

    // 收摊：先取消收藏，再删页
    const 收摊 = await 连.算(`(async () => {
      const 模 = window.AppModules;
      const 落 = (模.favorites.getEntry('1')?.favoriteLocations) || [];
      const 摘 = await 模.catalog.execute({ type: 'unfavorite', membershipIds: 落 });
      const 删 = await 模.favorites.deleteSeries(${JSON.stringify(建好?.页)});
      return { 摘: 摘 && 摘.ok, 删: 删 && 删.ok, 剩: 模.favorites.series().length, 基线: ${收藏基线页数}, 有测试页: 模.favorites.series().some(row => row.id === ${JSON.stringify(建好?.页)}), 测试页成员: 模.favorites.list({ seriesId: ${JSON.stringify(建好?.页)}, offset: 0, limit: 50 }).items.length };
    })()`);
    判('实测造的收藏页已删净', 收摊?.删 === true && !收摊?.有测试页 && 收摊?.剩 === 收藏基线页数 && 收摊?.测试页成员 === 0,
      `取消收藏 ${收摊?.摘} · 删页 ${收摊?.删} · 页 ${收摊?.剩}/${收摊?.基线} · 测试页残留 ${收摊?.测试页成员}`);

    console.log('十一、标签主页：星标、编辑与隐藏恢复');
    await 连.算(`document.querySelector('#favBtn')?.click()`);
    await 等到(连, `document.querySelector('#tagLibraryView') && !document.querySelector('#tagLibraryView').hidden`);
    await 连.算(`(() => { const q=document.querySelector('#q'); q.value='cg'; q.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    const 星钮预先出现 = await 等到(连, `Boolean(document.querySelector('[data-tag-favorite="1"]'))`);
    const 之前的位置 = await 连.算(`window.AppModules.catalog.getTag('1')?.favoriteLocations || []`);
    if (之前的位置.length) {
      await 连.算(`(async () => window.AppModules.catalog.execute({ type: 'unfavorite', membershipIds: ${JSON.stringify(之前的位置)} }))()`);
      await 等到(连, `(() => { const b=document.querySelector('[data-tag-favorite="1"]'); return Boolean(b && b.getAttribute('aria-pressed')==='false'); })()`);
    }
    const 星标收藏 = await 连.算(`(async () => {
      const 模 = window.AppModules;
      const 现有 = 模.catalog.getTag('1')?.favoriteLocations || [];
      if (现有.length) return { ok: true, already: true };
      let 页 = 模.favorites.series()[0];
      if (!页) { const made = await 模.favorites.saveSeries({ name: '星标实测页' }); if (!made.ok) return { ok: false }; 页 = made.data; }
      let 类 = 模.favorites.sections(页.id)[0];
      if (!类) { const made = await 模.favorites.saveSection({ name: '星标实测类', seriesId: 页.id }); if (!made.ok) return { ok: false }; 类 = made.data; }
      const result = await 模.catalog.execute({ type: 'favoriteTag', tagId: '1', placement: { page: { id: 页.id }, group: { id: 类.id } } });
      return { ok: result.ok, pageId: 页.id, groupId: 类.id, already: false };
    })()`);
    const 即时高亮等到 = await 等到(连, `(() => { const b=document.querySelector('[data-tag-favorite="1"]'); return Boolean(b?.classList.contains('is-favorite') && b.getAttribute('aria-pressed')==='true'); })()`);
    const 即时星标 = await 连.算(`(() => { const b=document.querySelector('[data-tag-favorite="1"]'); return Boolean(b?.classList.contains('is-favorite') && b.getAttribute('aria-pressed')==='true'); })()`);
    判('收藏后主页星标立即高亮', 星标收藏?.ok && 星钮预先出现 && 即时高亮等到 && 即时星标, `收藏成功=${星标收藏?.ok}, 预先按钮=${星钮预先出现}, 高亮=${即时星标}`);
    await 连.发('Page.navigate', { url: `${基}/` });
    await 等到(连, `Boolean(window.AppModules && document.querySelector('#q'))`);
    await 等到(连, `window.App.catalogStatus() === 'ready'`);
    await 歇(300);
    await 连.算(`(() => { const q=document.querySelector('#q'); q.value='cg'; q.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await 等到(连, `Boolean(document.querySelector('[data-tag-favorite="1"]'))`);
    const 重载星标 = await 连.算(`(() => { const b=document.querySelector('[data-tag-favorite="1"]'); return Boolean(b?.classList.contains('is-favorite') && b.getAttribute('aria-pressed')==='true'); })()`);
    判('重载后主页星标仍高亮', 重载星标);

    await 连.算(`document.querySelector('[data-tag-edit="1"]')?.click()`);
    const 主页编辑器 = await 连.算(`(() => { const save=document.querySelector('[data-tag-save]'); const dialog=save?.closest('[role="dialog"]'); const placement=dialog?.querySelector('.tag-editor-section--placement')?.textContent || ''; return Boolean(dialog && !dialog.querySelector('.tag-editor-section--identity')?.hidden && !dialog.querySelector('[data-tag-field="content"]')?.closest('[hidden]') && dialog.querySelector('[data-tag-field="note"]') && !dialog.querySelector('[data-tag-location]')?.hidden && !dialog.querySelector('[data-tag-delete]')?.hidden && dialog.querySelector('[data-tag-delete]')?.title.includes('隐藏') && placement.includes('主页位置')); })()`);
    判('主页编辑器显示内容、注释、主页位置与隐藏操作', 主页编辑器);
    await 连.算(`(() => { const note=document.querySelector('[data-tag-field="note"]'); note.value='主页编辑保留的注释'; note.dispatchEvent(new Event('input',{bubbles:true})); const zh=document.querySelector('[data-tag-field="displayName"]'); zh.value='实测中文名,保留中文别名'; zh.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('[data-tag-save]')?.click(); })()`);
    const 主页保存 = await 等到(连, `document.querySelector('[data-tag-editor-overlay]')?.hidden === true`);
    const 注释保存 = await 连.算(`window.AppModules.调('tag','note.get',{标识:'1'})`);
    const 编辑后记录 = await 连.算(`window.AppModules.调('tag','record.get',{标识:'1'})`);
    判('主页编辑保存中文别名与注释后保留英文名称', 主页保存 && 注释保存 === '主页编辑保留的注释' && 编辑后记录?.名称 === 'cg' && 编辑后记录?.中文名 === '实测中文名,保留中文别名');

    await 连.算(`document.querySelector('[data-tag-edit="1"]')?.click()`);
    await 连.算(`document.querySelector('[data-tag-delete]')?.click()`);
    await 连.算(`document.querySelector('[data-tag-delete-confirm]')?.click()`);
    const 已隐藏 = await 等到(连, `window.AppModules.调('tag','hidden.list',{}).then(rows => rows.some(row => String(row.ID)==='1'))`);
    await 连.算(`document.querySelector('[data-hidden-tags-toggle]')?.click()`);
    const 恢复钮出现 = await 等到(连, `Boolean(document.querySelector('[data-hidden-tag-restore="1"]'))`);
    判('主页隐藏确认后已隐藏列表显示恢复按钮', 已隐藏 && 恢复钮出现);
    await 连.算(`document.querySelector('[data-hidden-tag-restore="1"]')?.click()`);
    const 已恢复 = await 等到(连, `window.AppModules.调('tag','hidden.list',{}).then(rows => !rows.some(row => String(row.ID)==='1'))`);
    await 连.算(`document.querySelector('[data-hidden-tags-toggle]')?.click()`);
    await 连.算(`(() => { const q=document.querySelector('#q'); q.value='cg'; q.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    const 主页重现 = await 等到(连, `Boolean(document.querySelector('[data-tag-edit="1"]'))`);
    判('恢复后标签回到主页查询结果', 已恢复 && 主页重现);
    if (星标收藏?.ok && !星标收藏.already) {
      const 取消实测星标 = await 连.算(`(async () => window.AppModules.catalog.execute({ type: 'unfavorite', membershipIds: [{ pageId: ${JSON.stringify(星标收藏.pageId)}, groupId: ${JSON.stringify(星标收藏.groupId)}, membershipId: '1' }] }))()`);
      const 不再星标等到 = await 等到(连, `(() => { const b=document.querySelector('[data-tag-favorite="1"]'); return Boolean(b && !b.classList.contains('is-favorite') && b.getAttribute('aria-pressed')==='false'); })()`);
      const 不再星标 = await 连.算(`(() => { const b=document.querySelector('[data-tag-favorite="1"]'); return Boolean(b && !b.classList.contains('is-favorite') && b.getAttribute('aria-pressed')==='false'); })()`);
      判('取消收藏后主页星标熄灭', 取消实测星标?.ok && 不再星标等到 && 不再星标, `取消成功=${取消实测星标?.ok}, 熄灭=${不再星标}`);
    }

    console.log('十二、角色库 · 标签组：进入角色库时加载记录');
    await 连.算(`document.querySelector('[data-tag-mode="characters"]')?.click()`);
    const 组好了 = await 等到(连, `window.AppModules.characters.status().ready === true`, 90000);
    判('首次进入角色库后自动画出卡片', await 等到(连, `document.querySelectorAll('#characterList [data-character-id]').length > 0`));
    const 组账 = await 连.算(`(() => {
      const 模 = window.AppModules;
      const 作 = 模.characters.series();
      return { 状态: 模.characters.status(), 角色数: 模.characters.count(), 作品数: 作.length, 头几个作品: 作.slice(0, 5).map(一 => 一.name + '(' + 一.count + ')'), 自建组数: 模.tags.listGroups().length };
    })()`);
    判('后台把组表拉下来了', 组好了 && 组账?.状态?.ready === true, `状态 ${JSON.stringify(组账?.状态)}`);
    判('角色库里是角色组（34115 上下）', 组账?.角色数 > 30000,
      `实际 ${组账?.角色数} 个角色 · ${组账?.作品数} 个作品`);
    判('作品数是页「角色组」底下的类（4049 + 未分类）', 组账?.作品数 > 3000, `实际 ${组账?.作品数} 个作品`);
    判('按作品分得出档', (组账?.头几个作品 || []).length > 0, (组账?.头几个作品 || []).join(' · '));

    // 一个认得出的角色对得上作品：初音未来属于 vocaloid
    const 米库 = await 连.算(`(async () => {
      const 模 = window.AppModules;
      const 回 = await 模.调('tag', 'query', { 串: 'hatsune_miku', 上限: 3 });
      const 记 = (回?.候选 || []).map(一 => 一.记录).find(一 => 一 && String(一.名称).split(',')[0] === 'hatsune_miku');
      if (!记) return null;
      const 文 = 模.characters.get(String(记.ID));
      return { id: String(记.ID), 名: 记.名称, 作品: 文 && 文.seriesName, 特征: 文 ? 文.generalTags.length : -1 };
    })()`);
    判('找得到 hatsune_miku 这个角色', Boolean(米库?.id), `${米库?.名 || ''}（ID ${米库?.id || '-'}）`);
    判('它的作品是 vocaloid（由页「角色组」的类读出来）', 米库?.作品 === 'vocaloid', `作品「${米库?.作品}」`);
    判('它的详情带得出特征词', Number(米库?.特征) > 0, `${米库?.特征} 个特征`);

    const 一页 = await 连.算(`(() => {
      const 作 = window.AppModules.characters.series().find(一 => 一.id !== '（没写作品）');
      const 页 = window.AppModules.characters.page({ seriesId: 作 ? 作.id : '', offset: 0, limit: 12 });
      const 一 = 页.items[0] && window.AppModules.characters.get(页.items[0].id);
      return { 作品: 作 && 作.name, 条数: 页.items.length, 合计: 页.total, 头几个: 页.items.slice(0, 4).map(x => x.name), 首条特征数: 一 ? 一.generalTags.length : -1, 首条作品: 一 && 一.seriesName };
    })()`);
    判('按作品分页取得到角色', 一页?.条数 > 0, `${一页?.作品}：${(一页?.头几个 || []).join(' · ')}（共 ${一页?.合计}）`);
    判('角色卡片上的作品名就是挑的那个作品', 一页?.首条作品 === 一页?.作品, `卡片写「${一页?.首条作品}」· 左栏挑的是「${一页?.作品}」`);
    判('角色的详情带得出特征词', 一页?.首条特征数 >= 0, `${一页?.首条特征数} 个特征 · 作品 ${一页?.首条作品}`);

    // 标签组那一栏：库里那两种组不该混进来，所以刚装好时它是空的
    判('标签组里没有库里那些组（自建组 0 个）', 组账?.自建组数 === 0, `实际 ${组账?.自建组数} 个自建组`);
    const 进标签组 = await 连.算(`(() => {
      const 钮 = [...document.querySelectorAll('[data-tag-mode]')].find(一 => 一.dataset.tagMode === 'groups');
      if (!钮) return false;
      钮.click();
      return true;
    })()`);
    判('顶上有「标签组」那个入口', 进标签组);
    const 标签组屏 = await 等到(连, `String(document.querySelector('#tagLibraryView')?.textContent || '').includes('标签组')`, 15000);
    判('标签组那一屏画出来了', 标签组屏);
    const 标签组文 = await 连.算(`String(document.querySelector('#tagLibraryView')?.textContent || '').replace(/\\s+/g, ' ').trim()`);
    判('屏幕上如实说"没有标签组"，而不是铺一屏库里的组', /没有标签组|0 个标签组/.test(标签组文), 标签组文.slice(0, 120));
    const 回标签 = await 连.算(`(() => {
      const 钮 = [...document.querySelectorAll('[data-tag-mode]')].find(一 => 一.dataset.tagMode === 'tags');
      if (!钮) return false;
      钮.click();
      return true;
    })()`);
    判('切得回「标签」那一栏', 回标签);

    // 角色库那块屏：顶上那排 mode 页签里的「角色库」（`data-tag-mode="characters"`），
    // 点它之后 `#charactersView` 才显示出来（旧版那一层皮里它就是一个页签）。
    const 进角色库 = await 连.算(`(() => {
      const 钮 = document.querySelector('[data-tag-mode="characters"]') || document.querySelector('.character-library-entry');
      if (!钮) return false;
      钮.click();
      return true;
    })()`);
    判('侧栏有「角色库」那个入口', 进角色库);
    const 角色屏出来 = await 等到(连, `Boolean(document.querySelector('#charactersView') && document.querySelector('#charactersView').style.display !== 'none' && String(document.querySelector('#charactersView').textContent).trim().length > 20)`, 20000);
    const 角色屏文 = await 连.算(`String(document.querySelector('#charactersView')?.textContent || '').replace(/\\s+/g, ' ').trim()`);
    判('角色库整屏画出来了', 角色屏出来, 角色屏文.slice(0, 110));
    const 打开角色详情 = await 连.算(`(() => { const row=[...document.querySelectorAll('#characterList .character-row')].find(item=>{ const record=AppModules.characters.get(item.dataset.characterId); return record?.generalTags?.length; }); if(!row)return null; row.click(); return {id:row.dataset.characterId, traits:document.querySelectorAll('#characterDetail input[data-tag-id]').length, checked:[...document.querySelectorAll('#characterDetail input[data-tag-id]')].every(input=>input.checked), buttons:[...document.querySelectorAll('#characterDetail .character-actions [data-character-copy]')].map(button=>button.textContent.trim())}; })()`);
    判('角色详情特征默认全选且底部只有两种复制按钮', Boolean(打开角色详情?.id) && 打开角色详情.checked && JSON.stringify(打开角色详情.buttons) === JSON.stringify(['仅复制角色名','复制角色与所选词']), JSON.stringify(打开角色详情));
    await 连.算(`(() => { window.clipboardWrites=[]; Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.clipboardWrites.push(String(value));}}}); const input=document.querySelector('#characterDetail input[data-tag-id]'); window.__deselectedTrait=AppModules.tags.get(input.dataset.tagId)?.en || input.dataset.tagId; if(input)input.checked=false; document.querySelector('#characterSeries')?.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    const 角色刷新保留勾选 = await 连.算(`(() => { const inputs=[...document.querySelectorAll('#characterDetail input[data-tag-id]')]; return {deselected:inputs.some(input=>!input.checked), selected:inputs.filter(input=>input.checked).length}; })()`);
    判('角色详情刷新保留用户取消的特征', Boolean(角色刷新保留勾选?.deselected), JSON.stringify(角色刷新保留勾选));
    await 连.算(`document.querySelector('#characterDetail [data-character-copy="identity"]')?.click()`);
    await 等到(连, `clipboardWrites.length===1`);
    const 仅角色复制 = await 连.算(`clipboardWrites[0]`);
    const 预期角色名 = await 连.算(`AppModules.characters.get(${JSON.stringify(打开角色详情.id)}).name.split(/[,，]/)[0].trim()`);
    判('仅复制角色名写入系统剪贴板', 仅角色复制 === 预期角色名, 仅角色复制);
    await 连.算(`document.querySelector('#characterDetail [data-character-copy="features"]')?.click()`);
    await 等到(连, `clipboardWrites.length===2`);
    const 角色与所选词复制 = await 连.算(`clipboardWrites[1]`);
    const 取消的特征词 = await 连.算(`window.__deselectedTrait`);
    判('角色与所选词写入剪贴板且排除已取消词', 角色与所选词复制.startsWith(预期角色名) && !角色与所选词复制.split(',').map(value => value.trim()).includes(取消的特征词), 角色与所选词复制);
    const 屏上有作品 = await 连.算(`(() => {
      const 作 = window.AppModules.characters.series().filter(一 => 一.id !== '（没写作品）').slice(0, 5).map(一 => 一.name);
      const 文 = String(document.querySelector('#charactersView')?.textContent || '');
      return 作.filter(名 => 文.includes(名));
    })()`);
    判('屏幕上看得见我们的作品名', (屏上有作品 || []).length > 0, (屏上有作品 || []).slice(0, 4).join(' · '));
    await 留图('皮-角色库.png');

    console.log('十二、comfyUI：真探活 + 那一屏画出来');
    // 本机那台 ComfyUI 是可选件：没起的话，"探活不通"本身就是对的表现，
    // 所以先问一次，通了才判版本设备那两条。
    const comfy在 = await new Promise((成) => {
      const 探 = http.get('http://127.0.0.1:8188/system_stats', (答) => { 答.resume(); 成(答.statusCode === 200); });
      探.on('error', () => 成(false));
      探.setTimeout(2500, () => { 探.destroy(); 成(false); });
    });
    const 探活 = await 连.算(`(async () => {
      const 模 = window.AppModules;
      const 通 = await 模.comfy.check();
      const 状 = await 模.comfy.status();
      const 页 = await 模.comfy.bridgeStatus();
      const 会 = 模.comfy.getSession();
      return { 通, 版本: 状 && 状.version, 设备: String(状 && 状.device || '').split(':')[0], 页数: (页 && 页.pages || []).length, runMode: 会 && 会.current && 会.current.runMode, revision: 会 && 会.revision };
    })()`);
    判(comfy在 ? 'comfy 探活真打通了' : '本机那台 ComfyUI 没起，探活如实说不通', 探活?.通 === comfy在,
      `本机 8188 ${comfy在 ? '在听' : '没在听'} · 模块说 ${探活?.通 ? '通' : '不通'} · ${探活?.版本 || ''}`);
    判('会话说得出工作流档', 探活?.runMode === 'legacy', `runMode=${探活?.runMode} revision=${探活?.revision}`);
    判('桥接扩展没装就如实交空页表', 探活?.页数 === 0, `${探活?.页数} 页`);

    const 进AI = await 连.算(`(() => { const 钮 = document.querySelector('#aiBtn'); if (!钮) return false; 钮.click(); return true; })()`);
    判('顶栏有「AI 助手」那个入口', 进AI);
    await 等到(连, `Boolean(document.querySelector('.ai-module-tab[data-panel="comfy"]'))`, 15000);
    const 切tab = await 连.算(`(() => {
      const 钮 = document.querySelector('.ai-module-tab[data-panel="comfy"]');
      if (!钮) return false;
      钮.click();
      return true;
    })()`);
    判('切得到 comfyUI 那个 tab', 切tab);
    const comfy屏 = await 等到(连, `(() => {
      const 盒 = document.querySelector('#tabComfy');
      return Boolean(盒 && 盒.style.display !== 'none' && String(盒.textContent).trim().length > 30);
    })()`, 20000);
    await 等到(连, `!String(document.querySelector('#comfyConfigStatus')?.textContent || '').includes('检查中')`, 20000);
    const comfy屏文 = await 连.算(`String(document.querySelector('#tabComfy')?.textContent || '').replace(/\\s+/g, ' ').trim()`);
    判('comfyUI 那一屏画出来了', comfy屏, comfy屏文.slice(0, 130));
    if (comfy在) 判('屏幕上说得出 ComfyUI 的版本设备', /0\.3\d|NVIDIA|RTX|cuda/i.test(comfy屏文), comfy屏文.slice(0, 200));
    else 判('ComfyUI 没起时那一屏如实说不通', /未连接|连接不上|不通/.test(comfy屏文), comfy屏文.slice(0, 160));

    // 出图入口返回模块的绘图开关状态。
    const 出图那条路 = await 连.算(`(async () => {
      const 回 = await window.AppModules.comfy.runCurrent();
      return { ok: 回 && 回.ok, 码: (回 && 回.error && 回.error.code) || '', 话: (回 && 回.error && 回.error.message) || '' };
    })()`);
    判('「运行工作流」遵守模块绘图开关', 出图那条路?.码 === 'COMFY_DISABLED',
      `${出图那条路?.码} · ${出图那条路?.话}`);
    const 钮在 = await 连.算(`(() => { const 钮 = document.querySelector('#comfyRunCurrent'); return Boolean(钮) && 钮.disabled === false; })()`);
    判('屏幕上那个「运行工作流」钮是活的', 钮在);
    await 留图('皮-comfyUI.png');

    console.log('十三、API 页：链路表 · 服务商给的模型清单 · 视觉能力');
    const 假服务商 = await 起假服务商();
  const 链路文件 = path.join(数据目录, 'API', '链路.json');
    const 读存档 = () => JSON.parse(fs.readFileSync(链路文件, 'utf8')).链路 || [];
    /** 往那一行的一格填值，并让页面按"改完了"处理。 */
    const 填格 = (字段, 值) => 连.算(`(() => {
      const 格 = document.querySelector('#linkList [data-link-row] [data-link-field="${字段}"]');
      if (!格) return null;
      格.value = ${JSON.stringify(值)};
      格.dispatchEvent(new Event('change', { bubbles: true }));
      return 格.value;
    })()`);
    const 读格 = (字段) => 连.算(`document.querySelector('#linkList [data-link-row] [data-link-field="${字段}"]')?.value ?? null`);
    const 徽标 = () => 连.算(`document.querySelector('#linkList [data-link-row] [data-link-field="badge"]')?.textContent || ''`);
    /** 候选那一块：摊开没有、有哪几条、每条前头是什么标记。 */
    const 候选 = () => 连.算(`(() => {
      const 盒 = document.querySelector('#linkList [data-link-field="modelList"]');
      return { 摊开: Boolean(盒 && !盒.hidden),
        行: [...document.querySelectorAll('#linkList .link-model-item')].map(一 => ({
          名: 一.dataset.model, 标: 一.querySelector('.mark')?.textContent || '',
        })) };
    })()`);
    /** 真点一个元素：先滚进视野、确认那个点真落在这个元素上（候选的摊开/收起挂在鼠标与焦点上）。 */
    const 点 = async (选法) => {
      const 盒 = await 连.算(`(() => {
        const n = document.querySelector(${JSON.stringify(选法)});
        if (!n) return null;
        n.scrollIntoView({ block: 'center' });
        const r = n.getBoundingClientRect();
        const x = Math.round(r.left + Math.min(24, Math.max(6, r.width / 2)));
        const y = Math.round(r.top + r.height / 2);
        const 心 = document.elementFromPoint(x, y);
        return { x, y, 命中: Boolean(心) && (心 === n || n.contains(心)) };
      })()`);
      if (!盒) return false;
      if (!盒.命中) {
        /** 被别的面板盖着（或滚不进视野）：退回合成事件，走的还是同一条委托链。 */
        await 连.算(`(() => {
          const n = document.querySelector(${JSON.stringify(选法)});
          if (!n) return false;
          for (const 名 of ['mousedown', 'mouseup', 'click']) n.dispatchEvent(new MouseEvent(名, { bubbles: true }));
          return true;
        })()`);
        await 歇(400);
        return true;
      }
      await 连.发('Input.dispatchMouseEvent', { type: 'mousePressed', x: 盒.x, y: 盒.y, button: 'left', clickCount: 1 });
      await 连.发('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 盒.x, y: 盒.y, button: 'left', clickCount: 1 });
      await 歇(400);
      return true;
    };
    try {
      await 连.算(`document.querySelector('#aiBtn')?.click()`);
      await 等到(连, `Boolean(document.querySelector('.ai-module-tab[data-panel="api"]'))`, 15000);
      await 连.算(`document.querySelector('.ai-module-tab[data-panel="api"]')?.click()`);
      const API页在 = await 等到(连, `(() => { const 盒 = document.querySelector('#tabApi'); return Boolean(盒 && 盒.style.display !== 'none' && 盒.textContent.length > 30); })()`, 15000);
      判('API 配置页画出来了', API页在);
      const 起手 = await 连.算(`document.querySelector('#linkList')?.textContent || ''`);
      判('起手是「还没有链路」（临时存档是空的）', /还没有链路/.test(起手), 起手.trim().slice(0, 50));
      判('空配置状态明确显示为零条 API 配置', /已读取 0 条 API 配置/.test(String(await 连.算(`document.querySelector('#linkStatus')?.textContent || ''`))));

      await 连.算(`document.querySelector('#linkAdd')?.click()`);
      判('「＋ 添加链路」真加出了一行', await 等到(连, `Boolean(document.querySelector('#linkList [data-link-row]'))`, 10000));
      判('加出来的那一行真写进了存档', 读存档().length === 1, `${读存档().length} 条`);

      console.log('  · 填地址 → 现去服务商那边取模型清单');
      await 填格('base', 假服务商.地址);
      const 清单回来 = await 等到(连, `document.querySelectorAll('#linkList .link-model-item').length > 0`, 15000);
      const 候选1 = await 候选();
      判('填完地址就把服务商给的清单取回来了', 清单回来 && 候选1.行.length === 4, 候选1.行.map((一) => 一.名).join(' · '));
      判('清单取回来但先收着（点才摊开）', 候选1.摊开 === false);
      判('候选里只有这家真的提供的模型', 候选1.行.map((一) => 一.名).join(',') === '看图声明的模型,纯文字声明的模型,没声明的模型,拒绝看图的模型');
      判('候选上带着服务商自己声明的图片能力',
        候选1.行[0]?.标 === '👁' && 候选1.行[1]?.标 === '🚫', `${候选1.行[0]?.标} / ${候选1.行[1]?.标}`);
      判('没声明的那个不猜（候选上只给一个点）', 候选1.行[2]?.标 === '·', String(候选1.行[2]?.标));

      console.log('  · 点一下模型那一格：候选摊开、停在那儿，点一条就选上');
      await 点('#linkList [data-link-field="model"]');
      const 摊开了 = await 候选();
      判('点一下模型那一格，候选摊开了', 摊开了.摊开 === true && 摊开了.行.length === 4);
      await 歇(900);
      判('摊开之后它还在（异步取回来重画也不把它关掉）', (await 候选()).摊开 === true);
      await 点('#linkList .link-model-item:nth-child(3)');
      const 选了 = await 读格('model');
      判('点一条候选，型号就填进那一格', 选了 === '没声明的模型', String(选了));
      判('选完候选收起', (await 候选()).摊开 === false);
      判('点中的那条真进了存档', 读存档()[0]?.模型 === '没声明的模型', 读存档()[0]?.模型);
      await 点('#linkList [data-link-field="model"]');
      判('再点一下又摊开', (await 候选()).摊开 === true);
      await 点('#tabApi .hint');
      判('点别处收起', (await 候选()).摊开 === false);

      console.log('  · 型号自己填：服务商没提供的也存得住');
      await 填格('model', '我自己编的型号');
      await 歇(400);
      判('自己填的型号进了存档', 读存档()[0]?.模型 === '我自己编的型号', 读存档()[0]?.模型);
      判('自己填的型号不进候选（候选只有服务商给的）', !(await 候选()).行.some((一) => 一.名 === '我自己编的型号'));

      console.log('  · 表里没有结论的：探测一次，看服务商怎么说');
      await 填格('model', '没声明的模型');
      const 探出看图 = await 等到(连, `document.querySelector('#linkList [data-link-row] [data-link-field="badge"]')?.textContent === '👁'`, 15000);
      判('声明的两个之外，服务商收下带图请求的模型被探成 👁', 探出看图, `徽标 ${await 徽标()}`);
      await 填格('model', '拒绝看图的模型');
      const 探出不看图 = await 等到(连, `document.querySelector('#linkList [data-link-row] [data-link-field="badge"]')?.textContent === '🚫'`, 15000);
      判('服务商拒了带图请求的模型被探成 🚫', 探出不看图, `徽标 ${await 徽标()}`);
      const 表里记下了 = JSON.parse(fs.readFileSync(path.join(数据目录, 'API', '模型表.json'), 'utf8'));
      判('结论按（地址 + 模型）记在本机存档里',
        Object.values(表里记下了.能力 || {}).some((一) => 一.能看图 === false) && Object.values(表里记下了.能力 || {}).some((一) => 一.能看图 === true),
        Object.keys(表里记下了.能力 || {}).length + ' 条');

      console.log('  · Key：只进不出');
      await 填格('key', 'sk-test-1234');
      await 歇(400);
      const 设置 = await 连.算(`(() => { const 一 = window.AppModules.assistant.getSettings().links[0]; return { 键: Object.keys(一).join(','), 已存: 一.keyConfigured }; })()`);
      判('界面只拿得到「存没存过」，拿不到密钥本身', 设置.已存 === true && !/key(?!Configured)/.test(设置.键), 设置.键);
      判('密钥真写进了本机存档（明文，页面里写明了）', 读存档()[0]?.密钥 === 'sk-test-1234');
      判('保存后密码框清空', (await 读格('key')) === '');
      判('这一行的 Key 状态跟着说实话', /已保存 Key/.test(String(await 连.算(`document.querySelector('#linkList [data-link-field="keyStatus"]')?.textContent || ''`))));
      判('API 状态行显示配置条数与已保存 Key 条数', /已读取 1 条 API 配置.*1 条已保存 Key/.test(String(await 连.算(`document.querySelector('#linkStatus')?.textContent || ''`))));
      判('存档路径如实写在页面上', String(await 连.算(`document.querySelector('#linkStorePath')?.textContent || ''`)) === path.join(数据目录, 'API'));

      console.log('  · 整条链路：真发一次最小请求');
      await 填格('model', '看图声明的模型');
      await 连.算(`document.querySelector('#aiTest')?.click()`);
      const 连通 = await 等到(连, `String(document.querySelector('#toast')?.textContent || '').includes('AI 连接成功')`, 15000);
      判('「测试连接」真发了一次请求并成功', 连通, String(await 连.算(`document.querySelector('#toast')?.textContent || ''`)).slice(0, 60));

      await 留图('皮-API页.png');
    } finally {
      假服务商.服务.close();
    }

    console.log('十四、提示词页：预设、工具表与世界书');
    await 连.算(`document.querySelector('.ai-module-tab[data-panel="prompt"]')?.click()`);
    await 等到(连, `document.querySelector('#promptLibrary button[data-prompt-request="主AI"]') && document.querySelector('#promptBookSelect')`);
    await 连.算(`document.querySelector('#promptLibrary button[data-prompt-request="主AI"]')?.click()`);
    await 等到(连, `document.querySelector('#promptModuleTitle')?.textContent.startsWith('主 AI') && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
    await 连.算(`document.querySelector('#promptEditPreset')?.click()`);
    判('主AI设置显示模型与真实工具表', await 等到(连, `document.querySelectorAll('[data-tool-name]').length > 0 && document.querySelector('#promptModelLink') !== null`));
    判('主 AI 工具表使用当前业务动作名', await 连.算(`Boolean(document.querySelector('[data-tool-name="tags_search"]'))`));
    判('设置编辑器不含身份流程字段', await 连.算(`!document.querySelector('#psPrimaryFull,#psPrimaryFlow')`));
    await 连.算(`(() => { const select=document.querySelector('#promptBookSelect'); select.value='$default:主AI'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    判('默认主AI世界书显示身份与工作方式且正文只读', await 等到(连, `document.querySelector('#promptBookSelect')?.value === '$default:主AI' && ['身份','工作方式'].every(name=>Array.from(document.querySelectorAll('#promptBookEditor [data-entry-label]')).some(input=>input.value===name)) && Array.from(document.querySelectorAll('#promptBookEditor [data-entry-text]')).every(input=>input.readOnly)`));
    判('默认主AI世界书可直接通过统一列表启停', await 连.算(`(() => { document.querySelector('#promptBookPicker').open=true; const input=document.querySelector('#promptEnableChoices input[data-book-choice="$default:主AI"]'); return !!input && !input.disabled; })()`));
    for (const 名 of ['文生图', '识图', '翻译']) {
      await 连.算(`document.querySelector('#promptLibrary button[data-prompt-request=${JSON.stringify(名)}]')?.click()`);
      await 等到(连, `document.querySelector('#promptModuleTitle')?.textContent.startsWith(${JSON.stringify(名)}) && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
      const 有默认入口 = await 连.算(`Boolean(document.querySelector('#promptBookSelect option[value=${JSON.stringify(`$default:${名}`)}]'))`);
      判(`${名}模块的世界书选择器只列本模块默认书`, 有默认入口);
    }
    await 连.算(`document.querySelector('#promptLibrary button[data-prompt-request="文生图"]')?.click()`);
    await 等到(连, `document.querySelector('#promptModuleTitle')?.textContent.startsWith('文生图') && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
    await 连.算(`(() => { const select=document.querySelector('#promptBookSelect'); select.value='$default:文生图'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    判('文生图默认正文与命中条件可见', await 等到(连, `document.querySelectorAll('#promptBookEditor [data-entry-label]').length > 0 && Array.from(document.querySelectorAll('#promptBookEditor [data-entry-label]')).some(input=>input.value.includes('强透视')) && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`));
    await 留图('皮-提示词页.png');
    console.log('十五、账本（还没接的服务）');
    const 账 = await 连.算(`(window.__我们的账本__ || []).length`);
    console.log(`  · 还没接 ${账} 条：`);
    const 列 = await 连.算(`(window.__我们的账本__ || []).join('\\n')`);
    for (const 行 of String(列 || '').split('\n').filter(Boolean)) console.log(`      ${行}`);

    // 顺手留一张图：长相自检罩不住，只能人看。
    console.log('十六、留一张截图');
    const 存到 = await 留图('皮-最新.png');
    判('截图写出来了', fs.existsSync(存到), `${Math.round(fs.statSync(存到).size / 1024)} KB · ${存到}`);
  } finally {
    try { 连?.关(); } catch (_) { /* 已经断了 */ }
    try { 浏览器.kill(); } catch (_) { /* 已经退了 */ }
    await 歇(300);
    服务.close();
    await 歇(200);
    await 服务.宿主.close();
    fixture.cleanup();
    fs.rmSync(数据目录, { recursive: true, force: true });
  }

  console.log('');
  console.log(`过了 ${过了} 条 · 崩了 ${崩了.length} 条`);
  if (崩了.length) {
    console.log('失败清单：');
    for (const 一 of 崩了) console.log(`  · ${一}`);
  }
  process.exit(崩了.length ? 1 : 0);
}

主().catch((错) => { console.error('跑不下去：', 错); process.exit(1); });
