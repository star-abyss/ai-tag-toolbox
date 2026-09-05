'use strict';

const http = require('node:http');

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).trim();
  return result || fallback;
}

function json(value) {
  return JSON.stringify(value == null ? null : value);
}

function createCallServer(options = {}) {
  const calls = options.calls;
  const getPermissions = typeof options.getPermissions === 'function' ? options.getPermissions : () => ({});
  const host = text(options.host, '127.0.0.1');
  const requestedPort = Number(options.port) || 0;
  let server = null;
  let address = null;

  function response(res, status, body) {
    const payload = json(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
    res.end(payload);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let value = '';
      req.setEncoding('utf8');
      req.on('data', chunk => {
        value += chunk;
        if (value.length > 2 * 1024 * 1024) reject(new Error('请求体过大'));
      });
      req.on('end', () => resolve(value));
      req.on('error', reject);
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url || '/', `http://${host}`);
    const permissions = getPermissions() || {};
    const allowWrite = permissions.write === true || permissions.agentWriteEnabled === true;
    const callerOptions = { caller: 'external-agent', allowWrite };
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return response(res, 200, { ok: true, name: 'AI 绘画 Tag 工具箱 Agent Tools', apiVersion: '1.0', port: address?.port || 0 });
    }
    if (req.method === 'GET' && url.pathname === '/tools/list') {
      const tools = typeof calls?.listAgent === 'function'
        ? await calls.listAgent(callerOptions)
        : typeof calls?.listAvailable === 'function'
          ? await calls.listAvailable(null, callerOptions)
          : calls?.list?.(null, callerOptions) || [];
      return response(res, 200, {
        ok: true,
        apiVersion: '1.0',
        tools,
        capabilities: calls?.getCapabilities?.() || null,
        permissions: { write: allowWrite },
        groups: {
          runtime: tools.filter(tool => tool.group === 'runtime').map(tool => tool.name),
          admin: tools.filter(tool => tool.group === 'admin').map(tool => tool.name)
        }
      });
    }
    if (req.method !== 'POST' || url.pathname !== '/tools/call') return response(res, 404, { ok: false, code: 'NOT_FOUND', error: '未找到 Agent 工具接口' });
    let body;
    try { body = JSON.parse(await readBody(req) || '{}'); } catch (error) { return response(res, 400, { ok: false, code: 'BAD_JSON', error: error.message || String(error) }); }
    const name = text(body.tool || body.name || body.method);
    const args = body.arguments || body.params || {};
    const result = await calls.call(name, args, { caller: 'external-agent', allowWrite, requestId: body.id });
    return response(res, 200, { id: body.id == null ? null : body.id, ...result });
  }

  function start() {
    if (server) return Promise.resolve({ ...address, running: true });
    if (!calls?.call) return Promise.reject(new Error('Calls 模块不可用'));
    server = http.createServer((req, res) => { handle(req, res).catch(error => response(res, 500, { ok: false, code: 'SERVER_ERROR', error: error.message || String(error) })); });
    return new Promise((resolve, reject) => {
      const fail = error => { server = null; reject(error); };
      server.once('error', fail);
      server.listen(requestedPort, host, () => {
        server.off('error', fail);
        const value = server.address();
        address = { host, port: typeof value === 'object' && value ? value.port : requestedPort };
        resolve({ ...address, running: true });
      });
    });
  }

  function stop() {
    if (!server) return Promise.resolve(true);
    return new Promise(resolve => server.close(() => { server = null; address = null; resolve(true); }));
  }

  function status() { return { ...(address || { host, port: 0 }), running: Boolean(server) }; }

  return { start, stop, status, handle };
}

module.exports = { createCallServer };
