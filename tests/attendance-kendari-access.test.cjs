const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const backendCandidates = [path.join(root, 'codeabsensi.txt'), path.resolve(root, '../codeabsensi.txt')];
const backendPath = backendCandidates.find(candidate => fs.existsSync(candidate));
assert.ok(backendPath, 'Attendance backend source codeabsensi.txt is required');
const backend = fs.readFileSync(backendPath, 'utf8');
const lobby = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const attendance = fs.readFileSync(path.join(root, 'absen.html'), 'utf8');

function extractFunction(source, name) {
  const match = source.match(new RegExp('^([ \\t]*)function ' + name + '\\([^]*?^\\1\\}', 'm'));
  assert.ok(match, `Missing function: ${name}`);
  return match[0];
}

function extractAllowlist(source) {
  const match = source.match(/const PEGAWAI_KENDARI_AKSES_ABSENSI\s*=\s*\[[\s\S]*?\];/);
  assert.ok(match, 'Missing Kendari attendance allowlist');
  return match[0];
}

const allowedNames = [
  'Alif', 'Ardan', 'Ardi S', 'Asyahrul Mubarak', 'Dafa', 'Fauzan', 'Juna',
  'Muaz', 'Mubarak', 'Muhammad Bintang Restu Prabowo', 'Muhammad Syawal',
  'Rendi', 'Wawan'
];

test('backend grants attendance only to the named Kendari staff and preserves management approval', () => {
  const context = vm.createContext({ String, Array });
  vm.runInContext([
    extractAllowlist(backend),
    extractFunction(backend, 'normalisasiCabangAbsensi_'),
    extractFunction(backend, 'normalisasiNamaAbsensi_'),
    extractFunction(backend, 'adalahPegawaiKendariAksesAbsensi_'),
    extractFunction(backend, 'bolehAbsen_'),
    extractFunction(backend, 'bolehKelolaAbsensi_')
  ].join('\n'), context);

  for (const name of allowedNames) {
    const user = { namaAsli: name, role: name === 'Ardan' || name === 'Juna' ? 'sales' : 'teknisi', hakAksesCabang: 'Kendari' };
    assert.equal(context.bolehAbsen_(user), true, `${name} should be able to attend`);
    assert.equal(context.bolehKelolaAbsensi_(user), false, `${name} must not manage approvals`);
  }
  assert.equal(context.bolehAbsen_({ namaAsli: 'Alif', role: 'teknisi', hakAksesCabang: 'Raha' }), false);
  assert.equal(context.bolehAbsen_({ namaAsli: 'Pegawai Lain', role: 'teknisi', hakAksesCabang: 'Kendari' }), false);
  assert.equal(context.bolehAbsen_({ namaAsli: 'Abu Naura', role: 'admin_raha', hakAksesCabang: 'Raha' }), false);
  assert.equal(context.bolehKelolaAbsensi_({ namaAsli: 'Abu Abdillah', role: 'manager', hakAksesCabang: 'Kendari' }), true);
  assert.match(backend, /getDaftarPengajuan'[\s\S]*?if \(!punyaHakKelola\).*?Approval absensi khusus Manajemen/);
  assert.match(backend, /data\.action === 'responPengajuan'[\s\S]*?if \(!punyaHakKelola\)/);
});

test('lobby and attendance page use the same access boundary, with approval hidden and guarded', () => {
  const lobbyContext = vm.createContext({
    rolePengguna: user => String(user && user.Role || '').trim().toLowerCase(),
    hakAksesCabangPengguna: user => {
      const value = String(user && user.Hak_Akses_Cabang || '').trim().toLowerCase();
      return value === 'kendari' ? 'Kendari' : value === 'raha' ? 'Raha' : value === 'semua' ? 'Semua' : '';
    }
  });
  vm.runInContext([
    extractFunction(lobby, 'penggunaAdalahTeknisiUjiAbsensi_'),
    extractFunction(lobby, 'penggunaKendariDiizinkanAbsensi_'),
    extractFunction(lobby, 'penggunaBolehMengaksesAbsensi_')
  ].join('\n'), lobbyContext);
  for (const name of allowedNames) {
    assert.equal(lobbyContext.penggunaBolehMengaksesAbsensi_({ 'Nama Asli': name, Role: 'teknisi', Hak_Akses_Cabang: 'Kendari' }), true);
  }
  assert.equal(lobbyContext.penggunaBolehMengaksesAbsensi_({ 'Nama Asli': 'Alif', Role: 'teknisi', Hak_Akses_Cabang: 'Raha' }), false);
  assert.equal(lobbyContext.penggunaBolehMengaksesAbsensi_({ 'Nama Asli': 'Abu Naura', Role: 'admin_raha', Hak_Akses_Cabang: 'Raha' }), false);

  const pageContext = vm.createContext({ penggunaAktif: null, String, Array });
  vm.runInContext([
    extractAllowlist(attendance),
    extractFunction(attendance, 'normalisasiNamaAbsensi'),
    extractFunction(attendance, 'normalisasiCabangSesi'),
    extractFunction(attendance, 'penggunaBolehAbsenLokal')
  ].join('\n'), pageContext);
  pageContext.penggunaAktif = { 'Nama Asli': 'Alif', Role: 'teknisi', Hak_Akses_Cabang: 'Kendari' };
  assert.equal(pageContext.penggunaBolehAbsenLokal(), true);
  pageContext.penggunaAktif = { 'Nama Asli': 'Alif', Role: 'teknisi', Hak_Akses_Cabang: 'Raha' };
  assert.equal(pageContext.penggunaBolehAbsenLokal(), false);

  assert.match(attendance, /btn-approval-manajemen[\s\S]*?style="display:none/);
  assert.match(attendance, /btn-approval-manajemen'\)\.style\.display = isManajemen \? 'block' : 'none'/);
  assert.match(attendance, /function bukaModalApproval\(\)[\s\S]*?if \(!roleManajemenAktif\(\)\)/);
  assert.match(attendance, /function prosesApproval\([^]*?if \(!roleManajemenAktif\(\)\)/);
});
