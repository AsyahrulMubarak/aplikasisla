const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extract(source, name) {
  const match = source.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\([^]*?^\\1\\}', 'm'));
  assert.ok(match, `Missing function: ${name}`);
  return match[0];
}

function createHarness(role = 'admin') {
  const elements = {};
  const calls = [];
  const toasts = [];
  const warranty = {
    'ID Garansi': 'GRS-009',
    'Nama Pelanggan': 'Pelanggan Uji',
    'Barang / Jasa': 'Laptop Uji',
    'Durasi (Hari)': 7,
    Status: 'Diklaim (Hangus)',
    'Tanggal Mulai': '2026-09-01T02:00:00.000Z',
    'Tanggal Habis': '2026-09-03T04:00:00.000Z',
    Keterangan: 'Catatan lama',
    Cabang: 'Kendari'
  };

  const ids = [
    'edit-garansi-id', 'edit-garansi-status', 'edit-garansi-durasi',
    'edit-garansi-mulai', 'edit-garansi-habis', 'edit-garansi-keterangan',
    'edit-garansi-ringkasan', 'edit-garansi-bantuan', 'modal-edit-garansi',
    'btn-simpan-edit-garansi'
  ];
  ids.forEach(id => {
    elements[id] = { value: '', textContent: '', innerText: '', disabled: false, style: {} };
  });
  elements['btn-simpan-edit-garansi'].innerText = 'Simpan Perubahan';

  const context = vm.createContext({
    console,
    Date,
    Number,
    String,
    Math,
    globalGaransi: [warranty],
    document: { getElementById(id) { return elements[id] || null; } },
    parseSafeDate(value) { return value instanceof Date ? value : new Date(value); },
    roleAdalahAdminOperasional_() { return role === 'admin' || role === 'admin_raha'; },
    rolePengguna() { return role; },
    idAman_(value) { const id = String(value || '').trim(); return /^[A-Za-z0-9._-]{1,120}$/.test(id) ? id : ''; },
    dataSesuaiCabangAktif_() { return true; },
    showToast(message, type) { toasts.push({ message, type }); },
    tanggalIsoSupabase_(value = new Date()) { return new Date(value).toISOString(); },
    endpointFilterSupabase_(table, column, value) { return `${table}?${column}=eq.${encodeURIComponent(String(value).trim())}`; },
    async callSupabase(endpoint, method, payload) {
      calls.push({ endpoint, method, payload });
      return [{ id_garansi: 'GRS-009' }];
    },
    pastikanHasilMutasiSupabase_(result) {
      if (!Array.isArray(result) || !result.length) throw new Error('Mutation rejected');
      return result;
    },
    async ambilSemuaData() { calls.push({ reload: true }); }
  });

  for (const name of [
    'formatTanggalInputGaransi_', 'tanggalDariInputGaransi_',
    'sinkronkanFormEditGaransi_', 'bukaEditGaransi', 'simpanEditGaransi'
  ]) {
    vm.runInContext(extract(html, name), context);
  }

  return { context, elements, calls, toasts, warranty };
}

test('warranty cards expose a sanitized edit action and a dedicated edit form', () => {
  assert.match(html, /onclick="bukaEditGaransi\('\$\{idGrs\}'\)"[^>]*>✏️ Edit Kartu Garansi/);
  assert.match(html, /id="modal-edit-garansi"/);
  assert.match(html, /id="edit-garansi-keterangan"/);
  assert.match(html, /bukaEditGaransi\|hapusGaransi/);
});

test('an accidental claim can be restored to active from the actual activation time', async () => {
  const { context, elements, calls } = createHarness('admin');
  context.bukaEditGaransi('GRS-009');

  assert.equal(elements['modal-edit-garansi'].style.display, 'flex');
  assert.equal(elements['edit-garansi-status'].value, 'Diklaim (Hangus)');
  assert.equal(elements['edit-garansi-keterangan'].value, 'Catatan lama');

  elements['edit-garansi-status'].value = 'Aktif';
  elements['edit-garansi-durasi'].value = '7';
  elements['edit-garansi-mulai'].value = '2026-09-01T10:00:00';
  elements['edit-garansi-keterangan'].value = 'Klaim dibatalkan karena salah pilih kartu';
  context.sinkronkanFormEditGaransi_();
  assert.equal(elements['edit-garansi-habis'].value, '2026-09-08T10:00:00');

  await context.simpanEditGaransi({ preventDefault() {} });
  const mutation = calls.find(call => call.method === 'PATCH');
  assert.equal(mutation.endpoint, 'garansi?id_garansi=eq.GRS-009');
  assert.deepEqual(Object.keys(mutation.payload).sort(), [
    'durasi_hari', 'keterangan', 'status', 'tanggal_habis', 'tanggal_mulai'
  ]);
  assert.equal(mutation.payload.status, 'Aktif');
  assert.equal(mutation.payload.durasi_hari, 7);
  assert.equal(mutation.payload.keterangan, 'Klaim dibatalkan karena salah pilih kartu');
  assert.equal(new Date(mutation.payload.tanggal_habis) - new Date(mutation.payload.tanggal_mulai), 7 * 24 * 60 * 60 * 1000);
  assert.equal(elements['modal-edit-garansi'].style.display, 'none');
});

test('late activation correction recalculates expiry and does not patch unrelated warranty columns', async () => {
  const { context, elements, calls, warranty } = createHarness('manager');
  warranty.Status = 'Masa Tunggu';
  warranty['Tanggal Mulai'] = null;
  warranty['Tanggal Habis'] = null;
  context.bukaEditGaransi('GRS-009');

  elements['edit-garansi-status'].value = 'Aktif';
  elements['edit-garansi-durasi'].value = '30';
  elements['edit-garansi-mulai'].value = '2026-09-10T14:05:06';
  context.sinkronkanFormEditGaransi_();
  await context.simpanEditGaransi({ preventDefault() {} });

  const payload = calls.find(call => call.method === 'PATCH').payload;
  assert.equal(payload.status, 'Aktif');
  assert.equal(new Date(payload.tanggal_habis) - new Date(payload.tanggal_mulai), 30 * 24 * 60 * 60 * 1000);
  for (const forbidden of ['id_garansi', 'referensi_tiket_nota', 'nama_pelanggan', 'barang_jasa', 'no_transaksi', 'sales', 'omzet', 'cabang', 'admin_sla']) {
    assert.equal(Object.hasOwn(payload, forbidden), false, `${forbidden} must remain untouched`);
  }
});

test('non-management users cannot open or save warranty edits', async () => {
  const { context, elements, calls, toasts } = createHarness('sales');
  context.bukaEditGaransi('GRS-009');
  assert.notEqual(elements['modal-edit-garansi'].style.display, 'flex');
  await context.simpanEditGaransi({ preventDefault() {} });
  assert.equal(calls.length, 0);
  assert.equal(toasts.filter(item => item.type === 'error').length, 2);
});
