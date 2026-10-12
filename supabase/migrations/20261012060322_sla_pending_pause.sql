begin;
alter table public.tiket add column if not exists sla_jeda_mulai timestamptz;
alter table public.tiket add column if not exists sla_jeda_sisa_detik numeric;
alter table public.tiket add column if not exists sla_jeda_total_detik numeric not null default 0;

-- Exact working seconds: WITA, Monday-Saturday, prayer breaks excluded.
create or replace function public.sla_detik_kerja(p_awal timestamptz,p_akhir timestamptz,p_cabang text)
returns numeric language plpgsql security invoker set search_path=public,pg_temp as $$
declare a timestamp; b timestamp; d timestamp; s timestamp; e timestamp;
  total numeric:=0; sign integer:=1; i integer; closing integer;
begin
  if p_awal is null or p_akhir is null then return null; end if;
  a:=p_awal at time zone 'Asia/Makassar'; b:=p_akhir at time zone 'Asia/Makassar';
  if a>b then s:=a; a:=b; b:=s; sign:=-1; end if;
  closing:=case when lower(trim(p_cabang))='raha' then 20 else 17 end;
  d:=date_trunc('day',a);
  while d<b loop
    if extract(dow from d)<>0 then
      for i in 1..3 loop
        s:=d+case i when 1 then interval '8 hours' when 2 then interval '13 hours 30 minutes' else interval '16 hours' end;
        e:=d+case i when 1 then interval '12 hours' when 2 then interval '15 hours' else closing*interval '1 hour' end;
        total:=total+greatest(0,extract(epoch from least(b,e)-greatest(a,s)));
      end loop;
    end if;
    d:=d+interval '1 day';
  end loop;
  return sign*total;
end $$;
revoke all on function public.sla_detik_kerja(timestamptz,timestamptz,text) from public,anon;
grant execute on function public.sla_detik_kerja(timestamptz,timestamptz,text) to authenticated,service_role;

create or replace function public.sla_tenggat_sisa(p_awal timestamptz,p_detik numeric,p_cabang text,p_lama timestamptz)
returns timestamptz language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_dt timestamp:=p_awal at time zone 'Asia/Makassar'; d timestamp; s timestamp; e timestamp;
  remaining numeric:=abs(p_detik); available numeric; closing integer; i integer;
begin
  if p_detik is null then return p_lama; end if;
  if p_detik=0 then return p_awal; end if;
  if p_awal is null then return p_lama; end if;
  closing:=case when lower(trim(p_cabang))='raha' then 20 else 17 end;
  while remaining>0 loop
    d:=date_trunc('day',v_dt);
    if extract(dow from d)<>0 then
      for n in 1..3 loop
        i:=case when p_detik>0 then n else 4-n end;
        s:=d+case i when 1 then interval '8 hours' when 2 then interval '13 hours 30 minutes' else interval '16 hours' end;
        e:=d+case i when 1 then interval '12 hours' when 2 then interval '15 hours' else closing*interval '1 hour' end;
        if p_detik>0 then
          if v_dt>=e then continue; end if;
          v_dt:=greatest(v_dt,s); available:=extract(epoch from e-v_dt);
          if remaining<=available then return (v_dt+remaining*interval '1 second') at time zone 'Asia/Makassar'; end if;
          remaining:=remaining-available; v_dt:=e;
        else
          if v_dt<=s then continue; end if;
          v_dt:=least(v_dt,e); available:=extract(epoch from v_dt-s);
          if remaining<=available then return (v_dt-remaining*interval '1 second') at time zone 'Asia/Makassar'; end if;
          remaining:=remaining-available; v_dt:=s;
        end if;
      end loop;
    end if;
    v_dt:=case when p_detik>0 then d+interval '1 day 8 hours' else d-interval '1 day'+closing*interval '1 hour' end;
  end loop;
  return v_dt at time zone 'Asia/Makassar';
end $$;
revoke all on function public.sla_tenggat_sisa(timestamptz,numeric,text,timestamptz) from public,anon;
grant execute on function public.sla_tenggat_sisa(timestamptz,numeric,text,timestamptz) to authenticated,service_role;

