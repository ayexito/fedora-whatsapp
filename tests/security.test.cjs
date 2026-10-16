'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { trustedURL, chromiumUserAgent, WEB_PREFERENCES } = require('../runtime/main.cjs');

async function runtimeHarness(t, respond = async () => ({ response: 1 }), options = {}) {
  const profile = options.profile || fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-permissions-'));
  if (!options.profile) t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const handlers = {}, prompts = [], menus = [], failures = [], revealed = [], links = [], opened = [], downloadURLs = [];
  let window, view, tray;
  const makeContents = () => Object.assign(new EventEmitter(), {
    url: '', destroyed: false, reloads: 0, mainFrame: { url: '' },
    getURL() { return this.url; }, isDestroyed() { return this.destroyed; },
    setWindowOpenHandler(fn) { this.popup = fn; }, reload() { this.reloads++; },
    downloadURL(url) { downloadURLs.push(url); }, focus() {},
    async loadURL(url) { this.url = url; this.mainFrame.url = url; },
    close() { this.destroyed = true; },
  });
  class Window extends EventEmitter {
    constructor(options) {
      super(); window = this;
      this.options = options;
      this.webContents = makeContents();
      this.contentView = Object.assign(new EventEmitter(), {
        addChildView() {}, getBounds: () => ({ x: 0, y: 0, width: this.size[0], height: this.size[1] }),
      });
      this.size = [1280, 820]; this.maximized = false; this.minimized = false; this.closed = false; this.visible = true;
    }
    isDestroyed() { return this.closed; }
    isMinimized() { return this.minimized; }
    isMaximized() { return this.maximized; }
    getContentSize() { return this.size; }
    minimize() { this.minimized = true; }
    restore() { this.minimized = false; }
    maximize() { this.maximized = true; }
    unmaximize() { this.maximized = false; }
    close() {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      this.emit('close', event);
      if (!event.prevented) { this.closed = true; this.emit('closed'); }
    }
    hide() { this.visible = false; }
    show() { this.visible = true; }
    focus() {}
    async loadURL(url) { return this.webContents.loadURL(url); }
  }
  class Client {
    constructor(options) {
      view = this; this.options = options; this.webContents = makeContents();
      this.webContents.setWindowOpenHandler = fn => { handlers.popup = fn; };
    }
    setBounds(bounds) { this.bounds = bounds; }
  }
  class Tray extends EventEmitter {
    constructor(icon) { super(); tray = this; this.icon = icon; }
    setToolTip(value) { this.tooltip = value; }
    setContextMenu(value) { this.menu = value; }
    destroy() { this.destroyed = true; }
  }
  const electron = {
    app: Object.assign(new EventEmitter(), {
      commandLine: { hasSwitch: () => false }, userAgentFallback: 'Chromium',
      setName() {}, setPath() {}, setDesktopName() {}, enableSandbox() {},
      getPath: () => path.join(profile, 'downloads'),
      requestSingleInstanceLock: () => true, whenReady: async () => {},
      quit() { this.emit('before-quit'); window?.close(); this.emit('will-quit'); },
    }),
    BrowserWindow: Window, WebContentsView: Client, Tray, ipcMain: new EventEmitter(),
    nativeImage: { createFromDataURL: value => value },
    session: { defaultSession: Object.assign(new EventEmitter(), {
      setPermissionCheckHandler(fn) { handlers.check = fn; },
      setPermissionRequestHandler(fn) { handlers.request = fn; },
      setDevicePermissionHandler(fn) { handlers.device = fn; },
    }) },
    Menu: { buildFromTemplate: value => value, setApplicationMenu: value => menus.push(value) },
    dialog: { async showMessageBox(parent, options) { assert.equal(parent, window); prompts.push(options); return respond(options); } },
    shell: {
      showItemInFolder: file => revealed.push(file),
      async openExternal(url) { links.push(url); if (options.openError) throw new Error('No browser'); },
      async openPath(file) { opened.push(file); return options.openError ? 'No application' : ''; },
    },
    nativeTheme: { shouldUseDarkColors: false },
  };
  const stdin = Object.assign(new EventEmitter(), { setEncoding() {} });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../runtime/main.cjs'), 'utf8'), {
    require: name => name === 'electron' ? electron : require(name), module: { exports: {} }, URL, __filename: '/fixture/runtime.cjs',
    process: Object.assign(new EventEmitter(), {
      env: { WA_PROFILE: profile, WA_DESKTOP_ID: 'test.WhatsApp' },
      versions: { electron: '44.7.2' }, type: 'browser', stdin,
      stderr: { write: message => failures.push(message) }, exit: () => failures.push('exit'),
    }),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(failures, [], 'Runtime failed to start in the permission fixture');
  return { handlers, prompts, menus, window, view, tray, contents: view.webContents, ipc: electron.ipcMain, app: electron.app,
    stdin, revealed, links, opened, profile, downloadURLs,
    navigate(url, extra = {}, name = 'will-frame-navigate') {
      const event = { url, isMainFrame: true, initiator: view.webContents.mainFrame,
        prevented: false, preventDefault() { this.prevented = true; }, ...extra };
      view.webContents.emit(name, event);
      return event;
    },
    download(options = {}, contents = view.webContents) {
      const item = Object.assign(new EventEmitter(), {
        getInitiatorOrigin: () => 'https://web.whatsapp.com',
        getURL: () => 'https://web.whatsapp.com/file', getMimeType: () => 'application/pdf',
        getFilename: () => 'attachment.pdf', getSavePath: () => path.join(profile, 'chosen.pdf'),
        setSaveDialogOptions(options) { this.saveOptions = options; }, ...options,
      });
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      electron.session.defaultSession.emit('will-download', event, item, contents);
      return { item, event };
    },
    request(permission, details = {}, contents = view.webContents) {
      return new Promise(resolve => handlers.request(contents, permission, resolve, {
        isMainFrame: true, requestingUrl: 'https://web.whatsapp.com/', ...details,
      }));
    },
    check(permission, details = {}, origin = 'https://web.whatsapp.com', contents = view.webContents) {
      return handlers.check(contents, permission, origin, {
        isMainFrame: true, requestingUrl: 'https://web.whatsapp.com/', ...details,
      });
    },
  };
}

