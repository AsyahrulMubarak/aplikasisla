begin;
alter table public.tiket add column if not exists waktu_penugasan timestamptz;
alter table public.tiket add column if not exists sumber_waktu_penugasan text;

-- Private, one-time backup of active records before correcting their clock.
create table if not exists public.sla_backup_awal_pengerjaan (
  id_tiket text primary key, snapshot jsonb not null,
  disimpan_pada timestamptz not null default now()
);
alter table public.sla_backup_awal_pengerjaan enable row level security;
revoke all on public.sla_backup_awal_pengerjaan from public, anon, authenticated;
grant select on public.sla_backup_awal_pengerjaan to service_role;

-- Same calendar as warranty SLA, without changing its existing permissions.
create or replace function public.sla_tenggat_pengerjaan(p_awal timestamptz,p_jam numeric,p_cabang text)
returns timestamptz language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_dt timestamp := p_awal at time zone 'Asia/Makassar'; v_sisa numeric := p_jam*3600;
  v_jam integer; v_menit integer; v_step numeric;
begin
  if p_awal is null then return null; end if;
  if p_jam is null or p_jam<=0 or p_jam>1000 then raise exception 'Target SLA tidak valid.'; end if;
  while v_sisa>0 loop
    v_jam:=extract(hour from v_dt); v_menit:=extract(minute from v_dt);
    if extract(dow from v_dt)=0 then v_dt:=date_trunc('day',v_dt)+interval '1 day 8 hours'; continue; end if;
    if v_jam<8 then v_dt:=date_trunc('day',v_dt)+interval '8 hours'; continue; end if;
    if v_jam>=(case when lower(trim(p_cabang))='raha' then 20 else 17 end) then
      v_dt:=date_trunc('day',v_dt)+interval '1 day 8 hours'; continue;
    end if;
    if v_jam=12 or (v_jam=13 and v_menit<30) or v_jam=15 then v_dt:=v_dt+interval '1 minute'; continue; end if;
    v_step:=least(60,v_sisa); v_dt:=v_dt+v_step*interval '1 second'; v_sisa:=v_sisa-v_step;
  end loop;
  return v_dt at time zone 'Asia/Makassar';
end $$;
revoke all on function public.sla_tenggat_pengerjaan(timestamptz,numeric,text) from public,anon;
grant execute on function public.sla_tenggat_pengerjaan(timestamptz,numeric,text) to authenticated,service_role;

-- Reverse the established working-hour calendar for legacy response deadlines.
-- This is an inferred effective start, not a newly recorded assignment event.
create or replace function public.sla_awal_dari_tenggat_respon(p_akhir timestamptz,p_jam numeric,p_cabang text)
returns timestamptz language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_dt timestamp := p_akhir at time zone 'Asia/Makassar';
  v_sisa numeric := p_jam*3600; v_prev timestamp; v_step numeric;
  v_tutup integer := case when lower(trim(p_cabang))='raha' then 20 else 17 end;
  v_jam integer; v_menit integer;
begin
  if p_akhir is null or p_jam is null or p_jam<=0 or p_jam>1000 then return null; end if;
  while v_sisa>0 loop
    v_step:=least(60,v_sisa); v_prev:=v_dt-v_step*interval '1 second';
    v_jam:=extract(hour from v_prev); v_menit:=extract(minute from v_prev);
    if extract(dow from v_prev)=0 or v_jam<8 then
      v_dt:=date_trunc('day',v_prev)-interval '1 day'+v_tutup*interval '1 hour'; continue;
    end if;
    if v_jam>=v_tutup then v_dt:=date_trunc('day',v_prev)+v_tutup*interval '1 hour'; continue; end if;
    if v_jam=12 or (v_jam=13 and v_menit<30) or v_jam=15 then
      v_dt:=v_dt-interval '1 minute'; continue;
    end if;
    v_dt:=v_prev; v_sisa:=v_sisa-v_step;
  end loop;
  return v_dt at time zone 'Asia/Makassar';
end $$;
revoke all on function public.sla_awal_dari_tenggat_respon(timestamptz,numeric,text) from public,anon;
grant execute on function public.sla_awal_dari_tenggat_respon(timestamptz,numeric,text) to authenticated,service_role;

