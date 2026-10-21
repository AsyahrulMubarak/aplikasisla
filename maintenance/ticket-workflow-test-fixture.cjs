const fs=require('node:fs'),crypto=require('node:crypto'),{performanceFixture}=require('./performance-credit-test-fixture.cjs');
const sql=['20261021145126_ticket_workflow_context.sql','20261021145129_ticket_workflow_mutations.sql','20261021145131_ticket_workflow_performance_source.sql'].map(n=>fs.readFileSync(__dirname+'/../supabase/migrations/'+n,'utf8')).join('\n');
async function workflowFixture(){const f=await performanceFixture(),{db}=f;
 await db.exec(`alter table tiket add column if not exists target_sla_jam text,add column if not exists target_sla_respon_jam numeric,add column if not exists tenggat_pengganti timestamptz,
 add column if not exists status_sla_respon text,add column if not exists status_peringatan text,add column if not exists sumber_waktu_penugasan text,add column if not exists poin_performa numeric,
 add column if not exists klien_lokasi text,add column if not exists sales text,add column if not exists nilai_penjualan numeric,add column if not exists no_wa_klien text,add column if not exists admin_sla text,add column if not exists kritik_saran text;
 update tiket set target_sla_jam='8',target_sla_respon_jam=1,klien_lokasi='Klien uji',keterangan='Riwayat awal';`);
 await db.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261007093221_sla_pengerjaan_sejak_penugasan.sql','utf8'));
 await db.exec(fs.readFileSync(__dirname+'/sla-pending-pause.sql','utf8'));
 await db.exec(fs.readFileSync(__dirname+'/technician-replacement-rating.sql','utf8'));
 await db.exec(sql);
 await f.clock(new Date().toISOString());
 const row=async(id='TKT-1')=>(await db.query('select * from tiket where id_tiket=$1',[id])).rows[0];
 const pending={category:'parts_vendor',reason:'Menunggu pengiriman komponen dari vendor',evidence:'Nomor permintaan komponen PO-001',followUpAt:new Date(Date.now()+86400000).toISOString()};
 const replacement={category:'rotation_schedule',reason:'Penyesuaian jadwal tim cabang',handover:'Diagnosis selesai, perlu mengganti komponen dan uji akhir.',evidence:'Catatan serah terima BA-001',resetSla:true};
 const act=async(action='pending',context=pending,patch={status:'Pending'},actor='admin',id='TKT-1',revision,requestId=crypto.randomUUID())=>{
  const res=(await db.query('select sla_tiket_workflow($1,$2,$3,$4,$5,$6,$7) result',[f.ids[actor],id,action,revision??(await row(id)).versi_workflow,requestId,JSON.stringify(patch),JSON.stringify(context)])).rows[0].result;return res;
 };
 return {...f,row,act,pending,replacement,workflowSql:sql};}
module.exports={workflowFixture,sql};
