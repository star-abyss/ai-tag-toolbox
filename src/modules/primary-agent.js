'use strict';

const DEFAULT_PRIMARY_PROMPT = '你是 AI 绘画 Tag 工具箱的主 AI。根据用户要求使用固定工具完成查询、识图、翻译、Tag 生成和 ComfyUI 出图。图片只能通过消息提供的真实 imageId 或会话图片工具读取。';
const PUBLIC_CONFIG_KEYS = Object.freeze(['base', 'model', 'key', 'temperature', 'timeoutMs', 'maxTokens', 'stream']);
const RUNTIME_CONFIG_KEYS = Object.freeze(['signal', 'tools', 'tool_choice', 'onDelta', 'onEvent']);
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function publicRequestConfig(value = {}) {
  if (!object(value)) return {};
  const result = {};
  for (const key of PUBLIC_CONFIG_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const item = value[key];
    if (['base', 'model', 'key'].includes(key) && typeof item === 'string') result[key] = item.trim();
    else if (key === 'stream' && typeof item === 'boolean') result[key] = item;
    else if (['temperature', 'timeoutMs', 'maxTokens'].includes(key) && item != null && item !== '' && Number.isFinite(Number(item))) result[key] = Number(item);
  }
  return result;
}
function userText(request = {}) {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!object(message) || message.role !== 'user') continue;
    if (typeof message.content === 'string' && message.content.trim()) return message.content;
    if (Array.isArray(message.content)) {
      const parts = message.content
        .filter(part => part && (part.type === 'text' || typeof part.text === 'string'))
        .map(part => (typeof part.text === 'string' ? part.text : ''))
        .filter(Boolean);
      const combined = parts.join('\n').trim();
      if (combined) return combined;
    }
  }
  return typeof request.input?.text === 'string' ? request.input.text.trim() : '';
}

function createPrimaryAgent(options = {}) {
  const client = options.client;
  const prompts = options.prompts;
  function getPrompt(request = {}) {
    const prompt = typeof prompts?.composePrimary === 'function' ? prompts.composePrimary(userText(request)) : prompts?.getEffective?.('primary') || prompts?.get?.('primary') || DEFAULT_PRIMARY_PROMPT;
    if (!options.charactersEnabled) return prompt;
    return prompt + '\n\n角色查询协议：提到具体角色时先调用 characters.search，按中英文名、别名或作品确定 ID；有歧义先确认，不把相似角色自动合并。文生图调用 agent.generateTags 时传入已确认的 characterIds，系统会展开角色资料。通用和专用特征均为可选参考，用户明确指定的外貌、服装和人数优先。隐藏专用词只经角色资料返回。';
  }
  async function complete(messages, request = {}) {
    const config = { ...publicRequestConfig(options.getSettings?.()?.primaryApi), ...publicRequestConfig(request) };
    for (const key of RUNTIME_CONFIG_KEYS) if (Object.prototype.hasOwnProperty.call(request, key)) config[key] = request[key];
    return client.complete(messages, config);
  }
  return Object.freeze({ complete, getPrompt });
}

module.exports = { createPrimaryAgent, publicRequestConfig, DEFAULT_PRIMARY_PROMPT };