insert into public.sla_backup_awal_pengerjaan(id_tiket,snapshot)
select id_tiket,to_jsonb(t) from public.tiket t
where lower(trim(coalesce(status,''))) not in ('selesai','closed','cancel','batal')
  and waktu_penugasan is null
on conflict(id_tiket) do nothing;

with riwayat as (
  select id_tiket,waktu_lapor,least(waktu_respon,
    public.sla_awal_dari_tenggat_respon(tenggat_respon,coalesce(nullif(target_sla_respon_jam,0),1),cabang)) as acuan
  from public.tiket
  where waktu_penugasan is null
    and lower(trim(coalesce(status,''))) not in ('selesai','closed','cancel','batal')
    and lower(trim(coalesce(teknisi,''))) not in ('','-','belum ditugaskan')
    and tenggat_respon is not null
), awal as (
  select id_tiket,case when acuan is not null then greatest(waktu_lapor,acuan) end as mulai from riwayat
)
update public.tiket t set waktu_penugasan=a.mulai,sumber_waktu_penugasan='riwayat_respon',
  status_peringatan=replace(coalesce(t.status_peringatan,''),'[PENGERJAAN_WARNED]',''),
  tenggat_waktu=public.sla_tenggat_pengerjaan(a.mulai,
    case when trim(coalesce(t.target_sla_jam,'')) ~ '^[0-9]+([.][0-9]+)?$'
      then case when trim(t.target_sla_jam)::numeric>0 and trim(t.target_sla_jam)::numeric<=1000
        then trim(t.target_sla_jam)::numeric else 24 end else 24 end,
    case when lower(trim(t.cabang))='raha' then 'Raha' else 'Kendari' end)
from awal a where t.id_tiket=a.id_tiket and a.mulai is not null;

update public.tiket set tenggat_waktu=null,status_sla='BELUM DIMULAI',poin_performa=0
where lower(trim(coalesce(status,''))) not in ('selesai','closed','cancel','batal','pending','outsource')
  and lower(trim(coalesce(teknisi,''))) in ('','-','belum ditugaskan');

create or replace function public.sla_jaga_awal_pengerjaan()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_ada boolean := lower(trim(coalesce(new.teknisi,''))) not in ('','-','belum ditugaskan');
  v_lama_ada boolean := false; v_mulai_baru boolean := false;
  v_ganti boolean := false; v_hitung boolean := false;
  v_status text := lower(trim(coalesce(new.status,'')));
  v_cabang text := case when lower(trim(new.cabang))='raha' then 'Raha' else 'Kendari' end;
  v_target numeric := 24; v_respon numeric := coalesce(nullif(new.target_sla_respon_jam,0),1);
  v_acuan timestamptz;
