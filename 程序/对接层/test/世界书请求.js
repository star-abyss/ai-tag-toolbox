import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const 项目根 = process.argv[2] ? path.resolve(process.argv[2], '程序') : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { 造宿主 } = await import(pathToFileURL(path.join(项目根, '对接层/宿主.js')));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-worldbook-requests-'));
const needle = 'worldbookneedle';
const drawingMaterial = 'drawing-material-canary';
const requests = [];
const provider = http.createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body);
  let content = 'done';
  if (body.model === 'model-翻译') {
    const user = body.messages.find(row => row.role === 'user');
    const text = typeof user?.content === 'string' ? user.content : user?.content?.map(part => part.text || '').join('\n');
    const match = text.match(/\{"words":(\[[\s\S]*?\])\}/);
    const words = match ? JSON.parse(match[1]) : [];
    content = JSON.stringify(Object.fromEntries(words.map(word => [word, `translated-${word}`])));
  } else if (body.model === 'model-识图') {
    content = JSON.stringify({ tags: ['cat'], description: 'test image', hasBuiltinTags: false });
  } else if (body.model === 'model-文生图') {
    content = `prompt-${needle}`;
  }
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
});
let host;
try {
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  host = 造宿主({ 项目根, 数据目录: temporary });
  await host.ready;
  assert.deepEqual(host.装不上, []);
  host.服务商.写链路([{ id: 'local-test', 名字: '本地测试服务', 地址: `http://127.0.0.1:${provider.address().port}/v1`, 模型: 'fallback' }]);

  const requestsToConfigure = ['主AI', '翻译', '识图', '文生图'];
  for (const requestName of requestsToConfigure) {
    const created = host.门面.主AI.run('预设', {
      动作: '新建', 请求: requestName, 名字: `${requestName}验收`,
      一套: { name: `${requestName}验收`, model: { 走: 'local-test', 模型: `model-${requestName}` } },
    });
    assert.equal(created.ok, true, `创建${requestName}模拟预设`);
  }
  assert.equal(host.门面.主AI.run('存').ok, true);

  const worldbook = host.门面.worldbook;
  const bookIds = {};
  for (const requestName of requestsToConfigure) {
    const first = worldbook.书({ 动作: '导入', 请求: requestName, 书: {
      name: `${requestName}第一册`, entries: [
        { id: 'a-front', label: 'front A', text: `${requestName}-A-front`, always: true, keys: [], enabled: true, 落点: '前' },
        { id: 'a-after', label: 'after A', text: `${requestName}-A-after`, always: true, keys: [], enabled: true, 落点: '后' },
      ],
    } });
    const second = worldbook.书({ 动作: '导入', 请求: requestName, 书: {
      name: `${requestName}第二册`, entries: [
        { id: 'b-front', label: 'front B', text: `${requestName}-B-front`, always: true, keys: [], enabled: true, 落点: '前' },
        { id: 'b-condition', label: 'condition', text: `${requestName}-condition`, always: false, keys: [needle], enabled: true, 落点: '前' },
        { id: 'b-disabled', label: 'disabled', text: `${requestName}-disabled`, always: true, keys: [], enabled: false, 落点: '前' },
        { id: 'b-depth', label: 'depth', text: `${requestName}-depth`, always: true, keys: [], enabled: true, 落点: '按深度', 深度: 1, 角色: '系统' },
        { id: 'b-after', label: 'after B', text: `${requestName}-B-after`, always: true, keys: [], enabled: true, 落点: '后' },
      ],
    } });
    bookIds[requestName] = [second.标识, first.标识];
    const selected = worldbook.书({ 动作: '换', 请求: requestName, 启用: bookIds[requestName] });
    assert.deepEqual(selected.启用, bookIds[requestName]);
  }
  assert.equal(worldbook.run('存').ok, true);

  for (const requestName of requestsToConfigure) {
    const hit = worldbook.执行({ 请求: requestName, 文本: needle });
    assert.deepEqual(hit.命中.map(row => row.文本), [
      `${requestName}-B-front`, `${requestName}-condition`, `${requestName}-depth`, `${requestName}-B-after`,
      `${requestName}-A-front`, `${requestName}-A-after`,
    ], `${requestName}: 多书顺序、条目顺序、条件命中、停用条目与落点`);
    const miss = worldbook.执行({ 请求: requestName, 文本: 'unrelated' });
    assert.equal(miss.命中.some(row => row.文本 === `${requestName}-condition`), false, `${requestName}: 条件不命中时不带正文`);
    assert.equal(miss.命中.some(row => row.文本 === `${requestName}-disabled`), false, `${requestName}: 已停用条目不带正文`);
  }

  const sessionList = host.门面.session.run('列');
  assert.equal(sessionList.ok, true);
  const sessionId = sessionList.data.会话[0].标识;
  await host.门面.session.run('发', { 会话: sessionId, 内容: [{ type: 'text', text: needle }] });
  await waitIdle(host, sessionId);

  const bindingOptions = host.清单.find(row => row.名字 === 'binding').选项(host.项目根, host.配置, host.门面);
  const { default: bindingModule } = await import('../../装订模块/index.js');
  const binding = bindingModule.createBindingModule(bindingOptions);
  const translated = await binding.run('装订', { 文本: needle, 方向: 'en-zh' });
  assert.equal(translated.ok, true, JSON.stringify(translated));

  const image = await host.门面.image.run('存', {
    作用域: { 存放地: 'gallery' },
    字节: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
    文件名: 'worldbook-request.png', mime: 'image/png',
  });
  assert.equal(image.ok, true);
  const viewed = await host.门面.vision.run('看图', { 存放地: 'gallery', 条目ID: image.data.标识, 提示: needle });
  assert.equal(viewed.ok, true, JSON.stringify(viewed));

  const drawingResult = await host.调({ 模块: 'drawing', 动作: '提示词', 参数: { 会话: sessionId, 要求: needle, 素材: drawingMaterial } });
  assert.equal(drawingResult.提示词, `prompt-${needle}`);

  for (const requestName of requestsToConfigure) {
    const body = requests.find(row => row.model === `model-${requestName}`);
    assert.ok(body, `${requestName}: 应真正到达本地 HTTP 假服务商`);
    const serialized = JSON.stringify(body);
    assert.ok(serialized.includes(`${requestName}-B-front`), `${requestName}: 第一启用书进入实际报文`);
    assert.ok(serialized.includes(`${requestName}-condition`), `${requestName}: 条件命中正文进入实际报文`);
    assert.ok(serialized.includes(`${requestName}-A-front`), `${requestName}: 第二启用书进入实际报文`);
    assert.ok(serialized.includes(`${requestName}-depth`), `${requestName}: 深度正文进入实际报文`);
    assert.ok(serialized.indexOf(`${requestName}-B-front`) < serialized.indexOf(`${requestName}-A-front`), `${requestName}: 多书按启用顺序进入实际报文`);
    assert.ok(serialized.indexOf(`${requestName}-B-after`) < serialized.indexOf(`${requestName}-A-after`), `${requestName}: 后置正文保留多书启用顺序`);
    assert.ok(!serialized.includes(`${requestName}-disabled`), `${requestName}: 停用条目不进入实际报文`);
    if (requestName === '文生图') assert.ok(serialized.includes(drawingMaterial), '文生图模型收到调用方传入的素材原文');
    else assert.ok(!serialized.includes(drawingMaterial), `${requestName}: 不收到文生图专属素材`);
    const messageTexts = body.messages.map(row => typeof row.content === 'string' ? row.content : (row.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n'));
    const depthIndex = messageTexts.findIndex(text => text.includes(`${requestName}-depth`));
    const inputIndex = messageTexts.findIndex(text => text.includes(needle));
    assert.ok(depthIndex >= 0 && inputIndex > depthIndex, `${requestName}: 深度正文作为用户内容放在原请求文本前`);
    for (const other of requestsToConfigure.filter(name => name !== requestName)) {
      assert.ok(!serialized.includes(`${other}-A-front`), `${requestName}: 不混入${other}书籍`);
    }
  }

  for (const requestName of requestsToConfigure) {
    const saved = worldbook.书({ 动作: '换', 请求: requestName, 启用: [] });
    assert.deepEqual(saved.启用, []);
  }
  assert.equal(worldbook.run('存').ok, true);
  const countsBeforeDisabledCalls = requests.length;
  await host.门面.session.run('发', { 会话: sessionId, 内容: [{ type: 'text', text: needle }] });
  await waitIdle(host, sessionId);
  await binding.run('装订', { 文本: needle, 方向: 'en-zh' });
  await host.门面.vision.run('看图', { 存放地: 'gallery', 条目ID: image.data.标识, 提示: needle });
  await host.调({ 模块: 'drawing', 动作: '提示词', 参数: { 会话: sessionId, 要求: needle, 素材: drawingMaterial } });
  const disabledBodies = requests.slice(countsBeforeDisabledCalls);
  assert.equal(disabledBodies.length, 4, '四请求停用后仍各自完成真实 HTTP 调用');
  for (const requestName of requestsToConfigure) {
    const body = disabledBodies.find(row => row.model === `model-${requestName}`);
    assert.ok(body, `${requestName}: 全停后仍调用对应模型`);
    const systemText = body.messages.filter(row => row.role === 'system').map(row => typeof row.content === 'string' ? row.content : '').join('\n');
    const currentUser = [...body.messages].reverse().find(row => row.role === 'user');
    const currentUserText = typeof currentUser?.content === 'string' ? currentUser.content : (currentUser?.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
    for (const candidate of requestsToConfigure) {
      assert.ok(!systemText.includes(`${candidate}-A-front`), `${requestName}: 显式全停后 system 无${candidate}书正文`);
      assert.ok(!systemText.includes(`${candidate}-condition`), `${requestName}: 显式全停后 system 无${candidate}条件正文`);
      assert.ok(!systemText.includes(`${candidate}-depth`), `${requestName}: 显式全停后 system 无${candidate}深度正文`);
    }
    if (requestName === '主AI') for (const candidate of requestsToConfigure)
      assert.ok(!currentUserText.includes(`${candidate}-depth`), '主AI全停后的当前输入没有新增深度正文');
    else for (const candidate of requestsToConfigure)
      assert.ok(!JSON.stringify(body.messages).includes(`${candidate}-depth`), `${requestName}: 显式全停后 messages 无${candidate}深度正文`);
  }

  await host.close();
  host = 造宿主({ 项目根, 数据目录: temporary });
  await host.ready;
  assert.deepEqual(host.装不上, []);
  const afterRestart = host.门面.worldbook;
  for (const requestName of requestsToConfigure) {
    assert.deepEqual(afterRestart.读({ 请求: requestName }).启用, [], `${requestName}: 重启后仍然全停`);
    assert.deepEqual(afterRestart.执行({ 请求: requestName, 文本: needle }).命中, [], `${requestName}: 重启后执行没有暗中恢复默认书`);
  }

  console.log(`PASS: 四请求启用隔离、多书顺序、条件与全停均经真实 HTTP 报文验证 (${requests.length} calls)`);
} finally {
  await host?.close();
  provider.closeAllConnections();
  await new Promise(resolve => provider.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true });
}

async function waitIdle(host, sessionId) {
  for (let i = 0; i < 300; i++) {
    const state = host.门面.session.run('读', { 会话: sessionId });
    if (state.ok && state.data.运行状态 === '空闲') return state.data.会话;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const final = host.门面.session.run('读', { 会话: sessionId }); throw new Error('会话执行未完成: ' + JSON.stringify({ ok: final.ok, status: final.data?.运行状态, turn: final.data?.会话?.turns?.at(-1)?.status, httpCalls: requests.length }));
}