create or replace function public.sla_jaga_jeda_pengerjaan()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_now timestamptz:=statement_timestamp(); v_status text:=lower(trim(coalesce(new.status,'')));
  v_cabang text:=case when lower(trim(new.cabang))='raha' then 'Raha' else 'Kendari' end;
  v_target numeric:=24; v_start timestamptz; v_sisa numeric; v_restarted boolean:=false;
  v_changed boolean:=false; v_ada boolean:=lower(trim(coalesce(new.teknisi,''))) not in ('','-','belum ditugaskan');
begin
  if trim(coalesce(new.target_sla_jam,'')) ~ '^[0-9]+([.][0-9]+)?$' then
    v_target:=trim(new.target_sla_jam)::numeric;
    if v_target<=0 or v_target>1000 then v_target:=24; end if;
  end if;
  if tg_op='UPDATE' then
    -- Accept a historical pause only during a privileged maintenance repair.
    if current_user in ('postgres','supabase_admin') and old.sla_jeda_mulai is null
      and new.sla_jeda_mulai is not null and v_status in ('pending','outsource') then
      v_start:=least(v_now,greatest(new.waktu_penugasan,new.sla_jeda_mulai));
    end if;
    new.sla_jeda_mulai:=old.sla_jeda_mulai;
    new.sla_jeda_sisa_detik:=old.sla_jeda_sisa_detik;
    new.sla_jeda_total_detik:=old.sla_jeda_total_detik;
    if lower(trim(coalesce(old.status,''))) in ('selesai','closed','cancel','batal')
      and v_status in ('selesai','closed','cancel','batal') then return new; end if;
    v_restarted:=new.waktu_penugasan is distinct from old.waktu_penugasan;
    v_changed:=new.target_sla_jam is distinct from old.target_sla_jam or new.cabang is distinct from old.cabang;
    if v_restarted then
      new.sla_jeda_mulai:=null; new.sla_jeda_sisa_detik:=null; new.sla_jeda_total_detik:=0;
    elsif v_changed and v_ada and new.waktu_penugasan is not null then
      v_sisa:=v_target*3600-public.sla_detik_kerja(new.waktu_penugasan,coalesce(old.sla_jeda_mulai,v_now),old.cabang)+old.sla_jeda_total_detik;
      if old.sla_jeda_mulai is not null then new.sla_jeda_sisa_detik:=v_sisa;
      else
        new.tenggat_waktu:=public.sla_tenggat_sisa(v_now,v_sisa,v_cabang,old.tenggat_waktu);
        new.status_sla:=case when v_now>new.tenggat_waktu then 'TERLAMBAT' when v_status in ('selesai','closed') then 'TERPENUHI' else 'AMAN' end;
      end if;
    end if;
  else
    new.sla_jeda_mulai:=null; new.sla_jeda_sisa_detik:=null; new.sla_jeda_total_detik:=0;
    v_restarted:=new.waktu_penugasan is not null;
  end if;

  if v_status in ('pending','outsource') then
    if new.sla_jeda_mulai is null then
      new.sla_jeda_mulai:=coalesce(v_start,v_now);
      new.sla_jeda_sisa_detik:=case when v_restarted and v_ada then v_target*3600 else public.sla_detik_kerja(new.sla_jeda_mulai,new.tenggat_waktu,v_cabang) end;
      if v_restarted and v_ada then
        new.tenggat_waktu:=public.sla_tenggat_sisa(new.sla_jeda_mulai,new.sla_jeda_sisa_detik,v_cabang,new.tenggat_waktu);
        if new.tenggat_pengganti is not null then new.tenggat_pengganti:=new.tenggat_waktu; end if;
      end if;
      if new.sla_jeda_sisa_detik=0 and new.sla_jeda_mulai>new.tenggat_waktu then new.sla_jeda_sisa_detik:=-1; end if;
    elsif tg_op='UPDATE' and not v_restarted then
      if v_changed or old.tenggat_waktu is null then
        new.tenggat_waktu:=public.sla_tenggat_sisa(new.sla_jeda_mulai,new.sla_jeda_sisa_detik,v_cabang,old.tenggat_waktu);
      else new.tenggat_waktu:=old.tenggat_waktu; end if;
    end if;
    new.status_sla:=case when v_status='pending' then 'DIPENDING' else 'DIOPOR' end;
  elsif new.sla_jeda_mulai is not null and v_status in ('on progress','selesai','closed','cancel','batal') then
    if v_status in ('selesai','closed') then v_now:=coalesce(new.waktu_selesai,v_now); end if;
    new.sla_jeda_total_detik:=new.sla_jeda_total_detik+greatest(0,public.sla_detik_kerja(new.sla_jeda_mulai,v_now,v_cabang));
    if v_ada and v_status not in ('cancel','batal') then
      new.tenggat_waktu:=public.sla_tenggat_sisa(v_now,new.sla_jeda_sisa_detik,v_cabang,new.tenggat_waktu);
      if tg_op='UPDATE' and old.tenggat_pengganti=old.tenggat_waktu then new.tenggat_pengganti:=new.tenggat_waktu; end if;
      if new.sla_jeda_sisa_detik>0 then new.status_peringatan:=replace(coalesce(new.status_peringatan,''),'[PENGERJAAN_WARNED]',''); end if;
      new.status_sla:=case when v_now>new.tenggat_waktu then 'TERLAMBAT'
        when v_status in ('selesai','closed') then 'TERPENUHI' else 'AMAN' end;
    end if;
    new.sla_jeda_mulai:=null; new.sla_jeda_sisa_detik:=null;
  elsif new.sla_jeda_mulai is not null then
    -- Other transitions do not resume work; only On Progress/completion do.
    if tg_op='UPDATE' then new.tenggat_waktu:=old.tenggat_waktu; end if;
    new.status_sla:='DIPENDING';
  end if;
  return new;
