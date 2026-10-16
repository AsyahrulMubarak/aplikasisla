-- Item entitlements live on their card so realtime and historical card identities stay intact.
-- Every claim, its selected items and notification outbox are committed in one transaction.
begin;
alter table public.garansi add column if not exists item_garansi jsonb not null default '[]';
alter table public.garansi add column if not exists riwayat_klaim_item jsonb not null default '[]';
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.garansi'::regclass and conname='garansi_item_array') then
    alter table public.garansi add constraint garansi_item_array check (jsonb_typeof(item_garansi)='array' and jsonb_array_length(item_garansi)<=100);
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.garansi'::regclass and conname='garansi_claim_array') then
    alter table public.garansi add constraint garansi_claim_array check (jsonb_typeof(riwayat_klaim_item)='array');
  end if;
end $$;

create or replace function public.sla_otorisasi_item_garansi(p_auth_id uuid,p_cabang text)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_user public.users%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
  if (select count(*) from public.users where auth_id=p_auth_id)<>1 then raise exception 'Profil pengguna tidak unik.'; end if;
  select * into v_user from public.users where auth_id=p_auth_id;
  if lower(trim(v_user.role)) not in ('admin','admin_raha','manager','direktur') then raise exception 'Hanya manajemen yang dapat memproses garansi.'; end if;
  if p_cabang is null or p_cabang not in ('Kendari','Raha') then raise exception 'Cabang tidak valid.'; end if;
  if lower(trim(v_user.role))='admin_raha' and p_cabang<>'Raha' then raise exception 'Cabang di luar hak akses.'; end if;
  if coalesce(nullif(v_user.hak_akses_cabang,''),v_user.cabang,'') not in ('Semua',p_cabang) then raise exception 'Cabang di luar hak akses.'; end if;
end $$;

-- A late pickup still passes through the original seven-day storage trigger first.
-- Item dates become immutable after activation; a claim never rewrites an expiry date.
create or replace function public.sla_jaga_item_garansi()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_item jsonb; v_items jsonb:='[]'; v_id text; v_days integer; v_status text;
  v_seen text[]:='{}'; v_start timestamptz; v_end timestamptz; v_max_end timestamptz;
  v_live integer:=0; v_claimed integer:=0; v_wait integer:=0; v_count integer:=0; v_max_days integer:=0;
  v_trusted boolean:=coalesce(auth.role(),'')='service_role' and coalesce(current_setting('sla.warranty_items_write',true),'')='on';
