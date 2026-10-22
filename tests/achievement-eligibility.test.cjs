const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{fixture}=require('../maintenance/ticket-assessment-test-fixture.cjs');
test('server rejects achievement for warranty and cancel; original paid bonus and ordinary achievement remain intact',async()=>{
 const f=await fixture();try{
  await f.db.exec('alter table tiket add column garansi_asal text,add column referensi_tiket_asal text;'+fs.readFileSync(__dirname+'/../supabase/migrations/20261022010451_achievement_exclude_warranty_cancel.sql','utf8'));
  await f.db.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261022013050_achievement_exclude_outsource.sql','utf8'));
  await f.db.exec("update tiket set status='Selesai',waktu_selesai=now(),deskripsi_pekerjaan_ba='Perbaikan selesai dan diuji',nama_customer='PIC',tanda_tangan=repeat('a',60) where id_tiket='TKT-1'");
  await f.act('proposeGrade',{grade:'B',reason:'Perbaikan biasa'},'admin');
  for(const patch of ["garansi_asal='GRS-1'","garansi_asal=null,referensi_tiket_asal='TKT-OLD'","referensi_tiket_asal=null,status='Cancel'","status='Batal'"]){await f.db.exec('update tiket set '+patch+" where id_tiket='TKT-1'");await assert.rejects(f.act('postAchievement',{},'admin'),/garansi|batal|Batal/);}
  await f.db.exec("update tiket set status='Outsource' where id_tiket='TKT-1'");assert.equal((await f.db.query("select sla_achievement_ticket_eligible(t) ok from tiket t where id_tiket='TKT-1'")).rows[0].ok,false);await assert.rejects(f.act('postAchievement',{},'admin'),/Selesaikan/);
  await f.db.exec("update tiket set status='Selesai' where id_tiket='TKT-1'");await f.act('postAchievement',{},'admin');assert.equal((await f.read()).assessment.achievement.points,4);
  assert.equal((await f.db.query("select bobot_poin from tiket where id_tiket='TKT-PAID'")).rows[0].bobot_poin,'60');
 }finally{await f.db.close()}
});

