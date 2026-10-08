-- Customer tracking is mediated by a verified Edge Function; documents stay private.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('sla-ticket-documents','sla-ticket-documents',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table public.sla_tracking_limits (
  key_hash text not null,
  window_start timestamptz not null,
  hits integer not null check(hits>0),
  primary key(key_hash,window_start)
);
create table public.sla_ticket_documents (
  object_path text primary key check(object_path ~ '^ba/[A-Za-z0-9._-]+/[0-9a-f-]+\.pdf$'),
  id_tiket text not null references public.tiket(id_tiket) on update cascade on delete restrict,
  original_url text,
  source_version text,
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer not null check(size_bytes between 1 and 10485760),
  created_at timestamptz not null default now(),
  created_by uuid
);
create index sla_ticket_documents_ticket on public.sla_ticket_documents(id_tiket);
create table public.sla_migrasi_dokumen_tiket (
  id_tiket text primary key references public.tiket(id_tiket) on update cascade on delete restrict,
  original_url text not null,
  object_path text,
  status text not null check(status in ('pending','imported','failed','changed')),
  attempts integer not null default 1 check(attempts>0),
  error text,
  updated_at timestamptz not null default now()
);
alter table public.sla_tracking_limits enable row level security;
alter table public.sla_ticket_documents enable row level security;
alter table public.sla_migrasi_dokumen_tiket enable row level security;
create policy tracking_limits_service on public.sla_tracking_limits for all to service_role using(true) with check(true);
create policy ticket_documents_service on public.sla_ticket_documents for all to service_role using(true) with check(true);
create policy ticket_document_migration_service on public.sla_migrasi_dokumen_tiket for all to service_role using(true) with check(true);
revoke all on public.sla_tracking_limits,public.sla_ticket_documents,public.sla_migrasi_dokumen_tiket from public,anon,authenticated;
grant select,insert,update,delete on public.sla_tracking_limits,public.sla_ticket_documents,public.sla_migrasi_dokumen_tiket to service_role;

create function public.sla_consume_tracking_limit(p_key text,p_max integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_hits integer;
begin
  if p_key !~ '^[0-9a-f]{64}$' or p_max not between 1 and 300 then raise exception 'Invalid limit'; end if;
  delete from public.sla_tracking_limits where window_start<now()-interval '2 days';
  insert into public.sla_tracking_limits(key_hash,window_start,hits)
    values(p_key,date_trunc('minute',now()),1)
    on conflict(key_hash,window_start) do update set hits=public.sla_tracking_limits.hits+1
    returning hits into v_hits;
  return v_hits<=p_max;
end;
$$;
revoke all on function public.sla_consume_tracking_limit(text,integer) from public,anon,authenticated;
grant execute on function public.sla_consume_tracking_limit(text,integer) to service_role;

-- Called only by the service-role Edge after validating a live Auth user.
-- Compare the BA snapshot before linking the immutable uploaded document.
create function public.sla_commit_ticket_document(
  p_ticket text,p_old_url text,p_expected jsonb,p_path text,p_sha text,p_size integer,
  p_actor uuid,p_original text,p_version text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_ticket public.tiket%rowtype; v_actor public.users%rowtype; v_home text; v_expected jsonb;
begin
  select * into strict v_ticket from public.tiket where id_tiket=p_ticket for update;
  if v_ticket.link_pdf_ba is distinct from p_old_url then raise exception 'Dokumen berubah; muat ulang tiket.'; end if;
  if p_path not like 'ba/'||p_ticket||'/%' then raise exception 'Lokasi dokumen tidak sesuai tiket.'; end if;
  if p_actor is not null then
    select * into strict v_actor from public.users where auth_id=p_actor;
    v_home:=lower(coalesce(nullif(v_actor.cabang,''),'Kendari'));
    if lower(coalesce(v_actor.hak_akses_cabang,'')) in ('kendari','raha') then v_home:=lower(v_actor.hak_akses_cabang); end if;
    if lower(coalesce(v_actor.role,'')) not in ('admin','admin_raha','manager','direktur','teknisi')
      or (lower(v_actor.role)='admin_raha' and lower(coalesce(v_ticket.cabang,'Kendari'))<>'raha')
      or (coalesce(v_actor.hak_akses_cabang,'')<>'Semua' and lower(coalesce(v_ticket.cabang,'Kendari'))<>v_home)
      or (lower(v_actor.role)='teknisi' and not exists(
        select 1 from unnest(string_to_array(coalesce(v_ticket.teknisi,''),',')) n
        where lower(trim(n))=lower(trim(v_actor.nama_asli))
      )) then raise exception 'Anda tidak berhak membuat dokumen tiket ini.'; end if;
    v_expected:=jsonb_build_object('id_tiket',v_ticket.id_tiket,'status',v_ticket.status,
      'waktu_selesai',v_ticket.waktu_selesai,'klien_lokasi',v_ticket.klien_lokasi,'teknisi',v_ticket.teknisi,
      'deskripsi_pekerjaan_ba',v_ticket.deskripsi_pekerjaan_ba,'kritik_saran',v_ticket.kritik_saran,
      'nama_customer',v_ticket.nama_customer,'tanda_tangan',v_ticket.tanda_tangan);
    -- Timestamp strings are canonicalized by PostgREST, compare them as timestamps.
    if (v_expected-'waktu_selesai') is distinct from (p_expected-'waktu_selesai')
      or v_ticket.waktu_selesai is distinct from (p_expected->>'waktu_selesai')::timestamptz
      or lower(coalesce(v_ticket.status,''))<>'selesai' then raise exception 'Data BA berubah; muat ulang tiket.'; end if;
  elsif p_original is null or p_original is distinct from v_ticket.link_pdf_ba or p_expected is not null then
    raise exception 'Sumber migrasi tidak sesuai.';
  end if;
  insert into public.sla_ticket_documents(object_path,id_tiket,original_url,source_version,sha256,size_bytes,created_by)
    values(p_path,p_ticket,p_original,p_version,p_sha,p_size,p_actor);
  update public.tiket set link_pdf_ba='storage:'||p_path where id_tiket=p_ticket;
  return jsonb_build_object('reference','storage:'||p_path);
end;
$$;
revoke all on function public.sla_commit_ticket_document(text,text,jsonb,text,text,integer,uuid,text,text) from public,anon,authenticated;
grant execute on function public.sla_commit_ticket_document(text,text,jsonb,text,text,integer,uuid,text,text) to service_role;


