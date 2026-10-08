# Pelacakan klien dan Berita Acara di Supabase

Halaman `?track=ID_TIKET` memakai Edge Function `sla-client-tracking` untuk verifikasi pelanggan, status perbaikan, garansi, dan tautan BA. Pembuatan BA baru mengambil data yang sudah tersimpan di tiket, membuat PDF di Edge, lalu menyimpan dokumen di bucket privat `sla-ticket-documents`.

## Akses

- Pelanggan memasukkan nomor WhatsApp yang cocok setelah normalisasi 0/62, atau nama lengkap yang sama dengan Nama Customer/Klien & Lokasi. Pencocokan nama parsial tidak digunakan.
- Respons publik hanya berisi satu tiket yang telah diverifikasi dan garansi miliknya; nomor WA, tanda tangan mentah, nilai penjualan, poin, serta catatan internal tiket tidak dikirim.
- Tautan unduhan bertahan 15 menit. Halaman memperbarui data setiap 60 detik melalui Supabase.
- Pegawai membuka BA dengan JWT Supabase. Role, cabang, dan penugasan teknisi diverifikasi dari profil server. Sales dapat membaca, tetapi tidak membuat BA.
- Tabel dokumen, audit migrasi, pembatasan percobaan, dan RPC penulisan tidak dapat diakses anon/authenticated. Storage tidak memiliki kebijakan baca publik.
- `verify_jwt=false` diperlukan untuk pelacakan pelanggan tanpa login; setiap aksi dokumen pegawai tetap memverifikasi JWT, dan migrasi hanya menerima credential layanan server.

## Dokumen

- `tiket.link_pdf_ba` menyimpan referensi `storage:ba/ID_TIKET/UUID.pdf`.
- PDF memakai `npm:pdf-lib@1.17.1`, logo lokal dalam bundel, data tiket tersimpan, waktu WITA, dan tanda tangan pelanggan.
- Upload diverifikasi ulang dengan SHA-256 sebelum referensi diubah. RPC membandingkan tautan sebelumnya dan snapshot BA untuk mencegah dokumen lama menimpa revisi baru.
- Permintaan ulang BA dengan snapshot yang sama menggunakan dokumen yang sudah ada.
- PDF lama di Drive disalin tanpa mengubah bytes. URL sumber dan checksum tetap tercatat pada tabel audit. Aslinya tetap tersedia untuk pemulihan.

## Penerapan dan pemeriksaan

1. Terapkan migration `client_tracking_supabase`, lalu `client_tracking_document_guards`.
2. Deploy seluruh file `supabase/functions/sla-client-tracking/`.
3. Migrasikan dokumen lama melalui aksi server `migrateLegacyDocuments`, empat tiket per batch, maksimal tiga percobaan per sumber yang gagal.
4. Terbitkan perubahan index.html. Jalur pelacakan/BA tidak memakai Google Apps Script.

Pemeriksaan: `node --test tests/client-tracking-supabase.test.cjs tests/client-tracking-database.test.cjs tests/warranty-tracking.test.cjs tests/ticket-filters.test.cjs tests/sla-assignment.test.cjs`.

Verifikasi rilis 8 Oktober 2026: 162 dokumen lama disalin, nol kegagalan, bucket privat, 235 tiket tetap ada. Fingerprint seluruh kolom selain link_pdf_ba sebelum/sesudah identik (`d7a764c2f5925239fa706933dd4f6607`). Pengujian layanan aktif mencakup Auth, BA baru, checksum, retry, identitas salah, akses anonim, unduhan dokumen lama, dan TKT-186 tanpa garansi. Data simulasi Auth/profil/tiket/dokumen sudah dibersihkan.

Rollback frontend harus tetap memakai akses unduhan dokumen Supabase karena referensi tiket sudah berubah. Tautan Drive asli tersedia pada audit migrasi dan cadangan lokal; jangan menimpa referensi BA yang telah direvisi setelah migrasi.
