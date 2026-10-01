# Perbaikan akses absensi, pengajuan Sales, dan klaim garansi

Pegawai tanpa gaji pokok positif tidak dapat membuka Absensi atau Slip Gaji. Direktur tetap dapat mengakses kedua modul. Pemeriksaan berlaku di lobby, halaman langsung, dan Edge API memakai profil terbaru dari database.

Pengajuan Sales berstatus Diajukan selalu tampil di Pengajuan Baru, termasuk pengajuan lama tanpa timestamp. Saat sebuah pengajuan ditolak, Sales lain dapat mengajukan klaim untuk tiket yang sama. Bukti dan keputusan lama disimpan di `sla_riwayat_klaim_sales` sebelum pengajuan baru ditulis.

Foto bukti ditampilkan melalui modal di halaman pengajuan. Tautan data gambar tidak ditambahkan ke kebijakan href. Modal berada di atas halaman pengajuan, dapat ditutup dengan tombol atau Escape, dan mengembalikan fokus ke tombol foto.

Klaim garansi menggunakan RPC `sla_klaim_garansi` dari Edge API. RPC memeriksa identitas manajemen, cabang, masa aktif, tiket asal, dan teknisi. Tiket baru memakai status `Claim Garansi`, teknisi yang tersimpan pada tiket asal, serta tenggat SLA sesuai jam kerja cabang. Garansi menjadi Diklaim (Hangus) hanya sesudah tiket berhasil dibuat dalam transaksi yang sama. ID deterministik dan penguncian baris mencegah tiket ganda saat diklik bersamaan atau dicoba kembali.

WhatsApp ditujukan kepada nomor pelanggan pada tiket asal dan semua teknisi pada tiket tersebut. Nomor teknisi diambil dari profil unik; akun dengan nama sama tidak ditebak. Antrean `sla_notif_klaim_garansi` menyimpan kegagalan dan lease pengiriman. Tombol pada kartu garansi yang sudah diklaim dapat mencoba kembali notifikasi tertunda sesudah lima menit tanpa mengulang notifikasi yang tercatat berhasil. Pengiriman memakai secret FONNTE_TOKEN atau FONNTE_TOKEN_CADANGAN yang sudah dikonfigurasi di Edge Function.

Pengujian memakai database PGlite dan provider WhatsApp tiruan. Tidak dibuat klaim uji atau pesan uji pada data produksi. Pengujian Chrome lokal memakai CSP produksi dan menguji tombol foto, Escape, fokus, layar ponsel, filter pengajuan, dan perlindungan klik ganda.

Untuk instalasi baru gunakan `sales-claims.sql` dan `warranty-claims.sql`. Untuk database produksi yang sudah memakai modul klaim Sales, hanya tabel arsip dan definisi RPC pengajuan yang perlu diperbarui; trigger yang sudah ada dapat dipertahankan.

Rollback kode frontend/API tidak menghapus tiket atau garansi yang sudah diklaim. Hubungan `garansi_asal`, `referensi_tiket_asal`, dan `tiket_klaim_garansi` harus tetap disimpan.

Pada 1 Oktober 2026, migrasi produksi sudah diterapkan dan Edge API mengembalikan revisi `salary-warranty-20261001`. Salinan API yang diunduh dari Supabase cocok dengan sumber yang diuji, dengan perbedaan indentasi saja. Secret `FONNTE_TOKEN_CADANGAN` tersedia. Preflight produksi berhasil dan permintaan klaim tanpa sesi ditolak dengan HTTP 401.
