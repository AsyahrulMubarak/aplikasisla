# Status rilis 10 Oktober 2026

Backend Supabase aktif: `sla-payroll-attendance` versi 24, `sla-client-tracking` versi 2, dan `sla-warranty-storage` versi 3. Dua migrasi garansi dan jadwal telah diterapkan. Pengujian gabungan sebelumnya lulus 75 kasus; dua kasus tambahan menguji token cadangan dan konfigurasi provider yang belum tersedia. Tiga pemeriksaan browser dengan data simulasi lulus. Pesan hari kelima memakai batas pukul 17.00 WITA dan kalimat aktivasi admin telah dihapus sesuai permintaan pengguna; pemberitahuan hari ke-28 dan aturan setelah hari ke-30 tetap sama.

Pemanggilan worker produksi mendapat HTTP 200 dengan status sukses, tanpa notifikasi tertunda. Tidak ada pelanggan dalam antrean pengingat saat pemeriksaan. Secret token cadangan yang sudah tersedia dipakai tanpa dibaca nilainya atau diterbitkan.

Kode backend, SQL, pengujian worker/database, serta dokumentasi dipublikasikan pada commit `7d112ac122f5b2e03ffd4edd5648100c81b20bda` di `AsyahrulMubarak/aplikasisla`.

`index.html` dan `absen.html` disiapkan bersama diagram pekerjaan teknisi. Kunci API integrasi lama dihapus dari halaman dan disimpan privat di Supabase Vault setelah mendapat persetujuan tujuan penyimpanan tersebut. Gateway terautentikasi `sla-legacy-gateway` versi 1 telah aktif, dengan RPC konfigurasi khusus service_role. Rincian diagram dan gateway ada pada `maintenance/technician-work-charts.md` dan `maintenance/legacy-gateway.md`.

Profil, poin, tiket, dan absensi Alif tidak diubah. Pemeriksaan dampak migrasi tersimpan di `maintenance/alif-raha-migration-review-2026-10-10.md`.
