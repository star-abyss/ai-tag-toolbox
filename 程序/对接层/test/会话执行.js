import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import session from '../../会话模块/index.js';
import image from '../../图片模块/index.js';
import comfy from '../../comfyUI模块/index.js';
import { 造会话图片 } from '../会话图片.js';
import { 造会话执行, 造图片回执 } from '../会话执行.js';
import { 造服务商面 } from '../界面/服务商.js';
const require = createRequire(import.meta.url);
const { createMemoryAdapter: imageStore } = require('../../图片模块/adapter-memory.js');
const { createMemoryAdapter: comfyPort } = require('../../comfyUI模块/adapter-memory.js');
const window = {};
vm.runInNewContext(fs.readFileSync(new URL('../界面/页/view-bridge.js', import.meta.url), 'utf8'), {
  window,
});
const bridge = window.dshViewBridge;
const pause = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function idle(m, id) {
  for (let i = 0; i < 100; i++) {
    const r = m.run('读', { 会话: id }).data;
    if (r.运行状态 === '空闲') return r.会话;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('执行未完成');
}
function provider(callName, args, received) {
  return {
    固定请求: () => async (request) => {
      received.push(request);
      const call = received.length === 1;
      return {
        正文: call ? '' : '完成',
        消息: call
          ? { tool_calls: [{ id: 'provider1', function: { name: callName, arguments: args } }] }
          : {},
        用的谁: { provider: 'fake', model: 'fake' },
      };
    },
  };
}
async function assemble({ imageOptions = {}, port, comfyOptions = {}, service, toolNames = ['drawing_generate'], worldbook = { run: () => ({ ok: true, data: { 命中: [] } }) } }) {
  const comfyTestPort = port || comfyPort();
  const 门面 = {
    image: image.createImageModule({ port: imageStore(), ...imageOptions }),
    comfy: comfy.createComfyModule({ port: comfyTestPort, ...comfyOptions }),
    主AI: {
      run: () => ({
        ok: true,
        data: {
          预设: { 标识: 'preset-session' },
          工具表: toolNames.map((名字) => ({ 名字, 参数: {}, 说明: {} })),
          模型: null,
        },
      }),
    },
    worldbook,
  };
  门面.comfy = {
    async run(action, args = {}, context = {}) {
      if (action === '生成设置') return { ok: true, data: { 每轮张数: 1, 最多轮数: 3, 自动迭代: true } };
      if (action === '出图') {
        args.onEvent?.({ 类型: '提交中' });
        return { ok: true, data: { 产出: [{ 文件名: 'out.png', 子目录: '', 类型: 'output', 种类: 'image' }] } };
      }
      if (action === '取图') {
        const output = args.产出 || args;
        return comfyTestPort.取结果文件(output.文件名, { subfolder: output.子目录, type: output.类型 }, context.signal);
      }
      return { ok: true, data: { 启用: true, 正向: [], 负向: [], 图片: [] } };
    },
  };
  门面.session = session.createSessionModule({
    port: session.createMemoryAdapter(),
    图片: 造会话图片({ 图片门面: 门面.image }),
    执行: 造会话执行({
      门面,
      清单: [],
      服务商: service,
    }),
  });
  await 门面.session.ready;
  const id = (await 门面.session.run('新')).data.会话.id;
  return { 门面, id };
}
test('独立会话用主 AI 请求订阅的世界书，不读取预设文本或启用数组', async () => {
  const received = [], calls = [];
  const worldbook = {
    run(action, args) {
      calls.push({ action, args });
      return { ok: true, data: { 命中: [
        { 文本: '书一正文', 落点: '前' },
        { 文本: '书二正文', 落点: '前' },
        { 文本: '深度正文', 落点: '按深度' },
      ] } };
    },
  };
  const { 门面, id } = await assemble({ worldbook, service: provider('', '', received) });
  await 门面.session.run('发', { 会话: id, 内容: [{ type: 'text', text: '当前请求' }] });
  await idle(门面.session, id);
  assert.equal(received[0].system, '书一正文\n\n书二正文\n\n当前对话没有图片。');
  assert.equal(Object.hasOwn(calls[0].args, '启用'), false);
  assert.equal(calls[0].args.请求, '主AI');
  assert.equal(calls[0].args.文本, '当前请求');
  assert.equal(received[0].messages[0].content, '深度正文');
});
test('生图取回的超过1MB图片进入固定会话，存档只有图像标记且后续请求收到图像块', async () => {
  const bytes = Buffer.alloc(1024 * 1024 + 12, 37),
    received = [],
    gate = pause(),
    entered = pause();
  const port = comfyPort({ 文件: { 'out.png': bytes } });
  const { 门面, id: a } = await assemble({
    port: {
      ...port,
      取结果文件: async (...args) => {
        entered.resolve();
        await gate.promise;
        return port.取结果文件(...args);
      },
    },
    service: provider(
      'drawing_generate',
      '{"正向":"取图"}',
      received,
    ),
  });
  const scope = { 存放地: 'session', 会话ID: a };
  const fillers = [];
  for (let i = 0; i < 4; i++) {
    const stored = await 门面.image.run('存', { 作用域: scope, 字节: Buffer.from([i]), 文件名: `预置${i}.png`, mime: 'image/png' });
    fillers.push(stored.data.标识);
  }
  for (const index of [0, 2, 3])
    await 门面.image.run('删', { 引用: { 作用域: scope, 条目ID: fillers[index] } });
  await 门面.session.run('发', { 会话: a, 内容: [{ type: 'text', text: '取图' }] });
  await entered.promise;
  const b = (await 门面.session.run('新')).data.会话.id;
  gate.resolve();
  const s = await idle(门面.session, a);
  const result = s.messages[1].toolCalls[0].result.图片[0].引用;
  assert.equal(result.type, 'session-image');
  const highSlot = await 门面.image.run('存', { 作用域: scope, 字节: Buffer.from([6]), 文件名: '已删除高号.png', mime: 'image/png' });
  assert.equal(highSlot.data.图号, 6);
  await 门面.image.run('删', { 引用: { 作用域: scope, 条目ID: highSlot.data.标识 } });
  assert.equal(s.messages[1].toolCalls[0].status, 'complete');
  assert.equal(门面.image.run('列', { 作用域: { 存放地: 'session', 会话ID: b } }).data.总数, 0);
  const original = 门面.image.run('取内容', {
    引用: { 作用域: { 存放地: 'session', 会话ID: a }, 条目ID: result.imageId },
  });
  assert.deepEqual(original.data.字节, bytes);
  assert.equal(JSON.stringify(s).includes('base64'), false);
  assert.equal(port.记.取过的.length, 1);
  const tool = received[1].messages.find((m) => m.role === 'tool');
  assert.equal(JSON.parse(tool.content).图片[0].引用.图片, '图5');
  assert.equal(
    bridge
      .blocksFromMessage(s.messages[1])
      .some((b) => b.kind === 'image' && b.imageId === result.imageId),
    true,
  );
  const archive = await 门面.session.run('导出', { 会话列表: [a] });
  assert.equal(archive.ok, true);
  const imported = await 门面.session.run('导入', { 内容: archive.data.内容 });
  assert.equal(imported.ok, true, JSON.stringify(imported));
  const importedId = imported.data.会话ID列表[0];
  const importedSession = 门面.session.run('读', { 会话: importedId }).data.会话;
  const imagePort = 造会话图片({ 图片门面: 门面.image });
  const importedImages = await imagePort.listNumbered(importedId);
  assert.deepEqual(importedImages.data.images.map((image) => image.number), [2, 5]);
  assert.equal(importedImages.data.highWater, 6);
  const importedCall = importedSession.messages[1].toolCalls[0];
  assert.notEqual(importedCall.id, s.messages[1].toolCalls[0].id);
  assert.notEqual(importedCall.result.图片[0].引用.imageId, result.imageId);
  const importedProjection = await (await import('../会话投影.js')).投影会话(
    importedSession,
    imagePort.read,
    { 业务工具名: new Set(['drawing_generate']), 列图片: imagePort.listNumbered },
  );
  const importedVisual = importedProjection.find((message) => message.role === 'user' && Array.isArray(message.content) && message.content.some((part) => part.type === 'image'));
  assert.ok(importedVisual);
  assert.equal(importedVisual.content.find((part) => part.type === 'image').data, bytes.toString('base64'));
  assert.ok(importedVisual.content.some((part) => part.type === 'text' && part.text === '图5'));
  const next = await 门面.image.run('存', { 作用域: { 存放地:'session', 会话ID:importedId }, 字节:Buffer.from([7]), 文件名:'next.png', mime:'image/png' });
  assert.equal(next.data.图号, 7);
  const emptyScope = { 存放地:'session', 会话ID:b };
  const deletedOnly = await 门面.image.run('存', { 作用域:emptyScope, 字节:Buffer.from([8]), 文件名:'deleted.png', mime:'image/png' });
  await 门面.image.run('删', { 引用:{作用域:emptyScope,条目ID:deletedOnly.data.标识} });
  const emptyArchive = await 门面.session.run('导出', { 会话列表:[b] });
  const parsedEmpty = JSON.parse(emptyArchive.data.内容).sessions[0];
  assert.equal(parsedEmpty.images.length, 0);
  assert.equal(parsedEmpty.imageNumberHighWater, 1);
  const importedEmpty = await 门面.session.run('导入', { 内容:emptyArchive.data.内容 });
  const emptyImportedId = importedEmpty.data.会话ID列表[0];
  const afterEmptyImport = await 门面.image.run('存', { 作用域:{存放地:'session',会话ID:emptyImportedId}, 字节:Buffer.from([9]), 文件名:'after-empty.png', mime:'image/png' });
  assert.equal(afterEmptyImport.data.图号, 2);
  await 门面.session.close();
});
test('停止signal传到绘画业务的取图调用；运行工具保留为结果未确认', async () => {
  const entered = pause(),
    received = [];
  let observed;
  const port = comfyPort();
  const { 门面, id } = await assemble({
    port: {
      ...port,
      取结果文件: async (_file, _location, signal) => {
        observed = signal;
        entered.resolve();
        await new Promise((r) => signal.addEventListener('abort', r, { once: true }));
        return { ok: false, code: 'COMFY_CANCELLED', reason: 'COMFY_CANCELLED: 已停止' };
      },
    },
    service: provider('drawing_generate', '{"正向":"取图"}', received),
  });
  await 门面.session.run('发', { 会话: id, 内容: [{ type: 'text', text: '取图' }] });
  await entered.promise;
  await 门面.session.run('停', { 会话: id });
  assert.equal(observed.aborted, true);
  const s = await idle(门面.session, id);
  assert.equal(s.turns[0].status, 'stopped');
  assert.equal(s.messages[1].toolCalls[0].status, 'interrupted');
  assert.equal(received.length, 1);
});
test('生图结果无法存入会话时保留原失败回执并继续工具循环', async () => {
  const received = [];
  const { 门面, id } = await assemble({
    imageOptions: {
      接收作用域: () => ({
        ok: false,
        code: 'IMAGE_WRITE_FAILED',
        reason: 'IMAGE_WRITE_FAILED: 盘满',
        details: { 空间: 0 },
      }),
    },
    port: comfyPort({ 文件: { 'out.png': Buffer.from([1, 2, 3]) } }),
    service: provider('drawing_generate', '{"正向":"取图"}', received),
  });
  await 门面.session.run('发', { 会话: id, 内容: [{ type: 'text', text: '取图' }] });
  const s = await idle(门面.session, id),
    call = s.messages[1].toolCalls[0];
  assert.equal(call.status, 'error');
  assert.equal(call.result.code, 'IMAGE_WRITE_FAILED');
  assert.equal(call.result.已接收图片.length, 0);
  assert.equal(JSON.stringify(call.result).includes('Buffer'), false);
  assert.equal(received.length, 2);
  let writes = 0;
  const images = image.createImageModule({
    port: imageStore(),
    接收作用域: () =>
      ++writes === 2
        ? { ok: false, code: 'IMAGE_WRITE_FAILED', reason: 'IMAGE_WRITE_FAILED: 第二张失败' }
        : { ok: true },
  });
  const format = 造图片回执({ 图片门面: images, sessionId: 's_multi' });
  await assert.rejects(
    format(
      {
        业务: '已经完成',
        mime: 'image/png',
        images: [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')],
      },
      { moduleKey: 'comfy', action: '取图', parameters: {} },
    ),
    (e) => {
      assert.equal(e.details.业务结果.业务, '已经完成');
      assert.equal(e.details.业务结果.images[0].type, 'session-image');
      assert.equal(e.details.业务结果.images[2].code, 'IMAGE_WRITE_FAILED');
      return true;
    },
  );
  assert.equal(writes, 2);
  assert.equal(images.run('列', { 作用域: { 存放地: 'session', 会话ID: 's_multi' } }).data.总数, 1);
});
test('工具参数非对象和未知工具按原错误保存并交回模型', async () => {
  for (const [name, args, code] of [
    ['drawing_generate', '[]', 'TOOL_BAD_ARGUMENT'],
    ['unknown_tool', '{}', 'TOOL_BAD_TOOL_NAME'],
  ]) {
    const received = [];
    const { 门面, id } = await assemble({
      port: comfyPort(),
      service: provider(name, args, received),
    });
    await 门面.session.run('发', { 会话: id, 内容: [{ type: 'text', text: '错误参数' }] });
    const s = await idle(门面.session, id);
    assert.equal(s.messages[1].toolCalls[0].status, 'error');
    assert.equal(s.messages[1].toolCalls[0].result.code, code);
    assert.equal(s.turns[0].status, 'complete');
    if (name === 'unknown_tool') {
      assert.equal(received[1].messages.some((m) => m.role === 'tool' && m.tool_call_id === s.messages[1].toolCalls[0].id), false);
    } else {
      assert.equal(JSON.parse(received[1].messages.find((m) => m.role === 'tool').content).code, code);
    }
  }
});

test('回执中被撤销的旧非业务工具调用及配对结果不进入后续模型请求', async () => {
  const history = {
    format: 'toolbox-session', version: 1, id: 's_old', title: '旧', titleManual: false,
    createdAt: 0, updatedAt: 0, draft: [], turns: [{id:'t_1',inputMessageId:'m_1',status:'complete',startedAt:0,endedAt:1,error:null}], messages: [
      { id: 'm_1', turnId: 't_1', role: 'user', parts: [{type:'text',text:'继续'}], reasoning:'',context:'',toolCalls:[],createdAt:0,model:null },
      { id: 'm_2', turnId: 't_1', role: 'assistant', parts: [], reasoning:'',context:'',createdAt:0,model:null,
        toolCalls: [{id:'old1',name:'comfy_objectInfo',args:'{}',status:'complete',result:{巨大定义表:'x'.repeat(100000)}}] },
    ],
  };
  const projected = await (await import('../会话投影.js')).投影会话(
    history,
    () => ({ok:false,reason:'missing'}),
    { 业务工具名: new Set(['tags_search','images_view','drawing_generate']) },
  );
  assert.equal(JSON.stringify(projected).includes('巨大定义表'), false);
  assert.equal(projected.some((m) => m.role === 'tool' && m.tool_call_id === 'old1'), false);
  assert.equal(projected.some((m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((p) => p.type === 'image')), false);
});

test('历史绘画工具状态只在模型投影中清理，普通工具和用户文本保留原文', async () => {
  const history = {
    id: 's_privacy', messages: [
      { role: 'user', context: '', parts: [{ type: 'text', text: '用户提到生成状态：保留这段原文' }], toolCalls: [] },
      { role: 'assistant', parts: [], reasoning: '', toolCalls: [
        { id: 'draw', name: 'drawing_generate', args: '{}', status: 'complete', result: { ok: true, data: { 图片: [], 生成状态: { 每轮张数: 9, 剩余轮数: 4 } } } },
        { id: 'other', name: 'tags_get', args: '{}', status: 'complete', result: { 生成状态: '普通工具原文' } },
      ] },
    ],
  };
  const projected = await (await import('../会话投影.js')).投影会话(history, () => ({ ok: false, reason: 'missing' }), {
    业务工具名: new Set(['drawing_generate', 'tags_get']),
  });
  assert.match(projected[0].content[0].text, /用户提到生成状态：保留这段原文/);
  const draw = JSON.parse(projected.find(message => message.role === 'tool' && message.tool_call_id === 'draw').content);
  assert.equal('生成状态' in draw.data, false);
  assert.equal(projected.find(message => message.role === 'tool' && message.tool_call_id === 'other').content, '{"生成状态":"普通工具原文"}');
});

test('历史绘画回执清除旧设置与 Comfy 诊断，普通业务失败仍保留原文', async () => {
  const history = {
    id: 's_legacy_privacy', messages: [
      { role: 'assistant', parts: [], reasoning: '', toolCalls: [
        { id: 'info', name: 'drawing_info', args: '{"工作流":{"nodes":["private"]}}', status: 'complete', result: { 启用: true, 生成设置: { 每轮张数: 8 }, 每轮张数: 8, 参数: [{ 名称: 'steps', 值: 40 }], 工作流: { nodes: ['private'] }, 正向提示词: true } },
        { id: 'limit', name: 'drawing_generate', args: '{"正向":"red","graph":{"steps":40},"参数":{"steps":40}}', status: 'error', result: { code: 'OLD_LIMIT', reason: '最多 7 轮（含首次）' } },
        { id: 'comfy', name: 'drawing_generate', args: '{}', status: 'error', result: { ok: false, code: 'COMFY_PROMPT_REJECTED', reason: 'COMFY_PROMPT_REJECTED: 节点 3 KSampler sampler_name 可选值 euler / dpmpp_2m', details: { node_errors: { '3': { sampler_name: 'dpmpp_2m' } }, graph: { nodes: ['private'] } } } },
        { id: 'image', name: 'drawing_generate', args: '{}', status: 'error', result: { ok: false, code: 'SESSION_IMAGE_MISSING', reason: 'SESSION_IMAGE_MISSING: 当前会话图2不存在或已删除', details: { 图号: 2 } } },
      ] },
    ],
  };
  const projected = await (await import('../会话投影.js')).投影会话(history, () => ({ ok: false, reason: 'missing' }), {
    业务工具名: new Set(['drawing_info', 'drawing_generate']),
  });
  const receipt = id => JSON.parse(projected.find(message => message.role === 'tool' && message.tool_call_id === id).content);
  const info = receipt('info');
  assert.deepEqual(info, { 启用: true, 正向提示词: true });
  const assistantCall = projected.find(message => message.role === 'assistant').tool_calls;
  assert.equal(assistantCall.find(call => call.id === 'info').function.arguments, '{}');
  assert.equal(assistantCall.find(call => call.id === 'limit').function.arguments, '{"正向":"red"}');
  assert.equal(receipt('limit').reason, 'OLD_LIMIT: 当前无法继续生成；可继续查看图片和回复');
  const comfy = receipt('comfy');
  assert.equal(comfy.reason, 'COMFY_PROMPT_REJECTED: 生图无法完成');
  assert.equal('details' in comfy, false);
  assert.doesNotMatch(JSON.stringify(projected), /sampler_name|dpmpp_2m|nodes|private|最多 7 轮/);
  assert.equal(receipt('image').reason, 'SESSION_IMAGE_MISSING: 当前会话图2不存在或已删除');
  assert.deepEqual(receipt('image').details, { 图号: 2 });
});

test('会话素材与业务回执引用投影为带图号的原生图像块，JSON只保留图号', async () => {
  const { 投影会话 } = await import('../会话投影.js');
  const bytes = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
  const marker = { type: 'session-image', imageId: 'img_a' };
  const snapshot = {
    id: 's_projection',
    messages: [
      { role:'user', context:'', parts:[{type:'text',text:'参考图1'},{type:'image',imageId:'img_a'}], toolCalls:[] },
      { role:'assistant', parts:[], reasoning:'', toolCalls:[{
        id:'call1', name:'drawing_generate', args:'{}', status:'complete',
        result:{ 图片:[{图号:1,引用:marker}] },
      }] },
    ],
  };
  const projected = await 投影会话(snapshot, (_sessionId, imageId) => ({
    ok:true, data:{bytes, mime:'image/png', number:imageId === 'img_a' ? 1 : 2},
  }), {
    业务工具名:new Set(['drawing_generate']),
    列图片:async () => ({ok:true,data:{images:[{id:'img_a',number:1,filename:'a.png'}]}}),
  });
  const userImages = projected.filter((message) => message.role === 'user')
    .flatMap((message) => Array.isArray(message.content) ? message.content : [])
    .filter((part) => part.type === 'image');
  assert.equal(userImages.length, 2);
  assert.ok(userImages.every((part) => part.data === bytes.toString('base64')));
  const tool = projected.find((message) => message.role === 'tool');
  assert.match(tool.content, /图1/);
  assert.doesNotMatch(tool.content, /img_a|session-image/);
});

test('会话投影的图像块经真实服务商转换为 data:image_url 并保留 tool 对话顺序', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'session-vision-projection-'));
  const bodies = [];
  const providerServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '已看见图5' } }] }));
  });
  await new Promise((resolve) => providerServer.listen(0, '127.0.0.1', resolve));
  try {
    const api = 造服务商面({ 目录: directory });
    api.写链路([{ id:'vision-test',名字:'视觉',地址:`http://127.0.0.1:${providerServer.address().port}/v1`,模型:'vision-test' }]);
    const bytes = Buffer.from([137,80,78,71,5]);
    const answer = await api.请求({
      messages:[
        {role:'tool',tool_call_id:'call-output',content:'{"图片":"图5"}'},
        {role:'user',content:[{type:'text',text:'图5'},{type:'image',data:bytes.toString('base64'),mimeType:'image/png'}]},
      ],
    });
    assert.equal(answer.正文,'已看见图5');
    assert.deepEqual(bodies[0].messages.map((message)=>message.role),['tool','user']);
    const imageUrl = bodies[0].messages[1].content.find((part)=>part.type==='image_url');
    assert.equal(imageUrl.image_url.url,`data:image/png;base64,${bytes.toString('base64')}`);
  } finally {
    providerServer.closeAllConnections();
    await new Promise((resolve)=>providerServer.close(resolve));
    fs.rmSync(directory,{recursive:true,force:true});
  }
});

