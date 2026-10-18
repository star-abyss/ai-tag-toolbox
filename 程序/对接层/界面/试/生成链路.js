import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { 起, 这次启动的令牌 } from '../服务.js';
import { 造服务商面 } from '../服务商.js';
import { 造文件存档 } from '../../存档.js';
import { 临时项目 } from './会话装置.js';

// HTTP + browser acceptance for generation settings, actual Comfy batch input,
// per-user-message round limits, and the visible controls. All external APIs
// are local fakes; the script never submits to a real ComfyUI or model provider.
const 本目录 = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { createComfyModule } = require('../../../comfyUI模块/index.js');
const fixture = 临时项目();
const 临时 = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-generation-acceptance-'));
const 证据 = path.resolve(本目录, '../../../../临时/生成迭代实现/验收证据');
const 等 = ms => new Promise(resolve => setTimeout(resolve, ms));
const 监听 = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const 关闭 = async server => {
  if (!server?.listening) return;
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
};
const 取空端口 = async () => {
  const probe = net.createServer(); await 监听(probe); const port = probe.address().port; await 关闭(probe); return port;
};

function 造节点(id, type, widgets, links = []) {
  return {
    id, type, pos: [id * 100, 100], size: [270, 100], flags: {}, order: id, mode: 0,
    inputs: [...links.map(([name, valueType, link]) => ({ name, type: valueType, link })),
      ...widgets.map(([name]) => ({ name, type: 'STRING', link: null, widget: { name } }))],
    outputs: [], properties: { 'Node name for S&R': type }, widgets_values: widgets.map(([, value]) => value),
  };
}
function 造工作流() {
  const nodes = [
    造节点(4, 'CheckpointLoaderSimple', [['ckpt_name', 'test.safetensors']]),
    造节点(6, 'CLIPTextEncode', [['text', 'old prompt']], [['clip', 'CLIP', 1]]),
    造节点(7, 'CLIPTextEncode', [['text', 'old negative']], [['clip', 'CLIP', 2]]),
    造节点(5, 'EmptyLatentImage', [['width', 64], ['height', 64], ['batch_size', 1]]),
    造节点(3, 'KSampler', [['seed', 1], ['steps', 1], ['cfg', 1], ['sampler_name', 'euler'], ['scheduler', 'normal'], ['denoise', 1]], [
      ['model', 'MODEL', 3], ['positive', 'CONDITIONING', 4], ['negative', 'CONDITIONING', 5], ['latent_image', 'LATENT', 6],
    ]),
    造节点(8, 'VAEDecode', [], [['samples', 'LATENT', 7], ['vae', 'VAE', 8]]),
    造节点(9, 'SaveImage', [['filename_prefix', 'acceptance']], [['images', 'IMAGE', 9]]),
  ];
  const slots = { 4: [['MODEL', [3]], ['CLIP', [1, 2]], ['VAE', [8]]], 6: [['CONDITIONING', [4]],], 7: [['CONDITIONING', [5]],], 5: [['LATENT', [6]],], 3: [['LATENT', [7]],], 8: [['IMAGE', [9]],], 9: [] };
  for (const node of nodes) node.outputs = (slots[node.id] || []).map(([name, links], i) => ({ name, type: name, links, slot_index: i }));
  return { id: 'generation-acceptance', revision: 0, last_node_id: 9, last_link_id: 9, nodes, links: [
    [1,4,1,6,0,'CLIP'],[2,4,1,7,0,'CLIP'],[3,4,0,3,0,'MODEL'],[4,6,0,3,1,'CONDITIONING'],
    [5,7,0,3,2,'CONDITIONING'],[6,5,0,3,3,'LATENT'],[7,3,0,8,0,'LATENT'],[8,4,2,8,1,'VAE'],[9,8,0,9,0,'IMAGE'],
  ], groups: [], config: {}, extra: {}, version: 0.4 };
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const submits = [];
const held = [];
let holdHistory = false;
let providerMode = 'early-stop';
const providerTurns = new Map();
const modelRequests = [];
const comfy = http.createServer(async (req, res) => {
  const body = []; for await (const chunk of req) body.push(chunk);
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/system_stats') { res.end(JSON.stringify({ system: { comfyui_version: 'fake' }, devices: [] })); return; }
  if (url.pathname === '/object_info') {
    res.end(JSON.stringify({
      CheckpointLoaderSimple: { input: { required: { ckpt_name: ['STRING'] } } },
      CLIPTextEncode: { input: { required: { text: ['STRING'], clip: ['CLIP'] } } },
      EmptyLatentImage: { input: { required: { width: ['INT'], height: ['INT'], batch_size: ['INT', { min: 1 }] } } },
      KSampler: { input: { required: { seed: ['INT'], steps: ['INT'], cfg: ['FLOAT'], sampler_name: [['euler']], scheduler: [['normal']], denoise: ['FLOAT'], model: ['MODEL'], positive: ['CONDITIONING'], negative: ['CONDITIONING'], latent_image: ['LATENT'] } } },
      VAEDecode: { input: { required: { samples: ['LATENT'], vae: ['VAE'] } } },
      SaveImage: { input: { required: { images: ['IMAGE'], filename_prefix: ['STRING'] } }, output_node: true },
    })); return;
  }
  if (url.pathname === '/prompt') {
    const prompt = JSON.parse(Buffer.concat(body).toString()).prompt;
    submits.push({ prompt, batch: prompt['5']?.inputs?.batch_size });
    res.end(JSON.stringify({ prompt_id: String(submits.length) })); return;
  }
  if (url.pathname.startsWith('/history/')) {
    if (holdHistory) { held.push(res); return; }
    const id = url.pathname.slice('/history/'.length);
    res.end(JSON.stringify({ [id]: { status: { status_str: 'success', completed: true }, outputs: { '9': { images: Array.from({ length: submits[Number(id)-1]?.batch || 1 }, (_, i) => ({ filename: `generated-${id}-${i}.png`, subfolder: '', type: 'output' })) } } } })); return;
  }
  if (url.pathname === '/view') { res.setHeader('Content-Type', 'image/png'); res.end(png); return; }
  res.statusCode = 404; res.end('{}');
});

const provider = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  modelRequests.push(body);
  const messages = body.messages || [];
  const contentText = row => typeof row?.content === 'string' ? row.content : (row?.content || []).map(part => part.text || '').join(' ');
  const scenarios = ['自动关闭额度仍可回复','三轮含首次','早停','运行中修改设置','下次发送新设置','显示轮数状态'];
  const userIndex = messages.map((row, i) => ({ row, i })).filter(item => item.row.role === 'user')
    .findLast(item => scenarios.some(scenario => contentText(item.row).includes(scenario)))?.i;
  const userText = userIndex === undefined ? contentText([...messages].reverse().find(row => row.role === 'user')) : contentText(messages[userIndex]);
  const key = scenarios.find(scenario => userText.includes(scenario)) || userText;
  let count = providerTurns.get(key) || 0;
  const target = providerMode === 'limit' ? 4 : providerMode === 'three' ? 3 : providerMode === 'one' ? 1 : 1;
  const toolsSinceUser = messages.slice((userIndex ?? -1) + 1).filter(row => row.role === 'tool').length;
  count = Math.max(count, toolsSinceUser);
  const shouldDraw = count < target;
  if (shouldDraw) providerTurns.set(key, count + 1);
  const message = shouldDraw
    ? { role: 'assistant', content: null, tool_calls: [{ id: `draw-${count+1}`, type: 'function', function: { name: 'drawing_generate', arguments: JSON.stringify({ 正向: `acceptance ${count+1}` }) } }] }
    : { role: 'assistant', content: `完成：${userText}` };
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message, finish_reason: shouldDraw ? 'tool_calls' : 'stop' }] }));
});

