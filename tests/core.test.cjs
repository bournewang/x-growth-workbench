const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extension/core.js');
const now = Date.parse('2026-10-08T12:00:00Z');
function response(kind = 'original', id = '100') {
  const tweet = { rest_id: id, core: { user_results: { result: { rest_id: '42', legacy: { screen_name: 'tester' } } } }, legacy: { created_at: new Date(now).toUTCString(), user_id_str: '42' } };
  if (kind === 'reply') tweet.legacy.in_reply_to_status_id_str = '9';
  if (kind === 'repost') tweet.legacy.retweeted_status_result = { result: { rest_id: '9', core: { user_results: { result: { rest_id: '99' } } } } };
  return kind === 'repost' ? { data: { create_retweet: { retweet_results: { result: tweet } } } } : { data: { create_tweet: { tweet_results: { result: tweet } } } };
}
test('recognizes only supported publication endpoints on X hosts', () => {
  assert.equal(core.operation('https://x.com/i/api/graphql/hash/CreateTweet'), 'CreateTweet');
  assert.equal(core.operation('/i/api/graphql/hash/CreateRetweet'), 'CreateRetweet');
  for (const url of ['https://evil.test/i/api/graphql/hash/CreateTweet', '/i/api/graphql/hash/DeleteTweet', '/i/api/graphql/hash/UserTweets']) assert.equal(core.operation(url), null);
});
test('classifies original, reply and repost using returned publication and author', () => {
  for (const kind of ['original', 'reply', 'repost']) {
    const event = core.extract(kind === 'repost' ? 'CreateRetweet' : 'CreateTweet', response(kind), now);
    assert.equal(event.kind, kind); assert.equal(event.accountId, '42'); assert.equal(event.id, '100'); assert.equal(event.at, now);
  }
});
test('supports visibility wrapper and current user core handle', () => {
  const body = response(); const tweet = body.data.create_tweet.tweet_results.result;
  tweet.core.user_results.result = { rest_id: '42', core: { screen_name: 'newhandle' } };
  body.data.create_tweet.tweet_results.result = { __typename: 'TweetWithVisibilityResults', tweet };
  assert.equal(core.extract('CreateTweet', body, now).handle, 'newhandle');
});
test('quote is counted once as original', () => {
  const body = response(); body.data.create_tweet.tweet_results.result.quoted_status_result = { result: { rest_id: '5' } };
  assert.equal(core.extract('CreateTweet', body, now).kind, 'original');
});
test('errors, absent identity, invalid timestamp and original-only repost response fail closed', () => {
  assert.equal(core.extract('CreateTweet', { ...response(), errors: [{ message: 'failed' }] }, now), null);
  assert.equal(core.extract('CreateTweet', {}, now), null);
  for (const mutate of [t => { delete t.rest_id; }, t => { t.legacy.created_at = 'invalid'; }, t => { t.legacy.created_at = new Date(now + 3600000).toUTCString(); }, t => { delete t.core; delete t.legacy.user_id_str; }]) {
    const body = response(); mutate(body.data.create_tweet.tweet_results.result); assert.equal(core.extract('CreateTweet', body, now), null);
  }
  assert.equal(core.extract('CreateRetweet', { data: { create_retweet: { retweet_results: response().data.create_tweet.tweet_results } } }, now), null);
});
test('deduplicates same account and ID but isolates accounts and preserves first selection', () => {
  const state = core.empty(now); const event = core.extract('CreateTweet', response(), now);
  assert.equal(core.add(state, event, now), true); assert.equal(core.add(state, event, now), false);
  assert.equal(core.add(state, { ...event, accountId: '43' }, now), true);
  assert.equal(state.selected, '42'); assert.equal(Object.keys(state.events).length, 2);
  assert.equal(core.counts(state, '42', 1, now).total, 1); assert.equal(core.counts(state, '43', 1, now).total, 1);
  assert.equal(core.add(state, { ...event, id: 'bad' }, now), false);
});
test('local midnight and rolling calendar ranges include today', () => {
  const time = new Date(2026, 9, 8, 12).getTime(); const midnight = new Date(2026, 9, 8).getTime();
  const state = core.empty(time);
  for (const [index, at] of [midnight - 1, midnight, time, new Date(2026, 9, 6).getTime(), new Date(2026, 9, 5, 23, 59).getTime()].entries()) core.add(state, { id: String(index + 1), accountId: '42', handle: '', kind: 'original', at }, time);
  assert.equal(core.counts(state, '42', 1, time).total, 2);
  assert.equal(core.counts(state, '42', 3, time).total, 4);
  assert.equal(core.counts(state, '42', 7, time).total, 5);
  assert.equal(core.counts(state, '42', 1, new Date(2026, 9, 9).getTime()).total, 0);
});
test('calendar ranges work across DST transition', () => {
  const previous = process.env.TZ; process.env.TZ = 'America/New_York';
  try {
    const time = new Date(2026, 2, 9, 12).getTime(); const state = core.empty(time);
    core.add(state, { id: '1', accountId: '42', handle: '', kind: 'reply', at: new Date(2026, 2, 7, 0, 0).getTime() }, time);
    assert.equal(core.counts(state, '42', 3, time).total, 1);
    assert.equal(core.counts(state, '42', 1, time).total, 0);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
module.exports = { response };
test('compact repost response uses request account and publication snowflake time', () => {
  const id = String((BigInt(now) - 1288834974657n) << 22n);
  const body = { data: { create_retweet: { retweet_results: { result: { rest_id: id, legacy: { full_text: 'RT @source: content' } } } } } };
  const event = core.extract('CreateRetweet', body, now, { accountId: '42' });
  assert.equal(event.kind, 'repost'); assert.equal(event.accountId, '42'); assert.equal(event.at, now); assert.equal(event.id, id);
  assert.equal(core.extract('CreateRetweet', body, now), null);
  assert.equal(core.extract('CreateRetweet', { ...body, errors: [{ message: 'failed' }] }, now, { accountId: '42' }), null);
  const state = core.empty(now); core.add(state, event, now); core.add(state, event, now);
  assert.equal(core.counts(state, '42', 1, now).repost, 1);
});
test('repost rejects conflicting response identity and future timestamp', () => {
  assert.equal(core.extract('CreateRetweet', response('repost'), now, { accountId: '99' }), null);
  const id = String((BigInt(now + 3600000) - 1288834974657n) << 22n);
  assert.equal(core.extract('CreateRetweet', { data: { create_retweet: { retweet_results: { result: { rest_id: id } } } } }, now, { accountId: '42' }), null);
});
test('twid account extraction accepts encoded numeric identity only', () => {
  assert.equal(core.accountFromCookie('a=b; twid=u%3D42; c=d'), '42');
  assert.equal(core.accountFromCookie('twid=u=43'), '43');
  for (const cookie of ['', 'not_twid=u%3D42', 'twid=%XX', 'twid=u=hello']) assert.equal(core.accountFromCookie(cookie), '');
});
test('manual correction replaces values and preserves automatic events on old storage', () => {
  const state = core.empty(now); core.add(state, core.extract('CreateTweet', response(), now), now);
  const values = { original: 2, reply: 3, repost: 4 };
  assert.equal(core.setManual(state, '42', core.dayKey(now), values, now), true);
  core.setManual(state, '42', core.dayKey(now), values, now);
  const result = core.summary(state, '42', 1, now);
  assert.equal(result.automatic.total, 1); assert.equal(result.manual.total, 9); assert.equal(result.combined.total, 10);
  assert.equal(core.summary(state, '43', 1, now).combined.total, 0);
  core.setManual(state, '42', core.dayKey(now), { original: 0, reply: 0, repost: 0 }, now);
  assert.equal(core.summary(state, '42', 1, now).combined.total, 1);
});
test('manual values roll over by local calendar date and remain in range history', () => {
  const state = core.empty(now); state.accounts['42'] = { handle: 'tester' };
  core.setManual(state, '42', core.dayKey(now), { original: 0, reply: 2, repost: 1 }, now);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  assert.equal(core.summary(state, '42', 1, tomorrow).manual.total, 0);
  assert.equal(core.summary(state, '42', 3, tomorrow).manual.total, 3);
  assert.equal(core.setManual(state, '42', core.dayKey(now), { original: 0, reply: 0, repost: 0 }, tomorrow), false);
});
test('manual input rejects missing account, negatives, fractions and invalid values', () => {
  const state = core.empty(now); state.accounts['42'] = {};
  for (const original of [-1, 1.5, '1', Infinity, NaN, 100001]) assert.equal(core.setManual(state, '42', core.dayKey(now), { original, reply: 0, repost: 0 }, now), false);
  assert.equal(core.setManual(state, '99', core.dayKey(now), { original: 0, reply: 0, repost: 0 }, now), false);
  assert.equal(core.setManual(state, '42', core.dayKey(now), {}, now), false);
});
test('Pro page and API hosts are accepted without allowing arbitrary subdomains', () => {
  for (const host of ['x.com', 'twitter.com', 'pro.x.com', 'pro.twitter.com', 'tweetdeck.twitter.com']) {
    assert.equal(core.supportedPage(`https://${host}/`), true);
    assert.equal(core.operation(`https://${host}/i/api/graphql/hash/CreateTweet`), 'CreateTweet');
  }
  assert.equal(core.operation('https://api.x.com/graphql/hash/CreateRetweet'), 'CreateRetweet');
  for (const url of ['https://pro.x.com.evil.test/', 'http://pro.x.com/', 'https://unknown.x.com/', 'https://pro.x.com:8443/', 'invalid']) assert.equal(core.supportedPage(url), false);
  assert.equal(core.operation('http://pro.x.com/i/api/graphql/hash/CreateTweet'), null);
});
