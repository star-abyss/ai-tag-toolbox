/* ================= 存储层单点（localStorage 收敛 + IndexedDB 大对象） ================= */
'use strict';
var STORAGE_VERSION = 2;
var STORAGE_STATE = { version: STORAGE_VERSION, lastError: '', lastKey: '', writes: 0, failures: 0 };
function storageGet(k, fb) {
  try {
    const v = window.localStorage.getItem(k);
    return v === null || v === undefined ? fb : v;
  } catch (e) { STORAGE_STATE.lastError = String(e && e.message || e); STORAGE_STATE.lastKey = k; return fb; }
}
function storageSet(k, value) {
  try {
    window.localStorage.setItem(k, String(value));
    STORAGE_STATE.writes++;
    STORAGE_STATE.lastError = '';
    STORAGE_STATE.lastKey = k;
    return true;
  } catch (e) {
    STORAGE_STATE.failures++;
    STORAGE_STATE.lastError = String(e && e.message || e);
    STORAGE_STATE.lastKey = k;
    // 保留最近一次失败值到内存，便于诊断与后续迁移提示；不伪装成已持久化。
    return false;
  }
}
function storageRemove(k) {
  try { window.localStorage.removeItem(k); return true; }
  catch (e) { STORAGE_STATE.lastError = String(e && e.message || e); STORAGE_STATE.lastKey = k; return false; }
}
// 读取 JSON（兼容旧签名 loadJSON(key, fallback)）
function loadJSON(k, fb) {
  try {
    const raw = storageGet(k, null);
    if (raw === null || raw === undefined) return fb;
    const v = JSON.parse(raw);
    return v === null || v === undefined ? fb : v;
  } catch (e) { STORAGE_STATE.lastError = String(e && e.message || e); STORAGE_STATE.lastKey = k; return fb; }
}
// 写入 JSON；成功返回 true（配额不足返回 false）
function saveJSON(k, v) {
  // 防御性清理：即使旧调用方误把 key 放入 AI 配置，也不再写回明文。
  let value = v;
  if (k === 'dbt_ai_v2' && v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'key')) {
    value = Object.assign({}, v); delete value.key;
  }
  try { return storageSet(k, JSON.stringify(value)); }
  catch (e) { STORAGE_STATE.lastError = String(e && e.message || e); STORAGE_STATE.lastKey = k; STORAGE_STATE.failures++; return false; }
}
// 仅统计 localStorage 的近似占用，供后续阈值提示和迁移策略使用。
function storageUsage() {
  let bytes = 0, keys = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = window.localStorage.key(i) || '';
      const v = storageGet(k, '') || '';
      bytes += (k.length + v.length) * 2; // UTF-16 近似值
      keys++;
    }
  } catch (e) {}
  return { bytes, keys, mb: Math.round(bytes / 1024 / 1024 * 100) / 100 };
}
function storageDiagnostics() {
  const usage = storageUsage();
  return { version: STORAGE_STATE.version, usage, lastError: STORAGE_STATE.lastError, lastKey: STORAGE_STATE.lastKey, writes: STORAGE_STATE.writes, failures: STORAGE_STATE.failures };
}
// 轻量迁移标记：不改变旧数据，只记录当前存储层已接管。
(function markStorageVersion() {
  const old = parseInt(storageGet('dbt_storage_version', '0'), 10) || 0;
  if (old < STORAGE_VERSION) storageSet('dbt_storage_version', String(STORAGE_VERSION));
})();
// IndexedDB：用于大对象（会话图片等），避免撑爆 localStorage
var IDB = {
  db: null,
  open: function () {
    return new Promise((res, rej) => {
      if (this.db) { res(this.db); return; }
      let r;
      try { r = indexedDB.open('dbt_kv', 1); } catch (e) { rej(e); return; }
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); };
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  put: async function (k, v) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(v, k);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  },
  get: async function (k) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const rq = db.transaction('kv', 'readonly').objectStore('kv').get(k);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  },
  del: async function (k) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(k);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
};

/* ================= 图片仓库（Blob + 引用） =================
 * 消息运行时仍保留 imgs Data URL，保证旧业务代码和视觉 API 兼容；
 * 持久化时只写 imageIds，原图以 Blob 放入 IndexedDB，避免 localStorage 膨胀。
 */
