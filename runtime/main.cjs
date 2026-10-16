'use strict';

const HOME = 'https://web.whatsapp.com/';
const TITLE = 'Fedora WhatsApp — non officiel';

function chromiumUserAgent(value) {
  // Branded desktop tokens trigger WhatsApp's browser rejection; retain the actual Linux Chromium identity.
  return value.replace(/\s(?:FedoraWhatsApp|WhatsApppourFedora|Electron)\/[^\s]+/g, '');
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
  const { app, BrowserWindow, WebContentsView, Menu, dialog, session, nativeTheme, shell, ipcMain } = require('electron');
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
  app.setName('Fedora WhatsApp');
  app.userAgentFallback = chromiumUserAgent(app.userAgentFallback);
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  app.setDesktopName(`${process.env.WA_DESKTOP_ID}.desktop`);
  app.enableSandbox();
  let window, contents, requestMedia, quitting = false;
  app.on('before-quit', () => { quitting = true; });
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  const focus = () => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show(); window.focus(); contents?.focus();
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
      else if (command === 'reload' && window && !window.isDestroyed()) contents.reload();
      else if (command === 'media') requestMedia?.(['audio', 'video']);
    }
  });
  process.stdin.on('end', () => app.quit());
  process.on('SIGTERM', () => app.quit());
  await app.whenReady();
  const browserSession = session.defaultSession;
  browserSession.setDevicePermissionHandler(() => false);
  let pendingBlobDownload;
  async function openFailure(message, detail = 'Vérifiez l’application par défaut dans les paramètres Fedora. Vous pouvez aussi ouvrir le fichier depuis son dossier.') {
    if (!window.isDestroyed()) await dialog.showMessageBox(window, {
      type: 'error', title: TITLE, message,
      detail,
      buttons: ['Fermer'], noLink: true,
    }).catch(() => {});
  }
  const openableDocument = file => {
    try {
      const stat = fs.lstatSync(file);
      return path.isAbsolute(file) && stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o111)
        && /\.(pdf|docx?|xlsx?|pptx?|od[stpg]|rtf|txt|csv|png|jpe?g|webp|gif|mp[34]|m4[av]|ogg|opus|wav|webm|mov)$/i.test(file);
    } catch { return false; }
  };
  browserSession.on('will-download', (event, item, sourceContents) => {
    // The initiator identifies the page; attachment URLs may be blobs or CDN links.
    if (!window || window.isDestroyed() || sourceContents !== contents || contents.isDestroyed()
      || !trustedURL(contents.getURL())) {
      event.preventDefault(); return;
    }
    // Main-process blob downloads lack an initiator; authorize only the exact requested URL once.
    const popupDownload = Boolean(pendingBlobDownload) && item.getURL() === pendingBlobDownload;
    if (!trustedURL(item.getInitiatorOrigin()) && !(popupDownload && !item.getInitiatorOrigin())) {
      event.preventDefault(); return;
    }
    if (popupDownload) pendingBlobDownload = undefined;
    let filename = path.basename(item.getFilename().replace(/\\/g, '/')).replace(/[\x00-\x1f\x7f]/g, '_');
    if (!filename || filename === '.' || filename === '..') filename = 'pièce-jointe';
    if (popupDownload && item.getMimeType() === 'application/pdf' && !path.extname(filename)) filename += '.pdf';
    item.setSaveDialogOptions({
      title: 'Enregistrer la pièce jointe', buttonLabel: 'Enregistrer',
      defaultPath: path.join(app.getPath('downloads'), filename),
      properties: ['showOverwriteConfirmation'],
    });
    item.once('done', (_event, state) => {
      if (window.isDestroyed() || state === 'cancelled') return;
      const completed = state === 'completed', savedPath = completed ? item.getSavePath() : '';
      const buttons = completed ? ['Fermer', 'Afficher dans le dossier'] : ['Fermer'];
      if (completed && openableDocument(savedPath)) buttons.push('Ouvrir');
      dialog.showMessageBox(window, {
        type: completed ? 'info' : 'error', title: TITLE,
        message: completed ? 'Téléchargement terminé' : 'Téléchargement interrompu',
        detail: completed ? path.basename(savedPath) : 'Vérifiez votre connexion et l’espace disque, puis réessayez depuis WhatsApp.',
        buttons,
        defaultId: 0, cancelId: 0, noLink: true,
      }).then(async ({ response }) => {
        if (completed && response === 1) shell.showItemInFolder(savedPath);
        if (completed && buttons[response] === 'Ouvrir') {
          try {
            if (!openableDocument(savedPath) || await shell.openPath(savedPath)) throw new Error('Open failed');
          } catch { await openFailure('Impossible d’ouvrir cette pièce jointe'); }
        }
      }).catch(() => {});
    });
  });
  window = new BrowserWindow({
    title: TITLE, width: 1280, height: 820, minWidth: 800, minHeight: 600,
    show: true, frame: false, autoHideMenuBar: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111b21' : '#f7f5f3',
    webPreferences: { ...WEB_PREFERENCES, preload: __filename },
  });
  window.on('close', event => {
    if (!quitting) { event.preventDefault(); window.hide(); }
  });
  // A local title bar keeps its controls and preload separate from the remote client.
  const titlebarURL = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
    <html lang="fr"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <title>${TITLE}</title><style>
    :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;background:light-dark(#f7f5f3,#111b21);color:light-dark(#202c33,#e9edef);font:13px system-ui}
    header{height:40px;display:flex;align-items:center;app-region:drag;user-select:none}
    span{flex:1;min-width:0;padding:0 14px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    button{app-region:no-drag;width:46px;height:40px;border:0;background:transparent;color:inherit;font:20px system-ui;cursor:default}
    button:hover{background:light-dark(#dedddb,#2a3942)}button:focus-visible{outline:2px solid #25d366;outline-offset:-3px}
    #close:hover{background:#c42b1c;color:white}</style>
    <header aria-label="Barre de titre"><span>Fedora WhatsApp</span>
    <button id="minimize" aria-label="Réduire" title="Réduire">−</button>
    <button id="maximize" aria-label="Agrandir ou restaurer" title="Agrandir ou restaurer">□</button>
    <button id="close" aria-label="Fermer" title="Fermer">×</button></header></html>`);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  ipcMain.on('window-control', (event, action) => {
    if (window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== titlebarURL) return;
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') {
      if (window.isMaximized()) window.unmaximize(); else window.maximize();
    } else if (action === 'close') window.close();
  });
  const client = new WebContentsView({ webPreferences: WEB_PREFERENCES });
  contents = client.webContents;
  window.contentView.addChildView(client);
  const resizeClient = () => {
    const { width, height } = window.contentView.getBounds();
    client.setBounds({ x: 0, y: 40, width, height: Math.max(0, height - 40) });
  };
  // Wayland can lay out the native view after the window's resize event.
  window.contentView.on('bounds-changed', resizeClient);
  resizeClient();
  window.on('focus', () => contents.focus());
  window.on('closed', () => { if (!contents.isDestroyed()) contents.close(); });
  window.loadURL(titlebarURL).catch(() => app.quit());
  const mediaGrants = new Set();
  const permissionFile = path.join(profile, 'media-permissions.json');
  let mediaSetupDone = false;
  try {
    const fd = fs.openSync(permissionFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || (stat.mode & 0o077) || stat.size > 512) throw new Error('Unsafe permissions file');
      const saved = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (saved.origin !== new URL(HOME).origin || !Array.isArray(saved.grants)
        || !saved.grants.every(type => ['audio', 'video', 'speaker', 'notifications'].includes(type))) throw new Error('Invalid permissions');
      saved.grants.forEach(type => mediaGrants.add(type));
      mediaSetupDone = true;
    } finally { fs.closeSync(fd); }
  } catch { /* Missing or invalid consent never grants access. */ }
  const saveMediaGrants = grants => {
    const temporary = `${permissionFile}.${require('node:crypto').randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ origin: new URL(HOME).origin, grants: [...grants] }), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, permissionFile);
      mediaSetupDone = true;
    } finally { fs.rmSync(temporary, { force: true }); }
  };
  let permissionGeneration = 0, permissionQueue = Promise.resolve();
  const mediaContext = (sourceContents, details) => sourceContents === contents
    && !window.isDestroyed() && !sourceContents.isDestroyed()
    && details?.isMainFrame === true && trustedURL(details.requestingUrl)
    && (!details.securityOrigin || trustedURL(details.securityOrigin))
    && trustedURL(sourceContents.getURL());
  browserSession.setPermissionCheckHandler((sourceContents, permission, origin, details) => {
    if (!mediaContext(sourceContents, details) || !trustedURL(origin)
      || (details.securityOrigin && !trustedURL(details.securityOrigin))) return false;
    if (permission === 'speaker-selection') return mediaGrants.has('speaker');
    if (permission === 'notifications') return mediaGrants.has('notifications');
    return permission === 'media' && ['audio', 'video'].includes(details.mediaType)
      && mediaGrants.has(details.mediaType);
  });
  const requestPermission = (sourceContents, permission, callback, details) => {
    const types = permission === 'notifications' ? ['notifications'] : permission === 'speaker-selection' ? ['speaker']
      : permission === 'media' && Array.isArray(details?.mediaTypes)
        && details.mediaTypes.every(type => ['audio', 'video'].includes(type)) ? [...new Set(details.mediaTypes)] : [];
    if (!types.length || !mediaContext(sourceContents, details)) { callback(false); return; }
    const generation = permissionGeneration, url = sourceContents.getURL();
    const current = () => generation === permissionGeneration
      && mediaContext(sourceContents, details) && sourceContents.getURL() === url;
    // Serialize consent prompts and never extend a grant to another origin.
    permissionQueue = permissionQueue.then(async () => {
      let allowed = false;
      try {
        if (current()) {
          const missing = types.filter(type => !mediaGrants.has(type));
          if (!missing.length) allowed = true;
          else {
            const labels = { audio: 'microphone', video: 'caméra', speaker: 'choix des haut-parleurs', notifications: 'notifications du bureau' };
            const { response } = await dialog.showMessageBox(window, {
              type: 'question', title: TITLE,
              message: `Autoriser https://web.whatsapp.com à utiliser : ${missing.map(type => labels[type]).join(', ')} ?`,
              detail: 'Votre choix est mémorisé sur cet ordinateur. Le menu Application permet de modifier ou révoquer ces autorisations. Aucune capture ne démarre avec ce dialogue.',
              buttons: ['Refuser', 'Autoriser et mémoriser'], defaultId: 0, cancelId: 0, noLink: true,
            });
            allowed = response === 1 && current();
            if (current()) {
              saveMediaGrants(allowed ? new Set([...mediaGrants, ...missing]) : mediaGrants);
              if (allowed) missing.forEach(type => mediaGrants.add(type));
            }
          }
        }
      } catch {
        allowed = false;
        await openFailure('Impossible de mémoriser les autorisations', 'L’accès demandé reste refusé. Vérifiez les droits et l’espace disque du dossier de session.');
      }
      callback(allowed);
    }).catch(() => {});
  };
  browserSession.setPermissionRequestHandler(requestPermission);
  // A denied permission query can stop the web client from requesting consent itself.
  requestMedia = mediaTypes => {
    if (window.isDestroyed()) return;
    focus();
    requestPermission(contents, 'media', allowed => {
      if (allowed) contents.reload();
    }, { isMainFrame: true, requestingUrl: contents.getURL(), mediaTypes });
  };
  contents.on('did-finish-load', () => {
    if (!mediaSetupDone && trustedURL(contents.getURL())) requestMedia(['audio', 'video']);
  });
  contents.on('did-start-navigation', details => {
    if (details.isMainFrame && !details.isSameDocument) { permissionGeneration++; pendingBlobDownload = undefined; }
  });
  window.on('page-title-updated', event => { event.preventDefault(); window.setTitle(TITLE); });
  const openLink = value => {
    if (window.isDestroyed() || !trustedURL(contents.getURL())) return;
    let url;
    try { url = new URL(value); } catch { return; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
    shell.openExternal(url.href).catch(() => openFailure('Impossible d’ouvrir le lien dans votre navigateur'));
  };
  const downloadBlob = value => {
    if (window.isDestroyed() || !trustedURL(contents.getURL()) || pendingBlobDownload) return;
    let url;
    try { url = new URL(value); } catch { return; }
    if (url.protocol !== 'blob:' || !trustedURL(url.origin)) return;
    pendingBlobDownload = url.href;
    try { contents.downloadURL(url.href); }
    catch { pendingBlobDownload = undefined; openFailure('Impossible de télécharger la pièce jointe'); }
  };
  contents.setWindowOpenHandler(({ url }) => {
    downloadBlob(url); openLink(url);
    return { action: 'deny' };
  });
  contents.on('will-frame-navigate', event => {
    if (event.isMainFrame && !trustedURL(event.url)) {
      event.preventDefault();
      if (event.initiator === contents.mainFrame && trustedURL(event.initiator.url)) {
        downloadBlob(event.url); openLink(event.url);
      }
    }
  });
  contents.on('will-redirect', event => {
    if (event.isMainFrame && !trustedURL(event.url)) event.preventDefault();
  });
  contents.on('will-attach-webview', event => event.preventDefault());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Application', submenu: [
      { label: 'Recharger', accelerator: 'CommandOrControl+R', click: () => contents.reload() },
      { label: 'À propos', click: () => process.stdout.write('about\n') },
      { label: 'Autoriser le microphone…', accelerator: 'CommandOrControl+Shift+M', click: () => requestMedia(['audio']) },
      { label: 'Autoriser le microphone et la caméra…', accelerator: 'CommandOrControl+Shift+V', click: () => requestMedia(['audio', 'video']) },
      { label: 'Autoriser les notifications…', click: () => {
        requestPermission(contents, 'notifications', allowed => { if (allowed) contents.reload(); },
          { isMainFrame: true, requestingUrl: contents.getURL() });
      } },
      { label: 'Désactiver les notifications et recharger', click: () => {
        mediaGrants.delete('notifications'); permissionGeneration++;
        try { saveMediaGrants(mediaGrants); }
        catch { openFailure('Impossible de mémoriser ce choix', 'Les notifications peuvent revenir au prochain lancement. Vérifiez les droits du dossier de session, puis réessayez.'); }
        contents.reload();
      } },
      { label: 'Révoquer les autorisations audio/vidéo et recharger', click: () => {
        for (const type of ['audio', 'video', 'speaker']) mediaGrants.delete(type);
        permissionGeneration++;
        try { saveMediaGrants(mediaGrants); }
        catch {
          try { fs.unlinkSync(permissionFile); mediaSetupDone = true; }
          catch {
            openFailure('Révocation limitée à cette session', 'Les anciennes autorisations restent sur disque et peuvent revenir au prochain lancement. Vérifiez les droits du dossier de session, puis réessayez la révocation.');
          }
        }
        contents.reload();
      } },
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
    if (response === 0) contents.loadURL(HOME).catch(() => {}); else app.quit();
  }
  contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
    if (mainFrame && code !== -3) loadFailure();
  });
  contents.on('render-process-gone', () => loadFailure());

  // Only isolated debug smoke runs request this report. Account content never leaves the renderer.
  const reportPath = process.env.WA_SMOKE_REPORT;
  if (reportPath) {
    const cookieURL = 'https://profile-check.invalid/';
    const cookies = await browserSession.cookies.get({ url: cookieURL });
    const persisted = cookies.some(cookie => cookie.name === 'wa-profile-check' && cookie.value === 'test-only');
    await browserSession.cookies.set({ url: cookieURL, name: 'wa-profile-check', value: 'test-only', expirationDate: Date.now() / 1000 + 86400, secure: true });
    await browserSession.cookies.flushStore();
    let reported = false;
    contents.on('did-finish-load', async () => {
      if (reported) return;
      reported = true;
      try {
        const page = await contents.executeJavaScript(`new Promise(resolve => {
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
        const preferences = contents.getLastWebPreferences();
        const result = { ...page, persisted, native_title: window.getTitle(), sandbox: preferences.sandbox, context_isolation: preferences.contextIsolation, node_integration: preferences.nodeIntegration, preload: Boolean(preferences.preload), hardware_acceleration: app.isHardwareAccelerationEnabled(), electron: process.versions.electron, chromium: process.versions.chrome, browser_pid: process.pid, renderer_pid: contents.getOSProcessId() };
        fs.writeFileSync(reportPath, JSON.stringify(result), { flag: 'wx', mode: 0o600 });
      } catch { process.stderr.write('Smoke report unavailable\n'); }
    });
  }
  contents.loadURL(HOME).catch(() => {});
}

module.exports = { trustedURL, chromiumUserAgent, WEB_PREFERENCES };
if (process.versions.electron && process.type === 'browser') {
  boot().catch(() => { process.stderr.write('Chromium startup failed\n'); process.exit(1); });
} else if (process.versions.electron && process.type === 'renderer') {
  // Only the local title bar loads this preload. WhatsApp receives no native bridge.
  const { ipcRenderer } = require('electron');
  window.addEventListener('DOMContentLoaded', () => {
    for (const action of ['minimize', 'maximize', 'close']) {
      document.getElementById(action)?.addEventListener('click', () => ipcRenderer.send('window-control', action));
    }
  });
}
