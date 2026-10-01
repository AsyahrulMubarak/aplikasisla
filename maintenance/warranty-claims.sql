-- Atomic warranty ticket creation and a durable notification outbox.
begin;
alter table public.garansi add column if not exists tiket_klaim_garansi text;
alter table public.tiket add column if not exists garansi_asal text;
alter table public.tiket add column if not exists referensi_tiket_asal text;
create unique index if not exists sla_tiket_satu_klaim_garansi on public.tiket(garansi_asal) where garansi_asal is not null;

create table if not exists public.sla_notif_klaim_garansi (
  id uuid primary key default gen_random_uuid(), id_garansi text not null,
  id_tiket text not null, penerima text not null, no_wa text not null default '',
  pesan text not null, terkirim_pada timestamptz, percobaan integer not null default 0,
  lease uuid, lease_sampai timestamptz, galat text,
  unique(id_garansi,penerima)
);
alter table public.sla_notif_klaim_garansi enable row level security;
revoke all on public.sla_notif_klaim_garansi from public,anon,authenticated;
grant select,insert,update on public.sla_notif_klaim_garansi to service_role;

create or replace function public.sla_tenggat_garansi(p_awal timestamptz,p_jam numeric,p_cabang text)
returns timestamptz language plpgsql set search_path=public,pg_temp as $$
declare v_dt timestamp := p_awal at time zone 'Asia/Makassar'; v_sisa numeric := p_jam*3600;
  v_jam integer; v_menit integer; v_step numeric;
begin
  if p_jam is null or p_jam<=0 or p_jam>1000 then raise exception 'Target SLA tidak valid.'; end if;
  while v_sisa>0 loop
    v_jam:=extract(hour from v_dt); v_menit:=extract(minute from v_dt);
    if extract(dow from v_dt)=0 then v_dt:=date_trunc('day',v_dt)+interval '1 day 8 hours'; continue; end if;
    if v_jam<8 then v_dt:=date_trunc('day',v_dt)+interval '8 hours'; continue; end if;
    if v_jam>=(case when p_cabang='Raha' then 20 else 17 end) then
      v_dt:=date_trunc('day',v_dt)+interval '1 day 8 hours'; continue;
    end if;
    if v_jam=12 or (v_jam=13 and v_menit<30) or v_jam=15 then
      v_dt:=v_dt+interval '1 minute'; continue;
    end if;
    v_step:=least(60,v_sisa); v_dt:=v_dt+v_step*interval '1 second'; v_sisa:=v_sisa-v_step;
  end loop;
  return v_dt at time zone 'Asia/Makassar';
end $$;

