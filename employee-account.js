/* Account access is independent of historical payroll and ticket data. */
(() => {
 'use strict';
 const active=u=>u&&u['Akun Aktif']!==false&&!u['Sinkron Akses Akun'];
 const scope=u=>String(u?.Hak_Akses_Cabang||u?.cabang||'').trim().toLowerCase();
 const canManage=u=>penggunaAktif&&['admin','admin_raha'].includes(rolePengguna())&&u.Username!==penggunaAktif.Username&&(scope(penggunaAktif)==='semua'||scope(penggunaAktif)===scope(u))&&(rolePengguna()!=='admin_raha'||scope(u)==='raha');
 let checking=false,changing=false;
 window.periksaSesiAkunPegawai_=async function(){
  if(!penggunaAktif?.SessionToken||checking)return;
  checking=true;
  try{
   const r=await fetch(SUPABASE_URL+'/rest/v1/rpc/sla_assert_account_session',{method:'POST',headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+penggunaAktif.SessionToken,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
   if(r.status===401||r.status===403){
    penggunaAktif=null;globalTickets=[];globalUsers=[];
    sessionStorage.removeItem('sesiLoginSLA');localStorage.removeItem('sesiLoginSLA');
    if(typeof hentikanRealtimeSLA_==='function')hentikanRealtimeSLA_();
    ['app-wrapper','main-lobby-wrapper','klaim-sales-wrapper'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
    if(typeof prosesLogout==='function')prosesLogout();
    throw new Error('Akun nonaktif atau sesi telah dicabut. Silakan hubungi admin atau login ulang.');
   }
   if(!r.ok||await r.json()!==true)throw new Error('Pemeriksaan akses akun belum berhasil. Periksa koneksi dan coba lagi.');
  }finally{checking=false;}
 };
 window.renderTabelUser=function(){
  const body=document.getElementById('tabel-user-body');if(!body)return;body.innerHTML='';
  (globalUsers||[]).filter(dataSesuaiCabangAktif_).forEach(u=>{
   if(!u?.Username)return;const key=kunciProfilUserAman_(u.Username);if(!key)return;
   const pending=u['Sinkron Akses Akun']===true,status=pending?'Nonaktif · sinkronisasi tertunda':active(u)?'Aktif':'Nonaktif';
   const button=canManage(u)?`<button type="button" class="${active(u)?'btn-del':'btn-edit'}" data-account-key="${amanTeks_(key)}">${pending?'Coba sinkron ulang':active(u)?'Nonaktifkan':'Aktifkan kembali'}</button>`:'';
   const edit=rolePengguna()==='admin'&&scope(penggunaAktif)!=='raha'||u.Username===penggunaAktif?.Username?`<button class="btn-edit" onclick="aktifkanEditUser('${key}')">Edit</button>`:'';
   tambahkanHtmlAman_(body,`<tr><td><strong>${amanTeks_(u.Username)}</strong></td><td>${amanTeks_(u['Nama Asli'])}</td><td>${amanTeks_(u['No WA']||'-')}</td><td>${amanTeks_(u.Role)}</td><td>${amanTeks_(status)}</td><td><div class="btn-grid" style="margin:0">${edit}${button}</div></td></tr>`);
  });
  body.querySelectorAll('[data-account-key]').forEach(b=>b.addEventListener('click',()=>ubahStatus(b.dataset.accountKey)));
 };
 async function ubahStatus(key){
  if(changing)return;const u=cariUserDariKunciProfil_(key);if(!u||!canManage(u))return;
  const pending=u['Sinkron Akses Akun']===true,next=pending?u['Permintaan Akun Aktif']===true:!active(u);
  const reason=await showPrompt((pending?'Alasan mengulangi sinkronisasi':next?'Alasan mengaktifkan kembali':'Alasan menonaktifkan')+' akun '+u.Username+':');
  if(reason===null||reason===undefined)return;
  if(reason.trim().length<3||reason.trim().length>1000){showToast('Isi alasan 3 sampai 1000 karakter.','error');return;}
  const message=next?'Aktifkan kembali akun '+u.Username+'? Pegawai harus login ulang.':'Nonaktifkan akun '+u.Username+'? Login dan sesi lama diblokir. Tiket, bonus, slip gaji, dan kredit tetap tersimpan. Tiket yang masih berjalan dapat dialihkan melalui Edit Detail.';
  if(!await showConfirm(message))return;
  changing=true;document.querySelectorAll('[data-account-key]').forEach(b=>b.disabled=true);
  try{
   const result=await kirimProfilSupabase_('setAccountAccess',{usernameTarget:u.Username,active:next,version:Number(u['Versi Akses Akun']||0),reason:reason.trim()});
   showToast(result.pesan,result.pending?'warning':'success');await ambilSemuaData(true);
  }catch(e){showToast(e.message||'Status akun belum terkonfirmasi. Muat ulang daftar pegawai.','error');}
  finally{changing=false;renderTabelUser();}
 }
 // A foreground tab clears its rendered data promptly; server checks enforce
 // revocation on every request, independent of this timer or client JavaScript.
 setInterval(()=>{if(penggunaAktif&&document.visibilityState!=='hidden')periksaSesiAkunPegawai_().catch(()=>{});},20000);
 window.addEventListener('focus',()=>{if(penggunaAktif)periksaSesiAkunPegawai_().catch(()=>{});});
 document.addEventListener('visibilitychange',()=>{if(penggunaAktif&&document.visibilityState==='visible')periksaSesiAkunPegawai_().catch(()=>{});});
})();

