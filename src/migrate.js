'use strict';

/**
 * V1.4.2 -> V1.4.3 一次性迁移器。
 *
 * 迁移器与页面、正式业务状态完全分离：调用方提供新的 storage 以及可选
 * 的 legacy 数据源，迁移器只负责读取旧键、做最小字段转换并写入新命名空间。
 * legacy 可以是：
 *   - { getItem(key) } 形式的旧存储 adapter；
 *   - 直接对象（键值为已解析的数据）；
 *   - (key) => value 函数。
 * 未提供 legacy 时迁移仍会写入完成标记，保证启动过程可重复且不会阻塞页面。
 */

function text(value, fallback = '') {
  const result = value == null ? '' : String(value).trim();
  return result || fallback;
}

function parse(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function readLegacy(source, key, fallback = null) {
  try {
    if (!source) return fallback;
    if (typeof source === 'function') return parse(source(key), fallback);
    if (typeof source.getItem === 'function') return parse(source.getItem(key), fallback);
    if (Object.prototype.hasOwnProperty.call(source, key)) return parse(source[key], fallback);
  } catch { /* 旧数据损坏时跳过该键 */ }
  return fallback;
}

function write(storage, key, value) {
  try {
    if (storage && typeof storage.set === 'function') storage.set(key, value);
    return true;
  } catch { return false; }
}

function has(storage, key) {
  try {
    return Boolean(storage && typeof storage.has === 'function' && storage.has(key));
  } catch { return false; }
}

function migrateLegacyData(options = {}) {
  const storage = options.storage;
  const legacy = options.legacy;
  const assistant = options.assistant;
  const result = { migrated: false, skipped: false, keys: [] };

  if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
    result.skipped = true;
    return result;
  }
  if (storage.get('rewrite_migrated_v142', false)) {
    // 业务状态可以在 Assistant 创建前迁移；会话需要等 Assistant 就绪后
    // 再补一次导入，因此允许带 assistant 的第二次调用只处理会话。
    const sessions = readLegacy(legacy, 'dbt_talk_sessions_v1', null) || readLegacy(legacy, 'dbt_talk_v2', null);
    if (assistant && Array.isArray(sessions) && !storage.get('rewrite_sessions_migrated', false)) {
      try { assistant.importSessions?.(sessions, true); } catch { /* 保持启动可用 */ }
      write(storage, 'rewrite_sessions_migrated', true);
      result.keys.push('rewrite_sessions_migrated');
    }
    result.skipped = true;
    return result;
  }

  const oldAi = readLegacy(legacy, 'dbt_ai_v2', null);
  const currentSettings = storage.get('rewrite_settings', null);
  if (oldAi && !currentSettings) {
    const settings = {
      ...(typeof oldAi === 'object' ? oldAi : {}),
      temperature: Number(oldAi.temperature ?? oldAi.temp) || 0.7,
      key: ''
    };
    delete settings.temp;
    delete settings.sysPrompt;
    delete settings.genTask;
    delete settings.visionPrompt;
    delete settings.qualityPrefix;
    if (write(storage, 'rewrite_settings', settings)) result.keys.push('rewrite_settings');
  }

  const oldPresets = oldAi?.presets;
  if (Array.isArray(oldPresets) && !has(storage, 'rewrite_presets')) {
    const presets = oldPresets.map((item, index) => ({
      id: text(item?.id, `preset_migrated_${index}`),
      name: text(item?.name, `旧版预设 ${index + 1}`),
      main: text(item?.main || item?.sysPrompt),
      generate: text(item?.generate || item?.genTask),
      vision: text(item?.vision || item?.visionPrompt),
      quality: text(item?.quality || item?.qualityPrefix)
    }));
    const active = text(oldAi.presetSel || oldAi.activePreset, presets[0]?.id || '');
    write(storage, 'rewrite_presets', presets);
    write(storage, 'rewrite_active_preset', active);
    result.keys.push('rewrite_presets', 'rewrite_active_preset');
  }

  const oldWorlds = oldAi?.worlds;
  if (Array.isArray(oldWorlds) && !has(storage, 'rewrite_worlds')) {
    const worlds = oldWorlds.map((world, wi) => ({
      id: text(world?.id, `world_migrated_${wi}`),
      name: text(world?.name, `旧版世界书 ${wi + 1}`),
      enabled: world?.enabled !== false,
      entries: (Array.isArray(world?.entries) ? world.entries : []).map((entry, ei) => ({
        id: text(entry?.id, `entry_migrated_${wi}_${ei}`),
        name: text(entry?.name, `条目 ${ei + 1}`),
        keys: text(entry?.keys || entry?.key),
        content: text(entry?.content || entry?.text),
        enabled: entry?.enabled !== false,
        constant: Boolean(entry?.constant)
      }))
    }));
    const active = text(oldAi.worldSel || oldAi.activeWorld, worlds[0]?.id || '');
    write(storage, 'rewrite_worlds', worlds);
    write(storage, 'rewrite_active_world', active);
    result.keys.push('rewrite_worlds', 'rewrite_active_world');
  }

  const mappings = [
    ['dbt_selected_v2', 'rewrite_selected'],
    ['dbt_favs_v2', 'rewrite_favorites'],
    ['dbt_custom_v2', 'rewrite_custom_tags'],
    ['dbt_cat_v2', 'rewrite_category']
  ];
  for (const [from, to] of mappings) {
    const value = readLegacy(legacy, from, null);
    if (Array.isArray(value) && !has(storage, to)) {
      write(storage, to, value);
      result.keys.push(to);
    }
  }

  const adult = readLegacy(legacy, 'dbt_nsfw_v2', null);
  if (adult != null && !has(storage, 'rewrite_adult')) {
    write(storage, 'rewrite_adult', Boolean(adult));
    result.keys.push('rewrite_adult');
  }
  const theme = readLegacy(legacy, 'dbt_theme_v2', null);
  if (theme && !has(storage, 'rewrite_theme')) {
    write(storage, 'rewrite_theme', theme);
    result.keys.push('rewrite_theme');
  }

  const sessions = readLegacy(legacy, 'dbt_talk_sessions_v1', null) || readLegacy(legacy, 'dbt_talk_v2', null);
  if (Array.isArray(sessions) && !storage.get('rewrite_sessions_migrated', false)) {
    if (assistant) {
      try { assistant.importSessions?.(sessions, true); } catch { /* 单个旧会话损坏不影响启动 */ }
      write(storage, 'rewrite_sessions_migrated', true);
      result.keys.push('rewrite_sessions_migrated');
    }
  }

  write(storage, 'rewrite_migrated_v142', true);
  result.keys.push('rewrite_migrated_v142');
  result.migrated = true;
  return result;
}

module.exports = { readLegacy, migrateLegacyData };
