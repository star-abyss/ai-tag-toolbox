// 对话桥的真机实测：起一个**真的 DSH 进程**（临时 profile，装的是本仓库的对接层），
// 从桥那一侧发一句话，看它回不回话。
//
// 用法：node tools/对话桥真机.mjs [--端口 8893] [--留]
//
// 它验的是"整条路通不通"：插件装上了 → 桥起来了 → 发现文件写出来了 → 发一句话 →
// **真 DSH 的 Agent 真跑一轮**（真调模型）→ 桥交回来的会话里有回复，而且里面看得见
// 主 AI 的工具（那一轮模型自己会调 `image_list` 看一眼图库）。
//
// ⚠️ 它不碰任何既有 profile：DSH 家里现造一份临时 profile，跑完连它一起删。
//    要密钥：`DEEPSEEK_API_KEY` 放进环境（这一趟会真调模型）。
//    `--留` 表示跑完不删那份临时 profile，留着复看。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const 本目录 = path.dirname(fileURLToPath(import.meta.url));
const 项目根 = path.resolve(本目录, '..', '..');
/**
 * 这一轮临时 profile 的名字，与 DSH 的家。
 *
 * ⚠️ 临时 profile 住**真正的 DSH 家里**（`~/.dsh/profiles/`），不使用 `DSH_HOME`：
 * 换了家就读不到那一份凭据文件，模型那一轮会以 `MISSING_CREDENTIAL` 收场。
 * 名字带前缀，跑完删掉，与既有的 profile 互不相干。
 */
const 家 = process.env.桥实测家 || path.join(os.homedir(), '.dsh');
const profile = '工具箱桥实测';
/** 发现文件：由插件写在临时家里，父进程读它。 */
const 存档 = path.join(家, 'profiles', profile, '对话桥.json');

let 过了 = 0;
const 崩了 = [];
function 判(话, 条件, 说明 = '') {
  if (条件) { 过了 += 1; console.log(`  ✓ ${话}${说明 ? `（${说明}）` : ''}`); return true; }
  崩了.push(话 + (说明 ? `（${说明}）` : ''));
  console.log(`  ✗ ${话}${说明 ? `（${说明}）` : ''}`);
  return false;
}

const 歇 = (毫秒) => new Promise((成) => setTimeout(成, 毫秒));

