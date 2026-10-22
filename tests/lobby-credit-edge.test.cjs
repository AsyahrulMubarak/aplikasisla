const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {salesAchievementFixture}=require('../maintenance/sales-achievement-test-fixture.cjs'),{edgeHarness}=require('../maintenance/performance-edge-harness.cjs');
test('authenticated lobby route computes current-month values and rejects forged all-access scope',async()=>{
 const f=await salesAchievementFixture();try{
  await f.db.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261022074045_lobby_monthly_credit_progress.sql','utf8'));
  await f.clock('2026-11-03T10:00:00+08:00');const h=await edgeHarness(f.db);
  const req=()=>new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer a.b.c',Origin:'https://aplikasisla.vercel.app'},body:JSON.stringify({action:'lobby',username:'manager',role:'direktur',access:'Semua',period:'2027-01',result:{pass:true}})});
  h.setAuth({id:'88888888-8888-4888-8888-888888888888',email:'juna@alfacom.local'});
  let r=await h.handler(req()),d=await r.json();assert.equal(r.status,200);assert.equal(d.period,'2026-11');assert.equal(d.allEmployees,false);
  assert.deepEqual(d.rows.map(r=>r.username),['juna']);assert.equal(d.rows[0].attendance.absent,1);assert.equal(d.rows[0].achievement.achieved,0);assert.equal(d.rows[0].achievement.percent,0);
  assert.ok(d.rows.every(r=>!r.source&&!r.auth_id&&!r.gaji_pokok));
  h.setAuth({id:f.ids.manager,email:'manager@alfacom.local'});d=await (await h.handler(req())).json();assert.equal(d.allEmployees,true);assert.ok(d.rows.some(r=>r.username==='ardan'));
  h.setDenied(true);assert.equal((await h.handler(req())).status,401);
 }finally{await f.db.close();}
});
