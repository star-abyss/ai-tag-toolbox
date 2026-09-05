'use strict';

/**
 * 统一的主 AI / Calls 工具循环。
 *
 * Runner 不拥有会话、页面或 Prompt 文本，只接收已经组装好的消息和
 * 依赖注入的 AI、Calls。assistant / draw 只是 profile，Comfy 迭代是任务
 * 上下文，不再复制另一套循环。
 */

const { addCandidate, evaluateCandidate, markRecommended, recommendedId, stripRecommendation, snapshot, finalCandidate } = require('./draw-candidates');
const {
  extractAssistantCalls,
  normaliseCall: normaliseCompactCall,
  execute: executeCompactCall,
  planImageContext,
  formatSummary: formatCompactSummary
} = require('./call-protocol');

const DEFAULT_TOOLS = Object.freeze(['tags.search', 'vision.processOne', 'comfy.render']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).trim();
  return result || fallback;
}

function clone(value) {
  if (value == null || typeof value !== 'object') return value;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(clone);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'function' || key === 'signal') continue;
    output[key] = clone(item);
  }
  return output;
}

function list(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function parseToolArguments(value) {
  if (isObject(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : {};
  } catch { return {}; }
}

function toolCallName(call) {
  return text(call?.function?.name || call?.name);
}

function normaliseToolCalls(value) {
  const rows = Array.isArray(value) ? value : value == null ? [] : [value];
  return rows.map((item, index) => {
    if (!isObject(item)) return null;
    const fn = isObject(item.function) ? item.function : {};
    const name = text(fn.name || item.name || item.tool);
    if (!name) return null;
    let args = fn.arguments ?? item.arguments ?? {};
    if (typeof args !== 'string') {
      try { args = JSON.stringify(args || {}); } catch { args = '{}'; }
    }
    return { id: text(item.id, `call_${index}`), type: text(item.type, 'function'), function: { name, arguments: text(args, '{}') } };
  }).filter(Boolean);
}

function imageUrl(value) {
  if (typeof value === 'string') return value;
  return text(value && (value.dataUrl || value.url || value.src || value.previewUrl || value.viewUrl));
}

function defaultModelLooksVision(value) {
  return /vision|[-_]?vl(?:[-_]|$)|gpt-4o|gpt-4\.1|qwen.*vl|llava|moondream|internvl|minicpm[-_]?v|pixtral|gemma.*vision|deepseek.*vision|kimi.*vision/i.test(String(value || ''));
}

function defaultJobOptions(input, config, job) {
  const source = { ...(isObject(input?.config) ? input.config : {}), ...(isObject(config) ? config : {}) };
  source.signal = job?.signal;
  source.stream = source.stream !== false;
  return source;
}

function defaultInferTextToolCalls() { return []; }

function errorText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || String(value);
  if (isObject(value)) {
    const parts = [value.message, value.text, value.error, value.detail]
      .map(item => errorText(item)).filter(Boolean);
    if (parts.length) return parts.join(' ');
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function toolChoiceUnsupported(value) {
  const message = errorText(value);
  return /tool\\?[_ -]?choice/i.test(message)
    && /thinking|reasoning|推理|思考/i.test(message);
}

function withoutToolChoice(options) {
  const next = { ...(options || {}) };
  delete next.tool_choice;
  delete next.toolChoice;
  return next;
}

// The UI uses 图片1/图片2 as human-readable labels. Resolve such a label
// against the explicitly supplied imageIds before crossing the Calls boundary;
// Vision itself still receives one concrete ID and never scans a collection.
function resolveVisionArguments(args, input) {
  if (!isObject(args)) return args;
  const imageId = text(args.imageId);
  const match = imageId.match(/^(?:图片|图|image)\s*(\d+)$/i);
  if (!match) return args;
  const index = Math.max(0, Number(match[1]) - 1);
  const resolved = text(input?.imageIds?.[index]);
  return resolved ? { ...args, imageId: resolved } : args;
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function contentText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(contentText).join('');
  if (isObject(value)) {
    if (value.type === 'text' || value.type === 'output_text') return contentText(value.text ?? value.content);
    if (value.text != null) return contentText(value.text);
    if (value.content != null) return contentText(value.content);
    if (value.delta != null) return contentText(value.delta);
  }
  return value == null ? '' : String(value);
}

function redactText(value) {
  return String(value || '')
    .replace(/data:[^\s,)]+/gi, '[image]')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s,)]+/g, '[path]')
    .slice(0, 8000);
}

