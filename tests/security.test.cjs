'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { trustedURL, chromiumUserAgent, WEB_PREFERENCES } = require('../runtime/main.cjs');

async function runtimeHarness(t, respond = async () => ({ response: 1 })) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-permissions-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const handlers = {}, prompts = [], menus = [], failures = [], revealed = [];
  let window;
  class Window extends EventEmitter {
    constructor() {
      super(); window = this;
      this.webContents = Object.assign(new EventEmitter(), {
        url: '', destroyed: false, reloads: 0,
        getURL() { return this.url; }, isDestroyed() { return this.destroyed; },
        setWindowOpenHandler() {}, reload() { this.reloads++; },
      });
    }
    isDestroyed() { return this.webContents.destroyed; }
    isMinimized() { return false; }
    show() {}
    focus() {}
    async loadURL(url) { this.webContents.url = url; }
  }
  const electron = {
    app: Object.assign(new EventEmitter(), {
      commandLine: { hasSwitch: () => false }, userAgentFallback: 'Chromium',
      setName() {}, setPath() {}, setDesktopName() {}, enableSandbox() {},
      getPath: () => path.join(profile, 'downloads'),
      requestSingleInstanceLock: () => true, whenReady: async () => {},
    }),
    BrowserWindow: Window,
    session: { defaultSession: Object.assign(new EventEmitter(), {
      setPermissionCheckHandler(fn) { handlers.check = fn; },
      setPermissionRequestHandler(fn) { handlers.request = fn; },
      setDevicePermissionHandler(fn) { handlers.device = fn; },
    }) },
    Menu: { buildFromTemplate: value => value, setApplicationMenu: value => menus.push(value) },
    dialog: { async showMessageBox(parent, options) { assert.equal(parent, window); prompts.push(options); return respond(options); } },
    shell: { showItemInFolder: file => revealed.push(file) },
    nativeTheme: { shouldUseDarkColors: false },
  };
  const stdin = Object.assign(new EventEmitter(), { setEncoding() {} });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../runtime/main.cjs'), 'utf8'), {
    require: name => name === 'electron' ? electron : require(name), module: { exports: {} }, URL,
    process: Object.assign(new EventEmitter(), {
      env: { WA_PROFILE: profile, WA_DESKTOP_ID: 'test.WhatsApp' },
      versions: { electron: '44.7.2' }, type: 'browser', stdin,
      stderr: { write: message => failures.push(message) }, exit: () => failures.push('exit'),
    }),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(failures, [], 'Runtime failed to start in the permission fixture');
  return { handlers, prompts, menus, window, stdin, revealed,
    download(options = {}, contents = window.webContents) {
      const item = Object.assign(new EventEmitter(), {
        getInitiatorOrigin: () => 'https://web.whatsapp.com',
        getFilename: () => 'attachment.pdf', getSavePath: () => path.join(profile, 'chosen.pdf'),
        setSaveDialogOptions(options) { this.saveOptions = options; }, ...options,
      });
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      electron.session.defaultSession.emit('will-download', event, item, contents);
      return { item, event };
    },
    request(permission, details = {}, contents = window.webContents) {
      return new Promise(resolve => handlers.request(contents, permission, resolve, {
        isMainFrame: true, requestingUrl: 'https://web.whatsapp.com/', ...details,
      }));
    },
    check(permission, details = {}, origin = 'https://web.whatsapp.com', contents = window.webContents) {
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
  app.window.webContents.url = 'https://evil.test/';
  assert.equal(app.download().event.prevented, true);
  app.window.webContents.url = 'https://web.whatsapp.com/';
  app.window.webContents.destroyed = true;
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
      assert.equal(app.window.webContents.reloads, response);
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
  for (const permission of ['notifications', 'geolocation', 'display-capture', 'usb', 'clipboard-read']) {
    assert.equal(await app.request(permission), false);
  }
  for (const mediaTypes of [undefined, [], ['unknown'], ['speaker'], ['audio', 'unknown']]) {
    assert.equal(await app.request('media', { mediaTypes }), false);
  }
  for (const details of [{ isMainFrame: false }, { requestingUrl: 'https://evil.test/' }, { requestingUrl: 'http://web.whatsapp.com/' }]) {
    assert.equal(await app.request('media', { mediaTypes: ['audio'], ...details }), false);
  }
  assert.equal(await app.request('media', { mediaTypes: ['audio'] }, null), false);
  app.window.webContents.url = 'https://evil.test/';
  assert.equal(await app.request('media', { mediaTypes: ['audio'] }), false);
  app.stdin.emit('data', 'media\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.prompts.length, 0);
  app.window.webContents.url = 'https://web.whatsapp.com/';
  assert.equal(await app.request('media', { mediaTypes: ['audio'] }), true);
  assert.equal(app.check('media', { mediaType: 'audio' }, 'https://evil.test'), false);
  assert.equal(app.check('media', { mediaType: 'audio', securityOrigin: 'https://evil.test' }), false);
  assert.equal(app.check('media', { mediaType: 'audio', isMainFrame: false }), false);
  assert.equal(app.handlers.device({ origin: 'https://web.whatsapp.com' }), false);
  app.window.webContents.destroyed = true;
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
  assert.equal(app.window.webContents.reloads, 1);
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
    else app.window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    answer({ response: 1 });
    assert.equal(await request, false);
    assert.equal(app.check('media', { mediaType: 'audio' }), false);
  }
});
