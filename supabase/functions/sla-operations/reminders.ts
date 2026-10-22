// Pure planning rules shared by the scheduler and its regression tests.
export const norm = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
export const branchOf = row => norm(row.cabang) === 'raha' ? 'Raha' : 'Kendari';
export function phone(value) {
 const n=String(value||'').replace(/[\s().+-]/g,'').replace(/^0062/,'62').replace(/^0/,'62').replace(/^8/,'628');
 return /^62\d{8,13}$/.test(n)?n:'';
}
export const day = value => new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,10);
const at=(d,h)=>Date.parse(d+'T00:00:00+08:00')+h*3600000;
export function workHours(start,end,branch) {
 const a=Date.parse(start),b=Date.parse(end);if(!Number.isFinite(a)||!Number.isFinite(b)||a>=b)return 0;
 let total=0;
 for(let d=day(a),count=0;at(d,0)<b&&count<36600;d=day(at(d,36)),count++){
  if(new Date(d+'T12:00:00+08:00').getUTCDay()===0)continue;
  for(const [from,to] of [[8,12],[13.5,15],[16,branch==='Raha'?20:17]])total+=Math.max(0,Math.min(b,at(d,to))-Math.max(a,at(d,from)));
 }
 return total/3600000;
}
const names = text => [...new Set(String(text||'').split(/[,;\n]/).map(norm).filter(Boolean))];
const scope=(u,b)=>norm(u.hak_akses_cabang||u.cabang)==='semua'||branchOf({cabang:u.hak_akses_cabang||u.cabang})===b;
function namedRecipients(users,text){
 const wanted=names(text);
 return users.filter(u=>u.account_active!==false&&wanted.includes(norm(u.nama_asli||u.username)));
}
function managers(users,b){return users.filter(u=>u.account_active!==false&&['manager','direktur'].includes(norm(u.role))&&scope(u,b));}
function admins(users,b){return users.filter(u=>u.account_active!==false&&scope(u,b)&&(norm(u.role)===(b==='Raha'?'admin_raha':'admin')||(norm(u.role)==='admin'&&norm(u.hak_akses_cabang)==='semua')));}
export function messages(users,text){return [...new Set(users.map(u=>phone(u.no_wa)).filter(Boolean))].map(p=>({phone:p,message:text}));}
const pick=(r,keys)=>Object.fromEntries(keys.map(k=>[k,r[k]??null]));
const guard=(table,id,row,keys)=>({table,id,expected:pick(row,keys)});
const markerExists=(row,m)=>String(row.status_peringatan||'').includes(m);
const ticketText=(t,title,detail)=>`${title}\n\nCabang ${branchOf(t)}\n🎫 *ID Tiket:* ${t.id_tiket}\n🏢 *Klien:* ${t.klien_lokasi||'-'}\n🛠️ *Pekerjaan:* ${t.jenis_pekerjaan||'-'}\n\n${detail}\n🌐 https://aplikasisla.vercel.app/`;
export function ticketReminders(tickets,users,warranties,now=new Date()){
 const events=[],h=Number(new Date(now.getTime()+8*3600000).getUTCHours()),sunday=new Date(now.getTime()+8*3600000).getUTCDay()===0;
 if(sunday)return events;
 for(const t of tickets){
  const b=branchOf(t),status=norm(t.status),close=b==='Raha'?20:17;
  if(h<8||h>=close||['cancel','batal','pending','outsource'].includes(status))continue;
  const g=guard('tiket',t.id_tiket,t,['status','teknisi','waktu_lapor','waktu_penugasan','waktu_selesai','waktu_respon','tenggat_respon','tenggat_waktu','tenggat_pengganti']);
  const add=(marker,recipients,text,extra={})=>{
   if(markerExists(t,marker))return;
   const target=messages(recipients,text);if(!target.length)return;
   // Deadline/assignment changes start a new reminder cycle; retries reuse the same key.
   const cycle=[t.waktu_penugasan||t.waktu_lapor,t.tenggat_respon,t.tenggat_pengganti||t.tenggat_waktu].join('|');
   events.push({key:`ticket:${b}:${t.id_tiket}:${marker}:${cycle}`,branch:b,kind:'ticket_reminder',guard:{...g,...extra},marker,messages:target});
  };
  if(status==='selesai'){
   if(!warranties.some(w=>w.referensi_tiket_nota===t.id_tiket&&branchOf(w)===b)&&workHours(t.waktu_selesai,now,b)>=9)
    add('ADMIN_NOTA_FAILED',[...admins(users,b),...managers(users,b)],ticketText(t,'🚨 *SLA ADMIN GAGAL (BUAT NOTA)*','Tiket selesai sudah lebih dari 9 jam kerja belum dibuatkan nota dan garansi. Mohon segera diproses.'),{noWarranty:true});
   continue;
  }
  if(!norm(t.teknisi)||['-','belum ditugaskan'].includes(norm(t.teknisi))){
   if(workHours(t.waktu_lapor,now,b)>=27){
    add('ADMIN_SLA_FAILED',admins(users,b),ticketText(t,'⚠️ *SLA ADMIN GAGAL (BUTUH TEKNISI)*','Tiket sudah menunggu penugasan lebih dari 3 hari kerja. Mohon segera tugaskan teknisi.'));
    add('MANAJEMEN_MENUNGGU_3H',managers(users,b),ticketText(t,'⚠️ *ESKALASI TIKET MENUNGGU TEKNISI*','Tiket sudah menunggu penugasan lebih dari 3 hari kerja. Mohon evaluasi dan arahkan Admin untuk menetapkan teknisi.'));
   }
   continue;
  }
  const tech=namedRecipients(users,t.teknisi);
  if(!t.waktu_respon&&t.tenggat_respon&&Number.isFinite(Date.parse(t.tenggat_respon))&&workHours(now,t.tenggat_respon,b)<=0.25)
   add('RESPON_WARNED',tech,ticketText(t,'🚨 *DARURAT: SLA RESPON*','Waktu respons pertama tersisa paling lama 15 menit kerja atau telah lewat. Segera tekan On Progress.'));
  const deadline=t.tenggat_pengganti||t.tenggat_waktu;
  if(deadline&&Number.isFinite(Date.parse(deadline))&&workHours(now,deadline,b)<=2)
   add('PENGERJAAN_WARNED',tech,ticketText(t,'⏰ *PERINGATAN SLA PENGERJAAN*','Waktu pengerjaan tersisa paling lama 2 jam kerja atau telah lewat. Segera selesaikan atau ajukan Pending beserta alasannya.'));
 }
 return events;
}
export function stoppedProspect(status){return !norm(status)||/closing|batal|tanpa keterangan|on progress|proses servis|proses service|pending/.test(norm(status));}
export function lastFollowUp(p){
 let date=p.waktu_follow_up_terakhir||p.tanggal_input;
 const matches=[...String(p.riwayat_follow_up||'').matchAll(/\[(\d{2})\/(\d{2})\/(\d{4})/g)];
 if(matches.length){const [,d,m,y]=matches.at(-1),candidate=`${y}-${m}-${d}`;const parsed=Date.parse(candidate+'T00:00:00+08:00');if(Number.isFinite(parsed)&&day(parsed)===candidate)date=new Date(parsed).toISOString();}
 return date;
}
export function prospectReminders(prospects,users,now=new Date()){
 const events=[];
 for(const p of prospects){
  if(stoppedProspect(p.status_prospek))continue;
  const last=lastFollowUp(p);if(!Number.isFinite(Date.parse(last)))continue;
  const age=Math.round((Date.parse(day(now))-Date.parse(day(last)))/86400000),b=branchOf(p);
  const g=guard('prospek',p.id_prospek,p,['status_prospek','tanggal_input','waktu_follow_up_terakhir','riwayat_follow_up','sales_penanggung_jawab']);
  if(age>=30){events.push({key:`prospect:${b}:${p.id_prospek}:expired:${day(last)}`,branch:b,kind:'prospect_expired',guard:g,messages:messages(namedRecipients(users,p.sales_penanggung_jawab),`⚠️ *PROSPEK HANGUS (30 HARI)*\n\nProspek ${p.nama_calon_customer||'-'} dibatalkan otomatis karena sudah 30 hari tanpa follow up/kejelasan.\n🌐 https://aplikasisla.vercel.app/`)});continue;}
  if(age<=0||age%3!==0||p.waktu_peringatan_crm_terakhir&&day(p.waktu_peringatan_crm_terakhir)===day(now))continue;
  const target=messages(namedRecipients(users,p.sales_penanggung_jawab),`⏰ *WAKTUNYA FOLLOW UP CRM*\n\nSudah ${age} hari belum ada follow up prospek:\n👤 ${p.nama_calon_customer||'-'}\n📦 ${p.kebutuhan||'-'}\n\nSegera hubungi klien dan catat hasilnya di aplikasi SLA.`);
  if(target.length)events.push({key:`prospect:${b}:${p.id_prospek}:${day(now)}`,branch:b,kind:'prospect_reminder',guard:g,messages:target});
 }
 return events;
}
export function warrantyReminders(warranties,tickets,now=new Date()){
 const events=[],seen=new Set(warranties.filter(w=>w.follow_up_after_sales_terkirim).map(w=>`warranty:${branchOf(w)}:${w.referensi_tiket_nota}:${Number(w.durasi_hari)===7?5:Number(w.durasi_hari)===30?7:30}`));
 for(const w of warranties){
  const b=branchOf(w),duration=Number(w.durasi_hari),due=duration===7?5:duration===30?7:duration>=90&&duration<=365?30:0;
  const key=`warranty:${b}:${w.referensi_tiket_nota}:${due}`;
  if(!due||seen.has(key)||/habis|hangus|diklaim/.test(norm(w.status))||w.follow_up_after_sales_terkirim)continue;
  const t=tickets.find(t=>t.id_tiket===w.referensi_tiket_nota&&branchOf(t)===b);
  if(!t||norm(t.status)!=='selesai'||!Number.isFinite(Date.parse(t.waktu_selesai)))continue;
  if(Math.round((Date.parse(day(now))-Date.parse(day(t.waktu_selesai)))/86400000)!==due||w.tanggal_habis&&Date.parse(w.tanggal_habis)<now.getTime())continue;
  const p=phone(t.no_wa_klien);if(!p)continue;
  const g=guard('garansi',w.id_garansi,w,['status','durasi_hari','follow_up_after_sales_terkirim','tanggal_habis','referensi_tiket_nota']);
  g.ticket=guard('tiket',t.id_tiket,t,['status','waktu_selesai','no_wa_klien']);
  events.push({key,branch:b,kind:'warranty_followup',guard:g,marker:`HARI_${due}`,messages:[{phone:p,message:`Assalamu'alaikum ${t.klien_lokasi||w.nama_pelanggan||'Bapak/Ibu'},\n\nKami dari *Alfacom Multi Solution* ingin memastikan hasil instalasi/perbaikan *${w.barang_jasa||t.jenis_pekerjaan||'-'}* berfungsi dengan lancar.\n\nGaransi ${duration} hari Anda masih dalam periode layanan. Jika ada kendala, cek status dan ajukan klaim melalui:\nhttps://aplikasisla.vercel.app/?track=${encodeURIComponent(t.id_tiket)}\n\nTerima kasih atas kepercayaannya.`}]});
  seen.add(key);
 }
 return events;
}
export function storageReminders(warranties,tickets,previous=[],now=new Date()){
 const events=[];
 for(const w of warranties){
  if(!['masa tunggu','belum diambil'].includes(norm(w.status))||w.waktu_diambil)continue;
  const b=branchOf(w),t=tickets.find(t=>t.id_tiket===w.referensi_tiket_nota&&branchOf(t)===b);
  if(!t||norm(t.status)!=='selesai')continue;
  const ready=w.waktu_siap_diambil||t.waktu_selesai;if(!Number.isFinite(Date.parse(ready)))continue;
  const age=Math.round((Date.parse(day(now))-Date.parse(day(ready)))/86400000);
  const g=guard('garansi',w.id_garansi,w,['status','waktu_diambil','waktu_siap_diambil','riwayat_follow_up']);g.ticket=guard('tiket',t.id_tiket,t,['status','waktu_selesai','no_wa_klien']);
  if(age>=31){events.push({key:`storage:${b}:${w.id_garansi}:expired`,branch:b,kind:'storage_expired',guard:g,messages:[]});continue;}
  const due=age>=5&&age<8?5:age>=28&&age<31?28:0;if(!due)continue;
  const history=String(w.riwayat_follow_up||''),marks=[...history.matchAll(new RegExp('\\[PENITIPAN_H'+due+':([A-Z]+)','g'))];
  if(marks.length&&['DIPROSES','DIANTREKAN'].includes(marks.at(-1)[1]))continue;
  if(due===5&&(previous.some(p=>p.id_garansi===w.id_garansi&&p.terkirim_pada)||/(HARI[_ ]?5|HARI KE-?5|H-5)/i.test(history)))continue;
  const p=phone(t.no_wa_klien);if(!p)continue;
  const detail=due===5?'Mohon segera diambil. Setelah 7 hari sejak siap diambil, garansi hangus dan biaya penitipan Rp1.000/hari mulai hari ke-8.':'Mohon segera diambil. Barang mendekati batas penyimpanan 30 hari; mulai hari ke-31 tidak lagi menjadi tanggung jawab penyimpanan Alfacom.';
  events.push({key:`storage:${b}:${w.id_garansi}:H${due}`,branch:b,kind:'storage_reminder',guard:g,marker:`PENITIPAN_H${due}`,messages:[{phone:p,message:`Assalamu'alaikum ${w.nama_pelanggan||t.klien_lokasi||'Bapak/Ibu'},\n\nBarang servis *${w.barang_jasa||t.jenis_pekerjaan||'-'}* (tiket ${t.id_tiket}) sudah menunggu pengambilan ${age} hari.\n\n${detail}\n\nhttps://aplikasisla.vercel.app/?track=${encodeURIComponent(t.id_tiket)}`} ]});
 }
 return events;
}
