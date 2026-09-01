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
const comfySource = fs.readFileSync(path.join(root, 'src', 'modules', 'comfy.js'), 'utf8');
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
if (!indexSource.includes('id="tpVisionToggle"') || !/tp-headbar[\s\S]*id="tpVisionToggle"/.test(indexSource) || indexSource.includes('id="quickVisionBtn"') || indexSource.includes('id="tpExpand"')) throw new Error('识图侧栏统一开关控件未收敛');
if (!indexSource.includes('id="tagVisionSlot"') || (indexSource.match(/id="tagPane"/g) || []).length !== 1) throw new Error('主页面识图模块挂载点缺失或重复');
if (!appViewSource.includes('visionCollapsed') || !appViewSource.includes('setVisionCollapsed') || !/tpVisionToggle.*addEventListener/.test(appViewSource) || !appViewSource.includes('tagVisionSlot')) throw new Error('识图侧栏统一开关交互未接入');
if (!appCssSource.includes('.tkpane.is-collapsed{width:0') || !appCssSource.includes('.tp-vision-toggle') || !appCssSource.includes('.tp-vision-arrow')) throw new Error('识图侧栏折叠样式未释放主内容空间');
if (!/data-mode="assistant"/.test(indexSource) || !/data-mode="draw"/.test(indexSource) || /data-mode="(?:gen|rk|comfy)"/.test(indexSource)) throw new Error('用户可见 AI 模式未收敛为助手/绘图');
if (/(?:id="tabGen"|id="tabChat"|id="tabComfy"|id="genGo"|id="comfyGo"|id="chatSend")/.test(indexSource)) throw new Error('旧 AI 页面控件仍在 HTML');
if (/(?:runGenerate|runRecreate|runComfy|runChat|completeWithCallsLegacy|iterateWithComfy|visionCollection|analyzeMany)/.test(appViewSource + '\n' + fs.readFileSync(path.join(root, 'src', 'modules', 'assistant.js'), 'utf8'))) throw new Error('旧执行链路或多图 Vision 入口仍在正式代码');
const contextImages = modules.createImages();
const visionOnlyImage = contextImages.add({ id: 'check-vision-context', dataUrl: 'data:image/png;base64,AA==', source: 'vision' });
if (!visionOnlyImage || contextImages.collectionIds('talk').includes(visionOnlyImage.id)) throw new Error('Vision 图片错误加入对话集合');
const sources = modules.loadTagFiles({ assetDir: path.join(root, 'assets') });
const tags = modules.createTags({ sources });
if (tags.size() < 1) throw new Error('标签素材为空');
const prompts = modules.createPrompts({ dir: path.join(root, 'assets', '提示词素材') });
if (!prompts.get('main')) throw new Error('主提示词素材为空');
if (prompts.getEffective('vision') !== prompts.get('vision')) throw new Error('Prompts 有效 Vision 提示词接口失败');
const translation = modules.createTranslation({ tags });
const translated = translation.translateLocal('蓝发', 'zh-en');
if (!translated || translated.ok === false || !translated.text) throw new Error('翻译最小样例失败');
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
    complete: async (messages) => {
      aiVisionMessages = messages;
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
if (!aiVisionResult.ok || aiVisionResult.data?.text !== '1girl, outdoors' || !String(aiVisionMessages?.[0]?.content).includes('CHECK VISION PROMPT') || !String(aiVisionMessages?.[0]?.content).includes('重点分析姿势') || aiVisionMessages.length !== 2) {
  throw new Error('单图 Vision ai 模式或独立提示词失败');
}
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
  storage: { get: () => [], set: () => {} }
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
  storage: { get: () => [], set: () => {} }
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
  }
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
  }
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
if (!referenceResult.ok || !JSON.stringify(referenceMessages).includes('imageId: reference-image')) throw new Error('AI 图片引用未提供真实 imageId');
let unavailableRunnerTools = null;
const unavailableRunner = modules.createAssistant({
  ai: { async complete(_messages, options) { unavailableRunnerTools = options.tools || []; return { ok: true, text: '无 Comfy 工具' }; } },
  storage: { get: () => [], set: () => {} }
});
const unavailableRunnerResult = await unavailableRunner.run({ mode: 'draw', text: '只写提示词' });
if (!unavailableRunnerResult.ok || unavailableRunnerTools.some(item => item.function?.name === 'comfy_render')) throw new Error('Comfy 不可用时 Runner 仍暴露工具');
let comfyRunnerTools = [];
const comfyRunner = modules.createAssistant({
  ai: { async complete(_messages, options) { comfyRunnerTools = options.tools || []; return { ok: true, text: '绘图 Tag 已生成' }; } },
  comfy: { workflow: '{"1":{"class_type":"SaveImage","inputs":{}}}', workflowStatus: () => ({ ready: true }), check: async () => true, render: async () => ({ filename: 'runner.png', dataUrl: 'data:image/png;base64,AA==' }) },
  storage: { get: () => [], set: () => {} }
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
  storage: { get: () => [], set: () => {} }
});
const budgetResult = await runDrawContext(budgetAssistant, { text: '单轮预算测试' }, { maxIterations: 1, comfyWorkflow: '{"1":{"class_type":"SaveImage","inputs":{}}}' });
if (!budgetResult.ok || budgetResult.renderCount !== 1 || budgetResult.aiTurns !== 4 || comfyTurns !== 4) throw new Error('ComfyUI 迭代/对话预算混淆');
let fallbackTurns = 0;
const fallbackAssistant = modules.createAssistant({
  ai: { async complete() { fallbackTurns += 1; return fallbackTurns === 1 ? { ok: true, text: '我暂时无法发出工具调用' } : { ok: true, text: '仍然没有发出工具调用' }; } },
  comfy: { check: async () => true, setBase: () => {}, setWorkflow: () => {}, render: async () => ({ filename: 'fallback.png', dataUrl: 'data:image/png;base64,AA==' }) },
  storage: { get: () => [], set: () => {} }
});
const fallbackResult = await runDrawContext(fallbackAssistant, { text: '无工具调用测试' }, { maxIterations: 1, maxToolRounds: 3, comfyWorkflow: '{"1":{"class_type":"SaveImage","inputs":{}}}' });
if (fallbackResult.ok || fallbackResult.status !== 'tool_required' || fallbackTurns !== 2) throw new Error('无原生工具调用未返回明确错误');
let reasoningRenderTurns = 0;
let reasoningRenderCount = 0;
const reasoningRenderAssistant = modules.createAssistant({
  ai: { async complete() { reasoningRenderTurns += 1; return reasoningRenderTurns === 1 ? { ok: true, text: '', reasoning: 'I will render an image with prompt: 1girl, blue hair' } : { ok: true, text: '思考内容触发渲染' }; } },
  comfy: { check: async () => true, setBase: () => {}, setWorkflow: () => {}, render: async () => { reasoningRenderCount += 1; return { filename: 'reasoning.png', dataUrl: 'data:image/png;base64,AA==' }; } },
  storage: { get: () => [], set: () => {} }
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
  storage: { get: () => [], set: () => {} }
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
  storage: { get: () => [], set: () => {} }
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
  storage: { get: () => [], set: () => {} }
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
  storage: { get: () => [], set: () => {} }
});
const visionPrimaryResult = await runDrawContext(visionPrimaryAssistant, { text: '视觉主模型返图测试', primaryVision: true }, { maxIterations: 1, comfyWorkflow: '{"1":{"class_type":"SaveImage","inputs":{}}}' });
const primaryGotImage = visionPrimaryMessages[1]?.some(message => JSON.stringify(message.content || '').includes('image_url'));
if (!visionPrimaryResult.ok || visionPrimaryResult.renderCount !== 1 || !primaryGotImage) throw new Error('视觉主模型未收到 ComfyUI 返图');
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
