import { spawnSync } from 'node:child_process';

const [action, ...args] = process.argv.slice(2);
const routes = new Set(['issue', 'lookup', 'reset', 'reissue', 'renew', 'revoke']);
const terms = new Set(['trial', '3m', '6m', 'permanent']);
const values = {};
for (let index = 0; index < args.length; index += 2) {
  if (!args[index]?.startsWith('--') || !args[index + 1]) {
    console.error('用法: node admin.mjs issue|lookup|reset|reissue|renew|revoke --email 购买邮箱 [--order 订单号] [--license 授权ID] [--plan trial|3m|6m|permanent]');
    process.exit(2);
  }
  values[args[index].slice(2)] = args[index + 1];
}
const termKeys = ['plan', 'days', 'months', 'expires-at'].filter(key => values[key] !== undefined);
function parseExpiry(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/.exec(value || '');
  if (!match) return null;
  const [, year, month, day, hour, minute, second, zone] = match;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 14 || Number(zone.slice(4, 6)) > 59)) return null;
  const sign = zone.startsWith('-') ? -1 : 1;
  const offset = zone === 'Z' ? 0 : sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  if (Math.abs(offset) > 14 * 60) return null;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - offset * 60000;
  const check = new Date(timestamp + offset * 60000);
  if (check.getUTCFullYear() !== Number(year) || check.getUTCMonth() + 1 !== Number(month)
    || check.getUTCDate() !== Number(day) || check.getUTCHours() !== Number(hour)
    || check.getUTCMinutes() !== Number(minute) || check.getUTCSeconds() !== Number(second)) return null;
  return timestamp > Date.now() ? timestamp : null;
}
const exactExpiry = values['expires-at'] === undefined ? undefined : parseExpiry(values['expires-at']);
const base = (process.env.LICENSE_API_BASE_URL || 'https://x-growth-license.xiaopei0206.workers.dev').replace(/\/$/, '');
const keychain = process.env.LICENSE_ADMIN_TOKEN ? null : spawnSync('security', [
  'find-generic-password', '-a', 'x-growth-workbench', '-s', 'x-growth-license-admin', '-w'
], { encoding: 'utf8' });
const token = process.env.LICENSE_ADMIN_TOKEN || (keychain?.status === 0 ? keychain.stdout.trim() : '');
if (!routes.has(action) || !base || !/^https:\/\/[^/]+$/.test(base) || !token || !values.email
  || (['reset', 'reissue', 'renew', 'revoke'].includes(action) && !values.license)
  || (termKeys.length > 0 && (!['issue', 'reissue', 'renew'].includes(action) || termKeys.length > 1))
  || (action === 'renew' && termKeys.length !== 1)
  || (values.plan !== undefined && !terms.has(values.plan))
  || (values.days !== undefined && (!/^[1-9]\d*$/.test(values.days) || Number(values.days) > 3650))
  || (values.months !== undefined && (!/^[1-9]\d*$/.test(values.months) || Number(values.months) > 120))
  || (values['expires-at'] !== undefined && exactExpiry === null)
  || Object.keys(values).some(key => !['email', 'order', 'license', 'plan', 'days', 'months', 'expires-at'].includes(key))) {
  console.error('请检查服务地址、管理密钥、邮箱和授权 ID。期限选项只能选一种：--plan trial|3m|6m|permanent、--days、--months、--expires-at（含时区的 ISO 时间）。');
  process.exit(2);
}
const body = { buyerEmail: values.email };
if (action === 'issue' && values.order) body.orderRef = values.order;
if (values.days) body.validDays = Number(values.days);
if (values.months) body.validMonths = Number(values.months);
if (exactExpiry !== undefined) body.expiresAt = exactExpiry;
if (values.plan === 'trial') body.validDays = 3;
if (values.plan === '3m') body.validMonths = 3;
if (values.plan === '6m') body.validMonths = 6;
if (values.plan === 'permanent') body.permanent = true;
if (values.license) body.licenseId = values.license;
try {
  const response = await fetch(`${base}/v1/admin/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body), cache: 'no-store'
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${result.error || '请求失败'}`);
  if (Number.isFinite(result.expiresAt)) result.expiresAtLocal = new Date(result.expiresAt).toLocaleString();
  if (Array.isArray(result.licenses)) result.licenses = result.licenses.map(license => ({
    ...license, expires_at_local: license.expires_at == null ? '无到期日（永久或迁移前旧码）' : new Date(license.expires_at).toLocaleString()
  }));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
