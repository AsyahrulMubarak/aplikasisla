# Pemeriksaan ulang SLA Kendari dan Raha

Audit mencakup SLA, Absensi, Slip Gaji, enam modul JavaScript halaman utama, sembilan Edge Functions SLA, fungsi database, cron dan antrean WA. Tidak ditemukan pemanggilan GAS pada jalur aktif tersebut. Kode GAS lama adalah arsip. Halaman Google Pemicu Saya menunjukkan 0 pemicu.

Pengingat Supabase aktif untuk tiket, prospek, after-sales, dan penitipan kedua cabang. Dry-run memindai 244 tiket Kendari dan 42 Raha, 77 prospek Kendari dan 6 Raha, serta 220 kartu garansi Kendari dan 38 Raha. Raha belum memiliki pengingat jatuh tempo; skenario kedua cabang diuji lokal.

Antrean pengingat berisi 25 pesan yang diterima Fonnte tanpa duplikasi kunci-penerima maupun penerima-isi. Antrean izin (68), klaim sales (18), klaim garansi (7), dan gaji (1) sudah selesai; antrean reset sandi kosong. Scheduler terbaru HTTP 200. Jadwal harian prospek/after-sales pukul 07.00/09.00 WITA; dry-run bukan bukti eksekusi jadwal harian berikutnya.

Perbaikan: hapus jadwal tindak lanjut Pending dan rujukan bukti serah terima pergantian teknisi, termasuk kewajibannya di database. Riwayat lama tetap tersimpan. Perketat lima antrean WA lama agar timeout, respons tidak terbaca, dan hasil tidak pasti ditahan untuk pemeriksaan; lease kedaluwarsa tidak dikirim ulang otomatis. Penolakan eksplisit provider tetap bisa dicoba ulang.

Validasi: 853 pengujian lulus, 0 gagal, 1 perbandingan arsip GAS menjadi opsional karena backend tersebut sudah dipensiunkan. Harness login/dashboard dan batas pengambilan kode uji SLA disesuaikan dengan dependensi aktif. Pengujian baru mencakup lima antrean, concurrency, lease kedaluwarsa, penolakan, timeout, respons rusak dan error provider. Pending dan pergantian tersimpan tanpa dua kolom yang dihapus; tampilan diperiksa lewat browser lokal.

Tidak ada WA percobaan dikirim ke pegawai atau pelanggan. Sent berarti diterima provider; penerimaan pada perangkat membutuhkan laporan delivery provider. Pesan tidak pasti perlu diperiksa sebelum keputusan kirim ulang.

Pemeriksaan lanjutan menyelaraskan sumber Edge lokal dengan versi produksi untuk mempertahankan pemeriksaan akun aktif dan pengelolaan akun. Pengujian kini memakai sumber SLA aktif, bukan cache rilis. Setelah perluasan November dan lobby, 873 dari 874 pengujian lulus, tanpa kegagalan, dengan satu pembandingan arsip opsional dilewati; 15 pengujian terkait sumber omzet dan pencapaian juga lulus setelah pemeriksaan tambahan terhadap nota duplikat dan penyesuaian negatif.
