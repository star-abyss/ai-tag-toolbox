import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { crc32 } from 'node:zlib';
import { 起, 这次启动的令牌 } from '../服务.js';
import { 造服务商面 } from '../服务商.js';
import { 造文件存档 } from '../../存档.js';
import { 临时项目 } from './会话装置.js';

const require = createRequire(import.meta.url);
const { createComfyModule } = require('../../../comfyUI模块/index.js');
const fixture = 临时项目();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-generated-images-'));
const graph = {
  '1': { class_type: 'CLIPTextEncode', inputs: { text: 'test prompt' } },
  '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'toggle' } },
};
let online = false;
const submitted = [];
const modelRequests = [];
const sharp = require('sharp');
const originalPng = await sharp({create:{width:768,height:512,channels:3,background:'#5c7caa'}}).png().toBuffer();
const textData = Buffer.from('parameters\0embedded landscape, blue sky\nNegative prompt: blurry, watermark\nSteps: 20, Sampler: Euler');
const chunkType = Buffer.from('tEXt'), chunkSize=Buffer.alloc(4), checksum=Buffer.alloc(4);
chunkSize.writeUInt32BE(textData.length); checksum.writeUInt32BE(crc32(Buffer.concat([chunkType,textData])));
const generatedPng=Buffer.concat([originalPng.subarray(0,-12),chunkSize,chunkType,textData,checksum,originalPng.subarray(-12)]);
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
    res.statusCode = online ? 200 : 503;
    res.end(JSON.stringify(online ? { system: { comfyui_version: 'test' }, devices: [{ name: 'test device' }] } : { error: 'offline' }));
  } else if (req.url === '/object_info') {
    res.end(JSON.stringify({ CLIPTextEncode: { input: { required: { text: ['STRING'] } } }, SaveImage: { output_node: true } }));
  } else if (req.url === '/prompt') {
    submitted.push(JSON.parse(raw));
    res.end(JSON.stringify({ prompt_id: String(submitted.length) }));
  } else if (req.url.startsWith('/history/')) {
    const id = req.url.slice('/history/'.length);
    res.end(JSON.stringify({ [id]: { status: { status_str: 'success', completed: true }, outputs: { '2': { images: [{ filename: 'generated.png', subfolder: '', type: 'output' }] } } } }));
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
  if (body.max_tokens !== 1) modelRequests.push(body);
  const lastUser = body.messages.findLastIndex(message => message.role === 'user' && (typeof message.content==='string' ? message.content : message.content.map(part=>part.text||'').join('')).startsWith('生成第'));
  const returned = body.messages.slice(lastUser + 1).findLast(message => message.role === 'tool');
  const message = returned
    ? { role: 'assistant', content: '调用已结束' }
    : { role: 'assistant', content: null, tool_calls: [{ id: 'drawing', type: 'function', function: { name: 'drawing_generate', arguments: '{"正向":"test prompt"}' } }] };
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message, finish_reason: returned ? 'stop' : 'tool_calls' }] }));
});
await Promise.all([listen(upstream), listen(provider)]);
造服务商面({ 目录: temporary }).写链路([{ id: 'test', 名字: '测试', 地址: `http://127.0.0.1:${provider.address().port}/v1`, 模型: 'test' }]);
let server;
let base;
async function start(port = 0) {
  server = 起({ 端口: port, 项目根: fixture.root, 数据目录: temporary });
  await new Promise(resolve => server.once('listening', resolve));
  const store = 造文件存档(path.resolve(fixture.root, server.宿主.配置.comfyUI工作流存档));
  server.宿主.门面.comfy = createComfyModule({
    地址: `http://127.0.0.1:${upstream.address().port}`,
    存档: store,
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
  console.log('超时页面状态：', await evaluate(`({settings:AppModules.assistant.getSettings().comfyOn,talk:document.querySelector('#talkComfyOn')?.checked,config:document.querySelector('#comfyOn')?.checked,status:document.querySelector('#comfyStatus')?.textContent,toast:document.querySelector('#toast')?.textContent})`));
  throw new Error('页面条件未满足：' + expression);
}
async function navigate() {
  await call('Page.navigate', { url: base + '/' });
  await until(`window.App?.catalogStatus() === 'ready' && window.AppModules?.assistant.currentId()`);
  await evaluate(`document.querySelector('#aiBtn').click(); document.querySelector('.ai-module-tab[data-panel="talk"]').click()`);
  await until(`document.querySelector('#talkComfyOn').getBoundingClientRect().height > 0`);
}
async function openBrowser() {
  const probe = net.createServer();
  await listen(probe);
  const debugPort = probe.address().port;
  await close(probe);
  const executable = [process.env.PIEL_EDGE, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(value => value && fs.existsSync(value));
  assert.ok(executable, '需要 Edge 或 Chrome');
  browser = spawn(executable, ['--headless=new', '--disable-extensions', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(temporary, 'browser')}`, '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore', windowsHide: true });
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

try {
  await start(); online = true;
  await post('comfy', '存工作流', {图:graph});
  await post('comfy', '绘图开关', {启用:true});
  await openBrowser();
  for (let round = 1; round <= 2; round++) {
    const id=await evaluate('AppModules.assistant.currentId()');const sent = await post('session','发',{会话:id,内容:[{type:'text',text:'生成第'+round+'张'}]});
    assert.notEqual(sent.ok, false, JSON.stringify(sent));
    await until(`!AppModules.assistant.snapshot().busy && document.querySelectorAll('#talkConv .dsh-image').length===${round}`);
    await until(`[...document.querySelectorAll('#talkConv .dsh-image')].every(img=>img.complete&&img.naturalWidth>0&&getComputedStyle(img).opacity==='1')`);
    assert.equal(await evaluate(`document.querySelectorAll('#talkImageRepository .conversation-image-card').length`), round, '新图自动进入会话图片区，无需删除旧图');
    console.log('通过：连续生成第'+round+'张图立即显示，旧图仍保留');
    await until(`document.querySelectorAll('#talkConv .dsh-image-tags').length===${round} && [...document.querySelectorAll('#talkConv .dsh-image-tags')].every(el=>el.textContent.includes('embedded landscape, blue sky')&&el.textContent.includes('blurry, watermark'))`);
    assert.equal(await evaluate(`[...document.querySelectorAll('#talkConv .dsh-image-tags')].some(el=>el.textContent.includes('test prompt'))`),false,'展示内置元数据，不能拿提交提示词代替');

  }
  assert.equal(modelRequests.length,4,'两轮绘图各两次模型请求，读取 Tag 不调用模型');
  const layout=await evaluate(`(()=>{const card=document.querySelector('#talkConv .dsh-image-card'),img=card.querySelector('.dsh-image-frame').getBoundingClientRect(),tags=card.querySelector('.dsh-image-tags').getBoundingClientRect();return {right:tags.left>=img.right-1,overflow:card.scrollWidth>card.clientWidth}})()`);
  assert.deepEqual(layout,{right:true,overflow:false},'图片与 Tag 同框，宽屏时 Tag 在图片右侧');
  const evidence=path.resolve('临时/生成图展示'); fs.mkdirSync(evidence,{recursive:true});
  await evaluate(`document.querySelector('#talkConv .dsh-image-card').scrollIntoView({block:'center'})`);
  fs.writeFileSync(path.join(evidence,'图片与内置Tag.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:560,height:900,deviceScaleFactor:1,mobile:false});
  assert.equal(await evaluate(`[...document.querySelectorAll('#talkConv .dsh-image-card')].every(el=>el.scrollWidth<=el.clientWidth)`),true,'窄屏同框换行，无横向溢出');
  await call('Emulation.clearDeviceMetricsOverride');
  await call('Page.reload'); await until(`window.App?.catalogStatus()==='ready'&&AppModules.assistant.currentId()`);
  await evaluate(`document.querySelector('#aiBtn').click();document.querySelector('.ai-module-tab[data-panel="talk"]').click()`);
  await until(`document.querySelectorAll('#talkConv .dsh-image-tags').length===2&&[...document.querySelectorAll('#talkConv .dsh-image-tags')].every(el=>el.textContent.includes('embedded landscape'))`);
  assert.equal(modelRequests.length,4,'历史图片重载读取内置 Tag 不调用模型');
  console.log('通过：内置正负 Tag、右侧同框、窄屏布局、历史重载，均不额外调用 AI');
} finally {
  ws?.close(); browser?.kill(); await server?.停止();
  await Promise.all([close(upstream),close(provider)]); fixture.cleanup();
}
