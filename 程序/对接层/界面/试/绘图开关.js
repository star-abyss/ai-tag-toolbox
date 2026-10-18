import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { 起, 这次启动的令牌 } from '../服务.js';
import { 造服务商面 } from '../服务商.js';
import { 造文件存档 } from '../../存档.js';
import { 临时项目 } from './会话装置.js';

const require = createRequire(import.meta.url);
const { createComfyModule } = require('../../../comfyUI模块/index.js');
const fixture = 临时项目();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-drawing-toggle-'));
const graph = {
  '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'test.safetensors' } },
  '2': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  '3': { class_type: 'CLIPTextEncode', inputs: { text: 'test prompt', clip: ['1', 1] } },
  '4': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['1', 1] } },
  '5': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['2', 0], seed: 1, control_after_generate: 'fixed', steps: 20, cfg: 8, sampler_name: 'euler', scheduler: 'normal', denoise: 1 } },
  '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
  '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'toggle' } },
};
const interfaceGraph = {
  nodes: [
    { id: 1, type: 'CLIPTextEncode', title: 'Positive', inputs: [], outputs: [], widgets_values: ['test prompt'] },
    { id: 2, type: 'SaveImage', title: 'Save Image', inputs: [], outputs: [], widgets_values: ['toggle'] },
  ],
  links: [],
};
let online = false;
let objectInfoCalls = 0;
let holdProbe = false;
const heldResponses = [];
const submitted = [];
const modelRequests = [];
const generatedPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = async server => {
  if (!server?.listening) return;
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
};
const upstream = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/system_stats') {
    if (holdProbe) { heldResponses.push(res); return; }
    res.statusCode = online ? 200 : 503;
    res.end(JSON.stringify(online ? { system: { comfyui_version: 'test' }, devices: [{ name: 'test device' }] } : { error: 'offline' }));
  } else if (req.url === '/object_info') {
    objectInfoCalls += 1;
    res.end(JSON.stringify({ CLIPTextEncode: { input: { required: { text: ['STRING'] } } }, SaveImage: { output_node: true } }));
  } else if (req.url === '/prompt') {
    submitted.push(JSON.parse(raw));
    res.end(JSON.stringify({ prompt_id: String(submitted.length) }));
  } else if (req.url.startsWith('/history/')) {
    const id = req.url.slice('/history/'.length);
    res.end(JSON.stringify({ [id]: { status: { status_str: 'success', completed: true }, outputs: { '2': { images: [{ filename: 'toggle.png', subfolder: '', type: 'output' }] } } } }));
  } else if (req.url.startsWith('/view?')) {
    res.setHeader('Content-Type', 'image/png');
    res.end(generatedPng);
  } else {
    res.statusCode = 404;
    res.end('{}');
  }
});
const provider = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  modelRequests.push(body);
  const returned = body.messages.findLast(message => message.role === 'tool');
  const message = returned
    ? { role: 'assistant', content: '调用已结束' }
    : { role: 'assistant', content: null, tool_calls: [{ id: 'drawing', type: 'function', function: { name: 'drawing_generate', arguments: '{"正向":"test prompt"}' } }] };
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message, finish_reason: returned ? 'stop' : 'tool_calls' }] }));
});
await Promise.all([listen(upstream), listen(provider)]);
造服务商面({ 目录: path.join(temporary, 'API') }).写链路([{ id: 'test', 名字: '测试', 地址: `http://127.0.0.1:${provider.address().port}/v1`, 模型: 'test' }]);
let server;
let base;
let saveFailure = false;
async function start(port = 0) {
  server = 起({ 端口: port, 项目根: fixture.root, 数据目录: temporary });
  await new Promise(resolve => server.once('listening', resolve));
  const store = 造文件存档(path.resolve(fixture.root, server.宿主.配置.comfyUI工作流存档));
  server.宿主.门面.comfy = createComfyModule({
    地址: `http://127.0.0.1:${upstream.address().port}`,
    存档: { ...store, 写: value => saveFailure ? false : store.写(value) },
    等待: async () => {},
  });
  base = `http://127.0.0.1:${server.address().port}`;
}
const post = async (module, action, parameters = {}) => (await fetch(base + '/toolbox/调', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 这次启动的令牌, Connection: 'close' },
  body: JSON.stringify({ 模块: module, 动作: action, 参数: parameters }),
})).json();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
let ws;
let nextId = 0;
const pending = new Map();
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function until(expression) {
  for (let i = 0; i < 150; i++) {
    if (await evaluate(expression)) return;
    await pause(100);
  }
  console.log('超时页面状态：', await evaluate(`({settings:AppModules.assistant.getSettings().comfyOn,talk:document.querySelector('#talkComfyOn')?.checked,config:document.querySelector('#comfyOn')?.checked,status:document.querySelector('#comfyConfigStatus')?.textContent,toast:document.querySelector('#toast')?.textContent})`));
  throw new Error('页面条件未满足：' + expression);
}
async function click(selector) {
  const point = await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) throw new Error('控件不可点击：'+${JSON.stringify(selector)}); element.scrollIntoView({block:'center'}); const box=element.getBoundingClientRect(); const point={x:box.x+box.width/2,y:box.y+box.height/2}; const hit=document.elementFromPoint(point.x,point.y); if (!hit || !element.contains(hit)) throw new Error('点击未命中：'+${JSON.stringify(selector)}+' actual='+hit?.outerHTML.slice(0,160)+' box='+JSON.stringify(point)); return point; })()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}
