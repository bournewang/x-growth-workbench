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
  assert.equal((await client.status()).reason, 'not_activated');
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
  assert.equal(data.xpcLicense, undefined);
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
