const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').replace(/\r\n/g,'\n');
function grab(name){const start=html.indexOf('        function '+name+'(');assert.ok(start>=0,name);const end=html.indexOf('\n        }',start);return html.slice(start,end+10);}
const c={cabangAktif:'Kendari',Date,Number,console,hitungTenggatJamKerja:(start,hours)=>new Date(start.getTime()+hours*3600000)};
vm.createContext(c);for(const name of ['parseSafeDate','perbaruiStatusSLAAktualTiket_','petakanTiketSupabase_'])vm.runInContext(grab(name),c);
const now=new Date('2026-10-07T17:30:00+08:00');
test('unassigned tickets cannot fail completion SLA based on an old creation deadline',()=>{
  const t=c.petakanTiketSupabase_({id_tiket:'WAIT',teknisi:'Belum Ditugaskan',status:'Menunggu',waktu_lapor:'2020-01-01',tenggat_waktu:'2020-01-02',status_sla:'TERLAMBAT'});
  assert.equal(t['Status SLA'],'BELUM DIMULAI');assert.equal(t['Tenggat Waktu'],null);
});
test('both direct fetch and realtime carry assignment metadata and never recreate creation-based deadlines',()=>{
  assert.equal((html.match(/"Waktu Penugasan": (row|r)\.waktu_penugasan/g)||[]).length,2);
  assert.ok(!html.includes('hitungTenggatJamKerja(dtLapor, parseFloat(t["Target SLA (Jam)"])'));
  assert.ok(!html.includes('hitungTenggatJamKerja(waktuLapor, parseFloat(record["Target SLA (Jam)"])'));
  const t=c.petakanTiketSupabase_({id_tiket:'NEW',teknisi:'Teknisi A',status:'On Progress',waktu_penugasan:'2026-10-07T17:00:00+08:00',target_sla_jam:'9',tenggat_waktu:'2026-10-09T10:30:00+08:00'});
  c.perbaruiStatusSLAAktualTiket_(t,now);assert.equal(t['Status SLA'],'AMAN');
});
test('missing deadlines use an available assignment time and cannot fall back to report creation',()=>{
  const t=c.petakanTiketSupabase_({teknisi:'Teknisi A',status:'On Progress',waktu_lapor:'2020-01-01',target_sla_jam:'9'});assert.equal(t['Tenggat Waktu'],undefined);
  t['Waktu Penugasan']='2026-10-07T17:00:00+08:00';c.perbaruiStatusSLAAktualTiket_(t,now);assert.equal(t['Tenggat Waktu'].toISOString(),'2026-10-07T18:00:00.000Z');
});
test('pending, outsourcing, cancellation and completed timing retain their established treatment',()=>{
  for(const [status,expected] of [['Pending','DIPENDING'],['Outsource','DIOPOR'],['Cancel','BATAL']])assert.equal(c.perbaruiStatusSLAAktualTiket_({Status:status,Teknisi:'Teknisi A','Tenggat Waktu':'2020-01-01'},now)['Status SLA'],expected);
  assert.equal(c.perbaruiStatusSLAAktualTiket_({Status:'Selesai',Teknisi:'Teknisi A','Tenggat Waktu':'2020-01-02','Waktu Selesai':'2020-01-01'},now)['Status SLA'],'TERPENUHI');
});
test('ordinary ticket edits no longer submit a deadline anchored to report creation; HTML scripts parse',()=>{
  const edit=html.slice(html.indexOf('if (modeEditTiket) {',html.indexOf('async function submitData')),html.indexOf('const hasil = await callSupabase(endpointFilterSupabase_',html.indexOf('async function submitData')));
  assert.ok(!edit.includes('tenggat_waktu:'));assert.ok(!edit.includes('waktuDasar'));
  for(const [,script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script);
});
