// 对接层 · 自检（第一段：装配与登记）
//
// 本文件只验"装配这件事"：把 cordis.patch.yml 里那份配置交给 apply()，
// 用一个契约替身当 DSH 的 ctx，看它装出了什么、登记了什么、段读出来是什么。
//
// 替身只实现本插件用到的那五样：systemPrompt.section / tools.register / llm.stream /
// on / effect。真机能不能跑不在这里验（那是联调的事）。
//
// 用法：node test/run.js [过滤词]
// 失败非零退出。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';

import { apply, name, inject } from '../index.js';
import { 造模块清单 } from '../模块清单.js';

const 包根 = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const 项目根 = path.dirname(包根);
const 要 = createRequire(import.meta.url);
const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-assembly-'));
process.once('exit', () => fs.rmSync(临时目录, { recursive: true, force: true }));

// ---------- 判据台 ----------
const 条 = [];
const 判 = (标题, 做) => 条.push({ 标题, 做 });

/** 相等的断言。 */
function 等(实, 期, 话 = '') {
  const 甲 = JSON.stringify(实);
  const 乙 = JSON.stringify(期);
  if (甲 !== 乙) throw new Error(`${话} 期望 ${乙}，实际 ${甲}`);
}

/** 真的断言。 */
function 真(值, 话 = '') {
  if (!值) throw new Error(话 || '期望为真，实际为假');
}

/** 该抛错的断言。 */
function 抛(做, 含 = '') {
  let 抛了 = null;
  try { 做(); } catch (e) { 抛了 = e; }
  if (!抛了) throw new Error(`期望抛错，没有抛${含 ? `（要找「${含}」）` : ''}`);
  if (含 && !String(抛了.message).includes(含)) throw new Error(`抛错信息里没有「${含}」：${抛了.message}`);
  return 抛了;
}

// ---------- 契约替身 ----------
/** 一个记事的 ctx：把登记与监听都收在数组里。provide 出来的东西也要能当属性读到。 */
function 造替身() {
  const 段 = [];
  const 工具 = [];
  const 监听 = [];
  const 效果 = [];
  const 供 = {};
  const ctx = {
    段, 工具, 监听, 效果, 供,
    systemPrompt: { section: (一) => { 段.push(一); return () => {}; } },
    tools: { register: (一) => { 工具.push(一); return () => {}; } },
    llm: { stream: async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; } },
    on: (事件, 做) => { 监听.push({ 事件, 做 }); return () => {}; },
    effect: (做) => { 效果.push(做); return () => {}; },
    provide: (名, 值) => { 供[名] = 值; ctx[名] = 值; return () => {}; },
  };
  return ctx;
}

/** patch 文件里那份配置；`项目根` 是占位符，换成这份仓库的位置。 */
function 读配置() {
  const 条目 = yaml.load(fs.readFileSync(path.join(包根, 'cordis.patch.yml'), 'utf8'));
  const 插入 = 条目.find((一) => 一 && 一.insert);
  const 插件 = 插入.insert.find((一) => 一 && 一.id === 'toolbox');
  const 这次目录 = fs.mkdtempSync(path.join(临时目录, 'case-'));
  return { ...插件.config, 项目根, 数据目录: path.join(这次目录, '数据'), 图片目录: path.join(这次目录, '图片'), 用户目录: path.join(这次目录, '预设'), 世界书用户目录: path.join(这次目录, '世界书'), 对话桥: false };
}

/** 装一次，给回 { 出, ctx, 配置, 模块清单 }。apply 是异步的（模型可能要在装配时加载）。 */
async function 装一次(改配置 = () => {}) {
  const 配置 = 读配置();
  改配置(配置);
  const ctx = 造替身();
  const 出 = await apply(ctx, 配置);
  return { 出, ctx, 配置, 模块清单: 造模块清单() };
}

/** 挂一个假的世界书门面：哪些条目命中，由它说了算。 */
function 挂世界书(ctx, 命中) {
  ctx.toolbox.门面.worldbook = { run: (_action, args) => {
    真(!Object.hasOwn(args, '启用'), '请求运行不应从预设传入世界书启用列表');
    return { ok: true, data: { 请求: args.请求, 书: [], 命中 } };
  } };
}

