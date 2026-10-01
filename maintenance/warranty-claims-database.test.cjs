const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const db=new PGlite();
const migration=fs.readFileSync(__dirname+'/warranty-claims.sql','utf8');
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
 create table users(username text primary key,auth_id uuid,role text,nama_asli text,hak_akses_cabang text,cabang text,no_wa text);
 create table garansi(id_garansi text primary key,referensi_tiket_nota text,cabang text,status text,tanggal_mulai timestamptz,tanggal_habis timestamptz,nama_pelanggan text,barang_jasa text);
 create table tiket(id_tiket text primary key,cabang text,teknisi text,waktu_lapor timestamptz,target_sla_jam text,tenggat_waktu timestamptz,klien_lokasi text,jenis_pekerjaan text,status text,target_sla_respon_jam numeric,tenggat_respon timestamptz,no_wa_klien text,admin_sla text,keterangan text,bobot_poin numeric,poin_performa numeric);
 insert into users values ('admin','11111111-1111-1111-1111-111111111111','admin','Admin','Kendari','Kendari','08111'),('sales','22222222-2222-2222-2222-222222222222','sales','Sales','Kendari','Kendari','08222'),('tech',null,'teknisi','Teknisi A','Kendari','Kendari','081222222222'),('tech-b',null,'teknisi','Teknisi B','Kendari','Kendari','081333333333');
 insert into tiket(id_tiket,cabang,teknisi,target_sla_jam,target_sla_respon_jam,no_wa_klien,klien_lokasi,jenis_pekerjaan) values('ORIG','Kendari','Teknisi A, Teknisi B','9',1,'081444444444','Klien','Printer');
 set request.jwt.claim.role='service_role';`);
 await db.exec(migration);await db.exec(migration);
});after(()=>db.close());
async function warranty(id,status='Aktif',origin='ORIG',expired=false){await db.query("insert into garansi values($1,$2,'Kendari',$3,now()-interval '1 day',now()+($4::integer)*interval '1 day','Klien','Printer',null)",[id,origin,status,expired?-1:1]);}
const claim=(id,actor='11111111-1111-1111-1111-111111111111',branch='Kendari')=>db.query('select sla_klaim_garansi($1,$2,$3) result',[actor,id,branch]);
test('Creates a new warranty ticket for all original technicians and queues customer/technician notifications exactly once',async()=>{
 await warranty('GRS-TEST');const r=(await claim('GRS-TEST')).rows[0].result;assert.equal(r.idTiket,'TKT-KG-GRS-TEST');assert.equal(r.notifikasiTertunda,3);
 const t=(await db.query('select * from tiket where id_tiket=$1',[r.idTiket])).rows[0];assert.equal(t.status,'Claim Garansi');assert.equal(t.teknisi,'Teknisi A, Teknisi B');assert.equal(t.referensi_tiket_asal,'ORIG');assert.equal(t.garansi_asal,'GRS-TEST');assert.ok(t.tenggat_respon>t.waktu_lapor);assert.equal(t.bobot_poin,'0');
 const g=(await db.query("select * from garansi where id_garansi='GRS-TEST'")).rows[0];assert.equal(g.status,'Diklaim (Hangus)');assert.equal(g.tiket_klaim_garansi,r.idTiket);
 const n=(await db.query('select * from sla_notif_klaim_garansi order by penerima')).rows;assert.equal(n.length,3);assert.deepEqual(n.map(x=>x.no_wa),['081444444444','081222222222','081333333333']);assert.ok(n.every(x=>x.pesan.includes(r.idTiket)));
 const retry=(await claim('GRS-TEST')).rows[0].result;assert.equal(retry.sudahAda,true);assert.equal(retry.idTiket,r.idTiket);assert.equal((await db.query('select * from sla_notif_klaim_garansi')).rows.length,3);
});
test('Authorization, expired warranties and missing technicians roll back without consuming warranty',async()=>{
 for(const id of ['DENY','EXPIRED','WAIT','MISSING','EMPTY'])await warranty(id,id==='WAIT'?'Masa Tunggu':'Aktif',id==='MISSING'?'ABSENT':'ORIG',id==='EXPIRED');
 await assert.rejects(claim('DENY','22222222-2222-2222-2222-222222222222'),/manajemen/);await assert.rejects(claim('DENY',undefined,'Raha'),/hak akses/);
 await assert.rejects(claim('EXPIRED'),/sudah habis/);await assert.rejects(claim('WAIT'),/belum aktif/);await assert.rejects(claim('MISSING'),/Tiket asal/);
 await db.exec("update tiket set teknisi='Belum Ditugaskan' where id_tiket='ORIG'");await assert.rejects(claim('EMPTY'),/Teknisi/);await db.exec("update tiket set teknisi='Teknisi A, Teknisi B' where id_tiket='ORIG'");
 assert.equal((await db.query("select status from garansi where id_garansi='EMPTY'")).rows[0].status,'Aktif');
 await db.exec("set request.jwt.claim.role='authenticated'");await assert.rejects(claim('DENY'),/Akses server/);await db.exec("set request.jwt.claim.role='service_role'");
});
test('SLA respects WITA, lunch, afternoon break, Sundays and branch closing hours',async()=>{
 const due=async(start,hours,branch)=>(await db.query('select sla_tenggat_garansi($1,$2,$3) as due',[start,hours,branch])).rows[0].due.toISOString();
 assert.equal(await due('2026-10-01T11:30:00+08:00',1,'Kendari'),'2026-10-01T06:00:00.000Z');
 assert.equal(await due('2026-10-03T16:30:00+08:00',1,'Kendari'),'2026-10-05T00:30:00.000Z');
 assert.equal(await due('2026-10-01T16:30:00+08:00',1,'Raha'),'2026-10-01T09:30:00.000Z');
});
test('Notification leases prevent simultaneous sends, reject stale acknowledgments and retain failed delivery',async()=>{
 const a=(await db.query("select * from sla_ambil_notif_garansi('GRS-TEST')")).rows;assert.equal(a.length,3);assert.equal((await db.query("select * from sla_ambil_notif_garansi('GRS-TEST')")).rows.length,0);
 const done=async(e,ok,lease=e.lease)=>(await db.query('select sla_selesai_notif_garansi($1,$2,$3,$4) result',[e.id,lease,ok,'Provider gagal'])).rows[0].result;
 assert.equal(await done(a[0],true,'00000000-0000-0000-0000-000000000000'),false);assert.equal(await done(a[0],true),true);assert.equal(await done(a[1],false),true);
 const row=(await db.query('select * from sla_notif_klaim_garansi where id=$1',[a[1].id])).rows[0];assert.equal(row.terkirim_pada,null);assert.equal(row.galat,'Provider gagal');assert.equal(row.percobaan,1);
});