/** DSH 的入口：npx 缓存里那一份 `@deepseek-ai/dsh`；也可用 `DSH_BIN` 指。 */
function 找DSH() {
  if (process.env.DSH_BIN) return process.env.DSH_BIN;
  const 候选根 = [
    path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'),
    path.join(os.homedir(), '.npm', '_npx'),
  ];
  for (const 根 of 候选根) {
    if (!fs.existsSync(根)) continue;
    for (const 一 of fs.readdirSync(根)) {
      const 候选 = path.join(根, 一, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
      if (fs.existsSync(候选)) return 候选;
    }
  }
  return null;
}

/** DSH 的包目录（临时 profile 要按绝对路径引用它那两个包）。 */
function 找DSH包(入口) {
  return path.resolve(path.dirname(入口), '..');
}

async function 请(基, 令牌, 路, { 方法 = 'POST', 体, 查 } = {}) {
  const 参 = 查 ? `?${new URLSearchParams(查)}` : '';
  const 回 = await fetch(`${基}${路}${参}`, {
    method: 方法,
    headers: { 'x-toolbox-token': 令牌, ...(体 ? { 'Content-Type': 'application/json' } : {}) },
    ...(体 ? { body: JSON.stringify(体) } : {}),
  });
  return 回.json();
}

async function 等到(做什么, 毫秒 = 60000) {
  const 止 = Date.now() + 毫秒;
  while (Date.now() < 止) {
    try { const 出 = await 做什么(); if (出) return 出; } catch (_) { /* 还没好 */ }
    await 歇(500);
  }
  return null;
}

/**
 * 密钥：先看环境变量，再读 DSH 自己的凭据文件。
 *
 * 这一趟是"真调模型"，所以要一把能用的 key。写在这里是为了**不把密钥打进命令行**
 * ——命令行会进历史、进日志；从凭据文件里现读，密钥不出现在任何一条命令里。
 * 两条路都没有就当没配，如实说一句然后退出。
 *
 * @returns {string} 密钥原文；没有给空串
 */
function 找密钥() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  for (const 候选 of [
    path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), '.credentials.yaml'),
    path.join(os.homedir(), '.dsh', '.credentials.yaml'),
  ]) {
    try {
      const 原 = fs.readFileSync(候选, 'utf8');
      // 只认"DEEPSEEK_API_KEY 那一条的 secret"，不做通用 YAML 解析。
      const 段 = 原.split(/\n(?=\s*-\s)/).find((一) => 一.includes('DEEPSEEK_API_KEY'));
      const 取 = 段 && 段.match(/secret:\s*(\S+)/);
      if (取) return 取[1].replace(/^["']|["']$/g, '');
    } catch (_) { /* 换下一个候选 */ }
  }
  return '';
}

/** 造那份临时 profile：装本仓库的对接层，模型走本机凭据。 */
function 造Profile(端口, DSH包) {
  const 目录 = path.join(家, 'profiles', profile);
  try { fs.rmSync(目录, { recursive: true, force: true }); } catch (_) { /* 上一轮的没删掉 */ }
  fs.mkdirSync(目录, { recursive: true });
  const 版本 = JSON.parse(fs.readFileSync(path.join(DSH包, 'dsh-base', 'package.json'), 'utf8')).version;
  fs.writeFileSync(path.join(目录, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${profile}`,
    private: true,
    dependencies: {
      '@deepseek-ai/dsh-base': 版本,
      '@deepseek-ai/dsh-headless': 版本,
      '@deepseek-ai/dsh-llm-deepseek-api-key': 版本,
      'dsh-toolbox': `link:${path.resolve(本目录, '..')}`,
    },
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-headless',
          // 官方那条路由从 `DEEPSEEK_API_KEY` 读密钥：这一趟要真调模型。
          '@deepseek-ai/dsh-llm-deepseek-api-key',
          'dsh-toolbox',
        ],
      },
    },
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(目录, 'cordis.yml'), '# 临时 profile，见 对接层/tools/对话桥真机.mjs\n[]\n', 'utf8');
  fs.writeFileSync(path.join(目录, 'cordis.patch.yml'), [
    '# 临时 profile：只做两件事——让开身份位置、把对接层插进来。',
    '- id: system-prompt',
    '  config:',
    '    includeHarnessIdentity: false',
    "    personaPrefix: ''",
    "    personaSuffix: ''",
    '',
    '- insert:',
    '    - id: toolbox',
    '      name: dsh-toolbox',
    '      config:',
    `        项目根: ${JSON.stringify(项目根)}`,
    "        用户目录: '工具箱数据/主AI'",
    "        默认目录: '主AI模块/assets/预设'",
    "        图片目录: '工具箱数据/图片'",
    "        世界书用户目录: '工具箱数据/世界书'",
    "        世界书默认目录: '世界书模块/assets/世界书'",
    "        模型目录: '模型'",
    "        翻译模型: 'opus-mt'",
    "        识图模型: 'wd-eva02'",
    "        翻译方向: 'auto'",
    "        comfyUI地址: 'http://127.0.0.1:8188'",
    "        comfyUI工作流存档: '工具箱数据/comfyUI/工作流.json'",
    '        请求: 主AI',
    '        装订请求: 翻译',
    `        对话桥端口: ${端口}`,
    `        对话桥存档: ${JSON.stringify(存档)}`,
    '        对话桥挂住: true',
    '        池:',
    '          官方: { 路由: deepseek-official, 模型: [deepseek-flash] }',
    '        路由:',
    '          主AI: {}',
    '          翻译: {}',
    '          识图: {}',
    '          文生图: {}',
    '',
  ].join('\n'), 'utf8');

  // 让 profile 解析得到两样东西：本仓库的对接层（一条 junction）与 DSH 的那几个包。
  // 这一趟不起 pnpm —— 只验桥，不需要真走一遍包管理器。
  const 装 = path.join(目录, 'node_modules');
  const 链 = path.join(装, '@deepseek-ai');
  fs.mkdirSync(链, { recursive: true });
  for (const 名 of ['dsh-base', 'dsh-headless', 'dsh-llm-deepseek-api-key']) {
    const 那里 = path.join(链, 名);
    try { if (!fs.existsSync(那里)) fs.symlinkSync(path.join(DSH包, 名), 那里, 'junction'); } catch (_) { /* 链不上就算了 */ }
  }
  const 工具箱 = path.join(装, 'dsh-toolbox');
  try { if (!fs.existsSync(工具箱)) fs.symlinkSync(path.resolve(本目录, '..'), 工具箱, 'junction'); } catch (_) { /* 链不上就算了 */ }
  return 目录;
}

async function 主() {
  const 参数 = process.argv.slice(2);
  const 端口 = Number(参数[参数.indexOf('--端口') + 1]) || 8893;
  const 入口 = 找DSH();
  console.log(`DSH 入口：${入口 || '（没找到）'}`);
  if (!入口) { console.log('找不到 DSH 的 bin.js；用 DSH_BIN 指一个。'); process.exit(1); }
  const 密钥 = 找密钥();
  console.log(`密钥来源：${密钥 ? (process.env.DEEPSEEK_API_KEY ? '环境变量' : 'DSH 的凭据文件') : '（没有）'}`);
  if (!密钥) { console.log('这一趟要真调模型：把 DEEPSEEK_API_KEY 放进环境，或让 DSH 的凭据文件里已经有它。'); process.exit(1); }

  /** 前一轮剩下的临时家目录先清掉：那里面可能有上回写下的发现文件。 */
  try { fs.rmSync(家, { recursive: true, force: true }); } catch (_) { /* 清不掉就算了 */ }
  造Profile(端口, 找DSH包(入口));

  console.log('\n一、起一个真 DSH（临时 profile「工具箱桥实测」）');
  const 子 = spawn(process.execPath, [入口, '--profile', profile, 'headless', '只回一句话：桥在不在。'], {
    cwd: 项目根,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DSH_HOME: 家, DEEPSEEK_API_KEY: 密钥 },
  });
  let 输出 = '';
  子.stdout.on('data', (块) => { 输出 += String(块); });
  子.stderr.on('data', (块) => { 输出 += String(块); });
  子.on('exit', (码) => { if (码 !== null) 输出 += `\n[DSH 退出，码 ${码}]\n`; });

  const 桥 = await 等到(() => {
    if (!fs.existsSync(存档)) return null;
    const 原 = JSON.parse(fs.readFileSync(存档, 'utf8'));
    return 原 && 原.端口 ? 原 : null;
  }, 90000);
  判('插件装上了、桥起来了（发现文件在）', Boolean(桥), 桥 ? `端口 ${桥.端口}` : `DSH 输出末尾：${输出.slice(-600)}`);
  if (!桥) {
    子.kill();
    console.log(`\n过了 ${过了} 条 · 崩了 ${崩了.length} 条`);
    console.log(`\nDSH 输出（末尾 1500 字）：\n${输出.slice(-1500)}`);
    process.exit(1);
  }

  const 基 = `http://127.0.0.1:${桥.端口}`;
  const 令牌 = 桥.令牌;

  console.log('\n二、令牌那一关');
  const 没令牌 = await fetch(`${基}/对话/状态`, { method: 'POST' });
  判('没有令牌进不来', 没令牌.status === 403, `HTTP ${没令牌.status}`);

  console.log('\n三、开一条新对话，发一句话（真调模型）');
  const 新 = await 请(基, 令牌, '/对话/新');
  判('开得出一条新对话', 新.ok === true && Boolean(新.当前), `${String(新.当前).slice(0, 8)}…`);
  const 会话id = 新.当前;
  const 发 = await 请(基, 令牌, '/对话/发', {
    体: { 会话: 会话id, 话: '用 image_list 看一眼图库里有几张图，然后只回一句「图库 N 张」。' },
  });
  判('话送进会话了', 发.ok === true, JSON.stringify(发).slice(0, 120));

  console.log('\n四、等模型回话（真跑一轮）');
  const 回 = await 等到(async () => {
    const 状 = await 请(基, 令牌, '/对话/状态', { 查: { 当前: 会话id } });
    const 这条 = (状.会话 || []).find((一) => 一.id === 会话id);
    if (!这条) return null;
    const 助手有词 = 这条.messages.some((一) => 一.role === 'assistant' && String(一.text || '').trim());
    return 助手有词 && 状.在跑 === false ? 这条 : null;
  }, 180000);

  if (回) {
    console.log(`  · 会话里的 ${回.messages.length} 条消息：`);
    for (const 一 of 回.messages) {
      const 头 = 一.role === 'user' ? '我' : 'AI';
      const 尾 = String(一.text || '').replace(/\s+/g, ' ').trim().slice(0, 70);
      if (尾 || (一.toolCalls || []).length) console.log(`      [${头}] ${尾 || '（只有过程）'}`);
      for (const 工具 of 一.toolCalls || []) {
        console.log(`           ↳ 工具 ${工具.name} ${String(工具.result || '').replace(/\s+/g, ' ').slice(0, 60)}`);
      }
    }
    const 助手 = 回.messages.filter((一) => 一.role === 'assistant');
    判('模型真回话了', 助手.some((一) => String(一.text || '').trim()), `回了 ${助手.length} 条`);
    判('我那句也在里面', 回.messages.some((一) => 一.role === 'user' && String(一.text).includes('image_list')));
    判('标题取的是我那句', 回.title.includes('image_list'), 回.title);
    判('那一轮真调到了我们的工具', 助手.some((一) => (一.toolCalls || []).length > 0),
      (助手.flatMap((一) => 一.toolCalls || []).map((一) => 一.name).join(' · ') || '一个都没调'));
  } else {
    const 状 = await 请(基, 令牌, '/对话/状态', { 查: { 当前: 会话id } });
    判('模型真回话了', false, `没等到；现在这份：${JSON.stringify(状).slice(0, 600)}`);
  }

  console.log('\n五、收摊');
  子.kill();
  await 歇(2000);
  判('杀掉 DSH 之后发现文件没了', !fs.existsSync(存档));
  if (!参数.includes('--留')) { try { fs.rmSync(家, { recursive: true, force: true }); } catch (_) { /* 删不掉就算了 */ } }

  console.log('');
  console.log(`过了 ${过了} 条 · 崩了 ${崩了.length} 条`);
  if (崩了.length) {
    console.log('失败清单：');
    for (const 一 of 崩了) console.log(`  · ${一}`);
    console.log(`\nDSH 输出（末尾 2000 字）：\n${输出.slice(-2000)}`);
  }
  process.exit(崩了.length ? 1 : 0);
}

主().catch((错) => { console.error('跑不下去：', 错); process.exit(1); });
