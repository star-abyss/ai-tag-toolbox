import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { 造服务商面 } from '../服务商.js';

const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-api-store-'));
const 文件 = path.join(目录, '链路.json');

try {
  const 空面 = 造服务商面({ 目录 });
  assert.deepEqual(空面.读链路(), []);
  assert.deepEqual(空面.取链路状态(), { ok: true, code: '', reason: '' });

  空面.写链路([{ id: 'persisted', 名字: '测试', 地址: 'https://example.invalid/v1', 模型: 'model', 密钥: 'test-secret' }]);
  const 重启后 = 造服务商面({ 目录 });
  assert.equal(重启后.读链路()[0]?.模型, 'model');
  assert.deepEqual(重启后.取链路状态(), { ok: true, code: '', reason: '' });

  const 损坏原文 = '{"链路":[{"密钥":"test-secret"}],';
  fs.writeFileSync(文件, 损坏原文, 'utf8');
  const 损坏面 = 造服务商面({ 目录 });
  assert.deepEqual(损坏面.读链路(), []);
  const 状态 = 损坏面.取链路状态();
  assert.equal(状态.ok, false);
  assert.equal(状态.code, 'API_STORE_READ');
  assert.match(状态.reason, /JSON 无法解析/);
  assert.doesNotMatch(状态.reason, /test-secret/);
  assert.throws(() => 损坏面.写链路([]), /API_STORE_READ/);
  await assert.rejects(损坏面.请求({ messages: [{ role: 'user', content: 'hello' }] }), (错) => {
    assert.equal(错.code, 'API_STORE_READ');
    assert.equal(错.reason, 'API_STORE_READ: 链路存档 JSON 无法解析');
    assert.doesNotMatch(错.reason, /test-secret/);
    return true;
  });
  assert.equal(fs.readFileSync(文件, 'utf8'), 损坏原文);

  fs.writeFileSync(文件, '{"链路":"test-secret"}', 'utf8');
  const 格式错误面 = 造服务商面({ 目录 });
  格式错误面.读链路();
  assert.deepEqual(格式错误面.取链路状态(), {
    ok: false,
    code: 'API_STORE_READ',
    reason: '链路存档格式不正确，需要包含链路数组',
  });
  await assert.rejects(格式错误面.请求({ messages: [{ role: 'user', content: 'hello' }] }), (错) => {
    assert.equal(错.code, 'API_STORE_READ');
    assert.equal(错.reason, 'API_STORE_READ: 链路存档格式不正确，需要包含链路数组');
    assert.doesNotMatch(错.reason, /test-secret/);
    return true;
  });
  fs.rmSync(文件);
  fs.mkdirSync(文件);
  const 读盘错误面 = 造服务商面({ 目录 });
  读盘错误面.读链路();
  assert.equal(读盘错误面.取链路状态().code, 'API_STORE_READ');
  assert.match(读盘错误面.取链路状态().reason, /EISDIR/);
  console.log('通过：空配置、重启读取、存档错误不泄露且模型请求返回 API_STORE_READ');
} finally {
  fs.rmSync(目录, { recursive: true, force: true });
}
