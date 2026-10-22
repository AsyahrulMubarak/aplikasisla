/* Structured operational context; existing status, BA, tracking and WA handlers remain in index.html. */
const kategoriKonteksTiket_={pending:[['client_approval','Menunggu persetujuan klien'],['site_unavailable','Lokasi belum siap / tidak dapat diakses'],['parts_vendor','Menunggu komponen / vendor'],['technical_internal','Kendala teknis internal'],['other','Lainnya · perlu penjelasan']],replacement:[['rotation_schedule','Penyesuaian jadwal / rotasi'],['specialist_support','Butuh keahlian tambahan'],['client_request','Permintaan klien'],['execution_issue','Kendala pelaksanaan · perlu tinjauan'],['other','Lainnya · perlu penjelasan']]};
const konteksTiketUI_={pendingRequest:null,replacementRequest:null,pendingTicket:null,replacementTicket:null};
const amanKonteksTiket_=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function namaKonteksTiket_(v){return [...new Set(String(v||'').split(/[,;\r\n]/).map(n=>n.trim().toLowerCase().replace(/\s+/g,' ')).filter(n=>n&&!['-','belum ditugaskan'].includes(n)))].sort().join('|');}
function opsiKonteksTiket_(kind){return '<option value="">Pilih '+(kind==='pending'?'kategori':'alasan')+'</option>'+kategoriKonteksTiket_[kind].map(([v,label])=>'<option value="'+v+'">'+label+'</option>').join('');}
function labelKonteksTiket_(kind,value){return kategoriKonteksTiket_[kind]?.find(([v])=>v===value)?.[1]||value||'Belum diisi';}
function waktuKonteksTiket_(value){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString('id-ID',{timeZone:'Asia/Makassar',dateStyle:'medium',timeStyle:'short'})+' WITA';}
function pasangFormPending_(){
 let el=document.getElementById('workflow-pending');if(el)return el;
 el=document.createElement('section');el.id='workflow-pending';el.className='workflow-fields';el.hidden=true;
 el.innerHTML='<h4>Alasan pending</h4><label for="workflow-pending-category">Kategori kendala</label><select id="workflow-pending-category">'+opsiKonteksTiket_('pending')+'</select><label for="workflow-pending-evidence">Rujukan bukti kendala</label><textarea id="workflow-pending-evidence" rows="2" minlength="5" maxlength="2000" placeholder="Catatan komunikasi / nomor permintaan komponen"></textarea><p>SLA tetap memakai mekanisme jeda yang ada. Kategori menjadi bahan tinjauan; tidak langsung memberi pengecualian atau penalti.</p>';
 document.getElementById('update-keterangan')?.insertAdjacentElement('afterend',el);return el;
}
function tampilkanFormPending_(){const el=pasangFormPending_(),active=document.getElementById('update-status')?.value==='Pending';el.hidden=!active;el.querySelectorAll('select,input,textarea').forEach(n=>{n.disabled=!active;n.required=active;});}
function mulaiKonteksPending_(id){
 const el=pasangFormPending_();el.querySelectorAll('input,select,textarea').forEach(n=>n.value='');konteksTiketUI_.pendingRequest=crypto.randomUUID();konteksTiketUI_.pendingTicket=id;
 const t=(globalTickets||[]).find(t=>t['ID Tiket']===id),last=(t?.['Konteks Pekerjaan']?.events||[]).filter(e=>e.kind==='pending'&&!e.closedAt).at(-1);
 if(last){document.getElementById('workflow-pending-category').value=last.category;document.getElementById('workflow-pending-evidence').value=last.evidence||'';}
 tampilkanFormPending_();
}
function pasangFormPergantian_(){let el=document.getElementById('workflow-replacement');if(el)return el;el=document.createElement('section');el.id='workflow-replacement';el.className='workflow-fields';el.hidden=true;
 el.innerHTML='<h4>Alasan pergantian & serah terima</h4><p id="workflow-replacement-from"></p><label for="workflow-replacement-category">Alasan</label><select id="workflow-replacement-category">'+opsiKonteksTiket_('replacement')+'</select><label for="workflow-replacement-reason">Penjelasan pergantian</label><textarea id="workflow-replacement-reason" rows="2" minlength="5" maxlength="2000"></textarea><label for="workflow-replacement-handover">Hasil yang sudah dikerjakan dan sisa pekerjaan</label><textarea id="workflow-replacement-handover" rows="3" minlength="10" maxlength="4000" placeholder="Tindakan yang selesai, hasil pengujian, dan pekerjaan lanjutan"></textarea><p>Riwayat teknisi lama tetap disimpan. Pergantian tidak otomatis menjadi kesalahan atau memindahkan poin yang sudah dikunci. Opsi SLA baru tetap mengikuti kotak Ganti Teknisi di atas.</p>';
 document.getElementById('div-ganti-teknisi')?.insertAdjacentElement('afterend',el);return el;
}
function mulaiKonteksPergantian_(id){const el=pasangFormPergantian_();el.querySelectorAll('select,textarea').forEach(n=>n.value='');konteksTiketUI_.replacementRequest=crypto.randomUUID();konteksTiketUI_.replacementTicket=id;tampilkanFormPergantian_();}
function tampilkanFormPergantian_(){const el=pasangFormPergantian_(),t=(globalTickets||[]).find(t=>t['ID Tiket']===document.getElementById('input-id')?.value),selected=[...document.querySelectorAll('#teknisi-group input:checked')].map(n=>n.value).join(', '),active=!!modeEditTiket&&!!t&&!!namaKonteksTiket_(t.Teknisi)&&(namaKonteksTiket_(t.Teknisi)!==namaKonteksTiket_(selected)||document.getElementById('ganti-teknisi-cek')?.checked);el.hidden=!active;el.querySelectorAll('select,textarea').forEach(n=>{n.disabled=!active;n.required=active;});const from=document.getElementById('workflow-replacement-from');if(from)from.textContent='Dari: '+(t?.Teknisi||'—')+' → '+(selected||'Belum ditugaskan');}
async function panggilAlurTiket_(ticket,action,patch,context,requestId){
 const token=await pastikanTokenSupabaseAktif_(),response=await fetch(SUPABASE_URL+'/functions/v1/sla-ticket-workflow',{method:'POST',headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({idTiket:ticket['ID Tiket'],action,revision:Number(ticket['Versi Workflow'])||0,requestId,patch,context}),signal:AbortSignal.timeout(35000)});
 const result=await response.json();if(!response.ok||result.status!=='sukses')throw Error(result.pesan||'Alasan dan perubahan tiket belum tersimpan.');
 const row=result.data?.[0];if(!row)throw Error('Hasil penyimpanan tiket belum dapat dipastikan. Muat ulang sebelum mencoba kembali.');
 ticket['Konteks Pekerjaan']=row.konteks_pekerjaan;ticket['Versi Workflow']=row.versi_workflow;return result.data;
}
async function simpanStatusDenganKonteks_(id,patch,ticket){
 if(patch.status!=='Pending')return callSupabase(endpointFilterSupabase_('tiket','id_tiket',id),'PATCH',patch);
 const category=document.getElementById('workflow-pending-category')?.value,evidence=document.getElementById('workflow-pending-evidence')?.value.trim(),reason=document.getElementById('update-keterangan')?.value.trim();
 if(!category||!evidence||evidence.length<5||!reason||reason.length<5)throw Error('Lengkapi kategori, rujukan bukti, dan log pending minimal 5 karakter.');

 return panggilAlurTiket_(ticket,'pending',patch,{category,evidence,reason},konteksTiketUI_.pendingRequest||crypto.randomUUID());
}
async function simpanEditDenganKonteks_(id,patch,ticket,ganti){
 const changed=namaKonteksTiket_(ticket.Teknisi)!==namaKonteksTiket_(patch.teknisi);
 if(!changed||!namaKonteksTiket_(ticket.Teknisi))return callSupabase(endpointFilterSupabase_('tiket','id_tiket',id),'PATCH',patch);
 const category=document.getElementById('workflow-replacement-category')?.value,reason=document.getElementById('workflow-replacement-reason')?.value.trim(),handover=document.getElementById('workflow-replacement-handover')?.value.trim();
 if(!category||!reason||reason.length<5||!handover||handover.length<10)throw Error('Lengkapi alasan pergantian serta hasil dan sisa pekerjaan.');
 return panggilAlurTiket_(ticket,'replacement',patch,{category,reason,handover,resetSla:!!ganti},konteksTiketUI_.replacementRequest||crypto.randomUUID());
}
function htmlKonteksPekerjaan_(ticket){
 const events=ticket['Konteks Pekerjaan']?.events||[];if(!events.length)return '';
 const articles=events.map(e=>{
  const detail=e.kind==='pending'
   ? (e.closedAt?'<p>Dilanjutkan: '+amanKonteksTiket_(waktuKonteksTiket_(e.closedAt))+'</p>':'')
   : '<p>'+amanKonteksTiket_(e.from)+' → '+amanKonteksTiket_(e.to)+'</p><p>'+amanKonteksTiket_(e.handover)+'</p>';
  return '<article><strong>'+amanKonteksTiket_(labelKonteksTiket_(e.kind,e.category))+'</strong><small>'+amanKonteksTiket_(waktuKonteksTiket_(e.at))+' · '+amanKonteksTiket_(e.actorName)+'</small><p>'+amanKonteksTiket_(e.reason)+'</p>'+detail+(e.kind==='pending'&&e.evidence?'<small>Bukti: '+amanKonteksTiket_(e.evidence)+'</small>':'')+'<small>Sebab menunggu tinjauan penilaian</small></article>';
 });
 return '<details class="workflow-history"><summary>Alasan pending & serah terima · '+events.length+' catatan</summary>'+articles.join('')+'</details>';
}
const bukaModalUpdateAwal_=bukaModalUpdate;bukaModalUpdate=function(id){bukaModalUpdateAwal_(id);mulaiKonteksPending_(id);};
const cekKeteranganAwal_=cekKeterangan;cekKeterangan=function(){cekKeteranganAwal_();tampilkanFormPending_();};
const aktifkanEditTiketAwal_=aktifkanEditTiket;aktifkanEditTiket=function(id){aktifkanEditTiketAwal_(id);mulaiKonteksPergantian_(id);};
const batalEditTiketAwal_=batalEditTiket;batalEditTiket=function(){batalEditTiketAwal_();tampilkanFormPergantian_();};
document.getElementById('teknisi-group')?.addEventListener('change',tampilkanFormPergantian_);document.getElementById('ganti-teknisi-cek')?.addEventListener('change',tampilkanFormPergantian_);
