const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
function setup(){const data={},calls=[];const context={Date,XPCLicenseConfig:{required:true,serverTrial:true},chrome:{storage:{local:{
async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]]));},async set(v){Object.assign(data,v);}
}}},XPCLicenseClient:{async register(){calls.push(['register']);},async report(route,body){calls.push([route,body]);return {ok:true};}}};context.globalThis=context;
for(const name of ['core.js','telemetry.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension',name),'utf8'),context);
return {data,calls,context,client:context.XPCTelemetry};}
test('reporting is automatic, ignores old opt-out flags and only uploads daily anonymous totals',async()=>{
 const {data,calls,context,client}=setup();const day=context.XPCore.dayKey(Date.now());
 data.xpcTelemetryEnabled=false;data.xpcTelemetryPrivacyPending=true;
 data.state={accounts:{42:{handle:'private_name'},43:{handle:'other'}},followEvents:{one:{accountId:'42',at:Date.now()},two:{accountId:'43',at:Date.now()}},manualFollows:{42:{[day]:3},43:{[day]:4}}};
 await client.flush();const report=calls.find(([route])=>route==='/v1/install/usage')[1];
 assert.equal(report.days[0].automatic,2);assert.equal(report.days[0].manual,7);assert.equal(report.days.length,3);assert.equal(report.revision,1);
 assert.equal(JSON.stringify(report).includes('private_name'),false);assert.deepEqual(Object.keys(report).sort(),['days','revision']);
 const count=calls.length;await client.flush();assert.equal(calls.length,count,'throttle heartbeats');
 assert.equal(client.configure,undefined,'no opt-out API in mandatory client');
});
test('reporting network failure never blocks feature use and a later attempt retries',async()=>{
 const {data,calls,context,client}=setup();context.XPCLicenseClient.register=async()=>{throw new Error('offline');};
 await assert.doesNotReject(client.flush());assert.equal(data.xpcTelemetryLastSent,undefined);
 context.XPCLicenseClient.register=async()=>{};await client.flush();assert.ok(data.xpcTelemetryLastSent);assert.equal(data.xpcTelemetryRevision,2);
 assert.ok(calls.some(([path])=>path==='/v1/install/usage'));
});
