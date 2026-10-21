-- Performance starts November 2026. This migration never evaluates salary or sends WA.
create table public.sla_performa_episode (
 id bigint generated always as identity primary key,id_tiket text not null,cabang text not null,
 teknisi text not null,pengganti text,waktu_pergantian timestamptz not null,
 tenggat_waktu timestamptz,tenggat_respon timestamptz,waktu_respon timestamptz,waktu_selesai timestamptz,
 status text,sisa_jeda numeric
);
create index sla_performa_episode_ticket on public.sla_performa_episode(id_tiket,waktu_pergantian);
alter table public.sla_performa_episode enable row level security;
revoke all on public.sla_performa_episode from public,anon,authenticated;
grant select,insert on public.sla_performa_episode to service_role;
grant usage,select on sequence public.sla_performa_episode_id_seq to service_role;
create policy server on public.sla_performa_episode for all to service_role using(true) with check(true);
create schema if not exists private;
-- Append-only audit needs its own privilege so existing authenticated ticket updates keep working.
-- No ticket, salary, queue, or client-supplied history is rewritten by this trigger.
create or replace function private.sla_catat_episode_performa()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then
  if auth.uid() is null or (select count(*) from public.users where auth_id=auth.uid())<>1 then raise exception 'Sesi tidak sah untuk perubahan penugasan.'; end if;
 end if;
 if public.sla_penilaian_nama(old.teknisi) is distinct from public.sla_penilaian_nama(new.teknisi) and cardinality(public.sla_penilaian_nama(old.teknisi))>0 then
  insert into public.sla_performa_episode(id_tiket,cabang,teknisi,pengganti,waktu_pergantian,tenggat_waktu,tenggat_respon,waktu_respon,waktu_selesai,status,sisa_jeda)
  values(old.id_tiket,coalesce(old.cabang,'Kendari'),old.teknisi,new.teknisi,public.sla_gaji_sekarang(),old.tenggat_waktu,old.tenggat_respon,old.waktu_respon,old.waktu_selesai,old.status,old.sla_jeda_sisa_detik);
 end if;
 return new;
end $$;
revoke all on function private.sla_catat_episode_performa() from public,anon,authenticated;
create trigger sla_performa_assignment_audit after update of teknisi on public.tiket for each row execute function private.sla_catat_episode_performa();
create table public.sla_performa_bulan (
 username text not null, periode text not null check(periode ~ '^202[6-9]-(0[1-9]|1[0-2])$|^20[3-9][0-9]-(0[1-9]|1[0-2])$'),
 revision integer not null default 1, input jsonb not null, hasil jsonb not null,
 source_hash text not null, disahkan_oleh text not null, disahkan_pada timestamptz not null,
 primary key(username,periode)
);
create table public.sla_performa_audit (
 id bigint generated always as identity primary key, username text not null, periode text not null,
 actor text not null, sebelum jsonb, sesudah jsonb not null, dibuat_pada timestamptz not null default now()
);
create table public.sla_gaji_kredit (
 username text not null, periode text not null, sumber text not null check(sumber in ('kehadiran','performa')),
 kenaikan_id uuid references public.sla_gaji_riwayat(id), dibuat_pada timestamptz not null default now(),
 primary key(username,periode,sumber)
);
create index sla_gaji_kredit_unused on public.sla_gaji_kredit(username,periode,sumber) where kenaikan_id is null;
alter table public.sla_performa_bulan enable row level security;
alter table public.sla_performa_audit enable row level security;
alter table public.sla_gaji_kredit enable row level security;
revoke all on public.sla_performa_bulan,public.sla_performa_audit,public.sla_gaji_kredit from public,anon,authenticated;
grant select,insert,update on public.sla_performa_bulan,public.sla_gaji_kredit to service_role;
grant delete on public.sla_gaji_kredit to service_role;
grant select,insert on public.sla_performa_audit to service_role;
grant usage,select on sequence public.sla_performa_audit_id_seq to service_role;
create policy server on public.sla_performa_bulan for all to service_role using(true) with check(true);
create policy server on public.sla_performa_audit for all to service_role using(true) with check(true);
create policy server on public.sla_gaji_kredit for all to service_role using(true) with check(true);
-- Preserve both used and unused attendance credits; no historic performance backfill.
insert into public.sla_gaji_kredit(username,periode,sumber,kenaikan_id)
 select username,periode,'kehadiran',kenaikan_id from public.sla_gaji_disiplin_bulan where memenuhi_syarat on conflict do nothing;
