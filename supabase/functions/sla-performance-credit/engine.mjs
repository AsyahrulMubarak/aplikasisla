// Shared deterministic scoring. Money/bonus points are deliberately not inputs.
import {calculateSales} from './sales.mjs';
export const POLICY = Object.freeze({version:3,start:'2026-11',baseTarget:27,baseDays:26,weights:Object.freeze({P:.50,K:.15,R:.10,T:.10,G:.10,U:.05})});
const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
const names=v=>String(v||'').split(/[,;\r\n]/).map(norm).filter(Boolean);
const time=v=>v?Date.parse(v):NaN;
const round=v=>Math.round((v+Number.EPSILON)*10000)/10000;
const pointRound=v=>Math.round((v+Number.EPSILON)*1000000)/1000000;
const clamp=v=>Math.max(0,Math.min(100,v));
export function calculate(source,input={},evaluatedAt=Date.now()) {
  if(source.profile?.role==='sales')return calculateSales(source);
  const {period,profile}=source, start=time(period+'-01T00:00:00+08:00');
  const [year,month]=period.split('-').map(Number),end=Date.UTC(year,month,1)-8*3600000;
  const inMonth=v=>time(v)>=start&&time(v)<end;
  const now=typeof evaluatedAt==='number'?evaluatedAt:time(evaluatedAt);
  if(!Number.isFinite(now))throw Error('Waktu penilaian tidak valid.');
  const own=v=>names(v).includes(norm(profile.name));
  const belongs=m=>m.username?m.username===profile.username:norm(m.name)===norm(profile.name);
  const tickets=source.tickets||[], warnings=[], cases=[], points=[], unfinished=[];
  let days=0; for(let d=start;d<end;d+=86400000)if(new Date(d+8*3600000).getUTCDay()!==0)days++;
  const effectiveDays=input.effectiveDays===undefined?days:Number(input.effectiveDays);
  if(!Number.isFinite(effectiveDays)||effectiveDays<0||effectiveDays>days||round(effectiveDays)!==effectiveDays)throw Error('Hari penugasan harus 0–'+days+' dan maksimal empat desimal.');
  const targetReason=String(input.targetReason||'').trim();
  if(effectiveDays!==days&&targetReason.length<10)throw Error('Jelaskan bukti pengurangan hari: izin/sakit penuh yang disetujui, mulai bekerja, atau tugas nonteknis. Alpa/telat tidak mengurangi target.');
  let workGood=0,workTotal=0,responseGood=0,responseTotal=0;
  const completed=[],assigned=[],workTickets=[],responseTickets=[];
  const addCase=(kind,t,detail)=>cases.push({key:kind+':'+t.id_tiket,kind,ticket:t.id_tiket,detail:String(detail||'').slice(0,4000)});
  const contextDetails=(t,kind)=>{
    const events=(t.konteks_pekerjaan?.events||[]).filter(e=>e.kind===kind&&(kind==='pending'?own(e.technicians):own(e.from)&&!own(e.to)));
    return events.map(e=>JSON.stringify({kategori:e.category,penjelasan:e.reason,bukti:e.evidence,tindakLanjutWita:e.followUpAt,hasilDanSisa:e.handover,dari:e.from,ke:e.to,oleh:e.actorName,waktuServer:e.at,dilanjutkan:e.closedAt})).join('\n');
  };
  for(const t of tickets){
    if(['cancel','batal'].includes(norm(t.status)))continue;
    const a=t.penilaian_teknisi||{},achievement=a.achievement, current=own(t.teknisi);
    const related=current||own(t.teknisi_sebelumnya)||(t.riwayat_penggantian_teknisi||[]).some(h=>own(h.dari)||own(h.ke))||(achievement?.members||[]).some(belongs);
    if(!related)continue;
    const achievementEligible=norm(t.status)!=='outsource'&&!['garansi','free','gratis'].includes(norm(t.no_transaksi))&&!['excluded','review_required'].includes(a.technicianPoints?.status)&&!String(t.garansi_asal||'').trim()&&!String(t.referensi_tiket_asal||'').trim();
    if(achievementEligible&&achievement&&inMonth(achievement.completedAt)){
      const share=(achievement.members||[]).filter(belongs).reduce((n,m)=>n+Number(m.share||0),0);
      const value=Number(achievement.points)*share/100;
      if(norm(t.status)!=='selesai'||time(t.waktu_selesai)!==time(achievement.completedAt))warnings.push(t.id_tiket+': status/waktu selesai berubah setelah pencapaian disahkan; perlu koreksi hasil.');
      else if(value>0)points.push({id:t.id_tiket,grade:achievement.grade,share,points:pointRound(value),completedAt:achievement.completedAt});
    } else if(achievementEligible&&current&&inMonth(t.waktu_selesai)&&norm(t.status)==='selesai')unfinished.push({id:t.id_tiket,grade:a.grade?.value||null,reason:a.grade?.status==='approved'?'Hasil pencapaian belum disahkan':'Grade belum disahkan'});
    const done=norm(t.status)==='selesai'&&Number.isFinite(time(t.waktu_selesai));
    const paused=['pending','outsource'].includes(norm(t.status));
    if(current&&inMonth(t.tenggat_waktu)&&(done||!paused&&time(t.tenggat_waktu)<=now||paused&&Number(t.sla_jeda_sisa_detik)<0)){
      const good=Number.isFinite(time(t.waktu_selesai))&&time(t.waktu_selesai)<=time(t.tenggat_waktu)&&norm(t.status)==='selesai';
      workTotal++;if(good)workGood++;workTickets.push({id:t.id_tiket,good,deadline:t.tenggat_waktu});
    }
    if(current&&inMonth(t.tenggat_respon)&&(Number.isFinite(time(t.waktu_respon))||time(t.tenggat_respon)<=now)){
      const good=Number.isFinite(time(t.waktu_respon))&&time(t.waktu_respon)<=time(t.tenggat_respon);
      responseTotal++;if(good)responseGood++;responseTickets.push({id:t.id_tiket,good,deadline:t.tenggat_respon});
    }
    if((current||(achievement?.members||[]).some(belongs))&&norm(t.status)==='selesai'&&inMonth(t.waktu_selesai)){
      completed.push(t.id_tiket);
      const proof=contextDetails(t,'pending');if(proof||/\bpending\b/i.test(t.keterangan||''))addCase('T',t,proof||t.keterangan);
    }
    const removed=(t.riwayat_penggantian_teknisi||[]).filter(h=>own(h.dari)&&!own(h.ke)&&inMonth(h.waktu));
    if(removed.length)addCase('U',t,contextDetails(t,'replacement')||removed.map(h=>JSON.stringify(h)).join('\n'));
    // Old replacement records often lack per-episode deadlines. Never attribute the new technician's SLA to the old one.
    if(removed.some(h=>!(source.episodes||[]).some(e=>e.id_tiket===t.id_tiket&&Math.abs(time(e.waktu_pergantian)-time(h.waktu))<120000)))warnings.push(t.id_tiket+': SLA episode teknisi sebelumnya belum memiliki tenggat yang tercatat; perlu verifikasi data.');
    if(removed.length||current&&[t.waktu_penugasan,t.waktu_lapor,t.tenggat_waktu,t.tenggat_respon,t.waktu_selesai].some(inMonth))assigned.push(t.id_tiket);
  }
  for(const e of source.episodes||[]){
    // An incumbent who remains in a changed team keeps the current episode; count only outgoing members.
    if(!own(e.teknisi)||own(e.pengganti))continue;
    if(inMonth(e.tenggat_respon)&&(Number.isFinite(time(e.waktu_respon))||time(e.waktu_pergantian)>time(e.tenggat_respon))){
      const good=Number.isFinite(time(e.waktu_respon))&&time(e.waktu_respon)<=time(e.tenggat_respon);
      responseTotal++;if(good)responseGood++;responseTickets.push({id:e.id_tiket+' · episode '+e.id,good,deadline:e.tenggat_respon});
    }
    const done=norm(e.status)==='selesai'&&Number.isFinite(time(e.waktu_selesai));
    const latePaused=['pending','outsource'].includes(norm(e.status))&&Number(e.sisa_jeda)<0;
    const lateActive=!['pending','outsource'].includes(norm(e.status))&&time(e.waktu_pergantian)>time(e.tenggat_waktu);
    if(inMonth(e.tenggat_waktu)&&(done||latePaused||lateActive)){
      const good=done&&time(e.waktu_selesai)<=time(e.tenggat_waktu);workTotal++;if(good)workGood++;workTickets.push({id:e.id_tiket+' · episode '+e.id,good,deadline:e.tenggat_waktu});
    }
    if(inMonth(e.waktu_pergantian)){
      assigned.push(e.id_tiket);
      if(!cases.some(c=>c.key==='U:'+e.id_tiket))addCase('U',{id_tiket:e.id_tiket},contextDetails(tickets.find(t=>t.id_tiket===e.id_tiket)||{},'replacement')||'Pergantian '+e.teknisi+' → '+e.pengganti+' pada '+e.waktu_pergantian+'. Tinjau sebab, serah terima, dan buktinya.');
    }
  }
  const warranted=new Set(),claims=new Set();
  for(const g of source.warranties||[]){
    const t=tickets.find(t=>t.id_tiket===g.referensi_tiket_nota);if(!t)continue;
    const members=t.penilaian_teknisi?.achievement?.members;
    if(members?!members.some(belongs):!own(t.teknisi))continue;
    const periods=[g,...(g.item_garansi||[])];
    if(periods.some(x=>Number.isFinite(time(x.tanggal_mulai||g.tanggal_mulai))&&time(x.tanggal_mulai||g.tanggal_mulai)<end&&time(x.tanggal_habis||g.tanggal_habis)>=start))warranted.add(t.id_tiket);
    for(const c of tickets.filter(c=>c.garansi_asal===g.id_garansi||c.referensi_tiket_asal===t.id_tiket))if(inMonth(c.waktu_lapor))claims.add(t.id_tiket);
    for(const h of g.riwayat_klaim_item||[])if(inMonth(h.waktu||h.waktu_klaim||h.dibuat_pada||h.tanggal))claims.add(t.id_tiket);
  }
  for(const id of claims){const t=tickets.find(t=>t.id_tiket===id);addCase('G',t,'Klaim pada tiket asal. Periksa sebab dan bukti garansi; klaim tidak otomatis menjadi kesalahan teknisi.');if(!warranted.has(id))warnings.push(id+': tanggal risiko garansi belum lengkap.');}
  if(source.unknownWarrantyClaims>0)warnings.push('Ada '+source.unknownWarrantyClaims+' klaim garansi tanpa tiket asal pada periode ini; tautkan sumber sebelum pengesahan.');
  if(source.duplicateName)warnings.push('Nama pegawai tidak unik dalam cabang; cocokkan profil sebelum pengesahan.');
  const decisions=input.decisions||{};if(!decisions||Array.isArray(decisions)||typeof decisions!=='object')throw Error('Keputusan mutu tidak valid.');
  const fault={T:new Set(),G:new Set(),U:new Set()},roots=new Set();let unresolved=0;
  for(const c of cases){
    const d=decisions[c.key];c.decision=d?.outcome||'pending';c.note=String(d?.note||'').trim();c.root=String(d?.root||c.ticket).trim();
    if(!['fault','exempt'].includes(c.decision)||c.note.length<5){unresolved++;continue;}
    if(c.note.length>2000||c.root.length>150)throw Error('Catatan mutu terlalu panjang.');
    if(c.decision==='fault'){if(roots.has(c.root))throw Error('Satu akar masalah hanya boleh menjadi satu penalti utama: '+c.root);roots.add(c.root);fault[c.kind].add(c.ticket);}
  }
  for(const key of Object.keys(decisions))if(!cases.some(c=>c.key===key))throw Error('Kasus sudah berubah atau bukan bagian penilaian bulan ini. Muat ulang.');
  const ratio=(n,d)=>d>0?clamp(100*n/d):null;
  const target=POLICY.baseTarget*effectiveDays/POLICY.baseDays;
  const achieved=pointRound(points.reduce((n,p)=>n+p.points,0));
  const values={P:target>0?clamp(achieved/target*100):null,K:ratio(workGood,workTotal),R:ratio(responseGood,responseTotal),T:ratio(completed.length-fault.T.size,completed.length),G:ratio(warranted.size-fault.G.size,warranted.size),U:ratio(new Set(assigned).size-fault.U.size,new Set(assigned).size)};
  const missing=Object.keys(values).filter(k=>values[k]===null);
  const complete=!missing.length&&!unresolved&&!warnings.length&&unfinished.length===0;
  const contributions=Object.fromEntries(Object.entries(POLICY.weights).map(([k,w])=>[k,values[k]===null?null:round(w*values[k])]));
  const score=missing.length?null:Object.entries(POLICY.weights).reduce((s,[k,w])=>s+w*values[k],0);
  const pass=complete&&score>=80&&values.P>=80&&values.K>=70&&values.R>=80;
  const reasons=[];
  if(missing.length)reasons.push('Belum ada sampel '+missing.join(', ')+'.');
  if(unresolved)reasons.push(unresolved+' kasus mutu belum ditinjau.');
  if(unfinished.length)reasons.push(unfinished.length+' tiket selesai belum memiliki pencapaian sah.');
  reasons.push(...warnings);
  if(score!==null&&score<80)reasons.push('Skor gabungan di bawah 80.');
  for(const [k,min] of [['P',80],['K',70],['R',80]])if(values[k]!==null&&values[k]<min)reasons.push(k+' di bawah '+min+'%.');
  return {policy:POLICY,period,days,effectiveDays,target:round(target),targetReason,achieved:pointRound(achieved),values:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,v===null?null:round(v)])),contributions,score:score===null?null:round(score),complete,pass,credit:pass?1:0,reasons,cases,points,unfinished,counts:{workGood,workTotal,responseGood,responseTotal,completed:completed.length,warranted:warranted.size,assigned:new Set(assigned).size},workTickets,responseTickets};
}