begin
  if tg_op='INSERT' then
    if new.riwayat_klaim_item<>'[]'::jsonb then raise exception 'Riwayat klaim hanya dapat dibuat melalui proses klaim.'; end if;
  else
    if not v_trusted and (new.item_garansi is distinct from old.item_garansi or new.riwayat_klaim_item is distinct from old.riwayat_klaim_item) then
      raise exception 'Gunakan pengelolaan item atau proses klaim untuk mengubah rincian garansi.';
    end if;
    if jsonb_array_length(old.item_garansi)>0 then
      if new.id_garansi is distinct from old.id_garansi or new.referensi_tiket_nota is distinct from old.referensi_tiket_nota or new.cabang is distinct from old.cabang then raise exception 'Identitas kartu dengan rincian item tidak dapat dipindahkan.'; end if;
      if not v_trusted and new.tiket_klaim_garansi is distinct from old.tiket_klaim_garansi then raise exception 'Tautan klaim hanya dapat diubah melalui proses klaim.'; end if;
      if not v_trusted and old.waktu_diambil is not null and (new.tanggal_mulai is distinct from old.tanggal_mulai or new.tanggal_habis is distinct from old.tanggal_habis or new.durasi_hari is distinct from old.durasi_hari or new.status is distinct from old.status) then
        raise exception 'Status dan tanggal garansi dikelola per item dan tidak dapat direset dari kartu.';
      end if;
      if not v_trusted and old.waktu_diambil is null and new.status not in (old.status,'Aktif','Hangus (Lewat 7 Hari)') then
        raise exception 'Gunakan pencatatan pengambilan untuk memulai garansi item.';
      end if;
    end if;
  end if;
  if jsonb_array_length(new.item_garansi)=0 then return new; end if;
  if tg_op='INSERT' and new.status not in ('Masa Tunggu','Belum Diambil','Aktif','Habis (Tanpa Garansi)','Hangus (Lewat 7 Hari)') then raise exception 'Status awal kartu tidak valid.'; end if;
  for v_item in select value from jsonb_array_elements(new.item_garansi) loop
    v_id:=v_item->>'id';
    if coalesce(v_id,'') !~ '^[A-Za-z0-9_-]{1,100}$' or v_id=any(v_seen) then raise exception 'Identitas item tidak valid atau berulang.'; end if;
    v_seen:=array_append(v_seen,v_id);
    if length(trim(coalesce(v_item->>'nama','')))=0 or length(v_item->>'nama')>500 then raise exception 'Nama item wajib diisi, maksimal 500 karakter.'; end if;
    if coalesce(v_item->>'durasi_hari','') !~ '^\d{1,5}$' then raise exception 'Durasi item harus berupa bilangan bulat nol atau lebih.'; end if;
    v_days:=(v_item->>'durasi_hari')::integer;
    if v_days>36500 then raise exception 'Durasi item terlalu panjang.'; end if;
    v_status:=v_item->>'status'; v_start:=nullif(v_item->>'tanggal_mulai','')::timestamptz; v_end:=nullif(v_item->>'tanggal_habis','')::timestamptz;
    if tg_op='INSERT' or (tg_op='UPDATE' and old.waktu_diambil is null and new.waktu_diambil is not null) then
      v_start:=null; v_end:=null;
      if v_days=0 then v_status:='Habis (Tanpa Garansi)';
      elsif new.waktu_diambil is null then v_status:='Masa Tunggu';
      elsif new.garansi_hangus_pada is not null then v_status:='Hangus (Lewat 7 Hari)';
      else v_start:=new.waktu_diambil; v_end:=v_start+v_days*interval '24 hours'; v_status:='Aktif'; end if;
      v_item:=jsonb_build_object('id',v_id,'nama',trim(v_item->>'nama'),'durasi_hari',v_days,'status',v_status,'tanggal_mulai',v_start,'tanggal_habis',v_end);
    end if;
    if new.garansi_hangus_pada is not null and v_status<>'Diklaim (Hangus)' and v_days>0 then
      v_status:='Hangus (Lewat 7 Hari)'; v_item:=v_item||jsonb_build_object('status',v_status);
    end if;
    if v_status='Aktif' and v_end>now() then v_live:=v_live+1; end if;
    if v_status='Masa Tunggu' then v_wait:=v_wait+1; end if;
    if v_status='Diklaim (Hangus)' then v_claimed:=v_claimed+1; end if;
    v_count:=v_count+1; v_max_days:=greatest(v_max_days,v_days); v_max_end:=greatest(v_max_end,v_end);
    v_items:=v_items||jsonb_build_array(v_item);
  end loop;
  new.item_garansi:=v_items; new.durasi_hari:=v_max_days;
  if new.waktu_diambil is null then
    new.status:=case when v_max_days=0 then 'Habis (Tanpa Garansi)' else 'Masa Tunggu' end;
  elsif new.garansi_hangus_pada is not null then new.status:='Hangus (Lewat 7 Hari)';
  else
    new.status:=case when v_live>0 then 'Aktif' when v_claimed=v_count then 'Diklaim (Hangus)' when v_max_days=0 then 'Habis (Tanpa Garansi)' else 'Habis (Expired)' end;
    new.tanggal_habis:=v_max_end;
  end if;
  return new;
end $$;
drop trigger if exists zz_sla_jaga_item_garansi on public.garansi;
create trigger zz_sla_jaga_item_garansi before insert or update on public.garansi for each row execute function public.sla_jaga_item_garansi();

