'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.TZ = 'Asia/Makassar';
const sourceRoot = path.resolve(__dirname, '..', process.env.WARRANTY_DASHBOARD_SOURCE_DIR || '.');
const html = fs.readFileSync(path.join(sourceRoot, 'index.html'), 'utf8');
function extract(name) {
  const match = html.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\([^]*?^\\1\\}', 'm'));
  assert.ok(match, name);
  return match[0];
}
const bintang = 'Muhammad Bintang Restu Prabowo';
const technician = (name = bintang, branch = 'Kendari') => ({
  Username: 'test-technician', 'Nama Asli': name, Role: 'teknisi',
  Hak_Akses_Cabang: branch, Cabang: branch, SessionToken: 'test-only'
});
const original = {
  'ID Tiket': 'TKT-167', Teknisi: bintang, Status: 'Selesai', Cabang: 'Kendari',
  'Waktu Lapor': '2026-09-23T15:25:02+08:00', 'Waktu Selesai': '2026-09-24T10:26:37+08:00',
  'Tanggal Lunas': '2026-09-25T13:18:53+08:00', 'Status Pembayaran': 'Lunas',
  'Status SLA': 'TERPENUHI', 'Status SLA Respon': 'TERPENUHI', 'Bobot Poin': 4
};
const claim = {
  'ID Tiket': 'TKT-KG-GRS-139', Teknisi: 'Muhammad Saharullah Raiya', Status: 'Selesai',
  Cabang: 'Kendari', 'Waktu Lapor': '2026-10-01T10:10:20+08:00',
  'Waktu Selesai': '2026-10-03T15:17:02+08:00', 'Status SLA': 'TERPENUHI',
  'Status SLA Respon': 'TERPENUHI', 'Bobot Poin': 0
};
const warranty = {
  'ID Garansi': 'GRS-139', 'Referensi (Tiket/Nota)': 'TKT-167', Status: 'Diklaim (Hangus)',
  'Tanggal Habis': '2026-10-01T10:10:20+08:00', 'Tiket Klaim Garansi': claim['ID Tiket'], Cabang: 'Kendari'
};
function harness(activeUser = technician()) {
  const elements = new Map();
  const node = id => {
    if (!elements.has(id)) elements.set(id, {
      style: {}, innerHTML: '', textContent: '', value: '', selectedOptions: [],
      classList: { toggle() {} }, setAttribute() {}
    });
    return elements.get(id);
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-03T16:00:00+08:00'])); }
  }
  const c = vm.createContext({
    Date: FixedDate, AbortController, console, penggunaAktif: activeUser, cabangAktif: activeUser.Cabang,
    API_URL_CABANG: { Kendari: 'test', Raha: 'test' }, globalUsers: [activeUser],
    globalTickets: [{ ...original }, { ...claim }], globalGaransi: [{ ...warranty }],
    globalPenjualan: [], globalProspek: [], document: { getElementById: node },
    hitungDurasiJamKerjaMs: () => 0, punyaAksesLobby: () => true, tampilkanRingkasanLobby_: () => {}
  });
  const names = ['normalisasiCabang', 'rolePengguna', 'hakAksesCabangPengguna', 'roleAdalahAdminOperasional_', 'roleAdalahManajemen_',
    'penggunaSalesLintasCabang_', 'penggunaBolehMengaksesCabang', 'dataSesuaiCabangAktif_',
    'parseSafeDate', 'daftarTeknisiUnikTiket_', 'poinHangusKarenaSLA_', 'statusPoinSudahCair_',
    'normalisasiNoTransaksiNota_', 'tanggalNotaDariNomorTransaksi_', 'rekapStatusNotaIpos_',
    'kunciNamaPekerjaanTeknisi_', 'rekapPekerjaanTeknisi_', 'renderDashboard', 'statusGaransiEfektif_', 'petakanGaransiSupabase_', 'petakanPenjualanSupabase_', 'petakanProspekSupabase_',
    'hentikanRingkasanLobby_', 'aturTataLetakLobby_', 'muatRingkasanLobby_'];
  vm.runInContext('let permintaanRingkasanLobby_ = null, urutanRingkasanLobby_ = 0, waktuRingkasanLobby_ = 0;\n' + names.map(extract).join('\n'), c);
  if (html.includes('function kolomGaransiPengguna_')) vm.runInContext(extract('kolomGaransiPengguna_'), c);
  node('lobby-cabang').value = activeUser.Cabang;
  node('lobby-periode').value = '2026-10';
  return { c, node, stats(month = '10') { return c.renderDashboard({ hitungSaja: true, bulan: month, tahun: '2026' }).statsTeknisi; } };
}

