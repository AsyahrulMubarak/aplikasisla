# Masa tenggang komponen payroll

Fee Marketing, Kasbon, tanggal Luar Kota, Libur Tambahan, serta bukti PDF fee/kasbon dapat diubah sampai tanggal 7 bulan berikutnya pukul 23.59 WITA. Mulai tanggal 8 pukul 00.00 WITA periode tersebut terkunci. Periode yang lebih lama tetap terkunci; hak pengelolaan khusus Manajemen tetap berlaku.

Formulir, penyimpanan Edge API, pemulihan draf lokal, dan sinkronisasi pengecualian kuota koreksi Luar Kota memakai batas kalender yang sama. Pergantian tahun dan zona waktu perangkat tidak mengubah batas tersebut. Penyimpanan tetap menggunakan pasangan pegawai dan periode yang dipilih.

Untuk instalasi yang sudah berjalan, terapkan `maintenance/payroll-grace-seven-days.sql`, kemudian publikasikan Edge Function dan frontend. Migrasi memperbarui batas bukti PDF dan menunda evaluasi gaji otomatis sampai tanggal 8 agar Libur Tambahan dapat diselesaikan sebelum dinilai. Migrasi tidak menjalankan evaluasi atau mengubah nominal gaji, riwayat, dan izin akses.

Pengujian `tests/payroll-grace-period.test.cjs` memeriksa hari pertama, tanggal 6 dan 7, akhir tanggal 7, awal tanggal 8, pergantian tahun, Februari tahun kabisat, hak akses, draf, dan penolakan penulisan periode lama. Pengujian bukti PDF dan evaluasi gaji juga memeriksa batas tersebut di Edge dan PostgreSQL. Seluruh penyimpanan pengujian memakai layanan tiruan atau database lokal.
