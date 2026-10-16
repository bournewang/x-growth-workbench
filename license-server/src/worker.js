import { publicOperations, installationRoute, dashboardRoute, authentication, sessionAuthorized, audit, result } from './operations.js';
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codePattern = /^XGW-(?:[A-HJ-NP-Z2-9]{4}-){4}[A-HJ-NP-Z2-9]{4}$/;
const installationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dayMs = 24 * 60 * 60 * 1000;
const defaultValidDays = 3;

function validDays(value) {
  return Number.isInteger(value) && value >= 1 && value <= 3650 ? value : null;
}

function addCalendarMonths(timestamp, count) {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + count;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds());
}

function expiration(body, now, fallback, base = now) {
  const fields = ['validDays', 'validMonths', 'expiresAt', 'permanent'].filter(key => body?.[key] !== undefined);
  if (fields.length > 1) return { valid: false };
  if (!fields.length) return { valid: fallback !== undefined, value: fallback };
  const field = fields[0];
  const value = body[field];
  if (field === 'permanent') return { valid: value === true, value: null };
  if (field === 'expiresAt') return { valid: Number.isSafeInteger(value) && value > now, value };
  if (field === 'validDays') return { valid: validDays(value) !== null, value: base + value * dayMs };
  const valid = Number.isInteger(value) && value >= 1 && value <= 120;
  return { valid, value: valid ? addCalendarMonths(base, value) : null };
}

function json(body, status = 200, publicRequest = true) {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'no-store',
    ...(publicRequest ? { 'Access-Control-Allow-Origin': '*' } : {})
  } });
}

function normalizeCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function codeHash(code) {
  const bytes = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const value = [...bytes].map(byte => alphabet[byte & 31]).join('');
  return `XGW-${value.match(/.{4}/g).join('-')}`;
}

function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > 2048) throw new Error('body_too_large');
  return JSON.parse(text);
}

