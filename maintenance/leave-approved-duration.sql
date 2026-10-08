begin;

-- tanggal_selesai remains the employee's requested end date for audit/history.
alter table public.pengajuan_cuti
  add column if not exists tanggal_selesai_disetujui date;

comment on column public.pengajuan_cuti.tanggal_selesai_disetujui is
  'Tanggal akhir izin yang disetujui manajemen, inklusif. NULL pada izin lama berarti seluruh rentang diajukan.';

do $$
begin
  if not exists (select 1 from pg_constraint
    where conrelid = 'public.pengajuan_cuti'::regclass and conname = 'sla_izin_durasi_disetujui_valid') then
    alter table public.pengajuan_cuti add constraint sla_izin_durasi_disetujui_valid check (
      tanggal_selesai_disetujui is null or coalesce(
        jenis = 'Izin' and status = 'Disetujui'
        and tanggal_selesai_disetujui between tanggal_mulai and tanggal_selesai, false)
    );
  end if;
end;
$$;

-- Keep the existing return-to-work policy, using the approved end for leave.
create or replace function public.sla_sinkron_kembali_pengajuan(p_nama text)
returns void language sql security definer set search_path = pg_catalog, public as $$
  update public.pengajuan_cuti p
  set kembali_bekerja_pada = public.sla_waktu_kembali_pengajuan(p.nama_pegawai, p.tanggal_mulai,
    case when p.jenis = 'Sakit' then null else coalesce(p.tanggal_selesai_disetujui, p.tanggal_selesai) end)
  where p.nama_pegawai = p_nama and p.status = 'Disetujui'
    and p.kembali_bekerja_pada is distinct from public.sla_waktu_kembali_pengajuan(p.nama_pegawai, p.tanggal_mulai,
      case when p.jenis = 'Sakit' then null else coalesce(p.tanggal_selesai_disetujui, p.tanggal_selesai) end);
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
    then public.sla_waktu_kembali_pengajuan(NEW.nama_pegawai, NEW.tanggal_mulai,
      case when NEW.jenis = 'Sakit' then null else coalesce(NEW.tanggal_selesai_disetujui, NEW.tanggal_selesai) end)
    else null end;
  return NEW;
end;
$$;

-- These are internal trigger functions; browser roles cannot execute them.
revoke all on function public.sla_sinkron_kembali_pengajuan(text) from public, anon, authenticated;
revoke all on function public.sla_pengajuan_tetapkan_kembali() from public, anon, authenticated;
grant execute on function public.sla_sinkron_kembali_pengajuan(text) to service_role;

drop trigger if exists sla_pengajuan_kembali on public.pengajuan_cuti;
create trigger sla_pengajuan_kembali
before insert or update of status, nama_pegawai, jenis, tanggal_mulai, tanggal_selesai, tanggal_selesai_disetujui
on public.pengajuan_cuti for each row execute function public.sla_pengajuan_tetapkan_kembali();

notify pgrst, 'reload schema';
commit;
