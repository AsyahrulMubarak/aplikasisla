-- Six qualifying months, starting October 2026, with an immutable salary audit.
begin;
create table if not exists public.sla_gaji_program (
  username text primary key, mulai_periode text not null check (mulai_periode ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  otomatis_selesai boolean not null default false, dibuat_pada timestamptz not null default now()
);
create table if not exists public.sla_gaji_riwayat (
  id uuid primary key default gen_random_uuid(), urutan bigint generated always as identity unique, username text not null, nama_pegawai text not null,
  gaji_lama numeric not null, gaji_baru numeric not null check (gaji_baru>=0), berlaku_periode text not null,
  jenis text not null check (jenis in ('Awal','Otomatis','Manual')), alasan text not null default '',
  diubah_oleh text not null, dibuat_pada timestamptz not null default now(), bulan_dipakai text[] not null default '{}'
);
create index if not exists sla_gaji_riwayat_periode on public.sla_gaji_riwayat(username,berlaku_periode,dibuat_pada);
create table if not exists public.sla_gaji_disiplin_bulan (
  username text not null, periode text not null, telat_pagi integer not null, alpa integer not null,
  memenuhi_syarat boolean not null, alasan text not null default '', gaji_pokok numeric not null,
  kenaikan_id uuid references public.sla_gaji_riwayat(id), dievaluasi_pada timestamptz not null default now(),
  primary key(username,periode)
);
create table if not exists public.sla_notif_kenaikan_gaji (
  id uuid primary key default gen_random_uuid(), riwayat_id uuid not null unique references public.sla_gaji_riwayat(id),
  username text not null, no_wa text not null default '', pesan text not null,
  terkirim_pada timestamptz, percobaan integer not null default 0,
  lease uuid, lease_sampai timestamptz, coba_lagi_pada timestamptz not null default now(), galat text
);
alter table public.sla_gaji_program enable row level security;
alter table public.sla_gaji_riwayat enable row level security;
alter table public.sla_gaji_disiplin_bulan enable row level security;
alter table public.sla_notif_kenaikan_gaji enable row level security;
revoke all on public.sla_gaji_program,public.sla_gaji_riwayat,public.sla_gaji_disiplin_bulan,public.sla_notif_kenaikan_gaji from public,anon,authenticated;
grant select,insert,update on public.sla_gaji_program,public.sla_gaji_riwayat,public.sla_gaji_disiplin_bulan,public.sla_notif_kenaikan_gaji to service_role;
create index if not exists sla_gaji_absen_lookup on public.absensi(lower(trim(nama_pegawai)),cabang,waktu_absen);
create index if not exists sla_gaji_cuti_lookup on public.pengajuan_cuti(lower(trim(nama_pegawai)),status,cabang,tanggal_mulai);

create or replace function public.sla_gaji_sekarang() returns timestamptz language sql stable as $$ select now() $$;
create or replace function public.sla_gaji_cabang(p public.users) returns text language sql immutable as $$
 select case when lower(trim(p.hak_akses_cabang)) in ('raha','kendari') then initcap(lower(trim(p.hak_akses_cabang))) when lower(trim(p.cabang))='raha' then 'Raha' else 'Kendari' end
$$;
create or replace function public.sla_gaji_nominal_periode(p_username text,p_periode text) returns numeric language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select gaji_baru from public.sla_gaji_riwayat where username=p_username and berlaku_periode<=p_periode order by berlaku_periode desc,urutan desc limit 1),
   (select gaji_lama from public.sla_gaji_riwayat where username=p_username order by berlaku_periode,urutan limit 1),
   (select coalesce(gaji_pokok,0) from public.users where username=p_username))
$$;

-- Enrol once, keep changes to current salary from rewriting historical slips.
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
-- A named trigger is replaced without removing any unrelated trigger.
create or replace trigger sla_salary_audit after insert or update of gaji_pokok,hak_akses_cabang,cabang on public.users for each row execute function public.sla_catat_perubahan_gaji();
insert into public.sla_gaji_program(username,mulai_periode,otomatis_selesai)
 select u.username,'2026-10',u.gaji_pokok>=3000000 or exists(select 1 from public.sla_gaji_riwayat h where h.username=u.username and h.gaji_baru>=3000000)
 from public.users u where public.sla_gaji_cabang(u)='Kendari' and coalesce(u.gaji_pokok,0)>0 on conflict do nothing;
insert into public.sla_gaji_riwayat(username,nama_pegawai,gaji_lama,gaji_baru,berlaku_periode,jenis,diubah_oleh)
 select u.username,u.nama_asli,coalesce(u.gaji_pokok,0),coalesce(u.gaji_pokok,0),'2026-10','Awal','Sistem'
 from public.users u where coalesce(u.gaji_pokok,0)>0 and not exists(select 1 from public.sla_gaji_riwayat h where h.username=u.username);

