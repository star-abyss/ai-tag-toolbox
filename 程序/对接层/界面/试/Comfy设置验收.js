import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { 临时项目 } from './会话装置.js';

const 本目录 = path.dirname(fileURLToPath(import.meta.url));
const 程序根 = path.resolve(process.argv[2] || path.join(本目录, '../../..'));
const 临时根 = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-comfy-ui-'));
const 数据目录 = path.join(临时根, 'data');
const 源项目 = process.argv[2] ? null : 临时项目();
const 项目根 = 源项目?.root || 程序根;
const 证据目录 = path.resolve(本目录, '../../../../临时/截图');
const 等 = ms => new Promise(resolve => setTimeout(resolve, ms));
const 关闭 = async server => {
  if (!server?.listening) return;
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
};
const 空端口 = async () => {
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await 关闭(probe); return port;
};

function 造节点(id, type, widgets, links = []) {
  return {
    id, type, pos: [id * 120, 100], size: [270, 100], flags: {}, order: id, mode: 0,
    inputs: [...links.map(([name, valueType, link]) => ({ name, type: valueType, link })),
      ...widgets.map(([name]) => ({ name, type: 'STRING', link: null, widget: { name } }))],
    outputs: [], properties: { 'Node name for S&R': type }, widgets_values: widgets.map(([, value]) => value),
  };
}
function 造工作流() {
  const nodes = [
    造节点(4, 'CheckpointLoaderSimple', [['ckpt_name', 'test.safetensors']]),
    造节点(6, 'CLIPTextEncode', [['text', 'initial positive']], [['clip', 'CLIP', 1]]),
    造节点(7, 'CLIPTextEncode', [['text', 'initial negative']], [['clip', 'CLIP', 2]]),
    造节点(5, 'EmptyLatentImage', [['width', 64], ['height', 64], ['batch_size', 1]]),
    造节点(3, 'KSampler', [['seed', 41], ['steps', 3], ['cfg', 4], ['sampler_name', 'euler'], ['scheduler', 'normal'], ['denoise', 1]], [
      ['model', 'MODEL', 3], ['positive', 'CONDITIONING', 4], ['negative', 'CONDITIONING', 5], ['latent_image', 'LATENT', 6],
    ]),
    造节点(8, 'VAEDecode', [], [['samples', 'LATENT', 7], ['vae', 'VAE', 8]]),
    造节点(9, 'SaveImage', [['filename_prefix', 'acceptance']], [['images', 'IMAGE', 9]]),
  ];
  const slots = { 4: [['MODEL', [3]], ['CLIP', [1, 2]], ['VAE', [8]]], 6: [['CONDITIONING', [4]]], 7: [['CONDITIONING', [5]],], 5: [['LATENT', [6]]], 3: [['LATENT', [7]]], 8: [['IMAGE', [9]]], 9: [] };
  for (const node of nodes) node.outputs = (slots[node.id] || []).map(([name, links], i) => ({ name, type: name, links, slot_index: i }));
  return { id: 'comfy-settings-acceptance', revision: 0, last_node_id: 9, last_link_id: 9, nodes, links: [
    [1,4,1,6,0,'CLIP'],[2,4,1,7,0,'CLIP'],[3,4,0,3,0,'MODEL'],[4,6,0,3,1,'CONDITIONING'],
    [5,7,0,3,2,'CONDITIONING'],[6,5,0,3,3,'LATENT'],[7,3,0,8,0,'LATENT'],[8,4,2,8,1,'VAE'],[9,8,0,9,0,'IMAGE'],
  ], groups: [], config: {}, extra: {}, version: 0.4 };
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const 提交A = [], 提交B = [];
let fake, fakeB;
const 造假Comfy = 收到 => http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/system_stats') { res.end(JSON.stringify({ system: { comfyui_version: 'isolated-test' }, devices: [] })); return; }
  if (url.pathname === '/object_info') {
    res.end(JSON.stringify({
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [['test.safetensors']] } } },
      CLIPTextEncode: { input: { required: { text: ['STRING'], clip: ['CLIP'] } } },
      EmptyLatentImage: { input: { required: { width: ['INT', { min: 16, max: 2048 }], height: ['INT', { min: 16, max: 2048 }], batch_size: ['INT', { min: 1, max: 8 }] } } },
      KSampler: { input: { required: { seed: ['INT'], steps: ['INT', { min: 1, max: 100 }], cfg: ['FLOAT'], sampler_name: [['euler']], scheduler: [['normal']], denoise: ['FLOAT'], model: ['MODEL'], positive: ['CONDITIONING'], negative: ['CONDITIONING'], latent_image: ['LATENT'] } } },
      VAEDecode: { input: { required: { samples: ['LATENT'], vae: ['VAE'] } } },
      SaveImage: { input: { required: { images: ['IMAGE'], filename_prefix: ['STRING'] } }, output_node: true },
    })); return;
  }
  if (url.pathname === '/prompt') {
    const prompt = JSON.parse(body).prompt; 收到.push(prompt);
    res.end(JSON.stringify({ prompt_id: String(收到.length) })); return;
  }
  if (url.pathname.startsWith('/history/')) {
    const id = url.pathname.slice('/history/'.length);
    res.end(JSON.stringify({ [id]: { status: { status_str: 'success', completed: true }, outputs: { 9: { images: [{ filename: `generated-${id}.png`, subfolder: '', type: 'output' }] } } } })); return;
  }
  if (url.pathname === '/view') { res.setHeader('Content-Type', 'image/png'); res.end(png); return; }
  res.statusCode = 404; res.end('{}');
});

