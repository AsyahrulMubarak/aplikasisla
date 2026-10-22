const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {salesAchievementFixture}=require('../maintenance/sales-achievement-test-fixture.cjs');
const migration=fs.readFileSync(__dirname+'/../supabase/migrations/20261022074045_lobby_monthly_credit_progress.sql','utf8');
test('lobby credit sources enforce all-access versus self, include salaried technicians and sales only',async()=>{
 const f=await salesAchievementFixture();try{
  await f.db.exec(migration);await f.clock('2026-11-02T10:00:00+08:00');
  const read=async id=>(await f.db.query('select sla_lobby_kredit_sumber($1) r',[id])).rows[0].r;
  const all=await read(f.ids.manager);assert.equal(all.allEmployees,true);
  assert.deepEqual(all.rows.map(r=>r.username).sort(),['ardan','juna','tech','tech2']);
  assert.equal(all.period,'2026-11');
  assert.deepEqual((await read(f.ids.tech)).rows.map(r=>r.username),['tech']);
  assert.deepEqual((await read('88888888-8888-4888-8888-888888888888')).rows.map(r=>r.username),['juna']);
  assert.equal((await read(f.ids.admin)).rows.length,0,'branch admins do not receive other employees through this personal lobby endpoint');
  await f.db.exec("update users set account_active=false where username='juna'");
  await assert.rejects(read('88888888-8888-4888-8888-888888888888'),/nonaktif/);
  assert.ok(!(await read(f.ids.manager)).rows.some(r=>r.username==='juna'));
  for(const role of ['anon','authenticated'])assert.equal((await f.db.query("select has_function_privilege($1,'sla_lobby_kredit_sumber(uuid)','execute') ok",[role])).rows[0].ok,false);
 }finally{await f.db.close();}
});
test('attendance preview excludes future days and today absence, preserving branch lateness rules',async()=>{
 const f=await salesAchievementFixture();try{
  await f.db.exec(migration);
  const stats=async username=>(await f.db.query("select * from sla_disiplin_kredit_berjalan($1,'2026-11')",[username])).rows[0];
  await f.clock('2026-11-02T10:00:00+08:00');assert.deepEqual(await stats('juna'),{telat_pagi:0,alpa:0});
  await f.clock('2026-11-03T10:00:00+08:00');assert.deepEqual(await stats('juna'),{telat_pagi:0,alpa:1});
  await f.db.exec("insert into absensi values('late-j','2026-11-03T09:20:00+08:00','Juna','Masuk','Terlambat Masuk','Kendari'),('late-a','2026-11-03T09:46:00+08:00','Ardan','Masuk','Terlambat Masuk','Raha')");
  assert.deepEqual(await stats('juna'),{telat_pagi:1,alpa:1});assert.deepEqual(await stats('ardan'),{telat_pagi:1,alpa:1});
  await f.clock('2026-11-30T21:00:00+08:00');const live=await stats('juna'),final=(await f.db.query("select * from sla_disiplin_kenaikan_gaji('juna','2026-11')")).rows[0];assert.equal(final.alpa,live.alpa+1,'final evaluator still includes the completed month');
 }finally{await f.db.close();}
});
