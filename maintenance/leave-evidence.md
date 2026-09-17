# Foto pengajuan dan kontak WhatsApp

Antrean approval dan riwayat pengajuan menampilkan tombol **Lihat Foto Lampiran**. Tautan hanya dibuat untuk HTTP/HTTPS, atribut di-escape, dan tab baru memakai `noopener noreferrer`. Pengajuan lama tanpa foto menampilkan keterangan tanpa tautan.

Notifikasi WA mencantumkan nomor pengaju beserta tautan `https://wa.me/<nomor>`. Nomor dibaca dari profil pengaju yang diverifikasi backend (`users.no_wa`), bukan nomor yang dikirim frontend. Format 08 dinormalisasi ke 628. Jika nomor tidak tersedia atau tidak layak, pesan menampilkan “WA Pengaju: belum terdaftar”.

Daftar penerima dan aturan approval tidak berubah: admin Kendari kepada direktur/manager, manager kepada direktur/admin Kendari, pegawai lainnya mengikuti kebijakan sebelumnya.

Backend berubah hanya pada penambahan nomor profil dan teks pesan. Terapkan `leave-evidence-backend.patch` pada versi backend yang telah dicadangkan; jangan mengganti konfigurasi privat atau fungsi lain.

Uji: `node --test tests/leave-approval-routing.test.cjs tests/leave-evidence.test.cjs`. Environment `LEAVE_APPROVAL_SOURCE` dapat diarahkan ke backend lengkap untuk verifikasi fungsi produksi.
