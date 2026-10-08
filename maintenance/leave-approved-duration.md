# Durasi persetujuan izin

Perubahan 8 Oktober 2026. Database memakai migrasi `20261008010217_leave_approved_duration`;
backend persetujuan memakai Edge Function `sla-payroll-attendance` versi 23.

Admin Kendari, Manager, dan Direktur yang berhak memutuskan pengajuan dapat
menentukan durasi izin berupa bilangan bulat 1 sampai jumlah hari yang diajukan.
Hitungan memakai hari kalender, termasuk tanggal mulai dan tanggal akhir.
Tanggal mulai tetap mengikuti pengajuan. Aturan rantai persetujuan dan cabang
yang sudah ada tetap berlaku.

Contoh: izin 8–14 Oktober (7 hari) dapat disetujui penuh, disetujui 3 hari
(8–10 Oktober), atau 1 hari (8 Oktober). Konfirmasi menampilkan jumlah hari
dan tanggal yang dipilih. Riwayat menampilkan durasi diajukan dan disetujui.
Sakit tetap berlangsung sampai kembali bekerja; penolakan tidak memerlukan
durasi.

`tanggal_selesai` menyimpan tanggal akhir yang diminta pegawai.
`tanggal_selesai_disetujui` menyimpan tanggal akhir hasil keputusan manajemen.
API menghitungnya dari pengajuan tersimpan dan memvalidasi durasi di server;
klien tidak dapat mengganti tanggal mulai, tanggal akhir pengajuan, atau identitas
pemberi keputusan. Persetujuan bersamaan tetap memakai filter status Menunggu.

Absensi efektif dan slip memakai rentang yang disetujui. Pegawai yang kembali
masuk lebih awal tetap mengakhiri izin. Trigger kembali bekerja juga memakai
tanggal akhir yang disetujui, sehingga absen setelah izin berakhir tidak dihitung
sebagai kembali di dalam rentang izin. Catatan nyata dan tanggal pengajuan awal
tetap tersimpan. Izin lama dengan kolom persetujuan kosong mengikuti rentang
awal, dan klien lama tanpa `durasiDisetujui` berarti menyetujui seluruh rentang.

## Penerapan

1. Simpan cadangan source produksi dan definisi kedua fungsi/trigger kembali
   bekerja. Terapkan `maintenance/leave-approved-duration.sql` ke proyek
   `oozkqjgllubhjctnkxwl`. Upgrade dapat dijalankan ulang dan tidak menambah
   hak akses browser, mengubah tanggal pengajuan awal, atau mengirim WA.
2. Deploy `supabase/functions/sla-payroll-attendance/index.ts` dengan pengaturan
   JWT dan secret yang sudah dipakai. Backend harus diperbarui sebelum frontend;
   backend lama tidak mengenali pilihan durasi.
3. Publikasikan `absen.html`. Tidak diperlukan perubahan frontend slip: slip
   menerima absensi efektif dari API. Salinan proyeksi GAS di `codeabsensi.txt`
   dan `maintenance/leave-projection.gs` juga mengenali tanggal akhir disetujui.
4. Periksa satu pengajuan nyata yang memang sedang ditinjau manajemen, lalu
   cocokkan tanggal diajukan, tanggal disetujui, riwayat, dan absensi efektif.

## Verifikasi lokal

187 pengujian terkait lulus, mencakup 25 pengujian fitur baru serta regresi
persetujuan, foto/notifikasi, sakit, kembali bekerja, absensi dan payroll.
Pengujian PostgreSQL memakai PGlite dan menjalankan upgrade dua kali.
Pengujian tidak membuat pengajuan/keputusan atau mengirim WhatsApp di produksi.

Pratinjau browser juga lulus 9 pemeriksaan pada halaman dan handler Edge yang
sesungguhnya, dengan transport/data simulasi: nilai awal 7 hari, pilihan 3 hari,
tanggal konfirmasi, pembatalan, penolakan 0 hari, penyimpanan keputusan,
riwayat 7 diajukan / 3 disetujui, tampilan ponsel tanpa overflow horizontal,
dan tidak ada galat JavaScript. Hasil dan gambar berada di
`tmp/leave-duration-qa/browser-verification.json` serta file PNG di direktori
yang sama. Ini tidak menggantikan verifikasi sesudah pemasangan di produksi.

```powershell
node --test tests/leave-approved-duration.test.cjs tests/leave-approved-duration-database.test.cjs tests/leave-return.test.cjs tests/leave-approval-routing.test.cjs tests/leave-evidence.test.cjs tests/leave-notification.test.cjs tests/attendance-supabase-migration.test.cjs tests/attendance-regression.test.cjs tests/attendance-workday.test.cjs tests/payroll-attendance-bonus.test.cjs tests/payroll-grace-period.test.cjs
```

Cadangan lokal dan pratinjau simulasi tersimpan di `tmp/leave-duration-qa`.

## Pemulihan

Pulihkan frontend persetujuan terlebih dahulu jika perlu membatalkan peluncuran.
Setelah persetujuan sebagian mulai digunakan, pertahankan kolom baru dan
proyeksi absensi yang membacanya. Memulihkan backend pembaca lama dapat
menganggap rentang diajukan sebagai rentang disetujui. Jangan menghapus tanggal
hasil persetujuan atau memperluas izin yang sudah diputuskan untuk rollback.

## Verifikasi rilis

Source rilis memakai commit produksi `669fb681f794e17cd9a9d16fad87a2e2281f1e69`
sebagai dasar. 117 pengujian terkait dan 9 pemeriksaan browser lulus terhadap
source rilis tersebut. Source Edge versi 23 cocok dengan source yang diuji.
Fingerprint 16 pengajuan sebelum/sesudah upgrade tetap
`86269792931025a1306efbc27666a8fa`; tanggal pengajuan/keputusan lama tetap sama.
RLS tetap aktif dan browser tidak memiliki akses tulis pengajuan atau EXECUTE
ke fungsi trigger internal. Tidak ada pengajuan atau pesan WA percobaan di produksi.
