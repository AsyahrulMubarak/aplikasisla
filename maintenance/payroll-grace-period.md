# Masa tenggang komponen payroll

Fee Marketing, Kasbon, tanggal Luar Kota, dan Libur Tambahan dapat diubah sampai tanggal 5 bulan berikutnya pukul 23.59 WITA. Mulai tanggal 6 pukul 00.00 WITA periode tersebut terkunci. Periode yang lebih lama tetap terkunci; hak pengelolaan khusus Manajemen tetap berlaku.

Formulir, penyimpanan Edge API, pemulihan draf lokal, dan sinkronisasi pengecualian kuota koreksi Luar Kota memakai batas kalender yang sama. Pergantian tahun dan zona waktu perangkat tidak mengubah batas tersebut. Penyimpanan tetap menggunakan pasangan pegawai dan periode yang dipilih.

Pengujian `tests/payroll-grace-period.test.cjs` memeriksa hari pertama, akhir tanggal 5, awal tanggal 6, pergantian tahun, Februari tahun kabisat, hak akses, draf, dan penolakan penulisan periode lama. Seluruh penyimpanan pengujian memakai layanan tiruan.
