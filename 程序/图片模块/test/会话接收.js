'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createImageModule } = require('../index.js');
const { createMemoryAdapter } = require('../adapter-memory.js');
test('H13 接收规则在实际队列写入时检查，拒绝不产生实体', async () => {
  let accepts = true;
  const m = createImageModule({ port: createMemoryAdapter(), 接收作用域: () => accepts ? { ok: true } : { ok: false, code: 'SESSION_BUSY', reason: 'SESSION_BUSY: 删除中' } });
  const promise = m.run('存', { 作用域: { 存放地: 'session', 会话ID: 's_a' }, 字节: Buffer.from('a'), 文件名: 'a.png' }); accepts = false;
  assert.equal((await promise).code, 'SESSION_BUSY'); assert.equal(m.run('列', { 作用域: { 存放地: 'session', 会话ID: 's_a' } }).data.总数, 0);
});
test('H14 清空队列内枚举包括之前排队的存图', async () => {
  const m = createImageModule({ port: createMemoryAdapter() }); const scope = { 存放地: 'session', 会话ID: 's_a' };
  const stored = m.run('存', { 作用域: scope, 字节: Buffer.from('a'), 文件名: 'a.png' }); const cleared = m.run('清空', { 作用域: scope });
  assert.equal((await stored).ok, true); assert.equal((await cleared).data.已删, 1); assert.equal(m.run('列', { 作用域: scope }).data.总数, 0);
});
