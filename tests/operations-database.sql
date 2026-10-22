-- Run inside BEGIN/ROLLBACK. No provider requests or persistent fixtures.
do $$
declare result jsonb; leased public.sla_ops_outbox; count_before int; report jsonb; first_id uuid;
begin
 if public.sla_ops_phone('081234567890')<>'6281234567890' then raise exception 'Phone normalization'; end if;
 perform public.sla_ops_enqueue('qa:ops:dedup','Kendari','[{"phone":"081234567890","message":"Fixture only"}]','qa');
 perform public.sla_ops_enqueue('qa:ops:dedup','Kendari','[{"phone":"081234567890","message":"Fixture only"}]','qa');
 if (select count(*) from public.sla_ops_outbox where event_key='qa:ops:dedup')<>1 then raise exception 'Queue duplicate'; end if;
 begin
  perform public.sla_ops_enqueue('qa:ops:dedup','Raha','[{"phone":"081234567890","message":"Other branch"}]','qa');
  raise exception 'Collision was accepted';
 exception when raise_exception then if SQLERRM='Collision was accepted' then raise; end if; end;
 select * into leased from public.sla_ops_lease('qa:ops:dedup',1);
 if leased.state<>'sending' or leased.attempts<>1 then raise exception 'Queue lease'; end if;
 if not public.sla_ops_ack(leased.id,leased.lease,'retry','Fixture retry') then raise exception 'Retry ack'; end if;
 update public.sla_ops_outbox set available_at=now() where id=leased.id;
 select * into leased from public.sla_ops_lease('qa:ops:dedup',1);
 if leased.attempts<>2 then raise exception 'Retry attempt'; end if;
 perform public.sla_ops_ack(leased.id,leased.lease,'sent',null,'provider-fixture');
 if public.sla_ops_ack(leased.id,leased.lease,'retry') then raise exception 'Stale ack accepted'; end if;
 if exists(select 1 from public.sla_ops_lease('qa:ops:dedup',1)) then raise exception 'Delivered event leased twice'; end if;
 perform public.sla_ops_enqueue('qa:ops:uncertain','Raha','[{"phone":"081234567891","message":"Fixture only"}]','qa');
 select * into leased from public.sla_ops_lease('qa:ops:uncertain',1);
 update public.sla_ops_outbox set lease_until=now()-interval '1 minute' where id=leased.id;
 perform public.sla_ops_lease('qa:ops:uncertain',1);
 if (select state from public.sla_ops_outbox where id=leased.id)<>'uncertain' then raise exception 'Ambiguous send retried'; end if;
 insert into public.tiket(id_tiket,status,teknisi,cabang,waktu_lapor,no_wa_klien,klien_lokasi,jenis_pekerjaan)
 values('TKT-OPS-QA-K','Menunggu','-','Kendari',now(),'081234567892','Fixture Klien','Fixture service');
 if not public.sla_ops_guard_valid('{"table":"tiket","id":"TKT-OPS-QA-K","expected":{"status":"Menunggu","teknisi":"-"}}','Kendari') then raise exception 'Valid guard rejected'; end if;
 if public.sla_ops_guard_valid('{"table":"tiket","id":"TKT-OPS-QA-K","expected":{"status":"Menunggu"}}','Raha') then raise exception 'Cross-branch guard'; end if;
 update public.tiket set status='Pending' where id_tiket='TKT-OPS-QA-K';
 if public.sla_ops_guard_valid('{"table":"tiket","id":"TKT-OPS-QA-K","expected":{"status":"Menunggu"}}','Kendari') then raise exception 'Stale status guard'; end if;
 update public.tiket set status='Selesai' where id_tiket='TKT-OPS-QA-K';
 result:=public.sla_ops_sync_crm('Kendari','Tiket Selesai','TKT-OPS-QA-K','081234567892');
 if result->'data'->>'cabang'<>'Kendari' then raise exception 'CRM branch'; end if;
 count_before:=(result->'data'->>'total_transaksi')::int;
 result:=public.sla_ops_sync_crm('Kendari','Tiket Selesai','TKT-OPS-QA-K','081234567892');
 if (result->'data'->>'total_transaksi')::int<>count_before or result->>'mode'<>'sudah_disinkronkan' then raise exception 'CRM double counted'; end if;
 insert into public.penjualan(id_penjualan,nama_pembeli,barang_jasa,cabang) values('PJL-OPS-QA-R','Fixture Raha','Fixture Product','Raha');
 insert into public.database_klien(no_wa,nama_klien,total_transaksi,cabang) values('6281234567893','Legacy null ID',2,'Raha');
 result:=public.sla_ops_sync_crm('Raha','Penjualan','PJL-OPS-QA-R','081234567893');
 if result->'data'->>'cabang'<>'Raha' then raise exception 'Raha CRM branch'; end if;
 if result->'data'->>'id_klien' is null or (result->'data'->>'total_transaksi')::int<>3 then raise exception 'Legacy null ID CRM row'; end if;
 insert into public.prospek(id_prospek,cabang,status_prospek,tanggal_input) values('PRP-OPS-QA','Raha','Tahap Penawaran',now()-interval '31 days');
 perform public.sla_ops_expire_prospect('PRP-OPS-QA','Raha','{"status_prospek":"Closing / Deal"}','qa:expired','[]');
 if (select status_prospek from public.prospek where id_prospek='PRP-OPS-QA')<>'Tahap Penawaran' then raise exception 'Expired changed stale prospect'; end if;
 perform public.sla_ops_expire_prospect('PRP-OPS-QA','Raha','{"status_prospek":"Tahap Penawaran"}','qa:expired','[]');
 if (select status_prospek from public.prospek where id_prospek='PRP-OPS-QA')<>'Tanpa Keterangan' then raise exception 'Prospect expiry'; end if;
 report:=public.sla_ops_create_bug('ops-qa-report','Raha','fixture','Fixture','Fixture only');first_id:=(report->>'id')::uuid;
 report:=public.sla_ops_create_bug('ops-qa-report','Raha','fixture','Fixture','Fixture only');
 if (report->>'id')::uuid<>first_id then raise exception 'Bug duplicate'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname like 'sla_ops_%' and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) then raise exception 'Public operational RPC'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'sla_ops_%' and c.relkind='r' and not c.relrowsecurity) then raise exception 'Operational RLS missing'; end if;
end $$;
select 'queue, guards, CRM idempotency, branches, expiry, bug idempotency and ACL verified' as verification;
