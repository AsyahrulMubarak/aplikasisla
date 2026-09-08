const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
process.env.TZ = 'Asia/Makassar';
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'slipgaji.html'), 'utf8');
const name = 'Pegawai Uji Argo';

function event(time, type, day = '2026-09-08', status = '') {
  return { 'Nama Pegawai': name, 'Waktu Absen': `${day}T${time}+08:00`,
    'Tipe Absen': type, 'Status Disiplin': status, Keterangan: '' };
}
function calculate(events, options = {}) {
  const { branch = 'Kendari', role = 'teknisi', now = '2026-09-09T08:00:00+08:00', month = '2026-09' } = options;
  const hours = branch === 'Raha' && !['admin', 'admin_raha'].includes(role) ? 12 : 9;
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
  }
  const c = vm.createContext({ Date: FixedDate,
    globalUsers: [{ 'Nama Asli': name, 'Gaji Pokok': 26 * hours * 10000, Role: role, Hak_Akses_Cabang: branch }],
    globalAbsen: events, globalTickets: [], formatRp: value => 'Rp ' + Math.round(value),
    ambilVariabelPayroll: () => ({ luarKota: '', fee: 0, kasbon: 0 }) });
  vm.runInContext(html.slice(html.indexOf('        function normalisasiCabangPayroll'), html.indexOf('        function generateSlipIndividu')), c);
  return c.kalkulasiGajiPegawai(name, month, 26);
}
function assertMinutes(result, regular, overtime) {
  assert.ok(Math.abs(result.totalUpahHadir - regular * 10000 / 60) < 0.000001,
    `Upah pokok ${result.totalUpahHadir}; seharusnya ${regular} menit`);
  assert.ok(Math.abs(result.totalLembur - overtime * 5000 / 60) < 0.000001,
    `Upah lembur ${result.totalLembur}; seharusnya ${overtime} menit`);
}

for (const [branch, start, end, regular, overtime] of [
  ['Kendari', '08:25', '17:00', 515, 0],
  ['Kendari', '08:25', '17:24', 539, 0],
  ['Kendari', '08:25', '17:25', 540, 0],
  ['Kendari', '08:25', '17:26', 540, 1],
  ['Kendari', '08:25', '18:25', 540, 60],
  ['Raha', '08:25', '20:00', 695, 0],
  ['Raha', '08:25', '20:24', 719, 0],
  ['Raha', '08:25', '20:25', 720, 0],
  ['Raha', '08:25', '20:26', 720, 1],
  ['Raha', '08:25', '21:25', 720, 60],
  ['Kendari', '13:00', '19:59', 419, 0],
  ['Kendari', '13:00', '20:00', 420, 0],
  ['Kendari', '13:00', '20:01', 420, 1],
  ['Kendari', '13:00', '23:00', 420, 180],
  ['Raha', '13:00', '21:59', 539, 0],
  ['Raha', '13:00', '22:00', 540, 0],
  ['Raha', '13:00', '22:01', 540, 1],
  ['Kendari', '21:00', '22:00', 0, 60],
  ['Raha', '22:30', '23:30', 0, 60],
  ['Kendari', '07:00', '17:00', 540, 0],
  ['Raha', '07:00', '20:00', 720, 0],
]) {
  test(`${branch}: ${start}–${end} = pokok ${regular} menit, lembur ${overtime} menit`, () => {
    assertMinutes(calculate([event(start + ':00', 'Masuk'), event(end + ':00', 'Keluar')], { branch }), regular, overtime);
  });
}

for (const [branch, start, now, regular, overtime, activeOvertime] of [
  ['Kendari', '08:25', '17:00', 515, 0, false],
  ['Kendari', '08:25', '17:24', 539, 0, false],
  ['Kendari', '08:25', '17:25', 540, 0, true],
  ['Kendari', '08:25', '17:26', 540, 1, true],
  ['Raha', '08:25', '20:00', 695, 0, false],
  ['Raha', '08:25', '20:25', 720, 0, true],
  ['Raha', '08:25', '20:26', 720, 1, true],
  ['Kendari', '13:00', '19:59', 419, 0, false],
  ['Kendari', '13:00', '20:00', 420, 0, true],
  ['Kendari', '13:00', '20:01', 420, 1, true],
  ['Raha', '13:00', '21:59', 539, 0, false],
  ['Raha', '13:00', '22:00', 540, 0, true],
  ['Raha', '13:00', '22:01', 540, 1, true],
]) {
  test(`Argo berjalan ${branch} masuk ${start}, saat ${now}: status dan nominal selaras`, () => {
    const r = calculate([event(start + ':00', 'Masuk')], { branch, now: `2026-09-08T${now}:00+08:00` });
    assertMinutes(r, regular, overtime);
    assert.match(r.barisHTML, /\(Berjalan\)/);
    assert.match(r.barisHTML, activeOvertime ? /Lembur berjalan/ : /Jam kerja berjalan/);
    assert.doesNotMatch(r.barisHTML, activeOvertime ? /Jam kerja berjalan/ : /Lembur berjalan/);
  });
}

