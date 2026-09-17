# Profil payroll dan bonus disiplin

Perbaikan 17 September 2026 untuk kasus akun bernama sama pada slip dan rekap gaji.

Backend Kendari diterapkan sebagai versi 232 dan Raha versi 45, pada URL deployment yang sama. Pengaturan akses dan eksekusi dipertahankan.

- Abu Abdillah memakai profil ber-role `manager`; Abu Naura memakai `admin_raha` (atau format lama `admin` dengan cabang Raha). Akun Sales/Teknisi bernama sama tidak dipakai sebagai profil gaji kedua nama tersebut.
- Pemilihan profil dipakai bersama untuk dropdown, form tunjangan, perhitungan slip, rekap, dan penyimpanan tunjangan. Duplikat nama lainnya memilih satu profil bergaji. Profil yang masih ambigu tidak ditebak.
- Permintaan penyimpanan tunjangan membawa username profil terpilih. Backend memeriksa kecocokan dengan baris pegawai sebelum menulis, dan tetap mengenali permintaan lama yang hanya membawa nama. Tidak ada penulisan tunjangan nyata saat pengujian.
- Bonus dengan nama `Bonus Disiplin` maupun nama lama `BONUS DISIPLIN BILA ...` dikenali. Saat melanggar, komponen ditampilkan sebagai `Bonus Disiplin (Hangus: ...)` dengan nominal nol, tanpa denda disiplin tambahan.
- Pegawai tanpa bonus tetap dikenai satu denda Rp300.000 jika melewati batas; pengecualian Fauzan, Dafa, dan Mubarak tetap berlaku. Batas telat + izin > 3 atau Alpa > 2, tunjangan lain, dan perhitungan absensi lainnya dipertahankan.

## Verifikasi

- 270 pengujian lokal serta 207 pengujian checkout rilis lulus.
- Skenario akun tertukar diuji dalam dua urutan data, termasuk akun pembanding yang juga bergaji dan username tidak sesuai. Rekap dan dropdown menampilkan Manager/Admin Raha dengan profil yang benar dan tanpa nama ganda.
- Batas disiplin diuji pada kondisi aman, satu batas dilanggar, kedua batas dilanggar, nama bonus pendek/panjang, beberapa komponen bonus, dan pengecualian nama.
- Source backend produksi sebelum perubahan cocok dengan cadangan lokal. Source final tersimpan cocok dengan versi yang diuji.
- Tidak ada akun, gaji pokok, riwayat absensi, maupun tunjangan pegawai yang diubah dalam database untuk menjalankan perbaikan ini.

`payroll-profile.gs` berisi pemilih profil bersama frontend/backend. `payroll-allowance-save.gs` berisi handler penyimpanan yang memakai profil tersebut. Patch backend memakai `git apply --unidiff-zero` pada baseline lokal yang sesuai. Backup source lengkap berada di `tmp/payroll-profile-qa` dan tidak dipublikasikan karena mengandung konfigurasi rahasia lama.
