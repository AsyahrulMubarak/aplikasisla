-- Permanent employee bank numbers. Browser roles cannot access this table or RPC.
create table public.sla_rekening_pegawai (
  username text primary key references public.users(username) on update cascade on delete cascade,
  nomor_rekening text not null check (nomor_rekening = '' or nomor_rekening ~ '^[0-9]{1,34}$'),
  diperbarui_pada timestamptz not null default now(),
  diperbarui_oleh uuid not null
);
alter table public.sla_rekening_pegawai enable row level security;
revoke all on table public.sla_rekening_pegawai from public, anon, authenticated;
grant select, insert, update on table public.sla_rekening_pegawai to service_role;

create function public.sla_simpan_rekening_pegawai(
  p_auth_id uuid, p_username text, p_nomor_rekening text, p_nomor_lama text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_role text;
  v_home text;
  v_old text;
begin
  select lower(trim(u.role)), coalesce(
    case when lower(trim(u.hak_akses_cabang)) in ('kendari','raha') then lower(trim(u.hak_akses_cabang)) end,
    case when lower(trim(u.cabang)) in ('kendari','raha') then lower(trim(u.cabang)) end, 'kendari')
    into v_role, v_home from public.users u where u.auth_id = p_auth_id;
  if v_role is null or v_role not in ('admin', 'manager', 'direktur') or (v_role = 'admin' and v_home = 'raha') then
    raise exception 'Nomor rekening hanya dapat diubah Admin Kendari, Manager, atau Direktur.';
  end if;
  if p_nomor_rekening is null or p_nomor_lama is null or
    (p_nomor_rekening <> '' and p_nomor_rekening !~ '^[0-9]{1,34}$') then
    raise exception 'Nomor rekening harus berisi angka, maksimal 34 digit.';
  end if;
  if not exists (select 1 from public.users where username = p_username) then
    raise exception 'Profil pegawai tidak ditemukan. Muat ulang rekap gaji.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sla_rekening:' || p_username, 0));
  select nomor_rekening into v_old from public.sla_rekening_pegawai where username = p_username;
  if coalesce(v_old, '') <> p_nomor_lama then
    raise exception 'Nomor rekening sudah diubah pengguna lain. Klik Proses Data untuk memuat nomor terbaru sebelum menyimpan.';
  end if;
  insert into public.sla_rekening_pegawai(username, nomor_rekening, diperbarui_pada, diperbarui_oleh)
    values (p_username, p_nomor_rekening, pg_catalog.now(), p_auth_id)
    on conflict (username) do update set nomor_rekening = excluded.nomor_rekening,
      diperbarui_pada = excluded.diperbarui_pada, diperbarui_oleh = excluded.diperbarui_oleh;
  return pg_catalog.jsonb_build_object('status', 'sukses', 'data',
    pg_catalog.jsonb_build_object('username', p_username, 'nomorRekening', p_nomor_rekening));
end;
$$;
revoke all on function public.sla_simpan_rekening_pegawai(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.sla_simpan_rekening_pegawai(uuid, text, text, text) to service_role;
