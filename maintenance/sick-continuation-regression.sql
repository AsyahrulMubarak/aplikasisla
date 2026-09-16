-- Run after sick-continuation.sql. No test records are committed.
begin;
do $$
declare
  v_name text := '__SLA_SICK_QA_20260916__';
  v_time timestamptz;
begin
  insert into public.pengajuan_cuti(id_pengajuan,waktu_pengajuan,nama_pegawai,role,jenis,tanggal_mulai,tanggal_selesai,status)
  values ('PGJ-SICK-QA-OLD',now(),v_name,'teknisi','Sakit','2026-09-12','2026-09-12','Disetujui');
  insert into public.absensi(id_absen,nama_pegawai,role,waktu_absen,tipe_absen,status_disiplin)
  values ('ABS-SICK-QA-AUTO',v_name,'teknisi','2026-09-14T08:00:00+08:00','Masuk','Lupa Absen Masuk (Auto)');
  select kembali_bekerja_pada into v_time from public.pengajuan_cuti where id_pengajuan='PGJ-SICK-QA-OLD';
  assert v_time is null, 'Autofill is not a physical return';
  insert into public.absensi(id_absen,nama_pegawai,role,waktu_absen,tipe_absen,status_disiplin)
  values ('ABS-SICK-QA-RETURN',v_name,'teknisi','2026-09-16T08:07:00+08:00','Masuk','Tepat Waktu');
  select kembali_bekerja_pada into v_time from public.pengajuan_cuti where id_pengajuan='PGJ-SICK-QA-OLD';
  assert v_time='2026-09-16T08:07:00+08:00'::timestamptz, 'Old bounded sickness must detect return after original end';
  assert (select tanggal_selesai from public.pengajuan_cuti where id_pengajuan='PGJ-SICK-QA-OLD')='2026-09-12'::date, 'History must stay unchanged';
  insert into public.pengajuan_cuti(id_pengajuan,waktu_pengajuan,nama_pegawai,role,jenis,tanggal_mulai,tanggal_selesai,status)
  values ('PGJ-SICK-QA-IZIN',now(),v_name,'teknisi','Izin','2026-09-12','2026-09-12','Disetujui');
  select kembali_bekerja_pada into v_time from public.pengajuan_cuti where id_pengajuan='PGJ-SICK-QA-IZIN';
  assert v_time is null, 'Regular leave keeps its end date';
  update public.absensi set status_disiplin='Koreksi Manual' where id_absen='ABS-SICK-QA-RETURN';
  select kembali_bekerja_pada into v_time from public.pengajuan_cuti where id_pengajuan='PGJ-SICK-QA-OLD';
  assert v_time is null, 'Corrections do not close sickness';
end $$;
select 'PASS: old sickness continues until actual return; original end date and regular leave preserved' as regression;
rollback;
