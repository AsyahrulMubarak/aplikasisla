const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(__dirname+'/../supabase/functions/sla-payroll-attendance/index.ts','utf8');
const frontend=fs.readFileSync(__dirname+'/../index.html','utf8');
const photo='data:image/jpeg;base64,'+'A'.repeat(100);
const event={id:'notice',klaim_id:'claim',lease_id:'lease',jenis:'Diajukan',penerima_username:'admin',snapshot:{id_tiket:'TKR-1',cabang:'Raha',sales:'Sales',alasan:'Bukti kurang'}};
function harness({role='admin',access='Kendari',events=[],provider=true,phone='081234567890',busy=false,ackFails=false}={}) {
 const calls=[],sends=[],waits=[],acks=[];let handler;
 const c=vm.createContext({console,Response,Request,URLSearchParams,AbortSignal,Date,Intl,crypto,Number,
  setTimeout:(fn,ms)=>{waits.push(ms);fn();},
  Deno:{env:{get:n=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'server',SUPABASE_ANON_KEY:'public',FONNTE_TOKEN:'token'})[n]},serve:fn=>handler=fn},
  fetch:async(url,o={})=>{
   const body=o.body&&String(o.body).startsWith('{')?JSON.parse(o.body):{};calls.push({url,...o,data:body});
   if(url.includes('/auth/v1/user'))return Response.json({id:'verified-auth',email:'admin@alfacom.local'});
   if(url.includes('sla_gaji_program?'))return Response.json([],{status:o.headers.apikey==='sb_secret_job'?200:403});
   if(url.includes('sla_profile_lock_active')||url.includes('sla_claims_edge_active'))return Response.json(true);
   if(url.includes('sla_mulai_pengiriman_klaim_sales'))return Response.json(busy?null:'sender');
   if(url.includes('sla_akhiri_pengiriman_klaim_sales'))return Response.json(true);
   if(url.includes('sla_ambil_notif_klaim_sales'))return Response.json(events.length?[events.shift()]:[]);
   if(url.includes('sla_selesaikan_notif_klaim_sales')){acks.push(body);if(ackFails)throw Error('Ack failed');return Response.json(true);}
   if(url.includes('sla_notif_klaim_sales?'))return Response.json(provider?[]:[{id:'pending'}]);
   if(url.includes('sla_ajukan_klaim_sales')||url.includes('sla_respon_klaim_sales'))return Response.json({klaim_id:'claim',status:body.p_keputusan||'Diajukan'});
   if(url.includes('/users?'))return Response.json([{username:'admin',nama_asli:'Admin',role,hak_akses_cabang:access,cabang:'Kendari',gaji_pokok:0,no_wa:phone,auth_id:'verified-auth',username_login:'admin'}]);
   if(url.includes('/tiket?'))return Response.json([{id_tiket:'TKR-1',cabang:'Raha',status_banding:'Ditolak',bukti_banding:photo}]);
   if(url.includes('api.fonnte.com')){sends.push(new URLSearchParams(o.body));return Response.json({status:provider});}
   throw Error('Unexpected call '+url);
  }});
 vm.runInContext(source,c);return {c,handler,calls,sends,waits,acks};
}
const actor={username:'Admin',role:'admin',access:'Semua',branch:'Kendari',authId:'verified-auth'};

test('Supabase owns all four claim actions; disallowed roles cannot list, view proof or decide',async()=>{
 for(const u of [{...actor,role:'sales'},{...actor,role:'admin_raha'},{...actor,access:'Raha'}]){
  const h=harness();for(const action of ['getKlaimSales','getBuktiKlaimSales','responBanding'])await assert.rejects(h.c.dispatch({action,idTiket:'TKR-1',cabang:'Raha'},u),/Admin Kendari/);
  assert.equal(h.calls.length,0);
 }
 const h=harness();const result=await h.c.dispatch({action:'getKlaimSales'},actor);assert.equal(result.data.length,1);
 const ticketCall=h.calls.find(x=>x.url.includes('/tiket?'));assert.ok(!ticketCall.url.includes('bukti_banding'));assert.ok(ticketCall.url.includes('cabang.eq.Raha'));assert.equal(h.sends.length,0);
 assert.ok(h.calls.every(x=>!x.url.includes('script.google')));
});

