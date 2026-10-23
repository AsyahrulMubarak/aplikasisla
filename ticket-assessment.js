/* Ticket assessment v1: service status/BA/WA keep their existing handlers. */
const penilaianTiketUI_={context:null,busy:false,generation:0};
const katalogGradePenilaian_=[
  {grade:'D',points:1,level:'Rutin sederhana',scope:'Satu tindakan rutin pada perangkat.',examples:'Reset printer (TKT-112), refill toner (TKT-180).'},
  {grade:'C',points:2,level:'Servis standar',scope:'Servis standar pada satu perangkat disertai uji fungsi.',examples:'Ganti keyboard (TKT-181), instal ulang (TKT-184).'},
  {grade:'B',points:4,level:'Diagnosis lanjutan',scope:'Diagnosis lintas subsistem atau pekerjaan infrastruktur terbatas.',examples:'Kamera IP + PoE (TKT-123), mainboard + sensor (TKT-149).'},
  {grade:'A',points:8,level:'Integrasi sistem',scope:'Paket integrasi standar beserta pengujian sistem.',examples:'4 kamera IP + perekam (TKT-120), paket 8 kamera (TKT-147).'},
  {grade:'S',points:16,level:'Proyek kompleks',scope:'Proyek di atas paket standar; perlu bukti titik, jalur, integrasi, atau tahapan.',examples:'25 kamera (TKT-083), 8 kamera + kabel 250 m (TKT-R-012).'}
];
function namaPenilaian_(value){return String(value||'').trim().toLowerCase().replace(/\s+/g,' ');}
function teksPenilaian_(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function angkaPenilaian_(value){return Number(value||0).toLocaleString('id-ID',{maximumFractionDigits:4});}
function statusPenilaian_(value){return ({pending:'Menunggu persetujuan',approved:'Disahkan',rejected:'Ditolak',default:'Bagi rata bawaan'})[value]||'Belum dinilai';}
function pengelolaPenilaian_(){return ['admin','admin_raha','manager','direktur'].includes(rolePengguna());}
function penerimaPenilaian_(ticket){const name=namaPenilaian_(penggunaAktif?.['Nama Asli']);return String((ticket.Teknisi||'')+','+(ticket['Teknisi Sebelumnya']||'')).split(/[,;\n]/).some(n=>namaPenilaian_(n)===name)||(ticket['Penilaian Teknisi']?.allocation?.members||[]).some(m=>namaPenilaian_(m.name)===name);}
function tombolPenilaian_(id,section,label){return `<button type="button" class="assessment-button" onclick="bukaPenilaianTiket_('${id}','${section}')">${label}</button>`;}
function bagiRataPenilaian_(ticket){
  const names=new Map();String(ticket.Teknisi||'').split(/[,;\n\r]/).forEach(name=>{const key=namaPenilaian_(name);if(key&&!['-','belum ditugaskan'].includes(key)&&!names.has(key))names.set(key,String(name).trim());});
  const sorted=[...names.keys()].sort(),count=sorted.length;
  return sorted.map((key,index)=>({name:names.get(key),share:(Math.floor(1000000/count)+(index<1000000%count?1:0))/10000}));
}
function tanpaGradePenilaian_(ticket){
  return ['excluded','review_required'].includes(ticket['Penilaian Teknisi']?.technicianPoints?.status)||['outsource','cancel','batal'].includes(namaPenilaian_(ticket.Status))||['garansi','free','gratis'].includes(namaPenilaian_(ticket['No Transaksi']??ticket.no_transaksi));
}
function batasGradeAwalPenilaian_(ticket){
  const time=Date.parse(ticket['Waktu Selesai']||'');if(!Number.isFinite(time))return null;
  const wita=new Date(time+8*3600000);
  return Date.UTC(wita.getUTCFullYear(),wita.getUTCMonth()+1,7)-8*3600000;
}
function gradeAwalTertutupPenilaian_(ticket){
  const a=ticket['Penilaian Teknisi'];
  if(namaPenilaian_(ticket.Status)!=='selesai'||a?.achievement||a?.grade?.status==='approved')return false;
  const deadline=batasGradeAwalPenilaian_(ticket);return deadline===null||Date.now()>=deadline;
}
function htmlPenilaianTiket_(ticket){
  if(!['admin','admin_raha','manager','direktur','teknisi','freelance'].includes(rolePengguna()))return '';
  const id=String(ticket['ID Tiket']||'');if(!/^TKT-[A-Za-z0-9-]{1,100}$/.test(id))return '';
  const a=ticket['Penilaian Teknisi'],g=a?.grade,allocation=a?.allocation;
  const exempt=tanpaGradePenilaian_(ticket),gradeClosed=gradeAwalTertutupPenilaian_(ticket),gradeDeadline=batasGradeAwalPenilaian_(ticket);
  const excluded=['cancel','batal','outsource'].includes(namaPenilaian_(ticket.Status))||!!(ticket['Garansi Asal']||ticket.garansi_asal||ticket['Referensi Tiket Asal']||ticket.referensi_tiket_asal);
  const policy=a?.technicianPoints,blocked=['excluded','review_required'].includes(policy?.status);
  const frozen=!!a?.achievement,paid=!!a?.bonusSnapshot;
  const label=blocked?(policy.status==='review_required'?'Tinjau kontribusi · bonus & pencapaian 0':'Tanpa kontribusi teknisi · bonus & pencapaian 0'):exempt?'Tidak perlu grade · 0 poin pencapaian':g?`${g.value} · ${g.points} poin · ${statusPenilaian_(g.status)}`:'Grade belum dinilai';
  const recipient=penerimaPenilaian_(ticket),manager=pengelolaPenilaian_();
  const canReview=manager&&!recipient;
  const request=a?.gradeRequest?.status==='pending'?a.gradeRequest:g?.status==='pending'?g:null;
  const canEditGrade=!exempt&&!gradeClosed&&(!manager||canReview);
  const gradeActor=g?.status==='approved'?`Ditetapkan oleh: ${g.reviewedName||'-'}`:g?.status==='pending'?`Diajukan oleh: ${g.proposedName||'-'} · Menunggu keputusan admin cabang.`:'';
  const automatic=!allocation||allocation.status==='default';
  const members=paid?a.bonusSnapshot.members:automatic&&!frozen?bagiRataPenilaian_(ticket):allocation?.members||[];
  const allocationLabel=automatic?'Bagi rata otomatis · tidak perlu diisi':`${allocation.mode==='custom'?'Persentase khusus':'Bagi rata'} · ${statusPenilaian_(allocation.status)}`;
  const allocationActor=allocation?.status==='approved'?(allocation.automatic?'Pembagian rata dikunci otomatis':`Ditetapkan oleh: ${allocation.approvedName||'-'}`):allocation?.status==='pending'?`Diajukan oleh: ${allocation.proposedName||'-'}`:'';
  const parts=members.map(m=>`<li><span>${teksPenilaian_(m.name)}</span><strong>${angkaPenilaian_(m.share)}%</strong></li>`).join('');
  const lockedLegacy=!a&&ticket['Status Pembayaran']==='Lunas';
  return `<details class="ticket-assessment"><summary><span><strong>Penilaian pekerjaan</strong><small>${teksPenilaian_(label)}</small></span><span>⌄</span></summary><div class="assessment-body">
    <div class="assessment-row"><div><strong>Hak poin teknisi</strong><small>${blocked?teksPenilaian_(policy.status==='review_required'?'Poin ditahan sampai admin memastikan kontribusi teknisi.':'Tanpa kontribusi teknisi: bonus dan pencapaian tidak dihitung.'):'Poin mengikuti kontribusi teknisi, grade, dan aturan bonus.'}</small>${policy?.reason?`<small>Alasan: ${teksPenilaian_(policy.reason)}</small>`:''}${policy?.reviewedName?`<small>Dicatat oleh: ${teksPenilaian_(policy.reviewedName)}</small>`:''}</div>${canReview?tombolPenilaian_(id,'technicianPoints',policy?.status==='review_required'?'Tinjau kontribusi':'Atur poin teknisi'):''}</div>
    ${exempt?'<div class="assessment-row"><div><strong>Grade &amp; poin pencapaian</strong><small>Tidak perlu diisi pada tiket yang dikecualikan atau menunggu tinjauan kontribusi. Poin pencapaian: 0.</small></div></div>':`<div class="assessment-row"><div><strong>Grade &amp; poin pencapaian</strong><small>${g?teksPenilaian_(g.reason):'D=1 · C=2 · B=4 · A=8 · S=16. Tetapkan setelah diagnosis.'}</small>${gradeActor?`<small>${teksPenilaian_(gradeActor)}</small>`:''}${g?.reviewNote?`<small>Catatan peninjau: ${teksPenilaian_(g.reviewNote)}</small>`:''}${request?`<small>Pengajuan ${teksPenilaian_(request.value)} oleh ${teksPenilaian_(request.proposedName)} menunggu keputusan admin. ${frozen?'Poin sah tetap berlaku.':''}</small>`:''}${a?.gradeRequest?.status==='rejected'?`<small>Pengajuan revisi ditolak: ${teksPenilaian_(a.gradeRequest.reviewNote)}</small>`:''}${manager&&recipient?'<small>Anda tercatat sebagai pelaksana tiket; minta admin lain menetapkan atau merevisi grade.</small>':''}</div>${canEditGrade?tombolPenilaian_(id,'grade',manager?'Revisi':'Pengajuan'):''}</div>`}
    <div class="assessment-row"><div><strong>Kontribusi teknisi · opsional</strong><small>${paid?'Pembagian dikunci saat bonus cair':teksPenilaian_(allocationLabel)}</small>${allocationActor?`<small>${teksPenilaian_(allocationActor)}</small>`:''}${allocation?.reviewNote?`<small>${teksPenilaian_(allocation.reviewNote)}</small>`:''}</div>${!blocked&&!frozen&&!paid&&!lockedLegacy&&(!manager||canReview)?tombolPenilaian_(id,'allocation',manager?'Tetapkan kontribusi':'Atur kontribusi'):''}${!blocked&&canReview&&allocation&&!frozen&&!paid&&allocation.status==='pending'?tombolPenilaian_(id,'reviewAllocation','Tinjau pembagian'):''}</div>
    ${parts?`<ul class="assessment-parts">${parts}</ul>`:''}
    <p class="assessment-help">${blocked?'Bonus dan pencapaian teknisi tidak dihitung. Perubahan status tiket tidak membuka kembali poin; keputusan admin tetap tercatat.':exempt?'Kontribusi bersifat opsional dan mengikuti aturan bonus yang berlaku.':'Tanpa pengisian, poin pencapaian dan bonus dibagi rata kepada teknisi pada tiket. Persentase khusus berlaku setelah ditetapkan admin. Bonus tetap mengikuti pelunasan, SLA dan Veto Admin.'}</p>
    ${blocked?'<p class="assessment-help">Poin bonus teknisi: 0 · Poin pencapaian teknisi: 0.</p>':excluded||exempt?'<p class="assessment-help">Tiket garansi, Cancel/Batal, Outsource, dan transaksi Free/Gratis: 0 poin pencapaian. Pembagian bonus tetap mengikuti aturan yang berlaku.</p>':a?.achievement?`<p class="assessment-posted">Pencapaian disahkan${a.achievement.automatic?' otomatis':''}: ${angkaPenilaian_(a.achievement.points)} poin · ${teksPenilaian_(a.achievement.approvedName)}</p>`:'<p class="assessment-help">Pencapaian disahkan otomatis setelah pekerjaan selesai, BA/PIC/tanda tangan lengkap, serta grade dan pembagian sah.</p>'}
    ${!exempt&&namaPenilaian_(ticket.Status)==='selesai'&&!a?.achievement&&g?.status!=='approved'?`<p class="assessment-help">${gradeDeadline===null?'Lengkapi waktu selesai sebelum pengisian grade.':(gradeClosed?'Masa pengisian grade awal sudah ditutup. Batas: sebelum ':'Grade awal dapat diisi atau diajukan sebelum ')+new Date(gradeDeadline).toLocaleDateString('id-ID',{timeZone:'Asia/Makassar',day:'numeric',month:'long',year:'numeric'})+' pukul 00.00 WITA.'}</p>`:''}
    ${lockedLegacy?'<p class="assessment-help">Tiket sudah cair: pembagian historis dipertahankan.</p>':''}
    <p class="assessment-help">Kredit performa mulai November 2026, setelah rekap bulanan disahkan. <a href="performa.html">Lihat rekap pencapaian &amp; kredit</a>.</p>
    ${typeof htmlKonteksPekerjaan_==='function'?htmlKonteksPekerjaan_(ticket):''}
  </div></details>`;
}
async function panggilPenilaianTiket_(id,action,revision=0,data={}){
  const token=await pastikanTokenSupabaseAktif_();
  const response=await fetch(SUPABASE_URL+'/functions/v1/sla-ticket-assessment',{method:'POST',headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({idTiket:id,action,revision,data}),signal:AbortSignal.timeout(30000)});
  const result=await response.json();if(!response.ok||result.status!=='sukses')throw new Error(result.pesan||'Penilaian belum tersimpan.');
  return result;
}
function modalPenilaian_(){
  let modal=document.getElementById('ticket-assessment-modal');if(modal)return modal;
  modal=document.createElement('div');modal.id='ticket-assessment-modal';modal.className='modal';modal.style.display='none';
  modal.innerHTML='<section class="assessment-dialog" role="dialog" aria-modal="true" aria-labelledby="assessment-title"><header><h3 id="assessment-title"></h3><button type="button" id="assessment-close" aria-label="Tutup penilaian">✕</button></header><div id="assessment-content"></div><p id="assessment-error" role="alert" hidden></p></section>';
  document.body.appendChild(modal);
  modal.querySelector('#assessment-close').addEventListener('click',tutupPenilaianTiket_);
  modal.addEventListener('keydown',e=>{if(e.key==='Escape'&&!penilaianTiketUI_.busy)tutupPenilaianTiket_();if(e.key==='Tab'){const controls=[...modal.querySelectorAll('button,input,textarea,select')].filter(el=>!el.disabled&&el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}});
  return modal;
}
function tutupPenilaianTiket_(){if(penilaianTiketUI_.busy)return;penilaianTiketUI_.generation++;document.getElementById('ticket-assessment-modal').style.display='none';penilaianTiketUI_.focus?.focus();}
async function bukaPenilaianTiket_(id,section='grade'){
  if(penilaianTiketUI_.busy)return;
  const modal=modalPenilaian_(),generation=++penilaianTiketUI_.generation;penilaianTiketUI_.context=null;penilaianTiketUI_.focus=document.activeElement;
  modal.style.display='flex';modal.querySelector('#assessment-title').textContent=id+' · Penilaian';modal.querySelector('#assessment-content').textContent='Memuat penilaian…';modal.querySelector('#assessment-error').hidden=true;
  try{
    const result=await panggilPenilaianTiket_(id,'read');
    if(generation!==penilaianTiketUI_.generation||modal.style.display==='none')return;
    const ticket=(globalTickets||[]).find(t=>t['ID Tiket']===id);if(!ticket)throw new Error('Tiket tidak ditemukan pada cabang aktif.');
    ticket['Penilaian Teknisi']=result.assessment;
    if(['grade','reviewGrade','post'].includes(section)&&(result.gradeRequired===false||result.gradeClosed))throw new Error(result.gradeRequired===false?'Tiket ini tidak perlu grade dan tidak mendapat poin pencapaian.':'Masa pengisian grade awal sudah berakhir sebelum tanggal 7 bulan berikutnya.');
    penilaianTiketUI_.context={id,section,ticket,...result};
    isiModalPenilaian_();modal.querySelector('select,input,textarea,button')?.focus();
  }catch(e){if(generation!==penilaianTiketUI_.generation)return;modal.querySelector('#assessment-content').textContent='';galatPenilaian_(e.message)}
}
function galatPenilaian_(message){const el=document.getElementById('assessment-error');el.textContent=message;el.hidden=!message;}
function aksiFormPenilaian_(label,action,secondary=false){return `<button type="submit" name="assessment-action" value="${action}" class="assessment-button${secondary?' assessment-secondary':''}">${label}</button>`;}
function isiModalPenilaian_(){
  const ctx=penilaianTiketUI_.context,{section,assessment:a,candidates}=ctx,content=document.getElementById('assessment-content');
  let html='';
  if(section==='technicianPoints'){
    html=`<p class="assessment-help">Gunakan Tanpa kontribusi teknisi untuk pembelian/penggantian sederhana yang diselesaikan tanpa pekerjaan teknisi. Tiket yang kembali dari rekanan harus ditinjau sebelum poin dapat dihitung. Pilihan ini berlaku untuk bonus dan pencapaian, serta dicatat dalam riwayat.</p><label for="assessment-point-mode">Kontribusi teknisi</label><select id="assessment-point-mode" required><option value="">Pilih setelah memeriksa BA</option><option value="excluded"${a?.technicianPoints?.status==='excluded'?' selected':''}>Tanpa kontribusi teknisi · 0 poin</option><option value="eligible">Ada kontribusi teknisi · ikuti grade dan aturan bonus</option></select><label for="assessment-reason">Alasan dan bukti tindakan teknisi</label><textarea id="assessment-reason" rows="3" minlength="10" maxlength="2000" placeholder="Jelaskan tindakan teknisi dan rujukan BA untuk keputusan ini." required></textarea><p class="assessment-help">Mengaktifkan kembali poin memulihkan bobot sebelum penahanan; syarat grade, pelunasan dan SLA tetap berlaku.</p>${aksiFormPenilaian_('Simpan keputusan poin','setTechnicianPoints')}`;
  }else if(section==='grade'){
    const direct=pengelolaPenilaian_();
    const pending=a?.gradeRequest?.status==='pending'?a.gradeRequest:a?.grade?.status==='pending'?a.grade:null,selected=pending||a?.grade;
    html=`${pending?`<p><strong>Pengajuan ${teksPenilaian_(pending.value)} · ${angkaPenilaian_(pending.points)} poin</strong></p><p>${teksPenilaian_(pending.reason)}</p><p class="assessment-help">Pengaju: ${teksPenilaian_(pending.proposedName)}${a?.achievement?' · Poin sah tetap berlaku sampai revisi disetujui.':''}</p>`:''}<label for="assessment-grade">Grade pekerjaan</label><select id="assessment-grade" aria-describedby="assessment-grade-hint" required><option value="">Pilih setelah diagnosis</option>${katalogGradePenilaian_.map(g=>`<option value="${g.grade}"${selected?.value===g.grade?' selected':''}>${g.grade} · ${teksPenilaian_(g.level)} · ${g.points} poin</option>`).join('')}</select><p id="assessment-grade-hint" class="assessment-help" role="status" aria-live="polite"></p><label for="assessment-reason">Diagnosis, lingkup &amp; alasan revisi</label><textarea id="assessment-reason" rows="3" minlength="5" maxlength="2000" required>${teksPenilaian_(selected?.reason||'')}</textarea><p class="assessment-help">${direct?'Revisi langsung berlaku dan riwayat perubahan dicatat. Poin pencapaian disahkan otomatis ketika syarat pekerjaan lengkap.':'Pengajuan menunggu keputusan admin cabang, Manager, atau Direktur. Pengajuan tidak mengubah poin yang sudah sah.'} Bonus yang sudah cair tetap memakai pembagian tersimpan. Jika rekap bulanan berubah, tinjau kembali rekap performa.</p><div class="assessment-buttons">${aksiFormPenilaian_(direct?'Simpan revisi':'Kirim pengajuan','proposeGrade')}${direct&&pending?aksiFormPenilaian_('Setujui pengajuan','approveGrade')+aksiFormPenilaian_('Tolak pengajuan','rejectGrade',true):''}</div>`;
  }else if(section==='reviewGrade'){
    html=`<p><strong>Usulan ${teksPenilaian_(a?.grade?.value)} · ${a?.grade?.points} poin</strong></p><p>${teksPenilaian_(a?.grade?.reason)}</p><p class="assessment-help">Pengaju: ${teksPenilaian_(a?.grade?.proposedName)}</p><label for="assessment-reason">Catatan peninjau · wajib bila ditolak</label><textarea id="assessment-reason" rows="2" maxlength="2000"></textarea><div class="assessment-buttons">${aksiFormPenilaian_('Setujui grade','approveGrade')}${aksiFormPenilaian_('Tolak','rejectGrade',true)}</div>`;
  }else if(section==='allocation'||section==='reviewAllocation'){
    const reviewing=section==='reviewAllocation',custom=a?.allocation?.mode==='custom',lockedCustom=reviewing&&custom,direct=pengelolaPenilaian_()&&!reviewing;
    const members=a?.allocation?.members||[];
    html=`<p class="assessment-help">Tanpa pengisian, pembagian otomatis rata untuk teknisi pada tiket. Atur di sini jika pelaksana atau persentasenya berbeda.</p><label class="assessment-check"><input type="checkbox" id="assessment-custom"${custom?' checked':''}${reviewing?' disabled':''}> Atur persentase khusus · opsional</label><div id="assessment-members">${candidates.map(c=>{const m=members.find(m=>m.username===c.username||namaPenilaian_(m.name)===namaPenilaian_(c.name)),checked=m||((!a||a.allocation?.status==='default')&&c.current);return `<div class="assessment-member"><label class="assessment-check"><input type="checkbox" data-member="${teksPenilaian_(c.username)}"${checked?' checked':''}${lockedCustom?' disabled':''}><span>${teksPenilaian_(c.name)}${c.current?'':' · riwayat penugasan'}</span></label><label class="assessment-share"><input type="number" min="0" max="100" step="0.0001" data-share="${teksPenilaian_(c.username)}" aria-label="Persentase ${teksPenilaian_(c.name)}" value="${m?.share??0}"${!custom||lockedCustom?' disabled':''}>%</label></div>`}).join('')}</div><p class="assessment-total">Total: <output id="assessment-total">100%</output></p><div id="assessment-custom-reason"><label for="assessment-reason">Alasan &amp; rujukan bukti hasil kerja</label><textarea id="assessment-reason" rows="2" maxlength="2000"${lockedCustom?' readonly':''}>${teksPenilaian_(a?.allocation?.reason||'')}</textarea><label class="assessment-check"><input id="assessment-team-confirmed" type="checkbox"${a?.allocation?.teamConfirmed?' checked':''}${lockedCustom?' disabled':''}> Pembagian telah dibahas bersama pelaksana terkait.</label></div><p class="assessment-help">Satu persentase untuk pencapaian dan bonus. Total poin tiket serta tarif rupiah dan syarat pencairan bonus mengikuti aturan yang ada.</p>${reviewing?`<label for="assessment-review-note">Catatan peninjau · wajib bila ditolak</label><textarea id="assessment-review-note" rows="2" maxlength="2000"></textarea><div class="assessment-buttons">${aksiFormPenilaian_('Sahkan pembagian','approveAllocation')}${a?.allocation?.status==='pending'?aksiFormPenilaian_('Tolak','rejectAllocation',true):''}</div>`:aksiFormPenilaian_(direct?'Tetapkan kontribusi':'Ajukan pembagian','proposeAllocation')}`;
  }
  content.innerHTML=`<form id="assessment-form">${html}</form>`;
  const form=content.querySelector('form');form.addEventListener('submit',simpanPenilaianTiket_);
  content.querySelector('#assessment-grade')?.addEventListener('change',hintGradePenilaian_);hintGradePenilaian_();
  if(content.querySelector('#assessment-custom')){content.querySelector('#assessment-custom').addEventListener('change',()=>hitungPembagianPenilaian_(true));content.querySelector('#assessment-members').addEventListener('input',()=>hitungPembagianPenilaian_(false));hitungPembagianPenilaian_(false)}
}
function hintGradePenilaian_(){
  const select=document.getElementById('assessment-grade'),hint=document.getElementById('assessment-grade-hint');if(!select||!hint)return;
  const grade=katalogGradePenilaian_.find(g=>g.grade===select.value);
  hint.textContent=grade?`${grade.grade} · ${grade.level} · ${grade.points} poin pencapaian. ${grade.scope} Contoh: ${grade.examples}`:'Pilih grade untuk melihat lingkup dan contoh pekerjaan. Batas grade mengikuti lingkup dan diagnosis, bukan harga part, lamanya pekerjaan, atau jumlah anggota.';
}
function hitungPembagianPenilaian_(initialize){
  const ctx=penilaianTiketUI_.context,form=document.getElementById('assessment-form');
  const custom=form.querySelector('#assessment-custom').checked,locked=ctx.section==='reviewAllocation'&&custom;
  const checks=[...form.querySelectorAll('[data-member]')],selected=checks.filter(c=>c.checked),n=selected.length;
  checks.forEach(c=>{const input=[...form.querySelectorAll('[data-share]')].find(x=>x.dataset.share===c.dataset.member);input.disabled=!custom||!c.checked||locked;if(!custom||initialize){const index=selected.indexOf(c);input.value=index<0?0:(Math.floor(1000000/n)+(index<1000000%n?1:0))/10000;}});
  const reason=form.querySelector('#assessment-custom-reason');reason.hidden=!custom;reason.querySelector('textarea').required=custom&&!locked;reason.querySelector('input').required=custom&&!locked;
  const total=selected.reduce((v,c)=>v+Number([...form.querySelectorAll('[data-share]')].find(x=>x.dataset.share===c.dataset.member).value),0);form.querySelector('#assessment-total').textContent=angkaPenilaian_(total)+'%';
}
async function simpanPenilaianTiket_(event){
  event.preventDefault();if(penilaianTiketUI_.busy)return;
  const ctx=penilaianTiketUI_.context,form=event.target,action=event.submitter?.value;if(!action)return;
  const data={reason:form.querySelector('#assessment-review-note')?.value.trim()??form.querySelector('#assessment-reason')?.value.trim()??''};
  if(action.startsWith('reject')&&data.reason.length<5)return galatPenilaian_('Isi alasan penolakan minimal 5 karakter.');
  if(action==='proposeGrade')data.grade=form.querySelector('#assessment-grade').value;
  if(action==='setTechnicianPoints'){data.mode=form.querySelector('#assessment-point-mode').value;if(data.reason.length<10)return galatPenilaian_('Isi alasan dan bukti minimal 10 karakter.');}
  if(['proposeAllocation','approveAllocation'].includes(action)){
    data.mode=form.querySelector('#assessment-custom').checked?'custom':'equal';
    data.members=[...form.querySelectorAll('[data-member]')].filter(c=>c.checked).map(c=>({username:c.dataset.member,share:Number([...form.querySelectorAll('[data-share]')].find(i=>i.dataset.share===c.dataset.member).value)}));
    data.teamConfirmed=!!form.querySelector('#assessment-team-confirmed')?.checked;
    if(!data.members.length||data.members.some(m=>!Number.isFinite(m.share)||m.share<0||m.share>100)||Math.abs(data.members.reduce((v,m)=>v+m.share,0)-100)>.000001)return galatPenilaian_('Pilih pelaksana dan pastikan total kontribusi 100%.');
  }
  penilaianTiketUI_.busy=true;galatPenilaian_('');form.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{
    const result=await panggilPenilaianTiket_(ctx.id,action,ctx.assessment?.revision||0,data);ctx.ticket['Penilaian Teknisi']=result.assessment;
    const message=action==='setTechnicianPoints'?(data.mode==='excluded'?'Tanpa kontribusi teknisi dicatat. Bonus dan pencapaian teknisi: 0.':'Kontribusi dikonfirmasi. Poin mengikuti grade dan aturan bonus.') : action==='proposeGrade'?(pengelolaPenilaian_()?'Revisi tersimpan. Pencapaian disahkan otomatis jika syarat lengkap.':'Pengajuan terkirim. Menunggu keputusan admin cabang.'):action==='approveGrade'?'Pengajuan disetujui. Pencapaian disahkan otomatis jika syarat lengkap.':action==='rejectGrade'?'Pengajuan ditolak. Poin sah sebelumnya tetap berlaku.':action==='proposeAllocation'?(result.assessment?.allocation?.status==='approved'?'Kontribusi ditetapkan dan langsung disahkan.':'Pembagian diajukan. Menunggu keputusan admin cabang.'):action==='approveAllocation'?'Pengajuan kontribusi disetujui.':'Penilaian tersimpan; periksa status pada tiket.';
    penilaianTiketUI_.busy=false;tutupPenilaianTiket_();showToast(message,'success');
    await ambilSemuaData(true);
  }catch(e){penilaianTiketUI_.busy=false;form.querySelectorAll('button').forEach(b=>b.disabled=false);galatPenilaian_(e.message+' Jika data berubah, tutup lalu buka kembali penilaian.');}
}
