# Akses KPI User Raha untuk Alif

Alif (`username_login=alif`, role SLA `teknisi`) diberi pengecualian akses KPI ke peran `admin_raha`, lokasi `raha`. Admin Raha tetap memakai pemetaan yang sama. Kedua login SLA memilih akun KPI User Raha yang sudah ada, sehingga menu, laporan, tugas, profil dan riwayat User Raha tetap satu akun. Tidak dibuat user KPI kedua.

Pengecualian berlaku hanya pada login Alif dengan role teknisi, bukan semua teknisi atau nama tampilan Alif. Server memverifikasi token ke Supabase Auth lalu membaca login dan role dari profil SLA tersimpan pada setiap permintaan. Role/lokasi KPI tidak diambil dari parameter browser atau user_metadata. Akun KPI yang tidak aktif atau ambigu tetap ditolak.

Role, cabang, akses cabang, tiket, poin, absensi dan data profil SLA Alif tidak dimigrasikan. Alif tetap dapat membuka SLA sesuai hak akses sebelumnya. Pengecualian ini hanya mengaktifkan tombol KPI dan akses ke User Raha. Jalur pemberitahuan WA tugas tidak diubah dan tidak ada pesan uji yang dikirim.

Kode Edge memakai baseline produksi KPI versi 18 yang identik dengan sumber repositori KPI pada commit `b33e3a8e8b44187f5af5a745345dc0a2bde6b108`. Perubahan backend hanya menambah dua kondisi pemetaan Alif; fitur produksi terbaru tidak diganti oleh snapshot lokal yang lebih lama. Edge `kpi-api` telah diterapkan sebagai versi 19. Konfigurasi verifikasi token tetap mengikuti baseline, dengan autentikasi khusus di dalam handler.

36 tes terkait autentikasi, kesamaan akun/izin laporan, penolakan identitas lain, handoff, lobby dan mesin KPI lulus. Tiga pemeriksaan browser memakai data contoh memeriksa tombol Alif dan Admin Raha, transfer sesi ke handler KPI, pemilihan User Raha yang sama, serta tombol teknisi lain yang tetap terkunci. Pengujian memakai profil/tiket contoh dan tidak menulis data produksi.

Sumber backend telah disinkronkan ke repositori `alfacomapp/alfacom-kpi` pada commit `efe3a479c642229e761f6b33526b1b7677e8fef3`. Berkas yang dipublikasikan cocok persis dengan Edge Function versi 19. Tes mandiri `tests/alif-raha-access.test.cjs` dipublikasikan pada commit `4dc8f73a0511fd454ff4621f574b5f9e11441bd2`; enam tes akses lulus. Dokumentasi KPI tersedia di `docs/alif-kpi-raha-access.md`.
