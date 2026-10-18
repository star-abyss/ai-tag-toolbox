// 模型引擎 · 看图。把一张图交给模型看，要标签与描述。
//
// 它做三件机械的事：
//   ① 把字节编成 data URL（模型那边要的是这个形状）
//   ② 把"提示 + 参考标签"拼成一句话
//   ③ 交给调度发出去，把回来的文字收成 { 标签, 描述 }
//
// 提示词住世界书（请求 `识图` 那份），由装配层取好递进来；这里只负责拼与发。
// 它按每次调用现取：世界书模块要等七个模块都装好才在门面里，构造时取不到。

/**
 * 造一个"看图"函数：装配层递进识图模块的那一支。
 * @param {object} 参数
 *   调度      对接层的调度（{ 请求 }）
 *   请求名    走哪一条请求（默认 `识图`）
 *   提示词    系统提示词：一段文本，或一个每次调用现取的回调；没有就不带 system
 */
export function 造看图({ 调度, 请求名 = '识图', 提示词 = '' }) {
  return async function 看图({ 字节, mime, 提示, 参考标签 }) {
    const 类型 = typeof mime === 'string' && mime.startsWith('image/') ? mime : 'image/png';
    const 数据 = Buffer.from(字节).toString('base64');
    const 参考 = Array.isArray(参考标签) ? 参考标签.filter(Boolean) : [];
    const 系统 = typeof 提示词 === 'function' ? 提示词() : 提示词;

    const 话 = [
      '看这张图。',
      提示 ? `要求：${提示}` : '',
      参考.length ? `本地模型已经打出来的标签（可以参考，也可以不采信）：${参考.join(', ')}` : '',
      '请按 JSON 返回：{"tags":["可见的英文 Tag"],"description":"精炼的可见内容描述","hasBuiltinTags":false}。只输出 JSON。',
    ].filter(Boolean).join('\n');

    const 消息 = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 话 },
          { type: 'image', data: 数据, mimeType: 类型 },
        ],
      },
    ];

    const 回 = await 调度.请求({
      请求: 请求名,
      messages: 消息,
      ...(系统 ? { system: 系统 } : {}),
    });

    const 正文 = String((回 && 回.正文) || '');
    const 结果 = JSON.parse(正文);
    return {
      标签: Array.isArray(结果.tags) ? [...结果.tags] : [],
      描述: typeof 结果.description === 'string' ? 结果.description : '',
      模型: (回 && 回.用的谁 && 回.用的谁.model) || null,
      用量: (回 && 回.用量) || null,
    };
  };
}
