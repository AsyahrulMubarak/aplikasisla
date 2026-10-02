# Migrasi absensi dan slip gaji ke Supabase

Cakupan: API baca/simpan absensi, GPS/radius kantor, koreksi, approval sakit/izin,
komponen payroll, foto bukti, dan pengiriman WhatsApp pengajuan. Perhitungan upah,
lembur, potongan, serta tampilan slip tetap memakai rumus browser yang sudah ada.
Login dan modul SLA/CRM di lobby berada di luar cakupan.

`absen.html` dan `slipgaji.html` selalu menghubungi `sla-payroll-attendance` dengan
JWT Supabase di header Authorization. Alamat GAS yang tersimpan dalam sesi lama
tidak dipakai sebagai tujuan request. Identitas, gaji pokok, role, dan cabang
diverifikasi dari Auth dan profil server. Foto baru masuk bucket privat
`sla-attendance-private`; database menyimpan `storage:<path>`. Setelah pemeriksaan
hak akses, API mengembalikan signed URL yang berlaku satu jam.

## Urutan pemasangan

1. Simpan salinan versi Edge Function/frontend aktif dan jumlah baris absensi serta
   pengajuan sebelum migrasi. Jangan menimpa perubahan terbaru di repository.
2. Terapkan `supabase/migrations/202610020001_attendance_storage_notifications.sql`.
   Migrasi menambah kolom identitas pengaju, antrean WA dan log migrasi foto;
   tidak menghapus catatan, komponen gaji, atau file Drive. Pengamanan profil
   `sla_profile_lock_active`, RPC `sla_insert_absensi_batch`, dan tabel payroll
   dari pemasangan Supabase yang sudah ada tetap diperlukan.
3. Deploy `supabase/functions/sla-payroll-attendance/index.ts` pada proyek yang sama.
   Pertahankan pengaturan gateway JWT yang sudah ada: fungsi memverifikasi JWT
   sendiri dan endpoint scheduler hanya menerima kredensial server. Pastikan
   `FONNTE_TOKEN` atau `FONNTE_TOKEN_CADANGAN` tersedia sebagai Edge secret.
4. Panggil `sla_installer_notif_absensi()` melalui akses server terautentikasi.
   Fungsi memakai secret Vault `sla_payroll_server_key` yang sudah tersedia,
   tanpa memasukkan key baru ke frontend/source. WA yang gagal dicoba ulang
   setiap lima menit dengan backoff dan lease untuk membatasi pengiriman ganda.
   Jadwal `sla-finalize-attendance` dan jadwal kenaikan gaji tidak berubah.
5. Publikasikan dua halaman yang diperbarui bersama. Jangan mengubah URL API
   GAS lobby: modul lain masih menggunakannya. Verifikasi tidak ada request GAS
   ketika membuka absensi/slip, menyimpan payroll, atau melakukan approval.

## Foto lama

Endpoint server `migrasiFotoAbsensiLama` memproses paling banyak 10 referensi
Drive per panggilan, dengan batas waktu unduhan dan batas foto 5 MB. Panggil
melalui `net.http_post` dari SQL Editor, memakai key Vault yang sama di header
`apikey` dan `x-sla-job-key`. Payload hanya
`{"action":"migrasiFotoAbsensiLama"}`. Ulangi setelah respons batch sebelumnya
selesai. Original URL dan hasil tersimpan di `sla_migrasi_foto_absensi`; tiga
kegagalan menandai item yang perlu pemeriksaan. Tidak ada job migrasi permanen.
Tautan file yang tidak dapat diunduh tetap dipertahankan di record aslinya.

Alternatif dari terminal: isi `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`
melalui environment yang aman, kemudian jalankan:

```powershell
node maintenance/migrate-attendance-photos.cjs
node maintenance/migrate-attendance-photos.cjs --apply
```

Perintah pertama hanya inventarisasi; `--apply` mengunduh, memeriksa tipe file,
menyalin ke Storage, lalu mengganti URL memakai compare-and-set agar perubahan
bersamaan tidak tertimpa. Laporan lokal menyimpan URL asli untuk pemeriksaan
dan pemulihan. Jangan commit laporan atau credential. File Drive tetap ada.
Referensi selain Drive dilaporkan untuk pemeriksaan dan tidak diubah otomatis.

## Verifikasi dan pemulihan

Uji baru mencakup transport JWT/refresh, foto privat, kegagalan WA/database,
migrasi foto, serta SQL antrean/routing/lease dan pemasangan ulang. Jalankan:

```powershell
node --test tests/attendance-supabase-migration.test.cjs tests/attendance-photo-migration.test.cjs tests/attendance-notifications-database.test.cjs tests/attendance-workday.test.cjs tests/payroll-grace-period.test.cjs
```

Bandingkan jumlah baris sebelum/sesudah, pastikan seluruh foto Drive sudah
menjadi referensi Storage atau tercatat sebagai kegagalan yang perlu ditangani,
dan periksa akses pegawai/manajemen kedua cabang. Uji WA produksi harus memakai
pengajuan nyata yang diminta pengguna; jangan membuat pengajuan palsu untuk
mengirim pesan ke pegawai. Respons Fonnte `status:true` menunjukkan penerimaan
oleh provider, bukan bukti pesan sudah dibaca/diterima ponsel.

Jika rollback diperlukan, pulihkan versi Edge/frontend dari cadangan. URL asli
foto masih tersedia dalam log/laporan, dan foto sumber Drive belum dihapus.
Jangan menjalankan migrasi data ulang atau menghapus tabel riwayat untuk rollback.
