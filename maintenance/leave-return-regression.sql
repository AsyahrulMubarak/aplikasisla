-- Run after leave-return.sql. Fixtures are rolled back, including on failed assertions.
begin;
do $$
declare
  v_name text := '__SLA_LEAVE_QA_20260910__';
  v_time timestamptz;
begin
  insert into public.pengajuan_cuti(id_pengajuan, waktu_pengajuan, nama_pegawai, role, jenis, tanggal_mulai, tanggal_selesai, status)
  values ('PGJ-LEAVE-QA-IZIN', now(), v_name, 'teknisi', 'Izin', '2026-09-09', '2026-09-13', 'Disetujui');
  insert into public.absensi(id_absen, nama_pegawai, role, waktu_absen, tipe_absen, status_disiplin)
  values ('ABS-LEAVE-QA-AUTO', v_name, 'teknisi', '2026-09-09T08:00:00+08:00', 'Masuk', 'Lupa Absen Masuk');
  select kembali_bekerja_pada into v_time from public.pengajuan_cuti where id_pengajuan = 'PGJ-LEAVE-QA-IZIN';
  assert v_time is null, 'Auto masuk must not end leave';
  insert into public.absensi(id_absen, nama_pegawai, role, waktu_absen, tipe_absen, status_disiplin)
  values ('ABS-LEAVE-QA-REAL', v_name, 'teknisi', '2026-09-10T08:07:05+08:00', 'Masuk', 'Tepat Waktu');
  select kembali_bekerja_pada into v_time from public.pengajuan_cuti where id_pengajuan = 'PGJ-LEAVE-QA-IZIN';
  assert v_time = '2026-09-10T08:07:05+08:00'::timestamptz, 'Real attendance must end leave';
  insert into public.absensi(id_absen, nama_pegawai, role, waktu_absen, tipe_absen, status_disiplin)
  values ('ABS-LEAVE-QA-EARLY', v_name, 'teknisi', '2026-09-09T12:21:27+08:00', 'Masuk Setelah Istirahat', 'Tepat Waktu');
  select kembali_bekerja_pada into v_time from public.pengajuan_cuti where id_pengajuan = 'PGJ-LEAVE-QA-IZIN';
  assert v_time = '2026-09-09T12:21:27+08:00'::timestamptz, 'First real attendance must be used';
  update public.absensi set status_disiplin = 'Koreksi Manual' where id_absen = 'ABS-LEAVE-QA-EARLY';
  select kembali_bekerja_pada into v_time from public.pengajuan_cuti where id_pengajuan = 'PGJ-LEAVE-QA-IZIN';
  assert v_time = '2026-09-10T08:07:05+08:00'::timestamptz, 'Correction must not count as physical attendance';
  assert (select tanggal_selesai from public.pengajuan_cuti where id_pengajuan = 'PGJ-LEAVE-QA-IZIN') = '2026-09-13'::date, 'Original end date preserved';
  insert into public.pengajuan_cuti(id_pengajuan, waktu_pengajuan, nama_pegawai, role, jenis, tanggal_mulai, tanggal_selesai, status)
  values ('PGJ-LEAVE-QA-SAKIT', now(), v_name, 'teknisi', 'Sakit', '2026-09-08', null, 'Menunggu');
  update public.pengajuan_cuti set status = 'Disetujui' where id_pengajuan = 'PGJ-LEAVE-QA-SAKIT';
  select kembali_bekerja_pada into v_time from public.pengajuan_cuti where id_pengajuan = 'PGJ-LEAVE-QA-SAKIT';
  assert v_time = '2026-09-10T08:07:05+08:00'::timestamptz, 'Delayed sick approval must use recorded return';
end $$;
select 'PASS: auto/correction ignored, actual return closes leave, original dates preserved, open-ended sick supported' as regression;

rollback;
