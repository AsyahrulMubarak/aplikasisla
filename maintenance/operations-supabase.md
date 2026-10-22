# Operasional SLA Kendari dan Raha di Supabase

Mulai 22 Oktober 2026, empat operasi `relayWA`, `syncCRM`, `broadcastCRM`, dan
`laporBug` dilayani oleh `sla-operations`. Frontend tidak menyimpan URL GAS.
`sla-legacy-gateway` mengimpor implementasi yang sama untuk tab browser lama;
endpoint kompatibilitas ini tidak meneruskan request ke Apps Script.

Identitas diverifikasi melalui Auth dan `sla_assert_account_session`, lalu role
dan cabang diambil dari profil server. Tabel/RPC operasional hanya dapat diakses
service_role; RLS aktif. Gambar laporan bug berada di bucket privat
`sla-bug-private`. Admin dapat membaca laporan melalui `getBugReports` dengan
signed URL lima menit. `getOperationsStatus` menampilkan kegagalan/hasil ambigu
tanpa mengekspos nomor penerima atau kredensial.

## Jadwal

Seluruh jadwal menangani kedua cabang dari data Supabase. Jam berikut WITA;
ekspresi cron disimpan dalam UTC.

| Job | Jadwal | Fungsi |
| --- | --- | --- |
| sla-ops-queue | Setiap menit | Mengirim antrean WA dan mencoba ulang penolakan provider |
| sla-ops-tickets | Setiap 5 menit | Respons 15 menit, pengerjaan 2 jam, penugasan 27 jam kerja, nota 9 jam kerja |
| sla-ops-prospects | 07.00 setiap hari | Pengingat setiap 3 hari; Tanpa Keterangan setelah 30 hari tanpa follow up |
| sla-ops-after-sales | 09.00 setiap hari | Follow up hari 5 untuk garansi 7 hari, hari 7 untuk 30 hari, hari 30 untuk 90–365 hari |
| sla-penitipan-garansi | Setiap 5 menit | Pengingat pengambilan hari 5–7 dan 28–30; penutupan mulai hari 31 |

Scanner tiket menghormati jam cabang (Kendari 08–17, Raha 08–20), jeda ibadah,
hari Ahad, dan status Pending/Outsource/Cancel. Jadwal absensi, reset sandi,
kenaikan gaji dan notifikasi klaim sales yang sudah memakai Supabase dipertahankan.

## Pengiriman dan pencegahan duplikasi

`sla_ops_outbox` menyimpan kunci kejadian + nomor tujuan secara unik. Worker memakai
lease dengan SKIP LOCKED. Status sumber diverifikasi lagi sebelum mengirim;
pengingat lama menjadi obsolete setelah status/penugasan/follow up berubah.
Penanda berhasil diperbarui hanya setelah provider menerima seluruh penerima.
Penolakan eksplisit dicoba ulang maksimal lima kali dengan backoff. Timeout atau
worker yang berhenti setelah memulai pengiriman ditandai uncertain untuk
pemeriksaan provider, sehingga tidak dikirim ulang secara membabi buta.

`sla_ops_crm_receipts` membuat sinkronisasi setiap transaksi idempoten: percobaan
ulang tidak menambah total transaksi pelanggan dua kali. Pelanggan cabang lain
tidak digabung otomatis. Laporan bug dan batch broadcast juga memiliki ID
permintaan yang unik. Nomor/nama penerima broadcast diverifikasi dari database.

## Migrasi dan pemeriksaan

Migrasi skema/jadwal dipasang sebelum aktivasi. `sla_ops_control.enabled` menjadi
gerbang scanner. Jadwal baru dipasang dalam keadaan nonaktif, lalu diaktifkan
setelah timer GAS lama dihentikan. Kredensial scheduler dibaca langsung dari
Vault `sla_payroll_server_key`; tidak dimasukkan ke source atau browser.

Spreadsheet lama kedua cabang diekspor untuk memeriksa penanda pengiriman.
Snapshot terpilih disimpan pada `private.sla_ops_legacy_archive`; importer hanya
menggabungkan penanda jika identitas, status, penugasan dan tenggat masih cocok.
Data operasional yang lebih baru tidak ditimpa. Empat laporan bug lama diimpor;
URL asli bukti dipertahankan untuk audit, dan gambar yang tersedia disalin ke
Storage. Spreadsheet dan file Drive asli tetap menjadi arsip.

Uji lokal: `node --test tests/operations-supabase.test.cjs tests/legacy-gateway.test.cjs`.
Uji SQL pada `tests/operations-database.sql` harus dijalankan di dalam
BEGIN/ROLLBACK; tidak mengirim WA atau meninggalkan data simulasi.

Endpoint scheduler menyediakan `health` dan `dryRunReminders` untuk pemeriksaan
tanpa pengiriman pesan. Dry run melaporkan jumlah data yang dipindai dan kandidat
per cabang. Produksi diperiksa dengan cara ini sebelum pengalihan, kemudian
hasil eksekusi cron dan respons HTTP diperiksa setelah aktivasi.

Kode `code.js` dan `coderaha.js.txt` disimpan sebagai arsip sumber GAS, bukan
backend frontend yang baru. Jangan memasang kembali trigger lama saat deployment.

## Verifikasi pengalihan 22 Oktober 2026

- Keempat timer GAS dihentikan; daftar Pemicu Saya dan proyek Raha menunjukkan
  nol trigger. Kode, spreadsheet dan dokumen asli tidak dihapus.
- 65 pengujian lulus, termasuk handler scheduler untuk kedua cabang, pembatasan
  sesi/cabang, penolakan provider, hasil ambigu, dan perubahan status sumber.
- Pengujian SQL transaksi membuktikan lease, deduplikasi, CRM idempoten, expiry,
  pemulihan ID klien lama, dan ACL; seluruh data simulasi dibatalkan kembali.
- Dry run produksi memindai 244 tiket Kendari, 42 tiket Raha, 77/6 prospek, dan
  206/38 garansi. Tidak ada kandidat Raha yang jatuh tempo saat pengalihan;
  cabang Raha tetap dipindai oleh seluruh jadwal.
- Snapshot scanner dan guard hanya memuat kolom aturan pengingat, sehingga
  gambar/signature tidak ikut dibaca dan respons tidak melewati statement timeout.
- Cron tiket, penitipan dan worker WA sudah menghasilkan HTTP 200 setelah
  optimasi. Pengiriman produksi diterima provider dan tidak ada entri ganda pada
  kunci kejadian + nomor tujuan.
- Empat laporan bug beserta empat bukti gambar lama sudah tersimpan di Supabase.
  Satu gambar dipulihkan melalui unduhan lokal setelah akses dari Edge gagal,
  lalu bytes hasil baca ulang Storage diverifikasi identik.
- Frontend produksi cocok dengan sumber rilis; tidak memuat URL GAS. Endpoint
  baru dan kompatibilitas menolak sesi kosong (401) dan origin asing (403).
