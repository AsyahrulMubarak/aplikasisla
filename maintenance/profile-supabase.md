# Profil SLA Raha dan Kendari di Supabase

Halaman Profil menggunakan Edge Function `sla-profile` untuk pembuatan akun Auth beserta profil, perubahan kontak/profil, reset password oleh admin, penyelesaian permintaan reset, sinkronisasi Auth ID, penghapusan profil, dan pemulihan sesi. Login password/passkey tetap menggunakan Supabase Auth; pengelolaan gaji tetap memakai `sla-payroll-attendance`.

## Akses

- Identitas berasal dari token yang diverifikasi lewat Supabase Auth dan `public.users.auth_id`. Role, cabang, username target, dan Auth ID dari browser tidak digunakan sebagai otorisasi.
- Admin Kendari dapat mengelola profil sesuai cabangnya; Admin Pusat dengan akses Semua dapat mengelola kedua cabang. Admin Raha dapat mengubah kontak sendiri dan mereset password akun Raha, tanpa membuat/menghapus profil atau mengubah pegawai cabang lain.
- Pegawai hanya dapat mengubah email, nomor WA, dan password sendiri. Role, nama resmi, cabang, target, gaji, dan Auth ID diabaikan pada pembaruan pribadi.
- Pembaruan profil tidak menulis ulang gaji pokok. Perubahan gaji menggunakan menu Gaji Pokok — Manajemen.
- Pembuatan akun mengambil Auth ID dari respons server. Jika penyimpanan profil gagal, layanan memastikan apakah insert sudah berhasil sebelum menghapus akun Auth baru yang belum memiliki profil.
- Penghapusan profil mempertahankan identitas Auth dan riwayat lama. API menolak akses setelah profil tidak lagi ada. Akun yang dihapus tidak dapat masuk aplikasi karena profil login tidak ditemukan.
- Izin tulis langsung `users` dari browser tetap tertutup.

## Reset password

`lupaSandi` tersedia tanpa login dan selalu memberikan jawaban netral. Database membatasi lima permintaan per sumber setiap sepuluh menit dan satu permintaan per username setiap sepuluh menit. Username lama yang mengandung spasi menggunakan `username_login`.

Permintaan tersimpan di `sla_password_reset_requests`; notifikasi admin menggunakan antrean `sla_password_reset_notifications` dengan lease agar beberapa worker tidak mengambil pesan bersamaan. Cron `sla-notif-reset-sandi` mengirim ulang setiap lima menit, memakai credential scheduler SLA yang sudah tersimpan di Vault. Pesan WhatsApp dikirim melalui Fonnte dari Edge Function.

Menu Permintaan Reset Password tersedia untuk Admin Kendari/Admin Raha. Daftar akun dan permintaan difilter kembali di server. Password baru ditulis hanya ke Auth dan tidak disimpan dalam tabel permintaan, audit, maupun log. Setelah Auth berhasil diperbarui, permintaan yang masih menunggu ditandai selesai.

Tabel permintaan, pembatasan percobaan, antrean notifikasi, dan audit hanya dapat diakses `service_role`, dengan RLS aktif. Endpoint pengiriman terjadwal memerlukan credential server. Fungsi ini memakai `verify_jwt=false` karena ada tindakan publik lupa password; semua tindakan privat tetap memverifikasi Auth di dalam fungsi.

## Batas migrasi

Alur Profil aktif tidak menggunakan Apps Script. Integrasi operasional lain yang masih memakai Apps Script berada di luar migrasi ini. Kode GAS dan audit reset historis di sistem lama dipertahankan sebagai arsip; permintaan baru dicatat di Supabase. Permintaan lama tetap dapat ditindaklanjuti dengan memilih akunnya pada menu reset baru.

## Verifikasi

`tests/profile-supabase.test.cjs` menguji akses identitas/cabang, perlindungan profil pribadi dan gaji, pembuatan akun, rollback, timeout setelah commit, password target, respons publik, serta frontend. `tests/profile-supabase-database.test.cjs` menguji izin database, pembatasan percobaan, lease notifikasi, dan penyelesaian reset sesuai cabang.

Pengujian layanan aktif dan browser memakai akun sementara dengan gaji nol, kemudian membersihkan profil, akun Auth, permintaan, dan audit uji. Tidak ada reset password atau perubahan data akun pegawai saat verifikasi. Hasil dan fingerprint profil berada di `tmp/profile-supabase-qa`.

Advisor mempertahankan dua peringatan yang sudah ada sebelum migrasi: [search_path helper payroll](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) dan [perlindungan password bocor belum aktif](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Tabel internal baru sengaja tidak memiliki policy browser karena seluruh akses melalui Edge.
