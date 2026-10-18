import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 造宿主 } from '../宿主.js';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-storage-'));
const previous = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = path.join(temporary, 'Local');
const data = path.join(temporary, 'personal');
const program = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let host;
try {
  host = 造宿主({ 数据目录: data });
  assert.equal(host.配置.会话目录, path.join(data, '会话'));
  assert.equal(host.配置.图片目录, path.join(data, '图库'));
  assert.equal(host.服务商.目录, path.join(data, 'API'));
  assert.equal(host.列().目录, path.resolve(program, '..', '模型'));
  assert.equal(fs.readFileSync(path.join(data, '.gitignore'), 'utf8'), '*\n');
  await host.ready;
  const created = await host.调({ 模块: 'session', 动作: '新', 参数: {} });
  assert.ok(created.标识 || created.会话?.id, JSON.stringify(created));
  const before = await host.调({ 模块: 'session', 动作: '列' });
  const workflow = { id: '11111111-1111-4111-8111-111111111111', nodes: [{ id: 1, type: 'CLIPTextEncode', widgets_values: ['存储验收'] }], links: [] };
  const saved = await host.调({ 模块: 'comfy', 动作: '存工作流', 参数: { 图: workflow } });
  assert.notEqual(saved.ok, false, JSON.stringify(saved));
  await host.存储.写设置({ 主题: 'light' });
  await host.close();
  const otherProgram = path.join(temporary, 'new-package', '程序');
  fs.mkdirSync(otherProgram, { recursive: true });
  for (const name of ['tag模块', '图片模块', '世界书模块', '装订模块', 'comfyUI模块', '翻译模块', '识图模块', '主AI模块', '会话模块', '内置资源']) {
    fs.symlinkSync(path.join(program, name), path.join(otherProgram, name), 'junction');
  }
  fs.copyFileSync(path.join(program, 'version.json'), path.join(otherProgram, 'version.json'));
  host = 造宿主({ 项目根: otherProgram, 数据目录: data });
  await host.ready;
  assert.deepEqual((await host.调({ 模块: 'session', 动作: '列' })).会话, before.会话);
  assert.equal(host.存储.读设置().主题, 'light');
  assert.deepEqual((await host.调({ 模块: 'comfy', 动作: '取工作流' })).界面图, workflow);
  const addedModel = path.resolve(otherProgram, '../模型/识图/wd-new');
  fs.mkdirSync(addedModel, { recursive: true });
  fs.writeFileSync(path.join(addedModel, 'wd-eva02.onnx'), 'fixture');
  fs.writeFileSync(path.join(addedModel, 'tags-canary.json'), '[]');
  assert.equal(host.列().这次用.vision, 'wd-new');
  assert.equal((await host.调({ 模块: 'vision', 动作: '看模型' })).模型.id, 'wd-new');
  const next = path.join(temporary, 'another-drive');
  await host.存储.设置数据目录(next);
  assert.equal(host.存储.读位置().数据目录, data);
  assert.equal(host.存储.读位置().下次数据目录, next);
  await host.close();
  host = 造宿主();
  await host.ready;
  assert.equal(host.存储.读位置().数据目录, next);
  assert.equal(host.存储.读设置().主题, undefined);
  assert.ok(fs.existsSync(path.join(data, '设置.json')));
  console.log('PASS: 全部个人数据同根、会话与设置重启保留、模型位于程序根目录、位置修改下次启动生效');
} finally {
  await host?.close();
  if (previous === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = previous;
  fs.rmSync(temporary, { recursive: true, force: true });
}