/** 事件名 → 挂上去的那几个函数。 */
function 监听们(ctx) {
  return (事件) => ctx.监听.filter((一) => 一.事件 === 事件).map((一) => 一.做);
}

// ---------- 判据 ----------

判('主 AI 默认启用世界书中的两条常驻正文', async () => {
  const { ctx, 出 } = await 装一次();
  const 门面 = ctx.toolbox.门面;
  const snapshot = 门面.worldbook.读({ 请求: '主AI' });
  等(snapshot.默认启用.主AI, ['$default:主AI']);
  真(snapshot.启用.some(row => row.标识 === '$default:主AI'), '默认订阅应包含主 AI 世界书');
  const book = 门面.worldbook.读({ 书: '$default:主AI' }).书;
  等(book.条目.length, 2, '默认主 AI 世界书有两条正文');
  真(book.条目.every(row => row.always && row.enabled !== false), '两条正文均为启用的常驻条目');
  const body = book.条目.map(row => row.text).join('\n\n');
  真(!/本次生成设置|剩余轮数|最多生成轮数包含首次|生成状态为准|自动迭代关闭时/.test(body), '默认正文不公开用户侧参数或额度');
  真(/收到.*无法继续.*结束|无法继续生成/.test(body), '默认正文按不可继续回执结束生图');
  等(ctx.段.find(row => row.name === 'toolbox:世界书前').text(), body);
  const effective = 出.主AI.执行({ 请求: '主AI' });
  for (const key of ['身份', '流程', '世界书']) 真(!Object.hasOwn(effective, key), `执行结果不再包含 ${key}`);
});

判('插件导出 name / inject / apply', () => {
  等(name, 'toolbox');
  等(inject, ['systemPrompt', 'tools', 'llm', 'agents', 'sessions']);
  真(typeof apply === 'function', 'apply 要是函数');
});

判('主 AI 多本订阅按启用次序进入提示词，空列表会移除默认正文', async () => {
  const { ctx, 出 } = await 装一次();
  const 门 = ctx.toolbox.门面.worldbook;
  const a = 门.书({ 动作: '导入', 请求: '主AI', 书: { name: '主 AI 第一册', entries: [{ text: '主AI第一本启用正文', always: true, 落点: '前' }] } });
  const b = 门.书({ 动作: '导入', 请求: '主AI', 书: { name: '主 AI 第二册', entries: [{ text: '主AI第二本启用正文', always: true, 落点: '前' }] } });
  门.书({ 动作: '换', 请求: '主AI', 启用: [a.标识, b.标识] });
  await 门.存();
  等(ctx.段.find(row => row.name === 'toolbox:世界书前').text(), '主AI第一本启用正文\n\n主AI第二本启用正文');
  门.书({ 动作: '换', 请求: '主AI', 启用: [] }); await 门.存();
  等(ctx.段.find(row => row.name === 'toolbox:世界书前').text(), '');
});

判('副请求提示词使用其订阅列表并与主 AI 书籍隔离', async () => {
  const { ctx } = await 装一次(配置 => { 配置.请求 = '翻译'; });
  const 门 = ctx.toolbox.门面.worldbook;
  const 书 = 门.书({ 动作: '导入', 请求: '翻译', 书: { name: '翻译独立', entries: [{ text: '翻译请求独立正文', always: true, 落点: '前' }] } });
  门.书({ 动作: '换', 请求: '翻译', 启用: [书.标识] }); await 门.存();
  等(ctx.段.find(row => row.name === 'toolbox:世界书前').text(), '翻译请求独立正文');
  等(门.执行({ 请求: '主AI', 文本: '' }).命中.some(row => row.文本 === '翻译请求独立正文'), false, '翻译书不能进入主 AI 请求');
  门.书({ 动作: '换', 请求: '翻译', 启用: [] }); await 门.存();
  等(ctx.段.find(row => row.name === 'toolbox:世界书前').text(), '');
});

