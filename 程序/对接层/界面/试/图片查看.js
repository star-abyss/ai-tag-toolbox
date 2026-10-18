import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { 起 } from '../服务.js';
import { 临时项目 } from './会话装置.js';

const require = createRequire(path.resolve('程序/对接层/package.json'));
const sharp = require('sharp');
const sessionData = require(path.resolve('程序/会话模块/data.js'));
const fixture = 临时项目();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-image-viewer-'));
const artwork = Buffer.from(`<svg width="1200" height="800" viewBox="0 0 1200 800" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#172554"/><stop offset=".55" stop-color="#7c3aed"/><stop offset="1" stop-color="#fb7185"/></linearGradient><linearGradient id="lake" x2="0" y2="1"><stop stop-color="#38bdf8"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs><rect width="1200" height="800" fill="url(#sky)"/><circle cx="880" cy="245" r="104" fill="#fde68a"/><path d="M0 510 270 240 490 505 690 285 970 550 1080 425 1200 520V800H0Z" fill="#312e81"/><path d="m0 575 280-190 240 205 220-180 270 190 190-135v335H0Z" fill="#4338ca"/><path d="M0 610q250-65 500 0t700 0v190H0Z" fill="url(#lake)"/><path d="M0 690q260-55 520 0t680 0" fill="none" stroke="#bae6fd" stroke-opacity=".55" stroke-width="9"/><text x="70" y="100" fill="white" font-size="44" font-family="sans-serif" opacity=".85">SYNTHETIC IMAGE · 1200 × 800</text></svg>`);
const source = await sharp(artwork).png().toBuffer();
const sourceHash = await sharp(source).metadata().then(meta => `${meta.width}x${meta.height}`);
assert.equal(sourceHash, '1200x800');
const evidence = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..', '临时/图片查看');
fs.mkdirSync(evidence, { recursive: true });
const uploadPath = path.join(temp, '待发合成图.png');
fs.writeFileSync(uploadPath, source);
const server = 起({ 端口: 0, 项目根: fixture.root, 数据目录: path.join(temp, 'data') });
await new Promise(resolve => server.once('listening', resolve));
await server.宿主.ready;
const sessionId = server.宿主.门面.session.run('列').data.会话[0].标识;
const saved = await server.宿主.门面.image.run('存', {
  作用域: { 存放地: 'session', 会话ID: sessionId }, 字节: source, 文件名: '1200x800.png', mime: 'image/png',
});
assert.equal(saved.ok, true);
const imageId = saved.data.标识;
const generated = await server.宿主.门面.image.run('存', {
  作用域: { 存放地: 'session', 会话ID: sessionId }, 字节: source, 文件名: 'generated-1200x800.png', mime: 'image/png',
});
assert.equal(generated.ok, true);
const generatedId = generated.data.标识;
const provider = http.createServer(async (_req, res) => {
  for await (const _chunk of _req) {}
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '图片收到了。' }, finish_reason: 'stop' }] }));
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
server.宿主.服务商.写链路([{ id: 'image-test', 名字: '隔离图片回归', 地址: `http://127.0.0.1:${provider.address().port}/v1`, 模型: 'image-view-test' }]);
const base = `http://127.0.0.1:${server.address().port}/`;
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
const pending = new Map();
const exceptions = [];
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.result?.description || result.exceptionDetails.text);
  return result.result?.value;
};
async function clickAt(selector) {
  const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button:'left', clickCount:1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button:'left', clickCount:1 });
}
async function screenshot(name) {
  fs.writeFileSync(path.join(evidence, name), Buffer.from((await call('Page.captureScreenshot', { format:'png' })).data, 'base64'));
}
async function until(expression, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(60); }
  throw new Error(`等待超时: ${expression}`);
}
try {
  let target;
  for (let i = 0; i < 120 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(row => row.type === 'page'); } catch {}
    if (!target) await sleep(50);
  }
  assert.ok(target, 'Edge 页面已启动');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data), task = pending.get(data.id);
    if (task) { pending.delete(data.id); data.error ? task.reject(new Error(data.error.message)) : task.resolve(data.result); }
    if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
  });
  await call('Page.enable'); await call('Runtime.enable'); await call('Page.navigate', { url: base });
  await until(`window.App?.catalogStatus() === 'ready' && AppModules.assistant.currentId()`);
  assert.equal(await evaluate(`Boolean(document.querySelector('#searchPrecision')||document.querySelector('#searchRegex'))`), false, '搜索栏没有失效的精确度/正则控件');
  await evaluate(`(()=>{const q=document.querySelector('#q');q.focus();q.value='';q.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await call('Input.insertText', { text:'solo' });
  await call('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
  await call('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
  await until(`[...document.querySelectorAll('#chips .chip .en')].some(el=>el.textContent==='solo')`);
  await screenshot('搜索-Enter.png');
  await evaluate(`(()=>{const q=document.querySelector('#q');q.focus();q.select()})()`);
  await call('Input.insertText', { text:'blue eyes' });
  await clickAt('#searchBtn');
  await until(`document.querySelector('#catTitle')?.textContent.includes('blue eyes')`);
  assert.ok(await evaluate(`document.querySelectorAll('#chips .chip').length>0`), '点击搜索按钮后绘制标签匹配结果');
  await screenshot('搜索-按钮.png');
  await clickAt('#clearQ');
  assert.equal(await evaluate(`document.querySelector('#q').value`), '', '清空搜索恢复空查询');
  assert.ok(await evaluate(`document.querySelectorAll('#chips .chip').length>0`), '清空搜索后恢复标签列表');
  const beforeCharacterErrors = exceptions.length;
  await clickAt('.tag-mode-tab[data-tag-mode="characters"]');
  await until(`!document.querySelector('#charactersView')?.hidden`);
  await evaluate(`(()=>{const q=document.querySelector('#q');q.focus();q.value='hatsune_miku';q.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await clickAt('#searchBtn');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(exceptions.length, beforeCharacterErrors, '角色库普通搜索没有浏览器异常');
  await screenshot('搜索-角色普通查询.png');
  await clickAt('.tag-mode-tab[data-tag-mode="tags"]');
  await until(`!document.querySelector('#tagLibraryView')?.hidden`);
  await evaluate(`document.querySelector('#aiBtn').click();document.querySelector('.ai-module-tab[data-panel="talk"]').click()`);
  await until(`document.querySelector('#talkConv') && document.querySelector('.dsh-inputbar-input')`);
  const sent = await evaluate(`AppModules.assistant.run({sessionId:${JSON.stringify(sessionId)},text:'看这张图',imageIds:[${JSON.stringify(imageId)}]})`);
  assert.equal(sent.ok, true, '通过聊天助手公开发送入口发送原图');
  await until(`AppModules.assistant.currentSession().messages.some(m=>m.role==='user'&&m.parts.some(p=>p.type==='image'&&p.imageId===${JSON.stringify(imageId)}))`);
  await until(`(()=>{const img=document.querySelector('#talkConv .dsh-image');return img?.complete&&img.naturalWidth>0})()`);
  const preview = await evaluate(`(()=>{const img=document.querySelector('#talkConv .dsh-image');return {width:img.naturalWidth,height:img.naturalHeight,src:img.currentSrc,tag:img.tagName,button:img.closest('button')?.tagName||null}})()`);
  console.log('聊天图片预览：', preview);
  fs.writeFileSync(path.join(evidence, '聊天图片-预览.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const point = await evaluate(`(()=>{const r=document.querySelector('#talkConv .dsh-image').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x:point.x, y:point.y, button:'left', clickCount:1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x:point.x, y:point.y, button:'left', clickCount:1 });
  const clickResult = await evaluate(`(()=>({open:document.querySelector('#imgViewer')?.classList.contains('show'),src:document.querySelector('#imgViewerImage')?.currentSrc||''}))()`);
  console.log('聊天图片点击：', clickResult);
  assert.equal(preview.width, 768, '聊天消息预览使用 768px 派生图');
  assert.equal(preview.height, 512);
  assert.equal(clickResult.open, true, '点击聊天原生图片节点打开大图查看器');
  await until(`(()=>{const img=document.querySelector('#imgViewerImage');return img?.complete&&img.naturalWidth===1200&&img.naturalHeight===800})()`);
  const full = await evaluate(`(()=>{const img=document.querySelector('#imgViewerImage');return {src:img.currentSrc,width:img.naturalWidth,height:img.naturalHeight}})()`);
  assert.equal(full.width, 1200); assert.equal(full.height, 800);
  const bytes = await evaluate(`fetch(document.querySelector('#imgViewerImage').currentSrc).then(r=>r.arrayBuffer()).then(b=>crypto.subtle.digest('SHA-256',b)).then(h=>[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join(''))`);
  assert.equal(bytes, createHash('sha256').update(source).digest('hex'), '查看器读取原图字节');
  fs.writeFileSync(path.join(evidence, '聊天图片-查看器.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal(await evaluate(`document.querySelector('#imgViewer')?.classList.contains('show')`), false, 'Esc 关闭大图');
  const archive=JSON.parse(await evaluate(`AppModules.assistant.exportSessions()`));
  const entry=archive.sessions.find(row=>row.session.id===sessionId);
  const session=entry.session, now=Date.now(), turn=session.turns[0];
  session.updatedAt=now; turn.status='complete'; turn.endedAt=now; turn.error=null;
  session.messages.push({id:'m_generatedimage',turnId:turn.id,role:'assistant',parts:[{type:'image',imageId:generatedId}],reasoning:'',context:'',toolCalls:[],createdAt:now,model:null});
  assert.equal(sessionData.validSession(session), true, '合成 assistant 图片消息维持有效会话形状');
  const imported = await evaluate(`AppModules.assistant.importSessions(${JSON.stringify(JSON.stringify(archive))})`);
  assert.equal(imported.ok, true, JSON.stringify(imported));
  const importedSession=imported.data.会话ID列表[0];
  await evaluate(`AppModules.assistant.switchSession(${JSON.stringify(importedSession)})`);
  const importedSessionForWait = importedSession;
  await until(`AppModules.assistant.currentId()===${JSON.stringify(importedSessionForWait)}&&document.querySelectorAll('#talkConv .dsh-image').length===2`);
  await until(`(()=>[...document.querySelectorAll('#talkConv .dsh-image')].every(img=>img.complete&&img.naturalWidth===768))()`);
  const generatedView = await evaluate(`(()=>{const imgs=[...document.querySelectorAll('#talkConv .dsh-image')];const img=imgs[imgs.length-1],r=img.getBoundingClientRect();return {count:imgs.length,width:img?.naturalWidth,height:img?.naturalHeight,button:img?.closest('button')?.tagName||null,displayWidth:r.width,displayHeight:r.height}})()`);
  console.log('模拟生成消息预览尺寸：', generatedView);
  assert.equal(generatedView.count, 2, '模拟生成图片作为 assistant image Part 呈现在会话消息中');
  assert.equal(generatedView.button, 'BUTTON');
  assert.ok(generatedView.displayWidth <= 360 && generatedView.displayWidth > 0, '消息图片按 360px 以内的阅读尺寸展示');
  assert.ok(Math.abs(generatedView.displayWidth / generatedView.displayHeight - 1.5) < 0.02, '消息图片保持原图宽高比');
  fs.writeFileSync(path.join(evidence, '聊天图片-预览.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await evaluate(`(()=>{const imgs=document.querySelectorAll('#talkConv .dsh-image');imgs[imgs.length-1].click()})()`);
  await until(`(()=>{const img=document.querySelector('#imgViewerImage');return img?.complete&&img.naturalWidth===1200&&img.naturalHeight===800})()`);
  const generatedRaw = await evaluate(`fetch(document.querySelector('#imgViewerImage').currentSrc).then(r=>r.arrayBuffer()).then(b=>crypto.subtle.digest('SHA-256',b)).then(h=>[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join(''))`);
  assert.equal(generatedRaw, createHash('sha256').update(source).digest('hex'), '模拟生成图片查看器读取相同原图字节');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(`!document.querySelector('#imgViewer')?.classList.contains('show')`);
  await call('Page.reload');
  await until(`window.App?.catalogStatus() === 'ready' && AppModules.assistant.currentId()`);
  await evaluate(`document.querySelector('#aiBtn').click();document.querySelector('.ai-module-tab[data-panel="talk"]').click()`);
  await until(`document.querySelectorAll('#talkConv .dsh-image').length===2&&document.querySelectorAll('#talkConv .dsh-image')[1].complete&&document.querySelectorAll('#talkConv .dsh-image')[1].naturalWidth===768`);
  await evaluate(`document.querySelectorAll('#talkConv .dsh-image')[1].click()`);
  assert.equal(await evaluate(`document.querySelector('#imgViewer')?.classList.contains('show')`), true, '历史刷新后图片仍可点开');
  await evaluate(`document.querySelector('#imgViewerClose').click()`);
  await call('DOM.enable');
  const documentNode = await call('DOM.getDocument');
  const fileNode = await call('DOM.querySelector', { nodeId:documentNode.root.nodeId, selector:'#talkImgFile' });
  assert.ok(fileNode.nodeId, '隐藏文件选择器存在');
  await call('DOM.setFileInputFiles', { nodeId:fileNode.nodeId, files:[uploadPath] });
  await until(`document.querySelector('#dshComposerMount .dsh-attr-thumbnail')`);
  await until(`(()=>{const img=document.querySelector('#dshComposerMount .dsh-attr-thumbnail img');return img?.complete&&img.naturalWidth===160})()`);
  const attachmentPoint = await evaluate(`(()=>{const r=document.querySelector('#dshComposerMount .dsh-attr-thumbnail').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await call('Input.dispatchMouseEvent', { type:'mouseMoved', ...attachmentPoint });
  await call('Input.dispatchMouseEvent', { type:'mousePressed', ...attachmentPoint, button:'left', clickCount:1 });
  await call('Input.dispatchMouseEvent', { type:'mouseReleased', ...attachmentPoint, button:'left', clickCount:1 });
  await until(`(()=>{const img=document.querySelector('#imgViewerImage');return img?.complete&&img.naturalWidth===1200&&img.naturalHeight===800})()`);
  const attachmentHash = await evaluate(`fetch(document.querySelector('#imgViewerImage').currentSrc).then(r=>r.arrayBuffer()).then(b=>crypto.subtle.digest('SHA-256',b)).then(h=>[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join(''))`);
  assert.equal(attachmentHash, createHash('sha256').update(source).digest('hex'), '待发附件缩略图点击后查看原图字节');
  await evaluate(`document.querySelector('#imgViewerClose').click()`);
  const removeSize = await evaluate(`(()=>{const b=document.querySelector('#dshComposerMount .dsh-attr-remove'),r=b.getBoundingClientRect(),s=b.querySelector('svg'),q=s.getBoundingClientRect();return {width:r.width,height:r.height,svgWidth:q.width,svgHeight:q.height,dx:Math.abs(r.left+r.width/2-q.left-q.width/2),dy:Math.abs(r.top+r.height/2-q.top-q.height/2),title:b.title,aria:b.getAttribute('aria-label')}})()`);
  assert.deepEqual([removeSize.width,removeSize.height,removeSize.svgWidth,removeSize.svgHeight],[22,22,12,12], '移除按钮 22px，关闭图标 12px');
  assert.ok(removeSize.dx<0.5&&removeSize.dy<0.5, '关闭图标在按钮中居中');
  assert.ok(removeSize.title||removeSize.aria, '移除按钮有清晰的辅助说明');
  const removePoint = await evaluate(`(()=>{const r=document.querySelector('#dshComposerMount .dsh-attr-remove').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await call('Input.dispatchMouseEvent', { type:'mouseMoved', ...removePoint });
  await screenshot('按钮-移除待发图片悬停.png');
  const clearSize = await evaluate(`(()=>{const b=document.querySelector('.dsh-inputbar-clear'),r=b.getBoundingClientRect(),s=b.querySelector('svg'),q=s.getBoundingClientRect();return {width:r.width,height:r.height,svgWidth:q.width,svgHeight:q.height,dx:Math.abs(r.left+r.width/2-q.left-q.width/2),dy:Math.abs(r.top+r.height/2-q.top-q.height/2),title:b.title,aria:b.getAttribute('aria-label')}})()`);
  assert.deepEqual([clearSize.width,clearSize.height,clearSize.svgWidth,clearSize.svgHeight],[32,32,16,16], '清空会话按钮 32px，垃圾桶图标 16px');
  assert.ok(clearSize.dx<0.5&&clearSize.dy<0.5, '垃圾桶图标在按钮中居中');
  assert.match(`${clearSize.title} ${clearSize.aria}`, /保留|keep/i, '清空对话提示说明会保留图片');
  const clearPoint = await evaluate(`(()=>{const r=document.querySelector('.dsh-inputbar-clear').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await call('Input.dispatchMouseEvent', { type:'mouseMoved', ...clearPoint });
  await until(`getComputedStyle(document.querySelector('.dsh-inputbar-clear')).backgroundColor!=='rgba(0, 0, 0, 0)'`);
  const clearHover = await evaluate(`getComputedStyle(document.querySelector('.dsh-inputbar-clear')).backgroundColor`);
  assert.notEqual(clearHover, 'rgba(0, 0, 0, 0)', '悬停时清空按钮有底色');
  await screenshot('按钮-清空对话悬停.png');
  assert.deepEqual(exceptions, [], '浏览器没有未捕获异常');
  console.log(`浏览器回归全部通过：图片原图 ${full.width}×${full.height} SHA-256 ${bytes}；附件 remove=${removeSize.width}×${removeSize.height} svg=${removeSize.svgWidth}；clear=${clearSize.width}×${clearSize.height} svg=${clearSize.svgWidth}；无未捕获异常`);
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  await new Promise(resolve => provider.close(resolve));
  await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  await server.宿主.close();
  await Promise.race([new Promise(resolve => browser.once('exit', resolve)), sleep(3000)]);
  fixture.cleanup();
  try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch (error) { console.warn(`临时 Edge profile 暂未清理: ${error.code}`); }
}
