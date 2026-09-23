# Presisi detik dan batas istirahat 13:30

Perbaikan 23 September 2026 untuk backend Absensi dan halaman Slip Gaji.

Backend `absen alfacom` diterapkan sebagai versi 49 pada deployment yang sama. URL web app, akun eksekusi, dan akses `Siapa saja` dipertahankan.

- Durasi kerja reguler, lembur, dan nominalnya dihitung sampai detik.
- Lupa absen masuk diisi otomatis pada 13:30:00 dan ditandai kuning.
- Potongan setelah istirahat mulai sesudah 13:30:00, berjalan sampai checkpoint masuk setelah istirahat, dan dibatasi 01:30:00.
- Jika checkpoint tidak ada, potongan dihitung sampai waktu berjalan atau absen keluar; hari kerja yang sudah lewat tanpa checkpoint mendapat batas maksimum 01:30:00.
- Catatan hukuman baru ikut disimpan bersama batch absen keluar agar tidak menghasilkan penulisan parsial.
- Slip menampilkan rekonsiliasi per tanggal: empat waktu mentah, durasi reguler, lembur, dan potongan istirahat.

Profil gaji, pencocokan identitas pegawai, tarif, jam kerja Kendari/Raha, izin, sakit, dan aturan lupa keluar tidak diubah.

## Verifikasi

- 319 pengujian lokal lulus.
- 254 pengujian pada checkout rilis lulus.
- Kasus batas 13:30:00/13:30:01, potongan berjalan 00:30:01, batas 01:30:00, detik reguler/lembur, lintas tengah malam, sakit/izin, serta jadwal Kendari/Raha tercakup.
- Source Apps Script tersimpan identik dengan `codeabsensi.txt` setelah normalisasi akhir baris sebelum deployment versi 49.
