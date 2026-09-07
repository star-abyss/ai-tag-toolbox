'use strict';

const STORAGE_KEY = 'comfy_profiles';
const PROFILE_VERSION = 1;
const DEFAULT_OVERRIDES = Object.freeze({ positive: true, negative: true, width: false, height: false, steps: false, cfg: false, seed: false, sampler: false, scheduler: false, batchCount: false, ckpt: false });
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function text(value, fallback = '') { const out = value == null ? '' : String(value).trim(); return out || fallback; }
function profileId(value) { return text(value).replace(/[^a-z0-9_-]/gi, '-').replace(/^-+|-+$/g, '').toLowerCase(); }
function normaliseOverrides(value) { return { ...DEFAULT_OVERRIDES, ...(object(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v === true])) : {}) }; }
function normaliseProfile(value, fallbackId = 'profile-default') {
  const source = object(value) ? value : {};
  const id = profileId(source.id) || fallbackId;
  return { id, name: text(source.name, id === 'profile-default' ? '默认工作流' : id), base: text(source.base, ''), workflow: clone(source.workflow || ''), analysis: clone(object(source.analysis) ? source.analysis : { level: 'manual', nodeCount: 0, missingClasses: [] }), bindings: clone(object(source.bindings) ? source.bindings : {}), overrides: normaliseOverrides(source.overrides), outputPolicy: text(source.outputPolicy, 'selected'), updatedAt: Number(source.updatedAt) || Date.now() };
}

function createComfyProfiles(options = {}) {
  const storage = options.storage || null;
  const read = storage?.get ? storage.get.bind(storage) : (_key, fallback) => fallback;
  const write = storage?.set ? storage.set.bind(storage) : () => {};
  const initialComfy = object(options.initial?.comfy) ? options.initial.comfy : {};
  const persisted = read(STORAGE_KEY, options.initial?.comfy?.profiles || null);
  let items = [];
  let activeProfileId = '';
  if (object(persisted) && persisted.version === PROFILE_VERSION && Array.isArray(persisted.items)) {
    items = persisted.items.filter(object).map((row, index) => normaliseProfile(row, index === 0 ? 'profile-default' : `profile-${index + 1}`));
    activeProfileId = profileId(persisted.activeProfileId);
  }
  if (!items.length) items = [normaliseProfile({ id: 'profile-default', name: '默认工作流', base: initialComfy.base, workflow: initialComfy.workflow }, 'profile-default')];
  if (!items.some(row => row.id === activeProfileId)) activeProfileId = items[0].id;
  function persist() { write(STORAGE_KEY, { version: PROFILE_VERSION, activeProfileId, items: clone(items) }); }
  function list() { return clone(items); }
  function get(id) { return clone(items.find(row => row.id === profileId(id)) || null); }
  function active() { return get(activeProfileId) || get(items[0].id); }
  function save(value) {
    const source = normaliseProfile(value, `profile-${Date.now()}`);
    const index = items.findIndex(row => row.id === source.id);
    if (index >= 0) items[index] = source; else items.push(source);
    persist(); return clone(source);
  }
  function remove(id) {
    const key = profileId(id); if (key === 'profile-default' && items.length === 1) return false;
    const index = items.findIndex(row => row.id === key); if (index < 0) return false;
    items.splice(index, 1); if (activeProfileId === key) activeProfileId = items[Math.max(0, index - 1)]?.id || items[0].id; persist(); return true;
  }
  function setActive(id) { const key = profileId(id); if (!items.some(row => row.id === key)) return null; activeProfileId = key; persist(); return active(); }
  function snapshot() { return { version: PROFILE_VERSION, activeProfileId, items: list() }; }
  persist();
  return Object.freeze({ list, get, active, save, remove, setActive, snapshot, storageKey: STORAGE_KEY });
}

module.exports = { STORAGE_KEY, PROFILE_VERSION, DEFAULT_OVERRIDES, normaliseProfile, createComfyProfiles };
