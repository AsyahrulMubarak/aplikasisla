'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
process.env.TZ = 'Asia/Makassar';

const html = fs.readFileSync(path.join(__dirname, '..', 'slipgaji.html'), 'utf8');
const oldBonuses = 'TIDAK TELAT MASUK PAGI, IZIN LEBIH 3X ATAU TIDAK ALPA LEBIH DARI 2X=100000|SHOLAT 5 WAKTU=100000|BONUS KARENA 2 TUNJANGAN DIATAS TERPENUHI=100000|Honor Lain=25000';

function events(name, { izin = 0, telat = 0, alpa = 0 } = {}) {
  const rows = [];
  for (let day = 1; day <= 30; day++) {
    if (new Date(2026, 8, day).getDay() === 0) continue;
    const date = '2026-09-' + String(day).padStart(2, '0');
    const row = (time, type) => ({ 'Nama Pegawai': name,
      'Waktu Absen': `${date}T${time}:00+08:00`, 'Tipe Absen': type, 'Status Disiplin': '', Keterangan: '' });
    if (alpa-- > 0) continue;
    if (izin-- > 0) { rows.push(row('08:00', 'Izin')); continue; }
    rows.push(row(telat-- > 0 ? '10:00' : '08:00', 'Masuk'), row('20:00', 'Keluar'));
  }
  return rows;
}

function payroll({ name = 'Pegawai Raha', role = 'teknisi', branch = 'Raha', counts = {}, bonus = '', attendance, liburTambahan = '' } = {}) {
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-30T21:00:00+08:00'])); } }
  const context = vm.createContext({ Date: FixedDate, Set,
    globalUsers: [{ 'Nama Asli': name, Role: role, Hak_Akses_Cabang: branch, 'Gaji Pokok': 2600000, 'Bonus Tambahan': bonus }],
    globalAbsen: attendance || events(name, counts), globalTickets: [], formatRp: n => 'Rp ' + Math.round(n),
    ambilVariabelPayroll: () => ({ luarKota: '', liburTambahan, fee: 0, kasbon: 0 }) });
  vm.runInContext(html.slice(html.indexOf('        function normalisasiCabangPayroll'),
    html.indexOf('        function generateSlipIndividu')), context);
  return context.kalkulasiGajiPegawai(name, '2026-09', 26);
}

for (const [counts, expected] of [
  [{}, 300000],
  [{ izin: 3 }, 300000],
  [{ telat: 3 }, 300000],
  [{ izin: 2, telat: 1, alpa: 2 }, 300000],
  [{ izin: 2, telat: 2 }, 100000],
  [{ izin: 4 }, 100000],
  [{ telat: 4 }, 100000],
  [{ alpa: 3 }, 100000]
]) {
  test('bonus Raha mengikuti izin+telat dan alpa ' + JSON.stringify(counts), () => {
    const result = payroll({ counts });
    assert.equal(result.totalTunjanganTetap, expected);
    assert.equal(result.dendaDisiplin, 0);
    assert.equal(result.arrayTunjangan.length, 3);
    assert.equal(result.arrayTunjangan[1].nominal, 100000);
    assert.equal(result.arrayTunjangan[0].nominal, expected === 300000 ? 100000 : 0);
    assert.equal(result.arrayTunjangan[2].nominal, expected === 300000 ? 100000 : 0);
  });
}

test('bonus lama Raha diganti perhitungan otomatis tanpa menggandakan honor lain', () => {
  const result = payroll({ bonus: oldBonuses, counts: { izin: 2, telat: 2 } });
  assert.equal(result.totalTunjanganTetap, 125000);
  assert.equal(result.arrayTunjangan.length, 4);
  assert.equal(result.arrayTunjangan[0].nama, 'Honor Lain');
});

test('telat pada Ahad dan libur tambahan tidak mengurangi bonus disiplin Raha', () => {
  const name = 'Pegawai Raha';
  const attendance = events(name, { telat: 3 });
  const lateDay = day => {
    const date = '2026-09-' + String(day).padStart(2, '0');
    const row = (time, type) => ({ 'Nama Pegawai': name,
      'Waktu Absen': `${date}T${time}:00+08:00`, 'Tipe Absen': type, 'Status Disiplin': '', Keterangan: '' });
    const existing = attendance.find(item => item['Waktu Absen'].startsWith(date) && item['Tipe Absen'] === 'Masuk');
    if (existing) existing['Waktu Absen'] = `${date}T10:00:00+08:00`;
    else attendance.push(row('10:00', 'Masuk'), row('20:00', 'Keluar'));
  };
  lateDay(5); // Sabtu yang ditetapkan sebagai libur tambahan.
  lateDay(6); // Ahad.
  const result = payroll({ attendance, liburTambahan: '5' });
  assert.equal(result.countTelatPagi, 3);
  assert.equal(result.totalTunjanganTetap, 300000);
  assert.equal(result.arrayTunjangan[0].nominal, 100000);
});

test('telat hari libur dikecualikan, tetapi tiga alpa tetap menghanguskan bonus Raha', () => {
  const name = 'Pegawai Raha';
  const attendance = events(name, { alpa: 3 });
  attendance.push({ 'Nama Pegawai': name, 'Waktu Absen': '2026-09-06T10:00:00+08:00',
    'Tipe Absen': 'Masuk', 'Status Disiplin': '', Keterangan: '' });
  attendance.push({ 'Nama Pegawai': name, 'Waktu Absen': '2026-09-06T20:00:00+08:00',
    'Tipe Absen': 'Keluar', 'Status Disiplin': '', Keterangan: '' });
  const result = payroll({ attendance });
  assert.equal(result.countTelatPagi, 0);
  assert.equal(result.countAlpa, 3);
  assert.equal(result.totalTunjanganTetap, 100000);
});

test('aturan Raha berlaku pada admin Raha, sedangkan bonus Kendari tidak berubah', () => {
  const raha = payroll({ name: 'Admin Raha', role: 'admin_raha', counts: { izin: 2, telat: 2 } });
  assert.equal(raha.totalTunjanganTetap, 100000);
  assert.equal(raha.dendaDisiplin, 0);
  const kendari = payroll({ name: 'Pegawai Kendari', branch: 'Kendari', counts: { izin: 2, telat: 2 }, bonus: 'Tunjangan BBM=25000' });
  assert.equal(kendari.totalTunjanganTetap, 25000);
  assert.equal(kendari.dendaDisiplin, 300000);
});
