'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normaliseSearchPrecision } = require('./tags');
const SELECTION_KEY = 'rewrite_character_selection_v1';
const key = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
const list = value => Array.isArray(value) ? value : [];
const clone = value => JSON.parse(JSON.stringify(value));
const label = value => String(value || '').replace(/_/g, ' ');
const unique = values => [...new Map(values.map(value => [key(value), value])).values()];
const escapePrompt = value => String(value).replace(/\\([()])/g, '$1').replace(/[()]/g, '\\$&');

function createCharacters(options = {}) {
  const tags = options.tags;
  const storage = options.storage;
  let loaded = false;
  let records = new Map();
  let terms = new Map();
  let index = [];
  let seriesIndex = [];
  let metadata = {};
  let selectedRows = [];
  let manifestCache = null;
  const cache = new Map();
  try { selectedRows = list(storage?.get?.(SELECTION_KEY, [])).filter(row => row && typeof row.id === 'string'); } catch { /* Empty initial selection. */ }

  function load() {
    if (loaded) return;
    try {
      const dir = options.dataDir || path.join(__dirname, '../../assets/数据资产/角色');
      const read = name => JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));
      const data = options.data || { characters: read('characters'), specificTags: read('specific-tags'), manifest: read('manifest') };
      if (!Array.isArray(data.characters) || !Array.isArray(data.specificTags)) throw new Error('Invalid arrays');
      const next = new Map();
      const localNames = new Map(list(tags?.characterNameIndex?.() || tags?.list?.({ category: 'character_names', includeAdult: true })).map(t => [t.id, t]));
      const series = new Map();
      for (const row of data.characters) {
        if (!row || typeof row.id !== 'string' || !row.id.trim() || next.has(row.id)) throw new Error('Invalid or duplicate character ID');
        const old = localNames.get(row.id);
        const record = { ...row, name: row.name || label(row.id), nameZh: old?.zh || row.nameZh || '', aliases: unique([...list(old?.aliases), ...list(row.aliases)]), nsfw: Boolean(row.nsfw || old?.nsfw), tagIds: list(row.tagIds), specificTagIds: list(row.specificTagIds) };
        next.set(row.id, record);
      }
      // Keep saved IDs and names that the new source does not cover.
      for (const row of localNames.values()) if (!next.has(row.id)) {
        next.set(row.id, { id: row.id, name: label(row.en), nameZh: row.zh, aliases: row.aliases, nsfw: row.nsfw, seriesId: '', trigger: label(row.en), tagIds: [], specificTagIds: [], count: row.count || 0, fallback: true });
      }
      const nextTerms = new Map(data.specificTags.map(row => [row.id, { ...row, category: 'character_specific' }]));
      if (nextTerms.size !== data.specificTags.length) throw new Error('Duplicate specific tag IDs');
      for (const row of next.values()) {
        const id = row.seriesId || '';
        if (!series.has(id)) series.set(id, { id, name: row.seriesName || label(id), count: 0 });
        series.get(id).count += 1;
      }
      records = next;
      terms = nextTerms;
      metadata = { ...(data.manifest || {}), loadedCharacters: next.size, legacyFallbackCharacters: [...next.values()].filter(r => r.fallback).length };
      index = [...records.values()].map(row => ({ row, names: [row.id, row.name, row.nameZh].map(key).filter(Boolean), aliases: row.aliases.map(key).filter(Boolean), series: key(row.seriesId), seriesName: key(row.seriesName || row.seriesId) }));
      seriesIndex = [...series.values()].filter(s => s.id).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
      loaded = true;
    } catch (cause) {
      throw Object.assign(new Error('角色资料加载失败 / Character data failed to load: ' + cause.message), { code: 'CHARACTER_DATA_INVALID' });
    }
  }

  function readManifest() {
    if (manifestCache) return manifestCache;
    if (options.data?.manifest && typeof options.data.manifest === 'object') {
      manifestCache = options.data.manifest;
      return manifestCache;
    }
    try {
      const dir = options.dataDir || path.join(__dirname, '../../assets/数据资产/角色');
      manifestCache = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      return manifestCache;
    } catch (cause) {
      throw Object.assign(new Error('角色资料清单加载失败 / Character manifest failed to load: ' + cause.message), { code: 'CHARACTER_MANIFEST_INVALID' });
    }
  }

  function count() {
    const info = readManifest();
    const runtimeTotal = Number(info.runtimeCounts?.totalCharacters);
    if (Number.isFinite(runtimeTotal) && runtimeTotal >= 0) return runtimeTotal;
    const featured = Number(info.counts?.characters);
    if (options.data && Number.isFinite(featured)) return featured;
    load();
    return records.size;
  }

  function summary(row) {
    return { id: row.id, name: row.name, nameZh: row.nameZh, seriesId: row.seriesId || '', seriesName: row.seriesName || label(row.seriesId), count: Number(row.count) || 0, hasFeatures: Boolean(row.tagIds.length || row.specificTagIds.length) };
  }
  function get(id, settings = {}) {
    load();
    const row = records.get(String(id));
    if (!row || (row.nsfw && !settings.includeAdult)) return null;
    const visible = term => term && (settings.includeAdult || !term.nsfw);
    const generalTags = row.tagIds.map(id => tags?.get?.(id)).filter(visible).map(term => ({ id: term.id, en: term.en, zh: term.zh || '', category: term.category || 'other', nsfw: Boolean(term.nsfw) }));
    const specificTags = row.specificTagIds.map(id => terms.get(id)).filter(visible).map(term => ({ id: term.id, en: term.en, zh: term.zh || '', category: 'character_specific', nsfw: Boolean(term.nsfw), review: Boolean(term.review) }));
    // The character key is the stable identity. The source trigger stays available for audit.
    const identityTags = unique([label(row.id), label(row.seriesId)].filter(Boolean));
    return { ...summary(row), aliases: row.aliases.slice(), identityTags, generalTags, specificTags, trigger: row.trigger || identityTags.join(', ') };
  }
  function match(row, query, precision) {
    if (!query) return 1;
    if (row.names.includes(query)) return 120;
    if (row.aliases.includes(query)) return 110;
    if (row.series === query || row.seriesName === query) return 80;
    if (precision === 'exact') return 0;
    const fields = [...row.names, ...row.aliases, row.series, row.seriesName];
    if (fields.some(f => f.startsWith(query))) return 75;
    if (fields.some(f => f.includes(query))) return 60;
    if (query.split(' ').every(q => fields.some(f => f.includes(q)))) return 40;
    if (precision === 'broad' && fields.some(f => f.replace(/[ .-]/g, '').includes(query.replace(/[ .-]/g, '')))) return 30;
    return 0;
  }
  function page(settings = {}) {
    load();
    const query = key(settings.query);
    const precision = normaliseSearchPrecision(settings.precision);
    const seriesId = String(settings.seriesId || '');
    const cacheKey = JSON.stringify([query, precision, seriesId, Boolean(settings.includeAdult)]);
    let rows = cache.get(cacheKey);
    if (!rows) {
      rows = index.filter(entry => (settings.includeAdult || !entry.row.nsfw) && (!seriesId || entry.row.seriesId === seriesId))
        .map(entry => ({ row: entry.row, score: match(entry, query, precision) })).filter(entry => entry.score)
        .sort((a, b) => b.score - a.score || (Number(b.row.count) || 0) - (Number(a.row.count) || 0) || a.row.id.localeCompare(b.row.id)).map(entry => entry.row);
      if (cache.size >= 24) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, rows);
    }
    const offset = Math.max(0, Math.floor(Number(settings.offset) || 0));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(settings.limit) || 50)));
    return { items: rows.slice(offset, offset + limit).map(summary), total: rows.length, offset, limit, hasMore: offset + limit < rows.length };
  }
  function series(settings = {}) {
    load();
    const query = key(settings.query);
    return seriesIndex.filter(row => !query || key(row.id).includes(query) || key(row.name).includes(query)).slice(0, Math.min(500, Math.max(1, Number(settings.limit) || 100))).map(row => ({ ...row }));
  }
  function persist() { storage?.set?.(SELECTION_KEY, clone(selectedRows)); }
  function select(id, settings = {}) {
    const role = get(id, settings);
    if (!role) return false;
    const general = new Set(role.generalTags.map(t => t.id));
    const specific = new Set(role.specificTags.map(t => t.id));
    const value = { id: role.id, generalTagIds: unique(list(settings.generalTagIds).filter(id => general.has(id))), specificTagIds: unique(list(settings.specificTagIds).filter(id => specific.has(id))), includeSeries: settings.includeSeries !== false };
    const position = selectedRows.findIndex(row => row.id === role.id);
    if (position < 0) selectedRows.push(value); else selectedRows[position] = value;
    persist();
    return value;
  }
  function selected(settings = {}) {
    if (!selectedRows.length) return [];
    return selectedRows.flatMap(selection => {
      const role = get(selection.id, settings);
      if (!role) return [];
      const text = [role.identityTags[0], ...(selection.includeSeries ? role.identityTags.slice(1) : []), ...role.generalTags.filter(t => list(selection.generalTagIds).includes(t.id)).map(t => t.en), ...role.specificTags.filter(t => list(selection.specificTagIds).includes(t.id)).map(t => t.en)];
      return [{ id: role.id, name: role.nameZh || role.name, tags: unique(text.filter(Boolean)).map(escapePrompt) }];
    });
  }
  return Object.freeze({
    get, page, series, select, selected,
    size: () => { load(); return records.size; },
    count,
    manifest: () => { const info = readManifest(); return loaded ? clone(metadata) : clone(info); },
    selectionText: settings => unique(selected(settings).flatMap(row => row.tags)).join(', '),
    removeSelection(id) { selectedRows = selectedRows.filter(row => row.id !== id); persist(); },
    clearSelection() { selectedRows = []; persist(); },
  });
}

module.exports = { createCharacters };
