const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
// Zona operasional aplikasi; perubahan zona browser berada di luar lingkup perbaikan ini.
process.env.TZ = 'Asia/Makassar';
const root = path.resolve(__dirname, '..', process.env.ATTENDANCE_SOURCE_DIR || '.');
const source = fs.readFileSync(path.join(root, 'codeabsensi.txt'), 'utf8');
const name = 'Asyahrul Mubarak';
const user = { username: 'asyahrul', namaAsli: name, role: 'teknisi', hakAksesCabang: 'Kendari', gajiPokok: 1500000 };
let sequence = 0;
function row(day, time, type, status = '') {
  return { id_absen: 'TEST-' + ++sequence, nama_pegawai: name, role: 'teknisi',
    waktu_absen: new Date(`${day}T${time}+08:00`).toISOString(), tipe_absen: type,
    status_disiplin: status, keterangan: '' };
}
function harness(initial, now, leaveApplications = []) {
  const rows = structuredClone(initial);
  let locked = false;
  const FixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new Date(now).getTime(); }
  };
  const context = vm.createContext({ console, Date: FixedDate,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-only' }) },
    LockService: { getScriptLock: () => ({ waitLock() { assert.equal(locked, false); locked = true; }, releaseLock() { locked = false; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
    Utilities: { formatDate(value, zone, format) {
      assert.equal(zone, 'Asia/Makassar');
      const d = new Date(new Date(value).getTime() + 8 * 3600000);
      if (format === 'yyyy-MM-dd') return d.toISOString().slice(0, 10);
      if (format === 'H') return String(d.getUTCHours());
      if (format === 'm') return String(d.getUTCMinutes());
      if (format === 's') return String(d.getUTCSeconds());
      throw Error('Unhandled format: ' + format);
    } }
  });
  vm.runInContext(source, context);
  context.verifikasiSessionToken_ = () => 'asyahrul';
  context.callSupabase_ = (endpoint, method = 'GET', payload) => {
    const url = new URL(endpoint);
    if (url.pathname.endsWith('/users')) return [{ username: 'asyahrul', nama_asli: name, role: user.role, hak_akses_cabang: user.hakAksesCabang, gaji_pokok: user.gajiPokok }];
    if (url.pathname.endsWith('/pengajuan_cuti')) return structuredClone(leaveApplications);
    assert.ok(url.pathname.endsWith('/absensi'), 'Unexpected table');
    if (method === 'POST') {
      const batch = Array.isArray(payload) ? payload : [payload];
      for (const r of batch) {
        assert.ok(!rows.some(old => old.id_absen === r.id_absen), 'Duplicate ID');
        rows.push(structuredClone(r));
      }
      return batch;
    }
    assert.ok(['GET', 'DELETE'].includes(method));
    let selected = rows.filter(r => [...url.searchParams].every(([key, rule]) => {
      if (['order', 'select', 'limit', 'offset'].includes(key)) return true;
      const dot = rule.indexOf('.'); const op = rule.slice(0, dot); const value = rule.slice(dot + 1);
      const left = key === 'waktu_absen' ? new Date(r[key]).getTime() : r[key];
      const right = key === 'waktu_absen' ? new Date(value).getTime() : value;
      if (op === 'eq') return left === right;
      if (op === 'gte') return left >= right;
      if (op === 'lt') return left < right;
      throw Error('Unhandled filter: ' + key + '=' + rule);
    }));
    selected.sort((a, b) => new Date(a.waktu_absen) - new Date(b.waktu_absen) || a.id_absen.localeCompare(b.id_absen));
    if ((url.searchParams.get('order') || '').startsWith('waktu_absen.desc')) selected.reverse();
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || 1000);
    const result = structuredClone(selected.slice(offset, offset + limit));
    if (method === 'DELETE') {
      for (const record of result) rows.splice(rows.findIndex(r => r.id_absen === record.id_absen), 1);
    }
    return result;
  };
  return { context, rows, submit(type, extra = {}) {
    return context.doPost({ postData: { contents: JSON.stringify({ apiKey: 'ALFACOM_SECURE_KEY_2026',
      user: {}, tipeAbsen: type, latitude: -3.9641006831731826, longitude: 122.54316001476751, ...extra }) } });
  } };
}
function autoExits(rows) { return rows.filter(r => r.status_disiplin.includes('Auto Keluar')); }

test('Masuk siang tanggal 5 menutup tanggal 4 pada 17:00', () => {
  const h = harness([row('2026-09-04', '08:06:47', 'Masuk'), row('2026-09-04', '12:46:13', 'Masuk Setelah Istirahat'), row('2026-09-05', '08:10:00', 'Masuk')], '2026-09-05T12:39:22+08:00');
  assert.equal(h.submit('Masuk Setelah Istirahat').status, 'sukses');
  assert.equal(autoExits(h.rows).length, 1);
  assert.equal(autoExits(h.rows)[0].waktu_absen, '2026-09-04T09:00:00.000Z');
});

test('Tanpa masuk pagi atau izin/sakit, Masuk Setelah Istirahat ditolak dan Masuk siang menjadi pagi terlambat', () => {
  const h = harness([], '2026-09-08T12:36:26+08:00');
  assert.equal(h.submit('Masuk Setelah Istirahat').status, 'gagal');
  assert.equal(h.rows.length, 0);
  assert.equal(h.submit('Masuk').status, 'sukses');
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].tipe_absen, 'Masuk');
  assert.equal(h.rows[0].status_disiplin, 'Terlambat Masuk');
});

