const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {test,before,after}=require('node:test');
const {PGlite}=require(path.resolve(__dirname,'../tmp/sales-claims-qa/node_modules/@electric-sql/pglite'));
const db=new PGlite();
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const role=async(name='authenticated')=>db.exec('reset role; set role '+name);
const row=async(id)=>(await query('select * from tiket where id_tiket=$1',[id]))[0];
async function create(id,branch='Kendari',target='4') {
  await role();
  await query("insert into tiket(id_tiket,teknisi,cabang,status,waktu_lapor,target_sla_jam,target_sla_respon_jam) values($1,'Teknisi A',$2,'On Progress','2026-10-01T08:00:00+08:00',$3,1)",[id,branch,target]);
  await role('postgres');
  await query("update tiket set waktu_penugasan='2026-10-10T08:00:00+08:00' where id_tiket=$1",[id]);
  return row(id);
}
async function pause(id,start='2026-10-10T10:00:00+08:00') {
  await role('postgres');
  await query("update tiket set status='Pending',sla_jeda_mulai=$2 where id_tiket=$1",[id,start]);
  await role();return row(id);
}
before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table tiket(id_tiket text primary key,waktu_lapor timestamptz,target_sla_jam text,tenggat_waktu timestamptz,
      teknisi text,status text,waktu_selesai timestamptz,status_sla text,poin_performa numeric,target_sla_respon_jam numeric,
      tenggat_respon timestamptz,waktu_respon timestamptz,status_sla_respon text,status_peringatan text,
      tenggat_pengganti timestamptz,cabang text,keterangan text,waktu_penugasan timestamptz,sumber_waktu_penugasan text);
    grant all on tiket to authenticated,service_role;
    insert into tiket values('LEGACY','2026-10-10T08:00:00+08:00','4','2026-10-10T12:00:00+08:00','Teknisi A','Pending',null,'DIPENDING',0,1,null,null,null,null,null,'Kendari',
      '[10/10/2026, 09.00] ➔ On Progress\n[10/10/2026, 10.00] ➔ Pending\n[10/10/2026, 11.00] ➔ Pending',
      '2026-10-10T08:00:00+08:00','server');`);
  await db.exec(fs.readFileSync(path.resolve(__dirname,'../supabase/migrations/20261007093221_sla_pengerjaan_sejak_penugasan.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.resolve(__dirname,'sla-pending-pause.sql'),'utf8'));
});
after(()=>db.close());
test('legacy pending keeps the first timestamp of the current pause and private backup',async()=>{
  await role('postgres');const t=await row('LEGACY');
  assert.equal(t.sla_jeda_mulai.toISOString(),'2026-10-10T02:00:00.000Z');assert.equal(Number(t.sla_jeda_sisa_detik),7200);
  await role();await assert.rejects(()=>query('select * from sla_backup_jeda_pengerjaan'),/permission denied/);
});
test('Pending saves remaining work; notes and forged pause/deadline edits cannot eat or restart it',async()=>{
  await create('PAUSE');const t=await pause('PAUSE');assert.equal(t.status_sla,'DIPENDING');assert.equal(Number(t.sla_jeda_sisa_detik),7200);
  await query("update tiket set keterangan='Catatan',sla_jeda_mulai='2099-01-01',sla_jeda_sisa_detik=999999,sla_jeda_total_detik=999999,tenggat_waktu='2099-01-01' where id_tiket='PAUSE'");
  const after=await row('PAUSE');assert.equal(after.sla_jeda_mulai.getTime(),t.sla_jeda_mulai.getTime());assert.equal(Number(after.sla_jeda_sisa_detik),7200);
  assert.equal(Number(after.sla_jeda_total_detik),0);assert.equal(after.tenggat_waktu.getTime(),t.tenggat_waktu.getTime());
});
test('resume uses exactly remaining time; stale client extensions and repeated saves cannot extend twice',async()=>{
  await create('RESUME');const p=await pause('RESUME');
  const resumed=(await query("update tiket set status='On Progress',tenggat_waktu='2099-01-01' where id_tiket='RESUME' returning *,statement_timestamp() as resumed_at"))[0];
  const due=(await query('select sla_tenggat_sisa($1,7200,\'Kendari\',null) as due',[resumed.resumed_at]))[0].due;
  assert.equal(resumed.tenggat_waktu.getTime(),due.getTime());assert.equal(resumed.sla_jeda_mulai,null);assert.equal(resumed.status_sla,'AMAN');
  await query("update tiket set status='On Progress',tenggat_waktu='2099-01-01' where id_tiket='RESUME'");
  const again=await row('RESUME');assert.equal(again.tenggat_waktu.getTime(),due.getTime());
  const total=(await query('select sla_detik_kerja($1,$2,\'Kendari\') as total',[p.sla_jeda_mulai,resumed.resumed_at]))[0].total;
  assert.equal(Number(again.sla_jeda_total_detik),Number(total));
});
test('working seconds exclude Sundays, lunch/prayer and off-hours; Raha has its own closing time',async()=>{
  const r=(await query(`select sla_detik_kerja('2026-10-10T11:30:00+08:00','2026-10-12T09:00:00+08:00','Kendari') as kendari,
    sla_detik_kerja('2026-10-10T11:30:00+08:00','2026-10-12T09:00:00+08:00','Raha') as raha,
    sla_detik_kerja('2026-10-12T08:00:15+08:00','2026-10-12T08:00:45+08:00','Kendari') as seconds`))[0];
  assert.equal(Number(r.kendari),14400);assert.equal(Number(r.raha),25200);assert.equal(Number(r.seconds),30);
});
test('multiple pause cycles and target edits preserve consumed time',async()=>{
  await create('MULTI');await pause('MULTI');
  await query("update tiket set target_sla_jam='6' where id_tiket='MULTI'");assert.equal(Number((await row('MULTI')).sla_jeda_sisa_detik),14400);
  await query("update tiket set status='On Progress' where id_tiket='MULTI'");const active=await row('MULTI');
  await query("update tiket set status='Pending' where id_tiket='MULTI'");const second=await row('MULTI');
  assert.ok(Number(second.sla_jeda_sisa_detik)>14395&&Number(second.sla_jeda_sisa_detik)<=14400);
  await query("update tiket set target_sla_jam='7' where id_tiket='MULTI'");const changed=await row('MULTI');
  assert.ok(Number(changed.sla_jeda_sisa_detik)>17995&&Number(changed.sla_jeda_sisa_detik)<=18000);
  assert.equal(changed.waktu_penugasan.getTime(),active.waktu_penugasan.getTime());
});
test('already overdue tickets remain overdue after resuming',async()=>{
  await create('LATE');const p=await pause('LATE','2026-10-10T13:45:00+08:00');assert.ok(Number(p.sla_jeda_sisa_detik)<0);
  await query("update tiket set status='On Progress' where id_tiket='LATE'");assert.equal((await row('LATE')).status_sla,'TERLAMBAT');
});
test('closing directly from Pending excludes the pause; later edits preserve historical results',async()=>{
  await create('CLOSE');await pause('CLOSE');
  await query("update tiket set status='Selesai',waktu_selesai=statement_timestamp() where id_tiket='CLOSE'");const t=await row('CLOSE');assert.equal(t.status_sla,'TERPENUHI');
  await query("update tiket set keterangan='BA',sla_jeda_total_detik=99999,tenggat_waktu='2099-01-01' where id_tiket='CLOSE'");
  const after=await row('CLOSE');assert.equal(after.tenggat_waktu.getTime(),t.tenggat_waktu.getTime());assert.equal(Number(after.sla_jeda_total_detik),Number(t.sla_jeda_total_detik));
});
test('technician replacement while Pending starts its own frozen budget, and response SLA is unchanged by pause',async()=>{
  const initial=await create('REPLACE');await pause('REPLACE');
  await query("update tiket set status='Outsource' where id_tiket='REPLACE'");assert.equal((await row('REPLACE')).status_sla,'DIOPOR');
  assert.equal((await row('REPLACE')).tenggat_respon.getTime(),initial.tenggat_respon.getTime());
  await query("update tiket set teknisi='Teknisi B',tenggat_pengganti='2099-01-01' where id_tiket='REPLACE'");
  const t=await row('REPLACE');assert.equal(Number(t.sla_jeda_sisa_detik),14400);assert.equal(Number(t.sla_jeda_total_detik),0);
  assert.equal(t.tenggat_pengganti.getTime(),t.tenggat_waktu.getTime());
});
test('an active target edit after a pause retains pause credit and its correct SLA status',async()=>{
  await create('EDIT-ACTIVE');await pause('EDIT-ACTIVE');await query("update tiket set status='On Progress' where id_tiket='EDIT-ACTIVE'");
  const r=(await query("update tiket set target_sla_jam='5' where id_tiket='EDIT-ACTIVE' returning *,statement_timestamp() as edited_at"))[0];
  const consumed=(await query('select sla_detik_kerja($1,$2,\'Kendari\')-$3::numeric as consumed',[r.waktu_penugasan,r.edited_at,r.sla_jeda_total_detik]))[0].consumed;
  const remaining=(await query('select sla_detik_kerja($1,$2,\'Kendari\') as remaining',[r.edited_at,r.tenggat_waktu]))[0].remaining;
  assert.ok(Math.abs(Number(remaining)-(18000-Number(consumed)))<0.001);assert.equal(r.status_sla,'AMAN');
});
