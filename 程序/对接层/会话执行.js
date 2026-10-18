import { 会话图片说明 } from './工具定义.js';
import { 组系统素材, 组工具素材 } from './发送素材.js';
import { 造绘画业务, 导出绘画工具表 } from './绘画业务.js';
import { 造会话图片 } from './会话图片.js';
import { 投影会话 } from './会话投影.js';

const stopped = () => ({
  ok: false,
  code: 'SESSION_STOPPED',
  reason: 'SESSION_STOPPED: 用户或宿主请求停止',
});
const failure = (error) => {
  const extras = Object.fromEntries(
    Object.entries(error || {}).filter(([key]) => !['ok', 'code', 'reason', 'details'].includes(key)),
  );
  const code = error.code || 'TOOL_MODULE_FAILED';
  return {
    ...extras,
    ok: false,
    code,
    reason: error.reason || `${code}: ${error.message || String(error)}`,
    ...(error.details === undefined ? {} : { details: structuredClone(error.details) }),
  };
};

export function 造图片回执({ 图片门面, sessionId }) {
  return async function format(value, { moduleKey, action, parameters }) {
    let firstError;
    async function walk(item, parent = {}) {
      if (Buffer.isBuffer(item) || item instanceof Uint8Array) {
        if (!/^image\//.test(parent.mime || '')) return { type: 'Buffer', data: [...item] };
        if (firstError) return structuredClone(firstError);
        const ref = parameters?.引用;
        if (
          moduleKey === 'image' && action === '取内容' &&
          ref?.作用域?.存放地 === 'session' && ref.作用域.会话ID === sessionId
        ) return { type: 'session-image', imageId: ref.条目ID };
        const saved = await 图片门面.run('存', {
          作用域: { 存放地: 'session', 会话ID: sessionId },
          字节: item,
          文件名: parent.文件名 === undefined ? '工具图片' : parent.文件名,
          mime: parent.mime,
          显示名: parent.显示名,
          元数据: parent.元数据 === undefined ? {} : parent.元数据,
          宽: parent.宽 === undefined ? 0 : parent.宽,
          高: parent.高 === undefined ? 0 : parent.高,
          来源: '工具结果',
        });
        if (!saved.ok) {
          firstError = structuredClone(saved);
          return structuredClone(saved);
        }
        return { type: 'session-image', imageId: saved.data.标识 };
      }
      if (Array.isArray(item)) {
        const result = [];
        for (const child of item) result.push(await walk(child, parent));
        return result;
      }
      if (item && typeof item === 'object') {
        const result = {}, context = { ...parent, ...item };
        for (const [key, child] of Object.entries(item)) result[key] = await walk(child, context);
        return result;
      }
      return item === undefined ? null : item;
    }
    const result = await walk(value);
    if (firstError) {
      const error = new Error(firstError.reason);
      Object.assign(error, firstError, {
        details: {
          ...(firstError.details === undefined ? {} : { 来源详情: firstError.details }),
          阶段: '回执图片落盘',
          业务结果: result,
        },
      });
      throw error;
    }
    return result;
  };
}

export function 造会话执行({ 门面, 服务商, onGenerationState }) {
  const imagePort = 造会话图片({ 图片门面: 门面.image });
  const allNames = new Set(导出绘画工具表().map((tool) => tool.名字));
  async function executeTurn({ sessionId, inputMessageId, signal, read, commit, notify, 提问 }) {
    if (signal.aborted) return stopped();
    const presetResult = 门面.主AI.run('执行', { 请求: '主AI' });
    if (!presetResult.ok) return presetResult;
    const preset = presetResult.data;
    const input = read().messages.find((message) => message.id === inputMessageId);
    const text = input.parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    const worldResult = 门面.worldbook.run('执行', { 请求: '主AI', 文本: text });
    if (!worldResult.ok) return worldResult;
    const hits = worldResult.data.命中;
    const depth = 组系统素材({ 命中: hits }).深度消息;
    if (depth) {
      const result = await commit({ kind: 'context', text: depth });
      if (!result.ok) return result;
    }
    const drawing = 造绘画业务({
      门面,
      sessionId,
      提问: (prompt, questionSignal) => 提问.ask(prompt, questionSignal),
      signal,
      onGenerationState: state => {
        onGenerationState?.(sessionId, state);
        notify?.();
      },
    });
    const selectedRows = Array.isArray(preset.工具表) ? preset.工具表 : [];
    const toolMaterials = 组工具素材(selectedRows, drawing.工具表);
    if (!toolMaterials.ok) return toolMaterials;
    const definitions = toolMaterials.定义行.map(definition => ({
      ...definition,
      execute: (args) => drawing.执行(definition.name, args),
    }));
    const tools = toolMaterials.工具定义;
    if (definitions.some(tool => tool.name === 'drawing_generate' || tool.name === 'drawing_info')) {
      const ready = await drawing.准备();
      if (!ready.ok) return ready;
    }
    const formatReceipt = 造图片回执({ 图片门面: 门面.image, sessionId });
    let request;
    try {
      request = 服务商.固定请求({ 请求: preset.模型?.走, 模型: preset.模型?.模型 });
    } catch (error) {
      if (error.code) return failure(error);
      throw error;
    }

    while (true) {
      if (signal.aborted) return stopped();
      const numbered = await imagePort.listNumbered(sessionId);
      if (!numbered.ok) return numbered;
      const images = numbered.data.images;
      const imageInfo = 会话图片说明(images, preset.附加文本);
      const system = 组系统素材({ 命中: hits, 图片说明: imageInfo }).系统消息;
      let answer;
      try {
        answer = await request({
          messages: await 投影会话(read(), imagePort.read, {
            业务工具名: allNames,
            图片清单: numbered,
          }),
          system,
          工具: tools,
          信号: signal,
        });
      } catch (error) {
        if (signal.aborted) return stopped();
        if (error.code) return failure(error);
        throw error;
      }
      const message = answer.消息;
      const declared = await commit({
        kind: 'message',
        parts: answer.正文 ? [{ type: 'text', text: answer.正文 }] : [],
        reasoning: message.reasoning_content || '',
        toolCalls: (message.tool_calls || []).map((call) => ({
          id: call.id,
          name: call.function.name,
          args: call.function.arguments,
        })),
        model: answer.用的谁,
      });
      if (!declared.ok) return declared;
      for (const call of message.tool_calls || []) {
        if (signal.aborted) return stopped();
        const started = await commit({ kind: 'tool', messageId: declared.data.消息ID, callId: call.id, status: 'running' });
        if (!started.ok) return started;
        const definition = definitions.find((item) => item.name === call.function.name);
        let args, result, status = 'complete';
        try {
          try { args = JSON.parse(call.function.arguments); }
          catch { result = { ok: false, code: 'TOOL_BAD_ARGUMENT', reason: 'TOOL_BAD_ARGUMENT: 参数不是 JSON 对象' }; }
          if (!result && (!args || typeof args !== 'object' || Array.isArray(args)))
            result = { ok: false, code: 'TOOL_BAD_ARGUMENT', reason: 'TOOL_BAD_ARGUMENT: 参数不是 JSON 对象' };
          if (!result && !definition)
            result = { ok: false, code: 'TOOL_BAD_TOOL_NAME', reason: `TOOL_BAD_TOOL_NAME: 没有启用工具 ${call.function.name}` };
          if (!result) result = await definition.execute(args);
          if (signal.aborted && result?.code !== 'BUSINESS_CANCELLED') return stopped();
          if (result?.ok === false) {
            status = 'error';
          } else {
            const value = result?.ok === true && Object.hasOwn(result, 'data') ? result.data : result;
            result = await formatReceipt(value, { moduleKey: 'business', action: call.function.name, parameters: args });
          }
        } catch (error) {
          result = failure(error);
          status = 'error';
        }
        const completed = await commit({
          kind: 'tool', messageId: declared.data.消息ID, callId: call.id, status, result,
        });
        if (!completed.ok) return completed;
        if (result?.code === 'BUSINESS_CANCELLED') return stopped();
      }
      if (signal.aborted) return stopped();
      if (!message.tool_calls?.length) return { ok: true };
    }
  }
  return async function execute(args) {
    try { return await executeTurn(args); }
    finally { onGenerationState?.(args.sessionId, null); }
  };
}
