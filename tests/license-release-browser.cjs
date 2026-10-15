// Uses a fresh Chromium profile and the owner's test code from macOS Keychain.
// X is fulfilled locally; the activation Worker is the only real network call.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const code = execFileSync('security', ['find-generic-password', '-a', 'xiaopei0206@icloud.com',
    '-s', 'x-growth-owner-license', '-w'], { encoding: 'utf8' }).trim();
  const directory = path.resolve(__dirname, '../dist/X涨粉工作台-0.8.2/extension');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'x-growth-license-browser-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE,
    headless: true, args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`]
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator('#license-panel').waitFor({ state: 'visible' });
    assert.equal(await popup.locator('#workbench-main').evaluate(el => el.classList.contains('license-locked')), true);
    await popup.locator('#license-code').fill(code);
    await popup.locator('#license-form button').click();
    await popup.locator('#license-panel').waitFor({ state: 'hidden', timeout: 20000 });
    assert.equal(await popup.locator('#workbench-main').evaluate(el => el.classList.contains('license-locked')), false);
    const status = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'license:status', force: true }));
    assert.equal(status.active, true);
    console.log('PASS: paid extension activates online and unlocks the workbench.');
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