test('图片引用在模型请求里投影为图像块，图号与标记共用对应的实际图片', async () => {
  const received = [];
  const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
  const { 门面, id } = await assemble({
    port: comfyPort({ 文件: { 'out.png': png } }),
    service: provider('drawing_generate', '{"正向":"取图"}', received),
  });
  await 门面.session.run('发', { 会话:id, 内容:[{type:'text',text:'取图'}] });
  await idle(门面.session,id);
  const toolMessage = received[1].messages.find((m) => m.role === 'tool');
  const visual = received[1].messages.find((m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((p) => p.type === 'image'));
  assert.ok(visual, '业务工具产出的图片必须以原生图像块发给模型');
  assert.equal(visual.content.find((p) => p.type === 'image').data, png.toString('base64'));
  assert.equal(toolMessage.content.includes('session-image'), false);
  await 门面.session.close();
});

test('工具请求每轮重新读取会话素材与图号，不把图库或模块信息写入系统提示词', async () => {
  const seen = [];
  const fakeService = {
    固定请求: () => async (request) => {
      seen.push(request);
      if (seen.length === 1) return {正文:'',消息:{tool_calls:[{id:'add',function:{name:'drawing_generate',arguments:'{"正向":"生成一张图"}'}}]},用的谁:{provider:'fake',model:'fake'}};
      return {正文:'完毕',消息:{},用的谁:{provider:'fake',model:'fake'}};
    },
  };
  const { 门面, id } = await assemble({
    service:fakeService,
    port:comfyPort({ 文件:{'out.png':Buffer.from([137,80,78,71,1])} }),
  });
  await 门面.session.run('发', {会话:id,内容:[{type:'text',text:'生成图片'}]});
  await idle(门面.session,id);
  assert.match(seen[0].system, /当前对话没有图片/);
  assert.match(seen[1].system, /当前对话图片/);
  assert.match(seen[1].system, /图1/);
  assert.doesNotMatch(seen[1].system, /图库|模块|session-image/i);
  await 门面.session.close();
});

test('提问在对应会话等待回答，取消/停止只结束本轮且不泄漏到另一会话', async () => {
  const received = [];
  const gate = pause();
  const service = {
    固定请求: () => async (request) => {
      received.push(request);
      if (received.length === 1) return {正文:'',消息:{tool_calls:[{id:'ask',function:{name:'ask_user',arguments:'{"问题":"选择角色","选项":["A","B"]}'}}]},用的谁:{provider:'fake',model:'fake'}};
      return {正文:'完成',消息:{},用的谁:{provider:'fake',model:'fake'}};
    },
  };
  const { 门面, id:a } = await assemble({ service, toolNames:['ask_user'] });
  const b = (await 门面.session.run('新')).data.会话.id;
  await 门面.session.run('发',{会话:a,内容:[{type:'text',text:'选角色'}]});
  let state;
  for (let i=0;i<100;i++) { state=门面.session.run('读',{会话:a}).data; if(state.待答问题) break; await new Promise(r=>setTimeout(r,2)); }
  assert.ok(state.待答问题);
  assert.equal(门面.session.run('读',{会话:b}).data.待答问题,null);
  const answer = await 门面.session.run('回答问题',{会话:a,问题ID:state.待答问题.问题ID,答案:'B'});
  assert.equal(answer.ok,true);
  const final = await idle(门面.session,a);
  assert.equal(final.turns[0].status,'complete');
  await 门面.session.close();
});

test('用户取消 ask_user 后保存取消回执并终止本轮剩余生图调用', async () => {
  const received = [];
  const service = {
    固定请求: () => async (request) => {
      received.push(request);
      return {
        正文: '',
        消息: { tool_calls: [
          {id:'ask1',function:{name:'ask_user',arguments:'{"问题":"选择角色","选项":[{"标识":"a","说明":"甲"},{"标识":"b","说明":"乙"}]}' }},
          {id:'draw1',function:{name:'drawing_generate',arguments:'{"正向":"甲"}' }},
        ] },
        用的谁:{provider:'fake',model:'fake'},
      };
    },
  };
  const port = comfyPort({ 文件: { 'out.png': Buffer.from([1,2,3]) } });
  const { 门面, id } = await assemble({ service, port, toolNames:['ask_user','drawing_generate'] });
  await 门面.session.run('发',{会话:id,内容:[{type:'text',text:'选角色并生成'}]});
  let question;
  for (let n=0;n<100;n++) {
    question = 门面.session.run('待答问题',{会话:id}).data.问题;
    if (question) break;
    await new Promise((resolve)=>setTimeout(resolve,2));
  }
  assert.ok(question);
  await 门面.session.run('取消问题',{会话:id,问题ID:question.问题ID});
  const final = await idle(门面.session,id);
  assert.equal(final.turns[0].status,'stopped');
  assert.equal(final.messages[1].toolCalls[0].result.code,'BUSINESS_CANCELLED');
  assert.equal(final.messages[1].toolCalls[1].status,'cancelled');
  assert.equal(port.记.取过的.length,0);
  assert.equal(received.length,1);
  await 门面.session.close();
});
