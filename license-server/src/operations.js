const DAY = 86400000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const secretPattern = /^[a-f0-9]{64}$/;
export const publicOperations = ['/v1/install/register', '/v1/install/trial', '/v1/install/usage', '/v1/install/privacy'];
export const dayKey = time => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
}
export function result(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
function fail(error, status = 400) { return result({ ok: false, error }, status); }
export function audit(env, action, licenseId = null) {
  return env.DB.prepare('INSERT INTO admin_audit (id, action, license_id, created_at) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), action, licenseId, Date.now());
}
export async function sessionAuthorized(request, env) {
  const token = /(?:^|;\s*)xgrowth_admin=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get('Cookie') || '')?.[1];
  if (!token) return false;
  const row = await env.DB.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash = ?').bind(await digest(token)).first();
  return !!row && row.expires_at > Date.now();
}
export async function authentication(request, env, body, path) {
  const origin = new URL(request.url).origin;
  if (request.headers.get('Origin') !== origin || request.headers.get('X-Admin-Request') !== '1') return fail('origin_rejected', 403);
  if (path === '/v1/admin/logout') {
    const token = /(?:^|;\s*)xgrowth_admin=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get('Cookie') || '')?.[1];
    if (token) await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await digest(token)).run();
    return result({ ok: true }, 200, { 'Set-Cookie': 'xgrowth_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
  }
  const password = env.ADMIN_PASSWORD || env.ADMIN_TOKEN;
  if (!password) return fail('server_not_configured', 503);
  const now = Date.now();
  const key = await digest((request.headers.get('CF-Connecting-IP') || 'local') + ':' + env.ADMIN_TOKEN);
  const previous = await env.DB.prepare('SELECT failures, window_start FROM login_attempts WHERE client_hash = ?').bind(key).first();
  if (previous && previous.window_start > now - 900000 && previous.failures >= 5) return fail('login_rate_limited', 429);
  // Compare fixed-size digests to avoid disclosing password length or a partial match.
  const actual = await digest(String(body.password || ''));
  const expected = await digest(password);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  if (difference) {
    await env.DB.prepare(`INSERT INTO login_attempts(client_hash, failures, window_start) VALUES (?, 1, ?)
      ON CONFLICT(client_hash) DO UPDATE SET failures = CASE WHEN window_start > ? THEN failures + 1 ELSE 1 END,
      window_start = CASE WHEN window_start > ? THEN window_start ELSE excluded.window_start END`).bind(key, now, now - 900000, now - 900000).run();
    return fail('unauthorized', 401);
  }
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map(v => v.toString(16).padStart(2, '0')).join('');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM login_attempts WHERE client_hash = ?').bind(key),
    env.DB.prepare('INSERT INTO admin_sessions(token_hash, expires_at) VALUES (?, ?)').bind(await digest(token), now + 8 * 3600000)
  ]);
  return result({ ok: true }, 200, { 'Set-Cookie': `xgrowth_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800` });
}
export async function installationRoute(env, body, path) {
  const id = body.installationId;
  const token = body.installToken;
  if (!uuid.test(String(id || '')) || !secretPattern.test(String(token || ''))) return fail('invalid_input');
  const hash = await digest(token);
  const now = Date.now();
  if (path === '/v1/install/register') {
    if (typeof body.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(body.version)) return fail('invalid_input');
    // Idempotent registration never replaces credentials or restarts trial.
    await env.DB.prepare('INSERT OR IGNORE INTO installations(installation_id, token_hash, first_seen_at, version) VALUES (?, ?, ?, ?)').bind(id, hash, now, body.version).run();
  }
  let row = await env.DB.prepare('SELECT * FROM installations WHERE installation_id = ? AND token_hash = ?').bind(id, hash).first();
  if (!row) return fail('installation_unauthorized', 403);
  if (path === '/v1/install/register') await env.DB.prepare('UPDATE installations SET version = ?, telemetry_enabled = CASE WHEN ? = 1 THEN 1 ELSE telemetry_enabled END WHERE installation_id = ?').bind(body.version, body.reportingRequired === true ? 1 : 0, id).run();
  if (path === '/v1/install/register' || path === '/v1/install/trial') {
    if (body.startTrial === true) {
      const previous = body.previousTrialExpiresAt;
      if (previous !== undefined && (!Number.isSafeInteger(previous) || previous < 0)) return fail('invalid_input');
      const expiry = previous === undefined ? now + 3 * DAY : Math.min(previous, now + 3 * DAY);
      await env.DB.prepare('UPDATE installations SET trial_started_at = ?, trial_expires_at = ? WHERE installation_id = ? AND trial_started_at IS NULL').bind(Math.min(now, expiry - 3 * DAY), expiry, id).run();
      row = await env.DB.prepare('SELECT * FROM installations WHERE installation_id = ?').bind(id).first();
    }
    return result({ ok: true, active: !!row.trial_expires_at && now < row.trial_expires_at, expiresAt: row.trial_expires_at, serverTime: now });
  }
  if (path === '/v1/install/privacy') {
    if (typeof body.enabled !== 'boolean') return fail('invalid_input');
    await env.DB.batch([
      env.DB.prepare('UPDATE installations SET telemetry_enabled = ?, last_seen_at = CASE WHEN ? = 0 THEN NULL ELSE last_seen_at END WHERE installation_id = ?').bind(body.enabled ? 1 : 0, body.enabled ? 1 : 0, id),
      ...(body.enabled ? [] : [env.DB.prepare('DELETE FROM daily_usage WHERE installation_id = ?').bind(id), env.DB.prepare('DELETE FROM daily_activity WHERE installation_id = ?').bind(id)])
    ]);
    return result({ ok: true });
  }
  if (!row.telemetry_enabled) return fail('telemetry_disabled', 403);
  if (!Array.isArray(body.days) || body.days.length < 1 || body.days.length > 3 || !Number.isSafeInteger(body.revision) || body.revision < 1) return fail('invalid_input');
  const statements = [];
  const seen = new Set();
  for (const day of body.days) {
    const date = Date.parse(day.day + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.day || '') || !Number.isFinite(date) || new Date(date).toISOString().slice(0,10) !== day.day || date < now - 35 * DAY || date > now + DAY
      || seen.has(day.day) || ![day.automatic, day.manual].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000)) return fail('invalid_input');
    seen.add(day.day);
    statements.push(env.DB.prepare(`INSERT INTO daily_usage(installation_id, usage_day, activity_day, automatic, manual, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(installation_id, usage_day) DO UPDATE SET activity_day = excluded.activity_day, automatic = excluded.automatic,
      manual = excluded.manual, revision = excluded.revision, updated_at = excluded.updated_at WHERE excluded.revision > daily_usage.revision`)
      .bind(id, day.day, dayKey(now), day.automatic, day.manual, body.revision, now));
  }
  await env.DB.batch([...statements, env.DB.prepare('INSERT OR IGNORE INTO daily_activity(installation_id,activity_day) VALUES (?,?)').bind(id,dayKey(now)), env.DB.prepare('UPDATE installations SET last_seen_at = ? WHERE installation_id = ?').bind(now, id)]);
  return result({ ok: true });
}
export async function dashboardRoute(env, body, path) {
  const now = Date.now();
  if (path === '/v1/admin/session') return result({ ok: true });
  if (path === '/v1/admin/overview') {
    const days = body.days === 30 ? 30 : 7;
    const today = dayKey(now);
    const start = dayKey(now - (days - 1) * DAY);
    const todayStart = Date.parse(today + 'T00:00:00+08:00');
    const [counts, trend, distribution, conversion] = await Promise.all([
      env.DB.prepare(`SELECT (SELECT COUNT(*) FROM installations WHERE first_seen_at >= ?) AS newcomers,
        (SELECT COUNT(DISTINCT installation_id) FROM daily_activity WHERE activity_day = ?) AS active,
        (SELECT COUNT(*) FROM installations i WHERE trial_expires_at > ? AND NOT EXISTS(SELECT 1 FROM licenses l WHERE l.installation_id=i.installation_id AND l.status='active' AND (l.expires_at IS NULL OR l.expires_at > ?))) AS trials,
        (SELECT COUNT(DISTINCT installation_id) FROM paid_activations WHERE first_activated_at >= ?) AS activations,
        (SELECT COUNT(*) FROM installations WHERE telemetry_enabled = 1) AS reporting`).bind(todayStart, today, now, now, todayStart).first(),
      env.DB.prepare(`WITH dates AS (SELECT date(?,'+' || value || ' days') AS day FROM json_each(?))
        SELECT day, (SELECT COUNT(*) FROM installations WHERE date(first_seen_at/1000,'unixepoch','+8 hours') = day) AS newcomers,
        (SELECT COUNT(DISTINCT installation_id) FROM daily_activity WHERE activity_day = day) AS active
        FROM dates ORDER BY day`).bind(start, JSON.stringify(Array.from({ length: days }, (_, i) => i))).all(),
      env.DB.prepare(`SELECT SUM(automatic) AS automatic, SUM(manual) AS manual, COUNT(*) AS reporting,
        SUM(CASE WHEN automatic + manual = 0 THEN 1 ELSE 0 END) AS zero,
        SUM(CASE WHEN automatic + manual BETWEEN 1 AND 99 THEN 1 ELSE 0 END) AS low,
        SUM(CASE WHEN automatic + manual BETWEEN 100 AND 349 THEN 1 ELSE 0 END) AS medium,
        SUM(CASE WHEN automatic + manual >= 350 THEN 1 ELSE 0 END) AS high FROM daily_usage WHERE usage_day = ?`).bind(today).first(),
      env.DB.prepare(`SELECT COUNT(*) AS cohort, SUM(CASE WHEN EXISTS(SELECT 1 FROM paid_activations l WHERE l.installation_id = i.installation_id AND l.first_activated_at >= i.trial_started_at) THEN 1 ELSE 0 END) AS converted
        FROM installations i WHERE trial_started_at >= ? AND trial_expires_at <= ?`).bind(now - 30 * DAY, now).first()
    ]);
    return result({ ok: true, today, counts, trend: trend.results, distribution, conversion });
  }
  const offset = Number.isSafeInteger(body.offset) && body.offset >= 0 ? body.offset : 0;
  const query = String(body.query || '').trim().slice(0, 100);
  const like = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
  if (path === '/v1/admin/installations') {
    const rows = await env.DB.prepare(`SELECT i.installation_id, i.first_seen_at, i.last_seen_at, i.version, i.trial_started_at, i.trial_expires_at, i.telemetry_enabled,
      (SELECT l.expires_at FROM licenses l WHERE l.installation_id = i.installation_id AND l.status='active' ORDER BY COALESCE(l.expires_at,9223372036854775807) DESC LIMIT 1) AS paid_expires_at,
      EXISTS(SELECT 1 FROM licenses l WHERE l.installation_id=i.installation_id AND l.status='active' AND (l.expires_at IS NULL OR l.expires_at > ?)) AS paid
      FROM installations i WHERE i.installation_id LIKE ? ESCAPE char(92) ORDER BY i.first_seen_at DESC LIMIT 51 OFFSET ?`).bind(now, like, offset).all();
    return result({ ok: true, rows: rows.results.slice(0,50), more: rows.results.length > 50 });
  }
  if (path === '/v1/admin/installation') {
    if (!uuid.test(body.installationId || '')) return fail('invalid_input');
    const [usage, licenses] = await Promise.all([
      env.DB.prepare('SELECT usage_day, automatic, manual, updated_at FROM daily_usage WHERE installation_id = ? ORDER BY usage_day DESC LIMIT 32').bind(body.installationId).all(),
      env.DB.prepare('SELECT l.license_id, a.first_activated_at AS activated_at, l.expires_at, l.status FROM paid_activations a JOIN licenses l ON l.license_id=a.license_id WHERE a.installation_id = ? ORDER BY a.first_activated_at DESC').bind(body.installationId).all()
    ]);
    return result({ ok: true, usage: usage.results, licenses: licenses.results });
  }
  if (path === '/v1/admin/licenses') {
    const rows = await env.DB.prepare(`SELECT license_id, buyer_email, order_ref, status, installation_id, created_at, expires_at, activated_at FROM licenses
      WHERE buyer_email LIKE ? ESCAPE char(92) OR license_id LIKE ? ESCAPE char(92) OR order_ref LIKE ? ESCAPE char(92) ORDER BY created_at DESC LIMIT 51 OFFSET ?`).bind(like, like, like, offset).all();
    return result({ ok: true, rows: rows.results.slice(0,50), more: rows.results.length > 50 });
  }
  if (path === '/v1/admin/orders') {
    const rows = await env.DB.prepare(`SELECT * FROM orders WHERE buyer_email LIKE ? ESCAPE char(92) OR order_id LIKE ? ESCAPE char(92) ORDER BY created_at DESC LIMIT 51 OFFSET ?`).bind(like, like, offset).all();
    return result({ ok: true, rows: rows.results.slice(0,50), more: rows.results.length > 50 });
  }
  if (path === '/v1/admin/order') {
    const { orderId, buyerEmail, licenseId, planMonths, amountCents, paidAt } = body;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(orderId || '') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail || '') || !uuid.test(licenseId || '')
      || ![1,3,6,12].includes(planMonths) || !Number.isSafeInteger(amountCents) || amountCents < 0 || amountCents > 10000000
      || !Number.isSafeInteger(paidAt) || paidAt > now + 60000 || paidAt < 0 || String(body.note || '').length > 500) return fail('invalid_input');
    const license = await env.DB.prepare('SELECT license_id FROM licenses WHERE license_id = ? AND buyer_email = ?').bind(licenseId, buyerEmail.toLowerCase()).first();
    if (!license) return fail('license_email_mismatch');
    if (await env.DB.prepare('SELECT order_id FROM orders WHERE order_id = ?').bind(orderId).first()) return fail('order_exists',409);
    await env.DB.batch([env.DB.prepare('INSERT INTO orders(order_id,buyer_email,license_id,plan_months,amount_cents,paid_at,created_at,note) VALUES (?,?,?,?,?,?,?,?)').bind(orderId,buyerEmail.toLowerCase(),licenseId,planMonths,amountCents,paidAt,now,String(body.note || '')), audit(env,'order',licenseId)]);
    return result({ ok: true },201);
  }
  if (path === '/v1/admin/audit') {
    const rows = await env.DB.prepare('SELECT action, license_id, created_at FROM admin_audit ORDER BY created_at DESC LIMIT 100').all();
    return result({ ok: true, rows: rows.results });
  }
  return null;
}
