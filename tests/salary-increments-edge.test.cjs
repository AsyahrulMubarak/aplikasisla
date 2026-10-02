const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(__dirname+'/../supabase/functions/sla-payroll-attendance/index.ts','utf8');
function harness(mode='ok',profile={}){
 const calls=[],acks=[];let handler;const user={username:'tech',nama_asli:'Teknisi',role:'teknisi',hak_akses_cabang:'Kendari',gaji_pokok:1750000,no_wa:'081234567890',...profile};
 const c=vm.createContext({console,Response,Request,URLSearchParams,AbortSignal,Date,Intl,crypto,Number,
  Deno:{env:{get:n=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'server-only',SUPABASE_ANON_KEY:'public-test',FONNTE_TOKEN:'wa-test'})[n]},serve:fn=>handler=fn},
  fetch:async(url,o={})=>{calls.push({url,...o});const body=o.body&&String(o.body).startsWith('{')?JSON.parse(o.body):{};
   if(url.includes('sla_gaji_program?'))return Response.json([],{status:o.headers.apikey==='sb_secret_test'?200:403});
   if(url.includes('sla_evaluasi_kenaikan_gaji'))return Response.json({status:'sukses',kenaikan:0});
   if(url.includes('sla_ubah_gaji_manual'))return Response.json({status:'sukses',gajiPokok:body.p_gaji_baru});
   if(url.includes('sla_ambil_notif_gaji'))return Response.json(mode==='empty'?[]:[{id:'notice',lease:'lease',username:'tech',no_wa:user.no_wa,pesan:'Gaji naik'}]);
   if(url.includes('sla_selesai_notif_gaji')){acks.push(body);return Response.json(true);}
   if(url.includes('sla_notif_kenaikan_gaji'))return Response.json(mode==='fail'?[{id:'notice'}]:[]);
   if(url.includes('api.fonnte.com'))return Response.json({status:mode!=='fail'});
   if(url.includes('sla_ringkasan_gaji'))return Response.json(body.p_usernames.map(username=>({username,gajiPeriode:1500000,gajiSekarang:1750000,bulanTerkumpul:0})));
   if(url.includes('/users?'))return Response.json([user]);
   if(url.includes('/tiket?')||url.includes('/payroll_bulanan?'))return Response.json([]);
   throw new Error('Unexpected call '+url);
  }});
 vm.runInContext(source,c);return {c,calls,acks,handler};
}
test('Job rejects user/public credentials before performing any salary update',async()=>{
 const {handler,calls}=harness('empty');
 for(const key of ['', 'sb_publishable_fake']){const r=await handler(new Request('https://edge.test',{method:'POST',headers:{'Content-Type':'application/json','x-sla-job-key':key},body:JSON.stringify({action:'prosesKenaikanGajiOtomatis',periode:'1990-01',role:'direktur'})}));assert.equal(r.status,403);}
 assert.ok(!calls.some(x=>x.url.includes('sla_evaluasi')));
 const ok=await handler(new Request('https://edge.test',{method:'POST',headers:{'Content-Type':'application/json','x-sla-job-key':'sb_secret_test'},body:JSON.stringify({action:'prosesKenaikanGajiOtomatis',periode:'1990-01'})}));assert.equal((await ok.json()).status,'sukses');
 assert.equal(calls.filter(x=>x.url.includes('sla_evaluasi'))[0].body,'{}');
});
test('Only management may edit salaries, verified identity replaces forged body identity',async()=>{
 const {c,calls}=harness('empty'),body={action:'ubahGajiPokok',usernameTarget:'tech',gajiLama:1500000,gajiBaru:1750000,alasan:'Prestasi',authId:'forged'};
 for(const role of ['sales','teknisi','admin_raha'])await assert.rejects(c.dispatch(body,{role,branch:'Kendari'}),/hanya/);
 await assert.rejects(c.dispatch(body,{role:'admin',branch:'Raha',homeBranch:'Raha'}),/hanya/);
 for(const role of ['admin','manager','direktur'])assert.equal((await c.dispatch(body,{role,branch:'Kendari',homeBranch:'Kendari',authId:'verified',salary:0})).status,'sukses');
 assert.ok(calls.filter(x=>x.url.includes('sla_ubah_gaji_manual')).every(x=>JSON.parse(x.body).p_auth_id==='verified'));
});
test('Historical payroll uses audited month salary and never the latest raised base',async()=>{
 const {c,calls}=harness('empty');const result=await c.dispatch({action:'getPayrollData',periode:'2026-10',cabang:'Kendari'},{role:'teknisi',name:'Teknisi',branch:'Kendari',salary:1750000,authId:'self'});
 assert.equal(result.users[0]['Gaji Pokok'],1500000);assert.equal(result.users[0]['Gaji Pokok Saat Ini'],1750000);
 assert.deepEqual(JSON.parse(calls.find(x=>x.url.includes('sla_ringkasan')).body).p_usernames,['tech']);
 assert.ok(calls.find(x=>x.url.includes('/users?')).url.includes('auth_id=eq.self'));
});

