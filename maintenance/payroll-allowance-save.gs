function simpanTunjanganProfilPayroll_(sheetUsers, data) {
  if (!sheetUsers) throw new Error('Data pegawai tidak tersedia.');
  var rows = sheetUsers.getDataRange().getValues();
  var headers = rows[0] || [];
  var colBonus = headers.indexOf('Bonus Tambahan');
  if (colBonus === -1) colBonus = headers.indexOf('Bonus');
  if (colBonus === -1) throw new Error('Kolom tunjangan pegawai tidak tersedia.');
  var profiles = rows.slice(1).map(function(row, index) {
    var profil = { barisPayroll: index + 2 };
    headers.forEach(function(header, col) { profil[header] = row[col]; });
    return profil;
  });
  var profil = pilihProfilPayroll_(profiles, data.namaAsli);
  if (!profil) throw new Error('Profil payroll tidak ditemukan atau ambigu. Muat ulang data pegawai.');
  var usernameTarget = normalisasiNamaProfilPayroll_(data.usernameTarget);
  if (usernameTarget && normalisasiNamaProfilPayroll_(profil.Username) !== usernameTarget) {
    throw new Error('Akun payroll tidak sesuai dengan pegawai yang dipilih. Muat ulang data pegawai.');
  }
  sheetUsers.getRange(profil.barisPayroll, colBonus + 1).setValue(data.tunjanganData);
}
