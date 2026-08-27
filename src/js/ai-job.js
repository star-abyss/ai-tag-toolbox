/* ================= AI 任务控制器 =================
 * 统一管理 AI 请求的生命周期；业务模块仍通过 chatComplete() 调用，
 * 因此可以逐步迁移而不改变助手 / 生成 / 复刻 / ComfyUI 的流程代码。
 */
'use strict';

var AIJobController = (function () {
  var jobs = new Map();
  var seq = 0;
  var DEFAULT_TIMEOUT = 120000;

  function makeId() { return 'job_' + Date.now() + '_' + (++seq); }
  function snapshot(job) {
    return { id: job.id, state: job.state, startedAt: job.startedAt || 0, finishedAt: job.finishedAt || 0, error: job.error || '' };
  }
  function setState(job, state, error) {
    job.state = state;
    if (error) job.error = String(error && error.message || error);
    if (typeof job.onStatus === 'function') {
      try { job.onStatus(snapshot(job)); } catch (e) {}
    }
  }

  async function complete(messages, options) {
    options = options || {};
    var job = {
      id: makeId(), state: 'queued', startedAt: 0, finishedAt: 0, error: '',
      onStatus: options.onStatus, timeout: null, controller: new AbortController()
    };
    jobs.set(job.id, job);
    var callerSignal = options.signal;
    var onAbort = function () {
      if (!job.controller.signal.aborted) job.controller.abort();
      try { if (window.aiTag && window.aiTag.ai && typeof window.aiTag.ai.cancel === 'function') window.aiTag.ai.cancel(job.id); } catch (e) {}
    };
    if (callerSignal) {
      if (callerSignal.aborted) onAbort();
      else callerSignal.addEventListener('abort', onAbort, { once: true });
    }
    var timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT;
    job.timeout = setTimeout(function () {
      if (!job.controller.signal.aborted) {
        job.timedOut = true;
        job.controller.abort();
      }
    }, timeoutMs);
    setState(job, 'running');
    job.startedAt = Date.now();
    try {
      var result = await AIClient.complete(messages, Object.assign({}, options, { jobId: job.id }));
      if (job.timedOut) throw new Error('AI 请求超时（' + Math.round(timeoutMs / 1000) + ' 秒）');
      setState(job, 'succeeded');
      return result;
    } catch (e) {
      if (job.timedOut) {
        setState(job, 'timeout', 'AI 请求超时（' + Math.round(timeoutMs / 1000) + ' 秒）');
        throw new Error(job.error);
      }
      if (job.controller.signal.aborted || (callerSignal && callerSignal.aborted)) {
        setState(job, 'cancelled', 'AI 请求已取消');
        throw e;
      }
      setState(job, 'failed', e);
      throw e;
    } finally {
      clearTimeout(job.timeout);
      job.finishedAt = Date.now();
      if (callerSignal) callerSignal.removeEventListener('abort', onAbort);
      // 保留最近完成任务一小段时间，便于诊断；活动任务查询只返回 queued/running。
      setTimeout(function () { jobs.delete(job.id); }, 30000);
    }
  }

  function cancel(id) {
    var job = jobs.get(id);
    if (job && !job.controller.signal.aborted) job.controller.abort();
    return !!job;
  }
  function active() {
    var out = [];
    jobs.forEach(function (job) { if (job.state === 'queued' || job.state === 'running') out.push(snapshot(job)); });
    return out;
  }
  function get(id) { var job = jobs.get(id); return job ? snapshot(job) : null; }
  return { complete: complete, cancel: cancel, active: active, get: get, timeoutMs: DEFAULT_TIMEOUT };
})();
