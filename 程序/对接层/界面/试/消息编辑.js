import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { 起 } from '../服务.js';
import { 造服务商面 } from '../服务商.js';
import { 临时项目 } from './会话装置.js';

const fixture = 临时项目(), 项目根 = fixture.root;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-message-edit-'));
const 截图目录 = path.resolve('临时/2026-10-18-消息编辑与重新生成');
fs.mkdirSync(截图目录, { recursive: true });
const requests = [];
const provider = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); requests.push(body);
  const user = [...body.messages].reverse().find(message => message.role === 'user');
  const prompt = typeof user?.content === 'string'
    ? user.content
    : (user?.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
  if (prompt.includes('触发503')) {
    res.statusCode = 503; res.setHeader('Content-Type', 'text/plain'); res.end('隔离模型故障'); return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `回复：${prompt}` }, finish_reason: 'stop' }] }));
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
造服务商面({ 目录: temp }).写链路([{ id: 'edit-test', 名字: '编辑隔离模型', 地址: `http://127.0.0.1:${provider.address().port}/v1`, 模型: 'edit-test' }]);
const probe = net.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const debugPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
const server = 起({ 端口: 0, 项目根, 数据目录: temp });
await new Promise(resolve => server.once('listening', resolve));
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${path.join(temp, 'browser')}`, '--window-size=1500,1000', 'about:blank',
], { stdio: 'ignore' });
let ws; let sequence = 0;
const pending = new Map();
const browserErrors = [], networkEvents = [];
let currentSessionForDebug = '';
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.result?.description || result.exceptionDetails.text);
  return result.result?.value;
};
async function until(expression, label = expression) {
  for (let i = 0; i < 600; i++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (label === '编辑入口显示') {
    let serverSession = null;
    try { serverSession = (await server.宿主.门面.session.run('读', {会话:currentSessionForDebug})).data; } catch (error) { serverSession = {error:String(error)}; }
    const browserState = await evaluate(`({id:AppModules.assistant.currentSession()?.id,running:AppModules.assistant.currentSession()?.运行状态,busy:AppModules.assistant.snapshot().busy,messages:AppModules.assistant.currentSession().messages.map(m=>({id:m.id,role:m.role,status:m.status,parts:m.parts})),turns:AppModules.assistant.currentSession().turns,edit:document.querySelectorAll('.dsh-message-edit-open').length,flow:[...document.querySelectorAll('#talkConv [data-chat-node-key]')].map(n=>({id:n.dataset.chatNodeKey,kind:n.dataset.chatFlowKind,part:n.dataset.chatGroupPart,text:n.textContent.slice(0,80)}))})`);
    console.log('编辑入口现场：', JSON.stringify({browser:browserState,server:{id:serverSession?.会话?.id,running:serverSession?.运行状态,messageCount:serverSession?.会话?.messages?.length,turns:serverSession?.会话?.turns?.map(t=>({id:t.id,status:t.status,inputMessageId:t.inputMessageId,messageIds:t.messageIds}))},requests:requests.length,browserErrors,networkEvents}, null, 2));
  }
  throw new Error(`等待超时：${label}`);
}
async function saveScreenshot(name) {
  const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.promises.writeFile(path.join(截图目录, name), Buffer.from(result.data, 'base64'));
}
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(row => row.type === 'page'); } catch {}
    if (!target) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(target, 'Edge 页面已启动');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  ws.addEventListener('message', event => {
    const row = JSON.parse(event.data), item = pending.get(row.id);
    if (row.method === 'Runtime.exceptionThrown') browserErrors.push(row.params.exceptionDetails.exception?.description || row.params.exceptionDetails.text);
    if (row.method === 'Network.loadingFailed') networkEvents.push({kind:'failed',requestId:row.params.requestId,error:row.params.errorText});
    if (row.method === 'Network.responseReceived' && row.params.response.url.includes('/toolbox/')) networkEvents.push({kind:'response',url:row.params.response.url,status:row.params.response.status});
    if (item) { pending.delete(row.id); row.error ? item.reject(new Error(row.error.message)) : item.resolve(row.result); }
  });
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await until('window.App?.catalogStatus?.() === "ready" && AppModules.assistant.currentId()', '页面和当前会话就绪');
  await evaluate(`document.querySelector('#aiBtn').click(); document.querySelector('.ai-module-tab[data-panel="talk"]').click()`);
  await until('document.querySelector(".dsh-inputbar-input")?.getAttribute("contenteditable") === "true"', '聊天页就绪');
  const sid = await evaluate('AppModules.assistant.currentId()');
  currentSessionForDebug = sid;
  const image = await server.宿主.门面.image.run('存', {作用域:{存放地:'session',会话ID:sid},字节:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'),文件名:'编辑保留.png',mime:'image/png'});
  assert.equal(image.ok, true, '隔离会话图像写入成功');
  let expectedTurns = 0;
  const send = async (text, parts) => {
    const result = await evaluate(`AppModules.assistant.run(${JSON.stringify({sessionId:sid,...(parts ? {parts} : {text})})})`);
    assert.equal(result.ok, true, `发送 ${text}`);
    expectedTurns += 1;
    for (let i = 0; i < 200; i++) {
      const session = (await server.宿主.门面.session.run('读', {会话:sid})).data;
      if (session.运行状态 === '空闲' && session.会话.turns.length >= expectedTurns) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await until(`!AppModules.assistant.snapshot().busy && AppModules.assistant.currentSession().messages.length >= ${expectedTurns * 2}`, '页面模型轮次投影结束');
  };
  await send('第一轮用户原文', [{type:'text',text:'第一轮用户原文'},{type:'image',imageId:image.data.引用.条目ID}]);
  await send('保留的后续轮');
  let stored = (await server.宿主.门面.session.run('读', {会话:sid})).data;
  const user = stored.会话.messages.find(message => message.role === 'user');
  const assistantMessages = stored.会话.messages.filter(message => message.role === 'assistant' && message.parts.some(part => part.type === 'text'));
  assert.ok(user && assistantMessages.length >= 2, '隔离会话存有两轮实际模型消息');

  await until('document.querySelectorAll(".dsh-message-edit-open").length >= 4', '编辑入口显示');
  const iconRows = await evaluate(`(() => [...document.querySelectorAll('.dsh-message-edit-open')].map(edit => {
    const row=edit.closest('.dsh-iconactions-actions');
    const time=row?.querySelector('.dsh-iconactions-timeEnd');
    const regen=row?.querySelector('.dsh-message-regenerate');
    return {inRow:!!row,pencil:!!edit.querySelector('use[href$="#pencil"]'),text:edit.textContent.trim(),beforeTime:!!time && Boolean(edit.compareDocumentPosition(time)&Node.DOCUMENT_POSITION_FOLLOWING),afterCopy:edit.previousElementSibling?.getAttribute('aria-label'),regen:regen?{text:regen.textContent.trim(),beforeTime:Boolean(regen.compareDocumentPosition(time)&Node.DOCUMENT_POSITION_FOLLOWING),afterEdit:regen.previousElementSibling?.classList.contains('dsh-message-edit-open')}:null};
  }))()`);
  assert.ok(iconRows.every(row => row.inRow && row.pencil && !row.text && row.beforeTime && row.afterCopy === '复制'), '用户和 AI 的笔形修改图标紧跟复制图标，时间位于其后');
  const regenerateRows = iconRows.filter(row => row.regen);
  assert.equal(regenerateRows.length, 2, '两轮 AI 回复各有一个同行的重新生成图标');
  assert.ok(regenerateRows.every(row => row.regen.text === '↻' && row.regen.beforeTime && row.regen.afterEdit), 'AI 操作顺序为复制、修改、重新生成、时间');
  await saveScreenshot('01-消息编辑入口.png');
  await evaluate(`(() => [...document.querySelectorAll('.dsh-message-edit-open')].find(x=>x.closest('[data-chat-flow-kind="user"]')).click())()`);
  await until('document.activeElement?.classList.contains("dsh-message-edit-input")', '编辑框获得焦点');
  await evaluate(`(() => {const a=document.querySelector('.dsh-message-edit-input');a.value='用户修改后的问题';a.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#talkIn')?.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  assert.equal(await evaluate('document.querySelector(".dsh-message-edit-input")?.value'), '用户修改后的问题', '投影输入重绘保留编辑框内容');
  await saveScreenshot('02-用户消息编辑中.png');
  await evaluate('document.querySelector(".dsh-message-edit-save").click()');
  await until(`AppModules.assistant.currentSession().messages.find(m=>m.id===${JSON.stringify(user.id)}).parts.some(p=>p.text==="用户修改后的问题")`, '修改后的用户内容投影');
  stored = (await server.宿主.门面.session.run('读', {会话:sid})).data;
  const savedUser = stored.会话.messages.find(message => message.id === user.id);
  assert.equal(savedUser.parts.find(part => part.type === 'text').text, '用户修改后的问题', '用户消息已写入隔离存档');
  assert.ok(savedUser.parts.some(part => part.type === 'image'), '编辑文本保留用户消息图片');

  const midMessage = assistantMessages[0];
  const middleText = midMessage.parts.find(part => part.type === 'text').text;
  await evaluate(`(() => {const button=[...document.querySelectorAll('.dsh-message-edit-open')].find(x=>x.closest('[data-chat-node-key="${midMessage.id}"]'));button.click();const a=[...document.querySelectorAll('.dsh-message-edit-input')].find(x=>x.closest('[data-chat-node-key="${midMessage.id}"]'));a.value='AI正文已人工修订';a.dispatchEvent(new Event('input',{bubbles:true}));a.closest('[data-chat-node-key]').querySelector('.dsh-message-edit-save').click();})()`);
  await until(`AppModules.assistant.currentSession().messages.find(m=>m.id===${JSON.stringify(midMessage.id)}).parts.some(p=>p.text==="AI正文已人工修订")`, 'AI 正文修改完成');
  stored = (await server.宿主.门面.session.run('读', {会话:sid})).data;
  assert.ok(stored.会话.messages.find(message => message.id === midMessage.id).parts.some(part => part.text === 'AI正文已人工修订'), 'AI 消息已写入隔离存档');
  assert.notEqual(middleText, 'AI正文已人工修订');

  await evaluate(`(() => {const button=document.querySelector('[data-turn-id="${stored.会话.turns[0].id}"] .dsh-message-regenerate');button.click();})()`);
  await until(`!AppModules.assistant.snapshot().busy && AppModules.assistant.currentSession().turns[0].status === "complete" && AppModules.assistant.currentSession().messages.some(m=>m.parts.some(p=>p.text?.includes("回复：用户修改后的问题")))`, '首轮重新生成结束');
  stored = (await server.宿主.门面.session.run('读', {会话:sid})).data;
  assert.equal(stored.会话.turns.length, 2, '重新生成保留后续轮次');
  assert.ok(stored.会话.messages.some(message => message.parts.some(part => part.text === '保留的后续轮')), '后续用户消息仍在');
  assert.ok(requests.at(-1).messages.some(message => message.role === 'user' && (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).includes('用户修改后的问题')), '重新生成使用修改后的用户文本');
  await saveScreenshot('03-重新生成与后续对话.png');

  const other = await evaluate('AppModules.assistant.newSession()');
  const otherId = other.data.id;
  const oldCount = (await server.宿主.门面.session.run('读', {会话:sid})).data.会话.messages.length;
  await evaluate(`(() => {document.querySelector('#talkSessionList .conversation-row[data-session-id="${sid}"] .conversation-title').click();})()`);
  await until(`AppModules.assistant.currentId() === ${JSON.stringify(sid)}`, '切回目标会话');
  await evaluate(`(() => [...document.querySelectorAll('.dsh-message-edit-open')].find(button=>button.closest('[data-chat-node-key="${user.id}"]')).click())()`);
  await until('document.querySelector(".dsh-message-edit-input")', '再次打开用户消息编辑框');
  await evaluate(`(() => {const a=document.querySelector('.dsh-message-edit-input');a.value='切换会话时不提交';a.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#talkSessionList .conversation-row[data-session-id="${otherId}"] .conversation-title').click();})()`);
  await until(`AppModules.assistant.currentId() === ${JSON.stringify(otherId)}`, '切换到另一会话');
  const visibleOtherEdit = await evaluate('document.querySelector(".dsh-message-edit-input")?.value || ""');
  assert.notEqual(visibleOtherEdit, '切换会话时不提交', '切换会话清除旧编辑器');
  assert.equal((await server.宿主.门面.session.run('读', {会话:sid})).data.会话.messages.length, oldCount, '切换会话未误写旧会话目标');

  await evaluate(`AppModules.assistant.run({sessionId:${JSON.stringify(otherId)},text:'触发503'})`);
  await until(`!AppModules.assistant.snapshot().busy && document.querySelector('.agent-turn-error')?.textContent.includes('隔离模型故障')`, '失败回执显示');
  await saveScreenshot('04-模型失败回执.png');
  assert.ok(requests.length >= 3, '隔离 provider 收到发送及重新生成请求');
  console.log('真实浏览器+宿主通过：用户/AI编辑写盘、重新生成使用改后输入并保留后续、切会话不误写、失败回执可见');
} finally {
  if (ws?.readyState === WebSocket.OPEN) { try { await call('Browser.close'); } catch {} }
  ws?.close();
  if (browser.exitCode === null) await new Promise(resolve => browser.once('exit', resolve));
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
  await server.宿主.close(); fixture.cleanup();
  const base = path.resolve(os.tmpdir());
  if (!temp.startsWith(base + path.sep) || !path.basename(temp).startsWith('toolbox-message-edit-')) throw new Error('测试临时目录范围不匹配');
  await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
