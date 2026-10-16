// Required anonymous daily summaries. No account IDs, handles, publication or follow targets leave the browser.
(function(root) {
  let queue = Promise.resolve();
  function serial(work) { const result = queue.then(work); queue = result.catch(() => {}); return result; }
  async function flush(force = false) {
    if (!XPCLicenseConfig.required || !XPCLicenseConfig.serverTrial) return;
    const saved = await chrome.storage.local.get(['xpcTelemetryLastSent','xpcTelemetryRevision','state']);
    if (!force && Date.now() - (saved.xpcTelemetryLastSent || 0) < 5 * 60000) return;
    const s = saved.state || XPCore.empty();
    const days = [];
    for (let i = 0; i < 3; i++) {
      const date = new Date(); date.setDate(date.getDate() - i);
      const day = XPCore.dayKey(date.getTime());
      let automatic = 0, manual = 0;
      for (const account of Object.keys(s.accounts || {})) {
        const summary = XPCore.followSummary(s, account, date.getTime());
        automatic += summary.automatic; manual += summary.manual;
      }
      days.push({ day, automatic, manual });
    }
    const revision = (saved.xpcTelemetryRevision || 0) + 1;
    await chrome.storage.local.set({ xpcTelemetryRevision: revision });
    try {
      await XPCLicenseClient.register();
      await XPCLicenseClient.report('/v1/install/usage', { days, revision });
      await chrome.storage.local.set({ xpcTelemetryLastSent: Date.now() });
    } catch { /* Reporting failure never blocks counters, sidebar or paid use. */ }
  }
  root.XPCTelemetry = { flush: force => serial(() => flush(force)) };
})(globalThis);
