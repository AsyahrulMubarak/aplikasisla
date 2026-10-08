'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test,before,after}=require('node:test');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{({PGlite}=require('../tmp/sales-claims-qa/node_modules/@electric-sql/pglite'));}
const db=new PGlite(),read=f=>fs.readFileSync(path.join(__dirname,'..','maintenance',f),'utf8');
const migration=read('leave-approved-duration.sql');
const date=value=>new Date(value).toISOString().slice(0,10);
before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table public.absensi(id_absen text primary key,nama_pegawai text,waktu_absen timestamptz,tipe_absen text,status_disiplin text);
    create table public.pengajuan_cuti(id_pengajuan text primary key,nama_pegawai text,jenis text,tanggal_mulai date,tanggal_selesai date,status text);
    alter table public.pengajuan_cuti enable row level security;
    insert into pengajuan_cuti values('old','Old','Izin','2026-10-08','2026-10-14','Disetujui');`);
  await db.exec(read('sick-continuation.sql'));
  await db.exec(migration);await db.exec(migration);
});
after(()=>db.close());
async function leave(id,days=3,kind='Izin',status='Disetujui'){
  await db.query(`insert into pengajuan_cuti(id_pengajuan,nama_pegawai,jenis,tanggal_mulai,tanggal_selesai,status,tanggal_selesai_disetujui)
    values($1,$1,$2,'2026-10-08','2026-10-14',$3,$4)`,[id,kind,status,days==null?null:'2026-10-'+String(7+days).padStart(2,'0')]);
}
test('Repeatable upgrade preserves old requested range, NULL approval fallback and RLS',async()=>{
  const row=(await db.query("select * from pengajuan_cuti where id_pengajuan='old'")).rows[0];
  assert.equal(date(row.tanggal_selesai),'2026-10-14');assert.equal(row.tanggal_selesai_disetujui,null);
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.pengajuan_cuti'::regclass")).rows[0].relrowsecurity,true);
  assert.equal((await db.query("select count(*)::int n from pg_constraint where conname='sla_izin_durasi_disetujui_valid'")).rows[0].n,1);
});
test('Database accepts 1, 3, or 7 days and rejects dates outside the requested range and durations for other statuses/kinds',async()=>{
  for(const days of [1,3,7]){await leave('valid-'+days,days);const row=(await db.query('select * from pengajuan_cuti where id_pengajuan=$1',['valid-'+days])).rows[0];assert.equal(date(row.tanggal_selesai),'2026-10-14');}
  for(const [id,days,kind,status]of [['zero',0,'Izin','Disetujui'],['over',8,'Izin','Disetujui'],['sick',3,'Sakit','Disetujui'],['pending',3,'Izin','Menunggu'],['rejected',3,'Izin','Ditolak']])
    await assert.rejects(leave(id,days,kind,status),/sla_izin_durasi_disetujui_valid/);
});
test('Late approval ignores a physical return after the approved period, then tracks an earlier return and corrections',async()=>{
  await leave('late',null,'Izin','Menunggu');
  await db.exec("insert into absensi values('late-actual','late','2026-10-12 08:00:00+08','Masuk','Tepat Waktu')");
  await db.exec("update pengajuan_cuti set status='Disetujui',tanggal_selesai_disetujui='2026-10-10' where id_pengajuan='late'");
  const saved=async()=>(await db.query("select * from pengajuan_cuti where id_pengajuan='late'")).rows[0];
  assert.equal((await saved()).kembali_bekerja_pada,null);
  await db.exec("insert into absensi values('early-actual','late','2026-10-09 12:00:00+08','Masuk Setelah Istirahat','Tepat Waktu')");
  assert.equal(new Date((await saved()).kembali_bekerja_pada).toISOString(),'2026-10-09T04:00:00.000Z');
  await db.exec("update absensi set status_disiplin='Koreksi Manual' where id_absen='early-actual'");
  assert.equal((await saved()).kembali_bekerja_pada,null);assert.equal(date((await saved()).tanggal_selesai),'2026-10-14');
});
test('Sickness still continues beyond its old requested end until a real return',async()=>{
  await leave('ongoing',null,'Sakit');
  await db.exec("insert into absensi values('sick-return','ongoing','2026-10-20 08:00:00+08','Masuk','Tepat Waktu')");
  assert.equal(new Date((await db.query("select kembali_bekerja_pada from pengajuan_cuti where id_pengajuan='ongoing'")).rows[0].kembali_bekerja_pada).toISOString(),'2026-10-20T00:00:00.000Z');
});
test('Internal trigger functions remain unavailable to browser roles',async()=>{
  for(const role of ['anon','authenticated'])for(const fn of ['sla_pengajuan_tetapkan_kembali()','sla_sinkron_kembali_pengajuan(text)'])
    assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,'public.'+fn])).rows[0].allowed,false);
});
