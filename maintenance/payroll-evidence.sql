-- Private PDFs, one current document per employee, payroll month and component.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sla-payroll-private', 'sla-payroll-private', false, 5242880, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.sla_bukti_payroll (
  id uuid primary key,
  username text not null references public.users(username) on update cascade on delete restrict,
  periode text not null check (periode ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  jenis text not null check (jenis in ('fee_marketing', 'kasbon')),
  object_path text not null unique,
  nama_file text not null check (length(nama_file) between 5 and 180 and nama_file ~* '\.pdf$'),
  ukuran_byte integer not null check (ukuran_byte between 1 and 5242880),
  diperbarui_pada timestamptz not null default now(),
  diperbarui_oleh uuid not null,
  unique (username, periode, jenis)
);
alter table public.sla_bukti_payroll enable row level security;
create policy sla_bukti_payroll_server on public.sla_bukti_payroll for all to service_role using (true) with check (true);
revoke all on table public.sla_bukti_payroll from public, anon, authenticated;
grant select, insert, update, delete on table public.sla_bukti_payroll to service_role;
-- No browser Storage policies: verified Edge handlers provide short-lived links.

create function public.sla_simpan_bukti_payroll(
  p_auth_id uuid, p_username text, p_periode text, p_jenis text, p_id uuid,
  p_id_lama text, p_object_path text, p_nama_file text, p_ukuran_byte integer, p_hapus boolean
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_actor public.users%rowtype;
  v_target public.users%rowtype;
  v_old public.sla_bukti_payroll%rowtype;
  v_saved public.sla_bukti_payroll%rowtype;
  v_home text;
  v_month date;
begin
  select * into strict v_actor from public.users where auth_id = p_auth_id;
  v_home := coalesce(
    case when lower(trim(v_actor.hak_akses_cabang)) in ('kendari', 'raha') then lower(trim(v_actor.hak_akses_cabang)) end,
    case when lower(trim(v_actor.cabang)) in ('kendari', 'raha') then lower(trim(v_actor.cabang)) end, 'kendari');
  if coalesce(lower(trim(v_actor.role)), '') not in ('admin', 'manager', 'direktur') or
     (lower(trim(v_actor.role)) = 'admin' and v_home = 'raha') or
     (lower(trim(v_actor.role)) <> 'direktur' and coalesce(v_actor.gaji_pokok, 0) <= 0) then
    raise exception 'Bukti payroll hanya dapat diubah Admin Kendari, Manager, atau Direktur.';
  end if;
  if p_periode is null or p_periode !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or
     p_jenis is null or p_jenis not in ('fee_marketing', 'kasbon') or p_id_lama is null or p_hapus is null then
    raise exception 'Periode, jenis, atau versi bukti payroll tidak valid.';
  end if;
  v_month := (p_periode || '-01')::date;
  if (pg_catalog.now() at time zone 'Asia/Makassar')::date >= (v_month + interval '1 month 5 days')::date then
    raise exception 'Periode payroll telah dikunci setelah masa tenggang 5 hari.';
  end if;
  select * into strict v_target from public.users where username = p_username;
  if lower(trim(coalesce(nullif(trim(v_target.hak_akses_cabang), ''), v_target.cabang, ''))) not in ('kendari', 'raha', 'semua') then
    raise exception 'Cabang bukti payroll tidak valid.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sla_bukti:' || p_username || ':' || p_periode || ':' || p_jenis, 0));
  select * into v_old from public.sla_bukti_payroll where username = p_username and periode = p_periode and jenis = p_jenis;
  if coalesce(v_old.id::text, '') <> p_id_lama then
    raise exception 'Bukti sudah diubah pengguna lain. Muat ulang bukti sebelum mengubahnya.';
  end if;
  if p_hapus then
    if v_old.id is null then raise exception 'Bukti yang akan dihapus tidak ditemukan.'; end if;
    delete from public.sla_bukti_payroll where id = v_old.id;
    return pg_catalog.jsonb_build_object('status', 'sukses', 'idTerhapus', v_old.id, 'objectPathLama', v_old.object_path);
  end if;
  if p_id is null or p_object_path is null or
     p_object_path <> p_username || '/' || p_periode || '/' || p_jenis || '/' || p_id::text || '.pdf' or
     p_nama_file is null or length(p_nama_file) not between 5 and 180 or p_nama_file !~* '\.pdf$' or
     p_ukuran_byte is null or p_ukuran_byte not between 1 and 5242880 then
    raise exception 'Metadata PDF tidak valid.';
  end if;
  insert into public.sla_bukti_payroll (id, username, periode, jenis, object_path, nama_file, ukuran_byte, diperbarui_oleh)
    values (p_id, p_username, p_periode, p_jenis, p_object_path, p_nama_file, p_ukuran_byte, p_auth_id)
    on conflict (username, periode, jenis) do update set id = excluded.id, object_path = excluded.object_path,
      nama_file = excluded.nama_file, ukuran_byte = excluded.ukuran_byte,
      diperbarui_pada = pg_catalog.now(), diperbarui_oleh = excluded.diperbarui_oleh
    returning * into v_saved;
  return pg_catalog.jsonb_build_object('status', 'sukses', 'data', pg_catalog.to_jsonb(v_saved), 'objectPathLama', v_old.object_path);
end;
$$;
revoke all on function public.sla_simpan_bukti_payroll(uuid, text, text, text, uuid, text, text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.sla_simpan_bukti_payroll(uuid, text, text, text, uuid, text, text, text, integer, boolean) to service_role;