test('browser identity preserves the actual Linux Chromium engine', () => {
  const prefix = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)';
  const browser = `${prefix} Chrome/152.0.7977.149 Safari/537.36`;
  for (const product of ['FedoraWhatsApp', 'WhatsApppourFedora']) {
    assert.equal(chromiumUserAgent(`${prefix} ${product}/0.0 Chrome/152.0.7977.149 Electron/44.7.2 Safari/537.36`), browser);
  }
  assert.equal(chromiumUserAgent(browser), browser);
});

test('only authentic HTTPS application navigation is admitted', () => {
  for (const url of ['https://web.whatsapp.com/', 'https://WEB.WHATSAPP.COM:443/path?q=1']) assert.equal(trustedURL(url), true, url);
  for (const url of [
    'http://web.whatsapp.com/', 'https://web.whatsapp.com.evil.test/',
    'https://evil.test/web.whatsapp.com', 'https://web.whatsapp.com:444/',
    'https://user@web.whatsapp.com/', 'https://user:password@web.whatsapp.com/',
    'https://web.whatsapp.com./', 'javascript:alert(1)', 'file:///tmp/login.html',
    'data:text/html,hello', 'https://web.whatsаpp.com/', 'not a URL',
  ]) assert.equal(trustedURL(url), false, url);
});

test('remote pages have no native runtime access', () => {
  assert.equal(WEB_PREFERENCES.sandbox, true);
  assert.equal(WEB_PREFERENCES.contextIsolation, true);
  assert.equal(WEB_PREFERENCES.nodeIntegration, false);
  assert.equal(WEB_PREFERENCES.webSecurity, true);
  assert.equal(WEB_PREFERENCES.webviewTag, false);
  assert.equal('preload' in WEB_PREFERENCES, false);
});

test('the app supplies its own window controls when the desktop omits them', async t => {
  const app = await runtimeHarness(t);
  assert.equal(app.window.options.frame, false);
  assert.equal(JSON.stringify(app.view.options.webPreferences), JSON.stringify(WEB_PREFERENCES));
  assert.equal('preload' in app.view.options.webPreferences, false);
  const html = decodeURIComponent(app.window.webContents.getURL().split(',').slice(1).join(','));
  for (const action of ['minimize', 'maximize', 'close']) assert.ok(html.includes(`id="${action}"`));
  assert.equal(app.view.bounds.y, 40);
});