test('a September job claimed in October counts against its original technician in October', () => {
  const { stats } = harness();
  const october = stats();
  assert.equal(october[bintang].garansi_bocor, 1);
  assert.equal(october[bintang].tiket_selesai, 0);
  assert.equal(october[bintang].poin_terkumpul, 0);
  assert.equal(october['Muhammad Saharullah Raiya'].garansi_bocor, 0);
  const september = stats('09');
  assert.equal(september[bintang].garansi_bocor, 0);
  assert.equal(september[bintang].tiket_selesai, 1);
  assert.equal(september[bintang].poin_terkumpul, 4);
});

test('every original technician gets one claimed ticket despite multiple cards and repeated names', () => {
  const { c, stats } = harness();
  c.globalTickets[0].Teknisi = `${bintang}, Alif, ${bintang}`;
  c.globalGaransi = [
    { ...warranty, 'ID Garansi': 'ACTIVE', Status: 'Aktif' },
    { ...warranty }, { ...warranty, 'ID Garansi': 'SECOND-CLAIM' }
  ];
  assert.equal(stats()[bintang].garansi_bocor, 1);
  assert.equal(stats().Alif.garansi_bocor, 1);
  assert.equal(stats('all')[bintang].garansi_bocor, 1);
});

test('legacy claims use their recorded claim date when no new claim ticket exists', () => {
  const { c, stats } = harness();
  c.globalTickets = [{ ...original }];
  delete c.globalGaransi[0]['Tiket Klaim Garansi'];
  assert.equal(stats()[bintang].garansi_bocor, 1);
  assert.equal(stats('09')[bintang].garansi_bocor, 0);
});

test('the claim creation date determines its month even if completion or card expiry is later', () => {
  const { c, stats } = harness();
  c.globalTickets[1]['Waktu Lapor'] = '2026-09-30T15:59:59Z'; // 23:59:59 WITA
  c.globalGaransi[0]['Tanggal Habis'] = '2026-10-02T10:00:00+08:00';
  assert.equal(stats()[bintang].garansi_bocor, 0);
  assert.equal(stats('09')[bintang].garansi_bocor, 1);
  c.globalTickets[1]['Waktu Lapor'] = '2026-09-30T16:00:00Z'; // midnight WITA
  assert.equal(stats()[bintang].garansi_bocor, 1);
});

test('unclaimed, expired, cancelled claims and other branch warranties do not count', () => {
  for (const status of ['Aktif', 'Masa Tunggu', 'Habis (Expired)', 'Habis (Tanpa Garansi)']) {
    const { c, stats } = harness();
    c.globalGaransi[0].Status = status;
    assert.equal(stats('all')[bintang].garansi_bocor, 0, status);
  }
  const { c, stats } = harness();
  c.globalGaransi[0].Cabang = 'Raha';
  assert.equal(stats('all')[bintang].garansi_bocor, 0);
});

test('technician lobby loads claim metadata and calculates the real claim without replacing its workspace', async () => {
  const { c, node } = harness();
  const existing = c.globalTickets;
  const requests = [];
  c.ambilTabelRingkasanLobby_ = async table => {
    requests.push(table);
    return table === 'garansi' ? [{
      id_garansi: 'GRS-139', referensi_tiket_nota: 'TKT-167', status: 'Diklaim (Hangus)',
      tanggal_habis: warranty['Tanggal Habis'], tiket_klaim_garansi: claim['ID Tiket'], cabang: 'Kendari'
    }] : [{ ...original }, { ...claim }];
  };
  c.petakanTiketSupabase_ = row => row;
  let calculated;
  c.tampilkanRingkasanLobby_ = rekap => { calculated = rekap; };
  assert.equal(await c.muatRingkasanLobby_(), true);
  assert.deepEqual(requests, ['tiket', 'garansi']);
  assert.equal(calculated.statsTeknisi[bintang].garansi_bocor, 1);
  assert.equal(c.globalTickets, existing);
  assert.match(node('lobby-dashboard-status').textContent, /Diperbarui/);
});

