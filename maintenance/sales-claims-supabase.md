# Klaim Sales melalui Supabase

Seluruh aksi Klaim Sales memakai `sla-payroll-attendance`: daftar Pengajuan Baru/Riwayat, bukti foto, pengajuan Sales, keputusan Admin Kendari, dan percobaan ulang WhatsApp. JWT Supabase diverifikasi di server; username, role, cabang, dan nomor penerima dibaca dari profil database. Admin Raha, Manager, dan Direktur tidak diberi hak baru.

Data klaim terbaru tetap berada di `tiket`. `sla_riwayat_klaim_sales` mengarsipkan pengajuan ditolak sebelum tiket diajukan ulang oleh Sales lain. Migrasi tidak mengubah atau menghapus klaim, bukti, keputusan, dan antrean. Daftar tidak mengunduh seluruh bukti foto; foto dimuat saat admin memilih pengajuan.

RPC menyimpan perubahan tiket dan antrean WhatsApp dalam satu transaksi. Edge Function mencoba maksimal dua pesan saat pengajuan/keputusan; scheduler `sla-notif-klaim-sales` mencoba maksimal tiga pesan setiap lima menit. Satu lease bersama dan jeda dua detik sebelum setiap pengiriman mencegah pengiriman bersamaan. Nomor penerima berasal dari profil terkini; kegagalan Fonnte tetap diantrekan tanpa membatalkan klaim. Lease yang hasil pengirimannya tidak dapat dicatat menunggu kedaluwarsa; tidak ada jaminan exactly-once jika provider berhasil menerima pesan tetapi koneksi ke database terputus.

Penerapan pada instalasi yang sudah berjalan:

1. Publikasikan Edge Function terbaru dengan konfigurasi JWT dan secret yang sudah ada.
2. Jalankan `sales-claims-supabase.sql` setelah `sales-claims.sql`. Alur lama Apps Script ditolak oleh RPC dan pengirim lama tidak lagi memperoleh lease.
3. Publikasikan frontend terbaru. Gateway merutekan empat aksi klaim langsung ke Edge Function sebelum jalur Apps Script.
4. Panggil `sla_installer_notif_klaim_sales()` menggunakan koneksi server yang terautentikasi. Installer memakai kunci scheduler yang sudah tersimpan terenkripsi di Supabase Vault; tidak membuat kunci baru atau mengubah job gaji/absensi.

Fonnte tetap menyediakan pengiriman WhatsApp. Pemrosesan aplikasi dan penjadwalan sepenuhnya berada di Supabase; Apps Script tidak diperlukan untuk menu ini. Trigger lama yang masih terpasang menjadi tidak aktif karena tidak dapat mengambil lease.

Validasi: `node --test maintenance/sales-claims-database.test.cjs tests/sales-claims-supabase.test.cjs`. Pengujian menggunakan database lokal dan provider tiruan; tidak membuat pengajuan atau mengirim pesan pengujian pada produksi.