var ImageStore = {
  prefix: 'dbt_image_',
  id: function () { return Date.now() + '_' + Math.random().toString(36).slice(2, 9); },
  dataUrlBlob: function (dataUrl) {
    const raw = String(dataUrl || '');
    const m = raw.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i);
    if (!m) return null;
    const mime = m[1] || 'application/octet-stream';
    if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type: mime });
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  },
  blobDataUrl: function (blob) {
    return new Promise(function (resolve) {
      const fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { resolve(''); };
      fr.readAsDataURL(blob);
    });
  },
  put: async function (id, dataUrl) {
    const blob = this.dataUrlBlob(dataUrl);
    if (!blob) throw new Error('图片数据格式无效');
    const key = this.prefix + id;
    for (let attempt = 0; attempt < 2; attempt++) {
      await IDB.put(key, { blob: blob, type: blob.type || '', createdAt: Date.now() });
      const stored = await IDB.get(key);
      if (stored && stored.blob) return id;
    }
    throw new Error('图片 Blob 写入 IndexedDB 后校验失败');
  },
  get: async function (id) {
    const rec = await IDB.get(this.prefix + id);
    if (!rec || !rec.blob) return '';
    return this.blobDataUrl(rec.blob);
  },
  del: async function (id) { return IDB.del(this.prefix + id); }
};

var IMAGE_PERSIST_QUEUES = new Map();
function hasImageData(value) {
  if (!value) return false;
  if (Array.isArray(value)) return value.some(hasImageData);
  if (typeof value !== 'object') return false;
  if (Array.isArray(value.imgs) && value.imgs.length) return true;
  return Object.keys(value).some(function (k) { return k !== 'imgs' && hasImageData(value[k]); });
}
function imageRefSanitize(value, jobs) {
  if (Array.isArray(value)) return value.map(function (x) { return imageRefSanitize(x, jobs); });
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).forEach(function (k) { if (k !== 'imgs') out[k] = imageRefSanitize(value[k], jobs); });
  if (Array.isArray(value.imgs) && value.imgs.length) {
    // Preserve the incoming ids before assigning generated ids.  The old code
    // assigned `value.imageIds` first and then checked it, which made every
    // image look already persisted and left the IndexedDB write queue empty.
    const existingIds = Array.isArray(value.imageIds) && value.imageIds.length === value.imgs.length ? value.imageIds.slice() : null;
    const ids = existingIds || value.imgs.map(function () { return ImageStore.id(); });
    value.imageIds = ids.slice();
    out.imageIds = ids;
    out.imgs = [];
    value.imgs.forEach(function (dataUrl, i) {
      // Re-write when a runtime image is present. This also repairs a missing
      // IndexedDB record while keeping the stable reference id.
      if (dataUrl) jobs.push(ImageStore.put(ids[i], dataUrl));
    });
  } else if (Array.isArray(value.imageIds)) {
    out.imageIds = value.imageIds.slice();
    out.imgs = Array.isArray(value.imgs) ? [] : value.imgs;
  }
  return out;
}
function persistWithImageRefs(key, value) {
  const prev = IMAGE_PERSIST_QUEUES.get(key) || Promise.resolve(true);
  const task = prev.catch(function () { return false; }).then(async function () {
    if (!hasImageData(value)) return saveJSON(key, value);
    const jobs = [];
    const clean = imageRefSanitize(value, jobs);
    try {
      await Promise.all(jobs);
      return saveJSON(key, clean);
    } catch (e) { return false; }
  });
  IMAGE_PERSIST_QUEUES.set(key, task);
  return task;
}
async function restoreImageRefs(value, onDone) {
  const jobs = [];
  function visit(x) {
    if (Array.isArray(x)) { x.forEach(visit); return; }
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x.imageIds) && (!Array.isArray(x.imgs) || !x.imgs.length)) {
      jobs.push(Promise.all(x.imageIds.map(function (id) { return ImageStore.get(id).catch(function () { return ''; }); })).then(function (imgs) { x.imgs = imgs.filter(Boolean); }));
    }
    Object.keys(x).forEach(function (k) { if (k !== 'imgs' && k !== 'imageIds') visit(x[k]); });
  }
  visit(value);
  await Promise.all(jobs);
  if (typeof onDone === 'function') onDone(value);
  return value;
}
