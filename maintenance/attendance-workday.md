# Tanggal kerja absensi

Absen Keluar/Pulang sebelum 06:00 WITA menutup tanggal kerja sebelumnya. Contoh: keluar 2 Oktober 02:49 merupakan penutup kerja 1 Oktober dan tidak menghalangi Masuk 2 Oktober pagi.

Jalankan `attendance-workday.sql` di SQL Editor Supabase. Patch menyamakan pemeriksaan status terakhir database dengan `workDay` di Edge Function. Penguncian pegawai, cabang, tanggal kerja, dan penolakan permintaan dengan data lama tetap berlaku. Patch tidak mengubah catatan absensi atau hak akses.

Deploy `supabase/functions/sla-payroll-attendance/index.ts` agar Tinjauan Absensi juga menggunakan tanggal kerja. Keluar dini hari tampil pada slot keluar terakhir dari tanggal kerja sebelumnya.

Uji regresi: `node --test tests/attendance-workday.test.cjs maintenance/attendance-workday-database.test.cjs`.