function compactContent(value, allowImages = false, replaceImages = false) {
  if (!Array.isArray(value)) return redactText(contentText(value));
  const output = [];
  for (const part of value) {
    if (!isObject(part)) {
      const textValue = redactText(contentText(part));
      if (textValue) output.push({ type: 'text', text: textValue });
      continue;
    }
    if (part.type === 'text' || part.type === 'output_text') {
      const textValue = redactText(contentText(part.text ?? part.content));
      if (textValue) output.push({ type: 'text', text: textValue });
    } else if (allowImages && !replaceImages && part.type === 'image_url' && part.image_url) {
      const url = text(part.image_url.url || part.image_url.href || part.url);
      if (url && /^https?:\/\/|^data:image\//i.test(url)) output.push({ type: 'image_url', image_url: { url } });
    }
  }
  return output;
}

function compactHistory(messages, options = {}) {
  const rows = list(messages);
  const lastUser = [...rows].map((item, index) => ({ item, index })).reverse().find(({ item }) => text(item?.role).toLowerCase() === 'user')?.index;
  const imageTarget = Number.isInteger(options.imageMessageIndex) ? options.imageMessageIndex : lastUser;
  const selected = new Set(list(options.imageIndexes).map(Number));
  return rows.map((message, index) => {
    if (!isObject(message)) return null;
    const role = text(message.role).toLowerCase();
    if (!['system', 'user', 'assistant'].includes(role)) return null;
    const allowImages = role === 'user' && options.allowImages === true && (index === imageTarget || selected.has(index));
    let content = compactContent(message.content != null ? message.content : message.text, allowImages, options.replaceImages === true);
    const ephemeralParts = Array.isArray(message._compactImageParts) ? message._compactImageParts : [];
    if (ephemeralParts.length && role === 'user') {
      const existing = Array.isArray(content) ? content : [{ type: 'text', text: content }];
      content = [...existing, ...ephemeralParts];
    }
    if (allowImages && options.imageParts?.length && index === imageTarget) {
      const existing = Array.isArray(content) ? content : [{ type: 'text', text: content }];
      const hasImage = existing.some(part => part?.type === 'image_url');
      if (!hasImage) content = [...existing, ...options.imageParts];
    }
    if (Array.isArray(content)) {
      if (!content.length) content = [{ type: 'text', text: '' }];
    } else if (!content && role === 'system') content = '';
    return { role, content };
  }).filter(Boolean);
}

function imagePart(value) {
  if (typeof value === 'string') return /^data:image\//i.test(value) || /^https?:\/\//i.test(value) ? { type: 'image_url', image_url: { url: value } } : null;
  if (!isObject(value)) return null;
  const url = text(value.dataUrl || value.url || value.src || value.previewUrl || value.viewUrl);
  if (url && (/^data:image\//i.test(url) || /^https?:\/\//i.test(url))) return { type: 'image_url', image_url: { url } };
  if (value.bytes && typeof Buffer !== 'undefined') {
    try { return { type: 'image_url', image_url: { url: `data:${text(value.mime, 'image/png')};base64,${Buffer.from(value.bytes).toString('base64')}` } }; } catch { /* ignore malformed bytes */ }
  }
  return null;
}

function normaliseAiResponse(value) {
  if (typeof value === 'string') return { ok: true, text: value, reasoning: '', nativeCalls: [], raw: value };
  if (!isObject(value)) return { ok: true, text: contentText(value), reasoning: '', nativeCalls: [], raw: value };
  const nested = value.choices?.[0]?.message || value.choices?.[0]?.delta || value.message || value.delta || value;
  const source = isObject(nested) ? { ...value, ...nested } : value;
  const nativeCalls = source.toolCalls || source.tool_calls || source.function_call || source.functionCall || source.output?.filter?.(item => /function_call|tool_call|tool_use/i.test(item?.type || '')) || [];
  return {
    ok: source.ok !== false,
    text: contentText(source.text != null ? source.text : source.content != null ? source.content : value.output_text),
    reasoning: contentText(source.reasoning != null ? source.reasoning : source.reasoning_content),
    usage: source.usage || value.usage || null,
    finishReason: source.finishReason || source.finish_reason || value.choices?.[0]?.finish_reason || null,
    nativeCalls: normaliseToolCalls(nativeCalls),
    raw: value
  };
}

function safeJson(value, fallback = '{}') {
  try { return JSON.stringify(value); } catch { return fallback; }
}

function safePreviewUrl(value) {
  const url = text(value);
  return /^https?:\/\//i.test(url) ? url.slice(0, 600) : '';
}

function safeFilename(value) {
  let source = text(value);
  if (!source) return '';
  try { source = decodeURIComponent(source); } catch { /* keep the original basename */ }
  const basename = source.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
  return basename.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
}

function compactArtifact(value) {
  if (!isObject(value)) return null;
  return {
    id: text(value.id || value.imageId || value.artifactId || value.promptId),
    filename: safeFilename(value.filename || value.name),
    viewUrl: safePreviewUrl(value.viewUrl || value.url),
    mime: text(value.mime || value.contentType, 'image/png'),
    width: Number(value.width) || 0,
    height: Number(value.height) || 0,
    prompt: text(value.prompt || value.promptText),
    negative: text(value.negative || value.negativePrompt)
  };
}

const PRIVATE_TOOL_KEYS = new Set(['bytes', 'dataUrl', 'path', 'filePath', 'workflow', 'viewUrl', 'url', 'src', 'previewUrl', 'objectUrl', 'blob', 'blobId', 'data_url', 'file_path', 'view_url', 'preview_url', 'object_url', 'image_url', 'imageUrl', 'imageId', 'refId', 'artifactId', 'promptId']);

function safeToolPayload(value, context = '') {
  if (value == null || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') return safeToolPayload(parsed, context || 'result');
    } catch { /* plain tool text */ }
    return redactText(value).replace(/(?:file|blob):[^\s,)]+/gi, '[url]').replace(/https?:\/\/[^\s,)]+/gi, '[url]');
  }
  if (Array.isArray(value)) return value.map(item => safeToolPayload(item, context));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (PRIVATE_TOOL_KEYS.has(key) || /^(?:bytes|dataurl|data_url|path|filepath|file_path|workflow|viewurl|view_url|url|src|previewurl|preview_url|objecturl|object_url|image_url|imageurl|blob|blobid|imageid|refid|artifactid|promptid)$/.test(String(key).toLowerCase())) continue;
    if (context === 'artifact' && String(key).toLowerCase() === 'id') continue;
    if (key === 'tool_calls' || key === 'toolCalls') {
      const rawCalls = Array.isArray(item) ? item : item == null ? [] : [item];
      const calls = rawCalls
        .filter(call => call && call.id)
        .map((call, index) => normaliseToolCalls([call])[0] || null)
        .filter(call => {
          if (!call?.id || !call.function?.name) return false;
          try { return isObject(JSON.parse(call.function.arguments)); } catch { return false; }
        });
      if (calls.length) output[key] = calls;
      continue;
    }
    output[key] = safeToolPayload(item, key === 'artifact' ? 'artifact' : key === 'result' ? 'result' : context);
  }
  return output;
}

function compactError(value, fallback = '调用失败') {
  const source = value && typeof value === 'object' ? (value.error || value.message || value.text || value.code) : value;
  return redactText(text(source, fallback)).slice(0, 240);
}

function isAborted(job) {
  return Boolean(job?.signal?.aborted);
}

