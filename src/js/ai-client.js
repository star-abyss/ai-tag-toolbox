/* ================= AI HTTP 适配器 =================
 * 调用方保持 OpenAI-compatible；实际请求由 preload → 主进程安全桥执行。
 * 业务流程只依赖 AIClient.complete，后续替换 provider 无需改动调用方。
 */
'use strict';

var AIClient = {
  complete: async function (messages, opt) {
    opt = opt || {};
    const base = (aiCfg.base || '').replace(/\/+$/, '');
    if (!base) throw new Error('未填写 API 地址');
    if (!aiCfg.model) throw new Error('未填写模型名');
    if (!window.aiTag || !window.aiTag.ai || typeof window.aiTag.ai.complete !== 'function') throw new Error('当前环境未加载安全 AI 请求桥');
    await (AI_KEY_STATE && AI_KEY_STATE.write ? AI_KEY_STATE.write : Promise.resolve());
    const result = await window.aiTag.ai.complete(messages, {
      base, model: aiCfg.model, stream: !!opt.stream, maxTokens: opt.maxTokens || 0,
      temperature: typeof aiCfg.temp === 'number' ? aiCfg.temp : 0.7,
      requestId: opt.jobId || '', onDelta: opt.onDelta
    });
    return result && typeof result === 'object' ? (result.text || '') : String(result || '');
  }
};
