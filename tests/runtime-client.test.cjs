const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function runtime(sendMessage, id = 'test-extension') {
  const context = vm.createContext({chrome:{runtime:{id,sendMessage}}});
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../extension/runtime-client.js'),'utf8'),context);
  return context.XPCRuntime;
}
test('extension messaging catches synchronous context invalidation and stays disconnected', async () => {
  let calls = 0;
  const client = runtime(() => { calls++; throw new Error('Extension context invalidated.'); });
  await assert.rejects(client.request({type:'license:status'}), error => error.code === 'XPC_CONTEXT_INVALIDATED' && /刷新 X/.test(error.message));
  await assert.rejects(client.request({type:'READ_THREAD'}), error => error.code === 'XPC_CONTEXT_INVALIDATED');
  assert.equal(calls,1,'a dead extension is not retried');
  assert.equal(client.connected(),false);
});
test('rejected context invalidation and a missing runtime are reported as refresh-required', async () => {
  await assert.rejects(runtime(() => Promise.reject(new Error('Extension context invalidated.'))).request({}), error => error.code === 'XPC_CONTEXT_INVALIDATED');
  await assert.rejects(runtime(() => {throw new Error('must not call');},'').request({}), error => error.code === 'XPC_CONTEXT_INVALIDATED');
});
test('ordinary extension errors are not misreported as an update or license expiry', async () => {
  const client = runtime(() => Promise.reject(new Error('network unavailable')));
  await assert.rejects(client.request({}), /network unavailable/);
  assert.equal(client.connected(),true);
  const healthy = runtime(payload => Promise.resolve(payload));
  assert.deepEqual(await healthy.request({type:'test'}),{type:'test'});
});
