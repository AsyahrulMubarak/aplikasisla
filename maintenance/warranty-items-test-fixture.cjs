const fs=require('node:fs');
const {PGlite}=require('../tmp/sales-claims-qa/node_modules/@electric-sql/pglite');
const admin='11111111-1111-1111-1111-111111111111',raha='22222222-2222-2222-2222-222222222222';
async function createWarrantyTestDatabase(){
 const db=new PGlite();let legacySnapshot;

 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
 create table users(username text primary key,auth_id uuid,role text,nama_asli text,hak_akses_cabang text,cabang text,no_wa text);
 create table garansi(id_garansi text primary key,referensi_tiket_nota text,cabang text,status text,tanggal_mulai timestamptz,tanggal_habis timestamptz,nama_pelanggan text,barang_jasa text,durasi_hari integer,riwayat_follow_up text,keterangan text,no_transaksi text,sales text,omzet numeric,admin_sla text,follow_up_after_sales_terkirim text);
 create table penjualan(id_penjualan text primary key,cabang text,waktu_lapor timestamptz);
 create table tiket(id_tiket text primary key,cabang text,teknisi text,waktu_lapor timestamptz,waktu_selesai timestamptz,target_sla_jam text,tenggat_waktu timestamptz,klien_lokasi text,jenis_pekerjaan text,status text,target_sla_respon_jam numeric,tenggat_respon timestamptz,no_wa_klien text,admin_sla text,keterangan text,bobot_poin numeric,poin_performa numeric,no_transaksi text);
 insert into users values('admin','${admin}','admin','Admin','Kendari','Kendari','08111'),('raha','${raha}','admin_raha','Admin Raha','Raha','Raha','08122'),('sales','33333333-3333-3333-3333-333333333333','sales','Sales','Kendari','Kendari','08133'),('tech',null,'teknisi','Teknisi A','Kendari','Kendari','081444444444'),('tech2',null,'teknisi','Teknisi B','Raha','Raha','081555555555');
 insert into tiket(id_tiket,cabang,teknisi,waktu_selesai,no_wa_klien,target_sla_jam,target_sla_respon_jam) values('ORIG','Kendari','Teknisi A, Teknisi B',now()-interval '1 day','081666666666','9',1),('ORIG-R','Raha','Teknisi B',now()-interval '1 day','081777777777','9',1);
 set request.jwt.claim.role='service_role';`);
 await db.exec(fs.readFileSync(__dirname+'/warranty-claims.sql','utf8'));
 await db.exec(fs.readFileSync(__dirname+'/warranty-storage.sql','utf8'));
 await db.exec(`insert into garansi(id_garansi,referensi_tiket_nota,cabang,status,tanggal_mulai,tanggal_habis,nama_pelanggan,barang_jasa,durasi_hari,keterangan,tiket_klaim_garansi)
 values('HISTORICAL','ORIG','Kendari','Diklaim (Hangus)',now()-interval '10 days',now()-interval '2 days','Klien','Deskripsi gabungan lama',7,'Catatan lama','TKT-KG-LAMA');`);
 legacySnapshot=(await db.query("select to_jsonb(g) snapshot from garansi g where id_garansi='HISTORICAL'")).rows[0].snapshot;
 await db.exec(fs.readFileSync(__dirname+'/warranty-items.sql','utf8'));
 await db.exec(fs.readFileSync(__dirname+'/warranty-items.sql','utf8'));
 return {db,legacySnapshot,admin,raha};
}
module.exports={createWarrantyTestDatabase,admin,raha};
