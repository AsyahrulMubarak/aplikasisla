-- Extend the existing salary-credit programme to salaried Raha staff from November 2026.
-- This installation enrols participants only; it never evaluates or changes salaries.
CREATE OR REPLACE FUNCTION public.sla_catat_perubahan_gaji()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_now timestamptz:=public.sla_gaji_sekarang(); v_period text:=to_char(v_now at time zone 'Asia/Makassar','YYYY-MM');
 v_id uuid; v_kind text; v_actor text; v_reason text; v_used text[]; v_old numeric;
begin
 if coalesce(NEW.gaji_pokok,0)<0 then raise exception 'Gaji pokok tidak boleh negatif.'; end if;
 if public.sla_gaji_cabang(NEW) in ('Kendari','Raha') and coalesce(NEW.gaji_pokok,0)>0 then
   insert into public.sla_gaji_program(username,mulai_periode,otomatis_selesai)
    values(NEW.username,greatest(case when public.sla_gaji_cabang(NEW)='Raha' then '2026-11' else '2026-10' end,to_char(date_trunc('month',v_now at time zone 'Asia/Makassar')+case when extract(day from v_now at time zone 'Asia/Makassar')=1 then interval '0 months' else interval '1 month' end,'YYYY-MM')),
     NEW.gaji_pokok>=3000000 or exists(select 1 from public.sla_gaji_riwayat h where h.username=NEW.username and h.gaji_baru>=3000000))
    on conflict do nothing;
 else
   delete from public.sla_gaji_program where username=NEW.username;
 end if;
 if TG_OP='UPDATE' and coalesce(OLD.gaji_pokok,0)=coalesce(NEW.gaji_pokok,0) then return NEW; end if;
 if TG_OP='INSERT' and coalesce(NEW.gaji_pokok,0)<=0 then return NEW; end if;
 if TG_OP='INSERT' then
   v_kind:='Awal'; v_old:=coalesce(NEW.gaji_pokok,0); v_actor:='Sistem';
 else
   v_old:=coalesce(OLD.gaji_pokok,0);
   v_kind:=case when current_setting('sla.salary_kind',true)='Otomatis' then 'Otomatis' else 'Manual' end;
   v_actor:=coalesce(nullif(current_setting('sla.salary_actor',true),''),'Manajemen');
   v_reason:=coalesce(current_setting('sla.salary_reason',true),'');
   v_used:=coalesce(nullif(current_setting('sla.salary_months',true),'')::text[],'{}');
 end if;
 insert into public.sla_gaji_riwayat(username,nama_pegawai,gaji_lama,gaji_baru,berlaku_periode,jenis,diubah_oleh,alasan,bulan_dipakai,dibuat_pada)
 values(NEW.username,NEW.nama_asli,v_old,coalesce(NEW.gaji_pokok,0),v_period,v_kind,v_actor,coalesce(v_reason,''),coalesce(v_used,'{}'),v_now) returning id into v_id;
 if coalesce(NEW.gaji_pokok,0)>=3000000 then update public.sla_gaji_program set otomatis_selesai=true where username=NEW.username; end if;
 if v_kind<>'Awal' and NEW.gaji_pokok>v_old then
   insert into public.sla_notif_kenaikan_gaji(riwayat_id,username,no_wa,pesan)
   values(v_id,NEW.username,coalesce(NEW.no_wa,''),'ALFACOM — Kenaikan Gaji Pokok'||E'\n'||NEW.nama_asli||E'\nGaji pokok: Rp '||to_char(v_old,'FM999G999G999G990')||' → Rp '||to_char(NEW.gaji_pokok,'FM999G999G999G990')||E'\nBerlaku mulai '||v_period||'.'||case when v_kind='Otomatis' then E'\nEnam kredit kehadiran/performa dari minimal tiga bulan. Kenaikan otomatis maksimal Rp3.000.000.' else E'\nKenaikan ditetapkan oleh Manajemen.' end);
 end if;
 return NEW;
