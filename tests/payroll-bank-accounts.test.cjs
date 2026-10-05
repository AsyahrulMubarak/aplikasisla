'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.PAYROLL_BANK_SOURCE_DIR || path.resolve(__dirname, '..');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/sla-payroll-attendance/index.ts'), 'utf8');
const html = fs.readFileSync(process.env.PAYROLL_BANK_HTML || path.join(root, 'slipgaji.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'maintenance/payroll-bank-accounts.sql'), 'utf8');
const manager = { username:'manager-test', authId:'00000000-0000-4000-8000-000000000001', role:'manager', branch:'Kendari', homeBranch:'Kendari', access:'Semua', salary:3000000 };
function edgeHarness() {
  const accounts = new Map(), banks = new Map(), calls = [];
  const c = vm.createContext({ Response, Request, console, Intl, crypto, AbortSignal, URLSearchParams,
    Deno:{env:{get:k=>({SUPABASE_URL:'https://bank.test',SUPABASE_SERVICE_ROLE_KEY:'test-secret',SUPABASE_ANON_KEY:'test-public'})[k]},serve(){}},
    fetch:async(url,options)=>{
      const u = new URL(url); calls.push({url,options});
      if (u.pathname.endsWith('/sla_rekening_pegawai')) return Response.json([...accounts].map(([username,nomor_rekening])=>({username,nomor_rekening,nama_bank:banks.get(username)||''})));
      if (u.pathname.endsWith('/sla_simpan_rekening_pegawai') || u.pathname.endsWith('/sla_simpan_rekening_bank_pegawai')) {
        const p = JSON.parse(options.body);
        if (!['worker-kendari','worker-raha','duplicate-profile'].includes(p.p_username)) return Response.json({message:'Profil pegawai tidak ditemukan.'},{status:400});
        if ((accounts.get(p.p_username)||'')!==p.p_nomor_lama) return Response.json({message:'Nomor rekening sudah diubah pengguna lain.'},{status:400});
        if (p.p_nama_bank !== undefined && (banks.get(p.p_username)||'')!==p.p_nama_bank_lama) return Response.json({message:'Nama bank sudah diubah pengguna lain.'},{status:400});
        accounts.set(p.p_username,p.p_nomor_rekening);
        if (p.p_nama_bank !== undefined) banks.set(p.p_username,p.p_nama_bank);
        return Response.json({status:'sukses',data:{username:p.p_username,nomorRekening:p.p_nomor_rekening,namaBank:banks.get(p.p_username)||''}});
      }
      throw Error('Unexpected request: '+url);
    }
  }); vm.runInContext(edge,c); return {c,accounts,banks,calls};
}
const body = {action:'simpanRekeningPegawai',usernameTarget:'worker-kendari',nomorRekening:'001234567890',nomorLama:''};
test('Only Admin Kendari, manager and director can read/save bank numbers for both branches', async()=>{
  for (const actor of [{...manager,role:'admin'},manager,{...manager,role:'direktur',salary:0}]) {
    const {c,calls}=edgeHarness();
    for (const usernameTarget of ['worker-kendari','worker-raha']) {
      assert.equal((await c.dispatch({...body,usernameTarget},actor)).status,'sukses');
      assert.equal(JSON.parse(calls.at(-1).options.body).p_auth_id,actor.authId);
    }
    assert.equal((await c.dispatch({action:'getRekeningPegawai'},actor)).data.length,2);
  }
});
test('Technician, sales, admin Raha, legacy admin in Raha and unknown roles are denied before any DB request', async()=>{
  const actors = ['teknisi','sales','admin_raha','freelance','unknown',''].map(role=>({...manager,role}));
  actors.push({...manager,role:'admin',homeBranch:'Raha',branch:'Raha',access:'Raha'});
  for (const actor of actors) {
    const {c,calls}=edgeHarness();
    await assert.rejects(c.dispatch({...body,user:{Role:'direktur',Username:'admin'},cabang:'Kendari'},actor),/hanya dapat diubah/);
    await assert.rejects(c.dispatch({action:'getRekeningPegawai'},actor),/hanya dapat diakses/);
    assert.equal(calls.length,0);
  }
});
test('Leading zeroes, whitespace, empty clearing and persistence across payroll periods', async()=>{
  const {c,accounts}=edgeHarness();
  await c.dispatch({...body,nomorRekening:' 001 234567890 ',periode:'2000-01'},manager);
  assert.equal(accounts.get('worker-kendari'),'001234567890');
  assert.equal((await c.dispatch({action:'getRekeningPegawai',periode:'2030-12'},manager)).data[0].nomorRekening,'001234567890');
  await c.dispatch({...body,nomorLama:'001234567890',nomorRekening:''},manager);
  assert.equal(accounts.get('worker-kendari'),'');
});
test('Reject numeric JSON values, malformed values, missing expected number and overlong input', async()=>{
  for (const patch of [{nomorRekening:123456},{nomorRekening:null},{nomorRekening:'123abc'},{nomorRekening:'12-34'},{nomorRekening:'1'.repeat(35)},{nomorLama:undefined},{usernameTarget:''}]) {
    const {c,calls}=edgeHarness(); await assert.rejects(c.dispatch({...body,...patch},manager),/tidak valid|harus berisi/); assert.equal(calls.length,0);
  }
});
test('Concurrent stale saves and missing employees fail without overwriting the stored account', async()=>{
  const {c,accounts}=edgeHarness(); await c.dispatch(body,manager);
  await assert.rejects(c.dispatch({...body,nomorRekening:'999999'},manager),/sudah diubah/);
  assert.equal(accounts.get('worker-kendari'),'001234567890');
  await assert.rejects(c.dispatch({...body,usernameTarget:'missing'},manager),/Profil pegawai/);
});
test('Bank identity uses username so a second same-name profile cannot overwrite the first account', async()=>{
  const {c,accounts}=edgeHarness(); await c.dispatch(body,manager);
  await c.dispatch({...body,usernameTarget:'duplicate-profile',namaPegawai:'Same Name',nomorRekening:'009999'},manager);
  assert.equal(accounts.get('worker-kendari'),'001234567890'); assert.equal(accounts.get('duplicate-profile'),'009999');
});
class Element {
  constructor(tag) {this.tag=tag;this.children=[];this.events={};this.style={};this.attrs={};this.value='';this.disabled=false;}
  appendChild(e){this.children.push(e);return e;}
  replaceChildren(){this.children=[];}
  setAttribute(k,v){this.attrs[k]=v;}
  async emit(e){return this.events[e]?.({target:this});}
  addEventListener(e,fn){this.events[e]=fn;}
}
function uiHarness(user={Role:'manager',Hak_Akses_Cabang:'Semua'}) {
  const calls=[],toasts=[],ids=new Map();
  const c=vm.createContext({console,document:{createElement:t=>new Element(t),getElementById:id=>{if(!ids.has(id))ids.set(id,new Element('div'));return ids.get(id);}},
    apiUrl:'https://bank.test',kontrolTransferGaji_:new Map(),buatTandaTransferGaji_:()=>{},payloadSesiSlip:(action,extra={})=>({action,...extra}),showToast:(...a)=>toasts.push(a),
    fetchJsonDenganTimeout_:async(url,payload)=>{calls.push(payload);return payload.action==='getRekeningPegawai'?{status:'sukses',data:[{username:'worker-raha',nomorRekening:'001111',namaBank:''}]}:{status:'sukses',data:{username:payload.usernameTarget,nomorRekening:payload.nomorRekening,namaBank:payload.namaBank}};}
  });
  vm.runInContext('let penggunaAktif='+JSON.stringify(user)+'; let rekeningPegawai_=Object.create(null),drafRekeningPegawai_=Object.create(null),namaBankPegawai_=Object.create(null),drafNamaBankPegawai_=Object.create(null),rekeningPegawaiSiap_=false; const penyimpananRekeningPegawai_=new Set();',c);
  for (const name of ['normalisasiCabangSesi','penggunaBolehKelolaRekening_','muatRekeningPegawai_','buatSelRekeningPegawai_','normalisasiCabangPayroll','cabangRekapPayroll_','generateDashboardRekap']) {
    const start=html.indexOf('function '+name+'('); assert(start>=0,name+' is present');
    const end=html.indexOf('\n        }',start)+10;
    vm.runInContext((name==='muatRekeningPegawai_'?'async ':'')+html.slice(start,end),c);
  }
  return {c,calls,toasts,ids};
}
const profile={Username:'worker-raha','Nama Asli':'Test Employee',Role:'teknisi',Hak_Akses_Cabang:'Raha'};
test('UI role matrix matches the backend, including legacy admin Raha and branch fallback',async()=>{
  for(const user of [{Role:'admin',Hak_Akses_Cabang:'Kendari'},{Role:'admin',Hak_Akses_Cabang:'Semua',Cabang:'Kendari'},{Role:'manager',Hak_Akses_Cabang:'Raha'},{Role:'direktur'}]) {
    const {c}=uiHarness(user); assert.equal(c.penggunaBolehKelolaRekening_(),true);
  }
  for(const user of [{Role:'admin_raha',Hak_Akses_Cabang:'Raha'},{Role:'admin',Hak_Akses_Cabang:'Raha'},{Role:'admin',Hak_Akses_Cabang:'Semua',Cabang:'Raha'},{Role:'sales'},{Role:'teknisi'}]) {
    const {c,calls}=uiHarness(user);assert.equal(c.penggunaBolehKelolaRekening_(),false); await c.muatRekeningPegawai_();
    assert.equal(calls.length,0);assert.equal(c.buatSelRekeningPegawai_(profile).children.length,0);
  }
});
test('UI loads permanent number, saves changes, preserves zeroes and shows confirmed saved state',async()=>{
  const {c,calls}=uiHarness();await c.muatRekeningPegawai_();
  const cell=c.buatSelRekeningPegawai_(profile),[bankInput,input,button]=cell.children[0].children;
  assert.equal(input.type,'text');assert.equal(input.value,'001111');assert.equal(button.disabled,true);
  input.value='009876543210';await input.emit('input');assert.equal(button.disabled,false);
  await button.emit('click');assert.equal(calls.at(-1).usernameTarget,'worker-raha');assert.equal(calls.at(-1).nomorLama,'001111');
  assert.equal(input.value,'009876543210');assert.equal(cell.children[1].textContent,'Tersimpan');assert.equal(cell.children[2].textContent,'009876543210');assert.equal(button.disabled,true);
  assert.equal(c.buatSelRekeningPegawai_(profile).children[0].children[1].value,'009876543210');
});
test('UI retains unsaved drafts through re-render and errors, and avoids printing an unsaved number',async()=>{
  const {c}=uiHarness();await c.muatRekeningPegawai_();const cell=c.buatSelRekeningPegawai_(profile),[bankInput,input,button]=cell.children[0].children;
  input.value='009999';await input.emit('input');assert.equal(c.buatSelRekeningPegawai_(profile).children[0].children[1].value,'009999');
  assert.equal(cell.children[2].textContent,'001111');c.fetchJsonDenganTimeout_=async()=>{throw Error('Nomor rekening sudah diubah pengguna lain.');};
  await button.emit('click');assert.equal(cell.children[1].textContent,'Gagal disimpan');assert.equal(button.disabled,false);assert.equal(input.disabled,false);
  assert.equal(c.buatSelRekeningPegawai_(profile).children[0].children[1].value,'009999');
});
test('UI prevents duplicate clicks while saving and rejects invalid input before calling API',async()=>{
  const {c,calls}=uiHarness();await c.muatRekeningPegawai_();const cell=c.buatSelRekeningPegawai_(profile),[bankInput,input,button]=cell.children[0].children;
  input.value='bad';await input.emit('input');await button.emit('click');assert.equal(calls.length,1);
  let release;c.fetchJsonDenganTimeout_=async()=>new Promise(resolve=>{release=resolve;});
  input.value='000999';await input.emit('input');const pending=button.emit('click');assert.equal(button.disabled,true);assert.equal(input.disabled,true);
  await button.emit('click');release({status:'sukses',data:{username:'worker-raha',nomorRekening:'000999',namaBank:''}});await pending;assert.equal(button.disabled,true);assert.equal(input.disabled,false);
});
test('Both rekap branches have nine columns and inserting bank number does not change salary totals',()=>{
  assert.equal((html.match(/<th>Bank &amp; Nomor Rekening<\/th>/g)||[]).length,2);
  assert.equal((html.match(/colspan="8" style="text-align:right;">TOTAL PAYROLL/g)||[]).length,2);
  const {c,ids}=uiHarness();vm.runInContext('rekeningPegawaiSiap_=true;',c);ids.set('pilih-bulan',{value:'2026-09'});
  const kendari={...profile,Username:'worker-kendari','Nama Asli':'Other Employee',Hak_Akses_Cabang:'Kendari'};
  const users=[profile,kendari];c.daftarProfilPayroll=()=>users;c.profilLayakTampilPayroll_=()=>true;c.formatRp=n=>'Rp '+n;
  c.kalkulasiGajiPegawai=name=>({profil:users.find(u=>u['Nama Asli']===name),countKehadiran:2,gajiPokok:1000,totalBersih:900,totalPotongan:100,kasbon:0,totalLembur:0,totalBonusPoin:0,totalBonusPoinTeknisiRaha:0,totalTunjanganTetap:0,feeMarketing:0});
  c.generateDashboardRekap();for(const branch of ['kendari','raha'])assert.equal(ids.get('tabel-dashboard-'+branch).children[0].children.length,9);
  assert.equal(ids.get('dash-grand-total').innerText,'Rp 1800');assert.equal(ids.get('dash-total-raha').innerText,'Rp 900');
});
test('Schema has RLS, no browser grants, limited service grants, atomic compare and permanent username FK',()=>{
  assert.match(sql,/enable row level security/);assert.match(sql,/revoke all on table .* from public, anon, authenticated/);
  assert.match(sql,/grant select, insert, update on table .* to service_role/);assert.doesNotMatch(sql,/grant .* to (?:anon|authenticated)/);
  assert.match(sql,/security invoker set search_path = ''/);assert.match(sql,/revoke all on function .* from public, anon, authenticated/);
  assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/coalesce\(v_old, ''\) <> p_nomor_lama/);assert.match(sql,/references public.users\(username\) on update cascade on delete cascade/);
  assert.doesNotMatch(sql,/periode/);
});
test('Bank names save with leading-zero accounts and older pages retain the saved bank name',async()=>{
  const {c,accounts,banks}=edgeHarness();
  await c.dispatch({...body,namaBank:'  Bank  Syariah Indonesia  ',namaBankLama:''},manager);
  assert.equal(banks.get('worker-kendari'),'Bank Syariah Indonesia');assert.equal(accounts.get('worker-kendari'),'001234567890');
  await c.dispatch({...body,nomorRekening:'009999',nomorLama:'001234567890'},manager);
  assert.equal(banks.get('worker-kendari'),'Bank Syariah Indonesia');
  const row=(await c.dispatch({action:'getRekeningPegawai'},manager)).data[0];assert.equal(row.namaBank,'Bank Syariah Indonesia');
});
test('Stale bank changes and invalid bank names fail without overwriting stored data',async()=>{
  const {c,banks}=edgeHarness();await c.dispatch({...body,namaBank:'BRI',namaBankLama:''},manager);
  await assert.rejects(c.dispatch({...body,nomorLama:body.nomorRekening,namaBank:'BCA',namaBankLama:''},manager),/diubah pengguna lain/);
  assert.equal(banks.get('worker-kendari'),'BRI');
  for(const patch of [{namaBank:null},{namaBank:123},{namaBank:'x'.repeat(101)},{namaBank:'Bank\nTest'},{namaBank:'BCA',namaBankLama:undefined}]){
    const h=edgeHarness();await assert.rejects(h.c.dispatch({...body,namaBank:'BRI',namaBankLama:'',...patch},manager),/Nama bank/);assert.equal(h.calls.length,0);
  }
});
test('UI saves bank-only changes, retains account numbers and prints only confirmed bank names',async()=>{
  const {c,calls}=uiHarness();await c.muatRekeningPegawai_();const cell=c.buatSelRekeningPegawai_(profile),[bankInput,input,button]=cell.children[0].children;
  bankInput.value='  BRI  ';await bankInput.emit('input');assert.equal(button.disabled,false);assert.equal(cell.children[2].textContent,'001111');
  assert.equal(c.buatSelRekeningPegawai_(profile).children[0].children[0].value,'  BRI  ');
  await button.emit('click');assert.equal(calls.at(-1).namaBank,'BRI');assert.equal(calls.at(-1).namaBankLama,'');assert.equal(calls.at(-1).nomorRekening,'001111');
  assert.equal(bankInput.value,'BRI');assert.equal(input.value,'001111');assert.equal(cell.children[2].textContent,'BRI · 001111');assert.equal(button.disabled,true);
  bankInput.value='BCA';await bankInput.emit('input');c.fetchJsonDenganTimeout_=async()=>{throw Error('Stale bank');};await button.emit('click');
  assert.equal(cell.children[2].textContent,'BRI · 001111');assert.equal(c.buatSelRekeningPegawai_(profile).children[0].children[0].value,'BCA');
});
