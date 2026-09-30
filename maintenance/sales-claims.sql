-- Jalankan di Supabase sebelum memperbarui backend dan frontend SLA.
-- RPC hanya untuk backend service_role; identitas berasal dari sesi terverifikasi.
begin;

alter table public.tiket
  add column if not exists klaim_sales_id uuid,
  add column if not exists klaim_sales_username text,
  add column if not exists klaim_sales_diajukan_pada timestamptz,
  add column if not exists klaim_sales_diputuskan_pada timestamptz,
  add column if not exists klaim_sales_admin text;

-- Riwayat lama dipertahankan. Nama ambigu tidak ditebak menjadi akun pengaju.
update public.tiket t set klaim_sales_id = gen_random_uuid()
where status_banding in ('Diajukan', 'Diterima', 'Ditolak') and klaim_sales_id is null;
update public.tiket t set klaim_sales_username = (
  select min(u.username_login) from public.users u
  where lower(btrim(u.role)) = 'sales'
    and lower(btrim(u.nama_asli)) = lower(btrim(t.sales_pengaju))
  having count(*) = 1
)
where t.klaim_sales_id is not null and t.klaim_sales_username is null;

create table if not exists public.sla_notif_klaim_sales (
  id uuid primary key default gen_random_uuid(),
  klaim_id uuid not null,
  jenis text not null check (jenis in ('Diajukan', 'Diterima', 'Ditolak')),
  penerima_username text not null,
  snapshot jsonb not null,
  dibuat_pada timestamptz not null default now(),
  terkirim_pada timestamptz,
  percobaan integer not null default 0,
  coba_pada timestamptz not null default now(),
  lease_id uuid,
  terkunci_sampai timestamptz,
  error_terakhir text,
  unique (klaim_id, jenis, penerima_username)
);
alter table public.sla_notif_klaim_sales enable row level security;
revoke all on public.sla_notif_klaim_sales from public, anon, authenticated;
grant select, insert, update, delete on public.sla_notif_klaim_sales to service_role;
create index if not exists sla_notif_klaim_sales_pending
  on public.sla_notif_klaim_sales (coba_pada) where terkirim_pada is null;

-- Satu lease pengirim bersama untuk kedua deployment, bukan satu lock per proyek GAS.
create table if not exists public.sla_pengirim_klaim_sales (
  id boolean primary key default true check (id),
  lease_id uuid,
  terkunci_sampai timestamptz
);
insert into public.sla_pengirim_klaim_sales(id) values(true) on conflict do nothing;
alter table public.sla_pengirim_klaim_sales enable row level security;
revoke all on public.sla_pengirim_klaim_sales from public, anon, authenticated;
grant select, update on public.sla_pengirim_klaim_sales to service_role;

create or replace function public.sla_mulai_pengiriman_klaim_sales()
returns uuid language sql security definer set search_path = '' as $$
  update public.sla_pengirim_klaim_sales set lease_id = gen_random_uuid(),
    terkunci_sampai = now() + interval '7 minutes'
  where id = true and (terkunci_sampai is null or terkunci_sampai < now())
  returning lease_id;