begin
  if trim(coalesce(new.target_sla_jam,'')) ~ '^[0-9]+([.][0-9]+)?$' then
    v_target:=trim(new.target_sla_jam)::numeric;
    if v_target<=0 or v_target>1000 then v_target:=24; end if;
  end if;
  if v_respon<=0 or v_respon>1000 then v_respon:=1; end if;
  if tg_op='UPDATE' then
    if lower(trim(coalesce(old.status,'')))=v_status and v_status in ('selesai','closed','cancel','batal') then
      new.waktu_penugasan:=old.waktu_penugasan; new.sumber_waktu_penugasan:=old.sumber_waktu_penugasan;
      new.tenggat_waktu:=old.tenggat_waktu; new.status_sla:=old.status_sla;
      return new;
    end if;
    v_lama_ada:=lower(trim(coalesce(old.teknisi,''))) not in ('','-','belum ditugaskan');
    v_ganti:=v_ada and v_lama_ada and new.teknisi is distinct from old.teknisi
      and new.tenggat_pengganti is not null and new.tenggat_pengganti is distinct from old.tenggat_pengganti;
    -- A privileged, reviewed data repair may provide a confirmed historical time.
    if current_user in ('postgres','supabase_admin') and new.waktu_penugasan is distinct from old.waktu_penugasan then
      v_hitung:=true;
    elsif v_ganti or (v_ada and not v_lama_ada and old.waktu_penugasan is null) then
      new.waktu_penugasan:=statement_timestamp(); new.sumber_waktu_penugasan:='server'; v_mulai_baru:=true;
    else
      new.waktu_penugasan:=old.waktu_penugasan; new.sumber_waktu_penugasan:=old.sumber_waktu_penugasan;
      if new.waktu_penugasan is null and v_ada and v_status not in ('selesai','closed','cancel','batal') then
        new.waktu_penugasan:=least(old.waktu_respon,
          public.sla_awal_dari_tenggat_respon(old.tenggat_respon,coalesce(nullif(old.target_sla_respon_jam,0),1),old.cabang));
        if new.waktu_penugasan is not null then new.waktu_penugasan:=greatest(old.waktu_lapor,new.waktu_penugasan); end if;
        if new.waktu_penugasan is not null then new.sumber_waktu_penugasan:='riwayat_respon'; v_hitung:=true; end if;
      end if;
    end if;
    v_hitung:=v_hitung or v_mulai_baru or new.target_sla_jam is distinct from old.target_sla_jam
      or new.cabang is distinct from old.cabang or (v_ada and not v_lama_ada);
    if not v_hitung then
      -- Keep pause extensions, and prevent ordinary edits from restarting SLA.
      if lower(trim(coalesce(old.status,''))) in ('pending','outsource') and v_status='on progress' then
        new.tenggat_waktu:=coalesce(new.tenggat_waktu,old.tenggat_waktu);
      else new.tenggat_waktu:=old.tenggat_waktu; end if;
    end if;
    if lower(trim(coalesce(old.status,''))) in ('selesai','closed','cancel','batal') and v_status in ('selesai','closed','cancel','batal') then
      return new;
    end if;
  else
    if v_ada and v_status not in ('selesai','closed','cancel','batal') then
      new.waktu_penugasan:=statement_timestamp(); new.sumber_waktu_penugasan:='server'; v_mulai_baru:=true; v_hitung:=true;
    else new.waktu_penugasan:=null; new.sumber_waktu_penugasan:=null; end if;
    if v_status in ('selesai','closed','cancel','batal') then return new; end if;
  end if;
  if not v_ada then
    new.tenggat_waktu:=null;
    if new.waktu_respon is null then new.tenggat_respon:=null; new.status_sla_respon:='AMAN'; end if;
  elsif v_hitung and new.waktu_penugasan is not null then
    new.tenggat_waktu:=public.sla_tenggat_pengerjaan(new.waktu_penugasan,v_target,v_cabang);
    if v_ganti then new.tenggat_pengganti:=new.tenggat_waktu; end if;
  end if;
  if v_mulai_baru then
    new.tenggat_respon:=public.sla_tenggat_pengerjaan(new.waktu_penugasan,v_respon,v_cabang);
    new.status_sla_respon:='AMAN';
    -- Permit a fresh warning for the newly assigned technician only.
    new.status_peringatan:=replace(replace(coalesce(new.status_peringatan,''),'[PENGERJAAN_WARNED]',''),'[RESPON_WARNED]','');
  end if;
  if v_status='pending' then new.status_sla:='DIPENDING';
  elsif v_status='outsource' then new.status_sla:='DIOPOR';
  elsif v_status in ('cancel','batal') then new.status_sla:='BATAL';
  elsif not v_ada then new.status_sla:='BELUM DIMULAI'; new.poin_performa:=0;
  elsif new.tenggat_waktu is not null then
    v_acuan:=case when v_status in ('selesai','closed') then coalesce(new.waktu_selesai,statement_timestamp()) else statement_timestamp() end;
    new.status_sla:=case when v_acuan>new.tenggat_waktu then 'TERLAMBAT' when v_status in ('selesai','closed') then 'TERPENUHI' else 'AMAN' end;
  end if;
  return new;
end $$;
revoke all on function public.sla_jaga_awal_pengerjaan() from public,anon,authenticated;
drop trigger if exists sla_jaga_awal_pengerjaan on public.tiket;
create trigger sla_jaga_awal_pengerjaan before insert or update on public.tiket
for each row execute function public.sla_jaga_awal_pengerjaan();
update public.tiket set status_sla=status_sla
where waktu_penugasan is not null and lower(trim(coalesce(status,''))) not in ('selesai','closed','cancel','batal');
commit;
