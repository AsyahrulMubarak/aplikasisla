'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
const root=process.env.PAYROLL_GRACE_SOURCE_DIR||path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'slipgaji.html'),'utf8');
const edge=fs.readFileSync(path.join(root,'supabase/functions/sla-payroll-attendance/index.ts'),'utf8');
function extract(name){const m=html.match(new RegExp('^([ \\t]*)(?:async )?function '+name+'\\([^]*?^\\1\\}','m'));assert.ok(m,name);return m[0];}
function harness(now='2026-10-07T23:59:59+08:00'){
 const state={now,manage:true,writes:[],draftReads:0};
 class Clock extends Date {constructor(...args){super(...(args.length?args:[state.now]));}}
 const fields=Object.fromEntries(['pilih-bulan','input-fee','input-kasbon','input-luar-kota','input-libur-tambahan','btn-simpan-variabel','info-kunci-bulan'].map(id=>[id,{value:'',style:{}}]));fields['pilih-bulan'].value='2026-09';
 const front=vm.createContext({Date:Clock,Intl,document:{getElementById:id=>fields[id]},penggunaBolehKelolaPayroll_:()=>state.manage,
  globalPayrollBulanan:{pegawai:{fee:1000,kasbon:0,luarKota:'3',liburTambahan:''}},normalisasiNamaPayroll:x=>x,
  ambilDrafTanggalPayroll_:()=>{state.draftReads++;return null;},setTimeout(){}});
 vm.runInContext(['tanggalPayrollWita_','periodePayrollTerkunci_','periodePayrollSaatIni_','cekKunciBulan','terapkanVariabelPayrollKeForm'].map(extract).join('\n'),front);
 const records=new Map();
 const back=vm.createContext({Date:Clock,Intl,console,Response,Request,URLSearchParams,AbortSignal,crypto,
  Deno:{env:{get:n=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',SUPABASE_ANON_KEY:'test-public'})[n]},serve(){}},
  fetch:async(url,options)=>{
   const u=new URL(url);const table=u.pathname.split('/').pop();
   if(table==='users')return Response.json([{nama_asli:'Pegawai',hak_akses_cabang:'Raha'}]);
   if(table==='payroll_bulanan'){
    if(options.method==='POST'){const body=JSON.parse(options.body);state.writes.push(body);body.forEach(r=>records.set(r.kunci_payroll,r));return Response.json(body);}
    return Response.json([...records.values()].filter(r=>u.searchParams.get('periode')?r.periode===u.searchParams.get('periode').slice(3):u.searchParams.get('kunci_payroll')?r.kunci_payroll===u.searchParams.get('kunci_payroll').slice(3):true));
   }
   if(table==='sla_koreksi_luar_kota'){state.writes.push(JSON.parse(options.body));return Response.json([]);}
   throw Error('Unexpected request '+table);
  }});
 vm.runInContext(edge,back);
 return{front,back,fields,state};
}
test('Frontend and server lock after seven calendar days in WITA, including year and leap-month boundaries',()=>{
 const {front,back}=harness();
 for(const[period,time,locked]of[
  ['2026-09','2026-09-30T15:59:59Z',false],['2026-09','2026-09-30T16:00:00Z',false],
  ['2026-09','2026-10-05T16:00:00Z',false],['2026-09','2026-10-06T23:59:59+08:00',false],
  ['2026-09','2026-10-07T15:59:59.999Z',false],['2026-09','2026-10-07T16:00:00Z',true],
  ['2026-08','2026-10-01T00:00:00+08:00',true],['2026-10','2026-10-06T00:00:00+08:00',false],
  ['2026-11','2026-10-06T00:00:00+08:00',false],['2026-12','2027-01-07T23:59:59+08:00',false],
  ['2026-12','2027-01-08T00:00:00+08:00',true],['2028-02','2028-03-07T23:59:59+08:00',false],
  ['2028-02','2028-03-08T00:00:00+08:00',true],['2026-13','2026-10-01T00:00:00+08:00',true]
 ]){assert.equal(front.periodePayrollTerkunci_(period,new Date(time)),locked,period+' '+time+' UI');assert.equal(back.payrollPeriodLocked(period,new Date(time)),locked,period+' '+time+' API');}
});
test('All monthly controls share the grace deadline and remain read-only for ordinary employees',()=>{
 const {front,fields,state}=harness();
 assert.equal(front.cekKunciBulan(),false);
 assert.match(fields['info-kunci-bulan'].innerText,/7 Oktober 2026, 23\.59 WITA/);
 for(const id of ['input-fee','input-kasbon','input-luar-kota','input-libur-tambahan','btn-simpan-variabel'])assert.equal(fields[id].disabled,false,id);
 state.manage=false;front.cekKunciBulan();for(const id of ['input-fee','input-kasbon','input-luar-kota','input-libur-tambahan','btn-simpan-variabel'])assert.equal(fields[id].disabled,true,id);
 state.manage=true;state.now='2026-10-08T00:00:00+08:00';assert.equal(front.cekKunciBulan(),true);assert.match(fields['info-kunci-bulan'].innerText,/terkunci/);
 for(const id of ['input-fee','input-kasbon','input-luar-kota','input-libur-tambahan','btn-simpan-variabel'])assert.equal(fields[id].disabled,true,id);
});
test('Server saves the selected previous month and rejects expired, older or unauthorized payroll writes',async()=>{
 const {back,state}=harness();
 const body={periode:'2026-09',namaPegawai:'Pegawai',fee:125000,kasbon:25000,luarKota:'3, 9',liburTambahan:'5'};
 const actor={name:'Manajemen',role:'manager',branch:'Raha',homeBranch:'Raha',access:'Raha',salary:2000000};
 const saved=await back.savePayroll(body,actor);assert.equal(saved.status,'sukses');assert.equal(saved.data.periode,'2026-09');assert.equal(saved.data.fee,125000);
 const count=state.writes.length;
 await assert.rejects(back.savePayroll(body,{...actor,role:'teknisi'}),/Manajemen/);
 await assert.rejects(back.savePayroll({...body,periode:'2026-08'},actor),/dikunci/);
 state.now='2026-10-08T00:00:00+08:00';await assert.rejects(back.savePayroll(body,actor),/dikunci/);assert.equal(state.writes.length,count);
});
test('Outside-city correction exemptions and local draft recovery follow the same grace window',async()=>{
 const {front,back,state}=harness();
 front.terapkanVariabelPayrollKeForm('pegawai');assert.equal(state.draftReads,4);
 const actor={name:'Manager',role:'manager',branch:'Raha',access:'Raha',salary:2000000};
 const body={periode:'2026-09',daftarPayroll:[{namaPegawai:'Pegawai',luarKota:'3, 9'}]};
 assert.equal((await back.syncCorrection(body,actor)).jumlah,1);
 state.now='2026-10-08T00:00:00+08:00';state.draftReads=0;front.terapkanVariabelPayrollKeForm('pegawai');assert.equal(state.draftReads,0);
 await assert.rejects(back.syncCorrection(body,actor),/masa tenggang/);
});
