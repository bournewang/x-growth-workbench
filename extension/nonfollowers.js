(function (root) {
  'use strict';
  const validHandle = value => /^[A-Za-z0-9_]{1,15}$/.test(value || '');
  function extractUsers(body) {
    const instructions = body?.data?.user?.result?.timeline?.timeline?.instructions ?? body?.data?.user?.result?.timeline?.instructions ?? [];
    const users = [];
    for (const instruction of instructions) {
      for (const entry of instruction.entries || (instruction.entry ? [instruction.entry] : [])) {
        if (!/^user-/.test(entry.entryId || '')) continue;
        let user = entry.content?.itemContent?.user_results?.result;
        if (user?.user) user = user.user;
        if (!user || user.__typename !== 'User' || !/^\d+$/.test(user.rest_id || '')) continue;
        const legacy = user.legacy || {}, core = user.core || {}, rel = user.relationship_perspectives || {};
        const handle = core.screen_name ?? legacy.screen_name;
        if (!validHandle(handle) || (rel.following ?? legacy.following) === false) continue;
        const followedBy = rel.followed_by ?? legacy.followed_by;
        users.push({ id: user.rest_id, handle, name: core.name ?? legacy.name ?? handle,
          followedBy: typeof followedBy === 'boolean' ? followedBy : null });
      }
    }
    return users;
  }
  function merge(records, users, now) {
    const result = { ...records };
    for (const user of users) {
      if (!/^\d+$/.test(user.id) || !validHandle(user.handle)) continue;
      const old = result[user.id];
      // Unknown relationships must never erase a confirmed state or count as a check.
      if (typeof user.followedBy !== 'boolean') continue;
      if (!old && user.followedBy) continue;
      result[user.id] = { ...old, id: user.id, handle: user.handle, name: user.name,
        firstSeenAt: old?.firstSeenAt || now, lastCheckedAt: now,
        followedBy: user.followedBy,
        returnedAt: user.followedBy ? (old?.followedBy === true ? old.returnedAt : now) : null };
    }
    return result;
  }
  function status(record, checked) {
    if (!checked.has(record.id)) return 'pending';
    return record.followedBy ? 'returned' : 'non';
  }
  function reminderLabel(timestamp, now = Date.now()) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
    const elapsed = Math.max(0, now - timestamp);
    const minutes = Math.floor(elapsed / 60000);
    const hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
    const age = minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes}分钟前` : hours < 24 ? `${hours}小时前` : days < 30 ? `${days}天前` : days < 365 ? `${Math.floor(days / 30)}个月前` : `${Math.floor(days / 365)}年前`;
    return `已提醒-${age}`;
  }
  // Only direct profile timeline items are posts. Recursive collection can also
  // discover quoted tweets, recommendation payloads, and cursor metadata.
  function parseProfileTimeline(payload, userId, core) {
    const result = payload?.data?.user?.result;
    const instructions = result?.timeline_v2?.timeline?.instructions ?? result?.timeline?.timeline?.instructions ?? result?.timeline?.instructions;
    if (!Array.isArray(instructions)) return null;
    const posts = [], seen = new Set(); let cursor = null;
    function addItem(content, entryId, pinned) {
      if (content?.promotedMetadata || content?.itemContent?.promotedMetadata) return;
      let raw = content?.itemContent?.tweet_results?.result;
      for (let step = 0; raw && step < 6 && !raw.rest_id; step++) raw = raw.tweet || raw.result;
      if (!raw?.rest_id || !/^tweet-\d+$/.test(entryId || '')) return;
      if (String(raw.rest_id) !== entryId.slice(6)) return;
      // A repost's outer author/date refer to the reposter, not a new original post.
      if (raw.retweeted_status_result || raw.legacy?.retweeted_status_result || raw.legacy?.retweeted_status) return;
      const post = core.tweetModel(raw);
      if (!post?.id || post.author.id !== userId || seen.has(post.id)) return;
      seen.add(post.id);
      posts.push({ ...post, pinned: pinned || content.itemContent?.socialContext?.contextType === 'Pin' });
    }
    for (const instruction of instructions) {
      const entries = instruction.entries || (instruction.entry ? [instruction.entry] : []);
      for (const entry of entries) {
        const content = entry.content;
        if (content?.cursorType === 'Bottom' && typeof content.value === 'string') { cursor = content.value; continue; }
        if (/^profile-conversation-/.test(entry.entryId || '')) {
          for (const item of content?.items || []) {
            const id = (item.entryId || item.item?.entryId || '').match(/(?:^|-)tweet-(\d+)$/)?.[1];
            if (id) addItem(item.item || item, 'tweet-' + id, false);
          }
        } else addItem(content, entry.entryId, instruction.type === 'TimelinePinEntry');
      }
    }
    return { posts, cursor };
  }
  function postDate(value, locale = 'zh-CN') {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return { label: '日期未知', exact: '', iso: '' };
    return { label: date.toLocaleDateString(locale, {year:'numeric',month:'2-digit',day:'2-digit'}), exact: date.toLocaleString(locale), iso: date.toISOString() };
  }
  function init({ hasAccess, refreshAccess, requestPage, closeTweet }) {
    let owner = '', accountHandle = '', records = {}, checked = new Set(), observed = new Map();
    let filter = 'all', selected = null, enabled = false, scheduled = false, switching = false;
    let storageQueue = Promise.resolve(), generation = 0, sending = false, replyPost = null, replyFocus = null;
    const toolbar = document.createElement('section');
    toolbar.id = 'xpc-following-tools';
    toolbar.innerHTML = `<div class="xpc-nf-heading"><strong>回关筛选</strong><select aria-label="回关筛选"><option value="all">全部</option><option value="non">未回关</option><option value="returned">新增回关</option><option value="pending">待复查</option></select></div><p role="status"></p>`;
    const profile = document.createElement('aside');
    profile.id = 'xpc-nf-profile'; profile.hidden = true; profile.setAttribute('aria-label', '用户主页');
    const dialog = document.createElement('div'); dialog.id = 'xpc-nf-reply'; dialog.hidden = true;
    document.body.append(profile, dialog);
    function persist() {
      const key = `xpc:nonfollowers:${owner}`, value = structuredClone(records);
      storageQueue = storageQueue.catch(() => {}).then(() => chrome.storage.local.set({ [key]: value }));
      storageQueue.catch(() => { toolbar.querySelector('p').textContent = '记录保存失败，请检查浏览器存储空间。'; });
    }
    function account() {
      const cookie = decodeURIComponent(document.cookie.match(/(?:^|;\s*)twid=([^;]+)/)?.[1] || '').replace(/^u=/, '');
      const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
      const handle = link?.getAttribute('href')?.split('/')[1] || '';
      return /^\d+$/.test(cookie) && validHandle(handle) ? { id: cookie, handle } : null;
    }
    function isFollowingPage() {
      return accountHandle && location.pathname.toLowerCase() === `/${accountHandle.toLowerCase()}/following`;
    }
    function draw() {
      const counts = { non: 0, returned: 0, pending: 0 };
      for (const record of Object.values(records)) counts[status(record, checked)]++;
      const reminded = Object.values(records).filter(record => Number.isFinite(record.remindedAt) && record.remindedAt > 0).length;
      const text = `本次已加载 ${observed.size} 人 · 未回关 ${counts.non} · 新增回关 ${counts.returned} · 待复查 ${counts.pending} · 累计已提醒 ${reminded} 人。筛选仅作用于原列表，继续滚动加载；未加载的历史账号仍待复查。`;
      if (toolbar.querySelector('p').textContent !== text) toolbar.querySelector('p').textContent = text;
      applyFilter();
    }
    function rowHandle(cell) {
      return [...cell.querySelectorAll('a[href]')].map(link => {
        try { const u = new URL(link.href); return u.origin === location.origin && /^\/[A-Za-z0-9_]{1,15}$/.test(u.pathname) ? u.pathname.slice(1) : null; } catch { return null; }
      }).find(Boolean);
    }
    function applyFilter() {
      const byHandle = new Map(Object.values(records).map(item => [item.handle.toLowerCase(), item]));
      const currentByHandle = new Map([...observed.values()].map(item => [item.handle.toLowerCase(), item]));
      document.querySelectorAll('[data-testid="primaryColumn"] [data-testid="UserCell"]').forEach(cell => {
        const handle = rowHandle(cell)?.toLowerCase();
        const record = byHandle.get(handle), currentUser = currentByHandle.get(handle);
        const match = filter === 'all' || (record && status(record, checked) === filter);
        cell.classList.toggle('xpc-nf-hidden', Boolean(enabled && isFollowingPage() && !match));
        cell.classList.toggle('xpc-nf-clickable', enabled);
        const isNon = currentUser?.followedBy === false || (checked.has(record?.id) && record?.followedBy === false);
        const reminderText = reminderLabel(record?.remindedAt);
        let labels = cell.querySelector('.xpc-nf-row-labels');
        if (!isNon && !reminderText) { labels?.parentElement?.classList.remove('xpc-nf-status-line'); labels?.remove(); return; }
        const nativeIndicator = cell.querySelector('[data-testid="userFollowIndicator"]');
        const profileLinks = [...cell.querySelectorAll('a[href]')].filter(link => {
          try { return new URL(link.href).pathname.toLowerCase() === `/${handle}`; } catch { return false; }
        });
        const handleLink = profileLinks.find(link => link.textContent.trim().startsWith('@')) || profileLinks.find(link => link.textContent.trim());
        const anchor = nativeIndicator || handleLink;
        if (!labels) labels = element('span', '', 'xpc-nf-row-labels');
        if (anchor && labels.previousElementSibling !== anchor) {
          labels.parentElement?.classList.remove('xpc-nf-status-line');
          anchor.insertAdjacentElement('afterend', labels);
        } else if (!anchor && !labels.isConnected) cell.append(labels);
        // X often gives identity containers flex-direction:column. Make only the
        // narrow identity/status container horizontal, never the complete UserCell.
        const line = labels.parentElement;
        if (line && line !== cell && !line.querySelector('button, [role="button"], [data-testid="UserAvatar-Container"]')) {
          line.classList.add('xpc-nf-status-line');
        }
        const sync = (className, text) => {
          let badge = labels.querySelector('.' + className);
          if (!text) { badge?.remove(); return; }
          if (!badge) { badge = element('span', '', className); labels.append(badge); }
          if (badge.textContent !== text) badge.textContent = text;
          if (className === 'xpc-nf-reminded-badge') badge.title = `最近提醒：${new Date(record.remindedAt).toLocaleString()}`;
        };
        sync('xpc-nf-non-badge', isNon ? '未回关' : '');
        sync('xpc-nf-reminded-badge', reminderText);
      });
    }
    function element(tag, text = '', className = '') {
      const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
    }
    function safeUrl(value) {
      try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch { return ''; }
    }
    function image(value, alt, className) {
      const node = document.createElement('img'); node.src = safeUrl(value); node.alt = alt; node.className = className;
      node.loading = 'lazy'; node.onerror = () => { node.hidden = true; }; return node;
    }
    function button(text, label, className = '') {
      const node = element('button', text, className); node.type = 'button'; node.setAttribute('aria-label', label); return node;
    }
    function count(value) { return new Intl.NumberFormat(document.documentElement.lang || 'zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0); }
    function replyIcon() {
      const span = element('span', '', 'xpc-nf-icon');
      span.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.5a8 8 0 0 1-8 8H9l-5 3v-6a8 8 0 0 1-1.5-5v-1a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
      return span;
    }
    function closeReply() { if (sending) return; dialog.hidden = true; dialog.replaceChildren(); replyPost = null; if (replyFocus?.isConnected) replyFocus.focus(); replyFocus = null; }
    function closeProfile() {
      generation++; selected = null; profile.hidden = true;
      if (!sending) closeReply();
    }
    function refreshReminder() {
      const record = selected && records[selected.id];
      const node = profile.querySelector('.xpc-nf-reminder');
      if (node) {
        const label = reminderLabel(record?.remindedAt) || '未提醒';
        if (node.textContent !== label) node.textContent = label;
        node.title = record?.remindedAt ? `最近提醒：${new Date(record.remindedAt).toLocaleString()}` : '通过此主页成功留言后自动记录';
      }
    }
    function openReply(post, user) {
      if (!hasAccess() || !selected || sending) return;
      const dialogOwner = owner; replyFocus = document.activeElement;
      replyPost = post; dialog.hidden = false; dialog.replaceChildren();
      const card = element('section', '', 'xpc-nf-reply-card');
      card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', `回复 @${user.handle}`);
      const close = button('×', '关闭回复', 'xpc-nf-icon-button'); close.onclick = closeReply;
      const context = element('div', '', 'xpc-nf-reply-context');
      context.append(image(user.avatar, '', 'xpc-nf-tweet-avatar'));
      const summary = element('div'); summary.append(element('strong', user.name), element('span', ` @${user.handle}`, 'xpc-nf-muted'), element('p', post.text));
      context.append(summary);
      const label = element('label', `回复 @${user.handle}`, 'xpc-nf-reply-label'); label.htmlFor = 'xpc-nf-reply-text';
      const textarea = document.createElement('textarea'); textarea.id = 'xpc-nf-reply-text'; textarea.placeholder = '发布你的回复'; textarea.rows = 5;
      const error = element('p', '', 'xpc-nf-reply-error'); error.setAttribute('role', 'status');
      const footer = element('div', '', 'xpc-nf-reply-footer');
      const counter = element('span', '0 / 280', 'xpc-nf-muted');
      const submit = button('回复', '发送回复', 'xpc-nf-primary'); submit.disabled = true;
      const update = () => {
        const length = [...textarea.value].reduce((total, char) => total + (char.codePointAt(0) > 127 ? 2 : 1), 0);
        counter.textContent = `${length} / 280`; submit.disabled = sending || !textarea.value.trim() || length > 280;
      };
      textarea.oninput = update;
      submit.onclick = async () => {
        if (sending || !replyPost || submit.disabled || !hasAccess()) return;
        if (account()?.id !== dialogOwner || owner !== dialogOwner) { error.textContent = '登录账号已切换，请关闭对话框后重新打开。'; return; }
        const targetOwner = dialogOwner, targetUser = { ...user }, targetPost = replyPost;
        sending = true; submit.disabled = true; close.disabled = true; textarea.disabled = true; submit.textContent = '发送中…'; error.textContent = '';
        try {
          const payload = await requestPage('CREATE_REPLY', { tweetId: targetPost.id, text: textarea.value.trim(), mediaIds: [], expectedAccountId: dialogOwner });
          const created = root.SidePeekCore.collectTweetModels(payload).find(item => item.id && item.id !== targetPost.id && (!item.inReplyToId || item.inReplyToId === targetPost.id));
          if (!created) throw new Error('未能确认留言结果，请先检查帖子，避免重复发送。');
          if (owner === targetOwner) {
            const now = Date.now();
            records[targetUser.id] = { ...records[targetUser.id], id: targetUser.id, handle: targetUser.handle, name: targetUser.name,
              firstSeenAt: records[targetUser.id]?.firstSeenAt || now,
              lastCheckedAt: records[targetUser.id]?.lastCheckedAt || now,
              followedBy: records[targetUser.id]?.followedBy ?? targetUser.followedBy ?? null,
              remindedAt: now, reminderPostId: targetPost.id, reminderReplyId: created.id };
            persist(); refreshReminder(); draw();
          }
          sending = false; closeReply();
          const notice = profile.querySelector('.xpc-nf-notice');
          if (notice) notice.textContent = '回复已发布，已自动标记为已提醒。';
        } catch (cause) {
          error.textContent = cause.message || '发送失败，请稍后重试。';
        } finally {
          sending = false; close.disabled = false; textarea.disabled = false; submit.textContent = '回复'; update();
        }
      };
      textarea.onkeydown = event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); submit.click(); } };
      footer.append(counter, submit); card.append(close, context, label, textarea, error, footer); dialog.append(card); textarea.focus();
    }
    dialog.addEventListener('click', event => { if (event.target === dialog) closeReply(); });
    document.addEventListener('keydown', event => {
      if (!dialog.hidden && event.key === 'Tab') {
        const focusable = [...dialog.querySelectorAll('button:not(:disabled), textarea:not(:disabled)')];
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      if (!dialog.hidden && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeReply(); }
    }, true);
    async function showProfile(record) {
      if (!await refreshAccess() || !enabled || sending) return;
      closeTweet(); closeProfile(); selected = record; const current = ++generation;
      profile.hidden = false; profile.replaceChildren();
      // Match the current X theme rather than the operating system theme.
      const nativeColumn = document.querySelector('[data-testid="primaryColumn"]');
      const nativeStyle = getComputedStyle(nativeColumn || document.body);
      const bodyStyle = getComputedStyle(document.body);
      profile.style.setProperty('--nf-bg', nativeStyle.backgroundColor === 'rgba(0, 0, 0, 0)' ? bodyStyle.backgroundColor : nativeStyle.backgroundColor);
      profile.style.setProperty('--nf-fg', nativeStyle.color);
      dialog.style.setProperty('--nf-bg', profile.style.getPropertyValue('--nf-bg')); dialog.style.setProperty('--nf-fg', nativeStyle.color);
      const header = element('header', '', 'xpc-nf-profile-header');
      const close = button('←', '关闭主页', 'xpc-nf-icon-button'); close.onclick = closeProfile;
      const heading = element('strong', record.name || record.handle);
      header.append(close, heading); profile.append(header);
      const content = element('div', '正在加载用户主页…', 'xpc-nf-profile-content'); profile.append(content);
      try {
        const raw = await requestPage('FETCH_USER_PROFILE', { screenName: record.handle });
        if (generation !== current || !hasAccess()) return;
        const user = root.SidePeekCore.userModel(raw);
        if (!user || user.id !== record.id) throw new Error('账号信息已变化，请返回列表重新扫描。');
        heading.textContent = user.name;
        if (typeof user.followedBy === 'boolean') {
          records = merge(records, [{ ...user, followedBy: user.followedBy }], Date.now()); checked.add(user.id); persist(); draw();
        }
        content.replaceChildren();
        const banner = element('div', '', 'xpc-nf-banner');
        if (safeUrl(user.banner)) banner.append(image(user.banner, '个人资料封面', 'xpc-nf-banner-image'));
        const summary = element('div', '', 'xpc-nf-summary');
        const hero = element('div', '', 'xpc-nf-hero');
        hero.append(image(user.avatar, user.name, 'xpc-nf-profile-avatar'));
        const actions = element('div', '', 'xpc-nf-profile-actions');
        const reminder = element('span', '', 'xpc-nf-reminder');
        const original = element('a', '查看原主页', 'xpc-nf-original-link'); original.href = `https://x.com/${user.handle}`; original.target = '_blank'; original.rel = 'noopener noreferrer';
        actions.append(reminder, original); hero.append(actions);
        const name = element('h2', user.name, 'xpc-nf-profile-name');
        if (user.verified) name.append(element('span', '✓', 'xpc-nf-verified'));
        summary.append(hero, name, element('div', `@${user.handle}`, 'xpc-nf-muted'), element('p', user.bio, 'xpc-nf-bio'));
        const meta = element('div', '', 'xpc-nf-meta');
        if (user.location) meta.append(element('span', `⌖ ${user.location}`));
        if (safeUrl(user.url)) { const link = element('a', new URL(user.url).hostname); link.href = safeUrl(user.url); link.target = '_blank'; link.rel = 'noopener noreferrer'; meta.append(link); }
        if (raw.legacy?.created_at) meta.append(element('span', `${new Date(raw.legacy.created_at).toLocaleDateString()} 加入`));
        const stats = element('div', '', 'xpc-nf-stats');
        for (const [value, label] of [[user.followingCount, '正在关注'], [user.followersCount, '关注者']]) {
          const stat = element('span'); stat.append(element('strong', value == null ? '—' : count(value)), document.createTextNode(' ' + label)); stats.append(stat);
        }
        const notice = element('p', '', 'xpc-nf-notice'); notice.setAttribute('role', 'status');
        summary.append(meta, stats, notice);
        const tabs = element('div', '', 'xpc-nf-tabs'); tabs.append(element('span', '帖子', 'xpc-nf-active-tab'));
        const posts = element('div', '', 'xpc-nf-posts');
        content.append(banner, summary, tabs, posts); refreshReminder();
        let cursor = null, loading = false; const seen = new Set();
        const more = button('加载更多帖子', '加载更多帖子', 'xpc-nf-load-more');
        const status = element('p', '', 'xpc-nf-post-status'); content.append(status, more);
        function renderPost(post) {
          const article = element('article', '', 'xpc-nf-post');
          article.dataset.postId = post.id;
          if (post.pinned) article.append(element('small', '置顶', 'xpc-nf-pinned'));
          article.append(image(user.avatar, '', 'xpc-nf-tweet-avatar'));
          const body = element('div', '', 'xpc-nf-post-body');
          const author = element('div', '', 'xpc-nf-post-author');
          author.append(element('strong', user.name));
          if (user.verified) author.append(element('span', '✓', 'xpc-nf-verified'));
          author.append(element('span', `@${user.handle}`, 'xpc-nf-muted'));
          const date = postDate(post.createdAt);
          const source = element('a', '', 'xpc-nf-post-source'); source.href = post.url; source.target = '_blank'; source.rel = 'noopener noreferrer';
          source.setAttribute('aria-label', `查看原帖，发布于 ${date.exact || date.label}`);
          const time = element('time', '· ' + date.label, 'xpc-nf-muted');
          if (date.iso) time.dateTime = date.iso;
          time.title = date.exact || date.label; source.append(time); author.append(source);
          body.append(author, element('p', post.text, 'xpc-nf-post-text'));
          if (post.media.length) {
            const media = element('div', '', 'xpc-nf-media'); media.dataset.count = String(post.media.length);
            for (const item of post.media) {
              if (item.type !== 'photo' && safeUrl(item.videoUrl)) {
                const video = document.createElement('video'); video.controls = true; video.preload = 'none'; video.src = safeUrl(item.videoUrl); video.poster = safeUrl(item.url); media.append(video);
              } else media.append(image(item.url, '帖子图片', 'xpc-nf-post-image'));
            }
            body.append(media);
          }
          if (post.quote) {
            const quote = element('blockquote', '', 'xpc-nf-quote'); quote.append(element('strong', `${post.quote.author.name} @${post.quote.author.handle}`), element('p', post.quote.text)); body.append(quote);
          }
          const footer = element('div', '', 'xpc-nf-post-actions');
          const reply = button('', `回复 @${user.handle} 的帖子`, 'xpc-nf-reply-button'); reply.append(replyIcon(), element('span', count(post.counts.replies))); reply.onclick = () => openReply(post, user);
          const reposts = element('span', `↻ ${count(post.counts.reposts)}`); reposts.title = '转帖数';
          const likes = element('span', `♡ ${count(post.counts.likes)}`); likes.title = '喜欢数';
          const views = element('span', `▥ ${count(post.counts.views)}`); views.title = '浏览次数';
          footer.append(reply, reposts, likes, views); body.append(footer); article.append(body); posts.append(article);
        }
        async function loadPosts() {
          if (loading || generation !== current) return;
          loading = true; more.disabled = true; status.textContent = '正在加载帖子…';
          try {
            const payload = await requestPage('FETCH_USER_POSTS', { userId: user.id, cursor });
            if (generation !== current || !hasAccess()) return;
            const page = parseProfileTimeline(payload, user.id, root.SidePeekCore);
            if (!page) throw new Error('暂时无法读取帖子，请重试。');
            for (const post of page.posts) {
              if (!seen.has(post.id)) { seen.add(post.id); renderPost(post); }
            }
            const next = page.cursor; more.hidden = !next || next === cursor; cursor = next;
            status.textContent = seen.size ? '' : '暂无可查看的帖子，或该用户的帖子不可见。'; more.textContent = '加载更多帖子';
          } catch (cause) { if (generation === current) { status.textContent = cause.message || '帖子加载失败'; more.hidden = false; more.textContent = '重试加载帖子'; } }
          finally { loading = false; more.disabled = false; }
        }
        more.onclick = loadPosts; await loadPosts();
      } catch (cause) {
        if (generation !== current) return;
        content.textContent = cause.message || '主页加载失败';
        const retry = button('重试', '重试加载主页', 'xpc-nf-load-more'); retry.onclick = () => showProfile(record).catch(() => {}); content.append(retry);
      }
    }
    toolbar.querySelector('select').onchange = event => { filter = event.target.value; applyFilter(); };
    document.addEventListener('click', event => {
      if (!enabled || !hasAccess() || !isFollowingPage() || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const cell = event.target.closest?.('[data-testid="primaryColumn"] [data-testid="UserCell"]');
      if (!cell) return;
      const control = event.target.closest?.('button, [role="button"], input, textarea, select, [contenteditable="true"], [role="menuitem"]');
      if (control && control !== cell && cell.contains(control)) return;
      const selection = window.getSelection();
      if (selection?.toString() && cell.contains(selection.anchorNode)) return;
      const handle = rowHandle(cell)?.toLowerCase();
      const anchor = event.target.closest?.('a[href]');
      if (anchor) {
        const url = new URL(anchor.href);
        if (url.origin !== location.origin || url.pathname.toLowerCase() !== `/${handle}`) return;
      }
      const user = [...observed.values(), ...Object.values(records)].find(item => item.handle.toLowerCase() === handle);
      if (!user) return;
      event.preventDefault(); event.stopImmediatePropagation(); showProfile(user).catch(() => {});
    }, true);
    function consume(message) {
      if (!enabled || !hasAccess() || message.ownerId !== owner || !isFollowingPage() || !Array.isArray(message.users)) return;
      for (const user of message.users) {
        if (!/^\d+$/.test(user.id) || !validHandle(user.handle)) continue;
        observed.set(user.id, user);
        if (typeof user.followedBy === 'boolean') checked.add(user.id);
      }
      records = merge(records, message.users, Date.now()); persist(); draw();
    }
    window.addEventListener('message', event => {
      const message = event.data;
      if (event.source !== window || event.origin !== location.origin || message?.source !== 'sidepeek-page' || message.type !== 'XPC_FOLLOWING_PAGE') return;
      consume(message);
    });
    async function update() {
      if (switching) return;
      const current = account();
      if ((current?.id || '') !== owner) {
        switching = true; enabled = false; closeProfile(); toolbar.remove();
        owner = current?.id || ''; accountHandle = current?.handle || ''; records = {}; checked = new Set(); observed = new Map();
        try { if (owner) { const key = `xpc:nonfollowers:${owner}`; await storageQueue.catch(() => {}); const saved = await chrome.storage.local.get(key); records = saved[key] || {}; } }
        catch { toolbar.querySelector('p').textContent = '历史记录读取失败，请刷新重试。'; }
        finally { switching = false; }
      }
      accountHandle = current?.handle || '';
      enabled = Boolean(owner && hasAccess() && isFollowingPage());
      if (!enabled) {
        toolbar.remove();
        document.querySelectorAll('.xpc-nf-hidden, .xpc-nf-clickable').forEach(node => node.classList.remove('xpc-nf-hidden', 'xpc-nf-clickable'));
        document.querySelectorAll('.xpc-nf-row-labels').forEach(node => node.remove());
        document.querySelectorAll('.xpc-nf-status-line').forEach(node => node.classList.remove('xpc-nf-status-line'));
        if (selected) closeProfile();
        return;
      }
      const primary = document.querySelector('[data-testid="primaryColumn"]');
      if (primary && !toolbar.isConnected) {
        primary.prepend(toolbar); draw();
        requestPage('READ_FOLLOWING_SNAPSHOT', {}).then(consume).catch(() => {});
      }
      applyFilter(); refreshReminder();
    }
    new MutationObserver(mutations => {
      if (scheduled || mutations.every(m => m.target.closest?.('#xpc-following-tools, #xpc-nf-profile, #xpc-nf-reply, .xpc-nf-row-labels'))) return;
      scheduled = true; requestAnimationFrame(() => { scheduled = false; update(); });
    }).observe(document.body, { childList: true, subtree: true });
    setInterval(update, 1000); update();
  }
  const api = { extractUsers, merge, status, reminderLabel, parseProfileTimeline, postDate, init };
  root.XPCNonfollowers = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
