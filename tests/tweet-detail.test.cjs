const test = require('node:test');
const assert = require('node:assert/strict');
const detail = require('../extension/tweet-detail-core.js');

test('only an X TweetDetail request with a focal post is observed', () => {
  assert.deepEqual(detail.request('/i/api/graphql/hash/TweetDetail?variables=%7B%22focalTweetId%22%3A%22123%22%7D'), { focal: '123' });
  for (const url of ['https://evil.example/i/api/graphql/hash/TweetDetail?variables=%7B%22focalTweetId%22%3A%22123%22%7D',
    '/i/api/graphql/hash/UsersByRestIds?variables=%7B%22focalTweetId%22%3A%22123%22%7D',
    '/i/api/graphql/hash/TweetDetail?variables=%7B%7D']) assert.equal(detail.request(url), null);
});

test('TweetDetail provides explicit author relationships without treating missing data as unfollowed', () => {
  const user = (id, handle, relationship, requested, blueVerified) => ({ rest_id: id, core: { screen_name: handle },
    relationship_perspectives: relationship, ...(requested === undefined ? {} : { follow_request_sent: requested }),
    ...(blueVerified === undefined ? {} : { is_blue_verified: blueVerified }) });
  const tweet = (id, author) => ({ __typename: 'Tweet', rest_id: id, core: { user_results: { result: author } } });
  const item = result => ({ item: { itemContent: { tweet_results: { result } } } });
  const tweets = [
    tweet('1', user('10', 'Alice', { following: true }, undefined, true)),
    tweet('2', user('20', 'Bob', { following: false, followed_by: true }, false, false)),
    tweet('3', user('30', 'Carol', {}, true)),
    tweet('4', user('20', 'Bob', { following: false }, undefined, false))
  ];
  const body = { data: { threaded_conversation_with_injections_v2: { instructions: [
    { entries: [{ content: { items: tweets.map(item) } }] }
  ] } } };
  assert.deepEqual(detail.extract(body).sort((a, b) => a.handle.localeCompare(b.handle)), [
    { id: '10', handle: 'alice', blueVerified: true, following: true },
    { id: '20', handle: 'bob', blueVerified: false, following: false, requested: false },
    { id: '30', handle: 'carol', requested: true }
  ]);
  assert.deepEqual(detail.extract({ errors: [{ message: 'rate limited' }], ...body }), []);
});
