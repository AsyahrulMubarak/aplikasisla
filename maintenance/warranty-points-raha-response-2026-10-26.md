# Perbaikan garansi, poin, kontak Raha dan pengingat respons

26 Oktober 2026 WITA. Produksi: https://aplikasisla.vercel.app/.

- After-sales hanya memindai kartu berstatus Aktif. Pemeriksaan terakhir sebelum pengiriman membatalkan antrean kartu Masa Tunggu/Belum Diambil atau status lain yang tidak aktif, termasuk antrean dari versi lama.
- Poin awal tetap diinput lewat formulir Garansi. Tombol pada tiket Selesai disembunyikan sampai terdapat kartu garansi untuk tiket dan cabang tersebut, kemudian berlabel **Edit Poin / Veto Admin**. Handler buka/simpan juga memeriksa syarat tersebut. Nilai nol tetap terisi; koreksi tiket Lunas mempertahankan status pembayaran.
- Seluruh pesan outbox SLA cabang Raha memperoleh footer nomor dan tautan WhatsApp Admin Raha yang aktif dari database. Nomor saat rilis: 0813-5611-1636. Format ini diterapkan saat pengiriman, tanpa mengubah payload asli, menduplikasi footer atau menambahkan kontak pada pesan Kendari. Worker penitipan kompatibilitas memakai helper yang sama. Notifikasi akun, absensi dan penggajian menggunakan alur pegawai yang sudah ada.
- Peringatan RESPON_WARNED hanya dibuat untuk tiket Menunggu/Claim Garansi yang belum memiliki respons pertama. On Progress tidak menerima peringatan tersebut, termasuk setelah pergantian teknisi mengosongkan waktu respons. Pemeriksaan sebelum pengiriman membatalkan antrean lama. Pengingat tenggat pengerjaan tetap tersedia. TKT-097 diverifikasi berstatus On Progress, tanpa waktu respons, dengan riwayat teknisi pengganti; tidak ada antrean peringatan respons pending saat pemeriksaan.

Sumber aktif: sla-operations v9, sla-legacy-gateway v6, sla-warranty-storage v5. Semua tetap memakai autentikasi internal dan verify_jwt=false seperti konfigurasi sebelumnya.

Migrasi lokal → versi riwayat Supabase:

| Berkas lokal | Versi produksi |
| --- | --- |
| 20261026023618_warranty_followup_active_only.sql | 20261026024414 |
| 20261026024126_raha_whatsapp_admin_contact.sql | 20261026024423 |
| 20261026024630_response_reminders_waiting_only.sql | 20261026024936 |

Validasi:

- 32 pengujian backend/SQL lulus: status garansi, antrean lama, status tiket, pergantian teknisi, kontak dinamis/idempoten, jam kerja, provider dan hak RPC.
- 30 pengujian regresi tambahan lulus pada sumber rilis: poin/Veto, tampilan tombol per cabang, edit garansi, penitipan, filter tiket dan perlindungan hasil pengiriman tidak pasti.
- Uji browser formulir Garansi → REST simulasi → PostgreSQL lokal → tombol Edit Poin/Veto lulus untuk Kendari/Raha, desktop dan lebar 390/320 piksel, delapan penulisan fixture dan nol galat JavaScript. Seluruh jaringan eksternal diblokir. Bukti lokal: output/warranty-active-points/.
- tests/warranty-active-raha-live.sql lulus pada produksi di dalam transaksi rollback. Tidak ada data uji tertinggal atau WhatsApp percobaan dikirim.
- Health/dry-run produksi HTTP 200; memindai 251/45 tiket dan 231/42 kartu garansi Kendari/Raha. Daftar 10 temuan advisory keamanan sama sebelum/sesudah.

Perubahan HTML rilis disusun dari main f5238e904bec799079e9f7589ae061617f69dab2 dengan 13 baris ditambahkan dan 3 diubah, sehingga pekerjaan lokal lain tetap tersimpan terpisah dari rilis ini.
