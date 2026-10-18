'use strict';
const assert = require('node:assert/strict');
const { createTranslateModule } = require('../index.js');
const { createBindingModule } = require('../../装订模块/index.js');

(async () => {
  const seen = [];
  const module = createTranslateModule({
    文本处理: createBindingModule().文本处理,
    译: async payload => { seen.push(payload); return {模型:'可控模型',units:payload.units.map((unit,index)=>({id:unit.id,text:index?'第二项':'红发女孩'}))}; },
  });
  const result = await module.本地译('girl with 红色头发, girl with 红色头发', {方向:'en-zh'});
  assert.equal(result.ok,true);
  assert.equal(result.data.译文,'红发女孩, 第二项');
  assert.deepEqual(seen[0].units,[{id:'u1',text:'girl with 红色头发'},{id:'u2',text:'girl with 红色头发'}]);
  assert.deepEqual(result.data.表.map(row=>result.data.原文.slice(...row.原文范围)),['girl with 红色头发','girl with 红色头发']);
  assert.deepEqual(result.data.表.map(row=>result.data.译文.slice(...row.译文范围)),['红发女孩','第二项']);
  console.log('混合文字、重复单元与真实范围通过');
})().catch(error=>{console.error(error);process.exitCode=1;});
