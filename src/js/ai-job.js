/* ================= AI 任务控制器 =================
 * 统一管理 AI 请求的生命周期；业务模块仍通过 chatComplete() 调用，
 * 因此可以逐步迁移而不改变助手 / 生成 / 复刻 / ComfyUI 的流程代码。
 */
'use strict';

function aiElapsedLabel(ms) {
  var sec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  if (sec < 60) return sec + 's';
  var min = Math.floor(sec / 60), rest = sec % 60;
  return min + 'm ' + String(rest).padStart(2, '0') + 's';
}

var AIJobController = (function () {
  var jobs = new Map();
  var seq = 0;
  var MIN_TIMEOUT = 300000;
  var DEFAULT_TIMEOUT = 0;

  function makeId() { return 'job_' + Date.now() + '_' + (++seq); }
  function snapshot(job) {
    var end = job.finishedAt || (job.startedAt ? Date.now() : 0);
    return { id: job.id, state: job.state, startedAt: job.startedAt || 0, finishedAt: job.finishedAt || 0, elapsedMs: job.startedAt ? Math.max(0, end - job.startedAt) : 0, timeoutMs: job.timeoutMs || 0, timeoutEnabled: !!job.timeoutMs, error: job.error || '' };
  }
  function setState(job, state, error) {
    job.state = state;
    if (state !== 'queued' && state !== 'running' && !job.finishedAt) job.finishedAt = Date.now();
    if (error) job.error = String(error && error.message || error);
    if (typeof job.onStatus === 'function') {
      try { job.onStatus(snapshot(job)); } catch (e) {}
    }
  }

  function cancelRemote(job) {
    try { if (window.aiTag && window.aiTag.ai && typeof window.aiTag.ai.cancel === 'function') window.aiTag.ai.cancel(job.id); } catch (e) {}
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
      cancelRemote(job);
    };
    if (callerSignal) {
      if (callerSignal.aborted) onAbort();
      else callerSignal.addEventListener('abort', onAbort, { once: true });
    }
    var timeoutMs;
    if (options.timeoutMs === 0 || options.timeoutEnabled === false) timeoutMs = 0;
    else if (Number(options.timeoutMs) > 0) timeoutMs = options.allowShortTimeout === true ? Number(options.timeoutMs) : Math.max(MIN_TIMEOUT, Number(options.timeoutMs));
    else {
      var configured = typeof aiCfg !== 'undefined' ? aiCfg : {};
      timeoutMs = configured.timeoutEnabled === true ? Math.max(MIN_TIMEOUT, Math.min(3600000, (Number(configured.timeoutSec) || 300) * 1000)) : 0;
    }
    job.timeoutMs = timeoutMs;
    if (timeoutMs > 0) job.timeout = setTimeout(function () {
      if (!job.controller.signal.aborted) {
        job.timedOut = true;
        job.controller.abort();
        cancelRemote(job);
      }
    }, timeoutMs);
    job.startedAt = Date.now();
    setState(job, 'running');
    job.heartbeat = setInterval(function () {
      if (job.state === 'running' && typeof job.onStatus === 'function') {
        try { job.onStatus(snapshot(job)); } catch (e) {}
      }
    }, 1000);
    try {
      var result = await AIClient.complete(messages, Object.assign({}, options, { jobId: job.id }));
      if (job.timedOut) throw new Error('AI 请求超时（' + Math.max(1, Math.ceil(timeoutMs / 1000)) + ' 秒）');
      setState(job, 'succeeded');
      return result;
    } catch (e) {
      if (job.timedOut) {
        setState(job, 'timeout', 'AI 请求超时（' + Math.max(1, Math.ceil(timeoutMs / 1000)) + ' 秒）');
        throw new Error(job.error);
      }
      if (job.controller.signal.aborted || (callerSignal && callerSignal.aborted)) {
        setState(job, 'cancelled', 'AI 请求已取消');
        throw e;
      }
      setState(job, 'failed', e);
      throw e;
    } finally {
      if (job.timeout) clearTimeout(job.timeout);
      if (job.heartbeat) clearInterval(job.heartbeat);
      job.finishedAt = Date.now();
      if (callerSignal) callerSignal.removeEventListener('abort', onAbort);
      // 保留最近完成任务一小段时间，便于诊断；活动任务查询只返回 queued/running。
      setTimeout(function () { jobs.delete(job.id); }, 30000);
    }
  }

  function cancel(id) {
    var job = jobs.get(id);
    if (job && !job.controller.signal.aborted) { job.controller.abort(); cancelRemote(job); }
    return !!job;
  }
  function active() {
    var out = [];
    jobs.forEach(function (job) { if (job.state === 'queued' || job.state === 'running') out.push(snapshot(job)); });
    return out;
  }
  function get(id) { var job = jobs.get(id); return job ? snapshot(job) : null; }
  return { complete: complete, cancel: cancel, active: active, get: get, timeoutMs: DEFAULT_TIMEOUT, minTimeoutMs: MIN_TIMEOUT };
})();
