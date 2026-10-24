// Uses the real sale form and functions with an isolated database and WhatsApp relay.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('C:/Users/Abu Abid/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(process.env.DIRECT_SALES_HTML_PATH || path.join(root, 'index.html'), 'utf8');
const form = html.match(/<form id="form-sls"[\s\S]*?<\/form>/)[0];
function extract(name) {
  const match = html.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\([^]*?^\\1\\}', 'm'));
  assert.ok(match, name);
  return match[0];
}
const functions = [
  'formatWA', 'normalisasiCabang', 'normalisasiWASementara_', 'normalisasiNamaCustomerProspek_',
  'statusProspekKanonis_', 'statusProspekAktifUntukSinkron_', 'endpointFilterSupabase_', 'pastikanHasilMutasiSupabase_',
  'bukaKunciSalesProspek_', 'kunciDanIsiSalesProspek_', 'deteksiSalesDariProspek',
  'petakanPenjualanSupabase_', 'renderPenjualan',
  'sinkronkanStatusProspekOtomatis_', 'sinkronkanStatusProspekDariPenjualan_', 'kirimNotifWAInternal', 'submitData'
];
const outputDir = process.env.DIRECT_SALES_VERIFY_DIR || path.join(root, 'output/direct-sales-prospect-20261024');

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  const results = [];
  try {
    async function setup(options = {}) {
      await page.setContent('<div id="loading"></div><input id="input-klien" value="Klien Tiket Tetap">' +
        '<input id="input-wa-klien" oninput="formatWA(this); deteksiSalesDariProspek(this, \'sales-group\', \'wa\')">' +
        '<div id="sales-group"><label><input type="checkbox" value="Sales A">Sales A</label></div>' +
        '<input id="search-sls" oninput="renderPenjualan()"><div id="penjualan-container"></div>' + form);
      await page.evaluate(({ source, options }) => {
        window.cabangAktif = options.cabang || 'Kendari';
        window.modeEditTiket = false;
        window.apiUrl = 'https://relay.test.invalid';
        window.events = [];
        window.savedSales = [];
        window.globalPenjualan = [];
        window.toasts = [];
        window.submitComplete = false;
        window.rows = [
          { id_prospek: 'P-A', no_wa: '0812-3456-7890', nama_calon_customer: 'Pembeli Prospek', sales_penanggung_jawab: options.sales || 'Sales A', status_prospek: options.status || 'Tahap Penawaran', cabang: cabangAktif },
          { id_prospek: 'P-B', no_wa: '6289999999999', nama_calon_customer: 'Pembeli Lama', sales_penanggung_jawab: 'Sales B', status_prospek: 'Tahap Penawaran', cabang: cabangAktif },
          { id_prospek: 'P-OTHER', no_wa: '081234567890', nama_calon_customer: 'Cabang Lain', sales_penanggung_jawab: 'Sales B', status_prospek: 'Tahap Penawaran', cabang: cabangAktif === 'Raha' ? 'Kendari' : 'Raha' }
        ];
        window.globalProspek = rows.map(p => ({ 'ID Prospek': p.id_prospek, 'No WA': p.no_wa, 'Nama Calon Customer': p.nama_calon_customer, 'Sales Penanggung Jawab': p.sales_penanggung_jawab, 'Status Prospek': p.status_prospek, Cabang: p.cabang }));
        window.globalUsers = [
          { 'Nama Asli': 'Sales A', 'No WA': '085123456789' },
          { 'Nama Asli': 'Sales B', 'No WA': '085987654321' },
          { 'Nama Asli': 'Sales Nonaktif', 'No WA': '085111111111' }
        ];
        document.getElementById('input-sales-sls-group').innerHTML = ['Sales A', 'Sales B'].map(name => '<label><input type="checkbox" value="' + name + '">' + name + '</label>').join('');
        window.showToast = (message, type) => toasts.push({ message, type });
        window.tampilkanInfoKlienCRM_ = () => {};
        window.togglePenjualanInput = () => {};
        window.rolePengguna = () => 'admin';
        window.roleAdalahAdminOperasional_ = () => true;
        window.dataSesuaiCabangAktif_ = row => row.Cabang === cabangAktif;
        window.dataMasukPeriodeDaftar_ = () => true;
        window.formatRp = value => String(value);
        window.tambahkanHtmlAman_ = (element, content) => element.insertAdjacentHTML('beforeend', content);
        window.callSupabase = async (endpoint, method, payload) => {
          if (endpoint.startsWith('penjualan?')) return [];
          const params = new URL('https://db.test.invalid/' + endpoint).searchParams;
          const selected = rows.filter(p => [...params].every(([key, value]) => {
            if (key === 'select') return true;
            if (key === 'or') return p.cabang === 'Kendari' || p.cabang == null;
            return value === 'eq.' + p[key];
          }));
          if (method !== 'PATCH') return structuredClone(selected);
          events.push({ kind: 'closing', endpoint });
          if (options.patchError) throw Error('Pembaruan ditolak');
          selected.forEach(p => Object.assign(p, payload));
          return structuredClone(selected);
        };
        window.kirimKeBackend_ = async (_url, action, payload) => {
          events.push({ kind: 'whatsapp', action, ...payload });
          return { status: options.notificationError ? 'gagal' : 'sukses', terkirim: !options.notificationError };
        };
        window.idPenjualanTerbaruDariServer_ = async () => 'SLS-TEST';
        window.tanggalIsoSupabase_ = () => '2026-10-24T09:00:00+08:00';
        window.angkaRupiahSupabase_ = Number;
        window.adminSlaSupabase_ = () => 'Admin';
        window.simpanPenjualanTanpaBentrok_ = async record => {
          events.push({ kind: 'sale', record });
          if (options.saveError) throw Error('Penyimpanan ditolak');
          savedSales.push(structuredClone(record));
        };
        window.sinkronkanDatabaseKlienSupabase_ = async () => events.push({ kind: 'crm' });
        window.switchTab = () => {};
        window.ambilSemuaData = async () => {
          globalPenjualan = savedSales.map(petakanPenjualanSupabase_);
          renderPenjualan();
        };
        (0, eval)(source);
        const originalSubmit = window.submitData;
        window.submitData = async (...args) => {
          try { return await originalSubmit(...args); }
          finally { window.submitComplete = true; }
        };
      }, { source: functions.map(extract).join('\n'), options });
    }
    async function selected() {
      return page.locator('#input-sales-sls-group input:checked').evaluateAll(inputs => inputs.map(input => input.value));
    }
    async function save() {
      await page.locator('#input-notrans-sls').fill('SO-TEST');
      await page.locator('#input-barang-sls').fill('Printer');
      await page.locator('#input-nilai-sls').fill('1500000');
      await page.locator('#btn-submit-sls').click();
      await page.waitForFunction(() => window.submitComplete);
      return page.evaluate(() => ({ rows, events, toasts }));
    }

    await setup();
    await page.locator('#input-pembeli-sls').fill('Pembeli Lama');
    assert.deepEqual(await selected(), ['Sales B']);
    await page.locator('#input-wa-sls').fill('081234567890');
    assert.deepEqual(await selected(), ['Sales A']);
    assert.equal(await page.locator('#input-pembeli-sls').inputValue(), 'Pembeli Lama');
    assert.equal(await page.locator('#input-klien').inputValue(), 'Klien Tiket Tetap');
    await page.locator('#input-pembeli-sls').fill('Nama pembeli ditulis berbeda');
    assert.deepEqual(await selected(), ['Sales A']);
    assert.equal(await page.locator('#input-pembeli-sls').inputValue(), 'Nama pembeli ditulis berbeda');
    await page.locator('#input-wa-sls').fill('0811111111111');
    assert.deepEqual(await selected(), []);
    assert.equal(await page.locator('#input-sales-sls-group input:disabled').count(), 0);
    await page.locator('#input-sales-sls-group input[value="Sales B"]').check();
    await page.locator('#input-pembeli-sls').fill('Pembeli Lama');
    assert.deepEqual(await selected(), ['Sales B']);
    await page.locator('#input-wa-sls').fill('');
    await page.locator('#input-wa-sls').fill('+62 812-3456-7890');
    assert.deepEqual(await selected(), ['Sales A']);
    const saved = await save();
    assert.equal(saved.events[0].kind, 'sale');
    assert.equal(saved.events[0].record.sales, 'Sales A');
    assert.equal(saved.events[0].record.nama_pembeli, 'Pembeli Lama');
    assert.equal(saved.events[0].record.no_wa_pembeli, '6281234567890');
    assert.equal(await page.locator('#penjualan-container a').getAttribute('href'), 'https://wa.me/6281234567890');
    await page.locator('#search-sls').fill('081234567890');
    assert.equal(await page.locator('#penjualan-container .card').count(), 1);
    await page.locator('#search-sls').fill('');
    assert.deepEqual(saved.events.map(event => event.kind), ['sale', 'closing', 'whatsapp', 'crm']);
    assert.equal(saved.rows[0].status_prospek, 'Closing / Deal');
    assert.equal(saved.rows[2].status_prospek, 'Tahap Penawaran');
    assert.equal(saved.events[2].nomorTujuan, '6285123456789');
    assert.match(saved.events[2].pesan, /Closing \/ Deal/);
    assert.equal(await page.locator('#input-sales-sls-group input:disabled').count(), 0);
    assert.deepEqual(await selected(), []);
    const repeat = await page.evaluate(() => sinkronkanStatusProspekDariPenjualan_('081234567890', 'Alias', { sales: 'Sales A', cabang: 'Kendari' }));
    assert.equal(repeat.diperbarui, 0);
    assert.equal(await page.evaluate(() => events.filter(event => event.kind === 'whatsapp').length), 1);
    results.push('Nama dan WA memakai form penjualan; WA diprioritaskan; urutan simpan, Closing, WA; cabang lain tetap; tanpa notifikasi ganda.');

    await page.evaluate(() => {
      globalPenjualan = [petakanPenjualanSupabase_({ id_penjualan: 'SLS-OLD', cabang: 'Kendari', nama_pembeli: 'Data Lama' })];
      renderPenjualan();
    });
    assert.match(await page.locator('#penjualan-container').innerText(), /WhatsApp Pembeli: Belum tercatat/);
    assert.equal(await page.locator('#penjualan-container a').count(), 0);
    await setup();
    await page.locator('#input-pembeli-sls').fill('Pembeli Baru');
    await page.locator('#input-wa-sls').fill('0812');
    await page.locator('#input-sales-sls-group input[value="Sales A"]').check();
    const invalid = await save();
    assert.equal(invalid.events.length, 0);
    assert.match(invalid.toasts.at(-1).message, /Nomor WhatsApp pembeli tidak valid/);
    results.push('WA tersimpan dalam transaksi, tampil sebagai tautan, bisa dicari dengan awalan 08; data lama kosong dan nomor tidak valid ditangani.');

    await setup({ cabang: 'Raha', status: 'Pending', sales: 'Sales A, Sales Nonaktif' });
    await page.locator('#input-wa-sls').fill('081234567890');
    assert.deepEqual(await selected(), ['Sales A', 'Sales Nonaktif']);
    const multi = await save();
    assert.equal(multi.rows[0].status_prospek, 'Closing / Deal');
    assert.equal(multi.events.filter(event => event.kind === 'whatsapp').length, 2);
    assert.equal(await page.locator('#input-sales-sls-group input[data-prospek-dinamis]').count(), 0);
    results.push('Cabang Raha, status Pending, dan lebih dari satu sales termasuk sales yang tidak ada di pilihan form.');

    for (const options of [{ saveError: true }, { patchError: true }, { notificationError: true }]) {
      await setup(options);
      await page.locator('#input-wa-sls').fill('081234567890');
      const state = await save();
      if (options.saveError) {
        assert.equal(state.rows[0].status_prospek, 'Tahap Penawaran');
        assert.deepEqual(state.events.map(event => event.kind), ['sale']);
        assert.equal(state.toasts.at(-1).type, 'error');
      } else if (options.patchError) {
        assert.equal(state.rows[0].status_prospek, 'Tahap Penawaran');
        assert.equal(state.events.filter(event => event.kind === 'whatsapp').length, 0);
        assert.equal(state.toasts.at(-1).type, 'warning');
      } else {
        assert.equal(state.rows[0].status_prospek, 'Closing / Deal');
        assert.equal(state.toasts.at(-1).type, 'warning');
        assert.match(state.toasts.at(-1).message, /WhatsApp ke sales belum terkonfirmasi/);
      }
    }
    results.push('Simpan gagal tidak mengubah prospek; PATCH gagal tidak mengirim WA; kegagalan WA tampil sebagai peringatan.');

    await setup();
    await page.evaluate(() => { globalProspek = globalProspek.filter(prospect => prospect.Cabang === cabangAktif); });
    await page.locator('#input-wa-klien').fill('081234567890');
    assert.equal(await page.locator('#input-klien').inputValue(), 'Pembeli Prospek');
    assert.equal(await page.locator('#sales-group input:checked').inputValue(), 'Sales A');
    assert.equal(await page.locator('#input-pembeli-sls').inputValue(), '');
    results.push('Autofill nomor WA pada form tiket tetap berfungsi tanpa mengubah form penjualan.');

    assert.deepEqual(errors, []);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'verification.json'), JSON.stringify({ passed: true, scenarios: results, browserErrors: errors, externalMessagesSent: 0 }, null, 2));
    console.log(JSON.stringify({ passed: true, scenarios: results.length, browserErrors: errors.length, externalMessagesSent: 0 }));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
