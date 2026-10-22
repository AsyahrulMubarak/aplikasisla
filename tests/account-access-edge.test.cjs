const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{accountFixture}=require('../maintenance/account-access-test-fixture.cjs'),{accountEdgeHarness}=require('../maintenance/account-access-edge-harness.cjs');
test('profile Edge disables/reactivates same Auth identity, retries Auth failure closed and never sends WA or deletes history',async()=>{
 const f=await accountFixture();try{
  const before=await f.history(),h=accountEdgeHarness(f);const body={action:'setAccountAccess',usernameTarget:'worker',active:false,version:0,reason:'Pegawai tidak aktif'};
  h.state.authFailure=true;let r=await h.post(body);assert.equal(r.data.pending,true);assert.equal((await f.user()).account_active,false);assert.equal((await f.user()).account_sync_pending,true);
  h.state.session='worker';assert.equal((await h.post({action:'validateSession'})).status,401);h.state.session='admin';h.state.authFailure=false;
  r=await h.post({...body,version:1});assert.equal(r.data.pending,false);assert.ok(h.bans.get('worker'));assert.equal((await f.user()).account_access_version,1);
  r=await h.post({...body,active:true,version:1,reason:'Pegawai bekerja kembali'});assert.equal(r.data.active,true);assert.equal(h.bans.get('worker'),null);
  h.state.session='worker';assert.equal((await h.post({action:'validateSession'})).status,401);h.state.session='admin';
  r=await h.post({...body,version:0});assert.equal(r.data.status,'gagal');
  assert.equal((await h.post({action:'hapusProfil',usernameTarget:'worker'})).data.status,'gagal');
  assert.deepEqual(await f.history(),before);assert.ok(h.calls.every(c=>c.method!=='DELETE'));assert.ok(h.calls.filter(c=>c.method==='PUT').every(c=>Object.keys(c.body).join()==='ban_duration'));
  const check=h.calls.find(c=>c.path.endsWith('sla_assert_account_session'));assert.ok(check.authorization.startsWith('Bearer x.'));
 }finally{await f.db.close()}
});
test('all eight employee Edge entrypoints check live session before reading privileged data',async()=>{
 for(const slug of ['sla-profile','sla-payroll-attendance','sla-operations','sla-ticket-assessment','sla-ticket-workflow','sla-performance-credit','sla-client-tracking','kpi-api']){
  const cached=__dirname+'/../tmp/account-access-release/edges/'+slug+'/index.ts',source=fs.existsSync(cached)?cached:__dirname+'/../'+(slug==='kpi-api'?'aplikasi kpi/':'')+'supabase/functions/'+slug+'/index.ts';
  let s=fs.readFileSync(source,'utf8').replace(/^import[^\n]+\n/gm,'');const calls=[];
  const c=vm.createContext({console,Response,Request,AbortSignal,URL,URLSearchParams,TextEncoder,Uint8Array,Date,Intl,crypto,atob,btoa,setTimeout,clearTimeout,Deno:{env:{get:n=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service-test',SUPABASE_ANON_KEY:'public-test'})[n]},serve(){}},fetch:async(url,o)=>{calls.push(String(url));if(String(url).includes('/auth/v1/user'))return Response.json({id:'33333333-3333-4333-8333-333333333333',email:'worker@alfacom.local'});if(String(url).includes('sla_assert_account_session'))return Response.json({},{status:401});throw Error('Privileged call before active check: '+url)}});
  vm.runInContext(s,c);
  const name=slug==='kpi-api'?'verifyIdentity':slug==='sla-operations'?'actorFor':'authenticate';
  await assert.rejects(c[name](slug==='kpi-api'?'a.b.c':new Request('https://db.test',{headers:{Authorization:'Bearer a.b.c'}})),/Akun nonaktif/,slug);
  assert.equal(calls.length,2,slug);
 }
});