async function navigate() {
  await call('Page.navigate', { url: base + '/' });
  await until(`window.App?.catalogStatus() === 'ready' && window.AppModules?.assistant`);
  await evaluate(`window.App.route('ai');window.App.showAi('talk')`);
  await until(`document.querySelector('#talkComfyOn')&&document.querySelector('#talkConv')`);
}
async function openBrowser() {
  const probe = net.createServer();
  await listen(probe);
  const debugPort = probe.address().port;
  await close(probe);
  const executable = [process.env.PIEL_EDGE, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(value => value && fs.existsSync(value));
  assert.ok(executable, '需要 Edge 或 Chrome');
  browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(temporary, 'browser')}`, '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(row => row.type === 'page'); } catch {}
    if (!target) await pause(100);
  }
  assert.ok(target, '浏览器启动');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data), item = pending.get(result.id);
    if (!item) return;
    pending.delete(result.id);
    result.error ? item.reject(new Error(result.error.message)) : item.resolve(result.result);
  });
  await call('Page.enable');
  await navigate();
}
async function runTool() {
  const created = await post('session', '新');
  const id = created.会话.id;
  await post('session', '发', { 会话: id, 内容: [{ type: 'text', text: '调用绘图工具' }] });
  for (let i = 0; i < 150; i++) {
    const state = await post('session', '读', { 会话: id });
    if (state.运行状态 === '空闲') {
      const tool = state.会话.messages.flatMap(message => message.toolCalls || []).find(item => item.name === 'drawing_generate');
      assert.ok(tool, '模型实际调用出图工具');
      return tool;
    }
    await pause(30);
  }
  throw new Error('工具执行未完成');
}
try {
  await start();
  const settingAction = server.宿主.动作表.find(row => row.模块 === 'comfy' && row.动作 === '绘图开关');
  assert.equal(settingAction?.模型侧, 'drawing', '开关动作有 ASCII 工具名');
  assert.equal(settingAction.参数[0].类型.type, 'boolean');
  assert.equal(settingAction.参数[0].界面.控件, 'boolean');
  assert.deepEqual(await post('comfy', '绘图开关'), { 启用: false }, '首次启动默认关闭');
  assert.equal((await post('comfy', '出图')).code, 'COMFY_DISABLED');
  assert.equal(submitted.length, 0);
  console.log('通过：默认关闭，HTTP 出图被模块拒绝');

  if (!process.argv.includes('--http')) {
    await openBrowser();
    await evaluate(`window.App.route('ai');window.App.showAi('talk')`);
    await until(`document.querySelector('#talkComfyOn')&&document.querySelector('#talkConv')`);
    assert.equal(await evaluate('document.querySelector("#talkComfyOn").disabled'), false, '离线时助手页开关仍可勾选');
    await click('#talkComfyOn');
    await until('document.querySelector("#talkComfyOn").checked && AppModules.assistant.getSettings().comfyOn');
    assert.deepEqual(await post('comfy', '绘图开关'), { 启用: true });
    await navigate();
    await until('document.querySelector("#talkComfyOn").checked');
    console.log('通过：离线时助手页允许启用，重载后状态恢复');

    await evaluate(`window.App.showAi('comfy')`);
    await until(`document.querySelector('#comfyOn').getBoundingClientRect().height>0`);
    await click('#comfyTest');
    await until(`document.querySelector('#comfyConfigStatus').textContent.includes('未连接')`);
    assert.equal(await evaluate('AppModules.assistant.getSettings().comfyOn'), true);
    await click('#comfyOn');
    await until('!AppModules.assistant.getSettings().comfyOn && !document.querySelector("#talkComfyOn").checked');
    assert.deepEqual(await post('comfy', '绘图开关'), { 启用: false });
    console.log('通过：设置页显示离线状态，设置页开关与助手页同步');

    saveFailure = true;
    await click('#comfyOn');
    await until(`!document.querySelector('#comfyOn').disabled&&!document.querySelector('#comfyOn').checked`);
    assert.deepEqual(await post('comfy', '绘图开关'), { 启用: false }, '设置页写入失败时服务端开关保持关闭');
    await evaluate(`document.querySelector('.ai-module-tab[data-panel="talk"]').click()`);
    await click('#talkComfyOn');
    await until(`!document.querySelector('#talkComfyOn').disabled&&!document.querySelector('#talkComfyOn').checked`);
    assert.deepEqual(await post('comfy', '绘图开关'), { 启用: false }, '助手页写入失败时服务端开关保持关闭');
    saveFailure = false;
    console.log('通过：设置页与助手页写入失败都恢复原开关状态');
  }

  online = true;
  if (ws) {
    await evaluate(`window.App.showAi('comfy')`);
    await click('#comfyTest');
    await until(`document.querySelector('#comfyConfigStatus').textContent.includes('尚未导入工作流')`);
    await evaluate('AppModules.assistant.refreshCapabilities({force:true})');
    const state = await evaluate('AppModules.assistant.getCapabilities().comfy');
    assert.deepEqual({ connected: state.connected, workflowReady: state.workflowReady }, { connected: true, workflowReady: false });
    console.log('通过：设置页显示 ComfyUI 已连接、尚未导入工作流');
  }

  await post('comfy', '存工作流', { 图: graph });
  assert.equal((await runTool()).result.code, 'COMFY_DISABLED');
  assert.equal(submitted.length, 0, '关闭时 AI 调用不得提交');
  await post('comfy', '绘图开关', { 启用: true });
  const enabledTool = await runTool();
  assert.equal(enabledTool.status, 'complete', JSON.stringify(enabledTool).slice(0, 1200));
  assert.equal(submitted.length, 1, '开启时 AI 调用只提交一次');
  if (ws) {
    await evaluate(`window.App.showAi('comfy')`);
    await click('#comfyTest');
    await until(`document.querySelector('#comfyConfigStatus').textContent.includes('工作流已就绪')`);
    await evaluate('AppModules.assistant.refreshCapabilities({force:true})');
    const state = await evaluate('AppModules.assistant.getCapabilities().comfy');
    assert.equal(state.connected, true);
    assert.equal(state.workflowReady, true);
  }
  await post('comfy', '绘图开关', { 启用: false });
  assert.equal((await runTool()).result.code, 'COMFY_DISABLED');
  assert.equal(submitted.length, 1, '关闭后 AI 再次调用不得提交');
  assert.ok(modelRequests.some(body => body.tools?.some(tool => tool.function.name === 'drawing_generate')), '工具仍由预设提供，执行由模块开关控制');
  console.log('通过：AI 实际调用链中关闭拒绝、开启提交、再次关闭拒绝');

  await post('comfy', '绘图开关', { 启用: true });
  await post('comfy', '清工作流');
  assert.equal((await post('comfy', '取工作流')).code, 'COMFY_NO_WORKFLOW');
  const port = server.address().port;
  await server.停止();
  await start(port);
  assert.deepEqual(await post('comfy', '绘图开关'), { 启用: true }, '重启后开关保持');
  if (ws) {
    await navigate();
    await until('document.querySelector("#talkComfyOn").checked');
    const state = await evaluate('AppModules.assistant.refreshCapabilities()');
    assert.equal(state.comfy.workflowReady, false);
    assert.equal(await evaluate('document.querySelector("#talkComfyOn").disabled'), false);
    await evaluate(`window.App.showAi('comfy')`);
    await click('#comfyTest');
    await until(`document.querySelector('#comfyConfigStatus').textContent.includes('尚未导入工作流')`);
    const screenshot = await call('Page.captureScreenshot', { format: 'png' });
    const destination = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../临时/启用绘图修复');
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, '绘图开关验收.png'), Buffer.from(screenshot.data, 'base64'));
  }
  console.log('通过：清工作流保留开关，服务重启与页面重载后保持；未运行真实 ComfyUI');
} finally {
  for (const response of heldResponses) response.end('{}');
  ws?.close();
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    const profile = path.join(temporary, 'browser').replace(/'/g, "''");
    spawnSync('powershell.exe', ['-NoProfile', '-Command', `$needle='${profile}';Get-CimInstance Win32_Process|Where-Object{$_.CommandLine -and $_.CommandLine.Contains($needle)}|ForEach-Object{Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}`], { windowsHide: true, stdio: 'ignore' });
    const exited = new Promise(resolve => browser.once('exit', resolve));
    browser.kill();
    await Promise.race([exited, pause(2000)]);
  }
  await server?.停止();
  await Promise.all([close(upstream), close(provider)]);
  fixture.cleanup();
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
