-- Client messages follow Alfacom's existing WITA SLA calendar.
-- Queueing and expiry calculations still run at all times; only delivery waits.
begin;

create or replace function public.sla_client_working_time(p_branch text,p_at timestamptz default clock_timestamp())
returns boolean language sql immutable set search_path='' as $$
 select coalesce(p_branch in ('Kendari','Raha') and extract(isodow from local_at) between 1 and 6
  and ((local_at::time>=time '08:00' and local_at::time<time '12:00')
    or (local_at::time>=time '13:30' and local_at::time<time '15:00')
    or (local_at::time>=time '16:00' and local_at::time<case when p_branch='Raha' then time '20:00' else time '17:00' end)),false)
 from (select p_at at time zone 'Asia/Makassar' local_at) t
$$;

create or replace function public.sla_client_greeting(p_message text)
returns text language plpgsql immutable set search_path='' as $$
declare body text:=replace(coalesce(p_message,''),chr(13),'');
begin
 -- Remove template salutations only; retain the service details and tracking links.
 body:=regexp_replace(body,'^[ \t]*Assalamu[''’‘]?alaikum[ \t]+[^,\n]+,[ \t]*([^\n]+)',E'\\1','gim');
 body:=regexp_replace(body,'^[ \t]*Assalamu[''’‘]?alaikum,[ \t]+kami dari','Kami dari','gim');
 body:=regexp_replace(body,'^[ \t]*Assalamu[''’‘]?alaikum[^\n]*(\n|$)','','gim');
 body:=regexp_replace(body,'^[ \t]*Bismillah[.]?[ \t]*Pelanggan Yth[, .]*[ \t]*(\n|$)','','gim');
 return 'Assalamu''alaikum, Sahabat Alfacom.'||E'\n\n'||btrim(body,E' \t\n');
end $$;

create or replace function public.sla_ops_is_client_message(p_kind text,p_branch text,p_phone text,p_message text)
returns boolean language sql stable set search_path='' as $$
 select case
 when p_kind in ('warranty_followup','storage_reminder','warranty_claim_client','broadcast','client_notification') then true
 when p_kind='relay' then
  -- Known client templates also work when a staff member is the customer.
  coalesce(p_message like '%Tiket perbaikan Anda telah terdaftar:%'
    or p_message like '%Bismillah. Pelanggan Yth,%'
    or (p_message like '%TIKET DIBATALKAN%' and p_message like '%Kami informasikan bahwa tiket%'),false)
  or (public.sla_ops_recipient_allowed(p_phone,p_branch)
    and not exists(select 1 from public.users u where u.account_active is distinct from false
      and public.sla_ops_phone(u.no_wa)=p_phone))
 else false end
$$;

CREATE OR REPLACE FUNCTION public.sla_ops_lease(p_key text DEFAULT NULL::text, p_limit integer DEFAULT 5)
 RETURNS SETOF sla_ops_outbox
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 -- A worker may have sent a message before crashing. Never blindly resend it.
 update public.sla_ops_outbox set state='uncertain',last_error='Worker berhenti setelah mengambil antrean; periksa provider sebelum mengirim ulang.' where state='sending' and lease_until<now();
 return query with due as (
  select id from public.sla_ops_outbox where state='pending' and available_at<=now() and (p_key is null or event_key=p_key)
    and (not public.sla_ops_is_client_message(kind,cabang,phone,message)
         or public.sla_client_working_time(cabang,clock_timestamp()))
  order by created_at,id for update skip locked limit greatest(1,least(p_limit,10))
 ) update public.sla_ops_outbox o set state='sending',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '3 minutes'
 from due where o.id=due.id returning o.*;
end $function$;


