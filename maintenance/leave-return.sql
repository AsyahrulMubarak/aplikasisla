begin;

alter table public.pengajuan_cuti
  alter column tanggal_selesai drop not null,
  add column if not exists kembali_bekerja_pada timestamptz;

comment on column public.pengajuan_cuti.kembali_bekerja_pada is
  'Absen masuk nyata pertama dalam rentang pengajuan. Rentang awal tetap disimpan untuk riwayat.';

create or replace function public.sla_waktu_kembali_pengajuan(
  p_nama text, p_mulai date, p_selesai date
) returns timestamptz
language sql stable set search_path = pg_catalog, public as $$
  select min(a.waktu_absen)
  from public.absensi a
  where a.nama_pegawai = p_nama
    and a.tipe_absen in ('Masuk', 'Masuk Setelah Istirahat')
    and coalesce(a.status_disiplin, '') not ilike '%Lupa Absen Masuk%'
    and coalesce(a.status_disiplin, '') not ilike '%Koreksi%'
    and coalesce(a.status_disiplin, '') not ilike '%Auto%'
    and a.waktu_absen >= (p_mulai::timestamp at time zone 'Asia/Makassar')
    and (p_selesai is null or a.waktu_absen < ((p_selesai + 1)::timestamp at time zone 'Asia/Makassar'));
$$;

create or replace function public.sla_sinkron_kembali_pengajuan(p_nama text)
returns void language sql security definer set search_path = pg_catalog, public as $$
  update public.pengajuan_cuti p
  set kembali_bekerja_pada = public.sla_waktu_kembali_pengajuan(p.nama_pegawai, p.tanggal_mulai, p.tanggal_selesai)
  where p.nama_pegawai = p_nama and p.status = 'Disetujui'
    and p.kembali_bekerja_pada is distinct from public.sla_waktu_kembali_pengajuan(p.nama_pegawai, p.tanggal_mulai, p.tanggal_selesai);
$$;

create or replace function public.sla_absensi_sinkron_pengajuan()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if TG_OP <> 'INSERT' then
    if OLD.tipe_absen in ('Masuk', 'Masuk Setelah Istirahat') then
      perform public.sla_sinkron_kembali_pengajuan(OLD.nama_pegawai);
    end if;
  end if;
  if TG_OP <> 'DELETE' then
    if NEW.tipe_absen in ('Masuk', 'Masuk Setelah Istirahat') then
      perform public.sla_sinkron_kembali_pengajuan(NEW.nama_pegawai);
    end if;
  end if;
  return null;
end;
$$;

create or replace function public.sla_pengajuan_tetapkan_kembali()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if NEW.jenis not in ('Sakit', 'Izin') or NEW.tanggal_mulai is null then
    raise exception 'Jenis dan tanggal mulai pengajuan wajib valid.';
  end if;
  if (NEW.jenis = 'Izin' and NEW.tanggal_selesai is null)
    or NEW.tanggal_selesai < NEW.tanggal_mulai then
    raise exception 'Rentang tanggal pengajuan tidak valid.';
  end if;
  NEW.kembali_bekerja_pada := case when NEW.status = 'Disetujui'
    then public.sla_waktu_kembali_pengajuan(NEW.nama_pegawai, NEW.tanggal_mulai, NEW.tanggal_selesai)
    else null end;
  return NEW;
end;
$$;

revoke all on function public.sla_waktu_kembali_pengajuan(text,date,date) from public, anon, authenticated;
revoke all on function public.sla_sinkron_kembali_pengajuan(text) from public, anon, authenticated;
revoke all on function public.sla_absensi_sinkron_pengajuan() from public, anon, authenticated;
revoke all on function public.sla_pengajuan_tetapkan_kembali() from public, anon, authenticated;
grant execute on function public.sla_waktu_kembali_pengajuan(text,date,date) to service_role;
grant execute on function public.sla_sinkron_kembali_pengajuan(text) to service_role;

drop trigger if exists sla_absensi_kembali_pengajuan on public.absensi;
create trigger sla_absensi_kembali_pengajuan
after insert or delete or update of waktu_absen, nama_pegawai, tipe_absen, status_disiplin
on public.absensi for each row execute function public.sla_absensi_sinkron_pengajuan();

drop trigger if exists sla_pengajuan_kembali on public.pengajuan_cuti;
create trigger sla_pengajuan_kembali
before insert or update of status, nama_pegawai, tanggal_mulai, tanggal_selesai
on public.pengajuan_cuti for each row execute function public.sla_pengajuan_tetapkan_kembali();

-- Rekonsiliasi riwayat lama; tidak menghapus atau mengubah absensi nyata/rentang awal.
update public.pengajuan_cuti p
set kembali_bekerja_pada = public.sla_waktu_kembali_pengajuan(p.nama_pegawai, p.tanggal_mulai, p.tanggal_selesai)
where p.status = 'Disetujui'
  and p.kembali_bekerja_pada is distinct from public.sla_waktu_kembali_pengajuan(p.nama_pegawai, p.tanggal_mulai, p.tanggal_selesai);

notify pgrst, 'reload schema';
commit;
