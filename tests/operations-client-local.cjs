const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const base=process.env.LICENSE_TEST_BASE_URL;
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base||''))throw new Error('Local Worker required.');
(async()=>{
 const data={},requests=[];
 const context={Date,crypto,AbortController,setTimeout,clearTimeout,XPCLicenseConfig:{required:true,serverTrial:true,reportingRequired:true,trialDays:3,apiBaseUrl:'https://license.test'},chrome:{runtime:{getManifest:()=>({version:'0.9.1'})},storage:{local:{
 async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]]));},async set(v){Object.assign(data,v);},async remove(k){delete data[k];}
 }}},fetch:async(url,options)=>{requests.push({path:new URL(url).pathname,body:JSON.parse(options.body)});return fetch(base+new URL(url).pathname,options);}};
 context.globalThis=context;
 for(const name of ['core.js','license-client.js','telemetry.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension',name),'utf8'),context);
 const client=context.XPCLicenseClient;
 assert.equal((await client.status()).reason,'trial_not_started');assert.equal(requests.length,0);
 let s=await client.status(false,true);assert.equal(s.active,true);const expires=s.expiresAt;
 const count=requests.length;await client.status();assert.equal(requests.length,count,'cached server trial avoids network');
 data.xpcTrial.expiresAt+=86400e3;
 s=await client.status(true);assert.equal(s.expiresAt,expires,'server cannot be extended by local state');
 data.xpcTelemetryEnabled=false; // Old local opt-out cannot disable required reporting.
 const day=context.XPCore.dayKey(Date.now());
 data.state={accounts:{42:{handle:'never-upload'}},followEvents:{e:{accountId:'42',at:Date.now()}},manualFollows:{42:{[day]:2}}};
 await context.XPCTelemetry.flush(true);
 const usage=requests.find(r=>r.path==='/v1/install/usage');assert.equal(usage.body.days[0].automatic,1);assert.equal(usage.body.days[0].manual,2);
 assert.equal(JSON.stringify(usage).includes('never-upload'),false);
 assert.ok(requests.some(r=>r.path==='/v1/install/register'&&r.body.reportingRequired===true));
 delete data.xpcTrial; s=await client.status(false,true);assert.equal(s.expiresAt,expires,'deleting local trial does not reset server expiry for same installation');
 data.xpcInstallationId=crypto.randomUUID();delete data.xpcInstallToken;
 data.xpcTrial={expiresAt:Date.now()-1000};s=await client.status(false,true);assert.equal(s.active,false,'old expired local trial migrates as expired');
 console.log('PASS: actual extension client + local server trial/identity/cache/migration, automatic anonymous summaries.');
})().catch(e=>{console.error(e);process.exitCode=1});
