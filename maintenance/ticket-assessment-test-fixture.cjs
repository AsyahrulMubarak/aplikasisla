const fs=require('node:fs'),{PGlite}=require('../tmp/sales-claims-qa/node_modules/@electric-sql/pglite');
const ids={tech:'11111111-1111-4111-8111-111111111111',tech2:'22222222-2222-4222-8222-222222222222',admin:'33333333-3333-4333-8333-333333333333',manager:'44444444-4444-4444-8444-444444444444',admin2:'55555555-5555-4555-8555-555555555555',raha:'66666666-6666-4666-8666-666666666666',logistik:'77777777-7777-4777-8777-777777777777'};
const initialSql=fs.readFileSync(__dirname+'/../supabase/migrations/20261021032201_ticket_grade_optional_contribution.sql','utf8');
const directGradeSql=fs.readFileSync(__dirname+'/../supabase/migrations/20261021044837_admin_direct_ticket_grade.sql','utf8');
const directContributionSql=fs.readFileSync(__dirname+'/../supabase/migrations/20261021060011_admin_direct_default_contribution.sql','utf8');
const sql=initialSql+'\n'+directGradeSql+'\n'+directContributionSql;
async function fixture({legacy=false}={}){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
 grant usage on schema auth to authenticated,service_role;
 create table users(username text primary key,auth_id uuid,role text,nama_asli text,hak_akses_cabang text,cabang text,gaji_pokok numeric);
 create table tiket(id_tiket text primary key,teknisi text,teknisi_sebelumnya text,riwayat_penggantian_teknisi jsonb,cabang text,status text,status_pembayaran text,waktu_selesai timestamptz,jenis_pekerjaan text,deskripsi_pekerjaan_ba text,nama_customer text,tanda_tangan text,bobot_poin numeric,status_sla text,tanggal_lunas timestamptz,no_transaksi text,veto_admin text);
 insert into users values
 ('tech','${ids.tech}','teknisi','Teknisi A','Kendari','Kendari',2000000),('tech2','${ids.tech2}','teknisi','Teknisi B','Kendari','Kendari',2000000),
 ('admin','${ids.admin}','admin','Admin','Kendari','Kendari',2200000),('manager','${ids.manager}','manager','Manager','Semua','Kendari',2600000),
 ('admin2','${ids.admin2}','admin','Admin Kedua','Kendari','Kendari',2200000),('raha','${ids.raha}','admin_raha','Admin Raha','Raha','Raha',2200000),('logistik','${ids.logistik}','logistik','Logistik','Kendari','Kendari',2000000);
 insert into tiket(id_tiket,teknisi,cabang,status,status_pembayaran,jenis_pekerjaan,bobot_poin,status_sla) values
 ('TKT-1','Teknisi A, Teknisi B','Kendari','On Progress','Belum Lunas','Diagnosis perangkat',60,'TERPENUHI'),
 ('TKT-2','Teknisi A','Kendari','On Progress','Belum Lunas','Servis',10,'TERPENUHI'),
 ('TKT-PAID','Teknisi A','Kendari','Selesai','Lunas','Historis',60,'TERPENUHI'),
 ('TKT-R-1','Teknisi B','Raha','On Progress','Belum Lunas','Servis Raha',10,'TERPENUHI');
 grant select on users to authenticated,service_role; grant all on tiket to authenticated,service_role;
 alter table tiket enable row level security;create policy legacy on tiket for all to authenticated using(true) with check(true);
 set request.jwt.claim.role='service_role';`);
 await db.exec(legacy?initialSql:sql);
 const read=async(id='TKT-1',actor='admin')=>(await db.query('select public.sla_penilaian_tiket($1,$2,$3,0) result',[ids[actor],id,'read'])).rows[0].result;
 const act=async(action,data={},actor='tech',id='TKT-1',revision)=>(await db.query('select public.sla_penilaian_tiket($1,$2,$3,$4,$5) result',[ids[actor],id,action,revision??(await read(id,actor)).assessment?.revision??0,JSON.stringify(data)])).rows[0].result;
 return {db,read,act,ids,sql,directGradeSql,directContributionSql};
}
module.exports={fixture,ids,sql,directGradeSql,directContributionSql};
