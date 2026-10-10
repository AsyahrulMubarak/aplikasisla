# Penitipan garansi dan lokasi absensi Manager

Kebijakan berlaku pada Kendari dan Raha. Lama penitipan dihitung per tanggal WITA sejak waktu siap diambil (waktu selesai tiket atau waktu laporan penjualan). Tujuh hari pertama gratis. Mulai hari kedelapan, hak garansi hangus dan biaya penitipan Rp1.000 per hari berjalan sesuai batas lama: maksimal hari ke-30/Rp23.000. Pesan hari ke-28 dan ketentuan setelah hari ke-30 tetap memakai perilaku sebelumnya.

Kartu tetap berstatus Masa Tunggu selama belum diambil. Admin mencatat pengambilan melalui tombol aktivasi. Pengambilan terlambat menyimpan status Hangus (Lewat 7 Hari); tanggal garansi tidak dimulai ulang. RPC klaim menolak hak garansi yang hangus, termasuk untuk kerusakan yang sama. Trigger database menjaga waktu siap diambil, waktu pengambilan, dan penanda hangus agar tidak dapat direset dari browser.

Migrasi `20261010012854_warranty_storage_seven_days.sql` menambah metadata penitipan, perlindungan perubahan kartu, dan antrean notifikasi privat. Migrasi `20261010013030_warranty_storage_schedule.sql` menjalankan `sla-warranty-storage` setiap lima menit menggunakan kredensial scheduler SLA yang sudah ada di Vault. Worker hanya mengirim pengingat pada hari kelima sampai ketujuh untuk barang yang masih menunggu. Pengiriman berhasil dicatat setelah diterima provider; kegagalan dicoba ulang. Token provider menggunakan Edge secret `FONNTE_TOKEN` atau `FONNTE_TOKEN_CADANGAN`, tanpa menambah token ke browser atau repositori.

Jangan menerapkan ulang timestamp awal ketika mengaktifkan kartu lama. Migrasi mempertahankan klaim yang sudah diproses serta status kedaluwarsa/tanpa garansi; kartu yang sebelumnya diaktifkan setelah melewati masa penitipan ditandai hangus.

Manager dapat absen dalam radius 100 meter dari kantor Kendari maupun Raha. Server memverifikasi role dari profil Auth dan memakai kantor terdekat. Pegawai lain tetap mengikuti kantor cabangnya. Koordinat Raha menggunakan konfigurasi yang sudah tersedia: -4.8268920873652625, 122.72467110301972.

Pengujian mencakup batas hari ketujuh/kedelapan, batas biaya hari ke-30, pengambilan terlambat, pencegahan reset tanggal, klaim, pengiriman ulang notifikasi, lokasi Raha untuk Manager, serta penolakan pemalsuan role/cabang. Pengujian SQL memakai PGlite pada direktori QA yang sama dengan pengujian database sebelumnya (`tmp/sales-claims-qa/node_modules/@electric-sql/pglite`). Pengujian browser memakai data simulasi dan tidak mengirim pesan kepada pelanggan.
