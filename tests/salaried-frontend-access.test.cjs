const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function extract(source, name) {
  const match = source.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\([^]*?^\\1\\}', 'm'));
  assert.ok(match, name);
  return match[0];
}
const cases = [];
for (const role of ['admin','admin_raha','manager','direktur','sales','teknisi','freelance']) {
  for (const salary of [undefined,null,'',0,'0',-1,'invalid',Infinity,1500000,'1500000']) {
    for (const branch of ['Kendari','Raha','Semua']) {
      cases.push({ role, salary, branch, allowed: role === 'direktur' ||
        (Number.isFinite(Number(salary)) && Number(salary) > 0 &&
          (['admin','manager'].includes(role) || branch !== 'Semua')) });
    }
  }
}
test('Lobby and direct attendance/payroll pages require positive salary except directors', () => {
  const lobby = vm.createContext({ penggunaAktif:null });
  vm.runInContext(['rolePengguna','hakAksesCabangPengguna','penggunaBergajiDiizinkanModul_',
    'penggunaBolehMengaksesAbsensi_','penggunaBolehMengaksesSlipGaji_'].map(name => extract(read('index.html'),name)).join('\n'), lobby);
  lobby.normalisasiCabang = value => ['Kendari','Raha','Semua'].includes(value) ? value : '';
  const attendance = vm.createContext({ penggunaAktif:null });
  vm.runInContext(['normalisasiCabangSesi','pegawaiBergajiBolehAbsenLokal_','penggunaBolehAbsenLokal']
    .map(name => extract(read('absen.html'),name)).join('\n'),attendance);
  const payroll = vm.createContext({ penggunaAktif:null });
  vm.runInContext(['normalisasiCabangSesi','penggunaAdalahPegawaiKendariPayroll_','penggunaBolehMembukaSlipGaji_',
    'penggunaBolehKelolaPayroll_'].map(name => extract(read('slipgaji.html'),name)).join('\n'),payroll);
  for (const entry of cases) {
    const user = { Username:'alif','Nama Asli':'Alif',Role:entry.role,Hak_Akses_Cabang:entry.branch,'Gaji Pokok':entry.salary };
    attendance.penggunaAktif = payroll.penggunaAktif = user;
    const label = `${entry.role}/${entry.branch}/${entry.salary}`;
    assert.equal(lobby.penggunaBolehMengaksesAbsensi_(user),entry.allowed,'Lobby attendance '+label);
    assert.equal(lobby.penggunaBolehMengaksesSlipGaji_(user),entry.allowed,'Lobby payroll '+label);
    assert.equal(attendance.penggunaBolehAbsenLokal(),entry.allowed,'Direct attendance '+label);
    assert.equal(payroll.penggunaBolehMembukaSlipGaji_(),entry.allowed,'Direct payroll '+label);
    if (!entry.allowed) assert.equal(payroll.penggunaBolehKelolaPayroll_(),false,label);
  }
});