end $function$;
CREATE OR REPLACE FUNCTION public.sla_evaluasi_kenaikan_gaji()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_now timestamptz:=public.sla_gaji_sekarang(); v_local timestamp:=v_now at time zone 'Asia/Makassar';
 v_last date; v_period text; v_start date; v_user public.users%rowtype; v_program record; v_stats record;
 v_months text[]; v_keys text[]; v_id uuid; v_salary numeric; v_count integer; v_evaluated integer:=0; v_raised integer:=0;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 if not pg_try_advisory_xact_lock(734252611) then return jsonb_build_object('status','sibuk'); end if;
 v_last:=(date_trunc('month',v_local)-case when extract(day from v_local)>=8 then interval '1 month' else interval '2 months' end)::date;
 for v_program in select * from public.sla_gaji_program where not otomatis_selesai order by username loop
  select * into v_user from public.users where username=v_program.username for update;
  if not found or coalesce(v_user.gaji_pokok,0)<=0 or v_user.gaji_pokok>=3000000 or public.sla_gaji_cabang(v_user) not in ('Kendari','Raha') then continue; end if;
  -- Reviews and the evaluator serialize on the employee/period lock. Used credits remain immutable.
  v_start:=greatest((case when public.sla_gaji_cabang(v_user)='Raha' then '2026-11-01' else '2026-10-01' end)::date,(v_program.mulai_periode||'-01')::date);
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
end $function$;
CREATE OR REPLACE FUNCTION public.sla_performa_akses(p_auth_id uuid, p_username text DEFAULT NULL::text, p_periode text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
  'eligible',public.sla_gaji_cabang(target) in ('Kendari','Raha') and coalesce(target.gaji_pokok,0)>0 and coalesce(target.gaji_pokok,0)<3000000 and program.username is not null and not program.otomatis_selesai and p_periode>=greatest(program.mulai_periode,case when public.sla_gaji_cabang(target)='Raha' then '2026-11' else '2026-10' end),
  'programStart',program.mulai_periode,'canApprove',managing and target.username<>actor.username,
  'closed',public.sla_gaji_sekarang()>=((p_periode||'-01')::date+interval '1 month 7 days') at time zone 'Asia/Makassar',
  'credits',coalesce((select jsonb_agg(to_jsonb(c) order by c.periode,c.sumber) from public.sla_gaji_kredit c where c.username=p_username),'[]'));
end $function$;
CREATE OR REPLACE FUNCTION public.sla_ringkasan_gaji(p_usernames text[], p_periode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('username',u.username,'gajiPeriode',public.sla_gaji_nominal_periode(u.username,p_periode),
   'gajiSekarang',coalesce(u.gaji_pokok,0),'berlakuOtomatis',public.sla_gaji_cabang(u) in ('Kendari','Raha') and coalesce(u.gaji_pokok,0)>0 and p.username is not null,'mulaiPeriode',p.mulai_periode,'selesai',p.otomatis_selesai,
   'bulanTerkumpul',(select count(*) from public.sla_gaji_kredit c where c.username=u.username and c.kenaikan_id is null),
   'kreditTerkumpul',(select count(*) from public.sla_gaji_kredit c where c.username=u.username and c.kenaikan_id is null),
   'mulaiKreditPerforma','2026-11',
   'kreditBulanan',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select c.periode,count(*) as kredit,bool_or(c.sumber='kehadiran') as kehadiran,bool_or(c.sumber='performa') as performa,bool_and(c.kenaikan_id is not null) as dipakai from public.sla_gaji_kredit c where c.username=u.username group by c.periode order by c.periode desc limit 12) q),
   'evaluasi',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select periode,telat_pagi,alpa,memenuhi_syarat,alasan,kenaikan_id is not null as dipakai from public.sla_gaji_disiplin_bulan where username=u.username order by periode desc limit 12) q),
   'riwayat',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select berlaku_periode,jenis,gaji_lama,gaji_baru,alasan,diubah_oleh from public.sla_gaji_riwayat where username=u.username and jenis<>'Awal' order by urutan desc limit 5) q)
 )) from public.users u left join public.sla_gaji_program p on p.username=u.username where u.username=any(p_usernames)),'[]');
end $function$;
insert into public.sla_gaji_program(username,mulai_periode,otomatis_selesai)
 select u.username,greatest('2026-11',to_char(date_trunc('month',public.sla_gaji_sekarang() at time zone 'Asia/Makassar')+
 case when extract(day from public.sla_gaji_sekarang() at time zone 'Asia/Makassar')=1 then interval '0 months' else interval '1 month' end,'YYYY-MM')),
 u.gaji_pokok>=3000000 or exists(select 1 from public.sla_gaji_riwayat h where h.username=u.username and h.gaji_baru>=3000000)
 from public.users u where public.sla_gaji_cabang(u)='Raha' and coalesce(u.gaji_pokok,0)>0 on conflict do nothing;
notify pgrst,'reload schema';
