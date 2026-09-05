'use strict';

const TOOL_NAMES = Object.freeze([
  'tags.search',
  'conversation.listImages',
  'vision.processOne',
  'translation.translate',
  'agent.generateTags',
  'comfy.status',
  'comfy.validateWorkflow',
  'comfy.render'
]);

function text(value, fallback = '') { const result = value == null ? '' : String(value).trim(); return result || fallback; }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}
function schema(properties, required = []) { return { type: 'object', additionalProperties: false, properties, required }; }
function settingsGroup(settings, key) { return object(settings?.[key]) ? settings[key] : settings || {}; }
function positiveTags(args) { return Array.isArray(args?.positiveTags) ? args.positiveTags.map(text).filter(Boolean) : text(args?.positiveTags); }
function negativeTags(args) { return Array.isArray(args?.negativeTags) ? args.negativeTags.map(text).filter(Boolean) : text(args?.negativeTags || args?.negative); }

const DEFINITIONS = Object.freeze({
  'tags.search': { description: '查询标签库，返回公开的标签匹配结果。', parameters: schema({ query: { type: 'string' }, category: { type: 'string' }, includeAdult: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, ['query']) },
  'conversation.listImages': { description: '读取当前会话关联的图片引用和元数据。', parameters: schema({ includePending: { type: 'boolean' }, includeDeleted: { type: 'boolean' } }) },
  'vision.processOne': { description: '对当前会话中的一张图片执行统一识图。', parameters: schema({ imageId: { type: 'string' }, mode: { type: 'string', enum: ['metadata', 'local', 'ai'] }, model: { type: 'string' }, instruction: { type: 'string' } }, ['imageId', 'mode']) },
  'translation.translate': { description: '调用固定翻译子代理翻译文本。', parameters: schema({ text: { type: 'string' }, direction: { type: 'string', enum: ['auto', 'zh-en', 'en-zh'] }, includeAdult: { type: 'boolean' } }, ['text']) },
  'agent.generateTags': { description: '调用固定文生图 Tag 子代理生成正向 Tag。', parameters: schema({ requirements: { type: 'string' }, description: { type: 'string' }, imageId: { type: 'string' }, positiveTags: { type: 'array', items: { type: 'string' } }, referenceTags: { type: 'array', items: { type: 'string' } }, generateNegativeTags: { type: 'boolean' } }, ['requirements']) },
  'comfy.status': { description: '读取 ComfyUI 当前连接和工作流状态。', parameters: schema({}) },
  'comfy.validateWorkflow': { description: '检查当前 ComfyUI API 工作流是否有效。', parameters: schema({}) },
  'comfy.render': { description: '使用用户当前 ComfyUI 设置按 Tag 出图。绘图参数由设置提供。', parameters: schema({ positiveTags: { type: 'array', items: { type: 'string' } }, negativeTags: { type: 'array', items: { type: 'string' } } }, ['positiveTags']) }
});

function createPrimaryTools(options = {}) {
  const tags = options.tags || null;
  const imageRepository = options.imageRepository || options.imagesRepository || null;
  const runtime = options.runtime || null;
  const comfy = options.comfy || null;
  const getSettings = typeof options.getSettings === 'function' ? options.getSettings : () => ({});

  const callSubagent = (name, args, context) => {
    if (!runtime || typeof runtime.runSubAgent !== 'function') return { ok: false, error: { code: 'SUBAGENT_UNAVAILABLE', message: `${name} 子代理不可用` } };
    return runtime.runSubAgent(name, { input: clone(args), signal: context?.signal, requestId: context?.requestId, timeoutMs: context?.timeoutMs });
  };

  const handlers = {
    'tags.search': async (args = {}) => {
      if (!tags || typeof tags.search !== 'function') throw Object.assign(new Error('Tag 模块不可用'), { code: 'TOOL_UNAVAILABLE' });
      return { items: tags.search(text(args.query), { category: text(args.category), includeAdult: args.includeAdult === true, limit: Math.min(200, Math.max(1, Number(args.limit) || 50)) }) };
    },
    'conversation.listImages': async (args = {}, context = {}) => {
      const sessionId = text(context.sessionId);
      if (!sessionId) throw Object.assign(new Error('当前会话不可用'), { code: 'SESSION_REQUIRED' });
      if (!imageRepository || typeof imageRepository.listConversation !== 'function') throw Object.assign(new Error('图片仓库不可用'), { code: 'TOOL_UNAVAILABLE' });
      return imageRepository.listConversation(sessionId, { includePending: args.includePending !== false, includeDeleted: args.includeDeleted === true });
    },
    'vision.processOne': (args, context = {}) => callSubagent('vision', args, context),
    'translation.translate': (args, context = {}) => callSubagent('translation', args, context),
    'agent.generateTags': (args, context = {}) => callSubagent('generateTags', args, context),
    'comfy.status': async (_args = {}, context = {}) => {
      if (!comfy || typeof comfy.status !== 'function') throw Object.assign(new Error('ComfyUI 连接器不可用'), { code: 'TOOL_UNAVAILABLE' });
      const settings = settingsGroup(getSettings(), 'comfy');
      return comfy.status({ enabled: settings.enabled !== false && settings.comfyOn !== false, workflow: settings.workflow || settings.comfyWorkflow, signal: context.signal });
    },
    'comfy.validateWorkflow': async () => {
      const settings = settingsGroup(getSettings(), 'comfy');
      const workflow = settings.workflow || settings.comfyWorkflow || comfy?.workflow;
      if (typeof comfy?.workflowStatus === 'function') return comfy.workflowStatus(workflow);
      if (typeof comfy?.validateWorkflow === 'function') return comfy.validateWorkflow(workflow);
      return { ready: Boolean(workflow), error: workflow ? '' : '尚未设置 ComfyUI 工作流' };
    },
    'comfy.render': async (args = {}, context = {}) => {
      if (!comfy || typeof comfy.render !== 'function') throw Object.assign(new Error('ComfyUI 连接器不可用'), { code: 'TOOL_UNAVAILABLE' });
      const settings = settingsGroup(getSettings(), 'comfy');
      const positive = positiveTags(args);
      if (!positive || (Array.isArray(positive) && !positive.length)) throw Object.assign(new Error('至少需要一个正向 Tag'), { code: 'INVALID_INPUT' });
      const negative = negativeTags(args);
      const result = await comfy.render({
        prompt: Array.isArray(positive) ? positive.join(', ') : positive,
        negative: Array.isArray(negative) ? negative.join(', ') : negative,
        width: Number(settings.width || settings.comfyW) || 768,
        height: Number(settings.height || settings.comfyH) || 1024,
        steps: Number(settings.steps || settings.comfySteps) || 25,
        cfg: Number(settings.cfg ?? settings.comfyCfg) || 7,
        seed: settings.seed == null ? undefined : Number(settings.seed),
        sampler: text(settings.sampler || settings.comfySampler),
        scheduler: text(settings.scheduler || settings.comfyScheduler),
        batchCount: Math.max(1, Math.min(16, Number(settings.batchCount) || 1)),
        workflow: settings.workflow || settings.comfyWorkflow,
        signal: context.signal,
        onProgress: value => context.onEvent?.({ type: 'progress', tool: 'comfy.render', queue: value })
      });
      return { artifact: result?.artifact || result };
    }
  };

  const list = () => TOOL_NAMES.map(name => ({ name, ...clone(DEFINITIONS[name]) }));
  const openAiTools = () => list().map(item => ({ type: 'function', function: { name: item.name, description: item.description, parameters: item.parameters } }));
  const resolve = name => TOOL_NAMES.includes(name) ? { name, ...DEFINITIONS[name], handler: handlers[name] } : null;
  const call = async (name, args = {}, context = {}) => {
    const tool = resolve(name);
    if (!tool) return { ok: false, error: { code: 'TOOL_UNAVAILABLE', message: `工具不可用：${text(name)}` } };
    try {
      const value = await tool.handler(clone(args), context);
      if (value?.ok === false && value.error) return value;
      // Runtime subagents already return the standard {ok, data} envelope;
      // keep one envelope at the public tool boundary instead of nesting it.
      if (value?.ok === true && Object.prototype.hasOwnProperty.call(value, 'data')) return { ok: true, data: value.data };
      return { ok: true, data: value };
    } catch (cause) {
      return { ok: false, error: { code: cause?.code || 'TOOL_FAILED', message: text(cause?.message, '工具调用失败'), retryable: false } };
    }
  };
  return Object.freeze({ names: () => TOOL_NAMES.slice(), list, schemas: list, openAiTools, resolve, call, has: name => TOOL_NAMES.includes(name) });
}

module.exports = { TOOL_NAMES, DEFINITIONS, createPrimaryTools };