判('切换主 AI 预设及工具偏好不改变世界书订阅', async () => {
  const { ctx, 出 } = await 装一次();
  const 门 = ctx.toolbox.门面.worldbook;
  const book = 门.书({ 动作: '导入', 请求: '主AI', 书: { name: '独立订阅', entries: [{ text: '预设切换后仍在的正文', always: true, 落点: '前' }] } });
  门.书({ 动作: '换', 请求: '主AI', 启用: [book.标识] }); await 门.存();
  const before = 门.读({ 请求: '主AI' }).启用.map(row => row.标识);
  const active = 出.主AI.执行({ 请求: '主AI' });
  const copied = 出.主AI.预设({ 动作: '复制', 源: active.预设.标识 });
  出.主AI.预设({ 动作: '改', 预设: copied.标识, model: { 走: '测试链路', 模型: '测试型号' } });
  出.主AI.工具({ 动作: '删', 预设: copied.标识, 名字: active.工具表[0].名字 });
  出.主AI.预设({ 动作: '换', 请求: '主AI', 启用: [copied.标识] });
  await 出.主AI.存();
  等(门.读({ 请求: '主AI' }).启用.map(row => row.标识), before);
  等(ctx.段.find(row => row.name === 'toolbox:世界书前').text(), '预设切换后仍在的正文');
});

判('没有 项目根 ⇒ 装配时抛错', async () => {
  const ctx = 造替身();
  let 抛了 = null;
  try {
    await apply(ctx, {});
  } catch (错误) {
    抛了 = 错误;
  }
  真(抛了, '期望抛错，没有抛');
  真(String(抛了.message).includes('项目根'), `抛错信息里没有「项目根」：${抛了.message}`);
});

判('七个模块都装起来了，门面各有 describe / run', async () => {
  const { 出 } = await 装一次();
  const 名 = Object.keys(出.门面);
  等(名.length, 7, '模块个数');
  for (const 要的 of ['tag', 'image', 'worldbook', 'binding', 'comfy', 'translate', 'vision']) {
    真(名.includes(要的), `少了 ${要的} 模块`);
  }
  for (const [名, 门] of Object.entries(出.门面)) {
    真(typeof 门.describe === 'function', `${名} 要有 describe`);
    真(typeof 门.run === 'function', `${名} 要有 run`);
  }
});

判('存储位置配置优先于 YAML 模型选择；失效选择保持空且测试数据隔离', async () => {
  const { 出, 配置 } = await 装一次((项) => {
    fs.mkdirSync(项.数据目录, { recursive: true });
    fs.writeFileSync(path.join(项.数据目录, '设置.json'), JSON.stringify({ 识图模型: 'removed-vision', 翻译模型: 'opus-mt' }));
  });
  等(出.模型.目录, path.resolve(项目根, '..', '模型'));
  等(出.模型.这次用.识图, null, '无效的已保存识图选择不可回退到 YAML 的模型');
  等(出.模型.这次用.翻译, 'opus-mt', '存储中的模型选择应优先于 YAML');
  真(fs.existsSync(path.join(配置.数据目录, '设置.json')), '设置应只在本次临时数据根');

  const { 出: 自动发现 } = await 装一次((项) => {
    delete 项.识图模型;
    delete 项.翻译模型;
  });
  const 已装 = 自动发现.模型.装着;
  等(自动发现.模型.这次用.识图, 已装.vision.find((x) => x.装好了)?.id || null);
  等(自动发现.模型.这次用.翻译, 已装.translation.find((x) => x.装好了)?.id || null);
});

判('工具名是提供方认的形状：ASCII 字母 / 数字 / 下划线 / 连字符', async () => {
  // 提供方对 tools[].function.name 的约束。名字里出现别的字符，请求会被 400 打回。
  const 合法 = /^[a-zA-Z0-9_-]+$/;
  const { 出 } = await 装一次();
  const 坏 = 出.预设.工具表.filter((一) => !合法.test(一.名字)).map((一) => 一.名字);
  等(坏, [], '不合法的工具名');
  真(出.预设.工具表.length > 0, '工具表不能是空的');
});

判('注册表只交绘画业务，不交底层模块管理动作', async () => {
  const { 出 } = await 装一次();
  const 名字 = 出.预设.工具表.map(row => row.名字).sort();
  等(名字, ['drawing_generate', 'drawing_info', 'drawing_prompt', 'images_list', 'images_metadata', 'images_view', 'tags_get', 'tags_search', 'translate_text', 'vision_describe', 'vision_tag'].sort());
  真(!名字.includes('参数'), 'Comfy 用户参数动作不登记为 AI 业务工具');
});

