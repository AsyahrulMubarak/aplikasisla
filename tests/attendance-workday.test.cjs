const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(__dirname+'/../supabase/functions/sla-payroll-attendance/index.ts','utf8');
const record=(id,at,type)=>({id_absen:id,waktu_absen:at,nama_pegawai:'Mubarak',role:'teknisi',tipe_absen:type,cabang:'Kendari',bukti_foto:'-',keterangan:''});
function harness(rows,now='2026-10-02T08:00:00+08:00'){
 const calls=[];const FixedDate=class extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return new Date(now).getTime();}};
 const c=vm.createContext({console,Date:FixedDate,Intl,Response,Request,AbortSignal,crypto,URLSearchParams,
 Deno:{env:{get:n=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-server'})[n]},serve(){}},
 fetch:async(url,o={})=>{calls.push({url,...o});
  if(url.includes('/absensi?'))return Response.json(rows);
  if(url.includes('/pengajuan_cuti?'))return Response.json([]);
  if(url.includes('/rpc/sla_insert_absensi_batch'))return Response.json(1);
  throw Error('Unexpected call '+url);
 }});vm.runInContext(source,c);return {c,calls};
}
test('New-day attendance ignores the preceding overnight exit when constructing the lock request',async()=>{
 const {c,calls}=harness([record('overnight','2026-10-02T02:49:27+08:00','Keluar')]);
 await c.recordAttendance({tipeAbsen:'Masuk',latitude:-3.9641006831731826,longitude:122.54316001476751},{name:'Mubarak',role:'teknisi',branch:'Kendari',salary:1500000});
 const body=JSON.parse(calls.find(x=>x.url.includes('sla_insert_absensi_batch')).body);
 assert.equal(body.p_work_day,'2026-10-02');assert.equal(body.p_expected_last,'');assert.equal(body.p_rows[0].tipe_absen,'Masuk');
});
test('Today’s review excludes yesterday’s overnight exit and retains today’s attendance',async()=>{
 const {c}=harness([record('overnight','2026-10-02T02:49:27+08:00','Keluar'),record('today','2026-10-02T08:00:00+08:00','Masuk')]);
 const r=await c.getReview({name:'Mubarak',role:'teknisi',branch:'Kendari'});
 assert.equal(r.data.length,1);assert.equal(r.data[0].masuk1,'08:00');assert.equal(r.data[0].keluar1,'-');assert.equal(r.data[0].keluar2,'-');
});
test('Review includes the work day’s next-morning exit in the final exit slot',async()=>{
 const {c,calls}=harness([record('today','2026-10-02T08:00:00+08:00','Masuk'),record('next-exit','2026-10-03T02:49:27+08:00','Keluar')]);
 const r=await c.getReview({name:'Mubarak',role:'teknisi',branch:'Kendari'});
 assert.equal(r.data[0].keluar2,'02:49');assert.equal(r.data[0].keluar1,'-');
 assert.ok(decodeURIComponent(calls[0].url).includes('2026-10-03T06:00:00+08:00'));
});
