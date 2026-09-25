const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const slipHtml = fs.readFileSync(path.resolve(__dirname, '../slipgaji.html'), 'utf8');
const backendCandidates = [
  path.resolve(__dirname, '../codeabsensi.txt'),
  path.resolve(__dirname, '../../codeabsensi.txt'),
  path.resolve(__dirname, '../maintenance/attendance-out-of-town-quota.gs')
];
const backendPath = backendCandidates.find(candidate => fs.existsSync(candidate));
assert.ok(backendPath, 'Attendance backend source codeabsensi.txt is required for this regression test');
const backend = fs.readFileSync(backendPath, 'utf8');
const fullBackend = /data\.action === 'syncPengecualianKoreksiLuarKota'/.test(backend);

function extract(source, name) {
  const match = source.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\([^]*?^\\1\\}', 'm'));
  assert.ok(match, `Missing function: ${name}`);
  return match[0];
}

function formatMakassar(date, _timezone, pattern) {
  const shifted = new Date(new Date(date).getTime() + 8 * 60 * 60 * 1000);
  const iso = shifted.toISOString();
  if (pattern === 'yyyy-MM') return iso.slice(0, 7);
  if (pattern === 'yyyy-MM-dd') return iso.slice(0, 10);
  throw new Error(`Unsupported date format in test: ${pattern}`);
}

function backendHarness() {
  const properties = new Map();
  class FixedDate extends Date {
    constructor(value) { super(arguments.length ? value : '2026-09-23T04:00:00.000Z'); }
    static now() { return new Date('2026-09-23T04:00:00.000Z').getTime(); }
  }
  const context = vm.createContext({
    Date: FixedDate,
    String,
    Number,
    JSON,
    Array,
    Object,
    isNaN,
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest(_algorithm, value) {
        return Array.from(crypto.createHash('sha256').update(String(value), 'utf8').digest());
      },
      formatDate: formatMakassar
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          setProperty(key, value) { properties.set(key, value); },
          getProperty(key) { return properties.has(key) ? properties.get(key) : null; }
        };
      }
    }
  });
  for (const name of [
    'byteArrayToHex_', 'normalisasiTanggalLuarKotaAbsensi_',
    'kunciPengecualianKoreksiLuarKota_', 'simpanPengecualianKoreksiLuarKota_',
    'ambilPengecualianKoreksiLuarKota_', 'koreksiMengurangiKuota_'
  ]) vm.runInContext(extract(backend, name), context);
  return { context, properties };
}

