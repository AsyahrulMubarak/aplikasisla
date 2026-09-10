const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function section(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return html.slice(a, b);
}
const code = [
  section('        function webAuthnDidukung()', '        async function selesaikanLoginBerhasil('),
  section('        async function selesaikanLoginBerhasil(', '        function bukaModalBug()'),
  section('        async function muatProfilLoginSupabase_(', '        // ==========================================\r\n        // FITUR LOBBY'),
  section('        function normalisasiUsernameLogin_(', '        function sertakanHakAksesCabang_('),
  section('        async function pastikanTokenSupabaseAktif_(', '        // =========================================================================\r\n        // 🚀 GATEWAY')
].join('\n');
const jwt = name => 'header.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, sub: name })).toString('base64url') + '.signature';
const session = name => ({ access_token: jwt(name), refresh_token: 'refresh-' + name, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: name, email: name + '@alfacom.local' } });
const profile = (name, extra = {}) => ({ username: name, nama_asli: name, role: 'sales', hak_akses_cabang: 'Raha', gaji_pokok: 1000000, bonus_tambahan: 100, ...extra });
function storage() {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) };
}
function element(value = '') {
  const attrs = new Map();
  return { value, disabled: false, innerHTML: 'original', innerText: 'Masuk Workspace', style: {}, classList: { add() {}, remove() {} },
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value) };
}
function harness(options = {}) {
  const elements = Object.fromEntries(['username', 'password', 'btn-login-biometric', 'btn-register-biometric', 'biometric-login-status', 'biometric-profile-status'].map(id => [id, element()]));
  elements.username.value = options.username ?? 'alice'; elements.password.value = 'test-password';
  const passwordButton = element();
  const seen = { requests: [], registrations: 0, logins: 0, toasts: [], routes: [], clients: [], sessions: [] };
  let auth = options.auth ?? session('alice');
  const context = {
    console: { log() {}, warn() {}, error() {} }, Date, AbortController, setTimeout, clearTimeout,
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'test-publishable',
    SUPABASE_FETCH_TIMEOUT_MS: 20000, SUPABASE_REFRESH_MARGIN_MS: 60000, promiseRefreshSupabase_: null,
    penggunaAktif: options.user ?? null, waktuLoginAktif: null,
    localStorage: storage(), sessionStorage: storage(),
    document: { getElementById: id => elements[id], querySelector: () => passwordButton },
    navigator: { credentials: { get() {}, create() {} } },
    window: { isSecureContext: true, PublicKeyCredential: function() {}, supabase: {
      createClient(url, key, config) { seen.clients.push(config); return { auth: {
        onAuthStateChange(callback) { seen.authListener = callback; },
        async signInWithPasskey() { seen.logins++; return options.passkey ? options.passkey() : { data: { session: auth, user: auth.user }, error: null }; },
        async setSession(tokens) { seen.sessions.push(tokens); return options.setSession ? options.setSession(tokens) : { data: { session: auth }, error: null }; },
        async registerPasskey() { seen.registrations++; return { data: { id: 'new-passkey' }, error: null }; }
      } }; }
    } },
    async fetch(url, init = {}) {
      seen.requests.push({ url, init });
      if (options.fetch) return options.fetch(url, init);
      if (url.includes('/auth/v1/token')) return { ok: true, json: async () => auth };
      return { ok: true, json: async () => [profile('alice')] };
    },
    showToast: (text, type) => seen.toasts.push({ text, type }),
    waktuKedaluwarsaJwt_: () => Date.now() + 3600000,
    buatErrorSesiSupabase_: message => Object.assign(new Error(message), { code: 'AUTH_EXPIRED' }),
    simpanPembaruanTokenSesi_: () => { seen.saved = context.penggunaAktif && { ...context.penggunaAktif }; },
    perbaruiTokenRealtimeSupabase_: token => { seen.realtime = token; },
    hakAksesCabangPengguna: () => context.penggunaAktif.Hak_Akses_Cabang,
    punyaAksesLobby: () => options.lobby ?? false,
    cabangOtomatisPengguna: () => context.penggunaAktif.Hak_Akses_Cabang,
    aktifkanCabangDanMuat: async (...args) => seen.routes.push(args),
    masukKeAplikasi: () => seen.routes.push(['lobby'])
  };
  vm.createContext(context); vm.runInContext(code, context);
  return { context, elements, passwordButton, seen, password: () => context.prosesLogin({ preventDefault() {}, target: { querySelector: () => passwordButton } }) };
}

test('all inline scripts compile, IDs remain unique, and legacy biometric requests are removed', () => {
  for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (script.trim()) new vm.Script(script);
  for (const id of ['login-form', 'btn-login-biometric', 'btn-register-biometric']) assert.equal([...html.matchAll(new RegExp('id="' + id + '"', 'g'))].length, 1);
  assert.doesNotMatch(html, /kirimWebAuthn|beginBiometricLogin|verifyBiometric|inisialisasiPrefetchLoginBiometrik_/);
});

test('password preserves JWT, refresh token, salary fields, and branch routing', async () => {
  const h = harness(); await h.password();
  assert.equal(h.context.penggunaAktif.Username, 'alice');
  assert.equal(h.context.penggunaAktif.RefreshToken, 'refresh-alice');
  assert.equal(h.context.penggunaAktif['Gaji Pokok'], 1000000);
  assert.equal(h.context.penggunaAktif['Bonus Tambahan'], 100);
  assert.equal(h.seen.routes[0][0], 'Raha');
  assert.equal(JSON.parse(h.seen.requests[0].init.body).password, 'test-password');
  assert.equal(h.passwordButton.disabled, false);
});

