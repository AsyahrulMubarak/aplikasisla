-- Preserve old delivery markers without overwriting newer operational records.
create table private.sla_ops_legacy_archive (
 cabang text primary key check(cabang in ('Kendari','Raha')), payload jsonb not null, imported_at timestamptz not null default now()
);
alter table private.sla_ops_legacy_archive enable row level security;
revoke all on private.sla_ops_legacy_archive from public,anon,authenticated;
grant all on private.sla_ops_legacy_archive to service_role;
alter table public.sla_ops_bug_reports add column legacy_evidence_url text;
create function public.sla_ops_sheet_time(p_value text) returns timestamptz language plpgsql immutable set search_path='' as $$
begin
 if p_value is null or trim(p_value)='' then return null; end if;
 return (case when p_value ~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then p_value else p_value||'+08:00' end)::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end $$;
create function public.sla_ops_import_archive(p_branch text,p_payload jsonb) returns jsonb language plpgsql set search_path='' as $$
declare old jsonb; current_ticket public.tiket; current_warranty public.garansi; mark text; allowed boolean; marks int:=0; warranties int:=0; prospects int:=0; bugs int:=0; n int:=0; report_id uuid;
begin
 if p_branch not in ('Kendari','Raha') then raise exception 'Cabang arsip tidak valid'; end if;
 insert into private.sla_ops_legacy_archive(cabang,payload) values(p_branch,p_payload) on conflict(cabang) do nothing;
 for old in select value from jsonb_array_elements(coalesce(p_payload->'tickets','[]')) loop
  select * into current_ticket from public.tiket where id_tiket=old->>'ID Tiket' and coalesce(cabang,'Kendari')=p_branch for update;
  if not found or lower(trim(current_ticket.status))<>lower(trim(old->>'Status')) or trim(coalesce(current_ticket.teknisi,''))<>trim(coalesce(old->>'Teknisi','')) or current_ticket.waktu_lapor is distinct from public.sla_ops_sheet_time(old->>'Waktu Lapor') then continue; end if;
  for mark in select x[1] from regexp_matches(old->>'Status Peringatan','\[(RESPON_WARNED|PENGERJAAN_WARNED|ADMIN_NOTA_FAILED|ADMIN_SLA_FAILED|MANAJEMEN_MENUNGGU_3H)\]','g') x loop
   allowed:=case mark
    when 'RESPON_WARNED' then current_ticket.waktu_respon is null and current_ticket.tenggat_respon is not distinct from public.sla_ops_sheet_time(old->>'Tenggat Respon')
    when 'PENGERJAAN_WARNED' then current_ticket.tenggat_waktu is not distinct from public.sla_ops_sheet_time(old->>'Tenggat Waktu') and current_ticket.tenggat_pengganti is not distinct from public.sla_ops_sheet_time(old->>'Tenggat Pengganti')
    when 'ADMIN_NOTA_FAILED' then current_ticket.waktu_selesai is not distinct from public.sla_ops_sheet_time(old->>'Waktu Selesai')
    else true end;
   if allowed then
    update public.tiket set status_peringatan=trim(coalesce(status_peringatan,'')||' ['||mark||']') where id_tiket=current_ticket.id_tiket and position(mark in coalesce(status_peringatan,''))=0;
    if found then marks:=marks+1; end if;
   end if;
  end loop;
 end loop;
 -- The old unassigned-technician message notified management in the same pass.
 update public.tiket set status_peringatan=trim(status_peringatan||' [MANAJEMEN_MENUNGGU_3H]') where coalesce(cabang,'Kendari')=p_branch and status='Menunggu' and trim(coalesce(teknisi,'')) in ('','-','Belum Ditugaskan') and status_peringatan like '%ADMIN_SLA_FAILED%' and status_peringatan not like '%MANAJEMEN_MENUNGGU_3H%';
 for old in select value from jsonb_array_elements(coalesce(p_payload->'warranties','[]')) loop
  update public.garansi set follow_up_after_sales_terkirim=old->>'Follow Up After-Sales Terkirim'
  where id_garansi=old->>'ID Garansi' and coalesce(cabang,'Kendari')=p_branch and referensi_tiket_nota=old->>'Referensi (Tiket/Nota)'
   and durasi_hari::text=old->>'Durasi (Hari)' and tanggal_mulai is not distinct from public.sla_ops_sheet_time(old->>'Tanggal Mulai')
   and tanggal_habis is not distinct from public.sla_ops_sheet_time(old->>'Tanggal Habis')
   and nullif(follow_up_after_sales_terkirim,'') is null and nullif(old->>'Follow Up After-Sales Terkirim','') is not null;
  if found then warranties:=warranties+1; end if;
 end loop;
 for old in select value from jsonb_array_elements(coalesce(p_payload->'prospects','[]')) loop
  update public.prospek set waktu_peringatan_crm_terakhir=greatest(waktu_peringatan_crm_terakhir,public.sla_ops_sheet_time(old->>'Waktu Peringatan CRM Terakhir'))
  where id_prospek=old->>'ID Prospek' and coalesce(cabang,'Kendari')=p_branch and lower(trim(status_prospek))=lower(trim(old->>'Status Prospek'))
   and waktu_follow_up_terakhir is not distinct from public.sla_ops_sheet_time(old->>'Waktu Follow Up Terakhir');
  if found then prospects:=prospects+1; end if;
 end loop;
 for old in select value from jsonb_array_elements(coalesce(p_payload->'bugs','[]')) loop
  n:=n+1;
  if nullif(old->>'Deskripsi Bug','') is null then continue; end if;
  insert into public.sla_ops_bug_reports(request_id,cabang,actor,reporter,description,legacy_evidence_url,created_at)
  values('legacy-row-'||n,p_branch,'arsip-gas-'||lower(p_branch),coalesce(old->>'Pelapor','Arsip GAS'),old->>'Deskripsi Bug',old->>'Link Bukti (Foto)',coalesce(public.sla_ops_sheet_time(old->>'Waktu Lapor'),now()))
  on conflict(actor,request_id) do nothing;
  if found then bugs:=bugs+1; end if;
 end loop;
 return jsonb_build_object('cabang',p_branch,'ticketMarkers',marks,'warranties',warranties,'prospects',prospects,'bugReports',bugs);
end $$;
revoke all on function public.sla_ops_sheet_time(text),public.sla_ops_import_archive(text,jsonb) from public,anon,authenticated;
grant execute on function public.sla_ops_sheet_time(text),public.sla_ops_import_archive(text,jsonb) to service_role;
