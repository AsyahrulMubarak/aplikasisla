-- Logistik: branch ticket reads and own profile only. Existing roles retain
-- their current permissive policies. Deploy before enabling the new role.
-- This patch never creates employees or changes salary/attendance/ticket data.
begin;

create schema if not exists sla_logistik_private;
revoke all on schema sla_logistik_private from public, anon;
grant usage on schema sla_logistik_private to authenticated, service_role;

-- A private definer lookup is needed to avoid recursively reading users from
-- its own SELECT policy. Return only a scope, never profile or salary data.
create or replace function sla_logistik_private.scope()
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text;
  v_branch text;
begin
  if auth.uid() is null then return '!'; end if;
  select pg_catalog.lower(pg_catalog.btrim(u.role)),
    pg_catalog.lower(pg_catalog.btrim(coalesce(nullif(pg_catalog.btrim(u.hak_akses_cabang), ''), u.cabang, '')))
    into v_role, v_branch
  from public.users u where u.auth_id = auth.uid();
  if not found then return '!'; end if;
  if v_role is distinct from 'logistik' then return null; end if;
  if v_branch = 'kendari' then return 'Kendari'; end if;
  if v_branch = 'raha' then return 'Raha'; end if;
  return '!';
end;
$$;
revoke all on function sla_logistik_private.scope() from public, anon;
grant execute on function sla_logistik_private.scope() to authenticated, service_role;

alter table public.users enable row level security;
drop policy if exists sla_logistik_profile_read on public.users;
create policy sla_logistik_profile_read on public.users as restrictive
  for select to authenticated
  using ((select sla_logistik_private.scope()) is null or auth_id = (select auth.uid()));

alter table public.tiket enable row level security;
drop policy if exists sla_logistik_ticket_read on public.tiket;
create policy sla_logistik_ticket_read on public.tiket as restrictive
  for select to authenticated
  using ((select sla_logistik_private.scope()) is null or
    coalesce(nullif(pg_catalog.btrim(cabang), ''), 'Kendari') = (select sla_logistik_private.scope()));

drop policy if exists sla_logistik_ticket_insert on public.tiket;
create policy sla_logistik_ticket_insert on public.tiket as restrictive
  for insert to authenticated with check ((select sla_logistik_private.scope()) is null);
drop policy if exists sla_logistik_ticket_update on public.tiket;
create policy sla_logistik_ticket_update on public.tiket as restrictive
  for update to authenticated using ((select sla_logistik_private.scope()) is null)
  with check ((select sla_logistik_private.scope()) is null);
drop policy if exists sla_logistik_ticket_delete on public.tiket;
create policy sla_logistik_ticket_delete on public.tiket as restrictive
  for delete to authenticated using ((select sla_logistik_private.scope()) is null);

-- Other directly exposed, RLS-enabled public tables remain unavailable to
-- Logistik. Attendance, payroll and self-profile edits use their existing
-- authenticated server endpoints and retain their ownership checks.
do $$
declare v_table record;
begin
  for v_table in
    select c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
      and c.relname not in ('users', 'tiket')
      and (pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT')
        or pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT')
        or pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE')
        or pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE'))
  loop
    execute pg_catalog.format('drop policy if exists sla_logistik_no_direct_access on public.%I', v_table.relname);
    execute pg_catalog.format(
      'create policy sla_logistik_no_direct_access on public.%I as restrictive for all to authenticated using ((select sla_logistik_private.scope()) is null) with check ((select sla_logistik_private.scope()) is null)',
      v_table.relname);
  end loop;
end;
$$;

commit;
