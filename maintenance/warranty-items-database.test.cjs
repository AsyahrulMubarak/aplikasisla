const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createWarrantyTestDatabase,admin,raha}=require('./warranty-items-test-fixture.cjs');
let db,legacySnapshot;
before(async()=>{ ({db,legacySnapshot}=await createWarrantyTestDatabase()); });

after(()=>db.close());
const row=async id=>(await db.query('select * from garansi where id_garansi=$1',[id])).rows[0];
const items=()=>[{id:'os',nama:'Instal ulang',durasi_hari:7},{id:'ssd',nama:'SSD SN-123',durasi_hari:90},{id:'keyboard',nama:'Keyboard',durasi_hari:30}];
async function create(id,branch='Kendari',state='Aktif',value=items(),origin=branch==='Raha'?'ORIG-R':'ORIG'){
 await db.query('insert into garansi(id_garansi,referensi_tiket_nota,cabang,status,durasi_hari,barang_jasa,nama_pelanggan,item_garansi) values($1,$2,$3,$4,90,$5,$6,$7)',[id,origin,branch,state,'Laptop lengkap','Klien',JSON.stringify(value)]);return row(id);
}
const claim=(id,ids=['os'],request=crypto.randomUUID(),actor=admin,branch='Kendari',complaint='Tidak dapat masuk sistem')=>db.query('select sla_klaim_item_garansi($1,$2,$3,$4,$5,$6) result',[actor,id,branch,ids,request,complaint]).then(r=>r.rows[0].result);
const split=(id,value,actor=admin,branch='Kendari')=>db.query('select sla_simpan_item_garansi($1,$2,$3,$4) result',[actor,id,branch,JSON.stringify(value)]);

test('migration preserves every historical field, claim ticket, date and note',async()=>{
 const historical=(await db.query("select to_jsonb(g) snapshot from garansi g where id_garansi='HISTORICAL'")).rows[0].snapshot;const {item_garansi,riwayat_klaim_item,...old} = historical;
 assert.deepEqual(old,legacySnapshot);assert.deepEqual(item_garansi,[]);assert.deepEqual(riwayat_klaim_item,[]);
 await assert.rejects(split('HISTORICAL',items()),/pernah diklaim/);
 assert.equal((await db.query("select sla_klaim_garansi($1,'HISTORICAL','Kendari') result",[admin])).rows[0].result.idTiket,'TKT-KG-LAMA');
});

test('activation computes each duration from the same pickup, overwriting forged claim status/dates',async()=>{
 const input=items();input[0].status='Diklaim (Hangus)';input[0].tanggal_habis='2099-01-01';input[0].tiket_klaim_garansi='FORGED';
 const g=await create('ACTIVATE','Kendari','Masa Tunggu',input);
 assert.ok(g.item_garansi.every(x=>x.status==='Masa Tunggu'&&x.tanggal_habis===null&&!x.tiket_klaim_garansi));
 await db.query("update garansi set status='Aktif' where id_garansi=$1",['ACTIVATE']);const active=await row('ACTIVATE');
 assert.ok(active.waktu_diambil);for(const x of active.item_garansi){assert.equal(x.status,'Aktif');assert.equal(new Date(x.tanggal_habis)-new Date(x.tanggal_mulai),x.durasi_hari*86400000);}
 assert.equal(active.tanggal_habis-active.tanggal_mulai,90*86400000);
});

