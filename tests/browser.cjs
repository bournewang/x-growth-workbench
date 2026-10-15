// All X traffic is fulfilled locally. This test never publishes to X.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.resolve(__dirname, '../extension');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'x-count-test-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`] });
  try {
    let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    context.on('page', p => p.on('pageerror', e => console.error('PAGE ERROR:', e.message)));
    console.log('Extension worker loaded');
    let fixture = {}; let responseStatus = 200;
    await context.route('**/*', route => {
      if (route.request().url().startsWith('chrome-extension://')) return route.continue();
      const url = new URL(route.request().url());
      const xHost = ['x.com', 'pro.x.com', 'pro.twitter.com', 'tweetdeck.twitter.com', 'api.x.com'].includes(url.hostname);
      if (xHost && url.pathname.includes('/graphql/')) return route.fulfill({ status: responseStatus, contentType: 'application/json', body: JSON.stringify(fixture) });
      if (xHost) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local X fixture</title><h1>Offline test page</h1>' });
      return route.abort();
    });
    const page = await context.newPage(); await page.goto('https://x.com/home');
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    console.log('Popup:', await popup.locator('#status').textContent());
    await popup.locator('#status').filter({ hasText: '刷新' }).waitFor();
    console.log('Empty state ready');
    const publish = async (kind, id, accountId = '42', target = page, xhr = false) => {
      const result = { rest_id: id, core: { user_results: { result: { rest_id: accountId, core: { screen_name: `user${accountId}` } } } }, legacy: { created_at: new Date().toUTCString(), user_id_str: accountId } };
      if (kind === 'reply') result.legacy.in_reply_to_status_id_str = '9';
      if (kind === 'repost') result.legacy.retweeted_status_result = { result: { rest_id: '9' } };
      fixture = kind === 'repost' ? { data: { create_retweet: { retweet_results: { result } } } } : { data: { create_tweet: { tweet_results: { result } } } };
      await target.evaluate(async ({ kind, xhr }) => {
        const url = '/i/api/graphql/fixture/' + (kind === 'repost' ? 'CreateRetweet' : 'CreateTweet');
        if (xhr) await new Promise(resolve => { const req = new XMLHttpRequest(); req.open('POST', url); req.onload = resolve; req.send('{}'); });
        else { const response = await fetch(url, { method: 'POST', body: '{}' }); await response.json(); }
      }, { kind, xhr });
    };
    const total = async value => { await popup.waitForFunction(v => document.getElementById('total').textContent === String(v), value); };
    await publish('original', '100'); await total(1); console.log('Fetch publication received');
    await publish('reply', '101', '42', page, true); await total(2);
    await publish('repost', '102'); await total(3);
    assert.equal(await popup.locator('#original').textContent(), '1');
    assert.equal(await popup.locator('#reply').textContent(), '1');
    assert.equal(await popup.locator('#repost').textContent(), '1');
    const second = await context.newPage(); await second.goto('https://x.com/home');
    await publish('original', '100', '42', second); // Duplicate across tabs.
    await publish('original', '200', '43', second);
    await popup.waitForFunction(() => document.querySelectorAll('#account option').length === 2);
    await total(3);
    await popup.locator('#account').selectOption('43'); await total(1);
    assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), '1');
    await popup.locator('#account').selectOption('42'); await total(3);
    responseStatus = 403; await publish('original', '300'); responseStatus = 200;
    fixture = { errors: [{ message: 'synthetic rejection' }] };
    await page.evaluate(() => fetch('/i/api/graphql/fixture/CreateTweet', { method: 'POST' }).then(r => r.json()));
    fixture = { data: {} };
    await page.evaluate(() => fetch('/i/api/graphql/fixture/CreateTweet', { method: 'POST' }).then(r => r.json()));
    await popup.locator('#warning').waitFor({ state: 'visible' });
    await total(3);
    // Concurrent delivery exercises the worker's storage serialization.
    await popup.evaluate(async () => {
      const pages = await chrome.storage.local.get('state');
      if (Object.keys(pages.state.events).length !== 4) throw new Error('Unexpected event count');
    });
    const base = { accountId: '42', handle: 'user42', kind: 'original', at: Date.now() };
    await page.evaluate(event => {
      for (let i = 0; i < 20; i++) window.postMessage({ channel: 'x-posts-count-v1', payload: { type: 'publication', event: { ...event, id: String(400 + i) } } }, location.origin);
    }, base);
    await total(23);
    // Real compact CreateRetweet shape: no author, created_at or nested original.
    const compactId = String((BigInt(Date.now()) - 1288834974657n) << 22n);
    fixture = { data: { create_retweet: { retweet_results: { result: { rest_id: compactId, legacy: { full_text: 'RT @source: fixture' } } } } } };
    await page.evaluate(async () => {
      document.cookie = 'twid=u%3D42; path=/; secure';
      const request = fetch('/i/api/graphql/fixture/CreateRetweet', { method: 'POST' });
      document.cookie = 'twid=u%3D43; path=/; secure'; // Switch while request is in flight.
      await request;
    });
    await total(24);
    assert.equal(await popup.locator('#repost').textContent(), '2');
    fixture.data.create_retweet.retweet_results.result.rest_id = String(BigInt(compactId) + 1n);
    await page.evaluate(() => new Promise(resolve => {
      const xhr = new XMLHttpRequest(); xhr.open('POST', '/i/api/graphql/fixture/CreateRetweet');
      xhr.onload = resolve; xhr.send('{}');
    }));
    await popup.locator('#account').selectOption('43'); await total(2);
    assert.equal(await popup.locator('#repost').textContent(), '1');
    await popup.locator('#account').selectOption('42'); await total(24);
    await popup.reload(); await total(24);
    await popup.locator('#period').selectOption('3'); await total(24);
    await popup.locator('#period').selectOption('1');
    await popup.locator('#manual-panel summary').click();
    await popup.locator('#manual-original').fill('2');
    await popup.locator('#manual-reply').fill('3');
    await popup.locator('#manual-repost').fill('4');
    await popup.locator('#manual-form button').click(); await total(33);
    assert.equal(await popup.locator('#sources').textContent(), '自动 24 + 补记 9');
    await popup.waitForFunction(() => document.getElementById('manual-feedback').textContent.includes('已保存'));
    assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), '33');
    await popup.locator('#manual-form button').click(); await total(33);
    await popup.locator('#account').selectOption('43'); await total(2);
    assert.equal(await popup.locator('#manual-repost').inputValue(), '0');
    await popup.locator('#account').selectOption('42'); await total(33);
    assert.equal(await popup.locator('#manual-repost').inputValue(), '4');
    await popup.reload(); await total(33);
    await popup.locator('#manual-panel summary').click();
    await popup.locator('#manual-repost').fill('1');
    // A live publication must not reset a draft correction.
    await publish('original', '900', '42'); await total(34);
    assert.equal(await popup.locator('#manual-repost').inputValue(), '1');
    await popup.locator('#manual-form button').click(); await total(31);
    assert.equal(await popup.locator('#sources').textContent(), '自动 25 + 补记 6');
    // Reject stale-day changes in the background, preserving saved values.
    const rejected = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'manual', accountId: '42', day: '2000-01-01', values: { original: 0, reply: 0, repost: 0 } }));
    assert.equal(rejected.ok, false);
    await popup.locator('#period').selectOption('3'); await total(31);
    await popup.locator('#period').selectOption('1');
    const pro = await context.newPage(); await pro.goto('https://pro.x.com/');
    await publish('original', '950', '42', pro); await total(32);
    await publish('reply', '951', '42', pro, true); await total(33);
    await publish('original', '950', '42', page); await total(33); // Same publication in ordinary X.
    const proRetweetId = String((BigInt(Date.now()) - 1288834974657n) << 22n);
    fixture = { data: { create_retweet: { retweet_results: { result: { rest_id: proRetweetId, legacy: { full_text: 'RT fixture' } } } } } };
    await pro.evaluate(async () => {
      document.cookie = 'twid=u%3D42; path=/; secure';
      await fetch('/i/api/graphql/fixture/CreateRetweet', { method: 'POST' });
    });
    await total(34);
    assert.equal(await popup.locator('#sources').textContent(), '自动 28 + 补记 6');
    for (const [index, host] of ['pro.twitter.com', 'tweetdeck.twitter.com'].entries()) {
      const legacy = await context.newPage(); await legacy.goto('https://' + host + '/');
      await publish('original', String(960 + index), '42', legacy); await total(35 + index);
      await legacy.close();
    }
    await popup.locator('body').screenshot({ path: path.resolve(__dirname, '../preview.png') });
    console.log('PASS: actual extension load, fetch/XHR, originals/replies/reposts, duplicate, two accounts, failed/unrecognized responses, 20 concurrent writes, persistence, badge, popup, X Pro and legacy hosts, cross-site deduplication. All requests intercepted locally.');
  } finally { await context.close(); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