create or replace function public.sla_simpan_item_garansi(p_auth_id uuid,p_id_garansi text,p_cabang text,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_g public.garansi%rowtype; v_item jsonb; v_items jsonb:='[]'; v_days integer; v_wait boolean;
begin
  perform public.sla_otorisasi_item_garansi(p_auth_id,p_cabang);
  select * into v_g from public.garansi where id_garansi=p_id_garansi and coalesce(cabang,'Kendari')=p_cabang for update;
  if not found then raise exception 'Garansi tidak ditemukan.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Masukkan 1 sampai 100 item garansi.'; end if;
  if jsonb_array_length(v_g.riwayat_klaim_item)>0 or nullif(v_g.tiket_klaim_garansi,'') is not null or v_g.status like '%Diklaim%' then raise exception 'Rincian kartu yang pernah diklaim tidak dapat dipecah atau diganti.'; end if;
  v_wait:=v_g.status in ('Masa Tunggu','Belum Diambil') and v_g.waktu_diambil is null;
  if jsonb_array_length(v_g.item_garansi)>0 and not v_wait then raise exception 'Rincian item yang sudah berjalan tidak dapat diganti.'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_item->>'durasi_hari','') !~ '^\d{1,5}$' then raise exception 'Durasi item tidak valid.'; end if;
    v_days:=case when v_wait then (v_item->>'durasi_hari')::integer else coalesce(v_g.durasi_hari,0) end;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('id',v_item->>'id','nama',v_item->>'nama','durasi_hari',v_days,
      'status',case when v_wait then case when v_days=0 then 'Habis (Tanpa Garansi)' else 'Masa Tunggu' end else v_g.status end,
      'tanggal_mulai',case when v_wait then null else v_g.tanggal_mulai end,'tanggal_habis',case when v_wait then null else v_g.tanggal_habis end));
  end loop;
  perform set_config('sla.warranty_items_write','on',true);
  update public.garansi set item_garansi=v_items where id_garansi=p_id_garansi;
  perform set_config('sla.warranty_items_write','',true);
  return jsonb_build_object('status','sukses');
end $$;

-- Keep previous tickets and notifications. Uniqueness is now per claim ticket.
drop index if exists public.sla_tiket_satu_klaim_garansi;
create index if not exists sla_tiket_garansi_asal on public.tiket(garansi_asal) where garansi_asal is not null;
alter table public.sla_notif_klaim_garansi drop constraint if exists sla_notif_klaim_garansi_id_garansi_penerima_key;
create unique index if not exists sla_notif_klaim_tiket_penerima on public.sla_notif_klaim_garansi(id_tiket,penerima);

create or replace function public.sla_klaim_item_garansi(p_auth_id uuid,p_id_garansi text,p_cabang text,p_item_ids text[],p_request_id uuid,p_keluhan text default '')
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_g public.garansi%rowtype; v_t public.tiket%rowtype; v_user public.users%rowtype;
  v_item jsonb; v_items jsonb:='[]'; v_history jsonb; v_previous jsonb; v_names text[]:='{}';
  v_id text; v_now timestamptz:=now(); v_jam numeric; v_respon numeric; v_name text; v_phone text; v_count integer; v_pending integer;
