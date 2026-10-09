begin;

create table public.sla_password_reset_limits (
  fingerprint text primary key check (fingerprint ~ '^[0-9a-f]{64}$'),
  window_started timestamptz not null default now(),
  attempts integer not null default 1 check (attempts > 0)
);
create index sla_password_reset_limits_age on public.sla_password_reset_limits(window_started);
create table public.sla_password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  nama_asli text not null,
  cabang text not null check (cabang in ('Kendari','Raha','Semua')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid
);
create index sla_password_reset_requests_pending on public.sla_password_reset_requests(cabang, requested_at desc) where completed_at is null;
create index sla_password_reset_requests_user on public.sla_password_reset_requests(username, requested_at desc);
create table public.sla_password_reset_notifications (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.sla_password_reset_requests(id) on delete cascade,
  recipient_username text not null,
  no_wa text not null,
  pesan text not null,
  sent_at timestamptz,
  attempts integer not null default 0,
  retry_at timestamptz not null default now(),
  lease uuid,
  lease_until timestamptz,
  unique(request_id, recipient_username)
);
create index sla_password_reset_notifications_pending on public.sla_password_reset_notifications(retry_at) where sent_at is null;
create table public.sla_profile_audit (
  id uuid primary key default gen_random_uuid(),
  actor_auth_id uuid not null,
  target_username text not null,
  action text not null check (action in ('buatProfil','ubahProfil','hapusProfil','resetPassword','linkAuth')),
  created_at timestamptz not null default now()
);
create index sla_profile_audit_target on public.sla_profile_audit(target_username, created_at desc);

alter table public.sla_password_reset_limits enable row level security;
alter table public.sla_password_reset_requests enable row level security;
alter table public.sla_password_reset_notifications enable row level security;
alter table public.sla_profile_audit enable row level security;
revoke all on public.sla_password_reset_limits, public.sla_password_reset_requests,
  public.sla_password_reset_notifications, public.sla_profile_audit from public, anon, authenticated;
grant select, insert, update, delete on public.sla_password_reset_limits, public.sla_password_reset_requests,
  public.sla_password_reset_notifications, public.sla_profile_audit to service_role;

-- Both nonexistent and existing usernames consume the same durable rate limit.
create function public.sla_request_password_reset(p_username text, p_fingerprint text) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_attempts integer; v_user public.users; v_request uuid;
begin
  if p_fingerprint !~ '^[0-9a-f]{64}$' or p_username !~ '^[a-z0-9._-]{1,80}$' then return null; end if;
  delete from public.sla_password_reset_limits where window_started < now() - interval '1 day';
  insert into public.sla_password_reset_limits(fingerprint) values(p_fingerprint)
  on conflict(fingerprint) do update set
    attempts = case when sla_password_reset_limits.window_started < now() - interval '10 minutes' then 1 else sla_password_reset_limits.attempts + 1 end,
    window_started = case when sla_password_reset_limits.window_started < now() - interval '10 minutes' then now() else sla_password_reset_limits.window_started end
  returning attempts into v_attempts;
  if v_attempts > 5 then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('sla-reset:' || p_username, 0));
  select * into v_user from public.users where username_login = p_username;
  if not found or v_user.auth_id is null then return null; end if;
  if exists(select 1 from public.sla_password_reset_requests where username = v_user.username and requested_at > now() - interval '10 minutes') then return null; end if;
  insert into public.sla_password_reset_requests(username, nama_asli, cabang)
  values(v_user.username, v_user.nama_asli, case when lower(trim(coalesce(v_user.hak_akses_cabang, v_user.cabang,''))) = 'raha' then 'Raha'
    when lower(trim(coalesce(v_user.hak_akses_cabang, v_user.cabang,''))) = 'semua' then 'Semua' else 'Kendari' end)
  returning id into v_request;
  insert into public.sla_password_reset_notifications(request_id, recipient_username, no_wa, pesan)
  select v_request, u.username, u.no_wa,
    'ALFACOM — PERMINTAAN RESET PASSWORD' || E'\n' || left(regexp_replace(v_user.nama_asli, '[\r\n]+', ' ', 'g'),120) ||
    ' (' || v_user.username || ')' || E'\nBuka Profil → Permintaan Reset Password untuk menetapkan password baru.'
  from public.users u join public.sla_password_reset_requests r on r.id = v_request
  where nullif(trim(u.no_wa),'') is not null and (
    (lower(trim(u.role)) = 'admin' and (lower(trim(coalesce(u.hak_akses_cabang,u.cabang,''))) = 'semua'
      or lower(trim(coalesce(u.hak_akses_cabang,u.cabang,'kendari'))) = lower(r.cabang)))
    or (lower(trim(u.role)) = 'admin_raha' and r.cabang = 'Raha' and lower(trim(coalesce(u.hak_akses_cabang,u.cabang,''))) = 'raha')
  );
  return v_request;