test('official web notifications ask consent and remember permission', async t => {
  const app = await runtimeHarness(t);
  assert.equal(await app.request('notifications'), true);
  assert.equal(app.check('notifications'), true);
  const restarted = await runtimeHarness(t, undefined, { profile: app.profile });
  assert.equal(restarted.check('notifications'), true);
  restarted.menus[0][0].submenu.find(item => item.label?.startsWith('Désactiver les notifications')).click();
  assert.equal(restarted.check('notifications'), false);
  const disabled = await runtimeHarness(t, undefined, { profile: app.profile });
  assert.equal(disabled.check('notifications'), false);
  for (const details of [{ isMainFrame: false }, { requestingUrl: 'https://evil.test/' }]) {
    assert.equal(await disabled.request('notifications', details), false);
  }
  assert.equal(await disabled.request('notifications', {}, disabled.window.webContents), false);
  const denied = await runtimeHarness(t, async () => ({ response: 0 }));
  assert.equal(await denied.request('notifications'), false);
  assert.equal(denied.check('notifications'), false);
});

test('window controls accept commands only from the local title bar main frame', async t => {
  const app = await runtimeHarness(t);
  const trusted = { sender: app.window.webContents, senderFrame: app.window.webContents.mainFrame };
  for (const event of [{ sender: app.contents, senderFrame: app.contents.mainFrame },
    { ...trusted, senderFrame: { url: app.window.webContents.getURL() } }, { ...trusted, senderFrame: null }]) {
    app.ipc.emit('window-control', event, 'close');
    assert.equal(app.window.closed, false);
  }
  app.ipc.emit('window-control', trusted, 'unknown');
  assert.equal(app.window.closed, false);
  app.ipc.emit('window-control', trusted, 'minimize');
  assert.equal(app.window.minimized, true);
  app.ipc.emit('window-control', trusted, 'maximize');
  assert.equal(app.window.maximized, true);
  app.ipc.emit('window-control', trusted, 'maximize');
  assert.equal(app.window.maximized, false);
  app.ipc.emit('window-control', trusted, 'close');
  assert.equal(app.window.visible, false);
  assert.equal(app.window.closed, false);
  assert.equal(app.contents.destroyed, false);
});

test('Close keeps the session alive, reopening restores it, and explicit Quit exits', async t => {
  for (const quit of ['menu', 'pipe', 'stdin-end']) {
    const app = await runtimeHarness(t);
    app.window.close();
    assert.equal(app.window.visible, false);
    assert.equal(app.window.closed, false);
    assert.equal(app.contents.destroyed, false);
    app.stdin.emit('data', 'focus\n');
    assert.equal(app.window.visible, true);
    app.window.close();
    app.app.emit('second-instance');
    assert.equal(app.window.visible, true);
    if (quit === 'menu') app.menus[0][0].submenu.find(item => item.label === 'Quitter').click();
    else if (quit === 'pipe') app.stdin.emit('data', 'quit\n');
    else app.stdin.emit('end');
    assert.equal(app.window.closed, true);
    assert.equal(app.contents.destroyed, true);
  }
});

test('the tray restores the same hidden or minimized window and offers a complete Quit', async t => {
  const app = await runtimeHarness(t);
  assert.ok(app.tray, 'A native tray icon must be created');
  assert.equal(app.tray.tooltip, 'Fedora WhatsApp');
  const png = Buffer.from(app.tray.icon.split(',')[1], 'base64');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 32);
  assert.equal(png.readUInt32BE(20), 32);
  app.window.close();
  app.tray.emit('click');
  assert.equal(app.window.visible, true);
  assert.equal(app.contents.destroyed, false);
  app.window.minimize();
  app.window.close();
  app.tray.menu.find(item => item.label === 'Ouvrir Fedora WhatsApp').click();
  assert.equal(app.window.visible, true);
  assert.equal(app.window.minimized, false);
  app.tray.menu.find(item => item.label === 'Quitter').click();
  assert.equal(app.window.closed, true);
  assert.equal(app.contents.destroyed, true);
  assert.equal(app.tray.destroyed, true);
});

test('the chat follows native content bounds after a compositor maximize or restore', async t => {
  const app = await runtimeHarness(t);
  for (const size of [[1920, 1035], [459, 496], [1000, 760]]) {
    app.window.size = size;
    app.window.contentView.emit('bounds-changed');
    assert.deepEqual(JSON.parse(JSON.stringify(app.view.bounds)), { x: 0, y: 40, width: size[0], height: size[1] - 40 });
  }
});

