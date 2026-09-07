'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCallMonitor } = require('../src/modules/call-monitor');
const { createAssistant } = require('../src/modules/assistant');
const { createAiClient } = require('../src/modules/ai-client');
const { createAgentRuntime } = require('../src/modules/agent-runtime');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const promptSource = { composePrimary: () => 'PRIMARY SYSTEM', composeGenerate: () => 'GENERATOR SYSTEM', get: () => 'FIXED PROMPT' };

test('diagnostic copies redact nested JSON, embedded credentials, images and paths before disk write', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-call-monitor-'));
  try {
    const filePath = path.join(dir, 'calls.json');
    const monitor = createCallMonitor({ filePath, getSecrets: () => ['test-private-key'] });
    const input = { messages: [{ content: 'keep blue hair; test-private-key; data:image/png;base64,AQ==' }, { content: JSON.stringify({ apiKey: 'nested-private-key', path: 'C:\\private\\photo.png', tag: 'blue hair' }) }], image: new Uint8Array([1, 2]), prompt_tokens: 42, apiKey: 'private-key' };
    monitor.begin({ requestId: 'r1', rootRequestId: 'r1', kind: 'primary', input });
    monitor.finish('r1', { status: 'completed', output: { text: 'returned test-private-key', absolute: '/Users/private/photo.png' } });
    await monitor.flush();
    const saved = fs.readFileSync(filePath, 'utf8');
    assert.doesNotMatch(saved, /test-private-key|nested-private-key|private-key|data:image|base64|AQ==|photo\.png/);
    assert.match(saved, /blue hair/);
    assert.equal(monitor.list()[0].input.prompt_tokens, 42);
    assert.equal(input.apiKey, 'private-key');
    assert.match(input.messages[0].content, /test-private-key/);
    const restored = createCallMonitor({ filePath });
    assert.equal(restored.list()[0].output.text, 'returned [REDACTED]');
    restored.clear(); await restored.flush();
    assert.deepEqual(createCallMonitor({ filePath }).list(), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('real assistant connects primary rounds and fixed-subagent output under one root request', async () => {
  let round = 0;
  const app = createAssistant({ promptSource,
    primaryApi: { base: 'https://example.test/v1', model: 'test-model', key: 'test-secret-key' },
    primaryGateway: { complete: async messages => {
      if (messages[0]?.content === 'FIXED PROMPT') return { text: 'blue hair', usage: { total_tokens: 6 } };
      return ++round === 1
        ? { toolCalls: [{ id: 'translation-call', name: 'translation_translate', arguments: { text: '蓝发', direction: 'zh-en', source: 'ai' } }], usage: { total_tokens: 3 } }
        : { text: '完成', usage: { total_tokens: 4 } };
    } }
  });
  const result = await app.run({ text: '画蓝发人物', requestId: 'trace-root' });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const rows = app.listCallRecords();
  const primary = rows.find(row => row.kind === 'primary');
  assert.equal(primary.exchanges.length, 2);
  assert.equal(primary.exchanges[0].request.body.messages.at(-1).content, '画蓝发人物');
  assert(primary.exchanges[1].request.body.messages.some(row => row.role === 'tool'));
  assert.equal(primary.exchanges[0].request.body.tools.length, 8);
  const child = rows.find(row => row.kind === 'subagent:translation');
  const tool = rows.find(row => row.kind === 'tool:translation.translate');
  assert.equal(child.parentRequestId, tool.requestId);
  assert.equal(child.rootRequestId, primary.requestId);
  assert.equal(child.exchanges[0].request.body.messages[0].content, 'FIXED PROMPT');
  assert.equal(child.exchanges[0].response.text, 'blue hair');
  assert.equal(child.output.text, 'blue hair');
  assert.equal(child.exchanges[0].usage.total_tokens, 6);
  assert.doesNotMatch(JSON.stringify(rows), /test-secret-key/);
  app.destroy();
});

test('raw malformed Tag replies remain inspectable after parser failure', async () => {
  const app = createAssistant({ promptSource, primaryApi: { model: 'test' }, visionGateway: { complete: async () => ({ text: 'not JSON at all' }) } });
  const result = await app.runtime.runSubAgent('generateTags', { input: { requirements: 'girl' } });
  assert.equal(result.error.code, 'OUTPUT_INVALID');
  const row = app.listCallRecords()[0];
  assert.equal(row.status, 'error');
  assert.equal(row.exchanges[0].response.text, 'not JSON at all');
  app.destroy();
});

test('running calls time out without late replies overwriting the monitor', async () => {
  let reply;
  const monitor = createCallMonitor();
  const client = createAiClient({ model: 'test' }, { complete: () => new Promise(resolve => { reply = resolve; }) }, monitor);
  const runtime = createAgentRuntime({ monitor, primaryClient: client });
  const promise = runtime.runPrimary({ requestId: 'timeout', input: { text: 'hello' }, timeoutMs: 30 });
  await wait(2);
  assert.equal(monitor.list()[0].status, 'running');
  assert.equal(monitor.list()[0].exchanges[0].status, 'running');
  const result = await promise;
  assert.equal(result.error.code, 'TIMEOUT');
  assert.equal(monitor.list()[0].status, 'timeout');
  const snapshot = JSON.stringify(monitor.list());
  reply({ text: 'late' }); await wait(2);
  assert.equal(JSON.stringify(monitor.list()), snapshot);
  monitor.clear();
  assert.deepEqual(monitor.list(), []);
});

test('record count and byte limits are enforced and truncation is explicit', () => {
  const monitor = createCallMonitor({ maxRecords: 2, maxBytes: 16000, maxRecordBytes: 6000 });
  for (let n = 0; n < 5; n++) {
    monitor.begin({ requestId: String(n), kind: 'tool:test', input: { long: 'a'.repeat(20000) } });
    monitor.finish(String(n), { status: 'completed', output: {} });
  }
  const rows = monitor.list();
  assert.equal(rows.length, 2);
  assert(rows.every(row => row.truncated));
  assert(Buffer.byteLength(JSON.stringify(rows)) < 16000);
  rows[0].status = 'tampered';
  assert.equal(monitor.list()[0].status, 'completed');
});

test('oversized diagnostics preserve the terminal error before bulky output', () => {
  const monitor = createCallMonitor({ maxRecordBytes: 4096, maxBytes: 8192 });
  monitor.begin({ requestId: 'terminal-error', kind: 'subagent:evaluateImages', input: { prompt: 'x'.repeat(12000) } });
  monitor.finish('terminal-error', {
    status: 'error',
    output: { raw: 'y'.repeat(20000) },
    error: { code: 'OUTPUT_INVALID', message: '最终评估 JSON 连续两次无效' },
    usage: { total_tokens: 123 }
  });
  const row = monitor.list()[0];
  assert.equal(row.status, 'error');
  assert.equal(row.error.code, 'OUTPUT_INVALID');
  assert.match(row.error.message, /连续两次无效/);
  assert.equal(row.truncated, true);
});

test('HTTP request snapshots match the transmitted body and preserve assembled stream output', async () => {
  const http = require('node:http');
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      received.push({ body: JSON.parse(body), authorization: req.headers.authorization });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'blue ' } }] }) + '\n\n' +
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'hair' }, finish_reason: 'stop' }], usage: { total_tokens: 8 } }) + '\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const monitor = createCallMonitor();
    const client = createAiClient({ base: `http://127.0.0.1:${server.address().port}`, model: 'local-fixture', key: 'fixture-key' }, null, monitor);
    const runtime = createAgentRuntime({ primaryClient: client, monitor });
    const result = await runtime.runPrimary({ requestId: 'stream', input: { text: 'hair color' } });
    assert.equal(result.data.text, 'blue hair');
    const exchange = monitor.list()[0].exchanges[0];
    assert.deepEqual(exchange.request.body, received[0].body);
    assert.equal(received[0].authorization, 'Bearer fixture-key');
    assert.equal(exchange.request.headers.Authorization, '[REDACTED]');
    assert.equal(exchange.response.text, 'blue hair');
    assert.equal(exchange.response.responseFormat, 'assembled-stream');
    assert.equal(exchange.usage.total_tokens, 8);
    assert.equal(exchange.response.httpStatus, 200);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('AI translation and image-description calls retain their own requests and never store image pixels', async () => {
  const { createVisionService } = require('../src/modules/vision-service');
  const { createFixedSubagents } = require('../src/modules/fixed-subagents');
  const monitor = createCallMonitor();
  const client = createAiClient({ model: 'test-vision' }, { complete: async () => ({ text: 'blue hair' }) }, monitor);
  const vision = createVisionService({ images: { get: () => ({ id: 'img', dataUrl: 'data:image/png;base64,AQ==' }) }, visionAI: client, getPrompt: () => 'VISION SYSTEM' });
  const subagents = createFixedSubagents({ ai: client, visionAI: client, vision, prompts: { get: () => 'TRANSLATION SYSTEM' } });
  const runtime = createAgentRuntime({ monitor, subagents });
  const translated = await runtime.runSubAgent('translation', { input: { text: '蓝发', source: 'ai' } });
  assert.equal(translated.ok, true);
  const described = await runtime.runSubAgent('vision', { input: { imageId: 'img', mode: 'ai' } });
  assert.equal(described.ok, true, JSON.stringify(described.error));
  const [translation, image] = monitor.list();
  assert.equal(translation.exchanges[0].request.body.messages[0].content, 'TRANSLATION SYSTEM');
  assert.equal(image.input.imageId, 'img');
  assert.equal(image.exchanges[0].request.body.messages[0].content, 'VISION SYSTEM');
  assert.equal(image.exchanges[0].request.body.messages[1].content[1].image_url, '[REDACTED]');
  assert.doesNotMatch(JSON.stringify(monitor.list()), /AQ==|base64/);
});
