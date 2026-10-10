-- Seven days of free storage, immutable forfeiture, and a day-five reminder.
begin;
alter table public.garansi add column if not exists waktu_siap_diambil timestamptz;
alter table public.garansi add column if not exists waktu_diambil timestamptz;
alter table public.garansi add column if not exists garansi_hangus_pada timestamptz;
alter table public.garansi add column if not exists biaya_penitipan integer not null default 0;

create or replace function public.sla_hari_penitipan(p_siap timestamptz,p_akhir timestamptz)
returns integer language sql immutable set search_path=public,pg_temp as $$
  select greatest(0,(p_akhir at time zone 'Asia/Makassar')::date-(p_siap at time zone 'Asia/Makassar')::date)
$$;
create or replace function public.sla_biaya_penitipan(p_siap timestamptz,p_akhir timestamptz)
returns integer language sql immutable set search_path=public,pg_temp as $$
  select case when p_siap is null or p_akhir is null then 0
    else greatest(0,least(30,public.sla_hari_penitipan(p_siap,p_akhir))-7)*1000 end
$$;

-- Existing activation dates serve as the recorded pickup time. Waiting cards
-- retain their status even when their entitlement has already been forfeited.
update public.garansi g set waktu_siap_diambil=t.waktu_selesai
from public.tiket t where t.id_tiket=g.referensi_tiket_nota
  and coalesce(t.cabang,'Kendari')=coalesce(g.cabang,'Kendari')
  and g.waktu_siap_diambil is null and t.waktu_selesai is not null;
update public.garansi g set waktu_siap_diambil=p.waktu_lapor
from public.penjualan p where p.id_penjualan=g.referensi_tiket_nota
  and coalesce(p.cabang,'Kendari')=coalesce(g.cabang,'Kendari')
  and g.waktu_siap_diambil is null;
update public.garansi set waktu_diambil=tanggal_mulai
where waktu_diambil is null and tanggal_mulai is not null
  and status not in ('Masa Tunggu','Belum Diambil');

create or replace function public.sla_jaga_penitipan_garansi()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_siap timestamptz; v_ambil timestamptz; v_hangus timestamptz;
begin
  if tg_op='UPDATE' then
    v_siap:=old.waktu_siap_diambil; v_ambil:=old.waktu_diambil;
    v_hangus:=old.garansi_hangus_pada;
  end if;
  if v_siap is null then
    select waktu_selesai into v_siap from public.tiket
      where id_tiket=new.referensi_tiket_nota
        and coalesce(cabang,'Kendari')=coalesce(new.cabang,'Kendari');
    if v_siap is null then
      select waktu_lapor into v_siap from public.penjualan
        where id_penjualan=new.referensi_tiket_nota
          and coalesce(cabang,'Kendari')=coalesce(new.cabang,'Kendari');
    end if;
  end if;
  if v_ambil is null and new.status in ('Aktif','Hangus (Lewat 7 Hari)') then
    if v_siap is null then raise exception 'Waktu servis selesai belum tercatat. Garansi belum dapat diaktifkan.'; end if;
    v_ambil:=now();
    if new.status='Aktif' then
      if coalesce(new.durasi_hari,0)<=0 then raise exception 'Durasi garansi harus lebih dari 0 hari.'; end if;
      new.tanggal_mulai:=v_ambil;
      new.tanggal_habis:=v_ambil+new.durasi_hari*interval '24 hours';
    end if;
  end if;
  if v_siap is not null and public.sla_hari_penitipan(v_siap,coalesce(v_ambil,now()))>7 then
    v_hangus:=coalesce(v_hangus,((v_siap at time zone 'Asia/Makassar')::date+8)::timestamp at time zone 'Asia/Makassar');
  end if;
  new.waktu_siap_diambil:=v_siap;
  new.waktu_diambil:=v_ambil;
  new.garansi_hangus_pada:=v_hangus;
  new.biaya_penitipan:=public.sla_biaya_penitipan(v_siap,coalesce(v_ambil,now()));
  if v_hangus is not null then
    if v_ambil is null and new.status in ('Masa Tunggu','Belum Diambil') then
      new.tanggal_mulai:=null; new.tanggal_habis:=null;
    else
      new.status:='Hangus (Lewat 7 Hari)';
      new.tanggal_mulai:=v_siap; new.tanggal_habis:=v_hangus;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists sla_jaga_penitipan_garansi on public.garansi;
create trigger sla_jaga_penitipan_garansi before insert or update on public.garansi
for each row execute function public.sla_jaga_penitipan_garansi();

