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
function calculate(events, branch = 'Kendari', role = 'teknisi', now = '2026-09-09T12:39:00+08:00') {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
  }
  const context = vm.createContext({ Date: FixedDate,
    globalUsers: [{ 'Nama Asli': name, 'Gaji Pokok': 1000000, Role: role, Hak_Akses_Cabang: branch }],
    globalAbsen: events, globalTickets: [], formatRp: value => 'Rp ' + Math.round(value),
    ambilVariabelPayroll: () => ({ luarKota: '', fee: 0, kasbon: 0 }) });
  vm.runInContext(html.slice(html.indexOf('        function normalisasiCabangPayroll'), html.indexOf('        function generateSlipIndividu')), context);
  const result = context.kalkulasiGajiPegawai(name, '2026-09', 26);
  const row = result.barisHTML.split('<tr ').find(row => row.includes('08/09/2026'));
  const cells = [...row.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/g)].map(match => match[1]);
  const styles = [...row.matchAll(/<td(?:\s([^>]*))?>/g)].map(match => match[1] || '');
  return { result, row, cells, styles };
}
const sickDay = () => [event('08', '08:00:00', 'Sakit', 'Pengajuan Disetujui', approval), event('08', '12:36:26', 'Masuk Setelah Istirahat')];
test('Alasan sakit berisi kata izin tetap biru dan mempertahankan waktu masuk siang', () => {
  const { row, cells } = calculate(sickDay());
  assert.equal(cells[1], '-');
  assert.equal(cells[3], '12:36:26');
  assert.equal(cells[4], '17:00');
  assert.equal(cells[5], '<strong>09:00:00</strong>');
  assert.equal(cells[6], 'Rp 38462');
  assert.match(row, /background-color:#bfdbfe/);
  assert.doesNotMatch(row, /#bbf7d0|Berjalan/);
});
test('Autofill mengikuti Raha 20:00 dan pengecualian admin Raha 17:00', () => {
  assert.equal(calculate(sickDay(), 'Raha').cells[4], '20:00');
  assert.equal(calculate(sickDay(), 'Raha').cells[5], '<strong>12:00:00</strong>');
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
  const { row, cells } = calculate([...earlier, ...sickDay(), event('08', '17:00:00', 'Keluar')]);
  assert.equal(cells[1], '-');
  assert.equal(cells[3], '12:36:26');
  assert.equal(cells[5], '<strong>04:23:34</strong>');
  assert.equal(cells[6], 'Rp 18773');
  assert.equal(cells[9], '- Rp 0');
  assert.match(row, /background-color:#bfdbfe/);
  assert.doesNotMatch(row, /background-color:#e2e8f0/);
});
test('Auto keluar penalti tetap mengurangi 90 menit pada hari sakit, dengan sel keluar abu-abu', () => {
  const { row, cells } = calculate([...sickDay(), event('08', '15:30:00', 'Keluar', 'Auto Keluar Penalti (Potongan 90 Menit)')]);
  assert.equal(cells[1], '-');
  assert.equal(cells[4], '15:30:00');
  assert.equal(cells[5], '<strong>07:30:00</strong>');
  assert.equal(cells[6], 'Rp 32051'); // Upah harian sudah dikurangi potongan Rp 6410, tanpa lembur.
  assert.equal(cells[9], '- Rp 6410');
  assert.match(row, /background-color:#bfdbfe[^>]*>-/);
  assert.match(row, /background:#e2e8f0[^>]*>15:30:00/);
});
test('Sakit dan lupa keluar sama-sama habis: hanya penalti lupa keluar memendekkan sesi fisik 90 menit', () => {
  const earlier = ['01', '02', '03'].map(day => event(day, '08:00:00', 'Sakit'));
  const { row, cells } = calculate([...earlier, ...sickDay(), event('08', '15:30:00', 'Keluar', 'Auto Keluar Penalti (Potongan 90 Menit)')]);
  assert.equal(cells[1], '-');
  assert.equal(cells[5], '<strong>02:53:34</strong>');
  assert.equal(cells[6], 'Rp 12362');
  assert.equal(cells[9], '- Rp 0'); // Potongan sudah tercermin sekali pada akhir sesi 15:30.
  assert.match(row, /background:#e2e8f0[^>]*>15:30:00/);
});

test('Kuota sakit habis tanpa masuk: keempat kolom tetap kosong biru dan tanpa upah', () => {
  const earlier = ['01', '02', '03'].map(day => event(day, '08:00:00', 'Sakit'));
  const { row, cells } = calculate([...earlier, ...sickDay().slice(0, 1)]);
  assert.deepEqual(cells.slice(1, 5), ['-', '-', '-', '-']);
  assert.equal(cells[6], '-');
  assert.equal(cells[9], '- Rp 0');
  assert.match(row, /background-color:#bfdbfe/);
  assert.doesNotMatch(row, /#e2e8f0|#bbf7d0/);
});

test('Setelah kuota sakit habis, upah hari berjalan mulai dari masuk siang nyata tanpa autofill 08:00', () => {
  const earlier = ['01', '02', '03'].map(day => event(day, '08:00:00', 'Sakit'));
  const { cells } = calculate([...earlier, ...sickDay()], 'Kendari', 'teknisi', '2026-09-08T12:39:00+08:00');
  assert.equal(cells[1], '-');
  assert.equal(cells[3], '12:36:26');
  assert.equal(cells[4], '12:39:00 (Berjalan)');
  assert.equal(cells[5], '<strong>00:02:34</strong>');
  assert.equal(cells[6], 'Rp 183');
  assert.equal(cells[9], '- Rp 0');
});
test('Lembur nyata pada hari sakit tetap dibayar, termasuk keluar setelah tengah malam', () => {
  const { cells } = calculate([...sickDay(), event('09', '00:20:16', 'Keluar')]);
  assert.equal(cells[4], '00:20:16 (+1)');
  assert.equal(cells[5], '<strong>16:20:16</strong>');
  assert.match(cells[8], /Rp 36689/);
});
test('Kata sakit atau kuota habis pada catatan biasa tidak mengubah status warna', () => {
  const { row } = calculate([event('08', '08:00:00', 'Masuk', '', 'Bantu rekan sakit, kuota habis'), event('08', '17:00:00', 'Keluar')]);
  assert.doesNotMatch(row, /background-color:#bfdbfe|background-color:#e2e8f0/);
});
test('Kuota sakit bulan sebelumnya tidak menghabiskan kuota bulan yang dipilih', () => {
  const earlier = ['01', '02', '03'].map(day => ({...event(day, '08:00:00', 'Sakit'), 'Waktu Absen': `2026-08-${day}T08:00:00+08:00`}));
  assert.equal(calculate([...earlier, ...sickDay()]).cells[9], '- Rp 0');
});

test('Sakit pagi: masuk siang nyata putih, pagi kosong biru, penalti keluar tetap abu-abu', () => {
  const { cells, styles } = calculate([...sickDay(), event('08', '15:30:00', 'Keluar', 'Auto Keluar Penalti (Potongan 90 Menit)')]);
  assert.equal(cells[1], '-');
  assert.match(styles[1], /background-color:#bfdbfe/);
  assert.equal(cells[3], '12:36:26');
  assert.match(styles[3], /background-color:#ffffff/);
  assert.match(styles[4], /background:#e2e8f0/);
  assert.equal(cells[5], '<strong>07:30:00</strong>');
  assert.equal(cells[9], '- Rp 6410');
});

test('Izin pagi dan masuk siang hari berjalan: pagi kosong hijau, masuk siang putih', () => {
  const { cells, styles } = calculate([
    event('08', '08:00:00', 'Izin', 'Pengajuan Disetujui'),
    event('08', '12:21:27', 'Masuk Setelah Istirahat')
  ], 'Kendari', 'teknisi', '2026-09-08T12:23:00+08:00');
  assert.equal(cells[1], '-');
  assert.match(styles[1], /background-color:#bbf7d0/);
  assert.equal(cells[3], '12:21:27');
  assert.match(styles[3], /background-color:#ffffff/);
  assert.equal(cells[4], '12:23:00 (Berjalan)');
  assert.equal(cells[5], '<strong>00:01:33</strong>');
});

test('Masuk pertama pukul 13:04 tanpa izin/sakit tampil di pagi dengan kuning terlambat', () => {
  const { cells, styles, result } = calculate([
    event('08', '13:04:51', 'Masuk', 'Terlambat Masuk'),
    event('08', '17:34:28', 'Keluar')
  ]);
  assert.equal(cells[1], '13:04:51');
  assert.equal(cells[3], '-');
  assert.match(styles[1], /background:#fef08a/);
  assert.equal(result.countTelatPagi, 1);
  assert.equal(cells[9], '- Rp 0');
});

test('Kuota sakit habis: pagi tetap kosong biru, masuk siang nyata putih tanpa autofill pagi', () => {
  const earlier = ['01', '02', '03'].map(day => event(day, '08:00:00', 'Sakit'));
  const { cells, styles } = calculate([...earlier, ...sickDay(), event('08', '17:00:00', 'Keluar')]);
  assert.equal(cells[1], '-');
  assert.match(styles[1], /background-color:#bfdbfe/);
  assert.match(styles[3], /background-color:#ffffff/);
  assert.equal(cells[5], '<strong>04:23:34</strong>');
  assert.equal(cells[6], 'Rp 18773');
});

test('Tanpa kehadiran siang nyata: autofill sakit tetap biru dan izin tetap hijau', () => {
  const sick = calculate(sickDay().slice(0, 1));
  assert.equal(sick.cells[3], '13:30');
  sick.styles.slice(1, 5).forEach(style => assert.match(style, /background-color:#bfdbfe/));
  const leave = calculate([event('08', '08:00:00', 'Izin')]);
  assert.deepEqual(leave.cells.slice(1, 5), ['-', '-', '-', '-']);
  leave.styles.slice(1, 5).forEach(style => assert.match(style, /background-color:#bbf7d0/));
  const auto = calculate([event('08', '08:00:00', 'Sakit'), event('08', '13:00:00', 'Masuk', 'Lupa Absen Masuk (Auto)')]);
  assert.match(auto.styles[3], /background-color:#bfdbfe/);
});

test('Kehadiran siang Raha putih dengan jadwal autofill dan warna keluar yang tetap berlaku', () => {
  const { cells, styles } = calculate(sickDay(), 'Raha');
  assert.match(styles[1], /background-color:#bfdbfe/);
  assert.match(styles[3], /background-color:#ffffff/);
  assert.equal(cells[4], '20:00');
  assert.match(styles[4], /background-color:#bfdbfe/);
  assert.equal(cells[5], '<strong>12:00:00</strong>');
});

test('Hari biasa dan koreksi manual tetap memakai warna aslinya', () => {
  const regular = calculate([event('08', '08:00:00', 'Masuk'), event('08', '12:30:00', 'Masuk Setelah Istirahat'), event('08', '17:00:00', 'Keluar')]);
  assert.equal(regular.styles[3], 'style=""');
  const corrected = calculate([event('08', '08:00:00', 'Masuk'), event('08', '13:30:00', 'Masuk Setelah Istirahat', 'Koreksi Manual'), event('08', '17:00:00', 'Keluar')]);
  assert.match(corrected.styles[3], /background:#fbcfe8/);
});

test('Data izin lama berhenti berwarna setelah masuk fisik meski tanpa cap Kembali Bekerja', () => {
  const { cells, styles } = calculate([
    event('08', '09:30:08', 'Izin'),
    event('08', '13:18:13', 'Masuk'),
    event('08', '13:32:03', 'Masuk Setelah Istirahat'),
    event('08', '17:14:58', 'Keluar')
  ]);
  assert.equal(cells[3], '13:18:13');
  assert.equal(cells[4], '17:14:58');
  assert.match(styles[1], /background-color:#bbf7d0/);
  assert.match(styles[3], /background-color:#ffffff/);
  assert.match(styles[4], /background-color:#ffffff/);
});

test('Masuk pagi tambahan tidak menggantikan checkpoint masuk siang', () => {
  const { cells } = calculate([
    event('08', '08:45:00', 'Masuk', 'Koreksi Manual'),
    event('08', '08:46:05', 'Masuk'),
    event('08', '12:57:14', 'Masuk Setelah Istirahat'),
    event('08', '17:46:12', 'Keluar')
  ]);
  assert.equal(cells[1], '08:45:00');
  assert.equal(cells[3], '12:57:14');
});

test('Izin setelah masuk menutup sesi pada waktu izin dan hanya sel keluar yang hijau', () => {
  const { cells, styles } = calculate([
    event('08', '08:00:06', 'Masuk'),
    event('08', '13:02:37', 'Izin')
  ]);
  assert.equal(cells[1], '08:00:06');
  assert.equal(cells[2], '13:02:37');
  assert.equal(cells[5], '<strong>05:02:31</strong>');
  assert.doesNotMatch(styles[1], /#bbf7d0/);
  assert.match(styles[2], /background-color:#bbf7d0/);
  assert.equal(cells[9], '- Rp 0');
});

test('Sakit setelah masuk memakai kuota untuk mengisi sisa hari', () => {
  const { cells, styles } = calculate([
    event('08', '08:00:00', 'Masuk'),
    event('08', '15:15:00', 'Sakit')
  ]);
  assert.equal(cells[1], '08:00:00');
  assert.equal(cells[2], '-');
  assert.equal(cells[4], '17:00');
  assert.equal(cells[5], '<strong>09:00:00</strong>');
  assert.doesNotMatch(styles[1], /#bfdbfe/);
  assert.match(styles[4], /background-color:#bfdbfe/);
});

test('Juna-like sick submission in the morning is not shown as exit while quota remains', () => {
  const { cells, styles, row } = calculate([
    event('01', '08:00:00', 'Sakit'),
    event('08', '07:43:41', 'Masuk'),
    event('08', '09:21:26', 'Sakit')
  ]);
  assert.deepEqual(cells.slice(1, 5), ['07:43:41', '-', '13:30', '17:00']);
  assert.match(styles[3], /background-color:#bfdbfe/);
  assert.match(styles[4], /background-color:#bfdbfe/);
  assert.equal(cells[5], '<strong>09:00:00</strong>');
  assert.match(row, /Pengajuan Sakit: 09:21:26/);
});

test('Sakit setelah masuk saat kuota habis memakai waktu pengajuan sebagai keluar biru', () => {
  const earlier = ['01', '02', '03'].map(day => event(day, '08:00:00', 'Sakit'));
  const { cells, styles } = calculate([...earlier,
    event('08', '08:00:00', 'Masuk'),
    event('08', '09:21:26', 'Sakit')
  ]);
  assert.equal(cells[2], '09:21:26');
  assert.equal(cells[3], '-');
  assert.equal(cells[4], '-');
  assert.equal(cells[5], '<strong>01:21:26</strong>');
  assert.match(styles[2], /background-color:#bfdbfe/);
});

test('Keluar tambahan tanpa masuk kembali tidak menggantikan waktu izin sebagai penutup sesi', () => {
  const { cells, styles } = calculate([
    event('08', '08:00:06', 'Masuk'),
    event('08', '13:02:37', 'Izin'),
    event('08', '17:00:00', 'Keluar')
  ]);
  assert.equal(cells[2], '13:02:37');
  assert.equal(cells[4], '-');
  assert.match(styles[2], /background-color:#bbf7d0/);
  assert.equal(cells[5], '<strong>05:02:31</strong>');
});
