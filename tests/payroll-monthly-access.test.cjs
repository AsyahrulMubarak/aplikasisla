const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const lobbyHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const slipHtml = fs.readFileSync(path.join(root, 'slipgaji.html'), 'utf8');
const backendPath = [path.join(root, 'code.js'), path.resolve(root, '../code.js')]
  .find(candidate => fs.existsSync(candidate));
assert.ok(backendPath, 'Kendari backend source code.js is required');
const backend = fs.readFileSync(backendPath, 'utf8');

function extractFunction(source, name) {
  const match = source.match(new RegExp('^([ \\t]*)function ' + name + '\\([^]*?^\\1\\}', 'm'));
  assert.ok(match, `Missing function: ${name}`);
  return match[0];
}

test('Kendari technicians can open only the personal read-only payroll view', () => {
  const lobbyContext = vm.createContext({
    penggunaAktif: null,
    rolePengguna: user => String(user && user.Role || '').trim().toLowerCase(),
    hakAksesCabangPengguna: user => {
      const value = String(user && user.Hak_Akses_Cabang || '').trim().toLowerCase();
      return value === 'kendari' ? 'Kendari' : value === 'raha' ? 'Raha' : value === 'semua' ? 'Semua' : '';
    },
    roleAdalahManajemenUtama_: role => ['admin', 'manager', 'direktur'].includes(role)
  });
  vm.runInContext(extractFunction(lobbyHtml, 'penggunaBolehMengaksesSlipGaji_'), lobbyContext);
  assert.equal(lobbyContext.penggunaBolehMengaksesSlipGaji_({ Role: 'teknisi', Hak_Akses_Cabang: 'Kendari' }), true);
  assert.equal(lobbyContext.penggunaBolehMengaksesSlipGaji_({ Role: 'teknisi', Hak_Akses_Cabang: 'Raha' }), false);
  assert.equal(lobbyContext.penggunaBolehMengaksesSlipGaji_({ Role: 'sales', Hak_Akses_Cabang: 'Kendari' }), false);

  const slipContext = vm.createContext({ penggunaAktif: null, String, Array });
  vm.runInContext([
    extractFunction(slipHtml, 'normalisasiCabangSesi'),
    extractFunction(slipHtml, 'penggunaAdalahTeknisiKendariPayroll_'),
    extractFunction(slipHtml, 'penggunaBolehMembukaSlipGaji_'),
    extractFunction(slipHtml, 'penggunaBolehKelolaPayroll_')
  ].join('\n'), slipContext);
  slipContext.penggunaAktif = { Role: 'teknisi', Hak_Akses_Cabang: 'Kendari' };
  assert.equal(slipContext.penggunaBolehMembukaSlipGaji_(), true);
  assert.equal(slipContext.penggunaBolehKelolaPayroll_(), false);
  slipContext.penggunaAktif = { Role: 'teknisi', Hak_Akses_Cabang: 'Raha' };
  assert.equal(slipContext.penggunaBolehMembukaSlipGaji_(), false);

  assert.match(slipHtml, /input\.disabled = isPastMonth \|\| !bolehKelola/);
  assert.match(slipHtml, /Komponen payroll hanya dapat diubah oleh Manajemen/);
  assert.match(slipHtml, /btn-simpan-variabel'\)\.style\.display = 'none'/);
  assert.match(backend, /simpanVariabelPayroll:\s*manajemenUtama/);
});

test('backend scopes every technician payroll response to the authenticated employee', () => {
  const users = [
    { username: 'alif', role: 'teknisi', nama_asli: 'Alif', gaji_pokok: 2600000, hak_akses_cabang: 'Kendari' },
    { username: 'rendi', role: 'teknisi', nama_asli: 'Rendi', gaji_pokok: 2600000, hak_akses_cabang: 'Kendari' }
  ];
  const tickets = [
    { id_tiket: 'A-1', status: 'Selesai', status_pembayaran: 'Lunas', teknisi: 'Alif', bobot_poin: 1, cabang: 'Kendari' },
    { id_tiket: 'R-1', status: 'Selesai', status_pembayaran: 'Lunas', teknisi: 'Rendi', bobot_poin: 1, cabang: 'Kendari' }
  ];
  const responses = [users, tickets, []].map(rows => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify(rows)
  }));
  const payrollCalls = [];
  const context = vm.createContext({
    String,
    Array,
    JSON,
    parseInt,
    encodeURIComponent,
    SUPABASE_URL: 'https://example.test/',
    SUPABASE_KEY: 'test-key',
    cabangOperasional_: value => value || 'Kendari',
    daftarNamaMemuat_: (value, name) => String(value || '').split(',').map(item => item.trim()).includes(name),
    ambilVariabelPayrollBackend: (period, name) => {
      payrollCalls.push([period, name]);
      return [{ periode: period, namaPegawai: name, luarKota: '21, 22, 23' }];
    },
    UrlFetchApp: { fetchAll: () => responses },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: text => ({ text, setMimeType() { return this; } })
    }
  });
  vm.runInContext(extractFunction(backend, 'prosesGetPayrollData_'), context);
  const result = JSON.parse(context.prosesGetPayrollData_(
    { periode: '2026-09', cabang: 'Kendari', user: { SessionToken: 'jwt' } },
    { role: 'teknisi', username: 'alif', nama: 'Alif' }
  ).text);

  assert.equal(result.status, 'sukses');
  assert.deepEqual(result.users.map(user => user.Username), ['alif']);
  assert.deepEqual(result.tickets.map(ticket => ticket['ID Tiket']), ['A-1']);
  assert.deepEqual(payrollCalls, [['2026-09', 'Alif']]);

  const denied = JSON.parse(context.prosesGetPayrollData_(
    { periode: '2026-09', cabang: 'Kendari', user: { SessionToken: 'jwt' } },
    { role: 'sales', username: 'juna', nama: 'Juna' }
  ).text);
  assert.equal(denied.status, 'gagal');
});

