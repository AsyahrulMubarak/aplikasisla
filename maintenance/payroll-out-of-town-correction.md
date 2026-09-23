# Pengecualian kuota koreksi pada tanggal Luar Kota

Perubahan 23 September 2026 menghubungkan kolom **Tgl Luar Kota (Pokok x2)**
pada Slip Gaji dengan batas tujuh koreksi absensi bulanan.

- Slip Gaji tetap menyimpan komponen payroll pada backend payroll yang sama.
- Setelah data bulan berjalan dimuat atau disimpan, akun Manajemen menyinkronkan
  nama pegawai dan daftar tanggal Luar Kota ke backend Absensi.
- Backend Absensi menyimpan daftar per periode dan per pegawai pada Script
  Properties. Nama pada kunci disamarkan dengan SHA-256.
- Saat menghitung pemakaian kuota, hanya baris `Koreksi Manual` pada tanggal yang
  bukan Luar Kota yang dihitung.
- Koreksi lama pada tanggal yang kemudian ditandai Luar Kota juga dikeluarkan
  dari jumlah kuota ketika pemeriksaan berikutnya dilakukan.
- Sinkronisasi ditolak untuk periode selain bulan berjalan dan hanya dapat
  dipanggil oleh akun yang memiliki hak kelola absensi.

Perhitungan pokok x2, tarif, jam kerja, data absensi, dan batas tujuh koreksi
normal tidak diubah. Jika sinkronisasi gagal setelah komponen payroll berhasil
disimpan, antarmuka menjelaskan bahwa data payroll sudah aman dan meminta Admin
menekan tombol Simpan kembali.

Fungsi backend yang diuji disalin ke `attendance-out-of-town-quota.gs`. Sumber
produksi tetap berada pada project Apps Script Absensi.
