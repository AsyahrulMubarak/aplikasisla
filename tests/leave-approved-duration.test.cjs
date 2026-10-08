'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const read=f=>fs.readFileSync(__dirname+'/../'+f,'utf8');
const edge=read('supabase/functions/sla-payroll-attendance/index.ts'),html=read('absen.html');
const request=(extra={})=>({id_pengajuan:'PGJ-DURATION',nama_pegawai:'Pegawai Uji',role:'teknisi',cabang:'Kendari',
  jenis:'Izin',status:'Menunggu',tanggal_mulai:'2026-10-08',tanggal_selesai:'2026-10-14',...extra});
const actor=(role='manager',extra={})=>({name:'Manajemen Uji',role,branch:'Kendari',access:'Semua',...extra});
function backend(p=request(),race=false) {
  const writes=[],queries=[];
  const c=vm.createContext({console,Date,Intl,Response,crypto,Deno:{env:{get:()=>''},serve(){}}});
  vm.runInContext(edge,c);
  c.rest=async(table,query='',method='GET',body)=>{
    assert.equal(table,'pengajuan_cuti');queries.push(query);
    if(method==='PATCH'){writes.push(structuredClone(body));return race?[]:[{...p,...body}];}
    return [p];
  };
  c.allRows=async(table,query)=>{queries.push(query);return [p];};
  c.photos=async rows=>rows;
  return {c,writes,queries};
}
for(const role of ['admin','manager','direktur'])for(const days of [1,3,7])test(`${role} approves ${days} of 7 calendar days and preserves requested dates`,async()=>{
  const p=request(),h=backend(p);
  const r=await h.c.approveLeave({idPengajuan:p.id_pengajuan,keputusan:'Disetujui',durasiDisetujui:days,namaPemberiAcc:'Forged'},actor(role));
  assert.equal(r.status,'sukses');assert.match(r.pesan,new RegExp(days+' hari'));
  assert.equal(h.writes[0].tanggal_selesai_disetujui,'2026-10-'+String(7+days).padStart(2,'0'));
  assert.equal(h.writes[0].disetujui_oleh,'Manajemen Uji');
  assert.ok(!('tanggal_selesai' in h.writes[0]));assert.equal(p.tanggal_selesai,'2026-10-14');
  assert.match(h.queries.at(-1),/status=eq.Menunggu/);
});
test('Server rejects empty, fractional, nonnumeric, zero, negative and excessive durations before any write',async()=>{
  for(const value of ['',null,true,[],{},0,-1,1.5,'3abc','3.0',' 3 ',8,Infinity,NaN]){
    const h=backend();await assert.rejects(h.c.approveLeave({idPengajuan:'PGJ-DURATION',keputusan:'Disetujui',durasiDisetujui:value},actor()),/Durasi/);
    assert.equal(h.writes.length,0);
  }
});
test('Authorization and applicant chain remain enforced when a duration is submitted',async()=>{
  for(const [u,p]of [[actor('teknisi'),request()],[actor('admin_raha',{branch:'Raha',access:'Raha'}),request()],
    [actor('admin',{branch:'Raha',homeBranch:'Raha'}),request()],[actor('admin'),request({role:'admin'})],
    [actor('manager'),request({role:'manager'})],[actor('admin',{access:'Kendari'}),request({cabang:'Raha'})]]){
    const h=backend(p);await assert.rejects(h.c.approveLeave({idPengajuan:p.id_pengajuan,keputusan:'Disetujui',durasiDisetujui:3,role:'direktur'},u));
    assert.equal(h.writes.length,0);
  }
});
test('Sickness and rejection ignore duration; older clients approve the full requested range',async()=>{
  for(const [p,decision]of [[request({jenis:'Sakit',tanggal_selesai:null}),'Disetujui'],[request(),'Ditolak']]){
    const h=backend(p);await h.c.approveLeave({idPengajuan:p.id_pengajuan,keputusan:decision,durasiDisetujui:0},actor());
    assert.ok(!('tanggal_selesai_disetujui' in h.writes[0]));
  }
  const h=backend();await h.c.approveLeave({idPengajuan:'PGJ-DURATION',keputusan:'Disetujui'},actor());
  assert.equal(h.writes[0].tanggal_selesai_disetujui,'2026-10-14');
});
test('Finalized requests and concurrent approval are never reported as successfully overwritten',async()=>{
  for(const status of ['Disetujui','Ditolak']){
    const h=backend(request({status}));await assert.rejects(h.c.approveLeave({idPengajuan:'PGJ-DURATION',keputusan:'Disetujui',durasiDisetujui:3},actor()),/sudah diputuskan/);
    assert.equal(h.writes.length,0);
  }
  const h=backend(request(),true);await assert.rejects(h.c.approveLeave({idPengajuan:'PGJ-DURATION',keputusan:'Disetujui',durasiDisetujui:3},actor()),/pengguna lain/);
});
test('Inclusive duration handles leap days and transitions across months and years',()=>{
  const h=backend();
  for(const [from,to,days,end]of [['2028-02-28','2028-03-05',3,'2028-03-01'],['2026-12-30','2027-01-05',3,'2027-01-01']])
    assert.equal(h.c.approvedLeaveEnd(request({tanggal_mulai:from,tanggal_selesai:to}),String(days)).end,end);
  for(const [from,to]of [['2026-02-30','2026-03-05'],['2026-10-08','2026-10-07']])
    assert.throws(()=>h.c.approvedLeaveEnd(request({tanggal_mulai:from,tanggal_selesai:to}),1),/Rentang/);
});
test('Approved attendance stops at selected end and removes legacy generated markers beyond it',async()=>{
  for(const days of [1,3,7]){
    const p=request({status:'Disetujui',tanggal_selesai_disetujui:'2026-10-'+String(7+days).padStart(2,'0')});
    const h=backend(p),legacy=Array.from({length:7},(_,i)=>({id_absen:'ABS-PGJ-DURATION-202610'+String(8+i).padStart(2,'0'),
      waktu_absen:'2026-10-'+String(8+i).padStart(2,'0')+'T08:00:00+08:00',nama_pegawai:p.nama_pegawai,tipe_absen:'Izin',status_disiplin:'Pengajuan Disetujui'}));
    const out=await h.c.effectiveAbsence(legacy,'2026-10-01','2026-10-31',p.nama_pegawai,'Kendari');
    assert.equal(out.length,days);assert.equal(p.tanggal_selesai,'2026-10-14');
  }
  const h=backend(request({status:'Disetujui',tanggal_selesai_disetujui:'2026-10-10'}));
  const actual={nama_pegawai:'Pegawai Uji',waktu_absen:'2026-10-09T08:00:00+08:00',tipe_absen:'Masuk',status_disiplin:'Tepat Waktu'};
  const out=await h.c.effectiveAbsence([actual],'2026-10-01','2026-10-31');
  assert.equal(out.filter(r=>r.tipe_absen==='Izin').length,1);
  assert.equal((await h.c.effectiveAbsence([],'2026-10-11','2026-10-14')).length,0);
});
test('History returns the original range and approved end separately, including legacy approvals',async()=>{
  for(const end of ['2026-10-10',null]){
    const h=backend(request({status:'Disetujui',tanggal_selesai_disetujui:end}));
    const row=(await h.c.listLeave('getRiwayatPengajuan',actor())).data[0];
    assert.equal(row.Selesai,'2026-10-14');assert.equal(row['Selesai Disetujui'],end||'2026-10-14');
  }
});
test('Legacy projection also uses the approved range and keeps requested dates',()=>{
  const day=value=>new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,10);
  const c=vm.createContext({Date,formatKunciTanggal_:day,buatTanggalMakassar_:(d)=>new Date(d+'T08:00:00+08:00'),Utilities:{formatDate:day}});
  vm.runInContext(read('maintenance/leave-projection.gs'),c);
  const p=request({status:'Disetujui',tanggal_selesai_disetujui:'2026-10-10'});
  assert.equal(c.proyeksikanAbsensiPengajuan_([],[p],'2026-10-01','2026-10-31',new Date('2026-10-14')).length,3);
  assert.equal(p.tanggal_selesai,'2026-10-14');
});
const extract=name=>{const m=html.match(new RegExp('^([ \\t]*)(?:async )?function '+name+'\\([^]*?^\\1\\}','m'));assert.ok(m,name);return m[0];};
function frontend(value='3',kind='Izin',confirmed=true){
  const el={},payloads=[],confirmations=[],toasts=[];
  for(const id of ['loading-overlay','loading-text','approval-list','approval-loading','jumlah-pengajuan','judul-modal-approval','durasi-izin-info-PGJ-DURATION'])el[id]={style:{},innerHTML:'',textContent:''};
  if(kind==='Izin')el['durasi-izin-PGJ-DURATION']={value,max:'7',dataset:{mulai:'2026-10-08'}};
  const row={'ID Pengajuan':'PGJ-DURATION','Nama Pegawai':'Pegawai Uji','Jenis (Sakit/Izin)':kind,'Tanggal Mulai':'2026-10-08',
    Selesai:kind==='Izin'?'2026-10-14':null,'Selesai Disetujui':'2026-10-10','Status (Menunggu/Disetujui/Ditolak)':'Disetujui'};
  const c=vm.createContext({Date,Intl,Number,penggunaAktif:{'Nama Asli':'Manager'},API_ABSEN_URL:'mock',
    document:{getElementById:id=>el[id]||null,querySelector:()=>null},roleManajemenAktif:()=>true,
    payloadDenganSesi:(action,p={})=>({action,...p}),showToast:msg=>toasts.push(msg),
    showConfirm:async message=>{confirmations.push(message);return confirmed;},
    fetchAntiCORS:async(url,p)=>{payloads.push(p);return {status:'sukses',pesan:'Tersimpan',data:[row]};}});
  vm.runInContext(['escapeHTML','formatTanggalTampil','tombolFotoLampiranPengajuan','jumlahHariIzin','pilihanDurasiIzin','sinkronDurasiIzin',
    'muatDaftarPengajuan','muatRiwayatPengajuan','prosesApproval'].map(extract).join('\n'),c);
  return {c,el,payloads,confirmations,toasts};
}
test('UI sends selected duration and confirms the precise inclusive dates',async()=>{
  const h=frontend();h.c.sinkronDurasiIzin('PGJ-DURATION');
  assert.match(h.el['durasi-izin-info-PGJ-DURATION'].textContent,/3 dari 7 hari/);
  await h.c.prosesApproval('PGJ-DURATION','Disetujui');
  assert.equal(h.payloads[0].durasiDisetujui,3);assert.match(h.confirmations[0],/3 dari 7 hari/);assert.match(h.confirmations[0],/10 Okt 2026/);
});
test('UI prevents invalid approvals, allows rejection regardless of invalid duration, and respects cancellation',async()=>{
  for(const value of ['', '0','8','1.5','abc']){
    const h=frontend(value);await h.c.prosesApproval('PGJ-DURATION','Disetujui');assert.equal(h.payloads.length,0);assert.equal(h.confirmations.length,0);
  }
  for(const kind of ['Sakit','Izin']){
    const h=frontend('',kind);await h.c.prosesApproval('PGJ-DURATION','Ditolak');assert.ok(!('durasiDisetujui' in h.payloads[0]));
  }
  const h=frontend('3','Izin',false);await h.c.prosesApproval('PGJ-DURATION','Disetujui');assert.equal(h.payloads.length,0);
});
test('Queue renders duration input only for leave; history shows requested and approved days',async()=>{
  for(const kind of ['Izin','Sakit']){
    const h=frontend('3',kind);await h.c.muatDaftarPengajuan();
    assert.equal(h.el['approval-list'].innerHTML.includes('type="number"'),kind==='Izin');
    if(kind==='Izin')assert.match(h.el['approval-list'].innerHTML,/min="1" max="7" step="1" value="7"/);
    await h.c.muatRiwayatPengajuan();
    if(kind==='Izin'){
      assert.match(h.el['approval-list'].innerHTML,/Durasi Diajukan<strong>7 hari/);
      assert.match(h.el['approval-list'].innerHTML,/Durasi Disetujui<strong>3 hari/);
    }else assert.ok(!h.el['approval-list'].innerHTML.includes('Durasi Disetujui'));
  }
});
