-- Only salaried Kendari employees belong to the automatic salary programme.
-- Apply after salary-increments.sql on existing installations. Safe to rerun.
-- Remove only unused initial zero-salary history; preserve actual salary changes and historical slips.
-- Preserve salary amounts, earned discipline months, notifications and cron.
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
create or replace trigger sla_salary_audit after insert or update of gaji_pokok,hak_akses_cabang,cabang on public.users for each row execute function public.sla_catat_perubahan_gaji();
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

delete from public.sla_gaji_program p
 where not exists(select 1 from public.users u where u.username=p.username
   and public.sla_gaji_cabang(u)='Kendari' and coalesce(u.gaji_pokok,0)>0);

-- Enrol missing salaried profiles from their first full salaried month.
-- Existing eligible participants retain their start month and completion status.
insert into public.sla_gaji_program(username,mulai_periode,otomatis_selesai)
 select u.username,greatest('2026-10',to_char(date_trunc('month',public.sla_gaji_sekarang() at time zone 'Asia/Makassar')+
   case when extract(day from public.sla_gaji_sekarang() at time zone 'Asia/Makassar')=1 then interval '0 months' else interval '1 month' end,'YYYY-MM')),
   u.gaji_pokok>=3000000 or exists(select 1 from public.sla_gaji_riwayat h where h.username=u.username and h.gaji_baru>=3000000)
 from public.users u where public.sla_gaji_cabang(u)='Kendari' and coalesce(u.gaji_pokok,0)>0
 on conflict do nothing;

delete from public.sla_gaji_riwayat h
 where h.jenis='Awal' and h.gaji_lama=0 and h.gaji_baru=0
   and exists(select 1 from public.users u where u.username=h.username and coalesce(u.gaji_pokok,0)<=0)
   and not exists(select 1 from public.sla_gaji_disiplin_bulan d where d.kenaikan_id=h.id)
   and not exists(select 1 from public.sla_notif_kenaikan_gaji n where n.riwayat_id=h.id);
commit;
