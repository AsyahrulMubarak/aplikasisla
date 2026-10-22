const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{workflowFixture}=require('../maintenance/ticket-workflow-test-fixture.cjs');let f;
before(async()=>f=await workflowFixture());after(async()=>f?.db.close());
test('pending saves status + structured reason + actor in one transaction, preserving SLA pause and grade/bonus',async()=>{
 const old=await f.row();await f.act('pending',f.pending,{status:'Pending',keterangan:'Riwayat palsu pengganti'},'tech');const t=await f.row(),e=t.konteks_pekerjaan.events[0];assert.equal(t.status,'Pending');assert.equal(t.status_sla,'DIPENDING');assert.ok(t.sla_jeda_mulai);assert.ok(t.keterangan.startsWith(old.keterangan));assert.ok(!t.keterangan.includes('Riwayat palsu'));assert.equal(e.actor,'tech');assert.equal(e.reviewStatus,'unreviewed');assert.equal(e.category,'parts_vendor');assert.equal(Object.hasOwn(e,'followUpAt'),false);assert.equal(t.bobot_poin,old.bobot_poin);assert.equal(t.penilaian_teknisi,old.penilaian_teknisi);assert.equal(t.versi_workflow,old.versi_workflow+1);
});
test('incomplete pending, wrong branch/role, salary/bonus fields and stale versions never partially update',async()=>{
 const before=await f.row();for(const context of [{...f.pending,category:''},{...f.pending,evidence:''}])await assert.rejects(f.act('pending',context));
 await assert.rejects(f.act('pending',f.pending,{status:'Pending'},'raha'),/Cabang/);await assert.rejects(f.act('pending',f.pending,{status:'Pending'},'logistik'),/berhak/);
 await assert.rejects(f.act('pending',f.pending,{status:'Pending',bobot_poin:999}),/Kolom/);
 await assert.rejects(f.act('pending',f.pending,{status:'Pending'},'admin','TKT-1',before.versi_workflow-1),/sudah berubah/);assert.deepEqual(await f.row(),before);
});
test('idempotency records one cause; request reuse with different contents is rejected',async()=>{
 const id=crypto.randomUUID(),rev=(await f.row()).versi_workflow,a=await f.act('pending',f.pending,{status:'Pending'},'admin','TKT-1',rev,id),count=(await f.row()).konteks_pekerjaan.events.length;
 const b=await f.act('pending',f.pending,{status:'Pending'},'admin','TKT-1',rev,id);assert.equal(a.replayed,false);assert.equal(b.replayed,true);assert.equal((await f.row()).konteks_pekerjaan.events.length,count);await assert.rejects(f.act('pending',{...f.pending,evidence:'Bukti lain yang berbeda'},{status:'Pending'},'admin','TKT-1',rev,id),/data berbeda/);
});
test('legacy resume continues remaining SLA and closes facts automatically without an extra confirmation',async()=>{
 const old=await f.row();await f.db.exec("set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';set role authenticated");
 await f.db.exec("update tiket set status='On Progress' where id_tiket='TKT-1'");await f.db.exec("reset role;set request.jwt.claim.role='service_role'");const t=await f.row();assert.equal(t.sla_jeda_mulai,null);assert.ok(t.konteks_pekerjaan.events.filter(e=>e.kind==='pending').every(e=>e.closedAt&&e.resumeStatus==='On Progress'));assert.equal(t.versi_workflow,old.versi_workflow+1);
});
test('admin replacement records reason and handover and keeps the outgoing SLA episode; technicians cannot decide assignment',async()=>{
 const before=await f.row();await assert.rejects(f.act('replacement',f.replacement,{teknisi:'Teknisi B'},'tech'),/berhak/);await assert.rejects(f.act('replacement',{...f.replacement,handover:''},{teknisi:'Teknisi B'}),/hasil dan sisa/);
 await f.act('replacement',f.replacement,{teknisi:'Teknisi B'});const t=await f.row(),e=t.konteks_pekerjaan.events.at(-1);assert.equal(e.from,before.teknisi);assert.equal(e.to,'Teknisi B');assert.equal(e.reason,f.replacement.reason);assert.equal(e.handover,f.replacement.handover);assert.equal(Object.hasOwn(e,'evidence'),false);assert.equal(t.teknisi_sebelumnya,before.teknisi);assert.equal(t.tenggat_pengganti.getTime(),t.tenggat_waktu.getTime());assert.equal(t.waktu_respon,null);
 assert.equal(t.riwayat_penggantian_teknisi.at(-1).dari,before.teknisi);assert.equal((await f.db.query('select * from sla_performa_episode order by id desc limit 1')).rows[0].teknisi,before.teknisi);
});
test('adding assistance without requesting a fresh SLA preserves the existing assignment clock',async()=>{
 const before=await f.row();await f.act('replacement',{...f.replacement,category:'specialist_support',resetSla:false},{teknisi:'Teknisi A, Teknisi B'});const after=await f.row();assert.deepEqual(after.waktu_penugasan,before.waktu_penugasan);assert.deepEqual(after.tenggat_waktu,before.tenggat_waktu);assert.equal(after.konteks_pekerjaan.events.at(-1).resetSla,false);
});
test('saved signature/PIC cannot be overwritten by pending form',async()=>{
 await f.db.exec("update tiket set tanda_tangan=repeat('x',100),nama_customer='PIC terkunci' where id_tiket='TKT-2'");await assert.rejects(f.act('pending',f.pending,{status:'Pending',tanda_tangan:'',nama_customer:'Orang lain'},'admin','TKT-2'),/dikunci/);assert.equal((await f.row('TKT-2')).status,'On Progress');
});
test('facts are available for monthly review and cannot be directly forged or treated as an automatic exemption',async()=>{
 const {calculate}=await import('../supabase/functions/sla-performance-credit/engine.mjs');await f.db.exec("update tiket set status='Selesai',waktu_selesai=now() where id_tiket='TKT-1'");const period=new Date(Date.now()+8*3600000).toISOString().slice(0,7),source=await f.raw('tech',period),result=calculate(source.data),pending=result.cases.find(c=>c.kind==='T'&&c.ticket==='TKT-1');assert.ok(pending);assert.match(pending.detail,/parts_vendor/);assert.match(pending.detail,/PO-001/);assert.equal(pending.decision,'pending');assert.equal(result.complete,false);
 await f.db.exec("set request.jwt.claim.role='authenticated';set role authenticated");await assert.rejects(f.db.exec("update tiket set konteks_pekerjaan='{}' where id_tiket='TKT-1'"),/layanan tiket/);await assert.rejects(f.db.query('select * from sla_konteks_pekerjaan_audit'),/permission denied/);await f.db.exec("reset role;set request.jwt.claim.role='service_role'");
 assert.equal((await f.db.query('select count(*)::int n from sla_gaji_kredit')).rows[0].n,0);assert.equal((await f.db.query('select count(*)::int n from sla_notif_kenaikan_gaji')).rows[0].n,0);
});
