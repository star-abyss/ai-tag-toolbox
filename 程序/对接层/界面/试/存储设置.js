import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-storage-http-'));
const 临时数据 = path.join(根, '临时数据');
const 原LOCALAPPDATA = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = path.join(根, 'appdata');
const { 起 } = await import('../服务.js');
const 项目根 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let 服务;
async function 起服务() {
  const 新服务 = 起({ 端口: 0, 项目根 });
  await 新服务.宿主.ready;
  await new Promise((resolve) => 新服务.listening ? resolve() : 新服务.once('listening', resolve));
  return 新服务;
}

try {
  服务 = await 起服务();
  let 地址 = `http://127.0.0.1:${服务.address().port}`;
  let 脚本 = await fetch(`${地址}/我们的令牌.js`).then((回) => 回.text());
  let 令牌 = JSON.parse(/window\.__令牌__ = (".*?");/.exec(脚本)?.[1] || 'null');
  const post = async (路, body = {}) => fetch(`${地址}${路}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-toolbox-token': 令牌 },
    body: JSON.stringify(body),
  }).then((回) => 回.json());

  const 位置回 = await post('/toolbox/存储');
  assert.equal(位置回.ok, true);
  assert.equal(位置回.data.数据目录, path.join(根, 'appdata', '工具箱'));
  assert.equal(位置回.data.API, path.join(位置回.data.数据目录, 'API'));

  const 链路回 = await post('/toolbox/链路');
  assert.equal(链路回.data.目录, 位置回.data.API);

  const 新位置回 = await post('/toolbox/存储', { 数据目录: 临时数据 });
  assert.equal(新位置回.ok, true);
  assert.equal(新位置回.data.下次数据目录, 临时数据);
  assert.equal(fs.existsSync(临时数据), false);

  await 服务.停止();
  服务 = await 起服务();
  地址 = `http://127.0.0.1:${服务.address().port}`;
  脚本 = await fetch(`${地址}/我们的令牌.js`).then((回) => 回.text());
  令牌 = JSON.parse(/window\.__令牌__ = (".*?");/.exec(脚本)?.[1] || 'null');
  const 重启位置 = await post('/toolbox/存储');
  assert.equal(重启位置.data.数据目录, 临时数据);
  assert.equal(重启位置.data.下次数据目录, 临时数据);
  const 重启链路 = await post('/toolbox/链路');
  assert.equal(重启链路.data.目录, path.join(临时数据, 'API'));

  const 设置前 = await post('/toolbox/设置');
  const 设置后 = await post('/toolbox/设置', { 存: { ...设置前.data, 测试项: '写入成功' } });
  assert.equal(设置后.ok, true);
  assert.equal(设置后.data.测试项, '写入成功');

  const 模型列 = await post('/toolbox/模型');
  assert.equal(modelResultValid(模型列), true);
  const 识图 = 模型列.data.vision.find((model) => model.装好了);
  const 模型ID = 识图?.id || '';
  const 模型选择回 = await post('/toolbox/模型', { 换: { 类别: 'vision', id: 模型ID } });
  assert.equal(模型选择回.ok, true);
  assert.equal(模型选择回.data.这次用.vision, 模型ID);
  const 模型设置 = await post('/toolbox/设置');
  assert.equal(模型设置.data.识图模型, 模型ID);
  console.log('通过：数据位置下次启动生效且重启读取、API 存档共用数据根、设置和模型选择持久化');
} finally {
  if (服务) await 服务.停止();
  if (原LOCALAPPDATA === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = 原LOCALAPPDATA;
  fs.rmSync(根, { recursive: true, force: true });
}

function modelResultValid(value) {
  return value?.ok === true && Array.isArray(value.data?.vision) && Array.isArray(value.data?.translation);
}
