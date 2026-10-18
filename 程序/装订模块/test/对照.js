'use strict';
const assert = require('node:assert/strict');
const { createBindingModule } = require('../index.js');

(async () => {
  const binding = createBindingModule({ 查词: words => words.map(word => ({'1girl':'1个女孩',solo:'单人'}[word] || null)) });
  const source = '  （1girl:1.2），\r\nsolo,,solo  ';
  const result = await binding.装订(source);
  assert.equal(result.ok, true);
  assert.equal(result.原文, source);
  assert.equal(result.译文, '  （1个女孩:1.2），\r\n单人,,单人  ');
  const rows = result.表.filter(row => row.词);
  assert.deepEqual(rows.map(row => source.slice(...row.原文范围)), ['（1girl:1.2）','solo','solo']);
  assert.deepEqual(rows.map(row => result.译文.slice(...row.译文范围)), ['（1个女孩:1.2）','单人','单人']);
  assert.equal(new Set(rows.map(row => row.标识)).size, 3);
  console.log('格式与独立对应范围通过');
})().catch(error => { console.error(error); process.exitCode = 1; });
