const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extension/core.js');

const at = new Date(2026, 9, 15, 9, 30).getTime();
const makeId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('counts accepted X follow requests, including pending approvals, but rejects errors and unfollows', () => {
  const url = 'https://x.com/i/api/1.1/friendships/create.json';
  const request = core.followRequest(url, 'POST', 'user_id=123&screen_name=alice');
  assert.deepEqual(request, { target: '123', handle: 'alice' });
  assert.equal(core.followRequest(url, 'GET', 'user_id=123'), null);
  assert.equal(core.followRequest('https://evil.example/i/api/1.1/friendships/create.json', 'POST', 'user_id=123'), null);
  assert.equal(core.followRequest('https://x.com/i/api/1.1/friendships/destroy.json', 'POST', 'user_id=123'), null);
  assert.equal(core.extractFollow(request, { errors: [{ message: 'limit' }] }, '42', at, makeId(1)), null);
  assert.equal(core.extractFollow(request, { following: false, follow_request_sent: false }, '42', at, makeId(1)), null);
  const followBack = core.extractFollow(request, {
    id_str: '123', screen_name: 'alice', following: false,
    follow_request_sent: false, followed_by: true
  }, '42', at, makeId(6));
  assert.equal(followBack?.pending, false,
    'X may return stale following:false after accepting a follow-back');
  assert.equal(core.extractFollow(request, { id_str: '999', following: true }, '42', at, makeId(1)), null);
  assert.equal(core.extractFollow(request, { id_str: '999' }, '42', at, makeId(1)), null);
  assert.equal(core.extractFollow(request, { ok: true }, '42', at, makeId(1)), null);
  const accepted = core.extractFollow(request, { id_str: '123', following: true }, '42', at, makeId(1));
  const pending = core.extractFollow(request, { follow_request_sent: true, following: false }, '42', at + 1, makeId(2));
  const native = core.extractFollow(request, { id_str: '123', screen_name: 'alice' }, '42', at + 2, makeId(4));
  const nested = core.extractFollow(request, { rest_id: '123', relationship_perspectives: { following: true } }, '42', at + 3, makeId(5));
  assert.equal(native?.pending, false, 'a successful native REST response can omit top-level relationship flags');
  assert.equal(nested?.pending, false);
  assert.equal(accepted.pending, false);
  assert.equal(pending.pending, true);
  assert.equal('target' in accepted, false, 'stored follow events do not retain the followed account identity');
  const state = core.empty(at);
  assert.equal(core.addFollow(state, accepted, at), true);
  assert.equal(core.addFollow(state, accepted, at), false, 'one network response counts once');
  assert.equal(core.addFollow(state, pending, at + 1), true);
  assert.deepEqual(core.followSummary(state, '42', at + 1), {
    automatic: 2, manual: 0, total: 2, pending: 1, limit: 400
  });
  assert.equal(state.selected, '42');
});

test('today is local-calendar scoped; manual entries replace and warning thresholds cross once', () => {
  const state = core.empty(at);
  state.accounts['42'] = { handle: 'alice', lastSeen: at };
  assert.equal(core.setFollowManual(state, '42', core.dayKey(at), 349, at), true);
  assert.equal(core.setFollowManual(state, '42', core.dayKey(at), 349, at), true);
  assert.equal(core.followSummary(state, '42', at).total, 349);
  const request = core.followRequest('https://x.com/i/api/1.1/friendships/create.json', 'POST', 'user_id=123');
  assert.equal(core.addFollow(state, core.extractFollow(request, { following: true }, '42', at, makeId(3)), at), true);
  assert.equal(core.followThresholdCrossed(349, core.followSummary(state, '42', at).total), 350);
  assert.equal(core.followThresholdCrossed(350, 351), 0);
  assert.equal(core.followThresholdCrossed(389, 390), 390);
  assert.equal(core.followThresholdCrossed(399, 400), 400);
  assert.equal(core.followSummary(state, '43', at).total, 0, 'accounts remain separate');
  const tomorrow = new Date(2026, 9, 16, 0, 1).getTime();
  assert.equal(core.followSummary(state, '42', tomorrow).total, 0);
  assert.equal(core.setFollowManual(state, '42', core.dayKey(at), 5, tomorrow), false, 'stale-day corrections are rejected');
});