await Promise.all([监听(comfy), 监听(provider)]);
const dataDir = path.join(临时, 'data'); fs.mkdirSync(dataDir, { recursive: true });
造服务商面({ 目录: path.join(dataDir, 'API') }).写链路([{ id: 'test', 名字: '本地假服务商', 地址: `http://127.0.0.1:${provider.address().port}/v1`, 模型: 'test' }]);
let server, base, browser, ws, nextId = 0;
const pending = new Map();
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function until(expression, timeout = 20000) {
  const stop = Date.now() + timeout;
  while (Date.now() < stop) { if (await evaluate(expression)) return; await 等(100); }
  if (expression.includes('maxAutoRounds===4')) console.log('界面设置诊断：', await evaluate(`({ settings:AppModules.assistant.getSettings(), caps:AppModules.assistant.getCapabilities().comfy, value:document.querySelector('#maxAutoRounds')?.value, disabled:document.querySelector('#maxAutoRounds')?.disabled, notice:document.querySelector('#generationBatchNotice')?.textContent, status:document.querySelector('#comfyStatus')?.textContent })`));
  throw new Error(`等待页面条件超时：${expression}`);
}
async function start() {
  server = 起({ 端口: 0, 项目根: fixture.root, 数据目录: dataDir });
  await new Promise(resolve => server.once('listening', resolve));
  const comfyStore = 造文件存档(path.resolve(fixture.root, server.宿主.配置.comfyUI工作流存档));
  server.宿主.门面.comfy = createComfyModule({ 地址: `http://127.0.0.1:${comfy.address().port}`, 存档: comfyStore, 等待: async () => {} });
  base = `http://127.0.0.1:${server.address().port}`;
  const ai = server.宿主.门面.主AI;
  let created = ai.run('预设', { 动作: '新建', 请求: '主AI', 名字: '生成验收', 一套: { name: '生成验收', model: { 走: 'test', 模型: 'test' } } });
  if (!created.ok) throw new Error(created.reason);
  const preset = created.data.标识;
  for (const action of ['drawing_info', 'drawing_generate']) {
    const row = ai.run('读', { 预设: preset }).data?.预设?.工具表?.find(item => item.名字 === action);
    if (row?.启用 === false) ai.run('工具', { 动作: '加', 预设: preset, 名字: action });
  }
  const modelRow = ai.run('预设', { 动作: '换', 请求: '主AI', 启用: [preset] });
  if (!modelRow.ok) throw new Error(modelRow.reason);
  const save = ai.run('存'); if (!save.ok) throw new Error(save.reason);
}
async function httpAction(module, action, parameters = {}) {
  const response = await fetch(`${base}/toolbox/调`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 这次启动的令牌 }, body: JSON.stringify({ 模块: module, 动作: action, 参数: parameters }) });
  const result = await response.json();
  if (result?.ok === false) throw new Error(result.reason || JSON.stringify(result));
  return result;
}
async function setGeneration(settings) { return httpAction('comfy', '生成设置', settings); }
async function waitIdle(sessionId) {
  const stop = Date.now() + 30000;
  while (Date.now() < stop) {
    const result = await httpAction('session', '读', { 会话: sessionId });
    if (result.会话?.运行状态 === '空闲' || result.运行状态 === '空闲') return result.会话 || result;
    await 等(100);
  }
  throw new Error('会话执行超过 30 秒');
}
async function send(sessionId, text) {
  const result = await httpAction('session', '发', { 会话: sessionId, 内容: [{ type: 'text', text }] });
  return result;
}
async function openBrowser() {
  const debugPort = await 取空端口();
  const executable = [process.env.PIEL_EDGE, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(value => value && fs.existsSync(value));
  assert.ok(executable, '找不到 Edge 或 Chrome；可设置 PIEL_EDGE');
  browser = spawn(executable, ['--headless=new','--disable-extensions','--disable-gpu','--no-first-run',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${path.join(临时,'browser')}`,'--window-size=1500,1000','about:blank'], { stdio: 'ignore', windowsHide: true });
  let target;
  for (let i=0;i<100&&!target;i++) { try { target=(await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(row=>row.type==='page'); } catch {} if(!target) await 等(100); }
  assert.ok(target, 'Edge CDP page appeared');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ ws.addEventListener('open',resolve,{once:true}); ws.addEventListener('error',reject,{once:true}); });
  ws.addEventListener('message',event=>{ const item=JSON.parse(event.data), wait=pending.get(item.id); if(!wait)return; pending.delete(item.id); item.error?wait.reject(new Error(item.error.message)):wait.resolve(item.result); });
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Page.navigate',{url:`${base}/`});
  await until(`window.App?.catalogStatus()==='ready'&&window.AppModules?.assistant`);
}
async function sessionId() { return httpAction('session','列').then(value => (value.会话 || [])[0]?.标识); }
function assertBatch(from, count) {
  assert.deepEqual(submits.slice(from).map(row=>row.batch), Array(count).fill(2), 'Comfy POST /prompt must receive batch_size=2 for each generated round');
}
function systemText(request) {
  return [request?.system, ...(request?.messages || []).filter(row => row.role === 'system').map(row => row.content)]
    .filter(value => typeof value === 'string').join('\n');
}

try {
  await start();
  await httpAction('comfy','存工作流',{图:造工作流()});
  await httpAction('comfy','绘图开关',{启用:true});
  await setGeneration({ 每轮张数: 2, 最多轮数: 3, 自动迭代: false });

  await openBrowser();
  await fs.promises.mkdir(证据,{recursive:true});
  await evaluate("App.route('ai');App.showAi('comfy')");
  await until("document.querySelector('#tabComfy').getBoundingClientRect().height>0&&document.querySelector('#maxAutoRounds')");
  await evaluate("document.querySelector('#generationAutoRun').click()");
  await until("AppModules.assistant.getSettings().generationAutoRun===true");
  await evaluate("document.querySelector('#maxAutoRounds').value='4';document.querySelector('#maxAutoRounds').dispatchEvent(new Event('change',{bubbles:true}))");
  await until("AppModules.assistant.getSettings().maxAutoRounds===4");
  await cdp('Page.reload');
  await until("window.App?.catalogStatus()==='ready'&&AppModules?.assistant.getSettings().maxAutoRounds===4");
  await evaluate("App.route('ai');App.showAi('talk')");
  await until("document.querySelector('#imagesPerRound')?.getBoundingClientRect().height>0");
  assert.equal(await evaluate("document.querySelector('#imagesPerRound').value"), '2');
  assert.equal(await evaluate("document.querySelector('#maxAutoRounds').getBoundingClientRect().height"),0,'iteration settings belong to settings page');
  console.log('✓ 设置页迭代控件可操作，刷新恢复，助手只显示绘制数量和开关');
  const withoutBatch=造工作流();
  const latent=withoutBatch.nodes.find(node=>node.type==='EmptyLatentImage');
  latent.inputs=latent.inputs.filter(input=>input.name!=='batch_size');
  latent.widgets_values=latent.widgets_values.slice(0,2);
  await httpAction('comfy','存工作流',{图:withoutBatch});
  await evaluate('AppModules.assistant.refreshCapabilities()');
  await until('AppModules.assistant.getCapabilities().comfy.batchSupported===false');
  await httpAction('comfy','存工作流',{图:造工作流()});
  await evaluate('AppModules.assistant.refreshCapabilities()');
  await until('AppModules.assistant.getCapabilities().comfy.batchSupported===true');
  await setGeneration({每轮张数:2,最多轮数:3,自动迭代:false});

  const id = await sessionId(); assert.ok(id, 'temporary project creates initial session');
  let from = submits.length;
  providerMode='limit'; providerTurns.clear();
  await send(id,'自动关闭额度仍可回复'); await waitIdle(id);
  assertBatch(from,1);
  assert.deepEqual((await httpAction('drawing','状态',{会话:id})).生成状态,
    {每轮张数:2,最多轮数:1,自动迭代:false,已用轮数:1,剩余轮数:0}, '内部用户状态保留最近快照，模型回执不含快照');
  const conversation = await httpAction('session','读',{会话:id});
  const toolCalls = (conversation.会话?.messages || conversation.messages || []).flatMap(message=>message.toolCalls||[]);
  assert.ok(toolCalls.some(call=>call.result?.code==='BUSINESS_GENERATION_LIMIT'),'second and later draws hit the shared one-round quota');
  assert.ok((conversation.会话?.messages || conversation.messages || []).some(message=>message.parts?.some(part=>part.text?.includes('完成：'))),'AI can reply after quota is exhausted');
  console.log('✓ 自动关闭只提交一轮；额度耗尽后仍可回复');

  await setGeneration({ 每轮张数:2, 最多轮数:3, 自动迭代:true });
  from=submits.length; providerMode='three'; providerTurns.clear();
  await send(id,'三轮含首次'); await waitIdle(id); assertBatch(from,3);
  console.log('✓ 自动迭代允许最多三轮，首次计入上限');

  from=submits.length; providerMode='early-stop'; providerTurns.clear();
  await send(id,'早停'); await waitIdle(id); assertBatch(from,1);
  console.log('✓ AI 可提前结束，不要求跑满设置轮数');

  // Hold the first real history request after /prompt. Settings changes during
  // execution are saved immediately but apply to the next user message only.
  await setGeneration({每轮张数:2,最多轮数:3,自动迭代:true});
  holdHistory=true; providerMode='early-stop'; providerTurns.clear();
  await send(id,'运行中修改设置');
  for(let i=0;i<100&&!held.length;i++) await 等(50);
  assert.ok(held.length,'fake Comfy history request is held while generation is in flight');
  const inFlight = await httpAction('drawing','状态',{会话:id});
  assert.equal(inFlight.运行中, true);
  assert.deepEqual(inFlight.生成状态,{每轮张数:2,最多轮数:3,自动迭代:true,已用轮数:1,剩余轮数:2});
  await until(`AppModules.assistant.generationStatus()?.运行中===true&&AppModules.assistant.generationStatus()?.生成状态?.已用轮数===1`);
  const runningShot=await cdp('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(证据,'生成运行中状态.png'),Buffer.from(runningShot.data,'base64'));
  await setGeneration({每轮张数:1,最多轮数:2,自动迭代:true});
  held.splice(0).forEach(response=>response.end(JSON.stringify({[String(submits.length)]:{status:{status_str:'success',completed:true},outputs:{'9':{images:[{filename:'held.png',subfolder:'',type:'output'},{filename:'held2.png',subfolder:'',type:'output'}]}}}})));
  holdHistory=false; await waitIdle(id);
  assert.equal(submits.at(-1).batch,2,'running generation retains the original batch size');
  from=submits.length; providerMode='early-stop'; providerTurns.clear(); await send(id,'下次发送新设置'); await waitIdle(id);
  assert.equal(submits[from]?.batch,1,'next user message reads the new batch count');
  console.log('✓ 运行中改设置下次发送生效；新发送重置轮数');

  assert.ok(modelRequests.length>5,'model receives actual tool round trips');
  for(const request of modelRequests) {
    assert.doesNotMatch(JSON.stringify(request),/生成状态|剩余轮数|最多轮数|每轮张数|generationAutoRun|comfyUI地址|control_after_generate/,'actual model requests omit private generation configuration');
  }
  const preview=await httpAction('prompt','预览',{会话:id});
  assert.doesNotMatch(JSON.stringify({system:preview.系统消息,tools:preview.工具定义,messages:preview.消息}),/生成状态|剩余轮数|最多轮数|每轮张数|comfyUI地址/);
  console.log('✓ 实际模型请求及发送预览不携带生成设置；轮数限制仍实际执行');
} finally {
  for(const response of held) { try{response.destroy();}catch{} }
  ws?.close();
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    const exited = new Promise(resolve => browser.once('exit', resolve));
    browser.kill();
    await exited;
  }
  await server?.停止();
  await Promise.all([关闭(comfy),关闭(provider)]);
  fixture.cleanup();
  fs.rmSync(临时,{recursive:true,force:true});
}
