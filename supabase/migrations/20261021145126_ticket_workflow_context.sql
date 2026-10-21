-- Structured operational facts only; no historic backfill, salary evaluation, or WA calls.
alter table public.tiket add column if not exists konteks_pekerjaan jsonb;
alter table public.tiket add column if not exists versi_workflow integer not null default 0;
create table public.sla_konteks_pekerjaan_audit (
 id bigint generated always as identity primary key,id_tiket text not null,cabang text not null,
 request_id uuid not null unique,actor_username text not null,actor_auth_id uuid not null,
 action text not null,event jsonb not null,dibuat_pada timestamptz not null default now()
);
create index sla_konteks_pekerjaan_ticket on public.sla_konteks_pekerjaan_audit(id_tiket,id);
alter table public.sla_konteks_pekerjaan_audit enable row level security;
revoke all on public.sla_konteks_pekerjaan_audit from public,anon,authenticated,service_role;
grant select,insert on public.sla_konteks_pekerjaan_audit to service_role;
grant usage,select on sequence public.sla_konteks_pekerjaan_audit_id_seq to service_role;
create policy server on public.sla_konteks_pekerjaan_audit for all to service_role using(true) with check(true);

create or replace function public.sla_jaga_konteks_pekerjaan()
returns trigger language plpgsql security invoker set search_path='' as $$
declare events jsonb; last_event jsonb; i integer; begin
 if new.konteks_pekerjaan is distinct from (case when tg_op='INSERT' then null else old.konteks_pekerjaan end)
  and not (coalesce(auth.role(),'')='service_role' and current_setting('sla.workflow_write',true)='on') then
  raise exception 'Alasan terstruktur hanya dapat disimpan melalui layanan tiket.';
 end if;
 if tg_op='INSERT' then new.versi_workflow:=0; return new; end if;
 new.versi_workflow:=old.versi_workflow+1;
 if old.status='Pending' and new.status is distinct from 'Pending' and new.konteks_pekerjaan is not null then
  events:=coalesce(new.konteks_pekerjaan->'events','[]');
  if jsonb_array_length(events)>0 then
   for i in reverse jsonb_array_length(events)-1..0 loop
    last_event:=events->i;
    if last_event->>'kind'='pending' and last_event->>'closedAt' is null then
     events:=jsonb_set(events,array[i::text],last_event||jsonb_build_object('closedAt',statement_timestamp(),'resumeStatus',new.status));
    end if;
   end loop;
   new.konteks_pekerjaan:=jsonb_set(new.konteks_pekerjaan,'{events}',events);
  end if;
 end if;
 return new;
end $$;
revoke all on function public.sla_jaga_konteks_pekerjaan() from public,anon,authenticated;
create trigger sla_zzz_jaga_konteks_pekerjaan before insert or update on public.tiket for each row execute function public.sla_jaga_konteks_pekerjaan();