create or replace function public.sla_klaim_garansi(p_auth_id uuid,p_id_garansi text,p_cabang text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user public.users%rowtype; v_g public.garansi%rowtype; v_t public.tiket%rowtype;
  v_id text; v_now timestamptz:=now(); v_jam numeric; v_respon numeric;
  v_nama text; v_count integer; v_phone text; v_pending integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
  select count(*) into v_count from public.users where auth_id=p_auth_id;
  if v_count<>1 then raise exception 'Profil pengguna tidak unik.'; end if;
  select * into v_user from public.users where auth_id=p_auth_id;
  if lower(trim(v_user.role)) not in ('admin','admin_raha','manager','direktur') then raise exception 'Hanya manajemen yang dapat memproses klaim garansi.'; end if;
  if p_cabang not in ('Kendari','Raha') or p_cabang is null then raise exception 'Cabang tidak valid.'; end if;
  if coalesce(v_user.hak_akses_cabang,v_user.cabang,'')<>'Semua'
    and coalesce(nullif(v_user.hak_akses_cabang,''),v_user.cabang,'')<>p_cabang then raise exception 'Cabang di luar hak akses.'; end if;
  select * into v_g from public.garansi where id_garansi=p_id_garansi and coalesce(cabang,'Kendari')=p_cabang for update;
  if not found then raise exception 'Garansi tidak ditemukan.'; end if;
  if nullif(v_g.tiket_klaim_garansi,'') is not null then
    select count(*) into v_pending from public.sla_notif_klaim_garansi where id_garansi=p_id_garansi and terkirim_pada is null;
    return jsonb_build_object('status','sukses','idTiket',v_g.tiket_klaim_garansi,'sudahAda',true,'notifikasiTertunda',v_pending);
  end if;
  if v_g.status<>'Aktif' or v_g.status is null or v_g.tanggal_habis is null or v_g.tanggal_habis<=v_now
    or v_g.tanggal_mulai is null or v_g.tanggal_mulai>v_now then raise exception 'Garansi belum aktif atau sudah habis.'; end if;
  select * into v_t from public.tiket where id_tiket=v_g.referensi_tiket_nota and coalesce(cabang,'Kendari')=p_cabang for share;
  if not found then raise exception 'Tiket asal garansi tidak ditemukan.'; end if;
  if trim(coalesce(v_t.teknisi,'')) in ('','-','Belum Ditugaskan') then raise exception 'Teknisi pada tiket asal belum ditentukan.'; end if;
  v_id:=case when p_cabang='Raha' then 'TKT-R-KG-' else 'TKT-KG-' end||p_id_garansi;
  v_jam:=case when trim(coalesce(v_t.target_sla_jam,'')) ~ '^\d+(\.\d+)?$' then v_t.target_sla_jam::numeric else 24 end;
  if v_jam<=0 or v_jam>1000 then v_jam:=24; end if;
  v_respon:=coalesce(v_t.target_sla_respon_jam,1); if v_respon<=0 or v_respon>1000 then v_respon:=1; end if;
  insert into public.tiket(id_tiket,waktu_lapor,target_sla_jam,tenggat_waktu,klien_lokasi,jenis_pekerjaan,
    teknisi,status,target_sla_respon_jam,tenggat_respon,no_wa_klien,cabang,admin_sla,keterangan,
    bobot_poin,poin_performa,garansi_asal,referensi_tiket_asal)
  values(v_id,v_now,v_jam::text,public.sla_tenggat_garansi(v_now,v_jam,p_cabang),
    coalesce(nullif(v_g.nama_pelanggan,''),v_t.klien_lokasi),coalesce(nullif(v_g.barang_jasa,''),v_t.jenis_pekerjaan),
    v_t.teknisi,'Claim Garansi',v_respon,public.sla_tenggat_garansi(v_now,v_respon,p_cabang),
    v_t.no_wa_klien,p_cabang,v_user.nama_asli,'Klaim garansi '||p_id_garansi||'; tiket asal '||v_t.id_tiket,
    0,0,p_id_garansi,v_t.id_tiket);
  update public.garansi set status='Diklaim (Hangus)',tanggal_habis=v_now,tiket_klaim_garansi=v_id where id_garansi=p_id_garansi;
  insert into public.sla_notif_klaim_garansi(id_garansi,id_tiket,penerima,no_wa,pesan)
  values(p_id_garansi,v_id,'pelanggan',coalesce(v_t.no_wa_klien,''),
    'Klaim garansi '||p_id_garansi||' telah dibuat. Tiket baru: '||v_id||'. Teknisi: '||v_t.teknisi||
    '. Status: Claim Garansi. Pantau tiket: https://aplikasisla.vercel.app/?track='||v_id);
  for v_nama in select distinct trim(x) from regexp_split_to_table(v_t.teknisi,',') x where trim(x)<>'' loop
    select count(*),max(no_wa) into v_count,v_phone from public.users where lower(trim(nama_asli))=lower(v_nama) and lower(trim(role))='teknisi';
    insert into public.sla_notif_klaim_garansi(id_garansi,id_tiket,penerima,no_wa,pesan)
    values(p_id_garansi,v_id,'teknisi:'||lower(v_nama),case when v_count=1 then coalesce(v_phone,'') else '' end,
      'Tiket klaim garansi ditugaskan kepada Anda: '||v_id||'. Garansi: '||p_id_garansi||'. Tiket asal: '||v_t.id_tiket||
      '. Klien: '||coalesce(v_g.nama_pelanggan,v_t.klien_lokasi,'-')||'. Pekerjaan: '||coalesce(v_g.barang_jasa,v_t.jenis_pekerjaan,'-')||
      '. Buka aplikasi: https://aplikasisla.vercel.app');
  end loop;
  select count(*) into v_pending from public.sla_notif_klaim_garansi where id_garansi=p_id_garansi and terkirim_pada is null;
  return jsonb_build_object('status','sukses','idTiket',v_id,'sudahAda',false,'notifikasiTertunda',v_pending);
end $$;

create or replace function public.sla_ambil_notif_garansi(p_id_garansi text)
returns setof public.sla_notif_klaim_garansi language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
  return query with calon as (
    select id from public.sla_notif_klaim_garansi where id_garansi=p_id_garansi and terkirim_pada is null
      and (lease_sampai is null or lease_sampai<now()) order by penerima for update skip locked
  ) update public.sla_notif_klaim_garansi n set lease=gen_random_uuid(),lease_sampai=now()+interval '10 minutes',percobaan=n.percobaan+1
    from calon where n.id=calon.id returning n.*;
end $$;
create or replace function public.sla_selesai_notif_garansi(p_id uuid,p_lease uuid,p_sukses boolean,p_galat text default '')
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
  update public.sla_notif_klaim_garansi set terkirim_pada=case when p_sukses then now() else null end,
    galat=case when p_sukses then null else left(p_galat,300) end,lease=null,
    lease_sampai=case when p_sukses then null else now()+interval '5 minutes' end
  where id=p_id and lease=p_lease and terkirim_pada is null;
  get diagnostics v_count=row_count; return v_count=1;
end $$;
revoke all on function public.sla_tenggat_garansi(timestamptz,numeric,text),
  public.sla_klaim_garansi(uuid,text,text),public.sla_ambil_notif_garansi(text),public.sla_selesai_notif_garansi(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.sla_tenggat_garansi(timestamptz,numeric,text),
  public.sla_klaim_garansi(uuid,text,text),public.sla_ambil_notif_garansi(text),public.sla_selesai_notif_garansi(uuid,uuid,boolean,text) to service_role;
notify pgrst,'reload schema';
commit;