判('主 AI 模块执行只给预设标识、工具表与模型', async () => {
  const { 出 } = await 装一次();
  真(typeof 出.主AI.执行 === 'function', '主AI 要有 执行');
  const 预 = 出.主AI.执行({ 请求: '主AI' });
  真(预 && typeof 预.预设?.标识 === 'string' && 预.预设.标识.length > 0, '预设标识要非空');
  真(Array.isArray(预.工具表), '工具表要存在');
  真(预.模型 && typeof 预.模型 === 'object', '模型设置要存在');
  for (const key of ['身份', '流程', '世界书']) 真(!Object.hasOwn(预, key), `执行结果不再包含 ${key}`);
  等(预.请求, '主AI');
});

判('业务工具数量独立于模块动作数量', async () => {
  const { 出 } = await 装一次();
  let 应有 = 0;
  for (const 门 of Object.values(出.门面)) 应有 += 门.actions.length;
  等(出.预设.工具表.length, 11, '外部插件未传用户提问端口时的绘画业务数');
  真(应有 > 出.预设.工具表.length, '管理动作不应逐项变成模型能力');
});

判('业务声明保留摘要、真实类型、必填和嵌套选项结构', async () => {
  const { 出, ctx } = await 装一次();
  for (const 一 of 出.预设.工具表) {
    真(一.摘要?.length > 0, `${一.名字} 缺用途说明`);
    const 预设参数 = Object.keys(一.参数 || {}).sort();
    真(!预设参数.some((x) => x.includes('?')), `${一.名字} 的参数名里不该有 ?`);
    for (const [名, 形] of Object.entries(一.参数 || {})) {
      // 形状要么给一个 type，要么给 oneOf（"两种形状都可能"那几个）。
      const 有形状 = 形 && (typeof 形.type === 'string' && 形.type || Array.isArray(形.oneOf) && 形.oneOf.length);
      真(有形状, `${一.名字} 的 ${名} 要有 type 或 oneOf`);
    }
  }
  const draw = ctx.工具.find(row => row.name === 'drawing_generate');
  等(draw.parameters.required, ['正向']);
  等(draw.parameters.properties.参考图.type, 'integer');
  等(ctx.工具.some(row => row.name === 'ask_user'), false, '未传提问能力时不生成悬空工具');
});

判('提示词只注册世界书前后两段', async () => {
  const { ctx } = await 装一次();
  const 表 = new Map(ctx.段.map((一) => [一.name, 一.order]));
  等(表.size, 2, '段数');
  等(表.get('toolbox:世界书前'), 5110);
  等(表.get('toolbox:世界书后'), 5120);
});

判('门面与预设通过 provide 交到 ctx.toolbox，不是直接赋值', async () => {
  const { ctx, 出 } = await 装一次();
  真(ctx.供 && ctx.供.toolbox, '要 provide 出 toolbox');
  真(ctx.供.toolbox.门面 === 出.门面, '门面要是同一份');
  真(ctx.供.toolbox.预设 === 出.预设, '预设要是同一份');
});

判('段取正文时不 await，直接给字符串；明确空订阅会移除默认世界书', async () => {
  const { ctx } = await 装一次();
  const worldbook = ctx.toolbox.门面.worldbook;
  worldbook.书({ 动作: '换', 请求: '主AI', 启用: [] });
  await worldbook.存();
  等(ctx.段.length, 2, '只保留世界书段');
  for (const 一 of ctx.段) {
    const 文 = 一.text();
    真(typeof 文 === 'string', `${一.name} 的 text() 要给字符串`);
    等(一.interpolate, false, `${一.name} 的 interpolate`);
    等(文, '', `${一.name} 明确空订阅后要给空串`);
  }
});

判('世界书的《前》《后》各进自己那一段', async () => {
  const { ctx } = await 装一次();
  挂世界书(ctx, [
    { 文本: '前段的正文', 落点: '前', 书: 'wb1' },
    { 文本: '后段的正文', 落点: '后', 书: 'wb1' },
  ]);
  const 取段 = (名) => ctx.段.find((一) => 一.name === 名).text({}).trim();
  等(取段('toolbox:世界书前'), '前段的正文');
  等(取段('toolbox:世界书后'), '后段的正文');
});