test('local title bar preload binds accessible buttons without exposing a renderer API', () => {
  const buttons = Object.fromEntries(['minimize', 'maximize', 'close'].map(id => [id, new EventEmitter()]));
  for (const button of Object.values(buttons)) button.addEventListener = button.on;
  const localWindow = new EventEmitter(); localWindow.addEventListener = localWindow.on;
  const sent = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../runtime/main.cjs'), 'utf8'), {
    module: { exports: {} }, process: { versions: { electron: '44.7.2' }, type: 'renderer' }, window: localWindow,
    document: { getElementById: id => buttons[id] },
    require: name => { assert.equal(name, 'electron'); return { ipcRenderer: { send: (...args) => sent.push(args) } }; },
  });
  localWindow.emit('DOMContentLoaded');
  for (const button of Object.values(buttons)) button.emit('click');
  assert.deepEqual(sent, ['minimize', 'maximize', 'close'].map(action => ['window-control', action]));
  assert.equal(localWindow.ipcRenderer, undefined);
  assert.equal(localWindow.windowControls, undefined);
});

test('WhatsApp attachments reach the native save dialog instead of being cancelled', async t => {
  const app = await runtimeHarness(t);
  const { item, event } = app.download();
  assert.equal(event.prevented, false, 'Attachment download was cancelled before the save dialog');
  assert.equal(path.basename(item.saveOptions.defaultPath), 'attachment.pdf');
  assert.equal(path.basename(path.dirname(item.saveOptions.defaultPath)), 'downloads');
  assert.ok(item.saveOptions.properties.includes('showOverwriteConfirmation'));
});

test('downloads require the official initiator and main application window', async t => {
  const app = await runtimeHarness(t);
  for (const origin of ['', 'null', 'https://evil.test', 'http://web.whatsapp.com', 'https://web.whatsapp.com.evil.test']) {
    const { event, item } = app.download({ getInitiatorOrigin: () => origin });
    assert.equal(event.prevented, true, origin);
    assert.equal(item.saveOptions, undefined);
  }
  assert.equal(app.download({}, null).event.prevented, true);
  assert.equal(app.download({}, { getURL: () => 'https://web.whatsapp.com/' }).event.prevented, true);
  app.contents.url = 'https://evil.test/';
  assert.equal(app.download().event.prevented, true);
  app.contents.url = 'https://web.whatsapp.com/';
  app.contents.destroyed = true;
  assert.equal(app.download().event.prevented, true);
});

test('suggested attachment names cannot escape the Downloads folder', async t => {
  const app = await runtimeHarness(t);
  for (const filename of ['../../document.pdf', '..\\..\\photo.png', '/', '.', '..', '', 'photo\n.png']) {
    const { item } = app.download({ getFilename: () => filename });
    assert.equal(path.basename(path.dirname(item.saveOptions.defaultPath)), 'downloads');
    assert.doesNotMatch(path.basename(item.saveOptions.defaultPath), /[\\\x00-\x1f\x7f]/);
  }
});

test('download completion offers the saved file folder, failures explain retry, cancellation stays quiet', async t => {
  for (const state of ['completed', 'interrupted', 'cancelled']) {
    const app = await runtimeHarness(t);
    const { item } = app.download();
    item.emit('done', {}, state);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.prompts.length, state === 'cancelled' ? 0 : 1);
    assert.deepEqual(app.revealed, state === 'completed' ? [item.getSavePath()] : []);
    if (state === 'completed') assert.equal(app.prompts[0].defaultId, 0);
    if (state === 'interrupted') assert.equal(app.prompts[0].type, 'error');
  }
});

test('microphone access asks for consent and then becomes available to WhatsApp', async t => {
  const app = await runtimeHarness(t);
  assert.equal(app.check('media', { mediaType: 'audio' }), false);
  const allowed = await app.request('media', { mediaTypes: ['audio'] });
  assert.equal(app.prompts.length, 1, 'Microphone request was silently denied instead of prompting');
  assert.equal(allowed, true);
  assert.equal(app.check('media', { mediaType: 'audio' }), true);
  assert.equal(app.check('media', { mediaType: 'video' }), false);
  assert.equal(app.prompts[0].defaultId, 0);
  assert.equal(app.prompts[0].cancelId, 0);
  assert.match(app.prompts[0].message, /https:\/\/web\.whatsapp\.com.*microphone/);
});

