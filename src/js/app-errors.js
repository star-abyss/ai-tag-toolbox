'use strict';
/* ================= 统一错误解释层 =================
 * 用户看到的是可执行的中文建议；维护时可依据 code/context 和脱敏 detail
 * 快速定位。这里绝不显示 API Key、Authorization 或完整异常堆栈。
 */
var APP_ERROR_LAST = null;

function appErrorRaw(error) {
  let text = '';
  if (error && typeof error === 'object') text = String(error.message || error.error || error.reason || '');
  if (!text) text = String(error == null ? '' : error);
  // Electron invoke rejection 常带有一层远程方法包装，用户不需要看到它。
  text = text.replace(/^Error invoking remote method\s+['"][^'"]+['"]:\s*/i, '');
  text = text.replace(/^Error:\s*/i, '').trim();
  return text || '未知错误';
}

function appErrorSafeDetail(text) {
  return String(text || '未知错误')
    .replace(/Bearer\s+[A-Za-z0-9._~+\-/=]+/gi, 'Bearer [已隐藏]')
    .replace(/(api[-_ ]?key|token|authorization)\s*[:=]\s*[^,;\s]+/gi, '$1=[已隐藏]')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 260);
}

function appErrorResult(code, title, message, hint, detail, context, status) {
  return { code, title, message, hint, detail: appErrorSafeDetail(detail), context: context || '操作', status: status || 0 };
}

function normalizeAppError(error, context) {
  const raw = appErrorRaw(error);
  const detail = appErrorSafeDetail(raw);
  const ctx = context || '操作';
  let m = raw.match(/\bHTTP\s*(\d{3})\b(?:\s*[：:]\s*|\s+)?([\s\S]*)/i);
  const status = m ? Number(m[1]) : 0;
  const providerDetail = m && m[2] ? appErrorSafeDetail(m[2]) : detail;
  if (status === 401 || /authentication\s+fails?|unauthori[sz]ed|invalid\s+api\s*key/i.test(raw)) {
    return appErrorResult('AI_AUTH_401', 'AI 接口认证失败', '服务商拒绝了 API Key。', '请打开“API 设置”重新保存 Key，并确认 API 地址、模型和账户权限属于同一服务商。', providerDetail, ctx, 401);
  }
  if (status === 403 || /forbidden|permission\s+denied|access\s+denied/i.test(raw)) {
    return appErrorResult('AI_PERMISSION_403', 'AI 接口权限不足', '当前 Key 没有调用此模型或接口的权限。', '请检查模型名称、账户套餐、区域限制和服务商权限设置。', providerDetail, ctx, 403);
  }
  if (status === 404 || /not\s+found|不存在|找不到接口/i.test(raw)) {
    return appErrorResult('AI_ENDPOINT_404', 'AI 接口或模型不存在', '请求地址或模型名称无法在服务商处找到。', '请确认 API 地址是基础地址（通常以 /v1 结尾），并确认模型名属于该服务商。', providerDetail, ctx, 404);
  }
  if (status === 429 || /rate\s*limit|too\s*many\s*requests|quota|配额|频率/i.test(raw)) {
    return appErrorResult('AI_QUOTA_429', 'AI 请求额度或频率受限', '服务商暂时拒绝了请求，可能是达到频率限制或账户额度不足。', '请稍后重试，并检查账户余额、套餐额度和并发限制。', providerDetail, ctx, 429);
  }
  if (status >= 500 && status <= 599) {
    return appErrorResult('AI_PROVIDER_5XX', 'AI 服务暂时不可用', '服务商服务器返回了内部错误。', '请稍后重试；如果持续发生，请查看服务商状态页或更换接口。', providerDetail, ctx, status);
  }
  if (/系统安全存储|safeStorage|安全保存 API Key|API Key 安全保存/i.test(raw)) {
    return appErrorResult('SECURE_STORAGE', '安全存储不可用', '系统暂时无法安全保存 API Key。', '请重启应用后重试；如果仍失败，请确认系统用户配置和磁盘权限正常。', detail, ctx);
  }
  if (/API 地址必须|http:\/\/ 或 https:\/\//i.test(raw)) {
    return appErrorResult('AI_ENDPOINT_INVALID', 'API 地址格式不正确', 'API 地址必须以 http:// 或 https:// 开头。', '请填写服务商的基础地址，例如 https://api.openai.com/v1，不要填写完整的 /chat/completions 路径。', detail, ctx);
  }
  if (/ComfyUI/i.test(raw)) {
    if (/超时|timeout/i.test(raw)) return appErrorResult('COMFY_TIMEOUT', 'ComfyUI 生成超时', 'ComfyUI 长时间没有返回图像。', '请检查 ComfyUI 队列、模型加载状态和显存占用；也可以减少迭代次数。', detail, ctx);
    if (/JSON|工作流|节点|prompt_id/i.test(raw)) return appErrorResult('COMFY_WORKFLOW', 'ComfyUI 工作流有问题', '工作流格式、节点参数或返回结果不符合预期。', '请确认使用 API 格式工作流，并检查提示词节点、采样器和模型节点。', detail, ctx);
    return appErrorResult('COMFY_REQUEST', 'ComfyUI 请求失败', '应用无法完成与 ComfyUI 的通信。', '请确认 ComfyUI 已启动、地址正确，并允许本机访问。', detail, ctx);
  }
  if (/Failed to fetch|NetworkError|网络请求|网络错误|CORS|连接被拒绝|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(raw)) {
    return appErrorResult('NETWORK_REQUEST', '网络请求失败', '应用无法访问目标服务。', '请检查网络、API 地址、代理设置，以及本地服务是否已启动。', detail, ctx);
  }
  if (/AbortError|aborted|已停止|取消/.test(raw)) {
    return appErrorResult('REQUEST_CANCELLED', '请求已取消', '本次操作没有继续执行。', '如果不是主动取消，请重新发起请求。', detail, ctx);
  }
  if (/超时|timeout/i.test(raw)) {
    return appErrorResult('REQUEST_TIMEOUT', '请求超时', '服务在规定时间内没有返回结果。', '请检查网络和服务状态，或稍后重试；复杂任务可适当减少输入内容。', detail, ctx);
  }
  if (/未填写\s*API|API 地址|模型名|安全存储|Key 保存|API Key/i.test(raw)) {
    return appErrorResult('AI_CONFIG', 'AI 配置不完整', raw.replace(/^AI\s*/i, ''), '请打开“API 设置”，检查 API 地址、模型名和 API Key。', detail, ctx);
  }
  if (/图片|图像|image|vision|multimodal|视觉模型/i.test(raw)) {
    return appErrorResult('AI_VISION_INPUT', '图片处理失败', '当前模型或图片格式无法完成视觉处理。', '请确认选择了支持图片的视觉模型，并检查图片是否损坏或过大。', detail, ctx);
  }
  if (/本地翻译|翻译模型|translation/i.test(raw)) {
    return appErrorResult('TRANSLATION_LOCAL', '本地翻译失败', '本地翻译模型没有正常返回结果。', '请确认 models/translation 目录完整；首次加载较慢时请稍等后重试。', detail, ctx);
  }
  if (/本地识图|识图模型|推理|onnx|模型加载|Tagger/i.test(raw)) {
    return appErrorResult('VISION_LOCAL', '本地识图失败', '本地识图模型没有正常完成推理。', '请确认 models 文件夹中的模型和标签表完整，并检查图片格式。', detail, ctx);
  }
  if (/JSON|解析失败|格式不符|Unexpected token/i.test(raw)) {
    return appErrorResult('DATA_FORMAT', '数据格式不正确', '导入或读取的数据格式无法识别。', '请确认文件来自支持的格式，并检查 JSON 是否完整。', detail, ctx);
  }
  if (/localStorage|IndexedDB|配额|quota|存储|Blob/i.test(raw)) {
    return appErrorResult('STORAGE_WRITE', '本地保存失败', '浏览器本地存储空间不足或暂时不可用。', '请清理不需要的历史对话/图片后重试，并避免同时保存过大的文件。', detail, ctx);
  }
  return appErrorResult('APP_UNKNOWN', '操作失败', '程序没有完成这次操作。', '请重试；如果问题持续，请提供下面的诊断码和操作步骤。', detail, ctx, status);
}

