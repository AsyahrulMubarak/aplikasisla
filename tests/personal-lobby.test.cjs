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
  'hentikanRingkasanLobby_', 'muatRingkasanLobby_'
];
function harness(activeUser = user()) {
  const elements = new Map();
  const node = id => {
    if (!elements.has(id)) elements.set(id, { style: {}, innerHTML: '', textContent: '', value: '', selectedOptions: [], setAttribute() {} });
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
  assert.deepEqual(requests, ['tiket']);
  assert.match(node('lobby-dashboard-status').textContent, /Diperbarui/);
  let resolve;
  let renders = 0;
  c.ambilTabelRingkasanLobby_ = () => new Promise(done => { resolve = done; });
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
