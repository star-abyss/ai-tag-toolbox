// 世界书：把「请求 + 文本」交给世界书模块，拿回带落点的条目。
//
// 模块那边一件事都不判断：给它请求名与文本，它按自己那份启用列表挑出命中的条目，
// 落点原样交回来。启用什么就发送什么；一本都没启用就交回空。
//
// 落点怎么落：
//   前 / 后      系统提示词里各占一段
//   按深度       每轮一条 user 消息，贴在这次输入之前
//   其余落点     本层不认，原样忽略

/** 一次取用的结果。 */
const 空 = () => ({ 前: '', 后: '', 按深度: '' });

/**
 * 取一次命中，按落点分堆。
 * @param {object} 参数
 *   ctx       对接层挂在 ctx 上的那些东西（`ctx.toolbox.门面.worldbook`）
 *   请求      请求名
 *   文本      用来筛条目的文本
 * @returns {{前:string, 后:string, 按深度:string}}
 */
export function 取命中({ ctx, 请求, 文本 }) {
  const 出 = 空();
  const 世界书 = ctx && ctx.toolbox && ctx.toolbox.门面 && ctx.toolbox.门面.worldbook;
  if (!世界书 || !请求) return 出;

  // 命中的条目按落点分堆；同一堆里按模块给的次序，用空行接起来。
  const 回执 = 世界书.run('执行', { 请求, 文本: 文本 || '' });
  if (!回执.ok) throw new Error(回执.reason);
  const 结果 = 回执.data;
  const 命中 = 结果 && Array.isArray(结果.命中) ? 结果.命中 : [];
  if (!命中.length) return 出;

  const 堆 = { 前: [], 后: [], 按深度: [] };
  for (const 一 of 命中) {
    const 落点 = 一 && typeof 一.落点 === 'string' ? 一.落点.trim() : '前';
    if (!Object.prototype.hasOwnProperty.call(堆, 落点)) continue;
    if (typeof 一.文本 === 'string' && 一.文本) 堆[落点].push(一.文本);
  }

  for (const 名 of Object.keys(堆)) 出[名] = 堆[名].join('\n\n');
  return 出;
}

/**
 * 一条消息里有没有用户自己说的话。
 * 按深度那条消息只跟着"用户这次的话"走，不跟着每一步的工具回执走。
 * @param {object} 消息
 * @returns {boolean}
 */
export function 有用户的话(消息) {
  const 角色 = 消息 && 消息.role;
  if (角色 !== 'user') return false;
  const 内容 = 消息.content;
  if (typeof 内容 === 'string') return 内容.trim().length > 0;
  if (!Array.isArray(内容)) return false;
  // 工具结果也走 user 角色，靠块的 type 分开。
  const 块 = 内容.filter((一) => 一 && (一.type === 'text' || 一.type === 'image'));
  return 块.length > 0;
}