test('passkey uses authenticated account even if a different username is typed', async () => {
  const h = harness({ username: 'admin' }); await h.context.prosesLoginBiometrik();
  assert.equal(h.context.penggunaAktif.Username, 'alice');
  assert.equal(h.context.penggunaAktif.RefreshToken, 'refresh-alice');
  assert.ok(h.seen.requests.every(r => !r.url.includes('admin')));
  assert.equal(h.seen.clients[0].auth.experimental.passkey, true);
  assert.equal(h.seen.clients[0].auth.persistSession, false);
  assert.equal(h.seen.clients[0].auth.autoRefreshToken, false);
  assert.equal(h.seen.routes[0][0], 'Raha');
});

test('passkey works with an empty username and password', async () => {
  const h = harness({ username: '' }); h.elements.password.value = '';
  await h.context.prosesLoginBiometrik(); assert.equal(h.context.penggunaAktif.Username, 'alice');
});

test('legacy spaced username resolves through username_login and retains profile fields', async () => {
  const h = harness({ auth: session('abuabid'), username: '', fetch: async url => ({ ok: true, json: async () => url.includes('username_login=eq.abuabid') ? [profile('Abu Abid')] : [] }) });
  await h.context.prosesLoginBiometrik(); assert.equal(h.context.penggunaAktif.Username, 'Abu Abid');
});

test('mismatched profile is rejected even if the profile endpoint returns it', async () => {
  const h = harness({ fetch: async () => ({ ok: true, json: async () => [profile('admin')] }) });
  await h.context.prosesLoginBiometrik(); assert.equal(h.context.penggunaAktif, null); assert.equal(h.seen.routes.length, 0);
});

test('cancelled/disabled passkey releases buttons and allows subsequent password login', async () => {
  for (const error of [{ name: 'NotAllowedError' }, { code: 'passkey_disabled' }]) {
    const h = harness({ passkey: () => ({ data: null, error }) });
    await h.context.prosesLoginBiometrik(); assert.equal(h.passwordButton.disabled, false);
    assert.equal(h.elements['btn-login-biometric'].disabled, false);
    await h.password(); assert.equal(h.context.penggunaAktif.Username, 'alice');
  }
});

test('unsupported browser or missing SDK does not prevent password login', async () => {
  for (const mode of ['browser', 'sdk']) {
    const h = harness();
    if (mode === 'browser') h.context.window.PublicKeyCredential = null; else h.context.window.supabase = null;
    await h.context.prosesLoginBiometrik(); await h.password();
    assert.equal(h.context.penggunaAktif.Username, 'alice');
  }
});

test('concurrent password and passkey attempts cannot race or change the chosen account', async () => {
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  const h = harness({ passkey: () => pending });
  const attempt = h.context.prosesLoginBiometrik();
  await h.password(); await h.context.prosesLoginBiometrik();
  assert.equal(h.seen.logins, 1); assert.equal(h.seen.requests.length, 0);
  finish({ data: { session: session('alice'), user: session('alice').user }, error: null });
  await attempt; assert.equal(h.seen.routes.length, 1);
});

test('registration uses current authenticated session, stores refreshed session, and never sends password', async () => {
  const auth = session('alice'); const h = harness({ auth, user: { Username: 'alice', SessionToken: auth.access_token, RefreshToken: auth.refresh_token, SessionExpiresAt: auth.expires_at * 1000 } });
  await h.context.daftarkanBiometrik();
  assert.equal(h.seen.registrations, 1); assert.equal(h.seen.sessions[0].access_token, auth.access_token);
  assert.equal(h.seen.saved.RefreshToken, auth.refresh_token); assert.equal(h.seen.realtime, auth.access_token);
  assert.equal(h.elements['btn-register-biometric'].disabled, false);
});

test('registration rejects a session belonging to a different account', async () => {
  const h = harness({ auth: session('admin'), user: { Username: 'alice', SessionToken: jwt('alice'), RefreshToken: 'refresh-alice', SessionExpiresAt: Date.now() + 3600000 } });
  await h.context.daftarkanBiometrik(); assert.equal(h.seen.registrations, 0); assert.equal(h.context.penggunaAktif.Username, 'alice');
});

test('SDK refresh during registration synchronizes the active session, never another account', async () => {
  const auth = session('alice');
  const h = harness({ auth, user: { Username: 'alice', SessionToken: auth.access_token, RefreshToken: auth.refresh_token, SessionExpiresAt: auth.expires_at * 1000 } });
  await h.context.daftarkanBiometrik();
  h.seen.authListener('TOKEN_REFRESHED', { ...auth, refresh_token: 'rotated-refresh' });
  assert.equal(h.context.penggunaAktif.RefreshToken, 'rotated-refresh');
  h.seen.authListener('TOKEN_REFRESHED', session('admin'));
  assert.equal(h.context.penggunaAktif.RefreshToken, 'rotated-refresh');
});

test('passkey session supports the existing refresh-token mechanism', async () => {
  const h = harness(); await h.context.prosesLoginBiometrik();
  const token = await h.context.pastikanTokenSupabaseAktif_(true);
  assert.equal(token, jwt('alice'));
  const refresh = h.seen.requests.find(r => r.url.includes('grant_type=refresh_token'));
  assert.equal(JSON.parse(refresh.init.body).refresh_token, 'refresh-alice');
  assert.equal(h.seen.saved.RefreshToken, 'refresh-alice');
});