create table if not exists public.sla_notif_penitipan (
  id uuid primary key default gen_random_uuid(),
  id_garansi text not null unique references public.garansi(id_garansi) on delete cascade,
  terkirim_pada timestamptz, percobaan integer not null default 0,
  lease uuid, lease_sampai timestamptz, galat text
);
alter table public.sla_notif_penitipan enable row level security;
create index if not exists sla_notif_penitipan_pending on public.sla_notif_penitipan(lease_sampai,id) where terkirim_pada is null;
revoke all on public.sla_notif_penitipan from public,anon,authenticated;
grant select,insert,update,delete on public.sla_notif_penitipan to service_role;

create or replace function public.sla_perbarui_penitipan()
returns integer language plpgsql set search_path=public,pg_temp as $$
declare v_count integer;
begin
  update public.garansi set biaya_penitipan=biaya_penitipan
    where status in ('Masa Tunggu','Belum Diambil') or
      (status='Aktif' and garansi_hangus_pada is null and public.sla_hari_penitipan(waktu_siap_diambil,waktu_diambil)>7);
  get diagnostics v_count=row_count;
  insert into public.sla_notif_penitipan(id_garansi)
    select id_garansi from public.garansi
    where status in ('Masa Tunggu','Belum Diambil') and waktu_diambil is null
      and public.sla_hari_penitipan(waktu_siap_diambil,now()) between 5 and 7
      and coalesce(riwayat_follow_up,'') !~* '(HARI[_ ]?5|HARI KE-?5|H-5)'
    on conflict(id_garansi) do nothing;
  return v_count;
end $$;

create or replace function public.sla_ambil_notif_penitipan()
returns setof public.sla_notif_penitipan language plpgsql set search_path=public,pg_temp as $$
begin
  return query with calon as (
    select n.id from public.sla_notif_penitipan n join public.garansi g on g.id_garansi=n.id_garansi
    where n.terkirim_pada is null and (n.lease_sampai is null or n.lease_sampai<now())
      and g.waktu_diambil is null and g.status in ('Masa Tunggu','Belum Diambil')
      and public.sla_hari_penitipan(g.waktu_siap_diambil,now()) between 5 and 7
    order by n.id limit 5 for update of n skip locked
  ) update public.sla_notif_penitipan n set lease=gen_random_uuid(),lease_sampai=now()+interval '10 minutes',percobaan=n.percobaan+1
    from calon where n.id=calon.id returning n.*;
end $$;
create or replace function public.sla_selesai_notif_penitipan(p_id uuid,p_lease uuid,p_sukses boolean,p_galat text default '')
returns boolean language plpgsql set search_path=public,pg_temp as $$
declare v_count integer;
begin
  update public.sla_notif_penitipan set terkirim_pada=case when p_sukses then now() else null end,
    galat=case when p_sukses then null else left(p_galat,300) end,lease=null,
    lease_sampai=case when p_sukses then null else now()+interval '5 minutes' end
    where id=p_id and lease=p_lease and terkirim_pada is null;
  get diagnostics v_count=row_count;
  if v_count=1 and p_sukses then
    update public.garansi g set riwayat_follow_up=concat_ws(E'\n',nullif(g.riwayat_follow_up,''),
      'HARI_5 | '||to_char(now() at time zone 'Asia/Makassar','YYYY-MM-DD HH24:MI:SS')||' | Pengingat penitipan diterima Fonnte')
    from public.sla_notif_penitipan n where n.id=p_id and g.id_garansi=n.id_garansi
      and g.waktu_diambil is null and g.status in ('Masa Tunggu','Belum Diambil')
      and public.sla_hari_penitipan(g.waktu_siap_diambil,now()) between 5 and 7;
  end if;
  return v_count=1;
end $$;
revoke all on function public.sla_jaga_penitipan_garansi(),public.sla_perbarui_penitipan(),
  public.sla_ambil_notif_penitipan(),public.sla_selesai_notif_penitipan(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.sla_jaga_penitipan_garansi() to authenticated,service_role;
grant execute on function public.sla_perbarui_penitipan(),public.sla_ambil_notif_penitipan(),
  public.sla_selesai_notif_penitipan(uuid,uuid,boolean,text) to service_role;
select public.sla_perbarui_penitipan();
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
  if v_g.garansi_hangus_pada is not null or (v_g.waktu_diambil is not null and public.sla_hari_penitipan(v_g.waktu_siap_diambil,v_g.waktu_diambil)>7) then raise exception 'Garansi hangus karena barang mengendap lebih dari 7 hari. Kerusakan yang sama tidak tercover garansi.'; end if;
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

notify pgrst,'reload schema';
commit;
