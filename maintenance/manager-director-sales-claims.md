# Akses Klaim Sales untuk Manager dan Direktur

Manager dan Direktur dapat membuka Klaim Sales dari lobby, membaca pengajuan/riwayat/bukti, serta menerima atau menolak pengajuan. Cabang mengikuti profil yang diverifikasi server: akses Semua mencakup Kendari dan Raha; akses satu cabang dibatasi pada cabang tersebut. Admin Kendari tetap mempunyai akses klaim kedua cabang seperti sebelumnya. Role lain tetap mengikuti izin lama.

Frontend membatasi menu, daftar, bukti dan tombol keputusan. Edge Function `sla-payroll-attendance` memverifikasi JWT dan profil, mengabaikan identitas dan akses cabang dari payload browser, lalu membatasi query serta target keputusan. Database mengulang pemeriksaan role/cabang dari profil pada RPC sebelum mengunci tiket dan menyimpan keputusan. Fungsi keputusan dan helper izin hanya dapat dipanggil service_role dengan jalur Supabase Edge yang sudah digunakan aplikasi.

Keputusan mencatat username pengambil keputusan pada `klaim_sales_admin`. Alasan penolakan tetap wajib. Penerimaan memakai identitas Sales yang sudah tersimpan pada pengajuan; perlindungan pengajuan lama, keputusan ganda, dan notifikasi antrean tetap berlaku. Pesan hasil klaim tidak lagi menganggap semua keputusan dibuat Admin Kendari. Penerima pemberitahuan pengajuan baru tetap mengikuti konfigurasi sebelumnya.

SQL perubahan ada di `maintenance/manager-director-sales-claims.sql`; migrasi resmi `20261010031528_manager_director_sales_claims.sql` telah diterapkan dan `sla-payroll-attendance` versi 25 aktif. Sebanyak 175 pengujian terkait serta tujuh pemeriksaan browser lulus, termasuk keputusan oleh kedua role, hak akses satu cabang, bukti foto, dan riwayat. Pengujian memakai akun/tiket contoh dan tidak menerima, menolak, atau mengirim pesan untuk tiket pelanggan nyata.