test('native controls can request consent without a web permission request', async t => {
  for (const source of ['microphone', 'caméra', 'pipe']) {
    for (const response of [0, 1]) {
      const app = await runtimeHarness(t, async () => ({ response }));
      assert.equal(app.check('media', { mediaType: 'audio' }), false);
      if (source === 'pipe') app.stdin.emit('data', 'media\n');
      else {
        const item = app.menus[0][0].submenu.find(item => item.label?.startsWith('Autoriser') && item.label.endsWith(`${source}…`));
        assert.ok(item, 'A native permission control must be available when the web page never asks');
        item.click();
      }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(app.prompts.length, 1, 'The native control must open a consent dialog');
      assert.equal(app.check('media', { mediaType: 'audio' }), response === 1);
      assert.equal(app.check('media', { mediaType: 'video' }), response === 1 && source !== 'microphone');
      assert.equal(app.contents.reloads, response);
    }
  }
});

test('camera and speaker selection require their own explicit grants', async t => {
  const app = await runtimeHarness(t);
  assert.equal(await app.request('media', { mediaTypes: ['audio', 'video'] }), true);
  assert.match(app.prompts[0].message, /microphone.*caméra/);
  assert.equal(app.check('media', { mediaType: 'video' }), true);
  assert.equal(app.check('media', { mediaType: 'unknown' }), false);
  assert.equal(app.check('speaker-selection'), false);
  assert.equal(await app.request('speaker-selection'), true);
  assert.equal(app.check('speaker-selection'), true);
  assert.match(app.prompts[1].message, /haut-parleurs/);
});

test('denying or closing a failed prompt never grants media access', async t => {
  for (const respond of [async () => ({ response: 0 }), async () => { throw new Error('Dialog closed'); }]) {
    const app = await runtimeHarness(t, respond);
    assert.equal(await app.request('media', { mediaTypes: ['audio'] }), false);
    assert.equal(app.check('media', { mediaType: 'audio' }), false);
  }
});

