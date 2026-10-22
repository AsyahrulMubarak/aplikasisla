-- Attendance preview counts elapsed days only; final monthly salary evaluation is unchanged.
CREATE OR REPLACE FUNCTION public.sla_disiplin_kredit_berjalan(p_username text, p_periode text)
 RETURNS TABLE(telat_pagi integer, alpa integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user public.users%rowtype; v_branch text; v_start date; v_end date; v_day date; v_count integer;
 v_events boolean; v_sick boolean; v_leave boolean; v_holiday boolean; v_morning timestamp; v_sick_count integer:=0; v_holidays integer[];
 v_limit integer; v_date timestamp; v_row record; v_return timestamptz;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 select * into strict v_user from public.users where username=p_username;
 if p_periode !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Periode tidak valid.'; end if;
 v_branch:=public.sla_gaji_cabang(v_user); v_start:=(p_periode||'-01')::date; v_end:=least((v_start+interval '1 month - 1 day')::date,(public.sla_gaji_sekarang() at time zone 'Asia/Makassar')::date);
 v_limit:=case when v_branch='Raha' and lower(trim(v_user.role)) not in ('admin','admin_raha') then 585 else 525 end;
 select array_agg(x::integer) into v_holidays from public.payroll_bulanan p,
 lateral regexp_split_to_table(coalesce(p.tanggal_libur_tambahan,''),'\s*,\s*') x
 where p.periode=p_periode and lower(trim(p.nama_pegawai))=lower(trim(v_user.nama_asli)) and x ~ '^\d+$';
 telat_pagi:=0; alpa:=0;
 for v_day in select generate_series(v_start::timestamp,v_end::timestamp,interval '1 day')::date loop
   if extract(dow from v_day)=0 or extract(day from v_day)::integer=any(coalesce(v_holidays,'{}')) then continue; end if;
   v_events:=false; v_sick:=false; v_leave:=false; v_morning:=null;
   for v_row in select a.*,a.waktu_absen at time zone 'Asia/Makassar' as lokal from public.absensi a
    where lower(trim(a.nama_pegawai))=lower(trim(v_user.nama_asli)) and coalesce(a.cabang,'Kendari')=v_branch
      and a.waktu_absen>=(v_day::timestamp at time zone 'Asia/Makassar') and a.waktu_absen<((v_day+1)::timestamp+interval '6 hours') at time zone 'Asia/Makassar'
    order by a.waktu_absen loop
     if v_row.tipe_absen='Absen Diabaikan' then continue; end if;
     -- Approved leave is rebuilt below, so stale projected rows cannot extend it after return.
     if v_row.tipe_absen in ('Sakit','Izin') and v_row.status_disiplin='Pengajuan Disetujui'
       and exists(select 1 from public.pengajuan_cuti p where p.status='Disetujui'
         and v_row.id_absen ~ ('^ABS-'||p.id_pengajuan||'-[0-9]{8}$')) then continue; end if;
     v_date:=v_row.lokal;
     if v_row.tipe_absen ~ '(Keluar|Pulang)' and extract(hour from v_date)<6 then v_date:=v_date-interval '1 day'; end if;
     if v_date::date<>v_day then continue; end if;
     if v_row.tipe_absen ~ '(Masuk|Keluar|Pulang)' then v_events:=true; end if;
     if v_row.tipe_absen like '%Sakit%' then v_sick:=true; end if;
     if v_row.tipe_absen like '%Izin%' then v_leave:=true; end if;
     if v_row.tipe_absen like '%Masuk%' and v_row.tipe_absen not like '%Setelah Istirahat%'
       and (extract(hour from v_date)<12 or v_row.status_disiplin='Terlambat Masuk' or coalesce(v_row.status_disiplin,'') ~ 'Lupa Absen Masuk|Auto Masuk') then
       if v_morning is null or v_date<v_morning then v_morning:=v_date; end if;
     end if;
   end loop;
   for v_row in select * from public.pengajuan_cuti p where p.status='Disetujui' and p.jenis in ('Sakit','Izin')
    and lower(trim(p.nama_pegawai))=lower(trim(v_user.nama_asli)) and coalesce(p.cabang,'Kendari')=v_branch
    and p.tanggal_mulai<=v_day and (p.jenis='Sakit' or p.tanggal_selesai is null or p.tanggal_selesai>=v_day) loop
     select least(v_row.kembali_bekerja_pada,min(a.waktu_absen)) into v_return from public.absensi a
      where lower(trim(a.nama_pegawai))=lower(trim(v_user.nama_asli)) and coalesce(a.cabang,'Kendari')=v_branch
       and a.waktu_absen>=(v_row.tanggal_mulai::timestamp at time zone 'Asia/Makassar')
       and a.tipe_absen in ('Masuk','Masuk Setelah Istirahat') and coalesce(a.status_disiplin,'') !~* 'Lupa Absen Masuk|Koreksi|Auto';
     if v_return is null or v_return>(v_day::timestamp+interval '8 hours') at time zone 'Asia/Makassar' then
       if v_return is null or (v_return at time zone 'Asia/Makassar')::date>=v_day then
         if v_row.jenis='Sakit' then v_sick:=true; else v_leave:=true; end if;
       end if;
     end if;
   end loop;
   if v_sick then v_sick_count:=v_sick_count+1; end if;
   if v_day<(public.sla_gaji_sekarang() at time zone 'Asia/Makassar')::date and not v_events and not v_sick and not v_leave then alpa:=alpa+1; end if;
   if v_morning is not null and not (v_sick and v_sick_count<=3)
    and (extract(hour from v_morning)*60+extract(minute from v_morning))>v_limit then telat_pagi:=telat_pagi+1; end if;
 end loop;
 return next;
end $function$;
create or replace function public.sla_lobby_kredit_sumber(p_auth_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare actor public.users%rowtype; v_period text; access text;
begin
 if coalesce(auth.role(),'')<>'service_role' or p_auth_id is null then raise exception 'Akses server diperlukan.'; end if;
 if (select count(*) from public.users where auth_id=p_auth_id)<>1 then raise exception 'Profil tidak unik.'; end if;
 select * into actor from public.users where auth_id=p_auth_id;
 if actor.account_active=false then raise exception 'Akun nonaktif.'; end if;
 access:=lower(coalesce(nullif(btrim(actor.hak_akses_cabang),''),actor.cabang,''));
 if access not in ('kendari','raha','semua') then raise exception 'Hak cabang tidak valid.'; end if;
 v_period:=to_char(public.sla_gaji_sekarang() at time zone 'Asia/Makassar','YYYY-MM');
 return jsonb_build_object('status','sukses','period',v_period,'allEmployees',access='semua','rows',coalesce((
  select jsonb_agg(jsonb_build_object('username',u.username,'name',u.nama_asli,'role',lower(u.role),'branch',public.sla_gaji_cabang(u),
   'programStart',p.mulai_periode,'programFinished',coalesce(p.otomatis_selesai,false) or u.gaji_pokok>=3000000,
   'attendance',to_jsonb(a),'source',public.sla_performa_sumber(u.username,v_period)) order by public.sla_gaji_cabang(u),u.nama_asli)
  from public.users u left join public.sla_gaji_program p on p.username=u.username
  cross join lateral public.sla_disiplin_kredit_berjalan(u.username,v_period) a
  where coalesce(u.gaji_pokok,0)>0 and u.account_active is not false and lower(u.role) in ('teknisi','freelance','sales')
   and (access='semua' or u.username=actor.username)
 ),'[]'));
end $$;
revoke all on function public.sla_lobby_kredit_sumber(uuid),public.sla_disiplin_kredit_berjalan(text,text) from public,anon,authenticated;
grant execute on function public.sla_lobby_kredit_sumber(uuid),public.sla_disiplin_kredit_berjalan(text,text) to service_role;
notify pgrst,'reload schema';
