'use strict';

function text(value) { return value == null ? '' : String(value); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function pathJoin(path, key) { return path ? `${path}.${key}` : String(key); }

function failure(path, message) {
  const error = new Error(`${path || '值'}${message ? ` ${message}` : ' 无效'}`);
  error.code = 'SCHEMA_INVALID';
  error.path = path || '';
  return error;
}

function validateValue(schema, value, path = '') {
  if (!schema || typeof schema !== 'object') return;
  if (schema.nullable && value == null) return;
  if (value == null) throw failure(path, '不能为空');
  switch (schema.type) {
    case 'object': {
      if (!object(value)) throw failure(path, '必须是对象');
      for (const key of schema.required || []) if (value[key] === undefined || value[key] === null) throw failure(pathJoin(path, key), '为必填项');
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(schema.properties || {}, key)) throw failure(pathJoin(path, key), '不是允许的字段');
      }
      for (const [key, child] of Object.entries(schema.properties || {})) if (value[key] !== undefined) validateValue(child, value[key], pathJoin(path, key));
      break;
    }
    case 'array':
      if (!Array.isArray(value)) throw failure(path, '必须是数组');
      if (schema.minItems != null && value.length < schema.minItems) throw failure(path, `至少需要 ${schema.minItems} 项`);
      if (schema.maxItems != null && value.length > schema.maxItems) throw failure(path, `最多允许 ${schema.maxItems} 项`);
      value.forEach((item, index) => validateValue(schema.items || {}, item, `${path}[${index}]`));
      break;
    case 'string':
      if (typeof value !== 'string') throw failure(path, '必须是字符串');
      if (schema.minLength != null && value.length < schema.minLength) throw failure(path, `长度不能少于 ${schema.minLength}`);
      if (schema.maxLength != null && value.length > schema.maxLength) throw failure(path, `长度不能超过 ${schema.maxLength}`);
      if (schema.pattern && !(new RegExp(schema.pattern).test(value))) throw failure(path, '格式无效');
      break;
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) throw failure(path, '必须是数字');
      if (schema.minimum != null && value < schema.minimum) throw failure(path, `不能小于 ${schema.minimum}`);
      if (schema.maximum != null && value > schema.maximum) throw failure(path, `不能大于 ${schema.maximum}`);
      break;
    case 'boolean': if (typeof value !== 'boolean') throw failure(path, '必须是布尔值'); break;
    case 'null': if (value !== null) throw failure(path, '必须为空'); break;
    default: break;
  }
  if (schema.enum && !schema.enum.some(item => Object.is(item, value))) throw failure(path, '取值无效');
}

function validate(schema, value) {
  try { validateValue(schema, value); return { ok: true, data: value, error: null }; }
  catch (error) { return { ok: false, data: null, error: { code: error.code || 'SCHEMA_INVALID', message: error.message, path: error.path || '' } }; }
}
function assertValid(schema, value) { const result = validate(schema, value); if (!result.ok) { const error = new Error(result.error.message); error.code = result.error.code; error.path = result.error.path; throw error; } return value; }
function isValid(schema, value) { return validate(schema, value).ok; }

module.exports = { validate, validateValue, assertValid, isValid };
