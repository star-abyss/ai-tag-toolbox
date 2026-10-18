// 调度那一小块：查路由 → 调模型 → 归类失败 → 交回带「用的谁」的回执。
//
// 池里的每一条只写**一个已注册的路由名**与它的模型候选；地址与密钥住 DSH 那边。
// 路由表里那一行：没写 = 跟随主 AI（provider 留空，由 DSH 的 agent 默认模型决定）；
// 写了但池里没有这一条 = 失败，不回落。

/** 本层的错误码。 */
export const ERR = Object.freeze({
  NO_SUCH_ROUTE: 'DISPATCH_NO_SUCH_ROUTE',
  NO_SUCH_POOL: 'DISPATCH_NO_SUCH_POOL',
  MODEL_NOT_IN_POOL: 'DISPATCH_MODEL_NOT_IN_POOL',
  NO_TEXT: 'DISPATCH_NO_TEXT',
  BAD_ANSWER: 'DISPATCH_BAD_ANSWER',
});

/** `码: 人话`。 */
export const 失败 = (码, 话) => {
  const 错 = new Error(`${码}: ${话}`);
  错.code = 码;
  return 错;
};

/**
 * @param {object} 参数
 *   ctx      DSH 的上下文（要用 ctx.llm）
 *   池       { <池条目名>: { 路由, 模型: [模型名…] } }
 *   路由     { <请求名>: { 走?, 模型? } }
 *   主AI请求 哪个请求算主 AI（"没写就跟随它"里的那个"它"）
 */
export function createDispatcher({ ctx, 池 = {}, 路由 = {}, 主AI请求 = '主AI' }) {
  /** 这次该用哪条路由哪个模型。`跟随` 说这次是不是跟着主 AI 走。 */
  function 查路由(请求) {
    const 这一行 = 路由[请求];
    const 走 = 这一行 && typeof 这一行.走 === 'string' ? 这一行.走.trim() : '';
    const 要的模型 = 这一行 && typeof 这一行.模型 === 'string' ? 这一行.模型.trim() : '';

    // 没写 → 跟随主 AI：provider 留空，交给 DSH 的 agent 默认模型。
    if (!走) return { 请求, 跟随: true, provider: undefined, model: 要的模型 || undefined, 用的谁: { provider: '(跟随主 AI)', model: 要的模型 || '(主 AI 的)' } };

    const 条目 = 池[走];
    if (!条目) throw 失败(ERR.NO_SUCH_POOL, `路由表里「${请求}」指向池里的「${走}」，池里没有这一条`);
    const 路由名 = typeof 条目.路由 === 'string' ? 条目.路由.trim() : '';
    if (!路由名) throw 失败(ERR.NO_SUCH_ROUTE, `池里的「${走}」没写路由名`);

    const 候选 = Array.isArray(条目.模型) ? 条目.模型 : [];
    const 模型 = 要的模型 || (候选.length ? 候选[0] : '');
    if (要的模型 && 候选.length && !候选.includes(要的模型)) {
      throw 失败(ERR.MODEL_NOT_IN_POOL, `池里的「${走}」没有模型「${要的模型}」（它有：${候选.join(' / ')}）`);
    }
    if (!模型) throw 失败(ERR.NO_SUCH_ROUTE, `池里的「${走}」没写模型，路由表那一行也没写`);

    return { 请求, 跟随: false, provider: 路由名, model: 模型, 用的谁: { provider: 路由名, model: 模型 } };
  }

  /**
   * 发一次。messages 是 DSH 的形状：`[{ role:'user', content:[{type:'text',text}] }]`。
   * @returns { 正文, 用量, 用的谁, 停在哪 }
   */
  async function 请求({ 请求: 请求名, messages, system, 温度, 上限, 信号 }) {
    const 谁 = 查路由(请求名 || 主AI请求);
    const 选项 = {
      messages,
      signal: 信号,
    };
    if (typeof system === 'string' && system) 选项.system = system;
    if (谁.provider) 选项.provider = 谁.provider;
    if (谁.model) 选项.model = 谁.model;
    if (温度 !== undefined) 选项.temperature = 温度;
    if (上限 !== undefined) 选项.maxTokens = 上限;

    let 正文 = '';
    let 用量 = null;
    let 停在哪 = null;
    for await (const 块 of ctx.llm.stream(选项)) {
      if (块.type === 'text-delta') 正文 += 块.text;
      else if (块.type === 'usage') 用量 = 块.usage;
      else if (块.type === 'finish') 停在哪 = 块.reason && 块.reason.kind;
    }
    if (停在哪 === 'error') throw 失败(ERR.NO_TEXT, `模型那边出错了（${谁.用的谁.provider} / ${谁.用的谁.model}）`);

    return { 正文, 用量, 用的谁: 谁.用的谁, 停在哪 };
  }

  return { 请求, 查路由 };
}

/**
 * 装订模块的 `AI翻译` 端口：报文进去，键值对出来。
 * 报文形状见 装订模块/port.js：`{ source, words, from, to }`。
 */
export function 造翻译({ 调度, 请求名, 信号 }) {
  return async function AI翻译(报文) {
    const 喂 = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `把下面这些词从${报文.from}翻成${报文.to}。`,
                '只回一个 JSON 对象：键是原文的词，值是译文。不要解释、不要加别的字。',
                '',
                JSON.stringify({ words: 报文.words }),
              ].join('\n'),
            },
          ],
        },
      ],
      信号,
    };
    const 回 = await 调度.请求({ 请求: 请求名, ...喂 });
    const 键值 = 抠JSON(回.正文);
    if (键值 === null) throw 失败(ERR.BAD_ANSWER, `翻译的模型没回一个 JSON 对象：${回.正文.slice(0, 200)}`);
    return 键值;
  };
}

/** 从一段文本里抠出第一个 JSON 对象。抠不出来给 null。 */
function 抠JSON(文本) {
  const 一 = String(文本 || '').indexOf('{');
  const 二 = String(文本 || '').lastIndexOf('}');
  if (一 < 0 || 二 <= 一) return null;
  try {
    const 出 = JSON.parse(文本.slice(一, 二 + 1));
    return 出 && typeof 出 === 'object' && !Array.isArray(出) ? 出 : null;
  } catch (_) {
    return null;
  }
}
