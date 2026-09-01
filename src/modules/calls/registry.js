'use strict';

/**
 * 通用工具注册中心。
 *
 * 这里不包含 Tag、图片或 ComfyUI 业务，只负责把稳定的工具名称映射到
 * handler，并统一参数、权限、取消和返回格式。API AI、页面和外部 Agent
 * 都应该通过这个注册中心调用能力。
 */

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).trim();
  return result || fallback;
}

function clone(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'function' || key === 'signal') continue;
    output[key] = clone(item);
  }
  return output;
}

function errorResult(code, message, extra = {}) {
  return { ok: false, error: text(message, '工具调用失败'), code: text(code, 'TOOL_ERROR'), ...extra };
}

function normaliseResult(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.ok === 'boolean') return clone(value);
  return { ok: true, data: clone(value) };
}

const TOOL_GROUPS = Object.freeze(['runtime', 'admin', 'internal']);

function normaliseGroup(value) {
  const group = text(value, 'internal').toLowerCase();
  return TOOL_GROUPS.includes(group) ? group : 'internal';
}

function normaliseFilter(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const groups = value.groups || value.group;
  return {
    caller: text(value.caller).toLowerCase(),
    allowWrite: value.allowWrite === true,
    groups: groups == null ? null : new Set((Array.isArray(groups) ? groups : [groups]).map(item => normaliseGroup(item))),
    includeInternal: value.includeInternal === true
  };
}

function exposedToCaller(definition, filter) {
  if (filter.groups && !filter.groups.has(definition.group)) return false;
  const external = filter.caller === 'external-agent' || filter.caller === 'agent' || filter.caller === 'mcp';
  if (external && !filter.includeInternal && definition.group === 'internal') return false;
  if (external && definition.group === 'admin' && !filter.allowWrite) return false;
  if (definition.permission === 'write' && external && !filter.allowWrite) return false;
  return true;
}

function createToolRegistry(options = {}) {
  const tools = new Map();
  const aliases = new Map();

  function register(definition = {}) {
    const name = text(definition.name);
    if (!name) throw new Error('工具缺少名称');
    if (typeof definition.handler !== 'function') throw new Error(`工具 ${name} 缺少 handler`);
    if (tools.has(name)) throw new Error(`工具已注册：${name}`);
    const definitionCopy = {
      name,
      description: text(definition.description, name),
      permission: definition.permission === 'write' ? 'write' : 'read',
      group: normaliseGroup(definition.group),
      inputSchema: definition.inputSchema && typeof definition.inputSchema === 'object'
        ? clone(definition.inputSchema)
        : { type: 'object', properties: {} },
      handler: definition.handler
    };
    tools.set(name, definitionCopy);
    const wireName = text(definition.wireName, name.replace(/[^a-zA-Z0-9_-]/g, '_'));
    aliases.set(wireName, name);
    aliases.set(wireName.toLowerCase(), name);
    aliases.set(wireName.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase(), name);
    aliases.set(name.toLowerCase(), name);
    if (Array.isArray(definition.aliases)) definition.aliases.forEach(alias => aliases.set(text(alias), name));
    return publicDefinition(definitionCopy, wireName);
  }

  function publicDefinition(definition, wireName) {
    return {
      name: definition.name,
      wireName: wireName || definition.name.replace(/[^a-zA-Z0-9_-]/g, '_'),
      description: definition.description,
      permission: definition.permission,
      group: definition.group,
      inputSchema: clone(definition.inputSchema)
    };
  }

  function resolve(name) {
    const key = text(name);
    return tools.get(key) || tools.get(aliases.get(key)) || tools.get(aliases.get(key.toLowerCase())) || null;
  }

  function list(names = null, options = {}) {
    // Keep the compact list(names) API while allowing callers (notably the
    // local Agent server) to request only the groups they are authorised to
    // see. An object as the first argument is treated as the filter.
    if (names && !Array.isArray(names) && typeof names === 'object') {
      options = names;
      names = null;
    }
    const filter = normaliseFilter(options);
    const selected = Array.isArray(names) && names.length
      ? names.map(name => resolve(name)).filter(Boolean)
      : [...tools.values()];
    return selected.filter(definition => exposedToCaller(definition, filter)).map(definition => publicDefinition(definition));
  }

  function schemas(names = null, options = {}) {
    return list(names, options).map(definition => ({
      name: definition.name,
      description: definition.description,
      permission: definition.permission,
      group: definition.group,
      inputSchema: clone(definition.inputSchema)
    }));
  }

  function openAiTools(names = null, options = {}) {
    return list(names, options).map(definition => ({
      type: 'function',
      function: {
        name: definition.wireName,
        description: definition.description,
        parameters: clone(definition.inputSchema)
      }
    }));
  }

  async function call(name, argumentsValue = {}, context = {}) {
    const definition = resolve(name);
    if (!definition) return errorResult('UNKNOWN_TOOL', `未找到工具：${text(name)}`);
    const filter = normaliseFilter(context);
    if (!exposedToCaller(definition, filter)) {
      if (filter.caller === 'external-agent' || filter.caller === 'agent' || filter.caller === 'mcp') {
        return errorResult('PERMISSION_DENIED', `当前 Agent 权限下不可用：${definition.name}`);
      }
    }
    const args = argumentsValue && typeof argumentsValue === 'object' ? argumentsValue : {};
    const allowWrite = context.allowWrite === true || options.allowWrite === true;
    if (definition.permission === 'write' && !allowWrite) return errorResult('PERMISSION_DENIED', `工具需要编辑权限：${definition.name}`);
    if (context.signal?.aborted) return errorResult('CANCELLED', '工具调用已停止');
    try {
      const result = await definition.handler(args, context);
      return normaliseResult(result);
    } catch (error) {
      if (context.signal?.aborted || error?.code === 'CANCELLED') return errorResult('CANCELLED', '工具调用已停止');
      return errorResult(error?.code || 'TOOL_ERROR', error?.message || String(error || '工具调用失败'));
    }
  }

  function has(name) { return Boolean(resolve(name)); }

  return { register, resolve, list, schemas, openAiTools, call, has, clone, groups: TOOL_GROUPS };
}

module.exports = { TOOL_GROUPS, createToolRegistry, errorResult, normaliseResult };
