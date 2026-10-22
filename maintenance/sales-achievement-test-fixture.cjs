const fs=require('node:fs'),crypto=require('node:crypto'),{workflowFixture}=require('./ticket-workflow-test-fixture.cjs');
async function salesAchievementFixture(){
 const f=await workflowFixture(),{db}=f;
 await f.clock('2026-10-22T16:00:00+08:00');
 await db.exec("alter table users add column account_active boolean default true;"+
 "alter table garansi add column no_transaksi text,add column sales text,add column omzet numeric;"+
 "create table penjualan(id_penjualan text primary key,no_transaksi text,waktu_lapor timestamptz,sales text,nominal_rp numeric,cabang text);"+
 "create table prospek(id_prospek text primary key,tanggal_input timestamptz,status_prospek text,sales_penanggung_jawab text,no_wa text,cabang text);"+
 "create table sla_sales_targets(cabang text,periode text,username text,omzet numeric,konversi numeric,followup_harian int,bukti_wajib boolean,updated_by uuid,primary key(cabang,periode,username));"+
 "create table sla_sales_followups(id uuid default gen_random_uuid(),id_prospek text,username text,waktu_kontak timestamptz,bukti_jenis text,bukti_path text,cabang text);"+
 "insert into users(username,auth_id,role,nama_asli,hak_akses_cabang,cabang,gaji_pokok) values"+
 "('juna','88888888-8888-4888-8888-888888888888','sales','Juna','Kendari','Kendari',1500000),"+
 "('ardan','99999999-9999-4999-8999-999999999999','sales','Ardan','Raha','Raha',1500000),"+
 "('free-sales','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales','Sales Mandiri','Kendari','Kendari',0);"+
 "insert into sla_sales_targets values('Kendari','2026-10','juna',100,60,1,false,'33333333-3333-4333-8333-333333333333'),"+
 "('Raha','2026-10','ardan',200,60,1,true,'33333333-3333-4333-8333-333333333333');");
 await db.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261022072438_november_raha_salary_credits.sql','utf8'));
 await db.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261022072839_november_sales_achievement.sql','utf8'));
 const seed=async(username='juna',period='2026-11')=>{
  const user=(await db.query('select * from users where username=$1',[username])).rows[0],b=user.cabang,name=user.nama_asli;
  for(let n=1;n<=5;n++)await db.query('insert into prospek values($1,$2,$3,$4,$5,$6)',[username+'-P'+n,period+'-02T10:00:00+08:00',n<=3?'Closing / Deal':'Tahap Penawaran',name,'628000000000'+n,b]);
  await db.query('insert into penjualan values($1,$2,$3,$4,$5,$6)',[username+'-SLS',username+'-INV',period+'-02T10:00:00+08:00',name+', Sales Lain',username==='ardan'?400:200,b]);
  const end=new Date(Date.UTC(+period.slice(0,4),+period.slice(5),0)).getUTCDate();
  for(let d=1;d<=end;d++){
   const day=period+'-'+String(d).padStart(2,'0');if(new Date(day+'T12:00:00Z').getUTCDay()===0)continue;
   await db.query('insert into sla_sales_followups(id_prospek,username,waktu_kontak,bukti_jenis,bukti_path,cabang) values($1,$2,$3,$4,$5,$6)',[username+'-P1',username,day+'T10:00:00+08:00','link','https://example.test/proof',b]);
   await db.query('insert into absensi values($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),day+'T08:00:00+08:00',name,'Masuk','Tepat Waktu',b]);
  }
 };
 return {...f,seedSales:seed};
}
module.exports={salesAchievementFixture};
