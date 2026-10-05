const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{test,before,after}=require('node:test');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{({PGlite}=require('../tmp/sales-claims-qa/node_modules/@electric-sql/pglite'));}
const db=new PGlite();const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
async function role(name='service_role'){await db.exec('reset role; set role '+name);}
async function save({actor=1,user='worker',number='001111',old='001111',bank='BRI',oldBank=''}={}){
  return (await db.query('select public.sla_simpan_rekening_bank_pegawai($1,$2,$3,$4,$5,$6) as result',[uuid(actor),user,number,old,bank,oldBank])).rows[0].result;
}
before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    create table public.users(username text primary key,auth_id uuid unique,role text,hak_akses_cabang text,cabang text);
    grant select on public.users to service_role;
    insert into public.users values ('manager','${uuid(1)}','manager','Semua','Kendari'),('admin','${uuid(2)}','admin','Kendari','Kendari'),
    ('director','${uuid(3)}','direktur','Semua','Kendari'),('admin-r','${uuid(4)}','admin','Raha','Raha'),
    ('admin-raha','${uuid(5)}','admin_raha','Raha','Raha'),('worker','${uuid(6)}','teknisi','Kendari','Kendari');`);
  await db.exec(fs.readFileSync(path.join(__dirname,'payroll-bank-accounts.sql'),'utf8'));
  await db.exec(`insert into public.sla_rekening_pegawai(username,nomor_rekening,diperbarui_oleh) values ('worker','001111','${uuid(1)}');`);
  await db.exec(fs.readFileSync(path.join(__dirname,'payroll-bank-name.sql'),'utf8'));await role();
});
after(async()=>{await db.close();});
test('Migration preserves existing account numbers and gives old rows an empty bank name',async()=>{
  const row=(await db.query("select * from public.sla_rekening_pegawai where username='worker'")).rows[0];assert.equal(row.nomor_rekening,'001111');assert.equal(row.nama_bank,'');
});
test('Three management roles save bank-only changes and retain leading zeroes',async()=>{
  for(const [actor,oldBank,bank] of [[1,'','BRI'],[2,'BRI','BCA'],[3,'BCA','BSI']]){
    const result=await save({actor,oldBank,bank});assert.equal(result.data.namaBank,bank);assert.equal(result.data.nomorRekening,'001111');
  }
});
test('Admin Raha and ordinary employees cannot edit bank data',async()=>{
  for(const actor of [4,5,6])await assert.rejects(save({actor,oldBank:'BSI'}),/hanya dapat diubah/);
});
test('Both bank and number participate in atomic conflict detection',async()=>{
  await assert.rejects(save({oldBank:'',bank:'BCA'}),/diubah pengguna lain/);
  await assert.rejects(save({old:'000000',oldBank:'BSI',bank:'BCA'}),/diubah pengguna lain/);
  const row=(await db.query("select nomor_rekening,nama_bank from public.sla_rekening_pegawai where username='worker'")).rows[0];
  assert.deepEqual(row,{nomor_rekening:'001111',nama_bank:'BSI'});
});
test('Legacy number-only RPC never clears the saved bank name',async()=>{
  await db.query('select public.sla_simpan_rekening_pegawai($1,$2,$3,$4)',[uuid(1),'worker','009999','001111']);
  assert.equal((await db.query("select nama_bank from public.sla_rekening_pegawai where username='worker'")).rows[0].nama_bank,'BSI');
});
test('Invalid bank names are rejected and clearing bank name retains the account number',async()=>{
  for(const bank of [null,'x'.repeat(101),'Bank\nTest',' BCA '])await assert.rejects(save({number:'009999',old:'009999',bank,oldBank:'BSI'}));
  const result=await save({number:'009999',old:'009999',bank:'',oldBank:'BSI'});assert.equal(result.data.nomorRekening,'009999');assert.equal(result.data.namaBank,'');
});
test('Browser roles cannot execute the new RPC or access account data',async()=>{
  for(const r of ['anon','authenticated']){await role(r);await assert.rejects(save(),/permission denied/);await assert.rejects(db.query('select * from public.sla_rekening_pegawai'),/permission denied/);}
});
