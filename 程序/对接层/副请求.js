import { 组系统素材 } from './发送素材.js';

/** 按请求的本次文本读取世界书，将命中内容交给模型发送函数。 */
export function 造副请求({ 取世界书, 发送 }) {
  return async function 副请求({ 请求, messages = [], system = '', ...参数 }) {
    const text = messages.flatMap(row => typeof row.content === 'string'
      ? [row.content]
      : (row.content || []).filter(part => part.type === 'text').map(part => part.text)).join('\n');
    const result = await 取世界书().run('执行', { 请求, 文本: text });
    if (!result.ok) throw Object.assign(new Error(result.reason), result);
    const materials = 组系统素材({ 命中: result.data.命中 });
    return await 发送({
      ...参数, 请求,
      system: [system, materials.系统消息].filter(Boolean).join('\n\n'),
      messages: materials.深度消息 ? [{ role: 'user', content: materials.深度消息 }, ...messages] : messages,
    });
  };
}