begin
  perform public.sla_otorisasi_item_garansi(p_auth_id,p_cabang);
  if p_request_id is null or coalesce(cardinality(p_item_ids),0) not between 1 and 100 or length(coalesce(p_keluhan,''))>2000 then raise exception 'Pilih item klaim dan isi keluhan maksimal 2000 karakter.'; end if;
  if exists(select 1 from unnest(p_item_ids) x where x is null) or (select count(distinct x) from unnest(p_item_ids)x)<>cardinality(p_item_ids) then raise exception 'Pilihan item berulang atau tidak valid.'; end if;
  select * into v_g from public.garansi where id_garansi=p_id_garansi and coalesce(cabang,'Kendari')=p_cabang for update;
  if not found then raise exception 'Garansi tidak ditemukan.'; end if;
  select value into v_previous from jsonb_array_elements(v_g.riwayat_klaim_item) where value->>'id_klaim'=p_request_id::text;
  if found then
    if (select array_agg(x order by x) from jsonb_array_elements_text(v_previous->'item_ids')x) is distinct from (select array_agg(x order by x) from unnest(p_item_ids)x) then raise exception 'Identitas pengajuan sudah dipakai untuk pilihan item lain.'; end if;
    select count(*) into v_pending from public.sla_notif_klaim_garansi where id_garansi=p_id_garansi and terkirim_pada is null;
    return jsonb_build_object('status','sukses','idTiket',v_previous->>'id_tiket','sudahAda',true,'notifikasiTertunda',v_pending);
  end if;
  if v_g.garansi_hangus_pada is not null or (v_g.waktu_diambil is not null and public.sla_hari_penitipan(v_g.waktu_siap_diambil,v_g.waktu_diambil)>7) then raise exception 'Garansi hangus karena barang mengendap lebih dari 7 hari.'; end if;
  if jsonb_array_length(v_g.item_garansi)=0 then
    if nullif(v_g.tiket_klaim_garansi,'') is not null then raise exception 'Kartu lama sudah memiliki klaim. Riwayat tetap dipertahankan.'; end if;
    v_g.item_garansi:=jsonb_build_array(jsonb_build_object('id','legacy','nama',coalesce(nullif(v_g.barang_jasa,''),'Cakupan kartu lama'),'durasi_hari',coalesce(v_g.durasi_hari,0),'status',v_g.status,'tanggal_mulai',v_g.tanggal_mulai,'tanggal_habis',v_g.tanggal_habis));
  end if;
  if (select count(*) from jsonb_array_elements(v_g.item_garansi) x where x->>'id'=any(p_item_ids))<>cardinality(p_item_ids) then raise exception 'Item tidak ditemukan pada kartu ini.'; end if;
  for v_item in select value from jsonb_array_elements(v_g.item_garansi) loop
    if v_item->>'id'=any(p_item_ids) then
      if v_item->>'status' is distinct from 'Aktif' or nullif(v_item->>'tanggal_mulai','')::timestamptz is null or (v_item->>'tanggal_mulai')::timestamptz>v_now or nullif(v_item->>'tanggal_habis','')::timestamptz is null or (v_item->>'tanggal_habis')::timestamptz<=v_now then raise exception 'Item belum aktif, sudah habis, atau sudah diklaim.'; end if;
      v_names:=array_append(v_names,v_item->>'nama');
    end if;
  end loop;
  select * into v_t from public.tiket where id_tiket=v_g.referensi_tiket_nota and coalesce(cabang,'Kendari')=p_cabang for share;
  if not found then raise exception 'Tiket asal garansi tidak ditemukan.'; end if;
  if trim(coalesce(v_t.teknisi,'')) in ('','-','Belum Ditugaskan') then raise exception 'Teknisi pada tiket asal belum ditentukan.'; end if;
  select * into v_user from public.users where auth_id=p_auth_id;
  v_id:=case when p_cabang='Raha' then 'TKT-R-KG-' else 'TKT-KG-' end||p_request_id::text;
  v_jam:=case when trim(coalesce(v_t.target_sla_jam,'')) ~ '^\d+(\.\d+)?$' then v_t.target_sla_jam::numeric else 24 end;
  if v_jam<=0 or v_jam>1000 then v_jam:=24; end if;
  v_respon:=coalesce(v_t.target_sla_respon_jam,1); if v_respon<=0 or v_respon>1000 then v_respon:=1; end if;
  insert into public.tiket(id_tiket,waktu_lapor,target_sla_jam,tenggat_waktu,klien_lokasi,jenis_pekerjaan,teknisi,status,target_sla_respon_jam,tenggat_respon,no_wa_klien,cabang,admin_sla,keterangan,bobot_poin,poin_performa,garansi_asal,referensi_tiket_asal)
  values(v_id,v_now,v_jam::text,public.sla_tenggat_garansi(v_now,v_jam,p_cabang),coalesce(nullif(v_g.nama_pelanggan,''),v_t.klien_lokasi),array_to_string(v_names,'; '),v_t.teknisi,'Claim Garansi',v_respon,public.sla_tenggat_garansi(v_now,v_respon,p_cabang),v_t.no_wa_klien,p_cabang,v_user.nama_asli,'Klaim item kartu '||p_id_garansi||'; tiket asal '||v_t.id_tiket||case when coalesce(p_keluhan,'')<>'' then E'\nKeluhan: '||p_keluhan else '' end,0,0,p_id_garansi,v_t.id_tiket);
  for v_item in select value from jsonb_array_elements(v_g.item_garansi) loop
    if v_item->>'id'=any(p_item_ids) then v_item:=v_item||jsonb_build_object('status','Diklaim (Hangus)','tiket_klaim_garansi',v_id,'diklaim_pada',v_now); end if;
    v_items:=v_items||jsonb_build_array(v_item);
  end loop;
  v_history:=jsonb_build_object('id_klaim',p_request_id,'id_tiket',v_id,'item_ids',to_jsonb(p_item_ids),'nama_item',to_jsonb(v_names),'waktu_klaim',v_now,'keluhan',coalesce(p_keluhan,''));
  perform set_config('sla.warranty_items_write','on',true);
  update public.garansi set item_garansi=v_items,riwayat_klaim_item=riwayat_klaim_item||jsonb_build_array(v_history),tiket_klaim_garansi=coalesce(nullif(tiket_klaim_garansi,''),v_id) where id_garansi=p_id_garansi;
  perform set_config('sla.warranty_items_write','',true);
  insert into public.sla_notif_klaim_garansi(id_garansi,id_tiket,penerima,no_wa,pesan)
  values(p_id_garansi,v_id,'pelanggan',coalesce(v_t.no_wa_klien,''),'Klaim garansi '||p_id_garansi||'. Item: '||array_to_string(v_names,'; ')||'. Tiket: '||v_id||'. Item lain tetap mengikuti masa garansi semula. Pantau: https://aplikasisla.vercel.app/?track='||v_id);
  for v_name in select distinct trim(x) from regexp_split_to_table(v_t.teknisi,',')x where trim(x)<>'' loop
    select count(*),max(no_wa) into v_count,v_phone from public.users where lower(trim(nama_asli))=lower(v_name) and lower(trim(role))='teknisi';
    insert into public.sla_notif_klaim_garansi(id_garansi,id_tiket,penerima,no_wa,pesan)
    values(p_id_garansi,v_id,'teknisi:'||lower(v_name),case when v_count=1 then coalesce(v_phone,'') else '' end,'Tiket klaim garansi: '||v_id||'. Kartu: '||p_id_garansi||'. Tiket asal: '||v_t.id_tiket||'. Item: '||array_to_string(v_names,'; ')||'. Keluhan: '||coalesce(p_keluhan,'')||'. Buka https://aplikasisla.vercel.app');
  end loop;
  select count(*) into v_pending from public.sla_notif_klaim_garansi where id_garansi=p_id_garansi and terkirim_pada is null;
  return jsonb_build_object('status','sukses','idTiket',v_id,'sudahAda',false,'notifikasiTertunda',v_pending);
