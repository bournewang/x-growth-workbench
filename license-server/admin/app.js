'use strict';
const $ = id => document.getElementById(id);
const titles = { overview:'运营概览',installations:'用户与使用',licenses:'授权管理',orders:'订单记录',audit:'操作日志' };
const errors = { unauthorized:'登录已过期或密码错误，请重新登录。',login_rate_limited:'登录失败次数过多，请 15 分钟后重试。',invalid_input:'请检查输入，期限选项只能选择一种。',order_exists:'该订单号已存在，请勿重复录入。',license_email_mismatch:'授权 ID 与购买邮箱不匹配。',server_error:'服务器暂时无法处理，请稍后重试。',not_found:'没有找到对应记录。',server_not_configured:'后台尚未配置管理密码。' };
let view='overview', offset=0, query='', loading=0, rows=[];
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => value == null ? '—' : new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const short = value => esc(String(value || '').slice(0,8));
const number = value => Number(value || 0).toLocaleString('zh-CN');
async function api(path, body={}) {
  const response=await fetch('/v1/admin/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Request':'1'},body:JSON.stringify(body),cache:'no-store'});
  const data=await response.json();
  if(!response.ok) { if(response.status===401){$('app').hidden=true;$('login').hidden=false;$('modal').close();} throw new Error(errors[data.error] || `操作失败（${response.status}）`); }
  return data;
}
function showApp(){ $('login').hidden=true;$('app').hidden=false;load(); }
$('login-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;$('login-error').textContent='';try{await api('login',{password:$('password').value});$('password').value='';showApp();}catch(e){$('login-error').textContent=e.message;}finally{button.disabled=false;}});
$('logout').onclick=async()=>{await api('logout');$('app').hidden=true;$('login').hidden=false;$('content').replaceChildren();};
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{view=button.dataset.view;offset=0;query='';document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===button));load();});
$('modal').addEventListener('close',()=>{ $('action-form').replaceChildren(); $('modal-error').textContent=''; });
$('refresh').onclick=load;$('range').onchange=load;$('close-modal').onclick=()=>$('modal').close();
function table(headers, data){return `<div class="table-shell"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${data.length?data.join(''):`<tr><td colspan="${headers.length}" class="empty">暂无记录</td></tr>`}</tbody></table></div>`;}
function status(row){if(row.status==='revoked')return '<span class="tag off">已停用</span>';if(row.expires_at!==null&&row.expires_at<=Date.now())return '<span class="tag expired">已到期</span>';return `<span class="tag">${row.installation_id?'已激活':'待激活'}</span>`;}
function toolbar(placeholder,action){return `<div class="toolbar"><form id="search" class="search"><input name="query" aria-label="搜索" placeholder="${placeholder}" value="${esc(query)}"><button class="secondary">搜索</button></form>${action||''}</div>`;}
function pagination(more){return `<div class="pagination"><button class="secondary" id="previous" ${offset===0?'disabled':''}>上一页</button><span>第 ${offset/50+1} 页</span><button class="secondary" id="next" ${more?'':'disabled'}>下一页</button></div>`;}
async function load(){
  const run=++loading;$('view-title').textContent=titles[view];$('range').hidden=view!=='overview';$('notice').textContent='正在读取最新数据…';
  try{
    const data=await api(view,{query,offset,days:Number($('range').value)});if(run!==loading)return;
    rows=data.rows||[];
    if(view==='overview')renderOverview(data);else renderList(data);
    $('notice').textContent='北京时间 · 更新于 '+date(Date.now());
  }catch(e){$('notice').textContent=e.message;}
}
function renderOverview(d){
  const c=d.counts, dist=d.distribution, cv=d.conversion;const max=Math.max(1,...d.trend.flatMap(t=>[t.active,t.newcomers]));
  const metrics=[['今日活跃',c.active,'已上报统计的安装数'],['今日新增',c.newcomers,'首次登记的浏览器安装'],['试用中',c.trials,'服务端试用尚未到期'],['今日付费激活',c.activations,'按安装去重的首次付费绑定']];
  $('content').innerHTML=`<div class="metrics">${metrics.map(m=>`<article class="metric"><span>${m[0]}</span><strong>${number(m[1])}</strong><small>${m[2]}</small></article>`).join('')}</div><div class="panels"><section class="panel"><h2>新增与活跃趋势</h2><p class="muted">每日安装数 · ${esc(d.today)}</p><div class="chart">${d.trend.map(t=>`<div class="chart-day" title="${esc(t.day)} 新增 ${t.newcomers} / 活跃 ${t.active}"><div class="chart-bars"><i data-height="${Math.round(t.newcomers/max*145)}"></i><i data-height="${Math.round(t.active/max*145)}"></i></div><small>${t.day.slice(5)}</small></div>`).join('')}</div><div class="legend"><b>■</b> 新增 <b>■</b> 活跃</div></section><section class="panel"><h2>今日关注操作分布</h2><p class="muted">自动 ${number(dist.automatic)} 次 / 补记 ${number(dist.manual)} 次</p><div class="distribution">${[['0 次','zero'],['1–99 次','low'],['100–349 次','medium'],['350 次及以上','high']].map(([name,key])=>`<div class="dist-row"><span>${name}</span><progress max="${Math.max(1,dist.reporting||0)}" value="${dist[key]||0}"></progress><b>${dist[key]||0}</b></div>`).join('')}</div><small>有上报的安装 ${dist.reporting||0} 个。关注次数不等于涨粉数。</small></section></div><section class="panel"><h2>已结束试用的转化</h2><p>近 30 天开始、且已到期的 ${cv.cohort||0} 个试用安装中，${cv.converted||0} 个已激活付费授权。<strong>${cv.cohort?Math.round(cv.converted/cv.cohort*100)+'%':'—'}</strong></p><small>同批安装口径；新开始但尚未结束的试用不进入分母。</small></section><div class="info">用户按匿名浏览器安装统计，不等于人数。活跃与关注仅包含成功上传统计的安装，未收到数据不能视为零使用。新版插件自动上传匿名汇总。新增来自授权登记，不代表安装当天已经使用全部功能。关注日期按用户本机日期，活跃与新增按北京时间。</div>`;
  document.querySelectorAll('.chart-bars i').forEach(bar => { bar.style.height = bar.dataset.height + 'px'; });
}
function renderList(data){
  let html='';
  if(view==='licenses'){
    html=toolbar('购买邮箱、订单号或授权 ID','<button id="issue">＋ 生成激活码</button>')+table(['买家 / 授权','订单','状态','到期时间','绑定安装','操作'],rows.map((r,i)=>`<tr><td>${esc(r.buyer_email)}<br><span class="identifier">${esc(r.license_id)}</span></td><td>${esc(r.order_ref)||'—'}</td><td>${status(r)}</td><td>${r.expires_at===null?'永久':date(r.expires_at)}</td><td class="identifier">${short(r.installation_id)||'未绑定'}</td><td><div class="actions">${[['renew','续费'],['reset','解绑'],['reissue','补发'],['revoke','停用']].map(([a,n])=>`<button class="secondary" data-action="${a}" data-row="${i}">${n}</button>`).join('')}</div></td></tr>`));
  }else if(view==='installations'){
    html=toolbar('匿名安装 ID')+table(['安装 ID / 版本','首次使用','最近活跃','授权状态','统计','详情'],rows.map((r,i)=>`<tr><td><span class="identifier">${esc(r.installation_id)}</span><br>v${esc(r.version)}</td><td>${date(r.first_seen_at)}</td><td>${date(r.last_seen_at)}</td><td><span class="tag ${!r.paid&&r.trial_expires_at<=Date.now()?'expired':''}">${r.paid?'付费中':!r.trial_expires_at?'未开始试用':r.trial_expires_at>Date.now()?'试用中':'试用结束'}</span><br><small>${r.paid?(r.paid_expires_at===null?'永久':date(r.paid_expires_at)):date(r.trial_expires_at)}</small></td><td>${r.last_seen_at?'已收到统计':r.telemetry_enabled?'待首次上报':'旧版未提供数据'}</td><td><button class="secondary" data-detail="${i}">查看</button></td></tr>`));
  }else if(view==='orders'){
    html=toolbar('订单号或购买邮箱','<button id="order">＋ 录入人工订单</button>')+table(['订单号','买家','套餐','金额','付款时间','授权 ID'],rows.map(r=>`<tr><td>${esc(r.order_id)}</td><td>${esc(r.buyer_email)}</td><td>${r.plan_months} 个月</td><td>¥${(r.amount_cents/100).toFixed(2)}</td><td>${date(r.paid_at)}</td><td class="identifier">${esc(r.license_id)}</td></tr>`));
  }else{html='<p class="muted">最近 100 次管理操作，不包含激活码明文。</p>'+table(['操作','授权 ID','时间'],rows.map(r=>`<tr><td>${esc(({issue:'发码',renew:'续费',reset:'解绑',reissue:'补发',revoke:'停用',order:'录入订单'})[r.action]||r.action)}</td><td class="identifier">${esc(r.license_id)}</td><td>${date(r.created_at)}</td></tr>`));}
  $('content').innerHTML=html+(view!=='audit'?pagination(data.more):'');
  if($('search'))$('search').onsubmit=e=>{e.preventDefault();query=new FormData(e.target).get('query');offset=0;load();};
  if($('previous'))$('previous').onclick=()=>{offset=Math.max(0,offset-50);load();};if($('next'))$('next').onclick=()=>{offset+=50;load();};
  if($('issue'))$('issue').onclick=()=>licenseForm('issue');if($('order'))$('order').onclick=orderForm;
  document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>licenseForm(b.dataset.action,rows[Number(b.dataset.row)]));
  document.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>detail(rows[Number(b.dataset.detail)]));
}
function modal(title,html,onSubmit){$('modal-title').textContent=title;$('action-form').innerHTML=html;$('modal-error').textContent='';$('action-form').onsubmit=async event=>{event.preventDefault();const b=event.submitter;b.disabled=true;$('modal-error').textContent='';try{await onSubmit(new FormData(event.target));}catch(e){$('modal-error').textContent=e.message;}finally{if(b.isConnected)b.disabled=false;}};if(!$('modal').open)$('modal').showModal();}
const terms=`<label>期限类型<select name="term"><option value="1">1 个月 · ¥28</option><option value="3">3 个月 · ¥78</option><option value="6">6 个月 · ¥128</option><option value="12">1 年 · ¥198</option><option value="days">指定天数</option><option value="exact">指定到期时间</option><option value="permanent">永久</option></select></label><div id="custom-term" hidden></div>`;
function bindTerms(){const select=$('action-form').elements.term;if(!select)return;select.onchange=()=>{const box=$('custom-term');box.hidden=!['days','exact'].includes(select.value);box.innerHTML=select.value==='days'?'<label>有效天数<input name="days" type="number" min="1" max="3650" required></label>':select.value==='exact'?'<label>到期时间（北京时间）<input name="exact" type="datetime-local" required></label>':'';};}
function termBody(form){const t=form.get('term');if(t==='permanent')return {permanent:true};if(t==='days')return {validDays:Number(form.get('days'))};if(t==='exact')return {expiresAt:Date.parse(form.get('exact')+':00+08:00')};return {validMonths:Number(t)};}
function licenseForm(action,row){const name={issue:'生成激活码',renew:'续费授权',reset:'解绑浏览器',reissue:'补发新码',revoke:'停用授权'}[action];
  const identity=row?`<p>${esc(row.buyer_email)}</p><p class="identifier">${esc(row.license_id)}</p><p class="muted">当前到期：${row.expires_at===null?'永久':date(row.expires_at)}</p>`:'<label>购买邮箱<input name="email" type="email" required maxlength="254"></label><label>订单号（可选）<input name="order" maxlength="80"></label>';
  const notes={issue:'从发码时开始计时。这里生成授权，不会自动录入付款订单。',renew:'续费保留原码和设备绑定，按月/天从当前到期日与现在较晚者起算。',reset:'确认核对买家身份后再解绑。原码可在新的浏览器重新激活，原设备下次在线验证后失效。',reissue:'新码立即替换旧码，并清除设备绑定；到期时间保持不变。',revoke:'停用后原授权下次在线验证将被拒绝；客户端已有缓存可能延迟生效。'};
  modal(name,identity+(['issue','renew'].includes(action)?terms:'')+`<div class="info">${notes[action]}</div><button class="${action==='revoke'?'danger':''}">确认${name}</button>`,async form=>{
    const body=row?{licenseId:row.license_id,buyerEmail:row.buyer_email}:{buyerEmail:form.get('email'),orderRef:form.get('order')};if(['issue','renew'].includes(action))Object.assign(body,termBody(form));
    const r=await api(action,body);load();
    if(r.code){modal('激活码已生成',`<p class="muted">请立即安全交付。关闭后无法查询明文，补发会使旧码失效。</p><div class="code-result">${esc(r.code)}</div><p class="identifier">授权 ID：${esc(r.licenseId)}</p><p>到期：${r.expiresAt===null?'永久':date(r.expiresAt)}</p><button type="button" id="copy-code">复制激活码</button>`,()=>{});$('copy-code').onclick=async()=>{try{await navigator.clipboard.writeText(r.code);$('copy-code').textContent='已复制';}catch{$('modal-error').textContent='复制失败，请选择上方激活码手动复制。';}};}else $('modal').close();
  });bindTerms();
}
function orderForm(){modal('录入微信人工订单','<div class="form-grid"><label>订单号<input name="orderId" required pattern="[a-zA-Z0-9_-]{1,80}"></label><label>购买邮箱<input name="buyerEmail" type="email" required></label></div><label>授权 ID<input name="licenseId" required></label><label>套餐<select name="planMonths"><option value="1">1 个月</option><option value="3">3 个月</option><option value="6">6 个月</option><option value="12">1 年</option></select></label><div class="form-grid"><label>实收金额（人民币）<input name="amount" type="number" min="0" max="100000" step="0.01" value="28" required></label><label>付款时间（北京时间）<input name="paidAt" type="datetime-local" required></label></div><label>备注<textarea name="note" maxlength="500"></textarea></label><button>确认录入订单</button>',async f=>{await api('order',{orderId:f.get('orderId'),buyerEmail:f.get('buyerEmail'),licenseId:f.get('licenseId'),planMonths:Number(f.get('planMonths')),amountCents:Math.round(Number(f.get('amount'))*100),paidAt:Date.parse(f.get('paidAt')+':00+08:00'),note:f.get('note')});$('modal').close();load();});const f=$('action-form');f.elements.paidAt.value=new Date(Date.now()+8*3600000).toISOString().slice(0,16);f.elements.planMonths.onchange=()=>f.elements.amount.value=({1:28,3:78,6:128,12:198})[f.elements.planMonths.value];}
async function detail(row){try{const d=await api('installation',{installationId:row.installation_id});modal('安装使用历史',`<p class="identifier">${esc(row.installation_id)}</p><p>首次登记：${date(row.first_seen_at)}<br>试用开始：${date(row.trial_started_at)}<br>试用到期：${date(row.trial_expires_at)}</p>${row.telemetry_enabled?'':'<div class="info">尚未收到使用统计，空白不代表零使用。</div>'}<h2>每日关注记录</h2>${table(['本机日期','自动','补记'],d.usage.map(r=>`<tr><td>${esc(r.usage_day)}</td><td>${r.automatic}</td><td>${r.manual}</td></tr>`))}<h2>授权历史</h2>${table(['授权','激活','到期'],d.licenses.map(r=>`<tr><td class="identifier">${esc(r.license_id)}</td><td>${date(r.activated_at)}</td><td>${r.expires_at===null?'永久':date(r.expires_at)}</td></tr>`))}`,()=>{});}catch(e){$('notice').textContent=e.message;}}
api('session').then(showApp).catch(()=>{});
