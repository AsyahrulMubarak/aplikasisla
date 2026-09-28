const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const lobby = read('index.html');
const attendance = read('absen.html');
const slip = read('slipgaji.html');
const user = (name, branch, salary) => ({
  Username: name.toLowerCase(), 'Nama Asli': name, Role: 'teknisi',
  Hak_Akses_Cabang: branch, 'Gaji Pokok': salary
});

function extract(source, name) {
  const match = source.match(new RegExp('^([ \\t]*)function ' + name + '\\([^]*?^\\1\\}', 'm'));
  assert.ok(match, `Missing function ${name}`);
  return match[0];
}

test('lobby opens attendance and private slip for every salaried employee', () => {
  const context = vm.createContext({
    rolePengguna: value => String(value?.Role || '').toLowerCase(),
    hakAksesCabangPengguna: value => value?.Hak_Akses_Cabang,
    roleAdalahManajemenUtama_: role => ['admin', 'manager', 'direktur'].includes(role)
  });
  vm.runInContext([
    extract(lobby, 'penggunaKendariDiizinkanAbsensi_'),
    extract(lobby, 'penggunaBergajiDiizinkanModul_'),
    extract(lobby, 'penggunaBolehMengaksesAbsensi_'),
    extract(lobby, 'penggunaBolehMengaksesSlipGaji_')
  ].join('\n'), context);
  for (const profile of [
    user('Teknisi Contoh', 'Kendari', 1200000),
    user('Pegawai Contoh', 'Raha', 1200000)
  ]) {
    assert.equal(context.penggunaBolehMengaksesAbsensi_(profile), true);
    assert.equal(context.penggunaBolehMengaksesSlipGaji_(profile), true);
  }
  const unpaid = user('Pegawai Contoh', 'Raha', 0);
  assert.equal(context.penggunaBolehMengaksesAbsensi_(unpaid), false);
  assert.equal(context.penggunaBolehMengaksesSlipGaji_(unpaid), false);
});

test('attendance and slip pages enforce the same salary check without approval rights', () => {
  const absenContext = vm.createContext({ penggunaAktif: null });
  const allowlist = attendance.match(/const PEGAWAI_KENDARI_AKSES_ABSENSI\s*=\s*\[[\s\S]*?\];/);
  assert.ok(allowlist);
  vm.runInContext([
    allowlist[0],
    extract(attendance, 'normalisasiNamaAbsensi'),
    extract(attendance, 'normalisasiCabangSesi'),
    extract(attendance, 'pegawaiBergajiBolehAbsenLokal_'),
    extract(attendance, 'penggunaBolehAbsenLokal')
  ].join('\n'), absenContext);
  const slipContext = vm.createContext({ penggunaAktif: null });
  vm.runInContext([
    extract(slip, 'normalisasiCabangSesi'),
    extract(slip, 'penggunaAdalahPegawaiKendariPayroll_'),
    extract(slip, 'penggunaBolehMembukaSlipGaji_'),
    extract(slip, 'penggunaBolehKelolaPayroll_')
  ].join('\n'), slipContext);
  const profile = user('Teknisi Contoh', 'Kendari', 1200000);
  absenContext.penggunaAktif = profile;
  slipContext.penggunaAktif = profile;
  assert.equal(absenContext.penggunaBolehAbsenLokal(), true);
  assert.equal(slipContext.penggunaBolehMembukaSlipGaji_(), true);
  assert.equal(slipContext.penggunaBolehKelolaPayroll_(), false);
  assert.match(attendance, /function bukaModalApproval\(\)[\s\S]*?if \(!roleManajemenAktif\(\)\)/);
});
