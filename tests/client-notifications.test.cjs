const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('../tmp/sales-claims-qa/node_modules/@electric-sql/pglite');
const migration=fs.readFileSync(__dirname+'/../supabase/migrations/20261025162134_client_notifications_work_hours_greeting.sql','utf8');
const base=fs.readFileSync(__dirname+'/../supabase/migrations/20261022054308_sla_operations_supabase.sql','utf8');
async function setup(){
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create function auth.role() returns text language sql as $$select 'service_role'::text$$;
 create table users(username text,no_wa text,account_active boolean,role text,cabang text,hak_akses_cabang text);
 insert into users values('raha-admin','081111111111',true,'admin_raha','Raha','Raha');
 create table tiket(id_tiket text primary key,cabang text,no_wa_klien text,status text,status_peringatan text,waktu_respon timestamptz);
 create table prospek(no_wa text,cabang text,id_prospek text,waktu_peringatan_crm_terakhir timestamptz);
 create table database_klien(no_wa text,cabang text);
 create table garansi(id_garansi text,referensi_tiket_nota text,cabang text,status text,waktu_diambil timestamptz,waktu_siap_diambil timestamptz,riwayat_follow_up text,follow_up_after_sales_terkirim text);
 create table sla_notif_penitipan(id uuid primary key default gen_random_uuid(),id_garansi text,terkirim_pada timestamptz,lease uuid,lease_sampai timestamptz,percobaan int default 0);
 create function sla_hari_penitipan(timestamptz,timestamptz) returns integer language sql as $$select 5$$;
 create table sla_notif_klaim_garansi(id uuid primary key default gen_random_uuid(),id_garansi text,id_tiket text,penerima text,no_wa text,pesan text,terkirim_pada timestamptz,percobaan int default 0,lease uuid,lease_sampai timestamptz,galat text,delivery_uncertain boolean not null default false);`);
 await db.exec(base.slice(base.indexOf('create table public.sla_ops_outbox'),base.indexOf('create table public.sla_ops_crm_receipts')));
 await db.exec(base.slice(base.indexOf('create function public.sla_ops_phone'),base.indexOf('create function public.sla_ops_expire_prospect')));
 await db.exec(base.slice(base.indexOf('create function public.sla_ops_recipient_allowed'),base.indexOf('create function public.sla_ops_start_broadcast')));
 await db.exec(migration);
 await db.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261026023618_warranty_followup_active_only.sql','utf8'));
 await db.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261026024126_raha_whatsapp_admin_contact.sql','utf8'));
 await db.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261026024630_response_reminders_waiting_only.sql','utf8'));
 return db;
 }catch(e){await db.close();throw new Error(e.message);}
}
const hello="Assalamu'alaikum, Sahabat Alfacom.";
test('WITA working windows respect Monday–Saturday, both branches and all break boundaries',async()=>{
 const db=await setup();
 try{
  const times=[['00:01:00',false,false],['07:59:59',false,false],['08:00:00',true,true],
   ['11:59:59',true,true],['12:00:00',false,false],['13:29:59',false,false],['13:30:00',true,true],
   ['14:59:59',true,true],['15:00:00',false,false],['15:59:59',false,false],['16:00:00',true,true],
   ['16:59:59',true,true],['17:00:00',false,true],['19:59:59',false,true],['20:00:00',false,false],['23:59:59',false,false]];
  for(const date of ['2026-10-26','2026-10-31','2026-11-01'])for(const [time,k,r] of times){
   const rows=(await db.query('select sla_client_working_time($1,$2) k,sla_client_working_time($3,$2) r',['Kendari',date+'T'+time+'+08:00','Raha'])).rows[0];
   assert.deepEqual(rows,{k:date==='2026-11-01'?false:k,r:date==='2026-11-01'?false:r},date+' '+time);
  }
  assert.equal((await db.query("select sla_client_working_time('Kendari','2026-10-26T00:00:00Z') ok")).rows[0].ok,true);
  for(const branch of [null,'Unknown'])assert.equal((await db.query('select sla_client_working_time($1,now()) ok',[branch])).rows[0].ok,false);
 }finally{await db.close();}
});
test('all customer salutations are friendly, anonymous and idempotent; details and tracking links survive',async()=>{
 const db=await setup();
 try{
  for(const old of ["Assalamu'alaikum Nanang-nanang,\n\nDetail tiket TKT-1\nhttps://example.test/?track=TKT-1",
   "✅ *PEKERJAAN SELESAI*\n\nBismillah. Pelanggan Yth,\n\nDetail tiket TKT-1",
   "❌ *TIKET DIBATALKAN*\n\nAssalamu'alaikum Nama Random,\n\nDetail tiket TKT-1",
   "Klaim garansi G-1. Item: CCTV. Tiket: TKT-1.",hello+'\n\nDetail tiket TKT-1']){
   const text=(await db.query('select sla_client_greeting($1) text',[old])).rows[0].text;
   assert.ok(text.startsWith(hello+'\n\n'));
   assert.doesNotMatch(text,/Nanang|Nama Random|Pelanggan Yth/);
   assert.match(text,/TKT-1/);
   if(old.includes('https://'))assert.ok(text.includes('https://example.test/?track=TKT-1'));
   assert.equal((await db.query('select sla_client_greeting($1) text',[text])).rows[0].text,text);
  }
  const inline=(await db.query('select sla_client_greeting($1) text',["Assalamu'alaikum Budi, promo spesial untuk tiket TKT-1."])).rows[0].text;
  assert.equal(inline,hello+'\n\npromo spesial untuk tiket TKT-1.');
 }finally{await db.close();}
});
test('client templates are recognized even for staff customers; internal alerts retain their audience',async()=>{
 const db=await setup();
 try{
  await db.exec("insert into users values('tech','081234567890',true,'teknisi','Raha','Raha'); insert into tiket(id_tiket,cabang,no_wa_klien,status) values('T','Raha','081234567890','Menunggu');");
  for(const [kind,phone,message,expected] of [
   ['storage_reminder','6281234567890','Reminder',true],['warranty_followup','6281234567890','Follow up',true],
   ['warranty_claim_client','6281234567890','Claim',true],['broadcast','6281234567890','Promo',true],
   ['relay','6281234567890','Assalamu\'alaikum Admin, tiket diselesaikan',false],
   ['relay','6281234567890','Bismillah. Pelanggan Yth,',true],
   ['relay','6281234567890','Tiket perbaikan Anda telah terdaftar:',true],
   ['ticket_reminder','6281234567890','Internal reminder',false]]){
   assert.equal((await db.query('select sla_ops_is_client_message($1,$2,$3,$4) ok',[kind,'Raha',phone,message])).rows[0].ok,expected,message);
  }
  await db.exec("insert into database_klien values('081234567891','Raha')");
  assert.equal((await db.query("select sla_ops_is_client_message('relay','Raha','6281234567891','Customer notice') ok")).rows[0].ok,true);
 }finally{await db.close();}
});
test('closed windows preserve queued messages, retry counts and unrelated internal traffic',async()=>{
 const db=await setup();
 try{
  // Freeze the calendar, never the queue timestamps, so every test run is deterministic.
  await db.exec("create or replace function sla_client_working_time(p_branch text,p_at timestamptz default clock_timestamp()) returns boolean language sql immutable as $$select false$$");
  await db.exec("select sla_ops_enqueue('client','Kendari','[{\"phone\":\"081234567890\",\"message\":\"Reminder\"}]','storage_reminder'); select sla_ops_enqueue('staff','Kendari','[{\"phone\":\"081234567891\",\"message\":\"Internal\"}]','ticket_reminder');");
  assert.equal((await db.query("select * from sla_ops_lease('client',5)")).rows.length,0);
  assert.deepEqual((await db.query("select state,attempts,sent_at from sla_ops_outbox where event_key='client'")).rows[0],{state:'pending',attempts:0,sent_at:null});
  assert.equal((await db.query("select * from sla_ops_lease('staff',5)")).rows.length,1);
  await db.exec("create or replace function sla_client_working_time(p_branch text,p_at timestamptz default clock_timestamp()) returns boolean language sql immutable as $$select true$$");
  const e=(await db.query("select * from sla_ops_lease('client',5)")).rows[0];assert.ok(e);
  const delivery=(await db.query('select sla_ops_prepare_delivery($1,$2) d',[e.id,e.lease])).rows[0].d;
  assert.equal(delivery.allowed,true);assert.equal(delivery.message,hello+'\n\nReminder');
  assert.equal((await db.query('select message from sla_ops_outbox where id=$1',[e.id])).rows[0].message,'Reminder');
  // A batch leased before noon must defer if the break starts before this send.
  await db.exec("create or replace function sla_client_working_time(p_branch text,p_at timestamptz default clock_timestamp()) returns boolean language sql immutable as $$select false$$");
  assert.equal((await db.query('select sla_ops_prepare_delivery($1,$2) d',[e.id,e.lease])).rows[0].d.deferred,true);
  assert.deepEqual((await db.query('select state,attempts,lease,sent_at from sla_ops_outbox where id=$1',[e.id])).rows[0],{state:'pending',attempts:0,lease:null,sent_at:null});
  assert.equal((await db.query('select sla_ops_prepare_delivery($1,$2) d',[e.id,e.lease])).rows[0].d.allowed,false);
 }finally{await db.close();}
});
test('customer warranty claims have one durable queue, delayed acknowledgement and no legacy double-send',async()=>{
 const db=await setup();
 try{
  await db.exec("insert into tiket(id_tiket,cabang,no_wa_klien,status) values('T','Raha','081234567890','Claim Garansi'); insert into sla_notif_klaim_garansi(id_garansi,id_tiket,penerima,no_wa,pesan) values('G','T','pelanggan','081234567890','Klaim garansi G. Tiket: T.'),('G','T','teknisi:fixture','081234567891','Internal');");
  const customer=(await db.query("select * from sla_notif_klaim_garansi where penerima='pelanggan'")).rows[0];
  await db.query('select sla_ops_queue_warranty_client($1)',[customer.id]);
  assert.equal((await db.query('select count(*)::int n from sla_ops_outbox')).rows[0].n,1);
  const legacy=(await db.query("select * from sla_ambil_notif_garansi('G')")).rows;assert.equal(legacy.length,1);assert.equal(legacy[0].penerima,'teknisi:fixture');
  assert.equal(customer.terkirim_pada,null);
  await db.exec("create or replace function sla_client_working_time(p_branch text,p_at timestamptz default clock_timestamp()) returns boolean language sql immutable as $$select true$$");
  const e=(await db.query('select * from sla_ops_lease(null,5)')).rows[0];
  await db.query("select sla_ops_ack($1,$2,'sent',null,'fixture-provider')",[e.id,e.lease]);
  assert.ok((await db.query('select terkirim_pada from sla_notif_klaim_garansi where id=$1',[customer.id])).rows[0].terkirim_pada);
  assert.equal((await db.query('select * from sla_ops_lease(null,5)')).rows.length,0);
 }finally{await db.close();}
});
test('after-sales delivery rejects queued inactive cards and cross-branch references, while storage stays eligible',async()=>{
 const db=await setup();
 try{
  await db.exec("create or replace function sla_client_working_time(p_branch text,p_at timestamptz default clock_timestamp()) returns boolean language sql immutable as $$select true$$");
  let n=0;
  for(const branch of ['Kendari','Raha'])for(const status of ['Masa Tunggu','Belum Diambil','Habis (Expired)','Diklaim (Hangus)',null,'Aktif']){
   const id='G-'+(++n),key='warranty-'+n,guard={table:'garansi',id,expected:{status}};
   await db.query('insert into garansi(id_garansi,cabang,status) values($1,$2,$3)',[id,branch,status]);
   await db.query("select sla_ops_enqueue($1,$2,$3,'warranty_followup',null,$4)",[key,branch,JSON.stringify([{phone:'081234567890',message:'Follow up'}]),JSON.stringify(guard)]);
   const e=(await db.query('select * from sla_ops_lease($1,1)',[key])).rows[0];assert.ok(e);
   const delivery=(await db.query('select sla_ops_prepare_delivery($1,$2) d',[e.id,e.lease])).rows[0].d;
   assert.equal(delivery.allowed,status==='Aktif',branch+' '+status);
   if(status!=='Aktif'){
    assert.equal(delivery.obsolete,true);
    assert.deepEqual((await db.query('select state,sent_at,lease from sla_ops_outbox where id=$1',[e.id])).rows[0],{state:'obsolete',sent_at:null,lease:null});
    assert.equal((await db.query('select follow_up_after_sales_terkirim from garansi where id_garansi=$1',[id])).rows[0].follow_up_after_sales_terkirim,null);
   }
  }
  for(const [key,kind,guard,allowed]of [
   ['no-card','warranty_followup',{table:'garansi',id:'missing'},false],
   ['other-branch','warranty_followup',{table:'garansi',id:'G-12'},false],
   ['storage','storage_reminder',{table:'garansi',id:'G-1',expected:{status:'Masa Tunggu'}},true]
  ]){
   // Direct insertion models an old queue entry that predates today's guard.
   const e=(await db.query("insert into sla_ops_outbox(event_key,cabang,phone,message,kind,guard,state,lease,lease_until) values($1,'Kendari','6281234567890','Reminder',$2,$3,'sending',gen_random_uuid(),now()+interval '3 minutes') returning *",[key,kind,JSON.stringify(guard)])).rows[0];
   assert.equal((await db.query('select sla_ops_prepare_delivery($1,$2) d',[e.id,e.lease])).rows[0].d.allowed,allowed,key);
  }
  await db.exec("update garansi set status='Masa Tunggu' where id_garansi='G-6'");
  const active=(await db.query("select * from sla_ops_outbox where event_key='warranty-6'")).rows[0];
  assert.equal((await db.query('select sla_ops_prepare_delivery($1,$2) d',[active.id,active.lease])).rows[0].d.obsolete,true);
 }finally{await db.close();}
});
test('Raha delivery appends the active admin contact once, follows number changes and preserves Kendari messages',async()=>{
 const db=await setup();
 try{
  const body='Detail layanan TKT-1\nhttps://example.test/?track=TKT-1';
  assert.equal((await db.query("select sla_ops_branch_contact($1,'Kendari') m",[body])).rows[0].m,body);
  const formatted=(await db.query("select sla_ops_branch_contact($1,'Raha') m",[body])).rows[0].m;
  assert.ok(formatted.startsWith(body));assert.match(formatted,/Admin Raha/);assert.match(formatted,/WhatsApp: \+6281111111111/);assert.match(formatted,/https:\/\/wa.me\/6281111111111/);
  assert.equal((await db.query("select sla_ops_branch_contact($1,'Raha') m",[formatted])).rows[0].m,formatted);
  await db.exec("update users set no_wa='081222222222' where username='raha-admin'");
  const updated=(await db.query("select sla_ops_branch_contact($1,'Raha') m",[formatted])).rows[0].m;
  assert.doesNotMatch(updated,/6281111111111/);assert.match(updated,/6281222222222/);assert.equal(updated.split('Admin Raha').length,2);
  await db.exec("create or replace function sla_client_working_time(p_branch text,p_at timestamptz default clock_timestamp()) returns boolean language sql immutable as $$select true$$");
  for(const kind of ['relay','storage_reminder','warranty_claim_client','broadcast','client_notification','ticket_reminder']){
   await db.query('select sla_ops_enqueue($1,\'Raha\',$2,$3)',[kind,JSON.stringify([{phone:'081234567890',message:body}]),kind]);
   const e=(await db.query('select * from sla_ops_lease($1,1)',[kind])).rows[0];
   const sent=(await db.query('select sla_ops_prepare_delivery($1,$2) d',[e.id,e.lease])).rows[0].d;
   assert.equal(sent.allowed,true);assert.match(sent.message,/https:\/\/wa.me\/6281222222222/);assert.match(sent.message,/Detail layanan TKT-1/);
   assert.equal((await db.query('select message from sla_ops_outbox where id=$1',[e.id])).rows[0].message,body);
  }
 }finally{await db.close();}
});
test('queued response warnings stop on On Progress or a recorded response without blocking work-deadline warnings',async()=>{
 const db=await setup();
 try{
  let n=0;
  for(const branch of ['Kendari','Raha'])for(const status of ['Menunggu','Claim Garansi','On Progress','Pending','Outsource','Selesai','Cancel'])for(const responded of [false,true]){
   const id='T-'+(++n);await db.query('insert into tiket(id_tiket,cabang,status,waktu_respon) values($1,$2,$3,$4)',[id,branch,status,responded?new Date():null]);
   for(const marker of ['RESPON_WARNED','PENGERJAAN_WARNED']){
    const e=(await db.query("insert into sla_ops_outbox(event_key,cabang,phone,message,kind,marker,guard,state,lease,lease_until) values($1,$2,'6281234567890','Internal','ticket_reminder',$3,$4,'sending',gen_random_uuid(),now()+interval '3 minutes') returning *",[id+marker,branch,marker,JSON.stringify({table:'tiket',id})])).rows[0];
    const result=(await db.query('select sla_ops_prepare_delivery($1,$2) d',[e.id,e.lease])).rows[0].d;
    const allowed=marker==='PENGERJAAN_WARNED'||!responded&&['Menunggu','Claim Garansi'].includes(status);
    assert.equal(result.allowed,allowed,branch+' '+status+' '+responded+' '+marker);
    if(!allowed)assert.equal(result.obsolete,true);
   }
  }
 }finally{await db.close();}
});
test('new delivery helpers remain server-only',async()=>{
 const db=await setup();
 try{
  for(const role of ['anon','authenticated'])for(const fn of ['sla_ops_branch_contact(text,text)','sla_client_working_time(text,timestamptz)','sla_client_greeting(text)','sla_ops_is_client_message(text,text,text,text)','sla_ops_prepare_delivery(uuid,uuid)','sla_ops_queue_warranty_client(uuid)']){
   assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') ok',[role,fn])).rows[0].ok,false,role+' '+fn);
  }
 }finally{await db.close();}
});
