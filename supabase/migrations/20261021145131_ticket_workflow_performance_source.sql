create or replace function public.sla_performa_sumber(p_username text,p_periode text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare u public.users%rowtype; result jsonb; branch text; begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 if p_periode !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_periode<'2026-10' or p_periode>to_char(public.sla_gaji_sekarang() at time zone 'Asia/Makassar','YYYY-MM') then raise exception 'Periode belum tersedia.'; end if;
 select * into strict u from public.users where username=p_username;
 branch:=public.sla_gaji_cabang(u);
 with related as (
  select t.* from public.tiket t where coalesce(t.cabang,'Kendari')=branch and (
   lower(regexp_replace(btrim(u.nama_asli),'\s+',' ','g'))=any(public.sla_penilaian_nama(coalesce(t.teknisi,'')||','||coalesce(t.teknisi_sebelumnya,'')))
   or exists(select 1 from jsonb_array_elements(coalesce(t.riwayat_penggantian_teknisi,'[]')) h where lower(btrim(u.nama_asli))=any(public.sla_penilaian_nama(coalesce(h->>'dari','')||','||coalesce(h->>'ke',''))))
   or exists(select 1 from jsonb_array_elements(coalesce(t.penilaian_teknisi->'achievement'->'members','[]')) m where m->>'username'=u.username or lower(btrim(m->>'name'))=lower(btrim(u.nama_asli)))
  )
 ), selected as (
  select * from related r where
   p_periode=any(array[to_char(r.waktu_lapor at time zone 'Asia/Makassar','YYYY-MM'),to_char(r.waktu_penugasan at time zone 'Asia/Makassar','YYYY-MM'),to_char(r.waktu_selesai at time zone 'Asia/Makassar','YYYY-MM'),to_char(r.tenggat_waktu at time zone 'Asia/Makassar','YYYY-MM'),to_char(r.tenggat_respon at time zone 'Asia/Makassar','YYYY-MM')])
   or exists(select 1 from jsonb_array_elements(coalesce(r.riwayat_penggantian_teknisi,'[]')) h where to_char(nullif(h->>'waktu','')::timestamptz at time zone 'Asia/Makassar','YYYY-MM')=p_periode)
   or exists(select 1 from public.garansi g where g.referensi_tiket_nota=r.id_tiket and g.cabang=branch and g.tanggal_mulai<((p_periode||'-01')::date+interval '1 month') at time zone 'Asia/Makassar' and g.tanggal_habis>=((p_periode||'-01')::date) at time zone 'Asia/Makassar')
   or exists(select 1 from public.tiket c where c.referensi_tiket_asal=r.id_tiket and c.cabang=branch and to_char(c.waktu_lapor at time zone 'Asia/Makassar','YYYY-MM')=p_periode)
  union select t.* from public.tiket t where t.cabang=branch and to_char(t.waktu_lapor at time zone 'Asia/Makassar','YYYY-MM')=p_periode and exists(select 1 from related r where t.referensi_tiket_asal=r.id_tiket or t.garansi_asal in(select g.id_garansi from public.garansi g where g.referensi_tiket_nota=r.id_tiket and g.cabang=branch))
 ) select jsonb_build_object('period',p_periode,'profile',jsonb_build_object('username',u.username,'name',u.nama_asli,'branch',branch),
  'duplicateName',(select count(*)<>1 from public.users x where lower(btrim(x.nama_asli))=lower(btrim(u.nama_asli)) and public.sla_gaji_cabang(x)=branch),
  'tickets',coalesce((select jsonb_agg(jsonb_build_object(
   'id_tiket',t.id_tiket,'teknisi',t.teknisi,'teknisi_sebelumnya',t.teknisi_sebelumnya,'status',t.status,
   'waktu_selesai',t.waktu_selesai,'waktu_lapor',t.waktu_lapor,'waktu_penugasan',t.waktu_penugasan,
   'tenggat_waktu',t.tenggat_waktu,'tenggat_respon',t.tenggat_respon,'waktu_respon',t.waktu_respon,
   'penilaian_teknisi',t.penilaian_teknisi-'bonusSnapshot','konteks_pekerjaan',t.konteks_pekerjaan,'riwayat_penggantian_teknisi',t.riwayat_penggantian_teknisi,
   'penalti_teknisi_lama',t.penalti_teknisi_lama,'keterangan',t.keterangan,
   'garansi_asal',t.garansi_asal,'referensi_tiket_asal',t.referensi_tiket_asal) order by t.id_tiket) from selected t),'[]'),
  'warranties',coalesce((select jsonb_agg(jsonb_build_object('id_garansi',g.id_garansi,'referensi_tiket_nota',g.referensi_tiket_nota,
    'tanggal_mulai',g.tanggal_mulai,'tanggal_habis',g.tanggal_habis,'item_garansi',g.item_garansi,'riwayat_klaim_item',g.riwayat_klaim_item) order by g.id_garansi)
    from public.garansi g where g.cabang=branch and g.referensi_tiket_nota in(select id_tiket from selected) and
    (g.tanggal_mulai<((p_periode||'-01')::date+interval '1 month') at time zone 'Asia/Makassar' and g.tanggal_habis>=((p_periode||'-01')::date) at time zone 'Asia/Makassar'
     or exists(select 1 from public.tiket c where c.cabang=branch and (c.garansi_asal=g.id_garansi or c.referensi_tiket_asal=g.referensi_tiket_nota) and to_char(c.waktu_lapor at time zone 'Asia/Makassar','YYYY-MM')=p_periode))),'[]'),
  'unknownWarrantyClaims',(select count(*) from public.tiket t where t.cabang=branch and nullif(t.garansi_asal,'') is not null and nullif(t.referensi_tiket_asal,'') is null and to_char(t.waktu_lapor at time zone 'Asia/Makassar','YYYY-MM')=p_periode)
  ,'episodes',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.sla_performa_episode e where e.cabang=branch and lower(regexp_replace(btrim(u.nama_asli),'\s+',' ','g'))=any(public.sla_penilaian_nama(e.teknisi)) and p_periode=any(array[to_char(e.waktu_pergantian at time zone 'Asia/Makassar','YYYY-MM'),to_char(e.tenggat_waktu at time zone 'Asia/Makassar','YYYY-MM'),to_char(e.tenggat_respon at time zone 'Asia/Makassar','YYYY-MM')])),'[]')
 ) into result;
 return jsonb_build_object('data',result,'hash',md5(result::text));
end $$;


revoke all on function public.sla_performa_sumber(text,text) from public,anon,authenticated;
grant execute on function public.sla_performa_sumber(text,text) to service_role;
