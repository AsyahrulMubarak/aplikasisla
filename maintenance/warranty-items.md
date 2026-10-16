# Garansi per item dalam satu kartu

Setiap kartu baru memuat daftar item/cakupan dengan nama (termasuk nomor seri/unit bila ada), durasi, status, tanggal mulai, dan tanggal habis sendiri. Pengambilan memulai tanggal tiap item dari waktu pengambilan yang sama. Durasi nol berarti tanpa garansi.

Admin/Manager memilih satu atau beberapa item aktif, mengisi keluhan opsional, lalu mengonfirmasi klaim. Satu kejadian menghasilkan satu tiket untuk item terpilih dan notifikasi kepada pelanggan serta teknisi asal. Hanya item terpilih menjadi `Diklaim (Hangus)`. Semua tanggal habis asli tetap disimpan, termasuk tanggal item terpilih; waktu klaim dicatat terpisah. Kartu yang masih memiliki item aktif tetap bisa menerima klaim untuk item lain.

Rincian item tersimpan pada kolom `garansi.item_garansi`; setiap kejadian tersimpan pada `garansi.riwayat_klaim_item`. Database mengunci kartu selama transaksi. ID pengajuan menjamin pengiriman ulang tidak membuat tiket/notifikasi tambahan. Batas satu tiket per kartu diganti dengan keunikan notifikasi per tiket/penerima. RPC lama tetap mendukung pengiriman ulang tiket historis, tetapi menolak klaim menyeluruh pada kartu dengan rincian item.

Aturan penitipan lama tetap berlaku pada tingkat kartu/barang yang diambil: tujuh hari gratis, hangus setelah melewati tujuh hari, biaya mulai hari kedelapan Rp1.000/hari sampai batas lama. Trigger penitipan yang sudah ada tetap dipakai, kemudian trigger item menurunkan status hangus ke seluruh cakupan terkait. Aktivasi terlambat tidak memulai tanggal garansi baru.

Migrasi hanya menambah dua kolom dengan nilai kosong dan memperbarui fungsi/indeks. Tidak ada pemecahan otomatis, penulisan ulang status/tanggal/keterangan, atau penghapusan data kartu lama. Kartu lama ditampilkan sebagai satu cakupan. Kartu lama yang belum pernah diklaim dapat dirinci berdasarkan nota; bila garansi sudah berjalan, setiap item mewarisi durasi dan tanggal semula. Kartu yang sudah diklaim tidak dapat dipecah. Setelah item berjalan, edit kartu hanya mengubah keterangan. Riwayat klaim, identitas kartu, serta tanggal item tidak dapat direset melalui PATCH biasa.

Tracking pelanggan memuat rincian item setelah verifikasi identitas yang sudah ada. Dashboard menghitung tiket asal yang memiliki klaim pada periode kejadian; beberapa item/tiket klaim dari satu tiket asal tidak menggandakan hitungan tiket bocor. Omzet tetap dicatat sekali pada kartu/transaksi asal.

## Validasi

`node --test tests/warranty-*.test.cjs tests/edge-salary-warranty.test.cjs tests/client-tracking-supabase.test.cjs maintenance/warranty-items-database.test.cjs maintenance/warranty-storage-database.test.cjs maintenance/warranty-claims-database.test.cjs`

`node tests/warranty-items-browser.cjs`

Pengujian database memakai PostgreSQL PGlite lokal dan mencakup pemeliharaan seluruh field lama, durasi berbeda, klaim sebagian/berikutnya/beberapa item, idempotensi, isolasi cabang, penolakan item tidak layak, perlindungan edit, migrasi berulang, serta batas penitipan hari ke-7/8. Pengujian browser menjalankan form dan renderer asli, Edge dispatch asli, serta RPC PostgreSQL asli. Sesi dan pengiriman WhatsApp memakai simulasi lokal; tidak ada pesan uji kepada pelanggan. Tangkapan layar berada di `output/warranty-items/`.

## Urutan rilis

1. Terapkan migrasi `warranty_items_partial_claims` dan bandingkan sidik data kartu lama sebelum/sesudah.
2. Rilis `sla-payroll-attendance` dan `sla-client-tracking`, dengan konfigurasi autentikasi yang sudah berlaku.
3. Publikasikan frontend dari basis `main` yang sudah diperiksa.
4. Verifikasi versi aktif, schema/izin RPC, respons endpoint, dan halaman produksi.

Rollback frontend tetap aman terhadap kartu terperinci: RPC lama menolak klaim menyeluruh. Pertahankan kolom dan riwayat baru setelah kartu per item digunakan; jangan menghapusnya untuk rollback.
