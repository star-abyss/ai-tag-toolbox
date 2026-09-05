'use strict';

const fs = require('node:fs');
const { app, BrowserWindow, shell, session, safeStorage } = require('electron');
const path = require('node:path');
const {
  LEGACY_STORAGE_KEYS,
  LEGACY_MIGRATION_MARKER_KEY,
  mergeLegacyStorageSnapshot
} = require('./src/modules/config-migration');

const originalApplicationName = app.getName();
let legacyApplicationNameActive = false;
try {
  // Electron's Windows safeStorage encryption is application-name scoped. The
  // previous release used this name, so keep it only until legacy migration
  // has finished and restore the current name before creating the main window.
  app.setName('ai-tag-toolbox');
  legacyApplicationNameActive = true;
} catch { /* optional migration compatibility */ }

function restoreApplicationName() {
  if (!legacyApplicationNameActive) return;
  try { app.setName(originalApplicationName); } catch { /* keep the active name */ }
  legacyApplicationNameActive = false;
}

function readStorageRoot(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function markerComplete(root) {
  try { return JSON.parse(root?.[LEGACY_MIGRATION_MARKER_KEY] || 'false') === true; } catch { return false; }
}

async function readLegacyLocalStorage(legacyUserDataDir) {
  if (!legacyUserDataDir || !fs.existsSync(path.join(legacyUserDataDir, 'Local Storage', 'leveldb'))) return null;
  const legacySession = session.fromPath(legacyUserDataDir, { cache: false });
  const reader = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    width: 1,
    height: 1,
    webPreferences: {
      session: legacySession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  try {
    await reader.loadFile(path.join(__dirname, 'src', 'legacy-storage-reader.html'));
    const keys = JSON.stringify(LEGACY_STORAGE_KEYS);
    return await reader.webContents.executeJavaScript(
      `Object.fromEntries(${keys}.map(key => [key, localStorage.getItem(key)]))`
    );
  } finally {
    if (!reader.isDestroyed()) reader.destroy();
  }
}

function removeLegacyStorageSession(sessionDir) {
  try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch { /* a live Session may release the directory on next launch */ }
}

function copyLegacyStorageSession(sourceUserDataDir, sessionDir) {
  const source = path.join(sourceUserDataDir, 'Local Storage');
  if (!fs.existsSync(path.join(source, 'leveldb'))) return '';
  removeLegacyStorageSession(sessionDir);
  try {
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.cpSync(source, path.join(sessionDir, 'Local Storage'), { recursive: true });
    return sessionDir;
  } catch {
    removeLegacyStorageSession(sessionDir);
    return '';
  }
}

function readLegacyEncryptedKey(legacyUserDataDir) {
  const currentName = (() => { try { return app.getName(); } catch { return ''; } })();
  try {
    if (!safeStorage?.isEncryptionAvailable?.()) return '';
    const keyPath = path.join(legacyUserDataDir, 'secure', 'api-key.bin');
    if (!fs.existsSync(keyPath)) return '';
    try { app.setName('ai-tag-toolbox'); } catch { /* use the active name if Electron rejects the switch */ }
    return String(safeStorage.decryptString(fs.readFileSync(keyPath)) || '').trim();
  } catch {
    return '';
  } finally {
    try { if (currentName) app.setName(currentName); } catch { /* preserve migration result */ }
  }
}

async function migrateLegacyUserData() {
  const appDataDir = app.getPath('appData');
  const currentDir = path.join(appDataDir, 'ai-tag-toolbox-rewrite');
  const targetPath = path.join(currentDir, 'rewrite-storage.json');
  const legacySessionDir = path.join(currentDir, 'legacy-storage-import');
  const currentRoot = readStorageRoot(targetPath);
  if (markerComplete(currentRoot)) {
    removeLegacyStorageSession(legacySessionDir);
    return false;
  }
  try {
    const legacyUserDataDir = path.join(appDataDir, 'ai-tag-toolbox');
    const copiedSession = copyLegacyStorageSession(legacyUserDataDir, legacySessionDir);
    const snapshot = (await readLegacyLocalStorage(copiedSession)) || {};
    const legacyKey = readLegacyEncryptedKey(legacyUserDataDir);
    if (legacyKey) {
      let ai = {};
      try { ai = snapshot.dbt_ai_v2 ? JSON.parse(snapshot.dbt_ai_v2) : {}; } catch { ai = {}; }
      snapshot.dbt_ai_v2 = JSON.stringify({ ...(ai && typeof ai === 'object' ? ai : {}), key: legacyKey });
    }
    const migration = mergeLegacyStorageSnapshot(currentRoot, snapshot);
    if (legacyKey && migration.root['ai-tag-toolbox-rewrite:app:rewrite_settings']) {
      try {
        const settings = JSON.parse(migration.root['ai-tag-toolbox-rewrite:app:rewrite_settings']);
        if (settings && typeof settings === 'object' && !Array.isArray(settings) && !String(settings.key || '').trim()) {
          settings.key = legacyKey;
          migration.root['ai-tag-toolbox-rewrite:app:rewrite_settings'] = JSON.stringify(settings);
          migration.changed = true;
          migration.migratedKeys?.push?.('settings.key');
        }
      } catch { /* malformed settings remain untouched */ }
    }
    if (!migration.changed) return false;
    fs.mkdirSync(currentDir, { recursive: true });
    const backupPath = path.join(currentDir, 'rewrite-storage.before-legacy-migration.json');
    if (fs.existsSync(targetPath) && !fs.existsSync(backupPath)) fs.copyFileSync(targetPath, backupPath);
    fs.writeFileSync(targetPath, JSON.stringify(migration.root, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.warn('[V1.4.191] 旧版配置迁移失败：', error?.message || error);
    return false;
  }
}

function openExternalUrl(url) {
  try {
    const parsed = new URL(String(url));
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    shell.openExternal(parsed.toString()).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function isSponsorUrl(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'https:'
      && parsed.hostname.toLowerCase() === 'ifdian.net'
      && parsed.pathname.replace(/\/+$/, '').toLowerCase() === '/a/ai-tag-toolbox';
  } catch {
    return false;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    title: 'AI 绘画 Tag 工具箱 V1.4.191',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.setMenuBarVisibility(false);
  // The sponsor page opens in the user's default browser. Other target=_blank
  // links (for example generated image previews) keep their existing Electron
  // behavior, while non-http URLs are never forwarded to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSponsorUrl(url)) {
      openExternalUrl(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL() && isSponsorUrl(url) && openExternalUrl(url)) event.preventDefault();
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(async () => {
  try {
    await migrateLegacyUserData();
  } finally {
    restoreApplicationName();
  }
  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