let 服务模块;
const serviceUrl = pathToFileURL(path.join(程序根, '对接层/界面/服务.js')).href;
服务模块 = await import(serviceUrl);
const { 起 } = 服务模块;
const 这次令牌 = 服务模块.这次启动的令牌;
let 服务;
let base;
let browser;
let socket;
let id = 0;
const pending = new Map();

function cdp(method, params = {}) {
  const commandId = ++id;
  return new Promise((resolve, reject) => { pending.set(commandId, { resolve, reject }); socket.send(JSON.stringify({ id: commandId, method, params })); });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function until(expression, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await 等(100); }
  throw new Error(`页面条件超时：${expression}`);
}
async function startService() {
  服务 = 起({ 端口: 0, 项目根, 数据目录 });
  await new Promise(resolve => 服务.listening ? resolve() : 服务.once('listening', resolve));
  await 服务.宿主.ready;
  base = `http://127.0.0.1:${服务.address().port}`;
}
async function post(route, body = {}) {
  return fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 这次令牌 }, body: JSON.stringify(body) }).then(response => response.json());
}
async function action(module, actionName, parameters = {}) {
  const result = await post('/toolbox/调', { 模块: module, 动作: actionName, 参数: parameters });
  if (result?.ok === false) throw new Error(result.reason || JSON.stringify(result));
  return result;
}
async function screenshot(name) {
  fs.mkdirSync(证据目录, { recursive: true });
  const result = await cdp('Page.captureScreenshot', { format: 'png' });
  const file = path.join(证据目录, name);
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  return file;
}

