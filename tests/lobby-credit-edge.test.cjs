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

test('sales lobby averages capped fulfilment of all three saved targets in both branches without changing credit gates',async()=>{
 const f=await salesAchievementFixture();try{
  await f.db.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261022074045_lobby_monthly_credit_progress.sql','utf8'));
  await f.seedSales('juna');await f.seedSales('ardan');await f.clock('2026-11-30T21:00:00+08:00');
  const h=await edgeHarness(f.db),read=async()=>{const response=await h.handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer a.b.c',Origin:'https://aplikasisla.vercel.app'},body:JSON.stringify({action:'lobby'})}));assert.equal(response.status,200);return (await response.json()).rows[0].achievement;};
  for(const [username,id] of [['juna','88888888-8888-4888-8888-888888888888'],['ardan','99999999-9999-4999-8999-999999999999']]){
   h.setAuth({id,email:username+'@alfacom.local'});let a=await read();assert.equal(a.percent,100);assert.equal(a.potentialCredit,1);
   await f.db.query('update penjualan set nominal_rp=nominal_rp/2 where id_penjualan=$1',[username+'-SLS']);
   a=await read();assert.deepEqual(a.sales.progress,{omzet:50,konversi:100,tindakLanjut:100});assert.ok(Math.abs(a.percent-250/3)<0.0001);assert.equal(a.potentialCredit,0);
   await f.db.query("update sla_sales_targets set konversi=75,followup_harian=2 where username=$1 and periode='2026-11'",[username]);
   a=await read();assert.deepEqual(a.sales.progress,{omzet:50,konversi:80,tindakLanjut:50});assert.equal(a.percent,60);
   await f.db.query('update penjualan set nominal_rp=nominal_rp*10 where id_penjualan=$1',[username+'-SLS']);
   a=await read();assert.equal(a.sales.progress.omzet,100);assert.ok(a.percent<100);assert.equal(a.potentialCredit,0,'surplus revenue cannot compensate for missing conversion/followups');
   await f.db.query("delete from prospek where sales_penanggung_jawab=$1",[username==='juna'?'Juna':'Ardan']);
   a=await read();assert.equal(a.sales.progress.konversi,0);assert.equal(a.sales.progress.tindakLanjut,0);assert.ok(Math.abs(a.percent-100/3)<0.0001);
   await f.db.query("delete from sla_sales_targets where username=$1 and periode='2026-11'",[username]);
   a=await read();assert.equal(a.percent,0);assert.equal(a.potentialCredit,0);
  }
  await f.clock('2026-10-22T10:00:00+08:00');assert.equal((await read()).percent,0,'official progress begins November');
  assert.equal((await f.db.query('select count(*)::int n from sla_gaji_kredit')).rows[0].n,0,'reading progress cannot award salary credits');
  assert.equal((await f.db.query('select count(*)::int n from sla_notif_kenaikan_gaji')).rows[0].n,0);
 }finally{await f.db.close();}
});
