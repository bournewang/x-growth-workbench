// Local HTTPS fixtures exercise the actual extension; no real X accounts or comments.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const user = (id, handle, followedBy) => ({ __typename: 'User', rest_id: id,
  core: { screen_name: handle, name: handle }, relationship_perspectives: { following: true, followed_by: followedBy },
  avatar: { image_url: 'https://x.com/avatar.svg' }, banner: { image_url: 'https://x.com/banner.svg' },
  location: { location: '上海' }, is_blue_verified: true,
  legacy: { description: '记录产品、设计和生活。\n在这里分享有趣的发现，也期待与你交流。', followers_count: 12345, friends_count: 328 } });
const tweet = { __typename: 'Tweet', rest_id: '100', core: { user_results: { result: user('2', 'bob', false) } },
  legacy: { full_text: '最近的一条帖子', conversation_id_str: '100', created_at: 'Mon Oct 19 06:00:00 +0000 2026', reply_count: 0 } };
let returned = false;
let followingOwner = '1';
let failReply = true;
const submitted = [];
const following = () => ({ data: { user: { result: { timeline: { timeline: { instructions: [{ entries:
  [user('2', 'bob', returned), user('3', 'carol', true), user('4', 'dave', undefined)].map(u => ({
    entryId: 'user-' + u.rest_id, content: { itemContent: { user_results: { result: u } } }
  })) }] } } } } } });
