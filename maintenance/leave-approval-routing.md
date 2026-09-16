# Penerima WA dan hak persetujuan sakit/izin

Perubahan 16 September 2026 pada backend absensi.

Diterapkan ke deployment absensi yang sama, versi 45 → 46. URL dan pengaturan akses tetap sama.

| Pengaju | Penerima WA dan pihak yang dapat menyetujui/menolak |
| --- | --- |
| Admin Kendari | Direktur, Manager |
| Manager | Direktur, Admin Kendari |
| Pegawai lainnya | Direktur, Manager, Admin Kendari |

Admin pusat saat pemeriksaan menggunakan role `admin` dengan akses cabang `Semua`. Identitas lama dengan cabang kosong serta `Kendari` tetap dikenali sebagai admin pusat. Role `admin_raha` dan role `admin` dengan cabang `Raha` tidak memiliki hak persetujuan dan tidak menerima WA pengajuan.

Satu fungsi kebijakan digunakan untuk penerima WA, penyaringan antrean, dan validasi keputusan di server. Jabatan pemberi keputusan berasal dari akun yang diverifikasi server; jabatan pengaju berasal dari pengajuan tersimpan. Klien tidak dapat menggantinya lewat payload. Kedua keputusan, Setujui dan Tolak, mengikuti pembatasan yang sama. Pengajuan admin/manager yang masih menunggu juga mengikuti aturan baru. Riwayat tetap tersedia bagi manajemen seperti sebelumnya.

Tidak ada perubahan skema database, data pengajuan, perhitungan gaji, proyeksi sakit/izin, login, atau backend cabang lain. Hak masuk modul absensi tetap menggunakan pemeriksaan yang sudah ada.

## Verifikasi

- 48 uji integrasi lulus terhadap source backend lengkap: matriks pemberi keputusan, sasaran WA Sakit/Izin, penolakan pemalsuan jabatan, antrean, riwayat, dan pengajuan yang sudah diputuskan.
- 235 pengujian lokal serta 172 pengujian checkout rilis lulus.
- Seluruh pengiriman WA pada pengujian memakai mock; tidak ada pengajuan/keputusan percobaan atau WA nyata yang dikirim.
- Source produksi sebelum perubahan cocok dengan cadangan lokal, dan source tersimpan cocok dengan versi yang diuji.

`leave-approval-routing.gs` memuat helper kebijakan; `leave-approval-handlers.gs` adalah salinan persis handler terkait untuk uji regresi. Patch `leave-approval-backend.patch` dapat diterapkan dengan `git apply --unidiff-zero` pada baseline `codeabsensi.txt` yang sesuai. Source lengkap dan cadangan berada lokal di `tmp/approval-routing-qa`, tidak dipublikasikan karena mengandung konfigurasi rahasia lama.
