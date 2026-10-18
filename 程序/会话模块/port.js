'use strict';
const STORAGE = Object.freeze(['list', 'read', 'write', 'remove']);
const IMAGES = Object.freeze(['list', 'listNumbered', 'read', 'write', 'restoreNumbering', 'copyToGallery', 'clear']);
function check(options) {
  for (const [name, methods] of [
    ['port', STORAGE],
    ['图片', IMAGES],
  ]) {
    for (const method of methods)
      if (typeof options[name]?.[method] !== 'function')
        throw new Error(`${name}.${method} 必须是函数`);
  }
  for (const name of ['执行', '新标识', '现在'])
    if (options[name] !== undefined && typeof options[name] !== 'function')
      throw new Error(`${name} 必须是函数`);
}
module.exports = { check };
