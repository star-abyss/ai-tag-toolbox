'use strict';

/**
 * 很薄的本地存储入口。
 *
 * 普通小数据放 JSON 文件（或显式传入 adapter），
 * 大对象放 IndexedDB；在没有这些环境时自动退回进程内内存。调用方只拿到
 * 自己的 namespace，不需要知道底层到底是哪一种存储。
 */

const fs = require('node:fs');
const path = require('node:path');

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function json(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function isStorage(value) {
  return value && typeof value.getItem === 'function' && typeof value.setItem === 'function';
}

function createFileAdapter(filePath) {
  const filename = path.resolve(String(filePath));
  let cache = null;
  function read() {
    if (cache) return cache;
    try {
      const value = json(fs.readFileSync(filename, 'utf8'), {});
      cache = object(value) ? value : {};
    } catch { cache = {}; }
    return cache;
  }
  function write(value) {
    cache = value;
    try {
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, JSON.stringify(value, null, 2), 'utf8');
      return true;
    } catch { return false; }
  }
  return {
    getItem(key) { const value = read()[key]; return value == null ? null : String(value); },
    setItem(key, value) { const root = { ...read(), [key]: String(value) }; return write(root); },
    removeItem(key) { const root = { ...read() }; delete root[key]; return write(root); },
    key(index) { return Object.keys(read())[index] || null; },
    get length() { return Object.keys(read()).length; },
    filePath: filename
  };
}

function makeMemoryAdapter(seed) {
  const values = new Map(Object.entries(object(seed) ? seed : {}));
  return {
    getItem(key) { return values.has(key) ? String(values.get(key)) : null; },
    setItem(key, value) { values.set(key, String(value)); return true; },
    removeItem(key) { values.delete(key); return true; },
    key(index) { return [...values.keys()][index] || null; },
    get length() { return values.size; },
    values
  };
}