create or replace function public.sla_disiplin_kenaikan_gaji(p_username text,p_periode text)
 returns table(telat_pagi integer,alpa integer) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user public.users%rowtype; v_branch text; v_start date; v_end date; v_day date; v_count integer;
 v_events boolean; v_sick boolean; v_leave boolean; v_holiday boolean; v_morning timestamp; v_sick_count integer:=0; v_holidays integer[];
 v_limit integer; v_date timestamp; v_row record; v_return timestamptz;
begin
 select * into strict v_user from public.users where username=p_username;
 if p_periode !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Periode tidak valid.'; end if;
 v_branch:=public.sla_gaji_cabang(v_user); v_start:=(p_periode||'-01')::date; v_end:=(v_start+interval '1 month - 1 day')::date;
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
   if not v_events and not v_sick and not v_leave then alpa:=alpa+1; end if;
   if v_morning is not null and not (v_sick and v_sick_count<=3)
    and (extract(hour from v_morning)*60+extract(minute from v_morning))>v_limit then telat_pagi:=telat_pagi+1; end if;
 end loop;
 return next;
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

create or replace function public.sla_ubah_gaji_manual(p_auth_id uuid,p_username text,p_gaji_lama numeric,p_gaji_baru numeric,p_alasan text) returns jsonb
 language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor public.users%rowtype; v_target public.users%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 select * into strict v_actor from public.users where auth_id=p_auth_id;
 if lower(trim(v_actor.role)) not in ('admin','manager','direktur') or (lower(trim(v_actor.role))='admin' and public.sla_gaji_cabang(v_actor)='Raha') then raise exception 'Perubahan gaji khusus Admin Kendari, Manager, dan Direktur.'; end if;
 select * into strict v_target from public.users where username=p_username for update;
 if coalesce(v_actor.hak_akses_cabang,v_actor.cabang,'')<>'Semua' and public.sla_gaji_cabang(v_actor)<>public.sla_gaji_cabang(v_target) then raise exception 'Pegawai di luar hak akses cabang.'; end if;
 if p_gaji_baru is null or p_gaji_baru<0 or p_gaji_baru<>trunc(p_gaji_baru) or p_gaji_baru>999999999999 then raise exception 'Nominal gaji tidak valid.'; end if;
 if coalesce(v_target.gaji_pokok,0) is distinct from p_gaji_lama then raise exception 'Gaji sudah berubah. Muat ulang profil sebelum menyimpan.'; end if;
 if nullif(trim(p_alasan),'') is null or length(p_alasan)>1000 then raise exception 'Isi alasan perubahan gaji.'; end if;
 perform set_config('sla.salary_kind','Manual',true); perform set_config('sla.salary_actor',v_actor.nama_asli,true);
 perform set_config('sla.salary_reason',trim(p_alasan),true); perform set_config('sla.salary_months','',true);
 update public.users set gaji_pokok=p_gaji_baru where username=p_username;
 return jsonb_build_object('status','sukses','gajiPokok',p_gaji_baru);
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
create or replace function public.sla_ambil_notif_gaji(p_username text default null) returns setof public.sla_notif_kenaikan_gaji
 language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 return query with kandidat as (select id from public.sla_notif_kenaikan_gaji where terkirim_pada is null and coba_lagi_pada<=now()
   and (p_username is null or username=p_username) and (lease_sampai is null or lease_sampai<=now()) order by coba_lagi_pada limit 20 for update skip locked)
 update public.sla_notif_kenaikan_gaji n set lease=gen_random_uuid(),lease_sampai=now()+interval '5 minutes',percobaan=percobaan+1,
 no_wa=coalesce((select u.no_wa from public.users u where u.username=n.username),'')
 from kandidat k where n.id=k.id returning n.*;
end $$;
create or replace function public.sla_selesai_notif_gaji(p_id uuid,p_lease uuid,p_sukses boolean,p_galat text) returns boolean
 language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 update public.sla_notif_kenaikan_gaji set terkirim_pada=case when p_sukses then now() else null end,
  galat=case when p_sukses then null else left(p_galat,500) end,coba_lagi_pada=now()+interval '1 hour',lease=null,lease_sampai=null
 where id=p_id and lease=p_lease and lease_sampai>now() and terkirim_pada is null;
 return found;
end $$;
revoke all on function public.sla_ringkasan_gaji(text[],text),public.sla_catat_perubahan_gaji(),public.sla_gaji_sekarang(),public.sla_gaji_cabang(public.users),public.sla_gaji_nominal_periode(text,text),public.sla_disiplin_kenaikan_gaji(text,text),public.sla_evaluasi_kenaikan_gaji(),public.sla_ubah_gaji_manual(uuid,text,numeric,numeric,text),public.sla_ambil_notif_gaji(text),public.sla_selesai_notif_gaji(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.sla_ringkasan_gaji(text[],text),public.sla_gaji_nominal_periode(text,text),public.sla_disiplin_kenaikan_gaji(text,text),public.sla_evaluasi_kenaikan_gaji(),public.sla_ubah_gaji_manual(uuid,text,numeric,numeric,text),public.sla_ambil_notif_gaji(text),public.sla_selesai_notif_gaji(uuid,uuid,boolean,text) to service_role;
commit;
