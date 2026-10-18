'use strict';
const assert = require('node:assert/strict');
const { createSessionModule, createMemoryAdapter, ERR } = require('../index.js');
const { images } = require('./假端口.js');
(async () => {
  const m = createSessionModule({ port: createMemoryAdapter(), 图片: images() });
  assert.equal(Object.isFrozen(m), true);
  assert.equal(Object.isFrozen(ERR), true);
  assert.equal(m.run('列').data.就绪, false);
  assert.equal((await m.run('新')).code, ERR.NOT_READY);
  await m.ready;
  assert.deepEqual(m.actions, [
    '列',
    '读',
    '待答问题',
    '回答问题',
    '取消问题',
    '新',
    '改名',
    '草稿',
    '改消息',
    '重新生成',
    '发',
    '停',
    '存',
    '清空',
    '删',
    '导出',
    '导入',
  ]);
  assert.deepEqual(
    m.describe().map((d) => d.动作),
    m.actions,
  );
  assert.equal(m.run('不存在').code, ERR.BAD_ACTION);
  const invalidWrite = m.run('草稿', () => {});
  assert.equal(invalidWrite instanceof Promise, true);
  assert.equal((await invalidWrite).code, ERR.BAD_ARGUMENT);
  const id = (await m.run('新')).data.会话.id;
  assert.match(id, /^s_[A-Za-z0-9-]+$/);
  assert.equal(
    (await m.run('发', { 会话: id, 内容: [{ type: 'text', text: '内容' }] })).code,
    ERR.NO_EXECUTOR,
  );
  for (const p of [null, {}, [{ type: 'image', imageId: '路径.png' }], [{ type: 'text', text: 1 }]])
    assert.equal((await m.run('草稿', { 会话: id, 内容: p })).code, ERR.BAD_ARGUMENT);
  const events = [];
  m.subscribe((e) => events.push(e));
  m.subscribe(() => {
    throw new Error('观察者');
  });
  await m.run('草稿', { 会话: id, 内容: [] });
  assert.deepEqual(Object.keys(events[0]), ['实例', '版本', '变更', '已删']);
  assert.deepEqual(events[0].变更, [id]);
  for (const d of m.describe())
    assert.equal(
      d.参数.some((p) => /路径|地址/.test(p)),
      false,
    );
  await m.close();
  console.log('会话接口契约通过：17 动作、同步读、写 Promise、字段、错误与通知');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
