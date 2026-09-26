'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { contextBridge, ipcRenderer } = require('electron');

// 只在本地 preload 中构造业务模块；页面不接触 Node、文件系统或旧版全局脚本。
// 这个桥很薄，后续模块成熟后可以直接替换成浏览器端 ESM 实现。
let catalog = null;
let formatTagOutput = null;
let tags = null;
let favorites = null;
let characters = null;
let images = null;
let translation = null;
let assistant = null;
let prompts = null;
let vision = null;
let storage = null;
let comfy = null;
let translationRunner = null;
let modulesRef = null;
let runtime = null;
let primaryTools = null;
let translationProxyTarget = null;
const localePacks = {};
const updateBridge = ipcRenderer ? {
  getState: () => ipcRenderer.invoke('updates:get-state'),
  listReleases: () => ipcRenderer.invoke('updates:list'),
  download: version => ipcRenderer.invoke('updates:download', version),
  prepareSwitch: (version, stagedDirectory = '') => ipcRenderer.invoke('updates:prepare-switch', version, stagedDirectory),
  applyStaged: (version, stagedDirectory = '') => ipcRenderer.invoke('updates:apply-staged', version, stagedDirectory),
  switchInstalled: version => ipcRenderer.invoke('updates:switch-installed', version),
  cancel: () => ipcRenderer.invoke('updates:cancel'),
  onEvent: listener => {
    const handler = (_event, value) => listener?.(value);
    ipcRenderer.on('updates:event', handler);
    return () => ipcRenderer.removeListener('updates:event', handler);
  }
} : null;

