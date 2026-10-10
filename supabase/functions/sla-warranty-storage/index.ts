// @ts-nocheck
const BASE=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const KEYS=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const SECRET=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||KEYS.default;
const DAY=86400000;
function storageDays(ready,now=new Date()){
  const date=d=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Makassar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d));
  return Math.round((Date.parse(date(now)+'T00:00:00Z')-Date.parse(date(ready)+'T00:00:00Z'))/DAY);
}
function headers(){const h={apikey:SECRET,'Content-Type':'application/json'};if(!String(SECRET).startsWith('sb_secret_'))h.Authorization='Bearer '+SECRET;return h;}
async function rest(path,body){
  const r=await fetch(BASE+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers:headers(),body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw new Error('Penyimpanan notifikasi belum berhasil.');
  return r.json();
}
async function jobAuthorized(request){
  const key=request.headers.get('x-sla-job-key')||'';
  if(!key)return false;
  if(new Set([SECRET,...Object.values(KEYS)]).has(key))return true;
  if(!key.startsWith('sb_secret_'))return false;
  const r=await fetch(BASE+'/rest/v1/sla_notif_penitipan?select=id&limit=1',{headers:{apikey:key},signal:AbortSignal.timeout(15000)});
  return r.ok;
}
function reminder(g,t){
  const deadline=new Date(new Date(g.waktu_siap_diambil).getTime()+7*DAY).toLocaleDateString('id-ID',{timeZone:'Asia/Makassar'})+' pukul 23.59';
  return `Assalamu'alaikum Kak ${g.nama_pelanggan||t.klien_lokasi||'Pelanggan'},\n\n*PEMBERITAHUAN ALFACOM — HARI KE-5*\nBarang servis Anda (${g.barang_jasa||t.jenis_pekerjaan||'-'}) sudah siap diambil.\n\nMohon diambil paling lambat ${deadline} WITA. Setelah melewati 7 hari sejak servis selesai, garansi otomatis hangus dan biaya penitipan Rp 1.000/hari mulai berjalan (hari ke-8). Kerusakan yang sama saat pengambilan tidak tercover garansi setelah batas tersebut. Aktivasi oleh admin tidak memperbarui garansi yang sudah hangus.\n\nPantau status: https://aplikasisla.vercel.app/?track=${encodeURIComponent(g.referensi_tiket_nota)}`;
}
async function processStorage(){
  await rest('rpc/sla_perbarui_penitipan',{});
  const result={status:'sukses',terkirim:0,gagal:0,dilewati:0};
  const token=Deno.env.get('FONNTE_TOKEN')||Deno.env.get('FONNTE_TOKEN_CADANGAN')||'';
  if(!token)return {...result,notifikasiTertunda:true};
  const events=await rest('rpc/sla_ambil_notif_penitipan',{});
  for(const e of events){
    let success=false,galat='';
    try{
      const rows=await rest('garansi?id_garansi=eq.'+encodeURIComponent(e.id_garansi)+'&select=id_garansi,referensi_tiket_nota,nama_pelanggan,barang_jasa,cabang,status,waktu_diambil,waktu_siap_diambil&limit=1');
      const g=rows[0],now=new Date();
      if(!g||g.waktu_diambil||!['Masa Tunggu','Belum Diambil'].includes(g.status)||!g.waktu_siap_diambil||storageDays(g.waktu_siap_diambil,now)>7){
        success=true;result.dilewati++;
      }else{
        const tickets=await rest('tiket?id_tiket=eq.'+encodeURIComponent(g.referensi_tiket_nota)+'&cabang=eq.'+encodeURIComponent(g.cabang||'Kendari')+'&select=no_wa_klien,klien_lokasi,jenis_pekerjaan&limit=1');
        const t=tickets[0];
        const phone=String(t?.no_wa_klien||'').replace(/\D/g,'').replace(/^0/,'62');
        if(!/^62\d{8,13}$/.test(phone))throw new Error('Nomor WhatsApp pelanggan belum valid.');
        const r=await fetch('https://api.fonnte.com/send',{method:'POST',headers:{Authorization:token},body:new URLSearchParams({target:phone,message:reminder(g,t),countryCode:'62'}),signal:AbortSignal.timeout(15000)});
        const data=await r.json();if(!r.ok||data.status!==true)throw new Error('Provider WhatsApp menolak notifikasi.');
        success=true;result.terkirim++;
      }
    }catch{galat='Notifikasi penitipan belum terkirim.';result.gagal++;}
    await rest('rpc/sla_selesai_notif_penitipan',{p_id:e.id,p_lease:e.lease,p_sukses:success,p_galat:galat});
  }
  return result;
}
Deno.serve(async request=>{
  if(request.method!=='POST')return Response.json({status:'gagal'}, {status:405});
  try{
    if(!await jobAuthorized(request))return Response.json({status:'gagal',pesan:'Akses server diperlukan.'},{status:403});
    return Response.json(await processStorage(),{headers:{'Cache-Control':'no-store','X-SLA-Revision':'warranty-storage-20261010'}});
  }catch{return Response.json({status:'gagal',pesan:'Pemrosesan penitipan belum berhasil.'},{status:503});}
});
