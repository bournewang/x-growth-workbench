/* Shared pure logic, also exercised with Node's built-in test runner. */
(function (root) {
  'use strict';
  const kinds = ['original', 'reply', 'repost'];
  const idOK = v => typeof v === 'string' && /^\d{1,25}$/.test(v);
  function dayKey(value) {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const pageHosts = ['x.com', 'twitter.com', 'pro.x.com', 'pro.twitter.com', 'tweetdeck.twitter.com'];
  function supportedPage(url) {
    try { const u = new URL(url); return u.protocol === 'https:' && pageHosts.includes(u.hostname) && !u.port; } catch { return false; }
  }
  function operation(url) {
    try {
      const u = new URL(url, 'https://x.com');
      if (u.protocol !== 'https:' || u.port || ![...pageHosts, 'api.x.com', 'api.twitter.com'].includes(u.hostname)) return null;
      return u.pathname.match(/\/graphql\/[^/]+\/(CreateTweet|CreateRetweet)\/?$/)?.[1] || null;
    } catch { return null; }
  }
  const followLimit = 400;
  function followRequest(url, method, body) {
    try {
      const u = new URL(url, 'https://x.com');
      if (u.protocol !== 'https:' || u.port || ![...pageHosts, 'api.x.com', 'api.twitter.com'].includes(u.hostname)
        || String(method).toUpperCase() !== 'POST'
        || !/^\/i\/api\/1\.1\/friendships\/create\.json\/?$/.test(u.pathname)) return null;
      const params = body instanceof URLSearchParams ? body
        : typeof FormData !== 'undefined' && body instanceof FormData ? new URLSearchParams(body)
          : new URLSearchParams(typeof body === 'string' ? body : '');
      const userId = params.get('user_id') || '';
      const handle = params.get('screen_name') || '';
      if (!idOK(userId) && !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;
      return { target: idOK(userId) ? userId : `@${handle.toLowerCase()}`, handle: /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : '' };
    } catch { return null; }
  }
  function extractFollow(request, response, accountId, now = Date.now(), id = '') {
    if (!request || !idOK(accountId) || !response || typeof response !== 'object' || Array.isArray(response) || response.errors?.length) return null;
    const perspectives = response.relationship_perspectives || {};
    const legacy = response.legacy || {};
    const following = response.following === true || perspectives.following === true || legacy.following === true;
    const pending = response.follow_request_sent === true || perspectives.follow_request_sent === true || legacy.follow_request_sent === true;
    const responseId = String(response.id_str || response.rest_id || response.legacy?.id_str || '');
    if (idOK(responseId) && idOK(request.target) && responseId !== request.target) return null;
    // X can return stale relationship fields (including following: false)
    // after accepting a follow-back. Record the accepted operation when its
    // 2xx response (checked by the observer) identifies the requested user.
    // This counts accepted operations, not a later verified relationship.
    if (!following && !pending && (!idOK(responseId) || responseId !== request.target)) return null;
    const target = idOK(responseId) ? responseId : request.target;
    if (!idOK(target) && !/^@[a-z0-9_]{1,15}$/.test(target)) return null;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { id, accountId, pending: pending && !following, at: now };
  }
  function validFollowEvent(event, now = Date.now()) {
    return event && /^[0-9a-f-]{36}$/i.test(event.id) && idOK(event.accountId)
      && typeof event.pending === 'boolean' && Number.isFinite(event.at)
      && event.at > 0 && event.at <= now + 300000 && event.at >= now - 86400000;
  }
  function addFollow(state, event, now = Date.now()) {
    if (!validFollowEvent(event, now)) return false;
    state.followEvents ||= {};
    if (state.followEvents[event.id]) return false;
    for (const [key, previous] of Object.entries(state.followEvents)) {
      if (!Number.isFinite(previous?.at) || previous.at < now - 32 * 86400000) delete state.followEvents[key];
    }
    state.followEvents[event.id] = { id: event.id, accountId: event.accountId, pending: event.pending, at: event.at };
    state.accounts[event.accountId] ||= { handle: '', lastSeen: now };
    state.accounts[event.accountId].lastSeen = now;
    if (!state.selected) state.selected = event.accountId;
    return true;
  }
  function followManualFor(state, accountId, day = dayKey(Date.now())) {
    return state.manualFollows?.[accountId]?.[day] || 0;
  }
  function setFollowManual(state, accountId, day, value, now = Date.now()) {
    if (!idOK(accountId) || !state.accounts[accountId] || day !== dayKey(now)
      || !Number.isSafeInteger(value) || value < 0 || value > 100000) return false;
    state.manualFollows ||= {};
    state.manualFollows[accountId] ||= {};
    state.manualFollows[accountId][day] = value;
    return true;
  }
  function followSummary(state, accountId, now = Date.now()) {
    const day = dayKey(now);
    const events = Object.values(state.followEvents || {}).filter(event => event.accountId === accountId && dayKey(event.at) === day);
    const automatic = events.length;
    const manual = followManualFor(state, accountId, day);
    return { automatic, manual, total: automatic + manual, pending: events.filter(event => event.pending).length,
      limit: followLimit };
  }
  function followThresholdCrossed(before, after) {
    return [400, 390, 350].find(threshold => before < threshold && after >= threshold) || 0;
  }
  function accountFromCookie(cookie) {
    try {
      const value = cookie.split(';').map(part => part.trim()).find(part => part.startsWith('twid='));
      const id = value && decodeURIComponent(value.slice(5)).match(/^u=(\d{1,25})$/)?.[1];
      return id || '';
    } catch { return ''; }
  }
  function snowflakeTime(id) {
    if (!idOK(id)) return NaN;
    const time = Number((BigInt(id) >> 22n) + 1288834974657n);
    return Number.isSafeInteger(time) ? time : NaN;
  }
  function extract(op, body, now = Date.now(), context = {}) {
    if (body?.errors?.length) return null;
    let tweet = op === 'CreateTweet' ? body?.data?.create_tweet?.tweet_results?.result
      : op === 'CreateRetweet' ? body?.data?.create_retweet?.retweet_results?.result : null;
    if (tweet?.__typename === 'TweetWithVisibilityResults') tweet = tweet.tweet;
    const legacy = tweet?.legacy;
    const user = tweet?.core?.user_results?.result;
    const id = tweet?.rest_id;
    const responseAccount = user?.rest_id || legacy?.user_id_str;
    const isRepost = op === 'CreateRetweet';
    // Compact retweet results omit the author and date. The operation returns
    // the NEW retweet ID, not the source tweet ID. Never infer from nested authors.
    const accountId = responseAccount || (isRepost ? context.accountId : '');
    if (!idOK(id) || !idOK(accountId) || (!isRepost && !legacy)) return null;
    if (isRepost && context.accountId && responseAccount && context.accountId !== responseAccount) return null;
    if (isRepost && !context.accountId && !legacy?.retweeted_status_id_str && !tweet.retweeted_status_result && !legacy?.retweeted_status_result) return null;
    const at = legacy?.created_at !== undefined ? Date.parse(legacy.created_at) : isRepost ? snowflakeTime(id) : NaN;
    if (!Number.isFinite(at) || at > now + 300000) return null;
    const handle = user?.core?.screen_name || user?.legacy?.screen_name || '';
    return { id, accountId, handle: /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : '',
      kind: op === 'CreateRetweet' ? 'repost' : legacy.in_reply_to_status_id_str ? 'reply' : 'original',
      at, observedAt: now };
  }
  function validEvent(e, now = Date.now()) {
    return e && idOK(e.id) && idOK(e.accountId) && kinds.includes(e.kind)
      && typeof e.handle === 'string' && /^(?:[A-Za-z0-9_]{1,15})?$/.test(e.handle)
      && Number.isFinite(e.at) && e.at > 0 && e.at <= now + 300000;
  }
  function empty(now = Date.now()) { return { version: 1, installedAt: now, events: {}, accounts: {}, selected: '', warnings: 0 }; }
  function add(state, event, now = Date.now()) {
    if (!validEvent(event, now)) return false;
    const key = `${event.accountId}:${event.id}`;
    if (state.events[key]) return false;
    state.events[key] = { id: event.id, accountId: event.accountId, handle: event.handle, kind: event.kind, at: event.at, observedAt: now };
    state.accounts[event.accountId] = { handle: event.handle || state.accounts[event.accountId]?.handle || '', lastSeen: now };
    if (!state.selected) state.selected = event.accountId;
    return true;
  }
  function counts(state, accountId, days = 1, now = Date.now()) {
    const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - days + 1);
    const end = new Date(now); end.setHours(24, 0, 0, 0);
    const result = { original: 0, reply: 0, repost: 0, total: 0 };
    for (const e of Object.values(state.events)) {
      if (e.accountId === accountId && e.at >= start.getTime() && e.at < end.getTime()) { result[e.kind]++; result.total++; }
    }
    return result;
  }
  function manualFor(state, accountId, day = dayKey(Date.now())) {
    return state.manual?.[accountId]?.[day] || { original: 0, reply: 0, repost: 0 };
  }
  function setManual(state, accountId, day, values, now = Date.now()) {
    if (!idOK(accountId) || !state.accounts[accountId] || day !== dayKey(now)) return false;
    if (!values || !kinds.every(k => Number.isSafeInteger(values[k]) && values[k] >= 0 && values[k] <= 100000)) return false;
    state.manual ||= {};
    state.manual[accountId] ||= {};
    // Replace, never increment: saving the same values twice is harmless.
    state.manual[accountId][day] = Object.fromEntries(kinds.map(k => [k, values[k]]));
    return true;
  }
  function summary(state, accountId, days = 1, now = Date.now()) {
    const automatic = counts(state, accountId, days, now);
    const manual = { original: 0, reply: 0, repost: 0, total: 0 };
    const first = new Date(now); first.setHours(0, 0, 0, 0); first.setDate(first.getDate() - days + 1);
    const from = dayKey(first), to = dayKey(now);
    for (const [day, values] of Object.entries(state.manual?.[accountId] || {})) {
      if (day < from || day > to) continue;
      for (const kind of kinds) { manual[kind] += values[kind]; manual.total += values[kind]; }
    }
    const combined = Object.fromEntries([...kinds, 'total'].map(k => [k, automatic[k] + manual[k]]));
    return { automatic, manual, combined };
  }
  root.XPCore = { supportedPage, manualFor, setManual, summary, accountFromCookie, snowflakeTime, dayKey, operation, extract, validEvent, empty, add, counts,
    followRequest, extractFollow, validFollowEvent, addFollow, followManualFor, setFollowManual, followSummary, followThresholdCrossed };
  if (typeof module !== 'undefined') module.exports = root.XPCore;
})(globalThis);
