import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { 起 } from '../服务.js';
import { 临时项目 } from './会话装置.js';

const require = createRequire(import.meta.url);
const { 造PNG } = require('../../../识图模块/test/造图.js');
const { 读PNG元数据 } = require('../../../识图模块/元数据.js');
const fixture = 临时项目();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-vision-ui-'));
const imageStoreRoot = path.join(temp, '图库');
function imageStoreInventory(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory()
      ? imageStoreInventory(target).map(item => `${entry.name}/${item}`)
      : [`${entry.name}:${fs.statSync(target).size}`];
  }).sort();
}
function imageStoreState() {
  return {
    gallery: imageStoreInventory(path.join(imageStoreRoot, 'gallery')),
    deleting: imageStoreInventory(path.join(imageStoreRoot, '.deleting')),
  };
}
const escapedImagePath = path.join(temp, 'escaped-metadata.png');
fs.writeFileSync(escapedImagePath, 造PNG({ 宽: 8, 高: 8, 文字: { parameters: '1girl, (good hands:1.3), escaped\\,comma' } }));
const escapedTagLiteral = JSON.stringify('escaped\\,comma');
const imageArg = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const workflowOnly = process.argv.includes('--workflow-only');
const imagePath = imageArg ? path.resolve(imageArg) : path.join(temp, 'metadata.png');
if (!imageArg) {
  const image = 造PNG({ 宽: 64, 高: 64, 文字: { parameters: 'a cat, sitting\nNegative prompt: blurry\nSteps: 20, Size: 64x64' } });
  fs.writeFileSync(imagePath, image);
}
const invalidWorkflowPath = path.join(temp, 'ComfyUI-空工作流.png');
fs.writeFileSync(invalidWorkflowPath, 造PNG({ 文字: { workflow: JSON.stringify({ nodes: [], links: [] }) } }));
if (!fs.existsSync(imagePath)) throw new Error(`图片不存在：${imagePath}`);
const imageMetadata = 读PNG元数据(fs.readFileSync(imagePath));
let expectedWorkflowNodes = 0;
try {
  const graph = JSON.parse(imageMetadata.全部.workflow || imageMetadata.全部.prompt || 'null');
  expectedWorkflowNodes = Array.isArray(graph?.nodes) ? graph.nodes.length : graph && typeof graph === 'object' ? Object.keys(graph).length : 0;
} catch {}
if (workflowOnly && !expectedWorkflowNodes) throw new Error('Comfy 工作流回归需要一张内嵌工作流的 PNG');
const server = 起({ 端口: 0, 项目根: fixture.root, 数据目录: temp });
await new Promise(resolve => server.once('listening', resolve));
const probe = net.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`,
  `--user-data-dir=${path.join(temp, 'browser')}`, '--window-size=1600,1000', 'about:blank',
], { stdio: 'ignore' });
let ws, seq = 0;
const pending = new Map(), errors = [], failures = [];
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
async function until(expression) {
  for (let i = 0; i < 200; i++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`页面条件未满足：${expression}`);
}
function check(name, actual, expected) {
  try { assert.deepEqual(actual, expected); console.log('通过：' + name); }
  catch (error) { failures.push(name); console.log('失败：' + name, { actual, expected }); }
}
async function screenshot(name) {
  await evaluate(`new Promise(resolve => setTimeout(resolve, 300))`);
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..', '临时', '截图');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `界面修复-${name}.png`), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
}
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page'); } catch {}
    if (!target) await new Promise(resolve => setTimeout(resolve, 50));
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data), item = pending.get(result.id);
    if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails.exception?.description || result.params.exceptionDetails.text);
    if (item) { pending.delete(result.id); result.error ? item.reject(new Error(result.error.message)) : item.resolve(result.result); }
  });
  await call('Page.enable'); await call('Runtime.enable');
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await until(`window.App?.catalogStatus() === 'ready' && AppModules.assistant.currentId()`);
  if (expectedWorkflowNodes) {
    const imageStoreBefore = imageStoreState();
    const duplicateWorkflowPath = path.join(temp, 'ComfyUI-重复选择.png');
    fs.copyFileSync(imagePath, duplicateWorkflowPath);
    await evaluate(`(() => {
      window.__pngMetadataCalls = 0;
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        if (String(args[0]).endsWith('/toolbox/调')) {
          const body = JSON.parse(args[1].body || '{}');
          if (body.模块 === 'vision' && body.动作 === '读元数据') {
            window.__pngMetadataCalls += 1;
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        return originalFetch(...args);
      };
    })()`);
    await call('DOM.enable');
    const comfyDom = await call('DOM.getDocument');
    const comfyFile = await call('DOM.querySelector', { nodeId: comfyDom.root.nodeId, selector: '#comfyWfPngFile' });
    await call('DOM.setFileInputFiles', { nodeId: comfyFile.nodeId, files: [imagePath] });
    await call('DOM.setFileInputFiles', { nodeId: comfyFile.nodeId, files: [duplicateWorkflowPath] });
    for (let i = 0; i < 100; i += 1) {
      const 已导入 = await evaluate('Boolean(AppModules.comfy.getSession().current.workflow)');
      if (已导入) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const comfyImport = await evaluate(`(() => {
      let graph = AppModules.comfy.getSession().current.workflow;
      if (typeof graph === 'string') { try { graph = JSON.parse(graph); } catch { graph = null; } }
      const picker = document.querySelector('#comfyWfPngFile');
      return { nodeCount: Array.isArray(graph?.nodes) ? graph.nodes.length : graph && typeof graph === 'object' ? Object.keys(graph).length : 0, ready: AppModules.comfy.workflowStatus().ready, metadataCalls: window.__pngMetadataCalls, pickerEnabled: !picker.disabled, pickerCleared: picker.value === '' };
    })()`);
    check('Comfy PNG 上传将内置工作流写入模块且阻止并发重入', comfyImport, { nodeCount: expectedWorkflowNodes, ready: true, metadataCalls: 1, pickerEnabled: true, pickerCleared: true });
    check('Comfy PNG 读取不改变 gallery 与 .deleting', imageStoreState(), imageStoreBefore);
    await call('DOM.setFileInputFiles', { nodeId: comfyFile.nodeId, files: [invalidWorkflowPath] });
    for (let i = 0; i < 100; i += 1) {
      const rejected = await evaluate('(/GRAPH_EMPTY|没有节点/.test(document.querySelector("#toast")?.textContent || ""))');
      if (rejected) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const rejectedImport = await evaluate(`(() => {
      let graph = AppModules.comfy.getSession().current.workflow;
      if (typeof graph === 'string') { try { graph = JSON.parse(graph); } catch { graph = null; } }
      return { nodeCount: Array.isArray(graph?.nodes) ? graph.nodes.length : 0, showsGraphError: /GRAPH_EMPTY|没有节点/.test(document.querySelector('#toast')?.textContent || '') };
    })()`);
    check('Comfy 拒绝空工作流并保留上一个工作流', rejectedImport, { nodeCount: expectedWorkflowNodes, showsGraphError: true });
    check('拒绝无效 PNG 后 gallery 与 .deleting 仍未变化', imageStoreState(), imageStoreBefore);
  }
  if (!workflowOnly) {
  const categories = await evaluate(`(() => {
    const items = AppModules.tags.page({ category:'all', limit:400 }).items;
    return { cg:items.find(item => item.en === 'cg')?.category, lowres:items.find(item => item.en === 'lowres')?.category };
  })()`);
  check('全部标签视图保留质量词和负面词各自的分类', categories, { cg:'quality', lowres:'negative' });
  if (process.argv.includes('--外观')) { await evaluate(`document.body.classList.remove('dark')`); await screenshot('首页'); }
  await evaluate(`(() => {
    window.visionReceipts = [];
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (String(args[0]).endsWith('/toolbox/调')) {
        const input = JSON.parse(args[1].body);
        if (input.模块 === 'vision') window.visionReceipts.push({ action: input.动作, receipt: await response.clone().json() });
      }
      return response;
    };
  })()`);
  await evaluate(`document.querySelector('#visionBtn').click()`);
  const dom = await call('DOM.getDocument');
  const file = await call('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#tpFile' });
  await call('DOM.setFileInputFiles', { nodeId: file.nodeId, files: [imagePath] });
  await until(`AppModules.visionTempStore.current()?.ref && !document.querySelector('#tpFile').value && visionReceipts.some(item => item.action === '读元数据')`);
  const metadata = await evaluate(`({ text: document.querySelector('#tpModes').textContent, chips: [...document.querySelectorAll('#tpModes .vision-tag-chip')].map(item => ({ tag:item.dataset.tag, zh:item.querySelector('.zh')?.textContent || '', category:item.closest('.vision-tag-group')?.dataset.category || '' })), receipt: visionReceipts.find(item => item.action === '读元数据').receipt })`);
  const imageBytes = fs.readFileSync(imagePath);
  const hasComfyPrompt = imageBytes.includes(Buffer.from('workflow'));
  if (hasComfyPrompt) {
    const needed = ['1girl', 'solo', '(good hands:1.3)'];
    const data = metadata.receipt?.data || metadata.receipt;
    check('Comfy PNG 回执含正向与负向且分离', Boolean(data?.提示词 && data?.负向提示词 && data.提示词 !== data.负向提示词), true);
    check('Comfy PNG 正向词成为独立 chips', needed.every(tag => metadata.chips.some(item => item.tag === tag)), true);
    check('已知正向词显示库中文名与人物分类', metadata.chips.find(item => item.tag === '1girl'), { tag:'1girl', zh:'1个女孩', category:'character' });
    check('权重词按纯词映射但保留原始显示', metadata.chips.find(item => item.tag === '(good hands:1.3)'), { tag:'(good hands:1.3)', zh:'', category:'unclassified' });
    check('未知正向词不重复显示为中文名', metadata.chips.filter(item => !item.zh || item.zh === item.tag).length > 0, true);
    check('Comfy PNG 不把整份 JSON 当作单个 chip', metadata.chips.some(item => item.tag.startsWith('{') && item.tag.includes('class_type')), false);
    await screenshot('ComfyUI-识图-元数据');
  } else {
    check('上传后自动显示 PNG 内置提示词', metadata.text.includes('a cat') && metadata.text.includes('sitting'), true);
  }
  if (!metadata.chips.length) console.log('自动提取状态：', metadata, await evaluate(`AppModules.visionTempStore.current()`));
  const local = await evaluate(`AppModules.assistant.visionService.processOne({ mode:'local', ref:AppModules.visionTempStore.current().ref })`);
  check('本地打标引擎通过真实模块返回标签', local.ok === true && local.data.tags.length > 0, true);
  if (!local.ok) console.log('本地打标回执：', local);
  await evaluate(`visionReceipts.length = 0`);
  await evaluate(`document.querySelector('#tpIdentify').click()`);
  await until(`visionReceipts.some(item => item.action === '认图') && !document.querySelector('#tpIdentify').disabled`);
  const tags = await evaluate(`[...document.querySelectorAll('#tpModes .vision-tag-chip')].map(item => ({tag:item.dataset.tag,zh:item.querySelector('.zh')?.textContent || '',category:item.closest('.vision-tag-group')?.dataset.category || '',confidence:item.querySelector('.vision-confidence')?.textContent || ''}))`);
  check('点击本地识图显示模型实际返回的标签', local.ok && local.data.tags.length > 0 && local.data.tags.every(item => tags.some(row => row.tag === item.en)), true);
  let visualTag = '';
  let visualTagId = '';
  for (const item of (local.ok ? local.data.tags : [])) {
    if (!item.en) continue;
    const id = await evaluate(`AppModules.tags.resolveText(${JSON.stringify(item.en)})`);
    if (id) { visualTag = item.en; visualTagId = id; break; }
  }
  if (!visualTagId) console.log('识图词没有唯一站内 Tag 对应：', local.ok ? local.data.tags.map(item => item.en) : local);
  if (visualTag) await evaluate(`(() => [...document.querySelectorAll('#tpModes .vision-tag-chip')].find(chip => chip.dataset.tag === ${JSON.stringify(visualTag)})?.querySelector('.en')?.click())()`);
  if (visualTagId) await until(`AppModules.tags.selected().some(item => item.id === ${JSON.stringify(visualTagId)})`);
  const selectedVisionIds = await evaluate(`AppModules.tags.selected().map(item => item.id)`);
  check('点击识图命中的站内 Tag 能加入底部候选框', Boolean(visualTagId) && selectedVisionIds.includes(visualTagId), true);
  if (hasComfyPrompt) {
    const knownModelTag = local.ok && local.data.tags.find(item => item.en === '1girl');
    check('本地模型词映射到标签库分类', Boolean(knownModelTag) && tags.some(row => row.tag === '1girl' && row.category === 'character'), true);
    check('映射保留本地模型概率', Boolean(knownModelTag) && tags.some(row => row.tag === '1girl' && row.confidence === `${Math.round(knownModelTag.probability * 100)}%`), true);
  } else {
    check('本地模型词映射到标签库分类', local.ok && local.data.tags.some(item => tags.some(row => row.tag === item.en && row.category !== 'unclassified')), true);
  }
  if (hasComfyPrompt) {
    check('打标完成后仍可查看 Comfy 正向 chips', ['1girl', 'solo', '(good hands:1.3)'].every(tag => tags.some(item => item.tag === tag)), true);
    await screenshot('ComfyUI-识图-认图');
  } else {
    check('打标完成后仍可查看内置提示词', tags.some(item => item.tag === 'a cat') && tags.some(item => item.tag === 'sitting'), true);
  }
  await evaluate(`(() => {
    window.clipboardWrites = [];
    Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{ writeText: async value => { window.clipboardWrites.push(String(value)); } } });
  })()`);
  await evaluate(`(() => [...document.querySelectorAll('#tpModes .tp-mod')].find(section => section.querySelector('.tpm-head span')?.textContent.includes('原图内置 Tag'))?.querySelector('.tpm-copy')?.click())()`);
  await until(`clipboardWrites.length === 1`);
  const builtinCopied = await evaluate('clipboardWrites[0]');
  await evaluate(`(() => [...document.querySelectorAll('#tpModes .tp-mod')].find(section => section.querySelector('.tpm-head span')?.textContent.includes('模型识别 Tag'))?.querySelector('.tpm-copy')?.click())()`);
  await until(`clipboardWrites.length === 2`);
  const modelCopied = await evaluate('clipboardWrites[1]');
  const copiedTagLiteral = JSON.stringify(hasComfyPrompt ? '(good hands:1.3)' : 'a cat');
  await evaluate(`(() => [...document.querySelectorAll('#tpModes .vision-tag-chip')].find(chip => chip.dataset.tag === ${copiedTagLiteral})?.querySelector('.cp')?.click())()`);
  await until(`clipboardWrites.length === 3`);
  const singleCopied = await evaluate('clipboardWrites[2]');
  if (hasComfyPrompt) {
    check('原图 Tag 组复制输出纯词且保留权重', builtinCopied.includes('1girl') && builtinCopied.includes('solo') && builtinCopied.includes('(good hands:1.3)') && !builtinCopied.includes('[object Object]'), true);
    check('原图 Tag 组复制不含对象字符串', builtinCopied.includes('[object Object]'), false);
    check('模型 Tag 组复制输出纯词', modelCopied.includes('1girl') && modelCopied.includes('solo') && !modelCopied.includes('[object Object]'), true);
    check('单 chip 复制保留权重字面文本', singleCopied, '(good hands:1.3)');
  } else {
    check('原图 Tag 组复制输出纯词', builtinCopied === 'a cat, sitting' && !builtinCopied.includes('[object Object]'), true);
    check('模型 Tag 组复制输出纯词', !modelCopied.includes('[object Object]'), true);
    check('单 chip 复制输出纯词', singleCopied, 'a cat');
  }
  if (!tags.length) console.log('打标后的内置内容：', tags, await evaluate(`AppModules.visionTempStore.current()?.metadata`));
  check('页面没有运行时异常', errors, []);
  if (process.argv.includes('--外观')) {
    await screenshot('识图');
    await evaluate(`document.querySelector('#visionBtn').click(); document.querySelector('#aiBtn').click()`);
    await evaluate(`(async () => {
      await AppModules.assistant.renameSession(AppModules.assistant.currentId(), '雨后的街道 · 氛围与光线');
      await AppModules.assistant.newSession();
      await AppModules.assistant.renameSession(AppModules.assistant.currentId(), '角色设定 · 银发旅行者');
      await AppModules.assistant.newSession();
      await AppModules.assistant.renameSession(AppModules.assistant.currentId(), '水彩风景 · 提示词探索');
    })()`);
    await screenshot('助手');
    await evaluate(`document.querySelector('#talkManage').click()`);
    await screenshot('对话管理');
    await call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
    await screenshot('对话管理-窄窗');
    await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.body.classList.add('dark'); document.querySelector('#mgrBack').click(); document.querySelector('#aiBtn').click()`);
    await screenshot('首页-深色');
  }
  fs.rmdirSync(fixture.modelLink);
  await evaluate(`visionReceipts.length = 0; document.querySelector('#tpIdentify').click()`);
  await until(`visionReceipts.some(item => item.action === '认图') && !document.querySelector('#tpIdentify').disabled`);
  check('缺少本地模型时显示失败理由并恢复按钮', await evaluate(`document.querySelector('#tpModes [role="alert"]')?.textContent.includes('没有装好的识图模型')`), true);
  check('失败后仍保留内置提示词', await evaluate(`(() => { const tags = [...document.querySelectorAll('#tpModes .vision-tag-chip')].map(item => item.dataset.tag); return ${hasComfyPrompt ? "['1girl','solo','(good hands:1.3)'].every(tag => tags.includes(tag))" : "tags.includes('a cat')"}; })()`), true);
  await call('DOM.setFileInputFiles', { nodeId: file.nodeId, files: [escapedImagePath] });
  await until(`visionReceipts.some(item => item.action === '读元数据') && [...document.querySelectorAll('#tpModes .vision-tag-chip')].some(item => item.dataset.tag === ${escapedTagLiteral})`);
  await evaluate(`(() => [...document.querySelectorAll('#tpModes .vision-tag-chip')].find(chip => chip.dataset.tag === ${escapedTagLiteral})?.querySelector('.cp')?.click())()`);
  await until(`clipboardWrites.length === 4`);
  const escapedCopied = await evaluate('clipboardWrites[3]');
  check('转义逗号单 chip 复制保持原样纯文本', escapedCopied, 'escaped\\,comma');
  check('各复制入口均未写入对象字符串', await evaluate(`clipboardWrites.every(value => !value.includes('[object Object]'))`), true);
  }
  assert.deepEqual(failures, [], '识图界面回归');
} finally {
  ws?.close();
  const profile = path.join(temp, 'browser').replace(/'/g, "''");
  spawnSync('powershell.exe', ['-NoProfile', '-Command', `$needle='${profile}'; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($needle) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { windowsHide: true, stdio: 'ignore' });
  browser.kill();
  server.closeAllConnections();
  await server.停止();
  fixture.cleanup();
  assert.equal(fs.existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..', '模型')), true, 'fixture 清理不得删除仓库模型目录');
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
