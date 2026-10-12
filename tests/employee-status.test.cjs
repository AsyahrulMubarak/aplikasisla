const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const edge=fs.readFileSync(__dirname+'/../supabase/functions/sla-payroll-attendance/index.ts','utf8');
function harness({leaves=[],attendance=[],tickets=[],profiles=[]}={}) {
  const calls=[];let handler;
  const c=vm.createContext({console,Response,Request,AbortSignal,Date,Intl,crypto,URLSearchParams,Uint8Array,atob,
    setTimeout,clearTimeout,Deno:{env:{get:n=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'server',SUPABASE_ANON_KEY:'public'})[n]},serve:fn=>handler=fn},
    fetch:async(url,options={})=>{
      calls.push({url,...options});
      if(url.includes('/pengajuan_cuti?'))return Response.json(leaves);
      if(url.includes('/absensi?'))return Response.json(attendance);
      if(url.includes('/tiket?'))return Response.json(tickets);
      if(url.includes('/users?'))return Response.json(profiles);
      throw new Error('Unexpected request '+url);
    }});
  vm.runInContext(edge,c);c.day=vm.runInContext('day',c);c.addDay=vm.runInContext('addDay',c);return {c,calls,handler};
}
const actor={username:'staff',name:'Staff',role:'sales',branch:'Kendari',homeBranch:'Kendari',access:'Kendari',salary:0};
function leaveFixture(c,changes={}) {
  const today=c.day();return {nama_pegawai:'Pegawai A',jenis:'Izin',tanggal_mulai:c.addDay(today,-2),tanggal_selesai:c.addDay(today,3),tanggal_selesai_disetujui:today,status:'Disetujui',cabang:'Kendari',...changes};
}
test('all employee roles, including unsalaried staff, see approved leave in their own branch',async()=>{
  const h=harness();h.c.allRows=async table=>table==='pengajuan_cuti'?[leaveFixture(h.c)]:[];
  for(const role of ['sales','teknisi','admin','admin_raha','manager','direktur']) {
    const r=await h.c.dispatch({action:'getStatusKehadiranCabang'}, {...actor,role});
    assert.equal(r.status,'sukses');assert.equal(r.data.length,1);assert.equal(r.data[0].nama,'Pegawai A');
    assert.deepEqual(Object.keys(r.data[0]).sort(),['mulai','nama','selesai','status']);
  }
});
test('caller-supplied branch cannot expose another branch to employees or either admin',async()=>{
  const h=harness();const today=h.c.day();
  h.c.allRows=async table=>table==='pengajuan_cuti'?[leaveFixture(h.c),leaveFixture(h.c,{nama_pegawai:'Pegawai Raha',cabang:'Raha'})]:[];
  for(const role of ['sales','teknisi','admin']) {
    const r=await h.c.dispatch({action:'getStatusKehadiranCabang',cabang:'Raha'},{...actor,role,access:role==='admin'?'Semua':'Kendari'});
    assert.equal(r.cabang,'Kendari');assert.equal(r.data.length,1);assert.equal(r.data[0].nama,'Pegawai A');
  }
  const r=await h.c.dispatch({action:'getStatusKehadiranCabang',cabang:'Kendari'},{...actor,role:'admin_raha',branch:'Raha',homeBranch:'Raha',access:'Raha'});
  assert.equal(r.cabang,'Raha');assert.equal(r.data[0].nama,'Pegawai Raha');
  await assert.rejects(()=>h.c.dispatch({action:'getStatusKehadiranCabang',cabang:'Raha'},{...actor,role:'manager'}),/Cabang/);
});
test('pending, rejected, expired and shortened approvals are excluded; ongoing sickness remains until return',async()=>{
  const h=harness(),today=h.c.day();
  const rows=[leaveFixture(h.c),leaveFixture(h.c,{nama_pegawai:'Menunggu',status:'Menunggu'}),leaveFixture(h.c,{nama_pegawai:'Ditolak',status:'Ditolak'}),
    leaveFixture(h.c,{nama_pegawai:'Expired',tanggal_selesai_disetujui:h.c.addDay(today,-1)}),
    leaveFixture(h.c,{nama_pegawai:'Sakit Aktif',jenis:'Sakit',tanggal_selesai:h.c.addDay(today,-1)}),
    leaveFixture(h.c,{nama_pegawai:'Sudah Kembali',jenis:'Sakit',kembali_bekerja_pada:new Date(Date.now()-1000).toISOString()})];
  h.c.allRows=async table=>table==='pengajuan_cuti'?rows:[];
  const r=await h.c.branchLeaveStatus({},actor);assert.deepEqual(Array.from(r.data,x=>x.nama),['Pegawai A','Sakit Aktif']);
  assert.equal(r.data[1].selesai,null);
});
test('a real return attendance ends illness; correction/automatic attendance does not',async()=>{
  const h=harness(),today=h.c.day();
  h.c.allRows=async table=>table==='pengajuan_cuti'?[leaveFixture(h.c,{jenis:'Sakit'}),leaveFixture(h.c,{nama_pegawai:'Pegawai B',jenis:'Sakit'})]:[
    {nama_pegawai:'Pegawai A',waktu_absen:today+'T08:00:00+08:00',tipe_absen:'Masuk',status_disiplin:'Tepat Waktu'},
    {nama_pegawai:'Pegawai B',waktu_absen:today+'T08:00:00+08:00',tipe_absen:'Masuk',status_disiplin:'Koreksi'}];
  const r=await h.c.branchLeaveStatus({},actor);assert.deepEqual(Array.from(r.data,x=>x.nama),['Pegawai B']);
});
test('status API reads only public roster fields, keeps branch in DB queries and escapes names',async()=>{
  const h=harness();h.c.rest=async(table,query)=>{
    h.calls.push({table,query});return table==='pengajuan_cuti'?[leaveFixture(h.c,{nama_pegawai:'A & "B"'})]:[];
  };
  await h.c.branchLeaveStatus({cabang:'Raha'},actor);
  assert.ok(h.calls.every(x=>x.query.includes('cabang.eq.Kendari')));
  assert.ok(h.calls.every(x=>!/(alasan|bukti_foto|no_wa|auth_id)/.test(x.query)));
  const attendance=h.calls.find(x=>x.table==='absensi');assert.match(attendance.query,/nama_pegawai=in\.\(%22/);assert.ok(!attendance.query.includes('A &'));
});
test('working roster groups technician team tickets once and excludes sales, Pending, finished and other branches',async()=>{
  const profiles=[{username:'a',nama_asli:'Teknisi A',role:'teknisi',hak_akses_cabang:'Kendari'},
    {username:'syawal',nama_asli:'Muhammad Syawal',role:'teknisi',hak_akses_cabang:'Kendari'},
    {username:'s',nama_asli:'Sales A',role:'sales',hak_akses_cabang:'Kendari'},
    {username:'r',nama_asli:'Teknisi Raha',role:'teknisi',hak_akses_cabang:'Raha'}];
  const tickets=[{id_tiket:'TKT-1',status:'On Progress',cabang:'Kendari',teknisi:'Teknisi A, Teknisi A, Syawal, Sales A, Teknisi Raha'},
    {id_tiket:'TKT-2',status:'on progress',cabang:'Kendari',teknisi:'Teknisi A'},
    {id_tiket:'TKT-3',status:'Pending',cabang:'Kendari',teknisi:'Teknisi A'},
    {id_tiket:'TKR-4',status:'On Progress',cabang:'Raha',teknisi:'Teknisi Raha'}];
  const h=harness({tickets,profiles}),r=await h.c.dispatch({action:'getTeknisiOnProgress',cabang:'Raha'},{...actor,role:'admin',access:'Semua'});
  assert.equal(r.cabang,'Kendari');assert.equal(r.data.length,2);
  const a=r.data.find(x=>x.nama==='Teknisi A');assert.deepEqual(Array.from(a.tiket),['TKT-1','TKT-2']);
  assert.deepEqual(Object.keys(a).sort(),['nama','tiket']);
});
test('manager/director can select permitted branch; regular staff cannot use working roster API',async()=>{
  const h=harness();
  for(const role of ['manager','direktur'])assert.equal((await h.c.workingTechnicians({cabang:'Raha'},{...actor,role,access:'Semua'})).cabang,'Raha');
  for(const role of ['sales','teknisi'])await assert.rejects(()=>h.c.dispatch({action:'getTeknisiOnProgress'}, {...actor,role}),/Akses/);
});
test('status endpoints still require a verified login at the HTTP boundary',async()=>{
  const h=harness();
  for(const action of ['getStatusKehadiranCabang','getTeknisiOnProgress']) {
    const response=await h.handler(new Request('https://db.test/functions/v1/sla-payroll-attendance',{method:'POST',headers:{Origin:'https://aplikasisla.vercel.app','Content-Type':'application/json'},body:JSON.stringify({action})}));
    assert.equal(response.status,401);assert.equal(h.calls.length,0);
  }
});