-- Recheck immediately before contacting the provider, including a batch crossing a break.
-- The formatted copy is returned without rewriting the original idempotency payload.
create or replace function public.sla_ops_prepare_delivery(p_id uuid,p_lease uuid)
returns jsonb language plpgsql set search_path='' as $$
declare item public.sla_ops_outbox; client boolean;
begin
 select * into item from public.sla_ops_outbox
 where id=p_id and lease=p_lease and state='sending' and lease_until>clock_timestamp() for update;
 if not found then return jsonb_build_object('allowed',false); end if;
 client:=public.sla_ops_is_client_message(item.kind,item.cabang,item.phone,item.message);
 if client and not public.sla_client_working_time(item.cabang,clock_timestamp()) then
  update public.sla_ops_outbox set state='pending',attempts=greatest(0,attempts-1),
   lease=null,lease_until=null,available_at=clock_timestamp(),
   last_error='Menunggu hari dan jam kerja Alfacom.'
  where id=item.id;
  return jsonb_build_object('allowed',false,'deferred',true);
 end if;
 return jsonb_build_object('allowed',true,'message',case when client then public.sla_client_greeting(item.message) else item.message end);
end $$;

-- Customer claim confirmations join the same durable client queue. Staff claim
-- alerts keep their existing worker. The original record is acknowledged only
-- after the provider accepts the corresponding outbox message.
create or replace function public.sla_ops_queue_warranty_client(p_event uuid)
returns void language plpgsql set search_path='' as $$
declare event public.sla_notif_klaim_garansi; target_branch text; target_phone text;
begin
 select * into event from public.sla_notif_klaim_garansi where id=p_event;
 if not found or event.penerima<>'pelanggan' or event.terkirim_pada is not null
   or event.lease is not null or event.delivery_uncertain then return; end if;
 select cabang into target_branch from public.tiket where id_tiket=event.id_tiket;
 target_phone:=public.sla_ops_phone(event.no_wa);
 if target_phone is null or target_branch is null or target_branch not in ('Kendari','Raha') then return; end if;
 perform public.sla_ops_enqueue('warranty-claim:'||event.id,target_branch,
  jsonb_build_array(jsonb_build_object('phone',target_phone,'message',event.pesan)),
  'warranty_claim_client',null,jsonb_build_object('claimNotification',event.id));
end $$;

create or replace function public.sla_ops_queue_warranty_client_trigger()
returns trigger language plpgsql set search_path='' as $$
begin
 perform public.sla_ops_queue_warranty_client(new.id);
 return new;
end $$;
drop trigger if exists sla_ops_queue_warranty_client on public.sla_notif_klaim_garansi;
create trigger sla_ops_queue_warranty_client after insert on public.sla_notif_klaim_garansi
for each row when (new.penerima='pelanggan') execute function public.sla_ops_queue_warranty_client_trigger();

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
    select id from public.sla_notif_klaim_garansi where id_garansi=p_id_garansi and terkirim_pada is null and penerima<>'pelanggan'
      and (lease is null and delivery_uncertain=false) order by penerima for update skip locked
  ) update public.sla_notif_klaim_garansi n set lease=gen_random_uuid(),lease_sampai=now()+interval '10 minutes',percobaan=n.percobaan+1
    from calon where n.id=calon.id returning n.*;
end $function$;


