const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {PGlite}=require('../tmp/sales-claims-qa/node_modules/@electric-sql/pglite');
const migration=fs.readFileSync(__dirname+'/../supabase/migrations/20261022070836_notification_uncertain_delivery_guard.sql','utf8');
test('all five durable queues quarantine expired/uncertain delivery and preserve confirmed rejection retries',async()=>{
 const db=new PGlite();
 try {
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create function auth.role() returns text language sql as $$select 'service_role'::text$$;"+
 "create table users(username text,no_wa text);"+
 "create table sla_notif_absensi(id uuid primary key default gen_random_uuid(),id_pengajuan text,terkirim_pada timestamptz,coba_pada timestamptz default now(),lease_id uuid,lease_sampai timestamptz,percobaan int default 0,dibuat_pada timestamptz default now(),galat text);"+
 "create table sla_notif_kenaikan_gaji(id uuid primary key default gen_random_uuid(),username text,no_wa text,terkirim_pada timestamptz,coba_lagi_pada timestamptz default now(),lease uuid,lease_sampai timestamptz,percobaan int default 0,galat text);"+
 "create table sla_notif_klaim_garansi(id uuid primary key default gen_random_uuid(),id_garansi text,penerima text,terkirim_pada timestamptz,lease uuid,lease_sampai timestamptz,percobaan int default 0,galat text);"+
 "create table sla_notif_klaim_sales(id uuid primary key default gen_random_uuid(),klaim_id uuid,terkirim_pada timestamptz,coba_pada timestamptz default now(),lease_id uuid,terkunci_sampai timestamptz,percobaan int default 0,dibuat_pada timestamptz default now(),error_terakhir text);"+
 "create table sla_password_reset_requests(id uuid primary key default gen_random_uuid(),completed_at timestamptz,requested_at timestamptz default now());"+
 "create table sla_password_reset_notifications(id uuid primary key default gen_random_uuid(),request_id uuid,sent_at timestamptz,attempts int default 0,retry_at timestamptz default now(),lease uuid,lease_until timestamptz);"+
 "insert into sla_password_reset_requests default values;");
 await db.exec(migration);
 const queues=[
 ['sla_notif_absensi','sla_ambil_notif_absensi(null)','lease_id','lease_sampai','insert into sla_notif_absensi default values'],
 ['sla_notif_kenaikan_gaji','sla_ambil_notif_gaji(null)','lease','lease_sampai','insert into sla_notif_kenaikan_gaji default values'],
 ['sla_notif_klaim_garansi',"sla_ambil_notif_garansi('G')",'lease','lease_sampai',"insert into sla_notif_klaim_garansi(id_garansi) values('G')"],
 ['sla_notif_klaim_sales','sla_ambil_notif_klaim_sales(null)','lease_id','terkunci_sampai','insert into sla_notif_klaim_sales default values'],
 ['sla_password_reset_notifications','sla_lease_password_reset_notifications(null)','lease','lease_until','insert into sla_password_reset_notifications(request_id) select id from sla_password_reset_requests']];
 for(const [table,fn,lease,until,insert] of queues){
  await db.exec(insert);let row=(await db.query('select * from '+fn)).rows[0];assert.ok(row,table);
  assert.equal((await db.query('select * from '+fn)).rows.length,0,table+' concurrency');
  await db.exec("update "+table+" set "+until+"=now()-interval '1 minute'");
  assert.equal((await db.query('select * from '+fn)).rows.length,0,table+' expired delivery');
  assert.equal((await db.query('select delivery_uncertain from '+table)).rows[0].delivery_uncertain,true);
  await db.exec("update "+table+" set delivery_uncertain=false,"+lease+"=null,"+until+"=null");
  row=(await db.query('select * from '+fn)).rows[0];assert.ok(row,table+' confirmed rejection can retry');
  const marked=(await db.query('select sla_mark_notif_uncertain($1,$2,$3) ok',[table,row.id,row[lease]])).rows[0].ok;
  assert.equal(marked,true);
  assert.equal((await db.query('select * from '+fn)).rows.length,0,table+' unknown outcome');
 }
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'sla_mark_notif_uncertain(text,uuid,uuid)','execute') ok",[role])).rows[0].ok,false);
 }finally{await db.close();}
});
for(const file of ['sla-payroll-attendance','sla-profile'])for(const mode of ['accepted','rejected','timeout','malformed','server-error']){
 test(file+' provider outcome: '+mode,async()=>{
  const source=fs.readFileSync(__dirname+'/../supabase/functions/'+file+'/index.ts','utf8'),held=[];
  const c=vm.createContext({Error,holdUncertainWhatsApp:async(queue,event)=>held.push([queue,event.id]),
   fetch:async()=>{if(mode==='timeout')throw Error('timeout');if(mode==='malformed')return new Response('not JSON');return Response.json(mode==='server-error'?{}:{status:mode==='accepted'},{status:mode==='server-error'?503:200});}});
  vm.runInContext(source.slice(source.indexOf('async function durableWhatsApp('),source.indexOf('async function holdUncertainWhatsApp(')),c);
  if(mode==='rejected')await assert.rejects(c.durableWhatsApp('queue',{id:'fixture'},{}),/menolak/);
  else assert.equal(await c.durableWhatsApp('queue',{id:'fixture'},{}),mode==='accepted');
  assert.equal(held.length,['timeout','malformed','server-error'].includes(mode)?1:0);
 });
}
