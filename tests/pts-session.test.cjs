const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../assets/pts-session.js'),'utf8');
function token(seconds=3600){return `header.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+seconds})).toString('base64url')}.signature`;}
function fixture(options={}){
  const session={user:{Username:'Test User',Role:'Admin',SessionToken:token(options.expired?-5:3600),RefreshToken:'refresh-fixture',CustomField:'preserve'},loginTime:Date.now(),cabangAktif:'Raha',apiUrl:'unchanged-raha-api',modulAktif:'sla',extra:'keep'};
  const storage=new Map([['sesiLoginSLA',JSON.stringify(session)],['other-module','untouched']]);
  const calls=[],events=[]; let saves=0;
  const fetch=async(url,init)=>{
    calls.push({url,init,body:JSON.parse(init.body)});
    if(url.includes('refresh_token'))return new Response(JSON.stringify({access_token:token(7200),refresh_token:'new-refresh'}));
    const body=JSON.parse(init.body);
    if(body.action==='session')return new Response(JSON.stringify({success:true,user:{username:'Test User',fullname:'Test',role:'admin'}}));
    if(options.denied)return new Response(JSON.stringify({success:false,message:'Access denied'}),{status:403});
    if(body.action==='saveScenario'&&options.failFirstSave&&saves++===0)throw Error('simulated lost response');
    return new Response(JSON.stringify({success:true,data:[]}));
  };
  const window={dispatchEvent:event=>events.push(event)};
  const context=vm.createContext({window,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},fetch,
    AbortController,setTimeout,clearTimeout,crypto:{randomUUID:()=>crypto.randomUUID()},atob:value=>Buffer.from(value,'base64').toString(),CustomEvent:class{constructor(name,init){this.type=name;this.detail=init.detail;}}});
  vm.runInContext(source,context);
  return {auth:window.PTSAuth,storage,session,calls,events};
}
test('PTS refuses missing portal session and never creates its own login session',async()=>{
  const f=fixture();f.storage.delete('sesiLoginSLA');
  await assert.rejects(f.auth.start(),/login Alfacom/);assert.equal(f.calls.length,0);
  assert.equal(f.storage.get('other-module'),'untouched');
});
test('starting and reading PTS preserve branch, module, and portal storage',async()=>{
  const f=fixture(),before=f.storage.get('sesiLoginSLA');
  await f.auth.start();await f.auth.call('getScenarios');
  assert.equal(f.storage.get('sesiLoginSLA'),before);assert.equal(f.storage.size,2);
  assert.ok(f.calls.every(call=>call.url==='/api/pts'));
  assert.equal(f.calls[0].body.user,undefined);assert.equal(f.calls[0].body.role,undefined);
});
test('refresh changes only token fields, keeping the existing portal contract',async()=>{
  const f=fixture({expired:true});await f.auth.start();
  const latest=JSON.parse(f.storage.get('sesiLoginSLA'));
  assert.equal(latest.cabangAktif,'Raha');assert.equal(latest.apiUrl,'unchanged-raha-api');assert.equal(latest.modulAktif,'sla');
  assert.equal(latest.user.CustomField,'preserve');assert.equal(latest.user.RefreshToken,'new-refresh');assert.equal(latest.extra,'keep');
  assert.equal(f.storage.get('other-module'),'untouched');
});
test('manual retry of a lost save response keeps one idempotency ID',async()=>{
  const f=fixture({failFirstSave:true});await f.auth.start();
  await assert.rejects(f.auth.call('saveScenario',{title:'Once'}),/lost response/);
  await f.auth.call('saveScenario',{title:'Once'});
  const writes=f.calls.filter(call=>call.body.action==='saveScenario');
  assert.equal(writes.length,2);assert.equal(writes[0].body.requestId,writes[1].body.requestId);
});
test('changing account invalidates in-flight page identity without clearing other modules',async()=>{
  const f=fixture();await f.auth.start();const changed={...f.session,user:{...f.session.user,Username:'Another'}};
  f.storage.set('sesiLoginSLA',JSON.stringify(changed));
  await assert.rejects(f.auth.call('getScenarios'),/berubah/);
  assert.equal(f.events.at(-1).type,'pts-session-rejected');
  assert.equal(JSON.parse(f.storage.get('sesiLoginSLA')).user.Username,'Another');
});
test('server access rejection closes PTS only',async()=>{
  const f=fixture({denied:true});const before=f.storage.get('sesiLoginSLA');await f.auth.start();
  await assert.rejects(f.auth.call('getScenarios'),/Access denied/);
  assert.equal(f.auth.user,null);assert.equal(f.storage.get('sesiLoginSLA'),before);
});
