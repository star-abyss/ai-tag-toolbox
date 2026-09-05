'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { contextBridge } = require('electron');
const { migrateLegacyData } = require(path.join(__dirname, 'src', 'migrate'));

// 只在本地 preload 中构造业务模块；页面不接触 Node、文件系统或旧版全局脚本。
// 这个桥很薄，后续模块成熟后可以直接替换成浏览器端 ESM 实现。
let tags = null;
let images = null;
let translation = null;
let assistant = null;
let prompts = null;
let vision = null;
let storage = null;
let comfy = null;
let agentServer = null;
let translationRunner = null;
const localePacks = {};

// 旧版数据位于渲染器 localStorage。仅在 preload 启动时读取一次快照，
// 后续迁移器只操作快照和新的 AppStorage，页面层不再接触 localStorage。
function captureLegacyStorage() {
  const snapshot = {};
  try {
    if (typeof localStorage === 'undefined') return snapshot;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) snapshot[key] = localStorage.getItem(key);
    }
  } catch { /* 无法读取旧存储时按空数据启动 */ }
  return snapshot;
}

function parseJsonFile(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function parseStoredValue(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function storageCandidates(executablePath = process.execPath, cwd = process.cwd()) {
  const exeDir = path.dirname(executablePath);
  const parent = path.dirname(exeDir);
  const candidates = [
    path.join(exeDir, 'rewrite-storage.json'),
    path.join(cwd, 'rewrite-storage.json'),
  ];
  try {
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^AI绘画Tag工具箱V1\.4\./.test(entry.name)) continue;
      candidates.push(path.join(parent, entry.name, 'rewrite-storage.json'));
    }
  } catch { /* optional portable sibling scan */ }
  return [...new Set(candidates.map(item => path.resolve(item)))];
}

function isDefaultSettings(value) {
  const settings = parseStoredValue(value);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return true;
  const defaults = {
    base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', key: '', comfyBase: 'http://127.0.0.1:8188',
    comfyOn: false, comfyWorkflow: '', comfyIters: 3, batchCount: 1, maxComfyCalls: 3, generateNegativeTags: false, comfyW: 768, comfyH: 1024, comfySteps: 25, comfyCfg: 7,
  };
  return Object.entries(defaults).every(([key, expected]) => settings[key] === undefined || settings[key] === expected)
    && !settings.visionKey && !settings.visionModel;
}

function mergeStorageSeed(targetPath, candidates = []) {
  const target = parseJsonFile(targetPath) || {};
  const sourcePath = candidates.find(candidate => candidate !== path.resolve(targetPath) && fs.existsSync(candidate));
  if (!sourcePath) return false;
  const source = parseJsonFile(sourcePath);
  if (!source) return false;
  const merged = { ...target };
  let changed = false;
  for (const [key, value] of Object.entries(source)) {
    if (!Object.prototype.hasOwnProperty.call(merged, key)) {
      merged[key] = value;
      changed = true;
      continue;
    }
    const existingValue = parseStoredValue(merged[key]);
    const sourceValue = parseStoredValue(value);
    if (Array.isArray(existingValue) && existingValue.length === 0 && Array.isArray(sourceValue) && sourceValue.length) {
      merged[key] = value;
      changed = true;
      continue;
    }
    if (!/:rewrite_settings$/.test(key) || !isDefaultSettings(merged[key])) continue;
    const targetSettings = parseStoredValue(merged[key]);
    const sourceSettings = parseStoredValue(value);
    if (!targetSettings || !sourceSettings || typeof targetSettings !== 'object' || typeof sourceSettings !== 'object') continue;
    const next = { ...targetSettings };
    const defaults = {
      base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', key: '', temperature: 0.7, timeoutMs: 120000,
      visionInheritPrimary: true, visionBase: 'https://api.openai.com/v1', visionModel: '', visionKey: '', visionTemperature: 0.2, visionTimeoutMs: 120000,
      comfyOn: false, comfyWorkflow: '', comfyIters: 3, batchCount: 1, maxComfyCalls: 3, generateNegativeTags: false, comfyW: 768, comfyH: 1024, comfySteps: 25, comfyCfg: 7,
    };
    for (const [setting, settingValue] of Object.entries(sourceSettings)) {
      if (next[setting] === undefined || (Object.prototype.hasOwnProperty.call(defaults, setting) && next[setting] === defaults[setting] && settingValue !== defaults[setting])) next[setting] = settingValue;
    }
    merged[key] = JSON.stringify(next);
    changed = true;
  }
  if (!changed) return false;
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify(merged, null, 2), 'utf8');
    return true;
  } catch { return false; }
}

