-- Restrict automatic salary increments to Kendari. Preserve existing salary history, enrolments, and manual adjustments.
-- Apply after salary-increments.sql on existing installations. Safe to rerun.
begin;
create or replace function public.sla_catat_perubahan_gaji() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_now timestamptz:=public.sla_gaji_sekarang(); v_period text:=to_char(v_now at time zone 'Asia/Makassar','YYYY-MM');
 v_id uuid; v_kind text; v_actor text; v_reason text; v_used text[]; v_old numeric;
begin
 if coalesce(NEW.gaji_pokok,0)<0 then raise exception 'Gaji pokok tidak boleh negatif.'; end if;
 if public.sla_gaji_cabang(NEW)='Kendari' and coalesce(NEW.gaji_pokok,0)>0 then
   insert into public.sla_gaji_program(username,mulai_periode,otomatis_selesai)
    values(NEW.username,greatest('2026-10',to_char(date_trunc('month',v_now at time zone 'Asia/Makassar')+case when extract(day from v_now at time zone 'Asia/Makassar')=1 then interval '0 months' else interval '1 month' end,'YYYY-MM')),
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
   values(v_id,NEW.username,coalesce(NEW.no_wa,''),'ALFACOM — Kenaikan Gaji Pokok'||E'\n'||NEW.nama_asli||E'\nGaji pokok: Rp '||to_char(v_old,'FM999G999G999G990')||' → Rp '||to_char(NEW.gaji_pokok,'FM999G999G999G990')||E'\nBerlaku mulai '||v_period||'.'||case when v_kind='Otomatis' then E'\nEnam bulan memenuhi batas disiplin. Kenaikan otomatis maksimal Rp3.000.000.' else E'\nKenaikan ditetapkan oleh Manajemen.' end);
 end if;
 return NEW;
end $$;

create or replace function public.sla_evaluasi_kenaikan_gaji() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_now timestamptz:=public.sla_gaji_sekarang(); v_local timestamp:=v_now at time zone 'Asia/Makassar';
 v_last date; v_period text; v_start date; v_user public.users%rowtype; v_program record; v_stats record;
 v_months text[]; v_id uuid; v_salary numeric; v_count integer; v_evaluated integer:=0; v_raised integer:=0;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 if not pg_try_advisory_xact_lock(734252611) then return jsonb_build_object('status','sibuk'); end if;
 v_last:=(date_trunc('month',v_local)-case when extract(day from v_local)>=8 then interval '1 month' else interval '2 months' end)::date;
 for v_program in select * from public.sla_gaji_program where not otomatis_selesai order by username loop
   select * into v_user from public.users where username=v_program.username for update;
   if not found or coalesce(v_user.gaji_pokok,0)<=0 or v_user.gaji_pokok>=3000000 then continue; end if;
   if public.sla_gaji_cabang(v_user)<>'Kendari' then continue; end if;
   v_start:=greatest('2026-10-01'::date,(v_program.mulai_periode||'-01')::date);
   for v_period in select to_char(d,'YYYY-MM') from generate_series(v_start::timestamp,v_last::timestamp,interval '1 month') d loop
     if exists(select 1 from public.sla_gaji_disiplin_bulan where username=v_user.username and periode=v_period) then continue; end if;
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
     select array_agg(periode order by periode) into v_months from (select periode from public.sla_gaji_disiplin_bulan where username=v_user.username and memenuhi_syarat and kenaikan_id is null order by periode limit 6) q;
     if cardinality(v_months)=6 then
       perform set_config('sla.salary_kind','Otomatis',true); perform set_config('sla.salary_actor','Sistem',true);
       perform set_config('sla.salary_reason','Enam bulan memenuhi batas disiplin.',true); perform set_config('sla.salary_months',v_months::text,true);
       update public.users set gaji_pokok=least(3000000,gaji_pokok+250000) where username=v_user.username returning * into v_user;
       select id into v_id from public.sla_gaji_riwayat where username=v_user.username and jenis='Otomatis' and bulan_dipakai=v_months order by dibuat_pada desc limit 1;
       update public.sla_gaji_disiplin_bulan set kenaikan_id=v_id where username=v_user.username and periode=any(v_months);
       v_raised:=v_raised+1;
       if v_user.gaji_pokok>=3000000 then exit; end if;
     end if;
   end loop;
 end loop;
 perform set_config('sla.salary_kind','',true); perform set_config('sla.salary_months','',true);
 perform set_config('sla.salary_actor','',true); perform set_config('sla.salary_reason','',true);
 return jsonb_build_object('status','sukses','bulanDievaluasi',v_evaluated,'kenaikan',v_raised);
end $$;

create or replace function public.sla_ringkasan_gaji(p_usernames text[],p_periode text) returns jsonb
 language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('username',u.username,'gajiPeriode',public.sla_gaji_nominal_periode(u.username,p_periode),
   'gajiSekarang',coalesce(u.gaji_pokok,0),'berlakuOtomatis',public.sla_gaji_cabang(u)='Kendari' and coalesce(u.gaji_pokok,0)>0 and p.username is not null,'mulaiPeriode',p.mulai_periode,'selesai',p.otomatis_selesai,
   'bulanTerkumpul',(select count(*) from public.sla_gaji_disiplin_bulan d where d.username=u.username and d.memenuhi_syarat and d.kenaikan_id is null),
   'evaluasi',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select periode,telat_pagi,alpa,memenuhi_syarat,alasan,kenaikan_id is not null as dipakai from public.sla_gaji_disiplin_bulan where username=u.username order by periode desc limit 12) q),
   'riwayat',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select berlaku_periode,jenis,gaji_lama,gaji_baru,alasan,diubah_oleh from public.sla_gaji_riwayat where username=u.username and jenis<>'Awal' order by urutan desc limit 5) q)
 )) from public.users u left join public.sla_gaji_program p on p.username=u.username where u.username=any(p_usernames)),'[]');
end $$;
commit;
