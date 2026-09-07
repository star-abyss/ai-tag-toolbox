'use strict';

const DEFAULT_PRIMARY_PROMPT = '你是 AI 绘画 Tag 工具箱的主 AI。绘图或复刻调用 generation.execute；程序负责 Tag、ComfyUI、评价与迭代。图片只能通过消息提供的真实 imageId 或会话图片工具读取。';
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
    const generationContract = '【系统强制调度协议｜优先于上方可编辑内容】绘图、出图和图片复刻只调用 generation.execute；暂停任务只调用 generation.resume。绘图任务禁止提前调用 vision.processOne，禁止根据识图结果改写源图事实；把用户原始要求原样放入 originalRequirements，只附加真实 sourceImageId 和已确认 characterIds。不要调用或要求调用 agent.generateTags、comfy.validateWorkflow、comfy.render，这些是程序内部工具。程序负责识图、Tag 编译、ComfyUI、候选评价、修订和选择。不要输出逐步进度，直接根据高层工具结果与用户对话。';
    const characterContract = options.charactersEnabled
      ? '角色调度补充：用户提到角色名称时先调用 tags.search；命中角色时读取 attachedData，其中包含姓名、作品身份 Tag 和外貌 Tag；有多个候选时再调用 characters.search 确认。任何不确定的 Tag 先调用 tags.search。绘图时把已确认的 characterIds 与用户要求一并传给 generation.execute，程序会交给文生图 Tag 子代理筛选，主 AI 不自行筛选角色外貌。'
      : '';
    return [prompt, generationContract, characterContract].filter(Boolean).join('\n\n');
  }
  async function complete(messages, request = {}) {
    const config = { ...publicRequestConfig(options.getSettings?.()?.primaryApi), ...publicRequestConfig(request) };
    for (const key of RUNTIME_CONFIG_KEYS) if (Object.prototype.hasOwnProperty.call(request, key)) config[key] = request[key];
    return client.complete(messages, config);
  }
  return Object.freeze({ complete, getPrompt });
}

module.exports = { createPrimaryAgent, publicRequestConfig, DEFAULT_PRIMARY_PROMPT };