test('Raha payroll omits the automatic programme while retaining audited salary',async()=>{
 for(const profile of [{hak_akses_cabang:'Raha'},{hak_akses_cabang:'Semua',cabang:'Raha'},{hak_akses_cabang:' raha ',cabang:'Kendari'}]){
  const {c}=harness('empty',profile);
  const result=await c.dispatch({action:'getPayrollData',periode:'2026-10',cabang:'Raha'},{role:'teknisi',name:'Teknisi',branch:'Raha',salary:1750000,authId:'self'});
  assert.equal(result.users[0]['Program Gaji'],null);
  assert.equal(result.users[0]['Gaji Pokok'],1500000);
  assert.equal(result.users[0]['Gaji Pokok Saat Ini'],1750000);
 }
 const {c}=harness('empty');
 const result=await c.dispatch({action:'getPayrollData',periode:'2026-10',cabang:'Raha'},{role:'direktur',name:'Direktur',branch:'Raha',access:'Semua'});
 assert.ok(result.users[0]['Program Gaji'],'Eligibility follows the employee profile, including management viewing another branch');
});

test('Payroll excludes employees without a current base salary even with historical programme data',async()=>{
 for(const salary of [0,null,'0']){
  const {c}=harness('empty',{gaji_pokok:salary});
  const result=await c.dispatch({action:'getPayrollData',periode:'2026-10',cabang:'Kendari'},{role:'direktur',name:'Direktur',branch:'Kendari',access:'Semua'});
  assert.equal(result.users[0]['Program Gaji'],null);
  assert.equal(result.users[0]['Gaji Pokok'],1500000,'Historical salary remains available');
 }
 const {c}=harness('empty',{gaji_pokok:3000000});
 assert.equal(c.salaryProgramApplies({hak_akses_cabang:'Kendari',gaji_pokok:3000000}),true,'Salaried employees at the cap keep their completed programme');
});
test('WA targets stored employee phone, provider failure does not undo salary and remains queued',async()=>{
 for(const mode of ['ok','fail']){const {c,calls,acks}=harness(mode);const r=await c.changeSalary({usernameTarget:'tech',gajiLama:1500000,gajiBaru:1750000,alasan:'Prestasi',no_wa:'089999999999'},{role:'manager',branch:'Kendari',authId:'verified'});
 assert.equal(r.status,'sukses');assert.equal(r.notifikasiTertunda,mode==='fail'?1:0);assert.equal(acks[0].p_sukses,mode!=='fail');
 assert.equal(new URLSearchParams(calls.find(x=>x.url.includes('api.fonnte')).body).get('target'),'6281234567890');}
});
test('Ordinary profile edits cannot overwrite a concurrent automatic salary raise',async()=>{
 const {c,calls}=harness('empty'),actor={role:'admin',username:'admin',branch:'Kendari',access:'Semua',authId:'verified'};
 const profil={username:'tech',nama_asli:'Teknisi',role:'teknisi',hak_akses_cabang:'Kendari',gaji_pokok:1500000,target_sales_rp:0};
 await assert.rejects(c.manageProfile({action:'ubahProfil',profil},actor),/Gaji pokok sudah berbeda/);
 await c.manageProfile({action:'ubahProfil',profil:{...profil,gaji_pokok:1750000}},actor);
 const patch=calls.find(x=>x.method==='PATCH');assert.ok(patch);assert.equal('gaji_pokok' in JSON.parse(patch.body),false);
});
