# Klaim Sales Kendari dan Raha

Rilis produksi pada 30 September 2026 di https://aplikasisla.vercel.app/.
Backend Kendari memakai versi **245**, backend Raha versi **55**, dengan URL
deployment yang tetap. Source produksi terbaru digabungkan dengan perubahan
klaim; perubahan tracking penitipan dan modul lain dipertahankan.

Migrasi Supabase berhasil. Satu pengajuan lama dipertahankan sebagai Riwayat,
tanpa mengantrekan WA ulang. Cadangan riwayat sebelum migrasi disimpan pada
`sla_klaim_sales_backup_20260930`, dengan RLS aktif dan akses browser dicabut.
Pemeriksaan produksi memastikan enam RPC backend tersedia dan tidak dapat
dieksekusi oleh role browser. Kedua backend berhasil membaca metadata dan
kolom pekerjaan produksi `jenis_pekerjaan`, memeriksa konfigurasi Supabase,
Fonnte, serta sesi, dan menjalankan antrean bersama. Pemicu Kendari
`kirimUlangNotifKlaimSales` terpasang. Modul klaim pada HTML produksi cocok
dengan source rilis, termasuk wadah cabang Kendari dan Raha.

Pengiriman WA nyata belum dipicu sebagai pengujian. Tidak ada pengajuan atau
keputusan buatan pada data produksi. Verifikasi tampilan dengan akun Admin
Kendari dilakukan melalui pengujian UI lokal; browser produksi menampilkan
halaman login karena tidak ada sesi Admin Kendari yang aktif.

Menu **Klaim Sales** berada pada lobby. Hanya Admin Kendari dapat membukanya,
melihat bukti, dan menerima atau menolak pengajuan. Kendari dan Raha ditampilkan
dalam dua bagian terpisah; pada ponsel keduanya tersusun ke bawah.

## Perilaku

- **Pengajuan Baru** berisi pengajuan baru yang masih menunggu keputusan.
- **Riwayat** berisi semua pengajuan sebelum menu dibuat, termasuk yang masih
  menunggu, serta pengajuan baru yang sudah diterima/ditolak. Status, alasan, dan
  bukti lama dipertahankan. Tanggal pengajuan lama tidak ditebak.
- Pengajuan lama yang masih menunggu tetap dapat diputuskan dari Riwayat.
- Saat diterima, kolom Sales pada tiket diisi dari Sales pengaju yang tersimpan.
  Saat ditolak, alasan wajib diisi dan dikirim kepada pengaju.
- Pengajuan baru mengantrekan WA kepada Admin Kendari. Keputusan baru,
  termasuk atas pengajuan lama, mengantrekan WA kepada Sales pengaju.
- Nomor WA selalu dibaca dari akun di Supabase. Identitas/nama/nomor pada
  payload browser tidak menjadi dasar hak akses atau sasaran WA.
- WA dikirim berurutan dengan **jeda minimal 2 detik sebelum setiap pengiriman**.
  Lease pengirim bersama di database menghindari pengiriman paralel dari backend
  Kendari dan Raha. Parameter `delay: "2"` Fonnte yang sudah ada dipertahankan.
- Pengiriman langsung mencoba menguras maksimal 10 pesan per eksekusi.
  Pesan yang tertunda/gagal tetap dalam antrean dan dicoba ulang oleh trigger
  terpusat setiap 5 menit. Status klaim tidak dibatalkan karena WA gagal.
- Nomor WA yang kosong/tidak valid dicatat sebagai gagal dan tetap menunggu
  sampai profil diperbaiki. Respons sukses berarti diterima/diantrekan Fonnte.
- Riwayat lama tidak memicu pengiriman ulang WA saat migrasi.
- Daftar diperbarui setiap 30 detik selama menu terbuka. Foto hanya dimuat saat
  admin memilih **Lihat bukti pengajuan**, agar refresh riwayat tidak mengunduh
  seluruh foto berulang kali.

Admin Kendari dikenali sebagai role `admin` dengan akses `Kendari`, `Semua`,
atau cabang kosong pada profil lama. Role `admin_raha`, role `admin` dengan
cabang `Raha`, Manager, Direktur, Sales, dan Teknisi tidak memiliki akses menu
atau keputusan. Pemeriksaan ada di frontend, backend, dan RPC database;
perubahan kolom klaim langsung dari browser juga ditolak oleh trigger database.

Pengajuan lama dihubungkan ke username Sales hanya jika nama cocok dengan satu
akun Sales. Nama yang ambigu/tidak ditemukan tetap tampil di Riwayat dan perlu
dicocokkan dengan akun pengaju sebenarnya sebelum diputuskan. Username pada
`klaim_sales_username` dapat diperbaiki melalui backend/service role yang sah;
jangan menebak identitas penerima WA.

## Aktivasi produksi

Lakukan pembaruan SQL, backend, dan frontend dalam satu jadwal rilis: guard SQL
akan menolak alur klaim langsung dari frontend lama sampai frontend diperbarui.

