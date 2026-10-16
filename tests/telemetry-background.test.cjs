const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
function setup(){
 let listener;const calls=[];let alarm;
 const context={Date,Promise,Map,importScripts(){},XPCLicenseConfig:{required:true},XPCLicenseClient:{async status(){return {active:true};}},XPCore:{supportedPage:()=>true},XPCTelemetry:{
 async configure(enabled){calls.push(['configure',enabled]);return {ok:true,enabled};},async preference(){return false;},async flush(force){calls.push(['flush',force]);}
 },chrome:{runtime:{id:'extension',getURL:name=>'chrome-extension://extension/'+name,onMessage:{addListener(fn){listener=fn;}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},alarms:{
 async get(){return alarm;},async create(name,options){alarm={name,...options};calls.push(['alarm',name]);},onAlarm:{addListener(){}}
 }}};context.globalThis=context;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/native-profile-service-worker.js'),'utf8'),context);
 return {calls,send:(message,sender)=>new Promise(resolve=>listener(message,sender,resolve)),listener};
}
test('top-level X use starts automatic reporting without a consent message',async()=>{
 const {calls,send}=setup();const page={id:'extension',url:'https://x.com/home',tab:{id:1},frameId:0};
 await send({type:'license:status',startTrial:true},page);
 assert.equal(calls.filter(([name])=>name==='flush').length,1);
 await send({type:'license:status',startTrial:true},{...page,frameId:1});
 await send({type:'license:status'},{id:'extension',url:'chrome-extension://extension/popup.html'});
 assert.equal(calls.filter(([name])=>name==='flush').length,1,'subframes and passive popup checks do not invent activity');
});
test('continuous activity does not keep postponing the earliest pending upload',async()=>{
 const {calls,send}=setup();const page={id:'extension',tab:{id:1},url:'https://x.com/home',frameId:0};
 await send({type:'license:heartbeat'},page);await send({type:'license:heartbeat'},page);
 assert.equal(calls.filter(([name])=>name==='alarm').length,1);
});
