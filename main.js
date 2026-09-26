'use strict';

const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { createUpdateService, createUpdateHost, registerUpdateIpc } = require(path.join(__dirname, 'src', 'modules'));

function argumentValue(name, fallback = '') {
  const prefix = `${name}=`;
  const argv = Array.isArray(process.argv) ? process.argv : [];
  return argv.find(value => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function installRoot() { return path.resolve(argumentValue('--update-root', app.isPackaged ? path.dirname(process.execPath) : __dirname)); }

async function markLaunchReady(win) {
  const root = argumentValue('--update-root');
  if (!root || !win || win.isDestroyed()) return;
  try {
    const statePath = path.join(root, 'version-state.json');
    const state = JSON.parse(await fs.promises.readFile(statePath, 'utf8'));
    const attempt = state.launchAttempt;
    if (!attempt?.nonce) return;
    const version = require('./package.json').version;
    const next = { ...state, launchAttempt: null, launchReady: { nonce: attempt.nonce, version, readyAt: new Date().toISOString() } };
    const temporary = `${statePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(next, null, 2) + '\n', 'utf8');
    await fs.promises.rename(temporary, statePath);
  } catch { /* launcher timeout handles rollback */ }
}

async function runUpdateHost() {
  const rootDir = installRoot();
  const host = createUpdateHost({ rootDir });
  await host.run({
    parentPid: Number(argumentValue('--update-parent', '0')) || 0,
    launcherPath: argumentValue('--update-launcher', path.join(rootDir, 'AI绘画Tag工具箱.exe'))
  });
  app.quit();
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
    title: 'AI 绘画 Tag 工具箱 V1.4.356',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.setMenuBarVisibility(false);
  // Window chrome owns maximization state; the renderer only receives a
  // presentation class, including after a reload while already maximized.
  function syncMaximizedLayout() {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    const maximized = win.isMaximized();
    win.webContents.executeJavaScript(`document.documentElement.classList.toggle('window-maximized', ${maximized}); window.dispatchEvent(new Event('resize'));`)
      .catch(() => {});
  }
  win.on('maximize', syncMaximizedLayout);
  win.on('unmaximize', syncMaximizedLayout);
  win.webContents.on('dom-ready', syncMaximizedLayout);
  win.webContents.once('did-finish-load', () => { void markLaunchReady(win); });
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
  let closeReady = false;
  let savingBeforeClose = false;
  win.on('close', event => {
    if (closeReady || win.webContents.isDestroyed()) return;
    event.preventDefault();
    if (savingBeforeClose) return;
    savingBeforeClose = true;
    win.webContents.executeJavaScript('window.App?.flushBeforeClose ? window.App.flushBeforeClose() : window.AppModules?.prepareClose?.()')
      .catch(() => false)
      .then(saved => {
        if (saved === false) { savingBeforeClose = false; return; }
        closeReady = true; if (!win.isDestroyed()) win.close();
      });
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.show();
  win.focus();
  return win;
}

if ((Array.isArray(process.argv) ? process.argv : []).includes('--run-update-host')) {
  app.whenReady().then(runUpdateHost).catch(() => app.quit());
} else {
  let updateIpcDispose = null;
  let updateHostRequested = false;
  function registerUpdateBridge(win) {
    if (!ipcMain || typeof ipcMain.handle !== 'function') return;
    const rootDir = installRoot();
    const service = createUpdateService({ rootDir });
    updateIpcDispose = registerUpdateIpc({
      ipcMain,
      service,
      getWindow: () => win,
      prepareClose: async () => {
        if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return true;
        return win.webContents.executeJavaScript('(()=>{if(window.AppModules?.assistant?.snapshot?.().busy)return false;return window.App?.flushBeforeClose?window.App.flushBeforeClose():window.AppModules?.prepareClose?.()})()').catch(() => false);
      },
      requestHost: async () => {
        const launcher = path.join(rootDir, 'AI绘画Tag工具箱.exe');
        const launcherPath = fs.existsSync(launcher) ? launcher : process.execPath;
        const child = spawn(process.execPath, [
          '--run-update-host', `--update-root=${rootDir}`, `--update-parent=${process.pid}`, `--update-launcher=${launcherPath}`
        ], { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();
        updateHostRequested = true;
        if (win && !win.isDestroyed()) win.destroy();
        app.quit();
      }
    });
  }
  const primaryInstance = app.requestSingleInstanceLock();
  if (!primaryInstance) app.quit();
  else {
    app.on('second-instance', () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show(); win.focus();
    });
    app.whenReady().then(() => {
      const win = createWindow();
      registerUpdateBridge(win);
      app.on('activate', () => {
        if (!BrowserWindow.getAllWindows().length) createWindow();
      });
    });
    app.on('will-quit', () => { if (!updateHostRequested) updateIpcDispose?.(); });
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
  }
}


