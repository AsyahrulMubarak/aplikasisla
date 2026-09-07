# Perbaikan status garansi tracking

Garansi dengan status tersimpan `Aktif` dan tanggal habis yang sudah terlewati
kini dikembalikan sebagai `Habis (Expired)` pada respons tracking publik maupun
respons internal. Halaman tracking memakai aturan yang sama untuk label dan
tombol klaim. Status masa tunggu, sudah diklaim, dan tanpa garansi tetap mengikuti
statusnya. Perhitungan ini tidak menulis ulang data garansi.

## Rilis 7 September 2026

- Frontend: commit `3223eb6`, sudah diterapkan pada `https://aplikasisla.vercel.app/`.
- Apps Script Kendari, project `APLIKASI SLA`: deployment produksi versi 227
  diperbarui ke **229**.
- Apps Script Raha, project `APLIKASI SLA-Raha`: deployment produksi versi 40
  diperbarui ke **41**.
- URL deployment, pemilik eksekusi, dan pengaturan akses dipertahankan.
- File `ReminderProspek.gs` tidak diubah.

`garansi-backend.patch` mencatat perubahan pada `Kode.gs` di kedua project.
Patch diterapkan pada sumber yang dibaca dari editor produksi. Salinan sumber
lainnya dipertahankan. Patch tidak berisi kunci API atau konfigurasi layanan.

## Verifikasi

- 7 pengujian frontend lulus, termasuk sintaks seluruh script inline, garansi
  kedaluwarsa, garansi aktif, status khusus, dan tombol klaim.
- 10 pengujian backend lokal lulus untuk Kendari dan Raha, termasuk bentuk respons
  publik, pembatasan tiket, dan penolakan identitas yang tidak cocok.
- Hash fungsi `statusGaransiEfektif_` dan `prosesGetAllData_` pada patch produksi
  cocok dengan fungsi yang diuji di kedua backend lokal.
- Isi masing-masing editor setelah penyimpanan cocok dengan patch yang disiapkan.
- Kedua deployment menampilkan konfirmasi penerapan berhasil.
- Pemeriksaan endpoint produksi dengan identitas tracking kosong menghasilkan
  penolakan JSON yang diharapkan, tanpa mengembalikan data pelanggan.
- Data transaksi produksi tidak dibuat atau diubah untuk pengujian.

Pengujian regresi frontend dari repository:

```sh
node --test tests/warranty-tracking.test.cjs
```

Jika perlu membatalkan rilis backend, pilih kembali versi 227 pada deployment
produksi Kendari dan versi 40 pada deployment produksi Raha melalui menu
Kelola deployment. Pemulihan frontend dapat dilakukan dengan revert commit
`3223eb6`; tidak memerlukan perubahan database.
