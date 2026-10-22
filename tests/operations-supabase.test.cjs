const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto').webcrypto;
const dir=__dirname+'/../supabase/functions/sla-operations/';
const rules=fs.readFileSync(dir+'reminders.ts','utf8').replaceAll('export ','');
function ruleContext(){const c=vm.createContext({Date,Set,Map});vm.runInContext(rules,c);return c;}
const user=(role='teknisi',branch='Kendari')=>({username:'fixture',nama_asli:'Teknisi Contoh',role,no_wa:'081234567890',cabang:branch,hak_akses_cabang:branch,account_active:true});
const ticket=(branch='Kendari')=>({id_tiket:'TKT-FIXTURE',status:'On Progress',teknisi:'Teknisi Contoh',cabang:branch,waktu_lapor:'2026-10-19T08:00:00+08:00',waktu_penugasan:'2026-10-19T08:00:00+08:00',tenggat_respon:'2026-10-22T10:00:00+08:00',tenggat_waktu:'2026-10-22T11:00:00+08:00',no_wa_klien:'081234567899'});
test('work hours preserve both branches, prayer breaks, Sunday and exact boundaries',()=>{
 const c=ruleContext();assert.equal(c.workHours('2026-10-22T08:00:00+08:00','2026-10-22T20:00:00+08:00','Kendari'),6.5);assert.equal(c.workHours('2026-10-22T08:00:00+08:00','2026-10-22T20:00:00+08:00','Raha'),9.5);
 assert.equal(c.workHours('2026-10-25T08:00:00+08:00','2026-10-25T20:00:00+08:00','Raha'),0);assert.equal(c.workHours('2026-10-22T12:00:00+08:00','2026-10-22T13:30:00+08:00','Raha'),0);
 assert.equal(c.workHours('2026-10-22T09:45:00+08:00','2026-10-22T10:00:00+08:00','Kendari'),0.25);
});
test('ticket reminders operate for Kendari and Raha and suppress closed/pending/outsource/cancel',()=>{
 const c=ruleContext();for(const b of ['Kendari','Raha']){assert.equal(c.ticketReminders([ticket(b)],[user('teknisi',b)],[],new Date('2026-10-22T09:50:00+08:00')).length,2);for(const status of ['Pending','Outsource','Cancel'])assert.equal(c.ticketReminders([{...ticket(b),status}],[user('teknisi',b)],[],new Date('2026-10-22T09:50:00+08:00')).length,0);}
});
test('response reminder stops after a response; old successful markers prevent repeats',()=>{
 const c=ruleContext(),t={...ticket(),waktu_respon:'2026-10-22T09:00:00+08:00',status_peringatan:'[PENGERJAAN_WARNED]'};
 assert.equal(c.ticketReminders([t],[user()],[],new Date('2026-10-22T09:50:00+08:00')).length,0);
});
test('unassigned escalation reaches only active branch admins/managers',()=>{
 const c=ruleContext(),t={...ticket('Raha'),status:'Menunggu',teknisi:'-',waktu_lapor:'2026-10-10T08:00:00+08:00'};
 const users=[user('admin_raha','Raha'),{...user('manager','Kendari'),no_wa:'081234567891'}, {...user('manager','Raha'),no_wa:'081234567892'}];
 const events=c.ticketReminders([t],users,[],new Date('2026-10-22T09:00:00+08:00'));assert.equal(events.length,2);assert.equal(events[1].messages[0].phone,'6281234567892');
});
test('completed tickets need a note reminder only when no same-branch warranty exists',()=>{
 const c=ruleContext(),t={...ticket(),status:'Selesai',waktu_selesai:'2026-10-19T08:00:00+08:00'};assert.equal(c.ticketReminders([t],[user('admin')],[],new Date('2026-10-22T09:00:00+08:00')).length,1);assert.equal(c.ticketReminders([t],[user('admin')],[{referensi_tiket_nota:t.id_tiket,cabang:'Kendari'}],new Date('2026-10-22T09:00:00+08:00')).length,0);
});
const prospect={id_prospek:'PRP-FIXTURE',tanggal_input:'2026-10-19T10:00:00+08:00',status_prospek:'Tahap Penawaran',sales_penanggung_jawab:'Teknisi Contoh',cabang:'Raha'};
test('prospect reminders repeat every three calendar days and deduplicate each WITA date',()=>{
 const c=ruleContext(),now=new Date('2026-10-22T07:00:00+08:00');assert.equal(c.prospectReminders([prospect],[user('sales','Raha')],now).length,1);assert.equal(c.prospectReminders([{...prospect,waktu_peringatan_crm_terakhir:now.toISOString()}],[user()],now).length,0);assert.equal(c.prospectReminders([prospect],[user()],new Date('2026-10-23T07:00:00+08:00')).length,0);
});
test('prospect reminder respects new followup, valid legacy history and terminal statuses',()=>{
 const c=ruleContext();for(const status of ['Closing / Deal','Batal','Tanpa Keterangan','On Progress','Proses Servis','Pending'])assert.equal(c.prospectReminders([{...prospect,status_prospek:status}],[user()],new Date('2026-10-22T07:00:00+08:00')).length,0);
 assert.equal(c.lastFollowUp({...prospect,riwayat_follow_up:'[21/10/2026] Hubungi pelanggan'}),'2026-10-20T16:00:00.000Z');assert.equal(c.lastFollowUp({...prospect,riwayat_follow_up:'[32/13/2026] Tidak valid'}),prospect.tanggal_input);
});
test('30 day expiry remains transactional even without a recipient',()=>{const c=ruleContext(),e=c.prospectReminders([{...prospect,tanggal_input:'2026-09-01T08:00:00+08:00'}],[],new Date('2026-10-22T07:00:00+08:00'));assert.equal(e[0].kind,'prospect_expired');assert.equal(e[0].messages.length,0);});
test('after-sales follows 7→5, 30→7 and 90–365→30 day rules and skips claimed/expired',()=>{
 const c=ruleContext();for(const [duration,days]of [[7,5],[30,7],[90,30],[365,30]]){const now=new Date('2026-10-22T09:00:00+08:00'),t={...ticket('Raha'),status:'Selesai',waktu_selesai:new Date(now-days*86400000).toISOString()},w={id_garansi:'GRS-FIXTURE',referensi_tiket_nota:t.id_tiket,cabang:'Raha',durasi_hari:duration,status:'Aktif'};assert.equal(c.warrantyReminders([w],[t],now).length,1);for(const status of ['Diklaim','Habis','Hangus'])assert.equal(c.warrantyReminders([{...w,status}],[t],now).length,0);assert.equal(c.warrantyReminders([{...w,follow_up_after_sales_terkirim:'HARI_'+days}],[t],now).length,0);}
});
test('storage reminders cover both branches at days 5 and 28 and expire at 31; prior GAS/Supabase sends suppress duplicates',()=>{
 const c=ruleContext(),now=new Date('2026-10-22T09:00:00+08:00');
 for(const branch of ['Kendari','Raha'])for(const age of [5,28,31]){
  const ready=new Date(now-age*86400000).toISOString(),t={...ticket(branch),status:'Selesai',waktu_selesai:ready},w={id_garansi:'GRS-FIXTURE',referensi_tiket_nota:t.id_tiket,cabang:branch,status:'Belum Diambil',waktu_siap_diambil:ready};
  const e=c.storageReminders([w],[t],[],now);assert.equal(e.length,1);assert.equal(e[0].kind,age===31?'storage_expired':'storage_reminder');
  if(age===5){assert.equal(c.storageReminders([w],[t],[{id_garansi:w.id_garansi,terkirim_pada:now.toISOString()}],now).length,0);assert.equal(c.storageReminders([{...w,riwayat_follow_up:'[PENITIPAN_H5:DIANTREKAN 21/10/2026]'}],[t],[],now).length,0);}
  if(age===28)assert.equal(c.storageReminders([{...w,riwayat_follow_up:'[PENITIPAN_H28:DIPROSES 21/10/2026]'}],[t],[],now).length,0);
  assert.equal(c.storageReminders([{...w,waktu_diambil:now.toISOString()}],[t],[],now).length,0);
 }
});
function harness(options={}){
 const calls=[];let handler;const state={outcome:options.state||'sent'};
 const RuntimeDate=options.now?class extends Date{constructor(...args){super(...(args.length?args:[options.now]));}static now(){return new Date(options.now).getTime();}}:Date;
 const context=vm.createContext({Date:RuntimeDate,Request,Response,AbortSignal,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,atob,crypto,console:{...console,error(){}},
 Deno:{env:{get:key=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fixture',SUPABASE_ANON_KEY:'public_fixture',FONNTE_TOKEN:'fixture_provider'})[key]},serve:fn=>handler=fn},
 fetch:async(url,init={})=>{
  calls.push({url,...init});const p=init.body&&typeof init.body==='string'?JSON.parse(init.body):{};
  if(url.includes('/sla_ops_control?'))return Response.json([{enabled:true}]);
  if(url.endsWith('/rpc/sla_ops_snapshot'))return Response.json(options.snapshot);
  if(url.endsWith('/rpc/sla_perbarui_penitipan'))return Response.json(0);
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'auth-fixture'},{status:options.authStatus||200});
  if(url.endsWith('/rpc/sla_assert_account_session'))return Response.json(!options.revoked);
  if(url.includes('/users?'))return Response.json([user(options.role||'teknisi',options.branch||'Kendari')]);
  if(url.endsWith('/rpc/sla_ops_recipient_allowed'))return Response.json(options.recipient!==false);
  if(url.endsWith('/rpc/sla_ops_enqueue'))return Response.json([{id:'event-fixture',state:'pending'}]);
  if(url.endsWith('/rpc/sla_ops_lease'))return Response.json([{id:'event-fixture',lease:'lease-fixture',cabang:options.branch||'Kendari',phone:'6281234567890',message:'Fixture',guard:{}}]);
  if(url.endsWith('/rpc/sla_ops_guard_valid'))return Response.json(!options.obsolete);
  if(url==='https://api.fonnte.com/send'){if(options.timeout)throw Error('private provider failure');return Response.json({status:!options.rejected,id:['fixture-id']});}
  if(url.endsWith('/rpc/sla_ops_ack')){state.outcome=p.p_outcome;return Response.json(true);}
  if(url.includes('/sla_ops_outbox?'))return Response.json([{state:state.outcome}]);
  throw Error('Unexpected URL '+url);
 }});
 vm.runInContext(rules+'\n'+fs.readFileSync(dir+'index.ts','utf8').replace(/^import .*;\r?\n/m,''),context);
 return {calls,state,run:(p,headers={})=>handler(new Request('https://db.test/functions/v1/sla-operations',{method:'POST',headers:{Origin:'https://aplikasisla.vercel.app',Authorization:'Bearer fixture.jwt.token',...headers},body:JSON.stringify(p)}))};
}
const relay={action:'relayWA',nomorTujuan:'081234567890',pesan:'Fixture only',requestId:'fixture-request-123'};
test('active auth session is mandatory before any operation, including forged JWT identity',async()=>{
 const h=harness();assert.equal((await h.run(relay,{Authorization:''})).status,401);assert.equal(h.calls.length,0);
 for(const options of [{authStatus:401},{revoked:true}]){const h=harness(options);assert.equal((await h.run({...relay,user:{Role:'admin'}})).status,401);assert.equal(h.calls.some(c=>c.url.includes('sla_ops_enqueue')),false);}
});
test('branch and action authorization cannot be overridden by payload',async()=>{
 for(const [o,p]of [[{role:'teknisi'},{...relay,cabang:'Raha'}],[{role:'logistik'},relay],[{role:'sales'},{action:'syncCRM'}],[{role:'admin_raha',branch:'Raha'},{...relay,cabang:'Kendari'}]]){const h=harness(o);assert.equal((await h.run(p)).status,403);assert.equal(h.calls.some(c=>c.url.includes('sla_ops_enqueue')),false);}
});
test('both branches relay only through Supabase queue and Fonnte; credentials stay server-side',async()=>{
 for(const branch of ['Kendari','Raha']){const h=harness({branch}),r=await h.run({...relay,cabang:branch});assert.equal(r.status,200);assert.equal((await r.json()).terkirim,true);assert.equal(h.state.outcome,'sent');assert.equal(h.calls.some(c=>/google|gateway_lama/.test(c.url)),false);}
});
test('invalid recipient is denied; stale reminders never reach provider',async()=>{
 const denied=harness({recipient:false});assert.equal((await denied.run(relay)).status,403);const stale=harness({obsolete:true});await stale.run(relay);assert.equal(stale.state.outcome,'obsolete');assert.equal(stale.calls.some(c=>c.url.includes('fonnte')),false);
});
test('provider rejection retries; ambiguous transport failures require review rather than duplicate resend',async()=>{
 for(const [opts,outcome]of [[{rejected:true},'retry'],[{timeout:true},'uncertain']]){const h=harness(opts);await h.run(relay);assert.equal(h.state.outcome,outcome);}
});
test('invalid bug image and scheduler request cannot create records or send messages',async()=>{
 const h=harness({role:'admin'});assert.equal((await h.run({action:'laporBug',deskripsi:'Fixture',buktiBug:'data:image/png;base64,YWJj',requestId:'fixture-request-123'})).status,400);assert.equal((await h.run({action:'scanTickets'})).status,401);assert.equal(h.calls.some(c=>c.url.includes('sla_ops_enqueue')),false);
});
test('hostile origin and non-object payload are rejected before authentication',async()=>{const h=harness();assert.equal((await h.run(relay,{Origin:'https://evil.test'})).status,403);assert.equal((await h.run([])).status,400);assert.equal(h.calls.length,0);});
test('all four scheduler actions enqueue eligible Kendari and Raha records through the deployed HTTP handler',async()=>{
 for(const action of ['scanTickets','scanProspects','scanWarranty','scanStorage']){
  const tickets=['Kendari','Raha'].map(b=>({...ticket(b),...(action==='scanWarranty'||action==='scanStorage'?{status:'Selesai',waktu_selesai:'2026-10-17T09:00:00+08:00'}:{})}));
  const snapshot={tickets,users:[user(),{...user('teknisi','Raha'),no_wa:'081234567891'}],warranties:['Kendari','Raha'].map(b=>({id_garansi:'GRS-'+b,referensi_tiket_nota:'TKT-FIXTURE',cabang:b,status:action==='scanStorage'?'Belum Diambil':'Aktif',waktu_siap_diambil:'2026-10-17T09:00:00+08:00',durasi_hari:7})),prospects:['Kendari','Raha'].map(b=>({...prospect,id_prospek:'PRP-'+b,cabang:b})),previous:[]};
  const h=harness({snapshot,now:'2026-10-22T09:50:00+08:00'}),response=await h.run({action},{'x-sla-job-key':'sb_secret_fixture'});
  assert.equal(response.status,200,action);assert.equal((await response.json()).status,'sukses');
  const queued=h.calls.filter(c=>c.url.endsWith('/rpc/sla_ops_enqueue')).map(c=>JSON.parse(c.body));assert.deepEqual([...new Set(queued.map(q=>q.p_branch))].sort(),['Kendari','Raha'],action);
  assert.equal(h.calls.some(c=>/google|fonnte/.test(c.url)),false);
 }
});
