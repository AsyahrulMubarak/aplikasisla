CREATE OR REPLACE FUNCTION public.sla_ringkasan_gaji(p_usernames text[], p_periode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('username',u.username,'gajiPeriode',public.sla_gaji_nominal_periode(u.username,p_periode),
   'gajiSekarang',coalesce(u.gaji_pokok,0),'berlakuOtomatis',public.sla_gaji_cabang(u)='Kendari' and coalesce(u.gaji_pokok,0)>0 and p.username is not null,'mulaiPeriode',p.mulai_periode,'selesai',p.otomatis_selesai,
   'bulanTerkumpul',(select count(*) from public.sla_gaji_kredit c where c.username=u.username and c.kenaikan_id is null),
   'kreditTerkumpul',(select count(*) from public.sla_gaji_kredit c where c.username=u.username and c.kenaikan_id is null),
   'mulaiKreditPerforma','2026-11',
   'kreditBulanan',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select c.periode,count(*) as kredit,bool_or(c.sumber='kehadiran') as kehadiran,bool_or(c.sumber='performa') as performa,bool_and(c.kenaikan_id is not null) as dipakai from public.sla_gaji_kredit c where c.username=u.username group by c.periode order by c.periode desc limit 12) q),
   'evaluasi',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select periode,telat_pagi,alpa,memenuhi_syarat,alasan,kenaikan_id is not null as dipakai from public.sla_gaji_disiplin_bulan where username=u.username order by periode desc limit 12) q),
   'riwayat',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select berlaku_periode,jenis,gaji_lama,gaji_baru,alasan,diubah_oleh from public.sla_gaji_riwayat where username=u.username and jenis<>'Awal' order by urutan desc limit 5) q)
 )) from public.users u left join public.sla_gaji_program p on p.username=u.username where u.username=any(p_usernames)),'[]');
end $function$;
