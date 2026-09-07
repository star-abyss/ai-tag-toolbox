'use strict';

const { SCHEMAS, OUTPUT_SCHEMAS } = require('./fixed-subagents');
const { assertValid } = require('./schema');
const { errorShape, resultOk, resultError } = require('./error-manager');
const TOOL_NAMES = Object.freeze(['tags.search', 'characters.search', 'conversation.listImages', 'vision.processOne', 'translation.translate', 'agent.generateTags', 'comfy.status', 'comfy.validateWorkflow', 'comfy.render']);
const NATIVE_NAMES = new Map(TOOL_NAMES.map(name => [name.replace('.', '_'), name]));
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function schema(properties, required = []) { return { type: 'object', additionalProperties: false, properties, required }; }
const string = { type: 'string' };
const nonempty = { type: 'string', minLength: 1, maxLength: 1000 };
const tagArray = { type: 'array', items: nonempty, maxItems: 256 };
const attachedDataSchema = schema({ type: string, characterId: string, series: string, identityTags: tagArray, appearanceTags: tagArray });
const tagSchema = schema({ en: nonempty, zh: string, aliases: { type: 'array', items: string, maxItems: 64 }, category: string, subcategory: string, nsfw: { type: 'boolean' }, confidence: { type: 'number' }, attachedData: attachedDataSchema }, ['en']);
const characterTagSchema = schema({ id: nonempty, en: nonempty, zh: string, category: string, nsfw: { type: 'boolean' }, review: { type: 'boolean' } }, ['id', 'en']);
const characterSchema = schema({ id: nonempty, name: string, nameZh: string, aliases: { type: 'array', items: string }, seriesId: string, seriesName: string, identityTags: tagArray, generalTags: { type: 'array', items: characterTagSchema }, specificTags: { type: 'array', items: characterTagSchema }, hasFeatures: { type: 'boolean' }, count: { type: 'number' }, trigger: string }, ['id', 'identityTags', 'generalTags', 'specificTags']);
const generateParameters = clone(SCHEMAS.generateTags);
delete generateParameters.properties.characterReferences;
const imageSchema = schema({ imageId: nonempty, refId: string, slotNo: { type: 'integer', minimum: 0 }, displayTitle: string, source: string, messageId: string, pending: { type: 'boolean' }, sent: { type: 'boolean' }, final: { type: 'boolean' }, width: { type: 'number', minimum: 0 }, height: { type: 'number', minimum: 0 }, hasBuiltinTags: { type: 'boolean' } }, ['imageId']);
const workflowSchema = schema({ ready: { type: 'boolean' }, error: string }, ['ready', 'error']);
const capabilitiesSchema = schema({ txt2img: { type: 'boolean' }, img2img: { type: 'boolean' }, controlImage: { type: 'boolean' }, mask: { type: 'boolean' } });
const statusSchema = schema({ enabled: { type: 'boolean' }, connected: { type: 'boolean' }, workflowReady: { type: 'boolean' }, render: { type: 'boolean' }, error: string, workflowProfileId: string, workflowRevision: string, capabilities: capabilitiesSchema }, ['enabled', 'connected', 'workflowReady', 'render', 'error']);
const renderSchema = schema({ artifacts: { type: 'array', minItems: 1, maxItems: 256, items: imageSchema }, imageIds: { type: 'array', minItems: 1, maxItems: 256, items: nonempty }, prompt: string, negative: string, positiveTags: tagArray, negativeTags: tagArray, parameters: { type: 'object' }, workflowProfileId: string, workflowRevision: string, workflowHash: string, changedBindings: { type: 'array', items: string }, recreationMode: { type: 'string', enum: ['', 'reference_image', 'text_approximation'] } }, ['artifacts', 'imageIds']);
const DEFINITIONS = Object.freeze({
  'tags.search': { description: '查询本站标签及释义；Tag 含义、拼写或是否属于本站词库不确定时调用。命中角色名时附带角色出处和外貌 Tag。', parameters: schema({ query: { type: 'string', maxLength: 1000 }, category: string, includeAdult: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, ['query']), outputSchema: schema({ items: { type: 'array', maxItems: 200, items: tagSchema } }, ['items']) },
  'characters.search': { description: '查询本地角色资料，返回中英文名、作品、身份词和可选特征；先确认具体角色再向 agent.generateTags 传 characterIds。', parameters: schema({ query: { type: 'string', maxLength: 1000 }, seriesId: string, precision: { type: 'string', enum: ['exact', 'standard', 'broad'] }, includeAdult: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, ['query']), outputSchema: schema({ items: { type: 'array', maxItems: 10, items: characterSchema }, total: { type: 'integer', minimum: 0 } }, ['items', 'total']) },
  'conversation.listImages': { description: '读取当前会话的真实 imageId、显示编号和图片元数据。', parameters: schema({ includePending: { type: 'boolean' }, includeDeleted: { type: 'boolean' } }), outputSchema: schema({ items: { type: 'array', items: imageSchema }, pendingIds: { type: 'array', items: string } }, ['items', 'pendingIds']) },
  'vision.processOne': { description: '对当前会话中的单个 imageId 进行 metadata/local/ai 识图。', parameters: SCHEMAS.vision, outputSchema: OUTPUT_SCHEMAS?.vision },
  'translation.translate': { description: '固定翻译子代理；source 为 ai 或 local。', parameters: SCHEMAS.translation, outputSchema: OUTPUT_SCHEMAS?.translation },
  'agent.generateTags': { description: '使用 Vision AI，根据要求、已有 Tag、参考 Tag、可选 imageId 和 characters.search 返回的 characterIds 生成英文绘图 Tag。', parameters: generateParameters, outputSchema: OUTPUT_SCHEMAS?.generateTags },
  'comfy.status': { description: '读取 ComfyUI 连接、启用和工作流状态。', parameters: schema({}), outputSchema: statusSchema },
  'comfy.validateWorkflow': { description: '检查用户当前 API 工作流是否可用。', parameters: schema({}), outputSchema: workflowSchema },
  'comfy.render': { description: '按正向 Tag 和可选负向 Tag 出图；内部复刻任务可传当前会话的 sourceImageId。', parameters: schema({ positiveTags: { ...tagArray, minItems: 1 }, negativeTags: tagArray, sourceImageId: nonempty, denoise: { type: 'number', minimum: 0, maximum: 1 }, controlStrength: { type: 'number', minimum: 0, maximum: 2 } }, ['positiveTags']), outputSchema: renderSchema }
});

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function check(schemaValue, value, code) { try { return assertValid(schemaValue || {}, value); } catch (error) { error.code = code; throw error; } }
function unwrap(value) { if (value?.ok === false) throw errorShape(value); return value?.ok === true && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value; }
function publicTag(row, attachedData = {}) {
  const value = object(row?.tag) ? row.tag : row;
  const item = { en: text(value?.en || value?.tag || value?.name || (typeof value === 'string' ? value : '')) };
  for (const key of ['zh', 'category', 'subcategory']) if (typeof value?.[key] === 'string') item[key] = value[key];
  if (Array.isArray(value?.aliases)) item.aliases = value.aliases.filter(v => typeof v === 'string').slice(0, 64);
  if (typeof value?.nsfw === 'boolean') item.nsfw = value.nsfw;
  if (typeof value?.confidence === 'number' && Number.isFinite(value.confidence)) item.confidence = value.confidence;
  item.attachedData = object(attachedData) ? clone(attachedData) : {};
  return item;
}
function roleAttachedData(role) {
  if (!role) return {};
  return {
    type: 'character',
    characterId: role.id,
    series: text(role.seriesName || role.seriesId),
    identityTags: Array.isArray(role.identityTags) ? role.identityTags.slice() : [],
    appearanceTags: [...(Array.isArray(role.generalTags) ? role.generalTags : []), ...(Array.isArray(role.specificTags) ? role.specificTags : [])]
      .map(item => text(item?.en || item))
      .filter(Boolean)
  };
}
function publicImage(value) {
  const result = { imageId: text(value?.imageId || value?.id) };
  for (const key of ['refId', 'displayTitle', 'source', 'messageId']) if (typeof value?.[key] === 'string') result[key] = value[key];
  for (const key of ['slotNo', 'width', 'height']) if (Number.isFinite(value?.[key])) result[key] = value[key];
  for (const key of ['pending', 'sent', 'final', 'hasBuiltinTags']) if (typeof value?.[key] === 'boolean') result[key] = value[key];
  return result;
}

function createPrimaryTools(options = {}) {
  const getSettings = typeof options.getSettings === 'function' ? options.getSettings : () => ({});
  const getRuntime = typeof options.runtime === 'function' ? options.runtime : () => options.runtime;
  const repository = options.imageRepository || options.imagesRepository;
  const images = options.images;
  const comfy = options.comfy;
  function currentComfy() {
    const settings = getSettings()?.comfy || {};
    const profile = comfy?.profiles?.active?.();
    return profile ? { ...settings, base: profile.base || settings.base, workflow: profile.workflow || settings.workflow } : settings;
  }
  function guardSignal(context) { if (context.signal?.aborted) throw context.signal.reason || failure('CANCELLED', '请求已取消'); }
  function syncComfy(settings) { if (settings.base && typeof comfy?.setBase === 'function') comfy.setBase(settings.base); }
  async function subagent(name, args, context) {
    const runtime = getRuntime(); if (typeof runtime?.runSubAgent !== 'function') throw failure('SUBAGENT_UNAVAILABLE', '子代理运行器不可用');
    return runtime.runSubAgent(name, { input: args, parentRequestId: context.requestId, signal: context.signal, sessionId: context.sessionId, messageId: context.messageId, onEvent: context.onEvent });
  }
  async function renderedImages(raw, context, details = {}) {
    const value = unwrap(raw);
    let rows = Array.isArray(value) ? value.slice() : Array.isArray(value?.artifacts) ? value.artifacts.slice() : Array.isArray(value?.images) ? value.images.slice() : value?.artifact ? [value.artifact] : value ? [value] : [];
    const promptId = text(value?.promptId || rows[0]?.promptId);
    if (promptId && typeof comfy.result === 'function' && typeof comfy.fetchImage === 'function') {
      const result = await comfy.result(promptId, { signal: context.signal }); guardSignal(context);
      if (result?.status === 'error') throw failure('COMFY_FAILED', text(result.error) || 'ComfyUI 出图失败');
      const known = new Set(rows.filter(item => item?.dataUrl || item?.bytes).map(item => [item.filename, item.subfolder || '', item.type || 'output'].join('|')));
      const configuredOutputs = comfy?.profiles?.active?.()?.bindings?.outputs;
      const outputRows = Array.isArray(configuredOutputs) && configuredOutputs.length
        ? (result?.outputs || []).filter(output => configuredOutputs.includes(String(output.nodeId)))
        : (result?.outputs || []);
      for (const output of outputRows) for (const file of output.files || []) {
        const key = [file.filename, file.subfolder || '', file.type || 'output'].join('|');
        if (known.has(key)) continue;
        known.add(key); rows.push(await comfy.fetchImage(file, context.signal)); guardSignal(context);
      }
    }
    rows = rows.filter(item => item && (item.dataUrl || item.bytes || item.imageId || item.id));
    if (!rows.length) throw failure('OUTPUT_INVALID', 'ComfyUI 未返回图片');
    if (typeof images?.add !== 'function' || typeof repository?.attachToConversation !== 'function') throw failure('IMAGE_STORE_UNAVAILABLE', '图片仓库不可用');
    const artifacts = [];
    for (const row of rows) {
      guardSignal(context);
      const known = text(row.imageId || row.id); let stored = known && images.get?.(known);
      if (!stored) stored = await images.add({ ...row, source: 'comfy' }, { source: 'comfy' });
      guardSignal(context);
      const imageId = text(stored?.imageId || stored?.id); if (!imageId) throw failure('OUTPUT_INVALID', '无法登记 ComfyUI 图片');
      const reference = await repository.attachToConversation(context.sessionId, imageId, { source: 'comfy', messageId: context.messageId, pending: false, sent: true });
      if (!reference) throw failure('IMAGE_ATTACH_FAILED', '无法将图片关联到当前会话');
      const artifact = publicImage({ ...stored, ...reference, imageId });
      if (!artifacts.some(item => item.imageId === imageId)) artifacts.push(artifact);
    }
    return { artifacts, imageIds: artifacts.map(item => item.imageId), ...clone(details) };
  }
  const handlers = {
    'tags.search': async args => {
      if (typeof options.tags?.search !== 'function') throw failure('TOOL_UNAVAILABLE', 'Tag 模块不可用');
      const includeAdult = args.includeAdult === true;
      const rows = await options.tags.search(args.query, { category: args.category, includeAdult, limit: args.limit || 50 });
      if (!Array.isArray(rows)) throw failure('OUTPUT_INVALID', '标签查询返回格式无效');
      const attached = new Map();
      if (typeof options.characters?.get === 'function') for (const row of rows) {
        if (row?.category !== 'character_names' && row?.categoryCode !== 4) continue;
        const role = options.characters.get(row.id, { includeAdult });
        if (role) attached.set(row.id, roleAttachedData(role));
      }
      return { items: rows.slice(0, args.limit || 50).map(row => publicTag(row, attached.get(row.id))) };
    },
    'characters.search': args => {
      if (!options.characters?.page) throw failure('TOOL_UNAVAILABLE', '角色模块不可用');
      const includeAdult = args.includeAdult === true;
      const page = options.characters.page({ ...args, includeAdult, limit: args.limit || 5 });
      return { items: page.items.map(row => options.characters.get(row.id, { includeAdult })).filter(Boolean), total: page.total };
    },
    'conversation.listImages': async (args, context) => {
      if (!context.sessionId) throw failure('SESSION_REQUIRED', '当前会话不可用');
      if (typeof repository?.listConversation !== 'function') throw failure('TOOL_UNAVAILABLE', '图片仓库不可用');
      const value = await repository.listConversation(context.sessionId, { includePending: args.includePending !== false, includeDeleted: args.includeDeleted === true });
      if (!Array.isArray(value?.items)) throw failure('OUTPUT_INVALID', '会话图片返回格式无效');
      return { items: value.items.map(publicImage), pendingIds: Array.isArray(value.pendingIds) ? value.pendingIds.filter(id => typeof id === 'string') : [] };
    },
    'vision.processOne': (args, context) => subagent('vision', args, context),
    'translation.translate': (args, context) => subagent('translation', args, context),
    'agent.generateTags': (args, context) => {
      if (args.characterIds?.length) {
        if (!options.characters?.get) throw failure('TOOL_UNAVAILABLE', '角色模块不可用');
        const includeAdult = options.tags?.stateSnapshot?.().includeAdult === true;
        const characterReferences = [...new Set(args.characterIds)].map(id => {
          const role = options.characters.get(id, { includeAdult });
          if (!role) throw failure('CHARACTER_NOT_FOUND', '角色不存在或当前不可用：' + id);
          return { id: role.id, name: role.nameZh || role.name, series: role.seriesName, identityTags: role.identityTags, generalTags: role.generalTags.map(t => t.en), specificTags: role.specificTags.map(t => t.en) };
        });
        return subagent('generateTags', { ...args, characterReferences }, context);
      }
      return subagent('generateTags', args, context);
    },
    'comfy.status': async (_args, context) => {
      if (typeof comfy?.status !== 'function') throw failure('TOOL_UNAVAILABLE', 'ComfyUI 连接器不可用');
      const settings = currentComfy(); syncComfy(settings);
      const value = unwrap(await comfy.status({ enabled: settings.enabled === true, workflow: settings.workflow, signal: context.signal }));
      const profile = comfy?.profiles?.active?.();
      return { enabled: settings.enabled === true, connected: value?.connected === true, workflowReady: value?.workflowReady === true, render: value?.render === true, error: text(value?.error), workflowProfileId: text(profile?.id), workflowRevision: profile?.updatedAt ? String(profile.updatedAt) : '', capabilities: object(profile?.capabilities) ? clone(profile.capabilities) : { txt2img: true, img2img: false, controlImage: false, mask: false } };
    },
    'comfy.validateWorkflow': async (_args, context) => {
      const settings = currentComfy(); const method = comfy?.workflowStatus || comfy?.validateWorkflow;
      if (typeof method !== 'function') throw failure('TOOL_UNAVAILABLE', 'ComfyUI 工作流检查不可用');
      guardSignal(context); const value = unwrap(await method.call(comfy, settings.workflow));
      if (typeof value?.ready !== 'boolean') throw failure('OUTPUT_INVALID', '工作流检查返回格式无效');
      return { ready: value.ready, error: text(value.error) };
    },
    'comfy.render': async (args, context) => {
      if (!context.sessionId) throw failure('SESSION_REQUIRED', '当前会话不可用');
      if (typeof comfy?.render !== 'function') throw failure('TOOL_UNAVAILABLE', 'ComfyUI 连接器不可用');
      const settings = currentComfy(); if (settings.enabled !== true) throw failure('COMFY_DISABLED', 'ComfyUI 未启用'); syncComfy(settings);
      const profile = comfy?.profiles?.active?.();
      const negative = args.negativeTags === undefined ? (Array.isArray(settings.negativeTags) ? settings.negativeTags : text(settings.negativeTags).split(/[,，\n]+/).filter(Boolean)) : args.negativeTags;
      let uploaded = null;
      let recreationMode = '';
      if (args.sourceImageId) {
        if (!context.sessionId) throw failure('SESSION_REQUIRED', '复刻任务缺少当前会话');
        const listed = await repository?.listConversation?.(context.sessionId, { includePending: true, includeDeleted: false });
        const references = Array.isArray(listed) ? listed : listed?.items;
        const sourceReference = Array.isArray(references) ? references.find(item => text(item?.imageId || item?.id) === args.sourceImageId && !item?.deleted) : null;
        if (!sourceReference) throw failure('IMAGE_SCOPE', '参考原图不在当前会话中');
        const canUseReference = Boolean(profile?.bindings?.sourceImage && (!profile.capabilities || profile.capabilities.img2img === true || profile.capabilities.controlImage === true));
        if (canUseReference) {
          if (typeof repository?.getOriginalBytes !== 'function' || typeof comfy?.uploadImage !== 'function') throw failure('IMAGE_UPLOAD_UNAVAILABLE', '当前环境无法向 ComfyUI 上传参考原图');
          const bytes = await repository.getOriginalBytes(args.sourceImageId);
          guardSignal(context);
          if (!bytes?.length) throw failure('IMAGE_DATA_UNAVAILABLE', '无法读取参考原图内容');
          const asset = images?.get?.(args.sourceImageId) || {};
          uploaded = await comfy.uploadImage({ bytes, filename: text(asset.filename || asset.displayName, `${args.sourceImageId}.png`), type: text(asset.mime, 'image/png') }, context.signal);
          guardSignal(context);
          recreationMode = 'reference_image';
        } else recreationMode = 'text_approximation';
      }
      let submitted = null;
      const parameters = { width: settings.width, height: settings.height, steps: settings.steps, cfg: settings.cfg, seed: settings.seed, sampler: settings.sampler, scheduler: settings.scheduler, batchCount: settings.batchCount };
      if (uploaded && profile?.bindings?.denoise && args.denoise !== undefined) parameters.denoise = args.denoise;
      if (uploaded && profile?.bindings?.controlStrength && args.controlStrength !== undefined) parameters.controlStrength = args.controlStrength;
      const raw = await comfy.render({ prompt: args.positiveTags.join(', '), negative: negative.join(', '), ...parameters, ...(uploaded ? { sourceImage: uploaded } : {}), workflow: settings.workflow, signal: context.signal, onSubmitted: value => { submitted = clone(value || {}); if (!context.signal?.aborted) context.onEvent?.({ type: 'comfy.submitted', workflowHash: text(value?.workflowHash), changedBindings: Array.isArray(value?.changedBindings) ? value.changedBindings.slice() : [], parameters: object(value?.parameters) ? clone(value.parameters) : {} }); }, onProgress: value => { if (!context.signal?.aborted) context.onEvent?.({ type: 'progress', tool: 'comfy.render', queue: typeof value === 'number' ? value : undefined }); } });
      guardSignal(context);
      return renderedImages(raw, context, {
        prompt: args.positiveTags.join(', '), negative: negative.join(', '), positiveTags: args.positiveTags.slice(), negativeTags: negative.slice(),
        parameters: { ...parameters, ...(object(submitted?.parameters) ? submitted.parameters : {}) },
        workflowProfileId: text(profile?.id), workflowRevision: profile?.updatedAt ? String(profile.updatedAt) : '',
        workflowHash: text(submitted?.workflowHash || raw?.workflowHash),
        changedBindings: Array.isArray(submitted?.changedBindings || raw?.changedBindings) ? (submitted?.changedBindings || raw.changedBindings).slice() : [],
        recreationMode
      });
    }
  };
  const resolve = value => { const name = NATIVE_NAMES.get(value) || value; return TOOL_NAMES.includes(name) ? { name, ...clone(DEFINITIONS[name]), handler: handlers[name] } : null; };
  const list = () => TOOL_NAMES.map(name => ({ name, ...clone(DEFINITIONS[name]) }));
  async function call(name, args = {}, context = {}) {
    const entry = resolve(name); if (!entry) return resultError({ code: 'TOOL_UNAVAILABLE', message: `工具不可用：${name}` }, context.requestId);
    try {
      check(entry.parameters, args, 'INVALID_INPUT'); guardSignal(context);
      const value = await entry.handler(clone(args), context); const data = unwrap(value); check(entry.outputSchema, data, 'OUTPUT_INVALID');
      return resultOk(data, value?.requestId || context.requestId, value?.usage);
    } catch (error) { return resultError(error, context.requestId); }
  }
  return Object.freeze({ names: () => TOOL_NAMES.slice(), list, schemas: list, openAiTools: () => list().map(item => ({ type: 'function', function: { name: item.name.replace('.', '_'), description: item.description, parameters: item.parameters } })), resolve, call, has: name => Boolean(resolve(name)) });
}

module.exports = { TOOL_NAMES, DEFINITIONS, createPrimaryTools };
