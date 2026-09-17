# Foto absensi dan sinkronisasi prospek dari tiket

Slip gaji dan tinjauan absensi menampilkan setiap foto yang tersedia dengan label jenis absen dan waktu. Foto yang sama pada satu hari/pegawai dideduplikasi. URL selain HTTP/HTTPS tidak menjadi tautan. Kolom `Bukti Foto` ditambahkan di akhir respons payroll; indeks kolom lama, pembatasan data pengguna, perhitungan jam, upah, penalti, dan lembur tetap dipertahankan.

Backend penuh dicadangkan lokal sebelum patch `attendance-photo-backend.patch` diterapkan. Backend KPI/Worker diserahkan untuk unggah manual sesuai `kpi-manual-upload.md`; keduanya terpisah dari backend absensi.

Penyebab prospek tertinggal:

- Pemanggil sinkronisasi membaca `WA Klien`, sedangkan data tiket memakai `No WA Klien`.
- Nama panggilan prospek bisa berbeda dari nama klien tiket.
- Filter lama hanya memproses Tahap Penawaran/Kunjungan Toko, sehingga status On Progress/Pending tidak mengikuti penyelesaian berikutnya.

Sinkronisasi tiket kini membaca ulang tiket tersimpan berdasarkan ID dan cabang. Nomor WA dan cabang harus cocok, sales harus sama (atau nama wajib sama jika tiket tidak memiliki sales), dan prospek tidak boleh dibuat setelah tiket. Nama yang sama diprioritaskan; nama berbeda dapat dipasangkan hanya bila kandidat tunggal. Kandidat ambigu tidak diubah. Status nonfinal On Progress/Pending/Proses Servis ikut diproses; Closing, Batal, dan Tanpa Keterangan dipertahankan.

PATCH prospek memakai kondisi status semula dan cabang untuk tidak menimpa perubahan yang mendahului pembaruan. Status yang sudah sama tidak ditulis ulang atau mengirim notifikasi ulang. Alur penjualan langsung tetap memakai aturan pencocokan sebelumnya.

Kasus yang dilaporkan: TKT-148 terverifikasi Selesai dan satu kandidat PRP-057 cocok. PRP-057 diperbaiki dari Tahap Penawaran menjadi Closing / Deal, dibatasi ID/cabang/nilai lama; hasil dibaca ulang. Tidak ada WA tambahan yang dikirim untuk perbaikan data ini.
