const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {performanceFixture}=require('../maintenance/performance-credit-test-fixture.cjs');
const migration=fs.readFileSync(__dirname+'/../supabase/migrations/20261022072438_november_raha_salary_credits.sql','utf8');
test('Raha enrolment starts November without changing salary, earlier credits or WhatsApp',async()=>{
 const f=await performanceFixture();try{
  await f.clock('2026-10-22T16:00:00+08:00');
  await f.db.exec("update users set hak_akses_cabang='Raha',cabang='Raha' where username='tech';update users set gaji_pokok=0 where username='tech2'");
  const before=(await f.db.query('select username,gaji_pokok from users order by username')).rows;
  const notices=(await f.db.query('select count(*)::int n from sla_notif_kenaikan_gaji')).rows[0].n;
  await f.db.exec(migration);await f.db.exec(migration);
  assert.deepEqual((await f.db.query('select username,gaji_pokok from users order by username')).rows,before);
  assert.equal((await f.db.query("select mulai_periode from sla_gaji_program where username='tech'")).rows[0].mulai_periode,'2026-11');
  assert.equal((await f.db.query("select count(*)::int n from sla_gaji_program where username='tech2'")).rows[0].n,0);
  assert.equal((await f.db.query("select mulai_periode from sla_gaji_program where username='admin'")).rows[0].mulai_periode,'2026-10');
  assert.equal((await f.db.query('select count(*)::int n from sla_notif_kenaikan_gaji')).rows[0].n,notices);
  await f.clock('2026-11-08T06:15:00+08:00');await f.db.exec('select sla_evaluasi_kenaikan_gaji()');
  assert.equal((await f.db.query("select count(*)::int n from sla_gaji_disiplin_bulan where username='tech'")).rows[0].n,0);
  assert.equal((await f.context('raha','tech','2026-10')).eligible,false);
  await f.seed('2026-11');
  await f.db.exec("update tiket set cabang='Raha' where id_tiket like 'TKT-2026-11-%';update garansi set cabang='Raha';update absensi set cabang='Raha'");
  await f.clock('2026-12-07T23:59:59+08:00');await assert.rejects(f.approve({},'tech','2026-11','raha'),/masa koreksi/);
  await f.clock('2026-12-08T06:15:00+08:00');
  assert.equal((await f.context('raha','tech')).eligible,true);
  await assert.rejects(f.context('admin','tech'),/Akses rekap/);
  await f.approve({},'tech','2026-11','raha');await f.db.exec('select sla_evaluasi_kenaikan_gaji()');
  const credits=(await f.db.query("select periode,sumber from sla_gaji_kredit where username='tech' order by sumber")).rows;
  assert.deepEqual(credits,[{periode:'2026-11',sumber:'kehadiran'},{periode:'2026-11',sumber:'performa'}]);
  assert.equal((await f.db.query("select gaji_pokok from users where username='tech'")).rows[0].gaji_pokok,'2000000');
  const summary=(await f.db.query("select sla_ringkasan_gaji(array['tech'],'2026-11') r")).rows[0].r[0];
  assert.equal(summary.berlakuOtomatis,true);assert.equal(summary.kreditTerkumpul,2);
 }finally{await f.db.close();}
});