const legacySnapshot = captureLegacyStorage();
try {
  const modules = require(path.join(__dirname, 'src', 'modules'));
  const assetDir = path.join(__dirname, 'assets');
  for (const id of ['zh-CN', 'en-US']) {
    try { localePacks[id] = JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', `${id}.json`), 'utf8')); } catch { localePacks[id] = {}; }
  }
  // preload 属于渲染进程，不能调用主进程的 app.getPath；按 Electron 默认规则
  // 使用 APPDATA/<package name> 作为稳定用户目录，避免重打包清空设置。
  const userDataDir = path.join(process.env.APPDATA || path.dirname(process.execPath), 'ai-tag-toolbox-rewrite');
  const storagePath = path.join(userDataDir, 'rewrite-storage.json');
  const portableCandidates = storageCandidates(process.execPath, process.cwd());
  // 旧版测试包把设置放在 exe 同目录；切换到新版本目录时复制/合并一份，避免重打包后丢失。
  try {
    if (!fs.existsSync(storagePath)) {
      const source = portableCandidates.find(item => fs.existsSync(item));
      if (!source) throw new Error('no portable storage seed');
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.copyFileSync(source, storagePath);
    } else {
      mergeStorageSeed(storagePath, portableCandidates);
    }
  } catch { /* 迁移失败时仍按空设置启动 */ }
  storage = modules.createStorage ? modules.createStorage({ prefix: 'ai-tag-toolbox-rewrite', filePath: storagePath }) : null;
  // 先迁移旧设置/标签状态，再创建业务模块读取新的 AppStorage。
  migrateLegacyData({ storage, legacy: legacySnapshot });
  tags = modules.createTags({ sources: modules.loadTagFiles({ assetDir }), storage });
  const modelCandidates = [
    path.join(path.dirname(process.execPath), 'models'),
    path.join(__dirname, '..', '..', 'models'),
    path.join(process.cwd(), 'models'),
    path.join(assetDir, '模型')
  ];
  vision = modules.createVision({ modelsDir: modelCandidates.find(item => require('node:fs').existsSync(path.join(item, 'tags-canary.json'))) || modelCandidates[0] });
  images = modules.createImages({ analyzer: (image, options) => vision.analyze(image, options), storage, imageDir: path.join(userDataDir, 'rewrite-images') });
  prompts = modules.createPrompts ? modules.createPrompts({ dir: path.join(assetDir, '提示词素材'), storage }) : null;
  const translationRootCandidates = [
    path.join(path.dirname(process.execPath), 'models', 'translation'),
    path.join(__dirname, '..', '..', 'models', 'translation'),
    path.join(process.cwd(), 'models', 'translation'),
    path.join(assetDir, '模型', 'translation')
  ];
  const translationRoot = translationRootCandidates.find(item => fs.existsSync(path.join(item, 'opus-mt-zh-en', 'config.json'))) || '';
  const pipes = new Map();
  translationRunner = {
    available: () => Boolean(translationRoot),
    async translate(value, direction) {
      if (!translationRoot) throw new Error('未找到本地翻译模型');
      const modelId = direction === 'en-zh' ? 'opus-mt-en-zh' : 'opus-mt-zh-en';
      let pipe = pipes.get(modelId);
      if (!pipe) {
        const runtime = await import('@huggingface/transformers');
        runtime.env.localModelPath = translationRoot;
        runtime.env.allowRemoteModels = false;
        runtime.env.allowLocalModels = true;
        pipe = await runtime.pipeline('translation', modelId, { dtype: 'q8' });
        pipes.set(modelId, pipe);
      }
      const result = await pipe(String(value || ''), { max_new_tokens: 256 });
      const first = Array.isArray(result) ? result[0] : result;
      return { ok: true, text: String(first?.translation_text || first?.translation || first?.text || ''), direction, model: modelId };
    }
  };
  comfy = modules.createComfy ? modules.createComfy({ base: 'http://127.0.0.1:8188' }) : null;
  assistant = modules.createAssistant({
    tags,
    images,
    vision,
    comfy,
    storage,
    promptDir: path.join(assetDir, '提示词素材'),
    promptSource: prompts || undefined
  });
  if (modules.createCallServer && assistant?.calls) {
    const agentPort = Number(process.env.AITAG_AGENT_PORT) || 32145;
    agentServer = modules.createCallServer({
      calls: assistant.calls,
      port: agentPort,
      getPermissions: () => ({ write: assistant.getSettings?.().agentWriteEnabled === true })
    });
    agentServer.start().catch(error => console.warn('[V1.4.191] Agent 工具服务启动失败：', error?.message || error));
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => { agentServer?.stop?.(); }, { once: true });
  }
  // Translation only needs the generic AiService, so it can be assembled
  // after Assistant without introducing a reverse dependency.
  translation = modules.createTranslation({ tags, runner: translationRunner, ai: assistant.ai });
  // 迁移标记已存在时，此次仅补导入需要 Assistant 实例的旧会话。
  migrateLegacyData({ storage, assistant, legacy: legacySnapshot });
  // Old sessions are imported above when present. Finalization converts any
  // remaining legacy collections only after the effective session is known.
  assistant?.imageRepository?.finalizeMigration?.();
} catch (error) {
  // 标签模块加载失败时仍让页面打开，便于人工看到错误并继续迭代。
  console.warn('[V1.4.191] 业务模块加载失败：', error && error.message ? error.message : error);
}