CREATE OR REPLACE FUNCTION public.sla_ops_ack(p_id uuid, p_lease uuid, p_outcome text, p_error text DEFAULT NULL::text, p_provider text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare item public.sla_ops_outbox; complete boolean;
begin
 if p_outcome not in ('sent','retry','obsolete','uncertain') then raise exception 'Hasil pengiriman tidak valid'; end if;
 select * into item from public.sla_ops_outbox where id=p_id and lease=p_lease and state='sending' for update;
 if not found then return false; end if;
 update public.sla_ops_outbox set state=case when p_outcome='retry' then case when attempts>=5 then 'failed' else 'pending' end else p_outcome end,
 available_at=now()+make_interval(secs=>least(3600,60*power(2,item.attempts)::int)),
 last_error=left(p_error,500),provider_id=p_provider,sent_at=case when p_outcome='sent' then now() else null end,lease_until=null
 where id=p_id;
 if item.kind='warranty_claim_client' then
  update public.sla_notif_klaim_garansi
  set terkirim_pada=case when p_outcome='sent' then now() else null end,
      delivery_uncertain=(p_outcome='uncertain'), galat=left(p_error,500)
  where id=(item.guard->>'claimNotification')::uuid and penerima='pelanggan' and terkirim_pada is null;
 end if;
 select not exists(select 1 from public.sla_ops_outbox where event_key=item.event_key and state<>'sent') into complete;
 if p_outcome='sent' and complete and public.sla_ops_guard_valid(item.guard,item.cabang) then
  if item.guard->>'table'='tiket' and item.marker is not null then
   update public.tiket set status_peringatan=trim(coalesce(status_peringatan,'')||' ['||item.marker||']')
   where id_tiket=item.guard->>'id' and coalesce(cabang,'Kendari')=item.cabang and position(item.marker in coalesce(status_peringatan,''))=0;
  elsif item.guard->>'table'='prospek' then
   update public.prospek set waktu_peringatan_crm_terakhir=now() where id_prospek=item.guard->>'id' and coalesce(cabang,'Kendari')=item.cabang;
  elsif item.guard->>'table'='garansi' and item.kind='storage_reminder' then
   update public.garansi set riwayat_follow_up=concat_ws(E'\n',nullif(riwayat_follow_up,''),'['||item.marker||':DIANTREKAN '||to_char(now() at time zone 'Asia/Makassar','DD/MM/YYYY HH24:MI:SS')||'] Supabase') where id_garansi=item.guard->>'id' and coalesce(cabang,'Kendari')=item.cabang;
   if item.marker='PENITIPAN_H5' then update public.sla_notif_penitipan set terkirim_pada=now(),lease_sampai=null where id_garansi=item.guard->>'id' and terkirim_pada is null; end if;
  elsif item.guard->>'table'='garansi' then
   update public.garansi set follow_up_after_sales_terkirim=coalesce(item.marker,'FOLLOW_UP')||' | '||to_char(now() at time zone 'Asia/Makassar','DD/MM/YYYY HH24:MI:SS')
   where id_garansi=item.guard->>'id' and coalesce(cabang,'Kendari')=item.cabang;
  end if;
 end if;
 return true;
end $function$;


-- Protect the retired storage worker as well.
CREATE OR REPLACE FUNCTION public.sla_ambil_notif_penitipan()
 RETURNS SETOF sla_notif_penitipan
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  return query with calon as (
    select n.id from public.sla_notif_penitipan n join public.garansi g on g.id_garansi=n.id_garansi
    where public.sla_client_working_time(g.cabang,clock_timestamp()) and n.terkirim_pada is null and (n.lease_sampai is null or n.lease_sampai<now())
      and g.waktu_diambil is null and g.status in ('Masa Tunggu','Belum Diambil')
      and public.sla_hari_penitipan(g.waktu_siap_diambil,now()) between 5 and 7
    order by n.id limit 5 for update of n skip locked
  ) update public.sla_notif_penitipan n set lease=gen_random_uuid(),lease_sampai=now()+interval '10 minutes',percobaan=n.percobaan+1
    from calon where n.id=calon.id returning n.*;
end $function$;


do $$ declare item record; begin
 for item in select id from public.sla_notif_klaim_garansi
  where penerima='pelanggan' and terkirim_pada is null and lease is null and not delivery_uncertain
 loop perform public.sla_ops_queue_warranty_client(item.id); end loop;
end $$;

revoke all on function public.sla_client_working_time(text,timestamptz),
 public.sla_client_greeting(text),public.sla_ops_is_client_message(text,text,text,text),
 public.sla_ops_prepare_delivery(uuid,uuid),public.sla_ops_queue_warranty_client(uuid),
 public.sla_ops_queue_warranty_client_trigger() from public,anon,authenticated;
grant execute on function public.sla_client_working_time(text,timestamptz),
 public.sla_client_greeting(text),public.sla_ops_is_client_message(text,text,text,text),
 public.sla_ops_prepare_delivery(uuid,uuid),public.sla_ops_queue_warranty_client(uuid),
 public.sla_ops_queue_warranty_client_trigger() to service_role;
notify pgrst,'reload schema';
commit;
