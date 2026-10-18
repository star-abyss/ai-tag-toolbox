import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { 起 } from '../服务.js';
import { 临时项目 } from './会话装置.js';

const fixture = 临时项目();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-worldbook-workspace-'));
const probe = net.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
let server = 起({ 端口: 0, 项目根: fixture.root, 数据目录: temp });
await new Promise(resolve => server.once('listening', resolve));
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`,
  `--user-data-dir=${path.join(temp, 'browser')}`, '--window-size=1400,1000', 'about:blank',
], { stdio: 'ignore' });
let ws;
const pending = new Map();
let seq = 0;
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
async function until(expression) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`页面条件未满足：${expression}`);
}
const screenshots = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../临时/截图');
fs.mkdirSync(screenshots, { recursive: true });
async function capture(name) {
  await new Promise(resolve => setTimeout(resolve, 250));
  const image = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(screenshots, name), Buffer.from(image.data, 'base64'));
}
async function clickVisible(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
  const point = await evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); const r=node.getBoundingClientRect(); if(!r.width || !r.height || node.disabled) throw new Error('控件不可点击'); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(row => row.type === 'page'); } catch {}
    if (!target) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(target, 'Edge CDP 页面已启动');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data), item = pending.get(result.id);
    if (item) { pending.delete(result.id); result.error ? item.reject(new Error(result.error.message)) : item.resolve(result.result); }
  });
  await call('Page.enable'); await call('Runtime.enable');
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await until(`window.App?.catalogStatus() === 'ready'`);
  await evaluate(`document.querySelector('#aiBtn')?.click(); document.querySelector('.ai-module-tab[data-panel="prompt"]')?.click()`);
  await until(`document.querySelector('#promptLibrary button[data-prompt-request="主AI"]') && document.querySelector('#promptBookSelect')`);

  const initial = await evaluate(`({request:document.querySelector('#promptModuleTitle')?.textContent, book:document.querySelector('#promptBookSelect')?.value, options:[...document.querySelector('#promptBookSelect').options].map(row=>row.value), enabled:document.querySelectorAll('#promptEnabledBooks [data-enabled-book]').length})`);
  assert.match(initial.request, /^主 AI/);
  assert.equal(initial.book, '$default:主AI', '初始主AI直接选择默认主AI世界书');
  assert.ok(initial.options.includes('$default:主AI'), '主AI默认世界书出现在当前模块书选择器');
  assert.ok(initial.enabled >= 1 && await evaluate(`!!document.querySelector('#promptEnabledBooks [data-enabled-book="$default:主AI"]')`), '主AI默认世界书初始启用');
  const defaultPrimary = await evaluate(`AppModules.调('worldbook','执行',{请求:'主AI',文本:''})`);
  assert.equal(defaultPrimary.书.some(row=>row.标识==='$default:主AI'), true, '主AI执行从统一世界书订阅读取默认书');
  assert.ok(defaultPrimary.命中.length >= 2, '默认主AI世界书提供身份和工作方式两条常驻内容');
  assert.equal(await evaluate(`!![...document.querySelectorAll('#promptEnableChoices button')].find(row=>row.textContent.includes('复制默认预设并启用'))`), false, '启停默认书不需要复制默认预设');
  assert.ok(await evaluate(`document.querySelector('#promptEditPreset') && !document.querySelector('#promptRequest')`), '预设经独立入口编辑，模块由左侧切换');
  for (const name of ['主AI', '文生图', '翻译', '识图']) assert.ok(await evaluate(`!!document.querySelector('#promptLibrary button[data-prompt-request="${name}"]')`), `${name}有独立入口`);

  await until(`document.querySelector('#promptBookEditor [data-entry-id]') && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  assert.equal(await evaluate(`document.querySelector('#promptBookSelect').selectedOptions[0].textContent`), '内置主AI世界书（只读）', '选择器明确标明内置世界书只读');
  assert.equal(await evaluate(`document.querySelector('#promptEditor .prompt-editor-heading h3').textContent`), '内置主AI世界书（只读）', '内置书标题与选择器名称一致');
  assert.equal(await evaluate(`document.querySelector('#promptEnabledBooks [data-enabled-book="$default:主AI"] > span').textContent`), '内置主AI世界书（只读）', '启用列表也标明内置只读名称');
  assert.equal(await evaluate(`document.querySelectorAll('#promptBookEditor [data-entry-depth], #promptBookEditor [data-entry-role]').length`), 0, '世界书不再显示实际不生效的深度与角色控件');
  assert.ok(await evaluate(`document.querySelectorAll('#promptBookEditor > details > summary [data-entry-strategy]').length===document.querySelectorAll('#promptBookEditor > [data-entry-id]').length`), '每个条目头显示启用方式指示灯');
  assert.ok(await evaluate(`document.querySelector('#promptBookReadonly').textContent.includes('请新建或导入') && document.querySelector('#promptBookCopy').textContent==='复制并新建'`), '醒目只读提示说明新建或导入自己的世界书，并提供复制并新建按钮');
  assert.equal(await evaluate(`document.querySelector('#promptBookRename')`), null, '默认书不画不可用改名按钮');
  assert.equal(await evaluate(`document.querySelector('#promptBookDelete')`), null, '默认书不画不可用删除按钮');
  const readonlyBefore = await evaluate(`AppModules.调('worldbook','读',{请求:'主AI',书:'$default:主AI'}).then(x=>x.书)`);
  await evaluate(`document.querySelector('#promptBookEditor [data-entry-id]').open=true`);
  await clickVisible('#promptBookEditor [data-entry-keys]');
  assert.ok(await evaluate(`document.querySelector('#toast').classList.contains('show') && document.querySelector('#toast').textContent.includes('复制并新建')`), '点击只读启用条件弹出文字提醒');
  assert.ok(await evaluate(`document.querySelector('#promptBookCopy').classList.contains('prompt-copy-attention') && document.querySelector('#promptBookCopy').getAnimations().length>0`), '提醒时复制并新建按钮高亮闪烁');
  await until(`!document.querySelector('#promptBookCopy').classList.contains('prompt-copy-attention')`);
  await clickVisible('#promptBookEditor [data-entry-id] [data-entry-text]');
  assert.ok(await evaluate(`document.querySelector('#toast').classList.contains('show') && document.querySelector('#toast').textContent.includes('只读') && document.querySelector('#promptBookCopy').classList.contains('prompt-copy-attention')`), '点击只读正文会再次提醒并重新闪烁');
  assert.ok(await evaluate(`(() => { const r=document.querySelector('#promptBookCopy').getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight; })()`), '提醒时将复制并新建按钮滚入视野');
  await clickVisible('#promptBookEditor [data-entry-id] summary .prompt-readonly-control:has([data-entry-strategy])');
  assert.equal(await evaluate(`document.querySelector('#promptBookEditor [data-entry-id]').open`), true, '点击只读启用方式提醒但不收起条目');
  await evaluate(`document.querySelector('#promptBookCopy').classList.remove('prompt-copy-attention'); document.querySelector('#toast').classList.remove('show'); document.querySelector('#promptBookEditor [data-entry-keys]').focus()`);
  await call('Input.dispatchKeyEvent', { type:'keyDown', key:'x', code:'KeyX', text:'x', windowsVirtualKeyCode:88 });
  await call('Input.dispatchKeyEvent', { type:'keyUp', key:'x', code:'KeyX', windowsVirtualKeyCode:88 });
  assert.ok(await evaluate(`document.querySelector('#toast').classList.contains('show') && document.querySelector('#promptBookCopy').classList.contains('prompt-copy-attention')`), '键盘尝试输入只读条件也提醒');
  assert.equal(await evaluate(`document.querySelector('#promptBookEditor [data-entry-keys]').value`), '', '只读条件仍保持原文');
  assert.deepEqual(await evaluate(`AppModules.调('worldbook','读',{请求:'主AI',书:'$default:主AI'}).then(x=>x.书)`), readonlyBefore, '尝试编辑不改变内置书任何数据');
  assert.equal(await evaluate(`document.querySelector('#promptBookSelect').value`), '$default:主AI', '提醒不会自动新建或切换世界书');
  await capture('内置世界书-编辑提醒.png');
  await call('Emulation.setDeviceMetricsOverride', { width:1920, height:1080, deviceScaleFactor:1, mobile:false });
  assert.ok(await evaluate(`document.querySelector('#promptWorkspace').getBoundingClientRect().width<=980`), '宽屏内容区有最大宽度，操作按钮不贴屏幕最右侧');
  await evaluate(`document.querySelector('#tabPrompt').scrollTop=0`);
  await capture('内置世界书-宽屏.png');
  await call('Emulation.setDeviceMetricsOverride', { width:1400, height:1000, deviceScaleFactor:1, mobile:false });
  await capture('启用方式-主AI条目列表.png');
  await clickVisible('#promptToolsEntry');
  assert.ok(await evaluate(`document.querySelector('#promptToolSearch').getBoundingClientRect().height > 0`), '主AI工具条目展开后直接显示注册表');
  await capture('启用方式-主AI工具条目.png');
  await clickVisible('#promptToolsEntry + .prompt-entry-body button');
  await until(`document.querySelector('#promptStatus')?.textContent.includes('工具设置已复制') && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  assert.ok(await evaluate(`!document.querySelector('[data-tool-summary]').readOnly`), '条目内复制工具设置后直接可编辑');
  assert.equal(await evaluate(`document.querySelector('#promptBookSelect').value`), '$default:主AI', '复制工具设置不改变当前世界书');
  await evaluate(`[...document.querySelectorAll('#promptToolsEntry + .prompt-entry-body button')].find(node=>node.textContent==='设为当前').click()`);
  await until(`document.querySelector('#promptStatus')?.textContent==='当前请求已切换设置' && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  assert.equal(await evaluate(`AppModules.调('主AI','执行',{请求:'主AI'}).then(x=>x.预设.标识)`), await evaluate(`document.querySelector('#promptPresetSelect').value`), '工具条目内设为当前影响实际启用设置');
  await clickVisible('#promptToolsEntry');
  await evaluate(`document.querySelector('#promptBookPicker').open=false; for(const row of document.querySelectorAll('#promptBookEditor [data-entry-id]')) row.open=true; document.querySelector('#tabPrompt').scrollTop=0; document.body.classList.remove('dark')`);
  await call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1600, deviceScaleFactor: 1, mobile: false });
  await capture('主AI默认世界书.png');
  await call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(`for(const row of document.querySelectorAll('#promptBookEditor [data-entry-id]')) row.open=false`);

  await clickVisible('#promptLibrary [data-prompt-request="文生图"]');
  await until(`document.querySelector('#promptModuleTitle')?.textContent.startsWith('文生图') && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  assert.equal(await evaluate(`document.querySelector('#promptBookSelect').selectedOptions[0].textContent`), '内置文生图世界书（只读）', '文生图内置书采用统一命名');
  await evaluate(`document.body.classList.add('dark'); document.querySelector('#tabPrompt').scrollTop=0`);
  await capture('世界书精简-文生图默认-深色.png');
  await evaluate(`document.body.classList.remove('dark')`);
  await capture('世界书精简-文生图默认-浅色.png');
  for(const width of [800,400]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth && document.querySelector('#promptWorkspace').scrollWidth<=document.querySelector('#promptWorkspace').clientWidth+1`), `${width}像素默认世界书没有横向溢出`);
    await capture(`世界书精简-文生图默认-${width}.png`);
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1400,height:1000,deviceScaleFactor:1,mobile:false});
  await clickVisible('#promptLibrary [data-prompt-request="主AI"]');
  await until(`document.querySelector('#promptModuleTitle')?.textContent.startsWith('主 AI') && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);

  await evaluate(`document.querySelector('#promptBookCopy')?.click()`);
  await until(`document.querySelector('#promptStatus')?.textContent.includes('副本已创建')`);
  const primaryCopy = await evaluate(`document.querySelector('#promptBookSelect').value`);
  assert.ok(primaryCopy && primaryCopy !== '$default:主AI', '复制默认主AI书创建可编辑用户书');
  assert.ok(await evaluate(`AppModules.调('worldbook','读',{请求:'主AI'}).then(x=>x.表.some(row=>row.标识===${JSON.stringify(primaryCopy)}))`), '复制书仍属于当前主AI模块');
  assert.ok(!(await evaluate(`AppModules.调('worldbook','读',{请求:'文生图'}).then(x=>x.表.some(row=>row.标识===${JSON.stringify(primaryCopy)}))`)), '复制书不出现在文生图目录');
  assert.deepEqual(await evaluate(`AppModules.调('worldbook','读',{请求:'主AI'}).then(x=>x.启用.map(row=>row.标识))`), ['$default:主AI'], '复制书不会改变当前启用列表');
  assert.ok(await evaluate(`document.querySelector('#promptBookManage')?.textContent.includes('新建世界书')`), '书籍管理使用文字动作');
  assert.deepEqual(await evaluate(`Array.from(document.querySelector('[data-entry-position]').options,row=>row.value)`), ['前','后','按深度'], '只可选择实际参与发送的三种位置');
  const copiedEntryId = await evaluate(`document.querySelector('[data-entry-id]').dataset.entryId`);
  await evaluate(`(() => { const row=document.querySelector('[data-entry-id]'); row.open=true; const title=row.querySelector('[data-entry-label]'); title.value='尚未保存的标题'; title.dispatchEvent(new Event('input',{bubbles:true})); const position=row.querySelector('[data-entry-position]'); position.value='后'; position.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  const unsavedEntry = await evaluate(`AppModules.调('worldbook','读',{请求:'主AI',书:${JSON.stringify(primaryCopy)}}).then(x=>x.书.条目.find(row=>row.id===${JSON.stringify(copiedEntryId)}))`);
  assert.equal(unsavedEntry.label,'身份','标题修改要显式保存');
  assert.equal(unsavedEntry.落点,'前','位置修改要显式保存');
  await evaluate(`(() => { const select=document.querySelector('#promptBookSelect'); select.value='$default:主AI'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await until(`document.querySelector('#promptBookReadonly') && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  await evaluate(`(() => { const select=document.querySelector('#promptBookSelect'); select.value=${JSON.stringify(primaryCopy)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await until(`document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false' && document.querySelector('[data-entry-label]')?.value==='尚未保存的标题'`);
  assert.equal(await evaluate(`document.querySelector('[data-entry-position]').value`),'后','切书后保留未保存位置');
  await clickVisible('#promptEntryAdd');
  await until(`document.querySelector('#promptStatus')?.textContent==='条目已添加' && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  assert.equal(await evaluate(`document.querySelector('[data-entry-label]').value`),'尚未保存的标题','添加条目保留其他条目的草稿');
  const extraEntry = await evaluate(`[...document.querySelectorAll('[data-entry-id]')].at(-1).dataset.entryId`);
  await evaluate(`document.querySelector('[data-entry-id="${extraEntry}"]').open=true`);
  await clickVisible(`[data-entry-id="${extraEntry}"] [data-delete-entry]`);
  await until(`document.querySelector('#cfmModal').classList.contains('show')`);
  await clickVisible('#cfmYes');
  await until(`!document.querySelector('[data-entry-id="${extraEntry}"]') && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  assert.equal(await evaluate(`document.querySelector('[data-entry-label]').value`),'尚未保存的标题','删除其他条目仍保留标题草稿');
  assert.equal(await evaluate(`document.querySelector('[data-entry-position]').value`),'后','删除其他条目仍保留位置草稿');
  await evaluate(`(() => { const entry=document.querySelector('#promptBookEditor [data-entry-id]'); entry.open=true; const field=entry.querySelector('[data-entry-text]'); field.value='复制后可编辑的主AI书正文'; field.dispatchEvent(new Event('input',{bubbles:true})); entry.querySelector('[data-save-entry]').click(); })()`);
  await until(`document.querySelector('#promptStatus')?.textContent==='条目已保存'`);
  assert.equal(await evaluate(`AppModules.调('worldbook','读',{请求:'主AI',书:${JSON.stringify(primaryCopy)}}).then(x=>x.书.条目[0].text)`), '复制后可编辑的主AI书正文', '复制后的自定义书正文可编辑保存');

  const ids = await evaluate(`(async()=>{
    const make=async(请求,名字,正文,keys=[])=>{
      const book=await AppModules.调('worldbook','书',{动作:'新建',请求,名字});
      await AppModules.调('worldbook','条目',{动作:'加',书:book.标识,条目:{label:名字+'条目',text:正文,always:!keys.length,keys,enabled:true}});
      return book.标识;
    };
    const a=await make('主AI','同名世界书','主AI专属命中正文',['needle phrase']);
    const b=await make('主AI','主AI第二本','主AI第二本常驻正文');
    const c=await make('主AI','未启用编辑书','未启用书正文');
    const cEntry=(await AppModules.调('worldbook','读',{请求:'主AI',书:c})).书.条目[0];
    await AppModules.调('worldbook','条目',{动作:'改',书:c,标识:cEntry.id,条目:{always:false,keys:[]}});
    const image=await make('文生图','同名世界书','文生图专属正文');
    await AppModules.调('worldbook','存');
    return {a,b,c,image};
  })()`);
  await call('Page.reload', { ignoreCache: true });
  await until(`window.App?.catalogStatus() === 'ready'`);
  await evaluate(`document.querySelector('#aiBtn')?.click(); document.querySelector('.ai-module-tab[data-panel="prompt"]')?.click()`);
  await until(`document.querySelector('#promptBookSelect')`);
  const options = await evaluate(`Array.from(document.querySelector('#promptBookSelect').options, row=>row.value)`);
  assert.ok(options.includes(ids.a) && options.includes(ids.b) && options.includes(ids.c), '主AI显示本请求用户书');
  assert.ok(!options.includes(ids.image), '文生图书不出现在主AI编辑列表');
  const table = await evaluate(`AppModules.调('worldbook','读',{请求:'文生图'}).then(x=>x.表.map(row=>row.标识))`);
  assert.ok(table.includes(ids.image) && !table.includes(ids.a), '底层按请求过滤书库，允许跨模块同名');
  const cross = await evaluate(`AppModules.调('worldbook','执行',{请求:'文生图',文本:'',启用:[${JSON.stringify(ids.a)}]})`);
  assert.equal(cross.code, 'PROMPT_BOOK_SCOPE_MISMATCH', '跨请求执行明确拒绝主AI的书');
  console.log('通过：主AI与文生图书库独立，接口拒绝跨请求执行');

  async function chooseBook(id) {
    await evaluate(`(() => { const select=document.querySelector('#promptBookSelect'); select.value=${JSON.stringify(id)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await until(`document.querySelector('#promptBookEditor [data-entry-id]') !== null`);
    await until(`document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  }
  async function setEnabled(scope,id,enabled) {
    await evaluate(`document.querySelector('#promptLibrary button[data-prompt-request="${scope}"]')?.click()`);
    await until(`document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
    await evaluate(`document.querySelector('#promptBookPicker').open=true`);
    await evaluate(`(() => { const input=document.querySelector('#promptEnableChoices input[data-book-choice="${id}"]'); if (!input) throw new Error('当前模块启用列表没有该书'); if (input.disabled) throw new Error('当前模块书启用控件意外禁用'); if (input.checked!==${enabled}) input.click(); })()`);
    if (enabled) await until(`document.querySelector('#promptEnabledBooks [data-enabled-book="${id}"]')`);
    else await until(`!document.querySelector('#promptEnabledBooks [data-enabled-book="${id}"]')`);
  }

  await evaluate(`document.querySelector('#promptLibrary button[data-prompt-request="主AI"]').click()`);
  await new Promise(resolve=>setTimeout(resolve,100));
  await chooseBook(ids.a);
  const entryId = await evaluate(`document.querySelector('#promptBookEditor [data-entry-id]').dataset.entryId`);
  await evaluate(`(() => { const row=document.querySelector('[data-entry-id="${entryId}"]'); row.open=true;
    const strategy=row.querySelector('[data-entry-strategy]'); strategy.value='false'; strategy.dispatchEvent(new Event('change',{bubbles:true}));
    const keys=row.querySelector('[data-entry-keys]'); keys.value='needle phrase\\nsecond needle'; keys.dispatchEvent(new Event('input',{bubbles:true}));
    const text=row.querySelector('[data-entry-text]'); text.value='A草稿正文，尚未保存'; text.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await setEnabled('主AI', ids.b, true);
  await chooseBook(ids.a);
  assert.equal(await evaluate(`document.querySelector('[data-entry-id="${entryId}"] [data-entry-text]').value`), 'A草稿正文，尚未保存', '启用另一本书后正文草稿保留');
  assert.equal(await evaluate(`document.querySelector('[data-entry-id="${entryId}"] [data-entry-keys]').value`), 'needle phrase\nsecond needle', '启用另一本书后关键词草稿保留');
  assert.equal(await evaluate(`document.querySelector('[data-entry-id="${entryId}"]').open`), true, '启用状态变化后条目展开状态保留');
  assert.equal((await evaluate(`AppModules.调('worldbook','读',{请求:'主AI'}).then(x=>x.启用.map(row=>row.标识))`)).includes(ids.a), false, '正在编辑A不会自动启用A');
  await evaluate(`document.querySelector('#promptBookEditor [data-entry-id] [data-save-entry]').click()`);
  await until(`document.querySelector('#promptStatus')?.textContent==='条目已保存'`);
  assert.deepEqual(await evaluate(`AppModules.调('worldbook','读',{请求:'主AI',书:${JSON.stringify(ids.a)}}).then(x=>x.书.条目[0].keys)`), ['needle phrase','second needle'], '关键词以每行一个的编辑结果保存');

  const matched = await evaluate(`AppModules.调('worldbook','执行',{请求:'主AI',文本:'please include needle phrase',启用:[${JSON.stringify(ids.a)},${JSON.stringify(ids.b)}]})`);
  const missed = await evaluate(`AppModules.调('worldbook','执行',{请求:'主AI',文本:'plain text without terms',启用:[${JSON.stringify(ids.a)},${JSON.stringify(ids.b)}]})`);
  assert.ok(matched.命中.some(row=>row.文本.includes('A草稿正文')), '关键词命中时条目加入执行结果');
  assert.ok(!missed.命中.some(row=>row.文本.includes('A草稿正文')), '关键词未命中时条目不进入结果');
  assert.ok(matched.命中.some(row=>row.文本.includes('主AI第二本常驻正文')), '多个启用书同时生效');
  const noKeys = await evaluate(`AppModules.调('worldbook','执行',{请求:'主AI',文本:'普通原文',启用:[${JSON.stringify(ids.c)}]})`);
  assert.ok(!noKeys.命中.some(row=>row.文本.includes('未启用书正文')), '关键词模式没有关键词时不作为常驻条目命中');
  await setEnabled('主AI', ids.a, true);
  await setEnabled('主AI', ids.a, false);
  await setEnabled('主AI', ids.b, false);
  await setEnabled('主AI', '$default:主AI', false);
  assert.deepEqual(await evaluate(`AppModules.调('worldbook','读',{请求:'主AI'}).then(x=>x.启用.map(row=>row.标识))`), [], '可将当前模块全部书停用');

  await setEnabled('文生图', ids.image, true);
  assert.deepEqual(await evaluate(`AppModules.调('worldbook','读',{请求:'文生图'}).then(x=>x.启用.map(row=>row.标识))`), ['$default:文生图', ids.image], '文生图独立启用自己的书');
  await evaluate(`document.querySelector('#promptLibrary button[data-prompt-request="主AI"]').click()`);
  await new Promise(resolve=>setTimeout(resolve,100));
  const mainOptions = await evaluate(`Array.from(document.querySelector('#promptBookSelect').options,row=>row.value)`);
  assert.ok(mainOptions.includes(ids.a) && !mainOptions.includes(ids.image), '切回主AI时选择器只显示本模块书');
  await chooseBook(ids.c);
  await evaluate(`(() => { const row=document.querySelector('[data-entry-id]'); row.open=true; const strategy=row.querySelector('[data-entry-strategy]'); strategy.value='false'; strategy.dispatchEvent(new Event('change',{bubbles:true})); row.querySelector('[data-entry-text]').value='切换后仍保留的C草稿'; row.querySelector('[data-entry-text]').dispatchEvent(new Event('input',{bubbles:true})); row.querySelector('[data-entry-keys]').value='草稿关键词'; row.querySelector('[data-entry-keys]').dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await evaluate(`document.querySelector('#promptLibrary button[data-prompt-request="文生图"]').click()`);
  await until(`document.querySelector('#promptModuleTitle')?.textContent.startsWith('文生图') && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  await evaluate(`document.querySelector('#promptLibrary button[data-prompt-request="主AI"]').click()`);
  await until(`document.querySelector('#promptModuleTitle')?.textContent.startsWith('主 AI') && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  await chooseBook(ids.c);
  assert.equal(await evaluate(`document.querySelector('[data-entry-id] [data-entry-text]').value`), '切换后仍保留的C草稿', '切模块后恢复该书正文草稿');
  assert.equal(await evaluate(`document.querySelector('[data-entry-id] [data-entry-keys]').value`), '草稿关键词', '切模块后恢复该书关键词草稿');
  assert.equal(await evaluate(`document.querySelector('[data-entry-id]').open`), true, '切模块后恢复该书条目展开状态');
  assert.deepEqual(await evaluate(`AppModules.调('worldbook','读',{请求:'主AI'}).then(x=>x.启用.map(row=>row.标识))`), [], '编辑未启用的C仍不会挂入主AI');

  const blobExport = await evaluate(`(async()=>{
    let captured; const original=URL.createObjectURL; URL.createObjectURL=blob=>{captured=blob; return 'blob:worldbook-test'};
    document.querySelector('#promptBookExport').click(); await new Promise(resolve=>setTimeout(resolve,100)); URL.createObjectURL=original;
    if(!captured) throw new Error('导出没有生成文件内容'); return await captured.text();
  })()`);
  const exportData = JSON.parse(blobExport);
  assert.equal(exportData.name, '未启用编辑书', '导出当前编辑的单本书');
  assert.ok(exportData.entries.some(row=>row.text==='未启用书正文'), '导出内容只对应当前书');
  const imported = await evaluate(`(async()=>{
    const input=document.querySelector('#promptBookActions [data-book-import-file]');
    const file=new File([${JSON.stringify(blobExport)}],'单本导入.json',{type:'application/json'});
    Object.defineProperty(input,'files',{configurable:true,value:[file]}); input.dispatchEvent(new Event('change',{bubbles:true}));
    for(let i=0;i<100;i++){await new Promise(resolve=>setTimeout(resolve,50)); const rows=(await AppModules.调('worldbook','读',{请求:'主AI'})).表; const row=rows.find(item=>item.名字==='未启用编辑书 2'); if(row) return row.标识;}
    throw new Error('导入新书未出现在当前模块书库');
  })()`);
  assert.ok(imported, '单本导入成功');
  assert.ok(!(await evaluate(`AppModules.调('worldbook','读',{请求:'文生图'}).then(x=>x.表.some(row=>row.标识===${JSON.stringify(imported)}))`)), '导入书只归属当前模块');
  assert.ok(!(await evaluate(`AppModules.调('worldbook','读',{请求:'主AI'}).then(x=>x.启用.some(row=>row.标识===${JSON.stringify(imported)}))`)), '导入不自动启用');

  await until(`document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  await evaluate(`(() => { const file=new File([JSON.stringify({name:'未装配位置样例',entries:[{id:'keep',label:'未装配条目',text:'原始正文',always:true,enabled:true,落点:'顶部'}]})],'位置样例.json',{type:'application/json'}); const input=document.querySelector('[data-book-import-file]'); Object.defineProperty(input,'files',{configurable:true,value:[file]}); input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await until(`document.querySelector('#promptBookSelect')?.selectedOptions[0]?.textContent==='未装配位置样例' && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  const unsupportedBook = await evaluate(`document.querySelector('#promptBookSelect').value`);
  assert.equal(await evaluate(`document.querySelector('[data-entry-position]').value`),'顶部','导入未支持的位置保留原值');
  assert.ok(await evaluate(`document.querySelector('#promptBookEditor').textContent.includes('当前不参与发送')`),'未装配位置有明确说明');
  await evaluate(`(() => { const row=document.querySelector('[data-entry-id]'); row.open=true; const text=row.querySelector('[data-entry-text]'); text.value='仅修改正文'; text.dispatchEvent(new Event('input',{bubbles:true})); row.querySelector('[data-save-entry]').click(); })()`);
  await until(`document.querySelector('#promptStatus')?.textContent==='条目已保存'`);
  assert.equal(await evaluate(`AppModules.调('worldbook','读',{请求:'主AI',书:${JSON.stringify(unsupportedBook)}}).then(x=>x.书.条目[0].落点)`),'顶部','保存其他字段不会静默改写导入位置');

  await clickVisible('#promptBookManage > summary');
  await clickVisible('#promptBookAdd');
  await until(`document.querySelector('#promptStatus')?.textContent.includes('世界书已新建') && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  const createdBook = await evaluate(`document.querySelector('#promptBookSelect').value`);
  assert.ok(!(await evaluate(`AppModules.调('worldbook','读',{请求:'主AI'}).then(x=>x.启用.some(row=>row.标识===${JSON.stringify(createdBook)}))`)),'从可见文字菜单新建不自动启用');
  await clickVisible('#promptEntryAdd');
  await until(`document.querySelector('[data-entry-id]') && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  await evaluate(`document.querySelector('[data-entry-id]').open=true`);
  await clickVisible('[data-delete-entry]');
  await until(`document.querySelector('#cfmModal').classList.contains('show')`);
  await clickVisible('#cfmNo');
  assert.equal(await evaluate(`document.querySelectorAll('[data-entry-id]').length`),1,'取消删除保留条目');
  await clickVisible('[data-delete-entry]');
  await until(`document.querySelector('#cfmModal').classList.contains('show')`);
  await clickVisible('#cfmYes');
  await until(`document.querySelectorAll('[data-entry-id]').length===0 && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  assert.equal(await evaluate(`AppModules.调('worldbook','读',{请求:'主AI',书:${JSON.stringify(createdBook)}}).then(x=>x.书.条目.length)`),0,'确认删除经模块保存');

  await evaluate(`document.querySelector('#promptBookSelect').value=${JSON.stringify(ids.a)}; document.querySelector('#promptBookSelect').dispatchEvent(new Event('change',{bubbles:true}))`);
  await until(`document.querySelector('#promptBookEditor [data-entry-id]')`);
  await until(`document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  await evaluate(`document.querySelector('#promptBookPicker').open=false; document.querySelector('#promptBookEditor [data-entry-id]').open=true; document.body.classList.add('dark'); document.querySelector('#tabPrompt').scrollTop=0`);
  await capture('提示词工作区-深色.png');
  await evaluate(`document.body.classList.remove('dark')`); await capture('提示词工作区-浅色.png');
  for (const width of [800, 400]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    assert.ok(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), `${width}px页面没有横向溢出`);
    assert.ok(await evaluate(`document.querySelector('#promptWorkspace').scrollWidth <= document.querySelector('#promptWorkspace').clientWidth + 1`), `${width}px右侧工作区没有横向溢出`);
    await capture(`提示词工作区-${width}.png`);
  }

  await setEnabled('主AI', ids.a, true); await setEnabled('主AI', ids.b, true);
  await evaluate(`AppModules.调('worldbook','书',{动作:'删',标识:${JSON.stringify(ids.a)}})`);
  await evaluate(`AppModules.调('worldbook','存')`);
  const afterDelete = await evaluate(`AppModules.调('worldbook','读',{请求:'主AI'}).then(x=>x.启用.map(row=>row.标识))`);
  assert.ok(!afterDelete.includes(ids.a) && afterDelete.includes(ids.b), '删除书从统一订阅移除该书并保留另一本');
  await evaluate(`AppModules.调('worldbook','书',{动作:'换',请求:'主AI',启用:[]})`);
  await evaluate(`AppModules.调('worldbook','存')`);

  server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  server = 起({ 端口: 0, 项目根: fixture.root, 数据目录: temp }); await new Promise(resolve=>server.once('listening',resolve));
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await until(`window.App?.catalogStatus() === 'ready'`);
  await evaluate(`document.querySelector('#aiBtn')?.click(); document.querySelector('.ai-module-tab[data-panel="prompt"]')?.click()`);
  await until(`document.querySelector('#promptBookSelect')`);
  assert.deepEqual(await evaluate(`AppModules.调('worldbook','读',{请求:'主AI'}).then(x=>x.启用.map(row=>row.标识))`), [], '刷新并重启后全停用状态不恢复隐藏默认书');
  const emptyAfterRestart = await evaluate(`AppModules.调('worldbook','执行',{请求:'主AI',文本:''})`);
  assert.deepEqual(emptyAfterRestart.命中, [], '刷新并重启后没有隐藏身份或工作方式命中');
  assert.equal(await evaluate(`document.querySelector('#psPrimaryFull,#psPrimaryFlow')`), null, '清空订阅后界面没有旧身份流程字段');
  await evaluate(`document.querySelector('#promptEditPreset')?.click()`);
  await until(`document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  await evaluate(`([...document.querySelectorAll('#promptEditor button')].find(row=>row.textContent==='按存档生成预览'))?.click()`);
  await until(`document.querySelector('#psPrimaryPreview')?.value`);
  const emptyPreview = JSON.parse(await evaluate(`document.querySelector('#psPrimaryPreview').value`));
  assert.deepEqual(emptyPreview.世界书命中, [], '主AI预览遵循空的统一世界书订阅');
  assert.ok(!emptyPreview.系统消息.includes('你是这个本地工具箱里的绘画助手') && !emptyPreview.系统消息.includes('## 查找与选择'), '空订阅预览没有默认身份或工作方式残留');
  assert.ok(await evaluate(`document.querySelector('#promptBookSelect option[value="${ids.b}"]')`), '服务重启后未删主AI书仍在本模块');
  assert.ok(!(await evaluate(`document.querySelector('#promptBookSelect option[value="${ids.image}"]')`)), '服务重启后跨模块书仍不可见');
  assert.deepEqual(await evaluate(`AppModules.调('worldbook','读',{请求:'文生图'}).then(x=>x.启用.map(row=>row.标识))`), ['$default:文生图', ids.image], '服务重启后文生图独立启用状态仍存在');
  console.log('通过：模块世界书工作区真实浏览器验收，多本启用、全停、单书编辑与导入导出、关键词、草稿、范围隔离、重启持久化及截图');} finally {
  ws?.close();
  browser.kill();
  await new Promise(resolve => {
    if (browser.exitCode !== null) return resolve();
    browser.once('exit', resolve);
    setTimeout(resolve, 1500).unref();
  });
  server.closeAllConnections();
  server.close();
  fixture.cleanup();
  try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (error) { if (error.code !== 'EPERM' && error.code !== 'EBUSY') throw error; }
}