test('Keluar menghentikan kedua argo meskipun belum cukup 9 jam', () => {
  const r = calculate([event('08:25:00', 'Masuk'), event('17:00:00', 'Keluar')], { now: '2026-09-08T23:00:00+08:00' });
  assertMinutes(r, 515, 0);
  assert.doesNotMatch(r.barisHTML, /Berjalan|Lembur berjalan/);
});

test('Jeda keluar pribadi tidak dihitung dan kuota 9 jam tidak diulang saat masuk kembali', () => {
  const r = calculate([event('08:25:00', 'Masuk'), event('10:25:00', 'Keluar'),
    event('12:00:00', 'Masuk Setelah Istirahat'), event('19:25:00', 'Keluar')]);
  assertMinutes(r, 540, 25);
});

test('Batas 20:00 tetap berlaku walaupun beberapa sesi belum berjumlah 9 jam', () => {
  const r = calculate([event('08:25:00', 'Masuk'), event('09:25:00', 'Keluar'),
    event('13:00:00', 'Masuk Setelah Istirahat'), event('20:30:00', 'Keluar')]);
  assertMinutes(r, 480, 30);
});

test('Masuk kembali setelah kuota pokok penuh seluruhnya dihitung lembur', () => {
  const r = calculate([event('08:25:00', 'Masuk'), event('17:25:00', 'Keluar'),
    event('18:00:00', 'Masuk'), event('19:00:00', 'Keluar')]);
  assertMinutes(r, 540, 60);
});

test('Checkpoint istirahat tidak memulai ulang kuota; potongan telat siang tetap berlaku', () => {
  const r = calculate([event('08:25:00', 'Masuk'), event('13:30:00', 'Masuk Setelah Istirahat'), event('18:25:00', 'Keluar')]);
  const onTime = calculate([event('08:25:00', 'Masuk'), event('13:00:00', 'Masuk Setelah Istirahat'), event('18:25:00', 'Keluar')]);
  assertMinutes(r, 540, 60);
  assert.equal(r.totalPotongan - onTime.totalPotongan, 5000);
});

for (const role of ['admin', 'admin_raha']) {
  test(`Pengecualian ${role} Raha tetap memakai 9 jam dan batas 20:00`, () => {
    assertMinutes(calculate([event('08:25:00', 'Masuk'), event('17:26:00', 'Keluar')], { branch: 'Raha', role }), 540, 1);
    assertMinutes(calculate([event('13:00:00', 'Masuk'), event('20:01:00', 'Keluar')], { branch: 'Raha', role }), 420, 1);
  });
}

test('Keluar dini hari setelah batas mutlak tidak menambah upah pokok', () => {
  const r = calculate([event('13:00:00', 'Masuk'), event('00:20:00', 'Keluar', '2026-09-09')]);
  assertMinutes(r, 420, 260);
  assert.match(r.barisHTML, /00:20:00 \(\+1\)/);
});

test('Lembur lintas bulan tetap mengikuti hari kerja sebelumnya', () => {
  const r = calculate([event('08:25:00', 'Masuk', '2026-08-31'), event('00:20:00', 'Keluar', '2026-09-01')], { month: '2026-08' });
  assertMinutes(r, 540, 415);
});

test('Auto keluar lupa pulang tetap menutup pada jadwal/penalti yang tercatat', () => {
  for (const [time, status, minutes] of [
    ['17:00:00', 'Auto Keluar (Lupa Absen Keluar)', 515],
    ['15:30:00', 'Auto Keluar (Penalti Lupa Absen Keluar)', 425],
  ]) {
    assertMinutes(calculate([event('08:25:00', 'Masuk'), event(time, 'Keluar', '2026-09-08', status)]), minutes, 0);
  }
});

test('Izin dengan kehadiran nyata memakai batas argo yang sama', () => {
  assertMinutes(calculate([event('08:00:00', 'Izin'), event('13:00:00', 'Masuk'), event('20:01:00', 'Keluar')]), 420, 1);
});

test('Setelah kuota sakit habis, sesi nyata memakai batas 20:00 tanpa pokok tambahan', () => {
  const earlier = ['01', '02', '03'].map(day => event('08:00:00', 'Sakit', '2026-09-' + day));
  const r = calculate([...earlier, event('08:00:00', 'Sakit'), event('13:00:00', 'Masuk'), event('20:01:00', 'Keluar')]);
  assertMinutes(r, 3 * 540 + 420, 1);
});

test('Sintaks seluruh script halaman slip gaji valid', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
});
