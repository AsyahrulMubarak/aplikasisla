# Pengakhiran izin saat masuk kembali

Perbaikan 16 September 2026. Apps Script absensi diperbarui dari versi 43 ke versi 44 dengan URL deployment yang sama.

## Perilaku

- Pengajuan disetujui berhenti pada absen nyata pertama (`Masuk` atau `Masuk Setelah Istirahat`) dalam rentang tanggalnya. Catatan otomatis, koreksi, dan absen keluar tidak menutup pengajuan.
- Sisa tanggal izin tidak lagi ditampilkan atau dihitung sebagai izin. Warna izin/sakit hanya berlaku sebelum kembali masuk; warna keterlambatan, koreksi, auto-keluar, dan Ahad tetap mengikuti aturan sebelumnya.
- Pengajuan sakit baru tidak memerlukan tanggal selesai. Status sakit berjalan sampai tanggal hari ini, lalu berhenti ketika pegawai masuk kembali. Tidak ada pengisian hari sakit masa depan.
- Rentang awal dan catatan absensi nyata tetap tersimpan. Pengajuan lama direkonsiliasi saat dibaca; baris otomatis lama tidak dihapus.
- Tarif, kuota sakit, formula upah, GPS, hak akses, autentikasi, dan notifikasi tidak diubah.

## Penerapan

1. Jalankan `leave-return.sql` di database Supabase. Migrasi menambahkan waktu kembali bekerja dan trigger, serta mengizinkan tanggal selesai kosong untuk sakit. Izin tetap wajib memiliki tanggal akhir.
2. Terapkan `leave-backend.patch` pada backend absensi yang sesuai menggunakan `git apply --unidiff-zero`, simpan, lalu perbarui deployment yang sudah digunakan aplikasi. Salinan fungsi proyeksi terdapat di `leave-projection.gs` untuk pengujian tanpa kredensial.
3. Terbitkan `absen.html` dan `slipgaji.html` bersama-sama.

Source backend lengkap disimpan lokal karena berisi konfigurasi rahasia lama. Patch tidak memuat kredensial. Tidak ada perluasan izin akses database atau perubahan RLS.

## Verifikasi

- `node --test tests/*.test.cjs`: 109 pengujian lulus, termasuk 18 kasus izin/sakit baru.
- 32 pengujian backend lokal lulus: validasi, hak akses, penyimpanan tanggal sakit kosong, approval tanpa baris absensi masa depan, notifikasi dengan mock, serta regresi absensi.
- `leave-return-regression.sql` menguji trigger dengan fixture di dalam transaksi yang di-rollback. Dry-run berhasil; tidak ada fixture tersisa.
- Kasus izin 9–13 September dikonfirmasi dari data tersimpan: kembali masuk 9 September pukul 12:21:27 WITA, sehingga izin efektif hanya pada tanggal 9 sebelum kembali bekerja. Rentang awal tetap 9–13 September dan seluruh absensi nyata dipertahankan.
- Formulir diperiksa di browser: pilihan Sakit menyembunyikan tanggal selesai, pilihan Izin memunculkannya kembali.
- Pengujian tidak mengirim pengajuan nyata atau pesan WhatsApp.

Jika rollback diperlukan, pulihkan frontend dan deployment versi 43. Sebelum menonaktifkan dukungan tanggal selesai kosong, tinjau pengajuan sakit baru yang sudah masuk; jangan memaksa tanggal selesai atau menghapus riwayat.
