-- All operational integrations now run on Supabase. These objects are server-only.
create table public.sla_ops_control (
 id boolean primary key default true check(id), enabled boolean not null default false,
 cutover_at timestamptz, updated_at timestamptz not null default now()
);
insert into public.sla_ops_control(id) values(true);
create table public.sla_ops_outbox (
 id uuid primary key default gen_random_uuid(), event_key text not null, cabang text not null check(cabang in ('Kendari','Raha')),
 phone text not null check(phone ~ '^62[0-9]{8,13}$'), message text not null check(length(message) between 1 and 6000),
 kind text not null, actor text, guard jsonb not null default '{}', marker text,
 state text not null default 'pending' check(state in ('pending','sending','sent','obsolete','failed','uncertain')),
 attempts int not null default 0, available_at timestamptz not null default now(), lease uuid, lease_until timestamptz,
 provider_id text, last_error text, created_at timestamptz not null default now(), sent_at timestamptz,
 unique(event_key,phone)
);
create index sla_ops_outbox_due on public.sla_ops_outbox(available_at,created_at) where state='pending';
create index sla_ops_outbox_guard on public.sla_ops_outbox((guard->>'table'),(guard->>'id'));
create table public.sla_ops_crm_receipts (
 cabang text not null check(cabang in ('Kendari','Raha')), source text not null, reference text not null,
 customer_id text not null, created_at timestamptz not null default now(), primary key(cabang,source,reference)
);
create table public.sla_ops_bug_reports (
 id uuid primary key default gen_random_uuid(), request_id text not null, cabang text not null check(cabang in ('Kendari','Raha')),
 actor text not null, reporter text not null, description text not null check(length(description) between 1 and 5000),
 evidence_path text, created_at timestamptz not null default now(), unique(actor,request_id)
);
create table public.sla_ops_broadcasts (
 id uuid primary key default gen_random_uuid(), request_id text not null, cabang text not null check(cabang in ('Kendari','Raha')),
 actor text not null, payload_hash text not null, created_at timestamptz not null default now(), unique(actor,request_id)
);
do $$ declare t text; begin
 foreach t in array array['sla_ops_control','sla_ops_outbox','sla_ops_crm_receipts','sla_ops_bug_reports','sla_ops_broadcasts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public, anon, authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('sla-bug-private','sla-bug-private',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;

create function public.sla_ops_phone(p_value text) returns text language sql immutable set search_path='' as $$
 select case when n ~ '^62[0-9]{8,13}$' then n else null end from
 (select regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(p_value,''),'[[:space:]().+-]','','g'),'^0062','62'),'^0','62'),'^8','628') n) p
$$;
create function public.sla_ops_guard_valid(p_guard jsonb,p_branch text) returns boolean
language plpgsql stable set search_path='' as $$
declare row_data jsonb;
begin
 if coalesce(p_guard->>'table','')='' then return true; end if;
 if p_guard->>'table'='tiket' then select to_jsonb(t) into row_data from public.tiket t where id_tiket=p_guard->>'id' and coalesce(cabang,'Kendari')=p_branch;
 elsif p_guard->>'table'='prospek' then select to_jsonb(p) into row_data from public.prospek p where id_prospek=p_guard->>'id' and coalesce(cabang,'Kendari')=p_branch;
 elsif p_guard->>'table'='garansi' then select to_jsonb(g) into row_data from public.garansi g where id_garansi=p_guard->>'id' and coalesce(cabang,'Kendari')=p_branch;
 else return false; end if;
 if row_data is null or not row_data @> coalesce(p_guard->'expected','{}') then return false; end if;
 if p_guard ? 'noWarranty' and exists(select 1 from public.garansi where referensi_tiket_nota=p_guard->>'id' and coalesce(cabang,'Kendari')=p_branch) then return false; end if;
 if p_guard ? 'ticket' and not public.sla_ops_guard_valid(p_guard->'ticket',p_branch) then return false; end if;
 return true;
end $$;
create function public.sla_ops_enqueue(p_key text,p_branch text,p_messages jsonb,p_kind text,p_actor text default null,p_guard jsonb default '{}',p_marker text default null)
returns jsonb language plpgsql set search_path='' as $$
declare item jsonb; result jsonb;
begin
 if p_branch not in ('Kendari','Raha') or length(p_key) not between 1 and 250 or jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages)>50 then raise exception 'Antrean tidak valid'; end if;
 if not public.sla_ops_guard_valid(p_guard,p_branch) then return '[]'::jsonb; end if;
 for item in select value from jsonb_array_elements(p_messages) loop
  if public.sla_ops_phone(item->>'phone') is null then raise exception 'Nomor WhatsApp tidak valid'; end if;
  if exists(select 1 from public.sla_ops_outbox where event_key=p_key and phone=public.sla_ops_phone(item->>'phone') and (cabang<>p_branch or message<>item->>'message' or kind<>p_kind or actor is distinct from p_actor)) then raise exception 'ID permintaan sudah dipakai untuk isi lain'; end if;
  insert into public.sla_ops_outbox(event_key,cabang,phone,message,kind,actor,guard,marker)
  values(p_key,p_branch,public.sla_ops_phone(item->>'phone'),item->>'message',p_kind,p_actor,p_guard,p_marker)
  on conflict(event_key,phone) do nothing;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'phone',phone,'state',state,'event_key',event_key)),'[]') into result
 from public.sla_ops_outbox where event_key=p_key;
 return result;
