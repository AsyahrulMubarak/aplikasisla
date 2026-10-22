begin;

-- Access status is independent of employment/payroll eligibility and identity.
alter table public.users
  add column account_active boolean not null default true,
  add column account_access_version integer not null default 0 check (account_access_version >= 0),
  add column account_session_after timestamptz,
  add column account_sync_pending boolean not null default false,
  add column account_requested_active boolean not null default true;

create schema if not exists sla_account_private;
revoke all on schema sla_account_private from public, anon;
grant usage on schema sla_account_private to authenticated, service_role;

create table public.sla_account_access_audit (
 id uuid primary key default gen_random_uuid(),
 actor_auth_id uuid not null,
 target_username text not null,
 target_auth_id uuid not null,
 access_version integer not null,
 stage text not null check (stage in ('requested','completed')),
 previous_active boolean not null,
 requested_active boolean not null,
 reason text not null check (length(btrim(reason)) between 3 and 1000),
 created_at timestamptz not null default clock_timestamp(),
 unique(target_username, access_version, stage)
);
create index sla_account_access_audit_target on public.sla_account_access_audit(target_username, created_at desc);
alter table public.sla_account_access_audit enable row level security;
revoke all on public.sla_account_access_audit from public, anon, authenticated;
grant select, insert on public.sla_account_access_audit to service_role;

-- JWT iat changes on refresh. The original Auth session's creation time is the
-- revocation boundary, so refreshing an old token cannot restore its access.
create function sla_account_private.allowed() returns boolean
language plpgsql stable security definer set search_path = pg_catalog as $$
declare v_session text := auth.jwt()->>'session_id';
begin
 if v_session is null or v_session !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 return exists (
  select 1 from public.users u join auth.sessions s on s.user_id=u.auth_id
  where u.auth_id=auth.uid() and u.account_active and not u.account_sync_pending
   and s.id=v_session::uuid and (s.not_after is null or s.not_after>now())
   and (u.account_session_after is null or s.created_at>u.account_session_after)
 );
end $$;
revoke all on function sla_account_private.allowed() from public, anon;
grant execute on function sla_account_private.allowed() to authenticated, service_role;

create function public.sla_assert_account_session() returns boolean
language plpgsql stable security invoker set search_path = pg_catalog as $$
begin
 if not sla_account_private.allowed() then
  raise sqlstate 'PT401' using message='Akun nonaktif atau sesi sudah dicabut. Silakan hubungi admin atau login kembali.';
 end if;
 return true;
end $$;
revoke all on function public.sla_assert_account_session() from public, anon;
grant execute on function public.sla_assert_account_session() to authenticated, service_role;

-- Restrictive policies also protect Realtime/Storage, which do not run the
-- PostgREST pre-request hook. Existing branch and role policies still apply.
do $$ declare t record; begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and c.relrowsecurity and (n.nspname='public' or (n.nspname='storage' and c.relname='objects'))
 loop
  execute format('create policy sla_account_session_required on %I.%I as restrictive for all to authenticated using ((select sla_account_private.allowed())) with check ((select sla_account_private.allowed()))',t.nspname,t.relname);
 end loop;
end $$;

create function public.sla_account_pre_request() returns void
language plpgsql stable security invoker set search_path=pg_catalog as $$
begin
 if current_user='authenticated' then perform public.sla_assert_account_session(); end if;
end $$;
revoke all on function public.sla_account_pre_request() from public;
grant execute on function public.sla_account_pre_request() to anon, authenticated, service_role;
alter role authenticator set pgrst.db_pre_request='public.sla_account_pre_request';

