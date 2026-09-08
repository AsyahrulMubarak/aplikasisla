const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
process.env.TZ = 'Asia/Makassar';
const html = fs.readFileSync(path.join(__dirname, '..', 'slipgaji.html'), 'utf8');
const name = 'Asyahrul Mubarak';
const approval = '[ID Pengajuan: PGJ-20260908075046-D79EE] Disetujui oleh ABU ABID. Alasan: TES FITUR PENGAJUAN SAKIT/IZIN TAHAP 1';
function event(day, time, type, status = '', note = '') {
  return { 'Nama Pegawai': name, 'Waktu Absen': `2026-09-${day}T${time}+08:00`,
    'Tipe Absen': type, 'Status Disiplin': status, 'Keterangan': note };
}
function calculate(events, branch = 'Kendari', role = 'teknisi') {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-09-09T12:39:00+08:00'])); }
  }
  const context = vm.createContext({ Date: FixedDate,
    globalUsers: [{ 'Nama Asli': name, 'Gaji Pokok': 1000000, Role: role, Hak_Akses_Cabang: branch }],
    globalAbsen: events, globalTickets: [], formatRp: value => 'Rp ' + Math.round(value),
    ambilVariabelPayroll: () => ({ luarKota: '', fee: 0, kasbon: 0 }) });
  vm.runInContext(html.slice(html.indexOf('        function normalisasiCabangPayroll'), html.indexOf('        function generateSlipIndividu')), context);
  const result = context.kalkulasiGajiPegawai(name, '2026-09', 26);
  const row = result.barisHTML.split('<tr ').find(row => row.includes('08/09/2026'));
  const cells = [...row.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/g)].map(match => match[1]);
  return { result, row, cells };
}
const sickDay = () => [event('08', '08:00:00', 'Sakit', 'Pengajuan Disetujui', approval), event('08', '12:36:26', 'Masuk Setelah Istirahat')];
test('Alasan sakit berisi kata izin tetap biru dan mempertahankan waktu masuk siang', () => {
  const { row, cells } = calculate(sickDay());
  assert.equal(cells[1], '08:00');
  assert.equal(cells[3], '12:36:26');
  assert.equal(cells[4], '17:00');
  assert.equal(cells[5], '<strong>9.00h</strong>');
  assert.equal(cells[6], 'Rp 38462');
  assert.match(row, /background-color:#bfdbfe/);
  assert.doesNotMatch(row, /#bbf7d0|Berjalan/);
});
test('Autofill mengikuti Raha 20:00 dan pengecualian admin Raha 17:00', () => {
  assert.equal(calculate(sickDay(), 'Raha').cells[4], '20:00');
  assert.equal(calculate(sickDay(), 'Raha').cells[5], '<strong>12.00h</strong>');
  assert.equal(calculate(sickDay(), 'Raha', 'admin').cells[4], '17:00');
});
test('Sakit tanpa hadir fisik terisi penuh dan tidak dianggap lupa keluar', () => {
  const { cells } = calculate(sickDay().slice(0, 1));
  assert.equal(cells[1], '08:00');
  assert.equal(cells[4], '17:00');
  assert.equal(cells[9], '- Rp 0');
});
test('Kuota sakit dihitung termasuk hari yang memiliki absen fisik, sekali per tanggal', () => {
  const earlier = ['01', '02', '03'].flatMap(day => [event(day, '08:00:00', 'Sakit'), event(day, '12:00:00', 'Masuk')]);
  earlier.push(event('01', '08:00:00', 'Sakit'));
  const { row, cells } = calculate([...earlier, ...sickDay()]);
  assert.equal(cells[5], '<strong>7.50h</strong>');
  assert.equal(cells[6], 'Rp 32051');
  assert.equal(cells[9], '- Rp 6410');
  assert.match(row, /background-color:#e2e8f0/);
});
test('Auto keluar penalti tetap mengurangi 90 menit pada hari sakit, dengan sel keluar abu-abu', () => {
  const { row, cells } = calculate([...sickDay(), event('08', '15:30:00', 'Keluar', 'Auto Keluar Penalti (Potongan 90 Menit)')]);
  assert.equal(cells[1], '08:00');
  assert.equal(cells[4], '15:30:00');
  assert.equal(cells[5], '<strong>7.50h</strong>');
  assert.equal(cells[6], 'Rp 32051');
  assert.equal(cells[9], '- Rp 6410');
  assert.match(row, /background-color:#bfdbfe[^>]*>08:00/);
  assert.match(row, /background:#e2e8f0[^>]*>15:30:00/);
});
test('Dua kuota habis dikenai masing-masing satu potongan tanpa menggandakan potongan yang sama', () => {
  const earlier = ['01', '02', '03'].map(day => event(day, '08:00:00', 'Sakit'));
  const { cells } = calculate([...earlier, ...sickDay(), event('08', '15:30:00', 'Keluar', 'Auto Keluar Penalti (Potongan 90 Menit)')]);
  assert.equal(cells[5], '<strong>6.00h</strong>');
  assert.equal(cells[9], '- Rp 12821');
});
test('Lembur nyata pada hari sakit tetap dibayar, termasuk keluar setelah tengah malam', () => {
  const { cells } = calculate([...sickDay(), event('09', '00:20:16', 'Keluar')]);
  assert.equal(cells[4], '00:20:16 (+1)');
  assert.equal(cells[5], '<strong>16.33h</strong>');
  assert.match(cells[8], /Rp 36667/);
});
test('Kata sakit atau kuota habis pada catatan biasa tidak mengubah status warna', () => {
  const { row } = calculate([event('08', '08:00:00', 'Masuk', '', 'Bantu rekan sakit, kuota habis'), event('08', '17:00:00', 'Keluar')]);
  assert.doesNotMatch(row, /background-color:#bfdbfe|background-color:#e2e8f0/);
});
test('Kuota sakit bulan sebelumnya tidak menghabiskan kuota bulan yang dipilih', () => {
  const earlier = ['01', '02', '03'].map(day => ({...event(day, '08:00:00', 'Sakit'), 'Waktu Absen': `2026-08-${day}T08:00:00+08:00`}));
  assert.equal(calculate([...earlier, ...sickDay()]).cells[9], '- Rp 0');
});
