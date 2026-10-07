const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {test,before,after}=require('node:test');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{({PGlite}=require(path.resolve(__dirname,fs.existsSync(path.resolve(__dirname,'../tmp/sales-claims-qa'))?'../tmp/sales-claims-qa/node_modules/@electric-sql/pglite':'../../sales-claims-qa/node_modules/@electric-sql/pglite')));}
const db=new PGlite();
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261007093221_sla_pengerjaan_sejak_penugasan.sql'),'utf8');
async function query(sql,values=[]){return (await db.query(sql,values)).rows;}
async function role(name='authenticated'){await db.exec('reset role; set role '+name);}
async function row(id){return (await query('select * from public.tiket where id_tiket=$1',[id]))[0];}
async function create(id,tech='',branch='Kendari'){
  await role();await query("insert into public.tiket(id_tiket,teknisi,cabang,status,waktu_lapor,target_sla_jam,target_sla_respon_jam,tenggat_waktu,waktu_penugasan) values($1,$2,$3,'Menunggu','2020-01-01T08:00:00+08:00','9',1,'2020-01-02T08:00:00+08:00','2020-01-01T08:00:00+08:00')",[id,tech,branch]);return row(id);
}
before(async()=>{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.tiket(id_tiket text primary key, waktu_lapor timestamptz,target_sla_jam text,
      tenggat_waktu timestamptz,teknisi text,status text,waktu_selesai timestamptz,status_sla text,
      poin_performa numeric,target_sla_respon_jam numeric,tenggat_respon timestamptz,waktu_respon timestamptz,
      status_sla_respon text,status_peringatan text,tenggat_pengganti timestamptz,cabang text,keterangan text);
    grant usage on schema public to authenticated,service_role,anon;
    grant all on public.tiket to authenticated,service_role;
    insert into public.tiket(id_tiket,teknisi,status,waktu_lapor,target_sla_jam,tenggat_waktu,tenggat_respon,target_sla_respon_jam,cabang,status_sla) values
      ('LEGACY-A','Teknisi A','On Progress','2026-10-01T08:00:00+08:00','9','2026-10-02T10:00:00+08:00','2026-10-07T10:00:00+08:00',1,'Kendari','AMAN'),
      ('LEGACY-U','Belum Ditugaskan','Menunggu','2020-01-01T08:00:00+08:00','9','2020-01-02T10:00:00+08:00',null,1,'Kendari','TERLAMBAT'),
      ('LEGACY-D','Teknisi A','Selesai','2020-01-01T08:00:00+08:00','9','2020-01-02T10:00:00+08:00','2020-01-01T09:00:00+08:00',1,'Kendari','TERPENUHI');`);
  await db.exec(migration);await db.exec(migration);
});
after(async()=>db.close());
test('legacy active records are backed up; waiting work has no deadline and closed history is preserved',async()=>{
  await role('service_role');const a=await row('LEGACY-A'),u=await row('LEGACY-U'),d=await row('LEGACY-D');
  assert.equal(a.waktu_penugasan.toISOString(),'2026-10-07T01:00:00.000Z');assert.equal(a.sumber_waktu_penugasan,'riwayat_respon');
  assert.equal(u.tenggat_waktu,null);assert.equal(u.status_sla,'BELUM DIMULAI');
  assert.equal(d.waktu_penugasan,null);assert.equal(d.tenggat_waktu.toISOString(),'2020-01-02T02:00:00.000Z');assert.equal(d.status_sla,'TERPENUHI');
  assert.equal((await query('select * from public.sla_backup_awal_pengerjaan')).length,2);
  await role();await assert.rejects(()=>query('select * from public.sla_backup_awal_pengerjaan'),/permission denied/);
});
test('creating an unassigned ticket cannot start work or carry a client-supplied assignment time',async()=>{
  for(const [n,tech] of [['1',''],['2','-'],['3','belum ditugaskan']]){
    const t=await create('EMPTY'+n,tech);assert.equal(t.waktu_penugasan,null);assert.equal(t.tenggat_waktu,null);assert.equal(t.tenggat_respon,null);assert.equal(t.status_sla,'BELUM DIMULAI');
  }
});
test('first assignment uses database time and full target instead of old report time',async()=>{
  await create('FIRST');await query("update public.tiket set teknisi='Teknisi A',waktu_penugasan='2000-01-01T00:00:00Z' where id_tiket='FIRST'");
  const t=await row('FIRST');assert.ok(Math.abs(Date.now()-t.waktu_penugasan.getTime())<20000);assert.equal(t.sumber_waktu_penugasan,'server');assert.equal(t.status_sla,'AMAN');
  const expected=(await query("select public.sla_tenggat_pengerjaan($1,9,'Kendari') as finish",[t.waktu_penugasan]))[0].finish;
  assert.equal(t.tenggat_waktu.getTime(),expected.getTime());
});
test('assigned creation starts immediately; ordinary edits and teammate additions keep the original start and deadline',async()=>{
  const t=await create('EDIT','Teknisi A');
  await query("update public.tiket set keterangan='Catatan baru',teknisi='Teknisi A, Teknisi B',waktu_penugasan='2099-01-01T00:00:00Z',sumber_waktu_penugasan='forged',tenggat_waktu='2099-01-01T00:00:00Z' where id_tiket='EDIT'");
  const after=await row('EDIT');assert.equal(after.waktu_penugasan.getTime(),t.waktu_penugasan.getTime());assert.equal(after.tenggat_waktu.getTime(),t.tenggat_waktu.getTime());assert.equal(after.sumber_waktu_penugasan,'server');
});
test('target edits calculate from the same assignment and never from report creation',async()=>{
  const t=await create('TARGET','Teknisi A');await query("update public.tiket set target_sla_jam='12' where id_tiket='TARGET'");
  const after=await row('TARGET');const expected=(await query("select public.sla_tenggat_pengerjaan($1,12,'Kendari') as finish",[t.waktu_penugasan]))[0].finish;
  assert.equal(after.waktu_penugasan.getTime(),t.waktu_penugasan.getTime());assert.equal(after.tenggat_waktu.getTime(),expected.getTime());
});
test('explicit replacement gives the replacement team its own clock and keeps the replacement deadline consistent',async()=>{
  await create('REPLACE','Teknisi A');await query("update public.tiket set teknisi='Teknisi B',tenggat_pengganti='2099-01-01T00:00:00Z',waktu_respon=null,status_peringatan='[ADMIN_SLA_FAILED] [RESPON_WARNED] [PENGERJAAN_WARNED]' where id_tiket='REPLACE'");
  const t=await row('REPLACE');assert.equal(t.tenggat_pengganti.getTime(),t.tenggat_waktu.getTime());assert.equal(t.status_sla,'AMAN');assert.ok(Math.abs(Date.now()-t.waktu_penugasan.getTime())<20000);
  assert.ok(t.status_peringatan.includes('[ADMIN_SLA_FAILED]'));assert.ok(!t.status_peringatan.includes('PENGERJAAN_WARNED'));
});
test('removing and restoring assignees does not create a way to reset the SLA',async()=>{
  const t=await create('RESTORE','Teknisi A');await query("update public.tiket set teknisi='Belum Ditugaskan' where id_tiket='RESTORE'");
  assert.equal((await row('RESTORE')).status_sla,'BELUM DIMULAI');await query("update public.tiket set teknisi='Teknisi A' where id_tiket='RESTORE'");
  const after=await row('RESTORE');assert.equal(after.waktu_penugasan.getTime(),t.waktu_penugasan.getTime());assert.equal(after.tenggat_waktu.getTime(),t.tenggat_waktu.getTime());
});
test('Pending and Outsource keep their states; existing pause extension is retained on resume',async()=>{
  const t=await create('PAUSE','Teknisi A');
  for(const status of ['Pending','Outsource']){await query("update public.tiket set status=$1 where id_tiket='PAUSE'",[status]);assert.equal((await row('PAUSE')).status_sla,status==='Pending'?'DIPENDING':'DIOPOR');}
  const extension=new Date(t.tenggat_waktu.getTime()+86400000);
  await query("update public.tiket set status='On Progress',tenggat_waktu=$1 where id_tiket='PAUSE'",[extension]);assert.equal((await row('PAUSE')).tenggat_waktu.getTime(),extension.getTime());
});
test('completion uses the assignment deadline and document edits do not rewrite closed historical results',async()=>{
  const t=await create('COMPLETE','Teknisi A');await query("update public.tiket set status='Selesai',waktu_selesai=$1 where id_tiket='COMPLETE'",[new Date(t.tenggat_waktu.getTime()-1000)]);
  assert.equal((await row('COMPLETE')).status_sla,'TERPENUHI');await query("update public.tiket set keterangan='Edit BA',waktu_penugasan='2099-01-01T00:00:00Z',tenggat_waktu='2099-01-01T00:00:00Z' where id_tiket='COMPLETE'");
  const after=await row('COMPLETE');assert.equal(after.status_sla,'TERPENUHI');assert.equal(after.waktu_penugasan.getTime(),t.waktu_penugasan.getTime());assert.equal(after.tenggat_waktu.getTime(),t.tenggat_waktu.getTime());
});
test('17:00 Kendari assignment consumes no off-hours and nine hours end 9 October 10:30 WITA',async()=>{
  const rows=await query("select public.sla_tenggat_pengerjaan('2026-10-07T17:00:00+08:00',9,'Kendari') as finish, public.sla_tenggat_pengerjaan('2026-10-07T17:00:00+08:00',2,'Raha') as raha");
  assert.equal(rows[0].finish.toISOString(),'2026-10-09T02:30:00.000Z');assert.equal(rows[0].raha.toISOString(),'2026-10-07T11:00:00.000Z');
});
test('a privileged repair can use the user-confirmed historical assignment without altering response timing',async()=>{
  const initial=await create('CONFIRMED','Teknisi A');await role('postgres');
  await query("update public.tiket set waktu_penugasan='2026-10-07T17:00:00+08:00',sumber_waktu_penugasan='konfirmasi_pengguna' where id_tiket='CONFIRMED'");
  const t=await row('CONFIRMED');assert.equal(t.waktu_penugasan.toISOString(),'2026-10-07T09:00:00.000Z');assert.equal(t.tenggat_waktu.toISOString(),'2026-10-09T02:30:00.000Z');
  assert.equal(t.sumber_waktu_penugasan,'konfirmasi_pengguna');assert.equal(t.tenggat_respon.getTime(),initial.tenggat_respon.getTime());
});
test('legacy inversion respects prayer breaks and Sunday for each branch',async()=>{
  for(const branch of ['Kendari','Raha'])for(const start of ['2026-10-07T09:13:22+08:00','2026-10-10T16:15:00+08:00','2026-10-07T14:45:00+08:00']){
    const result=(await query('select public.sla_awal_dari_tenggat_respon(public.sla_tenggat_pengerjaan($1,1,$2),1,$2) as start',[start,branch]))[0].start;
    assert.equal(result.toISOString(),new Date(start).toISOString(),branch+' '+start);
  }
});