const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><style>
body{margin:0;font:15px system-ui;background:#fff}#react-root{display:flex;justify-content:center}main{width:600px;min-height:1500px}nav{width:140px}[data-testid=UserCell]{padding:20px;border-bottom:1px solid #ddd}[data-testid=sidebarColumn]{width:520px}
</style><div id="react-root"><nav><a data-testid="AppTabBar_Profile_Link" href="/viewer">个人资料</a></nav><main data-testid="primaryColumn"><h1>正在关注</h1>
${['bob','carol','dave'].map(h => `<div data-testid="cellInnerDiv"><div data-testid="UserCell"><div class="user-identity" style="display:flex;flex-direction:column"><a href="/${h}">${h}</a><span data-testid="userFollowIndicator">${h === 'carol' ? '关注了你' : ''}</span></div><button>正在关注</button><p class="user-bio">${h} 的简介</p></div></div>`).join('')}
</main><div data-testid="sidebarColumn"></div></div><div id="layers"></div></html>`;
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xpc-nonfollowers-'));
  execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(temp,'key'),'-out',path.join(temp,'cert'),'-subj','/CN=x.com','-days','1'], { stdio:'ignore' });
  let context;
  let postRequests = 0;
  const server = https.createServer({ key:fs.readFileSync(path.join(temp,'key')),cert:fs.readFileSync(path.join(temp,'cert')) }, (req,res) => {
    const send = data => { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(data)); };
    if (req.method === 'POST') postRequests++;
    if (req.url.includes('/Following')) return send(following());
    if (req.url.includes('/UserByScreenName')) return send({data:{user:{result:user('2','bob',returned)}}});
    if (req.url.includes('/UserTweets')) {
      const vars = JSON.parse(new URL(req.url, 'https://x.com').searchParams.get('variables'));
      const post = vars.cursor ? {...tweet,rest_id:'102',legacy:{...tweet.legacy,full_text:'更早的一条帖子'}} : tweet;
      const entries = [{entryId:'tweet-'+post.rest_id,content:{itemContent:{tweet_results:{result:post}}}}];
      if (!vars.cursor) entries.push({content:{cursorType:'Bottom',value:'next-page'}});
      return send({ data: { user: { result: { timeline_v2: { timeline: { instructions: [{entries}] } } } } } });
    }
    if (req.url.includes('/CreateTweet')) {
      let body = ''; req.on('data',chunk => body += chunk); req.on('end', () => {
        submitted.push(JSON.parse(body).variables);
        if (failReply === 'unconfirmed') { send({data:{create_tweet:{}}}); return; }
        if (failReply) {res.writeHead(429, {'content-type':'application/json'});res.end(JSON.stringify({errors:[{message:'Rate limit exceeded'}]}));return;}
        send({data:{create_tweet:{tweet_results:{result:{...tweet,rest_id:'110',legacy:{...tweet.legacy,in_reply_to_status_id_str:'100'}}}}}});
      }); return;
    }
    if (req.url.endsWith('.svg')) {
      res.writeHead(200,{'content-type':'image/svg+xml'});
      res.end(req.url.includes('banner') ? '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400"><defs><linearGradient id="b"><stop stop-color="#122d44"/><stop offset="1" stop-color="#417e9c"/></linearGradient></defs><path fill="url(#b)" d="M0 0h1200v400H0z"/><circle cx="980" cy="150" r="110" fill="#84adbb"/><path d="M0 400L390 130l400 270M550 400l310-170 340 170" fill="#173c50"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><path fill="#bfd5de" d="M0 0h200v200H0z"/><circle cx="100" cy="78" r="38" fill="#476e80"/><path d="M30 200v-25a70 70 0 01140 0v25" fill="#476e80"/></svg>');return;
    }
    res.writeHead(200, {'content-type':'text/html','set-cookie':['twid=u%3D1; Path=/; Secure; SameSite=Lax','ct0=fixture; Path=/; Secure; SameSite=Lax']}); res.end(html);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const extension = path.resolve(__dirname,'../extension');
    context = await chromium.launchPersistentContext(path.join(temp,'profile'), { channel:'chromium', headless:true,
      executablePath:process.env.CHROMIUM_EXECUTABLE, ignoreHTTPSErrors:true, viewport:{width:1440,height:900},
      args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-proxy-server',`--host-resolver-rules=MAP x.com 127.0.0.1:${server.address().port}`,'--ignore-certificate-errors'] });
    await context.route('**/*', route => new URL(route.request().url()).hostname === 'x.com' || route.request().url().startsWith('chrome-extension:') ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    async function setup() {
      await page.goto('https://x.com/viewer/following');
      await page.evaluate(() => {
        const runtime = function() {};
        runtime.c = Object.fromEntries(['UserByScreenName','UserTweets','TweetDetail','CreateTweet'].map(name => [name,{exports:{operationName:name,queryId:'fixture',metadata:{featureSwitches:[],fieldToggles:[]}}}]));
        runtime.m = {}; window.webpackChunkFixture = []; window.webpackChunkFixture.push = parts => parts[2](runtime);
      });
      await page.locator('#xpc-following-tools').waitFor();
    }
    async function scan() {
      await page.evaluate(owner => fetch('/i/api/graphql/fixture/Following?variables='+encodeURIComponent(JSON.stringify({userId:owner}))), followingOwner);
    }
    await setup(); await scan();
    await page.waitForFunction(() => document.querySelector('#xpc-following-tools p').textContent.includes('未回关 1'));
    await page.locator('#xpc-following-tools select').selectOption('non');
    assert.equal(await page.locator('[data-testid=UserCell]:not(.xpc-nf-hidden)').count(),1);
    const bobRow = page.locator('[data-testid=UserCell]').filter({has:page.locator('a[href="/bob"]')});
    assert.equal(await bobRow.locator('.xpc-nf-non-badge').textContent(), '未回关');
    assert.equal(await bobRow.locator('.xpc-nf-non-badge').evaluate(node => getComputedStyle(node).color), 'rgb(244, 33, 46)');
    assert.equal(await bobRow.locator('.xpc-nf-row-labels').evaluate(node => node.previousElementSibling?.getAttribute('data-testid')), 'userFollowIndicator');
    const rowLayout = await bobRow.locator('.xpc-nf-row-labels').evaluate(labels => ({
      direction:getComputedStyle(labels.parentElement).flexDirection,
      wrap:getComputedStyle(labels).flexWrap,
      nativeY:labels.previousElementSibling.getBoundingClientRect().y,
      labelsY:labels.getBoundingClientRect().y
    }));
    assert.equal(rowLayout.direction, 'row');
    assert.equal(rowLayout.wrap, 'nowrap');
    await bobRow.locator('.user-bio').click();
    await page.locator('.xpc-nf-post').waitFor();
    await page.getByRole('button',{name:'关闭主页',exact:true}).click();
    await bobRow.click({position:{x:350,y:12}});
    await page.locator('.xpc-nf-post').waitFor();
    await page.getByRole('button',{name:'关闭主页',exact:true}).click();
    await bobRow.locator('button').evaluate(node => node.addEventListener('click', () => window.nativeFollowClicks = (window.nativeFollowClicks || 0) + 1));
    await bobRow.locator('button').click();
    assert.equal(await page.evaluate(() => window.nativeFollowClicks), 1);
    assert.equal(await page.locator('#xpc-nf-profile').isVisible(), false, 'native follow button is not intercepted');
    await bobRow.locator('.user-bio').click({modifiers:['Control']});
    assert.equal(await page.locator('#xpc-nf-profile').isVisible(), false, 'modified clicks are not intercepted');
    await bobRow.locator('.xpc-nf-non-badge').click();
    await page.locator('.xpc-nf-post').waitFor();
    assert.equal(await page.locator('iframe, .xpc-nf-history, .xpc-nf-badge, .xpc-nf-record').count(), 0);
    assert.equal(await page.locator('[data-testid="userFollowIndicator"]').count(), 3, 'native relationship indicators are untouched');
    assert.equal(new URL(page.url()).pathname,'/viewer/following');
    await page.locator('.xpc-nf-banner-image').waitFor();
    assert.match(await page.locator('.xpc-nf-post-source time').first().textContent(), /2026/);
    assert.equal(await page.locator('.xpc-nf-post-source').first().getAttribute('href'), 'https://x.com/bob/status/100');
    assert.equal(await page.locator('.xpc-nf-post-source time').first().getAttribute('datetime'), '2026-10-19T06:00:00.000Z');
    await page.screenshot({path:'/tmp/xpc-profile-styled.png'});
    assert.equal(await page.locator('.xpc-nf-reminder').textContent(), '未提醒');
    const openReply = () => page.locator('.xpc-nf-reply-button').first().click();
    await openReply();
    await page.getByRole('button',{name:'关闭回复',exact:true}).click();
    assert.equal(await page.locator('.xpc-nf-reminder').textContent(), '未提醒');
    await openReply();
    await page.getByRole('textbox',{name:'回复 @bob',exact:true}).fill('仅向本机模拟页面发送');
    await page.screenshot({path:'/tmp/xpc-profile-reply.png'});
    await page.getByRole('button',{name:'发送回复',exact:true}).click();
    await page.getByText('Rate limit exceeded',{exact:true}).waitFor();
    assert.equal(await page.locator('.xpc-nf-reminder').textContent(), '未提醒','failed send never marks reminder');
    assert.match(await page.locator('#xpc-following-tools p').textContent(), /累计已提醒 0 人/);
    assert.equal(await page.locator('#xpc-nf-reply-text').inputValue(), '仅向本机模拟页面发送');
    failReply = 'unconfirmed';
    await page.getByRole('button',{name:'发送回复',exact:true}).click();
    await page.getByText('未能确认留言结果，请先检查帖子，避免重复发送。',{exact:true}).waitFor();
    assert.equal(await page.locator('.xpc-nf-reminder').textContent(), '未提醒', 'unconfirmed response never marks a reminder');
    failReply = false;
    await page.getByRole('button',{name:'发送回复',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('#xpc-nf-reply').hidden);
    assert.match(await page.locator('.xpc-nf-reminder').textContent(), /^已提醒-/);
    assert.match(await bobRow.locator('.xpc-nf-reminded-badge').textContent(), /^已提醒-/);
    assert.match(await page.locator('#xpc-following-tools p').textContent(), /累计已提醒 1 人/);
    const badges = await bobRow.locator('.xpc-nf-row-labels').evaluate(node => [...node.children].map(child => child.getBoundingClientRect().y));
    assert.equal(badges[0], badges[1], 'non-follower and reminder labels share a single row');
    assert.equal(await page.locator('#sidepeek-drawer-root.sidepeek-open').count(), 0, 'reply uses a dialog without opening another drawer');
    assert.equal(context.pages().filter(p => p.url().startsWith('https://x.com')).length, 1, 'no new tab or window');
    assert.equal(submitted.length, 3);
    assert.equal(submitted[2].reply.in_reply_to_tweet_id, '100');
    assert.equal(submitted[2].tweet_text, '仅向本机模拟页面发送');
    await openReply();
    await page.getByRole('textbox',{name:'回复 @bob',exact:true}).fill('账号切换后不能误发');
    const accountError = await page.evaluate(() => {
      document.cookie='twid=u%3D99; Path=/; Secure';
      document.querySelector('.xpc-nf-primary').click();
      const message = document.querySelector('.xpc-nf-reply-error').textContent;
      document.cookie='twid=u%3D1; Path=/; Secure';
      return message;
    });
    assert.match(accountError, /登录账号已切换/);
    assert.equal(submitted.length, 3, 'account switch prevents another send');
    await page.getByRole('button',{name:'关闭回复',exact:true}).click();
    await page.getByRole('button',{name:'加载更多帖子',exact:true}).click();
    await page.getByText('更早的一条帖子',{exact:true}).waitFor();
    assert.equal(await page.locator('.xpc-nf-post').count(), 2);
    await page.getByRole('button',{name:'关闭主页',exact:true}).click();
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async () => {
      const key = 'xpc:nonfollowers:1';
      const saved = (await chrome.storage.local.get(key))[key];
      saved['2'].remindedAt = Date.now() - 3 * 3600000;
      await chrome.storage.local.set({[key]:saved});
    });
    await setup();
    await page.locator('#xpc-following-tools select').selectOption('pending');
    assert.equal(await page.locator('[data-testid=UserCell]:not(.xpc-nf-hidden)').count(), 1);
    returned = true; await scan();
    await page.waitForFunction(() => document.querySelector('#xpc-following-tools p').textContent.includes('新增回关 1'));
    await page.locator('#xpc-following-tools select').selectOption('returned');
    await page.locator('[data-testid=UserCell] a[href="/bob"]').click();
    await page.locator('.xpc-nf-post').waitFor();
    assert.equal(await page.locator('.xpc-nf-reminder').textContent(), '已提醒-3小时前', 'successful reminder survives reload with relative time');
    assert.match(await page.locator('#xpc-following-tools p').textContent(), /累计已提醒 1 人/);
    assert.equal(await bobRow.locator('.xpc-nf-reminded-badge').textContent(), '已提醒-3小时前');
    await bobRow.locator('[data-testid="userFollowIndicator"]').evaluate(node => node.textContent = '关注了你');
    const tagLayout = await bobRow.locator('.xpc-nf-row-labels').evaluate(labels => {
      const native = labels.previousElementSibling;
      return { nativeY:native.getBoundingClientRect().y, labelsY:labels.getBoundingClientRect().y, direction:getComputedStyle(labels.parentElement).flexDirection };
    });
    assert.equal(tagLayout.direction,'row');
    assert.ok(Math.abs(tagLayout.nativeY-tagLayout.labelsY) <= 4, 'native relationship and reminder stay on the same line');
    assert.equal(await bobRow.locator('.xpc-nf-non-badge').count(), 0, 'non-follower label disappears after a confirmed follow-back');
    await page.evaluate(() => { document.body.style.backgroundColor = '#000'; document.body.style.color = '#e7e9ea'; });
    await page.getByRole('button',{name:'关闭主页',exact:true}).click();
    await page.locator('[data-testid=UserCell] a[href="/bob"]').click();
    await page.locator('.xpc-nf-post').waitFor();
    assert.equal(await page.locator('#xpc-nf-profile').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(0, 0, 0)');
    await page.screenshot({path:'/tmp/xpc-profile-dark.png'});
    await page.getByRole('button',{name:'关闭主页',exact:true}).click();
    followingOwner = '999'; returned = false; await scan();
    assert.match(await page.locator('#xpc-following-tools p').textContent(),/新增回关 1/,'another account timeline cannot change own records');
    await page.screenshot({path:'/tmp/xpc-nonfollowers-preview.png',fullPage:false});
    await page.evaluate(() => { document.cookie='twid=u%3D99; Path=/; Secure'; });
    await page.waitForFunction(() => document.querySelector('#xpc-following-tools p')?.textContent.includes('累计已提醒 0 人'));
    await page.locator('#xpc-following-tools select').selectOption('pending');
    assert.equal(await page.locator('[data-testid=UserCell]:not(.xpc-nf-hidden)').count(), 0);
    assert.match(await page.locator('#xpc-following-tools p').textContent(), /累计已提醒 0 人/, 'reminder total is isolated by account');
    assert.equal(postRequests,3,'only the explicit failed, unconfirmed and successful reply requests are sent');
    assert.deepEqual(errors,[]);
    console.log('PASS: native-list-only filtering, styled profile light/dark, no iframe or nested drawer, reply dialog cancel/failure/success, automatic reminder persistence, pagination, account isolation.');
  } finally { await context?.close(); await new Promise(resolve=>server.close(resolve)); fs.rmSync(temp,{recursive:true,force:true}); }
})().catch(error => { console.error(error); process.exitCode=1; });
