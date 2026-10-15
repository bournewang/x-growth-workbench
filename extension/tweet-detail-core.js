/* Read author relationships from X's existing TweetDetail response. */
(function (root) {
  'use strict';
  const hosts = new Set(['x.com', 'twitter.com', 'api.x.com', 'api.twitter.com']);
  function request(value, base = 'https://x.com/') {
    try {
      const url = new URL(value, base);
      if (url.protocol !== 'https:' || url.port || !hosts.has(url.hostname) ||
          !/\/(?:i\/api\/)?graphql\/[^/]+\/TweetDetail\/?$/.test(url.pathname)) return null;
      const focal = JSON.parse(url.searchParams.get('variables') || '{}').focalTweetId;
      return typeof focal === 'string' && /^\d{1,25}$/.test(focal) ? { focal } : null;
    } catch { return null; }
  }
  function extract(body) {
    const timeline = body?.data?.threaded_conversation_with_injections_v2;
    if (!timeline || body.errors?.length) return [];
    const pending = [timeline], seen = new Set(), authors = new Map();
    let visited = 0;
    while (pending.length && visited++ < 100000) {
      const value = pending.pop();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      if (value.__typename === 'Tweet' && /^\d{1,25}$/.test(value.rest_id || '')) {
        const user = value.core?.user_results?.result;
        const id = user?.rest_id;
        const handle = user?.core?.screen_name || user?.legacy?.screen_name;
        if (typeof id === 'string' && /^\d{1,25}$/.test(id) && typeof handle === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(handle)) {
          const relation = user.relationship_perspectives || {};
          const legacy = user.legacy || {};
          const record = { id, handle: handle.toLowerCase() };
          // X distinguishes the blue subscription badge from legacy verification.
          if (typeof user.is_blue_verified === 'boolean') record.blueVerified = user.is_blue_verified;
          const following = typeof relation.following === 'boolean' ? relation.following : legacy.following;
          if (typeof following === 'boolean') record.following = following;
          const requested = user.follow_request_sent ?? relation.follow_request_sent ?? legacy.follow_request_sent;
          if (typeof requested === 'boolean') record.requested = requested;
          const old = authors.get(record.handle);
          authors.set(record.handle, old?.id === id ? { ...old, ...record } : record);
        }
      }
      for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
    }
    return [...authors.values()].slice(0, 500);
  }
  const api = { request, extract };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XPDetailCore = api;
})(globalThis);