end $$;

-- Older clients may retry their historical ticket, but cannot consume an entire multi-item card.
create or replace function public.sla_klaim_garansi(p_auth_id uuid,p_id_garansi text,p_cabang text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_g public.garansi%rowtype; v_pending integer;
begin
  perform public.sla_otorisasi_item_garansi(p_auth_id,p_cabang);
  select * into v_g from public.garansi where id_garansi=p_id_garansi and coalesce(cabang,'Kendari')=p_cabang for update;
  if not found then raise exception 'Garansi tidak ditemukan.'; end if;
  if nullif(v_g.tiket_klaim_garansi,'') is not null then
    select count(*) into v_pending from public.sla_notif_klaim_garansi where id_garansi=p_id_garansi and terkirim_pada is null;
    return jsonb_build_object('status','sukses','idTiket',v_g.tiket_klaim_garansi,'sudahAda',true,'notifikasiTertunda',v_pending);
  end if;
  if jsonb_array_length(v_g.item_garansi)>0 then raise exception 'Pilih item yang akan diklaim. Muat ulang aplikasi.'; end if;
  return public.sla_klaim_item_garansi(p_auth_id,p_id_garansi,p_cabang,array['legacy'],gen_random_uuid(),'');
end $$;
revoke all on function public.sla_otorisasi_item_garansi(uuid,text),public.sla_simpan_item_garansi(uuid,text,text,jsonb),public.sla_klaim_item_garansi(uuid,text,text,text[],uuid,text),public.sla_klaim_garansi(uuid,text,text) from public,anon,authenticated;
grant execute on function public.sla_otorisasi_item_garansi(uuid,text),public.sla_simpan_item_garansi(uuid,text,text,jsonb),public.sla_klaim_item_garansi(uuid,text,text,text[],uuid,text),public.sla_klaim_garansi(uuid,text,text) to service_role;
revoke all on function public.sla_jaga_item_garansi() from public,anon,authenticated;
grant execute on function public.sla_jaga_item_garansi() to authenticated,service_role;
notify pgrst,'reload schema';
commit;
