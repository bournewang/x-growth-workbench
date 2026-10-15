const assert = require('node:assert/strict');

const base = process.env.LICENSE_TEST_BASE_URL;
const token = process.env.LICENSE_TEST_ADMIN_TOKEN;
if (!base || !token || !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(base)) {
  console.error('Set LICENSE_TEST_BASE_URL to a local Worker and LICENSE_TEST_ADMIN_TOKEN.');
  process.exit(2);
}

async function call(path, body, admin = false) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  return { status: response.status, data: await response.json() };
}

(async () => {
  const email = `license-test-${crypto.randomUUID()}@example.invalid`;
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  assert.equal((await call('/v1/admin/issue', { buyerEmail: email })).status, 401);
  const issued = await call('/v1/admin/issue', { buyerEmail: email, orderRef: 'LOCAL-TEST' }, true);
  assert.equal(issued.status, 201);
  assert.ok(Math.abs(issued.data.expiresAt - (Date.now() + 3 * 86400e3)) < 10000, 'new codes expire three days after issuance');
  const { code, licenseId } = issued.data;
  assert.match(code, /^XGW-/);
  assert.equal((await call('/v1/activate', { code, installationId: first })).status, 200);
  assert.equal((await call('/v1/verify', { code, installationId: first })).status, 200);
  assert.equal((await call('/v1/activate', { code, installationId: second })).status, 409);
  const lookup = await call('/v1/admin/lookup', { buyerEmail: email }, true);
  assert.equal(lookup.data.licenses[0].order_ref, 'LOCAL-TEST');
  assert.equal(lookup.data.licenses[0].bound, 1);
  assert.equal(lookup.data.licenses[0].expires_at, issued.data.expiresAt);
  assert.equal((await call('/v1/admin/reset', { licenseId, buyerEmail: 'wrong@example.invalid' }, true)).status, 404);
  assert.equal((await call('/v1/admin/reset', { licenseId, buyerEmail: email }, true)).status, 200);
  assert.equal((await call('/v1/activate', { code, installationId: second })).status, 200);
  const reissued = await call('/v1/admin/reissue', { licenseId, buyerEmail: email }, true);
  assert.equal(reissued.status, 200);
  assert.equal(reissued.data.expiresAt, issued.data.expiresAt, 'replacement code keeps the paid term');
  assert.equal((await call('/v1/verify', { code, installationId: second })).status, 403);
  assert.equal((await call('/v1/activate', { code: reissued.data.code, installationId: first })).status, 200);
  assert.equal((await call('/v1/admin/revoke', { licenseId, buyerEmail: email }, true)).status, 200);
  assert.equal((await call('/v1/verify', { code: reissued.data.code, installationId: first })).status, 403);
  const other = await call('/v1/admin/issue', { buyerEmail: email, validDays: 5 }, true);
  assert.equal(other.status, 201);
  assert.ok(Math.abs(other.data.expiresAt - (Date.now() + 5 * 86400e3)) < 10000);
  assert.equal((await call('/v1/admin/issue', { buyerEmail: email, validDays: 0 }, true)).status, 400);
  const threeMonths = await call('/v1/admin/issue', { buyerEmail: email, validMonths: 3 }, true);
  assert.equal(threeMonths.status, 201);
  assert.ok(threeMonths.data.expiresAt > Date.now() + 80 * 86400e3);
  assert.equal((await call('/v1/activate', { code: threeMonths.data.code, installationId: first })).status, 200);
  const extended = await call('/v1/admin/renew', { buyerEmail: email, licenseId: threeMonths.data.licenseId, validMonths: 6 }, true);
  assert.equal(extended.status, 200);
  assert.ok(extended.data.expiresAt > threeMonths.data.expiresAt + 170 * 86400e3, 'renewal adds to remaining term');
  const checkedExtension = await call('/v1/verify', { code: threeMonths.data.code, installationId: first });
  assert.equal(checkedExtension.data.expiresAt, extended.data.expiresAt, 'renewal keeps the same code and device');
  assert.equal((await call('/v1/admin/renew', { buyerEmail: email, licenseId: threeMonths.data.licenseId }, true)).status, 400);
  const forever = await call('/v1/admin/issue', { buyerEmail: email, permanent: true }, true);
  assert.equal(forever.status, 201);
  assert.equal(forever.data.expiresAt, null);
  assert.equal((await call('/v1/admin/renew', { buyerEmail: email, licenseId: forever.data.licenseId, validMonths: 3 }, true)).status, 400);
  const foreverReplacement = await call('/v1/admin/reissue', { buyerEmail: email, licenseId: forever.data.licenseId }, true);
  assert.equal(foreverReplacement.data.expiresAt, null);
  const exact = Date.now() + 40 * 86400e3;
  const dated = await call('/v1/admin/issue', { buyerEmail: email, expiresAt: exact }, true);
  assert.equal(dated.data.expiresAt, exact);
  assert.equal((await call('/v1/admin/issue', { buyerEmail: email, expiresAt: Date.now() - 1 }, true)).status, 400);
  assert.equal((await call('/v1/admin/issue', { buyerEmail: email, validMonths: 6, permanent: true }, true)).status, 400);
  console.log('Local license issue, lookup, binding, reset, reissue and revoke passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
