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
    return prompt + '\n\n调度协议：用户提到角色名称时先调用 tags.search；命中角色时读取返回的 attachedData，其中包含姓名/作品身份 Tag 和外貌 Tag；有多个候选时再调用 characters.search 确认。任何不确定的 Tag 先调用 tags.search。主 AI 只负责查询、确认、与用户沟通和调度；调用 agent.generateTags 时传入已确认的 characterIds，程序会把对应的姓名/作品身份 Tag 和外貌 Tag 自动交给文生图子代理，由子代理负责筛选。';
  }
  async function complete(messages, request = {}) {
    const config = { ...publicRequestConfig(options.getSettings?.()?.primaryApi), ...publicRequestConfig(request) };
    for (const key of RUNTIME_CONFIG_KEYS) if (Object.prototype.hasOwnProperty.call(request, key)) config[key] = request[key];
    return client.complete(messages, config);
  }
  return Object.freeze({ complete, getPrompt });
}

module.exports = { createPrimaryAgent, publicRequestConfig, DEFAULT_PRIMARY_PROMPT };
