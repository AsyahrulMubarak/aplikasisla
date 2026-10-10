const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../supabase/functions/sla-legacy-gateway/index.ts','utf8');
const endpoint='https://db.test/functions/v1/sla-legacy-gateway';
const upstream={Kendari:'https://script.google.com/macros/s/fixture-kendari/exec',Raha:'https://script.google.com/macros/s/fixture-raha/exec'};
function harness(options={}){
 const calls=[];let handler;
 const c=vm.createContext({Request,Response,AbortSignal,console,
 Deno:{env:{get:key=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'private-service',SUPABASE_ANON_KEY:'public-test'})[key]},serve:fn=>{handler=fn;}},
 fetch:async(url,init={})=>{
  calls.push({url,...init});
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'trusted-auth-id'},{status:options.authStatus||200});
  if(url.includes('/users?'))return Response.json(options.profiles||[{username:'trusted-user',role:options.role||'teknisi',cabang:'Kendari',hak_akses_cabang:options.access||'Kendari'}]);
  if(url.endsWith('/rpc/sla_konfigurasi_gateway_lama'))return Response.json(options.config||{...upstream,apiKey:'private-integration-fixture'});
  if(Object.values(upstream).includes(url)){
   if(options.networkError)throw Error('Private diagnostic must not reach browser: private-integration-fixture');
   return Response.json(options.result||{status:'sukses',terkirim:true});
  }
  throw Error('Unexpected endpoint');
 }});
 vm.runInContext(source,c);
 return {c,calls,run:(payload={},requestOptions={})=>handler(new Request(endpoint,{method:'POST',headers:{Origin:'https://aplikasisla.vercel.app',Authorization:'Bearer verified-test-jwt',...requestOptions.headers},body:JSON.stringify(payload),...requestOptions}))};
}
test('gateway rejects missing or invalid sessions before reading private configuration',async()=>{
 const h=harness();assert.equal((await h.run({action:'relayWA'},{headers:{Authorization:''}})).status,401);assert.equal(h.calls.length,0);
 const invalid=harness({authStatus:401});assert.equal((await invalid.run({action:'relayWA'})).status,401);assert.equal(invalid.calls.length,1);
 const missing=harness({profiles:[]});assert.equal((await missing.run({action:'relayWA'})).status,403);assert.equal(missing.calls.length,2);
 const duplicate=harness({profiles:[{username:'a'},{username:'b'}]});assert.equal((await duplicate.run({action:'relayWA'})).status,403);
});
test('trusted profile controls action and branch; browser cannot elevate its role',async()=>{
 for(const payload of [{action:'broadcastCRM',klien:[{}],role:'admin'},{action:'syncCRM',cabang:'Raha',user:{Role:'direktur'}},{action:'deleteUser'},{action:'toString'}]){
  const h=harness();assert.ok([400,403].includes((await h.run(payload)).status));assert.equal(h.calls.length,2);
 }
 const h=harness({role:'freelance'});assert.equal((await h.run({action:'syncCRM'})).status,403);
});
test('gateway preserves legacy operation payload and binds identity and secret on the server',async()=>{
 for(const branch of ['Kendari','Raha']){
  const h=harness({access:'Semua'}),response=await h.run({action:'syncCRM',cabang:branch,nama:'Pelanggan Contoh',noWa:'0812',apiKey:'browser-forgery',url:'https://evil.test',Authorization:'untrusted',user:{Username:'admin',SessionToken:'forged'}});
  assert.equal(response.status,200);assert.equal((await response.json()).status,'sukses');
  const call=h.calls.at(-1),data=JSON.parse(call.body);
  assert.equal(call.url,upstream[branch]);assert.equal(data.cabang,branch);assert.equal(data.nama,'Pelanggan Contoh');assert.equal(data.apiKey,'private-integration-fixture');
  assert.deepEqual(data.user,{Username:'trusted-user',SessionToken:'verified-test-jwt'});assert.equal('url' in data,false);assert.equal('Authorization' in data,false);
  assert.equal(h.calls[1].headers.apikey,'private-service');assert.match(h.calls[1].url,/auth_id=eq.trusted-auth-id/);
 }
});
test('broadcast limit, trusted upstream host, and private provider errors are enforced',async()=>{
 for(const klien of [[],Array.from({length:51},()=>({})),null]){
  const h=harness({role:'admin'});assert.equal((await h.run({action:'broadcastCRM',klien})).status,400);assert.equal(h.calls.length,2);
 }
 const bad=harness({config:{Kendari:'https://evil.test',apiKey:'private-integration-fixture'}});assert.equal((await bad.run({action:'relayWA'})).status,503);assert.equal(bad.calls.length,3);
 const offline=harness({networkError:true});const response=await offline.run({action:'laporBug'});assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private-integration-fixture|Private diagnostic/);
});
test('operation results retain broadcast details while stripping nested credentials',async()=>{
 const h=harness({role:'admin',result:{status:'sebagian',terkirim:2,daftarGagal:[{nama:'Contoh',noWa:'0812',SessionToken:'hidden'}],apiKey:'hidden',metadata:{secret:'hidden',count:3}}});
 const response=await h.run({action:'broadcastCRM',klien:[{nama:'Contoh',noWa:'0812'}],pesan:'Fixture only'});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'sebagian',terkirim:2,daftarGagal:[{nama:'Contoh',noWa:'0812'}],metadata:{count:3}});
});
test('unknown origins and non-POST methods cannot invoke the provider',async()=>{
 const h=harness();assert.equal((await h.run({}, {headers:{Origin:'https://evil.test'}})).status,403);assert.equal(h.calls.length,0);
 assert.equal((await h.run({}, {method:'OPTIONS',body:undefined})).status,204);assert.equal((await h.run({}, {method:'GET',body:undefined})).status,405);assert.equal(h.calls.length,0);
});
test('Vault configuration RPC is available only to service role with pinned search path',()=>{
 const sql=fs.readFileSync(__dirname+'/../maintenance/legacy-gateway.sql','utf8');
 assert.match(sql,/security definer/i);assert.match(sql,/set search_path=pg_catalog,vault/i);
 assert.match(sql,/revoke all on function public\.sla_konfigurasi_gateway_lama\(\) from public,anon,authenticated/i);
 assert.match(sql,/grant execute on function public\.sla_konfigurasi_gateway_lama\(\) to service_role/i);
 assert.doesNotMatch(sql,/create_secret|update_secret/i);
});
test('frontend routes operational actions through authenticated gateway and retains specialized APIs',async()=>{
 const html=fs.readFileSync(__dirname+'/../index.html','utf8');
 const fn=html.match(/^([ \t]*)async function kirimKeBackend_\([^]*?^\1\}/m)[0];
 const calls=[],c=vm.createContext({AbortController,setTimeout,clearTimeout,SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'public-test',API_URL_CABANG:upstream,cabangAktif:'Kendari',penggunaAktif:{Username:'trusted-user',SessionToken:'expired-before-refresh'},pastikanTokenSupabaseAktif_:async()=>'refreshed-test-jwt',kirimProfilSupabase_:async action=>({route:'profile',action}),kirimKlaimSalesSupabase_:async action=>({route:'sales',action}),fetch:async(url,init)=>{calls.push({url,...init});return Response.json({status:'sukses'});}});
 vm.runInContext(fn,c);
 for(const action of ['relayWA','laporBug','syncCRM','broadcastCRM'])await c.kirimKeBackend_(upstream.Raha,action,{pesan:'Fixture only'});
 assert.equal(calls.length,4);
 for(const call of calls){assert.equal(call.url,endpoint);assert.equal(call.headers.Authorization,'Bearer refreshed-test-jwt');assert.equal(JSON.parse(call.body).cabang,'Raha');assert.equal('apiKey' in JSON.parse(call.body),false);}
 assert.equal((await c.kirimKeBackend_(upstream.Kendari,'validateSession')).route,'profile');assert.equal((await c.kirimKeBackend_(upstream.Kendari,'ajukanBanding')).route,'sales');
 c.penggunaAktif=null;await assert.rejects(c.kirimKeBackend_(upstream.Kendari,'relayWA'),/Sesi tidak tersedia/);assert.equal(calls.length,4);
 for(const filename of ['index.html','absen.html'])assert.equal(/\bAPI_KEY\b/.test(fs.readFileSync(__dirname+'/../'+filename,'utf8')),false,filename+' must have no legacy key references');
});
