const {test}=require('node:test'),assert=require('node:assert/strict');
const {salesAchievementFixture}=require('../maintenance/sales-achievement-test-fixture.cjs');
const {edgeHarness}=require('../maintenance/performance-edge-harness.cjs');
const request=body=>new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer a.b.c',Origin:'https://aplikasisla.vercel.app'},body:JSON.stringify(body)});
test('draft survives a fresh read in an open month, flows to all three views, and keeps unrelated evidence reviews',async()=>{
 const f=await salesAchievementFixture();try{
  await f.clock('2026-11-24T08:00:00+08:00');await f.seed();
  await f.db.exec("update tiket set keterangan='Pending; alat belum siap' where id_tiket in ('TKT-2026-11-1','TKT-2026-11-2')");
  await f.db.exec(require('node:fs').readFileSync(__dirname+'/../supabase/migrations/20261022074045_lobby_monthly_credit_progress.sql','utf8'));
  const h=await edgeHarness(f.db),post=async(body,code=200)=>{const r=await h.handler(request(body));const d=await r.json();assert.equal(r.status,code,d.pesan);return d;};
  let c=await post({action:'read',username:'tech',period:'2026-11'});assert.equal(c.closed,false);
  const decisions={'T:TKT-2026-11-1':{outcome:'fault',note:'Persiapan alat terbukti kurang',root:'alat'},'T:TKT-2026-11-2':{outcome:'exempt',note:'Menunggu suku cadang dari vendor',root:'vendor'}};
  const saved=await post({action:'save',username:'tech',period:'2026-11',hash:c.hash,draftRevision:0,input:{decisions}});
  assert.equal(saved.draft.revision,1);assert.equal(saved.draft.diperbarui_oleh,'admin');assert.equal((await f.db.query('select count(*)::int n from sla_performa_bulan')).rows[0].n,0);assert.equal((await f.db.query('select count(*)::int n from sla_gaji_kredit')).rows[0].n,0);
  // A new handler models refresh / another browser; no browser memory is required.
  const h2=await edgeHarness(f.db);c=await (await h2.handler(request({action:'read',username:'tech',period:'2026-11'}))).json();
  assert.equal(c.result.cases[0].decision,'fault');assert.equal(c.result.cases[1].decision,'exempt');assert.equal(c.draftActive,true);
  const dashboard=(await post({action:'dashboard',period:'2026-11',branch:'Kendari'})).rows.find(r=>r.username==='tech');
  h.setAuth({id:f.ids.manager,email:'manager@alfacom.local'});
  const lobby=(await post({action:'lobby'})).rows.find(r=>r.username==='tech').achievement;
  h.setAuth({id:f.ids.admin,email:'admin@alfacom.local'});
  assert.equal(dashboard.score,c.result.score);assert.equal(lobby.score,c.result.score);assert.equal(lobby.achieved,c.result.achieved);
  await post({action:'save',username:'tech',period:'2026-11',hash:c.hash,draftRevision:0,input:{decisions}},400);
  await f.db.exec("update tiket set keterangan='Keterangan tiket lain berubah' where id_tiket='TKT-2026-11-3'");
  c=await post({action:'read',username:'tech',period:'2026-11'});assert.equal(c.result.cases[0].decision,'fault');assert.equal(c.result.cases[1].decision,'exempt');assert.deepEqual(c.changedCases,[]);
  await f.db.exec("update tiket set keterangan='Pending; bukti vendor baru' where id_tiket='TKT-2026-11-2'");
  c=await post({action:'read',username:'tech',period:'2026-11'});assert.equal(c.result.cases[0].decision,'fault');assert.equal(c.result.cases[1].decision,'pending');assert.equal(c.result.cases[1].note,decisions['T:TKT-2026-11-2'].note);assert.equal(c.result.cases[1].evidenceChanged,true);
  assert.deepEqual(c.changedCases,['T:TKT-2026-11-2']);
  h.setAuth({id:f.ids.tech,email:'tech@alfacom.local'});await post({action:'save',username:'tech',period:'2026-11',hash:c.hash,draftRevision:1,input:{}},400);
  for(const role of ['anon','authenticated']){assert.equal((await f.db.query("select has_table_privilege($1,'sla_performa_draf','select') ok",[role])).rows[0].ok,false);assert.equal((await f.db.query("select has_function_privilege($1,'sla_performa_simpan_draf(uuid,text,text,integer,integer,text,jsonb)','execute') ok",[role])).rows[0].ok,false);}
 }finally{await f.db.close();}
});
