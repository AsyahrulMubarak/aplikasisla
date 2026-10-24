(()=>{'use strict';
 const selector='[data-achievement-person]',cache=new Map(),pending=new Map();
 const labels={P:'Poin grade',K:'SLA pengerjaan',R:'SLA respons',T:'Tuntas tanpa pending',G:'Kualitas garansi',U:'Stabilitas penugasan'};
 const number=n=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(n);
 const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
 const identity=()=>typeof penggunaAktif!=='undefined'&&penggunaAktif?String(penggunaAktif.Username)+'|'+String(penggunaAktif.Hak_Akses_Cabang)+'|'+String(penggunaAktif.Role):'';
 const element=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
 function render(node,row){
  node.replaceChildren();node.removeAttribute('aria-busy');
  node.append(element('div','achievement-heading','POIN PENCAPAIAN'));
  if(!row){node.append(element('p','achievement-note','Penilaian tersedia untuk teknisi aktif dengan gaji pokok dalam hak akses akun ini.'));return;}
  node.append(element('strong','achievement-total',row.score===null?'—':number(row.score)+' / 100'));
  node.append(element('p','achievement-grade','Total poin grade: '+number(row.achieved)+' / target '+number(row.target)));
  const state=row.consumed?'Hasil historis terkunci':row.stale?'Perlu peninjauan ulang':!row.complete?'Sementara · menunggu kelengkapan penilaian':row.pass?'Target pencapaian terpenuhi':'Target pencapaian belum terpenuhi';
  node.append(element('p','achievement-state',state));
  const detail=element('details','achievement-details');detail.append(element('summary','','Rincian perhitungan'));
  const grid=element('div','achievement-components');
  for(const [key,label] of Object.entries(labels)){
   const item=element('div','achievement-component'),value=row.values[key],weight=row.policy.weights[key]*100;
   item.append(element('span','',label+' · '+number(weight)+'%'),element('strong','',value===null?'Belum cukup data':number(value)+'%'),element('small','',value===null?'Menunggu sampel':'+ '+number(row.contributions?.[key]??value*weight/100)+' poin'));
   grid.append(item);
  }
  detail.append(grid,element('p','achievement-note','Solo dan tim masuk melalui porsi poin grade yang disahkan. Poin grade dihitung sebelum potongan SLA.'));
  if(row.reasons.length){const reasons=element('ul','achievement-reasons');for(const reason of row.reasons)reasons.append(element('li','',reason));detail.append(reasons);}
  const link=element('a','','Buka penilaian dan tinjauan mutu');link.href='performa.html?employee='+encodeURIComponent(row.username)+'&period='+encodeURIComponent(node.dataset.achievementPeriod);detail.append(link);node.append(detail);
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
   const key=actor+'|'+period+'|'+branch;node.dataset.achievementLoading=key;node.setAttribute('aria-busy','true');
   try{
    const saved=cache.get(key),data=saved&&Date.now()-saved.at<30000?saved.data:await load(period,branch,key);
    if(!node.isConnected||actor!==identity()||node.dataset.achievementLoading!==key)return;
    const matches=data.rows.filter(row=>norm(row.name)===norm(node.dataset.achievementPerson));
    render(node,matches.length===1?matches[0]:null);
   }catch(error){if(node.isConnected&&actor===identity()){
    node.replaceChildren(element('div','achievement-heading','POIN PENCAPAIAN'),element('p','achievement-note',error.message));node.removeAttribute('aria-busy');
    const retry=element('button','achievement-retry','Coba lagi');retry.type='button';retry.addEventListener('click',()=>{delete node.dataset.achievementLoading;void refresh();});node.append(retry);
   }}
  }));
 }
 let scheduled=false;
 const schedule=()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;void refresh();});};
 new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
 window.addEventListener('focus',()=>{for(const node of document.querySelectorAll(selector))delete node.dataset.achievementLoading;schedule();});
 window.SLAAchievementScore={refresh,render,clear(){cache.clear();for(const node of document.querySelectorAll(selector)){node.replaceChildren();delete node.dataset.achievementLoading;}schedule();}};
 schedule();
})();
