// 动作浏览器 · 页面自检。拿 jsdom 造一个 DOM，把页.js 原样跑起来。
//
//   node 对接层/tools/动作浏览器/test/页面.js
//
// 走的是**真服务**：起一样的宿主，页面发真请求，验的是渲染出来的 DOM。
// jsdom 不是本仓库的依赖（本仓库的运行时零依赖）。要跑这一份，用环境变量指一个装得到它的地方：
//
//   JSDOM_DIR=<某个 node_modules 的上一层>  node 对接层/tools/动作浏览器/test/页面.js
//
// 指不到就打印一句"跳过"并零退出。
//
// 覆盖：起页面 → 列动作 → 搜 → 选动作 → 填参数 → 执行 → 回执画出来 → 失败画出来。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const 本目录 = path.dirname(fileURLToPath(import.meta.url));
const 动作浏览器目录 = path.resolve(本目录, '..');
const 服务文件 = path.join(动作浏览器目录, '服务.js');
const 端口 = 8794;

/** 取 jsdom：先看 JSDOM_DIR，再看本目录一路往上的 node_modules。 */
function 找jsdom() {
  const 层们 = [];
  if (process.env.JSDOM_DIR) 层们.push(path.resolve(process.env.JSDOM_DIR));
  for (let 层 = 本目录, 上 = 0; 上 < 8; 上 += 1, 层 = path.dirname(层)) {
    层们.push(层);
    if (path.dirname(层) === 层) break;
  }
  for (const 层 of 层们) {
    try {
      return createRequire(path.join(层, 'noop.js'))('jsdom');
    } catch (_) { /* 这层取不到，换下一层 */ }
  }
  return null;
}

const jsdom = 找jsdom();
if (!jsdom) {
  console.log('跳过：没找到 jsdom。要跑这一份就设 JSDOM_DIR 指到装了它的那一层。');
  process.exit(0);
}
const { JSDOM } = jsdom;

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
    if (错 && 错.stack) console.log(`       ${错.stack.split('\n').slice(1, 5).join('\n       ')}`);
  }
}

/** 等一个条件成立，最多等 毫秒 毫秒。 */
async function 等(条件, 毫秒 = 8000) {
  const 到 = Date.now() + 毫秒;
  for (;;) {
    const 成 = 条件();
    if (成) return 成;
    if (Date.now() > 到) throw new Error('等超时了');
    await new Promise((接) => setTimeout(接, 25));
  }
}

// ---------- 起服务 ----------
const 子 = spawn(process.execPath, [服务文件, '--端口', String(端口)], { stdio: ['ignore', 'pipe', 'pipe'] });
let 日志 = '';
子.stdout.on('data', (块) => { 日志 += String(块); });
子.stderr.on('data', (块) => { 日志 += String(块); });

const 令牌 = await new Promise((接, 拒) => {
  const 限时 = setTimeout(() => 拒(new Error(`服务没起来：\n${日志}`)), 120000);
  const 看 = setInterval(() => {
    const m = /令牌\s+([0-9a-f]{32})/.exec(日志);
    if (m) { clearInterval(看); clearTimeout(限时); 接(m[1]); }
  }, 200);
  子.on('exit', (码) => { clearInterval(看); clearTimeout(限时); 拒(new Error(`服务退出了（${码}）：\n${日志}`)); });
});