test('one claim consumes only selected item and preserves all original expiry dates exactly',async()=>{
 const before=await create('PARTIAL');const request=crypto.randomUUID();const result=await claim('PARTIAL',['os'],request);const after=await row('PARTIAL');
 assert.equal(after.status,'Aktif');assert.equal(after.tanggal_habis.getTime(),before.tanggal_habis.getTime());
 assert.equal(after.item_garansi[0].status,'Diklaim (Hangus)');assert.equal(after.item_garansi[0].tanggal_habis,before.item_garansi[0].tanggal_habis);
 assert.deepEqual(after.item_garansi.slice(1),before.item_garansi.slice(1));assert.equal(after.riwayat_klaim_item.length,1);assert.deepEqual(after.riwayat_klaim_item[0].item_ids,['os']);
 const ticket=(await db.query('select * from tiket where id_tiket=$1',[result.idTiket])).rows[0];
 assert.equal(ticket.jenis_pekerjaan,'Instal ulang');assert.equal(ticket.teknisi,'Teknisi A, Teknisi B');assert.equal(ticket.garansi_asal,'PARTIAL');assert.equal(ticket.referensi_tiket_asal,'ORIG');assert.equal(ticket.bobot_poin,'0');assert.match(ticket.keterangan,/Tidak dapat masuk sistem/);
 const notifications=(await db.query('select * from sla_notif_klaim_garansi where id_garansi=$1',['PARTIAL'])).rows;
 assert.equal(notifications.length,3);assert.ok(notifications.every(x=>x.pesan.includes('Instal ulang')&&!x.pesan.includes('SSD SN-123')));
 const retry=await claim('PARTIAL',['os'],request);assert.equal(retry.sudahAda,true);assert.equal(retry.idTiket,result.idTiket);
 await assert.rejects(claim('PARTIAL',['ssd'],request),/pilihan item lain/);
 await assert.rejects(claim('PARTIAL',['os']),/sudah diklaim/);
 const second=await claim('PARTIAL',['ssd']);assert.notEqual(second.idTiket,result.idTiket);const third=await claim('PARTIAL',['keyboard']);assert.notEqual(third.idTiket,second.idTiket);
 const done=await row('PARTIAL');assert.equal(done.status,'Diklaim (Hangus)');assert.equal(done.riwayat_klaim_item.length,3);assert.equal(done.tanggal_habis.getTime(),before.tanggal_habis.getTime());
 assert.equal((await db.query("select count(*)::int n from sla_notif_klaim_garansi where id_garansi='PARTIAL'")).rows[0].n,9);
});

test('multi-selection is atomic, supports Raha and sends one notification per recipient and incident',async()=>{
 const before=await create('RAHA','Raha');const r=await claim('RAHA',['os','keyboard'],crypto.randomUUID(),raha,'Raha');const after=await row('RAHA');
 assert.match(r.idTiket,/^TKT-R-KG-/);assert.equal(after.item_garansi[0].status,'Diklaim (Hangus)');assert.equal(after.item_garansi[2].status,'Diklaim (Hangus)');assert.deepEqual(after.item_garansi[1],before.item_garansi[1]);
 assert.equal(after.riwayat_klaim_item.length,1);assert.equal((await db.query("select count(*)::int n from sla_notif_klaim_garansi where id_garansi='RAHA'")).rows[0].n,2);
});

test('invalid, foreign, duplicate, expired and waiting items do not consume any entitlement',async()=>{
 await create('INVALID');await create('WAIT','Kendari','Masa Tunggu');await create('ZERO','Kendari','Aktif',[...items(),{id:'none',nama:'Tanpa garansi',durasi_hari:0}]);
 for(const selected of [[],['missing'],['os','missing'],['os','os'],[null]])await assert.rejects(claim('INVALID',selected));
 await assert.rejects(claim('WAIT'),/belum aktif/);await assert.rejects(claim('ZERO',['none']),/belum aktif/);
 assert.ok((await row('INVALID')).item_garansi.every(x=>x.status==='Aktif'));
 assert.equal((await db.query("select count(*)::int n from tiket where garansi_asal='INVALID'")).rows[0].n,0);
});

test('authorization, branch scope and authenticated direct RPC calls are checked before mutation',async()=>{
 await create('DENY');await assert.rejects(claim('DENY',['os'],crypto.randomUUID(),'33333333-3333-3333-3333-333333333333'),/manajemen/);
 await assert.rejects(claim('DENY',['os'],crypto.randomUUID(),raha),/hak akses/);
 await db.exec("set request.jwt.claim.role='authenticated';set sla.warranty_items_write='on'");
 await assert.rejects(claim('DENY'),/Akses server/);await assert.rejects(split('DENY',items()),/Akses server/);
 await assert.rejects(db.exec("update garansi set item_garansi='[]' where id_garansi='DENY'"),/pengelolaan item/);
 await db.exec("set request.jwt.claim.role='service_role';set sla.warranty_items_write=''");
});

