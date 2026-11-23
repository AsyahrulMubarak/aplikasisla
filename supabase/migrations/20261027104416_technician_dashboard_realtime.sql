-- Publish only revision metadata. Reviews, drafts, credits and salary history
-- retain their server-only grants and are never added to Realtime.
create table public.sla_performance_revision (
 cabang text primary key check(cabang in ('Kendari','Raha')),
 revision bigint not null default 0 check(revision>=0),
 diperbarui_pada timestamptz not null default clock_timestamp()
);
insert into public.sla_performance_revision(cabang) values('Kendari'),('Raha');
alter table public.sla_performance_revision enable row level security;
revoke all on public.sla_performance_revision from public,anon,authenticated;
grant select on public.sla_performance_revision to authenticated;
grant select,update on public.sla_performance_revision to service_role;
create policy active_branch_reader on public.sla_performance_revision
 for select to authenticated using (
  (select sla_account_private.allowed()) and exists (
   select 1 from public.users u where u.auth_id=(select auth.uid())
    and lower(btrim(u.role)) in ('admin','admin_raha','manager','direktur','sales','teknisi','freelance')
    and lower(coalesce(nullif(btrim(u.hak_akses_cabang),''),u.cabang,'')) in ('semua',lower(sla_performance_revision.cabang))
  )
 );

-- These sources are written by server routines. Invoker rights are sufficient;
-- no client gets access to their private contents or to revision writes.
create function private.sla_invalidate_performance_dashboard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
 -- All branches are invalidated because management lobby results can include
 -- both branches. Fixed lock order also keeps bulk cross-branch reviews safe.
 perform 1 from public.sla_performance_revision order by cabang for update;
 update public.sla_performance_revision set revision=revision+1,diperbarui_pada=clock_timestamp();
 return null;
end $$;
revoke all on function private.sla_invalidate_performance_dashboard() from public,anon,authenticated;
grant execute on function private.sla_invalidate_performance_dashboard() to service_role;

create trigger sla_dashboard_revision after insert or update or delete on public.sla_performa_draf
 for each statement execute function private.sla_invalidate_performance_dashboard();
create trigger sla_dashboard_revision after insert or update or delete on public.sla_performa_bulan
 for each statement execute function private.sla_invalidate_performance_dashboard();
create trigger sla_dashboard_revision after insert or update or delete on public.sla_performa_episode
 for each statement execute function private.sla_invalidate_performance_dashboard();
create trigger sla_dashboard_revision after insert or update or delete on public.sla_gaji_kredit
 for each statement execute function private.sla_invalidate_performance_dashboard();
create trigger sla_dashboard_revision after insert or update or delete on public.sla_gaji_program
 for each statement execute function private.sla_invalidate_performance_dashboard();
create trigger sla_dashboard_revision after insert or update or delete on public.sla_gaji_riwayat
 for each statement execute function private.sla_invalidate_performance_dashboard();

alter publication supabase_realtime add table public.sla_performance_revision;