test('other origins, frames, permissions and malformed media requests stay blocked', async t => {
  const app = await runtimeHarness(t);
  for (const permission of ['geolocation', 'display-capture', 'usb', 'clipboard-read']) {
    assert.equal(await app.request(permission), false);
  }
  for (const mediaTypes of [undefined, [], ['unknown'], ['speaker'], ['audio', 'unknown']]) {
    assert.equal(await app.request('media', { mediaTypes }), false);
  }
  for (const details of [{ isMainFrame: false }, { requestingUrl: 'https://evil.test/' }, { requestingUrl: 'http://web.whatsapp.com/' }]) {
    assert.equal(await app.request('media', { mediaTypes: ['audio'], ...details }), false);
  }
  assert.equal(await app.request('media', { mediaTypes: ['audio'] }, null), false);
  app.contents.url = 'https://evil.test/';
  assert.equal(await app.request('media', { mediaTypes: ['audio'] }), false);
  app.stdin.emit('data', 'media\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.prompts.length, 0);
  app.contents.url = 'https://web.whatsapp.com/';
  assert.equal(await app.request('media', { mediaTypes: ['audio'] }), true);
  assert.equal(app.check('media', { mediaType: 'audio' }, 'https://evil.test'), false);
  assert.equal(app.check('media', { mediaType: 'audio', securityOrigin: 'https://evil.test' }), false);
  assert.equal(app.check('media', { mediaType: 'audio', isMainFrame: false }), false);
  assert.equal(app.handlers.device({ origin: 'https://web.whatsapp.com' }), false);
  app.contents.destroyed = true;
  assert.equal(app.check('media', { mediaType: 'audio' }), false);
});

test('duplicate requests share the grant, and the native revoke action clears it', async t => {
  const app = await runtimeHarness(t);
  assert.deepEqual(await Promise.all([
    app.request('media', { mediaTypes: ['audio'] }), app.request('media', { mediaTypes: ['audio'] }),
  ]), [true, true]);
  assert.equal(app.prompts.length, 1);
  app.menus[0][0].submenu.find(item => item.label?.startsWith('Révoquer')).click();
  assert.equal(app.check('media', { mediaType: 'audio' }), false);
  assert.equal(app.contents.reloads, 1);
  assert.equal(await app.request('media', { mediaTypes: ['audio'] }), true);
  assert.equal(app.prompts.length, 2);
});

test('navigation or revocation invalidates an outstanding consent dialog', async t => {
  for (const revoke of [false, true]) {
    let answer;
    const app = await runtimeHarness(t, () => new Promise(resolve => { answer = resolve; }));
    const request = app.request('media', { mediaTypes: ['audio'] });
    await new Promise(resolve => setImmediate(resolve));
    if (revoke) app.menus[0][0].submenu.find(item => item.label?.startsWith('Révoquer')).click();
    else app.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    answer({ response: 1 });
    assert.equal(await request, false);
    assert.equal(app.check('media', { mediaType: 'audio' }), false);
  }
});

test('external links open once in the default browser while the app stays on WhatsApp', async t => {
  const app = await runtimeHarness(t);
  const url = 'https://example.org/document?q=hello#page';
  assert.equal(app.handlers.popup({ url }).action, 'deny');
  assert.equal(app.navigate('http://example.org/').prevented, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.links, [url, 'http://example.org/']);
  assert.equal(app.contents.getURL(), 'https://web.whatsapp.com/');
  assert.equal(app.navigate('https://web.whatsapp.com/').prevented, false);
});

test('dangerous schemes, subframe navigations and redirects never launch native handlers', async t => {
  const app = await runtimeHarness(t);
  for (const url of ['file:///tmp/test.desktop', 'javascript:alert(1)', 'data:text/html,hi',
    'ms-excel:test', 'mailto:test@example.org', 'https://user:secret@example.org/', 'not a URL']) {
    assert.equal(app.handlers.popup({ url }).action, 'deny');
    assert.equal(app.navigate(url).prevented, true);
  }
  app.navigate('https://example.org/', { initiator: { url: 'https://evil.test/' } });
  app.navigate('https://example.org/', {}, 'will-redirect');
  app.contents.url = 'https://evil.test/';
  app.handlers.popup({ url: 'https://example.org/' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.links, []);
});

test('completed documents open only on an explicit click; executables stay closed', async t => {
  const app = await runtimeHarness(t, async options => ({ response: options.buttons.indexOf('Ouvrir') }));
  const file = path.join(app.profile, 'saved.pdf');
  fs.writeFileSync(file, 'test PDF', { mode: 0o600 });
  app.download({ getSavePath: () => file }).item.emit('done', {}, 'completed');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.opened, [file]);
  const executable = path.join(app.profile, 'run.desktop');
  fs.writeFileSync(executable, '[Desktop Entry]', { mode: 0o600 });
  app.download({ getSavePath: () => executable }).item.emit('done', {}, 'completed');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.opened, [file]);
  const alias = path.join(app.profile, 'alias.pdf');
  fs.symlinkSync(file, alias);
  for (const unsafe of [alias, path.join(app.profile, 'missing.pdf'), app.profile]) {
    app.download({ getSavePath: () => unsafe }).item.emit('done', {}, 'completed');
    await new Promise(resolve => setImmediate(resolve));
  }
  fs.chmodSync(file, 0o700);
  app.download({ getSavePath: () => file }).item.emit('done', {}, 'completed');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.opened, [file]);
});

test('native opener failures produce a useful error instead of disappearing', async t => {
  const app = await runtimeHarness(t, async options => ({ response: options.buttons.indexOf('Ouvrir') }), { openError: true });
  const file = path.join(app.profile, 'saved.pdf');
  fs.writeFileSync(file, 'test', { mode: 0o600 });
  app.download({ getSavePath: () => file }).item.emit('done', {}, 'completed');
  app.handlers.popup({ url: 'https://example.org/' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.prompts.filter(prompt => prompt.type === 'error').length, 2);
});

test('first-run media setup is discoverable and explicit grants survive restarts', async t => {
  const app = await runtimeHarness(t);
  app.contents.emit('did-finish-load');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.prompts.length, 1, 'Show native consent even when WhatsApp never requests it');
  assert.equal(app.check('media', { mediaType: 'audio' }), true);
  assert.equal(app.check('media', { mediaType: 'video' }), true);
  const restarted = await runtimeHarness(t, undefined, { profile: app.profile });
  restarted.contents.emit('did-finish-load');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(restarted.check('media', { mediaType: 'audio' }), true);
  assert.equal(restarted.prompts.length, 0);
  assert.equal(fs.statSync(path.join(app.profile, 'media-permissions.json')).mode & 0o777, 0o600);
  restarted.menus[0][0].submenu.find(item => item.label?.startsWith('Révoquer')).click();
  const revoked = await runtimeHarness(t, undefined, { profile: app.profile });
  assert.equal(revoked.check('media', { mediaType: 'audio' }), false);
});