判('同一堆里的条目按模块给的次序接起来，本层不认识的落点原样忽略', async () => {
  const { ctx } = await 装一次();
  挂世界书(ctx, [
    { 文本: '甲', 落点: '前' },
    { 文本: '乙', 落点: '前' },
    { 文本: '不认识的落点', 落点: '出口' },
    { 文本: '', 落点: '前' },
  ]);
  const 前 = ctx.段.find((一) => 一.name === 'toolbox:世界书前').text({});
  等(前.replace(/\r\n/g, '\n'), '甲\n\n乙');
});

判('插手点：还挂了 agent/pre-step（《按深度》那条走它）', async () => {
  const { ctx } = await 装一次();
  const 事件 = ctx.监听.map((一) => 一.事件);
  for (const 要的 of ['agent/inbox/claimed', 'agent/inbox/inserted', 'agent/pre-step']) {
    真(事件.includes(要的), `监听里要有 ${要的}，实际 ${JSON.stringify(事件)}`);
  }
});

判('《按深度》：紧贴用户这次的话之前插一条 user 消息', async () => {
  const { ctx, 出 } = await 装一次();
  挂世界书(ctx, [{ 文本: '深度段的正文', 落点: '按深度', 深度: 2, 角色: '系统' }]);

  const agent = {};
  const 用户的话 = { role: 'user', content: [{ type: 'text', text: '给我翻这段' }] };
  const 决定 = {
    kind: 'enter',
    messages: [{ role: 'system', content: [{ type: 'text', text: '身份' }] }, 用户的话],
  };
  const 挂pre = 监听们(ctx)('agent/pre-step')[0];
  const 回 = await 挂pre({ agent, messages: [用户的话] }, () => Promise.resolve(决定));

  等(回.messages.length, 3, '多出来一条');
  等(回.messages[0], 决定.messages[0], '原来那条 system 不动');
  等(回.messages[1].role, 'user');
  等(回.messages[1].content[0].text, '深度段的正文');
  等(回.messages[2], 用户的话, '插在用户那句话之前');
  等(决定.messages.length, 2, '不许就地改原来那份');
});

判('《按深度》：没有命中不插；工具回执那几步也不重复插', async () => {
  const agent = {};
  const 用户的话 = { role: 'user', content: [{ type: 'text', text: '第一句' }] };
  const 决定 = { kind: 'enter', messages: [用户的话] };

  const 空 = await 装一次();
  const 空pre = 监听们(空.ctx)('agent/pre-step')[0];
  const 没命中 = await 空pre({ agent, messages: [用户的话] }, () => Promise.resolve(决定));
  等(没命中, 决定, '没有命中就把决定原样交回去');

  const 有 = await 装一次();
  挂世界书(有.ctx, [{ 文本: '深度段', 落点: '按深度' }]);
  const 有pre = 监听们(有.ctx)('agent/pre-step')[0];
  const 第一轮 = await 有pre({ agent, messages: [用户的话] }, () => Promise.resolve(决定));
  等(第一轮.messages.length, 2, '第一轮插一条');

  // 这一步的批次里只有工具回执，没有用户自己说的话
  const 回执 = { role: 'user', content: [{ type: 'tool-result', id: 't1' }] };
  const 第二轮 = await 有pre({ agent, messages: [回执] }, () => Promise.resolve({ kind: 'enter', messages: [回执] }));
  等(第二轮.messages.length, 1, '工具回执那一步不插');
});

判('工具登记数 = 工具表条数，每条都给 DSH 形状的定义', async () => {
  const { ctx, 出 } = await 装一次();
  等(ctx.工具.length, 出.预设.工具表.length);
  for (const 一 of ctx.工具) {
    const 下 = 一.name.indexOf('_');
    真(下 > 0 && 下 < 一.name.length - 1, `工具名要能拆成两段：${一.name}`);
    真(typeof 一.description === 'string' && 一.description.length > 0, `${一.name} 要有说明`);
    真(一.parameters && 一.parameters.type === 'object', `${一.name} 的参数要是 object 形状`);
    真(一.parameters.properties && typeof 一.parameters.properties === 'object', `${一.name} 要有 properties`);
    真(typeof 一.execute === 'function', `${一.name} 要有 execute`);
    真(一.output && 一.output.schema, `${一.name} 要有输出声明`);
    真(typeof 一.output.render === 'function', `${一.name} 的输出要有 render`);
  }
});

