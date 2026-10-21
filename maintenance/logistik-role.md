# Role Logistik — rilis 21 Oktober 2026

Role `logistik` tersedia melalui Profil dengan satu cabang Kendari atau Raha. Lobby menampilkan Absensi, Slip Gaji, dan SLA cabang sendiri. Absensi dan slip pribadi tetap mensyaratkan gaji pokok positif. SLA menyediakan baca tiket cabang dan profil sendiri; input/edit/hapus tiket, KPI, klaim sales, dan pengelolaan penjualan/garansi tidak diberikan.

Pengaman database: `maintenance/logistik-access.sql`. Terapkan sebelum mengaktifkan role. Patch menambahkan scope privat dan policy RLS restriktif; tidak mengubah data pegawai, tiket, bonus, gaji, atau penilaian.

Layanan yang diperbarui: `sla-profile` v4, `sla-payroll-attendance` v30, dan `sla-client-tracking` v4. Gateway dan Apps Script tetap memakai versi aktif sebelumnya; tombol Lapor Bug tidak diaktifkan untuk Logistik pada rilis ini.

Validasi paket rilis: 57 tes profil/payroll/akses/dokumen/database lulus; pemeriksaan browser memakai fixture memastikan tiga menu, cabang sendiri, tanpa mutasi tiket, dan tampilan 390/320 piksel. Tidak ada akun nyata yang dibuat atau dialihkan selama publikasi.

Grade S–D, kontribusi teknisi, pembagian poin bonus, target, skor performa, serta kredit kenaikan gaji belum diterapkan.
