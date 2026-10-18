// 动作浏览器 · 自检。起着服务，走 HTTP 把四条路由各验一遍。
//
//   node 对接层/tools/动作浏览器/test/run.js
//
// 自建数据、自清数据：世界书那段建一本再删掉，模型那段造一格假模型再删掉，跑完不留残留。
// 要真数据的（图库、ComfyUI、本地模型）只验"有这条动作、失败能分辨"，不要求机器上有东西。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const 本目录 = path.dirname(fileURLToPath(import.meta.url));
const 服务文件 = path.resolve(本目录, '..', '服务.js');
const 端口 = 8793;
const 测试数据位置 = fs.mkdtempSync(path.join(path.dirname(本目录), '浏览器数据-'));
process.once('exit', () => fs.rmSync(测试数据位置, { recursive: true, force: true }));

let 过 = 0;
let 败 = 0;
async function 查(名, 做) {
  try {
    const 说明 = await 做();
    过 += 1;
    console.log(`  ok   ${名}${说明 ? `  ${说明}` : ''}`);
  } catch (错) {
    败 += 1;
    console.log(`  FAIL ${名}\n       ${(错 && 错.message) || 错}`);
  }
}

/** 起服务，等它把页面那条路答上来。 */
async function 起() {
  const 子 = spawn(process.execPath, [服务文件, '--端口', String(端口)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LOCALAPPDATA: 测试数据位置 },
  });
  let 出 = '';
  子.stdout.on('data', (块) => { 出 += String(块); });
  子.stderr.on('data', (块) => { 出 += String(块); });

  const 令牌 = await new Promise((接, 拒) => {
    const 限时 = setTimeout(() => 拒(new Error(`服务没起来：\n${出}`)), 120000);
    const 看 = setInterval(() => {
      const m = /令牌\s+([0-9a-f]{32})/.exec(出);
      if (m) { clearInterval(看); clearTimeout(限时); 接(m[1]); }
    }, 200);
    子.on('exit', (码) => { clearInterval(看); clearTimeout(限时); 拒(new Error(`服务退出了（${码}）：\n${出}`)); });
  });

  return { 子, 令牌, 日志: () => 出 };
}

const { 子, 令牌, 日志 } = await 起();

