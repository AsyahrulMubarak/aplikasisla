create index if not exists sla_tracking_limits_expiry on public.sla_tracking_limits(window_start);

create or replace function public.sla_commit_ticket_document(
  p_ticket text,p_old_url text,p_expected jsonb,p_path text,p_sha text,p_size integer,
  p_actor uuid,p_original text,p_version text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_ticket public.tiket%rowtype; v_actor public.users%rowtype; v_home text; v_expected jsonb;
begin
  select * into strict v_ticket from public.tiket where id_tiket=p_ticket for update;
  if v_ticket.link_pdf_ba is distinct from p_old_url then raise exception 'Dokumen berubah; muat ulang tiket.'; end if;
  if left(p_path,length('ba/'||p_ticket||'/')) is distinct from 'ba/'||p_ticket||'/' then raise exception 'Lokasi dokumen tidak sesuai tiket.'; end if;
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