test('Batas masuk setelah istirahat tepat 13:30:00 dan terlambat mulai detik berikutnya', () => {
  const tepat = harness([row('2026-09-08', '08:00:00', 'Masuk')], '2026-09-08T13:30:00+08:00');
  assert.equal(tepat.submit('Masuk Setelah Istirahat').status, 'sukses');
  assert.equal(tepat.rows.at(-1).status_disiplin, 'Tepat Waktu');
  const terlambat = harness([row('2026-09-08', '08:00:00', 'Masuk')], '2026-09-08T13:30:01+08:00');
  assert.equal(terlambat.submit('Masuk Setelah Istirahat').status, 'sukses');
  assert.equal(terlambat.rows.at(-1).status_disiplin, 'Terlambat Setelah Istirahat');
});

test('Izin atau sakit sebelumnya membolehkan masuk siang tanpa masuk pagi', () => {
  for (const status of ['Izin', 'Sakit']) {
    const h = harness([row('2026-09-08', '08:00:00', status, 'Pengajuan Disetujui')], '2026-09-08T12:36:26+08:00');
    assert.equal(h.submit('Masuk Setelah Istirahat').status, 'sukses');
    assert.equal(h.rows.at(-1).tipe_absen, 'Masuk Setelah Istirahat');
    const plain = harness([row('2026-09-08', '08:00:00', status, 'Pengajuan Disetujui')], '2026-09-08T12:36:26+08:00');
    assert.equal(plain.submit('Masuk').status, 'sukses');
    assert.equal(plain.rows.at(-1).tipe_absen, 'Masuk Setelah Istirahat');
  }
});

test('Pengajuan izin aktif yang diproyeksikan membolehkan masuk siang', () => {
  const leave = [{ id_pengajuan: 'PGJ-TEST', nama_pegawai: name, role: 'teknisi', jenis: 'Izin', status: 'Disetujui',
    tanggal_mulai: '2026-09-08', tanggal_selesai: '2026-09-08', alasan: 'Izin pagi' }];
  const h = harness([], '2026-09-08T12:36:26+08:00', leave);
  assert.equal(h.submit('Masuk Setelah Istirahat').status, 'sukses');
  assert.equal(h.rows.at(-1).tipe_absen, 'Masuk Setelah Istirahat');
});