end $$;
revoke all on function public.sla_jaga_jeda_pengerjaan() from public,anon,authenticated;
drop trigger if exists sla_z_jaga_jeda_pengerjaan on public.tiket;
create trigger sla_z_jaga_jeda_pengerjaan before insert or update on public.tiket
for each row execute function public.sla_jaga_jeda_pengerjaan();

-- Infer only the current consecutive pause from dated ticket history.
create or replace function public.sla_awal_jeda_riwayat(p_catatan text)
returns timestamptz language plpgsql security invoker set search_path=public,pg_temp as $$
declare m text[]; started timestamptz; parsed timestamptz;
begin
  for m in select regexp_matches(coalesce(p_catatan,''),'\[([0-9]{2})/([0-9]{2})/([0-9]{4}),?\s+([0-9]{2})[.:]([0-9]{2})\]\s*➔\s*([^\r\n]+)','g') loop
    if lower(trim(m[6])) in ('pending','outsource') then
      begin parsed:=make_timestamptz(m[3]::integer,m[2]::integer,m[1]::integer,m[4]::integer,m[5]::integer,0,'Asia/Makassar');
      exception when others then parsed:=null; end;
      started:=coalesce(started,parsed);
    else started:=null; end if;
  end loop;
  return started;
end $$;
revoke all on function public.sla_awal_jeda_riwayat(text) from public,anon,authenticated;
grant execute on function public.sla_awal_jeda_riwayat(text) to service_role;

create table if not exists public.sla_backup_jeda_pengerjaan (
  id_tiket text primary key,snapshot jsonb not null,disimpan_pada timestamptz not null default now()
);
alter table public.sla_backup_jeda_pengerjaan enable row level security;
revoke all on public.sla_backup_jeda_pengerjaan from public,anon,authenticated;
grant select on public.sla_backup_jeda_pengerjaan to service_role;
insert into public.sla_backup_jeda_pengerjaan(id_tiket,snapshot)
select id_tiket,to_jsonb(t) from public.tiket t
where lower(trim(status)) in ('pending','outsource') and sla_jeda_mulai is null
on conflict(id_tiket) do nothing;
update public.tiket set sla_jeda_mulai=coalesce(public.sla_awal_jeda_riwayat(keterangan),statement_timestamp())
where lower(trim(status)) in ('pending','outsource') and sla_jeda_mulai is null;
commit;
