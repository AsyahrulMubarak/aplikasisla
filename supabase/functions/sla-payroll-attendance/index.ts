// @ts-nocheck
// Payroll and attendance API. No browser-supplied identity or branch is trusted.
const BASE = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
const SECRET_KEYS = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const PUBLIC_KEYS = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || SECRET_KEYS.default;
const PUBLIC = PUBLIC_KEYS.default || Deno.env.get('SUPABASE_ANON_KEY');
const BUCKET = 'sla-attendance-private';
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
    'Cache-Control': 'no-store', Vary: 'Origin', 'X-SLA-Revision': 'salary-increments-20261001' };
}
function reply(data, origin, status = 200) { return Response.json(data, { status, headers: cors(origin) }); }
function fail(message, origin, status = 200) { return reply({ status: 'gagal', pesan: message }, origin, status); }
function serviceHeaders(contentType) {
  const h = { apikey: SECRET };
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
    throw new Error(response.status===400 && table.startsWith('rpc/') && detail.message ? detail.message : 'Database ' + table + ' HTTP ' + response.status);
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
  return day(now) >= next + '-06';
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
    let last = p.jenis === 'Sakit' ? day() : (String(p.tanggal_selesai || '').slice(0,10) || day());
    let returned = p.kembali_bekerja_pada ? new Date(p.kembali_bekerja_pada) : null;
    for (const r of rows) {
      if (r.nama_pegawai !== p.nama_pegawai || !['Masuk','Masuk Setelah Istirahat'].includes(r.tipe_absen) ||
          /Lupa Absen Masuk|Koreksi|Auto/i.test(String(r.status_disiplin || ''))) continue;
      const t=new Date(r.waktu_absen), d=day(t);
      if (d >= String(p.tanggal_mulai).slice(0,10) && (!returned || t < returned)) returned=t;
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
    '&waktu_absen=gte.'+encode(today+'T00:00:00+08:00')+'&waktu_absen=lt.'+encode(tomorrow+'T00:00:00+08:00')+
    scope+'&order=waktu_absen.asc');
  rows=await photos(await effectiveAbsence(rows,today,today,management(u)?'':u.name,management(u)?'':u.branch));
  const result=new Map();
  for (const r of rows) {
    if (day(r.waktu_absen)!==today) continue;
    const name=String(r.nama_pegawai||'').trim(), time=wita(r.waktu_absen).slice(11,16), type=String(r.tipe_absen||'');
    if (!result.has(name)) result.set(name,{tanggal:new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Makassar',day:'2-digit',month:'short',year:'numeric'}).format(new Date()),
      nama:name,status:'Hadir',masuk1:'-',keluar1:'-',masuk2:'-',keluar2:'-',keterangan:r.keterangan||'-',gps:r.lokasi_maps||'-',foto:[]});
    const item=result.get(name);
    if (/^https?:\/\//.test(r.bukti_foto||'')&&!item.foto.some(f=>f.url===r.bukti_foto)) item.foto.push({url:r.bukti_foto,tipe:type,waktu:r.waktu_absen});
    if (type.includes('Masuk')) {
      if ((minute(r.waktu_absen)<720||r.status_disiplin==='Terlambat Masuk')&&item.masuk1==='-') item.masuk1=time;
      else if (item.masuk2==='-') item.masuk2=time;
    } else if (/Keluar|Pulang/.test(type)) {
      if (minute(r.waktu_absen)<=840) item.keluar1=time; else item.keluar2=time;
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
  let users=await allRows('users','select=username,role,nama_asli,email,target_sales_rp,no_wa,gaji_pokok,bonus_tambahan,hak_akses_cabang'+
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
    'Gaji Pokok Saat Ini':r.gaji_pokok,'Program Gaji':salaryByUser.get(r.username)||null,
    'Bonus Tambahan':r.bonus_tambahan,'Hak_Akses_Cabang':r.hak_akses_cabang})),tickets,poinRahaPribadi,
    payroll:(await payrollRows(period,own?u.name:'')).filter(r=>names.has(norm(r.namaPegawai)))};
}
function dates(value,period) {
  const [year,month]=period.split('-').map(Number),max=new Date(Date.UTC(year,month,0)).getUTCDate();
  return [...new Set(String(value||'').split(',').map(x=>Number(x.trim())).filter(x=>Number.isInteger(x)&&x>=1&&x<=max))].sort((a,b)=>a-b).join(', ');
}
async function savePayroll(body,u) {
  if (!canPayrollManage(u)) throw new Error('Komponen payroll hanya dapat diubah Manajemen.');
  const period=safePeriod(body.periode),name=String(body.namaPegawai||'').trim();
  if (!period||!name) throw new Error('Periode atau pegawai tidak valid.');
  if (payrollPeriodLocked(period)) throw new Error('Periode payroll telah dikunci setelah masa tenggang 5 hari.');
  const target=await allRows('users','select=nama_asli,hak_akses_cabang&nama_asli=eq.'+encode(name));
  const targetBranches=new Set(target.map(r=>payrollProfileBranch(r.hak_akses_cabang)));
  if (!target.length||targetBranches.size!==1) throw new Error('Cabang profil payroll tidak unik atau tidak ditemukan.');
  const targetBranch=[...targetBranches][0];
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
    'Selesai':r.tanggal_selesai,'Kembali Bekerja':r.kembali_bekerja_pada||null,'Alasan':r.alasan,'Bukti Foto':r.bukti_foto,
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
async function notifyManagers(u,reason,type) {
  const token=Deno.env.get('FONNTE_TOKEN') || Deno.env.get('FONNTE_TOKEN_CADANGAN');
  if (!token) throw new Error('Token Fonnte belum dikonfigurasi pada Edge Function.');
  const users=await allRows('users','select=role,no_wa,hak_akses_cabang');
  const recipients=users.filter(x=>x.no_wa&&canApprove({role:norm(x.role),branch:branch(x.hak_akses_cabang),access:x.hak_akses_cabang},u))
    .map(x=>normalizePhone(x.no_wa)).filter(Boolean);
  if (!recipients.length) return;
  const applicant=normalizePhone(u.phone);
  const contact=applicant?'\nWA Pengaju: +'+applicant+'\nHubungi Pengaju: https://wa.me/'+applicant:'\nWA Pengaju: belum terdaftar';
  const form=new URLSearchParams({target:recipients.join(','),message:'PENGAJUAN '+type+' BARU\nNama: '+u.name+contact+
    '\nAlasan: '+reason+'\nBuka aplikasi SLA untuk approval: https://aplikasisla.vercel.app/',delay:'2'});
  const r=await fetch('https://api.fonnte.com/send',{method:'POST',headers:{Authorization:token,'Content-Type':'application/x-www-form-urlencoded'},body:form});
  if (!r.ok) throw new Error('Pengajuan tersimpan tetapi notifikasi WA gagal dikirim.');
}
async function submitLeave(body,u) {
  if (u.role==='direktur') throw new Error('Direktur tidak perlu mengajukan izin.');
  const kind=String(body.jenis||''),from=String(body.tanggalMulai||''),to=kind==='Sakit'?null:String(body.selesai||''),reason=String(body.alasan||'').trim();
  if (!['Sakit','Izin'].includes(kind)||!/^\d{4}-\d{2}-\d{2}$/.test(from)||(kind==='Izin'&&(!/^\d{4}-\d{2}-\d{2}$/.test(to)||to<from))||!reason)
    throw new Error('Data pengajuan sakit/izin tidak valid.');
  const photo=await uploadPhoto(body.buktiFotoBase64,'leave',u);
  const id='PGJ-'+wita().replace(/[- :]/g,'').slice(0,14)+'-'+crypto.randomUUID().slice(0,5).toUpperCase();
  await rest('pengajuan_cuti','','POST',{id_pengajuan:id,waktu_pengajuan:new Date().toISOString(),nama_pegawai:u.name,role:u.role,
    jenis:kind,tanggal_mulai:from,tanggal_selesai:to,alasan:reason,bukti_foto:photo,status:'Menunggu',cabang:u.branch});
  let notified=true;
  try { await notifyManagers(u,reason,kind); } catch(e) { notified=false; console.error(String(e)); }
  return {status:'sukses',notifikasiWaTerkirim:notified,
    pesan:notified?'Pengajuan berhasil disimpan dan menunggu approval.':
      'Pengajuan tersimpan, tetapi notifikasi WhatsApp belum terkirim. Hubungi Manajemen.'};
}
async function approveLeave(body,u) {
  if (!management(u)) throw new Error('Approval absensi khusus Manajemen.');
  const decision=String(body.keputusan||''),id=String(body.idPengajuan||'');
  if (!['Disetujui','Ditolak'].includes(decision)||!id) throw new Error('Keputusan tidak valid.');
  const rows=await rest('pengajuan_cuti','select=*&id_pengajuan=eq.'+encode(id)+'&limit=2');
  if (rows.length!==1||!canApprove(u,rows[0])) throw new Error('Pengajuan tidak ditemukan atau tidak berhak diputuskan.');
  if (rows[0].status!=='Menunggu') throw new Error('Pengajuan ini sudah diputuskan.');
  const updated=await rest('pengajuan_cuti','id_pengajuan=eq.'+encode(id)+'&status=eq.Menunggu','PATCH',{
    status:decision,disetujui_oleh:u.name,waktu_disetujui:new Date().toISOString()});
  if (updated.length!==1) throw new Error('Pengajuan sudah diputuskan oleh pengguna lain.');
  return {status:'sukses',pesan:'Pengajuan berhasil '+decision.toLowerCase()+' oleh '+u.name};
}
async function syncCorrection(body,u) {
  if (!management(u)) throw new Error('Sinkronisasi Luar Kota khusus Manajemen.');
  const period=safePeriod(body.periode); if (!period||period>monthNow()||payrollPeriodLocked(period)) throw new Error('Sinkronisasi hanya untuk bulan berjalan atau masa tenggang 5 hari.');
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
  await rest('rpc/sla_insert_absensi_batch','','POST',{p_employee:u.name,p_work_day:work,p_expected_last:expected,p_rows:extra});
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
  if(action==='klaimGaransi')return claimWarranty(body,u);
  if(action==='getDaftarGaji')return salaryManagement(u);
  if(action==='ubahGajiPokok')return changeSalary(body,u);
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
