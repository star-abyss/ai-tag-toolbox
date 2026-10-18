import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { 起 } from '../服务.js';
import { 临时项目 } from './会话装置.js';

const external = process.argv[2];
const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../临时/翻译修复');
fs.mkdirSync(folder, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-translation-browser-'));
const fixture = external ? null : 临时项目();
const providerRequests = [];
const provider = http.createServer(async (req, res) => {
  let raw = ''; for await (const part of req) raw += part;
  const body = JSON.parse(raw); providerRequests.push(body);
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ opalunicorn: '宝石', testword: '测试词', 猫坐在垫子上: 'a cat sits on the mat' }) }, finish_reason: 'stop' }] }));
});
let server;
if (!external) {
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  server = 起({ 端口: 0, 项目根: fixture.root, 数据目录: path.join(temp, 'data') });
  await new Promise(resolve => server.once('listening', resolve));
  server.宿主.服务商.写链路([{ id: 'fake', 名字: '验收模型', 地址: `http://127.0.0.1:${provider.address().port}/v1`, 模型: 'translation-test' }]);
}
const base = external || `http://127.0.0.1:${server.address().port}/`;
const probe = net.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`,
  `--user-data-dir=${path.join(temp, 'browser')}`, '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws, seq = 0;
const pending = new Map(), exceptions = [], passed = [];
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
async function until(expression, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(80); }
  throw new Error(`页面条件超时：${expression}; ${JSON.stringify(await evaluate(`({status:document.querySelector('#translateStatus')?.textContent,output:document.querySelector('#translateOutput')?.value})`))}`);
}
const output = () => evaluate(`document.querySelector('#translateOutput').value`);
async function edit(text) {
  await evaluate(`(()=>{const input=document.querySelector('#translateInput');input.focus();input.setSelectionRange(0,input.value.length)})()`);
  await call('Input.insertText', { text });
}
async function paste(text) {
  await evaluate(`document.querySelector('#translateClear').click()`);
  await edit(text);
  await until(`document.querySelector('#translateOutput').value.length > 0 && !document.querySelector('#translateAlignedOutput').hidden`);
}
async function hover(selector, index, sourceExpected, targetExpected) {
  const position = await evaluate(`(()=>{const node=document.querySelectorAll(${JSON.stringify(selector)})[${index}];node.scrollIntoView({block:'nearest'});const range=document.createRange();range.selectNodeContents(node);const r=range.getClientRects()[0];return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position });
  const active = await evaluate(`({source:[...document.querySelectorAll('#translateSourceMirror .active')].map(x=>x.textContent),target:[...document.querySelectorAll('#translateAlignedOutput .active')].map(x=>x.textContent)})`);
  assert.deepEqual(active, { source: [sourceExpected], target: [targetExpected] });
}
async function screenshot(name) {
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(folder, name), Buffer.from(shot.data, 'base64'));
}
function pass(name) { passed.push(name); console.log('通过：' + name); }
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(row => row.type === 'page'); } catch {}
    if (!target) await sleep(100);
  }
  assert.ok(target);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data), item = pending.get(result.id);
    if (item) { pending.delete(result.id); result.error ? item.reject(new Error(result.error.message)) : item.resolve(result.result); }
    if (result.method === 'Runtime.exceptionThrown') exceptions.push(result.params.exceptionDetails.exception?.description || result.params.exceptionDetails.text);
  });
  await call('Page.enable'); await call('Runtime.enable');
  await call('Page.navigate', { url: base });
  await until(`window.App?.catalogStatus() === 'ready'`);
  await evaluate(`document.querySelector('#translateBtn').click()`);
  await until(`Boolean(window.TranslationWorkspace && window.AppViews?.translation && !document.querySelector('#translateView').hidden)`);
  await evaluate(`window.__copied=[];navigator.clipboard.writeText=async value=>window.__copied.push(value)`);

  await paste('1girl, solo, long hair, blue eyes, smile');
  assert.equal(await output(), '1个女孩, 单人, 长发, 蓝眼, 微笑');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#translateRetry')).display`), 'none');
  await hover('#translateSourceMirror span[data-source-id]', 2, 'long hair', '长发');
  await hover('#translateAlignedOutput span[role=button]', 2, 'long hair', '长发');
  pass('A01/A02 原生输入与双向真实鼠标高亮');

  await paste('(1girl:1.2), solo');
  assert.equal(await output(), '(1个女孩:1.2), 单人');
  await hover('#translateSourceMirror span[data-source-id]', 0, '(1girl:1.2)', '(1个女孩:1.2)');
  await hover('#translateAlignedOutput span[role=button]', 0, '(1girl:1.2)', '(1个女孩:1.2)');
  await screenshot('翻译-权重对照.png');
  pass('A03 权重壳双向高亮');

  await paste('long hair, long hair, solo');
  await hover('#translateSourceMirror span[data-source-id]', 1, 'long hair', '长发');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#translateSourceMirror .active')].map(x=>x.dataset.sourceId)`), ['u2']);
  pass('A04 重复词仅当前项高亮');
  await paste('  （1girl:1.2），\nsolo,,solo  ');
  assert.equal(await output(), '  （1个女孩:1.2），\n单人,,单人  ');
  await evaluate(`document.querySelector('#translateCopy').click()`);
  await until(`window.__copied.length>0`);
  assert.equal(await evaluate(`window.__copied.at(-1)`), await output());
  pass('A05/A06 空项全角换行与复制保持');

  await paste('a cat sits on the mat');
  assert.match(await output(), /猫/); assert.match(await output(), /垫子/);
  const sentence = await output();
  await hover('#translateSourceMirror span[data-source-id]', 0, 'a cat sits on the mat', sentence);
  await hover('#translateAlignedOutput span[role=button]', 0, 'a cat sits on the mat', sentence);
  assert.equal(await evaluate(`document.querySelectorAll('#translateSourceMirror span[data-source-id]').length`), 1);
  pass('A07 本地模型句子整句对应');
  await paste('a serene mountain lake at sunrise, mist over the water, photorealistic');
  assert.equal(await evaluate(`document.querySelectorAll('#translateAlignedOutput span[role=button]').length`), 3);
  pass('A08 词库与真实模型混用的对应关系');
  await paste('girl with 红色头发');
  assert.match(await output(), /红色头发/); assert.ok((await output()).length < 100);
  assert.match(await evaluate(`document.querySelector('#translateAlignmentHint').textContent`), /片段/);
  pass('A09 中英混合片段翻译与可见说明');
  await evaluate(`document.querySelector('#translateDirection').value='zh-en';document.querySelector('#translateDirection').dispatchEvent(new Event('change'))`);
  await paste('猫坐在垫子上');
  assert.match(await output(), /cat/i); assert.match(await output(), /mat/i);
  pass('A10 中译英真实模型');
  await paste('already English'); assert.equal(await output(), 'already English');
  await evaluate(`document.querySelector('#translateDirection').value='en-zh';document.querySelector('#translateDirection').dispatchEvent(new Event('change'))`);
  await paste('已经是中文'); assert.equal(await output(), '已经是中文');
  pass('A11 已有目标语言保留');
  await paste(Array(270).fill('solo').join(', '));
  assert.equal(await evaluate(`document.querySelectorAll('#translateAlignedOutput span[role=button]').length`), 270);
  await evaluate(`(()=>{const input=document.querySelector('#translateInput');input.scrollTop=input.scrollHeight;input.dispatchEvent(new Event('scroll'));const target=document.querySelector('#translateAlignedOutput');target.scrollTop=target.scrollHeight})()`);
  await hover('#translateSourceMirror span[data-source-id]', 269, 'solo', '单人');
  await call('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(100);
  await evaluate(`(()=>{const input=document.querySelector('#translateInput');input.scrollTop=input.scrollHeight;input.dispatchEvent(new Event('scroll'))})()`);
  await hover('#translateSourceMirror span[data-source-id]', 269, 'solo', '单人');
  pass('A17/A18 270项末项滚动缩放命中');

  await paste('🙂, solo, blue eyes');
  assert.equal(await output(), '🙂, 单人, 蓝眼');
  await hover('#translateSourceMirror span[data-source-id]', 1, 'solo', '单人');
  await evaluate(`document.querySelector('#translateAlignedOutput span[role=button]').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('#translateSourceMirror .pinned').length`), 1);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  assert.equal(await evaluate(`document.querySelectorAll('#translateSourceMirror .active').length`), 0);
  await evaluate(`(()=>{const input=document.querySelector('#translateInput');input.focus();input.setSelectionRange(0,input.value.length);input.dispatchEvent(new Event('select'))})()`);
  assert.equal(await evaluate(`document.querySelectorAll('#translateAlignedOutput .active').length`), 3);
  pass('A17 emoji范围、点击固定、多项选择与Esc');

  if (!external) {
    await paste('opalunicorn, testword');
    await evaluate(`document.querySelector('#translateAi').click()`);
    await until(`document.querySelector('#translateOutput').value==='宝石, 测试词'`);
    await hover('#translateAlignedOutput span[role=button]', 0, 'opalunicorn', '宝石');
    assert.ok(providerRequests.length);
    pass('A19 AI按钮真实HTTP装订与对照');
  }

  await evaluate(`window.__realRun=AppModules.runtime.runAiTask;window.__calls=[];window.__receipt=text=>({ok:true,data:{原文:text,译文:'译:'+text,方向:'en-zh',表:[{标识:'u1',原文范围:[0,text.length],译文范围:[0,text.length+2]}],统计:{模型译出:1}}});AppModules.runtime.runAiTask=async(_name,payload)=>{const text=payload.input.text;window.__calls.push(text);if(text==='A')return new Promise(resolve=>window.__release=()=>resolve(window.__receipt(text)));return window.__receipt(text)}`);
  await evaluate(`document.querySelector('#translateClear').click()`);
  await edit('A'); await until(`window.__calls.length===1`);
  await edit('B'); await sleep(550); await edit('C'); await sleep(550);
  assert.deepEqual(await evaluate(`window.__calls`), ['A']);
  await evaluate(`window.__release()`); await until(`document.querySelector('#translateOutput').value==='译:C'`);
  assert.deepEqual(await evaluate(`window.__calls`), ['A', 'C']);
  pass('A12 连续输入仅执行当前任务与最新快照');

  await evaluate(`window.__calls=[];window.__releaseDirection=null;AppModules.runtime.runAiTask=async(_name,payload)=>{window.__calls.push(payload.input.direction);if(window.__calls.length===1)return new Promise(resolve=>window.__releaseDirection=()=>resolve(window.__receipt(payload.input.text)));const result=window.__receipt(payload.input.text);result.data.方向=payload.input.direction;return result}`);
  await evaluate(`document.querySelector('#translateClear').click()`); await edit('direction');
  await until(`window.__releaseDirection!==null`);
  await evaluate(`document.querySelector('#translateDirection').value='zh-en';document.querySelector('#translateDirection').dispatchEvent(new Event('change'))`);
  await sleep(550); await evaluate(`window.__releaseDirection()`);
  await until(`document.querySelector('#translateOutput').value==='译:direction'`);
  assert.deepEqual(await evaluate(`window.__calls`), ['en-zh', 'zh-en']);
  assert.match(await evaluate(`document.querySelector('#translateMeta').textContent`), /中文.*English/);
  pass('A13 翻译期间切方向采用最新快照');

  await evaluate(`window.__attempt=0;AppModules.runtime.runAiTask=async(_name,payload)=>++window.__attempt===1?{ok:false,error:{message:'TEXT_LOCAL_BUSY: 测试忙碌'}}:new Promise(resolve=>window.__retryRelease=()=>resolve(window.__receipt(payload.input.text)))`);
  await evaluate(`document.querySelector('#translateClear').click()`); await edit('retry');
  await until(`!document.querySelector('#translateRetry').hidden`);
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('#translateRetry')).display`), 'none');
  assert.match(await evaluate(`document.querySelector('#translateStatus').textContent`), /TEXT_LOCAL_BUSY/);
  await evaluate(`document.querySelector('#translateRetry').click()`);
  assert.equal(await evaluate(`document.querySelector('#translateStatus').classList.contains('error')`), false);
  await evaluate(`window.__retryRelease()`);
  await until(`document.querySelector('#translateOutput').value==='译:retry'`);
  assert.equal(await evaluate(`window.__attempt`), 2);
  pass('A15 忙碌失败可重试且不缓存');

  await evaluate(`AppModules.runtime.runAiTask=async()=>new Promise(resolve=>window.__late=()=>resolve(window.__receipt('late')))`);
  await evaluate(`document.querySelector('#translateClear').click()`); await edit('late');
  await until(`typeof window.__late==='function'`);
  await evaluate(`document.querySelector('#translateClear').click();window.__late()`);
  await sleep(100); assert.equal(await output(), '');
  pass('A14 清空后旧响应不回填');

  await evaluate(`window.__late=null`); await edit('late');
  await until(`typeof window.__late==='function'`);
  await evaluate(`document.querySelector('#translateBtn').click()`);
  await until(`document.querySelector('#translateView').hidden`);
  await evaluate(`window.__late()`); await sleep(100);
  await evaluate(`document.querySelector('#translateBtn').click()`);
  await until(`!document.querySelector('#translateView').hidden`);
  assert.equal(await output(), '');
  assert.doesNotMatch(await evaluate(`document.querySelector('#translateStatus').textContent`), /翻译中/);
  pass('A14 离开返回丢弃旧响应并释放执行');
  await evaluate(`AppModules.runtime.runAiTask=window.__realRun`);
  await evaluate(`document.querySelector('#translateDirection').value='en-zh';document.querySelector('#translateDirection').dispatchEvent(new Event('change'))`);
  assert.deepEqual(exceptions, []);
  await paste('(1girl:1.2), solo');
  await hover('#translateAlignedOutput span[role=button]', 0, '(1girl:1.2)', '(1个女孩:1.2)');
  await screenshot(external ? '翻译-交付版.png' : '翻译-界面验收.png');
  fs.writeFileSync(path.join(folder, external ? '交付浏览器验收.json' : '浏览器验收.json'), JSON.stringify({ base, passed, exceptions }, null, 2));
  console.log(`翻译真浏览器 ${passed.length} 组检查通过`);
} finally {
  ws?.close(); browser.kill();
  if (server) await server.停止();
  if (provider.listening) { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); }
  fixture?.cleanup();
}
