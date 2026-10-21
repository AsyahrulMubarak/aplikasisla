const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {performanceFixture}=require('../maintenance/performance-credit-test-fixture.cjs');let f;
before(async()=>{f=await performanceFixture();});after(async()=>f?.db.close());
test('read scoped reports; employees cannot approve, see other staff, or forge branch',async()=>{
 await f.clock('2026-11-21T10:00:00+08:00');await f.seed();
 const own=await f.context('tech');assert.equal(own.canApprove,false);assert.equal(own.closed,false);assert.equal(own.attendance,null);
 await assert.rejects(f.context('tech','tech2'),/Akses rekap/);await assert.rejects(f.context('raha'),/Akses rekap/);
 await assert.rejects(f.approve({},'tech','2026-11','tech'),/Pengesahan memerlukan/);
 const {calculate}=await import('../supabase/functions/sla-performance-credit/engine.mjs');const r=calculate((await f.raw()).data);assert.equal(r.achieved,24);assert.equal(r.pass,true);
});
test('official start November; no approval before day 8 and stale revisions cannot overwrite',async()=>{
 await f.clock('2026-12-07T23:59:59+08:00');await assert.rejects(f.approve(),/masa koreksi/);
 await f.clock('2026-12-08T00:00:00+08:00');await f.approve();await assert.rejects(f.approve(),/sudah berubah/);
 await assert.rejects(f.approve({},'tech','2026-10'),/November/);
 assert.equal((await f.db.query("select count(*)::int n from sla_gaji_kredit where sumber='performa'")).rows[0].n,1);
 assert.equal((await f.db.query("select gaji_pokok from users where username='tech'")).rows[0].gaji_pokok,'2000000');
 assert.equal((await f.db.query('select count(*)::int n from sla_notif_kenaikan_gaji')).rows[0].n,0);
});
test('source revisions matter, new unrelated months and bonus values do not change old snapshots',async()=>{
 const before=await f.raw();await f.seed('2026-12');assert.equal((await f.raw()).hash,before.hash);
 await f.db.exec("update tiket set bobot_poin=999 where id_tiket='TKT-2026-11-1'");assert.equal((await f.raw()).hash,before.hash);
 await f.db.exec("update tiket set keterangan='Pending; menunggu part' where id_tiket='TKT-2026-11-1'");
 assert.notEqual((await f.raw()).hash,before.hash);
 await assert.rejects(f.approve({},'tech','2026-11','admin',1,before.hash),/Data tiket berubah/);
 await f.db.exec('select sla_evaluasi_kenaikan_gaji()');assert.equal((await f.db.query("select count(*)::int n from sla_gaji_kredit where sumber='performa'")).rows[0].n,0);
 await f.approve({decisions:{'T:TKT-2026-11-1':{outcome:'exempt',note:'Part dari pemasok belum tiba; bukti pengadaan'}}},'tech','2026-11','admin',1);
});
test('six credits from at least three months raise salary once; attendance runs independently',async()=>{
 await f.clock('2027-01-08T06:15:00+08:00');await f.approve({},'tech','2026-12');
 // October performance is disabled, and October absence earns no attendance credit.
 await f.db.exec('select sla_evaluasi_kenaikan_gaji()');
 assert.equal((await f.db.query("select gaji_pokok from users where username='tech'")).rows[0].gaji_pokok,'2000000');
 await f.seed('2027-01');await f.clock('2027-02-08T06:15:00+08:00');await f.approve({},'tech','2027-01');
 const first=(await f.db.query('select sla_evaluasi_kenaikan_gaji() r')).rows[0].r;assert.equal(first.kenaikan,1);
 assert.equal((await f.db.query("select gaji_pokok from users where username='tech'")).rows[0].gaji_pokok,'2250000');
 const h=(await f.db.query("select * from sla_gaji_riwayat where username='tech' and jenis='Otomatis'")).rows;assert.equal(h.length,1);assert.deepEqual(h[0].bulan_dipakai,['2026-11','2026-12','2027-01']);
 assert.equal((await f.db.query("select count(*)::int n from sla_gaji_kredit where username='tech' and kenaikan_id is not null")).rows[0].n,6);
 assert.equal((await f.db.query('select sla_evaluasi_kenaikan_gaji() r')).rows[0].r.kenaikan,0);
 await assert.rejects(f.approve({},'tech','2026-12','admin',1),/Kredit sudah dipakai/);
 assert.equal((await f.db.query("select count(*)::int n from sla_notif_kenaikan_gaji where username='tech'")).rows[0].n,1);
 assert.match((await f.db.query("select pesan from sla_notif_kenaikan_gaji where username='tech'")).rows[0].pesan,/Enam kredit/);
});
test('new tables and functions are inaccessible directly to authenticated or anonymous roles',async()=>{
 for(const role of ['anon','authenticated']){await f.db.exec('set role '+role);await assert.rejects(f.db.query('select * from sla_performa_bulan'),/permission denied/);await assert.rejects(f.db.query("select sla_performa_akses(null,null,null)"),/permission denied/);await f.db.exec('reset role');}
});
test('attendance-only programme remains six months, bad months skip, salary cap and old credits stay intact',async()=>{
 const g=await performanceFixture();try{
  await g.clock('2026-10-01T08:00:00+08:00');await g.db.exec("update users set gaji_pokok=2900000 where username='tech'");
  for(const p of ['2026-10','2026-11','2026-12','2027-01','2027-02','2027-03','2027-04'])await g.seed(p);
  // Missing attendance in January must not reset the five other accumulated credits.
  await g.db.exec("delete from absensi where waktu_absen>='2027-01-01T00:00:00+08:00' and waktu_absen<'2027-02-01T00:00:00+08:00'");
  await g.clock('2027-04-08T06:15:00+08:00');assert.equal((await g.db.query('select sla_evaluasi_kenaikan_gaji() r')).rows[0].r.kenaikan,0);
  assert.equal((await g.db.query("select count(*)::int n from sla_gaji_kredit where username='tech' and kenaikan_id is null")).rows[0].n,5);
  await g.clock('2027-05-08T06:15:00+08:00');assert.equal((await g.db.query('select sla_evaluasi_kenaikan_gaji() r')).rows[0].r.kenaikan,1);
  assert.equal((await g.db.query("select gaji_pokok from users where username='tech'")).rows[0].gaji_pokok,'3000000');
  const summary=(await g.db.query("select sla_ringkasan_gaji(array['tech'],'2027-05') r")).rows[0].r[0];assert.equal(summary.kreditTerkumpul,0);assert.equal(summary.selesai,true);assert.equal(summary.kreditBulanan.length,6);
  assert.equal((await g.db.query("select count(*)::int n from sla_gaji_program where username='raha'")).rows[0].n,0);
 }finally{await g.db.close();}
});
test('good performance earns credit despite failed attendance; failing performance cannot erase attendance',async()=>{
 const g=await performanceFixture();try{
  await g.clock('2026-12-08T06:15:00+08:00');await g.seed();await g.db.exec('truncate absensi');await g.approve();await g.db.exec('select sla_evaluasi_kenaikan_gaji()');
  assert.deepEqual((await g.db.query("select sumber from sla_gaji_kredit where username='tech'")).rows,[{sumber:'performa'}]);
  await g.seed('2026-12');await g.clock('2027-01-08T06:15:00+08:00');
  await g.db.exec("update tiket set tenggat_waktu='2026-12-04T17:00:00+08:00' where id_tiket like 'TKT-2026-12-%'");
  const saved=await g.approve({},'tech','2026-12');assert.equal(saved.saved.hasil.pass,false);await g.db.exec('select sla_evaluasi_kenaikan_gaji()');
  assert.deepEqual((await g.db.query("select sumber from sla_gaji_kredit where username='tech' and periode='2026-12'")).rows,[{sumber:'kehadiran'}]);
 }finally{await g.db.close();}
});
test('assignment audit preserves old SLA deadlines without changing legacy ticket updates or sending notifications',async()=>{
 const g=await performanceFixture();try{
  await g.clock('2026-11-10T15:00:00+08:00');await g.seed();
  const old=(await g.db.query("select * from tiket where id_tiket='TKT-2026-11-1'")).rows[0];
  // An authenticated legacy updater remains supported; the trigger itself owns the append-only audit privilege.
  await g.db.exec("set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';set role authenticated");
  await g.db.exec("update tiket set teknisi='Teknisi B' where id_tiket='TKT-2026-11-1'");
  await g.db.exec("reset role;set request.jwt.claim.role='service_role'");
  const e=(await g.db.query('select * from sla_performa_episode')).rows;assert.equal(e.length,1);assert.deepEqual(e[0].tenggat_waktu,old.tenggat_waktu);assert.equal(e[0].teknisi,old.teknisi);
  const {calculate}=await import('../supabase/functions/sla-performance-credit/engine.mjs');const result=calculate((await g.raw()).data);
  assert.ok(result.workTickets.some(x=>x.id.includes('episode')));assert.equal(result.counts.workTotal,3);assert.equal(result.counts.workGood,3);assert.equal(result.cases.filter(c=>c.kind==='U').length,1);
  assert.equal((await g.db.query('select count(*)::int n from sla_notif_kenaikan_gaji')).rows[0].n,0);
 }finally{await g.db.close();}
});