test('Keluar 00:20 Ahad menutup Sabtu tanpa membuat Masuk Ahad 13:30', () => {
  const h = harness([row('2026-09-05', '12:39:22', 'Masuk Setelah Istirahat')], '2026-09-06T00:20:16+08:00');
  assert.equal(h.submit('Keluar', { keterangan: 'Tes lembur hari' }).status, 'sukses');
  assert.equal(h.rows.filter(r => r.status_disiplin.includes('Lupa Absen Masuk')).length, 0);
  assert.equal(h.rows.filter(r => r.tipe_absen === 'Keluar').length, 1);
});

function finalize(h, now, profile = user, dryRun = false) {
  return h.context.tutupAbsenTerbukaSebelumnya_(profile, new Date(now), h.context.kebijakanJamUntukUser_(profile), dryRun);
}

test('Trigger menutup hari lama tanpa menunggu pegawai absen kembali; pengulangan tidak menduplikasi', () => {
  const h = harness([row('2026-09-04', '08:06:47', 'Masuk')], '2026-09-05T06:15:00+08:00');
  assert.equal(h.context.finalisasiAbsensiOtomatis(), 1);
  assert.equal(h.context.finalisasiAbsensiOtomatis(), 0);
  assert.equal(autoExits(h.rows).length, 1);
});

test('Sesi tanggal 4 tetap ditemukan ketika tanggal 5 sudah lengkap', () => {
  const h = harness([row('2026-09-04', '08:06:47', 'Masuk'), row('2026-09-05', '12:39:22', 'Masuk Setelah Istirahat'), row('2026-09-06', '00:20:16', 'Keluar')], '2026-09-06T06:15:00+08:00');
  assert.equal(h.context.finalisasiAbsensiOtomatis(), 1);
  assert.equal(autoExits(h.rows)[0].waktu_absen, '2026-09-04T09:00:00.000Z');
});

test('Tidak memotong lembur nyata sebelum batas 06:00', () => {
  const h = harness([row('2026-09-05', '12:39:22', 'Masuk Setelah Istirahat')], '2026-09-06T05:59:59+08:00');
  assert.equal(finalize(h, '2026-09-06T05:59:59+08:00').length, 0);
  assert.equal(finalize(h, '2026-09-06T06:00:00+08:00').length, 1);
});

test('Keluar pribadi lalu masuk kembali tetap perlu finalisasi', () => {
  const h = harness([row('2026-09-04', '08:00:00', 'Masuk'), row('2026-09-04', '10:00:00', 'Keluar'), row('2026-09-04', '13:00:00', 'Masuk Setelah Istirahat')], '2026-09-05T08:00:00+08:00');
  assert.equal(finalize(h, '2026-09-05T08:00:00+08:00').length, 1);
});

test('Keluar pagi tanpa Masuk tidak membuat jam masuk 13:30 di masa depan', () => {
  const h = harness([], '2026-09-05T10:00:00+08:00');
  assert.equal(h.submit('Keluar').status, 'sukses');
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].tipe_absen, 'Keluar');
});

test('Kebijakan lupa Masuk 13:30 berlaku untuk keluar sore', () => {
  const h = harness([], '2026-09-05T17:00:00+08:00');
  assert.equal(h.submit('Keluar').status, 'sukses');
  assert.equal(h.rows.length, 2);
  assert.equal(h.rows.find(r => r.tipe_absen === 'Masuk').waktu_absen, '2026-09-05T05:30:00.000Z');
});

test('Lupa checkpoint siang dipotong per detik dan dicatat bersama absen keluar', () => {
  const berjalan = harness([row('2026-09-05', '08:00:00', 'Masuk')], '2026-09-05T14:00:01+08:00');
  assert.equal(berjalan.submit('Keluar').status, 'sukses');
  const hukumanBerjalan = berjalan.rows.find(r => r.tipe_absen === 'Hukuman Sistem');
  assert.match(hukumanBerjalan.status_disiplin, /Potongan 00:30:01/);

  const maksimal = harness([row('2026-09-05', '08:00:00', 'Masuk')], '2026-09-05T17:00:00+08:00');
  assert.equal(maksimal.submit('Keluar').status, 'sukses');
  const hukumanMaksimal = maksimal.rows.find(r => r.tipe_absen === 'Hukuman Sistem');
  assert.match(hukumanMaksimal.status_disiplin, /Potongan 01:30:00/);
});

