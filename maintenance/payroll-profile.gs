// Pemilihan profil yang sama untuk slip, rekap, dan penyimpanan tunjangan.
function normalisasiNamaProfilPayroll_(nilai) {
  return String(nilai || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function pilihProfilPayroll_(profiles, nama) {
  var namaNormal = normalisasiNamaProfilPayroll_(nama);
  if (!namaNormal) return null;
  var kandidat = (profiles || []).filter(function(profil) {
    return normalisasiNamaProfilPayroll_(profil['Nama Asli']) === namaNormal;
  });
  if (namaNormal === 'abu abdillah') {
    kandidat = kandidat.filter(function(profil) { return normalisasiNamaProfilPayroll_(profil.Role) === 'manager'; });
  } else if (namaNormal === 'abu naura' || namaNormal === 'abu naurah') {
    kandidat = kandidat.filter(function(profil) {
      var role = normalisasiNamaProfilPayroll_(profil.Role);
      return role === 'admin_raha' || (role === 'admin' && normalisasiNamaProfilPayroll_(profil.Hak_Akses_Cabang) === 'raha');
    });
  }
  var bergaji = kandidat.filter(function(profil) {
    return (parseFloat(profil['Gaji Pokok'] || profil['Gaji Pokok (Rp)']) || 0) > 0;
  });
  if (bergaji.length) kandidat = bergaji;
  // Jangan menebak profil ketika lebih dari satu akun masih memenuhi syarat.
  return kandidat.length === 1 ? kandidat[0] : null;
}
