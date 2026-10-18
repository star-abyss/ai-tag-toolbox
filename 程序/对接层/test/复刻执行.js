import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const 项目根 = process.argv[2] ? path.resolve(process.argv[2], '程序') : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { 造宿主 } = await import(pathToFileURL(path.join(项目根, '对接层/宿主.js')));
const 数据目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-recreation-'));
const 原图 = 带PNG元数据();
const 成图 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const 生成提示词 = 'PROMPT_FROM_DRAWING_REQUEST_7419';
const 文生图独有规则 = 'DRAWING_SCOPE_ONLY_SENTINEL_5281';
const 模型报文 = [];
const comfyPrompt = [];
let 模型主轮数 = 0;
let 服务商;
let comfy;
let 主AI模型标识 = 'main-recreation-test';

const provider = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  模型报文.push(structuredClone(body));
  const model = body.model;
  let message;
  if (model === 'drawing-recreation-test') {
    message = { role: 'assistant', content: 生成提示词 };
  } else if (model === 主AI模型标识) {
    模型主轮数++;
    const calls = [
      { id: 'call-metadata', name: 'images_metadata', arguments: { 图号: 1 } },
      { id: 'call-prompt', name: 'drawing_prompt', arguments: {
        要求: '复刻人物与构图，按用户要求整理完整提示词',
        素材: '已读取的原始元数据：' + 找工具结果(body, 'images_metadata'),
        参考图: 1,
      } },
      { id: 'call-generate', name: 'drawing_generate', arguments: { 正向: 生成提示词, 参考图: 1 } },
    ];
    const call = calls[模型主轮数 - 1];
    message = call
      ? { role: 'assistant', content: null, tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] }
      : { role: 'assistant', content: '复刻完成。', tool_calls: [] };
  } else {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: `unexpected model ${model}` } }));
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls?.length ? 'tool_calls' : 'stop' }] }));
});

const comfyServer = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/system_stats') return json(response, { system: { comfyui_version: 'fake' }, devices: [] });
  if (pathname === '/queue') return json(response, { queue_running: [], queue_pending: [] });
  if (pathname === '/object_info') return json(response, {});
  if (pathname === '/prompt' && request.method === 'POST') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    comfyPrompt.push(body);
    return json(response, { prompt_id: 'fake-prompt-1' });
  }
  if (pathname === '/upload/image' && request.method === 'POST') {
    for await (const _chunk of request) {}
    return json(response, { name: 'reference.png', subfolder: '', type: 'input' });
  }
  if (pathname === '/history/fake-prompt-1') return json(response, {
    'fake-prompt-1': {
      status: { status_str: 'success', completed: true, messages: [] },
      outputs: { '4': { images: [
        { filename: 'generated-a.png', subfolder: '', type: 'output' },
        { filename: 'generated-b.png', subfolder: '', type: 'output' },
      ] } },
    },
  });
  if (pathname === '/view') {
    response.writeHead(200, { 'content-type': 'image/png' });
    response.end(成图);
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end('{}');
});

