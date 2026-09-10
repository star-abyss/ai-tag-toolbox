'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAiClient } = require('../src/modules/ai-client');
const { createAssistant } = require('../src/modules/assistant');
const { createStorage } = require('../src/modules/storage');
const { createTranslation } = require('../src/modules/translation');

const primaryApi = { base: 'https://reasoning.example.test/v1', model: 'thinking-fixture' };
const reasoningRequired = 'The reasoning_content in the thinking mode must be passed back to the API.';

test('API serialization preserves assistant reasoning exactly, including explicit empty values', async t => {
  let sent;
  t.mock.method(globalThis, 'fetch', async (_url, request) => {
    sent = JSON.parse(request.body).messages;
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
  });
  const input = [
    { role: 'system', content: 'system', reasoning_content: 'not assistant reasoning' },
    { role: 'user', content: 'user', reasoning_content: 'not assistant reasoning' },
    { role: 'assistant', content: 'first', reasoning_content: ' \n原始推理\n ', reasoning: 'display fallback' },
    { role: 'assistant', content: 'second', reasoning_content: '', reasoning: 'must not replace an explicit empty value' },
    { role: 'assistant', content: 'third', reasoning: '\nlegacy reasoning  ' },
    { role: 'assistant', content: 'plain reply' },
    { role: 'tool', tool_call_id: 'call-1', content: '{}', reasoning_content: 'not assistant reasoning' }
  ];
  const original = structuredClone(input);
  await createAiClient(primaryApi).complete(input, { stream: false });
  assert.deepEqual(sent, [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'user' },
    { role: 'assistant', content: 'first', reasoning_content: ' \n原始推理\n ' },
    { role: 'assistant', content: 'second', reasoning_content: '' },
    { role: 'assistant', content: 'third', reasoning_content: '\nlegacy reasoning  ' },
    { role: 'assistant', content: 'plain reply' },
    { role: 'tool', tool_call_id: 'call-1', content: '{}' }
  ]);
  assert.deepEqual(input, original);
});

