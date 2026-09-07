'use strict';

const { assertValid } = require('./schema');

const EVALUATION_OPERATIONS = Object.freeze(['review', 'compare']);
const EVALUATION_MODES = Object.freeze(['create', 'recreate']);
const issueSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expected', 'observed', 'severity', 'suggestedChange'],
  properties: {
    expected: { type: 'string' },
    observed: { type: 'string' },
    severity: { type: 'string', enum: ['hard', 'major', 'minor'] },
    suggestedChange: { type: 'string' }
  }
};
const EVALUATION_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['operation', 'mode', 'brief', 'candidateImageIds'],
  properties: {
    operation: { type: 'string', enum: EVALUATION_OPERATIONS },
    mode: { type: 'string', enum: EVALUATION_MODES },
    brief: { type: 'object' },
    sourceImageId: { type: 'string', minLength: 1 },
    candidateImageIds: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', minLength: 1 } },
    previousEvaluations: { type: 'array', maxItems: 3, items: { type: 'object' } }
  }
});
const EVALUATION_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  required: ['operation'],
  properties: {
    operation: { type: 'string', enum: EVALUATION_OPERATIONS },
    evaluations: { type: 'array', maxItems: 3, items: { type: 'object' } },
    recommendedCandidateId: { type: 'string' },
    ranking: { type: 'array', maxItems: 3, items: { type: 'object' } },
    reason: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 }
  }
});

