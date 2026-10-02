'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{test,before,after}=require('node:test');
const {PGlite}=require('../tmp/sales-claims-qa/node_modules/@electric-sql/pglite');
const db=new PGlite(),migration=fs.readFileSync(__dirname+'/../supabase/migrations/202610020001_attendance_storage_notifications.sql','utf8');
before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create schema storage;create schema vault;create schema cron;
    create function auth.role() returns text language sql as $$select coalesce(current_setting('test.actor_role',true),'service_role')$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table public.users(username text primary key,role text,hak_akses_cabang text,cabang text);
    create table public.absensi(id_absen text primary key);
    create table public.payroll_bulanan(id text primary key);
    create table public.sla_koreksi_luar_kota(id text primary key);
    create table public.pengajuan_cuti(id_pengajuan text primary key,role text,cabang text,status text);
    create table vault.secrets(name text);insert into vault.secrets values('sla_payroll_server_key');
    create table cron.job(jobid bigint generated always as identity,jobname text,schedule text,command text);
    create function cron.unschedule(bigint) returns boolean language sql as $$delete from cron.job where jobid=$1 returning true$$;
    create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid$$;
    insert into public.users values('admin','admin','Semua','Kendari'),('manager','manager','Semua','Kendari'),
      ('director','direktur','Semua','Kendari'),('raha','admin_raha','Raha','Raha'),('tech','teknisi','Kendari','Kendari');`);
  await db.exec(migration);await db.exec(migration);
});
after(()=>db.close());
test('Migration is repeatable, keeps photos private, and limits browser writes and queue access',async()=>{
  const b=(await db.query('select * from storage.buckets')).rows;assert.equal(b.length,1);assert.equal(b[0].public,false);
  for(const role of ['anon','authenticated']){
    assert.equal((await db.query("select has_function_privilege($1,'public.sla_ambil_notif_absensi(text)','execute') allowed",[role])).rows[0].allowed,false);
    assert.equal((await db.query("select has_table_privilege($1,'public.pengajuan_cuti','insert') allowed",[role])).rows[0].allowed,false);
  }
});
test('Transactional queue routes manager/admin/staff requests to their permitted approvers',async()=>{
  for(const [id,role,expected]of[['M','manager',['admin','director']],['A','admin',['director','manager']],['T','teknisi',['admin','director','manager']]]) {
    await db.query("insert into pengajuan_cuti values($1,$2,'Kendari','Menunggu',null)",[id,role]);
    assert.deepEqual((await db.query('select penerima_username from sla_notif_absensi where id_pengajuan=$1 order by penerima_username',[id])).rows.map(x=>x.penerima_username),expected);
  }
  await db.exec("begin;insert into pengajuan_cuti values('rollback','teknisi','Kendari','Menunggu',null);rollback;");
  assert.equal((await db.query("select count(*)::int n from sla_notif_absensi where id_pengajuan='rollback'")).rows[0].n,0);
});
test('Leases prevent concurrent delivery; failed attempts persist and stale acknowledgements cannot overwrite',async()=>{
  const first=(await db.query("select * from sla_ambil_notif_absensi('M')")).rows[0];
  const next=(await db.query("select * from sla_ambil_notif_absensi('M')")).rows[0];assert.notEqual(first.id,next.id);
  assert.equal((await db.query('select sla_selesai_notif_absensi($1,$2,false,$3) ok',[first.id,first.lease_id,'provider failure'])).rows[0].ok,true);
  assert.equal((await db.query('select sla_selesai_notif_absensi($1,$2,true,$3) ok',[first.id,first.lease_id,''])).rows[0].ok,false);
  const saved=(await db.query('select * from sla_notif_absensi where id=$1',[first.id])).rows[0];assert.equal(saved.terkirim_pada,null);assert.equal(saved.galat,'provider failure');assert.equal(saved.lease_id,null);
  assert.equal((await db.query("select * from sla_ambil_notif_absensi('M')")).rows.length,0);
});
test('Only server roles install a single retry job without exposing the Vault key',async()=>{
  await db.exec("select sla_installer_notif_absensi();select sla_installer_notif_absensi();");
  const jobs=(await db.query('select * from cron.job')).rows;assert.equal(jobs.length,1);assert.equal(jobs[0].jobname,'sla-notif-absensi');assert.match(jobs[0].command,/vault.decrypted_secrets/);
  await db.exec("set test.actor_role='authenticated'");await assert.rejects(db.query('select sla_installer_notif_absensi()'),/Akses server/);
  await assert.rejects(db.query('select * from sla_ambil_notif_absensi()'),/Akses server/);
});
