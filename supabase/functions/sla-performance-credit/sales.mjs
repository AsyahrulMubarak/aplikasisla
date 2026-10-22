export const SALES_POLICY=Object.freeze({version:1,kind:'sales',start:'2026-11',mode:'all_targets'});
const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
const key=v=>['','-','n/a','na','null','undefined'].includes(norm(v))?'':norm(v).toUpperCase();
const names=v=>[...new Set(String(v||'').split(',').map(norm).filter(n=>n&&n!=='-'))];
const date=v=>v?new Date(v).toLocaleDateString('sv-SE',{timeZone:'Asia/Makassar'}):'';
const round=v=>Math.round((v+Number.EPSILON)*10000)/10000;
const cap=v=>Math.max(0,Math.min(100,v));
const ratio=(n,d)=>d>0?cap(n/d*100):null;
export function calculateSales(source){
 const {period,profile}=source,person=norm(profile.name),target=source.salesTarget;
 const inMonth=v=>date(v).startsWith(period),transactions=[],seen=new Set(),reasons=[];
 const sales=source.sales||[],warranties=source.salesWarranties||[],tickets=source.salesTickets||[];
 const saleIds=new Set(sales.map(s=>key(s.id_penjualan)).filter(Boolean)),saleRefs=new Set(sales.map(s=>key(s.no_transaksi)).filter(Boolean));
 const add=(id,ref,amount,owners,kind)=>{
  if((id&&seen.has(id))||(ref&&seen.has('TRX:'+ref)))return;
  if(id)seen.add(id);if(ref)seen.add('TRX:'+ref);
  const members=names(owners),value=Number(amount);
  if(members.includes(person)&&Number.isFinite(value))transactions.push({id:id||ref,source:kind,amount:value/members.length});
 };
 for(const s of sales)if(inMonth(s.waktu_lapor))add('SLS:'+key(s.id_penjualan),key(s.no_transaksi),s.nominal_rp,s.sales,'SLS');
 for(const g of warranties){
  const ref=key(g.referensi_tiket_nota);
  if(ref.startsWith('SLS')||saleIds.has(ref)||saleRefs.has(ref))continue;
  const t=tickets.find(t=>key(t.id_tiket)===ref),at=g.tanggal_mulai||t?.tanggal_lunas||t?.waktu_selesai||t?.waktu_lapor;
  if(!inMonth(at))continue;
  add(ref.startsWith('TKT')?'TKT:'+ref:null,key(t?.no_transaksi)||key(g.no_transaksi),g.omzet,g.sales||t?.sales,ref.startsWith('TKT')?'TKT':'MANUAL');
 }
 const revenue=transactions.reduce((n,t)=>n+t.amount,0);
 const prospects=(source.salesProspects||[]).filter(p=>inMonth(p.tanggal_input)&&names(p.sales_penanggung_jawab).includes(person));
 const deals=prospects.filter(p=>/closing|deal/i.test(p.status_prospek||'')).length,conversion=prospects.length?deals/prospects.length*100:null;
 const [year,month]=period.split('-').map(Number),days=new Date(Date.UTC(year,month,0)).getUTCDate(),workdays=[];
 const holidays=new Set((source.salesHolidays||[]).flatMap(h=>String(h.tanggal_libur_tambahan||'').split(',').map(s=>Number(s.trim()))));
 for(let d=1;d<=days;d++){
  const day=period+'-'+String(d).padStart(2,'0');
  if(new Date(day+'T12:00:00Z').getUTCDay()===0||holidays.has(d))continue;
  const leave=(source.salesLeaves||[]).some(l=>l.status==='Disetujui'&&l.tanggal_mulai<=day&&(!l.tanggal_selesai||l.tanggal_selesai>=day)&&(!l.kembali_bekerja_pada||date(l.kembali_bekerja_pada)>day));
  if(!leave)workdays.push(day);
 }
 const perDay=new Map(workdays.map(d=>[d,new Set()]));
 for(const f of source.salesFollowups||[]){
  if(f.username!==profile.username||!perDay.has(date(f.waktu_kontak)))continue;
  if(target?.bukti_wajib!==false&&(f.bukti_jenis==='none'||!f.bukti_path))continue;
  const p=(source.salesProspects||[]).find(p=>p.id_prospek===f.id_prospek);
  if(!p||!names(p.sales_penanggung_jawab).includes(person))continue;
  let phone=String(p.no_wa||'').replace(/\D/g,'');if(phone.startsWith('0'))phone='62'+phone.slice(1);if(phone.startsWith('8'))phone='62'+phone;
  const customer=phone?'WA:'+phone:'P:'+p.id_prospek;
  perDay.get(date(f.waktu_kontak)).add(customer);
 }
 const daily=Number(target?.followup_harian)||0,required=daily*workdays.length;
 const counted=[...perDay.values()].reduce((n,s)=>n+Math.min(daily,s.size),0);
 const values={omzet:ratio(revenue,Number(target?.omzet)),konversi:conversion===null?null:ratio(conversion,Number(target?.konversi)),tindakLanjut:ratio(counted,required)};
 if(!target)reasons.push('Target sales untuk cabang dan bulan ini belum disimpan pada panel Target & tindak lanjut sales.');
 if(!prospects.length)reasons.push('Belum ada prospek periode ini untuk menilai konversi.');
 if(!workdays.length)reasons.push('Belum ada hari kerja yang dapat dinilai.');
 if(source.duplicateName)reasons.push('Nama sales tidak unik dalam cabang; cocokkan profil sebelum pengesahan.');
 const complete=!!target&&Number(target.omzet)>0&&Number(target.konversi)>0&&daily>0&&!!prospects.length&&!!workdays.length&&!source.duplicateName;
 if(target&&revenue<Number(target.omzet))reasons.push('Omzet belum mencapai minimum yang ditetapkan.');
 if(target&&conversion!==null&&conversion<Number(target.konversi))reasons.push('Konversi belum mencapai minimum yang ditetapkan.');
 if(target&&counted<required)reasons.push('Tindak lanjut belum memenuhi seluruh minimum per hari kerja.');
 const pass=complete&&Object.values(values).every(v=>v!==null&&v>=100);
 const score=Object.values(values).some(v=>v===null)?null:Math.min(...Object.values(values));
 return {policy:SALES_POLICY,period,days:workdays.length,effectiveDays:workdays.length,target:target?.omzet||0,targetReason:'',
  achieved:round(revenue),values:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,v===null?null:round(v)])),score:score===null?null:round(score),
  complete,pass,credit:pass?1:0,reasons,cases:[],points:[],unfinished:[],workTickets:[],responseTickets:[],
  sales:{target:target?{omzet:Number(target.omzet),konversi:Number(target.konversi),followup_harian:daily,bukti_wajib:target.bukti_wajib}:null,
   revenue:round(revenue),prospects:prospects.length,deals,conversion:conversion===null?null:round(conversion),requiredFollowups:required,countedFollowups:counted,
   daily:workdays.map(day=>({day,count:perDay.get(day).size,minimum:daily,met:perDay.get(day).size>=daily})),transactions}};
}
