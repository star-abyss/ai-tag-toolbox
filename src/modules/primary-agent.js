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
    const generationContract = '【系统强制调度协议｜优先于上方可编辑内容】绘图、出图和图片复刻只调用 generation.execute；暂停任务只调用 generation.resume。绘图任务禁止提前调用 vision.processOne，禁止根据识图结果改写源图事实；把用户原始要求原样放入 originalRequirements，只附加真实 sourceImageId 和已确认 characterIds。若生成工具返回 needs_input 且 needsInput.kind=character，等待用户在角色选择卡片中确认；程序用原 jobId 恢复。不要调用或要求调用 agent.generateTags、comfy.validateWorkflow、comfy.render，这些是程序内部工具。程序负责识图、Tag 编译、ComfyUI、候选评价、修订和选择。交付时服从 outcome 与 recreationMode：best_available 必须说明是达到上限后的最佳候选，text_approximation 必须说明原图未进入工作流、仅为文本近似复刻，禁止声称完全一致或保持不变；user_selected_with_issues 必须说明用户已选择且仍有已知问题。不要输出逐步进度，直接根据高层工具结果与用户对话。';
    const characterContract = options.charactersEnabled
      ? '角色调度补充：只有用户要求绘制已有作品中的具体角色时，才先调用 tags.search；命中角色时读取 attachedData，其中包含姓名、作品身份 Tag 和外貌 Tag；有多个候选时再调用 characters.search；仍不明确时将角色原名放入 generation.execute 的 characterQueries，程序会展示选择卡片。原创人物、OC、自设名称、普通人物或外貌描述无需查询或确认角色，直接将原始要求交给 generation.execute，不为这些人物填写 characterQueries 或 characterIds。混合画面只为明确指定的已有作品角色填写角色字段。用户在角色确认时明确表示是原创或跳过此人物时，用原 jobId 调用 generation.resume，characterSelection 原样填写 needsInput.query，并传 original=true，不传 characterId；也可点击卡片中的“这是原创人物，继续”。任何不确定的 Tag 先调用 tags.search。作品名不要放入 characterQueries。绘图时把已确认的 characterIds 与用户要求一并传给 generation.execute，程序会交给文生图 Tag 子代理筛选，主 AI 不自行筛选角色外貌。'
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
