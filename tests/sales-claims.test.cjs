const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const frontend = read('index.html');
const moduleSource = read('maintenance/sales-claims-backend.gs').trim();
const actor = { username_login: 'admin-k', nama_asli: 'Admin Kendari', role: 'admin', hak_akses_cabang: 'Semua' };
const foto = 'data:image/jpeg;base64,' + 'A'.repeat(100);
const event = { id: 'event-1', klaim_id: 'claim-1', lease_id: 'lease-1', jenis: 'Diajukan', penerima_username: 'admin-k',
  snapshot: { id_tiket: 'TKR-1', cabang: 'Raha', sales: 'Sales Raha', klien: 'Klien Uji', pekerjaan: 'Pekerjaan Uji' } };
function backend(file, user = actor, opts = {}) {
  const calls = [], sent = [], sleeps = [];
  const queue = (opts.events === undefined ? [event] : opts.events).slice();
  let fakeTime = 0;
  const c = vm.createContext({ console: { error() {}, log() {} },
    Utilities: { sleep: ms => { sleeps.push(ms); fakeTime += ms; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-only' }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) }
  });
  const source = read(file);
  vm.runInContext(source, c);
  c.verifikasiSessionToken_ = () => opts.valid !== false;
  c.callSupabaseServiceRole_ = (endpoint, method, payload) => {
    calls.push({ endpoint, method, payload: payload && structuredClone(payload) });
    if (endpoint.startsWith('users?')) {
      return endpoint.includes('no_wa') ? [{ ...actor, username_login: event.penerima_username, no_wa: opts.phone === undefined ? '081234567890' : opts.phone }] : [user];
    }
    if (endpoint.startsWith('tiket?')) return opts.rows || [];
    if (endpoint === 'rpc/sla_mulai_pengiriman_klaim_sales') return opts.busy ? null : 'worker-lease';
    if (endpoint === 'rpc/sla_akhiri_pengiriman_klaim_sales') return true;
    if (endpoint === 'rpc/sla_ambil_notif_klaim_sales') return queue.length ? [queue.shift()] : [];
    if (endpoint.startsWith('sla_notif_klaim_sales?')) return [];
    if (endpoint === 'rpc/sla_selesaikan_notif_klaim_sales') return true;
    if (opts.mutationError) throw new Error(opts.mutationError);
    return { klaim_id: 'claim-1', status: payload.p_keputusan || 'Diajukan' };
  };
  c.hasilKirimNotifWA_ = (number, message) => { sent.push({ number, message, at: fakeTime }); return { ok: !opts.waFail, pesan: 'gateway-test' }; };
  return { c, calls, sent, sleeps, run(data) {
    return c.doPost({ postData: { contents: JSON.stringify({ apiKey: vm.runInContext('SECRET_API_KEY', c),
      user: { Username: user.username_login, SessionToken: 'test-session', Role: 'admin', 'No WA': '089999999999' }, ...data }) } });
  } };
}

for (const file of ['code.js', 'coderaha.js.txt']) {
  test(`${file}: routes claim actions through the tested module before legacy sheets`, () => {
    const source = read(file);
    assert.ok(source.includes(moduleSource));
    assert.equal((source.match(/function prosesKlaimSales_\(/g) || []).length, 1);
    assert.ok(source.indexOf("JSON.stringify(prosesKlaimSales_(data))") < source.indexOf('var otorisasi = otorisasiAction_(data, ss)'));
    assert.ok(!source.includes('sheetTiket.getRange(i+1, 24).setValue(data.statusBanding)'));
    assert.ok(source.includes('klien_lokasi,pekerjaan:jenis_pekerjaan,sales,status_banding'), 'Use the actual production ticket column with the UI alias');
  });
  for (const [role, branch, allowed] of [['admin','Kendari',true],['admin','Semua',true],['admin','',true],
    ['admin','Raha',false],['admin','Unknown',false],['admin_raha','Raha',false],['manager','Semua',false],['direktur','Semua',false],['sales','Kendari',false]]) {
    test(`${file}: ${role}/${branch} list and decision access follows Admin Kendari policy`, () => {
      for (const action of ['getKlaimSales', 'getBuktiKlaimSales', 'responBanding']) {
        const h = backend(file, { ...actor, role, hak_akses_cabang: branch }, { events: [], rows:[{bukti_banding:foto}] });
        const r = h.run({ action, idTiket: 'TKR-1', cabang: 'Raha', statusBanding: 'Diterima', role: 'admin', namaSales: 'Forged Name' });
        assert.equal(r.status, allowed ? 'sukses' : 'gagal');
        if (!allowed) assert.ok(h.calls.every(call => call.method === 'get'));
      }
    });
  }
  test(`${file}: unverified sessions cannot list, submit or decide`, () => {
    for (const action of ['getKlaimSales', 'getBuktiKlaimSales', 'ajukanBanding', 'responBanding']) {
      const h = backend(file, actor, { valid: false });
      assert.equal(h.run({ action }).status, 'gagal'); assert.equal(h.calls.length, 0); assert.equal(h.sent.length, 0);
    }
  });
  test(`${file}: list fetches both branches and all pages without WA or writes`, () => {
    const h = backend(file), records = Array.from({ length: 502 }, (_, i) => ({ id_tiket: 'TKT-' + i, status_banding: 'Diajukan' }));
    h.c.callSupabaseServiceRole_ = (endpoint, method) => {
      assert.equal(method, 'get');
      if (endpoint.startsWith('users?')) return [actor];
      assert.match(endpoint, /cabang.eq.Kendari,cabang.eq.Raha,cabang.is.null/);
      assert.match(endpoint, /status_banding=in.\(Diajukan,Diterima,Ditolak\)/);
      assert.ok(!endpoint.includes('bukti_banding'), 'Queue refresh must not download every evidence image');
      const offset = Number(endpoint.match(/offset=(\d+)/)[1]);
      return records.slice(offset, offset + 500);
    };
    assert.equal(h.run({ action: 'getKlaimSales' }).data.length, 502); assert.equal(h.sent.length, 0);
  });
  test(`${file}: submission binds stored actor and sends admin WA for Raha`, () => {
    const sales = { ...actor, username_login: 'sales-r', role: 'sales', hak_akses_cabang: 'Raha' };
    const h = backend(file, sales);
    const result = h.run({ action: 'ajukanBanding', idTiket: 'TKR-1', cabang: 'Raha', buktiBanding: foto,
      namaSales: 'Forged Name', noWA: '089999999999', keteranganSales: 'Bukti transaksi' });
    assert.equal(result.status, 'sukses');
    const mutation = h.calls.find(c => c.endpoint === 'rpc/sla_ajukan_klaim_sales');
    assert.equal(mutation.payload.p_actor, 'sales-r'); assert.equal(mutation.payload.p_cabang, 'Raha');
    assert.ok(!JSON.stringify(mutation.payload).includes('Forged Name'));
    assert.equal(h.sent.length, 1); assert.equal(h.sent[0].number, '6281234567890');
    assert.match(h.sent[0].message, /Admin Kendari/); assert.match(h.sent[0].message, /Raha/); assert.match(h.sent[0].message, /lobby/);
  });
  test(`${file}: validates evidence, rejection reason and status before mutation`, () => {
    for (const data of [
      { action: 'ajukanBanding', buktiBanding: 'https://example.invalid/photo', userRole: 'sales' },
      { action: 'ajukanBanding', buktiBanding: Array(4).fill(foto).join('|#|'), userRole: 'sales' },
      { action: 'responBanding', statusBanding: 'Ditolak', alasanAdmin: ' ' },
      { action: 'responBanding', statusBanding: 'Unknown' },
      { action: 'responBanding', statusBanding: 'Diterima', cabang: 'Unknown' }
    ]) {
      const h = backend(file, data.userRole ? { ...actor, role: data.userRole } : actor);
      const result = h.run({ idTiket: 'TKR-1', cabang: 'Raha', ...data });
      assert.equal(result.status, 'gagal'); assert.ok(h.calls.every(c => c.method === 'get')); assert.equal(h.sent.length, 0);
    }
  });
  for (const decision of ['Diterima', 'Ditolak']) test(`${file}: ${decision} notifies stored applicant with reason`, () => {
    const h = backend(file, actor, { events: [{ ...event, jenis: decision, penerima_username: 'sales-r', snapshot: { ...event.snapshot, alasan: 'Bukti belum sesuai' } }] });
    h.c.callSupabaseServiceRole_ = ((original) => (endpoint, method, payload) => {
      if (endpoint.startsWith('users?') && endpoint.includes('no_wa')) {
        assert.match(endpoint, /username_login=eq.sales-r/);
        return [{ role: 'sales', no_wa: '085555555555' }];
      }
      return original(endpoint, method, payload);
    })(h.c.callSupabaseServiceRole_);
    assert.equal(h.run({ action: 'responBanding', idTiket: 'TKR-1', cabang: 'Raha', statusBanding: decision, alasanAdmin: 'Bukti belum sesuai', namaSales: 'Forged' }).status, 'sukses');
    assert.equal(h.sent[0].number, '6285555555555'); assert.ok(h.sent[0].message.includes(decision.toUpperCase()));
    assert.equal(h.sent[0].message.includes('Alasan penolakan: Bukti belum sesuai'), decision === 'Ditolak');
  });
  test(`${file}: provider or missing phone failures preserve claim and retry event`, () => {
    for (const opts of [{ waFail: true }, { phone: '' }]) {
      const h = backend(file, actor, opts), r = h.run({ action: 'responBanding', idTiket: 'TKR-1', cabang: 'Raha', statusBanding: 'Diterima' });
      assert.equal(r.status, 'sukses'); assert.equal(r.notifikasi.gagal, 1);
      assert.equal(h.calls.find(c => c.endpoint === 'rpc/sla_selesaikan_notif_klaim_sales').payload.p_terkirim, false);
    }
  });
  test(`${file}: rejected or concurrently processed claims never send WA`, () => {
    const h = backend(file, actor, { mutationError: 'Klaim sudah diproses.' });
    assert.equal(h.run({ action: 'responBanding', idTiket: 'TKR-1', cabang: 'Raha', statusBanding: 'Diterima' }).status, 'gagal');
    assert.equal(h.sent.length, 0); assert.ok(!h.calls.some(c => c.endpoint === 'rpc/sla_ambil_notif_klaim_sales'));
  });
  test(`${file}: concurrent applicants share a sequential sender with 2-second waits`, () => {
    const h = backend(file, actor, { events: [event, { ...event, id: 'event-2', klaim_id: 'claim-2' }, { ...event, id: 'event-3', klaim_id: 'claim-3' }] });
    const result = h.c.prosesAntreanNotifKlaimSales_(null);
    assert.equal(result.terkirim, 3); assert.deepEqual(h.sleeps, [2000,2000,2000]);
    assert.deepEqual(h.sent.map(s => s.at), [2000,4000,6000]);
    assert.equal(h.calls.filter(c => c.endpoint === 'rpc/sla_mulai_pengiriman_klaim_sales').length, 1);
    assert.equal(h.calls.at(-1).endpoint, 'rpc/sla_akhiri_pengiriman_klaim_sales');
    assert.ok(h.calls.filter(c => c.endpoint === 'rpc/sla_ambil_notif_klaim_sales').every(c => c.payload.p_klaim_id === null));
  });
  test(`${file}: busy sender leaves simultaneous requests queued without competing WA sends`, () => {
    const h = backend(file, actor, { busy: true });
    const result = h.run({ action:'responBanding', idTiket:'TKR-1', cabang:'Raha', statusBanding:'Diterima' });
    assert.equal(result.status,'sukses'); assert.equal(result.notifikasi.tertunda,true);
    assert.equal(h.sent.length,0); assert.equal(h.sleeps.length,0);
    assert.ok(!h.calls.some(c => c.endpoint === 'rpc/sla_ambil_notif_klaim_sales'));
  });
  test(`${file}: evidence loads only for the requested branch and a verified admin, without WA`, () => {
    const h=backend(file,actor,{rows:[{bukti_banding:foto}]});
    const r=h.run({action:'getBuktiKlaimSales',idTiket:'TKR-1',cabang:'Raha'});
    assert.equal(r.status,'sukses');assert.equal(r.data,foto);
    assert.match(h.calls.find(c=>c.endpoint.startsWith('tiket?')).endpoint,/id_tiket=eq.TKR-1&cabang=eq.Raha/);
    assert.equal(h.sent.length,0);assert.ok(h.calls.every(c=>c.method==='get'));
  });
  test(`${file}: retry trigger is installed once every 5 minutes on Kendari only`, () => {
    const h=backend(file),triggers=[];let created=0;
    h.c.cabangDeployment_=()=> 'Kendari';
    h.c.ScriptApp={getProjectTriggers:()=>triggers,newTrigger:name=>{
      assert.equal(name,'kirimUlangNotifKlaimSales');
      const builder={timeBased(){return builder;},everyMinutes(minutes){assert.equal(minutes,5);return builder;},create(){created++;triggers.push({getHandlerFunction:()=>name});}};
      return builder;
    }};
    assert.equal(h.c.pasangTriggerNotifKlaimSales().status,'sukses');
    h.c.pasangTriggerNotifKlaimSales();assert.equal(created,1);
    h.c.cabangDeployment_=()=> 'Raha';assert.throws(()=>h.c.pasangTriggerNotifKlaimSales(),/hanya pada backend Kendari/);
    assert.equal(h.sent.length,0);
  });
}

function extract(name) {
  const match = frontend.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\([^]*?^\\1\\}', 'm'));
  assert.ok(match, name); return match[0];
}
function ui(user = { Role: 'admin', Hak_Akses_Cabang: 'Semua' }) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: id.includes('filter-status') ? 'all' : '', style: {}, textContent: '',
      classList: { toggle() {} }, setAttribute() {}, html: '' });
    return elements.get(id);
  };
  const c = vm.createContext({ URL, window: { location: { origin: 'https://example.invalid' } }, penggunaAktif: user,
    globalKlaimSales: [], tampilanKlaimSales_: 'riwayat', klaimSalesSedangDiproses_: new Set(),
    cacheBuktiKlaimSales_:new Map(),buktiKlaimSalesSedangDimuat_:new Set(),
    document: { getElementById: element }, tetapkanHtmlAman_: (el, html) => { el.html = html; },
    normalisasiCabang: v => v || '', formatWaktu: v => v, showToast() {} });
  for (const name of ['amanTeks_', 'idAman_', 'urlAman_', 'penggunaAdminKendariKlaim_', 'cabangKlaimSalesDiizinkan_', 'penggunaBolehKelolaKlaimSales_', 'klaimSalesMasukRiwayat_', 'renderKlaimSales', 'responBanding']) vm.runInContext(extract(name), c);
  return { c, element };
}
test('Lobby contains one claim menu controlled by account and branch permissions', () => {
  assert.equal((frontend.match(/id="btn-lobby-klaim-sales"/g) || []).length, 1);
  const lobby = frontend.slice(frontend.indexOf('<div id="main-lobby-wrapper"'), frontend.indexOf('<div id="klaim-sales-wrapper"'));
  assert.match(lobby, /id="btn-lobby-klaim-sales"[^>]*data-lobby-menu="klaim-sales"/);
  assert.match(extract('penggunaBolehMenuLobby_'), /menu === 'klaim-sales'.*penggunaBolehKelolaKlaimSales_\(user\)/);
});
test('All pending claims are new, including claims without a timestamp', () => {
  const h = ui();
  for (const [status, date, history] of [['Diajukan',null,false],['Diterima',null,true],['Ditolak',null,true],
    ['Diajukan','2026-09-30T08:00:00Z',false],['Diterima','2026-09-30T08:00:00Z',true]]) {
    assert.equal(h.c.klaimSalesMasukRiwayat_({ status_banding: status, klaim_sales_diajukan_pada: date }), history);
  }
});
test('Pending claims remain actionable and history preserves decided claims across both branches', () => {
  const h = ui();
  h.c.globalKlaimSales = [
    { id_tiket: 'TKT-OLD', cabang: null, status_banding: 'Diajukan', sales_pengaju: '<script>evil()</script>', klaim_sales_username: 'sales-k', bukti_banding: 'javascript:evil()' },
    { id_tiket: 'TKR-OLD', cabang: 'Raha', status_banding: 'Ditolak', alasan_admin: '<img onerror=evil()>', bukti_banding: foto },
    { id_tiket: 'TKR-NEW', cabang: 'Raha', status_banding: 'Diajukan', klaim_sales_diajukan_pada: '2026-09-30' }
  ];
  h.c.tampilanKlaimSales_='baru';h.c.renderKlaimSales();
  const kendari=h.element('klaim-kendari-container').html,raha=h.element('klaim-raha-container').html;
  assert.ok(kendari.includes('TKT-OLD')&&!kendari.includes('TKR-OLD'));assert.ok(raha.includes('TKR-NEW')&&!raha.includes('TKR-OLD'));
  assert.ok(kendari.includes("responBanding('TKT-OLD', 'Diterima', 'Kendari')"));assert.ok(kendari.includes('&lt;script&gt;'));assert.ok(!kendari.includes('javascript:evil()'));
  h.c.tampilanKlaimSales_='riwayat';h.c.renderKlaimSales();
  const history=h.element('klaim-raha-container').html;assert.ok(history.includes('TKR-OLD')&&!history.includes('TKR-NEW'));assert.ok(history.includes('&lt;img onerror=evil()&gt;'));assert.ok(history.includes('data:image/jpeg;base64,'));assert.ok(!history.includes('Terima Klaim'));
});
test('Status and search filters preserve branch grouping', () => {
  const h = ui(); h.c.globalKlaimSales = [{ id_tiket: 'TKT-1', cabang: 'Kendari', status_banding: 'Diterima', sales_pengaju: 'Sales A' },
    { id_tiket: 'TKR-1', cabang: 'Raha', status_banding: 'Ditolak', sales_pengaju: 'Sales B' }];
  h.element('filter-status-klaim-sales').value = 'Ditolak'; h.element('search-klaim-sales').value = 'sales b'; h.c.renderKlaimSales();
  assert.ok(!h.element('klaim-kendari-container').html.includes('TKT-1')); assert.ok(h.element('klaim-raha-container').html.includes('TKR-1'));
  assert.ok(!h.element('klaim-raha-container').html.includes('<img '));
});
test('UI denies other roles and Admin with Raha-only access even when called directly', async () => {
  for (const [Role, Hak_Akses_Cabang] of [['admin','Raha'],['admin_raha','Raha'],['teknisi','Semua'],['sales','Kendari']]) {
    const h = ui({ Role, Hak_Akses_Cabang });
    assert.equal(h.c.penggunaAdminKendariKlaim_(), false);
    h.c.kirimKeBackend_ = () => { throw new Error('Must not call backend'); };
    await h.c.responBanding('TKT-1', 'Diterima', 'Kendari');
  }
});
