-- Align optimistic attendance locking with the Edge work-day rule.
-- Overnight exits before 06:00 WITA close the preceding work day.
-- No attendance records or privileges are changed.
begin;
CREATE OR REPLACE FUNCTION public.sla_insert_absensi_batch(p_employee text, p_work_day date, p_expected_last text, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_last text;
  v_branch text;
  v_written integer;
begin
  if p_employee is null or p_work_day is null or jsonb_typeof(p_rows) <> 'array'
      or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 100 then
    raise exception 'Batch absensi tidak valid';
  end if;
  v_branch := p_rows->0->>'cabang';
  if v_branch is null or v_branch not in ('Kendari', 'Raha') or exists (
    select 1 from jsonb_to_recordset(p_rows) as x(cabang text)
    where x.cabang is distinct from v_branch
  ) then
    raise exception 'Cabang batch absensi tidak valid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sla-absen:' || v_branch || ':' || lower(p_employee) || ':' || p_work_day::text, 0));
  select id_absen into v_last from public.absensi
   where nama_pegawai = p_employee
     and (case when v_branch = 'Raha' then cabang = 'Raha'
               else coalesce(cabang, 'Kendari') = 'Kendari' end)
     and waktu_absen >= (p_work_day::text || 'T00:00:00+08:00')::timestamptz
     and waktu_absen < ((p_work_day + 1)::text || 'T06:00:00+08:00')::timestamptz
     and (case
       when tipe_absen ~ '(Keluar|Pulang)'
         and (waktu_absen at time zone 'Asia/Makassar')::time < time '06:00:00'
       then (waktu_absen at time zone 'Asia/Makassar')::date - 1
       else (waktu_absen at time zone 'Asia/Makassar')::date
     end) = p_work_day
   order by waktu_absen desc, id_absen desc limit 1;
  if coalesce(v_last, '') <> coalesce(p_expected_last, '') then
    raise exception 'Data absensi berubah; muat ulang lalu coba lagi';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as x(nama_pegawai text)
             where x.nama_pegawai is distinct from p_employee) then
    raise exception 'Batch memuat pegawai lain';
  end if;
  insert into public.absensi
    (id_absen,waktu_absen,nama_pegawai,role,tipe_absen,jarak_meter,status_disiplin,keterangan,bukti_foto,lokasi_maps,cabang)
  select x.id_absen,x.waktu_absen,x.nama_pegawai,x.role,x.tipe_absen,x.jarak_meter,
         x.status_disiplin,x.keterangan,x.bukti_foto,x.lokasi_maps,x.cabang
    from jsonb_to_recordset(p_rows) as x(
      id_absen text,waktu_absen timestamptz,nama_pegawai text,role text,tipe_absen text,
      jarak_meter numeric,status_disiplin text,keterangan text,bukti_foto text,lokasi_maps text,cabang text
    )
  on conflict (id_absen) do nothing;
  get diagnostics v_written = row_count;
  return v_written;
end;
$function$;
commit;
