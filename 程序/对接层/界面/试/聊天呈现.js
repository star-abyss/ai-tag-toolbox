import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { 起 } from '../服务.js';
import { 造服务商面 } from '../服务商.js';
import { 临时项目 } from './会话装置.js';

const fixture = 临时项目();
const root = fixture.root;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-chat-view-'));
const requests = [];
const tinyRequests = [];
let stopRequestReceived = false;
let releaseStoppedResponse;
const provider = http.createServer(async (req, res) => {
  if (req.method === 'GET' && new URL(req.url, 'http://127.0.0.1').pathname === '/tiny.png') {
    tinyRequests.push(new URL(req.url, 'http://127.0.0.1').search);
    res.setHeader('Content-Type', 'image/png');
    res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body);
  const userMessage = body.messages.filter((message) => message.role === 'user').at(-1);
  const prompt = typeof userMessage?.content === 'string'
    ? userMessage.content
    : (userMessage?.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
  const hasSystem = body.messages.some((message) => message.role === 'system');
  const lastUserIndex = body.messages.lastIndexOf(userMessage);
  const toolReceipt = body.messages.slice(lastUserIndex + 1).some((message) => message.role === 'tool');
  const reply = (content, reasoning_content = '') => ({ role: 'assistant', content, reasoning_content });
  const toolCall = (name, args, reasoning_content, content = null) => ({
    role: 'assistant', content, reasoning_content,
    tool_calls: [{ id: `call-${requests.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  });
  let message;
  if (!hasSystem) {
    message = reply('测试会话');
  } else if (prompt.includes('503测试')) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Service is too busy. We advise users to temporarily switch to alternate service.');
    return;
  } else if (prompt.includes('停止测试')) {
    stopRequestReceived = true;
    await new Promise((resolve) => { releaseStoppedResponse = resolve; });
    if (req.destroyed || res.destroyed) return;
    message = reply('不应显示的迟到回复');
  } else if (prompt.includes('博丽灵梦')) {
    message = toolReceipt
      ? reply('| 记录 ID | 名称 | 中文名（第一个是主名） |\n|---|---|---|\n| 9540 | `hakurei_reimu` | 博丽灵梦，hr，reimu_hakurei |\n| 11845 | `hakurei_reimu_(pc_98)` | 博丽灵梦 (PC-98)，classic_hakurei_reimu |\n| 7540 | `hakurei_reimu_(cosplay)` | 博丽灵梦 (角色扮演)，角色cos灵梦 |', '检索到三条候选，整理成表格。')
      : toolCall('tags_search', { 查询: '博丽灵梦' }, '用户要找博丽灵梦相关标签，先查标签库。', '先查询库里的候选。');
  } else if (prompt.includes('工具失败测试')) {
    message = toolReceipt
      ? reply('工具已经返回失败回执。')
      : toolCall('images_view', { 图号: 999999 }, '尝试读取不存在的会话图片。');
  } else if (prompt.includes('第二轮测试')) {
    message = reply('# 窄窗排版\n\n第二轮回复。\n\n| 列名 | 很长的内容 |\n|---|---|\n| 横向滚动 | ' + '宽内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容'.repeat(4) + ' |\n\n```javascript\nconst veryLongIdentifier_' + 'x'.repeat(100) + ' = "wide code";\n```\n\n![本地测试图片](http://127.0.0.1:' + provider.address().port + '/tiny.png)', '第二轮不需要工具，直接给出结果。');
  } else {
    message = reply('普通回复', '依据本轮内容直接回答。');
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
造服务商面({ 目录: temp }).写链路([
  { id: 'test', 名字: '隔离测试服务商', 地址: `http://127.0.0.1:${provider.address().port}/v1`, 模型: 'fake-model' },
]);
const probe = net.createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const debugPort = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const server = 起({ 端口: 0, 项目根: root, 数据目录: temp });
await new Promise((resolve) => server.once('listening', resolve));
await server.宿主.ready;
const initialSessionId = server.宿主.门面.session.run('列').data.会话[0].标识;
const seededImage = await server.宿主.门面.image.run('存', {
  作用域: { 存放地: 'session', 会话ID: initialSessionId },
  字节: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
  文件名: '已有会话图.png', mime: 'image/png',
});
assert.equal(seededImage.ok, true, '预置已有会话图片');
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${path.join(temp, 'browser')}`, '--window-size=1600,1000', 'about:blank',
], { stdio: 'ignore' });
let ws;
let sequence = 0;
const pending = new Map();
const browserErrors = [];
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.result?.description || result.exceptionDetails.text);
  return result.result?.value;
};
async function until(expression) {
  for (let i = 0; i < 600; i += 1) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  console.log('条件超时现场：', await evaluate(`({catalog:window.App?.catalogStatus?.(),busy:AppModules.assistant.snapshot().busy, session:AppModules.assistant.currentSession(),draft:AppModules.assistant.getDraft(),input:document.querySelector('.dsh-inputbar-input')?.textContent,button:document.querySelector('.dsh-inputbar-primary[data-action="send"]')?.disabled,status:document.querySelector('#talkStatus')?.textContent,toast:document.querySelector('#toast')?.textContent})`));
  console.log('已收到服务商请求数：', requests.length);
  console.log('服务商最近消息角色/文本：', requests.map((body) => body.messages.map((item) => ({ role:item.role, text:typeof item.content === 'string' ? item.content.slice(0,120) : item.content?.filter?.(part => part.type === 'text').map(part => part.text).join('\n').slice(0,120) }))));
  throw new Error(`页面条件未满足：${expression}`);
}
async function verifyTypingImage() {
  return evaluate(`(async () => {
    const host=document.createElement('div'); host.id='typing-image-probe';
    Object.assign(host.style,{position:'fixed',top:'0',left:'0',zIndex:'999999'}); document.body.append(host);
    const input=document.querySelector('.dsh-inputbar-input');
    const imageUrl=id=>'http://127.0.0.1:${provider.address().port}/tiny.png?typing-probe='+encodeURIComponent(id);
    const view=window.dshChat.chatView({sessionId:'typing-probe',messages:[],turns:[],images:{resolve:block=>imageUrl(block.imageId)}});
    host.append(view.root);
    let imageId='same-image', receiptVersion=1;
    const messages=()=>[{id:'probe-image-message',role:'assistant',blocks:[
      {kind:'tool-call',callId:'typing-probe-call',name:'probe',title:'probe',state:'running',summary:'执行中',input:{q:'固定'},output:{receipt:receiptVersion}},
      {kind:'image',imageId,name:imageId}
    ]}];
    view.update(messages(),false,{turns:[],sessionId:'typing-probe'});
    const before=host.querySelector('img');
    await new Promise((resolve,reject)=>{if(before?.complete && before.naturalWidth)resolve();else{before.addEventListener('load',resolve,{once:true});before.addEventListener('error',reject,{once:true});}});
    const initialTool=host.querySelector('.dsh-tool-root');
    input.addEventListener('input',()=>view.update(messages(),false,{turns:[],sessionId:'typing-probe'}));
    input.focus();
    for (const text of ['图','图片','图片闪烁回归']) {
      input.textContent=text;
      input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
    }
    const afterTyping=host.querySelector('img');
    const inputAfterTyping=input.textContent;
    const toolAfterTyping=host.querySelector('.dsh-tool-root');
    receiptVersion=2;
    view.update(messages(),false,{turns:[],sessionId:'typing-probe'});
    const toolAfterReceiptChange=host.querySelector('.dsh-tool-root');
    imageId='changed-image';
    view.update(messages(),false,{turns:[],sessionId:'typing-probe'});
    const changed=host.querySelector('img');
    await new Promise((resolve,reject)=>{if(changed?.complete && changed.naturalWidth)resolve();else{changed.addEventListener('load',resolve,{once:true});changed.addEventListener('error',reject,{once:true});}});
    const result={sameNodeAfterTyping:before===afterTyping,inputText:inputAfterTyping,inputFocused:document.activeElement===input,toolUpdatedForSnapshot:initialTool!==toolAfterTyping,toolUpdatedForReceipt:toolAfterTyping!==toolAfterReceiptChange,changedImageSource:changed?.src,changedImageNode:changed!==afterTyping};
    view.destroy(); host.remove();
    return result;
  })()`);
}
async function verifyLiveTypingImage() {
  const seed = await evaluate(`(() => ({sessionId:AppModules.assistant.currentId(),imageId:document.querySelector('#talkImageRepository .conversation-image-card')?.dataset.imageId}))()`);
  assert.ok(seed.sessionId && seed.imageId, '真实输入回归能读取隔离会话及其预置图片');
  const accepted = await evaluate(`AppModules.assistant.run({sessionId:${JSON.stringify(seed.sessionId)},parts:[{type:'image',imageId:${JSON.stringify(seed.imageId)}},{type:'text',text:'真实输入闪图测试'}]})`);
  assert.equal(accepted.ok, true, '隔离会话接受带图消息');
  await until(`!AppModules.assistant.snapshot().busy && AppModules.assistant.currentSession().turns.length === 1`);
  await until(`(() => {const img=document.querySelector('#talkConv .dsh-msg-attachmentRow img');return img?.complete && img.naturalWidth>0;})()`);
  const start = await evaluate(`(() => {const img=document.querySelector('#talkConv .dsh-msg-attachmentRow img');window.__typingImageProbe=img;return {src:img.src,requests:performance.getEntriesByName(img.src).length};})()`);
  await evaluate(`document.querySelector('.dsh-inputbar-input').focus()`);
  let typed = '';
  const samples = [];
  for (const character of Array.from('逐字输入')) {
    typed += character;
    await call('Input.insertText', { text: character });
    await until(`AppModules.assistant.getDraft().filter(part=>part.type==='text').map(part=>part.text).join('\\n') === ${JSON.stringify(typed)}`);
    samples.push(await evaluate(`(() => ({same:window.__typingImageProbe===document.querySelector('#talkConv .dsh-msg-attachmentRow img'),text:document.querySelector('.dsh-inputbar-input')?.textContent,focused:document.activeElement===document.querySelector('.dsh-inputbar-input')}))()`));
  }
  const end = await evaluate(`(() => {const img=document.querySelector('#talkConv .dsh-msg-attachmentRow img');return {same:window.__typingImageProbe===img,requests:performance.getEntriesByName(img.src).length,src:img.src};})()`);
  await evaluate(`(() => {const input=document.querySelector('.dsh-inputbar-input');input.textContent='';input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));})()`);
  await until(`AppModules.assistant.getDraft().filter(part=>part.type==='text').map(part=>part.text).join('\\n') === ''`);
  return {start,end,samples,typed};
}
function assertTypingImage(result) {
  assert.equal(result.sameNodeAfterTyping, true, '输入事件带来同内容消息快照时保留图片节点');
  assert.equal(result.inputText, '图片闪烁回归', '聊天更新不清空正在输入的正文');
  assert.equal(result.inputFocused, true, '聊天更新不移动输入焦点');
  assert.equal(result.toolUpdatedForSnapshot, true, '工具块对象变化时更新工具详情所在分段');
  assert.equal(result.toolUpdatedForReceipt, true, '状态与摘要不变但回执变化时更新工具详情');
  assert.match(result.changedImageSource, /changed-image$/, '图片标识变化后更新图片地址');
  assert.equal(result.changedImageNode, true, '真实图片变化后重建对应图片节点');
  assert.equal(tinyRequests.filter(url => url.includes('typing-probe=same-image')).length, 1, '每次输入不重复请求同一张图片');
  assert.equal(tinyRequests.filter(url => url.includes('typing-probe=changed-image')).length, 1, '图片变化后只请求新图片一次');
}
function assertLiveTypingImage(result) {
  assert.equal(result.samples.length, Array.from(result.typed).length, '真实 composer 对每个输入字符都收到更新');
  assert.ok(result.samples.every(sample => sample.same), '每次真实输入和草稿回执后保留原聊天图片节点');
  assert.ok(result.samples.every(sample => sample.text && result.typed.startsWith(sample.text)), '每次真实输入后正文仍在输入框中');
  assert.ok(result.samples.every(sample => sample.focused), '每次真实输入后焦点仍在输入框');
  assert.equal(result.end.same, true, '真实聊天里的图片节点保持不变');
  assert.equal(result.end.requests, result.start.requests, '输入与草稿回执不额外发起图片请求');
  assert.equal(result.end.src, result.start.src, '输入后图片地址保持不变');
}
async function sendUser(text) {
  const before = await evaluate(`AppModules.assistant.currentSession().messages.filter(message => message.role === 'user').length`);
  await evaluate(`document.querySelector('.dsh-inputbar-input').focus()`);
  await call('Input.insertText', { text });
  let inputState = await evaluate(`({text:document.querySelector('.dsh-inputbar-input')?.textContent,disabled:document.querySelector('.dsh-inputbar-primary[data-action="send"]')?.disabled,session:AppModules.assistant.currentId()})`);
  if (!inputState.text?.includes(text)) {
    await evaluate(`(() => { const input=document.querySelector('.dsh-inputbar-input'); input.focus(); input.textContent=${JSON.stringify(text)}; input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(text)}})); })()`);
    inputState = await evaluate(`({text:document.querySelector('.dsh-inputbar-input')?.textContent,disabled:document.querySelector('.dsh-inputbar-primary[data-action="send"]')?.disabled,session:AppModules.assistant.currentId()})`);
  }
  if (!inputState.text?.includes(text)) throw new Error(`输入框未接收测试文本：${JSON.stringify(inputState)}`);
  if (inputState.disabled) await evaluate(`document.querySelector('.dsh-inputbar-input').dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(text)}}))`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await evaluate(`document.querySelector('.dsh-inputbar-primary[data-action="send"]').click()`);
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await until(`AppModules.assistant.currentSession().messages.filter(message => message.role === 'user').length === ${before + 1}`);
}
async function waitFor(predicate, label) {
  for (let i = 0; i < 600; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`等待超时：${label}`);
}
try {
  let target;
  for (let i = 0; i < 100 && !target; i += 1) {
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((item) => item.type === 'page'); } catch {}
    if (!target) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(target, 'Edge headless CDP 页面已启动');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  ws.addEventListener('message', (event) => {
    const result = JSON.parse(event.data);
    const item = pending.get(result.id);
    if (result.method === 'Runtime.exceptionThrown') browserErrors.push(result.params.exceptionDetails.exception?.description || result.params.exceptionDetails.text);
    if (item) {
      pending.delete(result.id);
      result.error ? item.reject(new Error(result.error.message)) : item.resolve(result.result);
    }
  });
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Page.navigate', { url });
  await until(`window.App?.catalogStatus() === 'ready' && AppModules.assistant.currentId()`);
  await evaluate(`document.querySelector('#aiBtn').click(); document.querySelector('.ai-module-tab[data-panel="talk"]').click()`);
  await until(`document.querySelector('.dsh-inputbar-input')?.getAttribute('contenteditable') === 'true'`);
  if (process.argv.includes('--图片复用')) {
    await until(`document.querySelectorAll('#talkImageRepository .conversation-image-card').length === 1`);
    assertLiveTypingImage(await verifyLiveTypingImage());
    console.log('通过：真实会话草稿输入逐字保存时保留已有聊天图片节点与请求');
    assertTypingImage(await verifyTypingImage());
    console.log('通过：输入事件保留聊天图片 DOM 与请求；工具回执和真实图片变化仍更新');
  } else {
  await until(`document.querySelectorAll('#talkImageRepository .conversation-image-card').length === 1`);
  const loadedImageCard = await evaluate(`(() => { const card=document.querySelector('#talkImageRepository .conversation-image-card'); return {imageId:card?.dataset.imageId,slot:card?.querySelector('.conversation-image-slot')?.textContent}; })()`);
  assert.ok(loadedImageCard.imageId && /1/.test(loadedImageCard.slot), '已有会话首载后显示会话图片卡与图号');
  await evaluate(`document.querySelector('#talkImageRepository .conversation-image-delete').click()`);
  await until(`document.querySelector('#cfmModal')?.classList.contains('show')`);
  await evaluate(`document.querySelector('#cfmNo').click()`);
  await until(`!document.querySelector('#cfmModal')?.classList.contains('show')`);
  assert.equal(await evaluate(`document.querySelectorAll('#talkImageRepository .conversation-image-card').length`), 1, '取消删除确认后图片仍在当前会话');
  await evaluate(`document.querySelector('#talkImageRepository .conversation-image-delete').click()`);
  await until(`document.querySelector('#cfmModal')?.classList.contains('show')`);
  const otherSession = await evaluate(`AppModules.assistant.newSession()`);
  assert.equal(otherSession.ok, true);
  await until(`AppModules.assistant.currentId() !== ${JSON.stringify(initialSessionId)}`);
  await evaluate(`document.querySelector('#cfmYes').click()`);
  await until(`AppModules.assistant.listSessionImages({sessionId:${JSON.stringify(initialSessionId)}}).then(result => result.data.items.length === 0)`);
  await evaluate(`AppModules.assistant.switchSession(${JSON.stringify(initialSessionId)})`);
  await until(`AppModules.assistant.currentId() === ${JSON.stringify(initialSessionId)} && document.querySelectorAll('#talkImageRepository .conversation-image-card').length === 0`);
  console.log('通过：已有会话图片首载、删除取消与跨会话确认时按原会话/图片删除');
  await evaluate(`document.querySelector('.dsh-inputbar-input').focus()`);
  await call('Input.insertText', { text: '帮我搜索博丽灵梦的tag' });
  let initialInput = await evaluate(`({text:document.querySelector('.dsh-inputbar-input')?.textContent,disabled:document.querySelector('.dsh-inputbar-primary[data-action="send"]')?.disabled})`);
  if (!initialInput.text?.includes('帮我搜索博丽灵梦的tag')) {
    await evaluate(`(() => { const input=document.querySelector('.dsh-inputbar-input'); input.focus(); input.textContent='帮我搜索博丽灵梦的tag'; input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'帮我搜索博丽灵梦的tag'})); })()`);
    initialInput = await evaluate(`({text:document.querySelector('.dsh-inputbar-input')?.textContent,disabled:document.querySelector('.dsh-inputbar-primary[data-action="send"]')?.disabled})`);
  }
  console.log('首次提交前输入状态：', initialInput);
  if (!initialInput.text?.includes('帮我搜索博丽灵梦的tag')) throw new Error(`输入框未接收复现文本：${JSON.stringify(initialInput)}`);
  if (initialInput.disabled) await evaluate(`document.querySelector('.dsh-inputbar-input').dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'帮我搜索博丽灵梦的tag'}))`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await evaluate(`document.querySelector('.dsh-inputbar-primary[data-action="send"]').click()`);
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await until(`!AppModules.assistant.snapshot().busy && AppModules.assistant.currentSession().messages.some(message => message.parts.some(part => part.text?.includes('hakurei_reimu_(cosplay)')))`, '查询最终结果到达');
  const conversationRequests = requests.filter((body) => body.messages.some((message) => message.role === 'system'));
  assert.equal(conversationRequests.length, 2, '先调用工具，再根据真实工具回执生成最终答复');
  const queryCall = conversationRequests[1].messages.find((message) => message.role === 'assistant')?.tool_calls?.[0];
  assert.equal(queryCall?.function.name, 'tags_search');
  assert.equal(JSON.parse(queryCall.function.arguments).查询, '博丽灵梦');
  assert.ok(conversationRequests[1].messages.some((message) => message.role === 'tool'), '第二次模型请求包含宿主工具回执');
  const symptoms = await evaluate(`({
    userBubbles: document.querySelectorAll('#talkConv .agent-turn-user, #talkConv [data-chat-flow-kind="user"], #talkConv .cmsg.user').length,
    turns: document.querySelectorAll('#talkConv .agent-turn[data-turn-id]').length,
    tableRows: document.querySelectorAll('#talkConv .agent-turn-result table tbody tr').length,
    resultVisible: [...document.querySelectorAll('#talkConv .agent-turn-result')].some(element => element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility !== 'hidden'),
  })`);
  console.log('首条用户复现症状：', symptoms);
  assert.equal(symptoms.userBubbles, 1, '一次用户输入只显示一条用户气泡');
  assert.equal(symptoms.turns, 1, '同一轮过程与结果由一个轮次容器承载');
  assert.equal(symptoms.tableRows, 3, 'Markdown 表格正确生成三条数据行');
  assert.equal(symptoms.resultVisible, true, '最终回复正文可见');
  assert.equal(await evaluate(`document.querySelector('#talkConv .agent-turn-process')?.open`), false, '完成后的过程默认收起');
  await evaluate(`document.querySelector('#talkConv .agent-turn-summary').click()`);
  const processDetails = await evaluate(`(() => { const turn=document.querySelector('#talkConv .agent-turn'); return {open:turn.querySelector('.agent-turn-process').open, thoughts:turn.querySelector('.agent-turn-body').textContent, toolRows:turn.querySelectorAll('.agent-turn-body .dsh-tool-row').length}; })()`);
  console.log('展开过程详情：', processDetails);
  assert.equal(processDetails.open, true);
  assert.ok(processDetails.thoughts.includes('先查标签库'), '展开可见独立 reasoning');
  const orderedParts = await evaluate(`(() => { const call=AppModules.assistant.currentSession().messages.find(message => message.toolCalls.length); const body=document.querySelector('#talkConv .agent-turn-body'); const rows=[...body.children]; const lead=rows.find(row => row.textContent.includes('先查询库里的候选。')); const tool=body.querySelector('.dsh-tool-root')?.closest('.dsh-flowItem'); return {parts:call?.parts,lead:rows.indexOf(lead),tool:rows.indexOf(tool),dom:rows.map(row => row.textContent.slice(0,100))}; })()`);
  console.log('工具消息正文与过程顺序：', orderedParts);
  assert.ok(orderedParts.parts?.some(part => part.text?.includes('先查询库里的候选。')), '带工具调用的 assistant 正文保存在消息 parts');
  assert.ok(orderedParts.lead >= 0 && orderedParts.tool > orderedParts.lead, '工具前置正文在 DOM 中先于工具行');
  assert.equal(processDetails.toolRows, 1, '展开可见真实工具调用行');
  assert.equal(await evaluate(`document.querySelector('#talkConv .agent-turn .dsh-tool-root[data-tool="tags_search"]')?.dataset.state`), 'ok');
  assert.equal(await evaluate(`document.querySelector('#talkConv .agent-turn .dsh-tool-title')?.textContent`), 'tags_search', '工具标题回显注册名');
  await evaluate(`document.querySelector('#talkConv .agent-turn .dsh-tool-row').click()`);
  await until(`!document.querySelector('#talkConv .agent-turn .dsh-tool-root[data-tool="tags_search"] .dsh-disclosure-body').hidden`);
  await evaluate(`(() => { const raw=document.querySelector('#talkConv .agent-turn .agent-tool-output .agent-tool-raw'); raw.open=true; raw.dispatchEvent(new Event('toggle')); })()`);
  await until(`document.querySelector('#talkConv .agent-turn .agent-tool-output .agent-tool-raw pre') !== null`);
  const receiptText = await evaluate(`document.querySelector('#talkConv .agent-turn .agent-tool-details')?.textContent || ''`);
  assert.ok(receiptText.includes('9540') && receiptText.includes('11845') && receiptText.includes('7540'), '展开原始内容后可读取完整工具回执');
  assert.deepEqual(browserErrors, [], '浏览器没有未捕获异常');
  const screenshotDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..', '临时/截图');
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  fs.writeFileSync(path.join(screenshotDirectory, '聊天UI-1.5.4-详情展开.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await evaluate(`document.querySelector('#talkConv .agent-turn-summary').click()`);
  await until(`!document.querySelector('#talkConv .agent-turn-process').open`);
  await evaluate(`document.querySelector('#talkConv .agent-turn-summary').click()`);
  await until(`document.querySelector('#talkConv .agent-turn-process').open`);
  await evaluate(`(() => { const tool=document.querySelector('#talkConv .agent-turn .dsh-tool-root[data-tool="tags_search"]'); const row=tool.querySelector('.dsh-tool-row'); if (!tool.querySelector('.agent-tool-details') || tool.querySelector('.dsh-disclosure-body').hidden) row.click(); })()`);
  await until(`(() => { const tool=document.querySelector('#talkConv .agent-turn .dsh-tool-root[data-tool="tags_search"]'); return !tool.querySelector('.dsh-disclosure-body').hidden && !!tool.querySelector('.agent-tool-details'); })()`);
  await evaluate(`(() => { const raw=document.querySelector('#talkConv .agent-turn .agent-tool-output .agent-tool-raw'); if(!raw.open){raw.open=true;raw.dispatchEvent(new Event('toggle'));} })()`);
  assert.ok((await evaluate(`document.querySelector('#talkConv .agent-turn .agent-tool-details')?.textContent || ''`)).includes('9540'), '过程二次展开后回执内容仍在');
  fs.writeFileSync(path.join(screenshotDirectory, '聊天UI-1.5.4-过程展开.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await evaluate(`document.querySelector('#talkConv .agent-turn-summary').click()`);
  await until(`!document.querySelector('#talkConv .agent-turn-process').open`);
  await evaluate(`(() => { const host=document.querySelector('#talkConv'); host.scrollTop=host.scrollHeight; })()`);
  const resultFit = await evaluate(`(() => { const result=document.querySelector('#talkConv .agent-turn-result').getBoundingClientRect(); const scroll=document.querySelector('#talkConv').getBoundingClientRect(); const input=document.querySelector('.dsh-inputbar-root').getBoundingClientRect(); return {resultBottom:result.bottom,scrollBottom:scroll.bottom,inputTop:input.top,visible:result.top>=scroll.top && result.bottom<=scroll.bottom}; })()`);
  assert.equal(resultFit.visible, true, '最终正文在聊天滚动区内可完整查看，输入区不遮挡');
  fs.writeFileSync(path.join(screenshotDirectory, '聊天UI-1.5.4-查询.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await evaluate(`document.querySelector('#talkConv .agent-turn-summary').click()`);
  await until(`document.querySelector('#talkConv .agent-turn-process').open`);
  await call('Page.reload');
  await until(`window.App?.catalogStatus() === 'ready' && AppModules.assistant.currentId()`);
  await evaluate(`document.querySelector('#aiBtn').click(); document.querySelector('.ai-module-tab[data-panel="talk"]').click()`);
  await until(`document.querySelector('#talkConv .agent-turn[data-turn-id]') !== null`);
  assert.equal(await evaluate(`document.querySelector('#talkConv .agent-turn-process')?.open`), true, '刷新后同一轮仍保留用户的展开选择');
  console.log('通过：博丽灵梦查询、工具过程顺序与详情、Markdown 表格及展开状态刷新恢复');

  await sendUser('第二轮测试');
  await until(`!AppModules.assistant.snapshot().busy && AppModules.assistant.currentSession().turns.length === 2`);
  const ordering = await evaluate(`({
    turnIds: [...document.querySelectorAll('#talkConv .agent-turn[data-turn-id]')].map(turn => turn.dataset.turnId),
    savedTurnIds: AppModules.assistant.currentSession().turns.map(turn => turn.id),
    userBubbles: document.querySelectorAll('#talkConv .dsh-flowItem[data-chat-flow-kind="user"]').length,
    replies: [...document.querySelectorAll('#talkConv .agent-turn-result')].map(result => result.textContent.trim()).filter(Boolean),
  })`);
  assert.deepEqual(ordering.turnIds, ordering.savedTurnIds, '屏幕轮次与会话记录保持顺序一致');
  assert.equal(ordering.userBubbles, 2, '两轮各自只显示一条用户气泡');
  assert.ok(ordering.replies[0].includes('hakurei_reimu_(cosplay)'));
  assert.ok(ordering.replies[1].includes('第二轮回复'));
  assert.equal(await evaluate(`AppModules.assistant.currentSession().turns.every(turn => turn.status === 'complete')`), true);
  await until(`(() => { const image=[...document.querySelectorAll('#talkConv .agent-turn-result img')].find(item => item.src.endsWith('/tiny.png')); return image?.complete && image.naturalWidth === 1; })()`);
  const followed = await evaluate(`(() => { const result=document.querySelector('#talkConv .agent-turn:last-child .agent-turn-result').getBoundingClientRect(); const viewport=document.querySelector('#talkConv').getBoundingClientRect(); const host=document.querySelector('#talkConv'); return {resultBottom:result.bottom,viewportBottom:viewport.bottom,visible:result.top>=viewport.top && result.bottom<=viewport.bottom,scrollTop:host.scrollTop}; })()`);
  console.log('新回复自动跟随位置：', followed);
  assert.equal(followed.visible, true, '新一轮最终回复自动滚入 #talkConv 可视区域');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  const narrow = await evaluate(`(() => { const scroll=document.querySelectorAll('.agent-markdown-table-scroll')[1]; const pre=document.querySelector('.agent-markdown-code pre'); const chat=document.querySelector('.dsh-chat-scroll'); return {viewport:innerWidth, page:document.documentElement.scrollWidth, chat:chat.clientWidth, turn:document.querySelectorAll('.agent-turn')[1].getBoundingClientRect().width, tableClient:scroll?.clientWidth, tableScroll:scroll?.scrollWidth, codeClient:pre?.clientWidth, codeScroll:pre?.scrollWidth}; })()`);
  console.log('窄窗布局：', narrow);
  assert.ok(narrow.tableScroll > narrow.tableClient, '窄窗口表格保留区域内横向滚动');
  assert.ok(narrow.codeScroll > narrow.codeClient, '窄窗口代码保留区域内横向滚动');
  assert.ok(narrow.page <= narrow.viewport + 1, '宽表格和代码不撑破页面');
  await evaluate(`document.querySelectorAll('.agent-markdown-table-scroll')[1].scrollIntoView({block:'center',inline:'nearest'})`);
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await until(`(() => { const rect=document.querySelectorAll('.agent-markdown-table-scroll')[1].getBoundingClientRect(); return rect.bottom>0 && rect.top<innerHeight && rect.right>0 && rect.left<innerWidth; })()`);
  const narrowTableView = await evaluate(`(() => { const table=document.querySelectorAll('.agent-markdown-table-scroll')[1]; const rect=table.getBoundingClientRect(); return {visible:rect.bottom>0 && rect.top<innerHeight && rect.right>0 && rect.left<innerWidth, text:table.textContent, client:table.clientWidth, scroll:table.scrollWidth, rect:{top:rect.top,bottom:rect.bottom}}; })()`);
  assert.equal(narrowTableView.visible, true, '窄窗截图中的表格在真实浏览器视口内');
  assert.ok(narrowTableView.text.includes('横向滚动') && narrowTableView.scroll > narrowTableView.client, '截图表格显示正文并保留横向滚动');
  fs.writeFileSync(path.join(screenshotDirectory, '聊天UI-1.5.4-窄窗.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await evaluate(`document.querySelectorAll('.agent-markdown-code pre')[0].scrollIntoView({block:'center',inline:'nearest'})`);
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await until(`(() => { const rect=document.querySelectorAll('.agent-markdown-code pre')[0].getBoundingClientRect(); return rect.bottom>0 && rect.top<innerHeight && rect.right>0 && rect.left<innerWidth; })()`);
  const narrowCodeView = await evaluate(`(() => { const pre=document.querySelectorAll('.agent-markdown-code pre')[0]; const rect=pre.getBoundingClientRect(); return {visible:rect.bottom>0 && rect.top<innerHeight && rect.right>0 && rect.left<innerWidth, text:pre.textContent, client:pre.clientWidth, scroll:pre.scrollWidth, rect:{top:rect.top,bottom:rect.bottom}}; })()`);
  assert.equal(narrowCodeView.visible, true, '窄窗截图中的代码在真实浏览器视口内');
  assert.ok(narrowCodeView.text.includes('veryLongIdentifier') && narrowCodeView.scroll > narrowCodeView.client, '截图代码有可读文本并保留横向滚动');
  fs.writeFileSync(path.join(screenshotDirectory, '聊天UI-1.5.4-窄窗代码.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('#talkScrollTop').click()`);
  await until(`document.querySelector('#talkConv').scrollTop < 2`);
  const historyPosition = await evaluate(`document.querySelector('#talkConv').scrollTop`);
  await sendUser('503测试');
  await until(`!AppModules.assistant.snapshot().busy && AppModules.assistant.currentSession().turns.at(-1).status === 'failed'`);
  const failed503 = await evaluate(`(() => { const turn=document.querySelectorAll('#talkConv .agent-turn')[2]; const error=turn.querySelector('.agent-turn-error'); return {status:turn.dataset.status,text:error.textContent,visible:!error.hidden,insideDetails:!!error.closest('details'),summary:turn.querySelector('.agent-turn-summary').textContent}; })()`);
  assert.equal(failed503.status, 'failed');
  assert.equal(failed503.visible, true);
  assert.equal(failed503.insideDetails, false, '失败原因在可折叠过程区之外');
  assert.match(failed503.text, /Service is too busy/);
  assert.doesNotMatch(failed503.summary, /已完成/);
  const heldPosition = await evaluate(`document.querySelector('#talkConv').scrollTop`);
  assert.ok(Math.abs(heldPosition - historyPosition) < 2, '用户上翻历史后，新失败状态不抢滚动位置');
  console.log('通过：503原文、失败状态和手动浏览历史时的位置保持');
  await evaluate(`document.querySelector('#talkScrollBottom').click()`);
  await until(`document.querySelector('#talkConv').scrollHeight - document.querySelector('#talkConv').scrollTop - document.querySelector('#talkConv').clientHeight < 40`);

  await sendUser('工具失败测试');
  await until(`!AppModules.assistant.snapshot().busy && AppModules.assistant.currentSession().turns.length === 4`);
  const toolFailure = await evaluate(`(() => { const turn=document.querySelectorAll('#talkConv .agent-turn')[3]; const row=turn.querySelector('.dsh-tool-root'); return {turnStatus:turn.dataset.status,toolState:row?.dataset.state,text:row?.textContent}; })()`);
  assert.equal(toolFailure.turnStatus, 'complete', '模型收到工具失败回执后仍可完成本轮回复');
  assert.equal(toolFailure.toolState, 'error', '工具行展示宿主的真实失败状态');
  assert.ok(/SESSION_IMAGE_MISSING/.test(toolFailure.text));
  console.log('通过：真实图片读取失败回执保留在工具详情中');

  await sendUser('停止测试');
  await waitFor(() => stopRequestReceived, '停止测试请求到达隔离服务商');
  await until(`AppModules.assistant.snapshot().busy && AppModules.assistant.currentSession().turns.at(-1).status === 'running'`);
  const stopButton = await evaluate(`(() => { const button=document.querySelector('.dsh-inputbar-primary[data-action="stop"]'); return {exists:!!button,hidden:button?.hidden,disabled:button?.disabled,action:button?.dataset.action}; })()`);
  console.log('停止控件状态：', stopButton);
  assert.equal(stopButton.exists && !stopButton.hidden && !stopButton.disabled, true, '运行请求期间显示可用停止按钮');
  await evaluate(`document.querySelector('.dsh-inputbar-primary[data-action="stop"]').click()`);
  await until(`!AppModules.assistant.snapshot().busy && AppModules.assistant.currentSession().turns.at(-1).status === 'stopped'`);
  const stopped = await evaluate(`(() => { const turn=document.querySelector('#talkConv .agent-turn:last-of-type'); return {status:turn.dataset.status,summary:turn.querySelector('.agent-turn-summary').textContent,finalVisible:!turn.querySelector('.agent-turn-result').hidden,header:document.querySelector('#talkStatus').textContent}; })()`);
  assert.equal(stopped.status, 'stopped');
  assert.match(stopped.summary, /已停止/);
  assert.doesNotMatch(stopped.summary, /已完成/);
  assert.equal(stopped.finalVisible, false, '停止后迟到的假服务商回复不会冒充最终答复');
  assert.equal(stopped.header.trim(), '', '完成/停止状态只由轮次摘要显示一次');
  releaseStoppedResponse?.();
  console.log('通过：停止保留真实停止态，不显示迟到回复或伪完成状态');

  const inFlightDisclosure = await evaluate(`(() => {
    const host=document.createElement('div'); host.id='chat-turn-probe'; document.body.append(host);
    const view=window.dshChat.chatView({sessionId:'probe-session',messages:[],turns:[]}); host.append(view.root);
    const now=Date.now();
    const user={id:'m_probe_user',turnId:'t_probe',role:'user',blocks:[{kind:'text',text:'受控轮次'}]};
    const tool={kind:'tool-call',callId:'tc_probe',name:'tags_search',title:'tags_search',state:'running',summary:'正在查询',input:{查询:'受控'},output:null};
    const inFlight={id:'m_probe_call',turnId:'t_probe',role:'assistant',blocks:[{kind:'reasoning',text:'正在查询。'},{kind:'text',text:'先说明，再查找。'},tool]};
    const running={id:'t_probe',inputMessageId:user.id,messageIds:[inFlight.id],status:'running',startedAt:now,endedAt:null,error:null};
    view.update([user,inFlight],true,{turns:[running],sessionId:'probe-session'});
    const turn=host.querySelector('.agent-turn'); const details=turn.querySelector('.dsh-tool-root .dsh-disclosure-body');
    const before={status:turn.querySelector('.dsh-tool-root').dataset.state,open:!details.hidden};
    const row=turn.querySelector('.dsh-tool-row'); row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
    const expanded=turn.querySelector('.dsh-tool-root .dsh-disclosure-body');
    const enterOpened=!expanded.hidden; const detailsBuiltOnEnter=!!turn.querySelector('.agent-tool-details');
    row.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}));
    const spaceClosed=expanded.hidden;
    row.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}));
    const spaceOpened=!expanded.hidden;
    row.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}));
    const spaceReclosed=expanded.hidden;
    let receiptSerializations=0;
    let deepReceiptReads=0;
    const deepLeaf={value:'受控'};
    const deepBranch={};
    Object.defineProperty(deepBranch,'leaf',{enumerable:true,get(){deepReceiptReads++;return deepLeaf;}});
    const largeReceipt={branch:deepBranch};
    Object.defineProperty(largeReceipt,'toJSON',{value(){receiptSerializations++;return {大型回执:'受控'};}});
    const completedTool={...tool,state:'ok',summary:'查询完成',output:largeReceipt};
    const completedCall={...inFlight,blocks:[{kind:'reasoning',text:'正在查询。'},{kind:'text',text:'先说明，再查找。'},completedTool]};
    const final={id:'m_probe_final',turnId:'t_probe',role:'assistant',blocks:[{kind:'text',text:'受控工具回执已返回。'}]};
    view.update([user,completedCall,final],false,{turns:[{...running,messageIds:[completedCall.id,final.id],status:'complete',endedAt:Date.now(),finalMessageId:final.id}],sessionId:'probe-session'});
    const serializedWhileCollapsed=receiptSerializations;
    const afterTurn=host.querySelector('.agent-turn'); const afterRow=afterTurn.querySelector('.dsh-tool-root');
    const collapsedDetails=afterRow.querySelector('.dsh-disclosure-body');
    const openAfterComplete=!collapsedDetails.hidden;
    afterRow.querySelector('.dsh-tool-row').click();
    const afterDetails=afterRow.querySelector('.dsh-disclosure-body');
    const output=afterDetails.querySelector('.agent-tool-output');
    const rootValue=output.querySelector('.agent-data-node');
    const nodesAtToolOpen=output.querySelectorAll('.agent-data-node').length;
    rootValue.open=true; rootValue.dispatchEvent(new Event('toggle'));
    const branchValue=rootValue.querySelector('.agent-data-node');
    const nodesAtRootOpen=output.querySelectorAll('.agent-data-node').length;
    const readsAtRootOpen=deepReceiptReads;
    branchValue.open=true; branchValue.dispatchEvent(new Event('toggle'));
    const nodesAtBranchOpen=output.querySelectorAll('.agent-data-node').length;
    const readsAtBranchOpen=deepReceiptReads;
    const raw=output.querySelector('.agent-tool-raw'); raw.open=true; raw.dispatchEvent(new Event('toggle'));
    const result={before,enterOpened,detailsBuiltOnEnter,spaceClosed,spaceOpened,spaceReclosed,afterState:afterRow.dataset.state,openAfterComplete,serializedWhileCollapsed,receiptSerializations,readsAtToolOpen:0,readsAtRootOpen,readsAtBranchOpen,nodesAtToolOpen,nodesAtRootOpen,nodesAtBranchOpen,rawContent:raw.querySelector('pre')?.textContent.includes('大型回执'),final:afterTurn.querySelector('.agent-turn-result').textContent.includes('受控工具回执已返回')};
    view.destroy(); host.remove();
    return result;
  })()`);
  assert.equal(inFlightDisclosure.before.status, 'running');
  assert.equal(inFlightDisclosure.serializedWhileCollapsed, 0, '折叠期间不序列化大回执');
  assert.equal(inFlightDisclosure.receiptSerializations, 1, '显式展开原始内容后序列化大回执');
  assert.equal(inFlightDisclosure.enterOpened, true, 'Enter 键展开运行中的工具行');
  assert.equal(inFlightDisclosure.detailsBuiltOnEnter, true, 'Enter 键可触发工具详情懒加载');
  assert.equal(inFlightDisclosure.spaceClosed, true, 'Space 键收起工具详情');
  assert.equal(inFlightDisclosure.spaceOpened, true, 'Space 键再次展开工具详情');
  assert.equal(inFlightDisclosure.spaceReclosed, true, 'Space 键再次收起工具详情');
  assert.equal(inFlightDisclosure.afterState, 'ok');
  assert.equal(inFlightDisclosure.openAfterComplete, false, '折叠的工具详情在完成重绘后仍保持折叠');
  assert.equal(inFlightDisclosure.nodesAtToolOpen, 1, '展开工具行只创建回执根节点');
  assert.equal(inFlightDisclosure.nodesAtRootOpen, 2, '打开根层后才创建第一层子节点');
  assert.equal(inFlightDisclosure.nodesAtBranchOpen, 3, '打开子层后才创建更深节点');
  assert.equal(inFlightDisclosure.readsAtRootOpen, 0, '打开根层不读取更深回执内容');
  assert.equal(inFlightDisclosure.readsAtBranchOpen, 1, '打开子层才读取该层回执内容');
  assert.equal(inFlightDisclosure.rawContent, true, '原始 JSON 仍可显式展开查看');
  assert.equal(inFlightDisclosure.final, true, '完成轮次的最终正文进入结果区');
  console.log('通过：受控运行工具展开后收到回执，完成重绘仍保持展开');

  assertTypingImage(await verifyTypingImage());
  console.log('通过：输入事件保留聊天图片 DOM 与请求；工具回执和真实图片变化仍更新');
  assert.deepEqual(browserErrors, [], '浏览器没有未捕获异常');
  }
} catch (error) {
  console.error('聊天呈现验收失败：', error);
  throw error;
} finally {
  if (ws?.readyState === WebSocket.OPEN) {
    try { await call('Browser.close'); } catch {}
  }
  ws?.close();
  if (browser.exitCode === null) await new Promise((resolve) => browser.once('exit', resolve));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  provider.closeAllConnections();
  await new Promise((resolve) => provider.close(resolve));
  fixture.cleanup();
  const tempRoot = path.resolve(os.tmpdir());
  if (!temp.startsWith(tempRoot + path.sep) || !path.basename(temp).startsWith('toolbox-chat-view-')) throw new Error('测试临时目录范围不匹配');
  await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
