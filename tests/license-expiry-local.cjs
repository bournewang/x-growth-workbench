const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const base = process.env.LICENSE_TEST_BASE_URL;
const token = process.env.LICENSE_TEST_ADMIN_TOKEN;
if (!base || !token || !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(base)) {
  console.error('This test requires a local Worker URL and a local admin token.');
  process.exit(2);
}

(async () => {
  const buyerEmail = `expiry-test-${crypto.randomUUID()}@example.invalid`;
  const installationId = crypto.randomUUID();
  const issuedResponse = await fetch(`${base}/v1/admin/issue`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ buyerEmail })
  });
  assert.equal(issuedResponse.status, 201);
  const { code, licenseId } = await issuedResponse.json();
  const changed = spawnSync('wrangler', ['d1', 'execute', 'DB', '--local',
    '--command', `UPDATE licenses SET expires_at = 1 WHERE license_id = '${licenseId}'`], {
    cwd: path.join(__dirname, '../license-server'), encoding: 'utf8'
  });
  assert.equal(changed.status, 0, changed.stderr);
  for (const route of ['activate', 'verify']) {
    const response = await fetch(`${base}/v1/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, installationId })
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'expired');
  }
  console.log('Local expired code is rejected for activation and verification.');
})().catch(error => { console.error(error); process.exitCode = 1; });
