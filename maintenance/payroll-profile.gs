// Pemilihan profil yang sama untuk slip, rekap, dan penyimpanan tunjangan.
function normalisasiNamaProfilPayroll_(nilai) {
  return String(nilai || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function pilihProfilPayroll_(profiles, nama, periode) {
  var namaNormal = normalisasiNamaProfilPayroll_(nama);
  if (!namaNormal) return null;
  var kandidat = (profiles || []).filter(function(profil) {
    return normalisasiNamaProfilPayroll_(profil['Nama Asli']) === namaNormal;
  });
  if (namaNormal === 'abu abdillah') {
    kandidat = kandidat.filter(function(profil) { return normalisasiNamaProfilPayroll_(profil.Role) === 'manager'; });
  } else if (namaNormal === 'abu naura' || namaNormal === 'abu naurah') {
    var periodePilihan = String(periode || (typeof periodePayrollSaatIni_ === 'function' ? periodePayrollSaatIni_() : ''));
    if (!/^\d{4}-\d{2}$/.test(periodePilihan)) periodePilihan = new Date(new Date().getTime() + 8 * 3600000).toISOString().slice(0, 7);
    var memakaiProfilTeknisi = periodePilihan >= '2026-10';
    kandidat = kandidat.filter(function(profil) {
      var role = normalisasiNamaProfilPayroll_(profil.Role);
      var cabang = normalisasiNamaProfilPayroll_(profil.Hak_Akses_Cabang || profil.Cabang);
      return memakaiProfilTeknisi ? role === 'teknisi' && cabang === 'raha'
        : role === 'admin_raha' || (role === 'admin' && cabang === 'raha');
    });
  } else if (namaNormal === 'ardan') {
    kandidat = kandidat.filter(function(profil) { return normalisasiNamaProfilPayroll_(profil.Role) === 'sales'; });
  }
  var bergaji = kandidat.filter(function(profil) {
    return (parseFloat(profil['Gaji Pokok'] || profil['Gaji Pokok (Rp)']) || 0) > 0;
  });
  if (bergaji.length) kandidat = bergaji;
  // Jangan menebak profil ketika lebih dari satu akun masih memenuhi syarat.
  return kandidat.length === 1 ? kandidat[0] : null;
}