判('工具名一个不重', async () => {
  const { ctx } = await 装一次();
  const 名 = ctx.工具.map((一) => 一.name);
  等(new Set(名).size, 名.length, '工具名重复');
});

判('登记的表是活的：工具挂上以后能卸下', async () => {
  const { ctx } = await 装一次();
  真(ctx.效果.length > 0, '要挂一个卸载效果');
  const 卸 = ctx.效果[0]();
  // 替身给的是 () => {}，卸一次不抛就够
  for (const 一 of [卸]) if (typeof 一 === 'function') 一();
});

判('插手点：挂了 agent/inbox/claimed', async () => {
  const { ctx } = await 装一次();
  const 事件 = ctx.监听.map((一) => 一.事件);
  真(事件.includes('agent/inbox/claimed'), `监听里要有 agent/inbox/claimed，实际 ${JSON.stringify(事件)}`);
});

判('本轮文本：claim 之后取得到，inserted 之后清空', async () => {
  const { ctx, 出 } = await 装一次();
  const 挂 = (事件) => ctx.监听.find((一) => 一.事件 === 事件).做;
  const agent = {};
  等(出.本轮文本(agent), '', '没说过话时是空串');
  挂('agent/inbox/claimed')({ agent, message: { content: [{ type: 'text', text: '第一句' }] } });
  挂('agent/inbox/claimed')({ agent, message: { content: [{ type: 'text', text: '第二句' }] } });
  等(出.本轮文本(agent), '第一句\n第二句', '同一步的两条要拼起来');
  挂('agent/inbox/inserted')({ agent });
  等(出.本轮文本(agent), '', '新一批进来后要清空');
});

判('本轮文本：按 agent 分桶，互不串', async () => {
  const { ctx, 出 } = await 装一次();
  const 挂 = (事件) => ctx.监听.find((一) => 一.事件 === 事件).做;
  const 甲 = {}; const 乙 = {};
  挂('agent/inbox/claimed')({ agent: 甲, message: { content: '甲说的话' } });
  挂('agent/inbox/claimed')({ agent: 乙, message: { content: '乙说的话' } });
  等(出.本轮文本(甲), '甲说的话');
  等(出.本轮文本(乙), '乙说的话');
});

判('调度：默认配置下主 AI 跟随 DSH 自己的模型', async () => {
  const { 出 } = await 装一次();
  const 谁 = 出.调度.查路由('主AI');
  等(谁.跟随, true);
  等(谁.用的谁.provider, '(跟随主 AI)');
});

判('调度：识图走池里的本地那条', async () => {
  const { 出 } = await 装一次();
  const 谁 = 出.调度.查路由('识图');
  等(谁.跟随, false);
  等(谁.provider, 'local');
  等(谁.model, 'qwen-vl');
});

判('调度：写错的名字明确失败，不回落', async () => {
  const { 出 } = await 装一次((配置) => {
    配置.路由.翻译 = { 走: '池里没有这条' };
  });
  抛(() => 出.调度.查路由('翻译'), 'DISPATCH_NO_SUCH_POOL');
});

判('调度：模型不在池里也明确失败', async () => {
  const { 出 } = await 装一次((配置) => {
    配置.路由.文生图 = { 走: '本地', 模型: '不存在的模型' };
  });
  抛(() => 出.调度.查路由('文生图'), 'DISPATCH_MODEL_NOT_IN_POOL');
});

判('调度：没写路由的请求跟随主 AI，不报错', async () => {
  const { 出 } = await 装一次((配置) => {
    delete 配置.路由.识图;
  });
  const 谁 = 出.调度.查路由('识图');
  等(谁.跟随, true);
});