test('a failed warranty read cannot render a misleading zero claim summary', async () => {
  const { c, node } = harness();
  let renders = 0;
  c.ambilTabelRingkasanLobby_ = async table => {
    if (table === 'garansi') throw new Error('Garansi gagal dimuat');
    return [];
  };
  c.tampilkanRingkasanLobby_ = () => { renders++; };
  assert.equal(await c.muatRingkasanLobby_(), false);
  assert.equal(renders, 0);
  assert.match(node('lobby-dashboard-content').innerHTML, /Ringkasan belum dapat dimuat/);
});

test('technician warranty queries request only claim metadata and retain branch scope', async () => {
  const { c } = harness();
  if (html.includes('function kolomGaransiPengguna_')) vm.runInContext(extract('kolomGaransiPengguna_'), c);
  vm.runInContext(extract('ambilTabelRingkasanLobby_'), c);
  const requests = [];
  c.callSupabase = async (url, method) => { requests.push(url); assert.equal(method, 'GET'); return []; };
  await c.ambilTabelRingkasanLobby_('garansi', 'Kendari', undefined);
  assert.match(requests[0], /select=id_garansi,referensi_tiket_nota,status,tanggal_habis,tiket_klaim_garansi,cabang&/);
  assert.match(requests[0], /or=\(cabang.eq.Kendari,cabang.is.null\)/);
  assert.doesNotMatch(requests[0], /nama_pelanggan|omzet|sales|select=\*/);
  c.penggunaAktif = { ...technician(), Role: 'manager' };
  await c.ambilTabelRingkasanLobby_('garansi', 'Raha', undefined);
  assert.match(requests[1], /select=\*&cabang=eq.Raha/);
});

test('claim ticket events request a warranty reload while normal tickets keep their local update', () => {
  const { c } = harness();
  vm.runInContext(extract('upsertRecordRealtime_') + '\n' + extract('terapkanPerubahanRealtimeLokal_'), c);
  c.perbaruiStatusSLAAktualTiket_ = row => row;
  c.renderDashboard = () => {};
  c.renderTickets = () => {};
  const row = { id_tiket: claim['ID Tiket'], teknisi: claim.Teknisi, cabang: 'Kendari',
    status: 'Claim Garansi', tenggat_waktu: '2026-10-05T12:00:00+08:00',
    tenggat_respon: '2026-10-01T11:00:00+08:00', garansi_asal: 'GRS-139' };
  assert.equal(c.terapkanPerubahanRealtimeLokal_({ table: 'tiket', eventType: 'INSERT', new: row }), false);
  assert.equal(c.terapkanPerubahanRealtimeLokal_({ table: 'tiket', eventType: 'UPDATE', new: { ...row, garansi_asal: null } }), true);
});

test('management warranty events update both the warranty list and dashboard immediately', () => {
  const { c } = harness({ ...technician(), Role: 'manager' });
  vm.runInContext(extract('upsertRecordRealtime_') + '\n' + extract('terapkanPerubahanRealtimeLokal_'), c);
  let dashboards = 0;
  let warranties = 0;
  c.renderDashboard = () => { dashboards++; };
  c.renderGaransi = () => { warranties++; };
  assert.equal(c.terapkanPerubahanRealtimeLokal_({ table: 'garansi', eventType: 'UPDATE',
    new: { id_garansi: 'GRS-139', status: 'Diklaim (Hangus)', referensi_tiket_nota: 'TKT-167', cabang: 'Kendari' }
  }), true);
  assert.equal(dashboards, 1);
  assert.equal(warranties, 1);
});
