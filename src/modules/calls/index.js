'use strict';

const { createToolRegistry } = require('./registry');
const { createCallServer } = require('./server');
const { createVisionService } = require('../vision-service');

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).trim();
  return result || fallback;
}

function list(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function clone(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function number(value, fallback) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

const RUNTIME_TOOL_NAMES = Object.freeze(['tags.search', 'vision.processOne', 'comfy.render']);
const AGENT_RUNTIME_TOOL_NAMES = Object.freeze([
  'tags.search', 'vision.processOne', 'comfy.render',
  'prompts.list', 'prompts.read', 'settings.comfy.get',
  'tags.describe', 'assets.listModels',
  'comfy.submit', 'comfy.getResult', 'comfy.objectInfo', 'comfy.cancel', 'comfy.getImage'
]);
const AGENT_ADMIN_TOOL_NAMES = Object.freeze([
  'settings.comfy.update', 'settings.comfy.setIterations',
  'prompts.create', 'prompts.update', 'prompts.delete', 'prompts.enable', 'prompts.reset'
]);

function imageUrl(value) {
  if (typeof value === 'string') return value;
  return text(value && (value.dataUrl || value.url || value.src || value.previewUrl || value.viewUrl));
}

function artifact(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    id: text(value.id || value.artifactId || value.promptId),
    filename: text(value.filename || value.name),
    path: text(value.path || value.filePath),
    viewUrl: text(value.viewUrl || value.url),
    dataUrl: text(value.dataUrl),
    mime: text(value.mime || value.contentType, 'image/png'),
    width: Number(value.width) || 0,
    height: Number(value.height) || 0,
    prompt: text(value.prompt || value.promptText),
    negative: text(value.negative || value.negativePrompt)
  };
}

function comfySettingsSnapshot(settings = {}, comfy = null) {
  const workflowValue = settings.comfyWorkflow || comfy?.workflow || '';
  const workflow = typeof comfy?.workflowStatus === 'function'
    ? comfy.workflowStatus(workflowValue)
    : { ready: Boolean(workflowValue) };
  return {
    enabled: settings.comfyOn !== false,
    base: text(settings.comfyBase || comfy?.base, 'http://127.0.0.1:8188'),
    width: Number(settings.comfyW) || 768,
    height: Number(settings.comfyH) || 1024,
    steps: Number(settings.comfySteps) || 25,
    cfg: number(settings.comfyCfg, 7),
    negative: text(settings.comfyNeg),
    sampler: text(settings.comfySampler),
    scheduler: text(settings.comfyScheduler),
    iterations: Math.max(1, Math.min(10, Number(settings.comfyIters) || 3)),
    workflow: { configured: Boolean(workflowValue), ready: Boolean(workflow.ready), error: text(workflow.error) }
  };
}

function makeSchemas() {
  const object = (properties, required = []) => ({ type: 'object', properties, required });
  const visionProcessSchema = object({
    imageId: { type: 'string', description: '明确的一张图片真实 ID（例如 img_xxx）；不要传“图片1”等显示编号，一次调用只能处理这一张图片' },
    imagePath: { type: 'string', description: '可选：本地图片文件路径；传了之后自动登记为图片并识图，与 imageId 二选一' },
    mode: { type: 'string', enum: ['metadata', 'local', 'ai'], description: '识图方式：metadata、local 或 ai' },
    model: { type: 'string', description: 'local 模式可选的本地模型 ID' },
    instruction: { type: 'string', description: 'ai 模式本次临时附加要求，不会修改识图主提示词' }
  }, ['mode']);
  // Agent may provide a single local path; the handler registers it and still
  // resolves exactly one imageId before entering Vision. Keep the schema to a
  // broadly supported object/required subset for OpenAI-compatible endpoints.
  return {
    'tags.search': object({
      query: { type: 'string', description: '要查询的 Tag、中文名或别名' },
      category: { type: 'string', description: '可选分类 ID' },
      includeAdult: { type: 'boolean', description: '是否包含成人标签，默认 false' },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 }
    }, ['query']),
    'vision.processOne': visionProcessSchema,
    'comfy.render': object({
      prompt: { type: 'string', description: '正向英文绘图 Tag' },
      negative: { type: 'string', description: '负面英文 Tag' },
      width: { type: 'integer', minimum: 64 },
      height: { type: 'integer', minimum: 64 },
      steps: { type: 'integer', minimum: 1 },
      cfg: { type: 'number' },
      seed: { type: 'integer' },
      sampler: { type: 'string' },
      scheduler: { type: 'string' },
      workflow: { description: '可选 API 格式工作流；不传则使用当前设置' }
    }, ['prompt']),
    'comfy.check': object({}),
    'comfy.history': object({ limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }),
    'comfy.getImage': object({
      artifactId: { type: 'string' },
      filename: { type: 'string' },
      subfolder: { type: 'string' },
      type: { type: 'string', default: 'output' }
    }),
    'comfy.submit': object({
      workflow: { type: 'object', description: 'ComfyUI API 格式工作流（{节点id: {class_type, inputs}}）' },
      workflowText: { type: 'string', description: '工作流 JSON 文本；与 workflow 二选一' },
      wait: { type: 'boolean', description: 'true 时阻塞到执行完成并返回结果，false 只返回 promptId' },
      timeoutMs: { type: 'integer', minimum: 1000, description: 'wait 模式超时毫秒，默认 10 分钟' }
    }, ['workflow']),
    'comfy.getResult': object({
      promptId: { type: 'string', description: 'comfy.submit 返回的任务编号' },
      wait: { type: 'boolean', description: 'true 时阻塞到完成，false 只查询当前状态' },
      timeoutMs: { type: 'integer', minimum: 1000 }
    }, ['promptId']),
    'comfy.objectInfo': object({
      classPattern: { type: 'string', description: '可选正则片段，只返回包含该片段的节点类定义（如 KSampler、Loader）' }
    }),
    'comfy.cancel': object({
      mode: { type: 'string', enum: ['current', 'queue'], description: 'current=中断当前任务；queue=中断当前并清空待执行队列', default: 'current' }
    }),
    'tags.describe': object({
      text: { type: 'string', description: '要转成规范标签的中文描述或短语（可含多个词，内部自动拆分）' },
      includeAdult: { type: 'boolean', default: false },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 60 }
    }, ['text']),
    'assets.listModels': object({
      category: { type: 'string', description: '可选：只返回某一类模型（checkpoints / unet / clip / vae / loras / controlnet / embeddings 等）' }
    }),
    'prompts.list': object({ includeDisabled: { type: 'boolean', default: false } }),
    'prompts.read': object({ id: { type: 'string' }, version: { type: 'string', enum: ['effective', 'default'], default: 'effective' } }, ['id']),
    'prompts.compose': object({ mode: { type: 'string' }, extra: { type: 'string' } }),
    'prompts.create': object({ id: { type: 'string' }, name: { type: 'string' }, text: { type: 'string' } }, ['name', 'text']),
    'prompts.update': object({ id: { type: 'string' }, name: { type: 'string' }, text: { type: 'string' }, enabled: { type: 'boolean' } }, ['id']),
    'prompts.delete': object({ id: { type: 'string' } }, ['id']),
    'prompts.enable': object({ id: { type: 'string' }, enabled: { type: 'boolean' } }, ['id', 'enabled']),
    'prompts.reset': object({ id: { type: 'string' } }, ['id']),
    'settings.comfy.get': object({}),
    'settings.comfy.update': object({
      base: { type: 'string', description: 'ComfyUI 地址' },
      width: { type: 'integer', minimum: 64 },
      height: { type: 'integer', minimum: 64 },
      steps: { type: 'integer', minimum: 1 },
      cfg: { type: 'number', minimum: 0 },
      negative: { type: 'string' },
      sampler: { type: 'string' },
      scheduler: { type: 'string' },
      workflow: { description: '可选 API 格式工作流文本；是否允许修改由应用设置决定' },
      comfyOn: { type: 'boolean' }
    }),
    'settings.comfy.setIterations': object({ value: { type: 'integer', minimum: 1, maximum: 10 } }, ['value'])
  };
}

