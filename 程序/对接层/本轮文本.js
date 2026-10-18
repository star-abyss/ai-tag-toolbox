// 记住本轮文本：世界书命中扫描用的那段文本。
//
// `agent/inbox/claimed` 在本步组装之前发出，所以挂在这个事件上记下来的，
// 是组装那一刻已经确定、但还没落盘的那一批消息。
//
// 按 agent 分桶：一个进程里可能同时跑几个 agent，各记各的。

/** 一句话都没说过的 agent，取出来是空串。 */
const 桶 = new WeakMap();

/** 一条消息里的文本。 */
function 取文本(消息) {
  const 内容 = 消息 && 消息.content;
  if (typeof 内容 === 'string') return 内容;
  if (!Array.isArray(内容)) return '';
  return 内容
    .filter((块) => 块 && 块.type === 'text' && typeof 块.text === 'string')
    .map((块) => 块.text)
    .join('\n');
}

/**
 * 挂上监听。
 * @param {object} ctx DSH 的上下文
 * @returns {Function} (agent) → 本轮批次拼起来的文本
 */
export function 造本轮文本(ctx) {
  ctx.on('agent/inbox/claimed', (载荷) => {
    const agent = 载荷 && 载荷.agent;
    if (!agent) return;
    const 一段 = 取文本(载荷.message);
    if (!一段) return;
    const 旧的 = 桶.get(agent);
    桶.set(agent, 旧的 ? `${旧的}\n${一段}` : 一段);
  });

  ctx.on('agent/inbox/inserted', (载荷) => {
    // 新的一批进来：上一批的文本不再代表本轮，清掉等 claim 重新记。
    const agent = 载荷 && 载荷.agent;
    if (agent) 桶.delete(agent);
  });

  return function 本轮文本(agent) {
    return (agent && 桶.get(agent)) || '';
  };
}
