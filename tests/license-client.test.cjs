const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('activation stores one installation, sends no buyer email, and rejects revocation', async () => {
  const data = {};
  const calls = [];
  let mode = 'ok';
  const chrome = { storage: { local: {
    async get(key) { return { [key]: data[key] }; },
    async set(values) { Object.assign(data, values); },
    async remove(key) { delete data[key]; }
  } } };
  const context = { chrome, crypto, AbortController, setTimeout, clearTimeout,
    XPCLicenseConfig: { apiBaseUrl: 'https://license.example.com', required: true },
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      if (mode === 'offline') throw new Error('offline');
      if (mode === 'revoked') return { ok: false, status: 403, json: async () => ({ error: 'invalid_code' }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, licenseId: 'license-1' }) };
    }
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/license-client.js'), 'utf8'), context);
  const client = context.XPCLicenseClient;
  assert.equal((await client.status()).reason, 'trial_not_started');
  const code = 'XGW-AAAA-AAAA-AAAA-AAAA-AAAA';
  assert.equal((await client.activate(code)).active, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['code', 'installationId']);
  assert.equal(data.xpcLicense.code, code);
  assert.equal((await client.status()).active, true);
  assert.equal(calls.length, 1, 'recent verification uses the cached result');
  data.xpcLicense.checkedAt = Date.now() - 2 * 86400e3;
  mode = 'offline';
  assert.equal((await client.status()).mode, 'offline_grace');
  data.xpcLicense.checkedAt = Date.now() - 8 * 86400e3;
  assert.equal((await client.status()).active, false);
  mode = 'revoked';
  assert.equal((await client.status()).reason, 'invalid_code');
  assert.equal(data.xpcLicense.code, code, 'revoked paid credentials must not reopen a trial');
  mode = 'offline';
  assert.equal((await client.status()).active, false, 'revocation must survive cached checks and network loss');
});

test('expired license cannot use the offline grace period or cached authorization', async () => {
  const data = {};
  let offline = false;
  let expiry = Date.now() + 60000;
  let calls = 0;
  const chrome = { storage: { local: {
    async get(key) { return { [key]: data[key] }; },
    async set(values) { Object.assign(data, values); },
    async remove(key) { delete data[key]; }
  } } };
  const context = { chrome, crypto, AbortController, setTimeout, clearTimeout,
    XPCLicenseConfig: { apiBaseUrl: 'https://license.example.com', required: true },
    fetch: async () => {
      calls++;
      if (offline) throw new Error('offline');
      return { ok: true, status: 200, json: async () => ({ ok: true, licenseId: 'license-2', expiresAt: expiry }) };
    }
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/license-client.js'), 'utf8'), context);
  const client = context.XPCLicenseClient;
  await client.activate('XGW-AAAA-AAAA-AAAA-AAAA-AAAA');
  assert.equal(data.xpcLicense.expiresAt, expiry);
  assert.equal((await client.status()).expiresAt, expiry);
  assert.equal(calls, 1);
  data.xpcLicense.expiresAt = Date.now() - 1000;
  offline = true;
  assert.equal((await client.status()).reason, 'expired');
  assert.equal(calls, 2, 'expired cache must try online verification');
  offline = false;
  expiry = Date.now() + 2 * 86400e3;
  assert.equal((await client.status()).active, true, 'server may extend an expired local license');
  assert.equal(data.xpcLicense.expiresAt, expiry);
});


test('trial starts only on X use, survives restarts, expires without offline grace and accepts a paid code', async () => {
  const data = {};
  let now = 1800000000000;
  let online = false;
  const clock = class extends Date { static now() { return now; } };
  const context = {
    chrome: { storage: { local: {
      async get(key) { return { [key]: data[key] }; },
      async set(values) { Object.assign(data, values); },
      async remove(key) { delete data[key]; }
    } } }, crypto, AbortController, setTimeout, clearTimeout, Date: clock,
    XPCLicenseConfig: { apiBaseUrl: 'https://license.example.com', required: true, trialDays: 3 },
    fetch: async () => {
      if (!online) throw new Error('offline');
      return { ok: true, status: 200, json: async () => ({ ok: true, licenseId: 'paid', expiresAt: now + 30 * 86400e3 }) };
    }
  };
  context.globalThis = context;
  const source = fs.readFileSync(path.join(__dirname, '../extension/license-client.js'), 'utf8');
  vm.runInNewContext(source, context);
  let client = context.XPCLicenseClient;
  assert.equal((await client.status()).reason, 'trial_not_started');
  assert.equal(data.xpcTrial, undefined, 'opening popup or updating badge must not start trial');
  const results = await Promise.all([client.status(false, true), client.status(false, true)]);
  assert.ok(results.every(r => r.active && r.mode === 'trial'));
  const expiresAt = results[0].expiresAt;
  assert.equal(expiresAt, now + 3 * 86400e3);
  now += 86400e3;
  vm.runInNewContext(source, context);
  client = context.XPCLicenseClient;
  assert.equal((await client.status()).expiresAt, expiresAt, 'restart cannot renew trial');
  assert.equal((await client.activate('bad')).reason, 'invalid_input');
  assert.equal((await client.status()).mode, 'trial', 'bad code does not cancel trial');
  now = expiresAt;
  assert.equal((await client.status()).reason, 'trial_expired');
  assert.equal((await client.status(false, true)).active, false, 'expired trial does not restart');
  online = true;
  assert.equal((await client.activate('XGW-AAAA-AAAA-AAAA-AAAA-AAAA')).mode, 'online');
  assert.equal((await client.status()).active, true);
});

test('trial detects clock rollback and fails closed on corrupt saved timestamps', async () => {
  const now = Date.now();
  const data = { xpcTrial: { startedAt: now - 86400e3, expiresAt: now + 2 * 86400e3, lastSeenAt: now + 120000 } };
  const context = { chrome: { storage: { local: {
    async get(key) { return { [key]: data[key] }; }, async set(values) { Object.assign(data, values); }
  } } }, crypto, Date, XPCLicenseConfig: { required: true, apiBaseUrl: 'https://license.example.com', trialDays: 3 } };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/license-client.js'), 'utf8'), context);
  assert.equal((await context.XPCLicenseClient.status()).active, false);
  data.xpcTrial.expiresAt = 'bad';
  assert.equal((await context.XPCLicenseClient.status(false, true)).active, false);
});
