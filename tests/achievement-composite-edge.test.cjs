const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {salesAchievementFixture}=require('../maintenance/sales-achievement-test-fixture.cjs');
const {edgeHarness}=require('../maintenance/performance-edge-harness.cjs');
const lobbyMigration=fs.readFileSync(__dirname+'/../supabase/migrations/20261022074045_lobby_monthly_credit_progress.sql','utf8');
const request=body=>new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer a.b.c',Origin:'https://aplikasisla.vercel.app'},body:JSON.stringify(body)});
test('dashboard computes composite from authorized server sources, grade survives bonus forfeiture, scope cannot be forged',async()=>{
 const f=await salesAchievementFixture();try{
  await f.clock('2026-12-08T08:00:00+08:00');await f.seed();const h=await edgeHarness(f.db);
  const post=async body=>{const response=await h.handler(request(body));assert.equal(response.status,200);return response.json();};
  let data=await post({action:'dashboard',period:'2026-11',branch:'Kendari',result:{score:999},role:'direktur'});
  assert.deepEqual(data.rows.map(r=>r.username).sort(),['tech','tech2']);
  const r=data.rows.find(r=>r.username==='tech');assert.equal(r.policy.version,3);assert.deepEqual(r.policy.weights,{P:.5,K:.15,R:.1,T:.1,G:.1,U:.05});assert.equal(r.achieved,24);assert.equal(r.counts.workTotal,3);
  assert.equal(r.score,96.2222);assert.ok(!('source' in r));assert.ok(!('credits' in r));assert.ok(!('gaji_pokok' in r));
  await f.db.exec("update tiket set status_pembayaran='Belum Lunas',bobot_poin=999,status_sla='TERLAMBAT'");
  assert.equal((await post({action:'dashboard',period:'2026-11',branch:'Kendari'})).rows[0].achieved,24);
  h.setAuth({id:f.ids.tech,email:'tech@alfacom.local'});data=await post({action:'dashboard',period:'2026-11',branch:'Kendari'});assert.deepEqual(data.rows.map(r=>r.username),['tech']);
  assert.deepEqual((await post({action:'dashboard',period:'2026-11',branch:'Raha',access:'Semua'})).rows,[]);
  assert.equal((await h.handler(request({action:'dashboard',period:'all',branch:'Kendari'}))).status,400);
  assert.equal((await f.db.query('select count(*)::int n from sla_performa_bulan')).rows[0].n,0);assert.equal((await f.db.query('select count(*)::int n from sla_gaji_kredit')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('lobby uses the same composite including saved cause decisions; changed evidence requires review',async()=>{
 const f=await salesAchievementFixture();try{
  await f.db.exec(lobbyMigration);await f.clock('2026-12-08T08:00:00+08:00');await f.seed();
  await f.db.exec("update tiket set keterangan='Pending karena persiapan kurang' where id_tiket='TKT-2026-11-1'");
  await f.approve({decisions:{'T:TKT-2026-11-1':{outcome:'fault',note:'Persiapan alat tidak lengkap'}}});
  const h=await edgeHarness(f.db),post=async body=>{const response=await h.handler(request(body));assert.equal(response.status,200);return response.json();};
  let row=(await post({action:'dashboard',period:'2026-11',branch:'Kendari'})).rows.find(r=>r.username==='tech');assert.equal(row.values.T,66.6667);assert.equal(row.complete,true);assert.equal(row.stale,false);
  await f.clock('2026-11-30T23:00:00+08:00');h.setAuth({id:f.ids.tech,email:'tech@alfacom.local'});
  const lobby=(await post({action:'lobby'})).rows[0].achievement;assert.equal(lobby.score,row.score);assert.equal(lobby.percent,row.score);assert.equal(lobby.unit,'skor');
  await f.db.exec("update tiket set keterangan='Pending karena vendor; bukti baru' where id_tiket='TKT-2026-11-1'");
  row=(await post({action:'dashboard',period:'2026-11',branch:'Kendari'})).rows[0];assert.equal(row.stale,true);assert.equal(row.complete,false);assert.match(row.reasons.join(' '),/belum ditinjau/);
 }finally{await f.db.close();}
});
test('SQL rejects old technician policy while keeping sales approvals, function grants and salary guard unchanged',async()=>{
 const f=await salesAchievementFixture();try{
  await f.clock('2026-12-08T08:00:00+08:00');await f.seed();await f.seedSales();
  const raw=await f.raw(),{calculate}=await import('../supabase/functions/sla-performance-credit/engine.mjs'),result=calculate(raw.data);result.policy={...result.policy,version:2};
  await assert.rejects(f.db.query('select sla_performa_sahkan($1,$2,$3,$4,$5,$6,$7)',[f.ids.admin,'tech','2026-11',0,raw.hash,'{}',JSON.stringify(result)]),/Lengkapi/);
  await f.approve();await f.approve({},'juna');
  const records=(await f.db.query("select username,hasil->'policy'->>'version' version from sla_performa_bulan order by username")).rows;assert.deepEqual(records,[{username:'juna',version:'1'},{username:'tech',version:'3'}]);
  for(const role of ['anon','authenticated'])assert.equal((await f.db.query("select has_function_privilege($1,'sla_performa_sahkan(uuid,text,text,integer,text,jsonb,jsonb)','execute') ok",[role])).rows[0].ok,false);
  assert.equal((await f.db.query('select count(*)::int n from sla_notif_kenaikan_gaji')).rows[0].n,0);
 }finally{await f.db.close();}
});
