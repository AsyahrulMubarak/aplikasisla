# Gateway integrasi lama

Halaman aplikasi tidak menyimpan kunci integrasi operasional. Empat tindakan yang masih memakai Apps Script (`relayWA`, `syncCRM`, `broadcastCRM`, `laporBug`) dikirim ke `sla-legacy-gateway`. API profil, klaim sales, tiket, payroll, garansi dan tracking pelanggan tetap memakai layanan Supabase masing-masing.

Gateway memverifikasi JWT melalui Supabase Auth, mengambil profil berdasarkan `auth_id`, dan memeriksa role serta cabang sebelum mengakses integrasi. Identitas pengguna di payload diganti dengan hasil verifikasi server. Daftar tujuan Apps Script dan kunci dibaca dari satu konfigurasi JSON privat pada Supabase Vault bernama `sla_legacy_gateway`. Nilainya tidak dicantumkan dalam migrasi, source, dokumentasi, maupun respons browser.

RPC `sla_konfigurasi_gateway_lama()` memakai `security definer` dan `search_path` tetap; hak eksekusi untuk PUBLIC, anon, dan authenticated dicabut. Hanya service_role boleh memanggilnya. Endpoint gateway menolak origin di luar aplikasi, tindakan di luar daftar, cabang di luar akses, dan batch broadcast lebih dari 50 penerima. Respons mempertahankan hasil operasi dan menghapus field kredensial, termasuk pada objek bersarang.

Konfigurasi Vault sudah tersimpan secara privat pada proyek Alfacom SLA (`oozkqjgllubhjctnkxwl`) dengan persetujuan khusus pengguna. Migrasi `20261010024346_private_legacy_gateway.sql` telah diterapkan dan `sla-legacy-gateway` versi 1 aktif. Pemeriksaan ACL database memastikan hanya service_role boleh menjalankan RPC konfigurasi. Enam pemeriksaan HTTP produksi memastikan preflight bekerja, sesi kosong/token tidak valid/origin asing/metode GET ditolak, dan RPC tidak dapat dipanggil dengan kunci publik.

Delapan pengujian gateway lokal memakai kredensial dan pelanggan contoh; tidak mengirim WhatsApp nyata, broadcast, atau laporan bug. Pengujian integrasi mencakup penggantian identitas pengguna dari sesi terverifikasi, batas cabang dan role, tujuan upstream tetap, hasil broadcast parsial, serta penghapusan field kredensial bersarang. Tes login mendukung LF maupun CRLF agar hasil tidak bergantung pada gaya baris file Windows.
