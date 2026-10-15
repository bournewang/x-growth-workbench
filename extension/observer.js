(() => {
  'use strict';
  if (window.__xpCountObserver) return;
  window.__xpCountObserver = true;
  const core = window.XPCore;
  const channel = 'x-posts-count-v1';
  const detail = window.XPDetailCore, detailChannel = 'xpc-tweet-detail-v1';
  const pending = [];
  const detailPending = [];
  let ready = false, detailReady = false;
  const emit = payload => {
    if (!ready) { if (pending.length < 100) pending.push(payload); return; }
    window.postMessage({ channel, payload }, location.origin);
  };
  window.addEventListener('message', e => {
    if (e.source !== window || e.origin !== location.origin || e.data?.channel !== channel || e.data?.ready !== true) return;
    ready = true;
    pending.splice(0).forEach(emit);
  });
  const emitDetail = payload => {
    if (!detailReady) { if (detailPending.length < 20) detailPending.push(payload); return; }
    window.postMessage({ channel: detailChannel, ...payload }, location.origin);
  };
  window.addEventListener('message', e => {
    if (e.source !== window || e.origin !== location.origin || e.data?.channel !== detailChannel || e.data?.ready !== true) return;
    detailReady = true;
    detailPending.splice(0).forEach(emitDetail);
  });
  window.postMessage({ channel, hello: true }, location.origin);
  window.postMessage({ channel: detailChannel, hello: true }, location.origin);
  function inspect(op, status, body, context) {
    if (status < 200 || status >= 300 || body?.errors?.length) return;
    const event = core.extract(op, body, Date.now(), context);
    emit(event ? { type: 'publication', event } : { type: 'unrecognized', at: Date.now() });
  }
  function inspectDetail(request, status, body) {
    if (!request || status < 200 || status >= 300 || body?.errors?.length) return;
    if (request.viewer !== core.accountFromCookie(document.cookie)) return;
    const authors = detail.extract(body);
    if (authors.length) emitDetail({ viewer: request.viewer, focal: request.focal, authors });
  }
  function inspectFollow(request, status, body, accountId, requestId) {
    if (!request || status < 200 || status >= 300) return;
    const event = core.extractFollow(request, body, accountId, Date.now(), requestId);
    if (event) emit({ type: 'follow', source: 'observer', event, target: request.target });
  }
  function detailRequest(url) {
    if (window !== window.top) return null;
    const target = detail.request(url, location.href);
    return target && { ...target, viewer: core.accountFromCookie(document.cookie) };
  }
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
    const method = args[1]?.method || args[0]?.method || 'GET';
    const op = core.operation(url);
    const detailContext = detailRequest(url);
    const mayFollow = String(method).toUpperCase() === 'POST' && /\/friendships\/create\.json(?:\?|$)/.test(String(url));
    const followAccount = mayFollow ? core.accountFromCookie(document.cookie) : '';
    const followId = mayFollow ? crypto.randomUUID() : '';
    let followBody = null;
    if (mayFollow) {
      try {
        followBody = args[1]?.body !== undefined ? Promise.resolve(args[1].body)
          : args[0] instanceof Request ? args[0].clone().text() : Promise.resolve('');
      } catch { followBody = Promise.resolve(''); }
    }
    const context = op === 'CreateRetweet' ? { accountId: core.accountFromCookie(document.cookie) } : {};
    const promise = Reflect.apply(originalFetch, this, args);
    if (op) promise.then(response => {
      if (!response.ok) return;
      response.clone().json().then(body => inspect(op, response.status, body, context)).catch(() => emit({ type: 'unrecognized', at: Date.now() }));
    }, () => {});
    if (detailContext) promise.then(response => {
      if (response.ok) response.clone().json().then(body => inspectDetail(detailContext, response.status, body)).catch(() => {});
    }, () => {});
    if (followBody) promise.then(response => {
      if (!response.ok) return;
      Promise.all([followBody, response.clone().json()]).then(([body, json]) => {
        inspectFollow(core.followRequest(url, method, body), response.status, json, followAccount, followId);
      }).catch(() => {});
    }, () => {});
    return promise;
  };
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  const operations = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    operations.set(this, { op: core.operation(String(url)), detailContext: detailRequest(String(url)),
      followUrl: String(url), followMethod: method });
    return Reflect.apply(open, this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const { op, detailContext, followUrl, followMethod } = operations.get(this) || {};
    const context = op === 'CreateRetweet' ? { accountId: core.accountFromCookie(document.cookie) } : {};
    const followRequest = core.followRequest(followUrl, followMethod, args[0]);
    const followAccount = followRequest ? core.accountFromCookie(document.cookie) : '';
    const followId = followRequest ? crypto.randomUUID() : '';
    if (op) this.addEventListener('load', () => {
      if (this.status < 200 || this.status >= 300) return;
      try { inspect(op, this.status, this.responseType === 'json' ? this.response : JSON.parse(this.responseText), context); }
      catch { emit({ type: 'unrecognized', at: Date.now() }); }
    }, { once: true });
    if (detailContext) this.addEventListener('load', () => {
      if (this.status < 200 || this.status >= 300) return;
      try { inspectDetail(detailContext, this.status, this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); }
      catch { /* X returned a non-JSON response. */ }
    }, { once: true });
    if (followRequest) this.addEventListener('load', () => {
      if (this.status < 200 || this.status >= 300) return;
      try { inspectFollow(followRequest, this.status, this.responseType === 'json' ? this.response : JSON.parse(this.responseText), followAccount, followId); }
      catch { /* Ignore malformed follow responses. */ }
    }, { once: true });
    return Reflect.apply(send, this, args);
  };
})();