function text(value, fallback = '') {
  const output = value == null ? '' : String(value).trim();
  return output || fallback;
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (object(value)) return Object.fromEntries(Object.entries(value).filter(([key, item]) => key !== 'signal' && typeof item !== 'function').map(([key, item]) => [key, clone(item)]));
  return value;
}
function failure(code, message) { return Object.assign(new Error(message), { code }); }
function clamp(value, minimum, maximum) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : minimum));
}
function list(value) {
  if (Array.isArray(value)) return value.flatMap(list);
  return String(value == null ? '' : value).split(/[,，、;；|\n]+/).map(item => item.trim()).filter(Boolean);
}
function responseText(value) {
  if (typeof value === 'string') return value.trim();
  if (!object(value)) return '';
  if (value.ok === true && Object.prototype.hasOwnProperty.call(value, 'data')) return responseText(value.data);
  if (typeof value.text === 'string') return value.text.trim();
  const content = value.choices?.[0]?.message?.content ?? value.output_text;
  if (Array.isArray(content)) return content.map(item => text(item?.text || item?.content)).join('');
  return text(content);
}
function parsePayload(value) {
  if (object(value?.data) && value.ok === true) return parsePayload(value.data);
  if (object(value) && (value.operation || value.evaluations || value.ranking)) return clone(value);
  const source = responseText(value).replace(/^\s*```(?:json)?\s*|\s*```\s*$/gi, '').trim();
  if (!source) throw failure('OUTPUT_INVALID', '候选图评估子代理返回为空');
  try {
    const parsed = JSON.parse(source);
    if (!object(parsed)) throw new Error('not-object');
    return parsed;
  } catch {
    throw failure('OUTPUT_INVALID', '候选图评估子代理必须返回有效 JSON 对象');
  }
}
function severity(value, fallback = 'minor') {
  const source = text(value).toLowerCase();
  if (['hard', 'critical', 'fatal', 'blocker'].includes(source)) return 'hard';
  if (['major', 'high', 'important'].includes(source)) return 'major';
  if (['minor', 'low', 'note'].includes(source)) return 'minor';
  return fallback;
}
function normalizeIssue(value, forcedSeverity = '') {
  const source = object(value) ? value : { observed: value };
  return {
    expected: text(source.expected),
    observed: text(source.observed || source.actual || source.problem || source.issue),
    severity: severity(forcedSeverity || source.severity, forcedSeverity || 'minor'),
    suggestedChange: text(source.suggestedChange || source.suggestion || source.fix)
  };
}
function normalizeDimensions(value) {
  const result = {};
  if (Array.isArray(value)) {
    for (const row of value) {
      const name = text(row?.name || row?.dimension);
      if (name) result[name] = clamp(row?.score, 0, 100);
    }
    return result;
  }
  if (!object(value)) return result;
  for (const [name, score] of Object.entries(value)) {
    const number = object(score) ? score.score : score;
    if (Number.isFinite(Number(number))) result[name] = clamp(number, 0, 100);
  }
  return result;
}
function normalizeEvaluation(value, allowedIds) {
  const source = object(value) ? value : {};
  const candidateId = text(source.candidateId || source.imageId || source.id);
  if (!allowedIds.has(candidateId)) throw failure('OUTPUT_INVALID', `评估结果包含无效候选 ID：${candidateId || '空'}`);
  const issues = (Array.isArray(source.issues) ? source.issues : []).map(item => normalizeIssue(item));
  const hardErrors = (Array.isArray(source.hardErrors) ? source.hardErrors : []).map(item => normalizeIssue(item, 'hard'));
  for (const issue of issues.filter(item => item.severity === 'hard')) {
    if (!hardErrors.some(item => item.expected === issue.expected && item.observed === issue.observed)) hardErrors.push({ ...issue });
  }
  const score = clamp(source.score ?? source.overallScore, 0, 100);
  const requestedVerdict = text(source.verdict).toLowerCase();
  const verdict = ['accept', 'revise', 'reject'].includes(requestedVerdict)
    ? requestedVerdict
    : hardErrors.length ? 'reject' : score >= 90 ? 'accept' : 'revise';
  const rawConfidence = Number(source.confidence);
  const confidence = clamp(Number.isFinite(rawConfidence) && rawConfidence > 1 ? rawConfidence / 100 : rawConfidence, 0, 1);
  const suggestedChanges = [...new Set([
    ...list(source.suggestedChanges || source.suggestions),
    ...hardErrors.map(item => item.suggestedChange),
    ...issues.map(item => item.suggestedChange)
  ].filter(Boolean))].slice(0, 32);
  const result = {
    candidateId,
    score,
    verdict,
    confidence,
    dimensions: normalizeDimensions(source.dimensions || source.dimensionScores),
    hardErrors: hardErrors.slice(0, 32),
    issues: issues.slice(0, 64),
    strengths: [...new Set(list(source.strengths))].slice(0, 32),
    suggestedChanges,
    summary: text(source.summary || source.reason)
  };
  assertValid({ type: 'object', required: ['candidateId', 'score', 'verdict', 'hardErrors', 'issues'], properties: { candidateId: { type: 'string', minLength: 1 }, score: { type: 'number', minimum: 0, maximum: 100 }, verdict: { type: 'string', enum: ['accept', 'revise', 'reject'] }, hardErrors: { type: 'array', items: issueSchema }, issues: { type: 'array', items: issueSchema } } }, result);
  return result;
}
function normalizeReview(payload, input) {
  const rows = Array.isArray(payload.evaluations) ? payload.evaluations : object(payload.evaluation) ? [payload.evaluation] : [];
  const allowedIds = new Set(input.candidateImageIds);
  const evaluations = rows.map(row => normalizeEvaluation(row, allowedIds));
  if (evaluations.length !== input.candidateImageIds.length || new Set(evaluations.map(row => row.candidateId)).size !== input.candidateImageIds.length) {
    throw failure('OUTPUT_INVALID', '评估结果必须完整对应本次候选图');
  }
  return { operation: 'review', evaluations };
}
function normalizeCompare(payload, input) {
  const allowedIds = new Set(input.candidateImageIds);
  const sourceRows = Array.isArray(payload.ranking) ? payload.ranking : [];
  const ranking = sourceRows.map((row, index) => {
    const candidateId = text(row?.candidateId || row?.imageId || row?.id);
    if (!allowedIds.has(candidateId)) throw failure('OUTPUT_INVALID', `比较结果包含无效候选 ID：${candidateId || '空'}`);
    return { candidateId, rank: index + 1, score: clamp(row?.score ?? row?.overallScore, 0, 100), reason: text(row?.reason || row?.summary) };
  });
  if (ranking.length !== input.candidateImageIds.length || new Set(ranking.map(row => row.candidateId)).size !== input.candidateImageIds.length) {
    throw failure('OUTPUT_INVALID', '候选排序必须完整且不得重复');
  }
  const recommendedCandidateId = text(payload.recommendedCandidateId || payload.bestCandidateId || ranking[0]?.candidateId);
  if (!allowedIds.has(recommendedCandidateId)) throw failure('OUTPUT_INVALID', `推荐结果包含无效候选 ID：${recommendedCandidateId || '空'}`);
  const rawConfidence = Number(payload.confidence);
  return {
    operation: 'compare',
    recommendedCandidateId,
    ranking,
    reason: text(payload.reason || payload.summary || ranking[0]?.reason),
    confidence: clamp(Number.isFinite(rawConfidence) && rawConfidence > 1 ? rawConfidence / 100 : rawConfidence, 0, 1)
  };
}
function normalizeResult(value, input) {
  const payload = parsePayload(value);
  if (payload.operation && payload.operation !== input.operation) throw failure('OUTPUT_INVALID', '评估操作类型与请求不一致');
  return input.operation === 'review' ? normalizeReview(payload, input) : normalizeCompare(payload, input);
}
function validateInput(input) {
  try { assertValid(EVALUATION_INPUT_SCHEMA, input); } catch (error) { throw failure('INVALID_INPUT', error.message); }
  const unique = new Set(input.candidateImageIds);
  if (unique.size !== input.candidateImageIds.length) throw failure('INVALID_INPUT', 'candidateImageIds 不得重复');
  if (input.operation === 'review' && input.candidateImageIds.length !== 1) throw failure('INVALID_INPUT', 'review 每次只允许一个候选图');
  if (input.operation === 'compare' && input.candidateImageIds.length < 2) throw failure('INVALID_INPUT', 'compare 至少需要两个候选图');
  if (input.mode === 'recreate' && !text(input.sourceImageId)) throw failure('SOURCE_IMAGE_REQUIRED', '复刻评估缺少参考原图');
  if (input.sourceImageId && unique.has(input.sourceImageId)) throw failure('INVALID_INPUT', '参考原图不能同时作为候选图');
  return input;
}
function promptFor(prompts) {
  try {
    const composed = text(prompts?.composeEvaluation?.());
    if (composed) return composed;
    const direct = text(prompts?.getEffective?.('candidateEvaluation') || prompts?.get?.('candidateEvaluation'));
    if (direct) return direct;
  } catch { /* use the fixed fallback */ }
  return '你是 AI 绘画候选图评估子代理，只依据实际可见图片和结构化任务要求返回 JSON。';
}
function outputProtocol(operation) {
  if (operation === 'compare') return [
    '【系统输出协议】只返回一个 JSON 对象，禁止代码块、解释和思考过程。',
    '返回 operation="compare"、recommendedCandidateId、ranking、reason、confidence。',
    'ranking 必须且只能包含输入中的全部候选 ID，每项含 candidateId、score（0-100）和 reason，并按优到劣排列。'
  ].join('\n');
  return [
    '【系统输出协议】只返回一个 JSON 对象，禁止代码块、解释和思考过程。',
    '返回 operation="review" 和 evaluations 数组；每个输入候选恰好一项。',
    '每项包含 candidateId、score（0-100）、verdict（accept/revise/reject）、confidence（0-1）、dimensions、hardErrors、issues、strengths、suggestedChanges、summary。',
    'hardErrors 与 issues 的每项包含 expected、observed、severity（hard/major/minor）和 suggestedChange。'
  ].join('\n');
}
function safeImageUrl(image) {
  const values = [image?.thumbnailDataUrl, image?.dataUrl, image?.url, image?.src, image?.previewUrl, image?.viewUrl];
  return text(values.find(value => typeof value === 'string' && /^(?:data:image\/[a-z0-9.+-]+(?:;[^,]*)?,|https?:\/\/)/i.test(value)));
}

