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
  const portableStoragePath = path.join(path.dirname(process.execPath), 'rewrite-storage.json');
  // 旧版测试包把设置放在 exe 同目录；首次切换到稳定用户目录时复制一份，避免重打包后丢失。
  try {
    if (!fs.existsSync(storagePath) && fs.existsSync(portableStoragePath)) {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.copyFileSync(portableStoragePath, storagePath);
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
    agentServer.start().catch(error => console.warn('[V1.4.131] Agent 工具服务启动失败：', error?.message || error));
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => { agentServer?.stop?.(); }, { once: true });
  }
  // Translation only needs the generic AiService, so it can be assembled
  // after Assistant without introducing a reverse dependency.
  translation = modules.createTranslation({ tags, runner: translationRunner, ai: assistant.ai });
  // 迁移标记已存在时，此次仅补导入需要 Assistant 实例的旧会话。
  migrateLegacyData({ storage, assistant, legacy: legacySnapshot });
} catch (error) {
  // 标签模块加载失败时仍让页面打开，便于人工看到错误并继续迭代。
  console.warn('[V1.4.131] 业务模块加载失败：', error && error.message ? error.message : error);
}

contextBridge.exposeInMainWorld('AppModules', {
  tags,
  images,
  imageStore: images ? {
    add: (input, meta) => images.add(input, meta),
    get: value => images.get(value),
    preview: value => images.preview(value),
    remove: value => images.remove(value),
    metadata: value => images.metadata(value),
    collectionIds: name => images.collectionIds(name),
    collectionList: name => images.collectionList(name),
    addToCollection: (name, value) => images.addTo(name, value),
    removeFromCollection: (name, value) => images.removeFrom(name, value),
    clearCollection: name => images.clearCollection(name)
  } : null,
  translation,
  assistant: assistant ? {
    run: assistant.run,
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
    visionService: assistant.visionService ? { processOne: assistant.visionService.processOne, available: assistant.visionService.available } : null,
    calls: assistant.calls ? { call: assistant.calls.call, list: assistant.calls.list, listAvailable: assistant.calls.listAvailable, listAgent: assistant.calls.listAgent, agentNames: assistant.calls.agentNames, schemas: assistant.calls.schemas, schemasAvailable: assistant.calls.schemasAvailable, schemasAgent: assistant.calls.schemasAgent, openAiTools: assistant.calls.openAiTools, openAiToolsAvailable: assistant.calls.openAiToolsAvailable, openAiToolsAgent: assistant.calls.openAiToolsAgent, getCapabilities: assistant.calls.getCapabilities, refreshCapabilities: assistant.calls.refreshCapabilities, invalidateCapabilities: assistant.calls.invalidateCapabilities, describe: assistant.calls.describe } : null
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
  calls: assistant?.calls ? { call: assistant.calls.call, list: assistant.calls.list, listAvailable: assistant.calls.listAvailable, listAgent: assistant.calls.listAgent, agentNames: assistant.calls.agentNames, schemas: assistant.calls.schemas, schemasAvailable: assistant.calls.schemasAvailable, schemasAgent: assistant.calls.schemasAgent, openAiTools: assistant.calls.openAiTools, openAiToolsAvailable: assistant.calls.openAiToolsAvailable, openAiToolsAgent: assistant.calls.openAiToolsAgent, getCapabilities: assistant.calls.getCapabilities, refreshCapabilities: assistant.calls.refreshCapabilities, invalidateCapabilities: assistant.calls.invalidateCapabilities, describe: assistant.calls.describe } : null,
  agent: agentServer ? { start: agentServer.start, stop: agentServer.stop, status: agentServer.status } : null,
  vision,
  visionService: assistant?.visionService ? { processOne: assistant.visionService.processOne, available: assistant.visionService.available } : null,
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
  version: '1.4.131'
});
