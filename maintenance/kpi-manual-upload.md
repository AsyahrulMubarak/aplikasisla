# Unggah pembaruan login KPI

Paket ini berisi kode lengkap untuk aplikasi KPI yang terpisah. Login memakai akun SLA melalui tombol **Aplikasi KPI** di lobby.

| File | Tempat pemasangan |
| --- | --- |
| `Kode.gs` | Editor Apps Script **aplikasi KPI** |
| `cloudflare-worker.js` | Worker **alfacom-kpi** |
| `index.html` | Repositori GitHub **alfacom-kpi**, cadangan frontend |

## 1. Apps Script KPI

1. Cadangkan kode yang sedang aktif. Ganti isi file kode utama proyek KPI dengan seluruh isi `Kode.gs`, lalu simpan. Gunakan proyek KPI yang terhubung ke spreadsheet KPI saat ini.
2. Pertahankan Script Properties dan pengaturan spreadsheet yang sudah ada. Pastikan `SHARED_SECRET` tetap sama dengan milik Worker.
3. Pilih **Deploy/Terapkan → Manage deployments/Kelola deployment → Edit** pada deployment yang aktif. Pilih **New version/Versi baru**, kemudian **Deploy/Terapkan**. Pertahankan URL, identitas eksekusi, dan akses yang sudah digunakan; tidak perlu membuat deployment dengan URL lain.
4. Pembaruan ini tidak memerlukan menjalankan `setupApp`, memasang ulang trigger, atau mengganti data users/tugas/laporan.

Google menjelaskan pembaruan deployment aktif melalui versi baru pada [panduan versi Apps Script](https://developers.google.com/apps-script/guides/versions).

## 2. Cloudflare

1. Buka **Workers & Pages → alfacom-kpi → Edit code**.
2. Ganti kode Worker dengan seluruh isi `cloudflare-worker.js`, lalu **Deploy**.
3. Pertahankan variabel `GAS_URL` yang menunjuk URL `/exec` deployment KPI serta secret `SHARED_SECRET` yang sudah ada. Pembaruan ini hanya mengganti kode Worker.

Lihat [pengaturan variabel Worker](https://developers.cloudflare.com/workers/configuration/environment-variables/) dan [pengaturan secret Worker](https://developers.cloudflare.com/workers/configuration/secrets/).

## 3. Akun dan pemeriksaan

| Akun SLA | Role akun KPI | Location KPI |
| --- | --- | --- |
| Direktur | owner | all |
| Manager | auditor | all |
| Admin pusat/Kendari | admin_kendari | kendari |
| Admin Raha | admin_raha | raha |

Backend memakai akun KPI aktif yang sudah ada berdasarkan pasangan Role/Location. Harus ada tepat satu akun aktif untuk setiap pasangan di atas; jangan mengganti ID akun karena tugas/laporan tetap memakai ID lama. Format role `admin kendari` juga dinormalisasi menjadi `admin_kendari`.

Setelah dua backend diunggah, muat ulang SLA, login, lalu klik **Aplikasi KPI**. Tab KPI terbuka pada `https://alfacomapp.github.io/alfacom-kpi/` dan menerima sesi sesuai jabatan. Sales/teknisi tidak mendapat akses. Login password KPI lama dinonaktifkan oleh backend baru. Jika sesi berakhir, buka kembali melalui lobby SLA.

Sebelum kedua backend selesai diperbarui, login KPI melalui SLA belum dapat berfungsi. File frontend `index.html` ikut disediakan agar versi halaman dan backend tetap sama bila Anda memilih mengunggah frontend secara manual.

## Pemulihan

Jika kode aktif pada editor ternyata berbeda dari salinan awal yang Anda berikan, simpan cadangannya sebelum mengganti. Untuk kembali ke versi sebelumnya, gunakan deployment Apps Script sebelumnya dan versi Worker sebelumnya; data spreadsheet tidak perlu dihapus.
