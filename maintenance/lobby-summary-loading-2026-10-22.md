# Pemulihan ringkasan lobby

Ringkasan sebelumnya mengunduh seluruh kolom tiket/prospek dan membatalkan tampilan bila salah satu sumber melewati batas 20 detik. Pengukuran database 22 Oktober 2026: tiket 7.898.651 byte dan prospek 6.964.836 byte dalam representasi JSONB baris; ukuran transfer HTTP dapat berbeda. Beberapa respons sumber juga mendekati batas waktu, sehingga gangguan jaringan menambah risiko timeout.

Ringkasan kini memilih kolom perhitungan: tiket 441.377 byte, garansi 121.554 byte, penjualan 6.351 byte dan prospek 30.850 byte pada data yang sama. Foto, tanda tangan, PDF dan bukti chat tidak diunduh untuk ringkasan. Admin hanya memuat tiket/garansi; sales dan manajemen tetap memuat sumber omzet/prospek yang diperlukan. Riwayat lintas bulan tetap dibaca untuk nota belum lunas, referensi transaksi dan klaim.

GET yang gagal sementara dicoba ulang satu kali, tanpa mengulang penulisan atau notifikasi. Sisa permintaan dibatalkan ketika ringkasan gagal. Hasil terakhir hanya dipertahankan dalam memori pada akun, role, akses, cabang dan periode yang sama, dengan penanda pembaruan gagal. Penolakan akses, akun/peran/periode berbeda dan respons lama tidak boleh memakai atau menimpa hasil tersebut.

Validasi mencakup kesetaraan kalkulasi sumber lengkap vs kolom ringkas, pagination, klaim garansi, omzet, poin teknisi, nota lama, retry GET, pembatalan, isolasi akun dan cache. Tidak ada perubahan skema, izin database, aturan poin atau pengiriman WA.

Paket rilis diperiksa dengan 880 pengujian: 879 lulus, nol gagal, satu perbandingan arsip GAS dilewati. Simulasi browser memakai pemuat lobby yang sama dan data contoh; setelah timeout, hasil sebelumnya tetap tampil dengan penanda pembaruan gagal.