test('Verified actor replaces browser identity and evidence stays lazy and branch scoped',async()=>{
 const h=harness();const result=await h.c.dispatch({action:'getBuktiKlaimSales',idTiket:'TKR-1',cabang:'Raha'},actor);assert.equal(result.data,photo);
 assert.ok(h.calls.find(x=>x.url.includes('/tiket?')).url.includes('cabang=eq.Raha'));
 await h.c.dispatch({action:'responBanding',idTiket:'TKR-1',cabang:'Raha',statusBanding:'Diterima',p_actor:'forged',no_wa:'089999999999'},actor);
 const call=h.calls.find(x=>x.url.includes('sla_respon_klaim_sales'));assert.equal(call.data.p_actor,'admin');assert.equal(call.headers['x-sla-claims-runtime'],'supabase-edge');
});

test('Manager and Director can list, read evidence and decide within their stored branch access',async()=>{
 for(const role of ['manager','direktur'])for(const access of ['Semua','Raha','Kendari']){
  const h=harness({role,access}),u={...actor,role,access,branch:access==='Raha'?'Raha':'Kendari'};
  await h.c.dispatch({action:'getKlaimSales',cabang:'Semua',user:{Role:'admin'}},u);
  const read=h.calls.find(x=>x.url.includes('/tiket?'));
  assert.equal(read.url.includes('cabang.eq.Raha'),access==='Semua');
  assert.equal(read.url.includes('cabang.is.null'),access!=='Raha');
  assert.equal(read.url.includes('cabang=eq.Raha'),access==='Raha');
  const target=access==='Kendari'?'Kendari':'Raha';
  await h.c.dispatch({action:'getBuktiKlaimSales',idTiket:'TKR-1',cabang:target},u);
  for(const statusBanding of ['Diterima','Ditolak'])await h.c.dispatch({action:'responBanding',idTiket:'TKR-1',cabang:target,statusBanding,alasanAdmin:'Alasan contoh',p_actor:'forged'},u);
  assert.equal(h.calls.filter(x=>x.url.includes('sla_respon_klaim_sales')).length,2);
  assert.ok(h.calls.filter(x=>x.url.includes('sla_respon_klaim_sales')).every(x=>x.data.p_actor==='admin'));
  if(access!=='Semua'){
   const before=h.calls.length;
   for(const action of ['getBuktiKlaimSales','responBanding'])await assert.rejects(h.c.dispatch({action,idTiket:'TKR-1',cabang:target==='Raha'?'Kendari':'Raha',statusBanding:'Diterima'},u),/hak akses/);
   assert.equal(h.calls.length,before+2); // Only the runtime migration check precedes the branch denial.
  }
  await assert.rejects(h.c.dispatch({action:'ajukanBanding',idTiket:'TKR-1',cabang:target,buktiBanding:photo},u),/khusus Sales/);
 }
});

test('Current JWT determines management claim role and forged branch access cannot elevate the profile',async()=>{
 for(const role of ['manager','direktur']){
  const h=harness({role,access:'Semua'});
  const response=await h.handler(new Request('https://edge.test',{method:'POST',headers:{'Content-Type':'application/json',authorization:'Bearer one.two.three'},body:JSON.stringify({action:'responBanding',idTiket:'TKR-1',cabang:'Raha',statusBanding:'Diterima',user:{Username:'forged',Role:'sales'}})}));
  assert.equal(response.status,200);assert.equal(h.calls.find(x=>x.url.includes('sla_respon_klaim_sales')).data.p_actor,'admin');
 }
 const h=harness({role:'manager',access:'Kendari'});
 const response=await h.handler(new Request('https://edge.test',{method:'POST',headers:{'Content-Type':'application/json',authorization:'Bearer one.two.three'},body:JSON.stringify({action:'responBanding',idTiket:'TKR-1',cabang:'Raha',statusBanding:'Diterima',Hak_Akses_Cabang:'Semua'} )}));
 assert.equal((await response.json()).status,'gagal');assert.ok(!h.calls.some(x=>x.url.includes('sla_respon_klaim_sales')));
});

test('Invalid evidence, roles, branch and rejection reasons never mutate claims',async()=>{
 for(const body of [{action:'ajukanBanding',buktiBanding:'https://wrong.test'},
  {action:'ajukanBanding',buktiBanding:Array(4).fill(photo).join('|#|')},
  {action:'responBanding',statusBanding:'Ditolak',alasanAdmin:' '},{action:'responBanding',statusBanding:'Fake'},{action:'responBanding',cabang:'Unknown'}]){
  const h=harness();await assert.rejects(h.c.dispatch({idTiket:'TKR-1',cabang:'Raha',...body},body.action==='ajukanBanding'?{...actor,role:'sales'}:actor));
  assert.ok(!h.calls.some(x=>/sla_(ajukan|respon)_klaim_sales/.test(x.url)));
 }
});

