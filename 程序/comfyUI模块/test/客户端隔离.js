'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { createHttpAdapter } = require('../adapter-http.js');

(async () => {
  const submitted = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    submitted.push(JSON.parse(body));
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ prompt_id: `task-${submitted.length}` }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = `http://127.0.0.1:${server.address().port}`;
    const first = createHttpAdapter({ 地址: address });
    const graph = { 1: { class_type: 'SaveImage', inputs: {} } };
    assert.equal((await first.提交(graph)).ok, true);
    assert.match(submitted[0].client_id || '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, '工具提交必须带独立客户端标识，避免把采样进度广播给网页');
    await first.提交(graph);
    assert.equal(submitted[1].client_id, submitted[0].client_id, '同一适配器复用自己的客户端标识');
    const second = createHttpAdapter({ 地址: address });
    await second.提交(graph);
    assert.notEqual(submitted[2].client_id, submitted[0].client_id, '不同客户端的标识独立');
    await first.提交(graph, { clientId: 'manual-browser', 界面图: { nodes: [], links: [] } });
    assert.equal(submitted[3].client_id, 'manual-browser');
    assert.deepEqual(submitted[3].extra_data.extra_pnginfo.workflow, { nodes: [], links: [] });
    console.log('通过：默认工具客户端独立、实例内复用、显式网页客户端与工作流元数据保留');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
