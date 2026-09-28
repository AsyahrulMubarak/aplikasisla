const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.TZ = 'Asia/Makassar';
const html = fs.readFileSync(path.resolve(__dirname, '../slipgaji.html'), 'utf8');

test('Lokasi fisik hanya tampil pada slip pegawai terpilih tanpa mengubah upah', () => {
  const events = [
    { 'Nama Pegawai': 'Test', 'Waktu Absen': '2026-09-16T08:00:00+08:00',
      'Tipe Absen': 'Masuk', 'Lokasi Maps': 'https://www.google.com/maps?q=-3.97,122.51' },
    { 'Nama Pegawai': 'Test', 'Waktu Absen': '2026-09-16T20:00:00+08:00',
      'Tipe Absen': 'Keluar', 'Lokasi Maps': 'javascript:alert(1)' },
    { 'Nama Pegawai': 'Other', 'Waktu Absen': '2026-09-16T08:00:00+08:00',
      'Tipe Absen': 'Masuk', 'Lokasi Maps': 'https://www.google.com/maps?q=-4,123' }
  ];
  const context = vm.createContext({
    Date, Set, URL, globalUsers: [{ 'Nama Asli': 'Test', 'Gaji Pokok': 1500000,
      Role: 'teknisi', Hak_Akses_Cabang: 'Kendari' }],
    globalAbsen: events, globalTickets: [], formatRp: value => 'Rp ' + Math.round(value),
    ambilVariabelPayroll: () => ({ luarKota: '', fee: 0, kasbon: 0 })
  });
  vm.runInContext(html.slice(html.indexOf('        function normalisasiCabangPayroll'),
    html.indexOf('        function generateSlipIndividu')), context);
  const withLocation = context.kalkulasiGajiPegawai('Test', '2026-09', 26);
  context.globalAbsen = events.map(event => ({ ...event, 'Lokasi Maps': '' }));
  const withoutLocation = context.kalkulasiGajiPegawai('Test', '2026-09', 26);
  for (const field of ['totalBersih', 'totalUpahHadir', 'totalPotongan', 'totalLembur']) {
    assert.equal(withLocation[field], withoutLocation[field]);
  }
  assert.match(withLocation.barisHTML, /Lihat Lokasi Masuk/);
  assert.match(withLocation.barisHTML, /https:\/\/www\.google\.com\/maps\?q=-3\.97,122\.51/);
  assert.doesNotMatch(withLocation.barisHTML, /maps\?q=-4,123|javascript:/);
  assert.equal((withLocation.barisHTML.match(/Lihat Lokasi/g) || []).length, 1);
});
