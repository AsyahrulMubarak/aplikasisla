'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.TZ = 'Asia/Makassar';
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(name) {
  const match = html.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\([^]*?^\\1\\}', 'm'));
  assert.ok(match, name);
  return match[0];
}
const user = (role = 'teknisi', salary = 2000000, branch = 'Raha') => ({
  Role: role, 'Nama Asli': 'Wawan', Username: 'wawan', SessionToken: 'test-token',
  Hak_Akses_Cabang: branch, 'Gaji Pokok': salary
});
const functions = [
  'normalisasiCabang', 'rolePengguna', 'hakAksesCabangPengguna', 'roleAdalahAdminOperasional_',
  'roleAdalahManajemen_', 'penggunaSalesLintasCabang_', 'penggunaBolehMengaksesCabang',
  'penggunaBergajiDiizinkanModul_', 'penggunaBolehMengaksesAbsensi_', 'penggunaBolehMengaksesSlipGaji_',
  'penggunaBolehMengaksesKpi_', 'penggunaAdminKendariKlaim_', 'penggunaBolehTabSLA_',
  'penggunaBolehMenuLobby_', 'dataSesuaiCabangAktif_', 'parseSafeDate', 'daftarTeknisiUnikTiket_',
  'poinHangusKarenaSLA_', 'statusPoinSudahCair_', 'normalisasiNoTransaksiNota_',
  'tanggalNotaDariNomorTransaksi_', 'rekapStatusNotaIpos_', 'renderDashboard',
  'petakanTiketSupabase_', 'petakanGaransiSupabase_', 'petakanPenjualanSupabase_', 'petakanProspekSupabase_',
  'kolomGaransiPengguna_', 'hentikanRingkasanLobby_', 'aturTataLetakLobby_', 'muatRingkasanLobby_', 'amanTeks_', 'buatHtmlPerformaAdmin_',
  'buatHtmlKartuTeknisi_', 'buatHtmlKartuSales_'
];
function harness(activeUser = user()) {
  const elements = new Map();
  const node = id => {
    if (!elements.has(id)) elements.set(id, { style: {}, innerHTML: '', textContent: '', value: '', selectedOptions: [], classList: { toggle() {} }, setAttribute() {} });
    return elements.get(id);
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-01T12:00:00+08:00'])); }
  }
  const c = vm.createContext({ Date: FixedDate, AbortController, console,
    API_URL_CABANG: { Kendari: 'test', Raha: 'test' }, penggunaAktif: activeUser, cabangAktif: 'Raha',
    globalUsers: [activeUser], globalTickets: [], globalGaransi: [], globalPenjualan: [], globalProspek: [],
    document: { getElementById: node }, hitungDurasiJamKerjaMs: () => 0,
    punyaAksesLobby: () => true, tampilkanRingkasanLobby_: () => {}
  });
  vm.runInContext('let permintaanRingkasanLobby_ = null, urutanRingkasanLobby_ = 0, waktuRingkasanLobby_ = 0;\n' + functions.map(extract).join('\n'), c);
  node('lobby-cabang').value = 'Raha';
  node('lobby-periode').value = '2026-09';
  return { c, node };
}
const ticket = (id, points, options = {}) => ({
  'ID Tiket': id, Teknisi: 'Wawan', Status: 'Selesai', Cabang: 'Raha', 'Status Pembayaran': 'Lunas',
  'Bobot Poin': points, 'Waktu Lapor': '2026-09-28T08:00:00+08:00',
  'Waktu Selesai': '2026-09-28T16:00:00+08:00', 'Tanggal Lunas': '2026-09-29T10:00:00+08:00',
  'Status SLA': 'TERPENUHI', 'Status SLA Respon': 'TERPENUHI', ...options
});
test('Visible menu permissions enforce salary, branch and each role without widening KPI access', () => {
  const { c } = harness();
  const technician = user('teknisi', 0);
  for (const menu of ['dashboard', 'tiket', 'user', 'sla-raha']) assert.equal(c.penggunaBolehMenuLobby_(menu, technician), true, menu);
  for (const menu of ['input', 'penjualan', 'prospek', 'garansi', 'klien', 'absen', 'gaji', 'kpi', 'klaim-sales', 'sla-kendari']) {
    assert.equal(c.penggunaBolehMenuLobby_(menu, technician), false, menu);
  }
  assert.equal(c.penggunaBolehMenuLobby_('absen', user()), true);
  assert.equal(c.penggunaBolehMenuLobby_('gaji', user('direktur', 0, 'Semua')), true);
  assert.equal(c.penggunaBolehMenuLobby_('input', user('direktur', 0, 'Semua')), false);
  assert.equal(c.penggunaBolehMenuLobby_('prospek', user('admin_raha')), false);
  assert.equal(c.penggunaBolehMenuLobby_('kpi', user('admin_raha')), true);
  assert.equal(c.penggunaBolehMenuLobby_('kpi', user('sales', 2000000, 'Kendari')), false);
  assert.equal(c.penggunaBolehMenuLobby_('kpi', { ...user('sales', 2000000, 'Kendari'), Username: 'juna' }), true);
  assert.equal(c.penggunaBolehMenuLobby_('tiket', { ...technician, SessionToken: '' }), false);
  assert.equal(c.penggunaBolehMenuLobby_('unknown', user()), false);
  assert.equal(c.penggunaBolehMenuLobby_('klaim-sales', user('admin', 0, 'Kendari')), true);
  assert.equal(c.penggunaBolehMenuLobby_('klaim-sales', user('admin', 0, 'Semua')), true);
  for (const role of ['admin_raha', 'teknisi', 'sales', 'manager', 'direktur']) {
    assert.equal(c.penggunaBolehMenuLobby_('klaim-sales', user(role, 2000000, 'Semua')), false, role);
  }
});
test('Lobby lists KPI, attendance, payroll, both SLA branches and Sales claims for every account', () => {
  const menu = html.slice(html.indexOf('id="lobby-menu-title"'), html.indexOf('id="main-lobby-status"', html.indexOf('id="lobby-menu-title"')));
  assert.deepEqual([...menu.matchAll(/data-lobby-menu="([^"]+)"/g)].map(m => m[1]),
    ['kpi', 'absen', 'gaji', 'sla-kendari', 'sla-raha', 'klaim-sales']);
  assert.ok(!/style="display:none/.test(menu));
});
function enableRendering(c) {
  c.formatRp = value => 'Rp ' + Number(value).toLocaleString('id-ID');
  c.tetapkanHtmlAman_ = (element, value) => { element.innerHTML = value; };
  vm.runInContext(extract('tampilkanRingkasanLobby_'), c);
}
test('Admin Kendari lobby renders live invoice totals and all three SLA panels', () => {
  const profile = { ...user('admin', 2000000, 'Kendari'), 'Nama Asli': 'Admin Kendari A' };
  const { c, node } = harness(profile);
  c.cabangAktif = 'Kendari';
  c.globalTickets = [
    ticket('paid', 0, { Cabang: 'Kendari', 'No Transaksi': '001/KSR/UTM/0926', 'Status SLA': 'TERLAMBAT' }),
    ticket('old-unpaid', 0, { Cabang: 'Kendari', 'No Transaksi': '002/KSR/UTM/0826', 'Status Pembayaran': 'Belum Lunas',
      'Waktu Selesai': '2026-08-31T16:00:00+08:00', 'Waktu Lapor': '2026-08-31T08:00:00+08:00', 'Tanggal Lunas': null })
  ];
  const rekap = c.renderDashboard({ hitungSaja: true, bulan: '09', tahun: '2026' });
  enableRendering(c);
  c.tampilkanRingkasanLobby_(rekap, profile, c.globalTickets, 'Kendari');
  const content = node('lobby-dashboard-content').innerHTML;
  for (const heading of ['Rekap Pelunasan Nota iPOS', 'SLA 1: Distribusi Tugas Teknisi', 'SLA 2: Pembuatan Nota & Garansi', 'SLA 3: Serah Terima Barang']) assert.ok(content.includes(heading), heading);
  assert.match(content, />1<\/div>\s*<div[^>]*>Total Nota — September 2026/);
  assert.match(content, />1<\/div>\s*<div[^>]*>Nota Dilunasi — September 2026/);
  assert.match(content, />1<\/div>\s*<div[^>]*>Nota Belum Lunas — Seluruh Riwayat/);
  assert.equal(node('lobby-point-preview').textContent, 'Poin Admin Kendari · 1');
  assert.ok(!content.includes('Papan Performa Teknisi'));
});
test('Sales and technicians render only their complete personal card and safely escape names', () => {
  for (const role of ['sales', 'teknisi']) {
    const profile = { ...user(role), 'Nama Asli': 'A <img src=x onerror=alert(1)>' };
    const { c, node } = harness(profile);
    enableRendering(c);
    const rekap = {
      statsSales: { mine: { nama: profile['Nama Asli'], target: 5000000, revenue: 1000000, total: 2, selesai: 1, progress: 1, potensi_omzet: 2000000, prospek_deal: 1 }, other: { nama: 'Other Sales' } },
      statsTeknisi: { mine: { nama: profile['Nama Asli'], poin_terkumpul: 6, resp_tepat: 1, resp_total: 1, peng_tepat: 1, peng_total: 1, tiket_selesai: 1 }, other: { nama: 'Other Technician' } }
    };
    c.tampilkanRingkasanLobby_(rekap, profile, [], 'Raha');
    const content = node('lobby-dashboard-content').innerHTML;
    assert.ok(content.includes('A &lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(!content.includes('<img'));
    assert.ok(!content.includes('Other Sales') && !content.includes('Other Technician'));
    const headings = role === 'sales' ? ['PENCAPAIAN TARGET', 'STATUS TRANSAKSI', 'Potensi Pipeline', 'Tingkat Konversi'] : ['TOTAL POIN KINERJA BULAN INI', 'SLA RESPON', 'SLA PENGERJAAN', 'Tuntas Tanpa Pending', 'Kebocoran Garansi'];
    for (const heading of headings) assert.ok(content.includes(heading), heading);
    assert.equal(node('lobby-point-preview').textContent, role === 'sales' ? 'Omzet pribadi · Rp 1.000.000' : 'Poin pribadi · 6');
  }
});
test('Sales target remains personal when opening an authorized branch other than the profile branch', async () => {
  const sales = { ...user('sales'), 'Nama Asli': 'Sales A' };
  const { c, node } = harness(sales);
  node('lobby-cabang').value = 'Kendari';
  c.callSupabase = async () => [{ target_sales_rp: 50000000 }];
  c.ambilTabelRingkasanLobby_ = async () => [];
  let shown;
  c.tampilkanRingkasanLobby_ = rekap => { shown = rekap; };
  assert.equal(await c.muatRingkasanLobby_(), true);
  assert.equal(shown.statsSales['Sales A'].target, 50000000);
  assert.equal(c.globalUsers[0], sales);
});
test('Personal points share team work and exclude unpaid, other branches, failed SLA and next-month payment', () => {
  const { c, node } = harness();
  c.globalTickets = [
    ticket('shared', 12, { Teknisi: 'Wawan, Rendi, Wawan' }),
    ticket('unpaid', 50, { 'Status Pembayaran': 'Belum Lunas' }),
    ticket('frozen', 50, { 'Status Pembayaran': 'Poin Beku' }),
    ticket('other-branch', 100, { Cabang: 'Kendari' }),
    ticket('late', 100, { 'Status SLA': 'TERLAMBAT' }),
    ticket('veto', 3, { 'Status SLA': 'TERLAMBAT', 'Veto Admin': 'Ya' }),
    ticket('next-month', 100, { 'Tanggal Lunas': '2026-10-01T09:00:00+08:00' })
  ];
  node('dash-tek-content').innerHTML = 'existing dashboard';
  const stats = c.renderDashboard({ hitungSaja: true, bulan: '09', tahun: '2026' });
  assert.equal(stats.statsTeknisi.Wawan.poin_terkumpul, 9);
  assert.equal(stats.statsTeknisi.Rendi.poin_terkumpul, 6);
  assert.equal(stats.statsTeknisi.Wawan.tiket_selesai, 6);
  assert.equal(node('dash-tek-content').innerHTML, 'existing dashboard');
});
test('Sales uses personal target, actual revenue and open prospects for the selected period', () => {
  const sales = { ...user('sales'), 'Nama Asli': 'Sales A', 'Target Sales (Rp)': 5000000 };
  const { c } = harness(sales);
  c.globalPenjualan = [
    { 'ID Penjualan': 'SLS-1', Cabang: 'Raha', Sales: 'Sales A, Sales B', 'Nominal (Rp)': 2000000, Tanggal: '2026-09-28' },
    { 'ID Penjualan': 'SLS-2', Cabang: 'Raha', Sales: 'Sales B', 'Nominal (Rp)': 7000000, Tanggal: '2026-09-28' },
    { 'ID Penjualan': 'SLS-3', Cabang: 'Raha', Sales: 'Sales A', 'Nominal (Rp)': 9000000, Tanggal: '2026-10-01' }
  ];
  c.globalProspek = ['Penawaran', 'Deal', 'Batal'].map((status, i) => ({
    Cabang: 'Raha', 'Sales Penanggung Jawab': 'Sales A', 'Status Prospek': status,
    'Potensi Nilai': (i + 1) * 1000000, 'Tanggal Input': '2026-09-28'
  }));
  const stats = c.renderDashboard({ hitungSaja: true, bulan: '09', tahun: '2026' }).statsSales['Sales A'];
  assert.equal(stats.target, 5000000);
  assert.equal(stats.revenue, 1000000);
  assert.equal(stats.potensi_omzet, 1000000);
  assert.equal(stats.prospek_deal, 1);
  assert.equal(stats.prospek_batal, 1);
});
test('Loading the lobby restores existing workspace and cancels stale results on navigation', async () => {
  const { c, node } = harness();
  const existing = [ticket('existing', 7)];
  c.globalTickets = existing;
  c.cabangAktif = null;
  const requests = [];
  c.ambilTabelRingkasanLobby_ = async table => { requests.push(table); return []; };
  assert.equal(await c.muatRingkasanLobby_(), true);
  assert.equal(c.cabangAktif, null);
  assert.equal(c.globalTickets, existing);
  assert.deepEqual(requests, ['tiket', 'garansi']);
  assert.match(node('lobby-dashboard-status').textContent, /Diperbarui/);
  let resolve;
  let renders = 0;
  c.ambilTabelRingkasanLobby_ = table => table === 'tiket' ? new Promise(done => { resolve = done; }) : Promise.resolve([]);
  c.tampilkanRingkasanLobby_ = () => { renders++; };
  const pending = c.muatRingkasanLobby_();
  c.hentikanRingkasanLobby_();
  resolve([]);
  assert.equal(await pending, false);
  assert.equal(renders, 0);
  assert.equal(c.globalTickets, existing);
});
test('Failed or unauthorized summary loading never renders a false zero result', async () => {
  const { c, node } = harness();
  let renders = 0;
  c.tampilkanRingkasanLobby_ = () => { renders++; };
  c.ambilTabelRingkasanLobby_ = async () => { throw new Error('Koneksi gagal'); };
  assert.equal(await c.muatRingkasanLobby_(), false);
  assert.equal(renders, 0);
  assert.match(node('lobby-dashboard-content').innerHTML, /Ringkasan belum dapat dimuat/);
  assert.equal(node('lobby-dashboard-status').textContent, 'Koneksi gagal');
  node('lobby-cabang').value = 'Kendari';
  c.ambilTabelRingkasanLobby_ = async () => { throw new Error('Should not fetch unauthorized branch'); };
  assert.equal(await c.muatRingkasanLobby_(), false);
  assert.match(node('lobby-dashboard-status').textContent, /Cabang atau periode.*tidak valid/);
});