function createCalls(options = {}) {
  const tags = options.tags || null;
  const images = options.images || null;
  const comfy = options.comfy || null;
  const prompts = options.prompts || null;
  const visionAI = options.visionAI || options.visionAi || null;
  const getSettings = typeof options.getSettings === 'function' ? options.getSettings : () => ({});
  const setSettings = typeof options.setSettings === 'function' ? options.setSettings : () => ({});
  const getPrompt = typeof options.getPrompt === 'function'
    ? options.getPrompt
    : (id, version = 'effective') => {
        if (version === 'default' && typeof prompts?.getDefault === 'function') return prompts.getDefault(id);
        return prompts?.get?.(id, '') || '';
      };
  const visionService = options.visionService || createVisionService({
    images,
    localVision: options.localVision || options.vision,
    visionAI,
    getPrompt: id => getPrompt(id, 'effective')
  });
  const registry = createToolRegistry({ allowWrite: options.allowWrite === true });
  const schemas = makeSchemas();
  const add = (name, description, permission, handler, group = permission === 'write' ? 'admin' : 'runtime') => registry.register({ name, description, permission, group, inputSchema: schemas[name], handler });
  const capabilityTtlMs = Math.max(250, Number(options.capabilityTtlMs) || 1500);
  let capabilityState = {
    tags: Boolean(tags?.search),
    vision: visionService?.available?.() || { metadata: Boolean(images?.get), local: false, ai: false },
    comfy: { enabled: true, connected: false, workflowReady: false, render: false, error: '尚未检查 ComfyUI' }
  };
  let capabilityCheckedAt = 0;
  let capabilityPromise = null;

  function invalidateCapabilities() {
    capabilityCheckedAt = 0;
    capabilityPromise = null;
    return getCapabilities();
  }

  function getCapabilities() { return clone(capabilityState); }

  async function refreshCapabilities(refreshOptions = {}) {
    const force = refreshOptions.force === true;
    if (!force && capabilityPromise) return capabilityPromise;
    if (!force && capabilityCheckedAt && Date.now() - capabilityCheckedAt < capabilityTtlMs) return getCapabilities();
    capabilityPromise = (async () => {
      const settings = getSettings() || {};
      const enabled = settings.comfyOn !== false;
      const workflowValue = refreshOptions.workflow !== undefined
        ? refreshOptions.workflow
        : settings.comfyWorkflow || comfy?.workflow || '';
      if (settings.comfyBase && typeof comfy?.setBase === 'function') comfy.setBase(settings.comfyBase);
      if (workflowValue && typeof comfy?.setWorkflow === 'function') comfy.setWorkflow(workflowValue);
      let workflow = { ready: false, error: '尚未设置 ComfyUI 工作流' };
      try {
        workflow = typeof comfy?.workflowStatus === 'function'
          ? comfy.workflowStatus(workflowValue)
          : { ready: Boolean(workflowValue), error: workflowValue ? '' : '尚未设置 ComfyUI 工作流' };
      } catch (error) { workflow = { ready: false, error: error?.message || String(error) }; }
      let connected = false;
      // Connection status is independent from the user's render switch. A
      // disabled ComfyUI can still be connected, which lets the draw page
      // show an enable toggle without conflating "停用" and "未连接".
      let comfyStatus = null;
      if (typeof comfy?.status === 'function') {
        try { comfyStatus = await comfy.status({ enabled, workflow: workflowValue }); } catch { comfyStatus = null; }
      }
      if (comfyStatus) connected = Boolean(comfyStatus.connected);
      else if (typeof comfy?.check === 'function') {
        try { connected = Boolean(await comfy.check()); } catch { connected = false; }
      }
      const vision = typeof visionService?.available === 'function'
        ? visionService.available()
        : { metadata: Boolean(images?.get), local: false, ai: Boolean(visionAI?.complete) };
      capabilityState = {
        tags: Boolean(tags?.search),
        vision: clone(vision),
        comfy: {
          enabled,
          connected,
          workflowReady: comfyStatus ? Boolean(comfyStatus.workflowReady) : Boolean(workflow.ready),
          render: comfyStatus ? Boolean(comfyStatus.render) : Boolean(enabled && connected && workflow.ready),
          error: comfyStatus?.error || (!enabled
            ? 'ComfyUI 已停用 · 请在绘图模式左上角打开“ComfyUI 出图”'
            : !workflow.ready
              ? (workflow.error || 'ComfyUI 未就绪 · 请到「API 设置 → ComfyUI」上传或粘贴 API 格式工作流')
              : !connected
                ? 'ComfyUI 未连接 · 请确认 ComfyUI 已启动，并检查「API 设置 → ComfyUI 地址」'
                : '')
        }
      };
      capabilityCheckedAt = Date.now();
      capabilityPromise = null;
      return getCapabilities();
    })().catch(error => {
      capabilityPromise = null;
      capabilityCheckedAt = Date.now();
      capabilityState = {
        ...capabilityState,
        comfy: { ...capabilityState.comfy, connected: false, render: false, error: error?.message || String(error) }
      };
      return getCapabilities();
    });
    return capabilityPromise;
  }

  function accessOptions(refreshOptions = {}) {
    return {
      caller: text(refreshOptions.caller).toLowerCase(),
      allowWrite: refreshOptions.allowWrite === true,
      groups: refreshOptions.groups,
      includeInternal: refreshOptions.includeInternal === true
    };
  }

  function availableNames(names = null, filterOptions = {}) {
    const selected = Array.isArray(names) && names.length ? names : null;
    const source = selected || registry.list().map(item => item.name);
    return source.filter(name => name !== 'comfy.render' || capabilityState.comfy.render)
      .filter(name => registry.list([name], accessOptions(filterOptions)).length > 0);
  }

  async function listAvailable(names = null, refreshOptions = {}) {
    await refreshCapabilities(refreshOptions);
    const selected = availableNames(names, refreshOptions);
    return selected.length ? registry.list(selected, accessOptions(refreshOptions)) : [];
  }

  function agentNames(allowWrite = false) {
    return [...AGENT_RUNTIME_TOOL_NAMES, ...(allowWrite ? AGENT_ADMIN_TOOL_NAMES : [])];
  }

  async function listAgent(options = {}) {
    const allowWrite = options.allowWrite === true;
    return listAvailable(agentNames(allowWrite), { ...options, caller: 'external-agent', allowWrite });
  }

  async function schemasAvailable(names = null, refreshOptions = {}) {
    await refreshCapabilities(refreshOptions);
    const selected = availableNames(names, refreshOptions);
    return selected.length ? registry.schemas(selected, accessOptions(refreshOptions)) : [];
  }

  async function schemasAgent(options = {}) {
    const allowWrite = options.allowWrite === true;
    return schemasAvailable(agentNames(allowWrite), { ...options, caller: 'external-agent', allowWrite });
  }

  async function openAiToolsAvailable(names = null, refreshOptions = {}) {
    await refreshCapabilities(refreshOptions);
    const selected = availableNames(names, refreshOptions);
    if (!selected.length) return [];
    const tools = registry.openAiTools(selected, accessOptions(refreshOptions));
    if (refreshOptions.forAi !== true) return tools;
    return tools.map(tool => {
      if (tool.function?.name !== 'comfy_render') return tool;
      return {
        ...tool,
        function: {
          ...tool.function,
          description: '使用用户当前 ComfyUI 设置提交一次渲染；只传正向和可选负向 Tag。',
          parameters: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: '正向英文绘图 Tag' },
              negative: { type: 'string', description: '可选负面英文 Tag' }
            },
            required: ['prompt']
          }
        }
      };
    });
  }

  async function openAiToolsAgent(options = {}) {
    const allowWrite = options.allowWrite === true;
    return openAiToolsAvailable(agentNames(allowWrite), { ...options, caller: 'external-agent', allowWrite });
  }

  async function call(name, argumentsValue = {}, context = {}) {
    const resolved = registry.resolve(name)?.name || text(name);
    if (resolved === 'comfy.render') {
      const capabilities = await refreshCapabilities({ force: true, workflow: context.workflow });
      if (!capabilities.comfy.render) {
        return { ok: false, code: 'COMFY_UNAVAILABLE', error: capabilities.comfy.error || 'ComfyUI 当前不可用' };
      }
    }
    return registry.call(name, argumentsValue, context);
  }

  add('tags.search', '查询 Tag 库。返回的标签用于辅助参考，不代表必须全部使用。', 'read', async (args) => {
    if (!tags?.search) throw new Error('Tag 模块不可用');
    return { items: tags.search(text(args.query), { category: text(args.category), includeAdult: args.includeAdult === true, limit: Math.min(200, Math.max(1, Number(args.limit) || 50)) }) };
  });

  add('vision.processOne', '统一单图识图。一次只处理一个明确的 imageId；不接受 imageIds 数组。', 'read', async (args, context) => {
    if (!visionService?.processOne) throw new Error('单图识图服务不可用');
    let resolved = { ...args };
    const imageId = text(args.imageId);
    const imagePath = text(args.imagePath);
    if (!imageId && imagePath) {
      if (typeof images?.addFile !== 'function') throw new Error('当前图片模块不支持从文件路径登记图片');
      const row = await images.addFile(imagePath, { source: 'agent', filename: imagePath.split(/[\\/]/).pop() });
      const newId = text(row?.id ?? row?.imageId ?? row);
      if (!newId) throw new Error('无法从路径登记该图片，请确认文件存在且为支持的图片格式');
      resolved = { ...resolved, imageId: newId };
    } else if (!imageId && !imagePath) {
      throw new Error('需要提供 imageId 或 imagePath 之一');
    }
    return visionService.processOne({
      ...resolved,
      signal: context.signal,
      onDelta: context.onDelta,
      onEvent: context.onEvent,
      stream: context.stream
    });
  });

  add('comfy.render', '向 ComfyUI 提交一次渲染并返回图片 artifact。', 'read', async (args, context) => {
    if (!comfy?.render) throw new Error('ComfyUI 连接器不可用，请检查应用配置后重试');
    const settings = getSettings() || {};
    const actualPrompt = text(args.prompt);
    const actualNegative = text(args.negative || settings.comfyNeg);
    const result = await comfy.render({
      prompt: actualPrompt, negative: actualNegative,
      width: Number(args.width || settings.comfyW) || 768, height: Number(args.height || settings.comfyH) || 1024,
      w: Number(args.width || settings.comfyW) || 768, h: Number(args.height || settings.comfyH) || 1024,
      steps: Number(args.steps || settings.comfySteps) || 25, cfg: number(args.cfg ?? settings.comfyCfg, 7),
      seed: args.seed == null ? Math.floor(Math.random() * 1e9) : Number(args.seed), sampler: text(args.sampler || settings.comfySampler), scheduler: text(args.scheduler || settings.comfyScheduler),
      workflow: args.workflow || context.workflow || settings.comfyWorkflow, signal: context.signal,
      onProgress: value => context.onEvent?.({ type: 'progress', tool: 'comfy.render', queue: value })
    });
    let stored = result;
    if (images?.add && imageUrl(result)) {
      stored = images.add({ ...result, source: 'comfy', filename: result.filename || `comfy-${Date.now()}.png` }, { collection: 'comfy' }) || result;
    }
    return { artifact: artifact({ ...stored, prompt: actualPrompt, negative: actualNegative }) };
  });

  add('comfy.check', '检查 ComfyUI 是否可连接。', 'read', async () => ({ connected: Boolean(await comfy?.check?.()) }), 'internal');

  add('comfy.history', '读取 ComfyUI 最近的执行历史。', 'read', async (_args, context) => {
    if (!comfy?.list) throw new Error('ComfyUI 连接器不可用，请检查应用配置后重试');
    return { history: await comfy.list(Math.min(100, Math.max(1, Number(_args.limit) || 20)), context.signal) };
  }, 'internal');

  add('comfy.getImage', '根据 artifact 或 ComfyUI 文件名读取图片。', 'read', async (args) => {
    if (args.artifactId && images?.get) {
      const row = images.get(args.artifactId);
      if (row) return { artifact: artifact(row) };
    }
    if (!comfy?.fetchImage) throw new Error('ComfyUI 连接器不可用，请检查应用配置后重试');
    const result = await comfy.fetchImage({ filename: text(args.filename), subfolder: text(args.subfolder), type: text(args.type, 'output') });
    return { artifact: artifact(result) };
  }, 'runtime');

  add('prompts.list', '读取当前提示词列表。内置默认文本只读。', 'read', async (args) => {
    if (!prompts?.keys) throw new Error('提示词模块不可用');
    const includeDisabled = args.includeDisabled === true;
    const items = prompts.keys().map(id => prompts.item?.(id) || ({ id, text: getPrompt(id), defaultText: getPrompt(id, 'default'), enabled: true, builtin: true }));
    return { items: includeDisabled ? items : items.filter(item => item.enabled !== false) };
  });

  add('prompts.read', '读取指定提示词的当前值或内置默认值。', 'read', async (args) => ({ id: text(args.id), version: text(args.version, 'effective'), text: getPrompt(args.id, text(args.version, 'effective')) }));
  add('prompts.compose', '按模式组合提示词，并可附加本次临时文本。', 'read', async (args) => ({ text: prompts?.compose ? prompts.compose(text(args.mode, 'generate'), { extra: text(args.extra) }) : getPrompt(args.mode) }), 'internal');

  add('prompts.create', '新建自定义提示词。需要外部 Agent 编辑权限。', 'write', async (args) => {
    if (typeof prompts?.createCustom !== 'function') throw new Error('当前提示词模块尚未开放自定义提示词');
    return { item: prompts.createCustom({ id: text(args.id), name: text(args.name), text: text(args.text) }) };
  });
  add('prompts.update', '修改主提示词/识图主提示词的当前覆盖值或自定义提示词。内置默认文本不会改变。需要编辑权限。', 'write', async (args) => {
    if (typeof prompts?.update !== 'function') throw new Error('当前提示词模块尚未开放修改');
    const itemValue = prompts.update(args.id, { name: args.name, text: args.text, enabled: args.enabled });
    if (!itemValue) throw new Error('该内置提示词不允许修改，或提示词不存在');
    return { item: itemValue };
  });
  add('prompts.delete', '删除自定义提示词；内置提示词不可删除。需要编辑权限。', 'write', async (args) => {
    if (typeof prompts?.deleteCustom !== 'function') throw new Error('当前提示词模块尚未开放自定义提示词');
    const deleted = Boolean(prompts.deleteCustom(args.id));
    if (!deleted) throw new Error('内置提示词不可删除，或提示词不存在');
    return { deleted };
  });
  add('prompts.enable', '启用或停用提示词。内置提示词可停用但不可删除。需要编辑权限。', 'write', async (args) => {
    if (typeof prompts?.setEnabled !== 'function') throw new Error('当前提示词模块尚未开放启用状态管理');
    const itemValue = prompts.setEnabled(args.id, args.enabled === true);
    if (!itemValue) throw new Error('提示词不存在');
    return { item: itemValue };
  });
  add('prompts.reset', '恢复指定提示词的内置默认值并重新启用。需要编辑权限。', 'write', async (args) => {
    if (typeof prompts?.reset !== 'function') throw new Error('当前提示词模块尚未开放重置');
    const itemValue = prompts.reset(args.id);
    if (!itemValue) throw new Error('只有内置提示词可以重置');
    return { item: itemValue };
  });

  add('settings.comfy.get', '读取 ComfyUI 当前渲染设置（尺寸、步数、CFG、负面 Tag、迭代次数和工作流状态）。', 'read', async () => {
    return comfySettingsSnapshot(getSettings() || {}, comfy);
  });
  add('settings.comfy.update', '修改 ComfyUI 渲染设置。需要外部 Agent 编辑权限；未提供的字段保持不变。', 'write', async (args) => {
    const current = getSettings() || {};
    const patch = {};
    if (args.base != null) {
      const base = text(args.base);
      if (base && !/^https?:\/\//i.test(base)) throw new Error('ComfyUI 地址必须以 http:// 或 https:// 开头');
      patch.comfyBase = base;
      if (base) comfy?.setBase?.(base);
    }
    const integerField = (from, to, min, max) => {
      const key = from;
      if (args[key] == null || args[key] === '') return;
      const value = Math.round(Number(args[key]));
      if (!Number.isFinite(value)) throw new Error(`${key} 必须是数字`);
      patch[to] = Math.max(min, Math.min(max, value));
    };
    integerField('width', 'comfyW', 64, 8192); integerField('height', 'comfyH', 64, 8192); integerField('steps', 'comfySteps', 1, 200);
    if (args.cfg != null && args.cfg !== '') {
      const value = Number(args.cfg); if (!Number.isFinite(value)) throw new Error('cfg 必须是数字');
      patch.comfyCfg = Math.max(0, Math.min(50, value));
    }
    const textFields = [['negative', 'comfyNeg'], ['sampler', 'comfySampler'], ['scheduler', 'comfyScheduler']];
    textFields.forEach(([from, to]) => { if (args[from] != null) patch[to] = text(args[from]); });
    if (args.workflow != null) {
      const workflow = typeof args.workflow === 'string' ? text(args.workflow) : (args.workflow && typeof args.workflow === 'object' ? clone(args.workflow) : '');
      const status = typeof comfy?.workflowStatus === 'function' ? comfy.workflowStatus(workflow) : { ready: Boolean(workflow) };
      if (workflow && !status.ready) throw new Error(status.error || '工作流不是有效的 ComfyUI API 格式');
      patch.comfyWorkflow = workflow;
    }
    if (args.comfyOn != null) patch.comfyOn = args.comfyOn !== false;
    const updated = setSettings(patch) || { ...current, ...patch };
    if (patch.comfyWorkflow != null) comfy?.setWorkflow?.(patch.comfyWorkflow);
    return { settings: comfySettingsSnapshot(updated, comfy) };
  });
  add('settings.comfy.setIterations', '设置 ComfyUI 最大迭代次数。需要外部 Agent 编辑权限。', 'write', async (args) => {
    const requested = Number(args.value);
    if (!Number.isFinite(requested)) throw new Error('value 必须是 1–10 的整数');
    const value = Math.max(1, Math.min(10, Math.round(requested)));
    return { value: Number(getSettings()?.comfyIters) === value ? value : Number(setSettings({ comfyIters: value })?.comfyIters || value) };
  });

  // 外部 Agent 专属工具：运行时能力保持只读/可控，内部 UI 不展示这些扩展入口。
  add('comfy.submit', '向 ComfyUI 提交任意 API 格式工作流并返回任务编号（Agent 插件级入口）。', 'read', async (args, context) => {
    if (typeof comfy?.submitPrompt !== 'function') throw new Error('ComfyUI 连接器不可用，请检查应用配置后重试');
    const workflow = typeof args.workflow === 'object' && args.workflow
      ? args.workflow
      : args.workflowText
        ? text(args.workflowText)
        : null;
    if (!workflow) throw new Error('需要提供 workflow 对象或 workflowText');
    const promptId = await comfy.submitPrompt(workflow, context.signal);
    if (args.wait !== true) return { promptId, status: 'submitted' };
    const result = await comfy.result(promptId, { timeoutMs: Number(args.timeoutMs) || 10 * 60 * 1000, signal: context.signal });
    return { promptId, ...result };
  });

  add('comfy.getResult', '查询 ComfyUI 任务执行状态；wait=true 时阻塞到完成并返回输出文件清单。', 'read', async (args, context) => {
    if (typeof comfy?.result !== 'function') throw new Error('ComfyUI 连接器不可用，请检查应用配置后重试');
    return comfy.result(text(args.promptId), {
      wait: args.wait === true,
      timeoutMs: Number(args.timeoutMs) || 10 * 60 * 1000,
      signal: context.signal
    });
  });

  add('comfy.objectInfo', '读取 ComfyUI 节点定义（类名、输入输出 schema），用于了解可用节点与参数。', 'read', async (args, context) => {
    if (typeof comfy?.objectInfo !== 'function') throw new Error('ComfyUI 连接器不可用，请检查应用配置后重试');
    return comfy.objectInfo(text(args.classPattern), context.signal);
  });

  add('comfy.cancel', '中断当前 ComfyUI 任务，或同时清空待执行队列。', 'read', async (args, context) => {
    if (typeof comfy?.cancel !== 'function') throw new Error('ComfyUI 连接器不可用，请检查应用配置后重试');
    return comfy.cancel(text(args.mode, 'current'), context.signal);
  });

  add('tags.describe', '把中文描述/短语转换成规范绘图标签（内部按词拆分并去重）。', 'read', async (args) => {
    if (!tags?.search) throw new Error('Tag 模块不可用');
    const source = text(args.text);
    if (!source) throw new Error('需要提供 text');
    const includeAdult = args.includeAdult === true;
    const limit = Math.min(200, Math.max(1, Number(args.limit) || 60));
    const parts = source.split(/[\s,，、;；。.！!？?/\\|:：]+/).map(item => item.trim()).filter(Boolean);
    const seen = new Set();
    const items = [];
    const push = rows => {
      for (const item of rows || []) {
        const key = text(item?.id ?? item?.en ?? item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    };
    push(tags.search(source, { includeAdult, limit }));
    if (items.length < 8 && parts.length > 1) {
      for (const part of parts.slice(0, 6)) {
        push(tags.search(part, { includeAdult, limit: Math.max(4, Math.floor(limit / 2)) }));
        if (items.length >= limit) break;
      }
    }
    return { query: source, items: items.slice(0, limit) };
  });

  add('assets.listModels', '列出当前 ComfyUI 可用的模型文件（来自各加载器节点的选项），可选按类别过滤。', 'read', async (args, context) => {
    if (typeof comfy?.objectInfo !== 'function') throw new Error('ComfyUI 连接器不可用，请检查应用配置后重试');
    const info = await comfy.objectInfo('', context.signal);
    const nodes = info?.nodes || info || {};
    const loaders = {
      checkpoints: ['CheckpointLoaderSimple'], unet: ['UNETLoader'], clip: ['CLIPLoader'],
      vae: ['VAELoader'], loras: ['LoraLoader', 'LoraLoaderModelOnly', 'LoraLoaderBypassModelOnly'],
      controlnet: ['ControlNetLoader'], embeddings: ['LoraLoader', 'CLIPLoader']
    };
    const collect = (classes, keyPattern) => {
      const out = [];
      for (const className of classes) {
        const node = nodes[className];
        if (!node?.input?.required) continue;
        for (const [name, spec] of Object.entries(node.input.required)) {
          const choices = Array.isArray(spec) ? spec[0] : null;
          if (!Array.isArray(choices) || choices.length < 2 || !keyPattern.test(String(name))) continue;
          for (const item of choices) if (typeof item === 'string' && /\.[A-Za-z0-9]{2,}$/.test(item)) out.push(item);
        }
      }
      return [...new Set(out)].sort();
    };
    const models = {
      checkpoints: collect(loaders.checkpoints, /ckpt_name|checkpoint/i),
      unet: collect(loaders.unet, /unet_name/i), clip: collect(loaders.clip, /clip_name/i),
      vae: collect(loaders.vae, /vae_name/i), loras: collect(loaders.loras, /lora_name/i),
      controlnet: collect(loaders.controlnet, /control_net_name|controlnet_name/i),
      embeddings: collect(loaders.embeddings, /embedding_name|embeddings/i)
    };
    const category = text(args.category).toLowerCase();
    if (category) {
      if (!models[category]) return { models: {}, note: `未知类别：${category}；可选 ${Object.keys(models).join(' / ')}` };
      return { models: { [category]: models[category] } };
    }
    return { models };
  });

  return {
    ...registry,
    call,
    visionService,
    runtimeToolNames: RUNTIME_TOOL_NAMES,
    agentRuntimeToolNames: AGENT_RUNTIME_TOOL_NAMES,
    agentAdminToolNames: AGENT_ADMIN_TOOL_NAMES,
    getCapabilities,
    refreshCapabilities,
    invalidateCapabilities,
    listAvailable,
    agentNames,
    listAgent,
    schemasAvailable,
    schemasAgent,
    openAiToolsAvailable,
    openAiToolsAgent,
    schemas: registry.schemas,
    openAiTools: registry.openAiTools,
    describe: () => ({ version: '1.0', tools: registry.list(), capabilities: getCapabilities() })
  };
}

module.exports = { RUNTIME_TOOL_NAMES, AGENT_RUNTIME_TOOL_NAMES, AGENT_ADMIN_TOOL_NAMES, createCalls, createCallServer, makeSchemas, artifact };