let host;
try {
  await Promise.all([listen(provider), listen(comfyServer)]);
  host = 造宿主({ 项目根, 数据目录 });
  await host.ready;
  assert.deepEqual(host.装不上, [], '隔离数据目录下宿主所有模块均应装载');

  host.服务商.写链路([{
    id: 'local-recreation',
    名字: '隔离验收服务',
    地址: `http://127.0.0.1:${provider.address().port}/v1`,
    模型: 'fallback',
  }]);
  await host.写设置({ comfyUI地址: `http://127.0.0.1:${comfyServer.address().port}` });

  for (const [请求, 模型] of [['主AI', 主AI模型标识], ['文生图', 'drawing-recreation-test']]) {
    const 新建 = host.门面.主AI.run('预设', {
      动作: '新建', 请求, 名字: `${请求}隔离验收`,
      一套: { name: `${请求}隔离验收`, model: { 走: 'local-recreation', 模型 } },
    });
    assert.equal(新建.ok, true, `创建${请求}预设: ${新建.reason || ''}`);
  }
  assert.equal(host.门面.主AI.run('存').ok, true);

  const scopedBook = host.门面.worldbook.书({ 动作: '导入', 请求: '文生图', 书: {
    name: '文生图隔离验收规则', entries: [{
      id: 'drawing-only', label: '独有规则', text: 文生图独有规则,
      always: true, keys: [], enabled: true, 落点: '前',
    }],
  } });
  assert.ok(scopedBook.标识);
  assert.equal(host.门面.worldbook.书({ 动作: '换', 请求: '文生图', 启用: [scopedBook.标识] }).启用[0], scopedBook.标识);
  assert.equal(host.门面.worldbook.run('存').ok, true);

  const 图 = {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: 'old prompt', clip: ['90', 0] } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative', clip: ['90', 0] } },
    '3': { class_type: 'EmptyFlux2LatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '4': { class_type: 'KSampler', inputs: {
      model: ['90', 0], positive: ['1', 0], negative: ['2', 0], latent_image: ['3', 0],
      seed: 1, steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'normal', denoise: 1,
    } },
    '5': { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: 'test' } },
    '6': { class_type: 'LoadImage', inputs: { image: 'initial.png' } },
  };
  const workflow = await host.门面.comfy.run('存工作流', { 图 });
  assert.equal(workflow.ok, true, `存 Flux2 API 图: ${workflow.reason || ''}`);
  assert.equal((await host.门面.comfy.run('绘图开关', { 启用: true })).ok, true);
  assert.equal((await host.门面.comfy.run('生成设置', { 每轮张数: 2, 最多轮数: 3, 自动迭代: true })).ok, true);

  const sessionId = host.门面.session.run('列').data.会话[0].标识;
  const savedInput = await host.门面.image.run('存', {
    作用域: { 存放地: 'session', 会话ID: sessionId },
    字节: 原图, 文件名: '复刻源图.png', mime: 'image/png',
  });
  assert.equal(savedInput.ok, true);
  const sent = await host.门面.session.run('发', { 会话: sessionId, 内容: [
    { type: 'text', text: '先读图内原始信息，整理复刻提示词，再生成两张。' },
    { type: 'image', imageId: savedInput.data.标识 },
  ] });
  assert.equal(sent.ok, true);
  const final = await waitIdle(host, sessionId);
  assert.equal(final.turns.at(-1).status, 'complete', JSON.stringify(final.turns.at(-1)));
  assert.equal(final.messages.at(-1).parts[0].text, '复刻完成。');

  const tools = final.messages.flatMap(message => message.toolCalls || []);
  assert.deepEqual(tools.map(tool => tool.name), ['images_metadata', 'drawing_prompt', 'drawing_generate']);
  assert.ok(tools.every(tool => tool.status === 'complete'), JSON.stringify(tools.map(tool => ({ name: tool.name, status: tool.status, result: tool.result }))));
  assert.equal(tools[0].result.提示词, 'source prompt canary');
  assert.equal(tools[0].result.负向提示词, 'source negative canary');
  assert.equal(tools[1].result.提示词, 生成提示词);
  assert.equal(tools[2].result.图片.length, 2);
  const generationState = await host.门面.drawing.run('状态', { 会话: sessionId });
  assert.equal(generationState.data.生成状态.已用轮数, 1, '会话绘图状态记录已使用轮数');
  assert.equal(generationState.data.生成状态.剩余轮数, 2, '会话绘图状态记录剩余轮数');

  const 主请求 = 模型报文.filter(body => body.model === 主AI模型标识);
  const 提示词请求 = 模型报文.find(body => body.model === 'drawing-recreation-test');
  assert.equal(主请求.length, 4, '主 AI 应按顺序调用三个工具并完成最终回复');
  assert.ok(提示词请求, 'drawing_prompt 应实际调用独立文生图模型');
  const 主工具名 = 主请求[0].tools.map(tool => tool.function.name);
  for (const name of ['images_metadata', 'drawing_prompt', 'drawing_generate']) assert.ok(主工具名.includes(name), `默认 preset tools 缺少 ${name}`);
  assert.ok(!主请求.some(body => JSON.stringify(body.messages).includes(文生图独有规则)), '文生图专属世界书不能污染主 AI');
  const drawingSystem = 提示词请求.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
  assert.match(drawingSystem, new RegExp(文生图独有规则));
  const promptUser = 提示词请求.messages.find(message => message.role === 'user');
  assert.ok(promptUser.content.some(part => part.type === 'text' && part.text.includes('source prompt canary')));
  const promptImage = promptUser.content.find(part => part.type === 'image_url');
  assert.ok(promptImage, '参考图应作为图片内容发送到文生图请求');
  assert.equal(promptImage.image_url.url, `data:image/png;base64,${原图.toString('base64')}`);

  assert.equal(comfyPrompt.length, 1);
  assert.equal(comfyPrompt[0].prompt['1'].inputs.text, 生成提示词, 'ComfyUI 收到 drawing_prompt 返回的提示词');
  assert.equal(comfyPrompt[0].prompt['3'].class_type, 'EmptyFlux2LatentImage');
  assert.equal(comfyPrompt[0].prompt['3'].inputs.batch_size, 2, 'ComfyUI 收到每轮张数设置');

  const images = await host.门面.image.run('列会话图', { 作用域: { 存放地: 'session', 会话ID: sessionId } });
  assert.equal(images.data.条目.length, 3, '源图与两张生成图都保存到会话');
  const generatedIds = new Set(tools[2].result.图片.map(item => item.引用.imageId));
  assert.ok(images.data.条目.filter(item => generatedIds.has(item.标识)).length === 2);
  for (const image of images.data.条目.filter(item => generatedIds.has(item.标识))) {
    const content = await host.门面.image.run('取内容', { 引用: image.引用, 变体: 'original' });
    assert.equal(content.ok, true);
    assert.deepEqual(Buffer.from(content.data.字节), 成图);
  }
  assert.equal(tools.filter(tool => tool.name === 'drawing_generate' && tool.status === 'complete').length, 1, '本会话轮次中恰好完成一轮生图');

  console.log('PASS: 真实宿主会话复刻链路、请求隔离、原图字节、Flux2批量提交及图片/轮次保存');
} finally {
  await host?.close();
  for (const server of [provider, comfyServer]) {
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
  fs.rmSync(数据目录, { recursive: true, force: true });
}

function 带PNG元数据() {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const body = Buffer.concat([Buffer.from('tEXt'), Buffer.from('parameters\0source prompt canary\nNegative prompt: source negative canary\nSteps: 8')]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(body.length - 4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([png.subarray(0, -12), length, body, checksum, png.subarray(-12)]);
}

function 找工具结果(body, name) {
  for (const message of body.messages || []) {
    if (message.role !== 'tool') continue;
    if (body.messages.some(row => row.role === 'assistant' && row.tool_calls?.some(call => call.id === message.tool_call_id && call.function.name === name))) return message.content;
  }
  return '';
}

function json(response, value) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
}

async function waitIdle(instance, sessionId) {
  for (let i = 0; i < 1000; i++) {
    const state = instance.门面.session.run('读', { 会话: sessionId });
    if (state.ok && state.data.运行状态 === '空闲') return state.data.会话;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const state = instance.门面.session.run('读', { 会话: sessionId });
  throw new Error('会话执行未完成：' + JSON.stringify({ 状态: state.data?.运行状态, 轮次: state.data?.会话?.turns?.at(-1), 模型调用: 模型报文.length, Comfy提交: comfyPrompt.length }));
}