test('Penolakan upload foto tidak menyimpan auto Masuk atau auto Keluar parsial', () => {
  const h = harness([row('2026-09-04', '08:00:00', 'Masuk')], '2026-09-05T21:00:00+08:00');
  assert.equal(h.submit('Keluar', { fotoBase64: 'data:image/jpeg;base64,' + 'A'.repeat(100), keterangan: 'Lembur' }).status, 'gagal');
  assert.equal(h.rows.length, 1);
});

test('Input keluar ganda dini hari ditolak tanpa membuat data Ahad', () => {
  const h = harness([row('2026-09-05', '12:39:22', 'Masuk Setelah Istirahat'), row('2026-09-06', '00:20:16', 'Keluar')], '2026-09-06T00:21:16+08:00');
  assert.equal(h.submit('Keluar').status, 'gagal');
  assert.equal(h.rows.length, 2);
});

test('Keluar dini hari pergantian bulan tetap memakai Masuk bulan sebelumnya', () => {
  const h = harness([row('2026-08-31', '08:00:00', 'Masuk')], '2026-09-01T01:00:00+08:00');
  assert.equal(h.submit('Keluar').status, 'sukses');
  assert.equal(h.rows.filter(r => r.tipe_absen === 'Masuk').length, 1);
  assert.equal(h.rows.find(r => r.tipe_absen === 'Keluar').waktu_absen, '2026-08-31T17:00:00.000Z');
});

test('Finalisasi mengikuti jadwal Raha 20:00 dan pengecualian admin Raha 17:00', () => {
  for (const [role, hour] of [['teknisi', '12'], ['admin', '09']]) {
    const profile = { ...user, role, hakAksesCabang: 'Raha' };
    const h = harness([row('2026-09-04', '08:00:00', 'Masuk')], '2026-09-05T08:00:00+08:00');
    const result = finalize(h, '2026-09-05T08:00:00+08:00', profile);
    assert.equal(result[0].waktu_absen, `2026-09-04T${hour}:00:00.000Z`);
  }
});

test('Tiga kelalaian pertama normal, keempat penalti; hitungan reset antarbulan', () => {
  const initial = [row('2026-08-31', '17:00:00', 'Keluar', 'Auto Keluar (Lupa Absen Keluar)')];
  for (let day = 1; day <= 4; day++) initial.push(row(`2026-09-0${day}`, '08:00:00', 'Masuk'));
  const h = harness(initial, '2026-09-05T08:00:00+08:00');
  const result = finalize(h, '2026-09-05T08:00:00+08:00');
  assert.equal(result.length, 4);
  assert.equal(result[2].waktu_absen, '2026-09-03T09:00:00.000Z');
  assert.equal(result[3].waktu_absen, '2026-09-04T07:30:00.000Z');
});

test('Audit dry-run tidak menulis ke database', () => {
  const h = harness([row('2026-09-04', '08:00:00', 'Masuk')], '2026-09-05T08:00:00+08:00');
  assert.equal(finalize(h, '2026-09-05T08:00:00+08:00', user, true).length, 1);
  assert.equal(h.rows.length, 1);
});

test('Riwayat di atas 500 baris tetap mencakup hari yang tertinggal', () => {
  const initial = Array.from({ length: 510 }, () => row('2026-09-04', '09:00:00', 'Catatan'));
  initial.push(row('2026-09-04', '08:00:00', 'Masuk'));
  const h = harness(initial, '2026-09-05T08:00:00+08:00');
  assert.equal(finalize(h, '2026-09-05T08:00:00+08:00').length, 1);
});

