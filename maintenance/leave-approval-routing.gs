// Satu kebijakan untuk penerima WA, antrean, dan keputusan pengajuan sakit/izin.
function adalahAdminKendariPengajuan_(user) {
  var role = String(user && user.role || '').trim().toLowerCase();
  var cabang = String(user && (user.hakAksesCabang || user.hak_akses_cabang) || '').trim().toLowerCase();
  // Akun admin pusat lama memakai akses Semua (atau kosong); admin Raha terpisah.
  return role === 'admin' && ['', 'semua', 'kendari'].indexOf(cabang) !== -1;
}

function bolehMemutuskanPengajuan_(user, pengajuan) {
  if (!user || !pengajuan) return false;
  var role = String(user.role || '').trim().toLowerCase();
  var rolePengaju = String(pengajuan.role || '').trim().toLowerCase();
  if (role === 'direktur') return true;
  if (rolePengaju === 'manager') return adalahAdminKendariPengajuan_(user);
  if (adalahAdminKendariPengajuan_(pengajuan)) return role === 'manager';
  return role === 'manager' || adalahAdminKendariPengajuan_(user);
}
