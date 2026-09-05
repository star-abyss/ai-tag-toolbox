'use strict';

function bounded(value, fallback, maximum) { return Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.min(maximum, Math.floor(Number(value))) : fallback; }
function createUsageLimiter() {
  const records = new Map();
  function begin(id, limits = {}) {
    const row = { limits: { maxToolRounds: bounded(limits.maxToolRounds, 8, 128), maxToolCalls: bounded(limits.maxToolCalls, 32, 512), maxComfyCalls: bounded(limits.maxComfyCalls, 3, 128) }, usage: { toolRounds: 0, toolCalls: 0, comfyCalls: 0, subAgentCalls: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
    records.set(id, row); return row;
  }
  function consume(id, kind) {
    const row = records.get(id); if (!row) throw new Error('请求用量记录不存在');
    const rules = kind === 'round' ? [['toolRounds', 'maxToolRounds', 'TOOL_ROUND_LIMIT', '主 AI 工具回合']] : kind === 'comfy' ? [['toolCalls', 'maxToolCalls', 'TOOL_CALL_LIMIT', '工具调用次数'], ['comfyCalls', 'maxComfyCalls', 'COMFY_CALL_LIMIT', 'ComfyUI 调用次数']] : kind === 'subagent' ? [] : [['toolCalls', 'maxToolCalls', 'TOOL_CALL_LIMIT', '工具调用次数']];
    for (const [key, limitKey, code, label] of rules) if (row.usage[key] >= row.limits[limitKey]) throw Object.assign(new Error(`${label}超过限制（${row.limits[limitKey]}）`), { code, retryable: false });
    for (const [key] of rules) row.usage[key] += 1;
    if (kind === 'subagent') row.usage.subAgentCalls += 1;
    return snapshot(id);
  }
  function add(id, usage) {
    const row = records.get(id); if (!row || !usage || typeof usage !== 'object') return;
    const prompt = Number(usage.prompt_tokens ?? usage.input_tokens) || 0;
    const completion = Number(usage.completion_tokens ?? usage.output_tokens) || 0;
    row.usage.prompt_tokens += Math.max(0, prompt); row.usage.completion_tokens += Math.max(0, completion);
    row.usage.total_tokens += Math.max(0, Number(usage.total_tokens) || prompt + completion);
  }
  function snapshot(id) { const row = records.get(id); return row ? { ...row.usage } : null; }
  return { begin, consume, add, snapshot, has: id => records.has(id), end: id => records.delete(id), clear: () => records.clear(), size: () => records.size };
}

module.exports = { createUsageLimiter };