end $$;
create function public.sla_ops_lease(p_key text default null,p_limit int default 5) returns setof public.sla_ops_outbox
language plpgsql set search_path='' as $$
begin
 -- A worker may have sent a message before crashing. Never blindly resend it.
 update public.sla_ops_outbox set state='uncertain',last_error='Worker berhenti setelah mengambil antrean; periksa provider sebelum mengirim ulang.' where state='sending' and lease_until<now();
 return query with due as (
  select id from public.sla_ops_outbox where state='pending' and available_at<=now() and (p_key is null or event_key=p_key)
  order by created_at,id for update skip locked limit greatest(1,least(p_limit,10))
 ) update public.sla_ops_outbox o set state='sending',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '3 minutes'
 from due where o.id=due.id returning o.*;
end $$;
create function public.sla_ops_ack(p_id uuid,p_lease uuid,p_outcome text,p_error text default null,p_provider text default null)
returns boolean language plpgsql set search_path='' as $$
declare item public.sla_ops_outbox; complete boolean;
begin
 if p_outcome not in ('sent','retry','obsolete','uncertain') then raise exception 'Hasil pengiriman tidak valid'; end if;
 select * into item from public.sla_ops_outbox where id=p_id and lease=p_lease and state='sending' for update;
 if not found then return false; end if;
 update public.sla_ops_outbox set state=case when p_outcome='retry' then case when attempts>=5 then 'failed' else 'pending' end else p_outcome end,
 available_at=now()+make_interval(secs=>least(3600,60*power(2,item.attempts)::int)),
 last_error=left(p_error,500),provider_id=p_provider,sent_at=case when p_outcome='sent' then now() else null end,lease_until=null
 where id=p_id;
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
end $$;
create function public.sla_ops_expire_prospect(p_id text,p_branch text,p_expected jsonb,p_key text,p_messages jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare row_data jsonb;
begin
 select to_jsonb(p) into row_data from public.prospek p where id_prospek=p_id and coalesce(cabang,'Kendari')=p_branch for update;
 if row_data is null or not row_data @> p_expected then return '[]'::jsonb; end if;
 update public.prospek set status_prospek='Tanpa Keterangan' where id_prospek=p_id;
 return public.sla_ops_enqueue(p_key,p_branch,p_messages,'prospect_expired',null,
 jsonb_build_object('table','prospek','id',p_id,'expected',p_expected||jsonb_build_object('status_prospek','Tanpa Keterangan')));
end $$;

create function public.sla_ops_expire_storage(p_id text,p_branch text,p_guard jsonb) returns boolean language plpgsql set search_path='' as $$
begin
 perform 1 from public.garansi where id_garansi=p_id and coalesce(cabang,'Kendari')=p_branch for update;
 if not public.sla_ops_guard_valid(p_guard,p_branch) then return false; end if;
 update public.garansi set status='Habis (Expired)' where id_garansi=p_id and coalesce(cabang,'Kendari')=p_branch and status in ('Masa Tunggu','Belum Diambil') and waktu_diambil is null;
 return found;
end $$;
create function public.sla_ops_recipient_allowed(p_phone text,p_branch text) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.users where account_active is distinct from false and public.sla_ops_phone(no_wa)=p_phone and (coalesce(hak_akses_cabang,cabang,'Kendari') in (p_branch,'Semua') or lower(role)='sales'))
 or exists(select 1 from public.tiket where public.sla_ops_phone(no_wa_klien)=p_phone and coalesce(cabang,'Kendari')=p_branch)
 or exists(select 1 from public.prospek where public.sla_ops_phone(no_wa)=p_phone and coalesce(cabang,'Kendari')=p_branch)
 or exists(select 1 from public.database_klien where public.sla_ops_phone(no_wa)=p_phone and coalesce(cabang,'Kendari')=p_branch)