try {
  const modules = require(path.join(__dirname, 'src', 'modules'));
  modulesRef = modules;
  const assetDir = path.join(__dirname, 'assets');
  for (const id of ['zh-CN', 'en-US']) {
    try { localePacks[id] = JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', `${id}.json`), 'utf8')); } catch { localePacks[id] = {}; }
  }
  // preload 属于渲染进程，不能调用主进程的 app.getPath；按 Electron 默认规则
  // 使用 APPDATA/<package name> 作为稳定用户目录，避免重打包清空设置。
  const userDataDir = path.join(process.env.APPDATA || path.dirname(process.execPath), 'ai-tag-toolbox-rewrite');
  const boot = require('./src/modules/tag-library/bootstrap').createCatalogBootstrap({ userDataDir });
  catalog = boot.catalog;
  if (boot.blocked) throw Object.assign(new Error('旧存储需要修复'), { code: 'BOOT_BLOCKED' });
  formatTagOutput = boot.formatTagOutput;
  const storagePath = boot.storagePath;
  fs.mkdirSync(userDataDir, { recursive: true });
  storage = modules.createStorage ? modules.createStorage({ prefix: 'ai-tag-toolbox-rewrite', filePath: storagePath }) : null;
  tags = modules.createTags({ library: boot.library, metadataById: boot.base.metadataById, preferences: storage });
  favorites = modules.createFavorites({ library: boot.library });
  characters = modules.createCharacters({ library: boot.library, characterSource: boot.characterSource });
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
  translationProxyTarget = {
    service: null,
    translateLocal: (...args) => translationProxyTarget?.service?.translateLocal?.(...args),
    translateWithModel: (...args) => translationProxyTarget?.service?.translateWithModel?.(...args),
    translate: (...args) => translationProxyTarget?.service?.translate?.(...args)
  };
  assistant = modules.createAssistant({
    tags,
    favorites,
    characters,
    images,
    vision,
    comfyOptions: { base: 'http://127.0.0.1:8188' },
    translation: translationProxyTarget,
    storage,
    promptDir: path.join(assetDir, '提示词素材'),
    callMonitorPath: path.join(userDataDir, 'debug', 'ai-call-summary.json'),
    promptSource: prompts || undefined
  });
  comfy = assistant.comfy || null;
  // Translation only needs the generic AiService, so it can be assembled
  // after Assistant without introducing a reverse dependency.
  translation = modules.createTranslation({ tags, runner: translationRunner, ai: assistant.ai });
  translationProxyTarget.service = translation;
  runtime = assistant.runtime || null;
  primaryTools = assistant.primaryTools || null;
} catch (error) {
  if (!catalog) {
    const failure = () => ({ ok: false, error: { code: 'BOOT_FAILED', message: '标签库启动失败，请检查应用资源后重试' } });
    const reload = async () => ({ ok: true, data: { reloadRequired: true } });
    catalog = Object.freeze({ ready: async () => failure(), status: () => ({ ready: false, writable: false, error: failure().error }), execute: async () => failure(), subscribe: () => () => {}, flush: async () => false, retryInitialization: reload, recoverBackup: reload });
  }
  // 标签模块加载失败时仍让页面打开，便于人工看到错误并继续迭代。
  console.warn('[V1.4.320] 业务模块加载失败：', error?.code || 'BOOT_FAILED');
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
  return images?.add?.(source, safeImageMeta(meta) || {}) || null;
}
function safeImageGet(value) { const id = safeImageId(value); return id ? images?.get?.(id) || null : null; }
function safeImageMeta(value) { const id = safeImageId(value); return id ? images?.getMeta?.(id) || null : null; }
function safeImageThumbnail(value) { const id = safeImageId(value); return id ? images?.getThumbnail?.(id) || null : null; }
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
  getMeta: safeImageMeta,
  getThumbnail: safeImageThumbnail,
  preview: safeImagePreview,
  getBytes: safeImageBytes,
  metadata: safeImageMetadata,
  remove: safeImageRemove,
  parsePngMetadata: modulesRef?.parsePngMetadata || null,
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
  return runtime?.callTool?.(name, args, scoped) || { ok: false, error: { code: 'RUNTIME_UNAVAILABLE', message: '统一 Agent Runtime 不可用' } };
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
  catalog,
  formatTagOutput,
  tags: tags ? Object.fromEntries([
    'get', 'describe', 'copyText', 'list', 'characterNameIndex', 'all', 'allTags', 'getAll', 'search', 'setQuery', 'setCategory', 'setAdult', 'setSearchPrecision', 'searchPrecisions', 'page', 'categoryCounts', 'subcategories', 'getSubcategories', 'stateSnapshot', 'customTags', 'getCategories', 'select', 'toggleSelected', 'selected', 'selectedText', 'clearSelection', 'addCustom', 'removeCustom', 'edit', 'restore', 'restoreUserState', 'editHistory', 'has', 'size', 'isLoaded', 'snapshot'
  ].filter(name => typeof tags[name] === 'function').map(name => [name, tags[name]])) : null,
  favorites: favorites ? Object.fromEntries([
    'snapshot', 'series', 'sections', 'getEntry', 'list', 'saveSeries', 'saveSection', 'ensureTagColumns', 'saveEntry',
    'applyBatch', 'duplicateEntries', 'deleteEntries', 'deleteSection', 'deleteSeries', 'reorder',
    'setSeriesColors', 'search', 'copyText', 'markCopied', 'setSelected', 'selected', 'clearSelected',
    'undo', 'redo', 'historyState', 'subscribe', 'flush', 'exportBundle', 'previewImport', 'importBundle',
    'parseFavoritePaste', 'previewPaste', 'importPaste', 'validateFavoriteBundle', 'favoriteMemberCount', 'revision',
    'exportFile', 'previewImportFile', 'cancelImportPreview', 'getMigrationReport', 'exportMigrationFile'
  ].filter(name => typeof favorites[name] === 'function').map(name => [name, favorites[name]])) : null,
  joinFavoriteBlocks: modulesRef?.joinFavoriteBlocks,
  async prepareClose() {
    assistant?.cancel?.();
    const ready = await catalog?.ready?.();
    const catalogSaved = ready?.ok === false ? true : await catalog?.flush?.();
    if (catalogSaved === false) return false;
    const sessionsSaved = await assistant?.flushPersistence?.();
    const callsSaved = await assistant?.flushCallRecords?.();
    const settingsSaved = await storage?.flush?.();
    return catalogSaved !== false && sessionsSaved !== false && callsSaved !== false && settingsSaved !== false;
  },
  characters: characters ? Object.fromEntries([
    'get', 'copyText', 'page', 'series', 'select', 'selected', 'size', 'count', 'manifest', 'selectionText', 'removeSelection', 'clearSelection', 'edit', 'restore', 'editHistory'
  ].filter(name => typeof characters[name] === 'function').map(name => [name, characters[name]])) : null,
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
  preferences: storage ? {
    get: (key, fallback = null) => storage.get(key, fallback),
    set: (key, value) => storage.set(key, value),
    remove: key => storage.remove(key),
    onPersistenceError: storage.subscribeErrors,
    persistenceStatus: storage.persistenceStatus
  } : null,
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
    clearConversationImages: assistant.clearConversationImages,
    rerunFromMessage: assistant.rerunFromMessage,
    regenerateMessage: assistant.regenerateMessage,
    importSessions: assistant.importSessions,
    exportSessions: assistant.exportSessions,
    cancel: assistant.cancel,
    stop: assistant.stop,
    parseReply: assistant.parseReply,
    chooseCandidate: assistant.chooseCandidate,
    selectCandidate: assistant.selectCandidate,
    selectGenerationFinal: assistant.selectGenerationFinal,
    continueGeneration: assistant.continueGeneration,
    selectGenerationCharacter: assistant.selectGenerationCharacter,
    selectFeedbackCandidate: assistant.selectFeedbackCandidate,
    // 业务状态统一由 Assistant 持有，页面只通过这些薄方法读取或更新。
    getSettings: assistant.getSettings,
    setSettings: assistant.setSettings,
    updateSettings: assistant.updateSettings,
    snapshot: assistant.snapshot,
    listModels: assistant.listModels,
    listVisionModels: assistant.listVisionModels,
    testConnection: assistant.testConnection,
    ai: assistant.ai ? { listModels: assistant.listModels, getConfig: assistant.ai.getConfig } : null,
    visionAi: assistant.visionAi ? { listModels: assistant.listVisionModels, getConfig: assistant.visionAi.getConfig } : null,
    visionService: assistant.visionService ? { processOne: input => assistant.visionService.processOne(visionInputForRenderer(input)), available: assistant.visionService.available } : null,
    listCallRecords: assistant.listCallRecords,
    clearCallRecords: assistant.clearCallRecords,
    getCallMonitorInfo: assistant.getCallMonitorInfo,
    flushCallRecords: assistant.flushCallRecords,
    flushPersistence: assistant.flushPersistence,
  } : null,
  runtime: runtime ? {
    runPrimary: runtime.runPrimary,
    runSubAgent: runtime.runSubAgent,
    callTool: runtime.callTool,
    cancel: runtime.cancel,
    getStatus: runtime.getStatus,
    listTools: runtime.listTools
  } : null,
  primaryTools: primaryTools ? {
    list: primaryTools.list,
    schemas: primaryTools.schemas,
    openAiTools: primaryTools.openAiTools
  } : null,
  prompts: prompts ? {
    get: prompts.get,
    getEffective: prompts.getEffective,
    set: prompts.set,
    getDefault: prompts.getDefault,
    reset: prompts.reset,
    resetItem: prompts.resetItem,
    item: prompts.item,
    items: prompts.items,
    keys: prompts.keys,
    meta: prompts.meta,
    metadata: prompts.metadata,
    // 主提示词组。
    sets: prompts.sets,
    activeSetId: prompts.activeSetId,
    activeSet: prompts.activeSet,
    createSet: prompts.createSet,
    deleteSet: prompts.deleteSet,
    renameSet: prompts.renameSet,
    setActive: prompts.setActive,
    resetSet: prompts.resetSet,
    // 扩展提示词。
    extensions: prompts.extensions,
    createExtension: prompts.createExtension,
    updateExtension: prompts.updateExtension,
    deleteExtension: prompts.deleteExtension,
    matchExtensions: prompts.matchExtensions,
    // 组合与包。
    composePrimary: prompts.composePrimary,
    composeGenerate: prompts.composeGenerate,
    composeEvaluation: prompts.composeEvaluation,
    exportBundle: prompts.exportBundle,
    exportSet: prompts.exportSet,
    importBundle: prompts.importBundle,
    exportExtensions: prompts.exportExtensions,
    importExtensions: prompts.importExtensions,
    snapshot: prompts.snapshot
  } : null,
  comfy: comfy ? {
    check: async () => Boolean((await runtime?.callTool?.('comfy.status', {}, { caller: 'ui' }))?.data?.connected),
    status: comfy.status,
    objectInfo: comfy.objectInfo,
    setBase: value => assistant?.setSettings?.({ comfyBase: value }),
    setWorkflow: value => assistant?.setSettings?.({ comfyWorkflow: value }),
    importApiWorkflow: comfy.importApiWorkflow,
    analyze: comfy.analyze,
    profiles: comfy.profiles
  } : null,
  locales: localePacks,
  updates: updateBridge,
  version: '1.4.356'
});


