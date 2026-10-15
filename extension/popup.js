const $ = id => document.getElementById(id);
let current;
let accountSignature = '';
let formAccount = '', formDay = '';
let followManualAccount = '', followManualDay = '';
let activationNotice = '';
function loadFollowManual(s) {
  followManualAccount = s.selected;
  followManualDay = XPCore.dayKey(Date.now());
  $('follow-manual').value = XPCore.followManualFor(s, followManualAccount, followManualDay);
  $('follow-manual').disabled = !followManualAccount;
  $('follow-manual-form').querySelector('button').disabled = !followManualAccount;
}
function loadManual(s) {
  formAccount = s.selected; formDay = XPCore.dayKey(Date.now());
  const values = XPCore.manualFor(s, formAccount, formDay);
  for (const k of ['original', 'reply', 'repost']) $('manual-' + k).value = values[k];
  $('manual-fields').disabled = !formAccount;
  const handle = s.accounts[formAccount]?.handle;
  $('manual-context').textContent = formAccount ? `${handle ? '@' + handle : '当前账号'} · 今天未计入的操作` : '首次记录后可补记。';
}
function render(s) {
  current = s;
  const accounts = Object.entries(s.accounts);
  const signature = JSON.stringify(accounts.map(([id, account]) => [id, account.handle]));
  if (signature !== accountSignature) {
    $('account').replaceChildren();
    if (!accounts.length) $('account').add(new Option('尚无记录', ''));
    for (const [id, account] of accounts) $('account').add(new Option(account.handle ? '@' + account.handle : `账号 ${id}`, id));
    accountSignature = signature;
  }
  if ($('account').value !== s.selected) $('account').value = s.selected;
  const days = Number($('period').value);
  $('period-title').textContent = days === 1 ? '今日发布' : `近 ${days} 天发布`;
  const result = XPCore.summary(s, s.selected, days);
  const count = result.combined;
  $('sources').textContent = `自动 ${result.automatic.total} + 补记 ${result.manual.total}`;
  if (formAccount !== s.selected || formDay !== XPCore.dayKey(Date.now())) {
    const changedDay = formDay && formDay !== XPCore.dayKey(Date.now());
    loadManual(s);
    $('manual-feedback').textContent = changedDay ? '日期已变化，已切换到今天的补记值。' : '';
  }
  for (const key of ['total', 'original', 'reply', 'repost']) $(key).textContent = count[key];
  if (followManualAccount !== s.selected || followManualDay !== XPCore.dayKey(Date.now())) loadFollowManual(s);
  const follows = XPCore.followSummary(s, s.selected);
  $('follow-total').textContent = follows.total;
  $('follow-progress').value = Math.min(follows.total, follows.limit);
  $('follow-sources').textContent = `自动 ${follows.automatic} + 补记 ${follows.manual}`;
  $('follow-pending').hidden = !follows.pending;
  $('follow-pending').textContent = `${follows.pending} 次关注请求待批准`;
  $('follow-panel').dataset.level = follows.total >= 400 ? 'limit' : follows.total >= 350 ? 'near' : 'normal';
  $('follow-advice').textContent = follows.total >= 400
    ? '已达到 400 次记录，请暂停关注。'
    : follows.total >= 350 ? '接近 400 次，请放慢关注速度。' : '';
  $('status').textContent = activationNotice || (accounts.length ? '' : '刷新 X 页面后开始记录。');
  $('warning').hidden = !s.warnings;
  $('warning').textContent = `有 ${s.warnings} 次发布接口响应无法识别，可能漏记。最近一次：${s.lastWarningAt ? new Date(s.lastWarningAt).toLocaleString() : '未知'}。`;
}
async function request(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || '读取失败');
    render(response.state);
    return true;
  } catch (error) { $('status').textContent = error.message; return false; }
}
$('account').addEventListener('change', () => request({ type: 'select', accountId: $('account').value }));
$('period').addEventListener('change', () => current && render(current));
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.state?.newValue) render(changes.state.newValue); });
setInterval(() => {
  chrome.storage.local.get('state').then(({ state }) => { if (state) render(state); }).catch(() => {});
}, 2000);
const licenseErrors = {
  invalid_input: '激活码格式不正确。', invalid_code: '激活码无效或已停用。',
  expired: '激活码已到期，请联系售后获取新码。',
  bound_elsewhere: '此激活码已绑定其他浏览器；换机请联系售后。',
  not_configured: '激活服务尚未配置。', server_unavailable: '暂时无法连接激活服务，请稍后重试。'
};
function showLicenseExpiry(expiresAt) {
  const label = $('license-expiry');
  label.hidden = !Number.isFinite(expiresAt);
  if (!label.hidden) label.textContent = `授权有效期至 ${new Date(expiresAt).toLocaleString()}`;
}
async function initializeLicense() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'license:status' });
    if (!result?.active) {
      $('license-feedback').textContent = licenseErrors[result?.reason] || '请输入购买后的激活码。';
      return;
    }
    $('workbench-main').classList.remove('license-locked');
    $('license-panel').hidden = true;
    showLicenseExpiry(result.expiresAt);
    request({ type: 'get' });
  } catch {
    $('license-feedback').textContent = '无法检查激活状态，请重新打开弹窗。';
  }
}
$('license-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('license-form').querySelector('button');
  button.disabled = true;
  $('license-feedback').textContent = '正在激活…';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'license:activate', code: $('license-code').value });
    if (!result?.active) {
      $('license-feedback').textContent = licenseErrors[result?.reason] || '激活失败，请稍后重试。';
      return;
    }
    activationNotice = '激活成功，请刷新已打开的 X 页面。';
    $('workbench-main').classList.remove('license-locked');
    $('license-panel').hidden = true;
    showLicenseExpiry(result.expiresAt);
    request({ type: 'get' });
  } catch { $('license-feedback').textContent = '无法连接激活服务，请稍后重试。'; }
  finally { button.disabled = false; }
});
initializeLicense();

document.querySelector('#manual-panel summary').addEventListener('click', () => { if (!$('manual-panel').open && current) { loadManual(current); $('manual-feedback').textContent = ''; } });
$('manual-form').addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(['original', 'reply', 'repost'].map(k => [k, Number($('manual-' + k).value)]));
  const ok = await request({ type: 'manual', accountId: formAccount, day: formDay, values });
  $('manual-feedback').textContent = ok ? '已保存今日补记。' : '未保存，请检查输入；若已跨日，请重新填写。';
});
$('follow-manual-form').addEventListener('submit', async event => {
  event.preventDefault();
  const value = Number($('follow-manual').value);
  const ok = await request({ type: 'follow-manual', accountId: followManualAccount, day: followManualDay, value });
  $('follow-manual-feedback').textContent = ok ? '已保存今天的关注补记。' : '未保存，请检查账号、日期和整数。';
});
