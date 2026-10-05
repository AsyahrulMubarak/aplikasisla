const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {test,before,after}=require('node:test');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{({PGlite}=require(path.resolve(__dirname,'../tmp/sales-claims-qa/node_modules/@electric-sql/pglite')));}
const db=new PGlite();let period;
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
async function setRole(role='service_role'){await db.exec('reset role; set role '+role);}
async function save(p={}){
  const a={actor:1,username:'worker-k',period,kind:'fee_marketing',id:id(100),old:'',filename:'bukti.pdf',size:100,remove:false,...p};
  const objectPath=p.objectPath??[a.username,a.period,a.kind,a.id+'.pdf'].join('/');
  return (await db.query('select public.sla_simpan_bukti_payroll($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result',
    [id(a.actor),a.username,a.period,a.kind,a.remove?null:a.id,a.old,a.remove?null:objectPath,a.remove?null:a.filename,a.remove?null:a.size,a.remove])).rows[0].result;
}
before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table public.users(username text primary key,auth_id uuid unique,nama_asli text,role text,hak_akses_cabang text,cabang text,gaji_pokok numeric);
    grant usage on schema public to anon,authenticated,service_role;grant select on public.users to service_role;
    insert into public.users values
    ('manager','${id(1)}','Manager','manager','Semua','Kendari',3000000),
    ('admin-k','${id(2)}','Admin K','admin','Kendari','Kendari',1500000),
    ('director','${id(3)}','Director','direktur','Semua','Kendari',0),
    ('admin-raha','${id(4)}','Admin Raha','admin_raha','Raha','Raha',1500000),
    ('legacy-admin-r','${id(5)}','Admin R','admin','Raha','Raha',1500000),
    ('worker-k','${id(6)}','Worker K','teknisi','Kendari','Kendari',1500000),
    ('worker-r','${id(7)}','Worker R','sales','Raha','Raha',1500000),
    ('no-salary','${id(8)}','No Salary','manager','Semua','Kendari',0),
    ('null-role','${id(9)}','Null Role',null,'Kendari','Kendari',1500000),
    ('legacy-all-r','${id(10)}','Legacy All R','admin','Semua','Raha',1500000);`);
  // Start at the former five-day limit, then exercise the actual upgrade twice.
  await db.exec(fs.readFileSync(path.join(__dirname,'payroll-evidence.sql'),'utf8').replace('1 month 7 days','1 month 5 days').replace('masa tenggang 7 hari','masa tenggang 5 hari'));
  const upgrade=fs.readFileSync(path.join(__dirname,'payroll-grace-seven-days.sql'),'utf8');
  await db.exec(upgrade);await db.exec(upgrade);
  period=(await db.query("select to_char(now() at time zone 'Asia/Makassar','YYYY-MM') as period")).rows[0].period;
  await setRole();
});
after(async()=>{await db.close();});
test('SQL authorizes exactly the three management roles for both branches',async()=>{
  for(const actor of [1,2,3])for(const username of ['worker-k','worker-r']){
    await setRole();await db.exec('delete from public.sla_bukti_payroll');
    const first=await save({actor,username});assert.equal(first.status,'sukses');
    const replaced=await save({actor,username,old:first.data.id,id:id(101)});assert.equal(replaced.objectPathLama,first.data.object_path);
    const removed=await save({actor,username,old:replaced.data.id,remove:true});assert.equal(removed.idTerhapus,id(101));
  }
});
test('SQL denies employees, Admin Raha, legacy Admin Raha, zero salary management and null roles',async()=>{
  for(const actor of [4,5,6,7,8,9,10])for(const remove of [false,true]) await assert.rejects(save({actor,remove}),/hanya dapat diubah/);
});
test('SQL compare protects concurrent replacement/deletion and separates employees, months and kinds',async()=>{
  await db.exec('delete from public.sla_bukti_payroll');const first=await save();
  await assert.rejects(save({old:'',id:id(101)}),/diubah pengguna lain/);
  await save({kind:'kasbon',id:id(102)});await save({username:'worker-r',id:id(103)});
  const next=(await db.query("select to_char(($1 || '-01')::date + interval '1 month','YYYY-MM') as period",[period])).rows[0].period;
  await save({period:next,id:id(104)});
  assert.equal((await db.query('select count(*)::integer as n from public.sla_bukti_payroll')).rows[0].n,4);
  await save({old:first.data.id,id:id(101)});
  await assert.rejects(save({old:first.data.id,remove:true}),/diubah pengguna lain/);
  assert.equal((await db.query('select id from public.sla_bukti_payroll where username=$1 and periode=$2 and jenis=$3',['worker-k',period,'fee_marketing'])).rows[0].id,id(101));
});
test('SQL blocks locked months, invalid periods, bad paths, names, sizes and nonexistent users',async()=>{
  for(const p of [{period:'2000-01'},{period:'2026-13'},{period:'bad'},{kind:'other'},{size:0},{size:5242881},{filename:'bad.jpg'},
    {objectPath:'other-worker/anything.pdf'},{username:'missing'},{old:null}])await assert.rejects(save(p));
});
test('Anonymous and authenticated roles cannot read, mutate or execute the evidence RPC',async()=>{
  for(const role of ['anon','authenticated']){
    await setRole(role);await assert.rejects(db.query('select * from public.sla_bukti_payroll'),/permission denied/);
    await assert.rejects(save(),/permission denied/);
    await assert.rejects(db.exec('delete from public.sla_bukti_payroll'),/permission denied/);
  }await setRole();
});
test('Bucket is private and restricted to 5 MB PDFs; metadata RLS is enabled',async()=>{
  await db.exec('reset role');
  const bucket=(await db.query("select * from storage.buckets where id='sla-payroll-private'")).rows[0];
  assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),5242880);assert.deepEqual(bucket.allowed_mime_types,['application/pdf']);
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.sla_bukti_payroll'::regclass")).rows[0].relrowsecurity,true);
});

test('Upgraded PostgreSQL guard permits writes through day 7 WITA and blocks upload/replacement/deletion at day 8',async()=>{
  await db.exec('reset role');
  const definition=(await db.query("select pg_get_functiondef('public.sla_simpan_bukti_payroll(uuid,text,text,text,uuid,text,text,text,integer,boolean)'::regprocedure) as definition")).rows[0].definition;
  // Inject only the clock in the installed function, keeping its real authorization and write logic.
  assert.equal(definition.split("(pg_catalog.now() at time zone 'Asia/Makassar')::date").length,2);
  await db.exec(definition.replace("(pg_catalog.now() at time zone 'Asia/Makassar')::date","(current_setting('qa.payroll_now')::timestamptz at time zone 'Asia/Makassar')::date"));
  await setRole();
  for(const [selected,last,locked] of [
    ['2026-09','2026-10-07T15:59:59.999Z','2026-10-07T16:00:00Z'],
    ['2026-12','2027-01-07T23:59:59+08:00','2027-01-08T00:00:00+08:00'],
    ['2028-02','2028-03-07T23:59:59+08:00','2028-03-08T00:00:00+08:00']
  ]){
    await db.exec('delete from public.sla_bukti_payroll');
    await db.query("select set_config('qa.payroll_now',$1,false)",[last]);
    const saved=await save({period:selected});
    const replacement=await save({period:selected,old:saved.data.id,id:id(101)});
    await save({period:selected,old:replacement.data.id,remove:true});
    const retained=await save({period:selected});
    await db.query("select set_config('qa.payroll_now',$1,false)",[locked]);
    for(const patch of [{old:retained.data.id,id:id(101)},{old:retained.data.id,remove:true},{kind:'kasbon'}])
      await assert.rejects(save({period:selected,...patch}),/masa tenggang 7 hari/);
    assert.equal((await db.query('select count(*)::integer as n from public.sla_bukti_payroll')).rows[0].n,1);
  }
});
