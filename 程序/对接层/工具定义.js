/** 复制 JSON schema，并把项目用的 required 标记换成标准 required 数组。 */
function schema副本(源) {
  if (!源 || typeof 源 !== 'object' || Array.isArray(源)) return { type: 'string' };
  const 出 = structuredClone(源);
  delete 出.required;

  if (源.properties && typeof 源.properties === 'object' && !Array.isArray(源.properties)) {
    出.properties = {};
    const 必填 = new Set(Array.isArray(源.required) ? 源.required : []);
    for (const [名, 项] of Object.entries(源.properties)) {
      if (项 && 项.required === true) 必填.add(名);
      出.properties[名] = schema副本(项);
    }
    if (必填.size) 出.required = [...必填];
  }
  if (源.items && typeof 源.items === 'object') 出.items = schema副本(源.items);
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(源[key])) 出[key] = 源[key].map(schema副本);
  }
  if (源.additionalProperties && typeof 源.additionalProperties === 'object') {
    出.additionalProperties = schema副本(源.additionalProperties);
  }
  return 出;
}

/** 业务工具表条目 → DSH 的工具声明。 */
export const 默认附加文本 = Object.freeze({
  图片标题: '当前对话图片：',
  图片条目: '图{图号}：{名称}',
  无图片: '当前对话没有图片。',
});

export function 工具声明(一条) {
  const 名字 = String(一条?.名字 || '').trim();
  const 源参数 = 一条?.参数 && typeof 一条.参数 === 'object' ? 一条.参数 : {};
  const 说明 = 一条?.说明 && typeof 一条.说明 === 'object' ? 一条.说明 : {};
  const properties = {};
  const required = [];

  for (const [名, 原] of Object.entries(源参数)) {
    const schema = schema副本(原);
    const 用户说明 = 说明[名];
    if (typeof 用户说明 === 'string') schema.description = 用户说明;
    if (原?.required === true) required.push(名);
    properties[名] = schema;
  }

  const 行 = Object.entries(properties)
    .filter(([, schema]) => typeof schema.description === 'string' && schema.description)
    .map(([名, schema]) => `${名}：${schema.description}`);
  const 摘要 = typeof 一条?.摘要 === 'string' ? 一条.摘要 : '';
  const description = [摘要, ...行].filter(文本 => 文本 !== '').join('\n');

  return {
    name: 名字,
    description,
    parameters: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: true },
  };
}

/** 登记定义 → Chat Completions 的工具声明。 */
export function 模型工具(def) {
  return {
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: structuredClone(def.parameters),
    },
  };
}

/** 当前会话的编号图片 → 系统消息中的图片说明。 */
export function 会话图片说明(images, overrides = {}) {
  const 文本 = { ...默认附加文本, ...overrides };
  return images.length
    ? `${文本.图片标题}${文本.图片标题 ? '\n' : ''}${images.map(image => 文本.图片条目.replaceAll('{图号}', image.number).replaceAll('{名称}', image.displayName || image.filename)).join('\n')}`
    : 文本.无图片;
}

