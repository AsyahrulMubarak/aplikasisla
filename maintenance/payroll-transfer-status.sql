-- Manual salary-transfer marks, scoped to salary month and the current WITA cycle.
-- Reading a new cycle automatically returns unmarked employees; no destructive reset job.
create table public.sla_transfer_gaji (
  siklus_mulai date not null,
  periode text not null check (periode ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  username text not null references public.users(username) on update cascade on delete cascade,
  sudah_transfer boolean not null default false,
  diperbarui_pada timestamptz not null default now(),
  diperbarui_oleh uuid not null,
  primary key (siklus_mulai, periode, username)
);
create index sla_transfer_gaji_username_idx on public.sla_transfer_gaji(username);
alter table public.sla_transfer_gaji enable row level security;
revoke all on public.sla_transfer_gaji from public, anon, authenticated;
grant select, insert, update on public.sla_transfer_gaji to service_role;
create policy transfer_salary_server_only on public.sla_transfer_gaji
  for all to service_role using (true) with check (true);

create function public.sla_siklus_transfer_gaji(p_waktu timestamptz default now())
returns date language sql stable security invoker set search_path = '' as $$
  with clock as (select (p_waktu at time zone 'Asia/Makassar')::date as hari),
  months as (select hari, date_trunc('month',hari)::date as awal from clock),
  cutoff as (select *, awal + least(28, extract(day from awal + interval '1 month - 1 day')::integer - 1) as batas from months)
  select case when hari >= batas then batas else
    (awal - interval '1 month')::date + least(28, extract(day from awal - 1)::integer - 1) end from cutoff;
$$;
revoke all on function public.sla_siklus_transfer_gaji(timestamptz) from public, anon, authenticated;
grant execute on function public.sla_siklus_transfer_gaji(timestamptz) to service_role;

create function public.sla_status_transfer_gaji(p_auth_id uuid, p_periode text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_role text; v_home text; v_cycle date; v_next date; v_reset date; v_rows jsonb;
begin
  select lower(trim(u.role)), coalesce(
    case when lower(trim(u.hak_akses_cabang)) in ('kendari','raha') then lower(trim(u.hak_akses_cabang)) end,
    case when lower(trim(u.cabang)) in ('kendari','raha') then lower(trim(u.cabang)) end, 'kendari')
    into v_role,v_home from public.users u where u.auth_id=p_auth_id;
  if v_role is null or v_role not in ('admin','manager','direktur') or (v_role='admin' and v_home='raha') then
    raise exception 'Status transfer gaji hanya untuk Admin Kendari, Manager, atau Direktur.';
  end if;
  if p_periode is null or p_periode !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Periode gaji tidak valid.'; end if;
  v_cycle := public.sla_siklus_transfer_gaji(statement_timestamp());
  v_next := (date_trunc('month',v_cycle) + interval '1 month')::date;
  v_reset := v_next + least(28,extract(day from v_next + interval '1 month - 1 day')::integer - 1);
  select coalesce(jsonb_agg(jsonb_build_object('username',username,'sudahTransfer',sudah_transfer,'diperbaruiPada',diperbarui_pada) order by username),'[]'::jsonb)
    into v_rows from public.sla_transfer_gaji where siklus_mulai=v_cycle and periode=p_periode;
  return jsonb_build_object('status','sukses','periode',p_periode,'siklus',v_cycle,'resetPada',v_reset::timestamp at time zone 'Asia/Makassar',
    'waktuServer',statement_timestamp(),'data',v_rows);
end;
$$;
revoke all on function public.sla_status_transfer_gaji(uuid,text) from public, anon, authenticated;
grant execute on function public.sla_status_transfer_gaji(uuid,text) to service_role;

create function public.sla_simpan_transfer_gaji(
  p_auth_id uuid,p_username text,p_periode text,p_siklus date,p_sudah_transfer boolean,p_status_lama boolean
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_role text; v_home text; v_cycle date; v_old boolean; v_updated timestamptz;
begin
  select lower(trim(u.role)), coalesce(
    case when lower(trim(u.hak_akses_cabang)) in ('kendari','raha') then lower(trim(u.hak_akses_cabang)) end,
    case when lower(trim(u.cabang)) in ('kendari','raha') then lower(trim(u.cabang)) end, 'kendari')
    into v_role,v_home from public.users u where u.auth_id=p_auth_id;
  if v_role is null or v_role not in ('admin','manager','direktur') or (v_role='admin' and v_home='raha') then
    raise exception 'Status transfer gaji hanya dapat diubah Admin Kendari, Manager, atau Direktur.';
  end if;
  if p_periode is null or p_periode !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or p_sudah_transfer is null or p_status_lama is null then
    raise exception 'Data status transfer gaji tidak valid.';
  end if;
  if not exists(select 1 from public.users where username=p_username) then raise exception 'Profil pegawai tidak ditemukan.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sla_transfer:' || p_periode || ':' || p_username,0));
  -- Use wall-clock time after obtaining the lock, so a request crossing midnight cannot write the old cycle.
  v_cycle := public.sla_siklus_transfer_gaji(clock_timestamp());
  if p_siklus is null or p_siklus <> v_cycle then raise exception 'Siklus transfer gaji sudah direset. Muat ulang status transfer.'; end if;
  select sudah_transfer into v_old from public.sla_transfer_gaji where siklus_mulai=v_cycle and periode=p_periode and username=p_username;
  if coalesce(v_old,false) <> p_status_lama then raise exception 'Status transfer sudah diubah pengguna lain. Muat ulang status transfer.'; end if;
  v_updated := clock_timestamp();
  insert into public.sla_transfer_gaji(siklus_mulai,periode,username,sudah_transfer,diperbarui_pada,diperbarui_oleh)
    values(v_cycle,p_periode,p_username,p_sudah_transfer,v_updated,p_auth_id)
    on conflict(siklus_mulai,periode,username) do update set sudah_transfer=excluded.sudah_transfer,
      diperbarui_pada=excluded.diperbarui_pada,diperbarui_oleh=excluded.diperbarui_oleh;
  return jsonb_build_object('status','sukses','periode',p_periode,'siklus',v_cycle,'data',
    jsonb_build_object('username',p_username,'sudahTransfer',p_sudah_transfer,'diperbaruiPada',v_updated));
end;
$$;
revoke all on function public.sla_simpan_transfer_gaji(uuid,text,text,date,boolean,boolean) from public, anon, authenticated;
grant execute on function public.sla_simpan_transfer_gaji(uuid,text,text,date,boolean,boolean) to service_role;

-- Make the existing private bank table's server-only access explicit.
create policy bank_accounts_server_only on public.sla_rekening_pegawai
  for all to service_role using (true) with check (true);
