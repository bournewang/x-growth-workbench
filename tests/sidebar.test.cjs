const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.resolve(__dirname, '../extension');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

test('same-page SideX reader is confined to normal X pages and does not weaken embed headers', () => {
  assert.deepEqual(manifest.permissions, ['storage', 'alarms']);
  assert.equal(manifest.declarative_net_request, undefined);
  const scripts = manifest.content_scripts;
  const sideXMain = scripts.find(entry => entry.js.includes('sidex-page-bridge.js'));
  const sideXUi = scripts.find(entry => entry.js.includes('sidex-content.js'));
  assert.deepEqual(sideXMain.matches, ['https://x.com/*', 'https://twitter.com/*']);
  assert.deepEqual(sideXUi.matches, sideXMain.matches);
  assert.equal(sideXMain.all_frames, false);
  assert.equal(sideXUi.all_frames, false);
  assert.deepEqual(sideXUi.js, ['license-config.js', 'core.js', 'sidex-core.js', 'comment-filter.js', 'sidex-content.js']);
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.js'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, file), 'utf8'), /declarativeNetRequest|modifyHeaders|responseHeaders/, file);
  }
});

test('reader loads profiles on hover while filters use the already loaded comments', () => {
  const source = fs.readFileSync(path.join(dir, 'sidex-content.js'), 'utf8');
  assert.match(source, /function commentMatchesFilters\(model\)\s*\{\s*return XPCCommentFilter\.matches\(model, state\)/);
  assert.match(source, /state\.replies\.filter\(commentMatchesFilters\)/);
  assert.match(source, /function attachUserHoverEvents\(/);
  assert.match(source, /showUserHoverCard\(author, triggerEl\)/);
  assert.match(source, /requestPage\("TOGGLE_FOLLOW"/);
  assert.doesNotMatch(source, /eagerProfiles|preloadProfile/i);
});