try {
  // ---------- 把页面装进 jsdom ----------
  const 页文本 = await (await fetch(`http://127.0.0.1:${端口}/`)).text();
  const 页代码 = fs.readFileSync(path.join(动作浏览器目录, '页', '页.js'), 'utf8');

  const dom = new JSDOM(页文本, {
    url: `http://127.0.0.1:${端口}/`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // 页面在浏览器里有、jsdom 没有的几样：fetch、剪贴板、以及内联脚本的结果。
  // jsdom 的 outside-only 模式不跑内联脚本，所以页面上那个 __令牌__ 得我们自己摆进去。
  const 摆桩 = (窗) => {
    窗.fetch = (路, 选) => fetch(new URL(路, `http://127.0.0.1:${端口}`), 选);
    窗.navigator.clipboard = { writeText: async () => {} };
    窗.URL.createObjectURL = () => 'blob:假地址';
    const 找 = /window\.__令牌__\s*=\s*"([0-9a-f]{32})"/.exec(页文本);
    if (!找) throw new Error(`页面里没找到注入的令牌：${JSON.stringify(页文本.slice(0, 200))}`);
    窗.__令牌__ = 找[1];
  };

  摆桩(window);

  // 页面的启动是 async 的，出错会变成一个没人接的 Promise —— 记下来，别让它静默。
  const 页面错 = [];
  window.addEventListener('unhandledrejection', (e) => 页面错.push(e.reason));
  window.addEventListener('error', (e) => 页面错.push(e.error || e.message));

  window.eval(页代码);
  await new Promise((接) => setTimeout(接, 300));
  if (页面错.length) throw new Error(`页面起不来：${页面错.map((x) => (x && x.stack) || x).join('\n')}`);

  const 文档 = window.document;
  const 列 = 文档.getElementById('列');
  const 详 = 文档.getElementById('详');
  const 搜 = 文档.getElementById('搜');

  const 条们 = () => [...列.querySelectorAll('.条')];
  const 找条 = (模块, 动作) => 条们().find((x) => x.dataset.模块 === 模块 && x.dataset.动作 === 动作);
  const 点 = (元素) => 元素.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  /** 直接打宿主那两条路（不经过页面），用来给页面自检备料。 */
  const 调页 = async (体) => {
    const 答 = await fetch(`http://127.0.0.1:${端口}/toolbox/调`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 令牌 },
      body: JSON.stringify(体),
    });
    return 答.json();
  };

  /** 造一张真的 1×1 PNG（带 zlib 压过的 IDAT），给"取内容"那条用。 */
  function 造PNG() {
    const 块 = (类型, 数据) => {
      const 长 = Buffer.alloc(4);
      长.writeUInt32BE(数据.length);
      const 体 = Buffer.concat([Buffer.from(类型, 'latin1'), 数据]);
      const 和 = Buffer.alloc(4);
      和.writeUInt32BE(zlib.crc32(体));
      return Buffer.concat([长, 体, 和]);
    };
    const 头 = Buffer.alloc(13);
    头.writeUInt32BE(1, 0);   // 宽
    头.writeUInt32BE(1, 4);   // 高
    头[8] = 8;                // 位深
    头[9] = 2;                // 真彩
    // 一行：过滤字节 + 一个 RGB
    const 像素 = zlib.deflateSync(Buffer.from([0, 200, 80, 60]));
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      块('IHDR', 头),
      块('IDAT', 像素),
      块('IEND', Buffer.alloc(0)),
    ]);
  }

  /** 存一张真 PNG 进图库，交出它的引用。 */
  async function 摆一张图() {
    const 回 = await 调页({
      模块: 'image', 动作: '存',
      参数: {
        作用域: { 存放地: 'gallery' },
        字节: `data:image/png;base64,${造PNG().toString('base64')}`,
        文件名: '自检用.png',
      },
    });
    if (!回 || !回.引用) throw new Error(`摆图失败：${JSON.stringify(回).slice(0, 200)}`);
    return 回.引用;
  }

  /**
   * 点执行，等这一次跑完。
   * 认的是"详里出现了一个活着的回执块"——不认按钮状态，也不认耗时那行（那是定时器刷的）。
   */
  async function 跑一次() {
    const 到 = new Promise((接) => {
      const 看 = new window.MutationObserver(() => {
        const 盒 = 详.querySelector('.回执');
        if (盒 && 盒.isConnected) { 看.disconnect(); 接(盒); }
      });
      看.observe(详, { childList: true, subtree: true });
      setTimeout(() => { 看.disconnect(); 接(null); }, 30000);
    });
    点(详.querySelector('.行 button'));
    const 盒 = await 到;
    if (!盒) throw new Error(`30 秒没等到回执（详孩子 ${[...详.children].map((x) => x.tagName).join('|')}）`);
    return 盒;
  }

  console.log('=== 一、起页面 ===');

  await 查('动作列出来了，按模块分组', async () => {
    await 等(() => 条们().length > 0);
    assert.equal(条们().length, 84, `列出来 ${条们().length} 条`);
    const 组们 = [...列.querySelectorAll('.组')].map((x) => x.firstChild.textContent);
    assert.equal(组们.length, 8, `分组 ${组们.length} 个`);
    return `${条们().length} 条 · ${组们.join(' / ')}`;
  });

  await 查('右边先写着"挑一个动作"', () => {
    assert.match(详.textContent, /挑一个动作/);
    return 详.textContent.slice(0, 24);
  });

  console.log('\n=== 二、模型条 ===');

  const 模型条 = 文档.getElementById('模型条');
  const 下拉们 = () => [...模型条.querySelectorAll('select')];

  await 查('两格下拉都在，选项里写着名字与 id', () => {
    assert.ok(模型条, '页面里没有模型条');
    const 选 = 下拉们();
    assert.equal(选.length, 2, `下拉 ${选.length} 个`);
    const 项 = [...选[0].options].map((o) => o.textContent).filter((x) => x.includes('（'));
    assert.ok(项.length, '识图那一格没列出模型');
    assert.match(项.join(' '), /（wd-eva02）/);
    return 项.join(' / ');
  });

  await 查('"这次用哪个"标在选中的那一项上，状态写着在用谁', () => {
    const 选 = 下拉们()[0];
    const 在用 = 选.value;
    assert.ok(在用, '没有选中任何一格');
    assert.ok(模型条.textContent.includes(`在用 ${在用}`), 模型条.textContent.slice(0, 120));
    return `识图在用 ${在用}`;
  });

  await 查('换到不存在的一格 → 拒了，状态那格显示原因，没换成', async () => {
    const 选 = 下拉们()[0];
    const 原来 = 选.value;
    // 直接塞一个不存在的值再触发 change（模拟"选了个已经删掉的格"）
    const 野 = 文档.createElement('option');
    野.value = '根本没有这一格';
    野.textContent = '根本没有这一格';
    选.append(野);
    选.value = '根本没有这一格';
    选.dispatchEvent(new window.Event('change', { bubbles: true }));
    await 等(() => /BROWSER_NO_MODEL|没有/.test(模型条.textContent));
    return 模型条.textContent.match(/没有[^在]*/)?.[0]?.slice(0, 40) || '拒了';
  });

  await 查('拒绝之后页面还能用（没被弄死）', async () => {
    const 答 = await fetch(`http://127.0.0.1:${端口}/toolbox/桌`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 令牌 },
      body: '{}',
    });
    const 体 = await 答.json();
    assert.ok(体.动作表.length, '动作表拿不到了');
    return `动作表还在，${体.动作表.length} 条`;
  });

  console.log('\n=== 三、搜 ===');

  await 查('搜"记录"能筛出来（动作名与摘要都算），条数变少', () => {
    const 全部 = 条们().length;
    搜.value = '记录';
    搜.dispatchEvent(new window.Event('input', { bubbles: true }));
    const 命中 = 条们();
    assert.ok(命中.length > 0, '一条都没筛出来');
    assert.ok(命中.length < 全部, `没筛掉任何东西（${命中.length}）`);
    assert.ok(找条('tag', 'record.get'), 'record.get 该被筛出来');
    return `${全部} → ${命中.length} 条`;
  });

  await 查('搜参数名/说明也能命中（搜"位置"）', () => {
    搜.value = '位置';
    搜.dispatchEvent(new window.Event('input', { bubbles: true }));
    const 命中 = 条们();
    assert.ok(命中.length >= 5, `只命中 ${命中.length} 条`);
    assert.ok(找条('tag', 'position.list'), 'position.list 该被筛出来');
    return `${命中.length} 条`;
  });

  await 查('清空搜索回到 84 条', () => {
    搜.value = '';
    搜.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(条们().length, 84);
    return '84 条';
  });

  console.log('\n=== 四、选动作 → 画参数 ===');

  await 查('选 tag.record.get：标题、参数框、可选标记都对', async () => {
    点(找条('tag', 'record.get'));
    await 等(() => 详.querySelector('h2'));
    assert.equal(详.querySelector('h2').textContent, 'record.get');
    assert.equal(详.querySelector('.模块名').textContent, 'tag');
    const 标们 = [...详.querySelectorAll('.参 > label')];
    assert.equal(标们.length, 1);
    assert.equal(标们[0].firstChild.textContent, '标识');
    assert.equal(详.querySelectorAll('.参 textarea').length, 1);
    assert.equal(详.querySelector('button').textContent, '执行');
    return 详.querySelector('.摘要').textContent;
  });

  await 查('选 tag.query：可选参数带"留空就不传"，说明原样显示', async () => {
    点(找条('tag', 'query'));
    await 等(() => 详.querySelector('h2').textContent === 'query');
    const 标们 = [...详.querySelectorAll('.参 > label')];
    assert.equal(标们.length, 2);
    assert.equal(标们[0].firstChild.textContent, '串');
    assert.equal(标们[0].querySelector('.可选'), null, '「串」不该标可选');
    assert.equal(标们[1].firstChild.textContent, '上限');
    assert.ok(标们[1].querySelector('.可选'), '「上限」该标可选');
    assert.match(详.textContent, /最多给几条/);
    return 标们.map((x) => x.firstChild.textContent).join(' / ');
  });

  await 查('选一个不收参数的动作：写"不收参数"', async () => {
    点(找条('tag', 'status'));
    await 等(() => 详.querySelector('h2').textContent === 'status');
    assert.match(详.textContent, /不收参数/);
    assert.equal(详.querySelectorAll('.参 textarea').length, 0);
    return '对';
  });

  console.log('\n=== 五、执行 → 画回执 ===');

  await 查('tag.query 真执行：回执画出来，成功两个字是绿的', async () => {
    点(找条('tag', 'query'));
    await 等(() => 详.querySelector('h2').textContent === 'query');
    详.querySelectorAll('.参 textarea')[0].value = 'hatsune_miku';
    await 跑一次();

    const 判 = 详.querySelector('.回执 .判');
    assert.equal(判.textContent, '成功');
    assert.ok(判.className.includes('好'));

    const 文 = 详.querySelector('.回执 pre').textContent;
    const 值 = JSON.parse(文);
    assert.ok(值.候选.length > 0, 文.slice(0, 200));
    assert.ok(文.includes('初音未来'), '回执该带中文名');
    return `${值.候选.length} 个候选 · 第一个 ${值.候选[0].记录.名称} · ${详.querySelector('.耗时').textContent}`;
  });

  await 查('参数写数组（JSON）：tag.recognize 走通', async () => {
    点(找条('tag', 'recognize'));
    await 等(() => 详.querySelector('h2').textContent === 'recognize');
    详.querySelectorAll('.参 textarea')[0].value = '["1girl","hatsune_miku"]';
    await 跑一次();
    const 值 = JSON.parse(详.querySelector('.回执 pre').textContent);
    assert.deepEqual(值, ['1个女孩', '初音未来']);
    return JSON.stringify(值);
  });

  await 查('参数写对象（JSON）：image.列 走通，真图库', async () => {
    点(找条('image', '列'));
    await 等(() => 详.querySelector('h2').textContent === '列');
    详.querySelectorAll('.参 textarea')[0].value = '{"存放地":"gallery"}';
    await 跑一次();
    const 值 = JSON.parse(详.querySelector('.回执 pre').textContent);
    assert.ok(Array.isArray(值.条目), JSON.stringify(值).slice(0, 200));
    return `图库 ${值.总数} 条`;
  });

  await 查('拿真图的字节：画成 <img>，原始字节从 JSON 里摘掉', async () => {
    // 自己造一张真 PNG 存进去再取回来 —— 不依赖图库里本来有什么。
    const 引用 = await 摆一张图();
    try {
      点(找条('image', '取内容'));
      await 等(() => 详.querySelector('h2').textContent === '取内容');
      const 框们 = 详.querySelectorAll('.参 textarea');
      框们[0].value = JSON.stringify(引用);
      框们[1].value = 'original';
      await 跑一次();

      const 图 = 详.querySelector('.预览 img');
      assert.ok(图, '没画出预览图');
      assert.ok(decodeURIComponent(图.src).startsWith('blob:'), `src 不是 blob：${图.src}`);

      const 文 = 详.querySelector('.回执 pre').textContent;
      assert.match(文, /<原始字节：\d+ 字节>/, '原始字节该被换成一句人话');
      assert.ok(!/137,80,78,71/.test(文), 'PNG 魔数不该出现在 JSON 里');
      return `${(文.match(/<原始字节：(\d+) 字节>/) || [])[1]} 字节画成了图`;
    } finally {
      await 调页({ 模块: 'image', 动作: '删', 参数: { 引用 } });
    }
  });

  await 查('可选参数留空就不传（模块自己用默认值）', async () => {
    点(找条('tag', 'query'));
    await 等(() => 详.querySelector('h2').textContent === 'query');
    const 框们 = 详.querySelectorAll('.参 textarea');
    框们[0].value = 'miku';
    框们[1].value = '';
    await 跑一次();
    const 值 = JSON.parse(详.querySelector('.回执 pre').textContent);
    assert.ok(值.候选.length > 0);
    return `候选 ${值.候选.length} 个（上限没传）`;
  });

  console.log('\n=== 六、失败也要画得像样 ===');

  await 查('模块自己报的失败：判成"失败"，码和人话都在', async () => {
    点(找条('tag', 'record.get'));
    await 等(() => 详.querySelector('h2').textContent === 'record.get');
    详.querySelectorAll('.参 textarea')[0].value = '999999999';
    await 跑一次();

    const 判 = 详.querySelector('.回执 .判');
    assert.equal(判.textContent, '失败');
    assert.ok(判.className.includes('坏'));
    assert.equal(详.querySelector('.失败块 .码').textContent, '码：TAG_RECORD_MISSING');
    assert.equal(详.querySelector('.失败块 .人话').textContent, '记录不存在');
    return 'TAG_RECORD_MISSING · 记录不存在';
  });

  await 查('必填参数留空：如实交给模块，模块自己拒绝', async () => {
    点(找条('tag', 'record.get'));
    await 等(() => 详.querySelector('h2').textContent === 'record.get');
    详.querySelectorAll('.参 textarea')[0].value = '';
    await 跑一次();
    const 判 = 详.querySelector('.回执 .判');
    assert.equal(判.textContent, '失败');
    assert.equal(详.querySelector('.失败块 .码').textContent, '码：TAG_RECORD_MISSING');
    return 详.querySelector('.失败块 .人话').textContent;
  });

  console.log('\n=== 七、刷新回到原来那个动作 ===');

  await 查('hash 记着选的是谁，重开页面能回到它', async () => {
    点(找条('comfy', '探活'));
    await 等(() => window.location.hash.includes('comfy'));
    assert.equal(decodeURIComponent(window.location.hash), '#comfy/探活');

    const dom2 = new JSDOM(页文本, { url: `http://127.0.0.1:${端口}/${window.location.hash}`, runScripts: 'outside-only' });
    摆桩(dom2.window);
    dom2.window.eval(页代码);
    await 等(() => dom2.window.document.querySelector('#详 h2'));
    const 名 = dom2.window.document.querySelector('#详 h2').textContent;
    assert.equal(名, '探活');
    dom2.window.close();
    return '回到 comfy.探活';
  });
} finally {
  子.kill();
}

console.log(`\n${过} 过 / ${败} 失败`);
if (败) console.log(`\n服务日志：\n${日志}`);
process.exit(败 === 0 ? 0 : 1);
