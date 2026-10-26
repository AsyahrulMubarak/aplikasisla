-- First-response warnings stop once work is underway, including after a handover.
begin;
create or replace function public.sla_ops_prepare_delivery(p_id uuid,p_lease uuid)
returns jsonb language plpgsql set search_path='' as $$
declare item public.sla_ops_outbox; client boolean;
begin
 select * into item from public.sla_ops_outbox
 where id=p_id and lease=p_lease and state='sending' and lease_until>clock_timestamp() for update;
 if not found then return jsonb_build_object('allowed',false); end if;
 if item.kind='warranty_followup' and (
   item.guard->>'table' is distinct from 'garansi' or not exists (
    select 1 from public.garansi g where g.id_garansi=item.guard->>'id'
     and coalesce(g.cabang,'Kendari')=item.cabang and lower(btrim(g.status))='aktif'
   )
 ) then
  update public.sla_ops_outbox set state='obsolete',lease=null,lease_until=null,
   last_error='Pengingat garansi dibatalkan karena kartu tidak berstatus Aktif.'
  where id=item.id;
  return jsonb_build_object('allowed',false,'obsolete',true);
 end if;
 if item.kind='ticket_reminder' and item.marker='RESPON_WARNED' and (
   item.guard->>'table' is distinct from 'tiket' or not exists (
    select 1 from public.tiket t where t.id_tiket=item.guard->>'id'
     and coalesce(t.cabang,'Kendari')=item.cabang and t.waktu_respon is null
     and lower(btrim(t.status)) in ('menunggu','claim garansi')
   )
 ) then
  update public.sla_ops_outbox set state='obsolete',lease=null,lease_until=null,
   last_error='Pengingat respons dibatalkan karena tiket tidak lagi menunggu respons pertama.'
  where id=item.id;
  return jsonb_build_object('allowed',false,'obsolete',true);
 end if;
 client:=public.sla_ops_is_client_message(item.kind,item.cabang,item.phone,item.message);
 if client and not public.sla_client_working_time(item.cabang,clock_timestamp()) then
  update public.sla_ops_outbox set state='pending',attempts=greatest(0,attempts-1),
   lease=null,lease_until=null,available_at=clock_timestamp(),
   last_error='Menunggu hari dan jam kerja Alfacom.'
  where id=item.id;
  return jsonb_build_object('allowed',false,'deferred',true);
 end if;
 return jsonb_build_object('allowed',true,'message',public.sla_ops_branch_contact(case when client then public.sla_client_greeting(item.message) else item.message end,item.cabang));
end $$;
revoke all on function public.sla_ops_prepare_delivery(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sla_ops_prepare_delivery(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
