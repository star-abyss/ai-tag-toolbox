'use strict';

/**
 * 极小 MCP stdio 适配器。
 *
 * Electron 应用负责启动本地 Calls HTTP 服务；本进程只把 MCP 的
 * initialize/tools/list/tools/call 转换为对应的 HTTP 请求，避免协议层
 * 复制任何 Tag、识图或 ComfyUI 业务逻辑。
 */

const readline = require('node:readline');

const port = Number(process.env.AITAG_AGENT_PORT) || 32145;
const base = `http://127.0.0.1:${port}`;

function write(id, result, error) {
  const message = error
    ? { jsonrpc: '2.0', id, error: { code: error.code || -32000, message: error.message || String(error) } }
    : { jsonrpc: '2.0', id, result };
  process.stdout.write(JSON.stringify(message) + '\n');
}

async function request(pathname, init) {
  const response = await fetch(base + pathname, init);
  const value = await response.json();
  if (!response.ok || value?.ok === false) throw new Error(value?.error || `Agent 工具服务 HTTP ${response.status}`);
  return value;
}

async function handle(message) {
  const id = message.id;
  const method = message.method;
  if (method === 'initialize') {
    return write(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'ai-tag-toolbox', version: '1.4.191' }
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;
  if (method === 'ping') return write(id, {});
  if (method === 'tools/list') {
    const value = await request('/tools/list');
    return write(id, { tools: (value.tools || []).map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema || { type: 'object', properties: {} }, group: tool.group, permission: tool.permission })) });
  }
  if (method === 'tools/call') {
    const params = message.params || {};
    const value = await request('/tools/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, tool: params.name, arguments: params.arguments || {} })
    });
    const artifact = value?.data?.artifact;
    const content = [{ type: 'text', text: JSON.stringify(value) }];
    if (artifact?.dataUrl && /^data:image\//i.test(artifact.dataUrl)) {
      const comma = artifact.dataUrl.indexOf(',');
      if (comma > 0) content.push({ type: 'image', data: artifact.dataUrl.slice(comma + 1), mimeType: artifact.dataUrl.slice(5, comma).split(';')[0] || 'image/png' });
    }
    return write(id, { content, isError: value.ok === false });
  }
  return write(id, null, Object.assign(new Error(`未知 MCP 方法：${method}`), { code: -32601 }));
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  Promise.resolve(handle(message)).catch(error => write(message.id, null, error));
});
