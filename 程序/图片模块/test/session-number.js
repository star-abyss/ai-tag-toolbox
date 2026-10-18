'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createImageModule } = require('../index.js');

const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-session-number-'));
const scope = (会话ID) => ({ 存放地: 'session', 会话ID });
const 保存 = (图片, 会话ID, n = 0) => 图片.存({ 作用域: scope(会话ID), 字节: Buffer.from([n + 1]), 文件名: `图${n}.png`, mime: 'image/png' });

async function 列图号(图片, 会话ID) {
  const 回执 = await 图片.run('列会话图', { 作用域: scope(会话ID) });
  assert.equal(回执.ok, true, 回执.reason);
  return 回执.data.条目;
}

(async () => {
  try {
    let nextId = 0;
    const 新标识 = () => `img_test-${++nextId}`;
    let 图片 = createImageModule({ 根目录: 根, 新标识 });
    const [a, b, c] = await Promise.all([
      保存(图片, 'A', 1), 保存(图片, 'A', 2), 保存(图片, 'A', 3),
    ]);
    assert.deepEqual([a.图号, b.图号, c.图号], [1, 2, 3], '同作用域并发保存应分配不同连续图号');
    assert.deepEqual((await 列图号(图片, 'A')).map((x) => x.图号), [1, 2, 3]);
    assert.equal((await 图片.run('按图号取详情', { 作用域: scope('A'), 图号: 2 })).data.标识, b.标识);

    await 图片.删({ 引用: c.引用 });
    const d = await 保存(图片, 'A', 4);
    assert.equal(d.图号, 4, '删除最大号后不可复用旧图号');

    图片 = createImageModule({ 根目录: 根, 新标识 });
    const e = await 保存(图片, 'A', 5);
    assert.equal(e.图号, 5, '重启后从持久化高水位继续编号');

    const legacy = await 保存(图片, 'legacy', 8);
    const legacy2 = await 保存(图片, 'legacy', 9);
    for (const entry of [legacy, legacy2]) {
      const metaPath = path.join(根, 'session', 'legacy', entry.标识, 'meta.json');
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      delete meta.sessionNumber;
      fs.writeFileSync(metaPath, JSON.stringify(meta));
    }
    fs.rmSync(path.join(根, 'session', 'legacy', 'scope.json'));
    const legacyList = await 图片.列会话图({ 作用域: scope('legacy') });
    assert.deepEqual(legacyList.条目.map((x) => x.图号), [1, 2], '旧会话首次列举时按既有列表顺序一次补齐编号');
    const legacy3 = await 保存(图片, 'legacy', 10);
    assert.equal(legacy3.图号, 3, '补齐旧会话后新图从高水位继续');

    await 图片.清空({ 作用域: scope('A') });
    const f = await 保存(图片, 'A', 6);
    assert.equal(f.图号, 6, '清空图片后不重置图号高水位');

    const { 造会话图片 } = await import('../../对接层/会话图片.js');
    const 会话图片 = 造会话图片({ 图片门面: 图片 });
    const source = await 保存(图片, 'A', 7);
    const payload = 会话图片.read('A', source.标识);
    assert.equal(payload.data.number, 7, '读取图片 payload 含稳定图号');
    const sourceNumbers = await 会话图片.listNumbered('A');
    const importedResult = await 会话图片.write('B', payload.data);
    assert.equal(importedResult.ok, true);
    await 会话图片.restoreNumbering('B', { highWater: sourceNumbers.data.highWater });
    const imported = 图片.取详情({ 引用: { 作用域: scope('B'), 条目ID: importedResult.data.id } });
    assert.equal(imported.图号, 7, '归档导入保留原图号');
    assert.notEqual(imported.标识, source.标识, '新会话素材仍使用新图片标识');
    const numbered = await 会话图片.listNumbered('B');
    assert.deepEqual(numbered.data.images, [{ id: imported.标识, number: 7, displayName: imported.显示名, filename: imported.文件名 }]);
    assert.equal(numbered.data.highWater, 7);
    const collision = await 会话图片.write('B', payload.data);
    assert.equal(collision.ok, false, '归档号与目标会话已有图号冲突时拒绝覆盖');
    const afterImport = await 保存(图片, 'B', 11);
    assert.equal(afterImport.图号, 8, '归档恢复高水位后新图从源高水位之后编号');

    const arch1 = await 保存(图片, 'archive-source', 20);
    const arch2 = await 保存(图片, 'archive-source', 21);
    const arch3 = await 保存(图片, 'archive-source', 22);
    await 图片.删({ 引用: arch3.引用 });
    const archiveNumbers = await 会话图片.listNumbered('archive-source');
    for (const sourceImage of [arch1, arch2]) {
      const asset = 会话图片.read('archive-source', sourceImage.标识).data;
      const result = await 会话图片.write('archive-target', asset);
      assert.equal(result.ok, true);
      assert.notEqual(result.data.id, sourceImage.标识);
    }
    await 会话图片.restoreNumbering('archive-target', { highWater: archiveNumbers.data.highWater });
    const targetNumbers = await 会话图片.listNumbered('archive-target');
    assert.deepEqual(targetNumbers.data.images.map(x => x.number), [1, 2]);
    assert.equal(targetNumbers.data.highWater, 3, '归档保留已删除最大图号留下的高水位');
    const afterDeletedMaxImport = await 保存(图片, 'archive-target', 23);
    assert.equal(afterDeletedMaxImport.图号, 4);

    const emptyRestore = await 会话图片.restoreNumbering('empty', { highWater: 13 });
    assert.equal(emptyRestore.ok, true, '没有剩余图片也能恢复已删除图号留下的高水位');
    const afterEmptyRestore = await 保存(图片, 'empty', 12);
    assert.equal(afterEmptyRestore.图号, 14);
    console.log('会话图号行为验证通过');
  } finally {
    fs.rmSync(根, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