function safeImageId(value) {
  const id = typeof value === 'string' ? value.trim() : value && typeof value === 'object' ? String(value.id || value.imageId || '').trim() : '';
  if (!id || /^(?:data:|blob:|file:|https?:\/\/|[A-Za-z]:[\\/]|[\\/])/.test(id)) return '';
  return id;
}
function safeImageMeta(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = { ...value };
  delete output.path;
  delete output.filePath;
  delete output.file_path;
  delete output.url;
  return output;
}
function safeImageAdd(input, meta = {}) {
  const source = typeof input === 'string' ? { dataUrl: input } : input && typeof input === 'object' ? { ...input } : null;
  if (!source) return null;
  const dataUrl = typeof source.dataUrl === 'string' && /^data:image\//i.test(source.dataUrl) ? source.dataUrl : '';
  const hasBytes = source.bytes instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(source.bytes)) || source.bytes instanceof ArrayBuffer;
  if (!dataUrl && !hasBytes) return null;
  delete source.path;
  delete source.filePath;
  delete source.file_path;
  delete source.url;
  delete source.src;
  if (dataUrl) source.dataUrl = dataUrl;
  else delete source.dataUrl;
  return images?.add?.(source, safeImageMeta(meta)) || null;
}
function safeImageGet(value) { const id = safeImageId(value); return id ? images?.get?.(id) || null : null; }
function safeImagePreview(value) { const id = safeImageId(value); return id ? images?.preview?.(id) || null : null; }
function safeImageBytes(value) { const id = safeImageId(value); return id ? images?.getBytes?.(id) || null : null; }
function safeImageMetadata(value) { const id = safeImageId(value); return id ? images?.metadata?.(id) || null : null; }
function safeImageRemove(value) {
  const id = safeImageId(value);
  if (!id) return false;
  const repository = assistant?.imageRepository;
  const references = repository?.referenceCount?.(id);
  // Fail closed when the relationship store is unavailable. A renderer must
  // never be able to turn a missing repository into an unrestricted delete.
  if (!references || Number(references.total) > 0) return false;
  const result = typeof repository.removeIfOrphaned === 'function'
    ? repository.removeIfOrphaned(id)
    : { removed: Boolean(images?.remove?.(id)) };
  if (result?.removed) assistant?.visionTempStore?.invalidateReference?.({ imageId: id });
  return Boolean(result?.removed);
}
function safeImageCollectionIds(name) { return typeof name === 'string' ? images?.collectionIds?.(name) || [] : []; }
function safeImageCollectionList(name) { return typeof name === 'string' ? images?.collectionList?.(name) || [] : []; }
function safeImageAddToCollection(name, value) { const id = safeImageId(value); return typeof name === 'string' && id ? images?.addTo?.(name, id) || false : false; }
function safeImageRemoveFromCollection(name, value) { const id = safeImageId(value); return typeof name === 'string' && id ? images?.removeFrom?.(name, id) || false : false; }
function safeImageClearCollection(name) { return typeof name === 'string' ? images?.clearCollection?.(name) || [] : []; }
const safeImageStore = images ? {
  add: safeImageAdd,
  get: safeImageGet,
  preview: safeImagePreview,
  getBytes: safeImageBytes,
  metadata: safeImageMetadata,
  remove: safeImageRemove,
  collectionIds: safeImageCollectionIds,
  collectionList: safeImageCollectionList,
  addToCollection: safeImageAddToCollection,
  removeFromCollection: safeImageRemoveFromCollection,
  clearCollection: safeImageClearCollection
} : null;

