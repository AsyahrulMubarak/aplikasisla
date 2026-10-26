-- Transaction-only verification; no provider is called and no fixture is committed.
begin;
do $$
declare g record; item public.sla_ops_outbox; delivery jsonb; checked int:=0; body text; contact text; ticket_id text;
begin
 select public.sla_ops_phone(no_wa) into contact from public.users
 where role='admin_raha' and account_active is distinct from false and hak_akses_cabang='Raha' order by username limit 1;
 if contact is null then raise exception 'Admin Raha contact missing'; end if;
 body:=public.sla_ops_branch_contact('Detail tiket uji transaksi','Raha');
 if position('https://wa.me/'||contact in body)=0 then raise exception 'Raha contact missing from message'; end if;
 if public.sla_ops_branch_contact(body,'Raha')<>body then raise exception 'Repeated contact footer'; end if;
 if public.sla_ops_branch_contact('Detail Kendari','Kendari')<>'Detail Kendari' then raise exception 'Kendari message changed'; end if;
 for g in select distinct on(cabang,status) id_garansi,cabang,status from public.garansi
  where status in ('Masa Tunggu','Belum Diambil','Aktif') and cabang in ('Kendari','Raha') order by cabang,status,id_garansi
 loop
  insert into public.sla_ops_outbox(event_key,cabang,phone,message,kind,guard,state,lease,lease_until)
  values('qa:active-raha:'||gen_random_uuid(),g.cabang,'6281111111111','Uji transaksi; tidak dikirim','warranty_followup',
   jsonb_build_object('table','garansi','id',g.id_garansi,'expected',jsonb_build_object('status',g.status)),
   'sending',gen_random_uuid(),clock_timestamp()+interval '3 minutes') returning * into item;
  delivery:=public.sla_ops_prepare_delivery(item.id,item.lease);
  if g.status<>'Aktif' then
   checked:=checked+1;
   if delivery->>'obsolete'<>'true' or delivery->>'allowed'<>'false' then raise exception 'Waiting warranty permitted'; end if;
   if not exists(select 1 from public.sla_ops_outbox where id=item.id and state='obsolete' and sent_at is null) then raise exception 'Obsolete not saved'; end if;
  elsif public.sla_client_working_time(g.cabang,clock_timestamp()) then
   if delivery->>'allowed'<>'true' then raise exception 'Active warranty blocked'; end if;
   if g.cabang='Raha' and position('https://wa.me/'||contact in delivery->>'message')=0 then raise exception 'Prepared message missing Raha contact'; end if;
  end if;
 end loop;
 if checked=0 then raise exception 'No waiting warranty tested'; end if;
 select id_tiket into ticket_id from public.tiket where id_tiket='TKT-097' and status='On Progress';
 if ticket_id is null then raise exception 'Replacement ticket not found'; end if;
 insert into public.sla_ops_outbox(event_key,cabang,phone,message,kind,marker,guard,state,lease,lease_until)
 select 'qa:active-raha:'||gen_random_uuid(),cabang,'6281111111111','Uji transaksi; tidak dikirim','ticket_reminder','RESPON_WARNED',
   jsonb_build_object('table','tiket','id',id_tiket),'sending',gen_random_uuid(),clock_timestamp()+interval '3 minutes'
 from public.tiket where id_tiket=ticket_id returning * into item;
 delivery:=public.sla_ops_prepare_delivery(item.id,item.lease);
 if delivery->>'obsolete'<>'true' or delivery->>'allowed'<>'false' then raise exception 'On Progress response warning permitted'; end if;
 if has_function_privilege('anon','public.sla_ops_branch_contact(text,text)','execute') or
    has_function_privilege('authenticated','public.sla_ops_branch_contact(text,text)','execute') then raise exception 'Contact helper exposed'; end if;
end $$;
rollback;
