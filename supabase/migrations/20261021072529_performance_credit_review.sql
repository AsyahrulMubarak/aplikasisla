create or replace function public.sla_performa_akses(p_auth_id uuid,p_username text default null,p_periode text default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare actor public.users%rowtype; target public.users%rowtype; access text; managing boolean; source jsonb; saved jsonb; program public.sla_gaji_program%rowtype; attendance jsonb; begin
 if coalesce(auth.role(),'')<>'service_role' or p_auth_id is null then raise exception 'Akses server diperlukan.'; end if;
 select * into strict actor from public.users where auth_id=p_auth_id;
 access:=lower(coalesce(nullif(btrim(actor.hak_akses_cabang),''),actor.cabang,''));
 managing:=lower(actor.role) in ('admin','admin_raha','manager','direktur');
 if access not in ('kendari','raha','semua') then raise exception 'Hak cabang tidak valid.'; end if;
 if p_username is null then return jsonb_build_object('status','sukses','managing',managing,'users',coalesce((select jsonb_agg(jsonb_build_object('username',u.username,'name',u.nama_asli,'branch',public.sla_gaji_cabang(u)) order by u.nama_asli) from public.users u where lower(u.role) in ('teknisi','freelance') and (u.username=actor.username or managing and (access='semua' or public.sla_gaji_cabang(u)=initcap(access)))),'[]')); end if;
 select * into strict target from public.users where username=p_username;
 if lower(target.role) not in ('teknisi','freelance') or not (target.username=actor.username or managing and (access='semua' or public.sla_gaji_cabang(target)=initcap(access))) then raise exception 'Akses rekap ditolak.'; end if;
 source:=public.sla_performa_sumber(p_username,p_periode);
 select to_jsonb(r) into saved from public.sla_performa_bulan r where username=p_username and periode=p_periode;
 select * into program from public.sla_gaji_program where username=p_username;
 if public.sla_gaji_sekarang()>=((p_periode||'-01')::date+interval '1 month 7 days') at time zone 'Asia/Makassar' then
  select jsonb_build_object('telat_pagi',d.telat_pagi,'alpa',d.alpa) into attendance from public.sla_gaji_disiplin_bulan d where d.username=p_username and d.periode=p_periode;
  if attendance is null then select to_jsonb(d) into attendance from public.sla_disiplin_kenaikan_gaji(p_username,p_periode) d; end if;
 end if;
 return jsonb_build_object('status','sukses','source',source,'saved',saved,'attendance',attendance,
  'eligible',public.sla_gaji_cabang(target)='Kendari' and coalesce(target.gaji_pokok,0)>0 and coalesce(target.gaji_pokok,0)<3000000 and program.username is not null and not program.otomatis_selesai and p_periode>=program.mulai_periode,
  'programStart',program.mulai_periode,'canApprove',managing and target.username<>actor.username,
  'closed',public.sla_gaji_sekarang()>=((p_periode||'-01')::date+interval '1 month 7 days') at time zone 'Asia/Makassar',
  'credits',coalesce((select jsonb_agg(to_jsonb(c) order by c.periode,c.sumber) from public.sla_gaji_kredit c where c.username=p_username),'[]'));
end $$;
revoke all on function public.sla_performa_akses(uuid,text,text) from public,anon,authenticated;
grant execute on function public.sla_performa_akses(uuid,text,text) to service_role;
