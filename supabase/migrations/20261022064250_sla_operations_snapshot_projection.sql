-- Avoid detoasting signatures/photos when planning a notification.
create or replace function public.sla_ops_snapshot() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
  'tickets',coalesce((select jsonb_agg(to_jsonb(t) order by id_tiket) from (
   select id_tiket,cabang,status,teknisi,waktu_lapor,waktu_penugasan,waktu_selesai,waktu_respon,
    tenggat_respon,tenggat_waktu,tenggat_pengganti,status_peringatan,klien_lokasi,jenis_pekerjaan,no_wa_klien
   from public.tiket
  ) t),'[]'),
  'users',coalesce((select jsonb_agg(to_jsonb(u) order by username) from (
   select username,nama_asli,role,no_wa,cabang,hak_akses_cabang,account_active from public.users
  ) u),'[]'),
  'warranties',coalesce((select jsonb_agg(to_jsonb(g) order by id_garansi) from (
   select id_garansi,referensi_tiket_nota,cabang,status,durasi_hari,tanggal_habis,follow_up_after_sales_terkirim,
    waktu_diambil,waktu_siap_diambil,riwayat_follow_up,nama_pelanggan,barang_jasa from public.garansi
  ) g),'[]'),
  'prospects',coalesce((select jsonb_agg(to_jsonb(p) order by id_prospek) from (
   select id_prospek,cabang,tanggal_input,status_prospek,nama_calon_customer,kebutuhan,sales_penanggung_jawab,
    waktu_follow_up_terakhir,riwayat_follow_up,waktu_peringatan_crm_terakhir from public.prospek
  ) p),'[]'),
  'previous',coalesce((select jsonb_agg(jsonb_build_object('id_garansi',id_garansi,'terkirim_pada',terkirim_pada)) from public.sla_notif_penitipan),'[]')
 )
$$;
-- The guard must also avoid loading unrelated attachments for each recipient.
create or replace function public.sla_ops_guard_valid(p_guard jsonb,p_branch text) returns boolean
language plpgsql stable set search_path='' as $$
declare row_data jsonb;
begin
 if coalesce(p_guard->>'table','')='' then return true; end if;
 if p_guard->>'table'='tiket' then
  select jsonb_build_object('status',status,'teknisi',teknisi,'waktu_lapor',waktu_lapor,'waktu_penugasan',waktu_penugasan,'waktu_selesai',waktu_selesai,'waktu_respon',waktu_respon,'tenggat_respon',tenggat_respon,'tenggat_waktu',tenggat_waktu,'tenggat_pengganti',tenggat_pengganti,'no_wa_klien',no_wa_klien) into row_data from public.tiket where id_tiket=p_guard->>'id' and coalesce(cabang,'Kendari')=p_branch;
 elsif p_guard->>'table'='prospek' then
  select jsonb_build_object('status_prospek',status_prospek,'tanggal_input',tanggal_input,'waktu_follow_up_terakhir',waktu_follow_up_terakhir,'riwayat_follow_up',riwayat_follow_up,'sales_penanggung_jawab',sales_penanggung_jawab) into row_data from public.prospek where id_prospek=p_guard->>'id' and coalesce(cabang,'Kendari')=p_branch;
 elsif p_guard->>'table'='garansi' then
  select jsonb_build_object('status',status,'durasi_hari',durasi_hari,'follow_up_after_sales_terkirim',follow_up_after_sales_terkirim,'tanggal_habis',tanggal_habis,'referensi_tiket_nota',referensi_tiket_nota,'waktu_diambil',waktu_diambil,'waktu_siap_diambil',waktu_siap_diambil,'riwayat_follow_up',riwayat_follow_up) into row_data from public.garansi where id_garansi=p_guard->>'id' and coalesce(cabang,'Kendari')=p_branch;
 else return false; end if;
 if row_data is null or not row_data @> coalesce(p_guard->'expected','{}') then return false; end if;
 if p_guard ? 'noWarranty' and exists(select 1 from public.garansi where referensi_tiket_nota=p_guard->>'id' and coalesce(cabang,'Kendari')=p_branch) then return false; end if;
 if p_guard ? 'ticket' and not public.sla_ops_guard_valid(p_guard->'ticket',p_branch) then return false; end if;
 return true;
end $$;
