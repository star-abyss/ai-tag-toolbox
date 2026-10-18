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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-prompt-list-'));
const probe = net.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const server = 起({ 端口: 0, 项目根: fixture.root, 数据目录: temp });
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
    const result = JSON.parse(event.data);
    const item = pending.get(result.id);
    if (item) {
      pending.delete(result.id);
      result.error ? item.reject(new Error(result.error.message)) : item.resolve(result.result);
    }
  });
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await until(`window.App?.catalogStatus() === 'ready'`);
  await evaluate(`document.querySelector('#aiBtn')?.click(); document.querySelector('.ai-module-tab[data-panel="prompt"]')?.click()`);
  await until(`document.querySelector('#promptLibrary button[data-prompt-request="主AI"]') && document.querySelector('#promptBookSelect')`);
  const switchTo = async name => {
    await until(`document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
    await evaluate(`document.querySelector('#promptLibrary button[data-prompt-request="${name}"]')?.click()`);
    await until(`document.querySelector('#promptModuleTitle')?.textContent.startsWith('${name === '主AI' ? '主 AI' : name}') && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  };

  for (const name of ['翻译', '识图', '文生图']) {
    await switchTo(name);
    const world = await evaluate(`AppModules.调('worldbook','执行',{请求:${JSON.stringify(name)},文本:''})`);
    assert.deepEqual(world.书.map(row => row.标识), [`$default:${name}`], `${name}请求默认使用对应基础提示词`);
    assert.ok(world.命中.length > 0, `${name}请求不经手动勾选即产生基础提示词`);
    assert.equal(await evaluate(`!!document.querySelector('#promptEnabledBooks [data-enabled-book="$default:${name}"]')`), true, `${name}基础提示词在当前模块顶部显示为启用`);
  }
  const mainWorld = await evaluate(`AppModules.调('worldbook','执行',{请求:'主AI',文本:''})`);
  assert.deepEqual(mainWorld.书.map(row => row.标识), ['$default:主AI'], '主AI身份和工作方式来自统一启用的默认世界书');
  assert.deepEqual(mainWorld.命中.map(row => row.落点), ['前','前'], '默认身份和工作方式按常驻条目注入');
  const primaryEntries = await evaluate(`AppModules.调('worldbook','读',{请求:'主AI',书:'$default:主AI'}).then(x=>x.书.条目)`);
  assert.deepEqual(primaryEntries.map(row=>row.label), ['身份','工作方式'], '默认主AI书只有身份与工作方式两条内容');
  assert.ok(primaryEntries.every(row=>row.always && row.enabled), '默认身份和工作方式均为启用常驻条目');
  await switchTo('翻译');
  await evaluate(`document.querySelector('#promptEnabledBooks [data-remove-book="$default:翻译"]').click()`);
  await until(`document.querySelector('#promptStatus')?.textContent.includes('「翻译」已停用')`);
  assert.deepEqual((await evaluate(`AppModules.调('worldbook','执行',{请求:'翻译',文本:''})`)).书, [], '用户仍可关闭默认基础提示词');
  await call('Page.reload', { ignoreCache: true });
  await until(`window.App?.catalogStatus() === 'ready'`);
  await evaluate(`document.querySelector('#aiBtn')?.click(); document.querySelector('.ai-module-tab[data-panel="prompt"]')?.click()`);
  await until(`document.querySelector('#promptBookSelect') !== null`);
  await switchTo('翻译');
  assert.equal(await evaluate(`!!document.querySelector('#promptEnabledBooks [data-enabled-book="$default:翻译"]')`), false, '刷新后保留用户主动停用状态');
  await evaluate(`(() => { document.querySelector('#promptBookPicker').open=true; document.querySelector('#promptEnableChoices input[data-book-choice="$default:翻译"]').click(); })()`);
  await until(`document.querySelector('#promptStatus')?.textContent.includes('「翻译」已启用')`);

  await switchTo('主AI');
  await evaluate(`document.querySelector('#promptEditPreset')?.click()`);
  await until(`document.querySelector('#promptModelLink') !== null && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  assert.equal(await evaluate(`document.querySelector('#psPrimaryFull,#psPrimaryFlow')`), null, '设置编辑器不保存身份流程字段');
  const booksBeforeSettings = await evaluate(`AppModules.调('worldbook','读',{请求:'主AI'}).then(x=>x.启用.map(row=>row.标识))`);
  await evaluate(`document.querySelector('#promptActivationSettings').open=true; document.querySelector('#promptName').value = '提示词设置回归'; document.querySelector('#promptSetAdd').click()`);
  await until(`document.querySelector('#promptStatus')?.textContent.includes('已新建并启用用户设置')`);
  await until(`document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  await evaluate(`document.querySelector('[data-prompt-section="model"]').click(); document.querySelector('#promptModelLink').value='ui-test'; document.querySelector('#promptModelName').value='prompt-list-model'; document.querySelector('#promptModelName').dispatchEvent(new Event('input')); document.querySelector('#promptSave').click()`);
  await until(`document.querySelector('#promptStatus')?.textContent === '设置已保存'`);
  const settingId = await evaluate(`document.querySelector('#promptPresetSelect').value`);
  assert.deepEqual(await evaluate(`AppModules.调('worldbook','读',{请求:'主AI'}).then(x=>x.启用.map(row=>row.标识))`), booksBeforeSettings, '切换和保存用户设置不改变世界书启用');
  const saved = await evaluate(`AppModules.调('主AI','执行',{请求:'主AI'})`);
  assert.equal(saved.模型.走, 'ui-test', '模型配置作为独立用户设置保存');

  await switchTo('文生图');
  await evaluate(`(() => { const select=document.querySelector('#promptBookSelect'); select.value='$default:文生图'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await until(`document.querySelectorAll('[data-entry-id]').length > 0`);
  await until(`document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  await evaluate(`document.querySelector('#promptBookCopy').click()`);
  await until(`document.querySelector('#promptStatus')?.textContent.includes('副本已创建')`);
  await until(`document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  await until(`document.querySelector('#promptBookEditor [data-entry-id]') !== null`);
  assert.ok(await evaluate(`document.querySelector('#promptBookEditor [data-entry-id] [data-entry-label]') !== null`), '世界书列表显示行内标题');
  assert.ok(await evaluate(`document.querySelector('#promptBookSearch') !== null`), '世界书列表有搜索框');
  assert.ok(await evaluate(`document.querySelector('#promptBookExpand') !== null`), '世界书列表有全部展开');
  assert.equal(await evaluate(`document.querySelector('#promptBookCollapse')`), null, '世界书只保留一个展开收起按钮');
  assert.ok(await evaluate(`document.querySelector('#promptBookEditor [data-entry-id] > summary input[type="checkbox"]') !== null`), '条目摘要行提供启用开关');
  await evaluate(`for(const row of document.querySelectorAll('#promptBookEditor [data-entry-id]')) row.open=false`);
  assert.equal(await evaluate(`document.querySelectorAll('#promptBookEditor [data-entry-id][open]').length`), 0, '全部收起关闭每条正文');
  await evaluate(`document.querySelector('#promptBookExpand').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('#promptBookEditor [data-entry-id]:not([open])').length`), 0, '全部展开打开每条正文');
  await evaluate(`document.querySelector('#promptBookExpand').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('#promptBookEditor [data-entry-id][open]').length`), 0, '同一按钮可收起全部正文');
  const searchMatched = await evaluate(`(() => { const row=document.querySelector('#promptBookEditor [data-entry-id]'); const title=row.querySelector('.prompt-entry-title').textContent.trim(); const input=document.querySelector('#promptBookSearch'); input.value=title; input.dispatchEvent(new Event('input')); return document.querySelectorAll('#promptBookEditor [data-entry-id]:not([hidden])').length; })()`);
  assert.equal(searchMatched, 1, '搜索标题只保留匹配条目');
  await evaluate(`document.querySelector('#promptBookSearch').value = ''; document.querySelector('#promptBookSearch').dispatchEvent(new Event('input'))`);
  const entryState = await evaluate(`(() => { const item=[...document.querySelectorAll('#promptBookEditor [data-entry-id]')].find(row=>row.querySelector('[data-entry-strategy]')?.value==='true'); item.open=true; return { id:item.dataset.entryId, book:document.querySelector('#promptBookSelect').value, text:item.querySelector('[data-entry-text]').value, keys:item.querySelector('[data-entry-keys]').value, always:item.querySelector('[data-entry-strategy]').value, enabled:item.querySelector('summary input[type="checkbox"]').checked }; })()`);
  assert.ok(entryState.book, '行内编辑对应一份选中的用户世界书');
  assert.equal(entryState.always, 'true', '策略控件以 true/false 表示常驻或关键词触发');
  assert.equal(entryState.enabled, true, '行内启用开关与触发策略独立');
  assert.ok(await evaluate(`(() => { const row=document.querySelector('#promptBookEditor [data-entry-id="${entryState.id}"]'); return row.querySelector('summary [data-entry-strategy]')?.selectedOptions[0].textContent.includes('🔵') && row.querySelector('[data-entry-keys]').getBoundingClientRect().height > 0; })()`), '一直启用在条目头显示蓝灯，展开后仍可输入启用条件');
  const uniqueText = '提示词列表行内开关保留正文 ' + entryState.id;
  await evaluate(`(() => { const item=document.querySelector('#promptBookEditor [data-entry-id="${entryState.id}"]'); const strategy=item.querySelector('[data-entry-strategy]'); strategy.value='false'; strategy.dispatchEvent(new Event('change',{bubbles:true})); const text=item.querySelector('[data-entry-text]'); text.value=${JSON.stringify(uniqueText)}; text.dispatchEvent(new Event('input',{bubbles:true})); const keys=item.querySelector('[data-entry-keys]'); keys.value='提示词列表行内开关保留正文'; keys.dispatchEvent(new Event('input',{bubbles:true})); item.querySelector('summary input[type="checkbox"]').click(); })()`);
  assert.equal(await evaluate(`document.querySelector('#promptBookEditor [data-entry-id="${entryState.id}"]').open`), true, '点击行首开关不折叠条目');
  assert.equal(await evaluate(`document.querySelector('#promptBookEditor [data-entry-id="${entryState.id}"] summary input[type="checkbox"]').checked`), false, '点击行首开关即时切换');
  const bookId = entryState.book;
  const toggleRead = async () => evaluate(`AppModules.调('worldbook','读',{书:${JSON.stringify(bookId)}})`);
  let currentBook;
  for (let i = 0; i < 50; i++) {
    const read = await toggleRead();
    assert.ok(read?.书, '世界书读动作返回书快照');
    currentBook = read;
    if (currentBook?.书?.条目?.find(row => row.id === entryState.id)?.enabled === false) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  let currentEntry = currentBook?.书?.条目?.find(row => row.id === entryState.id);
  assert.equal(currentEntry?.enabled, false, '行内停用写入世界书模块');
  assert.equal(currentEntry?.always, true, '策略草稿未保存时没有提交到世界书模块');
  assert.deepEqual(currentEntry?.keys, [], '策略草稿未保存时关键词仍是存档值');
  assert.equal(await evaluate(`document.querySelector('#promptBookEditor [data-entry-id="${entryState.id}"] [data-entry-text]')?.value`), uniqueText, '行内停用保留尚未保存的正文编辑');
  await evaluate(`document.querySelector('#promptBookEditor [data-entry-id="${entryState.id}"] button[data-save-entry]').click()`);
  await until(`document.querySelector('#promptStatus')?.textContent === '条目已保存'`);
  const persistedRead = await toggleRead();
  assert.ok(persistedRead?.书, '保存后世界书读动作返回书快照');
  const persistedEntry = persistedRead.书.条目.find(row => row.id === entryState.id);
  assert.equal(persistedEntry.enabled, false, '行内开关状态写入世界书模块');
  assert.equal(persistedEntry.text, uniqueText, '停用后继续保存仍保留正文编辑');
  assert.equal(persistedEntry.always, false, '显式保存策略后切换为关键词触发');
  assert.deepEqual(persistedEntry.keys, ['提示词列表行内开关保留正文'], '关键词编辑器按行存储普通文本');
  const execution = await evaluate(`AppModules.调('worldbook','执行',{请求:'文生图',文本:${JSON.stringify(uniqueText)},启用:[${JSON.stringify(bookId)}]})`);
  assert.ok(execution?.命中, '世界书执行动作返回命中列表');
  const disabledHit = execution;
  assert.equal(disabledHit.命中.some(row => row.文本.includes(uniqueText)), false, '停用条目不再进入世界书执行结果');
  assert.ok(await evaluate(`document.querySelector('#promptBookEditor [data-entry-id="${entryState.id}"] [data-entry-strategy]').selectedOptions[0].textContent.includes('🟢')`), '保存条件启用后显示绿灯');
  await evaluate(`document.querySelector('#promptBookEditor [data-entry-id="${entryState.id}"] summary input[type="checkbox"]').click()`);
  await until(`document.querySelector('#promptStatus')?.textContent.includes('已启用')`);
  await evaluate(`(() => { const row=document.querySelector('#promptBookEditor [data-entry-id="${entryState.id}"]'); row.open=true; const strategy=row.querySelector('[data-entry-strategy]'); strategy.value='true'; strategy.dispatchEvent(new Event('change')); row.querySelector('[data-save-entry]').click(); })()`);
  await until(`document.querySelector('#promptStatus')?.textContent === '条目已保存'`);
  const alwaysRead = await toggleRead();
  assert.deepEqual(alwaysRead.书.条目.find(row => row.id === entryState.id).keys, ['提示词列表行内开关保留正文'], '切回一直启用并保存后保留条件');
  assert.ok((await evaluate(`AppModules.调('worldbook','执行',{请求:'文生图',文本:'',启用:[${JSON.stringify(bookId)}]})`)).命中.some(row => row.文本 === uniqueText), '蓝灯一直启用不要求关键词命中');
  await evaluate(`(() => { const row=document.querySelector('#promptBookEditor [data-entry-id="${entryState.id}"]'); const strategy=row.querySelector('[data-entry-strategy]'); strategy.value='false'; strategy.dispatchEvent(new Event('change')); row.querySelector('[data-save-entry]').click(); })()`);
  await until(`document.querySelector('#promptStatus')?.textContent === '条目已保存'`);
  assert.ok(!(await evaluate(`AppModules.调('worldbook','执行',{请求:'文生图',文本:'',启用:[${JSON.stringify(bookId)}]})`)).命中.some(row => row.文本 === uniqueText), '绿灯条件启用未命中时不发送正文');
  assert.ok((await evaluate(`AppModules.调('worldbook','执行',{请求:'文生图',文本:'提示词列表行内开关保留正文',启用:[${JSON.stringify(bookId)}]})`)).命中.some(row => row.文本 === uniqueText), '绿灯条件启用命中后发送正文');

  await switchTo('主AI');
  await evaluate(`document.querySelector('#promptEditPreset')?.click()`);
  await until(`document.querySelector('[data-tool-name="tags_search"]') !== null && document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  await evaluate(`document.querySelector('[data-prompt-section="tools"]').click()`);
  await until(`document.querySelector('[data-tool-name="tags_search"] summary input[type="checkbox"]') !== null`);
  await evaluate(`(() => { const row=document.querySelector('[data-tool-name="tags_search"]'); row.open=true; const field=row.querySelector('[data-parameter-path="查询"]'); field.value='提示词列表工具脏编辑'; field.dispatchEvent(new Event('input',{bubbles:true})); row.querySelector('summary input[type="checkbox"]').click(); })()`);
  await until(`document.querySelector('#promptStatus')?.textContent.includes('工具 tags_search已停用')`);
  assert.equal(await evaluate(`document.querySelector('[data-tool-name="tags_search"]').open`), true, '工具行首开关不折叠条目');
  assert.equal(await evaluate(`document.querySelector('[data-tool-name="tags_search"] summary input[type="checkbox"]').checked`), false, '工具行首开关即时切换');
  assert.equal(await evaluate(`document.querySelector('[data-tool-name="tags_search"] [data-parameter-path="查询"]').value`), '提示词列表工具脏编辑', '工具行内切换保留未保存参数编辑');
  await evaluate(`document.querySelector('[data-tool-name="tags_search"] button').click()`);
  await until(`document.querySelector('#promptStatus')?.textContent === '工具已保存'`);
  const presetAfterTool = await evaluate(`AppModules.调('主AI','读',{请求:'主AI',预设:${JSON.stringify(settingId)}})`);
  assert.equal(presetAfterTool.预设.工具表.find(row => row.名字 === 'tags_search').启用, false, '工具行内开关写入当前预设');
  assert.equal(presetAfterTool.预设.工具表.find(row => row.名字 === 'tags_search').参数.查询.description, '提示词列表工具脏编辑', '保存工具时保留开关前的参数编辑');

  const screenshots = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../临时/截图');
  fs.mkdirSync(screenshots, { recursive: true });
  async function capture(name) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const image = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(screenshots, name), Buffer.from(image.data, 'base64'));
  }
  await evaluate(`(() => { document.querySelector('[data-prompt-section="model"]').parentElement.open=true; document.querySelector('#tabPrompt').scrollTop=0; document.body.classList.remove('dark'); })()`);
  await capture('提示词列表-主页浅色.png');
  await evaluate(`document.body.classList.add('dark')`);
  await capture('提示词列表-主页深色.png');
  await switchTo('文生图');
  await evaluate(`document.body.classList.remove('dark'); (() => { const select=document.querySelector('#promptBookSelect'); select.value='$default:文生图'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await until(`document.querySelector('#promptBookEditor [data-entry-id]') !== null`);
  await until(`document.querySelector('#promptWorkspace')?.getAttribute('aria-busy') === 'false'`);
  await evaluate(`(() => { const rows=document.querySelectorAll('#promptBookEditor [data-entry-id]'); for (const row of rows) row.open=false; if (rows[0]) rows[0].open=true; document.querySelector('#tabPrompt').scrollTop=0; })()`);
  await capture('提示词列表-文生图浅色.png');
  await evaluate(`document.body.classList.add('dark')`);
  await evaluate(`(() => { for (const row of document.querySelectorAll('#promptBookEditor [data-entry-id]')) row.open=false; })()`);
  await capture('提示词列表-文生图列表深色.png');
  await evaluate(`(() => { const rows=document.querySelectorAll('#promptBookEditor [data-entry-id]'); if (rows[0]) rows[0].open=true; })()`);
  await capture('提示词列表-文生图深色.png');
  await evaluate(`document.body.classList.remove('dark')`);
  for (const width of [800, 400]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    assert.ok(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), `${width}px 窄窗无页面横向溢出`);
    await capture(`提示词列表-窄窗${width}.png`);
  }
  console.log('提示词列表浏览器回归通过：正文折叠编辑保存、世界书与工具行内开关保留脏编辑，实际停用生效；窄窗无横向溢出');
} finally {
  ws?.close();
  if (browser.exitCode === null) {
    browser.kill();
    await Promise.race([
      new Promise(resolve => browser.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 1000)),
    ]);
  }
  server.closeAllConnections();
  server.close();
  fixture.cleanup();
  try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch (error) { if (!['EPERM', 'EBUSY'].includes(error.code)) throw error; }
}