1. Simpan cadangan source backend aktif dan database. Bandingkan source aktif
   dengan source lokal sebelum mengganti source lengkap agar perubahan produksi
   yang lebih baru ikut dipertahankan.
2. Jalankan [sales-claims.sql](sales-claims.sql) pada Supabase SQL Editor proyek
   SLA. Skrip memerlukan tabel `users` dengan `username_login` yang sudah dipakai
   aplikasi. Migrasi menambahkan metadata klaim, antrean WA, lease bersama,
   RPC, dan guard kolom. Dapat dijalankan ulang tanpa menduplikasi pengajuan.
3. Pada source GAS terbaru kedua cabang, sertakan modul
   `sales-claims-backend.gs` satu kali. Arahkan aksi `getKlaimSales`,
   `getBuktiKlaimSales`, `ajukanBanding`, dan `responBanding` pada
   `prosesKlaimSales_(data)` sesudah pemeriksaan API key dan sebelum otorisasi
   sheet lama. Hapus handler sheet lama untuk dua aksi banding. Matriks
   `responBanding` memakai role `admin`; modul dan RPC memeriksa cabang Kendari.
   Source lengkap lokal `code.js` dan `coderaha.js.txt` juga memuat helper,
   tetapi jangan mengganti seluruh source produksi tanpa menggabungkan
   perubahan yang lebih baru.
4. Pastikan Script Properties backend berisi `SUPABASE_SERVICE_ROLE_KEY`
   (atau `SUPABASE_SECRET_KEY`), `FONNTE_TOKEN`, dan `CABANG_AKTIF` sesuai cabang.
   Kunci rahasia tetap di server. Perbarui versi kedua deployment yang sudah ada
   tanpa mengganti URL, lalu terbitkan `index.html` melalui hosting SLA yang ada.
5. Jalankan **`pasangTriggerNotifKlaimSales` sekali pada proyek GAS Kendari**.
   Fungsi ini membuat trigger `kirimUlangNotifKlaimSales` setiap 5 menit, dan
   tidak membuat duplikasi jika dijalankan lagi. Jangan pasang di proyek Raha.
6. Buka lobby dengan akun Admin Kendari. Periksa kedua bagian cabang dan
   pengajuan sebelum rilis pada tab Riwayat. Uji alur nyata dengan pengajuan
   yang memang diperlukan, serta pantau antrean dan log pengiriman.

## Validasi lokal

**61 pengujian fitur klaim lulus.** Suite umum menjalankan 463 pengujian:
462 lulus dan 1 kegagalan pada snapshot KPI lama yang dijelaskan di bawah.

- Pengujian backend menjalankan `doPost` dari kedua source lengkap menggunakan
  mock Supabase dan Fonnte: hak akses, identitas terverifikasi, pagination,
  bukti, sasaran WA, keputusan, antrean gagal, jeda 2 detik, dan trigger retry.
- Migrasi dijalankan pada PostgreSQL lokal melalui PGlite, termasuk pengulangan
  migrasi, data lama, hak eksekusi RPC, blokir perubahan langsung dari browser,
  rollback atomik, dua keputusan pada tiket yang sama, lease pengirim global,
  dan pemulihan antrean.
- Tampilan diuji di Chrome headless ukuran desktop 1366×900 dan ponsel 390×844
  dengan data contoh. Pengelompokan cabang, pemuatan foto, konfirmasi keputusan,
  akses Admin Raha yang ditolak, dan kembali ke lobby berhasil tanpa error JS.
- Tidak ada perubahan database produksi atau WA nyata pada pengujian ini.

Source produksi yang digabungkan juga lulus **49 pengujian klaim**. Suite
repository terbaru menghasilkan 296 lulus dan 19 gagal; hasil yang sama
diperoleh pada commit sebelum perubahan klaim, termasuk snapshot KPI, fixture
payroll/absensi, dan helper tracking penitipan yang belum tercakup fixture.
Pengujian tidak membuat klaim palsu atau mengirim WA kepada pegawai. Pengiriman
WA nyata akan berlangsung saat ada pengajuan atau keputusan yang sah.

Perintah untuk pengujian fitur:

```powershell
node --test tests/sales-claims.test.cjs
npm install --prefix tmp/sales-claims-qa --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.8
node --test maintenance/sales-claims-database.test.cjs
```

Catatan suite umum: tes `tests/kpi-lobby.test.cjs` yang membandingkan source KPI
dengan `maintenance/kpi-lobby-bridge.js` masih gagal karena helper snapshot lama
berbeda dari implementasi KPI yang sudah ada pada halaman (termasuk akses Juna
dan endpoint baru). Kode KPI tidak diubah dalam pekerjaan klaim ini.

Rujukan keamanan RPC: [Supabase Database Functions](https://supabase.com/docs/guides/database/functions)
dan [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
