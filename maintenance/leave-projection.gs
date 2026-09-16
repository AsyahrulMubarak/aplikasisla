// Pengajuan disimpan sebagai rentang; absensi otomatis lama hanya diproyeksikan
// saat dibaca. Riwayat asli dan seluruh absensi nyata tidak dihapus.
function adalahMasukNyataPengajuan_(row) {
  return ['Masuk', 'Masuk Setelah Istirahat'].indexOf(String(row.tipe_absen || '')) !== -1 &&
    !/Lupa Absen Masuk|Koreksi|Auto/i.test(String(row.status_disiplin || ''));
}

function proyeksikanAbsensiPengajuan_(rows, pengajuan, mulai, selesai, sekarang) {
  var hariIni = formatKunciTanggal_(sekarang || new Date());
  var daftar = (pengajuan || []).filter(function(p) { return p.status === 'Disetujui' && ['Sakit', 'Izin'].indexOf(p.jenis) !== -1; });
  var idTerproyeksi = {};
  daftar.forEach(function(p) { idTerproyeksi[String(p.id_pengajuan)] = true; });
  var hasil = (rows || []).filter(function(row) {
    if (['Sakit', 'Izin'].indexOf(String(row.tipe_absen || '')) === -1 || row.status_disiplin !== 'Pengajuan Disetujui') return true;
    var cocok = String(row.id_absen || '').match(/^ABS-(PGJ-[A-Za-z0-9_-]+)-\d{8}$/);
    return !(cocok && idTerproyeksi[cocok[1]]);
  });
  daftar.forEach(function(p) {
    var batasAwal = String(p.tanggal_mulai || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(batasAwal)) return;
    var batasAkhir = p.tanggal_selesai ? String(p.tanggal_selesai).slice(0, 10) : hariIni;
    if (p.jenis === 'Sakit' && batasAkhir > hariIni) batasAkhir = hariIni;
    var kembali = p.kembali_bekerja_pada ? new Date(p.kembali_bekerja_pada) : null;
    if (kembali && isNaN(kembali.getTime())) kembali = null;
    // Cadangan untuk pembacaan yang bertepatan dengan transaksi absen masuk.
    (rows || []).forEach(function(row) {
      if (row.nama_pegawai !== p.nama_pegawai || !adalahMasukNyataPengajuan_(row)) return;
      var waktu = new Date(row.waktu_absen), hari = formatKunciTanggal_(waktu);
      if (hari < batasAwal || (p.tanggal_selesai && hari > String(p.tanggal_selesai).slice(0, 10))) return;
      if (!isNaN(waktu.getTime()) && (!kembali || waktu < kembali)) kembali = waktu;
    });
    var hariKembali = kembali ? formatKunciTanggal_(kembali) : '';
    if (hariKembali && hariKembali < batasAkhir) batasAkhir = hariKembali;
    if (batasAkhir > selesai) batasAkhir = selesai;
    var awal = batasAwal > mulai ? batasAwal : mulai;
    if (awal > batasAkhir) return;
    var cursor = buatTanggalMakassar_(awal, 8 * 60);
    while (formatKunciTanggal_(cursor) <= batasAkhir) {
      var hari = formatKunciTanggal_(cursor);
      // Masuk sebelum/pada awal jam kerja berarti tidak ada waktu izin hari itu.
      if (!kembali || hari !== hariKembali || kembali.getTime() > cursor.getTime()) {
        var note = '[ID Pengajuan: ' + p.id_pengajuan + '] Disetujui oleh ' + (p.disetujui_oleh || '-') + '. Alasan: ' + (p.alasan || '-');
        if (kembali) note += '\nBerakhir otomatis karena kembali masuk pada ' + Utilities.formatDate(kembali, 'Asia/Makassar', 'dd/MM/yyyy HH:mm:ss') + '.';
        hasil.push({
          id_absen: 'ABS-' + p.id_pengajuan + '-' + hari.replace(/-/g, ''),
          waktu_absen: cursor.toISOString(), nama_pegawai: p.nama_pegawai, role: p.role,
          tipe_absen: p.jenis, status_disiplin: 'Pengajuan Disetujui', keterangan: note,
          lokasi_maps: '-', bukti_foto: p.bukti_foto || '-',
          kembali_bekerja_pada: kembali ? kembali.toISOString() : ''
        });
      }
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
  });
  return hasil.sort(function(a, b) { return new Date(a.waktu_absen) - new Date(b.waktu_absen); });
}

function bacaAbsensiEfektifPengajuan_(rows, mulai, selesai, namaPegawai) {
  var query = 'pengajuan_cuti?status=eq.Disetujui&tanggal_mulai=lte.' + encodeURIComponent(selesai) +
    '&or=(tanggal_selesai.is.null,tanggal_selesai.gte.' + encodeURIComponent(mulai) + ')' + '&order=tanggal_mulai.asc';
  if (namaPegawai) query += '&nama_pegawai=eq.' + encodeURIComponent(namaPegawai);
  var pengajuan = callSupabase_(SUPABASE_URL + query);
  return proyeksikanAbsensiPengajuan_(rows, pengajuan, mulai, selesai, new Date());
}
