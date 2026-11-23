(()=>{'use strict';
 const selector='[data-achievement-person]',cache=new Map(),pending=new Map();let sourceRevision=0;
 const labels={P:'Poin grade',K:'SLA pengerjaan',R:'SLA respons',T:'Tuntas tanpa pending',G:'Kualitas garansi',U:'Stabilitas penugasan'};
 const number=n=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(n);
 const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
 const precise=n=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:6}).format(n);
 const identity=()=>typeof penggunaAktif!=='undefined'&&penggunaAktif?String(penggunaAktif.Username)+'|'+String(penggunaAktif.Hak_Akses_Cabang)+'|'+String(penggunaAktif.Role):'';
 const element=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
 function operational(node,row){
  const card=node.closest('.card');if(!card||!row.counts)return;
  const area=card.querySelector('[data-achievement-sla]');
  if(area){area.replaceChildren();area.hidden=false;
   for(const [key,label,good,total,waiting] of [['R','SLA RESPON',row.counts.responseGood,row.counts.responseTotal,row.counts.responsePending],['K','SLA PENGERJAAN',row.counts.workGood,row.counts.workTotal,row.counts.workPending]]){
    const box=element('div','chart-box'),donut=element('div','donut'),inside=element('div','donut-inner'),value=row.values[key];
    box.append(element('div','chart-title',label));donut.style.background=value===null?'#cbd5e1':'conic-gradient(var(--success, #10b981) 0% '+value+'%, var(--danger, #ef4444) '+value+'% 100%)';
    inside.append(element('span','donut-val',value===null?'—':number(value)+'%'),element('span','donut-label','Sampel dinilai'));donut.append(inside);box.append(donut);
    const legend=element('div','chart-legend');for(const [title,count] of [['Tepat',good],['Terlambat / belum terpenuhi',total-good],['Proses / dijeda',waiting||0]]){const item=element('div','legend-item');item.append(element('span','',title),element('b','',String(count)));legend.append(item);}
    box.append(legend,element('p','achievement-note',good+' dari '+total+' sampel tepat · mengikuti bulan tenggat, termasuk episode penugasan yang tercatat.'));area.append(box);
   }
  }
  const quality=card.querySelector('[data-achievement-quality]');if(quality&&row.quality){quality.replaceChildren();quality.hidden=false;
   for(const [key,label,denominator] of [['T','Tuntas Tanpa Pending',row.counts.completed],['G','Kualitas Garansi',row.counts.warranted],['U','Stabilitas Penugasan',row.counts.assigned]]){
    const q=row.quality[key],item=element('div','achievement-quality-item');item.append(element('span','',label),element('strong','',row.values[key]===null?'Belum cukup data':number(row.values[key])+'%'+(q.pending?' sementara':'')));
    item.append(element('p','achievement-note',denominator+' tiket dasar · '+q.cases+' kasus · '+q.pending+' menunggu tinjauan · '+q.fault+' terbukti akibat teknisi.'));
    if(key==='U')item.append(element('p','achievement-note','Riwayat operasional: '+(quality.dataset.recordedReplacement||0)+' kali. Penilaian per tiket; Cancel/Batal dikecualikan.'));quality.append(item);
   }
  }
 }
 function render(node,row){
  node.replaceChildren();node.removeAttribute('aria-busy');
  node.append(element('div','achievement-heading','POIN PENCAPAIAN'));
  if(!row){
   const gradeValue=node.dataset.achievementGrade;
   if(gradeValue!==undefined&&gradeValue!==''&&Number.isFinite(Number(gradeValue))){
    const grade=element('section','achievement-grade');
    grade.append(element('span','achievement-heading','TOTAL POIN GRADE'),element('strong','achievement-grade-total',number(Number(gradeValue))));
    node.append(grade);
   }
   node.append(element('p','achievement-note','Skor pencapaian tersedia untuk teknisi aktif dengan gaji pokok dalam hak akses akun ini.'));
   for(const area of node.closest('.card')?.querySelectorAll('[data-achievement-sla],[data-achievement-quality]')||[]){
    area.replaceChildren();
    area.hidden=true;
   }
   return;
  }
  const totals=element('div','achievement-totals'),grade=element('section','achievement-grade'),score=element('section','achievement-score-total');
  grade.append(element('span','achievement-heading','TOTAL POIN GRADE'),element('strong','achievement-grade-total',number(row.achieved)),element('small','','Target '+number(row.target)+' poin · '+(row.values.P===null?'Belum ada target':number(row.values.P)+'%')));
  score.append(element('span','achievement-heading','POIN PENCAPAIAN'),element('strong','achievement-total',row.score===null?'—':number(row.score)+' / 100'));totals.append(grade,score);node.append(totals);
  const state=row.consumed?'Hasil historis terkunci':row.stale?'Perlu peninjauan ulang':!row.complete?'Sementara · menunggu kelengkapan penilaian':row.pass?'Target pencapaian terpenuhi':'Target pencapaian belum terpenuhi';
  node.append(element('p','achievement-state',state));
  const detail=element('details','achievement-details');detail.append(element('summary','','Rincian perhitungan'));
  const grid=element('div','achievement-components');
  for(const [key,label] of Object.entries(labels)){
   const item=element('div','achievement-component'),value=row.values[key],weight=row.policy.weights[key]*100;
   const pending=row.quality?.[key]?.pending||0;
   item.append(element('span','',label+' · '+number(weight)+'%'),element('strong','',value===null?'Belum cukup data':number(value)+'%'+(pending?' sementara':'')),element('small','',value===null?'Menunggu sampel':'+ '+number(row.contributions?.[key]??value*weight/100)+' poin'+(pending?' sementara':'')));
   if(pending)item.append(element('small','',pending+' kasus menunggu tinjauan'));
   grid.append(item);
  }
  detail.append(grid,element('p','achievement-note','Solo dan tim masuk melalui porsi poin grade yang disahkan. Poin grade dihitung sebelum potongan SLA. Jumlah akhir memakai angka penuh; tampilan setiap komponen dibulatkan.'));
  if(row.points?.length){const grades=element('details','achievement-grade-details');grades.append(element('summary','','Rincian poin grade per tiket'));
   for(const p of row.points){const line=element('div','achievement-grade-row');line.append(element('span','',p.id+' · grade '+p.grade+' · porsi '+precise(p.share)+'%'),element('strong','',precise(p.points)+' poin'));grades.append(line);}detail.append(grades);
  }
  if(row.reasons.length){const reasons=element('ul','achievement-reasons');for(const reason of row.reasons)reasons.append(element('li','',reason));detail.append(reasons);}
  const link=element('a','','Buka penilaian dan tinjauan mutu');link.href='performa.html?employee='+encodeURIComponent(row.username)+'&period='+encodeURIComponent(node.dataset.achievementPeriod);detail.append(link);node.append(detail);
  operational(node,row);
 }
 async function load(period,branch,key){
  if(pending.has(key))return pending.get(key);
  const promise=(async()=>{
   const token=await pastikanTokenSupabaseAktif_();
   const response=await fetch(SUPABASE_URL+'/functions/v1/sla-performance-credit',{method:'POST',headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'dashboard',period,branch}),signal:AbortSignal.timeout(35000)});
   const data=await response.json();if(!response.ok||data.status!=='sukses')throw Error(data.pesan||'Penilaian belum dapat dimuat.');
   cache.set(key,{at:Date.now(),data});return data;
  })();pending.set(key,promise);try{return await promise;}finally{if(pending.get(key)===promise)pending.delete(key);}
 }
 async function refresh(){
  const actor=identity();if(!actor){cache.clear();return;}
  await Promise.all([...document.querySelectorAll(selector)].filter(node=>!node.dataset.achievementLoading).map(async node=>{
   const period=node.dataset.achievementPeriod,branch=node.dataset.achievementBranch;
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period||'')){node.replaceChildren(element('div','achievement-heading','POIN PENCAPAIAN'),element('p','achievement-note','Pilih satu bulan untuk melihat skor pencapaian 0–100.'));node.dataset.achievementLoading='all';return;}
   const key=actor+'|'+period+'|'+branch+'|'+sourceRevision;node.dataset.achievementLoading=key;node.setAttribute('aria-busy','true');
   try{
    const saved=cache.get(key),data=saved&&Date.now()-saved.at<30000?saved.data:await load(period,branch,key);
    if(!node.isConnected||actor!==identity()||node.dataset.achievementLoading!==key)return;
    const matches=data.rows.filter(row=>norm(row.name)===norm(node.dataset.achievementPerson));
    render(node,matches.length===1?matches[0]:null);
   }catch(error){if(node.isConnected&&actor===identity()&&node.dataset.achievementLoading===key){
    node.replaceChildren(element('div','achievement-heading','POIN PENCAPAIAN'),element('p','achievement-note',error.message));node.removeAttribute('aria-busy');
    const retry=element('button','achievement-retry','Coba lagi');retry.type='button';retry.addEventListener('click',()=>{delete node.dataset.achievementLoading;void refresh();});node.append(retry);
   }}
  }));
 }
 let scheduled=false;
 const schedule=()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;void refresh();});};
 new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
 const invalidate=(options={})=>{sourceRevision++;cache.clear();for(const node of document.querySelectorAll(selector))delete node.dataset.achievementLoading;return options.defer?Promise.resolve():refresh();};
 window.addEventListener('focus',invalidate);
 window.addEventListener('storage',event=>{if(event.key==='sla-performance-updated')invalidate();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)invalidate();});
 window.SLAAchievementScore={refresh,render,invalidate,clear(){sourceRevision++;cache.clear();for(const node of document.querySelectorAll(selector)){node.replaceChildren();delete node.dataset.achievementLoading;}schedule();}};
 schedule();
})();
