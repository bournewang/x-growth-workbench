(function (root) {
  'use strict';
  let invalidated = false;
  const message = '扩展已更新，当前页面连接已失效。请刷新 X 页面后继续使用。';
  function showRefreshNotice() {
    const doc = root.document;
    if (!doc || root.top !== root.self) return;
    if (!doc.body) { doc.addEventListener('DOMContentLoaded', showRefreshNotice, {once:true}); return; }
    if (doc.getElementById('xpc-extension-refresh')) return;
    const notice = doc.createElement('div'); notice.id = 'xpc-extension-refresh'; notice.setAttribute('role','alert');
    notice.style.cssText = 'position:fixed;z-index:2147483647;top:12px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 32px);padding:12px 16px;border-radius:12px;background:#1d9bf0;color:white;font:14px/1.5 system-ui,sans-serif;box-shadow:0 4px 20px #0004;display:flex;align-items:center;gap:12px';
    const text = doc.createElement('span'); text.textContent = message;
    const refresh = doc.createElement('button'); refresh.type = 'button'; refresh.textContent = '刷新 X';
    refresh.style.cssText = 'border:0;border-radius:999px;background:white;color:#0f1419;padding:6px 14px;font:700 14px system-ui;white-space:nowrap;cursor:pointer';
    refresh.onclick = () => root.location.reload();
    notice.append(text,refresh); doc.body.append(notice);
  }
  function isContextError(error) { return error?.code === 'XPC_CONTEXT_INVALIDATED' || /extension context invalidated/i.test(error?.message || String(error || '')); }
  function contextError() {
    invalidated = true; showRefreshNotice();
    const error = new Error(message); error.code = 'XPC_CONTEXT_INVALIDATED'; return error;
  }
  function ensureConnected() {
    try { if (invalidated || !root.chrome?.runtime?.id) throw contextError(); }
    catch (error) { if (isContextError(error)) throw error; throw contextError(); }
  }
  function connected() { try { ensureConnected(); return true; } catch { return false; } }
  function request(payload) {
    // Deferring the invocation catches synchronous throws as well as rejections.
    return Promise.resolve().then(() => { ensureConnected(); return root.chrome.runtime.sendMessage(payload); })
      .catch(error => { if (isContextError(error)) throw contextError(); throw error; });
  }
  root.XPCRuntime = { request, connected, ensureConnected, isContextError };
})(globalThis);