const frontend = fs.readFileSync(path.join(root, 'slipgaji.html'), 'utf8');
function payroll(rows, now = '2026-09-06T08:00:00+08:00', month = '2026-09') {
  const DateClass = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
  };
  const context = vm.createContext({ Date: DateClass,
    globalUsers: [{ 'Nama Asli': name, 'Gaji Pokok': 1000000, 'Role': 'teknisi', 'Hak_Akses_Cabang': 'Kendari' }],
    globalAbsen: rows.map(r => ({ 'Nama Pegawai': r.nama_pegawai, 'Waktu Absen': r.waktu_absen,
      'Tipe Absen': r.tipe_absen, 'Status Disiplin': r.status_disiplin, 'Keterangan': r.keterangan })),
    globalTickets: [], ambilVariabelPayroll: () => ({ luarKota: '', fee: 0, kasbon: 0 }), formatRp: v => 'Rp ' + Math.round(v)
  });
  vm.runInContext(frontend.slice(frontend.indexOf('        function normalisasiCabangPayroll'), frontend.indexOf('        function generateSlipIndividu')), context);
  return context.kalkulasiGajiPegawai(name, month, 26);
}
function dayHtml(result, date) {
  return result.barisHTML.split('<tr ').find(r => r.includes(date)) || '';
}

test('Slip: hasil perbaikan tanggal 4 terisi 17:00, Sabtu tetap 00:20 (+1), Ahad kosong', () => {
  const h = harness([row('2026-09-04', '08:06:47', 'Masuk'), row('2026-09-04', '12:46:13', 'Masuk Setelah Istirahat'), row('2026-09-05', '12:39:22', 'Masuk Setelah Istirahat'), row('2026-09-06', '00:20:16', 'Keluar')], '2026-09-06T08:00:00+08:00');
  finalize(h, '2026-09-06T08:00:00+08:00');
  const result = payroll(h.rows);
  assert.match(dayHtml(result, '04/09/2026'), /17:00:00/);
  assert.match(dayHtml(result, '04/09/2026'), /08:53:13/);
  assert.match(dayHtml(result, '05/09/2026'), /00:20:16 \(\+1\)/);
  assert.match(dayHtml(result, '05/09/2026'), /11:40:54/);
  assert.doesNotMatch(dayHtml(result, '06/09/2026'), /13:00|Berjalan/);
});

test('Slip: lembur melintasi bulan tetap dihitung pada bulan sebelumnya', () => {
  const result = payroll([row('2026-08-31', '08:00:00', 'Masuk'), row('2026-09-01', '01:00:00', 'Keluar')], '2026-09-06T08:00:00+08:00', '2026-08');
  assert.match(dayHtml(result, '31/08/2026'), /01:00:00 \(\+1\)/);
});

