import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const 本目录 = path.dirname(fileURLToPath(import.meta.url));
const 程序目录 = path.resolve(本目录, '../../..');
const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-storage-browser-'));
const 原LOCALAPPDATA = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = path.join(根, 'appdata');
const { 起 } = await import('../服务.js');
const 服务 = 起({ 端口: 0, 项目根: 程序目录 });
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profile = path.join(根, 'browser');
const errors = [];
let browser;
let socket;
let sequence = 0;
const pending = new Map();

async function 空端口() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}

async function until(expression, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`页面条件未满足：${expression}`);
}

async function openApiPanel() {
  await evaluate(`document.querySelector('#aiBtn').click()`);
  await until(`document.querySelector('#aiModuleApi')`);
  await evaluate(`document.querySelector('#aiModuleApi').click()`);
  await until(`document.querySelector('#tabApi')?.style.display !== 'none'`);
}

async function 截图(name) {
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  const directory = path.resolve(本目录, '../../../..', '临时', '截图');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, name);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return file;
}

try {
  assert.equal(fs.existsSync(edge), true, '需要安装 Edge 才能跑设置页 CDP 验收');
  await 服务.宿主.ready;
  await new Promise((resolve) => 服务.listening ? resolve() : 服务.once('listening', resolve));
  const debugPort = await 空端口();
  browser = spawn(edge, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  let target;
  for (let i = 0; i < 120 && !target; i += 1) {
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((row) => row.type === 'page'); } catch {}
    if (!target) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(target, 'Edge 调试页面没有启动');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map((arg) => arg.value || arg.description || '').join(' '));
    }
    const pendingCall = pending.get(message.id);
    if (!pendingCall) return;
    pending.delete(message.id);
    if (message.error) pendingCall.reject(new Error(message.error.message));
    else pendingCall.resolve(message.result);
  });
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Log.enable');
  await call('Page.navigate', { url: `http://127.0.0.1:${服务.address().port}/` });
  await until(`window.AppModules?.assistant && document.querySelector('#storageDataPath')`);
  await until(`document.querySelector('#storageDataPath').textContent !== '读取中…'`);
  await openApiPanel();
  await until(`document.querySelector('#storageVisionModel').options.length > 1 && document.querySelector('#storageTranslationModel').options.length > 1`);

  const uiState = await evaluate(`(() => {
    const box = document.querySelector('#storageSettingsTitle').closest('section');
    const rect = box.getBoundingClientRect();
    return {
      visible: rect.width > 0 && rect.height > 0,
      sectionHeight: rect.height,
      inputWidth: document.querySelector('#storageDataInput').getBoundingClientRect().width,
      saveButtonHeight: document.querySelector('#storageDataSave').getBoundingClientRect().height,
      refreshButtonHeight: document.querySelector('#storageModelRefresh').getBoundingClientRect().height,
      visionSelectHeight: document.querySelector('#storageVisionModel').getBoundingClientRect().height,
      translationSelectHeight: document.querySelector('#storageTranslationModel').getBoundingClientRect().height,
      dataPath: document.querySelector('#storageDataPath').textContent,
      modelPath: document.querySelector('#storageModelPath').textContent,
      visionCount: document.querySelector('#storageVisionModel').options.length,
      translationCount: document.querySelector('#storageTranslationModel').options.length,
    };
  })()`);
  console.log('存储设置尺寸：', uiState);
  assert.equal(uiState.visible, true);
  assert.ok(uiState.sectionHeight < 440, `存储区块过高：${uiState.sectionHeight}px`);
  assert.ok(uiState.inputWidth >= 300, `数据目录输入框过窄：${uiState.inputWidth}px`);
  assert.ok(uiState.saveButtonHeight <= 40, `保存按钮过高：${uiState.saveButtonHeight}px`);
  assert.ok(uiState.refreshButtonHeight <= 40, `刷新按钮过高：${uiState.refreshButtonHeight}px`);
  assert.ok(uiState.visionSelectHeight <= 40 && uiState.translationSelectHeight <= 40, '模型下拉控件高度异常');
  assert.equal(uiState.dataPath, path.join(根, 'appdata', '工具箱'));
  assert.equal(uiState.modelPath, path.resolve(程序目录, '..', '模型'));
  assert.ok(uiState.visionCount > 1);
  assert.ok(uiState.translationCount > 1);

  const model = await evaluate(`(() => {
    const select = document.querySelector('#storageVisionModel');
    const installed = [...select.options].filter(option => option.value && !option.disabled);
    const current = select.value;
    const choice = installed.find(option => option.value !== current) || installed[0];
    if (!choice) return null;
    select.value = choice.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return choice.value;
  })()`);
  assert.ok(model, '识图模型下拉没有可选择的已安装模型');
  await until(`document.querySelector('#storageVisionModel').value === ${JSON.stringify(model)}`);
  await until(`document.querySelector('#storageStatus').textContent.includes('模型选择已保存')`);
  await evaluate(`AppModules.preferences.set('app.theme', 'light')`);
  const dataDirectory = path.join(根, 'appdata', '工具箱');
  const savedSettings = JSON.parse(fs.readFileSync(path.join(dataDirectory, '设置.json'), 'utf8'));
  assert.equal(savedSettings.识图模型, model);
  assert.equal(savedSettings.界面['app.theme'], 'light');
  const screenshot = await 截图('存储设置-页面.png');

  await call('Page.reload', { ignoreCache: true });
  await until(`window.AppModules?.assistant && document.querySelector('#storageDataPath')`);
  await until(`document.querySelector('#storageDataPath').textContent !== '读取中…'`);
  await openApiPanel();
  await until(`document.querySelector('#storageVisionModel').value === ${JSON.stringify(model)}`);
  const persistence = await evaluate(`({ theme: AppModules.preferences.get('app.theme'), dark: document.body.classList.contains('dark'), selected: document.querySelector('#storageVisionModel').value })`);
  assert.deepEqual(persistence, { theme: 'light', dark: false, selected: model });
  assert.deepEqual(errors, [], '设置页出现 JavaScript 错误');
  console.log(`通过：设置页可见、模型选择和首选项重载保持、无 JavaScript 错误；截图 ${screenshot}`);
} finally {
  socket?.close();
  if (browser) {
    const escapedProfile = profile.replace(/'/g, "''");
    spawnSync('powershell.exe', ['-NoProfile', '-Command', `$needle='${escapedProfile}'; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($needle) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { windowsHide: true, stdio: 'ignore' });
    browser.kill();
  }
  await 服务.停止();
  if (原LOCALAPPDATA === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = 原LOCALAPPDATA;
  fs.rmSync(根, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
