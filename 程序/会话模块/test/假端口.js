'use strict';
const { randomUUID } = require('node:crypto');
const ok = (data) => ({ ok: true, data });
function images() {
  const pools = new Map(),
    highWater = new Map(),
    gallery = new Map();
  const pool = (id) => {
    if (!pools.has(id)) pools.set(id, new Map());
    return pools.get(id);
  };
  const highest = (id) => highWater.get(id) || 0;
  const allocate = (id, image) => {
    if (image.number === undefined) image.number = highest(id) + 1;
    highWater.set(id, Math.max(highest(id), image.number));
  };
  return {
    gallery,
    list: (id) => ok({ ids: [...pool(id).keys()] }),
    listNumbered: async (id) => {
      for (const image of pool(id).values()) allocate(id, image);
      return ok({
        images: [...pool(id)].map(([imageId, image]) => ({ id: imageId, number: image.number })),
        highWater: highest(id),
      });
    },
    read: (id, imageId) =>
      pool(id).has(imageId)
        ? ok(structuredClone(pool(id).get(imageId)))
        : { ok: false, code: 'IMAGE_NOT_FOUND', reason: 'IMAGE_NOT_FOUND: 图片已删除' },
    write: async (id, payload) => {
      const copy = structuredClone(payload);
      allocate(id, copy);
      const imageId = 'img_' + randomUUID();
      pool(id).set(imageId, copy);
      return ok({ id: imageId });
    },
    restoreNumbering: async (id, { highWater: value }) => {
      highWater.set(id, Math.max(highest(id), value));
      return ok({ highWater: highest(id) });
    },
    copyToGallery: async (id, imageId) => {
      const r = pool(id).get(imageId);
      const newId = 'img_' + randomUUID();
      gallery.set(newId, structuredClone(r));
      return ok({ 作用域: { 存放地: 'gallery' }, 条目ID: newId });
    },
    clear: async (id) => {
      pool(id).clear();
      return ok({ 已删: true });
    },
    delete: (id, imageId) => pool(id).delete(imageId),
  };
}
const payload = () => ({
  bytes: Uint8Array.from([1, 2, 3]),
  filename: 'a.png',
  displayName: '原图',
  mime: 'image/png',
  width: 2,
  height: 3,
  metadata: { 原文: '保留' },
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
module.exports = { images, payload, deferred };