test('Slip: sakit pagi kosong biru saat masuk siang nyata, dan auto keluar 17:00', () => {
  const sakit = { ...row('2026-09-08', '08:00:00', 'Sakit', 'Pengajuan Disetujui'),
    keterangan: '[ID Pengajuan: PGJ-20260908075046-D79EE] Disetujui oleh ABU ABID.' };
  const hariSebelumnya = [1, 2, 3, 4, 5, 7].flatMap(day => [
    row(`2026-09-${String(day).padStart(2, '0')}`, '08:00:00', 'Masuk'),
    row(`2026-09-${String(day).padStart(2, '0')}`, '13:30:00', 'Masuk Setelah Istirahat'),
    row(`2026-09-${String(day).padStart(2, '0')}`, '17:00:00', 'Keluar')
  ]);
  const result = payroll([...hariSebelumnya, sakit, row('2026-09-08', '12:36:26', 'Masuk')], '2026-09-09T12:39:00+08:00');
  const html = dayHtml(result, '08/09/2026');
  assert.match(html, /background-color:#bfdbfe[^>]*>-<\/td>/);
  assert.match(html, />12:36:26<\/td>/);
  assert.match(html, />17:00:00<\/td>/);
  assert.match(html, />09:00:00<\/strong>/);
  assert.match(html, /background-color:#bfdbfe/);
  assert.match(html, /Sakit berhenti saat absen fisik 12:36:26/);
  assert.doesNotMatch(html, /Berjalan/);
  assert.equal(result.totalPotongan, 0);
});

test('Slip: sakit keempat tetap kosong biru tanpa upah dan tanpa penalti sakit', () => {
  const rows = [1, 2, 3, 4].map(day => row(`2026-09-0${day}`, '08:00:00', 'Sakit', 'Pengajuan Disetujui'));
  const result = payroll(rows, '2026-09-04T18:00:00+08:00');
  const html = dayHtml(result, '04/09/2026');
  assert.doesNotMatch(html, /08:00|13:30|17:00|#e2e8f0/);
  assert.match(html, /Sakit \(Kuota Habis, Upah Mengikuti Kehadiran\)/);
  assert.match(html, /background-color:#bfdbfe/);
  assert.equal(result.totalPotongan, 0);
  assert.equal(result.countKehadiran, 3);
});

test('Semua script inline slip gaji lolos parsing JavaScript', () => {
  for (const match of frontend.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
});

// Historical GAS snapshot comparison is opt-in after the Supabase cutover.
// Current authentication, photos and attendance are covered by their Supabase suites.
test('Arsip GAS: autentikasi, konfigurasi, dan validasi foto identik dengan snapshot lama', {skip:!process.env.SLA_VALIDATE_LEGACY_GAS}, () => {
  const original = fs.readFileSync(path.join(root, 'tmp/attendance-before/codeabsensi.txt'), 'utf8').replace(/\r\n/g, '\n');
  // Pengajuan kini menyertakan tautan aplikasi; bagian lain tetap dibandingkan persis.
  const modified = source.replace(/\r\n/g, '\n').replaceAll(
    'hak_akses_cabang,gaji_pokok&limit=', 'hak_akses_cabang&limit='
  ).replace(
    'hakAksesCabang: dbUser[0].hak_akses_cabang,\n      gajiPokok: dbUser[0].gaji_pokok,\n      noWA: dbUser[0].no_wa',
    'hakAksesCabang: dbUser[0].hak_akses_cabang'
  ).replace(
    "    var bolehSlipPribadi = data.action === 'getAbsen' && bolehBacaSlipPribadiKendari_(userLogin);\n    if (!punyaHakAbsen && !bolehSlipPribadi) {",
    '    if (!punyaHakAbsen) {'
  ).replace(
    'Akses Ditolak: Absensi dan Slip Gaji hanya untuk pegawai yang memiliki gaji pokok, kecuali Direktur.',
    'Akses Ditolak: akun ini belum diizinkan menggunakan modul absensi.'
  ).replace(
    '\\n\\nBuka aplikasi: https://aplikasisla.vercel.app/\\nSetelah login, pilih Absensi > Approval Pengajuan.', ''
  ).replace(
    /\n    \/\/ Masuk siang hanya menjadi checkpoint setelah istirahat jika sudah ada[\s\S]*?\n    }\n(?=\n    \/\/ Jika hanya absen keluar)/, ''
  ).replace(
    /\n    \/\/ ----------------------------------------------------\n    if \(data\.action === 'syncPengecualianKoreksiLuarKota'\) \{[\s\S]*?\n    }\n(?=\n    \/\/ ----------------------------------------------------\n    \/\/ MENU: AMBIL DATA ABSEN)/, ''
  );
  for (const [start, end] of [
    ['    // Verifikasi SSO dari Supabase Users', "    if (data.action === 'getAbsen')"],
    ['    // Validasi anti-input ganda', '    // Upload Foto Bukti ke Drive']
  ]) {
    const chunk = original.slice(original.indexOf(start), original.indexOf(end));
    assert.ok(chunk.length > 0);
    assert.ok(modified.includes(chunk), 'Unrelated section changed: ' + start);
  }
  assert.equal(modified.slice(modified.indexOf('function normalisasiNoWA_')), original.slice(original.indexOf('function normalisasiNoWA_')));
});

function repairHarness(extra = []) {
  const friday = row('2026-09-04', '08:06:47.453', 'Masuk');
  const fridayNoon = row('2026-09-04', '12:46:13.547', 'Masuk Setelah Istirahat');
  const saturday = { ...row('2026-09-05', '12:39:22.355', 'Masuk Setelah Istirahat'), id_absen: 'ABS-1788583163158' };
  const exit = { ...row('2026-09-06', '00:20:16.468', 'Keluar'), id_absen: 'ABS-1788625219909' };
  const phantom = { ...row('2026-09-06', '13:00:00', 'Masuk', 'Lupa Absen Masuk (Auto)'), id_absen: 'ABS-AUTO-MASUK-1788625217316' };
  const h = harness([friday, fridayNoon, saturday, exit, phantom, ...extra], '2026-09-06T11:00:00+08:00');
  const properties = new Map();
  h.context.PropertiesService = { getScriptProperties: () => ({ getProperty: key => properties.get(key), setProperty: (key, value) => properties.set(key, value) }) };
  h.context.console = { log() {} };
  vm.runInContext(fs.readFileSync(path.join(root, 'output/attendance-fix/repair-two-records.gs'), 'utf8'), h.context);
  return { ...h, properties };
}

test('Koreksi historis hanya menambah Jumat dan menghapus satu catatan Ahad palsu; sesi Sabtu identik', () => {
  const h = repairHarness();
  const before = structuredClone(h.rows);
  h.context.perbaikiDuaKasusAbsensiSeptember2026();
  for (const old of before.filter(r => r.id_absen !== 'ABS-AUTO-MASUK-1788625217316')) assert.deepEqual(h.rows.find(r => r.id_absen === old.id_absen), old);
  assert.equal(h.rows.some(r => r.id_absen === 'ABS-AUTO-MASUK-1788625217316'), false);
  assert.equal(autoExits(h.rows).length, 1);
  assert.equal(JSON.parse(h.properties.get('ABSENSI_BACKUP_DUA_KASUS_20260906')).salah[0].id_absen, 'ABS-AUTO-MASUK-1788625217316');
});

test('Koreksi historis dapat diulang tanpa duplikasi atau menimpa backup awal', () => {
  const h = repairHarness();
  h.context.perbaikiDuaKasusAbsensiSeptember2026();
  const after = structuredClone(h.rows);
  const backup = h.properties.get('ABSENSI_BACKUP_DUA_KASUS_20260906');
  h.context.perbaikiDuaKasusAbsensiSeptember2026();
  assert.deepEqual(h.rows, after);
  assert.equal(h.properties.get('ABSENSI_BACKUP_DUA_KASUS_20260906'), backup);
});

test('Koreksi historis berhenti tanpa perubahan jika ada sesi Ahad yang nyata', () => {
  const h = repairHarness([row('2026-09-06', '09:00:00', 'Masuk')]);
  const before = structuredClone(h.rows);
  assert.throws(() => h.context.perbaikiDuaKasusAbsensiSeptember2026(), /Ada sesi Ahad baru/);
  assert.deepEqual(h.rows, before);
});

test('Koreksi historis berhenti tanpa perubahan ketika waktu target telah dikoreksi orang lain', () => {
  const h = repairHarness();
  h.rows.find(r => r.id_absen === 'ABS-AUTO-MASUK-1788625217316').waktu_absen = '2026-09-06T06:00:00.000Z';
  const before = structuredClone(h.rows);
  assert.throws(() => h.context.perbaikiDuaKasusAbsensiSeptember2026(), /Catatan target berubah/);
  assert.deepEqual(h.rows, before);
});
