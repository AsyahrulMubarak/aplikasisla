# Edit kartu garansi

Admin cabang dan Manager dapat membuka **Edit Kartu Garansi** pada setiap kartu.
Form ini hanya memperbarui `status`, `durasi_hari`, `tanggal_mulai`,
`tanggal_habis`, dan `keterangan` pada baris garansi yang dipilih.

- Klaim yang salah dapat dikembalikan ke `Aktif`. Tanggal habis dihitung ulang
  dari waktu aktivasi sebenarnya ditambah durasi garansi.
- Aktivasi yang terlambat dicatat dapat memakai waktu pengambilan barang yang
  sebenarnya, termasuk detik.
- Status `Masa Tunggu` mengosongkan tanggal mulai/habis.
- Status `Habis (Tanpa Garansi)` menyimpan durasi 0 dan mengosongkan tanggal.
- Saat hanya memperbaiki keterangan kartu yang sudah diklaim, waktu klaim lama
  tetap dipertahankan.

Referensi tiket/nota, pelanggan, barang, nomor transaksi, sales, omzet, cabang,
admin SLA, dan riwayat follow-up tidak termasuk dalam payload edit.

Validasi otomatis ada di `tests/warranty-edit.test.cjs`. Seluruh suite berjumlah
258 pengujian dan lulus pada 23 September 2026.
