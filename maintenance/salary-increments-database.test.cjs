const {test,before,beforeEach,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{({PGlite}=require(path.resolve(__dirname,fs.existsSync(path.resolve(__dirname,'../tmp/sales-claims-qa'))?'../tmp/sales-claims-qa/node_modules/@electric-sql/pglite':'../../sales-claims-qa/node_modules/@electric-sql/pglite')));}
const db=new PGlite(),migration=fs.readFileSync(__dirname+'/salary-increments.sql','utf8');
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function clock(value){await db.exec(`create or replace function sla_gaji_sekarang() returns timestamptz language sql stable as $$ select '${value}'::timestamptz $$`);}
async function user(username='tech',salary=1500000,role='teknisi',branch='Kendari',name=username){await db.query('insert into users(username,nama_asli,gaji_pokok,role,hak_akses_cabang,cabang,no_wa,auth_id) values($1,$2,$3,$4,$5,$5,$6,$7)',[username,name,salary,role,branch,'081234567890',username==='admin'?'11111111-1111-1111-1111-111111111111':null]);}
async function attendance(username,period,{late=0,alpa=0,time='08:00:00',branch='Kendari',lunch=false}={}){
 const [year,month]=period.split('-').map(Number),days=new Date(Date.UTC(year,month,0)).getUTCDate();let absent=0,lateUsed=0;
 for(let n=1;n<=days;n++){const date=period+'-'+String(n).padStart(2,'0');if(new Date(date+'T12:00:00Z').getUTCDay()===0)continue;
  if(absent++<alpa)continue;const when=lateUsed++<late?'10:00:00':time;
  await db.query('insert into absensi values($1,$2,$3,$4,$5,$6)',[username+'-'+date,date+'T'+when+'+08:00',username,'Masuk','Tepat Waktu',branch]);
  if(lunch)await db.query('insert into absensi values($1,$2,$3,$4,$5,$6)',[username+'-lunch-'+date,date+'T15:00:00+08:00',username,'Masuk Setelah Istirahat','Terlambat Setelah Istirahat',branch]);
 }
}
const evaluate=()=>scalar('select sla_evaluasi_kenaikan_gaji() result');
const amount=async(u='tech',p='2027-04')=>(await scalar('select sla_gaji_nominal_periode($1,$2) n',[u,p])).n;
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
 create table users(username text primary key,auth_id uuid,role text,nama_asli text,hak_akses_cabang text,cabang text,no_wa text,gaji_pokok numeric);
 create table absensi(id_absen text,waktu_absen timestamptz,nama_pegawai text,tipe_absen text,status_disiplin text,cabang text);
 create table payroll_bulanan(periode text,nama_pegawai text,tanggal_libur_tambahan text,cabang text);
 create table pengajuan_cuti(id_pengajuan text,nama_pegawai text,status text,jenis text,tanggal_mulai date,tanggal_selesai date,cabang text,kembali_bekerja_pada timestamptz);
 set request.jwt.claim.role='service_role';`);
 await db.exec(migration);await db.exec(migration);
});
beforeEach(async()=>{await db.exec('truncate sla_notif_kenaikan_gaji,sla_gaji_disiplin_bulan,sla_gaji_riwayat,sla_gaji_program,users,absensi,payroll_bulanan,pengajuan_cuti restart identity cascade');await clock('2026-10-01T08:00:00+08:00');await db.exec("set request.jwt.claim.role='service_role'");});
after(()=>db.close());
test('Only closed months from October count; day 5 stays editable and day 6 evaluates',async()=>{
 await user();await attendance('tech','2026-09');await attendance('tech','2026-10');
 await clock('2026-11-05T23:59:59+08:00');assert.equal((await evaluate()).result.bulanDievaluasi,0);
 await clock('2026-11-06T00:00:00+08:00');assert.equal((await evaluate()).result.bulanDievaluasi,1);
 assert.deepEqual((await db.query('select periode from sla_gaji_disiplin_bulan')).rows,[{periode:'2026-10'}]);assert.equal((await evaluate()).result.bulanDievaluasi,0);
});
test('Six good months accumulate across a failed month and are consumed exactly once',async()=>{
 await user();for(const p of ['2026-10','2026-11','2026-12','2027-01','2027-02','2027-03','2027-04'])await attendance('tech',p,{late:p==='2027-01'?4:3,alpa:2,lunch:true});
 await clock('2027-04-06T06:15:00+08:00');assert.equal((await evaluate()).result.kenaikan,0);assert.equal(await amount(), '1500000');
 await clock('2027-05-06T06:15:00+08:00');assert.equal((await evaluate()).result.kenaikan,1);assert.equal(await amount('tech','2027-05'),'1750000');
 const h=(await db.query("select * from sla_gaji_riwayat where jenis='Otomatis'")).rows;assert.equal(h.length,1);assert.deepEqual(h[0].bulan_dipakai,['2026-10','2026-11','2026-12','2027-02','2027-03','2027-04']);
 assert.equal((await evaluate()).result.kenaikan,0);assert.equal((await db.query('select * from sla_notif_kenaikan_gaji')).rows.length,1);
 assert.equal(await amount('tech','2027-04'),'1500000');assert.equal(await amount('tech','2026-09'),'1500000');
});
test('Repeated six-month cycles, stable history and Rp3 million cap',async()=>{
 await user('tech',2600000);await user('zero',0);await user('cap',3000000);
 for(let n=0;n<18;n++){const d=new Date(Date.UTC(2026,9+n,1)),p=d.toISOString().slice(0,7);await attendance('tech',p);}
 await clock('2028-04-06T06:15:00+08:00');assert.equal((await evaluate()).result.kenaikan,2);
 assert.equal(await amount('tech','2028-04'),'3000000');assert.equal(await amount('tech','2028-03'),'2600000');
 const h=(await db.query("select gaji_lama,gaji_baru from sla_gaji_riwayat where jenis='Otomatis' order by urutan")).rows;
 assert.deepEqual(h,[{gaji_lama:'2600000',gaji_baru:'2850000'},{gaji_lama:'2850000',gaji_baru:'3000000'}]);
 assert.equal((await db.query('select * from sla_gaji_disiplin_bulan')).rows.length,12);assert.equal((await evaluate()).result.kenaikan,0);
});
test('Morning thresholds use whole minutes and branch hours, never lunch lateness',async()=>{
 await user();await user('raha',1500000,'teknisi','Raha');await user('raha-admin',1500000,'admin_raha','Raha');
 await attendance('tech','2026-10',{time:'08:45:59',lunch:true});await attendance('raha','2026-10',{time:'09:45:59',branch:'Raha'});await attendance('raha-admin','2026-10',{time:'08:46:00',branch:'Raha'});
 assert.deepEqual(await scalar("select * from sla_disiplin_kenaikan_gaji('tech','2026-10')"),{telat_pagi:0,alpa:0});
 assert.equal((await scalar("select * from sla_disiplin_kenaikan_gaji('raha','2026-10')")).telat_pagi,0);
 assert.ok((await scalar("select * from sla_disiplin_kenaikan_gaji('raha-admin','2026-10')")).telat_pagi>3);
});
test('Alpa >2 fails; approved Izin, sick leave, extra holidays and overnight exit excuse attendance',async()=>{
 await user();await attendance('tech','2026-10',{alpa:3});assert.equal((await scalar("select * from sla_disiplin_kenaikan_gaji('tech','2026-10')")).alpa,3);
 await db.exec("insert into payroll_bulanan values('2026-10','tech','1','Kendari');insert into pengajuan_cuti values('PGJ-1','tech','Disetujui','Izin','2026-10-02','2026-10-02','Kendari',null);insert into absensi values('night','2026-10-04T01:00:00+08:00','tech','Keluar','Lembur','Kendari');");
 assert.equal((await scalar("select * from sla_disiplin_kenaikan_gaji('tech','2026-10')")).alpa,0);
 await db.exec("delete from absensi;delete from payroll_bulanan;delete from pengajuan_cuti;insert into pengajuan_cuti values('PGJ-S','tech','Disetujui','Sakit','2026-10-01',null,'Kendari','2026-10-03T08:00:00+08:00');insert into absensi values('ABS-PGJ-S-20261004','2026-10-04T08:00:00+08:00','tech','Sakit','Pengajuan Disetujui','Kendari');");
 const s=await scalar("select * from sla_disiplin_kenaikan_gaji('tech','2026-10')");assert.equal(s.alpa,25);
});
test('No cross-branch mixing, ambiguous profiles skipped and new starters begin next full month',async()=>{
 await user();await attendance('tech','2026-10',{branch:'Raha'});assert.equal((await scalar("select * from sla_disiplin_kenaikan_gaji('tech','2026-10')")).alpa,27);
 await user('duplicate',1500000,'teknisi','Kendari','tech');await clock('2026-11-06T06:15:00+08:00');await evaluate();assert.ok((await db.query('select * from sla_gaji_disiplin_bulan')).rows.every(r=>!r.memenuhi_syarat&&r.alasan.includes('bernama sama')));
 await clock('2026-11-15T08:00:00+08:00');await user('new');assert.equal((await scalar("select mulai_periode from sla_gaji_program where username='new'")).mulai_periode,'2026-12');
});
test('Manual increases require management, CAS and branch permission; decreases and noops send no WA',async()=>{
 await user('admin',0,'admin','Semua');await user('tech',3000000);const args=['11111111-1111-1111-1111-111111111111','tech',3000000,3500000,'Kenaikan manajemen'];
 await db.query('select sla_ubah_gaji_manual($1,$2,$3,$4,$5)',args);assert.equal(await amount(),'3500000');assert.equal((await db.query('select * from sla_notif_kenaikan_gaji')).rows.length,1);
 await assert.rejects(db.query('select sla_ubah_gaji_manual($1,$2,$3,$4,$5)',args),/sudah berubah/);
 await db.query('select sla_ubah_gaji_manual($1,$2,$3,$4,$5)',[args[0],'tech',3500000,3500000,'Tidak berubah']);await db.query('select sla_ubah_gaji_manual($1,$2,$3,$4,$5)',[args[0],'tech',3500000,2500000,'Penyesuaian']);
 assert.equal((await db.query('select * from sla_notif_kenaikan_gaji')).rows.length,1);assert.equal((await scalar("select otomatis_selesai from sla_gaji_program where username='tech'")).otomatis_selesai,true);
 for(const role of ['sales','teknisi','admin_raha']){await db.query('update users set role=$1 where username=\'admin\'',[role]);await assert.rejects(db.query('select sla_ubah_gaji_manual($1,$2,$3,$4,$5)',[args[0],'tech',2500000,3500000,'Tes']),/khusus/);}
 await db.exec("update users set role='manager',hak_akses_cabang='Raha' where username='admin'");await assert.rejects(db.query('select sla_ubah_gaji_manual($1,$2,$3,$4,$5)',[args[0],'tech',2500000,3500000,'Tes']),/cabang/);
 await db.exec("set request.jwt.claim.role='authenticated'");await assert.rejects(evaluate(),/Akses server/);
});
test('Notification leasing prevents duplicate sends and retains failures for retry',async()=>{
 await user('admin',0,'direktur','Semua');await user();await db.query('select sla_ubah_gaji_manual($1,$2,$3,$4,$5)',['11111111-1111-1111-1111-111111111111','tech',1500000,2000000,'Prestasi']);
 const e=(await db.query('select * from sla_ambil_notif_gaji()')).rows[0];assert.ok(e.pesan.includes('2,000,000'));assert.equal((await db.query('select * from sla_ambil_notif_gaji()')).rows.length,0);
 assert.equal((await scalar('select sla_selesai_notif_gaji($1,$2,false,$3) ok',[e.id,e.lease,'Provider gagal'])).ok,true);assert.equal((await db.query('select * from sla_ambil_notif_gaji()')).rows.length,0);
 await db.exec("update sla_notif_kenaikan_gaji set coba_lagi_pada=now()-interval '1 minute'");const retry=(await db.query('select * from sla_ambil_notif_gaji()')).rows[0];assert.equal(retry.percobaan,2);
 assert.equal((await scalar('select sla_selesai_notif_gaji($1,$2,true,null) ok',[e.id,e.lease])).ok,false);
 assert.equal((await scalar('select sla_selesai_notif_gaji($1,$2,true,null) ok',[e.id,retry.lease])).ok,true);assert.equal((await db.query('select * from sla_ambil_notif_gaji()')).rows.length,0);
});