判('装订的 AI 翻译端口递进去了：报文进、键值对出', async () => {
  // llm.stream 是替身：回一段 JSON 正文。造翻译要把它抠出来。
  const 配置 = 读配置();
  const ctx = 造替身();
  ctx.llm.stream = async function* () {
    yield { type: 'text-delta', text: '{"一个词":"一个译"}' };
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
  const 出 = await apply(ctx, 配置);
  真(出.调度, '要有调度');
  // 门面里的装订模块已经拿了这个端口；这里只验端口函数本身
  真(typeof 出.门面.binding.run === 'function', '装订要装起来');
});

判('装订的查词端口递进去了：查得到的给库里中文名，查不到的留给模型', async () => {
  // 递进去的查词就是标签模块的 `认词`（拿本机那份库真查）。
  const 配置 = 读配置();
  const ctx = 造替身();
  ctx.llm.stream = async function* () {
    yield { type: 'text-delta', text: '{"smile":"微笑"}' };
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
  const 出 = await apply(ctx, 配置);
  const 回 = await 出.门面.binding.run('装订', { 文本: '(1girl:1.2), hatsune_miku, smile, zzz_没有的词' });
  真(回.ok, `装订要成功：${JSON.stringify(回)}`);
  // 库里有的两个词给中文名，模型只被问了它俩都答不上来的那个
  真(回.译文.includes('初音未来'), `库译名要进译文：${回.译文}`);
  真(回.译文.includes('微笑'), `模型译文要进译文：${回.译文}`);
  真(回.译文.includes('zzz_没有的词'), `查不到的词照抄原文：${回.译文}`);
  真(回.译文.includes(':1.2'), `壳要原样保留：${回.译文}`);
  真(!回.译文.includes('1girl'), '1girl 该换成了库里的中文名');
});

判('查词是"标签模块装起来了才递"：没装就不给这一支', () => {
  const 有标签 = { tag: { recognize: (词们) => 词们 } };
  const 没标签 = { tag: undefined };
  const 找装订 = () => 造模块清单({ AI翻译: async () => ({}) }).find((一) => 一.名字 === 'binding');

  const 给 = 找装订().选项('/根', {}, 有标签);
  真(typeof 给.查词 === 'function', '标签模块在，就该递查词');
  真(typeof 给.AI翻译 === 'function', 'AI 翻译照样要递');
  等(给.查词(['a', 'b']), ['a', 'b'], '查词就是标签模块的 认词 原样转交');

  const 不给 = 找装订().选项('/根', {}, 没标签);
  等(不给.查词, undefined, '标签模块不在，就没有这一支');
  真(typeof 不给.AI翻译 === 'function', 'AI 翻译不受影响');
});

判('标签查询业务调用真实模块，返回用户可选择的词条标识', async () => {
  const { ctx } = await 装一次();
  const 一 = ctx.工具.find((x) => x.name === 'tags_search');
  const 回 = await 一.execute({ 查询: 'earrings' });
  真(回.候选.some(row => row.名称 === 'earrings' && row.标识), '耳环词条和标识应可用');
});

判('模块报失败 ⇒ 工具抛错，理由带码', async () => {
  const { ctx } = await 装一次();
  const 一 = ctx.工具.find((x) => x.name === 'tags_get');
  let 抛了 = null;
  try { await 一.execute({ 标识: 'missing-record' }); } catch (e) { 抛了 = e; }
  真(抛了 && typeof 抛了.code === 'string', '不存在的记录应明确失败并保留错误码');
  真(抛了.业务回执?.ok === false, '失败回执应完整保留');
});

判('DSH工具执行按各自agent会话取图，不共享当前会话', async () => {
  const { ctx, 出 } = await 装一次();
  for (const 会话 of ['native-a', 'native-b']) {
    const r = await 出.门面.image.run('存', { 作用域: { 存放地: 'session', 会话ID: 会话 }, 字节: Buffer.from([1, 2, 3]), 文件名: `${会话}.png` });
    真(r.ok, '测试素材应写入独立作用域');
  }
  const list = ctx.工具.find(row => row.name === 'images_list');
  const results = await Promise.all(['native-a', 'native-b'].map(id => list.execute({}, { agent: { session: { id } }, signal: new AbortController().signal })));
  等(results.map(r => r.图片.map(image => image.名称)), [['native-a.png'], ['native-b.png']]);
});

判('DSH明确注入提问端口后才登记ask_user，问题绑定调用会话', async () => {
  const seen = [];
  const { ctx } = await 装一次(config => { config.用户提问 = async value => { seen.push(value); return { ok: true, data: { 答案: '角色B' } }; }; });
  const ask = ctx.工具.find(row => row.name === 'ask_user');
  真(ask, '已传入的交互能力应登记');
  等(ask.parameters.properties.选项.items.required, ['标识', '说明']);
  const result = await ask.execute({ 问题: '选哪个角色？', 选项: [{ 标识: 'B', 说明: '角色B' }] }, { agent: { session: { id: 'native-question' } }, signal: new AbortController().signal });
  等(result, { 答案: '角色B' });
  等(seen[0].会话, 'native-question');
});

判('工具的参数里没有路径 / 地址这类东西', async () => {
  const { ctx } = await 装一次();
  const 禁 = /路径|地址|目录|url|path|dir/i;
  for (const 一 of ctx.工具) {
    const 名 = Object.keys((一.parameters && 一.parameters.properties) || {});
    const 坏 = 名.filter((x) => 禁.test(x));
    等(坏, [], `${一.name} 的参数里有位置类名字`);
  }
});

判('DSH 同一轮多个生图共用额度，工具回执不重置，新用户请求才重置', async () => {
  const { ctx, 出 } = await 装一次();
  let submissions = 0;
  出.门面.comfy = { run: async (action, args) => {
    if (action === '生成设置') return { ok: true, data: { 每轮张数: 1, 最多轮数: 1, 自动迭代: false } };
    if (action === '出图') { submissions++; args.onEvent?.({ 类型: '提交中' }); return { ok: true, data: { 产出: [{ 文件名: 'out.png', 种类: 'image' }] } }; }
    if (action === '取图') return { ok: true, data: { 字节: Buffer.from([1]), 文件名: 'out.png', mime: 'image/png' } };
  } };
  const draw = ctx.工具.find(row => row.name === 'drawing_generate');
  const agent = { session: { id: 'native-quota' } };
  const context = { agent, signal: new AbortController().signal };
  const claim = async message => { for (const handler of ctx.监听.filter(row => row.事件 === 'agent/inbox/claimed')) await handler.做({ agent, message }); };
  await claim({ role: 'user', content: '生成房子' });
  await draw.execute({ 正向: 'red house' }, context);
  await claim({ role: 'user', content: [{ type: 'tool-result', id: 'first' }] });
  let blocked;
  try { await draw.execute({ 正向: 'blue house' }, context); } catch (error) { blocked = error; }
  等(blocked?.code, 'BUSINESS_GENERATION_LIMIT');
  等(submissions, 1);
  await claim({ role: 'user', content: '再生成一次' });
  await draw.execute({ 正向: 'green house' }, context);
  等(submissions, 2);
});

判('DSH 生图错误只把一般结果交给模型，Comfy 节点诊断不进入工具回执', async () => {
  const { ctx, 出 } = await 装一次();
  出.门面.comfy = { run: async action => {
    if (action === '生成设置') return { ok: true, data: { 每轮张数: 1, 最多轮数: 2, 自动迭代: true } };
    if (action === '出图') return { ok: false, code: 'COMFY_PROMPT_REJECTED', reason: 'COMFY_PROMPT_REJECTED: KSampler sampler_name euler / custom_sampler', details: { node_errors: { '3': { sampler_name: 'custom_sampler' } }, graph: { sampler_name: 'custom_sampler' } } };
  } };
  const draw = ctx.工具.find(row => row.name === 'drawing_generate');
  const agent = { session: { id: 'native-comfy-error' } };
  const claim = async () => { for (const handler of ctx.监听.filter(row => row.事件 === 'agent/inbox/claimed')) await handler.做({ agent, message: { role: 'user', content: '生成' } }); };
  await claim();
  let failure;
  try { await draw.execute({ 正向: 'red house' }, { agent, signal: new AbortController().signal }); }
  catch (error) { failure = error; }
  等(failure?.code, 'COMFY_PROMPT_REJECTED');
  等(failure?.reason, 'COMFY_PROMPT_REJECTED: 生图无法完成');
  真(!JSON.stringify(failure?.业务回执).includes('custom_sampler'), '业务回执不含可选采样参数或工作流诊断');
});

// ---------- 跑 ----------
const 过滤 = process.argv[2] || '';
let 过 = 0;
let 败 = 0;
for (const 一 of 条) {
  if (过滤 && !一.标题.includes(过滤)) continue;
  try {
    await 一.做();
    过++;
    console.log(`  ok   ${一.标题}`);
  } catch (error) {
    败++;
    console.log(`  FAIL ${一.标题}`);
    console.log(`       ${(error && error.message) || error}`);
  }
}
console.log(`\n${过} 过 / ${败} 失败`);
process.exit(败 === 0 ? 0 : 1);