$$;
create function public.sla_ops_start_broadcast(p_request text,p_branch text,p_actor text,p_hash text) returns uuid language plpgsql set search_path='' as $$
declare b public.sla_ops_broadcasts;
begin
 insert into public.sla_ops_broadcasts(request_id,cabang,actor,payload_hash) values(p_request,p_branch,p_actor,p_hash) on conflict(actor,request_id) do nothing;
 select * into b from public.sla_ops_broadcasts where actor=p_actor and request_id=p_request;
 if b.cabang<>p_branch or b.payload_hash<>p_hash then raise exception 'ID broadcast sudah dipakai untuk isi lain'; end if;
 return b.id;
end $$;
create function public.sla_ops_create_bug(p_request text,p_branch text,p_actor text,p_reporter text,p_description text) returns jsonb language plpgsql set search_path='' as $$
declare r public.sla_ops_bug_reports;
begin
 insert into public.sla_ops_bug_reports(request_id,cabang,actor,reporter,description) values(p_request,p_branch,p_actor,p_reporter,p_description) on conflict(actor,request_id) do nothing;
 select * into r from public.sla_ops_bug_reports where actor=p_actor and request_id=p_request;
 if r.cabang<>p_branch or r.description<>p_description then raise exception 'ID laporan sudah dipakai untuk isi lain'; end if;
 return to_jsonb(r);
end $$;
create function public.sla_ops_sync_crm(p_branch text,p_source text,p_reference text,p_phone text) returns jsonb
language plpgsql set search_path='' as $$
declare transaction_data jsonb; customer public.database_klien; receipt public.sla_ops_crm_receipts; customer_name text; product text; phone text;
begin
 if p_branch not in ('Kendari','Raha') or p_source not in ('Tiket Selesai','Penjualan') then raise exception 'Sumber transaksi CRM tidak valid'; end if;
 phone:=public.sla_ops_phone(p_phone); if phone is null then raise exception 'Nomor pelanggan tidak valid'; end if;
 perform pg_advisory_xact_lock(hashtextextended('sla-crm:'||phone,0));
 if p_source='Tiket Selesai' then
  select to_jsonb(t) into transaction_data from public.tiket t where id_tiket=p_reference and status='Selesai' and coalesce(cabang,'Kendari')=p_branch;
  if public.sla_ops_phone(transaction_data->>'no_wa_klien') is distinct from phone then raise exception 'Nomor tidak sesuai tiket'; end if;
  customer_name:=coalesce(nullif(transaction_data->>'klien_lokasi',''),transaction_data->>'nama_customer'); product:=transaction_data->>'jenis_pekerjaan';
 else
  select to_jsonb(p) into transaction_data from public.penjualan p where id_penjualan=p_reference and coalesce(cabang,'Kendari')=p_branch;
  customer_name:=transaction_data->>'nama_pembeli'; product:=transaction_data->>'barang_jasa';
 end if;
 if transaction_data is null or nullif(trim(customer_name),'') is null then raise exception 'Transaksi CRM tidak ditemukan'; end if;
 select * into receipt from public.sla_ops_crm_receipts where cabang=p_branch and source=p_source and reference=p_reference;
 if found then
  select * into customer from public.database_klien where id_klien=receipt.customer_id and coalesce(cabang,'Kendari')=p_branch;
  return jsonb_build_object('status','sukses','mode','sudah_disinkronkan','data',to_jsonb(customer));
 end if;
 select * into customer from public.database_klien where no_wa=phone for update;
 if found and coalesce(customer.cabang,'Kendari')<>p_branch then raise exception 'Nomor pelanggan tercatat pada cabang lain; data tidak digabung otomatis'; end if;
 if customer.no_wa is null then
  insert into public.database_klien(id_klien,nama_klien,no_wa,kategori,total_transaksi,transaksi_terakhir,sumber,tag_produk,cabang)
  values('KLIEN-'||case when p_branch='Raha' then 'R-' else 'K-' end||gen_random_uuid()::text,trim(customer_name),phone,'Pelanggan Aktif',1,now(),p_source,coalesce(product,''),p_branch) returning * into customer;
 else
  update public.database_klien set id_klien=coalesce(nullif(id_klien,''),'KLIEN-'||case when p_branch='Raha' then 'R-' else 'K-' end||gen_random_uuid()::text),nama_klien=trim(customer_name),total_transaksi=coalesce(total_transaksi,0)+1,transaksi_terakhir=now(),sumber=p_source,cabang=p_branch,
  tag_produk=(select string_agg(v,', ' order by v) from (select distinct trim(x) v from regexp_split_to_table(coalesce(customer.tag_produk,'')||','||coalesce(product,''),'[,;]') x where trim(x)<>'') tags)
  where no_wa=phone returning * into customer;
 end if;
 insert into public.sla_ops_crm_receipts(cabang,source,reference,customer_id) values(p_branch,p_source,p_reference,customer.id_klien);
 return jsonb_build_object('status','sukses','mode','diperbarui','data',to_jsonb(customer));
end $$;
do $$ declare f regprocedure; begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'sla_ops_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
