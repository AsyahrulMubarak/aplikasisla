const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('../tmp/sales-claims-qa/node_modules/@electric-sql/pglite');
const db=new PGlite();
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
 create table users(username text primary key,auth_id uuid,role text,nama_asli text,hak_akses_cabang text,cabang text,no_wa text);
 create table garansi(id_garansi text primary key,referensi_tiket_nota text,cabang text,status text,tanggal_mulai timestamptz,tanggal_habis timestamptz,nama_pelanggan text,barang_jasa text,durasi_hari integer,riwayat_follow_up text);
 create table penjualan(id_penjualan text primary key,cabang text,waktu_lapor timestamptz);
 create table tiket(id_tiket text primary key,cabang text,teknisi text,waktu_lapor timestamptz,waktu_selesai timestamptz,target_sla_jam text,tenggat_waktu timestamptz,klien_lokasi text,jenis_pekerjaan text,status text,target_sla_respon_jam numeric,tenggat_respon timestamptz,no_wa_klien text,admin_sla text,keterangan text,bobot_poin numeric,poin_performa numeric);
 insert into users values('admin','11111111-1111-1111-1111-111111111111','admin','Admin','Kendari','Kendari','08111');
 set request.jwt.claim.role='service_role';`);
 await db.exec(fs.readFileSync(__dirname+'/warranty-claims.sql','utf8'));
 await db.exec(fs.readFileSync(__dirname+'/warranty-storage.sql','utf8'));
 await db.exec(fs.readFileSync(__dirname+'/warranty-storage.sql','utf8'));
});after(()=>db.close());
async function create(id,days,branch='Kendari'){
 await db.query("insert into tiket(id_tiket,cabang,teknisi,waktu_selesai) values($1,$2,'Teknisi',(date_trunc('day',now() at time zone 'Asia/Makassar')-$3*interval '24 hours') at time zone 'Asia/Makassar')",['TKT-'+id,branch,days]);
 await db.query("insert into garansi(id_garansi,referensi_tiket_nota,cabang,status,durasi_hari) values($1,$2,$3,'Masa Tunggu',30)",[id,'TKT-'+id,branch]);
}
const row=async id=>(await db.query('select * from garansi where id_garansi=$1',[id])).rows[0];
test('SQL fee boundaries use seven free days and a daily fee from day eight',async()=>{
 const r=await db.query("select sla_biaya_penitipan('2026-10-01T02:00Z','2026-10-08T02:00Z') free,sla_biaya_penitipan('2026-10-01T02:00Z','2026-10-08T16:00Z') first,sla_biaya_penitipan('2026-10-01T02:00Z','2026-10-29T02:00Z') day28");
 assert.deepEqual(r.rows[0],{free:0,first:1000,day28:21000});
});
test('late pickup forfeits both branches and cannot be reactivated or reset by direct PATCH',async()=>{
 for(const branch of ['Kendari','Raha']){
  const id='LATE-'+branch;await create(id,8,branch);const pending=await row(id);assert.equal(pending.status,'Masa Tunggu');assert.ok(pending.garansi_hangus_pada);assert.equal(pending.biaya_penitipan,1000);
  await db.query("update garansi set status='Aktif',tanggal_mulai=now(),tanggal_habis=now()+interval '30 days',waktu_diambil=now()-interval '4 days',garansi_hangus_pada=null where id_garansi=$1",[id]);
  const picked=await row(id);assert.equal(picked.status,'Hangus (Lewat 7 Hari)');assert.ok(picked.waktu_diambil);assert.equal(picked.tanggal_habis.getTime(),pending.garansi_hangus_pada.getTime());
  await db.query("update garansi set status='Masa Tunggu',waktu_diambil=null,waktu_siap_diambil=now(),garansi_hangus_pada=null where id_garansi=$1",[id]);
  const retry=await row(id);assert.equal(retry.status,picked.status);assert.equal(retry.waktu_diambil.getTime(),picked.waktu_diambil.getTime());assert.equal(retry.biaya_penitipan,1000);
 }
});
test('timely activation starts warranty once and does not incur later storage costs',async()=>{
 await create('EARLY',5);await db.exec("update garansi set status='Aktif' where id_garansi='EARLY'");
 const r=await row('EARLY');assert.equal(r.status,'Aktif');assert.equal(r.garansi_hangus_pada,null);assert.equal(r.biaya_penitipan,0);assert.equal(r.tanggal_habis-r.tanggal_mulai,30*86400000);
 await db.exec("select sla_perbarui_penitipan()");assert.equal((await row('EARLY')).biaya_penitipan,0);
});
test('day-five queue is unique, leases are exclusive, failures retry and pickup suppresses sending',async()=>{
 await create('NOTICE',5.1);await create('BEFORE',4);await create('TOO-LATE',8);
 await db.exec('select sla_perbarui_penitipan();select sla_perbarui_penitipan();');
 const q=(await db.query("select * from sla_notif_penitipan where id_garansi='NOTICE'")).rows;assert.equal(q.length,1);
 const events=(await db.query('select * from sla_ambil_notif_penitipan()')).rows;const e=events.find(x=>x.id_garansi==='NOTICE');assert.ok(e);
 assert.equal((await db.query('select * from sla_ambil_notif_penitipan()')).rows.length,0);
 assert.equal((await db.query('select sla_selesai_notif_penitipan($1,$2,false,$3) ok',[e.id,e.lease,'offline'])).rows[0].ok,true);
 await db.exec("update sla_notif_penitipan set lease_sampai=now()-interval '1 minute'; update garansi set status='Aktif' where id_garansi='NOTICE';");
 assert.equal((await db.query('select * from sla_ambil_notif_penitipan()')).rows.length,0);
});
test('forfeited warranties cannot create a ticket for the same fault',async()=>{
 await assert.rejects(db.query("select sla_klaim_garansi('11111111-1111-1111-1111-111111111111','LATE-Kendari','Kendari')"),/mengendap|sudah habis/);
 assert.equal((await db.query("select count(*)::int n from tiket where garansi_asal='LATE-Kendari'")).rows[0].n,0);
});