$$;
create or replace function public.sla_akhiri_pengiriman_klaim_sales(p_lease_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.sla_pengirim_klaim_sales set lease_id = null, terkunci_sampai = null
  where id = true and lease_id = p_lease_id;
  return found;
end;
$$;

create or replace function public.sla_admin_kendari(p_role text, p_cabang text)
returns boolean language sql immutable set search_path = '' as $$
  select lower(btrim(coalesce(p_role, ''))) = 'admin'
    and lower(btrim(coalesce(p_cabang, ''))) in ('', 'kendari', 'semua');
$$;

create or replace function public.sla_jaga_klaim_sales()
returns trigger language plpgsql security definer set search_path = '' as $$
declare berubah boolean;
begin
  if tg_op = 'INSERT' then
    berubah := coalesce(new.status_banding, '') <> ''
      or coalesce(new.sales_pengaju, '') <> '' or coalesce(new.bukti_banding, '') <> ''
      or coalesce(new.keterangan_sales, '') <> '' or coalesce(new.alasan_admin, '') <> ''
      or new.klaim_sales_id is not null or new.klaim_sales_username is not null
      or new.klaim_sales_diajukan_pada is not null or new.klaim_sales_diputuskan_pada is not null
      or new.klaim_sales_admin is not null;
  else
    berubah := row(new.status_banding, new.sales_pengaju, new.bukti_banding,
      new.keterangan_sales, new.alasan_admin, new.klaim_sales_id, new.klaim_sales_username,
      new.klaim_sales_diajukan_pada, new.klaim_sales_diputuskan_pada, new.klaim_sales_admin)
      is distinct from row(old.status_banding, old.sales_pengaju, old.bukti_banding,
      old.keterangan_sales, old.alasan_admin, old.klaim_sales_id, old.klaim_sales_username,
      old.klaim_sales_diajukan_pada, old.klaim_sales_diputuskan_pada, old.klaim_sales_admin);
    if old.status_banding = 'Diajukan' and new.sales is distinct from old.sales then
      berubah := true;
    end if;
  end if;
  if berubah and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Pengajuan dan keputusan klaim wajib melalui backend SLA.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists sla_jaga_klaim_sales on public.tiket;
create trigger sla_jaga_klaim_sales before insert or update on public.tiket
  for each row execute function public.sla_jaga_klaim_sales();

create or replace function public.sla_antrekan_klaim_sales()
returns trigger language plpgsql security definer set search_path = '' as $$
declare isi jsonb;
begin
  if new.status_banding is not distinct from old.status_banding
    or new.status_banding not in ('Diajukan', 'Diterima', 'Ditolak') then return new; end if;
  isi := jsonb_build_object('id_tiket', new.id_tiket, 'cabang', coalesce(new.cabang, 'Kendari'),
    'klien', new.klien_lokasi, 'pekerjaan', new.jenis_pekerjaan, 'sales', new.sales_pengaju,
    'keterangan', new.keterangan_sales, 'alasan', new.alasan_admin);
  if new.status_banding = 'Diajukan' then
    insert into public.sla_notif_klaim_sales(klaim_id, jenis, penerima_username, snapshot)
      select new.klaim_sales_id, 'Diajukan', u.username_login, isi from public.users u
      where public.sla_admin_kendari(u.role, u.hak_akses_cabang)
      on conflict (klaim_id, jenis, penerima_username) do nothing;
  else
    insert into public.sla_notif_klaim_sales(klaim_id, jenis, penerima_username, snapshot)
      values (new.klaim_sales_id, new.status_banding, new.klaim_sales_username, isi)
      on conflict (klaim_id, jenis, penerima_username) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists sla_antrekan_klaim_sales on public.tiket;
create trigger sla_antrekan_klaim_sales after update on public.tiket
  for each row execute function public.sla_antrekan_klaim_sales();

create or replace function public.sla_ajukan_klaim_sales(
  p_actor text, p_id_tiket text, p_cabang text, p_keterangan text, p_bukti text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.users%rowtype; t public.tiket%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Akses backend diperlukan.'; end if;
  select * into strict u from public.users where username_login = p_actor;
  if lower(btrim(u.role)) <> 'sales' then raise exception 'Hanya Sales dapat mengajukan klaim.'; end if;
  if p_cabang not in ('Kendari', 'Raha') or p_cabang is null then raise exception 'Cabang tidak valid.'; end if;
  if nullif(btrim(u.nama_asli), '') is null then raise exception 'Nama Sales belum terdaftar.'; end if;
  if coalesce(p_bukti, '') = '' or length(p_bukti) > 3500000
    or cardinality(string_to_array(p_bukti, '|#|')) not between 1 and 3
    or exists (select 1 from unnest(string_to_array(p_bukti, '|#|')) b
      where b !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$') then
    raise exception 'Unggah 1 sampai 3 foto bukti yang valid.';
  end if;
  if length(coalesce(p_keterangan, '')) > 3000 then raise exception 'Keterangan maksimal 3000 karakter.'; end if;
  if not exists (select 1 from public.users a where public.sla_admin_kendari(a.role, a.hak_akses_cabang)) then
    raise exception 'Akun Admin Kendari belum terdaftar.';
  end if;
  select * into strict t from public.tiket where id_tiket = p_id_tiket
    and coalesce(cabang, 'Kendari') = p_cabang for update;
  if coalesce(btrim(t.sales), '') not in ('', '-') then raise exception 'Tiket sudah memiliki Sales.'; end if;
  if coalesce(btrim(t.status_banding), '') <> '' then raise exception 'Tiket sudah memiliki pengajuan klaim.'; end if;
  update public.tiket set status_banding = 'Diajukan', sales_pengaju = btrim(u.nama_asli),
    bukti_banding = p_bukti, keterangan_sales = btrim(coalesce(p_keterangan, '')), alasan_admin = null,
    klaim_sales_id = gen_random_uuid(), klaim_sales_username = u.username_login,
    klaim_sales_diajukan_pada = now(), klaim_sales_diputuskan_pada = null, klaim_sales_admin = null
    where id_tiket = p_id_tiket and coalesce(cabang, 'Kendari') = p_cabang returning * into strict t;
  return jsonb_build_object('klaim_id', t.klaim_sales_id, 'status', t.status_banding);
end;
$$;

create or replace function public.sla_respon_klaim_sales(
  p_actor text, p_id_tiket text, p_cabang text, p_keputusan text, p_alasan text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.users%rowtype; t public.tiket%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Akses backend diperlukan.'; end if;
  select * into strict u from public.users where username_login = p_actor;
  if not public.sla_admin_kendari(u.role, u.hak_akses_cabang) then
    raise exception 'Hanya Admin Kendari dapat memutuskan klaim.';
  end if;
  if p_cabang not in ('Kendari', 'Raha') or p_cabang is null then raise exception 'Cabang tidak valid.'; end if;
  if p_keputusan not in ('Diterima', 'Ditolak') or p_keputusan is null then raise exception 'Keputusan tidak valid.'; end if;
  if p_keputusan = 'Ditolak' and nullif(btrim(p_alasan), '') is null then raise exception 'Alasan penolakan wajib diisi.'; end if;
  if length(coalesce(p_alasan, '')) > 3000 then raise exception 'Alasan maksimal 3000 karakter.'; end if;
  select * into strict t from public.tiket where id_tiket = p_id_tiket
    and coalesce(cabang, 'Kendari') = p_cabang for update;
  if t.status_banding is distinct from 'Diajukan' then raise exception 'Klaim sudah diproses atau belum diajukan.'; end if;
  if coalesce(btrim(t.sales), '') not in ('', '-') then raise exception 'Tiket sudah memiliki Sales. Periksa pengajuan.'; end if;
  if nullif(btrim(t.sales_pengaju), '') is null or t.klaim_sales_username is null
    or not exists (select 1 from public.users s where s.username_login = t.klaim_sales_username
      and lower(btrim(s.role)) = 'sales') then
    raise exception 'Akun Sales pengaju belum teridentifikasi. Periksa profil pengajuan lama.';
  end if;
  update public.tiket set status_banding = p_keputusan,
    sales = case when p_keputusan = 'Diterima' then t.sales_pengaju else t.sales end,
    alasan_admin = case when p_keputusan = 'Ditolak' then btrim(p_alasan) else null end,
    klaim_sales_diputuskan_pada = now(), klaim_sales_admin = u.username_login
    where id_tiket = p_id_tiket and coalesce(cabang, 'Kendari') = p_cabang returning * into strict t;
  return jsonb_build_object('klaim_id', t.klaim_sales_id, 'status', t.status_banding);
end;
$$;

-- Lease database menghindari dua deployment GAS mengirim event bersamaan.
create or replace function public.sla_ambil_notif_klaim_sales(p_klaim_id uuid default null)
returns setof public.sla_notif_klaim_sales language sql security definer set search_path = '' as $$
  update public.sla_notif_klaim_sales n set lease_id = gen_random_uuid(),
    terkunci_sampai = now() + interval '5 minutes', percobaan = n.percobaan + 1
  where n.id in (select q.id from public.sla_notif_klaim_sales q
    where q.terkirim_pada is null and q.coba_pada <= now()
      and (q.terkunci_sampai is null or q.terkunci_sampai < now())
      and (p_klaim_id is null or q.klaim_id = p_klaim_id)
    order by q.dibuat_pada limit 1 for update skip locked)
  returning n.*;
$$;
create or replace function public.sla_selesaikan_notif_klaim_sales(
  p_id uuid, p_lease_id uuid, p_terkirim boolean, p_error text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.sla_notif_klaim_sales set
    terkirim_pada = case when p_terkirim then now() else null end,
    error_terakhir = case when p_terkirim then null else left(p_error, 500) end,
    coba_pada = now() + interval '5 minutes', lease_id = null, terkunci_sampai = null
  where id = p_id and lease_id = p_lease_id and terkirim_pada is null;
  return found;
end;
$$;

-- Tanggal pengajuan lama tetap NULL: frontend menempatkannya dalam Riwayat.
-- Tidak mengirim ulang WA pengajuan historis. Keputusan baru tetap memicu WA.

revoke all on function public.sla_admin_kendari(text, text) from public, anon, authenticated;
revoke all on function public.sla_jaga_klaim_sales() from public, anon, authenticated;
revoke all on function public.sla_antrekan_klaim_sales() from public, anon, authenticated;
revoke all on function public.sla_ajukan_klaim_sales(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.sla_respon_klaim_sales(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.sla_ambil_notif_klaim_sales(uuid) from public, anon, authenticated;
revoke all on function public.sla_selesaikan_notif_klaim_sales(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.sla_mulai_pengiriman_klaim_sales() from public, anon, authenticated;
revoke all on function public.sla_akhiri_pengiriman_klaim_sales(uuid) from public, anon, authenticated;
grant execute on function public.sla_admin_kendari(text, text) to service_role;
grant execute on function public.sla_ajukan_klaim_sales(text, text, text, text, text) to service_role;
grant execute on function public.sla_respon_klaim_sales(text, text, text, text, text) to service_role;
grant execute on function public.sla_ambil_notif_klaim_sales(uuid) to service_role;
grant execute on function public.sla_selesaikan_notif_klaim_sales(uuid, uuid, boolean, text) to service_role;
grant execute on function public.sla_mulai_pengiriman_klaim_sales() to service_role;
grant execute on function public.sla_akhiri_pengiriman_klaim_sales(uuid) to service_role;

commit;