// Renderer-facing Vision/call methods always bind to the current Assistant
// session. The underlying modules still enforce the same scope for internal
// callers, but this adapter prevents a page script from selecting another
// session ID or probing the global Images map through preload.
function currentSessionId() {
  try { return String(assistant?.currentSession?.()?.id || assistant?.state?.currentId || ''); } catch { return ''; }
}
function visionInputForRenderer(input = {}) {
  const value = input && typeof input === 'object' ? { ...input } : {};
  const sessionId = currentSessionId();
  if (sessionId) value.sessionId = sessionId;
  return value;
}
function callForRenderer(name, args = {}, context = {}) {
  const scoped = { ...(context && typeof context === 'object' ? context : {}), sessionId: currentSessionId(), caller: 'ui' };
  return assistant?.calls?.call?.(name, args, scoped);
}
function runForRenderer(input = {}, config = {}) {
  const value = input && typeof input === 'object' ? { ...input } : { text: input };
  const sessionId = currentSessionId();
  if (sessionId) value.sessionId = sessionId;
  value.allowDetachedImages = false;
  return assistant?.run?.(value, config);
}
function resolveTempForRenderer(value) {
  return assistant?.visionTempStore?.resolveForVision?.(visionInputForRenderer(typeof value === 'object' ? value : { imageId: value }));
}