function createAiRunner(options = {}) {
  const ai = options.ai || null;
  const calls = options.calls || null;
  const getSettings = typeof options.getSettings === 'function' ? options.getSettings : () => ({});
  const normalise = typeof options.normaliseToolCalls === 'function' ? options.normaliseToolCalls : normaliseToolCalls;
  const parseArgs = typeof options.parseToolArguments === 'function' ? options.parseToolArguments : parseToolArguments;
  const getCallName = typeof options.toolCallName === 'function' ? options.toolCallName : toolCallName;
  const infer = typeof options.inferTextToolCalls === 'function' ? options.inferTextToolCalls : defaultInferTextToolCalls;
  const makeJobOptions = typeof options.jobOptions === 'function' ? options.jobOptions : defaultJobOptions;
  const looksVision = typeof options.modelLooksVision === 'function' ? options.modelLooksVision : defaultModelLooksVision;
  const getImageUrl = typeof options.imageUrl === 'function' ? options.imageUrl : imageUrl;
  const toolNames = Array.isArray(options.toolNames) && options.toolNames.length ? [...new Set(options.toolNames.map(String))] : [...DEFAULT_TOOLS];

  async function runLegacy(params = {}) {
    const input = isObject(params.input) ? params.input : {};
    const config = isObject(params.config) ? params.config : {};
    const job = params.job || { signal: input.signal || {} };
    const task = text(params.task, 'chat').toLowerCase();
    const profile = text(params.profile, task === 'chat' ? 'assistant' : 'draw').toLowerCase();
    const emit = typeof params.emit === 'function' ? params.emit : () => {};
    const toolCounts = Object.create(null);
    let candidates = [];
    const withStats = value => ({ ...value, candidates: snapshot(candidates), aiTurns, toolCalls: totalToolCalls, toolCallCount: totalToolCalls, renderCount, toolCounts: clone(toolCounts), capabilities: clone(calls?.getCapabilities?.() || null) });
    let aiTurns = 0;
    let totalToolCalls = 0;
    let renderCount = 0;
    if (!ai?.complete) return withStats({ ok: false, status: 'config', text: '主 AI 服务不可用', toolCallsUsed: [] });
    if (!calls?.call || !calls?.openAiTools) {
      const result = await ai.complete(list(params.messages).map(clone), { ...makeJobOptions(input, config, job), onDelta: emit, onEvent: input.onEvent || config.onEvent });
      aiTurns = 1;
      return withStats({ ...result, toolCallsUsed: [] });
    }

    let availableNames = [...toolNames];
    if (typeof calls.refreshCapabilities === 'function') {
      await calls.refreshCapabilities({ force: true, workflow: input.comfyWorkflow });
      if (!calls?.getCapabilities?.()?.comfy?.render) availableNames = availableNames.filter(name => name !== 'comfy.render');
    }
    if (task === 'comfy' && !availableNames.includes('comfy.render')) {
      const reason = calls?.getCapabilities?.()?.comfy?.error || 'ComfyUI 当前不可用';
      return withStats({ ok: false, status: 'comfy_unavailable', text: reason, error: 'COMFY_UNAVAILABLE', toolCallsUsed: [] });
    }

    const conversation = list(params.messages).map(clone);
    const trace = [];
    const renderLimit = task === 'comfy' ? Math.max(1, Number(input.maxIterations) || 3) : 0;
    const maxAiTurns = Math.max(1, Math.min(32, Number(input.maxToolRounds || config.maxToolRounds) || (task === 'comfy' ? renderLimit * 6 + 2 : 8)));
    const maxToolCalls = Math.max(4, Math.min(64, Number(input.maxToolCalls || config.maxToolCalls) || (task === 'comfy' ? renderLimit * 10 + 4 : 24)));
    const primaryVision = input.primaryVision == null ? looksVision(config.model || getSettings()?.model) : Boolean(input.primaryVision);
    let requiredRetry = 0;
    let toolChoiceDisabled = false;

    // A non-vision primary model cannot receive the baseline image directly.
    // Analyse the first, explicitly identified image once before the first AI
    // turn and put only the independent Vision result into the same context.
    // This keeps the single-image boundary while preserving Comfy iteration
    // behaviour after the legacy loop is removed.
    if (task === 'comfy' && !primaryVision && input.imageIds?.length && calls.has?.('vision.processOne')) {
      const imageId = text(input.imageIds[0]);
      if (imageId) {
        const visionArgs = {
          imageId,
          mode: 'ai',
          instruction: '请分析用户上传的基准图，提取与本次 ComfyUI 任务相关的角色、构图、姿势、环境和绘图 Tag。'
        };
        totalToolCalls += 1;
        toolCounts['vision.processOne'] = (toolCounts['vision.processOne'] || 0) + 1;
        emitToolEvent(input, { type: 'start', name: 'vision.processOne', arguments: clone(visionArgs), round: 0, aiRound: 0, automatic: true, initial: true, mode: profile, task });
        const visionResult = await calls.call('vision.processOne', visionArgs, {
          caller: 'assistant', sessionId: input.sessionId, signal: job.signal,
          promptOverrides: input.promptOverrides, stream: input.stream,
          onEvent: event => emitToolEvent(input, { type: 'event', name: 'vision.processOne', event, automatic: true, initial: true, mode: profile, task })
        });
        const safeVisionResult = safeToolPayload(visionResult);
        trace.push({ name: 'vision.processOne', arguments: clone(visionArgs), result: safeVisionResult, automatic: true, initial: true });
        emitToolEvent(input, { type: 'complete', name: 'vision.processOne', arguments: clone(visionArgs), result: safeVisionResult, round: 0, aiRound: 0, automatic: true, initial: true, mode: profile, task });
        const visionText = safeVisionResult?.data?.text || safeVisionResult?.text || JSON.stringify(safeVisionResult);
        if (visionText) conversation.push({ role: 'user', content: `【基准图的独立识图结果】\n${visionText}` });
      }
    }

    for (let round = 0; round < maxAiTurns; round += 1) {
      aiTurns += 1;
      emitToolEvent(input, { type: 'ai-start', round: aiTurns, aiRound: aiTurns, mode: profile, task, maxAiTurns });
      let tools;
      if (typeof calls.openAiToolsAvailable === 'function') tools = await calls.openAiToolsAvailable(availableNames, { workflow: input.comfyWorkflow, forAi: true });
      else tools = calls.openAiTools(availableNames);
      const requireTool = task === 'comfy' && !toolCounts['comfy.render'];
      // Omit tool_choice by default. A number of Thinking/Reasoning APIs
      // reject even the harmless-looking `auto` value; tools remain available
      // and the existing correction turn handles models that do not choose
      // comfy_render on their own. An explicit config value is still honored
      // for providers that require it.
      const requestedChoice = requireTool && tools.some(item => item?.function?.name === 'comfy_render')
        ? (toolChoiceDisabled ? '' : text(config.comfyToolChoice || input.comfyToolChoice))
        : '';
      let result;
      const aiOptions = withoutToolChoice({ ...makeJobOptions(input, config, job), tools, onDelta: emit, onEvent: input.onEvent || config.onEvent });
      if (requestedChoice) aiOptions.tool_choice = requestedChoice;
      let toolChoiceFallbackUsed = false;
      const retryWithoutToolChoice = message => {
        toolChoiceFallbackUsed = true;
        toolChoiceDisabled = true;
        emitToolEvent(input, { type: 'tool-choice-fallback', round: aiTurns, aiRound: aiTurns, error: message || '当前 Thinking 模式不支持 tool_choice，已移除该参数并保留工具调用' });
        return ai.complete(conversation, withoutToolChoice(aiOptions));
      };
      try {
        result = await ai.complete(conversation, aiOptions);
      } catch (error) {
        if (toolChoiceUnsupported(error) && !job.signal?.aborted) {
          result = await retryWithoutToolChoice();
        } else {
          if (!requestedChoice || job.signal?.aborted) throw error;
          result = await retryWithoutToolChoice(text(errorText(error), '当前 API 拒绝工具选项'));
        }
      }
      if (toolChoiceUnsupported(result) && !toolChoiceFallbackUsed && !job.signal?.aborted) {
        result = await retryWithoutToolChoice();
      } else if (requireTool && result?.ok === false && requestedChoice && !toolChoiceFallbackUsed && !job.signal?.aborted) {
        result = await retryWithoutToolChoice(text(result.text || result.error, '当前 API 拒绝强制工具选项'));
      }
      const inferredSource = [result?.text, result?.reasoning].filter(Boolean).join('\n');
      const inferred = result?.ok !== false && !result?.toolCalls?.length
        ? infer(inferredSource, task, input, { allowRender: !toolCounts['comfy.render'] })
        : [];
      if (inferred.length) result = { ...result, toolCalls: inferred, text: text(result.text) };
      const toolCalls = normalise(result?.toolCalls || []);
      if (result && toolCalls.length) result.toolCalls = toolCalls;
      const recommendation = recommendedId([result?.text, result?.reasoning].filter(Boolean).join('\n'));
      if (candidates.length && result?.text) {
        const latest = candidates[candidates.length - 1];
        const summary = stripRecommendation(result.text)
          .split(/(?:【最终提示词】|\[最终提示词\]|<final>|<prompt>)/i)[0]
          .replace(/(?:【思考过程】|\[思考过程\]|<thinking>|<think>)/gi, '')
          .replace(/```[\s\S]*?```/g, '')
          .trim().slice(0, 600);
        if (summary.length >= 12 && !/^(?:我将|好的|收到|下面|最终|done|完成|i(?:'ll| will)|next|let['’]s)\b/i.test(summary)) {
          candidates = evaluateCandidate(candidates, latest.id, summary);
          emitToolEvent(input, { type: 'candidate-evaluated', name: 'comfy.render', candidateId: latest.id, summary, candidates: snapshot(candidates), round: aiTurns, aiRound: aiTurns, mode: profile, task });
        }
      }
      if (recommendation && candidates.length) {
        candidates = markRecommended(candidates, recommendation);
        emitToolEvent(input, {
          type: 'candidate-recommended',
          name: 'comfy.render',
          candidateId: recommendation,
          candidates: snapshot(candidates),
          round: aiTurns,
          aiRound: aiTurns,
          mode: profile,
          task
        });
        if (result?.text) result = { ...result, text: stripRecommendation(result.text) };
      }
      emitToolEvent(input, { type: 'ai-complete', round: aiTurns, aiRound: aiTurns, mode: profile, task, maxAiTurns, text: result?.text || '', reasoning: result?.reasoning || '', toolCalls: clone(toolCalls), result: clone(result) });
      if (!result?.ok) return withStats({ ...result, toolCallsUsed: trace });
      if (!toolCalls.length) {
        if (task === 'comfy' && !toolCounts['comfy.render'] && requiredRetry < 1) {
          requiredRetry += 1;
          emitToolEvent(input, { type: 'tool-required', round: aiTurns, aiRound: aiTurns, message: 'AI 未返回原生工具调用，正在要求调用 comfy.render' });
          conversation.push({ role: 'user', content: '【工具调用纠正】当前是 ComfyUI 迭代任务。请立即使用可用的原生工具调用提交 comfy.render；不要只在文字中描述准备调用。' });
          continue;
        }
      if (task === 'comfy' && !toolCounts['comfy.render']) return withStats({ ok: false, status: 'tool_required', text: 'AI 未调用 comfy.render，当前模型可能不支持原生工具调用', reasoning: result.reasoning || '', toolCallsUsed: trace });
        return withStats({ ...result, toolCallsUsed: trace });
      }
      requiredRetry = 0;
      const assistantCallMessage = {
        role: 'assistant',
        content: result.text || '',
        tool_calls: toolCalls.map(call => ({ id: text(call.id, `call_${round}`), type: call.type || 'function', function: { name: getCallName(call), arguments: typeof call.function?.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function?.arguments || {}) } }))
      };
      conversation.push(assistantCallMessage);
      for (const call of toolCalls) {
        totalToolCalls += 1;
        if (totalToolCalls > maxToolCalls) return withStats({ ok: false, status: 'tool_limit', text: `AI 工具调用次数超过限制（${maxToolCalls} 次）；ComfyUI 渲染次数与 AI 对话回合已分开统计`, reasoning: '', toolCallsUsed: trace });
        const requestedName = getCallName(call);
        const name = calls.resolve?.(requestedName)?.name || requestedName;
        const parsedArgs = parseArgs(call.function?.arguments || call.arguments);
        const args = name === 'vision.processOne' ? resolveVisionArguments(parsedArgs, input) : parsedArgs;
        toolCounts[name] = (toolCounts[name] || 0) + 1;
        emitToolEvent(input, { type: 'start', name, arguments: clone(args), round: aiTurns, aiRound: aiTurns, mode: profile, task });
        let toolResult;
        if (name === 'comfy.render' && renderLimit > 0 && toolCounts[name] > renderLimit) {
          toolResult = { ok: false, code: 'ITERATION_LIMIT', error: `已达到本次 ComfyUI 最大迭代次数（${Number(input.maxIterations)}）` };
        } else {
          toolResult = await calls.call(name, args, {
            caller: 'assistant',
            sessionId: input.sessionId,
            promptOverrides: input.promptOverrides,
            signal: job.signal,
            workflow: input.comfyWorkflow,
            stream: input.stream,
            allowWrite: input.allowToolWrite === true,
            onEvent: event => emitToolEvent(input, { type: 'event', name, event, mode: profile, task })
          });
        }
        if (name === 'comfy.render' && toolResult?.ok !== false) renderCount += 1;
        const artifact = toolResult?.data?.artifact;
        let candidate = null;
        if (name === 'comfy.render' && toolResult?.ok !== false && artifact) {
          const candidateArtifact = clone(artifact);
          if (candidateArtifact && typeof candidateArtifact === 'object') candidateArtifact.dataUrl = '';
          candidate = {
            id: `candidate-${renderCount}`,
            iteration: renderCount,
            imageId: text(artifact.id),
            prompt: text(artifact.prompt || args.prompt),
            negative: text(artifact.negative || args.negative),
            previewUrl: getImageUrl(artifact),
            artifact: candidateArtifact,
            evaluation: { status: 'pending', summary: '', recommended: false }
          };
          candidates = addCandidate(candidates, candidate);
          // A rendered artifact becomes Vision-readable only after it is
          // attached to the current conversation. This keeps the strict
          // single-slot authorization boundary intact for legacy/native loops.
          if (candidate.imageId && input.imageRepository?.attachToConversation) {
            try {
              input.imageRepository.attachToConversation(input.sessionId, candidate.imageId, {
                source: 'comfy',
                messageId: text(input.messageId),
                candidateId: candidate.id
              });
            } catch { /* repository is optional for compatibility fixtures */ }
          }
        }
        const safeToolResult = safeToolPayload(toolResult);
        trace.push({ name, arguments: clone(args), result: safeToolResult, ...(candidate ? { candidate: clone(candidate) } : {}) });
        emitToolEvent(input, { type: 'complete', name, arguments: clone(args), result: safeToolResult, round: aiTurns, aiRound: aiTurns, mode: profile, task });
        if (candidate) emitToolEvent(input, { type: 'candidate-ready', name, candidate: clone(candidate), iteration: renderCount, round: aiTurns, aiRound: aiTurns, mode: profile, task });
        const toolData = toolResult?.data;
        const toolImage = toolData?.artifact && getImageUrl(toolData.artifact) ? toolData.artifact : null;
        const contextResult = safeToolPayload(toolResult);
        conversation.push({ role: 'tool', tool_call_id: text(call.id, `call_${round}`), name: requestedName || name, content: JSON.stringify(contextResult) });
        if (toolImage) {
          const artifactId = text(toolImage.id);
          if (task === 'comfy' && !primaryVision && artifactId && calls.has?.('vision.processOne')) {
            const visionArgs = { imageId: artifactId, mode: 'ai', instruction: '请分析这张 ComfyUI 返图与用户目标、上一轮提示词的差异，重点指出需要修正的绘图 Tag。', includeLocalTags: true };
            toolCounts['vision.processOne'] = (toolCounts['vision.processOne'] || 0) + 1;
            totalToolCalls += 1;
            if (totalToolCalls > maxToolCalls) return withStats({ ok: false, status: 'tool_limit', text: `AI 工具调用次数超过限制（${maxToolCalls} 次）；ComfyUI 渲染次数与 AI 对话回合已分开统计`, reasoning: '', toolCallsUsed: trace });
            emitToolEvent(input, { type: 'start', name: 'vision.processOne', arguments: clone(visionArgs), round: aiTurns, aiRound: aiTurns, automatic: true, mode: profile, task });
            const visionResult = await calls.call('vision.processOne', visionArgs, { caller: 'assistant', sessionId: input.sessionId, signal: job.signal, stream: input.stream, workflow: input.comfyWorkflow, onEvent: event => emitToolEvent(input, { type: 'event', name: 'vision.processOne', event, automatic: true, mode: profile, task }) });
            const safeVisionResult = safeToolPayload(visionResult);
            trace.push({ name: 'vision.processOne', arguments: clone(visionArgs), result: safeVisionResult, automatic: true });
            emitToolEvent(input, { type: 'complete', name: 'vision.processOne', arguments: clone(visionArgs), result: safeVisionResult, round: aiTurns, aiRound: aiTurns, automatic: true, mode: profile, task });
            conversation.push({ role: 'user', content: `【独立识图 AI 返图分析】\n${JSON.stringify(safeVisionResult)}` });
          } else if (task === 'comfy' && !primaryVision) {
            conversation.push({ role: 'user', content: `【候选 candidate-${candidate?.iteration || renderCount}】工具 ${name} 已返回候选图；本轮实际正向 Tag：${candidate?.prompt || text(args.prompt)}；本轮负向 Tag：${candidate?.negative || text(args.negative) || '无'}。当前主模型不接收图片，请调用 vision，传入候选编号并使用 mode=ai 进行分析。` });
          } else {
            conversation.push({ role: 'user', content: [{ type: 'text', text: `【候选 candidate-${candidate?.iteration || renderCount}】工具 ${name} 返回了一张图片。本轮实际正向 Tag：${candidate?.prompt || text(args.prompt)}；本轮负向 Tag：${candidate?.negative || text(args.negative) || '无'}。请结合图片和用户要求评估是否继续。` }, { type: 'image_url', image_url: { url: getImageUrl(toolImage) } }] });
          }
        }
      }
      if (task === 'comfy' && renderLimit > 0 && toolCounts['comfy.render'] >= renderLimit) availableNames = availableNames.filter(name => name !== 'comfy.render');
    }
    return withStats({ ok: false, status: 'tool_limit', text: `AI 对话回合超过限制（${maxAiTurns} 回合）；ComfyUI 渲染次数与 AI 对话回合已分开统计`, reasoning: '', toolCallsUsed: trace });
  }

  /**
   * Compact JSON protocol loop used by the main Assistant. The provider only
   * sees ordinary system/user/assistant messages; calls are parsed from the
   * completed response and represented in the next turn by a short user
   * context line. Native tool schemas remain available through runLegacy for
   * old gateways and externally supplied histories.
   */
  async function runCompact(params = {}) {
    const input = isObject(params.input) ? params.input : {};
    const config = isObject(params.config) ? params.config : {};
    const job = params.job || { signal: input.signal || {} };
    const task = text(params.task, 'chat').toLowerCase();
    const profile = text(params.profile, task === 'chat' ? 'assistant' : 'draw').toLowerCase();
    const emit = typeof params.emit === 'function' ? params.emit : () => {};
    const repository = input.imageRepository || input.repository || options.imageRepository || null;
    const tempStore = input.visionTempStore || input.tempStore || options.visionTempStore || null;
    const settings = {
      ...(isObject(getSettings?.()) ? getSettings() : {}),
      ...(isObject(input.settings) ? input.settings : {}),
      ...(isObject(config.settings) ? config.settings : {})
    };
    // Page-level controls are passed on the request input. Mirror them into
    // the settings view consumed by call-protocol so compact `search` calls
    // use the live adult/precision/category state rather than stale defaults.
    if (input.nsfwEnabled != null) settings.nsfwEnabled = input.nsfwEnabled === true;
    if (input.includeAdult != null) settings.includeAdult = input.includeAdult === true;
    if (input.searchPrecision != null) settings.searchPrecision = text(input.searchPrecision);
    if (input.currentCategory != null) settings.category = text(input.currentCategory);
    if (input.promptVersion != null) settings.visionPromptVersion = text(input.promptVersion);
    let aiTurns = 0;
    let totalToolCalls = 0;
    let renderCount = 0;
    let requiredRetry = 0;
    let candidates = [];
    const trace = [];
    const toolCounts = Object.create(null);
    const visionCache = options.visionCache instanceof Map
      ? options.visionCache
      : (input.visionCache instanceof Map ? input.visionCache : new Map());
    const resultCache = options.callCache instanceof Map
      ? options.callCache
      : (input.callCache instanceof Map ? input.callCache : visionCache);
    const maxAiTurns = Math.max(1, Math.min(32, Number(input.maxToolRounds || config.maxToolRounds) || (task === 'comfy' ? (Number(input.maxIterations) || Number(settings.comfyIters) || 3) * 6 + 2 : 8)));
    const maxToolCalls = Math.max(4, Math.min(64, Number(input.maxToolCalls || config.maxToolCalls) || (task === 'comfy' ? (Number(input.maxIterations) || Number(settings.comfyIters) || 3) * 10 + 4 : 24)));
    const renderLimit = task === 'comfy'
      ? Math.max(1, Math.min(20, Number(input.maxComfyCalls || input.maxIterations || settings.maxComfyCalls) || 3))
      : 0;
    const requestId = text(input.requestId || job.id, `request_${Date.now().toString(36)}`);
    const stale = () => {
      if (isAborted(job)) return true;
      try {
        if (typeof input.isCurrent === 'function' && input.isCurrent(requestId) === false) return true;
        if (typeof options.isCurrent === 'function' && options.isCurrent({ requestId, sessionId: input.sessionId, job }) === false) return true;
      } catch { return true; }
      return false;
    };
    const withStats = value => ({
      ...value,
      candidates: snapshot(candidates),
      aiTurns,
      toolCalls: totalToolCalls,
      toolCallCount: totalToolCalls,
      renderCount,
      toolCounts: clone(toolCounts),
      capabilities: clone(calls?.getCapabilities?.() || null)
    });
    const cancelled = () => withStats({ ok: false, status: 'cancelled', code: 'CANCELLED', text: '已停止', reasoning: '', toolCallsUsed: trace });
    const staleResult = () => withStats({ ok: false, status: 'stale', code: 'STALE_RESULT', text: '请求已切换到新的会话', reasoning: '', toolCallsUsed: trace });
    if (!ai?.complete) return withStats({ ok: false, status: 'config', text: '主 AI 服务不可用', toolCallsUsed: [] });
    if (stale()) return cancelled();

    if (typeof calls?.refreshCapabilities === 'function') {
      try { await calls.refreshCapabilities({ force: true, workflow: input.comfyWorkflow }); } catch { /* capability errors are surfaced below */ }
    }
    if (stale()) return cancelled();
    const capabilities = calls?.getCapabilities?.() || {};
    if (task === 'comfy' && capabilities.comfy && capabilities.comfy.render === false) {
      return withStats({ ok: false, status: 'comfy_unavailable', code: 'COMFY_UNAVAILABLE', text: capabilities.comfy.error || 'ComfyUI 当前不可用', reasoning: '', toolCallsUsed: trace });
    }

    const originalConversation = list(params.messages).map(clone);
    const conversation = originalConversation.length ? originalConversation : [{ role: 'user', content: text(input.text) }];
    let imageMessageIndex = [...conversation].map((item, index) => ({ item, index })).reverse().find(({ item }) => text(item?.role).toLowerCase() === 'user')?.index;
    if (imageMessageIndex == null && text(input.text)) {
      conversation.push({ role: 'user', content: text(input.text) });
      imageMessageIndex = conversation.length - 1;
    }

    const pendingRefIds = list(input.pendingRefIds || input.pendingRefs || input.attachRefs).map(text).filter(Boolean);
    let plan = { manifest: [], explicitRefs: [], attachRefs: [], toolReadableRefs: [], errors: [] };
    try {
      plan = planImageContext({ sessionId: input.sessionId, userText: input.text || input.userText || '', pendingRefIds, imageRepository: repository });
    } catch { /* an optional repository must not prevent text-only chat */ }
    const actionablePlanErrors = (plan.errors || []).filter(error => (
      input.allowDetachedImages !== true || !/^图片\s*\d+不在当前会话/.test(String(error))
    ));
    if (actionablePlanErrors.length) {
      return withStats({ ok: false, status: 'image_reference', code: 'IMAGE_SCOPE', text: compactError(actionablePlanErrors[0], '图片引用无效'), reasoning: '', toolCallsUsed: trace });
    }
    const rows = Array.isArray(plan.manifest) ? plan.manifest : [];
    const repoRows = (() => {
      try {
        const listed = repository?.listConversation?.(input.sessionId, { includePending: true });
        return Array.isArray(listed) ? listed : (listed?.items || []);
      } catch { return []; }
    })();
    const suppliedImages = list(input.images);
    const requestedValues = list(input.imageIds).length ? list(input.imageIds) : suppliedImages;
    const detachedValues = requestedValues.map(value => {
      const id = typeof value === 'string' ? value : value?.id || value?.imageId || value?.refId;
      const row = repoRows.find(item => String(item.refId || '') === String(id) || String(item.imageId || '') === String(id) || String(item.slotNo || '') === String(id) || String(item.candidateId || '') === String(id));
      return row ? null : id || value;
    }).filter(Boolean);
    if (detachedValues.length && input.allowDetachedImages !== true) {
      return withStats({ ok: false, status: 'image_reference', code: 'IMAGE_SCOPE', text: '图片必须先关联到当前会话', reasoning: '', toolCallsUsed: trace });
    }
    const selectedRefIds = new Set([...(plan.attachRefs || []), ...(plan.explicitRefs || [])].map(text).filter(Boolean));
    for (const requested of list(input.imageIds || input.images)) {
      const id = typeof requested === 'string' ? requested : requested?.id || requested?.imageId || requested?.refId;
      const row = repoRows.find(item => String(item.refId || '') === String(id) || String(item.imageId || '') === String(id) || String(item.slotNo || '') === String(id) || String(item.candidateId || '') === String(id));
      if (row?.refId) selectedRefIds.add(String(row.refId));
    }
    const selectedRows = repoRows.filter(item => selectedRefIds.has(String(item.refId)));
    const resolveSupplied = id => suppliedImages.find(item => String(item?.id || item?.imageId || '') === String(id))
      || (typeof input.resolveImage === 'function' ? input.resolveImage(id) : null)
      || (typeof options.resolveImage === 'function' ? options.resolveImage(id) : null);
    const selectedImageParts = selectedRows.map(row => imagePart(resolveSupplied(row.imageId))).filter(Boolean);
    if (!selectedImageParts.length && input.allowDetachedImages === true) {
      for (const item of suppliedImages) {
        const id = item?.id || item?.imageId;
        if (!id || selectedRefIds.size && !selectedRows.some(row => String(row.imageId) === String(id))) continue;
        const part = imagePart(item);
        if (part) selectedImageParts.push(part);
      }
    }
    const primaryVision = input.primaryVision == null ? looksVision(config.model || settings.model) : Boolean(input.primaryVision);
    const initialImageAllowed = primaryVision && !(task === 'comfy' && !primaryVision);
    if (plan.manifest?.length) {
      // `plan.manifest` is already a whitelist object. Rebuild it here so a
      // legacy repository adapter cannot smuggle internal IDs into the model
      // prompt through enumerable properties.
      const manifestLine = `【当前会话图片清单】\n${safeJson(plan.manifest.map(item => ({
        label: text(item.label, '图片'),
        title: redactText(item.title || '').slice(0, 120),
        source: redactText(item.source || '').slice(0, 40),
        ...(item.candidateId ? { candidateId: redactText(item.candidateId).slice(0, 80) } : {}),
        pending: item.pending === true,
        final: item.final === true
      })))} `;
      conversation.splice(Math.min(1, conversation.length), 0, { role: 'system', content: manifestLine });
      if (imageMessageIndex != null && imageMessageIndex >= 1) imageMessageIndex += 1;
    }

    const optionalFieldError = value => /(?:HTTP\s*4\d\d|invalid|unknown|unsupported)/i.test(compactError(value))
      && /(?:reasoning|thinking|tool[_ -]?choice|response[_ -]?format)/i.test(compactError(value));
    async function requestAi(messages) {
      const baseOptions = withoutToolChoice({ ...makeJobOptions(input, config, job) });
      delete baseOptions.tools;
      delete baseOptions.tool_choice;
      delete baseOptions.toolChoice;
      // Compact parsing waits for the completed response. Deltas are collected
      // only for provider compatibility and are never parsed/executed here.
      baseOptions.onDelta = () => {};
      baseOptions.onEvent = () => {};
      try {
        const first = await ai.complete(messages, baseOptions);
        if (first?.ok === false && optionalFieldError(first)) {
          const retryOptions = { ...baseOptions };
          delete retryOptions.reasoning_effort;
          delete retryOptions.enable_thinking;
          delete retryOptions.thinking;
          delete retryOptions.response_format;
          return ai.complete(messages, retryOptions);
        }
        return first;
      } catch (error) {
        if (stale()) throw error;
        if (!optionalFieldError(error)) throw error;
        const retryOptions = { ...baseOptions };
        delete retryOptions.reasoning_effort;
        delete retryOptions.enable_thinking;
        delete retryOptions.thinking;
        delete retryOptions.response_format;
        return ai.complete(messages, retryOptions);
      }
    }

    const callContext = roundCounts => ({
      ...input,
      sessionId: input.sessionId,
      settings,
      imageRepository: repository,
      visionTempStore: tempStore,
      tempStore,
      calls,
      callCounts: roundCounts,
      callsUsed: roundCounts,
      signal: job.signal,
      caller: 'assistant',
      allowWrite: input.allowToolWrite === true,
      allowRender: input.allowRender !== false,
      confirmRender: input.confirmRender === true || settings.autoRender !== false,
      currentCategory: input.currentCategory || settings.category,
      permissions: input.permissions,
      requestId
    });

    async function runCall(rawCall, round, automatic = false, roundCounts = Object.create(null)) {
      if (stale()) return { stale: true, outcome: { ok: false, code: 'CANCELLED', error: '已停止' } };
      const context = callContext(roundCounts);
      const normalisedCall = normaliseCompactCall(rawCall, context);
      if (!normalisedCall.ok) return { normalised: normalisedCall, outcome: normalisedCall };
      const name = normalisedCall.call;
      if (name === 'render' && renderLimit > 0 && renderCount >= renderLimit) {
        return { normalised: normalisedCall, outcome: { ok: false, status: 'error', code: 'ITERATION_LIMIT', error: `已达到本次 ComfyUI 最大迭代次数（${renderLimit}）` } };
      }
      if (totalToolCalls >= maxToolCalls) return { normalised: normalisedCall, outcome: { ok: false, code: 'CALL_LIMIT', error: `AI 工具调用次数超过限制（${maxToolCalls} 次）` } };
      totalToolCalls += 1;
      roundCounts[name] = (roundCounts[name] || 0) + 1;
      toolCounts[name] = (toolCounts[name] || 0) + 1;
      const safeArgs = clone(normalisedCall.variables || {});
      emitToolEvent(input, { type: 'start', name, arguments: safeArgs, round, aiRound: aiTurns, automatic, requestId, sessionId: input.sessionId, mode: profile, task });
      const resolvedIdentity = normalisedCall.resolved || {};
      const currentTemp = tempStore?.current?.() || null;
      const promptVersion = text(input.promptVersion
        || settings.visionPromptVersion
        || settings.promptVersion
        || input.promptOverrides?.vision
        || settings.visionPrompt, 'default');
      const modelIdentity = text(input.model
        || input.visionModel
        || settings.visionModel
        || settings.model
        || config.model);
      const assetRevision = text(resolvedIdentity.assetRevision
        || resolvedIdentity.revision
        || resolvedIdentity.updatedAt
        || resolvedIdentity.createdAt
        || currentTemp?.createdAt
        || currentTemp?.requestId);
      const cacheKey = name === 'vision'
        ? `vision:${safeJson({ imageId: resolvedIdentity.imageId || safeArgs.imageId, tempId: resolvedIdentity.tempId || safeArgs.tempId, refId: resolvedIdentity.refId, model: modelIdentity, promptVersion, analysisMode: safeArgs.mode || 'ai', instruction: safeArgs.instruction || '', local: safeArgs.includeLocalTags, sessionId: input.sessionId || '', assetRevision })}`
        : name === 'search'
          ? `search:${safeJson({ query: safeArgs.query, precision: safeArgs.precision, includeAdult: safeArgs.includeAdult, category: safeArgs.category, limit: safeArgs.limit, model: modelIdentity, promptVersion, analysisMode: 'search', sessionId: input.sessionId || '', assetRevision: input.tagRevision || settings.tagRevision || settings.revision || '' })}`
          : '';
      if (cacheKey && resultCache.has(cacheKey)) {
        const cached = clone(resultCache.get(cacheKey));
        emitToolEvent(input, { type: 'complete', name, arguments: safeArgs, result: cached.summary || cached.result || cached, round, aiRound: aiTurns, automatic, cached: true, requestId, sessionId: input.sessionId, mode: profile, task });
        trace.push({ name, arguments: safeArgs, result: clone(cached.summary || cached.result || cached), automatic, cached: true });
        return { normalised: normalisedCall, outcome: cached, cached: true };
      }
      let rawResult = null;
      const outcome = await executeCompactCall(normalisedCall, {
        ...context,
        executor: async (executorName, args, executorContext) => {
          if (typeof calls?.call !== 'function') return { ok: false, code: 'EXECUTOR_UNAVAILABLE', error: '调用执行器不可用' };
          rawResult = await calls.call(executorName, args, {
            ...executorContext,
            caller: 'assistant',
            sessionId: input.sessionId,
            signal: job.signal,
            workflow: input.comfyWorkflow,
            promptOverrides: input.promptOverrides,
            stream: false,
            allowWrite: input.allowToolWrite === true,
            onEvent: event => emitToolEvent(input, { type: 'event', name, event: clone(event), round, aiRound: aiTurns, automatic, requestId, sessionId: input.sessionId, mode: profile, task })
          });
          return rawResult;
        }
      });
      if (stale()) return { stale: true, normalised: normalisedCall, outcome: { ok: false, code: 'STALE_RESULT', error: '请求已切换到新的会话' } };
      let summaryResult = clone(outcome?.summary || outcome?.result || outcome || {});
      let candidate = null;
      let repositoryAttached = false;
      const artifact = rawResult?.data?.artifact || rawResult?.artifact || (name === 'render' ? rawResult?.data : null);
      if (name === 'render' && outcome?.ok !== false && artifact && !isAborted(job)) {
        renderCount += 1;
        const artifactSummary = compactArtifact(artifact);
        const candidateId = `candidate-${renderCount}`;
        candidate = {
          id: candidateId,
          iteration: renderCount,
          imageId: text(artifactSummary?.id),
          prompt: text(artifactSummary?.prompt || safeArgs.prompt),
          negative: text(artifactSummary?.negative || safeArgs.negative),
          previewUrl: safePreviewUrl(getImageUrl(artifact)),
          artifact: artifactSummary,
          evaluation: { status: 'pending', summary: '', recommended: false }
        };
        candidates = addCandidate(candidates, candidate);
        if (candidate.imageId && repository?.attachToConversation && !stale()) {
          try { repositoryAttached = Boolean(repository.attachToConversation(input.sessionId, candidate.imageId, { source: 'comfy', messageId: text(input.messageId), candidateId })); } catch { /* optional repository */ }
        }
        // Keep the stable image ID in the private repository/candidate state;
        // the model only needs the short candidate alias.
        summaryResult = { ...summaryResult, candidateId, prompt: text(safeArgs.prompt), status: 'done' };
        if (outcome && typeof outcome === 'object') {
          outcome.result = summaryResult;
          outcome.summary = summaryResult;
        }
        emitToolEvent(input, { type: 'candidate-ready', name, candidate: clone(candidate), iteration: renderCount, repositoryAttached, round, aiRound: aiTurns, requestId, sessionId: input.sessionId, mode: profile, task });
      }
      if (cacheKey && outcome?.ok !== false) resultCache.set(cacheKey, clone(outcome));
      trace.push({ name, arguments: safeArgs, result: summaryResult, ...(candidate ? { candidate: snapshot([candidate])[0] } : {}), automatic });
      emitToolEvent(input, { type: 'complete', name, arguments: safeArgs, result: summaryResult, round, aiRound: aiTurns, automatic, requestId, sessionId: input.sessionId, mode: profile, task });
      return { normalised: normalisedCall, outcome, summary: summaryResult, rawResult, artifact, candidate };
    }

    async function injectAutomaticVision(imageRef, round, reason) {
      if (!imageRef || typeof calls?.call !== 'function') return null;
      const result = await runCall({ call: 'vision', image: imageRef }, round, true, Object.create(null));
      if (result.stale) return result;
      if (result.outcome?.ok !== false) {
        conversation.push({ role: 'user', content: `【${reason}】\n${safeJson(result.summary || result.outcome?.summary || {})}` });
      }
      return result;
    }

    const shouldAutoVision = !primaryVision
      && selectedRows.length === 1
      && input.autoVision !== false
      && ['assistant', 'draw', 'comfy'].includes(task)
      && (calls?.has?.('vision.processOne') || calls?.call);
    if (shouldAutoVision) {
      const initialVision = await injectAutomaticVision(selectedRows[0].refId || selectedRows[0].imageId, 0, '基准图的独立识图结果');
      if (initialVision?.stale || isAborted(job)) return isAborted(job) ? cancelled() : staleResult();
      if (initialVision?.outcome?.ok === false && initialVision.outcome.code === 'IMAGE_SCOPE') return withStats({ ok: false, status: 'image_reference', code: initialVision.outcome.code, text: compactError(initialVision.outcome.error, '图片引用无效'), reasoning: '', toolCallsUsed: trace });
    }

    for (let round = 0; round < maxAiTurns; round += 1) {
      if (stale()) return isAborted(job) ? cancelled() : staleResult();
      aiTurns += 1;
      const requestMessages = compactHistory(conversation, {
        allowImages: round === 0 && initialImageAllowed,
        imageParts: selectedImageParts,
        imageMessageIndex,
        replaceImages: true
      });
      // Ephemeral candidate images are valid for exactly one follow-up turn.
      const ephemeral = conversation.filter(message => Array.isArray(message?._compactImageParts));
      emitToolEvent(input, { type: 'ai-start', round: aiTurns, aiRound: aiTurns, mode: profile, task, maxAiTurns, requestId, sessionId: input.sessionId });
      let rawResponse;
      try { rawResponse = await requestAi(requestMessages); }
      catch (error) {
        if (isAborted(job)) return cancelled();
        return withStats({ ok: false, status: 'error', code: error?.code || 'AI_ERROR', text: compactError(error, 'AI 请求失败'), reasoning: '', toolCallsUsed: trace });
      }
      if (stale()) return isAborted(job) ? cancelled() : staleResult();
      const response = normaliseAiResponse(rawResponse);
      if (response.ok === false) return withStats({ ok: false, status: 'error', text: compactError(response, 'AI 请求失败'), reasoning: redactText(response.reasoning), toolCallsUsed: trace });
      const extracted = extractAssistantCalls(response.text || '');
      let callsInResponse = extracted.calls || [];
      if (extracted.errors?.some(error => /每轮只允许一个调用/.test(String(error)))) {
        return withStats({ ok: false, status: 'call_protocol', code: 'CALL_LIMIT', text: '每轮只允许一个调用', reasoning: redactText(response.reasoning), toolCallsUsed: trace });
      }
      if (extracted.errors?.length) {
        // A malformed compact marker is a protocol failure, not an empty
        // assistant answer. Return a short actionable error before any visible
        // text/history write so the broken marker cannot be persisted.
        return withStats({ ok: false, status: 'call_protocol', code: 'CALL_PROTOCOL', text: 'CALL_PROTOCOL：AI 调用格式无效，请返回完整的独立 JSON 调用', reasoning: redactText(response.reasoning), toolCallsUsed: trace });
      }
      // Old providers may still return native tool_calls/function_call fields.
      // Adapt them at this boundary, but never write their native shape back.
      if (!callsInResponse.length && response.nativeCalls?.length) callsInResponse = response.nativeCalls;
      // An empty visible body is meaningful when the complete response was a
      // standalone compact call. Do not fall back to raw response text here.
      let visibleText = extracted.visibleText == null ? text(response.text) : String(extracted.visibleText).trim();
      let reasoning = redactText(response.reasoning);
      const recommendation = recommendedId(`${visibleText}\n${reasoning}`);
      if (candidates.length && visibleText) {
        const latest = candidates[candidates.length - 1];
        const evaluationText = stripRecommendation(visibleText).split(/(?:【最终提示词】|\[最终提示词\]|<final>|<prompt>)/i)[0]
          .replace(/(?:【思考过程】|\[思考过程\]|<thinking>|<think>)/gi, '').replace(/```[\s\S]*?```/g, '').trim().slice(0, 600);
        if (evaluationText.length >= 12 && !/^(?:我将|好的|收到|下面|最终|done|完成|i(?:'ll| will)|next|let['’]s)\b/i.test(evaluationText)) {
          candidates = evaluateCandidate(candidates, latest.id, evaluationText);
          emitToolEvent(input, { type: 'candidate-evaluated', name: 'comfy.render', candidateId: latest.id, summary: evaluationText, candidates: snapshot(candidates), round: aiTurns, aiRound: aiTurns, requestId, sessionId: input.sessionId, mode: profile, task });
        }
      }
      if (recommendation && candidates.length) {
        candidates = markRecommended(candidates, recommendation);
        visibleText = stripRecommendation(visibleText);
        emitToolEvent(input, { type: 'candidate-recommended', name: 'comfy.render', candidateId: recommendation, candidates: snapshot(candidates), round: aiTurns, aiRound: aiTurns, requestId, sessionId: input.sessionId, mode: profile, task });
      }
      emitToolEvent(input, { type: 'ai-complete', round: aiTurns, aiRound: aiTurns, mode: profile, task, maxAiTurns, text: visibleText, reasoning, calls: callsInResponse.map(call => ({ call: text(call?.call || call?.name || call?.function?.name) })), requestId, sessionId: input.sessionId, result: { ok: true, text: visibleText, reasoning } });
      // Emit only the post-parse visible body. Raw deltas (which may contain a
      // half JSON object) are intentionally withheld from the UI.
      if (visibleText || reasoning) emit(visibleText, reasoning);
      if (!callsInResponse.length) {
        if (task === 'comfy' && !toolCounts.render && !toolCounts['comfy.render'] && requiredRetry < 1) {
          requiredRetry += 1;
          conversation.push({ role: 'assistant', content: visibleText });
          conversation.push({ role: 'user', content: '【工具调用纠正】当前是 ComfyUI 迭代任务。请返回独立 JSON 行 {"call":"render","prompt":"..."} 以提交一次渲染，不要只描述计划。' });
          continue;
        }
        if (task === 'comfy' && !toolCounts.render && !toolCounts['comfy.render']) return withStats({ ok: false, status: 'tool_required', text: 'AI 未返回 render 调用', reasoning, toolCallsUsed: trace });
        const selected = finalCandidate(candidates);
        return withStats({ ok: true, text: visibleText, reasoning, usage: response.usage || null, finishReason: response.finishReason || null, toolCallsUsed: trace, ...(selected || {}), ...(candidates.length && !selected ? { selectionRequired: true } : {}) });
      }
      if (visibleText) conversation.push({ role: 'assistant', content: visibleText });
      const roundCounts = Object.create(null);
      for (const rawCall of callsInResponse.slice(0, 1)) {
        if (stale()) return isAborted(job) ? cancelled() : staleResult();
        const callResult = await runCall(rawCall, aiTurns, false, roundCounts);
        if (callResult.stale) return isAborted(job) ? cancelled() : staleResult();
        const outcome = callResult.outcome || callResult.normalised;
        const errorCode = text(outcome?.code || outcome?.result?.code);
        const errorMessage = compactError(outcome?.error || outcome?.result?.error || outcome?.text, '调用失败');
        if (errorCode === 'CANCELLED' || isAborted(job)) return cancelled();
        if (errorCode === 'STALE_RESULT') return staleResult();
        if (errorCode === 'ITERATION_LIMIT' || errorCode === 'CALL_LIMIT') return withStats({ ok: false, status: 'tool_limit', code: errorCode, text: errorMessage, reasoning, toolCallsUsed: trace });
        if (errorCode === 'IMAGE_SCOPE' || /不唯一|不在当前会话|当前没有活动临时图|图片引用/.test(errorMessage)) {
          return withStats({ ok: false, status: 'image_reference', code: 'IMAGE_SCOPE', text: errorMessage, reasoning, toolCallsUsed: trace });
        }
        if (outcome?.status === 'confirmation_required') return withStats({ ok: false, status: 'confirmation_required', code: 'CONFIRMATION_REQUIRED', text: '请确认后再执行自动出图', reasoning, toolCallsUsed: trace });
        const summary = callResult.summary || outcome?.summary || outcome?.result || { ok: outcome?.ok !== false, status: outcome?.status || 'done' };
        conversation.push({ role: 'user', content: `【调用结果 ${text(callResult.normalised?.call || rawCall?.call || rawCall?.name)}】\n${safeJson(summary)}` });
        if (callResult.candidate) {
          const artifactUrl = getImageUrl(callResult.artifact || {});
          if (task === 'comfy' && !primaryVision) {
            if (calls?.has?.('vision.processOne') || calls?.call) {
              const visionResult = await injectAutomaticVision(callResult.candidate.imageId, aiTurns, '独立识图 AI 返图分析');
              if (visionResult?.stale || isAborted(job)) return isAborted(job) ? cancelled() : staleResult();
            } else {
              conversation.push({ role: 'user', content: `候选 ${callResult.candidate.id} 已生成。当前主模型不接收图片，请调用 {"call":"vision","image":"${callResult.candidate.imageId}"} 进行分析。` });
            }
          } else if (primaryVision && artifactUrl && /^https?:\/\/|^data:image\//i.test(artifactUrl)) {
            conversation.push({ role: 'user', content: `【候选 ${callResult.candidate.id}】请结合返图和用户要求评估是否继续。`, _compactImageParts: [imagePart(artifactUrl)].filter(Boolean) });
          }
        }
      }
      // Do not let a one-turn ephemeral image become historical context.
      for (const message of ephemeral) delete message._compactImageParts;
      if (task === 'comfy' && renderLimit > 0 && renderCount >= renderLimit) {
        // Further render calls receive a bounded error summary rather than
        // silently exceeding the user-selected candidate budget.
        toolCounts['comfy.render'] = Math.max(toolCounts['comfy.render'] || 0, renderLimit);
      }
    }
    return withStats({ ok: false, status: 'tool_limit', text: `AI 对话回合超过限制（${maxAiTurns} 回合）`, reasoning: '', toolCallsUsed: trace });
  }

  // Compact is the default AI-facing contract. Legacy/native integrations can
  // opt out explicitly with compact:false; this keeps the migration boundary
  // visible instead of inferring it from a provider response shape.
  const compactDefault = options.compact !== false;
  async function run(params = {}) {
    const requested = params.compact == null ? compactDefault : params.compact === true;
    return requested ? runCompact(params) : runLegacy(params);
  }

  return { run, runCompact, runLegacy, tools: toolNames };
}

function emitToolEvent(input, event) {
  try { input?.onToolEvent?.(event); } catch { /* UI 事件是可选的 */ }
}

module.exports = { DEFAULT_TOOLS, createAiRunner };