-- Called only by the authenticated profile Edge Function with its server key.
-- During either transition the account stays blocked until Auth confirms it.
create function public.sla_begin_account_access(p_actor uuid,p_username text,p_active boolean,p_version integer,p_reason text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.users; t public.users; v_scope text; v_target_scope text; v_audit public.sla_account_access_audit;
begin
 perform pg_advisory_xact_lock(hashtextextended('sla:account:access',0));
 select * into a from public.users where auth_id=p_actor;
 if not found or not a.account_active or a.account_sync_pending or lower(btrim(a.role)) not in ('admin','admin_raha') then raise exception 'Hanya admin aktif dapat mengelola akses akun.'; end if;
 select * into t from public.users where username_login=lower(regexp_replace(btrim(p_username),'\s+','','g')) for update;
 if not found or t.auth_id is null then raise exception 'Profil/Auth pegawai tidak tersedia.'; end if;
 v_scope:=lower(btrim(coalesce(nullif(a.hak_akses_cabang,''),a.cabang,'')));
 v_target_scope:=lower(btrim(coalesce(nullif(t.hak_akses_cabang,''),t.cabang,'')));
 if (v_scope<>'semua' and v_scope<>v_target_scope) or (lower(btrim(a.role))='admin_raha' and (v_scope<>'raha' or v_target_scope<>'raha')) then raise exception 'Cabang akun tidak sesuai hak akses admin.'; end if;
 if a.auth_id=t.auth_id then raise exception 'Anda tidak dapat mengubah status akses akun sendiri.'; end if;
 if p_active is null or p_version is null or t.account_access_version<>p_version then raise exception 'Status akun sudah berubah. Muat ulang daftar pegawai.'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then raise exception 'Isi alasan perubahan, 3 sampai 1000 karakter.'; end if;
 if t.account_sync_pending then
  if t.account_requested_active<>p_active then raise exception 'Selesaikan sinkronisasi status sebelumnya terlebih dahulu.'; end if;
 elsif t.account_active=p_active then
  return jsonb_build_object('unchanged',true,'username',t.username,'auth_id',t.auth_id,'version',t.account_access_version,'active',t.account_active);
 else
  if not p_active and lower(btrim(t.role))='admin' and not exists(select 1 from public.users u where u.auth_id<>t.auth_id and lower(btrim(u.role))='admin' and lower(btrim(coalesce(nullif(u.hak_akses_cabang,''),u.cabang,'')))='semua' and u.account_active and not u.account_sync_pending) then raise exception 'Admin pusat aktif terakhir tidak dapat dinonaktifkan.'; end if;
  update public.users set account_active=false,account_requested_active=p_active,account_sync_pending=true,
   account_access_version=account_access_version+1,account_session_after=clock_timestamp()
   where username=t.username returning * into t;
  insert into public.sla_account_access_audit(actor_auth_id,target_username,target_auth_id,access_version,stage,previous_active,requested_active,reason)
   values(p_actor,t.username,t.auth_id,t.account_access_version,'requested',not p_active,p_active,btrim(p_reason));
 end if;
 return jsonb_build_object('unchanged',false,'username',t.username,'auth_id',t.auth_id,'version',t.account_access_version,'active',p_active);
end $$;

create function public.sla_finish_account_access(p_actor uuid,p_username text,p_auth_id uuid,p_version integer)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare t public.users; v_request public.sla_account_access_audit;
begin
 perform pg_advisory_xact_lock(hashtextextended('sla:account:access',0));
 select * into t from public.users where username=p_username for update;
 if not found or t.auth_id is distinct from p_auth_id or t.account_access_version<>p_version then raise exception 'Status akun berubah saat sinkronisasi. Muat ulang.'; end if;
 if not t.account_sync_pending then return jsonb_build_object('active',t.account_active,'version',t.account_access_version); end if;
 select * into v_request from public.sla_account_access_audit where target_username=p_username and access_version=p_version and stage='requested';
 if not found then raise exception 'Permintaan akses tidak ditemukan.'; end if;
 update public.users set account_active=account_requested_active,account_sync_pending=false,
  account_session_after=clock_timestamp() where username=p_username returning * into t;
 insert into public.sla_account_access_audit(actor_auth_id,target_username,target_auth_id,access_version,stage,previous_active,requested_active,reason)
 values(p_actor,t.username,t.auth_id,p_version,'completed',v_request.previous_active,t.account_active,v_request.reason);
 return jsonb_build_object('active',t.account_active,'version',t.account_access_version);
end $$;
revoke all on function public.sla_begin_account_access(uuid,text,boolean,integer,text),public.sla_finish_account_access(uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.sla_begin_account_access(uuid,text,boolean,integer,text),public.sla_finish_account_access(uuid,text,uuid,integer) to service_role;

notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;

