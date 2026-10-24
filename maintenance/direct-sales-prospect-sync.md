# Pencocokan prospek pada penjualan langsung

Form Penjualan Langsung memeriksa nomor WA pembeli ketika nama atau WA berubah dan sebelum menyimpan. Nomor dinormalisasi agar format `08`, `628`, dan `+62` dapat cocok. WA diprioritaskan; nama menjadi fallback hanya ketika WA belum diisi. Hasil autofill sebelumnya dilepas ketika identitas berubah. Nama pembeli yang sudah diketik dipertahankan; nama dari prospek hanya mengisi kolom pembeli yang masih kosong. Input nama pembeli dan nama klien tiket menggunakan kolom masing-masing.

Setelah penjualan berhasil disimpan, prospek aktif dengan nomor WA, cabang, dan kumpulan sales yang sesuai transaksi diperbarui menjadi `Closing / Deal`. Perbedaan penulisan nama tidak menghalangi sinkronisasi. Status aktif yang diproses: Tahap Penawaran, Kunjungan Toko, On Progress, Pending, dan Proses Servis. Closing, Batal, dan Tanpa Keterangan dipertahankan.

PATCH menyertakan ID, cabang, dan status semula. Notifikasi WhatsApp dikirim ke sales penanggung jawab prospek setelah perubahan status terkonfirmasi. Respons PATCH kosong tidak memicu notifikasi. Penjualan yang gagal disimpan tidak mengubah prospek. Kegagalan sinkronisasi atau konfirmasi WA ditampilkan sebagai peringatan; penjualan yang sudah tersimpan tetap tersimpan.

Validasi lokal:

```powershell
node --test tests/prospect-sync.test.cjs tests/ticket-prospect-follow.test.cjs tests/sla-assignment.test.cjs
node tests/direct-sales-prospect-browser.cjs
```

Pengujian memakai form dan fungsi aplikasi, database PostgreSQL lokal dengan trigger Closing aplikasi, serta simulasi relay WhatsApp. Tidak mengirim pesan WhatsApp nyata atau mengubah data produksi. Hasil browser dicatat di `output/direct-sales-prospect-20261024/verification.json`. Perubahan ini berada pada frontend; tidak memerlukan migrasi database.

## Rilis produksi — 24 Oktober 2026

- Situs: https://aplikasisla.vercel.app/.
- Commit produksi: `6cf99bc5530d41333aaa8a8f67cd4762ae9b77e4`, branch `main`, repository `AsyahrulMubarak/aplikasisla`.
- Deployment: https://vercel.com/asyahrulmubaraks-projects/aplikasisla/AoHBHoduVBDgXoTWaurhshgeR58L. Pemeriksaan Vercel pada commit berstatus `success`.
- Hanya `index.html` dipublikasikan. Blob Git sumber rilis: `6a345f1f6521985f726564d91a1c7c0ee69da3a4`.
- Situs utama HTTP 200; SHA-256 HTML identik dengan kode yang diuji: `b6fee44d09430f923d1fbbd4ae80620698b25f6b31c7c70a3aea3ae8399ab3e4`.
- Simulasi browser dijalankan ulang menggunakan HTML yang diunduh dari situs produksi: empat kelompok skenario lolos, tanpa galat browser dan tanpa pengiriman WhatsApp nyata.
- Bukti HTTP, snapshot HTML produksi, dan hasil browser berada di `output/direct-sales-prospect-20261024/production/`.
- Rilis melalui integrasi GitHub karena koneksi MCP Vercel belum berwenang pada scope tim. Log runtime Vercel tidak diperiksa; verifikasi ini memakai status deployment GitHub, respons situs utama, kecocokan hash, dan simulasi browser.

## Penyimpanan WA dan pemeriksaan data lama

Nomor WA kini disimpan pada `penjualan.no_wa_pembeli`, dibaca melalui pemetaan biasa dan Realtime, ditampilkan sebagai tautan WhatsApp pada kartu penjualan, serta dapat dipakai untuk pencarian. Nilai baru dinormalisasi dan diperiksa sebelum transaksi disimpan. Migrasi `20261024010738_direct_sale_buyer_whatsapp.sql` menambahkan kolom nullable untuk kompatibilitas data lama dan batasan format 628.

Seluruh 34 penjualan lama diperiksa. Sembilan nomor dipulihkan dari referensi transaksi CRM, nama pelanggan CRM yang unik, atau nama/cabang/sales/tanggal prospek yang cocok tanpa bukti bertentangan. Rencana read-only berada di `maintenance/direct-sale-phone-recovery.sql`. Sebanyak 25 nomor lama, termasuk SLS-015, tidak mempunyai bukti tersimpan yang memadai; kartu menampilkan `Belum tercatat`.

PRP-079 dicocokkan ke SLS-029 melalui referensi CRM dan nomor WA yang sama meskipun nama berbeda. Seluruh sales prospek tercantum pada transaksi. Status diubah dari Tahap Penawaran menjadi Closing / Deal. Satu notifikasi ke sales penanggung jawab sudah berstatus `sent` pada antrean operasional, percobaan pertama, dengan penerimaan provider terkonfirmasi. Tidak ada kandidat lain yang belum Closing dengan bukti WA/cabang/sales/tanggal yang sesuai.

Snapshot pemulihan dan bukti verifikasi disimpan lokal di `output/direct-sales-prospect-20261024/`; data pelanggan dan nomor WA tidak dimasukkan ke commit rilis.

## Grade pada pergantian status

Audit produksi tidak menemukan grade tersimpan yang terhapus dari database. Tampilan sebelumnya menyembunyikan grade pada tiket Outsource/Cancel/Batal atau kontribusi yang dikecualikan/menunggu tinjauan. Grade historis kini tetap ditampilkan dengan keterangan tersimpan. Aturan 0 poin dan pembatasan revisi pada status tersebut tetap berlaku.

Pembaruan Realtime tiket juga menggabungkan kolom yang tersedia dan menolak versi workflow lama. Payload perubahan status yang tidak menyertakan penilaian tidak lagi menghapus grade pada cache tampilan. Nilai eksplisit dari versi server yang lebih baru tetap berlaku.

Verifikasi: 59 tes lulus untuk sinkronisasi prospek, penyimpanan/validasi WA PostgreSQL, grade/revisi, transisi status, dan aturan kontribusi. Lima kelompok skenario browser lulus untuk form dan kartu penjualan, penyimpanan WA, pencarian 08/628, pemisahan cabang, kegagalan penyimpanan dan notifikasi.
