importScripts('sidex-background.js');
// Publication counter remains independent of the in-page comment reader.
importScripts('core.js');
importScripts('license-config.js', 'license-client.js');
const core = XPCore;
// All read/modify/write operations are serialized across tabs and popup requests.
let queue = Promise.resolve();
// The reader's success callback and the network observer can report the same request.
// Keep the target only in memory long enough to collapse those two reports.
const recentFollowTargets = new Map();
function serial(work) {
  const result = queue.then(work);
  queue = result.catch(() => {});
  return result;
}
async function state() {
  const saved = (await chrome.storage.local.get('state')).state;
  if (saved) return saved;
  const initial = core.empty();
  await chrome.storage.local.set({ state: initial });
  return initial;
}
async function badge(s) {
  if (XPCLicenseConfig.required && !(await XPCLicenseClient.status()).active) {
    await chrome.action.setBadgeText({ text: '锁' });
    await chrome.action.setBadgeBackgroundColor({ color: '#657482' });
    await chrome.action.setTitle({ title: 'X涨粉工作台 · 点击输入激活码' });
    return;
  }
  const { automatic, manual, combined } = core.summary(s, s.selected);
  const total = combined.total;
  await chrome.action.setBadgeText({ text: s.selected ? String(total) : '—' });
  await chrome.action.setBadgeBackgroundColor({ color: '#14694D' });
  const name = s.accounts[s.selected]?.handle;
  const follows = core.followSummary(s, s.selected);
  await chrome.action.setTitle({ title: `X涨粉工作台${name ? ' · @' + name : ''} · 今日发布 ${total}（自动 ${automatic.total} + 补记 ${manual.total}） · 今日关注 ${follows.total}/${follows.limit}` });
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (typeof message?.type === 'string' && message.type.startsWith('sidebar:')) return;
  const page = sender.id === chrome.runtime.id && sender.tab && core.supportedPage(sender.url || '');
  const popup = sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup.html');
  if (!page && !popup) return;
  if (message.type === 'license:status' || message.type === 'license:activate') {
    if (message.type === 'license:activate' && !popup) return;
    const task = message.type === 'license:status'
      ? XPCLicenseClient.status(message.force === true && popup)
      : XPCLicenseClient.activate(message.code);
    task.then(result => {
      reply(result);
      if (message.type === 'license:activate' && result.active) {
        serial(async () => badge(await state())).catch(() => {});
      }
    }, () => reply({ active: false, reason: 'server_unavailable' }));
    return true;
  }
  serial(async () => {
    if (XPCLicenseConfig.required && !(await XPCLicenseClient.status()).active) {
      return { ok: false, error: '请先激活 X涨粉工作台。' };
    }
    const s = await state();
    let notice = null;
    if (page && message.type === 'publication') {
      core.add(s, message.event);
      await chrome.storage.local.set({ state: s });
    } else if (page && message.type === 'unrecognized') {
      s.warnings++; s.lastWarningAt = Date.now();
      await chrome.storage.local.set({ state: s });
    } else if (page && message.type === 'follow') {
      const target = message.target;
      const accountId = message.event?.accountId;
      const source = message.source;
      if (!['observer', 'sidex'].includes(source)
        || !/^\d{1,25}$|^@[a-z0-9_]{1,15}$/i.test(String(target || ''))
        || !core.validFollowEvent(message.event)) return { ok: false };
      const key = `${accountId}:${String(target).toLowerCase()}`;
      const now = Date.now();
      for (const [previousKey, previous] of recentFollowTargets) {
        if (previous.at < now - 10000) recentFollowTargets.delete(previousKey);
      }
      const previous = recentFollowTargets.get(key);
      if (previous && previous.source !== source) {
        recentFollowTargets.delete(key);
        return { ok: true };
      }
      const before = core.followSummary(s, message.event?.accountId).total;
      if (!core.addFollow(s, message.event)) return { ok: false };
      recentFollowTargets.set(key, { source, at: now });
      const after = core.followSummary(s, message.event.accountId).total;
      const threshold = core.followThresholdCrossed(before, after);
      if (threshold) notice = { total: after, threshold };
      await chrome.storage.local.set({ state: s });
    } else if (popup && message.type === 'manual') {
      if (!core.setManual(s, message.accountId, message.day, message.values)) return { ok: false, error: '补记未保存：请确认账号、今日日期和 0–100000 的整数。跨日后请重新填写。' };
      await chrome.storage.local.set({ state: s });
    } else if (popup && message.type === 'follow-manual') {
      if (!core.setFollowManual(s, message.accountId, message.day, message.value)) return { ok: false, error: '关注补记未保存：请确认账号、今日日期和非负整数。' };
      await chrome.storage.local.set({ state: s });
    } else if (popup && message.type === 'select' && s.accounts[message.accountId]) {
      s.selected = message.accountId;
      await chrome.storage.local.set({ state: s });
    } else if (!(popup && message.type === 'get')) return { ok: false };
    await badge(s);
    return popup ? { ok: true, state: s } : { ok: true, notice };
  }).then(reply, () => reply({ ok: false, error: '无法保存计数，请检查扩展错误及本地存储空间。' }));
  return true;
});
async function refresh() {
  await chrome.alarms.create('refresh-day', { periodInMinutes: 1 });
  await serial(async () => badge(await state()));
}
chrome.runtime.onInstalled.addListener(refresh);
chrome.runtime.onStartup.addListener(refresh);
chrome.alarms.onAlarm.addListener(() => serial(async () => badge(await state())));