end $$;

create function public.sla_lease_password_reset_notifications(p_request uuid default null) returns setof public.sla_password_reset_notifications
language sql security invoker set search_path = public, pg_temp as $$
  with candidates as (
    select n.id from public.sla_password_reset_notifications n join public.sla_password_reset_requests r on r.id = n.request_id
    where n.sent_at is null and n.attempts < 8 and n.retry_at <= now()
      and (n.lease_until is null or n.lease_until < now()) and r.completed_at is null
      and r.requested_at > now() - interval '1 day' and (p_request is null or n.request_id = p_request)
    order by n.retry_at for update of n skip locked limit 10
  )
  update public.sla_password_reset_notifications n set lease = gen_random_uuid(), lease_until = now() + interval '2 minutes', attempts = attempts + 1
  from candidates c where n.id = c.id returning n.*;
$$;
create function public.sla_ack_password_reset_notification(p_id uuid, p_lease uuid, p_success boolean) returns boolean
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  update public.sla_password_reset_notifications set sent_at = case when p_success then now() else null end,
    retry_at = now() + interval '5 minutes', lease = null, lease_until = null
  where id = p_id and lease = p_lease and sent_at is null;
  return found;
end $$;
create function public.sla_complete_password_reset(p_username text, p_actor_auth_id uuid) returns integer
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_actor public.users; v_target public.users; v_count integer;
begin
  select * into v_actor from public.users where auth_id = p_actor_auth_id;
  if not found or lower(trim(v_actor.role)) not in ('admin','admin_raha') then raise exception 'Admin diperlukan.'; end if;
  select * into v_target from public.users where username = p_username;
  if not found then raise exception 'Profil tidak ditemukan.'; end if;
  if lower(trim(v_actor.role)) = 'admin_raha' or lower(trim(coalesce(v_actor.hak_akses_cabang,v_actor.cabang,''))) = 'raha' then
    if lower(trim(coalesce(v_target.hak_akses_cabang,v_target.cabang,''))) <> 'raha' then raise exception 'Cabang profil tidak sesuai hak akses.'; end if;
  elsif lower(trim(coalesce(v_actor.hak_akses_cabang,v_actor.cabang,''))) <> 'semua'
    and lower(trim(coalesce(v_actor.hak_akses_cabang,v_actor.cabang,''))) <> lower(trim(coalesce(v_target.hak_akses_cabang,v_target.cabang,''))) then
    raise exception 'Cabang profil tidak sesuai hak akses.';
  end if;
  update public.sla_password_reset_requests set completed_at = now(), completed_by = p_actor_auth_id
  where username = p_username and completed_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.sla_request_password_reset(text,text), public.sla_lease_password_reset_notifications(uuid),
  public.sla_ack_password_reset_notification(uuid,uuid,boolean), public.sla_complete_password_reset(text,uuid) from public, anon, authenticated;
grant execute on function public.sla_request_password_reset(text,text), public.sla_lease_password_reset_notifications(uuid),
  public.sla_ack_password_reset_notification(uuid,uuid,boolean), public.sla_complete_password_reset(text,uuid) to service_role;
commit;
