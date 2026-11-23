(()=>{'use strict';
const BASE='https://oozkqjgllubhjctnkxwl.supabase.co',KEY='sb_publishable_Wa3EUtroPjqwfCkJOyRSSw_MWnMXH6E';
const $=id=>document.getElementById(id),num=n=>n===null?'Belum ada sampel':Number(n).toLocaleString('id-ID',{maximumFractionDigits:2});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let session,context,busy=false,generation=0,dirty=false,saveTimer,saveBusy=null,editVersion=0;
const currentMonth=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Makassar',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7);
const message=(text,error=false)=>{$('message').textContent=text;$('message').className=error?'error':'';};
async function token(){
 const latest=JSON.parse(sessionStorage.getItem('sesiLoginSLA')||'null');if(!latest?.user?.SessionToken)throw Error('Silakan login kembali melalui Lobi.');session=latest;
 let expiry=Number(session.user.SessionExpiresAt);if(!expiry){try{expiry=JSON.parse(atob(session.user.SessionToken.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).exp*1000;}catch{}}
 if(expiry>Date.now()+60000)return session.user.SessionToken;
 if(!session.user.RefreshToken)throw Error('Sesi kedaluwarsa. Silakan login kembali melalui Lobi.');
 const r=await fetch(BASE+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.user.RefreshToken}),signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok||!d.access_token)throw Error('Sesi kedaluwarsa. Silakan login kembali.');
 Object.assign(session.user,{SessionToken:d.access_token,RefreshToken:d.refresh_token||session.user.RefreshToken,SessionExpiresAt:(d.expires_at||Date.now()/1000+d.expires_in)*1000});sessionStorage.setItem('sesiLoginSLA',JSON.stringify(session));return d.access_token;
}
async function api(body){const t=await token();const r=await fetch(BASE+'/functions/v1/sla-performance-credit',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(35000)});const d=await r.json();if(!r.ok||d.status!=='sukses')throw Error(d.pesan||'Rekap belum dapat diproses.');return d;}
function input(){const decisions={};document.querySelectorAll('[data-case]').forEach(el=>{const outcome=el.querySelector('select').value,note=el.querySelector('[data-note]').value,root=el.querySelector('[data-root]').value;if(outcome||note||root)decisions[el.dataset.case]={outcome,note,root};});return {effectiveDays:Number($('days').value),targetReason:$('target-reason').value,decisions};}
const draftKey=c=>'sla-review-draft:'+String(session?.user?.Username||session?.user?.username||'session')+':'+c.profile.username+':'+c.result.period;
function draftStatus(text,error=false){$('draft-status').textContent=text;$('draft-status').className=error?'error':'muted';}
function notifyViews(){try{localStorage.setItem('sla-performance-updated',Date.now()+':'+Math.random());}catch{}}
function backup(){if(!context?.canApprove)return;try{localStorage.setItem(draftKey(context),JSON.stringify({hash:context.hash,revision:context.draft?.revision||0,basedRevision:context.saved?.revision||0,evidence:context.caseEvidence,input:input()}));}catch{}}
function changed(){if(!context?.canApprove)return;dirty=true;editVersion++;backup();draftStatus('Perubahan belum tersimpan…');clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveDraft().catch(()=>{}),800);}
async function saveDraft(){
 clearTimeout(saveTimer);if(saveBusy){await saveBusy;if(dirty)return saveDraft();return;}
 if(!dirty||!context?.canApprove)return;
 const c=context,version=editVersion,payload=input();draftStatus('Menyimpan tinjauan…');
 saveBusy=(async()=>{try{
  const d=await api({action:'save',username:c.profile.username,period:c.result.period,input:payload,draftRevision:c.draft?.revision||0,hash:c.hash});
  notifyViews();
  if(context===c){c.draft=d.draft;c.draftActive=true;c.caseEvidence=d.draft.input.caseEvidence;dirty=editVersion!==version;
   if(!dirty){c.result=d.result;renderCalculation(c);try{localStorage.removeItem(draftKey(c));}catch{}draftStatus('Tinjauan tersimpan otomatis · '+new Date(d.draft.diperbarui_pada).toLocaleString('id-ID',{timeZone:'Asia/Makassar'})+' WITA');}
   else {backup();saveTimer=setTimeout(()=>saveDraft().catch(()=>{}),800);}
  }
 }catch(e){draftStatus('Belum tersimpan di server: '+e.message+' Isian tetap tersedia pada perangkat ini.',true);throw e;}})();
 try{await saveBusy;}finally{saveBusy=null;}
}
function restoreBackup(){try{const b=JSON.parse(localStorage.getItem(draftKey(context))||'null');if(!b)return;if(b.revision!==(context.draft?.revision||0)||b.basedRevision!==(context.saved?.revision||0)){draftStatus('Ada isian lokal dari versi sebelumnya. Draf terbaru dari server ditampilkan; isian lokal tetap disimpan pada perangkat.',true);return;}
 $('days').value=b.input.effectiveDays;$('target-reason').value=b.input.targetReason||'';document.querySelectorAll('[data-case]').forEach(el=>{const d=b.input.decisions?.[el.dataset.case];if(d){const same=b.hash===context.hash||b.evidence?.[el.dataset.case]===context.caseEvidence?.[el.dataset.case];el.querySelector('select').value=same?d.outcome:'';el.querySelector('[data-note]').value=d.note||'';el.querySelector('[data-root]').value=d.root||'';if(!same){const note=document.createElement('p');note.className='error';note.textContent='Bukti berubah sejak isian terakhir. Catatan dipertahankan; pilih kembali hasil tinjauan.';el.prepend(note);}}});changed();
 }catch{}}
