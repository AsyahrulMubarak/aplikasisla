const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const extract=name=>html.match(new RegExp('^([ \\t]*)(?:async )?function '+name+'\\([^]*?^\\1\\}','m'))[0];
const ready='2026-10-01T02:00:00.000Z';
function harness(){
 const calls=[],elements={loading:{style:{}},'garansi-container':{innerHTML:''}};
 const c=vm.createContext({Date,Number,String,Math,Intl,encodeURIComponent,console,globalTickets:[{'ID Tiket':'TKT-1',Status:'Selesai','Waktu Selesai':ready,'No WA Klien':'081234567890','Klien & Lokasi':'Pelanggan Uji',Cabang:'Raha'}],globalPenjualan:[],globalGaransi:[],
 document:{getElementById:id=>elements[id]||null},dataSesuaiCabangAktif_:g=>g.Cabang==='Raha',roleAdalahAdminOperasional_:()=>true,rolePengguna:()=> 'admin_raha',
 formatWaktu:x=>x,amanTeks_:x=>x,parseSafeDate:x=>new Date(x),tambahkanHtmlAman_:(el,x)=>el.innerHTML+=x,tetapkanHtmlAman_:(el,x)=>el.innerHTML=x,
 tampilkanModalInap:x=>calls.push(x),showToast:(...x)=>calls.push(x),showConfirm:async x=>{calls.push(x);return true;},tanggalIsoSupabase_:x=>new Date(x).toISOString(),
 endpointFilterSupabase_:()=> 'garansi',callSupabase:async(endpoint,method,body)=>{calls.push(body);return [body];},pastikanHasilMutasiSupabase_:()=>{},ambilSemuaData:async()=>{}});
 for(const f of ['hariMengendapWita_','biayaPenitipan_','penitipanGaransi_','peringatanPenitipanGaransi_','statusGaransiEfektif_','scanDendaInap','renderGaransi','aktifkanGaransi'])vm.runInContext(extract(f),c);
 return {c,calls,elements};
}
const card={'ID Garansi':'GRS-1','Referensi (Tiket/Nota)':'TKT-1',Status:'Masa Tunggu','Durasi (Hari)':30,'Barang / Jasa':'Laptop',Cabang:'Raha'};
test('seven full days are free; the eighth storage day costs Rp 1,000 and forfeits entitlement',()=>{
 const {c}=harness();
 for(const [offset,fee,expired] of [[5*86400000,0,false],[7*86400000,0,false],[7*86400000+1,0,false],[8*86400000,1000,true],[9*86400000,2000,true],[28*86400000,21000,true],[40*86400000,23000,true]]){
  const s=c.penitipanGaransi_(card,new Date(new Date(ready).getTime()+offset));assert.equal(s.denda,fee);assert.equal(s.hangus,expired);assert.equal(s.menunggu,true);
 }
 assert.equal(c.penitipanGaransi_({...card,'Referensi (Tiket/Nota)':'UNKNOWN'}).denda,0);
});
test('pickup freezes the fee and early pickup does not forfeit warranty later',()=>{
 const {c}=harness();
 const timely={...card,Status:'Aktif','Waktu Siap Diambil':ready,'Waktu Diambil':'2026-10-06T02:00:00Z'};
 assert.equal(c.penitipanGaransi_(timely,new Date('2026-12-01')).hangus,false);
 const late={...timely,'Waktu Diambil':'2026-10-09T02:00:00Z','Garansi Hangus Pada':'2026-10-08T02:00:00Z','Biaya Penitipan':1000};
 assert.equal(c.penitipanGaransi_(late,new Date('2026-12-01')).denda,1000);assert.equal(c.penitipanGaransi_(late).hangus,true);
});
test('waiting cards show forfeiture separately; pickup records forfeiture without a claim action',async()=>{
 const {c,calls,elements}=harness();c.globalGaransi=[{...card,'Garansi Hangus Pada':'2026-10-08T02:00:00Z'}];
 c.renderGaransi();assert.match(elements['garansi-container'].innerHTML,/>Masa Tunggu</);assert.match(elements['garansi-container'].innerHTML,/Kerusakan yang sama/);assert.doesNotMatch(elements['garansi-container'].innerHTML,/Klaim Garansi &/);
 await c.aktifkanGaransi('GRS-1');assert.match(calls[0],/tidak akan dihitung ulang/);assert.equal(calls.find(x=>x.status).status,'Hangus (Lewat 7 Hari)');
});
test('day-five, day-28 and day-30 scanner messages keep their milestones and isolate branches',()=>{
 const {c,calls}=harness();const now=new Date();
 for(const [days,pattern] of [[5,/hari ke-8/],[28,/sudah mengendap 28 hari/],[31,/tidak lagi menjadi tanggung jawab penyimpanan Alfacom/]]){
  c.globalGaransi=[{...card,'Waktu Siap Diambil':new Date(now-days*86400000).toISOString()},{...card,Cabang:'Kendari','ID Garansi':'OTHER'}];
  c.scanDendaInap();const text=calls.at(-1);const message=text.match(/bukaWAPenitipan\('[^']+', '[^']+', '([^']+)'/)[1];assert.match(decodeURIComponent(message),pattern);assert.match(text,/1 Orang/);
 }
});
