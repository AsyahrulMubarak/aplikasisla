const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {test,before,after}=require('node:test');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{({PGlite}=require(path.resolve(__dirname,fs.existsSync(path.resolve(__dirname,'../tmp/sales-claims-qa'))?'../tmp/sales-claims-qa/node_modules/@electric-sql/pglite':'../../sales-claims-qa/node_modules/@electric-sql/pglite')));}
const db=new PGlite();
const migration=fs.readFileSync(path.join(__dirname,'attendance-workday.sql'),'utf8');
const record=(id,at,type='Masuk',branch='Kendari',name='Mubarak')=>({id_absen:id,waktu_absen:at,nama_pegawai:name,role:'teknisi',tipe_absen:type,cabang:branch});
const seed=async r=>db.query('insert into absensi(id_absen,waktu_absen,nama_pegawai,tipe_absen,cabang) values($1,$2,$3,$4,$5)',[r.id_absen,r.waktu_absen,r.nama_pegawai,r.tipe_absen,r.cabang]);
const submit=(day,last,records,name='Mubarak')=>db.query('select sla_insert_absensi_batch($1,$2,$3,$4) as written',[name,day,last,JSON.stringify(records)]);
before(async()=>{
 await db.exec(`create table public.absensi(id_absen text primary key,waktu_absen timestamptz,nama_pegawai text,role text,tipe_absen text,jarak_meter numeric,status_disiplin text,keterangan text,bukti_foto text,lokasi_maps text,cabang text);`);
 await db.exec(migration);await db.exec(migration);
});
after(()=>db.close());
test('Mubarak can start a new day after the preceding overnight exit',async()=>{
 await seed(record('mubarak-overnight','2026-10-02T02:49:27+08:00','Keluar'));
 const r=await submit('2026-10-02','',[record('mubarak-next-morning','2026-10-02T08:00:00+08:00')]);
 assert.equal(r.rows[0].written,1);
 assert.equal((await db.query("select count(*)::int as n from absensi where id_absen='mubarak-overnight'")).rows[0].n,1);
});
test('The same overnight exit remains the preceding day’s latest record',async()=>{
 await assert.rejects(submit('2026-10-01','',[record('stale-previous','2026-10-01T12:00:00+08:00')]),/Data absensi berubah/);
 assert.equal((await submit('2026-10-01','mubarak-overnight',[record('corrected-previous','2026-10-01T12:00:00+08:00','Koreksi - Absen Masuk')])).rows[0].written,1);
});
test('A stale request after a real same-day entry is still rejected',async()=>{
 await assert.rejects(submit('2026-10-02','',[record('stale-duplicate','2026-10-02T08:01:00+08:00')]),/Data absensi berubah/);
 assert.equal((await db.query("select count(*)::int as n from absensi where id_absen='stale-duplicate'")).rows[0].n,0);
});
test('06:00 is current-day while 05:59 exits and corrected exits are previous-day',async()=>{
 for(const [i,time,type,belongs] of [[0,'05:59:59','Keluar','2026-10-03'],[1,'06:00:00','Keluar','2026-10-04'],[2,'02:00:00','Koreksi - Absen Keluar','2026-10-03'],[3,'02:00:00','Masuk','2026-10-04']]){
  const name='Boundary '+i,id='boundary-'+i;await seed(record(id,'2026-10-04T'+time+'+08:00',type,'Kendari',name));
  assert.equal((await submit(belongs,id,[record(id+'-correction',belongs+'T12:00:00+08:00','Koreksi - Absen Masuk','Kendari',name)],name)).rows[0].written,1);
 }
});
test('Branch isolation, employee validation and mixed-branch rejection remain intact',async()=>{
 await seed(record('other-branch','2026-10-06T08:00:00+08:00','Masuk','Raha','Same Name'));
 assert.equal((await submit('2026-10-06','',[record('kendari-entry','2026-10-06T08:01:00+08:00','Masuk','Kendari','Same Name')],'Same Name')).rows[0].written,1);
 await assert.rejects(submit('2026-10-07','',[record('mixed-k','2026-10-07T08:00:00+08:00'),record('mixed-r','2026-10-07T08:00:00+08:00','Masuk','Raha')]),/Cabang batch/);
 await assert.rejects(submit('2026-10-07','',[record('wrong-person','2026-10-07T08:00:00+08:00','Masuk','Kendari','Other')]),/pegawai lain/);
});
