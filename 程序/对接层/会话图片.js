const scope = (sessionId) => ({ 存放地: 'session', 会话ID: sessionId });
const reference = (sessionId, imageId) => ({ 作用域: scope(sessionId), 条目ID: imageId });
const ok = (data) => ({ ok: true, data });
export function 造会话图片({ 图片门面 }) {
  function read(sessionId, imageId) {
    const 引用 = reference(sessionId, imageId),
      details = 图片门面.run('取详情', { 引用 });
    if (!details.ok) return details;
    const original = 图片门面.run('取内容', { 引用, 变体: 'original' });
    if (!original.ok) return original;
    const d = details.data;
    return ok({
      bytes: original.data.字节,
      filename: d.文件名,
      displayName: d.显示名,
      mime: d.mime,
      width: d.宽,
      height: d.高,
      metadata: d.元数据,
      number: d.图号,
    });
  }
  async function store(作用域, payload, 来源) {
    return await 图片门面.run('存', {
      作用域,
      字节: payload.bytes,
      文件名: payload.filename,
      显示名: payload.displayName,
      mime: payload.mime,
      宽: payload.width,
      高: payload.height,
      元数据: payload.metadata,
      来源,
    });
  }
  return Object.freeze({
    list(sessionId) {
      const r = 图片门面.run('列', { 作用域: scope(sessionId) });
      return r.ok ? ok({ ids: r.data.条目.map((item) => item.标识) }) : r;
    },
    async listNumbered(sessionId) {
      const r = await 图片门面.run('列会话图', { 作用域: scope(sessionId) });
      return r.ok ? ok({ images: r.data.条目.map((item) => ({
        id: item.标识,
        number: item.图号,
        displayName: item.显示名,
        filename: item.文件名,
      })), highWater: r.data.高水位 }) : r;
    },
    read,
    async write(sessionId, payload) {
      const r = payload.number === undefined
        ? await store(scope(sessionId), payload, 'import')
        : await 图片门面.run('导入会话图', {
          作用域: scope(sessionId),
          图号: payload.number,
          字节: payload.bytes,
          文件名: payload.filename,
          显示名: payload.displayName,
          mime: payload.mime,
          宽: payload.width,
          高: payload.height,
          元数据: payload.metadata,
          来源: 'import',
        });
      return r.ok ? ok({ id: r.data.标识 }) : r;
    },
    async restoreNumbering(sessionId, payload) {
      const r = await 图片门面.run('恢复会话图号', {
        作用域: scope(sessionId),
        高水位: payload.highWater,
      });
      return r.ok ? ok({ highWater: r.data.高水位 }) : r;
    },
    async copyToGallery(sessionId, imageId) {
      const r = read(sessionId, imageId);
      if (!r.ok) return r;
      const stored = await store({ 存放地: 'gallery' }, r.data, 'copy');
      return stored.ok ? ok(stored.data.引用) : stored;
    },
    clear: (sessionId) => 图片门面.run('清空', { 作用域: scope(sessionId) }),
  });
}