test('outside-city dates are stored per month and return when an older month is selected', () => {
  const fields = {
    'pilih-bulan': { value: '2026-09' },
    'input-fee': { value: '' },
    'input-kasbon': { value: '' },
    'input-luar-kota': { value: '' },
    'input-libur-tambahan': { value: '' }
  };
  const context = vm.createContext({
    globalPayrollBulanan: {},
    periodePayrollTermuat: '',
    komponenPayrollKotor_: false,
    document: { getElementById: id => fields[id] },
    ambilDrafTanggalPayroll_: () => null,
    penggunaBolehKelolaPayroll_: () => true,
    periodePayrollSaatIni_: () => '2026-09',
    setTimeout,
    String,
    parseFloat
  });
  vm.runInContext([
    extractFunction(slipHtml, 'normalisasiNamaPayroll'),
    extractFunction(slipHtml, 'terapkanVariabelPayrollKeForm'),
    extractFunction(slipHtml, 'simpanVariabelPayrollTermuat_')
  ].join('\n'), context);

  context.simpanVariabelPayrollTermuat_([
    { namaPegawai: 'Alif', fee: 0, kasbon: 0, luarKota: '21, 22, 23', liburTambahan: '5, 12' }
  ], '2026-09');
  context.terapkanVariabelPayrollKeForm('Alif');
  assert.equal(fields['input-luar-kota'].value, '21, 22, 23');
  assert.equal(fields['input-libur-tambahan'].value, '5, 12');

  fields['pilih-bulan'].value = '2026-10';
  context.simpanVariabelPayrollTermuat_([], '2026-10');
  context.terapkanVariabelPayrollKeForm('Alif');
  assert.equal(fields['input-luar-kota'].value, '');
  assert.equal(fields['input-libur-tambahan'].value, '');

  fields['pilih-bulan'].value = '2026-09';
  context.simpanVariabelPayrollTermuat_([
    { namaPegawai: 'Alif', fee: 0, kasbon: 0, luarKota: '21, 22, 23', liburTambahan: '5, 12' }
  ], '2026-09');
  context.terapkanVariabelPayrollKeForm('Alif');
  assert.equal(fields['input-luar-kota'].value, '21, 22, 23');
  assert.equal(fields['input-libur-tambahan'].value, '5, 12');

  assert.match(slipHtml, /jadwalkanSimpanLuarKota_\(\)/);
  assert.match(slipHtml, /setTimeout\(\(\) => \{[\s\S]*simpanVariabelPayroll\(\{ otomatis: true \}\)[\s\S]*\}, 800\)/);
  assert.doesNotMatch(slipHtml, /LIBUR_NASIONAL_PAYROLL|isLiburNasional/);
  assert.match(slipHtml, /let isHariLibur = isAhad \|\| isLiburTambahan/);
  assert.match(backend, /'Tanggal Libur Tambahan'/);
  assert.match(backend, /liburTambahan: String\(data\[i\]\[colLiburTambahan\] \|\| ''\)/);
  assert.match(backend, /sheet\.getRange\(barisTarget, colLiburTambahan \+ 1\)\.setValue\(liburTambahanBersih\)/);
  assert.match(backend, /data\.diubahOleh, data\.liburTambahan\)/);
});

test('technician and past-month views use saved server dates, never an unsaved local draft', () => {
  const fields = {
    'pilih-bulan': { value: '2026-08' },
    'input-fee': { value: '' },
    'input-kasbon': { value: '' },
    'input-luar-kota': { value: '' },
    'input-libur-tambahan': { value: '' }
  };
  let draftReads = 0;
  const context = vm.createContext({
    globalPayrollBulanan: { alif: { luarKota: '21, 22', liburTambahan: '5' } },
    document: { getElementById: id => fields[id] },
    penggunaBolehKelolaPayroll_: () => true,
    periodePayrollSaatIni_: () => '2026-09',
    ambilDrafTanggalPayroll_: () => { draftReads++; return '31'; },
    String,
    parseFloat
  });
  vm.runInContext([
    extractFunction(slipHtml, 'normalisasiNamaPayroll'),
    extractFunction(slipHtml, 'terapkanVariabelPayrollKeForm')
  ].join('\n'), context);
  context.terapkanVariabelPayrollKeForm('Alif');
  assert.equal(fields['input-luar-kota'].value, '21, 22');
  assert.equal(fields['input-libur-tambahan'].value, '5');
  assert.equal(draftReads, 0);
  fields['pilih-bulan'].value = '2026-09';
  context.penggunaBolehKelolaPayroll_ = () => false;
  context.terapkanVariabelPayrollKeForm('Alif');
  assert.equal(fields['input-luar-kota'].value, '21, 22');
  assert.equal(fields['input-libur-tambahan'].value, '5');
  assert.equal(draftReads, 0);
});
