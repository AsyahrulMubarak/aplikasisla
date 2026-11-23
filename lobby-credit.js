(()=>{'use strict';
 const $=id=>document.getElementById(id),panel=$('lobby-credit-panel'),list=$('lobby-credit-list'),status=$('lobby-credit-status');
 if(!panel||!list||!status)return;
 const autoRefreshMs=5*60*1000;
 let activeKey='',pending=null,controller=null,refreshTimer=null,lastRequestAt=null,revision=0;
 const element=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
 const identity=()=>typeof penggunaAktif!=='undefined'&&penggunaAktif?String(penggunaAktif.Username)+'|'+String(penggunaAktif.Hak_Akses_Cabang)+'|'+String(penggunaAktif.Role):'';
 const visible=()=>identity()&&$('main-lobby-wrapper')?.getAttribute('aria-hidden')==='false'&&$('main-lobby-wrapper').style.display!=='none';
 const number=n=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(Number(n)||0);
 const money=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(n)||0);
 function clear(){revision++;controller?.abort();clearTimeout(refreshTimer);refreshTimer=null;pending=null;activeKey='';lastRequestAt=null;list.replaceChildren();status.textContent='';panel.hidden=true;}
 function scheduleRefresh(delay){
  clearTimeout(refreshTimer);
  refreshTimer=setTimeout(()=>{refreshTimer=null;return refresh();},delay);
 }
 function render(data){
  list.replaceChildren();panel.hidden=!data.rows.length;
  const month=new Date(data.period+'-01T12:00:00+08:00').toLocaleDateString('id-ID',{month:'long',year:'numeric',timeZone:'Asia/Makassar'});
  $('lobby-credit-period').textContent=month+' · Penilaian sementara';
  status.textContent=data.period<'2026-11'?'Kredit kehadiran dan pencapaian mulai November 2026. Data Oktober ditampilkan sebagai ringkasan; tidak menghasilkan kredit.':'Kehadiran sampai hari berjalan; alpa hari ini belum difinalkan. Kredit bulanan disahkan setelah masa koreksi.';
  for(const row of data.rows){
   const card=element('article','credit-person'),header=element('div','credit-person-head'),who=element('div');
   who.append(element('h4','',row.name),element('span','credit-meta',row.branch+' · '+(row.role==='sales'?'Sales':'Teknisi')));
   const report=element('button','credit-detail','Lihat penilaian');report.type='button';report.addEventListener('click',()=>window.open('performa.html?employee='+encodeURIComponent(row.username)+'&period='+encodeURIComponent(data.period),'_blank'));
   header.append(who,report);card.append(header);
   const a=row.attendance,attendance=element('section','credit-attendance'),stats=element('div','credit-attendance-stats');
   attendance.append(element('strong','credit-label','Kehadiran'));
   for(const [label,value,limit] of [['Telat pagi',a.late,a.lateLimit],['Alpa',a.absent,a.absentLimit]]){
    const item=element('div',value>limit?'credit-stat is-over':'credit-stat');
    item.append(element('span','',label),element('strong','',number(value)+' / '+number(limit)));
    stats.append(item);
   }
   const attendanceStart=(a.startPeriod||row.programStart||'')>'2026-11'?(a.startPeriod||row.programStart):'2026-11';
   const attendanceStarted=data.period>=attendanceStart;
   const attendanceStartLabel=new Date(attendanceStart+'-01T12:00:00+08:00').toLocaleDateString('id-ID',{month:'long',year:'numeric',timeZone:'Asia/Makassar'});
   const attendanceLabel=!attendanceStarted?'Kredit kehadiran mulai '+attendanceStartLabel:row.programFinished?'Program kredit gaji selesai':!a.eligible?'Belum terdaftar dalam program kredit':a.potentialCredit?'Memenuhi sementara · potensi 1 kredit':'Batas terlampaui · 0 kredit';
   attendance.append(stats,element('p','credit-state'+(attendanceStarted&&a.eligible&&!a.potentialCredit?' is-over':''),attendanceLabel));card.append(attendance);
   const p=row.achievement,achievement=element('section','credit-achievement'),top=element('div','credit-progress-head');
   const composite=!p.sales&&p.unit==='skor';
   top.append(element('strong','credit-label',composite?'Poin pencapaian':'Pencapaian'),element('span','credit-percent',composite?(p.score===null?'—':number(p.score)+' / 100'):number(p.percent)+'%'));achievement.append(top);
   const track=element('div','credit-track'),fill=element('div','credit-fill');
   track.setAttribute('role','progressbar');track.setAttribute('aria-label','Pencapaian '+row.name);track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-valuenow',String(Math.round(p.percent)));
   fill.style.width='0%';track.append(fill);achievement.append(track);
   achievement.append(element('p','credit-values',p.sales?'Rata-rata 3 target · masing-masing maks. 100%':p.target>0?(composite?'Total poin grade: ':'')+number(p.achieved)+' / '+number(p.target)+' poin':'Target belum ditetapkan'));
   if(composite){
    const weights=p.policy?.weights||{P:.55,R:.10,K:.20,T:.05,G:.05,U:.05};
    const grade=element('div','credit-grade-summary');grade.append(element('span','','TOTAL POIN GRADE'),element('strong','credit-grade-total',number(p.achieved)),element('small','','Target '+number(p.target)+' poin · sumbangan grade '+number(p.contributions?.P??0)+' / '+number(weights.P*100)));achievement.append(grade);
    achievement.append(element('p','credit-meta',[['P','Grade'],['R','Respons'],['K','Pengerjaan'],['T','Ketuntasan'],['G','Garansi'],['U','Stabilitas']].map(([key,label])=>label+' '+number(weights[key]*100)+'%').join(' · ')));
    if(p.quality){const pending=Object.values(p.quality).reduce((sum,q)=>sum+q.pending,0);if(pending)achievement.append(element('p','credit-meta',pending+' kasus mutu menunggu tinjauan; nilai mutu 100% masih sementara.'));}
    if(!p.complete)achievement.append(element('p','credit-meta','Nilai sementara; sampel dan tinjauan mutu harus lengkap.'));
   }
   if(p.sales){
    const criteria=element('div','credit-sales-criteria');
    for(const [label,value,key] of [
     ['Omzet',money(p.sales.revenue)+' / '+money(p.sales.revenueTarget),'omzet'],
     ['Konversi',(p.sales.conversion===null?'—':number(p.sales.conversion)+'%')+' / '+number(p.sales.conversionTarget)+'%','konversi'],
     ['Tindak lanjut',number(p.sales.countedFollowups)+' / '+number(p.sales.requiredFollowups),'tindakLanjut']]){
     const item=element('div','credit-sales-target');item.append(element('span','',label),element('strong','',number(p.sales.progress?.[key])+'%'),element('small','',value));criteria.append(item);
    }
    achievement.append(criteria);
   }
   const achievementLabel=!p.official?'Kredit pencapaian mulai November 2026':row.programFinished?'Pencapaian tetap tercatat; program gaji selesai':p.potentialCredit?'Syarat terpenuhi · potensi 1 kredit':p.complete?'Syarat pencapaian belum seluruhnya terpenuhi':'Menunggu kelengkapan penilaian';
   achievement.append(element('p','credit-state',achievementLabel));card.append(achievement);list.append(card);
   requestAnimationFrame(()=>{if(fill.isConnected)fill.style.width=Math.min(100,Math.max(0,p.percent))+'%';});
  }
 }
 async function refresh(force=false){
  if(!visible()){clear();return;}
  if(document.hidden)return;
  const key=identity();if(key!==activeKey){clear();activeKey=key;}
  if(pending&&!force)return pending;
  const remaining=lastRequestAt===null?0:autoRefreshMs-(Date.now()-lastRequestAt);
  if(!force&&remaining>0){scheduleRefresh(remaining);return;}
  if(pending){revision++;controller?.abort();pending=null;}
  lastRequestAt=Date.now();
  scheduleRefresh(autoRefreshMs);
  const version=++revision;controller=new AbortController();const currentController=controller,timeout=setTimeout(()=>currentController.abort(),35000);
  panel.hidden=false;panel.setAttribute('aria-busy','true');status.textContent='Memuat penilaian bulan berjalan…';
  pending=(async()=>{try{
   const token=await pastikanTokenSupabaseAktif_();
   const r=await fetch(SUPABASE_URL+'/functions/v1/sla-performance-credit',{method:'POST',headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'lobby'}),signal:currentController.signal});
   const data=await r.json();if(!r.ok||data.status!=='sukses')throw Error(data.pesan||'Penilaian belum dapat dimuat.');
   if(version!==revision||key!==identity()||!visible())return false;
   render(data);return true;
  }catch(error){if(version===revision&&key===identity()){list.replaceChildren();status.textContent=currentController.signal.aborted?'Penilaian belum selesai dimuat. Pembaruan otomatis akan dicoba lagi.':error.message;}return false;}
  finally{clearTimeout(timeout);if(version===revision){pending=null;panel.setAttribute('aria-busy','false');}}})();
  return pending;
 }
 $('lobby-credit-refresh').addEventListener('click',()=>refresh(true));
 window.SLACreditLobby={refresh,clear,render};
 new MutationObserver(()=>{if(visible())void refresh();else clear();}).observe($('main-lobby-wrapper'),{attributes:true,attributeFilter:['style','aria-hidden']});
 window.addEventListener('focus',()=>refresh());
 window.addEventListener('storage',event=>{
  if(event.key!=='sla-performance-updated')return;
  if(document.hidden)lastRequestAt=null;
  else void refresh(true);
 });
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
 if(visible())void refresh();
})();