test('declined setup does not nag again, unsafe stored grants and spoofed security origins fail closed', async t => {
  const app = await runtimeHarness(t, async () => ({ response: 0 }));
  app.contents.emit('did-finish-load');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.prompts.length, 1);
  const restarted = await runtimeHarness(t, undefined, { profile: app.profile });
  restarted.contents.emit('did-finish-load');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(restarted.prompts.length, 0);
  assert.equal(restarted.check('media', { mediaType: 'audio' }), false);
  assert.equal(await restarted.request('media', { mediaTypes: ['audio'], securityOrigin: 'https://evil.test' }), false);
  const saved = path.join(app.profile, 'media-permissions.json');
  for (const content of ['invalid JSON', JSON.stringify({ origin: 'https://evil.test', grants: ['audio'] }),
    JSON.stringify({ origin: 'https://web.whatsapp.com', grants: ['audio', 'usb'] })]) {
    fs.writeFileSync(saved, content, { mode: 0o600 });
    const invalid = await runtimeHarness(t, undefined, { profile: app.profile });
    assert.equal(invalid.check('media', { mediaType: 'audio' }), false);
  }
});

test('official blob document popups reach Save with one scoped download authorization', async t => {
  const app = await runtimeHarness(t);
  const url = 'blob:https://web.whatsapp.com/01234567-89ab-cdef-0123-456789abcdef';
  assert.equal(app.handlers.popup({ url }).action, 'deny');
  assert.deepEqual(app.downloadURLs, [url]);
  const blob = { getURL: () => url, getInitiatorOrigin: () => '', getFilename: () => '01234567-89ab-cdef-0123-456789abcdef' };
  assert.equal(app.download({ ...blob, getURL: () => url + '-other' }).event.prevented, true);
  assert.equal(app.download(blob, null).event.prevented, true);
  const accepted = app.download(blob);
  assert.equal(accepted.event.prevented, false);
  assert.match(accepted.item.saveOptions.defaultPath, /\.pdf$/);
  assert.equal(app.download(blob).event.prevented, true, 'An empty initiator exception must be one-shot');
  app.handlers.popup({ url });
  app.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.equal(app.download(blob).event.prevented, true, 'Navigation invalidates authorization');
  app.handlers.popup({ url });
  assert.equal(app.download({ ...blob, getInitiatorOrigin: () => 'https://evil.test' }).event.prevented, true);
  assert.equal(app.download({ ...blob, getInitiatorOrigin: () => 'https://web.whatsapp.com' }).event.prevented, false);
  assert.equal(app.download(blob).event.prevented, true);
  for (const other of ['blob:https://evil.test/id', 'blob:null/id', 'blob:http://web.whatsapp.com/id']) app.handlers.popup({ url: other });
  assert.equal(app.downloadURLs.length, 3);
});

test('failed revocation reports remaining disk grants and a successful retry clears them', async t => {
  const app = await runtimeHarness(t);
  assert.equal(await app.request('media', { mediaTypes: ['audio'] }), true);
  const saved = path.join(app.profile, 'media-permissions.json');
  fs.chmodSync(app.profile, 0o500);
  try {
    app.menus[0][0].submenu.find(item => item.label?.startsWith('Révoquer')).click();
    assert.equal(app.check('media', { mediaType: 'audio' }), false);
    assert.ok(app.prompts.some(prompt => prompt.message === 'Révocation limitée à cette session'));
  } finally { fs.chmodSync(app.profile, 0o700); }
  app.menus[0][0].submenu.find(item => item.label?.startsWith('Révoquer')).click();
  assert.deepEqual(JSON.parse(fs.readFileSync(saved, 'utf8')).grants, []);
  const restarted = await runtimeHarness(t, undefined, { profile: app.profile });
  assert.equal(restarted.check('media', { mediaType: 'audio' }), false);
});