test('Notification delivery is serial, waits 2 seconds and uses stored recipient phones',async()=>{
 const h=harness({events:[{...event}, {...event,id:'notice2'}]});
 await h.c.dispatch({action:'responBanding',idTiket:'TKR-1',cabang:'Raha',statusBanding:'Diterima',no_wa:'089999999999'},actor);
 assert.equal(h.sends.length,2);assert.deepEqual(h.waits,[2000,2000]);assert.ok(h.sends.every(s=>s.get('target')==='6281234567890'&&s.get('delay')==='2'));
 assert.ok(h.acks.every(a=>a.p_terkirim===true));assert.ok(h.calls.some(x=>x.url.includes('sla_akhiri_pengiriman_klaim_sales')));
});

test('Provider failure, busy lease and missing phone keep saved claims queued',async()=>{
 for(const opts of [{provider:false,events:[{...event}]},{busy:true,events:[{...event}]},{phone:'',events:[{...event}]}]){
  const h=harness(opts),r=await h.c.dispatch({action:'ajukanBanding',idTiket:'TKR-1',cabang:'Raha',buktiBanding:photo},{...actor,role:'sales'});
  assert.equal(r.status,'sukses');assert.equal(r.klaim.klaim_id,'claim');assert.ok(r.notifikasi.tertunda||r.notifikasi.gagal);
 }
 const h=harness({ackFails:true,events:[{...event}]});
 const result=await h.c.dispatch({action:'responBanding',idTiket:'TKR-1',cabang:'Raha',statusBanding:'Diterima'},actor);
 assert.equal(result.status,'sukses');assert.equal(result.notifikasi.tertunda,true);
 assert.ok(h.calls.some(x=>x.url.includes('sla_akhiri_pengiriman_klaim_sales')));
});

test('Cron rejects public/user credentials and only server credentials can drain the queue',async()=>{
 const h=harness();
 const request=key=>new Request('https://edge.test',{method:'POST',headers:{'Content-Type':'application/json','x-sla-job-key':key},body:JSON.stringify({action:'prosesNotifKlaimSales'})});
 for(const key of ['', 'sb_publishable_fake'])assert.equal((await h.handler(request(key))).status,403);
 assert.ok(!h.calls.some(x=>x.url.includes('sla_mulai_pengiriman_klaim_sales')));
 const result=await h.handler(request('sb_secret_job'));assert.equal(result.status,200);assert.equal((await result.json()).status,'sukses');
});

test('HTTP handler authenticates a current JWT before honouring forged claim identity',async()=>{
 const h=harness();
 const call=authorization=>h.handler(new Request('https://edge.test',{method:'POST',headers:{'Content-Type':'application/json',authorization},body:JSON.stringify({action:'responBanding',idTiket:'TKR-1',cabang:'Raha',statusBanding:'Diterima',user:{Username:'forged'}})}));
 assert.equal((await call('')).status,401);assert.equal(h.calls.length,0);
 assert.equal((await call('Bearer one.two.three')).status,200);
 assert.equal(h.calls.find(x=>x.url.includes('sla_respon_klaim_sales')).data.p_actor,'admin');
});

test('Frontend routes all claims directly to Supabase and retries only after expired authentication',async()=>{
 const extract=name=>{const m=frontend.match(new RegExp('^([ \\t]*)(?:async )?function '+name+'\\([^]*?^\\1\\}','m'));assert.ok(m,name);return m[0];};
 const calls=[];let refresh=0;
 const c=vm.createContext({SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'public',AbortSignal,
  pastikanTokenSupabaseAktif_:async force=>{if(force)refresh++;return 'verified-token';},
  fetch:async(url,o)=>{calls.push({url,...o});return calls.length===1?Response.json({status:'gagal'},{status:401}):Response.json({status:'sukses'});}});
 vm.runInContext(extract('kirimKlaimSalesSupabase_'),c);
 await c.kirimKlaimSalesSupabase_('getKlaimSales');assert.equal(refresh,1);assert.equal(calls.length,2);
 assert.ok(calls.every(call=>call.url==='https://db.test/functions/v1/sla-payroll-attendance'&&call.headers.Authorization==='Bearer verified-token'));
 assert.match(extract('kirimKeBackend_'),/return kirimKlaimSalesSupabase_\(action, payload\)/);
});
