'use strict';

const SETTINGS_KEY = 'settings';
const GROUPS = Object.freeze(['primaryApi', 'visionApi', 'comfy', 'limits']);
const DEFAULT_SETTINGS = Object.freeze({
  primaryApi: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', key: '', temperature: 0.7, timeoutMs: 120000, maxTokens: null },
  visionApi: { inheritPrimary: true, base: '', model: '', key: '', temperature: 0.2, timeoutMs: 120000, maxTokens: null },
  comfy: { enabled: false, base: 'http://127.0.0.1:8188', workflow: '', profiles: { version: 1, activeProfileId: 'profile-default', items: [] }, positiveTags: '', negativeTags: '', width: 768, height: 1024, steps: 25, cfg: 7, seed: null, sampler: '', scheduler: '', batchCount: 1 },
  limits: { maxComfyCalls: 3, maxToolRounds: 8, maxToolCalls: 32, primaryTimeoutMs: 120000 },
  generateNegativeTags: false
});
const FORM_FIELDS = Object.freeze({
  base: ['primaryApi', 'base'], model: ['primaryApi', 'model'], key: ['primaryApi', 'key'],
  temperature: ['primaryApi', 'temperature'], timeoutMs: ['primaryApi', 'timeoutMs'], maxTokens: ['primaryApi', 'maxTokens'],
  visionInheritPrimary: ['visionApi', 'inheritPrimary'], visionBase: ['visionApi', 'base'], visionModel: ['visionApi', 'model'],
  visionKey: ['visionApi', 'key'], visionTemperature: ['visionApi', 'temperature'], visionTimeoutMs: ['visionApi', 'timeoutMs'], visionMaxTokens: ['visionApi', 'maxTokens'],
  comfyOn: ['comfy', 'enabled'], comfyBase: ['comfy', 'base'], comfyWorkflow: ['comfy', 'workflow'], comfyPos: ['comfy', 'positiveTags'], comfyNeg: ['comfy', 'negativeTags'],
  comfyW: ['comfy', 'width'], comfyH: ['comfy', 'height'], comfySteps: ['comfy', 'steps'], comfyCfg: ['comfy', 'cfg'], comfySeed: ['comfy', 'seed'],
  comfySampler: ['comfy', 'sampler'], comfyScheduler: ['comfy', 'scheduler'], batchCount: ['comfy', 'batchCount'],
  maxComfyCalls: ['limits', 'maxComfyCalls'], maxToolRounds: ['limits', 'maxToolRounds'], maxToolCalls: ['limits', 'maxToolCalls'], primaryTimeoutMs: ['limits', 'primaryTimeoutMs']
});
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function string(value, fallback = '') { return value == null ? fallback : String(value).trim(); }
function number(value, fallback, min, max, integer = false) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return fallback;
  const result = Math.max(min, Math.min(max, Number(value)));
  return integer ? Math.floor(result) : result;
}
function optionalNumber(value, min, max) { return value == null || value === '' ? null : number(value, null, min, max, true); }
function apiProfile(value, defaults) {
  const source = object(value) ? value : {};
  return {
    base: own(source, 'base') ? string(source.base) : defaults.base,
    model: own(source, 'model') ? string(source.model) : defaults.model,
    key: own(source, 'key') ? string(source.key) : defaults.key,
    temperature: number(source.temperature, defaults.temperature, 0, 2),
    timeoutMs: number(source.timeoutMs, defaults.timeoutMs, 1000, 3600000, true),
    maxTokens: own(source, 'maxTokens') ? optionalNumber(source.maxTokens, 1, 1000000) : defaults.maxTokens
  };
}
function normaliseSettings(value = {}) {
  const source = object(value) ? value : {};
  const comfy = object(source.comfy) ? source.comfy : {};
  const limits = object(source.limits) ? source.limits : {};
  const defaults = DEFAULT_SETTINGS.comfy;
  const tagText = item => Array.isArray(item) ? item.map(value2 => string(value2)).filter(Boolean).join(', ') : string(item);
  return {
    primaryApi: apiProfile(source.primaryApi, DEFAULT_SETTINGS.primaryApi),
    visionApi: { inheritPrimary: source.visionApi?.inheritPrimary !== false, ...apiProfile(source.visionApi, DEFAULT_SETTINGS.visionApi) },
    comfy: {
      enabled: comfy.enabled === true,
      base: own(comfy, 'base') ? string(comfy.base) : defaults.base,
      workflow: object(comfy.workflow) ? clone(comfy.workflow) : string(comfy.workflow),
      profiles: object(comfy.profiles) && comfy.profiles.version === 1 ? clone(comfy.profiles) : clone(defaults.profiles),
      positiveTags: tagText(comfy.positiveTags), negativeTags: tagText(comfy.negativeTags),
      width: number(comfy.width, defaults.width, 64, 16384, true), height: number(comfy.height, defaults.height, 64, 16384, true),
      steps: number(comfy.steps, defaults.steps, 1, 1000, true), cfg: number(comfy.cfg, defaults.cfg, 0, 100),
      seed: optionalNumber(comfy.seed, 0, Number.MAX_SAFE_INTEGER), sampler: string(comfy.sampler), scheduler: string(comfy.scheduler),
      batchCount: number(comfy.batchCount, defaults.batchCount, 1, 8, true)
    },
    limits: {
      maxComfyCalls: number(limits.maxComfyCalls, DEFAULT_SETTINGS.limits.maxComfyCalls, 0, 128, true),
      maxToolRounds: number(limits.maxToolRounds, DEFAULT_SETTINGS.limits.maxToolRounds, 1, 128, true),
      maxToolCalls: number(limits.maxToolCalls, DEFAULT_SETTINGS.limits.maxToolCalls, 0, 512, true),
      primaryTimeoutMs: number(limits.primaryTimeoutMs, DEFAULT_SETTINGS.limits.primaryTimeoutMs, 1000, 3600000, true)
    },
    generateNegativeTags: source.generateNegativeTags === true
  };
}
function applySettingsPatch(current, patch = {}, form = false) {
  const source = object(patch) ? patch : {};
  const next = clone(current);
  if (form) for (const [key, [group, name]] of Object.entries(FORM_FIELDS)) if (own(source, key)) next[group][name] = clone(source[key]);
  for (const group of GROUPS) if (object(source[group])) Object.assign(next[group], clone(source[group]));
  if (own(source, 'generateNegativeTags')) next.generateNegativeTags = source.generateNegativeTags;
  return normaliseSettings(next);
}
function settingsForm(value) {
  const output = {};
  for (const [key, [group, name]] of Object.entries(FORM_FIELDS)) output[key] = clone(value[group][name]);
  output.generateNegativeTags = value.generateNegativeTags;
  return output;
}
function createSettings(options = {}) {
  const storage = options.storage;
  let current = normaliseSettings(options.initial);
  try {
    const stored = storage?.get ? storage.get(SETTINGS_KEY, null) : storage?.load?.(SETTINGS_KEY, null);
    if (object(stored) && GROUPS.every(key => object(stored[key]))) current = normaliseSettings(stored);
  } catch { /* Invalid optional settings use the current defaults. */ }
  function persist() {
    const value = clone(current);
    if (storage?.set) storage.set(SETTINGS_KEY, value);
    else storage?.save?.(SETTINGS_KEY, value);
    return value;
  }
  const api = {
    snapshot: () => clone(current),
    getForm: () => settingsForm(current),
    set(value) { current = applySettingsPatch(current, value); return persist(); },
    setForm(value) { current = applySettingsPatch(current, value, true); persist(); return settingsForm(current); },
    primaryProfile: () => clone(current.primaryApi),
    visionProfile: () => clone(current.visionApi.inheritPrimary ? current.primaryApi : apiProfile(current.visionApi, DEFAULT_SETTINGS.visionApi)),
    reset(group) {
      if (group === 'primaryApi' || group === 'visionApi') current[group] = clone(DEFAULT_SETTINGS[group]);
      else current = normaliseSettings();
      persist(); return settingsForm(current);
    }
  };
  return Object.freeze(api);
}

module.exports = { SETTINGS_KEY, DEFAULT_SETTINGS, FORM_FIELDS, normaliseSettings, applySettingsPatch, settingsForm, createSettings };