function createCandidateEvaluator(options = {}) {
  const visionAI = typeof options.visionAI === 'function' ? { complete: options.visionAI } : options.visionAI || null;
  const resolveImage = typeof options.resolveImage === 'function' ? options.resolveImage : null;
  const prompts = options.prompts || null;
  const directOptions = Object.freeze({ stream: false, reasoning_effort: 'none', enable_thinking: false, thinking: { type: 'disabled' } });

  async function resolveOne(imageId, context) {
    if (context.signal?.aborted) throw context.signal.reason || failure('CANCELLED', '请求已取消');
    if (!resolveImage) throw failure('IMAGE_RESOLVER_UNAVAILABLE', '未配置受控图片解析器');
    const image = await resolveImage(imageId, context);
    if (!image) throw failure('IMAGE_NOT_FOUND', `未找到或无权读取图片：${imageId}`);
    const url = safeImageUrl(image);
    if (!url) throw failure('IMAGE_DATA_UNAVAILABLE', `无法读取图片内容：${imageId}`);
    return { imageId, url };
  }
  async function buildMessages(input, context) {
    const system = `${promptFor(prompts)}\n\n${outputProtocol(input.operation)}`;
    const content = [{ type: 'text', text: [
      `操作：${input.operation}`,
      `模式：${input.mode}`,
      `候选 ID（保持原样）：${input.candidateImageIds.join(', ')}`,
      `任务摘要：${JSON.stringify(input.brief)}`,
      input.previousEvaluations?.length ? `此前评价：${JSON.stringify(input.previousEvaluations)}` : ''
    ].filter(Boolean).join('\n') }];
    if (input.sourceImageId) {
      const source = await resolveOne(input.sourceImageId, context);
      content.push({ type: 'text', text: `参考原图：${source.imageId}` });
      content.push({ type: 'image_url', image_url: { url: source.url } });
    }
    for (const candidateId of input.candidateImageIds) {
      const candidate = await resolveOne(candidateId, context);
      content.push({ type: 'text', text: `候选图：${candidate.imageId}` });
      content.push({ type: 'image_url', image_url: { url: candidate.url } });
    }
    return [{ role: 'system', content: system }, { role: 'user', content }];
  }
  async function run(rawInput, context = {}) {
    const input = validateInput(clone(rawInput));
    if (!visionAI?.complete) throw failure('SUBAGENT_UNAVAILABLE', '候选图评估所需的 Vision AI 不可用');
    const baseMessages = await buildMessages(input, context);
    let previousText = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const messages = attempt === 0 ? baseMessages : [
        ...baseMessages,
        { role: 'assistant', content: previousText.slice(0, 8000) },
        { role: 'user', content: '上一次输出无效。请严格按照系统输出协议修复，并且只返回一个有效 JSON 对象。' }
      ];
      const result = await visionAI.complete(messages, { ...directOptions, signal: context.signal });
      if (result?.ok === false) throw failure(result.code || 'EVALUATION_FAILED', text(result.error?.message || result.error || result.text, '候选图评估失败'));
      previousText = responseText(result);
      try {
        return normalizeResult(result, input);
      } catch (error) {
        if (attempt === 1 || error?.code !== 'OUTPUT_INVALID') throw error;
      }
    }
    throw failure('OUTPUT_INVALID', '候选图评估返回格式无效');
  }

  return Object.freeze({
    name: 'evaluateImages',
    description: '固定候选图评估子代理，可评价单张候选或横向比较多张候选。',
    inputSchema: EVALUATION_INPUT_SCHEMA,
    outputSchema: EVALUATION_OUTPUT_SCHEMA,
    timeoutMs: 180000,
    options: directOptions,
    getSystemPrompt: () => promptFor(prompts),
    systemPrompt: promptFor(prompts),
    run
  });
}

module.exports = {
  EVALUATION_OPERATIONS,
  EVALUATION_MODES,
  EVALUATION_INPUT_SCHEMA,
  EVALUATION_OUTPUT_SCHEMA,
  createCandidateEvaluator,
  normalizeResult
};

