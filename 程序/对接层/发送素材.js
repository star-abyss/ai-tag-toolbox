import { 工具声明, 模型工具 } from './工具定义.js';

/** 本轮世界书与程序附加说明进入系统消息的分段。 */
export function 组系统素材({ 命中 = [], 图片说明 = '' } = {}) {
  const 按深度追加 = 命中.filter(条目 => 条目.落点 === '按深度');
  const 系统分段 = [
    ...命中.filter(条目 => 条目.落点 === '前').map(条目 => 条目.文本),
    ...命中.filter(条目 => 条目.落点 === '后').map(条目 => 条目.文本),
    图片说明,
  ].filter(Boolean);
  return {
    系统分段,
    系统消息: 系统分段.join('\n\n'),
    按深度追加: structuredClone(按深度追加),
    深度消息: 按深度追加.map(条目 => 条目.文本).join('\n\n'),
  };
}

/** 已启用的业务工具行同时生成执行侧定义与服务商工具声明。 */
export function 组工具素材(工具表 = [], 可执行工具表 = []) {
  const 可执行名字 = new Set(可执行工具表.map(条目 => 条目.名字));
  const 名字们 = new Set();
  const 定义行 = [];
  for (const 条目 of 工具表) {
    const 名字 = String(条目?.名字 || '');
    if (!可执行名字.has(名字)) {
      return { ok: false, code: 'TOOL_BAD_TOOL_NAME', reason: `TOOL_BAD_TOOL_NAME: 主 AI 预设启用了未知绘画工具 ${名字}` };
    }
    if (名字们.has(名字)) {
      return { ok: false, code: 'TOOL_BAD_TOOL_NAME', reason: `TOOL_BAD_TOOL_NAME: 主 AI 预设重复启用了绘画工具 ${名字}` };
    }
    名字们.add(名字);
    定义行.push({ name: 名字, schema: 工具声明(条目) });
  }
  return {
    ok: true,
    工具表: structuredClone(工具表),
    定义行,
    工具定义: 定义行.map(条目 => 模型工具(条目.schema)),
  };
}

/** 给预览用的消息副本：图片字节变成可读占位，不把 base64 带到界面。 */
export function 显示消息(messages = []) {
  function 图片占位(part) {
    if (part?.type === 'image') {
      const data = String(part.data || '');
      return { type: 'text', text: `[图片内容占位：${part.mimeType || 'image'}，${base64字节数(data)} 字节]` };
    }
    const url = String(part?.image_url?.url || '');
    const found = /^data:([^;,]+);base64,(.*)$/s.exec(url);
    return found
      ? { type: 'text', text: `[图片内容占位：${found[1]}，${base64字节数(found[2])} 字节]` }
      : { type: 'text', text: '[图片内容占位：image_url]' };
  }
  return messages.map(message => ({
    ...message,
    ...(Array.isArray(message.content) ? {
      content: message.content.map(part => part?.type === 'image' || part?.type === 'image_url'
        ? 图片占位(part)
        : structuredClone(part)),
    } : {}),
  }));
}

function base64字节数(value) {
  const text = String(value || '');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(text.length * 3 / 4) - padding);
}
