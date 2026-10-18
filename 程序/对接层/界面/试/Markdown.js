import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const 页目录 = path.resolve('程序/对接层/界面/页');
const edgeDir = 'C:/Program Files (x86)/Microsoft/Edge/Application';
const versionedEdgePaths = fs.existsSync(edgeDir)
  ? fs.readdirSync(edgeDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(entry.name))
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
      .map((entry) => path.join(edgeDir, entry.name, 'msedge.exe'))
  : [];
const 浏览器 = [
  ...versionedEdgePaths,
  path.join(edgeDir, 'msedge.exe'),
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));
assert.ok(浏览器, '需要安装 Microsoft Edge 才能运行浏览器 DOM 回归');

const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-markdown-'));
const htmlPath = path.join(临时目录, 'markdown.html');
const markdown = '# 博丽灵梦\n\n- 角色\n  - **博丽灵梦**\n\n> 一条 ~~旧~~ 的记录，行内 `hakurei_reimu`。\n\n[搜索](https://example.test) ![角色](https://example.test/reimu.png)\n\n| 记录 | 名称 |\n|---|---|\n| **9540** | `hakurei_reimu` |\n\n```js\nconst x = 1;\nconsole.log(x);\n```\n\n<script>危险内容</script>';
const markdownLiteral = JSON.stringify(markdown).replaceAll('<', '\\u003c');
const js = String.raw`
(async () => {
const source = ${markdownLiteral};
const old = document.createElement('div');
old.textContent = source;
document.body.append(old);
const oldHadTable = old.querySelector('table') !== null;
const result = { oldHadTable, apiAvailable: Boolean(window.ChatMarkdown) };
try {
  if (window.ChatMarkdown) {
    const root = ChatMarkdown.render(source, { document });
    document.body.append(root);
    result.className = root.className;
    result.hasTable = root.querySelector('table') !== null;
    result.hasTitle = root.querySelector('h1')?.textContent === '博丽灵梦';
    result.hasNestedList = root.querySelector('ul ul') !== null;
    result.hasQuote = root.querySelector('blockquote') !== null;
    result.hasStrike = root.querySelector('s')?.textContent === '旧';
    result.hasInlineCode = root.querySelector('p code')?.textContent === 'hakurei_reimu';
    result.hasLinkAndImage = root.querySelector('a[href="https://example.test"]') !== null && root.querySelector('img[alt="角色"]') !== null;
    result.tableScroll = root.querySelector('.agent-markdown-table-scroll table') !== null;
    result.codeScroll = getComputedStyle(root.querySelector('.agent-markdown-code pre')).overflowX === 'auto';
    result.hasCodeCopy = root.querySelector('.agent-markdown-copy') !== null;
    result.language = root.querySelector('.agent-markdown-language')?.textContent;
    result.codeText = root.querySelector('pre code')?.textContent;
    result.original = source;
    result.expectedOriginal = source;
    result.noRawHtml = root.querySelector('script') === null;
    result.compactClass = ChatMarkdown.render('摘要', { document, compact: true }).classList.contains('agent-markdown-compact');
    let copiedText = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { copiedText = text; } } });
    root.querySelector('.agent-markdown-copy').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    result.copiedText = copiedText;
  }
} catch (error) {
  result.error = String(error && error.stack || error);
}
document.getElementById('result').textContent = JSON.stringify(result);
})()
`;
const src = (name) => pathToFileURL(path.join(页目录, name)).href;
const html = `<!doctype html><meta charset="utf-8"><body><pre id="result"></pre>
<link rel="stylesheet" href="${src('chat-markdown.css')}">
<script src="${src('vendor/markdown-it.min.js')}"></script>
<script src="${src('chat-markdown.js')}"></script>
<script>${js}</script></body>`;
async function 空闲端口() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function 等到(fn, label) {
  const stopAt = Date.now() + 15000;
  while (Date.now() < stopAt) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`等待浏览器${label}超时`);
}
try {
  fs.writeFileSync(htmlPath, html, 'utf8');
  let result;
  const port = await 空闲端口();
  const process = spawn(浏览器, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-background-mode', '--disable-extensions',
    `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(临时目录, 'profile')}`,
    pathToFileURL(htmlPath).href,
  ], { stdio: 'ignore', windowsHide: true });
  let socket, browserSocket;
  try {
    const endpoint = `http://127.0.0.1:${port}`;
    const version = await 等到(async () => {
      const response = await fetch(`${endpoint}/json/version`);
      return response.ok ? response.json() : null;
    }, '调试接口');
    const pages = await 等到(async () => {
      const list = await (await fetch(`${endpoint}/json/list`)).json();
      return list.find((item) => item.type === 'page' && item.url === pathToFileURL(htmlPath).href);
    }, '测试页');
    socket = new WebSocket(pages.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let requestId = 0;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    const evaluate = (expression) => new Promise((resolve, reject) => {
      const id = ++requestId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
    const resultText = await 等到(async () => {
      const result = await evaluate('document.getElementById("result").textContent');
      return result.result.value;
    }, 'DOM 检查结果');
    result = JSON.parse(resultText);
    browserSocket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      browserSocket.addEventListener('open', resolve, { once: true });
      browserSocket.addEventListener('error', reject, { once: true });
    });
    browserSocket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
  } finally {
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    if (process.exitCode === null && process.signalCode === null) {
      const exited = new Promise((resolve) => process.once('exit', resolve));
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
    if (process.exitCode === null && process.signalCode === null) {
      spawnSync('taskkill.exe', ['/PID', String(process.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      await new Promise((resolve) => {
        if (process.exitCode !== null || process.signalCode !== null) return resolve();
        process.once('exit', resolve);
        setTimeout(resolve, 1000).unref();
      });
    }
    if (browserSocket && browserSocket.readyState < WebSocket.CLOSING) browserSocket.close();
  }

  assert.equal(result.oldHadTable, false, 'textContent 只呈现原文，不会把 Markdown 表格变成 DOM');
  assert.equal(result.apiAvailable, true, '聊天正文应使用 Markdown 渲染接口');
  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.className.split(/\s+/).sort(), ['agent-markdown', 'dsh-md-text'].sort());
  assert.equal(result.hasTable, true, '表格语法应生成真实 table 元素');
  assert.equal(result.hasTitle, true, '标题语法应生成真实标题元素');
  assert.equal(result.hasNestedList, true, '嵌套列表应保留层级');
  assert.equal(result.hasQuote, true, '引用语法应生成引用块');
  assert.equal(result.hasStrike, true, '删除线语法应生成语义元素');
  assert.equal(result.hasInlineCode, true, '行内代码应生成代码元素');
  assert.equal(result.hasLinkAndImage, true, '链接和图片应保留其目标与替代文字');
  assert.equal(result.tableScroll, true, '宽表格应放在独立横向滚动容器中');
  assert.equal(result.codeScroll, true, '代码块应启用内部横向滚动');
  assert.equal(result.hasCodeCopy, true, '代码块应提供独立复制按钮');
  assert.equal(result.language, 'JavaScript', '代码语言应显示为标注');
  assert.equal(result.codeText, 'const x = 1;\nconsole.log(x);\n', '复制来源保留代码换行');
  assert.equal(result.copiedText, result.codeText, '代码复制按钮应复制完整代码和换行');
  assert.equal(result.original, result.expectedOriginal, '渲染不能修改原始消息');
  assert.equal(result.noRawHtml, true, 'Markdown 原始 HTML 按文本呈现');
  assert.equal(result.compactClass, true, '紧凑模式应带独立样式类');
  console.log('Markdown 浏览器 DOM 回归通过');
} finally {
  await new Promise((resolve) => setTimeout(resolve, 250));
  fs.rmSync(临时目录, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