test('direct edits cannot erase history, reactivate claims, change expiry or reassign card identity',async()=>{
 const g=await row('PARTIAL');
 for(const change of ["item_garansi='[]'","riwayat_klaim_item='[]'","status='Aktif'","tanggal_habis=now()+interval '999 days'","referensi_tiket_nota='ORIG-R'","cabang='Raha'"]){
  await assert.rejects(db.exec("update garansi set "+change+" where id_garansi='PARTIAL'"));
 }
 await db.exec("update garansi set keterangan='Catatan diperbarui' where id_garansi='PARTIAL'");const saved=await row('PARTIAL');assert.deepEqual(saved.item_garansi,g.item_garansi);assert.deepEqual(saved.riwayat_klaim_item,g.riwayat_klaim_item);
});

test('seven-day storage rule still forfeits all card items and pickup does not start a new warranty',async()=>{
 for(const days of [7,8]){
  const origin='STORAGE-'+days;await db.query("insert into tiket(id_tiket,cabang,teknisi,waktu_selesai) values($1,'Kendari','Teknisi A',(now() at time zone 'Asia/Makassar')::date at time zone 'Asia/Makassar' - $2*interval '24 hours')",[origin,days]);
  await create(origin,'Kendari','Masa Tunggu',items(),origin);await db.query("update garansi set status='Aktif' where id_garansi=$1",[origin]);const g=await row(origin);
  if(days===7){assert.equal(g.garansi_hangus_pada,null);assert.ok(g.item_garansi.every(x=>x.status==='Aktif'));}
  else{assert.equal(g.status,'Hangus (Lewat 7 Hari)');assert.equal(g.biaya_penitipan,1000);assert.ok(g.item_garansi.every(x=>x.status==='Hangus (Lewat 7 Hari)'&&x.tanggal_habis===null));await assert.rejects(claim(origin),/mengendap/);await db.query("update garansi set status='Aktif',garansi_hangus_pada=null where id_garansi=$1",[origin]);assert.equal((await row(origin)).status,'Hangus (Lewat 7 Hari)');}
 }
});

test('splitting an active legacy card inherits exact dates and cannot extend its original entitlement',async()=>{
 await create('LEGACY','Kendari','Aktif',[]);const before=await row('LEGACY');await split('LEGACY',items());const after=await row('LEGACY');
 assert.equal(after.item_garansi.length,3);assert.ok(after.item_garansi.every(x=>new Date(x.tanggal_habis).getTime()===before.tanggal_habis.getTime()&&x.durasi_hari===before.durasi_hari));
 await assert.rejects(split('LEGACY',items()),/sudah berjalan/);
 await create('LEGACY-EXPIRED','Kendari','Aktif',[]);await db.exec("update garansi set tanggal_mulai=now()-interval '91 days',tanggal_habis=now()-interval '1 day' where id_garansi='LEGACY-EXPIRED'");
 const expired=await row('LEGACY-EXPIRED');await split('LEGACY-EXPIRED',items());const migrated=await row('LEGACY-EXPIRED');assert.equal(migrated.tanggal_habis.getTime(),expired.tanggal_habis.getTime());await assert.rejects(claim('LEGACY-EXPIRED'),/sudah habis/);
});

test('waiting item details can change safely, while malformed items and spoofed histories are rejected',async()=>{
 await create('EDIT-WAIT','Kendari','Masa Tunggu');await split('EDIT-WAIT',[{id:'printer',nama:'Printer SN-222',durasi_hari:30}]);const saved=await row('EDIT-WAIT');assert.equal(saved.item_garansi.length,1);assert.equal(saved.item_garansi[0].status,'Masa Tunggu');
 for(const value of [[{id:'same',nama:'A',durasi_hari:7},{id:'same',nama:'B',durasi_hari:7}],[{id:'blank',nama:' ',durasi_hari:7}],[{id:'bad',nama:'A',durasi_hari:-1}]])await assert.rejects(create('BAD-'+crypto.randomUUID(),'Kendari','Aktif',value));
 await assert.rejects(db.exec("insert into garansi(id_garansi,item_garansi,riwayat_klaim_item) values('FAKE-HISTORY','[]','[{\"id_tiket\":\"FAKE\"}]')"),/Riwayat klaim/);
});
