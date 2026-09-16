# Perbaikan sakit berkelanjutan dan pengingat prospek

Diterapkan 16 September 2026.

## Perubahan

- Sakit yang disetujui, termasuk pengajuan lama dengan tanggal selesai, berlangsung sampai absen masuk nyata pertama. Tanggal akhir lama tetap tersimpan sebagai riwayat. Izin biasa tetap mengikuti batas tanggalnya.
- Hari sakit dihitung sampai hari berjalan. Kuota autofill tetap tiga hari kerja per bulan; setelah habis, waktu absensi kosong, latar biru, tanpa upah otomatis dan tanpa status Alpa. Ahad, waktu absen nyata, tarif, kuota, serta perhitungan lain dipertahankan.
- Scanner prospek lama kini memeriksa status terbaru di Supabase sebelum pengiriman atau penutupan 30 hari. Batal, Tanpa Keterangan, Closing/Closing / Deal, dan Proses Servis dilewati. Jadwal dan penerima pengingat untuk prospek aktif dipertahankan.
- Status yang tidak dapat diverifikasi, ID hilang, atau baris di luar cabang tidak memicu pesan berdasarkan salinan Sheets yang lama.
- Kedua project memiliki `ReminderProspek.gs` yang mendefinisikan ulang fungsi scanner. Source lama terbukti identik dengan bagian yang sama pada `Kode.gs`. File tambahan sekarang hanya berisi komentar agar nama fungsi dan trigger yang sama menjalankan satu implementasi di `Kode.gs`.

## Artefak dan penerapan

- `sick-continuation.sql`: migrasi Supabase; `sick-continuation-regression.sql`: uji dengan rollback.
- `sick-crm-attendance.patch`, `sick-crm-main.patch`, `sick-crm-raha.patch`: patch tanpa kredensial untuk source backend lokal terkait; gunakan `git apply --unidiff-zero` pada baseline yang sesuai.
- `ReminderProspek.gs`: isi final file tambahan pada kedua project.
- `leave-projection.gs` dan `prospect-reminder-scanner.gs`: salinan fungsi produksi untuk uji regresi tanpa kredensial. `prospect-reminder-guard.gs` memuat helper validasi status yang sama.
- Apps Script absensi: versi 44 → 45; Kendari: 230 → 231; Raha: 43 → 44. URL, akses deployment, dan nama trigger tetap sama.

## Verifikasi

- 125 pengujian di checkout rilis dan 188 pengujian lokal lulus.
- Uji SQL nyata lulus lalu di-rollback: sakit lama mendeteksi masuk setelah tanggal akhir asal; autofill dan koreksi tidak menutup sakit; izin biasa tetap memiliki batas akhir.
- Audit baca saja di kedua Apps Script berhasil menggunakan akses Supabase yang ada. Sampel prospek berstatus akhir ditolak; prospek aktif Kendari tetap memenuhi syarat. Data Raha saat audit hanya memiliki status akhir. Tidak ada notifikasi percobaan yang dikirim.
- Fungsi audit sementara dihapus sebelum deployment final. Seluruh source final diverifikasi cocok dengan versi yang diuji.
- Data kasus sakit 12 dan 14 September: tanggal 15 menjadi hari ketiga yang masih memperoleh autofill sesuai kuota yang berlaku; tanggal 16 kosong berlatar biru setelah kuota habis. Keduanya tidak dianggap Alpa.
- Riwayat pengajuan dan absensi nyata tidak dihapus atau diubah.

Rollback harus konsisten antara database, `Kode.gs`, dan file tambahan scanner. Cadangan source sebelum perubahan disimpan lokal di `tmp/sick-crm-qa`; tidak dipublikasikan karena backend lengkap mengandung konfigurasi rahasia lama.
