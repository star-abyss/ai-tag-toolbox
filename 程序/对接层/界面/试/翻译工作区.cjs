'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const moduleBox = { exports: {} };
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../页/views/translation-workspace.js'), 'utf8'), { module: moduleBox, globalThis: {} });
const { adaptReceipt, createLatestScheduler } = moduleBox.exports;

function testReceiptUsesBackendRangesWithoutResplitting() {
  const original = '(long hair:1.2), long hair';
  const translated = '(长发:1.2), 长头发';
  const receipt = {
    原文: original, 译文: translated, 方向: 'en-zh', 模型: 'local', 统计: { 库: 2 },
    表: [
      { 标识: 'u1', 原文范围: [0, 15], 译文范围: [0, 8], 出处: '库' },
      { 标识: 'u2', 原文范围: [17, 26], 译文范围: [10, 13], 出处: '模型' },
    ],
  };
  const adapted = adaptReceipt(receipt);
  assert.equal(adapted.text, translated);
  assert.deepEqual(adapted.alignment.sourceUnits.map(x => [x.id, x.start, x.end, x.text]), [
    ['u1', 0, 15, '(long hair:1.2)'], ['u2', 17, 26, 'long hair'],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(adapted.alignment.targetSegments.map(x => [x.text, x.sourceIds]))), [
    ['(长发:1.2)', ['u1']], [', ', []], ['长头发', ['u2']],
  ]);
  assert.equal(adapted.direction, 'en-zh');
  assert.equal(adapted.stats.库, 2);
}

async function testSchedulerKeepsOneFlightAndLatestWaitingSnapshot() {
  const calls = [], resolvers = [];
  const scheduler = createLatestScheduler(async snapshot => {
    calls.push(snapshot.value);
    return new Promise(resolve => resolvers.push(resolve));
  }, { onResult: (_result, snapshot) => calls.push(`done:${snapshot.value}`), delay: 0 });
  scheduler.replace({ value: 'A' }); await Promise.resolve();
  scheduler.replace({ value: 'B' });
  scheduler.replace({ value: 'C' });
  assert.deepEqual(calls, ['A']);
  resolvers[0]('A'); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['A', 'C']);
  resolvers[1]('C'); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['A', 'C', 'done:C']);
}

async function testFailureCanBeRetriedAndClearDropsLateResult() {
  let attempt = 0, seenError = '', completed = '';
  const scheduler = createLatestScheduler(async snapshot => {
    attempt += 1;
    if (attempt === 1) throw new Error('TEXT_LOCAL_BUSY: 模型正在翻译');
    return snapshot.text;
  }, {
    delay: 0,
    onError: error => { seenError = error.message; },
    onResult: result => { completed = result; },
  });
  scheduler.replace({ text: 'retry me' });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(seenError, /TEXT_LOCAL_BUSY/);
  scheduler.replace({ text: 'retry me' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempt, 2);
  assert.equal(completed, 'retry me');

  let release;
  const stale = createLatestScheduler(() => new Promise(resolve => { release = resolve; }), { onResult: () => { completed = 'stale'; } });
  stale.replace({ text: 'old' });
  stale.invalidate();
  release('old');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, 'retry me');
}

function testAlignmentHasNoFixedUnitCap() {
  const source = Array.from({ length: 300 }, (_, i) => `tag${i}`).join(', ');
  const target = Array.from({ length: 300 }, (_, i) => `词${i}`).join('，');
  const table = [];
  let sourceAt = 0, targetAt = 0;
  for (let i = 0; i < 300; i += 1) {
    const sourceText = `tag${i}`, targetText = `词${i}`;
    table.push({ 标识: `u${i + 1}`, 原文范围: [sourceAt, sourceAt + sourceText.length], 译文范围: [targetAt, targetAt + targetText.length] });
    sourceAt += sourceText.length + 2;
    targetAt += targetText.length + 1;
  }
  const adapted = adaptReceipt({ 原文: source, 译文: target, 表: table });
  assert.equal(adapted.alignment.sourceUnits.length, 300);
  assert.equal(adapted.alignment.targetSegments.filter(x => x.sourceIds.length).length, 300);
}

async function main() {
  testReceiptUsesBackendRangesWithoutResplitting();
  await testSchedulerKeepsOneFlightAndLatestWaitingSnapshot();
  await testFailureCanBeRetriedAndClearDropsLateResult();
  testAlignmentHasNoFixedUnitCap();
  console.log('翻译工作区 UI 回归通过');
}
main().catch(error => { console.error(error); process.exitCode = 1; });





