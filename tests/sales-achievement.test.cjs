const {test}=require('node:test'),assert=require('node:assert/strict');
const {salesAchievementFixture}=require('../maintenance/sales-achievement-test-fixture.cjs');
test('saved panel targets drive November sales assessment in both branches, with only salaried credits',async()=>{
 const f=await salesAchievementFixture();try{
  assert.equal((await f.db.query("select count(*)::int n from sla_sales_targets where periode='2026-11'")).rows[0].n,2);
  await f.seedSales('juna');await f.seedSales('ardan');await f.clock('2026-12-08T06:15:00+08:00');
  const {calculate}=await import('../supabase/functions/sla-performance-credit/engine.mjs');
  await f.db.exec("insert into penjualan values('juna-SLS-duplicate','juna-INV','2026-11-02T10:00:00+08:00','Juna, Sales Lain',200,'Kendari');"+
   "insert into garansi(id_garansi,referensi_tiket_nota,tanggal_mulai,cabang,sales,omzet) values('DUP-SLS','juna-SLS','2026-11-02T10:00:00+08:00','Kendari','Juna',200)");
  for(const name of ['juna','ardan']){
   const source=await f.raw(name),r=calculate(source.data);assert.equal(r.pass,true);assert.equal(r.sales.conversion,60);
   assert.equal(r.sales.revenue,name==='juna'?100:200);assert.equal(r.sales.countedFollowups,r.sales.requiredFollowups);
   const actor=name==='juna'?'admin':'raha';assert.equal((await f.context(actor,name)).salaryCreditEligible,true);
   await f.approve({},name,'2026-11',actor);
  }
  await assert.rejects(f.context('admin','ardan'),/Akses rekap/);
  await f.db.exec("insert into sla_sales_targets values('Kendari','2026-11','free-sales',100,60,1,false,'33333333-3333-4333-8333-333333333333')");
  await f.seedSales('free-sales');const free=await f.context('admin','free-sales');assert.equal(free.eligible,true);assert.equal(free.salaryCreditEligible,false);
  await f.approve({},'free-sales');assert.equal((await f.db.query("select count(*)::int n from sla_gaji_kredit where username='free-sales'")).rows[0].n,0);
  assert.equal((await f.db.query("select count(*)::int n from sla_gaji_kredit where sumber='performa' and username in ('juna','ardan')")).rows[0].n,2);
  assert.equal((await f.db.query('select count(*)::int n from sla_notif_kenaikan_gaji')).rows[0].n,0);
  const old=await f.raw('juna');await f.db.exec("insert into penjualan values('UNRELATED','OTHER','2027-01-02T10:00:00+08:00','Juna',999999,'Kendari')");
  assert.equal((await f.raw('juna')).hash,old.hash);
  await f.db.exec("update sla_sales_targets set omzet=101 where username='juna' and periode='2026-11'");
  assert.notEqual((await f.raw('juna')).hash,old.hash);assert.equal(calculate((await f.raw('juna')).data).pass,false);
  await f.db.exec("insert into penjualan values('REFUND','REFUND-INV','2026-11-03T10:00:00+08:00','Juna',-20,'Kendari')");
  assert.equal(calculate((await f.raw('juna')).data).sales.revenue,80,'recorded negative adjustments reduce revenue');
 }finally{await f.db.close();}
});
test('daily caps, customer duplicates, required proof and all three thresholds cannot be bypassed',async()=>{
 const f=await salesAchievementFixture();try{
  await f.seedSales('ardan');await f.clock('2026-12-08T06:15:00+08:00');const {calculate}=await import('../supabase/functions/sla-performance-credit/engine.mjs');
  const initial=calculate((await f.raw('ardan')).data);assert.equal(initial.pass,true);
  await f.db.exec("delete from sla_sales_followups where username='ardan' and (waktu_kontak at time zone 'Asia/Makassar')::date='2026-11-02'");
  await f.db.exec("insert into sla_sales_followups(id_prospek,username,waktu_kontak,bukti_jenis,bukti_path,cabang) select 'ardan-P1','ardan','2026-11-03T10:00:00+08:00','link','https://example.test/proof','Raha' from generate_series(1,20)");
  let r=calculate((await f.raw('ardan')).data);assert.equal(r.pass,false);assert.equal(r.sales.countedFollowups,initial.sales.countedFollowups-1);
  await f.db.exec("update sla_sales_followups set bukti_jenis='none',bukti_path=null where username='ardan'");
  r=calculate((await f.raw('ardan')).data);assert.equal(r.sales.countedFollowups,0);
  await f.db.exec("update sla_sales_targets set bukti_wajib=false where username='ardan' and periode='2026-11'");
  assert.ok(calculate((await f.raw('ardan')).data).sales.countedFollowups>0);
  await f.db.exec("update prospek set status_prospek='Tahap Penawaran' where id_prospek='ardan-P1'");
  assert.equal(calculate((await f.raw('ardan')).data).sales.conversion,40);
 }finally{await f.db.close();}
});
