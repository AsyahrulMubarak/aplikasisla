// @ts-nocheck
// Identity and permissions always come from verified Auth and the stored profile.
const BASE = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
const PUBLIC = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}').default || Deno.env.get('SUPABASE_ANON_KEY');
const ORIGINS = new Set(['https://aplikasisla.vercel.app', 'https://aplikasisla-git-codex-supabase-ce8793-asyahrulmubaraks-projects.vercel.app']);
const NEUTRAL = { status: 'sukses', pesan: 'Jika akun terdaftar, admin akan menindaklanjuti permintaan reset.', resetSandiVersion: 'supabase-v1' };
const normalize = v => String(v || '').trim().toLowerCase().replace(/\s+/g, '');
const roleOf = p => String(p.role || '').trim().toLowerCase();
const accessOf = p => String(p.hak_akses_cabang || p.cabang || '').trim().toLowerCase();
const masterAdmin = p => roleOf(p) === 'admin' && accessOf(p) !== 'raha';
const resetAdmin = p => ['admin', 'admin_raha'].includes(roleOf(p));
const uuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''));
function headers() {
  const h = { apikey: SECRET, 'Content-Type': 'application/json' };
  if (!String(SECRET).startsWith('sb_secret_')) h.Authorization = 'Bearer ' + SECRET;
  return h;
}
function cors(origin) {
  return { 'Access-Control-Allow-Origin': ORIGINS.has(origin) ? origin : 'https://aplikasisla.vercel.app',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Cache-Control': 'no-store', Vary: 'Origin', 'X-SLA-Revision': 'profile-supabase-20261009' };
}
const reply = (data, origin, status = 200) => Response.json(data, { status, headers: cors(origin) });
async function requestJson(resource, method = 'GET', body) {
  const r = await fetch(BASE + resource, { method, headers: { ...headers(), Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  if (!r.ok) {
    const e = new Error(resource.startsWith('/auth/') ? 'Layanan akun menolak perubahan. Periksa username dan password.' : 'Penyimpanan profil belum berhasil. Muat ulang dan coba lagi.');
    e.httpStatus = r.status;
    throw e;
  }
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}
const rest = (table, query = '', method = 'GET', body) => requestJson('/rest/v1/' + table + (query ? '?' + query : ''), method, body);
const rpc = (name, body) => rest('rpc/' + name, '', 'POST', body);
async function getProfile(username) {
  const login = normalize(username);
  if (!/^[a-z0-9._-]{1,80}$/.test(login)) throw new Error('Username profil tidak valid.');
  const rows = await rest('users', 'select=*&username_login=eq.' + encodeURIComponent(login) + '&limit=2');
  if (!Array.isArray(rows) || rows.length > 1) throw new Error('Profil tidak unik.');
  return rows[0] || null;
}
async function authenticate(request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (token.split('.').length !== 3) throw Object.assign(new Error('Sesi Anda tidak sah atau telah kedaluwarsa.'), { httpStatus: 401 });
  const r = await fetch(BASE + '/auth/v1/user', { headers: { apikey: PUBLIC, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw Object.assign(new Error('Sesi Anda tidak sah atau telah kedaluwarsa.'), { httpStatus: 401 });
  const auth = await r.json();
  if (!uuid(auth.id) || !/^[a-z0-9._-]{1,80}@alfacom\.local$/.test(String(auth.email || '').toLowerCase())) throw new Error('Identitas akun tidak valid.');
  const p = await getProfile(auth.email.slice(0, -'@alfacom.local'.length));
  if (!p || p.auth_id !== auth.id || normalize(p.username) + '@alfacom.local' !== auth.email.toLowerCase()) throw new Error('Profil tidak cocok dengan akun yang login.');
  if (await rpc('sla_profile_lock_active', {}) !== true) throw new Error('Pengamanan profil belum siap.');
  return p;
}
function canReset(actor, target) {
  if (!resetAdmin(actor)) return false;
  if (roleOf(actor) === 'admin_raha' || accessOf(actor) === 'raha') return accessOf(actor) === 'raha' && accessOf(target) === 'raha';
  return accessOf(actor) === 'semua' || accessOf(actor) === accessOf(target);
}
function requireProfileScope(actor, target) {
  if (!masterAdmin(actor) || (accessOf(actor) !== 'semua' && accessOf(actor) !== accessOf(target))) throw new Error('Cabang profil tidak sesuai hak akses admin.');
}
function safePassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw new Error('Password harus terdiri dari 8 sampai 128 karakter.');
  return value;
}
async function audit(actor, target, action) {
  try { await rest('sla_profile_audit', '', 'POST', { actor_auth_id: actor.auth_id, target_username: target, action }); }
  catch { console.error('Pencatatan audit profil perlu dicoba kembali.'); }
}
function validateProfile(data) {
  const name = String(data.nama_asli || '').trim(), email = String(data.email || '').trim(), phone = String(data.no_wa || '').trim();
  const role = roleOf(data), access = String(data.hak_akses_cabang || '').trim();
  const salary = Number(data.gaji_pokok), sales = Number(data.target_sales_rp);
  if (!name || name.length > 180 || email.length > 254 || phone.length > 30) throw new Error('Data profil tidak valid.');
  if (!['admin','admin_raha','manager','direktur','teknisi','sales'].includes(role)) throw new Error('Role profil tidak valid.');
  if (!['Kendari','Raha','Semua'].includes(access) || (access === 'Semua' && !['admin','manager','direktur'].includes(role)) || (role === 'admin_raha' && access !== 'Raha')) throw new Error('Cabang profil tidak sesuai role.');
  if (!Number.isSafeInteger(salary) || salary < 0 || !Number.isSafeInteger(sales) || sales < 0) throw new Error('Nominal profil tidak valid.');
  return { nama_asli: name, email, no_wa: phone, role, hak_akses_cabang: access, gaji_pokok: salary, target_sales_rp: sales };
}
async function authUserForProfile(p) {
  if (!uuid(p.auth_id)) throw new Error('Profil belum terhubung dengan akun Auth. Sinkronkan Auth ID terlebih dahulu.');
  const auth = await requestJson('/auth/v1/admin/users/' + p.auth_id);
  if (auth.id !== p.auth_id || String(auth.email || '').toLowerCase() !== normalize(p.username) + '@alfacom.local') throw new Error('Identitas Auth target tidak cocok.');
  return auth;
}
async function manageProfile(body, actor) {
  const data = body.profil || {}, login = normalize(data.username || body.usernameTarget);
  const old = await getProfile(login);
  if (body.action === 'buatProfil') {
    if (!masterAdmin(actor)) throw new Error('Hanya Admin Kendari dapat membuat profil baru.');
    if (old) throw new Error('Username sudah digunakan.');
    const record = validateProfile(data);
    requireProfileScope(actor, record);
    const password = safePassword(body.passwordBaru);
    const created = await requestJson('/auth/v1/admin/users', 'POST', { email: login + '@alfacom.local', password, email_confirm: true });
    if (!uuid(created.id) || String(created.email || '').toLowerCase() !== login + '@alfacom.local') throw new Error('Akun Auth baru tidak valid.');
    let rows;
    try {
      rows = await rest('users', '', 'POST', { ...record, username: String(data.username).trim(), auth_id: created.id });
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Profil baru belum terkonfirmasi.');
    } catch (error) {
      // Never delete an account if a timed-out insert actually committed.
      let stored;
      try { stored = await getProfile(login); } catch { throw new Error('Status profil baru belum dapat dikonfirmasi. Muat ulang sebelum mencoba lagi.'); }
      if (stored && stored.auth_id === created.id) rows = [stored];
      else if (!stored) {
        try { await requestJson('/auth/v1/admin/users/' + created.id, 'DELETE'); }
        catch { console.error('Akun Auth baru memerlukan rekonsiliasi setelah profil gagal disimpan.'); }
        throw error;
      } else throw error;
    }
    await audit(actor, rows[0].username, 'buatProfil');
    return { status: 'sukses', data: rows, userId: created.id, passwordDiubah: true };
  }
  if (!old) throw new Error('Profil tidak ditemukan.');
  const own = old.auth_id === actor.auth_id;
  if (!own) requireProfileScope(actor, old);
  if (body.action === 'hapusProfil') {
    requireProfileScope(actor, old);
    if (own || normalize(old.username) === 'admin') throw new Error('Penghapusan profil ditolak.');
    // Keep Auth identity/history; API authorization requires a live linked profile.
    const rows = await rest('users', 'username=eq.' + encodeURIComponent(old.username), 'DELETE');
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Penghapusan profil belum terkonfirmasi.');
    await audit(actor, old.username, 'hapusProfil');
    return { status: 'sukses', data: rows };
  }
  if (body.action !== 'ubahProfil') throw new Error('Operasi profil tidak dikenal.');
  let record;
  if (masterAdmin(actor)) {
    record = validateProfile(data);
    requireProfileScope(actor, record);
    if (record.gaji_pokok !== Number(old.gaji_pokok || 0)) throw new Error('Gaji pokok sudah berbeda. Muat ulang profil dan gunakan bagian Gaji Pokok — Manajemen untuk perubahan gaji.');
    delete record.gaji_pokok;
  } else {
    if (!own) throw new Error('Anda hanya dapat mengubah profil sendiri.');
    record = { email: String(data.email || '').trim(), no_wa: String(data.no_wa || '').trim() };
    if (record.email.length > 254 || record.no_wa.length > 30) throw new Error('Kontak profil terlalu panjang.');
  }
  if (body.passwordBaru) safePassword(body.passwordBaru);
  const rows = await rest('users', 'username=eq.' + encodeURIComponent(old.username) + '&auth_id=eq.' + actorIdFilter(old.auth_id), 'PATCH', record);
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Pembaruan profil belum terkonfirmasi.');
  await audit(actor, old.username, 'ubahProfil');
  let reset = {};
  if (body.passwordBaru) {
    try { reset = await changePassword({ targetUsername: old.username, passwordBaru: body.passwordBaru }, actor); }
    catch { return { status: 'sukses', data: rows, passwordDiubah: false, pesan: 'Profil tersimpan, tetapi password belum berubah. Gunakan bagian Reset Password atau coba lagi.' }; }
  }
  return { status: 'sukses', data: rows, ...reset };
}
const actorIdFilter = id => uuid(id) ? encodeURIComponent(id) : '00000000-0000-4000-8000-000000000000';
async function changePassword(body, actor) {
  const p = await getProfile(body.targetUsername);
  if (!p || (!canReset(actor, p) && p.auth_id !== actor.auth_id)) throw new Error('Anda tidak berhak mengubah password akun tersebut.');
  const password = safePassword(body.passwordBaru);
  await authUserForProfile(p);
  await requestJson('/auth/v1/admin/users/' + p.auth_id, 'PUT', { password });
  let completed = 0, auditPending = false;
  if (canReset(actor, p)) {
    try { completed = await rpc('sla_complete_password_reset', { p_username: p.username, p_actor_auth_id: actor.auth_id }); }
    catch { auditPending = true; }
  }
  await audit(actor, p.username, 'resetPassword');
  return { status: 'sukses', passwordDiubah: true, resetSandiTerselesaikan: completed > 0, auditTertunda: auditPending };
}
async function listResetRequests(actor) {
  if (!resetAdmin(actor)) throw new Error('Menu reset password hanya untuk admin.');
  const all = await rest('users', 'select=username,nama_asli,role,hak_akses_cabang,cabang,auth_id&order=nama_asli.asc');
  const users = all.filter(p => p.auth_id && canReset(actor, p));
  const permitted = new Set(users.map(p => p.username));
  const requests = await rest('sla_password_reset_requests', 'select=id,username,nama_asli,cabang,requested_at&completed_at=is.null&order=requested_at.desc&limit=200');
  return { status: 'sukses', users: users.map(p => ({ username: p.username, nama_asli: p.nama_asli })), data: requests.filter(r => permitted.has(r.username)) };
}
async function reconcileAuthProfiles(actor) {
  if (!masterAdmin(actor) || accessOf(actor) !== 'semua') throw new Error('Sinkronisasi Auth ID hanya untuk Admin Pusat.');
  const pending = await rest('users', 'select=username,username_login&auth_id=is.null&limit=1000');
  if (!pending.length) return { status: 'sukses', diperbarui: 0 };
  const authUsers = [];
  for (let page = 1; page <= 100; page++) {
    const result = await requestJson('/auth/v1/admin/users?page=' + page + '&per_page=1000');
    const users = result.users || [];
    authUsers.push(...users);
    if (users.length < 1000) break;
    if (page === 100) throw new Error('Terlalu banyak akun Auth untuk sinkronisasi.');
  }
  let updated = 0;
  for (const p of pending) {
    const matching = authUsers.filter(a => String(a.email || '').toLowerCase() === normalize(p.username) + '@alfacom.local' && uuid(a.id));
    if (matching.length !== 1) continue;
    const linked = await rest('users', 'select=username&auth_id=eq.' + matching[0].id + '&limit=1');
    if (linked.length) continue;
    const rows = await rest('users', 'username=eq.' + encodeURIComponent(p.username) + '&auth_id=is.null', 'PATCH', { auth_id: matching[0].id });
    if (rows.length === 1) { updated++; await audit(actor, p.username, 'linkAuth'); }
  }
  return { status: 'sukses', diperbarui: updated };
}
async function resetNotifications(requestId = null) {
  const token = Deno.env.get('FONNTE_TOKEN') || '';
  if (!token) return;
  const rows = await rpc('sla_lease_password_reset_notifications', { p_request: requestId });
  for (const row of rows) {
    let sent = false;
    try {
      const targets = await rest('users', 'select=username,role,hak_akses_cabang,cabang,no_wa&username=eq.' + encodeURIComponent(row.recipient_username) + '&limit=1');
      const requests = await rest('sla_password_reset_requests', 'select=*&id=eq.' + row.request_id + '&completed_at=is.null&limit=1');
      if (targets.length === 1 && requests.length === 1 && canReset(targets[0], { hak_akses_cabang: requests[0].cabang })) {
        const phone = String(targets[0].no_wa || '').replace(/\D/g, '').replace(/^0/, '62');
        if (/^62\d{8,13}$/.test(phone)) {
          const r = await fetch('https://api.fonnte.com/send', { method: 'POST', headers: { Authorization: token },
            body: new URLSearchParams({ target: phone, message: row.pesan, countryCode: '62' }), signal: AbortSignal.timeout(15000) });
          const result = await r.json(); sent = r.ok && result.status === true;
        }
      } else sent = true; // A completed request or removed recipient no longer needs delivery.
    } catch { /* A leased delivery remains retryable. */ }
    await rpc('sla_ack_password_reset_notification', { p_id: row.id, p_lease: row.lease, p_success: sent });
  }
}
async function requestReset(body, request) {
  const username = normalize(body.username);
  if (!/^[a-z0-9._-]{1,80}$/.test(username)) return { ...NEUTRAL };
  const source = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SECRET + ':password-reset:' + source));
  const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const id = await rpc('sla_request_password_reset', { p_username: username, p_fingerprint: fingerprint });
  if (id) {
    // Response timing never reveals whether a username exists; Cron retries durable deliveries.
    const job = resetNotifications(id).catch(() => console.error('Notifikasi reset menunggu pengiriman ulang.'));
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(job);
    else await job;
  }
  return { ...NEUTRAL };
}
async function jobAuthorized(request) {
  const key = request.headers.get('x-sla-job-key') || '';
  if (!key) return false;
  if (key === SECRET) return true;
  if (!key.startsWith('sb_secret_')) return false;
  const r = await fetch(BASE + '/rest/v1/sla_password_reset_notifications?select=id&limit=1', {
    headers: { apikey: key }, signal: AbortSignal.timeout(15000)
  });
  return r.ok;
}
async function dispatch(body, actor) {
  if (['buatProfil','ubahProfil','hapusProfil'].includes(body.action)) return manageProfile(body, actor);
  if (body.action === 'resetPassword') return changePassword(body, actor);
  if (body.action === 'getPermintaanResetSandi') return listResetRequests(actor);
  if (body.action === 'reconcileSupabaseAuthProfiles') return reconcileAuthProfiles(actor);
  if (body.action === 'validateSession') return { status: 'sukses', user: { Username: actor.username, Role: actor.role,
    'Nama Asli': actor.nama_asli, Email: actor.email, 'No WA': actor.no_wa, Hak_Akses_Cabang: actor.hak_akses_cabang || actor.cabang,
    'Gaji Pokok': actor.gaji_pokok, 'Bonus Tambahan': actor.bonus_tambahan, 'Target Sales (Rp)': actor.target_sales_rp } };
  throw new Error('Operasi profil tidak dikenal.');
}
Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';
  if (origin && !ORIGINS.has(origin)) return reply({ status: 'gagal', pesan: 'Origin tidak diizinkan.' }, origin, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== 'POST') return reply({ status: 'gagal', pesan: 'POST diperlukan.' }, origin, 405);
  try {
    if (!BASE || !SECRET || !PUBLIC) throw new Error('Konfigurasi server belum siap.');
    const raw = await request.text();
    if (raw.length > 65536) throw new Error('Permintaan terlalu besar.');
    const body = JSON.parse(raw);
    if (body.action === 'lupaSandi') return reply(await requestReset(body, request), origin);
    if (body.action === 'prosesNotifResetSandi') {
      if (!await jobAuthorized(request)) return reply({ status: 'gagal', pesan: 'Akses server diperlukan.' }, origin, 403);
      await resetNotifications(); return reply({ status: 'sukses' }, origin);
    }
    return reply(await dispatch(body, await authenticate(request)), origin);
  } catch (error) {
    // Never log request bodies: they may contain a password.
    console.error('SLA Profil: permintaan ditolak atau layanan gagal.');
    return reply({ status: 'gagal', pesan: error?.message || 'Layanan profil belum berhasil.' }, origin, error?.httpStatus === 401 ? 401 : 200);
  }
});
