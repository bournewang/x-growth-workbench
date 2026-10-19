const test = require('node:test');
const assert = require('node:assert/strict');
const { extractUsers, merge, status } = require('../extension/nonfollowers.js');
const user = (id, followedBy) => ({ id, handle: 'user' + id, name: 'User ' + id, followedBy });
test('only explicit false creates a non-follower record; unknown never erases evidence', () => {
  const first = merge({}, [user('1', false), user('2', true), user('3', null)], 100);
  assert.deepEqual(Object.keys(first), ['1']);
  first['1'].remindedAt = 120;
  const second = merge(first, [user('1', null)], 200);
  assert.equal(second['1'].lastCheckedAt, 100);
  assert.equal(second['1'].followedBy, false);
  assert.equal(second['1'].remindedAt, 120);
});
test('rechecks distinguish returned, still non-mutual and unobserved historical records', () => {
  const first = merge({}, [user('1', false), user('2', false), user('3', false)], 100);
  const next = merge(first, [{ ...user('1', true), handle: 'renamed' }, user('2', false)], 200);
  const checked = new Set(['1', '2']);
  assert.equal(status(next['1'], checked), 'returned');
  assert.equal(status(next['2'], checked), 'non');
  assert.equal(status(next['3'], checked), 'pending');
  assert.equal(next['1'].handle, 'renamed');
  assert.equal(next['1'].firstSeenAt, 100);
  assert.equal(next['1'].returnedAt, 200);
  assert.equal(status(next['1'], new Set()), 'pending');
  assert.equal(merge(next, [user('1', false)], 300)['1'].returnedAt, null);
});
test('Following parser excludes recommendations, unavailable users, errors in shape and invalid handles', () => {
  const entry = (id, followedBy, extra = {}) => ({ entryId: 'user-' + id, content: { itemContent: { user_results: { result: {
    __typename: 'User', rest_id: id, core: { screen_name: 'user' + id, name: 'User' },
    relationship_perspectives: { followed_by: followedBy }, ...extra
  } } } } });
  const instructions = [{ entries: [entry('1', false), entry('2', true), entry('3', undefined),
    entry('4', false, { relationship_perspectives: { following: false } }),
    entry('5', false, { core: { screen_name: '<script>' } }),
    { ...entry('6', false), entryId: 'recommendation-6' }] }];
  const body = { data: { user: { result: { timeline: { timeline: { instructions } } } } } };
  assert.deepEqual(extractUsers(body).map(u => [u.id, u.followedBy]), [['1', false], ['2', true], ['3', null]]);
  assert.deepEqual(extractUsers({}), []);
});

test('reminder timestamps display coarse age and reject missing or corrupt values', () => {
  const { reminderLabel } = require('../extension/nonfollowers.js');
  const now = 2000000000000;
  assert.equal(reminderLabel(now - 30000, now), '已提醒-刚刚');
  assert.equal(reminderLabel(now - 5 * 60000, now), '已提醒-5分钟前');
  assert.equal(reminderLabel(now - 3 * 3600000, now), '已提醒-3小时前');
  assert.equal(reminderLabel(now - 2 * 86400000, now), '已提醒-2天前');
  assert.equal(reminderLabel(now - 60 * 86400000, now), '已提醒-2个月前');
  assert.equal(reminderLabel(now + 60000, now), '已提醒-刚刚');
  assert.equal(reminderLabel(undefined, now), '');
  assert.equal(reminderLabel(NaN, now), '');
});

require('../extension/sidex-core.js');
const profileCore = globalThis.SidePeekCore;
const { parseProfileTimeline, postDate } = require('../extension/nonfollowers.js');
const rawPost = (id, author = '2', createdAt = 'Wed Oct 18 08:00:00 +0000 2023') => ({
  __typename:'Tweet',rest_id:id,core:{user_results:{result:{__typename:'User',rest_id:author,core:{screen_name:'owner',name:'Owner'}}}},
  legacy:{full_text:'Old post '+id,created_at:createdAt}
});
const entryFor = post => ({entryId:'tweet-'+post.rest_id, content:{itemContent:{tweet_results:{result:post}}}});
const profilePayload = instructions => ({data:{user:{result:{timeline_v2:{timeline:{instructions}}}}}});
test('profile dates always include their real year, never infer the current year', () => {
  const date = postDate('Wed Oct 18 08:00:00 +0000 2023', 'zh-CN');
  assert.match(date.label, /2023/);
  assert.equal(date.iso,'2023-10-18T08:00:00.000Z');
  assert.match(date.exact,/2023/);
  assert.equal(postDate('invalid').label,'日期未知');
  assert.equal(postDate('').iso,'');
});
test('profile parser excludes repost wrappers, recommendation modules, promoted entries and unrelated payloads', () => {
  const own = rawPost('100');
  own.quoted_status_result = {result:rawPost('999')};
  const repost = rawPost('200','2','Sun Oct 18 08:00:00 +0000 2026');
  repost.legacy.retweeted_status_result = {result:rawPost('50','3')};
  const promoted = entryFor(rawPost('300')); promoted.content.itemContent.promotedMetadata = {advertiser:'x'};
  const recommended = {entryId:'recommendations-module',content:{items:[{item:{itemContent:{tweet_results:{result:rawPost('400')}}}}]}};
  const page = parseProfileTimeline(profilePayload([{type:'TimelineAddEntries',entries:[entryFor(own),entryFor(repost),promoted,recommended,entryFor(rawPost('500','3')),
    {entryId:'cursor-bottom-0',content:{cursorType:'Bottom',value:'real-page-cursor'}}]}]),'2',profileCore);
  assert.deepEqual(page.posts.map(p=>p.id),['100']);
  assert.match(postDate(page.posts[0].createdAt).label,/2023/);
  assert.equal(page.posts[0].quote.id,'999','quotes remain nested inside their parent');
  assert.equal(page.cursor,'real-page-cursor');
  assert.equal(parseProfileTimeline({},'2',profileCore),null);
});
test('profile parser keeps pinned posts with their original timestamps and validates entry IDs', () => {
  const pinned = rawPost('100');
  const wrongEntry = entryFor(rawPost('101')); wrongEntry.entryId='tweet-102';
  const page = parseProfileTimeline(profilePayload([{type:'TimelinePinEntry',entry:entryFor(pinned)}, {type:'TimelineAddEntries',entries:[entryFor(pinned),wrongEntry]}]),'2',profileCore);
  assert.deepEqual(page.posts.map(p=>p.id),['100']);
  assert.equal(page.posts[0].pinned,true);
  assert.equal(page.posts[0].createdAt,pinned.legacy.created_at);
});

test('profile conversation modules keep direct own posts without pulling nested quote payloads', () => {
  const post = rawPost('600');
  const moduleEntry = {entryId:'profile-conversation-600',content:{items:[{entryId:'profile-conversation-600-tweet-600',item:{itemContent:{tweet_results:{result:post}}}}]}};
  const page = parseProfileTimeline(profilePayload([{entries:[moduleEntry]}]),'2',profileCore);
  assert.deepEqual(page.posts.map(p=>p.id),['600']);
});
