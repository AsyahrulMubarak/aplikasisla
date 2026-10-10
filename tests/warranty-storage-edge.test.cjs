const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../supabase/functions/sla-warranty-storage/index.ts','utf8');
function harness(mode='ok',providerEnv={FONNTE_TOKEN:'provider'}){
 const calls=[],acks=[];let handler;const ready=new Date(Date.now()-5*86400000).toISOString();
 const c=vm.createContext({Date,Intl,Response,Request,AbortSignal,URLSearchParams,encodeURIComponent,console,
 Deno:{env:{get:n=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'server',...providerEnv})[n]},serve:fn=>handler=fn},
 fetch:async(url,o={})=>{
  calls.push({url,...o});const body=o.body&&String(o.body).startsWith('{')?JSON.parse(o.body):null;
  if(url.includes('sla_perbarui_penitipan'))return Response.json(1);
  if(url.includes('sla_ambil_notif_penitipan'))return Response.json([{id:'E-1',lease:'L-1',id_garansi:'G-1'}]);
  if(url.includes('sla_selesai_notif_penitipan')){acks.push(body);return Response.json(true);}
  if(url.includes('/garansi?'))return Response.json([{id_garansi:'G-1',referensi_tiket_nota:'TKT-1',cabang:'Raha',status:'Masa Tunggu',waktu_siap_diambil:ready,waktu_diambil:mode==='picked'?new Date().toISOString():null}]);
  if(url.includes('/tiket?'))return Response.json([{no_wa_klien:'081234567890',jenis_pekerjaan:'Printer'}]);
  if(url.includes('api.fonnte.com'))return Response.json({status:mode!=='fail'});
  throw Error('Unexpected request');
 }});vm.runInContext(source,c);return {c,calls,acks,handler};
}
test('day-five reminder carries forfeiture and day-eight fee; acknowledgment follows provider acceptance',async()=>{
 const {c,calls,acks}=harness();const r=await c.processStorage();assert.equal(r.terkirim,1);assert.equal(acks[0].p_sukses,true);
 const sent=calls.find(x=>x.url.includes('api.fonnte.com'));assert.match(String(sent.body.get('message')),/garansi otomatis hangus/);assert.match(String(sent.body.get('message')),/hari ke-8/);
});
test('failed provider delivery is retryable and pickup cancels the reminder',async()=>{
 const failure=harness('fail');assert.equal((await failure.c.processStorage()).gagal,1);assert.equal(failure.acks[0].p_sukses,false);
 const picked=harness('picked');assert.equal((await picked.c.processStorage()).dilewati,1);assert.ok(!picked.calls.some(x=>x.url.includes('fonnte')));
});
test('scheduled work cannot be triggered by an unauthenticated browser',async()=>{
 const {handler,calls}=harness();const r=await handler(new Request('https://db.test',{method:'POST',body:'{}'}));assert.equal(r.status,403);assert.equal(calls.length,0);
});
test('reminder uses the existing backup provider configuration',async()=>{
 const {c,calls}=harness('ok',{FONNTE_TOKEN_CADANGAN:'backup-provider'});
 assert.equal((await c.processStorage()).terkirim,1);
 assert.equal(calls.find(x=>x.url.includes('api.fonnte.com')).headers.Authorization,'backup-provider');
});
test('missing provider configuration leaves notification events available for a later retry',async()=>{
 const {c,calls,acks}=harness('ok',{});
 assert.equal((await c.processStorage()).notifikasiTertunda,true);
 assert.ok(calls.some(x=>x.url.includes('sla_perbarui_penitipan')));
 assert.ok(!calls.some(x=>x.url.includes('sla_ambil_notif_penitipan')));
 assert.equal(acks.length,0);
});
