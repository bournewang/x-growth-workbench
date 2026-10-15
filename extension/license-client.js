(function (root) {
  'use strict';
  const config = root.XPCLicenseConfig;
  const codePattern = /^XGW-(?:[A-HJ-NP-Z2-9]{4}-){4}[A-HJ-NP-Z2-9]{4}$/;
  const refreshAfter = 24 * 60 * 60 * 1000;
  const offlineGrace = 7 * refreshAfter;
  let queue = Promise.resolve();

  function serial(work) {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  }

  async function installationId() {
    const saved = await chrome.storage.local.get('xpcInstallationId');
    if (saved.xpcInstallationId) return saved.xpcInstallationId;
    const id = crypto.randomUUID();
    await chrome.storage.local.set({ xpcInstallationId: id });
    return id;
  }

  async function callServer(path, body) {
    if (!/^https:\/\/[^/]+$/.test(config.apiBaseUrl)) throw new Error('not_configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(config.apiBaseUrl + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok || !result?.ok) {
        const error = new Error(result?.error || 'server_error');
        error.status = response.status;
        throw error;
      }
      return result;
    } finally { clearTimeout(timer); }
  }

  async function trialStatus(startTrial) {
    const now = Date.now();
    const { xpcTrial: saved } = await chrome.storage.local.get('xpcTrial');
    const days = config.trialDays ?? 3;
    if (!saved && !startTrial) return { active: false, reason: 'trial_not_started' };
    const trial = saved || { startedAt: now, expiresAt: now + days * refreshAfter, lastSeenAt: now };
    if (!Number.isFinite(trial.startedAt) || !Number.isFinite(trial.expiresAt)
      || !Number.isFinite(trial.lastSeenAt) || days <= 0
      || trial.expiresAt <= trial.startedAt || trial.expiresAt > trial.startedAt + days * refreshAfter
      || now < trial.startedAt || now < trial.lastSeenAt - 60000) {
      return { active: false, reason: 'trial_expired' };
    }
    await chrome.storage.local.set({ xpcTrial: { ...trial, lastSeenAt: Math.max(now, trial.lastSeenAt) } });
    if (now >= trial.expiresAt) return { active: false, reason: 'trial_expired', expiresAt: trial.expiresAt };
    return { active: true, mode: 'trial', expiresAt: trial.expiresAt };
  }

  async function status(force = false, startTrial = false) {
    if (!config.required) return { active: true, mode: 'development' };
    if (!config.apiBaseUrl) return { active: false, reason: 'not_configured' };
    const { xpcLicense: saved } = await chrome.storage.local.get('xpcLicense');
    if (!saved?.code) return trialStatus(startTrial);
    const now = Date.now();
    const age = now - (saved.checkedAt || 0);
    const expiredLocally = Number.isFinite(saved.expiresAt) && now >= saved.expiresAt;
    if (!force && !saved.rejectedReason && !expiredLocally && age >= 0 && age < refreshAfter) {
      return { active: true, mode: 'online', licenseId: saved.licenseId, expiresAt: saved.expiresAt ?? null };
    }
    try {
      const result = await callServer('/v1/verify', { code: saved.code, installationId: await installationId() });
      await chrome.storage.local.set({ xpcLicense: { ...saved, licenseId: result.licenseId, checkedAt: Date.now(), expiresAt: result.expiresAt ?? null, rejectedReason: null } });
      return { active: true, mode: 'online', licenseId: result.licenseId, expiresAt: result.expiresAt ?? null };
    } catch (error) {
      if (error.status === 403 || error.status === 409) {
        // Preserve denial across cached checks and offline fallback.
        await chrome.storage.local.set({ xpcLicense: { ...saved, rejectedReason: error.message } });
        return { active: false, reason: error.message };
      }
      if (saved.rejectedReason) return { active: false, reason: saved.rejectedReason };
      if (expiredLocally) return { active: false, reason: 'expired' };
      if (age >= 0 && age < offlineGrace) {
        return { active: true, mode: 'offline_grace', licenseId: saved.licenseId, expiresAt: saved.expiresAt ?? null };
      }
      return { active: false, reason: 'server_unavailable' };
    }
  }

  async function activate(value) {
    if (!config.required) return { active: true, mode: 'development' };
    const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!codePattern.test(code)) return { active: false, reason: 'invalid_input' };
    try {
      const result = await callServer('/v1/activate', { code, installationId: await installationId() });
      await chrome.storage.local.set({ xpcLicense: { code, licenseId: result.licenseId, checkedAt: Date.now(), expiresAt: result.expiresAt ?? null, rejectedReason: null } });
      return { active: true, mode: 'online', licenseId: result.licenseId, expiresAt: result.expiresAt ?? null };
    } catch (error) {
      return { active: false, reason: [403, 409].includes(error.status) ? error.message : 'server_unavailable' };
    }
  }

  root.XPCLicenseClient = { status: (force, startTrial) => serial(() => status(force, startTrial)), activate: code => serial(() => activate(code)) };
})(globalThis);