function toBlob(value, type = 'application/octet-stream') {
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value;
  if (Buffer.isBuffer(value)) return typeof Blob !== 'undefined' ? new Blob([value], { type }) : value;
  if (value instanceof Uint8Array) return typeof Blob !== 'undefined' ? new Blob([value], { type }) : Buffer.from(value);
  if (typeof value === 'string' && value.startsWith('data:')) {
    const comma = value.indexOf(',');
    if (comma >= 0) {
      const head = value.slice(5, comma);
      const body = value.slice(comma + 1);
      const bytes = head.toLowerCase().includes(';base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body));
      const mime = head.split(';')[0] || type;
      return typeof Blob !== 'undefined' ? new Blob([bytes], { type: mime }) : bytes;
    }
  }
  return value;
}

function createStorage(options = {}) {
  const prefix = String(options.prefix || 'ai-tag-toolbox');
  // 统一使用显式 adapter、文件或内存，不再隐式接管浏览器 localStorage。
  // 这样 Electron 页面和 Node 模块只有一个持久化入口，避免两套状态漂移。
  const adapter = isStorage(options.adapter)
    ? options.adapter
    : (options.filePath || options.storagePath ? createFileAdapter(options.filePath || options.storagePath) : makeMemoryAdapter());
  const memory = new Map();
  const blobMemory = new Map();
  const namespaces = new Map();
  const listeners = new Set();
  const dbName = String(options.dbName || `${prefix}-blobs`);
  const storeName = String(options.storeName || 'blobs');
  let dbPromise = null;

  function keyFor(space, key) {
    return `${prefix}:${space}:${String(key)}`;
  }
  function read(key, fallback = undefined) {
    try {
      const raw = adapter.getItem(key);
      if (raw != null) return json(raw, fallback);
    } catch { /* use memory fallback */ }
    return memory.has(key) ? clone(memory.get(key)) : fallback;
  }
  function write(key, value) {
    const copy = clone(value);
    memory.set(key, copy);
    try {
      const ok = adapter.setItem(key, JSON.stringify(copy));
      if (ok === false) return false;
    } catch { return false; }
    listeners.forEach(listener => { try { listener({ key, value: clone(copy) }); } catch { /* listener is optional */ } });
    return true;
  }
  function remove(key) {
    memory.delete(key);
    try { adapter.removeItem(key); } catch { /* memory is still cleared */ }
    listeners.forEach(listener => { try { listener({ key, value: undefined, removed: true }); } catch { /* optional */ } });
    return true;
  }
  function keysFor(space) {
    const prefixKey = `${prefix}:${space}:`;
    const result = new Set();
    try {
      for (let index = 0; index < Number(adapter.length || 0); index += 1) {
        const key = adapter.key(index);
        if (key && key.startsWith(prefixKey)) result.add(key.slice(prefixKey.length));
      }
    } catch { /* memory below */ }
    for (const key of memory.keys()) if (key.startsWith(prefixKey)) result.add(key.slice(prefixKey.length));
    return [...result];
  }
  function namespace(space = 'app') {
    const name = String(space || 'app');
    if (namespaces.has(name)) return namespaces.get(name);
    const full = key => keyFor(name, key);
    const api = {
      name,
      get(key, fallback = null) { return clone(read(full(key), fallback)); },
      set(key, value) { write(full(key), value); return clone(value); },
      save(key, value) { return this.set(key, value); },
      load(key, fallback = null) { return this.get(key, fallback); },
      remove(key) { return remove(full(key)); },
      delete(key) { return this.remove(key); },
      has(key) { return read(full(key), undefined) !== undefined; },
      update(key, patch = {}) {
        const current = this.get(key, {});
        const next = object(current) && object(patch) ? { ...current, ...clone(patch) } : clone(patch);
        this.set(key, next);
        return next;
      },
      keys() { return keysFor(name); },
      values() { return this.keys().map(key => this.get(key)); },
      entries() { return this.keys().map(key => [key, this.get(key)]); },
      clear() { this.keys().forEach(key => remove(full(key))); return true; },
      snapshot() { return Object.fromEntries(this.entries()); },
      json: {
        get: (key, fallback = null) => this.get(key, fallback),
        set: (key, value) => this.set(key, value)
      },
      blob: {
        put: (key, value, meta) => putBlob(`${name}:${key}`, value, meta),
        get: key => getBlob(`${name}:${key}`),
        remove: key => removeBlob(`${name}:${key}`)
      }
    };
    namespaces.set(name, api);
    return api;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    dbPromise = new Promise(resolve => {
      let request;
      try { request = indexedDB.open(dbName, 1); } catch { resolve(null); return; }
      request.onupgradeneeded = () => { try { request.result.createObjectStore(storeName); } catch { /* exists */ } };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    return dbPromise;
  }
  async function putBlob(key, value, meta = {}) {
    const blob = toBlob(value, meta.type);
    const record = { blob, type: meta.type || blob?.type || '', name: meta.name || '', updatedAt: Date.now() };
    const db = await openDb();
    if (!db) { blobMemory.set(key, record); return key; }
    await new Promise(resolve => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(record, key);
        tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
      } catch { resolve(); }
    });
    return key;
  }
  async function getBlob(key) {
    const db = await openDb();
    if (!db) return blobMemory.get(key)?.blob || null;
    return await new Promise(resolve => {
      try {
        const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result?.blob || null);
        request.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  async function removeBlob(key) {
    blobMemory.delete(key);
    const db = await openDb();
    if (!db) return true;
    return await new Promise(resolve => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = tx.onerror = tx.onabort = () => resolve(true);
      } catch { resolve(false); }
    });
  }

  const root = namespace('app');
  return {
    prefix,
    adapter,
    namespace,
    scope: namespace,
    get: root.get,
    set: root.set,
    save: root.save,
    load: root.load,
    remove: root.remove,
    delete: root.delete,
    has: root.has,
    update: root.update,
    keys: root.keys,
    clear: root.clear,
    snapshot: root.snapshot,
    subscribe(listener) { if (typeof listener === 'function') listeners.add(listener); return () => listeners.delete(listener); },
    putBlob,
    getBlob,
    removeBlob,
    getJSON: root.get,
    setJSON: root.set,
    image: { put: putBlob, get: getBlob, remove: removeBlob },
    images: { put: putBlob, get: getBlob, remove: removeBlob },
    idb: { put: putBlob, get: getBlob, remove: removeBlob }
  };
}

module.exports = {
  createStorage,
  createAppStorage: createStorage,
  createNamespace: (space, options) => createStorage(options).namespace(space),
  createFileAdapter,
  makeMemoryAdapter
};
