-- Never automatically retry an attempt whose delivery outcome is unknown.
alter table public.sla_notif_absensi add column if not exists delivery_uncertain boolean not null default false;
CREATE OR REPLACE FUNCTION public.sla_ambil_notif_absensi(p_pengajuan text DEFAULT NULL::text)
 RETURNS SETOF sla_notif_absensi
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
  update public.sla_notif_absensi set delivery_uncertain=true, galat='UNCERTAIN: hasil pengiriman sebelumnya perlu diperiksa.' where terkirim_pada is null and lease_id is not null and lease_sampai<now();
  return query
  with candidate as (
    select id from public.sla_notif_absensi
    where terkirim_pada is null and coba_pada<=now()
      and (lease_id is null and delivery_uncertain=false)
      and (p_pengajuan is null or id_pengajuan=p_pengajuan)
    order by coba_pada,dibuat_pada,id for update skip locked limit 1
  ) update public.sla_notif_absensi n set lease_id=gen_random_uuid(),
    lease_sampai=now()+interval '90 seconds',percobaan=percobaan+1
    from candidate c where n.id=c.id returning n.*;
end $function$;

alter table public.sla_notif_kenaikan_gaji add column if not exists delivery_uncertain boolean not null default false;
CREATE OR REPLACE FUNCTION public.sla_ambil_notif_gaji(p_username text DEFAULT NULL::text)
 RETURNS SETOF sla_notif_kenaikan_gaji
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 update public.sla_notif_kenaikan_gaji set delivery_uncertain=true, galat='UNCERTAIN: hasil pengiriman sebelumnya perlu diperiksa.' where terkirim_pada is null and lease is not null and lease_sampai<now();
 return query with kandidat as (select id from public.sla_notif_kenaikan_gaji where terkirim_pada is null and coba_lagi_pada<=now()
   and (p_username is null or username=p_username) and (lease is null and delivery_uncertain=false) order by coba_lagi_pada limit 20 for update skip locked)
 update public.sla_notif_kenaikan_gaji n set lease=gen_random_uuid(),lease_sampai=now()+interval '5 minutes',percobaan=percobaan+1,
 no_wa=coalesce((select u.no_wa from public.users u where u.username=n.username),'')
 from kandidat k where n.id=k.id returning n.*;
end $function$;

alter table public.sla_notif_klaim_garansi add column if not exists delivery_uncertain boolean not null default false;
CREATE OR REPLACE FUNCTION public.sla_ambil_notif_garansi(p_id_garansi text)
 RETURNS SETOF sla_notif_klaim_garansi
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
  update public.sla_notif_klaim_garansi set delivery_uncertain=true, galat='UNCERTAIN: hasil pengiriman sebelumnya perlu diperiksa.' where terkirim_pada is null and lease is not null and lease_sampai<now();
  return query with calon as (
    select id from public.sla_notif_klaim_garansi where id_garansi=p_id_garansi and terkirim_pada is null
      and (lease is null and delivery_uncertain=false) order by penerima for update skip locked
  ) update public.sla_notif_klaim_garansi n set lease=gen_random_uuid(),lease_sampai=now()+interval '10 minutes',percobaan=n.percobaan+1
    from calon where n.id=calon.id returning n.*;
end $function$;

alter table public.sla_notif_klaim_sales add column if not exists delivery_uncertain boolean not null default false;
CREATE OR REPLACE FUNCTION public.sla_ambil_notif_klaim_sales(p_klaim_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF sla_notif_klaim_sales
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 update public.sla_notif_klaim_sales set delivery_uncertain=true, error_terakhir='UNCERTAIN: hasil pengiriman sebelumnya perlu diperiksa.' where terkirim_pada is null and lease_id is not null and terkunci_sampai<now();
 return query
  update public.sla_notif_klaim_sales n set lease_id = gen_random_uuid(),
    terkunci_sampai = now() + interval '5 minutes', percobaan = n.percobaan + 1
  where n.id in (select q.id from public.sla_notif_klaim_sales q
    where q.terkirim_pada is null and q.coba_pada <= now()
      and (q.lease_id is null and q.delivery_uncertain=false)
      and (p_klaim_id is null or q.klaim_id = p_klaim_id)
    order by q.dibuat_pada limit 1 for update skip locked)
  returning n.*;
end $function$;
alter table public.sla_password_reset_notifications add column if not exists delivery_uncertain boolean not null default false;
CREATE OR REPLACE FUNCTION public.sla_lease_password_reset_notifications(p_request uuid DEFAULT NULL::uuid)
 RETURNS SETOF sla_password_reset_notifications
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 update public.sla_password_reset_notifications set delivery_uncertain=true where sent_at is null and lease is not null and lease_until<now();
 return query
  with candidates as (
    select n.id from public.sla_password_reset_notifications n join public.sla_password_reset_requests r on r.id = n.request_id
    where n.sent_at is null and n.attempts < 8 and n.retry_at <= now()
      and (n.lease is null and n.delivery_uncertain=false) and r.completed_at is null
      and r.requested_at > now() - interval '1 day' and (p_request is null or n.request_id = p_request)
    order by n.retry_at for update of n skip locked limit 10
  )
  update public.sla_password_reset_notifications n set lease = gen_random_uuid(), lease_until = now() + interval '2 minutes', attempts = attempts + 1
  from candidates c where n.id = c.id returning n.*;
end $function$;
create or replace function public.sla_mark_notif_uncertain(p_queue text,p_id uuid,p_lease uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare affected integer;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 if p_queue='sla_notif_absensi' then
 update public.sla_notif_absensi set delivery_uncertain=true, galat='UNCERTAIN: provider belum memastikan hasil pengiriman.' where id=p_id and lease_id=p_lease and terkirim_pada is null;
 elsif p_queue='sla_notif_kenaikan_gaji' then
 update public.sla_notif_kenaikan_gaji set delivery_uncertain=true, galat='UNCERTAIN: provider belum memastikan hasil pengiriman.' where id=p_id and lease=p_lease and terkirim_pada is null;
 elsif p_queue='sla_notif_klaim_garansi' then
 update public.sla_notif_klaim_garansi set delivery_uncertain=true, galat='UNCERTAIN: provider belum memastikan hasil pengiriman.' where id=p_id and lease=p_lease and terkirim_pada is null;
 elsif p_queue='sla_notif_klaim_sales' then
 update public.sla_notif_klaim_sales set delivery_uncertain=true, error_terakhir='UNCERTAIN: provider belum memastikan hasil pengiriman.' where id=p_id and lease_id=p_lease and terkirim_pada is null;
 elsif p_queue='sla_password_reset_notifications' then
 update public.sla_password_reset_notifications set delivery_uncertain=true where id=p_id and lease=p_lease and sent_at is null;
 else raise exception 'Antrean tidak valid.'; end if;
 get diagnostics affected=row_count; return affected=1;
end $$;
revoke all on function public.sla_mark_notif_uncertain(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.sla_mark_notif_uncertain(text,uuid,uuid) to service_role;
notify pgrst,'reload schema';