function formatAppError(error, context, options) {
  const n = normalizeAppError(error, context);
  const opts = options || {};
  const prefix = opts.prefix ? String(opts.prefix) + ': ' : '';
  const title = typeof I18n !== 'undefined' && I18n.errorText ? I18n.errorText(n.code, 'title', n.title) : n.title;
  const message = typeof I18n !== 'undefined' && I18n.errorText ? I18n.errorText(n.code, 'message', n.message) : n.message;
  const hint = typeof I18n !== 'undefined' && I18n.errorText ? I18n.errorText(n.code, 'hint', n.hint) : n.hint;
  const diagnosticLabel = typeof I18n !== 'undefined' && I18n.t ? I18n.t('ui.common.diagnostic') : '诊断';
  const suggestionLabel = typeof I18n !== 'undefined' && I18n.t ? I18n.t('ui.common.suggestion') : '建议';
  const diagnostic = diagnosticLabel + ': ' + n.code + (n.status ? ' / HTTP ' + n.status : '') + (n.detail ? ' · ' + n.detail : '');
  const text = prefix + title + ': ' + message + (hint ? ' ' + suggestionLabel + ': ' + hint : '') + ' ' + diagnostic;
  APP_ERROR_LAST = Object.assign({}, n, { raw: appErrorRaw(error), formatted: text, at: Date.now() });
  try { console.error('[APP_ERROR]', APP_ERROR_LAST); } catch (e) {}
  try { if (typeof window !== 'undefined') window.__lastAppError = APP_ERROR_LAST; } catch (e) {}
  return text;
}

function appErrorSummary(error, context) {
  const n = normalizeAppError(error, context);
  APP_ERROR_LAST = Object.assign({}, n, { raw: appErrorRaw(error), at: Date.now() });
  try { console.error('[APP_ERROR]', APP_ERROR_LAST); } catch (e) {}
  try { if (typeof window !== 'undefined') window.__lastAppError = APP_ERROR_LAST; } catch (e) {}
  const title = typeof I18n !== 'undefined' && I18n.errorText ? I18n.errorText(n.code, 'title', n.title) : n.title;
  const message = typeof I18n !== 'undefined' && I18n.errorText ? I18n.errorText(n.code, 'message', n.message) : n.message;
  const hint = typeof I18n !== 'undefined' && I18n.errorText ? I18n.errorText(n.code, 'hint', n.hint) : n.hint;
  const suggestionLabel = typeof I18n !== 'undefined' && I18n.t ? I18n.t('ui.common.suggestion') : '建议';
  return title + ': ' + message + (hint ? ' ' + suggestionLabel + ': ' + hint : '') + ' (' + n.code + ')';
}

function appErrorDiagnostics() { return APP_ERROR_LAST ? Object.assign({}, APP_ERROR_LAST) : null; }
