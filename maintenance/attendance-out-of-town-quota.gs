// Salinan fungsi murni yang diterapkan pada backend Absensi produksi.
// Handler produksi memanggil simpanPengecualianKoreksiLuarKota_ melalui action
// syncPengecualianKoreksiLuarKota setelah autentikasi dan pemeriksaan hak Manajemen.

function byteArrayToHex_(bytes) {
  return bytes.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function normalisasiTanggalLuarKotaAbsensi_(nilai) {
  var unik = {};
  String(nilai || '').split(',').forEach(function(item) {
    var teksTanggal = String(item || '').trim();
    if (!/^\d{1,2}$/.test(teksTanggal)) return;
    var tanggal = parseInt(teksTanggal, 10);
    if (!isNaN(tanggal) && tanggal >= 1 && tanggal <= 31) unik[tanggal] = true;
  });
  return Object.keys(unik).map(Number).sort(function(a, b) { return a - b; });
}

function kunciPengecualianKoreksiLuarKota_(periode, namaPegawai) {
  var namaNormal = String(namaPegawai || '').trim().toLowerCase().replace(/\s+/g, ' ');
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    namaNormal,
    Utilities.Charset.UTF_8
  );
  return 'KOREKSI_LUAR_KOTA_' + String(periode || '').replace(/[^0-9]/g, '') + '_' + byteArrayToHex_(digest).slice(0, 24);
}

function simpanPengecualianKoreksiLuarKota_(periode, daftarPayroll, diubahOleh) {
  var periodeBersih = String(periode || '').trim();
  var periodeSekarang = Utilities.formatDate(new Date(), 'Asia/Makassar', 'yyyy-MM');
  if (!/^\d{4}-\d{2}$/.test(periodeBersih) || periodeBersih !== periodeSekarang) {
    throw new Error('Pengecualian kuota koreksi hanya dapat disinkronkan untuk bulan berjalan.');
  }
  if (!Array.isArray(daftarPayroll) || daftarPayroll.length > 200) {
    throw new Error('Daftar payroll untuk pengecualian koreksi tidak valid.');
  }

  var properties = PropertiesService.getScriptProperties();
  var tersimpan = 0;
  daftarPayroll.forEach(function(item) {
    var nama = String(item && item.namaPegawai || '').trim();
    if (!nama) return;
    var tanggal = normalisasiTanggalLuarKotaAbsensi_(item.luarKota);
    properties.setProperty(kunciPengecualianKoreksiLuarKota_(periodeBersih, nama), JSON.stringify({
      periode: periodeBersih,
      namaPegawai: nama,
      tanggal: tanggal,
      diperbaruiPada: new Date().toISOString(),
      diperbaruiOleh: String(diubahOleh || '').trim()
    }));
    tersimpan++;
  });
  return tersimpan;
}

function ambilPengecualianKoreksiLuarKota_(periode, namaPegawai) {
  if (!/^\d{4}-\d{2}$/.test(String(periode || '')) || !String(namaPegawai || '').trim()) return [];
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(
      kunciPengecualianKoreksiLuarKota_(periode, namaPegawai)
    );
    if (!raw) return [];
    var data = JSON.parse(raw);
    if (String(data.periode || '') !== String(periode)) return [];
    return normalisasiTanggalLuarKotaAbsensi_((data.tanggal || []).join(','));
  } catch (error) {
    return [];
  }
}

function koreksiMengurangiKuota_(row, periode, tanggalLuarKota) {
  if (String(row && row.status_disiplin || '') !== 'Koreksi Manual') return false;
  var waktu = new Date(row && row.waktu_absen);
  if (isNaN(waktu.getTime())) return true;
  var tanggal = Utilities.formatDate(waktu, 'Asia/Makassar', 'yyyy-MM-dd');
  if (tanggal.slice(0, 7) !== String(periode || '')) return true;
  return (tanggalLuarKota || []).indexOf(parseInt(tanggal.slice(8, 10), 10)) === -1;
}
