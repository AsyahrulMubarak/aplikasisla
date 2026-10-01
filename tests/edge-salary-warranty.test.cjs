const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(__dirname+'/../supabase/functions/sla-payroll-attendance/index.ts','utf8');
function harness(mode='ok'){
 const calls=[];const events=[{id:'customer',lease:'a',no_wa:'081234567890',pesan:'Customer ticket'},{id:'technician',lease:'b',no_wa:'081222222222',pesan:'Tech ticket'}];
 const done=[];const c=vm.createContext({console,Response,Request,URLSearchParams,AbortSignal,Date,Intl,crypto,Number,
  Deno:{env:{get:name=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',SUPABASE_ANON_KEY:'public-test',FONNTE_TOKEN:mode==='token'?'':'wa-test'})[name]},serve:fn=>{}},
  fetch:async(url,options)=>{
   calls.push({url,...options});const body=options.body&&String(options.body).startsWith('{')?JSON.parse(options.body):null;
   if(url.includes('rpc/sla_klaim_garansi'))return Response.json({status:'sukses',idTiket:'TKT-KG-GRS-1',notifikasiTertunda:2});
   if(url.includes('rpc/sla_ambil_notif_garansi')){if(mode==='lease')return Response.json({}, {status:503});return Response.json(events);}
   if(url.includes('api.fonnte.com'))return Response.json({status:mode!=='provider'});
   if(url.includes('rpc/sla_selesai_notif_garansi')){done.push(body);return Response.json(true);}
   if(url.includes('/sla_notif_klaim_garansi'))return Response.json(events.filter(e=>!done.find(d=>d.p_id===e.id&&d.p_sukses)));
   throw Error('Unexpected database call');
  }});
 vm.runInContext(source,c);return {c,calls,done};
}
test('Edge API gates every attendance and payroll action using current salary for all non-directors',async()=>{
 const {c,calls}=harness();
 for(const role of ['admin','admin_raha','manager','sales','teknisi','freelance'])for(const salary of [0,-1,undefined,Infinity]){
  const user={name:'Alif',role,branch:'Kendari',salary,access:'Semua'};
  for(const action of ['getKonfigurasiAbsensi','getAbsen','getPayrollData','getTinjauanAbsen','getDaftarPengajuan','responPengajuan','getVariabelPayroll','simpanVariabelPayroll','updateTunjangan']){
   await assert.rejects(c.dispatch({action,periode:'2026-10','Gaji Pokok':2000000,Role:'direktur'},user));
  }
 }
 assert.equal(calls.length,0);
 assert.equal((await c.dispatch({action:'getKonfigurasiAbsensi'},{role:'direktur',salary:0,branch:'Kendari'})).status,'sukses');
 assert.equal((await c.dispatch({action:'getKonfigurasiAbsensi'},{role:'sales',name:'Sales',salary:1500000,branch:'Raha'})).status,'sukses');
});
test('Warranty claims bind verified Auth and branch, send only the stored customer and technician phones',async()=>{
 const {c,calls,done}=harness();const user={role:'admin',authId:'verified-id',access:'Kendari',branch:'Kendari',salary:0};
 const result=await c.dispatch({action:'klaimGaransi',idGaransi:'GRS-1',authId:'forged-id',phone:'08999999'},user);
 assert.equal(result.idTiket,'TKT-KG-GRS-1');assert.equal(result.notifikasiTertunda,0);
 const creation=calls.find(x=>x.url.includes('rpc/sla_klaim_garansi'));assert.equal(JSON.parse(creation.body).p_auth_id,'verified-id');
 assert.deepEqual(calls.filter(x=>x.url.includes('api.fonnte')).map(x=>new URLSearchParams(x.body).get('target')),['6281234567890','6281222222222']);assert.ok(done.every(x=>x.p_sukses));
 await assert.rejects(c.dispatch({action:'klaimGaransi',idGaransi:'GRS-1',cabang:'Raha'},user),/hak akses/);
 await assert.rejects(c.dispatch({action:'klaimGaransi',idGaransi:'GRS-1'},{...user,role:'sales'}),/manajemen/);
});
for(const mode of ['provider','token','lease'])test('Created warranty ticket survives notification failure: '+mode,async()=>{
 const {c,done}=harness(mode);const r=await c.dispatch({action:'klaimGaransi',idGaransi:'GRS-1'},{role:'manager',authId:'verified',access:'Semua',branch:'Raha'});
 assert.equal(r.status,'sukses');assert.equal(r.notifikasiTertunda,2);assert.ok(done.every(x=>!x.p_sukses));
});
