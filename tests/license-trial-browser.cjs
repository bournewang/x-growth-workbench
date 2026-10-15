// Local fixture only: does not log in, follow, publish or contact the license service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const directory = path.resolve(__dirname, '../dist/X涨粉工作台-0.8.2/extension');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xpc-trial-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_EXECUTABLE, channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`]
  });
  try {
    await context.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh"><body><h1>Local X fixture</h1></body></html>' }));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByText('打开并刷新 X 页面，即可自动开始 3 天免费试用，无需激活码。', { exact: true }).waitFor();
    assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('xpcTrial')).xpcTrial), undefined);
    const page = await context.newPage();
    await page.goto('https://x.com/home');
    await popup.reload();
    await popup.getByText('免费试用中，无需激活码。也可以提前输入购买后的激活码。', { exact: true }).waitFor();
    assert.equal(await popup.locator('#workbench-main').evaluate(el => el.classList.contains('license-locked')), false);
    assert.equal(await popup.locator('#license-entry').getAttribute('open'), null);
    const first = await worker.evaluate(async () => (await chrome.storage.local.get('xpcTrial')).xpcTrial);
    assert.equal(first.expiresAt - first.startedAt, 3 * 86400e3);
    await page.reload();
    const again = await worker.evaluate(async () => (await chrome.storage.local.get('xpcTrial')).xpcTrial);
    assert.equal(again.expiresAt, first.expiresAt);
    await worker.evaluate(async () => {
      const now = Date.now();
      await chrome.storage.local.set({ xpcTrial: { startedAt: now - 4 * 86400e3, expiresAt: now - 86400e3, lastSeenAt: now } });
    });
    await popup.reload();
    await popup.getByText('3 天免费试用已结束，请输入购买后的激活码继续使用。', { exact: true }).waitFor();
    assert.equal(await popup.locator('#workbench-main').evaluate(el => el.classList.contains('license-locked')), true);
    assert.equal((await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'get' }))).ok, false);
    await page.reload();
    assert.equal(await page.locator('#sidepeek-drawer-root').count(), 0);
    assert.equal((await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'license:status', startTrial: true }))).active, false, 'popup cannot restart trial');
    console.log('PASS: no-code trial starts on X only, persists, expires and locks popup/sidebar/counters.');
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
