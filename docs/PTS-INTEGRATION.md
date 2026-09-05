# Integrasi PTS dengan portal Alfacom

PTS dibuka dari lobby pada origin Vercel yang sama, memakai sesi login Alfacom yang sudah ada. PTS tidak menyediakan username/password kedua. Server menerima hanya role `admin`, `manager`, dan `direktur` dari profil Supabase yang cocok dengan identitas Auth; `admin_raha` tidak termasuk.

## Batas perubahan

- `index.html`: tombol PTS dan pembuka halaman setelah pemeriksaan sesi yang sudah tersedia.
- `pts.html` dan `assets/pts-session.js`: tampilan PTS asli, dengan transport API dan sesi portal. Rumus target, bonus kumulatif, komisi, dan payload tidak diubah.
- `/api/pts`: pemeriksaan Auth/profil dan tanda tangan HMAC untuk backend PTS.
- `server/pts/Code.gs` dan `Data.gs`: khusus project Apps Script PTS. Tidak dipasang di project SLA, absensi, atau slip gaji.
- Absensi, slip gaji, service worker, manifest, dan fungsi login/routing portal dilindungi uji regresi terhadap produksi awal `92d05b6`.

## Pengaktifan bertahap

1. Pastikan editor Apps Script benar-benar project yang melayani URL PTS lama, lalu simpan salinan kode, daftar deployment aktif, Script Properties, dan spreadsheet sebelum mengubahnya. Cocokkan nama/header sheet dengan database PTS. Jangan memakai ID spreadsheet SLA atau membuat database kosong sebagai pengganti data PTS.
2. Verifikasi di Supabase bahwa pengguna biasa tidak dapat mengubah `users.role`, memalsukan `username`/`username_login`, atau membuat profil istimewa. Pemeriksaan role API bergantung pada integritas tabel profil ini. Jangan mengubah policy portal tanpa menilai dampaknya pada modul yang sudah berjalan.
3. Uji backend pada salinan database PTS terlebih dahulu dengan secret khusus preview. Pasang `Code.gs` dan `Data.gs` sebagai dua file script; semua fungsi script lama yang publik harus dihapus/diganti agar login/RPC lama tidak menjadi jalan masuk lain. Jangan hanya menambahkan file baru di samping backend lama.
4. Pada Script Properties PTS, isi `PTS_SPREADSHEET_ID` dengan ID database PTS yang telah diverifikasi dan `PTS_BRIDGE_SECRET` dengan secret acak minimal 32 byte (64 karakter hex). Simpan secret yang sama hanya di Environment Variables Vercel. Jangan menaruhnya di HTML, Git, URL, atau chat.
5. Deploy backend PTS versi baru sebagai web app yang dapat menerima POST dari server Vercel, berjalan sebagai pemilik database. Handler hanya menerima permintaan bertanda tangan. Tinjau akses Google yang diminta sebelum menyetujui. Seluruh deployment lama yang masih membuka login/RPC PTS harus diperbarui atau diarsipkan ketika perpindahan dilakukan.
6. Di Vercel Preview, konfigurasi `PTS_GAS_URL` ke backend uji, `PTS_BRIDGE_SECRET` ke secret uji, dan terakhir `PTS_ENABLED=true`, lalu redeploy. Gunakan URL deployment yang tepat untuk pengujian origin. Tanpa konfigurasi ini API menolak permintaan dengan `PTS_NOT_READY` dan tidak menghubungi database.
7. Uji masuk melalui portal dengan Admin, Manager, Direktur; coba peran yang dilarang, URL langsung tanpa sesi, sesi kedaluwarsa, kembali ke lobby, serta simpan/baca/hapus skenario uji pada salinan database. Pastikan data skenario lama tetap terbaca dan modul portal lain tetap normal. Uji hapus browser harus dilakukan dengan data uji yang boleh dibuang.
8. Setelah backend dan izin terverifikasi, pasang versi yang sama pada project/database PTS asli, gunakan secret produksi terpisah, dan konfigurasi Environment Variables **Production**. Publikasikan perubahan portal ke `main` setelah seluruh uji produksi yang tidak menulis data lulus.

## Konfigurasi Vercel

| Variabel | Kegunaan |
| --- | --- |
| `PTS_ENABLED` | `true` hanya ketika konfigurasi dan pengujian selesai; selain itu akses data PTS ditolak |
| `PTS_GAS_URL` | URL HTTPS `/macros/s/.../exec` backend PTS yang benar |
| `PTS_BRIDGE_SECRET` | Secret HMAC, harus sama dengan Script Properties PTS pada lingkungan yang sesuai |

Build memakai `node scripts/build-public.cjs`; hanya delapan aset browser yang disalin ke `public`. Kode backend, pengujian, dan dokumentasi tidak diterbitkan sebagai aset statis. Fungsi `/api/pts` dijalankan oleh Vercel. Jangan mengisi variabel dengan prefix publik seperti `NEXT_PUBLIC_`.

`PTS_DEV_ORIGIN` hanya untuk server lokal nonproduksi. Origin produksi yang diizinkan adalah `https://aplikasisla.vercel.app`; penambahan domain portal perlu penyesuaian allowlist. API juga menerima origin URL deployment dari `VERCEL_URL`.

## Verifikasi dan pemulihan

Jalankan `npm test` dan `npm run build` dari root checkout ini. Pengujian memakai data tiruan, tanpa mengubah Supabase atau spreadsheet produksi. Hasil lokal bukan bukti konfigurasi layanan produksi sudah benar.

Permintaan bertanda tangan memiliki waktu kedaluwarsa dan perlindungan replay. Penulisan memakai ID operasi yang disimpan di sheet `PTS_Operations`, sehingga mencoba kembali data yang sama tidak menggandakan skenario. Simpan yang terputus disembunyikan dari riwayat sampai retry berhasil. Sheet ini dan property nonce tidak boleh dihapus saat ada operasi berjalan.

Jika terjadi masalah, ubah `PTS_ENABLED=false` dan redeploy lingkungan terkait untuk menutup API PTS. Portal lain tetap tersedia. Untuk membatalkan tampilan portal, rollback deployment Vercel ke versi sebelum integrasi. Jangan otomatis menghidupkan kembali login PTS lama. Pemulihan data harus memakai backup yang telah diverifikasi dan mempertimbangkan penulisan setelah backup.

## Status pekerjaan

Kode dan pengujian lokal tersedia. Pengujian browser lokal sudah memeriksa kalkulator, komisi, simpan/baca riwayat, penolakan peran, dan pengalihan tanpa sesi ke login portal. Uji hapus backend lulus dengan data tiruan; konfirmasi hapus browser belum diselesaikan.

Belum ada perubahan pada backend/spreadsheet PTS, konfigurasi Supabase, atau produksi portal. Aktivasi menunggu tautan editor Apps Script PTS dan spreadsheet PTS, pemeriksaan policy profil, serta pengujian integrasi layanan sebenarnya.
