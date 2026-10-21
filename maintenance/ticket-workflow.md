# Alasan pending dan serah terima teknisi

## Pemakaian

- **Update Status → Pending**: isi log singkat, kategori kendala, jadwal tindak lanjut dalam WITA, dan rujukan bukti (catatan komunikasi, PO, BA, atau foto yang sudah ada). Teknisi pada tiket dapat mengisi; admin cabang juga dapat mengisi.
- **Edit Detail → ubah Alokasi Teknisi**: admin mengisi kategori alasan, penjelasan, hasil yang sudah dikerjakan beserta sisa pekerjaan, dan rujukan bukti. Pilihan lama **Ganti Teknisi (Beri SLA Baru & Simpan Jejak Lama)** tetap menentukan apakah jam SLA baru dimulai. Menambah bantuan tanpa pilihan tersebut mempertahankan tenggat lama.
- Catatan dapat dibaca pada **Penilaian pekerjaan → Alasan pending & serah terima**. Saat status dilanjutkan, sistem menutup periode pending secara otomatis dan memakai mekanisme sisa SLA yang lama.
- Kontribusi tetap opsional dan default bagi rata. Ketentuan grade, pencapaian, persentase bonus, pembayaran, dan veto admin mengikuti aturan yang sudah berjalan.

## Penilaian

Kategori bukan keputusan kesalahan. Rekap performa memakai fakta terstruktur sebagai bukti untuk kasus Pending (T) dan pergantian (U). Admin tetap meninjau sebab dan bukti serta menentukan pengecualian/kesalahan. Satu akar masalah tetap hanya mendapat satu penalti utama. Data lama tanpa sebab tetap membutuhkan tinjauan; riwayat tidak diisi dengan dugaan.

Kredit performa resmi tetap mulai November 2026. Penerapan formulir tidak menjalankan evaluasi kredit, mengubah gaji, atau mengesahkan hasil Oktober.

## Penyimpanan dan kompatibilitas

`sla-ticket-workflow` memverifikasi Supabase Auth. RPC `sla_tiket_workflow` memeriksa ulang peran, cabang, teknisi terkait, versi tiket, daftar kolom, dan seluruh fakta sebelum menyimpan status/detail serta catatan dalam satu transaksi. ID permintaan mencegah catatan ganda saat respons jaringan diulang. Perubahan bersamaan ditolak dengan pesan muat ulang.

`tiket.konteks_pekerjaan` menyimpan fakta; `sla_konteks_pekerjaan_audit` menyimpan pelaku dan permintaan server. Kolom `versi_workflow` bertambah pada setiap perubahan tiket. Riwayat pergantian serta audit episode SLA lama tetap dibuat oleh trigger yang sudah ada. Nama PIC/tanda tangan dan pembagian yang sudah dikunci tetap terlindungi.

Status lain dan edit biasa mempertahankan jalur lama. Integrasi prospek, CRM, pembuatan BA, tracking, serta panggilan WA tetap dijalankan setelah penyimpanan berhasil. Endpoint baru tidak mengirim WA. Tracking publik memakai daftar kolom yang sudah dibatasi dan tidak menyertakan bukti internal baru.

## Verifikasi rilis

Uji PGlite mencakup transaksi gagal tanpa perubahan sebagian, hak cabang/peran, data palsu, versi basi, pengulangan permintaan, jeda/resume SLA, pergantian dengan/tanpa reset, tanda tangan terkunci, dan sumber rekap. Uji browser memakai halaman rilis sesungguhnya, Edge serta database tiruan; seluruh jaringan dibatasi dan WA dicegat tanpa pesan sungguhan.

Rilis antarmuka disusun dari salinan produksi terakhir, bukan seluruh folder kerja. Berkas slip gaji serta fungsi garansi/WA tidak termasuk perubahan ini.
