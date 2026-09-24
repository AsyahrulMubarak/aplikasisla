const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');process.env.TZ='Asia/Makassar';
const source=fs.readFileSync(path.join(__dirname,'../maintenance/prospect-reminder-scanner.gs'),'utf8');
function harness(options={}){
 const now=new Date('2026-09-16T09:00:00+08:00'),sent=[],writes=[],calls=[];
 const headers=['ID Prospek','Status Prospek','Tanggal Input','Nama Calon Customer','Kebutuhan','Sales Penanggung Jawab','Waktu Follow Up Terakhir','Riwayat Follow Up','Waktu Peringatan CRM Terakhir'];
 const row=['PRP-TEST',options.sheetStatus||'Tahap Penawaran',new Date(now.getTime()-(options.age??3)*86400000),'Customer Test','Laptop','Sales Test','','',options.warned?now:''];
 if(options.missingId) row[0]='';
 const sheet={getDataRange:()=>({getValues:()=>[headers,row]}),getRange:(r,c)=>({setValue:value=>writes.push({r,c,value})})};
 const cx=vm.createContext({Date,console:{error(){}},SpreadsheetApp:{flush(){}},Utilities:{sleep(){},formatDate:value=>new Date(value).toISOString().slice(0,10)},cabangOperasional_:()=>options.branch||'Kendari',
 kirimNotifWA:(phone,message)=>{sent.push({phone,message});return options.sendSuccess!==false;},
 callSupabaseServiceRole_:url=>{calls.push(url);if(options.error)throw Error('unavailable');return options.missing?[]:[{id_prospek:'PRP-TEST',status_prospek:options.liveStatus??'Tahap Penawaran',cabang:options.branch||'Kendari'}];}});
 vm.runInContext(source,cx);const result=cx.jalankanScannerProspek_({getSheetByName:()=>sheet},[['Nama Asli','No WA'],['Sales Test','628000000000']],now);
 return {sent,writes,calls,result};
}
for(const status of ['Batal',' BATAL ','Tanpa Keterangan','tanpa   keterangan','Closing','Closing / Deal','']){
 test('latest Supabase status suppresses old-sheet reminders: '+JSON.stringify(status),()=>{
  for(const age of [3,30]){const r=harness({liveStatus:status,age});assert.equal(r.sent.length,0);assert.equal(r.writes.length,0);}
 });
}
for(const status of ['On Progress','Proses Servis','Proses Service'])test('progress status remains active after legacy merge: '+status,()=>{
 const r=harness({liveStatus:status});assert.equal(r.sent.length,1);assert.equal(r.writes.length,1);
});
test('unverifiable, deleted, or unidentified prospect never sends a reminder or closes a stale row',()=>{
 for(const opts of [{error:true},{missing:true},{missingId:true}])for(const age of [3,30]){const r=harness({...opts,age});assert.equal(r.sent.length,0);assert.equal(r.writes.length,0);}
});
test('active prospect retains its three-day reminder and successful timestamp',()=>{
 const r=harness();assert.equal(r.sent.length,1);assert.match(r.sent[0].message,/WAKTUNYA FOLLOW UP CRM/);assert.equal(r.writes.length,1);assert.equal(r.writes[0].c,9);
});
test('existing final sheet status, off-day, and duplicate daily reminder remain suppressed',()=>{
 for(const opts of [{sheetStatus:'Batal'},{sheetStatus:'Closing / Deal'},{sheetStatus:'Tanpa Keterangan'},{age:2},{warned:true}])assert.equal(harness(opts).sent.length,0);
});
test('failed delivery is not marked successful and active 30-day expiry keeps existing behavior',()=>{
 assert.equal(harness({sendSuccess:false}).writes.length,0);
 const expired=harness({age:30});assert.equal(expired.sent.length,1);assert.equal(expired.writes[0].value,'Tanpa Keterangan');
});
test('fresh status queries stay scoped to each deployment branch',()=>{
 const kendari=harness(),raha=harness({branch:'Raha'});
 assert.match(kendari.calls[0],/or=\(cabang.eq.Kendari,cabang.is.null\)/);assert.match(raha.calls[0],/cabang=eq.Raha/);
 for(const r of [kendari,raha])assert.match(r.calls[0],/id_prospek=eq.PRP-TEST/);
});
