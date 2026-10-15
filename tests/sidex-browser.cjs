// Local HTTPS integration for the SideX drawer and response-only filters.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const makeUser = (id, handle, following, blue, requested = false) => ({
  __typename: 'User', rest_id: id,
  core: { screen_name: handle, name: handle },
  avatar: { image_url: 'https://x.com/avatar.png' },
  relationship_perspectives: following === null ? {} : { following },
  follow_request_sent: requested,
  is_blue_verified: blue
});
const makeTweet = (id, user, parent = '') => ({
  __typename: 'Tweet', rest_id: id,
  core: { user_results: { result: user } },
  legacy: {
    full_text: `来自 ${user.core.screen_name} 的评论`,
    conversation_id_str: '100', in_reply_to_status_id_str: parent,
    created_at: 'Wed Oct 14 08:00:00 +0000 2026', reply_count: 0
  }
});
const posts = [
  makeTweet('100', makeUser('1', 'op', false, false)),
  makeTweet('101', makeUser('2', 'bob', false, true), '100'),
  makeTweet('102', makeUser('3', 'carol', true, true), '100'),
  makeTweet('103', makeUser('4', 'dave', false, false), '100'),
  makeTweet('104', makeUser('5', 'erin', null, true), '100'),
  makeTweet('105', makeUser('6', 'frank', false, true, true), '100'),
  makeTweet('106', makeUser('7', 'grace', false, true), '102'),
  makeTweet('107', makeUser('1', 'viewer', false, true), '100')
];
const detail = { data: { threaded_conversation_with_injections_v2: { instructions: [
  { entries: [{ content: { items: posts.map(post => ({ item: { itemContent: { tweet_results: { result: post } } } })) } }] }
] } } };
const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>Local X</title><style>
body{margin:0;font:15px sans-serif;background:#fff}#react-root{display:flex;justify-content:center}
main{width:600px;min-height:2200px;border:1px solid #ddd}main > article{padding:20px;min-height:200px;border-bottom:1px solid #ddd}
[data-testid=sidebarColumn]{width:360px;min-height:800px;background:#f7f9f9}.post-text{cursor:pointer}
</style></head><body><div id="react-root"><main data-testid="primaryColumn"><article data-testid="tweet">
<a href="/op/status/100"><time>刚刚</time></a><p class="post-text" data-testid="tweetText">点击这里阅读评论</p>
</article></main><div data-testid="sidebarColumn">X 右侧栏</div></div><div id="layers"></div></body></html>`;

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xpc-sidex-test-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', path.join(temp, 'key.pem'), '-out', path.join(temp, 'cert.pem'),
    '-subj', '/CN=x.com', '-days', '1'], { stdio: 'ignore' });
  let detailRequests = 0;
  let profileRequests = 0;
  let followRequests = 0;
  let followMode = 'normal';
  let followRateLimited = false;
  let followLimitReached = false;
  let rateLimited = false;
  const server = https.createServer({
    key: fs.readFileSync(path.join(temp, 'key.pem')),
    cert: fs.readFileSync(path.join(temp, 'cert.pem'))
  }, (req, res) => {
    if (req.url.includes('/TweetDetail')) {
      detailRequests++;
      res.writeHead(rateLimited ? 429 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(rateLimited ? { errors: [{ message: 'Rate limit exceeded' }] } : detail));
      return;
    }
    if (req.url.includes('/UserByScreenName')) {
      profileRequests++;
      const variables = JSON.parse(new URL(req.url, 'https://x.com').searchParams.get('variables') || '{}');
      const handle = variables.screen_name || 'bob';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: { user: { result: makeUser(handle === 'dave' ? '4' : handle === 'grace' ? '7' : '2', handle, false, handle === 'bob' || handle === 'grace') } } }));
      return;
    }
    if (req.url.includes('/friendships/create.json')) {
      followRequests++;
      if (followLimitReached) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ errors: [{ message: "You are unable to follow more people at this time. Learn more <a href='http://support.twitter.com/articles/66885-i-can-t-follow-people-follow-limits'>here</a>." }] }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(followMode === 'request'
        ? { following: false, follow_request_sent: true }
        : followMode === 'no-flags' ? {}
          : followMode === 'native-legacy' ? {
            id_str: '1002', screen_name: 'return_follow',
            following: false, follow_request_sent: false, followed_by: true
          }
          : { following: true, follow_request_sent: false }));
      return;
    }
    if (req.url.includes('/friendships/destroy.json') && followRateLimited) {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ message: 'Rate limit exceeded' }] }));
      return;
    }
    if (req.url.includes('UserByScreenName') || req.url.includes('following/list')) profileRequests++;
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'set-cookie': ['twid=u%3D1; Path=/; Secure; SameSite=Lax', 'ct0=fixture-token; Path=/; Secure; SameSite=Lax'],
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
    });
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  let context;
  try {
    const extension = path.resolve(__dirname, '../extension');
    context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
      executablePath: process.env.CHROMIUM_EXECUTABLE,
      channel: 'chromium', headless: true, ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 900 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        '--no-proxy-server', `--host-resolver-rules=MAP x.com 127.0.0.1:${port}`,
        '--ignore-certificate-errors']
    });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname === 'x.com' || url.protocol === 'chrome-extension:' ? route.continue() : route.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.sync.set({
      sidex_enabled: false, sidex_lang: 'en', sidex_reply_mode: 'native',
      sidex_translation_provider: 'google', sidex_sub_reply_limit: 5
    }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://x.com/home');
    await page.evaluate(() => {
      const runtime = function () {};
      runtime.c = {
        detail: { exports: { operationName: 'TweetDetail', queryId: 'fixture', metadata: { featureSwitches: [], fieldToggles: [] } } },
        user: { exports: { operationName: 'UserByScreenName', queryId: 'fixture-user', metadata: { featureSwitches: [], fieldToggles: [] } } }
      };
      runtime.m = {};
      window.webpackChunkFixture = [];
      window.webpackChunkFixture.push = parts => parts[2](runtime);
    });
    await page.evaluate(() => scrollTo(0, 120));
    const before = await page.evaluate(() => ({ url: location.href, scroll: scrollY }));
    assert.equal(detailRequests, 0);
    await page.locator('.post-text').evaluate(node => node.click());
    await page.locator('#sidepeek-drawer-root.sidepeek-open').waitFor();
    assert.equal(await page.locator('.sidepeek-title').textContent(), 'X涨粉工作台');
    assert.equal(await page.locator('.xpc-filter-unfollowed').textContent(), '只看未关注',
      'old language and disabled settings do not override the new defaults');
    assert.equal(await page.locator('.sidepeek-footer-composer.sidepeek-footer-native-mode').count(), 0,
      'old reply-mode setting does not override the default drawer composer');
    const placement = await page.evaluate(() => ({
      drawer: document.getElementById('sidepeek-drawer-root').getBoundingClientRect().toJSON(),
      sidebar: document.querySelector('[data-testid="sidebarColumn"]').getBoundingClientRect().toJSON()
    }));
    assert.ok(placement.drawer.left >= placement.sidebar.left - 1 && placement.drawer.width <= 600,
      `SideX drawer stays in the right column: ${JSON.stringify(placement)}`);
    const handles = () => page.locator('.sidepeek-comment-item .sidepeek-handle').allTextContents();
    await page.waitForFunction(() => document.querySelectorAll('.sidepeek-comment-item').length === 3);
    assert.deepEqual(await handles(), ['@bob', '@dave', '@grace'], 'my own reply is excluded from not-following');
    assert.equal(await page.locator('.xpc-filter-unfollowed').getAttribute('aria-pressed'), 'true');
    assert.equal(profileRequests, 0, 'opening and filtering never preloads profiles');
    await page.locator('.xpc-filter-blue').click();
    assert.deepEqual(await handles(), ['@bob', '@grace']);
    await page.locator('.xpc-filter-unfollowed').click();
    assert.deepEqual(await handles(), ['@bob', '@carol', '@erin', '@frank', '@grace', '@viewer']);
    await page.locator('.xpc-filter-blue').click();
    assert.deepEqual(await handles(), ['@bob', '@carol', '@grace', '@dave', '@erin', '@frank', '@viewer']);
    assert.equal(detailRequests, 1, 'filter switches use the loaded TweetDetail response');
    assert.equal(profileRequests, 0);
    assert.deepEqual(await page.evaluate(() => ({ url: location.href, scroll: scrollY })), before);
    await page.screenshot({ path: path.resolve(__dirname, '../sidex-filter-preview.png') });
    followMode = 'no-flags';
    await page.evaluate(() => {
      const postMessage = window.postMessage;
      window.postMessage = function (message, ...args) {
        if (message?.channel === 'x-posts-count-v1' && message?.payload?.type === 'follow') return;
        return postMessage.call(this, message, ...args);
      };
      window.restoreFollowMessages = () => { window.postMessage = postMessage; };
    });
    await page.locator('.xpc-filter-unfollowed').click();
    await page.locator('.sidepeek-comment-item').filter({ hasText: '@bob' }).locator('img').first().hover();
    await page.locator('#sidepeek-user-hovercard.visible .sidepeek-hovercard-follow-btn').waitFor();
    assert.ok(profileRequests >= 1, 'SideX loads a profile only after avatar hover');
    await page.locator('#sidepeek-user-hovercard .sidepeek-hovercard-follow-btn').click();
    await page.waitForFunction(() => {
      const button = document.querySelector('#sidepeek-user-hovercard .sidepeek-hovercard-follow-btn');
      return button?.classList.contains('following') && !button.disabled;
    });
    assert.equal(followRequests, 1, 'the click uses SideX’s original follow request');
    await page.waitForFunction(() => document.querySelector('.xpc-follow-today')?.textContent.includes('1/400'));
    await page.evaluate(() => window.restoreFollowMessages());
    followMode = 'normal';
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    assert.equal(await popup.title(), 'X涨粉工作台');
    assert.equal(await popup.locator('#sidebar-enabled, .sidex-settings').count(), 0);
    await popup.waitForFunction(() => document.querySelector('#follow-total')?.textContent === '1');
    assert.match(await popup.locator('#follow-sources').textContent(), /自动 1/);
    await popup.locator('body').screenshot({ path: path.resolve(__dirname, '../workbench-popup-preview.png') });
    await page.waitForFunction(() => ![...document.querySelectorAll('.sidepeek-comment-item .sidepeek-handle')].some(node => node.textContent === '@bob' && getComputedStyle(node.closest('.sidepeek-comment-item')).display !== 'none'));
    await page.locator('.xpc-filter-unfollowed').click();
    assert.ok((await handles()).includes('@bob'), 'turning the filter off restores the comment');
    await page.locator('.sidepeek-comment-item').filter({ hasText: '@bob' }).locator('img').first().hover();
    await page.waitForFunction(() => document.querySelector('#sidepeek-user-hovercard.visible .sidepeek-hovercard-follow-btn')?.classList.contains('following'));
    assert.match(await page.locator('#sidepeek-user-hovercard .sidepeek-follow-text').textContent(), /正在关注|Following/,
      'reopened SideX profile retains the followed state');
    assert.equal(followRequests, 1, 'reopening the profile sends no extra follow request');
    followRateLimited = true;
    await page.locator('#sidepeek-user-hovercard .sidepeek-hovercard-follow-btn').click();
    await page.locator('#xpc-rate-limit-toast[role="alert"]').waitFor();
    await page.waitForFunction(() => {
      const button = document.querySelector('#sidepeek-user-hovercard .sidepeek-hovercard-follow-btn');
      return button?.classList.contains('following') && !button.disabled;
    });
    assert.equal(await page.locator('#xpc-rate-limit-toast').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(74, 153, 233)',
      'rate limit notice uses the blue X-style banner');
    followLimitReached = true;
    await page.locator('.sidepeek-comment-item').filter({ hasText: '@dave' }).locator('img').first().hover();
    await page.waitForFunction(() => document.querySelector('#sidepeek-user-hovercard.visible .sidepeek-hovercard-handle')?.textContent === '@dave');
    await page.locator('#sidepeek-user-hovercard .sidepeek-hovercard-follow-btn').click();
    await page.waitForFunction(() => document.querySelector('#xpc-rate-limit-toast')?.textContent.includes('X 暂时不允许继续关注'));
    assert.doesNotMatch(await page.locator('#xpc-rate-limit-toast').textContent(), /<a\b|href=/,
      'HTML in the X error is not shown verbatim');
    assert.equal(await popup.locator('#follow-total').textContent(), '1', 'rejected follow and unfollow attempts do not increase the count');
    await page.locator('.sidepeek-btn-close').click();
    followLimitReached = false;
    await page.evaluate(async () => {
      const response = await fetch('/i/api/1.1/friendships/create.json', {
        method: 'POST', body: 'user_id=999&screen_name=other', headers: { 'content-type': 'application/x-www-form-urlencoded' }
      });
      await response.json();
    });
    await popup.waitForFunction(() => document.querySelector('#follow-total')?.textContent === '2');
    await page.evaluate(() => new Promise(resolve => {
      const request = new XMLHttpRequest();
      request.open('POST', '/i/api/1.1/friendships/create.json');
      request.onload = resolve;
      request.send('user_id=1000&screen_name=xhr_user');
    }));
    await popup.waitForFunction(() => document.querySelector('#follow-total')?.textContent === '3');
    await popup.locator('#follow-manual-panel summary').click();
    await popup.locator('#follow-manual').fill('12');
    await popup.locator('#follow-manual-form button').click();
    await popup.waitForFunction(() => document.querySelector('#follow-total')?.textContent === '15');
    assert.match(await popup.locator('#follow-sources').textContent(), /自动 3 \+ 补记 12/);
    await popup.locator('#follow-manual').fill('346');
    await popup.locator('#follow-manual-form button').click();
    await popup.waitForFunction(() => document.querySelector('#follow-total')?.textContent === '349');
    await page.evaluate(async () => {
      const response = await fetch('/i/api/1.1/friendships/create.json', {
        method: 'POST', body: 'user_id=1001&screen_name=next', headers: { 'content-type': 'application/x-www-form-urlencoded' }
      });
      await response.json();
    });
    await popup.waitForFunction(() => document.querySelector('#follow-total')?.textContent === '350');
    await page.locator('#xpc-follow-warning[role="alert"]').waitFor();
    assert.match(await page.locator('#xpc-follow-warning').textContent(), /350/);
    await popup.close();
    assert.equal(await page.locator('#sidepeek-drawer-root').evaluate(node => node.classList.contains('sidepeek-open')), false);
    await page.locator('.post-text').evaluate(node => node.click());
    await page.locator('#sidepeek-drawer-root.sidepeek-open').waitFor();
    await page.locator('.sidepeek-comment-item').filter({ hasText: '@grace' }).locator('img').first().hover();
    await page.locator('#sidepeek-user-hovercard.visible .sidepeek-hovercard-follow-btn').click();
    await page.waitForFunction(() => document.querySelector('.xpc-follow-today')?.textContent.includes('351/400'));
    await page.waitForTimeout(300);
    assert.match(await page.locator('.xpc-follow-today').textContent(), /351\/400/,
      'SideX success and network observation for one request count only once');
    followMode = 'native-legacy';
    await page.goto('https://x.com/xiaopei01/followers');
    await page.evaluate(async () => {
      const response = await fetch('/i/api/1.1/friendships/create.json', {
        method: 'POST', body: new URLSearchParams({ user_id: '1002' }),
        headers: { 'content-type': 'application/x-www-form-urlencoded' }
      });
      await response.json();
    });
    const followerPopup = await context.newPage();
    await followerPopup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await followerPopup.waitForFunction(() => document.querySelector('#follow-total')?.textContent === '352');
    await followerPopup.close();
    await page.goto('https://x.com/home');
    await page.evaluate(() => {
      const runtime = function () {};
      runtime.c = {
        detail: { exports: { operationName: 'TweetDetail', queryId: 'fixture', metadata: { featureSwitches: [], fieldToggles: [] } } },
        user: { exports: { operationName: 'UserByScreenName', queryId: 'fixture-user', metadata: { featureSwitches: [], fieldToggles: [] } } }
      };
      runtime.m = {};
      window.webpackChunkFixture = [];
      window.webpackChunkFixture.push = parts => parts[2](runtime);
    });
    await page.locator('.post-text').click();
    await page.locator('#sidepeek-drawer-root.sidepeek-open').waitFor();
    if (await page.locator('.xpc-filter-blue[aria-pressed="true"]').count()) await page.locator('.xpc-filter-blue').click();
    await page.locator('.sidepeek-comment-item').filter({ hasText: '@bob' }).locator('img').first().hover();
    await page.locator('#sidepeek-user-hovercard.visible .sidepeek-hovercard-follow-btn').waitFor();
    const followsBeforeReload = followRequests;
    await worker.evaluate(() => chrome.runtime.reload()).catch(() => {});
    await page.locator('#sidepeek-user-hovercard .sidepeek-hovercard-follow-btn').click();
    await page.waitForFunction(() => document.querySelector('.xpc-follow-today')?.dataset.level === 'error');
    assert.equal(followRequests, followsBeforeReload, 'stale tabs do not send an uncounted follow to X');
    assert.match(await page.locator('.xpc-follow-today').textContent(), /刷新 X 页面/);
    assert.deepEqual(errors, []);
    console.log('PASS: SideX original comments/hover/follow, filter toggles, state preservation.');
  } finally {
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