test('payroll marks outside-city dates as free attendance corrections', () => {
  assert.match(slipHtml, /Tgl Luar Kota \(Pokok & Lembur x2, Koreksi Gratis\)/);
  assert.match(slipHtml, /payloadSesiSlip\('syncPengecualianKoreksiLuarKota'/);
  assert.match(slipHtml, /koreksi pada tanggal Luar Kota tidak memakai kuota/i);
  if (fullBackend) {
    assert.match(backend, /if \(!targetLuarKota && countKoreksi >= 7\)/);
    assert.match(backend, /data\.action === 'syncPengecualianKoreksiLuarKota'/);
  }
});

test('outside-city date storage is normalized, employee-scoped, and current-month only', () => {
  const { context, properties } = backendHarness();
  assert.equal(context.simpanPengecualianKoreksiLuarKota_('2026-09', [
    { namaPegawai: 'Abu Abid', luarKota: ' 15, 12,15, 0, 32, abc ' },
    { namaPegawai: 'Pegawai Lain', luarKota: '3' }
  ], 'Admin'), 2);
  assert.deepEqual(Array.from(context.ambilPengecualianKoreksiLuarKota_('2026-09', 'Abu Abid')), [12, 15]);
  assert.deepEqual(Array.from(context.ambilPengecualianKoreksiLuarKota_('2026-09', 'Pegawai Lain')), [3]);
  assert.equal(properties.size, 2);
  assert.throws(() => context.simpanPengecualianKoreksiLuarKota_('2026-08', [], 'Admin'), /bulan berjalan/);
  assert.deepEqual(Array.from(context.normalisasiTanggalLuarKotaAbsensi_('12abc, 03, 3')), [3]);
});

test('manual corrections on outside-city dates do not consume the normal seven-use quota', () => {
  const { context } = backendHarness();
  const outsideDays = [12, 15];
  const row = (day, status = 'Koreksi Manual') => ({
    status_disiplin: status,
    waktu_absen: `2026-09-${String(day).padStart(2, '0')}T02:00:00.000Z`
  });

  assert.equal(context.koreksiMengurangiKuota_(row(12), '2026-09', outsideDays), false);
  assert.equal(context.koreksiMengurangiKuota_(row(15), '2026-09', outsideDays), false);
  assert.equal(context.koreksiMengurangiKuota_(row(16), '2026-09', outsideDays), true);
  assert.equal(context.koreksiMengurangiKuota_(row(16, 'Tepat Waktu'), '2026-09', outsideDays), false);

  const records = [row(12), row(15), row(1), row(2), row(3), row(4), row(5), row(6), row(7)];
  assert.equal(records.filter(record => context.koreksiMengurangiKuota_(record, '2026-09', outsideDays)).length, 7);
});

test('outside-city dates are saved automatically and an interrupted save keeps a local draft', () => {
  assert.match(slipHtml, /target\.id === 'input-luar-kota'.*simpanDrafLuarKotaAktif_/s);
  assert.match(slipHtml, /target\.id !== 'input-luar-kota'.*simpanVariabelPayroll\(\{ otomatis: true \}\)/s);
  assert.match(slipHtml, /localStorage\.setItem\(kunciDrafLuarKota_/);
  assert.match(slipHtml, /ambilDrafLuarKota_\(periode, namaPegawai, nilaiServerLuarKota\)/);
  assert.match(slipHtml, /hapusDrafLuarKota_\(periode, namaPegawai\)/);
  assert.match(slipHtml, /Tanggal Luar Kota tersimpan otomatis dan tidak akan hilang saat aplikasi ditutup/);
});

test('free outside-city corrections are white while quota corrections remain pink', () => {
  process.env.TZ = 'Asia/Makassar';
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-09-25T09:00:00+08:00'])); }
  }
  const employee = 'Pegawai Uji Warna';
  const event = (day, time, type, status = '') => ({
    'Nama Pegawai': employee,
    'Waktu Absen': `2026-09-${String(day).padStart(2, '0')}T${time}+08:00`,
    'Tipe Absen': type,
    'Status Disiplin': status,
    'Keterangan': ''
  });
  const context = vm.createContext({
    Date: FixedDate,
    Set,
    globalUsers: [{ 'Nama Asli': employee, 'Gaji Pokok': 2600000, Role: 'teknisi', Hak_Akses_Cabang: 'Kendari' }],
    globalAbsen: [
      event(3, '08:00:00', 'Masuk'), event(3, '17:00:00', 'Keluar', 'Koreksi Manual'),
      event(21, '08:00:00', 'Masuk'), event(21, '17:00:00', 'Keluar', 'Koreksi Manual')
    ],
    globalTickets: [],
    formatRp: value => 'Rp ' + Math.round(value),
    ambilVariabelPayroll: () => ({ luarKota: '21', fee: 0, kasbon: 0 })
  });
  vm.runInContext(slipHtml.slice(
    slipHtml.indexOf('        function normalisasiCabangPayroll'),
    slipHtml.indexOf('        function generateSlipIndividu')
  ), context);
  const result = context.kalkulasiGajiPegawai(employee, '2026-09', 26);
  const normalRow = result.barisHTML.split('<tr ').find(row => row.includes('03/09/2026'));
  const freeRow = result.barisHTML.split('<tr ').find(row => row.includes('21/09/2026'));
  assert.match(normalRow, /background:#fbcfe8; color:#be185d;[^>]*>17:00:00/);
  assert.match(freeRow, /background-color:#ffffff; color:#0f172a;[^>]*>17:00:00/);
  assert.doesNotMatch(freeRow, /background:#fbcfe8/);
});
