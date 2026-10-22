const fs=require('node:fs'),{PGlite}=require('../tmp/sales-claims-qa/node_modules/@electric-sql/pglite');
const ids={central:'11111111-1111-4111-8111-111111111111',admin:'22222222-2222-4222-8222-222222222222',worker:'33333333-3333-4333-8333-333333333333',raha:'44444444-4444-4444-8444-444444444444',workerRaha:'55555555-5555-4555-8555-555555555555'};
const sessions=Object.fromEntries(Object.entries(ids).map(([k,v])=>[k,v.replace(/-4/, '-8')]));
async function accountFixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role authenticator;
 create schema auth;create schema storage;grant usage on schema auth,storage to authenticated,service_role;
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz,not_after timestamptz);
 create table users(username text primary key,username_login text unique,auth_id uuid unique,nama_asli text,role text,hak_akses_cabang text,cabang text,gaji_pokok numeric,email text,no_wa text);
 create table tiket(id_tiket text primary key,teknisi text,status text,penilaian_teknisi jsonb,bobot_poin numeric);
 create table payroll_bulanan(username text,periode text,bonus numeric,gaji numeric);
 create table sla_gaji_kredit(username text,periode text,kredit integer);
 create table sla_gaji_riwayat(username text,gaji numeric);
 create table storage.objects(id uuid primary key,name text);
 grant select on auth.sessions to service_role;
 grant all on users,tiket,payroll_bulanan,sla_gaji_kredit,sla_gaji_riwayat,storage.objects to service_role;
 grant select on users,tiket,payroll_bulanan,sla_gaji_kredit,sla_gaji_riwayat,storage.objects to authenticated;
 grant update on tiket to authenticated;
 insert into tiket values('TKT-OLD','Pegawai','Selesai','{"achievement":{"points":4},"bonusSnapshot":{"points":40}}',40),('TKT-OPEN','Pegawai','Pending',null,0);
 insert into payroll_bulanan values('worker','2026-10',200000,2000000);
 insert into sla_gaji_kredit values('worker','2026-09',1);insert into sla_gaji_riwayat values('worker',2000000);
 insert into storage.objects values('99999999-9999-4999-8999-999999999999','BA-tiket.pdf');`);
 const records=[['central','Admin Pusat','admin','Semua'],['admin','Admin Kendari','admin','Kendari'],['worker','Pegawai','teknisi','Kendari'],['raha','Admin Raha','admin_raha','Raha'],['workerRaha','Pegawai Raha','teknisi','Raha']];
 for(const [key,name,role,branch] of records){await db.query('insert into users values($1,lower($1),$2,$3,$4,$5,$5,2000000,$6,$7)',[key,ids[key],name,role,branch,key+'@example.test','6280000000000']);await db.query("insert into auth.sessions values($1,$2,now()-interval '1 day',null)",[sessions[key],ids[key]]);}
 for(const t of ['users','tiket','payroll_bulanan','sla_gaji_kredit','sla_gaji_riwayat','storage.objects'])await db.exec(`alter table ${t} enable row level security;create policy old_access on ${t} for all to authenticated using(true) with check(true);`);
 await db.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261022005850_employee_account_access.sql','utf8'));
 const claims=(key,session=sessions[key])=>({sub:ids[key],session_id:session,role:'authenticated'});
 const as=async(key,sql,params=[],session=sessions[key])=>{await db.query('select set_config($1,$2,false)',['request.jwt.claims',JSON.stringify(claims(key,session))]);await db.exec('set role authenticated');try{return await db.query(sql,params)}finally{await db.exec('reset role')}};
 const begin=async(actor='admin',user='worker',active=false,version=0,reason='Pegawai keluar')=>(await db.query('select sla_begin_account_access($1,$2,$3,$4,$5) r',[ids[actor],user,active,version,reason])).rows[0].r;
 const finish=async(user='worker',version=1,actor='admin')=>(await db.query('select sla_finish_account_access($1,$2,$3,$4) r',[ids[actor],user,ids[user],version])).rows[0].r;
 const user=async(key='worker')=>(await db.query('select * from users where username=$1',[key])).rows[0];
 const history=async()=>{const out={};for(const t of ['tiket','payroll_bulanan','sla_gaji_kredit','sla_gaji_riwayat','storage.objects'])out[t]=(await db.query('select * from '+t)).rows;out.identity=(await db.query('select username,auth_id,nama_asli,role,hak_akses_cabang,gaji_pokok from users order by username')).rows;return out};
 return {db,ids,sessions,as,begin,finish,user,history};
}
module.exports={accountFixture,ids,sessions};