for (const stream of [true, false]) {
  for (const hasReasoning of [true, false]) {
    test(`${stream ? 'streaming' : 'JSON'} replies distinguish empty reasoning from a missing field`, async t => {
      let sent;
      t.mock.method(globalThis, 'fetch', async (_url, request) => {
        sent = JSON.parse(request.body).messages;
        const message = { role: 'assistant', content: 'ok', ...(hasReasoning ? { reasoning_content: '' } : {}) };
        return stream
          ? new Response(`data: ${JSON.stringify({ choices: [{ delta: message, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
          : Response.json({ choices: [{ message }] });
      });
      const assistant = createAssistant({ storage: createStorage(), primaryApi });
      t.after(() => assistant.destroy());
      assert.equal((await assistant.run('hello', { stream })).ok, true);
      assert.equal((await assistant.run('continue', { stream })).ok, true);
      const previous = sent.find(row => row.role === 'assistant');
      assert.deepEqual(previous, { role: 'assistant', content: 'ok', ...(hasReasoning ? { reasoning_content: '' } : {}) });
    });
  }
  test(`${stream ? 'streaming' : 'JSON'} thinking tool calls survive continuation and session reload/import`, async t => {
    const received = [];
    t.mock.method(globalThis, 'fetch', async (_url, request) => {
      const body = JSON.parse(request.body);
      received.push(body);
      for (const message of body.messages.filter(row => row.role === 'assistant')) {
        const expected = message.tool_calls?.length ? ' \n先查本地翻译。\n ' : '\n根据工具结果回答。  ';
        if (message.reasoning_content !== expected) {
          return Response.json({ error: { message: reasoningRequired, type: 'invalidrequesterror', param: null, code: 'invalidrequesterror' } }, { status: 400 });
        }
      }
      const message = received.length === 1
        ? { role: 'assistant', content: null, reasoning_content: ' \n先查本地翻译。\n ', tool_calls: [{ id: 'thinking-call-1', type: 'function', function: { name: 'translation_translate', arguments: '{"text":"蓝发","direction":"zh-en","source":"local"}' } }] }
        : { role: 'assistant', content: 'blue hair', reasoning_content: '\n根据工具结果回答。  ' };
      const finishReason = message.tool_calls ? 'tool_calls' : 'stop';
      if (!body.stream) return Response.json({ choices: [{ message, finish_reason: finishReason }] });
      const deltas = [
        { reasoning_content: message.reasoning_content.slice(0, 4) },
        { reasoning_content: message.reasoning_content.slice(4) },
        { content: message.content, ...(message.tool_calls ? { tool_calls: message.tool_calls.map(call => ({ index: 0, ...call })) } : {}) }
      ];
      const frames = deltas.map(delta => ({ choices: [{ delta }] }));
      frames.push({ choices: [{ delta: {}, finish_reason: finishReason }] });
      return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const storage = createStorage();
    const options = { storage, primaryApi, translation: createTranslation({ dictionary: { 'zh-en': { '蓝发': 'blue hair' } } }) };
    const assistant = createAssistant(options);
    t.after(() => assistant.destroy());
    const first = await assistant.run('用本地词库翻译蓝发', { stream });
    assert.equal(first.ok, true, first.error?.message);
    assert.equal(first.data.text, 'blue hair');
    assert.equal(received.length, 2);
    const tool = received[1].messages.find(row => row.role === 'tool');
    assert.equal(tool.tool_call_id, 'thinking-call-1');
    assert.equal(JSON.parse(tool.content).text, 'blue hair');
    assert.deepEqual(first.data.transcript.filter(row => row.role === 'assistant').map(row => row.reasoning_content), [' \n先查本地翻译。\n ', '\n根据工具结果回答。  ']);

    const exported = assistant.exportSessions();
    assistant.destroy();
    const restored = createAssistant({ ...options, storage: stream ? storage : createStorage() });
    t.after(() => restored.destroy());
    if (!stream) assert(restored.importSessions(exported, true));
    const followup = await restored.run('继续说明', { stream });
    assert.equal(followup.ok, true, followup.error?.message);
    assert.equal(received.length, 3);
    assert(received[2].tools.length > 0);
    assert.deepEqual(received[2].messages.filter(row => row.role === 'assistant').map(row => row.reasoning_content), [' \n先查本地翻译。\n ', '\n根据工具结果回答。  ']);
    for (const body of received) {
      assert.equal(body.stream, stream);
      assert(body.messages.filter(row => row.role !== 'assistant').every(row => !Object.hasOwn(row, 'reasoning_content')));
    }
  });
}

test('legacy replies without a transcript reuse their saved reasoning in the next request', async t => {
  let sent;
  t.mock.method(globalThis, 'fetch', async (_url, request) => {
    sent = JSON.parse(request.body).messages;
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
  });
  const assistant = createAssistant({ storage: createStorage(), primaryApi });
  t.after(() => assistant.destroy());
  assert(assistant.importSessions({ format: 'ai-tag-sessions', version: 1, sessions: [{ id: 'legacy-session', messages: [
    { id: 'user', role: 'user', text: 'hello', status: 'done' },
    { id: 'assistant', role: 'assistant', text: 'saved answer', reasoning: ' \n保存的推理。\n ', status: 'done' },
    { id: 'plain', role: 'assistant', text: 'plain answer', status: 'done' }
  ] }] }, true));
  const result = await assistant.run('continue', { stream: false });
  assert.equal(result.ok, true, result.error?.message);
  assert.deepEqual(sent.filter(row => row.role === 'assistant'), [
    { role: 'assistant', content: 'saved answer', reasoning_content: ' \n保存的推理。\n ' },
    { role: 'assistant', content: 'plain answer' }
  ]);
});