function renderCalculation(c){
 const r=c.result,sales=r.policy.kind==='sales';
 $('score').textContent=sales?Object.values(r.values).filter(v=>v!==null&&v>=100).length+' / 3 target':r.score===null?'—':num(r.score)+' / 100';
 const official=r.period>='2026-11'&&c.eligible;
 $('credit').textContent=!official?'Periode/pegawai di luar kredit performa resmi.':c.draft&&c.draft.based_revision===(c.saved?.revision||0)?'Tinjauan tersimpan sebagai draf · potensi '+r.credit+' kredit · menunggu pengesahan rekap':!c.saved?'Potensi kredit performa: '+r.credit+' · menunggu pengesahan rekap':c.stale?'Data sumber berubah; rekap perlu ditinjau dan disahkan ulang.':'Kredit performa disahkan: '+(c.saved.hasil.pass?1:0)+' · '+(r.pass?'Memenuhi syarat':'Belum memenuhi syarat');
 if(sales&&c.salaryCreditEligible===false)$('credit').textContent=official?(c.saved?'Penilaian pencapaian tersimpan.':'Penilaian pencapaian menunggu pengesahan.')+' Kredit kenaikan gaji hanya untuk pegawai dalam program gaji.':'Penilaian sales resmi mulai November 2026.';
 $('target').textContent=num(r.achieved)+' poin sah / '+num(r.target)+' target ('+num(r.effectiveDays)+' dari '+r.days+' hari kerja).';
 const labels=sales?{omzet:'Omzet terhadap minimum',konversi:'Konversi terhadap minimum',tindakLanjut:'Tindak lanjut terhadap minimum'}:{P:'Poin grade',K:'SLA pengerjaan',R:'SLA respons',T:'Tuntas tanpa pending',G:'Kualitas garansi',U:'Stabilitas penugasan'};
 const metricNote=k=>{
  if(sales)return '';
  if(k==='P')return 'Total poin grade '+num(r.achieved)+' / target '+num(r.target);
  if(k==='R')return r.counts.responseGood+' dari '+r.counts.responseTotal+' sampel tepat · bulan tenggat respons';
  if(k==='K')return r.counts.workGood+' dari '+r.counts.workTotal+' sampel tepat · bulan tenggat pengerjaan';
  const q=r.quality?.[k];return q?q.cases+' kasus · '+q.pending+' menunggu tinjauan · '+q.fault+' terbukti akibat teknisi':'';
 };
 $('metrics').innerHTML=Object.entries(labels).map(([k,label])=>{const pending=r.quality?.[k]?.pending||0;return '<div class="metric"><span>'+label+(sales?'':' · '+num(r.policy.weights[k]*100)+'%')+'</span><strong>'+num(r.values[k])+(r.values[k]===null?'':'%')+(pending?' sementara':'')+'</strong>'+(!sales&&r.values[k]!==null?'<small>+ '+num(r.contributions?.[k]??r.values[k]*r.policy.weights[k])+' poin pencapaian'+(pending?' sementara':'')+'</small>':'')+'<small>'+esc(metricNote(k))+'</small></div>';}).join('');
 $('reasons').innerHTML=r.reasons.map(t=>'<li>'+esc(t)+'</li>').join('')||'<li class="good">Semua komponen dan batas minimum terpenuhi.</li>';
}
function render(c){
 context=c;const r=c.result,sales=r.policy.kind==='sales';$('report').hidden=false;
 $('technical-target').hidden=sales;$('technical-quality').hidden=sales;$('technical-sources').hidden=sales;$('sales-target-summary').hidden=!sales;
 $('metrics-title').textContent=sales?'Pemenuhan tiga target wajib':'Rincian poin pencapaian';
 $('metrics-policy').textContent=sales?'Semua target harus terpenuhi. Kelebihan pada satu aspek tidak menggantikan kekurangan aspek lain. Tindak lanjut dibatasi minimum per hari kerja; kelebihan suatu hari tidak menutup hari yang kurang.':'Kredit diperoleh jika total skor ≥80 dan penilaian lengkap. Tidak ada batas minimum terpisah per aspek. Aspek tanpa sampel tetap menunggu data. Jumlah akhir memakai angka penuh; tampilan setiap komponen dibulatkan.';
 $('person').textContent=c.profile.name+' · '+c.profile.branch+' · '+r.period;
 $('status').textContent=c.consumed?'Kredit sudah dipakai untuk kenaikan; hasil pengesahan historis dikunci':c.closed?'Bulan sudah melewati masa koreksi':'Pratinjau berjalan; belum menjadi keputusan bulanan';
 const official=r.period>='2026-11'&&c.eligible;renderCalculation(c);
 const a=c.attendance;$('attendance').textContent=a?'Kehadiran: telat pagi '+a.telat_pagi+', alpa '+a.alpa+' → '+(a.telat_pagi<=3&&a.alpa<=2?1:0)+' kredit.':'Kehadiran akan difinalkan setelah tanggal 7 bulan berikutnya; aturan lama tetap berjalan.';
 $('saved').textContent=c.saved?'Rekap disahkan oleh '+c.saved.disahkan_oleh+' · revisi '+c.saved.revision+(c.stale?' · perlu pengesahan ulang':''):'';
 $('days').max=r.days;$('days').value=r.effectiveDays;$('days').disabled=sales||!c.canApprove;$('target-reason').value=r.targetReason;$('target-reason').disabled=sales||!c.canApprove;
 if(sales){const s=r.sales,t=s.target,money=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n||0);
 $('sales-target-values').innerHTML=t?[['Omzet',money(s.revenue)+' / '+money(t.omzet)],['Konversi',num(s.conversion)+'% / '+num(t.konversi)+'%'],['Tindak lanjut',num(s.countedFollowups)+' / '+num(s.requiredFollowups)]].map(([label,value])=>'<div class="metric"><span>'+label+'</span><strong>'+esc(value)+'</strong></div>').join(''):'<p>Target belum disimpan. Atur pada panel Target & tindak lanjut sales.</p>';
 $('sales-proof-rule').textContent=t?(t.bukti_wajib?'Bukti wajib untuk menghitung tindak lanjut.':'Bukti opsional sesuai target tersimpan.')+' Satu pelanggan dihitung sekali per hari.':'';
 $('sales-daily').innerHTML=s.daily.map(d=>'<div class="row"><span>'+esc(d.day)+'</span><strong>'+num(d.count)+' / '+num(d.minimum)+(d.met?' · Terpenuhi':' · Belum terpenuhi')+'</strong></div>').join('');
 $('sales-transactions').innerHTML=s.transactions.map(t=>'<div class="row"><span>'+esc(t.id)+' · '+esc(t.source)+'</span><strong>'+esc(money(t.amount))+'</strong></div>').join('')||'<p>Belum ada realisasi omzet periode ini.</p>';}
 $('cases').innerHTML=r.cases.map(c=>'<article class="case" data-case="'+esc(c.key)+'"><strong>'+esc(c.ticket)+' · '+({T:'Pending',G:'Garansi',U:'Pergantian teknisi'})[c.kind]+'</strong>'+(c.evidenceChanged?'<p class="error">Bukti kasus ini berubah. Catatan sebelumnya dipertahankan; periksa bukti lalu pilih kembali hasil tinjauan.</p>':'')+'<details><summary>Lihat bukti sumber</summary>'+esc(c.detail)+'</details><div class="filters"><label>Hasil tinjauan<select '+(!context.canApprove?'disabled':'')+'><option value="">Belum ditinjau</option><option value="exempt" '+(c.decision==='exempt'?'selected':'')+'>Bukan kesalahan teknisi</option><option value="fault" '+(c.decision==='fault'?'selected':'')+'>Kesalahan terbukti (penalti utama)</option></select></label><label>Bukti / alasan<textarea data-note maxlength="2000" rows="2" '+(!context.canApprove?'disabled':'')+'>'+esc(c.note)+'</textarea></label><label>Akar masalah<input data-root maxlength="150" value="'+esc(c.root)+'" '+(!context.canApprove?'disabled':'')+'></label></div></article>').join('')||'<p>Tidak ditemukan kasus mutu yang perlu ditinjau pada sumber periode ini.</p>';
 $('points').innerHTML=r.points.map(p=>'<div class="row"><span>'+esc(p.id)+' · '+esc(p.grade)+' · '+num(p.share)+'%</span><strong>'+num(p.points)+' poin</strong></div>').join('')||'<p>Belum ada hasil pencapaian sah pada bulan ini.</p>';
 $('unfinished').innerHTML=r.unfinished.map(t=>'<div class="row"><strong>'+esc(t.id)+'</strong><span>'+esc(t.reason)+'</span></div>').join('')||'<p>Tidak ada pencapaian yang tertunda pada tiket selesai.</p>';
 $('sla').innerHTML=[['Pengerjaan',r.workTickets],['Respons',r.responseTickets]].map(([label,items])=>'<h3>'+label+'</h3>'+items.map(t=>'<div class="row"><strong>'+esc(t.id)+'</strong><span class="'+(t.good?'good':'bad')+'">'+(t.good?'Tepat':'Terlambat / belum dipenuhi')+'</span></div>').join('')).join('');
 $('ledger').innerHTML=c.credits.map(k=>'<div class="row"><span>'+esc(k.periode)+' · '+esc(k.sumber)+' · 1 kredit</span><strong>'+ (k.kenaikan_id?'Sudah dipakai':'Terkumpul')+'</strong></div>').join('')||'<p>Belum ada kredit yang difinalkan.</p>';
 $('actions').hidden=!c.canApprove;$('approve').disabled=busy||!c.canApprove||!c.closed||!official;
 $('approval-note').textContent=c.stale?'Sumber berubah. Periksa ulang seluruh komponen sebelum mengesahkan.':!c.closed?'Tinjau data dan hitung pratinjau sekarang; pengesahan tersedia tanggal 8 bulan berikutnya.':'Periksa target, seluruh tiket selesai, serta sebab kasus mutu sebelum mengesahkan.';
 dirty=false;draftStatus(c.draft&&c.draft.based_revision===(c.saved?.revision||0)?'Tinjauan tersimpan · '+c.draft.diperbarui_oleh+' · '+new Date(c.draft.diperbarui_pada).toLocaleString('id-ID',{timeZone:'Asia/Makassar'})+' WITA':'Perubahan tinjauan akan disimpan otomatis.');
}
async function run(action){if(busy)return;busy=true;const version=++generation;$('filters').querySelector('button').disabled=true;$('preview').disabled=true;$('approve').disabled=true;for(const el of document.querySelectorAll('#review input,#review select,#review textarea,#filters input,#filters select'))el.disabled=true;message(action==='approve'?'Mengesahkan rekap…':'Memuat rekap…');
 try{try{await saveDraft();}catch(e){if(action!=='read'||!/Data tiket berubah|Draf sudah diubah|Rekap telah disahkan ulang/.test(e.message))throw e;}const d=await api({action,username:$('employee').value,period:$('period').value,...(action==='read'?{}:{input:input(),revision:context?.saved?.revision||0,hash:context?.hash})});if(version===generation){render(d);if(action==='read')restoreBackup();if(action==='approve')notifyViews();message(action==='approve'?'Rekap disahkan. Kredit diproses sesuai jadwal evaluasi.':'Rekap diperbarui.');}}
 catch(e){message(e.message,true);if(action==='read'&&!dirty){$('report').hidden=true;context=null;}else if(context){$('employee').value=context.profile.username;$('period').value=context.result.period;}}
 finally{busy=false;$('filters').querySelector('button').disabled=false;for(const el of document.querySelectorAll('#filters input,#filters select'))el.disabled=false;for(const el of document.querySelectorAll('#review input,#review select,#review textarea'))el.disabled=!context?.canApprove||context?.result.policy.kind==='sales';$('preview').disabled=false;$('approve').disabled=!context?.canApprove||!context?.closed||!context?.eligible||$('period').value<'2026-11';}}
 $('filters').addEventListener('submit',e=>{e.preventDefault();run('read');});$('review').addEventListener('submit',e=>{e.preventDefault();run('preview');});$('approve').addEventListener('click',()=>run('approve'));
 $('review').addEventListener('input',changed);$('review').addEventListener('change',changed);
 for(const id of ['employee','period'])$(id).addEventListener('change',()=>run('read'));
 window.addEventListener('beforeunload',()=>{if(dirty)backup();});
 (async()=>{try{const params=new URLSearchParams(location.search),requestedPeriod=params.get('period');$('period').value=/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedPeriod||'')&&requestedPeriod>='2026-10'&&requestedPeriod<=currentMonth()?requestedPeriod:currentMonth();$('period').max=currentMonth();const d=await api({action:'list'});$('employee').replaceChildren();for(const u of d.users){const o=document.createElement('option');o.value=u.username;o.textContent=u.name+' · '+u.branch+(u.role==='sales'?' · Sales':'');$('employee').append(o);}if(!d.users.length)throw Error('Belum ada teknisi atau sales dalam hak akses akun ini.');const requested=params.get('employee');if(d.users.some(u=>u.username===requested))$('employee').value=requested;await run('read');}catch(e){message(e.message,true);}})();
})();
