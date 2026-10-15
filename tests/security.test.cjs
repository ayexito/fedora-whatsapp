'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { trustedURL, chromiumUserAgent, WEB_PREFERENCES } = require('../runtime/main.cjs');

test('browser identity preserves the actual Linux Chromium engine', () => {
  const prefix = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)';
  const browser = `${prefix} Chrome/152.0.7977.149 Safari/537.36`;
  assert.equal(chromiumUserAgent(`${prefix} WhatsApppourFedora/0.0 Chrome/152.0.7977.149 Electron/44.7.2 Safari/537.36`), browser);
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
