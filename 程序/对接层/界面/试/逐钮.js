// 逐钮实测：真浏览器把旧皮上每一颗钮点一遍，看**后台收没收到**、**有没有回话**。
//
// 三件事分开报，出了问题一眼看得出坏在哪一层：
//   ① 收到了   —— 点下去之后 `/toolbox/调` 上真出现了一条
//   ② 对得上   —— 那条是不是这颗钮该调的（对照 `对接层/界面/页/我们的模块.js` 里那个方法）
//   ③ 有回话   —— 回执回来了、不是失败信封、页面上也没有冒错
//
// 用法：node 试/逐钮.js [--端口 8793]
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
    this.对话框回话 = '自检';
  }
  async 开() {
    await new Promise((成, 败) => {
      this.套.addEventListener('open', 成, { once: true });
      this.套.addEventListener('error', 败, { once: true });
    });
    this.套.addEventListener('message', (事) => {
      let 包;
      try { 包 = JSON.parse(事.data); } catch (_) { return; }
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
  async 算(式子, { 等承诺 = true } = {}) {
    const 回 = await this.发('Runtime.evaluate', { expression: 式子, awaitPromise: 等承诺, returnByValue: true });
    if (回.exceptionDetails) throw new Error(回.exceptionDetails.exception?.description || 回.exceptionDetails.text);
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
 * 在页面里装一张请求/回话的账。
 *
 * 拦 fetch 与 XMLHttpRequest（适配层的同步通道走的就是后者），每一条记成
 * `{ 路, 体, 回, 错 }`；`回` 要等回执到了才填。
 */
const 装账 = `(() => {
  if (window.__账__) return 'already';
  const 账 = { 条: [], 错: [] };
  window.__账__ = 账;
  const 记 = (路, 体) => {
    const 一 = { 路: String(路 || ''), 体: 体 || null, 回: null, 错: null };
    账.条.push(一);
    return 一;
  };
  const 本来fetch = window.fetch;
  window.fetch = async (路, 选) => {
    let 体 = null;
    try { 体 = 选 && 选.body ? JSON.parse(选.body) : null; } catch (_) { 体 = 选 && 选.body; }
    const 一 = 记(路, 体);
    try {
      const 答 = await 本来fetch(路, 选);
      const 文 = await 答.clone().text();
      try { 一.回 = JSON.parse(文); } catch (_) { 一.回 = 文; }
      return 答;
    } catch (错) { 一.错 = String(错 && 错.message); throw 错; }
  };
  const 本来开 = XMLHttpRequest.prototype.open;
  const 本来发 = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (方法, 路, ...余) {
    this.__路 = 路;
    return 本来开.call(this, 方法, 路, ...余);
  };
  XMLHttpRequest.prototype.send = function (体) {
    let 解 = null;
    try { 解 = 体 ? JSON.parse(体) : null; } catch (_) { 解 = 体; }
    const 一 = 记(this.__路, 解);
    this.addEventListener('load', () => {
      try { 一.回 = JSON.parse(this.responseText); } catch (_) { 一.回 = this.responseText; }
    });
    this.addEventListener('error', () => { 一.错 = 'network'; });
    return 本来发.call(this, 体);
  };
  window.addEventListener('error', (事) => 账.错.push(String(事.message || '')), true);
  window.addEventListener('unhandledrejection', (事) => 账.错.push('未处理的拒绝：' + String((事.reason && 事.reason.message) || 事.reason)), true);
  return 'ok';
})()`;

/** 把账里从第 n 条起的新调用取出来。 */
const 取新 = `(从 => {
  const 条 = (window.__账__ && window.__账__.条) || [];
  return 条.slice(从).map(一 => ({
    路: 一.路,
    模块: 一.体 && 一.体.模块,
    动作: 一.体 && 一.体.动作,
    参数: 一.体 && 一.体.参数,
    好的: 一.回 ? (一.回.ok !== false) : null,
    码: 一.回 && 一.回.code,
    理由: 一.回 && 一.回.reason,
    到了: 一.回 !== null,
  }));
})`;

/** 一次点击：点之前记下账长，点之后等回执到齐，交回这一段新账。 */
async function 点一颗(连, 选择器, { 等毫秒 = 2500, 说明 = '' } = {}) {
  const 起点 = await 连.算('(window.__账__ && window.__账__.条.length) || 0');
  const 点了 = await 连.算(`(() => {
    const 钮 = document.querySelector(${JSON.stringify(选择器)});
    if (!钮) return '没有这一颗';
    if (钮.disabled) return '它是灰的';
    钮.click();
    return 'ok';
  })()`);
  if (点了 !== 'ok') return { 点了, 新: [] };
  await 歇(等毫秒);
  const 新 = await 连.算(`${取新}(${起点})`);
  return { 点了, 新: 新 || [] };
}

/** 页面这一屏有哪些钮（给"漏点"用）。 */
const 列钮 = `(() => {
  const 出 = [];
  for (const 一 of document.querySelectorAll('button, [role="button"], input[type="checkbox"], select')) {
    const 盒 = 一.getBoundingClientRect();
    if (盒.width < 1 || 盒.height < 1) continue;
    if (一.closest('[hidden]') || 一.hidden) continue;
    const 看 = getComputedStyle(一);
    if (看.display === 'none' || 看.visibility === 'hidden') continue;
    const 标 = 一.id ? '#' + 一.id : (一.dataset && (一.dataset.navAction || 一.dataset.tagMode || 一.dataset.panel) ? '[' + (一.dataset.navAction || 一.dataset.tagMode || 一.dataset.panel) + ']' : '');
    出.push({ 选择器: 标, 字: String(一.textContent || 一.value || '').trim().slice(0, 24), 灰: 一.disabled === true });
  }
  return 出;
})()`;

/**
 * 一个假服务商，只做这一份自检用：
 *   `GET /v1/models`          交两个模型
 *   `POST /v1/chat/completions`
 *     带图的请求 → 按「看图」那条链路的报文格式回两段（`标签：` 一行 + `描述：` 一行）
 *     纯文字     → 回一个 JSON 对象（「AI 翻译」那条链路要的就是它）
 *
 * 有了它，「AI 识图」与「AI 翻译」两颗钮才验得到东西 —— 它们底下都要一条真链路。
 */
function 起假服务商() {
  const 服务 = http.createServer((req, res) => {
    let 体 = '';
    req.on('data', (块) => { 体 += 块; });
    req.on('end', () => {
      const 路 = String(req.url || '').split('?')[0];
      res.setHeader('Content-Type', 'application/json');
      if (路 === '/v1/models') {
        res.end(JSON.stringify({
          object: 'list',
          data: [
            { id: '看图声明的模型', architecture: { input_modalities: ['text', 'image'] } },
            { id: '纯文字声明的模型', architecture: { input_modalities: ['text'] } },
          ],
        }));
        return;
      }
      if (路 === '/v1/chat/completions') {
        let 解 = {};
        try { 解 = JSON.parse(体 || '{}'); } catch (_) { 解 = {}; }
        const 带图 = JSON.stringify(解.messages || []).includes('image_url');
        const 正文 = 带图
          ? '标签：sun, clear_sky, sky, blue_sky, house, mountain, grass, no_humans\n描述：画面里有蓝天、太阳、山、草地与一座小屋。'
          : '{"a cat, sitting": "一只猫，坐着"}';
        res.end(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 正文 }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
        }));
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
  const 端口 = Number(process.argv[process.argv.indexOf('--端口') + 1]) || 8793;
  const 基 = `http://127.0.0.1:${端口}`;
  const 数据目录 = fs.mkdtempSync(path.join(os.tmpdir(), '逐钮-'));

  console.log('一、起服务（真装配）');
  const { 起, 这次启动的令牌 } = await import('../服务.js');
  const 假 = await 起假服务商();
  // 链路表先写一条：地址指向假服务商，模型用那个"声明能看图"的。
  const 链路文件 = path.join(数据目录, '链路.json');
  fs.mkdirSync(数据目录, { recursive: true });
  fs.writeFileSync(链路文件, `${JSON.stringify({
    链路: [{ id: 'link-1', 名字: '自检那条', 地址: 假.地址, 模型: '看图声明的模型', 上下文窗口: 0, 密钥: '自检钥匙' }],
  }, null, 2)}\n`, 'utf8');
  const 服务 = 起({ 端口, 项目根, 数据目录 });
  await new Promise((成) => 服务.once('listening', 成));
  判('服务起来了', 服务.listening === true);
  判('链路表指向假服务商', fs.readFileSync(链路文件, 'utf8').includes(假.地址));
  const 令牌 = 这次启动的令牌;

  /** 直接问后台一次，拿它当"标准答案"。 */
  const 问后台 = (模块, 动作, 参数) => new Promise((成) => {
    const 体 = Buffer.from(JSON.stringify({ 模块, 动作, 参数: 参数 || {} }), 'utf8');
    const 求 = http.request(`${基}/toolbox/调`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': 体.length, 'x-toolbox-token': 令牌 },
    }, (答) => {
      let 收 = '';
      答.on('data', (块) => { 收 += 块; });
      答.on('end', () => { try { 成(JSON.parse(收)); } catch (_) { 成({ ok: false, reason: '不是 JSON' }); } });
    });
    求.on('error', (错) => 成({ ok: false, reason: String(错.message) }));
    求.end(体);
  });

  const 调试口 = await 空端口();
  const 浏览器 = spawn(找浏览器(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${调试口}`,
    `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), '逐钮-'))}`,
    '--window-size=1600,1000',
    'about:blank',
  ], { stdio: 'ignore' });

  let 连 = null;
  try {
    console.log('二、开真浏览器，进旧皮');
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
    await 连.发('DOM.enable');
    await 连.发('Page.navigate', { url: `${基}/` });
    await 等到(连, `document.readyState === 'complete' && !!document.querySelector('#catList')`, 30000);
    判('页面起来了', await 连.算(`!!document.querySelector('#catList')`));
    判('令牌注进去了', await 连.算(`typeof window.__令牌__ === 'string' && window.__令牌__.length > 10`));
    判('装了账', (await 连.算(装账)) !== '');
    await 等到(连, `document.querySelectorAll('#catList .sitem, #catList > *').length > 0`, 20000);

    console.log('\n三、这一屏现在有哪些钮');
    const 钮们 = await 连.算(列钮);
    console.log(`  可见的钮 / 控件 ${钮们.length} 个：` + 钮们.map((一) => 一.标 || 一.字).filter(Boolean).join(' · '));

    const 报告 = [];
    /**
     * 点一颗钮，并核对后台收没收到、有没有回话。
     * @param {string} 处 这一颗在哪一屏，报告里用
     * @param {string} 选择器
     * @param {(新:Array)=>string} 核 判断"这一条对不对"，返回空串 = 对
     */
    async function 试(处, 选择器, 核 = null, 选项 = {}) {
      const 果 = await 点一颗(连, 选择器, 选项);
      if (果.点了 !== 'ok') {
        报告.push({ 处, 选择器, 收到: 0, 回话: 0, 判: 果.点了, 不要后台: 选项.不要后台 === true });
        console.log(`  · ${处} ${选择器} —— ${果.点了}`);
        return 果;
      }
      const 新 = 果.新.filter((一) => 一.路.includes('/toolbox/') || 一.路.includes('/存图') || 一.路.includes('/对话/'));
      const 收到 = 新.length;
      const 回话 = 新.filter((一) => 一.到了).length;
      // 失败的判据：回执带失败信封，且不是"这一趟没给参数"或"环境不具备"这类正常拒绝。
      const 正常拒 = /NO_SUCH|BAD_|_REQUIRED|UNREACHABLE|NO_REF|NO_LINK|NO_MODEL|EMPTY|NOT_FOUND/;
      const 坏 = 新.filter((一) => 一.好的 === false && !正常拒.test(String(一.码 || '')));
      let 判词 = '';
      if (核) 判词 = 核(新) || '';
      if (!判词 && 坏.length) 判词 = `后台回了失败：${坏.map((一) => `${一.模块}/${一.动作} ${一.码 || ''} ${一.理由 || ''}`).join('；').slice(0, 160)}`;
      报告.push({ 处, 选择器, 收到, 回话, 判: 判词, 不要后台: 选项.不要后台 === true, 明细: 新 });
      const 记号 = 判词 ? '✗' : (收到 ? '✓' : (选项.不要后台 ? '·' : '·'));
      const 摘要 = 收到 ? `（${[...new Set(新.map((一) => `${一.模块}/${一.动作}`))].join(' · ')}）` : (选项.不要后台 ? '（本来就只动界面）' : '');
      console.log(`  ${记号} ${处} ${选择器} —— 收到 ${收到} 条，回话 ${回话} 条${摘要}${判词 ? ` —— ${判词}` : ''}`);
      return 果;
    }

    console.log('\n四、标签那一屏的钮');
    // `不要后台: true` 的那些本来就只动界面：开关、纯本地过滤、切页签、开对话框。
    await 试('顶条', '#searchBtn');
    await 试('顶条', '#searchRegex', null, { 不要后台: true });
    await 试('顶条', '#searchRegex', null, { 不要后台: true });
    await 试('顶条', '#nsfwBtn', null, { 不要后台: true });
    await 试('顶条', '#nsfwBtn', null, { 不要后台: true });
    await 试('顶条', '#themeBtn', null, { 不要后台: true });
    await 试('顶条', '#localeBtn', null, { 不要后台: true });

    // 三个页签看屏幕有没有真变（它们可能命中缓存，不一定要调后台）
    const 屏上 = async (式子) => { try { return await 连.算(式子); } catch (_) { return null; } };
    await 试('标签页签', '[data-tag-mode="groups"]', null, { 等毫秒: 2000, 不要后台: true });
    const 标签组屏 = await 屏上(`document.querySelector('#catTitle')?.textContent || ''`);
    await 试('标签页签', '[data-tag-mode="characters"]', null, { 等毫秒: 2500, 不要后台: true });
    const 角色库屏 = await 屏上(`!document.querySelector('#charactersView')?.hidden`);
    await 试('标签页签', '[data-tag-mode="tags"]', null, { 等毫秒: 2000, 不要后台: true });
    const 回到标签 = await 屏上(`document.querySelector('#charactersView')?.hidden === true`);
    判('点「标签组」那一栏屏幕跟着变', typeof 标签组屏 === 'string', `标题现在：${标签组屏}`);
    判('点「角色库」真切到角色库那一屏', 角色库屏 === true);
    判('点回「标签」真切回去', 回到标签 === true);

    await 试('侧栏', '#addTagBtn', null, { 等毫秒: 1500, 不要后台: true });
    await 试('侧栏', '#addGroupBtn', null, { 等毫秒: 1500, 不要后台: true });
    await 试('底栏', '#copyAll', null, { 不要后台: true });
    await 试('底栏', '#saveFav', null, { 不要后台: true });
    await 试('底栏', '#clearSel', null, { 不要后台: true });

    console.log('\n五、AI 页那几屏的钮');
    await 试('顶条', '#aiBtn', null, { 等毫秒: 3000 });
    await 试('AI 页签', '#aiModuleApi', null, { 等毫秒: 2500 });
    await 试('API 页', '#linkAdd');

    // 给这张链路表填上地址与模型 —— 不填，「测试连接」「AI 识图」「AI 翻译」三颗钮
    // 底下都缺那条链路，验不到东西。填完再点。
    const 假服务商 = 假.地址;
    if (假服务商) {
      await 连.算(`(() => {
        const 行 = document.querySelector('#linkList [data-link-id]') || document.querySelector('#linkList > *');
        if (!行) return '没有行';
        for (const 一 of 行.querySelectorAll('input')) {
          const 名 = (一.dataset.linkField || 一.name || 一.id || '').toLowerCase();
          const 占位 = String(一.placeholder || '');
          if (/base|地址|url/.test(名) || /http/i.test(占位)) { 一.value = ${JSON.stringify(假服务商)}; 一.dispatchEvent(new Event('change', { bubbles: true })); }
          else if (/model|模型/.test(名) || /模型/.test(占位)) { 一.value = '看图声明的模型'; 一.dispatchEvent(new Event('change', { bubbles: true })); }
          else if (/key|密钥|密码/.test(名) || (一.type === 'password')) { 一.value = 'zj-key-1'; 一.dispatchEvent(new Event('change', { bubbles: true })); }
        }
        return 'ok';
      })()`);
      await 歇(800);
    } else {
      // 没有真服务商也不要紧：用本机那台 ComfyUI 那条路验不到，于是这里如实说一句。
      console.log('  · 没给 --服务商，跳过「测试连接」那一颗（它要一条填全的链路）');
    }
    await 试('API 页', '#aiTest', null, { 等毫秒: 5000 });
    await 试('AI 页签', '#aiModuleComfy', null, { 等毫秒: 2500 });
    await 试('comfyUI 页', '#comfyTest', null, { 等毫秒: 4000 });
    await 试('AI 页签', '#aiModulePrompt', null, { 等毫秒: 2500 });
    await 试('提示词页', '#promptSetAdd', null, { 等毫秒: 2500 });
    await 试('提示词页', '#psPrimaryFlowReset', null, { 等毫秒: 2500 });
    await 试('AI 页签', '#aiModuleTalk', null, { 等毫秒: 2500, 不要后台: true });

    console.log('\n六、翻译那一屏');
    await 试('顶条', '#translateBtn', null, { 等毫秒: 4000, 不要后台: true });
    await 连.算(`(() => { const 框 = document.querySelector('#translateInput'); if (框) { 框.value = 'a cat, sitting'; 框.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
    await 歇(3000);
    const 译账 = await 连.算(`${取新}(0)`);
    const 译调 = (译账 || []).filter((一) => 一.模块 === 'translate' || 一.模块 === 'tag');
    console.log(`  · 往输入框里打字之后，后台收到 ${译调.length} 条（${译调.map((一) => `${一.模块}/${一.动作}`).join(' · ')}）`);

    console.log('\n七、图片库那一屏');
    await 试('顶条', '#galleryBtn', null, { 等毫秒: 3000 });
    await 试('图库', '#galleryQuery', null, { 等毫秒: 800, 不要后台: true });
    await 试('图库', '#galleryOrder', null, { 等毫秒: 800, 不要后台: true });

    console.log('\n八、识图那一屏：把真图交给模型看');
    {
      // 造一张真图（PIL 画的：蓝天 · 太阳 · 灰山 · 红顶小屋 · 绿地），存进识图工作区。
      const 图路径 = path.join(项目根, '工具箱数据', '图片', 'vision', '看图试.png');
      if (fs.existsSync(图路径)) {
        const 存 = await 问后台('image', '存', {
          作用域: { 存放地: 'vision' },
          字节: fs.readFileSync(图路径).toString('base64'),
          文件名: '看图试.png',
          来源: '逐钮自检',
        });
        const 引用 = 存 && (存.引用 || 存);
        判('先把一张真图存进识图工作区', Boolean(引用 && 引用.条目ID), JSON.stringify(存).slice(0, 140));
        if (引用 && 引用.条目ID) {
          // 识图那一格会自己去列 vision 存放地；点「识图」那颗顶条钮把面板叫出来。
          // 打开面板本身不调后台（那一格显示的是手上有哪张图），所以标成"只动界面"。
          await 试('顶条', '#visionBtn', null, { 等毫秒: 3000, 不要后台: true });
          // 「上传图片」那条路：把真文件塞进 `#tpFile`，再点那颗钮。
          const 文件口 = await 连.算(`(() => {
            const 口 = document.querySelector('#tpFile');
            if (!口) return false;
            口.id = 'tpFile';
            return true;
          })()`);
          if (文件口) {
            const { root } = await 连.发('DOM.getDocument', { depth: -1 });
            const { nodeId } = await 连.发('DOM.querySelector', { nodeId: root.nodeId, selector: '#tpFile' });
            if (nodeId) await 连.发('DOM.setFileInputFiles', { nodeId, files: [图路径] });
          }
          await 试('识图面板', '#tpUpload', null, { 等毫秒: 6000 });
          const 挑上 = await 等到(连, `(() => {
            const 格 = document.querySelector('#tpImg');
            return !!格 && !格.querySelector('.tp-empty');
          })()`, 20000);
          判('识图面板把上传的那张图挑上了', 挑上);

          await 试('识图面板', '#tpIdentify', (新) => {
            const 打标 = 新.find((一) => 一.动作 === '认图');
            if (!打标) return '没调 vision/认图';
            if (打标.好的 === false) return `认图失败：${打标.理由 || ''}`.slice(0, 120);
            return '';
          }, { 等毫秒: 8000 });

          await 试('识图面板', '#tpDescribe', (新) => {
            const 看 = 新.find((一) => 一.动作 === '看图');
            if (!看) return '没调 vision/看图（这颗钮底下就是刚接通的看图链路）';
            if (看.好的 === false) return `看图失败：${看.理由 || ''}`.slice(0, 160);
            return '';
          }, { 等毫秒: 30000 });
        }
      } else {
        console.log('  · 没有看图试.png，跳过这一段（先跑一次 work/_造看图试.png.py）');
      }
    }

    console.log('\n九、装订那一颗（走本地模型）');
    {
      await 试('顶条', '#translateBtn', null, { 等毫秒: 2500 });
      await 连.算(`(() => { const 框 = document.querySelector('#translateInput'); if (框) { 框.value = 'a serene mountain lake at sunrise'; 框.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
      await 歇(2500);
      const 起点 = await 连.算('(window.__账__ && window.__账__.条.length) || 0');
      await 试('翻译页', '#translateAi', (新) => {
        const 订 = 新.find((一) => 一.动作 === '装订');
        if (!订) return '没调 binding/装订';
        if (订.好的 === false) return `装订失败：${订.理由 || ''}`.slice(0, 160);
        return '';
      }, { 等毫秒: 30000 });
      const 现况 = await 连.算(`(() => {
        const 框 = document.querySelector('#translateOutput');
        const 照 = document.querySelector('#translateAlignedOutput');
        const 提 = document.querySelector('#translateAlignmentHint');
        const 态 = document.querySelector('#translateStatus');
        return {
          框文: 框 ? String(框.value || '') : '(没有框)',
          框藏: 框 ? 框.hidden === true : null,
          照藏: 照 ? 照.hidden === true : null,
          照文: 照 ? String(照.textContent || '').slice(0, 60) : '',
          提示: 提 ? String(提.textContent || '').slice(0, 60) : '',
          状态: 态 ? String(态.textContent || '') : '',
        };
      })()`);
      console.log('  · 页面上那一格现在：' + JSON.stringify(现况));
      const 页上 = (现况.框藏 === false ? 现况.框文 : '') || (现况.照藏 === false ? 现况.照文 : '');
      判('「AI 翻译」之后页面上有译文', Boolean(页上 && 页上.trim()), `页上现在：${页上}`);
    }

    console.log('\n十、账里有没有人冒错');
    const 错们 = await 连.算('(window.__账__ && window.__账__.错) || []');
    判('页面上没有未捕获的错', (错们 || []).length === 0, (错们 || []).slice(0, 3).join(' | '));

    console.log('\n十一、总结');
    const 该调的 = 报告.filter((一) => !一.不要后台);
    const 没收到 = 该调的.filter((一) => 一.收到 === 0 && !一.判);
    const 有判词 = 报告.filter((一) => 一.判);
    console.log(`  点过的钮 ${报告.length} 颗（其中本来就只动界面的 ${报告.length - 该调的.length} 颗）`);
    console.log(`  该调后台的 ${该调的.length} 颗 · 收到了 ${该调的.filter((一) => 一.收到 > 0).length} 颗 · 有回话 ${该调的.filter((一) => 一.回话 > 0).length} 颗`);
    if (没收到.length) console.log('  该调却一条都没收到：' + 没收到.map((一) => `${一.处}${一.选择器}`).join(' · '));
    if (有判词.length) { console.log('  有问题：'); for (const 一 of 有判词) console.log(`    · ${一.处}${一.选择器}：${一.判}`); }

    console.log('\n十二、直接问后台，当标准答案');
    for (const [模, 动, 参] of [['tag', 'status', {}], ['translate', '看模型', {}], ['vision', '看模型', {}], ['主AI', '读', { 请求: '主AI' }]]) {
      const 回 = await 问后台(模, 动, 参);
      console.log(`  ${模}/${动} → ${回 && 回.ok === false ? `${回.code}：${回.reason}` : '通'}`);
    }

    const 有问题的 = 有判词.length + 没收到.length;
    判(`逐钮走完：该调后台的 ${该调的.length} 颗里，${该调的.length - 没收到.length} 颗收到了回话且没冒失败`, 有问题的 === 0, 有问题的 ? `${有问题的} 颗有问题` : '');
    const 不调的也动了 = 报告.filter((一) => 一.不要后台 && 一.收到 > 0).length;
    console.log(`  （另有 ${不调的也动了} 颗"只动界面"的钮顺手也调了后台，不算问题）`);
  } finally {
    try { 连?.关(); } catch (_) { /* 已经断了 */ }
    try { 浏览器.kill(); } catch (_) { /* 已经退了 */ }
    try { 服务.close(); } catch (_) { /* 已经关了 */ }
    try { 假.服务.close(); } catch (_) { /* 已经关了 */ }
    try { fs.rmSync(数据目录, { recursive: true, force: true }); } catch (_) { /* 删不掉就算了 */ }
  }

  console.log(`\n过了 ${过了} 条 · 崩了 ${崩了.length} 条`);
  if (崩了.length) { console.log('崩的：'); for (const 一 of 崩了) console.log('  · ' + 一); }
  process.exit(崩了.length ? 1 : 0);
}

主().catch((错) => { console.error(String((错 && 错.stack) || 错)); process.exit(1); });
