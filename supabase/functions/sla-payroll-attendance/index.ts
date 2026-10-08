// @ts-nocheck
// Payroll and attendance API. No browser-supplied identity or branch is trusted.
const BASE = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
const SECRET_KEYS = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const PUBLIC_KEYS = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || SECRET_KEYS.default;
const PUBLIC = PUBLIC_KEYS.default || Deno.env.get('SUPABASE_ANON_KEY');
const BUCKET = 'sla-attendance-private';
const PAYROLL_EVIDENCE_BUCKET = 'sla-payroll-private';
const PAYROLL_PDF_MAX_BYTES = 5 * 1024 * 1024;
const ORIGINS = new Set([
  'https://aplikasisla.vercel.app',
  'https://aplikasisla-git-codex-supabase-ce8793-asyahrulmubaraks-projects.vercel.app'
]);
const HEADERS_ABSEN = ['Waktu Absen', 'Nama Pegawai', 'Tipe Absen', 'Keterangan', 'Status Disiplin', 'Kembali Bekerja', 'Bukti Foto', 'Lokasi Maps'];
const OFFICE = {
  Kendari: { lat: -3.9641006831731826, lon: 122.54316001476751 },
  Raha: { lat: -4.8268920873652625, lon: 122.72467110301972 }
};

function cors(origin) {
  return { 'Access-Control-Allow-Origin': ORIGINS.has(origin) ? origin : 'https://aplikasisla.vercel.app',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Cache-Control': 'no-store', Vary: 'Origin', 'X-SLA-Revision': 'payroll-grace-seven-days-20261005' };
}
function reply(data, origin, status = 200) { return Response.json(data, { status, headers: cors(origin) }); }
function fail(message, origin, status = 200) { return reply({ status: 'gagal', pesan: message }, origin, status); }
function serviceHeaders(contentType) {
  const h = { apikey: SECRET, 'x-sla-claims-runtime': 'supabase-edge' };
  if (!String(SECRET).startsWith('sb_secret_')) h.Authorization = 'Bearer ' + SECRET;
  if (contentType) h['Content-Type'] = contentType;
  return h;
}
async function rest(table, query = '', method = 'GET', body, prefer = 'return=representation') {
  const url = BASE + '/rest/v1/' + table + (query ? '?' + query : '');
  const response = await fetch(url, { method,
    headers: { ...serviceHeaders(body === undefined ? undefined : 'application/json'), Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    const detail=await response.json().catch(()=>({}));
    const error = new Error(response.status===400 && table.startsWith('rpc/') && detail.message ? detail.message : 'Database ' + table + ' HTTP ' + response.status);
    error.databaseHttpStatus = response.status;
    throw error;
  }
  const raw = await response.text();
  return raw ? JSON.parse(raw) : [];
}
async function allRows(table, query) {
  const out = [];
  for (;;) {
    const page = await rest(table, query + (query ? '&' : '') + 'limit=500&offset=' + out.length);
    if (!Array.isArray(page)) throw new Error('Format data ' + table + ' tidak valid.');
    out.push(...page);
    if (page.length < 500) return out;
    if (out.length > 50000) throw new Error('Terlalu banyak data ' + table + '.');
  }
}
const norm = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const branch = value => /^(kendari|raha)$/i.test(String(value || '')) ? (String(value).toLowerCase() === 'raha' ? 'Raha' : 'Kendari') : '';
const absenceBranchScope = value => value === 'Kendari' ? '&or=(cabang.eq.Kendari,cabang.is.null)' : '&cabang=eq.Raha';
const management = u => ['admin','manager','direktur'].includes(u.role) && !(u.role === 'admin' && (u.homeBranch || u.branch) === 'Raha');
const salaried = u => !!u.name && !!u.branch && Number.isFinite(Number(u.salary)) && Number(u.salary) > 0;
const canAttend = u => u.role === 'direktur' || salaried(u);
const canOwnSlip = u => canAttend(u);
const canPayrollManage = u => canAttend(u) && management(u);
const canManageBranch = (u,target) => u.access === 'Semua' || target === u.branch;
const canManagePayrollBranch = (u,target) => canPayrollManage(u) && (!!branch(target) || target === 'Semua'); const payrollProfileBranch = value => norm(value) === 'semua' ? 'Semua' : branch(value);
const safePeriod = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')) ? String(value) : null;
const encode = encodeURIComponent;
function wita(value = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}
const day = value => wita(value).slice(0, 10);
const minute = value => Number(wita(value).slice(11,13)) * 60 + Number(wita(value).slice(14,16));
const second = value => minute(value) * 60 + Number(wita(value).slice(17,19));
const monthNow = () => day().slice(0,7);
function payrollPeriodLocked(period, now = new Date()) {
  if (!safePeriod(period)) return true;
  const [year,month] = period.split('-').map(Number);
  const next = month === 12 ? String(year + 1).padStart(4,'0') + '-01' : period.slice(0,5) + String(month + 1).padStart(2,'0');
  return day(now) >= next + '-08';
}

const localTime = (d, h, m = 0) => new Date(d + 'T' + String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':00+08:00');
const addDay = (d, n = 1) => day(new Date(localTime(d, 12).getTime() + n * 86400000));
const workDay = r => /Keluar|Pulang/.test(String(r.tipe_absen || '')) && minute(r.waktu_absen) < 360 ? addDay(day(r.waktu_absen), -1) : day(r.waktu_absen);
function policy(u) {
  const rahaHours = u.branch === 'Raha' && u.role !== 'admin_raha' && u.role !== 'admin';
  return { cabang: u.branch, mulaiMenit: 480, selesaiMenit: rahaHours ? 1200 : 1020,
    batasTelatMenit: rahaHours ? 585 : 525, radiusMeter: 100, kantor: OFFICE[u.branch] };
}
function distance(a,lat,lon) {
  const rad = Math.PI / 180, dLat = (lat-a.lat)*rad, dLon=(lon-a.lon)*rad;
  const x=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(lat*rad)*Math.sin(dLon/2)**2;
  return Math.round(6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)));
}
function discipline(type, time, p) {
  if (type === 'Masuk') return minute(time)>p.batasTelatMenit?'Terlambat Masuk':'Tepat Waktu';
  if (type === 'Masuk Setelah Istirahat') return second(time)>48600?'Terlambat Setelah Istirahat':'Tepat Waktu';
  if (type === 'Keluar') return minute(time)>p.selesaiMenit?'Lembur':'Keluar Normal';
  return 'Aman';
}
function canApprove(actor, request) {
  const requestBranch=branch(request.cabang||request.branch)||'Kendari';
  if(actor.access!=='Semua'&&requestBranch!==actor.branch)return false;
  if (norm(actor.role) === 'direktur') return true;
  const adminKendari = x => norm(x.role) === 'admin' && (x.access
    ? ['Semua','Kendari'].includes(x.access) : branch(x.cabang || x.branch) !== 'Raha');
  if (norm(request.role) === 'manager') return adminKendari(actor);
  if (norm(request.role) === 'admin') return norm(actor.role) === 'manager';
  return norm(actor.role) === 'manager' || adminKendari(actor);
}
async function authenticate(request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (token.split('.').length !== 3) throw new Error('Sesi Anda tidak sah atau telah kedaluwarsa.');
  const authResponse = await fetch(BASE + '/auth/v1/user', { headers: { apikey: PUBLIC, Authorization: 'Bearer ' + token } });
  if (!authResponse.ok) throw new Error('Sesi Anda tidak sah atau telah kedaluwarsa.');
  const auth = await authResponse.json();
  if (!auth.id) throw new Error('Sesi Anda tidak sah atau telah kedaluwarsa.');
  const profiles = await rest('users', 'select=username,nama_asli,role,hak_akses_cabang,cabang,gaji_pokok,no_wa,auth_id&auth_id=eq.' + encode(auth.id) + '&limit=2');
  if (profiles.length !== 1) throw new Error('Profil pengguna tidak ditemukan atau tidak unik.');
  const p = profiles[0];
  const emailExpected = norm(p.username).replace(/\s+/g,'') + '@alfacom.local';
  if (String(auth.email || '').toLowerCase() !== emailExpected) throw new Error('Identitas akun tidak cocok dengan profil.');
  const role=norm(p.role),access=String(p.hak_akses_cabang||p.cabang||'').trim();
  const homeBranch=branch(access)||branch(p.cabang)||(role==='manager'||role==='direktur'||role==='admin'?'Kendari':'');
  return { username: p.username, name: p.nama_asli, role,
    branch:homeBranch,homeBranch,
    access, salary: Number(p.gaji_pokok) || 0, phone: p.no_wa || '', authId: auth.id };
}
async function photoUrl(value) {
  if (!String(value || '').startsWith('storage:')) return value || '';
  const path = String(value).slice(8);
  const response = await fetch(BASE + '/storage/v1/object/sign/' + BUCKET + '/' + path.split('/').map(encode).join('/'), {
    method: 'POST', headers: serviceHeaders('application/json'), body: JSON.stringify({ expiresIn: 3600 }) });
  if (!response.ok) return '';
  const signed = await response.json();
  return signed.signedURL ? (signed.signedURL.startsWith('http') ? signed.signedURL : BASE + '/storage/v1' + signed.signedURL) : '';
}
async function photos(rows) {
  return Promise.all(rows.map(async row => ({ ...row, bukti_foto: await photoUrl(row.bukti_foto) })));
}
async function uploadPhoto(base64, prefix, actor) {
  if (String(base64 || '').length > Math.ceil(5*1024*1024/3)*4+64) throw new Error('Foto bukti melebihi batas 5 MB.');
  const match = String(base64 || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Format foto bukti tidak valid.');
  const binary = atob(match[2]);
  if (!binary.length || binary.length > 5*1024*1024) throw new Error('Foto bukti melebihi batas 5 MB.');
  const key = prefix + '/' + actor.authId + '/' + crypto.randomUUID() + (match[1] === 'image/png' ? '.png' : match[1] === 'image/webp' ? '.webp' : '.jpg');
  const response = await fetch(BASE + '/storage/v1/object/' + BUCKET + '/' + key, {
    method: 'POST', headers: { ...serviceHeaders(match[1]), 'x-upsert': 'false' },
    body: Uint8Array.from(binary, c => c.charCodeAt(0)) });
  if (!response.ok) throw new Error('Foto bukti gagal disimpan di Storage.');
  return 'storage:' + key;
}
async function cleanupRejectedPhoto(photo,error) {
  // A timeout can occur after the database commits. Only clean a confirmed rejection.
  if (!String(photo||'').startsWith('storage:') || ![400,401,403,404,409,422].includes(error?.databaseHttpStatus)) return;
  try {
    const response=await fetch(BASE+'/storage/v1/object/'+BUCKET, {
      method:'DELETE',headers:serviceHeaders('application/json'),
      body:JSON.stringify({prefixes:[photo.slice(8)]}),signal:AbortSignal.timeout(10000)
    });
    if(!response.ok)console.error('Pembersihan foto yang ditolak belum berhasil.');
  } catch {console.error('Pembersihan foto yang ditolak tertunda.');}
}
async function migrateLegacyAttendancePhotos() {
  const audit=await allRows('sla_migrasi_foto_absensi','select=*');
  const previous=new Map(audit.map(r=>[r.table_name+':'+r.record_id,r]));
  const candidates=[];
  for(const [table,primary] of [['absensi','id_absen'],['pengajuan_cuti','id_pengajuan']]) {
    const rows=await allRows(table,'select='+primary+',bukti_foto&bukti_foto=like.*drive.google.com*&order='+primary+'.asc');
    for(const r of rows)candidates.push({table,primary,id:r[primary],original:r.bukti_foto});
  }
  const summary={migrated:0,failed:0,changed:0,remaining:candidates.length,needsAttention:0};
  const imported=new Map(),started=Date.now();let count=0;
  for(const item of candidates) {
    const old=previous.get(item.table+':'+item.id);
    if(old?.original===item.original&&old.percobaan>=3){summary.needsAttention++;continue;}
    if(count>=10||Date.now()-started>60000)continue;
    count++;
    const log={table_name:item.table,record_id:item.id,original:item.original,status:'pending',
      percobaan:old?.original===item.original?Number(old.percobaan)+1:1,galat:null,diperbarui_pada:new Date().toISOString()};
    await rest('sla_migrasi_foto_absensi','on_conflict=table_name,record_id','POST',log,'resolution=merge-duplicates,return=representation');
    try {
      const source=new URL(item.original),id=source.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)/)?.[1]||source.searchParams.get('id');
      if(source.protocol!=='https:'||source.hostname!=='drive.google.com'||!/^[A-Za-z0-9_-]{10,200}$/.test(id||''))throw new Error('Tautan Drive tidak valid.');
      let reference=imported.get(id);
      if(!reference) {
        const response=await fetch('https://drive.usercontent.google.com/download?id='+encode(id)+'&export=download',{
          redirect:'follow',signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw new Error('Drive HTTP '+response.status);
        const reader=response.body.getReader(),chunks=[];let length=0;
        try {
          for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;
            if(length>5*1024*1024)throw new Error('Foto lama lebih besar dari 5 MB.');chunks.push(value);}
        } finally {await reader.cancel().catch(()=>{});}
        const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
        let mime='',extension='';
        if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255){mime='image/jpeg';extension='.jpg';}
        else if([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)){mime='image/png';extension='.png';}
        else if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'){mime='image/webp';extension='.webp';}
        if(!mime)throw new Error('Drive belum memberikan foto. Periksa izin atau file sumber.');
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
        const key='legacy/'+digest+extension;
        const uploaded=await fetch(BASE+'/storage/v1/object/'+BUCKET+'/'+key,{method:'POST',
          headers:{...serviceHeaders(mime),'x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(15000)});
        if(!uploaded.ok) {
          const detail=await uploaded.json().catch(()=>({}));
          if(![400,409].includes(uploaded.status)||!/duplicate|already exists/i.test(JSON.stringify(detail)))throw new Error('Storage HTTP '+uploaded.status);
        }
        reference='storage:'+key;imported.set(id,reference);
      }
      const saved=await rest(item.table,item.primary+'=eq.'+encode(item.id)+'&bukti_foto=eq.'+encode(item.original),'PATCH',{bukti_foto:reference});
      log.status=saved.length===1&&saved[0].bukti_foto===reference?'migrated':'changed';log.storage=reference;
      summary[log.status]++;
    } catch(error) {log.status='failed';log.galat=String(error.message||error).slice(0,500);summary.failed++;}
    log.diperbarui_pada=new Date().toISOString();
    await rest('sla_migrasi_foto_absensi','on_conflict=table_name,record_id','POST',log,'resolution=merge-duplicates,return=representation');
  }
  summary.remaining-=summary.migrated;
  return {status:'sukses',...summary};
}
async function effectiveAbsence(rows, start, end, employee = '', cabang = '') {
  const q = 'select=*&status=eq.Disetujui&tanggal_mulai=lte.' + encode(end) +
    '&or=(jenis.eq.Sakit,tanggal_selesai.is.null,tanggal_selesai.gte.' + encode(start) + ')' +
    (employee ? '&nama_pegawai=eq.' + encode(employee) : '');
  const leaves = (await allRows('pengajuan_cuti', q)).filter(p=>
    !cabang||(branch(p.cabang)||'Kendari')===cabang);
  const known = new Set(leaves.map(x => String(x.id_pengajuan)));
  const out = rows.filter(r => {
    if (!['Sakit','Izin'].includes(r.tipe_absen) || r.status_disiplin !== 'Pengajuan Disetujui') return true;
    const m=String(r.id_absen || '').match(/^ABS-(PGJ-[A-Za-z0-9_-]+)-\d{8}$/);
    return !(m && known.has(m[1]));
  });
  for (const p of leaves) {
    if (!['Sakit','Izin'].includes(p.jenis)) continue;
    const approvedEnd = String(p.tanggal_selesai_disetujui || p.tanggal_selesai || '').slice(0,10);
    let last = p.jenis === 'Sakit' ? day() : (approvedEnd || day());
    let returned = p.kembali_bekerja_pada ? new Date(p.kembali_bekerja_pada) : null;
    for (const r of rows) {
      if (r.nama_pegawai !== p.nama_pegawai || !['Masuk','Masuk Setelah Istirahat'].includes(r.tipe_absen) ||
          /Lupa Absen Masuk|Koreksi|Auto/i.test(String(r.status_disiplin || ''))) continue;
      const t=new Date(r.waktu_absen), d=day(t);
      if (d >= String(p.tanggal_mulai).slice(0,10) && (p.jenis==='Sakit'||d<=approvedEnd) && (!returned || t < returned)) returned=t;
    }
    const returnDay = returned ? day(returned) : '';
    if (returnDay && returnDay < last) last=returnDay;
    if (end < last) last=end;
    for (let d=String(p.tanggal_mulai).slice(0,10); d<=last; d=addDay(d)) {
      if (d<start) continue;
      const at=localTime(d,8);
      if (returned && d===returnDay && returned<=at) continue;
      out.push({ id_absen:'ABS-'+p.id_pengajuan+'-'+d.replace(/-/g,''), waktu_absen:at.toISOString(),
        nama_pegawai:p.nama_pegawai,role:p.role,tipe_absen:p.jenis,status_disiplin:'Pengajuan Disetujui',
        keterangan:'[ID Pengajuan: '+p.id_pengajuan+'] Disetujui oleh '+(p.disetujui_oleh||'-')+'. Alasan: '+(p.alasan||'-'),
        bukti_foto:p.bukti_foto||'-',lokasi_maps:'-',kembali_bekerja_pada:returned?.toISOString()||'' });
    }
  }
  return out.sort((a,b)=>new Date(a.waktu_absen)-new Date(b.waktu_absen));
}
async function getAbsence(body,u) {
  if (!management(u) && !canOwnSlip(u)) throw new Error('Akses Slip Gaji belum diizinkan untuk akun ini.');
  const period=safePeriod(body.periode); if (!period) throw new Error('Format periode absensi tidak valid.');
  const next=period.slice(5)==='12' ? String(Number(period.slice(0,4))+1)+'-01' : period.slice(0,5)+String(Number(period.slice(5))+1).padStart(2,'0');
  const own=!management(u);
  const scope=own?'&nama_pegawai=eq.'+encode(u.name)+absenceBranchScope(u.branch):'';
  let rows=await allRows('absensi','select=id_absen,waktu_absen,nama_pegawai,role,tipe_absen,keterangan,status_disiplin,bukti_foto,lokasi_maps'+
    '&waktu_absen=gte.'+encode(period+'-01T00:00:00+08:00')+'&waktu_absen=lt.'+encode(next+'-01T06:00:00+08:00')+
    scope+'&order=waktu_absen.asc');
  rows=await effectiveAbsence(rows,period+'-01',addDay(next+'-01',-1),own?u.name:'',own?u.branch:'');
  rows=await photos(rows);
  return { status:'sukses',periode:period,data:[HEADERS_ABSEN,...rows.map(r=>[r.waktu_absen,r.nama_pegawai,r.tipe_absen,r.keterangan,r.status_disiplin||'',r.kembali_bekerja_pada||'',r.bukti_foto||'',r.lokasi_maps||''])] };
}
async function getReview(u) {
  const today=day(), tomorrow=addDay(today);
  const scope=management(u)?'':'&nama_pegawai=eq.'+encode(u.name)+absenceBranchScope(u.branch);
  let rows=await allRows('absensi','select=id_absen,waktu_absen,nama_pegawai,role,tipe_absen,keterangan,status_disiplin,lokasi_maps,bukti_foto'+
    '&waktu_absen=gte.'+encode(today+'T00:00:00+08:00')+'&waktu_absen=lt.'+encode(tomorrow+'T06:00:00+08:00')+
    scope+'&order=waktu_absen.asc');
  rows=await photos(await effectiveAbsence(rows,today,today,management(u)?'':u.name,management(u)?'':u.branch));
  const result=new Map();
  for (const r of rows) {
    if (workDay(r)!==today) continue;
    const name=String(r.nama_pegawai||'').trim(), time=wita(r.waktu_absen).slice(11,16), type=String(r.tipe_absen||'');
    if (!result.has(name)) result.set(name,{tanggal:new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Makassar',day:'2-digit',month:'short',year:'numeric'}).format(new Date()),
      nama:name,status:'Hadir',masuk1:'-',keluar1:'-',masuk2:'-',keluar2:'-',keterangan:r.keterangan||'-',gps:r.lokasi_maps||'-',foto:[]});
    const item=result.get(name);
    if (/^https?:\/\//.test(r.bukti_foto||'')&&!item.foto.some(f=>f.url===r.bukti_foto)) item.foto.push({url:r.bukti_foto,tipe:type,waktu:r.waktu_absen});
    if (type.includes('Masuk')) {
      if ((minute(r.waktu_absen)<720||r.status_disiplin==='Terlambat Masuk')&&item.masuk1==='-') item.masuk1=time;
      else if (item.masuk2==='-') item.masuk2=time;
    } else if (/Keluar|Pulang/.test(type)) {
      if (day(r.waktu_absen)===today&&minute(r.waktu_absen)<=840) item.keluar1=time; else item.keluar2=time;
    }
    if (r.keterangan&&r.keterangan!=='-') item.keterangan=r.keterangan;
    if (r.lokasi_maps&&r.lokasi_maps!=='-') item.gps=r.lokasi_maps;
  }
  return {status:'sukses',data:[...result.values()].sort((a,b)=>a.nama.localeCompare(b.nama))};
}
async function payrollRows(period, employee='') {
  const q='select=kunci_payroll,periode,nama_pegawai,fee_marketing,kasbon,tanggal_luar_kota,tanggal_libur_tambahan,diperbarui_pada,diperbarui_oleh'+
    '&periode=eq.'+encode(period)+(employee?'&nama_pegawai=eq.'+encode(employee):'')+'&order=nama_pegawai.asc';
  return (await allRows('payroll_bulanan',q)).map(r=>({kunci:r.kunci_payroll,periode:r.periode,namaPegawai:r.nama_pegawai,
    fee:Number(r.fee_marketing)||0,kasbon:Number(r.kasbon)||0,luarKota:r.tanggal_luar_kota||'',liburTambahan:r.tanggal_libur_tambahan||'',
    diperbaruiPada:r.diperbarui_pada||'',diperbaruiOleh:r.diperbarui_oleh||''}));
}
function ticketTechnicians(value) { return [...new Set(String(value||'').replaceAll(String.fromCharCode(13), ',').replaceAll(String.fromCharCode(10), ',').replaceAll(';', ',').split(',').map(norm).filter(Boolean))]; } function ticketNames(value,name) { return String(value||'').split(/[,;\n]/).some(x=>norm(x)===norm(name)); }
function rahaTeamPoints(rows,profiles,period) { const team=new Set(profiles.filter(r=>norm(r.role)==='teknisi'&&branch(r.hak_akses_cabang)==='Raha').map(r=>norm(r.nama_asli)).filter(Boolean)); const perTechnician=Object.create(null); let total=0; for(const r of rows) { if(branch(r.cabang)!=='Raha'||r.status!=='Selesai'||r.status_pembayaran!=='Lunas')continue; const paid=new Date(r.tanggal_lunas||r.waktu_selesai||''); if(Number.isNaN(paid.getTime())||day(paid).slice(0,7)!==period)continue; const points=Number(r.bobot_poin)||0, veto=norm(r.veto_admin)==='ya'; if(points<=0||(r.status_sla!=='TERPENUHI'&&!veto))continue; const technicians=ticketTechnicians(r.teknisi); if(!technicians.length)continue; const share=points/technicians.length; for(const name of technicians)if(team.has(name)){ perTechnician[name]=(perTechnician[name]||0)+share; total+=share; } } return {perTechnician,total:Math.round((total+Number.EPSILON)*10)/10}; } async function getPayroll(body,u) {
  const period=safePeriod(body.periode); if (!period) throw new Error('Format periode payroll tidak valid.');
  const own=!canPayrollManage(u); if (own&&!canOwnSlip(u)) throw new Error('Akses Slip Gaji belum diizinkan untuk akun ini.');
  const target=branch(body.cabang||u.branch); if (!target) throw new Error('Cabang payroll tidak valid.');
  if (own&&target!==u.branch) throw new Error('Slip pribadi hanya tersedia pada cabang kerja pegawai.');
  if (!own&&!canManagePayrollBranch(u,target))
    throw new Error('Akses payroll lintas cabang ditolak.');
  const next=period.slice(5)==='12'?String(Number(period.slice(0,4))+1)+'-01':period.slice(0,5)+String(Number(period.slice(5))+1).padStart(2,'0');
  let users=await allRows('users','select=username,role,nama_asli,email,target_sales_rp,no_wa,gaji_pokok,bonus_tambahan,hak_akses_cabang,cabang'+
    (own?'&auth_id=eq.'+encode(u.authId):'')+'&order=nama_asli.asc');
  if (own&&users.length!==1) throw new Error('Profil payroll pegawai tidak ditemukan.');
  const base='select=id_tiket,no_transaksi,status,status_pembayaran,tanggal_lunas,waktu_selesai,teknisi,bobot_poin,veto_admin,status_sla,cabang'+
    '&status=eq.Selesai&status_pembayaran=eq.Lunas'+(target==='Kendari'?'&or=(cabang.eq.Kendari,cabang.is.null)':'&cabang=eq.Raha');
  const [paid,fallback]=await Promise.all([
    allRows('tiket',base+'&tanggal_lunas=gte.'+encode(period+'-01')+'&tanggal_lunas=lt.'+encode(next+'-01')),
    allRows('tiket',base+'&tanggal_lunas=is.null&waktu_selesai=gte.'+encode(period+'-01')+'&waktu_selesai=lt.'+encode(next+'-01'))]);
  const seen=new Set(),tickets=[];
  for (const r of [...paid,...fallback]) {
    if (!r.id_tiket||seen.has(r.id_tiket)||(own&&!ticketNames(r.teknisi,u.name))) continue;
    seen.add(r.id_tiket);tickets.push({'ID Tiket':r.id_tiket,'No Transaksi':r.no_transaksi,'Status':r.status,
      'Status Pembayaran':r.status_pembayaran,'Tanggal Lunas':r.tanggal_lunas,'Waktu Selesai':r.waktu_selesai,
      'Teknisi':r.teknisi,'Bobot Poin':r.bobot_poin,'Veto Admin':r.veto_admin,'Status SLA':r.status_sla,'Cabang':r.cabang||target});
  }
  let poinRahaPribadi=null; const naura=own&&target==='Raha'&&norm(u.name)==='abu naura'&&(u.role==='admin_raha'||u.role==='admin'); const ardan=own&&target==='Raha'&&norm(u.name)==='ardan'&&u.role==='sales'; if(naura||ardan) { const team=await allRows('users','select=nama_asli,role,hak_akses_cabang&role=eq.teknisi&hak_akses_cabang=eq.Raha'); const points=rahaTeamPoints([...paid,...fallback],team,period); const source=naura?'abu naura':'abu adibah'; poinRahaPribadi={periode:period,cabang:'Raha',pemilik:u.name,poinTeknisi:Math.round(((points.perTechnician[source]||0)+Number.EPSILON)*10)/10,poinTim:ardan?points.total:0}; } const names=new Set(users.map(r=>norm(r.nama_asli)));
  const salaryByUser=new Map((await salarySummary(users,period)).map(r=>[r.username,r]));
  return {status:'sukses',periode:period,cabang:target,users:users.map(r=>({'Username':r.username,'Role':r.role,'Nama Asli':r.nama_asli,
    'Email':r.email,'Target Sales (Rp)':r.target_sales_rp,'No WA':r.no_wa,'Gaji Pokok':salaryByUser.get(r.username)?.gajiPeriode ?? r.gaji_pokok,
    'Gaji Pokok Saat Ini':r.gaji_pokok,'Program Gaji':salaryProgramApplies(r)?salaryByUser.get(r.username)||null:null,
    'Bonus Tambahan':r.bonus_tambahan,'Hak_Akses_Cabang':r.hak_akses_cabang,'Cabang':r.cabang})),tickets,poinRahaPribadi,
    payroll:(await payrollRows(period,own?u.name:'')).filter(r=>names.has(norm(r.namaPegawai)))};
}
function dates(value,period) {
  const [year,month]=period.split('-').map(Number),max=new Date(Date.UTC(year,month,0)).getUTCDate();
  return [...new Set(String(value||'').split(',').map(x=>Number(x.trim())).filter(x=>Number.isInteger(x)&&x>=1&&x<=max))].sort((a,b)=>a-b).join(', ');
}
// Match pilihProfilPayroll_ in the slip: one payroll profile per normalized name.
// Secondary Sales/technician accounts must not decide the payroll branch.
function selectPayrollProfile(profiles, name) {
  const normalized = norm(name);
  if (!normalized) return null;
  let candidates = profiles.filter(r => norm(r.nama_asli) === normalized);
  if (normalized === 'abu abdillah') {
    candidates = candidates.filter(r => norm(r.role) === 'manager');
  } else if (normalized === 'abu naura' || normalized === 'abu naurah') {
    candidates = candidates.filter(r => norm(r.role) === 'admin_raha' ||
      (norm(r.role) === 'admin' && norm(r.hak_akses_cabang) === 'raha'));
  } else if (normalized === 'ardan') {
    candidates = candidates.filter(r => norm(r.role) === 'sales');
  }
  const paid = candidates.filter(r => (parseFloat(r.gaji_pokok) || 0) > 0);
  if (paid.length) candidates = paid;
  return candidates.length === 1 ? candidates[0] : null;
}
async function payrollEvidenceContext(body, u, write = false) {
  if (write ? !canPayrollManage(u) : !canOwnSlip(u))
    throw new Error(write ? 'Bukti payroll hanya dapat diunggah Manajemen.' : 'Akses bukti payroll ditolak.');
  const period = safePeriod(body.periode), name = String(body.namaPegawai || '').trim();
  if (!period || !name || typeof body.usernameTarget !== 'string' || !body.usernameTarget)
    throw new Error('Periode atau pegawai bukti payroll tidak valid.');
  if (!canPayrollManage(u) && norm(name) !== norm(u.name)) throw new Error('Bukti payroll hanya untuk slip pribadi.');
  if (write && payrollPeriodLocked(period)) throw new Error('Periode payroll telah dikunci setelah masa tenggang 7 hari.');
  const profiles = await allRows('users', 'select=username,nama_asli,role,gaji_pokok,hak_akses_cabang,cabang&order=username.asc');
  const target = selectPayrollProfile(profiles, name);
  if (!target || target.username !== body.usernameTarget) throw new Error('Profil bukti payroll tidak cocok. Muat ulang slip.');
  const targetBranch = payrollProfileBranch(target.hak_akses_cabang) || payrollProfileBranch(target.cabang);
  if (!targetBranch || (canPayrollManage(u) ? !canManagePayrollBranch(u, targetBranch) : targetBranch !== u.branch))
    throw new Error('Cabang bukti payroll tidak sesuai hak akses.');
  return { period, target };
}
function payrollEvidenceMetadata(row) {
  return { id: row.id, jenis: row.jenis, namaFile: row.nama_file, ukuran: row.ukuran_byte,
    diperbaruiPada: row.diperbarui_pada };
}
async function getPayrollEvidence(body, u) {
  const { period, target } = await payrollEvidenceContext(body, u);
  const rows = await rest('sla_bukti_payroll', 'select=id,jenis,nama_file,ukuran_byte,diperbarui_pada&username=eq.' +
    encode(target.username) + '&periode=eq.' + encode(period) + '&order=jenis.asc');
  return { status: 'sukses', username: target.username, periode: period, data: rows.map(payrollEvidenceMetadata) };
}
async function openPayrollEvidence(body, u) {
  const { period, target } = await payrollEvidenceContext(body, u);
  if (!['fee_marketing', 'kasbon'].includes(body.jenis) || !/^[0-9a-f-]{36}$/i.test(String(body.id || '')))
    throw new Error('Bukti PDF tidak valid.');
  const rows = await rest('sla_bukti_payroll', 'select=*&username=eq.' + encode(target.username) + '&periode=eq.' +
    encode(period) + '&jenis=eq.' + encode(body.jenis) + '&id=eq.' + encode(body.id) + '&limit=2');
  if (rows.length !== 1) throw new Error('Bukti telah diganti. Muat ulang bukti pada slip.');
  const response = await fetch(BASE + '/storage/v1/object/sign/' + PAYROLL_EVIDENCE_BUCKET + '/' +
    rows[0].object_path.split('/').map(encode).join('/'), {
      method: 'POST', headers: serviceHeaders('application/json'), body: JSON.stringify({ expiresIn: 300 }) });
  if (!response.ok) throw new Error('PDF gagal dibuka. Silakan coba lagi.');
  const signed = await response.json();
  if (!signed.signedURL) throw new Error('Tautan PDF tidak tersedia.');
  const url = new URL(signed.signedURL.startsWith('/object/') ? BASE + '/storage/v1' + signed.signedURL : signed.signedURL, BASE);
  if (url.origin !== new URL(BASE).origin || !url.pathname.startsWith('/storage/v1/object/sign/' + PAYROLL_EVIDENCE_BUCKET + '/'))
    throw new Error('Tautan PDF tidak valid.');
  if (body.unduh === true) url.searchParams.set('download', rows[0].nama_file);
  return { status: 'sukses', url: url.href };
}
async function removePayrollEvidenceObject(path) {
  try {
    const response = await fetch(BASE + '/storage/v1/object/' + PAYROLL_EVIDENCE_BUCKET, {
      method: 'DELETE', headers: serviceHeaders('application/json'), body: JSON.stringify({ prefixes: [path] }),
      signal: AbortSignal.timeout(10000) });
    if (!response.ok) console.error('Pembersihan PDF payroll tertunda.');
  } catch { console.error('Pembersihan PDF payroll tertunda.'); }
}
async function uploadPayrollEvidence(body, u) {
  const { period, target } = await payrollEvidenceContext(body, u, true);
  const kind = body.jenis, filename = String(body.namaFile || '').trim();
  if (!['fee_marketing', 'kasbon'].includes(kind) || typeof body.idLama !== 'string' ||
    (body.idLama !== '' && !/^[0-9a-f-]{36}$/i.test(body.idLama))) throw new Error('Jenis atau versi bukti tidak valid.');
  if (!filename || filename.length > 180 || !/\.pdf$/i.test(filename) || /[\x00-\x1f\x7f/\\]/.test(filename))
    throw new Error('Nama berkas harus PDF, maksimal 180 karakter.');
  const value = String(body.pdfBase64 || '');
  if (value.length > Math.ceil(PAYROLL_PDF_MAX_BYTES / 3) * 4 + 64) throw new Error('PDF melebihi batas 5 MB.');
  const match = value.match(/^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[1].length % 4 !== 0) throw new Error('Format berkas harus PDF.');
  let binary;
  try { binary = atob(match[1]); } catch { throw new Error('Data PDF tidak valid.'); }
  if (!binary.length || binary.length > PAYROLL_PDF_MAX_BYTES) throw new Error('PDF kosong atau melebihi batas 5 MB.');
  if (!/^%PDF-[12]\.\d/.test(binary) || !/%%EOF\s*$/.test(binary.slice(-1024))) throw new Error('Isi berkas bukan PDF yang valid.');
  const id = crypto.randomUUID(), objectPath = target.username + '/' + period + '/' + kind + '/' + id + '.pdf';
  const uploaded = await fetch(BASE + '/storage/v1/object/' + PAYROLL_EVIDENCE_BUCKET + '/' + objectPath.split('/').map(encode).join('/'), {
    method: 'POST', headers: { ...serviceHeaders('application/pdf'), 'x-upsert': 'false' },
    body: Uint8Array.from(binary, c => c.charCodeAt(0)) });
  if (!uploaded.ok) throw new Error('PDF gagal diunggah. Bukti sebelumnya tetap tersimpan.');
  let saved;
  try {
    saved = await rest('rpc/sla_simpan_bukti_payroll', '', 'POST', { p_auth_id: u.authId, p_username: target.username,
      p_periode: period, p_jenis: kind, p_id: id, p_id_lama: body.idLama, p_object_path: objectPath,
      p_nama_file: filename, p_ukuran_byte: binary.length, p_hapus: false });
  } catch (error) {
    // Network failure can follow a successful commit; preserve the uploaded object in that case.
    if ([400, 401, 403, 404, 409, 422].includes(error.databaseHttpStatus)) await removePayrollEvidenceObject(objectPath);
    throw error;
  }
  if (saved.status !== 'sukses' || saved.data?.id !== id) throw new Error('Konfirmasi penyimpanan PDF tidak valid. Muat ulang bukti.');
  if (saved.objectPathLama && saved.objectPathLama !== objectPath) await removePayrollEvidenceObject(saved.objectPathLama);
  return { status: 'sukses', username: target.username, periode: period, data: payrollEvidenceMetadata(saved.data) };
}
async function deletePayrollEvidence(body, u) {
  const { period, target } = await payrollEvidenceContext(body, u, true);
  if (!['fee_marketing', 'kasbon'].includes(body.jenis) || !/^[0-9a-f-]{36}$/i.test(String(body.idLama || '')))
    throw new Error('Bukti yang akan dihapus tidak valid.');
  const saved = await rest('rpc/sla_simpan_bukti_payroll', '', 'POST', { p_auth_id: u.authId, p_username: target.username,
    p_periode: period, p_jenis: body.jenis, p_id: null, p_id_lama: body.idLama, p_object_path: null,
    p_nama_file: null, p_ukuran_byte: null, p_hapus: true });
  if (saved.status !== 'sukses' || saved.idTerhapus !== body.idLama) throw new Error('Konfirmasi penghapusan tidak valid. Muat ulang bukti.');
  if (saved.objectPathLama) await removePayrollEvidenceObject(saved.objectPathLama);
  return { status: 'sukses', username: target.username, periode: period, jenis: body.jenis, idTerhapus: saved.idTerhapus };
}
async function savePayroll(body,u) {
  if (!canPayrollManage(u)) throw new Error('Komponen payroll hanya dapat diubah Manajemen.');
  const period=safePeriod(body.periode),requestedName=String(body.namaPegawai||'').trim();
  if (!period||!requestedName) throw new Error('Periode atau pegawai tidak valid.');
  if (payrollPeriodLocked(period)) throw new Error('Periode payroll telah dikunci setelah masa tenggang 7 hari.');
  const profiles=await allRows('users','select=username,nama_asli,role,gaji_pokok,hak_akses_cabang,cabang&order=username.asc');
  const target=selectPayrollProfile(profiles,requestedName);
  if (!target) throw new Error('Profil payroll tidak ditemukan atau ambigu. Muat ulang data pegawai.');
  const name=String(target.nama_asli).trim();
  const targetBranch=payrollProfileBranch(String(target.hak_akses_cabang||'').trim()) ||
    payrollProfileBranch(String(target.cabang||'').trim());
  if(!targetBranch||!canManagePayrollBranch(u,targetBranch))throw new Error('Cabang payroll tidak sesuai hak akses.');
  const fee=Number(body.fee),kasbon=Number(body.kasbon);
  if (!Number.isFinite(fee)||!Number.isFinite(kasbon)||fee<0||kasbon<0) throw new Error('Nominal payroll tidak valid.');
  const key=period+'_'+name.toLowerCase(),old=await rest('payroll_bulanan','select=*&kunci_payroll=eq.'+encode(key)+'&limit=2');
  if (old.length>1) throw new Error('Data payroll tidak unik.');
  const record={kunci_payroll:key,periode:period,nama_pegawai:name,fee_marketing:fee,kasbon,
    tanggal_luar_kota:dates(body.luarKota,period),
    tanggal_libur_tambahan:body.liburTambahan===undefined?(old[0]?.tanggal_libur_tambahan||''):dates(body.liburTambahan,period),
    diperbarui_pada:new Date().toISOString(),diperbarui_oleh:u.name};
  await rest('payroll_bulanan','on_conflict=kunci_payroll','POST',[record],'resolution=merge-duplicates,return=representation');
  return {status:'sukses',data:(await payrollRows(period,name))[0]};
}
async function getBankAccounts(u) {
  if (!management(u)) throw new Error('Nomor rekening hanya dapat diakses Admin Kendari, Manager, atau Direktur.');
  const rows = await allRows('sla_rekening_pegawai','select=username,nomor_rekening,nama_bank&order=username.asc');
  return {status:'sukses',data:rows.map(r=>({username:r.username,nomorRekening:r.nomor_rekening,namaBank:r.nama_bank || ''}))};
}
async function saveBankAccount(body,u) {
  if (!management(u)) throw new Error('Nomor rekening hanya dapat diubah Admin Kendari, Manager, atau Direktur.');
  const username = String(body.usernameTarget || '').trim();
  if (!username || username.length > 80 || typeof body.nomorRekening !== 'string' || typeof body.nomorLama !== 'string')
    throw new Error('Data rekening pegawai tidak valid.');
  const number = body.nomorRekening.replace(/\s/g,'');
  if (number && !/^[0-9]{1,34}$/.test(number)) throw new Error('Nomor rekening harus berisi angka, maksimal 34 digit.');
  // Older open pages may still save only the number; retain the stored bank name.
  if (body.namaBank !== undefined || body.namaBankLama !== undefined) {
    if (typeof body.namaBank !== 'string' || typeof body.namaBankLama !== 'string' ||
        body.namaBank.length > 100 || body.namaBankLama.length > 100 || /[\x00-\x1f\x7f]/.test(body.namaBank + body.namaBankLama))
      throw new Error('Nama bank harus berupa teks, maksimal 100 karakter.');
    const bankName = body.namaBank.trim().replace(/\s+/g, ' ');
    return rest('rpc/sla_simpan_rekening_bank_pegawai','','POST',
      {p_auth_id:u.authId,p_username:username,p_nomor_rekening:number,p_nomor_lama:body.nomorLama,
        p_nama_bank:bankName,p_nama_bank_lama:body.namaBankLama});
  }
  return rest('rpc/sla_simpan_rekening_pegawai','','POST',
    {p_auth_id:u.authId,p_username:username,p_nomor_rekening:number,p_nomor_lama:body.nomorLama});
}
async function getSalaryTransfers(body,u) {
  if (!management(u)) throw new Error('Status transfer gaji hanya untuk Admin Kendari, Manager, atau Direktur.');
  const period = safePeriod(body.periode);
  if (!period) throw new Error('Periode gaji tidak valid.');
  return rest('rpc/sla_status_transfer_gaji','','POST',{p_auth_id:u.authId,p_periode:period});
}
async function saveSalaryTransfer(body,u) {
  if (!management(u)) throw new Error('Status transfer gaji hanya dapat diubah Admin Kendari, Manager, atau Direktur.');
  const period = safePeriod(body.periode), username = String(body.usernameTarget || '').trim(), cycle = String(body.siklus || '');
  if (!period || !username || username.length > 80 || !/^\d{4}-\d{2}-\d{2}$/.test(cycle) ||
      typeof body.sudahTransfer !== 'boolean' || typeof body.statusLama !== 'boolean') throw new Error('Data status transfer gaji tidak valid.');
  return rest('rpc/sla_simpan_transfer_gaji','','POST',{p_auth_id:u.authId,p_username:username,p_periode:period,
    p_siklus:cycle,p_sudah_transfer:body.sudahTransfer,p_status_lama:body.statusLama});
}
async function manageProfile(body,u) {
  const data=body.profil||{}, username=String(data.username||body.usernameTarget||'').trim();
  if (!/^[A-Za-z0-9._ -]{1,80}$/.test(username)) throw new Error('Username profil tidak valid.');
  const admin=u.role==='admin'&&u.branch!=='Raha';
  const own=norm(username)===norm(u.username);
  if (!admin&&!own) throw new Error('Hanya Manajemen dapat mengubah profil pegawai lain.');
  if (body.action==='hapusProfil') {
    if (!admin||own||norm(username)==='admin') throw new Error('Penghapusan profil ditolak.');
    const old=await rest('users','select=username,hak_akses_cabang&username=eq.'+encode(username)+'&limit=2');
    if (old.length!==1) throw new Error('Profil tidak ditemukan.');
    if (u.access!=='Semua'&&branch(old[0].hak_akses_cabang)!==u.branch) throw new Error('Cabang profil tidak sesuai hak akses.');
    return {status:'sukses',data:await rest('users','username=eq.'+encode(username),'DELETE',undefined,'return=representation')};
  }
  const old=await rest('users','select=username,auth_id,role,hak_akses_cabang,gaji_pokok&username=eq.'+encode(username)+'&limit=2');
  if (old.length>1) throw new Error('Profil tidak unik.');
  if (body.action==='buatProfil'&&old.length) throw new Error('Username sudah digunakan.');
  if (body.action==='ubahProfil'&&!old.length) throw new Error('Profil tidak ditemukan.');
  if (!admin) {
    if (!old.length||old[0].auth_id!==u.authId) throw new Error('Profil pribadi tidak cocok.');
    const email=String(data.email||'').trim(), phone=String(data.no_wa||'').trim();
    if(email.length>254||phone.length>30)throw new Error('Kontak profil terlalu panjang.');
    return {status:'sukses',data:await rest('users','username=eq.'+encode(username),'PATCH',
      {email,no_wa:phone},'return=representation')};
  }
  const targetBranch=branch(data.hak_akses_cabang);
  if (!targetBranch&&data.hak_akses_cabang!=='Semua') throw new Error('Cabang profil tidak valid.');
  if (u.access!=='Semua'&&(targetBranch!==u.branch||old.length&&branch(old[0].hak_akses_cabang)!==u.branch))
    throw new Error('Cabang profil tidak sesuai hak akses.');
  const role=norm(data.role);
  if (!['teknisi','sales','admin','admin_raha','manager','direktur'].includes(role)) throw new Error('Role profil tidak valid.');
  if (data.hak_akses_cabang==='Semua'&&!['admin','manager','direktur'].includes(role))
    throw new Error('Akses semua cabang tidak sesuai role.');
  const salary=Number(data.gaji_pokok),sales=Number(data.target_sales_rp);
  if (!Number.isSafeInteger(salary)||salary<0||!Number.isSafeInteger(sales)||sales<0)
    throw new Error('Nominal profil tidak valid.');
  const name=String(data.nama_asli||'').trim(), email=String(data.email||'').trim(),phone=String(data.no_wa||'').trim();
  if(!name||name.length>180||email.length>254||phone.length>30) throw new Error('Data profil tidak valid.');
  const record={nama_asli:name,email,no_wa:phone,role,target_sales_rp:sales,gaji_pokok:salary,
    hak_akses_cabang:data.hak_akses_cabang};
  if(body.action==='ubahProfil'&&salary!==Number(old[0].gaji_pokok||0))
    throw new Error('Gaji pokok sudah berbeda. Muat ulang profil dan gunakan bagian Gaji Pokok — Manajemen untuk perubahan gaji.');
  if(body.action==='buatProfil') {
    const authId=String(data.auth_id||'');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(authId))
      throw new Error('Auth ID profil tidak valid.');
    const linked=await rest('users','select=username&auth_id=eq.'+encode(authId)+'&limit=1');
    if(linked.length)throw new Error('Auth ID sudah digunakan oleh profil lain.');
    record.username=username;record.auth_id=authId;
    return {status:'sukses',data:await rest('users','','POST',record,'return=representation')};
  }
  delete record.gaji_pokok; // Contact/profile edits cannot overwrite an automatic salary increase.
  const saved=await rest('users','username=eq.'+encode(username),'PATCH',record,'return=representation');
  await salaryNotificationsSafe(username);
  return {status:'sukses',data:saved};
}
async function listLeave(action,u) {
  if (!management(u)) throw new Error('Approval absensi khusus Manajemen.');
  const query='select=*'+(action==='getDaftarPengajuan'?'&status=eq.Menunggu&order=waktu_pengajuan.desc':'&status=neq.Menunggu&order=waktu_disetujui.desc&limit=50');
  let rows=action==='getDaftarPengajuan'?await allRows('pengajuan_cuti',query):await rest('pengajuan_cuti',query);
  if (action==='getDaftarPengajuan') rows=rows.filter(r=>canApprove(u,r));
  else if(u.access!=='Semua')rows=rows.filter(r=>(branch(r.cabang)||'Kendari')===u.branch);
  rows=await photos(rows);
  return {status:'sukses',data:rows.map(r=>({'ID Pengajuan':r.id_pengajuan,'Waktu Pengajuan':r.waktu_pengajuan,
    'Nama Pegawai':r.nama_pegawai,'Role':r.role,'Jenis (Sakit/Izin)':r.jenis,'Tanggal Mulai':r.tanggal_mulai,
    'Selesai':r.tanggal_selesai,
    'Selesai Disetujui':r.jenis==='Izin'&&r.status==='Disetujui'?(r.tanggal_selesai_disetujui||r.tanggal_selesai):null,
    'Kembali Bekerja':r.kembali_bekerja_pada||null,'Alasan':r.alasan,'Bukti Foto':r.bukti_foto,
    'Status (Menunggu/Disetujui/Ditolak)':r.status,'Disetujui Oleh':r.disetujui_oleh,'Waktu Disetujui':r.waktu_disetujui}))};
}
function normalizePhone(value) {
  let number=String(value||'').replace(/\D/g,'');
  if(number.startsWith('0062'))number=number.slice(2);
  if(number.startsWith('620'))number='62'+number.slice(3);
  if(number.startsWith('0'))number='62'+number.slice(1);
  else if(number.startsWith('8'))number='62'+number;
  return /^\d{8,15}$/.test(number)?number:'';
}
function leaveRecipient(profile) {
  const role=norm(profile.role),access=String(profile.hak_akses_cabang||profile.cabang||'').trim();
  return {role,access,branch:branch(access)||branch(profile.cabang)||(['admin','manager','direktur'].includes(role)?'Kendari':'')};
}
async function leaveNotifications(requestId=null,max=3) {
  const result={terkirim:0,gagal:0,tertunda:true};
  for(let i=0;i<max;i++) {
    const events=await rest('rpc/sla_ambil_notif_absensi','','POST',{p_pengajuan:requestId});
    if(!events.length)break;
    const event=events[0];let success=false,error='';
    try {
      const requests=await rest('pengajuan_cuti','select=*&id_pengajuan=eq.'+encode(event.id_pengajuan)+'&limit=2');
      const recipients=await rest('users','select=username,role,hak_akses_cabang,cabang,no_wa&username=eq.'+encode(event.penerima_username)+'&limit=2');
      if(requests.length!==1||recipients.length!==1||!canApprove(leaveRecipient(recipients[0]),requests[0]))
        throw new Error('Penerima pengajuan tidak lagi berhak melakukan approval.');
      const p=requests[0],phone=normalizePhone(recipients[0].no_wa);
      const token=Deno.env.get('FONNTE_TOKEN')||Deno.env.get('FONNTE_TOKEN_CADANGAN');
      if(!phone)throw new Error('Nomor WhatsApp penerima belum valid.');
      if(!token)throw new Error('Token Fonnte belum dikonfigurasi.');
      if(p.status!=='Menunggu') {
        // No stale reminder after approval; acknowledge the obsolete queue item.
        success=true;
      } else {
        const applicants=p.pengaju_auth_id?await rest('users','select=no_wa&auth_id=eq.'+encode(p.pengaju_auth_id)+'&limit=2'):[];
        const contact=applicants.length===1?normalizePhone(applicants[0].no_wa):'';
        const message='PENGAJUAN '+p.jenis+' BARU\nNama: '+p.nama_pegawai+'\nCabang: '+(p.cabang||'Kendari')+
          (contact?'\nWA Pengaju: +'+contact+'\nHubungi Pengaju: https://wa.me/'+contact:'')+
          '\nAlasan: '+p.alasan+'\nBuka aplikasi: https://aplikasisla.vercel.app/\nSetelah login, pilih Absensi > Approval Pengajuan.';
        await new Promise(resolve=>setTimeout(resolve,2000));
        const response=await fetch('https://api.fonnte.com/send',{method:'POST',
          headers:{Authorization:token,'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({target:phone,message,delay:'2'}),signal:AbortSignal.timeout(15000)});
        const data=await response.json().catch(()=>({}));
        if(!response.ok||data.status!==true)throw new Error('Provider WhatsApp menolak notifikasi.');
        success=true;
      }
    } catch(e) {error=String(e.message||e);}
    const ack=await rest('rpc/sla_selesai_notif_absensi','','POST',{
      p_id:event.id,p_lease_id:event.lease_id,p_terkirim:success,p_error:error});
    if(ack!==true)throw new Error('Konfirmasi antrean WhatsApp belum berhasil.');
    result[success?'terkirim':'gagal']++;
  }
  const pending=await rest('sla_notif_absensi','select=id&terkirim_pada=is.null'+
    (requestId?'&id_pengajuan=eq.'+encode(requestId):'')+'&limit=1');
  result.tertunda=pending.length>0;
  return result;
}
async function submitLeave(body,u) {
  if (u.role==='direktur') throw new Error('Direktur tidak perlu mengajukan izin.');
  const kind=String(body.jenis||''),from=String(body.tanggalMulai||''),to=kind==='Sakit'?null:String(body.selesai||''),reason=String(body.alasan||'').trim();
  if (!['Sakit','Izin'].includes(kind)||!/^\d{4}-\d{2}-\d{2}$/.test(from)||(kind==='Izin'&&(!/^\d{4}-\d{2}-\d{2}$/.test(to)||to<from))||!reason)
    throw new Error('Data pengajuan sakit/izin tidak valid.');
  if(await rest('rpc/sla_attendance_supabase_active','','POST',{})!==true)
    throw new Error('Migrasi foto dan notifikasi absensi belum aktif.');
  const photo=await uploadPhoto(body.buktiFotoBase64,'leave',u);
  const id='PGJ-'+wita().replace(/[- :]/g,'').slice(0,14)+'-'+crypto.randomUUID().slice(0,5).toUpperCase();
  try {
    await rest('pengajuan_cuti','','POST',{id_pengajuan:id,waktu_pengajuan:new Date().toISOString(),nama_pegawai:u.name,role:u.role,
      jenis:kind,tanggal_mulai:from,tanggal_selesai:to,alasan:reason,bukti_foto:photo,status:'Menunggu',cabang:u.branch,pengaju_auth_id:u.authId});
  } catch(error) {await cleanupRejectedPhoto(photo,error);throw error;}
  let notifications={terkirim:0,gagal:0,tertunda:true};
  try {notifications=await leaveNotifications(id,3);} catch {console.error('Notifikasi absensi tetap menunggu di antrean.');}
  const notified=notifications.terkirim>0&&!notifications.tertunda;
  return {status:'sukses',idPengajuan:id,notifikasi:notifications,notifikasiWaTerkirim:notified,
    pesan:notified?'Pengajuan berhasil disimpan dan menunggu approval.':
      'Pengajuan tersimpan. Notifikasi WhatsApp masih menunggu pengiriman otomatis.'};
}
function approvedLeaveEnd(request, value) {
  const from=String(request.tanggal_mulai||'').slice(0,10),to=String(request.tanggal_selesai||'').slice(0,10);
  const start=new Date(from+'T00:00:00Z'),end=new Date(to+'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||
      !Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||
      start.toISOString().slice(0,10)!==from||end.toISOString().slice(0,10)!==to||end<start)
    throw new Error('Rentang tanggal pengajuan izin tidak valid.');
  const requested=(end.getTime()-start.getTime())/86400000+1;
  // Older clients approve the full requested range when no duration is supplied.
  const days=value===undefined?requested:Number(value);
  const validValue=value===undefined||((typeof value==='string'||typeof value==='number')&&/^\d+$/.test(String(value)));
  if (!validValue||
      !Number.isSafeInteger(days)||days<1||days>requested)
    throw new Error('Durasi izin yang disetujui harus 1 sampai '+requested+' hari.');
  return {days,end:new Date(start.getTime()+(days-1)*86400000).toISOString().slice(0,10)};
}
async function approveLeave(body,u) {
  if (!management(u)) throw new Error('Approval absensi khusus Manajemen.');
  const decision=String(body.keputusan||''),id=String(body.idPengajuan||'');
  if (!['Disetujui','Ditolak'].includes(decision)||!id) throw new Error('Keputusan tidak valid.');
  const rows=await rest('pengajuan_cuti','select=*&id_pengajuan=eq.'+encode(id)+'&limit=2');
  if (rows.length!==1||!canApprove(u,rows[0])) throw new Error('Pengajuan tidak ditemukan atau tidak berhak diputuskan.');
  if (rows[0].status!=='Menunggu') throw new Error('Pengajuan ini sudah diputuskan.');
  const approval=decision==='Disetujui'&&rows[0].jenis==='Izin'?approvedLeaveEnd(rows[0],body.durasiDisetujui):null;
  const patch={status:decision,disetujui_oleh:u.name,waktu_disetujui:new Date().toISOString()};
  if (approval) patch.tanggal_selesai_disetujui=approval.end;
  const updated=await rest('pengajuan_cuti','id_pengajuan=eq.'+encode(id)+'&status=eq.Menunggu','PATCH',patch);
  if (updated.length!==1) throw new Error('Pengajuan sudah diputuskan oleh pengguna lain.');
  return {status:'sukses',pesan:'Pengajuan berhasil '+decision.toLowerCase()+(approval?' untuk '+approval.days+' hari (sampai '+approval.end+')':'')+' oleh '+u.name};
}
async function syncCorrection(body,u) {
  if (!management(u)) throw new Error('Sinkronisasi Luar Kota khusus Manajemen.');
  const period=safePeriod(body.periode); if (!period||period>monthNow()||payrollPeriodLocked(period)) throw new Error('Sinkronisasi hanya untuk bulan berjalan atau masa tenggang 7 hari.');
  if (!Array.isArray(body.daftarPayroll)||body.daftarPayroll.length>200) throw new Error('Daftar payroll tidak valid.');
  const rows=body.daftarPayroll.filter(x=>String(x.namaPegawai||'').trim()).map(x=>({periode:period,nama_pegawai:String(x.namaPegawai).trim(),
    tanggal:dates(x.luarKota,period).split(',').map(x=>Number(x.trim())).filter(Boolean),diperbarui_pada:new Date().toISOString(),diperbarui_oleh:u.name}));
  const profiles=await allRows('users','select=nama_asli,hak_akses_cabang');
  const allowed=new Set(profiles.filter(r=>canManagePayrollBranch(u,payrollProfileBranch(r.hak_akses_cabang))).map(r=>norm(r.nama_asli)));
  if(rows.some(r=>!allowed.has(norm(r.nama_pegawai))))throw new Error('Pengecualian payroll di luar cabang ditolak.');
  if (rows.length) await rest('sla_koreksi_luar_kota','on_conflict=periode,nama_pegawai','POST',rows,'resolution=merge-duplicates,return=representation');
  return {status:'sukses',jumlah:rows.length};
}
async function sameDayRows(name,work,cabang) {
  const rows=await allRows('absensi','select=*&nama_pegawai=eq.'+encode(name)+'&waktu_absen=gte.'+encode(work+'T00:00:00+08:00')+
    '&waktu_absen=lt.'+encode(addDay(work)+'T06:00:00+08:00')+absenceBranchScope(cabang)+'&order=waktu_absen.asc,id_absen.asc');
  return rows.filter(r=>workDay(r)===work);
}
async function recordAttendance(body,u) {
  const type=String(body.tipeAbsen||'');
  if(!['Masuk','Masuk Setelah Istirahat','Keluar','Koreksi Absen'].includes(type)) throw new Error('Tipe absensi tidak valid.');
  const correction=type==='Koreksi Absen',now=new Date(),p=policy(u);
  let at=now,recordType=type,status=discipline(type,at,p);
  if(correction) {
    const correctionType=String(body.koreksiStatus||''),d=String(body.koreksiTanggal||''),h=String(body.koreksiJam||'');
    if(!['Absen Masuk','Masuk (Setelah Istirahat)','Absen Keluar'].includes(correctionType)||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!/^\d{2}:\d{2}$/.test(h)||!String(body.keterangan||'').trim())
      throw new Error('Data Koreksi Absen tidak lengkap.');
    at=new Date(d+'T'+h+':00+08:00');
    if(isNaN(at.getTime())||day(at).slice(0,7)!==monthNow())throw new Error('Koreksi hanya untuk bulan berjalan.');
    recordType='Koreksi - '+correctionType;status='Koreksi Manual';
  }
  const lat=Number(body.latitude),lon=Number(body.longitude);
  let meters=0,outside=false;
  if(!correction) {
    if(body.latitude===null||body.longitude===null||body.latitude===undefined||body.longitude===undefined||
       !Number.isFinite(lat)||!Number.isFinite(lon)||lat< -90||lat>90||lon< -180||lon>180)
      throw new Error('Lokasi GPS tidak valid.');
    meters=distance(p.kantor,lat,lon);outside=meters>100;
    const needsProof=outside||(type==='Keluar'&&p.selesaiMenit===1020&&minute(at)>1200);
    if(needsProof&&(!String(body.keterangan||'').trim()||!String(body.fotoBase64||'').startsWith('data:image/')))
      throw new Error('Di luar radius atau pulang setelah 20:00 wajib keterangan dan foto.');
  }
  const work=workDay({waktu_absen:at,tipe_absen:recordType}),daily=await sameDayRows(u.name,work,u.branch),extra=[];
  const expected=daily.at(-1)?.id_absen||'';
  if(correction) {
    const period=monthNow(),exceptions=await rest('sla_koreksi_luar_kota','select=tanggal&periode=eq.'+encode(period)+'&nama_pegawai=eq.'+encode(u.name));
    const exempt=exceptions[0]?.tanggal?.includes(Number(day(at).slice(8)))||false;
    const monthRows=await allRows('absensi','select=waktu_absen,status_disiplin&nama_pegawai=eq.'+encode(u.name)+'&waktu_absen=gte.'+encode(period+'-01T00:00:00+08:00')+absenceBranchScope(u.branch));
    const count=monthRows.filter(r=>r.status_disiplin==='Koreksi Manual'&&!exceptions[0]?.tanggal?.includes(Number(day(r.waktu_absen).slice(8)))).length;
    if(!exempt&&count>=7)throw new Error('Jatah Koreksi Absen bulan ini habis (maksimal 7).');
  }
  if(!correction&&type!=='Keluar'&&minute(at)>=720) {
    const morning=daily.some(r=>String(r.tipe_absen||'').includes('Masuk')&&!String(r.tipe_absen||'').includes('Setelah Istirahat')&&minute(r.waktu_absen)<720);
    const effective=morning?[]:await effectiveAbsence(daily,work,work,u.name,u.branch);
    const sick=effective.some(r=>['Izin','Sakit'].includes(r.tipe_absen)&&new Date(r.waktu_absen)<at);
    if(type==='Masuk Setelah Istirahat'&&!morning&&!sick)throw new Error('Lakukan Absen Masuk terlebih dahulu.');
    if(type==='Masuk'&&(morning||sick))recordType='Masuk Setelah Istirahat';
    status=discipline(recordType,at,p);
  }
  if(type==='Keluar'&&!daily.some(r=>String(r.tipe_absen||'').includes('Masuk'))) {
    const automatic=localTime(work,13,30);
    if(automatic<at) {
      extra.push({id_absen:'ABS-AUTO-MASUK-'+crypto.randomUUID(),waktu_absen:automatic.toISOString(),nama_pegawai:u.name,role:u.role,
        cabang:u.branch,tipe_absen:'Masuk',jarak_meter:0,status_disiplin:'Lupa Absen Masuk (Auto)',
        keterangan:'Otomatis oleh sistem karena absen masuk belum tercatat.',bukti_foto:'-',lokasi_maps:'-'});
      daily.push(extra[extra.length-1]);
    }
  }
  const last=daily.filter(r=>!String(r.tipe_absen||'').includes('Koreksi')).at(-1);
  if(!correction&&last) {
    const previous=String(last.tipe_absen||'');
    if(recordType==='Masuk'&&['Masuk','Masuk Setelah Istirahat'].includes(previous))throw new Error('Status terakhir sudah di dalam kantor.');
    if(recordType==='Masuk Setelah Istirahat'&&previous==='Masuk Setelah Istirahat')throw new Error('Sudah absen setelah istirahat hari ini.');
    if(recordType==='Masuk Setelah Istirahat'&&previous==='Masuk'&&minute(last.waktu_absen)>=720)throw new Error('Sudah absen masuk kembali hari ini.');
    if(recordType==='Keluar'&&previous==='Keluar')throw new Error('Sudah absen keluar.');
  }
  const proof=String(body.fotoBase64||'').length>50?await uploadPhoto(body.fotoBase64,'attendance',u):'';
  if(!correction&&(outside||(type==='Keluar'&&p.selesaiMenit===1020&&minute(at)>1200))&&!proof)
    throw new Error('Foto bukti wajib berhasil diunggah.');
  // Prior days are finalized by the scheduled database job under its own locks.
  extra.push({id_absen:'ABS-'+crypto.randomUUID(),waktu_absen:at.toISOString(),nama_pegawai:u.name,role:u.role,cabang:u.branch,
    tipe_absen:recordType,jarak_meter:meters,status_disiplin:status,keterangan:String(body.keterangan||'').trim(),
    bukti_foto:proof||'-',lokasi_maps:correction?'-':'https://www.google.com/maps?q='+lat+','+lon});
  if(recordType==='Keluar'&&second(at)>48600) {
    const morning=daily.some(r=>String(r.tipe_absen||'').includes('Masuk')&&minute(r.waktu_absen)<720);
    const afternoon=daily.some(r=>String(r.tipe_absen||'').includes('Masuk')&&(String(r.tipe_absen||'').includes('Setelah Istirahat')||minute(r.waktu_absen)>=720));
    const punished=daily.some(r=>r.tipe_absen==='Hukuman Sistem'&&/Absen Istirahat/i.test(String(r.status_disiplin||'')+' '+String(r.keterangan||'')));
    if(morning&&!afternoon&&!punished){const gap=Math.min(5400,second(at)-48600),duration=String(Math.floor(gap/3600)).padStart(2,'0')+':'+String(Math.floor((gap%3600)/60)).padStart(2,'0')+':'+String(gap%60).padStart(2,'0');
      extra.push({id_absen:'ABS-AUTO-IST-'+crypto.randomUUID(),waktu_absen:at.toISOString(),nama_pegawai:u.name,role:u.role,cabang:u.branch,
        tipe_absen:'Hukuman Sistem',jarak_meter:0,status_disiplin:'Lupa Absen Istirahat (Potongan '+duration+')',
        keterangan:'Otomatis sistem; potongan istirahat '+duration,bukti_foto:'-',lokasi_maps:'-'});}
  }
  try {
    await rest('rpc/sla_insert_absensi_batch','','POST',{p_employee:u.name,p_work_day:work,p_expected_last:expected,p_rows:extra});
  } catch(error) {await cleanupRejectedPhoto(proof,error);throw error;}
  return {status:'sukses',pesan:'Absen berhasil dicatat.'};
}
async function claimWarranty(body,u) {
  if(!['admin','admin_raha','manager','direktur'].includes(u.role))throw new Error('Hanya manajemen yang dapat memproses klaim garansi.');
  const id=String(body.idGaransi||'');
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new Error('ID garansi tidak valid.');
  const target=branch(body.cabang)||u.branch;
  if(!canManageBranch(u,target))throw new Error('Cabang di luar hak akses.');
  const result=await rest('rpc/sla_klaim_garansi','','POST',{p_auth_id:u.authId,p_id_garansi:id,p_cabang:target});
  let events=[];
  try { events=await rest('rpc/sla_ambil_notif_garansi','','POST',{p_id_garansi:id}); }
  catch { return {...result,notifikasiTertunda:Math.max(1,result.notifikasiTertunda||0)}; }
  const token=Deno.env.get('FONNTE_TOKEN')||Deno.env.get('FONNTE_TOKEN_CADANGAN');
  for(const event of events) {
    let success=false,error='';
    try {
      const phone=normalizePhone(event.no_wa);
      if(!phone)throw new Error('Nomor WhatsApp penerima belum tersedia atau tidak valid.');
      if(!token)throw new Error('Token Fonnte belum dikonfigurasi.');
      const response=await fetch('https://api.fonnte.com/send',{method:'POST',
        headers:{Authorization:token,'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({target:phone,message:event.pesan,delay:'2'}),signal:AbortSignal.timeout(20000)});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data.status!==true)throw new Error('Provider WhatsApp menolak notifikasi.');
      success=true;
    } catch(e) {error=String(e.message||e);}
    try {
      await rest('rpc/sla_selesai_notif_garansi','','POST',{p_id:event.id,p_lease:event.lease,p_sukses:success,p_galat:error});
    } catch { /* Preserve the lease when delivery outcome cannot be recorded. */ }
  }
  try {
    const pending=await rest('sla_notif_klaim_garansi','select=id&id_garansi=eq.'+encode(id)+'&terkirim_pada=is.null');
    return {...result,notifikasiTertunda:pending.length};
  } catch { return {...result,notifikasiTertunda:Math.max(1,result.notifikasiTertunda||0)}; }
}

// Salary updates are recorded transactionally in PostgreSQL; WhatsApp is a durable outbox.
async function salaryNotifications(username=null) {
  const events=await rest('rpc/sla_ambil_notif_gaji','','POST',{p_username:username});
  const token=Deno.env.get('FONNTE_TOKEN')||Deno.env.get('FONNTE_TOKEN_CADANGAN');
  for(let i=0;i<events.length;i+=4) await Promise.all(events.slice(i,i+4).map(async event=>{
    let success=false,error='';
    try {
      const phone=normalizePhone(event.no_wa);
      if(!phone)throw new Error('Nomor WhatsApp pegawai belum tersedia atau tidak valid.');
      if(!token)throw new Error('Token Fonnte belum dikonfigurasi.');
      const response=await fetch('https://api.fonnte.com/send',{method:'POST',
        headers:{Authorization:token,'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({target:phone,message:event.pesan,delay:'2'}),signal:AbortSignal.timeout(15000)});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data.status!==true)throw new Error('Provider WhatsApp menolak notifikasi.');
      success=true;
    } catch(e) {error=String(e.message||e);}
    await rest('rpc/sla_selesai_notif_gaji','','POST',{p_id:event.id,p_lease:event.lease,p_sukses:success,p_galat:error}).catch(()=>{});
  }));
  const pending=await rest('sla_notif_kenaikan_gaji','select=id&terkirim_pada=is.null'+(username?'&username=eq.'+encode(username):''));
  return pending.length;
}
async function salaryNotificationsSafe(username) {
  try {return await salaryNotifications(username);}catch {return null;}
}
async function salaryJobAuthorized(request) {
  const key=request.headers.get('x-sla-job-key')||'';
  if(!key||key.length>4096)return false;
  // Validate the existing server credential against a table with no public/user grants.
  const headers={apikey:key};if(!key.startsWith('sb_secret_'))headers.Authorization='Bearer '+key;
  const response=await fetch(BASE+'/rest/v1/sla_gaji_program?select=username&limit=0',{headers});
  return response.ok;
}
function salaryProgramApplies(profile) {
  return Number(profile.gaji_pokok)>0 &&
    (branch(String(profile.hak_akses_cabang||'').trim())||branch(String(profile.cabang||'').trim())||'Kendari')==='Kendari';
}
async function salarySummary(users,period) {
  if(!users.length)return [];
  return rest('rpc/sla_ringkasan_gaji','','POST',{p_usernames:users.map(r=>r.username),p_periode:period});
}
async function salaryManagement(u) {
  if(!management(u))throw new Error('Gaji pokok hanya dapat dikelola Admin Kendari, Manager, atau Direktur.');
  const profiles=(await allRows('users','select=username,nama_asli,role,hak_akses_cabang,cabang,gaji_pokok&order=nama_asli.asc'))
    .filter(r=>canManageBranch(u,branch(r.hak_akses_cabang)||branch(r.cabang)||'Kendari'));
  return {status:'sukses',data:profiles.map(r=>({username:r.username,nama:r.nama_asli,role:r.role,cabang:branch(r.hak_akses_cabang)||branch(r.cabang)||'Kendari',gajiPokok:Number(r.gaji_pokok)||0}))};
}
async function changeSalary(body,u) {
  if(!management(u))throw new Error('Gaji pokok hanya dapat dikelola Admin Kendari, Manager, atau Direktur.');
  const username=String(body.usernameTarget||'').trim(),old=Number(body.gajiLama),salary=Number(body.gajiBaru);
  if(!username||!Number.isSafeInteger(old)||old<0||!Number.isSafeInteger(salary)||salary<0)throw new Error('Nominal gaji tidak valid.');
  const result=await rest('rpc/sla_ubah_gaji_manual','','POST',{p_auth_id:u.authId,p_username:username,p_gaji_lama:old,p_gaji_baru:salary,p_alasan:String(body.alasan||'')});
  return {...result,notifikasiTertunda:await salaryNotificationsSafe(username)};
}

async function dispatch(body,u) {
  const action=String(body.action||'');
  if(['getKlaimSales','getBuktiKlaimSales','ajukanBanding','responBanding'].includes(action))return salesClaims(body,u);
  if(action==='klaimGaransi')return claimWarranty(body,u);
  if(action==='getDaftarGaji')return salaryManagement(u);
  if(action==='ubahGajiPokok')return changeSalary(body,u);
  if(action==='getRekeningPegawai')return getBankAccounts(u);
  if(action==='simpanRekeningPegawai')return saveBankAccount(body,u);
  if(action==='getStatusTransferGaji')return getSalaryTransfers(body,u);
  if(action==='simpanStatusTransferGaji')return saveSalaryTransfer(body,u);
  if(action==='getBuktiPayroll')return getPayrollEvidence(body,u);
  if(action==='bukaBuktiPayroll')return openPayrollEvidence(body,u);
  if(action==='unggahBuktiPayroll')return uploadPayrollEvidence(body,u);
  if(action==='hapusBuktiPayroll')return deletePayrollEvidence(body,u);
  if(['getKonfigurasiAbsensi','getAbsen','getTinjauanAbsen','getDaftarPengajuan','getRiwayatPengajuan','ajukanSakitIzin','responPengajuan','syncPengecualianKoreksiLuarKota'].includes(action)||body.tipeAbsen) {
    if(!canAttend(u))throw new Error('Absensi dan Slip Gaji hanya untuk pegawai dengan gaji pokok, kecuali Direktur.');
    if(action==='getKonfigurasiAbsensi')return {status:'sukses',kebijakan:policy(u)};
    if(action==='getAbsen')return getAbsence(body,u);
    if(action==='getTinjauanAbsen')return getReview(u);
    if(action==='getDaftarPengajuan'||action==='getRiwayatPengajuan')return listLeave(action,u);
    if(action==='ajukanSakitIzin')return submitLeave(body,u);
    if(action==='responPengajuan')return approveLeave(body,u);
    if(action==='syncPengecualianKoreksiLuarKota')return syncCorrection(body,u);
    return recordAttendance(body,u);
  }
  if(action==='getPayrollData')return getPayroll(body,u);
  if(action==='getVariabelPayroll') {
    if(!canPayrollManage(u))throw new Error('Akses komponen payroll ditolak.');
    const period=safePeriod(body.periode);if(!period)throw new Error('Periode payroll tidak valid.');
    const profiles=await allRows('users','select=nama_asli,hak_akses_cabang');
    const names=new Set(profiles.filter(r=>canManagePayrollBranch(u,payrollProfileBranch(r.hak_akses_cabang))).map(r=>norm(r.nama_asli)));
    return {status:'sukses',data:(await payrollRows(period)).filter(r=>names.has(norm(r.namaPegawai)))};
  }
  if(action==='simpanVariabelPayroll')return savePayroll(body,u);
  if(['buatProfil','ubahProfil','hapusProfil'].includes(action))return manageProfile(body,u);
  if(action==='updateTunjangan') {
    if(!canPayrollManage(u))throw new Error('Akses tunjangan ditolak.');
    const target=await rest('users','select=username,nama_asli,hak_akses_cabang&username=eq.'+encode(String(body.usernameTarget||''))+'&limit=2');
    if(target.length!==1||norm(target[0].nama_asli)!==norm(body.namaAsli))throw new Error('Profil tunjangan tidak cocok.');
    const targetBranch=payrollProfileBranch(target[0].hak_akses_cabang);
    if(!targetBranch||!canManagePayrollBranch(u,targetBranch))throw new Error('Cabang tunjangan tidak sesuai hak akses.');
    await rest('users','username=eq.'+encode(target[0].username),'PATCH',{bonus_tambahan:String(body.tunjanganData||'')});
    return {status:'sukses'};
  }
  throw new Error('Aksi API tidak dikenal.');
}

Deno.serve(async request => {
  const origin=request.headers.get('origin')||'';
  if(request.method==='OPTIONS')return new Response(null,{status:ORIGINS.has(origin)?204:403,headers:cors(origin)});
  if(request.method!=='POST')return fail('Method Not Allowed',origin,405);
  if(origin&&!ORIGINS.has(origin))return fail('Origin tidak diizinkan.',origin,403);
  try {
    if(!BASE||!SECRET||!PUBLIC)throw new Error('Konfigurasi server belum siap.');
    const body=await request.json();
    if(JSON.stringify(body).length>8*1024*1024)throw new Error('Permintaan terlalu besar.');
    if(body.action==='prosesKenaikanGajiOtomatis') {
      if(!await salaryJobAuthorized(request))return fail('Akses server diperlukan.',origin,403);
      const result=await rest('rpc/sla_evaluasi_kenaikan_gaji','','POST',{});
      return reply({...result,notifikasiTertunda:await salaryNotificationsSafe(null)},origin);
    }
    if(body.action==='prosesNotifKlaimSales') {
      if(!await salaryJobAuthorized(request))return fail('Akses server diperlukan.',origin,403);
      return reply({status:'sukses',notifikasi:await salesClaimNotifications(null,3)},origin);
    }
    if(body.action==='prosesNotifAbsensi') {
      if(!await salaryJobAuthorized(request))return fail('Akses server diperlukan.',origin,403);
      return reply({status:'sukses',notifikasi:await leaveNotifications(null,3)},origin);
    }
    if(body.action==='migrasiFotoAbsensiLama') {
      if(!await salaryJobAuthorized(request))return fail('Akses server diperlukan.',origin,403);
      return reply(await migrateLegacyAttendancePhotos(),origin);
    }
    const actor=await authenticate(request);
    // Fail closed until profile writes from ordinary JWTs are removed. Roles,
    // salary and Auth links in public.users determine payroll authorization.
    const profileLocked=await rest('rpc/sla_profile_lock_active','','POST',{});
    if(profileLocked!==true)throw new Error('API payroll/absensi menunggu pengamanan profil pengguna.');
    const requestedBranch=branch(body.cabang);
    if (requestedBranch && actor.access==='Semua' && management(actor)) actor.branch=requestedBranch;
    return reply(await dispatch(body,actor),origin);
  } catch(error) {
    console.error('SLA API:',String(error));
    return fail(String(error?.message||error),origin,/Sesi Anda tidak sah/.test(String(error))?401:200);
  }
});
// Included in index.ts: Supabase owns claim reads, decisions and durable delivery.
function salesClaimAdmin(u) {
  return norm(u.role)==='admin' && ['', 'kendari', 'semua'].includes(norm(u.access));
}
async function salesClaims(body,u) {
  const action=body.action,admin=salesClaimAdmin(u);
  if(action==='ajukanBanding' ? u.role!=='sales' : !admin)
    throw new Error(action==='ajukanBanding'?'Pengajuan klaim khusus Sales.':'Menu dan keputusan klaim hanya untuk Admin Kendari.');
  if(await rest('rpc/sla_claims_edge_active','','POST',{})!==true)
    throw new Error('Migrasi Klaim Sales Supabase belum aktif.');
  if(action==='getKlaimSales') {
    const fields='id_tiket,cabang,klien_lokasi,pekerjaan:jenis_pekerjaan,sales,status_banding,sales_pengaju,keterangan_sales,alasan_admin,klaim_sales_id,klaim_sales_username,klaim_sales_diajukan_pada,klaim_sales_diputuskan_pada,klaim_sales_admin';
    return {status:'sukses',data:await allRows('tiket','select='+fields+'&status_banding=in.(Diajukan,Diterima,Ditolak)&or=(cabang.eq.Kendari,cabang.eq.Raha,cabang.is.null)&order=klaim_sales_diajukan_pada.desc.nullslast,id_tiket.asc')};
  }
  const id=String(body.idTiket||'').trim(),target=branch(body.cabang);
  if(!/^[A-Za-z0-9._-]{1,120}$/.test(id)||!target)throw new Error('ID tiket atau cabang tidak valid.');
  if(action==='getBuktiKlaimSales') {
    const rows=await rest('tiket','select=bukti_banding&id_tiket=eq.'+encode(id)+absenceBranchScope(target)+'&status_banding=in.(Diajukan,Diterima,Ditolak)&limit=2');
    if(rows.length!==1)throw new Error('Pengajuan klaim tidak ditemukan atau ambigu.');
    return {status:'sukses',data:String(rows[0].bukti_banding||'')};
  }
  const payload={p_actor:norm(u.username).replace(/\s+/g,''),p_id_tiket:id,p_cabang:target};
  let rpc;
  if(action==='ajukanBanding') {
    payload.p_bukti=String(body.buktiBanding||'');payload.p_keterangan=String(body.keteranganSales||'').trim();
    const images=payload.p_bukti.split('|#|');
    if(images.length>3||payload.p_bukti.length>3500000||images.some(image=>!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)))
      throw new Error('Unggah 1 sampai 3 foto bukti yang valid (maksimal total 3,5 MB).');
    if(payload.p_keterangan.length>3000)throw new Error('Keterangan maksimal 3000 karakter.');
    rpc='sla_ajukan_klaim_sales';
  } else {
    payload.p_keputusan=String(body.statusBanding||'');payload.p_alasan=String(body.alasanAdmin||'').trim();
    if(!['Diterima','Ditolak'].includes(payload.p_keputusan))throw new Error('Keputusan klaim tidak valid.');
    if(payload.p_keputusan==='Ditolak'&&!payload.p_alasan)throw new Error('Alasan penolakan wajib diisi.');
    if(payload.p_alasan.length>3000)throw new Error('Alasan maksimal 3000 karakter.');
    rpc='sla_respon_klaim_sales';
  }
  const result=await rest('rpc/'+rpc,'','POST',payload);
  if(!result?.klaim_id)throw new Error('Respons penyimpanan klaim tidak valid.');
  let notifications;
  try {notifications=await salesClaimNotifications(result.klaim_id,2);}catch {notifications={terkirim:0,gagal:0,tertunda:true};}
  return {status:'sukses',klaim:result,notifikasi:notifications};
}
function salesClaimMessage(event) {
  const t=event.snapshot||{},submitted=event.jenis==='Diajukan';
  let message='ALFACOM — '+(submitted?'PENGAJUAN KLAIM SALES':'HASIL KLAIM SALES')+'\n'+
    (submitted?'Admin Kendari, ada pengajuan klaim baru.':'Klaim Anda telah '+event.jenis.toUpperCase()+' oleh Admin Kendari.')+
    '\nCabang: '+(t.cabang||'Kendari')+'\nTiket: '+t.id_tiket+'\nSales pengaju: '+(t.sales||'-')+'\nKlien: '+(t.klien||'-')+'\nPekerjaan: '+(t.pekerjaan||'-');
  if(submitted&&t.keterangan)message+='\nKeterangan: '+t.keterangan;
  if(event.jenis==='Ditolak')message+='\nAlasan penolakan: '+(t.alasan||'-');
  return message+'\n'+(submitted?'Buka menu Klaim Sales di lobby.':'Lihat status pada tiket SLA.')+'\nhttps://aplikasisla.vercel.app/';
}
async function salesClaimNotifications(claimId=null,max=3) {
  const lease=await rest('rpc/sla_mulai_pengiriman_klaim_sales','','POST',{});
  const result={terkirim:0,gagal:0,tertunda:true};
  if(!lease)return result;
  try {
    for(let i=0;i<max;i++) {
      const events=await rest('rpc/sla_ambil_notif_klaim_sales','','POST',{p_klaim_id:null});
      if(!events.length)break;
      const event=events[0];let success=false,error='';
      try {
        const profiles=await rest('users','select=username_login,role,hak_akses_cabang,no_wa&username_login=eq.'+encode(event.penerima_username)+'&limit=2');
        if(profiles.length!==1)throw new Error('Akun penerima tidak ditemukan atau ambigu.');
        const recipient=profiles[0];
        if(event.jenis==='Diajukan'&&!salesClaimAdmin({role:recipient.role,access:recipient.hak_akses_cabang}))throw new Error('Penerima sudah bukan Admin Kendari.');
        if(event.jenis!=='Diajukan'&&norm(recipient.role)!=='sales')throw new Error('Penerima sudah bukan Sales.');
        const phone=normalizePhone(recipient.no_wa),token=Deno.env.get('FONNTE_TOKEN')||Deno.env.get('FONNTE_TOKEN_CADANGAN');
        if(!phone)throw new Error('Nomor WhatsApp penerima belum valid.');
        if(!token)throw new Error('Token Fonnte belum dikonfigurasi.');
        await new Promise(resolve=>setTimeout(resolve,2000));
        const response=await fetch('https://api.fonnte.com/send',{method:'POST',headers:{Authorization:token,'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({target:phone,message:salesClaimMessage(event),delay:'2'}),signal:AbortSignal.timeout(15000)});
        const data=await response.json().catch(()=>({}));
        if(!response.ok||data.status!==true)throw new Error('Provider WhatsApp menolak notifikasi.');
        success=true;
      } catch(e) {error=String(e.message||e);}
      await rest('rpc/sla_selesaikan_notif_klaim_sales','','POST',{p_id:event.id,p_lease_id:event.lease_id,p_terkirim:success,p_error:error});
      if(!claimId||event.klaim_id===claimId)result[success?'terkirim':'gagal']++;
    }
    const pending=await rest('sla_notif_klaim_sales','select=id&terkirim_pada=is.null'+(claimId?'&klaim_id=eq.'+encode(claimId):'')+'&limit=1');
    result.tertunda=pending.length>0;return result;
  } finally {
    await rest('rpc/sla_akhiri_pengiriman_klaim_sales','','POST',{p_lease_id:lease}).catch(()=>{});
  }
}
