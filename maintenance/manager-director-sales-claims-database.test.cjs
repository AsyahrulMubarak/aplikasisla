const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test,before,after}=require('node:test');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{({PGlite}=require(path.resolve(__dirname,'../tmp/sales-claims-qa/node_modules/@electric-sql/pglite')));}
const db=new PGlite(),photo='data:image/jpeg;base64,'+'A'.repeat(100);let original;
const rows=async sql=>(await db.query(sql)).rows;
async function role(name='service_role'){
 await db.exec('reset role; set role '+name);
 await db.query("select set_config('request.jwt.claim.role',$1,false),set_config('request.headers',$2,false)",[name,JSON.stringify(name==='service_role'?{'x-sla-claims-runtime':'supabase-edge'}:{})]);
}
async function submit(id,branch){
 await role();await db.query('insert into public.tiket(id_tiket,cabang,sales) values ($1,$2,$3)',[id,branch,'']);
 await db.query('select public.sla_ajukan_klaim_sales($1,$2,$3,$4,$5)',['sales-fixture',id,branch,'Keterangan contoh',photo]);
}
const decide=(id,branch,actor,decision='Diterima',reason='')=>db.query('select public.sla_respon_klaim_sales($1,$2,$3,$4,$5) as result',[actor,id,branch,decision,reason]);
before(async()=>{
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role',true) $$;
 grant usage on schema auth,public to anon,authenticated,service_role;
 create table public.users(username text,username_login text unique,nama_asli text,role text,hak_akses_cabang text,cabang text,no_wa text);
 create table public.tiket(id_tiket text primary key,cabang text,sales text,status_banding text,sales_pengaju text,bukti_banding text,keterangan_sales text,alasan_admin text,klien_lokasi text,jenis_pekerjaan text);
 grant all on public.users,public.tiket to service_role,authenticated;
 insert into public.users values
 ('admin-k','admin-k','Admin Example','admin','Kendari','Kendari',''),
 ('manager-all','manager-all','Manager Example','manager','Semua','Kendari',''),
 ('director-all','director-all','Director Example','direktur','Semua','Kendari',''),
 ('manager-r','manager-r','Manager Raha Example','manager','Raha','Raha',''),
 ('director-k','director-k','Director Kendari Example','direktur','Kendari','Kendari',''),
 ('manager-home','manager-home','Manager Home Example','manager',null,'Raha',''),
 ('sales-fixture','sales-fixture','Sales Example','sales','Kendari','Kendari',''),
 ('tech','tech','Technician Example','teknisi','Semua','Kendari',''),
 ('admin-raha','admin-raha','Admin Raha Example','admin_raha','Raha','Raha','');
 insert into public.tiket values ('UNCHANGED','Raha','Existing Sales',null,null,null,null,null,'Fixture','Fixture');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'sales-claims.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'sales-claims-supabase.sql'),'utf8'));
 original=await rows("select * from public.tiket where id_tiket='UNCHANGED'");
 const migration=fs.readFileSync(path.join(__dirname,'manager-director-sales-claims.sql'),'utf8');
 await db.exec(migration);await db.exec(migration);await role();
});
after(async()=>db.close());
test('new migration repeats safely and preserves existing ticket ownership and claim fields',async()=>{
 assert.deepEqual(await rows("select * from public.tiket where id_tiket='UNCHANGED'"),original);
});
test('Manager accepts and Director rejects on either permitted branch; audit records the actual decision maker',async()=>{
 for(const [actor,decision] of [['manager-all','Diterima'],['director-all','Ditolak']])for(const branch of ['Kendari','Raha']){
  const id=actor+'-'+branch;await submit(id,branch);await decide(id,branch,actor,decision,'Alasan contoh');
  const t=(await db.query('select * from public.tiket where id_tiket=$1',[id])).rows[0];
  assert.equal(t.status_banding,decision);assert.equal(t.klaim_sales_admin,actor);assert.ok(t.klaim_sales_diputuskan_pada);
  assert.equal(t.sales,decision==='Diterima'?'Sales Example':'');
  assert.equal(t.alasan_admin,decision==='Ditolak'?'Alasan contoh':null);
  const events=(await db.query('select * from public.sla_notif_klaim_sales where klaim_id=$1 and jenis=$2',[t.klaim_sales_id,decision])).rows;
  assert.equal(events.length,1);assert.equal(events[0].penerima_username,'sales-fixture');
 }
});
test('single-branch management and home-branch fallback cannot decide outside stored access',async()=>{
 for(const [actor,allowed,denied] of [['manager-r','Raha','Kendari'],['director-k','Kendari','Raha'],['manager-home','Raha','Kendari']]){
  const permitted=actor+'-allowed';await submit(permitted,allowed);await decide(permitted,allowed,actor);
  const blocked=actor+'-denied';await submit(blocked,denied);await assert.rejects(decide(blocked,denied,actor),/hak akses cabang/);
  assert.equal((await db.query('select status_banding from public.tiket where id_tiket=$1',[blocked])).rows[0].status_banding,'Diajukan');
 }
});
test('other roles, invalid decisions, empty rejection reasons and repeated decisions never mutate the claim',async()=>{
 await submit('DENIED','Raha');
 for(const actor of ['sales-fixture','tech','admin-raha'])await assert.rejects(decide('DENIED','Raha',actor),/role atau hak akses/);
 await assert.rejects(decide('DENIED','Raha','manager-all','Ditolak',' '),/Alasan penolakan/);
 await assert.rejects(decide('DENIED','Raha','manager-all','Fake'),/Keputusan tidak valid/);
 await decide('DENIED','Raha','manager-all');await assert.rejects(decide('DENIED','Raha','director-all'),/sudah diproses/);
 assert.equal((await rows("select klaim_sales_admin from public.tiket where id_tiket='DENIED'"))[0].klaim_sales_admin,'manager-all');
});
test('public RPCs and old Apps Script paths remain denied; Admin Kendari retains both branches',async()=>{
 for(const name of ['anon','authenticated']){
  await role(name);await assert.rejects(decide('DENIED','Raha','manager-all'),/permission denied/);
  await assert.rejects(db.query("select public.sla_pengelola_klaim_sales('manager','Semua','Kendari','Raha')"),/permission denied/);
 }
 await submit('ADMIN-UNCHANGED','Raha');await decide('ADMIN-UNCHANGED','Raha','admin-k');
 await db.query("select set_config('request.headers','{}',false)");await assert.rejects(decide('DENIED','Raha','manager-all'),/Supabase Edge/);await role();
});
