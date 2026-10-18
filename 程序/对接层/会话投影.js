export const 缺图文字 = (_id, reason) => `对话图片不可用：${reason}`;

function isImageMarker(value) {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) &&
    value.type === 'session-image' && typeof value.imageId === 'string' &&
    Object.keys(value).every((key) => ['type', 'imageId'].includes(key)),
  );
}

function isMissingImageMarker(value) {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) &&
    value.type === 'session-image' && value.imageId === null &&
    value.missing && typeof value.missing.originalId === 'string' &&
    typeof value.missing.reason === 'string' &&
    Object.keys(value).every((key) => ['type', 'imageId', 'missing'].includes(key)),
  );
}

function visitMarkers(value, visit) {
  if (isImageMarker(value) || isMissingImageMarker(value)) {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitMarkers(item, visit);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) visitMarkers(item, visit);
  }
}

function 清理绘画回执(value) {
  if (Array.isArray(value)) return value.map(清理绘画回执);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['生成状态', '生成设置', '参数', '工作流', 'graph', 'node_errors', '节点错误', '节点错误表', '每轮张数', '最多轮数', '自动迭代', '已用轮数', '剩余轮数'].includes(key))
    .map(([key, item]) => [key, 清理绘画回执(item)]));
}

export function 清理模型绘画回执(name, value) {
  if (!['drawing_info', 'drawing_generate'].includes(name) || !value || typeof value !== 'object') return value;
  const code = typeof value.code === 'string' ? value.code : '';
  if (/^(?:COMFY_|GRAPH_)/.test(code))
    return { ok: false, code, reason: `${code}: 生图无法完成` };
  const quota = code === 'BUSINESS_GENERATION_LIMIT' || /最多\s*\d+\s*轮|已用\s*\d+\s*轮|剩余\s*\d+\s*轮|轮数已用完/.test(String(value.reason || ''));
  if (name === 'drawing_generate' && quota)
    return { ok: false, code: code || 'BUSINESS_GENERATION_LIMIT', reason: `${code || 'BUSINESS_GENERATION_LIMIT'}: 当前无法继续生成；可继续查看图片和回复` };
  if (name === 'drawing_info' && value.ok === true && value.data && typeof value.data === 'object') {
    const allowed = ['启用', '已配置', '正向提示词', '负向提示词', '参考图', '批量张数'];
    return { ok: true, data: Object.fromEntries(allowed.filter(key => Object.hasOwn(value.data, key)).map(key => [key, value.data[key]])) };
  }
  if (name === 'drawing_info' && value.ok !== false && typeof value === 'object') {
    const allowed = ['启用', '已配置', '正向提示词', '负向提示词', '参考图', '批量张数'];
    return Object.fromEntries(allowed.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
  }
  if (value.ok === false || code || typeof value.reason === 'string') return value;
  return 清理绘画回执(value);
}

function 清理绘画参数(name, args) {
  if (name === 'drawing_info') return '{}';
  if (name !== 'drawing_generate' || typeof args !== 'string') return args;
  try {
    const parsed = JSON.parse(args);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return args;
    return JSON.stringify(Object.fromEntries(['正向', '负向', '参考图']
      .filter(key => Object.hasOwn(parsed, key)).map(key => [key, parsed[key]])));
  } catch { return '{}'; }
}

export async function 投影会话(session, readImage, { 业务工具名, 列图片, 图片清单 } = {}) {
  const allowed = 业务工具名 instanceof Set ? 业务工具名 : null;
  const numbered = 图片清单 || (列图片 ? await 列图片(session.id) : null);
  const numberById = new Map(
    (numbered?.ok ? numbered.data.images : []).map((image) => [image.id, image.number]),
  );

  async function projectPart(part) {
    if (part.type === 'text') return [{ type: 'text', text: part.text }];
    if (part.imageId === null)
      return [{ type: 'text', text: 缺图文字(part.missing.originalId, part.missing.reason) }];
    const result = readImage(session.id, part.imageId);
    if (!result.ok) return [{ type: 'text', text: 缺图文字(part.imageId, result.reason) }];
    const number = result.data.number ?? numberById.get(part.imageId);
    return [
      ...(number === undefined ? [] : [{ type: 'text', text: `图${number}` }]),
      {
        type: 'image',
        data: Buffer.from(result.data.bytes).toString('base64'),
        mimeType: result.data.mime,
      },
    ];
  }

  const messages = [];
  for (const message of session.messages) {
    if (message.role === 'user') {
      if (message.context) messages.push({ role: 'user', content: message.context });
      const content = [];
      for (const part of message.parts) content.push(...(await projectPart(part)));
      if (content.length) messages.push({ role: 'user', content });
      continue;
    }

    const calls = allowed
      ? message.toolCalls.filter((call) => allowed.has(call.name))
      : message.toolCalls;
    const body = [];
    for (const part of message.parts) {
      if (part.type === 'text') body.push(part.text);
      else if (part.imageId === null) body.push(缺图文字(part.missing.originalId, part.missing.reason));
      else {
        const number = numberById.get(part.imageId);
        body.push(number === undefined ? '图片产物' : `图片产物 图${number}`);
      }
    }
    const row = {
      role: 'assistant',
      content: body.join('\n'),
      ...(message.reasoning ? { reasoning_content: message.reasoning } : {}),
    };
    if (calls.length)
      row.tool_calls = calls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: ['drawing_info', 'drawing_generate'].includes(call.name)
          ? 清理绘画参数(call.name, call.args) : call.args },
      }));
    if (row.content || row.reasoning_content || calls.length) messages.push(row);

    const resultImages = [];
    for (const call of calls) {
      if (['pending', 'running'].includes(call.status)) continue;
      const projectedResult = 清理模型绘画回执(call.name, structuredClone(call.result));
      const markers = [];
      visitMarkers(projectedResult, (marker) => markers.push(marker));
      const callImages = [];
      for (const marker of markers) {
        if (isMissingImageMarker(marker)) {
          const { originalId, reason } = marker.missing;
          const projectedImage = {
            type: 'text',
            text: 缺图文字(originalId, reason),
            missing: true,
          };
          callImages.push(projectedImage);
          resultImages.push(projectedImage);
          continue;
        }
        const image = readImage(session.id, marker.imageId);
        const number = image.ok ? image.data.number ?? numberById.get(marker.imageId) : undefined;
        const projectedImage = image.ok
            ? {
                type: 'image',
                number,
                data: Buffer.from(image.data.bytes).toString('base64'),
                mimeType: image.data.mime,
                missing: null,
              }
            : { type: 'text', number, text: 缺图文字(marker.imageId, image.reason), missing: true };
        callImages.push(projectedImage);
        resultImages.push(projectedImage);
      }
      let imageIndex = 0;
      const replace = (value) => {
        if (isImageMarker(value) || isMissingImageMarker(value)) {
          const image = callImages[imageIndex++];
          return image?.missing
            ? { 图片: image.text }
            : { 图片: image?.number === undefined ? '图像产物' : `图${image.number}` };
        }
        if (Array.isArray(value)) return value.map(replace);
        if (value && typeof value === 'object')
          return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
        return value;
      };
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(replace(projectedResult)),
      });
    }
    if (resultImages.length) {
      const content = [];
      for (const image of resultImages) {
        if (image.missing) content.push({ type: 'text', text: image.text });
        else {
          if (image.number !== undefined) content.push({ type: 'text', text: `图${image.number}` });
          content.push({ type: 'image', data: image.data, mimeType: image.mimeType });
        }
      }
      messages.push({ role: 'user', content });
    }
  }
  return messages;
}