contextBridge.exposeInMainWorld('AppModules', {
  tags,
  images: safeImageStore,
  imageStore: safeImageStore,
  imageRepository: assistant?.imageRepository ? {
    listGallery: assistant.imageRepository.listGallery,
    listConversation: assistant.imageRepository.listConversation,
    attachToConversation: assistant.imageRepository.attachToConversation,
    setPending: assistant.imageRepository.setPending,
    pendingConversationReferences: assistant.imageRepository.pendingConversationReferences,
    markSent: assistant.imageRepository.markSent,
    resetPending: assistant.imageRepository.resetPending,
    setConversationTitle: assistant.imageRepository.setConversationTitle,
    removeFromConversation: assistant.imageRepository.removeFromConversation,
    clearSessionContent: assistant.imageRepository.clearSessionContent,
    deleteSession: assistant.imageRepository.deleteSession,
    renameGalleryImage: assistant.imageRepository.renameGalleryImage,
    promoteConversationImages: assistant.imageRepository.promoteConversationImages,
    referenceCount: assistant.imageRepository.referenceCount,
    addToGallery: assistant.imageRepository.addToGallery,
    removeFromGallery: assistant.imageRepository.removeFromGallery,
    getOriginalBytes: assistant.imageRepository.getOriginalBytes,
    finalizeMigration: assistant.imageRepository.finalizeMigration
  } : null,
  visionTempStore: assistant?.visionTempStore ? {
    setLibraryReference: assistant.visionTempStore.setLibraryReference,
    setConversationReference: (imageId, extra = {}) => {
      const sessionId = currentSessionId();
      if (extra?.sessionId && sessionId && String(extra.sessionId) !== sessionId) return null;
      return assistant.visionTempStore.setConversationReference(imageId, { ...extra, sessionId });
    },
    replaceExternal: assistant.visionTempStore.replaceExternal,
    current: assistant.visionTempStore.current,
    resolveForVision: resolveTempForRenderer,
    clear: assistant.visionTempStore.clear,
    get: resolveTempForRenderer,
    getBytes: value => assistant.visionTempStore.getBytes(visionInputForRenderer(typeof value === 'object' ? value : { imageId: value }))
  } : null,
  translation,
  assistant: assistant ? {
    run: runForRenderer,
    getCapabilities: assistant.getCapabilities,
    refreshCapabilities: assistant.refreshCapabilities,
    newSession: assistant.newSession,
    currentSession: assistant.currentSession,
    sessions: assistant.sessions,
    switchSession: assistant.switchSession,
    renameSession: assistant.renameSession,
    deleteSession: assistant.deleteSession,
    clearSession: assistant.clearSession,
    editMessage: assistant.editMessage,
    deleteMessage: assistant.deleteMessage,
    rerunFromMessage: assistant.rerunFromMessage,
    regenerateMessage: assistant.regenerateMessage,
    importSessions: assistant.importSessions,
    exportSessions: assistant.exportSessions,
    cancel: assistant.cancel,
    stop: assistant.stop,
    compose: assistant.compose,
    parseReply: assistant.parseReply,
    chooseCandidate: assistant.chooseCandidate,
    selectCandidate: assistant.selectCandidate,
    // 业务状态统一由 Assistant 持有，页面只通过这些薄方法读取或更新。
    getSettings: assistant.getSettings,
    setSettings: assistant.setSettings,
    updateSettings: assistant.updateSettings,
    listPresets: assistant.listPresets,
    getPresets: assistant.getPresets,
    setPresets: assistant.setPresets,
    addPreset: assistant.addPreset,
    removePreset: assistant.removePreset,
    getActivePreset: assistant.getActivePreset,
    selectPreset: assistant.selectPreset,
    listWorlds: assistant.listWorlds,
    getWorlds: assistant.getWorlds,
    setWorlds: assistant.setWorlds,
    addWorld: assistant.addWorld,
    removeWorld: assistant.removeWorld,
    getActiveWorld: assistant.getActiveWorld,
    selectWorld: assistant.selectWorld,
    listFavorites: assistant.listFavorites,
    getFavorites: assistant.getFavorites,
    setFavorites: assistant.setFavorites,
    addFavorite: assistant.addFavorite,
    removeFavorite: assistant.removeFavorite,
    snapshot: assistant.snapshot,
    ai: assistant.ai ? { complete: assistant.ai.complete, stream: assistant.ai.stream, listModels: assistant.ai.listModels, setConfig: assistant.ai.setConfig, getConfig: assistant.ai.getConfig } : null,
    visionAi: assistant.visionAi ? { complete: assistant.visionAi.complete, stream: assistant.visionAi.stream, listModels: assistant.visionAi.listModels, setConfig: assistant.visionAi.setConfig, getConfig: assistant.visionAi.getConfig } : null,
    visionService: assistant.visionService ? { processOne: input => assistant.visionService.processOne(visionInputForRenderer(input)), available: assistant.visionService.available } : null,
    calls: assistant.calls ? { call: callForRenderer, list: assistant.calls.list, listAvailable: assistant.calls.listAvailable, listAgent: assistant.calls.listAgent, agentNames: assistant.calls.agentNames, schemas: assistant.calls.schemas, schemasAvailable: assistant.calls.schemasAvailable, schemasAgent: assistant.calls.schemasAgent, openAiTools: assistant.calls.openAiTools, openAiToolsAvailable: assistant.calls.openAiToolsAvailable, openAiToolsAgent: assistant.calls.openAiToolsAgent, getCapabilities: assistant.calls.getCapabilities, refreshCapabilities: assistant.calls.refreshCapabilities, invalidateCapabilities: assistant.calls.invalidateCapabilities, describe: assistant.calls.describe } : null
  } : null,
  prompts: prompts ? {
    get: prompts.get,
    getEffective: prompts.getEffective,
    set: prompts.set,
    getDefault: prompts.getDefault,
    enabled: prompts.enabled,
    setEnabled: prompts.setEnabled,
    reset: prompts.reset,
    createCustom: prompts.createCustom,
    update: prompts.update,
    updateCustom: prompts.updateCustom,
    deleteCustom: prompts.deleteCustom,
    item: prompts.item,
    keys: prompts.keys,
    meta: prompts.meta,
    metadata: prompts.metadata,
    appendices: prompts.appendices,
    compose: prompts.compose,
    snapshot: prompts.snapshot
  } : null,
  calls: assistant?.calls ? { call: callForRenderer, list: assistant.calls.list, listAvailable: assistant.calls.listAvailable, listAgent: assistant.calls.listAgent, agentNames: assistant.calls.agentNames, schemas: assistant.calls.schemas, schemasAvailable: assistant.calls.schemasAvailable, schemasAgent: assistant.calls.schemasAgent, openAiTools: assistant.calls.openAiTools, openAiToolsAvailable: assistant.calls.openAiToolsAvailable, openAiToolsAgent: assistant.calls.openAiToolsAgent, getCapabilities: assistant.calls.getCapabilities, refreshCapabilities: assistant.calls.refreshCapabilities, invalidateCapabilities: assistant.calls.invalidateCapabilities, describe: assistant.calls.describe } : null,
  agent: agentServer ? { start: agentServer.start, stop: agentServer.stop, status: agentServer.status } : null,
  vision,
  visionService: assistant?.visionService ? { processOne: input => assistant.visionService.processOne(visionInputForRenderer(input)), available: assistant.visionService.available } : null,
  storage: storage ? {
    get: (...args) => storage.get(...args),
    set: (...args) => storage.set(...args),
    load: (...args) => storage.load(...args),
    save: (...args) => storage.save(...args),
    remove: (...args) => storage.remove(...args),
    has: (...args) => storage.has(...args),
    keys: (...args) => storage.keys(...args),
    clear: (...args) => storage.clear(...args),
    putBlob: (...args) => storage.putBlob(...args),
    getBlob: (...args) => storage.getBlob(...args),
    removeBlob: (...args) => storage.removeBlob(...args)
  } : null,
  comfy: comfy ? {
    check: comfy.check,
    status: comfy.status,
    list: comfy.list,
    render: comfy.render,
    fetchImage: comfy.fetchImage,
    setBase: comfy.setBase,
    setWorkflow: comfy.setWorkflow,
    buildWorkflow: comfy.buildWorkflow,
    parseWorkflow: comfy.parseWorkflow,
    importApiWorkflow: comfy.importApiWorkflow,
    workflowStatus: comfy.workflowStatus,
    workflowReady: comfy.workflowReady
  } : null,
  locales: localePacks,
  version: '1.4.191'
});
