import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { 造宿主 } from '../../宿主.js';
import { 临时项目 } from './会话装置.js';

const fixture = 临时项目();
const host = 造宿主({ 项目根: fixture.root, 数据目录: path.join(fixture.root, 'API') });
const call = (模块, 动作, 参数 = {}) => host.调({ 模块, 动作, 参数 });
const bookFile = path.resolve(fixture.root, host.配置.世界书用户目录, '世界书.json');
function blockFile(file) { fs.renameSync(file, file + '.before'); fs.mkdirSync(file); }
function unblockFile(file) { fs.rmdirSync(file); fs.renameSync(file + '.before', file); }
try {
  await host.ready;
  const first = await call('worldbook', '书', { 动作: '新建', 请求: '主AI', 名字: '甲' });
  const second = await call('worldbook', '书', { 动作: '新建', 请求: '主AI', 名字: '乙' });
  await call('worldbook', '书', { 动作: '换', 请求: '主AI', 启用: [first.标识, second.标识] });
  await call('worldbook', '存');

  await call('worldbook', '书', { 动作: '删', 标识: first.标识 });
  blockFile(bookFile);
  let failure;
  try { failure = await call('worldbook', '存'); }
  finally { unblockFile(bookFile); }
  assert.equal(failure.ok, false, '世界书存档失败明确返回失败');
  await call('worldbook', '重读');
  const afterFailure = await call('worldbook', '读', { 请求: '主AI' });
  assert.ok(afterFailure.表.some(row => row.标识 === first.标识), '书存档失败后重读仍保留原书');
  assert.deepEqual(afterFailure.启用.map(row => row.标识), [first.标识, second.标识], '书存档失败后原订阅列表完整保留');

  await call('worldbook', '书', { 动作: '删', 标识: first.标识 });
  const saved = await call('worldbook', '存');
  assert.notEqual(saved?.ok, false, '删除后世界书存档成功');
  const afterDelete = await call('worldbook', '读', { 请求: '主AI' });
  assert.ok(!afterDelete.表.some(row => row.标识 === first.标识), '删除后书从本模块目录移除');
  assert.deepEqual(afterDelete.启用.map(row => row.标识), [second.标识], '删除书后统一订阅只移除该书');
  console.log('通过：世界书单一存档失败时原书与启用清单不变，成功删除后订阅同步移除该书');
} finally { await host.close(); fixture.cleanup(); }