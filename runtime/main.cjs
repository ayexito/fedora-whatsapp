'use strict';

const HOME = 'https://web.whatsapp.com/';
const TITLE = 'WhatsApp pour Fedora — non officiel';

function chromiumUserAgent(value) {
  // Branded desktop tokens trigger WhatsApp's browser rejection; retain the actual Linux Chromium identity.
  return value.replace(/\s(?:WhatsApppourFedora|Electron)\/[^\s]+/g, '');
}

function trustedURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'web.whatsapp.com'
      && (url.port === '' || url.port === '443') && !url.username && !url.password;
  } catch { return false; }
}

const WEB_PREFERENCES = Object.freeze({
  sandbox: true, contextIsolation: true, nodeIntegration: false,
  nodeIntegrationInWorker: false, webviewTag: false, webSecurity: true,
  allowRunningInsecureContent: false, devTools: false,
});

async function boot() {
  const { app, BrowserWindow, Menu, dialog, session, nativeTheme } = require('electron');
  const fs = require('node:fs');
  const path = require('node:path');
  if (['no-sandbox', 'disable-web-security', 'ignore-certificate-errors', 'allow-insecure-localhost']
    .some(flag => app.commandLine.hasSwitch(flag))) throw new Error('Unsafe browser switches are forbidden');
  const profile = process.env.WA_PROFILE;
  if (!profile || !path.isAbsolute(profile)) throw new Error('An absolute private profile is required');
  const stat = fs.lstatSync(profile);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) {
    throw new Error('The profile must be a private real directory');
  }
  // Keep the graphics-driver workaround local to the affected profile.
  if (fs.existsSync(path.join(profile, 'software-rendering'))) app.disableHardwareAcceleration();
  app.setName('WhatsApp pour Fedora');
  app.userAgentFallback = chromiumUserAgent(app.userAgentFallback);
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  app.setDesktopName(`${process.env.WA_DESKTOP_ID}.desktop`);
  app.enableSandbox();
  let window;
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  const focus = () => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show(); window.focus();
    }
  };
  app.on('second-instance', focus);
  app.on('activate', focus);
  app.on('window-all-closed', () => app.quit());
  app.on('certificate-error', (event, _contents, _url, _error, _certificate, callback) => {
    event.preventDefault(); callback(false);
  });
  // This pipe connects only local controllers. The renderer has no preload or IPC bridge.
  let commands = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    commands += chunk;
    if (commands.length > 256) { app.quit(); return; }
    let newline;
    while ((newline = commands.indexOf('\n')) !== -1) {
      const command = commands.slice(0, newline);
      commands = commands.slice(newline + 1);
      if (command === 'quit') app.quit();
      else if (command === 'focus') focus();
      else if (command === 'reload' && window && !window.isDestroyed()) window.webContents.reload();
    }
  });
  process.stdin.on('end', () => app.quit());
  process.on('SIGTERM', () => app.quit());
  await app.whenReady();
  const browserSession = session.defaultSession;
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browserSession.setDevicePermissionHandler(() => false);
  // Downloads require the user-selected destination implemented in Stage 2.
  browserSession.on('will-download', event => event.preventDefault());
  window = new BrowserWindow({
    title: TITLE, width: 1280, height: 820, minWidth: 800, minHeight: 600,
    show: true, autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111b21' : '#f7f5f3',
    webPreferences: WEB_PREFERENCES,
  });
  window.on('page-title-updated', event => { event.preventDefault(); window.setTitle(TITLE); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => { if (!trustedURL(event.url)) event.preventDefault(); });
  window.webContents.on('will-frame-navigate', event => {
    if (event.isMainFrame && !trustedURL(event.url)) event.preventDefault();
  });
  window.webContents.on('will-redirect', event => {
    if (event.isMainFrame && !trustedURL(event.url)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Application', submenu: [
      { label: 'Recharger', accelerator: 'CommandOrControl+R', click: () => window.webContents.reload() },
      { label: 'À propos', click: () => process.stdout.write('about\n') },
      { type: 'separator' },
      { label: 'Quitter', accelerator: 'CommandOrControl+Q', click: () => app.quit() },
    ] },
    { label: 'Édition', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]));
  let retryDialog = false;
  async function loadFailure() {
    if (retryDialog || !window || window.isDestroyed()) return;
    retryDialog = true;
    focus();
    const { response } = await dialog.showMessageBox(window, {
      type: 'error', title: TITLE, message: 'Connexion à WhatsApp impossible',
      detail: 'Vérifiez votre connexion puis réessayez. Les erreurs de certificat ne sont jamais ignorées.',
      buttons: ['Réessayer', 'Quitter'], defaultId: 0, cancelId: 1,
    });
    retryDialog = false;
    if (response === 0) window.loadURL(HOME).catch(() => {}); else app.quit();
  }
  window.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
    if (mainFrame && code !== -3) loadFailure();
  });
  window.webContents.on('render-process-gone', () => loadFailure());

  // Only isolated debug smoke runs request this report. Account content never leaves the renderer.
  const reportPath = process.env.WA_SMOKE_REPORT;
  if (reportPath) {
    const cookieURL = 'https://profile-check.invalid/';
    const cookies = await browserSession.cookies.get({ url: cookieURL });
    const persisted = cookies.some(cookie => cookie.name === 'wa-profile-check' && cookie.value === 'test-only');
    await browserSession.cookies.set({ url: cookieURL, name: 'wa-profile-check', value: 'test-only', expirationDate: Date.now() / 1000 + 86400, secure: true });
    await browserSession.cookies.flushStore();
    let reported = false;
    window.webContents.on('did-finish-load', async () => {
      if (reported) return;
      reported = true;
      try {
        const page = await window.webContents.executeJavaScript(`new Promise(resolve => {
          let observer, timeout;
          const snapshot = () => ({
            authentic: location.origin === 'https://web.whatsapp.com',
            login: /scan to log in|log in(?:to| to)? whatsapp|link a device|open whatsapp on your phone|scanner le code qr|connectez-vous à whatsapp/i.test(document.body.innerText),
            unsupported: /browser is not supported|update your browser|navigateur non pris en charge|whatsapp works with google chrome/i.test(document.body.innerText),
            webrtc: typeof RTCPeerConnection === 'function' && typeof navigator.mediaDevices?.getUserMedia === 'function',
            node_exposed: Boolean(globalThis.process?.versions?.node),
            page_require_is_node: typeof globalThis.require?.resolve === 'function' && typeof globalThis.require?.cache === 'object',
          });
          const finish = () => { observer?.disconnect(); clearTimeout(timeout); resolve(snapshot()); };
          const check = () => { const state = snapshot(); if (state.login || state.unsupported) finish(); };
          observer = new MutationObserver(check);
          observer.observe(document.body, {subtree: true, childList: true, characterData: true});
          timeout = setTimeout(finish, 30000);
          check();
        })`);
        const preferences = window.webContents.getLastWebPreferences();
        const result = { ...page, persisted, native_title: window.getTitle(), sandbox: preferences.sandbox, context_isolation: preferences.contextIsolation, node_integration: preferences.nodeIntegration, preload: Boolean(preferences.preload), hardware_acceleration: app.isHardwareAccelerationEnabled(), electron: process.versions.electron, chromium: process.versions.chrome, browser_pid: process.pid, renderer_pid: window.webContents.getOSProcessId() };
        fs.writeFileSync(reportPath, JSON.stringify(result), { flag: 'wx', mode: 0o600 });
      } catch { process.stderr.write('Smoke report unavailable\n'); }
    });
  }
  window.loadURL(HOME).catch(() => {});
}

module.exports = { trustedURL, chromiumUserAgent, WEB_PREFERENCES };
if (process.versions.electron && process.type === 'browser') {
  boot().catch(() => { process.stderr.write('Chromium startup failed\n'); process.exit(1); });
}
