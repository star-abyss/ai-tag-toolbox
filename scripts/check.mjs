/*
 * 快速自检：只验证重写项目能被 Node 加载、素材能读到、核心模块有最小
 * 可用结果。它不启动 Electron，也不做联网或模型回归，方便小步迭代。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const files = [];
function collect(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (entry.isFile() && full.endsWith('.js')) files.push(full);
  }
}
collect(root);
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || `语法检查失败：${file}\n`);
    process.exit(1);
  }
}

const modules = require(path.join(root, 'src', 'modules'));

// Task 5 compact call protocol contract (red first; implementation follows).
async function runCompactCallProtocolTests() {
  const { extractAssistantCalls, normaliseCall, execute, planImageContext, callTable, getCallDefinition, adaptLegacyCall } = modules;
  if (typeof extractAssistantCalls !== 'function' || typeof normaliseCall !== 'function' || typeof execute !== 'function' || typeof planImageContext !== 'function' || !callTable) {
    throw new Error('Compact call protocol exports missing');
  }
  if (callTable.images.resultFormatter !== 'compactImageManifest' || callTable.images.scope !== 'current-session' || callTable.images.defaults.scope !== 'currentSession' || callTable.images.defaults.filter !== 'all') throw new Error('Call table images contract mismatch');
  if (callTable.vision.resultFormatter !== 'compactVisionResult' || callTable.vision.defaults.includeLocalTags !== true || callTable.vision.scope !== 'current-session-or-current-vision-temp' || !callTable.vision.aliases.includes('conversation.images.read')) throw new Error('Call table vision contract mismatch');
  if (callTable.render.aiInput.prompt.maxLength !== 4000 || callTable.render.aiInput.negative.maxLength !== 2000 || callTable.render.aiInput.iterations.max !== 10) throw new Error('Call table render limits mismatch');
  if (callTable.title.resultFormatter !== 'compactTitleResult' || callTable.title.permission !== 'conversation-metadata-write' || callTable.title.maxPerRound !== 3 || !callTable.title.aliases.includes('N') || getCallDefinition('N').name !== 'title') throw new Error('Call table title alias mismatch');
  if (getCallDefinition('tags').name !== 'search' || getCallDefinition('Q').name !== 'search' || getCallDefinition('N').name === 'search') throw new Error('Call table search alias mismatch');
  const extracted = extractAssistantCalls('before\n{"call":"search","query":"blue hair","unknown":"drop"}\nafter');
  if (extracted.calls.length !== 1 || extracted.calls[0].call !== 'search' || extracted.visibleText.includes('"blue hair"')) throw new Error('Compact JSON line extraction failed');
  const malformedFence = extractAssistantCalls('before\n```json\n{"call":"search","query":\n```\nafter');
  if (!malformedFence.errors?.length || /call|```/i.test(malformedFence.visibleText)) throw new Error('Malformed compact JSON was silently accepted or leaked');
  const malformedMarker = extractAssistantCalls('before\n<tool_call>{"call":"search","query":\n');
  if (!malformedMarker.errors?.length || /tool_call|"call"/i.test(malformedMarker.visibleText)) throw new Error('Malformed tool marker was silently accepted or leaked');
  const completeFunctionMarker = extractAssistantCalls('<function_call>{"call":"search","query":"marker"}</function_call>');
  const completePipeMarker = extractAssistantCalls('<|tool_call|>{"call":"search","query":"pipe"}<|end_tool_call|>');
  const completeChatMlMarker = extractAssistantCalls('<｜tool▁call▁begin｜>{"call":"search","query":"chatml"}<｜tool▁call▁end｜>');
  if (completeFunctionMarker.calls.length !== 1 || completeFunctionMarker.visibleText || completePipeMarker.calls.length !== 1 || completePipeMarker.visibleText || completeChatMlMarker.calls.length !== 1 || completeChatMlMarker.visibleText) throw new Error('完整兼容 tool marker 未解析或未从正文清理');
  const fenced = extractAssistantCalls('前文\n```json\n{"call":"render","prompt":"1girl","workflow":{"secret":true}}\n```\n后文');
  if (fenced.calls.length !== 1 || fenced.calls[0].prompt !== '1girl' || fenced.visibleText.includes('```')) throw new Error('Compact JSON fenced extraction failed');
  if (extractAssistantCalls('解释 {"call":"search","query":"x"}').calls.length) throw new Error('Inline JSON must not execute');
  const context = {
    sessionId: 's1', settings: { autoRender: false, comfyIters: 12 },
    imageRepository: { listConversation: () => ({ items: [{ sessionId: 's1', refId: 'ref-1', imageId: 'img-1', slotNo: 1, displayTitle: 'Hero', pending: true, candidateId: 'cand-1' }, { sessionId: 's2', refId: 'other-ref', imageId: 'other-img', slotNo: 2, displayTitle: 'Other' }] }) },
    visionTempStore: { current: () => ({ kind: 'external-temp', tempId: 'temp-1' }) }
  };
  const search = normaliseCall({ call: 'tags_search', query: 'x'.repeat(300), precision: 'bad', ignored: 'secret' }, context);
  if (search.ok || search.code !== 'INVALID_ARGUMENT') throw new Error('Compact length enforcement failed');
  const searchDefaults = normaliseCall({ call: 'tags_search', query: 'blue hair', precision: 'bad', ignored: 'secret' }, context);
  if (!searchDefaults.ok || searchDefaults.variables.precision !== 'standard' || Object.keys(searchDefaults.variables).some(key => key === 'ignored')) throw new Error('Compact field filtering/defaults failed');
  const vision = normaliseCall({ call: 'vision', image: 'Hero', mode: 'ai', imagePath: 'C:\\secret.png' }, context);
  if (!vision.ok || vision.variables.imageId !== 'img-1' || vision.variables.includeLocalTags !== true || JSON.stringify(vision).includes('secret.png')) throw new Error('Compact image scope/redaction failed');
  if (normaliseCall({ call: 'vision', image: 'Other' }, context).ok) throw new Error('Cross-session image reference accepted');
  if (!normaliseCall({ call: 'vision', image: '临时图' }, context).ok) throw new Error('Active temporary image alias rejected');
  const render = normaliseCall({ call: 'R', prompt: '1girl', workflow: { hidden: true } }, context);
  if (!render.ok || render.variables.workflow || render.variables.prompt !== '1girl') throw new Error('Compact render filtering failed');
  const legacy = normaliseCall({ function: { name: 'tags_search', arguments: '{"query":"blue"}' } }, context);
  if (!legacy.ok || legacy.call !== 'search' || legacy.variables.query !== 'blue') throw new Error('Legacy compact alias adaptation failed');
  if (!normaliseCall({ tool_calls: [{ function: { name: 'tags_search', arguments: '{"query":"blue"}' } }] }, context).ok) throw new Error('Native tool_calls adapter failed');
  if (!normaliseCall([{ function: { name: 'tags_search', arguments: '{"query":"blue"}' } }], context).ok) throw new Error('Native tool_calls array adapter failed');
  if (!normaliseCall({ tool_calls: { function: { name: 'vision_processOne', arguments: '{"imageId":"img-1"}' } } }, context).ok) throw new Error('Legacy Vision imageId adapter failed');
  const marked = extractAssistantCalls('<tool_call>{"name":"tags_search","arguments":{"query":"blue"}}</tool_call>');
  if (marked.calls.length !== 1 || marked.visibleText) throw new Error('Legacy tool_call marker adapter failed');
  const confirmation = await execute(render, { ...context, calls: { call: async () => ({ ok: true, data: { artifact: { id: 'a', path: 'C:\\secret.png', dataUrl: 'data:image/png;base64,AA==' } } }) } });
  if (confirmation.ok !== true || confirmation.status !== 'confirmation_required' || JSON.stringify(confirmation).includes('secret.png')) throw new Error('Compact render confirmation/redaction failed');
  const planned = planImageContext({ sessionId: 's1', userText: '请看图1和 Hero', pendingRefIds: ['ref-1'], imageRepository: context.imageRepository });
  if (!planned.manifest?.[0] || planned.manifest.length !== 1 || planned.manifest[0].imageId !== 'img-1' || planned.manifest.some(item => item.dataUrl) || !planned.explicitRefs.includes('ref-1') || !planned.attachRefs.includes('ref-1') || !planned.toolReadableRefs.includes('ref-1')) throw new Error('Compact image context planning failed');
  const manifestJson = JSON.stringify(planned.manifest);
  if (/\b(?:refId|imageId)\b/.test(manifestJson) || !planned.manifest.every(item => Object.keys(item).every(key => ['label', 'title', 'source', 'candidateId', 'pending', 'final'].includes(key)))) throw new Error('AI 图片 manifest 暴露了内部 ID');
  const missingPlan = planImageContext({ sessionId: 's1', userText: '请看图99', imageRepository: context.imageRepository });
  if (!missingPlan.errors?.length || !/99/.test(missingPlan.errors[0])) throw new Error('Missing natural-language image reference was not reported');
  const casePlan = planImageContext({ sessionId: 's1', userText: 'please inspect hero', imageRepository: context.imageRepository });
  if (!casePlan.explicitRefs.includes('ref-1')) throw new Error('Case-insensitive image title reference was not resolved');
  const shortTitlePlan = planImageContext({ sessionId: 's1', userText: 'please educate me', imageRepository: { listConversation: () => ({ items: [{ sessionId: 's1', refId: 'cat-ref', imageId: 'cat-image', slotNo: 1, displayTitle: 'cat' }] }) } });
  if (shortTitlePlan.explicitRefs.length || shortTitlePlan.attachRefs.length) throw new Error('普通文本子串被误判为图片引用');
  const overlappingTitlePlan = planImageContext({ sessionId: 's1', userText: 'please inspect "blue hair"', imageRepository: { listConversation: () => ({ items: [{ sessionId: 's1', refId: 'title-a', imageId: 'title-a', slotNo: 1, displayTitle: 'blue' }, { sessionId: 's1', refId: 'title-b', imageId: 'title-b', slotNo: 2, displayTitle: 'blue hair' }] }) } });
  if (!overlappingTitlePlan.errors?.length || overlappingTitlePlan.explicitRefs.length) throw new Error('重叠图片标题未在发送前阻止歧义');
  const duplicateTitleContext = {
    sessionId: 's1',
    imageRepository: { listConversation: () => ({ items: [{ sessionId: 's1', refId: 'hero-a', imageId: 'hero-a', slotNo: 1, displayTitle: 'Hero' }, { sessionId: 's1', refId: 'hero-b', imageId: 'hero-b', slotNo: 2, displayTitle: 'Hero' }] }) }
  };
  const duplicateTitlePlan = planImageContext({ sessionId: 's1', userText: 'please inspect Hero', imageRepository: duplicateTitleContext.imageRepository });
  if (!duplicateTitlePlan.errors?.some(error => /不唯一|唯一/.test(error))) throw new Error('Duplicate natural-language image title was not reported');
  const galleryOnlyContext = {
    sessionId: 'empty-session',
    imageRepository: { listConversation: () => ({ items: [] }), listGallery: () => ({ items: [{ imageId: 'gallery-secret', displayName: 'Secret' }] }) }
  };
  if (normaliseCall({ call: 'vision', image: 'Secret' }, galleryOnlyContext).ok || normaliseCall({ call: 'vision', image: 'gallery-secret' }, galleryOnlyContext).ok) throw new Error('Detached gallery image crossed compact Vision scope');
  const renderDefault = normaliseCall({ call: 'render', prompt: 'x' }, { ...context, settings: { comfyIters: 99 } });
  if (!renderDefault.ok || renderDefault.variables.iterations !== 10) throw new Error('Render settings default range failed');
  const titleNoAdapter = await execute(normaliseCall({ call: 'title', image: 'ref-1', text: 'Renamed' }, context), { ...context, allowWrite: true });
  if (titleNoAdapter.code !== 'EXECUTOR_UNAVAILABLE') throw new Error('Unsafe title gallery fallback remains');
  const routed = [];
  const executorContext = {
    ...context, allowWrite: true, allowRender: true, confirmRender: true,
    calls: { call: async (name) => { routed.push(name); if (name === 'tags.search') return { ok: true, data: { items: [{ en: 'blue', zh: '蓝', category: 'hair', path: 'C:\\private' }] } }; if (name === 'vision.processOne') return { ok: true, data: { text: 'blue hair', tags: [{ tag: 'blue hair' }], dataUrl: 'data:image/png;base64,AA==' } }; if (name === 'comfy.render') return { ok: true, data: { artifact: { id: 'a1', path: 'C:\\private', dataUrl: 'data:image/png;base64,AA==', workflow: { secret: true } } } }; return { ok: true, data: { items: [{ refId: 'ref-1', imageId: 'img-1', displayTitle: 'Hero' }] } }; } }
  };
  const executionCalls = [
    normaliseCall({ call: 'images' }, executorContext),
    normaliseCall({ call: 'search', query: 'blue' }, executorContext),
    normaliseCall({ call: 'vision', image: 'ref-1' }, executorContext),
    normaliseCall({ call: 'render', prompt: '1girl' }, executorContext),
    normaliseCall({ call: 'title', image: 'ref-1', text: 'Hero 2' }, executorContext)
  ];
  for (const item of executionCalls) { const outcome = await execute(item, executorContext); if (!outcome.ok || JSON.stringify(outcome).match(/data:image|workflow|private/)) throw new Error('Compact executor summary leaked sensitive fields'); }
  if (!['conversation.images.list', 'tags.search', 'vision.processOne', 'comfy.render', 'conversation.images.setTitle'].every(name => routed.includes(name))) throw new Error('Compact executor routing incomplete');
  if ((await execute(executionCalls[4], { ...executorContext, allowWrite: false })).code !== 'PERMISSION_DENIED') throw new Error('Compact write permission denial failed');
}
await runCompactCallProtocolTests();

async function runVisionTempStoreTests() {
  const createVisionTempStore = modules.createVisionTempStore;
  if (typeof createVisionTempStore !== 'function') throw new Error('VisionTempStore 工厂尚未导出');
  const images = modules.createImages({ storage: modules.createStorage({ prefix: 'check-vision-temp-images' }) });
  images.add({ id: 'library-image', filename: 'library.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload' });
  images.add({ id: 'secret-image', filename: 'secret.png', bytes: Buffer.from([9, 8, 7]), mime: 'image/png', source: 'upload' });
  const repository = {
    get: id => images.get(id),
    getBytes: id => images.getBytes(id),
    listConversation: sessionId => ({ items: sessionId === 'session-1' ? [{ sessionId, refId: 'ref-1', imageId: 'library-image' }] : [] }),
    listGallery: () => ({ items: [{ imageId: 'library-image' }] })
  };
  const aborted = [];
  const released = [];
  const deleted = [];
  const store = createVisionTempStore({ images: repository, imageRepository: repository, onAbort: id => aborted.push(id), onReleasePreview: url => released.push(url), deleteTemp: item => deleted.push(item.kind) });
  const library = store.setLibraryReference('library-image', { kind: 'external-temp', imageId: 'forged-id' });
  if (library?.kind !== 'library' || library.imageId !== 'library-image' || store.current()?.imageId !== 'library-image') throw new Error('Vision 临时存储没有复用图库 imageId');
  if (store.setLibraryReference('stable-later-id') !== null) throw new Error('Vision 临时存储登记了尚未授权的稳定 imageId');
  store.setLibraryReference('library-image');
  if (store.resolveForVision('secret-image') !== null || await store.getBytes('secret-image') !== null) throw new Error('Vision 临时存储在槽不匹配时回退读取了全局图片');
  store.setLibraryReference('library-image');
  const conversation = store.setConversationReference('library-image', { sessionId: 'session-1', refId: 'ref-1' });
  if (conversation?.kind !== 'conversation' || conversation.imageId !== 'library-image' || conversation.sessionId !== 'session-1') throw new Error('Vision 临时存储没有复用会话引用');
  store.setLibraryReference('library-image');
  if (deleted.length) throw new Error('替换稳定图库引用错误调用临时资源删除器');
  store.setConversationReference('library-image', { sessionId: 'session-1' });
  store.clear();
  if (deleted.length) throw new Error('清空稳定会话引用错误调用临时资源删除器');
  const first = store.replaceExternal({ tempId: 'temp-one', bytes: Buffer.from([1, 2, 3]), mime: 'image/png', previewUrl: 'blob:first' });
  const firstController = new AbortController();
  store.replaceExternal({ tempId: 'temp-controller', bytes: Buffer.from([6]), controller: firstController });
  const second = store.replaceExternal({ tempId: 'temp-two', bytes: Buffer.from([4, 5]), mime: 'image/jpeg', previewUrl: 'blob:second' });
  if (first?.kind !== 'external-temp' || second?.tempId !== 'temp-two' || store.current()?.tempId !== 'temp-two') throw new Error('Vision 临时存储替换没有保持单槽');
  if (!aborted.includes('temp-one') || !released.includes('blob:first')) throw new Error('Vision 临时存储替换没有失效旧请求或释放预览 URL');
  if (!firstController.signal.aborted || images.get('temp-two') || images.list().some(item => item.source === 'vision' || item.source === 'external-temp') || images.snapshot().items.some(item => item.id === 'temp-two')) throw new Error('Vision 外部临时图片污染了 Images');
  if (!deleted.length || deleted.some(kind => kind !== 'external-temp')) throw new Error('临时资源删除器没有只处理 external-temp');
  const resolved = store.resolveForVision('temp-two');
  if (!resolved?.tempId || resolved.kind !== 'external-temp' || !Buffer.from(resolved.bytes).equals(Buffer.from([4, 5]))) throw new Error('Vision 临时存储没有提供受控 bytes 解析');
  store.clear();
  if (store.current() !== null || !released.includes('blob:second') || store.clear()?.cleared !== false) throw new Error('Vision 临时存储 clear 语义错误');
  const serviceStore = createVisionTempStore({ images: repository });
  serviceStore.replaceExternal({ tempId: 'service-temp', bytes: Buffer.from([9, 8, 7]), mime: 'image/png' });
  const visionService = modules.createVisionService({ visionTempStore: serviceStore, images: repository });
  const serviceResult = await visionService.processOne({ tempId: 'service-temp', mode: 'metadata' });
  if (serviceResult?.ok !== true || serviceResult.imageId !== 'service-temp') throw new Error('Vision Service 未接入 tempId 解析');

  let unsafeUrlMessages = null;
  const unsafeUrlService = modules.createVisionService({
    images: {
      get: id => id === 'file-image' ? { id, filename: 'file.png', url: 'file:///C:/private/file.png', mime: 'image/png' } : null,
      getBytes: id => id === 'file-image' ? Buffer.from([1, 2, 3]) : null
    },
    visionAI: {
      complete: async messages => { unsafeUrlMessages = messages; return { ok: true, text: 'safe' }; },
      getConfig: () => ({ model: 'check-vision' })
    }
  });
  const unsafeUrlResult = await unsafeUrlService.processOne({ imageId: 'file-image', mode: 'ai' });
  const sentUrl = unsafeUrlMessages?.[1]?.content?.find?.(part => part?.type === 'image_url')?.image_url?.url || '';
  if (!unsafeUrlResult.ok || !/^data:image\//i.test(sentUrl) || /file:|blob:/i.test(sentUrl)) throw new Error('Vision 非法 URL 未物化为受控 data URL');
  let strictProviderCalls = 0;
  const strictServiceStore = createVisionTempStore({ images, imageRepository: repository });
  strictServiceStore.setLibraryReference('library-image');
  const strictService = modules.createVisionService({
    images,
    visionTempStore: strictServiceStore,
    visionAI: { complete: async () => { strictProviderCalls += 1; return { ok: true, text: 'should not run' }; }, getConfig: () => ({ model: 'check-vision' }) }
  });
  const strictForeign = await strictService.processOne({ imageId: 'secret-image', mode: 'ai' });
  if (strictForeign.ok || strictForeign.code !== 'IMAGE_NOT_FOUND' || strictProviderCalls) throw new Error('Vision Service 仍可从活动槽旁路读取全局图片');
  const strictCalls = modules.createCalls({ images, visionTempStore: strictServiceStore, visionService: strictService, getCurrentSessionId: () => 'session-1' });
  const strictCallForeign = await strictCalls.call('vision.processOne', { imageId: 'secret-image', mode: 'metadata' }, { sessionId: 'other-session' });
  if (strictCallForeign.ok || strictCallForeign.code !== 'IMAGE_NOT_FOUND') throw new Error('Calls 入口未沿用当前会话 Vision 授权边界');
  let malformedDataProviderCalls = 0;
  const malformedDataService = modules.createVisionService({
    images: { get: id => id === 'malformed-data-image' ? { id, dataUrl: 'data:image/png;base64,NOT_BASE64!!!', mime: 'image/png' } : null },
    visionAI: { complete: async () => { malformedDataProviderCalls += 1; return { ok: true, text: 'should not run' }; }, getConfig: () => ({ model: 'check-vision' }) }
  });
  const malformedDataResult = await malformedDataService.processOne({ imageId: 'malformed-data-image', mode: 'ai' });
  if (malformedDataResult.ok || malformedDataProviderCalls !== 0 || !['UNSAFE_IMAGE_URL', 'IMAGE_DATA_UNAVAILABLE'].includes(malformedDataResult.code)) throw new Error('malformed data URL 未被拦截或仍调用 Vision provider');
  const emptyDataService = modules.createVisionService({
    images: { get: id => id === 'empty-data-image' ? { id, dataUrl: 'data:image/png,', mime: 'image/png' } : null },
    visionAI: { complete: async () => { malformedDataProviderCalls += 1; return { ok: true, text: 'should not run' }; }, getConfig: () => ({ model: 'check-vision' }) }
  });
  const emptyDataResult = await emptyDataService.processOne({ imageId: 'empty-data-image', mode: 'ai' });
  if (emptyDataResult.ok || malformedDataProviderCalls !== 0) throw new Error('空 payload data URL 未被拦截');
  const realBadImageStorage = modules.createStorage({ prefix: 'check-real-bad-data-image' });
  const realBadImages = modules.createImages({ storage: realBadImageStorage });
  const realBadAsset = realBadImages.add({ id: 'real-bad-data-image', filename: 'bad.png', dataUrl: 'data:image/png;base64,NOT_BASE64!!!', mime: 'image/png', source: 'upload' });
  let realBadProviderCalls = 0;
  const realBadService = modules.createVisionService({
    images: realBadImages,
    visionAI: { complete: async () => { realBadProviderCalls += 1; return { ok: true, text: 'should not run' }; }, getConfig: () => ({ model: 'check-vision' }) }
  });
  const realBadResult = await realBadService.processOne({ imageId: 'real-bad-data-image', mode: 'ai' });
  if (!realBadAsset || realBadAsset.dataUrl || realBadImages.getBytes('real-bad-data-image') || realBadResult.ok || realBadProviderCalls !== 0) throw new Error('createImages 仍将坏 data URL 物化或送入 Vision provider');
  const realGoodAsset = realBadImages.add({ id: 'real-good-data-image', filename: 'good.png', dataUrl: 'data:image/png;base64,AA==', mime: 'image/png', source: 'upload' });
  if (!realGoodAsset?.dataUrl || !realBadImages.getBytes('real-good-data-image')?.length) throw new Error('合法 data URL 未保持 bytes 物化');
  const galleryUiStorage = modules.createStorage({ prefix: 'check-gallery-ui-vision' });
  const galleryUiImages = modules.createImages({ storage: galleryUiStorage });
  galleryUiImages.add({ id: 'gallery-ui-image', filename: 'gallery-ui.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload' });
  const galleryUiAssistant = modules.createAssistant({ images: galleryUiImages, storage: galleryUiStorage, primaryApi: { base: 'https://example.test/v1', model: 'text-model' } });
  const galleryUiSession = galleryUiAssistant.currentSession();
  galleryUiAssistant.imageRepository.addToGallery('gallery-ui-image');
  if (!galleryUiAssistant.visionTempStore.setLibraryReference('gallery-ui-image')) throw new Error('图库图片未能设置为当前 Vision 槽');
  const galleryUiResult = await galleryUiAssistant.calls.call('vision.processOne', { imageId: 'gallery-ui-image', mode: 'metadata' }, { caller: 'ui', sessionId: galleryUiSession.id });
  if (!galleryUiResult?.ok || galleryUiResult.imageId !== 'gallery-ui-image') throw new Error('UI 当前 session 绑定导致图库 Vision 槽误报 IMAGE_NOT_FOUND');
}
await runVisionTempStoreTests();

// These integration assertions protect the image relationship store rather
// than its implementation details. A broken ownership or migration branch
// must make one of the observable lifecycle outcomes below fail.
function runImageRepositoryTests() {
  const storage = modules.createStorage({ prefix: 'check-image-repository' });
  const images = modules.createImages({ storage });
  const sessions = [
    { id: 'session-one', title: '第一会话', messages: [{ id: 'legacy-message', role: 'user', imageIds: ['legacy-message-image'] }] },
    { id: 'session-two', title: '第二会话', messages: [] }
  ];
  const add = (id, collection = '') => images.add({ id, filename: `${id}.png`, dataUrl: 'data:image/png;base64,AA==', source: 'upload' }, collection ? { collection } : {});
  add('legacy-talk-image', 'talk');
  add('legacy-comfy-image', 'comfy');
  add('legacy-message-image');
  add('owned-delete-image');
  add('shared-image');
  add('later-image');

  const repository = modules.createImageRepository({ storage, images, sessions: () => sessions });
  const migrated = repository.listConversation('session-one').items;
  if (migrated.length !== 2 || migrated[0].imageId !== 'legacy-talk-image' || migrated[0].slotNo !== 1 || migrated[1].imageId !== 'legacy-message-image' || migrated[1].slotNo !== 2) {
    throw new Error('图片仓库没有按旧 talk 集合和消息图片迁移为稳定会话关联');
  }
  if (repository.listGallery({ order: 'oldest' }).items.map(item => item.imageId).join(',') !== 'legacy-comfy-image') {
    throw new Error('无法归属会话的旧 comfy 图片没有迁移到独立图库');
  }
  if (modules.createImageRepository({ storage, images, sessions: () => sessions }).listConversation('session-one').items.length !== 2) {
    throw new Error('图片仓库迁移重复创建了会话关联');
  }

  const removed = repository.removeFromConversation('session-one', migrated[1].refId);
  const later = repository.attachToConversation('session-one', 'later-image', { source: 'upload' });
  if (!removed.removed || later.slotNo !== 3) throw new Error('会话图片编号在删除后被复用');

  const owned = repository.attachToConversation('session-one', 'owned-delete-image', { source: 'upload' });
  const promoted = repository.promoteConversationImages('session-one', [migrated[0].refId]);
  const shared = repository.attachToConversation('session-two', 'legacy-talk-image', { source: 'gallery' });
  if (promoted.promoted.join(',') !== 'legacy-talk-image' || shared.ownership !== 'shared-gallery') {
    throw new Error('图片转入图库后没有保持稳定 ID 或共享归属');
  }
  const renamed = repository.renameGalleryImage('legacy-talk-image', '迁移后的正式名称');
  if (renamed.imageId !== 'legacy-talk-image' || repository.listGallery({ order: 'oldest' }).items.find(item => item.imageId === 'legacy-talk-image')?.displayName !== '迁移后的正式名称') {
    throw new Error('图库重命名错误改变了稳定图片 ID 或未更新显示名');
  }
  repository.setPending('session-one', owned.refId, true);
  const cleared = repository.clearSessionContent('session-one');
  if (cleared.removedMessages !== 1 || cleared.retainedImages !== 3 || cleared.resetPending !== 1 || repository.listConversation('session-one').pendingIds.length !== 0) {
    throw new Error('清空对话错误删除图片或未复位待发送状态');
  }

  const deleted = repository.deleteSession('session-one');
  if (deleted.deletedImages !== 2 || images.get('owned-delete-image') || images.get('later-image') || !images.get('legacy-talk-image')) {
    throw new Error('删除会话没有仅物理删除无引用的会话专属图片');
  }
  const counts = repository.referenceCount('legacy-talk-image');
  if (counts.gallery !== 1 || counts.conversations !== 1 || counts.messages !== 0 || counts.total !== 2) {
    throw new Error('图片引用计数没有覆盖图库与会话关联');
  }

  const retained = repository.deleteSession('session-two', { retainImages: true });
  if (retained.promotedImages !== 0 || !images.get('legacy-talk-image') || repository.listGallery({ order: 'oldest' }).total !== 2) {
    throw new Error('删除共享图片会话错误改变图库实体');
  }
}
runImageRepositoryTests();

function runImageRepositoryMigrationLifecycleTests() {
  const storage = modules.createStorage({ prefix: 'check-image-repository-lifecycle' });
  const images = modules.createImages({ storage });
  images.add({ id: 'legacy-talk-lifecycle', filename: 'legacy-talk.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload' }, { collection: 'talk' });
  const assistant = modules.createAssistant({ storage, images, primaryApi: { base: 'https://example.test/v1', model: 'test-model' } });
  assistant.importSessions([{ id: 'legacy-session', title: '旧会话', messages: [{ id: 'legacy-message', role: 'user', imageIds: ['legacy-talk-lifecycle'] }] }], true);
  const migrated = assistant.imageRepository.listConversation('legacy-session').items;
  const persisted = storage.get('conversation_image_refs', []);
  if (migrated.length !== 1 || migrated[0].imageId !== 'legacy-talk-lifecycle' || persisted.some(item => item.sessionId !== 'legacy-session')) {
    throw new Error('两阶段 Assistant 导入没有把旧 talk 图片关联到导入后的有效会话');
  }
  assistant.imageRepository.promoteConversationImages('legacy-session', [migrated[0].refId]);
  assistant.deleteSession('legacy-session');
  const restarted = modules.createAssistant({ storage, images, primaryApi: { base: 'https://example.test/v1', model: 'test-model' } });
  if (restarted.imageRepository.listConversation(restarted.currentSession().id).total || restarted.imageRepository.listConversation(restarted.currentSession().id).items.length || restarted.imageRepository.listGallery({ order: 'oldest' }).items.map(item => item.imageId).join(',') !== 'legacy-talk-lifecycle') {
    throw new Error('迁移检查点没有阻止重启后把已转入图库的旧 talk 图片重新附加到新会话');
  }
}
runImageRepositoryMigrationLifecycleTests();

function runImageRepositoryOrphanTests() {
  const storage = modules.createStorage({ prefix: 'check-image-repository-orphans' });
  const images = modules.createImages({ storage });
  const sessions = [{ id: 'orphan-session', messages: [] }];
  images.add({ id: 'gallery-orphan', filename: 'gallery-orphan.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload' });
  images.add({ id: 'shared-orphan', filename: 'shared-orphan.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload' });
  const repository = modules.createImageRepository({ storage, images, sessions: () => sessions });
  repository.addToGallery('gallery-orphan');
  const galleryRemoved = repository.removeFromGallery('gallery-orphan');
  if (!galleryRemoved.removed || galleryRemoved.imageStillReferenced || images.get('gallery-orphan')) {
    throw new Error('移除最后一个图库关联没有物理删除孤立图片');
  }
  repository.addToGallery('shared-orphan');
  const shared = repository.attachToConversation('orphan-session', 'shared-orphan', { source: 'gallery' });
  repository.removeFromGallery('shared-orphan');
  if (!images.get('shared-orphan')) throw new Error('仍有会话关联时错误删除图片实体');
  sessions[0].messages.push({ id: 'orphan-message', imageIds: ['shared-orphan'] });
  repository.removeFromConversation('orphan-session', shared.refId);
  if (!images.get('shared-orphan')) throw new Error('仍有消息关联时错误删除图片实体');
  sessions[0].messages = [];
  repository.addToGallery('shared-orphan');
  repository.removeFromGallery('shared-orphan');
  if (images.get('shared-orphan') || repository.referenceCount('shared-orphan').total !== 0) {
    throw new Error('最后一个图库/会话/消息引用移除后没有删除孤立图片');
  }
}
runImageRepositoryOrphanTests();

function runImageRepositoryFinalizeMigrationTests() {
  const storage = modules.createStorage({ prefix: 'check-image-repository-finalize' });
  const images = modules.createImages({ storage });
  images.add({ id: 'deferred-talk', filename: 'deferred-talk.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload' }, { collection: 'talk' });
  images.add({ id: 'deferred-comfy', filename: 'deferred-comfy.png', dataUrl: 'data:image/png;base64,AA==', source: 'comfy' }, { collection: 'comfy' });
  const assistant = modules.createAssistant({ storage, images, primaryApi: { base: 'https://example.test/v1', model: 'test-model' } });
  const startup = assistant.currentSession();
  assistant.imageRepository.finalizeMigration();
  if (assistant.imageRepository.listConversation(startup.id).items.map(item => item.imageId).join(',') !== 'deferred-talk' || assistant.imageRepository.listGallery({ order: 'oldest' }).items.map(item => item.imageId).join(',') !== 'deferred-comfy') {
    throw new Error('无旧会话启动后未最终化迁移尚未归属的 talk/comfy 图片');
  }

  const importedStorage = modules.createStorage({ prefix: 'check-image-repository-finalize-import' });
  const importedImages = modules.createImages({ storage: importedStorage });
  importedImages.add({ id: 'import-talk', filename: 'import-talk.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload' }, { collection: 'talk' });
  const importedAssistant = modules.createAssistant({ storage: importedStorage, images: importedImages, primaryApi: { base: 'https://example.test/v1', model: 'test-model' } });
  importedAssistant.importSessions([{ id: 'imported-session', title: '导入会话', messages: [] }], true);
  const importedRefs = importedAssistant.imageRepository.listConversation('imported-session').items;
  if (importedRefs.length !== 1 || importedRefs[0].imageId !== 'import-talk' || importedRefs[0].sessionId !== 'imported-session') {
    throw new Error('两阶段导入最终化迁移没有绑定有效会话');
  }
  importedAssistant.imageRepository.promoteConversationImages('imported-session', [importedRefs[0].refId]);
  importedAssistant.deleteSession('imported-session');
  const restarted = modules.createAssistant({ storage: importedStorage, images: importedImages, primaryApi: { base: 'https://example.test/v1', model: 'test-model' } });
  const restartedSession = restarted.currentSession();
  restarted.imageRepository.finalizeMigration();
  if (restarted.imageRepository.listConversation(restartedSession.id).items.length || restarted.imageRepository.listGallery({ order: 'oldest' }).items.map(item => item.imageId).join(',') !== 'import-talk') {
    throw new Error('重启最终化迁移复活了已删除启动会话或重复处理图库图片');
  }
}
runImageRepositoryFinalizeMigrationTests();

function runImageRepositoryImportAfterFinalizeTests() {
  const storage = modules.createStorage({ prefix: 'check-image-repository-import-after-finalize' });
  const images = modules.createImages({ storage });
  images.add({ id: 'late-import-talk', filename: 'late-import-talk.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload' }, { collection: 'talk' });
  const assistant = modules.createAssistant({ storage, images, primaryApi: { base: 'https://example.test/v1', model: 'test-model' } });
  const startup = assistant.currentSession();
  assistant.importSessions([{ id: 's-import', title: '后续导入', messages: [] }], true);
  if (assistant.imageRepository.listConversation('s-import').items.map(item => item.imageId).join(',') !== 'late-import-talk' || assistant.imageRepository.listConversation(startup.id).items.length) {
    throw new Error('先访问当前会话再导入时，旧 talk 图片没有从启动会话转移到有效导入会话');
  }

  const removed = assistant.imageRepository.listConversation('s-import').items[0];
  assistant.imageRepository.removeFromConversation('s-import', removed.refId);
  assistant.importSessions([{ id: 's-import-again', title: '再次导入', messages: [] }], true);
  if (assistant.imageRepository.listConversation('s-import-again').items.length) {
    throw new Error('用户明确移除的旧 talk 图片被后续导入重新附加');
  }
}
runImageRepositoryImportAfterFinalizeTests();

function runImageRepositoryReconciliationContractTests() {
  const pendingStorage = modules.createStorage({ prefix: 'check-image-repository-pending-filter' });
  const pendingImages = modules.createImages({ storage: pendingStorage });
  const pendingSessions = [{ id: 'pending-session', messages: [] }];
  pendingImages.add({ id: 'pending-image', filename: 'pending.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload' });
  pendingImages.add({ id: 'ready-image', filename: 'ready.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload' });
  const pendingRepository = modules.createImageRepository({ storage: pendingStorage, images: pendingImages, sessions: () => pendingSessions });
  pendingRepository.attachToConversation('pending-session', 'pending-image', { source: 'upload', pending: true });
  pendingRepository.attachToConversation('pending-session', 'ready-image', { source: 'upload' });
  const withoutPending = pendingRepository.listConversation('pending-session', { includePending: false });
  if (withoutPending.items.map(item => item.imageId).join(',') !== 'ready-image' || withoutPending.pendingIds.length) {
    throw new Error('listConversation(includePending:false) 仍返回待发送图片');
  }

  const danglingStorage = modules.createStorage({ prefix: 'check-image-repository-reconcile-orphan' });
  const danglingImages = modules.createImages({ storage: danglingStorage });
  danglingImages.add({ id: 'dangling-image', filename: 'dangling.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload' });
  danglingStorage.set('conversation_image_refs', [{ refId: 'dangling-ref', sessionId: 'missing-session', imageId: 'dangling-image', slotNo: 1, source: 'upload', ownership: 'conversation-owned' }]);
  const danglingRepository = modules.createImageRepository({ storage: danglingStorage, images: danglingImages, sessions: () => [] });
  danglingRepository.reconcileSessions();
  if (danglingRepository.referenceCount('dangling-image').total !== 0 || danglingImages.get('dangling-image')) {
    throw new Error('协调移除悬挂会话关联后没有清理孤立图片实体');
  }

  const importedStorage = modules.createStorage({ prefix: 'check-image-repository-persisted-session-import' });
  importedStorage.set('rewrite_migrated_v142', true);
  importedStorage.set('sessions', [{ id: 'persisted-session', title: '已存会话', messages: [{ id: 'persisted-message', role: 'user', imageIds: ['pending-legacy-talk'] }] }]);
  const importedImages = modules.createImages({ storage: importedStorage });
  importedImages.add({ id: 'pending-legacy-talk', filename: 'pending-legacy.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload' }, { collection: 'talk' });
  const importedAssistant = modules.createAssistant({ storage: importedStorage, images: importedImages, primaryApi: { base: 'https://example.test/v1', model: 'test-model' } });
  importedAssistant.importSessions([{ id: 'legacy-session', title: '旧会话', messages: [] }], true);
  if (importedAssistant.imageRepository.listConversation('legacy-session').items.map(item => item.imageId).join(',') !== 'pending-legacy-talk' || importedAssistant.imageRepository.listConversation('persisted-session').items.length || !importedImages.get('pending-legacy-talk')) {
    throw new Error('旧会话迁移待处理时，持久会话错误吞掉了 legacy talk 图片');
  }
}
runImageRepositoryReconciliationContractTests();

const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const versionMarkers = [
  [path.join(root, 'VERSION.txt'), `V${packageVersion}`],
  [path.join(root, 'src', 'index.html'), `V${packageVersion}`],
  [path.join(root, 'preload.js'), packageVersion],
  [path.join(root, 'main.js'), `V${packageVersion}`],
  [path.join(root, 'README.md'), `V${packageVersion}`],
  [path.join(root, 'CHANGELOG.md'), `## V${packageVersion}`],
  [path.join(root, '启动说明.txt'), `V${packageVersion}`],
  [path.join(root, 'agent-tools', 'README.md'), `V${packageVersion}`],
  [path.join(root, 'agent-tools', 'protocol.md'), `V${packageVersion}`],
  [path.join(root, 'agent-tools', '外部Agent工具说明.md'), `V${packageVersion}`],
  [path.join(root, 'agent-tools', 'mcp-server.js'), `'${packageVersion}'`]
];
for (const [file, marker] of versionMarkers) {
  if (!fs.readFileSync(file, 'utf8').includes(marker)) throw new Error(`版本标识不同步：${path.relative(root, file)}`);
}

const candidateRows = modules.addCandidate([], { id: 'candidate-a', iteration: 1, imageId: 'image-a', prompt: '1girl, blue hair', negative: 'lowres' });
const candidateRowsUpdated = modules.addCandidate(candidateRows, { id: 'candidate-b', iteration: 2, imageId: 'image-b', prompt: '1girl, red hair', negative: 'lowres' });
const selectedCandidate = modules.selectCandidate(candidateRowsUpdated, 'candidate-a', 'user');
const selectedFinal = modules.finalCandidate(selectedCandidate);
if (selectedFinal?.finalImageId !== 'image-a' || selectedFinal?.finalPrompt !== '1girl, blue hair' || selectedFinal?.finalNegative !== 'lowres' || selectedFinal?.selectionSource !== 'user') throw new Error('候选结果没有绑定选中图片的实际 Tag');
if (modules.addCandidate(candidateRowsUpdated, { id: 'candidate-b', iteration: 2, imageId: 'image-b', prompt: 'updated prompt' }).length !== 2) throw new Error('候选结果重复记录未合并');
const recommendedRows = modules.markRecommended(candidateRowsUpdated, 'candidate-b');
if (!recommendedRows[1]?.evaluation?.recommended || modules.recommendedId('普通回复') || modules.stripRecommendation('结果\n【最佳候选】candidate-2') !== '结果') throw new Error('AI 候选推荐标记解析失败');
if (modules.evaluateCandidate(candidateRowsUpdated, 'candidate-b', '更接近用户要求')[1]?.evaluation?.summary !== '更接近用户要求') throw new Error('候选评估摘要未保存');
const runDrawContext = (assistant, input, config = {}) => {
  assistant.setSettings?.({ comfyOn: true });
  return assistant.run({ ...(input || {}), mode: 'draw', task: 'comfy' }, config);
};
const appViewSource = fs.readFileSync(path.join(root, 'src', 'app-view.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const appCssSource = fs.readFileSync(path.join(root, 'src', 'app.css'), 'utf8');
const tagsSource = fs.readFileSync(path.join(root, 'src', 'modules', 'tags.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const comfySource = fs.readFileSync(path.join(root, 'src', 'modules', 'comfy.js'), 'utf8');
const defaultVisionPromptSource = fs.readFileSync(path.join(root, 'assets', '提示词素材', '04-识图描述提示词-DEFAULT_VISION_PROMPT.txt'), 'utf8');
const configPersistenceStorage = modules.createStorage({ prefix: 'check-config-persistence' });
const configAssistantA = modules.createAssistant({ storage: configPersistenceStorage, ai: { complete: async () => ({ ok: true, text: 'ok' }) } });
const configuredWorkflow = '{"1":{"class_type":"KSampler","inputs":{"steps":25}}}';
configAssistantA.setSettings({ base: 'http://127.0.0.1:11434/v1', model: 'qwen2.5', key: 'configured-key', comfyOn: true, comfyWorkflow: configuredWorkflow, comfyIters: 5 });
const configAssistantB = modules.createAssistant({ storage: configPersistenceStorage, ai: { complete: async () => ({ ok: true, text: 'ok' }) } });
const restoredConfig = configAssistantB.getSettings();
if (restoredConfig.base !== 'http://127.0.0.1:11434/v1' || restoredConfig.model !== 'qwen2.5' || restoredConfig.key !== 'configured-key' || restoredConfig.comfyOn !== true || restoredConfig.comfyWorkflow !== configuredWorkflow || restoredConfig.comfyIters !== 5) throw new Error('项目 API/Comfy 配置未在重启后恢复');
if (typeof modules.mergeLegacyStorageSnapshot !== 'function' || !Array.isArray(modules.LEGACY_STORAGE_KEYS)) throw new Error('旧版项目配置迁移模块未导出');
const settingsStorageKey = 'ai-tag-toolbox-rewrite:app:rewrite_settings';
const legacyMarkerKey = 'ai-tag-toolbox-rewrite:app:legacy_user_data_migrated_v3';
const currentConfigRoot = {
  [settingsStorageKey]: JSON.stringify({
    base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', key: '', comfyOn: true,
    comfyWorkflow: 'current-workflow', comfyIters: 3, comfyW: 1024, comfyH: 1520
  })
};
const oldConfigSnapshot = {
  dbt_ai_v2: JSON.stringify({
    base: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash-vision-exp', key: 'old-key', temp: 0.55,
    comfyOn: true, comfyWorkflow: 'old-workflow', comfyIters: 5, comfyW: 768, comfyH: 1024
  }),
  dbt_theme_v2: 'dark'
};
const migratedConfig = modules.mergeLegacyStorageSnapshot(currentConfigRoot, oldConfigSnapshot);
const migratedSettings = JSON.parse(migratedConfig.root[settingsStorageKey]);
if (!migratedConfig.changed || migratedSettings.base !== 'https://api.deepseek.com/v1'
  || migratedSettings.model !== 'deepseek-v4-flash-vision-exp' || migratedSettings.key !== 'old-key'
  || migratedSettings.temperature !== 0.55 || migratedSettings.comfyWorkflow !== 'current-workflow'
  || migratedSettings.comfyIters !== 5 || migratedSettings.comfyW !== 1024
  || JSON.parse(migratedConfig.root[legacyMarkerKey]) !== true) {
  throw new Error('旧版 API 配置没有按字段恢复或覆盖了当前 Comfy 配置');
}
const userChangedRoot = { ...migratedConfig.root, [settingsStorageKey]: JSON.stringify({ ...migratedSettings, base: 'https://custom.example/v1' }) };
const repeatedMigration = modules.mergeLegacyStorageSnapshot(userChangedRoot, oldConfigSnapshot);
if (repeatedMigration.changed || JSON.parse(repeatedMigration.root[settingsStorageKey]).base !== 'https://custom.example/v1') throw new Error('旧版配置迁移在后续启动重复覆盖用户设置');
const modelListOriginalFetch = globalThis.fetch;
const localModelUrls = [];
try {
  globalThis.fetch = async url => {
    localModelUrls.push(String(url));
    return { ok: true, json: async () => ({ data: [{ id: 'local-openai-model' }] }) };
  };
  const localModelAssistant = modules.createAssistant();
  const localModels = await localModelAssistant.ai.listModels({ base: 'http://127.0.0.1:1234' });
  if (!localModels.ok || localModels.models[0] !== 'local-openai-model' || localModelUrls[0] !== 'http://127.0.0.1:1234/v1/models') {
    throw new Error('本地 OpenAI 兼容 API 没有使用标准模型列表地址');
  }
} finally {
  globalThis.fetch = modelListOriginalFetch;
}
const uploadStorage = modules.createStorage({ prefix: 'check-image-upload-entry' });
const uploadImages = modules.createImages({ storage: uploadStorage });
const uploadDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const uploadedAsset = uploadImages.add({ dataUrl: uploadDataUrl, thumbnailDataUrl: uploadDataUrl, filename: 'upload.png', source: 'file' });
if (!uploadedAsset?.id || !uploadImages.getBytes(uploadedAsset.id)?.length || !/^data:image\//i.test(uploadImages.preview(uploadedAsset.id)?.dataUrl || '')) throw new Error('图库上传入口未创建可读取图片资产');
const largeUploadBytes = Buffer.alloc(3_500_000, 7);
const largeUploadDataUrl = `data:image/png;base64,${largeUploadBytes.toString('base64')}`;
const largeUploadedAsset = uploadImages.add({ dataUrl: largeUploadDataUrl, filename: 'large-upload.png', source: 'file' });
if (!largeUploadedAsset?.id || uploadImages.getBytes(largeUploadedAsset.id)?.length !== largeUploadBytes.length) throw new Error('图库上传无法处理大尺寸 Base64 图片');
const uploadVisionStore = modules.createVisionTempStore({ images: uploadImages });
const visionUpload = uploadVisionStore.replaceExternal({ dataUrl: uploadDataUrl, thumbnailDataUrl: uploadDataUrl, filename: 'vision.png', mime: 'image/png' });
if (!visionUpload?.tempId || !uploadVisionStore.resolveForVision(visionUpload.tempId)?.bytes?.length) throw new Error('识图上传入口未创建临时图片');
if (!appViewSource.includes('currentVisionImageId') || appViewSource.includes('visionCollection')) throw new Error('右侧 Vision 仍依赖 collection 状态');
if (!appViewSource.includes('imageContextFromEvent') || !appViewSource.includes('addFilesForContext')) throw new Error('图片上传上下文分流未接入');
if (!/const description = str\(ui\.visionDescription\)/.test(appViewSource) || /const description = str\(ui\.visionDescription \|\| result\.text\)/.test(appViewSource)) throw new Error('Vision metadata 被误显示为 AI 描述');
if (!/AI 识图中…/.test(appViewSource) || !/notify\(ui\.visionDescription\)/.test(appViewSource) || !/capabilities\.vision\.ai/.test(appViewSource)) throw new Error('AI 识图缺少加载或失败反馈');
if (!appViewSource.includes('ComfyUI 已停用 · 请在绘图模式左上角打开“ComfyUI 出图”') || !appViewSource.includes('ComfyUI 未连接 · 请确认 ComfyUI 已启动')) throw new Error('ComfyUI 状态提示缺少处理建议');
if (!appViewSource.includes('event.result.error || event.result.text || "请检查设置后重试"')) throw new Error('工具失败提示没有显示具体原因');
if (!comfySource.includes('ComfyUI 连接失败') || !comfySource.includes('请确认 ComfyUI 已启动') || !comfySource.includes('生成超时，请检查队列')) throw new Error('ComfyUI 底层错误缺少处理建议');
if (!appViewSource.includes('assistant?.run?.') || !appViewSource.includes('drawContextTask')) throw new Error('两模式 UI 未接入统一 Runner');
if (!indexSource.includes('id="comfyUiModule"') || !indexSource.includes('id="comfyStatus"') || !indexSource.includes('id="tkDrawControls"') || !indexSource.includes('id="tkDrawRender"') || !indexSource.includes('id="tkDrawIterations"')) throw new Error('绘图模式缺少 ComfyUI 快捷设置');
if (!/setDrawComfyEnabled\(event\.target\.checked\)/.test(appViewSource) || !/setDrawIterations\(event\.target\.value\)/.test(appViewSource)) throw new Error('绘图快捷设置未同步到应用设置');
if (!/comfyOn:\s*s\.comfyOn\s*===\s*true/.test(appViewSource) || indexSource.includes('id="comfyOn"') || appViewSource.includes('$("#comfyOn")')) throw new Error('ComfyUI 开关没有收敛到助手绘图页');
if (!appViewSource.includes('$("#comfyWf").value = workflowText(s.comfyWorkflow)')
  || !appViewSource.includes('comfy?.setWorkflow?.(workflowText(s.comfyWorkflow))')) throw new Error('Comfy 工作流没有从持久化字段正确回填连接器与表单');
const comfySettingSelectors = ['#comfyBase', '#comfyPos', '#comfyNeg', '#comfyW', '#comfyH', '#comfySteps', '#comfyCfg', '#comfyIters', '#comfyWf'];
if (!appViewSource.includes('persistedComfyFields.forEach') || comfySettingSelectors.some(selector => !appViewSource.includes(`"${selector}"`))) throw new Error('Comfy 表单字段没有统一保存监听');
if (!appViewSource.includes('comfyWorkflow: formValue("#comfyWf", s.comfyWorkflow)')
  || !appViewSource.includes('comfyPos: formValue("#comfyPos", s.comfyPos)')
  || !appViewSource.includes('comfyNeg: formValue("#comfyNeg", s.comfyNeg)')) throw new Error('Comfy 文本字段无法持久化显式空值');
if (/populate(?:Vision)?Models\(\{\s*reset:\s*true/.test(appViewSource) || appViewSource.includes('.then(() => configFromView())')) throw new Error('API 模型刷新仍会把列表首项回写为默认模型');
if (!/visionInheritPrimary[\s\S]{0,180}configFromView\(\{ preserveVisionModel: true \}\)/.test(appViewSource)) throw new Error('切换识图 API 继承状态会覆盖已保存的独立模型');
if (!/const result = await assistant\?\.ai\?\.complete\?\./.test(appViewSource)
  || !/if \(!result \|\| result\.ok === false\) throw new Error/.test(appViewSource)) throw new Error('AI 连接测试没有识别失败返回值');
if (!/\$\("#comfyTest"\)[\s\S]{0,180}configFromView\(\)[\s\S]{0,180}comfy\?\.check/.test(appViewSource)) throw new Error('Comfy 连接测试没有使用当前表单地址');
if (!appViewSource.includes('if (ui.route === "ai") showAi(panel)') || appViewSource.includes('showAi(button.dataset.panel)') || !appViewSource.includes('ui.aiTabBeforeGallery = panel')) throw new Error('AI 模块入口仍会重复加载或错误恢复 API 页面');
if (!mainSource.includes('session.fromPath') || !mainSource.includes('mergeLegacyStorageSnapshot')
  || !/await migrateLegacyUserData\(\)/.test(mainSource) || !/createWindow\(\)/.test(mainSource)
  || !fs.existsSync(path.join(root, 'src', 'legacy-storage-reader.html'))) throw new Error('旧版 Electron 用户配置没有在主窗口启动前迁移');
if (!mainSource.includes('copyLegacyStorageSession') || /readLegacyLocalStorage\(path\.join\(appDataDir, 'ai-tag-toolbox'\)\)/.test(mainSource)) throw new Error('旧版 LevelDB 没有通过只读副本执行迁移');
if (!mainSource.includes('readLegacyEncryptedKey') || !mainSource.includes("path.join(legacyUserDataDir, 'secure', 'api-key.bin')")) throw new Error('旧版安全存储中的 API Key 没有迁移入口');
if (!mainSource.includes("app.setName('ai-tag-toolbox')") || !mainSource.includes('restoreApplicationName') || !/finally\s*\{\s*restoreApplicationName\(\);/.test(mainSource) || !/function readLegacyEncryptedKey[\s\S]{0,500}app\.setName\('ai-tag-toolbox'\)/.test(mainSource)) throw new Error('旧版 API Key 解密没有切换到旧应用名并恢复新版应用名');
if (!mainSource.includes("settings.key = legacyKey") || !mainSource.includes("!String(settings.key || '').trim()")) throw new Error('旧版解密 API Key 没有填充到空的新版配置');
if (!/imageStore\?\.add\?\./.test(appViewSource) || !/visionTempStore\?\.replaceExternal/.test(appViewSource)) throw new Error('图片上传没有经过可用的安全图片入口');
if (!/addConversationImages\(event\.target\.files\)[\s\S]{0,180}\.catch\(error => notify/.test(appViewSource)) throw new Error('对话图片上传异常没有反馈给用户');
if (!/storageCandidates/.test(fs.readFileSync(path.join(root, 'preload.js'), 'utf8')) || !/mergeStorageSeed/.test(fs.readFileSync(path.join(root, 'preload.js'), 'utf8'))) throw new Error('启动配置没有兼容旧 portable 存储');
if (!/module\.hidden = !inDrawMode/.test(appViewSource) || !/state\.connected === true && state\.workflowReady === true/.test(appViewSource) || !/is-comfy-warning/.test(appViewSource)) throw new Error('绘图快捷设置未按模式或 ComfyUI 状态显示');
if (/id="talkStatus"[^>]*>就绪</.test(indexSource)) throw new Error('普通 AI 状态仍显示无意义的就绪占位');
if (!/async function status\(options2 = \{\}\)/.test(comfySource) || !appViewSource.includes('$("#comfyStatus")')) throw new Error('ComfyUI 状态未收拢到统一模块');
if (!appViewSource.includes('renderCandidateCards') || !appViewSource.includes('复制本轮正向 Tag') || !appViewSource.includes('设为最终结果')) throw new Error('绘图候选结果缺少用户选择或复制操作');
if (!appViewSource.includes('updateStreamingTalk') || !appViewSource.includes('thinkingScroll') || !appViewSource.includes('candidate-ready') || !appViewSource.includes('renderActivityTimeline') || !appViewSource.includes('handleTalkToolEvent')) throw new Error('流式消息未使用稳定节点或未接入返图事件');
if (!appViewSource.includes('imageStore?.preview?.(id)') || !/function preview\(value\)/.test(fs.readFileSync(path.join(root, 'src', 'modules', 'images.js'), 'utf8'))) throw new Error('绘图候选图片缺少按需预览接口');
if (!appViewSource.includes('candidatePreviews') || !appViewSource.includes('event.candidate?.previewUrl')) throw new Error('绘图返图缺少即时预览回退');
if (!appViewSource.includes('function resizeTalkInput') || !appViewSource.includes('resizeTalkInput();')) throw new Error('AI 输入框未接入自适应高度');
if (!appCssSource.includes('width:min(100%,1280px)') || !appCssSource.includes('flex-direction:column;overflow-x:hidden;overflow-y:auto') || !appCssSource.includes('.cmsg.user.editing') || !appCssSource.includes('calc((100% - 1280px)/2)')) throw new Error('AI 对话尺寸或窄屏布局未收敛');
if (!indexSource.includes('data-image-context="vision"') || !indexSource.includes('data-image-context="conversation"')) throw new Error('图片上下文 DOM 标记缺失');
if (/<input[^>]+id="tpFile"[^>]+multiple/i.test(indexSource)) throw new Error('Vision 文件输入仍允许多图');
if (indexSource.includes('id="tpVisionToggle"') || indexSource.includes('id="quickVisionBtn"') || indexSource.includes('id="tpExpand"') || !indexSource.includes('id="visionBtn"') || indexSource.includes('id="helpBtn"')) throw new Error('识图导航入口或旧帮助/侧栏开关未收敛');
if (!indexSource.includes('id="tagVisionSlot"') || (indexSource.match(/id="tagPane"/g) || []).length !== 1) throw new Error('主页面识图模块挂载点缺失或重复');
if (indexSource.includes('id="galleryImport"') || indexSource.includes('id="galleryExport"') || indexSource.includes('id="galleryManifestFile"') || /#gallery(?:Import|Export|ManifestFile)/.test(appViewSource)) throw new Error('图库页面仍保留导入导出功能');
if (appViewSource.includes('visionCollapsed') || appViewSource.includes('setVisionCollapsed') || appViewSource.includes('tpVisionToggle') || !appViewSource.includes('visionOpen') || !appViewSource.includes('setVisionOpen') || !appViewSource.includes('#visionBtn') || !appViewSource.includes('tagVisionSlot')) throw new Error('识图导航抽屉交互未接入');
if (!appCssSource.includes('#tagPane.tkpane.vision-open') || !appCssSource.includes('.scrim.show')) throw new Error('识图导航抽屉样式未接入');
if (!/data-mode="assistant"/.test(indexSource) || !/data-mode="draw"/.test(indexSource) || /data-mode="(?:gen|rk|comfy)"/.test(indexSource)) throw new Error('用户可见 AI 模式未收敛为助手/绘图');
if (/(?:id="tabGen"|id="tabChat"|id="tabComfy"|id="genGo"|id="comfyGo"|id="chatSend")/.test(indexSource)) throw new Error('旧 AI 页面控件仍在 HTML');
if (/(?:runGenerate|runRecreate|runComfy|runChat|completeWithCallsLegacy|iterateWithComfy|visionCollection|analyzeMany)/.test(appViewSource + '\n' + fs.readFileSync(path.join(root, 'src', 'modules', 'assistant.js'), 'utf8'))) throw new Error('旧执行链路或多图 Vision 入口仍在正式代码');
const contextImages = modules.createImages();
const visionOnlyImage = contextImages.add({ id: 'check-vision-context', dataUrl: 'data:image/png;base64,AA==', source: 'vision' });
if (!visionOnlyImage || contextImages.collectionIds('talk').includes(visionOnlyImage.id)) throw new Error('Vision 图片错误加入对话集合');
const sources = modules.loadTagFiles({ assetDir: path.join(root, 'assets') });
const tags = modules.createTags({ sources });
if (tags.size() < 1) throw new Error('标签素材为空');
const tagSnapshot = tags.stateSnapshot();
if (!tagSnapshot.categories.some(item => item.id === 'character_names')
  || (tagSnapshot.categoryCounts.character_names || 0) < 4000
  || tags.page({ category: 'all', limit: 5000 }).items.length > 1000
  || tags.page({ category: 'character_names', limit: 5000 }).items.length > 1000
  || tags.page({ category: 'accessory', limit: 5000 }).items.length <= 1000) {
  throw new Error('角色名拆分或分类展示上限逻辑失败');
}
const prompts = modules.createPrompts({ dir: path.join(root, 'assets', '提示词素材') });
if (!prompts.get('main')) throw new Error('主提示词素材为空');
if (prompts.getEffective('vision') !== prompts.get('vision')) throw new Error('Prompts 有效 Vision 提示词接口失败');
const translation = modules.createTranslation({ tags });
const translated = translation.translateLocal('蓝发', 'zh-en');
if (!translated || translated.ok === false || !translated.text) throw new Error('翻译最小样例失败');
let translationAiOptions = null;
let translationAiPrompt = null;
const aiTranslation = modules.createTranslation({
  tags,
  ai: async (prompt, options) => {
    translationAiPrompt = prompt;
    translationAiOptions = options;
    return { ok: true, text: 'blue hair' };
  }
});
const aiTranslationResult = await aiTranslation.translateWithAI('蓝发', 'zh-en');
if (!aiTranslationResult.ok || aiTranslationResult.text !== 'blue hair'
  || !/关闭思维链和推理展示/.test(translationAiPrompt?.system || '')
  || translationAiOptions?.stream !== false
  || translationAiOptions?.reasoning_effort !== 'none'
  || translationAiOptions?.enable_thinking !== false
  || translationAiOptions?.thinking?.type !== 'disabled') {
  throw new Error('AI 翻译未切换为直接输出模式');
}
let translationBody = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, request) => {
  translationBody = JSON.parse(request.body);
  return new Response(JSON.stringify({ choices: [{ message: { content: 'blue hair' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
try {
  const bodyAssistant = modules.createAssistant({ primaryApi: { base: 'https://example.test/v1', model: 'test-model' } });
  const bodyTranslation = modules.createTranslation({ ai: bodyAssistant.ai });
  await bodyTranslation.translateWithAI('蓝发', 'zh-en');
} finally {
  // The body-level switch is covered by the shared AI service; restore the
  // process fetch immediately after the lightweight transport assertion.
  globalThis.fetch = originalFetch;
}
if (!translationBody || translationBody.stream !== false || translationBody.reasoning_effort !== 'none' || translationBody.enable_thinking !== false || translationBody.thinking?.type !== 'disabled') throw new Error('AI 翻译请求未透传直接输出参数');
let followupMessages = null;
const historyImage = { id: 'history-render-image', filename: 'history.png', dataUrl: 'data:image/png;base64,AA==' };
const historyAssistant = modules.createAssistant({
  ai: { async complete(messages) { followupMessages = messages; return { ok: true, text: '追问已收到' }; } },
  images: { get: id => id === historyImage.id ? historyImage : null },
  storage: { get: () => [], set: () => {} }
});
historyAssistant.append('assistant', '最终提示词', { mode: 'draw', imageIds: [historyImage.id] });
historyAssistant.append('assistant', '带追踪记录的结果', { mode: 'draw', toolCalls: [{ name: 'comfy.render', result: { ok: true, data: { artifact: { id: historyImage.id, dataUrl: 'data:image/png;base64,AA==' } } } }] });
const followupResult = await historyAssistant.run({ mode: 'assistant', text: '继续追问' });
const assistantImagePart = followupMessages?.some(message => message.role === 'assistant' && Array.isArray(message.content) && message.content.some(part => part?.type === 'image_url' || part?.type === 'image'));
const traceAsProtocolCalls = followupMessages?.some(message => message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.some(call => call.result || !call.id || !call.function?.name));
if (!followupResult.ok || assistantImagePart || traceAsProtocolCalls) throw new Error('后续追问仍把返图或 UI 工具追踪记录发送给 API');
const legacyHistory = modules.createAssistant({
  ai: { async complete(messages) { followupMessages = messages; return { ok: true, text: 'legacy ok' }; } },
  storage: { get: () => [], set: () => {} },
  compact: false
});
legacyHistory.append('assistant', 'legacy result', {
  mode: 'assistant',
  result: { artifact: { id: 'legacy-artifact', path: 'C:\\private\\secret.png', viewUrl: 'file:///C:/private/secret.png', workflow: { secret: true }, dataUrl: 'data:image/png;base64,AA==' } },
  toolCalls: [{ name: 'comfy.render', result: { artifact: { path: 'C:\\private\\trace.png', workflow: { secret: true }, url: 'https://private.example/trace.png' } } }]
});
legacyHistory.append('tool', JSON.stringify({ path: 'C:\\private\\orphan.png', workflow: { secret: true } }), { tool_call_id: '' });
const legacySnapshot = legacyHistory.currentSession();
if (/C:\\private|file:\/\/|data:image|private\.example|"workflow"/.test(JSON.stringify(legacySnapshot)) || /"(?:imageId|refId)"\s*:/.test(JSON.stringify(legacySnapshot.messages?.map(message => ({ result: message.result, toolCalls: message.toolCalls })))) ) throw new Error('Legacy 会话历史仍保存路径、URL、Data URL、workflow 或工具内部 ID');
const legacyRun = await legacyHistory.run({ mode: 'assistant', text: '继续 legacy' });
const orphanTool = (followupMessages || []).some(message => message.role === 'tool' && !message.tool_call_id);
if (!legacyRun.ok || orphanTool || (followupMessages || []).some(message => /C:\\private|file:\/\/|private\.example|"workflow"/.test(JSON.stringify(message)))) throw new Error('Legacy API 历史仍包含孤立 tool 或敏感结果');
if (!appViewSource.includes('const wasHidden = box.hidden')
  || !appViewSource.includes('if (visible && !done && wasHidden) box.open = false')
  || /if \(visible && !done\) box\.open = false/.test(appViewSource)) {
  throw new Error('翻译思考面板会在流式更新时强制收起');
}
if (appViewSource.includes('if (ai && !wasAi) { setTalkMode("assistant")')
  || !appViewSource.includes('storage.get("app.talkMode", "assistant")')
  || !appViewSource.includes('storage.set("app.talkMode", ui.talkMode)')) {
  throw new Error('助手/绘图模式切换时未保持用户选择');
}
if (!appViewSource.includes('activeKey: "ui.header.backHome"') || !appViewSource.includes('function bindNavigation()') || /\$\("#(?:aiBtn|translateBtn|visionBtn|favBtn|nsfwBtn|themeBtn|localeBtn|sponsorBtn)"\)\?\.addEventListener\("click"/.test(appViewSource) || /`V\$\{modules\.version \|\| "1\.4\.92"\} · 简洁模块化`/.test(appViewSource)) throw new Error('导航按钮未使用统一状态模板');
if (!/id="translateInput"[\s\S]*spellcheck="false"/.test(indexSource)) throw new Error('翻译输入框仍启用拼写检查波浪线');
if (!appViewSource.includes('function uniqueTagTexts(rows)')
  || !appViewSource.includes('const copiedValues = uniqueTagTexts(values)')
  || !appViewSource.includes('uniqueTagTexts(rows).forEach')) {
  throw new Error('识图 Tag 复制未复用去重后的显示内容');
}
if (!appViewSource.includes('const workspace = doc.body') || appViewSource.includes('const target = ui.route === "tags" ? tagSlot : talkShell') || !appCssSource.includes('z-index:55')) throw new Error('识图抽屉仍挂在页面专属容器或层级不足');
if (!appViewSource.includes('if (item.type === "event") return item.name ? `${item.name} 事件` : "任务事件"')) throw new Error('任务过程事件仍会重复渲染消息文本');
if (!appViewSource.includes('search.style.display = searchHidden ? "none" : ""') || !appViewSource.includes('const searchHidden = ai')) throw new Error('AI 模式切换器未与搜索栏真正切换尺寸');
if (!indexSource.includes('href="https://ifdian.net/a/AI-Tag-Toolbox"') || !indexSource.includes('target="_blank"') || !mainSource.includes('isSponsorUrl') || !mainSource.includes('shell.openExternal') || !mainSource.includes('setWindowOpenHandler')) throw new Error('赞助链接未配置为外部浏览器打开');
if (!appViewSource.includes('syncNavAction("ai", ui.route === "ai")') || !appViewSource.includes('syncNavAction("translation", ui.route === "translation")') || !appViewSource.includes('syncNavAction("vision", ui.visionOpen)') || !appViewSource.includes('syncNavAction("favorites", ui.favoritesOpen)')) throw new Error('导航激活态未通过统一同步函数');
if (!appViewSource.includes('const navActionConfig') || !appViewSource.includes('function bindNavigation()') || !appViewSource.includes('toggleFavoriteDrawer') || !appViewSource.includes('toggleAdultTags') || !appViewSource.includes('visionClose') || !appViewSource.includes('favoritesClose') || !indexSource.includes('data-nav-action="favorites"') || !indexSource.includes('data-nav-action="adult"') || !appCssSource.includes('.nav-action.nav-toggle{') || !appCssSource.includes('.nav-action.nav-toggle.on{') || !appCssSource.includes('border-left:4px solid var(--nav-active-rail)') || !appCssSource.includes('.cat.btn-menu.on{border-left-color:transparent;box-shadow:inset 3px 0 0')) throw new Error('统一导航状态模板或侧栏选中态样式缺失');
if (!appViewSource.includes('○ 成人标签：关') || !appViewSource.includes('● 成人标签：开') || !indexSource.includes('id="nsfwBtn"')) throw new Error('成人标签按钮状态文案缺失');
if (indexSource.includes('<span class="si">') || !indexSource.includes('class="search-icon"') || !appCssSource.includes('.search-icon')) throw new Error('搜索框图标状态异常');
if (!appCssSource.includes('--selected-text') || !appCssSource.includes('body:not(.dark) .nav-action.nav-toggle.on') || !appCssSource.includes('color-mix(in srgb,var(--pri) 18%,var(--chip))')) throw new Error('选中态或主色令牌未更新');
if (!indexSource.includes('id="searchPrecision"') || !indexSource.includes('id="searchBtn"') || !indexSource.includes('value="standard" data-i18n="ui.header.searchStandard" selected') || !appViewSource.includes('normaliseSearchPrecision') || !appViewSource.includes('app.searchPrecision') || !appViewSource.includes('executeSearch') || !appCssSource.includes('.search-precision select') || !appCssSource.includes('.search-submit')) throw new Error('搜索精度/提交控件或持久化链路缺失');
if (indexSource.includes('class="si"') || !indexSource.includes('class="search-icon"') || !appCssSource.includes('.search-icon')) throw new Error('搜索按钮图标或左侧装饰放大镜状态不正确');
if (!appCssSource.includes('border:0;color:var(--pri-h)')
  || !appCssSource.includes('right:2px;top:2px;width:44px;height:38px;min-width:44px;min-height:38px')) throw new Error('搜索按钮应缩小并露出搜索栏外框');
if (!appViewSource.includes('18.5 9a7 7 0 1 0 1.2 6')) throw new Error('重新生成图标路径未更新');
if (!appCssSource.includes('--pink:#E85D9F') || !appViewSource.includes('nsfw: \"#E85D9F\"')) throw new Error('成人标签粉色主题未接入');
if (!tagsSource.includes('SEARCH_PRECISIONS') || !tagsSource.includes('normaliseKeywords') || !tagsSource.includes('compactSearchKey') || !tagsSource.includes('ensureBroadIndex') || !tagsSource.includes('precision === \"exact\"') || !tagsSource.includes('CHARACTER_NAMES_CATEGORY') || !tagsSource.includes('maxDisplay') || !fs.existsSync(path.join(root, 'assets', '数据资产', '标签', 'search-keywords.js'))) throw new Error('搜索匹配表或三档匹配策略缺失');
if (!tagsSource.includes('function subcategories') || !tagsSource.includes('subcategory: query ?') || !appViewSource.includes('renderSubcategoryNav') || !appViewSource.includes('--subcat-color') || !appViewSource.includes('categoryColor(category)') || !indexSource.includes('id=\"subcatNav\"') || !appCssSource.includes('.subcat-btn')) throw new Error('子分类自动筛选界面或接口缺失');
if (!appViewSource.includes('tagPageCache') || !appViewSource.includes('ui.tagPageCache.get') || !appViewSource.includes('snap.revision') || !appCssSource.includes('content-visibility:auto')) throw new Error('标签列表懒绘制或分页缓存未接入');
if (!appCssSource.includes('.btn.search-submit') || !appCssSource.includes('contain:layout;contain-intrinsic-size')) throw new Error('搜索按钮样式或安全懒绘制规则缺失');
const headerOrder = ['sponsorBtn', 'themeBtn', 'localeBtn', 'nsfwBtn', 'headerWorkspace', 'aiBtn', 'translateBtn', 'visionBtn', 'favBtn'];
let headerCursor = -1;
for (const id of headerOrder) {
  const position = indexSource.indexOf(`id="${id}"`);
  if (position < 0 || position <= headerCursor) throw new Error('顶部导航顺序未按需求排列');
  headerCursor = position;
}
if (!indexSource.includes('class="header-leading"') || !indexSource.includes('class="header-trailing"') || indexSource.includes('id="helpBtn"') || !appCssSource.includes('.aiview header .header-workspace .ai-module-switcher')) throw new Error('顶部导航分组或 AI/搜索等宽样式缺失');
if (!indexSource.includes('class="header-side-left"') || !appCssSource.includes('grid-template-columns:minmax(0,1fr) minmax(360px,460px) minmax(0,1fr)') || !appCssSource.includes('.header-trailing .btn.nav-action{')) throw new Error('顶部搜索居中或右侧按钮统一尺寸样式缺失');
if (!indexSource.includes('data-nav-tone="sponsor"') || !indexSource.includes('data-nav-tone="adult"') || !appCssSource.includes('.nav-action.nav-toggle.on{') || !appCssSource.includes('.header-leading .btn.nav-action.nav-compact{')) throw new Error('赞助或成人标签按钮状态样式缺失');
if (!appCssSource.includes('.nav-action[data-nav-tone="sponsor"]{--nav-accent:#D06A3D}')) throw new Error('赞助按钮主题色未提升饱和度');
if (!appCssSource.includes('top:var(--vision-pane-top,63px)') || !appViewSource.includes('function syncVisionPaneOffset') || !appViewSource.includes('syncVisionPaneOffset()')) throw new Error('识图侧栏未避开顶部导航栏');
if (!appCssSource.includes('body.vision-open #scrim') || !appCssSource.includes('--vision-scrim-left') || !appCssSource.includes('--vision-scrim-right') || !appViewSource.includes('vision-open')) throw new Error('识图遮罩未限制在主内容区域');
if (!appCssSource.includes('.brand .logo{width:28px;height:28px') || !appCssSource.includes('.brand small{display:inline;font-size:11px')) throw new Error('品牌标志尺寸或版本对齐样式缺失');
if (!appCssSource.includes('.header-side-left{grid-column:1;display:flex;align-items:center;justify-content:space-between') || !appCssSource.includes('.header-leading .hbtn:hover{transform:translateY(-1px)') || !appCssSource.includes('.header-leading .hbtn:active{transform:translateY(0) scale(.97)')) throw new Error('左侧品牌位置或按钮动效缺失');
if (!appCssSource.includes('@media (min-width:861px) and (max-width:1500px)') || !appCssSource.includes('header .header-workspace{\n    order:2;') || !appCssSource.includes('.header-leading{margin-left:auto}')) throw new Error('中等宽度导航换行防重叠样式缺失');
const buttonTemplates = ['btn-primary', 'btn-secondary', 'btn-ghost', 'btn-danger', 'btn-icon', 'btn-segment', 'btn-menu', 'btn-chip', 'btn-nav', 'btn-sponsor'];
if (!appCssSource.includes('统一按钮模板') || !appCssSource.includes('--btn-height-md:36px') || buttonTemplates.some(name => !appCssSource.includes(`.btn.${name}`))) throw new Error('统一按钮模板定义不完整');
const staticButtons = [...indexSource.matchAll(/<button\b[^>]*>/g)];
if (staticButtons.some(match => !/\bclass="[^"]*\bbtn\b/.test(match[0]))) throw new Error('静态按钮未套用统一 btn 基类');
if (!indexSource.includes('class="tkmode btn btn-segment on"') || !indexSource.includes('class="tkmode btn btn-segment"') || !appViewSource.includes('setMessageActionIcon') || !appViewSource.includes('message-action') || !appViewSource.includes('className = "translate-tag btn btn-chip"')) throw new Error('动态按钮模板映射不完整');
if (!appViewSource.includes('renderMarkdownBlocks') || !appViewSource.includes('renderMarkdownTable') || !appViewSource.includes('markdownCodeBlock') || !appCssSource.includes('.md-table') || !appCssSource.includes('.md-inline-code')) throw new Error('对话 Markdown/表格/代码块渲染链路缺失');
if (!appViewSource.includes('user-actions') || !appViewSource.includes('ai-actions') || !appViewSource.includes('messageIconMarkup') || !appViewSource.includes('cmsg-actions-row') || appViewSource.includes('cmsg-regen') || appViewSource.includes('deleteButton') || appViewSource.includes('点赞') || appViewSource.includes('转发') || !appCssSource.includes('.cmsg-actions-row')) throw new Error('对话操作按钮未按需求收敛');
const comfy = modules.createComfy({ base: 'http://127.0.0.1:8188' });
if (typeof comfy.parseRender === 'function' || typeof comfy.parseCommands === 'function') throw new Error('Comfy 仍暴露旧文本指令解析');
if (comfy.workflowReady()) throw new Error('空 Comfy 工作流错误地标记为可用');
const importedWorkflow = comfy.importApiWorkflow({
  '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 6, positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 768 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: '1girl' } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'lowres' } }
});
if (!importedWorkflow.found || importedWorkflow.prompt !== '1girl' || importedWorkflow.negative !== 'lowres' || !importedWorkflow.text.includes('{{prompt}}')) {
  throw new Error('Comfy 工作流导入提取失败');
}
if (!comfy.workflowStatus(importedWorkflow.text).ready || !modules.validateApiWorkflow(importedWorkflow.workflow).ready) throw new Error('Comfy API 工作流有效性检查失败');
const linkedWorkflow = {
  '3': { class_type: 'ImpactWildcardProcessor', inputs: { wildcard_text: 'linked prompt', populated_text: 'cached prompt' } },
  '4': { class_type: 'ImpactWildcardProcessor', inputs: { wildcard_text: 'linked negative', populated_text: 'cached negative' } },
  '5': { class_type: 'KSampler', inputs: { seed: ['40', 0], steps: ['42', 0], cfg: ['44', 0], sampler_name: 'euler', scheduler: 'normal', positive: ['45', 0], negative: ['48', 0], latent_image: ['50', 0] } },
  '25': { class_type: 'easy int', inputs: { value: 869 } },
  '34': { class_type: 'easy int', inputs: { value: 1152 } },
  '40': { class_type: 'Seed (rgthree)', inputs: { seed: 123456 } },
  '42': { class_type: 'easy int', inputs: { value: 30 } },
  '44': { class_type: 'PrimitiveFloat', inputs: { value: 4 } },
  '45': { class_type: 'CLIPTextEncode', inputs: { text: ['3', 0] } },
  '48': { class_type: 'CLIPTextEncode', inputs: { text: ['4', 0] } },
  '49': { class_type: 'EmptyLatentImage', inputs: { width: ['25', 0], height: ['34', 0], batch_size: 1 } },
  '50': { class_type: 'ImpactSwitch', inputs: { input1: ['49', 0] } },
  '51': { class_type: 'SaveImage', inputs: { images: ['5', 0] } }
};
const linkedImported = comfy.importApiWorkflow(linkedWorkflow);
if (linkedImported.prompt !== 'linked prompt' || linkedImported.negative !== 'linked negative'
  || linkedImported.width !== 869 || linkedImported.height !== 1152 || linkedImported.steps !== 30
  || linkedImported.cfg !== 4 || linkedImported.seed !== '123456'
  || !Array.isArray(linkedImported.workflow['5'].inputs.steps) || !Array.isArray(linkedImported.workflow['45'].inputs.text)) {
  throw new Error('Comfy 导入器没有正确读取并保留链接的 Wildcard/Primitive 节点');
}
const linkedBuilt = comfy.buildWorkflow({
  workflow: linkedImported.text, prompt: 'new linked prompt', negative: 'new linked negative',
  width: 1024, height: 1536, steps: 21, cfg: 5.5, seed: 987654
});
if (linkedBuilt['3']?.inputs?.wildcard_text !== 'new linked prompt' || linkedBuilt['3']?.inputs?.populated_text !== 'cached prompt'
  || linkedBuilt['4']?.inputs?.wildcard_text !== 'new linked negative' || linkedBuilt['25']?.inputs?.value !== 1024
  || linkedBuilt['34']?.inputs?.value !== 1536 || linkedBuilt['42']?.inputs?.value !== 21
  || linkedBuilt['44']?.inputs?.value !== 5.5 || linkedBuilt['40']?.inputs?.seed !== 987654) {
  throw new Error('Comfy 构建器没有覆盖链接的 Wildcard/Primitive 参数');
}
const wildcardProviderWorkflow = {
  '3': { class_type: 'ImpactWildcardProcessor', inputs: { wildcard_text: ['9', 0], populated_text: 'cached prompt' } },
  '4': { class_type: 'ImpactWildcardProcessor', inputs: { wildcard_text: 'negative' } },
  '5': { class_type: 'KSampler', inputs: { seed: 1, steps: 1, cfg: 1, positive: ['45', 0], negative: ['48', 0], latent_image: ['6', 0] } },
  '6': { class_type: 'EmptyLatentImage', inputs: { width: 64, height: 64 } },
  '9': { class_type: 'PrimitiveString', inputs: { value: 'provider prompt' } },
  '45': { class_type: 'CLIPTextEncode', inputs: { text: ['3', 0] } },
  '48': { class_type: 'CLIPTextEncode', inputs: { text: ['4', 0] } }
};
const wildcardProviderImported = comfy.importApiWorkflow(wildcardProviderWorkflow);
if (wildcardProviderImported.prompt !== 'provider prompt' || wildcardProviderImported.workflow['3']?.inputs?.populated_text !== 'cached prompt'
  || !Array.isArray(wildcardProviderImported.workflow['3']?.inputs?.wildcard_text)) throw new Error('Wildcard 链接存在缓存字段时没有读取真正的文本提供节点');
const wildcardProviderBuilt = comfy.buildWorkflow({ workflow: wildcardProviderImported.text, prompt: 'provider replacement', negative: 'negative replacement', width: 64, height: 64, steps: 1, cfg: 1, seed: 1 });
if (wildcardProviderBuilt['9']?.inputs?.value !== 'provider replacement' || wildcardProviderBuilt['3']?.inputs?.populated_text !== 'cached prompt') throw new Error('Wildcard 覆盖错误修改了 populated_text 缓存字段');
const fixedWorkflow = {
  '3': { class_type: 'KSampler', inputs: { seed: 123, steps: 1, cfg: 1, sampler_name: 'euler', scheduler: 'normal', model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'old-model.safetensors' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 64, height: 64, batch_size: 1 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: '1girl, blue hair', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'lowres', clip: ['4', 1] } },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { images: ['8', 0] } }
};
const fixedBuilt = comfy.buildWorkflow({
  workflow: fixedWorkflow,
  prompt: 'new prompt', negative: 'new negative', width: 1024, height: 1024,
  steps: 28, cfg: 7, seed: 42, sampler: 'dpmpp_2m', scheduler: 'karras', ckpt: 'anima-base-v1.0.safetensors'
});
if (fixedBuilt['3']?.inputs?.steps !== 28 || fixedBuilt['3']?.inputs?.cfg !== 7 || fixedBuilt['3']?.inputs?.seed !== 42
  || fixedBuilt['3']?.inputs?.sampler_name !== 'dpmpp_2m' || fixedBuilt['3']?.inputs?.scheduler !== 'karras'
  || fixedBuilt['5']?.inputs?.width !== 1024 || fixedBuilt['5']?.inputs?.height !== 1024
  || fixedBuilt['6']?.inputs?.text !== 'new prompt' || fixedBuilt['7']?.inputs?.text !== 'new negative'
  || fixedBuilt['4']?.inputs?.ckpt_name !== 'anima-base-v1.0.safetensors') throw new Error('固定字面量 Comfy 工作流没有被当前参数覆盖');
const fixedBuiltFromText = comfy.buildWorkflow({ workflow: JSON.stringify(fixedWorkflow), prompt: 'text prompt', width: 896, height: 768, steps: 20, cfg: 5, seed: 7 });
if (fixedBuiltFromText['3']?.inputs?.steps !== 20 || fixedBuiltFromText['5']?.inputs?.width !== 896 || fixedBuiltFromText['6']?.inputs?.text !== 'text prompt') throw new Error('字符串 Comfy 工作流没有被结构化覆盖');
const loraWorkflow = {
  ...fixedWorkflow,
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'old prompt', clip: ['65', 1] } },
  '65': { class_type: 'LoraLoader', inputs: { text: '<lora:keep-me:0.8>', model: ['4', 0], clip: ['4', 1] } }
};
const loraBuilt = comfy.buildWorkflow({ workflow: loraWorkflow, prompt: 'lora-safe prompt', width: 1024, height: 1024, steps: 20, cfg: 5, seed: 7 });
if (loraBuilt['6']?.inputs?.text !== 'lora-safe prompt' || loraBuilt['65']?.inputs?.text !== '<lora:keep-me:0.8>') throw new Error('Comfy 覆盖提示词时误改 LoRA 辅助文本');
const combinedWorkflow = {
  ...fixedWorkflow,
  '6': { class_type: 'ConditioningCombine', inputs: { conditioning_1: ['61', 0], conditioning_2: ['62', 0] } },
  '61': { class_type: 'CLIPTextEncode', inputs: { text: 'old one', clip: ['4', 1] } },
  '62': { class_type: 'CLIPTextEncode', inputs: { text: 'old two', clip: ['4', 1] } }
};
const combinedBuilt = comfy.buildWorkflow({ workflow: combinedWorkflow, prompt: 'combined prompt', width: 1024, height: 1024, steps: 20, cfg: 5, seed: 7 });
if (combinedBuilt['61']?.inputs?.text !== 'combined prompt' || combinedBuilt['62']?.inputs?.text !== 'combined prompt') throw new Error('Comfy 组合 conditioning 的文本节点没有全部覆盖');
let missingOverrideError = '';
try { comfy.buildWorkflow({ workflow: { '1': { class_type: 'SaveImage', inputs: {} } }, prompt: 'x', width: 1024, height: 1024, steps: 20, cfg: 7 }); }
catch (error) { missingOverrideError = String(error?.message || error); }
if (!/无法覆盖绘图参数/.test(missingOverrideError)) throw new Error('无法覆盖的 Comfy 工作流没有返回明确错误');
const visionImage = {
  id: 'check-vision-image',
  filename: 'check.png',
  metadata: { promptText: '1girl, blue hair', builtinTags: ['1girl'] }
};
const visionService = modules.createVisionService({
  images: {
    get: id => id === visionImage.id ? visionImage : null,
    metadata: () => visionImage.metadata
  }
});
const visionMetadata = await visionService.processOne({ imageId: visionImage.id, mode: 'metadata' });
if (!visionMetadata.ok || visionMetadata.tool !== 'vision.processOne' || visionMetadata.data?.tags?.[0]?.tag !== '1girl') {
  throw new Error('单图 Vision metadata 模式失败');
}
const visionMany = await visionService.processOne({ imageIds: [visionImage.id], mode: 'metadata' });
if (visionMany.ok || visionMany.code !== 'SINGLE_IMAGE_REQUIRED') throw new Error('Vision 未拒绝 imageIds 数组');
let localVisionOptions = null;
let aiVisionMessages = null;
let aiVisionOptions = null;
const fullVisionService = modules.createVisionService({
  images: {
    get: id => id === visionImage.id ? { ...visionImage, dataUrl: 'data:image/png;base64,AA==' } : null,
    metadata: () => visionImage.metadata,
    update: () => {}
  },
  localVision: {
    analyze: async (_image, options) => {
      localVisionOptions = options;
      return { ok: true, status: 'done', model: 'eva02', tags: [{ tag: 'blue_hair', prob: 0.9 }] };
    }
  },
  visionAI: {
    complete: async (messages, options) => {
      aiVisionMessages = messages;
      aiVisionOptions = options;
      return { ok: true, text: '1girl, outdoors', reasoning: 'check' };
    },
    getConfig: () => ({ model: 'check-vision' })
  },
  getPrompt: () => 'CHECK VISION PROMPT'
});
const localVisionResult = await fullVisionService.processOne({ imageId: visionImage.id, mode: 'local', model: 'eva02' });
if (!localVisionResult.ok || localVisionResult.data?.tags?.[0]?.tag !== 'blue_hair' || localVisionOptions?.model !== 'eva02') throw new Error('单图 Vision local 模式失败');
await fullVisionService.processOne({ imageId: visionImage.id, mode: 'local' });
if (localVisionOptions?.model !== 'eva02') throw new Error('单图 Vision local 默认模型失败');
const aiVisionResult = await fullVisionService.processOne({ imageId: visionImage.id, mode: 'ai', instruction: '重点分析姿势' });
if (!aiVisionResult.ok || aiVisionResult.data?.text !== '1girl, outdoors' || !String(aiVisionMessages?.[0]?.content).includes('CHECK VISION PROMPT') || !String(aiVisionMessages?.[0]?.content).includes('重点分析姿势') || aiVisionMessages.length !== 2
  || aiVisionOptions?.stream !== false
  || aiVisionOptions?.reasoning_effort !== 'none'
  || aiVisionOptions?.enable_thinking !== false
  || aiVisionOptions?.thinking?.type !== 'disabled') {
  throw new Error('单图 Vision ai 模式或独立提示词失败');
}
if (!/只描述图片中可见内容/.test(defaultVisionPromptSource)
  || !/(?:主体|人物|服装|姿势|构图|镜头|光影|色彩|背景)/.test(defaultVisionPromptSource)
  || !/(?:NSFW|成人|不回避)/i.test(defaultVisionPromptSource)
  || /^\s*(?:思维链|思考过程|推理步骤)\s*[:：]/m.test(defaultVisionPromptSource)
  || !/只输出结果/.test(defaultVisionPromptSource)) throw new Error('默认识图提示词未覆盖详细绘图维度或关闭思维链');
if (!/instruction:\s*"请按图片中可见内容进行详细描述/.test(appViewSource)) throw new Error('识图按钮未使用新的精简详细描述指令');
let visionFallbackCalls = 0;
const visionFallbackOptions = [];
const visionFallbackService = modules.createVisionService({
  images: { get: id => id === visionImage.id ? { ...visionImage, dataUrl: 'data:image/png;base64,AA==' } : null },
  visionAI: {
    complete: async (_messages, options) => {
      visionFallbackCalls += 1;
      visionFallbackOptions.push(options);
      if (visionFallbackCalls === 1) throw new Error('AI 请求失败：HTTP 400 · unknown parameter thinking');
      return { ok: true, text: 'fallback description' };
    },
    getConfig: () => ({ model: 'check-vision' })
  },
  getPrompt: () => 'CHECK VISION PROMPT'
});
const visionFallbackResult = await visionFallbackService.processOne({ imageId: visionImage.id, mode: 'ai' });
if (!visionFallbackResult.ok || visionFallbackCalls !== 2 || visionFallbackOptions[0]?.stream !== false
  || Object.prototype.hasOwnProperty.call(visionFallbackOptions[1] || {}, 'reasoning_effort')
  || Object.prototype.hasOwnProperty.call(visionFallbackOptions[1] || {}, 'enable_thinking')
  || Object.prototype.hasOwnProperty.call(visionFallbackOptions[1] || {}, 'thinking')) throw new Error('识图关闭思维链参数缺少兼容回退');
const unsupportedVisionService = modules.createVisionService({
  images: { get: id => id === visionImage.id ? { ...visionImage, dataUrl: 'data:image/png;base64,AA==' } : null },
  visionAI: { complete: async () => { throw new Error('This model does not support image'); }, getConfig: () => ({ model: 'text-only', configured: true }) },
  getPrompt: () => 'CHECK VISION PROMPT'
});
const unsupportedVisionResult = await unsupportedVisionService.processOne({ imageId: visionImage.id, mode: 'ai' });
if (unsupportedVisionResult.ok || unsupportedVisionResult.code !== 'VISION_MODEL_NOT_SUPPORTED' || !/选择视觉模型/.test(unsupportedVisionResult.error)) throw new Error('不支持图片的模型未转换为可操作错误');
const calls = modules.createCalls({ tags: { search: query => [{ en: query }] } });
if (!calls.has('tags.search') || !calls.list().some(item => item.name === 'vision.processOne')) throw new Error('Calls 工具注册失败');
if (calls.has('vision.readMetadata') || calls.has('vision.localIdentify') || calls.has('vision.aiDescribe')) throw new Error('旧 Vision 数组工具仍在正式清单');
const visionSchema = calls.schemas().find(item => item.name === 'vision.processOne');
if (!visionSchema?.inputSchema?.required?.includes('mode')
  || !visionSchema?.inputSchema?.properties?.imageId
  || !visionSchema?.inputSchema?.properties?.imagePath) throw new Error('单图 Vision schema 不完整');
let pathReads = 0;
const pathCalls = modules.createCalls({
  images: { addFile: async () => { pathReads += 1; return { id: 'path-image' }; } },
  visionService: { available: () => ({ metadata: true, local: false, ai: false }), processOne: async input => ({ ok: true, imageId: input.imageId }) }
});
const rejectedPathResult = await pathCalls.call('vision.processOne', { imagePath: 'C:\\Windows\\System32\\secret.png', mode: 'metadata' }, { caller: 'ui' });
const pathRejected = rejectedPathResult?.code === 'PATH_INPUT_DISABLED';
if (!pathRejected || pathReads !== 0) throw new Error('UI Vision 路径输入未被拒绝或错误读取文件');
const authorizedPathCalls = modules.createCalls({
  images: { addFile: async () => { pathReads += 1; return { id: 'authorized-path' }; } },
  visionService: { available: () => ({ metadata: true, local: false, ai: false }), processOne: async input => ({ ok: true, imageId: input.imageId }) }
});
const authorizedPath = await authorizedPathCalls.call('vision.processOne', { imagePath: 'C:\\allowed\\image.png', mode: 'metadata' }, { caller: 'external-agent', allowPath: true, allowWrite: true });
if (authorizedPath?.code !== 'PATH_INPUT_DISABLED' || pathReads !== 0) throw new Error('未登记的 Agent 路径仍可直接读取');
const registeredPath = await authorizedPathCalls.call('vision.processOne', { imagePath: 'C:\\registered\\image.png', mode: 'metadata' }, {
  caller: 'external-agent', allowPath: true, allowWrite: true,
  resolveRegisteredImagePath: path => path === 'C:\\registered\\image.png' ? { imageId: 'registered-image' } : null
});
if (registeredPath?.imageId !== 'registered-image' || pathReads !== 0) throw new Error('已登记路径未通过受控 resolver 映射且未保持零文件读取');
if ((await calls.listAvailable(['comfy.render'])).some(item => item.name === 'comfy.render')) throw new Error('Comfy 未配置时仍暴露 render 工具');
let comfyAvailable = true;
const dynamicCalls = modules.createCalls({
  comfy: {
    workflow: '{}',
    workflowStatus: () => ({ ready: true }),
    check: async () => comfyAvailable,
    render: async () => ({ filename: 'dynamic.png', dataUrl: 'data:image/png;base64,AA==' })
  },
  getSettings: () => ({ comfyOn: true })
});
if (!(await dynamicCalls.listAvailable(['comfy.render'])).some(item => item.name === 'comfy.render')) throw new Error('Comfy 可用时未暴露 render 工具');
let disabledComfyChecks = 0;
const disabledConnectedCalls = modules.createCalls({
  comfy: {
    workflow: '{}',
    workflowStatus: () => ({ ready: true }),
    check: async () => { disabledComfyChecks += 1; return true; }
  },
  getSettings: () => ({ comfyOn: false })
});
const disabledConnectedState = await disabledConnectedCalls.refreshCapabilities({ force: true });
if (disabledComfyChecks !== 1 || disabledConnectedState.comfy.enabled || !disabledConnectedState.comfy.connected || disabledConnectedState.comfy.render) throw new Error('Comfy 停用状态与连接状态未正确分离');
const aiRenderTool = (await dynamicCalls.openAiToolsAvailable(['comfy.render'], { force: true, forAi: true }))[0];
if (!aiRenderTool?.function?.parameters?.required?.includes('prompt') || aiRenderTool.function.parameters.properties.width) throw new Error('主 AI 的 Comfy 工具参数未收敛');
comfyAvailable = false;
if ((await dynamicCalls.listAvailable(['comfy.render'], { force: true })).some(item => item.name === 'comfy.render')) throw new Error('Comfy 断开后仍暴露 render 工具');
const callResult = await calls.call('tags.search', { query: 'blue hair' });
if (!callResult.ok || callResult.data?.items?.[0]?.en !== 'blue hair') throw new Error('Calls 工具执行失败');
const blockedWrite = await calls.call('prompts.update', { id: 'main', text: 'x' });
if (blockedWrite.ok || blockedWrite.code !== 'PERMISSION_DENIED') throw new Error('Calls 权限检查失败');
let gatewayCalls = 0;
const assistant = modules.createAssistant({
  ai: { async complete() {
    gatewayCalls += 1;
    return gatewayCalls === 1
      ? { ok: true, text: '', tool_calls: [{ id: 'check-call', type: 'function', function: { name: 'tags_search', arguments: JSON.stringify({ query: 'blue hair' }) } }] }
      : { ok: true, text: '工具调用完成' };
  } },
  tags: { search: query => [{ en: query }] },
  storage: { get: () => [], set: () => {} },
  compact: false
});
let unifiedMessages = [];
const unifiedAssistant = modules.createAssistant({
  ai: { async complete(messages) { unifiedMessages.push(messages); return { ok: true, text: '统一 Runner 完成' }; } },
  promptDir: path.join(root, 'assets', '提示词素材'),
  storage: { get: () => [], set: () => {} }
});
if (unifiedAssistant.generate || unifiedAssistant.recreate || unifiedAssistant.iterateWithComfy || unifiedAssistant.gen || unifiedAssistant.rk) throw new Error('Assistant 仍暴露旧四模式入口');
const textOnlyAssistant = modules.createAssistant({ config: { base: 'http://vision-check.local/v1', model: 'deepseek-chat' }, storage: { get: () => [], set: () => {} } });
const textOnlyVision = await textOnlyAssistant.visionAi.complete([{ role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }]);
if (textOnlyVision.ok || textOnlyVision.code !== 'VISION_MODEL_NOT_SUPPORTED' || textOnlyAssistant.visionService.available().ai) throw new Error('文本模型未在视觉请求前被拦截');
let inheritedVisionOptions = null;
const inheritedVisionAssistant = modules.createAssistant({
  config: { base: 'https://api.deepseek.com', model: 'deepseek-v4-flash-vision-exp' },
  visionApi: { inheritPrimary: true, model: 'deepseek-chat' },
  primaryGateway: { async complete() { return { ok: true, text: '主模型完成' }; } },
  visionGateway: { async complete(_messages, options) { inheritedVisionOptions = options; return { ok: true, text: '视觉模型完成' }; } },
  storage: { get: () => [], set: () => {} }
});
if (inheritedVisionAssistant.visionAi.getConfig()?.model !== 'deepseek-v4-flash-vision-exp' || !inheritedVisionAssistant.visionAi.getConfig()?.imageCapable) throw new Error('沿用主配置未使用主视觉模型');
await inheritedVisionAssistant.visionAi.complete([{ role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }]);
if (inheritedVisionOptions?.model !== 'deepseek-v4-flash-vision-exp' || inheritedVisionOptions?.base !== 'https://api.deepseek.com') throw new Error('沿用主配置未传递主 API 视觉模型');
const assistantRunResult = await unifiedAssistant.run({ mode: 'assistant', text: '普通问题' });
if (!assistantRunResult.ok || assistantRunResult.mode !== 'assistant' || !unifiedMessages.length || /内部主提示词|生成Tag任务/.test(String(unifiedMessages[0]?.[0]?.content || ''))) throw new Error('统一 Runner 助手模式失败');
const drawRunResult = await unifiedAssistant.run({ mode: 'draw', text: '一位蓝发角色' });
if (!drawRunResult.ok || drawRunResult.mode !== 'draw' || !/Anima|最终提示词|Tag/.test(String(unifiedMessages.at(-1)?.[0]?.content || ''))) throw new Error('统一 Runner 绘图模式失败');
let drawStorageWrites = 0;
let drawStoragePayload = null;
const drawOutputAssistant = modules.createAssistant({
  ai: { async complete(_messages, options) {
    for (let index = 0; index < 30; index += 1) options.onDelta?.('token', '');
    return { ok: true, text: '【思考过程】\n只保留这一份思考\n【最终提示词】\n```\n1girl, blue hair\n```', reasoning: '不应与标记思考重复' };
  } },
  storage: { get: () => [], set: (_key, value) => { drawStorageWrites += 1; drawStoragePayload = value; } }
});
const drawOutputResult = await drawOutputAssistant.run({ mode: 'draw', text: '输出格式测试' });
const drawOutputMessage = drawOutputAssistant.currentSession().messages.at(-1);
if (!drawOutputResult.ok || drawOutputMessage?.text !== '1girl, blue hair' || drawOutputMessage?.text.includes('【最终提示词】') || drawOutputMessage?.result?.prompt !== '1girl, blue hair' || drawOutputMessage?.reasoning !== '只保留这一份思考') {
  throw new Error('绘图输出没有归一化为单份思考和最终提示词');
}
if (drawStorageWrites > 4) throw new Error('流式输出仍在逐 token 写入会话文件');
if (/data:image/.test(JSON.stringify(drawStoragePayload || {}))) throw new Error('会话持久化仍包含重复图片 Data URL');
let runnerTools = [];
let runnerTurns = 0;
const runnerAssistant = modules.createAssistant({
  ai: { async complete(_messages, options) {
    runnerTools = options.tools || [];
    runnerTurns += 1;
    return runnerTurns === 1
      ? { ok: true, text: '', tool_calls: [{ id: 'runner-tag', type: 'function', function: { name: 'tags_search', arguments: '{"query":"blue hair"}' } }] }
      : { ok: true, text: 'Runner 工具完成' };
  } },
  tags: { search: query => [{ en: query }] },
  storage: { get: () => [], set: () => {} },
  compact: false
});
const runnerResult = await runnerAssistant.run({ mode: 'assistant', text: '查询蓝发' });
if (!runnerResult.ok || runnerResult.aiTurns !== 2 || runnerResult.toolCalls !== 1 || !runnerTools.some(item => item.function?.name === 'tags_search')) throw new Error('统一 Runner 工具循环/计数失败');
let thinkingChoiceAttempts = [];
let thinkingTurns = 0;
let thinkingRendered = false;
const thinkingRunner = modules.createAiRunner({
  ai: { async complete(_messages, options) {
    thinkingChoiceAttempts.push(Object.prototype.hasOwnProperty.call(options || {}, 'tool_choice'));
    if (options?.tool_choice) throw new Error('AI 请求失败：HTTP 400 · {"error":{"message":"Thinking mode does not support this tool_choice"}}');
    thinkingTurns += 1;
    return !thinkingRendered
      ? { ok: true, text: '', toolCalls: [{ id: 'thinking-render', type: 'function', function: { name: 'comfy_render', arguments: '{"prompt":"1girl"}' } }] }
      : { ok: true, text: 'Thinking 模式完成' };
  } },
  calls: {
    refreshCapabilities: async () => {},
    getCapabilities: () => ({ comfy: { render: true } }),
    openAiTools: () => [{ type: 'function', function: { name: 'comfy_render', parameters: { type: 'object' } } }],
    openAiToolsAvailable: async () => [{ type: 'function', function: { name: 'comfy_render', parameters: { type: 'object' } } }],
    resolve: name => name === 'comfy_render' ? { name: 'comfy.render' } : { name },
    call: async () => { thinkingRendered = true; return { ok: true, data: { artifact: { id: 'thinking-image', dataUrl: 'data:image/png;base64,AA==' } } }; }
  },
  compact: false
});
const thinkingResult = await thinkingRunner.run({
  task: 'comfy', profile: 'draw', input: { maxIterations: 1, primaryVision: true }, config: { comfyToolChoice: 'required' },
  messages: [{ role: 'user', content: 'Thinking 工具兼容测试' }], job: { signal: {} }
});
if (!thinkingResult.ok || thinkingResult.renderCount !== 1 || thinkingChoiceAttempts.length < 2 || thinkingChoiceAttempts[0] !== true || thinkingChoiceAttempts.slice(1).some(Boolean)) {
  throw new Error('Thinking 模式 tool_choice 回退失败');
}
let aliasVisionArgs = null;
let aliasTurns = 0;
const aliasRunner = modules.createAiRunner({
  ai: { async complete() {
    aliasTurns += 1;
    return aliasTurns === 1
      ? { ok: true, text: '', toolCalls: [{ id: 'alias-vision', type: 'function', function: { name: 'vision_processOne', arguments: '{"imageId":"图片1","mode":"ai"}' } }] }
      : { ok: true, text: '单图识图完成' };
  } },
  calls: {
    refreshCapabilities: async () => {},
    getCapabilities: () => ({ comfy: { render: false } }),
    openAiTools: () => [{ type: 'function', function: { name: 'vision_processOne', parameters: { type: 'object' } } }],
    openAiToolsAvailable: async () => [{ type: 'function', function: { name: 'vision_processOne', parameters: { type: 'object' } } }],
    resolve: name => name === 'vision_processOne' ? { name: 'vision.processOne' } : { name },
    call: async (_name, args) => { aliasVisionArgs = args; return { ok: true, data: { text: 'alias ok' } }; }
  },
  compact: false
});
const aliasResult = await aliasRunner.run({
  task: 'assistant', profile: 'assistant', input: { imageIds: ['actual-image-id'] }, config: {},
  messages: [{ role: 'user', content: '请选择图片1进行识图' }], job: { signal: {} }
});
if (!aliasResult.ok || aliasVisionArgs?.imageId !== 'actual-image-id') throw new Error('Vision 图片显示编号未解析为真实 imageId');
let referenceMessages = [];
const referenceAssistant = modules.createAssistant({
  ai: { async complete(messages) { referenceMessages = messages; return { ok: true, text: '引用已识别' }; } },
  images: { get: id => id === 'reference-image' ? { id, filename: 'reference.png', dataUrl: 'data:image/png;base64,AA==' } : null },
  storage: { get: () => [], set: () => {} }
});
const referenceResult = await referenceAssistant.run({ mode: 'assistant', text: '请使用图片1', imageIds: ['reference-image'] });
if (!referenceResult.ok || /imageId\s*:\s*reference-image|refId\s*:\s*reference-image/.test(JSON.stringify(referenceMessages)) || !JSON.stringify(referenceMessages).includes('图1') || !referenceAssistant.imageRepository.listConversation(referenceResult.sessionId).items.some(item => item.imageId === 'reference-image')) throw new Error('AI 图片引用未使用脱敏图号且未保留内部映射');
let unavailableRunnerTools = null;
const unavailableRunner = modules.createAssistant({
  ai: { async complete(_messages, options) { unavailableRunnerTools = options.tools || []; return { ok: true, text: '无 Comfy 工具' }; } },
  storage: { get: () => [], set: () => {} },
  compact: false
});
const unavailableRunnerResult = await unavailableRunner.run({ mode: 'draw', text: '只写提示词' });
if (!unavailableRunnerResult.ok || unavailableRunnerTools.some(item => item.function?.name === 'comfy_render')) throw new Error('Comfy 不可用时 Runner 仍暴露工具');
let comfyRunnerTools = [];
const comfyRunner = modules.createAssistant({
  ai: { async complete(_messages, options) { comfyRunnerTools = options.tools || []; return { ok: true, text: '绘图 Tag 已生成' }; } },
  comfy: { workflow: '{"1":{"class_type":"SaveImage","inputs":{}}}', workflowStatus: () => ({ ready: true }), check: async () => true, render: async () => ({ filename: 'runner.png', dataUrl: 'data:image/png;base64,AA==' }) },
  storage: { get: () => [], set: () => {} },
  compact: false
});
comfyRunner.setSettings({ comfyOn: true });
const comfyRunnerResult = await comfyRunner.run({ mode: 'draw', task: 'draw', text: '准备绘图' }, { comfyWorkflow: '{"1":{"class_type":"SaveImage","inputs":{}}}' });
if (!comfyRunnerResult.ok || !comfyRunnerTools.some(item => item.function?.name === 'comfy_render')) throw new Error('Comfy 可用时绘图 Runner 缺少 render 工具');
const assistantResult = await assistant.run({ mode: 'assistant', text: '查询蓝发' });
if (!assistantResult.ok || assistantResult.text !== '工具调用完成' || gatewayCalls !== 2) throw new Error('Assistant 工具循环失败');
const legacyCall = modules.normaliseCompletion({ choices: [{ message: { function_call: { name: 'tags_search', arguments: '{"query":"legacy"}' } } }] });
if (legacyCall.toolCalls?.[0]?.function?.name !== 'tags_search') throw new Error('旧版 function_call 解析失败');
const markedCall = modules.normaliseCompletion('<tool_call>{"name":"tags_search","arguments":{"query":"marked"}}</tool_call>');
if (markedCall.toolCalls?.[0]?.function?.name !== 'tags_search') throw new Error('文本工具调用标记解析失败');
let comfyTurns = 0;
const budgetAssistant = modules.createAssistant({
  ai: { async complete() {
    comfyTurns += 1;
    if (comfyTurns === 1) return { ok: true, text: '', tool_calls: [{ id: 'render-1', type: 'function', function: { name: 'comfy_render', arguments: JSON.stringify({ prompt: '1girl' }) } }] };
    if (comfyTurns === 2 || comfyTurns === 3) return { ok: true, text: '', tool_calls: [{ id: `vision-${comfyTurns}`, type: 'function', function: { name: 'tags_search', arguments: JSON.stringify({ query: 'girl' }) } }] };
    return { ok: true, text: '单轮最终结果' };
  } },
  comfy: { check: async () => true, setBase: () => {}, setWorkflow: () => {}, render: async () => ({ filename: 'check.png', dataUrl: 'data:image/png;base64,AA==' }) },
  storage: { get: () => [], set: () => {} },
  compact: false
});
const budgetResult = await runDrawContext(budgetAssistant, { text: '单轮预算测试' }, { maxIterations: 1, comfyWorkflow: '{"1":{"class_type":"SaveImage","inputs":{}}}' });
if (!budgetResult.ok || budgetResult.renderCount !== 1 || budgetResult.aiTurns !== 4 || comfyTurns !== 4) throw new Error('ComfyUI 迭代/对话预算混淆');
let fallbackTurns = 0;
const fallbackAssistant = modules.createAssistant({
  ai: { async complete() { fallbackTurns += 1; return fallbackTurns === 1 ? { ok: true, text: '我暂时无法发出工具调用' } : { ok: true, text: '仍然没有发出工具调用' }; } },
  comfy: { check: async () => true, setBase: () => {}, setWorkflow: () => {}, render: async () => ({ filename: 'fallback.png', dataUrl: 'data:image/png;base64,AA==' }) },
  storage: { get: () => [], set: () => {} },
  compact: false
});
const fallbackResult = await runDrawContext(fallbackAssistant, { text: '无工具调用测试' }, { maxIterations: 1, maxToolRounds: 3, comfyWorkflow: '{"1":{"class_type":"SaveImage","inputs":{}}}' });
if (fallbackResult.ok || fallbackResult.status !== 'tool_required' || fallbackTurns !== 2) throw new Error('无原生工具调用未返回明确错误');
let reasoningRenderTurns = 0;
let reasoningRenderCount = 0;
const reasoningRenderAssistant = modules.createAssistant({
  ai: { async complete() { reasoningRenderTurns += 1; return reasoningRenderTurns === 1 ? { ok: true, text: '', reasoning: 'I will render an image with prompt: 1girl, blue hair' } : { ok: true, text: '思考内容触发渲染' }; } },
  comfy: { check: async () => true, setBase: () => {}, setWorkflow: () => {}, render: async () => { reasoningRenderCount += 1; return { filename: 'reasoning.png', dataUrl: 'data:image/png;base64,AA==' }; } },
  storage: { get: () => [], set: () => {} },
  compact: false
});
const reasoningRenderResult = await runDrawContext(reasoningRenderAssistant, { text: '思考流工具意图测试' }, { maxIterations: 1, comfyWorkflow: '{"1":{"class_type":"SaveImage","inputs":{}}}' });
if (reasoningRenderResult.ok || reasoningRenderCount !== 0 || reasoningRenderResult.status !== 'tool_required') throw new Error('旧文本渲染协议未被移除');
let mainMessages = [];
let visionCalls = 0;
const candidateEvents = [];
const renderedImage = { id: 'render-image', filename: 'render.png', dataUrl: 'data:image/png;base64,AA==' };
const imageRows = new Map([[renderedImage.id, renderedImage]]);
const imageStore = {
  add: () => { imageRows.set(renderedImage.id, renderedImage); return renderedImage; },
  get: id => imageRows.get(id)
};
let mainTurns = 0;
const roundTripAssistant = modules.createAssistant({
  ai: { async complete(messages) {
    mainMessages.push(messages);
    mainTurns += 1;
    return mainTurns === 1
      ? { ok: true, text: '', tool_calls: [{ id: 'roundtrip-render', type: 'function', function: { name: 'comfy_render', arguments: '{"prompt":"1girl"}' } }] }
      : { ok: true, text: '返图分析完成\n【最佳候选】candidate-1' };
  } },
  visionApi: { base: 'http://vision.local/v1', model: 'vision-model', inheritPrimary: false },
  visionGateway: { async complete() { visionCalls += 1; return { ok: true, text: '1girl, blue hair' }; } },
  images: imageStore,
  comfy: { check: async () => true, setBase: () => {}, setWorkflow: () => {}, render: async () => renderedImage },
  storage: { get: () => [], set: () => {} },
  compact: false
});
const roundTripResult = await runDrawContext(roundTripAssistant, { text: '返图回灌测试', primaryVision: false, onToolEvent: event => { if (event.type === 'candidate-ready') candidateEvents.push(event); } }, { maxIterations: 1, comfyWorkflow: '{"1":{"class_type":"SaveImage","inputs":{}}}' });
const secondRoundHasImage = mainMessages[1]?.some(message => JSON.stringify(message.content || '').includes('image_url'));
const roundTripMessage = roundTripAssistant.currentSession().messages.at(-1);
if (!roundTripResult.ok || roundTripResult.renderCount !== 1 || visionCalls !== 1 || secondRoundHasImage || candidateEvents.length !== 1 || roundTripMessage?.candidates?.[0]?.prompt !== '1girl' || roundTripMessage?.candidates?.[0]?.imageId !== 'render-image' || roundTripMessage?.result?.finalCandidateId !== 'candidate-1' || !roundTripMessage?.activity?.some(item => item.type === 'thinking') || !roundTripMessage?.activity?.some(item => item.type === 'tool')) throw new Error('非视觉主模型返图或候选事件未正确记录');
const chosenRoundTrip = roundTripAssistant.chooseCandidate(roundTripMessage.id, 'candidate-1');
if (chosenRoundTrip?.finalImageId !== 'render-image' || chosenRoundTrip?.finalPrompt !== '1girl' || chosenRoundTrip?.selectionSource !== 'user') throw new Error('用户选择候选图后最终结果未绑定本轮 Tag');
let undecidedTurns = 0;
const undecidedAssistant = modules.createAssistant({
  ai: { async complete() {
    undecidedTurns += 1;
    return undecidedTurns === 1
      ? { ok: true, text: '', tool_calls: [{ id: 'undecided-render', type: 'function', function: { name: 'comfy_render', arguments: '{"prompt":"candidate prompt"}' } }] }
      : { ok: true, text: '两张图都已生成，请用户选择。' };
  } },
  comfy: { check: async () => true, setBase: () => {}, setWorkflow: () => {}, render: async () => ({ id: 'undecided-image', filename: 'undecided.png', dataUrl: 'data:image/png;base64,AA==' }) },
  storage: { get: () => [], set: () => {} },
  compact: false
});
const undecidedResult = await runDrawContext(undecidedAssistant, { text: '候选选择测试', primaryVision: true }, { maxIterations: 1, comfyWorkflow: '{"1":{"class_type":"SaveImage","inputs":{}}}' });
if (!undecidedResult.ok || !undecidedResult.selectionRequired || undecidedResult.prompt || undecidedAssistant.currentSession().messages.at(-1)?.result?.prompt) throw new Error('未推荐候选时错误生成最终提示词');
let initialVisionCalls = 0;
let initialMainTurns = 0;
let initialMainMessages = [];
const initialImage = { id: 'initial-image', filename: 'base.png', dataUrl: 'data:image/png;base64,AA==' };
const initialAssistant = modules.createAssistant({
  ai: { async complete(messages) { initialMainMessages.push(messages); initialMainTurns += 1; return initialMainTurns === 1 ? { ok: true, text: '', tool_calls: [{ id: 'initial-render', type: 'function', function: { name: 'comfy_render', arguments: '{"prompt":"1girl"}' } }] } : { ok: true, text: '基准图已理解' }; } },
  visionApi: { base: 'http://vision.local/v1', model: 'vision-model', inheritPrimary: false },
  visionGateway: { async complete() { initialVisionCalls += 1; return { ok: true, text: '1girl, blue hair' }; } },
  images: { get: id => id === initialImage.id ? initialImage : null },
  comfy: { check: async () => true, setBase: () => {}, setWorkflow: () => {}, render: async () => ({ filename: 'out.png', dataUrl: 'data:image/png;base64,AA==' }) },
  storage: { get: () => [], set: () => {} },
  compact: false
});
const initialResult = await runDrawContext(initialAssistant, { text: '分析基准图后出图', imageIds: [initialImage.id], primaryVision: false }, { maxIterations: 1, comfyWorkflow: '{"1":{"class_type":"SaveImage","inputs":{}}}' });
if (!initialResult.ok || initialResult.renderCount !== 1 || initialVisionCalls !== 1 || JSON.stringify(initialMainMessages[0] || []).includes('image_url')) throw new Error('非视觉主模型未先调用基准图识图');
let visionPrimaryMessages = [];
let visionPrimaryTurns = 0;
const visionPrimaryAssistant = modules.createAssistant({
  ai: { async complete(messages) {
    visionPrimaryMessages.push(messages);
    visionPrimaryTurns += 1;
    return visionPrimaryTurns === 1
      ? { ok: true, text: '', tool_calls: [{ id: 'vision-primary-render', type: 'function', function: { name: 'comfy_render', arguments: '{"prompt":"1girl"}' } }] }
      : { ok: true, text: '视觉主模型已收到返图' };
  } },
  images: imageStore,
  comfy: { check: async () => true, setBase: () => {}, setWorkflow: () => {}, render: async () => renderedImage },
  storage: { get: () => [], set: () => {} },
  compact: false
});
const visionPrimaryResult = await runDrawContext(visionPrimaryAssistant, { text: '视觉主模型返图测试', primaryVision: true }, { maxIterations: 1, comfyWorkflow: '{"1":{"class_type":"SaveImage","inputs":{}}}' });
const primaryGotImage = visionPrimaryMessages[1]?.some(message => JSON.stringify(message.content || '').includes('image_url'));
if (!visionPrimaryResult.ok || visionPrimaryResult.renderCount !== 1 || !primaryGotImage) throw new Error('视觉主模型未收到 ComfyUI 返图');

// Task 6 compact runner integration contract. These assertions intentionally
// exercise the AI-facing protocol rather than the legacy native adapter above.
async function runTask6CompactRunnerTests() {
  const requests = [];
  const executed = [];
  const rows = [
    { sessionId: 'task6-session', refId: 'task6-ref-1', imageId: 'task6-image-1', slotNo: 1, displayTitle: 'Hero', pending: true, candidateId: 'candidate-0' },
    { sessionId: 'task6-session', refId: 'task6-ref-2', imageId: 'task6-image-2', slotNo: 2, displayTitle: 'Other', pending: false }
  ];
  const repository = {
    listConversation: () => ({ items: rows }),
    attachToConversation: (sessionId, imageId, meta) => ({ sessionId, imageId, ...meta }),
    setConversationTitle: (sessionId, refId, title) => ({ sessionId, refId, displayTitle: title })
  };
  const calls = {
    refreshCapabilities: async () => {},
    getCapabilities: () => ({ comfy: { render: true } }),
    // These legacy methods are deliberately present. Compact mode must bypass
    // them and therefore must not put tools/tool_choice in the AI options.
    openAiToolsAvailable: async () => [{ type: 'function', function: { name: 'comfy_render', parameters: { type: 'object' } } }],
    openAiTools: () => [{ type: 'function', function: { name: 'comfy_render', parameters: { type: 'object' } } }],
    resolve: name => ({ name: name === 'comfy_render' ? 'comfy.render' : name }),
    has: name => ['vision.processOne', 'comfy.render'].includes(name),
    call: async (name, args) => {
      executed.push({ name, args });
      if (name === 'vision.processOne') return { ok: true, data: { text: 'blue hair, outdoor lighting', tags: [{ tag: 'blue hair' }] } };
      if (name === 'comfy.render') return { ok: true, data: { artifact: { id: 'task6-render-image', filename: 'task6.png', dataUrl: 'data:image/png;base64,AA==', path: 'C:\\private', workflow: { secret: true } } } };
      return { ok: true, data: { items: [] } };
    }
  };
  let turn = 0;
  const ai = {
    complete: async (messages, options) => {
      requests.push({ messages, options });
      turn += 1;
      if (turn === 1) return { ok: true, text: '我先读取参考图\n{"call":"vision","image":"Hero"}' };
      return { ok: true, text: '参考图已理解' };
    }
  };
  const runner = modules.createAiRunner({ ai, calls });
  const result = await runner.run({
    task: 'assistant', profile: 'assistant',
    input: { sessionId: 'task6-session', imageRepository: repository, pendingRefIds: ['task6-ref-1'], imageIds: ['task6-image-1'], primaryVision: false },
    messages: [
      { role: 'system', content: 'system' },
      { role: 'assistant', content: [{ type: 'text', text: 'old' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,HISTORIC' } }], tool_calls: [{ id: 'orphan', function: { name: 'x', arguments: '{}' } }] },
      { role: 'user', content: '请看 Hero' }
    ],
    job: { signal: {} }
  });
  if (!result.ok || result.aiTurns !== 2 || executed[0]?.name !== 'vision.processOne') throw new Error('Task 6 compact call round-trip failed');
  if (requests.some(item => Object.prototype.hasOwnProperty.call(item.options || {}, 'tools') || Object.prototype.hasOwnProperty.call(item.options || {}, 'tool_choice'))) throw new Error('Compact mode leaked native tools/tool_choice');
  const followup = requests[1]?.messages || [];
  if (followup.some(message => message.role === 'tool' || (message.role === 'assistant' && message.tool_calls))) throw new Error('Compact follow-up contains native tool history');
  if (JSON.stringify(followup).includes('HISTORIC')) throw new Error('Compact follow-up resent assistant image history');
  if (!JSON.stringify(followup).includes('blue hair')) throw new Error('Vision result was not injected as short context');
  if (JSON.stringify(followup).includes('data:image') || JSON.stringify(followup).includes('C:\\private') || JSON.stringify(followup).includes('secret')) throw new Error('Compact context leaked sensitive tool data');

  let ordinaryVisionCalls = 0;
  let ordinaryTurns = 0;
  const ordinaryRequests = [];
  const ordinaryRunner = modules.createAiRunner({
    ai: { complete: async messages => { ordinaryRequests.push(messages); ordinaryTurns += 1; return { ok: true, text: 'ordinary complete' }; } },
    calls: { refreshCapabilities: async () => {}, getCapabilities: () => ({ comfy: { render: false } }), openAiToolsAvailable: async () => [], openAiTools: () => [], has: name => name === 'vision.processOne', resolve: name => ({ name }), call: async name => { if (name === 'vision.processOne') { ordinaryVisionCalls += 1; return { ok: true, data: { text: 'ordinary vision summary' } }; } return { ok: true, data: {} }; } },
    compact: true
  });
  const ordinaryResult = await ordinaryRunner.run({ task: 'assistant', profile: 'assistant', input: { sessionId: 'ordinary-session', primaryVision: false, pendingRefIds: ['ordinary-ref'], imageRepository: { listConversation: () => ({ items: [{ sessionId: 'ordinary-session', refId: 'ordinary-ref', imageId: 'ordinary-image', slotNo: 1, displayTitle: 'Ordinary', pending: true }] }) } }, messages: [{ role: 'user', content: '请理解这张图' }], job: { signal: {} } });
  if (!ordinaryResult.ok || ordinaryVisionCalls !== 1 || ordinaryTurns !== 1 || ordinaryRequests.some(messages => JSON.stringify(messages).includes('image_url')) || !JSON.stringify(ordinaryRequests[0] || []).includes('ordinary vision summary')) throw new Error('Non-vision assistant did not inject controlled Vision summary');

  let detachedAiCalls = 0;
  const detachedRunner = modules.createAiRunner({
    ai: { complete: async () => { detachedAiCalls += 1; return { ok: true, text: 'detached should not run' }; } },
    calls: { refreshCapabilities: async () => {}, getCapabilities: () => ({ comfy: { render: false } }), call: async () => ({ ok: true, data: {} }) },
    compact: true
  });
  const detachedResult = await detachedRunner.run({ task: 'assistant', profile: 'assistant', input: { sessionId: 'detached-session', text: '请看图1', imageIds: ['detached-image'], images: [{ id: 'detached-image', dataUrl: 'data:image/png;base64,AA==' }], imageRepository: { listConversation: () => ({ items: [] }) } }, messages: [{ role: 'user', content: '请看图1' }], job: { signal: {} } });
  if (detachedAiCalls || detachedResult.ok !== false || detachedResult.status !== 'image_reference') throw new Error('Detached input image bypassed compact session scope');

  const renderRequests = [];
  const renderAttached = [];
  let renderTurn = 0;
  const renderRunner = modules.createAiRunner({
    ai: { complete: async (messages, options) => { renderRequests.push({ messages, options }); renderTurn += 1; return renderTurn === 1 ? { ok: true, text: '{"call":"render","prompt":"1girl, blue hair"}' } : { ok: true, text: '完成\n【最佳候选】candidate-1' }; } },
    calls: {
      refreshCapabilities: async () => {}, getCapabilities: () => ({ comfy: { render: true } }),
      openAiToolsAvailable: async () => [{ type: 'function', function: { name: 'comfy_render', parameters: {} } }],
      openAiTools: () => [{ type: 'function', function: { name: 'comfy_render', parameters: {} } }],
      resolve: name => ({ name: name === 'comfy_render' ? 'comfy.render' : name }),
      has: () => true,
      call: async () => ({ ok: true, data: { artifact: { id: 'task6-render-image', filename: 'C:\\private\\task6.png', dataUrl: 'data:image/png;base64,AA==', viewUrl: 'C:\\private\\preview.png', path: 'C:\\private', workflow: { secret: true } } } })
    },
    compact: true
  });
  const renderRepository = { listConversation: () => ({ items: [] }), attachToConversation: (sessionId, imageId, meta) => { renderAttached.push({ sessionId, imageId, ...meta }); return { sessionId, imageId, ...meta }; } };
  const renderResult = await renderRunner.run({ task: 'comfy', profile: 'draw', input: { sessionId: 'task6-render-session', imageRepository: renderRepository, allowRender: true, confirmRender: true, primaryVision: true, maxIterations: 1 }, messages: [{ role: 'user', content: '出图' }], job: { signal: {} } });
  if (!renderResult.ok || renderAttached[0]?.imageId !== 'task6-render-image' || renderAttached[0]?.candidateId !== 'candidate-1') throw new Error('Comfy compact candidate association failed');
  if (JSON.stringify(renderRequests[1]?.messages || []).includes('C:\\private') || JSON.stringify(renderRequests[1]?.messages || []).includes('secret')) throw new Error('Comfy result context leaked artifact payload');
  if (renderResult.candidates?.[0]?.artifact?.viewUrl || renderResult.candidates?.[0]?.artifact?.url || /C:\\private|data:image/.test(JSON.stringify(renderResult.toolCallsUsed || []))) throw new Error('Compact artifact retained an unsafe preview URL');
  if (renderResult.candidates?.[0]?.artifact?.filename !== 'task6.png') throw new Error('Compact artifact retained a path-bearing filename');

  let ambiguousExecutions = 0;
  let ambiguousTurns = 0;
  const ambiguousRunner = modules.createAiRunner({
    ai: { complete: async () => { ambiguousTurns += 1; return { ok: true, text: '{"call":"vision","image":"Same"}' }; } },
    calls: { refreshCapabilities: async () => {}, getCapabilities: () => ({ comfy: { render: false } }), openAiToolsAvailable: async () => [], openAiTools: () => [], resolve: name => ({ name }), has: () => true, call: async () => { ambiguousExecutions += 1; return { ok: true, data: {} }; } },
    compact: true
  });
  const ambiguousResult = await ambiguousRunner.run({ task: 'assistant', profile: 'assistant', input: { sessionId: 'task6-session', imageRepository: { listConversation: () => ({ items: [{ sessionId: 'task6-session', refId: 'a', imageId: 'a', slotNo: 1, displayTitle: 'Same' }, { sessionId: 'task6-session', refId: 'b', imageId: 'b', slotNo: 2, displayTitle: 'Same' }] }) } }, messages: [{ role: 'user', content: '识图' }], job: { signal: {} } });
  if (ambiguousExecutions || ambiguousTurns !== 1 || ambiguousResult.ok !== false || !/不唯一|歧义/.test(String(ambiguousResult.text || ambiguousResult.error))) throw new Error('Ambiguous image reference did not pause safely');
  let multiCallExecutions = 0;
  const multiCallRunner = modules.createAiRunner({
    ai: { complete: async () => ({ ok: true, text: '{"call":"search","query":"a"}\n{"call":"search","query":"b"}' }) },
    calls: { refreshCapabilities: async () => {}, getCapabilities: () => ({ comfy: { render: false } }), call: async () => { multiCallExecutions += 1; return { ok: true, data: {} }; } }
  });
  const multiCallResult = await multiCallRunner.run({ task: 'assistant', profile: 'assistant', input: {}, messages: [{ role: 'user', content: 'two calls' }], job: { signal: {} } });
  if (multiCallExecutions || multiCallResult.ok !== false || multiCallResult.code !== 'CALL_LIMIT') throw new Error('Multiple compact calls were executed in one round');
  let missingTurns = 0;
  const missingRunner = modules.createAiRunner({ ai: { complete: async () => { missingTurns += 1; return { ok: true, text: 'should not run' }; } }, calls: { refreshCapabilities: async () => {}, getCapabilities: () => ({ comfy: { render: false } }), call: async () => ({ ok: true, data: {} }) }, compact: true });
  const missingResult = await missingRunner.run({ task: 'assistant', profile: 'assistant', input: { sessionId: 'task6-session', text: '请看图99', imageRepository: { listConversation: () => ({ items: [{ sessionId: 'task6-session', refId: 'a', imageId: 'a', slotNo: 1, displayTitle: 'Same' }] }) } }, messages: [{ role: 'user', content: '请看图99' }], job: { signal: {} } });
  if (missingTurns !== 0 || missingResult.ok !== false || missingResult.status !== 'image_reference') throw new Error('Missing natural-language image reference did not pause before AI');

  const cancelled = new AbortController();
  cancelled.abort();
  let cancelledAiCalls = 0;
  const cancelledRunner = modules.createAiRunner({ ai: { complete: async () => { cancelledAiCalls += 1; return { ok: true, text: 'late' }; } }, calls: { call: async () => ({ ok: true, data: {} }) }, compact: true });
  const cancelledResult = await cancelledRunner.run({ task: 'assistant', profile: 'assistant', input: {}, messages: [{ role: 'user', content: 'stop' }], job: { signal: cancelled.signal } });
  if (cancelledAiCalls || cancelledResult.status !== 'cancelled') throw new Error('Cancelled compact job still reached AI');

  // Main Assistant must materialise only pending conversation references on the
  // first request, then keep follow-up context text-only.
  const assistantStorage = modules.createStorage({ prefix: 'check-task6-assistant' });
  const assistantImages = modules.createImages({ storage: assistantStorage });
  const pendingAsset = assistantImages.add({ id: 'task6-pending-image', filename: 'pending.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload' });
  let assistantRequestTurn = 0;
  const assistantRequests = [];
  let assistantSearchCalls = 0;
  let assistantSearchOptions = null;
  const compactAssistant = modules.createAssistant({
    images: assistantImages,
    tags: { search: (_query, options) => { assistantSearchCalls += 1; assistantSearchOptions = options; return [{ en: 'blue hair' }]; } },
    ai: { async complete(messages, options) { assistantRequests.push({ messages, options }); assistantRequestTurn += 1; return assistantRequestTurn === 1 ? { ok: true, text: '{"call":"search","query":"blue hair"}' } : { ok: true, text: 'pending image handled' }; } },
    storage: assistantStorage
  });
  compactAssistant.setSettings({ precision: 'exact', includeAdult: true, category: 'hair' });
  const pendingSession = compactAssistant.currentSession();
  const pendingRef = compactAssistant.imageRepository.attachToConversation(pendingSession.id, pendingAsset.id, { source: 'upload', pending: true });
  const pendingResult = await compactAssistant.run({ mode: 'assistant', text: '请处理待发送图片', primaryVision: true });
  const firstRequestJson = JSON.stringify(assistantRequests[0]?.messages || []);
  const secondRequestJson = JSON.stringify(assistantRequests[1]?.messages || []);
  if (!pendingResult.ok || assistantSearchCalls !== 1 || assistantSearchOptions?.precision !== 'exact' || assistantSearchOptions?.includeAdult !== true || assistantSearchOptions?.category !== 'hair' || !firstRequestJson.includes('image_url') || secondRequestJson.includes('image_url') || assistantRequests.some(item => Object.prototype.hasOwnProperty.call(item.options || {}, 'tools') || Object.prototype.hasOwnProperty.call(item.options || {}, 'tool_choice'))) throw new Error('Assistant compact pending-image follow-up contract failed');
  if (compactAssistant.imageRepository.listConversation(pendingSession.id).pendingIds.includes(pendingRef.refId)) throw new Error('Successful compact send did not consume pending reference');

  let pendingOnlyTurns = 0;
  const pendingOnlyStorage = modules.createStorage({ prefix: 'check-task6-pending-only' });
  const pendingOnlyImages = modules.createImages({ storage: pendingOnlyStorage });
  const pendingOnlyAsset = pendingOnlyImages.add({ id: 'task6-pending-only-image', filename: 'only.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload' });
  const pendingOnlyAssistant = modules.createAssistant({ images: pendingOnlyImages, ai: { async complete() { pendingOnlyTurns += 1; return { ok: true, text: 'image-only complete' }; } }, storage: pendingOnlyStorage });
  const pendingOnlySession = pendingOnlyAssistant.currentSession();
  pendingOnlyAssistant.imageRepository.attachToConversation(pendingOnlySession.id, pendingOnlyAsset.id, { source: 'upload', pending: true });
  const pendingOnlyResult = await pendingOnlyAssistant.run({ mode: 'assistant', text: '', primaryVision: true });
  if (!pendingOnlyResult.ok || pendingOnlyTurns !== 1) throw new Error('Pending-only Assistant input was rejected as empty');

  const titleStorage = modules.createStorage({ prefix: 'check-task6-title' });
  const titleImages = modules.createImages({ storage: titleStorage });
  const titleAsset = titleImages.add({ id: 'task6-title-image', filename: 'title.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload', displayName: 'Gallery name' });
  let titleTurn = 0;
  const titleAssistant = modules.createAssistant({
    images: titleImages,
    ai: { async complete() { titleTurn += 1; return titleTurn === 1 ? { ok: true, text: '{"call":"title","image":"图1","text":"会话临时标题"}' } : { ok: true, text: '标题完成' }; } },
    storage: titleStorage
  });
  const titleSession = titleAssistant.currentSession();
  const titleRef = titleAssistant.imageRepository.attachToConversation(titleSession.id, titleAsset.id, { source: 'upload' });
  titleAssistant.imageRepository.addToGallery(titleAsset.id);
  const titleResult = await titleAssistant.run({ mode: 'assistant', text: '请给图片命名', primaryVision: true });
  const titled = titleAssistant.imageRepository.listConversation(titleSession.id).items.find(item => item.refId === titleRef.refId);
  if (!titleResult.ok || titled?.displayTitle !== '会话临时标题' || titleAssistant.imageRepository.listGallery().items.find(item => item.imageId === titleAsset.id)?.displayName === '会话临时标题') throw new Error('Compact title did not stay session-scoped');

  let nonVisionVisionCalls = 0;
  let nonVisionTurns = 0;
  const nonVisionMessages = [];
  const nonVisionStorage = modules.createStorage({ prefix: 'check-task6-nonvision' });
  const nonVisionImages = modules.createImages({ storage: nonVisionStorage });
  const baseAsset = nonVisionImages.add({ id: 'task6-base-image', filename: 'base.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload' });
  const nonVisionAssistant = modules.createAssistant({
    images: nonVisionImages,
    visionApi: { base: 'http://vision.local/v1', model: 'vision-model', inheritPrimary: false },
    visionGateway: { async complete() { nonVisionVisionCalls += 1; return { ok: true, text: 'base image summary' }; } },
    ai: { async complete(messages) { nonVisionMessages.push(messages); nonVisionTurns += 1; return nonVisionTurns === 1 ? { ok: true, text: '{"call":"render","prompt":"1girl"}' } : { ok: true, text: 'rendered' }; } },
    comfy: { workflow: '{"1":{"class_type":"SaveImage","inputs":{}}}', workflowStatus: () => ({ ready: true }), check: async () => true, setBase: () => {}, setWorkflow: () => {}, render: async () => ({ id: 'task6-nonvision-output', filename: 'out.png', dataUrl: 'data:image/png;base64,AA==' }) },
    storage: nonVisionStorage
  });
  nonVisionAssistant.setSettings({ comfyOn: true, comfyWorkflow: '{"1":{"class_type":"SaveImage","inputs":{}}}' });
  const nonVisionSession = nonVisionAssistant.currentSession();
  nonVisionAssistant.imageRepository.attachToConversation(nonVisionSession.id, baseAsset.id, { source: 'upload', pending: true });
  let nonVisionAttachCalls = 0;
  const nonVisionAttach = nonVisionAssistant.imageRepository.attachToConversation.bind(nonVisionAssistant.imageRepository);
  nonVisionAssistant.imageRepository.attachToConversation = (...args) => { nonVisionAttachCalls += 1; return nonVisionAttach(...args); };
  const nonVisionResult = await nonVisionAssistant.run({ mode: 'draw', task: 'comfy', text: '基于这张图出图', primaryVision: false, maxIterations: 1 });
  if (!nonVisionResult.ok || nonVisionVisionCalls !== 2 || nonVisionAttachCalls !== 1 || nonVisionMessages.some(message => JSON.stringify(message).includes('image_url'))) throw new Error('Compact non-vision primary flow did not inject Vision text safely');
  const persistedCompactSession = nonVisionAssistant.currentSession();
  const compactCallLeak = persistedCompactSession.messages.some(message => [message.text, message.reasoning, ...(message.activity || []).map(item => item.message)].some(value => String(value || '').includes('{"call"')));
  if (/data:image|C:\\private|"secret"/.test(JSON.stringify(persistedCompactSession)) || compactCallLeak) throw new Error('Compact session persistence leaked image bytes/path/workflow');

  let staleCurrent = true;
  let staleResolve;
  let staleAttached = 0;
  let staleCallStarted = false;
  const staleRunner = modules.createAiRunner({
    ai: { complete: async () => ({ ok: true, text: '{"call":"render","prompt":"late"}' }) },
    calls: { refreshCapabilities: async () => {}, getCapabilities: () => ({ comfy: { render: true } }), openAiToolsAvailable: async () => [], openAiTools: () => [], resolve: name => ({ name }), has: () => true, call: async () => { staleCallStarted = true; return new Promise(resolve => { staleResolve = resolve; }); } },
    compact: true
  });
  const stalePromise = staleRunner.run({ task: 'comfy', profile: 'draw', input: { sessionId: 'stale-session', allowRender: true, confirmRender: true, primaryVision: true, maxIterations: 1, isCurrent: () => staleCurrent, imageRepository: { listConversation: () => ({ items: [] }), attachToConversation: () => { staleAttached += 1; } } }, messages: [{ role: 'user', content: 'late' }], job: { signal: {} } });
  for (let wait = 0; wait < 20 && !staleCallStarted; wait += 1) await new Promise(resolve => setTimeout(resolve, 5));
  staleCurrent = false;
  staleResolve?.({ ok: true, data: { artifact: { id: 'stale-image', filename: 'stale.png' } } });
  const staleResult = await stalePromise;
  if (staleAttached || staleResult.status !== 'stale') throw new Error('Late Comfy result crossed request identity boundary');

  // Vision calls are cached by image/mode/instruction and render limits are
  // enforced before invoking Comfy again.
  let cachedVisionCalls = 0;
  let cachedTurns = 0;
  const cachedRunner = modules.createAiRunner({
    ai: { complete: async () => { cachedTurns += 1; if (cachedTurns < 3) return { ok: true, text: '{"call":"vision","image":"img-cache"}' }; return { ok: true, text: 'cached' }; } },
    calls: { refreshCapabilities: async () => {}, getCapabilities: () => ({ comfy: { render: false } }), openAiToolsAvailable: async () => [], openAiTools: () => [], resolve: name => ({ name }), has: () => true, call: async () => { cachedVisionCalls += 1; return { ok: true, data: { text: 'cached vision' } }; } },
    compact: true
  });
  const cachedResult = await cachedRunner.run({ task: 'assistant', profile: 'assistant', input: { sessionId: 'cache-session', imageRepository: { listConversation: () => ({ items: [{ sessionId: 'cache-session', refId: 'cache-ref', imageId: 'img-cache', slotNo: 1, displayTitle: 'Cache' }] }) } }, messages: [{ role: 'user', content: 'cache' }], job: { signal: {} } });
  if (!cachedResult.ok || cachedVisionCalls !== 1) throw new Error('Compact Vision result cache missed');
  let malformedRunnerCalls = 0;
  const malformedRunner = modules.createAiRunner({
    ai: { complete: async () => { malformedRunnerCalls += 1; return { ok: true, text: '```json\n{"call":"vision","image":\n```' }; } },
    calls: { refreshCapabilities: async () => {}, getCapabilities: () => ({ comfy: { render: false } }), call: async () => ({ ok: true, data: {} }) },
    compact: true
  });
  const malformedRunnerResult = await malformedRunner.run({ task: 'assistant', profile: 'assistant', input: { sessionId: 'malformed-session' }, messages: [{ role: 'user', content: 'bad protocol' }], job: { signal: {} } });
  if (malformedRunnerResult.ok || malformedRunnerResult.status !== 'call_protocol' || malformedRunnerResult.code !== 'CALL_PROTOCOL' || malformedRunnerCalls !== 1 || /```|\"call\"/.test(malformedRunnerResult.text || '')) throw new Error('Runner 吞掉 malformed compact JSON');
  let liveSearchArgs = null;
  let liveSearchTurns = 0;
  const liveSearchRunner = modules.createAiRunner({
    ai: { complete: async () => { liveSearchTurns += 1; return liveSearchTurns === 1 ? { ok: true, text: '{"call":"search","query":"blue"}' } : { ok: true, text: 'search done' }; } },
    calls: { refreshCapabilities: async () => {}, getCapabilities: () => ({ comfy: { render: false } }), call: async (_name, args) => { liveSearchArgs = args; return { ok: true, data: { items: [] } }; } },
    compact: true
  });
  const liveSearchResult = await liveSearchRunner.run({ task: 'assistant', profile: 'assistant', input: { sessionId: 'live-search-session', nsfwEnabled: true, searchPrecision: 'exact', currentCategory: 'character_names' }, messages: [{ role: 'user', content: 'search' }], job: { signal: {} } });
  if (!liveSearchResult.ok || liveSearchArgs?.includeAdult !== true || liveSearchArgs?.precision !== 'exact' || liveSearchArgs?.category !== 'character_names') throw new Error('Compact search 未使用页面实时成人开关/精度/分类');
  let cacheModel = 'model-a';
  let cachePromptVersion = 'prompt-a';
  let cacheCalls = 0;
  const cacheRows = { listConversation: () => ({ items: [{ sessionId: 'cache-key-session', refId: 'cache-key-ref', imageId: 'cache-key-image', slotNo: 1, displayTitle: 'Cache key', updatedAt: cachePromptVersion }] }) };
  const makeKeyRunner = () => {
    let turns = 0;
    return modules.createAiRunner({
      getSettings: () => ({ model: cacheModel, visionPromptVersion: cachePromptVersion }),
      ai: { complete: async () => { turns += 1; return turns === 1 ? { ok: true, text: '{"call":"vision","image":"图1"}' } : { ok: true, text: 'done' }; } },
      calls: { refreshCapabilities: async () => {}, getCapabilities: () => ({ comfy: { render: false } }), call: async () => { cacheCalls += 1; return { ok: true, data: { text: 'model result' } }; } },
      compact: true
    });
  };
  const sharedCache = new Map();
  const keyInput = { sessionId: 'cache-key-session', imageRepository: cacheRows };
  const keyRunnerA = makeKeyRunner();
  await keyRunnerA.run({ task: 'assistant', profile: 'assistant', input: keyInput, messages: [{ role: 'user', content: 'cache key' }], job: { signal: {} } });
  const keyRunnerB = makeKeyRunner();
  // Inject the same cache through each runner's input to model the shared
  // Assistant cache while changing model/prompt identity between requests.
  keyInput.callCache = sharedCache;
  keyInput.visionCache = sharedCache;
  await keyRunnerB.run({ task: 'assistant', profile: 'assistant', input: { ...keyInput, settings: { model: 'model-a', visionPromptVersion: 'prompt-a' } }, messages: [{ role: 'user', content: 'cache key' }], job: { signal: {} } });
  cacheModel = 'model-b'; cachePromptVersion = 'prompt-b';
  const keyRunnerC = makeKeyRunner();
  await keyRunnerC.run({ task: 'assistant', profile: 'assistant', input: { ...keyInput, settings: { model: 'model-b', visionPromptVersion: 'prompt-b' } }, messages: [{ role: 'user', content: 'cache key' }], job: { signal: {} } });
  if (cacheCalls < 3) throw new Error('Vision cache key 未隔离模型或提示词版本');
  let tempVisionArgs = null;
  let tempVisionTurns = 0;
  const tempRunner = modules.createAiRunner({
    ai: { complete: async () => { tempVisionTurns += 1; return tempVisionTurns === 1 ? { ok: true, text: '{"call":"vision","image":"临时图"}' } : { ok: true, text: 'temp done' }; } },
    calls: { refreshCapabilities: async () => {}, getCapabilities: () => ({ comfy: { render: false } }), call: async (_name, args) => { tempVisionArgs = args; return { ok: true, data: { text: 'temp summary' } }; } },
    compact: true
  });
  const tempResult = await tempRunner.run({ task: 'assistant', profile: 'assistant', input: { sessionId: 'temp-session', visionTempStore: { current: () => ({ kind: 'external-temp', tempId: 'temp-6', filename: 'temp.png' }), resolveForVision: () => ({}) } }, messages: [{ role: 'user', content: 'read temp' }], job: { signal: {} } });
  if (!tempResult.ok || tempVisionArgs?.tempId !== 'temp-6' || tempVisionArgs?.imageId) throw new Error('Compact Vision temp reference did not stay tempId-scoped');

  let cachedSearchCalls = 0;
  let cachedSearchTurns = 0;
  const searchCacheRunner = modules.createAiRunner({
    ai: { complete: async () => { cachedSearchTurns += 1; if (cachedSearchTurns < 3) return { ok: true, text: '{"call":"search","query":"blue"}' }; return { ok: true, text: 'search cached' }; } },
    calls: { refreshCapabilities: async () => {}, getCapabilities: () => ({ comfy: { render: false } }), openAiToolsAvailable: async () => [], openAiTools: () => [], resolve: name => ({ name }), has: () => true, call: async () => { cachedSearchCalls += 1; return { ok: true, data: { items: [{ en: 'blue' }] } }; } },
    compact: true
  });
  const searchCacheResult = await searchCacheRunner.run({ task: 'assistant', profile: 'assistant', input: {}, messages: [{ role: 'user', content: 'search cache' }], job: { signal: {} } });
  if (!searchCacheResult.ok || cachedSearchCalls !== 1) throw new Error('Compact search result cache missed');

  let optionalRetryTurns = 0;
  const optionalRetryOptions = [];
  const optionalRetryRunner = modules.createAiRunner({
    ai: { complete: async (_messages, options) => { optionalRetryTurns += 1; optionalRetryOptions.push(options); return optionalRetryTurns === 1 ? { ok: false, error: 'HTTP 400 unknown parameter thinking' } : { ok: true, text: 'retry ok' }; } },
    calls: { refreshCapabilities: async () => {}, getCapabilities: () => ({ comfy: { render: false } }), call: async () => ({ ok: true, data: {} }) },
    compact: true
  });
  const optionalRetryResult = await optionalRetryRunner.run({ task: 'assistant', profile: 'assistant', input: {}, config: { reasoning_effort: 'high', enable_thinking: true, thinking: { type: 'enabled' } }, messages: [{ role: 'user', content: 'retry' }], job: { signal: {} } });
  if (!optionalRetryResult.ok || optionalRetryTurns !== 2 || Object.prototype.hasOwnProperty.call(optionalRetryOptions[1] || {}, 'reasoning_effort') || Object.prototype.hasOwnProperty.call(optionalRetryOptions[1] || {}, 'thinking')) throw new Error('Compact optional-field retry did not run once safely');

  let limitedRenderCalls = 0;
  let limitedTurns = 0;
  const limitedRunner = modules.createAiRunner({
    ai: { complete: async () => { limitedTurns += 1; return { ok: true, text: '{"call":"render","prompt":"one"}' }; } },
    calls: { refreshCapabilities: async () => {}, getCapabilities: () => ({ comfy: { render: true } }), openAiToolsAvailable: async () => [], openAiTools: () => [], resolve: name => ({ name }), has: () => true, call: async () => { limitedRenderCalls += 1; return { ok: true, data: { artifact: { id: `limited-${limitedRenderCalls}`, filename: 'limited.png' } } }; } },
    compact: true
  });
  const limitedResult = await limitedRunner.run({ task: 'comfy', profile: 'draw', input: { sessionId: 'limited-session', allowRender: true, confirmRender: true, primaryVision: true, maxIterations: 1 }, messages: [{ role: 'user', content: 'limit' }], job: { signal: {} } });
  if (limitedRenderCalls !== 1 || limitedTurns > 3 || !['tool_limit', 'confirmation_required'].includes(limitedResult.status) && limitedResult.ok) throw new Error('Compact render iteration limit was bypassed');

  let lateResolve;
  let lateSignal = null;
  const switchingAssistant = modules.createAssistant({
    ai: { complete: (_messages, options) => { lateSignal = options?.signal; return new Promise(resolve => { lateResolve = resolve; }); } },
    storage: modules.createStorage({ prefix: 'check-task6-switch' })
  });
  const oldSession = switchingAssistant.currentSession();
  const running = switchingAssistant.run({ mode: 'assistant', text: 'late response' });
  for (let wait = 0; wait < 20 && !lateSignal; wait += 1) await new Promise(resolve => setTimeout(resolve, 5));
  const newSession = switchingAssistant.newSession('new session');
  if (!newSession?.id || newSession.id === oldSession.id || !lateSignal?.aborted) throw new Error('Session switch did not cancel active compact request');
  lateResolve?.({ ok: true, text: 'late result must be discarded' });
  const switchedResult = await running;
  if (!['cancelled', 'stale'].includes(switchedResult.status) || switchingAssistant.currentSession().messages.some(message => /late result/.test(message.text || ''))) throw new Error('Late compact result updated the new session');
}
await runTask6CompactRunnerTests();

let leakedWorkflowImage = false;
const imageGuardAssistant = modules.createAssistant({
  ai: { async complete(messages) { leakedWorkflowImage = Array.isArray(messages.at(-1)?.content); return { ok: true, text: 'ok' }; } },
  images: { get: id => ({ id, source: 'workflow', dataUrl: 'data:image/png;base64,AA==' }) },
  storage: { get: () => [], set: () => {} }
});
await imageGuardAssistant.run({ mode: 'assistant', text: '不要带入工作流图', imageIds: ['workflow'] });
if (leakedWorkflowImage) throw new Error('工作流图片进入用户消息');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'agent-tools', 'tools.manifest.json'), 'utf8'));
if (!Array.isArray(manifest.tools) || !manifest.tools.some(item => item.name === 'comfy.render')) throw new Error('Agent 工具清单缺失');
if (!manifest.tools.some(item => item.name === 'settings.comfy.get' && item.group === 'runtime')
  || !manifest.tools.some(item => item.name === 'settings.comfy.update' && item.group === 'admin')) throw new Error('Agent Runtime/Admin 清单分组缺失');
const comfyPromptSource = fs.readFileSync(path.join(root, 'assets', '提示词素材', '05-ComfyUI提示词协议.txt'), 'utf8');
if (/vision\.aiDescribe|<<COMFY>>|\bRENDER\s*:/i.test(comfyPromptSource)) throw new Error('Comfy 提示词素材仍包含旧协议');

async function runGalleryContractTests() {
  const storage = modules.createStorage({ prefix: 'check-gallery-contract' });
  const images = modules.createImages({ storage });
  images.add({ id: 'gallery-old', filename: 'old.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload', displayName: 'Old' });
  images.add({ id: 'gallery-new', filename: 'new.png', dataUrl: 'data:image/png;base64,AA==', source: 'file', displayName: 'New' });
  const sessions = [{ id: 'gallery-session', messages: [] }];
  const repository = modules.createImageRepository({ storage, images, sessions: () => sessions });
  repository.addToGallery('gallery-old');
  repository.addToGallery('gallery-new');
  const oldest = repository.listGallery({ order: 'oldest' }).items.map(item => item.imageId);
  const newest = repository.listGallery({ order: 'newest' }).items.map(item => item.imageId);
  if (oldest.join(',') !== 'gallery-old,gallery-new' || newest.join(',') !== 'gallery-new,gallery-old') throw new Error('图库排序契约失败');
  const renamed = repository.renameGalleryImage('gallery-old', 'Renamed');
  if (renamed?.imageId !== 'gallery-old' || repository.listGallery().items.find(item => item.imageId === 'gallery-old')?.displayName !== 'Renamed') throw new Error('图库重命名改变稳定 ID');
  if (repository.listGallery({ selectedIds: ['gallery-new'] }).items.map(item => item.imageId).join(',') !== 'gallery-new') throw new Error('图库选择过滤契约失败');
  const visionStore = modules.createVisionTempStore({ images });
  const libraryRef = visionStore.setLibraryReference('gallery-old');
  if (libraryRef?.kind !== 'library' || libraryRef.imageId !== 'gallery-old' || visionStore.current()?.imageId !== 'gallery-old') throw new Error('图库引用未接入 Vision 临时存储');
  const shared = repository.attachToConversation('gallery-session', 'gallery-old', { source: 'gallery' });
  const removed = repository.removeFromGallery('gallery-old');
  if (!removed.removed || !removed.imageStillReferenced || !images.get('gallery-old') || repository.referenceCount('gallery-old').total !== 1) throw new Error('图库删除绕过引用计数');
  repository.addToGallery('gallery-old');
  const manifest = await repository.exportGalleryManifest?.();
  if (!manifest || !Array.isArray(manifest.items) || !manifest.items.some(item => item.imageId === 'gallery-old') || !manifest.files) throw new Error('图库导出清单契约缺失');
  if (!('displayOrder' in manifest.items[0]) || !('galleryCreatedAt' in manifest.items[0]) || !('pinned' in manifest.items[0])) throw new Error('图库关联元数据未导出');
  const imported = repository.importGalleryManifest?.({ ...manifest, items: [manifest.items.find(item => item.imageId === 'gallery-old')] });
  if (!imported?.mapping?.['gallery-old'] || imported.mapping['gallery-old'] === 'gallery-old' || !imported.imported.length) throw new Error('图库导入冲突映射契约缺失');
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'src', 'app-view.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  if (!html.includes('id="galleryBtn"') || !html.includes('id="galleryView"') || !html.includes('data-nav-tone="gallery"')) throw new Error('图库路由导航模板缺失');
  if (!view.includes('syncNavAction("gallery", ui.route === "gallery")') || !view.includes('listGallery')) throw new Error('图库视图路由契约缺失');
  if (!view.includes('referenceCount') || !view.includes('removeOnly') || !view.includes('chooseGallerySession')) throw new Error('图库删除影响确认或目标会话契约缺失');
  if (!view.includes('aiTabBeforeGallery')) throw new Error('图库路由未保持 AI 子页签');
  if (!fs.readFileSync(path.join(root, 'src', 'app.css'), 'utf8').includes('data-nav-tone="gallery"')) throw new Error('图库导航颜色令牌缺失');
  const blobImages = { get: id => id === 'blob-image' ? { id, filename: 'blob.png' } : null, getBytes: () => null, getBlob: async () => new Blob([Uint8Array.from([7, 8, 9])], { type: 'image/png' }) };
  const blobRepo = modules.createImageRepository({ images: blobImages, storage: modules.createStorage({ prefix: 'check-gallery-blob' }), sessions: () => [] });
  const blobBytes = await blobRepo.getOriginalBytes('blob-image');
  if (!blobBytes || !Buffer.from(blobBytes).equals(Buffer.from([7, 8, 9]))) throw new Error('图库原图读取未从 getBytes 回退 getBlob');
  blobRepo.addToGallery('blob-image');
  const blobBundle = await blobRepo.exportGalleryManifest();
  if (!blobBundle.files?.['blob-image.bin'] || blobBundle.items[0]?.dataUrl) throw new Error('图库 blob 导出没有携带原始字节包');
  const roundtripImages = modules.createImages({ storage: modules.createStorage({ prefix: 'check-gallery-blob-import' }) });
  const roundtripRepo = modules.createImageRepository({ images: roundtripImages, storage: modules.createStorage({ prefix: 'check-gallery-blob-import-repo' }), sessions: () => [] });
  const roundtrip = roundtripRepo.importGalleryManifest(blobBundle);
  const roundtripBytes = await roundtripRepo.getOriginalBytes(roundtrip.mapping['blob-image']);
  if (!roundtrip.imported.length || !roundtripBytes || !Buffer.from(roundtripBytes).equals(Buffer.from([7, 8, 9]))) throw new Error('图库 blob 导出导入字节回环失败');
  const missing = repository.importGalleryManifest({ items: [{ imageId: 'missing-data', filename: 'missing.png' }] });
  if (!missing.failed?.length || images.get('missing-data')) throw new Error('图库导入静默创建空图片');
}
await runGalleryContractTests();

async function runConversationRepositoryContractTests() {
  const storage = modules.createStorage({ prefix: 'check-conversation-repository-contract' });
  const images = modules.createImages({ storage });
  images.add({ id: 'conversation-upload', filename: 'upload.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload' });
  images.add({ id: 'conversation-gallery', filename: 'gallery.png', dataUrl: 'data:image/png;base64,AA==', source: 'upload' });
  const sessions = [{ id: 'conversation-session', title: '测试对话', messages: [] }];
  const repository = modules.createImageRepository({ storage, images, sessions: () => sessions, saveSessions: () => {} });
  repository.addToGallery('conversation-gallery');
  const first = repository.attachToConversation('conversation-session', 'conversation-upload', { source: 'upload', pending: true });
  repository.attachToConversation('conversation-session', 'conversation-gallery', { source: 'gallery' });
  sessions[0].messages.push({ id: 'old-message', imageIds: ['conversation-upload'] });
  const second = repository.attachToConversation('conversation-session', 'conversation-upload', { source: 'upload' });
  if (!first || first.slotNo !== 1 || second.refId !== first.refId) throw new Error('对话图片引用没有稳定 slotNo/refId');
  if (typeof repository.pendingConversationReferences !== 'function' || typeof repository.markSent !== 'function') throw new Error('对话仓库缺少 pending 发送适配接口');
  if (repository.pendingConversationReferences('conversation-session').map(item => item.refId).join(',') !== first.refId) throw new Error('pending 引用清单错误');
  repository.markSent('conversation-session', [first.refId]);
  if (repository.listConversation('conversation-session').pendingIds.length || !repository.listConversation('conversation-session').items.find(item => item.refId === first.refId)?.sent) throw new Error('发送成功没有只重置 pending 并保留引用');
  repository.setPending('conversation-session', first.refId, true);
  const cleared = repository.clearSessionContent('conversation-session');
  if (cleared.retainedImages !== 2 || cleared.resetPending !== 1 || repository.listConversation('conversation-session').pendingIds.length || repository.listConversation('conversation-session').items.length !== 2) throw new Error('清空对话错误删除图片或未重置 pending');
  const retained = repository.deleteSession('conversation-session', { retainImages: true });
  if (!retained.promotedImages || repository.listGallery().items.map(item => item.imageId).sort().join(',') !== 'conversation-gallery,conversation-upload') throw new Error('删除对话保留图片没有转入图库');
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'src', 'app-view.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'app.css'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  if (!html.includes('id="talkImageRepository"') || !html.includes('id="talkPendingStrip"') || !html.includes('ai-sidebar-grid')) throw new Error('AI 左侧图片仓库 DOM 挂载点缺失');
  if (!view.includes('function addConversationImages') || !view.includes('pendingConversationReferences') || !view.includes('markSent') || view.includes('bucket("talk").clear')) throw new Error('对话图片统一入口或发送 pending 语义缺失');
  if (!view.includes('data-image-context') || !view.includes('setConversationReference')) throw new Error('图库/对话拖拽上下文没有接入 Vision 临时引用');
  if (!css.includes('body.aiview #sidebar') || !css.includes('#talkImageRepository') || !css.includes('#talkPendingStrip')) throw new Error('AI 双栏仓库/待发送条带样式缺失');
  if (!view.includes('function conversationDeleteImpact') || !view.includes('retainImages')) throw new Error('管理器删除未复用影响统计与保留确认');
  if (/const attached = imageRepository\?\.attachToConversation\?\.\([^\n]+pending:\s*true/.test(view)) throw new Error('内部图片拖拽错误设置 pending');
  if (!css.includes('body.aiview .wrap') || !css.includes('@media(max-width:900px)')) throw new Error('861-900px AI 布局没有堆叠约束');
  if (!view.includes('tabIndex = 0') || !view.includes('aria-pressed') || !view.includes('event.key === "Enter"')) throw new Error('对话图片卡片缺少键盘无障碍交互');
  if (!/mgrClear[\s\S]{0,900}renderConversationRepository\(\)/.test(view)) throw new Error('管理器清空没有立即刷新图片仓库');
  if (html.includes('data-image-collection="talk"') || view.includes('function bucket(') || view.includes('function renderImages(')) throw new Error('旧 talk collection 渲染路径仍在活动代码');
  if (!html.includes('ui.ai.conversationImages') || !view.includes('ui.ai.pendingImages') || !html.includes('ui.ai.clearPending')) throw new Error('对话图片仓库未使用本地化文案键');
  if (!/ui\.locale = id;[\s\S]{0,500}renderConversationRepository\(\)/.test(view)) throw new Error('切换语言没有立即刷新对话图片仓库');
  if (!view.includes('ui.ai.repositoryEmpty') || !view.includes('ui.ai.removeConversationImage') || !view.includes('ui.ai.imageSlot') || !view.includes('ui.ai.removePendingImage')) throw new Error('仓库动态文案仍缺少本地化键');
  if (html.includes('data-image-collection="talk"')) throw new Error('活动 AI DOM 仍保留 talk collection 标记');
  if (!preload.includes('setConversationTitle') || !preload.includes('pendingConversationReferences') || !preload.includes('markSent')) throw new Error('Compact 会话图片适配器未通过 preload 暴露');
  if (!preload.includes('currentSessionId') || !preload.includes('callForRenderer') || !preload.includes('runForRenderer') || !preload.includes('resolveTempForRenderer')) throw new Error('preload Vision/call 入口未绑定当前会话授权边界');
if (/images\s*,\s*\n\s*imageStore: images/.test(preload) || !preload.includes('safeImageStore') || preload.includes('imageStore: images')) throw new Error('preload 仍直接暴露原始 Images/path 入口');
if (preload.includes('exportGalleryManifest') || preload.includes('importGalleryManifest')) throw new Error('图库导入导出仍通过 preload 暴露');
  if (!/function safeImageRemove[\s\S]{0,700}referenceCount/.test(preload) || !/function safeImageRemove[\s\S]{0,1000}invalidateReference/.test(preload)) throw new Error('preload 物理删除未经过引用计数或 Vision 槽失效');
  let slotStore = null;
  const slotRepo = modules.createImageRepository({
    storage: modules.createStorage({ prefix: 'check-vision-slot-repo' }),
    images,
    sessions: () => [{ id: 'slot-session', messages: [] }],
    onReferenceRemoved: reference => slotStore?.invalidateReference?.(reference)
  });
  slotStore = modules.createVisionTempStore({
    images,
    imageRepository: slotRepo,
    authorizeReference: reference => slotRepo.authorizeVisionReference(reference)
  });
  slotRepo.addToGallery('conversation-gallery');
  const slotRef = slotRepo.attachToConversation('slot-session', 'conversation-gallery', { source: 'gallery' });
  slotStore.setConversationReference('conversation-gallery', { sessionId: 'slot-session', refId: slotRef.refId });
  slotRepo.removeFromConversation('slot-session', slotRef.refId);
  if (slotStore.current() !== null) throw new Error('删除会话图片后稳定 Vision 槽仍指向旧引用');
  const reattached = slotRepo.attachToConversation('slot-session', 'conversation-gallery', { source: 'gallery' });
  if (!reattached || !slotRepo.listConversation('slot-session').items.some(item => item.imageId === 'conversation-gallery')) throw new Error('删除后的会话图片无法重新建立合法关联');
  const messageOnlyStorage = modules.createStorage({ prefix: 'check-message-only-retain' });
  const messageOnlyImages = modules.createImages({ storage: messageOnlyStorage });
  messageOnlyImages.add({ id: 'message-only-image', filename: 'message.png', bytes: Buffer.from([1, 2, 3]), mime: 'image/png', source: 'upload' });
  const messageOnlySessions = [{ id: 'message-only-session', messages: [{ id: 'message-only', imageIds: ['message-only-image'] }] }];
  const messageOnlyRepo = modules.createImageRepository({ storage: messageOnlyStorage, images: messageOnlyImages, sessions: () => messageOnlySessions });
  const messageOnlyDelete = messageOnlyRepo.deleteSession('message-only-session', { retainImages: true });
  if (!messageOnlyDelete.promotedImages || !messageOnlyRepo.listGallery().items.some(item => item.imageId === 'message-only-image')) throw new Error('仅消息 imageIds 的会话图片未在保留删除时提升到图库');
  const guardedStorage = modules.createStorage({ prefix: 'check-guarded-image-remove' });
  const guardedImages = modules.createImages({ storage: guardedStorage });
  guardedImages.add({ id: 'guarded-shared', filename: 'shared.png', bytes: Buffer.from([1]), mime: 'image/png', source: 'upload' });
  guardedImages.add({ id: 'guarded-orphan', filename: 'orphan.png', bytes: Buffer.from([2]), mime: 'image/png', source: 'upload' });
  const guardedSessions = [{ id: 'guarded-session', messages: [] }];
  const guardedRepo = modules.createImageRepository({ storage: guardedStorage, images: guardedImages, sessions: () => guardedSessions });
  guardedRepo.addToGallery('guarded-shared');
  guardedRepo.attachToConversation('guarded-session', 'guarded-shared', { source: 'gallery' });
  const sharedGuard = guardedRepo.removeIfOrphaned('guarded-shared');
  const orphanGuard = guardedRepo.removeIfOrphaned('guarded-orphan');
  if (sharedGuard.removed || guardedImages.get('guarded-shared') === null || !orphanGuard.removed || guardedImages.get('guarded-orphan')) throw new Error('图片物理删除没有遵守引用计数边界');
}
await runConversationRepositoryContractTests();

const duplicateSessionStorage = modules.createStorage({ prefix: 'check-duplicate-session-import' });
const duplicateSessionImages = modules.createImages({ storage: duplicateSessionStorage });
duplicateSessionImages.add({ id: 'duplicate-image-a', filename: 'a.png', bytes: Buffer.from([1]), mime: 'image/png', source: 'upload' });
duplicateSessionImages.add({ id: 'duplicate-image-b', filename: 'b.png', bytes: Buffer.from([2]), mime: 'image/png', source: 'upload' });
const duplicateSessionAssistant = modules.createAssistant({ images: duplicateSessionImages, storage: duplicateSessionStorage, ai: { complete: async () => ({ ok: true, text: 'ok' }) } });
duplicateSessionAssistant.importSessions([
  { id: 'same-session-id', title: '导入 A', messages: [{ id: 'same-message-a', role: 'user', imageIds: ['duplicate-image-a'] }] },
  { id: 'same-session-id', title: '导入 B', messages: [{ id: 'same-message-b', role: 'user', imageIds: ['duplicate-image-b'] }] }
], true);
const importedDuplicateSessions = duplicateSessionAssistant.sessions().filter(item => /^导入 /.test(item.title));
if (importedDuplicateSessions.length !== 2 || new Set(importedDuplicateSessions.map(item => item.id)).size !== 2) throw new Error('导入会话未重映射重复 session ID');
duplicateSessionAssistant.imageRepository.finalizeMigration();
const importedA = importedDuplicateSessions.find(item => item.title === '导入 A');
const importedB = importedDuplicateSessions.find(item => item.title === '导入 B');
if (!duplicateSessionAssistant.imageRepository.listConversation(importedA.id).items.some(item => item.imageId === 'duplicate-image-a') || !duplicateSessionAssistant.imageRepository.listConversation(importedB.id).items.some(item => item.imageId === 'duplicate-image-b')) throw new Error('重复 session ID 重映射后图片关系未同步');
duplicateSessionAssistant.deleteSession(importedA.id, { retainImages: false });
if (!duplicateSessionAssistant.imageRepository.listConversation(importedB.id).items.some(item => item.imageId === 'duplicate-image-b') || !duplicateSessionImages.get('duplicate-image-b')) throw new Error('删除一个重映射会话影响了另一个会话图片');

let agentSettings = {
  comfyOn: true, comfyW: 768, comfyH: 1024, comfySteps: 25, comfyCfg: 7,
  comfyNeg: '', comfyIters: 3, comfyWorkflow: '{}', key: 'CHECK_SECRET', visionKey: 'CHECK_VISION_SECRET'
};
let agentWrite = false;
const agentPrompts = modules.createPrompts({ dir: path.join(root, 'assets', '提示词素材') });
const groupedCalls = modules.createCalls({
  tags: { search: query => [{ en: query }] },
  prompts: agentPrompts,
  getSettings: () => agentSettings,
  setSettings: patch => { agentSettings = { ...agentSettings, ...patch }; return agentSettings; },
  comfy: {
    workflow: '{}', workflowStatus: () => ({ ready: true }), check: async () => true,
    render: async () => ({ filename: 'agent.png', dataUrl: 'data:image/png;base64,AA==' })
  }
});
const agentReadOnly = await groupedCalls.listAgent({ allowWrite: false });
if (!agentReadOnly.some(item => item.name === 'tags.search' && item.group === 'runtime')
  || !agentReadOnly.some(item => item.name === 'settings.comfy.get')
  || agentReadOnly.some(item => item.group === 'admin' || item.name === 'comfy.check' || item.name === 'prompts.compose')) {
  throw new Error('Agent 默认 Runtime 工具过滤失败');
}
const agentWritable = await groupedCalls.listAgent({ allowWrite: true });
if (!agentWritable.some(item => item.name === 'settings.comfy.update' && item.group === 'admin')
  || !agentWritable.some(item => item.name === 'prompts.reset' && item.group === 'admin')) throw new Error('Agent Admin 工具未在授权后出现');
const deniedAgentUpdate = await groupedCalls.call('settings.comfy.update', { width: 900 }, { caller: 'external-agent', allowWrite: false });
if (deniedAgentUpdate.ok || !['AGENT_TOOL_UNAVAILABLE', 'PERMISSION_DENIED'].includes(deniedAgentUpdate.code)) throw new Error('Agent 未授权写设置未被阻止');
const allowedAgentUpdate = await groupedCalls.call('settings.comfy.update', { width: 900 }, { caller: 'external-agent', allowWrite: true });
if (!allowedAgentUpdate.ok || agentSettings.comfyW !== 900 || /CHECK_(?:VISION_)?SECRET/.test(JSON.stringify(allowedAgentUpdate))) throw new Error('Agent 授权后设置更新或敏感字段过滤失败');
const builtinDefault = agentPrompts.getDefault('main');
const builtinUpdate = await groupedCalls.call('prompts.update', { id: 'main', text: 'temporary override' }, { caller: 'external-agent', allowWrite: true });
if (!builtinUpdate.ok || agentPrompts.getDefault('main') !== builtinDefault) throw new Error('内置提示词默认文本保护失败');
const builtinDelete = await groupedCalls.call('prompts.delete', { id: 'main' }, { caller: 'external-agent', allowWrite: true });
if (builtinDelete.ok || agentPrompts.get('main') !== 'temporary override') throw new Error('内置提示词删除保护失败');
const server = modules.createCallServer({ calls: groupedCalls, port: 0, getPermissions: () => ({ write: agentWrite }) });
await server.start();
const serverBase = `http://127.0.0.1:${server.status().port}`;
const readResponse = await fetch(`${serverBase}/tools/list`);
const readPayload = await readResponse.json();
if (!readPayload.ok || readPayload.permissions?.write !== false || readPayload.tools.some(item => item.group === 'admin')) throw new Error('Agent HTTP 默认工具列表权限失败');
agentWrite = true;
const writePayload = await (await fetch(`${serverBase}/tools/list`)).json();
if (!writePayload.tools.some(item => item.name === 'settings.comfy.update' && item.group === 'admin')) throw new Error('Agent HTTP 授权工具列表失败');
await server.stop();
console.log(`check ok: ${files.length} JS files, ${tags.size()} tags`);
