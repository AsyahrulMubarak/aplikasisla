create or replace function public.sla_evaluasi_kenaikan_gaji()
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_now timestamptz:=public.sla_gaji_sekarang(); v_local timestamp:=v_now at time zone 'Asia/Makassar';
 v_last date; v_period text; v_start date; v_user public.users%rowtype; v_program record; v_stats record;
 v_months text[]; v_keys text[]; v_id uuid; v_salary numeric; v_count integer; v_evaluated integer:=0; v_raised integer:=0;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 if not pg_try_advisory_xact_lock(734252611) then return jsonb_build_object('status','sibuk'); end if;
 v_last:=(date_trunc('month',v_local)-case when extract(day from v_local)>=8 then interval '1 month' else interval '2 months' end)::date;
 for v_program in select * from public.sla_gaji_program where not otomatis_selesai order by username loop
  select * into v_user from public.users where username=v_program.username for update;
  if not found or coalesce(v_user.gaji_pokok,0)<=0 or v_user.gaji_pokok>=3000000 or public.sla_gaji_cabang(v_user)<>'Kendari' then continue; end if;
  -- Reviews and the evaluator serialize on the employee/period lock. Used credits remain immutable.
  v_start:=greatest('2026-10-01'::date,(v_program.mulai_periode||'-01')::date);
  for v_period in select to_char(d,'YYYY-MM') from generate_series(v_start::timestamp,v_last::timestamp,interval '1 month') d loop
   perform pg_advisory_xact_lock(hashtextextended('performance:'||v_user.username||':'||v_period,0));
   if not exists(select 1 from public.sla_gaji_disiplin_bulan where username=v_user.username and periode=v_period) then
    select count(*) into v_count from public.users u where lower(trim(u.nama_asli))=lower(trim(v_user.nama_asli)) and public.sla_gaji_cabang(u)=public.sla_gaji_cabang(v_user);
    v_salary:=public.sla_gaji_nominal_periode(v_user.username,v_period);
    if v_count<>1 or v_salary<=0 or v_salary>=3000000 then
     insert into public.sla_gaji_disiplin_bulan values(v_user.username,v_period,0,0,false,case when v_count<>1 then 'Profil bernama sama dalam cabang; perlu ditinjau Manajemen.' else 'Gaji pokok di luar program otomatis.' end,v_salary,null,v_now);
    else
     select * into v_stats from public.sla_disiplin_kenaikan_gaji(v_user.username,v_period);
     insert into public.sla_gaji_disiplin_bulan values(v_user.username,v_period,v_stats.telat_pagi,v_stats.alpa,v_stats.telat_pagi<=3 and v_stats.alpa<=2,
      case when v_stats.telat_pagi>3 or v_stats.alpa>2 then 'Telat pagi >3 kali atau alpa >2 hari.' else 'Memenuhi batas disiplin.' end,v_salary,null,v_now);
    end if;
    v_evaluated:=v_evaluated+1;
   end if;
   insert into public.sla_gaji_kredit(username,periode,sumber,kenaikan_id)
    select username,periode,'kehadiran',kenaikan_id from public.sla_gaji_disiplin_bulan where username=v_user.username and periode=v_period and memenuhi_syarat on conflict do nothing;
   delete from public.sla_gaji_kredit c where c.username=v_user.username and c.periode=v_period and c.sumber='performa' and c.kenaikan_id is null
    and not exists(select 1 from public.sla_performa_bulan r where r.username=c.username and r.periode=c.periode and (r.hasil->>'pass')::boolean and r.source_hash=public.sla_performa_sumber(r.username,r.periode)->>'hash');
   -- Performance may be approved after attendance evaluation; existing months must be revisited.
   insert into public.sla_gaji_kredit(username,periode,sumber)
    select r.username,r.periode,'performa' from public.sla_performa_bulan r where r.username=v_user.username and r.periode=v_period and r.periode>='2026-11'
     and (r.hasil->>'pass')::boolean and r.source_hash=public.sla_performa_sumber(r.username,r.periode)->>'hash' on conflict do nothing;
   loop
    select array_agg(periode||':'||sumber order by periode,sumber),array_agg(distinct periode order by periode) into v_keys,v_months from (
     select periode,sumber from public.sla_gaji_kredit where username=v_user.username and kenaikan_id is null and periode<=v_period order by periode,sumber limit 6
    ) q;
    exit when coalesce(cardinality(v_keys),0)<6 or coalesce(cardinality(v_months),0)<3;
    perform set_config('sla.salary_kind','Otomatis',true); perform set_config('sla.salary_actor','Sistem',true);
    perform set_config('sla.salary_reason','Enam kredit kehadiran/performa dari minimal tiga bulan berbeda.',true); perform set_config('sla.salary_months',v_months::text,true);
    update public.users set gaji_pokok=least(3000000,gaji_pokok+250000) where username=v_user.username returning * into v_user;
    select id into strict v_id from public.sla_gaji_riwayat where username=v_user.username and jenis='Otomatis' and bulan_dipakai=v_months order by urutan desc limit 1;
    update public.sla_gaji_kredit set kenaikan_id=v_id where username=v_user.username and periode||':'||sumber=any(v_keys) and kenaikan_id is null;
    update public.sla_gaji_disiplin_bulan d set kenaikan_id=v_id where d.username=v_user.username and exists(select 1 from public.sla_gaji_kredit c where c.username=d.username and c.periode=d.periode and c.sumber='kehadiran' and c.kenaikan_id=v_id);
    v_raised:=v_raised+1; exit when v_user.gaji_pokok>=3000000;
   end loop;
   exit when v_user.gaji_pokok>=3000000;
  end loop;
 end loop;
 perform set_config('sla.salary_kind','',true); perform set_config('sla.salary_months','',true);
 perform set_config('sla.salary_actor','',true); perform set_config('sla.salary_reason','',true);
 return jsonb_build_object('status','sukses','bulanDievaluasi',v_evaluated,'kenaikan',v_raised);
end $$;
