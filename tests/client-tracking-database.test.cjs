const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {test}=require('node:test');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{({PGlite}=require('../tmp/sales-claims-qa/node_modules/@electric-sql/pglite'));}
const sql=fs.readFileSync(path.resolve(__dirname,'../maintenance/client-tracking-supabase.sql'),'utf8');
const guards=fs.readFileSync(path.resolve(__dirname,'../maintenance/client-tracking-document-guards.sql'),'utf8');
test('tracking limits and document commits are atomic, private and preserve ticket data',async()=>{
 const db=new PGlite();
 try{
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);"+
   "create table public.users(auth_id uuid primary key,username text,nama_asli text,role text,hak_akses_cabang text,cabang text);"+
   "create table public.tiket(id_tiket text primary key,status text,waktu_selesai timestamptz,klien_lokasi text,teknisi text,deskripsi_pekerjaan_ba text,kritik_saran text,nama_customer text,tanda_tangan text,cabang text,link_pdf_ba text,nilai_penjualan numeric);");
  await db.exec(sql);
  await db.exec(guards);
  await db.exec("insert into public.users values('11111111-1111-1111-1111-111111111111','manager','Manager Simulasi','manager','Kendari','Kendari'),"+
   "('22222222-2222-2222-2222-222222222222','admin_raha','Admin Raha','admin_raha','Semua','Raha');"+
   "insert into public.tiket values('TKT-QA','Selesai','2026-10-08T08:00:00+08:00','Klien Simulasi','Teknisi Satu','Pekerjaan','-', 'Klien Simulasi','signed-data','Kendari',null,12345);");
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);
   await assert.rejects(db.query('select public.sla_consume_tracking_limit($1,2)',['a'.repeat(64)]),/permission denied/);
   await assert.rejects(db.query('select * from public.sla_ticket_documents'),/permission denied/);
   await db.exec('reset role');
  }
  for(const expected of [true,true,false])assert.equal((await db.query('select public.sla_consume_tracking_limit($1,2) as allowed',['a'.repeat(64)])).rows[0].allowed,expected);
  const keys=['id_tiket','status','waktu_selesai','klien_lokasi','teknisi','deskripsi_pekerjaan_ba','kritik_saran','nama_customer','tanda_tangan'];
  const original=(await db.query('select * from public.tiket')).rows[0],snapshot=Object.fromEntries(keys.map(k=>[k,original[k]]));
  const args=['TKT-QA',null,JSON.stringify(snapshot),'ba/TKT-QA/33333333-3333-3333-3333-333333333333.pdf','b'.repeat(64),100,'11111111-1111-1111-1111-111111111111',null,'c'.repeat(64)];
  const call='select public.sla_commit_ticket_document($1,$2,$3::jsonb,$4,$5,$6,$7::uuid,$8,$9)';
  await assert.rejects(db.query(call,[...args.slice(0,6),'22222222-2222-2222-2222-222222222222',...args.slice(7)]),/tidak berhak/);
  await assert.rejects(db.query(call,[...args.slice(0,2),JSON.stringify({...snapshot,deskripsi_pekerjaan_ba:'Changed'}),...args.slice(3)]),/Data BA berubah/);
  assert.equal((await db.query('select count(*) from public.sla_ticket_documents')).rows[0].count,0);
  await db.query(call,args);
  const saved=(await db.query('select * from public.tiket')).rows[0];
  assert.equal(saved.link_pdf_ba,'storage:'+args[3]);
  for(const key of Object.keys(original).filter(k=>k!=='link_pdf_ba'))assert.deepEqual(saved[key],original[key]);
  await assert.rejects(db.query(call,args),/Dokumen berubah/);
  assert.equal((await db.query('select count(*) from public.sla_ticket_documents')).rows[0].count,1);
  assert.equal((await db.query("select public from storage.buckets where id='sla-ticket-documents'")).rows[0].public,false);
 }finally{await db.close();}
});