async function issue(env, body) {
  const buyerEmail = normalizeEmail(body?.buyerEmail);
  const orderRef = typeof body?.orderRef === 'string' ? body.orderRef.trim() : '';
  const now = Date.now();
  const expiry = expiration(body, now, now + defaultValidDays * dayMs);
  if (!validEmail(buyerEmail) || orderRef.length > 80 || !expiry.valid) return json({ error: 'invalid_input' }, 400, false);
  const code = generateCode();
  const hash = await codeHash(code);
  const licenseId = crypto.randomUUID();
  const expiresAt = expiry.value;
  await env.DB.batch([env.DB.prepare('INSERT INTO licenses (code_hash, license_id, buyer_email, order_ref, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(hash, licenseId, buyerEmail, orderRef, now, expiresAt), audit(env, 'issue', licenseId)]);
  return json({ licenseId, code, buyerEmail, expiresAt }, 201, false);
}

async function adminLookup(env, body) {
  const buyerEmail = normalizeEmail(body?.buyerEmail);
  if (!validEmail(buyerEmail)) return json({ error: 'invalid_input' }, 400, false);
  const result = await env.DB.prepare(`SELECT license_id, order_ref, status,
    installation_id IS NOT NULL AS bound, created_at, expires_at, activated_at
    FROM licenses WHERE buyer_email = ? ORDER BY created_at DESC LIMIT 50`).bind(buyerEmail).all();
  return json({ licenses: result.results || [] }, 200, false);
}

async function adminChange(env, body, action) {
  const licenseId = body?.licenseId;
  const buyerEmail = normalizeEmail(body?.buyerEmail);
  if (!installationPattern.test(String(licenseId || '')) || !validEmail(buyerEmail)) {
    return json({ error: 'invalid_input' }, 400, false);
  }
  const row = await env.DB.prepare('SELECT license_id, expires_at FROM licenses WHERE license_id = ? AND buyer_email = ?')
    .bind(licenseId, buyerEmail).first();
  if (!row) return json({ error: 'not_found' }, 404, false);
  if (action === 'reissue') {
    const expiry = expiration(body, Date.now(), row.expires_at);
    if (!expiry.valid) return json({ error: 'invalid_input' }, 400, false);
    const code = generateCode();
    const hash = await codeHash(code);
    const expiresAt = expiry.value;
    await env.DB.batch([env.DB.prepare(`UPDATE licenses SET code_hash = ?, status = 'active',
      installation_id = NULL, activated_at = NULL, checked_at = NULL,
      expires_at = ? WHERE license_id = ?`)
      .bind(hash, expiresAt, licenseId), audit(env, action, licenseId)]);
    return json({ ok: true, licenseId, code, expiresAt }, 200, false);
  }
  if (action === 'renew') {
    const now = Date.now();
    if (row.expires_at === null && (body?.validDays !== undefined || body?.validMonths !== undefined)) {
      return json({ error: 'invalid_input' }, 400, false);
    }
    const expiry = expiration(body, now, undefined, Math.max(now, row.expires_at || 0));
    if (!expiry.valid) return json({ error: 'invalid_input' }, 400, false);
    await env.DB.batch([env.DB.prepare('UPDATE licenses SET expires_at = ? WHERE license_id = ? AND buyer_email = ?')
      .bind(expiry.value, licenseId, buyerEmail), audit(env, action, licenseId)]);
    return json({ ok: true, licenseId, expiresAt: expiry.value }, 200, false);
  }
  const sql = action === 'revoke'
    ? `UPDATE licenses SET status = 'revoked' WHERE license_id = ?`
    : `UPDATE licenses SET status = 'active', installation_id = NULL,
      activated_at = NULL, checked_at = NULL WHERE license_id = ?`;
  await env.DB.batch([env.DB.prepare(sql).bind(licenseId), audit(env, action, licenseId)]);
  return json({ ok: true }, 200, false);
}

async function activate(env, body, verifying) {
  const code = normalizeCode(body?.code);
  const installationId = body?.installationId;
  if (!codePattern.test(code) || !installationPattern.test(String(installationId || ''))) {
    return json({ ok: false, error: 'invalid_input' }, 400);
  }
  const hash = await codeHash(code);
  const now = Date.now();
  if (!verifying) {
    // This UPDATE is atomic: two different installations racing for the same
    // unused code cannot both bind it. No plaintext code is stored in D1.
    await env.DB.prepare(`UPDATE licenses
      SET installation_id = ?, activated_at = COALESCE(activated_at, ?), checked_at = ?
      WHERE code_hash = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)
        AND (installation_id IS NULL OR installation_id = ?)`)
      .bind(installationId, now, now, hash, now, installationId).run();
  }
  const row = await env.DB.prepare('SELECT license_id, status, installation_id, expires_at FROM licenses WHERE code_hash = ?').bind(hash).first();
  if (!row || row.status !== 'active') return json({ ok: false, error: 'invalid_code' }, 403);
  if (row.expires_at !== null && row.expires_at <= now) return json({ ok: false, error: 'expired' }, 403);
  if (row.installation_id !== installationId) return json({ ok: false, error: 'bound_elsewhere' }, 409);
  if (verifying) await env.DB.prepare('UPDATE licenses SET checked_at = ? WHERE code_hash = ?').bind(now, hash).run();
  else await env.DB.prepare('INSERT OR IGNORE INTO paid_activations(license_id,installation_id,first_activated_at) VALUES (?,?,?)').bind(row.license_id,installationId,now).run();
  return json({ ok: true, licenseId: row.license_id, checkedAt: now, expiresAt: row.expires_at });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true });
    if ((url.pathname === '/admin' || url.pathname.startsWith('/admin/')) && ['GET','HEAD'].includes(request.method)) {
      if (!env.ASSETS) return result({ error: 'admin_assets_missing' },503);
      const asset = new URL(request.url);
      asset.pathname = url.pathname === '/admin' || url.pathname === '/admin/' ? '/' : url.pathname.slice(6);
      const response = await env.ASSETS.fetch(new Request(asset, request));
      const headers = new Headers(response.headers);
      headers.set('Cache-Control','no-store');
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      headers.set('X-Content-Type-Options','nosniff');
      headers.set('X-Robots-Tag','noindex, nofollow');
      headers.set('Referrer-Policy','no-referrer');
      return new Response(response.body,{status:response.status,headers});
    }
    const publicRoute = ['/v1/activate', '/v1/verify', ...publicOperations].includes(url.pathname);
    if (publicRoute && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      } });
    }
    if (request.method !== 'POST') return json({ error: 'not_found' }, 404, publicRoute);
    if (!publicRoute && !url.pathname.startsWith('/v1/admin/')) return json({ error: 'not_found' }, 404);
    if (!env.DB) return json({ error: 'server_not_configured' }, 503, publicRoute);
    let body;
    try { body = await readBody(request); }
    catch { return json({ error: 'invalid_body' }, 400, publicRoute); }
    try {
      if (['/v1/admin/login','/v1/admin/logout'].includes(url.pathname)) return await authentication(request,env,body,url.pathname);
      if (!publicRoute) {
        const bearer = sameSecret(request.headers.get('Authorization') || '', `Bearer ${env.ADMIN_TOKEN || ''}`) && !!env.ADMIN_TOKEN;
        if (!bearer) {
          if (request.headers.get('Origin') !== url.origin || request.headers.get('X-Admin-Request') !== '1' || !(await sessionAuthorized(request,env))) return json({error:'unauthorized'},401,false);
        }
        const response = await dashboardRoute(env, body, url.pathname);
        if (response) return response;
      }
      if (publicOperations.includes(url.pathname)) {
        const response = await installationRoute(env,body,url.pathname);
        const headers = new Headers(response.headers);
        headers.set('Access-Control-Allow-Origin','*');
        return new Response(response.body,{status:response.status,headers});
      }
      if (url.pathname === '/v1/activate') return await activate(env, body, false);
      if (url.pathname === '/v1/verify') return await activate(env, body, true);
      if (url.pathname === '/v1/admin/issue') return await issue(env, body);
      if (url.pathname === '/v1/admin/lookup') return await adminLookup(env, body);
      if (url.pathname === '/v1/admin/reset') return await adminChange(env, body, 'reset');
      if (url.pathname === '/v1/admin/reissue') return await adminChange(env, body, 'reissue');
      if (url.pathname === '/v1/admin/renew') return await adminChange(env, body, 'renew');
      if (url.pathname === '/v1/admin/revoke') return await adminChange(env, body, 'revoke');
      return json({ error: 'not_found' }, 404, false);
    } catch (error) {
      console.error('License database failure', error);
      return json({ error: 'server_error' }, 503, publicRoute);
    }
  }
};
