'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { id: validId } = require('./data.js');
function createFileAdapter({ 根目录 } = {}) {
  if (typeof 根目录 !== 'string' || !根目录) throw new Error('根目录 必须是字符串');
  const root = path.resolve(根目录);
  const file = (id) => {
    if (!validId(id, 's')) throw new Error('会话 ID 不合法');
    return path.join(root, id + '.json');
  };
  return Object.freeze({
    list() {
      try {
        return {
          ok: true,
          ids: fs
            .readdirSync(root, { withFileTypes: true })
            .filter(
              (e) => e.isFile() && e.name.endsWith('.json') && validId(e.name.slice(0, -5), 's'),
            )
            .map((e) => e.name.slice(0, -5)),
        };
      } catch (e) {
        return e.code === 'ENOENT' ? { ok: true, ids: [] } : { ok: false, reason: e.message };
      }
    },
    read(id) {
      try {
        return { state: 'ok', value: JSON.parse(fs.readFileSync(file(id), 'utf8')) };
      } catch (e) {
        return e.code === 'ENOENT'
          ? { state: 'missing' }
          : { state: 'unreadable', reason: e.message };
      }
    },
    async write(id, value) {
      let temp;
      try {
        const target = file(id);
        const text = JSON.stringify(structuredClone(value), null, 2);
        await fs.promises.mkdir(root, { recursive: true });
        temp = path.join(root, `.${id}.${randomUUID()}.tmp`);
        await fs.promises.writeFile(temp, text, { flag: 'wx' });
        await fs.promises.rename(temp, target);
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e.message };
      } finally {
        if (temp) await fs.promises.unlink(temp).catch(() => {});
      }
    },
    async remove(id) {
      try {
        await fs.promises.unlink(file(id));
        return { ok: true };
      } catch (e) {
        return e.code === 'ENOENT' ? { ok: true } : { ok: false, reason: e.message };
      }
    },
  });
}
module.exports = { createFileAdapter };
