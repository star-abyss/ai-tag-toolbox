'use strict';

const STORAGE_PREFIX = 'ai-tag-toolbox-rewrite:app:';
const SETTINGS_KEY = `${STORAGE_PREFIX}rewrite_settings`;
const MIGRATION_MARKER_KEY = `${STORAGE_PREFIX}legacy_user_data_migrated_v3`;

const LEGACY_STORAGE_KEYS = Object.freeze([
  'dbt_ai_v2',
  'dbt_talk_sessions_v1',
  'dbt_talk_v2',
  'dbt_theme_v2',
  'dbt_locale_v1',
  'dbt_nsfw_v2',
  'dbt_selected_v2',
  'dbt_favs_v2',
  'dbt_custom_v2',
  'dbt_cat_v2'
]);

const SETTING_DEFAULTS = Object.freeze({
  base: ['', 'https://api.openai.com/v1'],
  model: ['', 'gpt-4o-mini'],
  key: [''],
  temperature: [0.7],
  strict: [true],
  timeoutEnabled: [false],
  timeoutSec: [300],
  comfyOn: [false],
  comfyBase: ['', 'http://127.0.0.1:8188'],
  comfyWorkflow: [''],
  comfyIters: [3],
  batchCount: [1],
  maxComfyCalls: [3],
  generateNegativeTags: [false],
  comfyW: [768],
  comfyH: [1024],
  comfySteps: [25],
  comfyCfg: [7],
  comfyPos: [''],
  comfyNeg: [''],
  comfyCkpt: [''],
  comfySampler: [''],
  comfyScheduler: [''],
  comfyDebug: [false]
});

function parseStored(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function cloneRoot(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function isDefaultSetting(key, value) {
  if (value == null) return true;
  const defaults = SETTING_DEFAULTS[key];
  return Array.isArray(defaults) && defaults.some(item => Object.is(item, value));
}

function legacySetting(ai, key) {
  if (key === 'temperature') return ai.temperature ?? ai.temp;
  return ai[key];
}

function store(root, key, value) {
  root[`${STORAGE_PREFIX}${key}`] = JSON.stringify(value);
}

function targetEmpty(root, key) {
  const value = parseStored(root[`${STORAGE_PREFIX}${key}`], null);
  return value == null || (Array.isArray(value) && value.length === 0) || value === '';
}

function mergeLegacyStorageSnapshot(currentRoot, legacySnapshot) {
  const root = cloneRoot(currentRoot);
  if (parseStored(root[MIGRATION_MARKER_KEY], false) === true) {
    return { root, changed: false, migratedKeys: [] };
  }

  const legacy = legacySnapshot && typeof legacySnapshot === 'object' ? legacySnapshot : {};
  const hasLegacy = LEGACY_STORAGE_KEYS.some(key => legacy[key] != null);
  if (!hasLegacy) return { root, changed: false, migratedKeys: [] };

  const migratedKeys = [];
  const ai = parseStored(legacy.dbt_ai_v2, null);
  if (ai && typeof ai === 'object' && !Array.isArray(ai)) {
    const current = parseStored(root[SETTINGS_KEY], {});
    const settings = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
    for (const key of Object.keys(SETTING_DEFAULTS)) {
      const incoming = legacySetting(ai, key);
      if (incoming === undefined || !isDefaultSetting(key, settings[key]) || isDefaultSetting(key, incoming)) continue;
      settings[key] = incoming;
      migratedKeys.push(`settings.${key}`);
    }
    root[SETTINGS_KEY] = JSON.stringify(settings);

    if (Array.isArray(ai.presets) && ai.presets.length && targetEmpty(root, 'rewrite_presets')) {
      store(root, 'rewrite_presets', ai.presets);
      migratedKeys.push('rewrite_presets');
    }
    if (Array.isArray(ai.worlds) && ai.worlds.length && targetEmpty(root, 'rewrite_worlds')) {
      store(root, 'rewrite_worlds', ai.worlds);
      migratedKeys.push('rewrite_worlds');
    }
    if (ai.presetSel && targetEmpty(root, 'rewrite_active_preset')) store(root, 'rewrite_active_preset', ai.presetSel);
    if (ai.worldSel && targetEmpty(root, 'rewrite_active_world')) store(root, 'rewrite_active_world', ai.worldSel);
  }

  const copies = [
    ['dbt_theme_v2', 'app.theme'],
    ['dbt_locale_v1', 'app.locale'],
    ['dbt_nsfw_v2', 'rewrite_adult'],
    ['dbt_selected_v2', 'rewrite_selected'],
    ['dbt_favs_v2', 'rewrite_favorites'],
    ['dbt_custom_v2', 'rewrite_custom_tags'],
    ['dbt_cat_v2', 'rewrite_category'],
    ['dbt_talk_sessions_v1', 'sessions']
  ];
  for (const [legacyKey, targetKey] of copies) {
    const value = parseStored(legacy[legacyKey], null);
    if (value == null || !targetEmpty(root, targetKey)) continue;
    store(root, targetKey, value);
    migratedKeys.push(targetKey);
  }

  root[MIGRATION_MARKER_KEY] = JSON.stringify(true);
  return { root, changed: true, migratedKeys };
}

module.exports = {
  LEGACY_STORAGE_KEYS,
  LEGACY_MIGRATION_MARKER_KEY: MIGRATION_MARKER_KEY,
  mergeLegacyStorageSnapshot
};
