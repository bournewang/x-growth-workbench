(() => {
  const channel = 'x-posts-count-v1';
  function showFollowWarning({ total, threshold }) {
    if (!threshold || window !== window.top) return;
    const zh = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('zh');
    let notice = document.getElementById('xpc-follow-warning');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'xpc-follow-warning';
      notice.setAttribute('role', 'alert');
      notice.style.cssText = 'position:fixed;z-index:2147483646;top:20px;left:50%;transform:translateX(-50%);max-width:min(680px,calc(100vw - 24px));padding:12px 20px;border-radius:6px;background:#1d9bf0;color:white;font:700 15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 4px 18px #0004;pointer-events:none;text-align:center';
      document.body.appendChild(notice);
    }
    notice.textContent = zh
      ? `今日已记录 ${total} 次关注操作（含补记），${threshold >= 400 ? '已到 400，请暂停关注。' : '正在接近 400；X 也可能更早限制关注。'}`
      : `${total} follow actions recorded today (including manual entries). ${threshold >= 400 ? 'You have reached 400; pause following.' : 'You are approaching 400; X may impose limits sooner.'}`;
    clearTimeout(showFollowWarning.timer);
    showFollowWarning.timer = setTimeout(() => notice.remove(), 10000);
  }
  const ready = () => window.postMessage({ channel, ready: true }, location.origin);
  window.addEventListener('message', e => {
    if (e.source !== window || e.origin !== location.origin || e.data?.channel !== channel) return;
    if (e.data.hello) { ready(); return; }
    const p = e.data.payload;
    if (!p || !['publication', 'unrecognized', 'follow'].includes(p.type)) return;
    try {
      chrome.runtime.sendMessage(p).then(response => {
        if (p.type === 'follow' && response?.notice) showFollowWarning(response.notice);
      }).catch(() => {});
    } catch { /* Extension was reloaded; refresh X. */ }
  });
  ready();
})();
