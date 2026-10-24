const fs=require('node:fs'),{fixture,ids}=require('./ticket-assessment-test-fixture.cjs');
const migration=['20261021072527_performance_credit_schema.sql','20261021072528_performance_credit_sources.sql','20261021072529_performance_credit_review.sql','20261021072531_performance_credit_evaluator.sql','20261021073439_performance_credit_approval.sql','20261021073440_performance_credit_summary.sql','20261021073441_performance_credit_salary_notice.sql'].map(name=>fs.readFileSync(__dirname+'/../supabase/migrations/'+name,'utf8')).join('\n');
async function performanceFixture(){
 const f=await fixture(),{db}=f;
 await db.exec(`alter table users add column no_wa text;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 alter table tiket add column waktu_lapor timestamptz,add column waktu_penugasan timestamptz,add column tenggat_waktu timestamptz,add column tenggat_respon timestamptz,add column waktu_respon timestamptz,add column penalti_teknisi_lama text,add column keterangan text,add column garansi_asal text,add column referensi_tiket_asal text,add column sla_jeda_sisa_detik numeric;
 create table garansi(id_garansi text primary key,referensi_tiket_nota text,tanggal_mulai timestamptz,tanggal_habis timestamptz,item_garansi jsonb,riwayat_klaim_item jsonb,cabang text);
 create table absensi(id_absen text,waktu_absen timestamptz,nama_pegawai text,tipe_absen text,status_disiplin text,cabang text);
 create table payroll_bulanan(periode text,nama_pegawai text,tanggal_libur_tambahan text,cabang text);
 create table pengajuan_cuti(id_pengajuan text,nama_pegawai text,status text,jenis text,tanggal_mulai date,tanggal_selesai date,cabang text,kembali_bekerja_pada timestamptz);`);
 await db.exec(fs.readFileSync(__dirname+'/salary-increments.sql','utf8'));
 const clock=async(value)=>db.exec(`create or replace function sla_gaji_sekarang() returns timestamptz language sql stable as $$ select '${value}'::timestamptz $$`);
 await clock('2026-10-01T08:00:00+08:00');
 await db.exec(fs.readFileSync(__dirname+'/salary-increments-kendari-only.sql','utf8'));
 await db.exec(fs.readFileSync(__dirname+'/salary-increments-positive-only.sql','utf8'));
 await db.exec("update sla_gaji_program set mulai_periode='2026-10';");
 await db.exec(migration);
 await db.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261022010451_achievement_exclude_warranty_cancel.sql','utf8'));
 await db.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261022011237_performance_achievement_policy_v2.sql','utf8'));
 await db.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261022013050_achievement_exclude_outsource.sql','utf8'));
 await db.exec(fs.readFileSync(__dirname+'/../supabase/migrations/'+fs.readdirSync(__dirname+'/../supabase/migrations').find(name=>name.endsWith('_achievement_composite_policy_v3.sql')),'utf8'));
 const raw=async(username='tech',period='2026-11')=>(await db.query('select sla_performa_sumber($1,$2) as r',[username,period])).rows[0].r;
 const context=async(actor='admin',username='tech',period='2026-11')=>(await db.query('select sla_performa_akses($1,$2,$3) as r',[ids[actor],username,period])).rows[0].r;
 const approve=async(input={},username='tech',period='2026-11',actor='admin',revision=0,hash)=>{
  const {calculate}=await import('../supabase/functions/sla-performance-credit/engine.mjs'),source=await raw(username,period),result=calculate(source.data,input);
  return (await db.query('select sla_performa_sahkan($1,$2,$3,$4,$5,$6,$7) as r',[ids[actor],username,period,revision,hash||source.hash,JSON.stringify(input),JSON.stringify(result)])).rows[0].r;
 };
 const seed=async(period='2026-11',options={})=>{
  for(let n=1;n<=3;n++){
   const id='TKT-'+period+'-'+n,a={grade:{value:'S',points:16,status:'approved'},achievement:{grade:'S',points:16,completedAt:period+'-05T10:00:00+08:00',members:[{username:'tech',name:'Teknisi A',share:50},{username:'tech2',name:'Teknisi B',share:50}]}};
   await db.query(`insert into tiket(id_tiket,teknisi,cabang,status,waktu_lapor,waktu_penugasan,waktu_selesai,tenggat_waktu,tenggat_respon,waktu_respon,penilaian_teknisi)
    values($1,'Teknisi A, Teknisi B','Kendari','Selesai',$2,$2,$3,$4,$5,$2,$6)`,[id,period+'-02T09:00:00+08:00',period+'-05T10:00:00+08:00',period+'-06T17:00:00+08:00',period+'-02T12:00:00+08:00',JSON.stringify(a)]);
   // The source warranty exists only in the scored month, to avoid intentionally changing later samples.
   await db.query('insert into garansi values($1,$2,$3,$4,\'[]\',\'[]\',\'Kendari\')',['GRS-'+period+'-'+n,id,period+'-05T10:00:00+08:00',period+'-20T10:00:00+08:00']);
  }
  const [year,month]=period.split('-').map(Number),days=new Date(Date.UTC(year,month,0)).getUTCDate();
  for(let d=1;d<=days;d++){const date=period+'-'+String(d).padStart(2,'0');if(new Date(date+'T12:00:00Z').getUTCDay()===0)continue;await db.query("insert into absensi values($1,$2,'Teknisi A','Masuk','Tepat Waktu','Kendari')",[date,date+'T08:00:00+08:00']);}
 };
 return {...f,clock,raw,context,approve,seed,migration};
}
module.exports={performanceFixture,migration};
