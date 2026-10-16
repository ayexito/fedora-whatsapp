'use strict';

const HOME = 'https://web.whatsapp.com/';
const TITLE = 'Fedora WhatsApp — non officiel';
// PNG rendition of data/io.github.whatsapp_fedora.Desktop.svg for the native tray.
const TRAY_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAFUUlEQVRYw6XXW4xdZRUH8N+3z+l0oJVaW2mqomhnhqAz0yFqUAwPEn0wGAkxivEWgxZaFaP44gOJ0XhDJTUp0WmLEZREEbUKUn1Qn4h3aKYzdHRGp1AkFS1ip4N0Lud8Ppy1z9kz0+lQXcnO/vZtrfWt9V//tXZyjtI7esOZHyRkJgf2nZO+tNoLPZM3SadnOxZCciYlNZhPubEmL1dVz/PGB7/1vzuweLcZaQuGcBlegY2h4yQexQgOpXrj8bxQa395tqik1Q2DPrwP18R67Qr6FnAUB3HXif7hQ5vHdrYMpWyif//qDlxyeKdmapaX5+N6fBzb4t40/oIp/DNC8wK8HL2xhuP4Bm7H06DJ5PZ9KzvQe+R6GvXy8kJ8Ce9HDY/jHvwY4xH2Rrxb4HnowdV4Ny6JZz/BzeEwKZusRKK+yJ2O8Rfi63h7GPkuvpgZXQE0zXDooTjuxicjetdgQ6yPWgLW9lUl793YjZ2Yxa34Mp6p2pscuGM17KzBjfg8LsCBcOLfVWAWVYyHvCtezPgqPrfYeOuz3tEblzkwObBPozZXXs4rarfjltjItdiVYs894WxReh6heAk+gS7cFzufD4WXxY6GlrlckalX3tkpu2YD9uKueLwry/3V0BdQ5Dbqr8UgTkTop+P+UOBgOIC5DraNfMhKUqn9OdwWILwI71kcSzRTAevDAXgAv2/tIsGOCqrfgMuhKApnk3oui8QEvh/rt2LLIgdCtsXuF6J0Wl8XeV3cL2U93klalcbHB79ZvfwpTkWpDkDv2A5F75E2ci/FpiCQkcqHDZxeontuJQwslfOaz5bLPwdLdpcOtPbX2cdL43w8MCC1jJzGgxWdD0d1PCcPDm//Trk8iWOxfhnISZHaabIhztMBHLlDE9/DX2PdVU1d39iO5xQJ8kLJAbjg1NpWudYr+6jSKpjs36d37IYyfLcGr/fjM/gIZnJOK84IjSZTwf1JSrmju3n+XJeEYvrE+vL9f8V5YzShpa3q2yhJ/L3h0KbK825cFxVSh1rRYcfcYsbNpa1abuWw2LCxTXJTUQEvxlboG91RredZfDoaUoEPBze8KRz+IO6MEt6P1y2pss3RMUU3dWH3M4qJob3lC+N4Mrrg5VUMLNTbep7Cx4LZmngzfoif47MRhU34APZENEsZCqBP4zAcf3b9Ig8fa5NPqwueJ2r16KXD1XT8Ax/Fp/BENJorK3NA9b0Ib66FzrVh/AhMDe5d5MBchHceb8RbyuSVgJTaiJ3JfCV6/234U1k5AeY/4Asd/khX4G3x/AeYLsm/3gZbS/cvwsNX4+oiNX/UzB0fy0Gi0rxGpDwip93RrC4KDnkw+ESk5JY4H8K91VJbOg9sxS+DFW/G7tTGQquRTgwMg/6HbzK7ZtYqsk4rUrvwn2jz98w3Co8ODXci0NOp4/5A6jR+28lARpYrQ8fYwJ5Fls7ABVsCmGXL3BOA1VVrd99lKXh9IPmRGLMvxvZIySh+hhln+0FpfX9VgPTK0Dwck9ECTFTG9DptbHXjirj/fNyBVwUv1Cs94UBE54kIa46K2YrXxAx4VXTNU/haDDYzztBAUs/YLqnVt/vwqzBYlRNxXBxOijH779FgcpTilgrTNfDryP/BkubrTcaXjOX1lNs+vTZ2cTJY8SH8Js5PRnreEQz3ogBqVebxN/wxcn2wQu+6iqc9MnDvsnzVc25IrdliJpD/O0xSPNUiu7YcwP0Rob6ISPXX7FhMPsc6nJBRmBzYayWpxz+fmIIq0gwVSdGuAQvBmI+dtfhS/AUN7rea1LMcg0eHa8/1F/v/kf8CvkGu4ZoNXbEAAAAASUVORK5CYII=';

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
  const { app, BrowserWindow, WebContentsView, Tray, nativeImage, Menu, dialog, session, nativeTheme, shell, ipcMain } = require('electron');
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
  const tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON));
  tray.setToolTip('Fedora WhatsApp');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir Fedora WhatsApp', click: focus },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() },
  ]));
  tray.on('click', focus);
  app.on('will-quit', () => tray.destroy());
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
