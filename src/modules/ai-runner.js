'use strict';

/**
 * 统一的主 AI / Calls 工具循环。
 *
 * Runner 不拥有会话、页面或 Prompt 文本，只接收已经组装好的消息和
 * 依赖注入的 AI、Calls。assistant / draw 只是 profile，Comfy 迭代是任务
 * 上下文，不再复制另一套循环。
 */

const { addCandidate, evaluateCandidate, markRecommended, recommendedId, stripRecommendation, snapshot } = require('./draw-candidates');

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

  async function run(params = {}) {
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
        trace.push({ name: 'vision.processOne', arguments: clone(visionArgs), result: clone(visionResult), automatic: true, initial: true });
        emitToolEvent(input, { type: 'complete', name: 'vision.processOne', arguments: clone(visionArgs), result: clone(visionResult), round: 0, aiRound: 0, automatic: true, initial: true, mode: profile, task });
        const visionText = visionResult?.data?.text || visionResult?.text || JSON.stringify(clone(visionResult));
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
        }
        trace.push({ name, arguments: clone(args), result: clone(toolResult), ...(candidate ? { candidate: clone(candidate) } : {}) });
        emitToolEvent(input, { type: 'complete', name, arguments: clone(args), result: clone(toolResult), round: aiTurns, aiRound: aiTurns, mode: profile, task });
        if (candidate) emitToolEvent(input, { type: 'candidate-ready', name, candidate: clone(candidate), iteration: renderCount, round: aiTurns, aiRound: aiTurns, mode: profile, task });
        const toolData = toolResult?.data;
        const toolImage = toolData?.artifact && getImageUrl(toolData.artifact) ? toolData.artifact : null;
        const contextResult = clone(toolResult);
        if (contextResult?.data?.artifact?.dataUrl) contextResult.data.artifact.dataUrl = '';
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
            trace.push({ name: 'vision.processOne', arguments: clone(visionArgs), result: clone(visionResult), automatic: true });
            emitToolEvent(input, { type: 'complete', name: 'vision.processOne', arguments: clone(visionArgs), result: clone(visionResult), round: aiTurns, aiRound: aiTurns, automatic: true, mode: profile, task });
            conversation.push({ role: 'user', content: `【独立识图 AI 返图分析】\n${JSON.stringify(clone(visionResult))}` });
          } else if (task === 'comfy' && !primaryVision) {
            conversation.push({ role: 'user', content: `【候选 candidate-${candidate?.iteration || renderCount}】工具 ${name} 返回了返图（artifact ${artifactId || '未登记'}），本轮实际正向 Tag：${candidate?.prompt || text(args.prompt)}；本轮负向 Tag：${candidate?.negative || text(args.negative) || '无'}。当前主模型不接收图片，请调用 vision_processOne，传入该 imageId 并使用 mode=ai 进行分析。` });
          } else {
            conversation.push({ role: 'user', content: [{ type: 'text', text: `【候选 candidate-${candidate?.iteration || renderCount}】工具 ${name} 返回了一张图片（artifact ${text(toolImage.id, 'image')}）。本轮实际正向 Tag：${candidate?.prompt || text(args.prompt)}；本轮负向 Tag：${candidate?.negative || text(args.negative) || '无'}。请结合图片和用户要求评估是否继续。` }, { type: 'image_url', image_url: { url: getImageUrl(toolImage) } }] });
          }
        }
      }
      if (task === 'comfy' && renderLimit > 0 && toolCounts['comfy.render'] >= renderLimit) availableNames = availableNames.filter(name => name !== 'comfy.render');
    }
    return withStats({ ok: false, status: 'tool_limit', text: `AI 对话回合超过限制（${maxAiTurns} 回合）；ComfyUI 渲染次数与 AI 对话回合已分开统计`, reasoning: '', toolCallsUsed: trace });
  }

  return { run, tools: toolNames };
}

function emitToolEvent(input, event) {
  try { input?.onToolEvent?.(event); } catch { /* UI 事件是可选的 */ }
}

module.exports = { DEFAULT_TOOLS, createAiRunner };
