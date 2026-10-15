const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../extension/sidex-core.js');
const filter = require('../extension/comment-filter.js');
const core = globalThis.SidePeekCore;

function author(handle, following, blueVerified, requested = false, id = '123') {
  return core.userModel({
    __typename: 'User', rest_id: id, core: { screen_name: handle, name: handle },
    relationship_perspectives: following === null ? {} : { following },
    follow_request_sent: requested,
    is_blue_verified: blueVerified
  });
}

test('SideX models retain exact outgoing follow, request, and blue V states', () => {
  const unfollowed = author('bob', false, true);
  const followed = author('carol', true, true);
  const requested = author('dave', false, true, true);
  const unknown = author('erin', null, undefined);
  assert.equal(unfollowed.following, false);
  assert.equal(unfollowed.blueVerified, true);
  assert.equal(followed.following, true);
  assert.equal(requested.followRequestSent, true);
  assert.equal(unknown.following, null);
  assert.equal(unknown.blueVerified, false);
});

test('not-following filter excludes my own replies by account ID', () => {
  const comments = [
    { author: author('my_name', false, true, false, '999') },
    { author: author('bob', false, true, false, '123') }
  ];
  const selected = settings => comments.filter(comment => filter.matches(comment, { viewerId: '999', ...settings }))
    .map(comment => comment.author.handle);
  assert.deepEqual(selected({ onlyUnfollowed: true, onlyBlue: false }), ['bob']);
  assert.deepEqual(selected({ onlyUnfollowed: true, onlyBlue: true }), ['bob']);
  assert.deepEqual(selected({ onlyUnfollowed: false, onlyBlue: true }), ['my_name', 'bob']);
  assert.deepEqual(comments.filter(comment => filter.matches(comment, {
    onlyUnfollowed: true, onlyBlue: false, viewerHandle: 'MY_NAME'
  })).map(comment => comment.author.handle), ['bob']);
});

test('combined filters include only blue V authors I have not followed', () => {
  const comments = [
    { author: author('bob', false, true) },
    { author: author('carol', true, true) },
    { author: author('dave', false, false) },
    { author: author('erin', null, true) },
    { author: author('frank', false, true, true) }
  ];
  const selected = settings => comments.filter(comment => filter.matches(comment, settings)).map(comment => comment.author.handle);
  assert.deepEqual(selected({ onlyUnfollowed: true, onlyBlue: false }), ['bob', 'dave']);
  assert.deepEqual(selected({ onlyUnfollowed: true, onlyBlue: true }), ['bob']);
  assert.deepEqual(selected({ onlyUnfollowed: false, onlyBlue: true }), ['bob', 'carol', 'erin', 'frank']);
  assert.deepEqual(selected({ onlyUnfollowed: false, onlyBlue: false }), ['bob', 'carol', 'dave', 'erin', 'frank']);
});

test('SideX parser keeps a matching child reply even if its parent author is followed', () => {
  const tweet = (id, handle, parent, following, blueVerified) => ({
    __typename: 'Tweet', rest_id: id,
    core: { user_results: { result: {
      __typename: 'User', rest_id: id, core: { screen_name: handle, name: handle },
      relationship_perspectives: { following }, is_blue_verified: blueVerified
    } } },
    legacy: { full_text: handle, conversation_id_str: '100', in_reply_to_status_id_str: parent }
  });
  const body = { data: [
    { tweet_results: { result: tweet('100', 'op', '', false, false) } },
    { tweet_results: { result: tweet('101', 'carol', '100', true, true) } },
    { tweet_results: { result: tweet('102', 'grace', '101', false, true) } }
  ] };
  const { replies } = core.parseTweetDetail(body, '100');
  assert.deepEqual(replies.filter(comment => filter.matches(comment, { onlyUnfollowed: true, onlyBlue: true })).map(comment => comment.author.handle), ['grace']);
});