try {
  fs.mkdirSync(数据目录, { recursive: true });
  fake = 造假Comfy(提交A); await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
  fakeB = 造假Comfy(提交B); await new Promise(resolve => fakeB.listen(0, '127.0.0.1', resolve));
  await startService();
  const fakeBase = `http://127.0.0.1:${fake.address().port}`;
  assert.equal((await post('/toolbox/设置', { 存: { comfyUI地址: fakeBase } })).ok, true);
  await action('comfy', '存工作流', { 图: 造工作流() });
  await action('comfy', '绘图开关', { 启用: true });
  await action('comfy', '生成设置', { 每轮张数: 2, 最多轮数: 4, 自动迭代: true });

  const debugPort = await 空端口();
  const executable = [process.env.PIEL_EDGE, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(value => value && fs.existsSync(value));
  assert.ok(executable, '需要 Edge 或 Chrome 才能跑 Comfy 界面验收');
  browser = spawn(executable, ['--headless=new','--disable-extensions','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${path.join(临时根,'browser')}`,'--window-size=1500,1000','about:blank'], { stdio: 'ignore', windowsHide: true });
  let target;
  for (let i=0;i<120&&!target;i++) { try { target=(await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(row=>row.type==='page'); } catch {} if(!target) await 等(100); }
  assert.ok(target, 'Edge CDP 页面启动');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ socket.addEventListener('open',resolve,{once:true}); socket.addEventListener('error',reject,{once:true}); });
  socket.addEventListener('message', event => { const item=JSON.parse(event.data), call=pending.get(item.id); if(!call)return; pending.delete(item.id); item.error?call.reject(new Error(item.error.message)):call.resolve(item.result); });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Page.navigate',{url:base+'/'});
  await until(`window.App?.ready && window.AppModules?.assistant`);
  await evaluate(`window.App.route('ai');window.App.showAi('talk')`);
  await until(`document.querySelector('#talkComfyOn')&&document.querySelector('#imagesPerRound')&&document.querySelector('#talkConv')`);
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await until(`document.documentElement.clientWidth===1440`);
  const talkControls = await evaluate(`(() => ({
    enable:!!document.querySelector('#talkComfyOn'), count:!!document.querySelector('#imagesPerRound'),
    oldRound:!!document.querySelector('#tabTalk #maxAutoRounds'), oldAuto:!!document.querySelector('#tabTalk #generationAutoRun'),
    oldQuota:!!document.querySelector('#tabTalk #generationRoundStatus'), oldWorkflow:!!document.querySelector('#tabTalk #generationWorkflowName'),
    visible: [...document.querySelectorAll('#talkComfyOn,#imagesPerRound')].every(x=>x.getBoundingClientRect().width>0),
    bar:document.querySelector('.tk-statusline').getBoundingClientRect().toJSON(),
    right:document.querySelector('.tk-statusline').getBoundingClientRect().right,
    viewport:document.documentElement.clientWidth, scrollWidth:document.documentElement.scrollWidth,
    dimensions: (() => {
      const count=document.querySelector('#imagesPerRound'), enable=document.querySelector('#talkComfyOn');
      const generation=count.getBoundingClientRect(), parent=count.closest('.generation-controls').getBoundingClientRect();
      const enableBox=enable.closest('.tk-comfy-module').getBoundingClientRect();
      const style=getComputedStyle(count);
      return {width:generation.width,height:generation.height,right:generation.right,parentRight:parent.right,
        enableWidth:enableBox.width,combined:enableBox.width+parent.width,computedWidth:style.width,computedHeight:style.height};
    })(),
  }))()`);
  assert.equal(talkControls.enable, true); assert.equal(talkControls.count, true);
  assert.equal(talkControls.oldRound || talkControls.oldAuto || talkControls.oldQuota || talkControls.oldWorkflow, false, 'assistant bar contains only its two drawing controls');
  assert.equal(talkControls.visible, true);
  assert.ok(talkControls.dimensions.width<=64&&talkControls.dimensions.height<=36,`每轮数量控件尺寸过大：${JSON.stringify(talkControls.dimensions)}`);
  assert.ok(talkControls.dimensions.right<=talkControls.dimensions.parentRight+0.5,`数量输入框超出外框：${JSON.stringify(talkControls.dimensions)}`);
  assert.ok(talkControls.dimensions.combined<=210,`两个绘图控件合计过宽：${JSON.stringify(talkControls.dimensions)}`);
  assert.ok(talkControls.scrollWidth <= talkControls.viewport, 'assistant has no horizontal overflow at desktop width');
  console.log('1440px 助手控件尺寸：',talkControls.dimensions);
  await screenshot('Comfy设置-助手-1440.png');
  await cdp('Emulation.setDeviceMetricsOverride',{width:960,height:900,deviceScaleFactor:1,mobile:false});
  await until(`document.documentElement.clientWidth===960`);
  const narrow = await evaluate(`(() => {
    const count=document.querySelector('#imagesPerRound'),enable=document.querySelector('#talkComfyOn');
    const generation=count.getBoundingClientRect(),parent=count.closest('.generation-controls').getBoundingClientRect(),enableBox=enable.closest('.tk-comfy-module').getBoundingClientRect();
    const style=getComputedStyle(count);
    return {viewport:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,barWidth:document.querySelector('.tk-statusline').getBoundingClientRect().width,
      dimensions:{width:generation.width,height:generation.height,right:generation.right,parentRight:parent.right,combined:enableBox.width+parent.width,computedWidth:style.width,computedHeight:style.height}};
  })()`);
  assert.ok(narrow.scrollWidth<=narrow.viewport,`助手页 960px 横向溢出：${JSON.stringify(narrow)}`);
  assert.ok(narrow.dimensions.width<=64&&narrow.dimensions.height<=36,`960px 每轮数量控件尺寸过大：${JSON.stringify(narrow.dimensions)}`);
  assert.ok(narrow.dimensions.right<=narrow.dimensions.parentRight+0.5,`960px 数量输入框超出外框：${JSON.stringify(narrow.dimensions)}`);
  assert.ok(narrow.dimensions.combined<=210,`960px 两个绘图控件合计过宽：${JSON.stringify(narrow.dimensions)}`);
  console.log('960px 助手控件尺寸：',narrow.dimensions);
  await screenshot('Comfy设置-助手-960.png');

  await evaluate(`window.App.showAi('comfy')`);
  await until(`document.querySelector('#comfyBase')&&document.querySelector('#comfyParameters')&&document.querySelector('#maxAutoRounds')&&document.querySelector('#generationAutoRun')`);
  const settingsToggle = await evaluate(`(() => {const label=document.querySelector('#comfyOn').closest('.opt'),input=label.querySelector('input'),caption=label.querySelector('span'),style=getComputedStyle(label),a=input.getBoundingClientRect(),b=caption.getBoundingClientRect();return {display:style.display,direction:style.flexDirection,verticalDelta:Math.abs((a.top+a.height/2)-(b.top+b.height/2)),label:label.getBoundingClientRect().toJSON()};})()`);
  assert.ok(settingsToggle.display==='flex'&&settingsToggle.direction==='row'&&settingsToggle.verticalDelta<4,`设置页绘图开关没有排在一行：${JSON.stringify(settingsToggle)}`);
  console.log('设置页开关排布：',settingsToggle);
  await until(`document.querySelector('[data-comfy-node="3"][data-comfy-param="steps"] input')`);
  const controls = {
    steps: '[data-comfy-node="3"][data-comfy-param="steps"] input',
    seed: '[data-comfy-node="3"][data-comfy-param="seed"] input',
    width: '[data-comfy-node="5"][data-comfy-param="width"] input',
  };
  for (const [name, selector, value] of [['steps',controls.steps,'7'],['seed',controls.seed,'1234'],['width',controls.width,'512']]) {
    const changed = await evaluate(`(() => { const c=document.querySelector(${JSON.stringify(selector)}); if(!c)return false; c.value=${JSON.stringify(value)}; c.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
    assert.equal(changed,true,`${name} parameter control exists`);
  }
  await evaluate(`(() => { const c=document.querySelector('#maxAutoRounds');c.value='6';c.dispatchEvent(new Event('change',{bubbles:true}));const a=document.querySelector('#generationAutoRun');a.checked=false;a.dispatchEvent(new Event('change',{bubbles:true}));const n=document.querySelector('#settingsImagesPerRound');n.value='3';n.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  const editedAddress = `http://127.0.0.1:${fakeB.address().port}`;
  await evaluate(`(() => {const c=document.querySelector('#comfyBase');c.value=${JSON.stringify(editedAddress)};c.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until(`AppModules.comfy.getBase()===${JSON.stringify(editedAddress)}`,10000);
  await until(`AppModules.comfy.parameters().then(value=>value.节点?.length>0)`);
  await cdp('Page.reload');
  await until(`window.App?.ready&&window.AppModules?.comfy`);
  await evaluate(`window.App.route('ai');window.App.showAi('comfy')`);
  await until(`document.querySelector('#comfyBase')?.value===${JSON.stringify(editedAddress)}&&document.querySelector('[data-comfy-node="3"][data-comfy-param="steps"] input')?.value==='7'`);
  const persisted = await evaluate(`({
    base:AppModules.comfy.getBase(),
    steps:document.querySelector('[data-comfy-node="3"][data-comfy-param="steps"] input').value,
    seed:document.querySelector('[data-comfy-node="3"][data-comfy-param="seed"] input').value,
    width:document.querySelector('[data-comfy-node="5"][data-comfy-param="width"] input').value,
    maxRounds:document.querySelector('#maxAutoRounds').value,
    auto:document.querySelector('#generationAutoRun').checked,
    images:document.querySelector('#settingsImagesPerRound').value,
  })`);
  assert.deepEqual(persisted,{base:editedAddress,steps:'7',seed:'1234',width:'512',maxRounds:'6',auto:false,images:'3'});
  const ss = await screenshot('Comfy设置-节点参数.png');
  console.log(`✓ 助手两控件精简、1440/960 无横溢；参数设置与地址刷新后保持。截图 ${ss}`);

  await action('comfy','出图',{正向:'isolated acceptance prompt'});
  assert.equal(提交A.length,0,'旧 Comfy 地址未收到生成请求');
  assert.equal(提交B.length,1,'生成应发送到 UI 设置的新地址');
  assert.equal(提交B[0]['3']?.inputs?.steps,7,'fake /prompt receives edited sampler steps');
  assert.equal(提交B[0]['3']?.inputs?.seed,1234,'fake /prompt receives edited sampler seed');
  assert.equal(提交B[0]['5']?.inputs?.width,512,'fake /prompt receives edited latent width');
  console.log('✓ fake Comfy /prompt 收到界面修改后的 steps、seed、width');

  await 服务.停止(); 服务=null;
  await startService();
  assert.equal((await post('/toolbox/设置')).data.comfyUI地址,editedAddress,'connection address survives service restart');
  const afterRestart = await action('comfy','参数');
  const sampler = afterRestart.节点.find(group=>group.编号==='3');
  const latent = afterRestart.节点.find(group=>group.编号==='5');
  assert.equal(sampler.参数.find(row=>row.名称==='steps').值,7);
  assert.equal(sampler.参数.find(row=>row.名称==='seed').值,1234);
  assert.equal(latent.参数.find(row=>row.名称==='width').值,512);
  console.log('✓ 地址和节点参数在服务重启后仍保持');
} finally {
  socket?.close();
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    const escaped = path.join(临时根,'browser').replace(/'/g,"''");
    spawnSync('powershell.exe',['-NoProfile','-Command',`$needle='${escaped}';Get-CimInstance Win32_Process|Where-Object{$_.CommandLine -and $_.CommandLine.Contains($needle)}|ForEach-Object{Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}`],{stdio:'ignore',windowsHide:true});
    const exited = new Promise(resolve => browser.once('exit', resolve));
    browser.kill();
    await Promise.race([exited,等(2000)]);
  }
  await 服务?.停止();
  await 关闭(fake);
  await 关闭(fakeB);
  源项目?.cleanup();
  fs.rmSync(临时根,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