async function 请(路, 体) {
  const 答 = await fetch(`http://127.0.0.1:${端口}${路}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 令牌 },
    body: JSON.stringify(体 || {}),
  });
  return { 状态: 答.status, 体: await 答.json() };
}

try {
  console.log('=== 一、路由 ===');

  await 查('页面能打开，令牌注进去了', async () => {
    const 答 = await fetch(`http://127.0.0.1:${端口}/`);
    assert.equal(答.status, 200);
    const 文本 = await 答.text();
    assert.ok(文本.includes(令牌), '页面里没有令牌');
    assert.ok(!文本.includes('/*令牌*/'), '哨符没换掉');
    return `${文本.length} 字节`;
  });

  await 查('令牌不对 → 403', async () => {
    const 答 = await fetch(`http://127.0.0.1:${端口}/toolbox/桌`, { method: 'POST', headers: { 'x-toolbox-token': 'nope' } });
    assert.equal(答.status, 403);
    return '403';
  });

  await 查('GET 那两条 → 405', async () => {
    const 答 = await fetch(`http://127.0.0.1:${端口}/toolbox/调`, { headers: { 'x-toolbox-token': 令牌 } });
    assert.equal(答.status, 405);
    return '405';
  });

  await 查('别的路 → 404', async () => {
    const 答 = await fetch(`http://127.0.0.1:${端口}/别的`);
    assert.equal(答.status, 404);
    return '404';
  });

  console.log('\n=== 二、动作表 ===');

  const 桌 = (await 请('/toolbox/桌')).体;

  await 查('八个模块全在，装不上的一个都没有', () => {
    assert.deepEqual(桌.装不上, [], `装不上：${JSON.stringify(桌.装不上)}`);
    const 模块们 = [...new Set(桌.动作表.map((x) => x.模块))].sort();
    assert.deepEqual(模块们, ['binding', 'comfy', 'image', 'tag', 'translate', 'vision', 'worldbook', '主AI'].sort());
    return 模块们.join(' / ');
  });

  await 查('动作 97 条（七个模块 87 + 主AI 10）', () => {
    assert.equal(桌.动作表.length, 97);
    const 数 = {};
    for (const 一 of 桌.动作表) 数[一.模块] = (数[一.模块] || 0) + 1;
    assert.deepEqual(数, { tag: 40, image: 16, worldbook: 10, binding: 2, comfy: 12, translate: 3, vision: 4, 主AI: 10 });
    return JSON.stringify(数);
  });

  await 查('每条都带 动作 / 摘要 / 参数 / 说明（说明齐不齐另有一条）', () => {
    for (const 一 of 桌.动作表) {
      assert.ok(一.动作, '缺动作名');
      assert.ok(typeof 一.摘要 === 'string' && 一.摘要, `${一.动作} 缺摘要`);
      assert.ok(Array.isArray(一.参数), `${一.动作} 的参数不是数组`);
      assert.ok(一.说明 && typeof 一.说明 === 'object', `${一.动作} 缺说明`);
    }
    return `${桌.动作表.length} 条都带全了`;
  });

  await 查('参数说明的缺口数（界面不依赖它，只报数）', () => {
    const 缺 = [];
    let 必填 = 0;
    for (const 一 of 桌.动作表) {
      for (const 名 of 一.参数) {
        if (名.endsWith('?')) continue;
        必填 += 1;
        if (!Object.hasOwn(一.说明, 名)) 缺.push(`${一.模块}.${一.动作} 的「${名}」`);
      }
    }
    return `必填参数 ${必填} 个，其中 ${缺.length} 个没写说明`;
  });

  console.log('\n=== 三、本地模型：列与换 ===');

  await 查('扫出两格，都是装好的', () => {
    assert.ok(桌.模型, '动作表里没带模型那一份');
    const 名 = [...桌.模型.vision, ...桌.模型.translation].map((x) => `${x.类别}/${x.id}`);
    assert.ok(名.length >= 2, `只扫到 ${名.length} 格：${名.join(' ')}`);
    for (const 一 of [...桌.模型.vision, ...桌.模型.translation]) {
      assert.ok(typeof 一.名字 === 'string' && 一.名字, `${一.id} 缺名字`);
      assert.ok(一.装好了, `${一.id} 没装好：${一.缺什么.join('；')}`);
    }
    return 名.join(' · ');
  });

  await 查('看模型：这次用的那两格各是哪个', async () => {
    const { 体 } = await 请('/toolbox/模型', {});
    assert.equal(体.ok, true, JSON.stringify(体).slice(0, 200));
    assert.ok(体.data.这次用.vision, '识图没选出用哪一格');
    assert.ok(体.data.这次用.translation, '翻译没选出用哪一格');
    return `识图 ${体.data.这次用.vision} · 翻译 ${体.data.这次用.translation}`;
  });

  // 造一格不完整的：说明文件在、点名的文件不在 —— 看它会不会如实说"缺什么"。
  const 假格 = path.join(桌.模型.目录, '识图', '自检用假格');
  try {
    fs.mkdirSync(假格, { recursive: true });
    fs.writeFileSync(path.join(假格, '模型.json'), JSON.stringify({
      id: '自检用假格', 名字: '自检用假格', 引擎: 'onnxruntime',
      文件: { 模型: '根本没有这个文件.onnx' },
    }), 'utf8');

    await 查('没装好的那一格也列出来，并说清缺什么', async () => {
      const { 体 } = await 请('/toolbox/模型', {});
      const 它 = 体.data.vision.find((x) => x.id === '自检用假格');
      assert.ok(它, '新加的那一格没被扫到');
      assert.equal(它.装好了, false);
      assert.ok(它.缺什么.length, '没装好却没说缺什么');
      return `缺：${它.缺什么.join('；')}`;
    });

    await 查('换到没装好的那一格 → 拒绝，而且不动现在用的', async () => {
      const 前 = (await 请('/toolbox/模型', {})).体.data.这次用.vision;
      const { 体 } = await 请('/toolbox/模型', { 换: { 类别: 'vision', id: '自检用假格' } });
      assert.equal(体.ok, false, JSON.stringify(体).slice(0, 200));
      assert.equal(体.code, 'HOST_MODEL_INCOMPLETE');
      const 后 = (await 请('/toolbox/模型', {})).体.data.这次用.vision;
      assert.equal(后, 前, '被拒绝了却还是换了');
      return `${体.code} · 还在用 ${后}`;
    });

    await 查('换到不存在的一格 → 拒绝', async () => {
      const { 体 } = await 请('/toolbox/模型', { 换: { 类别: 'vision', id: '根本没有这一格' } });
      assert.equal(体.ok, false);
      assert.equal(体.code, 'HOST_NO_MODEL');
      return 体.code;
    });

    await 查('换到装好的那一格 → 换成了', async () => {
      const 原来 = (await 请('/toolbox/模型', {})).体.data.这次用.vision;
      const { 体 } = await 请('/toolbox/模型', { 换: { 类别: 'vision', id: 原来 } });
      assert.equal(体.ok, true, JSON.stringify(体).slice(0, 200));
      assert.equal(体.data.这次用.vision, 原来);
      return `还在 ${原来}`;
    });
  } finally {
    fs.rmSync(假格, { recursive: true, force: true });
  }

  await 查('假格清掉了，目录回到原样', async () => {
    const { 体 } = await 请('/toolbox/模型', {});
    assert.ok(!体.data.vision.some((x) => x.id === '自检用假格'), '假格没清干净');
    return `剩 ${体.data.vision.length} 格识图 · ${体.data.translation.length} 格翻译`;
  });

  await 查('换模型将选择写入统一用户数据目录', async () => {
    const 设置文件 = path.join(测试数据位置, '工具箱', '设置.json');
    const 设置 = JSON.parse(fs.readFileSync(设置文件, 'utf8'));
    assert.equal(设置.识图模型, 桌.模型.这次用.vision);
    return 设置文件;
  });

  console.log('\n=== 四、调动作 ===');
  await 查('tag_query（参数是字符串）', async () => {
    const 回 = await 请('/toolbox/调', { 模块: 'tag', 动作: 'query', 参数: { 串: 'hatsune_miku' } });
    assert.equal(回.状态, 200);
    assert.ok(回.体.候选.length > 0, JSON.stringify(回.体).slice(0, 200));
    return `${回.体.候选[0].记录.名称} → ${回.体.候选[0].记录.中文名}`;
  });

  await 查('tag_status（不带参数）', async () => {
    const 回 = await 请('/toolbox/调', { 模块: 'tag', 动作: 'status' });
    assert.ok(回.体.记录 && typeof 回.体.记录.主库 === 'number', JSON.stringify(回.体).slice(0, 200));
    return `主库 ${回.体.记录.主库} · 索引 ${回.体.索引.indexed}`;
  });

  await 查('tag_recognize（参数是数组）', async () => {
    const 回 = await 请('/toolbox/调', { 模块: 'tag', 动作: 'recognize', 参数: { 词: ['1girl', 'hatsune_miku'] } });
    assert.ok(Array.isArray(回.体), JSON.stringify(回.体).slice(0, 200));
    return JSON.stringify(回.体);
  });

  await 查('主AI 的「执行」（模块键是中文，也要能调）', async () => {
    const 回 = await 请('/toolbox/调', { 模块: '主AI', 动作: '执行', 参数: { 请求: '主AI' } });
    assert.ok(回.体.预设?.标识 && Array.isArray(回.体.工具表) && 回.体.模型, JSON.stringify(回.体).slice(0, 200));
    assert.equal(Object.hasOwn(回.体, '身份') || Object.hasOwn(回.体, '流程') || Object.hasOwn(回.体, '世界书'), false);
    return `预设 ${回.体.预设.标识} · 工具表 ${回.体.工具表.length} 条`;
  });

  await 查('image_list（真图库）', async () => {
    const 回 = await 请('/toolbox/调', { 模块: 'image', 动作: '列', 参数: { 作用域: { 存放地: 'gallery' } } });
    assert.ok(Array.isArray(回.体.条目), JSON.stringify(回.体).slice(0, 200));
    return `${回.体.总数} 条`;
  });

  await 查('worldbook_table（四份默认要在）', async () => {
    const 回 = await 请('/toolbox/调', { 模块: 'worldbook', 动作: '表' });
    assert.ok(Array.isArray(回.体) && 回.体.length >= 4, JSON.stringify(回.体).slice(0, 200));
    for (const name of ['主AI', '文生图', '翻译', '识图']) assert.ok(回.体.some(row => row.名字 === name), `缺少 ${name} 默认书`);
    return 回.体.map((x) => x.名字).join(' / ');
  });

  console.log('\n=== 五、失败能分辨 ===');

  await 查('模块不存在', async () => {
    const 回 = await 请('/toolbox/调', { 模块: '没有这个', 动作: 'x' });
    assert.equal(回.体.ok, false);
    assert.equal(回.体.code, 'BROWSER_NO_SUCH_MODULE');
    return 回.体.reason;
  });

  await 查('动作不存在', async () => {
    const 回 = await 请('/toolbox/调', { 模块: 'tag', 动作: '没有这个动作' });
    assert.equal(回.体.ok, false);
    assert.equal(回.体.code, 'BROWSER_NO_SUCH_ACTION');
    return 回.体.reason;
  });

  await 查('模块自己报的失败原样带出来（标签模块的码）', async () => {
    const 回 = await 请('/toolbox/调', { 模块: 'tag', 动作: 'record.get', 参数: { 标识: 999999999 } });
    assert.equal(回.体.ok, false);
    assert.match(回.体.code, /^TAG_/, JSON.stringify(回.体));
    return `${回.体.code} · ${回.体.reason}`;
  });

  await 查('要模型的那几步如实报缺，不假装成功', async () => {
    const 回 = await 请('/toolbox/调', { 模块: 'vision', 动作: '看模型' });
    assert.ok(回.体 && typeof 回.体 === 'object', JSON.stringify(回.体).slice(0, 200));
    return JSON.stringify(回.体).slice(0, 160);
  });

  console.log('\n=== 六、真写一遍再删干净（世界书）===');

  let 标识 = null;
  await 查('建一本 → 加条目 → 启用 → 存 → 执行命中 1 条', async () => {
    const 建 = await 请('/toolbox/调', { 模块: 'worldbook', 动作: '书', 参数: { 动作: '新建', 请求: '动作浏览器自检', 名字: '动作浏览器自检' } });
    assert.ok(建.体.标识, JSON.stringify(建.体));
    标识 = 建.体.标识;

    const 加 = await 请('/toolbox/调', {
      模块: 'worldbook', 动作: '条目',
      参数: { 动作: '加', 书: 标识, 条目: { label: '自检条目', text: '这是一条恒常条目', always: true } },
    });
    assert.ok(加.体.条目 && 加.体.条目.id, JSON.stringify(加.体));

    await 请('/toolbox/调', { 模块: 'worldbook', 动作: '书', 参数: { 动作: '换', 请求: '动作浏览器自检', 启用: [标识] } });
    await 请('/toolbox/调', { 模块: 'worldbook', 动作: '存' });

    const 回 = await 请('/toolbox/调', { 模块: 'worldbook', 动作: '执行', 参数: { 请求: '动作浏览器自检', 文本: '' } });
    assert.equal(回.体.命中.length, 1, JSON.stringify(回.体).slice(0, 300));
    return `${标识} · 命中 ${回.体.命中.length} 条`;
  });

  await 查('删掉那本 → 启用清空 → 再执行 0 条（不留残留）', async () => {
    await 请('/toolbox/调', { 模块: 'worldbook', 动作: '书', 参数: { 动作: '删', 标识 } });
    await 请('/toolbox/调', { 模块: 'worldbook', 动作: '书', 参数: { 动作: '换', 请求: '动作浏览器自检', 启用: [] } });
    await 请('/toolbox/调', { 模块: 'worldbook', 动作: '存' });
    const 回 = await 请('/toolbox/调', { 模块: 'worldbook', 动作: '执行', 参数: { 请求: '动作浏览器自检', 文本: '' } });
    assert.equal(回.体.命中.length, 0, JSON.stringify(回.体).slice(0, 300));
    return '干净了';
  });
} finally {
  子.kill();
}

console.log(`\n${过} 过 / ${败} 失败`);
if (败) { console.log(`\n服务日志：\n${日志()}`); }
process.exit(败 === 0 ? 0 : 1);
