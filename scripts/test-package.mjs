import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2]);
const program = path.join(root, '程序');
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const relative = path.relative(root, full).replaceAll('\\', '/');
    if (entry.name === 'node_modules' || entry.name === '模型') continue;
    if (entry.isDirectory()) walk(full);
    else files.push(relative);
  }
}
walk(root);
const development = files.filter(file => /(^|\/)(test|tools|试|旧设计|临时|\.git)(\/|$)|tbx-probe-|AGENTS\.md$|验收\.md$/.test(file));
assert.deepEqual(development, [], '桌面包只交付运行内容和正式说明');
for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  assert.doesNotMatch(text, /\b[A-Za-z]:[\\/]+(?:Users[\\/]+(?!<)[^\\/\s"'`]+|Harness|codex)/i, `${file} 包含本机路径`);
}
for (const file of ['README.md', '文档/项目说明.md', '文档/模块架构.md', '文档/存储布局.md']) {
  assert.ok(fs.existsSync(path.join(root, file)), `保留 ${file}`);
}
assert.doesNotMatch(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /还没做的|换皮中|本次实施|桌面交付目录/);
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-release-'));
const previous = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = path.join(dataRoot, 'Local');
const before = [...files];
let server;
try {
  const { 起 } = await import(pathToFileURL(path.join(program, '对接层/界面/服务.js')));
  async function start() {
    server = 起({ 端口: 0, 项目根: program, 数据目录: path.join(dataRoot, 'personal') });
    await server.宿主.ready;
    await new Promise((resolve, reject) => {
      if (server.listening) resolve();
      else { server.once('listening', resolve); server.once('error', reject); }
    });
    assert.deepEqual(server.宿主.装不上, []);
    const base = `http://127.0.0.1:${server.address().port}`;
    const tokenScript = await fetch(`${base}/我们的令牌.js`).then(response => response.text());
    const token = JSON.parse(/window\.__令牌__ = (".*?");/.exec(tokenScript)[1]);
    const post = async (route, body = {}) => {
      const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-toolbox-token': token }, body: JSON.stringify(body) });
      assert.equal(response.status, 200);
      const value = await response.json();
      assert.notEqual(value?.ok, false, JSON.stringify(value));
      return value;
    };
    return { base, post };
  }
  let { base, post } = await start();
  const page = await fetch(base).then(response => response.text());
  for (const match of page.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)) {
    const response = await fetch(new URL(match[1], base));
    assert.equal(response.status, 200, `主页面资源 ${match[1]}`);
  }
  const storage = (await post('/toolbox/存储')).data;
  assert.equal(storage.模型目录, path.join(root, '模型'));
  assert.equal(storage.数据目录, path.join(dataRoot, 'personal'));
  assert.equal(storage.API, path.join(dataRoot, 'personal', 'API'));
  const status = await post('/toolbox/调', { 模块: 'tag', 动作: 'status' });
  assert.equal(status.记录.主库, 52240);
  const created = await post('/toolbox/调', { 模块: 'session', 动作: '新', 参数: {} });
  const sessions = await post('/toolbox/调', { 模块: 'session', 动作: '列' });
  assert.equal(sessions.会话.length, 2, JSON.stringify(created));
  await post('/toolbox/设置', { 存: { 主题: 'light' } });
  await server.停止();
  ({ post } = await start());
  assert.equal((await post('/toolbox/设置')).data.主题, 'light');
  assert.deepEqual((await post('/toolbox/调', { 模块: 'session', 动作: '列' })).会话, sessions.会话);
  await server.停止(); server = null;
  files.length = 0; walk(root);
  assert.deepEqual(files, before, '启动、写入和重启不往程序包保存个人文件');
  console.log('PASS: 正式说明、无开发资料/本机路径、主页面资源、全部模块、标签种子、HTTP 保存与重启、模型/个人数据分离');
} finally {
  await server?.停止();
  if (previous === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = previous;
  fs.rmSync(dataRoot, { recursive: true, force: true });
}
